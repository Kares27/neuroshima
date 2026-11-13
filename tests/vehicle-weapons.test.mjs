import assert from "node:assert/strict";
import { test } from "node:test";

const instances = [];
class Application {
  constructor(options = {}) { this.options = options; this.document = options.document; instances.push(this); }
  async _prepareContext() { return {}; }
  async render() { this.rendered = true; return this; }
  async close() { this.closed = true; }
}
const setProperty = (object, path, value) => {
  const parts = path.split("."); let target = object;
  for (const key of parts.slice(0, -1)) target = target[key] ??= {};
  target[parts.at(-1)] = value;
};
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  utils: { deepClone: value => structuredClone(value), Semaphore: class {},
    getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object), setProperty,
    expandObject: object => { const result = {}; for (const [key, value] of Object.entries(object)) setProperty(result, key, value); return result; } },
  applications: { api: { ApplicationV2: Application, HandlebarsApplicationMixin: Base => Base },
    sheets: { ActorSheetV2: Application, ItemSheetV2: Application }, ux: {} }
};
globalThis.ChatMessage = class {};
globalThis.ActiveEffect = class {};
globalThis.Item = class {};
globalThis.Roll = class { async evaluate() { this.total = 10; return this; } };
Math.clamp ??= (value, min, max) => Math.min(max, Math.max(min, value));
const { RangedWeaponTest, NeuroshimaTestBase } = await import("../module/tests.mjs");
const { NeuroshimaWeaponRollDialog } = await import("../module/apps/dialogs/weapon-roll-dialog.js");
const { NeuroshimaVehicleSheet } = await import("../module/sheets/vehicle-sheet.js");
const { VehicleCrewSelectDialog } = await import("../module/apps/dialogs/vehicle-crew-select-dialog.js");
const { NeuroshimaChatMessage } = await import("../module/documents/chat-message.js");
const { NeuroshimaScript, NeuroshimaScriptRunner } = await import("../module/apps/neuroshima-script-engine.js");

