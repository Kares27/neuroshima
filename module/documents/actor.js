import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

export class NeuroshimaActor extends Actor {
  /** @override */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    const updates = {};
    if (data.type === "character") {
      updates["prototypeToken.actorLink"] = true;
    }
    const actorIcons = {
      vehicle: "systems/neuroshima/assets/img/carkey.svg"
    };
    if (actorIcons[data.type] && (!data.img || data.img === "icons/svg/mystery-man.svg")) {
      updates.img = actorIcons[data.type];
    }
    if (Object.keys(updates).length > 0) {
      this.updateSource(updates);
    }
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    NeuroshimaScriptRunner.executeSync("prepareData", { actor: this });
  }

  /**
   * Unified initiative roll for Neuroshima 1.5.
   * @param {Object} rollOptions - Initial options for the dialog.
   * @returns {Promise<Object>} The roll result.
   */
  async rollInitiativeDialog(rollOptions = {}) {
    const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
    const { NeuroshimaDice } = await import("../helpers/dice.js");

    return new Promise((resolve) => {
      let resolved = false;
      const dialog = new NeuroshimaInitiativeRollDialog({
        actor: this,
        ...rollOptions,
        onRoll: async (data) => {
          resolved = true;
          const result = await NeuroshimaDice.rollInitiative({
            ...data,
            actor: this
          });
          resolve(result);
          return result;
        },
        onClose: () => {
          if (!resolved) resolve(null);
        }
      });
      dialog.render(true);
    });
  }

  /** @override */
  async rollInitiative(options = {}) {
    // If we're already in combat, get the combatant
    const combatant = options.combatant || this.token?.combatant || game.combat?.getCombatantByActor(this.id);
    
    // Open the dialog
    const result = await this.rollInitiativeDialog({
        combatant: combatant,
        ...options
    });
    
    if (!result) return null;

    // Success Points are used as initiative value
    const initiativeValue = Number(result.successPoints);
    
    // If we have a combatant, update their initiative in the tracker
    if (combatant) {
        game.neuroshima.log(`Updating combatant ${combatant.id} initiative to ${initiativeValue}`);
        await combatant.update({ initiative: initiativeValue });
    }
    
    return initiativeValue;
  }

  // ── Script-facing helpers ──────────────────────────────────────────────────

  /**
   * Return wound items on this actor, optionally filtered.
   *
   * @param {Object} [filter={}]
   * @param {boolean} [filter.active]       - If true, return only active wounds (isActive === true).
   * @param {boolean} [filter.healing]      - If true, return only wounds currently being healed.
   * @param {string}  [filter.location]     - Filter by body/vehicle location key (e.g. "head").
   * @param {string}  [filter.damageType]   - Filter by exact damage type (e.g. "C").
   * @param {boolean} [filter.bruise]       - If true, return only bruise wounds (isBruise).
   * @returns {Item[]}
   */
  getWounds(filter = {}) {
    let wounds = this.items.filter(i => i.type === "wound");
    if (filter.active !== undefined)     wounds = wounds.filter(w => w.system.isActive === filter.active);
    if (filter.healing !== undefined)    wounds = wounds.filter(w => w.system.isHealing === filter.healing);
    if (filter.location !== undefined)   wounds = wounds.filter(w => w.system.location === filter.location);
    if (filter.damageType !== undefined) wounds = wounds.filter(w => w.system.damageType === filter.damageType);
    if (filter.bruise !== undefined) {
      const NEUROSHIMA = game.neuroshima?.NEUROSHIMA ?? {};
      wounds = wounds.filter(w => !!(NEUROSHIMA.woundConfiguration?.[w.system.damageType]?.isBruise) === filter.bruise);
    }
    return wounds;
  }

  /**
   * Return all active wounds sorted from heaviest to lightest.
   * Uses the interleaved DAMAGE_ORDER for cross-track comparison.
   * @returns {Item[]}
   */
  getActiveWounds() {
    const { NeuroshimaItem } = game.neuroshima ?? {};
    const ORDER = NeuroshimaItem?.DAMAGE_ORDER ?? ["D", "sD", "L", "sL", "C", "sC", "K", "sK"];
    return this.getWounds({ active: true })
      .sort((a, b) => ORDER.indexOf(b.system.damageType) - ORDER.indexOf(a.system.damageType));
  }

  /**
   * Return all active wounds at the highest damage level (across both tracks).
   * Uses the interleaved DAMAGE_ORDER so sK > K > sC > C > sL > L > sD > D.
   * @returns {Item[]}
   */
  getWorstWounds() {
    const { NeuroshimaItem } = game.neuroshima ?? {};
    const ORDER = NeuroshimaItem?.DAMAGE_ORDER ?? ["D", "sD", "L", "sL", "C", "sC", "K", "sK"];
    const active = this.getWounds({ active: true });
    if (!active.length) return [];
    const maxIdx = Math.max(...active.map(w => ORDER.indexOf(w.system.damageType)));
    return active.filter(w => ORDER.indexOf(w.system.damageType) === maxIdx);
  }

  /**
   * Return all active regular (non-bruise) wounds at the highest level on their track.
   * Track: D → L → C → K.
   * @returns {Item[]}
   */
  getWorstRegularWounds() {
    const TRACK = ["D", "L", "C", "K"];
    const active = this.getWounds({ active: true }).filter(w => !w.system.damageType?.startsWith("s"));
    if (!active.length) return [];
    const maxIdx = Math.max(...active.map(w => TRACK.indexOf(w.system.damageType)));
    return active.filter(w => TRACK.indexOf(w.system.damageType) === maxIdx);
  }

  /**
   * Return all active bruise (s-prefix) wounds at the highest level on their track.
   * Track: sD → sL → sC → sK.
   * @returns {Item[]}
   */
  getWorstBruiseWounds() {
    const TRACK = ["sD", "sL", "sC", "sK"];
    const active = this.getWounds({ active: true }).filter(w => w.system.damageType?.startsWith("s"));
    if (!active.length) return [];
    const maxIdx = Math.max(...active.map(w => TRACK.indexOf(w.system.damageType)));
    return active.filter(w => TRACK.indexOf(w.system.damageType) === maxIdx);
  }

  /**
   * Fully heal (delete) all wound items on this actor.
   * Optionally filtered — pass the same filter object as getWounds().
   * @param {Object} [filter={}]
   * @returns {Promise<void>}
   */
  async healAllWounds(filter = {}) {
    const wounds = this.getWounds(filter);
    const ids = wounds.map(w => w.id);
    if (ids.length) await this.deleteEmbeddedDocuments("Item", ids);
  }

  /**
   * Fully heal (delete) all wounds at the highest damage level currently present.
   * @returns {Promise<void>}
   */
  async healWorstWounds() {
    const worst = this.getWorstWounds();
    const ids = worst.map(w => w.id);
    if (ids.length) await this.deleteEmbeddedDocuments("Item", ids);
  }

  /**
   * Return all items of a given type owned by this actor.
   * @param {string} type - Item type key (e.g. "trick", "armor", "weapon", "gear").
   * @returns {Item[]}
   */
  getItems(type) {
    return this.items.filter(i => i.type === type);
  }

  /**
   * Check whether this actor owns at least one item of a given type with a matching name.
   * The check is case-insensitive.
   * @param {string} type - Item type key.
   * @param {string} name - Item name to search for.
   * @returns {boolean}
   */
  hasItem(type, name) {
    const lower = name.toLowerCase();
    return this.items.some(i => i.type === type && i.name.toLowerCase() === lower);
  }

  /**
   * Check whether the actor owns a trick with the given name (case-insensitive).
   * Shorthand for `hasItem("trick", name)`.
   * @param {string} name
   * @returns {boolean}
   */
  hasTrick(name) {
    return this.hasItem("trick", name);
  }

  /**
   * Modify this actor's HP by `delta` (positive = heal, negative = damage).
   * Result is clamped to [0, hp.max].
   * Only applies to actor types that have `system.hp` (character, npc, creature).
   * @param {number} delta
   * @returns {Promise<void>}
   */
  async modifyHp(delta) {
    const hp = this.system.hp;
    if (!hp) return;
    const next = Math.max(0, Math.min(hp.max, (hp.value ?? 0) + delta));
    await this.update({ "system.hp.value": next });
  }

  /**
   * Return the total armor SP at a given location, including equipped armor, natural armor,
   * and any Active Effect armorBonus contributions.
   *
   * Delegates to `game.neuroshima.CombatHelper.getArmorRating(actor, location)`.
   *
   * @param {string} location - Body or vehicle location key (e.g. "head", "front").
   * @returns {{ totalSP: number, details: Array<{name,ratings,damage,effective}>, weakPoint: boolean }}
   */
  getArmorAt(location) {
    return game.neuroshima.CombatHelper.getArmorRating(this, location);
  }

  /**
   * Return the sum of all active wound penalties on this actor.
   * @returns {number}
   */
  getTotalWoundPenalty() {
    return this.getWounds({ active: true }).reduce((sum, w) => sum + (w.system.penalty ?? 0), 0);
  }

  /**
   * Return the actor's skill value by key.
   * Returns 0 if the skill doesn't exist (e.g. on a vehicle).
   * @param {string} key - Skill key (e.g. "painResistance", "pistols").
   * @returns {number}
   */
  getSkill(key) {
    return this.system.skills?.[key]?.value ?? 0;
  }

  /**
   * Return the actor's attribute value (base only, without modifier).
   * @param {string} key - Attribute key (e.g. "dexterity", "constitution", "agility").
   * @returns {number}
   */
  getAttribute(key) {
    return this.system.attributes?.[key] ?? 0;
  }

  /**
   * Return the actor's attribute total (base + modifier), as computed in prepareDerivedData.
   * Falls back to `getAttribute(key)` if attributeTotals is not yet populated.
   * @param {string} key
   * @returns {number}
   */
  getAttributeTotal(key) {
    return this.system.attributeTotals?.[key] ?? this.getAttribute(key);
  }

  // ── Effect helpers ─────────────────────────────────────────────────────────

  /**
   * Return all active (non-disabled) effects directly on this actor.
   * Does not include effects transferred from items.
   * @returns {ActiveEffect[]}
   */
  getActiveEffects() {
    return this.effects.filter(e => !e.disabled);
  }

  /**
   * Find an active effect on this actor by name (case-insensitive) or by ID.
   * Searches effects directly on the actor.
   * @param {string} nameOrId
   * @returns {ActiveEffect|undefined}
   */
  findEffect(nameOrId) {
    const lower = nameOrId.toLowerCase();
    return this.effects.find(e => e.id === nameOrId || e.name.toLowerCase() === lower);
  }

  /**
   * Return true if this actor has an effect with the given name (case-insensitive) or ID
   * that is currently active (not disabled).
   * @param {string} nameOrId
   * @returns {boolean}
   */
  hasEffect(nameOrId) {
    const lower = nameOrId.toLowerCase();
    return this.effects.some(
      e => !e.disabled && (e.id === nameOrId || e.name.toLowerCase() === lower)
    );
  }

  /**
   * Delete the first effect on this actor matching the given name or ID.
   * @param {string} nameOrId
   * @returns {Promise<ActiveEffect|null>}
   */
  async removeEffectByName(nameOrId) {
    const effect = this.findEffect(nameOrId);
    if (!effect) return null;
    return effect.delete();
  }

  /**
   * Toggle an effect's disabled state.
   * Pass `active = true` to enable (un-disable), `false` to disable, or omit to flip.
   * @param {string} nameOrId
   * @param {boolean} [active]
   * @returns {Promise<ActiveEffect|null>}
   */
  async toggleEffect(nameOrId, active) {
    const effect = this.findEffect(nameOrId);
    if (!effect) return null;
    const newDisabled = active === undefined ? !effect.disabled : !active;
    return effect.update({ disabled: newDisabled });
  }

  /**
   * Apply effects to this actor.
   * Accepts both UUIDs (effectUuids) and raw effect creation data (effectData).
   * Overrides the native Actor#applyEffect to ensure effectData is supported.
   *
   * @param {Object} options
   * @param {string[]} [options.effectUuids] - UUIDs of effects to apply.
   * @param {Object[]} [options.effectData]  - Raw effect creation data objects.
   * @returns {Promise<void>}
   */
  async applyEffect({ effectUuids = [], effectData = [] } = {}) {
    if (effectData.length) {
      await this.createEmbeddedDocuments("ActiveEffect", effectData);
    }
    if (effectUuids.length) {
      await super.applyEffect({ effectUuids });
    }
  }

  /**
   * Apply an effect (or array of effects) to this actor by UUID.
   * @param {string|string[]} uuids - One or more effect UUIDs.
   * @returns {Promise<void>}
   */
  async applyEffectByUuid(uuids) {
    const effectUuids = Array.isArray(uuids) ? uuids : [uuids];
    return this.applyEffect({ effectUuids });
  }
}
