import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/dice.js";
import { NeuroshimaScriptRunner } from "./neuroshima-script-engine.js";
import { NeuroshimaRollDialogBase } from "./roll-dialog-base.js";

/**
 * Helper: Get healing difficulty based on wound damage type from world settings.
 */
function getHealingDifficulty(damageType) {
  const diffs = game.settings.get("neuroshima", "healingDifficulties");
  return diffs?.[damageType] ?? "average";
}

/**
 * Helper: Get healing reduction percent based on method and wound history.
 * First Aid: 5%
 * Treat Wounds: 15% (fresh) or 10% (had First Aid already)
 */
function getHealingPercent(healingMethod, hadFirstAid = false) {
  if (healingMethod === "firstAid") return 5;
  return hadFirstAid ? 10 : 15;
}

/**
 * Dialog for healing rolls.
 *
 * ## Script Integration
 *
 * Scripts with trigger `dialog` are evaluated when this dialog opens.
 * Use `rollType === "healing"` to target this dialog.
 *
 * ### args.fields available to dialog scripts:
 * ```
 * rollType:      "healing"
 * healingMethod: "firstAid" | "woundTreatment"
 * attribute:     { name: string, value: number, key: string }
 * skill:         { name: string, value: number, key: string }
 * wounds:        Array<{ id, name, damageType, hadFirstAid }>
 * stat:          number  // attribute total value
 * ```
 *
 * ### Supported script return fields:
 * - modifier, attributeBonus, skillBonus
 * - armorDelta, woundDelta, diseasePenalty
 * - difficultyShift
 *
 * @example Script condition to target healing rolls only:
 * ```js
 * return args.rollType === "healing";
 * ```
 */
export class NeuroshimaHealingRollDialog extends NeuroshimaRollDialogBase {
  constructor(options = {}) {
    super(options);
    this.medicActor  = options.medicActor  ?? options.actor ?? null;
    this.patientActor = options.patientActor ?? null;
    this.wounds      = options.wounds || [];

    const lastRoll = options.lastRoll || {};

    this._woundGroupMap = this._buildWoundGroupMap(this.wounds, lastRoll);

    this.rollOptions = {
      healingMethod:     lastRoll.healingMethod     || "firstAid",
      currentAttribute:  lastRoll.currentAttribute  || "cleverness",
      percentageModifier: lastRoll.percentageModifier || 0,
      useArmorPenalty:   lastRoll.useArmorPenalty   ?? false,
      useWoundPenalty:   lastRoll.useWoundPenalty   ?? true,
      useDiseasePenalty: lastRoll.useDiseasePenalty ?? true,
      skillBonus:        lastRoll.skillBonus        || 0,
      attributeBonus:    lastRoll.attributeBonus    || 0,
    };
  }

