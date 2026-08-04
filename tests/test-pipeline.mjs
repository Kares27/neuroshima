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
      ApplicationV2: class {
        constructor(options = {}) { this.options = options; }
        render() { return this; }
        async close() { return this; }
      },
      HandlebarsApplicationMixin: Base => class extends Base {}
    },
    sheets: {
      ActorSheetV2: class {},
      ActiveEffectConfig: class {
        static DEFAULT_OPTIONS = {};
        static PARTS = {};
        static TABS = {};
      }
    }
  },
  abstract: {
    TypeDataModel: class {}
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
    getProperty(object, path) {
      return String(path).split(".").reduce((value, part) => value?.[part], object);
    },
    hasProperty(object, path) {
      return String(path).split(".").every((part, index, parts) => {
        object = object?.[part];
        return index === parts.length - 1 ? object !== undefined : object != null;
      });
    },
    setProperty(object, path, value) {
      const parts = String(path).split(".");
      let current = object;
      for (const part of parts.slice(0, -1)) current = current[part] ??= {};
      current[parts.at(-1)] = value;
      return true;
    },
    expandObject(object) {
      const expanded = {};
      for (const [path, value] of Object.entries(object ?? {})) {
        this.setProperty(expanded, path, value);
      }
      return expanded;
    },
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
globalThis.CONST = {
  CHAT_MESSAGE_STYLES: { OTHER: 0 },
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
  ACTIVE_EFFECT_MODES: {
    CUSTOM: 0,
    MULTIPLY: 1,
    ADD: 2,
    DOWNGRADE: 3,
    UPGRADE: 4,
    OVERRIDE: 5
  }
};
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
game.user.active = true;
game.user.name = "Gamemaster";
game.users = [game.user];
game.users.has = id => game.users.some(user => user.id === id);
game.users.get = id => game.users.find(user => user.id === id);
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
  AttributeTest,
  SkillTest,
  HealingTest,
  InitiativeTest,
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
const { NeuroshimaActiveEffect } = await import("../module/documents/active-effect.js");
const { CombatHelper } = await import("../module/helpers/combat-helper.js");
const {
  buildBreakdownTooltip,
  canViewRollTooltip,
  collectAttributeEffectSources,
  collectDocumentEffectSources,
  collectSkillEffectSources
} = await import("../module/helpers/tooltip-renderer.js");
const { NeuroshimaChatMessage } = await import("../module/documents/chat-message.js");
const { EffectActionRuntime } = await import("../module/effects/effect-action-runtime.js");
const {
  DEFAULT_CONDITIONS,
  getConditions,
  isDefeatedByDamage,
  isOverweightEncumbrance
} = await import("../module/apps/config/condition-config.js");
const {
  NeuroshimaActor,
  NeuroshimaConditionCheckContext
} = await import("../module/documents/actor.js");
const { NeuroshimaActorData } = await import("../module/data/actor-data.js");
const {
  NS_CHANGE_KEYS,
  isChangeGroupAvailable
} = await import("../module/sheets/neuroshima-effect-sheet.js");
const { ReputationRollDialog } = await import("../module/apps/dialogs/reputation-roll-dialog.js");
const { NeuroshimaRollDialogBase } = await import("../module/apps/dialogs/roll-dialog-base.js");
const { NeuroshimaSkillRollDialog } = await import("../module/apps/dialogs/skill-roll-dialog.js");
const { NeuroshimaRollTestRouter } = await import("../module/helpers/roll-test-router.js");
const { NeuroshimaSocket } = await import("../module/helpers/socket-helper.js");
const { syncMountedModEffects } = await import("../module/helpers/mod-helpers.js");
const {
  DEFAULT_EQUIPPABLE_GEAR_TYPES,
  isGearTypeEquippable,
  parseEquippableGearTypes
} = await import("../module/helpers/gear-types.js");
const { NeuroshimaBaseActorSheet } = await import("../module/sheets/actor-sheet-base.js");
const {
  crewMemberMatches,
  resolveCrewActor
} = await import("../module/helpers/vehicle-crew.js");
const {
  EFFECT_PENALTY_KEY,
  LEGACY_EFFECT_PENALTY_KEY,
  normalizeEffectPenaltyChanges
} = await import("../module/helpers/effect-penalty.js");
const {
  MeleeResolution,
  MeleeOpposedChat,
  MeleeStore,
  MeleeTurnService
} = await import("../module/combat/combat.js");
const { MeleeOpposedResolver } = await import("../module/tests.mjs");
const {
  REPUTATION_XP_COST,
  applyXpEntry,
  applyXpGrantEntry,
  applyXpSpentAdjustment,
  createReputationCostApi,
  getBaseReputationCost,
  normalizeReputationCost,
  revertXpEntry,
  showXpDialog,
  showXpSpentAdjustmentDialog
} = await import("../module/helpers/xp.js");
game.neuroshima.tests = NEUROSHIMA_TESTS;

test("gear subtype equipability defaults to clothing and supports world overrides", () => {
  assert.deepEqual(DEFAULT_EQUIPPABLE_GEAR_TYPES, { clothing: true });
  const configured = parseEquippableGearTypes(JSON.stringify({ clothing: false, tools: true }));
  assert.equal(isGearTypeEquippable("clothing", configured), false);
  assert.equal(isGearTypeEquippable("tools", configured), true);
  assert.equal(isGearTypeEquippable("misc", configured), false);
  assert.equal(isGearTypeEquippable("clothing", parseEquippableGearTypes("invalid")), true);
});

test("non-equippable gear cannot create Transfer on Equip actor mirrors", async () => {
  const created = [];
  const actor = {
    effects: [],
    async deleteEmbeddedDocuments() {},
    async createEmbeddedDocuments(_type, entries) { created.push(...entries); }
  };
  const sourceEffect = {
    id: "equip-effect",
    disabled: false,
    getFlag(_scope, key) { return key === "equipTransfer"; },
    toObject() { return { _id: this.id, name: "Equip effect", flags: { neuroshima: {} } }; }
  };
  const gear = {
    uuid: "Actor.actor.Item.gear",
    isEquippable: false,
    effects: [sourceEffect]
  };
  await NeuroshimaActor.prototype.syncEquipTransferEffects.call(actor, gear, true);
  assert.deepEqual(created, []);
});

test("Effects tab exposes and executes manual scripts from direct actor effects", async () => {
  const effect = {
    id: "manual-effect",
    name: "Awaryjny zastrzyk",
    disabled: false,
    system: {
      scriptData: [
        { trigger: "rollTest", label: "Nie pokazuj" },
        { trigger: "manual", label: "Uruchom @effect.name" }
      ]
    },
    getFlag() { return null; }
  };
  const scripts = NeuroshimaBaseActorSheet.prototype._prepareEffectManualScripts.call({}, effect, null);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].label, "Uruchom Awaryjny zastrzyk");
  assert.equal(scripts[0].itemId, null);

  const actor = { effects: new Map([[effect.id, effect]]), items: new Map() };
  const originalExecuteManual = NeuroshimaScriptRunner.executeManual;
  let executed = null;
  NeuroshimaScriptRunner.executeManual = async (...args) => { executed = args; };
  try {
    await NeuroshimaBaseActorSheet.prototype._onInvokeEffectScript.call(
      { document: actor },
      { preventDefault() {} },
      { dataset: { effectId: effect.id, scriptIndex: "1" } }
    );
    assert.deepEqual(executed, [actor, effect, 1]);
  } finally {
    NeuroshimaScriptRunner.executeManual = originalExecuteManual;
  }
});

test("convertToApplied stamps seconds duration with current world time", () => {
  const previousTime = game.time;
  game.time = { worldTime: 123456 };
  try {
    const effect = Object.create(NeuroshimaActiveEffect.prototype);
    effect.name = "Timed template";
    effect.uuid = "Item.source.ActiveEffect.template";
    effect.parent = { uuid: "Item.source" };
    effect.system = { scriptData: [] };
    effect.getFlag = (_scope, key) => key === "transferType" ? "other" : null;
    effect.toObject = () => ({
      name: effect.name,
      system: { scriptData: [] },
      duration: { seconds: 3600, startTime: null },
      flags: { neuroshima: { transferType: "other" } }
    });

    const applied = effect.convertToApplied();
    assert.equal(applied.duration.seconds, 3600);
    assert.equal(applied.duration.startTime, 123456);
  } finally {
    game.time = previousTime;
  }
});

test("isolated Simple Calendar delta advances Foundry seconds durations", async () => {
  const previousTime = game.time;
  const previousActors = game.actors;
  const previousCanvas = globalThis.canvas;
  const effect = {
    id: "timed-effect",
    duration: { seconds: 3600, startTime: 1000 }
  };
  const actor = {
    id: "actor",
    uuid: "Actor.actor",
    effects: [effect],
    async updateEmbeddedDocuments(type, updates, options) {
      assert.equal(type, "ActiveEffect");
      assert.equal(options.neuroshimaSimpleCalendarAdvance, true);
      for (const update of updates) {
        const target = this.effects.find(entry => entry.id === update._id);
        target.duration.startTime = update["duration.startTime"];
      }
    }
  };

  game.time = { worldTime: 1000 };
  game.actors = [actor];
  globalThis.canvas = { scene: null };
  try {
    const adjusted = await NeuroshimaScriptRunner.advanceIndependentCalendarDurations(3600);
    assert.equal(adjusted, 1);
    assert.equal(effect.duration.startTime, -2600);
  } finally {
    game.time = previousTime;
    game.actors = previousActors;
    if (previousCanvas === undefined) delete globalThis.canvas;
    else globalThis.canvas = previousCanvas;
  }
});

