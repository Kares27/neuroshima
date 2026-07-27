import { NEUROSHIMA } from "./config.js";

export const DIFFICULTY_ORDER = Object.freeze([
  "easy", "average", "problematic", "hard", "veryHard",
  "damnHard", "luck", "masterful", "grandmasterful"
]);

export class TestRules {
  static difficultyFromPercent(percent) {
    const value = Number(percent ?? 0);
    const found = Object.values(NEUROSHIMA.difficulties)
      .find(difficulty => value >= difficulty.min && value <= difficulty.max);
    if (found) return found;
    return value < 0 ? NEUROSHIMA.difficulties.easy : NEUROSHIMA.difficulties.grandmasterful;
  }

  static skillShift(skill) {
    const value = Number(skill ?? 0);
    return value <= 0 ? -1 : Math.floor(value / 4);
  }

  static diceShift(results = []) {
    return results.reduce((shift, result) => {
      if (Number(result) === 1) return shift - 1;
      if (Number(result) === 20) return shift + 1;
      return shift;
    }, 0);
  }

  static shiftDifficulty(base, shift = 0) {
    const key = DIFFICULTY_ORDER.find(entry => NEUROSHIMA.difficulties[entry] === base)
      ?? DIFFICULTY_ORDER.find(entry => NEUROSHIMA.difficulties[entry]?.label === base?.label)
      ?? "average";
    const index = Math.clamp(DIFFICULTY_ORDER.indexOf(key) + Number(shift ?? 0), 0, DIFFICULTY_ORDER.length - 1);
    return NEUROSHIMA.difficulties[DIFFICULTY_ORDER[index]];
  }

  static clampMaximumDifficulty(difficulty, maximumDifficulty) {
    if (!difficulty || !maximumDifficulty) return difficulty;
    const maximumIndex = DIFFICULTY_ORDER.indexOf(maximumDifficulty);
    const currentIndex = DIFFICULTY_ORDER.findIndex(key =>
      NEUROSHIMA.difficulties[key] === difficulty
      || NEUROSHIMA.difficulties[key]?.label === difficulty.label
    );
    return maximumIndex >= 0 && currentIndex > maximumIndex
      ? NEUROSHIMA.difficulties[maximumDifficulty]
      : difficulty;
  }
}

function diceObjects(results = []) {
  return results.map((value, index) => ({
    original: Number(value),
    modified: Number(value),
    index,
    ignored: false,
    isSuccess: false,
    isNat1: Number(value) === 1,
    isNat20: Number(value) === 20
  }));
}

function evaluateClosed3d20(data, results) {
  const dice = diceObjects(results);
  const target = Number(data.target ?? 0);
  const skill = Number(data.skill ?? 0);
  const reduction = Number(data.dieReductionBonus ?? 0);
  const sorted = [...dice].map(die => ({
    ...die,
    cost: die.original <= target ? 0 : (die.original === 20 ? 999 : die.original - target)
  })).sort((a, b) => a.cost - b.cost);
  let pool = skill + reduction;
  for (const die of sorted) {
    if (die.original === 20) continue;
    const spent = Math.min(pool, die.cost, Math.max(0, die.original - 1));
    pool -= spent;
    die.modified = die.original - spent;
    die.isSuccess = die.modified <= target;
  }
  const byIndex = sorted.sort((a, b) => a.index - b.index);
  return {
    modifiedResults: byIndex,
    successCount: byIndex.filter(die => die.isSuccess).length,
    success: byIndex.filter(die => die.isSuccess).length >= 2,
    successPoints: byIndex.filter(die => die.isSuccess).length,
    skillUsed: skill + reduction - pool,
    remainingSkill: Math.max(0, skill - (skill + reduction - pool)),
    isCritSuccess: byIndex.every(die => die.isSuccess),
    isCritFailure: byIndex.every(die => !die.isSuccess) && byIndex.some(die => die.isNat20)
  };
}

function evaluateDefense3d20(data, results) {
  const target = Number(data.target ?? 0);
  const modifiedResults = diceObjects(results).map(die => ({
    ...die,
    isSuccess: die.original <= target && die.original !== 20
  }));
  const successCount = modifiedResults.filter(die => die.isSuccess).length;
  return {
    modifiedResults,
    successCount,
    successPoints: successCount,
    success: successCount >= 2,
    isCritSuccess: successCount === modifiedResults.length,
    isCritFailure: successCount === 0 && modifiedResults.some(die => die.isNat20)
  };
}

function evaluateOpen3d20(data, results) {
  if (![2, 3].includes(results.length)) {
    throw new RangeError("Open tests require exactly two or three dice");
  }
  const target = Number(data.target ?? 0);
  const skill = Number(data.skill ?? 0);
  const reduction = Number(data.dieReductionBonus ?? 0);
  const dice = diceObjects(results);
  const active = [...dice].sort((a, b) => a.original - b.original).slice(0, 2);
  if (dice.length === 3) {
    const ignored = dice.find(die => !active.includes(die));
    if (ignored) ignored.ignored = true;
  }
  for (const die of active) {
    die.modified = Math.max(1, die.original - skill - reduction);
    die.isSuccess = die.modified <= target && die.original !== 20;
  }
  const successCount = active.filter(die => die.isSuccess).length;
  const successPoints = active.reduce((sum, die) =>
    sum + (die.isSuccess ? Math.max(0, target - die.modified + 1) : 0), 0);
  return {
    modifiedResults: dice.sort((a, b) => a.index - b.index),
    successCount,
    successPoints,
    success: successCount > 0,
    isCritSuccess: active.some(die => die.isNat1),
    isCritFailure: active.every(die => die.isNat20)
  };
}

function evaluateRangedAttack(data, results) {
  const target = Number(data.target ?? 0);
  const skill = Number(data.skill ?? 0);
  const reduction = Number(data.dieReductionBonus ?? 0);
  const bestResult = Math.min(...results.map(Number));
  const modifiedBest = Math.max(1, bestResult - skill - reduction);
  const overflow = target - modifiedBest;
  const success = data.isOpen ? overflow >= 0 : modifiedBest <= target && bestResult !== 20;
  return {
    bestResult,
    modifiedResults: results.map((value, index) => {
      const modified = Math.max(1, Number(value) - skill - reduction);
      return {
        original: Number(value), modified, index,
        isSuccess: data.isOpen ? target - modified >= 0 : modified <= target && Number(value) !== 20,
        isBest: Number(value) === bestResult,
        isNat1: Number(value) === 1,
        isNat20: Number(value) === 20,
        ignored: false
      };
    }),
    success,
    successCount: success ? (data.isOpen ? Math.max(1, overflow + 1) : 1) : 0,
    successPoints: success ? Math.max(1, overflow + 1) : 0,
    isCritSuccess: bestResult === 1,
    isCritFailure: bestResult === 20
  };
}

