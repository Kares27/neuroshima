const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Application V2 for configuring reputation-related settings.
 */
export class ReputationSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "reputation-settings",
        tag: "form",
        classes: ["neuroshima", "reputation-settings"],
        window: {
            title: "NEUROSHIMA.Settings.ReputationConfig.Title",
            resizable: true
        },
        position: {
            width: 540,
            height: 620
        },
        form: {
            handler: async function(event, form, formData) {
                await this._onSubmit(event, form, formData);
            },
            submitOnChange: false,
            closeOnSubmit: true
        },
        actions: {
            addGlobalRelationRow: ReputationSettingsApp.prototype._onAddGlobalRelationRow,
            deleteGlobalRelationRow: ReputationSettingsApp.prototype._onDeleteGlobalRelationRow
        }
    };

    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/reputation-settings.hbs"
        }
    };

    async _prepareContext(options) {
        const s = this._pendingState;
        const testMode = s?.testMode ?? game.settings.get("neuroshima", "reputationTestMode");
        const repMin = s?.repMin !== undefined ? s.repMin : game.settings.get("neuroshima", "reputationMin");
        const repMax = s?.repMax !== undefined ? s.repMax : game.settings.get("neuroshima", "reputationMax");
        const useColors = s ? !!s.useColors : game.settings.get("neuroshima", "reputationUseColors");
        const colorNames = s ? !!s.colorNames : (game.settings.get("neuroshima", "reputationColorNames") ?? false);
        const showAsProgressBar = s ? !!s.showAsProgressBar : (game.settings.get("neuroshima", "reputationShowAsProgressBar") ?? false);
        const fameThreshold = s?.fameThreshold !== undefined ? s.fameThreshold : (game.settings.get("neuroshima", "reputationFameThreshold") ?? 20);
        const famePoints = s?.famePoints !== undefined ? s.famePoints : (game.settings.get("neuroshima", "reputationFamePoints") ?? 1);
        const relationTable = s?.relationTable ?? game.settings.get("neuroshima", "reputationRelationTable") ?? [];

        return {
            config: {
                testMode,
                repMin,
                repMax,
                useColors,
                colorNames,
                showAsProgressBar,
                relationTable,
                fameThreshold,
                famePoints
            },
            testModeChoices: {
                skill: game.i18n.localize("NEUROSHIMA.Settings.ReputationTestMode.Skill"),
                simple: game.i18n.localize("NEUROSHIMA.Settings.ReputationTestMode.Simple")
            }
        };
    }

    async _onSubmit(event, form, formData) {
        const data = formData.object;

        const repMin = Number(data.repMin ?? 0);
        const repMax = Number(data.repMax ?? 20);

        if (repMin > repMax) {
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.Settings.ReputationConfig.MinMaxError"));
            return;
        }

        const relationTable = this._extractRelationTable(data);

        const fameThreshold = Math.max(0, Number(data.fameThreshold ?? 0));
        const famePoints = Math.max(0, Number(data.famePoints ?? 0));

        await Promise.all([
            game.settings.set("neuroshima", "reputationTestMode", data.testMode ?? "skill"),
            game.settings.set("neuroshima", "reputationMin", repMin),
            game.settings.set("neuroshima", "reputationMax", repMax),
            game.settings.set("neuroshima", "reputationUseColors", !!data.useColors),
            game.settings.set("neuroshima", "reputationColorNames", !!data.colorNames),
            game.settings.set("neuroshima", "reputationShowAsProgressBar", !!data.showAsProgressBar),
            game.settings.set("neuroshima", "reputationRelationTable", relationTable),
            game.settings.set("neuroshima", "reputationFameThreshold", fameThreshold),
            game.settings.set("neuroshima", "reputationFamePoints", famePoints)
        ]);

        this._pendingState = null;
        ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.ReputationConfig.Saved"));
    }

    _extractRelationTable(data) {
        const table = [];
        const nested = Array.isArray(data.relationTable) ? data.relationTable : null;
        if (nested) {
            for (const row of nested) {
                if (row == null) continue;
                table.push({
                    minVal: Number(row.minVal ?? 0),
                    maxVal: Number(row.maxVal ?? 0),
                    name: String(row.name ?? ""),
                    color: String(row.color ?? "")
                });
            }
            return table;
        }
        let idx = 0;
        while (data[`relationTable.${idx}.name`] !== undefined) {
            table.push({
                minVal: Number(data[`relationTable.${idx}.minVal`] ?? 0),
                maxVal: Number(data[`relationTable.${idx}.maxVal`] ?? 0),
                name: String(data[`relationTable.${idx}.name`] ?? ""),
                color: String(data[`relationTable.${idx}.color`] ?? "")
            });
            idx++;
        }
        return table;
    }

    _captureFormState() {
        const fd = new FormDataExtended(this.element);
        const data = fd.object;
        return {
            testMode: data.testMode ?? "skill",
            repMin: data.repMin !== undefined ? Number(data.repMin) : 0,
            repMax: data.repMax !== undefined ? Number(data.repMax) : 20,
            useColors: !!data.useColors,
            colorNames: !!data.colorNames,
            showAsProgressBar: !!data.showAsProgressBar,
            fameThreshold: data.fameThreshold !== undefined ? Number(data.fameThreshold) : 0,
            famePoints: data.famePoints !== undefined ? Number(data.famePoints) : 0,
            relationTable: this._extractRelationTable(data)
        };
    }

    async _onAddGlobalRelationRow(event, target) {
        const state = this._captureFormState();
        state.relationTable.push({ minVal: 0, maxVal: 0, name: "", color: "" });
        this._pendingState = state;
        this.render();
    }

    async _onDeleteGlobalRelationRow(event, target) {
        const idx = parseInt(target.dataset.index ?? "-1");
        if (idx < 0) return;
        const state = this._captureFormState();
        state.relationTable.splice(idx, 1);
        this._pendingState = state;
        this.render();
    }
}
