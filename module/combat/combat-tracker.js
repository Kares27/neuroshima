/**
 * Custom Combat Tracker for Neuroshima 1.5.
 * Integrates Melee Duels directly above the initiative list for a unified view.
 */
export class NeuroshimaCombatTracker extends foundry.applications.sidebar.tabs.CombatTracker {
    /** @override */
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: ["neuroshima", "combat-tracker"],
        actions: {
            openDuel: function(event, target) {
                const duelId = target.dataset.duelId;
                game.neuroshima.log("CombatTracker | Akcja openDuel", { duelId });
                game.neuroshima.NeuroshimaMeleeDuelTracker.open(duelId);
            },
            finishDuel: async function(event, target) {
                const duelId = target.dataset.duelId;
                const combat = this.viewed;
                game.neuroshima.log("CombatTracker | Akcja finishDuel kliknięta", { duelId, combatId: combat?.id });
                
                const duel = game.neuroshima.NeuroshimaMeleeDuel.fromId(duelId, combat);
                if (duel) {
                    game.neuroshima.log("CombatTracker | Znaleziono pojedynek, wywołuję finish()");
                    await duel.finish();
                } else {
                    game.neuroshima.warn("CombatTracker | Nie znaleziono pojedynku o ID:", duelId);
                }
            }
        }
    });

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        
        // Find all active melee duels from combat flags
        const combat = this.viewed || game.combat;
        const duels = combat?.getFlag("neuroshima", "duels") || {};
        
        if (game.settings.get("neuroshima", "debugMode")) {
            console.log("Neuroshima | CombatTracker _prepareContext - duels found:", duels);
        }

        context.activeDuels = Object.values(duels).map(duel => {
            const phase = duel.phase || "initiative";
            const capitalizedPhase = phase.charAt(0).toUpperCase() + phase.slice(1);
            return {
                id: duel.id,
                attacker: duel.attacker,
                defender: duel.defender,
                turn: duel.turn,
                phase: phase,
                phaseLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposed.Phase${capitalizedPhase}`),
                status: duel.status,
                currentSegment: duel.currentSegment || 1,
                initiative: duel.initiative
            };
        });
        
        context.user = game.user;
        return context;
    }

    /** @override */
    async _onRender(context, options) {
        await super._onRender(context, options);
        
        if (game.settings.get("neuroshima", "debugMode")) {
            console.log("Neuroshima 1.5 | CombatTracker _onRender triggered", { context, element: this.element });
        }

        // Remove existing summary and status icons to avoid duplicates or leftovers
        this.element.querySelectorAll(".active-duels-wrapper").forEach(el => el.remove());
        this.element.querySelectorAll(".melee-status-icon").forEach(el => el.remove());

        // Add icons for combatants participating in an active melee duel
        const combat = this.viewed || game.combat;
        if (!combat) return;

        const duels = combat.getFlag("neuroshima", "duels") || {};
        game.neuroshima.log("CombatTracker | _onRender - Aktywne flagi duels:", duels);
        const participantUuids = new Set();
        
        for (const duel of Object.values(duels)) {
            if (duel.status === "finished") continue;
            if (duel.attacker?.tokenUuid) participantUuids.add(duel.attacker.tokenUuid);
            if (duel.attacker?.actorUuid) participantUuids.add(duel.attacker.actorUuid);
            if (duel.defender?.tokenUuid) participantUuids.add(duel.defender.tokenUuid);
            if (duel.defender?.actorUuid) participantUuids.add(duel.defender.actorUuid);
            
            // Also check current targets for the waiting-defender state
            if (duel.attackerTargets) {
                duel.attackerTargets.forEach(t => {
                    if (t.uuid) participantUuids.add(t.uuid);
                });
            }
        }

        // Select combatants (use more broad selectors for AppV2 in v13)
        const combatantList = this.element.querySelectorAll(".combatant, .combatant-item, [data-combatant-id]");
        combatantList.forEach(el => {
            const combatantId = el.dataset.combatantId || el.dataset.id;
            if (!combatantId) return;
            
            const combatant = combat.combatants.get(combatantId);
            if (!combatant) return;

            const isParticipant = participantUuids.has(combatant.token?.uuid) || 
                                participantUuids.has(combatant.actor?.uuid) ||
                                participantUuids.has(combatant.token?.document?.uuid) ||
                                participantUuids.has(combatant.sceneId ? `Scene.${combatant.sceneId}.Token.${combatant.tokenId}` : "");

            if (isParticipant) {
                // More generic name container selector for v13
                const nameHeader = el.querySelector(".name-container") || el.querySelector(".token-name") || el.querySelector(".name");
                if (nameHeader && !nameHeader.querySelector(".melee-status-icon")) {
                    const icon = document.createElement("i");
                    icon.className = "fas fa-hand-fist melee-status-icon";
                    icon.style.marginLeft = "8px";
                    icon.style.color = "var(--ns-text-accent, #ff4444)";
                    icon.title = game.i18n.localize("NEUROSHIMA.MeleeOpposed.Duel");
                    nameHeader.appendChild(icon);
                }
            }
        });

        if (!context.activeDuels?.length) return;

        // Render our summary template
        const summaryHtml = await foundry.applications.handlebars.renderTemplate("systems/neuroshima/templates/sidebar/melee-summary.hbs", context);
        
        // Insertion point (AppV2 often wraps content in specific containers)
        const insertionPoint = this.element.querySelector("ol, #combat-tracker, .directory-list") || this.element;
        
        if (insertionPoint) {
            insertionPoint.insertAdjacentHTML("afterbegin", summaryHtml);
        }
    }
}
