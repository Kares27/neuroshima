import { NEUROSHIMA } from "./config.js";
import { renderTooltipSections } from "./helpers/tooltip-renderer.js";

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

function diceObjects(rawResults = [], rolledResults = rawResults) {
  return rawResults.map((value, index) => ({
    rolled: Number(rolledResults[index] ?? value),
    original: Number(value),
    modified: Number(value),
    index,
    ignored: false,
    isSuccess: false,
    isNat1: Number(rolledResults[index] ?? value) === 1,
    isNat20: Number(rolledResults[index] ?? value) === 20
  }));
}

function evaluateClosed3d20(data, results, rolledResults = results) {
  const dice = diceObjects(results, rolledResults);
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
  const successPoints = byIndex.filter(die => die.isSuccess).length;
  return {
    modifiedResults: byIndex,
    successPoints,
    success: successPoints >= 2,
    skillUsed: skill + reduction - pool,
    remainingSkill: Math.max(0, skill - (skill + reduction - pool)),
    isCritSuccess: byIndex.every(die => die.isSuccess),
    isCritFailure: byIndex.every(die => !die.isSuccess) && byIndex.some(die => die.isNat20)
  };
}

function evaluateDefense3d20(data, results, rolledResults = results) {
  const target = Number(data.target ?? 0);
  const modifiedResults = diceObjects(results, rolledResults).map(die => ({
    ...die,
    isSuccess: die.original <= target && die.original !== 20
  }));
  const successPoints = modifiedResults.filter(die => die.isSuccess).length;
  return {
    modifiedResults,
    successPoints,
    success: successPoints >= 2,
    isCritSuccess: successPoints === modifiedResults.length,
    isCritFailure: successPoints === 0 && modifiedResults.some(die => die.isNat20)
  };
}

function evaluateOpen3d20(data, results, rolledResults = results) {
  if (![2, 3].includes(results.length)) {
    throw new RangeError("Open tests require exactly two or three dice");
  }
  const target = Number(data.target ?? 0);
  const skill = Number(data.skill ?? 0);
  const reduction = Number(data.dieReductionBonus ?? 0);
  const dice = diceObjects(results, rolledResults);
  const active = [...dice].sort((a, b) => a.original - b.original).slice(0, 2);
  if (dice.length === 3) {
    const ignored = dice.find(die => !active.includes(die));
    if (ignored) ignored.ignored = true;
  }
  for (const die of active) {
    die.modified = Math.max(1, die.original - skill - reduction);
    die.isSuccess = die.modified <= target && die.original !== 20;
  }
  const successPoints = active.reduce((sum, die) =>
    sum + (die.isSuccess ? Math.max(0, target - die.modified + 1) : 0), 0);
  return {
    modifiedResults: dice.sort((a, b) => a.index - b.index),
    successPoints,
    success: successPoints > 0,
    isCritSuccess: active.some(die => die.isNat1),
    isCritFailure: active.every(die => die.isNat20)
  };
}

function evaluateRangedAttack(data, results, rolledResults = results) {
  const target = Number(data.target ?? 0);
  const skill = Number(data.skill ?? 0);
  const reduction = Number(data.dieReductionBonus ?? 0);
  const bestResult = Math.min(...results.map(Number));
  const modifiedBest = Math.max(1, bestResult - skill - reduction);
  const overflow = target - modifiedBest;
  const success = data.isOpen ? overflow >= 0 : modifiedBest <= target && bestResult !== 20;
  return {
    bestResult,
    modifiedResults: diceObjects(results, rolledResults).map((die, index) => {
      const value = die.original;
      const modified = Math.max(1, Number(value) - skill - reduction);
      return {
        ...die, original: Number(value), modified, index,
        isSuccess: data.isOpen ? target - modified >= 0 : modified <= target && Number(value) !== 20,
        isBest: Number(value) === bestResult,
        ignored: false
      };
    }),
    success,
    successPoints: success ? Math.max(1, overflow + 1) : 0,
    isCritSuccess: diceObjects(results, rolledResults)
      .some(die => die.original === bestResult && die.isNat1),
    isCritFailure: diceObjects(results, rolledResults)
      .some(die => die.original === bestResult && die.isNat20)
  };
}

function clone(value) {
  return foundry.utils.deepClone(value ?? {});
}

function serializeSyntheticItem(item) {
  if (!item || item.uuid) return null;
  return {
    id: item.id ?? null,
    name: item.name ?? "",
    img: item.img ?? "",
    type: item.type ?? "weapon",
    beastItemId: item.beastItemId ?? null,
    system: clone(item.system ?? {})
  };
}

function restoreSyntheticItem(snapshot, actor, result = {}) {
  const source = snapshot ?? {
    id: result.weaponId ?? null,
    name: result.label ?? actor?.name ?? "",
    img: actor?.img ?? "",
    type: "weapon",
    beastItemId: result.beastItemId ?? null,
    system: {
      weaponType: result.isMelee ? "melee" : result.weaponType,
      attribute: result.attributeKey ?? "dexterity",
      skill: result.skillKey ?? (actor?.type === "creature" ? "experience" : null),
      attackBonus: 0,
      defenseBonus: 0,
      damageMelee1: result.damageMelee1 ?? "D",
      damageMelee2: result.damageMelee2 ?? result.damageMelee1 ?? "D",
      damageMelee3: result.damageMelee3 ?? result.damageMelee2 ?? result.damageMelee1 ?? "D",
      piercing: Number(result.piercing ?? 0),
      jamming: Number(result.jammingThreshold ?? 20)
    }
  };
  return {
    ...clone(source),
    actor,
    uuid: null,
    isSynthetic: true
  };
}

