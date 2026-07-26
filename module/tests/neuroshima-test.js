import { TestResult } from "./test-result.js";
import { TestTransformationQueue, SideEffectQueue } from "./test-transformation.js";
import { ResultActionRegistry } from "./result-action-registry.js";

export class NeuroshimaTest {
  constructor({
    type = "attribute",
    subtype = null,
    actor = null,
    item = null,
    targets = [],
    attribute = null,
    skill = null,
    preData = {},
    context = {}
  } = {}) {
    this.rollType = type;
    this.subtype = subtype;
    this.actor = actor;
    this.item = item;
    this.targets = [...targets];
    this.attribute = attribute;
    this.skill = skill;
    this.preData = {
      cancelled: false,
      autoSuccess: false,
      annotations: [],
      ...preData
    };
    this.context = { ...context };
    this.result = new TestResult({
      annotations: [...(this.preData.annotations ?? [])]
    });
    this.transformations = new TestTransformationQueue();
    this.sideEffects = new SideEffectQueue();
    this.actions = new ResultActionRegistry();
    this.phase = "created";
    this._forcedSuccess = null;
  }

  // Compatibility alias used by existing weapon scripts.
  get weapon() { return this.item; }

  cancel(reason = null) {
    this.preData.cancelled = true;
    this.context.cancelReason = reason;
  }

  /**
   * keepRoll evaluates dice and only forces the verdict.
   * skipRoll keeps the exact same TestResult shape without evaluating dice.
   */
  forceSuccess({ mode = "keepRoll", annotation = null } = {}) {
    if (!["keepRoll", "skipRoll"].includes(mode)) {
      throw new Error(`Unsupported force-success mode: ${mode}`);
    }
    this._forcedSuccess = mode;
    this.preData.autoSuccess = true;
    if (annotation) this.preData.annotations.push(annotation);
  }

  addTransformation(transform, options = {}) {
    this.transformations.add(transform, options);
  }

  queueSideEffect(effect, options = {}) {
    this.sideEffects.add(effect, options);
  }

  toLegacyData() {
    const data = this.result.toLegacyData();
    data.testType = this.rollType;
    data.testSubtype = this.subtype;
    data.resultActions = this.actions.list().map(({ execute, ...action }) => action);
    return data;
  }
}
