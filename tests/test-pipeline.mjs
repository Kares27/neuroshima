import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= { utils: {
  deepClone: value => structuredClone(value),
  mergeObject: (target, source) => Object.assign(target, source)
}};
globalThis.game ??= {
  settings: { get: () => false },
  i18n: { localize: key => key }
};
globalThis.fromUuid ??= async () => null;

const {
  TestRules,
  Closed3d20Evaluator,
  Open3d20Evaluator,
  NeuroshimaTestBase,
  SkillTest,
  RangedWeaponTest,
  GrenadeTest,
  HealingTest,
  MeleeOpposedResolver,
  NeuroshimaTestFactory
} = await import("../module/tests.mjs");

const silentRunner = {
  executeEvent: async () => null,
  executeEventSync: () => null
};

test("closed evaluator resolves three dice", () => {
  const data = new Closed3d20Evaluator().evaluate({ target: 10, skill: 0 }, [5, 11, 20]);
  assert.equal(data.successCount, 1);
  assert.equal(data.success, false);
});

test("open evaluator accepts only two or three dice", () => {
  const evaluator = new Open3d20Evaluator();
  assert.throws(() => evaluator.evaluate({ target: 10 }, [5]), RangeError);
  assert.doesNotThrow(() => evaluator.evaluate({ target: 10 }, [5, 12]));
  assert.doesNotThrow(() => evaluator.evaluate({ target: 10 }, [5, 12, 18]));
  assert.throws(() => evaluator.evaluate({ target: 10 }, [1, 2, 3, 4]), RangeError);
});

test("maximum difficulty clamps the final band", () => {
  const luck = globalThis.NEUROSHIMA?.difficulties?.luck;
  const hard = globalThis.NEUROSHIMA?.difficulties?.hard;
  if (luck && hard) assert.equal(TestRules.clampMaximumDifficulty(luck, "hard"), hard);
  else assert.ok(TestRules.clampMaximumDifficulty);
});

test("base lifecycle uses only canonical triggers", async () => {
  const events = [];
  class ProbeTest extends NeuroshimaTestBase {
    static classId = "probe";
    async rollDice() { return [1, 2, 3]; }
    async computeResult(values) { this.result.data.rawResults = values; }
  }
  const subject = new ProbeTest({ actor: { uuid: "Actor.test" } });
  subject._scriptRunner = {
    executeEvent: async trigger => events.push(trigger),
    executeEventSync: () => null
  };
  await subject.roll({ commit: false });
  assert.deepEqual(events, ["preRollTest", "rollTest"]);
});

test("serialized tests require an exact registered class", async () => {
  await assert.rejects(
    NeuroshimaTestFactory.fromData({ type: "skill", rollData: {} }),
    /missing serialized Neuroshima test class/
  );
  const subject = new SkillTest({
    actor: { uuid: "Actor.test" },
    attribute: { key: "dexterity", value: 12 },
    skill: { key: "firstAid", value: 4 },
    rollData: { rawResults: [2, 8, 15] }
  });
  subject._scriptRunner = silentRunner;
  const serialized = subject.serialize();
  const restored = await NeuroshimaTestFactory.fromData({ ...serialized, actor: subject.actor });
  assert.equal(restored.constructor, SkillTest);
  assert.deepEqual(restored.result.data.rawResults, [2, 8, 15]);
});

test("factory exposes concrete attack and healing classes", () => {
  assert.ok(new RangedWeaponTest() instanceof RangedWeaponTest);
  assert.ok(new GrenadeTest() instanceof GrenadeTest);
  assert.ok(new HealingTest() instanceof HealingTest);
  assert.equal(typeof MeleeOpposedResolver.prototype.resolve, "function");
});
