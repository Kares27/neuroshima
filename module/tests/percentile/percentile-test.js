import { NeuroshimaTestBase } from "../base/neuroshima-test-base.js";

export class PercentileTest extends NeuroshimaTestBase {
  static classId = "percentile";
  constructor(data = {}) { super({ ...data, type: data.type ?? "percentile" }); }

  async rollDice() {
    if (this._lifecycleOptions.roll) return super.rollDice();
    const roll = await new Roll("1d100").evaluate();
    const rawResults = [Number(roll.total)];
    this.result.roll = roll;
    this.result.data.rawResults = rawResults;
    return { roll, rawResults };
  }

  async recalculate() {
    if (this._lifecycleOptions.recalculate) return super.recalculate();
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
