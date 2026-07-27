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
import { HealingTest } from "../module/tests/standard/healing-test.js";
import { GrenadeTest } from "../module/tests/attack/grenade-test.js";

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

test("persistent trick reductions are owned by class recalculation", async () => {
  const subject = new NeuroshimaTest({
    context: {
      applyDiceDifficultyShift: false,
      applySkillDifficultyShift: false
    },
    rollData: {
      rawResults: [8, 11, 18],
      stat: 10,
      baseDifficulty: { label: "average", mod: 0 },
      finalDifficultyShift: 0,
      skill: 0,
      isOpen: false,
      manualDieReductions: { 1: 2 }
    }
  });
  await subject.recalculate();
  assert.equal(subject.result.data.modifiedResults[1].modified, 9);
  assert.equal(subject.result.data.successCount, 2);
  assert.equal(subject.result.data.success, true);
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
  for (const entry of TriggerRegistry.entries()) {
    assert.ok(["sync", "async"].includes(entry.mode), `${entry.id} has a valid mode`);
    assert.ok(entry.scope.length > 0, `${entry.id} declares its document scope`);
    assert.equal(entry.public, true, `${entry.id} is public`);
  }
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

test("initiative test owns and commits the combatant update once", async () => {
  let updates = 0;
  const combatant = {
    update: async change => {
      updates += 1;
      assert.equal(change.initiative, 4);
    }
  };
  const subject = NeuroshimaTestFactory.create({
    type: "initiative",
    context: { combatant }
  });
  subject.result.data = { initiative: 4, successPoints: 4 };
  await subject.postTest();
  await subject.commitSideEffects();
  await subject.commitSideEffects();
  assert.equal(updates, 1);
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
  assert.equal(RangedWeaponTest.bulletsForBurst(weapon, 1), 7);
  assert.equal(RangedWeaponTest.bulletsForBurst(weapon, 2), 21);
  assert.equal(RangedWeaponTest.bulletsForBurst(weapon, 3), 42);
});

test("ranged pellet golden master applies shell capacity, range damage and burst step", async () => {
  const subject = NeuroshimaTestFactory.create({ type: "weapon", subtype: "ranged" });
  subject.result.data = {
    rawResults: [1, 10, 15],
    target: 10,
    skill: 0,
    isOpen: true,
    jammingThreshold: 20,
    bulletsFired: 2,
    burstHitStep: 2,
    distance: 4,
    bulletSequence: Array.from({ length: 2 }, () => ({
      isPellet: true,
      pelletCount: 4,
      pelletRanges: {
        range1: { distance: 5, damage: "C" },
        range2: { distance: 10, damage: "L" },
        range3: { distance: 20, damage: "D" },
        range4: { distance: 30, damage: "D" }
      }
    }))
  };
  await subject.recalculate();
  assert.equal(subject.result.data.hitBullets, 2);
  assert.equal(subject.result.data.totalPelletSP, 7);
  assert.deepEqual(
    subject.result.data.hitBulletsData.map(hit => [hit.damage, hit.successPoints]),
    [["C", 4], ["C", 3]]
  );
});

test("jam golden master limits despite-jam fire to one bullet by default", async () => {
  const subject = NeuroshimaTestFactory.create({ type: "weapon", subtype: "ranged" });
  subject.result.data = {
    rawResults: [18],
    target: 20,
    skill: 0,
    isOpen: true,
    jammingThreshold: 18,
    firedDespiteJam: true,
    bulletsFired: 4,
    bulletSequence: Array.from({ length: 4 }, () => ({ damage: "L" }))
  };
  await subject.recalculate();
  assert.equal(subject.result.data.isJamming, true);
  assert.equal(subject.result.data.hitBullets, 1);
});

test("legacy weapon payload is executed by the concrete class lifecycle", async () => {
  const previousGame = globalThis.game;
  const PreviousRoll = globalThis.Roll;
  globalThis.game = {
    settings: {
      get: (_scope, key) => ({
        meleeBonusMode: "attribute",
        allowCombatShift: true,
        usePelletCountLimit: true,
        doubleSkillAction: false
      })[key]
    },
    i18n: { localize: value => value },
    neuroshima: { NeuroshimaScriptRunner }
  };
  globalThis.Roll = class {
    constructor(formula) {
      this.formula = formula;
      const count = Number.parseInt(formula, 10);
      this.terms = [{ results: Array.from({ length: count }, () => ({ result: 10 })) }];
    }
    async evaluate() { return this; }
  };
  const weapon = {
    id: "weapon",
    name: "Karabin",
    system: {
      weaponType: "ranged",
      attribute: "dexterity",
      skill: "shooting",
      damage: "L",
      piercing: 0,
      jamming: 20,
      fireRate: 3,
      skipMagazineCheck: true
    },
    update: async () => {}
  };
  const actor = {
    id: "actor",
    img: "actor.webp",
    type: "character",
    system: {
      attributeTotals: { dexterity: 12 },
      skills: { shooting: { value: 2 } },
      combat: { totalArmorPenalty: 0, totalWoundPenalty: 0 }
    },
    items: new Map()
  };
  const subject = RangedWeaponTest.fromLegacyParameters({
    actor,
    weapon,
    difficulty: "average",
    aimingLevel: 2,
    burstLevel: 1,
    hitLocation: "torso",
    fixedDice: [2, 10, 18]
  });
  subject._scriptRunner = NeuroshimaScriptRunner;
  await subject.roll();
  assert.equal(subject.classId, "rangedWeapon");
  assert.deepEqual(subject.result.data.rawResults, [2, 10, 18]);
  assert.equal(subject.result.data.bulletsFired, 3);
  assert.equal(subject.result.isSuccess, true);
  assert.equal(subject.phase, "complete");
  globalThis.game = previousGame;
  globalThis.Roll = PreviousRoll;
});

test("direct ranged lifecycle commits ammunition exactly once", async () => {
  const previousGame = globalThis.game;
  const PreviousRoll = globalThis.Roll;
  let magazineUpdates = 0;
  globalThis.game = {
    settings: {
      get: (_scope, key) => ({
        meleeBonusMode: "attribute",
        allowCombatShift: true,
        usePelletCountLimit: true,
        doubleSkillAction: false,
        fireCorrection: false
      })[key]
    },
    i18n: { localize: value => value },
    neuroshima: { NeuroshimaScriptRunner }
  };
  globalThis.Roll = class {
    constructor(formula) {
      this.formula = formula;
      const count = Number.parseInt(formula, 10);
      this.terms = [{ results: Array.from({ length: count }, () => ({ result: 2 })) }];
    }
    async evaluate() { return this; }
  };
  const magazine = {
    type: "magazine",
    system: {
      contents: [{ name: "standard", quantity: 5, overrides: {} }]
    },
    update: async () => { magazineUpdates += 1; }
  };
  const weapon = {
    id: "weapon",
    name: "PM",
    system: {
      weaponType: "ranged",
      attribute: "dexterity",
      skill: "shooting",
      damage: "L",
      piercing: 0,
      jamming: 20,
      fireRate: 3,
      magazine: "magazine"
    },
    update: async () => {}
  };
  const actor = {
    id: "actor",
    type: "character",
    system: {
      attributeTotals: { dexterity: 12 },
      skills: { shooting: { value: 1 } },
      combat: {}
    },
    items: new Map([["magazine", magazine]])
  };
  const subject = RangedWeaponTest.fromLegacyParameters({
    actor,
    weapon,
    difficulty: "average",
    aimingLevel: 2,
    burstLevel: 1,
    hitLocation: "torso",
    fixedDice: [2, 5, 8]
  });
  subject._scriptRunner = NeuroshimaScriptRunner;
  await subject.roll();
  await subject.commitSideEffects();
  assert.equal(magazineUpdates, 1);
  assert.equal(magazine.system.contents[0].quantity, 5);
  globalThis.game = previousGame;
  globalThis.Roll = PreviousRoll;
});

test("healing golden master owns first-aid and treatment calculations", () => {
  const wound = {
    id: "wound",
    name: "Rana ciężka",
    system: {
      penalty: 20,
      originalPenalty: 20,
      damageType: "C",
      firstAidHealingApplied: 0
    }
  };
  const firstAid = new HealingTest({ context: { healingMethod: "firstAid" } });
  const treatment = new HealingTest({ context: { healingMethod: "woundTreatment" } });
  assert.equal(firstAid.computeHealingResult(wound, 2).newPenalty, 15);
  assert.equal(firstAid.computeHealingResult(wound, 1).newPenalty, 25);
  assert.equal(treatment.computeHealingResult(wound, 2, { hadFirstAid: false }).newPenalty, 5);
  assert.equal(treatment.computeHealingResult(wound, 2, { hadFirstAid: true }).newPenalty, 10);
});

test("grenade lifecycle consumes one item only at commit", async () => {
  const previousGame = globalThis.game;
  const PreviousRoll = globalThis.Roll;
  let updates = 0;
  const item = {
    id: "grenade",
    uuid: "Actor.actor.Item.grenade",
    name: "Granat",
    actor: {},
    system: {
      quantity: 2,
      attribute: "dexterity",
      skill: "throwing",
      blastZones: [{ radius: 3 }]
    },
    async update(change) {
      updates += 1;
      this.system.quantity = change["system.quantity"];
    }
  };
  const actor = {
    id: "actor",
    img: "actor.webp",
    system: {
      attributeTotals: { dexterity: 12 },
      attributes: { constitution: 10 },
      skills: { throwing: { value: 1 } },
      combat: { totalWoundPenalty: 0 }
    }
  };
  globalThis.game = {
    settings: { get: () => true },
    user: { isGM: false },
    neuroshima: { NeuroshimaScriptRunner }
  };
  globalThis.Roll = class {
    constructor(formula) {
      this.formula = formula;
      this.terms = [{ results: [2, 6, 14].map(result => ({ result })) }];
    }
    async evaluate() { return this; }
  };
  const subject = GrenadeTest.fromLegacyParameters({
    actor,
    weapon: item,
    distance: 12,
    distancePenalty: 10
  });
  subject._scriptRunner = NeuroshimaScriptRunner;
  await subject.roll();
  await subject.recalculate();
  await subject.commitSideEffects();
  assert.equal(updates, 1);
  assert.equal(item.system.quantity, 1);
  assert.equal(subject.result.data.distance, 12);
  globalThis.game = previousGame;
  globalThis.Roll = PreviousRoll;
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
