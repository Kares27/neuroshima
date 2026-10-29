/** Foundry generation differences belong here, outside the game rules. */
export function isV14() {
  return Number(globalThis.game?.release?.generation ?? 0) >= 14
    || Boolean(globalThis.foundry?.data?.ActiveEffectTypeDataModel);
}

const clone = value => structuredClone(value);
const CHANGE_TYPES = ["custom", "multiply", "add", "downgrade", "upgrade", "override"];
export const EFFECT_PENALTY_KEY = "system.combat.effectPenalty";
export const LEGACY_EFFECT_PENALTY_KEY = "system.combat.generalPenalty";

export function normalizeEffectPenaltyChanges(changes = []) {
  let changed = false;
  const normalized = changes.map(change => {
    if (change?.key !== LEGACY_EFFECT_PENALTY_KEY) return change;
    changed = true;
    return { ...change, key: EFFECT_PENALTY_KEY };
  });
  return { changes: normalized, changed };
}

export function effectChanges(effect) {
  return effect?.system?.changes ?? effect?.changes ?? [];
}

export function effectChangeType(change) {
  return change.type ?? CHANGE_TYPES[Number(change.mode)] ?? "custom";
}

export function numericEffectValue(change, actor = null) {
  let value = change.value;
  if (typeof value === "string" && value.includes("@") && globalThis.Roll?.replaceFormulaData) {
    value = Roll.replaceFormulaData(value, actor?.getRollData?.() ?? actor?.system ?? {});
  }
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  if (typeof value === "string" && globalThis.Roll?.safeEval) {
    try { return Number(Roll.safeEval(value)); } catch { /* Non-numeric changes have no numeric tooltip. */ }
  }
  return NaN;
}

export function additiveEffectValue(change, actor = null) {
  const type = effectChangeType(change);
  if (!["add", "subtract"].includes(type)) return 0;
  const value = numericEffectValue(change, actor);
  return Number.isFinite(value) ? value * (type === "subtract" ? -1 : 1) : 0;
}

export function nativeEffectChanges(changes = [], v14 = isV14()) {
  return normalizeEffectPenaltyChanges(changes).changes.map(source => {
    const change = { ...source };
    const type = effectChangeType(change);
    if (!v14 && !Object.hasOwn(change, "type")) return change;
    if (v14) {
      change.type = type;
      change.phase ??= "initial";
      change.priority ??= CHANGE_TYPES.indexOf(type) >= 0 ? CHANGE_TYPES.indexOf(type) * 10 : null;
      delete change.mode;
    } else {
      if (change.phase && change.phase !== "initial") throw new Error(`Foundry V13 cannot apply effect phase: ${change.phase}`);
      if (type === "subtract") {
        const number = Number(change.value);
        if (!Number.isFinite(number)) throw new Error("Foundry V13 requires a numeric subtract effect");
        change.mode = 2;
        change.value = String(-number);
      } else {
        const mode = CHANGE_TYPES.indexOf(type);
        if (mode < 0) throw new Error(`Foundry V13 cannot apply effect change type: ${type}`);
        change.mode = mode;
        if (typeof change.value !== "string") change.value = JSON.stringify(change.value);
      }
      delete change.type;
      delete change.phase;
    }
    return change;
  });
}

export function effectChangesUpdate(changes) {
  return { [isV14() ? "system.changes" : "changes"]: nativeEffectChanges(changes) };
}

