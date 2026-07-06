/**
 * @file combat.js
 * @description Merged Neuroshima 1.5 melee combat module.
 *
 * Contains (in order):
 *   NeuroshimaCombatTracker  — sidebar Combat Tracker extension
 *   NeuroshimaMeleeCombat    — compatibility / lifecycle helpers
 *   MeleeEncounter           — encounter create/join/leave/end
 *   MeleeOpposedChat         — chat-based opposed (non-pool) melee
 *   MeleeResolution          — exchange resolution
 *   MeleeStore               — persistence layer (Combat flags)
 *   MeleaTurnCard            — chat-card renderer for pool-based melee (vanilla mode)
 *   MeleaTurnService         — state-transition logic for pool-based melee
 *   MeleeVanillaChat         — chat-sync wrapper for vanilla melee
 *
 * MeleeCombatApp is imported dynamically to avoid circular dependencies.
 */
import { NEUROSHIMA } from "../config.js";
import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

/**
 * Custom Token Ruler for Neuroshima 1.5.
 *
 * Overrides Foundry's built-in TokenRuler to color the movement path and grid
 * highlights according to the Neuroshima movement segment system.  Each actor
 * has a `system.movement` value (in grid units) representing one movement
 * segment.  A full turn allows up to three segments:
 *
 *   Distance ≤ 1 segment  → green  (normal move)
 *   Distance ≤ 2 segments → yellow (fast move)
 *   Distance ≤ 3 segments → red    (sprint)
 *   Distance >  3 segments → purple (beyond sprint — out of range)
 *
 * The waypoint label is also overridden to display `"dist / maxDist"` so the
 * player can see exactly how many units remain within the three-segment cap.
 *
 * Registered in system.js as `CONFIG.Token.rulerClass = NeuroshimaTokenRuler`.
 */
export class NeuroshimaTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {
    /**
     * Returns the actor's base movement value (one segment, in grid units).
     * Returns `null` when the value is not a plain number (e.g. vehicles that
     * store movement as a descriptive string) so the ruler falls back to the
     * default Foundry rendering for those tokens.
     *
     * @returns {number|null}
     */
    _getActorMovement() {
        const actor = this.token?.document?.actor;
        const mov = actor?.system?.movement;
        return typeof mov === "number" ? mov : null;
    }

    /**
     * Maps a cumulative travel distance to a hex color code based on how many
     * movement segments have been consumed.
     *
     * @param {number} dist - Cumulative distance traveled so far (grid units).
     * @param {number} mov  - One movement segment length (grid units).
     * @returns {number} Hex color (0xRRGGBB).
     */
    _distColor(dist, mov) {
        if (dist <= mov)         return 0x00c000;
        if (dist <= mov * 2)     return 0xc8c800;
        if (dist <= mov * 3)     return 0xc80000;
        return 0x800080;
    }

    /**
     * Overrides the ruler line segment color to reflect the current movement
     * segment band.  Falls back to the default style when the actor has no
     * numeric movement value.
     *
     * @param {TokenRulerWaypoint} waypoint
     * @returns {object} Merged style object with `color` set.
     * @override
     */
    _getSegmentStyle(waypoint) {
        const base = super._getSegmentStyle(waypoint);
        const mov = this._getActorMovement();
        if (mov === null) return base;
        const dist = waypoint.measurement?.distance ?? 0;
        return { ...base, color: this._distColor(dist, mov) };
    }

    /**
     * Overrides the grid-cell highlight color to reflect the current movement
     * segment band for each cell along the path.
     *
     * @param {TokenRulerWaypoint} waypoint
     * @param {GridOffset} offset
     * @returns {object} Merged style object with `color` set.
     * @override
     */
    _getGridHighlightStyle(waypoint, offset) {
        const base = super._getGridHighlightStyle(waypoint, offset);
        const mov = this._getActorMovement();
        if (mov === null) return base;
        const dist = waypoint.measurement?.distance ?? 0;
        return { ...base, color: this._distColor(dist, mov) };
    }

    /**
     * Overrides the waypoint distance label to show `"dist / maxDist"` where
     * `maxDist` is the three-segment cap (sprint limit).  This lets the player
     * see at a glance how much movement budget remains.
     *
     * @param {TokenRulerWaypoint} waypoint
     * @param {object} state
     * @returns {object|null} Label context with `label` set, or the parent
     *   result unchanged when no movement data is available.
     * @override
     */
    _getWaypointLabelContext(waypoint, state) {
        const ctx = super._getWaypointLabelContext(waypoint, state);
        const mov = this._getActorMovement();
        if (!ctx || mov === null) return ctx;
        const dist = waypoint.measurement?.distance ?? 0;
        ctx.label = `${dist} / ${mov * 3}`;
        return ctx;
    }
}

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

/**
 * Compatibility layer for Melee Combat.
 * Redirects legacy calls to the new MeleeEncounter system.
 */
export class NeuroshimaMeleeCombat {
  /**
   * Checks if two UUIDs represent the same actor.
   */
  static isSameActor(uuid1, uuid2) {
      if (!uuid1 || !uuid2) return false;
      if (uuid1 === uuid2) return true;

      const doc1 = fromUuidSync(uuid1);
      const doc2 = fromUuidSync(uuid2);
      if (!doc1 || !doc2) return false;

      const actor1 = doc1.actor || doc1;
      const actor2 = doc2.actor || doc2;
      return actor1.id === actor2.id;
  }

  /**
   * Legacy alias for pre-V12 code.
   * Old code still asks for an active "duel", now it should receive the active encounter.
   */
  static findActiveDuelForActor(actor) {
    return this.findActiveEncounterForActor(actor);
  }

  /**
   * Legacy pending dismissal kept for combat tracker / older UI hooks.
   */
  static async dismissMeleePending(pendingUuid) {
    game.neuroshima?.log("dismissMeleePending", { pendingUuid });
    await MeleeStore.removePending(pendingUuid);
    ui.combat?.render(true);
  }

  /**
   * Legacy alias for duel dismissal.
   */
  static async dismissMeleeDuel(id) {
    game.neuroshima?.log("dismissMeleeDuel", { id });
    
    // Close the app if open
    for (const app of foundry.applications.instances.values()) {
      if (app.constructor?.name === "MeleeCombatApp" && app.encounterId === id) {
        app.close();
      }
    }
    
    return this.clearMeleeFlags(id);
  }

  /**
   * Finds an active encounter for a given actor.
   */
  static findActiveEncounterForActor(actor) {
    const id = actor.getFlag("neuroshima", "activeMeleeEncounter");
    if (!id) return null;
    return MeleeStore.getEncounter(id);
  }

  /**
   * Initiates a pending melee state (waiting for defender).
   */
  static async initiateMeleePending(attackerUuid, defenderUuid, attackerInitiative, weaponId, maneuver = "none", chargeLevel = 0) {
    const combat = game.combat;

    game.neuroshima?.log("initiateMeleePending | start", {
        hasCombat: !!combat,
        attackerUuid,
        defenderUuid,
        attackerInitiative,
        weaponId,
        maneuver,
        chargeLevel
    });

    if (!combat) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.CreateEncounterFirst"));
        game.neuroshima?.warn("initiateMeleePending aborted: no active game.combat");
        return;
    }

    const attackerDoc = fromUuidSync(attackerUuid);
    const defenderDoc = fromUuidSync(defenderUuid);
    const attackerActor = attackerDoc?.actor || attackerDoc;
    const defenderActor = defenderDoc?.actor || defenderDoc;

    if (!attackerActor || !defenderActor) {
        game.neuroshima?.warn("initiateMeleePending aborted: missing attacker or defender actor", {
            attackerActor,
            defenderActor
        });
        return;
    }

    const pendingKey = defenderUuid.replace(/\./g, "-");
    const pendingData = {
        id: defenderUuid,
        attackerId: attackerUuid,
        defenderId: defenderUuid,
        attackerName: attackerActor.name,
        defenderName: defenderActor.name,
        attackerInitiative,
        attackerManeuver: maneuver,
        attackerChargeLevel: chargeLevel,
        weaponId,
        active: true,
        timestamp: Date.now()
    };

    const pendings = foundry.utils.deepClone(combat.getFlag("neuroshima", "meleePendings") || {});
    pendings[pendingKey] = pendingData;

    game.neuroshima?.log("initiateMeleePending | saving pending", { pendingKey, pendingData });

    if (game.user.isGM || !game.neuroshima.socket) {
        await combat.setFlag("neuroshima", "meleePendings", pendings);
    } else {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", "meleePendings", pendings);
    }
    
    game.neuroshima?.log("initiateMeleePending | saved", {
        storedPendings: combat.getFlag("neuroshima", "meleePendings")
    });

    ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeDuel.PendingNotification"));
    ui.combat?.render(true);
  }

  /**
   * Responds to a pending melee and starts the encounter.
   */
  static async respondToMeleePending(pendingUuid, defenderInitiative, defenderWeaponId = null, maneuver = "none", chargeLevel = 0) {
    const combat = game.combat;
    const pendingKey = pendingUuid.replace(/\./g, "-");
    const pendings = combat?.getFlag("neuroshima", "meleePendings") || {};
    const pending = pendings[pendingKey];

    game.neuroshima?.log("respondToMeleePending | start", { pendingUuid, defenderInitiative, pending });

    if (!pending || !pending.active) {
        game.neuroshima?.warn("respondToMeleePending | pending not found or inactive", { pendingUuid });
        return;
    }

    // Clean up pending
    await MeleeStore.removePending(pendingUuid);

    const attackerDoc = fromUuidSync(pending.attackerId);
    const defenderDoc = fromUuidSync(pending.defenderId);
    
    const attackerData = {
      id: pending.attackerId,
      actorUuid: pending.attackerId,
      tokenUuid: attackerDoc?.token?.uuid || null,
      actorId: attackerDoc?.id || null,
      name: pending.attackerName,
      img: attackerDoc?.img || "",
      weaponId: pending.weaponId,
      initiative: pending.attackerInitiative,
      chargeLevel: pending.attackerChargeLevel
    };

    const defenderData = {
      id: pending.defenderId,
      actorUuid: pending.defenderId,
      tokenUuid: defenderDoc?.token?.uuid || null,
      actorId: defenderDoc?.id || null,
      name: defenderDoc?.name || "",
      img: defenderDoc?.img || "",
      weaponId: defenderWeaponId,
      initiative: defenderInitiative,
      chargeLevel: chargeLevel
    };

    const encounterId = await MeleeEncounter.create(attackerData, defenderData);
    game.neuroshima?.log("Encounter created from pending response", { encounterId, attacker: attackerData.name, defender: defenderData.name });
    this.startMeleeUI(encounterId);
  }

  /**
   * Creates a melee encounter directly from attacker/defender data and opens the app.
   * Bypasses the pending handshake flow — used by the chat card button and context menu.
   *
   * @param {string} attackerActorIdOrUuid  Actor ID or UUID of the attacker.
   * @param {string} defenderActorIdOrUuid  Actor ID or UUID of the defender.
   * @param {object} [rollData]             Optional roll data from the chat card (weaponId, maneuver, chargeLevel).
   */
  static async startDuel(attackerActorIdOrUuid, defenderActorIdOrUuid, rollData = {}) {
    if (!game.combat) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.CreateEncounterFirst"));
      return;
    }

    const _resolveActor = (idOrUuid) => {
      const byId = game.actors.get(idOrUuid);
      if (byId) return byId;
      const doc = fromUuidSync(idOrUuid);
      return doc?.actor || (doc instanceof Actor ? doc : null);
    };

    const attackerActor = _resolveActor(attackerActorIdOrUuid);
    const defenderActor = _resolveActor(defenderActorIdOrUuid);

    if (!attackerActor || !defenderActor) {
      game.neuroshima?.warn("startDuel: could not resolve actors", { attackerActorIdOrUuid, defenderActorIdOrUuid });
      return;
    }

    const _getToken = (actor) =>
      canvas.tokens?.placeables.find(t => t.actor?.id === actor.id) ?? null;

    const _getInitiative = (actor) => {
      const combatant = game.combat.combatants.find(c => c.actorId === actor.id);
      if (combatant?.initiative != null) return combatant.initiative;
      return actor.system.attributeTotals?.dexterity ?? 10;
    };

    const attackerToken = _getToken(attackerActor);
    const defenderToken = _getToken(defenderActor);

    const attackerData = {
      id:         attackerToken?.document.uuid || attackerActor.uuid,
      actorUuid:  attackerActor.uuid,
      tokenUuid:  attackerToken?.document.uuid || null,
      actorId:    attackerActor.id,
      name:       attackerToken?.document.name || attackerActor.name,
      img:        attackerToken?.document.texture?.src || attackerActor.img,
      weaponId:   rollData.weaponId ?? null,
      initiative: _getInitiative(attackerActor),
      chargeLevel: rollData.chargeLevel ?? 0
    };

    const defenderData = {
      id:         defenderToken?.document.uuid || defenderActor.uuid,
      actorUuid:  defenderActor.uuid,
      tokenUuid:  defenderToken?.document.uuid || null,
      actorId:    defenderActor.id,
      name:       defenderToken?.document.name || defenderActor.name,
      img:        defenderToken?.document.texture?.src || defenderActor.img,
      weaponId:   null,
      initiative: _getInitiative(defenderActor),
      chargeLevel: 0
    };

    const encounterId = await MeleeEncounter.create(attackerData, defenderData);
    game.neuroshima?.log("startDuel: encounter created", {
      encounterId,
      attacker: attackerData.name,
      defender: defenderData.name
    });
    this.startMeleeUI(encounterId);
  }

  /**
   * Starts the appropriate melee UI for an encounter.
   * In vanilla (default) mode: posts chat cards via MeleeVanillaChat pipeline.
   * In app mode (modes 2/3): opens MeleeCombatApp.
   */
  static async startMeleeUI(id) {
    const combatTypeSetting = game.settings.get("neuroshima", "meleeCombatType") || "default";
    if (combatTypeSetting === "default") {
      await MeleeVanillaChat.startTurn(id);
    } else {
      this.openMeleeApp(id);
    }
  }

  /**
   * Opens the MeleeCombatApp for a specific encounter (direct, bypasses chat).
   * Kept for backward compatibility and GM emergency access.
   */
  static async openMeleeApp(id) {
    const { MeleeCombatApp } = await import("../apps/melee-combat-app.js");
    const app = new MeleeCombatApp(id);
    app.render(true);
  }

  /**
   * Legacy method support for clearing flags.
   */
  static async clearMeleeFlags(id) {
    await MeleeStore.removeEncounter(id);
  }
}

/**
 * @file melee-encounter.js
 * @description Lifecycle management for Neuroshima 1.5 Melee Encounters.
 *
 * Encounters are identified by a composite ID: `${attackerParticipantId}-${defenderParticipantId}`.
 * Each encounter tracks two teams (A and B) and the full participant roster.
 *
 * ### Encounter data shape (relevant fields)
 * ```js
 * {
 *   id, mode, teams: { A: [...], B: [...] },
 *   participants: { [id]: { actorUuid, name, img, team, initiative, isActive,
 *     weaponId, pool, modifiedPool, skillBudget, selfReductions, opponentGains,
 *     spentOnOpponent, usedDice, maneuver, tempoLevel,
 *     attackTargetSnapshot, defenseTargetSnapshot } },
 *   primaryTargets: { [attackerId]: defenderId },
 *   crowding: { [id]: { primaryOpponentId, opponentCount, dexPenalty, extraAttackers } },
 *   extraAttackQueue: [],
 *   currentExchange: { attackerId, defenderId, declaredDiceCount,
 *     attackerSelectedDice, defenderSelectedDice },
 *   turnState: { turn, segment, phase, initiativeOwnerId, initiativeOrder,
 *     selectionTurn, segmentCost },
 *   log: [{ type, segment, text }]
 * }
 * ```
 */
/**
 * Manages Melee Encounter lifecycle: create, join, leave, end.
 */
export class MeleeEncounter {
  /**
   * Initializes a new melee encounter between two participants.
   * @param {Object} attackerData 
   * @param {Object} defenderData 
   * @returns {Promise<string>} New encounter ID
   */
  static async create(attackerData, defenderData) {
    const attackerId = attackerData.id.replace(/\./g, "-");
    const defenderId = defenderData.id.replace(/\./g, "-");
    const id = `${attackerId}-${defenderId}`;

    const combatTypeSetting = game.settings.get("neuroshima", "meleeCombatType") || "default";
    const resolutionModeMap = { default: "normal", opposedPips: "opposedPips", opposedSuccesses: "opposedSuccesses" };
    const resolutionMode = resolutionModeMap[combatTypeSetting] || "normal";

    const encounter = {
      id,
      mode: "duel",
      resolutionMode,
      teams: {
        A: [attackerId],
        B: [defenderId]
      },
      participants: {
        [attackerId]: this._mapParticipant({ ...attackerData, id: attackerId }, "A"),
        [defenderId]: this._mapParticipant({ ...defenderData, id: defenderId }, "B")
      },
      primaryTargets: {
        [attackerId]: defenderId,
        [defenderId]: attackerId
      },
      crowding: {
        [attackerId]: {
          primaryOpponentId: defenderId,
          opponentCount: 1,
          dexPenalty: 0,
          extraAttackers: []
        },
        [defenderId]: {
          primaryOpponentId: attackerId,
          opponentCount: 1,
          dexPenalty: 0,
          extraAttackers: []
        }
      },
      extraAttackQueue: [],
      currentExchange: {
        attackerId: null,
        defenderId: null,
        declaredAction: null,
        declaredDiceCount: 0,
        attackerSelectedDice: [],
        defenderSelectedDice: [],
        resolutionType: "normal"
      },
      turnState: {
        turn: 1,
        segment: 1,
        phase: "awaiting-pool-rolls",
        selectionTurn: null,
        initiativeOrder: [],
        segmentQueue: [],
        queueIndex: 0,
        segmentCost: 0,
        initiativeOwnerId: attackerData.initiative >= defenderData.initiative ? attackerId : defenderId
      },
      log: []
    };

    MeleeTurnService.updateCrowding(encounter);

    game.neuroshima?.log("Creating melee encounter", { id, attacker: attackerData.name, defender: defenderData.name });
    await MeleeStore.updateEncounter(id, encounter);
    await this._setParticipantFlags(encounter);
    return id;
  }

  /**
   * Participant joins an existing encounter.
   * @param {string} id Encounter ID
   * @param {Object} participantData 
   * @param {string} team "A" or "B"
   */
  static async join(id, participantData, team = "A") {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const participantId = participantData.id.replace(/\./g, "-");
    const updated = foundry.utils.deepClone(encounter);
    updated.participants[participantId] = this._mapParticipant({ ...participantData, id: participantId }, team);
    updated.teams[team].push(participantId);
    updated.mode = (updated.teams.A.length > 1 || updated.teams.B.length > 1) ? "group" : "duel";

    updated.primaryTargets[participantId] = null;
    updated.crowding[participantId] = {
      primaryOpponentId: null,
      opponentCount: 0,
      dexPenalty: 0,
      extraAttackers: []
    };

    // If now multi-fight and no pools have been rolled yet, switch to target-selection
    const isMultiFight = updated.mode === "group";
    const anyPoolRolled = Object.values(updated.participants).some(p => p.isActive && p.pool.length > 0);
    if (isMultiFight && !anyPoolRolled && updated.turnState.phase === "awaiting-pool-rolls") {
      for (const pId in updated.participants) {
        if (updated.participants[pId].isActive) updated.primaryTargets[pId] = null;
      }
      const sortedIds = Object.values(updated.participants)
        .filter(p => p.isActive)
        .sort((a, b) => b.initiative - a.initiative)
        .map(p => p.id);
      updated.turnState.initiativeOrder = sortedIds;
      updated.turnState.phase = "target-selection";
      updated.turnState.selectionTurn = sortedIds[0];
      MeleeTurnService.updateCrowding(updated);
      MeleeTurnService._advanceTargetSelection(updated);
    }

    await MeleeStore.updateEncounter(id, updated);
    const doc = fromUuidSync(participantData.actorUuid);
    const actor = doc?.actor || doc;
    if (actor) await actor.setFlag("neuroshima", "activeMeleeEncounter", id);
  }

  /**
   * Maps raw participant data to the internal encounter structure.
   * @private
   */
  static _mapParticipant(data, team) {
    return {
      id: data.id,
      actorUuid: data.actorUuid,
      tokenUuid: data.tokenUuid,
      actorId: data.actorId,
      name: data.name,
      img: data.img,
      team,
      weaponId: data.weaponId,
      initiative: data.initiative,
      pool: [],
      usedDice: [],
      skillSpent: 0,
      maneuver: "none",
      chargeLevel: data.chargeLevel || 0,
      tempoLevel: 0,
      attackBonusSnapshot: 0,
      defenseBonusSnapshot: 0,
      attackTargetSnapshot: null,
      defenseTargetSnapshot: null,
      isActive: true
    };
  }

  /**
   * Sets the active encounter flag on all participants.
   * @private
   */
  static async _setParticipantFlags(encounter) {
    for (const p of Object.values(encounter.participants)) {
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      if (!actor) continue;
      if (game.user.isGM || actor.isOwner) {
        await actor.setFlag("neuroshima", "activeMeleeEncounter", encounter.id);
      } else if (game.neuroshima?.socket) {
        await game.neuroshima.socket.executeAsGM("setActorFlag", p.actorUuid, "neuroshima", "activeMeleeEncounter", encounter.id);
      }
    }
  }

  /**
   * Closes the encounter and cleans up.
   * MANEUVER — Trash collector (end of encounter):
   * Clears all 4 maneuver conditions from every participant before tearing down the
   * encounter so tokens are left in a clean state after combat ends.
   */
  static async end(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (encounter) {
      const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");
      game.neuroshima?.log("[MeleeEncounter.end] clearing maneuver conditions for all participants", { id });
      for (const p of Object.values(encounter.participants)) {
        game.neuroshima?.log("[MeleeEncounter.end] clearing", { name: p.name, uuid: p.tokenUuid ?? p.actorUuid });
        await NeuroshimaSocket.gmExecute("clearActorManeuverConditions", p.tokenUuid ?? p.actorUuid);
      }
    }
    await MeleeStore.removeEncounter(id);
  }
}

/**
 * @file melee-opposed-chat.js
 * @description Chat-based opposed melee test for Neuroshima 1.5 — WFRP-style flow.
 *
 * Modes:
 *  - **opposedPips**      — each of the 3 dice compared individually; each won slot
 *                           generates an independent hit at that tier.
 *  - **opposedSuccesses** — net successes (attackerSuccesses − defenderSuccesses) →
 *                           damage tier = min(3, net).
 *
 * Flow (mirrors WFRP4e OpposedHandler):
 *  1. Attacker clicks a melee weapon with a target → `initiateAttack()` opens the
 *     weapon-roll dialog. After the roll:
 *     a. A "handler" chat card is posted showing the attacker's dice and the
 *        defender's available melee weapons as clickable buttons.
 *     b. `flags.neuroshima.oppose = { messageId }` is set on the defender's actor
 *        (via GM socket if needed) so their weapon-click also detects the pending.
 *
 *  2. Defender responds by one of:
 *     a. Clicking a weapon button on the chat card → `defendFromChat(messageId, weaponId)`.
 *     b. Clicking a melee weapon in their actor sheet → actor flag detected → `openDefenseDialog()`.
 *     c. Clicking "Join Fight" on the actor-sheet pending card → same path as (b).
 *
 *  3. `openDefenseDialog()` opens the weapon-roll dialog for defence.
 *     After the roll → `resolveOpposed()` computes result, posts the resolution card,
 *     removes the actor flag from the defender, removes the meleePending.
 *
 * Result is exactly 2 chat messages:
 *  - Message 1: handler card (attacker dice + defender weapon buttons).
 *  - Message 2: resolution card (both dice side by side, winner + damage applied).
 */

export class MeleeOpposedChat {

  // ── Public entry points ─────────────────────────────────────────────────

  /**
   * Start a chat-based opposed attack.
   *
   * @param {Actor}  attacker    Attacking actor
   * @param {Item}   weapon      Melee weapon item
   * @param {string} targetUuid  UUID of the defending token/actor
   * @param {string} mode        "opposedPips" | "opposedSuccesses"
   */
  static async initiateAttack(attacker, weapon, targetUuid, mode) {
    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");

    const lastRoll = attacker.system.lastWeaponRoll ?? {};
    attacker._neuroshimaAttackInitiated = true;
    const dialog = new NeuroshimaWeaponRollDialog({
      actor: attacker,
      weapon,
      rollType: "melee",
      meleeAction: "attack",
      targets: [targetUuid],
      lastRoll,
      isPoolRoll: true,
      onRoll: async (rawResult) => {
        delete attacker._neuroshimaAttackInitiated;
        if (!rawResult) return;
        const { NeuroshimaSocket: _NSAtk } = await import("../helpers/socket-helper.js");
        const attackerUuid = attacker.token?.uuid ?? attacker.uuid;
        const condKey = MeleeTurnService._MANEUVER_TO_CONDITION[rawResult.maneuver] || null;
        const hasCharge = (rawResult.chargeLevel ?? 0) > 0;
        const tempoLevel = rawResult.tempoLevel || 0;
        game.neuroshima?.log("[melee-opposed-chat.initiateAttack.onRoll] applying conditions", { attackerUuid, condKey, hasCharge, tempoLevel, targetUuid });
        await _NSAtk.gmExecute("syncActorManeuverConditions", attackerUuid, condKey, hasCharge, tempoLevel);
        if (tempoLevel > 0) {
          await _NSAtk.gmExecute("syncActorManeuverConditions", targetUuid, null, false, tempoLevel);
        }
        await MeleeOpposedChat._createHandlerCard(rawResult, attacker, weapon, targetUuid, mode);
      },
      onClose: () => {
        delete attacker._neuroshimaAttackInitiated;
      }
    });

    await dialog.render(true);
  }

  /**
   * Called when a defender clicks a weapon button ON the chat card.
   *
   * @param {string}      messageId  The handler chat message ID
   * @param {string|null} weaponId   Item ID of the chosen weapon (null = unarmed)
   */
  static async defendFromChat(messageId, weaponId = null) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const data = message.getFlag("neuroshima", "opposedChat");
    if (!data || data.status !== "pending") {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyResolved"));
      return;
    }

