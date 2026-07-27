import test from "node:test";
import assert from "node:assert/strict";

Math.clamp ??= (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const deepClone = value => structuredClone(value ?? {});
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: Base => class extends Base {}
    }
  },
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
globalThis.Actor = class {};
globalThis.Item = class {};
globalThis.ActiveEffect = class {};
globalThis.game = {
  neuroshima: {
    NeuroshimaScriptRunner: {
      async executeEvent() {},
      executeEventSync() {}
    }
  },
  i18n: {
    localize: key => key,
    format: (key, data) => `${key.replace("{index}", data?.index ?? "")}`
  },
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
  HealingTest,
  PercentileTest,
  WeaponTest,
  AttackTest,
  RangedWeaponTest,
  MeleeWeaponTest
} = await import("../module/tests.mjs");
const { NeuroshimaScript } = await import("../module/apps/neuroshima-script-engine.js");
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

test("rollTest addAnnotation writes to current result", async () => {
  const instance = new SkillTest({
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15] },
    context: { isDebug: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  const script = new NeuroshimaScript({}, null);
  script._currentArgs = { test: instance, eventContext: { phase: "result" } };
  assert.equal(script.addAnnotation("Current result"), true);
  assert.deepEqual(instance.result.annotations, ["Current result"]);
  assert.equal(instance.preData.annotations.includes("Current result"), false);
});

test("replaceTestDie recalculates success and modifiedResults", async () => {
  const instance = new SkillTest({
    preData: { stat: 5, skill: 0, fixedDice: [18, 19, 20] },
    context: { isDebug: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  const script = new NeuroshimaScript({}, null);
  assert.equal(script.replaceTestDie({ test: instance }, 0, 1), true);
  assert.equal(instance.context.dirty, true);
  await instance.recalculate();
  assert.equal(instance.result.modifiedResults[0].original, 1);
});

test("copyTestDie marks test dirty", async () => {
  const instance = new SkillTest({
    preData: { stat: 10, skill: 0, fixedDice: [1, 12, 18] },
    context: { isDebug: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  instance.context.dirty = false;
  const script = new NeuroshimaScript({}, null);
  assert.equal(script.copyTestDie({ test: instance }, 0, 2), true);
  assert.equal(instance.result.rawResults[2], 1);
  assert.equal(instance.context.dirty, true);
});

test("preRoll modifiers do not stack across rerolls", async () => {
  const instance = new SkillTest({
    preData: { stat: 10, skill: 0, fixedDice: [2, 8, 15] }
  }, actorFixture());
  instance.sendToChat = async () => null;
  instance.runTrigger = async trigger => {
    if (trigger === "preRollTest") instance.preData.attributeBonus =
      Number(instance.preData.attributeBonus ?? 0) + 2;
  };
  await instance.roll({ sendToChat: false });
  assert.equal(instance.result.attributeBonus, 2);
  dice = [3, 9, 16];
  await instance.reroll();
  assert.equal(instance.result.attributeBonus, 2);
});

test("partial reroll sets reroll=true and edited=false", async () => {
  const instance = new SkillTest({
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15] },
    context: { isDebug: true }
  }, actorFixture());
  instance.sendToChat = async () => null;
  await instance.roll({ sendToChat: false });
  dice = [7];
  await instance.rerollDice([1]);
  assert.equal(instance.context.reroll, true);
  assert.equal(instance.context.edited, false);
  assert.deepEqual(instance.result.rawResults, [2, 7, 15]);
});

test("full reroll clears previous diceChanges", async () => {
  const instance = new SkillTest({
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15] },
    context: { isDebug: true }
  }, actorFixture());
  instance.sendToChat = async () => null;
  await instance.roll({ sendToChat: false });
  instance.replaceDie(0, 1, { label: "Effect" });
  assert.equal(instance.result.diceChanges.length, 1);
  dice = [4, 5, 6];
  await instance.reroll();
  assert.deepEqual(instance.result.diceChanges ?? [], []);
});

function rangedFixture({ threshold = 10 } = {}) {
  const actor = actorFixture();
  const weapon = {
    id: "rifle",
    uuid: "Actor.actor.Item.rifle",
    name: "Rifle",
    system: {
      weaponType: "ranged",
      skipMagazineCheck: true,
      fireRate: 1,
      damage: "L",
      piercing: 0,
      jamming: threshold
    },
    async update() {}
  };
  const instance = new RangedWeaponTest({
    item: weapon,
    preData: {
      stat: 20,
      skill: 0,
      diceCount: 1,
      fixedDice: [15],
      bulletsFired: 1,
      penalties: {
        base: 0, mod: 1, weapon: 2, movingShooter: 3, movingTarget: 4
      }
    },
    context: { isDebug: true }
  }, actor);
  instance.sendToChat = async () => null;
  return instance;
}

test("jamming threshold helper changes final jam state", async () => {
  const instance = rangedFixture({ threshold: 20 });
  const script = new NeuroshimaScript({}, null);
  assert.equal(script.modifyJammingThreshold({ test: instance }, -10), true);
  instance.context.basePreData = deepClone(instance.preData);
  await instance.roll({ sendToChat: false });
  assert.equal(instance.result.isJamming, true);
  assert.equal(instance.result.jammingThreshold, 10);
});

test("allowShotDespiteJam rebuilds hitBulletsData", async () => {
  const instance = rangedFixture();
  await instance.roll({ sendToChat: false });
  assert.equal(instance.result.isJamming, true);
  assert.equal(instance.result.hitBullets, 0);
  const script = new NeuroshimaScript({}, null);
  assert.equal(script.allowShotDespiteJam({ test: instance }, 1), true);
  await instance.recalculate();
  assert.equal(instance.result.firedDespiteJam, true);
  assert.equal(instance.result.hitBullets, 1);
});

test("clearWeaponJam restores normal shot", async () => {
  const instance = rangedFixture();
  await instance.roll({ sendToChat: false });
  const script = new NeuroshimaScript({}, null);
  assert.equal(script.clearWeaponJam({ test: instance }), true);
  await instance.recalculate();
  assert.equal(instance.result.isJamming, false);
  assert.equal(instance.result.hitBullets, 1);
});

test("weapon penalty breakdown includes weapon and movement keys", async () => {
  const instance = rangedFixture();
  await instance.roll({ sendToChat: false });
  assert.equal(instance.result.penalties.weapon, 2);
  assert.equal(instance.result.penalties.movingShooter, 3);
  assert.equal(instance.result.penalties.movingTarget, 4);
});

test("tooltip is compact and keeps the threshold after domain sections", async () => {
  const instance = rangedFixture({ threshold: 20 });
  await instance.roll({ sendToChat: false });
  instance.replaceDie(0, 14, { label: "<Effect & Test>" });
  await instance.recalculate();
  const tooltip = instance.getDataTooltip();
  assert.match(tooltip, /Tooltip\.Target/);
  assert.match(tooltip, /Tooltip\.Weapon/);
  assert.match(tooltip, /class="ns-roll-tooltip"/);
  assert.match(tooltip, /ns-roll-tooltip__section-number">01/);
  assert.match(tooltip, /is-emphasized/);
  assert.match(tooltip, /is-subrow/);
  assert.doesNotMatch(tooltip, /Tooltip\.(?:Die|FinalAttribute|FinalSkill|FinalDifficulty|DifficultyShift)/);
  assert.equal((tooltip.match(/Tooltip\.BaseDifficulty/g) ?? []).length, 1);
  assert.ok(tooltip.lastIndexOf("Tooltip.Target") > tooltip.lastIndexOf("Tooltip.WeaponSection"));

  const escaped = instance.constructor.renderTooltipSections([{
    title: "<Title>",
    rows: [{ label: "<Label>", value: "<Effect & Test>" }]
  }]);
  assert.match(escaped, /&lt;Title&gt;/);
  assert.match(escaped, /&lt;Effect &amp; Test&gt;/);
  assert.doesNotMatch(escaped, /&amp;lt;/);
});

test("getChatData exposes isReroll and isEdited", async () => {
  const instance = new SkillTest({ context: { reroll: true, edited: false } });
  const data = await instance.getChatData();
  assert.equal(data.isReroll, true);
  assert.equal(data.isEdited, false);
});

test("healing edit uses messageType healing", () => {
  assert.equal(new HealingTest().messageType, "healing");
});

test("percentile edit menu is disabled until dedicated editor exists", () => {
  assert.equal(PercentileTest.editableByGM, false);
  assert.equal(PercentileTest.dieSides, 100);
});
