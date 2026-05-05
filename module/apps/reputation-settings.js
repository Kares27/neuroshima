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
            width: 520,
            height: "auto"
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
        const testMode = game.settings.get("neuroshima", "reputationTestMode");
        const repMin = game.settings.get("neuroshima", "reputationMin");
        const repMax = game.settings.get("neuroshima", "reputationMax");
        const useColors = game.settings.get("neuroshima", "reputationUseColors");
        const colorNames = game.settings.get("neuroshima", "reputationColorNames") ?? false;
        const relationTable = game.settings.get("neuroshima", "reputationRelationTable") ?? [];
        const fameThreshold = game.settings.get("neuroshima", "reputationFameThreshold") ?? 20;
        const famePoints = game.settings.get("neuroshima", "reputationFamePoints") ?? 1;

        return {
            config: {
                testMode,
                repMin,
                repMax,
                useColors,
                colorNames,
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

        const fameThreshold = Math.max(1, Number(data.fameThreshold ?? 20));
        const famePoints = Math.max(1, Number(data.famePoints ?? 1));

        await Promise.all([
            game.settings.set("neuroshima", "reputationTestMode", data.testMode ?? "skill"),
            game.settings.set("neuroshima", "reputationMin", repMin),
            game.settings.set("neuroshima", "reputationMax", repMax),
            game.settings.set("neuroshima", "reputationUseColors", !!data.useColors),
            game.settings.set("neuroshima", "reputationColorNames", !!data.colorNames),
            game.settings.set("neuroshima", "reputationRelationTable", relationTable),
            game.settings.set("neuroshima", "reputationFameThreshold", fameThreshold),
            game.settings.set("neuroshima", "reputationFamePoints", famePoints)
        ]);

        ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.ReputationConfig.Saved"));
    }

    _extractRelationTable(data) {
        const table = [];
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

    async _onAddGlobalRelationRow(event, target) {
        const table = game.settings.get("neuroshima", "reputationRelationTable") ?? [];
        table.push({ minVal: 0, maxVal: 0, name: "", color: "" });
        await game.settings.set("neuroshima", "reputationRelationTable", table);
        this.render();
    }

    async _onDeleteGlobalRelationRow(event, target) {
        const idx = parseInt(target.dataset.index ?? "-1");
        if (idx < 0) return;
        const table = Array.from(game.settings.get("neuroshima", "reputationRelationTable") ?? []);
        table.splice(idx, 1);
        await game.settings.set("neuroshima", "reputationRelationTable", table);
        this.render();
    }
}
