
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Parse a combined damage string (e.g. "2L", "D", "sC") into its components.
 * The stored `damage` field uses the format `[count]type`, where count is omitted when 1.
 * Examples: "D" → {damageCount:1, damageType:"D"}, "2L" → {damageCount:2, damageType:"L"}.
 *
 * @param {string} damage - Raw damage string from actionDef.damage.
 * @returns {{ damageCount: number, damageType: string }}
 */
function _parseDamage(damage) {
  if (!damage || damage === "—") return { damageCount: 1, damageType: "—" };
  const m = damage.match(/^(\d+)([A-Za-z]+)$/);
  if (m) return { damageCount: parseInt(m[1]), damageType: m[2] };
  return { damageCount: 1, damageType: damage };
}

/**
 * Build a combined damage string from count + type components.
 * When count is 1 the prefix is omitted ("D", not "1D").
 * When type is "—" (no damage), always returns "—".
 *
 * @param {number|string} count - Number of hits (1–9).
 * @param {string}        type  - Damage type key ("D", "L", "C", "K", "sD", "sL", "sC", "sK").
 * @returns {string}
 */
function _buildDamage(count, type) {
  if (!type || type === "—") return "—";
  const n = parseInt(count) || 1;
  return n > 1 ? `${n}${type}` : type;
}

/**
 * Popup editor for a single Action Definition stored on an ActiveEffect.
 *
 * Action definitions (actionDefs) are declarative action descriptors attached to effect's
 * system data. They are referenced in getMeleeActions scripts by ID via:
 *   args.actions.push("PASTE_ID_HERE")
 *
 * Each actionDef stores:
 *   - id          {string}  — auto-generated ID (foundry.utils.randomID()), read-only after creation.
 *   - name        {string}  — human-readable display name shown on the duel card.
 *   - damage      {string}  — combined damage string ("D", "2L", "sC" …) or "—" for no damage.
 *   - successCost {number}  — minimum successes required to use this action.
 *   - minDice     {number}  — minimum declared dice count for this action to be available.
 *   - maxDice     {number}  — maximum declared dice count for this action to be available.
 *   - immediateOnHit {boolean} — when true, onHitScript fires at resolution time, not at "Apply Damage".
 *   - onHitScript {string}  — optional JS code executed on hit; receives args: actor, target, state, hit.
 *                             When non-empty, replaces default damage application.
 *                             Use this.effect.parent.effects.getName("...").convertToApplied() to apply AEs.
 */
