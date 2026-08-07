/**
 * Canonical Neuroshima melee engine.
 *
 * This module is deliberately the single domain boundary for melee.  It owns
 * the session schema, activity catalogue, conditions, outcomes, operations,
 * effect lifetime, persistence, migration and the authoritative command bus.
 * Rendering lives in melee-system-ui.js; global Foundry initiative remains in
 * the normal Combat/Combatant documents and is never written here.
 */

import { DuelContext, DuelLifecycle, DuelDeclarationEngine, DuelSegmentEngine } from "./combat-api.js";

export const MELEE_VERSION = 2;
export const MELEE_FLAG = "meleeSessionsV2";
export const MELEE_WORLD_STORE_SETTING = "meleeSessionsV2World";
export const MELEE_SOCKET_COMMAND = "dispatchMeleeCommand";
export const MELEE_SIDES = Object.freeze(["attacker", "defender"]);
export const MELEE_PHASES = Object.freeze([
  "awaitingAttackerRoll", "awaitingDefenderRoll", "declaration",
  "response", "resolution", "pendingOutcomes", "complete"
]);

/** Canonical chat marker; the older engine value is accepted only on read. */
export function isMeleeSessionMarker(marker) {
  return Boolean(marker?.sessionId && (
    marker.engine == null || ["session", "v2"].includes(marker.engine)
  ));
}

/** Canonical test link; the older type is accepted only on read. */
export function isMeleeSessionLink(link) {
  return Boolean(link?.sessionId && ["meleeSession", "meleeSessionV2"].includes(link.type));
}

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
function meleeRuntimeValues(context = {}) {
  const selectedDice = array(context.selectedDice);
  return {
    parameters: context.parameters ?? context.action?.parameters ?? {},
    selectedDiceCount: selectedDice.length,
    selectedSuccesses: selectedDice.filter(die => die.isSuccess).length,
    occupiedSegments: context.occupiedSegments ?? Math.max(
      1,
      selectedDice.length,
      number(context.activity?.activation?.segmentCost ?? context.action?.definition?.activation?.segmentCost)
    ),
    currentSegment: number(context.session?.exchange?.currentSegment),
    initiativeOwner: context.session?.initiative?.ownerId ?? null
  };
}
function resolveMeleeRuntimeValue(value, context = {}) {
  if (Array.isArray(value)) return value.map(entry => resolveMeleeRuntimeValue(entry, context));
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, resolveMeleeRuntimeValue(entry, context)])
  );
  if (typeof value !== "string" || !value.startsWith("@")) return value;
  const path = value.slice(1).split(".");
  let resolved = meleeRuntimeValues(context);
  for (const part of path) {
    if (!resolved || typeof resolved !== "object" || !Object.hasOwn(resolved, part)) return value;
    resolved = resolved[part];
  }
  return clone(resolved);
}
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
  const modified = number(data.modified ?? data.result, raw);
  const state = data.state || (data.used ? "spent" : data.reservedByActionId ? "reserved" : "available");
  return {
    id: String(data.id || `die-${index + 1}-${randomId()}`),
    index,
    raw,
    modified,
    result: modified,
    target: number(data.target, 0),
    isSuccess: data.isSuccess === true,
    successPoints: Math.max(0, number(data.successPoints, data.isSuccess === true ? 1 : 0)),
    state,
    reservedByActionId: data.reservedByActionId ?? null,
    spentAtSegment: data.spentAtSegment ?? null,
    used: state === "spent",
    reusable: data.reusable === true,
    segmentId: data.segmentId ?? null,
    changes: array(data.changes).map(clone)
  };
}

export function normalizeMeleePool(pool = []) {
  if (!Array.isArray(pool) || pool.length < 1 || pool.length > 3) {
    throw new MeleeValidationError("Melee requires one, two or three dice", "INVALID_DICE_POOL");
  }
  const normalized = pool.map(createMeleeDie);
  if (new Set(normalized.map(die => die.id)).size !== normalized.length) {
    throw new MeleeValidationError("Melee die IDs must be unique", "DUPLICATE_DIE_ID");
  }
  return normalized;
}

export function meleePoolDice(session, side) {
  const pool = session?.pools?.[side];
  return Array.isArray(pool) ? pool : array(pool?.dice);
}

function createEmptyMeleePool() {
  return { diceCount: 0, dice: [] };
}

function setMeleePool(session, side, dice) {
  const normalized = normalizeMeleePool(dice);
  session.pools[side] = { diceCount: normalized.length, dice: normalized };
  return normalized;
}

function meleeDieForDuelCard(die) {
  return {
    id: die.id,
    original: die.raw,
    modified: die.modified,
    isSuccess: die.isSuccess,
    isNat1: die.raw === 1,
    isNat20: die.raw === 20,
    changes: clone(die.changes ?? [])
  };
}

export function resolveMeleeHail(attackerDice, defenderDice, damageProfile = {}) {
  const attackerSuccesses = array(attackerDice).filter(die => die.isSuccess).length;
  const defenderSuccesses = array(defenderDice).filter(die => die.isSuccess).length;
  const netSuccesses = attackerSuccesses - defenderSuccesses;
  const tier = netSuccesses > 0 ? Math.min(3, netSuccesses) : 0;
  return {
    attackerSuccesses, defenderSuccesses, netSuccesses, tier,
    blocked: tier === 0,
    damage: tier ? damageProfile[tier] ?? damageProfile[1] ?? "?" : null,
    applied: false
  };
}

function createMeleeExchange(segmentCount = 3) {
  return {
    currentSegment: 0,
    declaration: null,
    segments: Array.from({ length: Math.min(3, Math.max(1, number(segmentCount, 3))) }, (_, index) => ({
      segNum: index + 1,
      attackVal: null,
      defenseVal: null,
      outcome: null,
      ownerActionId: null,
      responderActionId: null,
      ownerDiceIds: [],
      responderDiceIds: []
    })),
    hits: [],
    counterHits: [],
    history: [],
    future: []
  };
}

function exchangeSnapshot(session) {
  return clone({
    pools: session.pools,
    initiative: session.initiative,
    exchange: { ...session.exchange, history: [], future: [] },
    phase: session.phase,
    status: session.status,
    result: session.result ?? null,
    actionInstances: session.actionInstances,
    pendingOutcomes: session.pendingOutcomes,
    actions: session.actions
  });
}

function restoreExchangeSnapshot(session, snapshot) {
  for (const key of ["pools", "initiative", "exchange", "phase", "status", "result", "actionInstances", "pendingOutcomes", "actions"]) {
    session[key] = clone(snapshot[key]);
  }
}

/**
 * Runtime-only projection used by the established duel resolver while reading
 * and writing the single canonical MeleeSession. No duplicate state is persisted.
 */
export class MeleeExchangeContext {
  constructor(session) { this.session = session; }
  static fromSession(session) { return new MeleeExchangeContext(session); }

  getPool(side) { return meleePoolDice(this.session, side); }
  getDie(side, dieId) { return this.getPool(side).find(die => die.id === dieId) ?? null; }
  getAvailableDice(side) { return this.getPool(side).filter(die => die.state === "available"); }
  reserveDice(side, dieIds, actionId) {
    for (const dieId of dieIds) {
      const die = this.getDie(side, dieId);
      if (!die || die.state !== "available") throw new MeleeValidationError("Selected die is unavailable", "DIE_ALREADY_USED");
      die.state = "reserved";
      die.reservedByActionId = actionId;
      die.used = false;
    }
  }
  spendDice(side, dieIds, segment = this.getCurrentSegment()) {
    for (const dieId of dieIds) {
      const die = this.getDie(side, dieId);
      if (!die || die.state === "spent") throw new MeleeValidationError("Selected die is unavailable", "DIE_ALREADY_USED");
      die.state = "spent";
      die.reservedByActionId = null;
      die.spentAtSegment = segment;
      die.used = true;
    }
  }
  releaseDice(side, dieIds) {
    for (const dieId of dieIds) {
      const die = this.getDie(side, dieId);
      if (!die) continue;
      die.state = "available";
      die.reservedByActionId = null;
      die.spentAtSegment = null;
      die.used = false;
    }
  }
  getInitiativeOwnerSide() { return initiativeSide(this.session); }
  setInitiativeOwnerSide(side, reason = "duelResolver") {
    transferMeleeInitiative(this.session, this.session.participants[side].actorUuid, reason);
  }
  getCurrentSegment() { return number(this.session.exchange.currentSegment); }
  getDeclaration() { return this.session.exchange.declaration; }
  setDeclaration(declaration) { this.session.exchange.declaration = declaration ? clone(declaration) : null; }
  resolveSegment(result) { Object.assign(this.session.exchange.segments[this.getCurrentSegment()], clone(result)); }
  createSnapshot() { return exchangeSnapshot(this.session); }
  restoreSnapshot(snapshot) { restoreExchangeSnapshot(this.session, snapshot); }

  toDuelState() {
    const session = this.session;
    const exchange = session.exchange;
    const ownerSide = this.getInitiativeOwnerSide();
    const declaration = exchange.declaration;
    const idsToIndices = (side, ids = []) => ids.map(id => this.getPool(side).findIndex(die => die.id === id)).filter(index => index >= 0);
    const usedIndices = side => this.getPool(side).flatMap((die, index) => die.state === "spent" ? [index] : []);
    return {
      status: session.status === "complete" ? "done" : "picking",
      initiativeOwnerSide: ownerSide,
      isGradCios: session.variant === "gradCiosow",
      waitingFor: session.phase === "response" ? "responder" : "initiativeOwner",
      committedOwnerIndices: declaration ? idsToIndices(declaration.ownerSide, declaration.selectedDieIds) : null,
      currentSegment: exchange.currentSegment,
      attackerUuid: session.participants.attacker.actorUuid,
      attackerTokenUuid: session.participants.attacker.tokenUuid ?? null,
      defenderUuid: session.participants.defender.actorUuid,
      defenderTokenUuid: session.participants.defender.tokenUuid ?? null,
      attackerManeuver: session.metadata.attackerManeuver ?? null,
      defenderManeuver: session.metadata.defenderManeuver ?? null,
      weaponId: session.metadata.weaponId ?? null,
      beastItemId: session.metadata.beastItemId ?? null,
      attackDice: this.getPool("attacker").map(meleeDieForDuelCard),
      defenseDice: this.getPool("defender").map(meleeDieForDuelCard),
      attackTarget: session.metadata.attackerTarget ?? 0,
      defenseTarget: session.metadata.defenderTarget ?? 0,
      damage1: declaration?.damageSnapshot?.final?.[1] ?? session.metadata.damage1,
      damage2: declaration?.damageSnapshot?.final?.[2] ?? session.metadata.damage2,
      damage3: declaration?.damageSnapshot?.final?.[3] ?? session.metadata.damage3,
      location: session.metadata.location ?? null,
      headDamageApplied: session.metadata.headDamageApplied === true,
      defenderDamage1: session.metadata.defenderDamage1 ?? "D",
      defenderDamage2: session.metadata.defenderDamage2 ?? "L",
      defenderDamage3: session.metadata.defenderDamage3 ?? "K",
      usedAttackDice: usedIndices("attacker"),
      usedDefenseDice: usedIndices("defender"),
      segments: clone(exchange.segments),
      hits: clone(exchange.hits),
      counterHits: clone(exchange.counterHits),
      applied: session.result?.applied === true,
      segmentHistory: exchange.history.map((_snapshot, index) => ({ canonicalSnapshot: index })),
      segmentFuture: exchange.future.map((_snapshot, index) => ({ canonicalSnapshot: index })),
      declaredAction: declaration?.duelAction ?? null,
      committedTrickId: declaration?.activityInstanceId ?? null,
      committedTrickDamage: declaration?.damageSnapshot?.final?.[declaration?.selectedDieIds?.length] ?? null,
      committedBeastQueue: null,
      committedTrickQueue: null,
      opposedId: session.id,
      actions: clone(declaration?.duelActions ?? {}),
      activatedMeleePreRollMods: clone(session.metadata.activatedMeleePreRollMods ?? [])
    };
  }

