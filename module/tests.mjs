import { NEUROSHIMA } from "./config.js";

// --------------------------------------------------
// Rules and evaluators
// --------------------------------------------------

// Source consolidated from tests/test-rules.js
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
    return value < 0
      ? NEUROSHIMA.difficulties.easy
      : NEUROSHIMA.difficulties.grandmasterful;
  }

  static skillShift(skill) {
    const value = Number(skill ?? 0);
    return value <= 0 ? -1 : Math.floor(value / 4);
  }

  static diceShift(results = []) {
    return results.reduce((shift, result) => {
      if (result === 1) return shift - 1;
      if (result === 20) return shift + 1;
      return shift;
    }, 0);
  }

  static shiftDifficulty(base, shift = 0) {
    if (!base) return NEUROSHIMA.difficulties.average;
    const key = DIFFICULTY_ORDER.find(entry => NEUROSHIMA.difficulties[entry] === base)
      ?? DIFFICULTY_ORDER.find(entry => NEUROSHIMA.difficulties[entry]?.label === base.label)
      ?? "average";
    const index = DIFFICULTY_ORDER.indexOf(key);
    const shifted = Math.max(0, Math.min(DIFFICULTY_ORDER.length - 1, index + Number(shift ?? 0)));
    return NEUROSHIMA.difficulties[DIFFICULTY_ORDER[shifted]] ?? base;
  }

  static clampMaximumDifficulty(difficulty, maximumDifficulty) {
    if (!difficulty || !maximumDifficulty) return difficulty;
    const maximumIndex = DIFFICULTY_ORDER.indexOf(maximumDifficulty);
    if (maximumIndex < 0) return difficulty;
    const currentIndex = DIFFICULTY_ORDER.findIndex(
      key => NEUROSHIMA.difficulties[key] === difficulty
        || NEUROSHIMA.difficulties[key]?.label === difficulty.label
    );
    return currentIndex > maximumIndex
      ? (NEUROSHIMA.difficulties[maximumDifficulty] ?? difficulty)
      : difficulty;
  }
}

// Source consolidated from tests/evaluators.js
function orderedDice(rawResults = []) {
  return rawResults.map((value, index) => ({
    original: Number(value),
    index,
    modified: Number(value),
    isSuccess: false,
    ignored: false,
    isNat1: Number(value) === 1,
    isNat20: Number(value) === 20
  }));
}

export class Closed3d20Evaluator {
  evaluate(data, rawResults) {
    const dice = orderedDice(rawResults);
    const target = Number(data.target ?? 0);
    const skill = Number(data.skill ?? 0);
    const reduction = Number(data.dieReductionBonus ?? 0);
    const sorted = [...dice].sort((a, b) => a.original - b.original);

    for (const die of sorted) {
      die.cost = die.original <= target ? 0 : (die.original === 20 ? 999 : die.original - target);
    }
    sorted.sort((a, b) => a.cost - b.cost);

    let pool = skill + reduction;
    for (const die of sorted) {
      if (die.original === 20) continue;
      const spent = pool > 0
        ? Math.min(pool, die.cost, Math.max(0, die.original - 1))
        : 0;
      pool -= spent;
      die.modified = die.original - spent;
      die.isSuccess = die.modified <= target;
    }

    if (pool > 0) {
      const successes = sorted.filter(die => die.isSuccess && die.original !== 1);
      while (pool > 0 && successes.some(die => die.modified > 1)) {
        successes.sort((a, b) => b.modified - a.modified);
        successes[0].modified -= 1;
        pool -= 1;
      }
    }

    data.modifiedResults = [...dice].sort((a, b) => a.index - b.index);
    data.successCount = data.modifiedResults.filter(die => die.isSuccess).length;
    data.success = data.successCount >= 2;
    const spent = skill + reduction - pool;
    data.skillUsed = Math.min(skill, spent);
    data.remainingSkill = skill - data.skillUsed;
    data.isCritSuccess = data.successCount === 3;
    data.isCritFailure = data.successCount === 0 && dice.some(die => die.original === 20);
    return data;
  }
}

export class Defense3d20Evaluator {
  evaluate(data, rawResults) {
    const target = Number(data.target ?? 0);
    data.modifiedResults = orderedDice(rawResults).map(die => ({
      ...die,
      isSuccess: die.original <= target && die.original !== 20
    }));
    data.successCount = data.modifiedResults.filter(die => die.isSuccess).length;
    data.success = data.successCount >= 2;
    data.isCritSuccess = data.successCount === 3;
    data.isCritFailure = data.successCount === 0
      && data.modifiedResults.some(die => die.original === 20);
    return data;
  }
}

export class Open3d20Evaluator {
  evaluate(data, rawResults) {
    if (!Array.isArray(rawResults) || rawResults.length < 2 || rawResults.length > 3) {
      throw new RangeError("Open3d20Evaluator requires exactly two or three dice");
    }
    const dice = orderedDice(rawResults);
    const sorted = [...dice].sort((a, b) => a.original - b.original);
    const ignored = sorted.length === 3 ? sorted[2] : null;
    if (ignored) ignored.ignored = true;

    const first = sorted[0];
    const second = sorted[1];
    let pool = Number(data.skill ?? 0) + Number(data.dieReductionBonus ?? 0);
    const match = second.original === 20
      ? 0
      : Math.min(pool, second.original - first.original, Math.max(0, second.original - 1));
    second.modified -= match;
    pool -= match;

    while (pool > 0 && (
      (first.modified > 1 && first.original !== 20)
      || (second.modified > 1 && second.original !== 20)
    )) {
      if (first.modified > 1 && first.original !== 20 && pool > 0) {
        first.modified -= 1;
        pool -= 1;
      }
      if (second.modified > 1 && second.original !== 20 && pool > 0) {
        second.modified -= 1;
        pool -= 1;
      }
    }

    const target = Number(data.target ?? 0);
    first.isSuccess = first.modified <= target && first.original !== 20;
    second.isSuccess = second.modified <= target && second.original !== 20;
    data.successPoints = target - Math.max(first.modified, second.modified);
    data.successCount = data.successPoints;
    data.success = data.successPoints >= 0;
    data.modifiedResults = [...dice].sort((a, b) => a.index - b.index);
    return data;
  }
}

// --------------------------------------------------
// Infrastructure
// --------------------------------------------------

// Source consolidated from tests/test-result.js
/**
 * Stable, mutable result shared by every phase of a Neuroshima test.
 *
 * `data` is the canonical mutable payload rendered by chat cards.
 * New code should use TestResult properties; `rollData` exists only as a
 * compatibility view for existing effect scripts.
 */
export class TestResult {
  constructor(data = {}) {
    this.data = data;
    this.roll = null;
    this.cancelled = false;
    this.skipped = false;
    this.forceSuccessMode = null;
    this.annotations = Array.isArray(data.annotations) ? data.annotations : [];
    this.tags = new Set();
  }

  get rollData() { return this.data; }
  get isSuccess() { return this.data.success === true; }
  set isSuccess(value) { this.data.success = value === true; }
  get successCount() { return Number(this.data.successCount ?? 0); }
  set successCount(value) { this.data.successCount = Number(value ?? 0); }
  get successPoints() { return Number(this.data.successPoints ?? 0); }
  set successPoints(value) { this.data.successPoints = Number(value ?? 0); }

  forceSuccess(mode) {
    this.forceSuccessMode = mode;
    this.data.autoSuccess = true;
    this.data.success = true;
    this.data.successCount = Math.max(1, Number(this.data.successCount ?? 0));
    if (this.data.isOpen) {
      this.data.successPoints = Math.max(0, Number(this.data.successPoints ?? 0));
    }
  }

}

// Source consolidated from tests/test-transformation.js
export class TestTransformationQueue {
  constructor() {
    this._entries = [];
  }

  add(transform, { id = null, priority = 0 } = {}) {
    if (typeof transform !== "function") return;
    this._entries.push({ transform, id, priority });
  }

  async apply(test) {
    const entries = [...this._entries].sort((a, b) => a.priority - b.priority);
    this._entries.length = 0;
    for (const entry of entries) await entry.transform(test);
  }
}

export class SideEffectQueue {
  constructor() {
    this._entries = [];
  }

  add(effect, { id = null, priority = 0 } = {}) {
    if (typeof effect !== "function") return;
    this._entries.push({ effect, id, priority });
  }