function inventory(items = []) { items.get = id => items.find(item => item.id === id); return items; }
function document(data) {
  return { ...data, async update(update) { for (const [key, value] of Object.entries(update)) setProperty(this, key, value); } };
}
function setup(generation = 13) {
  instances.length = 0;
  const warnings = [], errors = [], messages = [], events = [];
  const crew = document({ id: "gunner", uuid: "Actor.gunner", documentName: "Actor", type: "npc", name: "Gunner", isOwner: true,
    items: inventory(), system: { attributeTotals: { dexterity: 16 }, skills: { shooting: { value: 7 } }, combat: {} },
    _setupTest(TestClass, data) { this.lastTest = new TestClass({ ...data, preData: { ...data.preData, fixedDice: [8] } }, this); return this.lastTest; } });
  const vehicle = document({ id: "vehicle", uuid: "Actor.vehicle", documentName: "Actor", type: "vehicle", isOwner: true,
    items: inventory(), system: { crewMembers: [{ actorUuid: crew.uuid, actorId: crew.id, role: "passenger" }] } });
  const magazine = document({ id: "mag", uuid: "Actor.vehicle.Item.mag", type: "magazine", actor: vehicle,
    system: { contents: [{ name: "Rounds", quantity: 4, ammoId: "source-ammo", ammoSnapshot: { caliber: "7.62", ammoCategory: "standard" }, overrides: {} }] } });
  const weapon = document({ id: "gun", uuid: "Actor.vehicle.Item.gun", type: "weapon", name: "Mounted gun", actor: vehicle,
    system: { weaponType: "ranged", attribute: "dexterity", skill: "shooting", caliber: "7.62", magazine: magazine.id,
      damage: "C", piercing: 2, jamming: 20, jammed: false, fireRate: 2, fireModes: { all: true } } });
  vehicle.items.push(weapon, magazine);
  const decoy = document({ id: "mag", type: "magazine", system: { contents: [{ name: "Personal rounds", quantity: 99 }] } });
  crew.items.push(decoy);
  const target = { actor: { id: "target", uuid: "Actor.target" }, document: { uuid: "Scene.scene.Token.target" }, center: { x: 30, y: 0 } };
  const sourceToken = { actor: vehicle, document: { uuid: "Scene.scene.Token.vehicle", movementHistory: [] }, center: { x: 0, y: 0 } };
  globalThis.canvas = { scene: { id: "scene", tokens: [] }, tokens: { placeables: [sourceToken], controlled: [] },
    grid: { measurePath: ([a, b]) => ({ distance: Math.hypot(b.x - a.x, b.y - a.y) }) } };
  globalThis.game = { release: { generation }, user: { id: "player", isGM: false, targets: new Set([target]) },
    combats: {}, actors: new Map([[crew.id, crew], [vehicle.id, vehicle]]),
    settings: { get: (_scope, key) => key === "rollMode" ? "publicroll" : key === "messageMode" ? "public" : false },
    i18n: { localize: key => key, format: (key, values) => `${key} ${JSON.stringify(values)}` },
    neuroshima: { tests: { RangedWeaponTest }, log() {}, NeuroshimaScriptRunner: {
      executeEvent: async (trigger, args) => { events.push({ trigger, actor: args.actor, item: args.item }); },
      executeEventSync() {}
    } } };
  globalThis.ui = { notifications: { warn: text => warnings.push(text), error: text => errors.push(text) } };
  globalThis.fromUuid = async uuid => new Map([[crew.uuid, crew], [vehicle.uuid, vehicle], [weapon.uuid, weapon]]).get(uuid) ?? null;
  NeuroshimaChatMessage.renderTest = async test => { const data = test.toData(); messages.push(data); return { id: `message${messages.length}` }; };
  const formData = { modifier: 0, attributeBonus: 0, skillBonus: 0, aimingLevel: 0, burstLevel: 0, fireRate: 2,
    maneuver: "none", hitLocation: "torso", rollMode: "publicroll", distance: 30 };
  foundry.applications.ux.FormDataExtended = class { constructor() { this.object = formData; } };
  const bindForm = dialog => { dialog.element = { tagName: "FORM", querySelector: () => null }; return dialog; };
  const dialog = () => bindForm(new NeuroshimaWeaponRollDialog({ actor: crew, weapon, targets: [target.document.uuid], sourceActor: vehicle, sourceToken }));
  return { crew, vehicle, weapon, magazine, decoy, target, sourceToken, formData, warnings, errors, messages, events, bindForm, dialog };
}

test("vehicle crew selection reaches a real weapon test using crew statistics and vehicle ammunition in V13 and V14", async () => {
  for (const generation of [13, 14]) {
    const s = setup(generation);
    const sheet = new NeuroshimaVehicleSheet({ document: s.vehicle });
    await NeuroshimaVehicleSheet.DEFAULT_OPTIONS.actions.rollWeapon.call(sheet, {}, { dataset: { itemId: s.weapon.id } });
    const selector = instances.find(instance => instance instanceof VehicleCrewSelectDialog);
    const context = await selector._prepareContext({});
    assert.equal(context.crewOptions[0].actorUuid, s.crew.uuid);
    selector.element = { tagName: "FORM", querySelector: () => ({ value: s.crew.uuid }) };
    await selector._onConfirm();
    const dialog = instances.find(instance => instance instanceof NeuroshimaWeaponRollDialog);
    assert.equal(dialog.actor, s.crew);
    assert.equal(dialog.sourceActor, s.vehicle);
    assert.equal(dialog.rollOptions.distance, 30);
    assert.deepEqual(dialog.targets, [s.target.document.uuid]);
    s.bindForm(dialog);
    const result = await dialog._onRoll();
    assert.equal(result.baseStat, 16);
    assert.equal(result.baseSkill, 7);
    assert.equal(result.actorId, s.crew.id);
    assert.equal(result.weaponUuid, s.weapon.uuid);
    assert.equal(result.actorUuid, s.crew.uuid);
    assert.equal(s.magazine.system.contents[0].quantity, 3);
    assert.equal(s.decoy.system.contents[0].quantity, 99);
    assert.equal(s.messages.length, 1);
    assert.equal(s.messages[0].preData.actorUuid, s.crew.uuid);
    assert.equal(s.messages[0].preData.itemUuid, s.weapon.uuid);
    assert.ok(s.events.every(event => event.actor === s.crew && event.item === s.weapon));
    assert.equal(dialog.closed, true);
    assert.deepEqual(s.errors, []);
  }
});

