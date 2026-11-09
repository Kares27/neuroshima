/** Items, equipment, armor, modifications, references and previews. */
import { effectChanges, isElement } from "./foundry-compat.js";
import { NEUROSHIMA } from "../config.js";
import { createAmmoSnapshot } from "../combat/ammunition-resolver.js";

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

const ARMOR_LOCATIONS = ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"];

/** Manual edits are local; flatten legacy shared wear without changing other locations. */
export async function modifyArmorDurability(sheet, event, target) {
  if (!sheet.document.isOwner || !sheet.isEditable) return;
  const { itemId, location } = target.dataset;
  const item = sheet.document.items.get(itemId);
  if (!item || item.type !== "armor" || !ARMOR_LOCATIONS.includes(location)) return;
  const armor = item.system.armor;
  const maximum = Math.max(0, Number(armor.durability) || 0);
  const shared = Math.max(0, Number(armor.durabilityDamage) || 0);
  const current = Math.max(0, Number(armor.locationDurabilityDamage?.[location]) || 0) + shared;
  const next = Math.min(maximum, Math.max(0, current + (event.type === "contextmenu" ? 1 : -1)));
  if (next === current) return;
  const update = {};
  if (shared > 0) {
    update["system.armor.durabilityDamage"] = 0;
    for (const key of ARMOR_LOCATIONS) {
      update[`system.armor.locationDurabilityDamage.${key}`] = shared + Math.max(0, Number(armor.locationDurabilityDamage?.[key]) || 0);
    }
  }
  update[`system.armor.locationDurabilityDamage.${location}`] = next;
  return item.update(update);
}

export function collectArmorDurabilityWear(results = [], reducedDetails = []) {
  const records = [...results, ...reducedDetails].flatMap(row => row.armorWear ?? [])
    .filter(record => record?.itemId && record.location && Number(record.amount) > 0);
  return [...new Map(records.map(record => [record.id ?? record, record])).values()];
}

export function remainingArmorDurability(armor, location) {
  if (armor?.durability == null) return null;
  return Math.max(0, Number(armor.durability) - Number(armor.durabilityDamage ?? 0)
    - Number(armor.locationDurabilityDamage?.[location] ?? 0));
}

export function armorLocationProtects(armor, location) {
  const remaining = remainingArmorDurability(armor, location);
  return remaining === null || remaining > 0;
}

/** Track wear without modifying live documents while subsequent impacts are evaluated. */
export class ArmorDurabilityBatch {
  constructor(actor) {
    this.actor = actor;
    this.pending = new Map();
  }

  remaining(item, location) {
    const remaining = remainingArmorDurability(item.system.armor, location);
    return remaining === null ? null : Math.max(0, remaining - (this.pending.get(item.id)?.[location] ?? 0));
  }

  add(item, location, amount) {
    const locations = this.pending.get(item.id) ?? {};
    locations[location] = (locations[location] ?? 0) + amount;
    this.pending.set(item.id, locations);
  }

  async commit() {
    const updates = [];
    for (const [itemId, locations] of this.pending) {
      const item = this.actor.items.get(itemId);
      if (!item) continue;
      const update = { _id: itemId };
      for (const [location, amount] of Object.entries(locations)) {
        update[`system.armor.locationDurabilityDamage.${location}`] =
          Number(item.system.armor?.locationDurabilityDamage?.[location] ?? 0) + amount;
      }
      updates.push(update);
    }
    if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
    this.pending.clear();
  }
}

/** One application may contain several melee hits and several recipients. */
export class ArmorDurabilityBatchGroup {
  constructor() { this.actors = new Map(); }

  forActor(actor) {
    const key = actor.uuid ?? actor;
    if (!this.actors.has(key)) this.actors.set(key, new ArmorDurabilityBatch(actor));
    return this.actors.get(key);
  }

  async commit() {
    for (const batch of this.actors.values()) await batch.commit();
  }
}

/** Damage suffered by armor is independent from the patient's pain resistance. */
export async function applyArmorDurabilityWear(actor, location, incoming, reduced, attackData, coveredItems, batch = null) {
  const melee = attackData.isMelee === true;
  const firearm = !melee && !attackData.isGrenade && !attackData.isThrown
    && (!attackData.weaponType || ["ranged", "launcher"].includes(attackData.weaponType));
  if (melee ? game.settings.get("neuroshima", "armorDurabilityMelee") === false
    : !firearm || game.settings.get("neuroshima", "armorDurabilityRanged") !== true) return [];
  const type = !melee && game.settings.get("neuroshima", "armorDurabilityRangedTiming") === "afterArmor" ? reduced : incoming;
  if (["sC", "sK"].includes(type)
    && (!melee || game.settings.get("neuroshima", "armorDurabilityMeleeBruises") !== true)) return [];
  const loss = type === "C" || type === "sC" ? 1 : type === "K" || type === "sK" ? 3 : 0;
  if (!loss) return [];
  const records = [];
  for (const item of coveredItems) {
    const armor = item.system.armor;
    const remaining = batch ? batch.remaining(item, location) : remainingArmorDurability(armor, location);
    if (remaining == null || remaining <= 0) continue;
    const amount = Math.min(remaining, loss);
    const previous = Number(armor.locationDurabilityDamage?.[location] ?? 0);
    if (batch) batch.add(item, location, amount);
    else await item.update({ [`system.armor.locationDurabilityDamage.${location}`]: previous + amount });
    records.push({ id: foundry.utils.randomID(), itemId: item.id, itemName: item.name,
      location, amount, before: remaining, after: remaining - amount });
  }
  return records;
}

export async function reverseArmorDurabilityWear(actor, records) {
  const grouped = new Map();
  for (const record of new Map(records.filter(Boolean).map(record => [record.id, record])).values()) {
    if (!record.itemId || !record.location || !(record.amount > 0)) continue;
    const key = `${record.itemId}:${record.location}`;
    const entry = grouped.get(key) ?? { ...record, amount: 0 };
    entry.amount += record.amount;
    grouped.set(key, entry);
  }
  for (const { itemId, location, amount } of grouped.values()) {
    const item = actor.items.get(itemId);
    if (!item || item.type !== "armor") continue;
    await item.update({ [`system.armor.locationDurabilityDamage.${location}`]:
      Math.max(0, Number(item.system.armor?.locationDurabilityDamage?.[location] ?? 0) - amount) });
  }
}

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

/**
 * Builds a plain-object snapshot of a weapon-mod item's deltas.
 * Stored inside system.mods.installed[modId] on the parent weapon.
 */
export function buildWeaponModSnapshot(mod) {
  const s = mod.system;
  return {
    id:              mod.id,
    uuid:            mod.uuid,
    name:            mod.name,
    img:             mod.img,
    modType:         s.modType ?? "",
    category:        s.category ?? "modification",
    attached:        false,
    effectText:      s.effectText ?? "",
    deltaWeight:        s.deltaWeight ?? 0,
    deltaCost:          s.deltaCost ?? 0,
    deltaAttackBonus:     s.deltaAttackBonus ?? 0,
    overrideAttackBonus:  s.overrideAttackBonus ?? false,
    deltaDefenseBonus:    s.deltaDefenseBonus ?? 0,
    overrideDefenseBonus: s.overrideDefenseBonus ?? false,
    deltaPiercing:        s.deltaPiercing ?? 0,
    overridePiercing:     s.overridePiercing ?? false,
    deltaRequiredBuild:   s.deltaRequiredBuild ?? 0,
    overrideRequiredBuild: s.overrideRequiredBuild ?? false,
    overrideDamage:           s.overrideDamage ?? false,
    damage:                   s.damage ?? "L",
    overrideDamageCategory:   s.overrideDamageCategory ?? false,
    damageCategory:           s.damageCategory ?? "physical",
    overrideCaliber:          s.overrideCaliber ?? false,
    modCaliber:           s.modCaliber ?? "",
    deltaFireRate:        s.deltaFireRate ?? 0,
    overrideFireRate:     s.overrideFireRate ?? false,
    deltaCapacity:        s.deltaCapacity ?? 0,
    overrideCapacity:     s.overrideCapacity ?? false,
    deltaJamming:         s.deltaJamming ?? 0,
    overrideJamming:      s.overrideJamming ?? false,
    overrideDamageMelee1: s.overrideDamageMelee1 ?? false,
    damageMelee1:         s.damageMelee1 ?? "D",
    overrideDamageMelee2: s.overrideDamageMelee2 ?? false,
    damageMelee2:         s.damageMelee2 ?? "L",
    overrideDamageMelee3: s.overrideDamageMelee3 ?? false,
    damageMelee3:         s.damageMelee3 ?? "C",
    deltaWeaponModifier:  s.deltaWeaponModifier ?? 0,
    deltaModifiesCost:    s.deltaModifiesCost ?? true,
    resources:            (s.resources ?? []).filter(r => r.showInSummary)
  };
}

/**
 * Build a plain-object snapshot of an armor-mod item's deltas.
 */