  _buildWoundGroupMap(wounds, lastRoll) {
    const map = {};
    const method = lastRoll.healingMethod || "firstAid";
    wounds.forEach(wound => {
      const dt = wound.damageType;
      if (!map[dt]) {
        map[dt] = {
          damageType: dt,
          count: 0,
          difficulty: getHealingDifficulty(dt),
          healingPercent: getHealingPercent(method, wound.hadFirstAid),
          woundList: []
        };
      }
      map[dt].count++;
      map[dt].woundList.push(wound);
    });
    return map;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "dialog", "standard-form", "roll-dialog-window", "roll-dialog", "healing-roll-dialog"],
    position: { width: 540, height: "auto" },
    window: {
      resizable: false,
      minimizable: false
    },
    actions: {
      roll: NeuroshimaHealingRollDialog.prototype._onRoll,
      cancel: NeuroshimaHealingRollDialog.prototype._onCancel
    }
  };

  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/dialog/healing-roll-dialog.hbs"
    }
  };

  get title() {
    const patientName = this.patientActor?.name ?? "";
    return `${game.i18n.localize("NEUROSHIMA.HealingRequest.Title")}${patientName ? " - " + patientName : ""}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const medicActor = this.medicActor;
    const actorArmorPenalty  = medicActor.system.combat?.totalArmorPenalty || 0;
    const actorWoundPenalty  = medicActor.system.combat?.totalWoundPenalty || 0;
    const actorDiseasePenalty = this._computeActorDiseasePenalty();

    const healingMethod    = this.userEntry.healingMethod    ?? this.rollOptions.healingMethod    ?? "firstAid";
    const currentAttribute = this.userEntry.attribute        ?? this.rollOptions.currentAttribute ?? "cleverness";
    const userModifier     = this.userEntry.modifier         ?? this.rollOptions.percentageModifier ?? 0;
    const userAttrBonus    = this.userEntry.attributeBonus   ?? this.rollOptions.attributeBonus    ?? 0;
    const userSkillBonus   = this.userEntry.skillBonus       ?? this.rollOptions.skillBonus        ?? 0;
    const useArmorPenalty  = this.userEntry.useArmorPenalty  ?? this.rollOptions.useArmorPenalty   ?? false;
    const useWoundPenalty  = this.userEntry.useWoundPenalty  ?? this.rollOptions.useWoundPenalty   ?? true;
    const useDiseasePenalty = this.userEntry.useDiseasePenalty ?? this.rollOptions.useDiseasePenalty ?? true;

    const skillName  = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
    const skillValue = medicActor.system.skills?.[skillName]?.value || 0;
    const skillObj   = { name: game.i18n.localize(`NEUROSHIMA.Skills.${skillName}`), value: skillValue, key: skillName };
    const attrValue  = medicActor.system.attributeTotals?.[currentAttribute] ?? 0;
    const attrObj    = { name: currentAttribute, value: attrValue, key: currentAttribute };

    const targetActors = Array.from(game.user.targets || []).map(t => t.actor).filter(Boolean);
    const { dialogModifiers, scriptFields, modBreakdown, attrBreakdown, skillBreakdown } = await NeuroshimaScriptRunner.computeDialogFields(
      medicActor,
      {
        rollType: "healing",
        healingMethod,
        attribute: attrObj,
        skill: skillObj,
        wounds: this.wounds,
        stat: attrValue
      },
      this.selectedModifierIds,
      this.unselectedModifierIds,
      targetActors
    );

    this._dialogModifiers = dialogModifiers;
    this._scriptFields    = scriptFields;
    this._breakdown       = { mod: modBreakdown, attr: attrBreakdown, skill: skillBreakdown };
    this._userValues      = { modifier: userModifier, attributeBonus: userAttrBonus, skillBonus: userSkillBonus };

    const sfHealAll   = scriptFields.healingModifierAll  || 0;
    const sfHealDt    = scriptFields.healingModifier     || {};
    const sfBreakdown = scriptFields.healingModBreakdown || [];

    const woundGroups = Object.values(this._woundGroupMap).map(group => {
      const dt               = group.damageType;
      const selDiff          = this.userEntry[`difficulty-${dt}`] ?? group.difficulty;
      const selWoundMod      = this.userEntry[`woundModifier-${dt}`] ?? 0;
      const healPct          = getHealingPercent(healingMethod, group.woundList[0]?.hadFirstAid);
      const scriptHealingMod = sfHealAll + (sfHealDt[dt] || 0);
      const tooltipLines = sfBreakdown
        .map(b => {
          const val = (b.healingModifierAll || 0) + (b.healingModifier[dt] || 0);
          return val !== 0 ? `${b.label}: ${val > 0 ? "+" : ""}${val}%` : null;
        })
        .filter(Boolean);
      const healingTooltip = tooltipLines.length > 0 ? tooltipLines.join("\n") : null;
      return { ...group, difficulty: selDiff, healingPercent: healPct, woundModifier: selWoundMod + scriptHealingMod, scriptHealingMod, healingTooltip };
    });

    context.actor             = medicActor;
    context.patientActor      = this.patientActor;
    context.woundGroups       = woundGroups;
    context.woundGroupCount   = woundGroups.length;
    context.totalWounds       = this.wounds.length;
    context.healingMethod     = healingMethod;
    context.currentAttribute  = currentAttribute;
    context.attributeList     = NEUROSHIMA.attributes;
    context.difficulties      = NEUROSHIMA.difficulties;
    context.modifier          = userModifier + scriptFields.modifier;
    context.attributeBonus    = userAttrBonus + scriptFields.attributeBonus;
    context.skillBonus        = userSkillBonus + scriptFields.skillBonus;
    context.armorPenalty      = actorArmorPenalty + scriptFields.armorDelta;
    context.woundPenalty      = actorWoundPenalty + scriptFields.woundDelta;
    context.diseasePenalty    = actorDiseasePenalty + (scriptFields.diseasePenalty || 0);
    context.showDiseasePenalty = context.diseasePenalty > 0;
    context.useArmorPenalty   = useArmorPenalty;
    context.useWoundPenalty   = useWoundPenalty;
    context.useDiseasePenalty = useDiseasePenalty;
    context.dialogModifiers   = dialogModifiers;

    return context;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const html = this.element;

    this._applyTooltips(html);
    this._updateSummary(html);

    html.querySelectorAll('[data-action="clickModifier"].dm-toggleable').forEach(li => {
      li.addEventListener('click', () => {
        const effectId = li.dataset.dmEffectId;
        if (!effectId) return;
        if (li.classList.contains('dm-active')) {
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

    html.querySelectorAll('input[type="number"]').forEach(el => {
      el.addEventListener('input', () => this._updateSummary(html));
    });

    const cancelBtn = html.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', ev => {
        ev.preventDefault();
        this.close();
      });
    }

    const allModInput = html.querySelector('.wound-modifier-all');
    if (allModInput) {
      allModInput.addEventListener('input', () => {
        const val = allModInput.value;
        const numVal = parseInt(val) || 0;
        html.querySelectorAll('.wound-modifier:not(.wound-modifier-all)').forEach(input => {
          input.value = val;
          const dt = input.dataset.damageType;
          if (dt) this.userEntry[`woundModifier-${dt}`] = numVal;
        });
        this._updateSummary(html);
      });
    }
  }

  _updateSummary(html) {
    if (!html) html = this.element;

    const healingMethod  = html.querySelector('[name="healingMethod"]')?.value  ?? this.rollOptions.healingMethod ?? "firstAid";
    const modifier       = parseInt(html.querySelector('[name="modifier"]')?.value ?? 0) || 0;
    const useArmor       = html.querySelector('[name="useArmorPenalty"]')?.checked  ?? this.rollOptions.useArmorPenalty  ?? false;
    const useWound       = html.querySelector('[name="useWoundPenalty"]')?.checked  ?? this.rollOptions.useWoundPenalty  ?? true;
    const useDisease     = html.querySelector('[name="useDiseasePenalty"]')?.checked ?? this.rollOptions.useDiseasePenalty ?? true;

    const medicActor = this.medicActor;
    const sf = this._scriptFields || {};

    const armorPenalty   = useArmor   ? (medicActor.system.combat?.totalArmorPenalty  || 0) + (sf.armorDelta   || 0) : 0;
    const woundPenalty   = useWound   ? (medicActor.system.combat?.totalWoundPenalty  || 0) + (sf.woundDelta   || 0) : 0;
    const diseasePenalty = useDisease ? this._computeActorDiseasePenalty() + (sf.diseasePenalty || 0) : 0;

    const diffModifier = modifier + armorPenalty + woundPenalty + diseasePenalty + (sf.modifier || 0);

    const diffModEl = html.querySelector('.difficulty-modifier');
    if (diffModEl) diffModEl.innerText = `${diffModifier >= 0 ? '+' : ''}${diffModifier}%`;

    const diffShift = sf.difficultyShift || 0;

    const woundGroups = Object.values(this._woundGroupMap);
    const diffParts = [];
    woundGroups.forEach(group => {
      const dt         = group.damageType;
      const selDiffKey = html.querySelector(`[name="difficulty-${dt}"]`)?.value ?? group.difficulty;
      const diffData   = NEUROSHIMA.difficulties[selDiffKey] || NEUROSHIMA.difficulties.average;
      const totalPct   = (diffData.min || 0) + diffModifier;
      const adjusted   = NeuroshimaDice.getDifficultyFromPercent(totalPct);
      const adjustedKey = Object.entries(NEUROSHIMA.difficulties).find(([, v]) => v === adjusted)?.[0] ?? selDiffKey;
      const shiftedKey  = diffShift ? NeuroshimaScriptRunner.shiftDifficultyKey(adjustedKey, diffShift) : adjustedKey;
      const finalDiff   = NEUROSHIMA.difficulties[shiftedKey] || adjusted;
      diffParts.push(`${group.count}x ${game.i18n.localize(finalDiff.label)}`);

      const healPct  = getHealingPercent(healingMethod, group.woundList[0]?.hadFirstAid);
      const pctEl    = html.querySelector(`.wound-healing-percent[data-damage-type="${dt}"]`);
      if (pctEl) pctEl.innerText = `${healPct >= 0 ? '+' : ''}${healPct}%`;
    });

    const finalDiffEl = html.querySelector('.final-difficulty');
    if (finalDiffEl) finalDiffEl.innerText = diffParts.join(', ') || '—';
  }

  async _onRoll(event, target) {
    const html = this.element;
    const form = html.tagName === "FORM" ? html : html.querySelector('form');
    const formData = new foundry.applications.ux.FormDataExtended(form).object;

    const healingMethod  = formData.healingMethod || "firstAid";
    const selectedAttr   = formData.attribute     || "cleverness";
    const globalModifier = parseInt(formData.modifier) || 0;
    const useArmor       = formData.useArmorPenalty  === true || formData.useArmorPenalty  === "true";
    const useWound       = formData.useWoundPenalty  === true || formData.useWoundPenalty  === "true";
    const skillBonus     = parseInt(formData.skillBonus)     || 0;
    const attributeBonus = parseInt(formData.attributeBonus) || 0;

    const medicActor   = this.medicActor;
    const armorPenalty = medicActor.system.combat?.totalArmorPenalty || 0;
    const woundPenalty = medicActor.system.combat?.totalWoundPenalty || 0;

    const sf = this._scriptFields || {};
    const sfHealAll = sf.healingModifierAll || 0;
    const sfHealDt  = sf.healingModifier    || {};

    const woundGroups = Object.values(this._woundGroupMap);
    const woundConfigs = [];
    woundGroups.forEach(group => {
      const dt                   = group.damageType;
      const scriptHealingModifier = sfHealAll + (sfHealDt[dt] || 0);
      const userHealingMod       = (parseInt(formData[`woundModifier-${dt}`]) || 0) - scriptHealingModifier;
      const selDifficulty        = formData[`difficulty-${dt}`] || group.difficulty;
      const difficultyMod        = globalModifier + (useArmor ? armorPenalty : 0) + (useWound ? woundPenalty : 0);

      group.woundList.forEach(wound => {
        const failedAttempts = healingMethod === "firstAid"
          ? (wound.failedFirstAidAttempts || 0)
          : (wound.failedTreatmentAttempts || 0);
        woundConfigs.push({
          woundId:              wound.id,
          woundName:            wound.name,
          damageType:           wound.damageType,
          difficulty:           selDifficulty,
          modifier:             difficultyMod,
          healingModifier:      userHealingMod,
          scriptHealingModifier,
          hadFirstAid:          wound.hadFirstAid || false,
          failedAttempts
        });
      });
    });

    await medicActor.update({
      "system.lastRoll": {
        percentageModifier: globalModifier,
        healingMethod,
        currentAttribute: selectedAttr,
        useArmorPenalty: useArmor,
        useWoundPenalty: useWound,
        skillBonus,
        attributeBonus
      }
    });

    const attrValue = medicActor.system.attributeTotals[selectedAttr];

    await NeuroshimaDice.rollBatchHealingTests({
      medicActor,
      patientActor: this.patientActor,
      healingMethod,
      woundConfigs,
      stat: attrValue,
      skillBonus,
      attributeBonus
    });

    await this.close();
  }

  async _onCancel(event, target) {
    await this.close();
  }
}

/**
 * Open the healing roll dialog.
 *
 * @param {object} options
 * @param {Actor}  options.medicActor   - The medic performing the healing.
 * @param {Actor}  options.patientActor - The patient being healed.
 * @param {Array}  options.wounds       - Array of wound data objects.
 * @param {object} options.lastRoll     - Last roll options for persistence.
 */
export async function showHealingRollDialog({ medicActor, patientActor, wounds = [], lastRoll = {} }) {
  const dialog = new NeuroshimaHealingRollDialog({
    actor:        medicActor,
    medicActor,
    patientActor,
    wounds,
    lastRoll
  });
  dialog.render(true);
  return dialog;
}
