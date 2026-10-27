/** Final armor cap; source values stay intact when the option is toggled. */
export function clampArmor(actor, value, damageCategory = "physical") {
  const numeric = Number(value) || 0;
  const group = actor?.type === "creature" ? "Creature"
    : actor?.type === "vehicle" ? "Vehicle"
    : ["character", "npc"].includes(actor?.type) ? "Character" : null;
  try {
    if (!game.settings.get("neuroshima", "armorLimitEnabled")) return numeric;
    const configured = group ? Number(game.settings.get("neuroshima", `armorLimit${group}`)) : Infinity;
    const limit = group ? (Number.isFinite(configured) ? Math.max(0, configured) : 6) : Infinity;
    const categories = game.settings.get("neuroshima", "armorCategoryLimits") ?? {};
    const rawCategoryLimit = damageCategory !== "physical" && Object.hasOwn(categories, damageCategory)
      ? categories[damageCategory] : null;
    const categoryLimit = rawCategoryLimit !== null && rawCategoryLimit !== "" && Number.isFinite(Number(rawCategoryLimit))
      ? Math.max(0, Number(rawCategoryLimit)) : Infinity;
    return Math.min(numeric, limit, categoryLimit);
  } catch { return numeric; }
}

export function refreshArmorLimits() {
  const actors = new Set([...(game.actors ?? []), ...(globalThis.canvas?.tokens?.placeables ?? []).map(t => t.actor)]);
  for (const actor of actors) {
    if (!actor) continue;
    actor.prepareData();
    if (actor.sheet?.rendered) actor.sheet.render({ force: true });
  }
}

/** Capped form previews must not overwrite armor when another field is saved. */
export function preserveArmorSourceValues(actor, event, submitData) {
  for (const key of Object.keys(submitData)) {
    if ((!/^system\.naturalArmor\.[^.]+\.reduction$/.test(key) && key !== "system.naturalArmorReduction") || event?.target?.name === key) continue;
    const current = foundry.utils.getProperty(actor, key);
    if (clampArmor(actor, current) === Number(current)) continue;
    const source = foundry.utils.getProperty(actor._source, key);
    if (source !== undefined) submitData[key] = source;
  }
}