/** Normalize only supplied fields: this also accepts partial document updates. */
export function normalizeEffectData(data, v14 = isV14()) {
  if (v14 && data.statuses?.length && data.showIcon == null) data.showIcon = 2;
  const changes = data["system.changes"] ?? data.system?.changes ?? data.changes;
  if (Array.isArray(changes)) {
    const normalized = nativeEffectChanges(changes, v14);
    if (v14) {
      if (Object.hasOwn(data, "system.changes")) data["system.changes"] = normalized;
      else (data.system ??= {}).changes = normalized;
      delete data.changes;
    } else {
      data.changes = normalized;
      if (data.system) delete data.system.changes;
      delete data["system.changes"];
    }
  }
  if (!v14) {
    const duration = data.duration;
    if (duration?.units) {
      if (duration.expiry) throw new Error(`Foundry V13 cannot import expiry event: ${duration.expiry}`);
      const multipliers = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
      if (duration.value != null) {
        if (Object.hasOwn(multipliers, duration.units)) duration.seconds = Number(duration.value) * multipliers[duration.units];
        else if (["rounds", "turns"].includes(duration.units)) duration[duration.units] = Number(duration.value);
        else throw new Error(`Foundry V13 cannot import calendar duration: ${duration.units}`);
      }
      for (const key of ["units", "value", "expiry", "expired"]) delete duration[key];
    }
    if (data.start) {
      const target = data.duration ??= {};
      for (const [key, oldKey] of [["time", "startTime"], ["round", "startRound"], ["turn", "startTurn"], ["combat", "combat"]]) {
        if (Object.hasOwn(data.start, key)) target[oldKey] = data.start[key];
      }
      delete data.start;
    }
    return data;
  }
  const duration = data.duration ?? {};
  // V14 attaches non-enumerable legacy getters to source objects. Their
  // presence is not a legacy value: reading them warns and may return undefined.
  const stored = (object, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor : undefined;
  };
  const flat = key => stored(data, `duration.${key}`);
  const field = key => flat(key) ?? stored(duration, key);
  const supplied = key => Boolean(field(key));
  const read = key => field(key)?.value;
  const legacyUnits = ["seconds", "rounds", "turns"];
  const unit = legacyUnits.find(key => supplied(key) && Number(read(key)) > 0)
    ?? legacyUnits.find(key => supplied(key));
  if (unit) {
    const target = data.duration ??= {};
    if (flat(unit) || !stored(target, "units")) target.units = unit;
    if (flat(unit) || !stored(target, "value")) target.value = Number(read(unit)) > 0 ? Number(read(unit)) : null;
  }
  const hasNativeStart = Object.hasOwn(data, "start");
  for (const [oldKey, key] of [["startTime", "time"], ["startRound", "round"], ["startTurn", "turn"], ["combat", "combat"]]) {
    if (!supplied(oldKey) || read(oldKey) === undefined) continue;
    if (!flat(oldKey) && (hasNativeStart || Object.hasOwn(data, `start.${key}`))) continue;
    // A null legacy startTime means the effect has not started, including
    // templates stored on Items. V14 represents that as start: null.
    if (key === "time" && read(oldKey) === null) data.start = null;
    else if (data.start !== null || (key === "time" && flat(oldKey))) (data.start ??= {})[key] = read(oldKey);
  }
  for (const key of ["seconds", "rounds", "turns", "startTime", "startRound", "startTurn", "combat"]) {
    if (Object.getOwnPropertyDescriptor(duration, key)?.configurable) delete duration[key];
    delete data[`duration.${key}`];
  }
  return data;
}

/** Only embedded effect arrays are transformed; unrelated activity changes stay intact. */
export function normalizeEmbeddedEffects(data) {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) { data.forEach(normalizeEmbeddedEffects); return data; }
  for (const [key, value] of Object.entries(data)) {
    if (key === "effects" && Array.isArray(value)) {
      for (const effect of value) normalizeEffectData(effect);
    }
    normalizeEmbeddedEffects(value);
  }
  return data;
}

export function normalizeConditionData(condition) {
  const data = {};
  if (Object.hasOwn(condition, "changes")) data.changes = clone(condition.changes);
  if (Object.hasOwn(condition, "_duration")) data.duration = clone(condition._duration);
  if (condition._start) data.start = clone(condition._start);
  normalizeEffectData(data);
  const result = { ...condition,
    ...(Object.hasOwn(condition, "changes") ? { changes: effectChanges(data) } : {}),
    ...(Object.hasOwn(condition, "_duration") ? { _duration: data.duration } : {}),
    ...(data.start ? { _start: data.start } : {}) };
  if (!data.start) delete result._start;
  return result;
}

