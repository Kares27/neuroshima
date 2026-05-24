const WEAPON_LOCS = ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"];

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
    damage:       s.damage ?? "L",
    damageMelee1: s.damageMelee1 ?? "D",
    damageMelee2: s.damageMelee2 ?? "L",
    damageMelee3: s.damageMelee3 ?? "C",
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
    "system.attackBonus":    effective.attackBonus,
    "system.defenseBonus":   effective.defenseBonus,
    "system.caliber":        effective.caliber,
    "system.requiredBuild":  effective.requiredBuild,
    "system.weaponModifier": effective.weaponModifier,
    "system.damageCategory": effective.damageCategory ?? "physical"
  };
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
  const mods = buildInstalledMap(armorItem);
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
 * Compute effective non-physical armor resistances for an armor item by merging
 * base armor.resistances[] rows with attached mod resistanceDeltas[] rows.
 * Same-category rows are merged (summed per location).
 * @param {Item} armorItem
 * @returns {Object.<string, {head,torso,leftArm,rightArm,leftLeg,rightLeg}>}
 */
export function getEffectiveArmorResistances(armorItem) {
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
  const mods = buildInstalledMap(item);
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
  await _propagateModEffects(item, modId, snapshot, true);
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
async function _propagateModEffects(item, modId, snapshot, attach) {
  if (attach) {
    let modItem = item.actor?.items.get(modId) ?? null;
    if (!modItem && snapshot?.uuid) {
      try { modItem = await fromUuid(snapshot.uuid); } catch (_) {}
    }
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

  const baseRad = actor.system?.radiationResistance ?? 0;
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
    for (const change of (effect.changes ?? [])) {
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
