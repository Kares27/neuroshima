/**
 * Custom Combat Tracker for Neuroshima 1.5.
 * Extends the native Combat Tracker to include a Melee Duel tab.
 * Uses CSS visibility toggling to preserve native Foundry behavior.
 */
export class NeuroshimaCombatTracker extends foundry.applications.sidebar.tabs.CombatTracker {
    constructor(options) {
        super(options);
        this._view = "encounter"; // "encounter" lub "melee"
    }

    /** @override */
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: ["neuroshima", "combat-tracker"],
        actions: {
            "open-melee": NeuroshimaCombatTracker.prototype._onOpenMelee,
            "set-view": NeuroshimaCombatTracker.prototype._onSetView,
            "join-melee": NeuroshimaCombatTracker.prototype._onJoinMelee,
            "dismiss-melee": NeuroshimaCombatTracker.prototype._onDismissMelee,
            "delete-duel": NeuroshimaCombatTracker.prototype._onDeleteDuel
        }
    });

    /** @override */
    static PARTS = {
        tabs: {
            template: "systems/neuroshima/templates/sidebar/combat-tracker-tabs.hbs"
        },
        header: {
            template: "templates/sidebar/tabs/combat/header.hbs"
        },
        tracker: {
            template: "templates/sidebar/tabs/combat/tracker.hbs"
        },
        melee: {
            template: "systems/neuroshima/templates/sidebar/melee-view.hbs"
        },
        footer: {
            template: "templates/sidebar/tabs/combat/footer.hbs"
        }
    };

    /** @override */
    async _onRender(context, options) {
        await super._onRender(context, options);
        this.element.dataset.view = this._view;

        // Oznacz uczestników starć w widoku listy (Encounter)
        if (this._view === "encounter") {
            const combat = this.viewed;
            if (!combat) return;
            
            const encounters = combat.getFlag("neuroshima", "meleeEncounters") || {};
            const pendings = combat.getFlag("neuroshima", "meleePendings") || {};
            const activeEncounters = Object.values(encounters);
            const activePendings = Object.values(pendings).filter(p => p.active);

            this.element.querySelectorAll(".combatant").forEach(li => {
                const combatantId = li.dataset.combatantId;
                const combatant = combat.combatants.get(combatantId);
                if (!combatant) return;

                const isMelee = activeEncounters.some(e => 
                    Object.values(e.participants).some(p => p.actorUuid === combatant.actorId)
                );
                const isPending = activePendings.some(p => 
                    p.attackerId === combatant.actorId || p.defenderId === combatant.actorId
                );

                if (isMelee) li.classList.add("melee-active");
                if (isPending) li.classList.add("melee-pending");
            });
        }
    }

    /**
     * Przełącza widok trackera.
     */
    _onSetView(event, target) {
        event.preventDefault();
        this._view = target.dataset.tab;
        this.render(true);
    }

    /**
     * Akcja otwarcia interfejsu walki.
     */
    async _onOpenMelee(event, target) {
        event.preventDefault();
        const duelId = target.dataset.duelId;
        const { NeuroshimaMeleeCombat } = await import("./melee-combat.js");
        await NeuroshimaMeleeCombat.openMeleeApp(duelId);
    }

    /**
     * Akcja dołączenia do starcia (dla obrońcy).
     */
    async _onJoinMelee(event, target) {
        event.preventDefault();
        const pendingUuid = target.dataset.pendingId;
        const pendingKey = pendingUuid.replace(/\./g, "-");
        const combat = this.viewed;
        const pending = combat?.getFlag("neuroshima", `meleePendings.${pendingKey}`);
        if (!pending) return;

        const doc = fromUuidSync(pending.defenderId);
        const actualActor = doc?.actor || doc;
        
        if (actualActor) {
            // Otwórz arkusz na zakładce walki, aby gracz mógł rzucić na broń
            const sheet = actualActor.sheet;
            await sheet.render(true, { focus: true });
            // Przełącz na zakładkę combat
            sheet.tabGroups.primary = "combat";
            sheet.render();
            
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.InstructionDefender"));
        }
    }

    /**
     * Akcja odrzucenia starcia.
     */
    async _onDismissMelee(event, target) {
        event.preventDefault();
        const pendingUuid = target.dataset.pendingId;
        const { NeuroshimaMeleeCombat } = await import("./melee-combat.js");
        await NeuroshimaMeleeCombat.dismissMeleePending(pendingUuid);
    }

    /**
     * Akcja usunięcia aktywnego pojedynku (tylko GM).
     */
    async _onDeleteDuel(event, target) {
        event.preventDefault();
        event.stopPropagation();
        if (!game.user.isGM) return;
        
        const duelId = target.dataset.duelId;
        const { NeuroshimaMeleeCombat } = await import("./melee-combat.js");
        await NeuroshimaMeleeCombat.dismissMeleeDuel(duelId);
    }

    /** @override */
    async _prepareContext(options) {
        let context;
        try {
            context = await super._prepareContext(options);
        } catch (e) {
            game.neuroshima.error("Błąd super._prepareContext w Combat Trackerze:", e);
            context = { turns: [] };
        }
        
        context.user = game.user;
        context.currentView = this._view;

        // Pobierz wszystkie starcia i oczekujące starcia
        const combat = this.viewed;
        const encounters = combat?.getFlag("neuroshima", "meleeEncounters") || {};
        const pendings = combat?.getFlag("neuroshima", "meleePendings") || {};
        
        context.activeMeleeEncounters = Object.values(encounters);
        context.pendingMeleeDuels = Object.values(pendings).filter(p => p.active);
        
        // Dla widoku mini bierzemy pierwszy aktywny encounter
        const userActorUuid = game.user.character?.uuid;
        context.activeMeleeEncounter = context.activeMeleeEncounters.find(e => 
            game.user.isGM || Object.values(e.participants).some(p => p.actorUuid === userActorUuid)
        );

        // Oznacz uczestników starć w widoku listy
        if (context.turns && Array.isArray(context.turns)) {
            context.turns.forEach(turn => {
                const combatant = combat.combatants.get(turn.id);
                if (!combatant) return;

                const actorUuid = combatant.actor?.uuid;
                if (!actorUuid) return;

                // Sprawdź czy aktor jest w którymkolwiek aktywnym encounterze
                turn.isMeleeDuelParticipant = context.activeMeleeEncounters.some(e => 
                    Object.values(e.participants).some(p => p.actorUuid === actorUuid)
                );

                // Sprawdź czy aktor jest w którymkolwiek oczekującym starciu
                turn.isMeleePendingParticipant = context.pendingMeleeDuels.some(p => 
                    p.attackerId === actorUuid || p.defenderId === actorUuid
                );
            });
        }
        
        return context;
    }
}
