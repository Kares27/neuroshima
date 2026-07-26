import assert from "node:assert/strict";
import { Closed3d20Evaluator, Open3d20Evaluator } from "../module/tests/evaluators.js";
import { NeuroshimaTest } from "../module/tests/neuroshima-test.js";
import { TestRunner } from "../module/tests/test-runner.js";
import { matchesItemDocumentScope } from "../module/effects/effect-scope.js";

const NeuroshimaScriptRunner = {
  executeEvent: async () => {},
  executeLegacy: async () => {}
};
TestRunner.scriptRunner = NeuroshimaScriptRunner;

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("closed 3d20 produces a stable success result", () => {
  const data = { target: 10, skill: 0, dieReductionBonus: 0 };
  new Closed3d20Evaluator().evaluate(data, [5, 10, 20]);
  assert.equal(data.success, true);
  assert.equal(data.successCount, 2);
  assert.equal(data.modifiedResults.length, 3);
});

test("open 3d20 ignores exactly one die", () => {
  const data = { target: 10, skill: 0, dieReductionBonus: 0 };
  new Open3d20Evaluator().evaluate(data, [4, 9, 17]);
  assert.equal(data.successPoints, 1);
  assert.equal(data.modifiedResults.filter(die => die.ignored).length, 1);
});

test("natural 20 cannot be bought with skill", () => {
  const data = { target: 19, skill: 20, dieReductionBonus: 20 };
  new Closed3d20Evaluator().evaluate(data, [20, 20, 1]);
  assert.equal(data.successCount, 1);
  assert.equal(data.modifiedResults.filter(die => die.isNat20).length, 2);
});

test("closed evaluator spends skill on the cheapest die first", () => {
  const data = { target: 10, skill: 3, dieReductionBonus: 0 };
  new Closed3d20Evaluator().evaluate(data, [11, 12, 19]);
  assert.equal(data.successCount, 2);
  assert.equal(data.skillUsed, 3);
});

test("standard lifecycle fires canonical triggers once and commits last", async () => {
  const events = [];
  NeuroshimaScriptRunner.executeEvent = async trigger => events.push(trigger);
  NeuroshimaScriptRunner.executeLegacy = async trigger => events.push(trigger);
  const subject = new NeuroshimaTest({ actor: {}, type: "skill" });
  subject.queueSideEffect(() => events.push("commit"));
  await TestRunner.run(subject, {
    roll: async () => ({ roll: {}, rawResults: [1, 2, 3] }),
    evaluate: current => {
      current.result.data.success = true;
      current.result.data.successCount = 3;
    },
    legacyAfter: ["postRollTest"]
  });
  assert.deepEqual(events, ["preRollTest", "rollTest", "postRollTest", "commit"]);
});

test("weapon lifecycle includes its specialised pair exactly once", async () => {
  const events = [];
  NeuroshimaScriptRunner.executeEvent = async trigger => events.push(trigger);
  NeuroshimaScriptRunner.executeLegacy = async trigger => events.push(trigger);
  const subject = new NeuroshimaTest({ actor: {}, item: {}, type: "weapon", subtype: "ranged" });
  await TestRunner.run(subject, {
    roll: async () => ({ roll: {}, rawResults: [7] }),
    evaluate: current => { current.result.data.success = true; }
  });
  assert.deepEqual(events, [
    "preRollTest",
    "preRollWeaponTest",
    "rollTest",
    "rollWeaponTest"
  ]);
});

test("cancelled pre trigger performs neither roll nor result triggers", async () => {
  const events = [];
  let rolled = false;
  NeuroshimaScriptRunner.executeEvent = async (trigger, args) => {
    events.push(trigger);
    if (trigger === "preRollTest") args.test.cancel();
  };
  const subject = new NeuroshimaTest({ actor: {}, type: "attribute" });
  const result = await TestRunner.run(subject, {
    roll: async () => { rolled = true; },
    evaluate: () => {}
  });
  assert.equal(result.cancelled, true);
  assert.equal(rolled, false);
  assert.deepEqual(events, ["preRollTest"]);
});

