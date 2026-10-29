import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isV14, nativeEffectChanges, effectChanges, normalizeEffectData, normalizeEmbeddedEffects,
  normalizeTransferredSetting, applyDerivedEffectValue, stampEffectStart, effectHasExpired,
  effectDurationLabel, effectDurationUnit, effectDurationValue, effectStartTime, effectStartTimeUpdate, applicationInstances, legacyMessageMode,
  applyMessageMode, rollModeChoices, mergeWithDeletions, NeuroshimaAreas
} from "../module/helpers/foundry-compat.js";

const getProperty = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const keys = path.split("."); let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
};
function setup(generation) {
  globalThis.foundry = { data: {}, utils: { getProperty, setProperty }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base } } };
  globalThis.game = { release: { generation }, user: { id: "gm" }, time: { worldTime: 100 },
    i18n: { localize: key => key }, settings: { get: (scope, key) => ({ rollMode: "blindroll", messageMode: "blind" })[key] } };
  globalThis.CONFIG = { Dice: { rollModes: { blindroll: "Blind" } } };
  globalThis.ui = { windows: {} };
  globalThis.canvas = { scene: { id: "scene", grid: { size: 100, distance: 2 } }, grid: { size: 100 }, level: { id: "level" } };
}

test("effect conversions preserve scripts, source and priorities and can return to V13", () => {
  setup(14);
  const effect = { origin: "Actor.source", statuses: ["grab"], duration: { seconds: null, rounds: 2, startRound: 1, startTurn: 0, combat: "fight" },
    changes: [{ key: "system.movement", mode: 1, value: "2", priority: 3 }],
    system: { scriptData: [{ code: "args.flags.shadow = true;" }] }, flags: { neuroshima: { sourceEffect: "Effect.source" } } };
  const original = structuredClone(effect);
  normalizeEffectData(effect);
  assert.deepEqual(effectChanges(effect), [{ key: "system.movement", type: "multiply", phase: "initial", value: "2", priority: 3 }]);
  assert.deepEqual(effect.duration, { value: 2, units: "rounds" });
  assert.deepEqual(effect.start, { round: 1, turn: 0, combat: "fight" });
  assert.equal(effect.changes, undefined);
  assert.equal(effect.showIcon, 2);
  const once = structuredClone(effect);
  normalizeEffectData(effect);
  assert.deepEqual(effect, once);
  normalizeEffectData(effect, false);
  assert.deepEqual(effect.changes, original.changes);
  assert.deepEqual(effect.system, original.system);
  assert.deepEqual(effect.flags, original.flags);
  assert.equal(effect.origin, original.origin);
  assert.deepEqual(effect.duration, { rounds: 2, startRound: 1, startTurn: 0, combat: "fight" });
});

test("partial updates convert supplied fields without clearing unrelated effect data", () => {
  setup(14);
  const update = { "duration.seconds": 30, "duration.startTime": 0, "system.changes": [{ key: "system.combat.generalPenalty", mode: 2, value: "10" }] };
  normalizeEffectData(update);
  assert.deepEqual(update.duration, { units: "seconds", value: 30 });
  assert.deepEqual(update.start, { time: 0 });
  assert.equal(update["system.changes"][0].key, "system.combat.effectPenalty");
  assert.equal(update.system, undefined);
  assert.deepEqual(normalizeEffectData({ disabled: true }), { disabled: true });
  assert.equal(normalizeEffectData({ duration: { seconds: 0 } }).duration.value, null);
  assert.equal(normalizeEffectData({ duration: { seconds: null } }).duration.value, null);
});

function withV14DurationShims(data) {
  for (const key of ["seconds", "rounds", "turns", "startTime", "startRound", "startTurn", "combat"]) {
    Object.defineProperty(data.duration, key, {
      get() { throw new Error(`Deprecated duration getter accessed: ${key}`); },
      configurable: true, enumerable: false
    });
  }
  return data;
}

test("repeated V14 migration ignores duration compatibility getters and preserves the native clock", () => {
  setup(14);
  for (const start of [null, { time: 0, combat: null, round: null, turn: null }]) {
    const data = withV14DurationShims({ duration: { units: "seconds", value: null, expiry: null, expired: false }, start });
    const expected = JSON.parse(JSON.stringify(data));
    normalizeEffectData(data);
    normalizeEffectData(data);
    assert.deepEqual(JSON.parse(JSON.stringify(data)), expected);
  }
});

