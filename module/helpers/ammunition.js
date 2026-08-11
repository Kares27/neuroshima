/**
 * Create one full magazine which matches a ranged weapon.
 * The generated stack represents standard ammunition, so its overrides stay
 * disabled and the ranged test continues to use the weapon's own damage,
 * piercing and jamming values.
 *
 * @param {Actor} actor Parent inventory receiving the magazine.
 * @param {Item} weapon Ranged weapon used as the source of caliber/capacity.
 * @returns {Promise<Item|null>}
 */
export async function createLoadedMagazineFromWeapon(actor, weapon) {
  if (!actor || weapon?.type !== "weapon" || weapon.system?.weaponType !== "ranged") return null;

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
