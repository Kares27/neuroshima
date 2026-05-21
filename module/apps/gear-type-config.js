const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class GearTypeConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "gear-type-config",
        tag: "form",
        classes: ["neuroshima", "gear-type-config"],
        window: {
            title: "NEUROSHIMA.Settings.CustomGearTypes.Title",
            resizable: true
        },
        position: {
            width: 420,
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
            addGearTypeRow: GearTypeConfig.prototype._onAddRow,
            deleteGearTypeRow: GearTypeConfig.prototype._onDeleteRow
        }
    };

    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/gear-type-config.hbs"
        }
    };

    async _prepareContext(options) {
        const entries = this._pendingEntries ?? this._loadEntries();
        return { entries };
    }

    _loadEntries() {
        try {
            return JSON.parse(game.settings.get("neuroshima", "customGearTypes") || "[]");
        } catch(e) {
            return [];
        }
    }

    _captureEntries() {
        const fd = new FormDataExtended(this.element);
        const data = fd.object;
        const entries = [];
        let idx = 0;
        while (data[`entry.${idx}`] !== undefined) {
            const val = String(data[`entry.${idx}`] ?? "").trim();
            if (val) entries.push(val);
            idx++;
        }
        return entries;
    }

    async _onAddRow(event, target) {
        this._pendingEntries = [...this._captureEntries(), ""];
        this.render();
    }

    async _onDeleteRow(event, target) {
        const idx = parseInt(target.dataset.index ?? "-1");
        if (idx < 0) return;
        const entries = this._captureEntries();
        entries.splice(idx, 1);
        this._pendingEntries = entries;
        this.render();
    }

    async _onSubmit(event, form, formData) {
        const entries = this._captureEntries();
        await game.settings.set("neuroshima", "customGearTypes", JSON.stringify(entries));

        const NEUROSHIMA = game.neuroshima.config;
        for (const [key] of Object.entries(NEUROSHIMA.gearTypes)) {
            if (key === NEUROSHIMA.gearTypes[key] && key !== "misc") {
                delete NEUROSHIMA.gearTypes[key];
            }
        }
        for (const label of entries) {
            if (label) NEUROSHIMA.gearTypes[label] = label;
        }

        if (game.modules.get("item-piles")?.active) {
            try {
                const gearTypeLabels = Object.entries(NEUROSHIMA.gearTypes)
                    .filter(([key]) => key !== "misc")
                    .map(([, val]) => game.i18n.localize(val));
                const existing = game.settings.get("item-piles", "customItemCategories") ?? [];
                const merged = Array.from(new Set([...existing, ...gearTypeLabels]));
                await game.settings.set("item-piles", "customItemCategories", merged);
            } catch(e) {}
        }

        this._pendingEntries = null;
        ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.CustomGearTypes.Saved"));
    }
}
