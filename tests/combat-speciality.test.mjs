import assert from "node:assert/strict";
import { test } from "node:test";

let sequence = 0;
class Application {
  constructor(options = {}) { this.options = options; this.document = options.document; }
  async _prepareContext() { return {}; }
  _processFormData(event, form, formData) { return foundry.utils.expandObject(formData.object); }
  async _processSubmitData(event, form, data) { return data; }
}
const getProperty = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const keys = path.split("."); let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
};
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  utils: { deepClone: structuredClone, randomID: () => `id${++sequence}`, getProperty, setProperty,
    expandObject: object => { const expanded = {}; for (const [key, value] of Object.entries(object)) setProperty(expanded, key, value); return expanded; },
    escapeHTML: value => String(value), Semaphore: class {} },
  applications: { api: { ApplicationV2: Application, HandlebarsApplicationMixin: Base => Base, DialogV2: {} },
    sheets: { ActorSheetV2: Application, ItemSheetV2: Application } }
};
globalThis.ChatMessage = class {};
globalThis.Item = class {};
globalThis.ActiveEffect = class {};
globalThis.game = { i18n: { localize: key => key, format: key => key }, user: { targets: [] },
  settings: { get: (scope, key) => settings[key] }, neuroshima: { log: () => {} } };
Math.clamp ??= (value, min, max) => Math.min(max, Math.max(min, value));
const settings = { armorLimitEnabled: true, armorLimitCharacter: 6, armorLimitCreature: 4, armorLimitVehicle: 9 };
const { clampArmor, preserveArmorSourceValues } = await import("../module/helpers/armor-limit.js");
const { specialityBonus, specialityCost, advanceSpeciality } = await import("../module/helpers/speciality.js");
const { SkillTest, RangedWeaponTest } = await import("../module/tests.mjs");
const { NeuroshimaScriptRunner } = await import("../module/apps/neuroshima-script-engine.js");
const { CombatHelper } = await import("../module/helpers/combat-helper.js");
const { NeuroshimaActiveEffect } = await import("../module/documents/active-effect.js");
const { NeuroshimaAuraManager } = await import("../module/apps/aura-manager.js");
const { MeleeActionCatalog, MeleeEffectService, runMeleeCoreSelfTests } = await import("../module/combat/melee-system.js");

function actor(type = "character") {
  const result = { type, id: "a", uuid: "Actor.a", name: "Actor", isOwner: true, effects: [],
    system: { xp: { total: 1000, spent: 0 }, xpLog: [], combat: {}, armorBonus: {} }, items: [],
    async update(data) { for (const [key, value] of Object.entries(data)) {
      if (key.includes(".")) setProperty(this, key, value); else this[key] = value;
    } } };
  result.items.get = id => result.items.find(item => item.id === id);
  return result;
}
function speciality(owner, value = 4, discounted = false) {
  const item = { id: "s", uuid: "Actor.a.Item.s", name: "Speciality", type: "speciality", parent: owner, isOwner: true,
    documentName: "Item", system: { skills: ["shooting"], value, fromSpecialization: discounted },
    async update(data) { for (const [key, val] of Object.entries(data)) setProperty(this, key, val); } };
  owner.items.push(item); return item;
}

test("applied Damage effects retain status identifiers without becoming configured conditions", () => {
  const name = { slugify: () => "grab" };
  const source = { _id: "template", name: "Grab", statuses: [], duration: {}, flags: {}, system: {} };
  const template = Object.create(NeuroshimaActiveEffect.prototype);
  Object.defineProperties(template, {
    actor: { value: { uuid: "Actor.beast" } }, name: { value: name },
    parent: { value: { documentName: "Item", uuid: "Actor.beast.Item.bite" } },
    uuid: { value: "Actor.beast.Item.bite.ActiveEffect.grab" }, system: { value: { scriptData: [{ code: "args.fields.difficultyShift += 1;" }] } }
  });
  template.toObject = () => structuredClone(source);
  template.getFlag = (scope, key) => key === "transferType" ? "damage" : undefined;
  const copy = template.convertToApplied();
  assert.deepEqual(copy.statuses, ["grab"]);
  assert.equal(copy.origin, "Actor.beast");
  assert.equal(copy.flags.neuroshima.sourceItem, "Actor.beast.Item.bite");
  assert.equal(copy.flags.neuroshima.sourceEffect, template.uuid);
  assert.equal(copy.flags.neuroshima.originalTransferType, "damage");
  assert.equal(copy.flags.neuroshima.transferType, "owningDocument");
  assert.equal(copy.system.scriptData[0].code, template.system.scriptData[0].code);
  assert.equal(copy._id, undefined);
  assert.deepEqual(copy.duration, {});
  assert.deepEqual(source.statuses, []);
  const applied = Object.create(NeuroshimaActiveEffect.prototype);
  applied.statuses = new Set(copy.statuses);
  applied.getFlag = () => undefined;
  assert.equal(applied.isCondition, false);
  source.statuses = ["prone"];
  const conditionCopy = template.convertToApplied();
  assert.deepEqual(conditionCopy.statuses, ["prone"]);
  applied.statuses = new Set(conditionCopy.statuses);
  assert.equal(applied.isCondition, true);
});

test("aura and area copies use the same applied-effect conversion and retain cleanup metadata", async () => {
  const previousMerge = foundry.utils.mergeObject;
  const previousTime = game.time;
  const previousActors = game.actors;
  foundry.utils.mergeObject = (base, changes) => Object.assign(base, changes);
  game.time = { worldTime: 123 };
  const source = { id: "beast", uuid: "Actor.beast" };
  game.actors = new Map([[source.id, source]]);
  const effect = { id: "aura", convertToApplied: () => ({ statuses: ["shadow"], flags: { neuroshima: { sourceEffect: "Effect.aura" } }, duration: {} }) };
  let created;
  const target = { async createEmbeddedDocuments(type, data) { created = data[0]; } };
  try {
    await NeuroshimaAuraManager._applyAuraCopy(effect, source, target, "token");
    assert.deepEqual(created.statuses, ["shadow"]);
    assert.equal(created.origin, source.uuid);
    assert.equal(created.flags.neuroshima.fromAura.sourceTokenId, "token");
    assert.equal(created.flags.neuroshima.sourceEffect, "Effect.aura");
    const area = NeuroshimaAuraManager._buildAreaCopyData(effect, "zone", "aura", source.id);
    assert.deepEqual(area.statuses, ["shadow"]);
    assert.equal(area.flags.neuroshima.fromArea.templateId, "zone");
    assert.equal(area.origin, source.uuid);
  } finally {
    foundry.utils.mergeObject = previousMerge;
    game.time = previousTime;
    game.actors = previousActors;
  }
});

test("effect submission preserves applied identifiers, permits condition edits, and keeps actor copies non-transferred", async () => {
  const previousConfig = globalThis.CONFIG;
  const previousMerge = foundry.utils.mergeObject;
  const previousSheet = foundry.applications.sheets.ActiveEffectConfig;
  class EffectConfig extends Application {
    static DEFAULT_OPTIONS = {};
    static PARTS = {};
  }
  foundry.applications.sheets.ActiveEffectConfig = EffectConfig;
  foundry.utils.mergeObject = (base, changes) => Object.assign(base, changes);
  globalThis.CONFIG = { statusEffects: [{ id: "prone" }, { id: "dead" }] };
  try {
    const { NeuroshimaEffectSheet } = await import("../module/sheets/neuroshima-effect-sheet.js");
    const document = { parent: { documentName: "Actor" }, statuses: new Set(["grab", "prone"]), getFlag: () => undefined };
    const sheet = new NeuroshimaEffectSheet({ document });
    const data = sheet._processFormData(null, null, { object: { name: "Renamed grab", statuses: [] } });
    assert.deepEqual(data.statuses, ["grab"]);
    const submitted = await sheet._processSubmitData(null, null, data);
    assert.deepEqual(submitted.statuses, ["grab"]);
    assert.equal(submitted.transfer, false);
    assert.deepEqual(sheet._processFormData(null, null, { object: { statuses: ["dead"] } }).statuses, ["dead", "grab"]);
    document.parent.documentName = "Item";
    assert.equal((await sheet._processSubmitData(null, null, { flags: { neuroshima: { transferType: "damage", documentType: "actor" } } })).transfer, false);
    assert.equal((await sheet._processSubmitData(null, null, { flags: { neuroshima: { transferType: "owningDocument", documentType: "actor" } } })).transfer, true);
  } finally {
    globalThis.CONFIG = previousConfig;
    foundry.utils.mergeObject = previousMerge;
    foundry.applications.sheets.ActiveEffectConfig = previousSheet;
  }
});

test("effect source resolves the applying actor including synthetic tokens and legacy source items", () => {
  const previousResolver = globalThis.fromUuidSync;
  const previousActors = game.actors;
  const source = { documentName: "Actor", uuid: "Scene.scene.Token.beast.Actor.beast", name: "Beast" };
  const item = { documentName: "Item", actor: source };
  globalThis.fromUuidSync = uuid => ({ [source.uuid]: source, "Item.source": item })[uuid] ?? null;
  game.actors = new Map([["beast", source]]);
  const effect = Object.create(NeuroshimaActiveEffect.prototype);
  let flags = {};
  effect.getFlag = (scope, key) => flags[key];
  try {
    effect.origin = source.uuid;
    assert.equal(effect.sourceActor, source);
    effect.origin = null;
    flags = { sourceItem: "Item.source" };
    assert.equal(effect.sourceActor, source);
    flags = { fromAura: { sourceActorUuid: source.uuid } };
    assert.equal(effect.sourceActor, source);
    flags = { fromArea: { sourceActorId: "beast" } };
    assert.equal(effect.sourceActor, source);
    flags = {};
    assert.equal(effect.sourceActor, null);
  } finally {
    globalThis.fromUuidSync = previousResolver;
    game.actors = previousActors;
  }
});