export function buildArmorModSnapshot(mod) {
  const s = mod.system;
  return {
    id:                mod.id,
    uuid:              mod.uuid,
    name:              mod.name,
    img:               mod.img,
    modType:           s.modType ?? "",
    category:          s.category ?? "modification",
    attached:          false,
    effectText:        s.effectText ?? "",
    deltaWeight:        s.deltaWeight ?? 0,
    deltaCost:          s.deltaCost ?? 0,
    deltaHead:         s.deltaHead ?? 0,
    deltaTorso:        s.deltaTorso ?? 0,
    deltaLeftArm:      s.deltaLeftArm ?? 0,
    deltaRightArm:     s.deltaRightArm ?? 0,
    deltaLeftLeg:      s.deltaLeftLeg ?? 0,
    deltaRightLeg:     s.deltaRightLeg ?? 0,
    deltaDurability:        s.deltaDurability ?? 0,
    deltaPenalty:           s.deltaPenalty ?? 0,
    deltaRequiredBuild:     s.deltaRequiredBuild ?? 0,
    deltaRadiationProtection: s.deltaRadiationProtection ?? 0,
    deltaModifiesCost:      s.deltaModifiesCost ?? true,
    resistanceDeltas:       (s.resistanceDeltas ?? []),
    resources:              (s.resources ?? []).filter(r => r.showInSummary)
  };
}

/**
 * Capture the current weapon base stats before any mods are written-through.
 */
export function snapshotWeaponBaseStats(weapon) {
  const s = weapon.system;
  return {
    weight:       s.weight ?? 0,
    cost:         s.cost ?? 0,
    damage:       s.damage ?? "L",
    damageCategory: s.damageCategory ?? "physical",
    damageMelee1: s.damageMelee1 ?? "D",
    damageMelee2: s.damageMelee2 ?? "L",
    damageMelee3: s.damageMelee3 ?? "C",
    caliber:      s.caliber ?? "",
    piercing:     s.piercing ?? 0,
    fireRate:     s.fireRate ?? 0,
    capacity:     s.capacity ?? 0,
    jamming:      s.jamming ?? 20,
    attackBonus:    s.attackBonus ?? 0,
    defenseBonus:   s.defenseBonus ?? 0,
    requiredBuild:  s.requiredBuild ?? 0,
    weaponModifier: s.weaponModifier ?? 0
  };
}

/**
 * Capture the current armor base stats.
 */
export function snapshotArmorBaseStats(armor) {
  const s = armor.system;
  return {
    weight:              s.weight ?? 0,
    head:                s.armor.ratings.head ?? 0,
    torso:               s.armor.ratings.torso ?? 0,
    leftArm:             s.armor.ratings.leftArm ?? 0,
    rightArm:            s.armor.ratings.rightArm ?? 0,
    leftLeg:             s.armor.ratings.leftLeg ?? 0,
    rightLeg:            s.armor.ratings.rightLeg ?? 0,
    durability:          s.armor.durability ?? 0,
    penalty:             s.armor.penalty ?? 0,
    requiredBuild:       s.armor.requiredBuild ?? 0,
    radiationProtection: s.armor.radiationProtection ?? 0
  };
}

/**
 * Compute effective weapon stats by applying all attached mod deltas on top of base.
 */
export function computeWeaponEffective(baseStats, installedMap) {
  const eff = { ...baseStats };
  eff.requiredBuild = eff.requiredBuild ?? 0;
  for (const mod of Object.values(installedMap || {})) {
    if (!mod.attached) continue;
    eff.weight        += (mod.deltaWeight ?? 0);
    if (mod.deltaModifiesCost !== false) eff.cost = (eff.cost ?? 0) + (mod.deltaCost ?? 0);
    if (mod.overrideAttackBonus)  eff.attackBonus   = mod.deltaAttackBonus;
    else                          eff.attackBonus  += (mod.deltaAttackBonus  ?? 0);
    if (mod.overrideDefenseBonus) eff.defenseBonus  = mod.deltaDefenseBonus;
    else                          eff.defenseBonus += (mod.deltaDefenseBonus ?? 0);
    if (mod.overridePiercing)     eff.piercing      = mod.deltaPiercing;
    else                          eff.piercing     += (mod.deltaPiercing     ?? 0);
    if (mod.overrideRequiredBuild) eff.requiredBuild = mod.deltaRequiredBuild;
    else                           eff.requiredBuild += (mod.deltaRequiredBuild ?? 0);
    if (mod.overrideDamage)           eff.damage         = mod.damage;
    if (mod.overrideDamageCategory)   eff.damageCategory = mod.damageCategory;
    if (mod.overrideCaliber)          eff.caliber        = mod.modCaliber;
    if (mod.overrideFireRate)     eff.fireRate   = mod.deltaFireRate;
    else                          eff.fireRate  += (mod.deltaFireRate  ?? 0);
    if (mod.overrideCapacity)     eff.capacity   = mod.deltaCapacity;
    else                          eff.capacity  += (mod.deltaCapacity  ?? 0);
    if (mod.overrideJamming)      eff.jamming    = mod.deltaJamming;
    else                          eff.jamming   += (mod.deltaJamming   ?? 0);
    if (mod.overrideDamageMelee1) eff.damageMelee1 = mod.damageMelee1;
    if (mod.overrideDamageMelee2) eff.damageMelee2 = mod.damageMelee2;
    if (mod.overrideDamageMelee3) eff.damageMelee3 = mod.damageMelee3;
    eff.weaponModifier = (eff.weaponModifier ?? 0) + (mod.deltaWeaponModifier ?? 0);
  }

  // Modification deltas are intentionally signed, but the resulting weapon
  // must still satisfy its DataModel. This is especially important for
  // launchers, where capacity decides between direct ammunition and a magazine.
  eff.weight = Math.max(0, Number(eff.weight) || 0);
  eff.cost = Math.max(0, Math.trunc(Number(eff.cost) || 0));
  eff.piercing = Math.max(0, Math.trunc(Number(eff.piercing) || 0));
  eff.fireRate = Math.max(0, Math.trunc(Number(eff.fireRate) || 0));
  eff.capacity = Math.max(0, Math.trunc(Number(eff.capacity) || 0));
  eff.jamming = Math.clamp(Math.trunc(Number(eff.jamming) || 0), 0, 20);
  eff.requiredBuild = Math.max(0, Math.trunc(Number(eff.requiredBuild) || 0));
  eff.attackBonus = Math.trunc(Number(eff.attackBonus) || 0);
  eff.defenseBonus = Math.trunc(Number(eff.defenseBonus) || 0);
  eff.weaponModifier = Math.trunc(Number(eff.weaponModifier) || 0);
  return eff;
}

/**
 * Compute effective armor stats by applying all attached mod deltas on top of base.
 */
export function computeArmorEffective(baseStats, installedMap) {
  const eff = { ...baseStats };
  for (const mod of Object.values(installedMap || {})) {
    if (!mod.attached) continue;
    eff.weight        += (mod.deltaWeight       ?? 0);
    eff.cost          = (eff.cost ?? 0) + (mod.deltaCost ?? 0);
    eff.head          += (mod.deltaHead         ?? 0);
    eff.torso         += (mod.deltaTorso        ?? 0);
    eff.leftArm       += (mod.deltaLeftArm      ?? 0);
    eff.rightArm      += (mod.deltaRightArm     ?? 0);
    eff.leftLeg       += (mod.deltaLeftLeg      ?? 0);
    eff.rightLeg      += (mod.deltaRightLeg     ?? 0);
    eff.durability          += (mod.deltaDurability          ?? 0);
    eff.penalty             += (mod.deltaPenalty             ?? 0);
    eff.requiredBuild       += (mod.deltaRequiredBuild       ?? 0);
    eff.radiationProtection += (mod.deltaRadiationProtection ?? 0);
  }
  return eff;
}

/**
 * Build the Foundry update-data object that writes effective weapon stats back
 * to the item's system fields (the fields dice.js reads at roll time).
 */
export function buildWeaponWriteback(effective) {
  const update = {
    "system.weight":        effective.weight,
    "system.damage":        effective.damage,
    "system.damageMelee1":  effective.damageMelee1,
    "system.damageMelee2":  effective.damageMelee2,
    "system.damageMelee3":  effective.damageMelee3,
    "system.piercing":      effective.piercing,
    "system.fireRate":      effective.fireRate,
    "system.capacity":      effective.capacity,
    "system.jamming":       effective.jamming,
    "system.attackBonus":    effective.attackBonus,
    "system.defenseBonus":   effective.defenseBonus,
    "system.requiredBuild":  effective.requiredBuild,
    "system.weaponModifier": effective.weaponModifier
  };
  // Older installed-mod snapshots did not store caliber or damage category.
  // Omitting missing paths is safer than erasing current values when such a
  // legacy mod is detached; every newly attached mod captures both correctly.
  if (effective.caliber != null) update["system.caliber"] = effective.caliber;
  if (effective.damageCategory != null) update["system.damageCategory"] = effective.damageCategory;
  return update;
}

/**
 * Build the Foundry update-data object that writes effective armor stats back.
 */
export function buildArmorWriteback(effective) {
  return {
    "system.weight":                      effective.weight,
    "system.armor.ratings.head":          effective.head,
    "system.armor.ratings.torso":         effective.torso,
    "system.armor.ratings.leftArm":       effective.leftArm,
    "system.armor.ratings.rightArm":      effective.rightArm,
    "system.armor.ratings.leftLeg":       effective.leftLeg,
    "system.armor.ratings.rightLeg":      effective.rightLeg,
    "system.armor.durability":            effective.durability,
    "system.armor.penalty":               effective.penalty,
    "system.armor.requiredBuild":         effective.requiredBuild,
    "system.armor.radiationProtection":   effective.radiationProtection
  };
}

