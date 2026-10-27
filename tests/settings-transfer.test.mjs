import assert from "node:assert/strict";
import { test } from "node:test";
import { exportSystemSettings, planSettingsImport, importSystemSettings, transferableSettings } from "../module/helpers/settings-transfer.js";

function setup() {
  const values = new Map();
  const registry = new Map();
  const writes = [];
  const register = (key, type, value, extra = {}) => {
    registry.set(`neuroshima.${key}`, { scope: "world", type, ...extra });
    values.set(key, structuredClone(value));
  };
  register("armorLimitEnabled", Boolean, true);
  register("armorLimitCreature", Number, 6);
  register("armorCategoryLimits", Object, { explosive: 3, acid: 2 });
  register("armorCategoryGlobalDamage", Object, { explosive: true, acid: false });
  register("customDamageCategories", String, '[{"key":"acid","label":"Acid","color":"#12ab34"}]');
  register("currencies", String, '[{"name":"Gamble","coinValue":1}]');
  register("conditions", Object, [{ key: "grabbed", scripts: [{ trigger: "dialog", code: "args.flags.grabbed = true;" }] }]);
  register("distancePenalties", Object, { rows: [{ distance: 10, P: 0, SR: null }] });
  register("defaultReputationItems", Array, [{ name: "Town" }]);
  register("patientCardVersion", String, "extended", { choices: { simple: "Simple", extended: "Extended" } });
  register("schemaVersion", String, "2.5");
  register("meleeSessionsV2World", Object, { fight: { actor: "Actor.a" } });
  register("clientPreference", Boolean, true, { scope: "client" });
  registry.set("otherModule.setting", { scope: "world", type: Boolean });
  globalThis.game = { user: { isGM: true }, system: { version: "1.0.1.2" },
    i18n: { localize: key => key, format: (key, data) => `${key} ${JSON.stringify(data)}` },
    settings: { settings: registry, get: (_namespace, key) => structuredClone(values.get(key)),
      async set(namespace, key, value) {
        assert.equal(namespace, "neuroshima");
        writes.push([key, structuredClone(value)]);
        values.set(key, structuredClone(value));
        await registry.get(`neuroshima.${key}`)?.onChange?.(value);
      } }
  };
  return { values, registry, writes, register };
}

test("export includes hidden system configuration and scripts without copying combat, migration or other namespaces", () => {
  const { registry, register } = setup();
  register("futureConfiguration", Boolean, false, { config: false });
  const bundle = exportSystemSettings();
  assert.equal(bundle.format, "neuroshima-settings");
  assert.equal(bundle.formatVersion, 1);
  assert.equal(bundle.systemId, "neuroshima");
  assert.equal(bundle.systemVersion, game.system.version);
  assert.ok(!Number.isNaN(Date.parse(bundle.exportedAt)));
  assert.equal(bundle.settings.futureConfiguration, false);
  assert.equal(bundle.settings.conditions[0].scripts[0].code, "args.flags.grabbed = true;");
  for (const key of ["schemaVersion", "meleeSessionsV2World", "clientPreference", "otherModule.setting"]) {
    assert.equal(Object.hasOwn(bundle.settings, key), false);
  }
  assert.equal(transferableSettings().size, registry.size - 4);
});

test("JSON roundtrip restores tables, category colors and caps, global toggles, conditions and nested scripts", async () => {
  const { values, writes } = setup();
  const source = exportSystemSettings();
  const text = JSON.stringify(source);
  source.settings.conditions[0].scripts[0].code = "changed only in exported object";
  assert.equal(values.get("conditions")[0].scripts[0].code, "args.flags.grabbed = true;");
  values.set("armorLimitEnabled", false);
  values.set("armorCategoryLimits", {});
  values.set("armorCategoryGlobalDamage", {});
  values.set("conditions", []);
  values.set("currencies", "[]");
  const preview = planSettingsImport(text);
  assert.equal(preview.changes.length, 5);
  assert.equal(writes.length, 0);
  const imported = await importSystemSettings(text);
  assert.equal(imported.changes.length, 5);
  for (const [key, value] of Object.entries(JSON.parse(text).settings)) assert.deepEqual(values.get(key), value);
  assert.equal(values.get("schemaVersion"), "2.5");
  assert.equal(values.get("meleeSessionsV2World").fight.actor, "Actor.a");
  const unchanged = await importSystemSettings(text);
  assert.equal(unchanged.changes.length, 0);
  assert.equal(writes.length, 5);
});