  applyDuelState(state) {
    const session = this.session;
    const exchange = session.exchange;
    const ownerSide = state.initiativeOwnerSide === "defender" ? "defender" : "attacker";
    const used = {
      attacker: new Set(array(state.usedAttackDice).map(Number)),
      defender: new Set(array(state.usedDefenseDice).map(Number))
    };
    const committed = new Set(array(state.committedOwnerIndices).map(Number));
    for (const side of MELEE_SIDES) {
      this.getPool(side).forEach((die, index) => {
        const reserved = state.waitingFor === "responder" && side === ownerSide && committed.has(index);
        die.state = used[side].has(index) ? "spent" : reserved ? "reserved" : "available";
        die.used = die.state === "spent";
        die.reservedByActionId = reserved ? (exchange.declaration?.activityInstanceId ?? state.declaredAction) : null;
        die.spentAtSegment = die.state === "spent" ? number(state.currentSegment) : null;
      });
    }
    exchange.currentSegment = Math.min(2, number(state.currentSegment));
    exchange.segments = clone(state.segments ?? exchange.segments);
    exchange.hits = clone(state.hits ?? []);
    exchange.counterHits = clone(state.counterHits ?? []);
    if (state.waitingFor === "responder") {
      exchange.declaration ??= {};
      exchange.declaration.ownerSide = ownerSide;
      exchange.declaration.selectedDieIds = array(state.committedOwnerIndices)
        .map(index => this.getPool(ownerSide)[index]?.id).filter(Boolean);
      exchange.declaration.duelAction = state.declaredAction || "attack";
      exchange.declaration.duelActions = clone(state.actions ?? {});
    } else exchange.declaration = null;
    this.setInitiativeOwnerSide(ownerSide, "duelResolver");
    session.phase = state.status === "done" ? "complete" : state.waitingFor === "responder" ? "response" : "declaration";
    session.status = state.status === "done" ? "complete" : "active";
  }
}

export function meleeSessionDuelState(session) {
  return MeleeExchangeContext.fromSession(session).toDuelState();
}

