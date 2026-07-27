import { NeuroshimaTest } from "../neuroshima-test.js";

export class InitiativeTest extends NeuroshimaTest {
  static classId = "initiative";
  constructor(data = {}) { super({ ...data, type: "initiative" }); }
}
