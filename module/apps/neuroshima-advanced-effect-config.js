
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class NeuroshimaAdvancedEffectConfig extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(effect, options = {}) {
    super(options);
    this.effect = effect;
    this._cmSaveTimer = null;
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

    const rt = ns.requiredTestTrigger ?? {};

    const onSuccessEffectIds = Array.isArray(rt.onSuccessEffectIds) ? rt.onSuccessEffectIds : [];
    const onFailureEffectIds = Array.isArray(rt.onFailureEffectIds) ? rt.onFailureEffectIds : [];

    const parentItem = this.effect.parent?.documentName === "Item" ? this.effect.parent : null;
    const siblingEffects = parentItem
      ? parentItem.effects
          .filter(e => e.id !== this.effect.id)
          .map(e => ({
            id:        e.id,
            name:      e.name,
            isSuccess: onSuccessEffectIds.includes(e.id),
            isFailure: onFailureEffectIds.includes(e.id)
          }))
      : [];

    const nsConfig = game.neuroshima?.config ?? {};
    const testAttributes = Object.fromEntries(
      Object.entries(nsConfig.attributes ?? {}).map(([k, v]) => [k, v.label ?? k])
    );

    const skillConfig = nsConfig.skillConfiguration ?? {};
    const testSkillGroups = Object.entries(skillConfig).map(([attrKey, groups]) => {
      const cap = attrKey.charAt(0).toUpperCase() + attrKey.slice(1);
      const skills = Object.values(groups).flat().map(skill => ({
        key: skill,
        label: game.i18n.localize(`NEUROSHIMA.Skills.${skill}`)
      })).sort((a, b) => a.label.localeCompare(b.label));
      return { attrKey, attrLabel: game.i18n.localize(`NEUROSHIMA.Attributes.${cap}`), skills };
    });

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

      requiredTestTrigger: {
        enabled:               rt.enabled              ?? false,
        title:                 rt.title                ?? "",
        description:           rt.description          ?? "",
        testType:              rt.testType             ?? "attribute",
        testKey:               rt.testKey              ?? "constitution",
        testAttributeOverride: rt.testAttributeOverride ?? "",
        requiredSuccesses:     rt.requiredSuccesses    ?? 1,
        isOpen:                rt.isOpen               ?? false,
        baseDifficulty:        rt.baseDifficulty       ?? "average",
        onSuccessEffectIds,
        onFailureEffectIds
      },
      difficulties:      nsConfig.difficulties ?? {},
      siblingEffects,
      testAttributes,
      testSkillGroups
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const form = this.element;
    form.querySelectorAll("code-mirror").forEach(cm => {
      cm.addEventListener("change", () => {
        clearTimeout(this._cmSaveTimer);
        this._cmSaveTimer = setTimeout(() => this._saveFromCodeMirror(form), 400);
      });
    });
    form.querySelectorAll("input[data-rt-role]").forEach(cb => {
      cb.addEventListener("change", () => form.requestSubmit());
    });
  }

  async _saveFromCodeMirror(form) {
    const fd = new FormDataExtended(form);
    const update = foundry.utils.expandObject(fd.object);
    form.querySelectorAll("code-mirror[name]").forEach(cm => {
      foundry.utils.setProperty(update, cm.getAttribute("name"), cm.value ?? "");
    });
    const successIds = [...form.querySelectorAll("input[data-rt-role='success']:checked")]
      .map(el => el.value).filter(Boolean);
    const failureIds = [...form.querySelectorAll("input[data-rt-role='failure']:checked")]
      .map(el => el.value).filter(Boolean);
    foundry.utils.setProperty(update, "flags.neuroshima.requiredTestTrigger.onSuccessEffectIds", successIds);
    foundry.utils.setProperty(update, "flags.neuroshima.requiredTestTrigger.onFailureEffectIds", failureIds);
    await this.effect.update(update);
    this.render({ force: true });
  }

  static async _onSubmit(event, form, formData) {
    const update = foundry.utils.expandObject(formData.object);
    form.querySelectorAll("code-mirror[name]").forEach(cm => {
      foundry.utils.setProperty(update, cm.getAttribute("name"), cm.value ?? "");
    });

    const successIds = [...form.querySelectorAll("input[data-rt-role='success']:checked")]
      .map(el => el.value).filter(Boolean);
    const failureIds = [...form.querySelectorAll("input[data-rt-role='failure']:checked")]
      .map(el => el.value).filter(Boolean);
    foundry.utils.setProperty(update, "flags.neuroshima.requiredTestTrigger.onSuccessEffectIds", successIds);
    foundry.utils.setProperty(update, "flags.neuroshima.requiredTestTrigger.onFailureEffectIds", failureIds);

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