test("armor limits share Character/NPC settings, separate other types, and leave sources intact", () => {
  for (const [type, expected] of [["character", 6], ["npc", 6], ["creature", 4], ["vehicle", 9]]) {
    const a = actor(type); a.system.rating = 20;
    assert.equal(clampArmor(a, a.system.rating), expected);
    assert.equal(a.system.rating, 20);
  }
  settings.armorLimitEnabled = false;
  assert.equal(clampArmor(actor(), 20), 20);
  settings.armorLimitEnabled = true;
  assert.equal(clampArmor(actor(), 2.5), 2.5);
});

test("armor cap applies after aggregate armor and APCalc effects, before piercing", () => {
  const a = actor(); a.system.armorBonus.all = -5;
  a.items.push({ type: "armor", name: "Armor", system: { equipped: true, effectiveArmor: { torso: 10 }, armor: { ratings: { torso: 10 } } } });
  assert.equal(CombatHelper.getArmorRating(a, "torso").totalSP, 5);
  const original = NeuroshimaScriptRunner.executeEventSync;
  NeuroshimaScriptRunner.executeEventSync = (trigger, args) => { if (trigger === "APCalc") args.bonusSP = 20; };
  try {
    const result = CombatHelper.reduceArmorDamageWithDetails(a, "torso", "K", 3);
    assert.equal(result.totalArmor, 6);
    assert.equal(result.reduction, 3);
  } finally { NeuroshimaScriptRunner.executeEventSync = original; }
});

test("speciality uses the skill cost tables and never applies to creatures or the wrong skill", () => {
  const a = actor(); speciality(a);
  assert.equal(specialityBonus(a, "shooting", "s"), 4);
  assert.equal(specialityBonus(a, "brawl", "s"), 0);
  a.type = "creature"; assert.equal(specialityBonus(a, "shooting", "s"), 0);
  assert.equal(specialityCost(1, 3), 150);
  assert.equal(specialityCost(1, 3, true), 120);
  assert.throws(() => specialityCost(1, 2.5));
  assert.throws(() => specialityCost(1, 21));
});

test("speciality changes dice reduction without changing skill or the difficulty shift, and survives recreation", async () => {
  const a = actor(); const item = speciality(a, 4);
  class Runner extends NeuroshimaScriptRunner { static getScripts() { return []; } }
  const context = { skill: { key: "shooting", value: 3 } };
  const idle = await Runner.computeDialogFields(a, context);
  assert.equal(idle.scriptFields.dieReductionBonus, 0);
  assert.equal(idle.dialogModifiers.length, 1);
  const active = await Runner.computeDialogFields(a, context, new Set([idle.dialogModifiers[0]._effectId]));
  assert.equal(active.scriptFields.dieReductionBonus, 4);
  assert.equal(active.scriptFields.specialityBonus, 4);
  assert.equal(active.scriptFields.skillBonus, 0);
  const other = await Runner.computeDialogFields(a, { skill: { key: "brawl" } });
  assert.equal(other.dialogModifiers.length, 0);
  const make = enabled => new SkillTest({ actor: a, attribute: { key: "perception", value: 10 }, skill: { key: "shooting", value: 3 },
    preData: { dieReductionBonus: enabled ? 4 : 0, specialityBonus: enabled ? 4 : 0, penalties: {}, applyDiceDifficultyShift: false } });
  const base = make(false); const withBonus = make(true);
  await base.prepare(); await withBonus.prepare();
  base.result.rawResults = [12, 13, 15]; base.result.rolledResults = [12, 13, 15];
  withBonus.result.rawResults = [12, 13, 15]; withBonus.result.rolledResults = [12, 13, 15];
  await base.computeResult(); await withBonus.computeResult();
  assert.equal(withBonus.result.skill, base.result.skill);
  assert.equal(withBonus.result.ptMod, base.result.ptMod);
  assert.equal(withBonus.result.dieReductionBonus, 4);
  assert.ok(withBonus.result.successPoints > base.result.successPoints);
  item.system.value = 10;
  await withBonus.prepare(); assert.equal(withBonus.result.specialityBonus, 4);
});

test("speciality advancement charges XP with an undoable item reference, cancellation changes nothing", async () => {
  const a = actor("npc"); const item = speciality(a, 1, true);
  foundry.applications.api.DialogV2.wait = async () => ({ free: false, cost: 48 });
  await advanceSpeciality(a, item, 2);
  assert.equal(item.system.value, 2);
  assert.equal(a.system.xp.spent, 48);
  assert.equal(a.system.xpLog[0].documentUuid, item.uuid);
  assert.equal(a.system.xpLog[0].previousValue, 1);
  foundry.applications.api.DialogV2.wait = async () => null;
  await advanceSpeciality(a, item, 3);
  assert.equal(item.system.value, 2);
  assert.equal(a.system.xp.spent, 48);
});

test("beast action preserves explicit links without automatically applying Target templates", () => {
  const effect = (id, transferType, disabled = false) => ({ id, disabled, getFlag: (scope, key) => key === "transferType" ? transferType : "actor" });
  const item = { id: "bite", uuid: "Item.bite", type: "beast-action", name: "Bite", img: "", system: { id: "bite", successCost: 2, costType: "success", effectIds: ["old"] },
    effects: [effect("target", "target"), effect("old", "target"), effect("passive", "owningDocument"), effect("disabled", "target", true)] };
  const action = MeleeActionCatalog.fromBeastItem(item)[0];
  assert.equal(action.activation.successCost, 2);
  assert.deepEqual(action.operations.filter(op => op.type === "applyEffect").map(op => op.data.effectId).sort(), ["old"]);
});

test("beast effect application uses native conversion and preserves source identity and scripts", async () => {
  const a = actor(); let createdData;
  a.createEmbeddedDocuments = async (type, data) => { createdData = data[0]; return [{ uuid: "Effect.copy" }]; };
  const template = { uuid: "Item.bite.ActiveEffect.grab", system: {},
    convertToApplied: () => ({ name: "Grab", flags: { neuroshima: { transferType: "owningDocument", sourceItem: "Item.bite" } }, system: { scriptData: [{ code: "code" }] } }) };
  await MeleeEffectService.applyTemplate(template, a);
  assert.equal(createdData.origin, template.uuid);
  assert.equal(createdData.flags.neuroshima.transferType, "owningDocument");
  assert.equal(createdData.system.scriptData[0].code, "code");
});



test("speciality modifiers match multiple skills and are unavailable to creature actors", async () => {
  class Runner extends NeuroshimaScriptRunner { static getScripts() { return []; } }
  const a = actor("npc"); const item = speciality(a);
  item.system.skills = ["pistols", "rifles"];
  for (const key of item.system.skills) {
    const result = await Runner.computeDialogFields(a, { skill: { key } });
    assert.equal(result.dialogModifiers.length, 1);
    assert.equal(result.dialogModifiers[0].activated, false);
  }
  a.type = "creature";
  assert.equal((await Runner.computeDialogFields(a, { skill: { key: "pistols" } })).dialogModifiers.length, 0);
});

test("beast custom operations do not transfer Target effects on mere action selection", () => {
  const item = { id: "grab", uuid: "Item.grab", type: "beast-action", name: "Grab",
    system: { id: "grab", successCost: 2, operations: [{ type: "script", data: { code: "custom" } }] },
    effects: [{ id: "target", getFlag: (scope, key) => key === "transferType" ? "target" : "actor" }] };
  const action = MeleeActionCatalog.fromBeastItem(item)[0];
  assert.equal(action.operations.filter(op => op.type === "applyEffect").length, 0);
  item.system.operations = action.operations;
  assert.equal(MeleeActionCatalog.fromBeastItem(item)[0].operations.filter(op => op.type === "applyEffect").length, 0);
});

test("canonical melee regression checks", async () => {
  globalThis.fromUuid = async () => ({ uuid: "Actor.mock", testUserPermission: () => false });
  game.time = { worldTime: 0 };
  const result = await runMeleeCoreSelfTests();
  assert.ok(result.passed >= 51);
});

test("saving another field preserves the source behind capped creature armor inputs", () => {
 const a = actor("creature"); a.system.naturalArmor = { torso: { reduction: 12 } };
 a._source = { system: { naturalArmor: { torso: { reduction: 12 } } } };
 const key = "system.naturalArmor.torso.reduction";
 const submit = { [key]: 4 };
 preserveArmorSourceValues(a, { target: { name: "name" } }, submit);
 assert.equal(submit[key], 12);
 submit[key] = 6;
 preserveArmorSourceValues(a, { target: { name: key } }, submit);
 assert.equal(submit[key], 6);
});

test("speciality form saves checked skills and removes presentation-only fields", async () => {
  const { NeuroshimaItemSheet } = await import("../module/sheets/item-sheet.js");
  const sheet = new NeuroshimaItemSheet({ document: { type: "speciality" } });
  const result = sheet._processFormData({}, null, { object: {
    "specialitySkills.pistols": true, "specialitySkills.rifles": false, "system.fromSpecialization": true
  } });
  assert.deepEqual(result.system.skills, ["pistols"]);
  assert.equal(Object.keys(result).some(key => key.startsWith("specialitySkills")), false);
  const cleared = sheet._processFormData({}, null, { object: { "specialitySkills.pistols": false } });
  assert.deepEqual(cleared.system.skills, []);
});

test("speciality advancement rolls back the item if XP persistence fails", async () => {
 const a = actor(); const item = speciality(a, 1);
 foundry.applications.api.DialogV2.wait = async () => ({ free: false, cost: 60 });
 a.update = async () => { throw new Error("XP persistence failed"); };
 await assert.rejects(advanceSpeciality(a, item, 2), /XP persistence failed/);
 assert.equal(item.system.value, 1);
});

test("speciality advancement prices source levels independently of effect bonuses", async () => {
 const a = actor(); const item = speciality(a, 7);
 item._source = { system: { value: 2 } };
 item.update = async data => {
   if (data["system.value"] !== undefined) {
     item._source.system.value = data["system.value"];
     item.system.value = data["system.value"] + 5;
   }
 };
 foundry.applications.api.DialogV2.wait = async options => {
   assert.ok(options.content.includes("90"));
   return { free: false, cost: 90 };
 };
 await advanceSpeciality(a, item, 3);
 assert.equal(item._source.system.value, 3);
 assert.equal(item.system.value, 8);
 assert.equal(a.system.xp.spent, 90);
 assert.equal(a.system.xpLog[0].previousValue, 2);
 foundry.applications.api.DialogV2.wait = async () => null;
 await advanceSpeciality(a, item, 4);
 assert.equal(item._source.system.value, 3);
 assert.equal(a.system.xp.spent, 90);
});