test("recreated vehicle tests refund and change burst ammunition in the vehicle rather than the shooter's matching item ID", async () => {
  const s = setup();
  s.formData.burstLevel = 1;
  await s.dialog()._onRoll();
  const saved = s.messages[0];
  const test = await NeuroshimaTestBase.recreate(saved);
  assert.equal(test.item, s.weapon);
  assert.equal(test.actor, s.crew);
  assert.equal(await test.refundBurstLevel(0), 1);
  assert.equal(s.magazine.system.contents[0].quantity, 3);
  assert.equal(s.decoy.system.contents[0].quantity, 99);
  await s.magazine.update({ "system.contents": [{ name: "Rounds", quantity: 2 }] });
  test.result.burstLevel = 0;
  test.preData.originalBurstLevel = 1;
  assert.equal(await test.increaseBurstLevel(1), 1);
  assert.equal(s.magazine.system.contents[0].quantity, 1);
});

test("the last vehicle round can be rerolled without another ammunition check or consumption", async () => {
  const s = setup();
  s.magazine.system.contents[0].quantity = 1;
  await s.dialog()._onRoll();
  assert.deepEqual(s.magazine.system.contents, []);
  const test = await NeuroshimaTestBase.recreate(s.messages[0]);
  test.context.previousResult = structuredClone(test.result);
  test.context.reroll = true;
  test.preData.fixedDice = [9];
  await test.roll({ restoreInput: false });
  assert.equal(test.preData.cancelled, false);
  assert.equal(s.messages.length, 2);
  assert.deepEqual(s.magazine.system.contents, []);
  assert.deepEqual(s.warnings, []);
});

test("missing or empty vehicle magazines and jams warn the player and preserve the dialog for retry", async () => {
  for (const state of ["missing", "empty", "jammed"]) {
    const s = setup();
    if (state === "missing") s.vehicle.items.splice(s.vehicle.items.indexOf(s.magazine), 1);
    if (state === "empty") s.magazine.system.contents = [];
    if (state === "jammed") s.weapon.system.jammed = true;
    const dialog = s.dialog();
    assert.equal(await dialog._onRoll(), null);
    assert.equal(dialog.closed, undefined);
    assert.equal(s.messages.length, 0);
    assert.equal(s.warnings.length, 1);
    if (state === "missing") s.vehicle.items.push(s.magazine);
    if (state === "empty") s.magazine.system.contents = [{ name: "Rounds", quantity: 2 }];
    if (state === "jammed") s.weapon.system.jammed = false;
    assert.ok(await dialog._onRoll());
    assert.equal(s.messages.length, 1);
  }
});

test("vehicle rolls consume directly selected ammunition and refunds return it to the same vehicle", async () => {
  const s = setup();
  const ammo = document({ id: "direct", type: "ammo", name: "Special rounds", actor: s.vehicle,
    system: { quantity: 2, isOverride: true, overrideDamage: true, damage: "K", overridePiercing: true, piercing: 5 } });
  s.vehicle.items.push(ammo);
  s.weapon.system.magazine = ammo.id;
  const result = await s.dialog()._onRoll();
  assert.equal(result.damage, "K");
  assert.equal(Number(result.piercing), 5);
  assert.equal(ammo.system.quantity, 1);
  const flags = new Map();
  assert.equal(await s.crew.lastTest.refundAmmunition({ getFlag: (_scope, key) => flags.get(key), setFlag: async (_scope, key, value) => flags.set(key, value) }), true);
  assert.equal(ammo.system.quantity, 2);
});

test("a vehicle owner may use a passenger's readable statistics without attempting to write that passenger's preferences", async () => {
  const s = setup();
  s.crew.isOwner = false;
  s.crew.update = async () => assert.fail("Passenger actor update requires ownership");
  assert.ok(await s.dialog()._onRoll());
  assert.equal(s.messages.length, 1);
  assert.equal(s.magazine.system.contents[0].quantity, 3);
});