  async commit(test) {
    const entries = [...this._entries].sort((a, b) => a.priority - b.priority);
    this._entries.length = 0;
    for (const entry of entries) await entry.effect(test);
  }

  clear() {
    this._entries.length = 0;
  }
}

// Source consolidated from tests/result-action-registry.js
/**
 * Actions made available by a resolved test (damage, jam, healing, etc.).
 * Registration is separate from execution so previews and cancelled tests
 * cannot accidentally mutate documents.
 */
export class ResultActionRegistry {
  constructor() {
    this._actions = new Map();
    this._pending = new Set();
    this._waiters = [];
  }

  register(id, action) {
    if (!id || typeof action?.execute !== "function") return;
    this._actions.set(id, { id, label: id, ...action });
    if (action.requiresResolution) this._pending.add(id);
  }

  get(id) { return this._actions.get(id) ?? null; }
  list() { return [...this._actions.values()]; }

  async execute(id, test, payload = {}) {
    const action = this.get(id);
    if (!action) throw new Error(`Unknown test result action: ${id}`);
    const result = await action.execute(test, payload);
    if (result !== false) this.resolve(id);
    return result;
  }

  resolve(id) {
    this._pending.delete(id);
    if (!this._pending.size) this._flushWaiters();
  }

  dismiss(id) { this.resolve(id); }
  dismissAll() {
    this._pending.clear();
    this._flushWaiters();
  }

  get pending() { return [...this._pending]; }

  waitForResolution() {
    // Most existing actions are post-render and therefore non-blocking.
    // New staged actions opt in with requiresResolution:true.
    if (!this._pending.size) return Promise.resolve();
    return new Promise(resolve => this._waiters.push(resolve));
  }

  serialize() {
    return this.list().map(({ execute, ...action }) => ({
      ...action,
      pending: this._pending.has(action.id)
    }));
  }

  _flushWaiters() {
    for (const resolve of this._waiters.splice(0)) resolve();
  }
}

// --------------------------------------------------
// Base tests
// --------------------------------------------------

// Source consolidated from tests/base/neuroshima-test-base.js
function serializable(value, seen = new WeakSet()) {
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "function") return undefined;
  if (typeof value !== "object") return String(value);
  if (value.documentName && value.uuid) return { uuid: value.uuid, documentName: value.documentName };
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map(entry => serializable(entry, seen)).filter(entry => entry !== undefined);
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    const converted = serializable(entry, seen);
    if (converted !== undefined) output[key] = converted;
  }
  return output;
}

/**
 * Infrastructure shared by every test family. It deliberately contains no
 * 3d20 or percentile rules: subclasses own calculation and recalculation.
 */
export class NeuroshimaTestBase {
  static classId = "base";

  constructor({
    type = "base", subtype = null, actor = null, item = null, targets = [],
    attribute = null, skill = null, preData = {}, rollData = null,
    result = null, context = {}
  } = {}) {
    this.rollType = type;
    this.subtype = subtype;
    this.actor = actor;
    this.item = item;
    this.targets = [...targets];
    this.attribute = attribute;
    this.skill = skill;
    this.preData = { cancelled: false, autoSuccess: false, annotations: [], ...preData };
    this.rollData = rollData ?? {};
    this.context = { ...context };
    this.result = result instanceof TestResult
      ? result
      : new TestResult({ annotations: [...(this.preData.annotations ?? [])] });
    if (rollData) this.result.data = rollData;
    this.transformations = new TestTransformationQueue();
    this.sideEffects = new SideEffectQueue();
    this.actions = new ResultActionRegistry();
    this.phase = "created";
    this.dirty = false;
    this._forcedSuccess = null;
    this._sideEffectsCommitted = false;
    this._scriptRunner = null;
  }

  get classId() { return this.constructor.classId; }
  get type() { return this.rollType; }
  get weapon() { return this.item; }

  cancel(reason = null) {
    this.preData.cancelled = true;
    this.context.cancelReason = reason;
  }

  markDirty(reason = null) {
    this.dirty = true;
    if (reason) (this.context.dirtyReasons ??= []).push(reason);
  }

  reset() {
    this.phase = "created";
    this.dirty = false;
    this._sideEffectsCommitted = false;
  }

  forceSuccess({ mode = "keepRoll", annotation = null } = {}) {
    if (!["keepRoll", "skipRoll"].includes(mode)) {
      throw new Error(`Unsupported force-success mode: ${mode}`);
    }
    this._forcedSuccess = mode;
    this.preData.autoSuccess = true;
    if (annotation) this.preData.annotations.push(annotation);
  }

  addTransformation(transform, options = {}) { this.transformations.add(transform, options); }
  queueSideEffect(effect, options = {}) { this.sideEffects.add(effect, options); }

  getScriptRunner() {
    const runner = this._scriptRunner ?? globalThis.game?.neuroshima?.NeuroshimaScriptRunner;
    if (!runner) throw new Error("NeuroshimaScriptRunner is not available");
    return runner;
  }

  triggerArgs() {
    return {
      ...(this.context.eventArgs ?? {}),
      actor: this.actor,
      item: this.item,
      weapon: this.item,
      test: this,
      context: this.context,
      eventContext: this.context.eventContext ?? {},
      rollData: this.result.rollData,
      roll: this.result.roll
    };
  }

  triggerMetadata(phase) {
    return {
      type: this.rollType, subtype: this.subtype, item: this.item, test: this,
      roll: this.result.roll, result: this.result.rollData, phase,
      reroll: this.context.reroll === true, edited: this.context.edited === true,
      tags: [...this.result.tags]
    };
  }

  async runTrigger(trigger, { phase = null } = {}) {
    if (!this.actor || this.context.isDebug) return;
    return this.getScriptRunner().executeEvent(
      trigger,
      this.triggerArgs(),
      { metadata: this.triggerMetadata(phase) }
    );
  }

  runSyncTrigger(trigger, { phase = null } = {}) {
    if (!this.actor || this.context.isDebug) return null;
    return this.getScriptRunner().executeEventSync(
      trigger,
      this.triggerArgs(),
      { metadata: this.triggerMetadata(phase) }
    );
  }

  async runPreEffects() {
    this.phase = "preRollTest";
    await this.runTrigger("preRollTest", { phase: "pre" });
  }

  async runPostEffects() {
    this.phase = "rollTest";
    await this.runTrigger("rollTest", { phase: "result" });
  }

  async begin() {
    await this.runPreEffects();
    if (this.preData.cancelled) {
      this.phase = "cancelled";
      this.result.cancelled = true;
      this.sideEffects.clear();
      return false;
    }
    this.result.annotations = this.preData.annotations;
    return true;
  }

  async prepare() {}
  async rollDice() {}
  async computeResult(_rolled) {}
  async resolveDomain(_rolled) {}
  async recalculate() {
    this.dirty = false;
    return this.result;
  }
  needsRecalculation() {
    return this.dirty;
  }
  async resolveResultActions() {
    return this.actions.waitForResolution?.(this);
  }
  async postTest() {}

  async applyResultOverrides() {
    const data = this.result.data;
    const successBonus = Number(data.effectActionSuccessBonus ?? 0);
    const pointsBonus = Number(data.effectActionSuccessPointsBonus ?? 0);
    if (successBonus) {
      data.successCount = Math.max(0, Number(data.successCount ?? 0) + successBonus);
      if (!data.isOpen) data.successPoints = Math.max(0, Number(data.successPoints ?? 0) + successBonus);
    }
    if (pointsBonus) data.successPoints = Math.max(0, Number(data.successPoints ?? 0) + pointsBonus);
    if (data.effectActionForcedSuccess !== undefined) {
      data.success = data.isSuccess = data.effectActionForcedSuccess === true;
    } else if (successBonus > 0 && Number(data.successCount) > 0) {
      data.success = data.isSuccess = true;
    }
    data.effectActionSuccessBonus = 0;
    data.effectActionSuccessPointsBonus = 0;
  }

  async commitSideEffects(commit = true) {
    if (this._sideEffectsCommitted) return;
    this._sideEffectsCommitted = true;
    if (commit) await this.sideEffects.commit(this);
    else this.sideEffects.clear();
  }