    const defenderDoc = fromUuidSync(data.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    if (!defenderActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    if (!defenderActor.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.NotYourTurn"));
      return;
    }

    // Build a synthetic pending object so openDefenseDialog can work
    const pending = {
      id: data.defenderUuid,
      attackerId: data.attackerUuid,
      attackerTokenUuid: data.attackerTokenUuid,
      defenderId: data.defenderUuid,
      mode: data.mode,
      opposedChatMessageId: messageId
    };

    await MeleeOpposedChat.openDefenseDialog(defenderActor, pending, weaponId);
  }

  /**
   * Open the defender's weapon-roll dialog.
   * Called from `defendFromChat`, `_onRespondToOpposed`, or actor-sheet weapon-click.
   *
   * @param {Actor}  defenderActor
   * @param {Object} pending         Must have `mode`, `opposedChatMessageId`
   * @param {string} [weaponId]      Item ID of weapon chosen by defender (optional)
   * @param {Object} [syntheticWeapon] Pre-built synthetic weapon object (e.g. from beast action)
   */
  static async openDefenseDialog(defenderActor, pending, weaponId = null, syntheticWeapon = null) {
    if (!defenderActor.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.NotYourTurn"));
      return;
    }

    const messageId = pending.opposedChatMessageId;
    const message = game.messages.get(messageId);
    if (!message) {
      ui.notifications.warn("Pending chat card not found.");
      return;
    }

    const data = message.getFlag("neuroshima", "opposedChat");
    if (!data || data.status !== "pending") {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyResolved"));
      return;
    }

    // Resolve the weapon: prefer synthetic (beast action), then clicked, then equipped, then any melee
    let defWeapon = syntheticWeapon ?? (weaponId ? defenderActor.items.get(weaponId) : null);
    if (!defWeapon) {
      defWeapon = defenderActor.items.find(
        i => i.type === "weapon" && i.system.weaponType === "melee" && i.system.equipped
      ) ?? defenderActor.items.find(i => i.type === "weapon" && i.system.weaponType === "melee");
    }

    // Unarmed fallback — synthetic brawl weapon, opens dialog normally
    if (!defWeapon) {
      defWeapon = {
        id: null,
        name: game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.Unarmed"),
        img: "systems/neuroshima/assets/img/weapon-melee.svg",
        type: "weapon",
        system: {
          weaponType: "melee",
          attribute: "dexterity",
          skill: "brawl",
          attackBonus: 0,
          defenseBonus: 0,
          damageMelee1: "D",
          damageMelee2: "L",
          damageMelee3: "C",
          requiredBuild: 0,
          piercing: 0,
          magazine: null,
          jamming: 20
        }
      };
    }

    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");
    const lastRoll = defenderActor.system.lastWeaponRoll ?? {};

    const dialog = new NeuroshimaWeaponRollDialog({
      actor: defenderActor,
      weapon: defWeapon,
      rollType: "melee",
      meleeAction: "defense",
      targets: [pending.attackerId],
      lastRoll,
      isPoolRoll: true,
      onRoll: async (rawResult) => {
        if (!rawResult) return;
        const { NeuroshimaSocket: _NSDef } = await import("../helpers/socket-helper.js");
        const defenderUuid = defenderActor.token?.uuid ?? defenderActor.uuid;
        const condKey = MeleeTurnService._MANEUVER_TO_CONDITION[rawResult.maneuver] || null;
        const tempoLevel = rawResult.tempoLevel || 0;
        game.neuroshima?.log("[melee-opposed-chat.openDefenseDialog.onRoll] applying conditions", { defenderUuid, condKey, tempoLevel });
        await _NSDef.gmExecute("syncActorManeuverConditions", defenderUuid, condKey, false, tempoLevel);
        if (tempoLevel > 0) {
          const atkUuid = data.attackerTokenUuid || data.attackerUuid;
          await _NSDef.gmExecute("syncActorManeuverConditions", atkUuid, null, false, tempoLevel);
        }
        await MeleeOpposedChat.resolveOpposed(messageId, pending, defenderActor, rawResult);
      },
      onClose: () => {}
    });

    await dialog.render(true);
  }

  /**
   * Resolve the opposed test and post the resolution card.
   *
   * @param {string} messageId      Handler chat-message ID
   * @param {Object} pending
   * @param {Actor}  defenderActor
   * @param {Object} defenseResult  Raw result from NeuroshimaDice.rollWeaponTest
   */
  static async resolveOpposed(messageId, pending, defenderActor, defenseResult) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const data = message.getFlag("neuroshima", "opposedChat");
    if (!data || data.status !== "pending") return;

    // Mark as resolved immediately (prevents double-click / double-response)
    await MeleeOpposedChat._setChatFlag(message, "opposedChat", { ...data, status: "resolved" });

    const attackerDoc = fromUuidSync(data.attackerTokenUuid || data.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;

    const mode = data.mode;
    const attackDice = data.attackModified;
    const attackTarget = data.attackTarget;
    const attackSuccesses = data.attackSuccesses;

    const defenseDice = (defenseResult.modifiedResults || []).map(r => ({
      original: r.original,
      modified: r.modified,
      isSuccess: r.isSuccess,
      isNat1: r.isNat1 ?? (r.original === 1),
      isNat20: r.isNat20 ?? (r.original === 20)
    }));
    const defenseTarget = defenseResult.target;
    const defenseSuccesses = defenseResult.successPoints
      ?? defenseDice.filter(r => r.isSuccess).length;

    const attackerName = attackerActor?.name ?? "Attacker";
    const defenderName = defenderActor.name;

    // ── Double-skill allocation branch ────────────────────────────────────
    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");
    const attackerSkillBudget = data.attackerSkillBudget ?? 0;
    const defenderSkillBudget = defenseResult.skill ?? 0;

    if (doubleSkill && (attackerSkillBudget > 0 || defenderSkillBudget > 0)) {
      await MeleeOpposedChat._createAllocationCard({
        data, attackerActor, defenderActor,
        attackDice, defenseDice, attackTarget, defenseTarget,
        attackSuccesses, defenseSuccesses,
        attackerSkillBudget, defenderSkillBudget
      });
      await MeleeOpposedChat._updateHandlerToResolved(message, data, attackerActor, defenderActor);
      await MeleeOpposedChat._removePending(pending.id ?? data.defenderUuid);
      await MeleeOpposedChat._unsetDefenderFlag(data.defenderUuid);
      defenderActor?.sheet?.render();
      attackerActor?.sheet?.render();
      return;
    }

    // ── Interactive duel card (default meleeCombatType setting) ──────────
    if ((game.settings.get("neuroshima", "meleeCombatType") || "default") === "default") {
      try {
        const augmentedData = { ...data, defenderManeuver: defenseResult.maneuver ?? null };
        await MeleeOpposedChat._createDuelCard(message, augmentedData, attackerActor, defenderActor, attackDice, defenseDice, attackTarget, defenseTarget);
        await MeleeOpposedChat._updateHandlerToResolved(message, data, attackerActor, defenderActor);
      } catch (err) {
        console.error("Neuroshima | resolveOpposed: failed to create duel card", err);
      } finally {
        await MeleeOpposedChat._removePending(pending.id ?? data.defenderUuid);
        await MeleeOpposedChat._unsetDefenderFlag(data.defenderUuid);
        defenderActor?.sheet?.render();
        attackerActor?.sheet?.render();
      }
      return;
    }

    // ── Resolution logic ──────────────────────────────────────────────────
    let hits = [];
    let resultType = "block";
    let resultText = "";

    if (mode === "opposedPips") {
      for (let i = 0; i < 3; i++) {
        const aDie = attackDice[i];
        const dDie = defenseDice[i];
        if (!aDie) continue;
        const aWins = aDie.isSuccess &&
          (!dDie?.isSuccess || aDie.modified < (dDie?.modified ?? Infinity));
        if (aWins) {
          const tier = i + 1;
          hits.push({ tier, damageType: data[`damage${tier}`] });
        }
      }
      if (hits.length > 0) {
        resultType = "hit";
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogPipsHit", {
          attacker: attackerName,
          defender: defenderName,
          tiers: hits.map(h => `D${h.tier}(${h.damageType})`).join(", ")
        });
      } else {
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogBlock", {
          attacker: attackerName, defender: defenderName
        });
      }
    } else {
      const net = attackSuccesses - defenseSuccesses;
      if (net > 0) {
        resultType = "hit";
        const tier = Math.min(3, net);
        hits.push({ tier, damageType: data[`damage${tier}`] });
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogSuccessesHit", {
          attacker: attackerName, defender: defenderName,
          net, tier, damage: data[`damage${tier}`]
        });
      } else {
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogBlock", {
          attacker: attackerName, defender: defenderName
        });
      }
    }

    // ── Post resolution card ──────────────────────────────────────────────
    const attackDiceDisplay = attackDice.map((d, i) => ({
      label: `D${i + 1}`, ...d,
      isNat1: d.original === 1,
      isNat20: d.original === 20
    }));
    const defenseDiceDisplay = defenseDice.map((d, i) => ({
      label: `D${i + 1}`, ...d,
      isNat1: d.original === 1,
      isNat20: d.original === 20
    }));

    const pairWinners = {};
    if (mode === "opposedPips") {
      for (let i = 0; i < 3; i++) {
        const aDie = attackDice[i];
        const dDie = defenseDice[i];
        const aWins = aDie?.isSuccess && (!dDie?.isSuccess || aDie.modified < (dDie?.modified ?? Infinity));
        const dWins = dDie?.isSuccess && (!aDie?.isSuccess || dDie.modified < (aDie?.modified ?? Infinity));
        pairWinners[i] = { attackWon: aWins ?? false, defenseWon: dWins ?? false };
      }
    }

    const pairedDice = Array.from({ length: 3 }, (_, i) => {
      const aDie = attackDiceDisplay[i] ?? null;
      const dDie = defenseDiceDisplay[i] ?? null;
      const pw = pairWinners[i] ?? {};
      return { label: `D${i + 1}`, attack: aDie, defense: dDie, attackWon: pw.attackWon ?? false, defenseWon: pw.defenseWon ?? false };
    });

    // ── Beast action spending (creature attackers only) ───────────────────
    // Sort hits ascending by tier so fallback always applies lowest-tier first,
    // keeping the highest-tier (heaviest) hits for normal damage when partially spent.
    hits.sort((a, b) => a.tier - b.tier);

    const isCreatureAttacker = attackerActor?.type === "creature";
    let netSuccesses = 0;
    if (mode === "opposedSuccesses") {
      netSuccesses = Math.max(0, attackSuccesses - defenseSuccesses);
    } else {
      netSuccesses = hits.length; // won pips = action point budget
    }

    const affordableBeastActions = [];
    if (isCreatureAttacker && netSuccesses > 0) {
      const beastItemFilter = data.beastItemId ?? null;
      const beastItems = attackerActor.items.filter(i => i.type === "beast-action");
      for (const item of beastItems.filter(i => !beastItemFilter || i.id === beastItemFilter)) {
        for (const act of (item.system.activities ?? [])) {
          if (act.costType !== "success") continue;
          const cost = act.successCost ?? 1;
          if (cost <= netSuccesses) {
            affordableBeastActions.push({
              id: `${item.id}::${act.id}`,
              itemId: item.id,
              name: act.name || item.name,
              img: act.img || item.img,
              cost,
              damage: act.damage || null,
              gmNote: act.gmNote || "",
              hasEffects: (act.effectIds?.length ?? 0) > 0
            });
          }
        }
      }
      affordableBeastActions.sort((a, b) => a.cost - b.cost);
    }

    const resolutionData = {
      mode,
      modeLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${mode}`),
      attackerName,
      attackerImg: attackerActor?.img,
      defenderName,
      defenderImg: defenderActor.img,
      weaponName: attackerActor?.items?.get(data.weaponId)?.name ?? "",
      attackDice: attackDiceDisplay,
      defenseDice: defenseDiceDisplay,
      pairedDice,
      attackTarget,
      defenseTarget,
      attackSuccesses,
      defenseSuccesses,
      resultType,
      resultText,
      hits,
      isHit: resultType === "hit",
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      isCreatureAttacker,
      netSuccesses,
      affordableBeastActions,
      hasBeastActions: affordableBeastActions.length > 0,
      isBeastAttack: isCreatureAttacker && !data.weaponId
    };

    const resContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-result.hbs",
      resolutionData
    );

    const locationRoll = data.attackRaw?.[0] ?? 10;
    const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);

    const rollMode = game.settings.get("core", "rollMode");
    await ChatMessage.create({
      content: resContent,
      flags: {
        neuroshima: {
          opposedResult: {
            attackerUuid: data.attackerUuid,
            defenderUuid: data.defenderUuid,
            weaponId: data.weaponId,
            beastItemId: data.beastItemId ?? null,
            hits,
            location,
            damage1: data.damage1,
            damage2: data.damage2,
            damage3: data.damage3,
            netSuccesses,
            affordableBeastActions,
            isBeastAttack: isCreatureAttacker && !data.weaponId,
            applied: false,
            beastActionsApplied: false
          }
        }
      },
      speaker: { alias: "⚔" },
      rollMode
    });

    // Update handler card to "resolved" state (no dice needed — shown in resolution card)
    const updatedTemplateData = {
      mode,
      modeLabel: resolutionData.modeLabel,
      attackerName,
      attackerImg: attackerActor?.img,
      weaponName: resolutionData.weaponName,
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      defenderName,
      defenderImg: defenderActor.img,
      defenderWeapons: [],
      status: "resolved"
    };
    const updatedContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-pending.hbs",
      updatedTemplateData
    );
    await MeleeOpposedChat._updateChatContent(message, updatedContent);

    // Remove from meleePendings FIRST so when unsetFlag triggers a sheet re-render
    // (via updateActor hook) the combat entry is already gone.
    await MeleeOpposedChat._removePending(pending.id ?? data.defenderUuid);

    // Then clear the actor flag — this triggers updateActor → sheet re-render
    await MeleeOpposedChat._unsetDefenderFlag(data.defenderUuid);

    // Force re-render both sheets — defender's flag unset may not trigger attacker's re-render
    defenderActor?.sheet?.render();
    attackerActor?.sheet?.render();

    // MANEUVER — Trash collector (non-default path):
    // For direct (non-duel-card) resolution, clear maneuver conditions here — this is
    // the final step of the exchange, equivalent to state.status === "done" on a duel card.
    {
      const { NeuroshimaSocket: _NSClear } = await import("../helpers/socket-helper.js");
      await _NSClear.gmExecute("clearActorManeuverConditions", data.attackerTokenUuid || data.attackerUuid);
      await _NSClear.gmExecute("clearActorManeuverConditions", data.defenderTokenUuid || data.defenderUuid);
      game.neuroshima?.log("[melee-opposed-chat.resolveOpposed] maneuver conditions cleared (direct path)", {
        attacker: data.attackerTokenUuid || data.attackerUuid,
        defender: data.defenderTokenUuid || data.defenderUuid
      });
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Update the handler card to "resolved" state.
   * @private
   */
  static async _updateHandlerToResolved(message, data, attackerActor, defenderActor) {
    const mode = data.mode;
    const attackerName = attackerActor?.name ?? "Attacker";
    const defenderName = defenderActor?.name ?? "Defender";
    const weaponName = attackerActor?.items?.get(data.weaponId)?.name ?? "";
    const modeLabel = game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${mode}`);
    const updatedTemplateData = {
      mode,
      modeLabel,
      attackerName,
      attackerImg: attackerActor?.img,
      weaponName,
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      defenderName,
      defenderImg: defenderActor?.img,
      defenderWeapons: [],
      status: "resolved"
    };
    const updatedContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-pending.hbs",
      updatedTemplateData
    );
    await MeleeOpposedChat._updateChatContent(message, updatedContent);
  }

  static _resolveActorMeleeDamage(actor, tier) {
    const DEFAULTS = ["D", "L", "K"];
    const field = `damageMelee${tier}`;
    const weapon = actor?.items?.find(i =>
      i.type === "weapon" && i.system?.weaponGroup === "melee" && i.system?.equipped
    ) ?? actor?.items?.find(i =>
      i.type === "weapon" && i.system?.weaponGroup === "melee"
    ) ?? null;
    const raw = weapon?.system?.[field];
    if (typeof raw === "string" && raw) return raw;
    return DEFAULTS[tier - 1] ?? "D";
  }

  static async _createDuelCard(handlerMessage, data, attackerActor, defenderActor, attackDice, defenseDice, attackTarget, defenseTarget) {
    if (data.isGradCios) {
      const atkSuccessCount = attackDice.filter(d => d.isSuccess).length;
      const defSuccessCount = defenseDice.filter(d => d.isSuccess).length;
      const rollMode = data.rollMode ?? game.settings.get("core", "rollMode");
      const toChip = d => ({ value: d.modified ?? d.original ?? d.value, isSuccess: d.isSuccess, isNat20: d.isNat20 ?? false });
      const netSuccesses = atkSuccessCount - defSuccessCount;

      if (netSuccesses > 0) {
        const tier = Math.min(netSuccesses, 3);
        const damage = data[`damage${tier}`] ?? data.damage1 ?? "?";
        const locationRoll = data.attackRaw?.[0] ?? 10;
        const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);
        const outcomeLabel = game.i18n.format("NEUROSHIMA.GradCios.Hit", { n: tier, dmg: damage });
        const hitContent = await foundry.applications.handlebars.renderTemplate(
          "systems/neuroshima/templates/chat/melee-hail-card.hbs",
          {
            attackerName:    attackerActor?.name ?? "",
            attackerImg:     attackerActor?.img  ?? "",
            defenderName:    defenderActor?.name ?? "",
            defenderImg:     defenderActor?.img  ?? "",
            attackDiceChips: attackDice.map(toChip),
            attackSuccesses: atkSuccessCount,
            isPending:       false,
            isDone:          true,
            defenseDiceChips: defenseDice.map(toChip),
            isBlocked: false,
            hasHit:    true,
            outcomeLabel
          }
        );
        await ChatMessage.create({
          content: hitContent,
          flags: {
            neuroshima: {
              hailResult: {
                attackerUuid: data.attackerUuid,
                defenderUuid: data.defenderUuid,
                weaponId:     data.weaponId,
                tier,
                damage1:  data.damage1,
                damage2:  data.damage2,
                damage3:  data.damage3,
                location
              }
            }
          },
          speaker: { alias: "⚔" },
          rollMode
        });
      } else {
        const outcomeLabel = netSuccesses === 0
          ? game.i18n.localize("NEUROSHIMA.GradCios.EqualSuccessesBlock")
          : game.i18n.localize("NEUROSHIMA.GradCios.Blocked");
        const blockContent = await foundry.applications.handlebars.renderTemplate(
          "systems/neuroshima/templates/chat/melee-hail-card.hbs",
          {
            attackerName:    attackerActor?.name ?? "",
            attackerImg:     attackerActor?.img  ?? "",
            defenderName:    defenderActor?.name ?? "",
            defenderImg:     defenderActor?.img  ?? "",
            attackDiceChips: attackDice.map(toChip),
            attackSuccesses: atkSuccessCount,
            isPending:       false,
            isDone:          true,
            defenseDiceChips: defenseDice.map(toChip),
            isBlocked: true,
            hasHit:    false,
            outcomeLabel
          }
        );
        await ChatMessage.create({ content: blockContent, speaker: { alias: "⚔" }, rollMode });
      }
      return;
    }

    const segCount = Math.min(3, attackDice.length, defenseDice.length || 1);
    const initiativeOwnerSide = data.szachistaYield ? "defender" : "attacker";
    const state = {
      status: "picking",
      initiativeOwnerSide,
      isGradCios: data.isGradCios || false,
      waitingFor: "initiativeOwner",
      committedOwnerIndices: null,
      currentSegment: 0,
      attackerUuid: data.attackerUuid,
      attackerTokenUuid: data.attackerTokenUuid ?? null,
      defenderUuid: data.defenderUuid,
      defenderTokenUuid: data.defenderTokenUuid ?? null,
      attackerManeuver: data.attackerManeuver ?? null,
      defenderManeuver: data.defenderManeuver ?? null,
      weaponId: data.weaponId,
      beastItemId: data.beastItemId ?? null,
      attackDice,
      defenseDice,
      attackTarget,
      defenseTarget,
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      defenderDamage1: MeleeOpposedChat._resolveActorMeleeDamage(defenderActor, 1),
      defenderDamage2: MeleeOpposedChat._resolveActorMeleeDamage(defenderActor, 2),
      defenderDamage3: MeleeOpposedChat._resolveActorMeleeDamage(defenderActor, 3),
      usedAttackDice: [],
      usedDefenseDice: [],
      segments: Array.from({ length: segCount }, (_, i) => ({
        segNum: i + 1,
        attackVal: null,
        defenseVal: null,
        outcome: null
      })),
      hits: [],
      applied: false,
      activatedMeleePreRollMods: data.activatedMeleePreRollMods ?? []
    };

    const context = await MeleeOpposedChat._buildDuelContext(state, attackerActor, defenderActor);
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-duel-card.hbs",
      context
    );
    const rollMode = game.settings.get("core", "rollMode");
    await ChatMessage.create({
      content,
      flags: { neuroshima: { duelCard: state } },
      speaker: { alias: "⚔" },
      rollMode
    });
    await MeleeOpposedChat._syncInitiativeToTracker(state);
  }

  static async _buildDuelContext(state, attackerActor, defenderActor) {
    const {
      attackDice, defenseDice, usedAttackDice, usedDefenseDice,
      waitingFor, initiativeOwnerSide, committedOwnerIndices,
      currentSegment, status, hits, segments, isGradCios
    } = state;

    const declaredAction = state.declaredAction || null;

    const isOwnerAttacker  = initiativeOwnerSide === "attacker";
    const isOwnerTurn      = status === "picking" && waitingFor === "initiativeOwner";
    const isResponderTurn  = status === "picking" && waitingFor === "responder";
    const ownerPool        = isOwnerAttacker ? "attacker" : "defender";
    const responderPool    = isOwnerAttacker ? "defender" : "attacker";
    const committedIndices = committedOwnerIndices || [];

    const gradCiosVisibleAttackSet = (isGradCios && ownerPool === "attacker")
      ? isOwnerTurn
        ? new Set(
            (attackDice || [])
              .map((d, i) => d.isSuccess ? i : -1)
              .filter(i => i >= 0)
          )
        : new Set(committedIndices)
      : null;

    const attackDiceChips = (attackDice || []).map((d, idx) => {
      const isUsed      = (usedAttackDice || []).includes(idx);
      const isCommitted = !isUsed && ownerPool === "attacker" && committedIndices.includes(idx);
      let isClickable = false;
      let isHidden = false;
      if (!isUsed && !isCommitted) {
        if (isOwnerTurn    && ownerPool    === "attacker") isClickable = true;
        if (isResponderTurn && responderPool === "attacker") isClickable = true;
        if (isGradCios && !d.isSuccess) isClickable = false;
      }
      if (gradCiosVisibleAttackSet !== null && !isUsed) {
        isHidden = !gradCiosVisibleAttackSet.has(idx);
        if (isHidden) isClickable = false;
      }
      return {
        idx, value: d.modified ?? d.original,
        isSuccess: d.isSuccess,
        isNat1: d.isNat1 ?? (d.original === 1),
        isNat20: d.isNat20 ?? (d.original === 20),
        isUsed, isCommitted, isClickable, isHidden
      };
    });

    const gradCiosAtkSuccessCount = (attackDice || []).filter(d => d.isSuccess).length;
    const gradCiosVisibleDefenseSet = (isGradCios && ownerPool === "attacker")
      ? isResponderTurn
        ? new Set(
            (defenseDice || [])
              .map((d, i) => d.isSuccess ? i : -1)
              .filter(i => i >= 0)
              .slice(0, committedIndices.length)
          )
        : new Set(
            (defenseDice || [])
              .map((d, i) => ({ v: d.modified ?? d.original ?? 0, i }))
              .sort((a, b) => a.v - b.v)
              .slice(0, gradCiosAtkSuccessCount)
              .map(({ i }) => i)
          )
      : null;

    const defenseDiceChips = (defenseDice || []).map((d, idx) => {
      const isUsed      = (usedDefenseDice || []).includes(idx);
      const isCommitted = !isUsed && ownerPool === "defender" && committedIndices.includes(idx);
      let isClickable = false;
      let isHidden = false;
      if (!isUsed && !isCommitted) {
        if (isOwnerTurn    && ownerPool    === "defender") isClickable = true;
        if (isResponderTurn && responderPool === "defender") isClickable = true;
        if (isGradCios && !d.isSuccess) isClickable = false;
      }
      if (gradCiosVisibleDefenseSet !== null && !isUsed) {
        isHidden = !gradCiosVisibleDefenseSet.has(idx);
        if (isHidden) isClickable = false;
      }
      return {
        idx, value: d.modified ?? d.original,
        isSuccess: d.isSuccess,
        isNat1: d.isNat1 ?? (d.original === 1),
        isNat20: d.isNat20 ?? (d.original === 20),
        isUsed, isCommitted, isClickable, isHidden
      };
    });

    const responderExactDice = gradCiosVisibleDefenseSet !== null
      ? gradCiosVisibleDefenseSet.size
      : committedIndices.length;

    const segmentDots = (segments || []).map((s, i) => {
      let dotClass = "";
      if (s.outcome !== null) dotClass = `is-done is-${s.outcome}`;
      else if (status === "picking" && i === currentSegment) dotClass = "is-active";
      return { segNum: s.segNum, dotClass };
    });

    const ownerName     = isOwnerAttacker ? (attackerActor?.name ?? "") : (defenderActor?.name ?? "");
    const responderName = isOwnerAttacker ? (defenderActor?.name ?? "") : (attackerActor?.name ?? "");
    const effectiveDeclared      = declaredAction || (isResponderTurn ? "attack" : null);
    const ownerDeclaredAttack    = isResponderTurn && effectiveDeclared === "attack";
    const ownerDeclaredExit      = isResponderTurn && effectiveDeclared === "exit";
    const ownerDeclaredNonCombat = isResponderTurn && effectiveDeclared === "nonCombat";
    // Sztuczka — traktowana jak atak (obrońca broni się tak samo)
    const ownerDeclaredTrick        = isResponderTurn && effectiveDeclared === "trick";
    const ownerDeclaredAttackOrTrick = ownerDeclaredAttack || ownerDeclaredTrick;

    let responderConfirmActionType = "defend";
    let responderConfirmLabel      = game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelConfirmDefense");
    if (declaredAction === "exit") {
      responderConfirmActionType = "blockExit";
      responderConfirmLabel      = game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelBlockExit");
    } else if (declaredAction === "nonCombat") {
      responderConfirmActionType = "interrupt";
      responderConfirmLabel      = game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelInterrupt");
    }

    let phaseBanner = "";
    if (status === "picking") {
      const segLabel = `${game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelSegment")} ${currentSegment + 1}`;
      if (isOwnerTurn) {
        phaseBanner = `${segLabel}: ${ownerName} ${game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelWaitingOwner")}`;
      } else {
        const n = committedIndices.length;
        const actionTextMap = {
          attack:    game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelOwnerAttacks"),
          exit:      game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelOwnerExits"),
          nonCombat: game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelOwnerNonCombat"),
        };
        const actionText = actionTextMap[declaredAction] || actionTextMap.attack;
        phaseBanner = `${segLabel}: ${ownerName} ${actionText}. ${responderName} ${game.i18n.format("NEUROSHIMA.MeleeDuel.DuelWaitingResponder", { n })}`;
      }
    } else {
      phaseBanner = game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelDone");
    }

    const ownerActorUuid     = isOwnerAttacker ? state.attackerUuid : state.defenderUuid;
    const responderActorUuid = isOwnerAttacker ? state.defenderUuid : state.attackerUuid;

    const ownerActorDoc = fromUuidSync(isOwnerAttacker ? (state.attackerTokenUuid || state.attackerUuid) : state.defenderUuid);
    const ownerActor    = ownerActorDoc?.actor ?? ownerActorDoc;
    const ownerIsCreature = ownerActor?.type === "creature";

    // Berserker: sprawdź czy odpowiadający ma stan berserkera i może kontr-atakować.
    // Stan "berserker" jest nadawany przez efekt sztuczki Berserker (Effect 2, statuses: ["berserker"]).
    // Używamy już rozwiązanych aktorów z parametrów — nie rozwiązujemy ponownie przez UUID.
    const responderActorCheck = isOwnerAttacker ? defenderActor : attackerActor;
    const responderCanCounterAttack = !!ownerDeclaredAttackOrTrick &&
      (responderActorCheck?.statuses?.has("berserker") ?? false);

    const ownerDiceArr = isOwnerAttacker ? (attackDice || []) : (defenseDice || []);
    const committedSuccessCount = committedIndices.filter(i => ownerDiceArr[i]?.isSuccess).length;

    let ownerBeastActions = null;
    if (ownerIsCreature) {
      const flat = [];
      const ownerBeastItemFilter = state.beastItemId ?? null;
      for (const item of ownerActor.items.filter(i => i.type === "beast-action" && (!ownerBeastItemFilter || i.id === ownerBeastItemFilter))) {
        for (const act of (item.system.activities ?? [])) {
          if (act.costType !== "success") continue;
          flat.push({
            id: `${item.id}::${act.id}`,
            itemId: item.id,
            name: act.name || item.name,
            img: act.img || item.img,
            successCost: act.successCost ?? 1,
            damage: act.damage || null,
            isAffordable: committedSuccessCount >= (act.successCost ?? 1)
          });
        }
      }
      if (flat.length > 0) {
        ownerBeastActions = flat.sort((a, b) => a.successCost - b.successCost);
      }
    }

    // getMeleeActions trigger — fires for non-creature actors during their own turn.
    // Effect scripts push extra action entries (sztuczki like Barbarka) to args.actions.
    // Actions with successCost > 0 appear in a queue section (like beast actions, budget = uncommitted successes).
    // Actions without successCost appear as standalone attack-alternative buttons.
    let ownerExtraActions = null;  // trick action buttons (all types)
    if (ownerActor && !ownerIsCreature && status === "picking" && isOwnerTurn) {
      // --- helper context for effect scripts ---
      const ownerDiceArrFull = isOwnerAttacker ? (attackDice || []) : (defenseDice || []);
      const usedOwnerSet = new Set(isOwnerAttacker ? (usedAttackDice || []) : (usedDefenseDice || []));
      const uncommittedOwnerDice = ownerDiceArrFull.filter((_, i) => !usedOwnerSet.has(i));
      const uncommittedDiceCount    = uncommittedOwnerDice.length;
      const uncommittedSuccessCount = uncommittedOwnerDice.filter(d => d.isSuccess).length;

      // Segments resolved before the current one (outcome not null and not "spent")
      const pastSegs = (segments || []).slice(0, currentSegment).filter(s => s.outcome && s.outcome !== "spent");
      // ownerHadHit: any previous segment with outcome "hit" (from attacker's perspective)
      const ownerHadHit      = pastSegs.some(s => s.outcome === "hit");
      const ownerPreviousHits = pastSegs.filter(s => s.outcome === "hit");

      // getMeleeActions — two modes:
      // • isDialogScript === false: always fires passively, pushes actions to extraActionsArr.
      // • isDialogScript === true: shown as checkbox in the pre-roll weapon dialog.
      //   On the duel card its passive `code` runs only when the modifier was activated
      //   in the pre-roll dialog (UUID present in state.activatedMeleePreRollMods).
      const activatedPreRollMods = new Set(state.activatedMeleePreRollMods ?? []);
      const extraActionsArr = [];
      try {
        const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");

        // lookupActionDef: searches all effects on the actor (and their items) for an actionDef by id or name.
        // Available in scripts as args.lookupActionDef("uuid-or-name").
        const lookupActionDef = (idOrName) => {
          const match = (d) => d.id === idOrName || d.name === idOrName;
          for (const effect of (ownerActor.effects ?? [])) {
            const def = (effect.system?.actionDefs ?? []).find(match);
            if (def) return foundry.utils.deepClone(def);
          }
          for (const item of (ownerActor.items ?? [])) {
            for (const effect of (item.effects ?? [])) {
              const def = (effect.system?.actionDefs ?? []).find(match);
              if (def) return foundry.utils.deepClone(def);
            }
          }
          return null;
        };

        const triggerArgs = {
          actor: ownerActor,
          state,
          actions: extraActionsArr,
          ownerHadHit,
          ownerPreviousHits,
          uncommittedDice: uncommittedDiceCount,
          uncommittedSuccesses: uncommittedSuccessCount,
          lookupActionDef
        };

        const allMeleeScripts = NeuroshimaScriptRunner.getScripts(ownerActor, "getMeleeActions");
        for (const script of allMeleeScripts) {
          // isDialogScript: only run when the modifier was activated in the pre-roll dialog.
          // Non-dialog scripts (passive) always run.
          const shouldRun = !script.isDialogScript ||
            (script.effect?.uuid && activatedPreRollMods.has(script.effect.uuid));
          if (!shouldRun) continue;

          const prevLength = extraActionsArr.length;

          if (script.useActionDef && script.actionDef) {
            // Action Builder path: declarative action definition, no raw JS code execution.
            try {
              await MeleeOpposedChat._buildActionFromDef(script, triggerArgs, extraActionsArr);
            } catch (err) {
              game.neuroshima?.log("[getMeleeActions] actionDef error", err);
            }
          } else if (script.code?.trim()) {
            try {
              await script.execute(triggerArgs);
            } catch (err) {
              game.neuroshima?.log("[getMeleeActions] trigger error", err);
            }
          }

          // Expand any string IDs pushed by this script using the script's parent effect actionDefs.
          // Scripts can push a plain string: args.actions.push("my-action-id")
          // The system resolves it to the full actionDef stored on the effect.
          // After expansion, @effect.* / @item.* / @mod.* tokens in `name` are resolved.
          for (let i = prevLength; i < extraActionsArr.length; i++) {
            const entry = extraActionsArr[i];
            if (typeof entry === "string") {
              const effectDefs = script.effect?.system?.actionDefs ?? [];
              const localMatch = (d) => d.id === entry || d.name === entry;
              const def = effectDefs.find(localMatch) ?? lookupActionDef(entry);
              extraActionsArr[i] = def ? foundry.utils.deepClone(def) : null;
              if (!def) game.neuroshima?.log("[getMeleeActions] actionDef not found:", entry);
            }
            const resolved = extraActionsArr[i];
            if (resolved && typeof resolved === "object") {
              if (resolved.name) {
                resolved.name = NeuroshimaScriptRunner._resolveItemRef(
                  resolved.name, script.effect?.parent ?? null, script.effect ?? null
                );
              }
              if (!resolved._effectUuid && script.effect?.uuid) {
                resolved._effectUuid = script.effect.uuid;
              }
            }
          }
        }
        // Remove null entries (unresolved IDs)
        for (let i = extraActionsArr.length - 1; i >= 0; i--) {
          if (extraActionsArr[i] == null) extraActionsArr.splice(i, 1);
        }
      } catch (err) {
        game.neuroshima?.log("[getMeleeActions] trigger error", err);
      }
      if (extraActionsArr.length > 0) {
        // ── Convenience field expansion ───────────────────────────────────
        // Expand `applyEffectOnHit` and `notifyOnHit` shorthand into
        // a generated onHitScript string. This runs before normalization
        // so the generated code lands in trickOnHitScripts automatically.
        for (const a of extraActionsArr) {
          // applyEffectOnHit: "Effect Name"
          // Finds the named ActiveEffect by searching all items on the attacker,
          // checks isEffectActive to avoid duplicates, then applies convertToApplied() on hit.
          if (a.applyEffectOnHit && !a.onHitScript) {
            const safeName = JSON.stringify(a.applyEffectOnHit);
            a.onHitScript = [
              `let _tmpl = null;`,
              `for (const _it of (args.actor?.items ?? [])) {`,
              `  _tmpl = _it.effects?.getName(${safeName});`,
              `  if (_tmpl) break;`,
              `}`,
              `if (!_tmpl || !args.target) { neuroshima.log("[applyEffectOnHit] effect not found:", ${safeName}); return; }`,
              `if (this.isEffectActive(_tmpl, args.target)) { neuroshima.log("[applyEffectOnHit] already active:", ${safeName}); return; }`,
              `const _data = _tmpl.convertToApplied();`,
              `await args.target.createEmbeddedDocuments("ActiveEffect", [_data]);`,
              `neuroshima.log("[applyEffectOnHit] applied", ${safeName}, "to", args.target?.name);`
            ].join("\n");
          }
          // notifyOnHit: "Tekst powiadomienia"
          // Shows a UI notification when the action hits (attacker vs target).
          if (a.notifyOnHit && !a.onHitScript) {
            const safeText = JSON.stringify(a.notifyOnHit);
            a.onHitScript = `ui.notifications.info(\`\${${safeText}}: \${args.actor?.name} vs \${args.target?.name}\`);`;
          }
        }

        const normalized = extraActionsArr.map(a => ({
          id:             a.id             ?? `trick-${foundry.utils.randomID(8)}`,
          name:           a.name           ?? a.label ?? "Sztuczka",
          img:            a.img            ?? "systems/neuroshima/assets/effects/gears.svg",
          damage:         a.damage         ?? "D",
          successCost:    a.successCost    ?? 0,
          minDice:        a.minDice        ?? 1,
          maxDice:        a.maxDice        ?? 3,
          annotation:     a.annotation     ?? null,
          onHitScript:    a.onHitScript    ?? null,
          immediateOnHit: a.immediateOnHit ?? false,
          _effectUuid:    a._effectUuid    ?? null
        }));
        ownerExtraActions = normalized.length ? normalized : null;

        const onHitMap = {};
        for (const a of normalized) {
          if (a.onHitScript) onHitMap[a.id] = { code: a.onHitScript, effectUuid: a._effectUuid ?? null, immediate: a.immediateOnHit ?? false };
        }
        if (Object.keys(onHitMap).length > 0) {
          state.trickOnHitScripts = { ...(state.trickOnHitScripts ?? {}), ...onHitMap };
        }
      }
    }

    const damageTiers = (state.damage1 || state.damage2 || state.damage3) ? {
      d: state.damage1 ?? "?",
      l: state.damage2 ?? "?",
      k: state.damage3 ?? "?"
    } : null;

    const resolvedSegs = (segments || []).filter(s => s.outcome !== null).map(s => ({
      segNum: s.segNum,
      attackVal: s.attackVal,
      defenseVal: s.defenseVal,
      outcome: s.outcome,
      outcomeLabel: game.i18n.localize(`NEUROSHIMA.MeleeDuel.DuelSegResult.${s.outcome}`)
    }));

    const confirmOwnerLabel = game.i18n.format("NEUROSHIMA.MeleeDuel.DuelConfirmAttack", { n: 0 });
    const canSwapInit = game.user.isGM && status === "picking" && !isGradCios;

    // ── Hits-detail: przygotuj etykietowane ciosy dla obu stron ──────────────
    // Ciosy atakującego idą do obrońcy (state.hits).
    // Kontr-ciosy berserkera (state.counterHits) idą do atakującego.
    // Dla kontr-ciosów rozwiązujemy typ obrażeń z broni obrońcy już tutaj.
    const attackerNameLabel = attackerActor?.name ?? "Attacker";
    const defenderNameLabel = defenderActor?.name ?? "Defender";

    // Mapowanie kodu obrażeń → skrócony label, tooltip PL + klasa CSS dla badge
    const _dmgCode = (code) => {
      // Zawsze sprowadź do stringa — code może być obiektem, tablicą lub undefined
      if (typeof code === "string" && code) return code;
      if (Array.isArray(code) && code.length) return String(code[0]);
      if (code != null && typeof code === "object") {
        // próbuj wyciągnąć z typowych pól modeli danych
        const v = code.value ?? code.damageType ?? code.label ?? code.type ?? null;
        if (typeof v === "string" && v) return v;
        game.neuroshima?.log?.("[hitsDetail] unknown damageType object:", code);
        return "?";
      }
      return "?";
    };
    const _dmgMeta = (code) => {
      const raw = _dmgCode(code);
      const up  = raw.toUpperCase();
      // Obsługa s-prefix (sC, sL, sD, sK — poważny wariant)
      if (up.length === 2 && up[0] === "S") {
        const base = up[1];
        const baseTip = { K: "Krytyczna rana", C: "Ciężka rana", L: "Lekka rana", D: "Draśnięcie" }[base] ?? base;
        const baseCls = { K: "hit-badge--crit", C: "hit-badge--heavy", L: "hit-badge--light", D: "hit-badge--scratch" }[base] ?? "";
        return { label: raw, tooltip: `Poważna ${baseTip}`, cls: `${baseCls} hit-badge--serious` };
      }
      if (up === "K")  return { label: "K",  tooltip: "Krytyczna rana",  cls: "hit-badge--crit"    };
      if (up === "C")  return { label: "C",  tooltip: "Ciężka rana",     cls: "hit-badge--heavy"   };
      if (up === "L")  return { label: "L",  tooltip: "Lekka rana",      cls: "hit-badge--light"   };
      if (up === "D")  return { label: "D",  tooltip: "Draśnięcie",      cls: "hit-badge--scratch" };
      return { label: raw || "?", tooltip: raw || "?", cls: "" };
    };

    const _buildHit = (h, srcName, tgtName) => {
      const meta = _dmgMeta(h.damageType);
      return {
        tier:           h.tier,
        damageType:     _dmgCode(h.damageType),
        damageLabel:    meta.label,
        damageTooltip:  meta.tooltip,
        damageClass:    meta.cls,
        sourceName:     srcName,
        targetName:     tgtName
      };
    };

    const hitsDetail = (hits || []).map(h => _buildHit(h, attackerNameLabel, defenderNameLabel));

    let counterHitsDetail = [];
    if ((state.counterHits || []).length > 0) {
      counterHitsDetail = state.counterHits.map(h =>
        _buildHit(h, defenderNameLabel, attackerNameLabel)
      );
    }
    const hasCounterHits = counterHitsDetail.length > 0;
    const hasAnyHits = hitsDetail.length > 0 || hasCounterHits;

    return {
      status,
      attackerName: attackerNameLabel,
      attackerImg:  attackerActor?.img  ?? "",
      defenderName: defenderNameLabel,
      defenderImg:  defenderActor?.img  ?? "",
      phaseBanner, segmentDots, attackDiceChips, defenseDiceChips, resolvedSegs,
      hits: hits || [], hasHits: (hits || []).length > 0, isDone: status === "done",
      hitsDetail, counterHitsDetail, hasCounterHits, hasAnyHits,
      isOwnerAttacker, isOwnerTurn, isResponderTurn,
      ownerPool, responderPool, ownerActorUuid, responderActorUuid,
      committedOwnerCount: committedIndices.length,
      damageTiers, confirmOwnerLabel, canSwapInit, isGradCios: isGradCios || false,
      ownerDeclaredAttack, ownerDeclaredExit, ownerDeclaredNonCombat, ownerDeclaredTrick, ownerDeclaredAttackOrTrick,
      responderConfirmActionType, responderConfirmLabel, responderExactDice,
      ownerIsCreature, ownerBeastActions, committedSuccessCount,
      ownerExtraActions, responderCanCounterAttack,
      isGM:    game.user.isGM,
      canUndo: game.user.isGM && (state.segmentHistory?.length ?? 0) > 0,
      canRedo: game.user.isGM && (state.segmentFuture?.length  ?? 0) > 0
    };
  }

  static async _renderDuelCard(message, state) {
    const attackerDoc = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc ?? null;
    const defenderDoc = fromUuidSync(state.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc ?? null;

    const context = await MeleeOpposedChat._buildDuelContext(state, attackerActor, defenderActor);
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-duel-card.hbs",
      context
    );
    await message.setFlag("neuroshima", "duelCard", state);
    await message.update({ content });
  }

  static onRenderDuelCard(root, message) {
    root = root instanceof HTMLElement ? root : root[0];
    if (!root) return;

    const state = message.getFlag("neuroshima", "duelCard");
    if (!state || state.status !== "picking") return;

    root.querySelectorAll("[data-melee-owner]").forEach(el => {
      const ownerUuid = el.dataset.meleeOwner;
      if (!ownerUuid) return;
      const doc   = fromUuidSync(ownerUuid);
      const actor = doc?.actor ?? doc;
      const canAct = game.user.isGM || actor?.isOwner;
      if (!canAct) {
        el.style.opacity       = "0.4";
        el.style.pointerEvents = "none";
      }
    });

    const updateActionButtons = () => {
      const selectedChips = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
      const count        = selectedChips.length;
      const hasSuccess   = selectedChips.some(chip => chip.classList.contains("is-success"));
      const successCount = selectedChips.filter(chip => chip.classList.contains("is-success")).length;

      root.querySelectorAll(".mdc-action-choice").forEach(btn => {
        const noDice      = btn.dataset.noDice === "true";
        const exactDice   = btn.dataset.exactDice  !== undefined ? parseInt(btn.dataset.exactDice,  10) : null;
        const minDice     = btn.dataset.minDice     !== undefined ? parseInt(btn.dataset.minDice,    10) : null;
        const maxDice     = btn.dataset.maxDice     !== undefined ? parseInt(btn.dataset.maxDice,    10) : null;
        const needSuccess = btn.dataset.needSuccess === "true";
        const minSuccess  = btn.dataset.minSuccess  !== undefined ? parseInt(btn.dataset.minSuccess, 10) : null;

        let ok;
        if (noDice) {
          ok = true;
        } else if (exactDice !== null) {
          ok = count === exactDice;
        } else {
          const min = minDice ?? 1;
          const max = maxDice ?? Infinity;
          ok = count >= min && count <= max;
        }
        if (ok && needSuccess && !hasSuccess) ok = false;
        if (ok && minSuccess !== null && successCount < minSuccess) ok = false;

        btn.disabled = !ok;
        btn.classList.toggle("is-disabled", !ok);
        btn.classList.toggle("is-ready",    ok);

        // Aktualizuj licznik wybranych/dostępnych kości w .mac-counter
        const counterEl = btn.querySelector(".mac-counter");
        if (counterEl) {
          if (minSuccess !== null) {
            // Sztuczki z successCost — pokazuj ile sukcesów wybrano / ile wymaganych
            counterEl.textContent = `${successCount}/${minSuccess}✦`;
          } else if (exactDice !== null) {
            counterEl.textContent = `${count}/${exactDice}`;
          } else if (maxDice !== null) {
            counterEl.textContent = `${count}/${maxDice}`;
          } else {
            // Brak górnego limitu (np. interrupt) — pokazuj tylko liczbę wybranych kości
            counterEl.textContent = `${count}`;
          }
        }
      });
    };

    root.querySelectorAll("button.die-chip-mvc").forEach(chip => {
      chip.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        chip.classList.toggle("mvc-die-selected");
        updateActionButtons();
        updateBeastQueue();
        updateTrickQueue();
      });
    });

    root.querySelectorAll(".mdc-action-choice").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;

        const actionType = btn.dataset.actionType;
        const pool       = btn.dataset.pool;
        const selected   = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
        const indices    = selected.map(c => parseInt(c.dataset.dieIdx, 10)).filter(n => !isNaN(n));

        // Sztuczki gracza (getMeleeActions) mają action-type="trick" z dodatkowymi atrybutami.
        // Kodujemy jako "trick:ID:damage" aby applyDuelBatch mógł parsować metadane sztuczki.
        let actionArg = actionType;
        if (actionType === "trick") {
          const trickId     = btn.dataset.trickId     ?? "";
          const trickDamage = btn.dataset.trickDamage ?? "";
          actionArg = `trick:${trickId}:${trickDamage}`;
        }

        // Jeśli gracz zatwierdza atak i ma aktywną kolejkę sztuczek (successCost > 0),
        // zbieramy zakolejkowane sztuczki i przekazujemy jako beastQueue z prefiksem "trick:".
        // applyDuelBatch rozpozna te wpisy i oddzieli je od akcji bestii.
        let extraQueue = null;
        if (actionType === "attack") {
          const tqs = root.querySelector(".mdc-trick-queue-section");
          if (tqs) {
            const trickItems = [];
            tqs.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
              const qty = parseInt(el.textContent, 10) || 0;
              const id  = el.dataset.trickId;
              const dmg = el.dataset.trickDamage ?? "";
              if (qty > 0 && id) {
                for (let i = 0; i < qty; i++) trickItems.push(`trick:${id}:${dmg}`);
              }
            });
            if (trickItems.length) extraQueue = trickItems;
          }

          // getMeleeActions dialog modifiers — zaznaczone checkboxy uruchamiają swój skrypt
          // i dodają wypchnięte akcje jako trick-queue entries (aplikowane bezwarunkowo).
          const dmsSection = root.querySelector(".mdc-dialog-modifiers-section");
          if (dmsSection) {
            const checkedMods = [...dmsSection.querySelectorAll(".mdc-dialog-mod-check:checked")];
            if (checkedMods.length > 0) {
              try {
                const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
                const duelState = message.getFlag("neuroshima", "duelCard");
                const ownerUuid = root.querySelector("[data-melee-owner]")?.dataset.meleeOwner;
                const ownerDocMod = fromUuidSync(ownerUuid);
                const ownerActorMod = ownerDocMod?.actor ?? ownerDocMod;

                const segments = duelState?.segments ?? [];
                const currentSeg = duelState?.currentSegment ?? 0;
                const pastSegs = segments.slice(0, currentSeg).filter(s => s.outcome && s.outcome !== "spent");
                const ownerIsAttacker = duelState?.initiativeOwnerSide === "attacker";
                const ownerDiceArr = ownerIsAttacker ? (duelState?.attackDice ?? []) : (duelState?.defenseDice ?? []);
                const usedSet = new Set(ownerIsAttacker ? (duelState?.usedAttackDice ?? []) : (duelState?.usedDefenseDice ?? []));
                const uncommitted = ownerDiceArr.filter((_, ii) => !usedSet.has(ii));

                for (const cb of checkedMods) {
                  const entry = cb.closest("[data-effect-uuid]");
                  const effectUuid = entry?.dataset.effectUuid;
                  const scriptIdx  = parseInt(entry?.dataset.scriptIdx ?? "-1", 10);
                  if (!effectUuid || scriptIdx < 0) continue;

                  const eff = fromUuidSync(effectUuid);
                  if (!eff) continue;
                  const scriptData = eff.system?.scriptData?.[scriptIdx];
                  if (!scriptData) continue;

                  const script = new NeuroshimaScript(scriptData, eff);
                  const dialogActions = [];
                  // Skrypt zatwierdzenia dla trybu isDialogScript:
                  // Jeśli zdefiniowany submissionScript → wywołaj runSubmission() (dedykowany handler zatwierdzenia).
                  // Fallback → execute() (główny skrypt "code"), dla zachowania wstecznej kompatybilności.
                  const triggerArgs = {
                    actor: ownerActorMod,
                    state: duelState,
                    actions: dialogActions,
                    ownerHadHit: pastSegs.some(s => s.outcome === "hit"),
                    ownerPreviousHits: pastSegs.filter(s => s.outcome === "hit"),
                    uncommittedDice: uncommitted.length,
                    uncommittedSuccesses: uncommitted.filter(d => d.isSuccess).length
                  };
                  try {
                    if (script.submissionScript) {
                      await script.runSubmission(triggerArgs);
                    } else {
                      await script.execute(triggerArgs);
                    }
                  } catch (err) {
                    game.neuroshima?.log("[getMeleeActions dialog] script exec error", err);
                  }
                  // Wszystkie akcje z dialogowego modifikatora wchodzą jako trick-queue entries.
                  for (const a of dialogActions) {
                    if (!a.id || !a.damage) continue;
                    if (!extraQueue) extraQueue = [];
                    extraQueue.push(`trick:${a.id}:${a.damage}`);
                  }
                }
              } catch (err) {
                game.neuroshima?.log("[getMeleeActions dialog] import error", err);
              }
            }
          }
        }

        if (game.user.isGM) {
          await MeleeOpposedChat.applyDuelBatch(message.id, pool, indices, actionArg, extraQueue);
        } else if (game.neuroshima?.socket) {
          await game.neuroshima.socket.executeAsGM("applyDuelBatch", message.id, pool, indices, actionArg, extraQueue);
        }
      });
    });

    const beastQueueSection = root.querySelector(".mdc-beast-queue-section");
    const updateBeastQueue = () => {
      if (!beastQueueSection) return;
      const budgetRemainingEl = beastQueueSection.querySelector(".mdc-beast-budget-remaining");
      const budgetTotalEl     = beastQueueSection.querySelector(".mdc-beast-budget-total");
      const confirmBtn        = beastQueueSection.querySelector(".mdc-beast-confirm-btn");

      const budget = root.querySelectorAll("button.die-chip-mvc.mvc-die-selected").length;

      let spent = 0;
      beastQueueSection.querySelectorAll(".mdc-beast-qty-val").forEach(el => {
        const qty  = parseInt(el.textContent, 10) || 0;
        const cost = parseInt(el.closest(".mdc-beast-action-entry")?.dataset.cost, 10) || 1;
        spent += qty * cost;
      });

      const remaining = budget - spent;
      if (budgetRemainingEl) budgetRemainingEl.textContent = remaining;
      if (budgetTotalEl)     budgetTotalEl.textContent     = budget;

      beastQueueSection.querySelectorAll(".mdc-beast-pick-btn").forEach(btn => {
        const cost = parseInt(btn.dataset.cost, 10) || 1;
        btn.disabled = remaining < cost;
        btn.classList.toggle("is-disabled", remaining < cost);
        btn.classList.toggle("is-ready",    remaining >= cost);
      });

      if (confirmBtn) {
        const ok = spent > 0 && remaining >= 0;
        confirmBtn.disabled = !ok;
        confirmBtn.classList.toggle("is-disabled", !ok);
        confirmBtn.classList.toggle("is-ready",    ok);
      }
    };

    if (beastQueueSection) {
      beastQueueSection.querySelectorAll(".mdc-beast-pick-btn").forEach(pickBtn => {
        pickBtn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const id   = pickBtn.dataset.actionId;
          const cost = parseInt(pickBtn.dataset.cost, 10) || 1;
          const budget  = root.querySelectorAll("button.die-chip-mvc.mvc-die-selected").length;
          let spent = 0;
          beastQueueSection.querySelectorAll(".mdc-beast-qty-val").forEach(el => {
            spent += (parseInt(el.textContent, 10) || 0) * (parseInt(el.closest(".mdc-beast-action-entry")?.dataset.cost, 10) || 1);
          });
          if (spent + cost > budget) return;
          const qtyEl   = beastQueueSection.querySelector(`.mdc-beast-qty-val[data-action-id="${id}"]`);
          const badgeEl = beastQueueSection.querySelector(`.mdc-beast-qty-badge[data-action-id="${id}"]`);
          if (!qtyEl) return;
          qtyEl.textContent = (parseInt(qtyEl.textContent, 10) || 0) + 1;
          if (badgeEl) badgeEl.style.display = "";
          updateBeastQueue();
        });
      });

      beastQueueSection.querySelectorAll(".mdc-beast-undo-btn").forEach(undoBtn => {
        undoBtn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const id      = undoBtn.dataset.actionId;
          const qtyEl   = beastQueueSection.querySelector(`.mdc-beast-qty-val[data-action-id="${id}"]`);
          const badgeEl = beastQueueSection.querySelector(`.mdc-beast-qty-badge[data-action-id="${id}"]`);
          if (!qtyEl) return;
          const cur = parseInt(qtyEl.textContent, 10) || 0;
          if (cur > 0) qtyEl.textContent = cur - 1;
          if (badgeEl && parseInt(qtyEl.textContent, 10) === 0) badgeEl.style.display = "none";
          updateBeastQueue();
        });
      });

      const confirmBtn = beastQueueSection.querySelector(".mdc-beast-confirm-btn");
      if (confirmBtn) {
        confirmBtn.addEventListener("click", async e => {
          e.preventDefault();
          e.stopPropagation();
          if (confirmBtn.disabled) return;
          const pool    = confirmBtn.dataset.pool;
          const selected = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
          const indices  = selected.map(c => parseInt(c.dataset.dieIdx, 10)).filter(n => !isNaN(n));
          const beastQueue = [];
          beastQueueSection.querySelectorAll(".mdc-beast-qty-val").forEach(el => {
            const qty = parseInt(el.textContent, 10) || 0;
            const actionId = el.dataset.actionId;
            if (qty > 0 && actionId) {
              for (let i = 0; i < qty; i++) beastQueue.push(actionId);
            }
          });
          if (game.user.isGM) {
            await MeleeOpposedChat.applyDuelBatch(message.id, pool, indices, "attack", beastQueue.length ? beastQueue : null);
          } else if (game.neuroshima?.socket) {
            await game.neuroshima.socket.executeAsGM("applyDuelBatch", message.id, pool, indices, "attack", beastQueue.length ? beastQueue : null);
          }
        });
      }
    }

    // getMeleeActions trick queue — sekcja dla sztuczek gracza z successCost > 0.
    // Budżet = liczba sukcesów wśród zaznaczonych kości (klasa is-success).
    // Gracz wybiera ile razy użyć danej sztuczki; przy zatwierdzeniu "Attack"
    // kolejka jest kodowana jako "trick:ID:damage" i przekazywana do applyDuelBatch.
    const trickQueueSection = root.querySelector(".mdc-trick-queue-section");

    const updateTrickQueue = () => {
      if (!trickQueueSection) return;
      const selectedChips    = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
      const successBudget    = selectedChips.filter(c => c.classList.contains("is-success")).length;

      let spent = 0;
      trickQueueSection.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
        const qty  = parseInt(el.textContent, 10) || 0;
        const cost = parseInt(
          el.closest(".mdc-trick-action-entry")?.dataset.cost ?? "1", 10
        ) || 1;
        spent += qty * cost;
      });

      const remaining = successBudget - spent;
      const remainingEl = trickQueueSection.querySelector(".mdc-trick-budget-remaining");
      const totalEl     = trickQueueSection.querySelector(".mdc-trick-budget-total");
      if (remainingEl) remainingEl.textContent = remaining;
      if (totalEl)     totalEl.textContent     = successBudget;

      trickQueueSection.querySelectorAll(".mdc-trick-pick-btn").forEach(btn => {
        const cost = parseInt(btn.dataset.cost, 10) || 1;
        btn.disabled = remaining < cost;
        btn.classList.toggle("is-disabled", remaining < cost);
        btn.classList.toggle("is-ready",    remaining >= cost);
      });
    };

    if (trickQueueSection) {
      trickQueueSection.querySelectorAll(".mdc-trick-pick-btn").forEach(pickBtn => {
        pickBtn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const id   = pickBtn.dataset.trickId;
          const dmg  = pickBtn.dataset.damage;
          const cost = parseInt(pickBtn.dataset.cost, 10) || 1;

          const selectedChips = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
          const successBudget = selectedChips.filter(c => c.classList.contains("is-success")).length;
          let spent = 0;
          trickQueueSection.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
            spent += (parseInt(el.textContent, 10) || 0) *
                     (parseInt(el.closest(".mdc-trick-action-entry")?.dataset.cost ?? "1", 10) || 1);
          });
          if (spent + cost > successBudget) return;

          const qtyEl   = trickQueueSection.querySelector(`.mdc-trick-qty-val[data-trick-id="${id}"]`);
          const badgeEl = trickQueueSection.querySelector(`.mdc-trick-qty-badge[data-trick-id="${id}"]`);
          if (!qtyEl) return;
          qtyEl.textContent = (parseInt(qtyEl.textContent, 10) || 0) + 1;
          if (badgeEl) badgeEl.style.display = "";
          updateTrickQueue();
        });
      });

      trickQueueSection.querySelectorAll(".mdc-trick-undo-btn").forEach(undoBtn => {
        undoBtn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const id      = undoBtn.dataset.trickId;
          const qtyEl   = trickQueueSection.querySelector(`.mdc-trick-qty-val[data-trick-id="${id}"]`);
          const badgeEl = trickQueueSection.querySelector(`.mdc-trick-qty-badge[data-trick-id="${id}"]`);
          if (!qtyEl) return;
          const cur = parseInt(qtyEl.textContent, 10) || 0;
          if (cur > 0) qtyEl.textContent = cur - 1;
          if (badgeEl && parseInt(qtyEl.textContent, 10) === 0) badgeEl.style.display = "none";
          updateTrickQueue();
        });
      });
    }

    // Dialog modifier checkboxes — explicit click handler because Foundry chat messages
    // may not properly propagate native label/checkbox interactions.
    // Clicking the entry label toggles the checkbox and updates the visual state.
    root.querySelectorAll(".mdc-dialog-mod-entry").forEach(entry => {
      entry.addEventListener("click", e => {
        e.stopPropagation();
        const cb = entry.querySelector(".mdc-dialog-mod-check");
        if (!cb) return;
        if (e.target === cb) return;
        cb.checked = !cb.checked;
      });
    });

    // Trick queue confirm button — works like beast confirm button:
    // collects selected dice + trick queue items and submits as "attack" action.
    // Allows mixing tricks with normal attack (all selected dice go to attack comparison,
    // tricks are additional effects resolved on top based on success budget).
    const trickConfirmBtn = root.querySelector(".mdc-trick-confirm-btn");
    if (trickConfirmBtn && trickQueueSection) {
      trickConfirmBtn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        if (trickConfirmBtn.disabled) return;
        const pool    = trickConfirmBtn.dataset.pool;
        const selected = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
        const indices  = selected.map(c => parseInt(c.dataset.dieIdx, 10)).filter(n => !isNaN(n));
        const trickItems = [];
        trickQueueSection.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
          const qty = parseInt(el.textContent, 10) || 0;
          const id  = el.dataset.trickId;
          const dmg = el.dataset.trickDamage;
          if (qty > 0 && id && dmg) {
            for (let i = 0; i < qty; i++) trickItems.push(`trick:${id}:${dmg}`);
          }
        });
        if (game.user.isGM) {
          await MeleeOpposedChat.applyDuelBatch(message.id, pool, indices, "attack", trickItems.length ? trickItems : null);
        } else if (game.neuroshima?.socket) {
          await game.neuroshima.socket.executeAsGM("applyDuelBatch", message.id, pool, indices, "attack", trickItems.length ? trickItems : null);
        }
      });
    }

    updateActionButtons();
    updateBeastQueue();
    updateTrickQueue();

    // Trick confirm button state — enabled when dice are selected (like beast confirm).
    const updateTrickConfirm = () => {
      if (!trickConfirmBtn) return;
      const selectedCount = root.querySelectorAll("button.die-chip-mvc.mvc-die-selected").length;
      let spent = 0;
      if (trickQueueSection) {
        trickQueueSection.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
          spent += parseInt(el.textContent, 10) || 0;
        });
      }
      const ok = selectedCount >= 1;
      trickConfirmBtn.disabled = !ok;
      trickConfirmBtn.classList.toggle("is-disabled", !ok);
      trickConfirmBtn.classList.toggle("is-ready", ok);
    };
    updateTrickConfirm();

    // Re-run after die chip clicks.
    root.querySelectorAll("button.die-chip-mvc").forEach(chip => {
      chip.addEventListener("click", updateTrickConfirm);
    });
    if (trickQueueSection) {
      trickQueueSection.querySelectorAll(".mdc-trick-pick-btn, .mdc-trick-undo-btn").forEach(b => {
        b.addEventListener("click", updateTrickConfirm);
      });
    }
  }

  static async applyDuelBatch(messageId, pool, diceIndices, action = null, beastQueue = null) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const state = foundry.utils.deepClone(message.getFlag("neuroshima", "duelCard"));
    if (!state || state.status !== "picking") return;

    const isOwnerAttacker = state.initiativeOwnerSide === "attacker";
    const ownerPool       = isOwnerAttacker ? "attacker" : "defender";
    const responderPool   = isOwnerAttacker ? "defender" : "attacker";

    if (state.waitingFor === "initiativeOwner") {
      if (pool !== ownerPool) return;

      // Segment history — save a snapshot of the full state BEFORE this segment begins.
      // Strips segmentHistory/segmentFuture from the snapshot to avoid recursive nesting.
      // Used by undoDuelSegment / redoDuelSegment so the GM can roll back mistakes.
      const snapshot = foundry.utils.deepClone(state);
      delete snapshot.segmentHistory;
      delete snapshot.segmentFuture;
      if (!state.segmentHistory) state.segmentHistory = [];
      state.segmentHistory.push(snapshot);
      state.segmentFuture = [];  // clear redo stack when a new action is taken

      const rawAction      = action || "attack";
      const ownerDicePool  = isOwnerAttacker ? state.attackDice : state.defenseDice;

      // Sztuczki gracza mają format "trick:ID:damage" (np. "trick:barbarka-head-butt:sC").
      // Traktujemy je jak atak — porównanie sukcesów — ale przy trafieniu używamy
      // damage z sztuczki zamiast damage${N} z uzbrojenia.
      const isTrick = rawAction.startsWith("trick:");
      let declaredAction = rawAction;
      let committedTrickId     = null;
      let committedTrickDamage = null;
      if (isTrick) {
        const parts = rawAction.split(":");
        committedTrickId     = parts[1] ?? null;
        committedTrickDamage = parts[2] ?? null;
        declaredAction = "trick";
      }

      if (declaredAction === "exit") {
        if (diceIndices.length !== 1) return;
      } else if (declaredAction === "nonCombat") {
        if (!diceIndices.length || diceIndices.length > 3) return;
        const hasSuccess = diceIndices.some(i => ownerDicePool[i]?.isSuccess);
        if (!hasSuccess) {
          ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelNonCombatNeedSuccess"));
          return;
        }
      } else {
        // attack, trick — wymagają co najmniej 1, max 3 kości
        if (!diceIndices.length || diceIndices.length > 3) return;
      }
      state.declaredAction        = declaredAction;
      state.committedOwnerIndices = diceIndices;
      // Rozdziel beastQueue na akcje bestii i sztuczki gracza (trick: prefix).
      // Sztuczki z successCost wrzucane są przez UI jako "trick:ID:damage" w tym samym parametrze.
      const rawBeastItems = Array.isArray(beastQueue) ? beastQueue.filter(id => !id.startsWith("trick:")) : [];
      const rawTrickItems = Array.isArray(beastQueue) ? beastQueue.filter(id =>  id.startsWith("trick:")) : [];
      state.committedBeastQueue  = rawBeastItems.length  > 0 ? rawBeastItems  : null;
      state.committedTrickQueue  = rawTrickItems.length  > 0 ? rawTrickItems  : null;
      // Zapisz metadane sztuczki — używane przy rozstrzygnięciu w fazie responder
      state.committedTrickId     = committedTrickId;
      state.committedTrickDamage = committedTrickDamage;
      state.waitingFor            = "responder";
      await MeleeOpposedChat._renderDuelCard(message, state);
      return;
    }

    if (state.waitingFor === "responder") {
      const declaredAction  = state.declaredAction || "attack";
      const responderAction = action || (
        declaredAction === "exit"      ? "blockExit" :
        declaredAction === "nonCombat" ? "interrupt" : "defend"
      );

      const ownerDice     = isOwnerAttacker ? state.attackDice  : state.defenseDice;
      const responderDice = isOwnerAttacker ? state.defenseDice : state.attackDice;
      const ownerIndices  = state.committedOwnerIndices || [];
      const N             = ownerIndices.length;

      let outcome;
      let segAttackVal  = 0;
      let segDefenseVal = 0;

      // ── attack / flee ──────────────────────────────────────────────────
      if (declaredAction === "attack" && responderAction === "flee") {
        const escapeeUuid = isOwnerAttacker ? state.defenderUuid : state.attackerUuid;
        state.hits.push({ tier: 1, damageType: state.damage1 ?? "d", isBackHit: true, escapeeUuid });
        state._escapeeUuid = escapeeUuid;
        if (isOwnerAttacker) {
          state.usedAttackDice = [...(state.usedAttackDice || []), ...ownerIndices];
        } else {
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
        }
        outcome = "flee";

      // ── exit / allowExit ───────────────────────────────────────────────
      } else if (declaredAction === "exit" && responderAction === "allowExit") {
        if (isOwnerAttacker) {
          state.usedAttackDice = [...(state.usedAttackDice || []), ...ownerIndices];
        } else {
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
        }
        outcome = "exit";

      // ── nonCombat / seizeInit ──────────────────────────────────────────
      } else if (declaredAction === "nonCombat" && responderAction === "seizeInit") {
        if (pool !== responderPool) return;
        if (diceIndices.length !== N) return;
        state.initiativeOwnerSide = isOwnerAttacker ? "defender" : "attacker";
        if (isOwnerAttacker) {
          state.usedAttackDice  = [...(state.usedAttackDice  || []), ...ownerIndices];
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...diceIndices];
        } else {
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
          state.usedAttackDice  = [...(state.usedAttackDice  || []), ...diceIndices];
        }
        outcome = "seizeInit";

      // ── default dice comparison ────────────────────────────────────────
      } else {
        if (pool !== responderPool) return;

        if (declaredAction === "exit") {
          if (diceIndices.length !== 1) return;
        } else if (declaredAction === "nonCombat") {
          if (!diceIndices.length) return;
        } else {
          if (diceIndices.length !== N) return;
        }

        const ownerSuccessCount    = ownerIndices.filter(i => ownerDice[i]?.isSuccess).length;
        const responderSuccessCount = diceIndices.filter(i => responderDice[i]?.isSuccess).length;
        const ownerHasSuccess     = ownerSuccessCount > 0;
        const responderHasSuccess  = responderSuccessCount > 0;

        // preOpposedAttacker — fire for the owner (attacking) side before segment resolution.
        // Allows scripts (e.g. Boa – Pochwycenie) to react when this actor is about to attack.
        {
          const _paUuid  = isOwnerAttacker
            ? (state.attackerTokenUuid || state.attackerUuid)
            : (state.defenderTokenUuid || state.defenderUuid);
          const _paDoc   = fromUuidSync(_paUuid);
          const _paActor = _paDoc?.actor ?? _paDoc;
          if (_paActor) {
            await NeuroshimaScriptRunner.execute("preOpposedAttacker", {
              actor: _paActor, encounter: null, participant: null,
              difficultyTarget: 0, mode: "attack"
            });
          }
        }

        if (declaredAction === "attack" || declaredAction === "trick") {
          if (responderAction === "attack") {
            // ── BERSERKER: obaj atakują ───────────────────────────────────
            // Atakujący zadaje obrażenia jeśli ma sukcesy.
            // Odpowiadający (berserker) kontr-atakuje — też może trafić niezależnie.
            const hitDmgType = declaredAction === "trick" && state.committedTrickDamage
              ? state.committedTrickDamage
              : (state[`damage${N}`] ?? "?");

            if (ownerSuccessCount > 0) {
              const hitEntry = { tier: N, damageType: hitDmgType };
              if (declaredAction === "trick" && state.committedTrickId) {
                hitEntry.trickId = state.committedTrickId;
              }
              state.hits.push(hitEntry);
              if (hitEntry.trickId) await MeleeOpposedChat._fireImmediateOnHitScript(state, hitEntry, isOwnerAttacker);
            }

            if (responderSuccessCount > 0) {
              state.counterHits = state.counterHits ?? [];
              state.counterHits.push({ tier: N, damageType: state[`defenderDamage${N}`] ?? "D" });
            }

            if      (ownerSuccessCount > responderSuccessCount)  outcome = "hit";
            else if (ownerSuccessCount < responderSuccessCount)  outcome = "takeover";
            else if (ownerSuccessCount > 0)                      outcome = "draw";
            else                                                  outcome = "nothing";

            segAttackVal  = isOwnerAttacker ? ownerSuccessCount    : responderSuccessCount;
            segDefenseVal = isOwnerAttacker ? responderSuccessCount : ownerSuccessCount;

            if (outcome === "takeover") state.initiativeOwnerSide = isOwnerAttacker ? "defender" : "attacker";
            state.committedTrickId     = null;
            state.committedTrickDamage = null;

            // opposedAttacker — fire for the owner (attacking) side after BERSERKER segment.
            {
              const _oaUuid  = isOwnerAttacker
                ? (state.attackerTokenUuid || state.attackerUuid)
                : (state.defenderTokenUuid || state.defenderUuid);
              const _oaDoc   = fromUuidSync(_oaUuid);
              const _oaActor = _oaDoc?.actor ?? _oaDoc;
              if (_oaActor) {
                const _oaResultType  = outcome === "hit" ? "hit" : outcome === "takeover" ? "takeover" : "block";
                const _ownerManeuver = isOwnerAttacker ? (state.attackerManeuver ?? null) : (state.defenderManeuver ?? null);
                await NeuroshimaScriptRunner.execute("opposedAttacker", {
                  actor: _oaActor,
                  resultType: _oaResultType,
                  diceCount: N,
                  encounter: null,
                  attacker: { maneuver: _ownerManeuver },
                  defender: {},
                  attackerId: isOwnerAttacker ? state.attackerUuid : state.defenderUuid,
                  defenderId: isOwnerAttacker ? state.defenderUuid : state.attackerUuid,
                  attackerSuccesses: ownerSuccessCount,
                  defenderSuccesses: responderSuccessCount,
                  blockDamageShift: 0
                });
              }
            }

          } else {
            // ── Normalna obrona ───────────────────────────────────────────
            if      (ownerSuccessCount > responderSuccessCount)  outcome = "hit";
            else if (ownerSuccessCount < responderSuccessCount)  outcome = "takeover";
            else if (ownerSuccessCount > 0)                      outcome = "draw";
            else                                                  outcome = "nothing";

            if (outcome === "hit") {
              // Sztuczki gracza mają własny, stały typ obrażeń niezależny od uzbrojenia.
              // Dla zwykłego ataku używamy damage${N} z profilu broni.
              const hitDmgType = declaredAction === "trick" && state.committedTrickDamage
                ? state.committedTrickDamage
                : (state[`damage${N}`] ?? "?");
              const hitEntry = { tier: N, damageType: hitDmgType };
              if (declaredAction === "trick" && state.committedTrickId) {
                hitEntry.trickId = state.committedTrickId;
              }
              state.hits.push(hitEntry);
              if (hitEntry.trickId) await MeleeOpposedChat._fireImmediateOnHitScript(state, hitEntry, isOwnerAttacker);
            }

            segAttackVal  = isOwnerAttacker ? ownerSuccessCount    : responderSuccessCount;
            segDefenseVal = isOwnerAttacker ? responderSuccessCount : ownerSuccessCount;

            if (outcome === "takeover") state.initiativeOwnerSide = isOwnerAttacker ? "defender" : "attacker";
            // Wyczyść metadane sztuczki po rozstrzygnięciu segmentu
            state.committedTrickId     = null;
            state.committedTrickDamage = null;

            // opposedDefender — fire for the defending side after each normal-defense segment.
            // Scripts on the defender's applied effects (e.g. Garda – Aktywna) can react to
            // the result and self-delete or set blockDamageShift.
            const _oppDefUuid  = isOwnerAttacker
              ? (state.defenderTokenUuid || state.defenderUuid)
              : (state.attackerTokenUuid || state.attackerUuid);
            const _oppDefDoc   = fromUuidSync(_oppDefUuid);
            const _oppDefActor = _oppDefDoc?.actor ?? _oppDefDoc;
            if (_oppDefActor) {
              const _oppResultType = outcome === "hit" ? "hit" : outcome === "takeover" ? "takeover" : "block";
              const _defObj = { blockDamageShift: 0 };
              const _oppArgs = {
                actor: _oppDefActor,
                resultType: _oppResultType,
                diceCount: N,
                encounter: null,
                attacker: {},
                defender: _defObj,
                participant: _defObj,
                attackerSuccesses: ownerSuccessCount,
                defenderSuccesses: responderSuccessCount,
                blockDamageShift: 0
              };
              await NeuroshimaScriptRunner.execute("opposedDefender", _oppArgs);
              const _bds = (_oppArgs.defender.blockDamageShift || 0) + (_oppArgs.blockDamageShift || 0);
              if (_bds !== 0) {
                if (!state.blockDamageShiftByActor) state.blockDamageShiftByActor = {};
                state.blockDamageShiftByActor[_oppDefUuid] = _bds;
              }
              const _effectiveShift = _bds || (state.blockDamageShiftByActor?.[_oppDefUuid] || 0);
              if (_effectiveShift !== 0 && outcome === "draw" && ownerSuccessCount > 0) {
                const _baseDmg    = state[`damage${N}`] ?? "D";
                const _shiftedDmg = MeleeResolution._shiftDamageTypeUnclamped(_baseDmg, _effectiveShift);
                if (_shiftedDmg) state.hits.push({ tier: N, damageType: _shiftedDmg, isBlockDamage: true });
              }
            }

            // opposedAttacker — fire for the owner (attacking) side after each normal-defense segment.
            {
              const _oaUuid  = isOwnerAttacker
                ? (state.attackerTokenUuid || state.attackerUuid)
                : (state.defenderTokenUuid || state.defenderUuid);
              const _oaDoc   = fromUuidSync(_oaUuid);
              const _oaActor = _oaDoc?.actor ?? _oaDoc;
              if (_oaActor) {
                const _oaResultType  = outcome === "hit" ? "hit" : outcome === "takeover" ? "takeover" : "block";
                const _ownerManeuver = isOwnerAttacker ? (state.attackerManeuver ?? null) : (state.defenderManeuver ?? null);
                await NeuroshimaScriptRunner.execute("opposedAttacker", {
                  actor: _oaActor,
                  resultType: _oaResultType,
                  diceCount: N,
                  encounter: null,
                  attacker: { maneuver: _ownerManeuver },
                  defender: {},
                  attackerId: isOwnerAttacker ? state.attackerUuid : state.defenderUuid,
                  defenderId: isOwnerAttacker ? state.defenderUuid : state.attackerUuid,
                  attackerSuccesses: ownerSuccessCount,
                  defenderSuccesses: responderSuccessCount,
                  blockDamageShift: 0
                });
              }
            }
          }

        } else if (declaredAction === "exit") {
          outcome = (ownerHasSuccess && !responderHasSuccess) ? "exit" : "blocked";

        } else {
          const ownerSuccesses     = ownerIndices.filter(i => ownerDice[i]?.isSuccess).length;
          const responderSuccesses = diceIndices.filter(i => responderDice[i]?.isSuccess).length;
          outcome = responderSuccesses >= ownerSuccesses ? "interrupted" : "nonCombat";
        }

        if (isOwnerAttacker) {
          state.usedAttackDice  = [...(state.usedAttackDice  || []), ...ownerIndices];
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...diceIndices];
        } else {
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
          state.usedAttackDice  = [...(state.usedAttackDice  || []), ...diceIndices];
        }
      }

      const seg = state.segments[state.currentSegment];
      seg.attackVal  = segAttackVal;
      seg.defenseVal = segDefenseVal;
      seg.outcome    = outcome;
      seg.tier       = N;

      for (let i = state.currentSegment + 1; i < state.currentSegment + N; i++) {
        if (i < state.segments.length) {
          state.segments[i].outcome = "spent";
          state.segments[i].tier    = 0;
        }
      }

      state.committedOwnerIndices = null;
      state.declaredAction        = null;

      // Akumuluj sztuczki z kolejki (successCost) — są niezależne od wyniku porównania kości.
      // Sztuczki w queue są "opłacone" sukcesami gracza z góry, więc zawsze się aplikują.
      if (state.committedTrickQueue?.length > 0) {
        state.allTrickQueue = [...(state.allTrickQueue || []), ...state.committedTrickQueue];
        state.committedTrickQueue = null;
      }

      await MeleeOpposedChat._syncInitiativeToTracker(state);

      const endingOutcomes = ["flee", "exit"];
      const isEnded     = endingOutcomes.includes(outcome);
      const nextSegment = state.currentSegment + N;
      const atkLeft     = state.attackDice.length  - (state.usedAttackDice  || []).length;
      const defLeft     = state.defenseDice.length - (state.usedDefenseDice || []).length;
      const hasNext     = !isEnded && nextSegment < state.segments.length && atkLeft > 0 && defLeft > 0;

      if (hasNext) {
        state.currentSegment = nextSegment;
        state.waitingFor = "initiativeOwner";
      } else {
        state.status     = "done";
        state.waitingFor = null;
      }

      if (state.status === "done") {
        const locationRoll = (state.attackDice[0]?.original) ?? 10;
        const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);

        const atkDoc = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
        const atkActor = atkDoc?.actor ?? atkDoc;
        const isCreatureAttacker = atkActor?.type === "creature";
        const isBeastAttack = isCreatureAttacker && !state.weaponId;
        const netSuccesses = state.hits.length;

        const affordableBeastActions = [];
        if (isBeastAttack && netSuccesses > 0 && atkActor) {
          const beastItemFilter = state.beastItemId ?? null;
          for (const item of atkActor.items.filter(i => i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter))) {
            for (const act of (item.system.activities ?? [])) {
              if (act.costType !== "success") continue;
              const cost = act.successCost ?? 1;
              if (cost <= netSuccesses) {
                affordableBeastActions.push({
                  id: `${item.id}::${act.id}`,
                  itemId: item.id,
                  name: act.name || item.name,
                  img: act.img || item.img,
                  cost,
                  damage: act.damage || null,
                  gmNote: act.gmNote || "",
                  hasEffects: (act.effectIds?.length ?? 0) > 0
                });
              }
            }
          }
          affordableBeastActions.sort((a, b) => a.cost - b.cost);
        }

        await message.setFlag("neuroshima", "opposedResult", {
          attackerUuid: state.attackerUuid,
          defenderUuid: state.defenderUuid,
          weaponId: state.weaponId,
          beastItemId: state.beastItemId ?? null,
          hits: state.hits,
          location,
          escapeeUuid: state._escapeeUuid ?? null,
          damage1: state.damage1,
          damage2: state.damage2,
          damage3: state.damage3,
          netSuccesses,
          affordableBeastActions,
          isBeastAttack,
          pendingBeastQueue: state.committedBeastQueue ?? null,
          // Sztuczki gracza z kolejki (successCost) — aplikowane razem z normalnymi obrażeniami
          pendingTrickQueue: state.allTrickQueue?.length > 0 ? state.allTrickQueue : null,
          // counterHits: trafienia kontr-ataku berserkera (obrażenia zadane atakującemu)
          counterHits: state.counterHits?.length > 0 ? state.counterHits : null,
          trickOnHitScripts: state.trickOnHitScripts ?? null,
          applied: false,
          beastActionsApplied: false
        });
      }

      await MeleeOpposedChat._renderDuelCard(message, state);

      // MANEUVER — Trash collector (duel card resolved):
      // Clear maneuver conditions from both combatants only after all dice have been
      // spent on the card (state.status === "done").  Conditions must remain active
      // during the exchange so resolution code (pełna obrona 2-success threshold,
      // furia auto-hit, etc.) can still read them on subsequent segments.
      if (state.status === "done") {
        const atkDoc = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
        const defDoc = fromUuidSync(state.defenderTokenUuid || state.defenderUuid);
        await MeleeTurnService._clearManeuverConditions(atkDoc?.actor ?? atkDoc);
        await MeleeTurnService._clearManeuverConditions(defDoc?.actor ?? defDoc);
        game.neuroshima?.log("[melee-opposed-chat.applyDuelBatch] maneuver conditions cleared after done", {
          attacker: state.attackerTokenUuid || state.attackerUuid,
          defender: state.defenderTokenUuid || state.defenderUuid
        });
        for (const doc of [atkDoc, defDoc]) {
          const actor = doc?.actor ?? doc;
          if (!actor) continue;
          await NeuroshimaScriptRunner.execute("meleeUpdate", {
            actor, phase: "turn-end",
            encounter: null, encounterId: null,
            participant: null, participantId: null
          });
        }
      }
    }
  }

  static async applyDuelPick(messageId, side, dieIdx) {
    await MeleeOpposedChat.applyDuelBatch(messageId, side, [dieIdx]);
  }

  static async swapDuelInitiative(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const state = foundry.utils.deepClone(message.getFlag("neuroshima", "duelCard"));
    if (!state || state.status !== "picking") return;
    if (state.isGradCios) return;

    state.initiativeOwnerSide = state.initiativeOwnerSide === "attacker" ? "defender" : "attacker";
    state.committedOwnerIndices = null;
    state.waitingFor = "initiativeOwner";

    await MeleeOpposedChat._syncInitiativeToTracker(state);
    await MeleeOpposedChat._renderDuelCard(message, state);
  }

  /**
   * Undo the last segment decision and restore the duel to the state
   * it was in before that segment's initiativeOwner pick.
   * Only available to the GM. Works like CTRL+Z — the undone state
   * goes onto the redo stack so it can be restored with redoDuelSegment.
   */
  static async undoDuelSegment(messageId) {
    if (!game.user.isGM) return;
    const message = game.messages.get(messageId);
    if (!message) return;

    const state = foundry.utils.deepClone(message.getFlag("neuroshima", "duelCard"));
    if (!state?.segmentHistory?.length) return;

    // Current state stripped of history/future → goes to redo stack
    const current = foundry.utils.deepClone(state);
    delete current.segmentHistory;
    delete current.segmentFuture;

    const prev = state.segmentHistory[state.segmentHistory.length - 1];
    prev.segmentHistory = state.segmentHistory.slice(0, -1);
    prev.segmentFuture  = [current, ...(state.segmentFuture || [])];

    game.neuroshima?.log("[melee-opposed-chat] undoDuelSegment", {
      historyLength: prev.segmentHistory.length,
      futureLength:  prev.segmentFuture.length
    });
    await MeleeOpposedChat._renderDuelCard(message, prev);
  }

  /**
   * Redo a previously undone segment decision.
   * Works like CTRL+Y — restores the most recently undone state.
   */
  static async redoDuelSegment(messageId) {
    if (!game.user.isGM) return;
    const message = game.messages.get(messageId);
    if (!message) return;

    const state = foundry.utils.deepClone(message.getFlag("neuroshima", "duelCard"));
    if (!state?.segmentFuture?.length) return;

    const current = foundry.utils.deepClone(state);
    delete current.segmentHistory;
    delete current.segmentFuture;

    const next = state.segmentFuture[0];
    next.segmentHistory = [...(state.segmentHistory || []), current];
    next.segmentFuture  = state.segmentFuture.slice(1);

    game.neuroshima?.log("[melee-opposed-chat] redoDuelSegment", {
      historyLength: next.segmentHistory.length,
      futureLength:  next.segmentFuture.length
    });
    await MeleeOpposedChat._renderDuelCard(message, next);
  }

  static async _syncInitiativeToTracker(state) {
    if (!game.combat) return;
    const groups = foundry.utils.deepClone(game.combat.getFlag("neuroshima", "meleeGroups") || []);
    const atkUuid = state.attackerUuid;
    const defUuid = state.defenderUuid;
    const groupIdx = groups.findIndex(g =>
      (g.fighters || []).some(f => f.uuid === atkUuid) &&
      (g.fighters || []).some(f => f.uuid === defUuid)
    );
    if (groupIdx === -1) return;
    const newOwnerUuid = state.initiativeOwnerSide === "attacker" ? atkUuid : defUuid;
    if (groups[groupIdx].initiativeOwnerId === newOwnerUuid) return;
    groups[groupIdx].initiativeOwnerId = newOwnerUuid;
    await game.combat.setFlag("neuroshima", "meleeGroups", groups);
  }

  /**
   * Create the skill-allocation card when doubleSkillAction is ON and either side has a budget.
   * @private
   */
  static async _createAllocationCard({ data, attackerActor, defenderActor,
      attackDice, defenseDice, attackTarget, defenseTarget,
      attackSuccesses, defenseSuccesses, attackerSkillBudget, defenderSkillBudget }) {
    const allocData = {
      status: "pending",
      mode: data.mode,
      attackerUuid: data.attackerUuid,
      defenderUuid: data.defenderUuid,
      weaponId: data.weaponId,
      beastItemId: data.beastItemId ?? null,
      attackDice,
      defenseDice,
      attackTarget,
      defenseTarget,
      attackSuccesses,
      defenseSuccesses,
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      attackerSkillBudget,
      defenderSkillBudget,
      attackerSelfReductions: [0, 0, 0],
      attackerOpponentGains: [0, 0, 0],
      defenderSelfReductions: [0, 0, 0],
      defenderOpponentGains: [0, 0, 0],
      attackerConfirmed: false,
      defenderConfirmed: false
    };

    const context = MeleeOpposedChat._buildAllocationContext(allocData, attackerActor, defenderActor);
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-skill-allocation.hbs",
      context
    );

    const rollMode = game.settings.get("core", "rollMode");
    await ChatMessage.create({
      content,
      flags: { neuroshima: { skillAlloc: allocData } },
      speaker: { alias: "⚔" },
      rollMode
    });
  }

  /**
   * Build context for the skill-allocation template from stored allocData.
   * @private
   */
  static _buildAllocationContext(allocData, attackerActor, defenderActor) {
    const {
      attackDice, defenseDice,
      attackerSelfReductions, attackerOpponentGains,
      defenderSelfReductions, defenderOpponentGains,
      attackerSkillBudget, defenderSkillBudget,
      attackTarget, defenseTarget,
      attackerConfirmed, defenderConfirmed
    } = allocData;

    const attackerBudgetUsed = (attackerSelfReductions || []).reduce((a, b) => a + b, 0)
      + (attackerOpponentGains || []).reduce((a, b) => a + b, 0);
    const defenderBudgetUsed = (defenderSelfReductions || []).reduce((a, b) => a + b, 0)
      + (defenderOpponentGains || []).reduce((a, b) => a + b, 0);
    const attackerBudgetRemaining = (attackerSkillBudget || 0) - attackerBudgetUsed;
    const defenderBudgetRemaining = (defenderSkillBudget || 0) - defenderBudgetUsed;

    const pairedDice = Array.from({ length: 3 }, (_, i) => {
      const aDie = (attackDice || [])[i] ?? null;
      const dDie = (defenseDice || [])[i] ?? null;

      const atkSelf = (attackerSelfReductions || [])[i] || 0;
      const atkOpp  = (attackerOpponentGains  || [])[i] || 0;
      const defSelf = (defenderSelfReductions || [])[i] || 0;
      const defOpp  = (defenderOpponentGains  || [])[i] || 0;

      const rawAtkVal = aDie?.modified ?? aDie?.original ?? null;
      const rawDefVal = dDie?.modified ?? dDie?.original ?? null;

      const effAtkVal = rawAtkVal !== null ? Math.min(20, Math.max(1, rawAtkVal - atkSelf + defOpp)) : null;
      const effDefVal = rawDefVal !== null ? Math.min(20, Math.max(1, rawDefVal - defSelf + atkOpp)) : null;

      const effectiveAttack = effAtkVal !== null ? {
        value: effAtkVal,
        isSuccess: effAtkVal <= (attackTarget || 0) && effAtkVal !== 20,
        isNat1: effAtkVal === 1,
        isNat20: effAtkVal === 20
      } : null;

      const effectiveDefense = effDefVal !== null ? {
        value: effDefVal,
        isSuccess: effDefVal <= (defenseTarget || 0) && effDefVal !== 20,
        isNat1: effDefVal === 1,
        isNat20: effDefVal === 20
      } : null;

      const attackDelta = (effAtkVal !== null && rawAtkVal !== null) ? effAtkVal - rawAtkVal : 0;
      const defenseDelta = (effDefVal !== null && rawDefVal !== null) ? effDefVal - rawDefVal : 0;

      const attackCanSelfSpend = !!aDie && !attackerConfirmed && attackerBudgetRemaining > 0 && (effAtkVal ?? 0) > 1 && (aDie?.original ?? rawAtkVal) !== 20;
      const defenderCanSelfSpend = !!dDie && !defenderConfirmed && defenderBudgetRemaining > 0 && (effDefVal ?? 0) > 1 && (dDie?.original ?? rawDefVal) !== 20;
      const attackerCanOpponentSpend = !!dDie && !attackerConfirmed && attackerBudgetRemaining > 0 && (effDefVal ?? 20) < 20;
      const defenderCanOpponentSpend = !!aDie && !defenderConfirmed && defenderBudgetRemaining > 0 && (effAtkVal ?? 20) < 20;

      return {
        label: `D${i + 1}`,
        effectiveAttack,
        effectiveDefense,
        attackModified: attackDelta !== 0,
        defenseModified: defenseDelta !== 0,
        attackDeltaDisplay: attackDelta > 0 ? `+${attackDelta}` : `${attackDelta}`,
        defenseDeltaDisplay: defenseDelta > 0 ? `+${defenseDelta}` : `${defenseDelta}`,
        attackCanSelfSpend,
        defenderCanSelfSpend,
        attackerCanOpponentSpend,
        defenderCanOpponentSpend,
        attackSelfAlloc: atkSelf > 0,
        defSelfAlloc: defSelf > 0,
        atkOppAllocDefense: atkOpp > 0,
        defOppAllocAttack: defOpp > 0
      };
    });

    return {
      mode: allocData.mode,
      modeLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${allocData.mode}`),
      attackerName: attackerActor?.name ?? allocData.attackerUuid,
      attackerImg: attackerActor?.img,
      defenderName: defenderActor?.name ?? allocData.defenderUuid,
      defenderImg: defenderActor?.img,
      attackerBudgetRemaining,
      defenderBudgetRemaining,
      attackerConfirmed,
      defenderConfirmed,
      pairedDice
    };
  }

  /**
   * Apply a skill allocation adjustment patch to the allocation card.
   * Called from the socket handler so the GM can safely update the message flag.
   */
  static async applyAllocPatch(messageId, patch) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const allocData = message.getFlag("neuroshima", "skillAlloc");
    if (!allocData || allocData.status !== "pending") return;

    const updated = foundry.utils.deepClone(allocData);

    if (patch.type === "adjust") {
      const { spender, target, dieIndex, delta } = patch;
      const arr = spender === "attacker"
        ? (target === "self" ? updated.attackerSelfReductions : updated.attackerOpponentGains)
        : (target === "self" ? updated.defenderSelfReductions : updated.defenderOpponentGains);

      const attackerBudgetUsed = (updated.attackerSelfReductions || []).reduce((a, b) => a + b, 0)
        + (updated.attackerOpponentGains || []).reduce((a, b) => a + b, 0);
      const defenderBudgetUsed = (updated.defenderSelfReductions || []).reduce((a, b) => a + b, 0)
        + (updated.defenderOpponentGains || []).reduce((a, b) => a + b, 0);
      const attackerRemaining = (updated.attackerSkillBudget || 0) - attackerBudgetUsed;
      const defenderRemaining = (updated.defenderSkillBudget || 0) - defenderBudgetUsed;
      const remaining = spender === "attacker" ? attackerRemaining : defenderRemaining;

      const attackDie = (updated.attackDice || [])[dieIndex];
      const defenseDie = (updated.defenseDice || [])[dieIndex];

      if (delta > 0 && remaining <= 0) return;

      if (spender === "attacker" && target === "self") {
        const atkSelf = arr[dieIndex] || 0;
        const defOpp  = (updated.defenderOpponentGains || [])[dieIndex] || 0;
        const rawVal  = attackDie?.modified ?? attackDie?.original ?? 0;
        const effVal  = rawVal - atkSelf + defOpp;
        if (delta > 0 && (attackDie?.original ?? rawVal) === 20) return;
        if (delta > 0 && effVal <= 1) return;
        if (delta < 0 && atkSelf <= 0) return;
      } else if (spender === "defender" && target === "self") {
        const defSelf = arr[dieIndex] || 0;
        const atkOpp  = (updated.attackerOpponentGains || [])[dieIndex] || 0;
        const rawVal  = defenseDie?.modified ?? defenseDie?.original ?? 0;
        const effVal  = rawVal - defSelf + atkOpp;
        if (delta > 0 && (defenseDie?.original ?? rawVal) === 20) return;
        if (delta > 0 && effVal <= 1) return;
        if (delta < 0 && defSelf <= 0) return;
      } else if (spender === "attacker" && target === "opponent") {
        const atkOpp  = arr[dieIndex] || 0;
        const defSelf = (updated.defenderSelfReductions || [])[dieIndex] || 0;
        const rawVal  = defenseDie?.modified ?? defenseDie?.original ?? 0;
        const effVal  = rawVal - defSelf + atkOpp;
        if (delta > 0 && effVal >= 20) return;
        if (delta < 0 && atkOpp <= 0) return;
      } else if (spender === "defender" && target === "opponent") {
        const defOpp  = arr[dieIndex] || 0;
        const atkSelf = (updated.attackerSelfReductions || [])[dieIndex] || 0;
        const rawVal  = attackDie?.modified ?? attackDie?.original ?? 0;
        const effVal  = rawVal - atkSelf + defOpp;
        if (delta > 0 && effVal >= 20) return;
        if (delta < 0 && defOpp <= 0) return;
      }

      arr[dieIndex] = (arr[dieIndex] || 0) + delta;

    } else if (patch.type === "reset") {
      if (patch.side === "attacker") {
        updated.attackerSelfReductions = [0, 0, 0];
        updated.attackerOpponentGains  = [0, 0, 0];
      } else {
        updated.defenderSelfReductions = [0, 0, 0];
        updated.defenderOpponentGains  = [0, 0, 0];
      }
    } else if (patch.type === "confirm") {
      if (patch.side === "attacker") updated.attackerConfirmed = true;
      else updated.defenderConfirmed = true;
    }

    await message.setFlag("neuroshima", "skillAlloc", updated);

    // Re-render the card HTML
    const attackerDoc = fromUuidSync(updated.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    const defenderDoc = fromUuidSync(updated.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;

    const context = MeleeOpposedChat._buildAllocationContext(updated, attackerActor, defenderActor);
    const newContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-skill-allocation.hbs",
      context
    );
    await message.update({ content: newContent });

    if (updated.attackerConfirmed && updated.defenderConfirmed) {
      await MeleeOpposedChat.resolveFromAllocation(messageId);
    }
  }

  /**
   * Resolve the opposed test from a confirmed allocation card.
   */
  static async resolveFromAllocation(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const allocData = message.getFlag("neuroshima", "skillAlloc");
    if (!allocData || allocData.status !== "pending") return;
    if (!allocData.attackerConfirmed || !allocData.defenderConfirmed) return;

    await message.setFlag("neuroshima", "skillAlloc", { ...allocData, status: "resolved" });

    const attackerDoc = fromUuidSync(allocData.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    const defenderDoc = fromUuidSync(allocData.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;

    const mode = allocData.mode;
    const {
      attackDice, defenseDice,
      attackerSelfReductions, attackerOpponentGains,
      defenderSelfReductions, defenderOpponentGains,
      attackTarget, defenseTarget,
      damage1, damage2, damage3
    } = allocData;

    // Compute effective dice after allocation
    const effectiveAttackDice = (attackDice || []).map((d, i) => {
      if (!d) return null;
      const atkSelf = (attackerSelfReductions || [])[i] || 0;
      const defOpp  = (defenderOpponentGains  || [])[i] || 0;
      const rawVal  = d.modified ?? d.original;
      const effVal  = Math.min(20, Math.max(1, rawVal - atkSelf + defOpp));
      return {
        original: d.original,
        modified: effVal,
        isSuccess: effVal <= (attackTarget || 0) && effVal !== 20,
        isNat1: effVal === 1,
        isNat20: effVal === 20
      };
    }).filter(Boolean);

    const effectiveDefenseDice = (defenseDice || []).map((d, i) => {
      if (!d) return null;
      const defSelf = (defenderSelfReductions || [])[i] || 0;
      const atkOpp  = (attackerOpponentGains  || [])[i] || 0;
      const rawVal  = d.modified ?? d.original;
      const effVal  = Math.min(20, Math.max(1, rawVal - defSelf + atkOpp));
      return {
        original: d.original,
        modified: effVal,
        isSuccess: effVal <= (defenseTarget || 0) && effVal !== 20,
        isNat1: effVal === 1,
        isNat20: effVal === 20
      };
    }).filter(Boolean);

    const attackSuccesses = effectiveAttackDice.filter(d => d.isSuccess).length;
    const defenseSuccesses = effectiveDefenseDice.filter(d => d.isSuccess).length;

    const attackerName = attackerActor?.name ?? "Attacker";
    const defenderName = defenderActor?.name ?? "Defender";

    // Resolution logic (same as resolveOpposed)
    let hits = [];
    let resultType = "block";
    let resultText = "";

    if (mode === "opposedPips") {
      for (let i = 0; i < 3; i++) {
        const aDie = effectiveAttackDice[i];
        const dDie = effectiveDefenseDice[i];
        if (!aDie) continue;
        const aWins = aDie.isSuccess && (!dDie?.isSuccess || aDie.modified < (dDie?.modified ?? Infinity));
        if (aWins) {
          const tier = i + 1;
          hits.push({ tier, damageType: allocData[`damage${tier}`] });
        }
      }
      if (hits.length > 0) {
        resultType = "hit";
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogPipsHit", {
          attacker: attackerName, defender: defenderName,
          tiers: hits.map(h => `D${h.tier}(${h.damageType})`).join(", ")
        });
      } else {
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogBlock", {
          attacker: attackerName, defender: defenderName
        });
      }
    } else {
      const net = attackSuccesses - defenseSuccesses;
      if (net > 0) {
        resultType = "hit";
        const tier = Math.min(3, net);
        hits.push({ tier, damageType: allocData[`damage${tier}`] });
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogSuccessesHit", {
          attacker: attackerName, defender: defenderName,
          net, tier, damage: allocData[`damage${tier}`]
        });
      } else {
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogBlock", {
          attacker: attackerName, defender: defenderName
        });
      }
    }

    const attackDiceDisplay = effectiveAttackDice.map((d, i) => ({
      label: `D${i + 1}`, ...d, isNat1: d.original === 1, isNat20: d.original === 20
    }));
    const defenseDiceDisplay = effectiveDefenseDice.map((d, i) => ({
      label: `D${i + 1}`, ...d, isNat1: d.original === 1, isNat20: d.original === 20
    }));

    const pairWinners = {};
    if (mode === "opposedPips") {
      for (let i = 0; i < 3; i++) {
        const aDie = effectiveAttackDice[i];
        const dDie = effectiveDefenseDice[i];
        const aWins = aDie?.isSuccess && (!dDie?.isSuccess || aDie.modified < (dDie?.modified ?? Infinity));
        const dWins = dDie?.isSuccess && (!aDie?.isSuccess || dDie.modified < (aDie?.modified ?? Infinity));
        pairWinners[i] = { attackWon: aWins ?? false, defenseWon: dWins ?? false };
      }
    }

    const pairedDice = Array.from({ length: 3 }, (_, i) => {
      const aDie = attackDiceDisplay[i] ?? null;
      const dDie = defenseDiceDisplay[i] ?? null;
      const pw = pairWinners[i] ?? {};
      return { label: `D${i + 1}`, attack: aDie, defense: dDie, attackWon: pw.attackWon ?? false, defenseWon: pw.defenseWon ?? false };
    });

    hits.sort((a, b) => a.tier - b.tier);

    const isCreatureAttacker = attackerActor?.type === "creature";
    let netSuccesses = 0;
    if (mode === "opposedSuccesses") {
      netSuccesses = Math.max(0, attackSuccesses - defenseSuccesses);
    } else {
      netSuccesses = hits.length;
    }

    const affordableBeastActions = [];
    if (isCreatureAttacker && netSuccesses > 0) {
      const beastItemFilter = allocData.beastItemId ?? null;
      for (const item of attackerActor.items.filter(i => i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter))) {
        for (const act of (item.system.activities ?? [])) {
          if (act.costType !== "success") continue;
          const cost = act.successCost ?? 1;
          if (cost <= netSuccesses) {
            affordableBeastActions.push({
              id: `${item.id}::${act.id}`,
              itemId: item.id,
              name: act.name || item.name,
              img: act.img || item.img,
              cost,
              damage: act.damage || null,
              gmNote: act.gmNote || "",
              hasEffects: (act.effectIds?.length ?? 0) > 0
            });
          }
        }
      }
      affordableBeastActions.sort((a, b) => a.cost - b.cost);
    }

    const weaponName = attackerActor?.items?.get(allocData.weaponId)?.name ?? "";

    const resolutionData = {
      mode, modeLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${mode}`),
      attackerName, attackerImg: attackerActor?.img,
      defenderName, defenderImg: defenderActor?.img,
      weaponName,
      attackDice: attackDiceDisplay, defenseDice: defenseDiceDisplay,
      pairedDice, attackTarget, defenseTarget,
      attackSuccesses, defenseSuccesses,
      resultType, resultText, hits,
      isHit: resultType === "hit",
      damage1, damage2, damage3,
      isCreatureAttacker, netSuccesses,
      affordableBeastActions, hasBeastActions: affordableBeastActions.length > 0,
      isBeastAttack: isCreatureAttacker && !allocData.weaponId
    };

    const resContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-result.hbs",
      resolutionData
    );

    const locationRoll = (allocData.attackDice?.[0]?.original) ?? 10;
    const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);

    const rollMode = game.settings.get("core", "rollMode");
    await ChatMessage.create({
      content: resContent,
      flags: {
        neuroshima: {
          opposedResult: {
            attackerUuid: allocData.attackerUuid,
            defenderUuid: allocData.defenderUuid,
            weaponId: allocData.weaponId,
            beastItemId: allocData.beastItemId ?? null,
            hits, location,
            damage1, damage2, damage3,
            netSuccesses, affordableBeastActions,
            isBeastAttack: isCreatureAttacker && !allocData.weaponId,
            applied: false, beastActionsApplied: false
          }
        }
      },
      speaker: { alias: "⚔" },
      rollMode
    });
  }

  /**
   * Create the handler chat card and set the actor flag on the defender.
   * @private
   */
  static async _createHandlerCard(rawResult, attacker, weapon, targetUuid, mode) {
    const targetDoc = fromUuidSync(targetUuid);
    const targetActor = targetDoc?.actor ?? targetDoc;
    if (!targetActor) {
      ui.notifications.warn("Target actor not found.");
      return;
    }

    // ── Cancel any stale pendings where this attacker already has an open attack ──
    await MeleeOpposedChat._cancelStalePendingsByAttacker(attacker.uuid);

    const attackDice = (rawResult.modifiedResults || []).map((r, i) => ({
      label: `D${i + 1}`,
      value: r.original,
      modified: r.modified,
      isSuccess: r.isSuccess,
      isNat1: r.isNat1,
      isNat20: r.isNat20
    }));
    const attackerSuccesses = rawResult.successPoints
      ?? attackDice.filter(d => d.isSuccess).length;

    if (rawResult.isGradCios && attackerSuccesses === 0) {
      const rollMode = rawResult.rollMode ?? game.settings.get("core", "rollMode");
      const missContent = await foundry.applications.handlebars.renderTemplate(
        "systems/neuroshima/templates/chat/melee-hail-card.hbs",
        { isMiss: true, attackerName: attacker.name }
      );
      await ChatMessage.create({ content: missContent, speaker: { alias: "⚔" }, rollMode });
      return;
    }

    // Collect defender's melee weapons for the chat buttons (WFRP style)
    const defenderWeapons = targetActor.items
      .filter(i => i.type === "weapon" && i.system.weaponType === "melee")
      .map(i => ({ id: i.id, name: i.name, img: i.img }));

    const templateData = {
      mode,
      modeLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${mode}`),
      attackerName: attacker.name,
      attackerImg: attacker.img,
      weaponName: weapon.name,
      damage1: weapon.system.damageMelee1,
      damage2: weapon.system.damageMelee2,
      damage3: weapon.system.damageMelee3,
      attackDice,
      attackerTarget: rawResult.target,
      attackerSuccesses,
      defenderName: targetActor.name,
      defenderImg: targetActor.img,
      defenderWeapons,
      status: "pending"
    };

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-pending.hbs",
      templateData
    );

    const rollMode = rawResult.rollMode ?? game.settings.get("core", "rollMode");
    const chatMsg = await ChatMessage.create({
      content,
      flags: {
        neuroshima: {
          opposedChat: {
            mode,
            status: "pending",
            attackerUuid: attacker.uuid,
            attackerTokenUuid: attacker.token?.uuid ?? null,
            defenderUuid: targetActor.uuid,
            defenderTokenUuid: targetDoc?.uuid ?? null,
            weaponId: weapon.id,
            beastItemId: weapon.beastItemId ?? null,
            attackRaw: rawResult.results,
            attackModified: attackDice.map(d => ({
              original: d.value,
              modified: d.modified,
              isSuccess: d.isSuccess
            })),
            attackTarget: rawResult.target,
            attackSuccesses: attackerSuccesses,
            attackerSkillBudget: rawResult.skill ?? 0,
            damage1: weapon.system.damageMelee1,
            damage2: weapon.system.damageMelee2,
            damage3: weapon.system.damageMelee3,
            isGradCios: rawResult.isGradCios || false,
            szachistaYield: !!(await attacker.getFlag("neuroshima", "_szachistaYield")),
            activatedMeleePreRollMods: rawResult.activatedMeleePreRollMods ?? [],
            attackerManeuver: rawResult.maneuver ?? null
          }
        }
      },
      speaker: { alias: "⚔" },
      rollMode
    });

    await attacker.unsetFlag("neuroshima", "_szachistaYield");

    if (!chatMsg) return;

    // ── Register in meleePendings FIRST (actor-sheet combat tab pending card) ──
    // Must be set before actor flag so the sheet re-render triggered by the flag
    // already finds the pending data.
    const combat = game.combat;
    if (combat) {
      const defenderUuid = targetActor.uuid;
      const pendingKey = defenderUuid.replace(/\./g, "-");
      const pendingData = {
        id: defenderUuid,
        attackerId: attacker.uuid,
        attackerTokenUuid: attacker.token?.uuid ?? null,
        defenderId: defenderUuid,
        defenderTokenUuid: targetDoc?.uuid ?? null,
        attackerName: attacker.name,
        defenderName: targetActor.name,
        mode,
        opposedChatMessageId: chatMsg.id,
        attackerInitiative: attackerSuccesses,
        weaponId: weapon.id,
        active: true,
        timestamp: Date.now()
      };
      const pendings = foundry.utils.deepClone(
        combat.getFlag("neuroshima", "meleePendings") || {}
      );
      pendings[pendingKey] = pendingData;
      if (game.user.isGM || !game.neuroshima?.socket) {
        await combat.setFlag("neuroshima", "meleePendings", pendings);
      } else {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", "meleePendings", pendings);
      }
      ui.combat?.render(true);
    }

    // ── Set actor flag on defender SECOND (WFRP: flags.oppose) ───────────
    // Setting this last ensures the meleePendings combat flag is already written
    // before the actor's sheet re-renders in response to the flag change.
    await MeleeOpposedChat._setDefenderFlag(targetActor.uuid, chatMsg.id);
  }

  /**
   * Cancel all still-pending attacks where `attackerUuid` is the attacker.
   * Called before registering a new attack so stale pendings don't accumulate.
   * @private
   */
  static async _cancelStalePendingsByAttacker(attackerUuid) {
    const combat = game.combat;
    const stalePendings = [];

    if (combat) {
      const pendings = combat.getFlag("neuroshima", "meleePendings") || {};
      for (const [key, p] of Object.entries(pendings)) {
        if (!p.active) continue;
        const sameAttacker = game.neuroshima?.NeuroshimaMeleeCombat?.isSameActor?.(p.attackerId, attackerUuid)
          ?? (p.attackerId === attackerUuid);
        if (sameAttacker) stalePendings.push({ key, pending: p });
      }
    } else {
      // No combat — scan all actors for oppose flags pointing to pending messages from this attacker
      for (const actor of game.actors) {
        const oppFlag = actor.getFlag("neuroshima", "oppose");
        if (!oppFlag?.messageId) continue;
        const msg = game.messages.get(oppFlag.messageId);
        const chatData = msg?.getFlag("neuroshima", "opposedChat");
        if (!chatData || chatData.status !== "pending") continue;
        const sameAttacker = game.neuroshima?.NeuroshimaMeleeCombat?.isSameActor?.(chatData.attackerUuid, attackerUuid)
          ?? (chatData.attackerUuid === attackerUuid);
        if (sameAttacker) stalePendings.push({ key: null, pending: { defenderId: actor.uuid, opposedChatMessageId: oppFlag.messageId } });
      }
    }

    for (const { key, pending } of stalePendings) {
      // Mark handler message as cancelled
      if (pending.opposedChatMessageId) {
        const msg = game.messages.get(pending.opposedChatMessageId);
        const chatData = msg?.getFlag("neuroshima", "opposedChat");
        if (chatData?.status === "pending") {
          await MeleeOpposedChat._setChatFlag(msg, "opposedChat", { ...chatData, status: "cancelled" });
        }
      }
      // Unset defender actor flag
      if (pending.defenderId) {
        await MeleeOpposedChat._unsetDefenderFlag(pending.defenderId);
      }
      // Remove from combat flag
      if (key && combat) {
        await combat.unsetFlag("neuroshima", `meleePendings.${key}`);
      }
    }

    if (stalePendings.length > 0) ui.combat?.render(true);
  }

  /** Update a chat message flag via socket if the caller is not the GM. @private */
  static async _setChatFlag(message, key, value) {
    if (!message) return;
    if (game.user.isGM || !game.neuroshima?.socket) {
      return message.setFlag("neuroshima", key, value);
    }
    return game.neuroshima.socket.executeAsGM("setChatMessageFlag", message.id, "neuroshima", key, value);
  }

  /** Update chat message content via socket if the caller is not the GM. @private */
  static async _updateChatContent(message, content) {
    if (!message) return;
    if (game.user.isGM || !game.neuroshima?.socket) {
      return message.update({ content });
    }
    return game.neuroshima.socket.executeAsGM("updateChatMessageContent", message.id, content);
  }

  /** Set flags.neuroshima.oppose on the defender's actor via socket if needed. @private */
  static async _setDefenderFlag(defenderUuid, messageId) {
    const defenderDoc = fromUuidSync(defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    if (!defenderActor) return;

    const value = { messageId };
    if (defenderActor.isOwner || game.user.isGM) {
      await defenderActor.setFlag("neuroshima", "oppose", value);
    } else if (game.neuroshima?.socket) {
      await game.neuroshima.socket.executeAsGM("setActorFlag", defenderUuid, "neuroshima", "oppose", value);
    }
  }

  /** Remove flags.neuroshima.oppose from the defender's actor. @private */
  static async _unsetDefenderFlag(defenderUuid) {
    const defenderDoc = fromUuidSync(defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    if (!defenderActor) return;

    if (defenderActor.isOwner || game.user.isGM) {
      await defenderActor.unsetFlag("neuroshima", "oppose");
    } else if (game.neuroshima?.socket) {
      await game.neuroshima.socket.executeAsGM("unsetActorFlag", defenderUuid, "neuroshima", "oppose");
    }
  }

  /** Remove the pending entry from meleePendings after resolution. @private */
  static async _removePending(pendingId) {
    const combat = game.combat;
    if (!combat) return;
    const pendingKey = pendingId.replace(/\./g, "-");
    const pendings = foundry.utils.deepClone(
      combat.getFlag("neuroshima", "meleePendings") || {}
    );
    if (pendings[pendingKey]) {
      pendings[pendingKey].active = false;
    }
    delete pendings[pendingKey];
    if (game.user.isGM || !game.neuroshima?.socket) {
      await combat.setFlag("neuroshima", "meleePendings", pendings);
    } else {
      await game.neuroshima.socket.executeAsGM("updateCombatFlag", "meleePendings", pendings);
    }
    ui.combat?.render(true);
  }

  /**
   * Builds a melee action object declaratively from a script's `actionDef` structure
   * and pushes it into extraActionsArr. Called when `script.useActionDef === true`.
   * @param {NeuroshimaScript} script        - Script object (has .effect, .actionDef)
   * @param {Object}           triggerArgs   - getMeleeActions trigger args
   * @param {Array}            extraActionsArr - Mutable array to push into
   */
  static async _buildActionFromDef(script, triggerArgs, extraActionsArr) {
    const { NeuroshimaScript, NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
    const def = script.actionDef;

    // ── 1. Condition checks ──────────────────────────────────────────────────
    if (def.condition?.requiresPreviousHit && !triggerArgs.ownerHadHit) {
      game.neuroshima?.log?.("[getMeleeActions] actionDef skipped (requiresPreviousHit)", def.name);
      return;
    }
    if (def.condition?.requiredConditionKey?.trim()) {
      const val = triggerArgs.actor.getConditionValue?.(def.condition.requiredConditionKey.trim()) ?? 0;
      if (!val) {
        game.neuroshima?.log?.("[getMeleeActions] actionDef skipped (condition key missing)", def.name, def.condition.requiredConditionKey);
        return;
      }
    }
    if (def.condition?.customScript?.trim()) {
      try {
        const condScript = new NeuroshimaScript(
          { code: def.condition.customScript, trigger: "getMeleeActions", label: `condition:${def.name}` },
          script.effect
        );
        const result = await condScript.execute(triggerArgs);
        if (result === false) {
          game.neuroshima?.log?.("[getMeleeActions] actionDef skipped (customScript returned false)", def.name);
          return;
        }
      } catch (err) {
        game.neuroshima?.log?.("[getMeleeActions] actionDef condition script error", def.name, err);
      }
    }

    // ── 2. Build onHitScript from declarative onHit definition ──────────────
    let onHitScript = null;
    const onHit = def.onHit ?? {};

    if (onHit.type === "applyEffect" && onHit.effectName?.trim()) {
      // Embed effectUuid in generated code so this.item can be resolved at execution time.
      const effectUuid = script.effect?.uuid ?? "";
      const effectName = onHit.effectName.trim();
      onHitScript = [
        `const _eff = fromUuidSync(${JSON.stringify(effectUuid)});`,
        `const _item = _eff?.parent?.documentName === "Item" ? _eff.parent : null;`,
        `const _tmpl = _item?.effects?.getName(${JSON.stringify(effectName)});`,
        `if (!_tmpl || !args.target) return;`,
        `const _already = args.target.effects?.some(e => e.getFlag("neuroshima","sourceEffect") === _tmpl.uuid);`,
        `if (!_already) { await _tmpl.applyEffect([args.target]); }`,
        `neuroshima.log("[ActionDef] Applied", ${JSON.stringify(effectName)}, "to", args.target?.name);`
      ].join("\n");
    } else if (onHit.type === "notify") {
      const text = JSON.stringify(onHit.notifyText?.trim() || def.name || "Sztuczka");
      onHitScript = [
        `ui.notifications.info(\`\${${text}}: \${args.actor?.name} vs \${args.target?.name}\`);`,
        `neuroshima.log("[ActionDef] Notify:", ${text});`
      ].join("\n");
    } else if (onHit.type === "script" && onHit.customScript?.trim()) {
      onHitScript = onHit.customScript.trim();
    }
    // type === "damage" or no onHit → onHitScript stays null (pipeline applies damage from `damage` field)

    // ── 3. Push normalised action ────────────────────────────────────────────
    const action = {
      id:          def.id?.trim()  || `actionDef-${foundry.utils.randomID(8)}`,
      name:        NeuroshimaScriptRunner._resolveItemRef(def.name?.trim() || "Sztuczka", script.effect?.parent ?? null, script.effect ?? null),
      img:         def.img?.trim()  || "systems/neuroshima/assets/effects/gears.svg",
      damage:      def.damage       ?? "",
      successCost: def.mode === "queue" ? (parseInt(def.successCost) || 1) : 0,
      minDice:     parseInt(def.minDice)  || 1,
      maxDice:     parseInt(def.maxDice)  || 3,
      annotation:  def.tooltip?.trim()    || null,
      onHitScript,
      immediateOnHit: def.immediateOnHit ?? false,
      _effectUuid: script.effect?.uuid ?? null
    };

    extraActionsArr.push(action);
    game.neuroshima?.log?.("[getMeleeActions] actionDef built:", def.name, { mode: def.mode, damage: def.damage, onHitType: onHit.type });
  }

  /**
   * Fires an onHitScript marked as `immediate: true` right at the moment a trick hit
   * is determined (during the responder phase of applyDuelBatch), before the duel ends.
   * Scripts without `immediate` still execute at "Nałóż obrażenia" time.
   *
   * @param {object} state         - Current duel state (deepClone of duelCard flag).
   * @param {object} hitEntry      - The hit entry just pushed to state.hits.
   * @param {boolean} isOwnerAttacker - True when the initiative owner is the attacker.
   */
  static async _fireImmediateOnHitScript(state, hitEntry, isOwnerAttacker) {
    const entry = state.trickOnHitScripts?.[hitEntry.trickId];
    if (!entry?.immediate) return;
    try {
      const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
      const effect = entry.effectUuid ? fromUuidSync(entry.effectUuid) : null;
      const ownerDoc    = fromUuidSync(isOwnerAttacker
        ? (state.attackerTokenUuid || state.attackerUuid)
        : (state.defenderTokenUuid || state.defenderUuid));
      const ownerActor  = ownerDoc?.actor  ?? ownerDoc;
      const targetDoc   = fromUuidSync(isOwnerAttacker
        ? (state.defenderTokenUuid || state.defenderUuid)
        : (state.attackerTokenUuid || state.attackerUuid));
      const targetActor = targetDoc?.actor ?? targetDoc;
      const scriptObj = new NeuroshimaScript(
        { code: entry.code, trigger: "getMeleeActions", label: "onHitScript:immediate" },
        effect
      );
      await scriptObj.execute({ actor: ownerActor, target: targetActor, state, hit: hitEntry });
      game.neuroshima?.log?.("[applyDuelBatch] immediate onHitScript executed", hitEntry.trickId);
    } catch (err) {
      game.neuroshima?.log?.("[applyDuelBatch] immediate onHitScript error", hitEntry.trickId, err);
    }
  }

  /**
   * Parsuje spec obrażeń sztuczki na listę typów ran do nałożenia.
   *
   * Format wejściowy (case-sensitive co do skrótów ran):
   *   ""         → []                       (brak obrażeń)
   *   "—"        → []                       (brak obrażeń, wartość placeholder)
   *   "D"        → ["D"]                    (jedno Draśnięcie)
   *   "sC"       → ["sC"]                   (jeden Ciężki Siniak)
   *   "3D"       → ["D","D","D"]            (trzy Draśnięcia)
   *   "2L + 1D"  → ["L","L","D"]           (dwie Lekkie + jedno Draśnięcie)
   *   "2sC"      → ["sC","sC"]              (dwa Ciężkie Siniaki)
   *
   * @param {string|null|undefined} damage - Spec obrażeń z pola damage akcji sztuczki.
   * @returns {string[]} Lista typów ran; pusta gdy brak obrażeń.
   */
  static _parseDamageSpec(damage) {
    if (!damage || damage === "—") return [];
    const segments = damage.split(/\s*\+\s*/);
    const result = [];
    for (const seg of segments) {
      // Match optional leading count + wound type (e.g. "3", "sC", "2sC", "D")
      const m = seg.trim().match(/^(\d+)?([A-Za-z]+)$/);
      if (!m) continue;
      const n    = m[1] ? parseInt(m[1], 10) : 1;
      const type = m[2];
      for (let i = 0; i < n; i++) result.push(type);
    }
    return result;
  }

  /**
   * Apply damage stored in an opposed result card's flags.
   * Called when the GM clicks the "Apply Damage" button on the result card.
   */
  static async applyOpposedDamage(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const rd = message.getFlag("neuroshima", "opposedResult");
    if (!rd) return;
    if (rd.applied) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyApplied"));
      return;
    }
    const hasHits        = rd.hits?.length > 0;
    const hasCounterHits = rd.counterHits?.length > 0;
    if (!hasHits && !hasCounterHits) {
      ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.NoHits"));
      return;
    }

    const defenderDoc = await fromUuid(rd.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    const attackerDoc  = await fromUuid(rd.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    if (!defenderActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    const { CombatHelper } = await import("../helpers/combat-helper.js");

    // ── BERSERKER kontr-ataki muszą być aplikowane PRZED isBeastAttack early-return ──
    // Kiedy atakujący to stworzenie (isBeastAttack === true), poniższy blok robi return
    // wcześniej niż oryginalny kod counterHits — dlatego obsługujemy je tutaj.
    if (hasCounterHits && attackerActor) {
      const defWeapon = defenderActor?.items?.find(i =>
        i.type === "weapon" && i.system?.weaponGroup === "melee" && i.system?.equipped
      ) ?? defenderActor?.items?.find(i =>
        i.type === "weapon" && i.system?.weaponGroup === "melee"
      ) ?? null;

      const counterResults        = [];
      const counterWoundIds       = [];
      let   counterReduced        = 0;
      const counterReducedDetails = [];

      for (const counterHit of rd.counterHits) {
        const tier = counterHit.tier ?? 1;
        const dmgForTier = counterHit.damageType
          ?? defWeapon?.system?.[`damageMelee${tier}`]
          ?? ["D", "L", "K"][tier - 1] ?? "D";
        const counterAttackData = {
          isMelee:     true,
          actorId:     defenderActor?.id,
          weaponId:    defWeapon?.id ?? null,
          label:       defWeapon?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
          damageMelee1: dmgForTier,
          damageMelee2: dmgForTier,
          damageMelee3: dmgForTier,
          finalLocation: rd.location,
          successPoints: tier
        };
        const batch = await CombatHelper.applyDamageToActor(attackerActor, counterAttackData, {
          isOpposed:    true,
          spDifference: tier,
          location:     rd.location,
          suppressChat: true
        });
        if (batch) {
          counterResults.push(...(batch.results ?? []));
          counterWoundIds.push(...(batch.woundIds ?? []));
          counterReduced += batch.reducedProjectiles ?? 0;
          counterReducedDetails.push(...(batch.reducedDetails ?? []));
        }
      }

      if (counterWoundIds.length > 0) {
        ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageApplied", {
          count: counterWoundIds.length, name: attackerActor.name
        }));
      }
      if (counterResults.length > 0 || counterReduced > 0 || counterWoundIds.length > 0) {
        await CombatHelper.renderPainResistanceReport(
          attackerActor, counterResults, counterWoundIds, counterReduced, counterReducedDetails
        );
      }
      game.neuroshima?.log?.("[applyDuelBatch] berserker counter-hits applied", {
        from: defenderActor?.name, to: attackerActor?.name,
        hits: rd.counterHits.length, weapon: defWeapon?.name ?? "unarmed"
      });
    }

    if (rd.isBeastAttack) {
      const queue = rd.pendingBeastQueue ?? [];
      if (queue.length > 0) {
        await MeleeOpposedChat.applyBeastActions(messageId, queue);
        const refreshed = message.getFlag("neuroshima", "opposedResult");
        await message.setFlag("neuroshima", "opposedResult", { ...refreshed, applied: true });
      } else {
        await message.setFlag("neuroshima", "opposedResult", { ...rd, applied: true });
      }
      return;
    }
    const weaponItem = attackerActor?.items?.get(rd.weaponId);

    const allResults = [];
    const allWoundIds = [];
    let totalReduced = 0;
    const allReducedDetails = [];

    for (const hit of rd.hits) {
      let targetActor = defenderActor;
      if (hit.isBackHit && rd.escapeeUuid) {
        const escapeeDoc = await fromUuid(rd.escapeeUuid);
        const escapeeActor = escapeeDoc?.actor ?? escapeeDoc;
        if (escapeeActor) targetActor = escapeeActor;
      }
      // Sztuczki gracza mają stały typ obrażeń niezależny od profilu broni.
      // Aby applyDamageToActor wybrał właściwy typ, nadpisujemy wszystkie trzy
      // pola damageMelee wartością z sztuczki — tier zostanie obliczony z hit.tier
      // i dla każdej wartości indeksu zwróci tę samą cyfrę.
      const isTrickHit = !!hit.trickId;

      // onHitScript — jeśli sztuczka ma zdefiniowany skrypt zamiast obrażeń (np. rozbrojenie Aramis),
      // uruchamiamy go zamiast applyDamageToActor. Skrypt dostaje pełny kontekst walki.
      // args: { actor (atakujący), target (broniony), state (stan pojedynku), hit (dane trafienia) }
      if (isTrickHit && rd.trickOnHitScripts?.[hit.trickId]) {
        try {
          const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
          const entry = rd.trickOnHitScripts[hit.trickId];
          const onHitCode  = typeof entry === "string" ? entry : entry.code;
          const effectUuid = typeof entry === "string" ? null  : entry.effectUuid;
          const effect     = effectUuid ? fromUuidSync(effectUuid) : null;
          const scriptObj  = new NeuroshimaScript({ code: onHitCode, trigger: "getMeleeActions", label: "onHitScript" }, effect);
          await scriptObj.execute({
            actor:  attackerActor,
            target: targetActor,
            state:  rd,
            hit
          });
          game.neuroshima?.log?.("[applyDuelBatch] onHitScript executed for trick", hit.trickId);
        } catch (err) {
          game.neuroshima?.log?.("[applyDuelBatch] onHitScript error for trick", hit.trickId, err);
        }
        continue;
      }

      if (isTrickHit) {
        // Parsuj spec obrażeń sztuczki — obsługuje multi-damage ("3D", "2L + 1D")
        // i brak obrażeń ("" lub "—") gdy sztuczka bazuje tylko na onHitScript.
        const trickWounds = MeleeOpposedChat._parseDamageSpec(hit.damageType);
        game.neuroshima?.log?.("[applyDuelBatch] trick hit", { trickId: hit.trickId, damageType: hit.damageType, wounds: trickWounds });
        if (trickWounds.length === 0) continue; // brak obrażeń — sztuczka wyłącznie skryptowa
        for (const woundType of trickWounds) {
          const attackData = {
            isMelee: true,
            actorId: attackerActor?.id,
            weaponId: rd.weaponId,
            label: weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
            damageMelee1: woundType,
            damageMelee2: woundType,
            damageMelee3: woundType,
            finalLocation: rd.location,
            successPoints: hit.tier
          };
          const batch = await CombatHelper.applyDamageToActor(targetActor, attackData, {
            isOpposed: true,
            spDifference: hit.tier,
            location: rd.location,
            suppressChat: true
          });
          if (batch) {
            allResults.push(...(batch.results ?? []));
            allWoundIds.push(...(batch.woundIds ?? []));
            totalReduced += batch.reducedProjectiles ?? 0;
            allReducedDetails.push(...(batch.reducedDetails ?? []));
          }
        }
      } else if (hit.isBlockDamage) {
        const attackData = {
          isMelee: true,
          actorId: attackerActor?.id,
          weaponId: rd.weaponId,
          label: weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
          damageMelee1: hit.damageType,
          damageMelee2: hit.damageType,
          damageMelee3: hit.damageType,
          finalLocation: rd.location,
          successPoints: hit.tier
        };
        const batch = await CombatHelper.applyDamageToActor(targetActor, attackData, {
          isOpposed: true,
          spDifference: hit.tier,
          location: rd.location,
          suppressChat: true
        });
        if (batch) {
          allResults.push(...(batch.results ?? []));
          allWoundIds.push(...(batch.woundIds ?? []));
          totalReduced += batch.reducedProjectiles ?? 0;
          allReducedDetails.push(...(batch.reducedDetails ?? []));
        }
      } else {
        const attackData = {
          isMelee: true,
          actorId: attackerActor?.id,
          weaponId: rd.weaponId,
          label: weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
          damageMelee1: rd.damage1,
          damageMelee2: rd.damage2,
          damageMelee3: rd.damage3,
          finalLocation: rd.location,
          successPoints: hit.tier
        };
        const batch = await CombatHelper.applyDamageToActor(targetActor, attackData, {
          isOpposed: true,
          spDifference: hit.tier,
          location: rd.location,
          suppressChat: true
        });
        if (batch) {
          allResults.push(...(batch.results ?? []));
          allWoundIds.push(...(batch.woundIds ?? []));
          totalReduced += batch.reducedProjectiles ?? 0;
          allReducedDetails.push(...(batch.reducedDetails ?? []));
        }
      }
    }

    // Sztuczki gracza z kolejki (successCost) — niezależne od wyniku porównania kości,
    // opłacone sukcesami jeszcze przed rozstrzygnięciem walki. Format: "trick:ID:damage".
    if (rd.pendingTrickQueue?.length > 0) {
      for (const trickEntry of rd.pendingTrickQueue) {
        if (!trickEntry.startsWith("trick:")) continue;
        const parts       = trickEntry.split(":");
        const trickId     = parts[1] ?? null;
        const trickDamage = parts.slice(2).join(":") ?? "";

        // onHitScript for queue tricks — executed before damage, same as standalone tricks.
        if (trickId && rd.trickOnHitScripts?.[trickId]) {
          try {
            const { NeuroshimaScript: NS2 } = await import("../apps/neuroshima-script-engine.js");
            const entry2      = rd.trickOnHitScripts[trickId];
            const onHitCode2  = typeof entry2 === "string" ? entry2 : entry2.code;
            const effectUuid2 = typeof entry2 === "string" ? null   : entry2.effectUuid;
            const effect2     = effectUuid2 ? fromUuidSync(effectUuid2) : null;
            const scriptObj   = new NS2({ code: onHitCode2, trigger: "getMeleeActions", label: "onHitScript" }, effect2);
            await scriptObj.execute({
              actor:  attackerActor,
              target: defenderActor,
              state:  rd,
              hit:    { trickId, damageType: trickDamage, tier: 1 }
            });
            game.neuroshima?.log?.("[applyDuelBatch] queue trick onHitScript executed", trickId);
          } catch (err) {
            game.neuroshima?.log?.("[applyDuelBatch] queue trick onHitScript error", trickId, err);
          }
        }

        // Parsuj spec obrażeń — obsługuje multi-damage i pusty damage.
        const queueWounds = MeleeOpposedChat._parseDamageSpec(trickDamage);
        game.neuroshima?.log?.("[applyDuelBatch] queue trick", { trickDamage, wounds: queueWounds });
        if (queueWounds.length === 0) continue; // brak obrażeń
        for (const woundType of queueWounds) {
          const trickAttackData = {
            isMelee: true,
            actorId: attackerActor?.id,
            label: `${weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed")} (sztuczka)`,
            damageMelee1: woundType,
            damageMelee2: woundType,
            damageMelee3: woundType,
            finalLocation: rd.location,
            successPoints: 1
          };
          const trickBatch = await CombatHelper.applyDamageToActor(defenderActor, trickAttackData, {
            isOpposed: true,
            spDifference: 1,
            location: rd.location,
            suppressChat: true
          });
          if (trickBatch) {
            allResults.push(...(trickBatch.results ?? []));
            allWoundIds.push(...(trickBatch.woundIds ?? []));
            totalReduced += trickBatch.reducedProjectiles ?? 0;
            allReducedDetails.push(...(trickBatch.reducedDetails ?? []));
          }
        }
      }
    }

    if (allWoundIds.length > 0) {
      ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageApplied", {
        count: allWoundIds.length, name: defenderActor.name
      }));
    }
    if (allResults.length > 0 || totalReduced > 0 || allWoundIds.length > 0) {
      await CombatHelper.renderPainResistanceReport(
        defenderActor, allResults, allWoundIds, totalReduced, allReducedDetails
      );
    }

    if (attackerActor?.type === "creature") {
      const beastItemFilter = rd.beastItemId ?? null;
      const beastItems = attackerActor.items.filter(i =>
        i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter)
      );
      for (const beastItem of beastItems) {
        for (const activity of (beastItem.system.activities ?? [])) {
          const linkedEffectIds = new Set(activity.effectIds ?? []);
          for (const effect of beastItem.effects) {
            if (!linkedEffectIds.has(effect.id)) continue;
            try {
              const { _id, ...rest } = effect.toObject();
              await ActiveEffect.implementation.create(
                { ...rest, disabled: false, transfer: false, origin: beastItem.uuid },
                { parent: defenderActor }
              );
            } catch (err) {
              console.error("Neuroshima | Failed to auto-apply beast effect:", err);
            }
          }
        }
      }
    }

    await message.setFlag("neuroshima", "opposedResult", { ...rd, applied: true });
  }

  static async _createPendingHailCard(rawResult, attacker, weapon, targetActor, targetDoc, attackDice, attackerSuccesses) {
    const toChip = d => ({ value: d.modified ?? d.value, isSuccess: d.isSuccess, isNat20: d.isNat20 ?? false });
    const rollMode = rawResult.rollMode ?? game.settings.get("core", "rollMode");

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-hail-card.hbs",
      {
        attackerName: attacker.name,
        attackerImg:  attacker.img,
        defenderName: targetActor.name,
        defenderImg:  targetActor.img,
        attackDiceChips: attackDice.map(toChip),
        attackSuccesses,
        isPending: true,
        isDone:    false,
        defenderActorUuid: targetActor.uuid,
        defenseRequiredLabel: game.i18n.format("NEUROSHIMA.GradCios.DefenseRequired", { n: attackerSuccesses })
      }
    );

    const chatMsg = await ChatMessage.create({
      content,
      flags: {
        neuroshima: {
          hailCard: {
            status:    "pending",
            attackerUuid: attacker.uuid,
            defenderUuid: targetActor.uuid,
            weaponId:     weapon.id,
            attackModified: attackDice.map(d => ({
              original:  d.value,
              modified:  d.modified,
              isSuccess: d.isSuccess,
              isNat20:   d.isNat20 ?? false
            })),
            attackerSuccesses,
            damage1: weapon.system.damageMelee1,
            damage2: weapon.system.damageMelee2,
            damage3: weapon.system.damageMelee3
          }
        }
      },
      speaker: { alias: "⚔" },
      rollMode
    });

    if (!chatMsg) return;

    const combat = game.combat;
    if (combat) {
      const defenderUuid = targetActor.uuid;
      const pendingKey   = defenderUuid.replace(/\./g, "-");
      const pendingData  = {
        id:               defenderUuid,
        attackerId:       attacker.uuid,
        attackerTokenUuid: attacker.token?.uuid ?? null,
        defenderId:       defenderUuid,
        defenderTokenUuid: targetDoc?.uuid ?? null,
        attackerName:     attacker.name,
        defenderName:     targetActor.name,
        mode:             "hail",
        opposedChatMessageId: chatMsg.id,
        attackerInitiative:   attackerSuccesses,
        weaponId:         weapon.id,
        active:           true,
        timestamp:        Date.now()
      };
      const pendings = foundry.utils.deepClone(combat.getFlag("neuroshima", "meleePendings") || {});
      pendings[pendingKey] = pendingData;
      if (game.user.isGM || !game.neuroshima?.socket) {
        await combat.setFlag("neuroshima", "meleePendings", pendings);
      } else {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", "meleePendings", pendings);
      }
      ui.combat?.render(true);
    }

    await MeleeOpposedChat._setDefenderFlag(targetActor.uuid, chatMsg.id);
  }

  static async hailDefendFromChat(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const hailCard = message.getFlag("neuroshima", "hailCard");
    if (!hailCard || hailCard.status !== "pending") {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyResolved"));
      return;
    }

    const defenderDoc   = fromUuidSync(hailCard.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    if (!defenderActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    if (!defenderActor.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.NotYourTurn"));
      return;
    }

    let defWeapon = defenderActor.items.find(
      i => i.type === "weapon" && i.system.weaponType === "melee" && i.system.equipped
    ) ?? defenderActor.items.find(i => i.type === "weapon" && i.system.weaponType === "melee");

    if (!defWeapon) {
      defWeapon = {
        id: null,
        name: game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.Unarmed"),
        img:  "systems/neuroshima/assets/img/weapon-melee.svg",
        type: "weapon",
        system: {
          weaponType: "melee", attribute: "dexterity", skill: "brawl",
          attackBonus: 0, defenseBonus: 0,
          damageMelee1: "D", damageMelee2: "L", damageMelee3: "C",
          requiredBuild: 0, piercing: 0, magazine: null, jamming: 20
        }
      };
    }

    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");
    const lastRoll = defenderActor.system.lastWeaponRoll ?? {};

    const dialog = new NeuroshimaWeaponRollDialog({
      actor:       defenderActor,
      weapon:      defWeapon,
      rollType:    "melee",
      meleeAction: "defense",
      targets:     [hailCard.attackerUuid],
      lastRoll,
      isPoolRoll:  true,
      onRoll: async (defenseResult) => {
        if (!defenseResult) return;
        const { NeuroshimaSocket: _NSHailDef } = await import("../helpers/socket-helper.js");
        const defenderUuid = defenderActor.token?.uuid ?? defenderActor.uuid;
        const condKey = MeleeTurnService._MANEUVER_TO_CONDITION[defenseResult.maneuver] || null;
        const tempoLevel = defenseResult.tempoLevel || 0;
        game.neuroshima?.log("[melee-opposed-chat.hailCard.onRoll] applying conditions", { defenderUuid, condKey, tempoLevel, attackerUuid: hailCard.attackerUuid });
        await _NSHailDef.gmExecute("syncActorManeuverConditions", defenderUuid, condKey, false, tempoLevel);
        if (tempoLevel > 0) {
          await _NSHailDef.gmExecute("syncActorManeuverConditions", hailCard.attackerUuid, null, false, tempoLevel);
        }
        await MeleeOpposedChat._resolveHailCard(message, hailCard, defenderActor, defenseResult);
      },
      onClose: () => {}
    });

    await dialog.render(true);
  }

  static async _resolveHailCard(message, hailCard, defenderActor, defenseResult) {
    await MeleeOpposedChat._setChatFlag(message, "hailCard", { ...hailCard, status: "resolved" });

    const { NeuroshimaSocket: _NSHailResolve } = await import("../helpers/socket-helper.js");
    const defenderUuid = defenderActor.token?.uuid ?? defenderActor.uuid;
    game.neuroshima?.log("[melee-opposed-chat._resolveHailCard] clearing maneuver conditions", { attacker: hailCard.attackerUuid, defender: defenderUuid });
    await _NSHailResolve.gmExecute("clearActorManeuverConditions", hailCard.attackerUuid);
    await _NSHailResolve.gmExecute("clearActorManeuverConditions", defenderUuid);

    const attackDice  = hailCard.attackModified;
    const defenseDice = (defenseResult.modifiedResults || []).map(r => ({
      original:  r.original,
      modified:  r.modified,
      isSuccess: r.isSuccess,
      isNat20:   r.isNat20 ?? false
    }));

    const atkSuccessCount = attackDice.filter(d => d.isSuccess).length;
    const defSuccessCount = defenseDice.filter(d => d.isSuccess).length;
    const netSuccesses    = atkSuccessCount - defSuccessCount;

    const toChip = d => ({ value: d.modified ?? d.original, isSuccess: d.isSuccess, isNat20: d.isNat20 ?? false });

    const attackerDoc   = fromUuidSync(hailCard.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;

    let updatedContent;
    let hailResult = null;

    if (netSuccesses > 0) {
      const tier     = Math.min(netSuccesses, 3);
      const damage   = hailCard[`damage${tier}`] ?? hailCard.damage1 ?? "?";
      const locationRoll = attackDice[0]?.original ?? 10;
      const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);
      const outcomeLabel = game.i18n.format("NEUROSHIMA.GradCios.Hit", { n: tier, dmg: damage });

      hailResult = {
        attackerUuid: hailCard.attackerUuid,
        defenderUuid: hailCard.defenderUuid,
        weaponId:     hailCard.weaponId,
        tier,
        damage1:  hailCard.damage1,
        damage2:  hailCard.damage2,
        damage3:  hailCard.damage3,
        location,
        applied:  false
      };

      updatedContent = await foundry.applications.handlebars.renderTemplate(
        "systems/neuroshima/templates/chat/melee-hail-card.hbs",
        {
          attackerName:    attackerActor?.name ?? "",
          attackerImg:     attackerActor?.img  ?? "",
          defenderName:    defenderActor.name,
          defenderImg:     defenderActor.img,
          attackDiceChips: attackDice.map(toChip),
          attackSuccesses: atkSuccessCount,
          isPending:       false,
          isDone:          true,
          defenseDiceChips: defenseDice.map(toChip),
          isBlocked:       false,
          hasHit:          true,
          outcomeLabel
        }
      );
    } else {
      const outcomeLabel = netSuccesses === 0
        ? game.i18n.localize("NEUROSHIMA.GradCios.EqualSuccessesBlock")
        : game.i18n.localize("NEUROSHIMA.GradCios.Blocked");

      updatedContent = await foundry.applications.handlebars.renderTemplate(
        "systems/neuroshima/templates/chat/melee-hail-card.hbs",
        {
          attackerName:    attackerActor?.name ?? "",
          attackerImg:     attackerActor?.img  ?? "",
          defenderName:    defenderActor.name,
          defenderImg:     defenderActor.img,
          attackDiceChips: attackDice.map(toChip),
          attackSuccesses: atkSuccessCount,
          isPending:       false,
          isDone:          true,
          defenseDiceChips: defenseDice.map(toChip),
          isBlocked:       true,
          hasHit:          false,
          outcomeLabel
        }
      );
    }

    if (hailResult) {
      await MeleeOpposedChat._setChatFlag(message, "hailResult", hailResult);
    }
    await MeleeOpposedChat._updateChatContent(message, updatedContent);

    await MeleeOpposedChat._removePending(hailCard.defenderUuid);
    await MeleeOpposedChat._unsetDefenderFlag(hailCard.defenderUuid);
    defenderActor?.sheet?.render();
    attackerActor?.sheet?.render();
  }

  static async applyHailDamage(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const hr = message.getFlag("neuroshima", "hailResult");
    if (!hr) return;
    if (hr.applied) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyApplied"));
      return;
    }

    const defenderDoc = await fromUuid(hr.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    const attackerDoc  = await fromUuid(hr.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    if (!defenderActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    const { CombatHelper } = await import("../helpers/combat-helper.js");
    const weaponItem = attackerActor?.items?.get(hr.weaponId);

    const attackData = {
      isMelee:      true,
      actorId:      attackerActor?.id,
      weaponId:     hr.weaponId,
      label:        weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
      damageMelee1: hr.damage1,
      damageMelee2: hr.damage2,
      damageMelee3: hr.damage3,
      finalLocation: hr.location,
      successPoints: hr.tier
    };
    const batch = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
      isOpposed:    true,
      spDifference: hr.tier,
      location:     hr.location,
      suppressChat: true
    });

    if (batch) {
      const woundIds = batch.woundIds ?? [];
      if (woundIds.length > 0) {
        ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageApplied", {
          count: woundIds.length, name: defenderActor.name
        }));
      }
      const allResults = batch.results ?? [];
      const totalReduced = batch.reducedProjectiles ?? 0;
      const allReducedDetails = batch.reducedDetails ?? [];
      if (allResults.length > 0 || totalReduced > 0 || woundIds.length > 0) {
        await CombatHelper.renderPainResistanceReport(
          defenderActor, allResults, woundIds, totalReduced, allReducedDetails
        );
      }
    }

    await message.setFlag("neuroshima", "hailResult", { ...hr, applied: true });
  }

  /**
   * Apply selected beast actions from the resolve card.
   * Called when the GM clicks "Zastosuj akcje bestii" on the result card.
   *
   * For activities with `testRequired === true`: posts a Required Test chat card whispered
   * to the defender's owning player(s) and all GMs (`whisperToDefender: true`).
   * For activities without `testRequired`: creates the linked ActiveEffects on the defender
   * immediately.
   *
   * @param {string}   messageId
   * @param {string[]} selectedActionIds   Item IDs of chosen beast actions (may repeat)
   */
  static async applyBeastActions(messageId, selectedActionIds) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const rd = message.getFlag("neuroshima", "opposedResult");
    if (!rd) return;
    if (rd.beastActionsApplied) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.BeastAction.AlreadyApplied"));
      return;
    }

    const defenderDoc = await fromUuid(rd.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    const attackerDoc  = await fromUuid(rd.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    if (!defenderActor || !attackerActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    const { CombatHelper } = await import("../helpers/combat-helper.js");
    const location = rd.location ?? "torso";

    const beastItemFilter = rd.beastItemId ?? null;
    const beastItemsForEffects = attackerActor.items.filter(i =>
      i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter)
    );
    const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
    for (const beastItem of beastItemsForEffects) {
      for (const activity of (beastItem.system.activities ?? [])) {
        if (activity.testRequired) {
          const resolveUuids = (ids = []) =>
            ids.map(id => beastItem.effects.get(id)).filter(Boolean).map(e => e.uuid);
          game.neuroshima?.log("[MeleeOpposedChat._applySelectedActions] posting required test for beast activity", { activityName: activity.name, testType: activity.testType, testKey: activity.testKey, defenderName: defenderActor?.name, defenderUuid: defenderActor?.uuid });
          await NeuroshimaScriptRunner.postRequiredTest({
            title:                 activity.name || beastItem.name,
            testType:              activity.testType             || "attribute",
            testKey:               activity.testKey              || "constitution",
            testAttributeOverride: activity.testAttributeOverride || "",
            requiredSuccesses:     activity.testSuccesses        ?? 1,
            isOpen:                activity.testIsOpen           ?? false,
            baseDifficulty:        activity.testDifficulty       || "average",
            defenderActorUuid:     defenderActor?.uuid ?? "",
            whisperToDefender:     true,
            onSuccessEffectUuids:  resolveUuids(activity.effectIds),
            onFailureEffectUuids:  resolveUuids(activity.onFailureEffectIds)
          });
          continue;
        }
        const linkedEffectIds = new Set(activity.effectIds ?? []);
        for (const effect of beastItem.effects) {
          if (!linkedEffectIds.has(effect.id)) continue;
          try {
            const { _id, ...rest } = effect.toObject();
            await ActiveEffect.implementation.create(
              { ...rest, disabled: false, transfer: false, origin: beastItem.uuid },
              { parent: defenderActor }
            );
          } catch (err) {
            console.error("Neuroshima | Failed to auto-apply beast effect:", err);
          }
        }
      }
    }

    const spentPerAction = {};
    let totalSpent = 0;
    for (const actionId of selectedActionIds) {
      spentPerAction[actionId] = (spentPerAction[actionId] ?? 0) + 1;
    }

    const allWoundIds = [];
    const allResults  = [];
    let totalReduced  = 0;
    const allReducedDetails = [];
    const appliedNames = [];

    for (const [compositeId, count] of Object.entries(spentPerAction)) {
      const [itemId, activityId] = compositeId.split("::");
      const actionItem = attackerActor.items.get(itemId);
      if (!actionItem) continue;
      const activity = (actionItem.system.activities ?? []).find(a => a.id === activityId);
      if (!activity) continue;
      const cost   = activity.successCost ?? 1;
      const damage = activity.damage || null;
      const label  = activity.name || actionItem.name;

      totalSpent += cost * count;
      appliedNames.push(...Array(count).fill(label));

      for (let n = 0; n < count; n++) {
        if (damage) {
          const freshDefDoc = await fromUuid(rd.defenderUuid);
          const freshDefender = freshDefDoc?.actor ?? freshDefDoc;
          if (!freshDefender) continue;
          const attackData = {
            isMelee: true,
            actorId: attackerActor.id,
            label,
            damageMelee1: damage,
            damageMelee2: damage,
            damageMelee3: damage,
            finalLocation: location,
            successPoints: 1
          };
          const batch = await CombatHelper.applyDamageToActor(freshDefender, attackData, {
            isOpposed: true, spDifference: 1, location, suppressChat: true
          });
          if (batch) {
            allResults.push(...(batch.results ?? []));
            allWoundIds.push(...(batch.woundIds ?? []));
            totalReduced += batch.reducedProjectiles ?? 0;
            allReducedDetails.push(...(batch.reducedDetails ?? []));
          }
        }
      }
    }

    // Apply remaining pip-wins or success-points as normal weapon damage.
    // For beast attacks (synthetic weapon, no real weaponId) remaining successes are wasted —
    // all damage must be chosen explicitly through beast action spending.
    const remaining = rd.netSuccesses - totalSpent;
    if (remaining > 0 && !rd.isBeastAttack) {
      if (rd.mode === "opposedPips") {
        // opposedPips: hits are sorted ascending by tier (done in resolveOpposed).
        // Beast actions consumed the first `totalSpent` pips (lowest tiers).
        // The remaining hits keep their own tier-specific damageType.
        const sortedHits = [...(rd.hits ?? [])].sort((a, b) => a.tier - b.tier);
        const remainingHits = sortedHits.slice(totalSpent);
        for (const hit of remainingHits) {
          if (!hit.damageType) continue;
          const attackData = {
            isMelee: true,
            actorId: attackerActor.id,
            label: attackerActor.items.get(rd.weaponId)?.name ?? "—",
            damageMelee1: hit.damageType,
            damageMelee2: hit.damageType,
            damageMelee3: hit.damageType,
            finalLocation: location,
            successPoints: 1
          };
          const batch = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
            isOpposed: true, spDifference: 1, location, suppressChat: true
          });
          if (batch) {
            allResults.push(...(batch.results ?? []));
            allWoundIds.push(...(batch.woundIds ?? []));
            totalReduced += batch.reducedProjectiles ?? 0;
            allReducedDetails.push(...(batch.reducedDetails ?? []));
          }
        }
      } else {
        // opposedSuccesses: remaining net successes map to a single damage tier.
        const remainingTier = Math.min(3, remaining);
        const damageType = rd[`damage${remainingTier}`];
        if (damageType) {
          const attackData = {
            isMelee: true,
            actorId: attackerActor.id,
            label: attackerActor.items.get(rd.weaponId)?.name ?? "—",
            damageMelee1: rd.damage1,
            damageMelee2: rd.damage2,
            damageMelee3: rd.damage3,
            finalLocation: location,
            successPoints: remainingTier
          };
          const batch = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
            isOpposed: true, spDifference: remainingTier, location, suppressChat: true
          });
          if (batch) {
            allResults.push(...(batch.results ?? []));
            allWoundIds.push(...(batch.woundIds ?? []));
            totalReduced += batch.reducedProjectiles ?? 0;
            allReducedDetails.push(...(batch.reducedDetails ?? []));
          }
        }
      }
    }

    if (allWoundIds.length > 0 || appliedNames.length > 0) {
      ui.notifications.info(
        `${defenderActor.name}: ${appliedNames.join(", ")}` +
        (allWoundIds.length > 0 ? ` (+${allWoundIds.length} rana/y)` : "")
      );
    }
    if (allResults.length > 0 || totalReduced > 0 || allWoundIds.length > 0) {
      await CombatHelper.renderPainResistanceReport(
        defenderActor, allResults, allWoundIds, totalReduced, allReducedDetails
      );
    }

    await message.setFlag("neuroshima", "opposedResult", { ...rd, beastActionsApplied: true });
  }

  /** Map first attack die roll to a body location. @private */
  static _getLocationFromRoll(roll) {
    if (roll <= 2)  return "head";
    if (roll <= 4)  return "rightArm";
    if (roll <= 6)  return "leftArm";
    if (roll <= 15) return "torso";
    if (roll <= 17) return "rightLeg";
    return "leftLeg";
  }
}

