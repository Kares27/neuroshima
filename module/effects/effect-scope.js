const ITEM_SCOPED_TRIGGERS = new Set([
  "preRollTest", "preRollWeaponTest", "rollTest", "rollWeaponTest",
  "preOpposedAttacker", "opposedAttacker", "calculateOpposedDamage",
  "preApplyDamage", "applyDamage"
]);

export function matchesItemDocumentScope(script, trigger, usedItem = null) {
  if (!ITEM_SCOPED_TRIGGERS.has(trigger)) return true;
  const effect = script.effect;
  const parentItem = effect?.parent?.documentName === "Item" ? effect.parent : null;
  if (!parentItem) return true;
  const documentType = effect.getFlag?.("neuroshima", "documentType") ?? "actor";
  if (documentType !== "item") return true;
  if (!usedItem) return false;
  return parentItem.uuid === usedItem.uuid;
}