test("legacy preData.autoSuccess skips dice but still reaches result trigger", async () => {
  const events = [];
  let rolled = false;
  NeuroshimaScriptRunner.executeEvent = async (trigger, args) => {
    events.push(trigger);
    if (trigger === "preRollTest") args.test.preData.autoSuccess = true;
  };
  const subject = new NeuroshimaTest({ actor: {}, type: "skill" });
  await TestRunner.run(subject, {
    prepare: current => Object.assign(current.result.data, {
      success: false,
      successCount: 0,
      successPoints: 0
    }),
    roll: async () => { rolled = true; },
    evaluate: () => {}
  });
  assert.equal(rolled, false);
  assert.equal(subject.result.skipped, true);
  assert.equal(subject.result.isSuccess, true);
  assert.deepEqual(events, ["preRollTest", "rollTest"]);
});

test("transformations run once before queued side effects", async () => {
  const events = [];
  NeuroshimaScriptRunner.executeEvent = async trigger => events.push(trigger);
  const subject = new NeuroshimaTest({ actor: {}, type: "attribute" });
  subject.addTransformation(current => {
    current.result.successCount += 1;
    events.push("transform");
  });
  subject.queueSideEffect(current => events.push(`commit:${current.result.successCount}`));
  await TestRunner.run(subject, {
    roll: async () => ({ roll: {}, rawResults: [1, 2, 3] }),
    evaluate: current => {
      current.result.data.success = true;
      current.result.data.successCount = 2;
    }
  });
  assert.deepEqual(events, ["preRollTest", "rollTest", "transform", "commit:3"]);
});

test("preview mode discards queued document changes", async () => {
  let committed = false;
  NeuroshimaScriptRunner.executeEvent = async () => {};
  const subject = new NeuroshimaTest({ actor: {}, type: "attribute" });
  subject.queueSideEffect(() => { committed = true; });
  await TestRunner.run(subject, {
    roll: async () => ({ roll: {}, rawResults: [1, 2, 3] }),
    evaluate: () => {},
    commit: false
  });
  assert.equal(committed, false);
});

test("tests without an actor still evaluate without firing Active Effects", async () => {
  let triggers = 0;
  NeuroshimaScriptRunner.executeEvent = async () => { triggers += 1; };
  const subject = new NeuroshimaTest({ actor: null, type: "attribute" });
  await TestRunner.run(subject, {
    roll: async () => ({ roll: {}, rawResults: [1, 2, 3] }),
    evaluate: current => { current.result.data.success = true; }
  });
  assert.equal(triggers, 0);
  assert.equal(subject.result.isSuccess, true);
});

test("skipRoll and keepRoll expose the same result fields", async () => {
  NeuroshimaScriptRunner.executeEvent = async () => {};
  const runForced = async mode => {
    const subject = new NeuroshimaTest({ actor: {}, type: "skill" });
    subject.forceSuccess({ mode });
    await TestRunner.run(subject, {
      prepare: current => Object.assign(current.result.data, {
        success: false,
        successCount: 0,
        successPoints: 0
      }),
      roll: async () => ({ roll: {}, rawResults: [10, 11, 12] }),
      evaluate: current => { current.result.data.modifiedResults = []; }
    });
    return subject.toLegacyData();
  };
  const skipped = await runForced("skipRoll");
  const kept = await runForced("keepRoll");
  for (const key of ["success", "successCount", "successPoints", "rawResults", "modifiedResults"]) {
    assert.ok(Object.hasOwn(skipped, key), `skipRoll is missing ${key}`);
    assert.ok(Object.hasOwn(kept, key), `keepRoll is missing ${key}`);
  }
  assert.equal(skipped.skipped, true);
  assert.equal(kept.skipped, false);
});

test("item-scoped effects require the exact used item", () => {
  const item = { uuid: "Item.weapon" };
  const script = {
    effect: {
      parent: { documentName: "Item", uuid: item.uuid },
      getFlag: () => "item"
    }
  };
  assert.equal(
    matchesItemDocumentScope(script, "rollTest", null),
    false
  );
  assert.equal(
    matchesItemDocumentScope(script, "rollTest", { uuid: "Item.other" }),
    false
  );
  assert.equal(
    matchesItemDocumentScope(script, "rollTest", item),
    true
  );
});

let failures = 0;
for (const entry of tests) {
  try {
    await entry.run();
    console.log(`✓ ${entry.name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${entry.name}`);
    console.error(error);
  }
}
if (failures) process.exitCode = 1;
