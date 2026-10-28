import { CombatHelper } from "../../helpers/combat-helper.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const VALID_TYPES = new Set(["character", "npc", "creature"]);

export class GMApplyDamageApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "gm-apply-damage",
        classes: ["neuroshima", "gm-toolkit", "gm-damage-app"],
        tag: "div",
        window: { title: "NEUROSHIMA.GMToolkit.ApplyDamage.Title", icon: "fas fa-skull-crossbones", resizable: true, minimizable: true },
        position: { width: 960, height: "auto" },
        actions: {
            applyDamage: this._onApplyDamage, selectActor: this._onSelectActor,
            selectAll: this._onSelectAll, deselectAll: this._onDeselectAll,
            addDamage: this._onAddDamage, removeDamage: this._onRemoveDamage
        }
    };
    static PARTS = {
        main: { template: "systems/neuroshima/templates/apps/gm-damage-app.hbs", scrollable: [".damage-actor-list", ".damage-table-scroll"] }
    };

    constructor(options = {}) {
        super(options);
        this._selectedActors = new Set();
        this._rows = [this._newRow()];
        this._woundName = "";
        this._search = "";
        this._actorType = "";
        this._actorSource = (globalThis.canvas?.tokens?.placeables?.length ?? 0) ? "scene" : "world";
        this._selectionInitialized = false;
        this._applying = false;
    }

    _newRow() {
        return { id: foundry.utils.randomID(), damageType: "L", damageCategory: "physical", location: "torso", quantity: 1, randomEach: false };
    }

    static open() {
        if (!game.user.isGM) return;
        if (this._instance?.rendered) {
            this._instance.bringToFront();
            return this._instance;
        }
        this._instance = new GMApplyDamageApp();
        return this._instance.render(true);
    }

    _actorKey(actor) { return actor.uuid; }

    _buildActorList() {
        const rows = new Map();
        const add = (actor, token = null) => {
            if (!actor || !VALID_TYPES.has(actor.type)) return;
            const id = this._actorKey(actor);
            if (rows.has(id)) return;
            rows.set(id, {
                id, name: token?.document.name || actor.name, actorName: actor.name,
                img: token?.document.texture?.src || actor.img, type: actor.type,
                selected: this._selectedActors.has(id)
            });
        };
        if (this._actorSource !== "world") {
            for (const token of globalThis.canvas?.tokens?.placeables ?? []) add(token.actor, token);
        }
        if (this._actorSource !== "scene") {
            for (const actor of game.actors) add(actor);
        }
        const search = this._search.trim().toLocaleLowerCase();
        return [...rows.values()].filter(row => (!this._actorType || row.type === this._actorType)
            && (!search || `${row.name} ${row.actorName}`.toLocaleLowerCase().includes(search)))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    _autoSelectFromCanvas() {
        if (this._selectionInitialized) return;
        this._selectionInitialized = true;
        for (const token of globalThis.canvas?.tokens?.controlled ?? []) {
            if (VALID_TYPES.has(token.actor?.type)) this._selectedActors.add(this._actorKey(token.actor));
        }
    }

    async _prepareContext() {
        const config = game.neuroshima.config;
        this._autoSelectFromCanvas();
        const choices = (entries, selected) => entries.map(([key, label]) => ({ key, label: game.i18n.localize(label), selected: key === selected }));
        const locations = [["random", "NEUROSHIMA.GMToolkit.ApplyDamage.Random"], ...Object.entries(config.bodyLocations)
            .filter(([, data]) => !data.paperDollOnly).map(([key, data]) => [key, data.label])];
        const categories = Object.entries(config.damageCategories).map(([key, data]) => [key, data.label]);
        return {
            actors: this._buildActorList(), woundName: this._woundName, search: this._search,
            actorTypes: choices([["", "NEUROSHIMA.GMToolkit.ApplyDamage.AllTypes"], ...[...VALID_TYPES].map(key => [key, `TYPES.Actor.${key}`])], this._actorType),
            actorSources: choices(["scene", "world", "all"].map(key => [key, `NEUROSHIMA.GMToolkit.ApplyDamage.Source.${key}`]), this._actorSource),
            rows: this._rows.map(row => ({ ...row, isRandom: row.location === "random",
                damageTypes: choices(Object.entries(config.damageTypes), row.damageType),
                categories: choices(categories, row.damageCategory), locations: choices(locations, row.location),
                canRemove: this._rows.length > 1 })),
            selectedCount: this._selectedActors.size, canApply: this._selectedActors.size > 0 && !this._applying
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        this.element.querySelector(".wound-name-input")?.addEventListener("input", event => this._woundName = event.target.value);
        this.element.querySelectorAll("[data-row-field]").forEach(input => input.addEventListener("change", event => {
            const row = this._rows.find(row => row.id === input.closest("[data-row-id]").dataset.rowId);
            if (!row) return;
            row[input.dataset.rowField] = input.type === "checkbox" ? input.checked
                : input.type === "number" ? Number(input.value) : input.value;
            if (input.dataset.rowField === "location") this.render({ parts: ["main"] });
        }));
        this.element.querySelector(".damage-search")?.addEventListener("input", event => {
            this._search = event.target.value;
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(async () => {
                const start = event.target.selectionStart;
                await this.render({ parts: ["main"] });
                const input = this.element.querySelector(".damage-search");
                input?.focus();
                input?.setSelectionRange(start, start);
            }, 150);
        });
        for (const [selector, field] of [[".damage-actor-type", "_actorType"], [".damage-actor-source", "_actorSource"]]) {
            this.element.querySelector(selector)?.addEventListener("change", event => {
                this[field] = event.target.value;
                this.render({ parts: ["main"] });
            });
        }
    }

    async close(options = {}) {
        clearTimeout(this._searchTimer);
        if (GMApplyDamageApp._instance === this) GMApplyDamageApp._instance = null;
        return super.close(options);
    }

    static _onAddDamage() { this._rows.push(this._newRow()); this.render({ parts: ["main"] }); }
    static _onRemoveDamage(event, target) {
        if (this._rows.length < 2) return;
        this._rows = this._rows.filter(row => row.id !== target.closest("[data-row-id]")?.dataset.rowId);
        this.render({ parts: ["main"] });
    }
    static _onSelectActor(event, target) {
        const id = target.closest("[data-actor-id]")?.dataset.actorId;
        if (!id) return;
        if (this._selectedActors.has(id)) this._selectedActors.delete(id);
        else this._selectedActors.add(id);
        this.render({ parts: ["main"] });
    }
    static _onSelectAll() {
        this._buildActorList().forEach(actor => this._selectedActors.add(actor.id));
        this.render({ parts: ["main"] });
    }
    static _onDeselectAll() { this._selectedActors.clear(); this.render({ parts: ["main"] }); }

    _validatedRows() {
        const config = game.neuroshima.config;
        return this._rows.map(row => {
            if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 1000
                || !Object.hasOwn(config.damageTypes, row.damageType)
                || !Object.hasOwn(config.damageCategories, row.damageCategory)
                || (row.location !== "random" && (!Object.hasOwn(config.bodyLocations, row.location) || config.bodyLocations[row.location].paperDollOnly))) {
                throw new Error(game.i18n.localize("NEUROSHIMA.GMToolkit.ApplyDamage.InvalidRow"));
            }
            return { ...row };
        });
    }

    async _randomLocation() {
        const roll = await new Roll("1d20").evaluate();
        return CombatHelper.getShiftedLocationByRoll(roll.total, 0);
    }

    async _damageGroups(rows, woundName) {
        const groups = new Map();
        for (const row of rows) {
            const sharedLocation = row.location === "random" && !row.randomEach ? await this._randomLocation() : row.location;
            for (let index = 0; index < row.quantity; index++) {
                const location = sharedLocation === "random" ? await this._randomLocation() : sharedLocation;
                if (!groups.has(location)) groups.set(location, []);
                groups.get(location).push({ name: woundName || game.i18n.localize(game.neuroshima.config.damageTypes[row.damageType]),
                    damageType: row.damageType, damageCategory: row.damageCategory });
            }
        }
        return groups;
    }

    static async _onApplyDamage(event, target) {
        if (!game.user.isGM || this._applying) return;
        if (!this._selectedActors.size) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.ApplyDamage.NoActor"));
            return;
        }
        let rows;
        try { rows = this._validatedRows(); }
        catch (error) { ui.notifications.warn(error.message); return; }
        this._applying = true;
        if (target) target.disabled = true;
        const selected = [...this._selectedActors];
        const woundName = this._woundName.trim();
        let applied = 0;
        try {
            for (const uuid of selected) {
                const actor = await fromUuid(uuid);
                if (!actor || !VALID_TYPES.has(actor.type)) continue;
                const groups = await this._damageGroups(rows, woundName);
                const results = [], woundIds = [];
                try {
                    for (const [location, wounds] of groups) {
                        const result = await CombatHelper.applyDamage(actor, {
                            wounds, location, source: game.i18n.localize("NEUROSHIMA.GMToolkit.Title"),
                            withPainResistance: true, suppressChat: true
                        });
                        results.push(...result.results);
                        woundIds.push(...result.woundIds);
                    }
                    applied++;
                } finally {
                    // Keep completed wounds reviewable and reversible even if a later group fails.
                    if (woundIds.length) {
                        this._selectedActors.delete(uuid);
                        await CombatHelper.renderPainResistanceReport(actor, results, woundIds);
                    }
                }
            }
            if (applied) ui.notifications.info(game.i18n.format("NEUROSHIMA.GMToolkit.ApplyDamage.Success", {
                name: woundName || game.i18n.localize("NEUROSHIMA.Items.Type.Wound"),
                count: rows.reduce((sum, row) => sum + row.quantity, 0), actor: applied
            }));
        } catch (error) {
            console.error("Neuroshima | GM damage application failed", error);
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.GMToolkit.ApplyDamage.Failed"));
        } finally {
            this._applying = false;
            this.render({ parts: ["main"] });
        }
    }
}
