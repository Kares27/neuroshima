import test from "node:test";
import assert from "node:assert/strict";

Math.clamp ??= (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const deepClone = value => structuredClone(value ?? {});
globalThis.foundry = {
  utils: {
    deepClone,
    mergeObject(target, source) {
      for (const [key, value] of Object.entries(source ?? {})) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          target[key] ??= {};
          this.mergeObject(target[key], value);
        } else target[key] = value;
      }
      return target;
    }
  }
};
globalThis.game = {
  neuroshima: {
    NeuroshimaScriptRunner: {
      async executeEvent() {},
      executeEventSync() {}
    }
  },
  i18n: { localize: key => key },
  settings: {
    get: (_scope, key) => ({
      rollTooltipMinRole: 0,
      rollTooltipOwnerVisibility: false,
      doubleSkillAction: false,
      fireCorrection: false
    })[key]
  },
  user: { role: 4, isGM: true }
};
globalThis.ui = { notifications: { warn() {} } };
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;

let dice = [2, 8, 15];
globalThis.Roll = class {
  constructor() {
    this.terms = [{ results: [] }];
  }
  async evaluate() {
    this.terms[0].results = dice.map(result => ({ result }));
    return this;
  }
};

const documents = new Map();
const {
  NEUROSHIMA_TESTS,
  NeuroshimaTestBase,
  SkillTest,
  WeaponTest,
  AttackTest,
  RangedWeaponTest,
  MeleeWeaponTest
} = await import("../module/tests.mjs");
game.neuroshima.tests = NEUROSHIMA_TESTS;

function actorFixture() {
  return {
    id: "actor",
    uuid: "Actor.actor",
    img: "actor.webp",
    isOwner: true,
    items: new Map()
  };
}

test("concrete tests inherit from base", () => {
  assert.ok(new SkillTest() instanceof NeuroshimaTestBase);
  assert.ok(new RangedWeaponTest() instanceof WeaponTest);
  assert.ok(new MeleeWeaponTest() instanceof AttackTest);
});

test("test recreates from rollClass", async () => {
  const actor = actorFixture();
  documents.set(actor.uuid, actor);
  const original = new SkillTest({
    preData: { stat: 12, skill: 4 },
    result: { rawResults: [2, 8, 15] }
  }, actor);
  const recreated = await NeuroshimaTestBase.recreate(original.toData());
  assert.ok(recreated instanceof SkillTest);
  assert.deepEqual(recreated.result.rawResults, [2, 8, 15]);
});

test("weapon triggers follow WFRP order", async () => {
  const actor = actorFixture();
  const weapon = {
    id: "weapon",
    uuid: "Actor.actor.Item.weapon",
    name: "Rifle",
    system: {
      weaponType: "ranged",
      skipMagazineCheck: true,
      fireRate: 1,
      damage: "L",
      piercing: 0,
      jamming: 20
    },
    async update() {}
  };
  const events = [];
  const instance = new RangedWeaponTest({
    item: weapon,
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15], bulletsFired: 1 }
  }, actor);
  instance.sendToChat = async () => null;
  instance.runTrigger = async trigger => events.push(trigger);
  await instance.roll({ sendToChat: false });
  assert.deepEqual(events, ["preRollTest", "preRollWeaponTest", "rollTest", "rollWeaponTest"]);
});

test("editing weapon roll does not consume ammunition twice", async () => {
  const actor = actorFixture();
  let updates = 0;
  const magazine = {
    id: "magazine",
    type: "magazine",
    system: { contents: [{ name: "Ammo", quantity: 3 }] },
    async update() { updates += 1; }
  };
  actor.items.set(magazine.id, magazine);
  const weapon = {
    id: "weapon",
    uuid: "Actor.actor.Item.weapon",
    name: "Rifle",
    system: { weaponType: "ranged", magazine: magazine.id, fireRate: 1, damage: "L", piercing: 0, jamming: 20 },
    async update() {}
  };
  const instance = new RangedWeaponTest({
    item: weapon,
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15], bulletsFired: 1 }
  }, actor);
  instance.sendToChat = async () => null;
  await instance.roll({ sendToChat: false });
  const afterRoll = updates;
  await instance.edit({ rawResults: [1, 2, 3] });
  assert.equal(updates, afterRoll);
});

test("open ranged test with one die is cancelled", async () => {
  class OneDieRangedTest extends RangedWeaponTest {
    get diceCount() { return 1; }
  }
  const instance = new OneDieRangedTest({
    preData: { stat: 12, skill: 4, isOpen: true, fixedDice: [2] }
  }, actorFixture());
  instance.runTrigger = async () => {};
  await instance.roll({ sendToChat: false });
  assert.equal(instance.preData.cancelled, true);
});

test("test supplies chat tooltip", async () => {
  const instance = new SkillTest({
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15] },
    context: { isDebug: true }
  }, actorFixture());
  instance.sendToChat = async () => null;
  await instance.roll({ sendToChat: false });
  const context = await instance.getChatData();
  assert.equal(typeof context.dataTooltip, "string");
  assert.match(context.dataTooltip, /Target|Cel/);
});

test("reroll and edit preserve lifecycle state without resource side effects", async () => {
  const instance = new SkillTest({
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15] },
    context: { isDebug: true }
  }, actorFixture());
  instance.sendToChat = async () => null;
  await instance.roll({ sendToChat: false });
  await instance.edit({ rawResults: [1, 2, 3] });
  assert.equal(instance.context.edited, true);
  assert.deepEqual(instance.result.rawResults, [1, 2, 3]);
  assert.ok(instance.context.previousResult);

  dice = [4, 5, 6];
  await instance.reroll();
  assert.equal(instance.context.reroll, true);
  assert.equal(instance.context.edited, false);
  assert.deepEqual(instance.result.rawResults, [4, 5, 6]);
});
