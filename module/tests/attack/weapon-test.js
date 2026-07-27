import { AttackTest } from "./attack-test.js";

export class WeaponTest extends AttackTest {
  static classId = "weapon";
  constructor(data = {}) { super({ ...data, type: "weapon" }); }

  /**
   * Compatibility constructor for the historical flat dialog payload. The
   * concrete subclass is selected before this method is called, so callers no
   * longer branch over weapon types outside TestFactory.
   */
  static async rollFromLegacy(params, evaluateLegacy) {
    if (typeof evaluateLegacy !== "function") {
      throw new TypeError("WeaponTest.rollFromLegacy requires a legacy evaluator");
    }
    return evaluateLegacy(params);
  }

  async prepare() {
    await super.prepare();
    const data = this.result.data;
    data.isWeapon = true;
    data.weaponId = this.item?.id ?? null;
    data.weaponType = this.item?.system?.weaponType ?? this.subtype;
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
    if (this._lifecycleOptions.roll) return super.rollDice();
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

  async runPreEffects() {
    await super.runPreEffects();
    if (!this.preData.cancelled) {
      await this.runTrigger("preRollWeaponTest", {
        phase: "pre",
        legacyTriggers: ["preWeaponTest"]
      });
    }
  }

  async runPostEffects() {
    await super.runPostEffects();
    await this.runTrigger("rollWeaponTest", {
      phase: "result",
      legacyTriggers: ["weaponTest"]
    });
  }
}
