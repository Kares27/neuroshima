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

/** Normalize missing, legacy, and custom categories to the canonical fallback. */
export function normalizeGearType(gearType) {
  const value = String(gearType ?? "").trim();
  return GEAR_TYPE_KEY_SET.has(value) ? value : "misc";
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
    if (GEAR_TYPE_KEY_SET.has(key)) result[key] = value === true;
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
