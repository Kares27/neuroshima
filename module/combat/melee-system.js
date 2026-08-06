/**
 * Neuroshima melee engine V2.
 *
 * This module is deliberately the single domain boundary for melee.  It owns
 * the session schema, activity catalogue, conditions, outcomes, operations,
 * effect lifetime, persistence, migration and the authoritative command bus.
 * Rendering lives in melee-system-ui.js; global Foundry initiative remains in
 * the normal Combat/Combatant documents and is never written here.
 */

export const MELEE_VERSION = 2;
export const MELEE_FLAG = "meleeSessionsV2";
export const MELEE_SETTING = "meleeEngineV2";
export const MELEE_SOCKET_COMMAND = "dispatchMeleeCommand";
export const MELEE_SIDES = Object.freeze(["attacker", "defender"]);
export const MELEE_PHASES = Object.freeze([
  "awaitingAttackerRoll", "awaitingDefenderRoll", "declaration",
  "response", "resolution", "pendingOutcomes", "complete"
]);

const clone = value => globalThis.foundry?.utils?.deepClone
  ? foundry.utils.deepClone(value)
  : structuredClone(value);
const randomId = () => globalThis.foundry?.utils?.randomID?.(16)
  ?? globalThis.crypto?.randomUUID?.()
  ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const array = value => {
  if (Array.isArray(value)) return value;
  if (value && typeof value.values === "function") return [...value.values()];
  if (value && typeof value[Symbol.iterator] === "function") return [...value];
  return [];
};
const serializable = value => {
  if (value?.documentName || value?.uuid) {
    return { documentName: value.documentName ?? null, uuid: value.uuid ?? null, id: value.id ?? null };
  }
  try { return clone(value); }
  catch (_error) { return value == null ? value : String(value); }
};

export class MeleeValidationError extends Error {
  constructor(message, code = "INVALID_MELEE_COMMAND", details = {}) {
    super(message);
    this.name = "MeleeValidationError";
    this.code = code;
    this.details = details;
  }
}

export function validateMeleeRevision(actual, expected) {
  if (Number(expected) !== Number(actual)) {
    throw new MeleeValidationError("Stale melee revision", "STALE_REVISION", { expected, actual });
  }
  return true;
}

export function createMeleeDie(data = {}, index = 0) {
  const raw = number(data.raw ?? data.original ?? data.value, 0);
  return {
    id: String(data.id || `die-${index + 1}-${randomId()}`),
    index,
    raw,
    modified: number(data.modified, raw),
    target: number(data.target, 0),
    isSuccess: data.isSuccess === true,
    used: data.used === true,
    reusable: data.reusable === true,
    segmentId: data.segmentId ?? null,
    changes: array(data.changes).map(clone)
  };
}

export function normalizeMeleePool(pool = []) {
  if (!Array.isArray(pool) || pool.length !== 3) {
    throw new MeleeValidationError("Melee requires exactly three dice", "INVALID_DICE_POOL");
  }
  const normalized = pool.map(createMeleeDie);
  if (new Set(normalized.map(die => die.id)).size !== 3) {
    throw new MeleeValidationError("Melee die IDs must be unique", "DUPLICATE_DIE_ID");
  }
  return normalized;
}

export function createMeleeSegments() {
  return [0, 1, 2].map(index => ({
    id: `segment-${index + 1}`,
    index,
    state: index === 0 ? "active" : "available",
    ownerActionId: null,
    responderActionId: null,
    ownerDiceIds: [],
    responderDiceIds: [],
    outcomeIds: [],
    span: 1
  }));
}

export function createMeleeSession({
  id = randomId(), combatId = null, messageId = null,
  attacker, defender, initiativeOwnerId = attacker?.actorUuid,
  mode = "opposedSuccessPoints", metadata = {}
} = {}) {
  if (!attacker?.actorUuid || !defender?.actorUuid) {
    throw new MeleeValidationError("Both melee participants require actorUuid", "MISSING_PARTICIPANT");
  }
  if (attacker.actorUuid === defender.actorUuid) {
    throw new MeleeValidationError("An actor cannot engage itself", "SAME_PARTICIPANT");
  }
  if (![attacker.actorUuid, defender.actorUuid].includes(initiativeOwnerId)) {
    throw new MeleeValidationError("Initiative owner must be an engagement participant", "INVALID_INITIATIVE_OWNER");
  }
  const now = Date.now();
  return {
    schemaVersion: MELEE_VERSION,
    id: String(id),
    revision: 0,
    combatId,
    messageId,
    status: "active",
    phase: "awaitingAttackerRoll",
    mode,
    participants: {
      attacker: normalizeParticipant(attacker, "attacker"),
      defender: normalizeParticipant(defender, "defender")
    },
    initiative: { ownerId: initiativeOwnerId, previousOwnerId: null, reason: "engagementStart" },
    pools: { attacker: [], defender: [] },
    segments: createMeleeSegments(),
    currentSegment: 0,
    declarations: { owner: null, responder: null },
    actionInstances: {},
    pendingOutcomes: [],
    effects: [],
    operationLedger: {},
    commandLedger: {},
    history: [],
    metadata: clone(metadata),
    createdAt: now,
    updatedAt: now
  };
}

function normalizeParticipant(participant, side) {
  return {
    side,
    actorUuid: String(participant.actorUuid),
    tokenUuid: participant.tokenUuid || null,
    userIds: [...new Set(array(participant.userIds).filter(Boolean))],
    name: String(participant.name || side),
    img: participant.img || null,
    weaponUuid: participant.weaponUuid || null,
    beastItemUuid: participant.beastItemUuid || null
  };
}

export function sideForActor(session, actorUuid) {
  return MELEE_SIDES.find(side => {
    const participant = session.participants[side];
    return participant.actorUuid === actorUuid || participant.tokenUuid === actorUuid;
  }) ?? null;
}

async function userControlsMeleeParticipant(participant, user = game.user) {
  if (!user?.active) return false;
  if (user.isGM) return true;
  const document = await fromUuid(participant?.tokenUuid || participant?.actorUuid);
  const actor = document?.actor ?? document;
  if (user.character?.uuid === actor?.uuid) return true;
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return actor?.testUserPermission?.(user, ownerLevel) === true;
}

/** Canonical UI projection of the participant or GM action required by a session phase. */
export async function buildMeleeRequiredAction(session, user = game.user) {
  const ownerSide = initiativeSide(session);
  const responderSide = ownerSide === "attacker" ? "defender" : "attacker";
  const map = {
    awaitingAttackerRoll: { side: "attacker", kind: "roll", label: "Rzut atakującego" },
    awaitingDefenderRoll: { side: "defender", kind: "roll", label: "Rzut obrońcy" },
    declaration: { side: ownerSide, kind: "declare", label: "Deklaracja akcji" },
    response: { side: responderSide, kind: "respond", label: "Odpowiedź na akcję" },
    pendingOutcomes: { side: null, kind: "approve", label: "Zatwierdzenie wyniku przez MG" },
    resolution: { side: null, kind: "advance", label: "Przejście do następnego segmentu" },
    complete: { side: null, kind: "complete", label: "Zwarcie zakończone" }
  };
  const action = map[session.phase] ?? { side: null, kind: "unknown", label: session.phase };
  const participant = action.side ? session.participants[action.side] : null;
  const gmAction = ["approve", "advance"].includes(action.kind);
  const controlledSides = [];
  for (const side of MELEE_SIDES) {
    if (await userControlsMeleeParticipant(session.participants[side], user)) controlledSides.push(side);
  }
  return {
    ...action,
    participantName: participant?.name ?? (gmAction ? "MG" : null),
    waitingText: action.kind === "complete"
      ? action.label
      : `Oczekuje na: ${participant?.name ?? "MG"} — ${action.label}`,
    canAct: gmAction ? user?.isGM === true : (participant ? await userControlsMeleeParticipant(participant, user) : false),
    canCancel: user?.isGM === true || controlledSides.length > 0,
    controlSide: controlledSides[0] ?? null
  };
}

export function meleeParticipantFromActor(actor, { weapon = null } = {}) {
  if (!actor) throw new MeleeValidationError("Actor is required", "MISSING_PARTICIPANT");
  const token = actor.token?.document ?? actor.token ?? null;
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  weapon ??= array(actor.items).find(item =>
    item.type === "weapon" && item.system?.weaponType === "melee" && item.system?.equipped !== false
  ) ?? null;
  const userIds = array(game.users).filter(user => user.active && (
    user.character?.uuid === actor.uuid || actor.testUserPermission?.(user, ownerLevel)
  )).map(user => user.id);
  return {
    actorUuid: actor.uuid,
    tokenUuid: token?.uuid ?? null,
    userIds,
    name: actor.name,
    img: actor.img,
    weaponUuid: weapon?.uuid ?? null,
    beastItemUuid: ["beast-action", "beast-segment"].includes(weapon?.type) ? weapon.uuid : null
  };
}

export function initiativeSide(session) {
  return sideForActor(session, session.initiative.ownerId);
}

export function transferMeleeInitiative(session, ownerId, reason = "operation") {
  if (!MELEE_SIDES.some(side => session.participants[side].actorUuid === ownerId)) {
    throw new MeleeValidationError("Initiative can only pass to an engagement participant", "INVALID_INITIATIVE_OWNER");
  }
  if (session.initiative.ownerId === ownerId) return session;
  session.initiative.previousOwnerId = session.initiative.ownerId;
  session.initiative.ownerId = ownerId;
  session.initiative.reason = reason;
  return session;
}

export const MeleeConditionRegistry = new Map();
export function registerMeleeCondition(key, evaluator, {
  label = key, fields = [], validate = () => true,
  summarize = condition => `${label}: ${condition.value ?? ""}`.trim()
} = {}) {
  if (!key || typeof evaluator !== "function") throw new TypeError("Condition requires a key and evaluator");
  MeleeConditionRegistry.set(key, { key, label, fields, validate, evaluator, summarize });
}
export function evaluateMeleeConditions(conditions, context) {
  const evaluate = raw => {
    const condition = typeof raw === "string" ? { key: raw } : raw;
    const definition = MeleeConditionRegistry.get(condition?.key);
    if (!definition || definition.validate(condition) !== true) return false;
    return definition.evaluator(context, condition, evaluate);
  };
  if (conditions?.key) return evaluate(conditions);
  return array(conditions).every(evaluate);
}

