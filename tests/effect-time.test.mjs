import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

class Application {}
const getProperty = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const keys = path.split("."); let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
};
const mergeObject = (base, update) => {
  for (const [key, value] of Object.entries(update)) {
    if (value && typeof value === "object" && !Array.isArray(value)) mergeObject(base[key] ??= {}, value);
    else base[key] = value;
  }
  return base;
};
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  utils: { getProperty, setProperty, deepClone: structuredClone, mergeObject, Semaphore: class {},
    expandObject: object => { const out = {}; for (const [key, value] of Object.entries(object)) setProperty(out, key, value); return out; } },
  applications: { api: { ApplicationV2: Application, HandlebarsApplicationMixin: Base => Base } }
};
globalThis.ActiveEffect = class {};
globalThis.ChatMessage = class {};
globalThis.Item = class {};
const { effectTime, normalizeEffectData, stampEffectStart, configureEffectExpiry } = await import("../module/helpers/foundry-compat.js");
const { NeuroshimaActiveEffect } = await import("../module/documents/active-effect.js");
const { NeuroshimaScript, NeuroshimaScriptRunner, normalizeLegacySuccessScriptData } = await import("../module/apps/neuroshima-script-engine.js");
const scripts = JSON.parse(await readFile(new URL("./fixtures/effect-time-scripts.json", import.meta.url), "utf8"));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
Math.clamp ??= (value, min, max) => Math.min(max, Math.max(min, value));

function setup(generation, now = 3600) {
  globalThis.game = { release: { generation }, time: { worldTime: now }, modules: new Map(), actors: [], scenes: [],
    user: { id: "gm", isGM: true }, i18n: { localize: key => key }, settings: { get: () => false } };
  globalThis.CONFIG = { ActiveEffect: {} };
  globalThis.canvas = {};
  globalThis.ui = { notifications: { info() {}, warn() {}, error: message => { throw new Error(message); } } };
}
function sourceEffect(source) {
  const effect = Object.create(NeuroshimaActiveEffect.prototype);
  Object.defineProperties(effect, {
    actor: { value: { uuid: "Actor.source" } }, name: { value: { slugify: () => "template" } },
    uuid: { value: "Item.source.ActiveEffect.template" }, system: { value: source.system ?? {} }
  });
  effect.toObject = () => structuredClone(source);
  effect.getFlag = () => undefined;
  return effect;
}
function fixture(name, trigger) {
  return scripts.find(script => script.effect === name && script.trigger === trigger);
}
async function run(script, context, args = {}) {
  const helper = new NeuroshimaScript(script, context.effect);
  const { actor, item, ...rest } = context;
  Object.assign(helper, rest, { _executingActor: actor, _executingItem: item });
  return new AsyncFunction("args", helper.code).call(helper, args);
}

test("new applied copies refresh stale compendium clocks and honor legacy overrides on a native V14 source", () => {
  for (const generation of [13, 14]) {
    setup(generation, 500);
    const source = generation === 14
      ? { duration: { value: null, units: "seconds", expired: true }, start: { time: 10 }, system: { changes: [] } }
      : { duration: { seconds: 60, startTime: 10, combat: "old", startRound: 2, startTurn: 1 }, system: {} };
    const original = structuredClone(source);
    const effect = sourceEffect(source);
    const copy = effect.convertToApplied({ "duration.seconds": 7200, changes: [{ key: "system.movement", mode: 2, value: "2" }] });
    if (generation === 14) {
      assert.equal(copy.duration.value, 7200);
      assert.equal(copy.start.time, 500);
      assert.equal(copy.duration.expired, false);
      assert.equal(copy.system.changes[0].type, "add");
      assert.equal(copy.changes, undefined);
    } else {
      assert.equal(copy.duration.seconds, 7200);
      assert.equal(copy.duration.startTime, 500);
      assert.equal(copy.duration.combat, undefined);
      assert.equal(copy.duration.startRound, undefined);
    }
    const explicit = effect.convertToApplied({ "duration.seconds": 30, "duration.startTime": 100 });
    assert.equal(generation === 14 ? explicit.start.time : explicit.duration.startTime, 100);
    assert.deepEqual(source, original);
  }
});