/**
 * @file melee-resolution.js
 * @description Exchange resolution for Neuroshima 1.5 Melee Encounters.
 *
 * ### Resolution rules (NS 1.5 default mode)
 * - Attacker wins iff `attackerSuccesses > defenderSuccesses`.
 * - Damage tier is determined by `declaredDiceCount` (not success count):
 *   1 die → damageMelee1, 2 dice → damageMelee2, 3 dice → damageMelee3.
 * - Defender wins with higher successes: block (tie if fullDefense maneuver) or takeover
 *   (initiative passes to defender, who immediately becomes the next attacker).
 * - Extra attacks from crowding are queued in `extraAttackQueue` and resolved after the primary.
 * - After all exchanges, the segment pointer advances by `declaredDiceCount` (NS 1.5 cost rule).
 *   If the new segment > 3, the turn ends automatically.
 */
/**
 * Handles exchange resolution logic: success/failure comparison, takeover, and damage triggers.
 * After primary resolution, automatically resolves extra attacks and advances the segment.
 */
export class MeleeResolution {
  /**
   * Resolves the primary exchange and auto-advances the combat state.
   * Chain: primary resolution → extra attacks → segment advance (all automatic).
   * @param {string} id Encounter ID
   */
  static async resolvePrimaryExchange(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);