test("legacy null startTime remains a null V14 start and undefined legacy start fields are not copied", () => {
  setup(14);
  const data = normalizeEffectData({ duration: { seconds: 60, startTime: null, startRound: null, startTurn: null, combat: null } });
  assert.equal(data.start, null);
  assert.deepEqual(data.duration, { units: "seconds", value: 60 });
  const missing = normalizeEffectData({ duration: { startTime: undefined, startRound: undefined } });
  assert.equal(Object.hasOwn(missing, "start"), false);
});

test("explicit flat duration resets do not fall through to native compatibility getters", () => {
  setup(14);
  const data = withV14DurationShims({ duration: { units: "rounds", value: 2 }, start: { time: 0 }, "duration.seconds": null });
  normalizeEffectData(data);
  assert.equal(data.duration.value, null);
  assert.equal(data.duration.units, "seconds");
  assert.deepEqual(data.start, { time: 0 });
});

test("native duration display and calendar helpers do not read V13 fallback getters for indefinite effects", () => {
  setup(14);
  const data = withV14DurationShims({ duration: { units: "seconds", value: null }, start: null });
  assert.equal(effectDurationLabel(data), "—");
  assert.equal(effectDurationUnit(data), "seconds");
  assert.equal(effectDurationValue(data), null);
  assert.equal(effectStartTime(data), undefined);
});

test("V13 import accepts common native durations and numeric subtraction but refuses unsupported semantics", () => {
  setup(13);
  assert.equal(isV14(), false);
  const data = normalizeEffectData({ system: { changes: [{ key: "system.movement", type: "subtract", value: 2, phase: "initial" }] }, duration: { units: "hours", value: 2, expiry: null, expired: false }, start: { time: 0 } });
  assert.equal(data.changes[0].mode, 2);
  assert.equal(data.changes[0].value, "-2");
  assert.deepEqual(data.duration, { seconds: 7200, startTime: 0 });
  for (const unsupported of [
    { system: { changes: [{ type: "add", phase: "final", value: 2 }] } },
    { duration: { units: "rounds", value: 2, expiry: "turnStart" } },
    { duration: { units: "months", value: 1 } }
  ]) assert.throws(() => normalizeEffectData(unsupported), /Foundry V13/);
  assert.deepEqual(nativeEffectChanges([{ key: "x", mode: 2, value: "1" }]), [{ key: "x", mode: 2, value: "1" }]);
});

test("nested effect snapshots and condition settings migrate without rewriting activity changes", () => {
  setup(14);
  const change = { key: "system.movement", mode: 2, value: "1" };
  const source = { snapshots: [{ effects: [{ changes: [change], system: { scriptData: [{ code: "return true;" }] } }] }], activities: [{ changes: [change] }] };
  normalizeEmbeddedEffects(source);
  assert.equal(source.snapshots[0].effects[0].system.changes[0].type, "add");
  assert.equal(source.activities[0].changes[0].mode, 2);
  const conditions = [{ key: "first" }, { key: "second", changes: [change], _duration: { seconds: 60, startTime: 12 } }];
  const result = normalizeTransferredSetting("conditions", conditions);
  assert.deepEqual(result[0], conditions[0]);
  assert.equal(result[1].changes[0].type, "add");
  assert.equal(result[1]._start.time, 12);
  assert.equal(conditions[1].changes[0].mode, 2);
  setup(13);
  const restored = normalizeTransferredSetting("conditions", result);
  assert.equal(restored[1].changes[0].mode, 2);
  assert.deepEqual(restored[1]._duration, { seconds: 60, startTime: 12 });
  assert.equal(restored[1]._start, undefined);
});

test("reapplying derived values in V13 starts from the fresh base and honors priority", () => {
  setup(13);
  const actor = { system: { movement: 99 }, appliedEffects: [
    { active: true, changes: [{ key: "system.movement", mode: 2, value: "2" }] },
    { active: true, changes: [{ key: "system.movement", mode: 1, value: "3" }] },
    { active: true, isSuppressed: true, changes: [{ key: "system.movement", mode: 5, value: "0" }] }
  ] };
  assert.equal(applyDerivedEffectValue(actor, "system.movement", 4), 14);
  assert.equal(applyDerivedEffectValue(actor, "system.movement", 4), 14);
  assert.equal(actor.system.movement, 99);
});

