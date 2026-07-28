import test from "node:test";
import assert from "node:assert/strict";

Math.clamp ??= (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const deepClone = value => structuredClone(value ?? {});
const settingOverrides = {};
globalThis.foundry = {
  applications: {
    handlebars: {
      async renderTemplate(_path, context) {
        return JSON.stringify(context ?? {});
      }
    },
    sidebar: {
      tabs: {
        CombatTracker: class {
          static DEFAULT_OPTIONS = {};
        }
      }
    },
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: Base => class extends Base {}
    }
  },
  canvas: {
    placeables: {
      tokens: {
        TokenRuler: class {
          static DEFAULT_OPTIONS = {};
        }
      }
    }
  },
  utils: {
    deepClone,
    randomID: () => `revision-${Math.random().toString(36).slice(2)}`,
    escapeHTML: value => String(value),
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
  static applyRollMode() {}
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
    get: (_scope, key) => key in settingOverrides ? settingOverrides[key] : ({
      rollTooltipMinRole: 0,
      rollTooltipOwnerVisibility: false,
      doubleSkillAction: false,
      fireCorrection: false
    })[key]
  },
  messages: new Map(),
  user: { id: "user", role: 4, isGM: true }
};
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
globalThis.fromUuidSync = uuid => documents.get(uuid) ?? null;

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
const { EffectActionRuntime } = await import("../module/effects/effect-action-runtime.js");
const {
  MeleeResolution,
  MeleeOpposedChat,
  MeleeStore,
  MeleeTurnService
} = await import("../module/combat/combat.js");
const { MeleeOpposedResolver } = await import("../module/tests.mjs");
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
  assert.deepEqual(events, [
    "preRollTest",
    "preRollWeaponTest",
    "afterRollDice",
    "rollTest",
    "rollWeaponTest"
  ]);
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

function installMeleeEncounter({
  phase = "awaiting-pool-rolls",
  turn = 1,
  revision = "revision-1",
  usedDice = [],
  attackerSelectedDice = [],
  defenderSelectedDice = []
} = {}) {
  let encounters = {
    encounter: {
      id: "encounter",
      turnState: { turn, phase, selectionTurn: "participant" },
      currentExchange: {
        attackerId: "participant",
        defenderId: "opponent",
        attackerSelectedDice,
        defenderSelectedDice
      },
      participants: {
        participant: {
          id: "participant",
          actorUuid: "Actor.actor",
          pool: [2, 8, 15],
          modifiedPool: [2, 8, 15],
          dieResults: [],
          poolRevision: revision,
          poolMessageId: "message",
          usedDice
        },
        opponent: {
          id: "opponent",
          pool: [],
          usedDice: []
        }
      }
    }
  };
  game.combat = {
    getFlag: (_scope, key) => key === "meleeEncounters" ? encounters : null,
    async setFlag(_scope, key, value) {
      if (key === "meleeEncounters") encounters = value;
      return value;
    }
  };
  return () => encounters.encounter;
}

async function linkedTest(rawResults = [2, 8, 15], {
  revision = "revision-1",
  turn = 1,
  open = false
} = {}) {
  const instance = new SkillTest({
    preData: { stat: 10, skill: 0, fixedDice: rawResults, isOpen: open },
    context: {
      isDebug: true,
      isOpen: open,
      meleePoolLink: {
        encounterId: "encounter",
        participantId: "participant",
        turn,
        revision
      }
    }
  }, actorFixture());
  instance.sendToChat = async ({ message } = {}) => message ?? { id: "message" };
  await instance.roll({ sendToChat: false });
  return instance;
}

test("melee pool uses rawResults after rollTest replacement", async () => {
  const instance = await linkedTest([1, 14, 18]);
  instance.replaceDie(1, 1, { type: "effect" });
  await instance.recalculate();
  const participant = {};
  MeleeTurnService.applyPoolSnapshot(
    participant,
    MeleeTurnService.buildPoolSnapshot(instance)
  );
  assert.deepEqual(participant.pool, [1, 1, 18]);
  assert.deepEqual(participant.poolSnapshot.rolledResults, [1, 14, 18]);
});

