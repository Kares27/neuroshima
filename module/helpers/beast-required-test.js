/** Post the ability's required test for its target using the native test pipeline. */
export async function postBeastRequiredTest(item, activity, target, runner) {
  if (!target) return 0;
  const resolve = ids => [...new Set(ids ?? [])].map(id => item.effects.get(id)?.uuid).filter(Boolean);
  const always = activity.alwaysEffectIds ?? [];
  await runner.postRequiredTest({
    title: `${activity.name || item.name}: ${target.name}`,
    testType: activity.testType || "attribute",
    testKey: activity.testKey || "constitution",
    testAttributeOverride: activity.testAttributeOverride || "",
    requiredSuccesses: activity.testSuccesses ?? 1,
    isOpen: activity.testIsOpen ?? false,
    baseDifficulty: activity.testDifficulty || "average",
    defenderActorUuid: target.uuid,
    whisperToDefender: true,
    onSuccessEffectUuids: resolve([...(activity.effectIds ?? []), ...always]),
    onFailureEffectUuids: resolve([...(activity.onFailureEffectIds ?? []), ...always])
  });
  return 1;
}

/** Apply selected templates through native conversion so source identity and scripts survive. */
export async function applyBeastEffectIds(item, ids, target, flags = {}) {
  if (!target) return;
  for (const id of new Set(ids ?? [])) {
    const effect = item.effects.get(id);
    if (!effect || effect.disabled) continue;
    const data = effect.convertToApplied?.() ?? effect.toObject();
    delete data._id;
    data.disabled = false;
    data.transfer = false;
    data.origin ||= item.uuid;
    data.flags ??= {};
    data.flags.neuroshima = { ...data.flags.neuroshima, ...flags };
    if (typeof target.applyEffect === "function") await target.applyEffect({ effectData: [data] });
    else await ActiveEffect.implementation.create(data, { parent: target });
  }
}
