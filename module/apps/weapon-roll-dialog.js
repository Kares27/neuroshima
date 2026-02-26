import { NEUROSHIMA } from "../config.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Dialog for weapon rolls (ranged and melee).
 */
export class NeuroshimaWeaponRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options={}) {
    super(options);
    this.actor = options.actor;
    this.weapon = options.weapon;
    this.rollType = options.rollType || "ranged";
    this.targets = options.targets || [];
    const lastRoll = options.lastRoll || {};
    
    game.neuroshima.group("NeuroshimaWeaponRollDialog.constructor");
    game.neuroshima.log("Actor:", options.actor?.name, options.actor?.id);
    game.neuroshima.log("Weapon:", options.weapon?.name, options.weapon?.id);
    game.neuroshima.log("Raw lastRoll from options:", lastRoll);
    game.neuroshima.groupEnd();
    
    // Initial roll options with persistence
    this.rollOptions = {
      isOpen: lastRoll.isOpen ?? false,
      difficulty: lastRoll.difficulty || "average",
      hitLocation: "random",
      meleeAction: lastRoll.meleeAction || "attack",
      aimingLevel: this.rollType === "melee" ? 2 : (lastRoll.aimingLevel || 0), // 2 means 3 dice for display
      burstLevel: 0,
      percentageModifier: lastRoll.percentageModifier || 0,
      useArmorPenalty: lastRoll.useArmorPenalty ?? true,
      useWoundPenalty: lastRoll.useWoundPenalty ?? true,
      distance: lastRoll.distance || 0,
      rollMode: lastRoll.rollMode || game.settings.get("core", "rollMode")
    };
    this._onCloseCallback = options.onClose;
  }

  /** @override */
  async close(options={}) {
    if (this._onCloseCallback) this._onCloseCallback();
    return super.close(options);
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "dialog", "standard-form", "roll-dialog-window", "weapon-roll-dialog"],
    position: { width: 480, height: "auto" },
    window: {
      resizable: false,
      minimizable: false
    },
    actions: {
      roll: NeuroshimaWeaponRollDialog.prototype._onRoll,
      cancel: NeuroshimaWeaponRollDialog.prototype._onCancel
    }
  };

  /** @override */
  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/dialog/ranged-roll-dialog.hbs"
    }
  };

  /** @override */
  get title() {
    const label = this.rollType === "ranged" ? "NEUROSHIMA.Actions.Shoot" : "NEUROSHIMA.Actions.Strike";
    return `${game.i18n.localize(label)}: ${this.weapon.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    
    game.neuroshima.group("NeuroshimaWeaponRollDialog._prepareContext");
    game.neuroshima.log("Current rollOptions:", this.rollOptions);
    game.neuroshima.groupEnd();
    
    // Penalties from actor
    const armorPenalty = this.actor.system.combat?.totalArmorPenalty || 0;
    const woundPenalty = this.actor.system.combat?.totalWoundPenalty || 0;

    context.actor = this.actor;
    context.weapon = this.weapon;
    context.rollType = this.rollType;
    context.difficulties = NEUROSHIMA.difficulties;
    const weaponTypeKey = this.rollType === "melee" ? "melee" : "ranged";
    context.hitLocations = Object.entries(NEUROSHIMA.bodyLocations).map(([key, data]) => ({
        key: key,
        label: data.label,
        modifier: data.modifiers[weaponTypeKey]
    }));
    context.armorPenalty = armorPenalty;
    context.woundPenalty = woundPenalty;
    
    // State values
    context.isOpen = this.rollOptions.isOpen;
    context.baseDifficulty = this.rollOptions.difficulty;
    context.hitLocation = this.rollOptions.hitLocation;
    context.meleeAction = this.rollOptions.meleeAction;
    context.isMelee = this.rollType === "melee";
    context.aimingLevel = this.rollOptions.aimingLevel;
    context.burstLevel = this.rollOptions.burstLevel;
    context.percentageModifier = this.rollOptions.percentageModifier;
    context.applyArmorPenalty = this.rollOptions.useArmorPenalty;
    context.applyWoundPenalty = this.rollOptions.useWoundPenalty;
    context.rollMode = this.rollOptions.rollMode;
    context.rollModes = CONFIG.Dice.rollModes;
    
    // Auto-calculate distance if targets exist, otherwise use from options
    let distance = this.rollOptions.distance || 0;
    const targets = game.user.targets;
    
    // Jeśli nie mamy dystansu z opcji (czyli np. nie klikaliśmy na mapie), 
    // lub mamy aktywny target, przeliczamy dystans.
    if (targets.size > 0) {
        // Znajdź token reprezentujący aktora w taki sam sposób jak arkusz
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === this.actor.id && (t.controlled || !canvas.tokens.controlled.length));
        const targetToken = Array.from(targets)[0];
        if (actorToken && targetToken) {
            distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, targetToken);
        }
    }
    context.distance = distance;
    
    // Buttons for footer
    context.buttons = [
        {
            type: "submit",
            action: "roll",
            label: "NEUROSHIMA.Actions.Roll",
            class: "",
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
    
    // Handle disabled fields which are not in formData
    const aimingLevel = formData.aimingLevel !== undefined ? parseInt(formData.aimingLevel) : (this.rollOptions.aimingLevel || 0);
    const burstLevel = formData.burstLevel !== undefined ? parseInt(formData.burstLevel) : 0;

    // Update displays for sliders
    const aimingDisplay = html.querySelector('.aiming-display');
    const diceCountDisplay = html.querySelector('.dice-count');
    if (aimingDisplay) aimingDisplay.innerText = aimingLevel;
    if (diceCountDisplay) diceCountDisplay.innerText = aimingLevel + 1;

    const burstDisplay = html.querySelector('.burst-display');
    const bulletsCountDisplay = html.querySelector('.bullets-count');
    if (burstDisplay) burstDisplay.innerText = burstLevel;
    if (bulletsCountDisplay) {
        bulletsCountDisplay.innerText = game.neuroshima.NeuroshimaDice.getBulletsFired(this.weapon, burstLevel);
    }

    // Calculate total percentage
    const basePenalty = NEUROSHIMA.difficulties[formData.baseDifficulty]?.min || 0;
    const modifier = parseInt(formData.modifier) || 0;
    const armorPenalty = formData.useArmorPenalty ? (this.actor.system.combat?.totalArmorPenalty || 0) : 0;
    const woundPenalty = formData.useWoundPenalty ? (this.actor.system.combat?.totalWoundPenalty || 0) : 0;
    
    // Weapon bonus for melee
    let weaponBonus = 0;
    if (this.rollType === "melee") {
        const action = formData.meleeAction || "attack";
        weaponBonus = action === "attack" ? (this.weapon.system.attackBonus || 0) : (this.weapon.system.defenseBonus || 0);
    }

    const locationPenalty = game.neuroshima.NeuroshimaDice.getLocationPenalty(this.weapon.system.weaponType, formData.hitLocation);

    const totalPct = basePenalty + modifier + armorPenalty + woundPenalty + locationPenalty;

    // Update preview box
    const totalElement = html.querySelector('.total-modifier') || html.querySelector('#preview-total');
    if (totalElement) {
        let text = `${totalPct}%`;
        if (weaponBonus !== 0) {
            text += ` (${weaponBonus > 0 ? '+' : ''}${weaponBonus} ${game.i18n.localize("NEUROSHIMA.Roll.Summary")})`; // Simplified, using Summary as placeholder for 'Bonus' if needed
            // Actually, let's just show the bonus if it exists
            const bonusLabel = weaponBonus > 0 ? `+${weaponBonus}` : `${weaponBonus}`;
            text = `${totalPct}% [${bonusLabel}]`;
        }
        totalElement.innerText = text;
    }

    // Determine actual level
    const actualDiff = game.neuroshima.NeuroshimaDice.getDifficultyFromPercent(totalPct);
    const levelLabel = game.i18n.localize(actualDiff.label);
    
    // Apply skill-based Suwak shift for preview if setting is enabled
    const allowCombatShift = game.settings.get("neuroshima", "allowCombatShift");
    let previewLevelLabel = levelLabel;
    
    if (allowCombatShift) {
        const skillKey = this.weapon.system.skill;
        const baseSkillValue = skillKey ? (this.actor.system.skills[skillKey]?.value || 0) : 0;
        const skillBonus = parseInt(formData.skillBonus) || 0;
        const skillValue = baseSkillValue + skillBonus;
        const shift = game.neuroshima.NeuroshimaDice.getSkillShift(skillValue);
        
        if (shift !== 0) {
            const shifted = game.neuroshima.NeuroshimaDice._getShiftedDifficulty(actualDiff, -shift);
            previewLevelLabel = `${levelLabel} → ${game.i18n.localize(shifted.label)}`;
        }
    }

    const finalLevelElement = html.querySelector('.final-difficulty') || html.querySelector('#preview-final-level');
    if (finalLevelElement) finalLevelElement.innerText = previewLevelLabel;
  }

  async _onRoll(event, target) {
    const formData = new foundry.applications.ux.FormDataExtended(target.form).object;
    
    game.neuroshima.group("NeuroshimaWeaponRollDialog._onRoll");
    game.neuroshima.log("FormData object:", formData);
    game.neuroshima.groupEnd();
    
    // Save persistence data to actor
    await this.actor.update({
        "system.lastWeaponRoll": {
            isOpen: this.rollType === "melee" ? false : (formData.isOpen === "true"),
            difficulty: formData.baseDifficulty,
            meleeAction: formData.meleeAction,
            percentageModifier: parseInt(formData.modifier) || 0,
            useArmorPenalty: !!formData.useArmorPenalty,
            useWoundPenalty: !!formData.useWoundPenalty,
            rollMode: formData.rollMode
        }
    });

    // Logic for rolling will go here
    const burstLevel = formData.burstLevel !== undefined ? parseInt(formData.burstLevel) : 0;
    const aimingLevel = formData.aimingLevel !== undefined ? parseInt(formData.aimingLevel) : (this.rollOptions.aimingLevel || 0);

    const rollData = {
        weapon: this.weapon,
        actor: this.actor,
        targets: this.targets,
        isOpen: this.rollType === "melee" ? false : (formData.isOpen === "true"),
        meleeAction: formData.meleeAction,
        aimingLevel: aimingLevel,
        burstLevel: burstLevel,
        difficulty: formData.baseDifficulty, // This is selected base difficulty
        hitLocation: formData.hitLocation,
        modifier: parseInt(formData.modifier) || 0,
        applyArmor: !!formData.useArmorPenalty,
        applyWounds: !!formData.useWoundPenalty,
        skillBonus: parseInt(formData.skillBonus) || 0,
        attributeBonus: parseInt(formData.attributeBonus) || 0,
        distance: parseFloat(formData.distance) || 0,
        rollMode: formData.rollMode
    };

    this.close();
    return game.neuroshima.NeuroshimaDice.rollWeaponTest(rollData);
  }

  _onCancel(event, target) {
    this.close();
  }
}