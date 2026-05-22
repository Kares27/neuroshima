const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class DamageCategoryConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "damage-category-config",
        tag: "form",
        classes: ["neuroshima", "damage-category-config"],
        window: {
            title: "NEUROSHIMA.Settings.DamageCategoryConfig.Title",
            resizable: true
        },
        position: { width: 500, height: "auto" },
        form: {
            handler: async function(event, form, formData) {
                await this._onSubmit(event, form, formData);
            },
            submitOnChange: false,
            closeOnSubmit: true
        },
        actions: {
            addCategoryRow:    DamageCategoryConfig.prototype._onAddRow,
            deleteCategoryRow: DamageCategoryConfig.prototype._onDeleteRow
        }
    };

    static PARTS = {
        form: { template: "systems/neuroshima/templates/apps/damage-category-config.hbs" }
    };

    _loadCustomCategories() {
        try {
            const raw = JSON.parse(game.settings.get("neuroshima", "customDamageCategories") || "[]");
            if (Array.isArray(raw)) return raw;
        } catch(e) {}
        return [];
    }

    async _prepareContext(options) {
        const NEUROSHIMA = game.neuroshima.config;
        const builtinRows = Object.entries(NEUROSHIMA.damageCategories)
            .filter(([key]) => ["physical", "explosive"].includes(key))
            .map(([key, cat]) => ({
                key,
                label: game.i18n.localize(cat.label),
                color: cat.color
            }));

        const customRows = (this._pendingCustom ?? this._loadCustomCategories()).map((c, i) => ({
            idx:   i,
            key:   c.key   ?? "",
            label: c.label ?? "",
            color: c.color ?? "#888888"
        }));

        return { builtinRows, customRows };
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        this._pendingCustom = null;
    }

    async _onSubmit(event, form, formData) {
        const data = formData.object;
        const custom = [];
        let i = 0;
        while (data[`custom.${i}.key`] !== undefined) {
            const key   = String(data[`custom.${i}.key`]   ?? "").trim().replace(/\s+/g, "_").toLowerCase();
            const label = String(data[`custom.${i}.label`] ?? "").trim();
            const color = String(data[`custom.${i}.color`] ?? "#888888").trim();
            if (key && label) custom.push({ key, label, color });
            i++;
        }
        await game.settings.set("neuroshima", "customDamageCategories", JSON.stringify(custom));
        _applyCustomDamageCategories(custom);
        ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.DamageCategoryConfig.Saved"));
    }

    async _onAddRow(event, target) {
        this._pendingCustom = this._captureCurrentCustom();
        this._pendingCustom.push({ key: "", label: "", color: "#888888" });
        this.render();
    }

    async _onDeleteRow(event, target) {
        const idx = parseInt(target.dataset.idx ?? "-1");
        if (idx < 0) return;
        this._pendingCustom = this._captureCurrentCustom();
        this._pendingCustom.splice(idx, 1);
        this.render();
    }

    _captureCurrentCustom() {
        const fd = new FormDataExtended(this.element);
        const data = fd.object;
        const custom = [];
        let i = 0;
        while (data[`custom.${i}.key`] !== undefined) {
            custom.push({
                key:   String(data[`custom.${i}.key`]   ?? "").trim(),
                label: String(data[`custom.${i}.label`] ?? "").trim(),
                color: String(data[`custom.${i}.color`] ?? "#888888").trim()
            });
            i++;
        }
        return custom;
    }
}

export function _applyCustomDamageCategories(customArray) {
    const NEUROSHIMA = game.neuroshima?.config;
    if (!NEUROSHIMA) return;
    for (const cat of (customArray ?? [])) {
        if (!cat.key || !cat.label) continue;
        NEUROSHIMA.damageCategories[cat.key] = { label: cat.label, color: cat.color ?? "#888888" };
    }
}