  async finish({ commit = true } = {}) {
    await this.runPostEffects();
    await this.transformations.apply(this);
    await this.resolveResultActions();
    if (this.needsRecalculation()) await this.recalculate();
    await this.applyResultOverrides();
    if (this._forcedSuccess) this.result.forceSuccess(this._forcedSuccess);
    this.phase = "postTest";
    await this.postTest();
    this.phase = "commit";
    await this.commitSideEffects(commit);
    this.phase = "complete";
    return this.result;
  }

  async roll({ commit = true } = {}) {
    if (!await this.begin()) return this.result;
    this.phase = "prepare";
    await this.prepare();
    if (this.preData.cancelled) {
      this.phase = "cancelled";
      this.result.cancelled = true;
      this.sideEffects.clear();
      return this.result;
    }
    if (this.preData.autoSuccess && !this._forcedSuccess) this.forceSuccess({ mode: "skipRoll" });

    if (this._forcedSuccess !== "skipRoll") {
      this.phase = "roll";
      const rolled = await this.rollDice();
      this.phase = "evaluate";
      await this.computeResult(rolled);
      this.phase = "resolve";
      await this.resolveDomain(rolled);
    } else {
      this.result.skipped = true;
      this.result.data.rawResults ??= [];
      this.result.data.rolledResults ??= [];
      this.result.data.modifiedResults ??= [];
    }
    if (this._forcedSuccess) this.result.forceSuccess(this._forcedSuccess);
    return this.finish({ commit });
  }

  serialize() {
    return {
      classId: this.classId,
      actorUuid: this.actor?.uuid ?? null,
      itemUuid: this.item?.uuid ?? null,
      targetUuids: this.targets.map(target => target?.uuid ?? target).filter(Boolean),
      type: this.rollType,
      subtype: this.subtype,
      attribute: serializable(this.attribute),
      skill: serializable(this.skill),
      preData: serializable(this.preData),
      rollData: serializable(this.result.rollData),
      context: serializable(this.context),
      phase: this.phase
    };
  }

  async updateMessage(message) {
    const { NeuroshimaChatMessage } = await import("./documents/chat-message.js");
    return NeuroshimaChatMessage.updateTestMessage(message, this);
  }
}

// Source consolidated from tests/neuroshima-test.js
export class NeuroshimaTest extends NeuroshimaTestBase {
  static classId = "test";

  constructor({
    type = "attribute",
    subtype = null,
    actor = null,
    item = null,
    targets = [],
    attribute = null,
    skill = null,
    preData = {},
    rollData = null,
    result = null,
    context = {}
  } = {}) {
    super({ type, subtype, actor, item, targets, attribute, skill, preData, rollData, result, context });
  }

  async prepare() {
    const data = this.result.data;
    const currentStat = Number(this.attribute?.value ?? 0);
    const currentSkill = Number(this.skill?.value ?? 0);
    const penalties = this.preData.penalties ?? {};
    const finalSkill = currentSkill + Number(this.preData.skillBonus ?? 0);
    const finalStat = currentStat + Number(this.preData.attributeBonus ?? 0);
    const totalPenalty = Object.values(penalties)
      .reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
    const baseDifficulty = TestRules.difficultyFromPercent(totalPenalty);
    const defending = this.context.meleeAction === "defense";
    const finalIsOpen = defending && !this.context.isInitiative ? false : this.context.isOpen === true;
    Object.assign(data, {
      label: this.preData.label ?? "",
      stat: finalStat,
      skill: finalSkill,
      skillBonus: Number(this.preData.skillBonus ?? 0),
      attributeBonus: Number(this.preData.attributeBonus ?? 0),
      finalDifficultyShift: Number(this.preData.finalDifficultyShift ?? 0),
      maximumDifficulty: this.preData.maximumDifficulty ?? null,
      autoSuccess: this._forcedSuccess !== null,
      baseStat: currentStat,
      baseSkill: currentSkill,
      baseDifficulty,
      penalties,
      penalty: totalPenalty,
      totalPenalty,
      baseDifficultyLabel: baseDifficulty.label,
      isOpen: finalIsOpen,
      isCombat: this.context.isCombat === true,
      isDefending: defending,
      isReroll: this.context.reroll === true,
      isDebug: this.context.isDebug === true,
      rollMode: this.context.rollMode,
      rawResults: [], rolledResults: [], diceChanges: [], modifiedResults: [],
      success: false, successCount: 0, successPoints: 0,
      isCritSuccess: false, isCritFailure: false,
      isGM: globalThis.game?.user?.isGM === true,
      actorId: this.actor?.id, actorImg: this.actor?.img,
      attributeKey: this.attribute?.key ?? null,
      skillKey: this.skill?.key ?? null,
      dieManualBonus: Number(this.preData.dieManualBonus ?? 0),
      dieReductionBonus: Number(this.preData.dieReductionBonus ?? 0),
      annotations: this.result.annotations
    });
  }

  async rollDice() {
    const roll = new Roll("3d20");
    await roll.evaluate();
    const fixed = this.context.fixedDice;
    if (Array.isArray(fixed) && fixed.length === 3) {
      roll.terms[0].results.forEach((result, index) => { result.result = Number(fixed[index]); });
      roll._total = roll.terms[0].results.reduce((sum, result) => sum + result.result, 0);
    }
    const rawResults = roll.terms[0].results.map(result => Number(result.result));
    this.result.roll = roll;
    this.result.data.rawResults = rawResults;
    this.result.data.rolledResults = [...rawResults];
    return { roll, rawResults };
  }

  async computeResult(rolled = null) {
    const data = this.result.data;
    let shift = Number(data.finalDifficultyShift ?? 0);
    const allowCombatShift = globalThis.game?.settings?.get("neuroshima", "allowCombatShift") ?? true;
    if ((!data.isCombat || allowCombatShift) && this.context.applySkillDifficultyShift !== false) {
      shift -= TestRules.skillShift(data.skill);
    }
    if ((!data.isCombat || allowCombatShift) && this.context.applyDiceDifficultyShift !== false) {
      shift += TestRules.diceShift(data.rawResults);
    }
    const difficulty = TestRules.clampMaximumDifficulty(
      TestRules.shiftDifficulty(data.baseDifficulty, shift),
      data.maximumDifficulty
    );
    data.difficultyLabel = difficulty.label;
    data.ptMod = difficulty.mod;
    data.target = Number(data.stat ?? 0) + Number(data.ptMod ?? 0);
    if (data.isOpen) new Open3d20Evaluator().evaluate(data, data.rawResults);
    else if (data.isDefending) new Defense3d20Evaluator().evaluate(data, data.rawResults);
    else new Closed3d20Evaluator().evaluate(data, data.rawResults);
    this.applyManualDieReductions();
    this.result.tags.add(data.isOpen ? "open" : "closed");
    this.result.tags.add(data.success ? "success" : "failure");
    return this.result;
  }

  /**
   * Persistent per-die reductions used by result actions and melee tricks.
   * Keeping them in rollData lets every rerender/reload use the same class
   * recalculation instead of a second evaluator in the chat helper.
   */
  applyManualDieReductions() {
    const data = this.result.data;
    const reductions = data.manualDieReductions ?? {};
    if (!Object.values(reductions).some(value => Number(value) > 0)) return;
    for (const die of data.modifiedResults ?? []) {
      const reduction = Math.max(0, Number(reductions[die.index] ?? 0));
      if (!reduction || die.ignored) continue;
      die.modified = Math.max(1, Number(die.modified) - reduction);
      die.isSuccess = die.original !== 20 && die.modified <= data.target;
      die.showModified = true;
    }
    const active = (data.modifiedResults ?? []).filter(die => !die.ignored);
    data.successCount = active.filter(die => die.isSuccess).length;
    if (data.isOpen) {
      const highest = active.length ? Math.max(...active.map(die => die.modified)) : 0;
      data.success = active.length > 0 && active.every(die => die.isSuccess);
      data.successPoints = data.success ? Math.max(0, Number(data.target) - highest) : 0;
      data.isCritSuccess = false;
      data.isCritFailure = false;
    } else {
      data.success = data.successCount >= 2;
      data.successPoints = data.successCount;
      data.isCritSuccess = data.successCount === 3;
      data.isCritFailure = data.successCount === 0
        && active.some(die => die.original === 20);
    }
  }