function clone(value) {
  return foundry.utils.deepClone(value ?? {});
}

export class NeuroshimaTestBase {
  static tooltipFromResult(result = {}) {
    const penalties = result.penalties ?? {};
    return [
      `<strong>${game.i18n.localize("NEUROSHIMA.Attributes.Attributes")}:</strong> ${result.baseStat ?? result.stat ?? 0}`,
      `<strong>${game.i18n.localize("NEUROSHIMA.Items.Fields.Skill")}:</strong> ${result.baseSkill ?? result.skill ?? 0}`,
      `<strong>${game.i18n.localize("NEUROSHIMA.Roll.TotalModifier")}:</strong> ${result.totalPenalty ?? result.penalty ?? 0}%`,
      `<strong>${game.i18n.localize("NEUROSHIMA.Roll.Target")}:</strong> ${result.testTarget ?? result.target ?? 0}`,
      Object.entries(penalties).filter(([, value]) => Number(value) !== 0)
        .map(([key, value]) => `${key}: ${value}%`).join("<br>")
    ].filter(Boolean).join("<br>");
  }

  constructor(data = {}, actor = null) {
    this.actor = actor ?? data.actor ?? null;
    this.item = data.item ?? null;
    this.targets = Array.from(data.targets ?? []);
    this.diceRoll = null;
    const attribute = data.attribute ?? {};
    const skill = data.skill ?? {};
    this.data = {
      preData: {
        rollClass: this.constructor.name,
        actorUuid: this.actor?.uuid ?? null,
        itemUuid: this.item?.uuid ?? null,
        targetUuids: this.targets.map(target => target?.uuid ?? target).filter(Boolean),
        cancelled: false,
        annotations: [],
        stat: Number(attribute.value ?? data.preData?.stat ?? 0),
        skill: Number(skill.value ?? data.preData?.skill ?? 0),
        attributeKey: attribute.key ?? data.preData?.attributeKey ?? null,
        skillKey: skill.key ?? data.preData?.skillKey ?? null,
        ...clone(data.preData)
      },
      result: {
        rawResults: [],
        rolledResults: [],
        modifiedResults: [],
        success: false,
        successCount: 0,
        successPoints: 0,
        isCritSuccess: false,
        isCritFailure: false,
        annotations: [],
        ...clone(data.result)
      },
      context: {
        rollMode: null,
        reroll: false,
        edited: false,
        previousResult: null,
        previousMessageId: null,
        dirty: false,
        ...clone(data.context)
      }
    };
  }

  static fromData(data, actor = null) {
    return new this(data, actor);
  }

  static async recreate(data) {
    const rollClass = data?.preData?.rollClass;
    if (!rollClass) throw new Error("Serialized test has no preData.rollClass");
    const TestClass = game.neuroshima.tests?.[rollClass];
    if (typeof TestClass !== "function"
      || !(TestClass === NeuroshimaTestBase || TestClass.prototype instanceof NeuroshimaTestBase)) {
      throw new Error(`Unknown Neuroshima test class: ${rollClass}`);
    }
    const actor = data.preData.actorUuid ? await fromUuid(data.preData.actorUuid) : null;
    const item = data.preData.itemUuid ? await fromUuid(data.preData.itemUuid) : null;
    const targets = (await Promise.all(
      (data.preData.targetUuids ?? []).map(uuid => fromUuid(uuid))
    )).filter(Boolean);
    const test = TestClass.fromData({
      preData: clone(data.preData),
      result: clone(data.result),
      context: clone(data.context),
      item,
      targets
    }, actor);
    await test.restoreDocuments();
    return test;
  }

  get preData() { return this.data.preData; }
  get result() { return this.data.result; }
  get context() { return this.data.context; }
  get rollClass() { return this.constructor.name; }
  get itemUuid() { return this.item?.uuid ?? this.preData.itemUuid ?? null; }
  get messageType() { return "roll"; }
  get chatTemplate() { return "systems/neuroshima/templates/chat/roll-card.hbs"; }

  async restoreDocuments() {}

  cancel(reason = null) {
    this.preData.cancelled = true;
    this.context.cancelReason = reason;
  }

  markDirty(reason = null) {
    this.context.dirty = true;
    if (reason) (this.context.dirtyReasons ??= []).push(reason);
  }

  forceSuccess({ mode = "keepRoll", annotation = null } = {}) {
    this.preData.resultModifiers ??= {};
    this.preData.resultModifiers.forcedSuccess = true;
    if (mode === "skipRoll") this.preData.skipRoll = true;
    if (annotation) this.annotate(annotation);
    this.markDirty("forceSuccess");
  }

  forceFailure() {
    this.preData.resultModifiers ??= {};
    this.preData.resultModifiers.forcedSuccess = false;
    this.markDirty("forceFailure");
  }

  addSuccesses(amount) {
    this.preData.resultModifiers ??= {};
    this.preData.resultModifiers.successes =
      Number(this.preData.resultModifiers.successes ?? 0) + Number(amount ?? 0);
    this.markDirty("addSuccesses");
  }

  addSuccessPoints(amount) {
    this.preData.resultModifiers ??= {};
    this.preData.resultModifiers.successPoints =
      Number(this.preData.resultModifiers.successPoints ?? 0) + Number(amount ?? 0);
    this.markDirty("addSuccessPoints");
  }

  replaceDie(index, value, details = {}) {
    index = Number(index);
    if (!Number.isInteger(index) || index < 0 || index >= this.result.rawResults.length) return false;
    const next = Math.clamp(Number(value), 1, 20);
    const oldValue = this.result.rawResults[index];
    if (!Number.isFinite(next) || oldValue === next) return false;
    this.result.rawResults[index] = next;
    (this.result.diceChanges ??= []).push({
      type: details.type ?? "replace",
      targetIndex: index,
      sourceIndex: details.sourceIndex ?? null,
      oldValue,
      newValue: next,
      label: details.label ?? "",
      icon: details.icon ?? "fas fa-pen",
      effectUuid: details.effectUuid ?? null
    });
    this.markDirty("replaceDie");
    return true;
  }

