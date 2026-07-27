import { AttackTest } from "./attack-test.js";

export class GrenadeTest extends AttackTest {
  static classId = "grenade";
  constructor(data = {}) { super({ ...data, type: "grenade" }); }
}
