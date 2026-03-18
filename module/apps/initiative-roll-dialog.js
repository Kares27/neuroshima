import { NEUROSHIMA } from "../config.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Dialog for unified initiative rolls.
 */
export class NeuroshimaInitiativeRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options={}) {
    super(options);
    this.actor = options.actor;
    this.combatant = options.combatant;
    this.weaponId = options.weaponId;
    this.targets = options.targets;
    this.duelId = options.duelId;
    this.encounterId = options.encounterId;
    this.isMelee = options.isMelee;
    this.meleeMode = options.meleeMode || "initiate"; // "initiate", "respond", "join"
    this.pendingId = options.pendingId || null;
    
    // Initial options
    this.rollOptions = {
      attribute: options.attribute || "dexterity",
      skill: options.skill || "",
      useSkill: options.useSkill ?? true,
      modifier: options.modifier || 0,
      difficulty: options.difficulty || "average",
      useArmorPenalty: options.useArmorPenalty ?? false,
      useWoundPenalty: options.useWoundPenalty ?? true,
      rollMode: options.rollMode || game.settings.get("core", "rollMode")
    };
    
    this._onRollCallback = options.onRoll;
    this._onCloseCallback = options.onClose;
  }

  /** @override */
  async close(options={}) {
    if (this._onCloseCallback) this._onCloseCallback();
    return super.close(options);
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "dialog", "standard-form", "roll-dialog-window", "initiative-roll-dialog"],
    position: { width: 480, height: "auto" },
    window: {
      resizable: false,
      minimizable: false
    },
    form: {
        handler: NeuroshimaInitiativeRollDialog.prototype._onSubmit,
        submitOnChange: false,
        closeOnSubmit: true
    }
  };

  /** @override */
  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/dialog/initiative-roll-dialog.hbs"
    }
  };

  /**
   * Handle form submission.
   */
  async _onSubmit(event, form, formData) {
    const action = event.submitter?.dataset.action || event.submitter?.getAttribute("action");
    
    if (action === "cancel") {
        return this.close();
    }
    
    // Extract data from formData object
    const rollData = this._extractRollData(formData.object);
    
    // Close dialog IMMEDIATELY
    this.close();
    
    // Perform roll (this will await for Dice So Nice if configured)
    const result = await this._performRoll(rollData);
    
    game.neuroshima?.log("Initiative roll completed", {
        actor: this.actor.name,
        successPoints: result?.successPoints,
        rollData
    });
    
    // Update combatant if needed
    if (this.combatant && !this.isMelee) {
        await this.combatant.update({ initiative: result.successPoints });
    }
    
    // Handle Melee Initiation if this was a melee initiative roll
    if (this.isMelee && result && this.meleeMode === "initiate") {
        if (this.duelId || this.encounterId) {
            // Joining or responding to an existing encounter
            // This will be handled by the caller or a specific service
        } else if (this.targets && this.targets.length === 1) {
            const rawTarget = this.targets[0];
            let targetDoc = rawTarget;
            
            // Normalize target if it's a UUID string
            if (typeof rawTarget === "string") {
                targetDoc = fromUuidSync(rawTarget);
            }
            
            const targetActor = targetDoc?.actor || targetDoc;
            if (!targetActor?.getFlag) {
                console.warn("Neuroshima | Invalid melee target passed to initiative dialog", rawTarget);
                return result;
            }
            
            // If we are initiating a NEW melee from a weapon click
            const { MeleeEncounter } = await import("../combat/melee-encounter.js");
            const { MeleeStore } = await import("../combat/melee-store.js");
            const activeEncounterId = targetActor.getFlag("neuroshima", "activeMeleeEncounter");
            const activeEncounter = activeEncounterId ? MeleeStore.getEncounter(activeEncounterId) : null;
            
            if (activeEncounter) {
                game.neuroshima?.log("Target already in encounter, joining", { activeEncounterId, target: targetActor.name });
                // Join existing
                await MeleeEncounter.join(activeEncounterId, {
                    id: this.actor.uuid,
                    actorUuid: this.actor.uuid,
                    tokenUuid: this.actor.token?.uuid,
                    actorId: this.actor.id,
                    name: this.actor.name,
                    img: this.actor.img,
                    weaponId: this.weaponId,
                    initiative: result.successPoints,
                    chargeLevel: rollData.chargeLevel
                }, "A"); // Team A for now, logic can be more complex
            } else {
                // If it has a stale flag, unset it
                if (activeEncounterId) {
                    game.neuroshima?.log("Target has stale activeMeleeEncounter flag, clearing", { activeEncounterId });
                    await targetActor.unsetFlag("neuroshima", "activeMeleeEncounter");
                }
                
                game.neuroshima?.log("Initiating new pending melee", { attacker: this.actor.name, target: targetActor.name });
                // Initiate pending
                const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
                await NeuroshimaMeleeCombat.initiateMeleePending(
                    this.actor.uuid,
                    targetActor.uuid,
                    result.successPoints,
                    this.weaponId,
                    rollData.maneuver,
                    rollData.chargeLevel
                );
            }
        }
    }
    
    return result;
  }

  /**
   * Extracts and converts form data into roll options.
   * @private
   */
  _extractRollData(data) {
    const penalties = {
        mod: parseInt(data.modifier) || 0,
        armor: data.useArmorPenalty ? (this.actor.system.combat?.totalArmorPenalty || 0) : 0,
        wounds: data.useWoundPenalty ? (this.actor.system.combat?.totalWoundPenalty || 0) : 0
    };

    return {
        attribute: data.attribute,
        skill: data.skill,
        useSkill: !!data.useSkill,
        difficulty: data.difficulty,
        modifier: penalties.mod,
        useArmorPenalty: !!data.useArmorPenalty,
        useWoundPenalty: !!data.useWoundPenalty,
        skillBonus: parseInt(data.skillBonus) || 0,
        attributeBonus: parseInt(data.attributeBonus) || 0,
        maneuver: data.maneuver || "none",
        chargeLevel: parseInt(data.chargeLevel) || 0,
        rollMode: data.rollMode
    };
  }

  /**
   * Executes the roll using the provided data.
   * @private
   */
  async _performRoll(rollData) {
    let result;
    if (this._onRollCallback) {
        result = await this._onRollCallback(rollData);
    } else {
        result = await game.neuroshima.NeuroshimaDice.rollInitiative({
            ...rollData,
            actor: this.actor
        });
    }
    return result;
  }

  /** @override */
  get title() {
    return `${game.i18n.localize("NEUROSHIMA.Roll.RollInitiative")}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    
    // Penalties from actor
    const armorPenalty = this.actor.system.combat?.totalArmorPenalty || 0;
    const woundPenalty = this.actor.system.combat?.totalWoundPenalty || 0;

    context.actor = this.actor;
    context.attributes = NEUROSHIMA.attributes;
    context.difficulties = NEUROSHIMA.difficulties;
    context.isMelee = this.isMelee;
    
    // Prepare skills list
    const equippedWeapon = this.actor.items.find(i => i.type === "weapon" && i.system.equipped);
    const weaponSkillKey = equippedWeapon?.system.skill;

    const skills = {};
    for (const [key, skill] of Object.entries(this.actor.system.skills)) {
        let label = game.i18n.localize(`NEUROSHIMA.Skills.${key}`);
        if (key === weaponSkillKey) {
            label = `+ ${label}`;
        }
        skills[key] = {
            key: key,
            label: label,
            value: skill.value || 0
        };
    }
    context.skills = skills;
    context.weaponSkillKey = weaponSkillKey;

    context.armorPenalty = armorPenalty;
    context.woundPenalty = woundPenalty;
    
    // State values
    context.currentAttribute = this.rollOptions.attribute;
    context.currentSkill = this.rollOptions.skill || (weaponSkillKey || "");
    context.useSkill = this.rollOptions.useSkill;
    context.currentDifficulty = this.rollOptions.difficulty;
    context.modifier = this.rollOptions.modifier;
    context.useArmorPenalty = this.rollOptions.useArmorPenalty;
    context.useWoundPenalty = this.rollOptions.useWoundPenalty;
    context.rollMode = this.rollOptions.rollMode;
    context.rollModes = CONFIG.Dice.rollModes;
    
    // Buttons for footer
    context.buttons = [
        {
            type: "submit",
            action: "roll",
            label: "NEUROSHIMA.Actions.Roll",
            class: "bright",
            autofocus: true
        },
        {
            type: "submit",
            action: "cancel",
            label: "NEUROSHIMA.Actions.Cancel",
            class: ""
        }
    ];
    
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    
    // Attach event listeners for real-time preview
    html.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', (event) => this._updatePreview(event));
    });

    // Cancel button listener
    const cancelBtn = html.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            this.close();
        });
    }

    this._updatePreview();
  }

  /**
   * Update the difficulty preview box in real-time.
   */
  _updatePreview(event) {
    const html = this.element;
    const form = html.tagName === "FORM" ? html : html.querySelector('form');
    if (!form) return;

    const formData = new foundry.applications.ux.FormDataExtended(form).object;
    
    // Show/hide charge level
    const chargeWrapper = html.querySelector('.charge-level-wrapper');
    if (chargeWrapper) {
        chargeWrapper.hidden = formData.maneuver !== 'charge';
    }

    // Calculate total percentage
    const basePenalty = NEUROSHIMA.difficulties[formData.difficulty]?.min || 0;
    const modifier = parseInt(formData.modifier) || 0;
    const armorPenalty = formData.useArmorPenalty ? (this.actor.system.combat?.totalArmorPenalty || 0) : 0;
    const woundPenalty = formData.useWoundPenalty ? (this.actor.system.combat?.totalWoundPenalty || 0) : 0;
    
    const totalPct = basePenalty + modifier + armorPenalty + woundPenalty;

    // Update preview box
    const totalElement = html.querySelector('.total-modifier');
    if (totalElement) {
        totalElement.innerText = `${totalPct}%`;
    }

    // Update target number
    const attrKey = formData.attribute;
    const attrTotal = Number(this.actor.system.attributeTotals[attrKey]) || 0;
    const attrBonus = parseInt(formData.attributeBonus) || 0;
    
    // Charge bonus
    let maneuverBonus = 0;
    if (formData.maneuver === 'charge') {
        maneuverBonus = parseInt(formData.chargeLevel) || 0;
    }

    // Calculate Shifted Difficulty (Suwak)
    const skillKey = formData.skill;
    const skillValue = formData.useSkill ? (Number(this.actor.system.skills[skillKey]?.value) || 0) : 0;
    const skillBonus = formData.useSkill ? (parseInt(formData.skillBonus) || 0) : 0;
    const finalSkill = skillValue + skillBonus;
    
    // Skill shift logic from NeuroshimaDice
    const skillShift = (finalSkill <= 0) ? -1 : Math.floor(finalSkill / 4);
    
    // Find base difficulty from total percentage
    const baseDifficulty = game.neuroshima.NeuroshimaDice.getDifficultyFromPercent(totalPct);
    
    // Find shifted difficulty
    const difficulties = Object.values(NEUROSHIMA.difficulties);
    const order = ["easy", "average", "problematic", "hard", "veryHard", "damnHard", "luck", "masterful", "grandmasterful"];
    const baseDiffKey = Object.keys(NEUROSHIMA.difficulties).find(key => NEUROSHIMA.difficulties[key].label === baseDifficulty.label);
    const baseDiffIndex = order.indexOf(baseDiffKey);
    const shiftedIndex = Math.max(0, Math.min(order.length - 1, baseDiffIndex - skillShift));
    const shiftedDifficulty = NEUROSHIMA.difficulties[order[shiftedIndex]];

    const shiftedElement = html.querySelector('.shifted-difficulty');
    if (shiftedElement) {
        shiftedElement.innerText = game.i18n.localize(shiftedDifficulty.label);
    }
    
    // Update target with the shifted difficulty modifier and maneuver bonus
    const targetElement = html.querySelector('.final-target');
    if (targetElement) {
        targetElement.innerText = attrTotal + attrBonus + maneuverBonus + shiftedDifficulty.mod;
    }

    // Toggle skill select disability
    const skillSelect = html.querySelector('select[name="skill"]');
    const skillBonusInput = html.querySelector('input[name="skillBonus"]');
    if (skillSelect) skillSelect.disabled = !formData.useSkill;
    if (skillBonusInput) skillBonusInput.disabled = !formData.useSkill;
  }

  /** @override */
  _prepareSubmitData(event, form, formData) {
    const data = super._prepareSubmitData(event, form, formData);
    return data;
  }

  _onCancel(event, target) {
    this.close();
  }
}
