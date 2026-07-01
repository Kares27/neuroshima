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
      weaponModifier: 0, difficulty: null, hitLocation: null
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
    const td  = (content, style = "") => `<td style="padding:1px 3px;${style}">${content}</td>`;
    const tdr = (content, style = "") => td(content, `text-align:right;padding-left:8px;${style}`);
    const rows = [];
    rows.push(`<tr>${td(`<span style="opacity:.75">${userLabel}:</span>`)}${tdr(`<span style="opacity:.75">${sign(userVal)}</span>`)}</tr>`);
    if (breakdown.length) {
      rows.push(`<tr><td colspan="2" style="padding:2px 3px 0"><strong>${effectLabel}:</strong></td></tr>`);
      for (const e of breakdown) {
        rows.push(`<tr>${td(`&nbsp;&bull;&nbsp;${e.label}`)}${tdr(`<strong>${sign(e.value)}%</strong>`)}</tr>`);
      }
    }
    rows.push(`<tr style="border-top:1px solid rgba(255,255,255,.2)">${td(`<strong>${totalLabel}:</strong>`)}${tdr(`<strong>${sign(userVal + delta)}</strong>`)}</tr>`);
    return `<table style="border-collapse:collapse;white-space:nowrap">${rows.join("")}</table>`;
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

    const sign = v => v >= 0 ? `+${v}` : `${v}`;
    const actorArmor   = this.actor?.system?.combat?.totalArmorPenalty ?? 0;
    const actorWound   = this.actor?.system?.combat?.totalWoundPenalty ?? 0;
    const actorDisease = this._computeActorDiseasePenalty();
    const userLabel    = game.i18n.localize("NEUROSHIMA.Roll.UserEntry");
    const effectLabel  = game.i18n.localize("NEUROSHIMA.Roll.EffectBonus");
    const totalLabel   = game.i18n.localize("NEUROSHIMA.Roll.Total");

    const buildSimple = (base, delta) =>
      `<table style="border-collapse:collapse;white-space:nowrap">` +
      `<tr><td style="padding:1px 3px"><span style="opacity:.75">${userLabel}:</span></td><td style="padding:1px 3px;text-align:right;padding-left:8px"><span style="opacity:.75">${sign(base)}</span></td></tr>` +
      `<tr><td style="padding:1px 3px"><strong>${effectLabel}:</strong></td><td style="padding:1px 3px;text-align:right;padding-left:8px"><strong>${sign(delta)}</strong></td></tr>` +
      `<tr style="border-top:1px solid rgba(255,255,255,.2)"><td style="padding:1px 3px"><strong>${totalLabel}:</strong></td><td style="padding:1px 3px;text-align:right;padding-left:8px"><strong>${sign(base + delta)}</strong></td></tr>` +
      `</table>`;

    set("armorPenalty",   sf.armorDelta    ? buildSimple(actorArmor,   sf.armorDelta)    : null);
    set("woundPenalty",   sf.woundDelta    ? buildSimple(actorWound,   sf.woundDelta)    : null);
    set("diseasePenalty", sf.diseasePenalty? buildSimple(actorDisease, sf.diseasePenalty): null);
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