const actorPath = (actor, path) => globalThis.foundry?.utils?.getProperty?.(actor, path)
  ?? path.split(".").reduce((value, key) => value?.[key], actor);
const setPath = (object, path, value) => {
  if (globalThis.foundry?.utils?.setProperty) return foundry.utils.setProperty(object, path, value);
  const keys = path.split(".");
  const final = keys.pop();
  const parent = keys.reduce((entry, key) => entry[key] ??= {}, object);
  parent[final] = value;
  return true;
};

const numericField = [{ name: "value", type: "number", required: true }];
const valueRequired = condition => condition.value !== undefined;
registerMeleeCondition("always", () => true, { label: "Zawsze" });
registerMeleeCondition("all", (_context, c, evaluate) => array(c.conditions).every(evaluate), {
  label: "Wszystkie warunki", fields: [{ name: "conditions", type: "conditions" }]
});
registerMeleeCondition("any", (_context, c, evaluate) => array(c.conditions).some(evaluate), {
  label: "Dowolny warunek", fields: [{ name: "conditions", type: "conditions" }]
});
registerMeleeCondition("not", (_context, c, evaluate) => !evaluate(c.condition), {
  label: "Negacja", fields: [{ name: "condition", type: "condition" }], validate: c => !!c.condition
});
registerMeleeCondition("hasInitiative", ({ session, side }) => initiativeSide(session) === side, { label: "Posiada inicjatywę" });
registerMeleeCondition("lacksInitiative", ({ session, side }) => initiativeSide(session) !== side, { label: "Nie posiada inicjatywy" });
registerMeleeCondition("phase", ({ session }, c) => session.phase === c.value, {
  label: "Faza sesji", fields: [{ name: "value", type: "select", choices: MELEE_PHASES }], validate: c => MELEE_PHASES.includes(c.value)
});
registerMeleeCondition("isAttacker", ({ side }) => side === "attacker", { label: "Deklaruje atakujący" });
registerMeleeCondition("isDefender", ({ side }) => side === "defender", { label: "Deklaruje obrońca" });
registerMeleeCondition("isInitiativeOwner", ({ session, side }) => initiativeSide(session) === side, { label: "Deklaruje właściciel inicjatywy" });
registerMeleeCondition("isResponder", ({ session, side }) => initiativeSide(session) !== side, { label: "Deklaruje odpowiadający" });
registerMeleeCondition("minSuccessPoints", ({ successPoints = 0 }, c) => number(successPoints) >= number(c.value), { label: "Minimum sukcesów", fields: numericField, validate: valueRequired });
registerMeleeCondition("maxSuccessPoints", ({ successPoints = 0 }, c) => number(successPoints) <= number(c.value), { label: "Maksimum sukcesów", fields: numericField, validate: valueRequired });
registerMeleeCondition("minDice", ({ selectedDice = [] }, c) => selectedDice.length >= number(c.value, 1), { label: "Minimum wybranych kości", fields: numericField, validate: valueRequired });
registerMeleeCondition("maxDice", ({ selectedDice = [] }, c) => selectedDice.length <= number(c.value, 3), { label: "Maksimum wybranych kości", fields: numericField, validate: valueRequired });
registerMeleeCondition("freeDice", ({ session, side }, c) => array(session.pools?.[side]).filter(die => !die.used || die.reusable).length >= number(c.value), { label: "Wolne kości", fields: numericField, validate: valueRequired });
registerMeleeCondition("segment", ({ session }, c) => session.currentSegment === number(c.value), { label: "Segment", fields: numericField, validate: valueRequired });
registerMeleeCondition("previousHit", ({ session, side }) => {
  const previous = session.segments[session.currentSegment - 1];
  const action = session.actionInstances[previous?.ownerActionId];
  return action?.side === side && previous?.outcomeIds?.length > 0;
}, { label: "Trafienie w poprzednim segmencie" });
registerMeleeCondition("previousDefense", ({ session, side }) => {
  const previous = session.segments[session.currentSegment - 1];
  return [previous?.ownerActionId, previous?.responderActionId]
    .map(id => session.actionInstances[id]).some(action => action?.side === side && action.definition.category === "defense");
}, { label: "Obrona w poprzednim segmencie" });
registerMeleeCondition("initiativeTaken", ({ session, actor }) => session.initiative.ownerId === actor?.uuid && session.initiative.previousOwnerId != null, { label: "Przejęto inicjatywę" });
registerMeleeCondition("initiativeLost", ({ session, actor }) => session.initiative.previousOwnerId === actor?.uuid, { label: "Utracono inicjatywę" });
registerMeleeCondition("hasItem", ({ actor }, c) => array(actor?.items).some(item => item.uuid === c.uuid || item.id === c.id || item.name === c.name), {
  label: "Posiada Item", fields: [{ name: "uuid", type: "documentUuid" }], validate: c => !!(c.uuid || c.id || c.name)
});
registerMeleeCondition("actorType", ({ actor }, c) => actor?.type === c.value, { label: "Typ aktora", fields: [{ name: "value", type: "text" }], validate: valueRequired });
registerMeleeCondition("actorPath", ({ actor }, c) => {
  const value = actorPath(actor, c.path || "");
  return c.operator === "gte" ? number(value) >= number(c.value)
    : c.operator === "lte" ? number(value) <= number(c.value)
      : c.operator === "includes" ? array(value).includes(c.value)
        : value === c.value;
}, { label: "Wartość danych aktora", fields: [{ name: "path", type: "text" }, { name: "operator", type: "select" }, { name: "value", type: "text" }], validate: c => !!c.path });
registerMeleeCondition("hasEffect", ({ actor }, c) => array(actor?.effects).some(effect =>
  effect.uuid === c.uuid || effect.name === c.name || effect.getFlag?.("neuroshima", "meleeStackKey") === c.stackKey), { label: "Status aktora", fields: [{ name: "stackKey", type: "text" }] });
registerMeleeCondition("targetHasEffect", ({ target }, c) => array(target?.effects).some(effect =>
  effect.uuid === c.uuid || effect.name === c.name || effect.getFlag?.("neuroshima", "meleeStackKey") === c.stackKey), { label: "Status celu", fields: [{ name: "stackKey", type: "text" }] });
registerMeleeCondition("weaponTag", ({ item, activity }, c) => array(item?.system?.tags).includes(c.value) || array(activity?.tags).includes(c.value), { label: "Tag broni", fields: [{ name: "value", type: "text" }], validate: valueRequired });
registerMeleeCondition("activityTag", ({ activity }, c) => array(activity?.tags).includes(c.value), { label: "Tag Activity", fields: [{ name: "value", type: "text" }], validate: valueRequired });
registerMeleeCondition("grabbed", ({ actor }) => array(actor?.effects).some(effect => ["grabbed", "grappled", "pochwycenie"].includes(array(effect.statuses)[0] || effect.getFlag?.("core", "statusId"))), { label: "Pochwycenie" });
registerMeleeCondition("knockedDown", ({ actor }) => array(actor?.effects).some(effect => ["prone", "knockedDown", "przewrocenie"].includes(array(effect.statuses)[0] || effect.getFlag?.("core", "statusId"))), { label: "Przewrócenie" });
registerMeleeCondition("resource", ({ actor }, c) => number(actorPath(actor, c.path)) >= number(c.value), { label: "Zasób", fields: [{ name: "path", type: "text" }, ...numericField], validate: c => !!c.path && valueRequired(c) });
registerMeleeCondition("usageLimit", ({ session, activity }, c) => number(session.metadata?.activityUses?.[activity.id]) < number(c.value, 1), { label: "Limit użycia", fields: numericField, validate: valueRequired });
registerMeleeCondition("oncePerOpponent", ({ session, activity, target }) => !Object.values(session.actionInstances ?? {}).some(
  instance => instance.activityId === activity.id && array(instance.targetUuids).includes(target?.uuid)
), { label: "Raz na przeciwnika" });
registerMeleeCondition("previousSegmentAction", ({ session, side }, c) => {
  const previous = session.segments[session.currentSegment - 1];
  return [previous?.ownerActionId, previous?.responderActionId]
    .map(id => session.actionInstances[id]).some(action => action?.side === side && (action.activityId === c.value || action.definition.category === c.value));
}, { label: "Akcja w poprzednim segmencie", fields: [{ name: "value", type: "text" }], validate: valueRequired });
registerMeleeCondition("weaponType", ({ item }, c) => item?.type === c.value || item?.system?.weaponType === c.value, { label: "Typ broni", fields: [{ name: "value", type: "text" }], validate: valueRequired });
registerMeleeCondition("location", ({ location }, c) => location === c.value, { label: "Lokacja", fields: [{ name: "value", type: "text" }], validate: valueRequired });

export function normalizeMeleeActivity(raw = {}, source = {}) {
  const activation = raw.activation ?? {};
  const costs = raw.costs ?? {};
  return {
    id: String(raw.id || randomId()),
    name: String(raw.name || raw.label || "Akcja melee"),
    img: raw.img || source.img || null,
    description: String(raw.description || raw.tooltip || ""),
    category: raw.category || raw.type || "attack",
    tags: [...new Set(array(raw.tags))],
    source: {
      kind: source.kind || raw.source?.kind || "item",
      uuid: source.uuid || raw.source?.uuid || null,
      itemUuid: source.itemUuid || raw.source?.itemUuid || null,
      effectUuid: source.effectUuid || raw.source?.effectUuid || null
    },
    activation: {
      role: activation.role || raw.role || "either",
      timing: activation.timing || raw.timing || "declaration",
      minDice: number(activation.minDice ?? raw.minDice, 1),
      maxDice: number(activation.maxDice ?? raw.maxDice, 3),
      segmentCost: number(activation.segmentCost ?? raw.segmentCost, raw.costType === "segment" ? 1 : 0),
      successCost: number(activation.successCost ?? costs.successPoints ?? raw.successCost, raw.costType === "success" ? 1 : 0),
      reusableDice: activation.reusableDice === true
    },
    conditions: array(raw.conditions).map(clone),
    outcomes: array(raw.outcomes).map(normalizeOutcomeDefinition),
    operations: array(raw.operations).map(normalizeOperation),
    automation: {
      approval: raw.automation?.approval || raw.approval || "gm",
      resolver: raw.automation?.resolver || raw.resolverKind || "opposedSuccessPoints"
    },
    legacy: clone(raw.legacy ?? {})
  };
}

