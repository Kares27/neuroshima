/**
 * Represents a single executable script attached to an ActiveEffect.
 * Inspired by WFRP4e's script system but adapted for Neuroshima 1.5.
 */
export class NeuroshimaScript {
  constructor(scriptData, effect) {
    this.trigger = scriptData.trigger || "manual";
    this.label = scriptData.label || "";
    this.code = scriptData.code || "";
    this.effect = effect;
  }

  // ── Context getters ──────────────────────────────────────────────────────

  get actor() {
    return this.effect?.actor ?? null;
  }

  get item() {
    const parent = this.effect?.parent;
    return parent?.documentName === "Item" ? parent : null;
  }

  /**
   * The first token on the active scene that represents this actor.
   * Returns null if the actor has no token or there is no active scene.
   */
  get token() {
    return canvas.scene?.tokens.find(t => t.actor?.id === this.actor?.id) ?? null;
  }

  // ── Notifications ────────────────────────────────────────────────────────

  notification(content, type = "info") {
    const name = this.effect?.name || "Effect";
    ui.notifications[type]?.(`${name}: ${content}`);
  }

  // ── Chat helpers ─────────────────────────────────────────────────────────

  /**
   * Build default ChatMessage creation data for this script context.
   * The speaker defaults to the actor; flavor defaults to the effect name.
   * @param {Object} [merge={}] Additional data to merge in.
   * @returns {Object}
   */
  getChatData(merge = {}) {
    return foundry.utils.mergeObject({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: this.effect?.name ?? this.item?.name ?? ""
    }, merge);
  }

