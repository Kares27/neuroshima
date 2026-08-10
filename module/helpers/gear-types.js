/** Default equipability of built-in gear subtypes. */
export const DEFAULT_EQUIPPABLE_GEAR_TYPES = Object.freeze({
  clothing: true
});

/** The complete, ordered set of categories supported by gear Items. */
export const GEAR_TYPE_KEYS = Object.freeze([
  "stimulants",
  "fuel",
  "medicine",
  "electronics",
  "food",
  "living",
  "services",
  "chemicals",
  "tools",
  "clothing",
  "misc"
]);

const GEAR_TYPE_KEY_SET = new Set(GEAR_TYPE_KEYS);

function isKnownGearType(key) {
  if (GEAR_TYPE_KEY_SET.has(key)
    || Object.prototype.hasOwnProperty.call(globalThis.game?.neuroshima?.config?.gearTypes ?? {}, key)) return true;
  try {
    const custom = JSON.parse(globalThis.game?.settings?.get?.("neuroshima", "customGearTypes") || "[]");
    return Array.isArray(custom) && custom.includes(key);
  } catch (_error) {
    return false;
  }
}

/** Apply the exact, case-sensitive custom category labels to the runtime map. */
export function applyCustomGearTypes(config, entries = []) {
  if (!config?.gearTypes) return;
  for (const key of Object.keys(config.gearTypes)) {
    if (!GEAR_TYPE_KEY_SET.has(key) && key === config.gearTypes[key]) delete config.gearTypes[key];
  }
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = String(entry ?? "").trim();
    if (key && !GEAR_TYPE_KEY_SET.has(key)) config.gearTypes[key] = key;
  }
}

/** Normalize missing, legacy, and custom categories to the canonical fallback. */
export function normalizeGearType(gearType) {
  const value = String(gearType ?? "").trim();
  return isKnownGearType(value) ? value : "misc";
}

/**
 * Parse the world setting that maps gear subtype keys to equipability.
 * Missing and malformed entries are intentionally treated as `false`, except
 * for the built-in defaults above.
 *
 * @param {string|object|null} raw
 * @returns {Record<string, boolean>}
 */
export function parseEquippableGearTypes(raw) {
  let saved = raw;
  if (typeof raw === "string") {
    try {
      saved = JSON.parse(raw || "{}");
    } catch (_error) {
      saved = {};
    }
  }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};

  const result = { ...DEFAULT_EQUIPPABLE_GEAR_TYPES };
  for (const [key, value] of Object.entries(saved)) {
    if (isKnownGearType(key)) result[key] = value === true;
  }
  return result;
}

/** Return the currently configured gear subtype map. */
export function getEquippableGearTypes() {
  const raw = globalThis.game?.settings?.get?.("neuroshima", "equippableGearTypes") ?? "{}";
  return parseEquippableGearTypes(raw);
}

/**
 * Determine whether a gear subtype may use the equipped state.
 *
 * @param {string} gearType
 * @param {Record<string, boolean>|null} [map]
 */
export function isGearTypeEquippable(gearType, map = null) {
  const types = map ?? getEquippableGearTypes();
  return types[normalizeGearType(gearType)] === true;
}

/**
 * Persist the canonical fallback after custom categories are removed.
 * Both world Items and embedded Items (including unlinked-token Actors) are
 * reconciled so their stored value cannot be rendered as the first <select>
 * option merely because the former category no longer exists.
 */
export async function reconcileGearTypes({ equippableTypes = null } = {}) {
  const actors = new Map();
  for (const actor of globalThis.game?.actors ?? []) actors.set(actor.uuid, actor);
  for (const scene of globalThis.game?.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (token.actor) actors.set(token.actor.uuid, token.actor);
    }
  }

  for (const actor of actors.values()) {
    try {
      const updates = actor.items
        .filter(item => item.type === "gear")
        .map(item => {
          const normalized = normalizeGearType(item.system.gearType);
          const update = { _id: item.id };
          if (normalized !== item.system.gearType) update["system.gearType"] = normalized;
          if (item.system.equipped && !isGearTypeEquippable(normalized, equippableTypes)) {
            update["system.equipped"] = false;
          }
          return Object.keys(update).length > 1 ? update : null;
        })
        .filter(Boolean);
      if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    } catch (error) {
      globalThis.game?.neuroshima?.warn?.("[gear types] Embedded Item reconciliation failed", {
        actor: actor.uuid,
        error
      });
    }
  }

  for (const item of globalThis.game?.items ?? []) {
    if (item.type !== "gear") continue;
    const normalized = normalizeGearType(item.system.gearType);
    const update = {};
    if (normalized !== item.system.gearType) update["system.gearType"] = normalized;
    if (item.system.equipped && !isGearTypeEquippable(normalized, equippableTypes)) {
      update["system.equipped"] = false;
    }
    if (!Object.keys(update).length) continue;
    try {
      await item.update(update);
    } catch (error) {
      globalThis.game?.neuroshima?.warn?.("[gear types] World Item reconciliation failed", {
        item: item.uuid,
        error
      });
    }
  }
}
