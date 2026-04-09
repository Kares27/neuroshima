import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";
import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Custom Active Effect configuration sheet for Neuroshima 1.5.
 * Extends the default ActiveEffectConfig with a "Scripts" tab.
 *
 * Scripts are stored in flags.neuroshima.scripts as:
 * [{ trigger: string, label: string, code: string }]
 */
export class NeuroshimaEffectSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActiveEffectConfig) {
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
    primary: {
      tabs: [
        { id: "details", group: "primary", label: "NEUROSHIMA.Tabs.Details" },
        { id: "changes", group: "primary", label: "NEUROSHIMA.Tabs.Changes" },
        { id: "scripts", group: "primary", label: "NEUROSHIMA.Tabs.Scripts" }
      ],
      initial: "details"
    }
  };

  static PARTS = {
    header: {
      template: "systems/neuroshima/templates/apps/effect-sheet-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    details: {
      template: "systems/neuroshima/templates/apps/effect-sheet-details.hbs"
    },
    changes: {
      template: "systems/neuroshima/templates/apps/effect-sheet-changes.hbs"
    },
    scripts: {
      template: "systems/neuroshima/templates/apps/effect-sheet-scripts.hbs"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const effect = this.document;

    context.effect = effect;
    context.tabs = this._getTabs();
    context.scripts = foundry.utils.deepClone(effect.getFlag("neuroshima", "scripts") || []);
    context.triggers = NeuroshimaScriptRunner.TRIGGERS;
    context.isEmbedded = effect.isEmbedded;
    context.actor = effect.actor;

    return context;
  }

  _getTabs() {
    const activeTab = this.tabGroups?.primary || "details";
    const tabs = {};
    for (const tabData of this.constructor.TABS.primary.tabs) {
      tabs[tabData.id] = {
        ...tabData,
        active: activeTab === tabData.id,
        cssClass: activeTab === tabData.id ? "active" : ""
      };
    }
    return tabs;
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

  async _processFormData(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);

    const scripts = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    if (data.scripts) {
      for (const [idx, scriptUpdate] of Object.entries(data.scripts)) {
        const i = parseInt(idx);
        if (scripts[i]) {
          foundry.utils.mergeObject(scripts[i], scriptUpdate);
        }
      }
      delete data.scripts;
    }

    const updateData = foundry.utils.flattenObject(data);
    if (scripts) updateData["flags.neuroshima.scripts"] = scripts;
    await this.document.update(updateData);
  }
}
