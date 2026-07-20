/**
 * Extended Item document class for Neuroshima 1.5.
 *
 * Responsibilities beyond the Foundry base:
 * - Assigns system-specific default icons per item type at creation time.
 * - Presents a weapon-type selection dialog for new weapons (melee / ranged / thrown / grenade).
 * - Deducts XP (with dialog confirmation) when a trick is added to a character or NPC.
 * - Derives `totalWeight` (own weight × quantity + container contents) and `effectiveCost`
 *   (base cost + mod deltas) during `prepareDerivedData`.
 * - Protects mod-injected resource rows from being overwritten by form submissions.
 * - Propagates equip-transfer effects and specialization flags when items are equipped /
 *   toggled or specialization items are added / removed.
 * - Re-renders open container sheets on all clients when a contained item changes its
 *   `containerId` flag (DnD5e-style container pattern).
 */
export class NeuroshimaItem extends Item {
  /**
   * Set default icons, localise the item name, and — for weapons — prompt for weapon type.
   * For tricks added to characters / NPCs: deduct XP via the XP dialog (cancellable).
   *
   * Returning `false` from this hook aborts item creation entirely (used when the GM
   * closes the weapon-type dialog without picking).
   *
   * @override
   */
  async _preCreate(data, options, user) {
    const result = await super._preCreate(data, options, user);
    if (result === false) return false;

    // Default icons per item type
    const icons = {
      ammo: "systems/neuroshima/assets/img/ammo.svg",
      magazine: "systems/neuroshima/assets/img/magazine.svg",
      armor: "systems/neuroshima/assets/img/armor.svg",
      gear: "systems/neuroshima/assets/img/swap-bag.svg",
      trick: "systems/neuroshima/assets/img/trick.svg",
      weapon: "systems/neuroshima/assets/img/weapon-melee.svg",
      wound: "systems/neuroshima/assets/img/wound.svg",
      "vehicle-damage":  "systems/neuroshima/assets/img/tire-iron.svg",
      "vehicle-mod":     "systems/neuroshima/assets/img/tire-iron.svg",
      "weapon-mod":      "systems/neuroshima/assets/img/modification.svg",
      "armor-mod":       "systems/neuroshima/assets/img/modification.svg",
      "beast-action":    "systems/neuroshima/assets/img/paw.svg",
      "beast-segment":   "systems/neuroshima/assets/img/paw.svg",
      profession:        "systems/neuroshima/assets/img/profession.svg",
      specialization:    "systems/neuroshima/assets/img/specialization.svg",
      origin:            "systems/neuroshima/assets/img/passport.svg",
      trait:             "systems/neuroshima/assets/img/brain.svg",
      money:             "systems/neuroshima/assets/img/banknote.svg",
      reputation:        "systems/neuroshima/assets/img/shaking-hands.svg",
      disease:           "icons/svg/biohazard.svg",
      facilities:        "systems/neuroshima/assets/img/facilities.svg",
      container:         "systems/neuroshima/assets/img/backpack.svg"
    };

    const updates = {};

    // Override weapon icon based on weaponType
    if (data.type === "weapon") {
        const wType = foundry.utils.getProperty(data, "system.weaponType");
        if (wType === "ranged") icons.weapon = "systems/neuroshima/assets/img/weapon-ranged.svg";
        else if (wType === "thrown") icons.weapon = "systems/neuroshima/assets/img/weapon-throwable.svg";
        else if (wType === "grenade") icons.weapon = "systems/neuroshima/assets/img/grenade.svg";
    }

    // Apply default icon if none is set or the generic bag fallback is used
    if (!data.img || data.img === "icons/svg/item-bag.svg") {
      updates.img = icons[data.type] || "systems/neuroshima/assets/img/swap-bag.svg";
    }

    // Apply localized type name when the item has a generic or empty name
    const isGenericName = !data.name || data.name.includes("New") || data.name.includes("Item");
    if (isGenericName) {
      updates.name = game.i18n.localize(`NEUROSHIMA.Items.Type.${data.type.charAt(0).toUpperCase() + data.type.slice(1)}`);
    }

    if (Object.keys(updates).length > 0) {
      this.updateSource(updates);
    }

    // Show weapon-type selection dialog only when manually creating a new weapon;
    // skip if the type is already set or if this is a copy/compendium drop.
    const isNewWeapon = (data.type === "weapon") && !foundry.utils.hasProperty(data, "system.weaponType");
    const hasSource = !!(data.flags?.core?.sourceId || data._stats?.compendiumSource);
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
          },
          {
            action: "grenade",
            label: game.i18n.localize("NEUROSHIMA.Items.Type.WeaponGrenade"),
            callback: (event, button, dialog) => "grenade"
          }
        ],
        classes: ["neuroshima", "dialog-vertical"],
        rejectClose: false
      });

      if (weaponType) {
        const weaponUpdates = { "system.weaponType": weaponType };
        
        // Update the icon to match the chosen weapon type if still on the default
        const currentImg = this.img;
        if (!currentImg || currentImg === "icons/svg/item-bag.svg" || currentImg === "systems/neuroshima/assets/img/swap-bag.svg" || currentImg === "systems/neuroshima/assets/img/weapon-melee.svg") {
            if (weaponType === "ranged") weaponUpdates.img = "systems/neuroshima/assets/img/weapon-ranged.svg";
            else if (weaponType === "thrown") weaponUpdates.img = "systems/neuroshima/assets/img/weapon-throwable.svg";
            else if (weaponType === "grenade") weaponUpdates.img = "systems/neuroshima/assets/img/grenade.svg";
            else weaponUpdates.img = "systems/neuroshima/assets/img/weapon-melee.svg";
        }
        if (weaponType === "grenade") {
          weaponUpdates.name = game.i18n.localize("NEUROSHIMA.Items.Type.WeaponGrenade");
        }
        
        this.updateSource(weaponUpdates);
      } else {
        return false; // Dialog closed without selection — cancel item creation
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

  /**
   * Compute derived fields not stored in the database:
   * - `pileCategory` — used by item-pile integration; prefixes gear type with a thin-space so
   *   gear sorts after weapon/armor but before misc in the pile UI.
   * - `system.totalWeight` — own weight × quantity, plus container contents weight when this
   *   item is a container with `countWeightToEncumbrance = true`.
   * - `system.effectiveCost` — base cost adjusted by the sum of all attached mod `deltaCost`
   *   values (mods with `deltaModifiesCost = false` are excluded).
   * @override
   */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.pileCategory = this.type === "gear" ? ("\u200A" + (this.system?.gearType ?? "misc")) : this.type;
    const system = this.system;
    
    if ("weight" in system && "quantity" in system) {
      const ownWeight = (parseFloat(system.weight) || 0) * (parseInt(system.quantity) || 0);
      let contentsWeight = 0;
      if (this.type === "container" && system.countWeightToEncumbrance) {
        if (this.actor) {
          contentsWeight = Array.from(this.actor.items)
            .filter(i => i.getFlag("neuroshima", "containerId") === this.id)
            .reduce((sum, i) => sum + (parseFloat(i.system?.weight || 0) * (parseInt(i.system?.quantity || 1))), 0);
        } else {
          contentsWeight = (system.contents || []).reduce((sum, entry) => {
            return sum + (parseFloat(entry.system?.weight || 0) * (parseInt(entry.system?.quantity || 1)));
          }, 0);
        }
      }
      system.totalWeight = Math.round((ownWeight + contentsWeight) * 100) / 100;
    }

    if ("cost" in system) {
      let effectiveCost = system.cost ?? 0;
      if ("mods" in system) {
        for (const [key, snap] of Object.entries(system.mods ?? {})) {
          if (key.startsWith("__") || !snap.attached) continue;
          if (snap.deltaModifiesCost === false) continue;
          effectiveCost += (snap.deltaCost ?? 0);
        }
      }
      system.effectiveCost = Math.max(0, effectiveCost);
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

  /**
   * Capture the current `containerId` flag before any flag change so that `_onUpdate` can
   * locate and re-render the former parent container sheet on all clients.
   *
   * Also guards mod-injected resource rows: if the item currently has any resources that were
   * injected by a weapon mod (`_fromModId` present), the submitted `system.resources` array is
   * merged rather than replaced so those rows are never silently overwritten by form data.
   *
   * @override
   */
  async _preUpdate(changed, options, userId) {
    await super._preUpdate(changed, options, userId);

    // Capture the current containerId before any flag change so _onUpdate can
    // re-render the former parent container on all clients (DnD5e pattern).
    const nsFlags = foundry.utils.getProperty(changed, "flags.neuroshima");
    if (nsFlags && ("containerId" in nsFlags || "-=containerId" in nsFlags)) {
      options._formerContainerId = this.getFlag("neuroshima", "containerId") ?? null;
    }

    // Protect mod-injected resource rows from being overwritten by form submissions.
    const newResources = foundry.utils.getProperty(changed, "system.resources");
    if (!newResources) return;

    const currentResources = Array.from(this.system?.resources ?? []);
    const hasMod = currentResources.some(r => r._fromModId);
    if (!hasMod) return;

    let resourcesArray;
    if (Array.isArray(newResources)) {
      resourcesArray = newResources;
    } else if (typeof newResources === "object") {
      resourcesArray = Object.entries(newResources)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([, v]) => v);
    } else {
      return;
    }

    const merged = resourcesArray.map((submitted, idx) => {
      const original = currentResources[idx];
      if (!original?._fromModId) return submitted;
      return { ...original, value: submitted?.value ?? original.value };
    });

    foundry.utils.setProperty(changed, "system.resources", merged);
  }

  /**
   * Re-render all open sheets of the container item identified by `containerId`
   * on the given actor.  Called from document lifecycle hooks on all clients.
   * @param {Actor} actor
   * @param {string} containerId
   */
  static _rerenderParentContainerById(actor, containerId) {
    if (!actor || !containerId) return;
    const container = actor.items.get(containerId);
    if (!container) return;
    for (const app of Object.values(container.apps ?? {})) {
      if (app.rendered) app.render(false);
    }
  }

  /**
   * Trigger a re-render of the parent container sheet (on all clients) when this item is
   * created inside a container (i.e. it already has a `containerId` flag at creation time).
   *
   * Also fires `applyEffect` and `immediate` trigger scripts for all embedded AEs when this
   * item is created on an actor (owning client only). This mirrors the behaviour of
   * `NeuroshimaActiveEffect._onCreate` for item-embedded effects — which FoundryVTT does not
   * independently fire when the parent Item is created with pre-existing effect data.
   * @override
   */
  async _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    const containerId = this.getFlag("neuroshima", "containerId");
    const actor = this.parent?.documentName === "Actor" ? this.parent : null;
    if (containerId && actor) {
      NeuroshimaItem._rerenderParentContainerById(actor, containerId);
    }

    if (!actor) return;
    if (game.user.id !== userId) return;

    // Foundry does not guarantee that callers awaiting createEmbeddedDocuments()
    // also await asynchronous work performed by this lifecycle callback. Expose
    // the work as a promise so flows which depend on Immediate scripts can wait
    // for their dialogs and other asynchronous operations to finish.
    this._createEffectScriptsPromise = this._executeCreateEffectScripts(actor, data, options);
    await this._createEffectScriptsPromise;
  }

  async _executeCreateEffectScripts(actor, data, options) {
    for (const effect of this.effects) {
      const createScripts = effect.scripts.filter(s => s.trigger === "applyEffect");
      for (const script of createScripts) {
        await script.execute({ actor, item: this, data, options });
      }
      const immediateScripts = effect.scripts.filter(s => s.trigger === "immediate");
      for (const script of immediateScripts) {
        await script.execute({ actor, item: this, data, options });
      }
    }
  }

  /** Wait until applyEffect and Immediate scripts fired during item creation finish. */
  async waitForCreateEffectScripts() {
    await (this._createEffectScriptsPromise ?? Promise.resolve());
  }

  /**
   * React to item updates on the owning client.
   *
   * - Always: re-renders open sheets of the current and (if changed) former container.
   * - Owning client only:
   *   - `system.equipped` change → sync equip-transfer effects and fire `equipToggle` scripts.
   *   - `system.isBuilt` change on facilities → sync equip-transfer effects.
   *   - `system.skillSpecializations` change on specialization → rebuild actor's specializations map.
   *
   * @override
   */
  _onUpdate(data, options, userId) {
    super._onUpdate(data, options, userId);

    const actor = this.parent;
    if (actor?.documentName === "Actor") {
      const containerId = this.getFlag("neuroshima", "containerId");
      if (containerId) NeuroshimaItem._rerenderParentContainerById(actor, containerId);
      const formerContainerId = options._formerContainerId;
      if (formerContainerId && formerContainerId !== containerId) {
        NeuroshimaItem._rerenderParentContainerById(actor, formerContainerId);
      }
    }

    if (game.user.id !== userId) return;
    if (!actor || actor.documentName !== "Actor") return;

    const equippedChanged = foundry.utils.hasProperty(data, "system.equipped");
    if (equippedChanged) {
      const equipped = data.system.equipped;
      actor.syncEquipTransferEffects(this, equipped);
      import("../apps/neuroshima-script-engine.js").then(({ NeuroshimaScriptRunner }) => {
        game.neuroshima?.log("[item._onUpdate] firing equipToggle scripts", { itemName: this.name, actorName: actor.name, equipped });
        NeuroshimaScriptRunner.execute("equipToggle", { actor, item: this, equipped });
      }).catch(err => console.error("Neuroshima | equipToggle script dispatch failed:", err));
    }

    const isBuiltChanged = this.type === "facilities" && foundry.utils.hasProperty(data, "system.isBuilt");
    if (isBuiltChanged) {
      actor.syncEquipTransferEffects(this, data.system.isBuilt);
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

  /**
   * Clean up after item deletion on the owning client.
   *
   * - Always: re-renders open sheets of the parent container (if any).
   * - Owning client only:
   *   - Specialization items → rebuilds the actor's specializations map.
   *   - Facilities items → removes equip-transfer effect copies from the actor.
   *
   * @override
   */
  async _onDelete(options, userId) {
    super._onDelete(options, userId);

    const actor = this.parent;
    if (actor?.documentName === "Actor") {
      const containerId = this.getFlag("neuroshima", "containerId");
      if (containerId) NeuroshimaItem._rerenderParentContainerById(actor, containerId);
    }

    if (game.user.id !== userId) return;
    if (!actor || actor.documentName !== "Actor") return;

    const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
    for (const effect of this.effects) {
      const deleteScripts = effect.scripts.filter(s => s.trigger === "deleteEffect");
      for (const script of deleteScripts) {
        await script.execute({ actor, item: this, options });
      }
    }

    if (this.type === "origin" || this.type === "profession") {
      const linkedTraits = actor.items.filter(i =>
        i.type === "trait" && i.getFlag?.("neuroshima", "traitSource")?.itemId === this.id
      );
      for (const t of linkedTraits) await t.delete();
    }

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

    if (this.type === "facilities") {
      const toDelete = actor.effects
        .filter(e => e.origin === this.uuid && e.getFlag("neuroshima", "fromEquipTransfer") === true)
        .map(e => e.id);
      if (toDelete.length) actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    }
  }
}