  /**
   * Create a chat message attributed to this script's actor.
   * @param {string} content - HTML content of the message.
   * @param {Object} [chatData={}] - Additional ChatMessage data (merged with defaults).
   * @returns {Promise<ChatMessage>}
   */
  async sendMessage(content, chatData = {}) {
    return ChatMessage.create(this.getChatData(foundry.utils.mergeObject({ content }, chatData)));
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async execute(args = {}) {
    try {
      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
      const fn = new AsyncFunction("args", this.code);
      await fn.call(this, args);
    } catch (e) {
      console.error(`Neuroshima | Script Error [${this.label}]:`, e);
      ui.notifications.error(`Script Error [${this.label}]: ${e.message}`);
    }
  }

  executeSync(args = {}) {
    try {
      const fn = new Function("args", this.code);
      fn.call(this, args);
    } catch (e) {
      console.error(`Neuroshima | Script Error [${this.label}]:`, e);
      ui.notifications.error(`Script Error [${this.label}]: ${e.message}`);
    }
  }
}

/**
 * Manages and executes Neuroshima scripts stored as flags on ActiveEffects.
 *
 * Scripts are stored in flags.neuroshima.scripts as:
 * [{ trigger: string, label: string, code: string }]
 *
 * Available triggers:
 *
 * manual          — Executed by clicking ▶ on the actor sheet
 * prepareData     — Runs during actor.prepareDerivedData() [SYNC, no await]
 *                   args: { actor }
 *                   Use: directly modify actor.system.* values
 *
 * preRollTest     — Runs BEFORE any skill/attribute roll, can cancel or auto-succeed it
 *                   args: { actor, stat, skill, skillBonus, attributeBonus, penalties, label,
 *                           attributeKey, skillKey, autoSuccess, cancelled, annotation }
 *                   Use: set args.autoSuccess = true  → skip roll, count as success
 *                        set args.cancelled = true    → abort the roll entirely
 *                        set args.annotation = "text" → custom message shown in chat (replaces generic AutoSuccess text)
 *
 * rollTest        — Runs after preRollTest (only if not cancelled/autoSuccess), can modify roll params
 *                   args: { actor, stat, skill, skillBonus, attributeBonus, penalties, label,
 *                           attributeKey, skillKey }
 *                   Use: modify args.stat, args.skill, args.penalties.mod to affect the roll
 *
 * applyDamage     — Runs before pain resistance is processed for incoming wounds
 *                   args: { actor, wounds: [{name, damageType, forcePassed?, forceSkip?, annotation?}], location }
 *                   Use: set wound.forcePassed = true       → auto-pass pain resistance for that wound
 *                        set wound.forceSkip   = true       → remove the wound entirely
 *                        set wound.annotation  = "text"     → custom text shown in chat for this wound (replaces generic ForcePassed text)
 *
 * armorCalculation — Runs before armor SP reduction is applied to an incoming hit
 *                    args: { actor, location, damageType, sp, piercing, bonusSP }
 *                    Use: modify args.sp, args.bonusSP to change effective armor value
 *
 * equipToggle     — Runs after an item is equipped or unequipped
 *                   args: { actor, item, equipped }
 *                   Use: apply/remove custom bonuses based on equipped state
 *
 * startCombat     — Runs when combat starts (once per combatant)
 *                   args: { actor, combat }
 *
 * startTurn       — Runs at the beginning of each of the actor's turns
 *                   args: { actor, combat, combatant }
 *
 * endTurn         — Runs at the end of each of the actor's turns
 *                   args: { actor, combat, combatant }
 *
 * endCombat       — Runs when combat ends
 *                   args: { actor, combat }
 *
 * createEffect    — Runs once when this effect is created on an actor
 *                   args: { actor, data, options }
 *
 * deleteEffect    — Runs once when this effect is deleted from an actor
 *                   args: { actor, options }
 *
 * Context available inside every script (via `this`):
 *   this.effect                    — The ActiveEffect owning this script
 *   this.actor                     — The actor (parent of effect or item)
 *   this.item                      — The item (if the effect lives on an item)
 *   this.notification(msg, type)   — Shows a UI notification
 *
 * Damage type constants (for use in scripts):
 *   D  sD  L  sL  C  sC  K  sK    (rany postaci, od najlżejszej; s = siniak)
 *   VL  VC  VK                     (vehicle damage)
 */
export class NeuroshimaScriptRunner {
  static TRIGGERS = {
    manual:           "NEUROSHIMA.Scripts.Trigger.Manual",
    prepareData:      "NEUROSHIMA.Scripts.Trigger.PrepareData",
    preRollTest:      "NEUROSHIMA.Scripts.Trigger.PreRollTest",
    rollTest:         "NEUROSHIMA.Scripts.Trigger.RollTest",
    applyDamage:      "NEUROSHIMA.Scripts.Trigger.ApplyDamage",
    armorCalculation: "NEUROSHIMA.Scripts.Trigger.ArmorCalculation",
    equipToggle:      "NEUROSHIMA.Scripts.Trigger.EquipToggle",
    startCombat:      "NEUROSHIMA.Scripts.Trigger.StartCombat",
    startRound:       "NEUROSHIMA.Scripts.Trigger.StartRound",
    startTurn:        "NEUROSHIMA.Scripts.Trigger.StartTurn",
    endTurn:          "NEUROSHIMA.Scripts.Trigger.EndTurn",
    endRound:         "NEUROSHIMA.Scripts.Trigger.EndRound",
    endCombat:        "NEUROSHIMA.Scripts.Trigger.EndCombat",
    createEffect:     "NEUROSHIMA.Scripts.Trigger.CreateEffect",
    deleteEffect:     "NEUROSHIMA.Scripts.Trigger.DeleteEffect"
  };

  /**
   * Damage type severity order for helpers.
   */
  static DAMAGE_ORDER = ["D", "sD", "L", "sL", "C", "sC", "K", "sK"];

  /**
   * Check if a damage type is "light" (D, sD, L, sL).
   * @param {string} damageType
   */
  static isLightDamage(damageType) {
    return ["D", "sD", "L", "sL"].includes(damageType);
  }