export class NeuroshimaActionDefEditor extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  /**
   * @param {ActiveEffect} effect  - The parent ActiveEffect that owns this actionDef array.
   * @param {number}       index   - Index into effect.system.actionDefs[].
   * @param {object}       [options]
   */
  constructor(effect, index, options = {}) {
    super(options);
    this.effect = effect;
    this.defIndex = index;
    this._cmSaveTimer = null;
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["neuroshima", "script-editor"],
    window: { resizable: true },
    position: { width: 640, height: 560 }
  };

  static PARTS = {
    form: { template: "systems/neuroshima/templates/apps/action-def-editor.hbs" }
  };

  /**
   * Always return a fresh reference to the effect to avoid stale data after updates.
   * @returns {ActiveEffect}
   */
  get _freshEffect() {
    return fromUuidSync(this.effect.uuid) ?? this.effect;
  }

  get title() {
    const defs = this._freshEffect.system?.actionDefs ?? [];
    const def = defs[this.defIndex];
    return def?.name || def?.id || "Definicja akcji";
  }

  /**
   * Build template context. The stored `damage` combined string is split into
   * `damageCount` (number input) and `damageType` (select) for the form UI.
   * @override
   */
  async _prepareContext(options) {
    const defs = this._freshEffect.system?.actionDefs ?? [];
    const raw = foundry.utils.deepClone(defs[this.defIndex]) || {
      id: "", name: "", damage: "—", successCost: 1, minDice: 1, maxDice: 3,
      immediateOnHit: false, onHitScript: ""
    };
    const { damageCount, damageType } = _parseDamage(raw.damage);
    const actionDef = { ...raw, damageCount, damageType };
    actionDef.onHitScript    = (actionDef.onHitScript ?? "").trimEnd();
    actionDef.immediateOnHit = actionDef.immediateOnHit ?? false;
    const pushSnippet = actionDef.id
      ? `args.actions.push("${actionDef.id}");`
      : "";

    const config = game.neuroshima?.config ?? {};
    const damageTypeOptions = Object.keys(config.damageTypes ?? {}).map(key => ({
      value: key,
      label: `${key} — ${game.i18n.localize(`NEUROSHIMA.Damage.Full.${key}`)}`
    }));

    return { actionDef, index: this.defIndex, damageTypeOptions, pushSnippet };
  }

  /**
   * Wire up all form input listeners and button handlers.
   * Changes auto-persist to the effect via _persist() on every interaction.
   * The CodeMirror editor persists with a 400 ms debounce to avoid excessive updates.
   * @override
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const form = this.element;

    form.querySelector('input[name="name"]')?.addEventListener("change", () => this._persist(form));

    const damageTypeSelect = form.querySelector('select[name="damageType"]');
    const damageCountInput = form.querySelector('input[name="damageCount"]');

    damageTypeSelect?.addEventListener("change", () => {
      if (damageCountInput) damageCountInput.disabled = (damageTypeSelect.value === "—");
      this._persist(form);
    });
    damageCountInput?.addEventListener("change", () => this._persist(form));

    for (const name of ["successCost", "minDice", "maxDice"]) {
      form.querySelector(`input[name="${name}"]`)?.addEventListener("change", () => this._persist(form));
    }

    form.querySelector('input[name="immediateOnHit"]')?.addEventListener("change", () => this._persist(form));

    form.querySelector('code-mirror[name="onHitScript"]')?.addEventListener("change", () => {
      clearTimeout(this._cmSaveTimer);
      this._cmSaveTimer = setTimeout(() => this._persist(form), 400);
    });

    form.querySelector(".ns-se-save-btn")?.addEventListener("click", async () => {
      await this._persist(form);
      await this.close();
    });

    form.querySelector(".ns-copy-snippet-btn")?.addEventListener("click", () => {
      const defs = this._freshEffect.system?.actionDefs ?? [];
      const id = defs[this.defIndex]?.id ?? "";
      if (!id) return;
      const snippet = `args.actions.push("${id}");`;
      navigator.clipboard.writeText(snippet).then(() => ui.notifications.info(`Skopiowano snippet`));
    });

    const header = this.element.querySelector(".window-header");
    if (header && !header.querySelector(".ns-copy-id-header-btn")) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "ns-copy-id-header-btn";
      copyBtn.title = "Kopiuj ID akcji";
      copyBtn.dataset.tooltip = "Kopiuj ID akcji";
      copyBtn.innerHTML = `<i class="fa-solid fa-copy"></i>`;
      copyBtn.addEventListener("click", () => {
        const defs = this._freshEffect.system?.actionDefs ?? [];
        const id = defs[this.defIndex]?.id ?? "";
        if (id) navigator.clipboard.writeText(id).then(() => ui.notifications.info(`Skopiowano ID: ${id}`));
      });
      const closeBtn = header.querySelector('[data-action="close"], .close, .header-close');
      if (closeBtn) header.insertBefore(copyBtn, closeBtn);
      else header.appendChild(copyBtn);
    }
  }

  /**
   * Read all form fields and persist the updated actionDef back to the effect.
   * The `damage` combined string is re-built from `damageCount` + `damageType`.
   * The `id` field is intentionally never read from the form — it is auto-generated
   * at creation time (foundry.utils.randomID()) and immutable afterwards.
   *
   * @param {HTMLElement} form - Root element of the rendered application.
   * @returns {Promise<void>}
   */
  async _persist(form) {
    const effect = this._freshEffect;
    const defs = foundry.utils.deepClone(effect.system?.actionDefs ?? []);
    if (!defs[this.defIndex]) return;
    const d = defs[this.defIndex];

    const read = (name) => form.querySelector(`[name="${name}"]`)?.value ?? d[name];
    const readNum = (name) => {
      const v = parseInt(form.querySelector(`[name="${name}"]`)?.value ?? "");
      return isNaN(v) ? d[name] : v;
    };

    d.name           = read("name");
    d.damage         = _buildDamage(read("damageCount"), read("damageType"));
    d.successCost    = readNum("successCost");
    d.minDice        = readNum("minDice");
    d.maxDice        = readNum("maxDice");
    d.immediateOnHit = form.querySelector('input[name="immediateOnHit"]')?.checked ?? false;

    const cmEl = form.querySelector('code-mirror[name="onHitScript"]');
    if (cmEl !== null && cmEl !== undefined) d.onHitScript = cmEl.value ?? d.onHitScript;

    await effect.update({ "system.actionDefs": defs });
    this.effect = this._freshEffect;
  }
}
