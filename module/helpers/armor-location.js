import { NEUROSHIMA } from "../config.js";
import { getEffectiveArmorResistances } from "./mod-helpers.js";
import { clampArmor } from "./armor-limit.js";
import { CombatHelper } from "./combat-helper.js";

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
      value: CombatHelper.getArmorRating(actor, location, key).totalSP,
      items: actor.items.filter(item => item.type === "armor" && item.system.equipped
        && getEffectiveArmorResistances(item, { includeDamage: false })[key]?.[location] > 0)
        .map(item => ({ id: item.id, name: item.name, location, category: key,
          value: clampArmor(actor, getEffectiveArmorResistances(item)[key]?.[location] ?? 0, key),
          damaged: Number(item.system.armor?.resistanceDamage?.[key]?.[location]) > 0 }))
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
