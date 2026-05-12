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
      wound: "systems/neuroshima/assets/img/wound.svg",
      "vehicle-damage":  "systems/neuroshima/assets/img/tire-iron.svg",
      "vehicle-mod":     "systems/neuroshima/assets/img/tire-iron.svg",
      "beast-action":    "systems/neuroshima/assets/img/paw.svg",
      profession:        "systems/neuroshima/assets/img/profession.svg",
      specialization:    "systems/neuroshima/assets/img/specialization.svg",
      origin:            "systems/neuroshima/assets/img/passport.svg",
      trait:             "systems/neuroshima/assets/img/brain.svg",
      money:             "systems/neuroshima/assets/img/banknote.svg",
      reputation:        "systems/neuroshima/assets/img/shaking-hands.svg",
      disease:           "icons/svg/biohazard.svg"
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

    if (data.type === "trick" && this.parent?.type && ["character", "npc"].includes(this.parent.type) && user === game.user.id) {
      const { showXpDialog, applyXpEntry, TRICK_COST } = await import("../helpers/xp.js");
      const actor = this.parent;
      const i18n  = game.i18n;
      const desc  = i18n.format("NEUROSHIMA.XP.Log.TrickLearned", { name: data.name ?? i18n.localize("NEUROSHIMA.Items.Type.Trick") });
      const currentXp = actor.system?.xp?.current ?? 0;

      const choice = await showXpDialog(TRICK_COST, desc, currentXp);
      if (choice === null) return false;

      if (!choice.free && TRICK_COST > 0) {
        const fakeDelta = {};
        applyXpEntry(actor, fakeDelta, TRICK_COST, desc, null, "");
        await actor.update(fakeDelta);
      } else {
        const fakeDelta = {};
        applyXpEntry(actor, fakeDelta, 0, desc, null, "");
        await actor.update(fakeDelta);
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

  // ── Wound helpers ──────────────────────────────────────────────────────────

  /** Full severity order (interleaved) — used for comparison only. */
  static DAMAGE_ORDER = ["D", "sD", "L", "sL", "C", "sC", "K", "sK"];

  /** Regular wound track: D → L → C → K (no s-prefix). */
  static REGULAR_TRACK = ["D", "L", "C", "K"];

  /** Bruise wound track: sD → sL → sC → sK (s-prefix). */
  static BRUISE_TRACK = ["sD", "sL", "sC", "sK"];

  /**
   * Return the track array for a given damageType.
   * @param {string} damageType
   * @returns {string[]}
   */
  static trackFor(damageType) {
    return damageType?.startsWith("s") ? NeuroshimaItem.BRUISE_TRACK : NeuroshimaItem.REGULAR_TRACK;
  }

  /**
   * Reduce the wound's damage type by `n` levels within its own track.
   * Regular wounds stay on the regular track (K → C → L → D).
   * Bruise wounds stay on the bruise track (sK → sC → sL → sD).
   * @param {number} n
   */
  async reduceLevel(n = 1) {
    if (this.type !== "wound") return;
    const track = NeuroshimaItem.trackFor(this.system.damageType);
    const current = track.indexOf(this.system.damageType);
    if (current < 0) return;
    const next = Math.max(0, current - n);
    await this.update({ "system.damageType": track[next] });
  }

  /**
   * Increase the wound's damage type by `n` levels within its own track.
   * Regular wounds stay on the regular track (D → L → C → K).
   * Bruise wounds stay on the bruise track (sD → sL → sC → sK).
   * @param {number} n
   */
  async increaseLevel(n = 1) {
    if (this.type !== "wound") return;
    const track = NeuroshimaItem.trackFor(this.system.damageType);
    const current = track.indexOf(this.system.damageType);
    if (current < 0) return;
    const next = Math.min(track.length - 1, current + n);
    await this.update({ "system.damageType": track[next] });
  }

  /**
   * Reduce the wound's penalty by `n` (clamped to 0).
   * Only works on items of type "wound".
   * @param {number} n
   */
  async reducePenalty(n = 1) {
    if (this.type !== "wound") return;
    const next = Math.max(0, (this.system.penalty ?? 0) - n);
    await this.update({ "system.penalty": next });
  }

  /**
   * Increase the wound's penalty by `n`.
   * Only works on items of type "wound".
   * @param {number} n
   */
  async increasePenalty(n = 1) {
    if (this.type !== "wound") return;
    const next = (this.system.penalty ?? 0) + n;
    await this.update({ "system.penalty": next });
  }

  /**
   * Returns true if this wound is currently being healed (isHealing flag is set).
   * Always false for non-wound items.
   * @type {boolean}
   */
  get isHealing() {
    if (this.type !== "wound") return false;
    return this.system.isHealing === true;
  }

  /**
   * Fully heal this wound by deleting the wound item from its parent actor.
   * No-op if this item is not of type "wound" or has no parent.
   * @returns {Promise<Item|null>}
   */
  async heal() {
    if (this.type !== "wound") return null;
    if (!this.parent) return null;
    return this.delete();
  }

  // ── Quantity helpers ───────────────────────────────────────────────────────

  /**
   * Returns true if this item tracks quantity (has system.quantity defined).
   */
  get hasQuantity() {
    return typeof this.system?.quantity === "number";
  }

  /**
   * Reduce item quantity by `n` (clamped to 0). No-op if item has no quantity.
   * @param {number} n
   */
  async reduceQuantity(n = 1) {
    if (!this.hasQuantity) return;
    const next = Math.max(0, this.system.quantity - n);
    await this.update({ "system.quantity": next });
  }

  /**
   * Increase item quantity by `n`. No-op if item has no quantity.
   * @param {number} n
   */
  async increaseQuantity(n = 1) {
    if (!this.hasQuantity) return;
    const next = this.system.quantity + n;
    await this.update({ "system.quantity": next });
  }

  /** @override */
  _onUpdate(data, options, userId) {
    super._onUpdate(data, options, userId);
    if (game.user.id !== userId) return;

    const actor = this.parent;
    if (!actor || actor.documentName !== "Actor") return;

    const equippedChanged = foundry.utils.hasProperty(data, "system.equipped");
    if (equippedChanged) {
      const equipped = data.system.equipped;
      actor.syncEquipTransferEffects(this, equipped);
      import("../apps/neuroshima-script-engine.js").then(({ NeuroshimaScriptRunner }) => {
        NeuroshimaScriptRunner.execute("equipToggle", { actor, item: this, equipped });
      });
    }

    const specChanged = this.type === "specialization" && foundry.utils.hasProperty(data, "system.skillSpecializations");
    if (specChanged) {
      const updateData = {};
      const allSpecKeys = Object.keys(actor.system.specializations ?? {});
      for (const key of allSpecKeys) updateData[`system.specializations.${key}`] = false;
      for (const specItem of actor.items.filter(i => i.type === "specialization")) {
        const specs = specItem.system.skillSpecializations ?? {};
        for (const [key, enabled] of Object.entries(specs)) {
          if (enabled) updateData[`system.specializations.${key}`] = true;
        }
      }
      actor.update(updateData);
    }
  }

  _onDelete(options, userId) {
    super._onDelete(options, userId);
    if (game.user.id !== userId) return;

    const actor = this.parent;
    if (!actor || actor.documentName !== "Actor") return;

    if (this.type === "specialization") {
      const updateData = {};
      const allSpecKeys = Object.keys(actor.system.specializations ?? {});
      for (const key of allSpecKeys) updateData[`system.specializations.${key}`] = false;
      for (const specItem of actor.items.filter(i => i.type === "specialization" && i.id !== this.id)) {
        const specs = specItem.system.skillSpecializations ?? {};
        for (const [key, enabled] of Object.entries(specs)) {
          if (enabled) updateData[`system.specializations.${key}`] = true;
        }
      }
      actor.update(updateData);
    }
  }
}