    // Branch to the appropriate resolution mode
    const resolutionMode = updated.resolutionMode || "normal";
    if (resolutionMode === "opposedPips") {
      await this._resolveOpposedPips(id, updated);
      return;
    }
    if (resolutionMode === "opposedSuccesses") {
      await this._resolveOpposedSuccesses(id, updated);
      return;
    }

    // ── Normal mode (default NS 1.5) ──────────────────────────────────────
    const exchange = updated.currentExchange;
    const attackerId = exchange.attackerId;
    const defenderId = exchange.defenderId;
    const attacker = updated.participants[attackerId];
    const defender = updated.participants[defenderId];
    const diceCount = exchange.declaredDiceCount || 0;

    if (!attacker || !defender) return;

    // 1. Calculate Tempo Shift
    // MANEUVER — Zwiększone tempo (Increased Pace):
    // Rule: "Podnosi PT własnych testów akcji, a jego przeciwnik będzie musiał zdawać testy
    //        na tym samym, podwyższonym PT." — NS 1.5 p.XX
    // We take the MAX of both participants' declared tempoLevel so that whichever combatant
    // chose the maneuver raises the difficulty for BOTH sides equally.
    // The actual difficulty shift is applied in getEffectiveTarget() via _getShiftedDifficulty().
    // NOTE: setPool intentionally stores the base snapshot WITHOUT the tempo shift (for the
    // increasedTempo player) so that getEffectiveTarget() is the single canonical place where
    // the shift is applied — avoiding double-counting.
    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    game.neuroshima?.log("Resolving primary melee exchange", { id, attacker: attacker.name, defender: defender.name, diceCount });

