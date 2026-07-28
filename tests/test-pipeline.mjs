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
globalThis.ChatMessage = class {
  static getSpeaker({ actor } = {}) {
    return { actor: actor?.id ?? null };
  }
};
globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
globalThis.game = {
  neuroshima: {
    group() {},
    groupEnd() {},
    log() {},
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
  user: { id: "user", role: 4, isGM: true }
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
  GrenadeTest,
  AttackTest,
  RangedWeaponTest,
  MeleeWeaponTest
} = await import("../module/tests.mjs");
const {
  NeuroshimaScript,
  NeuroshimaScriptRunner
} = await import("../module/apps/neuroshima-script-engine.js");
const { CombatHelper } = await import("../module/helpers/combat-helper.js");
const {
  buildBreakdownTooltip,
  canViewRollTooltip,
  collectAttributeEffectSources,
  collectSkillEffectSources
} = await import("../module/helpers/tooltip-renderer.js");
const { NeuroshimaChatMessage } = await import("../module/documents/chat-message.js");
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

test("sendToChat false does not create a chat card", async () => {
  const instance = new SkillTest({
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15] },
    context: { isDebug: true }
  }, actorFixture());
  let cards = 0;
  instance.sendToChat = async () => { cards += 1; };
  await instance.roll({ sendToChat: false });
  assert.equal(cards, 0);
});

test("weapon damage dispatches actors instead of treating ChatMessage as an actor", async () => {
  const actor = actorFixture();
  const rollResult = {
    isWeapon: true,
    isSuccess: true,
    isMelee: false,
    damage: "C",
    piercing: 1,
    hitBulletsData: [{ damage: "C", piercing: 1, successPoints: 1 }]
  };
  const message = {
    id: "message",
    getFlag(_scope, key) {
      if (key === "test") return { result: rollResult };
      return undefined;
    }
  };
  const calls = [];
  const originalApplyDamageToActor = CombatHelper.applyDamageToActor;
  CombatHelper.applyDamageToActor = async (...args) => calls.push(args);
  try {
    await CombatHelper.applyWeaponDamage(message, [actor]);
  } finally {
    CombatHelper.applyDamageToActor = originalApplyDamageToActor;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], actor);
  assert.equal(calls[0][1], rollResult);
  assert.equal(calls[0][2].attackerMessageId, "message");
});