test("result action synchronizes changed die to melee encounter", async () => {
  const getEncounter = installMeleeEncounter();
  const instance = await linkedTest();
  MeleeTurnService.applyPoolSnapshot(
    getEncounter().participants.participant,
    MeleeTurnService.buildPoolSnapshot(instance, { messageId: "message" })
  );
  instance.replaceDie(1, 1, { type: "amen" });
  const committed = await instance.commitMutation({ reason: "result-action:amen" });
  assert.equal(committed.ok, true);
  assert.deepEqual(getEncounter().participants.participant.pool, [2, 1, 15]);
  assert.equal(getEncounter().participants.participant.modifiedPool[1], 1);
  assert.equal(typeof getEncounter().participants.participant.dieResults[1].isSuccess, "boolean");
});

test("GM edit synchronizes melee pool", async () => {
  const getEncounter = installMeleeEncounter();
  const instance = await linkedTest();
  MeleeTurnService.applyPoolSnapshot(
    getEncounter().participants.participant,
    MeleeTurnService.buildPoolSnapshot(instance, { messageId: "message" })
  );
  await instance.edit(
    { rawResults: [1, 3, 19] },
    { message: { id: "message" } }
  );
  assert.deepEqual(getEncounter().participants.participant.pool, [1, 3, 19]);
});

test("partial reroll synchronizes melee pool", async () => {
  const getEncounter = installMeleeEncounter();
  const instance = await linkedTest();
  MeleeTurnService.applyPoolSnapshot(
    getEncounter().participants.participant,
    MeleeTurnService.buildPoolSnapshot(instance, { messageId: "message" })
  );
  dice = [4];
  await instance.rerollDice([1], { previousMessage: { id: "message" } });
  assert.deepEqual(getEncounter().participants.participant.pool, [2, 4, 15]);
});

test("melee pool mutation is rejected after die selection", async () => {
  installMeleeEncounter({ attackerSelectedDice: [0] });
  const instance = await linkedTest();
  assert.deepEqual(await instance.validateLinkedMutation(), {
    ok: false,
    reason: "dice-already-selected"
  });
});

test("melee pool mutation is rejected after die use", async () => {
  installMeleeEncounter({ usedDice: [0] });
  const instance = await linkedTest();
  assert.deepEqual(await instance.validateLinkedMutation(), {
    ok: false,
    reason: "dice-already-used"
  });
});

test("stale melee roll card cannot modify new turn pool", async () => {
  installMeleeEncounter({ turn: 2 });
  const instance = await linkedTest([2, 8, 15], { turn: 1 });
  assert.equal((await instance.validateLinkedMutation()).reason, "stale-turn");
});

test("old pool revision cannot overwrite newer roll", async () => {
  installMeleeEncounter({ revision: "revision-2" });
  const instance = await linkedTest([2, 8, 15], { revision: "revision-1" });
  assert.equal((await instance.validateLinkedMutation()).reason, "stale-revision");
});

