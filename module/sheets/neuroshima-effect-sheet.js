import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

/**
 * Custom Active Effect configuration sheet for Neuroshima 1.5.
 * Extends ActiveEffectConfig directly (which already uses HandlebarsApplicationMixin).
 * Adds a "Scripts" tab alongside the standard Details and Changes tabs.
 *
 * Scripts are stored in flags.neuroshima.scripts as:
 * [{ trigger: string, label: string, code: string }]
 */
export class NeuroshimaEffectSheet extends foundry.applications.sheets.ActiveEffectConfig {
  static DEFAULT_OPTIONS = {
    ...foundry.applications.sheets.ActiveEffectConfig.DEFAULT_OPTIONS,
    classes: ["neuroshima", "sheet", "effect"],
    position: {
      width: 580,
      height: 560
    },
    window: {
      resizable: true
    },
    actions: {
      ...foundry.applications.sheets.ActiveEffectConfig.DEFAULT_OPTIONS?.actions,
      addScript: NeuroshimaEffectSheet.prototype._onAddScript,
      removeScript: NeuroshimaEffectSheet.prototype._onRemoveScript,
      runManualScript: NeuroshimaEffectSheet.prototype._onRunManualScript
    }
  };

  static TABS = {
    sheet: {
      initial: "details",
      tabs: [
        { id: "details",  group: "sheet", label: "NEUROSHIMA.Tabs.Details" },
        { id: "duration", group: "sheet", label: "NEUROSHIMA.Tabs.Duration" },
        { id: "changes",  group: "sheet", label: "NEUROSHIMA.Tabs.Changes" },
        { id: "scripts",  group: "sheet", label: "NEUROSHIMA.Tabs.Scripts" }
      ]
    }
  };

  static PARTS = {
    header:  { template: "systems/neuroshima/templates/apps/effect-sheet-header.hbs" },
    tabs:    { template: "templates/generic/tab-navigation.hbs" },
    details:  { template: "systems/neuroshima/templates/apps/effect-sheet-details.hbs" },
    duration: { template: "systems/neuroshima/templates/apps/effect-sheet-duration.hbs" },
    changes:  { template: "systems/neuroshima/templates/apps/effect-sheet-changes.hbs" },
    scripts:  { template: "systems/neuroshima/templates/apps/effect-sheet-scripts.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const effect = this.document;

    context.effect  = effect;
    context.tabs    = this._getTabs();
    context.scripts = foundry.utils.deepClone(effect.getFlag("neuroshima", "scripts") || []);
    context.triggers = NeuroshimaScriptRunner.TRIGGERS;
    context.isEmbedded = effect.isEmbedded;
    context.actor   = effect.actor;

    return context;
  }

  _getTabs() {
    const activeTab = this.tabGroups?.sheet || "details";
    return foundry.utils.deepClone(this.constructor.TABS.sheet.tabs).reduce((obj, t) => {
      obj[t.id] = {
        ...t,
        active:   activeTab === t.id,
        cssClass: activeTab === t.id ? "active" : ""
      };
      return obj;
    }, {});
  }

  async _onAddScript(event, target) {
    const scripts = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    scripts.push({ trigger: "prepareData", label: game.i18n.localize("NEUROSHIMA.Scripts.NewScript"), code: "" });
    await this.document.setFlag("neuroshima", "scripts", scripts);
    this.render();
  }

  async _onRemoveScript(event, target) {
    const index = parseInt(target.dataset.index);
    const scripts = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    scripts.splice(index, 1);
    await this.document.setFlag("neuroshima", "scripts", scripts);
    this.render();
  }

  async _onRunManualScript(event, target) {
    const index = parseInt(target.dataset.index);
    const actor = this.document.actor;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Scripts.NoActor"));
      return;
    }
    await NeuroshimaScriptRunner.executeManual(actor, this.document, index);
  }

  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);

    const scripts = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    if (data.scripts) {
      for (const [idx, scriptUpdate] of Object.entries(data.scripts)) {
        const i = parseInt(idx);
        if (scripts[i]) foundry.utils.mergeObject(scripts[i], scriptUpdate);
      }
      delete data.scripts;
    }

    if (scripts.length > 0 || this.document.getFlag("neuroshima", "scripts")) {
      foundry.utils.setProperty(data, "flags.neuroshima.scripts", scripts);
    }

    return data;
  }
}