test("launchers use ranged controls, the vehicle's projectile inventory and point targeting", async () => {
  const s = setup(14);
  const ammo = document({ id: "rocket", type: "ammo", name: "Rocket", actor: s.vehicle,
    system: { quantity: 1, caliber: "40mm", ammoCategory: "launcher", blastZones: [{ radius: 5, damage: "C" }] } });
  s.vehicle.items.push(ammo);
  Object.assign(s.weapon.system, { weaponType: "launcher", caliber: "40mm", directAmmo: ammo.id, magazine: "" });
  s.target.setTarget = () => game.user.targets.clear();
  const sheet = new NeuroshimaVehicleSheet({ document: s.vehicle });
  sheet.minimize = async () => {};
  sheet.maximize = async () => {};
  sheet._waitForTarget = async options => { assert.deepEqual(options, { templateRadius: 5, pointOnly: true }); return { distance: 0, point: { x: 0, y: 0 } }; };
  const dialog = await sheet._rollCrewWeapon(s.weapon, s.crew);
  assert.equal(dialog.rollType, "ranged");
  assert.equal(dialog.isLauncher, true);
  assert.deepEqual(dialog.targets, []);
  assert.equal(dialog.rollOptions.distance, 0);
  assert.deepEqual(dialog.launcherTargetPoint, { x: 0, y: 0 });
  s.bindForm(dialog);
  const previous = NeuroshimaChatMessage.placeGrenadeTemplateAt;
  let placement;
  NeuroshimaChatMessage.placeGrenadeTemplateAt = async (_message, point) => { placement = point; };
  try {
    const result = await dialog._onRoll();
    assert.equal(result.isLauncher, true);
    assert.equal(result.blastZones[0].radius, 5);
    assert.equal(ammo.system.quantity, 0);
    assert.deepEqual(placement, { x: 0, y: 0 });
  } finally { NeuroshimaChatMessage.placeGrenadeTemplateAt = previous; }
});

test("restoring mixed vehicle ammunition preserves the original magazine stack order and snapshots", async () => {
  const s = setup();
  const original = [
    { name: "First", quantity: 1, ammoId: "a", ammoSnapshot: { caliber: "7.62" }, overrides: {} },
    { name: "Last", quantity: 1, ammoId: "b", ammoSnapshot: { caliber: "7.62" }, overrides: { enabled: true, damage: "K" } }
  ];
  s.magazine.system.contents = structuredClone(original);
  s.formData.burstLevel = 1;
  await s.dialog()._onRoll();
  assert.deepEqual(s.magazine.system.contents, []);
  const flags = new Map();
  const message = { getFlag: (_scope, key) => flags.get(key), setFlag: async (_scope, key, value) => flags.set(key, value) };
  assert.equal(await s.crew.lastTest.refundAmmunition(message), true);
  assert.deepEqual(s.magazine.system.contents.map(({ img, ...stack }) => stack), original);
  assert.equal(await s.crew.lastTest.refundAmmunition(message), false);
  assert.equal(s.decoy.system.contents[0].quantity, 99);
});

test("rapid vehicle roll clicks publish one message and consume ammunition once", async () => {
  const s = setup();
  const update = s.crew.update.bind(s.crew);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  s.crew.update = async data => { await gate; return update(data); };
  const dialog = s.dialog();
  const first = dialog._onRoll();
  assert.equal(await dialog._onRoll(), null);
  release();
  assert.ok(await first);
  assert.equal(s.messages.length, 1);
  assert.equal(s.magazine.system.contents[0].quantity, 3);
});

test("unexpected weapon failures are reported and leave the dialog available for retry", async () => {
  const s = setup();
  const update = s.crew.update;
  s.crew.update = async () => { throw new Error("Unavailable actor"); };
  const dialog = s.dialog();
  const originalError = console.error;
  console.error = () => {};
  try { assert.equal(await dialog._onRoll(), null); }
  finally { console.error = originalError; }
  assert.equal(s.messages.length, 0);
  assert.ok(s.errors[0].includes("Unavailable actor"));
  s.crew.update = update;
  assert.ok(await dialog._onRoll());
  assert.equal(s.messages.length, 1);
});