/**
 * Compute effective armor ratings by adding all attached mod deltas to the base ratings.
 * Does NOT write anything — call this at display/calculation time.
 * @param {Item} armorItem
 * @returns {{ head, torso, leftArm, rightArm, leftLeg, rightLeg }}
 */
export function getEffectiveArmorRatings(armorItem) {
  const base = armorItem.system?.armor?.ratings ?? {};
  return {
    head:     base.head     ?? 0,
    torso:    base.torso    ?? 0,
    leftArm:  base.leftArm  ?? 0,
    rightArm: base.rightArm ?? 0,
    leftLeg:  base.leftLeg  ?? 0,
    rightLeg: base.rightLeg ?? 0
  };
}

/**
 * Compute effective non-physical armor resistances for an armor item by merging
 * base armor.resistances[] rows with attached mod resistanceDeltas[] rows.
 * Same-category rows are merged (summed per location).
 * @param {Item} armorItem
 * @returns {Object.<string, {head,torso,leftArm,rightArm,leftLeg,rightLeg}>}
 */
export function getEffectiveArmorResistances(armorItem, { includeDamage = true } = {}) {
  const locs = ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"];
  const merged = {};

  const addRow = (category, row) => {
    if (!category) return;
    if (!merged[category]) merged[category] = { head: 0, torso: 0, leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 };
    for (const loc of locs) merged[category][loc] += (Number(row[loc]) || 0);
  };

  for (const row of (armorItem.system?.armor?.resistances ?? [])) addRow(row.category, row);

  const actor = armorItem.actor;
  const modsRaw = armorItem.system?.mods ?? {};

  if (actor) {
    for (const modItem of actor.items) {
      if (modItem.type !== "armor-mod") continue;
      const parentId = modItem.getFlag?.("neuroshima", "modParentId");
      if (parentId !== armorItem.id) continue;
      const modState = modsRaw[modItem.id];
      if (!modState?.attached) continue;
      for (const row of (modItem.system?.resistanceDeltas ?? [])) addRow(row.category, row);
    }
  } else {
    for (const [modId, modState] of Object.entries(modsRaw)) {
      if (modId.startsWith("__") || !modState?.attached) continue;
      for (const row of (modState.resistanceDeltas ?? [])) addRow(row.category, row);
    }
  }

  if (includeDamage) {
    const damage = armorItem.system?.armor?.resistanceDamage ?? {};
    for (const [category, row] of Object.entries(merged)) {
      for (const loc of locs) row[loc] = armorLocationProtects(armorItem.system?.armor, loc)
        ? Math.max(0, row[loc] - Math.max(0, Number(damage[category]?.[loc]) || 0)) : 0;
    }
  }
  return merged;
}

/**
 * Compute effective weight for any item with mods.
 * For weapons this equals system.weight (writeback already applied).
 * For armor this computes base + sum of attached deltaWeights.
 * @param {Item} item
 * @returns {number}
 */
export function getEffectiveWeight(item) {
  return item.system?.weight ?? 0;
}

/**
 * Compute effective cost for any item with mods (base + sum of attached deltaCosts).
 * @param {Item} item
 * @returns {number}
 */
export function getEffectiveCost(item) {
  const mods = buildInstalledMap(item);
  let base = item.system?.cost ?? 0;
  for (const [key, snap] of Object.entries(mods)) {
    if (key.startsWith("__") || !snap.attached) continue;
    if (snap.deltaModifiesCost === false) continue;
    base += (snap.deltaCost ?? 0);
  }
  return base;
}

/**
 * Whether the mods object has at least one attached mod.
 */
function hasAttachedMod(modsObj) {
  return Object.values(modsObj).some(m => m.attached);
}

/**
 * Build a "snapshot-compatible" map from the item's installed mods.
 * When the parent item is in an actor, reads live data from actor.items.
 * When the parent item is not in an actor, falls through to the stored snapshots.
 * Always returns the same shape as the old snapshot map so callers are unaffected.
 * @param {Item} item
 * @returns {Object}
 */
export function buildInstalledMap(item, overrideMods = null) {
  const actor  = item.actor;
  const modsRaw = overrideMods ?? item.system.mods ?? {};

  const map = {};
  if (modsRaw.__baseStats) map.__baseStats = modsRaw.__baseStats;
  if (modsRaw.__modded   !== undefined) map.__modded = modsRaw.__modded;

  for (const [modId, modState] of Object.entries(modsRaw)) {
    if (modId.startsWith("__")) continue;

    if (actor && !modState.name) {
      const modDoc = actor.items.get(modId);
      if (!modDoc) continue;
      const s = modDoc.system;
      map[modId] = {
        id:                   modId,
        uuid:                 modDoc.uuid,
        name:                 modDoc.name,
        img:                  modDoc.img,
        modType:              s.modType              ?? "",
        category:             s.category             ?? "modification",
        attached:             modState.attached      ?? false,
        effectText:           s.effectText           ?? "",
        deltaWeight:          s.deltaWeight          ?? 0,
        deltaCost:            s.deltaCost            ?? 0,
        deltaModifiesCost:    s.deltaModifiesCost    ?? true,
        deltaAttackBonus:     s.deltaAttackBonus     ?? 0,
        overrideAttackBonus:  s.overrideAttackBonus  ?? false,
        deltaDefenseBonus:    s.deltaDefenseBonus    ?? 0,
        overrideDefenseBonus: s.overrideDefenseBonus ?? false,
        deltaPiercing:        s.deltaPiercing        ?? 0,
        overridePiercing:     s.overridePiercing     ?? false,
        deltaRequiredBuild:   s.deltaRequiredBuild   ?? 0,
        overrideRequiredBuild: s.overrideRequiredBuild ?? false,
        overrideDamage:        s.overrideDamage       ?? false,
        damage:                s.damage               ?? "L",
        overrideDamageCategory: s.overrideDamageCategory ?? false,
        damageCategory:        s.damageCategory       ?? "physical",
        overrideCaliber:       s.overrideCaliber      ?? false,
        modCaliber:            s.modCaliber           ?? "",
        deltaFireRate:         s.deltaFireRate        ?? 0,
        overrideFireRate:      s.overrideFireRate     ?? false,
        deltaCapacity:         s.deltaCapacity        ?? 0,
        overrideCapacity:      s.overrideCapacity     ?? false,
        deltaJamming:          s.deltaJamming         ?? 0,
        overrideJamming:       s.overrideJamming      ?? false,
        overrideDamageMelee1:  s.overrideDamageMelee1 ?? false,
        damageMelee1:          s.damageMelee1         ?? "D",
        overrideDamageMelee2:  s.overrideDamageMelee2 ?? false,
        damageMelee2:          s.damageMelee2         ?? "L",
        overrideDamageMelee3:  s.overrideDamageMelee3 ?? false,
        damageMelee3:          s.damageMelee3         ?? "C",
        deltaWeaponModifier:   s.deltaWeaponModifier  ?? 0,
        deltaHead:             s.deltaHead            ?? 0,
        deltaTorso:            s.deltaTorso           ?? 0,
        deltaLeftArm:          s.deltaLeftArm         ?? 0,
        deltaRightArm:         s.deltaRightArm        ?? 0,
        deltaLeftLeg:          s.deltaLeftLeg         ?? 0,
        deltaRightLeg:         s.deltaRightLeg        ?? 0,
        deltaDurability:          s.deltaDurability          ?? 0,
        deltaPenalty:             s.deltaPenalty             ?? 0,
        deltaRadiationProtection: s.deltaRadiationProtection ?? 0,
        resistanceDeltas:         s.resistanceDeltas         ?? [],
        resources:                (s.resources ?? []).filter(r => r.showInSummary)
      };
    } else {
      map[modId] = modState;
    }
  }

  return map;
}

/**
 * Install a mod onto a weapon or armor item (no attach yet).
 * When the parent item lives in an actor: the mod item stays in the actor and is
 * tagged with flags.neuroshima.modParentId; only a lightweight entry is stored in
 * system.mods so the actor item is the single source of truth.
 * When the parent item has no actor: falls back to the old full-snapshot approach.
 * @param {Item} item   - weapon or armor Item document
 * @param {Item} mod    - weapon-mod or armor-mod Item document
 */
export async function installMod(item, mod) {
  const isWeapon = item.type === "weapon";
  const isArmor  = item.type === "armor";
  if (!isWeapon && !isArmor) return;

  const actor = item.actor;

  if (actor) {
    let modActorItem = (mod.actor === actor) ? mod : null;

    if (modActorItem && Number(modActorItem.system.quantity ?? 1) > 1) {
      const modData = modActorItem.toObject();
      delete modData._id;
      modData.system = modData.system ?? {};
      modData.system.quantity = 1;
      const [created] = await actor.createEmbeddedDocuments("Item", [modData]);
      await modActorItem.update({
        "system.quantity": Number(modActorItem.system.quantity ?? 1) - 1
      });
      modActorItem = created;
    }

    if (!modActorItem) {
      const modData = mod.toObject();
      delete modData._id;
      const [created] = await actor.createEmbeddedDocuments("Item", [modData]);
      modActorItem = created;
    }

    const newModId = modActorItem.id;
    const currentMods = foundry.utils.deepClone(item.system.mods ?? {});
    if (currentMods[newModId]) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Mods.AlreadyInstalled"));
      return;
    }

    await modActorItem.setFlag("neuroshima", "modParentId", item.id);

    currentMods[newModId] = { attached: false };
    await item.update({ "system.mods": currentMods });
  } else {
    const snapshot = isWeapon
      ? buildWeaponModSnapshot(mod)
      : buildArmorModSnapshot(mod);

    const currentMods = foundry.utils.deepClone(item.system.mods ?? {});
    if (currentMods[mod.id]) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Mods.AlreadyInstalled"));
      return;
    }

    currentMods[mod.id] = snapshot;
    await item.update({ "system.mods": currentMods });
  }
}

