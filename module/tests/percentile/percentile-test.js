import { NeuroshimaTestBase } from "../base/neuroshima-test-base.js";

export class PercentileTest extends NeuroshimaTestBase {
  static classId = "percentile";
  constructor(data = {}) { super({ ...data, type: data.type ?? "percentile" }); }
}