export function normalizeMeleeSessionData(source) {
  if (!source) return null;
  const session = clone(source);
  session.variant ??= session.metadata?.isGradCios ? "gradCiosow" : "standard";
  session.messages ??= {
    attackerRollMessageId: session.metadata?.attackerTestMessageId ?? null,
    pendingMessageId: session.messageId ?? null,
    defenderRollMessageId: session.metadata?.defenderTestMessageId ?? null,
    duelMessageId: session.messageId ?? null,
    resultMessageId: null
  };
  session.actions ??= { declared: [], resolved: [] };
  session.initiative ??= {};
  session.initiative.rolls ??= {};
  session.initiative.history ??= [];
  for (const side of MELEE_SIDES) {
    const pool = session.pools?.[side];
    const dice = (Array.isArray(pool) ? pool : array(pool?.dice)).map(createMeleeDie);
    session.pools ??= {};
    session.pools[side] = { diceCount: dice.length, dice };
  }
  if (!session.exchange) {
    const previousDuelState = session.v1State ? clone(session.v1State) : null;
    session.exchange = createMeleeExchange(Math.min(3,
      meleePoolDice(session, "attacker").length || 3,
      meleePoolDice(session, "defender").length || 3));
    if (previousDuelState) MeleeExchangeContext.fromSession(session).applyDuelState(previousDuelState);
  }
  // Import older declaration keys once at the persistence boundary. Runtime
  // code only sees the canonical duelAction/duelActions contract.
  if (session.exchange?.declaration) {
    const declaration = session.exchange.declaration;
    declaration.duelAction ??= declaration.legacyAction ?? null;
    declaration.duelActions ??= clone(declaration.legacyActions ?? {});
    delete declaration.legacyAction;
    delete declaration.legacyActions;
  }
  delete session.v1State;
  delete session.segments;
  delete session.currentSegment;
  delete session.declarations;
  delete session.future;
  session.commandHistory ??= array(session.history).map(clone);
  delete session.history;
  return session;
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
  mode = "opposedSuccessPoints", variant = "standard", metadata = {}
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
    variant,
    phase: "awaitingAttackerRoll",
    mode,
    participants: {
      attacker: normalizeParticipant(attacker, "attacker"),
      defender: normalizeParticipant(defender, "defender")
    },
    messages: {
      attackerRollMessageId: null,
      pendingMessageId: null,
      defenderRollMessageId: null,
      duelMessageId: null,
      resultMessageId: null
    },
    initiative: {
      ownerId: initiativeOwnerId,
      previousOwnerId: null,
      reason: "engagementStart",
      rolls: {},
      history: [{ ownerId: initiativeOwnerId, previousOwnerId: null, reason: "engagementStart", at: now }]
    },
    pools: { attacker: createEmptyMeleePool(), defender: createEmptyMeleePool() },
    exchange: createMeleeExchange(3),
    actions: { declared: [], resolved: [] },
    actionInstances: {},
    pendingOutcomes: [],
    effects: [],
    operationLedger: {},
    commandLedger: {},
    commandHistory: [],
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
    declaration: { side: ownerSide, kind: "commitExchangeAction", label: "Deklaracja akcji" },
    response: { side: responderSide, kind: "commitExchangeAction", label: "Odpowiedź na akcję" },
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
  session.initiative.history ??= [];
  session.initiative.history.push({
    ownerId,
    previousOwnerId: session.initiative.previousOwnerId,
    reason,
    at: Date.now()
  });
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
    const condition = resolveMeleeRuntimeValue(typeof raw === "string" ? { key: raw } : raw, context);
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
registerMeleeCondition("freeDice", ({ session, side }, c) => meleePoolDice(session, side).filter(die => die.state === "available").length >= number(c.value), { label: "Wolne kości", fields: numericField, validate: valueRequired });
registerMeleeCondition("segment", ({ session }, c) => session.exchange.currentSegment === number(c.value), { label: "Segment", fields: numericField, validate: valueRequired });
registerMeleeCondition("previousHit", ({ session, side }) => {
  const previous = session.exchange.segments[session.exchange.currentSegment - 1];
  const action = session.actionInstances[previous?.ownerActionId];
  return action?.side === side && previous?.outcomeIds?.length > 0;
}, { label: "Trafienie w poprzednim segmencie" });
registerMeleeCondition("previousDefense", ({ session, side }) => {
  const previous = session.exchange.segments[session.exchange.currentSegment - 1];
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
  const previous = session.exchange.segments[session.exchange.currentSegment - 1];
  return [previous?.ownerActionId, previous?.responderActionId]
    .map(id => session.actionInstances[id]).some(action => action?.side === side && (action.activityId === c.value || action.definition.category === c.value));
}, { label: "Akcja w poprzednim segmencie", fields: [{ name: "value", type: "text" }], validate: valueRequired });
registerMeleeCondition("weaponType", ({ item }, c) => item?.type === c.value || item?.system?.weaponType === c.value, { label: "Typ broni", fields: [{ name: "value", type: "text" }], validate: valueRequired });
registerMeleeCondition("location", ({ location }, c) => location === c.value, { label: "Lokacja", fields: [{ name: "value", type: "text" }], validate: valueRequired });

export function normalizeMeleeActivity(raw = {}, source = {}) {
  const activation = raw.activation ?? {};
  const committedDice = activation.committedDice ?? {};
  const requiredSuccesses = activation.requiredSuccesses ?? {};
  const occupiedSegments = activation.occupiedSegments ?? {};
  const costs = raw.costs ?? {};
  const availability = raw.availability ?? {};
  const damageSource = raw.meleeDamage ?? raw.damage;
  const damage = damageSource && typeof damageSource === "object" ? damageSource : {};
  return {
    id: String(raw.id || randomId()),
    name: String(raw.name || raw.label || "Akcja melee"),
    img: raw.img || source.img || null,
    description: String(raw.description || raw.tooltip || ""),
    kind: ["action", "modifier", "reaction"].includes(raw.kind) ? raw.kind : "action",
    category: raw.category || raw.type || "attack",
    tags: [...new Set(array(raw.tags))],
    source: {
      kind: source.kind || raw.source?.kind || "item",
      uuid: source.uuid || raw.source?.uuid || null,
      itemUuid: source.itemUuid || raw.source?.itemUuid || null,
      effectUuid: source.effectUuid || raw.source?.effectUuid || null
    },
    availability: {
      phases: [...new Set(array(availability.phases))],
      roles: [...new Set(array(availability.roles))],
      requiresInitiative: availability.requiresInitiative ?? null,
      conditions: array(availability.conditions).map(clone)
    },
    activation: {
      role: activation.role || raw.role || "either",
      timing: activation.timing || raw.timing || "declaration",
      costType: activation.costType || raw.costType || (number(activation.successCost ?? raw.successCost) > 0 ? "success" : "dice"),
      cost: number(activation.cost ?? raw.cost, 0),
      minDice: number(committedDice.min ?? activation.minDice ?? raw.minDice, 1),
      maxDice: number(committedDice.max ?? activation.maxDice ?? raw.maxDice, 3),
      exactDice: committedDice.exact ?? activation.exactDice ?? null,
      committedDice: {
        min: number(committedDice.min ?? activation.minDice ?? raw.minDice, 1),
        max: number(committedDice.max ?? activation.maxDice ?? raw.maxDice, 3),
        exact: committedDice.exact ?? activation.exactDice ?? null
      },
      segmentCost: number(activation.segmentCost ?? raw.segmentCost, raw.costType === "segment" ? 1 : 0),
      successCost: number(activation.successCost ?? costs.successPoints ?? raw.successCost, raw.costType === "success" ? 1 : 0),
      requiredSuccesses: {
        min: number(requiredSuccesses.min ?? activation.successCost ?? costs.successPoints ?? raw.successCost, 0),
        max: requiredSuccesses.max ?? null
      },
      occupiedSegments: {
        mode: occupiedSegments.mode || (activation.segmentCost != null ? "fixed" : "selectedDice"),
        value: occupiedSegments.value ?? activation.segmentCost ?? null
      },
      responsePolicy: activation.responsePolicy || raw.responsePolicy || "exactCommittedDice",
      uses: activation.uses ?? raw.uses ?? null,
      diceReusePolicy: clone(activation.diceReusePolicy ?? raw.diceReusePolicy ?? { mode: "none", trigger: null })
    },
    parameters: array(raw.parameters).map(parameter => ({
      key: String(parameter.key || randomId()),
      label: String(parameter.label || parameter.key || "Parametr"),
      type: parameter.type || "number",
      default: parameter.default ?? 0,
      min: parameter.min ?? null,
      max: parameter.max ?? null,
      choices: array(parameter.choices).map(choice => ({ value: choice.value, label: String(choice.label ?? choice.value) }))
    })),
    test: raw.test ? clone(raw.test) : null,
    damage: {
      mode: damage.mode || raw.damageMode || "weapon",
      profile: {
        1: damage.profile?.[1] ?? raw.damageProfile?.[1] ?? null,
        2: damage.profile?.[2] ?? raw.damageProfile?.[2] ?? null,
        3: damage.profile?.[3] ?? raw.damageProfile?.[3] ?? null
      }
    },
    conditions: (array(raw.conditions).length ? array(raw.conditions) : array(availability.conditions)).map(clone),
    selectors: clone(raw.selectors ?? {}),
    changes: array(raw.changes).map(clone),
    priority: number(raw.priority, 100),
    outcomes: array(raw.outcomes).map(normalizeOutcomeDefinition),
    operations: array(raw.operations).map(normalizeOperation),
    automation: {
      approval: raw.automation?.approval || raw.approval || "gm",
      resolver: raw.automation?.resolver || raw.resolverKind || "opposedSuccessPoints"
    },
    duel: clone(raw.duel ?? raw.legacy ?? {})
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
  side, actorUuid, selectedDiceIds = [], segmentIndex = 0, targetUuids = [], parameters = {}
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
    parameters: Object.fromEntries(definition.parameters.map(parameter => [
      parameter.key, parameters[parameter.key] ?? parameter.default
    ])),
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
      normalizeMeleeActivity({
        id: "attack", name: "Atak", kind: "action", category: "attack", timing: "either",
        tags: ["melee", "melee.attack", item?.system?.weaponGroup, item?.system?.weaponType].filter(Boolean),
        duel: { action: "attack" },
        outcomes: [{
        id: "hit", when: "hit", label: "Trafienie", operations: [{
          type: "damage", target: "opponent", data: { damageProfiles, piercing: number(item?.system?.piercing) }
        }]
        }]
      }, common.source),
      normalizeMeleeActivity({ id: "defense", name: "Obrona", kind: "reaction", category: "defense", timing: "response", duel: { action: "defend" }, outcomes: [] }, common.source),
      normalizeMeleeActivity({ id: "exit", name: "Wyjście ze zwarcia", kind: "action", category: "movement", timing: "declaration", minDice: 1, maxDice: 1, duel: { action: "exit" },
        outcomes: [{ id: "exit", label: "Wyjście", operations: [{ type: "endEngagement", data: { reason: "exit" } }] }] }, common.source),
      normalizeMeleeActivity({ id: "flee", name: "Ucieczka", kind: "reaction", category: "movement", timing: "response", minDice: 0, maxDice: 0, duel: { action: "flee" },
        outcomes: [{ id: "flee", label: "Ucieczka", operations: [{ type: "endEngagement", data: { reason: "flee" } }] }] }, common.source),
      normalizeMeleeActivity({ id: "nonCombat", name: "Akcja niebojowa", kind: "action", category: "utility", timing: "declaration", duel: { action: "nonCombat" } }, common.source),
      normalizeMeleeActivity({ id: "blockExit", name: "Zablokuj wyjście", kind: "reaction", category: "defense", timing: "response", minDice: 1, maxDice: 1, duel: { action: "blockExit" } }, common.source),
      normalizeMeleeActivity({ id: "allowExit", name: "Pozwól wyjść", kind: "reaction", category: "utility", timing: "response", minDice: 0, maxDice: 0, duel: { action: "allowExit" } }, common.source),
      normalizeMeleeActivity({ id: "seizeInit", name: "Przejmij inicjatywę", kind: "reaction", category: "defense", timing: "response", duel: { action: "seizeInit" } }, common.source),
      normalizeMeleeActivity({ id: "interrupt", name: "Przerwij", kind: "reaction", category: "defense", timing: "response", duel: { action: "interrupt" } }, common.source)
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
        : fallbackBeastOperations(item, activity)
    }, { kind: "beast", uuid: `${item.uuid}#${activity.id}`, itemUuid: item.uuid }));
  }

  static fromEffect(effect) {
    const configured = array(effect?.system?.melee?.grantedActivities);
    const configuredIds = new Set(configured.map(entry => entry.id));
    const compatibilityDefinitions = array(effect?.system?.actionDefs)
      .filter(entry => entry.type !== "result" && !configuredIds.has(entry.id));
    const restrictions = array(effect?.system?.melee?.restrictions);
    const normalize = (activity, compatibilityActionDef = false) => normalizeMeleeActivity({
      ...clone(activity),
      conditions: [...restrictions, ...array(activity.conditions)],
      duel: { ...(activity.duel ?? activity.legacy ?? {}), actionDef: compatibilityActionDef }
    }, {
      kind: "effect", uuid: `${effect.uuid}#${activity.id}`, effectUuid: effect.uuid
    });
    return [
      ...configured.map(activity => normalize(activity, false)),
      ...compatibilityDefinitions.map(activity => normalize(activity, true))
    ];
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
    const unique = new Map();
    for (const activity of results) {
      const sourceKey = activity.source.effectUuid || activity.source.itemUuid || activity.source.uuid || "core";
      unique.set(`${sourceKey}::${activity.id}`, activity);
    }
    return [...unique.values()];
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

function fallbackBeastOperations(item, activity) {
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

const MELEE_DAMAGE_TRACK = Object.freeze(["D", "L", "C", "K"]);
const MELEE_SERIOUS_DAMAGE_TRACK = Object.freeze(["sD", "sL", "sC", "sK"]);

function shiftMeleeDamage(value, steps) {
  const track = String(value || "").startsWith("s") ? MELEE_SERIOUS_DAMAGE_TRACK : MELEE_DAMAGE_TRACK;
  const index = track.indexOf(value);
  if (index < 0) return value;
  return track[Math.max(0, Math.min(track.length - 1, index + number(steps)))];
}

/** Apply deterministic Item/profession/origin modifiers first, then AE modifiers. */
export function applyMeleeDamageModifiers(actor, activity, profile = {}, { details = false, selectedModifiers = [] } = {}) {
  const entries = [];
  for (const item of array(actor?.items)) {
    for (const modifier of array(item.system?.melee?.damageModifiers ?? item.getFlag?.("neuroshima", "meleeDamageModifiers"))) {
      entries.push({ ...clone(modifier), sourceOrder: 1, sourceUuid: item.uuid, sourceName: item.name });
    }
  }
  for (const effect of array(actor?.effects).filter(entry => !entry.disabled)) {
    for (const modifier of array(effect.system?.melee?.modifiers).filter(entry => entry.tier != null)) {
      entries.push({ ...clone(modifier), sourceOrder: 2, sourceUuid: effect.uuid, sourceName: effect.name });
    }
  }
  for (const activityModifier of selectedModifiers) {
    for (const change of array(activityModifier.changes)) {
      if (change.type !== "damageTierShift") continue;
      const tiers = array(change.tiers).length ? array(change.tiers) : [1, 2, 3];
      for (const tier of tiers) entries.push({
        selector: {}, tier, mode: number(change.value) >= 0 ? "upgrade" : "downgrade",
        value: Math.abs(number(change.value)), priority: activityModifier.priority,
        sourceOrder: 0,
        sourceUuid: activityModifier.source.uuid || activityModifier.source.itemUuid || activityModifier.source.effectUuid,
        sourceName: activityModifier.name
      });
    }
  }
  entries.sort((left, right) =>
    number(left.priority, 100) - number(right.priority, 100) ||
    number(left.sourceOrder) - number(right.sourceOrder) ||
    String(left.sourceUuid).localeCompare(String(right.sourceUuid))
  );
  const result = { 1: profile[1], 2: profile[2], 3: profile[3] };
  const applied = [];
  for (const modifier of entries) {
    const selector = modifier.selector ?? {};
    const tags = array(selector.tags);
    if (tags.length && !tags.some(tag => array(activity?.tags).includes(tag))) continue;
    if (selector.activityIds?.length && !selector.activityIds.includes(activity?.id)) continue;
    for (const tier of [1, 2, 3]) {
      if (modifier.tier != null && number(modifier.tier) !== tier) continue;
      const before = result[tier];
      const mode = modifier.mode;
      if (mode === "upgrade") result[tier] = shiftMeleeDamage(result[tier], number(modifier.value, 1));
      else if (mode === "downgrade") result[tier] = shiftMeleeDamage(result[tier], -number(modifier.value, 1));
      else if (mode === "replace") result[tier] = modifier.value || result[tier];
      else if (mode === "addSerious" && result[tier] && !String(result[tier]).startsWith("s")) result[tier] = `s${result[tier]}`;
      if (result[tier] !== before) applied.push({
        sourceUuid: modifier.sourceUuid,
        sourceName: modifier.sourceName || modifier.sourceUuid,
        tier, mode, value: modifier.value,
        before, after: result[tier], priority: number(modifier.priority, 100)
      });
    }
  }
  return details ? { profile: result, modifiers: applied } : result;
}

function validateMeleeParameterValues(activity, submitted = {}) {
  const values = {};
  for (const parameter of array(activity.parameters)) {
    const value = submitted[parameter.key] ?? parameter.default;
    if (parameter.type === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || (parameter.min != null && numeric < Number(parameter.min)) ||
          (parameter.max != null && numeric > Number(parameter.max))) {
        throw new MeleeValidationError(`Invalid value for ${parameter.label}`, "INVALID_ACTIVITY_PARAMETER");
      }
      values[parameter.key] = numeric;
    } else if (parameter.type === "boolean") values[parameter.key] = value === true || value === "true";
    else if (parameter.type === "select") {
      const allowed = array(parameter.choices).map(choice => choice.value);
      if (!allowed.includes(value)) throw new MeleeValidationError(`Invalid value for ${parameter.label}`, "INVALID_ACTIVITY_PARAMETER");
      values[parameter.key] = value;
    } else values[parameter.key] = String(value ?? "");
  }
  return values;
}

function meleeModifierMatches(modifier, activity, item) {
  const selectors = modifier.selectors ?? {};
  const activityTags = array(selectors.activityTags ?? selectors.tags);
  const weaponTags = array(selectors.weaponTags);
  if (activityTags.length && !activityTags.some(tag => array(activity.tags).includes(tag))) return false;
  if (array(selectors.activityIds).length && !array(selectors.activityIds).includes(activity.id)) return false;
  const actualWeaponTags = [
    ...array(item?.system?.tags), item?.system?.weaponType, item?.system?.weaponGroup
  ].filter(Boolean);
  if (weaponTags.length && !weaponTags.some(tag => actualWeaponTags.includes(tag))) return false;
  return true;
}

function meleeReusableTriggeringDice(session, side, activity) {
  const policy = activity.activation?.diceReusePolicy ?? {};
  if (policy.mode !== "triggeringDie" || policy.trigger !== "initiativeTaken" || initiativeSide(session) !== side) {
    return new Set();
  }
  const previous = array(session.exchange?.segments)
    .slice(0, number(session.exchange?.currentSegment))
    .reverse()
    .find(segment => segment.outcome === "takeover");
  if (!previous) return new Set();
  const response = session.actionInstances?.[previous.responderActionId];
  if (response?.side !== side) return new Set();
  const candidates = array(previous.responderDiceIds)
    .map(id => meleePoolDice(session, side).find(die => die.id === id))
    .filter(die => die?.isSuccess)
    .sort((left, right) => number(left.modified) - number(right.modified));
  return new Set(candidates.length ? [candidates[0].id] : []);
}

function duelActionForActivity(activity, responder = false) {
  if (activity.duel?.action) return activity.duel.action;
  const core = {
    attack: "attack", defense: "defend", flee: "flee", exit: "exit",
    blockExit: "blockExit", allowExit: "allowExit", nonCombat: "nonCombat",
    seizeInit: "seizeInit", interrupt: "interrupt"
  };
  if (core[activity.id]) return core[activity.id];
  return responder ? "defend" : "trick";
}

function meleeDamageSnapshot(actor, activity, baseProfile, selectedModifiers = []) {
  const base = { 1: baseProfile[1], 2: baseProfile[2], 3: baseProfile[3] };
  const damageOperation = array(activity.operations).find(operation => operation.type === "damage")
    ?? array(activity.outcomes).flatMap(outcome => array(outcome.operations)).find(operation => operation.type === "damage");
  const operationProfiles = damageOperation?.data?.damageProfiles;
  const operationDamage = damageOperation?.data?.damage ?? null;
  const activityProfile = {
    1: activity.damage?.profile?.[1] ?? operationProfiles?.[0] ?? operationDamage ?? base[1],
    2: activity.damage?.profile?.[2] ?? operationProfiles?.[1] ?? operationDamage ?? base[2],
    3: activity.damage?.profile?.[3] ?? operationProfiles?.[2] ?? operationDamage ?? base[3]
  };
  const resolved = applyMeleeDamageModifiers(actor, activity, activityProfile, {
    details: true,
    selectedModifiers
  });
  return { base, activity: activityProfile, final: resolved.profile, modifiers: resolved.modifiers };
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
  const die = meleePoolDice(session, side).find(entry => entry.id === operation.data.dieId);
  if (!die) throw new MeleeValidationError("Die not found", "DIE_NOT_FOUND");
  die.modified = number(die.modified) + number(operation.data.amount);
  die.isSuccess = die.modified <= number(die.target) && die.raw !== 20;
  die.changes.push({ type: "operation", amount: number(operation.data.amount) });
  return clone(die);
});
registerMeleeOperation("modifyTarget", async ({ session, operation }) => {
  const side = operation.data.side || initiativeSide(session);
  for (const die of meleePoolDice(session, side)) {
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
    || context.action.definition.duel?.damage || "D";
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
registerMeleeOperation("requiredTest", async ({ operation, target, actor, session, action, pendingOutcome }) => {
  const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
  const rollingSide = sideForActor(session, target?.uuid)
    ?? (action.side === "attacker" ? "defender" : "attacker");
  return NeuroshimaScriptRunner.postRequiredTest({
    ...clone(operation.data), defenderActorUuid: target?.uuid || "",
    attackerActorUuid: actor?.uuid || "", whisperToDefender: true,
    continuation: {
      type: "meleeActivityTest", sessionId: session.id, messageId: session.messageId,
      actionInstanceId: action.id, sourceOutcomeId: pendingOutcome?.id ?? null,
      operationId: operation.id, side: rollingSide
    }
  });
});
registerMeleeOperation("legacyScript", async ({ operation, actor, target, session, action }) => {
  if (!operation.data.code) return null;
  const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
  return new NeuroshimaScript({
    code: operation.data.code, trigger: "afterMeleeAction", label: action.definition.name
  }, null).execute({ actor, target, session, action });
});
// Canonical operation names used by the shared MeleeActivity editor. Legacy
// short names remain aliases so existing worlds do not require destructive migration.
registerMeleeOperation("applyActiveEffect", async context => MeleeEffectService.applyFromOperation(context));
registerMeleeOperation("removeActiveEffect", async context => MeleeEffectService.removeFromOperation(context));
registerMeleeOperation("refreshActiveEffect", async context => {
  context.operation.data.stackMode = "refresh";
  return MeleeEffectService.applyFromOperation(context);
});
registerMeleeOperation("modifyInitiative", async context => MeleeOperationRegistry.get("transferInitiative")(context));
registerMeleeOperation("followUpActivity", async context => MeleeOperationRegistry.get("followUp")(context));
registerMeleeOperation("consumeSource", async ({ operation, action }) => {
  const source = action?.sourceUuid ? await fromUuid(action.sourceUuid.split("#")[0]) : null;
  if (!source?.update) return { consumed: false };
  const path = operation.data.path || "system.quantity";
  const before = number(actorPath(source, path), 0);
  const amount = Math.max(1, number(operation.data.amount, 1));
  await source.update({ [path]: Math.max(0, before - amount) });
  return { consumed: true, path, before, after: Math.max(0, before - amount) };
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
    const pool = meleePoolDice(session, side);
    const selected = [...new Set(ids)].map(id => pool.find(die => die.id === id));
    if (selected.some(die => !die)) throw new MeleeValidationError("Selected die not found", "DIE_NOT_FOUND");
    if (selected.some(die => die.state === "spent")) {
      throw new MeleeValidationError("A melee die may be used only once", "DIE_ALREADY_USED");
    }
    return selected;
  }
}

export class MeleeOperationRunner {
  static async runOutcome(session, outcome, context) {
    if (outcome.status === "applied") return outcome;
    for (let index = 0; index < outcome.operations.length; index++) {
      const sourceOperation = outcome.operations[index];
      const selectedDice = array(context.selectedDice).length
        ? array(context.selectedDice)
        : array(context.action?.selectedDiceIds).map(id =>
            meleePoolDice(session, context.action?.side).find(die => die.id === id)
          ).filter(Boolean);
      const operation = resolveMeleeRuntimeValue(clone(sourceOperation), { ...context, session, selectedDice });
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
      meleeAppliedAt: Date.now(),
      melee: {
        sessionId: session?.id || null,
        actionInstanceId: action?.id || null,
        activityId: action?.activityId || action?.definition?.id || null,
        operationId: operation?.id || null,
        sourceActorUuid: action?.actorUuid || null,
        sourceItemUuid: action?.definition?.source?.itemUuid || null
      }
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
  static _writeQueues = new Map();

  static _write(key, operation) {
    const previous = this._writeQueues.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    const tail = pending.catch(() => undefined);
    this._writeQueues.set(key, tail);
    tail.finally(() => {
      if (this._writeQueues.get(key) === tail) this._writeQueues.delete(key);
    });
    return pending;
  }

  static async get(sessionId, { combat = game.combat, messageId = null } = {}) {
    const combatSession = combat?.getFlag("neuroshima", MELEE_FLAG)?.[sessionId] ?? null;
    if (combatSession) return normalizeMeleeSessionData(combatSession);
    for (const candidate of array(game.combats)) {
      if (candidate.id === combat?.id) continue;
      const stored = candidate.getFlag("neuroshima", MELEE_FLAG)?.[sessionId];
      if (stored) return normalizeMeleeSessionData(stored);
    }
    const worldSession = game.settings.get("neuroshima", MELEE_WORLD_STORE_SETTING)?.[sessionId] ?? null;
    if (worldSession) return normalizeMeleeSessionData(worldSession);
    // Read-only import for cards created by the retired preview implementation.
    const message = messageId ? game.messages.get(messageId) : game.messages.find(entry =>
      entry.getFlag("neuroshima", "melee")?.sessionId === sessionId);
    return normalizeMeleeSessionData(message?.getFlag("neuroshima", "meleeSessionV2") ?? null);
  }

  static async create(session, { combat = game.combat, message = null } = {}) {
    validateMeleeSession(session);
    if (combat) {
      await this._write(session.id, async () => {
        const stored = combat.getFlag("neuroshima", MELEE_FLAG)?.[session.id];
        if (stored) throw new MeleeValidationError("Session already exists", "SESSION_EXISTS");
        await combat.update({ [`flags.neuroshima.${MELEE_FLAG}.${session.id}`]: clone(session) });
      });
    } else {
      if (message) session.messageId = message.id;
      await this._write(MELEE_WORLD_STORE_SETTING, async () => {
        const sessions = clone(game.settings.get("neuroshima", MELEE_WORLD_STORE_SETTING) ?? {});
        if (sessions[session.id]) throw new MeleeValidationError("Session already exists", "SESSION_EXISTS");
        sessions[session.id] = clone(session);
        await game.settings.set("neuroshima", MELEE_WORLD_STORE_SETTING, sessions);
      });
    }
    return session;
  }

  static async save(session, { expectedRevision, combat = undefined } = {}) {
    if (combat === undefined) combat = session.combatId ? game.combats?.get(session.combatId) ?? null : null;
    if (expectedRevision != null && session.revision !== expectedRevision) {
      throw new MeleeValidationError("Stale melee session revision", "STALE_REVISION", {
        expected: expectedRevision, actual: session.revision
      });
    }
    session.revision += 1;
    session.updatedAt = Date.now();
    validateMeleeSession(session);
    if (combat) {
      await this._write(session.id, async () => {
        const stored = combat.getFlag("neuroshima", MELEE_FLAG)?.[session.id];
        if (stored && number(stored.revision) !== number(expectedRevision, stored.revision)) {
          throw new MeleeValidationError("Melee session changed before save", "LOST_UPDATE", {
            expected: expectedRevision, actual: stored.revision
          });
        }
        await combat.update({ [`flags.neuroshima.${MELEE_FLAG}.${session.id}`]: clone(session) });
      });
    } else {
      await this._write(MELEE_WORLD_STORE_SETTING, async () => {
        const sessions = clone(game.settings.get("neuroshima", MELEE_WORLD_STORE_SETTING) ?? {});
        const stored = sessions[session.id];
        if (stored && number(stored.revision) !== number(expectedRevision, stored.revision)) {
          throw new MeleeValidationError("Melee session changed before save", "LOST_UPDATE");
        }
        sessions[session.id] = clone(session);
        await game.settings.set("neuroshima", MELEE_WORLD_STORE_SETTING, sessions);
      });
    }
    return session;
  }

  static list(combat = game.combat) {
    const worldSessions = Object.values(game.settings.get("neuroshima", MELEE_WORLD_STORE_SETTING) ?? {})
      .map(normalizeMeleeSessionData);
    if (!combat) return worldSessions;
    const combined = new Map(worldSessions.map(session => [session.id, session]));
    for (const session of Object.values(combat.getFlag("neuroshima", MELEE_FLAG) ?? {}).map(normalizeMeleeSessionData)) {
      combined.set(session.id, session);
    }
    return [...combined.values()];
  }
}

export function validateMeleeSession(session) {
  if (session?.schemaVersion !== MELEE_VERSION) throw new MeleeValidationError("Unsupported melee session schema");
  if (!MELEE_PHASES.includes(session.phase)) throw new MeleeValidationError("Invalid melee phase");
  if (!Number.isInteger(session.revision) || session.revision < 0) throw new MeleeValidationError("Invalid revision");
  if (!session.exchange || !Array.isArray(session.exchange.segments) || session.exchange.segments.length < 1 || session.exchange.segments.length > 3) {
    throw new MeleeValidationError("Melee requires one to three canonical segments");
  }
  for (const side of MELEE_SIDES) {
    const pool = meleePoolDice(session, side);
    if (pool.length > 3) throw new MeleeValidationError("A submitted pool may contain at most three dice");
    if (pool.some(die => !["available", "reserved", "spent"].includes(die.state))) {
      throw new MeleeValidationError("Invalid melee die state", "INVALID_DIE_STATE");
    }
    if (pool.length !== number(session.pools?.[side]?.diceCount, pool.length)) {
      throw new MeleeValidationError("Melee diceCount does not match the stored pool");
    }
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
    const commandId = String(command.commandId || "");
    if (!commandId) throw new MeleeValidationError("commandId is required", "MISSING_COMMAND_ID");
    if (session.commandLedger[commandId]) return clone(session.commandLedger[commandId].result);
    validateMeleeRevision(session.revision, number(command.expectedRevision, -1));
    const user = game.users.get(command.userId);
    await this._authorize(session, command, user);
    const result = await this._apply(session, command, user);
    session.commandLedger[commandId] = { type: command.type, userId: command.userId, appliedAt: Date.now(), result: clone(result) };
    session.commandHistory ??= [];
    session.commandHistory.push({ commandId, type: command.type, userId: command.userId, revision: session.revision, at: Date.now() });
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
      case "replaceRoll": return this._replaceRoll(session, command);
      case "commitExchangeAction": return this._commitExchangeAction(session, command);
      case "undo": return this._undo(session);
      case "redo": return this._redo(session);
      case "swapInitiative": return this._swapInitiative(session);
      case "claimDamage": return this._claimDamage(session, command);
      case "markApplied": return this._markApplied(session, command);
      case "approveOutcome": return this._approveOutcome(session, command);
      case "resolveRequiredTest": return this._resolveRequiredTest(session, command);
      case "advanceSegment": return this._advanceSegment(session);
      case "endSession": return this._endSession(session, command.payload?.reason);
      default: throw new MeleeValidationError(`Unknown melee command: ${command.type}`, "UNKNOWN_COMMAND");
    }
  }

  static async _submitRoll(session, command) {
    const side = command.side;
    const expected = side === "attacker" ? "awaitingAttackerRoll" : "awaitingDefenderRoll";
    if (session.phase !== expected) throw new MeleeValidationError("Roll submitted in the wrong phase", "WRONG_PHASE");
    const dice = setMeleePool(session, side, command.payload?.dice);
    if (session.variant === "standard" && dice.length !== 3) {
      throw new MeleeValidationError("Standard melee rolls require exactly three dice", "INVALID_DICE_POOL");
    }
    if (session.variant === "gradCiosow" && side === "defender") {
      const required = Math.min(3, Math.max(1, meleePoolDice(session, "attacker").filter(die => die.isSuccess).length || 1));
      if (dice.length !== required) {
        throw new MeleeValidationError(`Hail defense requires exactly ${required} dice`, "INVALID_DICE_POOL");
      }
    }
    session.phase = side === "attacker" ? "awaitingDefenderRoll" : "declaration";
    if (command.payload?.testMessageId) {
      session.messages[side === "attacker" ? "attackerRollMessageId" : "defenderRollMessageId"] = command.payload.testMessageId;
    }
    if (command.payload?.weaponUuid) session.participants[side].weaponUuid = command.payload.weaponUuid;
    if (side === "defender") {
      session.metadata.defenderTarget = number(command.payload?.target);
      const attackerDocument = await fromUuid(
        session.participants.attacker.tokenUuid || session.participants.attacker.actorUuid
      );
      const attackerActor = attackerDocument?.actor ?? attackerDocument;
      const attackerWeapon = session.participants.attacker.weaponUuid
        ? await fromUuid(session.participants.attacker.weaponUuid)
        : attackerActor?.items?.get?.(session.metadata.weaponId)
          ?? attackerActor?.items?.get?.(session.metadata.beastItemId);
      const defenderDocument = await fromUuid(
        session.participants.defender.tokenUuid || session.participants.defender.actorUuid
      );
      const defenderActor = defenderDocument?.actor ?? defenderDocument;
      const defenderWeapon = session.participants.defender.weaponUuid
        ? await fromUuid(session.participants.defender.weaponUuid)
        : null;
      session.metadata.activitySnapshots = {};
      for (const [activitySide, activityActor, activityWeapon] of [
        ["attacker", attackerActor, attackerWeapon],
        ["defender", defenderActor, defenderWeapon]
      ]) {
        session.metadata.activitySnapshots[activitySide] = MeleeActionCatalog.collect(activityActor, { item: activityWeapon })
          .filter(activity => !["attack", "defense", "exit", "flee", "nonCombat"].includes(activity.id) &&
            activity.duel?.actionDef !== true)
          .map(activity => ({ runtimeId: randomId(), definition: clone(activity) }));
      }
      session.metadata.defenderManeuver = command.payload?.maneuver ?? null;
      session.metadata.defenderDamage1 = command.payload?.defenderDamage1 ?? "D";
      session.metadata.defenderDamage2 = command.payload?.defenderDamage2 ?? "L";
      session.metadata.defenderDamage3 = command.payload?.defenderDamage3 ?? "K";
      const attackDice = meleePoolDice(session, "attacker").map(meleeDieForDuelCard);
      const defenseDice = dice.map(meleeDieForDuelCard);
      if (session.variant === "gradCiosow") {
        session.hailResult = resolveMeleeHail(attackDice, defenseDice, {
          1: session.metadata.damage1, 2: session.metadata.damage2, 3: session.metadata.damage3
        });
        session.status = "complete";
        session.phase = "complete";
      } else {
        const segmentCount = Math.min(3, attackDice.length, defenseDice.length);
        session.exchange = createMeleeExchange(segmentCount);
        session.phase = "declaration";
        if (session.metadata.szachistaYield) {
          transferMeleeInitiative(session, session.participants.defender.actorUuid, "szachistaYield");
        }
        await DuelLifecycle.start(DuelContext.fromFlag(
          MeleeExchangeContext.fromSession(session).toDuelState()
        ));
      }
    }
    return { side, dice: clone(dice) };
  }

  static _replaceRoll(session, command) {
    const side = command.side;
    if (!MELEE_SIDES.includes(side)) throw new MeleeValidationError("Invalid roll side", "WRONG_SIDE");
    if (session.result?.applied || session.hailResult?.applied ||
        session.pendingOutcomes.some(outcome => outcome.status === "applied") ||
        Object.values(session.operationLedger ?? {}).some(entry => ["running", "applied"].includes(entry?.status))) {
      throw new MeleeValidationError("Nie można edytować rzutu, ponieważ wynik tej walki został już zastosowany.", "RESULT_ALREADY_APPLIED");
    }
    const dice = setMeleePool(session, side, command.payload?.dice);
    if (session.variant === "standard" && dice.length !== 3) {
      throw new MeleeValidationError("Standard melee rolls require exactly three dice", "INVALID_DICE_POOL");
    }
    session.metadata[side === "attacker" ? "attackerTarget" : "defenderTarget"] = number(command.payload?.target);
    if (session.variant === "gradCiosow") {
      const required = Math.min(3, Math.max(1,
        meleePoolDice(session, "attacker").filter(die => die.isSuccess).length || 1
      ));
      if (side === "defender" && dice.length !== required) {
        throw new MeleeValidationError(`Hail defense requires exactly ${required} dice`, "INVALID_DICE_POOL");
      }
      if (side === "attacker" && meleePoolDice(session, "defender").length !== required) {
        session.pools.defender = createEmptyMeleePool();
        session.hailResult = null;
        session.status = "active";
        session.phase = "awaitingDefenderRoll";
        session.operationLedger = {};
        return { side, reset: true, defenderRerollRequired: true, variant: "gradCiosow" };
      }
    }
    if (!meleePoolDice(session, "attacker").length || !meleePoolDice(session, "defender").length) {
      session.phase = "awaitingDefenderRoll";
      return { side, reset: false };
    }
    const attackDice = meleePoolDice(session, "attacker").map(meleeDieForDuelCard);
    const defenseDice = meleePoolDice(session, "defender").map(meleeDieForDuelCard);
    if (session.variant === "gradCiosow") {
      session.hailResult = resolveMeleeHail(attackDice, defenseDice, {
        1: session.metadata.damage1, 2: session.metadata.damage2, 3: session.metadata.damage3
      });
      session.status = "complete";
      session.phase = "complete";
      return { side, reset: true, variant: "gradCiosow" };
    }
    const segmentCount = Math.min(3, attackDice.length, defenseDice.length);
    session.exchange = createMeleeExchange(segmentCount);
    for (const poolSide of MELEE_SIDES) {
      for (const die of meleePoolDice(session, poolSide)) {
        die.state = "available";
        die.used = false;
        die.reservedByActionId = null;
        die.spentAtSegment = null;
      }
    }
    const initialOwnerSide = session.metadata.szachistaYield ? "defender" : "attacker";
    transferMeleeInitiative(session, session.participants[initialOwnerSide].actorUuid, "rollEdited");
    session.phase = "declaration";
    session.status = "active";
    session.result = null;
    session.pendingOutcomes = [];
    session.actionInstances = {};
    session.actions = { declared: [], resolved: [] };
    session.operationLedger = {};
    return { side, reset: true, variant: "standard" };
  }

  static async _commitExchangeAction(session, command) {
    if (!["declaration", "response"].includes(session.phase)) {
      throw new MeleeValidationError("Duel is not waiting for an exchange action", "WRONG_PHASE");
    }
    const responder = session.phase === "response";
    const ownerSide = initiativeSide(session);
    const side = responder ? (ownerSide === "attacker" ? "defender" : "attacker") : ownerSide;
    if (command.side !== side) throw new MeleeValidationError("Wrong participant for this phase", "WRONG_SIDE");

    const selectedDieIds = [...new Set(array(command.payload?.selectedDieIds).map(String))];
    const selectedDice = selectedDieIds.map(id => meleePoolDice(session, side).find(die => die.id === id));
    if (selectedDice.some(die => !die)) throw new MeleeValidationError("Selected die was not found", "DIE_NOT_FOUND");

    const participant = session.participants[side];
    const actorDocument = await fromUuid(participant.tokenUuid || participant.actorUuid);
    const actor = actorDocument?.actor ?? actorDocument;
    const targetSide = side === "attacker" ? "defender" : "attacker";
    const targetDocument = await fromUuid(session.participants[targetSide].tokenUuid || session.participants[targetSide].actorUuid);
    const target = targetDocument?.actor ?? targetDocument;
    const reference = clone(command.payload?.activity ?? {});
    const sourceItem = reference.sourceItemUuid ? await fromUuid(reference.sourceItemUuid)
      : participant.weaponUuid ? await fromUuid(participant.weaponUuid) : null;
    const requestedId = reference.activityId === "defend" ? "defense" : reference.activityId;
    let activity = MeleeActionCatalog.findExact(actor, { ...reference, activityId: requestedId }, { item: sourceItem })
      ?? MeleeActionCatalog.coreActivities(actor, sourceItem).find(entry => entry.id === requestedId);
    if (!activity && ["blockExit", "allowExit", "seizeInit", "interrupt"].includes(reference.activityId)) {
      activity = normalizeMeleeActivity({
        id: reference.activityId, name: reference.activityId, kind: "reaction", timing: "response",
        minDice: reference.activityId === "allowExit" ? 0 : 1, maxDice: 3,
        duel: { action: reference.activityId }
      }, { kind: "core", uuid: sourceItem?.uuid || actor.uuid, itemUuid: sourceItem?.uuid || null });
    }
    if (!activity || activity.kind === "modifier") {
      throw new MeleeValidationError("Exact melee action was not found", "ACTIVITY_NOT_FOUND", reference);
    }
    const requiredRole = responder ? "responder" : "owner";
    const requiredTiming = responder ? "response" : "declaration";
    if (!["either", requiredRole].includes(activity.activation.role) ||
        !["either", requiredTiming].includes(activity.activation.timing)) {
      throw new MeleeValidationError("Activity is unavailable in this phase", "WRONG_ACTIVITY_TIMING");
    }
    const reusableTriggeringDice = meleeReusableTriggeringDice(session, side, activity);
    if (selectedDice.some(die => die.state !== "available" && !reusableTriggeringDice.has(die.id))) {
      throw new MeleeValidationError("Selected die is unavailable", "DIE_ALREADY_USED");
    }

    const duelAction = duelActionForActivity(activity, responder);
    const allowsNoDice = ["flee", "allowExit"].includes(duelAction) || number(activity.activation.maxDice) === 0;
    if ((!allowsNoDice && selectedDieIds.length < activity.activation.minDice) || selectedDieIds.length > activity.activation.maxDice) {
      throw new MeleeValidationError("Invalid number of dice for activity", "INVALID_DICE_COST");
    }
    if (activity.activation.exactDice != null && selectedDieIds.length !== number(activity.activation.exactDice)) {
      throw new MeleeValidationError("Activity requires an exact number of dice", "INVALID_DICE_COST");
    }
    const selectedSuccesses = selectedDice.filter(die => die.isSuccess).length;
    if (selectedSuccesses < activity.activation.successCost) {
      throw new MeleeValidationError("Activity costs more successes than selected", "INSUFFICIENT_SUCCESSES");
    }
    const requiredSuccesses = activity.activation.requiredSuccesses ?? {};
    if (selectedSuccesses < number(requiredSuccesses.min) ||
        (requiredSuccesses.max != null && selectedSuccesses > number(requiredSuccesses.max))) {
      throw new MeleeValidationError("Selected successes do not satisfy the activity", "INSUFFICIENT_SUCCESSES");
    }
    const occupiedSegments = activity.activation.occupiedSegments?.mode === "fixed"
      ? Math.max(1, number(activity.activation.occupiedSegments.value, activity.activation.segmentCost || 1))
      : Math.max(1, selectedDieIds.length, number(activity.activation.segmentCost));
    if (session.exchange.currentSegment + occupiedSegments > session.exchange.segments.length) {
      throw new MeleeValidationError("Not enough melee segments remain", "INSUFFICIENT_SEGMENTS");
    }
    if (activity.activation.uses != null &&
        number(session.metadata.activityUses?.[activity.id]) >= number(activity.activation.uses)) {
      throw new MeleeValidationError("Configured activity has no uses remaining", "NO_USES_REMAINING");
    }
    const parameterValues = validateMeleeParameterValues(activity, command.payload?.parameterValues ?? {});
    if (!evaluateMeleeConditions(activity.conditions, {
      session, side, actor, target, item: sourceItem, activity, selectedDice,
      successPoints: selectedSuccesses, parameters: parameterValues
    })) throw new MeleeValidationError("Activity conditions are not met", "CONDITIONS_NOT_MET");

    const modifierRefs = array(command.payload?.modifierRefs).map(clone);
    const selectedModifiers = modifierRefs.map(ref => MeleeActionCatalog.findExact(actor, ref, {
      item: ref.sourceItemUuid ? fromUuidSync(ref.sourceItemUuid) : sourceItem
    }));
    if (selectedModifiers.some(modifier => !modifier || modifier.kind !== "modifier")) {
      throw new MeleeValidationError("Invalid melee modifier", "INVALID_ACTIVITY_MODIFIER");
    }
    if (selectedModifiers.some(modifier =>
        !["either", requiredRole].includes(modifier.activation.role) ||
        !["either", "modifyDeclaration", requiredTiming].includes(modifier.activation.timing) ||
        !meleeModifierMatches(modifier, activity, sourceItem) ||
        !evaluateMeleeConditions(modifier.conditions, {
          session, side, actor, target, item: sourceItem, activity,
          selectedDice, successPoints: selectedSuccesses, parameters: parameterValues
        }))) {
      throw new MeleeValidationError("Melee modifier does not match this declaration", "INVALID_ACTIVITY_MODIFIER");
    }

    const queuedSupplements = [];
    let queuedSuccessCost = 0;
    for (const submitted of array(command.payload?.queuedSupplements)) {
      const quantity = Math.min(10, Math.max(1, number(submitted.quantity, 1)));
      const supplementRef = clone(submitted.activityRef ?? {});
      const supplementItem = supplementRef.sourceItemUuid ? await fromUuid(supplementRef.sourceItemUuid) : sourceItem;
      const supplement = MeleeActionCatalog.findExact(actor, supplementRef, { item: supplementItem });
      const isSupplement = supplement && (
        supplement.kind === "modifier" ||
        supplement.source.kind === "beast" ||
        ["followUp", "supplement", "modifyDeclaration"].includes(supplement.activation.timing) ||
        array(supplement.tags).some(tag => ["melee.followUp", "melee.supplement"].includes(tag))
      );
      if (!isSupplement) {
        throw new MeleeValidationError("A standalone action cannot be queued as a supplement", "INVALID_QUEUED_ACTIVITY");
      }
      queuedSuccessCost += quantity * number(
        supplement.activation.successCost ?? supplement.activation.requiredSuccesses?.min,
        0
      );
      const supplementParameters = validateMeleeParameterValues(supplement, submitted.parameterValues ?? {});
      if (!evaluateMeleeConditions(supplement.conditions, {
        session, side, actor, target, item: supplementItem, activity: supplement,
        selectedDice, successPoints: selectedSuccesses, parameters: supplementParameters
      })) throw new MeleeValidationError("Queued activity conditions are not met", "CONDITIONS_NOT_MET");
      queuedSupplements.push({
        activityRef: supplementRef,
        parameterValues: supplementParameters,
        quantity,
        definition: supplement
      });
    }

    const adapter = MeleeExchangeContext.fromSession(session);
    const state = adapter.toDuelState();
    const diceIndices = selectedDieIds.map(id => meleePoolDice(session, side).findIndex(die => die.id === id));
    const usedKey = side === "attacker" ? "usedAttackDice" : "usedDefenseDice";
    state[usedKey] = array(state[usedKey]).filter(index => !reusableTriggeringDice.has(meleePoolDice(session, side)[index]?.id));
    const segmentIndex = adapter.getCurrentSegment();
    const initiativeBefore = session.initiative.ownerId;
    const messageAdapter = {
      id: session.messageId,
      setFlag: async (_scope, key, value) => { if (key === "opposedResult") session.result = clone(value); }
    };
    const render = async () => undefined;

    if (!responder) {
      session.exchange.history.push(adapter.createSnapshot());
      session.exchange.future = [];
      const instance = createMeleeActionInstance(activity, {
        side, actorUuid: actor.uuid, selectedDiceIds: selectedDieIds, segmentIndex,
        targetUuids: [target?.uuid].filter(Boolean), parameters: parameterValues
      });
      instance.occupiedSegments = occupiedSegments;
      instance.modifierRefs = clone(modifierRefs);
      instance.queuedSupplements = clone(queuedSupplements);
      const damageModifiers = [
        ...selectedModifiers,
        ...queuedSupplements.flatMap(entry => entry.definition?.kind === "modifier"
          ? Array.from({ length: entry.quantity }, () => entry.definition)
          : [])
      ];
      instance.damageSnapshot = meleeDamageSnapshot(actor, activity, {
        1: session.metadata.damage1, 2: session.metadata.damage2, 3: session.metadata.damage3
      }, damageModifiers);
      session.actionInstances[instance.id] = instance;
      const accepted = await DuelDeclarationEngine.processOwnerCommit(state, {
        pool: side, ownerPool: ownerSide, action: duelAction, diceIndices,
        beastQueue: null, message: messageAdapter, onRender: render
      });
      if (!accepted) {
        session.exchange.history.pop();
        delete session.actionInstances[instance.id];
        throw new MeleeValidationError("Declaration does not satisfy the melee rules", "INVALID_DECLARATION");
      }
      adapter.applyDuelState(state);
      session.exchange.declaration = {
        ownerSide: side, activityInstanceId: instance.id, activityRef: reference,
        selectedDieIds, parameterValues, modifierRefs,
        queuedSupplements: clone(instance.queuedSupplements), damageSnapshot: clone(instance.damageSnapshot),
        duelAction, duelActions: clone(state.actions ?? {})
      };
      for (const die of selectedDice) {
        die.state = "reserved";
        die.reservedByActionId = instance.id;
      }
      session.actions.declared.push(instance.id);
      session.metadata.activityUses ??= {};
      session.metadata.activityUses[activity.id] = number(session.metadata.activityUses[activity.id]) + 1;
      return { accepted: true, phase: session.phase, actionInstanceId: instance.id };
    }

    const ownerDeclaration = clone(session.exchange.declaration);
    const ownerInstance = session.actionInstances[ownerDeclaration?.activityInstanceId];
    if (!ownerDeclaration || !ownerInstance) throw new MeleeValidationError("Owner declaration is missing", "DECLARATION_NOT_FOUND");
    const responsePolicy = ownerInstance.definition.activation.responsePolicy || "exact";
    if (["exact", "exactCommittedDice"].includes(responsePolicy) &&
        selectedDieIds.length !== ownerDeclaration.selectedDieIds.length && !allowsNoDice) {
      throw new MeleeValidationError("Responder must select exactly the declared number of dice", "INVALID_RESPONSE_DICE_COUNT");
    }
    const responseInstance = createMeleeActionInstance(activity, {
      side, actorUuid: actor.uuid, selectedDiceIds: selectedDieIds, segmentIndex,
      targetUuids: [target?.uuid].filter(Boolean), parameters: parameterValues
    });
    responseInstance.occupiedSegments = occupiedSegments;
    responseInstance.modifierRefs = clone(modifierRefs);
    responseInstance.queuedSupplements = clone(queuedSupplements);
    session.actionInstances[responseInstance.id] = responseInstance;
    const accepted = await DuelSegmentEngine.processResponder(state, {
      pool: side, responderPool: side, isOwnerAttacker: ownerSide === "attacker",
      diceIndices, action: duelAction, message: messageAdapter, onRender: render,
      onSyncInitiative: async () => undefined, onClearManeuvers: async () => undefined
    });
    if (!accepted) {
      delete session.actionInstances[responseInstance.id];
      throw new MeleeValidationError("Response does not satisfy the melee rules", "INVALID_DECLARATION");
    }
    adapter.applyDuelState(state);
    const resolvedSegment = session.exchange.segments[segmentIndex] ?? {};
    resolvedSegment.ownerActionId = ownerInstance.id;
    resolvedSegment.responderActionId = responseInstance.id;
    resolvedSegment.ownerDiceIds = clone(ownerDeclaration.selectedDieIds);
    resolvedSegment.responderDiceIds = clone(selectedDieIds);
    resolvedSegment.span = Math.max(1, number(ownerInstance.occupiedSegments, ownerInstance.selectedDiceIds.length));
    for (let offset = 1; offset < resolvedSegment.span; offset++) {
      const occupied = session.exchange.segments[segmentIndex + offset];
      if (occupied && occupied.outcome == null) occupied.outcome = "spent";
    }
    const requiredNextSegment = segmentIndex + resolvedSegment.span;
    if (session.exchange.currentSegment < requiredNextSegment) {
      session.exchange.currentSegment = Math.min(session.exchange.segments.length, requiredNextSegment);
    }
    if (requiredNextSegment >= session.exchange.segments.length) {
      session.phase = "complete";
      session.status = "complete";
    }
    session.actions.resolved.push(ownerInstance.id, responseInstance.id);

    const event = resolvedSegment.outcome === "hit" ? "hit"
      : resolvedSegment.outcome === "takeover" ? "takeover"
        : ["blocked", "nothing"].includes(resolvedSegment.outcome) ? "miss"
          : resolvedSegment.outcome === "draw" ? "hit" : resolvedSegment.outcome;
    const supplementDefinitions = array(ownerInstance.queuedSupplements).flatMap(supplement =>
      Array.from({ length: number(supplement.quantity, 1) }, () => supplement.definition)
    ).filter(definition => definition?.kind !== "modifier");
    const definitions = [
      ...array(ownerInstance.definition.outcomes).filter(outcome => ["used", "onResolve", event].includes(outcome.when)),
      ...(ownerInstance.definition.operations.length ? [{
        id: `${ownerInstance.activityId}-operations`, label: ownerInstance.definition.name,
        operations: ownerInstance.definition.operations, approval: ownerInstance.definition.automation.approval
      }] : []),
      ...supplementDefinitions.flatMap(definition => [
        ...array(definition.outcomes).filter(outcome => ["used", "onResolve", event].includes(outcome.when)),
        ...(definition.operations.length ? [{
          id: `${definition.id}-operations`, label: definition.name,
          operations: definition.operations, approval: definition.automation.approval
        }] : [])
      ]),
      ...(ownerInstance.definition.test && (event === "hit" || ownerInstance.definition.category !== "attack") ? [{
        id: `${ownerInstance.activityId}-required-test`,
        label: ownerInstance.definition.name,
        approval: "automatic",
        operations: [{
          id: `${ownerInstance.activityId}-required-test`, type: "requiredTest", target: "opponent",
          data: {
            title: ownerInstance.definition.name,
            testType: ownerInstance.definition.test.type || "attribute",
            testKey: ownerInstance.definition.test.key || "constitution",
            baseDifficulty: ownerInstance.definition.test.difficulty || "average",
            requiredSuccesses: number(ownerInstance.definition.test.requiredSuccesses, 1),
            isOpen: ownerInstance.definition.test.isOpen === true
          }
        }]
      }] : [])
    ];
    for (const outcomeDefinition of definitions) {
      if (!evaluateMeleeConditions(outcomeDefinition.conditions, {
        session, side: ownerInstance.side, actor, target, item: sourceItem,
        activity: ownerInstance.definition,
        selectedDice: ownerInstance.selectedDiceIds.map(id =>
          meleePoolDice(session, ownerInstance.side).find(die => die.id === id)
        ).filter(Boolean),
        successPoints: ownerInstance.selectedDiceIds.filter(id =>
          meleePoolDice(session, ownerInstance.side).find(die => die.id === id)?.isSuccess
        ).length,
        parameters: ownerInstance.parameters
      })) continue;
      const operations = array(outcomeDefinition.operations).filter(operation => operation.type !== "damage").map(normalizeOperation);
      if (!operations.length) continue;
      const outcome = normalizePendingOutcome({
        actionInstanceId: ownerInstance.id, label: outcomeDefinition.label || ownerInstance.definition.name,
        approval: outcomeDefinition.approval === "inherit" ? ownerInstance.definition.automation.approval : outcomeDefinition.approval,
        operations, data: { difference: 0, location: session.metadata.location ?? null, parameters: ownerInstance.parameters }
      });
      session.pendingOutcomes.push(outcome);
      if (outcome.approval === "automatic") await this._applyOutcome(session, outcome);
    }
    await MeleeEffectService.expire(session, "segmentEnd", { segmentIndex });
    if (initiativeBefore !== session.initiative.ownerId) {
      await MeleeEffectService.expire(session, "initiativeChange", {
        previousOwnerId: initiativeBefore, ownerId: session.initiative.ownerId
      });
    }
    if (queuedSuccessCost > selectedSuccesses) {
      throw new MeleeValidationError("Queued activities cost more successes than selected", "INSUFFICIENT_SUCCESSES");
    }
    if (session.status === "complete") await MeleeEffectService.expire(session, "sessionEnd", {});
    else await MeleeEffectService.expire(session, "segmentStart", { segmentIndex: session.exchange.currentSegment });
    return { accepted: true, phase: session.phase, actionInstanceId: ownerInstance.id };
  }

  // Read-only migration aid for cards created by preview builds. It is not
  // registered in the command dispatcher and cannot be reached by runtime UI.
  static async _deprecatedCardAdapter(session, command) {
    const exchangeAdapter = MeleeExchangeContext.fromSession(session);
    const state = exchangeAdapter.toDuelState();
    if (!state || state.status !== "picking") {
      throw new MeleeValidationError("Duel is not waiting for a declaration", "WRONG_PHASE");
    }
    const pool = command.payload?.pool;
    const diceIndices = [...new Set(array(command.payload?.diceIndices).map(Number))];
    const side = pool === "attacker" ? "attacker" : pool === "defender" ? "defender" : null;
    if (!side || diceIndices.some(index => !Number.isInteger(index))) {
      throw new MeleeValidationError("Invalid melee dice selection", "INVALID_DICE_SELECTION");
    }
    const selected = diceIndices.map(index => meleePoolDice(session, side)[index]);
    if (selected.some(die => !die || die.state === "spent")) {
      throw new MeleeValidationError("Selected die is unavailable", "DIE_ALREADY_USED");
    }
    const wasResponder = state.waitingFor === "responder";
    const ownerSideBefore = state.initiativeOwnerSide;
    const initiativeOwnerBefore = session.initiative.ownerId;
    const submittedRuntimeId = !wasResponder && typeof command.payload?.action === "object"
      ? command.payload.action.runtimeId ?? null
      : null;
    const submittedSnapshot = submittedRuntimeId
      ? array(session.metadata.activitySnapshots?.[ownerSideBefore]).find(entry => entry.runtimeId === submittedRuntimeId)
      : null;
    let authoritativeAction = typeof command.payload?.action === "object" ? "trick" : command.payload?.action;
    if (submittedRuntimeId && submittedSnapshot) {
      const definition = submittedSnapshot.definition;
      const successPoints = selected.filter(die => die.isSuccess).length;
      if (!["either", "owner"].includes(definition.activation.role) ||
          !["either", "declaration"].includes(definition.activation.timing)) {
        throw new MeleeValidationError("Configured activity is unavailable for the initiative owner", "WRONG_ACTIVITY_TIMING");
      }
      if (diceIndices.length < definition.activation.minDice || diceIndices.length > definition.activation.maxDice ||
          successPoints < definition.activation.successCost) {
        throw new MeleeValidationError("Configured activity cost is not satisfied", "INVALID_ACTIVITY_COST");
      }
      const actorDocument = await fromUuid(session.participants[ownerSideBefore].tokenUuid || session.participants[ownerSideBefore].actorUuid);
      const targetSide = ownerSideBefore === "attacker" ? "defender" : "attacker";
      const targetDocument = await fromUuid(session.participants[targetSide].tokenUuid || session.participants[targetSide].actorUuid);
      const actor = actorDocument?.actor ?? actorDocument;
      const target = targetDocument?.actor ?? targetDocument;
      if (!evaluateMeleeConditions(definition.conditions, {
        session, side: ownerSideBefore, actor, target, activity: definition, selectedDice: selected, successPoints
      })) throw new MeleeValidationError("Configured activity conditions are not met", "CONDITIONS_NOT_MET");
      const uses = definition.activation.uses;
      if (uses != null && number(session.metadata.activityUses?.[definition.id]) >= number(uses)) {
        throw new MeleeValidationError("Configured activity has no uses remaining", "NO_USES_REMAINING");
      }
      authoritativeAction = duelActionForActivity(definition, false);
    }
    const ownerIndicesBefore = [...(state.committedOwnerIndices ?? [])];
    const runtimeActivityId = wasResponder ? state.committedTrickId : null;
    const activitySnapshot = runtimeActivityId
      ? array(session.metadata.activitySnapshots?.[ownerSideBefore]).find(entry => entry.runtimeId === runtimeActivityId)
      : null;
    const segmentIndexBefore = number(state.currentSegment);
    const messageAdapter = {
      id: session.messageId,
      setFlag: async (_scope, key, value) => {
        if (key === "opposedResult") session.result = clone(value);
      }
    };
    const render = async () => undefined;
    let accepted = false;
    if (state.waitingFor === "initiativeOwner") {
      const ownerPool = state.initiativeOwnerSide === "attacker" ? "attacker" : "defender";
      accepted = await DuelDeclarationEngine.processOwnerCommit(state, {
        pool, ownerPool,
        action: authoritativeAction,
        diceIndices,
        beastQueue: command.payload?.queue ?? null,
        message: messageAdapter,
        onRender: render
      });
    } else {
      const isOwnerAttacker = state.initiativeOwnerSide === "attacker";
      const responderPool = isOwnerAttacker ? "defender" : "attacker";
      accepted = await DuelSegmentEngine.processResponder(state, {
        pool, responderPool, isOwnerAttacker,
        diceIndices,
        action: authoritativeAction,
        message: messageAdapter,
        onRender: render,
        onSyncInitiative: async () => undefined,
        onClearManeuvers: async () => undefined
      });
    }
    if (!accepted) throw new MeleeValidationError("Declaration does not satisfy the melee rules", "INVALID_DECLARATION");
    if (submittedSnapshot) {
      session.metadata.activityUses ??= {};
      session.metadata.activityUses[submittedSnapshot.definition.id] =
        number(session.metadata.activityUses[submittedSnapshot.definition.id]) + 1;
    }
    if (wasResponder && activitySnapshot) {
      const definition = activitySnapshot.definition;
      const ownerActorUuid = session.participants[ownerSideBefore].actorUuid;
      const targetSide = ownerSideBefore === "attacker" ? "defender" : "attacker";
      const instance = createMeleeActionInstance(definition, {
        side: ownerSideBefore,
        actorUuid: ownerActorUuid,
        selectedDiceIds: ownerIndicesBefore.map(index => meleePoolDice(session, ownerSideBefore)[index]?.id).filter(Boolean),
        segmentIndex: segmentIndexBefore,
        targetUuids: [session.participants[targetSide].actorUuid]
      });
      session.actionInstances[instance.id] = instance;
      const segmentOutcome = state.segments[segmentIndexBefore]?.outcome;
      const event = segmentOutcome === "hit" ? "hit"
        : segmentOutcome === "takeover" ? "takeover"
          : ["blocked", "nothing"].includes(segmentOutcome) ? "miss"
            : segmentOutcome === "draw" ? "hit" : segmentOutcome;
      const definitions = [
        ...array(definition.outcomes).filter(outcome => ["used", "onResolve", event].includes(outcome.when)),
        ...(definition.operations.length ? [{
          id: `${definition.id}-operations`, label: definition.name,
          operations: definition.operations, approval: definition.automation.approval
        }] : [])
      ];
      for (const outcomeDefinition of definitions) {
        const operations = array(outcomeDefinition.operations)
          .filter(operation => operation.type !== "damage")
          .map(normalizeOperation);
        if (!operations.length) continue;
        const outcome = normalizePendingOutcome({
          actionInstanceId: instance.id,
          label: outcomeDefinition.label || definition.name,
          approval: outcomeDefinition.approval === "inherit"
            ? definition.automation.approval : outcomeDefinition.approval,
          operations,
          data: { difference: 0, location: session.metadata.location ?? null }
        });
        session.pendingOutcomes.push(outcome);
        if (outcome.approval === "automatic") await this._applyOutcome(session, outcome);
      }
    }
    exchangeAdapter.applyDuelState(state);
    if (wasResponder) {
      await MeleeEffectService.expire(session, "segmentEnd", { segmentIndex: segmentIndexBefore });
      if (initiativeOwnerBefore !== session.initiative.ownerId) {
        await MeleeEffectService.expire(session, "initiativeChange", {
          previousOwnerId: initiativeOwnerBefore, ownerId: session.initiative.ownerId
        });
      }
      if (session.status === "complete") await MeleeEffectService.expire(session, "sessionEnd", {});
      else await MeleeEffectService.expire(session, "segmentStart", { segmentIndex: session.exchange.currentSegment });
    }
    return { accepted: true, phase: session.phase };
  }

  static _undo(session) {
    if (session.result?.applied || session.hailResult?.applied ||
        session.pendingOutcomes.some(outcome => outcome.status === "applied") ||
        Object.values(session.operationLedger ?? {}).some(entry => ["running", "applied"].includes(entry?.status))) {
      throw new MeleeValidationError("Applied outcomes cannot be undone", "OUTCOME_ALREADY_APPLIED");
    }
    const history = array(session.exchange?.history);
    if (!history.length) throw new MeleeValidationError("Nothing to undo", "NOTHING_TO_UNDO");
    const current = exchangeSnapshot(session);
    const previous = clone(history.at(-1));
    const remainingHistory = history.slice(0, -1);
    const future = [current, ...array(session.exchange.future).map(clone)];
    restoreExchangeSnapshot(session, previous);
    session.exchange.history = remainingHistory;
    session.exchange.future = future;
    return { undone: true };
  }

  static _redo(session) {
    if (session.result?.applied || session.hailResult?.applied ||
        session.pendingOutcomes.some(outcome => outcome.status === "applied") ||
        Object.values(session.operationLedger ?? {}).some(entry => ["running", "applied"].includes(entry?.status))) {
      throw new MeleeValidationError("Applied outcomes cannot be redone", "OUTCOME_ALREADY_APPLIED");
    }
    const future = array(session.exchange?.future);
    if (!future.length) throw new MeleeValidationError("Nothing to redo", "NOTHING_TO_REDO");
    const current = exchangeSnapshot(session);
    const next = clone(future[0]);
    const history = [...array(session.exchange.history).map(clone), current];
    restoreExchangeSnapshot(session, next);
    session.exchange.history = history;
    session.exchange.future = future.slice(1);
    return { redone: true };
  }

  static _swapInitiative(session) {
    if (session.status !== "active" || session.variant === "gradCiosow") {
      throw new MeleeValidationError("Initiative cannot be swapped now", "WRONG_PHASE");
    }
    if (session.exchange.declaration) {
      const declaration = session.exchange.declaration;
      MeleeExchangeContext.fromSession(session).releaseDice(declaration.ownerSide, declaration.selectedDieIds);
      session.exchange.declaration = null;
      session.phase = "declaration";
    }
    const ownerSide = initiativeSide(session) === "attacker" ? "defender" : "attacker";
    transferMeleeInitiative(session, session.participants[ownerSide].actorUuid, "gmSwap");
    return { ownerSide };
  }

  static _markApplied(session, command) {
    const kind = ["hail", "beast"].includes(command.payload?.kind) ? command.payload.kind : "duel";
    if (kind === "hail") {
      if (!session.hailResult) throw new MeleeValidationError("Hail result not found", "RESULT_NOT_FOUND");
      if (session.hailResult.applied) throw new MeleeValidationError("Damage was already applied", "ALREADY_APPLIED");
      session.hailResult.applied = true;
    } else if (kind === "beast") {
      if (!session.result) throw new MeleeValidationError("Duel result not found", "RESULT_NOT_FOUND");
      if (session.result.beastActionsApplied) throw new MeleeValidationError("Beast actions were already applied", "ALREADY_APPLIED");
      session.result.beastActionsApplied = true;
      session.result.applied = true;
    } else {
      if (!session.result) throw new MeleeValidationError("Duel result not found", "RESULT_NOT_FOUND");
      if (session.result.applied) throw new MeleeValidationError("Damage was already applied", "ALREADY_APPLIED");
      session.result.applied = true;
    }
    const ledgerKey = `${session.id}:damage:${kind === "beast" ? "duel" : kind}`;
    session.operationLedger[ledgerKey] = { status: "applied", appliedAt: Date.now() };
    return { applied: true, kind };
  }

  static _claimDamage(session, command) {
    const kind = command.payload?.kind === "hail" ? "hail" : "duel";
    const ledgerKey = `${session.id}:damage:${kind}`;
    const ledger = session.operationLedger[ledgerKey];
    if (ledger?.status === "running" || ledger?.status === "applied") {
      throw new MeleeValidationError("Damage is already being applied or was applied", "ALREADY_APPLIED");
    }
    session.operationLedger[ledgerKey] = {
      status: "running", startedAt: Date.now(), userId: command.userId
    };
    return { claimed: true, kind };
  }

  static async _approveOutcome(session, command) {
    const outcome = session.pendingOutcomes.find(entry => entry.id === command.payload?.outcomeId);
    if (!outcome || outcome.status !== "pending") throw new MeleeValidationError("Pending outcome not found", "OUTCOME_NOT_FOUND");
    await this._applyOutcome(session, outcome);
    if (session.pendingOutcomes.every(entry => entry.status === "applied")) session.phase = "resolution";
    return clone(outcome);
  }

  static async _resolveRequiredTest(session, command) {
    const action = session.actionInstances[command.payload?.actionInstanceId];
    if (!action) throw new MeleeValidationError("Required-test action was not found", "ACTION_NOT_FOUND");
    const when = command.payload?.isSuccess === true ? "testSuccess" : "testFailure";
    const definitions = array(action.definition.outcomes).filter(outcome => outcome.when === when);
    const created = [];
    for (const definition of definitions) {
      const outcome = normalizePendingOutcome({
        id: `${command.payload?.requiredTestMessageId || command.commandId}:${definition.id}`,
        actionInstanceId: action.id,
        label: definition.label || action.definition.name,
        approval: definition.approval === "inherit" ? action.definition.automation.approval : definition.approval,
        operations: definition.operations,
        data: { requiredTestSuccess: command.payload?.isSuccess === true }
      });
      session.pendingOutcomes.push(outcome);
      created.push(outcome.id);
      if (outcome.approval === "automatic") await this._applyOutcome(session, outcome);
    }
    return { resolved: true, isSuccess: command.payload?.isSuccess === true, outcomeIds: created };
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
    const currentSegment = session.exchange.currentSegment;
    await MeleeEffectService.expire(session, "segmentEnd", { segmentIndex: currentSegment });
    session.exchange.currentSegment += Math.max(1, number(session.exchange.segments[currentSegment]?.span, 1));
    session.exchange.declaration = null;
    if (session.exchange.currentSegment >= session.exchange.segments.length ||
        MELEE_SIDES.every(side => meleePoolDice(session, side).every(die => die.state === "spent"))) {
      return this._endSession(session, "segmentsComplete");
    }
    session.phase = "declaration";
    await MeleeEffectService.expire(session, "segmentStart", { segmentIndex: session.exchange.currentSegment });
    return { segmentIndex: session.exchange.currentSegment };
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
  static previewDocument(document) {
    if (!document) return { documentUuid: null, activities: [], writes: 0 };
    let activities = [];
    if (["beast-action", "beast-segment"].includes(document.type)) {
      activities = MeleeActionCatalog.fromBeastItem(document);
    } else if (document.documentName === "ActiveEffect") {
      activities = MeleeActionCatalog.fromEffect(document);
    } else {
      activities = array(document.getFlag?.("neuroshima", "meleeActivities"))
        .map(entry => normalizeMeleeActivity(entry, { kind: "item", itemUuid: document.uuid }));
    }
    const unique = new Map(activities.map(activity => [
      `${activity.source.effectUuid || activity.source.itemUuid || activity.source.uuid}::${activity.id}`,
      activity
    ]));
    return {
      documentUuid: document.uuid,
      activities: [...unique.values()].map(clone),
      writes: 0,
      legacyPreserved: true
    };
  }

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
            operations: array(raw.operations).length ? raw.operations : fallbackBeastOperations(item, raw)
          }, { kind: "beast", uuid: `${item.uuid}#${raw.id}`, itemUuid: item.uuid });
          return {
            ...raw,
            kind: normalized.kind,
            category: normalized.category,
            description: normalized.description,
            tags: normalized.tags,
            activation: normalized.activation,
            parameters: normalized.parameters,
            test: normalized.test,
            meleeDamage: normalized.damage,
            selectors: normalized.selectors,
            changes: normalized.changes,
            priority: normalized.priority,
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
  id = randomId(), attacker, defender, initiativeOwnerId, variant = "standard",
  mode = "opposedPips", messageId = null, attackerRoll = null,
  metadata = {}, startCommandId = randomId()
} = {}) {
  if (!game.user?.isGM) {
    throw new MeleeValidationError("Session creation must be requested through the GM", "GM_REQUIRED");
  }
  return MeleeStartService.run(startCommandId, async () => {
    const existing = MeleeSessionStore.list(game.combat).find(candidate =>
      candidate.metadata?.startCommandId === startCommandId
    );
    if (existing) {
      Hooks.callAll("neuroshimaMeleeSessionUpdated", clone(existing), { type: "resumeSession" }, null);
      return existing;
    }

    const session = createMeleeSession({
      id, attacker, defender, initiativeOwnerId,
      combatId: game.combat?.id ?? null,
      messageId, variant, mode,
      metadata: { ...metadata, startCommandId }
    });
    const message = messageId ? game.messages.get(messageId) : null;
    if (!message) throw new MeleeValidationError("Primary melee ChatMessage not found", "MESSAGE_NOT_FOUND");
    session.messages.pendingMessageId = message.id;
    session.messages.duelMessageId = message.id;
    session.messages.attackerRollMessageId = metadata.attackerTestMessageId ?? null;
    if (attackerRoll) {
      setMeleePool(session, "attacker", attackerRoll.dice);
      session.phase = "awaitingDefenderRoll";
      session.metadata.attackerTarget = number(attackerRoll.target);
    }
    await MeleeSessionStore.create(session, { combat: game.combat, message });
    await message.update({
      "flags.neuroshima.melee": {
        sessionId: session.id, cardType: "pending", renderedRevision: session.revision
      }
    });
    Hooks.callAll("neuroshimaMeleeSessionUpdated", clone(session), { type: "startSession" }, null);
    return session;
  });
}

async function bindMeleeResultMessage(sessionId, messageId, expectedRevision) {
  if (!game.user?.isGM) throw new MeleeValidationError("Only the GM may bind a melee result card", "GM_REQUIRED");
  const session = await MeleeSessionStore.get(sessionId);
  if (!session) throw new MeleeValidationError("Melee session not found", "SESSION_NOT_FOUND");
  if (session.messages.duelMessageId && session.messages.duelMessageId !== session.messages.pendingMessageId) {
    return session;
  }
  // Rendering may overlap a legitimate test-message synchronization. Binding
  // is idempotent by session and may follow the newest revision as long as no
  // result card has already been attached.
  expectedRevision = session.revision;
  session.messages.duelMessageId = messageId;
  session.messages.resultMessageId = messageId;
  session.messageId = messageId;
  await MeleeSessionStore.save(session, { expectedRevision });
  Hooks.callAll("neuroshimaMeleeSessionUpdated", clone(session), { type: "bindResultMessage" }, null);
  return session;
}

export function registerMeleeSystemSettings() {
  game.settings.register("neuroshima", MELEE_WORLD_STORE_SETTING, {
    scope: "world", config: false, type: Object, default: {}
  });
}

export function isMeleeEnabled() {
  return true;
}

export async function expireMeleeEffects(event, payload = {}, combat = game.combat) {
  if (!game.user?.isGM || !isMeleeEnabled() || !combat) return [];
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
    enabled: isMeleeEnabled,
    start: startMeleeSession,
    requestStart: payload => {
      const request = { ...payload, startCommandId: payload?.startCommandId || randomId() };
      return game.user.isGM
      ? startMeleeSession(request)
      : game.neuroshima.socket.executeAsGM(MELEE_SOCKET_COMMAND, {
          type: "startSession", userId: game.user.id, payload: request
        });
    },
    bindResultMessage: (sessionId, messageId, expectedRevision) =>
      bindMeleeResultMessage(sessionId, messageId, expectedRevision),
    createSession: createMeleeSession,
    participant: meleeParticipantFromActor,
    sideForActor,
    requiredAction: buildMeleeRequiredAction,
    get: (...args) => MeleeSessionStore.get(...args),
    list: (...args) => MeleeSessionStore.list(...args),
    dispatch: command => game.user.isGM
      ? MeleeCommandService.dispatch({ ...command, userId: command.userId || game.user.id })
      : game.neuroshima.socket.executeAsGM(MELEE_SOCKET_COMMAND, { ...command, userId: game.user.id }),
    syncTest: async test => {
      const link = test?.context?.opposedLink;
      if (!isMeleeSessionLink(link) || !MELEE_SIDES.includes(link.role)) return null;
      const session = await MeleeSessionStore.get(link.sessionId, { messageId: link.messageId });
      if (!session) return null;
      const result = test.result ?? {};
      const dice = array(result.modifiedResults).map((die, index) => ({
        id: meleePoolDice(session, link.role)[index]?.id || `die-${index + 1}-${randomId()}`,
        raw: die.original ?? result.rawResults?.[index] ?? die.modified,
        modified: die.modified ?? die.original,
        target: result.target,
        isSuccess: die.isSuccess === true,
        successPoints: die.isSuccess === true ? 1 : 0,
        changes: array(result.diceChanges).filter(change => change.index === index)
      }));
      return api.dispatch({
        type: "replaceRoll", side: link.role, payload: { dice, target: result.target },
        sessionId: session.id, messageId: session.messageId,
        expectedRevision: session.revision, commandId: randomId()
      });
    },
    catalog: MeleeActionCatalog,
    conditions: MeleeConditionRegistry,
    operations: MeleeOperationRegistry,
    effects: MeleeEffectService,
    migration: MeleeMigration,
    previewMigration: document => MeleeMigration.previewDocument(document)
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
  assert(session.exchange.segments.length === 3, "three segment invariant");
  setMeleePool(session, "attacker", [{ raw: 1, isSuccess: true }, { raw: 10 }, { raw: 20 }]);
  assert(meleePoolDice(session, "attacker").length === 3, "three dice invariant");
  meleePoolDice(session, "attacker")[0].state = "spent";
  let reuseRejected = false;
  try { MeleeResolver._selectedDice(session, "attacker", [meleePoolDice(session, "attacker")[0].id]); }
  catch (error) { reuseRejected = error.code === "DIE_ALREADY_USED"; }
  assert(reuseRejected, "used die rejected");
  transferMeleeInitiative(session, defender.actorUuid, "test");
  assert(session.initiative.ownerId === defender.actorUuid, "engagement initiative transfer");
  const activity = normalizeMeleeActivity({ id: "x", minDice: 1, maxDice: 2, successCost: 1 });
  assert(activity.activation.successCost === 1, "activity normalization");
  const operationIds = new Set(["a", "b", "c"].map(id => `${session.id}:o:${id}`));
  assert(operationIds.size === 3, "operation ids stable and unique");
  assert([1, 2, 3].every(length => normalizeMeleePool(
    Array.from({ length }, (_, index) => ({ raw: index + 1 }))
  ).length === length), "one, two and three die pools accepted");
  let invalidPoolRejected = 0;
  for (const pool of [[], [{}, {}, {}, {}]]) {
    try { normalizeMeleePool(pool); }
    catch (error) { if (error.code === "INVALID_DICE_POOL") invalidPoolRejected++; }
  }
  assert(invalidPoolRejected === 2, "zero and four die pools rejected");
  const hailBlocked = resolveMeleeHail([{ isSuccess: true }], [{ isSuccess: true }], { 1: "D", 2: "L", 3: "C" });
  const hailTierThree = resolveMeleeHail(
    [{ isSuccess: true }, { isSuccess: true }, { isSuccess: true }],
    [{ isSuccess: false }],
    { 1: "D", 2: "L", 3: "C" }
  );
  assert(hailBlocked.blocked && hailBlocked.tier === 0, "hail draw is blocked");
  assert(!hailTierThree.blocked && hailTierThree.tier === 3 && hailTierThree.damage === "C", "hail uses real pools and caps tier at three");
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
  assert(secondPool.length === 3 && meleePoolDice(session, "attacker").length === 3, "both melee sides accept up to 3d20");
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
  setMeleePool(defenseSession, "attacker", [
    { raw: 1, isSuccess: true }, { raw: 18, isSuccess: false }, { raw: 19, isSuccess: false }
  ]);
  setMeleePool(defenseSession, "defender", [
    { raw: 1, isSuccess: true }, { raw: 2, isSuccess: true }, { raw: 19, isSuccess: false }
  ]);
  const attackDefinition = normalizeMeleeActivity({
    id: "effect-hit", category: "attack", timing: "either",
    outcomes: [{ id: "apply", when: "hit", operations: [{ id: "effect", type: "applyEffect" }] }]
  });
  const defenseDefinition = normalizeMeleeActivity({ id: "block", category: "defense", timing: "either" });
  const attackInstance = createMeleeActionInstance(attackDefinition, {
    side: "attacker", actorUuid: attacker.actorUuid,
    selectedDiceIds: meleePoolDice(defenseSession, "attacker").map(die => die.id)
  });
  const defenseInstance = createMeleeActionInstance(defenseDefinition, {
    side: "defender", actorUuid: defender.actorUuid,
    selectedDiceIds: meleePoolDice(defenseSession, "defender").map(die => die.id)
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
  try { await MeleeCommandService._authorize(session, { side: "attacker" }, { id: "intruder", active: true, isGM: false }); }
  catch (error) { unauthorized = error.code === "UNAUTHORIZED"; }
  assert(unauthorized, "non-owner command rejected");
  await MeleeCommandService._authorize(session, { side: "attacker" }, { id: "gm", active: true, isGM: true });
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