test("chat retains named contributions from selected specialities across recreation", async () => {
 class Runner extends NeuroshimaScriptRunner { static getScripts() { return []; } }
 const a = actor(); const first = speciality(a, 3); first.name = "Moving target";
 const second = speciality(a, 2); second.id = "second"; second.uuid = "Actor.a.Item.second"; second.name = "Long range";
 const rc = { skill: { key: "shooting" } };
 const idle = await Runner.computeDialogFields(a, rc);
 assert.deepEqual(idle.scriptFields.specialitySources, []);
 const selected = new Set(idle.dialogModifiers.map(mod => mod._effectId));
 const active = await Runner.computeDialogFields(a, rc, selected);
 assert.deepEqual(active.scriptFields.specialitySources.map(source => [source.name, source.value]), [["Moving target",3],["Long range",2]]);
 const data = { actor: a, skill: { key: "shooting", value: 2 }, attribute: { value: 10 }, preData: {
   specialityBonus: active.scriptFields.specialityBonus, specialitySources: active.scriptFields.specialitySources,
   dieReductionBonus: active.scriptFields.dieReductionBonus
 } };
 const test = new SkillTest(data); await test.prepare();
 assert.ok(test.result.annotations.some(label => label.includes("Moving target (+3)")));
 const labels = test.getTooltipSections().flatMap(section => section.rows).map(row => row.label);
 assert.ok(labels.some(label => label.includes("Long range")));
 first.name = "Renamed";
 const restored = new SkillTest({ ...data, preData: JSON.parse(JSON.stringify(test.preData)) });
 await restored.prepare();
 assert.equal(restored.result.specialitySources[0].name, "Moving target");
 assert.equal(restored.result.specialityBonus, 5);
 assert.equal(restored.result.skill, 2);
});

test("negative speciality levels are rejected before XP spending and cannot reduce dice", async () => {
 const a = actor(); const item = speciality(a, 2);
 let opened = false;
 foundry.applications.api.DialogV2.wait = async () => { opened = true; return {cost: 0}; };
 await assert.rejects(advanceSpeciality(a, item, -1), /integers/);
 assert.equal(opened, false); assert.equal(item.system.value, 2);
 assert.equal(a.system.xp.spent, 0);
 item.system.value = -5;
 assert.equal(specialityBonus(a, "shooting", "s"), 0);
 class Runner extends NeuroshimaScriptRunner { static getScripts() { return []; } }
 assert.equal((await Runner.computeDialogFields(a, {skill: {key: "shooting"}})).dialogModifiers.length, 0);
});


test("melee commands authorize the actual owned token side and reserve GM controls", async () => {
 const { MeleeCommandService, userControlsMeleeActor } = await import("../module/combat/melee-system.js");
 const owner = { id: "owner", active: true, isGM: false };
 const observer = { id: "observer", active: true, isGM: false, character: { uuid: "Actor.a" } };
 const gm = { id: "gm", active: true, isGM: true };
 const owned = { uuid: "Actor.a", testUserPermission: user => user.id === owner.id };
 const other = { uuid: "Actor.b", testUserPermission: () => false };
 globalThis.fromUuid = async uuid => uuid === "Token.a" ? { actor: owned } : other;
 const session = { participants: { attacker: { actorUuid: "Actor.a", tokenUuid: "Token.a" }, defender: { actorUuid: "Actor.b" } } };
 assert.equal(userControlsMeleeActor(owned, owner), true);
 assert.equal(userControlsMeleeActor(owned, observer), false);
 await MeleeCommandService._authorize(session, {type: "commitExchangeAction", side: "attacker"}, owner);
 await assert.rejects(MeleeCommandService._authorize(session, {type: "commitExchangeAction", side: "defender"}, owner), {code:"UNAUTHORIZED"});
 await assert.rejects(MeleeCommandService._authorize(session, {type: "commitExchangeAction", side: "attacker"}, observer), {code:"UNAUTHORIZED"});
 for(const type of ["undo", "redo", "swapInitiative", "approveOutcome", "advanceSegment"]) {
   await assert.rejects(MeleeCommandService._authorize(session, {type, side:"attacker"}, owner), {code:"UNAUTHORIZED"});
   await MeleeCommandService._authorize(session, {type}, gm);
 }
});

test("melee socket uses the transport sender rather than a supplied GM identity", async () => {
 const { registerMeleeSocket, MeleeCommandService } = await import("../module/combat/melee-system.js");
 let handler; registerMeleeSocket({register: (key, callback) => {handler = callback;}});
 const original = MeleeCommandService.dispatch;
 MeleeCommandService.dispatch = async command => command;
 try {
   const command = await handler.call({socketdata:{userId:"observer"}}, {type:"commitExchangeAction",userId:"gm"});
   assert.equal(command.userId,"observer");
   await assert.rejects(handler.call({}, {type:"commitExchangeAction",userId:"gm"}), {code:"UNAUTHORIZED"});
 } finally {MeleeCommandService.dispatch = original;}
});

test("observer duel cards disable selection before handlers and submission scripts can run", async () => {
 foundry.canvas = {placeables:{tokens:{TokenRuler:class {}}}};
 foundry.applications.sidebar = {tabs:{CombatTracker:Application}};
 foundry.utils.mergeObject = (base, changes) => ({...base,...changes});
 const { MeleeOpposedChat } = await import("../module/combat/combat.js");
 const previousUser = game.user;
 game.user = {id:"observer",active:true,isGM:false};
 globalThis.fromUuidSync = () => ({testUserPermission: () => false});
 class Element {
   dataset = {}; listeners = {}; disabled = false;
   querySelectorAll(selector) {return selector.includes('mdc-controls button') ? [control] : [];}
   addEventListener(name, fn) {this.listeners[name] = fn;}
 }
 globalThis.HTMLElement = Element;
 const control = new Element(); const root = new Element();
 const state={status:"picking",waitingFor:"initiativeOwner",initiativeOwnerSide:"attacker",attackerUuid:"Actor.a",defenderUuid:"Actor.b"};
 try {
   MeleeOpposedChat.onRenderDuelCard(root,{getFlag:()=>state});
   assert.equal(control.disabled,true);
   assert.equal(control.listeners.click,undefined);
   let prevented=false,stopped=false;
   const target={dataset:{pool:"attacker"},matches:()=>false,closest:()=>({})};
   root.listeners.click({target:{closest:()=>target},preventDefault:()=>{prevented=true;},stopImmediatePropagation:()=>{stopped=true;}});
   assert.equal(prevented,true);assert.equal(stopped,true);
 } finally {game.user=previousUser;}
});

test("public melee commit rejects spectators including requests relayed through the legacy GM route", async () => {
 const { MeleeOpposedChat } = await import("../module/combat/combat.js");
 const previousUser=game.user, previousMelee=game.neuroshima.melee, previousMessages=game.messages, previousUsers=game.users;
 const outsider={id:"outsider",active:true,isGM:false}, owner={id:"owner",active:true,isGM:false};
 const session={id:"fight",revision:1,participants:{attacker:{actorUuid:"Actor.a"}},pools:{attacker:{dice:[{id:"die"}]}}};
 let dispatched;
 game.messages={get:()=>({getFlag:()=>({sessionId:"fight"})})};
 game.users={get:id=>id===outsider.id?outsider:owner};
 game.neuroshima.melee={get:async()=>session,dispatch:async command=>{dispatched=command;}};
 globalThis.fromUuid=async()=>({testUserPermission:user=>user.id===owner.id});
 try {
   game.user=outsider;
   await assert.rejects(MeleeOpposedChat.commitExchangeAction("message","attacker",[0]));
   assert.equal(dispatched,undefined);
   game.user={id:"gm",isGM:true,active:true};
   await assert.rejects(MeleeOpposedChat.commitExchangeAction("message","attacker",[0],null,null,{requestingUserId:outsider.id}));
   assert.equal(dispatched,undefined);
   game.user=owner;
   await MeleeOpposedChat.commitExchangeAction("message","attacker",[0]);
   assert.equal(dispatched.userId,owner.id);
   assert.deepEqual(dispatched.payload.selectedDieIds,["die"]);
 } finally {game.user=previousUser;game.neuroshima.melee=previousMelee;game.messages=previousMessages;game.users=previousUsers;}
});


test("Damage transfers the used beast action's effects, never other actions or Target templates", async () => {
 const attacker=actor("creature"); attacker.uuid="Scene.s.Token.t.Actor.a";
 const effect=(id,transferType="damage",documentType="actor")=>({uuid:`Effect.${id}`,disabled:false,getFlag:(scope,key)=>({transferType,documentType})[key],convertToApplied:()=>({name:id})});
 const used={id:"bite",uuid:`${attacker.uuid}.Item.bite`,actor:attacker,type:"beast-action",system:{},effects:[effect("venom"),effect("explicitTarget","target"),effect("damageItem","damage","item")]};
 const unused={id:"tail",uuid:`${attacker.uuid}.Item.tail`,type:"beast-action",system:{},effects:[effect("unused")]};
 attacker.items.push(used,unused); attacker.effects.push(effect("actorPassive"));
 globalThis.fromUuid=async uuid=>uuid===used.uuid?used:attacker;
 const defender=actor("npc");let applied=[];defender.applyEffect=async data=>{applied.push(...data.effectData);};
 await CombatHelper._applyDamageTypeEffects(defender,{actorUuid:attacker.uuid,weaponUuid:used.uuid});
 assert.deepEqual(applied.map(e=>e.name),["actorPassive","venom","damageItem"]);
 used.system.applyEffectsAutomatically=false;applied=[];
 await CombatHelper._applyDamageTypeEffects(defender,{actorUuid:attacker.uuid,weaponUuid:used.uuid});
 assert.deepEqual(applied.map(e=>e.name),["actorPassive"]);
});

