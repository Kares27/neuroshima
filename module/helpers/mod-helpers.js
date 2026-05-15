const WEAPON_LOCS = ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"];

/**
 * Build a plain-object snapshot of a weapon-mod item's deltas.
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
    overrideDamage:       s.overrideDamage ?? false,
    damage:               s.damage ?? "L",
    overrideCaliber:      s.overrideCaliber ?? false,
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
    deltaDurability:   s.deltaDurability ?? 0,
    deltaPenalty:      s.deltaPenalty ?? 0,
    deltaRequiredBuild: s.deltaRequiredBuild ?? 0,
    deltaModifiesCost:  s.deltaModifiesCost ?? true,
    resources:         (s.resources ?? []).filter(r => r.showInSummary)
  };
}

/**
 * Capture the current weapon base stats before any mods are written-through.
 */
export function snapshotWeaponBaseStats(weapon) {
  const s = weapon.system;
  return {
    weight:       s.weight ?? 0,
    damage:       s.damage ?? "L",
    damageMelee1: s.damageMelee1 ?? "D",
    damageMelee2: s.damageMelee2 ?? "L",
    damageMelee3: s.damageMelee3 ?? "C",
    piercing:     s.piercing ?? 0,
    fireRate:     s.fireRate ?? 0,
    capacity:     s.capacity ?? 0,
    jamming:      s.jamming ?? 20,
    attackBonus:  s.attackBonus ?? 0,
    defenseBonus: s.defenseBonus ?? 0
  };
}

/**
 * Capture the current armor base stats.
 */
export function snapshotArmorBaseStats(armor) {
  const s = armor.system;
  return {
    weight:        s.weight ?? 0,
    head:          s.armor.ratings.head ?? 0,
    torso:         s.armor.ratings.torso ?? 0,
    leftArm:       s.armor.ratings.leftArm ?? 0,
    rightArm:      s.armor.ratings.rightArm ?? 0,
    leftLeg:       s.armor.ratings.leftLeg ?? 0,
    rightLeg:      s.armor.ratings.rightLeg ?? 0,
    durability:    s.armor.durability ?? 0,
    penalty:       s.armor.penalty ?? 0,
    requiredBuild: s.armor.requiredBuild ?? 0
  };
}

/**
 * Compute effective weapon stats by applying all attached mod deltas on top of base.
 */
export function computeWeaponEffective(baseStats, installedMap) {
  const eff = { ...baseStats };
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
    if (mod.overrideDamage)       eff.damage    = mod.damage;
    if (mod.overrideCaliber)      eff.caliber   = mod.modCaliber;
    if (mod.overrideFireRate)     eff.fireRate   = mod.deltaFireRate;
    else                          eff.fireRate  += (mod.deltaFireRate  ?? 0);
    if (mod.overrideCapacity)     eff.capacity   = mod.deltaCapacity;
    else                          eff.capacity  += (mod.deltaCapacity  ?? 0);
    if (mod.overrideJamming)      eff.jamming    = mod.deltaJamming;
    else                          eff.jamming   += (mod.deltaJamming   ?? 0);
    if (mod.overrideDamageMelee1) eff.damageMelee1 = mod.damageMelee1;
    if (mod.overrideDamageMelee2) eff.damageMelee2 = mod.damageMelee2;
    if (mod.overrideDamageMelee3) eff.damageMelee3 = mod.damageMelee3;
  }
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
    eff.durability    += (mod.deltaDurability   ?? 0);
    eff.penalty       += (mod.deltaPenalty      ?? 0);
    eff.requiredBuild += (mod.deltaRequiredBuild ?? 0);
  }
  return eff;
}

/**
 * Build the Foundry update-data object that writes effective weapon stats back
 * to the item's system fields (the fields dice.js reads at roll time).
 */
export function buildWeaponWriteback(effective) {
  return {
    "system.weight":        effective.weight,
    "system.damage":        effective.damage,
    "system.damageMelee1":  effective.damageMelee1,
    "system.damageMelee2":  effective.damageMelee2,
    "system.damageMelee3":  effective.damageMelee3,
    "system.piercing":      effective.piercing,
    "system.fireRate":      effective.fireRate,
    "system.capacity":      effective.capacity,
    "system.jamming":       effective.jamming,
    "system.attackBonus":   effective.attackBonus,
    "system.defenseBonus":  effective.defenseBonus,
    "system.caliber":       effective.caliber,
    "system.requiredBuild": effective.requiredBuild
  };
}

/**
 * Build the Foundry update-data object that writes effective armor stats back.
 */