test("V14 delegates initial changes to a detached target and leaves final changes to Foundry", () => {
  setup(14);
  const calls = [];
  CONFIG.ActiveEffect = { documentClass: { applyChange(target, change, options) {
    calls.push({ value: target.system.movement, phase: change.phase, options });
    const value = target.system.movement + Number(change.value);
    target.system.movement = -100;
    return { "system.movement": value };
  } } };
  const actor = { system: { movement: 99 }, getRollData: () => ({ bonus: 2 }), appliedEffects: [
    { active: true, system: { changes: [{ key: "system.movement", type: "add", phase: "final", value: 3 }] } },
    { active: true, system: { changes: [{ key: "system.movement", type: "add", phase: "initial", value: 2 }] } }
  ] };
  assert.equal(applyDerivedEffectValue(actor, "system.movement", 4), 6);
  assert.deepEqual(calls.map(call => call.phase), ["initial"]);
  assert.equal(calls[0].value, 4);
  assert.equal(calls[0].options.modifyTarget, false);
  assert.equal(actor.system.movement, 99);
});

test("new applications reset V14 expiry and use the native start record", () => {
  setup(14);
  CONFIG.ActiveEffect = { documentClass: { getEffectStart: () => ({ time: 100, combat: "combat", round: 3, turn: 0 }) } };
  const effect = stampEffectStart({ duration: { value: 2, units: "rounds", expired: true }, start: { time: 1 } });
  assert.equal(effect.start.time, 100);
  assert.equal(effect.start.round, 3);
  assert.equal(effect.duration.expired, false);
  assert.equal(effectHasExpired(effect), false);
  assert.equal(effectHasExpired({ duration: { expired: true } }), true);
  assert.deepEqual(effectStartTimeUpdate(12), { "start.time": 12 });
  setup(13);
  assert.equal(effectHasExpired({ duration: { type: "seconds", remaining: 0 } }), true);
  assert.equal(effectHasExpired({ duration: { type: "none", remaining: 0 } }), false);
  assert.equal(effectDurationLabel({ duration: { rounds: 2 } }), "2r");
});

test("application lookup and message visibility use each generation's public API", () => {
  setup(13);
  const app = {};
  foundry.applications.instances = new Map([["a", app]]);
  ui.windows = { a: app };
  assert.deepEqual(applicationInstances(), [app]);
  const modes = [];
  globalThis.ChatMessage = { applyRollMode: (data, mode) => modes.push([13, mode]), applyMode: (data, mode) => modes.push([14, mode]) };
  applyMessageMode({});
  setup(14);
  foundry.applications.api.ApplicationV2 = { *instances() { yield app; } };
  assert.deepEqual(applicationInstances(), [app]);
  applyMessageMode({}, "gmroll");
  applyMessageMode({});
  assert.deepEqual(modes, [[13, "blindroll"], [14, "gm"], [14, "blind"]]);
  assert.equal(legacyMessageMode("ic"), "publicroll");
  assert.equal(rollModeChoices().selfroll, "CHAT.RollSelf");
});

test("V14 directory merges translate nested and dotted deletions without changing the supplied update", () => {
  setup(14);
  const deletion = { operation: "delete" };
  foundry.data.operators = { ForcedDeletion: { create: () => deletion } };
  let received;
  foundry.utils.mergeObject = (source, updates, options) => { received = { updates, options }; return source; };
  const updates = { flags: { "-=temporary": null }, "system.-=legacy": null, name: "Copy" };
  mergeWithDeletions({}, updates);
  assert.deepEqual(received, { updates: { flags: { temporary: deletion }, "system.legacy": deletion, name: "Copy" }, options: { applyOperators: true } });
  assert.equal(updates.flags["-=temporary"], null);
  setup(13);
  foundry.utils.mergeObject = (source, patch, options) => { assert.equal(patch, updates); assert.equal(options.performDeletions, true); };
  mergeWithDeletions({}, updates);
});

test("V14 area creation translates range to pixels and preserves effect provenance", async () => {
  setup(14);
  const data = { t: "circle", x: 10, y: 20, distance: 4, fillColor: "#aabbcc", flags: { neuroshima: { sourceEffectUuid: "Actor.a.ActiveEffect.e" } } };
  let created;
  canvas.scene.createEmbeddedDocuments = async (name, entries) => { created = { name, entries }; };
  await NeuroshimaAreas.create([data]);
  assert.equal(created.name, "Region");
  assert.deepEqual(created.entries[0].shapes, [{ type: "circle", x: 10, y: 20, radius: 200, gridBased: false }]);
  assert.deepEqual(created.entries[0].levels, ["level"]);
  assert.deepEqual(created.entries[0].flags, data.flags);
  assert.equal(created.entries[0].color, "#aabbcc");
  assert.equal(data.shapes, undefined);
});