  async recalculate() {
    if (!this.result.data.rawResults?.length) return this.result;
    await this.computeResult();
    if (this._forcedSuccess || this.result.data.autoSuccess) {
      this.result.forceSuccess(this._forcedSuccess ?? "keepRoll");
    }
    this.dirty = false;
    return this.result;
  }

  needsRecalculation() {
    return super.needsRecalculation()
      || Boolean(this.result.data.forceRecalculate)
      || Boolean(this.result.data.diceChanges?.length);
  }

}

// --------------------------------------------------
// Standard tests
// --------------------------------------------------

// Source consolidated from tests/standard/attribute-test.js
export class AttributeTest extends NeuroshimaTest {
  static classId = "attribute";
  constructor(data = {}) { super({ ...data, type: "attribute" }); }
}

// Source consolidated from tests/standard/skill-test.js
export class SkillTest extends NeuroshimaTest {
  static classId = "skill";
  constructor(data = {}) { super({ ...data, type: data.type ?? "skill" }); }
}

// Source consolidated from tests/standard/healing-test.js
export class HealingTest extends SkillTest {
  static classId = "healing";

  constructor(data = {}) {
    super({ ...data, type: "healing" });
    this.patient = data.patient ?? data.context?.patientActor ?? null;
    this.wound = data.wound ?? data.context?.wound ?? null;
  }

  static forWound({
    medicActor,
    patientActor,
    healingMethod,
    woundConfig,
    stat = null,
    skillBonus = 0,
    attributeBonus = 0,
    autoSuccess = false,
    annotations = [],
    dieManualBonus = 0,
    dieReductionBonus = 0,
    reroll = false
  }) {
    const skillName = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
    const baseStat = stat ?? (
      Number(medicActor.system.attributes?.dexterity ?? 0)
      + Number(medicActor.system.modifiers?.dexterity ?? 0)
    );
    const skillValue = Number(medicActor.system.skills?.[skillName]?.value ?? 0);
    const difficulty = NEUROSHIMA.difficulties?.[woundConfig.difficulty || "average"]
      ?? NEUROSHIMA.difficulties?.average
      ?? { min: 0 };
    const wound = patientActor.items?.get(woundConfig.woundId) ?? null;

    return new this({
      actor: medicActor,
      patient: patientActor,
      wound,
      attribute: { key: "dexterity", value: baseStat },
      skill: { key: skillName, value: skillValue },
      preData: {
        label: woundConfig.woundName,
        penalties: {
          mod: Number(difficulty.min ?? 0) + Number(woundConfig.modifier ?? 0)
        },
        skillBonus,
        attributeBonus,
        finalDifficultyShift: Number(woundConfig.failedAttempts ?? 0)
          + Number(woundConfig.difficultyShift ?? 0),
        autoSuccess,
        annotations,
        dieManualBonus,
        dieReductionBonus
      },
      context: {
        reroll,
        isOpen: false,
        rollType: "healing",
        healingMethod,
        patientActor,
        wound,
        woundConfig,
        eventArgs: { patientActor, wound }
      }
    });
  }

  async resolveDomain() {
    const config = this.context.woundConfig ?? {};
    const data = this.result.data;
    const wound = this.wound ?? this.patient?.items?.get(config.woundId);
    const calculated = wound ? [this.computeHealingResult(wound, data.successCount, config)] : [];

    Object.assign(data, {
      woundId: config.woundId,
      woundName: config.woundName,
      damageType: config.damageType,
      difficulty: config.difficulty,
      testTarget: data.target,
      isSuccess: data.success === true,
      finalStat: data.stat,
      skillShift: -TestRules.skillShift(data.skill),
      diceShift: TestRules.diceShift(data.rawResults),
      healingEffect: calculated[0] ?? null
    });
    return this.result;
  }

  computeHealingResult(wound, successCount, config = this.context.woundConfig ?? {}) {
    const success = Number(successCount) >= 2;
    const firstAid = this.context.healingMethod === "firstAid";
    let penaltyChange = success
      ? (firstAid ? -5 : (config.hadFirstAid ? -10 : -15))
      : 5;
    penaltyChange += Number(config.healingModifier ?? 0);
    const modifierOnFailure = globalThis.game?.settings?.get(
      "neuroshima", "healingScriptModifierOnFailure"
    ) ?? false;
    if (success || modifierOnFailure) {
      penaltyChange += Number(config.scriptHealingModifier ?? 0);
    }
    const oldPenalty = Number(wound.system?.penalty ?? 0);
    let newPenalty = Math.max(0, oldPenalty + penaltyChange);
    if (success && !(globalThis.game?.settings?.get("neuroshima", "allowRepeatedHealing") ?? false)) {
      const originalPenalty = Number(wound.system?.originalPenalty ?? oldPenalty);
      if (firstAid) {
        const remaining = Math.max(0, 5 - Number(wound.system?.firstAidHealingApplied ?? 0));
        newPenalty = Math.max(oldPenalty - remaining, newPenalty);
      }
      newPenalty = Math.max(originalPenalty - 15, newPenalty);
    }
    newPenalty = Math.max(0, newPenalty);
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

  async recalculate() {
    await super.recalculate();
    await this.resolveDomain();
    return this.result;
  }
}

// Source consolidated from tests/standard/initiative-test.js
export class InitiativeTest extends NeuroshimaTest {
  static classId = "initiative";
  constructor(data = {}) { super({ ...data, type: "initiative" }); }

  async computeResult(rolled = null) {
    await super.computeResult(rolled);
    this.computeInitiative();
    return this.result;
  }

  async recalculate() {
    await super.recalculate();
    // super.recalculate() invokes the polymorphic computeResult(), therefore
    // the initiative trigger has already been included in the final contract.
    return this.result;
  }

  computeInitiative() {
    const args = this.triggerArgs();
    args.initiative = Number(this.result.successPoints ?? 0);
    args.successPoints = args.initiative; // compatibility for existing scripts
    if (this.actor && !this.context.isDebug) {
      this.getScriptRunner().executeEventSync("getInitiativeFormula", args, {
        metadata: this.triggerMetadata("calculate")
      });
    }
    const finalValue = Number(args.initiative ?? args.successPoints ?? 0);
    this.result.data.initiative = finalValue;
    this.result.data.successPoints = finalValue;
  }

  async postTest() {
    await super.postTest();
    const combatant = this.context.combatant ?? this.context.eventArgs?.combatant;
    // Melee initiative belongs to the duel subsystem and must not overwrite
    // the regular Combat tracker initiative.
    if (this.subtype === "melee" || !combatant?.update || this.context.isDebug
      || this.context.reroll === true || this.context.edited === true) return;
    const initiative = Number(this.result.data.initiative ?? this.result.successPoints ?? 0);
    this.queueSideEffect(() => combatant.update({ initiative }), {
      id: "update-combatant-initiative"
    });
  }
}

// --------------------------------------------------
// Percentile tests
// --------------------------------------------------

// Source consolidated from tests/percentile/percentile-test.js
export class PercentileTest extends NeuroshimaTestBase {
  static classId = "percentile";
  constructor(data = {}) { super({ ...data, type: data.type ?? "percentile" }); }

  async rollDice() {
    const roll = await new Roll("1d100").evaluate();
    const rawResults = [Number(roll.total)];
    this.result.roll = roll;
    this.result.data.rawResults = rawResults;
    return { roll, rawResults };
  }

  async recalculate() {
    await this.computeResult();
    if (this._forcedSuccess || this.result.data.autoSuccess) {
      this.result.forceSuccess(this._forcedSuccess ?? "keepRoll");
    }
    this.dirty = false;
    return this.result;
  }

  needsRecalculation() {
    return super.needsRecalculation()
      || Boolean(this.result.data.forceRecalculate)
      || Boolean(this.result.data.diceChanges?.length);
  }
}

// Source consolidated from tests/percentile/reputation-test.js
export class ReputationTest extends PercentileTest {
  static classId = "reputation";
  constructor(data = {}) { super({ ...data, type: "reputation" }); }

  async prepare() {
    const target = Number(this.attribute?.value ?? this.preData.target ?? 0);
    Object.assign(this.result.data, {
      label: this.preData.label ?? this.item?.name ?? "",
      stat: target,
      skill: 0,
      target,
      rawResults: [],
      rolledResults: [],
      modifiedResults: [],
      success: false,
      successCount: 0,
      successPoints: 0,
      isOpen: false,
      isReputationRoll: true,
      rollMode: this.context.rollMode
    });
  }