test("Damage transfer happens after wound creation and skips completely absorbed or cancelled wounds", async () => {
 const target=actor("npc"), source=actor();
 const old={event:NeuroshimaScriptRunner.executeEvent,sync:NeuroshimaScriptRunner.executeEventSync,
   reduce:CombatHelper.reduceArmorDamageWithDetails,apply:CombatHelper.applyDamage,effects:CombatHelper._applyDamageTypeEffects};
 let blocked=false,cancelled=false;const events=[];
 game.neuroshima.group=()=>{};game.neuroshima.groupEnd=()=>{};
 globalThis.fromUuid=async()=>source;
 NeuroshimaScriptRunner.executeEvent=async()=>{};NeuroshimaScriptRunner.executeEventSync=()=>{};
 CombatHelper.reduceArmorDamageWithDetails=()=>({reducedDamageType:blocked?null:"L"});
 CombatHelper.applyDamage=async()=>{events.push("wounds");return {results:[],woundIds:cancelled?[]:["w"]};};
 CombatHelper._applyDamageTypeEffects=async()=>{events.push("effects");};
 try {
   const packet={actorUuid:source.uuid,damage:"L"};
   await CombatHelper.applyDamageToActor(target,packet,{suppressChat:true});
   assert.deepEqual(events,["wounds","effects"]);
   events.length=0;blocked=true;
   await CombatHelper.applyDamageToActor(target,packet,{suppressChat:true});
   assert.deepEqual(events,[]);
   blocked=false;cancelled=true;
   await CombatHelper.applyDamageToActor(target,packet,{suppressChat:true});
   assert.deepEqual(events,["wounds"]);
 } finally {NeuroshimaScriptRunner.executeEvent=old.event;NeuroshimaScriptRunner.executeEventSync=old.sync;
   CombatHelper.reduceArmorDamageWithDetails=old.reduce;CombatHelper.applyDamage=old.apply;CombatHelper._applyDamageTypeEffects=old.effects;}
});

test("melee damage operation preserves the selected action UUID for Damage transfer", async () => {
 const { MeleeOperationRegistry } = await import("../module/combat/melee-system.js");
 const oldApply=CombatHelper.applyDamageToActor,oldExpire=MeleeEffectService.expire;
 let packet;
 CombatHelper.applyDamageToActor=async (target,data)=>{packet=data;return {woundIds:["w"]};};
 MeleeEffectService.expire=async()=>{};
 try {
  await MeleeOperationRegistry.get("damage")({
   actor:{id:"a",uuid:"Scene.s.Token.t.Actor.a"},target:{uuid:"Actor.b"},
   operation:{target:"opponent",data:{damage:"L"}},successPoints:2,
   action:{side:"attacker",definition:{name:"Bite",source:{itemUuid:"Scene.s.Token.t.Actor.a.Item.bite"}}},
   session:{participants:{attacker:{weaponUuid:"Item.other"}}}
  });
  assert.equal(packet.actorUuid,"Scene.s.Token.t.Actor.a");
  assert.equal(packet.weaponUuid,"Scene.s.Token.t.Actor.a.Item.bite");
 } finally {CombatHelper.applyDamageToActor=oldApply;MeleeEffectService.expire=oldExpire;}
});


test("one beast damage click carries the selected action through declaration, pain test, wound and Damage effect", async () => {
 const {createMeleeSession,normalizeMeleePool,MeleeCommandService}=await import("../module/combat/melee-system.js");
 const {MeleeOpposedChat}=await import("../module/combat/combat.js");
 const atk=actor("creature");atk.uuid="Actor.beast";atk.id="beast";
 const def=actor("npc");def.uuid="Actor.victim";def.id="victim";
 const bite={id:"bite",uuid:"Actor.beast.Item.bite",type:"beast-action",name:"Bite",actor:atk,
   system:{id:"bite",costType:"success",successCost:2,damage:"L",effectIds:[]},effects:[]};
 const venom={uuid:`${bite.uuid}.ActiveEffect.venom`,getFlag:(scope,key)=>key==="transferType"?"damage":"actor",
   convertToApplied:()=>({name:"Venom",flags:{neuroshima:{sourceEffect:"venom"}}})};
 bite.effects.push(venom);atk.items.push(bite);
 const session=createMeleeSession({id:"beast-fight",messageId:"m",attacker:{actorUuid:atk.uuid},defender:{actorUuid:def.uuid},metadata:{attackerTarget:10,defenderTarget:10}});
 session.phase="declaration";session.exchange.segments=session.exchange.segments.slice(0,2);
 session.pools.attacker={dice:normalizeMeleePool([{id:"ad",raw:1,modified:1,isSuccess:true,target:10},{id:"ad2",raw:2,modified:2,isSuccess:true,target:10}])};
 session.pools.defender={dice:normalizeMeleePool([{id:"dd",raw:20,modified:20,isSuccess:false,target:10},{id:"dd2",raw:19,modified:19,isSuccess:false,target:10}])};
 const lookup=uuid=>uuid===bite.uuid?bite:uuid===atk.uuid?atk:uuid===def.uuid?def:null;
 const saved={user:game.user,actors:game.actors,messages:game.messages,melee:game.neuroshima.melee,Roll:globalThis.Roll,ui:globalThis.ui,
   event:NeuroshimaScriptRunner.executeEvent,sync:NeuroshimaScriptRunner.executeEventSync,report:CombatHelper.renderPainResistanceReport};
 globalThis.fromUuid=async uuid=>lookup(uuid);globalThis.fromUuidSync=lookup;
 game.user={id:"gm",active:true,isGM:true};game.actors={get:id=>id===atk.id?atk:def};
 globalThis.ui={notifications:{info:()=>{},warn:()=>{},error:()=>{}}};
 game.neuroshima.group=()=>{};game.neuroshima.groupEnd=()=>{};
 NeuroshimaScriptRunner.executeEvent=async()=>{};NeuroshimaScriptRunner.executeEventSync=()=>{};
 game.neuroshima.NeuroshimaScriptRunner=NeuroshimaScriptRunner;
 let rolls=0,reports=0;const wounds=[],effects=[];
 globalThis.Roll=class {async evaluate(){rolls++;this.terms=[{results:[{result:3},{result:4},{result:5}]}];return this;}};
 def.createEmbeddedDocuments=async(type,data)=>data.map((item,i)=>{wounds.push(item);return {...item,id:`w${i}`};});
 def.applyEffect=async data=>effects.push(...data.effectData);
 CombatHelper.renderPainResistanceReport=async()=>{reports++;};
 game.messages={get:()=>({id:"m",getFlag:(scope,key)=>key==="melee"?{sessionId:session.id}:session.result})};
 game.neuroshima.melee={get:async()=>session,dispatch:async command=>{
   const result=await MeleeCommandService._apply(session,command);session.revision++;return {session,result};
 }};
 try {
  await MeleeCommandService._commitExchangeAction(session,{side:"attacker",payload:{activity:{activityId:"attack"},selectedDieIds:["ad","ad2"],
    queuedSupplements:[{activityRef:{activityId:"bite",sourceItemUuid:bite.uuid},quantity:1}]}});
  assert.deepEqual(session.exchange.declaration.beastQueue,["bite::bite"]);
  await MeleeCommandService._commitExchangeAction(session,{side:"defender",payload:{activity:{activityId:"defense"},selectedDieIds:["dd","dd2"]}});
  assert.deepEqual(session.result.pendingBeastQueue,["bite::bite"]);
  assert.equal(session.result.netSuccesses,2);
  const result=await MeleeOpposedChat.applyOpposedDamage("m");
  assert.equal(result.applied,true);
  assert.equal(wounds.length,1);assert.equal(wounds[0].type,"wound");
  assert.equal(rolls,1);assert.equal(reports,1);assert.equal(effects[0].name,"Venom");
  assert.equal(session.result.beastActionsApplied,true);
  await MeleeOpposedChat.applyOpposedDamage("m");
  assert.equal(wounds.length,1);assert.equal(rolls,1);assert.equal(effects.length,1);
 } finally {game.user=saved.user;game.actors=saved.actors;game.messages=saved.messages;game.neuroshima.melee=saved.melee;
   globalThis.Roll=saved.Roll;globalThis.ui=saved.ui;NeuroshimaScriptRunner.executeEvent=saved.event;NeuroshimaScriptRunner.executeEventSync=saved.sync;
   CombatHelper.renderPainResistanceReport=saved.report;}
});


test("damage button locks on the first click and marks applied only after successful completion", async () => {
 const {NeuroshimaChatMessage}=await import("../module/documents/chat-message.js");
 const {MeleeOpposedChat}=await import("../module/combat/combat.js");
 const old=MeleeOpposedChat.applyOpposedDamage;
 let calls=0,finish,signal;const started=new Promise(resolve=>{signal=resolve;});const classes=[];
 const button={disabled:false,classList:{add:value=>classes.push(value)},innerHTML:"Apply"};
 MeleeOpposedChat.applyOpposedDamage=()=>{calls++;signal();return new Promise(resolve=>{finish=resolve;});};
 try {
   const first=NeuroshimaChatMessage.onApplyOpposedDamage({currentTarget:button},{id:"m"});
   await started;
   assert.equal(button.disabled,true);
   await NeuroshimaChatMessage.onApplyOpposedDamage({currentTarget:button},{id:"m"});
   finish({applied:true});await first;
   assert.equal(calls,1);assert.deepEqual(classes,["applied"]);
   button.disabled=false;classes.length=0;
   MeleeOpposedChat.applyOpposedDamage=async()=>({applied:false});
   await NeuroshimaChatMessage.onApplyOpposedDamage({currentTarget:button},{id:"m"});
   assert.equal(button.disabled,false);assert.deepEqual(classes,[]);
 } finally {MeleeOpposedChat.applyOpposedDamage=old;}
});


