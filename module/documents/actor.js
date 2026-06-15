import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

import { getConditions } from "../apps/config/condition-config.js";

/**
 * Build ActiveEffect create-data from a condition definition.
 * Centralises all template fields so every code path copies the same data.
 * @param {object} condDef
 * @param {object} [extraFlags]  – additional flags.neuroshima fields (e.g. conditionNumbered)
 * @returns {object}
 */
function _condDefToEffectData(condDef, extraFlags = {}) {
  return {
    name:        condDef.name,
    img:         condDef.img          ?? "icons/svg/aura.svg",
    tint:        condDef._tint        ?? null,
    description: condDef._description ?? "",
    disabled:    condDef._disabled    ?? false,
    statuses:    [condDef.key],
    changes:     foundry.utils.deepClone(condDef.changes   ?? []),
    duration:    foundry.utils.deepClone(condDef._duration ?? {}),
    system: {
      scriptData: foundry.utils.deepClone(condDef.scripts ?? []),
    },
    flags: {
      neuroshima: {
        transferType: condDef._transferType  ?? "owningDocument",
        documentType: condDef._documentType  ?? "actor",
        equipTransfer:condDef._equipTransfer ?? false,
        ...extraFlags
      }
    }
  };
}

/**
 * Execution context for condition auto-check scripts.
 * Bound as `this` when running a condition's conditionCheckCode inside _checkAutoConditions.
 */
class NeuroshimaConditionCheckContext {
  constructor(actor, condDef) {
    this._actor   = actor;
    this._condDef = condDef;
  }

  // ── Actor identity ────────────────────────────────────────────────────────
  get actor()             { return this._actor; }
  get conditionKey()      { return this._condDef.key; }
  get isNPC()             { return this._actor.type === "npc"; }
  get isCreature()        { return this._actor.type === "creature"; }
  get isPC()              { return this._actor.type === "character"; }

  // ── Derived stats ─────────────────────────────────────────────────────────
  get totalDamagePoints() { return this._actor.system.combat?.totalDamagePoints ?? 0; }
  get totalWoundPenalty() { return this._actor.system.combat?.totalWoundPenalty ?? 0; }
  get encumbrance()       { return this._actor.system.encumbrance; }
  get hp()                { return this._actor.system.hp ?? null; }

  get maxHP() {
    if (this._actor.type === "creature") {
      return this._actor.getFlag("neuroshima", "creatureMaxHP") || this._actor.system.combat?.maxHP || 27;
    }
    return this._actor.system.hp?.max ?? 27;
  }

  // ── Wound helpers ─────────────────────────────────────────────────────────
  getWounds(filter = {})     { return this._actor.getWounds(filter); }
  getActiveWounds()          { return this._actor.getActiveWounds(); }
  getWorstWounds()           { return this._actor.getWorstWounds(); }
  getWorstRegularWounds()    { return this._actor.getWorstRegularWounds(); }
  getWorstBruiseWounds()     { return this._actor.getWorstBruiseWounds(); }

  async applyWound(damageType, location = "torso") {
    const { NeuroshimaDice } = game.neuroshima ?? {};
    const result = await NeuroshimaDice?.applyDamage(this._actor, { damageType, location, source: this._condDef.name ?? "" });
    return result?.wounds?.[0];
  }

  // ── Condition helpers ─────────────────────────────────────────────────────
  hasCondition(key)              { return this._actor.hasCondition(key); }
  getConditionValue(key)         { return this._actor.getConditionValue(key); }
  async addCondition(key, value) { return this._actor.addCondition(key, value); }
  async removeCondition(key)     { return this._actor.removeCondition(key); }

  async setConditionValue(key, value) {
    const existing = this._actor.effects.find(
      e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
    );
    if (value <= 0) {
      if (existing) await existing.delete();
      return;
    }
    if (existing) {
      await existing.setFlag("neuroshima", "conditionValue", value);
      this._actor._refreshTokenHUD?.();
    } else {
      await this._actor.addCondition(key);
      const created = this._actor.effects.find(
        e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
      );
      if (created && value !== 1) {
        await created.setFlag("neuroshima", "conditionValue", value);
        this._actor._refreshTokenHUD?.();
      }
    }
  }