test("mounted weapon item scripts run for the selected shooter without importing the vehicle owner's actor buffs", async () => {
  const s = setup();
  s.crew.effects = [];
  s.weapon.documentName = "Item";
  const effect = (documentType, code, trigger) => {
    const data = { uuid: `${s.weapon.uuid}.ActiveEffect.${documentType}`, name: documentType,
      parent: s.weapon, actor: s.vehicle, disabled: false, system: {},
      getFlag: (_scope, key) => ({ documentType, transferType: "owningDocument" })[key] };
    data.scripts = [new NeuroshimaScript({ trigger, code, activateScript: "return true;" }, data)];
    return data;
  };
  s.weapon.effects = [
    effect("item", "args.fields.attributeBonus += 2;", "dialog"),
    effect("actor", "args.fields.attributeBonus += 99;", "dialog")
  ];
  const result = await NeuroshimaScriptRunner.computeDialogFields(s.crew, {
    rollType: "ranged", weapon: s.weapon, attribute: { key: "dexterity", value: 16 }, difficulty: "average"
  });
  assert.equal(result.scriptFields.attributeBonus, 2);
  const script = effect("item", "args.test.preData.attributeBonus += 3;", "preRollWeaponTest");
  s.weapon.effects = [script, effect("actor", "args.test.preData.attributeBonus += 99;", "preRollWeaponTest")];
  const args = { actor: s.crew, item: s.weapon, test: { preData: { attributeBonus: 0 } } };
  await NeuroshimaScriptRunner.executeEvent("preRollWeaponTest", args);
  assert.equal(args.test.preData.attributeBonus, 3);
  s.crew.items.push(s.weapon);
  assert.equal(NeuroshimaScriptRunner.getScripts(s.crew, "preRollWeaponTest", s.weapon).filter(entry => entry.effect === script).length, 1);
});

test("partial bursts and a subsequent full refund never return more vehicle ammunition than was fired", async () => {
  const s = setup();
  s.formData.burstLevel = 2;
  await s.dialog()._onRoll();
  assert.deepEqual(s.magazine.system.contents, []);
  const test = await NeuroshimaTestBase.recreate(s.messages[0]);
  assert.equal(test.result.bulletsFired, 4);
  assert.equal(await test.setBurstLevel(1), true);
  assert.equal(test.result.bulletsFired, 2);
  assert.equal(s.magazine.system.contents[0].quantity, 2);
  assert.equal(await test.setBurstLevel(0), true);
  assert.equal(test.result.bulletsFired, 1);
  assert.equal(s.magazine.system.contents[0].quantity, 3);
  const flags = new Map();
  await test.refundAmmunition({ getFlag: (_scope, key) => flags.get(key), setFlag: async (_scope, key, value) => flags.set(key, value) });
  assert.equal(s.magazine.system.contents[0].quantity, 4);
});

test("vehicle damage source preserves the exact crew Actor and mounted weapon UUIDs", async () => {
  const s = setup();
  s.crew.uuid = "Scene.other.Token.crew.Actor.gunner";
  game.actors.set(s.crew.id, { id: s.crew.id, uuid: "Actor.gunner", name: "Prototype" });
  await s.dialog()._onRoll();
  const { CombatHelper } = await import("../module/helpers/combat-helper.js");
  const source = await CombatHelper._resolveDamageSource(s.messages[0].result);
  assert.equal(source.attacker, s.crew);
  assert.equal(source.weapon, s.weapon);
});

test("vehicle movement and UUID-based target movement are included in ranged penalties", () => {
  const s = setup(14);
  game.combats.active = {};
  s.sourceToken.document.movementHistory = [{ x: 1, y: 0 }];
  s.target.document.movementHistory = [{ x: 20, y: 0 }];
  const dialog = s.dialog();
  assert.equal(dialog.shooterMovedPenalty, 30);
  assert.equal(dialog.targetMovedPenalty, 20);
});
