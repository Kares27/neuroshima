
import { NeuroshimaDice } from "../../helpers/dice.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class GMApplyDamageApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "gm-apply-damage",
        classes: ["neuroshima", "gm-toolkit", "gm-damage-app"],
        tag: "div",
        window: {
            title: "NEUROSHIMA.GMToolkit.ApplyDamage.Title",
            icon: "fas fa-skull-crossbones",
            resizable: false,
            minimizable: true
        },
        position: {
            width: 580,
            height: "auto"
        },
        actions: {
            applyDamage:  this._onApplyDamage,
            selectActor:  this._onSelectActor,
            selectAll:    this._onSelectAll,
            deselectAll:  this._onDeselectAll
        }
    };

    static PARTS = {
        main: {
            template: "systems/neuroshima/templates/apps/gm-damage-app.hbs",
            scrollable: [".damage-actor-list"]
        }
    };

    constructor(options = {}) {
        super(options);
        this._selectedActors = new Set();
        this._woundName      = "";
        this._damageType     = "L";
        this._location       = "torso";
        this._quantity       = 1;
    }

    static open() {
        if (!game.user.isGM) return;
        const existing = Object.values(ui.windows).find(w => w instanceof GMApplyDamageApp);
        if (existing) { existing.bringToTop(); return existing; }
        return new GMApplyDamageApp().render(true);
    }

    _buildActorList() {
        const VALID_TYPES = new Set(["character", "npc", "creature"]);
        const seen = new Set();
        const rows = [];

        const tokens = canvas?.tokens?.placeables ?? [];

        if (tokens.length > 0) {
            for (const token of tokens) {
                const actor = token.actor;
                if (!actor || !VALID_TYPES.has(actor.type)) continue;
                if (seen.has(actor.id)) continue;
                seen.add(actor.id);
                rows.push({
                    id:       actor.id,
                    name:     token.document.name || actor.name,
                    img:      token.document.texture?.src || actor.img,
                    type:     actor.type,
                    selected: this._selectedActors.has(actor.id)
                });
            }
            rows.sort((a, b) => a.name.localeCompare(b.name));
        }

        if (rows.length === 0) {
            game.actors
                .filter(a => VALID_TYPES.has(a.type))
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(a => rows.push({
                    id:       a.id,
                    name:     a.name,
                    img:      a.img,
                    type:     a.type,
                    selected: this._selectedActors.has(a.id)
                }));
        }

        return rows;
    }

    _autoSelectFromCanvas() {
        if (this._selectedActors.size > 0) return;
        const controlled = canvas?.tokens?.controlled ?? [];
        for (const token of controlled) {
            if (token.actor) this._selectedActors.add(token.actor.id);
        }
    }

    async _prepareContext(options) {
        const NEUROSHIMA = game.neuroshima?.config ?? {};
        this._autoSelectFromCanvas();
        const actors = this._buildActorList();

        const bodyLocations = Object.entries(NEUROSHIMA.bodyLocations ?? {}).map(([key, data]) => ({
            key,
            label: game.i18n.localize(data.label)
        }));

        const damageTypes = Object.entries(NEUROSHIMA.damageTypes ?? {}).map(([key, locKey]) => ({
            key,
            label: game.i18n.localize(locKey)
        }));

        return {
            actors,
            bodyLocations,
            damageTypes,
            woundName:      this._woundName,
            damageType:     this._damageType,
            location:       this._location,
            quantity:       this._quantity,
            selectedCount:  this._selectedActors.size,
            hasSelection:   this._selectedActors.size > 0
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const el = this.element;

        el.querySelector(".wound-name-input")?.addEventListener("input", e => {
            this._woundName = e.target.value;
        });
        el.querySelector(".damage-type-select")?.addEventListener("change", e => {
            this._damageType = e.target.value;
        });
        el.querySelector(".location-select")?.addEventListener("change", e => {
            this._location = e.target.value;
        });
        el.querySelector(".quantity-input")?.addEventListener("change", e => {
            this._quantity = Math.max(1, parseInt(e.target.value) || 1);
        });
    }

    static _onSelectActor(event, target) {
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
        this._buildActorList().forEach(a => this._selectedActors.add(a.id));
        this.render({ parts: ["main"] });
    }

    static _onDeselectAll(event, target) {
        this._selectedActors.clear();
        this.render({ parts: ["main"] });
    }

    static async _onApplyDamage(event, target) {
        if (this._selectedActors.size === 0) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.ApplyDamage.NoActor"));
            return;
        }

        const NEUROSHIMA = game.neuroshima?.config ?? {};
        const typeLocKey = (NEUROSHIMA.damageTypes ?? {})[this._damageType] ?? "NEUROSHIMA.Items.Type.Wound";
        const defaultName = game.i18n.localize(typeLocKey);
        const woundName = this._woundName.trim() || defaultName;

        const qty = Math.max(1, this._quantity);
        const rawWounds = Array.from({ length: qty }, () => ({
            name:       woundName,
            damageType: this._damageType
        }));

        const source = game.i18n.localize("NEUROSHIMA.GMToolkit.Title");
        let applied = 0;

        for (const actorId of this._selectedActors) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;
            await NeuroshimaDice.applyDamage(actor, {
                wounds:              rawWounds,
                location:            this._location,
                source,
                withPainResistance:  true
            });
            applied++;
        }

        if (applied > 0) {
            ui.notifications.info(
                game.i18n.format("NEUROSHIMA.GMToolkit.ApplyDamage.Success", {
                    name:  woundName,
                    count: qty,
                    actor: applied
                })
            );
        }

        this._woundName = "";
        this._quantity  = 1;
        this.render({ parts: ["main"] });
    }
}