  async apply() {
    if (!this._actor.hasCondition(this._condDef.key)) {
      return this._actor.addCondition(this._condDef.key);
    }
  }

  async remove() {
    if (this._actor.hasCondition(this._condDef.key)) {
      return this._actor.removeCondition(this._condDef.key);
    }
  }

  // ── Actor stat helpers ────────────────────────────────────────────────────
  getAttribute(key)      { return this._actor.getAttribute(key); }
  getAttributeTotal(key) { return this._actor.getAttributeTotal(key); }
  getSkill(key)          { return this._actor.getSkill(key); }
  hasItem(type, name)    { return this._actor.hasItem(type, name); }
  hasTrick(name)         { return this._actor.hasTrick(name); }
  hasEffect(nameOrId)    { return this._actor.hasEffect(nameOrId); }

  // ── Output helpers ────────────────────────────────────────────────────────
  async sendMessage(content, chatData = {}) {
    return ChatMessage.create(foundry.utils.mergeObject({
      content,
      speaker: ChatMessage.getSpeaker({ actor: this._actor })
    }, chatData));
  }

  notification(msg, type = "info") {
    ui.notifications?.[type]?.(msg);
  }

  // ── Dice helper ───────────────────────────────────────────────────────────
  async roll(formula, data = {}) {
    return new Roll(formula, data).evaluate();
  }
}

/**
 * Extended Actor document for Neuroshima 1.5.
 *
 * Provides the following on top of the Foundry base:
 * - Default token sight and type-specific icons at creation time.
 * - System-level initiative roll dialog that writes directly to the combatant document.
 * - Script-facing helpers (wound queries, condition add/remove/check, effect helpers,
 *   HP and armor access) intended for use from effect scripts and macro code.
 * - Automatic condition application via `_checkAutoConditions` (runs after every actor update
 *   on the GM client).
 * - `syncEquipTransferEffects` — creates / removes actor copies of item effects when items
 *   are equipped or un-equipped (equip-transfer pattern).
 * - `applyEffect` / `applyEffectByUuid` — unified API for applying effects by UUID or raw data.
 */
