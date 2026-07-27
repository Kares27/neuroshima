import { NeuroshimaTest } from "../neuroshima-test.js";

export class AttributeTest extends NeuroshimaTest {
  static classId = "attribute";
  constructor(data = {}) { super({ ...data, type: "attribute" }); }
}
