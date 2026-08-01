import {
  buildBreakdownTooltip,
  collectDocumentEffectSources
} from "../../helpers/tooltip-renderer.js";
import {
  EFFECT_PENALTY_KEY,
  LEGACY_EFFECT_PENALTY_KEY
} from "../../helpers/effect-penalty.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Base class for all Neuroshima roll dialogs.
 *
 * Provides shared infrastructure that is identical across
 * NeuroshimaWeaponRollDialog, NeuroshimaSkillRollDialog,
 * NeuroshimaGrenadeRollDialog and NeuroshimaInitiativeRollDialog:
 *
 *  - Common constructor fields (userEntry, modifier tracking sets, script state)
 *  - `close()` override that fires the optional onClose callback
 *  - `_computeActorDiseasePenalty()` — sums transient disease penalties
 *  - `_buildTooltip(userVal, delta, breakdown)` — HTML tooltip string
 *  - `_applyTooltips(html)` — writes breakdown tooltips to the DOM
 *  - `_onFieldChange(ev)` — generic input/select change → userEntry + re-render
 *  - `static async prompt(options)` — factory: returns a Promise that resolves
 *    with the roll result when the user clicks Roll, or null on cancel/close.
 */
export class NeuroshimaRollDialogBase extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actor             = options.actor ?? null;
    this._onCloseCallback  = options.onClose ?? null;
    this._onErrorCallback  = options.onError ?? null;
    this._rollSubmitted    = false;
    this._closeNotified    = false;

    this.userEntry             = {};
    this.selectedModifierIds   = new Set();
    this.unselectedModifierIds = new Set();
    this._dialogModifiers      = [];
    this._scriptFlags          = {};
    this._scriptFields         = {
      modifier: 0, attributeBonus: 0, skillBonus: 0,
      armorDelta: 0, woundDelta: 0, diseasePenalty: 0, effectPenalty: 0,
      weaponModifier: 0, difficulty: null, hitLocation: null,
      autoSuccess: false, annotations: []
    };
    this._breakdown  = { mod: [], attr: [], skill: [], effect: [] };
    this._userValues = { modifier: 0, attributeBonus: 0, skillBonus: 0 };
  }

  /** @override */
  async close(options = {}) {
    if (!this._rollSubmitted && !this._closeNotified && this._onCloseCallback) {
      this._closeNotified = true;
      this._onCloseCallback();
    }
    return super.close(options);
  }

  /**
   * Sum all transient disease penalties on the actor.
   * @returns {number}
   */
  _computeActorDiseasePenalty() {
    return (this.actor?.items ?? [])
      .filter(i => i.type === "disease" && (i.system.diseaseType ?? "chronic") === "transient")
      .reduce((sum, i) => sum + (Number(i.system.transientPenalty) || 0), 0);
  }

  /**
   * Return the final prepared Active Effect penalty. Foundry has already
   * resolved all AE modes into this value, so source rows must never be
   * summed to produce the roll penalty.
   */
  _computeActorEffectPenalty() {
    return Number(this.actor?.system?.combat?.effectPenalty ?? 0) || 0;
  }

  /**
   * Combine the actor's prepared Active Effect penalty with transient
   * contributions made by active dialog scripts through args.fields.
   */
  _computeDialogEffectPenalty(scriptFields = this._scriptFields) {
    return this._computeActorEffectPenalty()
      + (Number(scriptFields?.effectPenalty ?? 0) || 0);
  }

  _getActorEffectPenaltySources() {
    const sources = collectDocumentEffectSources(
      this.actor,
      [EFFECT_PENALTY_KEY, LEGACY_EFFECT_PENALTY_KEY]
    );
    return [
      ...(sources[EFFECT_PENALTY_KEY] ?? []),
      ...(sources[LEGACY_EFFECT_PENALTY_KEY] ?? [])
    ];
  }

  _prepareEffectPenaltyContext(context, useEffectPenalty = true) {
    const sources = this._getActorEffectPenaltySources();
    const scriptSources = this._breakdown?.effect ?? [];
    const effectPenalty = this._computeDialogEffectPenalty();
    context.effectPenalty = effectPenalty;
    context.showEffectPenalty = effectPenalty !== 0
      || sources.length > 0
      || scriptSources.length > 0;
    context.useEffectPenalty = useEffectPenalty;
    return context;
  }

  /**
   * Build an HTML tooltip showing user entry vs. script bonus vs. total.
   * Returns null if there is no script-contributed delta.
   * @param {number}   userVal   - The value the user entered.
   * @param {number}   delta     - The script-computed delta.
   * @param {Array}    breakdown - Array of { label, value } entries from scripts.
   * @returns {string|null}
   */
  _buildTooltip(userVal, delta, breakdown) {
    if (!delta) return null;
    const sources = breakdown?.length
      ? breakdown
      : [{ label: "NEUROSHIMA.Roll.EffectBonus", value: delta }];
    return buildBreakdownTooltip({
      baseLabel: "NEUROSHIMA.Roll.UserEntry",
      baseValue: Number(userVal ?? 0),
      sources,
      totalValue: Number(userVal ?? 0) + Number(delta ?? 0)
    });
  }

  /**
   * Apply data-tooltip attributes to the three main penalty fields.
   * Subclasses may call super._applyTooltips(html) and then extend.
   * @param {HTMLElement} html
   */
  _applyTooltips(html) {
    const sf = this._scriptFields;
    const uv = this._userValues;
    if (!sf || !uv) return;
    const bd = this._breakdown;

    const set = (name, html_tooltip) => {
      const el = html.querySelector(`[name="${name}"]`);
      if (!el) return;
      if (html_tooltip) {
        el.dataset.tooltipHtml = html_tooltip;
        delete el.dataset.tooltip;
      } else {
        delete el.dataset.tooltipHtml;
        delete el.dataset.tooltip;
      }
    };

    set("modifier",       this._buildTooltip(uv.modifier,       sf.modifier,       bd.mod));
    set("attributeBonus", this._buildTooltip(uv.attributeBonus, sf.attributeBonus, bd.attr));
    set("skillBonus",     this._buildTooltip(uv.skillBonus,     sf.skillBonus,     bd.skill));

    const actorArmor   = this.actor?.system?.combat?.totalArmorPenalty ?? 0;
    const actorWound   = this.actor?.system?.combat?.totalWoundPenalty ?? 0;
    const actorDisease = this._computeActorDiseasePenalty();
    const buildSimple = (base, delta) => buildBreakdownTooltip({
      baseLabel: "NEUROSHIMA.Roll.UserEntry",
      baseValue: Number(base ?? 0),
      sources: [{ label: "NEUROSHIMA.Roll.EffectBonus", value: Number(delta ?? 0) }],
      totalValue: Number(base ?? 0) + Number(delta ?? 0)
    });

    set("armorPenalty",   sf.armorDelta    ? buildSimple(actorArmor,   sf.armorDelta)    : null);
    set("woundPenalty",   sf.woundDelta    ? buildSimple(actorWound,   sf.woundDelta)    : null);
    set("diseasePenalty", sf.diseasePenalty? buildSimple(actorDisease, sf.diseasePenalty): null);

    const effectPenalty = this._computeDialogEffectPenalty();
    const effectSources = this._getActorEffectPenaltySources();
    const scriptEffectSources = (bd.effect?.length
      ? bd.effect
      : (Number(sf.effectPenalty ?? 0)
        ? [{ label: "NEUROSHIMA.Roll.DialogEffects", value: Number(sf.effectPenalty) }]
        : []));
    const allEffectSources = [...effectSources, ...scriptEffectSources];
    set("effectPenalty", effectPenalty !== 0 || allEffectSources.length
      ? buildBreakdownTooltip({
          title: "NEUROSHIMA.Roll.Effects",
          sources: allEffectSources.length
            ? allEffectSources.map(source => ({
                ...source,
                state: Number(source.value) > 0 ? "penalty"
                  : Number(source.value) < 0 ? "bonus" : null
              }))
            : [{
                label: "NEUROSHIMA.Roll.Effects",
                value: effectPenalty,
                signed: true,
                state: effectPenalty > 0 ? "penalty"
                  : effectPenalty < 0 ? "bonus" : null
              }],
          totalValue: effectPenalty,
          suffix: "%"
        })
      : null);
  }

  /**
   * Generic change handler for input and select elements.
   * Stores the typed/selected value in userEntry and re-renders.
   * @param {Event} ev
   */
  _onFieldChange(ev) {
    const el = ev.currentTarget;
    const name = el.name;
    if (!name) return;
    let value = el.value;
    if (el.type === "checkbox") value = el.checked;
    else if (el.type === "number" || el.type === "range") value = Number(value);
    this.userEntry[name] = value;
    this.render();
  }

  async _runSubmissionScripts(item = null, submissionOptions = {}) {
    for (const modifier of this._dialogModifiers ?? []) {
      if (!modifier.activated || !modifier._script?.submissionScript) continue;
      await modifier._script.runSubmission({
        actor: this.actor,
        item,
        options: submissionOptions,
        fields: this._scriptFields,
        flags: this._scriptFlags
      });
    }
    return submissionOptions;
  }

  /**
   * Static constructor that wraps the dialog in a Promise.
   * Resolve with the roll result when the user clicks Roll, resolve with null
   * on cancel/window close, or reject through onError when execution fails.
   *
   * Subclasses should pass an `onRoll` option that resolves with the result
   * and call `resolve(result)` from `_onRoll`.
   *
   * @param {class}  DialogClass - The concrete dialog subclass.
   * @param {object} options     - Options forwarded to the dialog constructor.
   *                              May include any subclass-specific keys.
   * @returns {Promise<any>}
   *
   * @example
   * const result = await NeuroshimaRollDialogBase.prompt(NeuroshimaSkillRollDialog, {
   *   actor, stat, skill, label, isSkill, skillKey
   * });
   * if (result) console.log("rolled", result);
   */
  static async prompt(DialogClass, options = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const dialog = new DialogClass({
        ...options,
        onRoll: finish,
        onClose: () => finish(null),
        onError: fail
      });
      dialog.render(true);
    });
  }
}
