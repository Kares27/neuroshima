const ASYNC = "async";
const SYNC = "sync";

const definitions = [
  // Manually Invoked and Document Lifecycle
  ["manual", "Manually Invoked", "manual", ASYNC, ["actor", "item"]],
  ["immediate", "Immediate", "document", ASYNC, ["actor", "item"]],
  ["dialog", "Dialog", "document", ASYNC, ["actor", "item"]],
  ["preUpdateDocument", "Pre-Update Document", "document", ASYNC, ["actor", "item", "effect"]],
  ["update", "On Update", "document", ASYNC, ["actor", "item", "effect"]],
  ["equipToggle", "Equip Toggle", "document", ASYNC, ["item"]],

  // Data preparation (strictly synchronous and mutation-only).
  ["prePrepareData", "Pre-Prepare Data", "data", SYNC, ["actor"]],
  ["prePrepareItems", "Pre-Prepare Actor Items", "data", SYNC, ["actor"]],
  ["prepareData", "Prepare Data", "data", SYNC, ["actor"]],
  ["prepareOwned", "Prepare Owned Data (For Items)", "data", SYNC, ["item"]],
  ["computeCharacteristics", "Compute Characteristics", "data", SYNC, ["actor"]],
  ["computeEncumbrance", "Compute Encumbrance", "data", SYNC, ["actor"]],
  ["preWoundCalc", "Pre-Wound Calculation", "data", SYNC, ["actor"]],
  ["woundCalc", "Wound Calculation", "data", SYNC, ["actor"]],
  ["calculateSize", "Size Calculation", "data", SYNC, ["actor"]],
  ["preAPCalc", "Pre-Armour Calculation", "data", SYNC, ["actor"]],
  ["APCalc", "Armour Calculation", "data", SYNC, ["actor"]],
  ["prePrepareItem", "Pre-Prepare Item", "data", SYNC, ["item"]],
  ["prepareItem", "Prepare Item", "data", SYNC, ["item"]],

  // Damage and conditions.
  ["preApplyDamage", "Pre-Apply Damage", "damage", ASYNC, ["actor", "item"]],
  ["applyDamage", "Apply Damage", "damage", ASYNC, ["actor", "item"]],
  ["preTakeDamage", "Pre-Take Damage", "damage", ASYNC, ["actor", "item"]],
  ["takeDamage", "Take Damage", "damage", ASYNC, ["actor", "item"]],
  ["computeTakeDamageModifiers", "Compute Take Damage Modifiers", "damage", SYNC, ["actor", "item"]],
  ["computeApplyDamageModifiers", "Compute Apply Damage Modifiers", "damage", SYNC, ["actor", "item"]],
  ["preApplyCondition", "Pre-Apply Condition", "conditions", ASYNC, ["actor", "item"]],
  ["applyCondition", "Apply Condition", "conditions", ASYNC, ["actor", "item"]],

  // Tests.
  ["preRollTest", "Pre-Roll Test", "tests", ASYNC, ["actor", "item"]],
  ["preRollWeaponTest", "Pre-Roll Weapon Test", "tests", ASYNC, ["actor", "item"]],
  ["rollTest", "Roll Test", "tests", ASYNC, ["actor", "item"]],
  ["rollWeaponTest", "Roll Weapon Test", "tests", ASYNC, ["actor", "item"]],

  // Opposed tests and initiative.
  ["preOpposedAttacker", "Pre-Opposed Attacker", "opposed", ASYNC, ["actor", "item"]],
  ["preOpposedDefender", "Pre-Opposed Defender", "opposed", ASYNC, ["actor", "item"]],
  ["opposedAttacker", "Opposed Attacker", "opposed", ASYNC, ["actor", "item"]],
  ["opposedDefender", "Opposed Defender", "opposed", ASYNC, ["actor", "item"]],
  ["calculateOpposedDamage", "Calculate Opposed Damage", "opposed", ASYNC, ["actor", "item"]],
  ["getInitiativeFormula", "Get Initiative", "initiative", SYNC, ["actor", "item"]],

  // Token and combat lifecycle.
  ["createToken", "Create Token", "combat", ASYNC, ["actor"]],
  ["deleteEffect", "Effect Deleted", "combat", ASYNC, ["actor", "item", "effect"]],
  ["startCombat", "Start Combat", "combat", ASYNC, ["actor"]],
  ["startRound", "Start Round", "combat", ASYNC, ["actor"]],
  ["startTurn", "Start Turn", "combat", ASYNC, ["actor"]],
  ["updateCombat", "Update Combat", "combat", ASYNC, ["actor"]],
  ["endTurn", "End Turn", "combat", ASYNC, ["actor"]],
  ["endRound", "End Round", "combat", ASYNC, ["actor"]],
  ["endCombat", "End Combat", "combat", ASYNC, ["actor"]],

  // Explicit Neuroshima extensions.
  ["worldTimeUpdate", "World Time Update", "neuroshima", ASYNC, ["actor", "item"]],
  ["getMeleeActions", "Get Melee Actions", "neuroshima", ASYNC, ["actor", "item"]],
  ["beforeMeleeAction", "Before Melee Action", "neuroshima", ASYNC, ["actor", "item"]],
  ["afterMeleeAction", "After Melee Action", "neuroshima", ASYNC, ["actor", "item"]],
  ["beforeMeleeDamage", "Before Melee Damage", "neuroshima", ASYNC, ["actor", "item"]],
  ["afterMeleeDamage", "After Melee Damage", "neuroshima", ASYNC, ["actor", "item"]],
  ["startDuel", "Start Duel", "neuroshima", ASYNC, ["actor", "item"]],
  ["startDuelSegment", "Start Duel Segment", "neuroshima", ASYNC, ["actor", "item"]],
  ["endDuel", "End Duel", "neuroshima", ASYNC, ["actor", "item"]]
];