/**
 * Attach a mod: mark attached=true, snapshot base stats if this is the first attached mod,
 * recompute effective stats and write-through, copy AEs from the original mod item,
 * propagate mod resources.
 * @param {Item}   item  - weapon or armor
 * @param {string} modId
 */
export async function attachMod(item, modId) {
  const modsRaw = foundry.utils.deepClone(item.system.mods ?? {});
  const entry   = modsRaw[modId];
  if (!entry) return;
  if (entry.attached) return;

  const isWeapon = item.type === "weapon";

  if (!modsRaw.__baseStats) {
    modsRaw.__baseStats = isWeapon
      ? snapshotWeaponBaseStats(item)
      : snapshotArmorBaseStats(item);
  }

  entry.attached = true;
  modsRaw[modId] = entry;
  modsRaw.__modded = true;

  const updateData = { "system.mods": modsRaw };
  if (isWeapon) {
    const installedMap = buildInstalledMap(item, modsRaw);
    const effective = computeWeaponEffective(modsRaw.__baseStats, installedMap);
    Object.assign(updateData, buildWeaponWriteback(effective));
  } else {
    const installedMap = buildInstalledMap(item, modsRaw);
    const effective = computeArmorEffective(modsRaw.__baseStats, installedMap);
    Object.assign(updateData, buildArmorWriteback(effective));
  }

  await item.update(updateData);

  const snapshot = buildInstalledMap(item)[modId] ?? entry;
  await syncMountedModEffects(item, modId, snapshot, true);
  await _propagateModResources(item, modId, snapshot, true);
}

/**
 * Detach a mod: mark attached=false, recompute effective stats and write-through,
 * remove AEs copied from this mod, remove propagated resources.
 * @param {Item}   item
 * @param {string} modId
 */
export async function detachMod(item, modId) {
  const modsRaw = foundry.utils.deepClone(item.system.mods ?? {});
  const entry   = modsRaw[modId];
  if (!entry) return;
  if (!entry.attached) return;

  const isWeapon = item.type === "weapon";

  entry.attached = false;
  modsRaw[modId] = entry;
  modsRaw.__modded = hasAttachedMod(modsRaw);

  const updateData = { "system.mods": modsRaw };
  if (isWeapon) {
    const base = modsRaw.__baseStats ?? snapshotWeaponBaseStats(item);
    const installedMap = buildInstalledMap(item, modsRaw);
    const effective = computeWeaponEffective(base, installedMap);
    Object.assign(updateData, buildWeaponWriteback(effective));
  } else {
    const base = modsRaw.__baseStats ?? snapshotArmorBaseStats(item);
    const installedMap = buildInstalledMap(item, modsRaw);
    const effective = computeArmorEffective(base, installedMap);
    Object.assign(updateData, buildArmorWriteback(effective));
  }

  await item.update(updateData);

  await syncMountedModEffects(item, modId, entry, false);
  await _propagateModResources(item, modId, entry, false);
}

/**
 * Remove a mod from installed list entirely.
 * If attached, detaches first (which handles AE/resource cleanup).
 * If no mods remain, clears base stats snapshot.
 * @param {Item}   item
 * @param {string} modId
 */
export async function removeMod(item, modId) {
  const modsRaw = foundry.utils.deepClone(item.system.mods ?? {});
  const entry   = modsRaw[modId];
  if (!entry) return;

  if (entry.attached) {
    await detachMod(item, modId);
  }

  const freshMods = item.system.mods ?? {};
  const hasAny = Object.keys(freshMods).filter(k => !k.startsWith("__") && k !== modId).length > 0;

  const updateData = { [`system.mods.-=${modId}`]: null };
  if (!hasAny) {
    updateData["system.mods.-=__baseStats"] = null;
    updateData["system.mods.-=__modded"]    = null;
  }

  await item.update(updateData);

  if (item.actor) {
    const modActorItem = item.actor.items.get(modId);
    if (modActorItem) {
      await modActorItem.unsetFlag("neuroshima", "modParentId");
    }
  }
}

/**
 * Remove a mod from the weapon/armor and return it to the owning actor's inventory.
 * For actor-owned items the mod already lives in the actor — removeMod just unsets the
 * modParentId flag so it reappears in the normal inventory.
 * For world items the old snapshot-restore path is used.
 * @param {Item}   item
 * @param {string} modId
 */
export async function uninstallMod(item, modId) {
  const modsRaw = item.system.mods ?? {};
  const entry   = modsRaw[modId];
  if (!entry) return;

  if (item.actor && !entry.name) {
    await removeMod(item, modId);
    return;
  }

  await removeMod(item, modId);

  const actor = item.actor;
  if (!actor) return;

  const modType = item.type === "weapon" ? "weapon-mod" : "armor-mod";

  const existing = actor.items.find(i => i.type === modType && i.name === entry.name);
  if (existing) {
    await existing.update({ "system.quantity": (existing.system.quantity ?? 1) + 1 });
    return;
  }

  let sourceData = null;
  try {
    const sourceItem = await fromUuid(entry.uuid);
    if (sourceItem) {
      sourceData = sourceItem.toObject();
      delete sourceData._id;
      sourceData.system = sourceData.system ?? {};
      sourceData.system.quantity = 1;
    }
  } catch (_) {}

  if (!sourceData) {
    sourceData = {
      name: entry.name,
      type: modType,
      img:  entry.img ?? "icons/svg/item-bag.svg",
      system: { quantity: 1 }
    };
  }

  await actor.createEmbeddedDocuments("Item", [sourceData]);
}

/**
 * Copy / delete AEs from the original mod item onto the parent weapon/armor.
 * Tagged with flags.neuroshima.fromModId so they can be identified and removed later.
 */
export async function syncMountedModEffects(item, modId, snapshot = null, attached = true) {
  let modItem = item.actor?.items.get(modId) ?? null;
  if (!modItem && snapshot?.uuid) {
    try { modItem = await fromUuid(snapshot.uuid); } catch (_) {}
  }
  if (!modItem) modItem = game.items?.get(modId) ?? null;

  if (attached && !modItem) {
    // Legacy installed entries may no longer have their source modification.
    // Preserve the copies already present on the host because they are the
    // only remaining representation of the mounted modification's effects.
    if (item.actor) {
      await item.actor.syncEquipTransferEffects(item, item.system.equipped === true);
    }
    return;
  }

  if (modItem) {
    for (const effect of modItem.effects ?? []) {
      if (effect.transfer !== false) {
        await effect.update(
          { transfer: false },
          { neuroshimaModEffectSync: true }
        );
      }
    }
  }

  const desired = attached && modItem
    ? Array.from(modItem.effects ?? [])
    : [];
  const existing = item.effects.filter(effect =>
    effect.getFlag("neuroshima", "fromModId") === modId
  );
  const desiredIds = new Set(desired.map(effect => effect.id));
  const existingBySource = new Map();
  const duplicateIds = [];
  for (const effect of existing) {
    const sourceId = effect.getFlag("neuroshima", "sourceModEffectId");
    if (sourceId && !existingBySource.has(sourceId)) {
      existingBySource.set(sourceId, effect);
    } else {
      duplicateIds.push(effect.id);
    }
  }

  const staleIds = [
    ...duplicateIds,
    ...existing
      .filter(effect => !desiredIds.has(effect.getFlag("neuroshima", "sourceModEffectId")))
      .map(effect => effect.id)
  ].filter((id, index, ids) => ids.indexOf(id) === index);
  if (staleIds.length) {
    await item.deleteEmbeddedDocuments(
      "ActiveEffect",
      staleIds,
      { neuroshimaModEffectSync: true }
    );
  }

  const toCreate = [];
  for (const source of desired) {
    const data = source.toObject();
    delete data._id;
    // The source modification never transfers directly. The host copy keeps
    // the source effect's transfer-on-equip mode and becomes the sole effect
    // that can reach the owning actor.
    data.transfer = source.getFlag("neuroshima", "equipTransfer") !== true;
    foundry.utils.setProperty(data, "flags.neuroshima.fromModId", modId);
    foundry.utils.setProperty(data, "flags.neuroshima.sourceModEffectId", source.id);
    const copy = existingBySource.get(source.id);
    if (copy && !staleIds.includes(copy.id)) {
      await copy.update(data, { neuroshimaModEffectSync: true });
    } else {
      toCreate.push(data);
    }
  }
  if (toCreate.length) {
    await item.createEmbeddedDocuments(
      "ActiveEffect",
      toCreate,
      { neuroshimaModEffectSync: true }
    );
  }

  if (item.actor) {
    await item.actor.syncEquipTransferEffects(item, item.system.equipped === true);
  }
}

/**
 * Merge / remove mod resources on the parent item.
 * Each propagated resource is tagged with _fromModId so it can be found.
 */