  annotate(text) {
    const annotation = String(text ?? "").trim();
    if (!annotation) return false;
    (this.result.annotations ??= []).push(annotation);
    return true;
  }

  applyResultModifiers() {
    const modifiers = this.preData.resultModifiers ?? {};
    this.result.successCount = Math.max(
      0, Number(this.result.successCount ?? 0) + Number(modifiers.successes ?? 0)
    );
    this.result.successPoints = Math.max(
      0, Number(this.result.successPoints ?? 0) + Number(modifiers.successPoints ?? 0)
    );
    if (modifiers.forcedSuccess !== undefined) {
      this.result.success = modifiers.forcedSuccess === true;
    }
    this.result.isSuccess = this.result.success === true;
  }

  triggerArgs() {
    return {
      actor: this.actor,
      item: this.item,
      test: this,
      context: this.context,
      eventContext: {}
    };
  }

  async runTrigger(trigger, metadata = {}) {
    if (!this.actor || this.context.isDebug) return;
    return game.neuroshima.NeuroshimaScriptRunner.executeEvent(
      trigger,
      this.triggerArgs(),
      {
        metadata: {
          test: this,
          item: this.item,
          reroll: this.context.reroll === true,
          edited: this.context.edited === true,
          ...metadata
        }
      }
    );
  }

  runSyncTrigger(trigger, metadata = {}, args = this.triggerArgs()) {
    if (!this.actor || this.context.isDebug) return;
    return game.neuroshima.NeuroshimaScriptRunner.executeEventSync(
      trigger,
      args,
      {
        metadata: {
          test: this,
          item: this.item,
          reroll: this.context.reroll === true,
          edited: this.context.edited === true,
          ...metadata
        }
      }
    );
  }

  async runPreEffects() {
    await this.runTrigger("preRollTest", { phase: "pre" });
  }

  async runPostEffects() {
    await this.runTrigger("rollTest", { phase: "result" });
  }

  resetResult() {
    const preserved = {
      diceChanges: clone(this.result.diceChanges ?? []),
      effectActions: clone(this.result.effectActions ?? []),
      resultActions: clone(this.result.resultActions ?? [])
    };
    this.data.result = {
      rawResults: [],
      rolledResults: [],
      modifiedResults: [],
      success: false,
      successCount: 0,
      successPoints: 0,
      isCritSuccess: false,
      isCritFailure: false,
      annotations: [...(this.preData.annotations ?? [])],
      ...preserved
    };
  }

  async prepare() { throw new Error(`${this.rollClass}.prepare() is not implemented`); }
  async rollDice() { throw new Error(`${this.rollClass}.rollDice() is not implemented`); }
  async computeResult() { throw new Error(`${this.rollClass}.computeResult() is not implemented`); }
  async resolveDomain() {}

  async recalculate() {
    await this.computeResult();
    await this.resolveDomain();
    this.context.dirty = false;
    return this;
  }

  async postTest() {}

  async roll({ message = null, sendToChat = true } = {}) {
    await this.runPreEffects();
    if (this.preData.cancelled) return this;
    this.resetResult();
    await this.prepare();
    if (this.preData.cancelled) return this;
    if (this.preData.skipRoll) {
      this.result.rawResults = [...(this.preData.fixedDice ?? [])];
      this.result.rolledResults = [...this.result.rawResults];
    } else {
      await this.rollDice();
    }
    await this.computeResult();
    await this.resolveDomain();
    await this.runPostEffects();
    if (this.context.dirty) await this.recalculate();
    await this.postTest();
    if (sendToChat) this.message = await this.sendToChat({ message });
    return this;
  }

  async edit({ preData = {}, rawResults = null } = {}, { message = null } = {}) {
    this.context.previousResult = clone(this.result);
    this.context.edited = true;
    this.context.reroll = false;
    foundry.utils.mergeObject(this.preData, preData, { inplace: true });
    if (Array.isArray(rawResults)) this.preData.fixedDice = [...rawResults];
    return this.roll({ message, sendToChat: true });
  }

  async reroll({ previousMessage = null, replaceMessage = false } = {}) {
    this.context.previousResult = clone(this.result);
    this.context.previousMessageId = previousMessage?.id ?? null;
    this.context.reroll = true;
    this.context.edited = false;
    delete this.preData.fixedDice;
    return this.roll({ message: replaceMessage ? previousMessage : null, sendToChat: true });
  }

  getDataTooltip() {
    return this.constructor.tooltipFromResult(this.result);
  }

  canShowTooltip() {
    const minimum = game.settings.get("neuroshima", "rollTooltipMinRole");
    return game.user.role >= minimum
      || (game.settings.get("neuroshima", "rollTooltipOwnerVisibility") && this.actor?.isOwner);
  }

  async getChatData() {
    return {
      ...clone(this.result),
      config: NEUROSHIMA,
      dataTooltip: this.getDataTooltip(),
      showTooltip: this.canShowTooltip(),
      isGM: game.user.isGM
    };
  }

  async sendToChat({ message = null } = {}) {
    const { NeuroshimaChatMessage } = await import("./documents/chat-message.js");
    return NeuroshimaChatMessage.renderTest(this, { message });
  }

  async updateMessage(message) {
    return this.sendToChat({ message });
  }

  toData() {
    this.preData.rollClass = this.rollClass;
    this.preData.actorUuid = this.actor?.uuid ?? this.preData.actorUuid ?? null;
    this.preData.itemUuid = this.item?.uuid ?? this.preData.itemUuid ?? null;
    this.preData.targetUuids = this.targets.map(target => target?.uuid ?? target).filter(Boolean);
    return clone(this.data);
  }
}

export class NeuroshimaTest extends NeuroshimaTestBase {
  get diceCount() { return 3; }

