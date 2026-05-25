const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const DEFAULT_REP_IMG = "systems/neuroshima/assets/img/shaking-hands.svg";

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
            height: 680
        },
        form: {
            handler: async function(event, form, formData) {
                await this._onSubmit(event, form, formData);
            },
            submitOnChange: false,
            closeOnSubmit: true
        },
        actions: {
            addGlobalRelationRow:    ReputationSettingsApp.prototype._onAddGlobalRelationRow,
            deleteGlobalRelationRow: ReputationSettingsApp.prototype._onDeleteGlobalRelationRow,
            addDefaultRepItem:       ReputationSettingsApp.prototype._onAddDefaultRepItem,
            deleteDefaultRepItem:    ReputationSettingsApp.prototype._onDeleteDefaultRepItem,
            browseRepItemImg:        ReputationSettingsApp.prototype._onBrowseRepItemImg
        }
    };

    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/reputation-settings.hbs",
            scrollable: [".rep-settings-scroll"]
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
        const defaultRepItems = s?.defaultRepItems ?? game.settings.get("neuroshima", "defaultReputationItems") ?? [];

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
                famePoints,
                defaultRepItems: defaultRepItems.map(r => ({
                    name: r.name,
                    img: r.img || DEFAULT_REP_IMG,
                    imgDisplay: r.img || DEFAULT_REP_IMG
                })),
                hasDefaultRepItems: defaultRepItems.length > 0
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
        const defaultRepItems = this._extractDefaultRepItems(data);

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
            game.settings.set("neuroshima", "reputationFamePoints", famePoints),
            game.settings.set("neuroshima", "defaultReputationItems", defaultRepItems)
        ]);

        this._pendingState = null;
        ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.ReputationConfig.Saved"));
        SettingsConfig.reloadConfirm();
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

    _extractDefaultRepItems(data) {
        const items = [];
        const nested = Array.isArray(data.defaultRepItems) ? data.defaultRepItems : null;
        if (nested) {
            for (const row of nested) {
                if (row == null) continue;
                const name = String(row.name ?? "").trim();
                if (!name) continue;
                items.push({ name, img: String(row.img ?? "").trim() });
            }
            return items;
        }
        let idx = 0;
        while (data[`defaultRepItems.${idx}.name`] !== undefined) {
            const name = String(data[`defaultRepItems.${idx}.name`] ?? "").trim();
            if (name) {
                items.push({ name, img: String(data[`defaultRepItems.${idx}.img`] ?? "").trim() });
            }
            idx++;
        }
        return items;
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
            relationTable: this._extractRelationTable(data),
            defaultRepItems: this._extractDefaultRepItems(data)
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

    async _onAddDefaultRepItem(event, target) {
        const state = this._captureFormState();
        state.defaultRepItems.push({ name: "", img: "" });
        this._pendingState = state;
        this.render();
    }

    async _onDeleteDefaultRepItem(event, target) {
        const idx = parseInt(target.dataset.index ?? "-1");
        if (idx < 0) return;
        const state = this._captureFormState();
        state.defaultRepItems.splice(idx, 1);
        this._pendingState = state;
        this.render();
    }

    async _onBrowseRepItemImg(event, target) {
        const idx = parseInt(target.dataset.index ?? "-1");
        if (idx < 0) return;
        const current = this.element.querySelector(`input[name="defaultRepItems.${idx}.img"]`)?.value ?? DEFAULT_REP_IMG;
        new FilePicker({
            type: "imagevideo",
            current,
            callback: (path) => {
                const input = this.element.querySelector(`input[name="defaultRepItems.${idx}.img"]`);
                if (input) input.value = path;
                const preview = this.element.querySelector(`.rep-default-item-preview[data-index="${idx}"]`);
                if (preview) preview.src = path;
            }
        }).render(true);
    }
}
