import { NeuroshimaTest } from "../neuroshima-test.js";

export class SkillTest extends NeuroshimaTest {
  static classId = "skill";
  constructor(data = {}) { super({ ...data, type: data.type ?? "skill" }); }
}