export function normalizeOutcomeDefinition(raw = {}) {
  return {
    id: String(raw.id || randomId()),
    when: raw.when || "used",
    label: String(raw.label || raw.name || "Wynik"),
    target: raw.target || "opponent",
    conditions: array(raw.conditions).map(clone),
    operations: array(raw.operations).map(normalizeOperation),
    approval: raw.approval || "inherit"
  };
}

export function normalizeOperation(raw = {}) {
  return {
    id: String(raw.id || randomId()),
    type: String(raw.type || "chatEntry"),
    target: raw.target || "opponent",
    data: clone(raw.data ?? {}),
    conditions: array(raw.conditions).map(clone)
  };
}

export function createMeleeActionInstance(activity, {
  side, actorUuid, selectedDiceIds = [], segmentIndex = 0, targetUuids = []
} = {}) {
  const definition = normalizeMeleeActivity(activity, activity.source);
  return {
    id: randomId(),
    activityId: definition.id,
    sourceUuid: definition.source.uuid || definition.source.itemUuid || definition.source.effectUuid,
    side,
    actorUuid,
    selectedDiceIds: [...new Set(selectedDiceIds)],
    targetUuids: [...new Set(targetUuids)],
    segmentIndex,
    definition,
    state: "declared",
    createdAt: Date.now()
  };
}

export class MeleeActionCatalog {
  static coreActivities(actor, item = null) {
    const sourceUuid = item?.uuid || actor?.uuid || "neuroshima.core";
    const common = { source: { kind: "core", uuid: sourceUuid, itemUuid: item?.uuid || null } };
    const damageProfiles = [
      item?.system?.damageMelee1 ?? "D",
      item?.system?.damageMelee2 ?? item?.system?.damageMelee1 ?? "D",
      item?.system?.damageMelee3 ?? item?.system?.damageMelee2 ?? item?.system?.damageMelee1 ?? "D"
    ];
    return [
      normalizeMeleeActivity({ id: "attack", name: "Atak", category: "attack", timing: "either", outcomes: [{
        id: "hit", when: "hit", label: "Trafienie", operations: [{
          type: "damage", target: "opponent", data: { damageProfiles, piercing: number(item?.system?.piercing) }
        }]
      }] }, common.source),
      normalizeMeleeActivity({ id: "defense", name: "Obrona", category: "defense", timing: "either", outcomes: [] }, common.source),
      normalizeMeleeActivity({ id: "exit", name: "Wyjście ze zwarcia", category: "movement", timing: "either", minDice: 1, maxDice: 1,
        outcomes: [{ id: "exit", label: "Wyjście", operations: [{ type: "endEngagement", data: { reason: "exit" } }] }] }, common.source),
      normalizeMeleeActivity({ id: "flee", name: "Ucieczka", category: "movement", timing: "either", minDice: 1, maxDice: 3,
        outcomes: [{ id: "flee", label: "Ucieczka", operations: [{ type: "endEngagement", data: { reason: "flee" } }] }] }, common.source),
      normalizeMeleeActivity({ id: "nonCombat", name: "Akcja niebojowa", category: "utility", timing: "either" }, common.source)
    ];
  }

  static fromBeastItem(item) {
    return array(item?.system?.activities).map(activity => normalizeMeleeActivity({
      ...clone(activity),
      id: activity.id,
      category: "beast",
      activation: {
        ...(activity.activation ?? {}),
        successCost: activity.costType === "success" ? number(activity.successCost, 1) : 0,
        segmentCost: activity.costType === "segment" ? number(activity.segmentCost, 1) : 0,
        minDice: activity.minDice ?? 1,
        maxDice: activity.maxDice ?? 3
      },
      operations: array(activity.operations).length
        ? activity.operations
        : legacyBeastOperations(item, activity)
    }, { kind: "beast", uuid: `${item.uuid}#${activity.id}`, itemUuid: item.uuid }));
  }

  static fromEffect(effect) {
    const configured = array(effect?.system?.melee?.grantedActivities);
    const legacy = array(effect?.system?.actionDefs).filter(entry => entry.type !== "result");
    const restrictions = array(effect?.system?.melee?.restrictions);
    return [...configured, ...legacy].map(activity => normalizeMeleeActivity({
      ...clone(activity),
      conditions: [...restrictions, ...array(activity.conditions)]
    }, {
      kind: "effect", uuid: `${effect.uuid}#${activity.id}`, effectUuid: effect.uuid
    }));
  }

  static collect(actor, { item = null } = {}) {
    const results = this.coreActivities(actor, item);
    const items = array(actor?.items);
    if (item && !items.some(candidate => candidate.uuid === item.uuid)) items.unshift(item);
    for (const candidate of items) {
      const configured = array(candidate.getFlag?.("neuroshima", "meleeActivities"));
      if (candidate.type === "beast-action" || candidate.type === "beast-segment") {
        if (!configured.length) results.push(...this.fromBeastItem(candidate));
      }
      for (const activity of configured) {
        results.push(normalizeMeleeActivity(activity, {
          kind: "item", uuid: `${candidate.uuid}#${activity.id}`, itemUuid: candidate.uuid
        }));
      }
    }
    for (const effect of array(actor?.effects)) {
      if (!effect.disabled) results.push(...this.fromEffect(effect));
    }
    // Effect modifiers can alter core/item/beast activities without creating a
    // duplicate action.  This is the declarative replacement for script-side
    // mutation of cards.
    for (const effect of array(actor?.effects).filter(entry => !entry.disabled)) {
      for (const modifier of array(effect.system?.melee?.modifiers)) {
        for (const activity of results) {
          if (modifier.activityId && modifier.activityId !== activity.id) continue;
          if (modifier.tag && !activity.tags.includes(modifier.tag)) continue;
          if (!modifier.path) continue;
          const current = actorPath(activity, modifier.path);
          const value = modifier.mode === "add"
            ? number(current) + number(modifier.value)
            : modifier.mode === "multiply"
              ? number(current) * number(modifier.value, 1)
              : clone(modifier.value);
          setPath(activity, modifier.path, value);
        }
      }
    }
    return results;
  }

  static findExact(actor, reference, options = {}) {
    const activities = this.collect(actor, options);
    return activities.find(activity =>
      activity.id === reference.activityId &&
      (activity.source.itemUuid || null) === (reference.sourceItemUuid || null) &&
      (activity.source.effectUuid || null) === (reference.sourceEffectUuid || null)
    ) ?? null;
  }
}

function legacyBeastOperations(item, activity) {
  const operations = [];
  if (activity.damage && activity.damage !== "—") operations.push({
    type: "damage", target: "opponent", data: { damage: activity.damage }
  });
  if (activity.testRequired) operations.push({ type: "requiredTest", target: "opponent", data: {
    title: activity.name || item.name,
    testType: activity.testType || "attribute",
    testKey: activity.testKey || "constitution",
    testAttributeOverride: activity.testAttributeOverride || "",
    requiredSuccesses: activity.testSuccesses ?? 1,
    isOpen: activity.testIsOpen ?? false,
    baseDifficulty: activity.testDifficulty || "average",
    onSuccessEffectIds: array(activity.effectIds),
    onFailureEffectIds: array(activity.onFailureEffectIds)
  }});
  else for (const effectId of array(activity.effectIds)) operations.push({
    type: "applyEffect", target: activity.effectTarget === "self" ? "self" : "opponent",
    data: { sourceItemUuid: item.uuid, effectId, timing: activity.effectTiming || "onUse" }
  });
  if (activity.onHitScript) operations.push({ type: "legacyScript", target: "opponent", data: {
    code: activity.onHitScript, immediate: activity.immediateOnHit === true
  }});
  return operations;
}

export const MeleeOperationRegistry = new Map();
export function registerMeleeOperation(type, handler) {
  if (!type || typeof handler !== "function") throw new TypeError("Operation requires a type and handler");
  MeleeOperationRegistry.set(type, handler);
}

function operationTarget(context, operation) {
  if (operation.target === "self") return context.actor;
  if (operation.target === "opponent") return context.target;
  if (operation.target === "initiativeOwner") {
    const side = initiativeSide(context.session);
    return context.actors?.[side] ?? null;
  }
  return context.target;
}