    let attackerTarget = this.getEffectiveTarget(attacker, tempoLevel, updated.crowding[attackerId]?.dexPenalty || 0, "attack");
    let defenderTarget = this.getEffectiveTarget(defender, tempoLevel, updated.crowding[defenderId]?.dexPenalty || 0, "defense");

    // preOpposedAttacker / preOpposedDefender — allow effect scripts to modify effective
    // difficulty targets for each side before successes are counted.
    const attackerActor = fromUuidSync(attacker.actorUuid);
    const defenderActor = fromUuidSync(defender.actorUuid);
    const attackerActorDoc = attackerActor?.actor || attackerActor;
    const defenderActorDoc = defenderActor?.actor || defenderActor;
    if (attackerActorDoc) {
      const atkArgs = { actor: attackerActorDoc, participant: attacker, encounter: updated, difficultyTarget: attackerTarget, mode: "attack" };
      await NeuroshimaScriptRunner.execute("preOpposedAttacker", atkArgs);
      attackerTarget = atkArgs.difficultyTarget;
    }
    if (defenderActorDoc) {
      const defArgs = { actor: defenderActorDoc, participant: defender, encounter: updated, difficultyTarget: defenderTarget, mode: "defense" };
      await NeuroshimaScriptRunner.execute("preOpposedDefender", defArgs);
      defenderTarget = defArgs.difficultyTarget;
    }

    // 2. Calculate successes — use shared helper that accounts for doubleSkill allocations.
    const attackerSuccesses = exchange.attackerSelectedDice.filter(idx => this._isDieSuccess(attacker, idx, attackerTarget)).length;
    const defenderSuccesses = exchange.defenderSelectedDice.filter(idx => this._isDieSuccess(defender, idx, defenderTarget)).length;

    let resultType = "miss";
    let logText = "";

    game.neuroshima?.log("Exchange successes", { attackerSuccesses, defenderSuccesses, diceCount, attackerTarget, defenderTarget });

    // 3. Resolution Logic (NS 1.5)
    // Attacker wins if they have strictly MORE successes than the defender.
    // Damage is based on diceCount (strength of the declared attack), not on success count.
    // On a tie or defender advantage → block or takeover.
    if (attackerSuccesses > defenderSuccesses) {
      resultType = "hit";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogHit", { attacker: attacker.name, defender: defender.name, s: diceCount });
      const locationDieIndex = exchange.locationDieIndex ?? exchange.attackerSelectedDice[0];
      const damageOptions = this._computeDamageOptions(diceCount, attacker);
      if (damageOptions.length === 1) {
        // Only one way to distribute: apply immediately
        await this.applyDamageDistributed(updated, attackerId, defenderId, damageOptions[0].hits, locationDieIndex);
      } else {
        // Multiple options: pause for attacker to choose
        updated.pendingDamage = {
          attackerId, defenderId, diceCount, locationDieIndex, options: damageOptions
        };
      }
    } else if (defenderSuccesses > attackerSuccesses) {
      // MANEUVER — Pełna obrona (Full Defense):
      // Rule: "aby przejąć Inicjatywę, musi poświęcić na to aż dwa sukcesy"
      // A defender using fullDefense requires a 2-success ADVANTAGE to take over initiative;
      // otherwise the exchange is treated as a block even if they have more successes.
      const takeoverSuccessesRequired = (defender.maneuver === "fullDefense") ? 2 : 1;
      const actualAdvantage = defenderSuccesses - attackerSuccesses;

      if (actualAdvantage >= takeoverSuccessesRequired) {
        resultType = "takeover";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogTakeover", { attacker: defender.name, oldAttacker: attacker.name });
        updated.turnState.initiativeOwnerId = defenderId;

        // MANEUVER — Furia (Fury):
        // Rule: "każde przejęcie Inicjatywy przez przeciwnika jest jednocześnie celnym ciosem"
        // When the fury-user loses initiative (takeover), they automatically take a 1-die hit.
        // applyDamage(encounter, newAttackerId=defenderId, victimId=attackerId, 1 die, locationDie)
        if (attacker.maneuver === "fury") {
          logText += " " + game.i18n.format("NEUROSHIMA.MeleeDuel.LogFuryHit", { name: defender.name });
          await this.applyDamage(updated, defenderId, attackerId, 1, exchange.defenderSelectedDice[0]);
        }
      } else {
        resultType = "block";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
      }
    } else {
      // Equal successes (including both zero) — defender wins the tie
      resultType = "block";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
    }

    // 4. Update log and mark dice as used
    updated.log.push({
      type: resultType,
      turn: updated.turnState.turn,
      segment: updated.turnState.segment,
      text: logText
    });
    attacker.usedDice.push(...exchange.attackerSelectedDice);
    defender.usedDice.push(...exchange.defenderSelectedDice);

    // opposedAttacker / opposedDefender — fire after result is determined, before damage applied.
    // Each trigger receives its own spread copy so actor differs per side; primitive fields
    // (resultType, blockDamageShift) are synced back after each call.
    // Object fields (attacker, defender) are shared references — mutations persist automatically.
    const postResultBase = {
      encounter: updated, diceCount, attackerId, defenderId,
      attacker, defender, participant: defender, attackerSuccesses, defenderSuccesses
    };
    if (attackerActorDoc) {
      const atkArgs = { ...postResultBase, actor: attackerActorDoc, resultType, blockDamageShift: 0 };
      await NeuroshimaScriptRunner.execute("opposedAttacker", atkArgs);
      resultType = atkArgs.resultType;
    }
    if (defenderActorDoc) {
      const defArgs = { ...postResultBase, actor: defenderActorDoc, resultType, blockDamageShift: 0 };
      await NeuroshimaScriptRunner.execute("opposedDefender", defArgs);
      resultType = defArgs.resultType;
    }

    // blockDamageShift — set by preOpposedDefender scripts (e.g. Garda trick) via
    // args.participant.blockDamageShift, OR via opposedDefender via args.blockDamageShift.
    // Negative value = shift damage type DOWN by N levels on the D→L→C→K track on block.
    // -1 = one tier lower (C→L, L→D, D→nothing/no damage).
    const _blockShift = defender.blockDamageShift || 0;
    if (resultType === "block" && _blockShift !== 0) {
      const locationDieIndex = exchange.locationDieIndex ?? exchange.attackerSelectedDice[0];
      const weaponForBlock = attackerActorDoc?.items.get(attacker.weaponId);
      const globalShift = attacker.damageShift || 0;
      const tierShift = globalShift + (attacker[`damageShift${Math.min(diceCount, 3)}`] || 0);
      let baseDmg;
      if (diceCount >= 3) baseDmg = weaponForBlock?.system.damageMelee3 || "C";
      else if (diceCount >= 2) baseDmg = weaponForBlock?.system.damageMelee2 || "L";
      else baseDmg = weaponForBlock?.system.damageMelee1 || "D";
      const afterTierShift = this._shiftDamageTypeUnclamped(baseDmg, tierShift);
      const finalDmg = afterTierShift ? this._shiftDamageTypeUnclamped(afterTierShift, _blockShift) : null;
      if (finalDmg && defenderActorDoc) {
        const rawValue = attacker.pool[locationDieIndex] ?? 8;
        const location = this._getLocationFromRoll(rawValue);
        const { CombatHelper } = await import("../helpers/combat-helper.js");
        await CombatHelper.applyDamageToActor(defenderActorDoc, {
          isMelee: true,
          actorId: attackerActorDoc?.id,
          weaponId: attacker.weaponId,
          label: weaponForBlock?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
          successPoints: 1,
          finalLocation: location,
          damageMelee1: finalDmg,
          damageMelee2: finalDmg,
          damageMelee3: finalDmg
        }, { isOpposed: true, spDifference: 1, location });
      }
    }
    defender.blockDamageShift = 0;