export const LEGACY_TRIGGER_ALIASES = Object.freeze({
  invoke: "manual",
  oneTime: "immediate",
  addItems: "immediate",
  applyEffect: "immediate",
  prefillDialog: "dialog",
  targetPrefillDialog: "dialog",
  preWeaponShot: "preRollWeaponTest",
  preWeaponTest: "preRollWeaponTest",
  weaponTest: "rollWeaponTest",
  weaponJam: "rollWeaponTest",
  postWeaponShot: "rollWeaponTest",
  postWeaponTest: "rollWeaponTest",
  postRollTest: "rollTest",
  armorCalculation: "APCalc",
  postApplyDamage: "applyDamage",
  postTakeDamage: "takeDamage",
  preMeleePool: "preRollWeaponTest",
  collectMeleeActions: "getMeleeActions",
  onDuelStart: "startDuel",
  onDuelSegmentStart: "startDuelSegment",
  onDuelEnd: "endDuel",
  opposedTest: "opposedAttacker"
});

export class TriggerRegistry {
  static #entries = new Map(definitions.map(([id, label, group, mode, scope]) => [
    id, Object.freeze({ id, label, group, mode, scope: Object.freeze(scope), public: true })
  ]));

  static get size() { return this.#entries.size; }
  static get(id, { resolveLegacy = true } = {}) {
    const canonical = resolveLegacy ? (LEGACY_TRIGGER_ALIASES[id] ?? id) : id;
    return this.#entries.get(canonical) ?? null;
  }
  static canonical(id) { return LEGACY_TRIGGER_ALIASES[id] ?? id; }
  static isLegacy(id) { return Object.hasOwn(LEGACY_TRIGGER_ALIASES, id); }
  static entries() { return [...this.#entries.values()]; }
  static publicOptions() {
    return Object.freeze(Object.fromEntries(this.entries().map(entry => [entry.id, entry.label])));
  }
  static byGroup(group) { return this.entries().filter(entry => entry.group === group); }
  static assertMode(id, expectedMode) {
    const entry = this.get(id);
    if (!entry) throw new Error(`Unknown Active Effect trigger: ${id}`);
    if (entry.mode !== expectedMode) {
      throw new Error(`${id} is ${entry.mode}, not ${expectedMode}`);
    }
    return entry;
  }
}