registerMeleeOperation("chatEntry", async ({ operation }) => ({ text: operation.data.text || "" }));
registerMeleeOperation("transferInitiative", async ({ session, operation, actor, target }) => {
  const recipient = operation.data.to === "self" ? actor : target;
  transferMeleeInitiative(session, recipient.uuid, operation.data.reason || "activity");
  return { ownerId: recipient.uuid };
});
registerMeleeOperation("modifyDie", async ({ session, operation }) => {
  const side = operation.data.side || initiativeSide(session);
  const die = session.pools[side]?.find(entry => entry.id === operation.data.dieId);
  if (!die) throw new MeleeValidationError("Die not found", "DIE_NOT_FOUND");
  die.modified = number(die.modified) + number(operation.data.amount);
  die.isSuccess = die.modified <= number(die.target) && die.raw !== 20;
  die.changes.push({ type: "operation", amount: number(operation.data.amount) });
  return clone(die);
});
registerMeleeOperation("modifyTarget", async ({ session, operation }) => {
  const side = operation.data.side || initiativeSide(session);
  for (const die of session.pools[side] ?? []) {
    die.target += number(operation.data.amount);
    die.isSuccess = die.modified <= die.target && die.raw !== 20;
  }
  return { side, amount: number(operation.data.amount) };
});
registerMeleeOperation("endEngagement", async ({ session, operation }) => {
  session.status = "complete";
  session.phase = "complete";
  session.endReason = operation.data.reason || "operation";
  return { reason: session.endReason };
});
registerMeleeOperation("scheduleOutcome", async ({ session, operation }) => {
  const outcome = normalizePendingOutcome(operation.data.outcome || operation.data);
  session.pendingOutcomes.push(outcome);
  return { outcomeId: outcome.id };
});
registerMeleeOperation("followUp", async ({ session, operation }) => {
  session.metadata.followUps ??= [];
  const entry = { id: randomId(), ...clone(operation.data), createdAt: Date.now() };
  session.metadata.followUps.push(entry);
  return entry;
});
registerMeleeOperation("movement", async ({ operation, actor, target }) => ({
  actorUuid: (operation.data.who === "target" ? target : actor)?.uuid,
  distance: number(operation.data.distance), direction: operation.data.direction || "away"
}));
registerMeleeOperation("spendResource", async ({ operation, actor }) => {
  const path = operation.data.path;
  if (!path || !actor) throw new MeleeValidationError("Resource operation requires actor and path");
  const current = number(actorPath(actor, path));
  const amount = Math.max(0, number(operation.data.amount, 1));
  if (current < amount && operation.data.allowNegative !== true) {
    throw new MeleeValidationError("Insufficient resource", "INSUFFICIENT_RESOURCE");
  }
  await actor.update({ [path]: current - amount });
  return { path, before: current, after: current - amount };
});
registerMeleeOperation("recoverResource", async ({ operation, actor }) => {
  const path = operation.data.path;
  const current = number(actorPath(actor, path));
  const amount = Math.max(0, number(operation.data.amount, 1));
  await actor.update({ [path]: current + amount });
  return { path, before: current, after: current + amount };
});
registerMeleeOperation("damage", async context => {
  const target = operationTarget(context, context.operation);
  if (!target) throw new MeleeValidationError("Damage target not found", "TARGET_NOT_FOUND");
  const { CombatHelper } = await import("../helpers/combat-helper.js");
  const data = context.operation.data;
  const damageTier = Math.min(3, Math.max(1, number(context.successPoints, 1)));
  const damage = data.damage || data.damageProfiles?.[damageTier - 1]
    || context.action.definition.legacy?.damage || "D";
  const attackData = {
    isMelee: true, actorId: context.actor?.id, label: context.action.definition.name,
    damageMelee1: damage, damageMelee2: damage, damageMelee3: damage,
    finalLocation: data.location || context.location || "torso",
    successPoints: Math.max(1, number(context.successPoints, 1)),
    piercing: number(data.piercing)
  };
  const result = await CombatHelper.applyDamageToActor(target, attackData, {
    isOpposed: true, spDifference: attackData.successPoints,
    location: attackData.finalLocation, suppressChat: true
  });
  await MeleeEffectService.expire(context.session, "damageApplied", { actorUuid: target.uuid });
  return result;
});
registerMeleeOperation("modifyDamage", async ({ operation, pendingOutcome }) => {
  pendingOutcome.data ??= {};
  pendingOutcome.data.damageShift = number(pendingOutcome.data.damageShift) + number(operation.data.steps);
  return { damageShift: pendingOutcome.data.damageShift };
});
registerMeleeOperation("applyEffect", async context => MeleeEffectService.applyFromOperation(context));
registerMeleeOperation("removeEffect", async context => MeleeEffectService.removeFromOperation(context));
registerMeleeOperation("requiredTest", async ({ operation, target, actor }) => {
  const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
  return NeuroshimaScriptRunner.postRequiredTest({
    ...clone(operation.data), defenderActorUuid: target?.uuid || "",
    attackerActorUuid: actor?.uuid || "", whisperToDefender: true
  });
});
registerMeleeOperation("legacyScript", async ({ operation, actor, target, session, action }) => {
  if (!operation.data.code) return null;
  const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
  return new NeuroshimaScript({
    code: operation.data.code, trigger: "afterMeleeAction", label: action.definition.name
  }, null).execute({ actor, target, session, action });
});

export function normalizePendingOutcome(raw = {}) {
  return {
    id: String(raw.id || randomId()),
    actionInstanceId: raw.actionInstanceId || null,
    label: String(raw.label || "Wynik melee"),
    status: raw.status || "pending",
    approval: raw.approval || "gm",
    operations: array(raw.operations).map(normalizeOperation),
    data: clone(raw.data ?? {}),
    createdAt: number(raw.createdAt, Date.now()),
    resolvedAt: raw.resolvedAt ?? null
  };
}

export class MeleeResolver {
  static resolve(session, ownerAction, responderAction) {
    const ownerSide = initiativeSide(session);
    const responderSide = ownerSide === "attacker" ? "defender" : "attacker";
    const ownerDice = this._selectedDice(session, ownerSide, ownerAction.selectedDiceIds);
    const responderDice = this._selectedDice(session, responderSide, responderAction.selectedDiceIds);
    const ownerSuccessPoints = ownerDice.filter(die => die.isSuccess).length;
    const responderSuccessPoints = responderDice.filter(die => die.isSuccess).length;
    const difference = ownerSuccessPoints - responderSuccessPoints;
    const winner = difference > 0 ? ownerSide : difference < 0 ? responderSide : "draw";
    const actionWon = winner === ownerAction.side;
    const winningAction = actionWon ? ownerAction : responderAction;
    const outcomes = [
      ...(actionWon ? ownerAction.definition.outcomes : responderAction.definition.outcomes),
      ...(winningAction.definition.operations.length ? [{
        id: `${winningAction.definition.id}-operations`,
        label: winningAction.definition.name,
        conditions: [],
        operations: winningAction.definition.operations,
        approval: winningAction.definition.automation.approval
      }] : [])
    ];
    const outcomeEvent = winningAction.definition.category === "attack"
      ? "hit"
      : winningAction.definition.category === "defense" ? "blocked" : "used";
    const pending = outcomes.filter(outcome =>
      ["used", "onResolve", outcomeEvent].includes(outcome.when) &&
      evaluateMeleeConditions(outcome.conditions, {
      session, side: winner, successPoints: Math.abs(difference),
      selectedDice: winner === ownerSide ? ownerDice : responderDice,
      activity: winner === ownerSide ? ownerAction.definition : responderAction.definition
    })).map(outcome => normalizePendingOutcome({
      actionInstanceId: winner === ownerSide ? ownerAction.id : responderAction.id,
      label: outcome.label,
      approval: outcome.approval === "inherit"
        ? (winner === ownerSide ? ownerAction.definition.automation.approval : responderAction.definition.automation.approval)
        : outcome.approval,
      operations: outcome.operations,
      data: { winner, difference: Math.abs(difference), ownerSuccessPoints, responderSuccessPoints }
    }));

    // Failed attack or successful defense passes only this engagement's melee initiative.
    if (ownerAction.definition.category === "attack" && !actionWon) {
      transferMeleeInitiative(session, session.participants[responderSide].actorUuid, "failedAttackOrDefense");
    }
    return { winner, difference: Math.abs(difference), ownerSuccessPoints, responderSuccessPoints, pending };
  }

  static _selectedDice(session, side, ids) {
    const pool = session.pools[side] ?? [];
    const selected = [...new Set(ids)].map(id => pool.find(die => die.id === id));
    if (selected.some(die => !die)) throw new MeleeValidationError("Selected die not found", "DIE_NOT_FOUND");
    if (selected.some(die => die.used && !die.reusable)) {
      throw new MeleeValidationError("A melee die may be used only once", "DIE_ALREADY_USED");
    }
    return selected;
  }
}

export class MeleeOperationRunner {
  static async runOutcome(session, outcome, context) {
    if (outcome.status === "applied") return outcome;
    for (let index = 0; index < outcome.operations.length; index++) {
      const operation = outcome.operations[index];
      const operationId = `${session.id}:${outcome.id}:${operation.id || index}`;
      if (session.operationLedger[operationId]?.status === "applied") continue;
      if (!evaluateMeleeConditions(operation.conditions, { ...context, session, operation })) continue;
      const handler = MeleeOperationRegistry.get(operation.type);
      if (!handler) throw new MeleeValidationError(`Unknown melee operation: ${operation.type}`, "UNKNOWN_OPERATION");
      session.operationLedger[operationId] = { status: "running", startedAt: Date.now() };
      try {
        const result = await handler({ ...context, session, operation, pendingOutcome: outcome });
        session.operationLedger[operationId] = { status: "applied", appliedAt: Date.now(), result: serializable(result) };
      } catch (error) {
        session.operationLedger[operationId] = { status: "failed", failedAt: Date.now(), error: error.message };
        throw error;
      }
    }
    outcome.status = "applied";
    outcome.resolvedAt = Date.now();
    return outcome;
  }
}

export class MeleeEffectService {
  static async applyFromOperation(context) {
    const target = operationTarget(context, context.operation);
    if (!target) throw new MeleeValidationError("Effect target not found", "TARGET_NOT_FOUND");
    const data = context.operation.data;
    const source = data.effectUuid
      ? await fromUuid(data.effectUuid)
      : data.sourceItemUuid
        ? (await fromUuid(data.sourceItemUuid))?.effects?.get(data.effectId)
        : null;
    if (!source) throw new MeleeValidationError("Effect template not found", "EFFECT_NOT_FOUND");
    return this.applyTemplate(source, target, {
      session: context.session, action: context.action, operation: context.operation,
      duration: data.duration, stackMode: data.stackMode, stackKey: data.stackKey
    });
  }

  static async applyTemplate(template, target, { session, action, operation, duration, stackMode, stackKey } = {}) {
    const melee = template.system?.melee ?? {};
    const key = stackKey || melee.stackKey || template.uuid;
    const mode = stackMode || melee.stackMode || "ignore";
    const existing = array(target.effects).filter(effect =>
      effect.getFlag?.("neuroshima", "meleeStackKey") === key);
    if (existing.length) {
      if (mode === "ignore") return existing[0];
      if (mode === "refresh") {
        await existing[0].update({ duration: clone(duration || template.duration || {}) });
        return existing[0];
      }
      if (mode === "replace") await target.deleteEmbeddedDocuments("ActiveEffect", existing.map(effect => effect.id));
    }
    const source = template.toObject();
    delete source._id;
    source.disabled = false;
    source.transfer = false;
    source.origin = template.uuid;
    if (duration) source.duration = clone(duration);
    source.flags ??= {};
    source.flags.neuroshima = {
      ...(source.flags.neuroshima ?? {}),
      meleeApplied: true,
      meleeStackKey: key,
      meleeSessionId: session?.id || null,
      meleeActionInstanceId: action?.id || null,
      meleeOperationId: operation?.id || null,
      meleeAppliedAt: Date.now()
    };
    const [created] = await target.createEmbeddedDocuments("ActiveEffect", [source]);
    if (session && created) session.effects.push({
      effectUuid: created.uuid, targetUuid: target.uuid, stackKey: key,
      expiryRules: clone(melee.expiryRules ?? []), appliedAtRevision: session.revision
    });
    return created;
  }

  static async removeFromOperation(context) {
    const target = operationTarget(context, context.operation);
    const data = context.operation.data;
    const matches = array(target?.effects).filter(effect =>
      (data.effectUuid && effect.uuid === data.effectUuid) ||
      (data.stackKey && effect.getFlag?.("neuroshima", "meleeStackKey") === data.stackKey) ||
      (data.sourceUuid && effect.origin === data.sourceUuid));
    if (matches.length) await target.deleteEmbeddedDocuments("ActiveEffect", matches.map(effect => effect.id));
    return { removed: matches.map(effect => effect.uuid) };
  }