  async computeResult(rolled = null) {
    const data = this.result.data;
    const result = Number(data.rawResults?.[0] ?? 0);
    const target = Number(data.target ?? 0);
    const success = result <= target;
    data.rolledResults = [result];
    data.modifiedResults = [{
      original: result, modified: result, isSuccess: success,
      ignored: false, index: 0
    }];
    data.success = success;
    data.successCount = success ? 1 : 0;
    data.successPoints = target - result;
    this.result.tags.add("percentile");
    this.result.tags.add(success ? "success" : "failure");
    return this.result;
  }
}

// --------------------------------------------------
// Attack tests
// --------------------------------------------------

// Source consolidated from tests/attack/attack-test.js
export class AttackTest extends NeuroshimaTest {
  static classId = "attack";

  static shiftDamageType(type, steps = 0) {
    if (!steps) return type;
    const regular = ["D", "L", "C", "K"];
    const bruise = ["sD", "sL", "sC", "sK"];
    const track = String(type ?? "").startsWith("s") ? bruise : regular;
    const index = track.indexOf(type);
    if (index < 0) return type;
    return track[Math.min(track.length - 1, Math.max(0, index + Number(steps)))];
  }

  static locationFromRoll(value) {
    const rolled = Number(value);
    const entry = Object.entries(NEUROSHIMA.bodyLocations).find(([, data]) => (
      Array.isArray(data.roll) && rolled >= data.roll[0] && rolled <= data.roll[1]
    ));
    return entry?.[0] ?? "torso";
  }

  async computeHitLocation(requested = this.context.hitLocation ?? "torso") {
    if (requested !== "random") {
      this.result.data.finalLocation = requested;
      return requested;
    }
    const locationRoll = await new Roll("1d20").evaluate();
    const location = this.constructor.locationFromRoll(locationRoll.total);
    this.result.data.locationRoll = locationRoll.total;
    this.result.data.finalLocation = location;
    (this.result.data.auxiliaryRolls ??= []).push({
      type: "hitLocation",
      formula: locationRoll.formula ?? "1d20",
      result: locationRoll.total,
      value: location
    });
    return location;
  }

  computeMeleeDamageProfiles({
    location = this.result.data.finalLocation,
    damageShift = 0,
    damageShift1 = 0,
    damageShift2 = 0,
    damageShift3 = 0
  } = {}) {
    const system = this.item?.system ?? {};
    const headShift = location === "head" ? 1 : 0;
    const profiles = [
      this.constructor.shiftDamageType(system.damageMelee1 || "D", damageShift + damageShift1 + headShift),
      this.constructor.shiftDamageType(system.damageMelee2 || system.damageMelee1 || "D", damageShift + damageShift2 + headShift),
      this.constructor.shiftDamageType(system.damageMelee3 || system.damageMelee2 || system.damageMelee1 || "D", damageShift + damageShift3 + headShift)
    ];
    Object.assign(this.result.data, {
      damageMelee1: profiles[0],
      damageMelee2: profiles[1],
      damageMelee3: profiles[2],
      damage: profiles.join("/"),
      damageProfilesResolved: true,
      headDamageApplied: headShift === 1
    });
    return profiles;
  }
}

// Source consolidated from tests/attack/weapon-test.js
export class WeaponTest extends AttackTest {
  static classId = "weapon";
  constructor(data = {}) { super({ ...data, type: "weapon" }); }

  /**
   * Compatibility constructor for the historical flat dialog payload. The
   * concrete subclass is selected before this method is called, so callers no
   * longer branch over weapon types outside TestFactory.
   */
  async prepare() {
    await super.prepare();
    const data = this.result.data;
    data.isWeapon = true;
    data.label = this.preData.label ?? this.item?.name ?? "";
    data.weaponId = this.item?.id ?? null;
    data.actorId = this.actor?.id ?? null;
    data.actorImg = this.actor?.img ?? null;
    data.weaponType = this.item?.system?.weaponType ?? this.subtype;
    data.isMelee = this.context.isMelee === true;
    data.meleeAction = this.context.isMelee ? (this.context.meleeAction ?? "attack") : null;
    data.maneuver = this.context.maneuver ?? "none";
    data.rollMode = this.context.rollMode;
    data.targets = this.context.isMelee ? [...this.targets] : [];
    data.applyArmor = this.context.applyArmor;
    data.applyWounds = this.context.applyWounds;
    data.damageShift = Number(this.context.damageShift ?? 0);
    data.burstLevel = Number(this.context.burstLevel ?? 0);
    data.distance = Number(this.context.distance ?? 0);
    data.isReroll = this.context.reroll === true;
    data.diceCount = Math.min(3, Math.max(
      1,
      Math.floor(Number(this.preData.diceCount ?? 3))
    ));
    data.jammingThreshold = Number(
      this.preData.jammingThreshold
      ?? this.item?.system?.jammingThreshold
      ?? 20
    );
    data.bulletsFired = Math.max(0, Number(this.preData.bulletsFired ?? 0));
    data.bulletSequence = this.preData.bulletSequence ?? [];
  }

  async rollDice() {
    const diceCount = Number(this.result.data.diceCount ?? 3);
    const roll = new Roll(`${diceCount}d20`);
    await roll.evaluate();
    const fixed = this.context.fixedDice;
    if (Array.isArray(fixed) && fixed.length === diceCount) {
      roll.terms[0].results.forEach((result, index) => { result.result = Number(fixed[index]); });
      roll._total = roll.terms[0].results.reduce((sum, result) => sum + result.result, 0);
    }
    const rawResults = roll.terms[0].results.map(result => Number(result.result));
    this.result.roll = roll;
    this.result.data.rawResults = rawResults;
    this.result.data.rolledResults = [...rawResults];
    return { roll, rawResults };
  }

  async resolveDomain(rolled = null) {
    await super.resolveDomain(rolled);
    const location = await this.computeHitLocation(
      this.context.hitLocation ?? this.preData.hitLocation ?? "torso"
    );
    this.result.data.hitLocation = this.context.hitLocation ?? location;
    this.result.data.locationLabel = globalThis.game?.i18n?.localize?.(
      NEUROSHIMA.bodyLocations?.[location]?.label ?? location
    ) ?? location;
    return this.result;
  }

  async runPreEffects() {
    await super.runPreEffects();
    if (!this.preData.cancelled) {
      await this.runTrigger("preRollWeaponTest", { phase: "pre" });
    }
  }

  triggerArgs() {
    const args = super.triggerArgs();
    const data = this.result.data;
    Object.assign(args, {
      weapon: this.item,
      firedDespiteJam: data.firedDespiteJam === true,
      despiteJamBullets: data.despiteJamBullets ?? null,
      annotations: this.result.annotations,
      options: this.context.options ?? {}
    });
    Object.defineProperties(args, {
      isSuccess: {
        enumerable: true,
        get: () => data.success === true,
        set: value => { data.success = data.isSuccess = value === true; }
      },
      isJamming: {
        enumerable: true,
        get: () => data.isJamming === true,
        set: value => { data.isJamming = data.jamming = value === true; }
      },
      hitBullets: {
        enumerable: true,
        get: () => data.hitBullets,
        set: value => { data.hitBullets = Number(value ?? 0); }
      },
      bulletsFired: {
        enumerable: true,
        get: () => data.bulletsFired,
        set: value => { data.bulletsFired = Number(value ?? 0); }
      },
      successPoints: {
        enumerable: true,
        get: () => data.successPoints,
        set: value => { data.successPoints = Number(value ?? 0); }
      }
    });
    return args;
  }

  async runPostEffects() {
    await super.runPostEffects();
    await this.runTrigger("rollWeaponTest", { phase: "result" });
    this.markDirty("rollWeaponTest");
  }

  async postTest() {
    await super.postTest();
  }
}

// Source consolidated from tests/attack/ranged-weapon-test.js
export class RangedWeaponTest extends WeaponTest {
  static classId = "rangedWeapon";
  constructor(data = {}) { super({ ...data, subtype: data.subtype ?? "ranged" }); }

  static bulletsForBurst(weapon, burstLevel = 0) {
    if (weapon?.system?.weaponType === "thrown") return 1;
    const fireRate = Math.max(1, Number(weapon?.system?.fireRate ?? 1));
    switch (Number(burstLevel)) {
      case 1: return fireRate;
      case 2: return fireRate * 3;
      case 3: return fireRate * 6;
      default: return 1;
    }
  }