    // BERSERKER counter-attack (Tryb Berserkera):
    // Rule: "zadawać ciosy nie zważając na rany mimo przegranej Inicjatywy" — NS 1.5
    // When the defender accepted the hit in berserker mode, berserkerAcceptHit stores
    // all their remaining unused dice in exchange.berserkerCounterDice.  Those dice are
    // committed to a simultaneous automatic counter-attack — no success check, the
    // berserker always deals damage back regardless of the exchange outcome.
    if (exchange.berserkerCounterDice?.length > 0) {
      const counterCount = exchange.berserkerCounterDice.length;
      const counterOptions = this._computeDamageOptions(counterCount, defender);
      if (counterOptions.length > 0) {
        await this.applyDamageDistributed(
          updated, defenderId, attackerId,
          counterOptions[0].hits,
          exchange.berserkerCounterDice[0]
        );
        updated.log.push({
          type: "berserker-counter",
          turn: updated.turnState.turn,
          segment: updated.turnState.segment,
          text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogBerserkerCounter", {
            name: defender.name, dice: counterCount
          })
        });
      }
      defender.usedDice.push(...exchange.berserkerCounterDice);
    }

    // 5. Store segment cost before clearing exchange (X dice = X segments consumed)
    updated.turnState.segmentCost = diceCount;

    // Snapshot last exchange result for the exchange-resolved trigger in _advanceAfterExchange
    updated.lastExchangeResult = { attackerId, defenderId, resultType, diceCount, attackerSuccesses, defenderSuccesses };

    // 6. Clear current exchange
    updated.currentExchange = {
      attackerId: null, defenderId: null, declaredAction: null,
      declaredDiceCount: 0, attackerSelectedDice: [], defenderSelectedDice: [],
      resolutionType: "normal"
    };

    // 6b. If a hit requires attacker to choose damage distribution, pause here.
    if (updated.pendingDamage) {
      updated.turnState.phase = "damage-selection";
      updated.turnState.selectionTurn = updated.pendingDamage.attackerId;
      await MeleeStore.updateEncounter(id, updated);
      return;
    }

    await this._advanceAfterExchange(id, updated);
  }

  /**
   * Called by the attacker to confirm their chosen damage distribution.
   * Applies damage and resumes the normal exchange flow.
   * @param {string} id           Encounter ID
   * @param {number} optionIndex  Index into pendingDamage.options
   */
  static async confirmDamageDistribution(id, optionIndex) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "damage-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    const pending = updated.pendingDamage;
    if (!pending) return;

    const option = pending.options[optionIndex];
    if (!option) return;

    await this.applyDamageDistributed(updated, pending.attackerId, pending.defenderId, option.hits, pending.locationDieIndex);
    updated.pendingDamage = null;

    await this._advanceAfterExchange(id, updated);
  }

  /**
   * Handles queue advancement and segment progression after an exchange is resolved.
   * @private
   */
  static async _advanceAfterExchange(id, updated) {
    // Handle multi-player segment queue
    updated.turnState.queueIndex += 1;
    const queue = updated.turnState.segmentQueue || [];

    if (updated.turnState.queueIndex < queue.length) {
      const next = queue[updated.turnState.queueIndex];
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = next.attackerId;
      await MeleeStore.updateEncounter(id, updated);
      return;
    }

    // All primary exchanges done — auto-resolve extra attacks
    this.prepareExtraAttacks(updated);
    for (const attack of (updated.extraAttackQueue || [])) {
      if (!attack.resolved) {
        await this.resolveSingleExtraAttack(updated, attack);
        attack.resolved = true;
      }
    }

    // exchange-resolved: fires on all participants after damage is applied, before segment advances
    await NeuroshimaScriptRunner.runMeleeUpdate(id, updated, "exchange-resolved");
    updated.lastExchangeResult = null;

    // Auto-advance segment
    const cost = updated.turnState.segmentCost || 1;
    const newSeg = (updated.turnState.segment || 1) + cost;
    updated.turnState.segmentCost = 0;

    if (newSeg > 3) {
      await NeuroshimaScriptRunner.runMeleeUpdate(id, updated, "turn-end");
      await MeleeStore.updateEncounter(id, updated);
      await MeleeTurnService.startNewTurn(id);
    } else {
      updated.turnState.segment = newSeg;
      await NeuroshimaScriptRunner.runMeleeUpdate(id, updated, "segment-advance");
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      await MeleeStore.updateEncounter(id, updated);
    }
  }

  /**
   * Returns the effective (post-allocation) pip value for a die.
   * When doubleSkillAction is ON, applies selfReductions and opponentGains.
   * Falls back to modifiedPool (doubleSkill OFF auto-applied skill), then raw pool.
   */
  static _getEffectiveDieVal(participant, idx) {
    if (participant.modifiedPool?.[idx] !== undefined) return participant.modifiedPool[idx];
    const raw = participant.pool[idx];
    return raw - (participant.selfReductions?.[idx] || 0) + (participant.opponentGains?.[idx] || 0);
  }

  /**
   * Returns whether a die is a success after applying allocations.
   * When doubleSkillAction is OFF and dieResults are present, defers to the
   * pre-computed flags from the roll dialog (exact match to the chat card).
   * When doubleSkillAction is ON, always recomputes from effective value so
   * that selfReductions and opponentGains affect the outcome.
   */
  static _isDieSuccess(participant, idx, target) {
    if (!game.settings.get("neuroshima", "doubleSkillAction") && participant.dieResults) {
      return participant.dieResults[idx]?.isSuccess ?? false;
    }
    const val = this._getEffectiveDieVal(participant, idx);
    return participant.pool[idx] !== 20 && val <= target;
  }

  /**
   * Calculates effective target considering tempo and crowding penalty.
   *
   * MANEUVER — Zwiększone tempo (Increased Pace):
   * The tempo shift is applied here (and ONLY here) so that BOTH participants in the
   * exchange pay the same raised PT regardless of which one declared the maneuver.
   * Participants with increasedTempo store a CLEAN (no-tempo) snapshot in setPool so
   * that this function is the single point of application — see setPool for details.
   *
   * The shift is computed from the "average" difficulty (0 %) as a baseline, then
   * shifted `tempoLevel` steps harder via _getShiftedDifficulty().  The resulting
   * `mod` (always ≤ 0) is added to the target, lowering it and making successes rarer.
   */
  static getEffectiveTarget(participant, tempoLevel, dexPenalty, mode = "attack") {
    const { NeuroshimaDice } = game.neuroshima;
    let target = mode === "attack" ? (participant.attackTargetSnapshot || 10) : (participant.defenseTargetSnapshot || 10);

    target -= dexPenalty;

    if (tempoLevel === 0) return target;
    const baseDiffObj = NeuroshimaDice.getDifficultyFromPercent(0);
    const shifted = NeuroshimaDice._getShiftedDifficulty(baseDiffObj, tempoLevel);
    return target + shifted.mod;
  }

  /**
   * Populates the extra attack queue for the current segment.
   */
  static prepareExtraAttacks(encounter) {
    encounter.extraAttackQueue = [];
    const segment = encounter.turnState.segment;

    for (const attackerId in encounter.participants) {
      const attacker = encounter.participants[attackerId];
      if (!attacker.isActive || attackerId === encounter.currentExchange.attackerId) continue;

      const targetId = encounter.primaryTargets[attackerId];
      if (!targetId) continue;

      const targetCrowding = encounter.crowding[targetId];
      if (targetCrowding.primaryOpponentId !== attackerId) {
        encounter.extraAttackQueue.push({
          attackerId,
          defenderId: targetId,
          sourceSegment: segment,
          isBackAttack: false,
          resolved: false
        });
      }
    }
  }

  /**
   * Resolves a single extra attack with automatic defender free roll.
   */
  static async resolveSingleExtraAttack(encounter, attack) {
    const attacker = encounter.participants[attack.attackerId];
    const defender = encounter.participants[attack.defenderId];

    const availableDiceIndices = attacker.pool.map((v, i) => ({ v, i }))
      .filter(d => !attacker.usedDice.includes(d.i))
      .sort((a, b) => a.v - b.v);

    if (availableDiceIndices.length === 0) return;

    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    const attackerTarget = this.getEffectiveTarget(attacker, tempoLevel, encounter.crowding[attack.attackerId]?.dexPenalty || 0, "attack");

    const successesIndices = availableDiceIndices.filter(d => d.v <= attackerTarget).map(d => d.i);
    const diceCount = Math.min(3, successesIndices.length);

    if (diceCount === 0) {
      attacker.usedDice.push(availableDiceIndices[0].i);
      encounter.log.push({
        type: "miss",
        turn: encounter.turnState.turn,
        segment: encounter.turnState.segment,
        text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogExtraAttackMiss", { attacker: attacker.name, defender: defender.name })
      });
      return;
    }

    const selectedIndices = successesIndices.slice(0, diceCount);
    attacker.usedDice.push(...selectedIndices);

    const defenderTarget = this.getEffectiveTarget(defender, tempoLevel, encounter.crowding[attack.defenderId]?.dexPenalty || 0, "defense");
    const freeRoll = new Roll(`${diceCount}d20`);
    await freeRoll.evaluate();

    const freeSuccesses = freeRoll.terms[0].results.filter(r => r.result <= defenderTarget).length;
    const diceHtml = freeRoll.terms[0].results.map(r =>
      `<span class="die ${r.result <= defenderTarget ? "success" : "failure"}">${r.result}</span>`
    ).join(" ");

    if (freeSuccesses >= diceCount) {
      encounter.log.push({
        type: "block",
        turn: encounter.turnState.turn,
        segment: encounter.turnState.segment,
        text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogExtraAttackBlocked", { attacker: attacker.name, defender: defender.name, dice: diceHtml })
      });
    } else {
      encounter.log.push({
        type: "hit",
        turn: encounter.turnState.turn,
        segment: encounter.turnState.segment,
        text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogExtraAttackHit", { attacker: attacker.name, defender: defender.name, s: diceCount, dice: diceHtml })
      });
      await this.applyDamage(encounter, attack.attackerId, attack.defenderId, diceCount, selectedIndices[0]);
    }
  }

  /**
   * Opposed-by-Pips (Przeciwstawny na Oczkach) resolution.
   * Both combatants must commit exactly 3 dice.
   * Die slot 0 → tier-1 damage, slot 1 → tier-2 damage, slot 2 → tier-3 damage.
   * Attacker wins a slot when their die is a success AND (defender's die is not a success
   * OR attacker's effective value is strictly lower than defender's effective value).
   * Each won slot applies the corresponding weapon damage tier independently.
   * @private
   */
  static async _resolveOpposedPips(id, updated) {
    const exchange = updated.currentExchange;
    const attackerId = exchange.attackerId;
    const defenderId = exchange.defenderId;
    const attacker = updated.participants[attackerId];
    const defender = updated.participants[defenderId];

    if (!attacker || !defender) return;

    // MANEUVER — Zwiększone tempo: same dual-participant rule as normal mode (see above).
    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    const attackerTarget = this.getEffectiveTarget(attacker, tempoLevel, updated.crowding[attackerId]?.dexPenalty || 0, "attack");
    const defenderTarget = this.getEffectiveTarget(defender, tempoLevel, updated.crowding[defenderId]?.dexPenalty || 0, "defense");

    game.neuroshima?.log("Resolving opposedPips exchange", {
      id, attacker: attacker.name, defender: defender.name, attackerTarget, defenderTarget
    });

    const aDice = exchange.attackerSelectedDice;
    const dDice = exchange.defenderSelectedDice;
    const slots = Math.min(aDice.length, dDice.length, 3);

    const hits = [];
    const slotResults = [];

    for (let pos = 0; pos < slots; pos++) {
      const aIdx = aDice[pos];
      const dIdx = dDice[pos];
      const aSuccess = this._isDieSuccess(attacker, aIdx, attackerTarget);
      const dSuccess = this._isDieSuccess(defender, dIdx, defenderTarget);
      const aVal = this._getEffectiveDieVal(attacker, aIdx);
      const dVal = this._getEffectiveDieVal(defender, dIdx);
      const attackerWins = aSuccess && (!dSuccess || aVal < dVal);
      const tier = pos + 1;
      slotResults.push({ pos, tier, aVal, dVal, aSuccess, dSuccess, attackerWins });
      if (attackerWins) hits.push({ cost: tier, tier });
    }

    game.neuroshima?.log("OpposedPips slot results", { slotResults });

    let resultType;
    let logText;

    if (hits.length > 0) {
      resultType = "hit";
      const tierLabels = hits.map(h => `T${h.tier}`).join(", ");
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogOpposedPipsHit", {
        attacker: attacker.name,
        defender: defender.name,
        tiers: tierLabels
      });
      const locationDieIndex = aDice[0];
      await this.applyDamageDistributed(updated, attackerId, defenderId, hits, locationDieIndex);
    } else {
      // Check if defender can take over (defender had more winning slots)
      // MANEUVER — Pełna obrona: needs 2 winning slots to take over (vs 1 normally).
      const defenderWonSlots = slotResults.filter(s => !s.attackerWins && s.dSuccess).length;
      const takeoverRequired = (defender.maneuver === "fullDefense") ? 2 : 1;

      if (defenderWonSlots >= takeoverRequired) {
        resultType = "takeover";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogTakeover", { attacker: defender.name, oldAttacker: attacker.name });
        updated.turnState.initiativeOwnerId = defenderId;

        // MANEUVER — Furia: fury-user auto-takes a hit when they lose initiative.
        if (attacker.maneuver === "fury") {
          logText += " " + game.i18n.format("NEUROSHIMA.MeleeDuel.LogFuryHit", { name: defender.name });
          await this.applyDamage(updated, defenderId, attackerId, 1, dDice[0]);
        }
      } else {
        resultType = "block";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
      }
    }

    updated.log.push({ type: resultType, turn: updated.turnState.turn, segment: updated.turnState.segment, text: logText });
    attacker.usedDice.push(...aDice);
    defender.usedDice.push(...dDice);
    updated.turnState.segmentCost = 3;
    updated.currentExchange = {
      attackerId: null, defenderId: null, declaredAction: null,
      declaredDiceCount: 0, attackerSelectedDice: [], defenderSelectedDice: [], resolutionType: "normal"
    };

    await this._advanceAfterExchange(id, updated);
  }

  /**
   * Opposed-by-Successes (Przeciwstawny na Sukcesach) resolution.
   * Attacker selects 1–3 dice, defender matches the count.
   * Net successes = attackerSuccesses − defenderSuccesses.
   * Damage tier = net successes (clamped 1–3). If net ≤ 0, defender can take over/block.
   * @private
   */
  static async _resolveOpposedSuccesses(id, updated) {
    const exchange = updated.currentExchange;
    const attackerId = exchange.attackerId;
    const defenderId = exchange.defenderId;
    const attacker = updated.participants[attackerId];
    const defender = updated.participants[defenderId];
    const diceCount = exchange.declaredDiceCount || 0;

    if (!attacker || !defender) return;

    // MANEUVER — Zwiększone tempo: same dual-participant rule as normal mode (see above).
    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    const attackerTarget = this.getEffectiveTarget(attacker, tempoLevel, updated.crowding[attackerId]?.dexPenalty || 0, "attack");
    const defenderTarget = this.getEffectiveTarget(defender, tempoLevel, updated.crowding[defenderId]?.dexPenalty || 0, "defense");

    const attackerSuccesses = exchange.attackerSelectedDice.filter(idx => this._isDieSuccess(attacker, idx, attackerTarget)).length;
    const defenderSuccesses = exchange.defenderSelectedDice.filter(idx => this._isDieSuccess(defender, idx, defenderTarget)).length;
    const netSuccesses = attackerSuccesses - defenderSuccesses;

    game.neuroshima?.log("Resolving opposedSuccesses exchange", {
      id, attacker: attacker.name, defender: defender.name, attackerSuccesses, defenderSuccesses, netSuccesses
    });

    let resultType;
    let logText;

    if (netSuccesses > 0) {
      const tier = Math.min(3, netSuccesses);
      resultType = "hit";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogOpposedSuccessesHit", {
        attacker: attacker.name,
        defender: defender.name,
        net: netSuccesses,
        tier
      });
      const locationDieIndex = exchange.locationDieIndex ?? exchange.attackerSelectedDice[0];
      await this.applyDamageDistributed(updated, attackerId, defenderId, [{ cost: tier, tier }], locationDieIndex);
    } else if (netSuccesses < 0) {
      const defenderAdvantage = Math.abs(netSuccesses);
      // MANEUVER — Pełna obrona: defender needs a net advantage of ≥2 successes to take over.
      const takeoverRequired = (defender.maneuver === "fullDefense") ? 2 : 1;

      if (defenderAdvantage >= takeoverRequired) {
        resultType = "takeover";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogTakeover", { attacker: defender.name, oldAttacker: attacker.name });
        updated.turnState.initiativeOwnerId = defenderId;

        // MANEUVER — Furia: fury-user auto-takes a hit when they lose initiative.
        if (attacker.maneuver === "fury") {
          logText += " " + game.i18n.format("NEUROSHIMA.MeleeDuel.LogFuryHit", { name: defender.name });
          await this.applyDamage(updated, defenderId, attackerId, 1, exchange.defenderSelectedDice[0]);
        }
      } else {
        resultType = "block";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
      }
    } else {
      resultType = "block";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
    }

    updated.log.push({ type: resultType, turn: updated.turnState.turn, segment: updated.turnState.segment, text: logText });
    attacker.usedDice.push(...exchange.attackerSelectedDice);
    defender.usedDice.push(...exchange.defenderSelectedDice);
    updated.turnState.segmentCost = diceCount;
    updated.currentExchange = {
      attackerId: null, defenderId: null, declaredAction: null,
      declaredDiceCount: 0, attackerSelectedDice: [], defenderSelectedDice: [], resolutionType: "normal"
    };

    await this._advanceAfterExchange(id, updated);
  }

  /**
   * Computes all valid damage distributions for a given dice count.
   * D = 1 die, L = 2 dice, C = 3 dice.
   * Returns an array of options, each with { label, hits[] }.
   * @param {number} diceCount   Number of dice spent (1–3)
   * @param {object} attacker    Participant data (for weapon damage tier labels)
   */
  static _shiftDamageType(type, steps) {
    if (!steps) return type;
    const REGULAR = ["D", "L", "C", "K"];
    const BRUISE  = ["sD", "sL", "sC", "sK"];
    const track   = type?.startsWith("s") ? BRUISE : REGULAR;
    const idx     = track.indexOf(type);
    if (idx < 0) return type;
    return track[Math.min(Math.max(0, idx + steps), track.length - 1)];
  }

  /**
   * Like _shiftDamageType but returns null when the shift goes below the track minimum.
   * Used for blockDamageShift: D shifted by -1 returns null (= no damage), not "D".
   */
  static _shiftDamageTypeUnclamped(type, steps) {
    if (!steps) return type;
    const REGULAR = ["D", "L", "C", "K"];
    const BRUISE  = ["sD", "sL", "sC", "sK"];
    const track   = type?.startsWith("s") ? BRUISE : REGULAR;
    const idx     = track.indexOf(type);
    if (idx < 0) return type;
    const newIdx = idx + steps;
    if (newIdx < 0) return null;
    return track[Math.min(newIdx, track.length - 1)];
  }

  static _computeDamageOptions(diceCount, attacker) {
    // Read damage tier labels directly from weapon (damageMeleePreview is a UI-only enrichment)
    const doc = fromUuidSync(attacker.actorUuid);
    const actor = doc?.actor || doc;
    const weapon = actor?.items.get(attacker.weaponId);
    // Global shift applies to all tiers; per-tier shifts (damageShift1/2/3) stack on top.
    const shift = attacker.damageShift || 0;
    const s1 = shift + (attacker.damageShift1 || 0);
    const s2 = shift + (attacker.damageShift2 || 0);
    const s3 = shift + (attacker.damageShift3 || 0);
    let d1, d2, d3;
    if (weapon?.type === "beast-action") {
      const acts = weapon.system.activities ?? [];
      const getActDmg = (cost) => acts.find(a => a.successCost === cost && a.damage)?.damage ?? null;
      d1 = this._shiftDamageType(getActDmg(1) ?? "D", s1);
      d2 = this._shiftDamageType(getActDmg(2) ?? "D", s2);
      d3 = this._shiftDamageType(getActDmg(3) ?? "D", s3);
    } else {
      d1 = this._shiftDamageType(weapon?.system.damageMelee1 || "D", s1);
      d2 = this._shiftDamageType(weapon?.system.damageMelee2 || "L", s2);
      d3 = this._shiftDamageType(weapon?.system.damageMelee3 || "C", s3);
    }

    const tiers = [
      { cost: 1, tier: 1, label: d1 },
      { cost: 2, tier: 2, label: d2 },
      { cost: 3, tier: 3, label: d3 }
    ].filter(t => t.cost <= diceCount);

    // Generate all unique combinations via recursive partition
    const results = [];
    const seen = new Set();

    const recurse = (remaining, combo) => {
      if (remaining === 0) {
        const key = [...combo].sort((a, b) => b - a).join(",");
        if (!seen.has(key)) {
          seen.add(key);
          // Build hits list from combo (combo = array of tier costs)
          const sorted = [...combo].sort((a, b) => b - a);
          const hits = sorted.map(cost => tiers.find(t => t.cost === cost));
          // Build label: "1×C", "1×L + 1×D" etc.
          const counts = {};
          for (const t of hits) counts[t.label] = (counts[t.label] || 0) + 1;
          const label = Object.entries(counts)
            .map(([lbl, cnt]) => cnt > 1 ? `${cnt}×${lbl}` : lbl)
            .join(" + ");
          results.push({ label, hits });
        }
        return;
      }
      for (const t of tiers) {
        if (t.cost <= remaining) {
          combo.push(t.cost);
          recurse(remaining - t.cost, combo);
          combo.pop();
        }
      }
    };
    recurse(diceCount, []);
    return results;
  }

  /**
   * Applies a distributed damage sequence (multiple hits of varying tiers).
   * Each hit in `hits` is applied separately to allow different locations in the future.
   */
  static async applyDamageDistributed(encounter, attackerId, defenderId, hits, locationDieIndex) {
    const attacker = encounter.participants[attackerId];
    const defender = encounter.participants[defenderId];
    if (!attacker || !defender || !hits?.length) return;

    const attackerDoc = fromUuidSync(attacker.actorUuid);
    const defenderDoc  = fromUuidSync(defender.actorUuid);
    const attackerActor = attackerDoc?.actor || attackerDoc;
    const defenderActor  = defenderDoc?.actor  || defenderDoc;
    if (!attackerActor || !defenderActor) return;

    const weapon = attackerActor.items.get(attacker.weaponId);
    const isBeastActionWeapon = weapon?.type === "beast-action";
    const beastActionDamage = isBeastActionWeapon ? (weapon.system.damage || null) : undefined;
    const { CombatHelper } = await import("../helpers/combat-helper.js");

    const rawValue = attacker.pool[locationDieIndex];
    const location = this._getLocationFromRoll(rawValue);

    // Collect all wounds from all hits, then create ONE chat message.
    // NOTE: preApplyDamage and applyDamage attacker-side triggers fire inside
    // CombatHelper.applyDamageToActor (general — not melee-specific).
    const allResults = [];
    const allWoundIds = [];
    let totalReducedProjectiles = 0;
    const allReducedDetails = [];

    // Per-tier damage shifts (additive on top of the global damageShift).
    const _globalShift = attacker.damageShift || 0;
    const _s1 = _globalShift + (attacker.damageShift1 || 0);
    const _s2 = _globalShift + (attacker.damageShift2 || 0);
    const _s3 = _globalShift + (attacker.damageShift3 || 0);

    for (const hit of hits) {
      if (isBeastActionWeapon && !beastActionDamage) continue;
      let dmg1, dmg2, dmg3;
      if (isBeastActionWeapon) {
        dmg1 = this._shiftDamageType(beastActionDamage, _s1);
        dmg2 = this._shiftDamageType(beastActionDamage, _s2);
        dmg3 = this._shiftDamageType(beastActionDamage, _s3);
      } else {
        dmg1 = this._shiftDamageType(weapon?.system.damageMelee1, _s1);
        dmg2 = this._shiftDamageType(weapon?.system.damageMelee2, _s2);
        dmg3 = this._shiftDamageType(weapon?.system.damageMelee3, _s3);
      }

      const attackData = {
        isMelee: true,
        actorId: attackerActor.id,
        weaponId: attacker.weaponId,
        label: weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
        successPoints: hit.cost,
        finalLocation: location,
        damageMelee1: dmg1,
        damageMelee2: dmg2,
        damageMelee3: dmg3
      };

      const batchResult = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
        isOpposed: true, spDifference: hit.cost, location, suppressChat: true
      });
      if (batchResult) {
        allResults.push(...batchResult.results);
        allWoundIds.push(...batchResult.woundIds);
        totalReducedProjectiles += batchResult.reducedProjectiles;
        allReducedDetails.push(...batchResult.reducedDetails);
      }
    }

    // Single consolidated notification + chat message for all hits.
    if (allWoundIds.length > 0) {
      ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageApplied", {
        count: allWoundIds.length,
        name: defenderActor.name
      }));
    }
    if (allResults.length > 0 || totalReducedProjectiles > 0 || allWoundIds.length > 0) {
      await CombatHelper.renderPainResistanceReport(defenderActor, allResults, allWoundIds, totalReducedProjectiles, allReducedDetails);
    }

    const diceCount = hits.reduce((s, h) => s + (h.cost ?? 0), 0);
    await this._applyBeastActivityEffects(attackerActor, defenderActor, weapon, diceCount);
  }

  /**
   * Applies ActiveEffects linked to beast-action / beast-segment activities after a hit in mode 1.
   *
   * Matching rule:
   *  - beast-action  → activity.successCost === diceCount
   *  - beast-segment → activity.segmentCost  === diceCount
   *
   * Required-test branch (`activity.testRequired === true`):
   *   Does NOT apply effects directly. Instead posts a Required Test chat card. Success /
   *   failure effects are resolved from `effectIds` / `onFailureEffectIds` (item-local IDs →
   *   full UUIDs) and stored in the card flags. The card is whispered to the defender's
   *   owning player(s) and all GMs (`whisperToDefender: true`, `defenderActorUuid` locked).
   *
   * Direct-apply branch (`testRequired` absent / false):
   *   All effects in `effectIds` are created on the defender immediately. Effects that need
   *   a follow-up test should carry an `immediate` script calling `this.postRequiredTest({…})`.
   *
   * @param {Actor}  attackerActor
   * @param {Actor}  defenderActor
   * @param {Item}   weapon         The beast-action or beast-segment item used as weapon.
   * @param {number} diceCount      Total dice declared for the attack (= damage tier).
   * @private
   */
  static async _applyBeastActivityEffects(attackerActor, defenderActor, weapon, diceCount) {
    const wType = weapon?.type;
    if (wType !== "beast-action" && wType !== "beast-segment") return;
    if (!defenderActor) return;

    const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");

    for (const activity of (weapon.system.activities ?? [])) {
      const actCost = wType === "beast-action"
        ? (activity.successCost ?? 1)
        : (activity.segmentCost  ?? 1);
      if (actCost !== diceCount) continue;

      if (activity.testRequired) {
        const resolveUuids = (ids = []) =>
          ids.map(id => weapon.effects.get(id)).filter(Boolean).map(e => e.uuid);

        game.neuroshima?.log("[MeleeResolution._applyBeastActivityEffects] posting required test", { activityName: activity.name, testType: activity.testType, testKey: activity.testKey, defenderName: defenderActor?.name, defenderUuid: defenderActor?.uuid });
        await NeuroshimaScriptRunner.postRequiredTest({
          title:                 activity.name || weapon.name,
          testType:              activity.testType             || "attribute",
          testKey:               activity.testKey              || "constitution",
          testAttributeOverride: activity.testAttributeOverride || "",
          requiredSuccesses:     activity.testSuccesses        ?? 1,
          isOpen:                activity.testIsOpen           ?? false,
          baseDifficulty:        activity.testDifficulty       || "average",
          defenderActorUuid:     defenderActor?.uuid ?? "",
          whisperToDefender:     true,
          onSuccessEffectUuids:  resolveUuids(activity.effectIds),
          onFailureEffectUuids:  resolveUuids(activity.onFailureEffectIds)
        });
        continue;
      }

      for (const effectId of (activity.effectIds ?? [])) {
        const effect = weapon.effects.get(effectId);
        if (!effect) continue;
        try {
          const { _id, ...rest } = effect.toObject();
          await ActiveEffect.implementation.create(
            { ...rest, disabled: false, transfer: false, origin: weapon.uuid },
            { parent: defenderActor }
          );
        } catch (err) {
          console.error("Neuroshima | mode1 beast activity effect apply failed:", err);
        }
      }
    }
  }

  /**
   * Legacy single-tier damage helper kept for extra-attack resolution.
   * @private
   */
  static async applyDamage(encounter, attackerId, defenderId, diceCount, locationDieIndex) {
    const tier = { cost: diceCount, label: "" };
    await this.applyDamageDistributed(encounter, attackerId, defenderId, [tier], locationDieIndex);
  }

  /**
   * Helper to map raw roll to body location.
   * @private
   */
  static _getLocationFromRoll(roll) {
    if (roll <= 2) return "head";
    if (roll <= 4) return "rightArm";
    if (roll <= 6) return "leftArm";
    if (roll <= 15) return "torso";
    if (roll <= 17) return "rightLeg";
    return "leftLeg";
  }
}
/**
 * @file melee-store.js
 * @description Persistence layer for Neuroshima 1.5 Melee Encounters.
 *
 * All melee encounter state is stored in `game.combat` flags under the key
 * `neuroshima.meleeEncounters` as a map of `{ [encounterId]: EncounterData }`.
 *
 * State mutations from non-GM clients are routed through socketlib:
 * `game.neuroshima.socket.executeAsGM("updateCombatFlag", ...)` so that
 * only the GM actually writes to the Combat document.
 */
export class MeleeStore {
  /**
   * Retrieves all melee encounters from the active combat.
   */
  static getEncounters() {
    return game.combat?.getFlag("neuroshima", "meleeEncounters") || {};
  }

  /**
   * Retrieves a specific encounter by its ID.
   */
  static getEncounter(id) {
    const encounters = this.getEncounters();
    return encounters[id] || null;
  }

  /**
   * Updates an encounter. Uses socketlib if available to ensure GM permissions.
   */
  static async updateEncounter(id, data) {
    const combat = game.combat;
    if (!combat) return;

    const encounters = foundry.utils.deepClone(this.getEncounters());
    encounters[id] = data;

    if (game.user.isGM || !game.neuroshima.socket) {
      await combat.setFlag("neuroshima", "meleeEncounters", encounters);
    } else {
      await game.neuroshima.socket.executeAsGM("updateCombatFlag", "meleeEncounters", encounters);
    }
  }

  /**
   * Removes an encounter and cleans up participant flags.
   */
  static async removeEncounter(id) {
    const combat = game.combat;
    if (!combat) return;

    game.neuroshima?.log("removeEncounter | start", { id, isGM: game.user.isGM });

    // If not GM and socket available, delegate to GM to handle cross-actor flag cleanup
    if (!game.user.isGM && game.neuroshima.socket) {
      return game.neuroshima.socket.executeAsGM("removeMeleeEncounter", id);
    }

    const encounter = this.getEncounter(id);
    if (!encounter) {
        game.neuroshima?.warn("removeEncounter | encounter not found in flags", { id });
        return;
    }

    // Clear flags on all participants (GM can do this for any actor)
    for (const p of Object.values(encounter.participants)) {
      try {
        const doc = fromUuidSync(p.actorUuid);
        const actor = doc?.actor || doc;
        if (actor) {
            await actor.unsetFlag("neuroshima", "activeMeleeEncounter");
            game.neuroshima?.log(`removeEncounter | cleared flag for actor ${actor.name}`);
        }
      } catch (e) {
        console.warn(`Neuroshima | Failed to unset flag for participant ${p.name}`, e);
      }
    }

    // Use unsetFlag for specific key deletion
    await combat.unsetFlag("neuroshima", `meleeEncounters.${id}`);
    game.neuroshima?.log("removeEncounter | encounter deleted via unsetFlag");

    ui.combat?.render(true);
  }

  /**
   * Cleans up all melee pendings.
   */
  static async clearAllPendings() {
    const combat = game.combat;
    if (!combat) return;

    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("unsetCombatFlag", "meleePendings");
    } else {
        await combat.unsetFlag("neuroshima", "meleePendings");
    }
    ui.combat?.render(true);
  }

  /**
   * Removes a specific melee pending.
   */
  static async removePending(pendingUuid) {
    const combat = game.combat;
    if (!combat || !pendingUuid) return;

    game.neuroshima?.log("removePending | start", { pendingUuid, isGM: game.user.isGM });

    if (!game.user.isGM && game.neuroshima.socket) {
        return game.neuroshima.socket.executeAsGM("removeMeleePending", pendingUuid);
    }

    const pendingKey = pendingUuid.replace(/\./g, "-");
    
    // Use unsetFlag for specific key deletion
    await combat.unsetFlag("neuroshima", `meleePendings.${pendingKey}`);
    game.neuroshima?.log("removePending | pending deleted via unsetFlag");
    
    ui.combat?.render(true);
  }
}
/**
 * Chat-based renderer for Neuroshima 1.5 vanilla melee encounters.
 *
 * Replaces MeleeCombatApp (the floating 780×540 window) for the default
 * ("vanilla") melee combat type. One ChatMessage per active encounter is
 * created and re-rendered automatically whenever the encounter state changes.
 *
 * Flow:
 *  1. MeleeEncounter.create() → MeleeTurnCard.post(encounterId)
 *     → ChatMessage posted, message ID stored in combat flags
 *  2. Any state change (setPool, selectDie, confirmAttack, …)
 *     → MeleeStore.updateEncounter() → combat.setFlag()
 *     → updateCombat hook → MeleeTurnCard.updateAll() (GM only)
 *     → ChatMessage.update({ content }) → all clients see new state
 *  3. Client interaction (button click) → renderChatMessageHTML → onRender()
 *     → event listeners bound → calls MeleeTurnService.* / opens dialog
 */
export class MeleeTurnCard {
  static TEMPLATE = "systems/neuroshima/templates/chat/melee-turn-card.hbs";
  static FLAG_KEY = "meleeTurnCards";

  static _debouncedUpdate = null;

  // ── Public lifecycle ────────────────────────────────────────────────────

  /**
   * Post a new ChatMessage for an encounter.
   * The message ID is persisted in combat flags so it can be found later.
   *
   * @param {string} encounterId
   * @returns {Promise<ChatMessage|null>}
   */
  static async post(encounterId) {
    const encounter = MeleeStore.getEncounter(encounterId);
    if (!encounter) return null;

    const content = await this._render(encounter);
    const message = await ChatMessage.create({
      content,
      flags: { neuroshima: { meleeTurnCard: encounterId } },
      speaker: { alias: "⚔ Walka Wręcz" }
    });
    if (!message) return null;

    await this._storeMessageId(encounterId, message.id);
    return message;
  }

  /**
   * Re-render an existing card with the current encounter state.
   * When the encounter no longer exists, removes the card flag (leaves message as history).
   *
   * @param {string} encounterId
   */
  static async update(encounterId) {
    const messageId = this._getMessageId(encounterId);
    if (!messageId) return;

    const message = game.messages.get(messageId);
    if (!message) {
      await this._removeFlag(encounterId);
      return;
    }

    const encounter = MeleeStore.getEncounter(encounterId);
    if (!encounter) {
      await this._removeFlag(encounterId);
      return;
    }

    const content = await this._render(encounter);
    await message.update({ content });
  }

  /**
   * Re-render all active melee turn cards.
   * Should only be called on the GM client (authority for ChatMessage updates).
   *
   * @param {Combat} combat
   */
  static async updateAll(combat) {
    const cards = combat.getFlag("neuroshima", this.FLAG_KEY) || {};
    for (const encounterId of Object.keys(cards)) {
      await this.update(encounterId);
    }
  }

  // ── Client-side rendering hook ──────────────────────────────────────────

