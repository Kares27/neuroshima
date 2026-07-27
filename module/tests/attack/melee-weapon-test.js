import { WeaponTest } from "./weapon-test.js";

export class MeleeWeaponTest extends WeaponTest {
  static classId = "meleeWeapon";
  constructor(data = {}) { super({ ...data, subtype: data.subtype ?? "melee" }); }

  get opposedResult() {
    return {
      success: this.result.isSuccess,
      successes: this.result.successCount,
      successPoints: this.result.successPoints,
      dice: this.result.rollData?.modifiedResults ?? []
    };
  }
}