  static pelletDamageAtDistance(ranges, distance = 0) {
    if (!ranges) return "D";
    for (const key of ["range1", "range2", "range3", "range4"]) {
      const range = ranges[key];
      if (range && Number(distance) <= Number(range.distance)) return range.damage;
    }
    return "D";
  }

  /**
   * Build an immutable firing plan. Reading inventory is allowed here, but no
   * Item is updated until WeaponTest commits its queued side effects.
   */
  static planAmmunition(actor, weapon, requestedBullets) {
    const isRanged = weapon.system.weaponType === "ranged";
    const isThrown = weapon.system.weaponType === "thrown";
    const magazineId = weapon.system.magazine;
    const magazine = magazineId ? actor.items.get(magazineId) : null;
    const plan = {
      valid: true,
      isRanged,
      isThrown,
      magazine,
      magazineId,
      magazineUpdateData: null,
      ammoItem: null,
      ammoItemQuantity: null,
      bulletsFired: requestedBullets,
      bulletSequence: [],
      damage: weapon.system.damage || "0",
      piercing: weapon.system.piercing || 0,
      jamming: weapon.system.jamming || 20,
      damageCategory: weapon.system.damageCategory ?? "physical",
      exhaustedDuringBurst: false
    };

    if ((isRanged || isThrown) && !magazine && !weapon.system.skipMagazineCheck) {
      plan.valid = false;
      plan.reason = "noMagazine";
      return plan;
    }

    if (magazine?.type === "magazine") {
      const contents = structuredClone(magazine.system.contents || []);
      let remaining = requestedBullets;
      const consumed = [];
      while (remaining > 0 && contents.length) {
        const stack = contents.at(-1);
        const quantity = Math.min(remaining, Number(stack.quantity ?? 0));
        if (quantity > 0) consumed.push({ ...stack, quantity });
        stack.quantity -= quantity;
        remaining -= quantity;
        if (stack.quantity <= 0) contents.pop();
      }
      plan.bulletsFired = requestedBullets - remaining;
      plan.magazineUpdateData = contents;
      plan.exhaustedDuringBurst = remaining > 0;
      for (const stack of consumed) {
        for (let index = 0; index < stack.quantity; index++) {
          const overrides = stack.overrides ?? {};
          plan.bulletSequence.push({
            name: stack.name,
            damage: overrides.enabled && overrides.damage ? overrides.damage : plan.damage,
            piercing: overrides.enabled && overrides.piercing != null ? overrides.piercing : plan.piercing,
            jamming: overrides.enabled && overrides.jamming != null ? overrides.jamming : plan.jamming,
            isPellet: overrides.isPellet === true,
            pelletCount: overrides.isPellet ? Number(overrides.pelletCount ?? 1) : 1,
            pelletRanges: overrides.isPellet ? overrides.pelletRanges : null
          });
        }
      }
    } else if (isThrown && magazineId) {
      const ammo = actor.items.get(magazineId);
      plan.ammoItem = ammo?.type === "ammo" ? ammo : null;
      if (plan.ammoItem && Number(plan.ammoItem.system.quantity) > 0) {
        const system = plan.ammoItem.system;
        const override = system.isOverride === true;
        plan.bulletsFired = 1;
        plan.ammoItemQuantity = Number(system.quantity) - 1;
        plan.bulletSequence = [{
          name: plan.ammoItem.name,
          damage: override && system.overrideDamage ? system.damage : plan.damage,
          piercing: override && system.overridePiercing ? system.piercing : plan.piercing,
          jamming: override && system.overrideJamming ? system.jamming : plan.jamming,
          isPellet: system.isPellet === true,
          pelletCount: system.isPellet ? Number(system.pelletCount ?? 1) : 1,
          pelletRanges: system.isPellet ? system.pelletRanges : null
        }];
        if (override && system.overrideDamageCategory) {
          plan.damageCategory = system.damageCategory ?? "physical";
        }
      } else {
        plan.bulletsFired = 0;
      }
    }

    if (!plan.bulletSequence.length && plan.bulletsFired > 0 && weapon.system.skipMagazineCheck) {
      const bullet = {
        name: weapon.name,
        damage: plan.damage,
        piercing: plan.piercing,
        jamming: plan.jamming,
        isPellet: false,
        pelletCount: 1,
        pelletRanges: null
      };
      plan.bulletSequence = Array.from({ length: plan.bulletsFired }, () => ({ ...bullet }));
    }

    if (plan.bulletSequence.length) {
      plan.damage = plan.bulletSequence[0].damage;
      plan.piercing = plan.bulletSequence[0].piercing;
      plan.jamming = Math.min(...plan.bulletSequence.map(bullet => Number(bullet.jamming ?? 20)));
    }
    return plan;
  }

  async prepare() {
    await super.prepare();
    if (!this.actor || !this.item) return;
    const requested = Number(this.preData.bulletsFired)
      || this.constructor.bulletsForBurst(this.item, this.context.burstLevel);
    const plan = this.constructor.planAmmunition(this.actor, this.item, requested);
    this.context.ammunitionPlan = plan;
    if (!plan.valid) {
      this.cancel(plan.reason);
      return;
    }
    Object.assign(this.result.data, {
      bulletsFired: plan.bulletsFired,
      bulletSequence: plan.bulletSequence,
      damage: plan.damage,
      piercing: plan.piercing,
      damageCategory: plan.damageCategory,
      jammingThreshold: Math.min(
        Number(this.item.system.jamming ?? 20),
        Number(plan.jamming ?? 20)
      ),
      burstHitStep: Number(this.context.burstHitStep ?? 1),
      distance: Number(this.context.distance ?? 0)
    });
    this.result.data.actionLabel = globalThis.game?.i18n?.localize?.(
      NEUROSHIMA.burstLabels[this.context.burstLevel] ?? NEUROSHIMA.burstLabels[0]
    ) ?? "";
    this.result.data.magazineId = plan.magazineId;
    this.result.data.ammoId = plan.isThrown ? plan.magazineId : null;
    this.result.data.fireRate = Number(this.item.system.fireRate ?? 1);

    if (plan.magazine?.type === "magazine" && plan.magazineUpdateData) {
      this.queueSideEffect(current => {
        const data = current.result.data;
        if (data.isJamming && !data.firedDespiteJam) return;
        return plan.magazine.update({ "system.contents": plan.magazineUpdateData });
      }, { id: "consume-magazine" });
    } else if (plan.ammoItem && plan.bulletsFired > 0) {
      this.queueSideEffect(current => {
        const data = current.result.data;
        if (data.isJamming && !data.firedDespiteJam) return;
        return plan.ammoItem.update({ "system.quantity": plan.ammoItemQuantity });
      }, { id: "consume-thrown-ammo" });
    }
    this.queueSideEffect(current => {
      const jammed = current.result.data.isJamming === true;
      if (jammed === (this.item.system.jammed === true)) return;
      return this.item.update({ "system.jammed": jammed });
    }, { id: "update-weapon-jam", priority: 100 });
  }

  async computeResult(rolled = null) {
    await super.computeResult(rolled);
    await this.recalculate();
    this.computeFireCorrection();
    return this.result;
  }

  computeFireCorrection() {
    const data = this.result.data;
    const enabled = globalThis.game?.settings?.get("neuroshima", "fireCorrection") === true;
    if (!enabled || data.isJamming || Number(this.context.burstLevel) <= 0 || data.bulletsFired <= 0) {
      data.fireCorrectionData = null;
      return null;
    }
    if (!data.success) {
      const modifiedBest = Math.max(
        1,
        Number(data.bestResult) - Number(data.skill) - Number(data.dieReductionBonus ?? 0)
      );
      const failureMargin = modifiedBest - Number(data.target);
      data.fireCorrectionData = failureMargin > 0 ? {
        failureMargin,
        totalCorrectionCost: failureMargin * 3,
        bulletsFired: data.bulletsFired,
        canCorrect: failureMargin * 3 < data.bulletsFired,
        isSuccessCorrection: false
      } : null;
    } else {
      const remainingForCorrection = data.bulletsFired - data.hitBullets;
      const maxCorrectionHits = Math.floor(remainingForCorrection / 4);
      data.fireCorrectionData = {
        failureMargin: 0,
        totalCorrectionCost: 3,
        bulletsFired: data.bulletsFired,
        hitBullets: data.hitBullets,
        remainingForCorrection,
        maxCorrectionHits,
        canCorrect: maxCorrectionHits > 0,
        isSuccessCorrection: true
      };
    }
    return data.fireCorrectionData;
  }

