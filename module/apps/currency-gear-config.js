const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export const DEFAULT_CURRENCY = {
    name: "Gamble",
    img: "systems/neuroshima/assets/img/banknote.svg",
    abbreviation: "{#}G",
    coinValue: 1,
    exchangeRate: 1,
    primary: true,
    weight: 0
};

export class CurrencyGearConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "currency-gear-config",
        tag: "form",
        classes: ["neuroshima", "currency-gear-config"],
        window: {
            title: "NEUROSHIMA.Settings.CurrencyGearConfig.Title",
            resizable: true
        },
        position: {
            width: 740,
            height: 640
        },
        form: {
            handler: async function(event, form, formData) {
                await this._onSubmit(event, form, formData);
            },
            submitOnChange: false,
            closeOnSubmit: true
        },
        actions: {
            addCurrencyRow:    CurrencyGearConfig.prototype._onAddCurrency,
            deleteCurrencyRow: CurrencyGearConfig.prototype._onDeleteCurrency,
            addGearTypeRow:    CurrencyGearConfig.prototype._onAddGearType,
            deleteGearTypeRow: CurrencyGearConfig.prototype._onDeleteGearType,
            browseCurrencyImg: CurrencyGearConfig.prototype._onBrowseCurrencyImg
        }
    };

    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/currency-gear-config.hbs"
        }
    };

    _loadState() {
        return {
            currencies:   this._loadCurrencies(),
            builtinMods:  this._loadBuiltinMods(),
            customTypes:  this._loadCustomTypes()
        };
    }

    _loadCurrencies() {
        try {
            const saved = JSON.parse(game.settings.get("neuroshima", "currencies") || "null");
            if (Array.isArray(saved) && saved.length) return saved;
        } catch(e) {}
        return [foundry.utils.deepClone(DEFAULT_CURRENCY)];
    }

    _loadBuiltinMods() {
        let modifiers = {};
        try { modifiers = JSON.parse(game.settings.get("neuroshima", "gearTypePriceModifiers") || "{}"); } catch(e) {}
        const NEUROSHIMA = game.neuroshima.config;
        const builtinMods = {};
        for (const [key, val] of Object.entries(NEUROSHIMA.gearTypes)) {
            if (key === "misc" || key === val) continue;
            const mod = modifiers[key];
            if (typeof mod === "number")               builtinMods[key] = { buy: mod,       sell: mod };
            else if (mod && typeof mod === "object")   builtinMods[key] = { buy: mod.buy ?? 1, sell: mod.sell ?? 1 };
            else                                       builtinMods[key] = { buy: 1, sell: 1 };
        }
        return builtinMods;
    }

    _loadCustomTypes() {
        let modifiers = {};
        try { modifiers = JSON.parse(game.settings.get("neuroshima", "gearTypePriceModifiers") || "{}"); } catch(e) {}
        try {
            const raw = JSON.parse(game.settings.get("neuroshima", "customGearTypes") || "[]");
            return raw.filter(l => l).map(label => {
                const mod = modifiers[label];
                let buy = 1, sell = 1;
                if (typeof mod === "number")             { buy = sell = mod; }
                else if (mod && typeof mod === "object") { buy = mod.buy ?? 1; sell = mod.sell ?? 1; }
                return { label, buy, sell };
            });
        } catch(e) { return []; }
    }

    async _prepareContext(options) {
        const state = this._pendingState ?? this._loadState();
        const NEUROSHIMA = game.neuroshima.config;
        const builtinRows = Object.entries(NEUROSHIMA.gearTypes)
            .filter(([key, val]) => key !== "misc" && key !== val)
            .map(([key, i18nKey]) => ({
                key,
                label: game.i18n.localize(i18nKey),
                buy:   (state.builtinMods[key]?.buy  ?? 1).toFixed(2),
                sell:  (state.builtinMods[key]?.sell ?? 1).toFixed(2)
            }));
        const customRows = (state.customTypes ?? []).map((t, i) => ({
            idx:   i,
            label: t.label,
            buy:   (t.buy  ?? 1).toFixed(2),
            sell:  (t.sell ?? 1).toFixed(2)
        }));
        const currencies = (state.currencies ?? []).map((c, i) => ({
            idx:          i,
            name:         c.name,
            img:          c.img,
            abbreviation: c.abbreviation,
            coinValue:    c.coinValue ?? 1,
            exchangeRate: c.exchangeRate ?? 1,
            primary:      !!c.primary
        }));
        const currencyNameLabel  = game.settings.get("neuroshima", "currencyNameLabel")  || "";
        const currencyValueLabel = game.settings.get("neuroshima", "currencyValueLabel") || "";
        return { currencies, builtinRows, customRows, currencyNameLabel, currencyValueLabel };
    }

    _captureState() {
        const fd   = new FormDataExtended(this.element);
        const data = fd.object;

        const primaryIdx = parseInt(data["currPrimary"] ?? "0");
        const currencies = [];
        for (let i = 0; data[`curr.${i}.name`] !== undefined; i++) {
            currencies.push({
                name:         String(data[`curr.${i}.name`]         ?? "").trim(),
                img:          String(data[`curr.${i}.img`]          ?? "").trim(),
                abbreviation: String(data[`curr.${i}.abbreviation`] ?? "").trim(),
                coinValue:    Math.max(1,     parseInt(data[`curr.${i}.coinValue`])    || 1),
                exchangeRate: Math.max(0.001, parseFloat(data[`curr.${i}.exchangeRate`]) || 1),
                weight:       Math.max(0,     parseFloat(data[`curr.${i}.weight`])     || 0),
                primary:      i === primaryIdx
            });
        }
        if (currencies.length && !currencies.some(c => c.primary)) currencies[0].primary = true;

        const NEUROSHIMA = game.neuroshima.config;
        const builtinMods = {};
        for (const [key, val] of Object.entries(NEUROSHIMA.gearTypes)) {
            if (key === "misc" || key === val) continue;
            builtinMods[key] = {
                buy:  Math.max(0, parseFloat(data[`builtin.${key}.buy`])  || 1),
                sell: Math.max(0, parseFloat(data[`builtin.${key}.sell`]) || 1)
            };
        }

        const customTypes = [];
        for (let i = 0; data[`custom.${i}.label`] !== undefined; i++) {
            const label = String(data[`custom.${i}.label`] ?? "").trim();
            if (!label) continue;
            customTypes.push({
                label,
                buy:  Math.max(0, parseFloat(data[`custom.${i}.buy`])  || 1),
                sell: Math.max(0, parseFloat(data[`custom.${i}.sell`]) || 1)
            });
        }

        const currencyNameLabel  = String(data["currencyNameLabel"]  ?? "").trim();
        const currencyValueLabel = String(data["currencyValueLabel"] ?? "").trim();

        return { currencies, builtinMods, customTypes, currencyNameLabel, currencyValueLabel };
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        if (this._pendingScrolls) {
            for (const [sel, top] of Object.entries(this._pendingScrolls)) {
                const el = this.element.querySelector(sel);
                if (el) el.scrollTop = top;
            }
            this._pendingScrolls = null;
        }
    }

    _saveScrolls() {
        const scrolls = {};
        for (const sel of [".cgc-scroll:not(.cgc-geartypes-scroll)", ".cgc-geartypes-scroll"]) {
            const el = this.element?.querySelector(sel);
            if (el) scrolls[sel] = el.scrollTop;
        }
        return scrolls;
    }

    async _onAddCurrency(event, target) {
        const scrolls = this._saveScrolls();
        const state = this._captureState();
        state.currencies.push(foundry.utils.deepClone({ ...DEFAULT_CURRENCY, primary: false }));
        this._pendingState = state;
        const currScroll = this.element?.querySelector(".cgc-scroll:not(.cgc-geartypes-scroll)");
        scrolls[".cgc-scroll:not(.cgc-geartypes-scroll)"] = currScroll ? currScroll.scrollHeight : 0;
        this._pendingScrolls = scrolls;
        this.render();
    }

    async _onDeleteCurrency(event, target) {
        const idx = parseInt(target.dataset.index ?? "-1");
        if (idx < 0) return;
        const scrolls = this._saveScrolls();
        const state = this._captureState();
        state.currencies.splice(idx, 1);
        if (state.currencies.length && !state.currencies.some(c => c.primary)) state.currencies[0].primary = true;
        this._pendingState = state;
        this._pendingScrolls = scrolls;
        this.render();
    }

    async _onAddGearType(event, target) {
        const scrolls = this._saveScrolls();
        const state = this._captureState();
        state.customTypes.push({ label: "", buy: 1, sell: 1 });
        this._pendingState = state;
        const gtScroll = this.element?.querySelector(".cgc-geartypes-scroll");
        scrolls[".cgc-geartypes-scroll"] = gtScroll ? gtScroll.scrollHeight : 0;
        this._pendingScrolls = scrolls;
        this.render();
    }

    async _onDeleteGearType(event, target) {
        const idx = parseInt(target.dataset.index ?? "-1");
        if (idx < 0) return;
        const scrolls = this._saveScrolls();
        const state = this._captureState();
        state.customTypes.splice(idx, 1);
        this._pendingState = state;
        this._pendingScrolls = scrolls;
        this.render();
    }

    async _onBrowseCurrencyImg(event, target) {
        const idx = parseInt(target.dataset.index ?? "-1");
        if (idx < 0) return;
        const current = this.element.querySelector(`input[name="curr.${idx}.img"]`)?.value ?? "";
        new FilePicker({
            type: "imagevideo",
            current,
            callback: (path) => {
                const input = this.element.querySelector(`input[name="curr.${idx}.img"]`);
                if (input) input.value = path;
            }
        }).render(true);
    }

    async _onSubmit(event, form, formData) {
        const state = this._captureState();

        await game.settings.set("neuroshima", "currencyNameLabel",  state.currencyNameLabel);
        await game.settings.set("neuroshima", "currencyValueLabel", state.currencyValueLabel);

        await game.settings.set("neuroshima", "currencies", JSON.stringify(state.currencies));

        const allMods = {};
        for (const [key, mod] of Object.entries(state.builtinMods)) allMods[key] = mod;
        for (const { label, buy, sell } of state.customTypes) if (label) allMods[label] = { buy, sell };
        await game.settings.set("neuroshima", "gearTypePriceModifiers", JSON.stringify(allMods));

        const customLabels = state.customTypes.filter(t => t.label).map(t => t.label);
        await game.settings.set("neuroshima", "customGearTypes", JSON.stringify(customLabels));

        const NEUROSHIMA = game.neuroshima.config;
        for (const [key] of Object.entries(NEUROSHIMA.gearTypes)) {
            if (key === NEUROSHIMA.gearTypes[key] && key !== "misc") delete NEUROSHIMA.gearTypes[key];
        }
        for (const { label } of state.customTypes) if (label) NEUROSHIMA.gearTypes[label] = label;

        if (game.modules.get("item-piles")?.active) {
            try {
                const rawLabels = Object.values(NEUROSHIMA.gearTypes).map(v => game.i18n.localize(v));
                const stale = new Set([
                    ...rawLabels,
                    ...rawLabels.map(l => "\uFFFF" + l),
                    ...rawLabels.map(l => "\u200A" + l)
                ]);
                const freshLabels = rawLabels.map(l => "\u200A" + l);
                const existing = game.settings.get("item-piles", "customItemCategories") ?? [];
                const userDefined = existing.filter(l => !stale.has(l));
                await game.settings.set("item-piles", "customItemCategories", [...userDefined, ...freshLabels]);
            } catch(e) {}

            try {
                const ipCurrencies = state.currencies.map(c => ({
                    type: "item",
                    name: c.name,
                    img:  c.img || DEFAULT_CURRENCY.img,
                    abbreviation: c.abbreviation || `{#}${c.name}`,
                    data: {
                        item: {
                            name:   c.name,
                            type:   "money",
                            img:    c.img || DEFAULT_CURRENCY.img,
                            system: { coinValue: c.coinValue ?? 1, quantity: 1, weight: c.weight ?? 0 }
                        }
                    },
                    primary:      !!c.primary,
                    exchangeRate: c.exchangeRate ?? 1
                }));
                game.itempiles.API.addSystemIntegration({ CURRENCIES: ipCurrencies });
            } catch(e) {}
        }

        this._pendingState = null;
        ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.CurrencyGearConfig.Saved"));
        SettingsConfig.reloadConfirm();
    }
}