test("partial imports preserve absent settings and report skipped obsolete or protected keys", async () => {
  const { values, writes } = setup();
  const bundle = { ...exportSystemSettings(), systemVersion: "older", settings: {
    armorLimitCreature: 9, removedSetting: true, schemaVersion: "1000", meleeSessionsV2World: { foreign: true }, clientPreference: false
  } };
  const plan = await importSystemSettings(bundle);
  assert.equal(values.get("armorLimitCreature"), 9);
  assert.equal(values.get("armorLimitEnabled"), true);
  assert.equal(values.get("schemaVersion"), "2.5");
  assert.deepEqual(plan.skipped, ["removedSetting", "schemaVersion", "meleeSessionsV2World", "clientPreference"]);
  assert.deepEqual(writes, [["armorLimitCreature", 9]]);
});

test("invalid files and invalid values are rejected before the first write", async () => {
  const { writes, values } = setup();
  const source = exportSystemSettings();
  const invalid = ["{invalid", { ...source, systemId: "other" }, { ...source, formatVersion: 2 },
    { ...source, settings: [] }, { ...source, settings: {} },
    { ...source, settings: { armorLimitEnabled: false, armorLimitCreature: "9" } },
    { ...source, settings: { patientCardVersion: "unsupported" } },
    { ...source, settings: { currencies: "not JSON" } },
    { ...source, settings: { customDamageCategories: "{}" } },
    { ...source, settings: { armorCategoryLimits: JSON.parse('{"__proto__":{"injected":true}}') } }];
  for (const bundle of invalid) await assert.rejects(importSystemSettings(bundle));
  assert.equal(writes.length, 0);
  assert.equal(values.get("armorLimitEnabled"), true);
  assert.equal({}.injected, undefined);
  assert.equal(planSettingsImport(`\uFEFF${JSON.stringify(source)}`).entries.length, 10);
});

test("failed save restores previous values, including a setting whose callback fails after persistence", async () => {
  const { values, registry, writes } = setup();
  const calls = [];
  registry.get("neuroshima.armorLimitEnabled").onChange = value => calls.push(value);
  registry.get("neuroshima.armorLimitCreature").onChange = value => { if (value === 9) throw new Error("Failed after save"); };
  const bundle = { ...exportSystemSettings(), settings: { armorLimitEnabled: false, armorLimitCreature: 9 } };
  await assert.rejects(importSystemSettings(bundle), error => error.code === "SaveFailed");
  assert.equal(values.get("armorLimitEnabled"), true);
  assert.equal(values.get("armorLimitCreature"), 6);
  assert.deepEqual(calls, [false, true]);
  assert.equal(writes.length, 4);
});

test("rollback failures are reported separately and only GMs can export or import", async () => {
  const { registry } = setup();
  const bundle = { ...exportSystemSettings(), settings: { armorLimitCreature: 9 } };
  registry.get("neuroshima.armorLimitCreature").onChange = () => { throw new Error("Offline"); };
  await assert.rejects(importSystemSettings(bundle), error => error.code === "RollbackFailed" && error.details.keys === "armorLimitCreature");
  game.user.isGM = false;
  assert.throws(exportSystemSettings, error => error.code === "Permission");
  await assert.rejects(importSystemSettings(bundle), error => error.code === "Permission");
});

test("settings menu reads and previews a file before saving and clears stale data when a bad file is selected", async () => {
  const { values, writes } = setup();
  globalThis.foundry = { applications: { api: { ApplicationV2: class {
    async _prepareContext() { return {}; }
    async render() {}
    async close() {}
  }, HandlebarsApplicationMixin: Base => Base } }, utils: {} };
  const { SettingsTransferConfig } = await import("../module/apps/config/settings-transfer-config.js");
  const bundle = exportSystemSettings();
  values.set("armorLimitCreature", 1);
  const menu = new SettingsTransferConfig();
  const errors = [];
  menu._reportError = error => errors.push(error.code);
  await menu._onChangeForm({}, { target: { name: "settingsFile", files: [{ name: "settings.json", text: async () => JSON.stringify(bundle) }] } });
  assert.equal(writes.length, 0);
  assert.equal((await menu._prepareContext({})).canImport, true);
  assert.equal(menu._plan.changes[0].key, "armorLimitCreature");
  await menu._onChangeForm({}, { target: { name: "settingsFile", files: [{ name: "bad.json", text: async () => "invalid" }] } });
  assert.equal(menu._bundle, null);
  assert.equal((await menu._prepareContext({})).canImport, false);
  assert.deepEqual(errors, ["InvalidJSON"]);
  await menu._onImport();
  assert.equal(writes.length, 0);
  await menu._onChangeForm({}, { target: { name: "settingsFile", files: [{ name: "settings.json", text: async () => JSON.stringify(bundle) }] } });
  let reload;
  globalThis.SettingsConfig = { reloadConfirm: options => { reload = options; } };
  globalThis.ui = { notifications: { info: () => {} } };
  await menu._onImport();
  assert.equal(values.get("armorLimitCreature"), 6);
  assert.equal(writes.length, 1);
  assert.deepEqual(reload, { world: true });
});
