
import { NEUROSHIMA } from "../config.js";
import { getDistancePenalty } from "./distance-config.js";
import { NeuroshimaScriptRunner } from "./neuroshima-script-engine.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Dialog for weapon rolls (ranged and melee).
 * Uses WFRP-inspired re-render pattern: userEntry tracks user overrides,
 * scripts run fresh on every _prepareContext call - no DOM delta accumulation.
 */
export class NeuroshimaWeaponRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options={}) {
    super(options);
    this.actor = options.actor;
    this.weapon = options.weapon;
    this.rollType = options.rollType || "ranged";
    this.targets = options.targets || [];
    const lastRoll = options.lastRoll || {};

    this.rollOptions = {
      isOpen: lastRoll.isOpen ?? false,
      difficulty: lastRoll.difficulty || "average",
      hitLocation: "random",
      meleeAction: options.meleeAction || lastRoll.meleeAction || "attack",
      maneuver: lastRoll.maneuver || "none",
      tempoLevel: lastRoll.tempoLevel || 1,
      aimingLevel: this.rollType === "melee" ? 2 : (lastRoll.aimingLevel || 0),
      burstLevel: 0,
      percentageModifier: lastRoll.percentageModifier || 0,
      useArmorPenalty: lastRoll.useArmorPenalty ?? true,
      useWoundPenalty: lastRoll.useWoundPenalty ?? true,
      distance: lastRoll.distance || 0,
      distancePenalty: lastRoll.distancePenalty || 0,
      rollMode: lastRoll.rollMode || game.settings.get("core", "rollMode")
    };

    this.isPoolRoll = options.isPoolRoll || false;
    this.onPoolRoll = options.onRoll;
    this._onCloseCallback = options.onClose;
    this.crowdingDexPenalty = options.crowdingDexPenalty || 0;