async function _propagateModResources(item, modId, snapshot, attach) {
  if (!attach) {
    const current = Array.from(item.system.resources ?? []);
    const cleaned = current.filter(r => r._fromModId !== modId);
    if (cleaned.length !== current.length) {
      await item.update({ "system.resources": cleaned });
    }
    return;
  }

  let modItem = item.actor?.items.get(modId) ?? null;
  if (!modItem && snapshot?.uuid) {
    try { modItem = await fromUuid(snapshot.uuid); } catch (_) {}
  }
  if (!modItem) modItem = game.items?.get(modId);
  if (!modItem) return;

  const modResources = Array.from(modItem.system.resources ?? []);
  if (!modResources.length) return;

  const current = Array.from(item.system.resources ?? []);
  const existingKeys = new Set(current.filter(r => r._fromModId !== modId).map(r => r.key).filter(Boolean));
  const collisions = modResources.map(r => r.key).filter(k => k && existingKeys.has(k));
  if (collisions.length) {
    const names = collisions.join(", ");
    ui.notifications?.warn(
      game.i18n.format("NEUROSHIMA.Mods.ResourceKeyCollision", { item: item.name, keys: names }),
      { permanent: false }
    );
    game.neuroshima?.log?.(`[mod-helpers] Resource key collision when mounting mod ${modId} on ${item.name}: ${names}`);
  }
  const tagged = modResources.map(r => ({ ...r, _fromModId: modId }));
  await item.update({ "system.resources": [...current, ...tagged] });
}

/**
 * Build a human-readable delta summary string for display in the mods list.
 * Returns null when there are no non-zero deltas (e.g. trait category mods).
 */
/**
 * Compute the effective radiation resistance for an actor.
 * Equals actor base radiationResistance + sum of effective radiationProtection
 * from all equipped armor items (accounting for attached armor-mod deltas).
 * @param {Actor} actor
 * @returns {number}
 */
export function getEffectiveRadiationResistance(actor) {
  let total = actor.system?.radiationResistance ?? 0;
  for (const armorItem of actor.items) {
    if (armorItem.type !== "armor") continue;
    if (armorItem.system.equipped === false) continue;
    total += armorItem.system.armor?.radiationProtection ?? 0;
  }
  return total;
}

/**
 * Build a list of all sources contributing to radiation resistance for an actor.
 * Returns an array of { name, value } objects for tooltip display.
 * @param {Actor} actor
 * @returns {{ name: string, value: number }[]}
 */
export function getRadiationResistanceSources(actor) {
  const sources = [];

  // Read the stored base value, not the prepared value after Active Effects;
  // effect sources are listed separately below and must not be counted twice.
  const baseRad = actor._source?.system?.radiationResistance
    ?? actor.system?.radiationResistance
    ?? 0;
  if (baseRad !== 0) {
    sources.push({ name: game.i18n.localize("NEUROSHIMA.RadiationResistanceBase"), value: baseRad });
  }

  for (const armorItem of actor.items) {
    if (armorItem.type !== "armor") continue;
    if (armorItem.system.equipped === false) continue;

    const modsRaw = armorItem.system.mods ?? {};
    const baseStats = modsRaw.__baseStats;
    const baseArmorRad = baseStats
      ? (baseStats.radiationProtection ?? 0)
      : (armorItem.system.armor?.radiationProtection ?? 0);

    if (baseArmorRad !== 0) {
      sources.push({ name: armorItem.name, value: baseArmorRad });
    }

    for (const [modId, modState] of Object.entries(modsRaw)) {
      if (modId.startsWith("__") || !modState.attached) continue;
      const modItem = actor.items.get(modId);
      if (!modItem) continue;
      const delta = modItem.system.deltaRadiationProtection ?? 0;
      if (delta !== 0) {
        sources.push({ name: modItem.name, value: delta });
      }
    }
  }

  for (const effect of (actor.effects ?? [])) {
    if (effect.disabled) continue;
    for (const change of effectChanges(effect)) {
      if (change.key === "system.radiationResistance") {
        const v = Number(change.value) || 0;
        if (v !== 0) sources.push({ name: effect.name, value: v });
      }
    }
  }

  return sources;
}

export function buildModDeltaSummary(snapshot, itemType) {
  const d = (v) => (v > 0 ? `+${v}` : `${v}`);
  const parts = [];
  if (itemType === "weapon") {
    if (snapshot.deltaAttackBonus || snapshot.overrideAttackBonus) parts.push(`ATK ${d(snapshot.deltaAttackBonus ?? 0)}`);
    if (snapshot.deltaDefenseBonus || snapshot.overrideDefenseBonus) parts.push(`OBR ${d(snapshot.deltaDefenseBonus ?? 0)}`);
    if (snapshot.deltaPiercing || snapshot.overridePiercing) parts.push(`PP ${d(snapshot.deltaPiercing ?? 0)}`);
    if (snapshot.overrideDamage)      parts.push(`Obr: ${snapshot.damage}`);
    if (snapshot.overrideDamageCategory) parts.push(`Kat: ${snapshot.damageCategory}`);
    if (snapshot.overrideCaliber)     parts.push(`Kal: ${snapshot.modCaliber || "—"}`);
    if (snapshot.deltaFireRate || snapshot.overrideFireRate) parts.push(`Sz ${d(snapshot.deltaFireRate ?? 0)}`);
    if (snapshot.deltaCapacity || snapshot.overrideCapacity) parts.push(`Poj ${d(snapshot.deltaCapacity ?? 0)}`);
    if (snapshot.deltaJamming || snapshot.overrideJamming) parts.push(`Zac ${d(snapshot.deltaJamming ?? 0)}`);
    if (snapshot.deltaRequiredBuild || snapshot.overrideRequiredBuild) parts.push(`Bd ${d(snapshot.deltaRequiredBuild ?? 0)}`);
    if (snapshot.deltaWeaponModifier) parts.push(`Mod ${d(snapshot.deltaWeaponModifier)}`);
    if (snapshot.overrideDamageMelee1) parts.push(`M1: ${snapshot.damageMelee1}`);
    if (snapshot.overrideDamageMelee2) parts.push(`M2: ${snapshot.damageMelee2}`);
    if (snapshot.overrideDamageMelee3) parts.push(`M3: ${snapshot.damageMelee3}`);
    if (snapshot.deltaWeight)         parts.push(`Waga ${d(snapshot.deltaWeight)}`);
    if (snapshot.deltaCost)           parts.push(`Koszt ${d(snapshot.deltaCost)}`);
  } else {
    const locs = { head: "G", torso: "T", leftArm: "LR", rightArm: "PR", leftLeg: "LL", rightLeg: "PL" };
    for (const [key, abbr] of Object.entries(locs)) {
      const v = snapshot[`delta${key.charAt(0).toUpperCase() + key.slice(1)}`] ?? 0;
      if (v) parts.push(`${abbr} ${d(v)}`);
    }
    if (snapshot.deltaDurability)    parts.push(`Wytrz ${d(snapshot.deltaDurability)}`);
    if (snapshot.deltaPenalty)       parts.push(`Kara ${d(snapshot.deltaPenalty)}`);
    if (snapshot.deltaRequiredBuild) parts.push(`Bd ${d(snapshot.deltaRequiredBuild)}`);
    if (snapshot.deltaWeight)        parts.push(`Waga ${d(snapshot.deltaWeight)}`);
    if (snapshot.deltaCost)          parts.push(`Koszt ${d(snapshot.deltaCost)}`);
  }
  return parts.length ? parts.join(" | ") : null;
}

export function buildRef({ token = null, actor = null } = {}) {
    const tokenDoc = token?.document || (token instanceof TokenDocument ? token : null);
    if (tokenDoc?.uuid) {
        return { kind: "token", uuid: tokenDoc.uuid };
    }
    if (actor?.uuid) {
        return { kind: "actor", uuid: actor.uuid };
    }
    return null;
}

export async function resolveRef(ref) {
    if (!ref || !ref.uuid) return { tokenDoc: null, actor: null };

    try {
        const doc = await fromUuid(ref.uuid);
        if (!doc) {
            console.error(`Neuroshima | resolveRef: No document found for UUID: ${ref.uuid}`);
            return { tokenDoc: null, actor: null };
        }

        if (ref.kind === "token") {
            return { 
                tokenDoc: doc, 
                actor: doc.actor 
            };
        }

        return { 
            tokenDoc: null, 
            actor: doc 
        };
    } catch (err) {
        console.error(`Neuroshima | resolveRef: Error resolving UUID: ${ref.uuid}`, err);
        return { tokenDoc: null, actor: null };
    }
}