  /**
   * Rebuild every value derived from the attack dice. This method is pure with
   * respect to Foundry documents: ammunition and jam updates remain queued
   * side effects of the original roll.
   */
  async recalculate() {
    const data = this.result.data;
    const results = [...(data.rawResults ?? data.results ?? [])].map(Number);
    if (!results.length) return this.result;

    const target = Number(data.target ?? 0);
    const skill = Number(data.skill ?? 0);
    const bestResult = Math.min(...results);
    const dieReductionBonus = Number(data.dieReductionBonus ?? 0);
    const modifiedBest = Math.max(1, bestResult - skill - dieReductionBonus);
    const overflow = target - modifiedBest;
    const isOpen = data.isOpen === true;
    let success = isOpen ? overflow >= 0 : modifiedBest <= target && bestResult !== 20;
    let successPoints = isOpen ? Math.max(0, overflow) : (success ? 1 : 0);
    if (data.autoSuccess) {
      success = true;
      successPoints = Math.max(1, successPoints);
    }

    const forcedJam = data.forceJam === true;
    const preventedJam = data.forceNoJam === true;
    const threshold = Number(data.jammingThreshold ?? 20);
    let jammed = preventedJam ? false : forcedJam || bestResult >= threshold;
    if (data.jamWasCleared === true) jammed = false;
    const mayFire = !jammed || data.firedDespiteJam === true;
    const pp = success ? Math.max(data.autoSuccess ? 1 : 0, overflow + 1) : 0;
    const sequence = data.bulletSequence ?? data.hitBulletsData ?? [];
    const hitSequence = [];
    let pelletHits = 0;
    const pelletLimit = globalThis.game?.settings?.get("neuroshima", "usePelletCountLimit") ?? true;
    const bulletsFired = Math.max(0, Number(data.bulletsFired ?? 0));

    if (success && mayFire) {
      const shotLimit = data.firedDespiteJam
        ? Math.min(bulletsFired, Number(data.despiteJamBullets) > 0
          ? Number(data.despiteJamBullets)
          : 1)
        : bulletsFired;
      const burstHitStep = Math.max(1, Number(data.burstHitStep ?? 1));
      for (let index = 0; index < shotLimit; index++) {
        if (pp <= Math.floor(index / burstHitStep)) break;
        const bullet = sequence[index] ?? sequence[0];
        if (!bullet) break;
        if (bullet.isPellet) {
          const capacity = Math.max(0, Number(bullet.pelletCount ?? 1) - index);
          let count = Math.max(0, pp - index);
          if (pelletLimit || count > capacity) count = Math.min(count, capacity);
          if (count > 0) {
            pelletHits += count;
            hitSequence.push({
              ...bullet,
              damage: this.constructor.pelletDamageAtDistance(bullet.pelletRanges, data.distance),
              successPoints: count,
              shellIndex: index + 1
            });
          }
        } else {
          hitSequence.push({ ...bullet, successPoints: 1, shellIndex: index + 1 });
        }
      }
    }

    data.bestResult = bestResult;
    data.modifiedResults = results.map((value, index) => ({
      original: value,
      modified: Math.max(1, value - skill - dieReductionBonus),
      isSuccess: isOpen
        ? target - Math.max(1, value - skill - dieReductionBonus) >= 0
        : Math.max(1, value - skill - dieReductionBonus) <= target && value !== 20,
      isBest: value === bestResult,
      isNat1: value === 1,
      isNat20: value === 20,
      index
    }));
    data.success = data.isSuccess = success;
    data.successPoints = successPoints;
    data.successCount = success ? (isOpen ? successPoints : 1) : 0;
    data.isJamming = data.jamming = jammed;
    data.hitBulletsData = hitSequence;
    data.hitBullets = hitSequence.length;
    data.totalPelletSP = pelletHits;
    data.isCritSuccess = bestResult === 1;
    data.isCritFailure = bestResult === 20 || jammed;
    delete data.forceRecalculate;
    this.result.tags.delete("success");
    this.result.tags.delete("failure");
    this.result.tags.delete("jam");
    this.result.tags.add(success ? "success" : "failure");
    if (jammed) this.result.tags.add("jam");
    this.dirty = false;
    return this.result;
  }
}

// Source consolidated from tests/attack/melee-weapon-test.js
export class MeleeWeaponTest extends WeaponTest {
  static classId = "meleeWeapon";
  constructor(data = {}) { super({ ...data, subtype: data.subtype ?? "melee" }); }

  async computeResult(rolled = null) {
    await super.computeResult(rolled);
    await this.recalculate();
    return this.result;
  }

  get opposedResult() {
    return {
      success: this.result.isSuccess,
      successes: this.result.successCount,
      successPoints: this.result.successPoints,
      dice: this.result.rollData?.modifiedResults ?? []
    };
  }

  async resolveDomain(rolled = null) {
    await super.resolveDomain(rolled);
    this.computeMeleeDamageProfiles({
      location: this.result.data.finalLocation,
      damageShift: Number(this.context.damageShift ?? 0),
      damageShift1: Number(this.context.damageShift1 ?? 0),
      damageShift2: Number(this.context.damageShift2 ?? 0),
      damageShift3: Number(this.context.damageShift3 ?? 0)
    });
    this.result.data.isMelee = true;
    this.result.data.meleeAction = this.context.meleeAction ?? "attack";
    this.result.data.piercing = Number(this.item?.system?.piercing ?? 0);
    this.result.data.hitBullets = this.result.data.success ? 1 : 0;
    this.result.data.hitBulletsData = this.result.data.success ? [{
      damage: this.result.data.damage,
      piercing: this.result.data.piercing,
      successPoints: 1,
      isPellet: false
    }] : [];
    return this.result;
  }

  async recalculate() {
    const data = this.result.data;
    const rawResults = [...(data.rawResults ?? data.results ?? [])].map(Number);
    if (!rawResults.length) return this.result;
    const evaluated = {
      target: Number(data.target ?? 0),
      skill: Number(data.skill ?? 0),
      dieReductionBonus: Number(data.dieReductionBonus ?? 0)
    };
    const doubleSkill = globalThis.game?.settings?.get("neuroshima", "doubleSkillAction") === true;
    if (doubleSkill && !data.isOpen) {
      evaluated.modifiedResults = rawResults.map((value, index) => ({
        original: value,
        modified: value,
        isSuccess: value <= evaluated.target && value !== 20,
        isNat1: value === 1,
        isNat20: value === 20,
        index
      }));
      evaluated.successCount = evaluated.modifiedResults.filter(die => die.isSuccess).length;
      evaluated.successPoints = evaluated.successCount;
      evaluated.success = evaluated.successCount > 0;
      evaluated.skillUsed = 0;
      evaluated.remainingSkill = evaluated.skill;
      evaluated.isCritSuccess = rawResults.includes(1);
      evaluated.isCritFailure = rawResults.includes(20);
    } else if (data.isOpen) new Open3d20Evaluator().evaluate(evaluated, rawResults);
    else if (data.isDefending || data.meleeAction === "defense") {
      new Defense3d20Evaluator().evaluate(evaluated, rawResults);
    } else {
      new Closed3d20Evaluator().evaluate(evaluated, rawResults);
    }
    data.modifiedResults = evaluated.modifiedResults;
    data.success = data.isSuccess = data.autoSuccess === true || evaluated.success === true;
    data.successCount = Number(evaluated.successCount ?? 0);
    data.successPoints = data.isOpen
      ? Number(evaluated.successPoints ?? 0)
      : data.successCount;
    data.skillUsed = evaluated.skillUsed;
    data.remainingSkill = evaluated.remainingSkill;
    data.isCritSuccess = Boolean(evaluated.isCritSuccess);
    data.isCritFailure = Boolean(evaluated.isCritFailure);
    data.hitBullets = data.success ? 1 : 0;
    data.hitBulletsData = data.success ? [{
      damage: data.damage,
      piercing: Number(data.piercing ?? this.item?.system?.piercing ?? 0),
      successPoints: 1,
      isPellet: false
    }] : [];
    delete data.forceRecalculate;
    this.result.tags.delete("success");
    this.result.tags.delete("failure");
    this.result.tags.add(data.success ? "success" : "failure");
    this.dirty = false;
    return this.result;
  }
}

// Source consolidated from tests/attack/grenade-test.js
export class GrenadeTest extends AttackTest {
  static classId = "grenade";
  constructor(data = {}) { super({ ...data, type: "grenade" }); }