  /**
   * Check if a damage type is "heavy or worse" (C, sC, K, sK).
   * @param {string} damageType
   */
  static isHeavyDamage(damageType) {
    return ["C", "sC", "K", "sK"].includes(damageType);
  }

  /**
   * Compare two damage types. Returns negative if a < b, 0 if equal, positive if a > b.
   * @param {string} a
   * @param {string} b
   */
  static compareDamage(a, b) {
    return this.DAMAGE_ORDER.indexOf(a) - this.DAMAGE_ORDER.indexOf(b);
  }

  /**
   * Collect all scripts from actor effects and embedded item effects for a given trigger.
   * Supports character, NPC, creature, and vehicle actor types.
   * For items: only collects from equipped items (if item has equipped property).
   * @param {Actor} actor
   * @param {string} trigger
   * @returns {NeuroshimaScript[]}
   */
  static getScripts(actor, trigger) {
    const scripts = [];
    if (!actor) return scripts;

    const collectFromEffect = (effect) => {
      if (effect.disabled || effect.isSuppressed) return;
      const effectScripts = effect.scripts ?? [];
      for (const script of effectScripts) {
        if (script.trigger === trigger) {
          scripts.push(script);
        }
      }
    };

    for (const effect of (actor.effects ?? [])) {
      collectFromEffect(effect);
    }

    for (const item of (actor.items ?? [])) {
      const hasEquipped = "equipped" in (item.system ?? {});
      if (hasEquipped && item.system.equipped === false) continue;
      for (const effect of (item.effects ?? [])) {
        collectFromEffect(effect);
      }
    }

    return scripts;
  }

  /**
   * Execute all scripts for a given trigger on the actor (async).
   * @param {string} trigger
   * @param {Object} args - Arguments passed to each script
   * @returns {Promise<void>}
   */
  static async execute(trigger, args = {}) {
    const actor = args.actor;
    if (!actor) return;
    const scripts = this.getScripts(actor, trigger);
    for (const script of scripts) {
      if (trigger === "applyDamage" && Array.isArray(args.wounds)) {
        const before = args.wounds.map(w => ({ forcePassed: w.forcePassed, annotation: w.annotation }));
        await script.execute(args);
        args.wounds.forEach((w, i) => {
          if (w.forcePassed && !before[i].forcePassed && !w.effectName) {
            w.effectName = script.effect?.name ?? "";
          }
          const newAnnotation = w.annotation;
          const oldAnnotation = before[i].annotation;
          if (newAnnotation && oldAnnotation && newAnnotation !== oldAnnotation) {
            w.annotation = `${oldAnnotation}\n${newAnnotation}`;
          }
        });
      } else {
        await script.execute(args);
      }
    }
  }

  /**
   * Execute all scripts for a given trigger synchronously.
   * Use for triggers called from synchronous methods (e.g. prepareDerivedData).
   * Scripts must not use async/await — they run synchronously.
   * @param {string} trigger
   * @param {Object} args - Arguments passed to each script
   */
  static executeSync(trigger, args = {}) {
    const actor = args.actor;
    if (!actor) return;
    const scripts = this.getScripts(actor, trigger);
    for (const script of scripts) {
      script.executeSync(args);
    }
  }

  /**
   * Execute manual scripts on an actor (called from the actor sheet).
   * @param {Actor} actor
   * @param {ActiveEffect} effect
   * @param {number} scriptIndex
   * @returns {Promise<void>}
   */
  static async executeManual(actor, effect, scriptIndex) {
    const effectScripts = effect.getFlag("neuroshima", "scripts") || [];
    const scriptData = effectScripts[scriptIndex];
    if (!scriptData || scriptData.trigger !== "manual") return;
    const script = new NeuroshimaScript(scriptData, effect);
    await script.execute({ actor, item: effect.parent?.documentName === "Item" ? effect.parent : null });
  }