/** Final armor totals shared by combat and sheet previews. */
export function getArmorRating(actor, location, damageCategory = "physical", durabilityBatch = null) {
  let totalSP = 0;
  const details = [];
  let weakPoint = false;

  if (actor.type === "creature" && actor.system.naturalArmor) {
    const commonReduction = Math.max(0, Number(actor.system.naturalArmorReduction) || 0);
    totalSP += commonReduction;
    if (commonReduction > 0) details.push({
      name: game.i18n.localize("NEUROSHIMA.Creature.NaturalArmor.CommonReduction"),
      ratings: commonReduction, damage: 0, effective: commonReduction
    });
    const naturalPart = actor.system.naturalArmor[location];
    if (naturalPart) {
      const reduction = Number(naturalPart.reduction) || 0;
      totalSP += reduction;
      weakPoint = !!naturalPart.weakPoint;
      if (reduction > 0) {
        details.push({
          name: game.i18n.localize("NEUROSHIMA.Creature.NaturalArmor"),
          ratings: reduction,
          damage: 0,
          effective: reduction
        });
      }
    }
  } else if (actor.type === "vehicle" && actor.system.armor) {
    const plate = actor.system.armor[location];
    if (plate) {
      const reduction = Number(plate.reduction) || 0;
      weakPoint = !!plate.weakPoint;
      totalSP += reduction;
      if (reduction > 0) {
        details.push({
          name: game.i18n.localize("NEUROSHIMA.Vehicle.Armor"),
          ratings: reduction,
          damage: 0,
          effective: reduction
        });
      }
    }
  }

  const equippedArmor = actor.items.filter(item =>
    item.type === "armor" && item.system.equipped === true
    && (!durabilityBatch || durabilityBatch.remaining(item, location) !== 0)
  );

  if (damageCategory === "physical") {
    for (const armor of equippedArmor) {
      const effectiveValue = armorLocationProtects(armor.system.armor, location) ? (armor.system.effectiveArmor?.[location] || 0) : 0;
      const ratings = armor.system.armor?.ratings?.[location] ?? armor.system.currentRating ?? armor.system.rating ?? 0;
      const damage  = armor.system.armor?.damage?.[location]  || 0;
      if (effectiveValue > 0 || ratings > 0) {
        totalSP += effectiveValue;
        details.push({ name: armor.name, ratings, damage, effective: effectiveValue });
      }
    }

    const bonusAll = Number(actor.system.armorBonus?.all)      || 0;
    const bonusLoc = Number(actor.system.armorBonus?.[location]) || 0;
    const totalBonus = bonusAll + bonusLoc;
    if (totalBonus !== 0) {
      totalSP += totalBonus;
      details.push({
        name: game.i18n.localize("NEUROSHIMA.Effects.ArmorBonus"),
        ratings: totalBonus,
        damage: 0,
        effective: totalBonus
      });
    }
  } else {
    for (const armor of equippedArmor) {
      const resistances = getEffectiveArmorResistances(armor);
      const row = resistances[damageCategory];
      if (!row) continue;
      const sp = Number(row[location]) || 0;
      if (sp > 0) {
        totalSP += sp;
        details.push({ name: armor.name, ratings: sp, damage: 0, effective: sp });
      }
    }
  }

  return { totalSP: clampArmor(actor, totalSP, damageCategory), uncappedSP: totalSP, details, weakPoint };
}

export function armorProtectionColor(category) {
  const color = NEUROSHIMA.damageCategories[category]?.color;
  return /^#[0-9a-f]{6}$/i.test(color ?? "") ? color : "#888888";
}

/** Display the same final protection that damage calculations use. */
export function armorLocationProtections(actor, location) {
  return Object.entries(NEUROSHIMA.damageCategories)
    .filter(([key]) => key !== "physical" && key !== "explosive")
    .map(([key, category]) => ({
      key,
      label: category.label,
      color: armorProtectionColor(key),
      value: getArmorRating(actor, location, key).totalSP,
      items: actor.items.filter(item => item.type === "armor" && item.system.equipped
        && getEffectiveArmorResistances(item, { includeDamage: false })[key]?.[location] > 0)
        .map(item => ({ id: item.id, name: item.name, location, category: key,
          value: clampArmor(actor, getEffectiveArmorResistances(item)[key]?.[location] ?? 0, key),
          damaged: Number(item.system.armor?.resistanceDamage?.[key]?.[location]) > 0 || !armorLocationProtects(item.system.armor, location) }))
    }))
    .filter(category => category.items.length > 0);
}

/** Damage is stored separately from the protection supplied by armor and mods. */
export async function modifyArmorResistance(sheet, event, target) {
  if (!sheet.document.isOwner || !sheet.isEditable) return;
  const { itemId, location, category } = target.dataset;
  const item = sheet.document.items.get(itemId);
  if (!item?.isOwner || item.type !== "armor" || category === "physical"
    || !Object.hasOwn(NEUROSHIMA.damageCategories, category)
    || !Object.hasOwn(NEUROSHIMA.bodyLocations, location)) return;
  const globalDamage = game.settings.get("neuroshima", "armorCategoryGlobalDamage")?.[category] !== false;
  const ratings = getEffectiveArmorResistances(item, { includeDamage: false })[category] ?? {};
  const locations = globalDamage ? Object.keys(ratings) : [location];
  const updates = {};
  for (const key of locations) {
    const maximum = Math.max(0, Number(ratings[key]) || 0);
    const current = Math.max(0, Number(item.system.armor?.resistanceDamage?.[category]?.[key]) || 0);
    if (maximum === 0 && current === 0) continue;
    const damage = Math.min(maximum, Math.max(0, current + (event.type === "contextmenu" ? 1 : -1)));
    if (damage !== current) updates[`system.armor.resistanceDamage.${category}.${key}`] = damage;
  }
  if (Object.keys(updates).length) await item.update(updates);
}

const LAUNCHER_PROJECTILE_PROFILES = Object.freeze({
  offensive: Object.freeze({
    nameKey: "NEUROSHIMA.Items.GeneratedLauncherAmmo.Offensive",
    blastZones: Object.freeze([
      { radius: 1, damage: "K", knockdown: false, shrapnel: 0 },
      { radius: 2, damage: "C", knockdown: false, shrapnel: 0 },
      { radius: 3, damage: "L", knockdown: false, shrapnel: 0 },
      { radius: 4, damage: "none", knockdown: true, shrapnel: 0 }
    ])
  }),
  defensive: Object.freeze({
    nameKey: "NEUROSHIMA.Items.GeneratedLauncherAmmo.Defensive",
    blastZones: Object.freeze([
      { radius: 5, damage: "K", knockdown: false, shrapnel: 6 },
      { radius: 10, damage: "C", knockdown: false, shrapnel: 5 },
      { radius: 15, damage: "L", knockdown: false, shrapnel: 4 },
      { radius: 20, damage: "none", knockdown: true, shrapnel: 3 },
      { radius: 25, damage: "none", knockdown: false, shrapnel: 2 },
      { radius: 30, damage: "none", knockdown: false, shrapnel: 1 }
    ])
  })
});

/** Ask which rules profile should be used by generated 40 mm ammunition. */
async function chooseLauncherProjectileProfile() {
  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("NEUROSHIMA.Dialog.LauncherAmmo.Title") },
    content: `<p>${game.i18n.localize("NEUROSHIMA.Dialog.LauncherAmmo.Content")}</p>`,
    buttons: [
      {
        action: "offensive",
        label: game.i18n.localize("NEUROSHIMA.Dialog.LauncherAmmo.Offensive"),
        icon: "fas fa-bomb",
        default: true,
        callback: () => "offensive"
      },
      {
        action: "defensive",
        label: game.i18n.localize("NEUROSHIMA.Dialog.LauncherAmmo.Defensive"),
        icon: "fas fa-burst",
        callback: () => "defensive"
      },
      {
        action: "cancel",
        label: game.i18n.localize("NEUROSHIMA.Actions.Cancel"),
        icon: "fas fa-times",
        callback: () => null
      }
    ],
    classes: ["neuroshima", "dialog-vertical"],
    rejectClose: false
  });
}

function launcherAmmoSource({ caliber, profile, quantity }) {
  const name = game.i18n.format(profile.nameKey, { caliber });
  return {
    name,
    type: "ammo",
    img: "systems/neuroshima/assets/img/grenade.svg",
    system: {
      description: "",
      weight: 0,
      cost: 0,
      quantity,
      availability: 100,
      ammoCategory: "launcher",
      caliber,
      isOverride: false,
      overrideDamage: false,
      damage: "L",
      overrideDamageCategory: false,
      damageCategory: "physical",
      overridePiercing: false,
      piercing: 0,
      overrideJamming: false,
      jamming: 20,
      isPellet: false,
      pelletCount: 1,
      blastZones: foundry.utils.deepClone(profile.blastZones)
    }
  };
}

/**
 * Create ammunition which matches a ranged weapon or launcher.
 *
 * A regular firearm always receives a full standard magazine. A launcher with
 * capacity 1 receives a directly selectable projectile; launchers with a
 * larger capacity receive a full magazine containing projectile snapshots.
 * The generated stack represents standard ammunition, so its overrides stay
 * disabled and the ranged test continues to use the weapon's own damage,
 * piercing and jamming values.
 *
 * @param {Actor} actor Parent inventory receiving the magazine.
 * @param {Item} weapon Ranged weapon or launcher used as the source of caliber/capacity.
 * @returns {Promise<Item|null>}
 */