  async prepare() {
    const penalties = clone(this.preData.penalties ?? {});
    this.result.label = this.preData.label ?? "";
    this.result.baseStat = Number(this.preData.stat ?? 0);
    this.result.baseSkill = Number(this.preData.skill ?? 0);
    this.result.attributeBonus = Number(this.preData.attributeBonus ?? 0);
    this.result.skillBonus = Number(this.preData.skillBonus ?? 0);
    this.result.stat = this.result.baseStat + this.result.attributeBonus;
    this.result.skill = this.result.baseSkill + this.result.skillBonus;
    this.result.penalties = penalties;
    this.result.totalPenalty = Object.values(penalties)
      .reduce((sum, value) => sum + Number(value || 0), 0);
    this.result.baseDifficulty = TestRules.difficultyFromPercent(this.result.totalPenalty);
    this.result.baseDifficultyLabel = this.result.baseDifficulty.label;
    this.result.isOpen = this.preData.isOpen === true || this.context.isOpen === true;
    this.result.isCombat = this.preData.isCombat === true || this.context.isCombat === true;
    this.result.dieManualBonus = Number(this.preData.dieManualBonus ?? 0);
    this.result.dieReductionBonus = Number(this.preData.dieReductionBonus ?? 0);
    this.result.actorId = this.actor?.id ?? null;
    this.result.actorImg = this.actor?.img ?? null;
    this.result.rollMode = this.context.rollMode;
  }

  async rollDice() {
    const fixed = this.preData.fixedDice;
    if (Array.isArray(fixed)) {
      this.result.rawResults = fixed.map(Number);
      this.result.rolledResults = [...this.result.rawResults];
      this.diceRoll = null;
      return;
    }
    this.diceRoll = await new Roll(`${this.diceCount}d20`).evaluate();
    this.result.rawResults = this.diceRoll.terms[0].results.map(result => Number(result.result));
    this.result.rolledResults = [...this.result.rawResults];
  }

  async computeResult() {
    let shift = Number(this.preData.finalDifficultyShift ?? 0);
    if (this.preData.applySkillDifficultyShift !== false
      && this.context.applySkillDifficultyShift !== false) {
      shift -= TestRules.skillShift(this.result.skill);
    }
    if (this.preData.applyDiceDifficultyShift !== false
      && this.context.applyDiceDifficultyShift !== false) {
      shift += TestRules.diceShift(this.result.rawResults);
    }
    const difficulty = TestRules.clampMaximumDifficulty(
      TestRules.shiftDifficulty(this.result.baseDifficulty, shift),
      this.preData.maximumDifficulty
    );
    this.result.finalDifficultyShift = shift;
    this.result.difficultyLabel = difficulty.label;
    this.result.ptMod = difficulty.mod;
    this.result.target = this.result.stat + Number(difficulty.mod ?? 0);
    const evaluated = this.result.isOpen
      ? evaluateOpen3d20(this.result, this.result.rawResults)
      : evaluateClosed3d20(this.result, this.result.rawResults);
    Object.assign(this.result, evaluated);
    this.applyResultModifiers();
    return this;
  }
}

export class AttributeTest extends NeuroshimaTest {
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = "attribute";
  }
}

export class SkillTest extends NeuroshimaTest {
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = "skill";
  }
}

export class HealingTest extends SkillTest {
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = "healing";
    this.patient = data.patient ?? null;
    this.wound = data.wound ?? null;
  }

  get messageType() { return "healing"; }
  get chatTemplate() { return "systems/neuroshima/templates/chat/healing-roll-card.hbs"; }

  static forWound({
    medicActor, patientActor, healingMethod, woundConfig, stat = null,
    skillBonus = 0, attributeBonus = 0, autoSuccess = false, annotations = [],
    dieManualBonus = 0, dieReductionBonus = 0, reroll = false
  }) {
    const skillKey = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
    const wound = patientActor.items?.get(woundConfig.woundId) ?? null;
    const difficulty = NEUROSHIMA.difficulties?.[woundConfig.difficulty || "average"]
      ?? NEUROSHIMA.difficulties.average;
    const test = new this({
      item: wound,
      patient: patientActor,
      wound,
      preData: {
        label: woundConfig.woundName,
        stat: stat ?? Number(medicActor.system.attributeTotals?.dexterity ?? 0),
        skill: Number(medicActor.system.skills?.[skillKey]?.value ?? 0),
        attributeKey: "dexterity",
        skillKey,
        patientUuid: patientActor.uuid,
        woundUuid: wound?.uuid ?? null,
        healingMethod,
        woundConfig: clone(woundConfig),
        penalties: { mod: Number(difficulty.min ?? 0) + Number(woundConfig.modifier ?? 0) },
        skillBonus,
        attributeBonus,
        finalDifficultyShift: Number(woundConfig.failedAttempts ?? 0)
          + Number(woundConfig.difficultyShift ?? 0),
        annotations,
        dieManualBonus,
        dieReductionBonus,
        resultModifiers: autoSuccess ? { forcedSuccess: true } : {}
      },
      context: { reroll, isOpen: false, rollType: "healing" }
    }, medicActor);
    return test;
  }

  async restoreDocuments() {
    this.patient = this.preData.patientUuid ? await fromUuid(this.preData.patientUuid) : null;
    this.wound = this.preData.woundUuid ? await fromUuid(this.preData.woundUuid) : null;
  }

  async getChatData() {
    return {
      ...await super.getChatData(),
      patientRef: { uuid: this.preData.patientUuid },
      medicRef: { uuid: this.preData.actorUuid }
    };
  }

  async resolveDomain() {
    const config = this.preData.woundConfig ?? {};
    const wound = this.wound ?? (this.preData.woundUuid ? await fromUuid(this.preData.woundUuid) : null);
    Object.assign(this.result, {
      woundId: config.woundId ?? wound?.id,
      woundName: config.woundName ?? wound?.name,
      damageType: config.damageType ?? wound?.system?.damageType,
      difficulty: config.difficulty,
      testTarget: this.result.target,
      isSuccess: this.result.success === true,
      finalStat: this.result.stat,
      skillShift: -TestRules.skillShift(this.result.skill),
      diceShift: TestRules.diceShift(this.result.rawResults),
      healingEffect: wound ? this.computeHealingResult(wound, this.result.successCount, config) : null
    });
  }

  computeHealingResult(wound, successCount, config = {}) {
    const success = Number(successCount) >= 2 || this.result.success === true;
    const firstAid = this.preData.healingMethod === "firstAid";
    let change = success ? (firstAid ? -5 : (config.hadFirstAid ? -10 : -15)) : 5;
    change += Number(config.healingModifier ?? 0);
    if (success || game.settings.get("neuroshima", "healingScriptModifierOnFailure")) {
      change += Number(config.scriptHealingModifier ?? 0);
    }
    const oldPenalty = Number(wound.system?.penalty ?? 0);
    const newPenalty = Math.max(0, oldPenalty + change);
    return {
      woundId: wound.id,
      woundName: wound.name,
      damageType: wound.system?.damageType ?? "D",
      oldPenalty,
      newPenalty,
      penaltyChange: newPenalty - oldPenalty,
      wasFullyHealed: newPenalty === 0,
      isSuccess: success
    };
  }
}