export function normalizeTransferredSetting(key, value) {
  const data = normalizeEmbeddedEffects(clone(value));
  if (key !== "conditions") return data;
  if (Array.isArray(data)) return data.map(normalizeConditionData);
  if (Array.isArray(data?.list)) data.list = data.list.map(normalizeConditionData);
  return data;
}

export function effectHasExpired(effect) {
  if (isV14()) return effect.duration?.expired === true;
  return effect.duration?.type !== "none" && effect.duration?.remaining != null && effect.duration.remaining <= 0;
}

export function effectStartTime(effect) {
  return isV14() ? effect.start?.time : effect.duration?.startTime;
}

export function effectStartTimeUpdate(value) {
  return { [isV14() ? "start.time" : "duration.startTime"]: value };
}

export function effectDurationUnit(effect) {
  return isV14() ? effect.duration?.units : ["seconds", "rounds", "turns"].find(key => Number(effect.duration?.[key]) > 0);
}

export function effectDurationValue(effect) {
  return isV14() ? effect.duration?.value ?? null : effect.duration?.[effectDurationUnit(effect)] ?? null;
}

export function effectDurationLabel(effect) {
  const value = effectDurationValue(effect);
  if (value == null || !Number.isFinite(Number(value))) return "—";
  if (effect.duration?.label) return effect.duration.label;
  return `${value}${({ seconds: "s", rounds: "r", turns: "t" })[effectDurationUnit(effect)] ?? ` ${effectDurationUnit(effect)}`}`;
}

/** Applied indefinite effects remain in their existing sheet section, without expiring them. */
export function isTemporaryEffect(effect) {
  return effect.isTemporary || (Array.from(effect.statuses ?? []).length > 0 && !effect.isCondition);
}

/** Reapply a derived field from its fresh base, never from its already-modified value. */
export function applyDerivedEffectValue(actor, key, baseValue) {
  let value = Number(baseValue) || 0;
  const entries = [];
  for (const effect of actor?.appliedEffects ?? Array.from(actor?.allApplicableEffects?.() ?? [])) {
    if (!effect?.active || effect.isSuppressed) continue;
    for (const change of effectChanges(effect)) {
      // Foundry applies final-phase changes after prepareDerivedData; replaying
      // them here would apply the same bonus twice.
      if (change.key === key && (!isV14() || (change.phase ?? "initial") === "initial")) entries.push({ effect, change });
    }
  }
  const priority = change => change.priority ?? (effectChangeType(change) === "subtract" ? 20 : Math.max(0, CHANGE_TYPES.indexOf(effectChangeType(change))) * 10);
  entries.sort((a, b) => priority(a.change) - priority(b.change));
  for (const { effect, change } of entries) {
    const Effect = globalThis.CONFIG?.ActiveEffect?.documentClass;
    if (isV14() && Effect?.applyChange) {
      const target = Object.create(actor);
      Object.defineProperty(target, "system", { value: clone(actor.system.toObject?.(false) ?? actor.system) });
      foundry.utils.setProperty(target, key, value);
      const result = Effect.applyChange(target, nativeEffectChanges([change])[0], {
        modifyTarget: false, replacementData: effect.getReplacementData?.(actor.getRollData?.() ?? {}) ?? actor.getRollData?.() ?? {}
      });
      const candidate = result[key] ?? foundry.utils.getProperty(result, key);
      if (Number.isFinite(Number(candidate))) value = Number(candidate);
      continue;
    }
    const delta = numericEffectValue(change, actor);
    switch (effectChangeType(change)) {
      case "add": value += Number.isFinite(delta) ? delta : 0; break;
      case "subtract": value -= Number.isFinite(delta) ? delta : 0; break;
      case "multiply": value *= Number.isFinite(delta) ? delta : 1; break;
      case "override": if (Number.isFinite(delta)) value = delta; break;
      case "upgrade": if (Number.isFinite(delta)) value = Math.max(value, delta); break;
      case "downgrade": if (Number.isFinite(delta)) value = Math.min(value, delta); break;
      case "custom": {
        const result = {};
        Hooks.callAll("applyActiveEffect", actor, change, value, change.value, result);
        if (Number.isFinite(Number(result[key]))) value = Number(result[key]);
      }
    }
  }
  return value;
}