export async function createLoadedMagazineFromWeapon(actor, weapon) {
  const weaponType = weapon?.system?.weaponType;
  if (!actor || weapon?.type !== "weapon" || !["ranged", "launcher"].includes(weaponType)) return null;

  const caliber = String(weapon.system.caliber ?? "").trim();
  const capacity = Math.max(0, Math.floor(Number(weapon.system.capacity ?? 0)));
  if (!caliber) {
    ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.GeneratedMagazineMissingCaliber"));
    return null;
  }
  if (capacity < 1) {
    ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.GeneratedMagazineInvalidCapacity"));
    return null;
  }

  if (weaponType === "launcher") {
    const profileId = await chooseLauncherProjectileProfile();
    const profile = LAUNCHER_PROJECTILE_PROFILES[profileId];
    if (!profile) return null;

    const ammoSource = launcherAmmoSource({ caliber, profile, quantity: 1 });
    if (capacity === 1) {
      const [ammo] = await actor.createEmbeddedDocuments("Item", [ammoSource]);
      if (!ammo) return null;
      await weapon.update({ "system.directAmmo": ammo.id, "system.magazine": "" });
      ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.LauncherAmmoGenerated", {
        ammo: ammo.name,
        weapon: weapon.name
      }));
      return ammo;
    }

    const snapshot = createAmmoSnapshot(ammoSource);
    const ammoName = ammoSource.name;
    const magazineName = game.i18n.format("NEUROSHIMA.Items.GeneratedMagazineName", {
      weapon: weapon.name
    });
    const [magazine] = await actor.createEmbeddedDocuments("Item", [{
      name: magazineName,
      type: "magazine",
      img: "systems/neuroshima/assets/img/magazine.svg",
      system: {
        description: "",
        weight: 0,
        cost: 0,
        quantity: 1,
        availability: Number(weapon.system.availability ?? 100),
        equipped: false,
        ammoCategory: "launcher",
        caliber,
        capacity,
        contents: [{
          ammoId: "",
          name: ammoName,
          img: ammoSource.img,
          quantity: capacity,
          ammoSnapshot: snapshot,
          overrides: {
            enabled: false,
            damage: null,
            piercing: null,
            jamming: null,
            isPellet: false,
            pelletCount: 1,
            pelletRanges: null
          }
        }]
      }
    }]);
    if (!magazine) return null;
    await weapon.update({ "system.directAmmo": "", "system.magazine": magazine.id });
    ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.LoadedMagazineGenerated", {
      weapon: weapon.name,
      capacity
    }));
    return magazine;
  }

  const magazineName = game.i18n.format("NEUROSHIMA.Items.GeneratedMagazineName", {
    weapon: weapon.name
  });
  const ammoName = game.i18n.format("NEUROSHIMA.Items.GeneratedAmmoName", { caliber });
  const [magazine] = await actor.createEmbeddedDocuments("Item", [{
    name: magazineName,
    type: "magazine",
    img: "systems/neuroshima/assets/img/magazine.svg",
    system: {
      description: "",
      weight: 0,
      cost: 0,
      quantity: 1,
      availability: Number(weapon.system.availability ?? 100),
      equipped: false,
      ammoCategory: "standard",
      caliber,
      capacity,
      contents: [{
        ammoId: "",
        name: ammoName,
        img: "systems/neuroshima/assets/img/ammo.svg",
        quantity: capacity,
        overrides: {
          enabled: false,
          damage: null,
          piercing: null,
          jamming: null,
          isPellet: false,
          pelletCount: 1,
          pelletRanges: null
        }
      }]
    }
  }]);

  if (magazine) {
    ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.LoadedMagazineGenerated", {
      weapon: weapon.name,
      capacity
    }));
  }
  return magazine ?? null;
}

/**
 * Resolve an Item reference stored by older compendium data.
 *
 * Foundry world Items use `Item.<id>`, but some records inside the system
 * compendium also stored their pack-local links in that form. Resolve those
 * links against the source pack first, then fall back to normal UUID lookup
 * and the remaining Item packs.
 */
export async function resolveItemReference(reference, { relativeTo = null } = {}) {
  const value = String(reference ?? "").trim();
  if (!value) return null;

  const localMatch = value.match(/^Item\.([^.]+)$/);
  const localId = localMatch?.[1] ?? null;
  const preferredPackId = relativeTo?.pack ?? relativeTo?.compendium?.collection ?? null;

  if (localId && preferredPackId) {
    const pack = game.packs.get(preferredPackId);
    const item = await pack?.getDocument(localId);
    if (item) return { uuid: item.uuid, item };
  }

  try {
    const item = await fromUuid(value);
    if (item?.documentName === "Item") return { uuid: item.uuid ?? value, item };
  } catch (error) {
    game.neuroshima?.log?.(`[ItemReference] Could not resolve "${value}" as a UUID`, error);
  }

  if (!localId) return null;

  const packs = game.packs?.contents ?? Array.from(game.packs ?? []);
  for (const pack of packs.filter(pack =>
    (pack.metadata?.type ?? pack.documentName) === "Item"
  )) {
    if (pack.collection === preferredPackId) continue;
    let item = null;
    try {
      item = await pack.getDocument(localId);
    } catch (error) {
      game.neuroshima?.log?.(`[ItemReference] Could not read "${localId}" from ${pack.collection}`, error);
    }
    if (item) return { uuid: item.uuid, item };
  }

  return null;
}

export async function resolveItemReferences(references, options = {}) {
  const resolved = [];
  const seen = new Set();

  for (const reference of references ?? []) {
    const result = await resolveItemReference(reference, options);
    if (!result || seen.has(result.uuid)) continue;
    seen.add(result.uuid);
    resolved.push({ ...result, storedUuid: reference });
  }

  return resolved;
}

const SNAPSHOT_VERSION = 1;

function randomId() {
  return foundry.utils.randomID?.() ?? crypto.randomUUID();
}

