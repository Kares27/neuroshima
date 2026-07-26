/**
 * Active Effect triggers exposed to users.
 *
 * Naming follows the WFRP-style lifecycle: preX -> X. A trigger is a concrete
 * dropdown choice; scripts do not need separate context filters.
 */
export const EFFECT_TRIGGER_SCHEMA_VERSION = 3;

export const EFFECT_TRIGGERS = Object.freeze({
  manual: "Manually Invoked",
  immediate: "Immediate",
  dialog: "Dialog",
  prepareData: "Prepare Data",
  getInitiativeFormula: "Get Initiative Formula",

  preRollTest: "Pre-Roll Test",
  preRollWeaponTest: "Pre-Roll Weapon Test",
  rollTest: "Roll Test",
  rollWeaponTest: "Roll Weapon Test",

  preApplyDamage: "Pre-Apply Damage",
  applyDamage: "Apply Damage",
  preTakeDamage: "Pre-Take Damage",
  takeDamage: "Take Damage",
  preAPCalc: "Pre-Armour Calculation",
  APCalc: "Armour Calculation",

  equipToggle: "Equip Toggle",
  startCombat: "Start Combat",
  updateCombat: "Update Combat",
  startRound: "Start Round",
  startTurn: "Start Turn",
  endTurn: "End Turn",
  endRound: "End Round",
  endCombat: "End Combat",
  createToken: "Create Token",
  applyEffect: "Effect Applied",
  deleteEffect: "Effect Deleted",
  worldTimeUpdate: "World Time Update",
  preApplyCondition: "Pre-Apply Condition",
  applyCondition: "Apply Condition",

  preMeleePool: "Pre-Melee Pool",
  preOpposedAttacker: "Pre-Opposed Attacker",
  preOpposedDefender: "Pre-Opposed Defender",
  getMeleeActions: "Get Melee Actions",
  collectMeleeActions: "Collect Melee Actions",
  opposedAttacker: "Opposed Attacker",
  opposedDefender: "Opposed Defender",
  calculateOpposedDamage: "Calculate Opposed Damage",
  beforeMeleeAction: "Before Melee Action",
  afterMeleeAction: "After Melee Action",
  beforeMeleeDamage: "Before Melee Damage",
  afterMeleeDamage: "After Melee Damage",
  onDuelStart: "On Duel Start",
  onDuelSegmentStart: "On Duel Segment Start",
  onDuelEnd: "On Duel End"
});

// Read-only compatibility names. They are not shown for new scripts.
export const LEGACY_EFFECT_TRIGGERS = Object.freeze({
  preWeaponShot: "preRollWeaponTest",
  weaponJam: "rollWeaponTest",
  postWeaponShot: "rollWeaponTest",
  preWeaponTest: "preRollWeaponTest",
  weaponTest: "rollWeaponTest",
  postWeaponTest: "rollWeaponTest",
  postRollTest: "rollTest",
  postApplyDamage: "applyDamage",
  postTakeDamage: "takeDamage",
  armorCalculation: "APCalc",
  opposedTest: "opposedAttacker"
});

export function createTriggerContext(trigger, args = {}, metadata = {}) {
  return {
    schemaVersion: EFFECT_TRIGGER_SCHEMA_VERSION,
    trigger,
    type: metadata.type ?? args.test?.rollType ?? null,
    subtype: metadata.subtype ?? null,
    edited: metadata.edited === true || args.test?.context?.edited === true,
    reroll: metadata.reroll === true || args.test?.context?.reroll === true,
    tags: Array.isArray(metadata.tags) ? [...metadata.tags] : [],
    actor: args.actor ?? null,
    item: metadata.item ?? args.item ?? args.weapon ?? null,
    test: metadata.test ?? args.test ?? null,
    roll: metadata.roll ?? args.roll ?? args.test?.result?.roll ?? null,
    result: metadata.result ?? args.rollData ?? args.test?.result?.rollData ?? null,
    weapon: args.weapon ?? metadata.item ?? null,
    damage: metadata.damage ?? args.attackData ?? args.damageResult ?? null,
    duel: metadata.duel ?? args.duel ?? null,
    segment: metadata.segment ?? args.segment ?? null,
    phase: metadata.phase ?? null,
    legacyTrigger: metadata.legacyTrigger ?? null
  };
}