test("world-time expiry removes elapsed seconds effects after trigger processing", async () => {
  const actors = [{
    id: "actor",
    effects: [
      { id: "expired", duration: { seconds: 3600, remaining: 0 } },
      { id: "active", duration: { seconds: 3600, remaining: 1 } },
      { id: "combat-only", duration: { rounds: 1, remaining: 0 } }
    ],
    async deleteEmbeddedDocuments(type, ids, options) {
      assert.equal(type, "ActiveEffect");
      assert.deepEqual(ids, ["expired"]);
      assert.equal(options.neuroshimaDurationExpired, true);
      this.effects = this.effects.filter(effect => !ids.includes(effect.id));
    }
  }];

  const expired = await NeuroshimaScriptRunner.expireWorldTimeEffects(actors);
  assert.equal(expired, 1);
  assert.deepEqual(actors[0].effects.map(effect => effect.id), ["active", "combat-only"]);
});

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

test("prepared reputation cost API starts at 25 and supports passive modifiers", () => {
  const preparedData = { reputationCost: REPUTATION_XP_COST };
  const reputation = createReputationCostApi(preparedData);

  assert.equal(reputation.modifyCost(-10), 15);
  assert.equal(preparedData.reputationCost, 15);
  assert.equal(reputation.setCost(8.6), 9);
  assert.equal(reputation.cost, 9);
  reputation.cost = -50;
  assert.equal(reputation.cost, 0);
  assert.equal(normalizeReputationCost("invalid"), 25);
});

test("base reputation cost follows the world setting", () => {
  settingOverrides.reputationXpCost = 30;
  try {
    assert.equal(getBaseReputationCost(), 30);
  } finally {
    delete settingOverrides.reputationXpCost;
  }
});

test("reputation dialog uses the shared roll-dialog modifier infrastructure", () => {
  const dialog = Object.create(ReputationRollDialog.prototype);
  dialog._scriptFields = {
    modifier: 10,
    attributeBonus: 2,
    difficultyShift: 1
  };
  dialog._userValues = {
    modifier: 5,
    attributeBonus: 3
  };
  dialog.userEntry = {};
  dialog.rollOptions = {
    baseDifficulty: "average",
    isOpen: false,
    rollMode: "publicroll",
    repValue: 4,
    fame: 1
  };

  assert.ok(dialog instanceof NeuroshimaRollDialogBase);
  assert.deepEqual(dialog._resolveValues(), {
    fields: dialog._scriptFields,
    modifier: 15,
    repBonus: 5,
    baseDifficulty: NeuroshimaScriptRunner.shiftDifficultyKey("average", 1),
    isOpen: false,
    rollMode: "publicroll",
    repValue: 4,
    fame: 1
  });
});

test("prePrepareData reputation cost survives the base-data reset", () => {
  const actor = Object.create(NeuroshimaActor.prototype);
  actor.type = "character";
  actor.system = { reputationCost: 25 };
  const originalExecute = NeuroshimaScriptRunner.executeEventSync;
  const originalBasePrepare = Actor.prototype.prepareBaseData;
  Actor.prototype.prepareBaseData = function () {
    this.system.reputationCost = 25;
  };
  NeuroshimaScriptRunner.executeEventSync = (trigger, args) => {
    if (trigger === "prePrepareData") args.reputation.setCost(20);
  };

  try {
    actor.prepareBaseData();
    assert.equal(actor.system.reputationCost, 20);
  } finally {
    NeuroshimaScriptRunner.executeEventSync = originalExecute;
    if (originalBasePrepare) Actor.prototype.prepareBaseData = originalBasePrepare;
    else delete Actor.prototype.prepareBaseData;
  }
});

test("Active Effect changes expose reputation and fame values and bonuses", () => {
  const reputationKeys = NS_CHANGE_KEYS
    .find(group => group.group === "NEUROSHIMA.Effects.Keys.Group.Reputation")
    ?.keys.map(entry => entry.key);

  assert.deepEqual(reputationKeys, [
    "system.reputation",
    "system.reputationBonus",
    "system.fame",
    "system.fameBonus"
  ]);
  const reputationItemGroup = NS_CHANGE_KEYS
    .find(group => group.group === "NEUROSHIMA.Effects.Keys.Group.ReputationItem");
  assert.deepEqual(
    reputationItemGroup,
    {
      group: "NEUROSHIMA.Effects.Keys.Group.ReputationItem",
      itemTypes: ["reputation"],
      keys: [{ key: "system.value", label: "NEUROSHIMA.Effects.Keys.ReputationItemValue" }]
    }
  );
  assert.equal(isChangeGroupAvailable(reputationItemGroup, "character", null), false);
  assert.equal(isChangeGroupAvailable(reputationItemGroup, "character", "trait"), false);
  assert.equal(isChangeGroupAvailable(reputationItemGroup, "character", "reputation"), true);
});

test("reputation and fame changes support numeric Active Effect modes", () => {
  const data = Object.create(NeuroshimaActorData.prototype);
  data.parent = {
    appliedEffects: [{
      active: true,
      isSuppressed: false,
      changes: [
        { key: "system.reputation", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "3" },
        { key: "system.reputation", mode: CONST.ACTIVE_EFFECT_MODES.UPGRADE, value: "10" },
        { key: "system.fame", mode: CONST.ACTIVE_EFFECT_MODES.DOWNGRADE, value: "2" },
        { key: "system.fameBonus", mode: CONST.ACTIVE_EFFECT_MODES.MULTIPLY, value: "2" },
        { key: "system.reputationBonus", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "7" }
      ]
    }]
  };

  assert.equal(data._applyPostDerivedActiveEffectValue("system.reputation", 5), 10);
  assert.equal(data._applyPostDerivedActiveEffectValue("system.fame", 4), 2);
  assert.equal(data._applyPostDerivedActiveEffectValue("system.fameBonus", 3), 6);
  assert.equal(data._applyPostDerivedActiveEffectValue("system.reputationBonus", 1), 7);
});

test("effect Active Effect penalty remains separate from prepared armor penalty", () => {
  const data = Object.assign(Object.create(NeuroshimaActorData.prototype), {
    attributes: {},
    attributeBonuses: {},
    modifiers: {},
    skills: {},
    skillBonuses: {},
    combat: {
      armorPenaltyBonus: 3,
      effectPenalty: 40
    },
    size: "normal"
  });
  data.parent = {
    items: [{
      type: "armor",
      system: { equipped: true, armor: { penalty: 7 } }
    }]
  };
  const originalExecute = NeuroshimaScriptRunner.executeEventSync;
  NeuroshimaScriptRunner.executeEventSync = () => undefined;
  try {
    data._prepareSharedData();
  } finally {
    NeuroshimaScriptRunner.executeEventSync = originalExecute;
  }

  assert.equal(data.combat.totalArmorPenalty, 10);
  assert.equal(data.combat.effectPenalty, 40);
});

test("effect penalty change key is canonical and legacy changes normalize safely", () => {
  const combatKeys = NS_CHANGE_KEYS
    .flatMap(group => group.keys)
    .map(entry => entry.key);
  assert.ok(combatKeys.includes(EFFECT_PENALTY_KEY));
  assert.ok(!combatKeys.includes(LEGACY_EFFECT_PENALTY_KEY));

  const source = [
    { key: LEGACY_EFFECT_PENALTY_KEY, mode: 2, value: "20" },
    { key: "system.combat.armorPenaltyBonus", mode: 2, value: "5" }
  ];
  const normalized = normalizeEffectPenaltyChanges(source);
  assert.equal(normalized.changed, true);
  assert.equal(normalized.changes[0].key, EFFECT_PENALTY_KEY);
  assert.equal(normalized.changes[1], source[1]);
  assert.equal(source[0].key, LEGACY_EFFECT_PENALTY_KEY);
});

test("manual spent XP adjustments log both expenses and restorations", () => {
  const actor = {
    system: {
      xp: { total: 100, spent: 20 },
      xpLog: []
    }
  };
  const expense = {};
  const expenseEntry = applyXpSpentAdjustment(actor, expense, 35, "Nietypowy zakup");

  assert.equal(expense.system.xp.spent, 35);
  assert.equal(expenseEntry.cost, 15);
  assert.equal(expenseEntry.xpBefore, 80);
  assert.equal(expenseEntry.xpAfter, 65);
  assert.equal(expenseEntry.operation, "manualSpent");

  actor.system.xp.spent = 35;
  actor.system.xpLog = expense.system.xpLog;
  const restoration = {};
  const restorationEntry = applyXpSpentAdjustment(actor, restoration, 10, "Zwrot za zakup");

  assert.equal(restoration.system.xp.spent, 10);
  assert.equal(restorationEntry.cost, -25);
  assert.equal(restorationEntry.xpBefore, 65);
  assert.equal(restorationEntry.xpAfter, 90);
});

test("manual spent XP uses the placeholder as the log reason when left empty", async () => {
  const originalDialog = foundry.applications.api.DialogV2;
  let dialogConfig;
  foundry.applications.api.DialogV2 = {
    async wait(config) {
      dialogConfig = config;
      return config.buttons[0].callback(
        null,
        null,
        { element: { querySelector: () => ({ value: "" }) } }
      );
    }
  };

  try {
    const result = await showXpSpentAdjustmentDialog(-10);
    assert.deepEqual(result, { reason: "NEUROSHIMA.XP.Adjustment.ReasonPlaceholder" });
    assert.match(dialogConfig.content, /placeholder="NEUROSHIMA\.XP\.Adjustment\.ReasonPlaceholder"/);
    assert.doesNotMatch(dialogConfig.content, /\srequired(?:\s|>)/);
  } finally {
    if (originalDialog) foundry.applications.api.DialogV2 = originalDialog;
    else delete foundry.applications.api.DialogV2;
  }
});