export function stampEffectStart(data, combat = globalThis.game?.combat) {
  normalizeEffectData(data);
  if (isV14()) {
    const Effect = globalThis.CONFIG?.ActiveEffect?.documentClass;
    data.start = Effect?.getEffectStart?.(combat) ?? {
      time: Number(game.time?.worldTime ?? 0), combat: combat?.id ?? null,
      round: combat?.round ?? null, turn: combat?.turn ?? null,
      combatant: combat?.combatant?.id ?? null, initiative: combat?.combatant?.initiative ?? null
    };
    (data.duration ??= {}).expired = false;
  } else {
    data.duration ??= {};
    data.duration.startTime = Number(game.time?.worldTime ?? 0);
    if (combat && (data.duration.rounds > 0 || data.duration.turns > 0)) {
      Object.assign(data.duration, { combat: combat.id, startRound: combat.round, startTurn: combat.turn });
    }
  }
  return data;
}

export function applicationInstances() {
  const api = globalThis.foundry?.applications;
  if (typeof api?.api?.ApplicationV2?.instances === "function") return Array.from(api.api.ApplicationV2.instances());
  const current = api?.instances;
  return [...new Set([
    ...(current?.values ? Array.from(current.values()) : Object.values(current ?? {})),
    ...Object.values(globalThis.ui?.windows ?? {})
  ])];
}

const OLD_MODES = { publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self" };
export function defaultMessageMode() {
  return game.settings.get("core", isV14() ? "messageMode" : "rollMode");
}
export function legacyMessageMode(mode = defaultMessageMode()) {
  return Object.entries(OLD_MODES).find(([, current]) => current === mode)?.[0]
    ?? (Object.hasOwn(OLD_MODES, mode) ? mode : "publicroll");
}
export function rollModeChoices() {
  return isV14() ? { publicroll: "CHAT.RollPublic", gmroll: "CHAT.RollPrivate", blindroll: "CHAT.RollBlind", selfroll: "CHAT.RollSelf" }
    : CONFIG.Dice.rollModes;
}
export function applyMessageMode(data, mode = defaultMessageMode()) {
  if (isV14()) return ChatMessage.applyMode(data, OLD_MODES[mode] ?? mode);
  return ChatMessage.applyRollMode(data, legacyMessageMode(mode));
}

export function mergeWithDeletions(source, updates) {
  // Directory drops may include legacy deletion keys supplied by modules.
  const convert = value => {
    if (!value || value.constructor !== Object) return value;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const parts = key.split(".");
      const last = parts.pop();
      if (last.startsWith("-=")) {
        result[[...parts, last.slice(2)].join(".")] = foundry.data.operators.ForcedDeletion.create();
      } else result[key] = convert(entry);
    }
    return result;
  };
  return foundry.utils.mergeObject(source, isV14() ? convert(updates) : updates,
    isV14() ? { applyOperators: true } : { performDeletions: true });
}

