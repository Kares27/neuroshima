import { TestClassRegistry } from "./test-class-registry.js";

export class NeuroshimaTestFactory {
  static resolveClassId(data = {}) {
    if (data.classId && TestClassRegistry.has(data.classId)) return data.classId;
    const type = data.type ?? data.rollType ?? "attribute";
    const subtype = data.subtype ?? null;
    if (type === "weapon") {
      return ["melee", "meleeFreeDefense"].includes(subtype) ? "meleeWeapon" : "rangedWeapon";
    }
    return {
      attribute: "attribute", skill: "skill", healing: "healing",
      initiative: "initiative", grenade: "grenade", reputation: "reputation"
    }[type] ?? "test";
  }

  static create(data = {}) {
    const classId = this.resolveClassId(data);
    const TestClass = TestClassRegistry.get(classId);
    if (!TestClass) throw new Error(`Unknown Neuroshima test class: ${classId}`);
    return new TestClass(data);
  }

  static async fromData(data = {}) {
    const actor = data.actor ?? (data.actorUuid ? await fromUuid(data.actorUuid) : null);
    const item = data.item ?? (data.itemUuid ? await fromUuid(data.itemUuid) : null);
    const targets = data.targets ?? await Promise.all(
      (data.targetUuids ?? []).map(uuid => fromUuid(uuid))
    );
    const test = this.create({ ...data, actor, item, targets, rollData: data.rollData });
    test.phase = data.phase ?? "complete";
    return test;
  }
}
