import { TestResult } from "../test-result.js";
import { TestTransformationQueue, SideEffectQueue } from "../test-transformation.js";
import { ResultActionRegistry } from "../result-action-registry.js";

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
    this._lifecycleOptions = {};
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

  async runTrigger(trigger, { phase = null, legacyTriggers = [] } = {}) {
    if (!this.actor || this.context.isDebug) return;
    return this.getScriptRunner().executeEvent(trigger, this.triggerArgs(), {
      legacyTriggers,
      metadata: this.triggerMetadata(phase)
    });
  }

  runSyncTrigger(trigger, { phase = null, legacyTriggers = [] } = {}) {
    if (!this.actor || this.context.isDebug) return null;
    return this.getScriptRunner().executeEventSync(trigger, this.triggerArgs(), {
      legacyTriggers,
      metadata: this.triggerMetadata(phase)
    });
  }

  async runPreEffects() {
    this.phase = "preRollTest";
    await this.runTrigger("preRollTest", { phase: "pre" });
  }

  async runPostEffects() {
    this.phase = "rollTest";
    await this.runTrigger("rollTest", { phase: "result" });
  }

  async begin(options = {}) {
    this._lifecycleOptions = options;
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

  /**
   * Temporary callback bridge. Existing procedural callers supply prepare,
   * roll/evaluate and domain resolve callbacks; concrete classes gradually
   * replace these methods without changing the public lifecycle.
   */
  async prepare() { return this._lifecycleOptions.prepare?.(this); }
  async rollDice() {
    const rolled = await this._lifecycleOptions.roll?.(this);
    this.result.roll = rolled?.roll ?? rolled ?? null;
    if (rolled?.rawResults) this.result.data.rawResults = [...rolled.rawResults];
    return rolled;
  }
  async computeResult(rolled) { return this._lifecycleOptions.evaluate?.(this, rolled); }
  async resolveDomain(rolled) { return this._lifecycleOptions.resolve?.(this, rolled); }
  async recalculate() {
    const callback = this._lifecycleOptions.recalculate;
    if (callback) await callback(this);
    this.dirty = false;
    return this.result;
  }
  needsRecalculation() {
    return this.dirty || Boolean(this._lifecycleOptions.recalculate);
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

  async finish(options = {}) {
    this._lifecycleOptions = { ...this._lifecycleOptions, ...options };
    const before = {
      isSuccess: this.result.isSuccess,
      successCount: this.result.successCount,
      successPoints: this.result.successPoints
    };
    await this.runPostEffects();
    await this.transformations.apply(this);
    await this.resolveResultActions();
    if (this.needsRecalculation()) await this.recalculate();
    await this.applyResultOverrides();
    if (this._lifecycleOptions.synchronize) {
      await this._lifecycleOptions.synchronize(this, before);
    }
    await this._runLegacyAfter(this._lifecycleOptions.legacyAfter ?? []);
    if (this._forcedSuccess) this.result.forceSuccess(this._forcedSuccess);
    this.phase = "postTest";
    await this.postTest();
    this.phase = "commit";
    await this.commitSideEffects(this._lifecycleOptions.commit !== false);
    this.phase = "complete";
    return this.result;
  }

  async roll(options = {}) {
    this._lifecycleOptions = options;
    if (!await this.begin(options)) return this.result;
    this.phase = "prepare";
    await this.prepare();
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
    return this.finish(options);
  }

  async _runLegacyAfter(entries) {
    for (const entry of entries) {
      const trigger = typeof entry === "string" ? entry : entry.trigger;
      const args = typeof entry === "string"
        ? this.triggerArgs()
        : (entry.args?.(this) ?? this.triggerArgs());
      await this.getScriptRunner().executeLegacy(trigger, args, {
        ...this.triggerMetadata("result"), ...(entry.metadata ?? {}), mutable: false
      });
    }
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

  toLegacyData() {
    const data = this.result.toLegacyData();
    data.testType = this.rollType;
    data.testSubtype = this.subtype;
    data.testClassId = this.classId;
    data.testData = this.serialize();
    data.resultActions = this.actions.list().map(({ execute, ...action }) => action);
    return data;
  }
}