test("pre-roll API changes survive first roll", async () => {
  const instance = new SkillTest({
    preData: { stat: 1, skill: 0, fixedDice: [18, 19, 20] },
    context: { isDebug: true }
  }, actorFixture());
  instance.forceSuccess({ mode: "keepRoll" });
  await instance.roll({ sendToChat: false });
  assert.equal(instance.result.success, true);
  assert.equal(instance.context.basePreData.resultModifiers.forcedSuccess, true);
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
  assert.deepEqual(instance.result.diceChanges, [{
    type: "reroll",
    targetIndex: 1,
    sourceIndex: null,
    oldValue: 8,
    newValue: 7,
    label: "NEUROSHIMA.Roll.Reroll",
    icon: "fas fa-arrow-rotate-left",
    effectUuid: null
  }]);
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

test("domain tooltips expose weapon, healing, grenade and percentile details", () => {
  const weapon = new RangedWeaponTest({
    result: {
      weaponType: "ranged",
      burstLevel: 2,
      bulletsFired: 9,
      hitBullets: 3,
      damage: "C",
      piercing: 1,
      jammingThreshold: 18,
      wouldSucceed: true,
      isJamming: false
    }
  });
  const weaponTooltip = weapon.getDataTooltip();
  for (const key of [
    "WeaponType", "BurstLevel", "HitBullets", "Damage",
    "Piercing", "JammingThreshold", "WouldSucceed"
  ]) assert.match(weaponTooltip, new RegExp(`Tooltip\\.${key}`));

  const healing = new HealingTest({
    patient: { name: "Patient" },
    preData: { healingMethod: "firstAid" },
    result: {
      woundName: "Wound",
      damageType: "C",
      healingEffect: {
        oldPenalty: 10,
        newPenalty: 0,
        penaltyChange: -10,
        wasFullyHealed: true
      }
    }
  });
  const healingTooltip = healing.getDataTooltip();
  for (const key of [
    "Patient", "HealingMethod", "DamageType", "OldPenalty",
    "NewPenalty", "PenaltyChange", "FullyHealed"
  ]) assert.match(healingTooltip, new RegExp(`Tooltip\\.${key}`));

  const grenade = new GrenadeTest({
    result: {
      distance: 20,
      distancePenalty: 10,
      failureMargin: 2,
      deviationMetres: 4,
      templateRadius: 6
    }
  });
  const grenadeTooltip = grenade.getDataTooltip();
  for (const key of [
    "DistancePenalty", "FailureMargin", "Deviation", "TemplateRadius"
  ]) assert.match(grenadeTooltip, new RegExp(`Tooltip\\.${key}`));

  const percentile = new PercentileTest({
    result: { success: true, successPoints: 25, target: 60 }
  });
  const percentileTooltip = percentile.getDataTooltip();
  assert.match(percentileTooltip, /Tooltip\.Result/);
  assert.match(percentileTooltip, /Tooltip\.Margin/);
  assert.match(percentileTooltip, /Roll\.SuccessPoints/);
});

test("pain resistance tooltip includes wound context and consequence", () => {
  const pain = new SkillTest({
    preData: { label: "Pain", stat: 12, skill: 3 },
    result: {
      success: false,
      woundName: "<Severe & painful>",
      damageType: "C",
      painPenalty: 40,
      target: 10
    },
    context: {
      rollType: "painResistance",
      eventArgs: { location: "head", damageType: "C" }
    }
  }, actorFixture());
  const tooltip = pain.getDataTooltip();
  assert.match(tooltip, /Tooltip\.PainResistanceSection/);
  assert.match(tooltip, /Tooltip\.PainPenalty/);
  assert.match(tooltip, /NEUROSHIMA\.Location\.Head/);
  assert.match(tooltip, /&lt;Severe &amp; painful&gt;/);
  assert.doesNotMatch(tooltip, /<Severe/);
});

test("shared breakdown tooltip escapes effect names and emphasizes total", () => {
  const tooltip = buildBreakdownTooltip({
    title: "Attribute",
    baseValue: 10,
    sources: [{ label: "<Active & Effect>", value: 2 }],
    totalValue: 12
  });
  assert.match(tooltip, /class="ns-roll-tooltip"/);
  assert.match(tooltip, /&lt;Active &amp; Effect&gt;/);
  assert.match(tooltip, /is-subrow/);
  assert.match(tooltip, /is-bonus/);
  assert.match(tooltip, /is-emphasized/);
  assert.doesNotMatch(tooltip, /<Active/);
});

test("attribute tooltip sources follow Foundry appliedEffects", () => {
  const actor = {
    appliedEffects: new Set([
      {
        uuid: "Actor.actor.ActiveEffect.direct",
        name: "Direct bonus",
        changes: [{
          key: "system.attributeBonuses.dexterity",
          value: "2",
          mode: 2
        }]
      },
      {
        uuid: "Actor.actor.Item.trait.ActiveEffect.transferred",
        name: "Transferred trait",
        changes: [{
          key: "system.attributes.dexterity",
          value: "1",
          mode: 2
        }]
      },
      {
        uuid: "Actor.actor.ActiveEffect.total",
        name: "Computed total change",
        changes: [{
          key: "system.attributeTotals.dexterity",
          value: "3",
          mode: 2
        }]
      }
    ]),
    effects: [],
    items: []
  };

  const sources = collectAttributeEffectSources(actor, ["dexterity"]);
  assert.deepEqual(
    sources.dexterity.map(source => [source.label, source.value]),
    [
      ["Direct bonus", 2],
      ["Transferred trait", 1],
      ["Computed total change", 3]
    ]
  );
});

test("skill tooltip sources include applicable transferred effects", () => {
  const transferred = {
    uuid: "Actor.actor.Item.trait.ActiveEffect.skill",
    name: "Training implant",
    changes: [{
      key: "system.skills.pistols.value",
      value: "2",
      mode: 2
    }, {
      key: "system.skillBonuses.rifles",
      value: "1",
      mode: 2
    }]
  };
  const actor = {
    allApplicableEffects: function* () {
      yield transferred;
    },
    appliedEffects: new Set(),
    effects: [],
    items: []
  };

  const sources = collectSkillEffectSources(actor, ["pistols", "rifles"]);
  assert.deepEqual(sources.pistols.map(source => source.label), ["Training implant"]);
  assert.equal(sources.pistols[0].value, 2);
  assert.equal(sources.rifles[0].value, 1);
});

test("tooltip permission recognizes direct pain and aggregate grenade actors", () => {
  const actors = new Map([
    ["owned", { isOwner: true }],
    ["other", { isOwner: false }]
  ]);
  const player = { role: 1, isGM: false };
  const settings = {
    user: player,
    actors,
    minRole: 4,
    ownerVisibility: true
  };

  assert.equal(canViewRollTooltip({
    ...settings,
    message: { flags: { neuroshima: { actorId: "owned" } } }
  }), true);
  assert.equal(canViewRollTooltip({
    ...settings,
    message: {
      flags: {
        neuroshima: {
          actorDamages: [{ actorId: "other" }, { actorId: "owned" }]
        }
      }
    }
  }), true);
  assert.equal(canViewRollTooltip({
    ...settings,
    message: { flags: { neuroshima: { actorId: "other" } } }
  }), false);
});

test("pain report normalization covers critical and armor-reduced grenade rows", () => {
  const { results, reducedDetails } = NeuroshimaChatMessage._preparePainTooltipData(
    [{
      name: "Critical wound",
      damageType: "K",
      location: "head",
      isCritical: true,
      isPassed: false,
      penalty: 160
    }],
    [{
      fullName: "Stopped fragment",
      location: "torso",
      totalArmor: 4,
      piercing: 1
    }]
  );

  assert.match(results[0].tooltipHtml, /Tooltip\.PainResistanceSection/);
  assert.match(results[0].tooltipHtml, /NEUROSHIMA\.Location\.Head/);
  assert.match(results[0].tooltipHtml, /Tooltip\.Consequence/);
  assert.match(reducedDetails[0].tooltipHtml, /Tooltip\.ArmorReductionSection/);
  assert.match(reducedDetails[0].tooltipHtml, /Tooltip\.DamageNegated/);
});

test("healing batch exposes compact and per-wound tooltips with serialized primary test", async () => {
  let renderedContext = null;
  let createdData = null;
  let updatedData = null;
  const originalRender = NeuroshimaChatMessage._renderTemplate;
  const originalCreate = NeuroshimaChatMessage.create;
  NeuroshimaChatMessage._renderTemplate = async (_template, context) => {
    renderedContext = context;
    return "<div>healing</div>";
  };
  NeuroshimaChatMessage.create = async data => {
    createdData = data;
    return data;
  };

  const makeTest = (woundId, isSuccess) => ({
    result: {
      woundId,
      woundName: `Wound ${woundId}`,
      damageType: "C",
      isSuccess,
      healingEffect: { penaltyChange: isSuccess ? -10 : 0 }
    },
    context: {},
    getDataTooltip: () => `<div class="ns-roll-tooltip">${woundId}</div>`,
    canShowTooltip: () => true,
    toData: () => ({
      result: { woundId, isSuccess },
      context: {}
    })
  });

  try {
    const medic = { id: "medic", uuid: "Actor.medic", name: "Medic" };
    const patient = { id: "patient", uuid: "Actor.patient", name: "Patient" };
    const batch = [makeTest("one", true), makeTest("two", false)];
    await NeuroshimaChatMessage.renderHealingBatchTests(
      medic,
      patient,
      batch,
      "firstAid"
    );
    await NeuroshimaChatMessage.renderHealingBatchTests(
      { id: "medic", uuid: "Actor.medic", name: "Medic" },
      { id: "patient", uuid: "Actor.patient", name: "Patient" },
      batch,
      "firstAid",
      {},
      {
        message: {
          update: async data => {
            updatedData = data;
          }
        }
      }
    );
  } finally {
    NeuroshimaChatMessage._renderTemplate = originalRender;
    NeuroshimaChatMessage.create = originalCreate;
  }

  assert.equal(renderedContext.results[0].tooltipHtml.includes("one"), true);
  assert.match(renderedContext.dataTooltip, /Tooltip\.HealingBatchSection/);
  assert.equal(createdData.flags.neuroshima.test.context.batchTests.length, 2);
  assert.equal(createdData.flags.neuroshima.test.result.woundId, "one");
  assert.equal(updatedData["flags.neuroshima.test"].context.batchTests.length, 2);
});

test("healing request renders without requiring a batch test list", async () => {
  const originalRender = NeuroshimaChatMessage._renderTemplate;
  const originalCreate = NeuroshimaChatMessage.create;
  const originalGeneratePatientCard = CombatHelper.generatePatientCard;
  const originalGameCombatHelper = game.neuroshima.CombatHelper;
  const originalUsers = game.users;
  NeuroshimaChatMessage._renderTemplate = async () => "<div>request</div>";
  NeuroshimaChatMessage.create = async data => data;
  CombatHelper.generatePatientCard = () => ({ locations: [] });
  game.neuroshima.CombatHelper = CombatHelper;
  game.users = {
    get: id => ({ id, name: "Requester" }),
    filter: () => []
  };

  let created;
  try {
    created = await NeuroshimaChatMessage.renderHealingRequest(
      { id: "patient", uuid: "Actor.patient", name: "Patient" },
      null,
      "requester"
    );
  } finally {
    NeuroshimaChatMessage._renderTemplate = originalRender;
    NeuroshimaChatMessage.create = originalCreate;
    CombatHelper.generatePatientCard = originalGeneratePatientCard;
    game.neuroshima.CombatHelper = originalGameCombatHelper;
    game.users = originalUsers;
  }

  assert.equal(created.flags.neuroshima.messageType, "healingRequest");
  assert.equal(created.flags.neuroshima.patientUuid, "Actor.patient");
});

test("dice presentation exposes escaped old-to-new history", async () => {
  const instance = new SkillTest({
    preData: { stat: 5, skill: 0, fixedDice: [18, 19, 20] },
    context: { isDebug: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  instance.replaceDie(0, 1, { label: "<Effect & Test>", icon: "fas fa-wand-magic-sparkles" });
  await instance.recalculate();
  const data = await instance.getChatData();
  const die = data.modifiedResults[0];
  assert.equal(die.changed, true);
  assert.equal(die.rolledOriginal, 18);
  assert.equal(die.effectiveOriginal, 1);
  assert.equal(die.changeIcon, "fas fa-wand-magic-sparkles");
  assert.equal(die.showModified, false);
  assert.match(die.changeTooltip, /18 → 1/);
  assert.match(die.changeTooltip, /&lt;Effect &amp; Test&gt;/);
  assert.doesNotMatch(die.changeTooltip, /<Effect/);
});

test("GM edit updates its chat message exactly once", async () => {
  const instance = new SkillTest({
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15] },
    context: { isDebug: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  const message = { id: "message" };
  const calls = [];
  instance.sendToChat = async options => {
    calls.push(options);
    return message;
  };
  await instance.edit({ rawResults: [1, 8, 15] }, { message });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, message);
  assert.equal(instance.result.diceChanges[0].oldValue, 2);
  assert.equal(instance.result.diceChanges[0].newValue, 1);
  assert.ok(instance.result.annotations.includes("NEUROSHIMA.Roll.Edited"));
});

test("burst shift permission is read from serialized test result", () => {
  assert.equal(RangedWeaponTest.canShiftBurst({ burstShiftGranted: true }, { isGM: false }), true);
  assert.equal(RangedWeaponTest.canShiftBurst({ burstShiftGranted: false }, { isGM: false }), false);
  assert.equal(RangedWeaponTest.canShiftBurst({}, { isGM: true }), true);
});

test("dialog script flags survive preview and submission state", async () => {
  const actor = {
    ...actorFixture(),
    name: "Tester",
    system: { combat: {} }
  };
  const flags = {};
  const script = {
    effect: { id: "effect", parent: null },
    label: "Flag script",
    code: "args.flags.marked = true;",
    targeter: false,
    isDialogScript: false,
    async evalHide(args) {
      assert.equal(args.flags, flags);
      return false;
    },
    async evalActivate(args) {
      assert.equal(args.flags, flags);
      return true;
    },
    async execute(args) {
      assert.equal(args.flags, flags);
      args.flags.marked = true;
      args.fields.modifier = 5;
    }
  };
  const originalGetScripts = NeuroshimaScriptRunner.getScripts;
  NeuroshimaScriptRunner.getScripts = (_actor, trigger) => trigger === "dialog" ? [script] : [];
  try {
    const result = await NeuroshimaScriptRunner.computeDialogFields(
      actor,
      { rollType: "skill", scriptFlags: flags },
      new Set(),
      new Set(),
      [],
      { scriptFlags: flags }
    );
    assert.equal(result.scriptFields.modifier, 5);
    assert.equal(flags.marked, true);
  } finally {
    NeuroshimaScriptRunner.getScripts = originalGetScripts;
  }
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
