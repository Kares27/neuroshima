import { SKILL_COST_NORMAL, SKILL_COST_SPEC, showXpDialog, showXpRefundDialog, applyXpEntry } from "./xp.js";

export function specialityChoices(actor, skillKey) {
  if (!["character", "npc"].includes(actor?.type) || !skillKey) return [];
  return Array.from(actor.items ?? []).filter(item => item.type === "speciality" && (item.system.skills ?? []).includes(skillKey));
}

export function specialityBonus(actor, skillKey, itemId) {
  const item = specialityChoices(actor, skillKey).find(item => item.id === itemId);
  return item ? Math.max(0, Math.trunc(Number(item.system.value) || 0)) : 0;
}

export function specialityCost(from, to, discounted = false) {
  const table = discounted ? SKILL_COST_SPEC : SKILL_COST_NORMAL;
  if (![from, to].every(Number.isInteger) || Math.min(from, to) < 0 || Math.max(from, to) > table.length) {
    throw new Error("Speciality levels must be integers from 0 to 20");
  }
  return table.slice(Math.min(from, to), Math.max(from, to)).reduce((sum, cost) => sum + cost, 0);
}

const advancing = new Set();
export async function advanceSpeciality(actor, item, targetValue) {
  if (!actor?.isOwner || !item?.isOwner || !["character", "npc"].includes(actor.type)
    || item.type !== "speciality" || item.parent?.uuid !== actor.uuid || advancing.has(actor.uuid)) return;
  const oldValue = Number(item._source?.system?.value ?? item.system.value) || 0;
  const newValue = Number(targetValue);
  const cost = specialityCost(oldValue, newValue, item.system.fromSpecialization === true);
  if (newValue === oldValue) return;
  advancing.add(actor.uuid);
  try {
    const description = `${item.name}: ${oldValue} → ${newValue}`;
    const available = Number(actor.system.xp?.total ?? 0) - Number(actor.system.xp?.spent ?? 0);
    const result = newValue > oldValue
      ? await showXpDialog(cost, description, available)
      : await showXpRefundDialog(cost, description, available);
    if (!result) return;
    if (Number(item._source?.system?.value ?? item.system.value) !== oldValue) throw new Error("Speciality changed while the dialog was open");
    const update = {};
    applyXpEntry(actor, update, result.free ? 0 : result.cost, description, oldValue, "system.value", { documentUuid: item.uuid });
    await item.update({ "system.value": newValue });
    try { await actor.update(update, { ns_skip_xp: true }); }
    catch (error) { await item.update({ "system.value": oldValue }); throw error; }
  } finally { advancing.delete(actor.uuid); }
}
