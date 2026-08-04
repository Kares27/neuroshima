/** Default equipability of built-in gear subtypes. */
export const DEFAULT_EQUIPPABLE_GEAR_TYPES = Object.freeze({
  clothing: true
});

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
  for (const [key, value] of Object.entries(saved)) result[key] = value === true;
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
  return types[String(gearType ?? "misc")] === true;
}
