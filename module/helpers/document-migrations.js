import { normalizeEmbeddedEffects, effectChanges, effectChangesUpdate, normalizeEffectData, normalizeEffectPenaltyChanges, isV14 } from "./foundry-compat.js";
import { migrateBeastItem, isBeastAbility } from "./beast-actions.js";
import { normalizeRequiredEffects, requiredTestSuccesses } from "./required-test.js";
import { normalizeLegacySuccessScriptData } from "../apps/neuroshima-script-engine.js";

const migrating = new WeakSet();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Normalize current compatibility fields without reading prepared Active Effect bonuses. */
export async function migrateCurrentDocument(document, { persist = false } = {}) {
  if (!document || migrating.has(document)) return;
  migrating.add(document);
  try {
    if (document.documentName === "Item") {
      await migrateBeastItem(document);
      if (isBeastAbility(document)) {
        const source = document.toObject();
        const system = source.system ?? {};
        const canonical = { ...system, ...normalizeRequiredEffects(system),
          abilityCategory: system.abilityCategory === "segment" ? "segment" : "action" };
        canonical.costType = canonical.abilityCategory === "segment" ? "segment" : "success";
        if (persist || !same(system, canonical)) {
          await document.update({ type: "beast-ability", system: canonical }, { neuroshimaDocumentMigration: true });
        }
      }
    }
    const source = document.toObject?.();
    if (source) {
      const patch = {};
      for (const key of ["system", "flags"]) {
        if (!source[key]) continue;
        const original = JSON.stringify(source[key]);
        normalizeEmbeddedEffects(source[key]);
        if (original !== JSON.stringify(source[key])) patch[key] = source[key];
      }
      if (Object.keys(patch).length) await document.update(patch, { neuroshimaDocumentMigration: true });
    }
    for (const effect of document.effects ?? []) await migrateCurrentEffect(effect, { persist });
    // Splitting a legacy package may have added Items: iterate the live collection afterwards.
    for (const item of Array.from(document.items ?? [])) await migrateCurrentDocument(item, { persist });
  } finally {
    migrating.delete(document);
  }
}

export async function migrateCurrentEffect(effect, { persist = false } = {}) {
  const source = effect.toObject?.() ?? effect._source ?? {};
  const legacy = source.flags?.neuroshima?.scripts;
  const current = source.system?.scriptData?.length ? source.system.scriptData : Array.isArray(legacy) ? legacy : [];
  const scripts = normalizeLegacySuccessScriptData(current);
  const update = {};
  if (persist) {
    normalizeEffectData(source);
    Object.assign(update, effectChangesUpdate(effectChanges(source)));
    if (source.duration) update.duration = source.duration;
    if (isV14()) {
      if (source.start) update.start = source.start;
      if (source.showIcon != null) update.showIcon = source.showIcon;
    }
  }
  if (current.length && (!same(scripts, source.system?.scriptData) || !source.system?.scriptData?.length)) {
    update["system.scriptData"] = scripts;
  }
  if (Array.isArray(legacy) && legacy.length) update["flags.neuroshima.-=scripts"] = null;
  const changes = normalizeEffectPenaltyChanges(effectChanges(source));
  if (changes.changed) Object.assign(update, effectChangesUpdate(changes.changes));
  if (Object.keys(update).length) await effect.update(update, { neuroshimaDocumentMigration: true });
}

/** Existing chat cards keep their history; only the required-test threshold is repaired. */
export async function migrateRequiredTestMessage(message) {
  const data = message.getFlag?.("neuroshima", "requiredTestData");
  if (!data) return;
  const requiredSuccesses = requiredTestSuccesses(data);
  if (data.requiredSuccesses !== requiredSuccesses) {
    await message.update({ "flags.neuroshima.requiredTestData.requiredSuccesses": requiredSuccesses });
  }
}
