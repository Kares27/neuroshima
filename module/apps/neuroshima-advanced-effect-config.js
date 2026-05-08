
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class NeuroshimaAdvancedEffectConfig extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(effect, options = {}) {
    super(options);
    this.effect = effect;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "advanced-effect-config-dialog"],
    window: {
      resizable: true,
      title: "NEUROSHIMA.Scripts.AdvancedConfig",
      contentClasses: ["standard-form"]
    },
    position: { width: 600, height: 700 },
    form: {
      handler: NeuroshimaAdvancedEffectConfig._onSubmit,
      submitOnChange: true,
      closeOnSubmit: false
    },
    actions: {
      placeTemplate:     NeuroshimaAdvancedEffectConfig._onPlaceTemplate,
      configureTemplate: NeuroshimaAdvancedEffectConfig._onConfigureTemplate
    }
  };

  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/apps/advanced-effect-config.hbs",
      scrollable: [".advanced-effect-config"]
    }
  };

  get title() {
    return `${game.i18n.localize("NEUROSHIMA.Scripts.AdvancedConfig")} — ${this.effect.name}`;
  }

  async _prepareContext(options) {
    const ns = this.effect.flags?.neuroshima ?? {};
    const transferType = ns.transferType ?? "owningDocument";
    const isAura = transferType === "auraActor";
    const isArea = transferType === "areaActor";
    const isDocument = transferType === "owningDocument";

    return {
      transferType,
      isAura,
      isArea,
      isAuraOrArea:    isAura || isArea,
      isDocument,

      testIndependent: ns.testIndependent ?? false,
      avoidTestType:   ns.avoidTestType   ?? "none",
      avoidTestScript: ns.avoidTestScript ?? "",

      enableScript:    ns.enableScript    ?? "",
      preApplyScript:  ns.preApplyScript  ?? "",
      filterScript:    ns.filterScript    ?? "",
      prompt:          ns.prompt          ?? false,

      auraTransferred: ns.auraTransferred ?? false,
      auraRender:      ns.auraRender      ?? false,
      auraKeep:        ns.auraKeep        ?? false,
      auraRadius:      ns.auraRadius      ?? "",

      areaDuration:    ns.areaDuration    ?? "sustained",
    };
  }

  static async _onSubmit(event, form, formData) {
    const update = foundry.utils.expandObject(formData.object);
    await this.effect.update(update);
    this.render({ force: true });
  }

  static async _onPlaceTemplate(event, target) {
    const { NeuroshimaAuraManager } = await import("./aura-manager.js");
    const actor = this.effect.actor
      ?? game.user.character
      ?? canvas.tokens?.controlled?.[0]?.actor
      ?? null;
    await NeuroshimaAuraManager.placeAreaTemplate(this.effect, actor);
    await this.close();
  }

  static async _onConfigureTemplate(event, target) {
    const ns = this.effect.flags?.neuroshima ?? {};
    const tplData = ns.templateData ?? {};

    const current = {
      fillColor:   tplData.fillColor   ?? game.user?.color?.css ?? "#4444ff",
      borderColor: tplData.borderColor ?? tplData.fillColor ?? game.user?.color?.css ?? "#4444ff",
      fillOpacity: tplData.fillOpacity ?? 0.1
    };

    const content = `
      <form class="standard-form" style="display:flex;flex-direction:column;gap:0.5rem;padding:0.5rem;">
        <div class="form-group">
          <label>Fill Colour</label>
          <div class="form-fields">
            <input type="color" name="fillColor" value="${current.fillColor}" style="width:60px;height:28px;">
          </div>
        </div>
        <div class="form-group">
          <label>Border Colour</label>
          <div class="form-fields">
            <input type="color" name="borderColor" value="${current.borderColor}" style="width:60px;height:28px;">
          </div>
        </div>
        <div class="form-group">
          <label>Fill Opacity (0–1)</label>
          <div class="form-fields">
            <input type="number" name="fillOpacity" value="${current.fillOpacity}" min="0" max="1" step="0.05" style="width:80px;">
          </div>
        </div>
      </form>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Configure Template Data" },
      content,
      ok: {
        label: "Save",
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.querySelector("form");
          return {
            fillColor:   form.querySelector("[name=fillColor]").value,
            borderColor: form.querySelector("[name=borderColor]").value,
            fillOpacity: parseFloat(form.querySelector("[name=fillOpacity]").value) || 0.1
          };
        }
      }
    });

    if (!result) return;
    await this.effect.setFlag("neuroshima", "templateData", result);

    const { NeuroshimaAuraManager } = await import("./aura-manager.js");
    const actor = this.effect.actor ?? null;
    if (actor) {
      const tokenDoc = actor.getActiveTokens()[0]?.document ?? null;
      if (tokenDoc) {
        await NeuroshimaAuraManager._syncRenderTemplates(tokenDoc, actor, null, null);
      }
    }
  }
}