  static async expire(session, event, payload = {}) {
    const removed = [];
    for (const reference of [...session.effects]) {
      const matches = array(reference.expiryRules).some(rule => {
        if ((rule.event || rule) !== event) return false;
        return rule.segmentIndex == null || rule.segmentIndex === payload.segmentIndex;
      });
      if (!matches) continue;
      const effect = await fromUuid(reference.effectUuid);
      if (effect) await effect.delete();
      removed.push(reference.effectUuid);
    }
    session.effects = session.effects.filter(entry => !removed.includes(entry.effectUuid));
    return removed;
  }
}

export class MeleeSessionStore {
  static _writeQueue = Promise.resolve();

  static _write(operation) {
    const pending = this._writeQueue.catch(() => undefined).then(operation);
    this._writeQueue = pending.catch(() => undefined);
    return pending;
  }

  static async get(sessionId, { combat = game.combat, messageId = null } = {}) {
    const combatSession = combat?.getFlag("neuroshima", MELEE_FLAG)?.[sessionId] ?? null;
    if (combatSession) return clone(combatSession);
    const message = messageId ? game.messages.get(messageId) : game.messages.find(entry =>
      entry.getFlag("neuroshima", "melee")?.sessionId === sessionId);
    return clone(message?.getFlag("neuroshima", "meleeSessionV2") ?? null);
  }

  static async create(session, { combat = game.combat, message = null } = {}) {
    validateMeleeSession(session);
    if (combat) {
      await this._write(async () => {
        const stored = combat.getFlag("neuroshima", MELEE_FLAG)?.[session.id];
        if (stored) throw new MeleeValidationError("Session already exists", "SESSION_EXISTS");
        await combat.update({ [`flags.neuroshima.${MELEE_FLAG}.${session.id}`]: clone(session) });
      });
    } else {
      if (!message) throw new MeleeValidationError("A primary ChatMessage is required outside Combat", "MISSING_PRIMARY_MESSAGE");
      session.messageId = message.id;
      await message.setFlag("neuroshima", "meleeSessionV2", clone(session));
    }
    return session;
  }

  static async save(session, { expectedRevision, combat = game.combat } = {}) {
    if (expectedRevision != null && session.revision !== expectedRevision) {
      throw new MeleeValidationError("Stale melee session revision", "STALE_REVISION", {
        expected: expectedRevision, actual: session.revision
      });
    }
    session.revision += 1;
    session.updatedAt = Date.now();
    validateMeleeSession(session);
    if (combat) {
      await this._write(async () => {
        const stored = combat.getFlag("neuroshima", MELEE_FLAG)?.[session.id];
        if (stored && number(stored.revision) !== number(expectedRevision, stored.revision)) {
          throw new MeleeValidationError("Melee session changed before save", "LOST_UPDATE", {
            expected: expectedRevision, actual: stored.revision
          });
        }
        await combat.update({ [`flags.neuroshima.${MELEE_FLAG}.${session.id}`]: clone(session) });
      });
    } else {
      const message = game.messages.get(session.messageId);
      if (!message) throw new MeleeValidationError("Primary melee message not found", "MESSAGE_NOT_FOUND");
      const stored = message.getFlag("neuroshima", "meleeSessionV2");
      if (stored && number(stored.revision) !== number(expectedRevision, stored.revision)) {
        throw new MeleeValidationError("Melee session changed before save", "LOST_UPDATE");
      }
      await message.setFlag("neuroshima", "meleeSessionV2", clone(session));
    }
    return session;
  }

  static list(combat = game.combat) {
    if (combat) return Object.values(clone(combat.getFlag("neuroshima", MELEE_FLAG) ?? {}));
    return array(game.messages)
      .map(message => message.getFlag("neuroshima", "meleeSessionV2"))
      .filter(Boolean)
      .map(clone);
  }
}

export function validateMeleeSession(session) {
  if (session?.schemaVersion !== MELEE_VERSION) throw new MeleeValidationError("Unsupported melee session schema");
  if (!MELEE_PHASES.includes(session.phase)) throw new MeleeValidationError("Invalid melee phase");
  if (!Number.isInteger(session.revision) || session.revision < 0) throw new MeleeValidationError("Invalid revision");
  if (!Array.isArray(session.segments) || session.segments.length !== 3) throw new MeleeValidationError("Melee requires three segments");
  for (const side of MELEE_SIDES) {
    const pool = session.pools?.[side] ?? [];
    if (pool.length !== 0 && pool.length !== 3) throw new MeleeValidationError("A submitted pool must contain three dice");
  }
  return true;
}

export class MeleeCommandService {
  static _queues = new Map();

  static dispatch(command) {
    const key = String(command?.sessionId || "missing-session");
    const previous = this._queues.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this._dispatch(command));
    const tail = operation.catch(() => undefined);
    this._queues.set(key, tail);
    tail.finally(() => {
      if (this._queues.get(key) === tail) this._queues.delete(key);
    });
    return operation;
  }

  static async _dispatch(command = {}) {
    if (!game.user?.isGM) throw new MeleeValidationError("Melee commands must execute as GM", "GM_REQUIRED");
    const session = await MeleeSessionStore.get(command.sessionId, { messageId: command.messageId });
    if (!session) throw new MeleeValidationError("Melee session not found", "SESSION_NOT_FOUND");
    validateMeleeRevision(session.revision, number(command.expectedRevision, -1));
    const commandId = String(command.commandId || "");
    if (!commandId) throw new MeleeValidationError("commandId is required", "MISSING_COMMAND_ID");
    if (session.commandLedger[commandId]) return clone(session.commandLedger[commandId].result);
    const user = game.users.get(command.userId);
    await this._authorize(session, command, user);
    const result = await this._apply(session, command, user);
    session.commandLedger[commandId] = { type: command.type, userId: command.userId, appliedAt: Date.now(), result: clone(result) };
    session.history.push({ commandId, type: command.type, userId: command.userId, revision: session.revision, at: Date.now() });
    await MeleeSessionStore.save(session, { expectedRevision: command.expectedRevision });
    const message = game.messages.get(session.messageId);
    if (message) await message.update({ "flags.neuroshima.melee.renderedRevision": session.revision });
    Hooks.callAll("neuroshimaMeleeSessionUpdated", clone(session), clone(command), clone(result));
    return { session: clone(session), result: clone(result) };
  }

  static async _authorize(session, command, user) {
    if (!user?.active) throw new MeleeValidationError("Inactive or unknown user", "UNAUTHORIZED");
    if (user.isGM) return;
    if (command.type === "endSession") {
      for (const participant of Object.values(session.participants ?? {})) {
        if (await userControlsMeleeParticipant(participant, user)) return;
      }
      throw new MeleeValidationError("User does not control either participant", "UNAUTHORIZED");
    }
    const side = command.side;
    const participant = session.participants?.[side];
    if (!participant || !await userControlsMeleeParticipant(participant, user)) {
      throw new MeleeValidationError("User does not control this participant", "UNAUTHORIZED");
    }
  }

  static async _apply(session, command) {
    switch (command.type) {
      case "submitRoll": return this._submitRoll(session, command);
      case "declare": return this._declare(session, command, false);
      case "respond": return this._declare(session, command, true);
      case "approveOutcome": return this._approveOutcome(session, command);
      case "advanceSegment": return this._advanceSegment(session);
      case "endSession": return this._endSession(session, command.payload?.reason);
      default: throw new MeleeValidationError(`Unknown melee command: ${command.type}`, "UNKNOWN_COMMAND");
    }
  }

  static _submitRoll(session, command) {
    const side = command.side;
    const expected = side === "attacker" ? "awaitingAttackerRoll" : "awaitingDefenderRoll";
    if (session.phase !== expected) throw new MeleeValidationError("Roll submitted in the wrong phase", "WRONG_PHASE");
    session.pools[side] = normalizeMeleePool(command.payload?.dice);
    session.phase = side === "attacker" ? "awaitingDefenderRoll" : "declaration";
    return { side, dice: clone(session.pools[side]) };
  }

  static async _declare(session, command, responder) {
    if (session.phase !== (responder ? "response" : "declaration")) {
      throw new MeleeValidationError("Action submitted in the wrong phase", "WRONG_PHASE");
    }
    const expectedSide = responder
      ? (initiativeSide(session) === "attacker" ? "defender" : "attacker")
      : initiativeSide(session);
    if (command.side !== expectedSide) throw new MeleeValidationError("Wrong participant for this phase", "WRONG_SIDE");
    const actorDoc = await fromUuid(session.participants[command.side].tokenUuid || session.participants[command.side].actorUuid);
    const actor = actorDoc?.actor ?? actorDoc;
    const reference = command.payload?.activity;
    const activity = MeleeActionCatalog.findExact(actor, reference || {}, {
      item: reference?.sourceItemUuid ? await fromUuid(reference.sourceItemUuid) : null
    });
    if (!activity) throw new MeleeValidationError("Exact melee activity not found", "ACTIVITY_NOT_FOUND", reference);
    const requiredRole = responder ? "responder" : "owner";
    if (!["either", requiredRole].includes(activity.activation.role) ||
        ![responder ? "response" : "declaration", "either"].includes(activity.activation.timing)) {
      throw new MeleeValidationError("Activity is unavailable in this phase", "WRONG_ACTIVITY_TIMING");
    }
    const diceIds = [...new Set(array(command.payload?.diceIds))];
    const selectedDice = MeleeResolver._selectedDice(session, command.side, diceIds);
    if (diceIds.length < activity.activation.minDice || diceIds.length > activity.activation.maxDice) {
      throw new MeleeValidationError("Invalid number of dice for activity", "INVALID_DICE_COST");
    }
    const successPoints = selectedDice.filter(die => die.isSuccess).length;
    if (successPoints < activity.activation.successCost) {
      throw new MeleeValidationError("Activity costs more successes than selected", "INSUFFICIENT_SUCCESSES");
    }
    const occupiedSegments = Math.max(1, diceIds.length, activity.activation.segmentCost);
    if (session.currentSegment + occupiedSegments > 3) {
      throw new MeleeValidationError("Not enough segments remain", "INSUFFICIENT_SEGMENTS");
    }
    const targetSide = command.side === "attacker" ? "defender" : "attacker";
    const targetDoc = await fromUuid(session.participants[targetSide].tokenUuid || session.participants[targetSide].actorUuid);
    const target = targetDoc?.actor ?? targetDoc;
    if (!evaluateMeleeConditions(activity.conditions, {
      session, side: command.side, actor, target, activity, selectedDice, successPoints
    })) throw new MeleeValidationError("Activity conditions are not met", "CONDITIONS_NOT_MET");
    const instance = createMeleeActionInstance(activity, {
      side: command.side, actorUuid: actor.uuid, selectedDiceIds: diceIds,
      segmentIndex: session.currentSegment, targetUuids: [target?.uuid].filter(Boolean)
    });
    session.actionInstances[instance.id] = instance;
    session.metadata.activityUses ??= {};
    session.metadata.activityUses[activity.id] = number(session.metadata.activityUses[activity.id]) + 1;
    session.declarations[responder ? "responder" : "owner"] = instance.id;
    session.phase = responder ? "resolution" : "response";
    if (!responder) return clone(instance);

    const ownerAction = session.actionInstances[session.declarations.owner];
    const initiativeBefore = session.initiative.ownerId;
    const resolution = MeleeResolver.resolve(session, ownerAction, instance);
    if (session.initiative.ownerId !== initiativeBefore) {
      await MeleeEffectService.expire(session, "initiativeChange", {
        previousOwnerId: initiativeBefore,
        ownerId: session.initiative.ownerId
      });
    }
    session.pendingOutcomes.push(...resolution.pending);
    for (const die of MeleeResolver._selectedDice(session, ownerAction.side, ownerAction.selectedDiceIds)) die.used = true;
    for (const die of MeleeResolver._selectedDice(session, instance.side, instance.selectedDiceIds)) die.used = true;
    const segment = session.segments[session.currentSegment];
    segment.ownerActionId = ownerAction.id;
    segment.responderActionId = instance.id;
    segment.ownerDiceIds = [...ownerAction.selectedDiceIds];
    segment.responderDiceIds = [...instance.selectedDiceIds];
    segment.outcomeIds = resolution.pending.map(outcome => outcome.id);
    segment.state = "resolved";
    segment.span = Math.max(
      1,
      ownerAction.selectedDiceIds.length,
      instance.selectedDiceIds.length,
      ownerAction.definition.activation.segmentCost,
      instance.definition.activation.segmentCost
    );
    for (let offset = 1; offset < segment.span; offset++) {
      const occupied = session.segments[session.currentSegment + offset];
      if (occupied) occupied.state = "resolved";
    }
    session.phase = resolution.pending.length ? "pendingOutcomes" : "resolution";
    for (const outcome of resolution.pending.filter(entry => entry.approval === "automatic")) {
      await this._applyOutcome(session, outcome);
    }
    if (session.pendingOutcomes.every(outcome => outcome.status === "applied")) session.phase = "resolution";
    return resolution;
  }

  static async _approveOutcome(session, command) {
    if (session.phase !== "pendingOutcomes") throw new MeleeValidationError("No outcomes await approval", "WRONG_PHASE");
    const outcome = session.pendingOutcomes.find(entry => entry.id === command.payload?.outcomeId);
    if (!outcome || outcome.status !== "pending") throw new MeleeValidationError("Pending outcome not found", "OUTCOME_NOT_FOUND");
    await this._applyOutcome(session, outcome);
    if (session.pendingOutcomes.every(entry => entry.status === "applied")) session.phase = "resolution";
    return clone(outcome);
  }

  static async _applyOutcome(session, outcome) {
    const action = session.actionInstances[outcome.actionInstanceId];
    const side = action.side;
    const targetSide = side === "attacker" ? "defender" : "attacker";
    const actorDoc = await fromUuid(session.participants[side].tokenUuid || session.participants[side].actorUuid);
    const targetDoc = await fromUuid(session.participants[targetSide].tokenUuid || session.participants[targetSide].actorUuid);
    const result = await MeleeOperationRunner.runOutcome(session, outcome, {
      action, actor: actorDoc?.actor ?? actorDoc, target: targetDoc?.actor ?? targetDoc,
      actors: { [side]: actorDoc?.actor ?? actorDoc, [targetSide]: targetDoc?.actor ?? targetDoc },
      successPoints: outcome.data.difference, location: outcome.data.location
    });
    await MeleeEffectService.expire(session, "actionResolved", { actionInstanceId: action.id });
    return result;
  }

  static async _advanceSegment(session) {
    if (session.phase !== "resolution") throw new MeleeValidationError("Segment cannot advance yet", "WRONG_PHASE");
    await MeleeEffectService.expire(session, "segmentEnd", { segmentIndex: session.currentSegment });
    session.currentSegment += Math.max(1, number(session.segments[session.currentSegment]?.span, 1));
    session.declarations = { owner: null, responder: null };
    if (session.currentSegment >= 3 || MELEE_SIDES.every(side => session.pools[side].every(die => die.used && !die.reusable))) {
      return this._endSession(session, "segmentsComplete");
    }
    session.segments[session.currentSegment].state = "active";
    session.phase = "declaration";
    await MeleeEffectService.expire(session, "segmentStart", { segmentIndex: session.currentSegment });
    return { segmentIndex: session.currentSegment };
  }

  static async _endSession(session, reason = "manual") {
    session.status = "complete";
    session.phase = "complete";
    session.endReason = reason || "manual";
    await MeleeEffectService.expire(session, "sessionEnd", {});
    return { reason: session.endReason };
  }
}

