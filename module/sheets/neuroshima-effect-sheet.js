import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

const BaseEffectSheet = foundry.applications.sheets.ActiveEffectConfig;

export class NeuroshimaEffectSheet extends BaseEffectSheet {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    foundry.utils.deepClone(BaseEffectSheet.DEFAULT_OPTIONS),
    {
      classes: [
        ...(BaseEffectSheet.DEFAULT_OPTIONS.classes ?? []),
        "neuroshima",
        "effect"
      ],
      actions: {
        ...(BaseEffectSheet.DEFAULT_OPTIONS.actions ?? {}),
        addScript: NeuroshimaEffectSheet.prototype._onAddScript,
        removeScript: NeuroshimaEffectSheet.prototype._onRemoveScript,
        runManualScript: NeuroshimaEffectSheet.prototype._onRunManualScript,
        editScript: NeuroshimaEffectSheet.prototype._onEditScript
      }
    },
    { inplace: false }
  );

  static PARTS = {
    ...BaseEffectSheet.PARTS,
    scripts: {
      template: "systems/neuroshima/templates/apps/effect-sheet-scripts.hbs"
    }
  };

  static TABS = {
    ...BaseEffectSheet.TABS,
    sheet: {
      ...(BaseEffectSheet.TABS?.sheet ?? {}),
      tabs: [
        ...(BaseEffectSheet.TABS?.sheet?.tabs ?? []),
        { id: "scripts", icon: "fa-solid fa-code", label: "NEUROSHIMA.Tabs.Scripts" }
      ]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.scripts  = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    context.triggers = NeuroshimaScriptRunner.TRIGGERS;
    return context;
  }

  async _onAddScript(event, target) {
    const scripts = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    const newIndex = scripts.length;
    scripts.push({ trigger: "manual", label: game.i18n.localize("NEUROSHIMA.Scripts.NewScript"), code: "" });
    await this.document.setFlag("neuroshima", "scripts", scripts);
    const { NeuroshimaScriptEditor } = await import("../apps/neuroshima-script-editor.js");
    new NeuroshimaScriptEditor(this.document, newIndex).render(true);
    this.render();
  }

  async _onRemoveScript(event, target) {
    const index = parseInt(target.closest("[data-index]")?.dataset.index ?? target.dataset.index);
    const scripts = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    scripts.splice(index, 1);
    await this.document.setFlag("neuroshima", "scripts", scripts);
    this.render();
  }

  async _onEditScript(event, target) {
    const index = parseInt(target.closest("[data-index]")?.dataset.index ?? target.dataset.index);
    const { NeuroshimaScriptEditor } = await import("../apps/neuroshima-script-editor.js");
    new NeuroshimaScriptEditor(this.document, index).render(true);
  }

  async _onRunManualScript(event, target) {
    const index = parseInt(target.closest("[data-index]")?.dataset.index ?? target.dataset.index);
    const actor = this.document.actor;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Scripts.NoActor"));
      return;
    }
    await NeuroshimaScriptRunner.executeManual(actor, this.document, index);
  }
}
