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
            "set-initiative-owner":  NeuroshimaCombatTracker.prototype._onSetInitiativeOwner,
            "select-melee-group":    NeuroshimaCombatTracker.prototype._onSelectMeleeGroup,
            "prev-melee-group":      NeuroshimaCombatTracker.prototype._onPrevMeleeGroup,
            "next-melee-group":      NeuroshimaCombatTracker.prototype._onNextMeleeGroup
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
        this._setupMeleeContextMenu();
        this._setupMeleeTokenHover();
    }

    _setupMeleeTokenHover() {
        const meleePart = this.element.querySelector('[data-application-part="melee"]');
        if (!meleePart || !canvas?.tokens) return;
        meleePart.querySelectorAll('.combatant[data-uuid]').forEach(li => {
            li.addEventListener('mouseenter', (event) => {
                const tokenUuid = li.dataset.tokenUuid;
                if (!tokenUuid) return;
                const tokenDoc = fromUuidSync(tokenUuid);
                const tokenObj = tokenDoc?.object;
                if (tokenObj) tokenObj._onHoverIn(event, { hoverOutOthers: true });
            });
            li.addEventListener('mouseleave', (event) => {
                const tokenUuid = li.dataset.tokenUuid;
                if (!tokenUuid) return;
                const tokenDoc = fromUuidSync(tokenUuid);
                const tokenObj = tokenDoc?.object;
                if (tokenObj) tokenObj._onHoverOut(event);
            });
        });
    }

    _setupMeleeContextMenu() {
        const meleePart = this.element.querySelector('[data-application-part="melee"]');
        if (!meleePart || !game.user.isGM) return;
        meleePart.querySelectorAll('.combatant[data-uuid]').forEach(li => {
            li.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this._showMeleeContextMenu(event, li);
            });
        });
    }

    _showMeleeContextMenu(event, li) {
        const uuid    = li.dataset.uuid;
        const groupId = li.dataset.groupId ?? li.closest('.melee-group')?.dataset.groupId;
        if (!uuid || !groupId) return;

        document.querySelectorAll('.ns-item-ctx-menu').forEach(el => el.remove());

        const menuItems = [
            {
                action: 'remove-melee-fighter',
                icon:   'fas fa-skull',
                label:  game.i18n.localize('NEUROSHIMA.MeleeDuel.RemoveFighter')
            }
        ];

        const menu = document.createElement('nav');
        menu.className = 'ns-item-ctx-menu context-menu themed theme-dark';
        menu.style.cssText = 'position:fixed;z-index:99999;';
        menu.innerHTML = `<menu class="context-items">${
            menuItems.map(m => `<li class="context-item" data-action="${m.action}"><i class="${m.icon} fa-fw"></i><span>${m.label}</span></li>`).join('')
        }</menu>`;
        document.body.appendChild(menu);

        const x = event.clientX;
        const y = event.clientY;
        menu.style.left = `${x}px`;
        menu.style.top  = `${y}px`;
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right  > window.innerWidth)  menu.style.left = `${x - rect.width}px`;
            if (rect.bottom > window.innerHeight)  menu.style.top  = `${y - rect.height}px`;
        });

        menu.querySelectorAll('.context-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (item.dataset.action === 'remove-melee-fighter') {
                    await this._removeFighterByUuid(uuid, groupId);
                }
                menu.remove();
            });
        });

        const cleanup = () => {
            menu.remove();
            document.removeEventListener('click',       onDocClick,    { capture: true });
            document.removeEventListener('contextmenu', onDocContext,   { capture: true });
            document.removeEventListener('keydown',     onEscape);
        };
        const onDocClick    = (e) => { if (!menu.contains(e.target)) cleanup(); };
        const onDocContext  = (e) => { if (!menu.contains(e.target)) cleanup(); };
        const onEscape      = (e) => { if (e.key === 'Escape') cleanup(); };
        setTimeout(() => {
            document.addEventListener('click',       onDocClick,   { capture: true });
            document.addEventListener('contextmenu', onDocContext, { capture: true });
            document.addEventListener('keydown',     onEscape);
        }, 0);
    }

    async _removeFighterByUuid(uuid, groupId) {
        if (!game.user.isGM || !game.combat) return;
        const groups   = game.combat.getFlag("neuroshima", "meleeGroups") || [];
        const groupIdx = groups.findIndex(g => g.id === groupId);
        if (groupIdx === -1) return;
        const updated = foundry.utils.deepClone(groups);
        updated[groupIdx].fighters = updated[groupIdx].fighters.filter(f => f.uuid !== uuid);
        await game.combat.setFlag("neuroshima", "meleeGroups", updated);
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
        context.round = game.combat?.round ?? 0;

        const meleeGroups = this._buildMeleeGroups();
        const useMeleePagination = meleeGroups.length >= 8;
        const activeGroupIdx = meleeGroups.findIndex(g => g.isActive);
        context.meleeGroups         = meleeGroups;
        context.useMeleePagination  = useMeleePagination;
        context.activeGroupNumber   = activeGroupIdx + 1;
        context.totalMeleeGroups    = meleeGroups.length;

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

                const initValue = (f.initiative !== undefined && f.initiative !== null) ? Number(f.initiative) : null;
                const hasRolled = initValue !== null;

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

    async _updateFighterInitiative(groupId, uuid, initiative) {
        if (!game.combat) return;
        const groups  = foundry.utils.deepClone(game.combat.getFlag("neuroshima", "meleeGroups") || []);
        const group   = groups.find(g => g.id === groupId);
        if (!group) return;
        const fighter = (group.fighters || []).find(f => f.uuid === uuid);
        if (!fighter) return;
        fighter.initiative = initiative;
        await game.combat.setFlag("neuroshima", "meleeGroups", groups);
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
            { id, name, fighters: [], initiativeOwnerId: null }
        ]);
    }

    async _onRemoveMeleeGroup(event, target) {
        event.preventDefault();
        if (!game.user.isGM || !game.combat) return;
        const groupId = this._getGroupId(target);
        if (!groupId) return;
        const groups = game.combat.getFlag("neuroshima", "meleeGroups") || [];
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

        const groupUuids = new Set((groups[groupIdx]?.fighters || []).map(f => f.uuid));

        const toAdd = [];
        for (const token of selected) {
            const uuid = token.actor?.uuid;
            if (!uuid || groupUuids.has(uuid)) continue;
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

        const updated = foundry.utils.deepClone(groups);
        updated[groupIdx].fighters = updated[groupIdx].fighters.filter(f => f.uuid !== uuid);
        await game.combat.setFlag("neuroshima", "meleeGroups", updated);
    }

    async _onRollMeleeInit(event, target) {
        event.preventDefault();
        const combatantEl = target.closest("[data-uuid]");
        const uuid        = combatantEl?.dataset.uuid;
        const groupId     = combatantEl?.dataset.groupId ?? target.closest(".melee-group")?.dataset.groupId;
        if (!uuid || !game.combat) return;

        const groups  = game.combat.getFlag("neuroshima", "meleeGroups") || [];
        const group   = groupId ? groups.find(g => g.id === groupId) : null;
        const fighter = group
            ? (group.fighters || []).find(f => f.uuid === uuid)
            : groups.flatMap(g => g.fighters || []).find(f => f.uuid === uuid);
        if (!fighter) return;

        const resolvedGroupId = groupId ?? groups.find(g => (g.fighters || []).some(f => f.uuid === uuid))?.id;

        const actor = this._getActorForFighter(fighter);
        if (!actor) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.FighterNotFound") || "Fighter not found.");
            return;
        }

        if (!actor.isOwner && !game.user.isGM) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NotYourFighter"));
            return;
        }

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
                    await this._updateFighterInitiative(resolvedGroupId, uuid, result.successPoints);
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

        const groups  = foundry.utils.deepClone(game.combat.getFlag("neuroshima", "meleeGroups") || []);
        const group   = groups.find(g => g.id === groupId);
        if (!group) return;

        const { NeuroshimaInitiativeRollDialog } = await import("../apps/dialogs/initiative-roll-dialog.js");

        let dirty = false;
        for (const fighter of (group.fighters || [])) {
            const actor = this._getActorForFighter(fighter);
            if (!actor) continue;
            if (actor.hasPlayerOwner) continue;
            if (fighter.initiative !== null && fighter.initiative !== undefined) continue;

            try {
                await new Promise((resolve) => {
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
                                fighter.initiative = result.successPoints;
                                dirty = true;
                                await actor.update({ "system.combat.meleeInitiative": result.successPoints }).catch(() => {});
                            }
                            resolve();
                            return result;
                        },
                        onClose: () => resolve()
                    });
                    dialog.render(true);
                });
            } catch (err) {
                console.warn(`Neuroshima | Failed to roll initiative for ${actor.name}:`, err);
            }
        }
        if (dirty) await game.combat.setFlag("neuroshima", "meleeGroups", groups);
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

    _onPrevMeleeGroup(event, target) {
        event.preventDefault();
        const groups = this._buildMeleeGroups();
        if (!groups.length) return;
        const idx = groups.findIndex(g => g.id === this._activeGroupId);
        this._activeGroupId = groups[idx <= 0 ? groups.length - 1 : idx - 1].id;
        this.render();
    }

    _onNextMeleeGroup(event, target) {
        event.preventDefault();
        const groups = this._buildMeleeGroups();
        if (!groups.length) return;
        const idx = groups.findIndex(g => g.id === this._activeGroupId);
        this._activeGroupId = groups[idx >= groups.length - 1 ? 0 : idx + 1].id;
        this.render();
    }

    static inMeleeGroup(tokenDoc, groupId = null) {
        const uuid = tokenDoc?.actor?.uuid;
        if (!uuid || !game.combat) return false;
        const groups = game.combat.getFlag("neuroshima", "meleeGroups") || [];
        if (groupId) {
            const group = groups.find(g => g.id === groupId);
            return (group?.fighters ?? []).some(f => f.uuid === uuid);
        }
        return groups.some(g => (g.fighters || []).some(f => f.uuid === uuid));
    }

    static async toggleMeleeGroupToken(tokenDocs, { active } = {}) {
        if (!game.combat) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NoCombat"));
            return false;
        }
        const docs = Array.isArray(tokenDocs) ? tokenDocs : [tokenDocs];
        if (!docs.length) return false;

        const tracker     = ui.combat;
        const groups      = foundry.utils.deepClone(game.combat.getFlag("neuroshima", "meleeGroups") || []);
        const activeId    = tracker?._activeGroupId;
        let targetIdx     = groups.findIndex(g => g.id === activeId);
        if (targetIdx === -1 && groups.length > 0) targetIdx = 0;
        const targetGroup = groups[targetIdx] ?? null;

        const primaryUuid    = docs[0]?.actor?.uuid;
        const isInActiveGroup = primaryUuid
            ? (targetGroup?.fighters ?? []).some(f => f.uuid === primaryUuid)
            : false;
        const shouldRemove = active === false || (active === undefined && isInActiveGroup);

        if (shouldRemove) {
            if (targetGroup) {
                for (const doc of docs) {
                    const uuid = doc.actor?.uuid;
                    if (!uuid) continue;
                    targetGroup.fighters = (targetGroup.fighters || []).filter(f => f.uuid !== uuid);
                }
            }
            await game.combat.setFlag("neuroshima", "meleeGroups", groups);
            return false;
        }

        const groupUuids = new Set((targetGroup?.fighters ?? []).map(f => f.uuid));
        const toAdd = [];
        for (const doc of docs) {
            const uuid = doc.actor?.uuid;
            if (!uuid || groupUuids.has(uuid)) continue;
            toAdd.push({
                uuid,
                tokenUuid: doc.uuid ?? null,
                name:      doc.name ?? "",
                img:       doc.texture?.src || doc.actor?.img || "icons/svg/mystery-man.svg"
            });
        }
        if (!toAdd.length) return true;

        if (targetIdx === -1) {
            const id   = foundry.utils.randomID(8);
            const name = game.i18n.format("NEUROSHIMA.MeleeDuel.GroupName", { n: 1 });
            groups.push({ id, name, fighters: toAdd, initiativeOwnerId: null });
            if (tracker) tracker._activeGroupId = id;
        } else {
            groups[targetIdx].fighters = [...(targetGroup.fighters || []), ...toAdd];
        }

        await game.combat.setFlag("neuroshima", "meleeGroups", groups);
        return true;
    }
}
