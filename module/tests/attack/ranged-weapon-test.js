import { WeaponTest } from "./weapon-test.js";

export class RangedWeaponTest extends WeaponTest {
  static classId = "rangedWeapon";
  constructor(data = {}) { super({ ...data, subtype: data.subtype ?? "ranged" }); }
}
