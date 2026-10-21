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
  utils: { deepClone: structuredClone, randomID: () => `id${++sequence}`, getProperty, setProperty,
    expandObject: object => { const expanded = {}; for (const [key, value] of Object.entries(object)) setProperty(expanded, key, value); return expanded; },
    escapeHTML: value => String(value), Semaphore: class {} },
  applications: { api: { ApplicationV2: Application, HandlebarsApplicationMixin: Base => Base, DialogV2: {} },
    sheets: { ActorSheetV2: Application, ItemSheetV2: Application } }
};
globalThis.ChatMessage = class {};
globalThis.Item = class {};
globalThis.game = { i18n: { localize: key => key, format: key => key }, user: { targets: [] },
  settings: { get: (scope, key) => settings[key] }, neuroshima: { log: () => {} } };
Math.clamp ??= (value, min, max) => Math.min(max, Math.max(min, value));
const settings = { armorLimitEnabled: true, armorLimitCharacter: 6, armorLimitCreature: 4, armorLimitVehicle: 9 };
const { clampArmor, preserveArmorSourceValues } = await import("../module/helpers/armor-limit.js");
const { specialityBonus, specialityCost, advanceSpeciality } = await import("../module/helpers/speciality.js");
const { SkillTest, RangedWeaponTest } = await import("../module/tests.mjs");
const { NeuroshimaScriptRunner } = await import("../module/apps/neuroshima-script-engine.js");
const { CombatHelper } = await import("../module/helpers/combat-helper.js");
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
