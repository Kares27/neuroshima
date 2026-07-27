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
    if (this._lifecycleOptions.recalculate) return super.recalculate();
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