/** A single area interface; game rules do not depend on canvas rendering objects. */
export class NeuroshimaAreas {
  static get documentName() { return isV14() ? "Region" : "MeasuredTemplate"; }
  static collection(scene = canvas.scene) { return isV14() ? scene?.regions : scene?.templates; }
  static documents(scene = canvas.scene) {
    const collection = this.collection(scene);
    return collection?.contents ?? Array.from(collection ?? []);
  }
  static get(id, scene = canvas.scene) { return this.collection(scene)?.get(id); }
  static layer() { return isV14() ? canvas.regions : canvas.templates; }
  static pixelsPerUnit(scene = canvas.scene) {
    return Number(scene?.grid?.size ?? canvas.grid?.size ?? 100) / Number(scene?.grid?.distance || 1);
  }
  static nativeData(data, scene = canvas.scene) {
    if (!isV14() || data.shapes) return clone(data);
    if (data.t && data.t !== "circle") throw new Error(`Unsupported system area shape: ${data.t}`);
    return {
      name: data.name ?? game.i18n.localize("NEUROSHIMA.Tabs.Effects"),
      shapes: [{ type: "circle", x: Number(data.x ?? 0), y: Number(data.y ?? 0), radius: Number(data.distance ?? 0) * this.pixelsPerUnit(scene), gridBased: false }],
      color: data.fillColor?.css ?? data.fillColor ?? "#ff0000",
      hidden: data.hidden ?? false,
      visibility: globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? 2,
      displayMeasurements: !data.flags?.neuroshima?.auraVisual,
      ...(canvas.scene?.id === scene?.id && canvas.level?.id ? { levels: [canvas.level.id] } : {}),
      ownership: { [game.user.id]: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3 },
      flags: clone(data.flags ?? {})
    };
  }
  static create(data, options = {}, scene = canvas.scene) {
    return scene.createEmbeddedDocuments(this.documentName, data.map(entry => this.nativeData(entry, scene)), options);
  }
  static center(document) {
    if (document.documentName === "Region" || document.shapes) {
      if (document.attachment?.token && document.bounds) return { x: document.bounds.x + document.bounds.width / 2, y: document.bounds.y + document.bounds.height / 2 };
      const shape = Array.from(document.shapes ?? [])[0];
      return { x: Number(shape?.x ?? 0), y: Number(shape?.y ?? 0) };
    }
    return { x: Number(document.x ?? 0), y: Number(document.y ?? 0) };
  }
  static contains(document, x, y, elevation = 0) {
    if (document.documentName === "Region" || document.shapes) return document.testPoint({ x, y, elevation });
    const center = this.center(document);
    const object = document.object ?? canvas.templates?.get(document.id);
    if (object?.shape) return object.shape.contains(x - center.x, y - center.y);
    return Math.hypot(x - center.x, y - center.y) <= Number(document.distance ?? 0) * this.pixelsPerUnit(document.parent);
  }
  static patch(document, data) {
    if (!(document.documentName === "Region" || document.shapes)) return data;
    const patch = { ...data };
    const origin = this.center(document);
    if (["x", "y", "distance"].some(key => Object.hasOwn(data, key))) {
      const dx = Number(data.x ?? origin.x) - origin.x, dy = Number(data.y ?? origin.y) - origin.y;
      patch.shapes = Array.from(document.shapes ?? []).map(shape => ({ ...(shape.toObject?.() ?? shape),
        x: Number(shape.x) + dx, y: Number(shape.y) + dy,
        ...(Object.hasOwn(data, "distance") && shape.type === "circle" ? { radius: Number(data.distance) * this.pixelsPerUnit(document.parent) } : {})
      }));
    }
    if (data.fillColor != null) patch.color = data.fillColor?.css ?? data.fillColor;
    for (const key of ["x", "y", "distance", "fillColor", "borderColor", "fillAlpha", "t", "user"]) delete patch[key];
    return patch;
  }
  static update(document, data, options = {}) { return document.update(this.patch(document, data), options); }
  static async preview(data) {
    const layer = this.layer();
    const config = isV14() ? CONFIG.Region : CONFIG.MeasuredTemplate;
    const document = new config.documentClass(this.nativeData(data), { parent: canvas.scene });
    const object = new config.objectClass(document);
    layer.preview.addChild(object);
    const destroy = () => { layer.preview.removeChild(object); object.destroy({ children: true }); };
    try { await object.draw(); }
    catch (error) { destroy(); throw error; }
    layer.activate();
    return { document, object,
      move: (x, y) => { document.updateSource(this.patch(document, { x, y })); object.refresh(); },
      destroy
    };
  }
  static async place(data, onChange = null) {
    return canvas.regions.placeRegion(this.nativeData(data), { create: false, allowRotation: false,
      ...(onChange ? { onChange: ({ document }) => onChange(document) } : {}) });
  }
}

/** DOM checks also work for elements from detached application windows. */
export function isElement(value) {
  return value?.nodeType === 1 || (typeof globalThis.HTMLElement === "function" && value instanceof globalThis.HTMLElement);
}
