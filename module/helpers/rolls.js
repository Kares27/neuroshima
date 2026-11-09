/** Roll routing, choices, dialog modifiers and result presentation. */
import { effectChanges, effectChangeType, numericEffectValue, NeuroshimaSocket } from "./foundry-compat.js";
import { TraitChoiceDialog } from "../apps/dialogs/trait-choice-dialog.js";
import { ListChoiceDialog } from "../apps/dialogs/list-choice-dialog.js";
import { PointAllocationDialog } from "../apps/dialogs/point-allocation-dialog.js";

/**
 * Shared renderer for rich Neuroshima tooltips.
 *
 * Dynamic labels and document names are escaped here so every caller can pass
 * ordinary strings without having to build HTML fragments itself.
 */

const TOOLTIP_STATES = new Set(["penalty", "bonus", "success", "failure", "ignored"]);

export function escapeTooltipHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

export function signedTooltipValue(value) {
  const number = Number(value ?? 0);
  return number >= 0 ? `+${number}` : String(number);
}

function localize(value) {
  if (value === null || value === undefined) return "";
  return globalThis.game?.i18n?.localize?.(value) ?? String(value);
}

/**
 * Render one compact "field dossier" panel.
 *
 * Threshold/summary sections are always moved to the bottom, regardless of
 * the order in which domain test classes append their sections.
 */
export function renderTooltipSections(sections = []) {
  const visibleSections = sections.filter(section => section?.rows?.length);
  const orderedSections = [
    ...visibleSections.filter(section => section.kind !== "threshold"),
    ...visibleSections.filter(section => section.kind === "threshold")
  ];
  const renderedSections = orderedSections.map((section, sectionIndex) => {
    const sectionClasses = ["ns-roll-tooltip__section"];
    if (section.kind === "threshold") sectionClasses.push("ns-roll-tooltip__section--threshold");
    const rows = section.rows.map(row => {
      const rowClasses = ["ns-roll-tooltip__row"];
      if (TOOLTIP_STATES.has(row.state)) rowClasses.push(`is-${row.state}`);
      if (row.emphasis === true) rowClasses.push("is-emphasized");
      if (row.indent === true) rowClasses.push("is-subrow");
      const value = row.signed ? signedTooltipValue(row.value) : row.value;
      const suffix = row.suffix ?? "";
      return [
        `<div class="${rowClasses.join(" ")}">`,
        `<dt class="ns-roll-tooltip__label">${escapeTooltipHtml(localize(row.label))}</dt>`,
        `<dd class="ns-roll-tooltip__value">${escapeTooltipHtml(value)}${escapeTooltipHtml(suffix)}</dd>`,
        "</div>"
      ].join("");
    }).join("");
    const header = section.kind === "threshold" ? "" : [
      '<header class="ns-roll-tooltip__section-header">',
      `<span class="ns-roll-tooltip__section-number">${String(sectionIndex + 1).padStart(2, "0")}</span>`,
      `<h3 class="ns-roll-tooltip__section-title">${escapeTooltipHtml(localize(section.title))}</h3>`,
      "</header>"
    ].join("");
    return [
      `<section class="${sectionClasses.join(" ")}">`,
      header,
      `<dl class="ns-roll-tooltip__rows">${rows}</dl>`,
      "</section>"
    ].join("");
  }).join("");
  return `<div class="ns-roll-tooltip">${renderedSections}</div>`;
}

/** Build the shared d1-d3 result section used by roll tooltips. */
export function buildDiceTooltipSection(result = {}) {
  const rawResults = Array.isArray(result.rawResults) ? result.rawResults : [];
  const dice = Array.isArray(result.modifiedResults) && result.modifiedResults.length
    ? result.modifiedResults
    : rawResults.map((value, index) => ({ original: value, modified: value, index }));
  if (!dice.length) return null;

  return {
    title: "NEUROSHIMA.Tooltip.Dice",
    rows: dice.slice(0, 3).map((die, index) => {
      const original = Number(die.original ?? rawResults[index] ?? die.modified ?? 0);
      const modified = Number(die.modified ?? original);
      return {
        label: globalThis.game?.i18n?.format?.("NEUROSHIMA.Tooltip.Die", { index: index + 1 })
          ?? `d${index + 1}`,
        value: modified !== original ? `${original} → ${modified}` : original,
        state: die.ignored ? "ignored" : die.isSuccess === true ? "success"
          : die.isSuccess === false ? "failure" : null
      };
    })
  };
}

