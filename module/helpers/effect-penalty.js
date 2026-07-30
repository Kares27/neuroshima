export const EFFECT_PENALTY_KEY = "system.combat.effectPenalty";
export const LEGACY_EFFECT_PENALTY_KEY = "system.combat.generalPenalty";

/**
 * Rename the legacy Active Effect change key without mutating source data.
 *
 * @param {Array<object>} changes
 * @returns {{changes: Array<object>, changed: boolean}}
 */
export function normalizeEffectPenaltyChanges(changes = []) {
  let changed = false;
  const normalized = changes.map(change => {
    if (change?.key !== LEGACY_EFFECT_PENALTY_KEY) return change;
    changed = true;
    return { ...change, key: EFFECT_PENALTY_KEY };
  });
  return { changes: normalized, changed };
}