export class NeuroshimaActor extends Actor {
  /**
   * Apply default token settings and system-specific icons before the actor is created.
   *
   * Sets `prototypeToken.sight.enabled = true` for all actor types and
   * `actorLink = true` for player characters.  Assigns a type-specific default icon
   * when none is set (vehicles, creatures, home bases).
   *
   * @override
   */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    const updates = { "prototypeToken.sight.enabled": true };
    if (data.type === "character") {
      updates["prototypeToken.actorLink"] = true;
    }
    const actorIcons = {
      vehicle:   "systems/neuroshima/assets/img/carkey.svg",
      creature:  "systems/neuroshima/assets/img/animal-skull.svg",
      homeBase:  "systems/neuroshima/assets/img/house.svg"
    };
    if (actorIcons[data.type] && (!data.img || data.img === "icons/svg/mystery-man.svg")) {
      updates.img = actorIcons[data.type];
    }
    this.updateSource(updates);
  }

  /**
   * Finalize derived data after Active Effects have been applied.
   *
   * Calls `system._preparePostEffects()` (defined per actor type on the data model) and
   * then fires the synchronous `prepareData` script trigger so that effect scripts
   * can patch derived values after the normal data preparation pipeline.
   *
   * @override
   */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.system._preparePostEffects?.();
    NeuroshimaScriptRunner.executeSync("prepareData", { actor: this });
  }

  /**
   * Unified initiative roll for Neuroshima 1.5.
   * @param {Object} rollOptions - Initial options for the dialog.
   * @returns {Promise<Object>} The roll result.
   */
  async rollInitiativeDialog(rollOptions = {}) {
    const { NeuroshimaInitiativeRollDialog } = await import("../apps/dialogs/initiative-roll-dialog.js");
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

  /**
   * Roll initiative for this actor, writing the result to the combat tracker combatant.
   *
   * Resolves the current combatant from options, the linked token, or the active combat,
   * then delegates to `rollInitiativeDialog` which opens the system-specific dialog.
   * The dialog's `successPoints` value is used as the numeric initiative score.
   *
   * @override
   * @param {object}     [options={}]
   * @param {Combatant}  [options.combatant]  - Explicit combatant to update; auto-resolved if omitted.
   * @returns {Promise<number|null>}  The written initiative value, or null if the dialog was cancelled.
   */
  async rollInitiative(options = {}) {
    const combatant = options.combatant || this.token?.combatant || game.combat?.getCombatantByActor(this.id);

    const result = await this.rollInitiativeDialog({
        combatant: combatant,
        ...options
    });

    if (!result) return null;

    const initiativeValue = Number(result.successPoints);

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
      const NEUROSHIMA = game.neuroshima?.config ?? {};
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
   * Re-render the token HUD if it is currently open for any token linked to this actor.
   * Called after flag-only updates that don't trigger Foundry's normal HUD refresh.
   */
  _refreshTokenHUD() {
    const hud = canvas.hud?.token;
    if (!hud?.rendered) return;
    const linkedToken = this.getActiveTokens(true, true)[0];
    if (!linkedToken) return;
    if (hud.object?.document === linkedToken || hud.object?.id === linkedToken?.id) {
      hud.render();
    }
  }

  // ── Condition helpers (WFRP-style) ────────────────────────────────────────

  /**
   * Synchronise equipTransfer effects for a single item after its equipped state changes.
   * - equipped === true  → create actor copies of item effects with flags.neuroshima.equipTransfer = true
   * - equipped === false → delete those copies (identified by origin + fromEquipTransfer flag)
   * @param {Item}    item
   * @param {boolean} equipped
   * @returns {Promise<void>}
   */
  async syncEquipTransferEffects(item, equipped) {
    const equipEffects = item.effects.filter(e => e.getFlag("neuroshima", "equipTransfer") === true);
    if (!equipEffects.length) return;

    if (equipped) {
      const alreadyExists = this.effects.some(
        e => e.origin === item.uuid && e.getFlag("neuroshima", "fromEquipTransfer") === true
      );
      if (alreadyExists) return;
      const toCreate = equipEffects.map(e => {
        const data = e.toObject();
        data.transfer = false;
        data.origin   = item.uuid;
        foundry.utils.setProperty(data, "flags.neuroshima.fromEquipTransfer", true);
        foundry.utils.setProperty(data, "flags.neuroshima.sourceEffectId", e.id);
        return data;
      });
      await this.createEmbeddedDocuments("ActiveEffect", toCreate);
    } else {
      const toDelete = this.effects
        .filter(e => e.origin === item.uuid && e.getFlag("neuroshima", "fromEquipTransfer") === true)
        .map(e => e.id);
      if (toDelete.length) await this.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    }
  }

  /**
   * Return the current numeric value of an int-type condition on this actor.
   * Returns 0 if the condition is not active.
   * @param {string} key
   * @returns {number}
   */
  getConditionValue(key) {
    const effect = this.effects.find(
      e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
    );
    return effect?.getFlag("neuroshima", "conditionValue") ?? 0;
  }

  /**
   * Return true if the actor has the given condition active (boolean present OR int > 0).
   * @param {string} key
   * @returns {boolean}
   */
  hasCondition(key) {
    if (this.statuses.has(key)) return true;
    return this.getConditionValue(key) !== 0;
  }

  /**
   * Add (or increment) a condition on this actor.
   * - Boolean conditions: enable via toggleStatusEffect.
   * - Int conditions: increment the stored value by `value`, creating the effect if needed.
   * @param {string} key
   * @param {number} [value=1]  Amount to increment numeric conditions by.
   * @returns {Promise<void>}
   */
  async addCondition(key, value = 1) {
    const condDef = getConditions().find(c => c.key === key);
    game.neuroshima?.log(`[addCondition] key="${key}" condDef:`, condDef ? { type: condDef.type, scriptsCount: condDef.scripts?.length ?? 0, scripts: condDef.scripts } : "NOT FOUND");
    if (!condDef) return;

    if (condDef.type !== "int") {
      return this.toggleStatusEffect(key, { active: true });
    }

    const existing = this.effects.find(
      e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
    );
    if (existing) {
      const current = existing.getFlag("neuroshima", "conditionValue") ?? 0;
      await existing.setFlag("neuroshima", "conditionValue", current + value);
      this._refreshTokenHUD();
      return;
    }

    return this.createEmbeddedDocuments("ActiveEffect", [
      _condDefToEffectData(condDef, { conditionNumbered: true, conditionValue: value })
    ]);
  }

  /**
   * Remove (or decrement) a condition on this actor.
   * - Boolean conditions: disable via toggleStatusEffect.
   * - Int conditions: decrement; deletes the effect when value reaches 0 (unless allowNegative).
   * @param {string} key
   * @returns {Promise<void>}
   */
  async removeCondition(key) {
    const condDef = getConditions().find(c => c.key === key);
    if (!condDef) return;

    if (condDef.type !== "int") {
      return this.toggleStatusEffect(key, { active: false });
    }

    const existing = this.effects.find(
      e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
    );
    if (!existing) return;

    const current = existing.getFlag("neuroshima", "conditionValue") ?? 0;
    const min = condDef.allowNegative ? -Infinity : 0;
    const next = Math.max(min, current - 1);

    if (next === 0 && !condDef.allowNegative) {
      return existing.delete();
    }
    await existing.setFlag("neuroshima", "conditionValue", next);
    this._refreshTokenHUD();
  }

  /**
   * Override toggleStatusEffect so that int-type conditions route to addCondition/removeCondition.
   * Foundry calls toggleStatusEffect(key, { overlay: true }) on RMB in the token HUD — we use
   * that to distinguish increment (LMB) from decrement (RMB), matching WFRP4e's approach.
   * @override
   */
  async toggleStatusEffect(effectId, { active, overlay = false } = {}) {
    const condDef = getConditions().find(c => c.key === effectId);
    if (condDef?.key?.startsWith("maneuver-") && active === undefined) return;
    if (condDef?.type === "int") {
      if (overlay) return this.removeCondition(effectId);
      return this.addCondition(effectId);
    }

    // For boolean conditions: handle manually so system.scriptData is populated
    // (Foundry's super.toggleStatusEffect may not copy flags from CONFIG.statusEffects).
    if (condDef) {
      game.neuroshima?.log(`[toggleStatusEffect boolean] key="${effectId}" scriptsCount:`, condDef.scripts?.length ?? 0, condDef.scripts);
      const existing = this.effects.find(e => e.statuses?.has(effectId));
      if (existing) {
        if (active === true) return;
        return existing.delete();
      }
      if (active === false) return;
      return this.createEmbeddedDocuments("ActiveEffect", [
        _condDefToEffectData(condDef)
      ]);
    }

    return super.toggleStatusEffect(effectId, { active, overlay });
  }

  /**
   * Pre-update hook — reserved for future validation or sanitisation logic.
   * Returns `false` if the parent hook aborts the update.
   * @override
   */
  async _preUpdate(changed, options, user) {
    const result = await super._preUpdate(changed, options, user);
    if (result === false) return false;
  }

  /**
   * Trigger automatic condition evaluation after every actor update.
   * `_checkAutoConditions` is only called on the GM client to avoid redundant
   * concurrent executions across multiple connected players.
   * @override
   */
  async _onUpdate(changed, options, userId) {
    await super._onUpdate(changed, options, userId);
    if (userId === game.userId && game.user.isGM) {
      await this._checkAutoConditions();
    }
  }

  /**
   * Check and auto-apply conditions based on derived actor state.
   * Each condition's conditionCheckCode is executed with a NeuroshimaConditionCheckContext
   * as `this`, giving scripts access to actor shortcuts and apply/remove helpers.
   * Called from _onUpdate (actor changes) and item hooks (item changes).
   * @returns {Promise<void>}
   */
  async _checkAutoConditions() {
    if (this._checkingAutoConditions) return;
    this._checkingAutoConditions = true;
    try {
      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
      const conditions = getConditions();
      for (const condDef of conditions) {
        const code = condDef.conditionCheckCode?.trim();
        if (!code) continue;
        try {
          const ctx = new NeuroshimaConditionCheckContext(this, condDef);
          await new AsyncFunction(code).call(ctx);
        } catch (err) {
          console.error(`[Neuroshima] conditionCheckCode error for "${condDef.key}":`, err);
        }
      }
    } finally {
      this._checkingAutoConditions = false;
    }
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