test("XP spending dialog warns about debt without disabling spending", async () => {
  const originalDialog = foundry.applications.api.DialogV2;
  let dialogConfig;
  foundry.applications.api.DialogV2 = {
    async wait(config) {
      dialogConfig = config;
      return config.buttons.find(button => button.action === "spend").callback(
        null,
        null,
        { element: { querySelector: () => ({ value: "25" }) } }
      );
    }
  };

  try {
    const result = await showXpDialog(25, "Reputacja <Posterunek>", 10);
    const spend = dialogConfig.buttons.find(button => button.action === "spend");
    assert.equal(spend.default, true);
    assert.notEqual(spend.disabled, true);
    assert.ok(dialogConfig.classes.includes("xp-spend-dialog"));
    assert.match(
      dialogConfig.content,
      /<\/label>\s*<hr class="xp-ledger__total-separator">\s*<div class="xp-ledger__entry xp-ledger__entry--projected">/
    );
    assert.equal((dialogConfig.content.match(/<hr\b/g) ?? []).length, 1);
    assert.match(dialogConfig.content, /data-xp-projected aria-live="polite">-15/);
    assert.match(dialogConfig.content, /data-xp-debt-warning role="status"/);
    assert.deepEqual(result, { free: false, cost: 25 });
  } finally {
    if (originalDialog) foundry.applications.api.DialogV2 = originalDialog;
    else delete foundry.applications.api.DialogV2;
  }
});

test("XP entries preserve an intentionally negative available balance", () => {
  const actor = {
    system: {
      xp: { total: 10, spent: 0 },
      xpLog: []
    }
  };
  const changed = {};
  applyXpEntry(actor, changed, 25, "Wydatek ponad stan", 0, "system.attributes.dexterity");

  assert.equal(changed.system.xp.spent, 25);
  assert.equal(changed.system.xpLog[0].xpAfter, -15);
});

test("reputation purchases spend XP and retain the linked item for reversal", () => {
  const actor = {
    system: {
      xp: { total: 100, spent: 10 },
      xpLog: []
    }
  };
  const changed = {};
  applyXpEntry(
    actor,
    changed,
    50,
    "Zakup reputacji",
    2,
    "system.value",
    { operation: "reputation", documentUuid: "Actor.actor.Item.reputation" }
  );

  assert.equal(changed.system.xp.spent, 60);
  assert.equal(changed.system.xpLog[0].cost, 50);
  assert.equal(changed.system.xpLog[0].xpBefore, 90);
  assert.equal(changed.system.xpLog[0].xpAfter, 40);
  assert.equal(changed.system.xpLog[0].operation, "reputation");
  assert.equal(changed.system.xpLog[0].documentUuid, "Actor.actor.Item.reputation");
});

test("reverting a reputation purchase restores its item and spent XP", async () => {
  const item = {
    system: { value: 4 },
    async update(changed) {
      foundry.utils.setProperty(this, "system.value", changed["system.value"]);
    }
  };
  const uuid = "Actor.actor.Item.reputation-revert";
  documents.set(uuid, item);
  const actor = {
    system: {
      xp: { total: 100, spent: 45 },
      xpLog: [{
        id: "purchase",
        cost: 25,
        previousValue: 3,
        fieldPath: "system.value",
        operation: "reputation",
        documentUuid: uuid
      }]
    },
    async update(changed) {
      if ("system.xp.spent" in changed) this.system.xp.spent = changed["system.xp.spent"];
      if ("system.xpLog" in changed) this.system.xpLog = changed["system.xpLog"];
    }
  };

  try {
    await revertXpEntry(actor, "purchase");
    assert.equal(item.system.value, 3);
    assert.equal(actor.system.xp.spent, 20);
    assert.deepEqual(actor.system.xpLog, []);
  } finally {
    documents.delete(uuid);
  }
});

test("reverting a reputation refund restores its item and spent XP", async () => {
  const item = {
    system: { value: 2 },
    async update(changed) {
      foundry.utils.setProperty(this, "system.value", changed["system.value"]);
    }
  };
  const uuid = "Actor.actor.Item.reputation-refund-revert";
  documents.set(uuid, item);
  const actor = {
    system: {
      xp: { total: 100, spent: 25 },
      xpLog: [{
        id: "refund",
        cost: -25,
        previousValue: 3,
        fieldPath: "system.value",
        operation: "reputationRefund",
        documentUuid: uuid
      }]
    },
    async update(changed) {
      if ("system.xp.spent" in changed) this.system.xp.spent = changed["system.xp.spent"];
      if ("system.xpLog" in changed) this.system.xpLog = changed["system.xpLog"];
    }
  };

  try {
    await revertXpEntry(actor, "refund");
    assert.equal(item.system.value, 3);
    assert.equal(actor.system.xp.spent, 50);
    assert.deepEqual(actor.system.xpLog, []);
  } finally {
    documents.delete(uuid);
  }
});

test("reverting an XP grant does not also alter spent XP", async () => {
  const actor = {
    system: {
      xp: { total: 100, spent: 20 },
      xpLog: []
    },
    async update(changed) {
      const changedTotal = foundry.utils.getProperty(changed, "system.xp.total");
      if (changedTotal !== undefined) this.system.xp.total = changedTotal;
      if ("system.xp.spent" in changed) this.system.xp.spent = changed["system.xp.spent"];
      if ("system.xpLog" in changed) this.system.xpLog = changed["system.xpLog"];
    }
  };
  const changed = {};
  foundry.utils.setProperty(changed, "system.xp.total", 150);
  applyXpGrantEntry(actor, changed, 50, "Nagroda sesyjna");
  actor.system.xp.total = changed.system.xp.total;
  actor.system.xpLog = changed.system.xpLog;

  await revertXpEntry(actor, actor.system.xpLog[0].id);
  assert.equal(actor.system.xp.total, 100);
  assert.equal(actor.system.xp.spent, 20);
  assert.deepEqual(actor.system.xpLog, []);
});

test("built-in overweight condition is symmetric around the encumbrance limit", () => {
  assert.equal(isOverweightEncumbrance({ enabled: true, value: 19.99, max: 20 }), false);
  assert.equal(isOverweightEncumbrance({ enabled: true, value: 20, max: 20 }), false);
  assert.equal(isOverweightEncumbrance({ enabled: true, value: 20.01, max: 20 }), true);
  assert.equal(isOverweightEncumbrance({ enabled: true, value: 25, max: 20 }), true);
  assert.equal(isOverweightEncumbrance({ enabled: false, value: 25, max: 20 }), false);
  assert.equal(isOverweightEncumbrance({ enabled: true, value: 25, max: 0 }), false);

  const code = DEFAULT_CONDITIONS.find(condition => condition.key === "overweight")
    ?.conditionCheckCode;
  assert.match(code, /this\.isOverweight/);
  assert.match(code, /this\.remove\(\)/);
});

test("automatic condition checks mark their own effects and never remove manual ones", async () => {
  const calls = [];
  const contextActor = {
    hasCondition: () => false,
    async addCondition(key, value, options) {
      calls.push(["add", key, value, options]);
    },
    async removeCondition(key, options) {
      calls.push(["remove", key, options]);
    }
  };
  const context = new NeuroshimaConditionCheckContext(contextActor, {
    key: "overweight",
    name: "Przeciążony"
  });

  await context.apply();
  await context.remove();
  assert.deepEqual(calls, [
    ["add", "overweight", 1, { automatic: true }],
    ["remove", "overweight", { automaticOnly: true }]
  ]);

  let createdData;
  const createActor = {
    effects: [],
    async createEmbeddedDocuments(_type, data) {
      createdData = data;
      return data;
    }
  };
  await NeuroshimaActor.prototype.toggleStatusEffect.call(
    createActor,
    "overweight",
    { active: true, automatic: true }
  );
  assert.equal(createdData[0].flags.neuroshima.autoCondition, true);

  const deletedIds = [];
  const effect = (id, automatic) => ({
    id,
    disabled: false,
    statuses: new Set(["overweight"]),
    getFlag: (_scope, key) => key === "autoCondition" ? automatic : undefined
  });
  const removeActor = {
    effects: [effect("manual", false), effect("automatic", true)],
    async deleteEmbeddedDocuments(_type, ids) {
      deletedIds.push(...ids);
    }
  };
  await NeuroshimaActor.prototype.toggleStatusEffect.call(
    removeActor,
    "overweight",
    { active: false, automaticOnly: true }
  );
  assert.deepEqual(deletedIds, ["automatic"]);
});

test("vehicle crew UUID resolves the concrete unlinked-token Actor", async () => {
  const syntheticActor = {
    id: "prototype-npc",
    uuid: "Scene.scene.Token.token.Actor",
    documentName: "Actor",
    name: "NPC w pojeździe"
  };
  const token = {
    uuid: "Scene.scene.Token.token",
    documentName: "Token",
    actor: syntheticActor
  };
  documents.set(syntheticActor.uuid, syntheticActor);
  documents.set(token.uuid, token);
  const originalActors = game.actors;
  game.actors = new Map([[syntheticActor.id, { documentName: "Actor", name: "Prototyp NPC" }]]);

  try {
    assert.equal(
      await resolveCrewActor({ actorId: "prototype-npc", actorUuid: syntheticActor.uuid }),
      syntheticActor
    );
    assert.equal(
      await resolveCrewActor({ actorId: syntheticActor.id, actorUuid: "Scene.deleted.Token.missing.Actor" }),
      null,
      "a stale synthetic UUID must never fall back to the prototype Actor"
    );
    assert.equal(
      await resolveCrewActor({ actorId: syntheticActor.id }),
      game.actors.get(syntheticActor.id),
      "actorId remains available only for legacy rows without actorUuid"
    );
    assert.equal(
      await resolveCrewActor({ actorId: "prototype-npc", actorUuid: token.uuid }),
      syntheticActor
    );
    assert.equal(
      crewMemberMatches(
        { actorId: "prototype-npc", actorUuid: "Scene.scene.Token.first.Actor" },
        { actorId: "prototype-npc", actorUuid: "Scene.scene.Token.second.Actor" }
      ),
      false
    );
  } finally {
    documents.delete(syntheticActor.uuid);
    documents.delete(token.uuid);
    if (originalActors === undefined) delete game.actors;
    else game.actors = originalActors;
  }
});

