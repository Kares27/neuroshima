/** Required tests use two successes when closed, or their configured threshold when open. */
export function requiredTestSuccesses(data = {}) {
  if (data.isOpen !== true) return 2;
  const value = Number(data.requiredSuccesses);
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

export function requiredTestPassed(data, result = {}) {
  const points = Number(result.successPoints ?? result.successes);
  if (!Number.isFinite(points)) return result.isSuccess === true;
  return points >= requiredTestSuccesses(data);
}

/** Convert legacy overlapping outcome lists into one choice per linked effect. */
export function normalizeRequiredEffects(activity = {}) {
  const ids = [...new Set([...(activity.testEffectIds ?? []), ...(activity.effectIds ?? []),
    ...(activity.onFailureEffectIds ?? []), ...(activity.alwaysEffectIds ?? [])])];
  const result = { testEffectIds: ids, effectIds: [], onFailureEffectIds: [], alwaysEffectIds: [] };
  for (const id of ids) {
    const success = activity.effectIds?.includes(id);
    const failure = activity.onFailureEffectIds?.includes(id);
    if (activity.alwaysEffectIds?.includes(id) || (success && failure) || (!success && !failure)) result.alwaysEffectIds.push(id);
    else if (success) result.effectIds.push(id);
    else result.onFailureEffectIds.push(id);
  }
  return result;
}
