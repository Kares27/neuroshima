/**
 * Represents a single executable script attached to an ActiveEffect.
 * Inspired by WFRP4e's script system but adapted for Neuroshima 1.5.
 */
export class NeuroshimaScript {
  constructor(scriptData, effect) {
    this.trigger = scriptData.trigger || "manual";
    this.label = scriptData.label || "";
    this.code = scriptData.code || "";
    this.runIfDisabled = scriptData.runIfDisabled ?? false;
    this.effect = effect;
  }

  // ── Context getters ──────────────────────────────────────────────────────

  get actor() {
    return this._executingActor ?? this.effect?.actor ?? null;
  }

  get item() {
    return this._executingItem ?? (this.effect?.parent?.documentName === "Item" ? this.effect.parent : null);
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

  // ── Location helpers ─────────────────────────────────────────────────────

  /**
   * Return true if `location` is a body location (character / NPC / creature).
   * @param {string} location
   * @returns {boolean}
   */
  isBodyLocation(location) {
    return NeuroshimaScriptRunner.isBodyLocation(location);
  }

  /**
   * Return true if `location` is a vehicle location.
   * @param {string} location
   * @returns {boolean}
   */
  isVehicleLocation(location) {
    return NeuroshimaScriptRunner.isVehicleLocation(location);
  }

  /**
   * Return the localized label for a hit location key (body or vehicle).
   * @param {string} location
   * @returns {string}
   */
  getLocationLabel(location) {
    return NeuroshimaScriptRunner.getLocationLabel(location);
  }

  // ── Damage order / wound reduction helpers ───────────────────────────────

  /**
   * Full severity order (interleaved, for comparison only).
   * sK > K > sC > C > sL > L > sD > D
   * @type {string[]}
   */
  get DAMAGE_ORDER() {
    return ["D", "sD", "L", "sL", "C", "sC", "K", "sK"];
  }

  /**
   * Regular wound severity track: D → L → C → K.
   * Use for reduce/increase operations on non-bruise wounds.
   * @type {string[]}
   */
  get REGULAR_ORDER() {
    return ["D", "L", "C", "K"];
  }

  /**
   * Bruise wound severity track: sD → sL → sC → sK.
   * Use for reduce/increase operations on bruise (s-prefix) wounds.
   * @type {string[]}
   */
  get BRUISE_ORDER() {
    return ["sD", "sL", "sC", "sK"];
  }

  /**
   * Reduce the single worst active wound on `actor` (defaults to this.actor) by 1 level.
   * Stays within the wound's own track (regular or bruise — never crosses between them).
   * If the wound is already at the minimum on its track (D or sD), it is healed (deleted).
   * @param {Actor} [actor] - Defaults to this.actor.
   * @returns {Promise<boolean>} true if a wound was reduced, false if no active wounds found.
   */
  async reduceWorstWound(actor) {
    const target = actor ?? this.actor;
    const worst = target.getWorstWounds();
    if (!worst.length) return false;
    const w = worst[0];
    const track = w.system.damageType?.startsWith("s") ? this.BRUISE_ORDER : this.REGULAR_ORDER;
    if (track.indexOf(w.system.damageType) === 0) {
      await w.heal();
    } else {
      await w.reduceLevel(1);
    }
    return true;
  }

  /**
   * Reduce the worst regular (non-bruise) wound by 1 level.
   * @param {Actor} [actor] - Defaults to this.actor.
   * @returns {Promise<boolean>}
   */
  async reduceWorstRegularWound(actor) {
    const target = actor ?? this.actor;
    const worst = target.getWorstRegularWounds();
    if (!worst.length) return false;
    const w = worst[0];
    if (this.REGULAR_ORDER.indexOf(w.system.damageType) === 0) {
      await w.heal();
    } else {
      await w.reduceLevel(1);
    }
    return true;
  }

  /**
   * Reduce the worst bruise (s-prefix) wound by 1 level.
   * @param {Actor} [actor] - Defaults to this.actor.
   * @returns {Promise<boolean>}
   */
  async reduceWorstBruiseWound(actor) {
    const target = actor ?? this.actor;
    const worst = target.getWorstBruiseWounds();
    if (!worst.length) return false;
    const w = worst[0];
    if (this.BRUISE_ORDER.indexOf(w.system.damageType) === 0) {
      await w.heal();
    } else {
      await w.reduceLevel(1);
    }
    return true;
  }

  // ── Damage type helpers ──────────────────────────────────────────────────

  /**
   * Return true if the damage type is light (D, sD, L, sL).
   * @param {string} damageType
   * @returns {boolean}
   */
  isLightDamage(damageType) {
    return NeuroshimaScriptRunner.isLightDamage(damageType);
  }

  /**
   * Return true if the damage type is heavy or worse (C, sC, K, sK).
   * @param {string} damageType
   * @returns {boolean}
   */
  isHeavyDamage(damageType) {
    return NeuroshimaScriptRunner.isHeavyDamage(damageType);
  }

  /**
   * Compare two damage types by severity.
   * Returns negative if a < b, 0 if equal, positive if a > b.
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  compareDamage(a, b) {
    return NeuroshimaScriptRunner.compareDamage(a, b);
  }

  // ── Token / targeting helpers ────────────────────────────────────────────

  /**
   * Apply all "Target" type effects (transferType "target", documentType "actor")
   * from `source` to the given targets. Targets default to the user's current targets.
   *
   * Use this in manual or immediate scripts to implement Target-type transfers.
   *
   * @param {Actor|Item}          source   - Actor or Item whose Target effects are transferred.
   * @param {Actor[]|Token[]}    [targets] - Defaults to this.getTargets().
   * @returns {Promise<void>}
   */
  async applyTargetEffects(source, targets) {
    const resolved = targets ?? this.getTargets();
    return game.neuroshima.CombatHelper.applyTargetEffects(source, resolved);
  }

  /**
   * Return all actors currently targeted by the user's token targeting.
   * Returns an empty array if nothing is targeted.
   * @returns {Actor[]}
   */
  getTargets() {
    return NeuroshimaScriptRunner.getTargets();
  }

  /**
   * Return actors of all currently selected tokens on the canvas.
   * Falls back to the user's assigned character if no token is selected.
   * @returns {Actor[]}
   */
  getSelected() {
    return NeuroshimaScriptRunner.getSelected();
  }

  /**
   * Return targeted actors if any targets exist, otherwise fall back to selected tokens.
   * This is the most common way to resolve "who the script should affect".
   * @returns {Actor[]}
   */
  getTargetsOrSelected() {
    return NeuroshimaScriptRunner.getTargetsOrSelected();
  }

  // ── Utility helpers ──────────────────────────────────────────────────────

  /**
   * Async pause for `ms` milliseconds.
   * Useful for waiting for Dice So Nice animations or chaining async steps.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return NeuroshimaScriptRunner.sleep(ms);
  }

  /**
   * Evaluate a dice formula and return the Roll object.
   * Shorthand for `new Roll(formula, data).evaluate()`.
   * @param {string} formula - A valid Foundry dice formula, e.g. "2d6+3", "1d100".
   * @param {Object} [data={}] - Formula data for variable substitution.
   * @returns {Promise<Roll>}
   */
  roll(formula, data = {}) {
    return new Roll(formula, data).evaluate();
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

  // ── Dialog helper ────────────────────────────────────────────────────────

  /**
   * Build default config for a Foundry V13 Dialog opened from a script.
   * Merges the effect name as window title with any extra config.
   * @param {string} content - HTML content of the dialog.
   * @param {Object} [config={}] - Extra ApplicationV2 config (merged).
   * @returns {Object}
   */
  dialogConfig(content, config = {}) {
    return foundry.utils.mergeObject(
      { window: { title: this.effect?.name ?? "" }, content },
      config
    );
  }

  /**
   * Show a Foundry V13 dialog from a script.
   * Wraps `foundry.applications.api.Dialog[type]()`.
   *
   * @param {string} content - HTML body of the dialog.
   * @param {"confirm"|"input"|"prompt"} [type="confirm"] - Dialog type.
   * @param {Object} [config={}] - Extra config merged into the dialog options.
   * @returns {Promise<any>}
   *
   * @example
   * // Confirm dialog — returns true/false
   * const yes = await this.dialog("<p>Użyć przedmiotu?</p>");
   * if (!yes) return;
   *
   * @example
   * // Prompt dialog — returns entered string or null
   * const name = await this.dialog("<p>Podaj nazwę:</p>", "prompt");
   */
  dialog(content, type = "confirm", config = {}) {
    return foundry.applications.api.Dialog[type](this.dialogConfig(content, config));
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  /**
   * Build a stable Proxy context for script execution.
   * Captures actor and item in a closure so they remain accessible even inside
   * async IIFEs where a finally-block might otherwise clear instance properties.
   * All other property/method accesses delegate to the original script instance.
   * @param {Actor|null}  executingActor
   * @param {Item|null}   executingItem
   * @returns {Proxy}
   */
  _buildContext(executingActor, executingItem) {
    const script = this;
    const proxy = new Proxy(this, {
      get(target, prop) {
        if (prop === "actor") return executingActor ?? script.effect?.actor ?? null;
        if (prop === "item")  return executingItem  ?? (script.effect?.parent?.documentName === "Item" ? script.effect.parent : null);
        const val = target[prop];
        if (typeof val === "function") return val.bind(proxy);
        return val;
      }
    });
    return proxy;
  }

  async execute(args = {}) {
    const executingActor = args.actor ?? null;
    const executingItem  = args.item  ?? null;
    const ctx = this._buildContext(executingActor, executingItem);
    try {
      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

      // Try to wrap the code as a return-expression so that Promises from IIFE
      // patterns like `(async () => { ... })()` are properly returned and awaited
      // by the caller.  If the code contains top-level statements (not a valid
      // expression), AsyncFunction construction throws a SyntaxError → fall back.
      let fn;
      const expr = this.code.trimEnd().replace(/;\s*$/, "");
      try {
        fn = new AsyncFunction("args", `return (${expr})`);
      } catch {
        fn = new AsyncFunction("args", this.code);
      }

      return await fn.call(ctx, args);
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.debug(`Neuroshima | Script Syntax [${this.label}]:`, e.message);
      } else {
        console.error(`Neuroshima | Script Error [${this.label}]:`, e);
        ui.notifications.error(`Script Error [${this.label}]: ${e.message}`);
      }
    }
  }

  executeSync(args = {}) {
    const executingActor = args.actor ?? null;
    const executingItem  = args.item  ?? null;
    const ctx = this._buildContext(executingActor, executingItem);
    try {
      const fn = new Function("args", this.code);
      return fn.call(ctx, args);
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.debug(`Neuroshima | Script Syntax [${this.label}]:`, e.message);
      } else {
        console.error(`Neuroshima | Script Error [${this.label}]:`, e);
        ui.notifications.error(`Script Error [${this.label}]: ${e.message}`);
      }
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
 * manual           — Manually Invoked: executed by clicking ▶ on the actor sheet
 *                    args: { actor }
 *
 * immediate        — Immediate: runs once right after the effect is created on an actor.
 *                    Ideal for one-shot consumables (apply and auto-delete the effect).
 *                    args: { actor, data, options }
 *
 * prepareData      — Prepare Data: runs during actor.prepareDerivedData() [SYNC, no await]
 *                    args: { actor }
 *                    Use: directly modify actor.system.* values
 *
 * preRollTest      — Pre-Roll Test: runs BEFORE any skill/attribute roll, can cancel or auto-succeed it
 *                    args: { actor, stat, skill, skillBonus, attributeBonus, penalties, label,
 *                            attributeKey, skillKey, autoSuccess, cancelled, annotation }
 *                    Use: set args.autoSuccess = true  → skip roll, count as success
 *                         set args.cancelled = true    → abort the roll entirely
 *                         set args.annotation = "text" → custom message shown in chat
 *
 * rollTest         — Roll Test: runs after preRollTest (only if not cancelled/autoSuccess)
 *                    args: { actor, stat, skill, skillBonus, attributeBonus, penalties, label,
 *                            attributeKey, skillKey }
 *                    Use: modify args.stat, args.skill, args.penalties.mod to affect the roll
 *
 * preApplyDamage   — Pre-Apply Damage: runs BEFORE armor reduction for an incoming hit.
 *                    Modify raw wound list before armor/pain resistance processing.
 *                    args: { actor, location, damageType, rawWounds, piercing }
 *                    Use: push/pop entries in args.rawWounds, or change args.damageType
 *
 * applyDamage      — Apply Damage: runs before pain resistance is processed for incoming wounds
 *                    args: { actor, wounds: [{name, damageType, forcePassed?, forceSkip?, annotation?}], location }
 *                    Use: set wound.forcePassed = true  → auto-pass pain resistance for that wound
 *                         set wound.forceSkip   = true  → remove the wound entirely
 *                         set wound.annotation  = "text"→ custom text shown in chat for this wound
 *
 * armorCalculation — Armour Calculation: runs before armor SP reduction is applied to an incoming hit [SYNC]
 *                    args: { actor, location, damageType, sp, piercing, bonusSP }
 *                    Use: modify args.sp, args.bonusSP to change effective armor value
 *
 * equipToggle      — Equip Toggle: runs after an item is equipped or unequipped
 *                    args: { actor, item, equipped }
 *                    Use: apply/remove custom bonuses based on equipped state
 *
 * startCombat      — Start Combat: runs when combat starts (once per actor)
 *                    args: { actor, combat }
 *
 * startRound       — Start Round: runs at the beginning of each combat round (once per actor)
 *                    args: { actor, combat, round }
 *
 * startTurn        — Start Turn: runs at the beginning of each of the actor's turns
 *                    args: { actor, combat, combatant }
 *
 * endTurn          — End Turn: runs at the end of each of the actor's turns
 *                    args: { actor, combat, combatant }
 *
 * endRound         — End Round: runs at the end of each combat round (once per actor)
 *                    args: { actor, combat, round }
 *
 * endCombat        — End Combat: runs when combat ends (once per actor)
 *                    args: { actor, combat }
 *
 * createEffect     — Effect Created: runs once when this effect is created on an actor
 *                    args: { actor, data, options }
 *
 * deleteEffect     — Effect Deleted: runs once when this effect is deleted from an actor
 *                    args: { actor, options }
 *
 * Context available inside every script (via `this`):
 *   this.effect                    — The ActiveEffect owning this script
 *   this.actor                     — The actor (parent of effect or item)
 *   this.item                      — The item (if the effect lives on an item)
 *   this.token                     — The first scene token for this actor (or null)
 *   this.notification(msg, type)   — Shows a UI notification
 *   this.roll(formula, data?)      — Evaluate a dice formula → Roll (async)
 *   this.sleep(ms)                 — Async pause in milliseconds
 *   this.getTargets()              — Actors targeted by the user
 *   this.getSelected()             — Actors of selected tokens (fallback: assigned character)
 *   this.getTargetsOrSelected()    — Targets if any, otherwise selected
 *   this.isLightDamage(type)       — true for D, sD, L, sL
 *   this.isHeavyDamage(type)       — true for C, sC, K, sK
 *   this.compareDamage(a, b)       — -1/0/1 severity comparison
 *   this.isBodyLocation(loc)       — true for character/NPC/creature locations
 *   this.isVehicleLocation(loc)    — true for vehicle locations
 *   this.getLocationLabel(loc)     — localized location name
 *   this.getChatData(merge?)       — ChatMessage data with default speaker/flavor
 *   this.sendMessage(html, data?)  — Create a chat message (async)
 *
 * Damage type constants (for use in scripts):
 *   D  sD  L  sL  C  sC  K  sK    (rany postaci, od najlżejszej; s = siniak)
 *   VL  VC  VK                     (vehicle damage)
 */
export class NeuroshimaScriptRunner {
  static TRIGGERS = {
    manual:           "Manually Invoked",
    immediate:        "Immediate",
    prepareData:      "Prepare Data",
    preRollTest:      "Pre-Roll Test",
    rollTest:         "Roll Test",
    preApplyDamage:   "Pre-Apply Damage",
    applyDamage:      "Apply Damage",
    armorCalculation: "Armour Calculation",
    equipToggle:      "Equip Toggle",
    startCombat:      "Start Combat",
    startRound:       "Start Round",
    startTurn:        "Start Turn",
    endTurn:          "End Turn",
    endRound:         "End Round",
    endCombat:        "End Combat",
    createEffect:     "Effect Created",
    deleteEffect:     "Effect Deleted"
  };

  /**
   * Damage type severity order for helpers.
   */
  static DAMAGE_ORDER = ["D", "sD", "L", "sL", "C", "sC", "K", "sK"];

  /**
   * Body location keys — valid for character, NPC, and creature actors.
   */
  static BODY_LOCATIONS = ["head", "rightArm", "leftArm", "torso", "rightLeg", "leftLeg"];

  /**
   * Vehicle location keys — valid for vehicle actors.
   */
  static VEHICLE_LOCATIONS = ["front", "rightSide", "leftSide", "rear", "bottom"];

  /**
   * Return true if the location is a body location (character / NPC / creature).
   * @param {string} location
   * @returns {boolean}
   */
  static isBodyLocation(location) {
    return this.BODY_LOCATIONS.includes(location);
  }

  /**
   * Return true if the location is a vehicle location.
   * @param {string} location
   * @returns {boolean}
   */
  static isVehicleLocation(location) {
    return this.VEHICLE_LOCATIONS.includes(location);
  }

  /**
   * Return the localized label for a hit location key.
   * Works for both body locations and vehicle locations.
   * Returns the raw key if no label is found.
   * @param {string} location
   * @returns {string}
   */
  static getLocationLabel(location) {
    const NEUROSHIMA = game.neuroshima?.NEUROSHIMA ?? {};
    const bodyEntry = NEUROSHIMA.bodyLocations?.[location];
    if (bodyEntry?.label) return game.i18n.localize(bodyEntry.label);
    const vehicleKey = NEUROSHIMA.vehicleLocations?.[location];
    if (vehicleKey) return game.i18n.localize(vehicleKey);
    return location;
  }

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
      if (effect.isSuppressed) return;
      const isDisabled = effect.disabled;
      const effectScripts = effect.scripts ?? [];
      for (const script of effectScripts) {
        if (script.trigger !== trigger) continue;
        if (isDisabled && !script.runIfDisabled) continue;
        scripts.push(script);
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
    const resolvedActor = actor
      ?? effect.actor
      ?? game.user.character
      ?? canvas.tokens?.controlled?.[0]?.actor
      ?? null;

    if (!resolvedActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Scripts.NoActor"));
      return;
    }

    const effectScripts = effect.getFlag("neuroshima", "scripts") || [];
    const scriptData = effectScripts[scriptIndex];
    if (!scriptData || scriptData.trigger !== "manual") return;
    const script = new NeuroshimaScript(scriptData, effect);
    await script.execute({ actor: resolvedActor, item: effect.parent?.documentName === "Item" ? effect.parent : null });
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

  /**
   * Check all actors in a combat and delete effects whose duration has expired.
   * Must be called by GM only. Intended to be called from the updateCombat hook.
   *
   * An effect is expired when:
   *   - it has a rounds-based or seconds-based duration
   *   - effect.duration.remaining is not null and is <= 0
   *
   * @param {Combat} combat
   * @returns {Promise<void>}
   */
  static async expireEffects(combat) {
    if (!game.user.isGM) return;
    // If a duration-handling module (e.g. "Times Up") is active, let it manage expiry.
    if (game.modules.get("times-up")?.active) return;
    if (game.modules.get("combat-utility-belt")?.active &&
        game.settings.get("combat-utility-belt", "enableConditionLab") === true) return;

    const currentRound = combat.round;
    const seen = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || seen.has(actor.id)) continue;
      seen.add(actor.id);

      const toDelete = actor.effects
        .filter(e => {
          // Primary: use Foundry's computed remaining (works when duration.combat is set)
          const d = e.duration;
          if (d && d.type !== "none" && d.remaining !== null && d.remaining !== undefined && d.remaining <= 0) {
            return true;
          }
          // Fallback: manual rounds check (handles effects without duration.combat set)
          const rounds     = e.duration?.rounds ?? 0;
          const startRound = e.duration?.startRound ?? null;
          if (rounds > 0 && startRound !== null) {
            return (startRound + rounds) <= currentRound;
          }
          return false;
        })
        .map(e => e.id);

      if (toDelete.length) {
        game.neuroshima?.log(`Expiring ${toDelete.length} effect(s) on ${actor.name}`);
        await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
      }
    }
  }
}