test("tempo is bounded by the used skill and full defense requires consecutive uncontested successes", async () => {
 const {maxMeleeTempo,clampMeleeTempo,resolveDefensiveManeuver}=await import("../module/combat/melee-maneuvers.js");
 const owner=actor(); owner.system.skills={brawl:{value:2},melee:{value:0}};
 assert.equal(maxMeleeTempo(owner,{system:{skill:"brawl"}}),2);
 assert.equal(maxMeleeTempo(owner,{system:{skill:"melee"}}),0);
 owner.system.skills.brawl.value=9;
 assert.equal(maxMeleeTempo(owner,{system:{skill:"brawl"}}),3);
 assert.equal(clampMeleeTempo(99,2),2); assert.equal(clampMeleeTempo(-1),0);
 const state={defenderManeuver:"fullDefense",fullDefenseStreak:{}};
 const resolve=(attack,defense)=>resolveDefensiveManeuver(state,{ownerSide:"attacker",ownerSuccesses:attack,
   responderSuccesses:defense,responderAction:"defend",outcome:defense>attack?"takeover":"draw"});
 assert.equal(resolve(0,1),"blocked");
 assert.equal(resolve(1,1),"draw");
 assert.equal(resolve(0,1),"blocked");
 assert.equal(resolve(0,1),"takeover");
 assert.equal(resolve(1,2),"blocked");
 assert.equal(resolve(0,2),"takeover");
});

test("shared tempo affects a normal defense roll and maneuver bonuses always modify attributes", async () => {
 const {NeuroshimaWeaponRollDialog}=await import("../module/apps/dialogs/weapon-roll-dialog.js");
 const {TestRules}=await import("../module/tests.mjs"); const {NEUROSHIMA}=await import("../module/config.js");
 const owner=actor(); owner.system.attributeTotals={dexterity:10}; owner.system.skills={brawl:{value:3}};
 let captured;
 owner._setupTest=(_class,data)=>{captured=data;return {preData:{},result:{},async roll(){}};};
 const weapon={id:"unarmed",name:"Unarmed",system:{weaponType:"melee",attribute:"dexterity",skill:"brawl",attackBonus:0,defenseBonus:0}};
 const dialog={actor:owner,weapon,rollType:"melee",_scriptFields:{}};
 const execute=params=>NeuroshimaWeaponRollDialog.prototype._executeWeaponTest.call(dialog,{weapon,actor:owner,
   difficulty:"average",meleeAction:"defense",maneuver:"none",...params});
 await execute({tempoLevel:2});
 assert.equal(captured.preData.penalties.base,TestRules.shiftDifficulty(NEUROSHIMA.difficulties.average,2).min);
 assert.equal(captured.context.tempoLevel,2);
 await execute({maneuver:"fury",meleeAction:"attack"}); assert.equal(captured.preData.attributeBonus,2);
 assert.equal(captured.preData.skillBonus,0);
 await execute({maneuver:"fury",meleeAction:"defense"}); assert.equal(captured.preData.attributeBonus,0);
 await execute({maneuver:"fullDefense",meleeAction:"defense"}); assert.equal(captured.preData.attributeBonus,2);
 await execute({maneuver:"fullDefense",meleeAction:"attack"}); assert.equal(captured.preData.attributeBonus,0);
});

test("canonical tempo applies once to both actors, preserves its source and expires with the session", async () => {
 const {createMeleeSession,MeleeCommandService,MeleeEffectService}=await import("../module/combat/melee-system.js");
 const previousResolver=globalThis.fromUuid;
 const attacker=actor(),defender=actor();attacker.uuid="Actor.tempo";defender.uuid="Actor.other";
 attacker.system.skills={brawl:{value:2}};
 const weapon={uuid:"Item.fists",system:{skill:"brawl"}};
 const docs=new Map([[attacker.uuid,attacker],[defender.uuid,defender],[weapon.uuid,weapon]]);
 for(const owner of [attacker,defender]) owner.addCondition=async(key,value)=>{
   const effect={uuid:`${owner.uuid}.ActiveEffect.${key}`,statuses:new Set([key]),value,
     getFlag:()=>effect.value,async setFlag(_scope,_key,next){effect.value=next;},async update(data){Object.assign(effect,data);},
     async delete(){owner.effects.splice(owner.effects.indexOf(effect),1);}};
   owner.effects.push(effect);docs.set(effect.uuid,effect);return effect;
 };
 globalThis.fromUuid=async uuid=>docs.get(uuid);
 const session=createMeleeSession({id:"tempo",attacker:{actorUuid:attacker.uuid,weaponUuid:weapon.uuid},
   defender:{actorUuid:defender.uuid},metadata:{attackerManeuver:"increasedTempo",attackerTempoLevel:3}});
 try{
   await MeleeCommandService.syncManeuvers(session);await MeleeCommandService.syncManeuvers(session);
   assert.equal(session.metadata.tempoLevel,2);
   assert.equal(attacker.effects.length,1);assert.equal(defender.effects.length,1);
   assert.equal(defender.effects[0].value,2);assert.equal(defender.effects[0].origin,attacker.uuid);
   await assert.rejects(MeleeCommandService._submitRoll(session,{side:"defender",payload:{maneuver:"increasedTempo"}}),{code:"INVALID_MANEUVER"});
   await MeleeEffectService.expire(session,"sessionEnd");
   assert.equal(attacker.effects.length,0);assert.equal(defender.effects.length,0);
 }finally{globalThis.fromUuid=previousResolver;}
});

test("segment resolution applies full-defense takeover and fury hits in both initiative directions", async () => {
 const {DuelSegmentEngine}=await import("../module/combat/combat-api.js");
 const previous={resolver:globalThis.fromUuidSync,event:NeuroshimaScriptRunner.executeEvent};
 globalThis.fromUuidSync=()=>null;NeuroshimaScriptRunner.executeEvent=async()=>{};
 const die=success=>({isSuccess:success,modified:success?1:20});
 const make=(owner="attacker")=>({status:"picking",initiativeOwnerSide:owner,waitingFor:"responder",declaredAction:"attack",
   committedOwnerIndices:[0],attackDice:[die(false),die(false)],defenseDice:[die(true),die(true)],
   currentSegment:0,segments:[{},{}],hits:[],counterHits:[],usedAttackDice:[],usedDefenseDice:[],
   attackerUuid:"Actor.a",defenderUuid:"Actor.d",damage1:"L",defenderDamage1:"C"});
 const resolve=(state,index,owner="attacker")=>DuelSegmentEngine.processResponder(state,{
   pool:owner==="attacker"?"defender":"attacker",responderPool:owner==="attacker"?"defender":"attacker",
   isOwnerAttacker:owner==="attacker",diceIndices:[index],action:"defend",message:{id:"test",async setFlag(){}},
   onRender:async()=>{},onSyncInitiative:async()=>{},onClearManeuvers:async()=>{}
 });
 try{
   const defense=make();defense.defenderManeuver="fullDefense";
   await resolve(defense,0);assert.equal(defense.segments[0].outcome,"blocked");
   assert.equal(defense.initiativeOwnerSide,"attacker");
   defense.committedOwnerIndices=[1];await resolve(defense,1);
   assert.equal(defense.segments[1].outcome,"takeover");assert.equal(defense.initiativeOwnerSide,"defender");
   const fury=make();fury.attackerManeuver="fury";
   await resolve(fury,0);assert.equal(fury.counterHits.length,1);assert.equal(fury.counterHits[0].damageType,"C");
   const reversed=make("defender");reversed.attackDice=[die(true),die(true)];reversed.defenseDice=[die(false),die(false)];
   reversed.defenderManeuver="fury";await resolve(reversed,0,"defender");
   assert.equal(reversed.hits.length,1);assert.equal(reversed.hits[0].damageType,"L");
 }finally{globalThis.fromUuidSync=previous.resolver;NeuroshimaScriptRunner.executeEvent=previous.event;}
});


test("charge is restricted to Dexterity melee initiative and its bonus is clamped to one through three", async () => {
 const {NeuroshimaInitiativeRollDialog}=await import("../module/apps/dialogs/initiative-roll-dialog.js");
 const {InitiativeTest}=await import("../module/tests.mjs");
 const previous=InitiativeTest.prototype.roll;let captured;
 InitiativeTest.prototype.roll=async function(){captured=this.attribute.value;return this;};
 const owner=actor();owner.system.attributeTotals={dexterity:10,perception:11};
 const dialog={actor:owner,isMelee:true,_scriptFields:{}};
 try{
   await NeuroshimaInitiativeRollDialog.prototype._performRoll.call(dialog,{attribute:"dexterity",maneuver:"charge",chargeLevel:99});
   assert.equal(captured,13);
   await NeuroshimaInitiativeRollDialog.prototype._performRoll.call(dialog,{attribute:"dexterity",maneuver:"charge",chargeLevel:-5});
   assert.equal(captured,11);
   await NeuroshimaInitiativeRollDialog.prototype._performRoll.call(dialog,{attribute:"perception",maneuver:"charge",chargeLevel:3});
   assert.equal(captured,11);
   dialog.isMelee=false;
   await NeuroshimaInitiativeRollDialog.prototype._performRoll.call(dialog,{attribute:"dexterity",maneuver:"charge",chargeLevel:3});
   assert.equal(captured,10);
 }finally{InitiativeTest.prototype.roll=previous;}
});

test("the pool dialog rejects defensive maneuvers after a lost charge and tempo without initiative", async () => {
 const {NeuroshimaWeaponRollDialog}=await import("../module/apps/dialogs/weapon-roll-dialog.js");
 const previousUx=foundry.applications.ux;const previousUi=globalThis.ui;
 let formData={maneuver:"fullDefense"},warnings=0;
 foundry.applications.ux={FormDataExtended:class{constructor(){this.object=formData;}}};
 globalThis.ui={notifications:{warn:()=>warnings++}};
 const dialog={element:{tagName:"FORM"},weapon:{system:{weaponType:"melee"}},actor:actor(),
   userEntry:{},rollOptions:{},chargeDexPenalty:2,canIncreaseTempo:true};
 try{
   await NeuroshimaWeaponRollDialog.prototype._onRoll.call(dialog);assert.equal(warnings,1);
   dialog.chargeDexPenalty=0;dialog.canIncreaseTempo=false;formData={maneuver:"increasedTempo"};
   await NeuroshimaWeaponRollDialog.prototype._onRoll.call(dialog);assert.equal(warnings,2);
   formData={maneuver:"charge"};await NeuroshimaWeaponRollDialog.prototype._onRoll.call(dialog);assert.equal(warnings,3);
 }finally{foundry.applications.ux=previousUx;globalThis.ui=previousUi;}
});


