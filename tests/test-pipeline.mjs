import assert from "node:assert/strict";
import { Closed3d20Evaluator, Open3d20Evaluator } from "../module/tests/evaluators.js";
import { NeuroshimaTest } from "../module/tests/neuroshima-test.js";
import { TestRunner } from "../module/tests/test-runner.js";
import { matchesItemDocumentScope } from "../module/effects/effect-scope.js";
import { NeuroshimaTestFactory } from "../module/tests/test-factory.js";
import { TriggerRegistry, automaticLegacyTriggersFor } from "../module/effects/trigger-registry.js";
import { MeleeOpposedResolver } from "../module/tests/opposed/melee-opposed-resolver.js";
import { RangedWeaponTest } from "../module/tests/attack/ranged-weapon-test.js";
import { AttackTest } from "../module/tests/attack/attack-test.js";

const NeuroshimaScriptRunner = {
  executeEvent: async () => {},
  executeLegacy: async () => {},
  executeEventSync: () => {}
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

test("factory selects stable concrete test classes", () => {
  assert.equal(NeuroshimaTestFactory.create({ type: "attribute" }).classId, "attribute");
  assert.equal(NeuroshimaTestFactory.create({ type: "skill" }).classId, "skill");
  assert.equal(NeuroshimaTestFactory.create({ type: "initiative" }).classId, "initiative");
  assert.equal(
    NeuroshimaTestFactory.create({ type: "weapon", subtype: "ranged" }).classId,
    "rangedWeapon"
  );
  assert.equal(
    NeuroshimaTestFactory.create({ type: "weapon", subtype: "melee" }).classId,
    "meleeWeapon"
  );
  assert.equal(NeuroshimaTestFactory.create({ type: "reputation" }).classId, "reputation");
});

test("weapon trigger order is inherited by the concrete class", async () => {
  const events = [];
  NeuroshimaScriptRunner.executeEvent = async trigger => events.push(trigger);
  const subject = NeuroshimaTestFactory.create({
    actor: {}, type: "weapon", subtype: "ranged"
  });
  await TestRunner.run(subject, {
    roll: async () => ({ roll: {}, rawResults: [5, 10, 15] }),
    evaluate: current => { current.result.data.success = true; }
  });
  assert.equal(subject.classId, "rangedWeapon");
  assert.deepEqual(events, [
    "preRollTest", "preRollWeaponTest", "rollTest", "rollWeaponTest"
  ]);
});

test("serialized tests preserve their stable class id", () => {
  const subject = NeuroshimaTestFactory.create({
    type: "weapon", subtype: "melee", preData: { autoSuccess: true }
  });
  const serialized = subject.serialize();
  assert.equal(serialized.classId, "meleeWeapon");
  assert.equal(serialized.preData.autoSuccess, true);
  assert.equal(subject.toLegacyData().testClassId, "meleeWeapon");
});

test("trigger registry exposes exactly 55 public triggers and hides aliases", () => {
  assert.equal(TriggerRegistry.size, 55);
  assert.equal(TriggerRegistry.get("preRollWeaponTest").mode, "async");
  assert.equal(TriggerRegistry.get("prePrepareData").mode, "sync");
  assert.equal(TriggerRegistry.canonical("preMeleePool"), "preRollWeaponTest");
  assert.equal(TriggerRegistry.isLegacy("collectMeleeActions"), true);
  assert.equal(Object.hasOwn(TriggerRegistry.publicOptions(), "preMeleePool"), false);
});

test("only contract-compatible legacy aliases dispatch automatically", () => {
  assert.ok(automaticLegacyTriggersFor("rollTest").includes("postRollTest"));
  assert.ok(!automaticLegacyTriggersFor("getMeleeActions").includes("collectMeleeActions"));
  assert.ok(!automaticLegacyTriggersFor("rollWeaponTest").includes("weaponJam"));
  assert.ok(!automaticLegacyTriggersFor("preRollWeaponTest").includes("preMeleePool"));
});

test("reputation percentile class computes and recalculates its own result", async () => {
  const subject = NeuroshimaTestFactory.create({
    type: "reputation",
    attribute: { value: 45 },
    preData: { label: "Reputacja" }
  });
  await subject.prepare();
  subject.result.data.rawResults = [40];
  await subject.computeResult();
  assert.equal(subject.result.isSuccess, true);
  subject.result.data.rawResults = [60];
  await subject.recalculate();
  assert.equal(subject.result.isSuccess, false);
  assert.equal(subject.result.successPoints, -15);
});

test("ranged weapon recalculate rebuilds jam, hits and result from changed dice", async () => {
  const subject = NeuroshimaTestFactory.create({ type: "weapon", subtype: "ranged" });
  subject.result.data = {
    isWeapon: true,
    rawResults: [4, 12, 17],
    target: 10,
    skill: 2,
    isOpen: true,
    jammingThreshold: 18,
    bulletsFired: 3,
    bulletSequence: [
      { damage: "L", piercing: 0 },
      { damage: "L", piercing: 0 },
      { damage: "L", piercing: 0 }
    ]
  };
  await subject.recalculate();
  assert.equal(subject.result.isSuccess, true);
  assert.equal(subject.result.data.isJamming, false);
  assert.equal(subject.result.data.hitBullets, 3);
  subject.result.data.rawResults = [18, 19, 20];
  await subject.recalculate();
  assert.equal(subject.result.data.isJamming, true);
  assert.equal(subject.result.data.hitBullets, 0);
});

test("result overrides are applied after domain recalculation", async () => {
  const subject = NeuroshimaTestFactory.create({ type: "attribute" });
  subject.result.data = {
    success: false, successCount: 0, successPoints: 0,
    effectActionSuccessBonus: 1
  };
  await subject.applyResultOverrides();
  assert.equal(subject.result.isSuccess, true);
  assert.equal(subject.result.successCount, 1);
});

test("melee weapon recalculates its pool without using the ranged resolver", async () => {
  const subject = NeuroshimaTestFactory.create({ type: "weapon", subtype: "melee" });
  subject.result.data = {
    rawResults: [5, 11, 18],
    target: 10,
    skill: 1,
    isOpen: false,
    meleeAction: "attack"
  };
  await subject.recalculate();
  assert.equal(subject.classId, "meleeWeapon");
  assert.equal(subject.result.successCount, 2);
  assert.equal(subject.result.isSuccess, true);
  assert.equal(subject.opposedResult.dice.length, 3);
});

test("grenade domain result owns deviation and blast calculations", () => {
  const subject = NeuroshimaTestFactory.create({
    type: "grenade",
    context: {
      options: {
        grenadeData: {
          distance: 24,
          distancePenalty: 12,
          blastZones: [{ radius: 2 }, { radius: 5 }]
        }
      }
    }
  });
  subject.result.data = { success: false, successCount: 1 };
  subject.computeGrenadeResult();
  assert.equal(subject.result.data.failureMargin, 2);
  assert.equal(subject.result.data.deviationMetres, 6);
  assert.equal(subject.result.data.templateRadius, 5);
});

test("initiative formula is finalized inside InitiativeTest", () => {
  const subject = NeuroshimaTestFactory.create({ type: "initiative", actor: {} });
  subject._scriptRunner = NeuroshimaScriptRunner;
  subject.result.data = { successPoints: 3 };
  NeuroshimaScriptRunner.executeEventSync = (_trigger, args) => {
    args.initiative += 2;
  };
  subject.computeInitiative();
  assert.equal(subject.result.data.initiative, 5);
  assert.equal(subject.result.successPoints, 5);
  NeuroshimaScriptRunner.executeEventSync = () => {};
});

test("melee opposed resolver composes completed tests and fires both sides", async () => {
  const events = [];
  NeuroshimaScriptRunner.executeEvent = async trigger => events.push(trigger);
  const attacker = NeuroshimaTestFactory.create({
    classId: "meleeWeapon",
    actor: { id: "attacker" },
    rollData: {
      success: true,
      successCount: 2,
      successPoints: 2,
      modifiedResults: [
        { modified: 4, isSuccess: true },
        { modified: 8, isSuccess: true }
      ]
    }
  });
  const defender = NeuroshimaTestFactory.create({
    classId: "meleeWeapon",
    actor: { id: "defender" },
    rollData: {
      success: true,
      successCount: 1,
      successPoints: 1,
      modifiedResults: [{ modified: 6, isSuccess: true }]
    }
  });
  attacker._scriptRunner = defender._scriptRunner = NeuroshimaScriptRunner;
  const resolver = new MeleeOpposedResolver(attacker, defender);
  const result = await resolver.resolve();
  assert.equal(result.winner, "attacker");
  assert.equal(result.hits[0].tier, 1);
  assert.deepEqual(events, [
    "preOpposedAttacker",
    "preOpposedDefender",
    "opposedAttacker",
    "opposedDefender"
  ]);
});

test("ranged ammunition planning is LIFO and does not mutate the magazine", () => {
  const contents = [
    { name: "standard", quantity: 2, overrides: {} },
    { name: "special", quantity: 2, overrides: { enabled: true, damage: "C", piercing: 2 } }
  ];
  const magazine = { type: "magazine", system: { contents } };
  const actor = { items: new Map([["mag", magazine]]) };
  const weapon = {
    name: "rifle",
    system: {
      weaponType: "ranged",
      magazine: "mag",
      damage: "L",
      piercing: 0,
      jamming: 20
    }
  };
  const plan = RangedWeaponTest.planAmmunition(actor, weapon, 3);
  assert.equal(plan.bulletsFired, 3);
  assert.deepEqual(plan.bulletSequence.map(bullet => bullet.name), ["special", "special", "standard"]);
  assert.equal(plan.damage, "C");
  assert.equal(plan.piercing, 2);
  assert.equal(contents[1].quantity, 2);
});

test("attack damage profiles apply the head shift once and clamp at K", () => {
  const subject = new AttackTest({
    item: {
      system: {
        damageMelee1: "C",
        damageMelee2: "K",
        damageMelee3: "sK"
      }
    }
  });
  const profiles = subject.computeMeleeDamageProfiles({ location: "head" });
  assert.deepEqual(profiles, ["K", "K", "sK"]);
  assert.equal(subject.result.data.headDamageApplied, true);
});

test("weapon burst planning preserves single, short and full fire rates", () => {
  const weapon = { system: { weaponType: "ranged", fireRate: 7 } };
  assert.equal(RangedWeaponTest.bulletsForBurst(weapon, 0), 1);
  assert.equal(RangedWeaponTest.bulletsForBurst(weapon, 1), 3);
  assert.equal(RangedWeaponTest.bulletsForBurst(weapon, 2), 7);
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