test("area geometry works before canvas drawing and V14 hit tests pass elevation in the point", () => {
  setup(13);
  const template = { x: 10, y: 20, distance: 2, parent: canvas.scene };
  assert.equal(NeuroshimaAreas.contains(template, 110, 20), true);
  assert.equal(NeuroshimaAreas.contains(template, 111, 20), false);
  assert.deepEqual(NeuroshimaAreas.nativeData(template).distance, 2);
  setup(14);
  const region = { documentName: "Region", parent: canvas.scene, shapes: [{ type: "circle", x: 10, y: 20, radius: 100 }],
    testPoint: point => { assert.deepEqual(point, { x: 10, y: 20, elevation: 7 }); return true; } };
  assert.equal(NeuroshimaAreas.contains(region, 10, 20, 7), true);
  const patch = NeuroshimaAreas.patch(region, { x: 0, y: 0, distance: 4, borderColor: "#fff" });
  assert.deepEqual(patch, { shapes: [{ type: "circle", x: 0, y: 0, radius: 200 }] });
  assert.equal(region.shapes[0].x, 10);
});

test("failed area previews are removed and cancelled native placement returns no document", async () => {
  setup(14);
  const removed = [], destroyed = [];
  canvas.regions = { preview: { addChild() {}, removeChild: object => removed.push(object) },
    placeRegion: async (data, options) => { assert.equal(options.create, false); return null; } };
  CONFIG.Region = { documentClass: class {}, objectClass: class {
    async draw() { throw new Error("draw failed"); }
    destroy() { destroyed.push(this); }
  } };
  await assert.rejects(() => NeuroshimaAreas.preview({ distance: 2 }), /draw failed/);
  assert.equal(removed.length, 1);
  assert.deepEqual(removed, destroyed);
  assert.equal(await NeuroshimaAreas.place({ distance: 2 }), null);
});

test("V13 effect schema does not call the abstract TypeDataModel schema", async () => {
  setup(13);
  class Field {}
  class TypeDataModel {
    static defineSchema() { throw new Error("DataModel must define its Document schema"); }
  }
  foundry.abstract = { TypeDataModel };
  foundry.data.fields = Object.fromEntries(["ArrayField", "SchemaField", "ObjectField", "StringField", "BooleanField", "NumberField", "HTMLField"].map(key => [key, Field]));
  foundry.utils.Semaphore = class {};
  globalThis.ActiveEffect = class {};
  globalThis.Item = class {};
  globalThis.ChatMessage = class {};
  const { NeuroshimaActiveEffectData } = await import("../module/documents/active-effect.js?v13-schema-regression");
  assert.ok(NeuroshimaActiveEffectData.prototype instanceof TypeDataModel);
  const schema = NeuroshimaActiveEffectData.defineSchema();
  assert.ok(schema.scriptData instanceof Field);
  assert.ok(schema.actionDefs instanceof Field);
  assert.ok(schema.melee instanceof Field);
  assert.equal(schema.changes, undefined);
});

test("real effect schema inherits V14 changes alongside script fields and condition applications reset their clock", async () => {
  setup(14);
  class Field { constructor(...args) { this.args = args; } }
  class Application {}
  const nativeChanges = new Field();
  foundry.data.fields = Object.fromEntries(["ArrayField", "SchemaField", "ObjectField", "StringField", "BooleanField", "NumberField", "HTMLField"].map(key => [key, Field]));
  foundry.abstract = { TypeDataModel: class {
    static defineSchema() { throw new Error("DataModel must define its Document schema"); }
  } };
  foundry.data.ActiveEffectTypeDataModel = class { static defineSchema() { return { changes: nativeChanges }; } };
  foundry.utils.Semaphore = class {};
  foundry.utils.deepClone = structuredClone;
  foundry.applications.api = { ApplicationV2: Application, HandlebarsApplicationMixin: Base => Base };
  globalThis.ActiveEffect = class {};
  globalThis.Item = class {};
  globalThis.ChatMessage = class {};
  globalThis.Actor = class { async onUpdateEffectDurations() {} };
  const { NeuroshimaActiveEffectData } = await import("../module/documents/active-effect.js");
  assert.ok(NeuroshimaActiveEffectData.prototype instanceof foundry.data.ActiveEffectTypeDataModel);
  const schema = NeuroshimaActiveEffectData.defineSchema();
  assert.equal(schema.changes, nativeChanges);
  assert.ok(schema.scriptData instanceof Field);
  const { conditionEffectData } = await import("../module/apps/config/condition-config.js");
  const condition = { name: "Timed", key: "timed", changes: [{ key: "system.movement", mode: 1, value: "2" }], _duration: { units: "seconds", value: 30, expired: true }, _start: { time: 1 } };
  const template = conditionEffectData(condition);
  const applied = conditionEffectData(condition, {}, { applied: true });
  assert.equal(template.start.time, 1);
  assert.equal(applied.start.time, 100);
  assert.equal(applied.duration.expired, false);
  assert.equal(applied.system.changes[0].type, "multiply");
  assert.equal(applied.showIcon, 2);
  assert.equal(condition._start.time, 1);
  const { NeuroshimaActor } = await import("../module/documents/actor.js");
  const actor = Object.create(NeuroshimaActor.prototype);
  const expired = { id: "expired", duration: { expired: true } };
  actor.effects = new Map([[expired.id, expired]]);
  const removed = [];
  actor.deleteEmbeddedDocuments = async (type, ids) => { removed.push(ids); ids.forEach(id => actor.effects.delete(id)); };
  game.user.isGM = true;
  game.users = { activeGM: { id: game.user.id } };
  await actor.onUpdateEffectDurations([expired, { id: "live", duration: { expired: false } }]);
  await actor.onUpdateEffectDurations([expired]);
  assert.deepEqual(removed, [["expired"]]);
  game.user.isGM = false;
  actor.effects.set(expired.id, expired);
  await actor.onUpdateEffectDurations([expired]);
  assert.equal(removed.length, 1);
});

