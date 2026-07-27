import { AttackTest } from "./attack-test.js";

export class WeaponTest extends AttackTest {
  static classId = "weapon";
  constructor(data = {}) { super({ ...data, type: "weapon" }); }

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