export class InitiativeTest extends NeuroshimaTest {
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = "initiative";
    this.combatant = data.combatant ?? null;
  }

  get messageType() { return "initiative"; }
  get chatTemplate() { return "systems/neuroshima/templates/chat/initiative-roll-card.hbs"; }

  async restoreDocuments() {
    this.combatant = this.preData.combatantUuid ? await fromUuid(this.preData.combatantUuid) : null;
  }

  async computeResult() {
    await super.computeResult();
    const args = this.triggerArgs();
    args.initiative = Number(this.result.successPoints ?? 0);
    this.runSyncTrigger("getInitiativeFormula", { phase: "calculate" }, args);
    this.result.initiative = Number(args.initiative ?? this.result.successPoints ?? 0);
    this.result.isInitiative = true;
    return this;
  }

  async postTest() {
    if (!this.combatant || this.context.reroll || this.context.edited
      || this.preData.subtype === "melee") return;
    await this.combatant.update({ initiative: this.result.initiative });
  }

  async getChatData() {
    const data = await super.getChatData();
    data.meleeTargets = (await Promise.all(
      (this.preData.targetUuids ?? []).map(uuid => fromUuid(uuid))
    )).filter(Boolean).map(document => {
      const actor = document.actor ?? document;
      return { id: actor.id, name: actor.name, img: actor.img };
    });
    data.isVanillaMelee = false;
    return data;
  }
}

export class PercentileTest extends NeuroshimaTestBase {
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = "percentile";
  }

  get diceCount() { return 1; }

  async prepare() {
    this.result.label = this.preData.label ?? "";
    this.result.target = Number(this.preData.target ?? this.preData.stat ?? 0);
    this.result.rollMode = this.context.rollMode;
    this.result.actorId = this.actor?.id ?? null;
    this.result.actorImg = this.actor?.img ?? null;
  }

  async rollDice() {
    if (Array.isArray(this.preData.fixedDice)) {
      this.result.rawResults = [Number(this.preData.fixedDice[0])];
      return;
    }
    this.diceRoll = await new Roll("1d100").evaluate();
    this.result.rawResults = [Number(this.diceRoll.total)];
  }

  async computeResult() {
    const value = Number(this.result.rawResults[0] ?? 0);
    const success = value <= Number(this.result.target ?? 0);
    Object.assign(this.result, {
      rolledResults: [value],
      modifiedResults: [{ original: value, modified: value, isSuccess: success, ignored: false, index: 0 }],
      success,
      isSuccess: success,
      successCount: success ? 1 : 0,
      successPoints: Number(this.result.target ?? 0) - value
    });
    this.applyResultModifiers();
    return this;
  }
}

export class ReputationTest extends PercentileTest {
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = "reputation";
  }
}

export class AttackTest extends NeuroshimaTest {
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = data.preData?.type ?? "attack";
  }

  static shiftDamageType(type, steps = 0) {
    const track = String(type ?? "").startsWith("s")
      ? ["sD", "sL", "sC", "sK"]
      : ["D", "L", "C", "K"];
    const index = track.indexOf(type);
    if (index < 0) return type;
    return track[Math.clamp(index + Number(steps ?? 0), 0, track.length - 1)];
  }

  static locationFromRoll(value) {
    return Object.entries(NEUROSHIMA.bodyLocations).find(([, location]) =>
      Array.isArray(location.roll)
      && Number(value) >= location.roll[0]
      && Number(value) <= location.roll[1]
    )?.[0] ?? "torso";
  }

  async computeHitLocation(requested = this.preData.hitLocation ?? "torso") {
    if (requested !== "random") {
      this.result.finalLocation = requested;
      return requested;
    }
    const roll = await new Roll("1d20").evaluate();
    const location = this.constructor.locationFromRoll(roll.total);
    this.result.locationRoll = roll.total;
    this.result.finalLocation = location;
    return location;
  }

  computeMeleeDamageProfiles(location = this.result.finalLocation) {
    const system = this.item?.system ?? {};
    const head = location === "head" ? 1 : 0;
    const base = Number(this.preData.damageShift ?? this.context.damageShift ?? 0);
    const profiles = [1, 2, 3].map(index => {
      const type = system[`damageMelee${index}`]
        || system[`damageMelee${Math.max(1, index - 1)}`]
        || "D";
      return this.constructor.shiftDamageType(
        type,
        base + Number(this.preData[`damageShift${index}`] ?? this.context[`damageShift${index}`] ?? 0) + head
      );
    });
    Object.assign(this.result, {
      damageMelee1: profiles[0],
      damageMelee2: profiles[1],
      damageMelee3: profiles[2],
      damage: profiles.join("/"),
      damageProfilesResolved: true,
      headDamageApplied: head === 1
    });
  }
}