export class MeleeMigration {
  static audit({ actors = game.actors, items = game.items, combats = game.combats, messages = game.messages } = {}) {
    const report = { actors: 0, beastActivities: 0, effectActions: 0, legacyCombats: 0, legacyMessages: 0, warnings: [] };
    const seenItems = new Set();
    for (const actor of actors ?? []) {
      report.actors++;
      for (const item of actor.items ?? []) {
        seenItems.add(item.uuid);
        if (["beast-action", "beast-segment"].includes(item.type)) report.beastActivities += array(item.system.activities).length;
      }
      for (const effect of actor.effects ?? []) report.effectActions += array(effect.system?.actionDefs).length;
    }
    for (const item of items ?? []) {
      if (seenItems.has(item.uuid)) continue;
      if (["beast-action", "beast-segment"].includes(item.type)) report.beastActivities += array(item.system.activities).length;
      for (const effect of item.effects ?? []) report.effectActions += array(effect.system?.actionDefs).length;
    }
    for (const combat of combats ?? []) {
      if (combat.getFlag("neuroshima", "meleeEncounters") || combat.getFlag("neuroshima", "meleeGroups")) report.legacyCombats++;
    }
    for (const message of messages ?? []) {
      if (message.getFlag("neuroshima", "duelCard") || message.getFlag("neuroshima", "opposedResult")) report.legacyMessages++;
    }
    return report;
  }

  static dryRun(options = {}) {
    return { mode: "dry-run", writes: 0, ...this.audit(options), legacyPreserved: true };
  }

  static async migrate({ confirm = false, actors = game.actors, items = game.items } = {}) {
    if (!game.user?.isGM) throw new MeleeValidationError("Only a GM may migrate melee data", "GM_REQUIRED");
    if (confirm !== true) return this.dryRun({ actors });
    let updated = 0;
    const documents = [];
    for (const actor of actors ?? []) {
      documents.push(...array(actor.items));
      for (const effect of actor.effects ?? []) {
        const existing = array(effect.system?.melee?.grantedActivities);
        if (existing.length || !array(effect.system?.actionDefs).length) continue;
        await effect.update({ "system.melee.grantedActivities": array(effect.system.actionDefs)
          .filter(entry => entry.type !== "result")
          .map(entry => normalizeMeleeActivity(entry, { kind: "effect", effectUuid: effect.uuid })) });
        updated++;
      }
    }
    documents.push(...array(items));
    const seen = new Set();
    for (const item of documents) {
      if (!item?.uuid || seen.has(item.uuid)) continue;
      seen.add(item.uuid);
      if (["beast-action", "beast-segment"].includes(item.type) &&
          Number(item.getFlag("neuroshima", "meleeSchemaVersion") ?? 0) < MELEE_VERSION) {
        const activities = array(item.system.activities).map(activity => {
          const raw = activity.toObject?.() ?? clone(activity);
          const normalized = normalizeMeleeActivity({
            ...raw,
            category: "beast",
            activation: {
              ...(raw.activation ?? {}),
              successCost: raw.costType === "success" ? number(raw.successCost, 1) : 0,
              segmentCost: raw.costType === "segment" ? number(raw.segmentCost, 1) : 0
            },
            operations: array(raw.operations).length ? raw.operations : legacyBeastOperations(item, raw)
          }, { kind: "beast", uuid: `${item.uuid}#${raw.id}`, itemUuid: item.uuid });
          return {
            ...raw,
            description: normalized.description,
            tags: normalized.tags,
            activation: normalized.activation,
            conditions: normalized.conditions,
            outcomes: normalized.outcomes,
            operations: normalized.operations,
            automation: normalized.automation
          };
        });
        await item.update({ "system.activities": activities });
        await item.setFlag("neuroshima", "meleeSchemaVersion", MELEE_VERSION);
        updated++;
      }
      for (const effect of array(item.effects)) {
        if (array(effect.system?.melee?.grantedActivities).length || !array(effect.system?.actionDefs).length) continue;
        await effect.update({ "system.melee.grantedActivities": array(effect.system.actionDefs)
          .filter(entry => entry.type !== "result")
          .map(entry => normalizeMeleeActivity(entry, { kind: "effect", effectUuid: effect.uuid })) });
        updated++;
      }
    }
    return { mode: "migrate", updated, legacyPreserved: true };
  }
}

class MeleeStartService {
  static _queues = new Map();

  static run(startCommandId, operation) {
    const key = String(startCommandId || randomId());
    const previous = this._queues.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    const tail = pending.catch(() => undefined);
    this._queues.set(key, tail);
    tail.finally(() => {
      if (this._queues.get(key) === tail) this._queues.delete(key);
    });
    return pending;
  }
}

