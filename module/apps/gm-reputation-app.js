const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class GMReputationApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "gm-reputation",
        classes: ["neuroshima", "gm-toolkit", "gm-reputation-app"],
        tag: "div",
        window: {
            title: "NEUROSHIMA.GMToolkit.Reputation.Title",
            icon: "fas fa-award",
            resizable: true,
            minimizable: true
        },
        position: {
            width: 660,
            height: 540
        },
        actions: {
            applyChanges: this._onApplyChanges,
            toggleActor:  this._onToggleActor,
            selectAll:    this._onSelectAll,
            deselectAll:  this._onDeselectAll
        }
    };

    static PARTS = {
        main: {
            template: "systems/neuroshima/templates/apps/gm-reputation-app.hbs",
            scrollable: [".rep-actors-col", ".rep-options-col"]
        }
    };

    constructor(options = {}) {
        super(options);
        this._selectedActors = new Set();
        this._repDelta       = 0;
        this._fameDelta      = 0;
        this._itemDeltas     = {};
    }

    static open() {
        if (!game.user.isGM) return;
        const existing = Object.values(ui.windows).find(w => w instanceof GMReputationApp);
        if (existing) { existing.bringToTop(); return existing; }
        return new GMReputationApp().render(true);
    }

    _getSelectedActors() {
        return [...this._selectedActors].map(id => game.actors.get(id)).filter(Boolean);
    }

    async _prepareContext(options) {
        const actors = game.actors.filter(a =>
            (a.type === "character" || a.type === "npc") && a.hasPlayerOwner
        ).map(a => ({
            id: a.id,
            name: a.name,
            img: a.img,
            reputation: a.system.reputation ?? 0,
            fame: a.system.fame ?? 0,
            selected: this._selectedActors.has(a.id)
        })).sort((a, b) => a.name.localeCompare(b.name));

        const selected = this._getSelectedActors();

        const repMap = new Map();
        for (const actor of selected) {
            for (const item of actor.items.filter(i => i.type === "reputation")) {
                const key = item.name.trim().toLowerCase();
                if (!repMap.has(key)) {
                    repMap.set(key, {
                        key,
                        name: item.name,
                        img: item.img,
                        delta: this._itemDeltas[key] ?? 0
                    });
                }
            }
        }

        const repItems = [...repMap.values()].sort((a, b) => a.name.localeCompare(b.name));

        return {
            actors,
            repItems,
            repDelta: this._repDelta,
            fameDelta: this._fameDelta,
            selectedCount: this._selectedActors.size,
            hasSelection: this._selectedActors.size > 0,
            hasRepItems: repItems.length > 0
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const el = this.element;

        el.querySelector(".rep-global-delta")?.addEventListener("change", (e) => {
            this._repDelta = parseInt(e.target.value) || 0;
        });

        el.querySelector(".fame-global-delta")?.addEventListener("change", (e) => {
            this._fameDelta = parseInt(e.target.value) || 0;
        });

        el.querySelectorAll(".rep-item-delta").forEach(input => {
            input.addEventListener("change", (e) => {
                const key = e.target.dataset.repKey;
                this._itemDeltas[key] = parseInt(e.target.value) || 0;
            });
            input.addEventListener("click", (e) => e.stopPropagation());
            input.addEventListener("pointerdown", (e) => e.stopPropagation());
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

    static async _onApplyChanges(event, target) {
        if (this._selectedActors.size === 0) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.Reputation.NoActors"));
            return;
        }

        const repMin = game.settings.get("neuroshima", "reputationMin") ?? 0;
        const repMax = game.settings.get("neuroshima", "reputationMax") ?? 20;

        const actorUpdates = [];
        const chatRows = [];

        for (const actorId of this._selectedActors) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;

            const changes = {};
            const row = { name: actor.name, img: actor.img, repChange: null, fameChange: null, itemChanges: [] };

            if (this._repDelta !== 0) {
                const cur = actor.system.reputation ?? 0;
                const next = Math.max(repMin, Math.min(repMax, cur + this._repDelta));
                if (next !== cur) {
                    changes["system.reputation"] = next;
                    row.repChange = { before: cur, after: next, delta: next - cur };
                }
            }

            if (this._fameDelta !== 0) {
                const cur = actor.system.fame ?? 0;
                const next = Math.max(0, cur + this._fameDelta);
                if (next !== cur) {
                    changes["system.fame"] = next;
                    row.fameChange = { before: cur, after: next, delta: next - cur };
                }
            }

            if (Object.keys(changes).length) {
                actorUpdates.push(actor.update(changes));
            }

            for (const [key, delta] of Object.entries(this._itemDeltas)) {
                if (!delta) continue;
                const item = actor.items.find(i => i.type === "reputation" && i.name.trim().toLowerCase() === key);
                if (!item) continue;
                const cur = item.system.value ?? 0;
                const next = Math.max(repMin, Math.min(repMax, cur + delta));
                if (next !== cur) {
                    actorUpdates.push(item.update({ "system.value": next }));
                    row.itemChanges.push({ name: item.name, img: item.img, before: cur, after: next, delta: next - cur });
                }
            }

            if (row.repChange || row.fameChange || row.itemChanges.length) {
                chatRows.push(row);
            }
        }

        if (!actorUpdates.length) {
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.GMToolkit.Reputation.NoChanges"));
            return;
        }

        await Promise.all(actorUpdates);

        const affectedActors = [...this._selectedActors].map(id => game.actors.get(id)).filter(Boolean);
        const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
        const playerUserIds = game.users
            .filter(u => !u.isGM && affectedActors.some(a =>
                (a.ownership[u.id] ?? a.ownership.default ?? 0) >= ownerLevel
            ))
            .map(u => u.id);
        const gmUserIds = game.users.filter(u => u.isGM).map(u => u.id);
        const whisper = [...new Set([...gmUserIds, ...playerUserIds])];

        const { NeuroshimaChatMessage } = game.neuroshima;
        const content = await NeuroshimaChatMessage._renderTemplate(
            "systems/neuroshima/templates/chat/reputation-report.hbs",
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
            game.i18n.format("NEUROSHIMA.GMToolkit.Reputation.Success", { count: chatRows.length })
        );

        this._selectedActors.clear();
        this._repDelta   = 0;
        this._fameDelta  = 0;
        this._itemDeltas = {};
        this.render({ parts: ["main"] });
    }
}