test("grenade placement targets in V13, cleans previews on cancellation and uses native placement in V14", async () => {
  setup(13);
  const { NeuroshimaChatMessage } = await import("../module/documents/chat-message.js");
  const { NeuroshimaSocket } = await import("../module/helpers/socket-helper.js");
  const original = NeuroshimaSocket.gmExecute;
  const requests = [];
  NeuroshimaSocket.gmExecute = async (...args) => requests.push(args);
  game.user.targets = new Set();
  canvas.scene.uuid = "Scene.scene";
  const listeners = new Map();
  canvas.stage = { toLocal: point => point, on: (event, fn) => listeners.set(event, fn), off: event => listeners.delete(event) };
  let destroyed = 0;
  let removed = 0;
  let targets = 0;
  const token = { id: "target", document: { x: 0, y: 0, width: 1, height: 1 }, setTarget: () => targets++ };
  canvas.tokens = { placeables: [token], get: () => token };
  canvas.templates = { activate() {}, preview: { addChild() {}, removeChild() { removed++; } } };
  CONFIG.MeasuredTemplate = { documentClass: class {
    constructor(data) { Object.assign(this, data); }
    updateSource(data) { Object.assign(this, data); }
  }, objectClass: class {
    shape = { contains: () => true };
    async draw() {}
    refresh() {}
    destroy() { destroyed++; }
  } };
  const message = { id: "grenade", getFlag: () => ({ result: { templateRadius: 4, blastZones: [] } }) };
  try {
    await NeuroshimaChatMessage.startGrenadeTemplatePlacement(message);
    // Pointer events use the canvas local coordinates in both supported versions.
    await listeners.get("pointermove")({ global: { x: 0, y: 0 } });
    assert.equal(targets, 1);
    listeners.get("rightdown")();
    assert.equal(destroyed, 1);
    assert.equal(removed, 1);
    assert.equal(listeners.size, 0);
    game.release.generation = 14;
    let placed = 0;
    canvas.regions = { async placeRegion(data, options) {
      placed++;
      assert.equal(data.shapes[0].radius, 200);
      assert.equal(options.create, false);
      return { parent: canvas.scene, toObject: () => data };
    } };
    await NeuroshimaChatMessage.startGrenadeTemplatePlacement(message);
    assert.equal(placed, 1);
    assert.equal(requests.at(-1)[0], "createGrenadeTemplate");
    assert.equal(requests.at(-1)[2], canvas.scene.uuid);
  } finally { NeuroshimaSocket.gmExecute = original; }
});

test("versioned effect migration persists the native format and source metadata is retained", async () => {
  setup(14);
  foundry.utils.deepClone = structuredClone;
  const { migrateCurrentEffect } = await import("../module/helpers/document-migrations.js");
  const source = { origin: "Scene.scene.Token.beast.Actor.base", statuses: ["grab"],
    changes: [{ key: "system.movement", mode: 2, value: "-1" }], duration: { rounds: 2, startRound: 3 },
    system: { scriptData: [] }, flags: { neuroshima: { sourceEffect: "Effect.template" } } };
  let update;
  await migrateCurrentEffect({ toObject: () => structuredClone(source), update: async data => { update = data; } }, { persist: true });
  assert.equal(update["system.changes"][0].type, "add");
  assert.equal(update.duration.units, "rounds");
  assert.equal(update.start.round, 3);
  assert.equal(update.showIcon, 2);
  assert.equal(source.changes[0].mode, 2);
  assert.equal(update.origin, undefined);
  assert.equal(update.flags, undefined);
});
