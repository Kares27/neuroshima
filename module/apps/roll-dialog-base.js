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

    this.userEntry             = {};
    this.selectedModifierIds   = new Set();
    this.unselectedModifierIds = new Set();
    this._dialogModifiers      = [];
    this._scriptFields         = {
      modifier: 0, attributeBonus: 0, skillBonus: 0,
      armorDelta: 0, woundDelta: 0, diseasePenalty: 0,
      difficulty: null, hitLocation: null
    };
    this._breakdown  = { mod: [], attr: [], skill: [] };
    this._userValues = { modifier: 0, attributeBonus: 0, skillBonus: 0 };
  }

  /** @override */
  async close(options = {}) {
    if (this._onCloseCallback) this._onCloseCallback();
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
   * Build an HTML tooltip showing user entry vs. script bonus vs. total.
   * Returns null if there is no script-contributed delta.
   * @param {number}   userVal   - The value the user entered.
   * @param {number}   delta     - The script-computed delta.
   * @param {Array}    breakdown - Array of { label, value } entries from scripts.
   * @returns {string|null}
   */
  _buildTooltip(userVal, delta, breakdown) {
    if (!delta) return null;
    const sign = v => v >= 0 ? `+${v}` : `${v}`;
    const userLabel   = game.i18n.localize("NEUROSHIMA.Roll.UserEntry");
    const effectLabel = game.i18n.localize("NEUROSHIMA.Roll.EffectBonus");
    const totalLabel  = game.i18n.localize("NEUROSHIMA.Roll.Total");
    const parts = [`<strong>${userLabel}:</strong> ${sign(userVal)}`];
    if (breakdown.length) {
      parts.push(`<strong>${effectLabel}:</strong>`);
      for (const e of breakdown) parts.push(`&nbsp;&bull; ${e.label}: ${sign(e.value)}`);
    }
    parts.push(`<strong>${totalLabel}:</strong> ${sign(userVal + delta)}`);
    return parts.join("<br>");
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

    const set = (name, tooltip) => {
      const el = html.querySelector(`[name="${name}"]`);
      if (!el) return;
      if (tooltip) el.dataset.tooltip = tooltip;
      else delete el.dataset.tooltip;
    };

    set("modifier",       this._buildTooltip(uv.modifier,       sf.modifier,       bd.mod));
    set("attributeBonus", this._buildTooltip(uv.attributeBonus, sf.attributeBonus, bd.attr));
    set("skillBonus",     this._buildTooltip(uv.skillBonus,     sf.skillBonus,     bd.skill));

    const sign = v => v >= 0 ? `+${v}` : `${v}`;
    const actorArmor   = this.actor?.system?.combat?.totalArmorPenalty ?? 0;
    const actorWound   = this.actor?.system?.combat?.totalWoundPenalty ?? 0;
    const actorDisease = this._computeActorDiseasePenalty();
    const userLabel    = game.i18n.localize("NEUROSHIMA.Roll.UserEntry");
    const effectLabel  = game.i18n.localize("NEUROSHIMA.Roll.EffectBonus");
    const totalLabel   = game.i18n.localize("NEUROSHIMA.Roll.Total");

    if (sf.armorDelta) {
      set("armorPenalty", `<strong>${userLabel}:</strong> ${sign(actorArmor)}<br><strong>${effectLabel}:</strong> ${sign(sf.armorDelta)}<br><strong>${totalLabel}:</strong> ${sign(actorArmor + sf.armorDelta)}`);
    } else {
      set("armorPenalty", null);
    }
    if (sf.woundDelta) {
      set("woundPenalty", `<strong>${userLabel}:</strong> ${sign(actorWound)}<br><strong>${effectLabel}:</strong> ${sign(sf.woundDelta)}<br><strong>${totalLabel}:</strong> ${sign(actorWound + sf.woundDelta)}`);
    } else {
      set("woundPenalty", null);
    }
    if (sf.diseasePenalty) {
      set("diseasePenalty", `<strong>${userLabel}:</strong> ${sign(actorDisease)}<br><strong>${effectLabel}:</strong> ${sign(sf.diseasePenalty)}<br><strong>${totalLabel}:</strong> ${sign(actorDisease + sf.diseasePenalty)}`);
    } else {
      set("diseasePenalty", null);
    }
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

  /**
   * Factory that wraps the dialog in a Promise.
   * Resolve with the roll result when the user clicks Roll;
   * resolve with null on cancel or window close.
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
    return new Promise((resolve) => {
      const dialog = new DialogClass({
        ...options,
        onRoll:  (result) => resolve(result),
        onClose: () => resolve(null)
      });
      dialog.render(true);
    });
  }
}
