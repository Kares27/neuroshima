import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";
import {
  AttributeTest,
  SkillTest,
  RangedWeaponTest,
  MeleeWeaponTest
} from "../tests.mjs";

import {
  getConditions,
  isDefeatedByDamage,
  isOverweightEncumbrance
} from "../apps/config/condition-config.js";
import {
  createReputationCostApi,
  getBaseReputationCost,
  normalizeReputationCost
} from "../helpers/xp.js";

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
        manualChangeKeys: condDef._manualChangeKeys ?? false,
        ...extraFlags
      }
    }
  };
}

/**
 * Execution context for condition auto-check scripts.
 * Bound as `this` when running a condition's conditionCheckCode inside _checkAutoConditions.
 */
export class NeuroshimaConditionCheckContext {
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
  get isOverweight()      { return isOverweightEncumbrance(this.encumbrance); }
  get usesAutomaticDefeat() { return ["npc", "creature"].includes(this._actor.type); }
  get isDefeated() {
    return isDefeatedByDamage({
      actorType: this._actor.type,
      totalDamagePoints: this.totalDamagePoints,
      maxHP: this.maxHP
    });
  }
  get hp()                { return this._actor.system.hp ?? null; }

  get maxHP() {
    if (this._actor.type === "creature") {
      const flagged = this._actor.getFlag("neuroshima", "creatureMaxHP");
      if (flagged !== undefined && flagged !== null && flagged !== "") return Number(flagged);
      const prepared = this._actor.system.combat?.maxHP;
      if (prepared !== undefined && prepared !== null && prepared !== "") return Number(prepared);
      return 27;
    }
    return Number(this._actor.system.hp?.max ?? 27);
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
  async addCondition(key, value) {
    return this._actor.addCondition(key, value, { automatic: true });
  }

  async removeCondition(key) {
    return this._actor.removeCondition(key, { automaticOnly: true });
  }

  async setConditionValue(key, value) {
    return this._actor.setConditionValue(key, value, { automatic: true });
  }

  async apply() {
    if (!this._actor.hasCondition(this._condDef.key)) {
      return this._actor.addCondition(this._condDef.key, 1, { automatic: true });
    }
  }

  async remove() {
    return this._actor.removeCondition(this._condDef.key, { automaticOnly: true });
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
  _setupTest(TestClass, data = {}) {
    return new TestClass(data, this);
  }

  setupAttributeTest(data = {}) {
    return this._setupTest(AttributeTest, data);
  }

  setupSkillTest(data = {}) {
    return this._setupTest(SkillTest, data);
  }

  setupWeaponTest(item, data = {}) {
    const isMelee = item?.system?.weaponType === "melee";
    const TestClass = isMelee ? MeleeWeaponTest : RangedWeaponTest;
    return this._setupTest(TestClass, { ...data, item });
  }

  /**
   * Synchronous opening phase of actor data preparation. Preparation scripts
   * may only mutate the in-memory model passed in args; document updates are
   * deliberately unsupported in this lifecycle.
   */
  prepareBaseData() {
    // prePrepareData runs before the data model restores prepared defaults.
    // Collect the reputation price in a short-lived holder and copy it back
    // after super.prepareBaseData(), otherwise the default 25 would overwrite
    // a script calling args.reputation.setCost().
    const preparationOverrides = { reputationCost: getBaseReputationCost() };
    const supportsReputation = ["character", "npc", "creature"].includes(this.type);
    NeuroshimaScriptRunner.executeEventSync("prePrepareData", {
      actor: this,
      preparedData: this.system,
      reputation: supportsReputation
        ? createReputationCostApi(preparationOverrides)
        : undefined
    });
    super.prepareBaseData();
    if (supportsReputation) {
      this.system.reputationCost = normalizeReputationCost(preparationOverrides.reputationCost);
    }
  }

  /**
   * Apply default token settings and system-specific icons before the actor is created.
   *
   * Sets `prototypeToken.sight.enabled = true` for all actor types and
   * for player characters additionally:
   *   - `actorLink = true`        — token is linked to the actor document
   *   - `disposition = FRIENDLY`  — token disposition defaults to FRIENDLY so that
   *                                   aura filterScripts using `isFriendlyToken()` work
   *                                   correctly for newly created PCs without manual setup.
   *
   * Assigns a type-specific default icon when none is set (vehicles, creatures, home bases).
   *
   * @override
   */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    const updates = { "prototypeToken.sight.enabled": true };
    if (data.type === "character") {
      updates["prototypeToken.actorLink"] = true;
      // FRIENDLY disposition ensures that isFriendlyToken() filter helpers in aura
      // filterScripts return true for player characters out of the box.
      updates["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
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
    const supportsReputation = ["character", "npc", "creature"].includes(this.type);
    NeuroshimaScriptRunner.executeEventSync("prePrepareItems", {
      actor: this,
      items: this.items,
      preparedData: this.system,
      reputation: supportsReputation
        ? createReputationCostApi(this.system)
        : undefined
    });
    super.prepareDerivedData();
    this.system._preparePostEffects?.();
    const args = {
      actor: this,
      preparedData: this.system,
      reputation: supportsReputation
        ? createReputationCostApi(this.system)
        : undefined,
      characteristics: this.system.attributeTotals ?? this.system.attributes,
      encumbrance: this.system.encumbrance,
      wounds: this.system.combat,
      size: this.system.size,
      armor: this.system.armor ?? this.system.combat?.armor
    };
    // Home bases and vehicles use independent data models without the shared
    // character calculation pipeline. They still expose every public
    // preparation boundary in the documented order.
    if (["homeBase", "vehicle"].includes(this.type)) {
      for (const trigger of [
        "computeCharacteristics",
        "computeEncumbrance",
        "preWoundCalc",
        "woundCalc"
      ]) {
        NeuroshimaScriptRunner.executeEventSync(trigger, args);
      }
      NeuroshimaScriptRunner.executeEventSync("calculateSize", args);
      NeuroshimaScriptRunner.executeEventSync("preAPCalc", args);
      NeuroshimaScriptRunner.executeEventSync("APCalc", args);
    }
    NeuroshimaScriptRunner.executeEventSync("prepareData", args);
    // Scripts and ordinary Active Effect changes may both touch the prepared
    // field. Normalize once at the end so the purchase UI always receives a
    // finite, non-negative integer cost.
    if (supportsReputation) {
      this.system.reputationCost = normalizeReputationCost(this.system.reputationCost);
    }
  }

  /**
   * Unified initiative roll for Neuroshima 1.5.
   * @param {Object} rollOptions - Initial options for the dialog.
   * @returns {Promise<Object>} The roll result.
   */
  async rollInitiativeDialog(rollOptions = {}) {
    const { NeuroshimaInitiativeRollDialog } = await import("../apps/dialogs/initiative-roll-dialog.js");

    return new Promise((resolve) => {
      let resolved = false;
      const dialog = new NeuroshimaInitiativeRollDialog({
        actor: this,
        ...rollOptions,
        onRoll: async (result) => {
          resolved = true;
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
    const desired = equipped
      ? item.effects.filter(effect =>
        effect.getFlag("neuroshima", "equipTransfer") === true
        && effect.disabled !== true
      )
      : [];
    const existing = this.effects.filter(effect =>
      effect.origin === item.uuid
      && effect.getFlag("neuroshima", "fromEquipTransfer") === true
    );
    const desiredById = new Map(desired.map(effect => [effect.id, effect]));
    const existingBySource = new Map();
    const duplicateIds = [];
    for (const effect of existing) {
      const sourceId = effect.getFlag("neuroshima", "sourceEffectId");
      if (sourceId && !existingBySource.has(sourceId)) {
        existingBySource.set(sourceId, effect);
      } else {
        duplicateIds.push(effect.id);
      }
    }

    const staleIds = [
      ...duplicateIds,
      ...existing
        .filter(effect => !desiredById.has(effect.getFlag("neuroshima", "sourceEffectId")))
        .map(effect => effect.id)
    ].filter((id, index, ids) => ids.indexOf(id) === index);
    if (staleIds.length) await this.deleteEmbeddedDocuments("ActiveEffect", staleIds);

    const toCreate = [];
    for (const source of desired) {
      const data = source.toObject();
      delete data._id;
      data.transfer = false;
      data.origin = item.uuid;
      foundry.utils.setProperty(data, "flags.neuroshima.fromEquipTransfer", true);
      foundry.utils.setProperty(data, "flags.neuroshima.sourceEffectId", source.id);
      const mirror = existingBySource.get(source.id);
      if (mirror && !staleIds.includes(mirror.id)) {
        await mirror.update(data, { neuroshimaEquipTransferSync: true });
      } else {
        toCreate.push(data);
      }
    }
    if (toCreate.length) await this.createEmbeddedDocuments("ActiveEffect", toCreate);
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
   * Set an int condition to an exact value through the same creation path used
   * by addCondition(), ensuring Changes and system.scriptData are preserved.
   */
  async setConditionValue(key, value, { automatic = false } = {}) {
    const condDef = getConditions().find(c => c.key === key);
    if (!condDef || condDef.type !== "int") return;

    let next = Number(value);
    if (!Number.isFinite(next)) return;
    if (!condDef.allowNegative) next = Math.max(0, next);

    const existing = this.effects.find(
      e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
    );
    if (next === 0) {
      if (existing && (!automatic || existing.getFlag("neuroshima", "autoCondition") === true)) {
        await existing.delete();
      }
      return;
    }
    if (existing) {
      if (automatic && existing.getFlag("neuroshima", "autoCondition") !== true) {
        return existing;
      }
      if (!automatic && existing.getFlag("neuroshima", "autoCondition") === true) {
        await existing.unsetFlag("neuroshima", "autoCondition");
      }
      await existing.setFlag("neuroshima", "conditionValue", next);
      this._refreshTokenHUD();
      return existing;
    }
    return this.addCondition(key, next, { automatic });
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
   * @param {object} [options]
   * @param {boolean} [options.automatic=false] Mark an effect created by an
   * automatic condition check. Only such effects may later be auto-removed.
   * @returns {Promise<void>}
   */
  async addCondition(key, value = 1, { automatic = false } = {}) {
    let condDef = getConditions().find(c => c.key === key);
    game.neuroshima?.log(`[addCondition] key="${key}" condDef:`, condDef ? { type: condDef.type, scriptsCount: condDef.scripts?.length ?? 0, scripts: condDef.scripts } : "NOT FOUND");
    if (!condDef) return;

    // preApplyCondition — allow scripts to cancel condition application (e.g. immunity)
    const preArgs = { actor: this, conditionKey: key, condition: condDef, condDef, value, cancel: false };
    await NeuroshimaScriptRunner.executeEvent("preApplyCondition", preArgs, {
      metadata: { condition: condDef }
    });
    if (preArgs.cancel) {
      game.neuroshima?.log(`[addCondition] preApplyCondition cancelled condition "${key}"`);
      return;
    }
    const originalKey = key;
    key = preArgs.conditionKey ?? key;
    value = Number(preArgs.value ?? value);
    condDef = (key !== originalKey ? getConditions().find(condition => condition.key === key) : null)
      ?? preArgs.condition
      ?? getConditions().find(condition => condition.key === key)
      ?? condDef;

    let result;
    if (condDef.type !== "int") {
      result = await this.toggleStatusEffect(key, { active: true, automatic });
    } else {
      if (!Number.isFinite(value)) return;
      const existing = this.effects.find(
        e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
      );
      if (existing) {
        if (automatic && existing.getFlag("neuroshima", "autoCondition") !== true) {
          result = existing;
        } else {
          if (!automatic && existing.getFlag("neuroshima", "autoCondition") === true) {
            await existing.unsetFlag("neuroshima", "autoCondition");
          }
          const current = Number(existing.getFlag("neuroshima", "conditionValue") ?? 0);
          const next = condDef.allowNegative
            ? current + value
            : Math.max(0, current + value);
          if (next === 0) {
            result = await existing.delete();
          } else {
            await existing.setFlag("neuroshima", "conditionValue", next);
            this._refreshTokenHUD();
            result = existing;
          }
        }
      } else {
        const initial = condDef.allowNegative ? value : Math.max(0, value);
        if (initial === 0) return;
        result = await this.createEmbeddedDocuments("ActiveEffect", [
          _condDefToEffectData(condDef, {
            conditionNumbered: true,
            conditionValue: initial,
            ...(automatic ? { autoCondition: true } : {})
          })
        ]);
        this._refreshTokenHUD();
      }
    }

    // applyCondition — react after condition has been applied
    await NeuroshimaScriptRunner.executeEvent("applyCondition", {
      actor: this,
      conditionKey: key,
      condition: condDef,
      condDef,
      value,
      result
    }, { metadata: { condition: condDef } });
    game.neuroshima?.log(`[addCondition] applyCondition fired for "${key}"`);

    return result;
  }

  /**
   * Remove (or decrement) a condition on this actor.
   * - Boolean conditions: disable via toggleStatusEffect.
   * - Int conditions: decrement; deletes the effect when value reaches 0 (unless allowNegative).
   * @param {string} key
   * @param {object} [options]
   * @param {boolean} [options.automaticOnly=false] Remove only an effect
   * previously created by an automatic condition check.
   * @returns {Promise<void>}
   */
  async removeCondition(key, { automaticOnly = false } = {}) {
    const condDef = getConditions().find(c => c.key === key);
    if (!condDef) return;

    if (condDef.type !== "int") {
      return this.toggleStatusEffect(key, { active: false, automaticOnly });
    }

    const existing = this.effects.find(
      e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
    );
    if (!existing) return;
    if (automaticOnly && existing.getFlag("neuroshima", "autoCondition") !== true) return;

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
  async toggleStatusEffect(effectId, {
    active,
    overlay = false,
    automatic = false,
    automaticOnly = false
  } = {}) {
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
      const existing = this.effects.filter(e => e.statuses?.has(effectId));
      const enabled = existing.find(e => !e.disabled);
      if (existing.length) {
        if (active === true) {
          if (enabled) {
            // An explicit/manual application claims an automatically-created
            // condition, so subsequent reconciliation cannot remove it.
            if (!automatic && enabled.getFlag("neuroshima", "autoCondition") === true) {
              await enabled.unsetFlag("neuroshima", "autoCondition");
            }
            return enabled;
          }
          if (!automatic) {
            const effect = existing[0];
            if (effect.getFlag("neuroshima", "autoCondition") === true) {
              await effect.unsetFlag("neuroshima", "autoCondition");
            }
            return effect.update({ disabled: false });
          }
          // Do not reactivate a manually disabled effect on behalf of the
          // automatic rule. Create a separate managed effect below instead.
        }
        if (active === false || active === undefined) {
          const removable = automaticOnly
            ? existing.filter(effect => effect.getFlag("neuroshima", "autoCondition") === true)
            : existing;
          if (!removable.length) return;
          return this.deleteEmbeddedDocuments("ActiveEffect", removable.map(effect => effect.id));
        }
      }
      if (active === false) return;
      return this.createEmbeddedDocuments("ActiveEffect", [
        _condDefToEffectData(condDef, automatic ? { autoCondition: true } : {})
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
    const args = { actor: this, document: this, updateData: changed, options, user, cancel: false };
    await NeuroshimaScriptRunner.executeEvent("preUpdateDocument", args, {
      metadata: { document: this, updateData: changed }
    });
    if (args.cancel) return false;
  }

  /**
   * Trigger automatic condition evaluation after every actor update.
   * Only the client which initiated the update evaluates conditions, avoiding
   * duplicate writes while still allowing an owning player to keep automatic
   * conditions synchronized when no GM performs the edit.
   * @override
   */
  async _onUpdate(changed, options, userId) {
    await super._onUpdate(changed, options, userId);
    if (userId === game.user.id) {
      await NeuroshimaScriptRunner.executeEvent("update", {
        actor: this,
        document: this,
        updateData: changed,
        options,
        userId
      }, { metadata: { document: this, updateData: changed } });
    }
    if (userId === game.user.id && (game.user.isGM || this.isOwner)) {
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
    if (this._checkingAutoConditions) {
      this._autoConditionCheckPending = true;
      return this._autoConditionCheckPromise;
    }
    this._checkingAutoConditions = true;
    this._autoConditionCheckPromise = (async () => {
      try {
        do {
          this._autoConditionCheckPending = false;
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
        } while (this._autoConditionCheckPending);
      } finally {
        this._checkingAutoConditions = false;
        this._autoConditionCheckPromise = null;
        this._autoConditionCheckPending = false;
      }
    })();
    return this._autoConditionCheckPromise;
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
