import { NeuroshimaScript } from "../apps/neuroshima-script-engine.js";

export class NeuroshimaActiveEffect extends ActiveEffect {
  /**
   * The Actor that owns this ActiveEffect.
   * In FVTT v13, ActiveEffect no longer exposes an `actor` getter — only `target`.
   * We add our own so that _onCreate / _onDelete lifecycle scripts can always
   * resolve the owning actor regardless of whether the effect sits directly on
   * an Actor or is transferred from an Item.
   * @returns {Actor|null}
   */
  get actor() {
    if (this.parent instanceof CONFIG.Actor.documentClass) return this.parent;
    if (this.parent instanceof CONFIG.Item.documentClass) return this.parent.actor ?? null;
    return null;
  }

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
    const equipTransfer = this.getFlag("neuroshima", "equipTransfer") ?? false;
    if (equipTransfer) return false;
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
      || foundry.utils.hasProperty(changes, "flags.neuroshima.documentType")
      || foundry.utils.hasProperty(changes, "flags.neuroshima.equipTransfer");
    if (flagsChanged && this.parent?.documentName === "Item") {
      const mergedFlags = foundry.utils.mergeObject(
        foundry.utils.deepClone(this.flags?.neuroshima ?? {}),
        changes.flags?.neuroshima ?? {},
        { inplace: false }
      );
      const transferType = mergedFlags.transferType ?? "owningDocument";
      const documentType = mergedFlags.documentType ?? "actor";
      const equipTransfer = mergedFlags.equipTransfer ?? false;
      changes.transfer = !equipTransfer && (transferType === "owningDocument" && documentType === "actor");
    }
  }

  /**
   * Evaluate the Enable Script flag and return true if the effect should be suppressed.
   * When suppressed, Foundry will not apply this effect's Changes to the actor.
   * The user cannot manually toggle a script-controlled effect.
   * @override
   */
  get isSuppressed() {
    if (super.isSuppressed) return true;
    const enableScript = this.getFlag?.("neuroshima", "enableScript");
    if (!enableScript) return false;
    const actor = this.actor;
    if (!actor) return false;
    try {
      const _diseaseStates = ["none", "firstSymptoms", "acute", "critical", "terminal"];
      const getDiseases         = (a = actor) => (a?.items ?? []).filter(i => i.type === "disease").map(i => ({ id: i.id, name: i.name, diseaseType: i.system?.diseaseType ?? "chronic", currentState: i.system?.currentState ?? "none", transientPenalty: i.system?.transientPenalty ?? 0 }));
      const getDisease          = (a = actor) => (a?.items ?? []).find(i => i.type === "disease") ?? null;
      const getDiseaseStateName = (aOrItem = actor) => {
        if (aOrItem && typeof aOrItem === "object" && aOrItem.documentName === "Item") return aOrItem.system?.currentState ?? "none";
        return getDisease(aOrItem)?.system?.currentState ?? "none";
      };
      const getDiseaseStateId   = (aOrItem = actor) => { const s = getDiseaseStateName(aOrItem); const i = _diseaseStates.indexOf(s); return i < 0 ? 0 : i; };
      const sourceItem    = (this.parent instanceof CONFIG.Item.documentClass) ? this.parent : null;
      const thisCtx       = { actor, item: sourceItem };
      const fn = new Function("actor", "effect", "item", "getDisease", "getDiseases", "getDiseaseStateName", "getDiseaseStateId", enableScript);
      const result = fn.call(thisCtx, actor, this, sourceItem, getDisease, getDiseases, getDiseaseStateName, getDiseaseStateId);
      return !result;
    } catch (e) {
      console.error(`Neuroshima | enableScript (isSuppressed) error on "${this.name}":`, e);
      return false;
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
    if (game.user.id !== user) return;
    const isItemEffect = this.parent?.documentName === "Item";
    const isEquipTransfer = this.getFlag("neuroshima", "equipTransfer") === true;
    if (!isItemEffect || !isEquipTransfer) return;
    const actor = this.parent.actor;
    if (!actor) return;
    const copy = actor.effects.find(
      e => e.getFlag("neuroshima", "fromEquipTransfer") === true
        && (e.getFlag("neuroshima", "sourceEffectId") === this.id || e.id === this.id)
    );
    if (!copy) return;
    const syncData = foundry.utils.deepClone(data);
    delete syncData._id;
    copy.update(syncData).catch(err => console.error("NS | equipTransfer sync failed:", err));
  }

  async _onCreate(data, options, user) {
    await super._onCreate(data, options, user);
    const isAuraCopyOnCreate = !!this.getFlag("neuroshima", "fromAura");
    const isAreaCopyOnCreate = !!this.getFlag("neuroshima", "fromArea");
    if ((isAuraCopyOnCreate || isAreaCopyOnCreate) && this.actor && canvas?.interface) {
      const tokens = this.actor.getActiveTokens();
      for (const t of tokens) {
        if (!t.visible || !t.renderable) continue;
        canvas.interface.createScrollingText(t.center, "+" + this.name, {
          anchor: CONST.TEXT_ANCHOR_POINTS.CENTER, direction: CONST.TEXT_ANCHOR_POINTS.TOP,
          distance: 2 * t.h, fontSize: 36, fill: "0xFFFFFF",
          stroke: "0x000000", strokeThickness: 4, jitter: 0.25
        });
      }
    }
    if (game.user.id !== user) return;
    if (!this.actor) return;
    const createScripts = this.scripts.filter(s => s.trigger === "applyEffect");
    for (const script of createScripts) {
      await script.execute({ actor: this.actor, data, options });
    }
    const immediateScripts = this.scripts.filter(s => s.trigger === "immediate");
    for (const script of immediateScripts) {
      await script.execute({ actor: this.actor, data, options });
    }
    if (
      game.user.isGM &&
      !options.ns_skipAuraTrigger &&
      this.getFlag("neuroshima", "transferType") === "auraActor" &&
      this.getFlag("neuroshima", "auraTransferred") === true &&
      !this.disabled
    ) {
      const targets = Array.from(game.user.targets).map(t => t.actor).filter(a => a);
      if (targets.length) {
        const { NeuroshimaAuraManager } = await import("../apps/aura-manager.js");
        await NeuroshimaAuraManager.applyTransferredAuraCopies(this, this.actor, targets);
      }
    }
  }

  async _onDelete(options, user) {
    await super._onDelete(options, user);
    const isAuraCopy = !!this.getFlag("neuroshima", "fromAura");
    const isAreaCopy = !!this.getFlag("neuroshima", "fromArea");
    if ((isAuraCopy || isAreaCopy) && this.actor && canvas?.interface) {
      const tokens = this.actor.getActiveTokens();
      for (const t of tokens) {
        if (!t.visible || !t.renderable) continue;
        canvas.interface.createScrollingText(t.center, "-" + this.name, {
          anchor: CONST.TEXT_ANCHOR_POINTS.CENTER, direction: CONST.TEXT_ANCHOR_POINTS.TOP,
          distance: 2 * t.h, fontSize: 36, fill: "0xFF4444",
          stroke: "0x000000", strokeThickness: 4, jitter: 0.25
        });
      }
    }
    if (game.user.id !== user) return;
    if (!this.actor) return;

    const transferType = this.getFlag("neuroshima", "transferType");

    if (!isAuraCopy && !isAreaCopy && !options.skipDeletingItems) {
      await this.deleteCreatedItems();
    }

    if (!options.ns_skipAuraCleanup && !isAuraCopy && !isAreaCopy) {
      if (transferType === "auraActor" && game.user.isGM) {
        const { NeuroshimaAuraManager } = await import("../apps/aura-manager.js");
        await NeuroshimaAuraManager.removeAllCopiesForEffect(this.id, this.actor.id, this.actor.uuid);
      }
      if (transferType === "areaActor" && game.user.isGM) {
        const { NeuroshimaAuraManager } = await import("../apps/aura-manager.js");
        await NeuroshimaAuraManager.removeAllAreaCopiesForEffect(this.id, this.actor.id);
      }
    }

    if (!isAuraCopy && !isAreaCopy) {
      const deleteScripts = this.scripts.filter(s => s.trigger === "deleteEffect");
      for (const script of deleteScripts) {
        await script.execute({ actor: this.actor, options });
      }
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
   * Apply this effect to one or more actors.
   *
   * Uses convertToApplied() internally — each resulting copy on an actor carries
   * flags.neuroshima.sourceEffect = this.uuid, enabling cleanup via
   * NeuroshimaScript#removeEffectsAppliedFromThis().
   *
   * @param {Actor|Actor[]|Token|Token[]|null} [targets]
   *   Targets to apply the effect to.
   *   - null / undefined → resolved automatically: user's current targets, falling back to
   *     selected tokens, falling back to the user's assigned character.
   *   - A single Actor or Token → wrapped into a one-element array.
   *   - An array of Actors / Tokens → each is unwrapped (token.actor ?? token).
   * @param {Object} [overrides={}]
   *   Plain data merged into the effect before creating it on each actor
   *   (e.g. { "duration.seconds": 3600 }). Same semantics as convertToApplied(overrides).
   * @returns {Promise<number>} Number of actors the effect was successfully applied to.
   *
   * @example
   * // In any trigger — apply this effect to current targets
   * await this.effect.applyEffect();
   *
   * @example
   * // Apply to targets with a 1-hour duration override
   * await this.effect.applyEffect(null, { "duration.seconds": 3600 });
   *
   * @example
   * // Iterate effects list and apply all "Other" ones
   * for (const e of this.item.effects.contents) {
   *   if (e.getFlag("neuroshima", "transferType") === "other") {
   *     await e.applyEffect(this.getTargets());
   *   }
   * }
   *
   * @example
   * // WFRP-style: apply effect[0] from item
   * await this.item.effects.contents[0].applyEffect();
   */
  async applyEffect(targets = null, overrides = {}) {
    let resolved;
    if (targets === null || targets === undefined) {
      const runner = game.neuroshima?.NeuroshimaScriptRunner;
      resolved = runner ? runner.getTargetsOrSelected() : [];
    } else if (Array.isArray(targets)) {
      resolved = targets.map(t => t.actor ?? t).filter(a => a instanceof CONFIG.Actor.documentClass);
    } else {
      const a = targets.actor ?? targets;
      resolved = (a instanceof CONFIG.Actor.documentClass) ? [a] : [];
    }
    if (!resolved.length) return 0;
    const effectData = [this.convertToApplied(overrides)];
    for (const actor of resolved) {
      await actor.applyEffect({ effectData });
    }
    return resolved.length;
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
