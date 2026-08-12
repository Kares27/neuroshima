import { createAmmoSnapshot } from "../combat/ammunition-resolver.js";

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
