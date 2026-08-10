const clone = value => foundry.utils.deepClone(value);

export function createAmmoSnapshot(ammo) {
  const system = ammo?.system ?? ammo ?? {};
  return {
    caliber: system.caliber ?? "",
    ammoCategory: system.ammoCategory ?? "standard",
    payloadType: system.payloadType ?? "standard",
    damage: system.damage ?? "L",
    damageCategory: system.damageCategory ?? "physical",
    piercing: Number(system.piercing ?? 0),
    jamming: Number(system.jamming ?? 20),
    isOverride: system.isOverride === true,
    overrideDamage: system.overrideDamage === true,
    overrideDamageCategory: system.overrideDamageCategory === true,
    overridePiercing: system.overridePiercing === true,
    overrideJamming: system.overrideJamming === true,
    isPellet: system.isPellet === true,
    pelletCount: Number(system.pelletCount ?? 1),
    pelletRanges: clone(system.pelletRanges ?? null),
    blastZones: clone(system.blastZones ?? [])
  };
}

function compatible(weapon, ammo) {
  const category = ammo?.system?.ammoCategory ?? ammo?.ammoCategory ?? "standard";
  const caliber = ammo?.system?.caliber ?? ammo?.caliber ?? "";
  if (weapon?.system?.weaponType === "launcher" && category !== "launcher") return false;
  return !weapon?.system?.caliber || caliber === weapon.system.caliber;
}

export class AmmunitionResolver {
  static resolve(actor, weapon, requested = 1) {
    const amount = Math.max(0, Number(requested) || 0);
    const feed = weapon?.system?.ammoFeed ?? (weapon?.system?.weaponType === "launcher" ? "direct" : "magazine");
    const mode = feed === "either" ? (weapon.system.ammoFeedMode ?? "direct") : feed;
    if (mode === "integrated") return this.#integrated(weapon, amount);
    if (mode === "direct") return this.#direct(actor, weapon, amount);
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
    const contents = clone(magazine.system.contents ?? []);
    let remaining = requested;
    const bulletSequence = [];
    while (remaining > 0 && contents.length) {
      const stack = contents.at(-1);
      if (!compatible(weapon, stack.ammoSnapshot ?? { caliber: magazine.system.caliber })) break;
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

  static #integrated(weapon, requested) {
    const fired = Math.min(requested, Math.max(0, Number(weapon?.system?.capacity ?? 1)));
    const snapshot = createAmmoSnapshot(weapon);
    return {
      valid: fired > 0,
      reason: fired ? null : "noAmmunition",
      sourceType: "integrated",
      weapon,
      weaponCapacity: Math.max(0, Number(weapon?.system?.capacity ?? 1) - fired),
      bulletsFired: fired,
      bulletSequence: Array.from({ length: fired }, () => ({ name: weapon.name, ammoSnapshot: clone(snapshot) }))
    };
  }
}

export class PayloadResolver {
  static resolve(ammoData = {}) {
    const payloadType = ammoData.payloadType ?? "standard";
    return {
      payloadType,
      blastZones: payloadType === "blast" ? clone(ammoData.blastZones ?? []) : [],
      area: payloadType === "area" ? clone(ammoData.area ?? {}) : null,
      antiArmor: payloadType === "antiArmor" ? clone(ammoData.antiArmor ?? {}) : null
    };
  }
}
