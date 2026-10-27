import { exportSystemSettings, planSettingsImport, importSystemSettings, SettingsTransferError } from "../../helpers/settings-transfer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SettingsTransferConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "neuroshima-settings-transfer",
    tag: "form",
    classes: ["neuroshima", "neuroshima-settings", "settings-transfer-config"],
    window: { title: "NEUROSHIMA.Settings.Transfer.Title", resizable: true },
    position: { width: 620, height: "auto" },
    form: { submitOnChange: false, closeOnSubmit: false, handler: async function() {} },
    actions: {
      exportSettings: SettingsTransferConfig.prototype._onExport,
      importSettings: SettingsTransferConfig.prototype._onImport
    }
  };

  static PARTS = {
    form: { template: "systems/neuroshima/templates/apps/settings-transfer-config.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const plan = this._plan;
    return { ...context, busy: !!this._busy, canImport: !!plan && !this._busy,
      fileName: this._fileName ?? "", hasPreview: !!plan,
      sourceVersion: plan?.systemVersion,
      summary: plan ? game.i18n.format("NEUROSHIMA.Settings.Transfer.Summary", {
        count: plan.entries.length, changes: plan.changes.length, skipped: plan.skipped.length
      }) : "",
      changes: plan?.changes.map(entry => ({ key: entry.key, label: game.i18n.localize(entry.label) })) ?? [],
      skipped: plan?.skipped ?? []
    };
  }

  _reportError(error) {
    const code = error instanceof SettingsTransferError ? error.code : "Unexpected";
    console.error("Neuroshima | Settings transfer failed", error);
    ui.notifications.error(game.i18n.format(`NEUROSHIMA.Settings.Transfer.Errors.${code}`, error.details ?? {}));
  }

  async _onChangeForm(formConfig, event) {
    if (event.target?.name !== "settingsFile") return super._onChangeForm(formConfig, event);
    if (this._busy) return;
    const selection = this._fileSelection = (this._fileSelection ?? 0) + 1;
    this._plan = null;
    this._bundle = null;
    const file = event.target.files?.[0];
    this._fileName = file?.name ?? "";
    try {
      if (file) {
        const text = await file.text();
        if (selection !== this._fileSelection) return;
        this._plan = planSettingsImport(text);
        this._bundle = text;
      }
    } catch (error) { this._reportError(error); }
    if (selection === this._fileSelection) await this.render({ force: true });
  }

  async _onExport() {
    if (this._busy) return;
    try {
      const bundle = exportSystemSettings();
      foundry.utils.saveDataToFile(JSON.stringify(bundle, null, 2), "application/json",
        `neuroshima-settings-${bundle.exportedAt.slice(0, 10)}.json`);
    } catch (error) { this._reportError(error); }
  }

  async _onImport() {
    if (!this._bundle || this._busy) return;
    this._busy = true;
    await this.render({ force: true });
    try {
      const plan = await importSystemSettings(this._bundle);
      this._plan = null;
      this._bundle = null;
      ui.notifications.info(game.i18n.format("NEUROSHIMA.Settings.Transfer.Imported", { count: plan.changes.length }));
      await this.close();
      if (plan.changes.length) SettingsConfig.reloadConfirm({ world: true });
    } catch (error) {
      this._reportError(error);
      this._busy = false;
      await this.render({ force: true });
    } finally { this._busy = false; }
  }
}
