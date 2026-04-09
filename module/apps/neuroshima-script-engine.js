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
}

/**
 * Manages and executes Neuroshima scripts stored as flags on ActiveEffects.
 *
 * Scripts are stored in flags.neuroshima.scripts as:
 * [{ trigger: string, label: string, code: string }]
 *
 * Triggers available:
 * - manual       : Executed by clicking a button on the actor sheet
 * - prepareData  : Runs during actor prepareDerivedData
 * - rollTest     : Runs before a skill/attribute roll
 * - armorCalculation : Runs during armor value computation
 * - applyDamage  : Runs when damage is applied to the actor
 * - equipToggle  : Runs when an item is equipped/unequipped
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
    equipToggle: "NEUROSHIMA.Scripts.Trigger.EquipToggle"
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
      const effectScripts = effect.getFlag("neuroshima", "scripts") || [];
      for (const scriptData of effectScripts) {
        if (scriptData.trigger === trigger) {
          scripts.push(new NeuroshimaScript(scriptData, effect));
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
   * Execute all scripts for a given trigger on the actor.
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