/**
 * Render a value breakdown with named effect/item/script sources.
 */
export function buildBreakdownTooltip({
  title = "NEUROSHIMA.Tooltip.EffectsSection",
  baseLabel = "NEUROSHIMA.Tooltip.BaseValue",
  baseValue = null,
  sources = [],
  totalLabel = "NEUROSHIMA.Roll.Total",
  totalValue = null,
  suffix = ""
} = {}) {
  const normalizedSources = (sources ?? [])
    .map(source => ({
      label: source?.label ?? source?.name ?? "?",
      value: source?.value,
      suffix: source?.suffix ?? suffix,
      signed: source?.signed,
      state: source?.state
    }))
    .filter(source => source.value !== null && source.value !== undefined && source.value !== "");
  if (!normalizedSources.length) return "";

  const rows = [];
  if (baseValue !== null && baseValue !== undefined) {
    rows.push({ label: baseLabel, value: baseValue, suffix });
  }
  for (const source of normalizedSources) {
    const numericValue = Number(source.value);
    rows.push({
      label: source.label,
      value: Number.isFinite(numericValue) ? numericValue : source.value,
      signed: source.signed ?? Number.isFinite(numericValue),
      suffix: source.suffix,
      indent: true,
      state: source.state ?? (Number.isFinite(numericValue)
        ? (numericValue > 0 ? "bonus" : numericValue < 0 ? "penalty" : null)
        : null)
    });
  }

  const sections = [{ title, rows }];
  if (totalValue !== null && totalValue !== undefined) {
    sections.push({
      kind: "threshold",
      rows: [{ label: totalLabel, value: totalValue, suffix, emphasis: true }]
    });
  }
  return renderTooltipSections(sections);
}

/**
 * Wrap sanitized Foundry HTML (for example an HTMLField description) in the
 * same dossier frame as numeric breakdowns. Callers must only pass content
 * that has already gone through Foundry's document-field sanitization.
 */
export function buildRichTextTooltip({ title, html } = {}) {
  if (!html) return "";
  return [
    '<div class="ns-roll-tooltip">',
    '<section class="ns-roll-tooltip__section">',
    '<header class="ns-roll-tooltip__section-header">',
    '<span class="ns-roll-tooltip__section-number">01</span>',
    `<h3 class="ns-roll-tooltip__section-title">${escapeTooltipHtml(localize(title))}</h3>`,
    "</header>",
    `<div class="ns-roll-tooltip__content">${String(html)}</div>`,
    "</section>",
    "</div>"
  ].join("");
}

/**
 * Resolve tooltip visibility for single-actor and aggregate chat reports.
 * Pain reports store actorId directly, while ordinary tests keep it in the
 * serialized test and grenade reports may reference several actors.
 */
export function canViewRollTooltip({
  message,
  user,
  actors,
  minRole = 0,
  ownerVisibility = false
} = {}) {
  if ((user?.role ?? 0) >= minRole) return true;
  if (!ownerVisibility) return false;
  if (user?.isGM) return true;

  const flags = message?.flags?.neuroshima ?? {};
  const actorIds = [
    flags.test?.result?.actorId,
    flags.actorId,
    ...(flags.actorDamages ?? []).map(entry => entry?.actorId)
  ].filter(Boolean);
  return [...new Set(actorIds)]
    .map(actorId => actors?.get?.(actorId))
    .filter(Boolean)
    .some(actor => actor.isOwner);
}