test("replaced die value 1 is not natural one", async () => {
  const instance = new SkillTest({
    preData: { stat: 10, skill: 0, fixedDice: [14, 18, 19] },
    context: { isDebug: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  instance.replaceDie(0, 1, { type: "amen" });
  await instance.recalculate();
  assert.equal(instance.result.modifiedResults[0].isNat1, false);
  assert.deepEqual(instance.result.rolledResults, [14, 18, 19]);
});

test("GM edited one can count as natural result", async () => {
  const instance = new SkillTest({
    preData: { stat: 10, skill: 0, fixedDice: [14, 18, 19] },
    context: { isDebug: true }
  }, actorFixture());
  instance.sendToChat = async () => null;
  await instance.roll({ sendToChat: false });
  await instance.edit({ rawResults: [1, 18, 19] });
  assert.equal(instance.result.modifiedResults[0].isNat1, true);
  assert.equal(instance.result.rolledResults[0], 1);
});

test("addSuccesses reconciles closed test success", async () => {
  const instance = new SkillTest({
    preData: { stat: 1, skill: 0, fixedDice: [10, 11, 12] },
    context: { isDebug: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  instance.addSuccesses(2);
  await instance.recalculate();
  assert.equal(instance.result.success, true);
  assert.equal(instance.result.isSuccess, true);
});

test("addSuccesses updates open test result", async () => {
  const instance = new SkillTest({
    preData: { stat: 1, skill: 0, fixedDice: [10, 11], isOpen: true },
    context: { isDebug: true, isOpen: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  instance.addSuccesses(1);
  await instance.recalculate();
  assert.equal(instance.result.success, true);
});

test("used result action stays used after card rerender", async () => {
  const instance = await linkedTest();
  instance.context.usedResultActions = ["effect::action::meleePool"];
  const originalCollect = EffectActionRuntime.collect;
  const originalRender = NeuroshimaChatMessage._renderTemplate;
  const originalCreate = NeuroshimaChatMessage.create;
  EffectActionRuntime.collect = async () => [{
    instanceId: "effect::action::meleePool",
    used: false
  }];
  NeuroshimaChatMessage._renderTemplate = async () => "<div></div>";
  NeuroshimaChatMessage.create = async data => data;
  try {
    await NeuroshimaChatMessage.renderTest(instance);
    assert.equal(instance.result.effectActions[0].used, true);
  } finally {
    EffectActionRuntime.collect = originalCollect;
    NeuroshimaChatMessage._renderTemplate = originalRender;
    NeuroshimaChatMessage.create = originalCreate;
  }
});

test("result action resource is consumed only once", async () => {
  const actor = actorFixture();
  actor.documentName = "Actor";
  actor.resource = 0;
  documents.set(actor.uuid, actor);
  const effect = {
    uuid: "ActiveEffect.amen",
    name: "Amen",
    parent: actor,
    disabled: false,
    isSuppressed: false,
    system: {
      actionDefs: [{
        id: "amen",
        type: "result",
        name: "Amen",
        executeScript: "args.actor.resource += 1;"
      }]
    }
  };
  documents.set(effect.uuid, effect);
  const instance = new SkillTest({
    preData: { stat: 10, skill: 0, fixedDice: [2, 8, 15] },
    result: {
      effectActions: [{
        instanceId: "ActiveEffect.amen::amen::testResult",
        sourceEffectUuid: effect.uuid,
        actionId: "amen",
        surface: "testResult",
        used: false
      }]
    },
    context: { isDebug: true }
  }, actor);
  await instance.roll({ sendToChat: false });
  instance.result.effectActions = [{
    instanceId: "ActiveEffect.amen::amen::testResult",
    sourceEffectUuid: effect.uuid,
    actionId: "amen",
    surface: "testResult",
    used: false
  }];
  const serialized = instance.toData();
  let stored = deepClone(serialized);
  const message = {
    id: "action-message",
    author: { id: game.user.id },
    getFlag(_scope, key) {
      if (key === "test") return stored;
      return null;
    },
    async update(data) {
      stored = deepClone(data["flags.neuroshima.test"]);
    }
  };
  const originalSocket = game.neuroshima.socket;
  const originalRender = NeuroshimaChatMessage._renderTemplate;
  let claimed = false;
  game.neuroshima.socket = {
    async executeAsGM(action) {
      if (action === "claimResultAction") {
        if (claimed) return { ok: false, reason: "in-flight" };
        claimed = true;
        return { ok: true };
      }
      if (action === "releaseResultAction") {
        claimed = false;
        return true;
      }
      return null;
    }
  };
  NeuroshimaChatMessage._renderTemplate = async () => "<div></div>";
  try {
    await Promise.all([
      EffectActionRuntime.execute(message, "ActiveEffect.amen::amen::testResult"),
      EffectActionRuntime.execute(message, "ActiveEffect.amen::amen::testResult")
    ]);
  } finally {
    game.neuroshima.socket = originalSocket;
    NeuroshimaChatMessage._renderTemplate = originalRender;
  }
  assert.equal(actor.resource, 1);
});

test("non-GM melee synchronization is delegated to the authoritative client", async () => {
  const instance = await linkedTest();
  const originalIsGM = game.user.isGM;
  const originalSocket = game.neuroshima.socket;
  let payload = null;
  game.user.isGM = false;
  game.neuroshima.socket = {
    async executeAsGM(action, data) {
      assert.equal(action, "syncMeleePoolSnapshot");
      payload = data;
      return { ok: true, snapshot: data.snapshot };
    }
  };
  try {
    const result = await MeleeTurnService.syncPoolFromTest(instance, {
      reason: "multi-client-test"
    });
    assert.equal(result.ok, true);
  } finally {
    game.user.isGM = originalIsGM;
    game.neuroshima.socket = originalSocket;
  }
  assert.equal(payload.link.revision, "revision-1");
  assert.equal(payload.reason, "multi-client-test");
  assert.deepEqual(payload.snapshot.rawResults, [2, 8, 15]);
});

for (const doubleSkillAction of [false, true]) {
  test(`melee pool snapshot supports doubleSkillAction = ${doubleSkillAction}`, async () => {
    settingOverrides.doubleSkillAction = doubleSkillAction;
    try {
      const actor = {
        ...actorFixture(),
        system: {
          attributeTotals: { dexterity: 10 },
          skills: { melee: { value: 4 } },
          combat: {}
        }
      };
      const weapon = {
        id: "melee",
        uuid: "Actor.actor.Item.melee",
        name: "Knife",
        system: {
          weaponType: "melee",
          attribute: "dexterity",
          skill: "melee",
          attackBonus: 0,
          defenseBonus: 0,
          damageMelee1: "D",
          damageMelee2: "L",
          damageMelee3: "C",
          piercing: 0
        }
      };
      const instance = new MeleeWeaponTest({
        item: weapon,
        preData: { stat: 10, skill: 4, fixedDice: [2, 12, 19] },
        context: { isDebug: true, isMelee: true, meleeAction: "attack" }
      }, actor);
      await instance.roll({ sendToChat: false });
      const snapshot = MeleeTurnService.buildPoolSnapshot(instance);
      assert.deepEqual(snapshot.rawResults, [2, 12, 19]);
      assert.equal(snapshot.modifiedResults.length, 3);
      assert.equal(snapshot.modifiedResults[0].isSuccess, true);
      const participant = {
        pool: [...snapshot.rawResults],
        poolSnapshot: snapshot,
        modifiedPool: snapshot.modifiedResults.map(die => die.modified),
        dieResults: snapshot.modifiedResults,
        selfReductions: [0, 5, 0],
        opponentGains: [0, 0, 0]
      };
      if (doubleSkillAction) {
        assert.equal(MeleeResolution._getEffectiveDieVal(participant, 1), 7);
        assert.equal(MeleeResolution._isDieSuccess(participant, 1, 10), true);
      } else {
        assert.equal(
          MeleeResolution._getEffectiveDieVal(participant, 1),
          snapshot.modifiedResults[1].modified
        );
        assert.equal(
          MeleeResolution._isDieSuccess(participant, 1, 10),
          snapshot.modifiedResults[1].isSuccess
        );
      }
    } finally {
      delete settingOverrides.doubleSkillAction;
    }
  });
}

function opposedMessage(id, opposed, extra = {}) {
  const flags = {
    opposedChat: deepClone(opposed),
    ...deepClone(extra)
  };
  return {
    id,
    content: "",
    getFlag(_scope, key) {
      return flags[key] ?? null;
    },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "content") this.content = value;
        else if (key.startsWith("flags.neuroshima.")) {
          flags[key.slice("flags.neuroshima.".length)] = deepClone(value);
        }
      }
      return this;
    }
  };
}

test("attacker roll creates one persistent opposed message", async () => {
  const attacker = {
    ...actorFixture(),
    name: "Atakujący",
    token: null,
    async getFlag() { return false; },
    async unsetFlag() {}
  };
  const defender = {
    ...actorFixture(),
    uuid: "Actor.defender",
    name: "Obrońca",
    items: []
  };
  documents.set(defender.uuid, defender);
  const weapon = {
    id: "sword",
    name: "Miecz",
    system: { damageMelee1: "D", damageMelee2: "L", damageMelee3: "C" }
  };
  const sourceMessage = { id: "attack-test" };
  let sourceUpdates = 0;
  const attackerTest = {
    message: sourceMessage,
    context: {},
    preData: { skill: 3 },
    result: { modifiedResults: [], successCount: 1, target: 10 },
    async updateMessage(message) { sourceUpdates++; return message; }
  };
  const handler = opposedMessage("duel-one", {});
  const originalCreate = ChatMessage.create;
  const originalCancel = MeleeOpposedChat._cancelStalePendingsByAttacker;
  const originalRegister = MeleeOpposedChat._registerPendingOpposed;
  let creates = 0;
  ChatMessage.create = async () => { creates++; return handler; };
  MeleeOpposedChat._cancelStalePendingsByAttacker = async () => {};
  MeleeOpposedChat._registerPendingOpposed = async () => {};
  try {
    const result = await MeleeOpposedChat.createOpposedHandler({
      attacker, weapon, targetUuid: defender.uuid, mode: "opposedSuccesses", attackerTest
    });
    assert.equal(result, handler);
    assert.equal(creates, 1);
    assert.equal(sourceUpdates, 1);
    assert.equal(attackerTest.context.opposedLink.duelMessageId, handler.id);
  } finally {
    ChatMessage.create = originalCreate;
    MeleeOpposedChat._cancelStalePendingsByAttacker = originalCancel;
    MeleeOpposedChat._registerPendingOpposed = originalRegister;
  }
});

test("defender roll updates the existing opposed message", async () => {
  const data = {
    id: "opp", status: "awaitingDefender",
    attackerUuid: "Actor.attacker", defenderUuid: "Actor.defender"
  };
  const message = opposedMessage("duel", data);
  game.messages.set(message.id, message);
  const defenderTest = {
    message: { id: "defense-test" },
    context: { opposedLink: { revision: "def-rev" } },
    result: {},
    async updateMessage(message) { return message; }
  };
  const originalRefresh = MeleeOpposedChat.refreshOpposedMessage;
  const originalRemove = MeleeOpposedChat._removePending;
  const originalUnset = MeleeOpposedChat._unsetDefenderFlag;
  let refreshes = 0;
  MeleeOpposedChat.refreshOpposedMessage = async id => {
    refreshes++;
    assert.equal(id, message.id);
    return { ok: true, status: "duel" };
  };
  MeleeOpposedChat._removePending = async () => {};
  MeleeOpposedChat._unsetDefenderFlag = async () => {};
  try {
    await MeleeOpposedChat.attachDefenderTest(message.id, defenderTest);
    assert.equal(refreshes, 1);
    assert.equal(message.getFlag("neuroshima", "opposedChat").defenderTestMessageId, "defense-test");
  } finally {
    MeleeOpposedChat.refreshOpposedMessage = originalRefresh;
    MeleeOpposedChat._removePending = originalRemove;
    MeleeOpposedChat._unsetDefenderFlag = originalUnset;
    game.messages.delete(message.id);
  }
});

test("attacker edit before defender refreshes pending card", async () => {
  const message = opposedMessage("pending-duel", {
    id: "opp", status: "awaitingDefender", attackerTestMessageId: "attack"
  });
  game.messages.set(message.id, message);
  const originalGet = MeleeOpposedChat.getLinkedTest;
  const originalRender = MeleeOpposedChat.renderPendingFromTest;
  let rendered = 0;
  MeleeOpposedChat.getLinkedTest = async () => ({ result: {} });
  MeleeOpposedChat.renderPendingFromTest = async () => { rendered++; };
  try {
    const result = await MeleeOpposedChat._refreshOpposedMessage(message.id, {
      reason: "gm-edit", resetProgress: true
    });
    assert.equal(result.status, "awaitingDefender");
    assert.equal(rendered, 1);
  } finally {
    MeleeOpposedChat.getLinkedTest = originalGet;
    MeleeOpposedChat.renderPendingFromTest = originalRender;
    game.messages.delete(message.id);
  }
});

test("attacker edit after defender refreshes same duel message", async () => {
  const message = opposedMessage("same-duel", {
    id: "opp", status: "duel", attackerTestMessageId: "attack",
    defenderTestMessageId: "defense", mode: "opposedSuccesses"
  }, { duelCard: { status: "picking" } });
  game.messages.set(message.id, message);
  const originalGet = MeleeOpposedChat.getLinkedTest;
  const originalCreate = MeleeOpposedChat._createDuelCard;
  const fake = role => ({
    result: { target: 10, skill: 0 },
    preData: { skill: 0 },
    context: {},
    get opposedResult() {
      return { success: true, successes: role === "attack" ? 2 : 1, successPoints: 0, dice: [] };
    },
    async runTrigger() {}
  });
  MeleeOpposedChat.getLinkedTest = async id => fake(id);
  let sameMessage = null;
  MeleeOpposedChat._createDuelCard = async msg => { sameMessage = msg; };
  try {
    const result = await MeleeOpposedChat._refreshOpposedMessage(message.id, {
      reason: "gm-edit", resetProgress: true
    });
    assert.equal(result.status, "duel");
    assert.equal(sameMessage, message);
  } finally {
    MeleeOpposedChat.getLinkedTest = originalGet;
    MeleeOpposedChat._createDuelCard = originalCreate;
    game.messages.delete(message.id);
  }
});

test("defender edit refreshes same duel message", async () => {
  const message = opposedMessage("def-duel", {
    id: "opp", status: "duel", defenderTestMessageId: "old",
    defenderRevision: "rev"
  });
  game.messages.set(message.id, message);
  const originalRefresh = MeleeOpposedChat.refreshOpposedMessage;
  const originalGet = MeleeOpposedChat.getLinkedTest;
  let refreshed = null;
  MeleeOpposedChat.getLinkedTest = async () => ({
    actor: { testUserPermission: () => true },
    context: {
      opposedLink: {
        type: "meleeOpposed", opposedId: "opp", duelMessageId: message.id,
        role: "defender", revision: "rev"
      }
    }
  });
  const originalInternalRefresh = MeleeOpposedChat._refreshOpposedMessage;
  MeleeOpposedChat._refreshOpposedMessage = async id => {
    refreshed = id;
    return { ok: true };
  };
  try {
    await MeleeOpposedChat.syncOpposedTestState({
      duelMessageId: message.id, role: "defender",
      testMessageId: "def-test", revision: "rev", reason: "gm-edit"
    });
    assert.equal(refreshed, message.id);
    assert.equal(message.getFlag("neuroshima", "opposedChat").defenderTestMessageId, "def-test");
  } finally {
    MeleeOpposedChat.refreshOpposedMessage = originalRefresh;
    MeleeOpposedChat.getLinkedTest = originalGet;
    MeleeOpposedChat._refreshOpposedMessage = originalInternalRefresh;
    game.messages.delete(message.id);
  }
});

test("Amen replacement refreshes linked duel", async () => {
  const instance = new SkillTest({
    context: {
      opposedLink: {
        type: "meleeOpposed", opposedId: "opp", duelMessageId: "duel",
        role: "attacker", revision: "rev"
      }
    }
  }, actorFixture());
  const originalSync = MeleeOpposedChat.syncFromTest;
  let calls = 0;
  MeleeOpposedChat.syncFromTest = async () => { calls++; return { ok: true }; };
  try {
    assert.equal(instance.triggerArgs().links.opposed.opposedId, "opp");
    await instance.syncLinkedState({ reason: "result-action:amen" });
    assert.equal(calls, 1);
  } finally {
    MeleeOpposedChat.syncFromTest = originalSync;
  }
});

test("unresolved duel progress resets after source test edit", () => {
  const state = MeleeOpposedChat.resetDuelProgress({
    status: "picking",
    usedAttackDice: [0],
    usedDefenseDice: [1],
    hits: [{ tier: 1 }],
    currentSegment: 2,
    attackerUuid: "a",
    defenderUuid: "d",
    damage1: "D"
  }, {
    attackDice: [{ modified: 2 }],
    defenseDice: [{ modified: 3 }],
    attackTarget: 10,
    defenseTarget: 9
  });
  assert.deepEqual(state.usedAttackDice, []);
  assert.deepEqual(state.usedDefenseDice, []);
  assert.deepEqual(state.hits, []);
  assert.equal(state.currentSegment, 0);
  assert.equal(state.status, "picking");
  assert.equal(state.damage1, "D");
});

test("resolved duel rejects source test mutation", async () => {
  const message = opposedMessage("locked-duel", {
    id: "opp", status: "resolved", attackerRevision: "rev"
  }, { duelCard: { status: "done" } });
  game.messages.set(message.id, message);
  const instance = new SkillTest({
    context: {
      opposedLink: {
        opposedId: "opp", duelMessageId: message.id, role: "attacker", revision: "rev"
      }
    }
  }, actorFixture());
  try {
    assert.equal((await instance.validateOpposedMutation()).reason, "opposed-resolved");
  } finally {
    game.messages.delete(message.id);
  }
});

test("opposed preview does not run final side effects", async () => {
  const events = [];
  const fake = successes => ({
    context: {},
    opposedResult: { successes, successPoints: successes, dice: [] },
    async runTrigger(name, metadata) { events.push([name, metadata.preview]); }
  });
  const resolver = new MeleeOpposedResolver(fake(2), fake(1));
  await resolver.resolve({ preview: true });
  assert.deepEqual(events.map(([name]) => name), ["preOpposedAttacker", "preOpposedDefender"]);
  assert.ok(events.every(([, preview]) => preview === true));
});

test("opposed finalization runs result triggers once", async () => {
  const message = opposedMessage("final-duel", {
    id: "opp", status: "duel", mode: "opposedSuccesses",
    attackerTestMessageId: "a", defenderTestMessageId: "d",
    attackerRevision: "ar", defenderRevision: "dr"
  });
  const events = [];
  const fake = successes => ({
    context: {},
    opposedResult: { successes, successPoints: successes, dice: [] },
    async runTrigger(name) { events.push(name); }
  });
  const originalGet = MeleeOpposedChat.getLinkedTest;
  MeleeOpposedChat.getLinkedTest = async id => fake(id === "a" ? 2 : 1);
  try {
    await MeleeOpposedChat._runFinalOpposedTriggersOnce(message);
    await MeleeOpposedChat._runFinalOpposedTriggersOnce(message);
    assert.equal(events.filter(name => name === "opposedAttacker").length, 1);
    assert.equal(message.getFlag("neuroshima", "opposedChat").finalTriggersRun, true);
  } finally {
    MeleeOpposedChat.getLinkedTest = originalGet;
  }
});

test("simultaneous attacker and defender edits are serialized", async () => {
  const order = [];
  const first = MeleeOpposedChat._queueOpposedRefresh("queue-duel", async () => {
    order.push("first-start");
    await Promise.resolve();
    order.push("first-end");
  });
  const second = MeleeOpposedChat._queueOpposedRefresh("queue-duel", async () => {
    order.push("second");
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("linked reroll replaces the original test message", async () => {
  const instance = new SkillTest({
    preData: { stat: 10, skill: 0, fixedDice: [2, 8, 15] },
    context: {
      isDebug: true,
      opposedLink: {
        opposedId: "opp", duelMessageId: "duel", role: "attacker", revision: "rev"
      }
    }
  }, actorFixture());
  const originalMessage = { id: "source-test" };
  const targets = [];
  instance.message = originalMessage;
  instance.validateLinkedMutation = async () => ({ ok: true });
  instance.syncLinkedState = async () => ({ ok: true });
  instance.sendToChat = async ({ message }) => {
    targets.push(message);
    return message ?? { id: "new" };
  };
  await instance.reroll({ previousMessage: originalMessage, replaceMessage: false });
  assert.ok(targets.every(target => target === originalMessage));
});

test("Grad Ciosow reuses the handler message", async () => {
  const message = opposedMessage("hail-duel", {
    id: "opp", attackerTestMessageId: "a", defenderTestMessageId: "d"
  });
  const originalFinal = MeleeOpposedChat._runFinalOpposedTriggersOnce;
  const originalCreate = ChatMessage.create;
  let creates = 0;
  ChatMessage.create = async () => { creates++; };
  MeleeOpposedChat._runFinalOpposedTriggersOnce = async () => ({ ok: true });
  try {
    await MeleeOpposedChat._createDuelCard(
      message,
      {
        id: "opp", isGradCios: true,
        attackerUuid: "a", defenderUuid: "d",
        damage1: "D", damage2: "L", damage3: "C"
      },
      { name: "A" }, { name: "D" },
      [{ original: 2, modified: 2, isSuccess: true }],
      [{ original: 12, modified: 12, isSuccess: false }],
      10, 10
    );
    assert.equal(creates, 0);
    assert.ok(message.getFlag("neuroshima", "hailResult"));
  } finally {
    ChatMessage.create = originalCreate;
    MeleeOpposedChat._runFinalOpposedTriggersOnce = originalFinal;
  }
});

test("skill allocation reuses the handler message", async () => {
  const message = opposedMessage("allocation-duel", {
    id: "opp", status: "duel"
  });
  const originalCreate = ChatMessage.create;
  let creates = 0;
  ChatMessage.create = async () => { creates++; };
  try {
    await MeleeOpposedChat._createAllocationCard({
      handlerMessage: message,
      data: {
        id: "opp", mode: "opposedSuccesses",
        attackerUuid: "a", defenderUuid: "d",
        damage1: "D", damage2: "L", damage3: "C"
      },
      attackerActor: { name: "A" },
      defenderActor: { name: "D" },
      attackDice: [], defenseDice: [],
      attackTarget: 10, defenseTarget: 10,
      attackSuccesses: 0, defenseSuccesses: 0,
      attackerSkillBudget: 1, defenderSkillBudget: 0
    });
    assert.equal(creates, 0);
    assert.equal(message.getFlag("neuroshima", "opposedChat").status, "allocation");
    assert.ok(message.getFlag("neuroshima", "skillAlloc"));
  } finally {
    ChatMessage.create = originalCreate;
  }
});
