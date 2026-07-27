import { NeuroshimaTest } from "../neuroshima-test.js";

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
}