  /**
   * Run preRollTest scripts and return result flags.
   * @param {Actor} actor
   * @param {Object} rollArgs - Current roll parameters
   * @returns {Promise<{autoSuccess: boolean, cancelled: boolean}>}
   */
  static async runPreRollTest(actor, rollArgs) {
    if (!actor) return { autoSuccess: false, cancelled: false };
    const args = { ...rollArgs, autoSuccess: false, cancelled: false };
    await this.execute("preRollTest", args);
    return { autoSuccess: !!args.autoSuccess, cancelled: !!args.cancelled };
  }

  /**
   * Run startCombat scripts for all combatants that have a linked actor.
   * @param {Combat} combat
   */
  static async runStartCombat(combat) {
    const actors = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actors.has(actor.id)) continue;
      actors.add(actor.id);
      await this.execute("startCombat", { actor, combat });
    }
  }

  /**
   * Run startTurn scripts for the current combatant's actor.
   * @param {Combat} combat
   * @param {Combatant} combatant
   */
  static async runStartTurn(combat, combatant) {
    const actor = combatant?.actor;
    if (!actor) return;
    await this.execute("startTurn", { actor, combat, combatant });
  }

  /**
   * Run endTurn scripts for the current combatant's actor.
   * @param {Combat} combat
   * @param {Combatant} combatant
   */
  static async runEndTurn(combat, combatant) {
    const actor = combatant?.actor;
    if (!actor) return;
    await this.execute("endTurn", { actor, combat, combatant });
  }

  /**
   * Run endCombat scripts for all combatants that have a linked actor.
   * @param {Combat} combat
   */
  static async runEndCombat(combat) {
    const actors = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actors.has(actor.id)) continue;
      actors.add(actor.id);
      await this.execute("endCombat", { actor, combat });
    }
  }

  /**
   * Run startRound scripts for all combatants at the beginning of a new round.
   * Called once per actor (deduped).
   * @param {Combat} combat
   */
  static async runStartRound(combat) {
    const actors = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actors.has(actor.id)) continue;
      actors.add(actor.id);
      await this.execute("startRound", { actor, combat, round: combat.round });
    }
  }

  /**
   * Run endRound scripts for all combatants at the end of a round.
   * @param {Combat} combat
   */
  static async runEndRound(combat) {
    const actors = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actors.has(actor.id)) continue;
      actors.add(actor.id);
      await this.execute("endRound", { actor, combat, round: combat.round });
    }
  }

  // ── Script utility helpers (available in scripts via game.neuroshima.NeuroshimaScriptRunner) ──

  /**
   * Return all actors targeted by the current user's token targeting.
   * Returns an empty array if nothing is targeted.
   * @returns {Actor[]}
   */
  static getTargets() {
    return Array.from(game.user.targets).map(t => t.actor).filter(a => a);
  }

  /**
   * Return actors of all currently selected tokens on the canvas.
   * Falls back to the user's assigned character if no token is selected.
   * @returns {Actor[]}
   */
  static getSelected() {
    const selected = canvas.tokens?.controlled.map(t => t.actor).filter(a => a) ?? [];
    if (selected.length) return selected;
    if (game.user.character) return [game.user.character];
    return [];
  }

  /**
   * Return targeted actors if any targets exist, otherwise fall back to selected tokens.
   * @returns {Actor[]}
   */
  static getTargetsOrSelected() {
    const targets = this.getTargets();
    return targets.length ? targets : this.getSelected();
  }

  /**
   * Async sleep / delay.
   * Useful for waiting between steps (e.g. after Dice So Nice animations).
   * @param {number} ms - Milliseconds to wait.
   * @returns {Promise<void>}
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Roll a dice formula and return the evaluated Roll object.
   * Convenience wrapper around `new Roll(formula).evaluate()`.
   * @param {string} formula - A valid Foundry dice formula (e.g. "1d100", "2d6+3").
   * @param {Object} [data={}]  - Formula data for variable substitution.
   * @returns {Promise<Roll>}
   */
  static async rollDice(formula, data = {}) {
    return new Roll(formula, data).evaluate();
  }
}
