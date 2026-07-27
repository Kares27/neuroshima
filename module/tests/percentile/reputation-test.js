import { PercentileTest } from "./percentile-test.js";

export class ReputationTest extends PercentileTest {
  static classId = "reputation";
  constructor(data = {}) { super({ ...data, type: "reputation" }); }
}