export class WeaponTest extends AttackTest {
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = "weapon";
  }

  get messageType() { return "weapon"; }
  get chatTemplate() {
    return this.result.isMelee
      ? "systems/neuroshima/templates/chat/melee-roll-card.hbs"
      : "systems/neuroshima/templates/chat/weapon-roll-card.hbs";
  }
  get diceCount() {
    return Math.clamp(Number(this.preData.diceCount ?? 3), 1, 3);
  }

  async runPreEffects() {
    await super.runPreEffects();
    if (!this.preData.cancelled) await this.runTrigger("preRollWeaponTest", { phase: "pre" });
  }

  async runPostEffects() {
    await super.runPostEffects();
    await this.runTrigger("rollWeaponTest", { phase: "result" });
  }

  async prepare() {
    await super.prepare();
    Object.assign(this.result, {
      isWeapon: true,
      label: this.preData.label ?? this.item?.name ?? "",
      weaponId: this.item?.id ?? null,
      weaponType: this.item?.system?.weaponType ?? null,
      isMelee: this.preData.isMelee === true || this.context.isMelee === true,
      meleeAction: this.preData.meleeAction ?? this.context.meleeAction ?? null,
      maneuver: this.preData.maneuver ?? this.context.maneuver ?? "none",
      diceCount: this.diceCount,
      burstLevel: Number(this.preData.burstLevel ?? this.context.burstLevel ?? 0),
      distance: Number(this.preData.distance ?? this.context.distance ?? 0),
      jammingThreshold: Number(this.preData.jammingThreshold ?? this.item?.system?.jamming ?? 20),
      bulletsFired: Number(this.preData.bulletsFired ?? 0),
      bulletSequence: clone(this.preData.bulletSequence ?? [])
    });
  }

  async resolveDomain() {
    const location = await this.computeHitLocation(this.preData.hitLocation ?? this.context.hitLocation ?? "torso");
    this.result.hitLocation = this.preData.hitLocation ?? this.context.hitLocation ?? location;
    this.result.locationLabel = game.i18n.localize(NEUROSHIMA.bodyLocations?.[location]?.label ?? location);
  }

  getDataTooltip() {
    return [
      super.getDataTooltip(),
      `<strong>${game.i18n.localize("NEUROSHIMA.Roll.BulletsFired")}:</strong> ${this.result.bulletsFired ?? 0}`,
      `<strong>${game.i18n.localize("NEUROSHIMA.Roll.Jamming")}:</strong> ${this.result.isJamming ? game.i18n.localize("Yes") : game.i18n.localize("No")}`
    ].join("<br>");
  }

  async getChatData() {
    if (!this.result.isMelee) {
      this.result.snapshotTargets = [...(game.user.targets ?? [])]
        .map(token => token.actor ? ({
          id: token.actor.id,
          uuid: token.actor.uuid,
          name: token.actor.name,
          img: token.document?.texture?.src || token.actor.img
        }) : null)
        .filter(Boolean);
    }
    const data = await super.getChatData();
    data.meleeTargets = this.result.isMelee
      ? (await Promise.all((this.preData.targetUuids ?? []).map(uuid => fromUuid(uuid))))
        .filter(Boolean).map(document => {
          const actor = document.actor ?? document;
          return { id: actor.id, name: actor.name, img: actor.img };
        })
      : [];
    data.isVanillaMelee = false;
    return data;
  }
}

export class RangedWeaponTest extends WeaponTest {
  static bulletsForBurst(weapon, burstLevel = 0) {
    if (weapon?.system?.weaponType === "thrown") return 1;
    const rate = Math.max(1, Number(weapon?.system?.fireRate ?? 1));
    return [1, rate, rate * 3, rate * 6][Number(burstLevel)] ?? 1;
  }

  static pelletDamageAtDistance(ranges, distance = 0) {
    for (const key of ["range1", "range2", "range3", "range4"]) {
      if (ranges?.[key] && Number(distance) <= Number(ranges[key].distance)) return ranges[key].damage;
    }
    return "D";
  }

  static planAmmunition(actor, weapon, requested) {
    const magazineId = weapon?.system?.magazine;
    const magazine = magazineId ? actor?.items?.get(magazineId) : null;
    const plan = {
      valid: true,
      magazine,
      magazineId,
      magazineUpdateData: null,
      ammoItem: null,
      ammoItemQuantity: null,
      bulletsFired: requested,
      bulletSequence: [],
      damage: weapon?.system?.damage ?? "D",
      piercing: Number(weapon?.system?.piercing ?? 0),
      jamming: Number(weapon?.system?.jamming ?? 20),
      damageCategory: weapon?.system?.damageCategory ?? "physical"
    };
    if (!magazine && !weapon?.system?.skipMagazineCheck) {
      plan.valid = false;
      plan.reason = "noMagazine";
      return plan;
    }
    if (magazine?.type === "magazine") {
      const contents = clone(magazine.system.contents ?? []);
      let remaining = requested;
      const consumed = [];
      while (remaining > 0 && contents.length) {
        const stack = contents.at(-1);
        const quantity = Math.min(remaining, Number(stack.quantity ?? 0));
        if (quantity > 0) consumed.push({ ...stack, quantity });
        stack.quantity -= quantity;
        remaining -= quantity;
        if (stack.quantity <= 0) contents.pop();
      }
      plan.bulletsFired = requested - remaining;
      plan.magazineUpdateData = contents;
      for (const stack of consumed) {
        for (let index = 0; index < stack.quantity; index++) {
          const overrides = stack.overrides ?? {};
          plan.bulletSequence.push({
            name: stack.name,
            damage: overrides.enabled && overrides.damage ? overrides.damage : plan.damage,
            piercing: overrides.enabled && overrides.piercing != null ? overrides.piercing : plan.piercing,
            jamming: overrides.enabled && overrides.jamming != null ? overrides.jamming : plan.jamming,
            isPellet: overrides.isPellet === true,
            pelletCount: Number(overrides.pelletCount ?? 1),
            pelletRanges: overrides.pelletRanges ?? null
          });
        }
      }
    } else if (weapon?.system?.skipMagazineCheck) {
      plan.bulletSequence = Array.from({ length: requested }, () => ({
        name: weapon.name,
        damage: plan.damage,
        piercing: plan.piercing,
        jamming: plan.jamming,
        isPellet: false
      }));
    }
    return plan;
  }

  async prepare() {
    await super.prepare();
    if (this.result.isOpen && this.diceCount < 2) {
      this.cancel("openTestRequiresTwoDice");
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Roll.OpenTestRequiresTwoDice"));
      return;
    }
    if (!this.actor || !this.item) return;
    const requested = Number(this.preData.bulletsFired)
      || this.constructor.bulletsForBurst(this.item, this.result.burstLevel);
    const plan = this.constructor.planAmmunition(this.actor, this.item, requested);
    this._ammunitionPlan = plan;
    if (!plan.valid) {
      this.cancel(plan.reason);
      return;
    }
    Object.assign(this.result, {
      bulletsFired: plan.bulletsFired,
      bulletSequence: plan.bulletSequence,
      damage: plan.damage,
      piercing: plan.piercing,
      damageCategory: plan.damageCategory,
      jammingThreshold: Math.min(Number(this.item.system.jamming ?? 20), Number(plan.jamming ?? 20)),
      burstHitStep: Number(this.preData.burstHitStep ?? this.context.burstHitStep ?? 1),
      magazineId: plan.magazineId,
      fireRate: Number(this.item.system.fireRate ?? 1)
    });
  }

