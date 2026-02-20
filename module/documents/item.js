export class NeuroshimaItem extends Item {
  /** @override */
  async _preCreate(data, options, user) {
    const result = await super._preCreate(data, options, user);
    if (result === false) return false;

    // Domyślne ikony dla typów przedmiotów z folderu assets systemu
    const icons = {
      ammo: "systems/neuroshima/assets/img/ammo.svg",
      magazine: "systems/neuroshima/assets/img/magazine.svg",
      armor: "systems/neuroshima/assets/img/armor.svg",
      gear: "icons/svg/item-bag.svg",
      trick: "systems/neuroshima/assets/img/trick.svg",
      weapon: "systems/neuroshima/assets/img/weapon-melee.svg",
      wound: "systems/neuroshima/assets/img/wound.svg"
    };

    const updates = {};

    // Specjalna obsługa ikon broni na podstawie weaponType
    if (data.type === "weapon") {
        const wType = foundry.utils.getProperty(data, "system.weaponType");
        if (wType === "ranged") icons.weapon = "systems/neuroshima/assets/img/weapon-ranged.svg";
        else if (wType === "thrown") icons.weapon = "systems/neuroshima/assets/img/weapon-throwable.svg";
    }

    // Ustaw domyślną ikonę, jeśli nie została podana lub jest domyślnym bagiem (a nie powinna dla tego typu)
    if (!data.img || data.img === "icons/svg/item-bag.svg") {
      updates.img = icons[data.type] || "icons/svg/item-bag.svg";
    }

    // Ustaw domyślną nazwę, jeśli nazwa jest generyczna (np. "New Item" lub pusta)
    const isGenericName = !data.name || data.name.includes("New") || data.name.includes("Item");
    if (isGenericName) {
      updates.name = game.i18n.localize(`NEUROSHIMA.Items.Type.${data.type.charAt(0).toUpperCase() + data.type.slice(1)}`);
    }

    if (Object.keys(updates).length > 0) {
      this.updateSource(updates);
    }

    // Pokaż dialog wyboru typu broni tylko przy ręcznym tworzeniu nowej broni, 
    // jeśli typ nie został już określony i nie jest to operacja kopiowania/dropu z innego źródła
    const isNewWeapon = (data.type === "weapon") && !foundry.utils.hasProperty(data, "system.weaponType");
    
    // Sprawdź czy przedmiot ma źródło (co wskazuje na drop/klonowanie)
    const hasSource = !!(data.flags?.core?.sourceId || data._stats?.compendiumSource);
    
    // Nie pokazuj dialogu, jeśli przedmiot ma już zdefiniowane źródło lub typ
    if (isNewWeapon && !hasSource && user.id === game.user.id) {
      const weaponType = await foundry.applications.api.DialogV2.wait({
        window: {
          title: game.i18n.localize("NEUROSHIMA.Dialog.WeaponType.Title")
        },
        content: `<p style="text-align: center;">${game.i18n.localize("NEUROSHIMA.Dialog.WeaponType.Content")}</p>`,
        buttons: [
          {
            action: "melee",
            label: game.i18n.localize("NEUROSHIMA.Items.Type.WeaponMelee"),
            default: true,
            callback: (event, button, dialog) => "melee"
          },
          {
            action: "ranged",
            label: game.i18n.localize("NEUROSHIMA.Items.Type.WeaponRanged"),
            callback: (event, button, dialog) => "ranged"
          },
          {
            action: "thrown",
            label: game.i18n.localize("NEUROSHIMA.Items.Type.WeaponThrown"),
            callback: (event, button, dialog) => "thrown"
          }
        ],
        classes: ["neuroshima", "dialog-vertical"],
        rejectClose: false
      });

      if (weaponType) {
        const weaponUpdates = { "system.weaponType": weaponType };
        
        // Zaktualizuj ikonę na podstawie wybranego typu, jeśli nadal jest domyślna
        const currentImg = this.img;
        if (!currentImg || currentImg === "icons/svg/item-bag.svg" || currentImg === "systems/neuroshima/assets/img/weapon-melee.svg") {
            if (weaponType === "ranged") weaponUpdates.img = "systems/neuroshima/assets/img/weapon-ranged.svg";
            else if (weaponType === "thrown") weaponUpdates.img = "systems/neuroshima/assets/img/weapon-throwable.svg";
            else weaponUpdates.img = "systems/neuroshima/assets/img/weapon-melee.svg";
        }
        
        this.updateSource(weaponUpdates);
      } else {
        return false; // Anuluj tworzenie przedmiotu, jeśli okno zostało zamknięte bez wyboru
      }
    }
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    const system = this.system;
    
    // Calculate total weight based on quantity
    if ("weight" in system && "quantity" in system) {
      system.totalWeight = (parseFloat(system.weight) || 0) * (parseInt(system.quantity) || 0);
      // Round to 2 decimal places to avoid floating point issues
      system.totalWeight = Math.round(system.totalWeight * 100) / 100;
    }
  }

  /** @override */
}