  /** Evaluate the grenade-specific outcome after the shared attack result. */
  async computeResult(rolled = null) {
    await super.computeResult(rolled);
    this.computeGrenadeResult();
    return this.result;
  }

  async recalculate() {
    await super.recalculate();
    return this.result;
  }

  computeGrenadeResult() {
    const data = this.result.data;
    const domain = this.context.options?.grenadeData ?? this.context.grenadeData ?? {};
    const distance = Number(domain.distance ?? data.distance ?? 0);
    const successCount = Number(data.successCount ?? 0);
    const success = data.success === true;
    const failureMargin = success ? 0 : Math.max(0, 3 - successCount);
    const distanceFactor = distance <= 10 ? 1 : Math.ceil(distance / 10);
    const blastZones = [...(domain.blastZones ?? data.blastZones ?? [])]
      .sort((a, b) => Number(a.radius) - Number(b.radius));
    Object.assign(data, {
      isGrenade: true,
      isSuccess: success,
      actorId: this.actor?.id,
      weaponId: this.item?.id,
      actorImg: this.actor?.prototypeToken?.texture?.src ?? this.actor?.img,
      failureMargin,
      deviationMetres: success ? 0 : failureMargin * distanceFactor,
      distance,
      distancePenalty: Number(domain.distancePenalty ?? data.distancePenalty ?? 0),
      blastZones,
      templateRadius: blastZones.length
        ? Math.max(...blastZones.map(zone => Number(zone.radius) || 0))
        : 0
    });
  }

  /**
   * Consuming the thrown Item is a commit-time side effect. Recalculation,
   * preview and result actions can therefore never consume extra grenades.
   */
  async postTest() {
    await super.postTest();
    if (!this.item?.actor || this.result.cancelled
      || this.context.reroll === true || this.context.edited === true) return;
    const current = Number(this.item.system?.quantity ?? 1);
    const quantity = Math.max(0, current - 1);
    this.queueSideEffect(
      () => this.item.update({ "system.quantity": quantity }),
      { id: `consume-grenade:${this.item.uuid ?? this.item.id}`, document: this.item }
    );
    this.result.data.remainingQuantity = quantity;
  }
}

// --------------------------------------------------
// Opposed tests
// --------------------------------------------------

// Source consolidated from tests/opposed/melee-opposed-resolver.js
/**
 * Composition of two completed melee tests. It never rolls dice and never
 * updates documents; callers remain responsible for presenting and applying
 * the resulting hits.
 */
export class MeleeOpposedResolver {
  constructor(attackerTest, defenderTest, { mode = "opposedSuccesses", context = {} } = {}) {
    this.attackerTest = attackerTest;
    this.defenderTest = defenderTest;
    this.mode = mode;
    this.context = context;
    this.result = null;
  }

  get triggerArgs() {
    return {
      actor: this.attackerTest.actor,
      defenderActor: this.defenderTest.actor,
      item: this.attackerTest.item,
      test: this.attackerTest,
      attackerTest: this.attackerTest,
      defenderTest: this.defenderTest,
      opposedTest: this,
      context: this.context
    };
  }

  async resolve() {
    const runner = this.attackerTest.getScriptRunner();
    await runner.executeEvent("preOpposedAttacker", this.triggerArgs, {
      metadata: { role: "source", item: this.attackerTest.item, opposedTest: this }
    });
    await runner.executeEvent("preOpposedDefender", {
      ...this.triggerArgs,
      actor: this.defenderTest.actor,
      item: this.defenderTest.item
    }, {
      metadata: { role: "target", item: this.defenderTest.item, opposedTest: this }
    });

    // Pre-opposed scripts may alter either completed result.
    if (this.attackerTest.needsRecalculation()) await this.attackerTest.recalculate();
    if (this.defenderTest.needsRecalculation()) await this.defenderTest.recalculate();

    const attacker = this.attackerTest.opposedResult;
    const defender = this.defenderTest.opposedResult;
    const hits = [];
    if (this.mode === "opposedPips") {
      const length = Math.max(attacker.dice.length, defender.dice.length);
      for (let index = 0; index < length; index++) {
        const attackDie = attacker.dice[index];
        const defenseDie = defender.dice[index];
        if (attackDie?.isSuccess
          && (!defenseDie?.isSuccess || attackDie.modified < defenseDie.modified)) {
          hits.push({ tier: index + 1 });
        }
      }
    } else {
      const difference = Number(attacker.successes ?? 0) - Number(defender.successes ?? 0);
      if (difference > 0) hits.push({ tier: Math.min(3, difference) });
    }

    this.result = {
      mode: this.mode,
      attacker,
      defender,
      difference: Number(attacker.successes ?? 0) - Number(defender.successes ?? 0),
      winner: hits.length ? "attacker" : "defender",
      hits
    };

    await runner.executeEvent("opposedAttacker", this.triggerArgs, {
      metadata: { role: "source", item: this.attackerTest.item, opposedTest: this }
    });
    await runner.executeEvent("opposedDefender", {
      ...this.triggerArgs,
      actor: this.defenderTest.actor,
      item: this.defenderTest.item
    }, {
      metadata: { role: "target", item: this.defenderTest.item, opposedTest: this }
    });
    return this.result;
  }

  async calculateDamage(damage = {}) {
    const args = { ...this.triggerArgs, damage };
    await this.attackerTest.getScriptRunner().executeEvent("calculateOpposedDamage", args, {
      metadata: { role: "source", item: this.attackerTest.item, opposedTest: this, damage }
    });
    return args.damage;
  }
}

// --------------------------------------------------
// Factory
// --------------------------------------------------

// Source consolidated from tests/test-class-registry.js
export const TestClassRegistry = new Map();

export function registerTestClass(TestClass) {
  if (!TestClass?.classId) throw new Error("A test class requires static classId");
  TestClassRegistry.set(TestClass.classId, TestClass);
  return TestClass;
}

[
  NeuroshimaTest, AttributeTest, SkillTest, HealingTest, InitiativeTest,
  AttackTest, WeaponTest, RangedWeaponTest, MeleeWeaponTest, GrenadeTest,
  PercentileTest, ReputationTest
].forEach(registerTestClass);

// Source consolidated from tests/test-factory.js
export class NeuroshimaTestFactory {
  static resolveClassId(data = {}) {
    if (data.classId && TestClassRegistry.has(data.classId)) return data.classId;
    const type = data.type ?? data.rollType ?? "attribute";
    const subtype = data.subtype ?? null;
    if (type === "weapon") {
      return ["melee", "meleeFreeDefense"].includes(subtype) ? "meleeWeapon" : "rangedWeapon";
    }
    return {
      attribute: "attribute", skill: "skill", healing: "healing",
      initiative: "initiative", grenade: "grenade", reputation: "reputation"
    }[type] ?? "test";
  }

  static create(data = {}) {
    const classId = this.resolveClassId(data);
    const TestClass = TestClassRegistry.get(classId);
    if (!TestClass) throw new Error(`Unknown Neuroshima test class: ${classId}`);
    return new TestClass(data);
  }

  static async fromData(data = {}) {
    if (!data.classId || !TestClassRegistry.has(data.classId)) {
      throw new Error(`Unknown or missing serialized Neuroshima test class: ${data.classId ?? "<missing>"}`);
    }
    const actor = data.actor ?? (data.actorUuid ? await fromUuid(data.actorUuid) : null);
    const item = data.item ?? (data.itemUuid ? await fromUuid(data.itemUuid) : null);
    const targets = data.targets ?? await Promise.all(
      (data.targetUuids ?? []).map(uuid => fromUuid(uuid))
    );
    const test = this.create({ ...data, actor, item, targets, rollData: data.rollData });
    test.phase = data.phase ?? "complete";
    return test;
  }
}