  async computeResult() {
    await super.computeResult();
    const evaluated = evaluateRangedAttack(this.result, this.result.rawResults);
    Object.assign(this.result, evaluated);
    const jammed = this.result.forceNoJam === true
      ? false
      : this.result.forceJam === true
        || Number(this.result.bestResult) >= Number(this.result.jammingThreshold ?? 20);
    const mayFire = !jammed || this.result.firedDespiteJam === true;
    const sequence = this.result.bulletSequence ?? [];
    const limit = this.result.firedDespiteJam
      ? Math.min(this.result.bulletsFired, Number(this.result.despiteJamBullets ?? 1))
      : this.result.bulletsFired;
    const hits = [];
    if (this.result.success && mayFire) {
      for (let index = 0; index < limit; index++) {
        if (this.result.successPoints <= Math.floor(index / Math.max(1, this.result.burstHitStep))) break;
        const bullet = sequence[index] ?? sequence[0];
        if (!bullet) break;
        hits.push({
          ...bullet,
          damage: bullet.isPellet
            ? this.constructor.pelletDamageAtDistance(bullet.pelletRanges, this.result.distance)
            : bullet.damage,
          successPoints: bullet.isPellet
            ? Math.min(Number(bullet.pelletCount ?? 1), this.result.successPoints)
            : 1,
          shellIndex: index + 1
        });
      }
    }
    Object.assign(this.result, {
      isJamming: jammed,
      jamming: jammed,
      hitBulletsData: hits,
      hitBullets: hits.length,
      isCritFailure: this.result.isCritFailure || jammed
    });
    this.computeFireCorrection();
    this.applyResultModifiers();
    return this;
  }

  computeFireCorrection() {
    if (!game.settings.get("neuroshima", "fireCorrection")
      || this.result.isJamming || this.result.burstLevel <= 0) {
      this.result.fireCorrectionData = null;
      return;
    }
    this.result.fireCorrectionData = {
      bulletsFired: this.result.bulletsFired,
      hitBullets: this.result.hitBullets,
      remainingForCorrection: this.result.bulletsFired - this.result.hitBullets,
      canCorrect: this.result.bulletsFired - this.result.hitBullets >= 4,
      isSuccessCorrection: this.result.success === true
    };
  }

  async postTest() {
    if (this.context.edited || this.context.reroll || this.preData.cancelled) return;
    this._ammunitionPlan = this.constructor.planAmmunition(
      this.actor,
      this.item,
      Number(this.result.bulletsFired ?? 0)
    );
    await this.consumeAmmunition();
    await this.updateJamState();
  }

  async consumeAmmunition() {
    const plan = this._ammunitionPlan;
    if (!plan || (this.result.isJamming && !this.result.firedDespiteJam)) return;
    if (plan.magazine?.type === "magazine" && plan.magazineUpdateData) {
      await plan.magazine.update({ "system.contents": plan.magazineUpdateData });
    } else if (plan.ammoItem && plan.ammoItemQuantity != null) {
      await plan.ammoItem.update({ "system.quantity": plan.ammoItemQuantity });
    }
  }

  async updateJamState() {
    if (!this.item || this.item.system.jammed === this.result.isJamming) return;
    await this.item.update({ "system.jammed": this.result.isJamming });
  }

  async refundAmmunition(message) {
    if (message.getFlag("neuroshima", "ammoRefunded")) return false;
    const sequence = this.result.bulletSequence ?? [];
    if (!sequence.length) return false;
    const magazine = this.result.magazineId ? this.actor?.items?.get(this.result.magazineId) : null;
    if (magazine?.type === "magazine") {
      const contents = clone(magazine.system.contents ?? []);
      for (const bullet of sequence) {
        const stack = contents.find(entry => entry.name === bullet.name);
        if (stack) stack.quantity = Number(stack.quantity ?? 0) + 1;
        else contents.push({ name: bullet.name, quantity: 1 });
      }
      await magazine.update({ "system.contents": contents });
    }
    await message.setFlag("neuroshima", "ammoRefunded", true);
    return true;
  }

  static _isSameAmmo(stack, bullet) {
    if (!stack || !bullet || stack.name !== bullet.name) return false;
    const overrides = stack.overrides ?? {};
    return (overrides.damage ?? null) === (bullet.damage ?? null)
      && Number(overrides.piercing ?? 0) === Number(bullet.piercing ?? 0)
      && Number(overrides.jamming ?? 20) === Number(bullet.jamming ?? 20)
      && Boolean(overrides.isPellet) === Boolean(bullet.isPellet);
  }

  async refundBurstLevel(targetLevel) {
    const currentLevel = Number(this.result.burstLevel ?? this.preData.burstLevel ?? 0);
    const level = Math.clamp(Number(targetLevel), 0, currentLevel);
    const currentBullets = this.constructor.bulletsForBurst(this.item, currentLevel);
    const targetBullets = this.constructor.bulletsForBurst(this.item, level);
    const count = Math.max(0, Math.min(currentBullets - targetBullets, this.result.bulletSequence?.length ?? 0));
    if (!count) return 0;
    const bullets = this.result.bulletSequence.slice(-count);
    const magazine = this.result.magazineId ? this.actor?.items?.get(this.result.magazineId) : null;
    if (magazine?.type === "magazine") {
      const contents = clone(magazine.system.contents ?? []);
      for (const bullet of [...bullets].reverse()) {
        const stack = contents.at(-1);
        if (this.constructor._isSameAmmo(stack, bullet)) stack.quantity = Number(stack.quantity ?? 0) + 1;
        else contents.push({
          name: bullet.name,
          img: bullet.img ?? "systems/neuroshima/assets/img/ammo.svg",
          quantity: 1,
          overrides: {
            enabled: true,
            damage: bullet.damage,
            piercing: bullet.piercing,
            jamming: bullet.jamming,
            isPellet: bullet.isPellet,
            pelletCount: bullet.pelletCount,
            pelletRanges: bullet.pelletRanges
          }
        });
      }
      await magazine.update({ "system.contents": contents });
    } else {
      const ammo = this.result.ammoId ? this.actor?.items?.get(this.result.ammoId) : null;
      if (!ammo) return 0;
      await ammo.update({ "system.quantity": Number(ammo.system.quantity ?? 0) + count });
    }
    return count;
  }