    this.userEntry = {};
    this.selectedModifierIds = new Set();
    this.unselectedModifierIds = new Set();
    this._dialogModifiers = [];
    this._scriptFields = { modifier: 0, attributeBonus: 0, skillBonus: 0, armorDelta: 0, woundDelta: 0, difficulty: null, hitLocation: null };
    this._breakdown = { mod: [], attr: [], skill: [] };
  }

  /** @override */
  async close(options={}) {
    if (this._onCloseCallback) this._onCloseCallback();
    return super.close(options);
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "dialog", "standard-form", "roll-dialog-window", "roll-dialog", "weapon-roll-dialog"],
    position: { width: 520, height: "auto" },
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
    const weaponName = this.weapon?.name ?? game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.Unarmed");
    if (this.rollType === "melee") {
      return `${game.i18n.localize("NEUROSHIMA.MeleeOpposed.Title")}: ${weaponName}`;
    }
    const label = this.rollType === "ranged" ? "NEUROSHIMA.Actions.Shoot" : "NEUROSHIMA.Actions.Strike";
    return `${game.i18n.localize(label)}: ${weaponName}`;
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

    const userModifier    = this.userEntry.modifier        ?? this.rollOptions.percentageModifier ?? 0;
    const userAttrBonus   = this.userEntry.attributeBonus  ?? 0;
    const userSkillBonus  = this.userEntry.skillBonus      ?? 0;
    const baseDifficulty  = this.userEntry.baseDifficulty  ?? this.rollOptions.difficulty ?? "average";
    const hitLocation     = this.userEntry.hitLocation     ?? this.rollOptions.hitLocation ?? "random";
    const isOpenRaw       = this.userEntry.isOpen          ?? this.rollOptions.isOpen;
    const isOpen          = isOpenRaw === true || isOpenRaw === "true";
    const meleeAction     = this.userEntry.meleeAction     ?? this.rollOptions.meleeAction ?? "attack";
    const maneuver        = this.userEntry.maneuver        ?? this.rollOptions.maneuver ?? "none";
    const tempoLevel      = this.userEntry.tempoLevel      ?? this.rollOptions.tempoLevel ?? 1;
    const aimingLevel     = this.userEntry.aimingLevel     ?? this.rollOptions.aimingLevel ?? 0;
    const burstLevel      = this.userEntry.burstLevel      ?? this.rollOptions.burstLevel ?? 0;
    const useArmorPenalty = this.userEntry.useArmorPenalty ?? this.rollOptions.useArmorPenalty ?? true;
    const useWoundPenalty = this.userEntry.useWoundPenalty ?? this.rollOptions.useWoundPenalty ?? true;
    const rollMode        = this.userEntry.rollMode        ?? this.rollOptions.rollMode;

    let distance = this.userEntry.distance ?? this.rollOptions.distance ?? 0;
    const targets = game.user.targets;
    if (targets.size > 0 && this.userEntry.distance === undefined) {
      const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === this.actor.id && (t.controlled || !canvas.tokens.controlled.length));
      const targetToken = Array.from(targets)[0];
      if (actorToken && targetToken) {
        distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, targetToken);
      }
    }
    const distancePenalty = this.userEntry.distancePenalty ?? (
      this.rollType === "ranged" ? (getDistancePenalty(this.weapon.system.rangedSubtype, distance) ?? 0) : 0
    );

    const weaponSkillKey   = this.weapon?.system?.skill || "";
    const weaponSkillValue = weaponSkillKey ? (this.actor.system.skills?.[weaponSkillKey]?.value ?? 0) : 0;
    const weaponSkillObj   = weaponSkillKey ? { name: game.i18n.localize(`NEUROSHIMA.Skills.${weaponSkillKey}`) || weaponSkillKey, value: weaponSkillValue, key: weaponSkillKey } : null;
    const weaponAttrKey    = this.weapon?.system?.attribute || "dexterity";
    const weaponAttrValue  = this.actor.system.attributeTotals?.[weaponAttrKey] ?? 0;
    const weaponAttrObj    = { name: weaponAttrKey, value: weaponAttrValue, key: weaponAttrKey };

    const targetActors = Array.from(game.user.targets || []).map(t => t.actor).filter(Boolean);
    const { dialogModifiers, scriptFields, modBreakdown, attrBreakdown, skillBreakdown } = await NeuroshimaScriptRunner.computeDialogFields(
      this.actor,
      { rollType: this.rollType, weapon: this.weapon, skill: weaponSkillObj, attribute: weaponAttrObj, difficulty: baseDifficulty, hitLocation, distance, distanceModifier: distancePenalty },
      this.selectedModifierIds,
      this.unselectedModifierIds,
      targetActors
    );

    this._dialogModifiers = dialogModifiers;
    this._scriptFields = scriptFields;
    this._breakdown = { mod: modBreakdown, attr: attrBreakdown, skill: skillBreakdown };
    this._userValues = { modifier: userModifier, attributeBonus: userAttrBonus, skillBonus: userSkillBonus };

    const targetTokens = Array.from(game.user.targets);
    const isVehicleTarget = targetTokens.some(t => t.actor?.type === "vehicle");
    const weaponTypeKey = this.rollType === "melee" ? "melee" : "ranged";

    context.actor = this.actor;
    context.weapon = this.weapon;
    context.rollType = this.rollType;
    context.isMelee = this.rollType === "melee";
    context.difficulties = NEUROSHIMA.difficulties;
    context.isVehicleTarget = isVehicleTarget;

    if (isVehicleTarget) {
      context.hitLocations = Object.entries(NEUROSHIMA.vehicleLocations).map(([key, label]) => ({ key, label, modifier: 0 }));
    } else {
      context.hitLocations = Object.entries(NEUROSHIMA.bodyLocations).map(([key, data]) => ({ key, label: data.label, modifier: data.modifiers[weaponTypeKey] }));
    }

    context.modifier      = userModifier + scriptFields.modifier;
    context.attributeBonus= userAttrBonus + scriptFields.attributeBonus;
    context.skillBonus    = userSkillBonus + scriptFields.skillBonus;
    context.armorPenalty  = actorArmorPenalty + scriptFields.armorDelta;
    context.woundPenalty  = actorWoundPenalty + scriptFields.woundDelta;
    context.crowdingDexPenalty = this.crowdingDexPenalty;

    let effectDifficulty = (scriptFields.difficulty && this.userEntry.baseDifficulty === undefined)
      ? scriptFields.difficulty : baseDifficulty;
    if (scriptFields.difficultyShift) {
      effectDifficulty = NeuroshimaScriptRunner.shiftDifficultyKey(effectDifficulty, scriptFields.difficultyShift);
    }
    context.baseDifficulty = effectDifficulty;
    context.hitLocation    = (scriptFields.hitLocation && this.userEntry.hitLocation === undefined)
      ? scriptFields.hitLocation : hitLocation;

    context.isOpen          = isOpen;
    context.meleeAction     = meleeAction;
    context.maneuver        = maneuver;
    context.tempoLevel      = tempoLevel;
    context.aimingLevel     = aimingLevel;
    context.burstLevel      = burstLevel;
    context.applyArmorPenalty = useArmorPenalty;
    context.applyWoundPenalty = useWoundPenalty;
    context.rollMode        = rollMode;
    context.rollModes       = CONFIG.Dice.rollModes;
    context.distance        = distance;
    context.distancePenalty = distancePenalty;
    context.dialogModifiers = dialogModifiers;
    context.maneuvers = NEUROSHIMA.maneuvers || {
      none: "NEUROSHIMA.Roll.Maneuvers.None",
      charge: "NEUROSHIMA.Roll.Maneuvers.Charge",
      fury: "NEUROSHIMA.Roll.Maneuvers.Fury",
      fullDefense: "NEUROSHIMA.Roll.Maneuvers.FullDefense",
      increasedTempo: "NEUROSHIMA.Roll.Maneuvers.IncreasedTempo"
    };

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

    const distanceInput = html.querySelector('#distance-input');
    const distancePenaltyInput = html.querySelector('#distance-penalty-input');
    if (distanceInput && distancePenaltyInput && this.rollType === "ranged") {
      distanceInput.addEventListener('input', () => {
        const dist = parseFloat(distanceInput.value) || 0;
        const auto = getDistancePenalty(this.weapon.system.rangedSubtype, dist);
        if (auto !== null) {
          distancePenaltyInput.value = auto;
          this.userEntry.distancePenalty = auto;
        }
        this._updatePreview(html);
      });
    }

    html.querySelectorAll('input[type="range"]').forEach(el => {
      el.addEventListener('input', ev => {
        this._onRangeInput(ev, html);
      });
    });

    const maneuverSelect = html.querySelector('[name="maneuver"]');
    const tempoRow = html.querySelector('.tempo-row');
    if (maneuverSelect && tempoRow) {
      maneuverSelect.addEventListener('change', () => {
        tempoRow.hidden = maneuverSelect.value !== 'increasedTempo';
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

  _onRangeInput(ev, html) {
    const el = ev.currentTarget;
    const name = el.name;
    const value = Number(el.value);
    this.userEntry[name] = value;

    const aimingDisplay = html.querySelector('.aiming-display');
    const diceCountDisplay = html.querySelector('.dice-count');
    if (name === 'aimingLevel') {
      if (aimingDisplay) aimingDisplay.innerText = value;
      if (diceCountDisplay) diceCountDisplay.innerText = value + 1;
    }
    const burstDisplay = html.querySelector('.burst-display');
    const bulletsCountDisplay = html.querySelector('.bullets-count');
    if (name === 'burstLevel') {
      if (burstDisplay) burstDisplay.innerText = value;
      if (bulletsCountDisplay) bulletsCountDisplay.innerText = game.neuroshima.NeuroshimaDice.getBulletsFired(this.weapon, value);
    }
    const tempoDisplay = html.querySelector('.tempo-display');
    const tempoShiftDisplay = html.querySelector('.tempo-shift');
    if (name === 'tempoLevel') {
      if (tempoDisplay) tempoDisplay.innerText = value;
      if (tempoShiftDisplay) tempoShiftDisplay.innerText = value;
    }
    this._updatePreview(html);
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
  }

  _updatePreview(html) {
    if (!html) html = this.element;
    const form = html.tagName === "FORM" ? html : html.querySelector('form');
    if (!form) return;

    const formData = new foundry.applications.ux.FormDataExtended(form).object;

    const aimingLevel    = formData.aimingLevel     !== undefined ? parseInt(formData.aimingLevel)   : (this.userEntry.aimingLevel   ?? this.rollOptions.aimingLevel   ?? 0);
    const burstLevel     = formData.burstLevel      !== undefined ? parseInt(formData.burstLevel)    : (this.userEntry.burstLevel    ?? 0);
    const tempoLevel     = formData.tempoLevel      !== undefined ? parseInt(formData.tempoLevel)    : (this.userEntry.tempoLevel    ?? this.rollOptions.tempoLevel    ?? 1);
    const maneuver       = formData.maneuver        || (this.userEntry.maneuver ?? this.rollOptions.maneuver ?? "none");
    const isMelee        = this.rollType === "melee";
    const bonusMode      = game.settings.get("neuroshima", "meleeBonusMode") || "attribute";
    const distancePenalty= parseInt(formData.distancePenalty) || 0;
    const modifier       = parseInt(formData.modifier) || 0;
    const _baseDiffKey   = this.userEntry.baseDifficulty ?? this.rollOptions.difficulty ?? "average";
    const _sf            = this._scriptFields;
    let _effectiveDiffKey = (_sf?.difficulty && this.userEntry.baseDifficulty === undefined) ? _sf.difficulty : _baseDiffKey;
    if (_sf?.difficultyShift) _effectiveDiffKey = NeuroshimaScriptRunner.shiftDifficultyKey(_effectiveDiffKey, _sf.difficultyShift);
    const basePenalty    = NEUROSHIMA.difficulties[_effectiveDiffKey]?.min || 0;
    const armorPenalty   = formData.useArmorPenalty ? (this.actor.system.combat?.totalArmorPenalty || 0) + (this._scriptFields?.armorDelta || 0) : 0;
    const woundPenalty   = formData.useWoundPenalty ? (this.actor.system.combat?.totalWoundPenalty || 0) + (this._scriptFields?.woundDelta || 0) : 0;

    let weaponBonus = 0;
    if (isMelee) {
      const action = formData.meleeAction || "attack";
      weaponBonus = action === "attack" ? (this.weapon.system.attackBonus || 0) : (this.weapon.system.defenseBonus || 0);
      if (maneuver === 'fury' || maneuver === 'fullDefense') weaponBonus += 2;
    }

    const locationPenalty = game.neuroshima.NeuroshimaDice.getLocationPenalty(this.weapon.system.weaponType, formData.hitLocation);
    const totalPct = basePenalty + modifier + armorPenalty + woundPenalty + locationPenalty + distancePenalty;

    const totalElement = html.querySelector('.total-modifier');
    if (totalElement) totalElement.innerText = `${totalPct}%`;

    const actualDiff = game.neuroshima.NeuroshimaDice.getDifficultyFromPercent(totalPct);
    let displayDiff = actualDiff;
    if (isMelee && maneuver === 'increasedTempo') {
      displayDiff = game.neuroshima.NeuroshimaDice._getShiftedDifficulty(actualDiff, tempoLevel);
    }

    const allowCombatShift = game.settings.get("neuroshima", "allowCombatShift");
    let previewLevelLabel = game.i18n.localize(displayDiff.label);

    const skillBonus = parseInt(formData.skillBonus) || 0;
    const attrBonus  = parseInt(formData.attributeBonus) || 0;

    if (allowCombatShift && !isMelee) {
      let skillKey = this.weapon.system.skill;
      if (!skillKey || skillKey === "none") {
        const attrGroups = NEUROSHIMA.skillConfiguration[this.weapon.system.attribute || "dexterity"] || {};
        skillKey = (Object.values(attrGroups)[0] || [])[0] || "";
      }
      const isCreature = this.actor?.type === "creature";
      const baseSkillValue = (skillKey && skillKey !== "none")
        ? ((skillKey === "experience" && isCreature) ? (this.actor.system.experience ?? 0) : (this.actor.system.skills[skillKey]?.value || 0))
        : 0;
      let skillValue = baseSkillValue + skillBonus;
      if (bonusMode === "skill" || bonusMode === "both") skillValue += weaponBonus;
      const shift = game.neuroshima.NeuroshimaDice.getSkillShift(skillValue);
      if (shift !== 0) {
        const shifted = game.neuroshima.NeuroshimaDice._getShiftedDifficulty(actualDiff, -shift);
        previewLevelLabel = `${game.i18n.localize(displayDiff.label)} → ${game.i18n.localize(shifted.label)}`;
      }
    }

    const finalLevelElement = html.querySelector('.final-difficulty');
    if (finalLevelElement) finalLevelElement.innerText = previewLevelLabel;

    const attrKey   = this.weapon.system.attribute;
    const attrTotal = Number(this.actor.system.attributeTotals[attrKey]) || 0;
    let activeDiff  = actualDiff;

    if (isMelee && maneuver === 'increasedTempo') {
      activeDiff = game.neuroshima.NeuroshimaDice._getShiftedDifficulty(actualDiff, tempoLevel);
    }
    if (allowCombatShift && !isMelee) {
      let skillKey2 = this.weapon.system.skill;
      if (!skillKey2 || skillKey2 === "none") {
        const attrGroups = NEUROSHIMA.skillConfiguration[this.weapon.system.attribute || "dexterity"] || {};
        skillKey2 = (Object.values(attrGroups)[0] || [])[0] || "";
      }
      const isCreature2 = this.actor?.type === "creature";
      const baseSkill2 = (skillKey2 && skillKey2 !== "none")
        ? ((skillKey2 === "experience" && isCreature2) ? (this.actor.system.experience ?? 0) : (this.actor.system.skills[skillKey2]?.value || 0))
        : 0;
      let sv = baseSkill2 + skillBonus;
      if (bonusMode === "skill" || bonusMode === "both") sv += weaponBonus;
      activeDiff = game.neuroshima.NeuroshimaDice._getShiftedDifficulty(actualDiff, -game.neuroshima.NeuroshimaDice.getSkillShift(sv));
    }

    let effectiveWeaponBonus = 0;
    if (isMelee && (bonusMode === "attribute" || bonusMode === "both")) effectiveWeaponBonus = weaponBonus;

    const targetElement = html.querySelector('.final-target');
    if (targetElement) targetElement.innerText = attrTotal + attrBonus + activeDiff.mod + effectiveWeaponBonus - (this.crowdingDexPenalty || 0);

    const aimingDisplay   = html.querySelector('.aiming-display');
    const diceCountDisplay= html.querySelector('.dice-count');
    if (aimingDisplay)    aimingDisplay.innerText = aimingLevel;
    if (diceCountDisplay) diceCountDisplay.innerText = aimingLevel + 1;

    const burstDisplay       = html.querySelector('.burst-display');
    const bulletsCountDisplay= html.querySelector('.bullets-count');
    if (burstDisplay)        burstDisplay.innerText = burstLevel;
    if (bulletsCountDisplay) bulletsCountDisplay.innerText = game.neuroshima.NeuroshimaDice.getBulletsFired(this.weapon, burstLevel);

    const tempoDisplay     = html.querySelector('.tempo-display');
    const tempoShiftDisplay= html.querySelector('.tempo-shift');
    if (tempoDisplay)      tempoDisplay.innerText = tempoLevel;
    if (tempoShiftDisplay) tempoShiftDisplay.innerText = tempoLevel;

    const tempoRow = html.querySelector('.tempo-row');
    if (tempoRow) tempoRow.hidden = maneuver !== 'increasedTempo';
  }

  async _runSubmissionScripts() {
    const submissionOptions = {};
    for (const dm of this._dialogModifiers) {
      if (!dm.activated || !dm._script?.submissionScript) continue;
      await dm._script.runSubmission({ actor: this.actor, options: submissionOptions, fields: this._scriptFields });
    }
    return submissionOptions;
  }

  async _onRoll(event, target) {
    const html = this.element;
    const form = html.tagName === "FORM" ? html : html.querySelector('form');
    const formData = new foundry.applications.ux.FormDataExtended(form).object;

    const sf = this._scriptFields;
    const ue = this.userEntry;

    const totalModifier    = parseInt(formData.modifier)       || 0;
    const totalAttrBonus   = parseInt(formData.attributeBonus) || 0;
    const totalSkillBonus  = parseInt(formData.skillBonus)     || 0;
    const burstLevel       = formData.burstLevel  !== undefined ? parseInt(formData.burstLevel)  : 0;
    const aimingLevel      = formData.aimingLevel !== undefined ? parseInt(formData.aimingLevel) : (ue.aimingLevel ?? this.rollOptions.aimingLevel ?? 0);
    const tempoLevel       = parseInt(formData.tempoLevel)     || 1;

    const _userBaseDiff = ue.baseDifficulty ?? this.rollOptions.difficulty ?? "average";
    let _effectiveDiff  = (sf?.difficulty && ue.baseDifficulty === undefined) ? sf.difficulty : _userBaseDiff;
    if (sf?.difficultyShift) _effectiveDiff = NeuroshimaScriptRunner.shiftDifficultyKey(_effectiveDiff, sf.difficultyShift);

    await this.actor.update({
      "system.lastWeaponRoll": {
        isOpen:            this.rollType === "melee" ? false : (formData.isOpen === "true"),
        difficulty:        _userBaseDiff,
        meleeAction:       formData.meleeAction,
        maneuver:          formData.maneuver,
        tempoLevel:        tempoLevel,
        percentageModifier:(ue.modifier ?? this.rollOptions.percentageModifier ?? 0),
        useArmorPenalty:   !!formData.useArmorPenalty,
        useWoundPenalty:   !!formData.useWoundPenalty,
        rollMode:          formData.rollMode
      }
    });

    const rollData = {
      weapon:          this.weapon,
      actor:           this.actor,
      targets:         this.targets,
      isOpen:          this.rollType === "melee" ? false : (formData.isOpen === "true"),
      meleeAction:     formData.meleeAction,
      maneuver:        formData.maneuver,
      tempoLevel:      tempoLevel,
      aimingLevel:     aimingLevel,
      burstLevel:      burstLevel,
      difficulty:      _effectiveDiff,
      hitLocation:     formData.hitLocation,
      modifier:        totalModifier,
      applyArmor:      !!formData.useArmorPenalty,
      applyWounds:     !!formData.useWoundPenalty,
      skillBonus:      totalSkillBonus,
      attributeBonus:  totalAttrBonus - (this.crowdingDexPenalty || 0),
      distance:        parseFloat(formData.distance) || 0,
      distancePenalty: parseInt(formData.distancePenalty) || 0,
      rollMode:        formData.rollMode
    };

    const submissionOptions = await this._runSubmissionScripts();
    this.close();

    if (this.isPoolRoll && this.onPoolRoll) {
      const rawResult = await game.neuroshima.NeuroshimaDice.rollWeaponTest({ ...rollData, options: submissionOptions, chatMessage: false });
      if (rawResult) {
        const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
        await NeuroshimaChatMessage.renderWeaponRoll(rawResult, this.actor, rawResult.roll);
      }
      return this.onPoolRoll(rawResult);
    }

    return game.neuroshima.NeuroshimaDice.rollWeaponTest({ ...rollData, options: submissionOptions });
  }

  _onCancel(event, target) {
    this.close();
  }
}