test("duration helpers return seconds for V14 hours/minutes and preserve a start at zero without legacy getters", () => {
  setup(14, 3600);
  const duration = { units: "hours", value: 2, remaining: 1, secondsRemaining: 3600, seconds: 7200 };
  Object.defineProperty(duration, "startTime", { get() { throw new Error("Legacy getter"); } });
  assert.deepEqual(effectTime({ duration, start: { time: 0 } }), { startTime: 0, seconds: 7200, remaining: 3600, elapsed: 3600 });
  const source = { duration: { units: "minutes", value: 90 }, start: { time: 0 } };
  assert.equal(effectTime(source).remaining, 1800);
  assert.equal(effectTime({ duration: { value: null, units: "seconds" }, start: null }).remaining, Infinity);
  const combat = effectTime({ duration: { units: "rounds", value: 2, remaining: 1 }, start: { time: 0 } });
  assert.equal(combat.seconds, null);
  assert.equal(combat.remaining, 1);
  setup(13, 3600);
  assert.equal(effectTime({ duration: { seconds: 7200, startTime: 0, remaining: 3600 } }).remaining, 3600);
  assert.equal(effectTime({ duration: { rounds: 2, remaining: 1.01 } }).remaining, 1.01);
});

test("compendium time script conversion is idempotent, compiles all twelve scripts, and preserves quoted text, comments and assignments", () => {
  for (const script of scripts) {
    const converted = normalizeLegacySuccessScriptData(script);
    assert.deepEqual(normalizeLegacySuccessScriptData(converted), converted);
    assert.doesNotThrow(() => new AsyncFunction("args", converted.code));
    assert.ok(!converted.code.includes("duration?.startTime"));
  }
  const text = '// this.effect.duration.startTime\nconst label = "effect.duration.remaining";\nconst template = `effect.duration.seconds`;\neffect.duration.startTime = 5;\nconst age = effect.duration.startTime;';
  const converted = normalizeLegacySuccessScriptData(text);
  assert.ok(converted.includes('// this.effect.duration.startTime'));
  assert.ok(converted.includes('"effect.duration.remaining"'));
  assert.ok(converted.includes('`effect.duration.seconds`'));
  assert.ok(converted.includes('effect.duration.startTime = 5'));
  assert.ok(converted.includes('const age = this.effectTime(effect).startTime'));
});

test("actual compendium Totem preserves remaining fatigue when deactivated on V13 and V14", async () => {
  for (const generation of [13, 14]) {
    setup(generation);
    globalThis.fromUuid = async () => null;
    let applied;
    const activeSource = { uuid: "Effect.active" };
    const fatigueSource = { uuid: "Effect.fatigue", applyEffect: async (_actor, data) => { applied = data; } };
    const fatigue = generation === 14
      ? { duration: { value: 1800, units: "seconds" }, start: { time: 3000 } }
      : { duration: { seconds: 1800, startTime: 3000 } };
    fatigue.id = "fatigue";
    fatigue.getFlag = (_scope, key) => key === "sourceEffect" ? fatigueSource.uuid : undefined;
    const active = { id: "active", getFlag: (_scope, key) => ({ sourceEffect: activeSource.uuid, totemStartedAt: 0 })[key] };
    const owner = { effects: [active, fatigue], deleteEmbeddedDocuments: async () => {} };
    const item = { effects: { contents: [{}, activeSource, fatigueSource] } };
    const script = scripts.find(script => script.code.includes("remainingFatigue"));
    await run(script, { actor: owner, effect: {}, item, chooseFromList: async () => "sleep" });
    assert.equal(applied["duration.seconds"], 4800);
  }
});

test("actual compendium recovery and fatigue scripts calculate time-based penalties in both generations", async () => {
  for (const generation of [13, 14]) {
    setup(generation, 900);
    const effect = generation === 14
      ? { duration: { units: "minutes", value: 45 }, start: { time: 0 } }
      : { duration: { seconds: 2700, startTime: 0 } };
    const args = { attributeKey: "agility", fields: { effectPenalty: 0 } };
    await run(fixture("Powrót na ziemie", "dialog"), { effect }, args);
    assert.equal(args.fields.effectPenalty, 20);
    setup(generation, 3600);
    const fatigue = generation === 14
      ? { duration: { units: "hours", value: 5, remaining: 4, secondsRemaining: 14400, seconds: 18000 }, start: { time: 0 } }
      : { duration: { seconds: 18000, remaining: 14400, startTime: 0 } };
    fatigue.changes = [{ key: "system.combat.effectPenalty", mode: 2, value: "50" }];
    let update;
    fatigue.update = async data => { update = normalizeEffectData(data); };
    await run(fixture("Maszyna do zabijania - zmęczenie", "worldTimeUpdate"), { effect: fatigue });
    assert.equal((generation === 14 ? update.system.changes : update.changes)[0].value, "40");
  }
});