test("damage buttons restore persisted state on fresh chat renders for session and legacy cards", async () => {
 const {NeuroshimaChatMessage}=await import("../module/documents/chat-message.js");
 const previous=game.neuroshima.melee;
 const button=action=>({dataset:{action},disabled:false,classList:{add(value){this.applied=value;},remove(){delete this.applied;}},innerHTML:"Apply"});
 const duel=button("applyOpposedDamage"),hail=button("applyHailDamage");
 const root={querySelectorAll:()=>[duel,hail]};
 let release;const loaded=new Promise(resolve=>{release=resolve;});
 game.neuroshima.melee={get:()=>loaded};
 try{
   const message={id:"m",getFlag:(_scope,key)=>key==="melee"?{sessionId:"fight"}:null};
   const restoring=NeuroshimaChatMessage.restoreDamageButtonState(root,message);
   assert.equal(duel.disabled,true);assert.equal(hail.disabled,true);
   release({result:{applied:true},hailResult:{applied:false}});await restoring;
   assert.equal(duel.disabled,true);assert.equal(duel.classList.applied,"applied");
   assert.match(duel.innerHTML,/DamageApplied/);assert.equal(hail.disabled,false);
   const fresh=button("applyOpposedDamage");
   await NeuroshimaChatMessage.restoreDamageButtonState({querySelectorAll:()=>[fresh]},
     {getFlag:(_scope,key)=>key==="opposedResult"?{beastActionsApplied:true}:null});
   assert.equal(fresh.disabled,true);assert.equal(fresh.classList.applied,"applied");
   const oldHail=button("applyHailDamage");
   await NeuroshimaChatMessage.restoreDamageButtonState({querySelectorAll:()=>[oldHail]},
     {getFlag:(_scope,key)=>key==="hailResult"?{applied:true}:null});
   assert.equal(oldHail.disabled,true);
 }finally{game.neuroshima.melee=previous;}
});


test("selected pain rerolls update existing wounds and report counts without reapplying damage", async () => {
 const {NeuroshimaChatMessage}=await import("../module/documents/chat-message.js");
 const {SkillTest}=await import("../module/tests.mjs");
 const saved={user:game.user,users:game.users,tests:game.neuroshima.tests,resolver:globalThis.fromUuid,
   Roll:globalThis.Roll,event:NeuroshimaScriptRunner.executeEvent,sync:NeuroshimaScriptRunner.executeEventSync,
   render:NeuroshimaChatMessage._renderTemplate};
 const owner=actor();owner.system.skills={painResistance:{value:3}};owner.system.attributeTotals={charisma:10};
 const gm={id:"gm",active:true,isGM:true},observer={id:"observer",active:true,isGM:false};
 game.user=gm;game.users=new Map([[gm.id,gm],[observer.id,observer]]);owner.testUserPermission=()=>false;
 game.neuroshima.tests={SkillTest};globalThis.fromUuid=async uuid=>uuid===owner.uuid?owner:null;
 NeuroshimaScriptRunner.executeEvent=async()=>{};NeuroshimaScriptRunner.executeEventSync=()=>{};
 game.neuroshima.NeuroshimaScriptRunner=NeuroshimaScriptRunner;
 let rolls=0,face=20,rendered;
 globalThis.Roll=class{async evaluate(){rolls++;this.terms=[{results:[{result:face},{result:face},{result:face}]}];return this;}};
 NeuroshimaChatMessage._renderTemplate=async(_template,context)=>{rendered=context;return "updated-report";};
 try{
   const initial=await CombatHelper.processPainResistance(owner,[{name:"First",damageType:"L"},{name:"Second",damageType:"L"}],"torso","attack");
   initial.processedWounds.forEach((wound,index)=>owner.items.push({...wound,id:`w${index}`}));
   owner.updateEmbeddedDocuments=async(_type,updates)=>updates.map(update=>{
     const wound=owner.items.get(update._id);wound.system.penalty=update["system.penalty"];return wound;
   });
   const flags={messageType:"painResistanceReport",actorUuid:owner.uuid,woundIds:["w0","w1"],
     results:initial.results.map((result,index)=>({...result,woundId:`w${index}`})),reducedCount:0,reducedDetails:[]};
   const report={id:"report",flags:{neuroshima:flags},getFlag:(_scope,key)=>flags[key],
     async update(data){for(const[key,value]of Object.entries(data))setProperty(this,key,value);}};
   const before=structuredClone(flags.results[0]);face=1;
   const result=await CombatHelper.rerollPainResistance(report,[1]);
   assert.equal(result.updated,1);assert.equal(rolls,3);assert.equal(owner.items.length,2);
   assert.deepEqual(flags.results[0],before);assert.equal(flags.results[1].isPassed,true);
   assert.equal(owner.items.get("w1").system.penalty,flags.results[1].penalty);
   assert.equal(rendered.passedCount,1);assert.equal(rendered.failedCount,1);
   assert.ok(flags.results[1].testData);assert.equal(flags.results[1].rerollCount,1);
   await assert.rejects(CombatHelper.rerollPainResistance(report,[0],observer.id));assert.equal(rolls,3);
   flags.isReversed=true;await assert.rejects(CombatHelper.rerollPainResistance(report,[0]));assert.equal(rolls,3);
   flags.isReversed=false;
   const penalty=owner.items.get("w0").system.penalty;
   NeuroshimaChatMessage._renderTemplate=async()=>{throw new Error("render failed");};
   await assert.rejects(CombatHelper.rerollPainResistance(report,[0]),/render failed/);
   assert.equal(owner.items.get("w0").system.penalty,penalty);assert.deepEqual(flags.results[0],before);
   NeuroshimaChatMessage._renderTemplate=async(_template,context)=>{rendered=context;return "updated-report";};
   const all=await CombatHelper.rerollPainResistance(report,[]);
   assert.equal(all.updated,2);assert.equal(rolls,6);
   assert.equal(flags.results[0].rerollCount,1);assert.equal(flags.results[1].rerollCount,2);
   assert.equal(rendered.passedCount,2);assert.equal(rendered.failedCount,0);

 }finally{game.user=saved.user;game.users=saved.users;game.neuroshima.tests=saved.tests;globalThis.fromUuid=saved.resolver;
   globalThis.Roll=saved.Roll;NeuroshimaScriptRunner.executeEvent=saved.event;NeuroshimaScriptRunner.executeEventSync=saved.sync;
   NeuroshimaChatMessage._renderTemplate=saved.render;}
});

test("reversing a damage report removes its whole linked batch and unlocks the source exactly once", async () => {
 const {MeleeCommandService,createMeleeSession}=await import("../module/combat/melee-system.js");
 const {NeuroshimaChatMessage}=await import("../module/documents/chat-message.js");
 const saved={user:game.user,messages:game.messages,melee:game.neuroshima.melee,resolver:globalThis.fromUuid,ui:globalThis.ui};
 const first=actor(),second=actor();first.uuid="Actor.first";second.uuid="Actor.second";
 const source={messageId:"attack",sessionId:"fight",kind:"duel"};
 const report=(id,owner)=>{
   const flags={messageType:"painResistanceReport",actorUuid:owner.uuid,woundIds:["w"],damageSource:source,isReversed:false};
   return {id,content:"report",getFlag:(_scope,key)=>flags[key],async update(data){
     for(const[key,value]of Object.entries(data)){if(key.startsWith("flags.neuroshima."))flags[key.slice(17)]=value;else this[key]=value;}
   }};
 };
 const r1=report("r1",first),r2=report("r2",second);
 const session=createMeleeSession({id:"fight",attacker:{actorUuid:first.uuid},defender:{actorUuid:second.uuid}});
 session.result={applied:true,beastActionsApplied:true,hits:[{damageType:"L"}]};session.operationLedger={"fight:damage:duel":{status:"applied"},other:{status:"applied"}};
 for(const owner of [first,second]){
   owner.items.push({id:"w",type:"wound"});owner.items.has=id=>owner.items.some(item=>item.id===id);
   owner.effects.push({id:"effect",getFlag:(_scope,key)=>key==="damageWoundIds"?["w"]:undefined});
   owner.deleteEmbeddedDocuments=async(type,ids)=>{const list=type==="Item"?owner.items:owner.effects;
     for(let i=list.length-1;i>=0;i--)if(ids.includes(list[i].id))list.splice(i,1);
   };
 }
 globalThis.fromUuid=async uuid=>uuid===first.uuid?first:uuid===second.uuid?second:null;
 game.user={id:"gm",isGM:true};globalThis.ui={notifications:{info:()=>{}}};
 const origin={id:"attack",getFlag:(_scope,key)=>key==="melee"?{sessionId:"fight"}:null};
 game.messages={contents:[r1,r2,origin],get:id=>({r1,r2,attack:origin})[id]};
 let resets=0;game.neuroshima.melee={get:async()=>session,dispatch:async command=>{resets++;return MeleeCommandService._apply(session,command);}};
 try{
   await CombatHelper.reverseDamage(r1);
   assert.equal(first.items.length,0);assert.equal(second.items.length,0);
   assert.equal(first.effects.length,0);assert.equal(second.effects.length,0);
   assert.equal(r1.getFlag("neuroshima","isReversed"),true);assert.equal(r2.getFlag("neuroshima","isReversed"),true);
   assert.equal(session.result.applied,false);assert.equal(session.result.beastActionsApplied,false);
   assert.equal(session.operationLedger["fight:damage:duel"],undefined);assert.ok(session.operationLedger.other);
   assert.equal(resets,1);
   const button={dataset:{action:"applyOpposedDamage"},disabled:true,classList:{remove(){},add(){}},innerHTML:"Applied"};
   await NeuroshimaChatMessage.restoreDamageButtonState({querySelectorAll:()=>[button]},origin);
   assert.equal(button.disabled,false);
   assert.equal(MeleeCommandService._claimDamage(session,{userId:"gm",payload:{kind:"duel"}}).claimed,true);
   assert.equal((await CombatHelper.reverseDamage(r1)).alreadyReversed,true);
   assert.equal(resets,1);assert.equal(session.operationLedger["fight:damage:duel"].status,"running");
 }finally{game.user=saved.user;game.messages=saved.messages;game.neuroshima.melee=saved.melee;
   globalThis.fromUuid=saved.resolver;globalThis.ui=saved.ui;}
});


