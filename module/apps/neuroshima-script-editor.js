import { NeuroshimaScriptRunner } from "./neuroshima-script-engine.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class NeuroshimaScriptEditor extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(effect, index, options = {}) {
    super(options);
    this.effect = effect;
    this.scriptIndex = index;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "script-editor"],
    window: { resizable: true },
    position: { width: 600, height: 520 },
    form: {
      handler: NeuroshimaScriptEditor.prototype._onSave,
      closeOnSubmit: true,
      submitOnChange: false
    }
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
    return {
      scriptData,
      triggers: NeuroshimaScriptRunner.TRIGGERS,
      index: this.scriptIndex
    };
  }

  async _onSave(event, form, formData) {
    const data = formData.object;
    const scripts = foundry.utils.deepClone(this.effect.getFlag("neuroshima", "scripts") || []);
    if (scripts[this.scriptIndex]) {
      scripts[this.scriptIndex].label = data.label ?? scripts[this.scriptIndex].label;
      scripts[this.scriptIndex].trigger = data.trigger ?? scripts[this.scriptIndex].trigger;
      scripts[this.scriptIndex].code = data.code ?? scripts[this.scriptIndex].code;
      await this.effect.setFlag("neuroshima", "scripts", scripts);
    }
  }
}
