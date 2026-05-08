import { NeuroshimaScriptRunner } from "./neuroshima-script-engine.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class NeuroshimaScriptEditor extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(effect, index, options = {}) {
    super(options);
    this.effect = effect;
    this.scriptIndex = index;
    this._cmSaveTimer = null;
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["neuroshima", "script-editor"],
    window: { resizable: true },
    position: { width: 640, height: 620 }
  };

  static PARTS = {
    form: { template: "systems/neuroshima/templates/apps/script-editor.hbs" }
  };

  get title() {
    const scripts = this.effect.getFlag("neuroshima", "scripts") || [];
    const label = scripts[this.scriptIndex]?.label;
    return label || game.i18n.localize("NEUROSHIMA.Scripts.NewScript");
  }

  async _prepareContext(options) {
    const scripts = this.effect.getFlag("neuroshima", "scripts") || [];
    const scriptData = foundry.utils.deepClone(scripts[this.scriptIndex]) || { trigger: "manual", label: "", code: "" };
    scriptData.code             = (scriptData.code             ?? "").trimEnd();
    scriptData.hideScript       = (scriptData.hideScript       ?? "").trimEnd();
    scriptData.activateScript   = (scriptData.activateScript   ?? "").trimEnd();
    scriptData.submissionScript = (scriptData.submissionScript ?? "").trimEnd();
    return {
      scriptData,
      triggers: NeuroshimaScriptRunner.TRIGGERS,
      index: this.scriptIndex
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const form = this.element;

    form.querySelector('select[name="trigger"]')?.addEventListener("change", async () => {
      await this._persist(form);
      this.render({ force: true });
    });

    form.querySelector('input[name="label"]')?.addEventListener("change", () => this._persist(form));
    form.querySelector('input[name="runIfDisabled"]')?.addEventListener("change", () => this._persist(form));
    form.querySelector('input[name="targeter"]')?.addEventListener("change", () => this._persist(form));
    form.querySelector('input[name="defendingAgainst"]')?.addEventListener("change", () => this._persist(form));

    form.querySelectorAll("code-mirror").forEach(cm => {
      cm.addEventListener("change", () => {
        clearTimeout(this._cmSaveTimer);
        this._cmSaveTimer = setTimeout(() => this._persist(form), 400);
      });
    });

    form.querySelector(".ns-se-save-btn")?.addEventListener("click", async () => {
      await this._persist(form);
      await this.close();
    });
  }

  _readCmValue(form, name) {
    return form.querySelector(`code-mirror[name="${name}"]`)?.value ?? undefined;
  }

  async _persist(form) {
    const scripts = foundry.utils.deepClone(this.effect.getFlag("neuroshima", "scripts") || []);
    if (!scripts[this.scriptIndex]) return;
    const s = scripts[this.scriptIndex];

    const labelEl = form.querySelector('input[name="label"]');
    if (labelEl) s.label = labelEl.value;

    const triggerEl = form.querySelector('select[name="trigger"]');
    if (triggerEl) s.trigger = triggerEl.value;

    const ridEl = form.querySelector('input[name="runIfDisabled"]');
    s.runIfDisabled = ridEl ? ridEl.checked : (s.runIfDisabled ?? false);

    const targeterEl = form.querySelector('input[name="targeter"]');
    s.targeter = targeterEl ? targeterEl.checked : (s.targeter ?? false);

    const defendingEl = form.querySelector('input[name="defendingAgainst"]');
    s.defendingAgainst = defendingEl ? defendingEl.checked : (s.defendingAgainst ?? false);

    const code = this._readCmValue(form, "code");
    if (code !== undefined) s.code = code;

    const hideScript = this._readCmValue(form, "hideScript");
    if (hideScript !== undefined) s.hideScript = hideScript;

    const activateScript = this._readCmValue(form, "activateScript");
    if (activateScript !== undefined) s.activateScript = activateScript;

    const submissionScript = this._readCmValue(form, "submissionScript");
    if (submissionScript !== undefined) s.submissionScript = submissionScript;

    await this.effect.setFlag("neuroshima", "scripts", scripts);
  }

}