test("pain-report selection binds once and excludes critical and automatic results", async () => {
 const {NeuroshimaChatMessage}=await import("../module/documents/chat-message.js");
 const previous=game.user;game.user={isGM:true};
 const row=()=>({dataset:{},listeners:[],classList:{toggle(){}},setAttribute(){},addEventListener(_event,listener){this.listeners.push(listener);}});
 const rows=[row(),row(),row()];const report={dataset:{},querySelectorAll:()=>rows};
 const message={id:"selection",getFlag:(_scope,key)=>({messageType:"painResistanceReport",results:[{}, {isCritical:true},{forcePassed:true}]})[key]};
 const root={querySelector:()=>report};
 try{
   NeuroshimaChatMessage.bindPainReportSelection(root,message);
   NeuroshimaChatMessage.bindPainReportSelection(root,message);
   assert.equal(rows[0].listeners.length,1);assert.equal(rows[1].listeners.length,0);assert.equal(rows[2].listeners.length,0);
   rows[0].listeners[0]();assert.deepEqual([...NeuroshimaChatMessage._selectedPainResults.get(message.id)],[0]);
   rows[0].listeners[0]();assert.equal(NeuroshimaChatMessage._selectedPainResults.get(message.id).size,0);
 }finally{game.user=previous;NeuroshimaChatMessage._selectedPainResults.delete(message.id);}
});

test("damage reset requires a reversed report and remains restricted to GM commands", async () => {
 const {MeleeCommandService}=await import("../module/combat/melee-system.js");
 const previous=game.messages;
 const flags={damageSource:{sessionId:"fight",messageId:"attack",kind:"duel"},isReversed:false};
 const report={getFlag:(_scope,key)=>flags[key]};
 game.messages={get:()=>report,contents:[report]};
 const session={id:"fight",result:{applied:true},operationLedger:{"fight:damage:duel":{status:"applied"}}};
 try{
   await assert.rejects(MeleeCommandService._authorize(session,{type:"resetDamage"},{id:"owner",active:true,isGM:false}),{code:"UNAUTHORIZED"});
   assert.throws(()=>MeleeCommandService._resetDamage(session,{payload:{reportMessageId:"r",kind:"duel"}}),{code:"INVALID_DAMAGE_REPORT"});
   assert.equal(session.result.applied,true);
   flags.isReversed=true;
   const other={getFlag:(_scope,key)=>key==="damageSource"?flags.damageSource:false};
   game.messages.contents.push(other);
   assert.throws(()=>MeleeCommandService._resetDamage(session,{payload:{reportMessageId:"r",kind:"duel"}}),{code:"DAMAGE_NOT_REVERSED"});
   assert.equal(session.result.applied,true);
 }finally{game.messages=previous;}
});


test("the render hook supplies the message before its HTML is attached and enables pain selection", async () => {
 const {NeuroshimaChatMessage}=await import("../module/documents/chat-message.js");
 const previous={user:game.user,HTMLElement:globalThis.HTMLElement};game.user={isGM:true};
 const handlers=[],classes=new Set(),attributes={};
 const row={dataset:{},setAttribute:(key,value)=>{attributes[key]=value;},classList:{toggle(key,enabled){if(enabled)classes.add(key);else classes.delete(key);}},addEventListener:(_event,handler)=>handlers.push(handler)};
 const surface={dataset:{},querySelectorAll:()=>[row]};
 class DetachedRoot{dataset={};closest(){return null;}querySelector(selector){return selector===".pain-resistance-report"?surface:null;}querySelectorAll(){return [];}}
 globalThis.HTMLElement=DetachedRoot;
 const data={messageType:"painResistanceReport",results:[{rerollCount:1},{isCritical:true},{forcePassed:true},{}]};
 const message={id:"detached-pain",getFlag:(_scope,key)=>data[key]};
 try{
   NeuroshimaChatMessage.onChatAction(new DetachedRoot(),message);
   assert.equal(handlers.length,1);assert.equal(classes.has("ns-pain-rerolled"),true);
   assert.deepEqual(NeuroshimaChatMessage.painRerollIndices(message),[0,3]);
   handlers[0]();assert.equal(classes.has("ns-pain-selected"),true);assert.equal(attributes["aria-selected"],"true");
   assert.deepEqual(NeuroshimaChatMessage.painRerollIndices(message),[0]);
   handlers[0]();assert.equal(classes.has("ns-pain-selected"),false);
   assert.equal(classes.has("ns-pain-rerolled"),true);
   assert.deepEqual(NeuroshimaChatMessage.painRerollIndices(message),[0,3]);
 }finally{game.user=previous.user;globalThis.HTMLElement=previous.HTMLElement;NeuroshimaChatMessage._selectedPainResults.delete(message.id);}
});


test("a beast segment is one definition with root fields, fixed segment cost and all fire modes by default", async () => {
 const previous=foundry.data;const previousMigrate=foundry.abstract.TypeDataModel.migrateData;
 class Field {constructor(...args){this.args=args;}}
 foundry.data={fields:Object.fromEntries(["StringField","NumberField","BooleanField","HTMLField","ObjectField","SchemaField","ArrayField"].map(name=>[name,Field]))};
 foundry.abstract.TypeDataModel.migrateData=source=>source;
 try{
   const {BeastSegmentData}=await import("../module/data/item-data.js");
   const schema=BeastSegmentData.defineSchema();
   assert.equal(schema.activities,undefined);assert.ok(schema.segmentCost);assert.ok(schema.weaponType);
   assert.deepEqual(schema.costType.args[0].choices,["segment"]);
   assert.equal(schema.fireModes.args[0].all.args[0].initial,true);
   const source={description:"Shared",activities:[{id:"spit",name:"Spit",weaponType:"ranged",segmentCost:2},{id:"howl",name:"Howl"}]};
   BeastSegmentData.migrateData(source);assert.equal(source.activities,undefined);
   assert.equal(source.legacyActivities.length,2);assert.equal(source.weaponType,"ranged");assert.equal(source.segmentCost,2);
 }finally{foundry.data=previous;foundry.abstract.TypeDataModel.migrateData=previousMigrate;}
});

test("beast package migration preserves all segment definitions, effects, resources and references without duplicate retries", async () => {
 const {migrateBeastItem,beastActivities,resolveBeastActionItem}=await import("../module/helpers/beast-actions.js");
 const collection=[];let failUpdate=true,creates=0;
 class Segment {
   constructor(data,parent){this.data=structuredClone(data);this.id=data._id;this.uuid=`Actor.beast.Item.${this.id}`;this.type=data.type;this.parent=parent;}
   get system(){return this.data.system;}
   getFlag(_scope,key){return this.data.flags?.neuroshima?.[key];}
   toObject(){return structuredClone(this.data);}
   static async create(data,options){assert.equal(options.keepEmbeddedIds,true);creates++;const child=new Segment({...data,_id:`child${creates}`},options.parent);collection.push(child);return child;}
   async update(data){
     if(failUpdate){failUpdate=false;throw new Error("retry migration");}
     for(const[path,value]of Object.entries(data)){
       const keys=path.split(".");if(keys.at(-1).startsWith("-=")){const parent=getProperty(this.data,keys.slice(0,-1).join("."));if(parent)delete parent[keys.at(-1).slice(2)];}
       else setProperty(this.data,path,value);
     }
   }
 }
 collection.get=id=>collection.find(item=>item.id===id);
 const source={_id:"original",type:"beast-segment",name:"Package",img:"paw",effects:[{_id:"effect",name:"Venom"}],
   system:{description:"Shared",resources:[{name:"Uses",value:2}],tests:{value:"Constitution"},activities:[
     {id:"spit",name:"Spit",weaponType:"ranged",segmentCost:2,effectIds:["effect"]},
     {id:"howl",name:"Howl",actionType:"action",segmentCost:1}
   ]},flags:{neuroshima:{meleeActivities:[{id:"old"}]}}};
 const root=new Segment(source,{items:collection});collection.push(root);
 await assert.rejects(migrateBeastItem(root),/retry migration/);
 assert.equal(collection.length,2);
 await migrateBeastItem(root);assert.equal(collection.length,2);assert.equal(creates,1);
 assert.equal(root.id,"original");assert.equal(root.data.name,"Spit");assert.equal(root.system.activities,undefined);
 assert.equal(root.system.costType,"segment");assert.equal(root.system.segmentCost,2);
 for(const item of collection){assert.deepEqual(item.data.effects,source.effects);assert.deepEqual(item.system.resources,source.system.resources);assert.deepEqual(item.system.tests,source.system.tests);assert.equal(beastActivities(item).length,1);}
 assert.equal(collection[1].data.name,"Howl");assert.equal(collection[1].system.costType,"segment");
 assert.equal(resolveBeastActionItem({items:collection},"original","howl"),collection[1]);
 assert.equal(await migrateBeastItem(root),0);
});