function stableLegacyId(value) {
  let hash = 2166136261;
  for (const char of String(value ?? "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(36)}`;
}

function cleanItemData(data) {
  const copy = foundry.utils.deepClone(data ?? {});
  delete copy._id;
  delete copy.folder;
  delete copy.sort;
  delete copy.ownership;
  delete copy._stats;
  copy.type = "trait";
  copy.system ??= {};
  copy.effects ??= [];
  copy.flags ??= {};
  return copy;
}

export function createTraitSnapshot(item, { id = null } = {}) {
  if (!item || item.type !== "trait") return null;
  return {
    id: id || randomId(),
    version: SNAPSHOT_VERSION,
    item: cleanItemData(item.toObject())
  };
}

export function normalizeTraitSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const itemData = snapshot.item ?? snapshot.data;
  if (!itemData || itemData.type !== "trait") return null;
  return {
    id: String(snapshot.id || randomId()),
    version: Number(snapshot.version) || SNAPSHOT_VERSION,
    item: cleanItemData(itemData)
  };
}

/**
 * Return independent trait copies stored by an Origin/Profession. Legacy UUID
 * entries are materialized once so old world and compendium content still works.
 */
export async function collectTraitSnapshots(backgroundItem) {
  const snapshots = [];
  const seen = new Set();

  for (const raw of backgroundItem?.system?.traitChoices ?? []) {
    const snapshot = normalizeTraitSnapshot(raw);
    if (!snapshot) continue;
    const key = String(snapshot.item.name ?? "").trim().toLocaleLowerCase() || snapshot.id;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(snapshot);
  }

  const legacy = await resolveItemReferences(backgroundItem?.system?.traits, { relativeTo: backgroundItem });
  for (const { item, storedUuid } of legacy) {
    const snapshot = createTraitSnapshot(item, {
      id: stableLegacyId(storedUuid)
    });
    if (!snapshot) continue;
    const key = String(snapshot.item.name ?? "").trim().toLocaleLowerCase() || snapshot.id;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(snapshot);
  }

  return snapshots;
}

export function itemDataFromTraitSnapshot(snapshot) {
  const normalized = normalizeTraitSnapshot(snapshot);
  return normalized ? cleanItemData(normalized.item) : null;
}

export function traitSnapshotPreview(snapshot) {
  const normalized = normalizeTraitSnapshot(snapshot);
  if (!normalized) return null;
  const data = normalized.item;
  return {
    id: normalized.id,
    name: data.name,
    img: data.img || "systems/neuroshima/assets/Brain.svg",
    description: data.system?.description || ""
  };
}

/**
 * Convert a crew SchemaField model into ordinary update-safe data.
 */
export function crewMemberData(member) {
  return member?.toObject?.() ?? member ?? {};
}

/**
 * Resolve the concrete Actor represented by a vehicle crew entry.
 *
 * `actorUuid` is authoritative because it can identify the synthetic Actor of
 * one specific unlinked Token. `actorId` remains a legacy fallback for world
 * Actors saved before crew UUIDs were introduced.
 */
export async function resolveCrewActor(member) {
  const data = crewMemberData(member);
  if (data.actorUuid) {
    try {
      const document = await fromUuid(data.actorUuid);
      if (document?.documentName === "Actor") return document;
      if (document?.documentName === "Token") return document.actor ?? null;
    } catch (error) {
      game.neuroshima?.warn?.("[vehicle crew] Unable to resolve actorUuid", {
        actorUuid: data.actorUuid,
        error
      });
    }
    // A UUID-bearing row identifies one concrete Actor/Token. Falling back to
    // actorId here could target the prototype Actor after an unlinked Token
    // was deleted, so stale UUID entries deliberately resolve to nothing.
    return null;
  }
  return data.actorId ? game.actors.get(data.actorId) ?? null : null;
}

/**
 * Match a stored entry with identity data emitted by the vehicle sheet.
 * UUID wins for new entries; actorId keeps legacy world-Actor rows editable.
 */
export function crewMemberMatches(member, { actorUuid = "", actorId = "" } = {}) {
  const data = crewMemberData(member);
  if (data.actorUuid && actorUuid) return data.actorUuid === actorUuid;
  return !!actorId && data.actorId === actorId;
}

/**
 * Build the HTML shown by Foundry when hovering an item image.
 *
 * The description is expected to have already been enriched by TextEditor.
 * Names and image paths are escaped here; the completed tooltip is escaped by
 * Handlebars when it is placed in a data-tooltip-html attribute.
 */
export function buildItemPreviewTooltip(img, name, weight, cost, enrichedDescription = "") {
  if (!img) return "";

  const safeName = Handlebars.escapeExpression(name ?? "");
  const safeImg = Handlebars.escapeExpression(img);
  const wNum = typeof weight === "number" ? weight : parseFloat(weight);
  const cNum = typeof cost === "number" ? cost : parseFloat(cost);
  const hasW = !Number.isNaN(wNum);
  const hasC = !Number.isNaN(cNum);

  let statsHtml = "";
  if (hasW || hasC) {
    const wChip = hasW
      ? `<span class="ns-tip-stat"><i class="fas fa-weight-hanging"></i> ${wNum} kg</span>`
      : "";
    const cFormatted = hasC
      ? (Number.isInteger(cNum)
        ? cNum.toLocaleString("pl-PL")
        : cNum.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      : "";
    const cChip = hasC
      ? `<span class="ns-tip-stat"><i class="fas fa-coins"></i> ${cFormatted}</span>`
      : "";
    statsHtml = `<div class="ns-item-preview-stats">${wChip}${cChip}</div>`;
  }

  const description = String(enrichedDescription ?? "");
  const plainDescription = description
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, "")
    .trim();
  const hasDescription = Boolean(plainDescription)
    || /<(?:img|video|audio|table|ul|ol|blockquote|a)\b/i.test(description);
  const descriptionHtml = hasDescription
    ? `<div class="ns-item-preview-description">${description}</div>`
    : "";

  return `<div class="ns-item-preview"><div class="ns-item-preview-name">${safeName}</div><div class="ns-item-preview-body"><div class="ns-item-preview-image"><img src="${safeImg}" /></div><div class="ns-item-preview-details">${statsHtml}${descriptionHtml}</div></div></div>`;
}

/**
 * Interactive, scrollable rich-tooltip controller.
 *
 * Foundry's transient data-tooltip closes when the pointer leaves its trigger.
 * This controller keeps the preview alive while the pointer moves between the
 * trigger and tooltip, allowing long enriched descriptions to be scrolled.
 *
 * Supported triggers:
 * - data-item-preview-html: inventory item preview;
 * - data-interactive-tooltip-html: generic rich tooltip, including trait choices.
 */
export class InteractiveItemTooltip {
  static #documents = new WeakSet();
  static #element = null;
  static #trigger = null;
  static #closeTimer = null;

  static initialize(document = globalThis.document) {
    if (!document || this.#documents.has(document)) return;
    this.#documents.add(document);
    const window = document.defaultView;
    document.addEventListener("pointerover", this.#onPointerOver.bind(this));
    document.addEventListener("pointerout", this.#onPointerOut.bind(this));
    document.addEventListener("click", this.#onClick.bind(this));
    document.addEventListener("keydown", this.#onKeyDown.bind(this));
    document.addEventListener("scroll", this.#onScroll.bind(this), true);
    window.addEventListener("resize", this.#onResize.bind(this));
    window.visualViewport?.addEventListener("resize", this.#onResize.bind(this));
  }

  static #getElement() {
    const document = this.#trigger?.ownerDocument ?? globalThis.document;
    if (this.#element?.isConnected && this.#element.ownerDocument === document) return this.#element;
    this.#element?.remove();
    const element = document.createElement("aside");
    element.id = "ns-interactive-item-tooltip";
    element.className = "ns-interactive-item-tooltip";
    element.setAttribute("role", "tooltip");
    element.setAttribute("aria-hidden", "true");
    document.body.append(element);
    return (this.#element = element);
  }

  static #onPointerOver(event) {
    const trigger = isElement(event.target)
      ? event.target.closest("[data-item-preview-html], [data-interactive-tooltip-html]")
      : null;
    if (trigger) {
      this.#cancelClose();
      if (trigger !== this.#trigger) this.#show(trigger);
    } else if (this.#element?.contains(event.target)) this.#cancelClose();
  }

  static #onPointerOut(event) {
    const fromTrigger = isElement(event.target)
      ? event.target.closest("[data-item-preview-html], [data-interactive-tooltip-html]")
      : null;
    const fromTooltip = this.#element?.contains(event.target);
    if (!fromTrigger && !fromTooltip) return;
    const destination = event.relatedTarget;
    if (destination?.nodeType != null
      && (this.#element?.contains(destination) || this.#trigger?.contains(destination))) return;
    this.#scheduleClose();
  }

  static #onKeyDown(event) {
    if (event.key === "Escape") this.#hide();
  }

  static #onClick(event) {
    if (
      isElement(event.target)
      && event.target.closest("[data-item-preview-html], [data-interactive-tooltip-html]")
    ) {
      this.#hide();
    }
  }

  static #onScroll(event) {
    if (!this.#trigger || this.#element?.contains(event.target)) return;
    this.#hide();
  }

  static #onResize() {
    this.#hide();
  }

  static #show(trigger) {
    const isGeneric = trigger.hasAttribute("data-interactive-tooltip-html");
    const html = isGeneric
      ? trigger.dataset.interactiveTooltipHtml
      : trigger.dataset.itemPreviewHtml;
    if (!html) return this.#hide();
    this.#cancelClose();
    this.#trigger = trigger;
    const tooltip = this.#getElement();
    tooltip.innerHTML = html;
    tooltip.classList.toggle("is-choice-tooltip", isGeneric);
    tooltip.classList.add("active");
    tooltip.setAttribute("aria-hidden", "false");
    this.#position(
      trigger,
      trigger.dataset.interactiveTooltipDirection
        ?? trigger.dataset.itemPreviewDirection
        ?? "RIGHT"
    );
  }

  static #position(trigger, preferredDirection) {
    const tooltip = this.#getElement();
    const anchor = trigger.getBoundingClientRect();
    const gap = 8;
    const margin = 12;
    const document = trigger.ownerDocument;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const preferLeft = preferredDirection.toUpperCase() === "LEFT";

    tooltip.classList.remove("is-vertically-constrained");
    tooltip.style.removeProperty("max-height");
    tooltip.querySelector(
      ".ns-item-preview-description, .trait-choice-tooltip-description"
    )?.style.removeProperty("max-height");
    let panel = tooltip.getBoundingClientRect();

    const right = anchor.right + gap;
    const leftSide = anchor.left - panel.width - gap;
    const fitsRight = right + panel.width <= viewportWidth - margin;
    const fitsLeft = leftSide >= margin;
    const preferredFits = preferLeft ? fitsLeft : fitsRight;
    const alternateFits = preferLeft ? fitsRight : fitsLeft;
    let left;
    let top;

    if (preferredFits || alternateFits) {
      left = preferredFits ? (preferLeft ? leftSide : right) : (preferLeft ? right : leftSide);
      top = anchor.top + (anchor.height - panel.height) / 2;
      top = Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - panel.height - margin));
    } else {
      // On narrow viewports a clamped horizontal panel would cover its trigger.
      // Prefer the roomier vertical side and shrink only the description region.
      const roomAbove = Math.max(0, anchor.top - gap - margin);
      const roomBelow = Math.max(0, viewportHeight - margin - anchor.bottom - gap);
      const placeBelow = roomBelow >= panel.height || (roomAbove < panel.height && roomBelow >= roomAbove);
      const availableHeight = placeBelow ? roomBelow : roomAbove;
      this.#constrainHeight(availableHeight);
      panel = tooltip.getBoundingClientRect();
      left = anchor.left + (anchor.width - panel.width) / 2;
      left = Math.min(Math.max(left, margin), Math.max(margin, viewportWidth - panel.width - margin));
      top = placeBelow ? anchor.bottom + gap : anchor.top - panel.height - gap;
    }
    Object.assign(tooltip.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
  }

  static #constrainHeight(availableHeight) {
    const tooltip = this.#getElement();
    const description = tooltip.querySelector(
      ".ns-item-preview-description, .trait-choice-tooltip-description"
    );
    const panelHeight = tooltip.getBoundingClientRect().height;
    // This is strictly a shrink operation. Keeping the natural CSS sizing when
    // it already fits preserves the established 260px description maximum.
    if (availableHeight >= panelHeight) return;
    const descriptionHeight = description?.getBoundingClientRect().height ?? 0;
    const fixedHeight = panelHeight - descriptionHeight;
    tooltip.classList.add("is-vertically-constrained");
    tooltip.style.maxHeight = `${Math.max(0, Math.floor(availableHeight))}px`;
    if (!description) return;
    const reducedDescriptionHeight = Math.min(descriptionHeight, Math.floor(availableHeight - fixedHeight));
    description.style.maxHeight = `${Math.max(48, reducedDescriptionHeight)}px`;
  }

  static #scheduleClose() {
    this.#cancelClose();
    this.#closeTimer = window.setTimeout(() => this.#hide(), 180);
  }

  static #cancelClose() {
    if (this.#closeTimer === null) return;
    window.clearTimeout(this.#closeTimer);
    this.#closeTimer = null;
  }

  static #hide() {
    this.#cancelClose();
    this.#trigger = null;
    if (!this.#element) return;
    this.#element.classList.remove("active");
    this.#element.setAttribute("aria-hidden", "true");
    this.#element.replaceChildren();
  }
}