  async increaseBurstLevel(targetLevel) {
    const currentLevel = Number(this.result.burstLevel ?? this.preData.burstLevel ?? 0);
    const originalLevel = Number(this.preData.originalBurstLevel ?? this.preData.burstLevel ?? currentLevel);
    const level = Math.clamp(Number(targetLevel), currentLevel, originalLevel);
    const count = this.constructor.bulletsForBurst(this.item, level)
      - this.constructor.bulletsForBurst(this.item, currentLevel);
    if (count <= 0) return 0;
    const plan = this.constructor.planAmmunition(this.actor, this.item, count);
    if (!plan.valid || plan.bulletsFired !== count) return 0;
    if (plan.magazine?.type === "magazine") {
      await plan.magazine.update({ "system.contents": plan.magazineUpdateData });
    } else if (plan.ammoItem) {
      await plan.ammoItem.update({ "system.quantity": plan.ammoItemQuantity });
    }
    return count;
  }

  async setBurstLevel(level) {
    const current = Number(this.result.burstLevel ?? this.preData.burstLevel ?? 0);
    const target = Math.clamp(Number(level), 0, Number(this.preData.originalBurstLevel ?? current));
    const changed = target < current
      ? await this.refundBurstLevel(target)
      : await this.increaseBurstLevel(target);
    if (target !== current && changed <= 0) return false;
    this.preData.originalBurstLevel ??= current;
    this.preData.burstLevel = target;
    this.result.burstLevel = this.preData.burstLevel;
    this.markDirty("burstLevel");
    await this.recalculate();
    return true;
  }
}

export class MeleeWeaponTest extends WeaponTest {
  async prepare() {
    this.preData.isMelee = true;
    await super.prepare();
    this.result.isMelee = true;
    this.result.meleeAction = this.preData.meleeAction ?? this.context.meleeAction ?? "attack";
  }

  async computeResult() {
    await super.computeResult();
    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction") === true;
    const defense = this.result.meleeAction === "defense";
    const evaluated = defense
      ? evaluateDefense3d20(this.result, this.result.rawResults)
      : doubleSkill && !this.result.isOpen
        ? {
            ...evaluateDefense3d20(this.result, this.result.rawResults),
            success: this.result.rawResults.some(value => Number(value) <= this.result.target && Number(value) !== 20)
          }
        : this.result.isOpen
          ? evaluateOpen3d20(this.result, this.result.rawResults)
          : evaluateClosed3d20(this.result, this.result.rawResults);
    Object.assign(this.result, evaluated);
    this.applyResultModifiers();
    return this;
  }

  async resolveDomain() {
    await super.resolveDomain();
    this.computeMeleeDamageProfiles(this.result.finalLocation);
    Object.assign(this.result, {
      isMelee: true,
      meleeAction: this.preData.meleeAction ?? this.context.meleeAction ?? "attack",
      piercing: Number(this.item?.system?.piercing ?? 0),
      hitBullets: this.result.success ? 1 : 0,
      hitBulletsData: this.result.success ? [{
        damage: this.result.damage,
        piercing: Number(this.item?.system?.piercing ?? 0),
        successPoints: 1,
        isPellet: false
      }] : []
    });
  }

  get opposedResult() {
    return {
      success: this.result.success,
      successes: this.result.successCount,
      successPoints: this.result.successPoints,
      dice: this.result.modifiedResults ?? []
    };
  }
}

export class GrenadeTest extends AttackTest {
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = "grenade";
  }

  get messageType() { return "grenade"; }
  get chatTemplate() { return "systems/neuroshima/templates/chat/grenade-roll-card.hbs"; }

  async computeResult() {
    await super.computeResult();
    const domain = this.preData.grenadeData ?? this.context.grenadeData ?? {};
    const distance = Number(domain.distance ?? this.result.distance ?? 0);
    const failureMargin = this.result.success ? 0 : Math.max(0, 3 - this.result.successCount);
    const zones = [...(domain.blastZones ?? this.result.blastZones ?? [])]
      .sort((a, b) => Number(a.radius) - Number(b.radius));
    Object.assign(this.result, {
      isGrenade: true,
      isSuccess: this.result.success,
      weaponId: this.item?.id,
      failureMargin,
      deviationMetres: this.result.success ? 0 : failureMargin * (distance <= 10 ? 1 : Math.ceil(distance / 10)),
      distance,
      distancePenalty: Number(domain.distancePenalty ?? 0),
      blastZones: zones,
      templateRadius: zones.length ? Math.max(...zones.map(zone => Number(zone.radius) || 0)) : 0
    });
    return this;
  }

  async postTest() {
    if (this.context.edited || this.context.reroll || !this.item?.actor) return;
    const quantity = Math.max(0, Number(this.item.system.quantity ?? 1) - 1);
    await this.item.update({ "system.quantity": quantity });
    this.result.remainingQuantity = quantity;
  }
}

export class MeleeOpposedResolver {
  constructor(attackerTest, defenderTest, { mode = "opposedSuccesses", context = {} } = {}) {
    this.attackerTest = attackerTest;
    this.defenderTest = defenderTest;
    this.mode = mode;
    this.context = context;
  }

  async resolve() {
    await this.attackerTest.runTrigger("preOpposedAttacker", { phase: "pre", role: "attacker" });
    await this.defenderTest.runTrigger("preOpposedDefender", { phase: "pre", role: "defender" });
    const attacker = this.attackerTest.opposedResult;
    const defender = this.defenderTest.opposedResult;
    const attackerValue = this.mode === "opposedSuccesses" ? attacker.successes : attacker.successPoints;
    const defenderValue = this.mode === "opposedSuccesses" ? defender.successes : defender.successPoints;
    const difference = Number(attackerValue ?? 0) - Number(defenderValue ?? 0);
    const result = {
      winner: difference > 0 ? "attacker" : difference < 0 ? "defender" : "draw",
      difference: Math.abs(difference),
      attacker,
      defender,
      mode: this.mode
    };
    this.attackerTest.context.opposedResult = result;
    this.defenderTest.context.opposedResult = result;
    await this.attackerTest.runTrigger("opposedAttacker", { phase: "result", role: "attacker" });
    await this.defenderTest.runTrigger("opposedDefender", { phase: "result", role: "defender" });
    await this.attackerTest.runTrigger("calculateOpposedDamage", { phase: "damage", role: "attacker" });
    return result;
  }
}

export const NEUROSHIMA_TESTS = Object.freeze({
  NeuroshimaTestBase,
  NeuroshimaTest,
  AttributeTest,
  SkillTest,
  HealingTest,
  InitiativeTest,
  PercentileTest,
  ReputationTest,
  AttackTest,
  WeaponTest,
  RangedWeaponTest,
  MeleeWeaponTest,
  GrenadeTest
});
