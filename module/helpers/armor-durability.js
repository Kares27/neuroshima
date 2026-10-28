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
