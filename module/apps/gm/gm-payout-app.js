import { DEFAULT_CURRENCY } from "../config/currency-gear-config.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

function _loadCurrencies() {
    try {
        const saved = JSON.parse(game.settings.get("neuroshima", "currencies") || "null");
        if (Array.isArray(saved) && saved.length) return saved;
    } catch (e) {}
    return [foundry.utils.deepClone(DEFAULT_CURRENCY)];
}

export class GMPayoutApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "gm-payout",
        classes: ["neuroshima", "gm-toolkit", "gm-payout-app"],
        tag: "div",
        window: {
            title: "NEUROSHIMA.GMToolkit.Payout.Title",
            icon: "fas fa-coins",
            resizable: true,
            minimizable: true
        },
        position: {
            width: 640,
            height: 520
        },
        actions: {
            applyPayout: this._onApplyPayout,
            toggleActor: this._onToggleActor,
            selectAll:   this._onSelectAll,
            deselectAll: this._onDeselectAll
        }
    };

    static PARTS = {
        main: {
            template: "systems/neuroshima/templates/apps/gm-payout-app.hbs",
            scrollable: [".payout-actors-col", ".payout-currency-col"]
        }
    };

    constructor(options = {}) {
        super(options);
        this._selectedActors  = new Set();
        this._amounts         = {};
        this._notifyPlayers   = true;
        this._split           = false;
    }

    static open() {
        if (!game.user.isGM) return;
        const existing = Object.values(ui.windows).find(w => w instanceof GMPayoutApp);
        if (existing) { existing.bringToTop(); return existing; }
        return new GMPayoutApp().render(true);
    }

    async _prepareContext(options) {
        const currencies = _loadCurrencies();

        const actors = game.actors.filter(a =>
            (a.type === "character" || a.type === "npc") && a.hasPlayerOwner
        ).map(a => ({
            id: a.id,
            name: a.name,
            img: a.img,
            selected: this._selectedActors.has(a.id)
        })).sort((a, b) => a.name.localeCompare(b.name));

        const selectedCount = this._selectedActors.size;

        return {
            actors,
            currencies: currencies.map((c, idx) => ({
                idx,
                name: c.name,
                img: c.img || DEFAULT_CURRENCY.img,
                coinValue: c.coinValue ?? 1,
                primary: !!c.primary,
                amount: this._amounts[idx] ?? 0,
                splitPreview: (selectedCount > 1 && this._split && (this._amounts[idx] ?? 0) > 0)
                    ? Math.floor((this._amounts[idx] ?? 0) / selectedCount)
                    : null
            })),
            selectedCount,
            hasSelection: selectedCount > 0,
            notifyPlayers: this._notifyPlayers,
            split: this._split
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const el = this.element;

        el.querySelectorAll(".currency-amount-input").forEach(input => {
            input.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.idx);
                this._amounts[idx] = Math.max(0, parseInt(e.target.value) || 0);
                this.render({ parts: ["main"] });
            });
            input.addEventListener("click", (e) => e.stopPropagation());
            input.addEventListener("pointerdown", (e) => e.stopPropagation());
        });

        el.querySelector(".payout-notify-input")?.addEventListener("change", (e) => {
            this._notifyPlayers = e.target.checked;
        });

        el.querySelector(".payout-split-input")?.addEventListener("change", (e) => {
            this._split = e.target.checked;
            this.render({ parts: ["main"] });
        });
    }

    static _onToggleActor(event, target) {
        const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
        if (!actorId) return;
        if (this._selectedActors.has(actorId)) {
            this._selectedActors.delete(actorId);
        } else {
            this._selectedActors.add(actorId);
        }
        this.render({ parts: ["main"] });
    }

    static _onSelectAll(event, target) {
        game.actors.filter(a => (a.type === "character" || a.type === "npc") && a.hasPlayerOwner)
            .forEach(a => this._selectedActors.add(a.id));
        this.render({ parts: ["main"] });
    }

    static _onDeselectAll(event, target) {
        this._selectedActors.clear();
        this.render({ parts: ["main"] });
    }

    static async _onApplyPayout(event, target) {
        if (this._selectedActors.size === 0) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.Payout.NoActors"));
            return;
        }

        const currencies = _loadCurrencies();
        const actorCount = this._selectedActors.size;

        const activeCurrencies = currencies
            .map((c, idx) => ({ c, idx, raw: this._amounts[idx] ?? 0 }))
            .filter(({ raw }) => raw > 0);

        if (!activeCurrencies.length) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.Payout.NoAmount"));
            return;
        }

        const updates = [];
        const chatRows = [];

        for (const actorId of this._selectedActors) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;

            const actorPayouts = [];

            for (const { c, idx, raw } of activeCurrencies) {
                const amount = this._split ? Math.floor(raw / actorCount) : raw;
                if (amount <= 0) continue;

                const existing = actor.items.find(i => i.type === "money" && i.name === c.name);
                if (existing) {
                    updates.push(existing.update({ "system.quantity": (existing.system.quantity ?? 0) + amount }));
                } else {
                    updates.push(actor.createEmbeddedDocuments("Item", [{
                        name: c.name,
                        type: "money",
                        img: c.img || DEFAULT_CURRENCY.img,
                        system: { quantity: amount, coinValue: c.coinValue ?? 1, weight: c.weight ?? 0 }
                    }]));
                }
                actorPayouts.push({ currencyName: c.name, currencyImg: c.img || DEFAULT_CURRENCY.img, amount });
            }

            if (actorPayouts.length) {
                chatRows.push({ name: actor.name, img: actor.img, payouts: actorPayouts });
            }
        }

        if (!updates.length) return;
        await Promise.all(updates);

        const affectedActors = [...this._selectedActors].map(id => game.actors.get(id)).filter(Boolean);
        const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
        const gmUserIds = game.users.filter(u => u.isGM).map(u => u.id);
        let whisper;
        if (this._notifyPlayers) {
            const playerUserIds = game.users
                .filter(u => !u.isGM && affectedActors.some(a =>
                    (a.ownership[u.id] ?? a.ownership.default ?? 0) >= ownerLevel
                ))
                .map(u => u.id);
            whisper = [...new Set([...gmUserIds, ...playerUserIds])];
        } else {
            whisper = gmUserIds;
        }

        const { NeuroshimaChatMessage } = game.neuroshima;
        const content = await NeuroshimaChatMessage._renderTemplate(
            "systems/neuroshima/templates/chat/payout-report.hbs",
            { entries: chatRows }
        );
        await NeuroshimaChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({}),
            content,
            style: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
            whisper
        });

        ui.notifications.info(
            game.i18n.format("NEUROSHIMA.GMToolkit.Payout.Success", { count: chatRows.length })
        );

        this._selectedActors.clear();
        this._amounts = {};
        this.render({ parts: ["main"] });
    }
}