test("segment ranged profiles expose configured fire modes and keep them through test recreation", async () => {
 const {createBeastSegmentWeapon}=await import("../module/helpers/beast-actions.js");
 const {getAvailableFireModes,getFireModeModifier}=await import("../module/apps/dialogs/weapon-roll-dialog.js");
 const owner=actor("creature");owner.system.experience=4;
 const segment={id:"spit",type:"beast-segment",name:"Spit",system:{id:"spit",weaponType:"ranged",damage:"L",fireRate:6}};
 let weapon=createBeastSegmentWeapon(owner,segment);
 assert.deepEqual(getAvailableFireModes(weapon).map(mode=>mode.value),[0,1,2,3]);
 segment.system.fireModes={all:false,single:false,shortBurst:true,longBurst:false,fullAuto:true};
 segment.system.fireModeModifiers={shortBurst:10,fullAuto:30};weapon=createBeastSegmentWeapon(owner,segment);
 assert.deepEqual(getAvailableFireModes(weapon).map(mode=>mode.value),[1,3]);assert.equal(getFireModeModifier(weapon,3),30);
 const previous={tests:game.neuroshima.tests,resolver:globalThis.fromUuid};
 game.neuroshima.tests={RangedWeaponTest};globalThis.fromUuid=async uuid=>uuid===owner.uuid?owner:null;
 try{
   const test=new RangedWeaponTest({actor:owner,item:weapon});
   const restored=await RangedWeaponTest.recreate(test.toData());
   assert.deepEqual(restored.item.system.fireModes,segment.system.fireModes);
   assert.deepEqual(getAvailableFireModes(restored.item).map(mode=>mode.value),[1,3]);
 }finally{game.neuroshima.tests=previous.tests;globalThis.fromUuid=previous.resolver;}
});

test("segment sheet saves its definition and fire mode checkboxes directly on the Item", async () => {
 const {BeastActivitySheet}=await import("../module/apps/beast-activity-sheet.js");
 let saved;
 const item={id:"segment",type:"beast-segment",name:"Spit",img:"paw",isOwner:true,
   system:{id:"segment",segmentCost:1,fireModes:{all:true,single:true}},
   async update(data){saved=data;}};
 const sheet={item,activityId:"segment",_saveActivities:BeastActivitySheet.prototype._saveActivities};
 await BeastActivitySheet._onSubmit.call(sheet,{target:{name:"fireModes.all"}},null,{object:{
   name:"Volley",segmentCost:3,"fireModes.all":false,"fireModes.single":false,
   "fireModes.shortBurst":true,"fireModeModifiers.shortBurst":10
 }});
 assert.equal(saved.name,"Volley");assert.equal(saved["system.segmentCost"],3);
 assert.deepEqual(saved["system.fireModes"],{all:false,single:false,shortBurst:true});
 assert.equal(saved["system.fireModeModifiers"].shortBurst,10);
 assert.equal(saved["system.activities"],undefined);assert.equal(saved["system.name"],undefined);
});

test("pain report details remain visible to the patient owner below the configured role, including reversed reports", async () => {
 const {NeuroshimaChatMessage}=await import("../module/documents/chat-message.js");
 const previous={user:game.user,resolver:globalThis.fromUuidSync};
 const patient=actor();const data={messageType:"painResistanceReport",actorUuid:patient.uuid,isReversed:true};
 const message={getFlag:(_scope,key)=>data[key]};
 try{
   game.user={isGM:false,role:1};globalThis.fromUuidSync=()=>({actor:patient});
   assert.equal(NeuroshimaChatMessage.canViewPainReportDetails(message,4),true);
   assert.equal(NeuroshimaChatMessage.canRerollPainReport(message),false);
   patient.isOwner=false;assert.equal(NeuroshimaChatMessage.canViewPainReportDetails(message,4),false);
   game.user.role=4;assert.equal(NeuroshimaChatMessage.canViewPainReportDetails(message,4),true);
   game.user={isGM:true,role:1};assert.equal(NeuroshimaChatMessage.canViewPainReportDetails(message,4),true);
 }finally{game.user=previous.user;globalThis.fromUuidSync=previous.resolver;}
});

test("exchange damage display uses selected beast definitions, preserves repeats and includes counters", async () => {
 const {exchangeDamageHits,summarizeExchangeDamage}=await import("../module/combat/melee-damage-summary.js");
 const attacker=actor("creature");attacker.name="Beast";
 attacker.items.push({id:"claw",type:"beast-action",name:"Claw",system:{id:"claw",damage:"2L + 1D"}});
 const defender=actor();defender.name="Hero";
 const hits=exchangeDamageHits({hits:[{damageType:"D"}],allBeastQueue:["claw::claw","claw::claw"],counterHits:[{damageType:"C"}]},attacker,defender);
 assert.equal(hits.length,3);assert.equal(hits[0].damageType,"2L + 1D");assert.equal(hits[0].actionName,"Claw");
 assert.equal(hits[2].sourceName,"Hero");assert.equal(hits[2].targetName,"Beast");assert.equal(hits[2].isCounter,true);
 const rows=summarizeExchangeDamage(hits);
 assert.deepEqual(rows.defender,[{damageType:"L",count:4},{damageType:"D",count:2}]);
 assert.deepEqual(rows.attacker,[{damageType:"C",count:1}]);
 const normal=exchangeDamageHits({hits:[{damageType:"K"}]},defender,attacker);
 assert.equal(normal[0].damageType,"K");
});

test("movement sheets keep the editable source separate from multiplied Active Effect values across repeated saves", async () => {
 const {NeuroshimaBaseActorSheet}=await import("../module/sheets/actor-sheet-base.js");
 for(const type of ["character","npc","creature"]){
   const document={type,_source:{system:{movement:2}},system:{movement:4}};
   const sheet=new NeuroshimaBaseActorSheet({document});
   for(let i=0;i<4;i++){
     const context=await sheet._prepareContext({});
     assert.equal(context.movementBase,2);assert.equal(context.movementEffective,4);
     document._source.system.movement=context.movementBase;
     document.system.movement=document._source.system.movement*2;
   }
   document._source.system.movement=3;document.system.movement=6;
   assert.equal((await sheet._prepareContext({})).movementBase,3);
   assert.equal((await sheet._prepareContext({})).movementEffective,6);
 }
 const vehicle=new NeuroshimaBaseActorSheet({document:{type:"vehicle",system:{movement:"wheeled"}}});
 assert.equal((await vehicle._prepareContext({})).movementBase,undefined);
});

test("automatic death fires once, survives manual removal and resets only after healing below the limit", async () => {
 const {checkAutomaticDeath}=await import("../module/apps/config/condition-config.js");
 for(const type of ["npc","creature"]){
   let flag=false,applied=0,removed=0,present=false;
   const actor={type,getFlag:()=>flag,async setFlag(_scope,_key,value){flag=value;}};
   const ctx={actor,usesAutomaticDefeat:true,isDefeated:true,
     async apply(){applied++;present=true;},async remove(){removed++;present=false;}};
   await checkAutomaticDeath(ctx);assert.equal(applied,1);assert.equal(flag,true);
   present=false;
   for(let i=0;i<5;i++)await checkAutomaticDeath(ctx);
   assert.equal(applied,1);assert.equal(present,false);
   ctx.isDefeated=false;await checkAutomaticDeath(ctx);assert.equal(flag,false);assert.equal(removed,1);
   ctx.isDefeated=true;await checkAutomaticDeath(ctx);assert.equal(applied,2);assert.equal(flag,true);
   // The persistent flag also suppresses a fresh context after reloading.
   await checkAutomaticDeath({...ctx});assert.equal(applied,2);
 }
 let writes=0;
 await checkAutomaticDeath({usesAutomaticDefeat:false,actor:{setFlag(){writes++;}}});assert.equal(writes,0);
});

test("failed automatic death application remains retryable", async () => {
 const {checkAutomaticDeath}=await import("../module/apps/config/condition-config.js");
 let flag=false;
 const ctx={usesAutomaticDefeat:true,isDefeated:true,actor:{getFlag:()=>flag,async setFlag(_s,_k,v){flag=v;}},async apply(){throw Error("create failed");}};
 await assert.rejects(checkAutomaticDeath(ctx),/create failed/);assert.equal(flag,false);
});

test("creature wound controls persist to the embedded Item and actor saves exclude stale wound snapshots", async () => {
 const {NeuroshimaCreatureSheet}=await import("../module/sheets/creature-sheet.js");
 const owner=actor("creature");const wound={id:"wound",type:"wound",system:{penalty:30,damageType:"C",location:"head"},async update(data){for(const [key,value]of Object.entries(data))setProperty(this,key,value);}};
 owner.items.push(wound);
 const sheet=new NeuroshimaCreatureSheet({document:owner});sheet.isEditable=true;
 for(const [property,value,type]of [["penalty","12","number"],["damageType","L","select-one"],["location","torso","select-one"]]){
   await sheet._onChangeForm({}, {target:{name:`items.wound.system.${property}`,value,type}});
 }
 assert.deepEqual(wound.system,{penalty:12,damageType:"L",location:"torso"});
 const data={name:"Beast",items:{wound:{system:{penalty:30}}},"items.wound.system.damageType":"C"};
 await sheet._processSubmitData({},null,data);
 assert.deepEqual(data,{name:"Beast"});assert.equal(wound.system.penalty,12);
 await sheet._onChangeForm({}, {target:{name:"items.wound.system.penalty",value:"-3",type:"number"}});
 assert.equal(wound.system.penalty,0);
 owner.isOwner=false;
 await sheet._onChangeForm({}, {target:{name:"items.wound.system.penalty",value:"9",type:"number"}});
 assert.equal(wound.system.penalty,0);
});

test("prone stays manual and stored built-in defeat checks are cleared without changing custom scripts", async () => {
 const {getConditions,DEFAULT_CONDITIONS}=await import("../module/apps/config/condition-config.js");
 const previous=game.settings.get;
 const oldCode='if (!this.usesAutomaticDefeat) return;\nif (this.isDefeated) await this.apply();\nelse await this.remove();';
 try{
   assert.equal(DEFAULT_CONDITIONS.find(c=>c.key==="prone").conditionCheckCode,"");
   game.settings.get=()=>[{key:"prone",conditionCheckCode:oldCode},{key:"dead",conditionCheckCode:oldCode}];
   let conditions=getConditions();
   assert.equal(conditions.find(c=>c.key==="prone").conditionCheckCode,"");
   assert.equal(conditions.find(c=>c.key==="dead").conditionCheckCode,"await this.checkAutomaticDeath();");
   game.settings.get=()=>[{key:"prone",conditionCheckCode:"// Custom manual setup"}];
   conditions=getConditions();assert.equal(conditions.find(c=>c.key==="prone").conditionCheckCode,"// Custom manual setup");
 }finally{game.settings.get=previous;}
});
