import { NEUROSHIMA } from "../config.js";
import { NeuroshimaScriptRunner } from "./neuroshima-script-engine.js";
import { NeuroshimaDice } from "../helpers/dice.js";
import { NeuroshimaRollDialogBase } from "./roll-dialog-base.js";

export class NeuroshimaGrenadeRollDialog extends NeuroshimaRollDialogBase {
  constructor(options = {}) {
    super(options);
    this.weapon = options.weapon;

    this.rollOptions = {
      distance:          options.distance          ?? 0,
      distancePenalty:   options.distancePenalty   ?? 0,
      difficulty:        options.difficulty         ?? "average",
      modifier:          options.modifier           ?? 0,
      useWoundPenalty:   options.useWoundPenalty    ?? true,
      useArmorPenalty:   options.useArmorPenalty    ?? true,
      useDiseasePenalty: options.useDiseasePenalty  ?? true,
      rollMode:          options.rollMode           ?? game.settings.get("core", "rollMode")
    };

    this.grenadeTargetPoint = options.grenadeTargetPoint ?? null;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "dialog", "standard-form", "roll-dialog-window", "roll-dialog", "grenade-roll-dialog"],
    position: { width: 480, height: "auto" },
    window: { resizable: false, minimizable: false },
    form: { submitOnChange: false, closeOnSubmit: false },
    actions: {
      roll:          NeuroshimaGrenadeRollDialog.prototype._onRoll,
      cancel:        NeuroshimaGrenadeRollDialog.prototype._onCancel,
      clickModifier: NeuroshimaGrenadeRollDialog.prototype._onClickModifier
    }
  };

  static PARTS = {
    form: { template: "systems/neuroshima/templates/dialog/grenade-roll-dialog.hbs" }
  };

  get title() {
    return `${game.i18n.localize("NEUROSHIMA.Grenade.RollTitle")}: ${this.weapon?.name ?? ""}`;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const actor  = this.actor;
    const wData  = this.weapon?.system ?? {};

    const actorWoundPenalty   = actor?.system?.combat?.totalWoundPenalty ?? 0;
    const actorArmorPenalty   = actor?.system?.combat?.totalArmorPenalty ?? 0;
    const actorDiseasePenalty = this._computeActorDiseasePenalty();

    const userModifier        = this.userEntry.modifier        ?? this.rollOptions.modifier  ?? 0;
    const userAttrBonus       = this.userEntry.attributeBonus  ?? 0;
    const userSkillBonus      = this.userEntry.skillBonus      ?? 0;
    const baseDifficulty      = this.userEntry.baseDifficulty  ?? this.rollOptions.difficulty ?? "average";
    const useWoundPenalty     = this.userEntry.useWoundPenalty   ?? this.rollOptions.useWoundPenalty   ?? true;
    const useArmorPenalty     = this.userEntry.useArmorPenalty   ?? this.rollOptions.useArmorPenalty   ?? true;
    const useDiseasePenalty   = this.userEntry.useDiseasePenalty ?? this.rollOptions.useDiseasePenalty ?? true;
    const rollMode            = this.userEntry.rollMode          ?? this.rollOptions.rollMode;

    let distance = this.userEntry.distance ?? this.rollOptions.distance ?? 0;
    const targets = game.user.targets;
    if (targets.size > 0 && this.userEntry.distance === undefined) {
      const actorToken = canvas.tokens?.placeables?.find(t => t.actor?.id === actor?.id);
      const targetToken = Array.from(targets)[0];
      if (actorToken && targetToken && game.neuroshima?.NeuroshimaDice?.measureDistance) {
        distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, targetToken);
      }
    }

    const build        = actor?.system?.attributes?.constitution ?? 0;
    const useBuildBonus = wData.useBuildBonus !== false;
    const distancePenalty = this.userEntry.distancePenalty ?? NeuroshimaDice.getGrenadePenalty(distance, build, null, useBuildBonus);

    const weaponAttrKey  = wData.attribute || "dexterity";
    const weaponSkillKey = wData.skill || "throwing";
    const weaponAttrObj  = { name: weaponAttrKey, value: actor?.system?.attributeTotals?.[weaponAttrKey] ?? 0, key: weaponAttrKey };
    const weaponSkillObj = { name: weaponSkillKey, value: actor?.system?.skills?.[weaponSkillKey]?.value ?? 0, key: weaponSkillKey };

    const targetActors = Array.from(game.user.targets || []).map(t => t.actor).filter(Boolean);
    const { dialogModifiers, scriptFields } = await NeuroshimaScriptRunner.computeDialogFields(
      actor,
      { rollType: "grenade", weapon: this.weapon, skill: weaponSkillObj, attribute: weaponAttrObj, difficulty: baseDifficulty, distance, distanceModifier: distancePenalty },
      this.selectedModifierIds,
      this.unselectedModifierIds,
      targetActors
    );

    this._dialogModifiers = dialogModifiers;
    this._scriptFields    = scriptFields;

    let effectDifficulty = (scriptFields.difficulty && this.userEntry.baseDifficulty === undefined)
      ? scriptFields.difficulty : baseDifficulty;

    const cfg = game.neuroshima?.config ?? {};
    const baseRange  = cfg.grenadeBaseRange ?? 10;
    const multiplier = cfg.grenadeDistanceMultiplier ?? 3;
    const blastZones = wData.blastZones ?? [];
    const maxRange   = blastZones.length > 0 ? Math.max(...blastZones.map(z => z.radius ?? 0)) : 0;

    const totalDiseasePenalty = actorDiseasePenalty + (scriptFields.diseasePenalty || 0);

    ctx.actor           = actor;
    ctx.weapon          = this.weapon;
    ctx.rollOptions     = this.rollOptions;
    ctx.modifier        = userModifier + (scriptFields.modifier || 0);
    ctx.attributeBonus  = userAttrBonus + (scriptFields.attributeBonus || 0);
    ctx.skillBonus      = userSkillBonus + (scriptFields.skillBonus || 0);
    ctx.armorPenalty    = actorArmorPenalty + (scriptFields.armorDelta || 0);
    ctx.woundPenalty    = actorWoundPenalty + (scriptFields.woundDelta || 0);
    ctx.diseasePenalty  = totalDiseasePenalty;
    ctx.showDiseasePenalty  = totalDiseasePenalty > 0;
    ctx.applyWoundPenalty   = useWoundPenalty;
    ctx.applyArmorPenalty   = useArmorPenalty;
    ctx.applyDiseasePenalty = useDiseasePenalty;
    ctx.distance        = distance;
    ctx.distancePenalty = distancePenalty;
    ctx.baseRange       = baseRange;
    ctx.multiplier      = multiplier;
    ctx.maxRange        = maxRange;
    ctx.baseDifficulty  = effectDifficulty;
    ctx.difficulties    = NEUROSHIMA.difficulties;
    ctx.rollMode        = rollMode;
    ctx.rollModes       = CONFIG.Dice.rollModes;
    ctx.dialogModifiers = dialogModifiers;
    return ctx;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    html.addEventListener("change", async (ev) => {
      const el = ev.target;
      const name = el.name;
      if (!name) return;

      if (el.type === "checkbox") {
        this.userEntry[name] = el.checked;
      } else if (el.type === "number" || el.type === "range") {
        this.userEntry[name] = el.type === "number" ? (parseFloat(el.value) || 0) : parseInt(el.value);
      } else {
        this.userEntry[name] = el.value;
      }

      if (name === "distance") {
        delete this.userEntry.distancePenalty;
      }

      await this.render();
    });

    this._updateSummary(html, context);
  }

  _updateSummary(html, context) {
    const modifier        = parseInt(html.querySelector('[name="modifier"]')?.value) || 0;
    const distancePenalty = parseInt(html.querySelector('[name="distancePenalty"]')?.value) || 0;
    const armorPenalty    = html.querySelector('[name="useArmorPenalty"]')?.checked
      ? (parseInt(html.querySelector('[name="armorPenalty"]')?.value) || 0) : 0;
    const woundPenalty    = html.querySelector('[name="useWoundPenalty"]')?.checked
      ? (parseInt(html.querySelector('[name="woundPenalty"]')?.value) || 0) : 0;
    const diseasePenalty  = html.querySelector('[name="useDiseasePenalty"]')?.checked
      ? (parseInt(html.querySelector('[name="diseasePenalty"]')?.value) || 0) : 0;
    const dmBonus         = this._dialogModifiers
      .filter(dm => dm.activated)
      .reduce((sum, dm) => sum + (dm._lastResult?.modifier || 0), 0);

    const totalPct = modifier + armorPenalty + woundPenalty + diseasePenalty + distancePenalty - dmBonus;

    const totalEl = html.querySelector('.total-modifier');
    if (totalEl) totalEl.textContent = `${totalPct >= 0 ? "+" : ""}${totalPct}%`;

    const NEUROSHIMA = game.neuroshima?.config ?? {};
    const baseDiff = NeuroshimaDice.getDifficultyFromPercent(totalPct);
    const diffLabel = baseDiff ? game.i18n.localize(baseDiff.label) : "-";
    const finalDiffEl = html.querySelector('.final-difficulty');
    if (finalDiffEl) finalDiffEl.textContent = diffLabel;

    const weaponAttrKey = this.weapon?.system?.attribute || "dexterity";
    const attrTotal = (Number(this.actor?.system?.attributeTotals?.[weaponAttrKey]) || 0)
      + (parseInt(html.querySelector('[name="attributeBonus"]')?.value) || 0);
    const skillKey  = this.weapon?.system?.skill || "throwing";
    const skillVal  = Number(this.actor?.system?.skills?.[skillKey]?.value) || 0;
    const finalTarget = attrTotal + (baseDiff?.mod ?? 0);
    const targetEl = html.querySelector('.final-target');
    if (targetEl) targetEl.textContent = finalTarget;
  }

  async _onClickModifier(event, target) {
    const idx      = parseInt(target.dataset.dmIndex);
    const effectId = target.dataset.dmEffectId;
    const dm       = this._dialogModifiers[idx];
    if (!dm) return;

    if (dm.activated) {
      this.selectedModifierIds.delete(effectId);
      this.unselectedModifierIds.add(effectId);
    } else {
      this.unselectedModifierIds.delete(effectId);
      this.selectedModifierIds.add(effectId);
    }
    await this.render();
  }

  async _onRoll(event, target) {
    const form   = this.element.tagName === "FORM" ? this.element : this.element.querySelector("form");
    const data   = new foundry.applications.ux.FormDataExtended(form).object;

    const distance        = parseFloat(data.distance       ?? 0) || 0;
    const distancePenalty = parseInt(data.distancePenalty  ?? 0) || 0;
    const modifier        = parseInt(data.modifier         ?? 0) || 0;
    const attributeBonus  = parseInt(data.attributeBonus   ?? 0) || 0;
    const skillBonus      = parseInt(data.skillBonus       ?? 0) || 0;
    const rollMode        = data.rollMode ?? game.settings.get("core", "rollMode");
    const useArmor        = !!data.useArmorPenalty;
    const useWound        = !!data.useWoundPenalty;
    const useDisease      = !!data.useDiseasePenalty;
    const sf              = this._scriptFields ?? {};

    const result = await NeuroshimaDice.rollGrenade({
      actor:              this.actor,
      weapon:             this.weapon,
      distance,
      distancePenalty,
      modifier,
      attributeBonus:     attributeBonus + (sf.attributeBonus || 0),
      skillBonus:         skillBonus + (sf.skillBonus || 0),
      armorPenalty:       useArmor ? (this.actor?.system?.combat?.totalArmorPenalty || 0) + (sf.armorDelta || 0) : 0,
      rollMode,
      useWoundPenalty:    useWound,
      useDiseasePenalty:  useDisease,
      diseasePenalty:     useDisease ? this._computeActorDiseasePenalty() + (sf.diseasePenalty || 0) : 0,
      scriptModifier:     sf.modifier || 0
    });

    await this.close();

    if (result?.message && this.grenadeTargetPoint && canvas?.scene) {
      const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
      await NeuroshimaChatMessage.placeGrenadeTemplateAt(result.message, this.grenadeTargetPoint);
    }
  }

  async _onCancel(event, target) {
    await this.close();
  }
}
