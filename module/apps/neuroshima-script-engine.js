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

  get actor() {
    return this.effect?.actor ?? null;
  }

  get item() {
    return this.effect?.item ?? null;
  }

  notification(content, type = "info") {
    const name = this.effect?.name || "Effect";
    ui.notifications[type]?.(`${name}: ${content}`);
  }

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
 * Triggers available:
 * - manual       : Executed by clicking a button on the actor sheet
 * - prepareData  : Runs during actor prepareDerivedData (SYNC, no await)
 *                  args = { actor }
 *                  Use: modify actor.system.* values directly
 * - rollTest     : Runs before any skill/attribute roll
 *                  args = { actor, stat, skill, skillBonus, attributeBonus, penalties, label, attributeKey, skillKey }
 *                  Use: modify args.stat, args.skill, args.penalties.mod to affect the roll
 * - applyDamage  : Runs before pain resistance is processed for wounds
 *                  args = { actor, wounds: [{name, damageType, forcePassed?}], location }
 *                  Use: set wound.forcePassed = true to auto-pass pain resistance for that wound
 *                       set wound.forceSkip = true to remove the wound entirely
 * - equipToggle  : Runs after an item is equipped or unequipped
 *                  args = { actor, item, equipped }
 *                  Use: apply or remove custom bonuses based on equipped state
 *
 * Context available inside scripts (via `this`):
 * - this.effect  - The ActiveEffect owning this script
 * - this.actor   - The actor (parent of the effect or item)
 * - this.item    - The item (if the effect lives on an item)
 * - this.notification(msg, type) - Shows a UI notification
 */
export class NeuroshimaScriptRunner {
  static TRIGGERS = {
    manual: "NEUROSHIMA.Scripts.Trigger.Manual",
    prepareData: "NEUROSHIMA.Scripts.Trigger.PrepareData",
    rollTest: "NEUROSHIMA.Scripts.Trigger.RollTest",
    armorCalculation: "NEUROSHIMA.Scripts.Trigger.ArmorCalculation",
    applyDamage: "NEUROSHIMA.Scripts.Trigger.ApplyDamage",
    equipToggle: "NEUROSHIMA.Scripts.Trigger.EquipToggle",
    createEffect: "NEUROSHIMA.Scripts.Trigger.CreateEffect",
    deleteEffect: "NEUROSHIMA.Scripts.Trigger.DeleteEffect"
  };

  /**
   * Collect all scripts from actor effects and embedded item effects for a given trigger.
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

    for (const effect of (actor.effects || [])) {
      collectFromEffect(effect);
    }

    for (const item of (actor.items || [])) {
      for (const effect of (item.effects || [])) {
        if (item.system?.equipped === false) continue;
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
      await script.execute(args);
    }
  }

  /**
   * Execute all scripts for a given trigger synchronously.
   * Use for triggers called from synchronous methods (e.g. prepareDerivedData).
   * Scripts must not use async/await - they run synchronously.
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
   * @param {string} scriptIndex
   * @param {ActiveEffect} effect
   * @returns {Promise<void>}
   */
  static async executeManual(actor, effect, scriptIndex) {
    const effectScripts = effect.getFlag("neuroshima", "scripts") || [];
    const scriptData = effectScripts[scriptIndex];
    if (!scriptData || scriptData.trigger !== "manual") return;
    const script = new NeuroshimaScript(scriptData, effect);
    await script.execute({ actor });
  }
}