export async function startMeleeSession({
  attacker, defender, initiativeOwnerId, metadata = {}, startCommandId = randomId()
} = {}) {
  if (!game.user?.isGM) {
    throw new MeleeValidationError("Session creation must be requested through the GM", "GM_REQUIRED");
  }
  return MeleeStartService.run(startCommandId, async () => {
    const existing = MeleeSessionStore.list(game.combat).find(candidate =>
      candidate.metadata?.startCommandId === startCommandId
    );
    if (existing) {
      const existingMessage = game.messages.get(existing.messageId);
      if (existingMessage) {
        await existingMessage.update({ "flags.neuroshima.melee.renderNonce": randomId() });
      }
      Hooks.callAll("neuroshimaMeleeSessionUpdated", clone(existing), { type: "resumeSession" }, null);
      return existing;
    }

    const session = createMeleeSession({
      attacker,
      defender,
      initiativeOwnerId,
      combatId: game.combat?.id ?? null,
      metadata: { ...metadata, startCommandId }
    });
    const content = [
      `<div class="neuroshima melee-session-v2-shell" data-melee-session-id="${session.id}">`,
      '<p class="melee-v2-loading"><i class="fa-solid fa-spinner fa-spin"></i> Inicjalizacja zwarcia…</p>',
      "</div>"
    ].join("");
    const attackerDoc = await fromUuid(attacker.tokenUuid || attacker.actorUuid);
    let message = null;
    try {
      message = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attackerDoc?.actor ?? attackerDoc }),
        content,
        flags: { neuroshima: { melee: { sessionId: session.id, renderedRevision: -1, cardType: "session" } } }
      });
      session.messageId = message.id;
      await MeleeSessionStore.create(session, { combat: game.combat, message });
      // The creation hook may run before the Combat flag exists. This explicit
      // update guarantees a second render after the authoritative save.
      await message.update({
        content,
        "flags.neuroshima.melee.renderedRevision": session.revision,
        "flags.neuroshima.melee.renderNonce": randomId()
      });
      Hooks.callAll("neuroshimaMeleeSessionUpdated", clone(session), { type: "startSession" }, null);
      return session;
    } catch (error) {
      if (message) {
        await message.update({
          content: `<div class="neuroshima melee-session-v2-shell melee-v2-error" data-melee-session-id="${session.id}"><p>Nie udało się uruchomić zwarcia. Szczegóły zostały pokazane użytkownikowi.</p></div>`
        }).catch(() => undefined);
      }
      throw error;
    }
  });
}

export function registerMeleeSystemSettings() {
  game.settings.register("neuroshima", MELEE_SETTING, {
    name: "NEUROSHIMA.Settings.MeleeEngineV2.Name",
    hint: "NEUROSHIMA.Settings.MeleeEngineV2.Hint",
    scope: "world", config: true, type: Boolean, default: false, requiresReload: true
  });
}

export function isMeleeV2Enabled() {
  try { return game.settings.get("neuroshima", MELEE_SETTING) === true; }
  catch (_error) { return false; }
}

export async function expireMeleeEffects(event, payload = {}, combat = game.combat) {
  if (!game.user?.isGM || !isMeleeV2Enabled() || !combat) return [];
  const results = [];
  for (const session of MeleeSessionStore.list(combat)) {
    const revision = session.revision;
    const removed = await MeleeEffectService.expire(session, event, payload);
    if (!removed.length) continue;
    await MeleeSessionStore.save(session, { expectedRevision: revision, combat });
    results.push({ sessionId: session.id, removed });
  }
  return results;
}

export function registerMeleeSystem() {
  const api = {
    version: MELEE_VERSION,
    enabled: isMeleeV2Enabled,
    start: startMeleeSession,
    requestStart: payload => {
      const request = { ...payload, startCommandId: payload?.startCommandId || randomId() };
      return game.user.isGM
      ? startMeleeSession(request)
      : game.neuroshima.socket.executeAsGM(MELEE_SOCKET_COMMAND, {
          type: "startSession", userId: game.user.id, payload: request
        });
    },
    createSession: createMeleeSession,
    participant: meleeParticipantFromActor,
    sideForActor,
    requiredAction: buildMeleeRequiredAction,
    get: (...args) => MeleeSessionStore.get(...args),
    list: (...args) => MeleeSessionStore.list(...args),
    dispatch: command => game.user.isGM
      ? MeleeCommandService.dispatch({ ...command, userId: command.userId || game.user.id })
      : game.neuroshima.socket.executeAsGM(MELEE_SOCKET_COMMAND, { ...command, userId: game.user.id }),
    catalog: MeleeActionCatalog,
    conditions: MeleeConditionRegistry,
    operations: MeleeOperationRegistry,
    effects: MeleeEffectService,
    migration: MeleeMigration
  };
  game.neuroshima = Object.assign(game.neuroshima || {}, { melee: api });
  return api;
}

export function registerMeleeSocket(socket) {
  socket.register(MELEE_SOCKET_COMMAND, async command => {
    if (command?.type === "startSession") {
      const requester = game.users.get(command.userId);
      if (!requester?.active) throw new MeleeValidationError("Inactive or unknown user", "UNAUTHORIZED");
      if (!await userControlsMeleeParticipant(command.payload?.attacker, requester)) {
        throw new MeleeValidationError("User does not own the attacker", "UNAUTHORIZED");
      }
      return startMeleeSession(command.payload);
    }
    return MeleeCommandService.dispatch(command);
  });
}