export function buildArmorWriteback(effective) {
  return {
    "system.weight":                 effective.weight,
    "system.armor.ratings.head":     effective.head,
    "system.armor.ratings.torso":    effective.torso,
    "system.armor.ratings.leftArm":  effective.leftArm,
    "system.armor.ratings.rightArm": effective.rightArm,
    "system.armor.ratings.leftLeg":  effective.leftLeg,
    "system.armor.ratings.rightLeg": effective.rightLeg,
    "system.armor.durability":       effective.durability,
    "system.armor.penalty":          effective.penalty,
    "system.armor.requiredBuild":    effective.requiredBuild
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
  const mods = armorItem.system?.mods ?? {};
  const result = {
    head:     base.head     ?? 0,
    torso:    base.torso    ?? 0,
    leftArm:  base.leftArm  ?? 0,
    rightArm: base.rightArm ?? 0,
    leftLeg:  base.leftLeg  ?? 0,
    rightLeg: base.rightLeg ?? 0
  };
  for (const [key, snap] of Object.entries(mods)) {
    if (key.startsWith("__") || !snap.attached) continue;
    result.head     += (snap.deltaHead     ?? 0);
    result.torso    += (snap.deltaTorso    ?? 0);
    result.leftArm  += (snap.deltaLeftArm  ?? 0);
    result.rightArm += (snap.deltaRightArm ?? 0);
    result.leftLeg  += (snap.deltaLeftLeg  ?? 0);
    result.rightLeg += (snap.deltaRightLeg ?? 0);
  }
  return result;
}

/**
 * Compute effective weight for any item with mods.
 * For weapons this equals system.weight (writeback already applied).
 * For armor this computes base + sum of attached deltaWeights.
 * @param {Item} item
 * @returns {number}
 */
export function getEffectiveWeight(item) {
  const mods = item.system?.mods ?? {};
  let base = item.system?.weight ?? 0;
  if (item.type === "armor") {
    for (const [key, snap] of Object.entries(mods)) {
      if (key.startsWith("__") || !snap.attached) continue;
      base += (snap.deltaWeight ?? 0);
    }
  }
  return base;
}

/**
 * Compute effective cost for any item with mods (base + sum of attached deltaCosts).
 * @param {Item} item
 * @returns {number}
 */
export function getEffectiveCost(item) {
  const mods = item.system?.mods ?? {};
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
 * Install a mod snapshot onto a weapon or armor item (no attach yet).
 * @param {Item} item   - weapon or armor Item document
 * @param {Item} mod    - weapon-mod or armor-mod Item document
 */
export async function installMod(item, mod) {
  const isWeapon = item.type === "weapon";
  const isArmor  = item.type === "armor";
  if (!isWeapon && !isArmor) return;

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

  // Snapshot base stats on first attach
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
    const effective = computeWeaponEffective(modsRaw.__baseStats, modsRaw);
    Object.assign(updateData, buildWeaponWriteback(effective));
  }

  await item.update(updateData);

  await _propagateModEffects(item, modId, entry, true);
  await _propagateModResources(item, modId, entry, true);
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
    const effective = computeWeaponEffective(base, modsRaw);
    Object.assign(updateData, buildWeaponWriteback(effective));
  }

  await item.update(updateData);

  await _propagateModEffects(item, modId, entry, false);
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
}

/**
 * Copy / delete AEs from the original mod item onto the parent weapon/armor.
 * Tagged with flags.neuroshima.fromModId so they can be identified and removed later.
 */
async function _propagateModEffects(item, modId, snapshot, attach) {
  if (attach) {
    let modItem = null;
    try { modItem = await fromUuid(snapshot.uuid); } catch (_) {}
    if (!modItem) modItem = game.items?.get(modId);
    if (!modItem || !modItem.effects?.size) return;

    const toCreate = modItem.effects.map(e => {
      const data = e.toObject();
      foundry.utils.setProperty(data, "flags.neuroshima.fromModId", modId);
      return data;
    });
    if (toCreate.length) await item.createEmbeddedDocuments("ActiveEffect", toCreate);
  } else {
    const toDelete = item.effects
      .filter(e => e.getFlag("neuroshima", "fromModId") === modId)
      .map(e => e.id);
    if (toDelete.length) await item.deleteEmbeddedDocuments("ActiveEffect", toDelete);
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

  let modItem = null;
  try { modItem = await fromUuid(snapshot.uuid); } catch (_) {}
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
    game.neuroshima?.log?.(`[mod-helpers] Kolizja kluczy zasobów przy montowaniu modyfikacji ${modId} na ${item.name}: ${names}`);
  }
  const tagged = modResources.map(r => ({ ...r, _fromModId: modId }));
  await item.update({ "system.resources": [...current, ...tagged] });
}

/**
 * Build a human-readable delta summary string for display in the mods list.
 * Returns null when there are no non-zero deltas (e.g. trait category mods).
 */
export function buildModDeltaSummary(snapshot, itemType) {
  const d = (v) => (v > 0 ? `+${v}` : `${v}`);
  const parts = [];
  if (itemType === "weapon") {
    if (snapshot.deltaAttackBonus)    parts.push(`ATK ${d(snapshot.deltaAttackBonus)}`);
    if (snapshot.deltaDefenseBonus)   parts.push(`OBR ${d(snapshot.deltaDefenseBonus)}`);
    if (snapshot.deltaPiercing)       parts.push(`PP ${d(snapshot.deltaPiercing)}`);
    if (snapshot.overrideDamage)      parts.push(`Obr: ${snapshot.damage}`);
    if (snapshot.deltaFireRate)       parts.push(`Sz ${d(snapshot.deltaFireRate)}`);
    if (snapshot.deltaCapacity)       parts.push(`Poj ${d(snapshot.deltaCapacity)}`);
    if (snapshot.deltaJamming)        parts.push(`Zac ${d(snapshot.deltaJamming)}`);
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
