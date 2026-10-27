const FORMAT = "neuroshima-settings";
const FORMAT_VERSION = 1;
const EXCLUDED_SETTINGS = new Set(["schemaVersion", "meleeSessionsV2World"]);
const JSON_ARRAY_SETTINGS = new Set(["customGearTypes", "currencies", "customDamageCategories"]);
const JSON_OBJECT_SETTINGS = new Set(["gearTypePriceModifiers", "equippableGearTypes"]);
let importing = false;

export class SettingsTransferError extends Error {
  constructor(code, details = {}, cause) {
    super(code, { cause });
    this.code = code;
    this.details = details;
  }
}

/** Include hidden configuration, but never copy migration or combat state. */
export function transferableSettings() {
  return new Map([...game.settings.settings.entries()]
    .filter(([id, definition]) => id.startsWith("neuroshima.") && definition.scope === "world")
    .map(([id, definition]) => [id.slice("neuroshima.".length), definition])
    .filter(([key]) => !EXCLUDED_SETTINGS.has(key)));
}

function requireGM() {
  if (!game.user?.isGM) throw new SettingsTransferError("Permission");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateJSON(value, key) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new SettingsTransferError("InvalidValue", { key });
  for (const [name, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(name)) throw new SettingsTransferError("InvalidValue", { key });
    validateJSON(child, key);
  }
}

function validateValue(key, value, definition) {
  validateJSON(value, key);
  const type = definition.type;
  const valid = type === Boolean ? typeof value === "boolean"
    : type === Number ? typeof value === "number" && Number.isFinite(value)
    : type === String ? typeof value === "string"
    : type === Array ? Array.isArray(value)
    : type === Object ? value !== null && typeof value === "object"
    : false;
  if (!valid) throw new SettingsTransferError("InvalidValue", { key });
  const choices = typeof definition.choices === "function" ? definition.choices() : definition.choices;
  if (choices && !Object.hasOwn(choices, String(value))) throw new SettingsTransferError("InvalidValue", { key });
  if (typeof value === "number" && definition.range
    && (value < definition.range.min || value > definition.range.max)) throw new SettingsTransferError("InvalidValue", { key });
  if (JSON_ARRAY_SETTINGS.has(key) || JSON_OBJECT_SETTINGS.has(key)) {
    let parsed;
    try { parsed = JSON.parse(value); }
    catch (cause) { throw new SettingsTransferError("InvalidValue", { key }, cause); }
    if (JSON_ARRAY_SETTINGS.has(key) ? !Array.isArray(parsed) : !isObject(parsed)) throw new SettingsTransferError("InvalidValue", { key });
    validateJSON(parsed, key);
  }
}

export function exportSystemSettings() {
  requireGM();
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    systemId: "neuroshima",
    systemVersion: game.system.version,
    exportedAt: new Date().toISOString(),
    settings: Object.fromEntries([...transferableSettings()].map(([key]) =>
      [key, structuredClone(game.settings.get("neuroshima", key))]))
  };
}

/** Validate every entry before any writes; absent settings retain their current values. */
export function planSettingsImport(input) {
  let bundle = input;
  if (typeof bundle === "string") {
    try { bundle = JSON.parse(bundle.replace(/^\uFEFF/, "")); }
    catch (cause) { throw new SettingsTransferError("InvalidJSON", {}, cause); }
  }
  if (!isObject(bundle) || bundle.format !== FORMAT || bundle.formatVersion !== FORMAT_VERSION
    || bundle.systemId !== "neuroshima" || !isObject(bundle.settings)) throw new SettingsTransferError("InvalidFile");
  const definitions = transferableSettings();
  const entries = [];
  const skipped = [];
  for (const [key, value] of Object.entries(bundle.settings)) {
    const definition = definitions.get(key);
    if (!definition) { skipped.push(key); continue; }
    validateValue(key, value, definition);
    const previous = game.settings.get("neuroshima", key);
    entries.push({ key, value: structuredClone(value), label: definition.name || key,
      changed: JSON.stringify(previous) !== JSON.stringify(value) });
  }
  if (!entries.length) throw new SettingsTransferError("NoSettings");
  return { entries, skipped, systemVersion: bundle.systemVersion ?? "", changes: entries.filter(entry => entry.changed) };
}

/** Use native setting writes so normal change callbacks also run on import and rollback. */
export async function importSystemSettings(bundle) {
  requireGM();
  if (importing) throw new SettingsTransferError("Busy");
  const plan = planSettingsImport(bundle);
  const previous = new Map(plan.changes.map(({ key }) => [key, structuredClone(game.settings.get("neuroshima", key))]));
  const attempted = [];
  importing = true;
  try {
    for (const { key, value } of plan.changes) {
      attempted.push(key);
      await game.settings.set("neuroshima", key, value);
    }
    return plan;
  } catch (cause) {
    const failed = [];
    for (const key of attempted.reverse()) {
      try { await game.settings.set("neuroshima", key, previous.get(key)); }
      catch { failed.push(key); }
    }
    throw new SettingsTransferError(failed.length ? "RollbackFailed" : "SaveFailed", { keys: failed.join(", ") }, cause);
  } finally { importing = false; }
}