test("saved legacy overweight template is upgraded without replacing custom checks", () => {
  const legacyCode = `const enc = this.encumbrance;
if (!enc || enc.enabled === false || enc.max <= 0) return;
if (enc.value >= enc.max) await this.apply();
else await this.remove();`;
  settingOverrides.conditions = [{
    id: "overweight",
    key: "overweight",
    name: "Przeciążony",
    type: "boolean",
    conditionCheckCode: legacyCode
  }];

  try {
    const migrated = getConditions().find(condition => condition.key === "overweight");
    assert.match(migrated.conditionCheckCode, /this\.isOverweight/);

    settingOverrides.conditions[0].conditionCheckCode = "if (customRule) await this.apply();";
    const customized = getConditions().find(condition => condition.key === "overweight");
    assert.equal(customized.conditionCheckCode, "if (customRule) await this.apply();");
  } finally {
    delete settingOverrides.conditions;
  }
});

test("built-in NPC and creature defeat conditions apply and remove symmetrically", () => {
  assert.equal(isDefeatedByDamage({ actorType: "npc", totalDamagePoints: 26, maxHP: 27 }), false);
  assert.equal(isDefeatedByDamage({ actorType: "npc", totalDamagePoints: 27, maxHP: 27 }), true);
  assert.equal(isDefeatedByDamage({ actorType: "creature", totalDamagePoints: 30, maxHP: 27 }), true);
  assert.equal(isDefeatedByDamage({ actorType: "character", totalDamagePoints: 30, maxHP: 27 }), false);
  assert.equal(isDefeatedByDamage({ actorType: "creature", totalDamagePoints: 30, maxHP: 0 }), false);

  for (const key of ["dead", "prone"]) {
    const code = DEFAULT_CONDITIONS.find(condition => condition.key === key)?.conditionCheckCode;
    assert.match(code, /this\.usesAutomaticDefeat/);
    assert.match(code, /this\.isDefeated/);
    assert.match(code, /this\.remove\(\)/);
  }
});

test("saved legacy defeat templates are upgraded without replacing custom checks", () => {
  const legacyCode = `if (!["npc", "creature"].includes(this.actor.type)) return;
const maxHP = this.actor.type === "creature"
  ? (this.actor.getFlag("neuroshima", "creatureMaxHP") || this.actor.system.combat?.maxHP || 27)
  : (this.actor.system.hp?.max ?? 27);
if (maxHP > 0 && this.totalDamagePoints >= maxHP) await this.apply();`;
  settingOverrides.conditions = [{
    id: "dead",
    key: "dead",
    name: "Martwy",
    type: "boolean",
    conditionCheckCode: legacyCode
  }, {
    id: "prone",
    key: "prone",
    name: "Leżący",
    type: "boolean",
    conditionCheckCode: "if (customRule) await this.apply();"
  }];

  try {
    assert.match(
      getConditions().find(condition => condition.key === "dead").conditionCheckCode,
      /this\.isDefeated/
    );
    assert.equal(
      getConditions().find(condition => condition.key === "prone").conditionCheckCode,
      "if (customRule) await this.apply();"
    );
  } finally {
    delete settingOverrides.conditions;
  }
});

test("exact numeric condition values use the canonical effect schema", async () => {
  let createdData = null;
  const actor = {
    effects: [],
    addCondition(key, value) {
      return NeuroshimaActor.prototype.addCondition.call(this, key, value);
    },
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "ActiveEffect");
      createdData = data;
      return [];
    },
    _refreshTokenHUD() {}
  };

  await NeuroshimaActor.prototype.setConditionValue.call(actor, "bleeding", 2);
  assert.equal(createdData[0].flags.neuroshima.conditionValue, 2);
  assert.ok(Array.isArray(createdData[0].system.scriptData));
  assert.equal(createdData[0].system.scriptData[0].trigger, "startTurn");
  assert.equal("scripts" in createdData[0].flags.neuroshima, false);
});

