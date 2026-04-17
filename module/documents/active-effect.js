import { NeuroshimaScript } from "../apps/neuroshima-script-engine.js";

export class NeuroshimaActiveEffect extends ActiveEffect {
  get scripts() {
    if (!this._scripts) {
      const scriptData = this.getFlag("neuroshima", "scripts") || [];
      this._scripts = scriptData.map(s => new NeuroshimaScript(s, this));
    }
    return this._scripts;
  }

  /**
   * Determine whether this effect should automatically transfer to the owning Actor.
   * Only "Owning Document" + "Actor" combination transfers natively via Foundry's
   * embedded-effect transfer mechanism. Everything else is handled via scripts or
   * other application methods.
   * @returns {boolean}
   */
  determineTransfer() {
    const transferType = this.getFlag("neuroshima", "transferType") ?? "owningDocument";
    const documentType = this.getFlag("neuroshima", "documentType") ?? "actor";
    return transferType === "owningDocument" && documentType === "actor";
  }

  /** @override — auto-correct transfer before creation */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    if (this.parent?.documentName === "Item") {
      this.updateSource({ transfer: this.determineTransfer() });
    }
    // Auto-fill duration tracking fields required by modules like "Times Up":
    // duration.combat  — links the effect to the active combat so modules can track expiry
    // duration.startRound / startTurn — record when the effect was created
    // Only applied when the effect has a rounds/turns duration and is on an Actor.
    if (this.parent?.documentName === "Actor") {
      const combat = game.combat;
      const hasCombatDuration = (this.duration?.rounds > 0) || (this.duration?.turns > 0);
      if (hasCombatDuration && combat) {
        const durationUpdates = {};
        if (!this.duration?.combat)      durationUpdates["duration.combat"]     = combat.id;
        if (this.duration?.startRound == null) durationUpdates["duration.startRound"] = combat.round;
        if (this.duration?.startTurn  == null) durationUpdates["duration.startTurn"]  = combat.turn;
        if (Object.keys(durationUpdates).length) {
          this.updateSource(durationUpdates);
        }
      }
    }
  }

  /** @override — auto-correct transfer when flags change */
  async _preUpdate(changes, options, user) {
    await super._preUpdate(changes, options, user);
    const flagsChanged = foundry.utils.hasProperty(changes, "flags.neuroshima.transferType")
      || foundry.utils.hasProperty(changes, "flags.neuroshima.documentType");
    if (flagsChanged && this.parent?.documentName === "Item") {
      const mergedFlags = foundry.utils.mergeObject(
        foundry.utils.deepClone(this.flags?.neuroshima ?? {}),
        changes.flags?.neuroshima ?? {},
        { inplace: false }
      );
      const transferType = mergedFlags.transferType ?? "owningDocument";
      const documentType = mergedFlags.documentType ?? "actor";
      changes.transfer = (transferType === "owningDocument" && documentType === "actor");
    }
  }

  prepareData() {
    super.prepareData();
    this._scripts = null;
    if (this.parent?.documentName === "Item") {
      this.transfer = this.determineTransfer();
    }
  }

  _onUpdate(data, options, user) {
    super._onUpdate(data, options, user);
    this._scripts = null;
  }

  async _onCreate(data, options, user) {
    await super._onCreate(data, options, user);
    if (game.user.id !== user) return;
    if (!this.actor) return;
    const createScripts = this.scripts.filter(s => s.trigger === "createEffect");
    for (const script of createScripts) {
      await script.execute({ actor: this.actor, data, options });
    }
    const immediateScripts = this.scripts.filter(s => s.trigger === "immediate");
    for (const script of immediateScripts) {
      await script.execute({ actor: this.actor, data, options });
    }
  }

  async _onDelete(options, user) {
    await super._onDelete(options, user);
    if (game.user.id !== user) return;
    if (!this.actor) return;
    if (!options.skipDeletingItems) {
      await this.deleteCreatedItems();
    }
    const deleteScripts = this.scripts.filter(s => s.trigger === "deleteEffect");
    for (const script of deleteScripts) {
      await script.execute({ actor: this.actor, options });
    }
  }

  /**
   * Return items on the owning actor that were created by a script belonging to this effect.
   * Items must have been flagged with `flags.neuroshima.fromEffect = this.id` at creation time.
   * @returns {Item[]}
   */
  getCreatedItems() {
    if (!this.actor) return [];
    return this.actor.items.filter(i => i.getFlag("neuroshima", "fromEffect") === this.id);
  }

  /**
   * Delete all items that were created by scripts in this effect.
   * Called automatically in _onDelete (unless options.skipDeletingItems is true).
   * @returns {Promise<void>}
   */
  async deleteCreatedItems() {
    const items = this.getCreatedItems();
    if (!items.length) return;
    ui.notifications.notify(`${this.name}: ${game.i18n.localize("NEUROSHIMA.Effects.DeletingItems")} ${items.map(i => i.name).join(", ")}`);
    await this.actor.deleteEmbeddedDocuments("Item", items.map(i => i.id));
  }

  /**
   * All manual scripts on this effect, filtered by runIfDisabled when the effect is disabled.
   * Each script is augmented with its index for triggering from the sheet.
   * @type {NeuroshimaScript[]}
   */
  get manualScripts() {
    return this.scripts
      .map((s, i) => { s.index = i; return s; })
      .filter(s => s.trigger === "manual")
      .filter(s => !this.disabled || s.runIfDisabled);
  }

  /**
   * Convert this item-embedded effect into plain data suitable for applying directly
   * to an actor via Actor#createEmbeddedDocuments or Actor#applyEffect({ effectData }).
   *
   * Inspired by WFRP4e's convertToApplied().
   *
   * - Strips the _id so Foundry generates a fresh one on the actor.
   * - Sets transfer = false (the effect lives on the actor, not via transfer).
   * - Stores source item UUID in flags.neuroshima.sourceItem so scripts can trace origin.
   * - Accepts optional overrides merged on top (e.g. duration, name).
   *
   * @param {Object} [overrides={}] - Plain data to merge over the result (deep merge).
   * @returns {Object} Effect creation data object.
   *
   * @example
   * // In a manual script on an item effect:
   * const effectData = this.item.effects.contents[1].convertToApplied({
   *   "duration.seconds": 3600
   * });
   * await this.actor.applyEffect({ effectData: [effectData] });
   */
  convertToApplied(overrides = {}) {
    const data = this.toObject();
    delete data._id;
    data.transfer = false;
    foundry.utils.setProperty(data, "flags.neuroshima.sourceItem", this.parent?.uuid ?? null);
    foundry.utils.setProperty(data, "flags.neuroshima.sourceEffect", this.uuid);
    if (Object.keys(overrides).length) {
      foundry.utils.mergeObject(data, foundry.utils.expandObject(overrides));
    }
    return data;
  }

  /**
   * UUID of the source item this effect was originally embedded on.
   * Set automatically by convertToApplied(). Returns null if not applied from an item.
   * @type {string|null}
   */
  get sourceItemUuid() {
    return this.getFlag("neuroshima", "sourceItem") ?? null;
  }

  /**
   * The source item document, resolved synchronously from the UUID stored in flags.
   * Returns null if not found or effect was not created via convertToApplied().
   * @type {Item|null}
   */
  get sourceItem() {
    const uuid = this.sourceItemUuid;
    if (!uuid) return null;
    const doc = fromUuidSync(uuid);
    return doc ?? null;
  }
}