test("compendium medicine scripts restart existing effects without applying another copy", async () => {
  for (const name of ["Tubokuraryna — wstrzyknij", "Benzodiazepiny — zażyj"]) {
    setup(14);
    const updates = [];
    let consumed = 0;
    const sideEffect = { uuid: "Item.drug.ActiveEffect.side", name: "Side effect" };
    const item = { type: "gear", system: { quantity: 1 }, effects: { get: () => sideEffect }, reduceQuantity: async amount => { consumed += amount; } };
    const actor = { effects: [{ getFlag: () => sideEffect.uuid, update: async data => updates.push(normalizeEffectData(data)) }] };
    await run(fixture(name, "manual"), { actor, item, notification() {} });
    assert.equal(consumed, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].start.time, 3600);
    assert.equal(updates[0].duration.value, name.startsWith("Tubokuraryna") ? 3600 : 7200);
  }
});

test("V13 retains compendium turn-start expiry and restores the native event on return to V14", async () => {
  setup(13);
  const source = normalizeEffectData({ duration: { value: 3600, units: "seconds", expiry: "turnStart" }, start: { time: 0 } });
  assert.equal(source.duration.seconds, 3600);
  assert.equal(source.flags.neuroshima.durationExpiry, "turnStart");
  const removed = [];
  const actor = { uuid: "Actor.target", name: "Target", inCombat: true,
    effects: [{ id: "timed", duration: { seconds: 3600, remaining: 0 }, getFlag: () => "turnStart" }],
    deleteEmbeddedDocuments: async (_type, ids) => removed.push(ids) };
  await NeuroshimaScriptRunner.expireWorldTimeEffects([actor]);
  assert.equal(removed.length, 0);
  const combat = { id: "fight", round: 1, combatants: [{ actor }], combatant: { actor: { uuid: "Actor.other" } } };
  await NeuroshimaScriptRunner.expireEffects(combat);
  assert.equal(removed.length, 0);
  combat.combatant.actor = actor;
  await NeuroshimaScriptRunner.expireEffects(combat);
  assert.deepEqual(removed, [["timed"]]);
  setup(14);
  normalizeEffectData(source);
  assert.equal(source.duration.expiry, "turnStart");
  assert.equal(source.flags.neuroshima.durationExpiry, undefined);
});

test("isolated calendar advances only started effects, includes Item effects and off-scene unlinked actors, and rewinds time", async () => {
  for (const generation of [13, 14]) {
    setup(generation);
    const effect = (id, start) => generation === 14
      ? { id, duration: { units: "seconds", value: 60 }, start: start == null ? null : { time: start } }
      : { id, duration: { seconds: 60, startTime: start } };
    const updates = [];
    const parent = effects => ({ effects, updateEmbeddedDocuments: async (_type, data) => updates.push(...data) });
    const actor = { ...parent([effect("live", 0), effect("template", null), { ...effect("disabled", 0), disabled: true }]), uuid: "Actor.world",
      items: [parent([effect("item", 0)])] };
    const synthetic = { ...parent([effect("synthetic", 0)]), uuid: "Scene.other.Token.unlinked.Actor.world", items: [] };
    game.actors = [actor];
    game.scenes = [{ tokens: [{ actorLink: false, actor: synthetic }, { actorLink: true, actor }] }];
    assert.equal(await NeuroshimaScriptRunner.advanceIndependentCalendarDurations(10), 4);
    assert.deepEqual(updates.map(update => update._id), ["synthetic", "live", "disabled", "item"]);
    const key = generation === 14 ? "start.time" : "duration.startTime";
    assert.ok(updates.every(update => update[key] === -10));
    updates.length = 0;
    await NeuroshimaScriptRunner.advanceIndependentCalendarDurations(-10);
    assert.ok(updates.every(update => update[key] === 10));
  }
});

test("V14 delegates expiry to the registry and V13 respects duration modules", async () => {
  setup(14);
  configureEffectExpiry();
  assert.equal(CONFIG.ActiveEffect.expiryAction, "delete");
  const actor = { effects: [{ id: "effect", duration: { seconds: 60, remaining: 0 } }], deleteEmbeddedDocuments: async () => assert.fail("Duplicate deletion") };
  assert.equal(await NeuroshimaScriptRunner.expireWorldTimeEffects([actor]), 0);
  setup(13);
  game.modules.set("times-up", { active: true });
  assert.equal(await NeuroshimaScriptRunner.expireWorldTimeEffects([actor]), 0);
});

test("melee refresh restarts the effect clock on both generations instead of retaining the previous application time", async () => {
  const { MeleeEffectService } = await import("../module/combat/melee-system.js");
  for (const generation of [13, 14]) {
    setup(generation, 500);
    const source = generation === 14
      ? { duration: { value: 2, units: "minutes", expired: true }, start: { time: 1 } }
      : { duration: { seconds: 120, startTime: 1 } };
    let update;
    const existing = { getFlag: () => "same", update: async data => { update = data; } };
    await MeleeEffectService.applyTemplate(sourceEffect(source), { effects: [existing] }, { stackKey: "same", stackMode: "refresh" });
    assert.equal(generation === 14 ? update.start.time : update.duration.startTime, 500);
    if (generation === 14) assert.equal(update.duration.expired, false);
  }
});