  /**
   * Called from the renderChatMessageHTML hook.
   * Binds event listeners and applies per-user visibility.
   *
   * @param {HTMLElement} root    Chat message root element
   * @param {ChatMessage} message Foundry chat message document
   */
  static onRender(root, message) {
    const encounterId = message.getFlag("neuroshima", "meleeTurnCard");
    if (!encounterId) return;

    // ── Visibility: disable interactive elements for non-owners ───────────
    root.querySelectorAll("[data-melee-owner]").forEach(el => {
      const ownerUuid = el.dataset.meleeOwner;
      if (!ownerUuid) return;
      const doc = fromUuidSync(ownerUuid);
      const actor = doc?.actor || doc;
      const canInteract = game.user.isGM || (actor?.isOwner);
      if (!canInteract) {
        if (el.tagName === "BUTTON") {
          el.disabled = true;
          el.classList.add("is-disabled");
          el.style.opacity = "0.35";
          el.style.pointerEvents = "none";
        } else if (el.tagName === "SELECT") {
          el.disabled = true;
        } else {
          el.style.opacity = "0.35";
          el.style.pointerEvents = "none";
        }
      }
    });

    // ── Action buttons (data-melee-action) ────────────────────────────────
    root.querySelectorAll("[data-melee-action]").forEach(btn => {
      btn.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const action = btn.dataset.meleeAction;
        await MeleeTurnCard._handleAction(action, btn, encounterId);
      });
    });

    // ── Weapon change select ──────────────────────────────────────────────
    root.querySelectorAll(".mtc-weapon-select").forEach(sel => {
      sel.addEventListener("change", async ev => {
        const participantId = ev.currentTarget.dataset.participantId;
        const weaponId = ev.currentTarget.value;
        if (participantId && weaponId) {
          await MeleeTurnService.setWeapon(encounterId, participantId, weaponId);
        }
      });
    });

    // ── Target change select ──────────────────────────────────────────────
    root.querySelectorAll(".mtc-target-select").forEach(sel => {
      sel.addEventListener("change", async ev => {
        const participantId = ev.currentTarget.dataset.participantId;
        const targetId = ev.currentTarget.value;
        if (participantId && targetId) {
          await MeleeTurnService.setTarget(encounterId, participantId, targetId);
        }
      });
    });
  }

  // ── Hook registration ───────────────────────────────────────────────────

  /**
   * Register the updateCombat hook that re-renders active cards.
   * Uses debouncing to prevent excessive re-renders during rapid state changes.
   */
  static registerHooks() {
    MeleeTurnCard._debouncedUpdate = foundry.utils.debounce(async () => {
      if (!game.user.isGM) return;
      if (game.combat) await MeleeTurnCard.updateAll(game.combat);
    }, 300);

    Hooks.on("updateCombat", (combat, updates) => {
      if (!foundry.utils.hasProperty(updates, "flags.neuroshima.meleeEncounters")) return;
      MeleeTurnCard._debouncedUpdate();
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Render the template with the current encounter state.
   * @private
   */
  static async _render(encounter) {
    const context = this._buildContext(encounter);
    return foundry.applications.handlebars.renderTemplate(this.TEMPLATE, context);
  }

  /**
   * Store the message ID for an encounter in combat flags.
   * @private
   */
  static async _storeMessageId(encounterId, messageId) {
    const combat = game.combat;
    if (!combat) return;
    const cards = foundry.utils.deepClone(combat.getFlag("neuroshima", this.FLAG_KEY) || {});
    cards[encounterId] = messageId;
    if (game.user.isGM || !game.neuroshima?.socket) {
      await combat.setFlag("neuroshima", this.FLAG_KEY, cards);
    } else {
      await game.neuroshima.socket.executeAsGM("updateCombatFlag", this.FLAG_KEY, cards);
    }
  }

  /**
   * Remove the message ID flag for an encounter (called when encounter ends).
   * Leaves the ChatMessage in chat as a read-only summary.
   * @private
   */
  static async _removeFlag(encounterId) {
    const combat = game.combat;
    if (!combat) return;
    await combat.unsetFlag("neuroshima", `${this.FLAG_KEY}.${encounterId}`);
  }

  /**
   * Get the ChatMessage ID for an encounter.
   * @private
   */
  static _getMessageId(encounterId) {
    return game.combat?.getFlag("neuroshima", this.FLAG_KEY)?.[encounterId] ?? null;
  }

  /**
   * Build template context from encounter data.
   * All heavy lifting mirrors MeleeCombatApp._prepareContext but
   * is server-side (called from GM during updateAll).
   * @private
   */
  static _buildContext(encounter) {
    const context = foundry.utils.deepClone(encounter);

    const phase = context.turnState.phase;
    const selectionTurn = context.turnState.selectionTurn;
    const exchange = context.currentExchange;
    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");

    for (const pId in context.participants) {
      const p = context.participants[pId];
      p.id = pId;

      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;

      const weapon = actor?.items.get(p.weaponId);
      p.weaponName = weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed");

      // Weapon list for dropdown (shown when pool not yet rolled)
      if (actor) {
        const meleeItems = (actor.items || []).filter(i =>
          i.type === "weapon" && i.system.weaponType === "melee" && i.system.equipped
        );
        p.meleeWeapons = meleeItems.map(w => ({ id: w.id, name: w.name, isCurrent: w.id === p.weaponId }));
        if (!p.meleeWeapons.some(w => w.id === p.weaponId) && weapon) {
          p.meleeWeapons.unshift({ id: p.weaponId, name: weapon.name, isCurrent: true });
        }
      } else {
        p.meleeWeapons = [];
      }

      // Target display name
      const targetId = context.primaryTargets[pId];
      p.targetName = context.participants[targetId]?.name || "";

      // Crowding
      const crowd = context.crowding[pId];
      p.isCrowded = crowd?.opponentCount > 1;
      p.dexPenalty = crowd?.dexPenalty || 0;

      // Effective target values (attack vs defense)
      const atkSnap = p.attackTargetSnapshot != null ? p.attackTargetSnapshot : (p.targetValue ?? 10);
      const defSnap = p.defenseTargetSnapshot != null ? p.defenseTargetSnapshot : (p.targetValue ?? 10);
      p.attackTarget = atkSnap - p.dexPenalty;
      p.defenseTarget = defSnap - p.dexPenalty;

      const isAttackerContext = pId === exchange.attackerId ||
        (phase === "primary-attack-selection" && pId === selectionTurn) ||
        phase === "awaiting-pool-rolls" || phase === "target-selection";
      p.currentEffectiveTarget = isAttackerContext ? p.attackTarget : p.defenseTarget;

      // Die selection index tracking
      p.selectedDiceIndices = [];
      if (phase === "primary-attack-selection" && pId === selectionTurn) {
        p.selectedDiceIndices = exchange.attackerSelectedDice || [];
      } else if (phase === "primary-defense-selection" && pId === exchange.defenderId) {
        p.selectedDiceIndices = exchange.defenderSelectedDice || [];
      } else if (pId === exchange.attackerId) {
        p.selectedDiceIndices = exchange.attackerSelectedDice || [];
      } else if (pId === exchange.defenderId) {
        p.selectedDiceIndices = exchange.defenderSelectedDice || [];
      }

      // Build effectivePool — same logic as MeleeCombatApp._prepareContext
      const mp = p.modifiedPool;
      const dr = p.dieResults;

      if (doubleSkill && p.pool.length > 0) {
        const selfSpent = (p.selfReductions || []).reduce((a, b) => a + b, 0);
        const oppSpent = Object.values(p.spentOnOpponent || {})
          .reduce((sum, arr) => sum + arr.reduce((a, b) => a + b, 0), 0);
        p.skillRemaining = (p.skillBudget || 0) - selfSpent - oppSpent;
        p.isAllocationPhase = true;

        p.effectivePool = p.pool.map((v, i) => {
          const reduction = (p.selfReductions || [])[i] || 0;
          const gain = (p.opponentGains || [])[i] || 0;
          const effective = v - reduction + gain;
          const isNat20 = v === 20;
          const isSuccess = !isNat20 && effective <= p.currentEffectiveTarget;
          return { raw: v, effective, isSuccess, isNat20, index: i };
        });
      } else {
        p.skillRemaining = 0;
        p.isAllocationPhase = false;

        p.effectivePool = (p.pool || []).map((v, i) => {
          const effective = mp && mp[i] !== undefined ? mp[i] : v;
          const isNat20 = v === 20;
          const isSuccess = dr
            ? (dr[i]?.isSuccess ?? false)
            : (!isNat20 && effective <= p.currentEffectiveTarget);
          return { raw: v, effective, isSuccess, isNat20, index: i };
        });
      }

      // Damage preview from weapon
      const pWeapon = actor?.items.get(p.weaponId);
      p.damageMeleePreview = {
        s1: pWeapon?.system?.damageMelee1 || "D",
        s2: pWeapon?.system?.damageMelee2 || "L",
        s3: pWeapon?.system?.damageMelee3 || "C"
      };

      // Phase-specific state flags used in the template
      p.isInitiativeOwner = pId === context.turnState.initiativeOwnerId;
      p.needsPool = p.pool.length === 0 && phase === "awaiting-pool-rolls";
      p.isAttacking = phase === "primary-attack-selection" && pId === selectionTurn;
      p.isDefending = phase === "primary-defense-selection" && pId === exchange.defenderId;

      if (p.isAttacking) {
        p.pendingDiceCount = exchange.attackerSelectedDice.length;
      }
      if (p.isDefending) {
        p.declaredCount = exchange.declaredDiceCount;
        p.selectedDefenseCount = exchange.defenderSelectedDice.length;
      }
    }

    // Teams sorted by initiative descending
    context.teamsData = {
      A: (context.teams.A || []).map(id => context.participants[id]).filter(Boolean)
        .sort((a, b) => (b.initiative || 0) - (a.initiative || 0)),
      B: (context.teams.B || []).map(id => context.participants[id]).filter(Boolean)
        .sort((a, b) => (b.initiative || 0) - (a.initiative || 0))
    };

    // Segment progress dots
    const currentSeg = context.turnState.segment || 1;
    context.segmentDots = [1, 2, 3].map(i => ({
      number: i,
      state: i < currentSeg ? "done" : i === currentSeg ? "active" : "pending"
    }));

    context.initiativeOwnerName = context.participants[context.turnState.initiativeOwnerId]?.name || "---";
    context.phaseLabel = this._getPhaseLabel(phase);

    // Last 4 log entries, most recent first
    context.recentLog = (context.log || []).slice(-4).reverse();

    // Pending damage distribution
    context.pendingDamage = encounter.pendingDamage || null;

    return context;
  }

  /**
   * Returns a localized label for the current phase.
   * @private
   */
  static _getPhaseLabel(phase) {
    const map = {
      "awaiting-pool-rolls": "NEUROSHIMA.MeleeDuel.Phase.AwaitingPoolRolls",
      "target-selection": "NEUROSHIMA.MeleeDuel.Phase.TargetSelection",
      "primary-attack-selection": "NEUROSHIMA.MeleeDuel.Phase.AttackSelection",
      "primary-defense-selection": "NEUROSHIMA.MeleeDuel.Phase.DefenseSelection",
      "damage-selection": "NEUROSHIMA.MeleeDuel.Phase.DamageSelection",
      "segment-end": "NEUROSHIMA.MeleeDuel.Phase.SegmentEnd"
    };
    return game.i18n.localize(map[phase] || phase);
  }

  // ── Action dispatch ─────────────────────────────────────────────────────

  /**
   * Handle a melee turn card action button click.
   * @private
   */
  static async _handleAction(action, btn, encounterId) {
    switch (action) {
      case "rollPool":
        await MeleeTurnCard._doRollPool(btn, encounterId);
        break;

      case "selectDie":
        await MeleeTurnService.selectDie(
          encounterId,
          btn.dataset.participantId,
          parseInt(btn.dataset.index, 10)
        );
        break;

      case "confirmAttack":
        await MeleeTurnService.confirmAttack(encounterId, btn.dataset.participantId);
        break;

      case "confirmDefense":
        await MeleeTurnService.confirmDefense(encounterId, btn.dataset.participantId);
        break;

      case "performAction":
        await MeleeTurnService.performAction(encounterId, btn.dataset.participantId);
        break;

      case "confirmDamage": {
        await MeleeResolution.confirmDamageDistribution(encounterId, parseInt(btn.dataset.optionIndex, 10));
        break;
      }

      case "endEncounter": {
        await MeleeEncounter.end(encounterId);
        break;
      }

      case "nextTurn":
        await MeleeTurnService.startNewTurn(encounterId);
        break;

      case "prevTurn":
        await MeleeTurnService.prevTurn(encounterId);
        break;

      case "nextSegment": {
        const enc = MeleeStore.getEncounter(encounterId);
        if (enc) await MeleeTurnService.setSegment(encounterId, (enc.turnState.segment || 1) + 1);
        break;
      }

      case "prevSegment": {
        const enc = MeleeStore.getEncounter(encounterId);
        if (enc) await MeleeTurnService.setSegment(encounterId, (enc.turnState.segment || 1) - 1);
        break;
      }

      case "resetSkill":
        await MeleeTurnService.resetSkillAllocation(encounterId, btn.dataset.participantId);
        break;
    }
  }

  /**
   * Open the 3k20 weapon-roll dialog for a participant.
   * Replicates the logic of MeleeCombatApp._onOpenPoolDialog but triggers from the chat card.
   * @private
   */
  static async _doRollPool(btn, encounterId) {
    const participantId = btn.dataset.participantId;
    const encounter = MeleeStore.getEncounter(encounterId);
    const p = encounter?.participants[participantId];
    if (!p) return;

    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;

    if (!actor?.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NotYourFighter"));
      return;
    }

    const weapon = actor?.items.get(p.weaponId);
    const crowd = encounter?.crowding?.[participantId];
    const crowdingDexPenalty = crowd?.dexPenalty || 0;

    const isFirstTurn = (encounter?.turnState?.turn ?? 1) === 1;
    const hasInitiative = encounter?.turnState?.initiativeOwnerId === participantId;
    const chargeDexPenalty = (isFirstTurn && !hasInitiative && (p.chargeLevel ?? 0) > 0)
      ? (p.chargeLevel ?? 0) : 0;

    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");

    const dialog = new NeuroshimaWeaponRollDialog({
      actor,
      weapon,
      rollType: "melee",
      isPoolRoll: true,
      crowdingDexPenalty,
      chargeDexPenalty,
      onClose: () => {},
      onRoll: async (rollResult) => {
        game.neuroshima?.log("[melee-turn-card.onRoll] callback fired", { encounterId, participantId, maneuver: rollResult?.maneuver, tempoLevel: rollResult?.tempoLevel });
        if (!rollResult) return;
        await MeleeTurnService.setPool(encounterId, participantId, rollResult);
      }
    });

    dialog.render(true);
  }
}

/**
 * @file melee-turn-service.js
 * @description All state-transition logic for Neuroshima 1.5 Melee Encounters.
 *
 * ### Phase state machine
 * ```
 * awaiting-pool-rolls
 *   → target-selection        (multi-fight only; skipped in 1v1)
 *   → primary-attack-selection
 *   → primary-defense-selection
 *   → primary-ready           (triggers MeleeResolution.resolvePrimaryExchange)
 *   → segment-end             (segment advances or turn ends)
 *   → awaiting-pool-rolls     (next turn — pools reset)
 * ```
 *
 * ### Key rules
 * - Attacking with N dice costs N segments (segment pointer advances by N after resolution).
 * - Segments run 1–3; when all 3 are exhausted the turn ends and pools reset.
 * - In multi-fight, crowding applies a dexterity penalty per extra attacker.
 * - `doubleSkillAction` ON: skill budget is allocated manually via `allocateSkill()`.
 *   `doubleSkillAction` OFF: `_evaluateClosedTest` auto-applies skill during pool roll.
 */
/**
 * Handles turn transitions, segment resets, and maneuver application for Melee Encounters.
 */
export class MeleeTurnService {
  /**
   * Maps maneuver string values (from pool-roll dialog) to their condition key.
   * Tempo and Szarża are tracked separately via tempoLevel / chargeLevel.
   */
  static _MANEUVER_TO_CONDITION = {
    fury:         "maneuver-fury",
    furia:        "maneuver-fury",
    fullDefense:  "maneuver-full-defense",
    pelnaObrona:  "maneuver-full-defense"
  };

  /** All 4 maneuver condition keys — used for bulk-removal. */
  static _MANEUVER_CONDITION_KEYS = [
    "maneuver-pace",
    "maneuver-charge",
    "maneuver-fury",
    "maneuver-full-defense"
  ];

  /**
   * Removes all 4 maneuver conditions from an actor.
   * Silently skips actors the caller does not own (cosmetic conditions only).
   * @param {Actor} actor
   */
  static async _clearManeuverConditions(actor) {
    if (!actor) return;
    if (!game.user.isGM && !actor.isOwner) return;
    const keysToRemove = new Set(this._MANEUVER_CONDITION_KEYS);
    const toDelete = actor.effects
      .filter(e => [...(e.statuses || [])].some(s => keysToRemove.has(s)))
      .map(e => e.id);
    game.neuroshima?.log("[MeleeTurnService._clearManeuverConditions]", { name: actor.name, effectsFound: toDelete.length, toDelete });
    if (toDelete.length > 0) {
      try { await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete); } catch { /* noop */ }
    }
  }

  /**
   * Syncs all maneuver conditions for one participant after setPool.
   *
   * MANEUVER condition rules:
   *
   * • Furia / Fury (maneuver-fury):
   *   Boolean condition.  Applied to the participant who declared "fury" in the pool dialog.
   *   Rule effect (+2 Zręczność in attack) is already baked into attackTargetSnapshot via
   *   rollWeaponTest.  The condition is cosmetic/informational for the token HUD and scripts.
   *
   * • Pełna obrona / Full Defense (maneuver-full-defense):
   *   Boolean condition.  Applied to the participant who declared "fullDefense".
   *   Rule effect (+2 Zręczność in defense, 2-success takeover requirement) is enforced in
   *   defenseTargetSnapshot (via rollWeaponTest) and in getEffectiveTarget / resolution code.
   *
   * • Szarża / Charge (maneuver-charge):
   *   Boolean condition.  Applied when `participant.chargeLevel > 0` (set during initiative roll).
   *   NOTE — chargeLevel tracks the bonus declared at initiative time (+1..+3 to Zręczność on
   *   the initiative test).  Rule: the SAME value becomes a PENALTY on the first pool roll if the
   *   charge user LOSES the initiative test.  Enforcement of that penalty and the restriction
   *   "cannot use defensive maneuvers on the first turn" is currently left to the pool-roll dialog
   *   and is NOT automatically enforced by this code.
   *   chargeLevel is reset to 0 at startNewTurn so the condition only appears on turn 1.
   *
   * • Zwiększone tempo / Increased Pace (maneuver-pace):
   *   Int condition (stores the effective tempo level, 1–3).  Applied to BOTH the participant
   *   AND their primary opponent because the rule raises the PT for both combatants equally.
   *   `effectiveTempo = Math.max(all participants' tempoLevel)` ensures consistency even if
   *   both sides declare the maneuver.
   *
   * @param {object} encounter     Full (updated) encounter data from MeleeStore.
   * @param {string} participantId ID of the participant who just called setPool.
   */
  static async _applyParticipantManeuverConditions(encounter, participantId) {
    const p = encounter.participants[participantId];
    if (!p) return;

    // Tempo is a shared effect — always take the max across all active participants.
    const effectiveTempo = Math.max(
      0, ...Object.values(encounter.participants).map(q => q.tempoLevel ?? 0)
    );

    game.neuroshima?.log("[MeleeTurnService._applyParticipantManeuverConditions] start", {
      participantId, name: p.name, maneuver: p.maneuver, tempoLevel: p.tempoLevel,
      chargeLevel: p.chargeLevel, effectiveTempo, tokenUuid: p.tokenUuid, actorUuid: p.actorUuid
    });

    // Always route through GM socket so conditions are applied regardless of which
    // client triggered setPool (player may not own the opponent actor).
    const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");

    const _syncOne = async (participant) => {
      const condKey = this._MANEUVER_TO_CONDITION[participant.maneuver] || null;
      const hasCharge = (participant.chargeLevel ?? 0) > 0;
      const resolveUuid = participant.tokenUuid ?? participant.actorUuid;
      game.neuroshima?.log("[MeleeTurnService._syncOne] dispatching socket", {
        name: participant.name, resolveUuid, condKey, hasCharge, effectiveTempo
      });
      await NeuroshimaSocket.gmExecute(
        "syncActorManeuverConditions",
        resolveUuid, condKey, hasCharge, effectiveTempo
      );
    };

    await _syncOne(p);

    // Push conditions to the primary opponent as well — tempo raises PT for BOTH.
    // primaryTargets may be null at the start of turn 2+ (reset by startNewTurn before
    // allRolled re-fills them), so fall back to the teams structure for 1v1 encounters.
    let opponentId = encounter.primaryTargets?.[participantId] ?? null;
    if (!opponentId) {
      const myParticipant = encounter.participants[participantId];
      if (myParticipant) {
        const opposingTeam = myParticipant.team === "A" ? "B" : "A";
        const opponents = (encounter.teams[opposingTeam] || []).filter(id => encounter.participants[id]?.isActive);
        if (opponents.length === 1) opponentId = opponents[0];
      }
    }
    const opponent = opponentId ? encounter.participants[opponentId] : null;
    game.neuroshima?.log("[MeleeTurnService._applyParticipantManeuverConditions] opponent", {
      opponentId, opponentName: opponent?.name ?? null
    });
    if (opponent) await _syncOne(opponent);
  }

  /**
   * Returns whether the encounter needs manual target selection (multi-fight).
   * @private
   */
  static _isMultiFight(encounter) {
    const activeA = (encounter.teams.A || []).filter(id => encounter.participants[id]?.isActive).length;
    const activeB = (encounter.teams.B || []).filter(id => encounter.participants[id]?.isActive).length;
    return (activeA + activeB) > 2;
  }

  /**
   * Resets the encounter state for a new turn.
   */
  static async startNewTurn(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    updated.turnState.turn += 1;
    updated.turnState.segment = 1;
    updated.turnState.segmentCost = 0;
    updated.turnState.selectionTurn = null;
    updated._effects = {};

    // Reset pool data for all participants
    for (const pId in updated.participants) {
      const p = updated.participants[pId];
      p.pool = [];
      p.modifiedPool = null;
      p.skillBudget = 0;
      p.selfReductions = [];
      p.opponentGains = [];
      p.spentOnOpponent = {};
      p.usedDice = [];
      p.skillSpent = 0;
      p.maneuver = "none";
      p.tempoLevel = 0;
      p.chargeLevel = 0;
      p.attackTargetSnapshot = null;
      p.defenseTargetSnapshot = null;
    }

    // Reset primary targets
    for (const pId in updated.participants) {
      updated.primaryTargets[pId] = null;
    }

    // Build initiative order for the new turn
    const sortedIds = Object.values(updated.participants)
      .filter(p => p.isActive)
      .sort((a, b) => b.initiative - a.initiative)
      .map(p => p.id);
    updated.turnState.initiativeOrder = sortedIds;

    updated.log.push({
      type: "system",
      segment: 1,
      text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogNewTurn", { turn: updated.turnState.turn })
    });

    if (this._isMultiFight(updated)) {
      updated.turnState.phase = "target-selection";
      updated.turnState.selectionTurn = sortedIds[0];
      this.updateCrowding(updated);
      this._advanceTargetSelection(updated);
    } else {
      // 1v1: auto-set targets
      const [aId, bId] = sortedIds;
      if (aId && bId) {
        updated.primaryTargets[aId] = bId;
        updated.primaryTargets[bId] = aId;
      }
      this.updateCrowding(updated);
      updated.turnState.phase = "awaiting-pool-rolls";
    }

    game.neuroshima?.log("Starting new turn for melee encounter", { id, turn: updated.turnState.turn });
    await NeuroshimaScriptRunner.runMeleeUpdate(id, updated, "turn-start");
    await MeleeStore.updateEncounter(id, updated);

    // MANEUVER — Conditions persist across turns within the same encounter.
    // They are NOT cleared here — they remain visible on token HUDs until the
    // entire encounter ends (MeleeEncounter.end).  When a participant rolls their
    // pool for the new turn, _applyParticipantManeuverConditions (called from setPool)
    // will idempotently update conditions to reflect the newly chosen maneuver.
    // NOTE: chargeLevel is reset to 0 above, so maneuver-charge will be removed from
    // the actor automatically by syncActorManeuverConditions on the next pool roll.
  }

  /**
   * Sets the 3k20 pool for a participant and snapshots their combat target values for the turn.
   *
   * @param {string} id            Encounter ID
   * @param {string} participantId Participant ID
   * @param {object} rollResult    Raw result object from NeuroshimaWeaponRollDialog.onRoll / onPoolRoll.
   *   Recognised fields:
   *   - results              {number[]}   Raw dice [d1,d2,d3]
   *   - modifiedResults      {object[]}   Per-die objects with `.modified`, `.original`, `.isSuccess`
   *   - maneuver             {string}     "none"|"fury"|"fullDefense"|…
   *   - tempoLevel           {number}
   *   - attributeBonus       {number}
   *   - skill                {number}     Skill budget (doubleSkill ON)
   *   - target               {number}     Exact roll target from rollWeaponTest
   *   - meleeAction          {string}     "attack"|"defense"
   *   - damageShift          {number}
   *   - damageShift1/2/3     {number}
   *   - activatedMeleePreRollMods {string[]} UUIDs of effects activated via dialog tricks
   */
  static async setPool(id, participantId, rollResult) {
    const toNum = r => typeof r === "object" ? (r.value ?? r.result ?? r.original ?? Number(r)) : Number(r);
    const results       = (rollResult.results || []).map(toNum);
    const modifiedPool  = (rollResult.modifiedResults || []).map(r =>
      typeof r === "object" ? toNum({ value: r.modified ?? r.original }) : toNum(r)
    );
    const dieResults    = (rollResult.modifiedResults || []).map(r => ({
      isSuccess: typeof r === "object" ? (r.isSuccess ?? false) : false,
      isNat20:   typeof r === "object" ? (r.original === 20) : false
    }));
    const maneuver      = rollResult.maneuver || "none";
    const tempoLevel    = rollResult.tempoLevel || 0;
    const attributeBonus = rollResult.attributeBonus || 0;
    const skillBudget   = rollResult.skill ?? 0;
    const rollTarget    = typeof rollResult.target === "number" ? rollResult.target : null;
    const meleeAction   = rollResult.meleeAction || "attack";
    const damageShift   = rollResult.damageShift || 0;
    const damageShift1  = rollResult.damageShift1 || 0;
    const damageShift2  = rollResult.damageShift2 || 0;
    const damageShift3  = rollResult.damageShift3 || 0;
    const activatedTricks = rollResult.activatedMeleePreRollMods || [];

    game.neuroshima?.log("[MeleeTurnService.setPool] called", { id, participantId, maneuver, tempoLevel, meleeAction, results, activatedTricks });
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) {
      game.neuroshima?.log("[MeleeTurnService.setPool] encounter not found, aborting", { id });
      return;
    }

    const updated = foundry.utils.deepClone(encounter);
    const p = updated.participants[participantId];
    if (!p) {
      game.neuroshima?.log("[MeleeTurnService.setPool] participant not found, aborting", { participantId, available: Object.keys(updated.participants) });
      return;
    }

    // Fetch actor to read weapon bonuses for snapshot
    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    
    if (actor) {
      const weapon = actor.items.get(p.weaponId);
      const attribute = weapon?.system.attribute || "dexterity";
      const baseTarget = actor.system.attributeTotals?.[attribute] || 10;

      p.targetValue = baseTarget;
      p.attackBonusSnapshot = weapon?.system.attackBonus || 0;
      p.defenseBonusSnapshot = weapon?.system.defenseBonus || 0;

      // ── increasedTempo guard ────────────────────────────────────────────
      // rollWeaponTest bakes the tempo difficulty-shift into its returned
      // target value (via effectiveDifficulty → basePenalty → totalPenalty →
      // getDifficultyFromPercent → finalDiff.mod).  getEffectiveTarget() then
      // re-applies the shift a second time.  To avoid this double-count we
      // deliberately fall through to the approximate fallback when the roll was
      // made with increasedTempo.  The fallback snapshot contains NO tempo
      // shift, so getEffectiveTarget() applies it exactly once — which is the
      // correct behaviour (both participants pay the same raised PT).
      const _usePreferred = rollTarget !== null && rollTarget !== undefined
        && maneuver !== "increasedTempo";

      if (_usePreferred) {
        // ── Preferred path ─────────────────────────────────────────────────
        // Use the exact target that rollWeaponTest computed (correctly converts
        // % armor/wound penalties → difficulty mod, adds weapon bonus, etc.)
        // The roll was made for one action (attack or defense); derive the other
        // by swapping the weapon bonus component AND correcting for the maneuver
        // bonus that only applies to one action direction:
        //   fury      → +2 on attack only  (subtract 2 when deriving defense from attack roll,
        //                                   add 2 when deriving attack from defense roll)
        //   fullDefense → +2 on defense only (subtract 2 when deriving attack from defense roll,
        //                                     add 2 when deriving defense from attack roll)
        if (meleeAction === "defense") {
          p.defenseTargetSnapshot = rollTarget;
          const maneuverCorrection = (maneuver === "fullDefense") ? -2
            : (maneuver === "fury" || maneuver === "furia") ? 2 : 0;
          p.attackTargetSnapshot = rollTarget - p.defenseBonusSnapshot + p.attackBonusSnapshot + maneuverCorrection;
        } else {
          p.attackTargetSnapshot = rollTarget;
          const maneuverCorrection = (maneuver === "fury" || maneuver === "furia") ? -2
            : (maneuver === "fullDefense") ? 2 : 0;
          p.defenseTargetSnapshot = rollTarget - p.attackBonusSnapshot + p.defenseBonusSnapshot + maneuverCorrection;
        }
      } else {
        // ── Fallback (no target passed, or increasedTempo) ─────────────────
        // Approximate from actor state. NOTE: this can be inaccurate when armor/
        // wound penalties are present because totalArmorPenalty is a percentage
        // that must be converted via getDifficultyFromPercent, not subtracted directly.
        // For increasedTempo: tempo is intentionally NOT included here — it will
        // be applied by getEffectiveTarget() during exchange resolution so that
        // BOTH participants (attacker AND defender) pay the raised PT equally.
        const armorPenalty = actor.system.combat?.totalArmorPenalty || 0;
        const woundPenalty = actor.system.combat?.totalWoundPenalty || 0;
        const totalPct = armorPenalty + woundPenalty;
        const diffMod = game.neuroshima?.NeuroshimaDice
          ? (game.neuroshima.NeuroshimaDice.getDifficultyFromPercent?.(totalPct)?.mod ?? 0)
          : 0;

        let attackManeuverBonus = 0;
        let defenseManeuverBonus = 0;
        if (maneuver === "furia" || maneuver === "fury") attackManeuverBonus = 2;
        if (maneuver === "fullDefense" || maneuver === "pelnaObrona") defenseManeuverBonus = 2;

        p.attackTargetSnapshot = baseTarget + p.attackBonusSnapshot + attackManeuverBonus + attributeBonus + diffMod;
        p.defenseTargetSnapshot = baseTarget + p.defenseBonusSnapshot + defenseManeuverBonus + attributeBonus + diffMod;
      }

      game.neuroshima?.log("setPool snapshot", {
        name: p.name, rollTarget, meleeAction,
        attackTarget: p.attackTargetSnapshot, defenseTarget: p.defenseTargetSnapshot
      });

      await NeuroshimaScriptRunner.execute("preMeleePool", {
        actor,
        encounter: updated,
        participant: p,
        meleeAction,
        maneuver,
        activatedTricks
      });
    }

    p.pool = results;
    p.maneuver = maneuver;
    p.tempoLevel = tempoLevel;
    p.damageShift = damageShift || 0;
    p.damageShift1 = damageShift1 || 0;
    p.damageShift2 = damageShift2 || 0;
    p.damageShift3 = damageShift3 || 0;
    p.usedDice = [];
    p.skillSpent = 0;
    // Store per-die success flags from the roll (canonical source of truth matching chat card).
    p.dieResults = dieResults?.length === results.length ? dieResults : null;

    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");
    if (doubleSkill) {
      p.modifiedPool = null;
      p.skillBudget = skillBudget;
      p.selfReductions = new Array(results.length).fill(0);
      p.opponentGains = new Array(results.length).fill(0);
      p.spentOnOpponent = {};
    } else {
      p.modifiedPool = modifiedPool?.length === results.length ? modifiedPool : null;
      p.skillBudget = 0;
      p.selfReductions = [];
      p.opponentGains = [];
      p.spentOnOpponent = {};
    }

    // Check if all active participants have rolled their pools
    const allRolled = Object.values(updated.participants).every(p => !p.isActive || p.pool.length > 0);
    if (allRolled) {
      // Ensure initiative order is set (may not be for 1v1 created before multi-fight)
      if (!updated.turnState.initiativeOrder?.length) {
        const sortedIds = Object.values(updated.participants)
          .filter(p => p.isActive)
          .sort((a, b) => b.initiative - a.initiative)
          .map(p => p.id);
        updated.turnState.initiativeOrder = sortedIds;
      }

      // For 1v1 (duel mode): ensure targets are set if somehow missing
      for (const pId in updated.participants) {
        const participant = updated.participants[pId];
        if (!participant.isActive) continue;
        const opposingTeam = participant.team === "A" ? "B" : "A";
        const opponents = updated.teams[opposingTeam].filter(id => updated.participants[id]?.isActive);
        if (opponents.length === 1 && !updated.primaryTargets[pId]) {
          updated.primaryTargets[pId] = opponents[0];
        }
      }

      this.updateCrowding(updated);

      await NeuroshimaScriptRunner.runMeleeUpdate(id, updated, "pool-ready");

      // Go directly to attack selection — targets were already chosen before pool roll
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      this._buildSegmentQueue(updated);
    }

    game.neuroshima?.log("Setting pool for participant", { id, participantId, results, maneuver, attributeBonus });
    await MeleeStore.updateEncounter(id, updated);
    await this._applyParticipantManeuverConditions(updated, participantId);
  }

  /**
   * Moves target selection to the next eligible participant in initiative order.
   * When all targets are assigned, advances to awaiting-pool-rolls.
   * @private
   */
  static _advanceTargetSelection(encounter) {
    const order = encounter.turnState.initiativeOrder || [];
    const participants = encounter.participants;
    const primaryTargets = encounter.primaryTargets;

    let nextId = null;
    for (const id of order) {
      if (!participants[id]?.isActive) continue;
      if (primaryTargets[id]) continue; // Already chosen

      const isAttacked = Object.values(primaryTargets).includes(id);
      if (isAttacked) {
        // "Attacked do not choose" — auto-assign them to their primary attacker
        const attackers = Object.entries(primaryTargets)
          .filter(([, tid]) => tid === id)
          .map(([aid]) => aid);

        if (attackers.length > 0) {
          primaryTargets[id] = attackers[0];
          this.updateCrowding(encounter);
          continue;
        }
      }

      nextId = id;
      break;
    }

    if (nextId) {
      encounter.turnState.selectionTurn = nextId;
    } else {
      // All targets assigned — proceed to pool rolls
      encounter.turnState.phase = "awaiting-pool-rolls";
      encounter.turnState.selectionTurn = null;
    }
  }

  /**
   * Builds the queue of primary exchanges for the current segment.
   * @private
   */
  static _buildSegmentQueue(encounter) {
    const queue = [];
    const handled = new Set();
    const attackerId = encounter.turnState.initiativeOwnerId;
    const primaryTeam = encounter.participants[attackerId]?.team || "A";

    for (const pId of (encounter.turnState.initiativeOrder || [])) {
      if (handled.has(pId)) continue;
      const p = encounter.participants[pId];
      if (!p?.isActive || p.team !== primaryTeam) continue;

      const targetId = encounter.primaryTargets[pId];
      if (!targetId || handled.has(targetId)) continue;

      queue.push({ attackerId: pId, defenderId: targetId });
      handled.add(pId);
      handled.add(targetId);
    }

    encounter.turnState.segmentQueue = queue;
    encounter.turnState.queueIndex = 0;
  }

  /**
   * Sets the primary target for a participant and handles phase transitions.
   */
  static async setTarget(id, participantId, targetId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "target-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    updated.primaryTargets[participantId] = targetId;

    this.updateCrowding(updated);
    this._advanceTargetSelection(updated);

    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Updates crowding information based on current primary targets.
   */
  static updateCrowding(encounter) {
    for (const pId in encounter.participants) {
      const p = encounter.participants[pId];
      if (!p.isActive) continue;

      const targetingMe = Object.entries(encounter.primaryTargets)
        .filter(([attackerId, targetId]) => targetId === pId && encounter.participants[attackerId]?.isActive)
        .map(([attackerId]) => attackerId);

      const myTarget = encounter.primaryTargets[pId];
      const primaryOpponentId = targetingMe.includes(myTarget) ? myTarget : (targetingMe[0] || null);
      const extraAttackers = targetingMe.filter(id => id !== primaryOpponentId);

      let dexPenalty = 0;
      if (targetingMe.length > 1) {
        dexPenalty = targetingMe.length;
      }

      encounter.crowding[pId] = {
        primaryOpponentId,
        opponentCount: targetingMe.length,
        dexPenalty,
        extraAttackers
      };
    }
  }

  /**
   * Handles die selection for primary exchange.
   */
  static async selectDie(id, participantId, index) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const p = updated.participants[participantId];
    if (!p || p.usedDice.includes(index)) return;

    const exchange = updated.currentExchange;
    const phase = updated.turnState.phase;

    let roleKey = null;
    if (phase === "primary-attack-selection" && participantId === updated.turnState.selectionTurn) {
      roleKey = "attackerSelectedDice";
    } else if (phase === "primary-defense-selection" && participantId === exchange.defenderId) {
      roleKey = "defenderSelectedDice";
    }

    game.neuroshima?.log("selectDie debug:", {
      phase,
      participantId,
      initiativeOwnerId: updated.turnState.initiativeOwnerId,
      defenderId: exchange.defenderId,
      roleKey
    });

    if (!roleKey) return;

    if (exchange[roleKey].includes(index)) {
      exchange[roleKey] = exchange[roleKey].filter(i => i !== index);
    } else {
      if (exchange[roleKey].length < 3) {
        exchange[roleKey].push(index);
      }
    }

    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Declares a non-combat action (costs X segments, sends a chat message).
   * The attacker spends the selected dice as segments without entering a duel.
   */
  static async performAction(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-attack-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    if (participantId !== updated.turnState.selectionTurn) return;

    const exchange = updated.currentExchange;
    const selectedDice = exchange.attackerSelectedDice || [];
    if (selectedDice.length === 0) return;

    const diceCount = selectedDice.length;
    const p = updated.participants[participantId];
    if (!p) return;

    // Count successes so the GM can see them in chat
    const dr = p.dieResults;
    const mp = p.modifiedPool;
    const target = p.attackTargetSnapshot != null ? p.attackTargetSnapshot : (p.targetValue ?? 10);
    const successCount = selectedDice.filter(i => {
      if (dr) return dr[i]?.isSuccess ?? false;
      const val = mp ? mp[i] : p.pool[i];
      return p.pool[i] !== 20 && val <= target;
    }).length;

    p.usedDice.push(...selectedDice);

    // Send chat message
    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    const content = game.i18n.format("NEUROSHIMA.MeleeDuel.PerformActionMsg", {
      name: p.name, segments: diceCount, successes: successCount
    });
    ChatMessage.create({
      content: `<div class="neuroshima-roll-card"><p>${content}</p></div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });

    // Clear exchange
    updated.currentExchange = {
      attackerId: null, defenderId: null, declaredAction: null,
      declaredDiceCount: 0, attackerSelectedDice: [], defenderSelectedDice: [],
      resolutionType: "normal"
    };

    // Advance segment by dice count used
    const newSeg = (updated.turnState.segment || 1) + diceCount;
    updated.log.push({
      type: "action",
      turn: updated.turnState.turn,
      segment: updated.turnState.segment,
      text: content
    });

    if (newSeg > 3) {
      await MeleeStore.updateEncounter(id, updated);
      await MeleeTurnService.startNewTurn(id);
    } else {
      updated.turnState.segment = newSeg;
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      await MeleeStore.updateEncounter(id, updated);
    }
  }

  /**
   * Confirms attack selection and moves to defense selection.
   */
  static async confirmAttack(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-attack-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;

    if (participantId !== updated.turnState.selectionTurn) return;
    if (exchange.attackerSelectedDice.length === 0) return;

    // opposedPips mode requires exactly 3 dice committed by the attacker
    if ((updated.resolutionMode || "normal") === "opposedPips" && exchange.attackerSelectedDice.length !== 3) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.OpposedPips.MustSelectAll"));
      return;
    }

    exchange.attackerId = participantId;
    exchange.declaredDiceCount = exchange.attackerSelectedDice.length;
    exchange.defenderId = updated.primaryTargets[participantId];

    updated.turnState.phase = "primary-defense-selection";
    updated.turnState.selectionTurn = exchange.defenderId;

    await NeuroshimaScriptRunner.runMeleeUpdate(id, updated, "attack-committed");
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Confirms defense selection and immediately triggers auto-resolution.
   */
  static async confirmDefense(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-defense-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;

    if (participantId !== exchange.defenderId) return;
    const defender = updated.participants[exchange.defenderId];
    const defenderPoolSize = (defender?.pool || []).length;
    const usedCount = (defender?.usedDice || []).length;
    const availableDefenderDice = defenderPoolSize - usedCount;
    const requiredDiceCount = Math.min(exchange.declaredDiceCount, availableDefenderDice);
    if (exchange.defenderSelectedDice.length !== requiredDiceCount) return;

    await MeleeStore.updateEncounter(id, updated);
    await MeleeResolution.resolvePrimaryExchange(id);
  }

  /**
   * Berserker mode (Tryb Berserkera):
   * Rule: "zadawać ciosy nie zważając na rany mimo przegranej Inicjatywy,
   *        w ogóle nie musząc się przy tym bronić." — NS 1.5
   *
   * The defender does NOT block (defenderSelectedDice = []).  Instead they collect
   * ALL remaining unused dice into a simultaneous counter-attack that is applied
   * automatically by MeleeResolution.resolvePrimaryExchange when it detects
   * exchange.berserkerCounterDice is set.  This creates a mutual exchange: the
   * attacker always hits the berserker, and the berserker always hits the attacker.
   */
  static async berserkerAcceptHit(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-defense-selection") return;
    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;
    if (participantId !== exchange.defenderId) return;

    exchange.defenderSelectedDice = [];

    // Collect all unused dice for the berserker's automatic counter-attack.
    const berserker = updated.participants[participantId];
    const usedSet = new Set(berserker.usedDice || []);
    exchange.berserkerCounterDice = (berserker.pool || [])
      .map((_, i) => i)
      .filter(i => !usedSet.has(i));

    await MeleeStore.updateEncounter(id, updated);
    await MeleeResolution.resolvePrimaryExchange(id);
  }

  /**
   * Goes back one turn (GM control). Never goes below turn 1.
   * Resets pools and targets the same way startNewTurn does.
   */
  static async prevTurn(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    updated.turnState.turn = Math.max(1, (updated.turnState.turn || 1) - 1);
    updated.turnState.segment = 1;
    updated.turnState.segmentCost = 0;
    updated.turnState.selectionTurn = null;
    updated._effects = {};

    for (const pId in updated.participants) {
      const p = updated.participants[pId];
      p.pool = [];
      p.modifiedPool = null;
      p.skillBudget = 0;
      p.selfReductions = [];
      p.opponentGains = [];
      p.spentOnOpponent = {};
      p.usedDice = [];
      p.skillSpent = 0;
      p.maneuver = "none";
      p.tempoLevel = 0;
      p.chargeLevel = 0;
      p.attackTargetSnapshot = null;
      p.defenseTargetSnapshot = null;
    }

    for (const pId in updated.participants) {
      updated.primaryTargets[pId] = null;
    }

    const sortedIds = Object.values(updated.participants)
      .filter(p => p.isActive)
      .sort((a, b) => b.initiative - a.initiative)
      .map(p => p.id);
    updated.turnState.initiativeOrder = sortedIds;

    updated.log.push({
      type: "system",
      segment: 1,
      text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogNewTurn", { turn: updated.turnState.turn })
    });

    if (this._isMultiFight(updated)) {
      updated.turnState.phase = "target-selection";
      updated.turnState.selectionTurn = sortedIds[0];
      this.updateCrowding(updated);
      this._advanceTargetSelection(updated);
    } else {
      const [aId, bId] = sortedIds;
      if (aId && bId) {
        updated.primaryTargets[aId] = bId;
        updated.primaryTargets[bId] = aId;
      }
      this.updateCrowding(updated);
      updated.turnState.phase = "awaiting-pool-rolls";
    }

    game.neuroshima?.log("GM: prevTurn", { id, turn: updated.turnState.turn });
    await MeleeStore.updateEncounter(id, updated);

    // MANEUVER — Trash collector (prevTurn / GM rewind):
    // Same cleanup as startNewTurn — maneuver conditions are reset so the rewound
    // turn starts with a clean slate.
    const { NeuroshimaSocket: _NS2 } = await import("../helpers/socket-helper.js");
    game.neuroshima?.log("[MeleeTurnService.prevTurn] clearing maneuver conditions for all active participants");
    for (const p of Object.values(updated.participants)) {
      if (!p.isActive) continue;
      game.neuroshima?.log("[MeleeTurnService.prevTurn] clearing", { name: p.name, uuid: p.tokenUuid ?? p.actorUuid });
      await _NS2.gmExecute("clearActorManeuverConditions", p.tokenUuid ?? p.actorUuid);
    }
  }

  /**
   * Manually sets the segment (GM control). Clamped to 1–3.
   */
  static async setSegment(id, segment) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    updated.turnState.segment = Math.max(1, Math.min(3, segment));
    updated.turnState.segmentCost = 0;

    // Reset current exchange
    updated.currentExchange = {
      attackerId: null,
      defenderId: null,
      declaredAction: null,
      declaredDiceCount: 0,
      attackerSelectedDice: [],
      defenderSelectedDice: [],
      resolutionType: "normal"
    };

    updated.turnState.phase = "primary-attack-selection";
    updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;

    game.neuroshima?.log("GM: setSegment", { id, segment: updated.turnState.segment });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Changes the active weapon for a participant (before or after pool roll).
   */
  static async setWeapon(id, participantId, weaponId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const p = updated.participants[participantId];
    if (!p) return;

    p.weaponId = weaponId;

    // Re-snapshot targets if pool already rolled (recalculate from new weapon)
    if (p.pool?.length > 0) {
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      if (actor) {
        const weapon = actor.items.get(weaponId);
        const attribute = weapon?.system.attribute || "dexterity";
        const baseTarget = actor.system.attributeTotals?.[attribute] || 10;
        const armorPenalty = actor.system.combat?.totalArmorPenalty || 0;
        const woundPenalty = actor.system.combat?.totalWoundPenalty || 0;
        const totalPenalty = armorPenalty + woundPenalty;
        const attributeBonus = p.attackTargetSnapshot
          ? (p.attackTargetSnapshot - (p.targetValue || baseTarget) - (p.attackBonusSnapshot || 0))
          : 0;
        p.targetValue = baseTarget;
        p.attackBonusSnapshot = weapon?.system.attackBonus || 0;
        p.defenseBonusSnapshot = weapon?.system.defenseBonus || 0;
        p.attackTargetSnapshot = baseTarget + p.attackBonusSnapshot + attributeBonus - totalPenalty;
        p.defenseTargetSnapshot = baseTarget + p.defenseBonusSnapshot + attributeBonus - totalPenalty;
      }
    }

    game.neuroshima?.log("setWeapon", { participantId, weaponId });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Allocates a skill point from spender to a target die.
   * delta +1 = spend 1 point; -1 = unspend 1 point.
   * Same participant = reduce own die; different participant = increase opponent's die.
   */
  static async allocateSkill(id, spenderId, targetId, dieIndex, delta) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;
    const _allocAllowedPhases = ["awaiting-pool-rolls", "primary-attack-selection", "primary-defense-selection"];
    if (!_allocAllowedPhases.includes(encounter.turnState.phase)) return;

    const updated = foundry.utils.deepClone(encounter);
    const spender = updated.participants[spenderId];
    const target = updated.participants[targetId];
    if (!spender || !target) return;

    const selfSpent = (spender.selfReductions || []).reduce((a, b) => a + b, 0);
    const oppSpent = Object.values(spender.spentOnOpponent || {})
      .reduce((sum, arr) => sum + arr.reduce((a, b) => a + b, 0), 0);
    const remaining = (spender.skillBudget || 0) - selfSpent - oppSpent;

    if (spenderId === targetId) {
      if (!spender.selfReductions) spender.selfReductions = new Array(spender.pool.length).fill(0);
      const current = (spender.selfReductions[dieIndex] || 0);
      if (delta > 0) {
        if (remaining <= 0) return;
        if ((spender.pool[dieIndex] || 1) - current <= 1) return;
        spender.selfReductions[dieIndex] = current + 1;
      } else {
        if (current <= 0) return;
        spender.selfReductions[dieIndex] = current - 1;
      }
    } else {
      if (spender.cannotTargetOpponentDice) return;
      if (!spender.spentOnOpponent[targetId]) {
        spender.spentOnOpponent[targetId] = new Array(target.pool.length).fill(0);
      }
      if (!target.opponentGains) target.opponentGains = new Array(target.pool.length).fill(0);
      const currentGain = target.opponentGains[dieIndex] || 0;
      if (delta > 0) {
        if (remaining <= 0) return;
        if ((target.pool[dieIndex] || 0) + currentGain >= 20) return;
        spender.spentOnOpponent[targetId][dieIndex] = (spender.spentOnOpponent[targetId][dieIndex] || 0) + 1;
        target.opponentGains[dieIndex] = currentGain + 1;
      } else {
        const spent = spender.spentOnOpponent[targetId]?.[dieIndex] || 0;
        if (spent <= 0) return;
        spender.spentOnOpponent[targetId][dieIndex] = spent - 1;
        target.opponentGains[dieIndex] = Math.max(0, currentGain - 1);
      }
    }

    game.neuroshima?.log("allocateSkill", { spenderId, targetId, dieIndex, delta, remaining });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Resets all skill allocations made by a participant, restoring opponent dice to their original state.
   */
  static async resetSkillAllocation(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const spender = updated.participants[participantId];
    if (!spender) return;

    for (const [targetId, allocations] of Object.entries(spender.spentOnOpponent || {})) {
      const target = updated.participants[targetId];
      if (!target) continue;
      for (let i = 0; i < allocations.length; i++) {
        if (!target.opponentGains) target.opponentGains = [];
        target.opponentGains[i] = Math.max(0, (target.opponentGains[i] || 0) - (allocations[i] || 0));
      }
    }

    spender.selfReductions = new Array(spender.pool.length).fill(0);
    spender.spentOnOpponent = {};

    game.neuroshima?.log("resetSkillAllocation", { participantId });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Moves to the next segment or ends the turn if no dice are left.
   * (Kept for backward compatibility — auto-resolution still uses this internally.)
   */
  static async advanceSegment(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const cost = updated.turnState.segmentCost || 1;
    updated.turnState.segment += cost;
    updated.turnState.segmentCost = 0;

    updated.currentExchange = {
      attackerId: null,
      defenderId: null,
      declaredAction: null,
      declaredDiceCount: 0,
      attackerSelectedDice: [],
      defenderSelectedDice: [],
      resolutionType: "normal"
    };

    if (updated.turnState.segment > 3) {
      await this.startNewTurn(id);
    } else {
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      await MeleeStore.updateEncounter(id, updated);
    }
  }
}
const TEMPLATES = {
  pool:    "systems/neuroshima/templates/chat/melee-vanilla-pool.hbs",
  battle:  "systems/neuroshima/templates/chat/melee-vanilla-battle.hbs",
  result:  "systems/neuroshima/templates/chat/melee-vanilla-result.hbs"
};

export class MeleeVanillaChat {
  static FLAG_KEY = "vanillaCards";
  static _debouncedSync = null;

  // ── Hook Registration ───────────────────────────────────────────────────

  static registerHooks() {
    MeleeVanillaChat._debouncedSync = foundry.utils.debounce(async () => {
      if (!game.user.isGM) return;
      const mode = game.settings.get("neuroshima", "meleeCombatType") || "default";
      if (mode !== "default") return;
      if (game.combat) await MeleeVanillaChat._syncAll(game.combat);
    }, 300);

    Hooks.on("updateCombat", (combat, updates) => {
      if (!foundry.utils.hasProperty(updates, "flags.neuroshima.meleeEncounters")) return;
      MeleeVanillaChat._debouncedSync();
    });
  }

  // ── renderChatMessageHTML handler ──────────────────────────────────────

  static onRender(root, message) {
    const cardFlag = message.getFlag("neuroshima", "vanillaCard");
    if (!cardFlag) return;

    const { encounterId, type } = cardFlag;

    MeleeVanillaChat._applyOwnerVisibility(root);

    root.querySelectorAll("[data-mvc-action='rollPool']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeVanillaChat._doRollPool(btn, encounterId);
      });
    });

    if (type === "battle") {
      MeleeVanillaChat._bindBattleDiceToggles(root);
    }

    root.querySelectorAll("[data-mvc-action='confirmAttack']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeVanillaChat._doConfirmAttack(btn, encounterId, root);
      });
    });

    root.querySelectorAll("[data-mvc-action='confirmDefense']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeVanillaChat._doConfirmDefense(btn, encounterId, root);
      });
    });

    root.querySelectorAll("[data-mvc-action='acceptHit']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeVanillaChat._doAcceptHit(btn, encounterId);
      });
    });

    root.querySelectorAll("[data-mvc-action='performAction']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        const participantId = btn.dataset.participantId;
        await MeleeTurnService.performAction(encounterId, participantId);
      });
    });

    root.querySelectorAll("[data-mvc-action='confirmDamage']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeResolution.confirmDamageDistribution(encounterId, parseInt(btn.dataset.optionIndex, 10));
      });
    });

    root.querySelectorAll("[data-mvc-action='endEncounter']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeEncounter.end(encounterId);
      });
    });

    root.querySelectorAll("[data-mvc-action='nextTurn']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeTurnService.startNewTurn(encounterId);
      });
    });
  }

  // ── Entry Point ─────────────────────────────────────────────────────────

  static async startTurn(encounterId) {
    if (!game.user.isGM) {
      if (game.neuroshima?.socket) {
        await game.neuroshima.socket.executeAsGM("postVanillaCard", "start", encounterId);
      }
      return;
    }
    await MeleeVanillaChat._syncEncounter(encounterId);
  }

  // ── Sync (GM only) ──────────────────────────────────────────────────────

  static async _syncAll(combat) {
    const encounters = combat.getFlag("neuroshima", "meleeEncounters") || {};
    for (const encounterId of Object.keys(encounters)) {
      await MeleeVanillaChat._syncEncounter(encounterId);
    }
  }

  static async _syncEncounter(encounterId) {
    const encounter = MeleeStore.getEncounter(encounterId);
    if (!encounter) return;

    const phase     = encounter.turnState.phase;
    const turn      = encounter.turnState.turn || 1;
    const segment   = encounter.turnState.segment || 1;
    const queueIdx  = encounter.turnState.queueIndex ?? 0;
    const exchangeId = `${turn}-${segment}-${queueIdx}`;

    const tracking = MeleeVanillaChat._getTracking(encounterId);

    if (phase === "awaiting-pool-rolls" || phase === "target-selection") {
      if (!tracking.poolCardId || tracking.lastPoolTurn !== turn) {
        await MeleeVanillaChat._postPoolCard(encounterId, encounter, turn);
      } else {
        await MeleeVanillaChat._updatePoolCard(encounterId, encounter);
      }
      return;
    }

    if (phase === "primary-attack-selection") {
      if (tracking.lastBattleExchangeId !== exchangeId) {
        await MeleeVanillaChat._postBattleCard(encounterId, encounter, exchangeId);
      }
      return;
    }

    if (phase === "primary-defense-selection") {
      if (tracking.lastBattleExchangeId !== exchangeId) {
        await MeleeVanillaChat._postBattleCard(encounterId, encounter, exchangeId);
      } else {
        await MeleeVanillaChat._updateBattleCard(encounterId, encounter);
      }
      return;
    }

    if (phase === "damage-selection") {
      if (tracking.lastPostedPhase !== "result" || tracking.lastPostedExchangeId !== exchangeId) {
        await MeleeVanillaChat._postResultCard(encounterId, encounter, null);
        const t = MeleeVanillaChat._getTracking(encounterId);
        await MeleeVanillaChat._setTracking(encounterId, {
          ...t,
          lastPostedPhase: "result",
          lastPostedExchangeId: exchangeId
        });
      }
    }
  }

  // ── Card Posts ──────────────────────────────────────────────────────────

  static async _postPoolCard(encounterId, encounter, turn) {
    const context = MeleeVanillaChat._buildPoolContext(encounter);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.pool, context);
    const message = await ChatMessage.create({
      content,
      flags: { neuroshima: { vanillaCard: { encounterId, type: "pool" } } },
      speaker: { alias: "⚔ Walka Wręcz" }
    });
    if (!message) return;

    const t = MeleeVanillaChat._getTracking(encounterId);
    await MeleeVanillaChat._setTracking(encounterId, {
      ...t,
      poolCardId: message.id,
      lastPoolTurn: turn,
      lastPostedPhase: "pool",
      lastPostedExchangeId: null
    });
  }

  static async _updatePoolCard(encounterId, encounter) {
    const tracking = MeleeVanillaChat._getTracking(encounterId);
    if (!tracking.poolCardId) return;
    const message = game.messages.get(tracking.poolCardId);
    if (!message) return;
    const context = MeleeVanillaChat._buildPoolContext(encounter);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.pool, context);
    await message.update({ content });
  }

  static async _postBattleCard(encounterId, encounter, exchangeId) {
    const context = MeleeVanillaChat._buildBattleContext(encounter);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.battle, context);
    const message = await ChatMessage.create({
      content,
      flags: { neuroshima: { vanillaCard: { encounterId, type: "battle" } } },
      speaker: { alias: "⚔ Walka Wręcz" }
    });
    if (!message) return;
    const t = MeleeVanillaChat._getTracking(encounterId);
    await MeleeVanillaChat._setTracking(encounterId, {
      ...t,
      battleCardId: message.id,
      lastBattleExchangeId: exchangeId
    });
  }

  static async _updateBattleCard(encounterId, encounter) {
    const tracking = MeleeVanillaChat._getTracking(encounterId);
    if (!tracking.battleCardId) {
      const turn = encounter.turnState.turn || 1;
      const segment = encounter.turnState.segment || 1;
      const queueIdx = encounter.turnState.queueIndex ?? 0;
      await MeleeVanillaChat._postBattleCard(encounterId, encounter, `${turn}-${segment}-${queueIdx}`);
      return;
    }
    const message = game.messages.get(tracking.battleCardId);
    if (!message) {
      const turn = encounter.turnState.turn || 1;
      const segment = encounter.turnState.segment || 1;
      const queueIdx = encounter.turnState.queueIndex ?? 0;
      await MeleeVanillaChat._postBattleCard(encounterId, encounter, `${turn}-${segment}-${queueIdx}`);
      return;
    }
    const context = MeleeVanillaChat._buildBattleContext(encounter);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.battle, context);
    await message.update({ content });
  }

  static async _postResultCard(encounterId, encounter, exchangeSnap) {
    const context = MeleeVanillaChat._buildResultContext(encounter, exchangeSnap);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.result, context);
    await ChatMessage.create({
      content,
      flags: { neuroshima: { vanillaCard: { encounterId, type: "result" } } },
      speaker: { alias: "⚔ Walka Wręcz" }
    });
  }

  // ── Context Builders ────────────────────────────────────────────────────

  static _buildPoolContext(encounter) {
    const phase = encounter.turnState.phase;
    const turn  = encounter.turnState.turn || 1;
    const segment = encounter.turnState.segment || 1;

    const teamsA = (encounter.teams.A || []).map(id => {
      const p = encounter.participants[id];
      if (!p) return null;
      return MeleeVanillaChat._enrichParticipantForPool(p, id, encounter);
    }).filter(Boolean);

    const teamsB = (encounter.teams.B || []).map(id => {
      const p = encounter.participants[id];
      if (!p) return null;
      return MeleeVanillaChat._enrichParticipantForPool(p, id, encounter);
    }).filter(Boolean);

    const selectionOwner = phase === "target-selection"
      ? encounter.participants[encounter.turnState.selectionTurn]?.name || ""
      : null;

    return {
      encounterId: encounter.id,
      turn,
      segment,
      phase,
      isTargetSelection: phase === "target-selection",
      selectionOwnerName: selectionOwner,
      initiativeOwnerName: encounter.participants[encounter.turnState.initiativeOwnerId]?.name || "---",
      segmentDots: [1, 2, 3].map(i => ({
        number: i,
        state: i < segment ? "done" : i === segment ? "active" : "pending"
      })),
      teamsA,
      teamsB,
      allRolled: Object.values(encounter.participants).every(p => !p.isActive || p.pool.length > 0)
    };
  }

  static _enrichParticipantForPool(p, pId, encounter) {
    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    const weapon = actor?.items.get(p.weaponId);

    const meleeWeapons = actor
      ? (actor.items || [])
          .filter(i => i.type === "weapon" && i.system.weaponType === "melee" && i.system.equipped)
          .map(w => ({ id: w.id, name: w.name, isCurrent: w.id === p.weaponId }))
      : [];
    if (weapon && !meleeWeapons.some(w => w.id === p.weaponId)) {
      meleeWeapons.unshift({ id: p.weaponId, name: weapon.name, isCurrent: true });
    }

    const crowd = encounter.crowding[pId] || {};
    const dexPenalty = crowd.dexPenalty || 0;

    const effectivePool = (p.pool || []).map((v, i) => {
      const mp = p.modifiedPool;
      const effective = mp && mp[i] !== undefined ? mp[i] : v;
      const isNat20 = v === 20;
      const isSuccess = p.dieResults
        ? (p.dieResults[i]?.isSuccess ?? false)
        : (!isNat20 && effective <= ((p.attackTargetSnapshot ?? p.targetValue ?? 10) - dexPenalty));
      return { raw: v, effective, isSuccess, isNat20, index: i };
    });

    return {
      id: pId,
      name: p.name,
      img: p.img,
      actorUuid: p.actorUuid,
      initiative: p.initiative,
      maneuver: p.maneuver,
      hasPool: p.pool.length > 0,
      effectivePool,
      needsPool: p.pool.length === 0 && (encounter.turnState.phase === "awaiting-pool-rolls" || encounter.turnState.phase === "target-selection"),
      weaponName: weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
      meleeWeapons,
      weaponId: p.weaponId,
      isInitiativeOwner: pId === encounter.turnState.initiativeOwnerId,
      isCrowded: (crowd.opponentCount || 0) > 1,
      dexPenalty
    };
  }

  static _buildResultContext(encounter, snap) {
    const log = encounter.log || [];
    const lastEntry = log.slice(-1)[0];

    return {
      encounterId: encounter.id,
      resultType:  lastEntry?.type  || "block",
      resultText:  lastEntry?.text  || "",
      isHit:        lastEntry?.type === "hit",
      isBlock:      lastEntry?.type === "block",
      isTakeover:   lastEntry?.type === "takeover",
      pendingDamage: encounter.pendingDamage || null,
      turn:    encounter.turnState.turn || 1,
      segment: encounter.turnState.segment || 1
    };
  }

  static _buildBattleContext(encounter) {
    const phase = encounter.turnState.phase;
    const exchange = encounter.currentExchange;
    const isAttackerTurn = phase === "primary-attack-selection";
    const isDefenderTurn = phase === "primary-defense-selection";

    const attackerId = isAttackerTurn ? encounter.turnState.selectionTurn : exchange.attackerId;
    const defenderId = isAttackerTurn
      ? encounter.primaryTargets[attackerId]
      : exchange.defenderId;

    const attacker = encounter.participants[attackerId];
    const defender = encounter.participants[defenderId];
    if (!attacker || !defender) return {};

    const turn = encounter.turnState.turn || 1;
    const segment = encounter.turnState.segment || 1;

    const atkCrowd = encounter.crowding[attackerId] || {};
    const defCrowd = encounter.crowding[defenderId] || {};
    const atkDexPenalty = atkCrowd.dexPenalty || 0;
    const defDexPenalty = defCrowd.dexPenalty || 0;
    const atkTarget = (attacker.attackTargetSnapshot ?? attacker.targetValue ?? 10) - atkDexPenalty;
    const defTarget = (defender.defenseTargetSnapshot ?? defender.targetValue ?? 10) - defDexPenalty;

    const attackerSelectedDice = exchange.attackerSelectedDice || [];

    const attackerPool = (attacker.pool || []).map((v, i) => {
      const mp = attacker.modifiedPool;
      const eff = mp?.[i] !== undefined ? mp[i] : v;
      const isNat20 = v === 20;
      const isSuccess = attacker.dieResults
        ? (attacker.dieResults[i]?.isSuccess ?? false)
        : (!isNat20 && eff <= atkTarget);
      const isUsed = (attacker.usedDice || []).includes(i);
      const isSelected = attackerSelectedDice.includes(i);
      return { raw: v, effective: eff, isSuccess, isNat20, isUsed, isSelected, index: i };
    });

    const defenderPool = (defender.pool || []).map((v, i) => {
      const mp = defender.modifiedPool;
      const eff = mp?.[i] !== undefined ? mp[i] : v;
      const isNat20 = v === 20;
      const isSuccess = defender.dieResults
        ? (defender.dieResults[i]?.isSuccess ?? false)
        : (!isNat20 && eff <= defTarget);
      const isUsed = (defender.usedDice || []).includes(i);
      return { raw: v, effective: eff, isSuccess, isNat20, isUsed, index: i };
    });

    const atkDoc = fromUuidSync(attacker.actorUuid);
    const atkActor = atkDoc?.actor || atkDoc;
    const atkWeapon = atkActor?.items.get(attacker.weaponId);

    const defDoc = fromUuidSync(defender.actorUuid);
    const defActor = defDoc?.actor || defDoc;
    const defWeapon = defActor?.items.get(defender.weaponId);

    const atkIsCreature = atkActor?.type === "creature";
    const atkBeastActions = atkIsCreature
      ? (atkActor.items || [])
          .filter(i => i.type === "beast-action")
          .flatMap(i => (i.system?.activities ?? []).map(act => ({
            id: `${i.id}::${act.id}`,
            itemId: i.id,
            activityId: act.id,
            name: act.name || i.name,
            cost: act.costType === "success" ? (act.successCost ?? 1) : (act.segmentCost ?? 1),
            costType: act.costType ?? "success"
          })))
      : [];

    const defIsBerserker = defActor?.statuses?.has("berserker") ?? false;

    const availableDefenderDice = defenderPool.filter(d => !d.isUsed).length;
    const neededDiceCount = Math.min(exchange.declaredDiceCount || 0, availableDefenderDice);

    return {
      encounterId: encounter.id,
      turn,
      segment,
      segmentDots: [1, 2, 3].map(i => ({
        number: i,
        state: i < segment ? "done" : i === segment ? "active" : "pending"
      })),
      isAttackerTurn,
      isDefenderTurn,
      attacker: {
        id: attackerId,
        name: attacker.name,
        img: attacker.img,
        actorUuid: attacker.actorUuid,
        initiative: attacker.initiative,
        maneuver: attacker.maneuver,
        isInitiativeOwner: attackerId === encounter.turnState.initiativeOwnerId,
        attackTarget: atkTarget,
        weaponName: atkIsCreature
          ? game.i18n.localize("NEUROSHIMA.MeleeDuel.BeastActions")
          : (atkWeapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed")),
        effectivePool: attackerPool,
        isCrowded: (atkCrowd.opponentCount || 0) > 1,
        dexPenalty: atkDexPenalty,
        isCreature: atkIsCreature,
        beastActions: atkBeastActions,
        damageTiers: (() => {
          if (!atkWeapon) return null;
          if (atkWeapon.type === "beast-action") {
            const firstAct = (atkWeapon.system?.activities ?? [])[0];
            const dmg = firstAct?.damage || null;
            return dmg ? { s1: dmg, s2: dmg, s3: dmg } : null;
          }
          return {
            s1: atkWeapon.system?.damageMelee1 || "D",
            s2: atkWeapon.system?.damageMelee2 || "L",
            s3: atkWeapon.system?.damageMelee3 || "C"
          };
        })()
      },
      defender: {
        id: defenderId,
        name: defender.name,
        img: defender.img,
        actorUuid: defender.actorUuid,
        initiative: defender.initiative,
        isInitiativeOwner: defenderId === encounter.turnState.initiativeOwnerId,
        defenseTarget: defTarget,
        weaponName: defWeapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
        effectivePool: defenderPool,
        isCrowded: (defCrowd.opponentCount || 0) > 1,
        dexPenalty: defDexPenalty,
        isBerserker: defIsBerserker,
        neededDiceCount
      }
    };
  }

  // ── Action Handlers ─────────────────────────────────────────────────────

  static async _doRollPool(btn, encounterId) {
    const participantId = btn.dataset.participantId;
    const encounter = MeleeStore.getEncounter(encounterId);
    const p = encounter?.participants[participantId];
    if (!p) return;

    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    if (!actor?.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NotYourFighter"));
      return;
    }

    const weapon = actor?.items.get(p.weaponId);
    const crowd  = encounter?.crowding?.[participantId];
    const crowdingDexPenalty = crowd?.dexPenalty || 0;

    // Szarża (Charge) penalty: if the participant declared charge at initiative (+1..+3 to Zręczność)
    // but LOST the initiative roll, that same value becomes a penalty on the first pool roll.
    const isFirstTurn = (encounter?.turnState?.turn ?? 1) === 1;
    const hasInitiative = encounter?.turnState?.initiativeOwnerId === participantId;
    const chargeDexPenalty = (isFirstTurn && !hasInitiative && (p.chargeLevel ?? 0) > 0)
      ? (p.chargeLevel ?? 0) : 0;

    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");

    const dialog = new NeuroshimaWeaponRollDialog({
      actor,
      weapon,
      rollType: "melee",
      isPoolRoll: true,
      crowdingDexPenalty,
      chargeDexPenalty,
      onClose: () => {},
      onRoll: async (rollResult) => {
        game.neuroshima?.log("[melee-vanilla-chat.onRoll] callback fired", { encounterId, participantId, maneuver: rollResult?.maneuver, tempoLevel: rollResult?.tempoLevel });
        if (!rollResult) return;
        await MeleeTurnService.setPool(encounterId, participantId, rollResult);
      }
    });
    dialog.render(true);
  }

  static async _doConfirmAttack(btn, encounterId, root) {
    const participantId = btn.dataset.participantId;

    const chips = [...root.querySelectorAll(".die-chip-mvc.mvc-die-selected")];
    if (chips.length === 0) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.SelectDiceFirst"));
      return;
    }

    const selectedIndices = chips.map(c => parseInt(c.dataset.index, 10));

    btn.disabled = true;
    for (const idx of selectedIndices) {
      await MeleeTurnService.selectDie(encounterId, participantId, idx);
    }
    await MeleeTurnService.confirmAttack(encounterId, participantId);
  }

  static async _doAcceptHit(btn, encounterId) {
    const participantId = btn.dataset.participantId;
    const doc = fromUuidSync(btn.dataset.meleeOwner);
    const actor = doc?.actor || doc;
    if (!actor?.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NotYourFighter"));
      return;
    }
    btn.disabled = true;

    const encBefore = MeleeStore.getEncounter(encounterId);
    if (!encBefore) return;
    const turn     = encBefore.turnState.turn || 1;
    const segment  = encBefore.turnState.segment || 1;
    const queueIdx = encBefore.turnState.queueIndex ?? 0;
    const exchangeId = `${turn}-${segment}-${queueIdx}`;

    await MeleeTurnService.berserkerAcceptHit(encounterId, participantId);

    const encAfter = MeleeStore.getEncounter(encounterId);
    if (!encAfter) return;

    if (!game.user.isGM) {
      if (game.neuroshima?.socket) {
        await game.neuroshima.socket.executeAsGM("postVanillaCard", "result", encounterId);
      }
    } else {
      await MeleeVanillaChat._postResultCard(encounterId, encAfter, null);
      const t = MeleeVanillaChat._getTracking(encounterId);
      await MeleeVanillaChat._setTracking(encounterId, {
        ...t,
        lastPostedPhase: "result",
        lastPostedExchangeId: exchangeId
      });
    }
  }

  static async _doConfirmDefense(btn, encounterId, root) {
    const participantId = btn.dataset.participantId;
    const neededCount   = parseInt(btn.dataset.neededCount ?? "0", 10);

    const chips = [...root.querySelectorAll(".die-chip-mvc.mvc-die-selected")];
    const selectedIndices = chips.map(c => parseInt(c.dataset.index, 10));

    if (selectedIndices.length !== neededCount) {
      ui.notifications.warn(
        game.i18n.format("NEUROSHIMA.MeleeDuel.DefenseWrongCount", {
          selected: selectedIndices.length,
          needed: neededCount
        })
      );
      return;
    }

    const encBefore = MeleeStore.getEncounter(encounterId);
    if (!encBefore) return;

    const exchange   = encBefore.currentExchange;
    const turn       = encBefore.turnState.turn || 1;
    const segment    = encBefore.turnState.segment || 1;
    const queueIdx   = encBefore.turnState.queueIndex ?? 0;
    const exchangeId = `${turn}-${segment}-${queueIdx}`;

    btn.disabled = true;

    for (const idx of selectedIndices) {
      await MeleeTurnService.selectDie(encounterId, participantId, idx);
    }
    await MeleeTurnService.confirmDefense(encounterId, participantId);

    const encAfter = MeleeStore.getEncounter(encounterId);
    if (!encAfter) return;

    if (!game.user.isGM) {
      if (game.neuroshima?.socket) {
        await game.neuroshima.socket.executeAsGM("postVanillaCard", "result", encounterId);
      }
    } else {
      await MeleeVanillaChat._postResultCard(encounterId, encAfter, null);
      const t = MeleeVanillaChat._getTracking(encounterId);
      await MeleeVanillaChat._setTracking(encounterId, {
        ...t,
        lastPostedPhase: "result",
        lastPostedExchangeId: exchangeId
      });
    }
  }

  // ── Client-side: die toggles ────────────────────────────────────────────

  static _bindBattleDiceToggles(root) {
    const confirmAttack = root.querySelector("[data-mvc-action='confirmAttack']");
    const confirmDefense = root.querySelector("[data-mvc-action='confirmDefense']");
    const neededCount = confirmDefense
      ? parseInt(confirmDefense.dataset.neededCount ?? "0", 10)
      : null;

    const updateButtons = () => {
      const selected = root.querySelectorAll(".die-chip-mvc.mvc-die-selected");
      const count = selected.length;

      const countEl = root.querySelector(".mvc-selected-count");
      if (countEl) countEl.textContent = count;

      if (confirmAttack) {
        const ok = count > 0;
        confirmAttack.disabled = !ok;
        confirmAttack.classList.toggle("is-disabled", !ok);
        confirmAttack.classList.toggle("pulse", ok);
      }

      if (confirmDefense && neededCount !== null) {
        const ok = count === neededCount;
        confirmDefense.disabled = !ok;
        confirmDefense.classList.toggle("is-disabled", !ok);
        confirmDefense.classList.toggle("pulse", ok);
      }
    };

    root.querySelectorAll(".die-chip-mvc:not(.is-used)").forEach(chip => {
      chip.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        chip.classList.toggle("mvc-die-selected");
        updateButtons();
      });
    });

    updateButtons();
  }

  // ── Owner visibility ────────────────────────────────────────────────────

  static _applyOwnerVisibility(root) {
    root.querySelectorAll("[data-melee-owner]").forEach(el => {
      const ownerUuid = el.dataset.meleeOwner;
      if (!ownerUuid) return;
      const doc    = fromUuidSync(ownerUuid);
      const actor  = doc?.actor || doc;
      const canAct = game.user.isGM || actor?.isOwner;
      if (!canAct) {
        if (el.tagName === "BUTTON") {
          el.disabled = true;
          el.classList.add("is-disabled");
          el.style.pointerEvents = "none";
          el.style.opacity = "0.35";
        } else if (el.tagName === "SELECT") {
          el.disabled = true;
        } else {
          el.style.opacity = "0.35";
          el.style.pointerEvents = "none";
        }
      }
    });
  }

  // ── Tracking helpers ────────────────────────────────────────────────────

  static _getTracking(encounterId) {
    const all = game.combat?.getFlag("neuroshima", MeleeVanillaChat.FLAG_KEY) || {};
    return all[encounterId] || {};
  }

  static async _setTracking(encounterId, data) {
    const combat = game.combat;
    if (!combat) return;
    const all = foundry.utils.deepClone(combat.getFlag("neuroshima", MeleeVanillaChat.FLAG_KEY) || {});
    all[encounterId] = data;
    if (game.user.isGM || !game.neuroshima?.socket) {
      await combat.setFlag("neuroshima", MeleeVanillaChat.FLAG_KEY, all);
    } else {
      await game.neuroshima.socket.executeAsGM("updateCombatFlag", MeleeVanillaChat.FLAG_KEY, all);
    }
  }
}
