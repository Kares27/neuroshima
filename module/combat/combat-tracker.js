/**
 * Custom Combat Tracker for Neuroshima 1.5.
 * Extends the native Combat Tracker to include a Melee tab for initiative tracking.
 */
export class NeuroshimaCombatTracker extends foundry.applications.sidebar.tabs.CombatTracker {
    constructor(options) {
        super(options);
        this._view = "encounter";
        this._activeGroupId = null;
    }

    get _meleeCombatType() {
        return game.settings.get("neuroshima", "meleeCombatType") || "default";
    }

    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: ["neuroshima", "combat-tracker"],
        actions: {
            "set-view":              NeuroshimaCombatTracker.prototype._onSetView,
            "add-melee-group":       NeuroshimaCombatTracker.prototype._onAddMeleeGroup,
            "remove-melee-group":    NeuroshimaCombatTracker.prototype._onRemoveMeleeGroup,
            "add-melee-fighter":     NeuroshimaCombatTracker.prototype._onAddMeleeFighter,
            "remove-melee-fighter":  NeuroshimaCombatTracker.prototype._onRemoveMeleeFighter,
            "roll-melee-init":       NeuroshimaCombatTracker.prototype._onRollMeleeInit,
            "roll-npc-init-group":   NeuroshimaCombatTracker.prototype._onRollNpcInitGroup,
            "first-melee-segment":   NeuroshimaCombatTracker.prototype._onFirstMeleeSegment,
            "prev-melee-segment":    NeuroshimaCombatTracker.prototype._onPrevMeleeSegment,
            "next-melee-segment":    NeuroshimaCombatTracker.prototype._onNextMeleeSegment,
            "next-melee-round":      NeuroshimaCombatTracker.prototype._onNextMeleeRound,
            "set-initiative-owner":  NeuroshimaCombatTracker.prototype._onSetInitiativeOwner,
            "select-melee-group":    NeuroshimaCombatTracker.prototype._onSelectMeleeGroup
        }
    });

    static PARTS = {
        tabs:    { template: "systems/neuroshima/templates/sidebar/combat-tracker-tabs.hbs" },
        header:  { template: "templates/sidebar/tabs/combat/header.hbs" },
        tracker: { template: "templates/sidebar/tabs/combat/tracker.hbs" },
        melee:   { template: "systems/neuroshima/templates/sidebar/melee-view.hbs" },
        footer:  { template: "templates/sidebar/tabs/combat/footer.hbs" }
    };

    async _onRender(context, options) {
        await super._onRender(context, options);
        this.element.dataset.view = this._view;
    }

    async _prepareContext(options) {
        let context;
        try {
            context = await super._prepareContext(options);
        } catch (e) {
            game.neuroshima.error("Error in super._prepareContext in Combat Tracker:", e);
            context = { turns: [] };
        }

        const showMeleeTab = this._meleeCombatType === "default";
        if (!showMeleeTab && this._view === "melee") this._view = "encounter";

        context.user = game.user;
        context.currentView = this._view;
        context.showMeleeTab = showMeleeTab;
        context.isGM = game.user.isGM;
        context.meleeGroups = this._buildMeleeGroups();

        return context;
    }

    _buildMeleeGroups() {
        const groups = game.combat?.getFlag("neuroshima", "meleeGroups") || [];
        const mapped = groups.map((group, idx) => {
            const fighters = (group.fighters || []).map(f => {
                let actor = null;
                try {
                    const tokenDoc = f.tokenUuid ? fromUuidSync(f.tokenUuid) : null;
                    actor = tokenDoc?.actor ?? null;
                    if (!actor) {
                        const doc = fromUuidSync(f.uuid);
                        actor = doc?.actor ?? doc ?? null;
                    }
                } catch {}

                const initFlag = actor?.getFlag("neuroshima", "meleeDuelInit");
                const hasRolled = initFlag !== undefined && initFlag !== null;
                const initValue = hasRolled ? Number(initFlag) : null;

                return {
                    uuid:            f.uuid,
                    tokenUuid:       f.tokenUuid || null,
                    name:            f.name,
                    img:             f.img,
                    meleeInitiative: initValue,
                    hasInitiative:   hasRolled,
                    isOwner:         actor?.isOwner ?? game.user.isGM,
                    isInitiativeOwner: false
                };
            });

            fighters.sort((a, b) => {
                if (!a.hasInitiative && !b.hasInitiative) return 0;
                if (!a.hasInitiative) return 1;
                if (!b.hasInitiative) return -1;
                return b.meleeInitiative - a.meleeInitiative;
            });

            let initiativeOwnerId = group.initiativeOwnerId ?? null;
            if (!initiativeOwnerId) {
                const top = fighters.find(f => f.hasInitiative);
                if (top) initiativeOwnerId = top.uuid;
            }
            for (const f of fighters) {
                f.isInitiativeOwner = f.uuid === initiativeOwnerId;
            }

            return {
                id:             group.id,
                name:           group.name,
                number:         idx + 1,
                fighters,
                currentRound:   group.currentRound ?? 1,
                currentSegment: group.currentSegment ?? 1,
                initiativeOwnerId,
                isActive:       false
            };
        });

        const ids = mapped.map(g => g.id);
        if (!this._activeGroupId || !ids.includes(this._activeGroupId)) {
            this._activeGroupId = ids[0] ?? null;
        }
        for (const g of mapped) g.isActive = g.id === this._activeGroupId;

        return mapped;
    }

    _getActorForFighter(fighter) {
        try {
            const tokenDoc = fighter.tokenUuid ? fromUuidSync(fighter.tokenUuid) : null;
            const actor = tokenDoc?.actor ?? null;
            if (actor) return actor;
            const doc = fromUuidSync(fighter.uuid);
            return doc?.actor ?? doc ?? null;
        } catch {
            return null;
        }
    }

    _getGroupId(target) {
        return target.closest(".melee-group")?.dataset.groupId
            ?? target.dataset.groupId
            ?? null;
    }

    async _updateGroup(groupId, mutate) {
        if (!game.combat) return;
        const groups = foundry.utils.deepClone(game.combat.getFlag("neuroshima", "meleeGroups") || []);
        const idx = groups.findIndex(g => g.id === groupId);
        if (idx === -1) return;
        mutate(groups[idx]);
        await game.combat.setFlag("neuroshima", "meleeGroups", groups);
    }

    _onSetView(event, target) {
        event.preventDefault();
        this._view = target.dataset.tab;
        this.render(true);
    }

    async _onAddMeleeGroup(event, target) {
        event.preventDefault();
        if (!game.user.isGM) return;
        if (!game.combat) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NoCombat"));
            return;
        }
        const groups = game.combat.getFlag("neuroshima", "meleeGroups") || [];
        const id = foundry.utils.randomID(8);
        const name = game.i18n.format("NEUROSHIMA.MeleeDuel.GroupName", { n: groups.length + 1 });
        this._activeGroupId = id;
        await game.combat.setFlag("neuroshima", "meleeGroups", [
            ...groups,
            { id, name, fighters: [], currentRound: 1, currentSegment: 1, initiativeOwnerId: null }
        ]);
    }

    async _onRemoveMeleeGroup(event, target) {
        event.preventDefault();
        if (!game.user.isGM || !game.combat) return;
        const groupId = this._getGroupId(target);
        if (!groupId) return;
        const groups = game.combat.getFlag("neuroshima", "meleeGroups") || [];
        const group = groups.find(g => g.id === groupId);
        if (group) {
            for (const f of (group.fighters || [])) {
                const actor = this._getActorForFighter(f);
                if (actor) await actor.unsetFlag("neuroshima", "meleeDuelInit").catch(() => {});
            }
        }
        if (this._activeGroupId === groupId) {
            const remaining = groups.filter(g => g.id !== groupId);
            this._activeGroupId = remaining[0]?.id ?? null;
        }
        await game.combat.setFlag("neuroshima", "meleeGroups", groups.filter(g => g.id !== groupId));
    }

    async _onAddMeleeFighter(event, target) {
        event.preventDefault();
        if (!game.user.isGM) return;
        if (!game.combat) {
            return ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NoCombat"));
        }
        const groupId = this._getGroupId(target);
        if (!groupId) return;

        const selected = canvas.tokens?.controlled ?? [];
        if (!selected.length) {
            return ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeDuel.SelectTokensFirst"));
        }

        const groups = game.combat.getFlag("neuroshima", "meleeGroups") || [];
        const groupIdx = groups.findIndex(g => g.id === groupId);
        if (groupIdx === -1) return;

        const allUuids = new Set(groups.flatMap(g => (g.fighters || []).map(f => f.uuid)));

        const toAdd = [];
        for (const token of selected) {
            const uuid = token.actor?.uuid;
            if (!uuid || allUuids.has(uuid)) continue;
            toAdd.push({
                uuid,
                tokenUuid: token.document.uuid,
                name:      token.name,
                img:       token.document.texture?.src || token.actor?.img || "icons/svg/mystery-man.svg"
            });
        }
        if (!toAdd.length) return;

        const updated = foundry.utils.deepClone(groups);
        updated[groupIdx].fighters = [...(updated[groupIdx].fighters || []), ...toAdd];
        await game.combat.setFlag("neuroshima", "meleeGroups", updated);
    }

    async _onRemoveMeleeFighter(event, target) {
        event.preventDefault();
        if (!game.user.isGM) return;
        const uuid = target.closest("[data-uuid]")?.dataset.uuid;
        const groupId = this._getGroupId(target);
        if (!uuid || !groupId || !game.combat) return;

        const groups = game.combat.getFlag("neuroshima", "meleeGroups") || [];
        const groupIdx = groups.findIndex(g => g.id === groupId);
        if (groupIdx === -1) return;

        const fighter = (groups[groupIdx].fighters || []).find(f => f.uuid === uuid);
        if (fighter) {
            const actor = this._getActorForFighter(fighter);
            if (actor) await actor.unsetFlag("neuroshima", "meleeDuelInit").catch(() => {});
        }

        const updated = foundry.utils.deepClone(groups);
        updated[groupIdx].fighters = updated[groupIdx].fighters.filter(f => f.uuid !== uuid);
        await game.combat.setFlag("neuroshima", "meleeGroups", updated);
    }

    async _onRollMeleeInit(event, target) {
        event.preventDefault();
        const uuid = target.closest("[data-uuid]")?.dataset.uuid;
        if (!uuid || !game.combat) return;

        const groups = game.combat.getFlag("neuroshima", "meleeGroups") || [];
        let fighter = null;
        for (const group of groups) {
            fighter = (group.fighters || []).find(f => f.uuid === uuid);
            if (fighter) break;
        }
        if (!fighter) return;

        const actor = this._getActorForFighter(fighter);
        if (!actor) return;

        const { NeuroshimaInitiativeRollDialog } = await import("../apps/dialogs/initiative-roll-dialog.js");
        const dialog = new NeuroshimaInitiativeRollDialog({
            actor,
            isMelee:    true,
            meleeMode:  "melee-tab",
            onRoll:     async (rollData) => {
                const result = await game.neuroshima.NeuroshimaDice.rollInitiative({
                    ...rollData,
                    actor,
                    isMeleeInitiative: true
                });
                if (result) {
                    await actor.setFlag("neuroshima", "meleeDuelInit", result.successPoints);
                    await actor.update({ "system.combat.meleeInitiative": result.successPoints }).catch(() => {});
                }
                return result;
            }
        });
        await dialog.render(true);
    }

    async _onRollNpcInitGroup(event, target) {
        event.preventDefault();
        if (!game.user.isGM || !game.combat) return;
        const groupId = this._getGroupId(target);
        if (!groupId) return;

        const groups = game.combat.getFlag("neuroshima", "meleeGroups") || [];
        const group = groups.find(g => g.id === groupId);
        if (!group) return;

        for (const fighter of (group.fighters || [])) {
            const actor = this._getActorForFighter(fighter);
            if (!actor) continue;
            if (actor.hasPlayerOwner) continue;
            const existing = actor.getFlag("neuroshima", "meleeDuelInit");
            if (existing !== null && existing !== undefined) continue;

            try {
                const result = await game.neuroshima.NeuroshimaDice.rollInitiative({
                    actor,
                    isMeleeInitiative: true
                });
                if (result) {
                    await actor.setFlag("neuroshima", "meleeDuelInit", result.successPoints);
                    await actor.update({ "system.combat.meleeInitiative": result.successPoints }).catch(() => {});
                }
            } catch (err) {
                console.warn(`Neuroshima | Failed to roll initiative for ${actor.name}:`, err);
            }
        }
    }

    async _onFirstMeleeSegment(event, target) {
        event.preventDefault();
        if (!game.user.isGM || !game.combat) return;
        const groupId = this._getGroupId(target);
        if (!groupId) return;
        await this._updateGroup(groupId, g => {
            g.currentRound = 1;
            g.currentSegment = 1;
        });
    }

    async _onPrevMeleeSegment(event, target) {
        event.preventDefault();
        if (!game.user.isGM || !game.combat) return;
        const groupId = this._getGroupId(target);
        if (!groupId) return;
        await this._updateGroup(groupId, g => {
            const round = g.currentRound ?? 1;
            const seg   = g.currentSegment ?? 1;
            if (seg > 1) {
                g.currentSegment = seg - 1;
            } else if (round > 1) {
                g.currentRound = round - 1;
                g.currentSegment = 3;
            }
        });
    }

    async _onNextMeleeSegment(event, target) {
        event.preventDefault();
        if (!game.user.isGM || !game.combat) return;
        const groupId = this._getGroupId(target);
        if (!groupId) return;
        await this._updateGroup(groupId, g => {
            const seg = g.currentSegment ?? 1;
            if (seg < 3) {
                g.currentSegment = seg + 1;
            } else {
                g.currentRound = (g.currentRound ?? 1) + 1;
                g.currentSegment = 1;
            }
        });
    }

    async _onNextMeleeRound(event, target) {
        event.preventDefault();
        if (!game.user.isGM || !game.combat) return;
        const groupId = this._getGroupId(target);
        if (!groupId) return;
        await this._updateGroup(groupId, g => {
            g.currentRound = (g.currentRound ?? 1) + 1;
            g.currentSegment = 1;
        });
    }

    async _onSetInitiativeOwner(event, target) {
        event.preventDefault();
        if (!game.user.isGM || !game.combat) return;
        const uuid    = target.closest("[data-uuid]")?.dataset.uuid;
        const groupId = this._getGroupId(target);
        if (!uuid || !groupId) return;
        await this._updateGroup(groupId, g => {
            g.initiativeOwnerId = g.initiativeOwnerId === uuid ? null : uuid;
        });
    }

    _onSelectMeleeGroup(event, target) {
        event.preventDefault();
        const groupId = target.dataset.groupId;
        if (groupId) {
            this._activeGroupId = groupId;
            this.render();
        }
    }
}
