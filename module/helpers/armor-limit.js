/** Final armor cap; source values stay intact when the option is toggled. */
export function clampArmor(actor, value) {
  const numeric = Number(value) || 0;
  const group = actor?.type === "creature" ? "Creature"
    : actor?.type === "vehicle" ? "Vehicle"
    : ["character", "npc"].includes(actor?.type) ? "Character" : null;
  if (!group) return numeric;
  try {
    if (!game.settings.get("neuroshima", "armorLimitEnabled")) return numeric;
    const configured = Number(game.settings.get("neuroshima", `armorLimit${group}`));
    const limit = Number.isFinite(configured) ? Math.max(0, configured) : 6;
    return Math.min(numeric, limit);
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
    if (!/^system\.naturalArmor\.[^.]+\.reduction$/.test(key) || event?.target?.name === key) continue;
    const current = foundry.utils.getProperty(actor, key);
    if (clampArmor(actor, current) === Number(current)) continue;
    const source = foundry.utils.getProperty(actor._source, key);
    if (source !== undefined) submitData[key] = source;
  }
}
