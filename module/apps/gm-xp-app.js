import { applyXpGrantEntry } from "../helpers/xp.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class GMAddXPApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "gm-add-xp",
        classes: ["neuroshima", "gm-toolkit", "gm-xp-app"],
        tag: "div",
        window: {
            title: "NEUROSHIMA.GMToolkit.AddXP.Title",
            icon: "fas fa-star",
            resizable: false,
            minimizable: true
        },
        position: {
            width: 500,
            height: "auto"
        },
        actions: {
            applyXP:     this._onApplyXP,
            toggleActor: this._onToggleActor,
            selectAll:   this._onSelectAll,
            deselectAll: this._onDeselectAll
        }
    };

    static PARTS = {
        main: {
            template: "systems/neuroshima/templates/apps/gm-xp-app.hbs",
            scrollable: [".actor-list"]
        }
    };

    constructor(options = {}) {
        super(options);
        this._selectedActors    = new Set();
        this._defaultAmount     = 100;
        this._reason            = "";
        this._individualAmounts = {};
    }

    static open() {
        if (!game.user.isGM) return;
        const existing = Object.values(ui.windows).find(w => w instanceof GMAddXPApp);
        if (existing) { existing.bringToTop(); return existing; }
        return new GMAddXPApp().render(true);
    }

    async _prepareContext(options) {
        const sessionID = game.settings.get("neuroshima", "sessionID") ?? 1;

        const actors = game.actors.filter(a =>
            (a.type === "character" || a.type === "npc") &&
            a.hasPlayerOwner
        ).map(a => ({
            id: a.id,
            name: a.name,
            img: a.img,
            type: a.type,
            currentXP: a.system.xp?.total ?? 0,
            selected: this._selectedActors.has(a.id),
            individualAmount: this._individualAmounts[a.id] ?? this._defaultAmount
        })).sort((a, b) => a.name.localeCompare(b.name));

        return {
            actors,
            defaultAmount: this._defaultAmount,
            reason: this._reason,
            selectedCount: this._selectedActors.size,
            hasSelection: this._selectedActors.size > 0,
            sessionID
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const el = this.element;

        el.querySelector(".xp-amount-input")?.addEventListener("change", (e) => {
            this._defaultAmount = parseInt(e.target.value) || 0;
        });

        el.querySelector(".xp-reason-input")?.addEventListener("input", (e) => {
            this._reason = e.target.value;
        });

        el.querySelectorAll(".xp-individual-input").forEach(input => {
            input.addEventListener("click",  (e) => e.stopPropagation());
            input.addEventListener("pointerdown", (e) => e.stopPropagation());
            input.addEventListener("change", (e) => {
                const actorId = e.target.dataset.actorId;
                this._individualAmounts[actorId] = parseInt(e.target.value) || 0;
            });
        });
    }

    static _onToggleActor(event, target) {
        const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
        if (!actorId) return;
        if (this._selectedActors.has(actorId)) {
            this._selectedActors.delete(actorId);
        } else {
            this._selectedActors.add(actorId);
            if (!(actorId in this._individualAmounts)) {
                this._individualAmounts[actorId] = this._defaultAmount;
            }
        }
        this.render({ parts: ["main"] });
    }

    static _onSelectAll(event, target) {
        game.actors.filter(a => (a.type === "character" || a.type === "npc") && a.hasPlayerOwner)
            .forEach(a => {
                this._selectedActors.add(a.id);
                if (!(a.id in this._individualAmounts)) {
                    this._individualAmounts[a.id] = this._defaultAmount;
                }
            });
        this.render({ parts: ["main"] });
    }

    static _onDeselectAll(event, target) {
        this._selectedActors.clear();
        this.render({ parts: ["main"] });
    }

    static async _onApplyXP(event, target) {
        if (this._selectedActors.size === 0) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.AddXP.NoActors"));
            return;
        }

        const sessionID = game.settings.get("neuroshima", "sessionID") ?? 1;
        const baseReason = this._reason.trim() ||
            game.i18n.localize("NEUROSHIMA.GMToolkit.AddXP.DefaultReason");
        const sessionPrefix = game.i18n.format("NEUROSHIMA.GMToolkit.AddXP.SessionPrefix", { session: sessionID });
        const description = `${sessionPrefix}: ${baseReason}`;

        const updates   = [];
        const chatRows  = [];

        for (const actorId of this._selectedActors) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;

            const amount = this._individualAmounts[actorId] ?? this._defaultAmount;
            if (!amount || amount <= 0) continue;

            const before   = actor.system.xp?.total ?? 0;
            const after    = before + amount;

            const changed = {};
            foundry.utils.setProperty(changed, "system.xp.total", after);
            applyXpGrantEntry(actor, changed, amount, description);

            updates.push(actor.update(changed));
            chatRows.push({ name: actor.name, img: actor.img, before, after, amount });
        }

        if (!updates.length) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.AddXP.InvalidAmount"));
            return;
        }

        await Promise.all(updates);

        const affectedActors = [...this._selectedActors]
            .map(id => game.actors.get(id))
            .filter(Boolean);
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
            "systems/neuroshima/templates/chat/xp-grant-report.hbs",
            { entries: chatRows, sessionID, reason: baseReason }
        );
        await NeuroshimaChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({}),
            content,
            style: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
            whisper
        });

        ui.notifications.info(
            game.i18n.format("NEUROSHIMA.GMToolkit.AddXP.Success", { count: updates.length })
        );

        this._selectedActors.clear();
        this._reason = "";
        this.render({ parts: ["main"] });
    }
}