test("expired V14 effects and native deletion already in flight cannot run a second world-time expiry script", () => {
  setup(14);
  const effect = { duration: { expired: true }, scripts: [{ trigger: "dialog" }], getFlag: () => undefined };
  const actor = { effects: [effect], items: [] };
  assert.deepEqual(NeuroshimaScriptRunner.getScripts(actor, "dialog"), []);
  effect.duration = { remaining: 0, expired: false };
  effect.isExpiryTrackable = true;
  effect.isExpiryEvent = () => true;
  effect.scripts = [{ trigger: "worldTimeUpdate" }];
  CONFIG.ActiveEffect.documentClass = { registry: { has: () => false } };
  assert.deepEqual(NeuroshimaScriptRunner.getScripts(actor, "worldTimeUpdate"), []);
});

test("persistent V13 effect conversion retains the native expiry metadata through migration", async () => {
  setup(13);
  const { migrateCurrentEffect } = await import("../module/helpers/migration.js");
  let update;
  const effect = { toObject: () => ({ duration: { units: "seconds", value: 60, expiry: "turnStart" } }),
    update: async data => { update = data; } };
  await migrateCurrentEffect(effect, { persist: true });
  assert.equal(update.duration.seconds, 60);
  assert.equal(update["flags.neuroshima.durationExpiry"], "turnStart");
});

test("explicit combat start overrides take precedence over automatic application clocks on both generations", () => {
  for (const generation of [13, 14]) {
    setup(generation, 500);
    game.combat = { id: "current", round: 3, turn: 1 };
    const source = generation === 14
      ? { duration: { value: 2, units: "rounds" }, start: { time: 1, combat: "old", round: 1, turn: 0 } }
      : { duration: { rounds: 2, startTime: 1, combat: "old", startRound: 1, startTurn: 0 } };
    const copy = sourceEffect(source).convertToApplied({
      "duration.rounds": 3, "duration.startRound": 7, "duration.startTurn": 2
    });
    assert.equal(generation === 14 ? copy.start.time : copy.duration.startTime, 500);
    assert.equal(generation === 14 ? copy.start.round : copy.duration.startRound, 7);
    assert.equal(generation === 14 ? copy.start.turn : copy.duration.startTurn, 2);
  }
});

test("applying a timed condition refreshes its template clock in V13 and V14 without altering the definition", async () => {
  const { conditionEffectData } = await import("../module/apps/config/condition-config.js");
  for (const generation of [13, 14]) {
    setup(generation, 500);
    const condition = generation === 14
      ? { key: "timed", name: "Timed", _duration: { units: "seconds", value: 60 }, _start: { time: 1 } }
      : { key: "timed", name: "Timed", _duration: { seconds: 60, startTime: 1 } };
    const original = structuredClone(condition);
    const template = conditionEffectData(condition);
    const copy = conditionEffectData(condition, {}, { applied: true });
    assert.equal(generation === 14 ? template.start.time : template.duration.startTime, 1);
    assert.equal(generation === 14 ? copy.start.time : copy.duration.startTime, 500);
    assert.deepEqual(condition, original);
  }
});

test("V13 application, time scripts and expiry never access V14-only effect APIs", async () => {
  setup(13, 500);
  const forbidden = () => assert.fail("V14-only effect API accessed in V13");
  CONFIG.ActiveEffect.documentClass = {};
  for (const key of ["registry", "getEffectStart", "applyChange"]) {
    Object.defineProperty(CONFIG.ActiveEffect.documentClass, key, { get: forbidden });
  }
  Object.defineProperty(CONFIG.ActiveEffect, "expiryAction", { get: forbidden, set: forbidden });
  configureEffectExpiry();
  const copy = sourceEffect({ duration: { seconds: 60, startTime: 1 } }).convertToApplied();
  assert.equal(copy.duration.startTime, 500);
  assert.equal(copy.start, undefined);
  assert.equal(copy.duration.units, undefined);
  const script = { trigger: "worldTimeUpdate", code: "return;" };
  const effect = { id: "timed", duration: { seconds: 60, startTime: 0, remaining: -440 },
    scripts: [script], getFlag: () => undefined };
  const deleted = [];
  const actor = { uuid: "Actor.owner", items: [], effects: [effect], deleteEmbeddedDocuments: async (_type, ids) => deleted.push(ids) };
  assert.deepEqual(NeuroshimaScriptRunner.getScripts(actor, "worldTimeUpdate"), [script]);
  assert.equal(await NeuroshimaScriptRunner.expireWorldTimeEffects([actor]), 1);
  assert.deepEqual(deleted, [["timed"]]);
});
