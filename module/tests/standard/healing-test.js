import { SkillTest } from "./skill-test.js";

export class HealingTest extends SkillTest {
  static classId = "healing";
  constructor(data = {}) { super({ ...data, type: "healing" }); }
}
