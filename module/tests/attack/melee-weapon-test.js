import { WeaponTest } from "./weapon-test.js";
import { Closed3d20Evaluator, Defense3d20Evaluator, Open3d20Evaluator } from "../evaluators.js";

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

  async recalculate() {
    if (this._lifecycleOptions.recalculate) return super.recalculate();
    const data = this.result.data;
    const rawResults = [...(data.rawResults ?? data.results ?? [])].map(Number);
    if (!rawResults.length) return this.result;
    const evaluated = {
      target: Number(data.target ?? 0),
      skill: Number(data.skill ?? 0),
      dieReductionBonus: Number(data.dieReductionBonus ?? 0)
    };
    if (data.isOpen) new Open3d20Evaluator().evaluate(evaluated, rawResults);
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
    delete data.forceRecalculate;
    this.result.tags.delete("success");
    this.result.tags.delete("failure");
    this.result.tags.add(data.success ? "success" : "failure");
    this.dirty = false;
    return this.result;
  }
}