/**
 * Collect changes from the effects Foundry actually applied to a Document.
 * `appliedEffects` is authoritative for transferred effects; the older
 * embedded collections remain a compatibility fallback.
 */
function getDocumentEffectCandidates(document) {
  const applicable = typeof document?.allApplicableEffects === "function"
    ? Array.from(document.allApplicableEffects())
    : [];
  if (applicable.length) return applicable;

  const applied = Array.from(document?.appliedEffects ?? []);
  if (applied.length) return applied;

  return [
    ...Array.from(document?.effects ?? []),
    ...Array.from(document?.items ?? []).flatMap(item => Array.from(item?.effects ?? []))
  ];
}

function collectEffectSources(document, targetKeys, matchChange) {
  const keys = new Set(targetKeys);
  const result = Object.fromEntries(targetKeys.map(key => [key, []]));
  const candidates = getDocumentEffectCandidates(document);
  const seen = new Set();


  for (const candidate of candidates) {
    const effect = Array.isArray(candidate) && candidate.length === 2
      ? candidate[1]
      : candidate;
    if (!effect || effect.disabled || effect.isSuppressed) continue;
    const identity = effect.uuid
      ?? `${effect.parent?.uuid ?? effect.origin ?? "effect"}:${effect.id ?? effect.name ?? "?"}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    for (const change of effectChanges(effect)) {
      const key = matchChange(String(change.key ?? ""));
      if (!key || !keys.has(key)) continue;
      const value = numericEffectValue(change, document);
      if (!Number.isFinite(value)) continue;
      const mode = effectChangeType(change);
      result[key].push({
        label: effect.name ?? effect.label ?? effect.parent?.name ?? "?",
        value: mode === "subtract" ? -value : value,
        signed: ["add", "subtract"].includes(mode),
        mode
      });
    }
  }
  return result;
}

export function collectAttributeEffectSources(actor, attributeKeys = []) {
  return collectEffectSources(actor, attributeKeys, path => path.match(
    /^system\.(?:attributeBonuses|bonuses|attributes|modifiers|attributeTotals)\.(\w+)$/
  )?.[1]);
}

export function collectSkillEffectSources(actor, skillKeys = []) {
  return collectEffectSources(actor, skillKeys, path => (
    path.match(/^system\.skillBonuses\.(\w+)$/)?.[1]
    ?? path.match(/^system\.skills\.(\w+)\.value$/)?.[1]
    ?? path.match(/^system\.skillTotals\.(\w+)$/)?.[1]
  ));
}

/**
 * Collect Active Effect changes for exact document paths. This is used by
 * fields which do not belong to the attribute/skill key families, including
 * Actor fame bonuses and the value of an embedded reputation Item.
 */
export function collectDocumentEffectSources(document, fieldPaths = []) {
  return collectEffectSources(
    document,
    fieldPaths,
    path => fieldPaths.includes(path) ? path : null
  );
}

/** Source rows shared by character, creature and vehicle armor displays. */
export function collectArmorEffectSources(actor) {
  const sources = {}, seen = new Set();
  for (const effect of actor?.appliedEffects ?? []) {
    const id = effect.uuid ?? effect.id ?? effect;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const change of effectChanges(effect)) {
      const location = String(change.key ?? "").match(/^system\.armorBonus\.(\w+)$/)?.[1];
      if (!location) continue;
      (sources[location] ??= []).push({ name: effect.name, value: numericEffectValue(change, actor) || 0 });
    }
  }
  return sources;
}

/** Group presentation only; each member retains its original AE execution context. */
export function dialogScriptSignature(script, sourceActor, isMeleePreRoll, label) {
  return JSON.stringify([
    sourceActor?.uuid ?? sourceActor?.id ?? null,
    script.effect?.parent?.documentName === "Item" ? script.effect.parent.uuid : null,
    !!isMeleePreRoll, label, script.trigger, script.code, script.dialogCode,
    script.hideScript, script.activateScript, script.submissionScript,
    script.dialogDescription, script.targeter, script.defendingAgainst,
    script.runIfDisabled, script.deleteAfterRun, script.throwOnError,
    script.scope, script.useActionDef, script.actionDef, script.version ?? null
  ]);
}

/** Stable across re-renders and removal of one of several identical aura sources. */
export function dialogScriptGroupId(signature) {
  let first = 2166136261, second = 5381;
  for (let i = 0; i < signature.length; i++) {
    first = Math.imul(first ^ signature.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ signature.charCodeAt(i);
  }
  return `script_${(first >>> 0).toString(16)}_${(second >>> 0).toString(16)}`;
}

export function groupDialogModifiers(modifiers) {
  const groups = new Map();
  for (const modifier of modifiers) {
    const key = modifier._groupKey ?? modifier._effectId;
    const group = groups.get(key);
    if (group) {
      group._members.push(modifier);
      group.scriptCount++;
      group.activated ||= modifier.activated;
    } else {
      groups.set(key, { ...modifier, _members: [modifier], scriptCount: 1 });
    }
  }
  return [...groups.values()];
}

/** Expand before submission, preview totals, or recording activated effect UUIDs. */
export function expandDialogModifiers(modifiers = []) {
  return modifiers.flatMap(modifier => modifier._members ?? [modifier]);
}

/**
 * Routes decisions to the active player who owns an Actor while leaving all
 * document mutations on the client which initiated the operation.
 */
export class NeuroshimaChoiceRouter {
  /** Select the first eligible player in a deterministic priority order. */
  static getPlayerOwner(actor) {
    if (!actor) return null;
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const owners = game.users
      .filter(user => user.active && !user.isGM && actor.testUserPermission(user, OWNER))
      .sort((a, b) => a.id.localeCompare(b.id));

    return owners.find(user => user.character?.id === actor.id)
      ?? owners.find(user => user.id === game.user.id)
      ?? owners[0]
      ?? null;
  }

  static getFallbackGM() {
    // The current client is necessarily connected while it is executing this
    // operation. Foundry's `active` flag may briefly lag behind during setup or
    // user-presence synchronisation, so never reject the current GM because of it.
    if (game.user.isGM) return game.user;
    return game.users.find(user => user.active && user.isGM) ?? null;
  }

  static getChoiceUser(actor) {
    return this.getPlayerOwner(actor) ?? this.getFallbackGM() ?? null;
  }

  static async _showTraitChoice(payload) {
    const actor = payload.actorUuid ? await fromUuid(payload.actorUuid) : null;
    const traits = await Promise.all(payload.choices.map(async choice => {
      const item = choice.uuid ? await fromUuid(choice.uuid) : null;
      return {
        uuid: choice.id ?? choice.uuid,
        item: item ?? {
          name: choice.name,
          img: choice.img,
          system: { description: choice.description ?? "" },
          isOwner: true,
          getRollData: () => ({})
        }
      };
    }));
    const value = await TraitChoiceDialog.wait(traits, payload.prompt, actor);
    return value === null ? { status: "cancelled" } : { status: "selected", value };
  }

  static async _showListChoice(payload) {
    const actor = payload.actorUuid ? await fromUuid(payload.actorUuid) : null;
    const value = await ListChoiceDialog.wait(payload.items, payload.prompt, payload.title, actor);
    return value === null ? { status: "cancelled" } : { status: "selected", value };
  }

  static async _showPointAllocation(payload) {
    const value = await PointAllocationDialog.wait(payload.options);
    return value === null ? { status: "cancelled" } : { status: "selected", value };
  }

  static registerSocketHandlers() {
    NeuroshimaSocket.register("choice:trait", payload => this._showTraitChoice(payload));
    NeuroshimaSocket.register("choice:list", payload => this._showListChoice(payload));
    NeuroshimaSocket.register("choice:pointAllocation", payload => this._showPointAllocation(payload));
  }

  static async _askUser(action, user, payload) {
    if (!user) return null;
    if (user.id === game.user.id) return this._showLocally(action, payload);
    try {
      return await NeuroshimaSocket.executeAsUser(action, user.id, payload);
    } catch (error) {
      console.warn(`Neuroshima | ${action} failed for ${user.name}`, error);
      return null;
    }
  }

  static _showLocally(action, payload) {
    if (action === "choice:trait") return this._showTraitChoice(payload);
    if (action === "choice:list") return this._showListChoice(payload);
    if (action === "choice:pointAllocation") return this._showPointAllocation(payload);
    return null;
  }

  static async _route(actor, action, payload, isAllowed) {
    const playerOwner = this.getPlayerOwner(actor);
    if (playerOwner) {
      const response = await this._askUser(action, playerOwner, payload);
      if (response?.status === "cancelled") return null;
      if (response?.status === "selected" && isAllowed(response.value)) return response.value;
    }

    // Cancellation is an intentional answer. A missing/invalid remote answer,
    // however, may still be recovered by asking an active GM.
    const fallbackGM = this.getFallbackGM();
    if (!fallbackGM) {
      console.warn(`Neuroshima | ${action}: no active Actor owner or GM available for this choice`);
      return null;
    }

    const response = await this._askUser(action, fallbackGM, payload);
    if (response?.status === "selected" && isAllowed(response.value)) return response.value;
    return null;
  }

  static async chooseTrait(actor, resolvedTraits, prompt) {
    const choices = resolvedTraits.map(({ uuid, item }) => ({
      uuid,
      id: uuid,
      name: item.name,
      img: item.img || "systems/neuroshima/assets/Brain.svg",
      description: item.system?.description || ""
    }));
    const allowed = new Set(choices.map(choice => choice.id));
    return this._route(actor, "choice:trait", { actorUuid: actor.uuid, prompt, choices }, value => allowed.has(value));
  }

  static async chooseTraitCopies(actor, traitCopies, prompt) {
    const choices = traitCopies.map(choice => ({
      id: choice.id,
      name: choice.name,
      img: choice.img || "systems/neuroshima/assets/Brain.svg",
      description: choice.description || ""
    }));
    const allowed = new Set(choices.map(choice => choice.id));
    return this._route(actor, "choice:trait", { actorUuid: actor.uuid, prompt, choices }, value => allowed.has(value));
  }

  static async chooseFromList(actor, { items = [], prompt = "", title = "" } = {}) {
    // Clone before crossing the socket boundary and validate the returned value
    // against the original choices; remote clients never authorize arbitrary data.
    const choices = foundry.utils.deepClone(items);
    const allowed = new Set(choices.map(choice => choice.value));
    return this._route(actor, "choice:list", { actorUuid: actor?.uuid, items: choices, prompt, title }, value => allowed.has(value));
  }

  static async allocatePoints(actor, options = {}) {
    // Functions cannot be serialized through Foundry sockets. Local validation
    // runs only after the structural/pool validation of the remote response.
    const { validate, ...serializableOptions } = options;
    const payloadOptions = foundry.utils.deepClone(serializableOptions);
    const rows = payloadOptions.rows ?? [];
    const rowByKey = new Map(rows.map(row => [String(row.key), row]));
    const rowKeys = new Set(rowByKey.keys());
    const isAllowed = value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      if (Object.keys(value).some(key => !rowKeys.has(key))) return false;
      let spent = 0;
      for (const key of rowKeys) {
        const amount = Number(value[key]);
        const row = rowByKey.get(key);
        const min = Number.isFinite(Number(row.min)) ? Number(row.min) : 0;
        const max = Number.isFinite(Number(row.max)) ? Number(row.max) : Number(payloadOptions.pool ?? 0);
        if (!Number.isFinite(amount) || amount < min || amount > max) return false;
        spent += amount;
      }
      const pool = Math.max(0, Number(payloadOptions.pool) || 0);
      return payloadOptions.requireExact === false ? spent <= pool : spent === pool;
    };
    const result = await this._route(
      actor,
      "choice:pointAllocation",
      { actorUuid: actor?.uuid, options: payloadOptions },
      isAllowed
    );
    if (result && typeof validate === "function") {
      const validation = await validate(result, rows);
      if (validation === false || typeof validation === "string") {
        if (typeof validation === "string" && validation) ui.notifications.warn(validation);
        return null;
      }
    }
    return result;
  }
}

const SOCKET_ACTION = "rollTest:prompt";
const RECIPIENTS = new Set(["actorOwner", "executor", "gm"]);

/**
 * Routes an immediate Attribute/Skill Test dialog to the requested client.
 * Only plain data crosses the socket boundary; test instances remain local.
 */
export class NeuroshimaRollTestRouter {
  static registerSocketHandlers() {
    NeuroshimaSocket.register(SOCKET_ACTION, request => this._handleSocketRequest(request));
  }

  static _cancelledResult(request) {
    return {
      cancelled: true,
      success: false,
      isSuccess: false,
      successPoints: 0,
      successes: 0,
      type: request.type,
      attributeKey: request.attributeKey,
      skillKey: request.type === "skill" ? request.skillKey : null,
      difficulty: request.difficulty,
      isOpen: request.isOpen === true,
      test: null,
      result: null
    };
  }

  static _normalizeResult(payload, request, { preserveDocuments = false } = {}) {
    if (!payload) return this._cancelledResult(request);
    const success = payload.success === true || payload.isSuccess === true;
    const successPoints = Number(payload.successPoints ?? 0);
    return {
      cancelled: false,
      success,
      isSuccess: success,
      successPoints,
      successes: successPoints,
      type: request.type,
      attributeKey: request.attributeKey,
      skillKey: request.type === "skill" ? request.skillKey : null,
      difficulty: request.difficulty,
      isOpen: request.isOpen === true,
      test: preserveDocuments ? payload.test ?? null : null,
      result: preserveDocuments ? payload.result ?? payload.test?.result ?? null : null
    };
  }

  static async _openLocal(actor, request, { preserveDocuments = true } = {}) {
    if (!actor || actor.documentName !== "Actor") {
      throw new Error("rollTest: nie znaleziono Aktora na kliencie odbiorcy.");
    }
    const { NeuroshimaSkillRollDialog } = await import("../apps/dialogs/skill-roll-dialog.js");
    const payload = await NeuroshimaSkillRollDialog.wait({
      actor,
      stat: request.stat,
      skill: request.skill,
      label: request.label,
      isSkill: request.type === "skill",
      skillKey: request.skillKey ?? "",
      currentAttribute: request.attributeKey,
      lastRoll: {
        modifier: request.modifier,
        baseDifficulty: request.difficulty,
        useArmorPenalty: request.useArmorPenalty,
        useWoundPenalty: request.useWoundPenalty,
        useDiseasePenalty: request.useDiseasePenalty,
        useEffectPenalty: request.useEffectPenalty,
        isOpen: request.isOpen,
        rollMode: request.rollMode
      },
      testType: request.testType,
      testSubtype: request.testSubtype
    });
    return this._normalizeResult(payload, request, { preserveDocuments });
  }

  static async _handleSocketRequest(request) {
    try {
      const document = request.actorUuid ? await fromUuid(request.actorUuid) : null;
      const actor = document?.actor ?? document;
      const value = await this._openLocal(actor, request, { preserveDocuments: false });
      return { status: value.cancelled ? "cancelled" : "rolled", value };
    } catch (error) {
      return {
        status: "error",
        error: {
          name: error?.name ?? "Error",
          message: error?.message ?? String(error)
        }
      };
    }
  }

  static _getRecipientUser(actor, recipient) {
    if (recipient === "executor") return game.user;
    if (recipient === "gm") return NeuroshimaChoiceRouter.getFallbackGM();
    return NeuroshimaChoiceRouter.getPlayerOwner(actor)
      ?? NeuroshimaChoiceRouter.getFallbackGM();
  }

  static _throwRemoteError(data) {
    const error = new Error(data?.message ?? "rollTest: zdalny rzut zakończył się błędem.");
    error.name = data?.name ?? "Error";
    error.neuroshimaRemoteRollError = true;
    throw error;
  }

  static async _askRemote(user, request) {
    const response = await NeuroshimaSocket.executeAsUser(SOCKET_ACTION, user.id, request);
    if (!response) throw new Error(`rollTest: brak odpowiedzi użytkownika „${user.name}”.`);
    if (response.status === "error") this._throwRemoteError(response.error);
    if (!["rolled", "cancelled"].includes(response.status)) {
      throw new Error("rollTest: nieprawidłowa odpowiedź zdalnego klienta.");
    }
    return response.value;
  }

  static async roll(actor, request, { recipient = "actorOwner" } = {}) {
    if (!RECIPIENTS.has(recipient)) {
      throw new Error(`rollTest: nieprawidłowy odbiorca „${recipient}”.`);
    }

    let user = this._getRecipientUser(actor, recipient);
    if (!user) throw new Error("rollTest: brak aktywnego odbiorcy dialogu.");
    if (user.id === game.user.id) {
      return this._openLocal(actor, request, { preserveDocuments: true });
    }

    try {
      return await this._askRemote(user, request);
    } catch (error) {
      // actorOwner has an explicit GM fallback when its player disconnects or
      // the targeted socket request cannot be delivered. A real remote roll
      // error is surfaced by _askRemote and must not silently open a second roll.
      if (recipient !== "actorOwner" || error.neuroshimaRemoteRollError === true) throw error;
      const fallbackGM = NeuroshimaChoiceRouter.getFallbackGM();
      if (!fallbackGM || fallbackGM.id === user.id) throw error;
      user = fallbackGM;
      if (user.id === game.user.id) {
        return this._openLocal(actor, request, { preserveDocuments: true });
      }
      return this._askRemote(user, request);
    }
  }
}

/**
 * Presentation and roll-dialog utilities.
 *
 * Test construction, rolling, evaluation, recalculation and side effects live
 * exclusively in `module/tests.mjs`.
 */
export class NeuroshimaDice {
  static measureDistance(first, second) {
    if (!first || !second) return 0;
    let a = first.center || first;
    let b = second.center || second;
    if (Array.isArray(a)) a = { x: a[0], y: a[1] };
    if (Array.isArray(b)) b = { x: b[0], y: b[1] };
    try {
      return canvas.grid.measurePath([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]).distance;
    } catch (_error) {
      const pixels = Math.hypot(b.x - a.x, b.y - a.y);
      return pixels / (canvas.grid.size || 100) * (canvas.grid.distance || 2);
    }
  }

  static _groupHitsData(rollData) {
    const hits = rollData?.hitBulletsData ?? [];
    if (!hits.length) return;
    const damage = new Map();
    const piercing = new Map();
    for (const hit of hits) {
      damage.set(hit.damage, (damage.get(hit.damage) ?? 0) + (hit.isPellet ? hit.successPoints || 1 : 1));
      piercing.set(hit.piercing, (piercing.get(hit.piercing) ?? 0) + 1);
    }
    const woundCount = [...damage.values()].reduce((sum, count) => sum + count, 0);
    rollData.damage = [...damage].map(([type, count]) => woundCount > 1 ? `${count}x${type}` : type).join(", ");
    rollData.piercing = [...piercing].map(([value, count]) => hits.length > 1 ? `${count}x${value}` : value).join(", ");
    rollData.isPellet = hits.some(hit => hit.isPellet);
  }

  static buildDiceTooltipHtml(data) {
    const section = buildDiceTooltipSection(data);
    return section ? renderTooltipSections([section]) : "";
  }

  /** Preserve the script API while keeping wound creation in the combat helper. */
  static async applyDamage(actor, options) {
    const { CombatHelper } = await import("./combat-helper.js");
    return CombatHelper.applyDamage(actor, options);
  }
}