test("legacy Active Effect success API is normalized at runtime", () => {
  const script = new NeuroshimaScript({
    code: "args.result.addSuccesses(1); const n = args.test.result.successCount;",
    submissionScript: "args.context.attacker.successes >= 2;"
  }, null);
  assert.equal(
    script.code,
    "args.result.addSuccessPoints(1); const n = args.test.result.successPoints;"
  );
  assert.equal(
    script.submissionScript,
    "args.context.attacker.successPoints >= 2;"
  );
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

async function rollCanonicalSkill(fixedDice, { isOpen = false } = {}) {
  const instance = new SkillTest({
    preData: {
      stat: 10,
      skill: 0,
      fixedDice,
      isOpen,
      applySkillDifficultyShift: false,
      applyDiceDifficultyShift: false
    },
    context: { isDebug: true, isOpen }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  return instance;
}

test("closed tests expose only one success point per successful die", async () => {
  const cases = [
    { dice: [11, 12, 13], points: 0, success: false },
    { dice: [10, 11, 12], points: 1, success: false },
    { dice: [9, 10, 11], points: 2, success: true },
    { dice: [8, 9, 10], points: 3, success: true }
  ];
  for (const expected of cases) {
    const instance = await rollCanonicalSkill(expected.dice);
    assert.equal(instance.result.successPoints, expected.points);
    assert.equal(instance.result.success, expected.success);
    assert.equal("successCount" in instance.result, false);
  }
});

test("open tests use quality margin as canonical successPoints", async () => {
  const onePoint = await rollCanonicalSkill([10, 15], { isOpen: true });
  const fourPoints = await rollCanonicalSkill([7, 15], { isOpen: true });
  const failure = await rollCanonicalSkill([11, 12], { isOpen: true });
  assert.equal(onePoint.result.successPoints, 1);
  assert.equal(fourPoints.result.successPoints, 4);
  assert.equal(failure.result.successPoints, 0);
  assert.equal(failure.result.success, false);
});

test("legacy successCount is normalized during recreation and omitted from serialization", async () => {
  const actor = actorFixture();
  documents.set(actor.uuid, actor);
  const recreated = await NeuroshimaTestBase.recreate({
    preData: {
      rollClass: "SkillTest",
      actorUuid: actor.uuid,
      targetUuids: [],
      resultModifiers: { successes: 1 }
    },
    result: { successCount: 2 },
    context: {
      basePreData: {
        resultModifiers: { successes: 3 }
      }
    }
  });
  assert.equal(recreated.result.successPoints, 2);
  assert.equal("successCount" in recreated.result, false);
  assert.equal(recreated.preData.resultModifiers.successPoints, 1);
  assert.equal("successes" in recreated.preData.resultModifiers, false);
  assert.equal(recreated.context.basePreData.resultModifiers.successPoints, 3);
  assert.equal("successes" in recreated.context.basePreData.resultModifiers, false);
  const serialized = recreated.toData();
  assert.equal(serialized.result.successPoints, 2);
  assert.equal("successCount" in serialized.result, false);
});

test("creature synthetic weapon survives recreation and reroll", async () => {
  const actor = {
    ...actorFixture(),
    type: "creature",
    name: "Bestia",
    system: {
      experience: 6,
      attributeTotals: { dexterity: 12 },
      skills: {}
    }
  };
  documents.set(actor.uuid, actor);
  const syntheticWeapon = {
    id: null,
    beastItemId: "beast-action",
    name: "Pazury",
    img: "pazury.webp",
    type: "weapon",
    system: {
      weaponType: "melee",
      attribute: "dexterity",
      skill: "experience",
      attackBonus: 0,
      defenseBonus: 0,
      damageMelee1: "L",
      damageMelee2: "C",
      damageMelee3: "K",
      piercing: 1,
      jamming: 20
    }
  };
  const original = new MeleeWeaponTest({
    item: syntheticWeapon,
    preData: {
      label: syntheticWeapon.name,
      stat: 12,
      skill: 6,
      fixedDice: [2, 8, 15]
    },
    context: { isDebug: true, isMelee: true, meleeAction: "attack" }
  }, actor);
  await original.roll({ sendToChat: false });
  const serialized = original.toData();
  assert.equal(serialized.preData.itemSnapshot.beastItemId, "beast-action");

  const recreated = await NeuroshimaTestBase.recreate(serialized);
  assert.equal(recreated.item.name, "Pazury");
  assert.equal(recreated.item.system.damageMelee2, "C");
  recreated.sendToChat = async () => null;
  await recreated.reroll();
  assert.equal(recreated.result.damageMelee1, "L");
  assert.equal(recreated.result.damageMelee2, "C");
  assert.equal(recreated.result.damageMelee3, "K");
});

test("legacy creature weapon roll recreates a fallback without embedded weapon", async () => {
  const actor = {
    ...actorFixture(),
    type: "creature",
    name: "Bestia"
  };
  documents.set(actor.uuid, actor);
  const data = {
    preData: {
      rollClass: "MeleeWeaponTest",
      actorUuid: actor.uuid,
      itemUuid: null,
      stat: 10,
      skill: 4
    },
    result: {
      label: "Cios stworzenia",
      isMelee: true,
      damageMelee1: "D",
      damageMelee2: "C",
      damageMelee3: "K"
    },
    context: { isDebug: true, isMelee: true }
  };
  const recreated = await NeuroshimaTestBase.recreate(data);
  assert.equal(recreated.item.isSynthetic, true);
  assert.equal(recreated.item.system.damageMelee2, "C");
});

function effectFixture(id, { equipTransfer = false, fromModId = null, sourceModEffectId = null } = {}) {
  const flags = {
    equipTransfer,
    ...(fromModId ? { fromModId } : {}),
    ...(sourceModEffectId ? { sourceModEffectId } : {})
  };
  return {
    id,
    disabled: false,
    getFlag(_scope, key) { return flags[key]; },
    toObject() {
      return {
        _id: id,
        name: id,
        disabled: false,
        transfer: !equipTransfer,
        flags: { neuroshima: deepClone(flags) }
      };
    },
    async update(data) {
      this.updated = deepClone(data);
    }
  };
}

test("mounted modification propagates every effect to the parent item only", async () => {
  const ordinary = effectFixture("ordinary", { equipTransfer: false });
  const onEquip = effectFixture("on-equip", { equipTransfer: true });
  const modItem = { id: "mod", effects: [ordinary, onEquip] };
  const syncCalls = [];
  const actor = {
    items: new Map([["mod", modItem]]),
    async syncEquipTransferEffects(item, equipped) {
      syncCalls.push([item.id, equipped]);
    }
  };
  const created = [];
  const createOptions = [];
  const parent = {
    id: "weapon",
    type: "weapon",
    actor,
    system: { equipped: true },
    effects: [],
    async createEmbeddedDocuments(_type, entries, options) {
      created.push(...deepClone(entries));
      createOptions.push(options);
    },
    async deleteEmbeddedDocuments() {}
  };

  await syncMountedModEffects(parent, modItem.id, null, true);

  assert.equal(created.length, 2);
  const ordinaryCopy = created.find(effect => effect.name === "ordinary");
  const equipCopy = created.find(effect => effect.name === "on-equip");
  assert.equal(ordinaryCopy.flags.neuroshima.fromModId, modItem.id);
  assert.equal(ordinaryCopy.flags.neuroshima.sourceModEffectId, "ordinary");
  assert.equal(ordinaryCopy.transfer, true);
  assert.equal(equipCopy.flags.neuroshima.fromModId, modItem.id);
  assert.equal(equipCopy.flags.neuroshima.sourceModEffectId, "on-equip");
  assert.equal(equipCopy.flags.neuroshima.equipTransfer, true);
  assert.equal(equipCopy.transfer, false);
  assert.deepEqual(ordinary.updated, { transfer: false });
  assert.deepEqual(onEquip.updated, { transfer: false });
  assert.deepEqual(createOptions, [{ neuroshimaModEffectSync: true }]);
  assert.deepEqual(syncCalls, [["weapon", true]]);
});

test("detaching modification removes its parent effects and reconciles actor mirrors", async () => {
  const copied = effectFixture("copy", {
    equipTransfer: true,
    fromModId: "mod",
    sourceModEffectId: "source"
  });
  const deleted = [];
  const deleteOptions = [];
  const syncCalls = [];
  const actor = {
    items: new Map(),
    async syncEquipTransferEffects(item, equipped) {
      syncCalls.push([item.id, equipped]);
    }
  };
  const parent = {
    id: "armor",
    type: "armor",
    actor,
    system: { equipped: true },
    effects: [copied],
    async createEmbeddedDocuments() {},
    async deleteEmbeddedDocuments(_type, ids, options) {
      deleted.push(...ids);
      deleteOptions.push(options);
      this.effects = this.effects.filter(effect => !ids.includes(effect.id));
    }
  };

  await syncMountedModEffects(parent, "mod", null, false);

  assert.deepEqual(deleted, ["copy"]);
  assert.deepEqual(deleteOptions, [{ neuroshimaModEffectSync: true }]);
  assert.deepEqual(syncCalls, [["armor", true]]);
});

test("legacy mounted effects are preserved when their source modification is missing", async () => {
  const ordinaryCopy = effectFixture("ordinary-copy", {
    equipTransfer: false,
    fromModId: "missing-mod"
  });
  const equipCopy = effectFixture("equip-copy", {
    equipTransfer: true,
    fromModId: "missing-mod"
  });
  const deleted = [];
  const actor = {
    items: new Map(),
    async syncEquipTransferEffects() {}
  };
  const parent = {
    id: "weapon",
    actor,
    system: { equipped: false },
    effects: [ordinaryCopy, equipCopy],
    async deleteEmbeddedDocuments(_type, ids) {
      deleted.push(...ids);
    }
  };

  await syncMountedModEffects(parent, "missing-mod", null, true);
  assert.deepEqual(deleted, []);
});

test("mounted modification reconciliation removes duplicate host copies", async () => {
  const source = effectFixture("source", { equipTransfer: true });
  const firstCopy = effectFixture("copy-1", {
    equipTransfer: true,
    fromModId: "mod",
    sourceModEffectId: "source"
  });
  const duplicateCopy = effectFixture("copy-2", {
    equipTransfer: true,
    fromModId: "mod",
    sourceModEffectId: "source"
  });
  const deleted = [];
  const actor = {
    items: new Map([["mod", { id: "mod", effects: [source] }]]),
    async syncEquipTransferEffects() {}
  };
  const parent = {
    id: "weapon",
    actor,
    system: { equipped: true },
    effects: [firstCopy, duplicateCopy],
    async createEmbeddedDocuments() {},
    async deleteEmbeddedDocuments(_type, ids) {
      deleted.push(...ids);
    }
  };

  await syncMountedModEffects(parent, "mod", null, true);

  assert.deepEqual(deleted, ["copy-2"]);
  assert.equal(firstCopy.updated.flags.neuroshima.sourceModEffectId, "source");
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

test("closed ranged hit succeeds with canonical successPoints", async () => {
  const actor = actorFixture();
  const weapon = {
    id: "ranged",
    uuid: "Actor.actor.Item.ranged",
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
  const instance = new RangedWeaponTest({
    item: weapon,
    preData: {
      stat: 10,
      skill: 0,
      fixedDice: [10, 15, 18],
      bulletsFired: 1,
      applySkillDifficultyShift: false,
      applyDiceDifficultyShift: false
    },
    context: { isDebug: true }
  }, actor);
  await instance.roll({ sendToChat: false });
  assert.equal(instance.result.successPoints, 1);
  assert.equal(instance.result.success, true);
  assert.equal("successCount" in instance.result, false);
});

test("melee defense requires two successPoints", async () => {
  const actor = actorFixture();
  const weapon = {
    id: "melee",
    uuid: "Actor.actor.Item.melee",
    name: "Knife",
    system: {
      weaponType: "melee",
      damageMelee1: "D",
      damageMelee2: "L",
      damageMelee3: "C",
      piercing: 0
    }
  };
  const rollDefense = async fixedDice => {
    const instance = new MeleeWeaponTest({
      item: weapon,
      preData: {
        stat: 10,
        skill: 0,
        fixedDice,
        meleeAction: "defense",
        applySkillDifficultyShift: false,
        applyDiceDifficultyShift: false
      },
      context: { isDebug: true, isMelee: true, meleeAction: "defense" }
    }, actor);
    await instance.roll({ sendToChat: false });
    return instance;
  };
  const onePoint = await rollDefense([10, 11, 12]);
  const twoPoints = await rollDefense([9, 10, 11]);
  assert.equal(onePoint.result.successPoints, 1);
  assert.equal(onePoint.result.success, false);
  assert.equal(twoPoints.result.successPoints, 2);
  assert.equal(twoPoints.result.success, true);
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
  const chatData = await instance.getChatData();
  assert.equal(chatData.autoSuccess, true);
});

test("forceInitiative persists the override and updates chat data and Combat Tracker", async () => {
  const updates = [];
  const combatant = {
    async update(data) {
      updates.push(data);
    }
  };
  const instance = new InitiativeTest({
    preData: { stat: 12, skill: 4, fixedDice: [2, 8, 15] },
    context: { isDebug: true },
    combatant
  }, actorFixture());
  const script = new NeuroshimaScript({}, null);
  script._currentArgs = { test: instance, eventContext: { phase: "pre" } };

  assert.equal(script.forceInitiative(17), true);
  await instance.roll({ sendToChat: false });

  assert.equal(instance.result.initiative, 17);
  assert.equal(instance.result.successPoints, 17);
  assert.equal(instance.result.initiativeForced, true);
  assert.equal(instance.toData().preData.resultModifiers.forcedInitiative, 17);
  const chatData = await instance.getChatData();
  assert.equal(chatData.initiative, 17);
  assert.equal(chatData.successPoints, 17);
  assert.deepEqual(updates, [{ initiative: 17 }]);
});

test("forceInitiative rejects invalid values and non-initiative tests", () => {
  const script = new NeuroshimaScript({}, null);
  const skill = new SkillTest({}, actorFixture());
  script._currentArgs = { test: skill, eventContext: { phase: "pre" } };
  assert.equal(script.forceInitiative(10), false);

  const initiative = new InitiativeTest({}, actorFixture());
  script._currentArgs = { test: initiative, eventContext: { phase: "pre" } };
  assert.equal(script.forceInitiative("not-a-number"), false);
  assert.equal(script.forceInitiative(""), false);
  assert.equal(script.forceInitiative(null), false);
  assert.equal(initiative.preData.resultModifiers?.forcedInitiative, undefined);
});

test("forceInitiative is available to initiative dialog submissionScript", async () => {
  const options = {};
  const script = new NeuroshimaScript({
    trigger: "dialog",
    submissionScript: "return this.forceInitiative(14);"
  }, null);

  const result = await script.runSubmission({
    actor: actorFixture(),
    rollType: "initiative",
    eventContext: { trigger: "dialog", phase: "submission" },
    options,
    fields: {},
    flags: {}
  });

  assert.equal(result, true);
  assert.equal(options.forcedInitiative, 14);
});

test("forceInitiative from rollTest recalculates before updating the Combat Tracker", async () => {
  const updates = [];
  const instance = new InitiativeTest({
    preData: { stat: 12, skill: 0, fixedDice: [2, 8, 15] },
    context: { isDebug: true },
    combatant: { async update(data) { updates.push(data); } }
  }, actorFixture());
  const script = new NeuroshimaScript({}, null);
  instance.runPostEffects = async () => {
    script._currentArgs = { test: instance, eventContext: { phase: "result" } };
    assert.equal(script.forceInitiative(23), true);
  };

  await instance.roll({ sendToChat: false });

  assert.equal(instance.context.dirty, false);
  assert.equal(instance.result.initiative, 23);
  assert.equal(instance.result.successPoints, 23);
  assert.deepEqual(updates, [{ initiative: 23 }]);
});

test("script rollSkillTest opens the local dialog with prepared actor totals", async () => {
  const actor = {
    ...actorFixture(),
    documentName: "Actor",
    name: "Tester",
    type: "character",
    system: {
      attributeTotals: { charisma: 14 },
      attributes: { charisma: 12 },
      skillTotals: { steadfastness: 5 },
      skills: { steadfastness: { value: 4 } }
    }
  };
  const expectedResult = { success: true, successPoints: 3 };
  const expectedTest = { result: expectedResult };
  let dialogOptions;
  const originalWait = NeuroshimaSkillRollDialog.wait;
  NeuroshimaSkillRollDialog.wait = async options => {
    dialogOptions = options;
    return {
      cancelled: false,
      success: true,
      isSuccess: true,
      successPoints: 3,
      test: expectedTest,
      result: expectedResult
    };
  };

  try {
    const script = new NeuroshimaScript({}, null);
    const result = await script.rollSkillTest("steadfastness", {
      actor,
      difficulty: "hard",
      isOpen: false,
      testType: "totem",
      testSubtype: "activation"
    });

    assert.equal(dialogOptions.stat, 14);
    assert.equal(dialogOptions.skill, 5);
    assert.equal(dialogOptions.currentAttribute, "charisma");
    assert.equal(dialogOptions.lastRoll.baseDifficulty, "hard");
    assert.equal(dialogOptions.lastRoll.isOpen, false);
    assert.equal(dialogOptions.testType, "totem");
    assert.equal(dialogOptions.testSubtype, "activation");
    assert.equal(result.cancelled, false);
    assert.equal(result.successPoints, 3);
    assert.equal(result.type, "skill");
    assert.equal(result.attributeKey, "charisma");
    assert.equal(result.skillKey, "steadfastness");
    assert.equal(result.test, expectedTest);
  } finally {
    NeuroshimaSkillRollDialog.wait = originalWait;
  }
});

test("script rollAttributeTest falls back to the local GM and normalizes cancellation", async () => {
  const actor = {
    ...actorFixture(),
    documentName: "Actor",
    name: "Tester",
    type: "character",
    system: {
      attributeTotals: { constitution: 13 },
      attributes: { constitution: 12 },
      skills: {}
    }
  };
  const originalWait = NeuroshimaSkillRollDialog.wait;
  NeuroshimaSkillRollDialog.wait = async () => null;

  try {
    const script = new NeuroshimaScript({}, null);
    const result = await script.rollAttributeTest("constitution", { actor });
    assert.deepEqual(result, {
      cancelled: true,
      success: false,
      isSuccess: false,
      successPoints: 0,
      successes: 0,
      test: null,
      result: null,
      type: "attribute",
      attributeKey: "constitution",
      skillKey: null,
      difficulty: "average",
      isOpen: true
    });
  } finally {
    NeuroshimaSkillRollDialog.wait = originalWait;
  }
});

function immediateRollActor({ rollImpl, resultCallback } = {}) {
  const result = { success: true, successPoints: 2 };
  const fakeTest = {
    result,
    async roll() {
      if (rollImpl) await rollImpl();
      return this;
    }
  };
  const actor = {
    ...actorFixture(),
    documentName: "Actor",
    name: "Immediate tester",
    type: "character",
    items: [],
    system: {
      attributeTotals: { constitution: 13 },
      attributes: { constitution: 12 },
      skillTotals: {},
      skills: {},
      combat: {}
    },
    async update() {},
    _setupTest(TestClass, data) {
      assert.equal(TestClass, AttributeTest);
      assert.equal(data.attribute.value, 13);
      return fakeTest;
    }
  };
  return { actor, fakeTest, result, resultCallback };
}

function immediateDialogOptions(actor, extra = {}) {
  return {
    actor,
    stat: 13,
    skill: 0,
    label: "Budowa",
    isSkill: false,
    skillKey: "",
    currentAttribute: "constitution",
    lastRoll: {
      modifier: 0,
      baseDifficulty: "average",
      useArmorPenalty: true,
      useWoundPenalty: true,
      useDiseasePenalty: true,
      useEffectPenalty: true,
      isOpen: true,
      rollMode: "publicroll"
    },
    ...extra
  };
}

test("SkillRollDialog.wait resolves the real prompt pipeline and keeps resultCallback", async () => {
  const { actor, result } = immediateRollActor();
  let legacyPayload = null;
  let legacyCompleted = false;
  const originalRender = NeuroshimaSkillRollDialog.prototype.render;
  NeuroshimaSkillRollDialog.prototype.render = function() {
    queueMicrotask(() => this._onRoll().catch(() => {}));
    return this;
  };

  try {
    const payload = await NeuroshimaSkillRollDialog.wait(immediateDialogOptions(actor, {
      resultCallback: async value => {
        await Promise.resolve();
        legacyPayload = value;
        legacyCompleted = true;
      }
    }));
    assert.equal(legacyCompleted, true);
    assert.equal(payload.cancelled, false);
    assert.equal(payload.success, true);
    assert.equal(payload.successPoints, 2);
    assert.equal(payload.result, result);
    assert.equal(legacyPayload, payload);
  } finally {
    NeuroshimaSkillRollDialog.prototype.render = originalRender;
  }
});

test("SkillRollDialog.wait resolves null only for a real cancellation", async () => {
  const { actor } = immediateRollActor();
  const originalRender = NeuroshimaSkillRollDialog.prototype.render;
  NeuroshimaSkillRollDialog.prototype.render = function() {
    queueMicrotask(() => this.close());
    return this;
  };
  try {
    assert.equal(await NeuroshimaSkillRollDialog.wait(immediateDialogOptions(actor)), null);
  } finally {
    NeuroshimaSkillRollDialog.prototype.render = originalRender;
  }
});

test("closing a submitted SkillRollDialog cannot turn an in-flight roll into cancellation", async () => {
  let releaseRoll;
  let rollStarted = false;
  const rollGate = new Promise(resolve => { releaseRoll = resolve; });
  const { actor } = immediateRollActor({
    rollImpl: async () => {
      rollStarted = true;
      await rollGate;
    }
  });
  const originalRender = NeuroshimaSkillRollDialog.prototype.render;
  NeuroshimaSkillRollDialog.prototype.render = function() {
    queueMicrotask(() => this._onRoll().catch(() => {}));
    return this;
  };

  try {
    let settled = false;
    const pending = NeuroshimaSkillRollDialog.wait(immediateDialogOptions(actor))
      .then(value => { settled = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rollStarted, true);
    assert.equal(settled, false);
    releaseRoll();
    assert.equal((await pending).successPoints, 2);
  } finally {
    NeuroshimaSkillRollDialog.prototype.render = originalRender;
  }
});

test("SkillRollDialog.wait rejects when test.roll throws", async () => {
  const expected = new Error("roll failed");
  const { actor } = immediateRollActor({ rollImpl: async () => { throw expected; } });
  const originalRender = NeuroshimaSkillRollDialog.prototype.render;
  NeuroshimaSkillRollDialog.prototype.render = function() {
    queueMicrotask(() => this._onRoll().catch(() => {}));
    return this;
  };
  try {
    await assert.rejects(
      NeuroshimaSkillRollDialog.wait(immediateDialogOptions(actor)),
      /roll failed/
    );
  } finally {
    NeuroshimaSkillRollDialog.prototype.render = originalRender;
  }
});

test("rollTest actorOwner routes an MG-created immediate roll to the active player owner", async () => {
  const gm = game.user;
  const player = { id: "player", name: "Player", active: true, isGM: false, character: { id: "actor" } };
  const originalUsers = game.users;
  const originalExecuteAsUser = NeuroshimaSocket.executeAsUser;
  const users = [gm, player];
  users.has = id => users.some(user => user.id === id);
  users.get = id => users.find(user => user.id === id);
  game.users = users;
  const actor = {
    ...actorFixture(),
    documentName: "Actor",
    name: "Owned actor",
    type: "character",
    system: {
      attributeTotals: { constitution: 13 },
      attributes: { constitution: 12 },
      skills: {},
      combat: {}
    },
    testUserPermission(user) { return user.id === player.id; }
  };
  let routed;
  NeuroshimaSocket.executeAsUser = async (action, userId, request) => {
    routed = { action, userId, request };
    return {
      status: "rolled",
      value: {
        cancelled: false,
        success: true,
        isSuccess: true,
        successPoints: 2,
        successes: 2,
        type: "attribute",
        attributeKey: "constitution",
        skillKey: null,
        difficulty: "average",
        isOpen: true,
        test: null,
        result: null
      }
    };
  };

  try {
    const result = await new NeuroshimaScript({}, null)
      .rollAttributeTest("constitution", { actor });
    assert.equal(routed.action, "rollTest:prompt");
    assert.equal(routed.userId, player.id);
    assert.equal(routed.request.actorUuid, actor.uuid);
    assert.equal(result.successPoints, 2);
    assert.equal(result.test, null);
    assert.equal(result.result, null);
    assert.doesNotThrow(() => structuredClone(result));
  } finally {
    game.users = originalUsers;
    NeuroshimaSocket.executeAsUser = originalExecuteAsUser;
  }
});

test("socket rollTest handler strips test documents from its response", async () => {
  const actor = {
    ...actorFixture(),
    documentName: "Actor",
    name: "Remote actor",
    type: "character"
  };
  documents.set(actor.uuid, actor);
  const originalWait = NeuroshimaSkillRollDialog.wait;
  const circularTest = { result: { success: true, successPoints: 4 } };
  circularTest.self = circularTest;
  NeuroshimaSkillRollDialog.wait = async () => ({
    success: true,
    isSuccess: true,
    successPoints: 4,
    test: circularTest,
    result: circularTest.result
  });
  try {
    const response = await NeuroshimaRollTestRouter._handleSocketRequest({
      actorUuid: actor.uuid,
      type: "attribute",
      attributeKey: "constitution",
      skillKey: null,
      stat: 13,
      skill: 0,
      label: "Budowa",
      difficulty: "problematic",
      modifier: 0,
      useArmorPenalty: true,
      useWoundPenalty: true,
      useDiseasePenalty: true,
      useEffectPenalty: true,
      isOpen: true,
      rollMode: "publicroll",
      testType: "attribute",
      testSubtype: null
    });
    assert.equal(response.status, "rolled");
    assert.equal(response.value.test, null);
    assert.equal(response.value.result, null);
    assert.equal(response.value.difficulty, "problematic");
    assert.doesNotThrow(() => structuredClone(response));
  } finally {
    documents.delete(actor.uuid);
    NeuroshimaSkillRollDialog.wait = originalWait;
  }
});

test("creature experience roll requires an explicit attribute", async () => {
  const actor = {
    ...actorFixture(),
    documentName: "Actor",
    name: "Creature",
    type: "creature",
    system: { attributeTotals: { perception: 12 }, attributes: { perception: 10 }, experience: 4, skills: {} }
  };
  await assert.rejects(
    new NeuroshimaScript({}, null).rollSkillTest("experience", { actor, recipient: "executor" }),
    /nieprawidłowy Współczynnik/
  );
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

test("reputation and fame tooltips collect exact Actor and Item effect paths", () => {
  const actor = {
    appliedEffects: new Set([{
      uuid: "Actor.actor.ActiveEffect.reputation",
      name: "Znana twarz",
      changes: [
        { key: "system.reputationBonus", value: "2", mode: 2 },
        { key: "system.fameBonus", value: "1", mode: 2 }
      ]
    }]),
    effects: [],
    items: []
  };
  const reputation = {
    effects: [{
      uuid: "Actor.actor.Item.rep.ActiveEffect.value",
      name: "Wróg Posterunku",
      changes: [{ key: "system.value", value: "-3", mode: 2 }]
    }]
  };

  const actorSources = collectDocumentEffectSources(actor, [
    "system.reputationBonus",
    "system.fameBonus"
  ]);
  const itemSources = collectDocumentEffectSources(reputation, ["system.value"]);

  assert.deepEqual(
    actorSources["system.reputationBonus"].map(source => [source.label, source.value]),
    [["Znana twarz", 2]]
  );
  assert.deepEqual(
    actorSources["system.fameBonus"].map(source => [source.label, source.value]),
    [["Znana twarz", 1]]
  );
  assert.deepEqual(
    itemSources["system.value"].map(source => [source.label, source.value]),
    [["Wróg Posterunku", -3]]
  );
});

test("effect penalty tooltip uses applicable sources but the prepared value as total", () => {
  const actor = {
    system: { combat: { effectPenalty: -15 } },
    items: [],
    allApplicableEffects() {
      return [
        {
          uuid: "Actor.actor.Item.trait.ActiveEffect.enabled",
          name: "Odporność chemiczna",
          changes: [{ key: "system.combat.effectPenalty", value: "-10", mode: 2 }]
        },
        {
          uuid: "Actor.actor.ActiveEffect.disabled",
          name: "Wyłączony efekt",
          disabled: true,
          changes: [{ key: "system.combat.generalPenalty", value: "50", mode: 2 }]
        }
      ];
    }
  };
  const dialog = new NeuroshimaRollDialogBase({ actor });
  assert.equal(dialog._computeActorEffectPenalty(), -15);
  assert.deepEqual(
    dialog._getActorEffectPenaltySources().map(source => [source.label, source.value]),
    [["Odporność chemiczna", -10]]
  );

  const input = { dataset: {} };
  dialog._applyTooltips({
    querySelector(selector) {
      return selector === '[name="effectPenalty"]' ? input : null;
    }
  });
  assert.match(input.dataset.tooltipHtml, /Odporność chemiczna/);
  assert.match(input.dataset.tooltipHtml, /-15%/);
  assert.doesNotMatch(input.dataset.tooltipHtml, /Wyłączony efekt/);
});

test("healing test keeps effect penalties as a distinct editable category", () => {
  const wound = { uuid: "Actor.patient.Item.wound" };
  const test = HealingTest.forWound({
    medicActor: {
      system: {
        attributeTotals: { dexterity: 12 },
        skills: { firstAid: { value: 3 } }
      }
    },
    patientActor: {
      uuid: "Actor.patient",
      items: { get: () => wound }
    },
    healingMethod: "firstAid",
    woundConfig: {
      woundId: "wound",
      woundName: "Rana",
      difficulty: "average",
      modifier: 20,
      effectPenalty: -10
    }
  });

  assert.equal(test.preData.penalties.effects, -10);
  assert.equal(test.preData.penalties.mod, 20);
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

test("dialog scripts add and subtract the dedicated effect penalty with source breakdown", async () => {
  const actor = {
    ...actorFixture(),
    name: "Effect penalty tester",
    system: { combat: { effectPenalty: 10 } }
  };
  const script = {
    effect: { id: "effect-penalty", parent: null },
    label: "Warunki pogodowe",
    code: "effect penalty",
    targeter: false,
    isDialogScript: false,
    async evalHide() {
      return false;
    },
    async evalActivate() {
      return true;
    },
    async execute(args) {
      args.fields.effectPenalty += 20;
      args.fields.effectPenalty -= 5;
    }
  };
  const originalGetScripts = NeuroshimaScriptRunner.getScripts;
  NeuroshimaScriptRunner.getScripts = (_actor, trigger) => trigger === "dialog" ? [script] : [];
  try {
    const result = await NeuroshimaScriptRunner.computeDialogFields(actor, { rollType: "skill" });
    assert.equal(result.scriptFields.effectPenalty, 15);
    assert.deepEqual(result.effectPenaltyBreakdown, [
      { label: "Warunki pogodowe", value: 15 }
    ]);

    const dialog = new NeuroshimaRollDialogBase({ actor });
    dialog._scriptFields = result.scriptFields;
    dialog._breakdown.effect = result.effectPenaltyBreakdown;
    assert.equal(dialog._computeDialogEffectPenalty(), 25);
  } finally {
    NeuroshimaScriptRunner.getScripts = originalGetScripts;
  }
});

test("reputation dialog scripts receive roll context and dedicated value fields", async () => {
  const actor = {
    ...actorFixture(),
    name: "Reputation Tester",
    system: { combat: {} }
  };
  const script = {
    effect: { id: "reputation-effect", parent: null },
    label: "Reputation modifier",
    code: "reputation",
    targeter: false,
    isDialogScript: false,
    async evalHide(args) {
      assert.equal(args.rollType, "reputation");
      assert.equal(args.subtype, "skill");
      assert.deepEqual(args.reputation, { bonus: 1, value: 4, fame: 2 });
      return false;
    },
    async evalActivate() {
      return true;
    },
    async execute(args) {
      assert.equal(args.rollType, "reputation");
      assert.equal(args.subtype, "skill");
      assert.deepEqual(args.reputation, { bonus: 1, value: 4, fame: 2 });
      args.fields.repBonus += 2;
      args.fields.repValue += 3;
      args.fields.fame += 1;
    }
  };
  const originalGetScripts = NeuroshimaScriptRunner.getScripts;
  NeuroshimaScriptRunner.getScripts = (_actor, trigger) => trigger === "dialog" ? [script] : [];
  try {
    const result = await NeuroshimaScriptRunner.computeDialogFields(
      actor,
      {
        rollType: "reputation",
        subtype: "skill",
        repBonus: 1,
        repValue: 4,
        fame: 2,
        reputation: { bonus: 1, value: 4, fame: 2 },
        difficulty: "average"
      }
    );
    assert.equal(result.scriptFields.repBonus, 2);
    assert.equal(result.scriptFields.repValue, 3);
    assert.equal(result.scriptFields.fame, 1);
    assert.equal(result.reputationBreakdown.repBonus[0].value, 2);
    assert.equal(result.reputationBreakdown.repValue[0].value, 3);
    assert.equal(result.reputationBreakdown.fame[0].value, 1);
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

test("percentile chat displays a signed threshold margin without negative successPoints", async () => {
  const percentile = new PercentileTest({
    preData: { target: 50, fixedDice: [67] },
    context: { isDebug: true }
  }, actorFixture());

  await percentile.roll({ sendToChat: false });
  const chatData = await percentile.getChatData();

  assert.equal(percentile.result.success, false);
  assert.equal(percentile.result.successPoints, 0);
  assert.equal(percentile.result.thresholdMargin, -17);
  assert.equal(chatData.displaySuccessPoints, -17);
  assert.match(chatData.dataTooltip, /-17/);
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

test("addSuccessPoints reconciles closed test success", async () => {
  const instance = new SkillTest({
    preData: {
      stat: 10,
      skill: 0,
      fixedDice: [10, 11, 12],
      applySkillDifficultyShift: false,
      applyDiceDifficultyShift: false
    },
    context: { isDebug: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  assert.equal(instance.result.successPoints, 1);
  assert.equal(instance.result.success, false);
  instance.addSuccessPoints(1);
  await instance.recalculate();
  assert.equal(instance.result.successPoints, 2);
  assert.equal(instance.result.success, true);
  assert.equal(instance.result.isSuccess, true);
});

test("addSuccessPoints updates open test result", async () => {
  const instance = new SkillTest({
    preData: { stat: 1, skill: 0, fixedDice: [10, 11], isOpen: true },
    context: { isDebug: true, isOpen: true }
  }, actorFixture());
  await instance.roll({ sendToChat: false });
  instance.addSuccessPoints(1);
  await instance.recalculate();
  assert.equal(instance.result.successPoints, 1);
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

test("result action description becomes a rich chat tooltip with actor roll data", async () => {
  const previousUx = foundry.applications.ux;
  let enrichmentOptions = null;
  foundry.applications.ux = {
    TextEditor: {
      async enrichHTML(value, options) {
        enrichmentOptions = options;
        return `<p>${value}</p>`;
      }
    }
  };

  try {
    const effect = {
      uuid: "Actor.actor.ActiveEffect.effect",
      name: "Efekt",
      img: "effect.webp",
      origin: null,
      parent: { documentName: "Actor" }
    };
    const action = {
      id: "amen",
      type: "result",
      name: "Amen",
      description: "Zamienia wybraną kość."
    };
    const actor = {
      getRollData: () => ({ attributeTotals: { perception: 12 } })
    };

    const ref = await EffectActionRuntime._reference(
      effect,
      action,
      EffectActionRuntime.SURFACE_TEST,
      actor,
      { successPoints: 2 }
    );

    assert.match(ref.tooltipHtml, /ns-roll-tooltip/);
    assert.match(ref.tooltipHtml, /Amen/);
    assert.match(ref.tooltipHtml, /Zamienia wybraną kość/);
    assert.equal(enrichmentOptions.rollData.actor.attributeTotals.perception, 12);
    assert.equal(enrichmentOptions.rollData.test.successPoints, 2);
  } finally {
    foundry.applications.ux = previousUx;
  }
});

test("result action dice wrapper calls the base replace method once", () => {
  const replacements = [];
  const diceApi = {
    replace(index, value, options) {
      replacements.push({ index, value, options });
      return true;
    },
    copy() {},
    rolled: [1, 12, 18],
    raw: [1, 12, 18],
    modified: []
  };
  const ctx = EffectActionRuntime._context({
    actor: actorFixture(),
    effect: { uuid: "ActiveEffect.amen", name: "Amen" },
    sourceItem: null,
    action: { id: "amen", name: "Amen" },
    rollData: {
      rolledResults: [1, 12, 18],
      rawResults: [1, 12, 18],
      modifiedResults: []
    },
    surface: EffectActionRuntime.SURFACE_TEST,
    message: { id: "message" },
    test: {},
    diceApi,
    resultApi: {}
  });

  ctx.dice.replace(1, 1, { icon: "fas fa-cross" });
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].index, 1);
  assert.equal(replacements[0].value, 1);
  assert.equal(replacements[0].options.effectUuid, "ActiveEffect.amen");
});

test("result action choose uses dice marked on the roll card without a dialog", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    _nsRerollSelectedMap: new Map([
      ["message", new Set([1])]
    ])
  };

  try {
    const selected = await EffectActionRuntime.chooseSelectedDice(
      { id: "message" },
      {
        rolledResults: [1, 12, 18],
        rawResults: [1, 12, 18],
        modifiedResults: [
          { original: 1, modified: 1, isSuccess: true },
          { original: 12, modified: 12, isSuccess: false },
          { original: 18, modified: 18, isSuccess: false }
        ]
      },
      {
        min: 1,
        max: 1,
        filter: die => die.rolled !== 1
      }
    );
    assert.deepEqual(selected, [1]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
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

test("attacker roll creates one pending opposed message", async () => {
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
    result: { modifiedResults: [], successPoints: 1, target: 10 },
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

test("defender roll creates a new duel message after its source roll", async () => {
  const data = {
    id: "opp", status: "awaitingDefender",
    attackerUuid: "Actor.attacker", defenderUuid: "Actor.defender",
    attackerTestMessageId: "attack-test",
    attackerRevision: "atk-rev",
    mode: "opposedSuccesses"
  };
  const pendingMessage = opposedMessage("pending", data);
  game.messages.set(pendingMessage.id, pendingMessage);
  const attackerTest = {
    message: { id: "attack-test" },
    context: {
      opposedLink: {
        type: "meleeOpposed", opposedId: "opp",
        duelMessageId: pendingMessage.id, role: "attacker", revision: "atk-rev"
      }
    },
    async updateMessage(message) { return message; }
  };
  const defenderTest = {
    message: { id: "defense-test" },
    context: { opposedLink: { revision: "def-rev" } },
    result: {},
    async updateMessage(message) { return message; }
  };
  const originalRefresh = MeleeOpposedChat.refreshOpposedMessage;
  const originalRemove = MeleeOpposedChat._removePending;
  const originalUnset = MeleeOpposedChat._unsetDefenderFlag;
  const originalGet = MeleeOpposedChat.getLinkedTest;
  const originalCreate = ChatMessage.create;
  const duelMessage = opposedMessage("actual-duel", {});
  let refreshes = 0;
  let creates = 0;
  MeleeOpposedChat.getLinkedTest = async () => attackerTest;
  ChatMessage.create = async createData => {
    creates++;
    await duelMessage.update({
      content: createData.content,
      "flags.neuroshima.opposedChat": createData.flags.neuroshima.opposedChat
    });
    return duelMessage;
  };
  MeleeOpposedChat.refreshOpposedMessage = async id => {
    refreshes++;
    assert.equal(id, duelMessage.id);
    return { ok: true, status: "duel" };
  };
  MeleeOpposedChat._removePending = async () => {};
  MeleeOpposedChat._unsetDefenderFlag = async () => {};
  try {
    await MeleeOpposedChat.attachDefenderTest(pendingMessage.id, defenderTest);
    assert.equal(creates, 1);
    assert.equal(refreshes, 1);
    assert.equal(
      pendingMessage.getFlag("neuroshima", "opposedChat").resultMessageId,
      duelMessage.id
    );
    assert.equal(attackerTest.context.opposedLink.duelMessageId, duelMessage.id);
    assert.equal(defenderTest.context.opposedLink.duelMessageId, duelMessage.id);
  } finally {
    MeleeOpposedChat.refreshOpposedMessage = originalRefresh;
    MeleeOpposedChat._removePending = originalRemove;
    MeleeOpposedChat._unsetDefenderFlag = originalUnset;
    MeleeOpposedChat.getLinkedTest = originalGet;
    ChatMessage.create = originalCreate;
    game.messages.delete(pendingMessage.id);
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
      return { success: true, successPoints: role === "attack" ? 2 : 1, dice: [] };
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
  const fake = successPoints => ({
    context: {},
    opposedResult: { successPoints, dice: [] },
    async runTrigger(name, metadata) { events.push([name, metadata.preview]); }
  });
  const resolver = new MeleeOpposedResolver(fake(2), fake(1));
  await resolver.resolve({ preview: true });
  assert.deepEqual(events.map(([name]) => name), ["preOpposedAttacker", "preOpposedDefender"]);
  assert.ok(events.every(([, preview]) => preview === true));
});

test("melee opposed resolver compares only canonical successPoints", () => {
  const fake = successPoints => ({
    context: {},
    opposedResult: { success: successPoints > 0, successPoints, dice: [] }
  });
  const result = new MeleeOpposedResolver(
    fake(3),
    fake(1),
    { mode: "opposedSuccesses" }
  ).evaluate();
  assert.equal(result.winner, "attacker");
  assert.equal(result.difference, 2);
  assert.equal(result.mode, "opposedSuccessPoints");
  assert.equal("successes" in result.attacker, false);
  assert.equal("successes" in result.defender, false);
});

test("opposed finalization runs result triggers once", async () => {
  const message = opposedMessage("final-duel", {
    id: "opp", status: "duel", mode: "opposedSuccesses",
    attackerTestMessageId: "a", defenderTestMessageId: "d",
    attackerRevision: "ar", defenderRevision: "dr"
  });
  const events = [];
  const fake = successPoints => ({
    context: {},
    opposedResult: { successPoints, dice: [] },
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

test("Grad Ciosow reuses the created duel result message", async () => {
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

test("skill allocation reuses the created duel result message", async () => {
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
