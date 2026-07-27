import { NeuroshimaTest } from "./neuroshima-test.js";
import { AttributeTest } from "./standard/attribute-test.js";
import { SkillTest } from "./standard/skill-test.js";
import { HealingTest } from "./standard/healing-test.js";
import { InitiativeTest } from "./standard/initiative-test.js";
import { AttackTest } from "./attack/attack-test.js";
import { WeaponTest } from "./attack/weapon-test.js";
import { RangedWeaponTest } from "./attack/ranged-weapon-test.js";
import { MeleeWeaponTest } from "./attack/melee-weapon-test.js";
import { GrenadeTest } from "./attack/grenade-test.js";
import { PercentileTest } from "./percentile/percentile-test.js";
import { ReputationTest } from "./percentile/reputation-test.js";

export const TestClassRegistry = new Map();

export function registerTestClass(TestClass) {
  if (!TestClass?.classId) throw new Error("A test class requires static classId");
  TestClassRegistry.set(TestClass.classId, TestClass);
  return TestClass;
}

[
  NeuroshimaTest, AttributeTest, SkillTest, HealingTest, InitiativeTest,
  AttackTest, WeaponTest, RangedWeaponTest, MeleeWeaponTest, GrenadeTest,
  PercentileTest, ReputationTest
].forEach(registerTestClass);
