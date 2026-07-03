import { NEUROSHIMA } from "../../config.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class GMGroupCheckApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "gm-group-check",
        classes: ["neuroshima", "gm-toolkit", "gm-group-check-app"],
        tag: "div",
        window: {
            title: "NEUROSHIMA.GMToolkit.GroupCheck.Title",
            icon: "fas fa-users",
            resizable: false,
            minimizable: true
        },
        position: {
            width: 480,
            height: "auto"
        },
        actions: {
            postCheck:    this._onPostCheck,
            toggleActor:  this._onToggleActor,
            selectAll:    this._onSelectAll,
            deselectAll:  this._onDeselectAll
        }
    };

    static PARTS = {
        main: {
            template: "systems/neuroshima/templates/apps/gm-group-check-app.hbs",
            scrollable: [".actor-list"]
        }
    };

    constructor(options = {}) {
        super(options);
        this._selectedActors = new Set();
        this._skillKey       = "";
        this._attributeKey   = "dexterity";
        this._difficulty     = "average";
        this._note           = "";
    }

    static open() {
        if (!game.user.isGM) return;
        const existing = Object.values(ui.windows).find(w => w instanceof GMGroupCheckApp);
        if (existing) { existing.bringToTop(); return existing; }
        return new GMGroupCheckApp().render(true);
    }

    async _prepareContext(options) {
        const NEUROSHIMA = game.neuroshima?.config ?? {};
        const skillsByAttribute = [];
        for (const [attrKey, groups] of Object.entries(NEUROSHIMA.skillConfiguration ?? {})) {
            const attrLabel = game.i18n.localize(NEUROSHIMA.attributes?.[attrKey]?.label ?? attrKey);
            for (const [, skills] of Object.entries(groups)) {
                for (const skillKey of skills) {
                    const i18nKey = `NEUROSHIMA.Skills.${skillKey}`;
                    skillsByAttribute.push({
                        key: skillKey,
                        attrKey,
                        label: game.i18n.localize(i18nKey),
                        attrLabel
                    });
                }
            }
        }
        skillsByAttribute.sort((a, b) => a.label.localeCompare(b.label));

        const difficulties = Object.entries(NEUROSHIMA.difficulties ?? {}).map(([key, data]) => ({
            key,
            label: game.i18n.localize(data.label ?? key)
        }));

        const actors = game.actors.filter(a =>
            (a.type === "character" || a.type === "npc") &&
            a.hasPlayerOwner
        ).map(a => ({
            id: a.id,
            name: a.name,
            img: a.img,
            selected: this._selectedActors.has(a.id)
        })).sort((a, b) => a.name.localeCompare(b.name));

        return {
            actors,
            skills: skillsByAttribute,
            difficulties,
            skillKey: this._skillKey,
            attributeKey: this._attributeKey,
            difficulty: this._difficulty,
            note: this._note,
            selectedCount: this._selectedActors.size,
            hasSelection: this._selectedActors.size > 0 && this._skillKey !== ""
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const el = this.element;

        el.querySelector(".group-skill-select")?.addEventListener("change", e => {
            const option = e.target.selectedOptions[0];
            this._skillKey    = e.target.value;
            this._attributeKey = option?.dataset.attrKey ?? "dexterity";
        });

        el.querySelector(".group-difficulty-select")?.addEventListener("change", e => {
            this._difficulty = e.target.value;
        });

        el.querySelector(".group-note-input")?.addEventListener("input", e => {
            this._note = e.target.value;
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

    static async _onPostCheck(event, target) {
        if (this._selectedActors.size === 0 || !this._skillKey) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.GroupCheck.NoSelection"));
            return;
        }

        const NEUROSHIMA = game.neuroshima?.config ?? {};
        const skillLabel = game.i18n.localize(`NEUROSHIMA.Skills.${this._skillKey}`);
        const diffLabel  = game.i18n.localize(
            NEUROSHIMA.difficulties?.[this._difficulty]?.label ?? this._difficulty
        );

        const gmUserIds = game.users.filter(u => u.isGM).map(u => u.id);
        const speaker   = { alias: game.i18n.localize("NEUROSHIMA.GMToolkit.Title") };
        let sent = 0;

        for (const actorId of this._selectedActors) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;

            const playerIds = game.users
                .filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"))
                .map(u => u.id);

            const whisper = [...new Set([...playerIds, ...gmUserIds])];

            const templateData = {
                targetActorId: actor.id,
                actorName:     actor.name,
                skillKey:      this._skillKey,
                attributeKey:  this._attributeKey,
                difficulty:    this._difficulty,
                modifier:      0,
                isOpen:        false,
                minAP:         0,
                skillLabel,
                diffLabel,
                note:          this._note
            };

            const content = await foundry.applications.handlebars.renderTemplate(
                "systems/neuroshima/templates/apps/request-test-card.hbs",
                templateData
            );

            await ChatMessage.create({
                content,
                speaker,
                whisper,
                flags: { neuroshima: { requestTest: true } }
            });
            sent++;
        }

        if (sent > 0) {
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.GMToolkit.GroupCheck.Posted"));
        }
    }
}


export function registerGroupCheckChatListeners() {
    Hooks.on("renderChatMessageHTML", (message, html) => {
        if (!message.flags?.neuroshima?.requestTest) return;

        html.querySelectorAll(".group-check-roll-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const targetActorId = btn.dataset.targetActorId || null;
                const skillKey      = btn.dataset.skillKey;
                const attrKey       = btn.dataset.attrKey;
                const difficulty    = btn.dataset.difficulty || null;
                const modifier      = btn.dataset.modifier ? Number(btn.dataset.modifier) : 0;
                const isOpen        = btn.dataset.isOpen === "true";

                let actor;
                if (targetActorId) {
                    actor = game.actors.get(targetActorId);
                    if (!actor) return;
                    if (!actor.isOwner) {
                        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.GroupCheck.NotOwner"));
                        return;
                    }
                } else {
                    actor = game.user.character
                        ?? canvas.tokens?.controlled?.[0]?.actor
                        ?? null;
                    if (!actor) {
                        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.GroupCheck.NoCharacter"));
                        return;
                    }
                    if (!actor.isOwner) {
                        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.GroupCheck.NotOwner"));
                        return;
                    }
                }

                const { NeuroshimaSkillRollDialog } = await import("../dialogs/skill-roll-dialog.js");

                const attrValue  = actor.system.attributeTotals?.[attrKey] ?? actor.system.attributes?.[attrKey] ?? 0;
                const skillValue = actor.system.skills?.[skillKey]?.value ?? 0;
                const label      = btn.dataset.label || game.i18n.localize(`NEUROSHIMA.Skills.${skillKey}`);

                const lastRollBase = { ...actor.system.lastRoll, isOpen };
                if (difficulty) lastRollBase.baseDifficulty = difficulty;
                if (modifier)   lastRollBase.modifier = modifier;

                const rawSuccess = message.flags?.neuroshima?.onSuccess ?? null;
                const rawFailure = message.flags?.neuroshima?.onFailure ?? null;
                let resultCallback = null;
                if (rawSuccess || rawFailure) {
                    const _norm = (c) => {
                        if (!c) return null;
                        const arr = Array.isArray(c) ? c : [typeof c === "string" ? { addCondition: c } : c];
                        return arr.length ? arr : null;
                    };
                    const successConsequences = _norm(rawSuccess);
                    const failureConsequences = _norm(rawFailure);
                    resultCallback = async ({ isSuccess }) => {
                        const consequences = isSuccess ? successConsequences : failureConsequences;
                        if (!consequences) return;
                        for (const action of consequences) {
                            if (action.addCondition) await actor.addCondition(action.addCondition, action.value ?? 1);
                        }
                    };
                }

                const dialog = new NeuroshimaSkillRollDialog({
                    actor,
                    stat:             attrValue,
                    skill:            skillValue,
                    label,
                    isSkill:          true,
                    skillKey,
                    currentAttribute: attrKey,
                    lastRoll:         lastRollBase,
                    resultCallback
                });
                dialog.render(true);
            });
        });
    });
}
