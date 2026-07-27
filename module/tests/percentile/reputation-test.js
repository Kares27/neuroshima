import { PercentileTest } from "./percentile-test.js";

export class ReputationTest extends PercentileTest {
  static classId = "reputation";
  constructor(data = {}) { super({ ...data, type: "reputation" }); }

  async prepare() {
    if (this._lifecycleOptions.prepare) return super.prepare();
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
    if (this._lifecycleOptions.evaluate) return super.computeResult(rolled);
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