function escapeTooltip(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function signed(value) {
  const number = Number(value ?? 0);
  return number >= 0 ? `+${number}` : String(number);
}

export class NeuroshimaTestBase {
  static editableByGM = false;
  static dieSides = 20;

  static renderTooltipSections(sections = []) {
    return renderTooltipSections(sections);
  }

  constructor(data = {}, actor = null) {
    this.actor = actor ?? data.actor ?? null;
    this.item = data.item ?? null;
    this.targets = Array.from(data.targets ?? []);
    this.diceRoll = null;
    const attribute = data.attribute ?? {};
    const skill = data.skill ?? {};
    const preData = clone(data.preData);
    const resultData = clone(data.result);
    const contextData = clone(data.context);

    // Backward compatibility for chat cards and saved tests created before
    // successPoints became the sole aggregate result.
    if (resultData.successPoints == null && resultData.successCount != null) {
      resultData.successPoints = Number(resultData.successCount);
    }
    delete resultData.successCount;
    if (preData.resultModifiers?.successPoints == null
      && preData.resultModifiers?.successes != null) {
      preData.resultModifiers.successPoints = Number(preData.resultModifiers.successes);
    }
    if (preData.resultModifiers) delete preData.resultModifiers.successes;
    if (contextData.basePreData?.resultModifiers?.successPoints == null
      && contextData.basePreData?.resultModifiers?.successes != null) {
      contextData.basePreData.resultModifiers.successPoints =
        Number(contextData.basePreData.resultModifiers.successes);
    }
    if (contextData.basePreData?.resultModifiers) {
      delete contextData.basePreData.resultModifiers.successes;
    }

    this.data = {
      preData: {
        rollClass: this.constructor.name,
        actorUuid: this.actor?.uuid ?? null,
        itemUuid: this.item?.uuid ?? null,
        itemSnapshot: serializeSyntheticItem(this.item),
        targetUuids: this.targets.map(target => target?.uuid ?? target).filter(Boolean),
        cancelled: false,
        annotations: [],
        stat: Number(attribute.value ?? preData.stat ?? 0),
        skill: Number(skill.value ?? preData.skill ?? 0),
        attributeKey: attribute.key ?? preData.attributeKey ?? null,
        skillKey: skill.key ?? preData.skillKey ?? null,
        ...preData
      },
      result: {
        rawResults: [],
        rolledResults: [],
        modifiedResults: [],
        success: false,
        successPoints: 0,
        isCritSuccess: false,
        isCritFailure: false,
        annotations: [],
        ...resultData
      },
      context: {
        rollMode: null,
        reroll: false,
        edited: false,
        previousResult: null,
        previousMessageId: null,
        dirty: false,
        ...contextData
      }
    };
    // A newly-created test has no baseline yet. The first roll captures all
    // public API changes made after construction (for example forceSuccess).
    // Recreated tests retain the serialized baseline used by rerolls/edits.
    this.context.basePreData = contextData.basePreData
      ? clone(contextData.basePreData)
      : null;
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
    let item = data.preData.itemUuid ? await fromUuid(data.preData.itemUuid) : null;
    if (!item && data.preData.itemSnapshot) {
      item = restoreSyntheticItem(data.preData.itemSnapshot, actor, data.result);
    } else if (
      !item
      && actor?.type === "creature"
      && ["WeaponTest", "MeleeWeaponTest", "RangedWeaponTest"].includes(rollClass)
    ) {
      // Backward compatibility for creature roll cards created before synthetic
      // item snapshots were stored.
      item = restoreSyntheticItem(null, actor, data.result);
    }
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
  get rollType() { return this.preData.type ?? null; }
  get attributeKey() { return this.preData.attributeKey ?? null; }
  get skillKey() { return this.preData.skillKey ?? null; }
  get isRecalculation() { return this.context.edited === true || this.context.reroll === true; }
  get dieSides() { return this.constructor.dieSides; }
  get attribute() {
    if (!this.attributeKey && this.preData.stat == null) return null;
    return { key: this.attributeKey, value: Number(this.preData.stat ?? 0), name: this.attributeKey };
  }
  get skill() {
    if (!this.skillKey && this.preData.skill == null) return null;
    return { key: this.skillKey, value: Number(this.preData.skill ?? 0), name: this.skillKey };
  }
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

  restoreBasePreData() {
    if (!this.context.basePreData) return this.preData;
    const identity = {
      rollClass: this.preData.rollClass,
      actorUuid: this.preData.actorUuid,
      itemUuid: this.preData.itemUuid,
      targetUuids: [...(this.preData.targetUuids ?? [])],
      type: this.preData.type ?? null
    };
    this.data.preData = { ...clone(this.context.basePreData), ...identity };
    return this.preData;
  }

  prepareBasePreData() {
    if (!this.context.basePreData) {
      this.context.basePreData = clone(this.preData);
      return this.preData;
    }
    return this.restoreBasePreData();
  }

  forceSuccess({ mode = "keepRoll", annotation = null } = {}) {
    this.preData.resultModifiers ??= {};
    this.preData.resultModifiers.forcedSuccess = true;
    if (mode === "skipRoll") this.preData.skipRoll = true;
    if (annotation) this.addAnnotation(annotation, { phase: "pre" });
    this.markDirty("forceSuccess");
  }

  forceFailure() {
    this.preData.resultModifiers ??= {};
    this.preData.resultModifiers.forcedSuccess = false;
    this.markDirty("forceFailure");
  }

  forceInitiative(value) {
    if (value === null || (typeof value === "string" && value.trim() === "")) return false;
    const initiative = Number(value);
    if (this.rollType !== "initiative" || !Number.isFinite(initiative)) return false;
    this.preData.resultModifiers ??= {};
    this.preData.resultModifiers.forcedInitiative = initiative;
    if (this.result?.isInitiative === true) {
      this.result.successPoints = initiative;
      this.result.initiative = initiative;
      this.result.initiativeForced = true;
      this.reconcileSuccess();
      this.markDirty("forceInitiative");
    }
    return true;
  }

  addSuccesses(amount) {
    console.warn("Neuroshima | addSuccesses() is deprecated. Use addSuccessPoints().");
    return this.addSuccessPoints(amount);
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
    const next = Math.clamp(Number(value), 1, this.dieSides);
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

  copyDie(sourceIndex, targetIndex, details = {}) {
    sourceIndex = Number(sourceIndex);
    if (!Number.isInteger(sourceIndex)
      || sourceIndex < 0
      || sourceIndex >= this.result.rawResults.length) return false;
    return this.replaceDie(targetIndex, this.result.rawResults[sourceIndex], {
      ...details,
      type: "copy",
      sourceIndex,
      icon: details.icon ?? "fas fa-copy"
    });
  }

  addAnnotation(text, { phase = "result" } = {}) {
    const annotation = String(text ?? "").trim();
    if (!annotation) return false;
    const target = phase === "pre"
      ? (this.preData.annotations ??= [])
      : (this.result.annotations ??= []);
    if (!target.includes(annotation)) target.push(annotation);
    return true;
  }

  applyResultModifiers() {
    const modifiers = this.preData.resultModifiers ?? {};
    this.result.successPoints = Math.max(
      0, Number(this.result.successPoints ?? 0) + Number(modifiers.successPoints ?? 0)
    );
    if (modifiers.forcedSuccess !== undefined) {
      this.result.success = modifiers.forcedSuccess === true;
    } else {
      this.reconcileSuccess();
    }
    this.result.isSuccess = this.result.success === true;
  }

  evaluateSuccessState() {
    return Number(this.result.successPoints ?? 0) > 0;
  }

  reconcileSuccess() {
    this.result.success = this.evaluateSuccessState();
    this.result.isSuccess = this.result.success === true;
    return this.result.success;
  }

  getDiceApi() {
    const test = this;
    return {
      get rolled() {
        return [...(test.result.rolledResults ?? test.result.rawResults ?? [])].map(Number);
      },
      get raw() {
        return [...(test.result.rawResults ?? [])].map(Number);
      },
      get modified() {
        return clone(test.result.modifiedResults ?? []);
      },
      get: index => Number(
        test.result.modifiedResults?.[Number(index)]?.modified
        ?? test.result.rawResults?.[Number(index)]
      ),
      replace: (index, value, options = {}) => test.replaceDie(index, value, options),
      copy: (source, target, options = {}) => test.copyDie(source, target, options),
      choose: async options => {
        const { EffectActionRuntime } = await import("./effects/effect-action-runtime.js");
        return EffectActionRuntime.chooseDice(test.result, options);
      }
    };
  }

  getResultApi() {
    return {
      addSuccesses: amount => this.addSuccesses(amount),
      addSuccessPoints: amount => this.addSuccessPoints(amount),
      forceSuccess: options => this.forceSuccess(options),
      forceFailure: () => this.forceFailure(),
      forceInitiative: value => this.forceInitiative(value),
      addAnnotation: (text, options) => this.addAnnotation(text, options)
    };
  }

  triggerArgs() {
    return {
      actor: this.actor,
      item: this.item,
      test: this,
      context: this.context,
      eventContext: {},
      dice: this.getDiceApi(),
      result: this.getResultApi(),
      links: {
        meleePool: clone(this.context.meleePoolLink ?? null),
        opposed: clone(this.context.opposedLink ?? null)
      }
    };
  }

  async runTrigger(trigger, metadata = {}) {
    if (!this.actor || this.context.isDebug) return;
    const args = this.triggerArgs();
    args.eventContext = { ...args.eventContext, ...metadata };
    return game.neuroshima.NeuroshimaScriptRunner.executeEvent(
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

  runSyncTrigger(trigger, metadata = {}, args = this.triggerArgs()) {
    if (!this.actor || this.context.isDebug) return;
    args.eventContext = { ...args.eventContext, ...metadata };
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

  async runDiceEffects() {
    await this.runTrigger("afterRollDice", {
      phase: "dice",
      stage: "before-evaluation"
    });
  }

  resetResult({ preserveActions = true, preserveDiceChanges = false } = {}) {
    const next = {
      rawResults: [],
      rolledResults: [],
      modifiedResults: [],
      success: false,
      successPoints: 0,
      isCritSuccess: false,
      isCritFailure: false,
      annotations: [...(this.preData.annotations ?? [])]
    };
    if (preserveActions) {
      next.effectActions = clone(this.result.effectActions ?? []);
      next.resultActions = clone(this.result.resultActions ?? []);
    }
    if (preserveDiceChanges) next.diceChanges = clone(this.result.diceChanges ?? []);
    this.data.result = next;
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

  async roll({ message = null, sendToChat = true, restoreInput = true } = {}) {
    if (restoreInput) this.prepareBasePreData();
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
    await this.runDiceEffects();
    await this.computeResult();
    await this.resolveDomain();
    await this.runPostEffects();
    if (this.context.dirty) await this.recalculate();
    await this.postTest();
    if (sendToChat) this.message = await this.sendToChat({ message });
    return this;
  }

  async edit({ preData = {}, rawResults = null } = {}, { message = null } = {}) {
    const validation = await this.validateLinkedMutation();
    if (!validation.ok) return this.rejectLinkedMutation(validation);
    const linkedCheckpoint = this.context?.opposedLink ? this.toData() : null;
    this.context.previousResult = clone(this.result);
    const previousRaw = [...(this.result.rawResults ?? [])];
    this.context.edited = true;
    this.context.reroll = false;
    this.restoreBasePreData();
    foundry.utils.mergeObject(this.preData, preData, { inplace: true });
    if (Array.isArray(rawResults)) this.preData.fixedDice = [...rawResults];
    const editAnnotation = game.i18n.localize("NEUROSHIMA.Roll.Edited");
    this.preData.annotations = [...new Set([...(this.preData.annotations ?? []), editAnnotation])];
    this.context.basePreData = clone(this.preData);
    const edited = await this.roll({ sendToChat: false, restoreInput: false });
    if (Array.isArray(rawResults)) {
      edited.result.diceChanges = rawResults.flatMap((value, index) =>
        Number(value) === Number(previousRaw[index]) ? [] : [{
          type: "gm-edit",
          targetIndex: index,
          sourceIndex: null,
          oldValue: previousRaw[index],
          newValue: Number(value),
          label: "GM",
          icon: "fas fa-pen",
          effectUuid: null
        }]
      );
    }
    edited.message = message ?? this.message ?? null;
    if (edited.context?.opposedLink && edited.message) {
      edited.message = await edited.updateMessage(edited.message);
    }
    const syncResult = await edited.syncLinkedState({ reason: "gm-edit" });
    if (!syncResult.ok) {
      if (linkedCheckpoint && edited.message) {
        const restored = await NeuroshimaTestBase.recreate(linkedCheckpoint);
        await restored.updateMessage(edited.message);
      }
      throw new Error(`Linked melee sync failed: ${syncResult.reason}`);
    }
    edited.message = await edited.sendToChat({ message });
    return edited;
  }

  async reroll({ previousMessage = null, replaceMessage = false } = {}) {
    const validation = await this.validateLinkedMutation();
    if (!validation.ok) return this.rejectLinkedMutation(validation);
    const linkedCheckpoint = this.context?.opposedLink ? this.toData() : null;
    this.context.previousResult = clone(this.result);
    this.context.previousMessageId = previousMessage?.id ?? null;
    this.context.reroll = true;
    this.context.edited = false;
    this.restoreBasePreData();
    delete this.preData.fixedDice;
    delete this.preData.fixedRolledDice;
    const rerolled = await this.roll({
      sendToChat: false,
      restoreInput: false
    });
    rerolled.message = previousMessage ?? this.message ?? null;
    if (rerolled.context?.opposedLink && rerolled.message) {
      rerolled.message = await rerolled.updateMessage(rerolled.message);
    }
    const syncResult = await rerolled.syncLinkedState({ reason: "reroll" });
    if (!syncResult.ok) {
      if (linkedCheckpoint && rerolled.message) {
        const restored = await NeuroshimaTestBase.recreate(linkedCheckpoint);
        await restored.updateMessage(rerolled.message);
      }
      throw new Error(`Linked melee sync failed: ${syncResult.reason}`);
    }
    rerolled.message = await rerolled.sendToChat({
      message: this.context?.opposedLink
        ? (previousMessage ?? this.message ?? null)
        : (replaceMessage ? previousMessage : null)
    });
    return rerolled;
  }

  async rerollDice(indices, { previousMessage = null, replaceMessage = false } = {}) {
    const validation = await this.validateLinkedMutation();
    if (!validation.ok) return this.rejectLinkedMutation(validation);
    const linkedCheckpoint = this.context?.opposedLink ? this.toData() : null;
    const unique = [...new Set((indices ?? []).map(Number))]
      .filter(index => Number.isInteger(index) && index >= 0 && index < this.result.rawResults.length)
      .sort((a, b) => a - b);
    if (!unique.length) return this;
    const oldRaw = [...this.result.rawResults];
    const nextRaw = [...oldRaw];
    const nextRolled = [...(this.result.rolledResults ?? oldRaw)];
    this.context.previousResult = clone(this.result);
    this.context.previousMessageId = previousMessage?.id ?? null;
    this.context.reroll = true;
    this.context.edited = false;
    const rerolled = await new Roll(`${unique.length}d${this.dieSides}`).evaluate();
    unique.forEach((index, offset) => {
      nextRaw[index] = Number(rerolled.terms[0].results[offset].result);
      nextRolled[index] = nextRaw[index];
    });
    this.restoreBasePreData();
    this.preData.fixedDice = nextRaw;
    this.preData.fixedRolledDice = nextRolled;
    const rerolledTest = await this.roll({
      sendToChat: false,
      restoreInput: false
    });
    rerolledTest.result.diceChanges = unique.map(index => ({
      type: "reroll",
      targetIndex: index,
      sourceIndex: null,
      oldValue: oldRaw[index],
      newValue: nextRaw[index],
      label: game.i18n.localize("NEUROSHIMA.Roll.Reroll"),
      icon: "fas fa-arrow-rotate-left",
      effectUuid: null
    }));
    rerolledTest.message = previousMessage ?? this.message ?? null;
    if (rerolledTest.context?.opposedLink && rerolledTest.message) {
      rerolledTest.message = await rerolledTest.updateMessage(rerolledTest.message);
    }
    const syncResult = await rerolledTest.syncLinkedState({ reason: "partial-reroll" });
    if (!syncResult.ok) {
      if (linkedCheckpoint && rerolledTest.message) {
        const restored = await NeuroshimaTestBase.recreate(linkedCheckpoint);
        await restored.updateMessage(rerolledTest.message);
      }
      throw new Error(`Linked melee sync failed: ${syncResult.reason}`);
    }
    rerolledTest.message = await rerolledTest.sendToChat({
      message: this.context?.opposedLink
        ? (previousMessage ?? this.message ?? null)
        : (replaceMessage ? previousMessage : null)
    });
    return rerolledTest;
  }

  async validateLinkedMutation() {
    if (this.context?.meleePoolLink) {
      const result = await this.validateMeleePoolMutation();
      if (!result.ok) return result;
    }
    if (this.context?.opposedLink) {
      const result = await this.validateOpposedMutation();
      if (!result.ok) return result;
    }
    return {
      ok: true,
      skipped: !this.context?.meleePoolLink && !this.context?.opposedLink,
      reason: "not-linked"
    };
  }

  async validateMeleePoolMutation() {
    const link = this.context.meleePoolLink;
    const { MeleeStore, MeleeTurnService } = await import("./combat/combat.js");
    const encounter = MeleeStore.getEncounter(link.encounterId);
    if (!encounter) return { ok: false, reason: "encounter-missing" };
    const participant = encounter.participants?.[link.participantId];
    if (!participant) return { ok: false, reason: "participant-missing" };
    if (Number(link.turn) !== Number(encounter.turnState?.turn)) {
      return { ok: false, reason: "stale-turn" };
    }
    if (participant.poolRevision && participant.poolRevision !== link.revision) {
      return { ok: false, reason: "stale-revision" };
    }
    const lock = MeleeTurnService.getPoolMutationLock(encounter, link.participantId);
    return { ok: !lock.locked, reason: lock.reason };
  }

  async validateOpposedMutation() {
    const link = this.context.opposedLink;
    const message = game.messages.get(link.duelMessageId);
    if (!message) return { ok: false, reason: "duel-message-missing" };
    const opposed = message.getFlag("neuroshima", "opposedChat");
    const duel = message.getFlag("neuroshima", "duelCard");
    if (!opposed || opposed.id !== link.opposedId) {
      return { ok: false, reason: "stale-opposed-link" };
    }
    const revisionKey = link.role === "defender" ? "defenderRevision" : "attackerRevision";
    if (opposed[revisionKey] && opposed[revisionKey] !== link.revision) {
      return { ok: false, reason: "stale-opposed-revision" };
    }
    if (
      opposed.status === "resolved"
      || opposed.status === "cancelled"
      || duel?.status === "done"
      || duel?.applied === true
    ) {
      return { ok: false, reason: "opposed-resolved" };
    }
    return { ok: true };
  }

  rejectLinkedMutation(validation = {}) {
    ui.notifications.warn(
      game.i18n.localize("NEUROSHIMA.Melee.PoolMutationLocked")
      || "Pula walki została już użyta i nie może zostać zmieniona."
    );
    return { ok: false, reason: validation.reason };
  }

  async syncLinkedState({ reason = "test-update" } = {}) {
    const results = [];
    if (this.context?.meleePoolLink) {
      const { MeleeTurnService } = await import("./combat/combat.js");
      results.push(await MeleeTurnService.syncPoolFromTest(this, { reason }));
    }
    if (this.context?.opposedLink) {
      const { MeleeOpposedChat } = await import("./combat/combat.js");
      results.push(await MeleeOpposedChat.syncFromTest(this, { reason }));
    }
    const failure = results.find(result => result?.ok === false);
    return failure ?? {
      ok: true,
      skipped: results.length === 0,
      reason: results.length ? undefined : "not-linked",
      results
    };
  }

  async commitMutation({ message = null, reason = "mutation", validate = true } = {}) {
    if (validate) {
      const validation = await this.validateLinkedMutation();
      if (!validation.ok) return validation;
    }
    const linkedCheckpoint = this.context?.opposedLink && message
      ? clone(message.getFlag?.("neuroshima", "test") ?? null)
      : null;
    if (this.context.dirty) await this.recalculate();
    if (this.context?.opposedLink && message) {
      this.message = await this.updateMessage(message);
    }
    const sync = await this.syncLinkedState({ reason });
    if (!sync.ok) {
      if (linkedCheckpoint && message) {
        const restored = await NeuroshimaTestBase.recreate(linkedCheckpoint);
        await restored.updateMessage(message);
      }
      return sync;
    }
    if (message) this.message = await this.updateMessage(message);
    return { ok: true, message: this.message ?? message };
  }

  buildDieChangeTooltip(index, changes = []) {
    const dieLabel = game.i18n.format("NEUROSHIMA.Tooltip.Die", { index: Number(index) + 1 });
    const history = changes.map(change => {
      const label = String(change.label ?? "").trim();
      const transition = `${change.oldValue ?? "?"} \u2192 ${change.newValue ?? "?"}`;
      return `<div class="ns-die-change-line">`
        + `<span>${label ? escapeTooltip(label) : escapeTooltip(dieLabel)}</span>`
        + `<strong>${escapeTooltip(transition)}</strong></div>`;
    }).join("");
    return `<div class="ns-die-change-tooltip">`
      + `<strong class="ns-die-change-title">${escapeTooltip(dieLabel)}</strong>`
      + history
      + `</div>`;
  }

  getDiceDisplayData() {
    const changes = this.result.diceChanges ?? [];
    return (this.result.modifiedResults ?? []).map((die, index) => {
      const dieChanges = changes.filter(change => Number(change.targetIndex) === index);
      const lastChange = dieChanges.at(-1) ?? null;
      const rolledOriginal = Number(
        dieChanges[0]?.oldValue
        ?? this.result.rolledResults?.[index]
        ?? die.original
      );
      const effectiveOriginal = Number(this.result.rawResults?.[index] ?? die.original);
      const changed = dieChanges.length > 0 || rolledOriginal !== effectiveOriginal;
      return {
        ...die,
        rolledOriginal,
        effectiveOriginal,
        changed,
        changeIcon: lastChange?.icon ?? "fas fa-pen",
        changeTooltip: changed ? this.buildDieChangeTooltip(index, dieChanges) : "",
        showModified: Number(die.modified) !== Number(die.original)
      };
    });
  }

  getTooltipSections() {
    const result = this.result;
    const penaltyLabels = {
      base: "NEUROSHIMA.Tooltip.BaseDifficulty",
      mod: "NEUROSHIMA.Tooltip.Modifier",
      armor: "NEUROSHIMA.Tooltip.Armor",
      wounds: "NEUROSHIMA.Tooltip.Wounds",
      disease: "NEUROSHIMA.Tooltip.Disease",
      effects: "NEUROSHIMA.Roll.Effects",
      weapon: "NEUROSHIMA.Tooltip.Weapon",
      location: "NEUROSHIMA.Tooltip.Location",
      distance: "NEUROSHIMA.Tooltip.Distance",
      movingShooter: "NEUROSHIMA.Tooltip.MovingShooter",
      movingTarget: "NEUROSHIMA.Tooltip.MovingTarget"
    };
    const penaltyRows = Object.entries(result.penalties ?? {})
      .filter(([key, value]) => key !== "base" && Number(value) !== 0)
      .map(([key, value]) => ({
        label: penaltyLabels[key] ?? key,
        value: `${signed(value)}%`,
        state: Number(value) > 0 ? "penalty" : "bonus"
      }));
    return [
      {
        title: "NEUROSHIMA.Tooltip.Test",
        rows: [
          { label: "NEUROSHIMA.Tooltip.BaseAttribute", value: result.baseStat ?? 0 },
          {
            label: "NEUROSHIMA.Tooltip.AttributeBonus",
            value: result.attributeBonus ?? 0,
            signed: true,
            indent: true,
            state: Number(result.attributeBonus ?? 0) > 0
              ? "bonus"
              : Number(result.attributeBonus ?? 0) < 0 ? "penalty" : null
          },
          { label: "NEUROSHIMA.Tooltip.BaseSkill", value: result.baseSkill ?? 0 },
          {
            label: "NEUROSHIMA.Tooltip.SkillBonus",
            value: result.skillBonus ?? 0,
            signed: true,
            indent: true,
            state: Number(result.skillBonus ?? 0) > 0
              ? "bonus"
              : Number(result.skillBonus ?? 0) < 0 ? "penalty" : null
          },
          { label: "NEUROSHIMA.Tooltip.BaseDifficulty", value: game.i18n.localize(result.baseDifficultyLabel ?? "") }
        ]
      },
      { title: "NEUROSHIMA.Tooltip.Penalties", rows: penaltyRows },
      {
        kind: "threshold",
        rows: [
          {
            label: "NEUROSHIMA.Tooltip.Target",
            value: result.target ?? result.testTarget ?? 0,
            emphasis: true
          }
        ]
      }
    ];
  }

  getDataTooltip() {
    return this.constructor.renderTooltipSections(this.getTooltipSections());
  }

  /**
   * Value presented on the chat card. Most tests display canonical success
   * points; threshold-comparison tests may expose a signed margin instead.
   */
  getDisplayedSuccessPoints() {
    return Number(this.result.successPoints ?? 0);
  }

  canShowTooltip() {
    const minimum = game.settings.get("neuroshima", "rollTooltipMinRole");
    return game.user.role >= minimum
      || (game.settings.get("neuroshima", "rollTooltipOwnerVisibility") && this.actor?.isOwner);
  }

  async getChatData() {
    const autoSuccess = this.preData.resultModifiers?.forcedSuccess === true;
    return {
      ...clone(this.result),
      autoSuccess,
      displaySuccessPoints: this.getDisplayedSuccessPoints(),
      modifiedResults: this.getDiceDisplayData(),
      config: NEUROSHIMA,
      dataTooltip: this.getDataTooltip(),
      showTooltip: this.canShowTooltip(),
      isGM: game.user.isGM,
      isReroll: this.context.reroll === true,
      isEdited: this.context.edited === true,
      previousMessageId: this.context.previousMessageId ?? null
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
    this.preData.itemSnapshot = serializeSyntheticItem(this.item)
      ?? this.preData.itemSnapshot
      ?? null;
    this.preData.targetUuids = this.targets.map(target => target?.uuid ?? target).filter(Boolean);
    delete this.result.successCount;
    if (this.preData.resultModifiers) delete this.preData.resultModifiers.successes;
    if (this.context.basePreData?.resultModifiers) {
      delete this.context.basePreData.resultModifiers.successes;
    }
    return clone(this.data);
  }
}

export class NeuroshimaTest extends NeuroshimaTestBase {
  static editableByGM = true;
  get diceCount() { return 3; }

  evaluateSuccessState() {
    if (this.result.isOpen) return Number(this.result.successPoints ?? 0) > 0;
    return Number(this.result.successPoints ?? 0) >= 2;
  }

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
      this.result.rolledResults = Array.isArray(this.preData.fixedRolledDice)
        ? this.preData.fixedRolledDice.map(Number)
        : [...this.result.rawResults];
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
      shift += TestRules.diceShift(
        this.result.rolledResults?.length
          ? this.result.rolledResults
          : this.result.rawResults
      );
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
      ? evaluateOpen3d20(this.result, this.result.rawResults, this.result.rolledResults)
      : evaluateClosed3d20(this.result, this.result.rawResults, this.result.rolledResults);
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

  getTooltipSections() {
    const sections = super.getTooltipSections();
    if (this.context.rollType !== "painResistance") return sections;

    const eventArgs = this.context.eventArgs ?? {};
    const location = eventArgs.location ?? this.result.location ?? "";
    const locationLabel = NEUROSHIMA.bodyLocations?.[location]?.label ?? location;
    const passed = this.result.success === true;
    const forcePassed = this.result.forcePassed === true;
    const consequence = Number(this.result.painPenalty ?? 0);
    sections.push({
      title: "NEUROSHIMA.Tooltip.PainResistanceSection",
      rows: [
        { label: "NEUROSHIMA.Tooltip.Wound", value: this.result.woundName ?? this.preData.label ?? "" },
        { label: "NEUROSHIMA.Tooltip.DamageType", value: this.result.damageType ?? eventArgs.damageType ?? "" },
        { label: "NEUROSHIMA.Tooltip.Location", value: game.i18n.localize(locationLabel) },
        {
          label: "NEUROSHIMA.Tooltip.Result",
          value: game.i18n.localize(passed ? "NEUROSHIMA.Tooltip.Success" : "NEUROSHIMA.Tooltip.Failure"),
          state: passed ? "success" : "failure"
        },
        ...(forcePassed ? [{
          label: "NEUROSHIMA.Tooltip.Consequence",
          value: game.i18n.localize("NEUROSHIMA.Tooltip.AutomaticSuccess"),
          state: "success"
        }] : []),
        {
          label: "NEUROSHIMA.Tooltip.PainPenalty",
          value: consequence,
          suffix: "%",
          state: consequence > 0 ? "penalty" : "success"
        }
      ]
    });
    return sections;
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
        penalties: {
          mod: Number(difficulty.min ?? 0) + Number(woundConfig.modifier ?? 0),
          effects: Number(woundConfig.effectPenalty ?? 0)
        },
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

  getTooltipSections() {
    const healingEffect = this.result.healingEffect ?? {};
    return [
      ...super.getTooltipSections(),
      {
        title: "NEUROSHIMA.Tooltip.HealingSection",
        rows: [
          { label: "NEUROSHIMA.Tooltip.Patient", value: this.patient?.name ?? "" },
          {
            label: "NEUROSHIMA.Tooltip.HealingMethod",
            value: game.i18n.localize(`NEUROSHIMA.Skills.${this.preData.healingMethod ?? ""}`)
          },
          { label: "NEUROSHIMA.Tooltip.Wounds", value: this.result.woundName ?? "" },
          { label: "NEUROSHIMA.Tooltip.DamageType", value: this.result.damageType ?? healingEffect.damageType ?? "" },
          { label: "NEUROSHIMA.Tooltip.OldPenalty", value: healingEffect.oldPenalty ?? 0 },
          { label: "NEUROSHIMA.Tooltip.NewPenalty", value: healingEffect.newPenalty ?? 0 },
          {
            label: "NEUROSHIMA.Tooltip.PenaltyChange",
            value: healingEffect.penaltyChange ?? 0,
            signed: true,
            state: Number(healingEffect.penaltyChange ?? 0) > 0
              ? "penalty"
              : Number(healingEffect.penaltyChange ?? 0) < 0 ? "bonus" : null
          },
          {
            label: "NEUROSHIMA.Tooltip.FullyHealed",
            value: game.i18n.localize(healingEffect.wasFullyHealed
              ? "NEUROSHIMA.Tooltip.Yes"
              : "NEUROSHIMA.Tooltip.No"),
            state: healingEffect.wasFullyHealed ? "success" : null
          }
        ]
      }
    ];
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
      healingEffect: wound ? this.computeHealingResult(wound, this.result.successPoints, config) : null
    });
  }

  computeHealingResult(wound, successPoints, config = {}) {
    const success = Number(successPoints) >= 2 || this.result.success === true;
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
    const baseInitiative = Number(this.result.successPoints ?? 0);
    args.initiative = baseInitiative;
    this.runSyncTrigger("getInitiativeFormula", { phase: "calculate" }, args);
    const forcedInitiative = this.preData.resultModifiers?.forcedInitiative;
    const isForced = forcedInitiative !== undefined
      && forcedInitiative !== null
      && Number.isFinite(Number(forcedInitiative));
    this.result.initiativeBase = baseInitiative;
    this.result.initiative = isForced
      ? Number(forcedInitiative)
      : Number(args.initiative ?? baseInitiative);
    this.result.initiativeForced = isForced;
    if (isForced) {
      this.result.successPoints = Number(forcedInitiative);
      this.reconcileSuccess();
    }
    this.result.isInitiative = true;
    return this;
  }

  async postTest() {
    const isRecalculation = this.context.reroll || this.context.edited;
    if (!this.combatant || this.preData.subtype === "melee"
      || (isRecalculation && this.result.initiativeForced !== true)) return;
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

  getTooltipSections() {
    return [
      ...super.getTooltipSections(),
      {
        title: "NEUROSHIMA.Tooltip.InitiativeSection",
        rows: [{ label: "NEUROSHIMA.Tooltip.InitiativeSection", value: this.result.initiative ?? 0 }]
      }
    ];
  }
}

export class PercentileTest extends NeuroshimaTestBase {
  static editableByGM = false;
  static dieSides = 100;
  constructor(data = {}, actor = null) {
    super(data, actor);
    this.preData.type = "percentile";
  }

  get diceCount() { return 1; }

  evaluateSuccessState() {
    return Number(this.result.rawResults?.[0] ?? 0) <= Number(this.result.target ?? 0);
  }

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
      this.result.rolledResults = Array.isArray(this.preData.fixedRolledDice)
        ? [Number(this.preData.fixedRolledDice[0])]
        : [...this.result.rawResults];
      return;
    }
    this.diceRoll = await new Roll("1d100").evaluate();
    this.result.rawResults = [Number(this.diceRoll.total)];
    this.result.rolledResults = [...this.result.rawResults];
  }

  async computeResult() {
    const value = Number(this.result.rawResults[0] ?? 0);
    const success = value <= Number(this.result.target ?? 0);
    const thresholdMargin = Number(this.result.target ?? 0) - value;
    Object.assign(this.result, {
      rolledResults: this.result.rolledResults?.length ? this.result.rolledResults : [value],
      modifiedResults: [{
        rolled: Number(this.result.rolledResults?.[0] ?? value),
        original: value,
        modified: value,
        isSuccess: success,
        isNat1: Number(this.result.rolledResults?.[0] ?? value) === 1,
        isNat20: Number(this.result.rolledResults?.[0] ?? value) === 100,
        ignored: false,
        index: 0
      }],
      success,
      isSuccess: success,
      successPoints: thresholdMargin,
      thresholdMargin
    });
    this.applyResultModifiers();
    // Keep the signed comparison for presentation. successPoints remains the
    // non-negative mechanical aggregate required by the shared test contract.
    this.result.thresholdMargin = thresholdMargin
      + Number(this.preData.resultModifiers?.successPoints ?? 0);
    return this;
  }

  getDisplayedSuccessPoints() {
    return Number(
      this.result.thresholdMargin
      ?? (Number(this.result.target ?? 0) - Number(this.result.rawResults?.[0] ?? 0))
    );
  }

  getTooltipSections() {
    return [
      {
        title: "NEUROSHIMA.Tooltip.PercentileSection",
        rows: [
          {
            label: "NEUROSHIMA.Tooltip.Result",
            value: game.i18n.localize(this.result.success
              ? "NEUROSHIMA.Tooltip.Success"
              : "NEUROSHIMA.Tooltip.Failure"),
            state: this.result.success ? "success" : "failure"
          },
          { label: "NEUROSHIMA.Tooltip.Margin", value: this.getDisplayedSuccessPoints(), signed: true },
          { label: "NEUROSHIMA.Roll.SuccessPoints", value: this.result.successPoints ?? 0 }
        ]
      },
      {
        kind: "threshold",
        rows: [
          {
            label: "NEUROSHIMA.Tooltip.Target",
            value: this.result.target ?? 0,
            emphasis: true
          }
        ]
      }
    ];
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
  get weapon() { return this.item; }
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
      beastItemId: this.item?.beastItemId ?? this.preData.beastItemId ?? null,
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

  getTooltipSections() {
    return [
      ...super.getTooltipSections(),
      {
        title: "NEUROSHIMA.Tooltip.WeaponSection",
        rows: [
          { label: "NEUROSHIMA.Tooltip.WeaponType", value: this.result.weaponType ?? "" },
          { label: "NEUROSHIMA.Tooltip.BurstLevel", value: this.result.burstLevel ?? 0 },
          { label: "NEUROSHIMA.Roll.BulletsFired", value: this.result.bulletsFired ?? 0 },
          { label: "NEUROSHIMA.Tooltip.HitBullets", value: this.result.hitBullets ?? 0 },
          { label: "NEUROSHIMA.Tooltip.Damage", value: this.result.damage ?? "" },
          { label: "NEUROSHIMA.Tooltip.Piercing", value: this.result.piercing ?? 0 },
          { label: "NEUROSHIMA.Tooltip.JammingThreshold", value: this.result.jammingThreshold ?? 0 },
          {
            label: "NEUROSHIMA.Tooltip.WouldSucceed",
            value: game.i18n.localize(this.result.wouldSucceed
              ? "NEUROSHIMA.Tooltip.Yes"
              : "NEUROSHIMA.Tooltip.No"),
            state: this.result.wouldSucceed ? "success" : "failure"
          },
          {
            label: "NEUROSHIMA.Roll.Jamming",
            value: game.i18n.localize(this.result.isJamming
              ? "NEUROSHIMA.Tooltip.Yes"
              : "NEUROSHIMA.Tooltip.No"),
            state: this.result.isJamming ? "failure" : null
          },
          { label: "NEUROSHIMA.Tooltip.Location", value: this.result.locationLabel ?? this.result.finalLocation ?? "" },
          { label: "NEUROSHIMA.Tooltip.Distance", value: this.result.distance ?? 0 }
        ]
      }
    ];
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
  evaluateSuccessState() {
    return Number(this.result.successPoints ?? 0) > 0;
  }

  static canShiftBurst(result, user = game.user) {
    return user?.isGM === true || result?.burstShiftGranted === true;
  }

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
    const evaluated = evaluateRangedAttack(
      this.result,
      this.result.rawResults,
      this.result.rolledResults
    );
    Object.assign(this.result, evaluated);
    // Ranged domain resolution (hits and ammunition sequence) must see the
    // final forced/additive success state, not the unmodified evaluator value.
    this.applyResultModifiers();
    const forceNoJam = this.preData.forceNoJam === true;
    const forceJam = this.preData.forceJam === true;
    const firedDespiteJam = this.preData.firedDespiteJam === true;
    const despiteJamBullets = Math.max(1, Number(this.preData.despiteJamBullets ?? 1));
    const jammingThreshold = Number(
      this.preData.jammingThreshold
      ?? this.result.jammingThreshold
      ?? this.item?.system?.jamming
      ?? 20
    );
    const wouldSucceed = evaluated.success === true;
    const jammed = forceNoJam
      ? false
      : forceJam || Number(evaluated.bestResult) >= jammingThreshold;
    const mayFire = !jammed || firedDespiteJam;
    const sequence = this.result.bulletSequence ?? [];
    const limit = firedDespiteJam
      ? Math.min(this.result.bulletsFired, despiteJamBullets)
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
      forceNoJam,
      forceJam,
      firedDespiteJam,
      despiteJamBullets,
      jammingThreshold,
      wouldSucceed,
      isJamming: jammed,
      jamming: jammed,
      hitBulletsData: hits,
      hitBullets: hits.length,
      isCritFailure: this.result.isCritFailure || jammed
    });
    this.computeFireCorrection();
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
  evaluateSuccessState() {
    const successPoints = Number(this.result.successPoints ?? 0);
    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction") === true;
    if (this.result.meleeAction === "defense") {
      return successPoints >= 2;
    }
    if (doubleSkill && !this.result.isOpen) {
      return successPoints > 0;
    }
    return super.evaluateSuccessState();
  }

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
      ? evaluateDefense3d20(this.result, this.result.rawResults, this.result.rolledResults)
      : doubleSkill && !this.result.isOpen
        ? {
            ...evaluateDefense3d20(this.result, this.result.rawResults, this.result.rolledResults),
            success: this.result.rawResults.some(value => Number(value) <= this.result.target && Number(value) !== 20)
          }
        : this.result.isOpen
          ? evaluateOpen3d20(this.result, this.result.rawResults, this.result.rolledResults)
          : evaluateClosed3d20(this.result, this.result.rawResults, this.result.rolledResults);
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

  getTooltipSections() {
    return [
      ...super.getTooltipSections(),
      {
        title: "NEUROSHIMA.Tooltip.GrenadeSection",
        rows: [
          { label: "NEUROSHIMA.Tooltip.Distance", value: this.result.distance ?? 0 },
          { label: "NEUROSHIMA.Tooltip.DistancePenalty", value: this.result.distancePenalty ?? 0, signed: true },
          { label: "NEUROSHIMA.Tooltip.Location", value: this.result.locationLabel ?? this.result.finalLocation ?? "" },
          { label: "NEUROSHIMA.Tooltip.FailureMargin", value: this.result.failureMargin ?? 0 },
          { label: "NEUROSHIMA.Tooltip.Deviation", value: `${this.result.deviationMetres ?? 0} m` },
          { label: "NEUROSHIMA.Tooltip.TemplateRadius", value: `${this.result.templateRadius ?? 0} m` }
        ]
      }
    ];
  }

  async computeResult() {
    await super.computeResult();
    const domain = this.preData.grenadeData ?? this.context.grenadeData ?? {};
    const distance = Number(domain.distance ?? this.result.distance ?? 0);
    const failureMargin = this.result.success ? 0 : Math.max(0, 3 - this.result.successPoints);
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
  constructor(attackerTest, defenderTest, { mode = "opposedSuccessPoints", context = {} } = {}) {
    this.attackerTest = attackerTest;
    this.defenderTest = defenderTest;
    this.mode = mode;
    this.context = context;
  }

  evaluate() {
    const attacker = this.attackerTest.opposedResult;
    const defender = this.defenderTest.opposedResult;
    const difference = Number(attacker.successPoints ?? 0) - Number(defender.successPoints ?? 0);
    const result = {
      winner: difference > 0 ? "attacker" : difference < 0 ? "defender" : "draw",
      difference: Math.abs(difference),
      attacker,
      defender,
      mode: "opposedSuccessPoints"
    };
    this.attackerTest.context.opposedResult = result;
    this.defenderTest.context.opposedResult = result;
    return result;
  }

  async resolve({ preview = false } = {}) {
    await this.attackerTest.runTrigger("preOpposedAttacker", {
      phase: "pre", role: "attacker", preview, opposed: this.context
    });
    await this.defenderTest.runTrigger("preOpposedDefender", {
      phase: "pre", role: "defender", preview, opposed: this.context
    });
    const result = this.evaluate();
    if (!preview) {
      await this.attackerTest.runTrigger("opposedAttacker", {
        phase: "result", role: "attacker", preview: false, opposed: this.context
      });
      await this.defenderTest.runTrigger("opposedDefender", {
        phase: "result", role: "defender", preview: false, opposed: this.context
      });
      await this.attackerTest.runTrigger("calculateOpposedDamage", {
        phase: "damage", role: "attacker", preview: false, opposed: this.context
      });
    }
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
