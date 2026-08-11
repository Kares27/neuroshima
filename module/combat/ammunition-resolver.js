const clone = value => foundry.utils.deepClone(value);

const AMMO_CATEGORIES = new Set(["standard", "launcher"]);

/** Return the category carried by ammunition data or a stored stack snapshot. */
export function getAmmoCategory(ammo, fallback = "standard") {
  const system = ammo?.system ?? ammo ?? {};
  const category = system.ammoCategory;
  return AMMO_CATEGORIES.has(category) ? category : fallback;
}

/**
 * A loaded magazine derives its category from its actual projectile contents.
 * The stored field is only a fallback for empty and legacy magazines.
 */
export function getMagazineAmmoCategory(magazine, fallback = "standard") {
  const system = magazine?.system ?? magazine ?? {};
  const contents = Array.from(system.contents ?? []);
  for (let index = contents.length - 1; index >= 0; index--) {
    const stack = contents[index];
    if (Number(stack?.quantity ?? 0) <= 0) continue;
    const category = getAmmoCategory(stack?.ammoSnapshot, null);
    if (category) return category;
  }
  return getAmmoCategory(system, fallback);
}

export function createAmmoSnapshot(ammo) {
  const system = ammo?.system ?? ammo ?? {};
  const isLauncherProjectile = (system.ammoCategory ?? "standard") === "launcher";
  return {
    caliber: system.caliber ?? "",
    ammoCategory: system.ammoCategory ?? "standard",
    damage: system.damage ?? "L",
    damageCategory: system.damageCategory ?? "physical",
    // Launcher projectiles resolve armor interaction from blast zones like
    // grenades, so legacy PP values stored on ammunition are intentionally ignored.
    piercing: isLauncherProjectile ? 0 : Number(system.piercing ?? 0),
    jamming: Number(system.jamming ?? 20),
    isOverride: system.isOverride === true,
    overrideDamage: system.overrideDamage === true,
    overrideDamageCategory: system.overrideDamageCategory === true,
    overridePiercing: !isLauncherProjectile && system.overridePiercing === true,
    overrideJamming: system.overrideJamming === true,
    isPellet: system.isPellet === true,
    pelletCount: Number(system.pelletCount ?? 1),
    pelletRanges: clone(system.pelletRanges ?? null),
    blastZones: clone(system.blastZones ?? [])
  };
}

function compatible(weapon, ammo) {
  const system = ammo?.system ?? ammo ?? {};
  const category = Array.isArray(system.contents)
    ? getMagazineAmmoCategory(system)
    : getAmmoCategory(system);
  const caliber = ammo?.system?.caliber ?? ammo?.caliber ?? "";
  const expectedCategory = weapon?.system?.weaponType === "launcher" ? "launcher" : "standard";
  if (category !== expectedCategory) return false;
  return !weapon?.system?.caliber || caliber === weapon.system.caliber;
}

export class AmmunitionResolver {
  static resolve(actor, weapon, requested = 1) {
    const amount = Math.max(0, Number(requested) || 0);
    if (weapon?.system?.weaponType === "launcher") {
      if (weapon.system.directAmmo) return this.#direct(actor, weapon, amount);
      if (weapon.system.magazine) return this.#magazine(actor, weapon, amount);
      return { valid: false, reason: "noAmmunition", bulletsFired: 0, bulletSequence: [] };
    }
    return this.#magazine(actor, weapon, amount);
  }

  static #direct(actor, weapon, requested) {
    const ammo = actor?.items?.get(weapon?.system?.directAmmo);
    if (!ammo || ammo.type !== "ammo" || !compatible(weapon, ammo)) {
      return { valid: false, reason: "noAmmunition", sourceType: "direct", bulletsFired: 0, bulletSequence: [] };
    }
    const fired = Math.min(requested, Number(ammo.system.quantity ?? 0));
    const snapshot = createAmmoSnapshot(ammo);
    return {
      valid: fired > 0,
      reason: fired > 0 ? null : "noAmmunition",
      sourceType: "direct",
      ammoItem: ammo,
      ammoItemQuantity: Number(ammo.system.quantity ?? 0) - fired,
      bulletsFired: fired,
      bulletSequence: Array.from({ length: fired }, () => ({ name: ammo.name, ammoId: ammo.id, ammoSnapshot: clone(snapshot) }))
    };
  }

  static #magazine(actor, weapon, requested) {
    const magazineId = weapon?.system?.magazine;
    const magazine = magazineId ? actor?.items?.get(magazineId) : null;
    if (!magazine || magazine.type !== "magazine") {
      return { valid: false, reason: "noMagazine", sourceType: "magazine", magazineId, bulletsFired: 0, bulletSequence: [] };
    }
    if (!compatible(weapon, magazine.system)) {
      return { valid: false, reason: "noMagazine", sourceType: "magazine", magazineId, bulletsFired: 0, bulletSequence: [] };
    }
    const contents = clone(magazine.system.contents ?? []);
    let remaining = requested;
    const bulletSequence = [];
    while (remaining > 0 && contents.length) {
      const stack = contents.at(-1);
      if (!compatible(weapon, stack.ammoSnapshot ?? {
        caliber: magazine.system.caliber,
        ammoCategory: magazine.system.ammoCategory ?? "standard"
      })) break;
      const quantity = Math.min(remaining, Number(stack.quantity ?? 0));
      const snapshot = clone(stack.ammoSnapshot ?? {});
      for (let i = 0; i < quantity; i++) bulletSequence.push({
        name: stack.name,
        ammoId: stack.ammoId ?? null,
        ammoSnapshot: snapshot,
        overrides: clone(stack.overrides ?? {})
      });
      stack.quantity -= quantity;
      remaining -= quantity;
      if (stack.quantity <= 0) contents.pop();
    }
    return {
      valid: bulletSequence.length > 0,
      reason: bulletSequence.length ? null : "noAmmunition",
      sourceType: "magazine",
      magazine,
      magazineId,
      magazineUpdateData: contents,
      bulletsFired: bulletSequence.length,
      bulletSequence
    };
  }

}