/** Pure smoke suite, hosted here to avoid adding another test runtime file. */
export async function runMeleeCoreSelfTests() {
  let passed = 0;
  const assert = (condition, message) => { if (!condition) throw new Error(message); passed++; };
  const attacker = { actorUuid: "Actor.a", name: "A" };
  const defender = { actorUuid: "Actor.b", name: "B" };
  const session = createMeleeSession({ attacker, defender });
  assert(session.segments.length === 3, "three segment invariant");
  session.pools.attacker = normalizeMeleePool([{ raw: 1, isSuccess: true }, { raw: 10 }, { raw: 20 }]);
  assert(session.pools.attacker.length === 3, "three dice invariant");
  session.pools.attacker[0].used = true;
  let reuseRejected = false;
  try { MeleeResolver._selectedDice(session, "attacker", [session.pools.attacker[0].id]); }
  catch (error) { reuseRejected = error.code === "DIE_ALREADY_USED"; }
  assert(reuseRejected, "used die rejected");
  transferMeleeInitiative(session, defender.actorUuid, "test");
  assert(session.initiative.ownerId === defender.actorUuid, "engagement initiative transfer");
  const activity = normalizeMeleeActivity({ id: "x", minDice: 1, maxDice: 2, successCost: 1 });
  assert(activity.activation.successCost === 1, "activity normalization");
  const operationIds = new Set(["a", "b", "c"].map(id => `${session.id}:o:${id}`));
  assert(operationIds.size === 3, "operation ids stable and unique");
  let invalidPoolRejected = false;
  try { normalizeMeleePool([{ raw: 1 }, { raw: 2 }]); }
  catch (error) { invalidPoolRejected = error.code === "INVALID_DICE_POOL"; }
  assert(invalidPoolRejected, "pool other than 3d20 rejected");
  let duplicateRejected = false;
  try { normalizeMeleePool([{ id: "x" }, { id: "x" }, { id: "y" }]); }
  catch (error) { duplicateRejected = error.code === "DUPLICATE_DIE_ID"; }
  assert(duplicateRejected, "duplicate die identity rejected");
  const other = createMeleeSession({ attacker, defender });
  assert(other.initiative.ownerId === attacker.actorUuid && session.initiative.ownerId === defender.actorUuid,
    "initiative is independent per engagement");
  const costly = normalizeMeleeActivity({ id: "cost", costType: "segment", segmentCost: 3, successCost: 1 });
  assert(costly.activation.segmentCost === 3 && costly.activation.successCost === 1,
    "success and segment costs remain independent");
  const beastItem = {
    id: "beast", uuid: "Actor.a.Item.beast", type: "beast-action", name: "Bite", img: "bite.webp",
    system: { activities: [{ id: "bite-1", name: "Bite", costType: "success", successCost: 2, damage: "C" }] }
  };
  const beasts = MeleeActionCatalog.fromBeastItem(beastItem);
  assert(beasts.length === 1 && beasts[0].id === "bite-1" && beasts[0].source.itemUuid === beastItem.uuid,
    "beast activity keeps stable item and activity identity");
  assert(beasts[0].operations.some(operation => operation.type === "damage"), "legacy beast damage adapted to operation");
  assert(evaluateMeleeConditions({ key: "all", conditions: ["always", { key: "not", condition: { key: "phase", value: "complete" } }] }, { session }),
    "nested condition tree evaluates");
  assert(MeleeConditionRegistry.get("resource")?.fields?.length > 0 &&
    typeof MeleeConditionRegistry.get("resource")?.summarize === "function",
    "condition definitions expose GUI and summary metadata");
  assert(["damage", "modifyDamage", "applyEffect", "removeEffect", "requiredTest", "transferInitiative",
    "modifyDie", "modifyTarget", "spendResource", "recoverResource", "scheduleOutcome", "followUp",
    "movement", "endEngagement", "chatEntry"].every(key => MeleeOperationRegistry.has(key)),
    "minimum operation registry complete");
  const dryRun = MeleeMigration.dryRun({ actors: [], items: [], combats: [], messages: [] });
  assert(dryRun.writes === 0 && dryRun.legacyPreserved === true, "migration dry-run performs no writes");
  let invalidSessionRejected = false;
  const broken = clone(other);
  broken.segments.pop();
  try { validateMeleeSession(broken); }
  catch (_error) { invalidSessionRejected = true; }
  assert(invalidSessionRejected, "invalid session schema rejected");
  assert(MELEE_PHASES.includes("pendingOutcomes") && session.operationLedger && session.commandLedger,
    "two-phase and idempotency ledgers present");
  const secondPool = normalizeMeleePool([{ raw: 2, isSuccess: true }, { raw: 12 }, { raw: 18 }]);
  assert(secondPool.length === 3 && session.pools.attacker.length === 3, "both melee sides use 3d20");
  assert(secondPool.every((die, index) => die.id && die.index === index), "dice retain stable IDs and indices");
  assert(costly.activation.successCost === 1 && costly.activation.segmentCost === 3, "one success can reserve three segments");
  const segmentOnly = normalizeMeleeActivity({ id: "segment-only", costType: "segment", segmentCost: 2, successCost: 0 });
  assert(segmentOnly.activation.successCost === 0, "segment action may require no success");
  assert(!("initiative" in (session.metadata.combatant ?? {})), "session initiative does not write global initiative");
  assert(session.initiative.previousOwnerId === attacker.actorUuid, "initiative change keeps previous owner");
  assert(["attack", "defense", "exit", "flee", "nonCombat"].every(id =>
    MeleeActionCatalog.coreActivities({ uuid: "Actor.a" }).some(entry => entry.id === id)),
  "core activities include attack defense non-combat exit and flee");
  const reaction = normalizeMeleeActivity({ id: "reaction", category: "reaction", timing: "response" });
  assert(reaction.category === "reaction" && reaction.activation.timing === "response", "reaction activity supported");
  const modifierEffect = {
    uuid: "Effect.mod", disabled: false,
    system: { actionDefs: [], melee: { grantedActivities: [], restrictions: [], modifiers: [
      { activityId: "attack", path: "activation.successCost", mode: "add", value: 1 }
    ] } }
  };
  const modifiedCatalog = MeleeActionCatalog.collect({ uuid: "Actor.mod", items: [], effects: [modifierEffect] });
  assert(modifiedCatalog.find(entry => entry.id === "attack").activation.successCost === 1,
    "effect modifier changes an existing activity without adding one");
  assert(MeleeOperationRegistry.has("followUp"), "follow-up operation available");
  const onceContext = {
    session: { ...session, actionInstances: {} },
    activity: { id: "once" }, target: { uuid: "Actor.b" }
  };
  assert(evaluateMeleeConditions([{ key: "oncePerOpponent" }], onceContext), "once-per-target initially available");
  onceContext.session.actionInstances.used = { activityId: "once", targetUuids: ["Actor.b"] };
  assert(!evaluateMeleeConditions([{ key: "oncePerOpponent" }], onceContext), "once-per-target blocks repeated use");
  const statusActor = { effects: [{ statuses: new Set(["grabbed"]), getFlag: () => null }] };
  assert(evaluateMeleeConditions([{ key: "grabbed" }], { actor: statusActor }), "actor status condition supported");
  const equalCostItem = { ...beastItem, system: { activities: [
    { id: "a1", name: "A", costType: "success", successCost: 1 },
    { id: "a2", name: "B", costType: "success", successCost: 1 }
  ] } };
  const equalActions = MeleeActionCatalog.fromBeastItem(equalCostItem);
  assert(equalActions.length === 2 && equalActions[0].id !== equalActions[1].id,
    "beast activities with equal costs remain separately selectable by ID");
  const required = normalizeMeleeActivity({ id: "test", outcomes: [
    { id: "success", when: "testSuccess", operations: [{ type: "applyEffect" }] },
    { id: "failure", when: "testFailure", operations: [{ type: "applyEffect" }] }
  ] });
  assert(required.outcomes.some(entry => entry.when === "testSuccess") && required.outcomes.some(entry => entry.when === "testFailure"),
    "required tests can define separate success and failure outcomes");
  const defenseSession = createMeleeSession({ attacker, defender });
  defenseSession.phase = "resolution";
  defenseSession.pools.attacker = normalizeMeleePool([
    { raw: 1, isSuccess: true }, { raw: 18, isSuccess: false }, { raw: 19, isSuccess: false }
  ]);
  defenseSession.pools.defender = normalizeMeleePool([
    { raw: 1, isSuccess: true }, { raw: 2, isSuccess: true }, { raw: 19, isSuccess: false }
  ]);
  const attackDefinition = normalizeMeleeActivity({
    id: "effect-hit", category: "attack", timing: "either",
    outcomes: [{ id: "apply", when: "hit", operations: [{ id: "effect", type: "applyEffect" }] }]
  });
  const defenseDefinition = normalizeMeleeActivity({ id: "block", category: "defense", timing: "either" });
  const attackInstance = createMeleeActionInstance(attackDefinition, {
    side: "attacker", actorUuid: attacker.actorUuid,
    selectedDiceIds: defenseSession.pools.attacker.map(die => die.id)
  });
  const defenseInstance = createMeleeActionInstance(defenseDefinition, {
    side: "defender", actorUuid: defender.actorUuid,
    selectedDiceIds: defenseSession.pools.defender.map(die => die.id)
  });
  const defended = MeleeResolver.resolve(defenseSession, attackInstance, defenseInstance);
  assert(defended.winner === "defender" && defended.pending.length === 0,
    "successful defense neither applies nor queues attack effect");
  assert(defenseSession.initiative.ownerId === defender.actorUuid,
    "failed attack transfers only engagement initiative");
  const snapshotSource = normalizeMeleeActivity({ id: "snapshot", name: "Before" });
  const snapshot = createMeleeActionInstance(snapshotSource, { side: "attacker", actorUuid: "Actor.a" });
  snapshotSource.name = "After";
  assert(snapshot.definition.name === "Before", "action instance is immutable from later Item edits");
  let idempotentRuns = 0;
  registerMeleeOperation("selfTestIdempotent", async () => ({ run: ++idempotentRuns }));
  const ledgerSession = createMeleeSession({ attacker, defender });
  const ledgerOutcome = normalizePendingOutcome({ id: "outcome", operations: [{ id: "operation", type: "selfTestIdempotent" }] });
  await MeleeOperationRunner.runOutcome(ledgerSession, ledgerOutcome, {});
  await MeleeOperationRunner.runOutcome(ledgerSession, ledgerOutcome, {});
  assert(idempotentRuns === 1, "rerender or double apply does not repeat an operation");
  let retryRuns = 0;
  registerMeleeOperation("selfTestRetry", async () => {
    retryRuns++;
    if (retryRuns === 1) throw new Error("expected test failure");
    return true;
  });
  const retryOutcome = normalizePendingOutcome({ id: "retry", operations: [{ id: "retry-op", type: "selfTestRetry" }] });
  try { await MeleeOperationRunner.runOutcome(ledgerSession, retryOutcome, {}); } catch (_error) { /* expected */ }
  await MeleeOperationRunner.runOutcome(ledgerSession, retryOutcome, {});
  assert(retryRuns === 2 && retryOutcome.status === "applied", "failed operation can be retried once");
  let unauthorized = false;
  try { MeleeCommandService._authorize(session, { side: "attacker" }, { id: "intruder", active: true, isGM: false }); }
  catch (error) { unauthorized = error.code === "UNAUTHORIZED"; }
  assert(unauthorized, "non-owner command rejected");
  MeleeCommandService._authorize(session, { side: "attacker" }, { id: "gm", active: true, isGM: true });
  assert(true, "GM command accepted");
  let staleRejected = false;
  try { validateMeleeRevision(4, 3); } catch (error) { staleRejected = error.code === "STALE_REVISION"; }
  assert(staleRejected && validateMeleeRevision(4, 4), "stale revision rejected and current revision accepted");
  const grantedEffect = {
    uuid: "Effect.grant", disabled: false,
    system: { actionDefs: [], melee: { restrictions: [], modifiers: [], grantedActivities: [{ id: "grant", name: "Granted" }] } }
  };
  const grantActor = { uuid: "Actor.grant", items: [], effects: [grantedEffect] };
  assert(MeleeActionCatalog.collect(grantActor).some(entry => entry.id === "grant"), "active effect grants activity");
  grantedEffect.disabled = true;
  assert(!MeleeActionCatalog.collect(grantActor).some(entry => entry.id === "grant"), "ending effect removes granted activity");

  const makeEffectTarget = () => {
    const target = {
      uuid: "Actor.target", effects: [], deleted: [],
      async createEmbeddedDocuments(_type, sources) {
        const created = sources.map((source, index) => ({
          id: `created-${index}-${this.effects.length}`, uuid: `Actor.target.ActiveEffect.${index}-${this.effects.length}`,
          flags: source.flags, duration: source.duration,
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
          async update(changes) { Object.assign(this, changes); }
        }));
        this.effects.push(...created);
        return created;
      },
      async deleteEmbeddedDocuments(_type, ids) {
        this.deleted.push(...ids);
        this.effects = this.effects.filter(effect => !ids.includes(effect.id));
      }
    };
    return target;
  };
  const template = {
    uuid: "Item.template.ActiveEffect.effect", system: { melee: { stackKey: "bleed", stackMode: "ignore", expiryRules: [] } },
    duration: {}, toObject: () => ({ name: "Bleed", flags: {}, duration: {} })
  };
  const ignoreTarget = makeEffectTarget();
  await MeleeEffectService.applyTemplate(template, ignoreTarget, { session: ledgerSession });
  await MeleeEffectService.applyTemplate(template, ignoreTarget, { session: ledgerSession });
  assert(ignoreTarget.effects.length === 1, "ignore stacking prevents duplicate effect");
  const stackTarget = makeEffectTarget();
  await MeleeEffectService.applyTemplate(template, stackTarget, { stackMode: "stack" });
  await MeleeEffectService.applyTemplate(template, stackTarget, { stackMode: "stack" });
  assert(stackTarget.effects.length === 2, "stack policy permits multiple effects");
  const replaceTarget = makeEffectTarget();
  await MeleeEffectService.applyTemplate(template, replaceTarget, {});
  await MeleeEffectService.applyTemplate(template, replaceTarget, { stackMode: "replace" });
  assert(replaceTarget.effects.length === 1 && replaceTarget.deleted.length === 1, "replace policy removes prior effect");
  const refreshTarget = makeEffectTarget();
  const refreshed = await MeleeEffectService.applyTemplate(template, refreshTarget, {});
  await MeleeEffectService.applyTemplate(template, refreshTarget, { stackMode: "refresh", duration: { rounds: 3 } });
  assert(refreshed.duration.rounds === 3 && refreshTarget.effects.length === 1, "refresh policy updates duration");
  const priorFromUuid = globalThis.fromUuid;
  let expired = 0;
  globalThis.fromUuid = async () => ({ delete: async () => { expired++; } });
  const expirySession = createMeleeSession({ attacker, defender });
  expirySession.effects = [
    { effectUuid: "Effect.segment", expiryRules: [{ event: "segmentEnd" }] },
    { effectUuid: "Effect.initiative", expiryRules: [{ event: "initiativeChange" }] },
    { effectUuid: "Effect.damage", expiryRules: [{ event: "damageApplied" }] }
  ];
  await MeleeEffectService.expire(expirySession, "segmentEnd", {});
  await MeleeEffectService.expire(expirySession, "initiativeChange", {});
  await MeleeEffectService.expire(expirySession, "damageApplied", {});
  if (priorFromUuid) globalThis.fromUuid = priorFromUuid; else delete globalThis.fromUuid;
  assert(expired === 3 && expirySession.effects.length === 0, "effects expire on segment initiative and damage events");
  return { passed, failed: 0 };
}
