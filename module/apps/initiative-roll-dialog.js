import { NEUROSHIMA } from "../config.js";
import { NeuroshimaScriptRunner } from "./neuroshima-script-engine.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Dialog for unified initiative rolls.
 * Uses WFRP-inspired re-render pattern: userEntry tracks user overrides,
 * scripts run fresh on every _prepareContext call - no DOM delta accumulation.
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
    this.meleeMode = options.meleeMode || "initiate";
    this.pendingId = options.pendingId || null;

    this.rollOptions = {
      attribute: options.attribute || "dexterity",
      skill: options.skill || "",
      useSkill: options.useSkill ?? true,
      modifier: options.modifier || 0,
      difficulty: options.difficulty || "average",
      useArmorPenalty: options.useArmorPenalty ?? false,
      useWoundPenalty: options.useWoundPenalty ?? true,
      useDiseasePenalty: options.useDiseasePenalty ?? true,
      rollMode: options.rollMode || game.settings.get("core", "rollMode")
    };

    this._onRollCallback = options.onRoll;
    this._onCloseCallback = options.onClose;

    this.userEntry = {};
    this.selectedModifierIds = new Set();
    this.unselectedModifierIds = new Set();
    this._dialogModifiers = [];
    this._scriptFields = { modifier: 0, attributeBonus: 0, skillBonus: 0, armorDelta: 0, woundDelta: 0, diseasePenalty: 0, difficulty: null, hitLocation: null };
    this._breakdown = { mod: [], attr: [], skill: [] };
    this._userValues = { modifier: 0, attributeBonus: 0, skillBonus: 0 };
  }

  /** @override */
  async close(options={}) {
    if (this._onCloseCallback) this._onCloseCallback();
    return super.close(options);
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "dialog", "standard-form", "roll-dialog-window", "roll-dialog", "initiative-roll-dialog"],
    position: { width: 480, height: "auto" },
    window: {
      resizable: false,
      minimizable: false
    },
    actions: {
      roll: NeuroshimaInitiativeRollDialog.prototype._onRoll,
      cancel: NeuroshimaInitiativeRollDialog.prototype._onCancel
    }
  };

  /** @override */
  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/dialog/initiative-roll-dialog.hbs"
    }
  };

  /** @override */
  get title() {
    return `${game.i18n.localize("NEUROSHIMA.Roll.RollInitiative")}: ${this.actor.name}`;
  }

  _computeActorDiseasePenalty() {
    return (this.actor?.items ?? [])
      .filter(i => i.type === "disease" && (i.system.diseaseType ?? "chronic") === "transient")
      .reduce((sum, i) => sum + (Number(i.system.transientPenalty) || 0), 0);
  }

  _buildTooltip(userVal, delta, breakdown) {
    if (!delta) return null;
    const sign = v => v >= 0 ? `+${v}` : `${v}`;
    const userLabel = game.i18n.localize("NEUROSHIMA.Roll.UserEntry");
    const effectLabel = game.i18n.localize("NEUROSHIMA.Roll.EffectBonus");
    const totalLabel = game.i18n.localize("NEUROSHIMA.Roll.Total");
    const parts = [`<strong>${userLabel}:</strong> ${sign(userVal)}`];
    if (breakdown.length) {
      parts.push(`<strong>${effectLabel}:</strong>`);
      for (const e of breakdown) parts.push(`&nbsp;&bull; ${e.label}: ${sign(e.value)}`);
    }
    parts.push(`<strong>${totalLabel}:</strong> ${sign(userVal + delta)}`);
    return parts.join("<br>");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const actorArmorPenalty = this.actor.system.combat?.totalArmorPenalty || 0;
    const actorWoundPenalty = this.actor.system.combat?.totalWoundPenalty || 0;
    const actorDiseasePenalty = this._computeActorDiseasePenalty();

    const userModifier    = this.userEntry.modifier       ?? this.rollOptions.modifier ?? 0;
    const userAttrBonus   = this.userEntry.attributeBonus ?? 0;
    const userSkillBonus  = this.userEntry.skillBonus     ?? 0;
    const useSkill        = this.userEntry.useSkill       ?? this.rollOptions.useSkill ?? true;
    const difficulty      = this.userEntry.difficulty     ?? this.rollOptions.difficulty ?? "average";
    const attribute       = this.userEntry.attribute      ?? this.rollOptions.attribute ?? "dexterity";
    const skill           = this.userEntry.skill          ?? this.rollOptions.skill ?? "";
    const useArmorPenalty   = this.userEntry.useArmorPenalty   ?? this.rollOptions.useArmorPenalty   ?? false;
    const useWoundPenalty   = this.userEntry.useWoundPenalty   ?? this.rollOptions.useWoundPenalty   ?? true;
    const useDiseasePenalty = this.userEntry.useDiseasePenalty ?? this.rollOptions.useDiseasePenalty ?? true;
    const rollMode          = this.userEntry.rollMode          ?? this.rollOptions.rollMode;

    const initAttrValue = this.actor.system.attributeTotals?.[attribute] ?? 0;
    const initAttrObj = { name: attribute, value: initAttrValue, key: attribute };
    const initSkillValue = skill ? (this.actor.system.skills?.[skill]?.value ?? 0) : 0;
    const initSkillObj = skill ? { name: game.i18n.localize(`NEUROSHIMA.Skills.${skill}`) || skill, value: initSkillValue, key: skill } : null;

    const targetActors = Array.from(game.user.targets || []).map(t => t.actor).filter(Boolean);
    const { dialogModifiers, scriptFields, modBreakdown, attrBreakdown, skillBreakdown } = await NeuroshimaScriptRunner.computeDialogFields(
      this.actor,
      { rollType: "initiative", isMelee: this.isMelee, skill: initSkillObj, attribute: initAttrObj, difficulty },
      this.selectedModifierIds,
      this.unselectedModifierIds,
      targetActors
    );

    this._dialogModifiers = dialogModifiers;
    this._scriptFields = scriptFields;
    this._breakdown = { mod: modBreakdown, attr: attrBreakdown, skill: skillBreakdown };
    this._userValues = { modifier: userModifier, attributeBonus: userAttrBonus, skillBonus: userSkillBonus };

    const equippedWeapon = this.actor.items.find(i => i.type === "weapon" && i.system.equipped);
    const weaponSkillKey = equippedWeapon?.system.skill;
    const skills = {};
    const isCreature = this.actor?.type === "creature";
    if (isCreature) {
      const expVal = this.actor.system.experience ?? 0;
      skills["experience"] = { key: "experience", label: game.i18n.localize("NEUROSHIMA.Creature.Experience"), value: expVal };
    } else {
      for (const [key, sk] of Object.entries(this.actor.system.skills)) {
        let label = game.i18n.localize(`NEUROSHIMA.Skills.${key}`);
        if (key === weaponSkillKey) label = `+ ${label}`;
        skills[key] = { key, label, value: sk.value || 0 };
      }
    }

    context.actor = this.actor;
    context.attributes = NEUROSHIMA.attributes;
    context.difficulties = NEUROSHIMA.difficulties;
    context.isMelee = this.isMelee;
    context.skills = skills;
    context.weaponSkillKey = isCreature ? "experience" : weaponSkillKey;

    context.modifier      = userModifier + scriptFields.modifier;
    context.attributeBonus= userAttrBonus + scriptFields.attributeBonus;
    context.skillBonus    = userSkillBonus + scriptFields.skillBonus;
    context.armorPenalty  = actorArmorPenalty + scriptFields.armorDelta;
    context.woundPenalty  = actorWoundPenalty + scriptFields.woundDelta;
    context.diseasePenalty = actorDiseasePenalty + (scriptFields.diseasePenalty || 0);
    context.useDiseasePenalty = useDiseasePenalty;

    let effectDifficulty = (scriptFields.difficulty && this.userEntry.difficulty === undefined)
      ? scriptFields.difficulty : difficulty;
    if (scriptFields.difficultyShift) {
      effectDifficulty = NeuroshimaScriptRunner.shiftDifficultyKey(effectDifficulty, scriptFields.difficultyShift);
    }
    context.currentDifficulty = effectDifficulty;
    context.currentAttribute = attribute;
    context.currentSkill = skill;
    context.useSkill = useSkill;
    context.useArmorPenalty = useArmorPenalty;
    context.useWoundPenalty = useWoundPenalty;
    context.rollMode = rollMode;
    context.rollModes = CONFIG.Dice.rollModes;
    context.dialogModifiers = dialogModifiers;

    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    this._applyTooltips(html);
    this._updatePreview(html);

    html.querySelectorAll('[data-action="clickModifier"].dm-toggleable').forEach(li => {
      li.addEventListener('click', () => {
        const effectId = li.dataset.dmEffectId;
        if (!effectId) return;
        const isActive = li.classList.contains('dm-active');
        if (isActive) {
          this.selectedModifierIds.delete(effectId);
          this.unselectedModifierIds.add(effectId);
        } else {
          this.unselectedModifierIds.delete(effectId);
          this.selectedModifierIds.add(effectId);
        }
        this.render();
      });
    });

    html.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('change', ev => this._onFieldChange(ev));
    });

    const useSkillCb = html.querySelector('[name="useSkill"]');
    const skillSelect = html.querySelector('select[name="skill"]');
    const skillBonusInput = html.querySelector('input[name="skillBonus"]');
    if (useSkillCb && skillSelect) {
      useSkillCb.addEventListener('change', () => {
        skillSelect.disabled = !useSkillCb.checked;
        if (skillBonusInput) skillBonusInput.disabled = !useSkillCb.checked;
      });
    }

    const maneuverSelect = html.querySelector('[name="maneuver"]');
    const chargeWrapper = html.querySelector('.charge-level-wrapper');
    if (maneuverSelect && chargeWrapper) {
      maneuverSelect.addEventListener('change', () => {
        chargeWrapper.hidden = maneuverSelect.value !== 'charge';
      });
    }

    const cancelBtn = html.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', ev => {
        ev.preventDefault();
        this.close();
      });
    }
  }

  _onFieldChange(ev) {
    const el = ev.currentTarget;
    const name = el.name;
    if (!name) return;
    let value = el.value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'number' || el.type === 'range') value = Number(value);
    this.userEntry[name] = value;
    this.render();
  }

  _applyTooltips(html) {
    const sf = this._scriptFields;
    const uv = this._userValues;
    if (!sf || !uv) return;
    const bd = this._breakdown;

    const set = (name, tooltip) => {
      const el = html.querySelector(`[name="${name}"]`);
      if (!el) return;
      if (tooltip) el.dataset.tooltip = tooltip;
      else delete el.dataset.tooltip;
    };

    set('modifier',       this._buildTooltip(uv.modifier,       sf.modifier,       bd.mod));
    set('attributeBonus', this._buildTooltip(uv.attributeBonus, sf.attributeBonus, bd.attr));
    set('skillBonus',     this._buildTooltip(uv.skillBonus,     sf.skillBonus,     bd.skill));

    const sign = v => v >= 0 ? `+${v}` : `${v}`;
    const actorArmor = this.actor.system.combat?.totalArmorPenalty || 0;
    const actorWound = this.actor.system.combat?.totalWoundPenalty || 0;
    const userLabel = game.i18n.localize("NEUROSHIMA.Roll.UserEntry");
    const effectLabel = game.i18n.localize("NEUROSHIMA.Roll.EffectBonus");
    const totalLabel = game.i18n.localize("NEUROSHIMA.Roll.Total");
    if (sf.armorDelta) {
      set('armorPenalty', `<strong>${userLabel}:</strong> ${sign(actorArmor)}<br><strong>${effectLabel}:</strong> ${sign(sf.armorDelta)}<br><strong>${totalLabel}:</strong> ${sign(actorArmor + sf.armorDelta)}`);
    } else {
      set('armorPenalty', null);
    }
    if (sf.woundDelta) {
      set('woundPenalty', `<strong>${userLabel}:</strong> ${sign(actorWound)}<br><strong>${effectLabel}:</strong> ${sign(sf.woundDelta)}<br><strong>${totalLabel}:</strong> ${sign(actorWound + sf.woundDelta)}`);
    } else {
      set('woundPenalty', null);
    }
    const actorDisease = this._computeActorDiseasePenalty();
    if (sf.diseasePenalty) {
      set('diseasePenalty', `<strong>${userLabel}:</strong> ${sign(actorDisease)}<br><strong>${effectLabel}:</strong> ${sign(sf.diseasePenalty)}<br><strong>${totalLabel}:</strong> ${sign(actorDisease + sf.diseasePenalty)}`);
    } else {
      set('diseasePenalty', null);
    }
  }

  _updatePreview(html) {
    if (!html) html = this.element;

    const sf = this._scriptFields || {};
    const uv = this._userValues || {};

    const userModifier    = uv.modifier       ?? 0;
    const userAttrBonus   = uv.attributeBonus ?? 0;
    const userSkillBonus  = uv.skillBonus     ?? 0;
    const modifier        = userModifier + (sf.modifier || 0);
    const attrBonus       = userAttrBonus + (sf.attributeBonus || 0);
    const skillBonus      = userSkillBonus + (sf.skillBonus || 0);

    let difficultyKey = (sf.difficulty && this.userEntry.difficulty === undefined)
      ? sf.difficulty : (this.userEntry.difficulty ?? this.rollOptions.difficulty ?? "average");
    if (sf.difficultyShift) {
      difficultyKey = NeuroshimaScriptRunner.shiftDifficultyKey(difficultyKey, sf.difficultyShift);
    }

    const attribute       = this.userEntry.attribute ?? this.rollOptions.attribute ?? "dexterity";
    const skill           = this.userEntry.skill ?? this.rollOptions.skill ?? "";
    const useSkill        = this.userEntry.useSkill ?? this.rollOptions.useSkill ?? true;
    const useArmorPenalty = this.userEntry.useArmorPenalty ?? this.rollOptions.useArmorPenalty ?? false;
    const useWoundPenalty = this.userEntry.useWoundPenalty ?? this.rollOptions.useWoundPenalty ?? true;

    const actorArmorPenalty = this.actor.system.combat?.totalArmorPenalty || 0;
    const actorWoundPenalty = this.actor.system.combat?.totalWoundPenalty || 0;
    const armorPenalty   = useArmorPenalty   ? (actorArmorPenalty + (sf.armorDelta || 0)) : 0;
    const woundPenalty   = useWoundPenalty   ? (actorWoundPenalty + (sf.woundDelta || 0)) : 0;
    const useDiseasePenalty = this.userEntry.useDiseasePenalty ?? this.rollOptions.useDiseasePenalty ?? true;
    const diseasePenalty = useDiseasePenalty ? (this._computeActorDiseasePenalty() + (sf.diseasePenalty || 0)) : 0;

    const basePenalty = NEUROSHIMA.difficulties[difficultyKey]?.min || 0;
    const totalPct = basePenalty + modifier + armorPenalty + woundPenalty + diseasePenalty;

    const totalElement = html.querySelector('.total-modifier');
    if (totalElement) totalElement.innerText = `${totalPct}%`;

    const attrTotal = Number(this.actor.system.attributeTotals?.[attribute]) || 0;

    const isCreature = this.actor?.type === "creature";
    const skillValue = useSkill
      ? (skill === "experience" && isCreature
        ? (this.actor.system.experience ?? 0)
        : (Number(this.actor.system.skills?.[skill]?.value) || 0))
      : 0;
    const finalSkill = skillValue + (useSkill ? skillBonus : 0);
    const skillShift = (finalSkill <= 0) ? -1 : Math.floor(finalSkill / 4);

    const baseDifficulty = game.neuroshima.NeuroshimaDice.getDifficultyFromPercent(totalPct);
    const order = ["easy", "average", "problematic", "hard", "veryHard", "damnHard", "luck", "masterful", "grandmasterful"];
    const baseDiffKey = Object.keys(NEUROSHIMA.difficulties).find(key => NEUROSHIMA.difficulties[key].label === baseDifficulty.label);
    const baseDiffIndex = order.indexOf(baseDiffKey);
    const shiftedIndex = Math.max(0, Math.min(order.length - 1, baseDiffIndex - skillShift));
    const shiftedDifficulty = NEUROSHIMA.difficulties[order[shiftedIndex]];

    const shiftedElement = html.querySelector('.shifted-difficulty');
    if (shiftedElement) shiftedElement.innerText = game.i18n.localize(shiftedDifficulty.label);

    const targetElement = html.querySelector('.final-target');
    if (targetElement) targetElement.innerText = attrTotal + attrBonus + shiftedDifficulty.mod;

    const chargeWrapper = html.querySelector('.charge-level-wrapper');
    const maneuverSelect = html.querySelector('[name="maneuver"]');
    if (chargeWrapper && maneuverSelect) {
      chargeWrapper.hidden = maneuverSelect.value !== 'charge';
    }
  }

  async _onRoll(event, target) {
    const html = this.element;
    const form = html.tagName === "FORM" ? html : html.querySelector('form');
    if (!form) return;
    const formData = new foundry.applications.ux.FormDataExtended(form).object;

    const sf = this._scriptFields || {};
    const uv = this._userValues || {};
    const userModifier   = uv.modifier       ?? 0;
    const userAttrBonus  = uv.attributeBonus ?? 0;
    const userSkillBonus = uv.skillBonus     ?? 0;

    const combinedModifier    = userModifier + (sf.modifier || 0);
    const combinedAttrBonus   = userAttrBonus + (sf.attributeBonus || 0);
    const combinedSkillBonus  = userSkillBonus + (sf.skillBonus || 0);

    let difficultyKey = (sf.difficulty && this.userEntry.difficulty === undefined)
      ? sf.difficulty : (this.userEntry.difficulty ?? this.rollOptions.difficulty ?? "average");
    if (sf.difficultyShift) {
      difficultyKey = NeuroshimaScriptRunner.shiftDifficultyKey(difficultyKey, sf.difficultyShift);
    }

    const useArmor   = this.userEntry.useArmorPenalty   ?? this.rollOptions.useArmorPenalty   ?? false;
    const useWound   = this.userEntry.useWoundPenalty   ?? this.rollOptions.useWoundPenalty   ?? true;
    const useDisease = this.userEntry.useDiseasePenalty ?? this.rollOptions.useDiseasePenalty ?? true;
    const actorArmorPenalty = this.actor.system.combat?.totalArmorPenalty || 0;
    const actorWoundPenalty = this.actor.system.combat?.totalWoundPenalty || 0;

    const submissionOptions = {};
    for (const dm of this._dialogModifiers) {
      if (!dm.activated || !dm._script?.submissionScript) continue;
      await dm._script.runSubmission({ actor: this.actor, options: submissionOptions, fields: this._scriptFields });
    }

    const rollData = {
      attribute: this.userEntry.attribute ?? this.rollOptions.attribute ?? "dexterity",
      skill: this.userEntry.skill ?? this.rollOptions.skill ?? "",
      useSkill: this.userEntry.useSkill ?? this.rollOptions.useSkill ?? true,
      difficulty: difficultyKey,
      modifier: combinedModifier,
      useArmorPenalty: useArmor,
      useWoundPenalty: useWound,
      useDiseasePenalty: useDisease,
      diseasePenalty: useDisease ? this._computeActorDiseasePenalty() + (sf.diseasePenalty || 0) : 0,
      skillBonus: combinedSkillBonus,
      attributeBonus: combinedAttrBonus,
      maneuver: formData.maneuver || "none",
      chargeLevel: parseInt(formData.chargeLevel) || 0,
      rollMode: this.userEntry.rollMode ?? this.rollOptions.rollMode
    };

    await this.actor.update({
      "system.lastRoll": {
        modifier: userModifier,
        difficulty: difficultyKey,
        useArmorPenalty: useArmor,
        useWoundPenalty: useWound,
        rollMode: rollData.rollMode
      }
    }).catch(() => {});

    this.close();

    const result = await this._performRoll({ ...rollData, options: submissionOptions });

    game.neuroshima?.log("Initiative roll completed", { actor: this.actor.name, successPoints: result?.successPoints, rollData });

    if (this.combatant && !this.isMelee) {
      await this.combatant.update({ initiative: result.successPoints });
    }

    if (this.isMelee && result && this.meleeMode === "initiate") {
      if (!this.duelId && !this.encounterId && this.targets && this.targets.length === 1) {
        const rawTarget = this.targets[0];
        let targetDoc = typeof rawTarget === "string" ? fromUuidSync(rawTarget) : rawTarget;
        const targetActor = targetDoc?.actor || targetDoc;
        if (targetActor?.getFlag) {
          const { MeleeEncounter } = await import("../combat/melee-encounter.js");
          const { MeleeStore } = await import("../combat/melee-store.js");
          const activeEncounterId = targetActor.getFlag("neuroshima", "activeMeleeEncounter");
          const activeEncounter = activeEncounterId ? MeleeStore.getEncounter(activeEncounterId) : null;
          if (activeEncounter) {
            await MeleeEncounter.join(activeEncounterId, {
              id: this.actor.uuid, actorUuid: this.actor.uuid, tokenUuid: this.actor.token?.uuid,
              actorId: this.actor.id, name: this.actor.name, img: this.actor.img,
              weaponId: this.weaponId, initiative: result.successPoints, chargeLevel: rollData.chargeLevel
            }, "A");
          } else {
            if (activeEncounterId) await targetActor.unsetFlag("neuroshima", "activeMeleeEncounter");
            const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
            await NeuroshimaMeleeCombat.initiateMeleePending(
              this.actor.uuid, targetActor.uuid, result.successPoints,
              this.weaponId, rollData.maneuver, rollData.chargeLevel
            );
          }
        }
      }
    }

    return result;
  }

  async _performRoll(rollData) {
    if (this._onRollCallback) return this._onRollCallback(rollData);
    return game.neuroshima.NeuroshimaDice.rollInitiative({ ...rollData, actor: this.actor });
  }

  _onCancel(event, target) {
    this.close();
  }

  /** @override */
  _prepareSubmitData(event, form, formData) {
    return super._prepareSubmitData(event, form, formData);
  }
}
