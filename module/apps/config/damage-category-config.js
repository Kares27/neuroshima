export const BUILTIN_DAMAGE_CATEGORIES = ["physical", "explosive"];
export const CONFIGURABLE_DAMAGE_CATEGORIES = ["explosive"];

export function loadCustomDamageCategories() {
  try {
    const value = JSON.parse(game.settings.get("neuroshima", "customDamageCategories") || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

/** Validate the complete category draft before any settings are written. */
export function normalizeDamageCategorySettings(rows = [], builtinLimits = {}, builtinGlobalDamage = {}) {
  const custom = [];
  const limits = {};
  const globalDamage = {};
  const keys = new Set(BUILTIN_DAMAGE_CATEGORIES);
  const readLimit = (key, value) => {
    if (value === "" || value == null) return;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error("Invalid armor category limit");
    limits[key] = number;
  };
  for (const key of CONFIGURABLE_DAMAGE_CATEGORIES) {
    readLimit(key, builtinLimits[key]);
    globalDamage[key] = builtinGlobalDamage[key] !== false;
  }
  for (const row of rows) {
    const key = String(row.key ?? "").trim().replace(/\s+/g, "_").toLowerCase();
    const label = String(row.label ?? "").trim();
    if (!key && !label) continue;
    if (!/^[a-z][a-z0-9_]*$/.test(key) || !label || keys.has(key) || ["constructor", "prototype"].includes(key)) {
      throw new Error("Invalid or duplicate damage category");
    }
    keys.add(key);
    const color = /^#[0-9a-f]{6}$/i.test(row.color ?? "") ? row.color : "#888888";
    custom.push({ key, label, color });
    readLimit(key, row.maxArmor);
    globalDamage[key] = row.globalDamage !== false;
  }
  return { custom, limits, globalDamage };
}

export function _applyCustomDamageCategories(customArray) {
  const config = game.neuroshima?.config;
  if (!config) return;
  for (const key of Object.keys(config.damageCategories)) {
    if (!BUILTIN_DAMAGE_CATEGORIES.includes(key)) delete config.damageCategories[key];
  }
  for (const category of customArray ?? []) {
    if (!category.key || !category.label || BUILTIN_DAMAGE_CATEGORIES.includes(category.key)
      || ["__proto__", "constructor", "prototype"].includes(category.key)) continue;
    config.damageCategories[category.key] = { label: category.label, color: category.color ?? "#888888" };
  }
}
