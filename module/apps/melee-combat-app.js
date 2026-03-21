import { NEUROSHIMA } from "../config.js";
import { MeleeStore } from "../combat/melee-store.js";
import { MeleeEncounter } from "../combat/melee-encounter.js";
import { MeleeTurnService } from "../combat/melee-turn-service.js";
import { MeleeResolution } from "../combat/melee-resolution.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Modern Melee Encounter Application (ApplicationV2)
 * Manages the UI for group and duel melee combat.
 */
export class MeleeCombatApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(encounterId, options = {}) {
    super(options);
    this.encounterId = encounterId;
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    window: {
      title: "NEUROSHIMA.MeleeDuel.Title",
      resizable: true,
      icon: "fas fa-swords"
    },
    position: {
      width: 900,
      height: 700
    },
    actions: {
      openPoolDialog: function(event, target) {
        return this._onOpenPoolDialog(target.dataset.id);
      },
      selectTarget: function(event, target) {
        return MeleeTurnService.setTarget(this.encounterId, target.dataset.id, target.dataset.targetId);
      },
      selectDie: function(event, target) {
        return MeleeTurnService.selectDie(this.encounterId, target.dataset.id, parseInt(target.dataset.index));
      },
      confirmAttack: function(event, target) {
        return MeleeTurnService.confirmAttack(this.encounterId, target.dataset.id);
      },
      confirmDefense: function(event, target) {
        return MeleeTurnService.confirmDefense(this.encounterId, target.dataset.id);
      },
      resolveExchange: function(event, target) {
        return MeleeResolution.resolvePrimaryExchange(this.encounterId);
      },
      resolveExtraAttacks: function() {
        return MeleeResolution.resolveExtraAttacks(this.encounterId);
      },
      advanceSegment: function() {
        return MeleeTurnService.advanceSegment(this.encounterId);
      },
      endEncounter: function() {
        return MeleeEncounter.end(this.encounterId);
      },
      resetTurn: function() {
        return MeleeTurnService.startNewTurn(this.encounterId);
      },
      closeApp: function() {
        this.close();
      }
    }
  };

  static PARTS = {
    main: {
      template: "systems/neuroshima/templates/apps/melee/melee-app.hbs"
    }
  };

  /** @override */
  get id() {
    return `melee-encounter-${this.encounterId}`;
  }

  /** @override */
  async _prepareContext(options) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    if (!encounter) return { active: false };

    // Enrichment for templates
    const context = foundry.utils.deepClone(encounter);
    context.isGM = game.user.isGM;
    
    // Add participant ownership and extra data
    for (const pId in context.participants) {
      const p = context.participants[pId];
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      p.isOwner = actor?.isOwner;
      p.isUserCharacter = game.user.character?.uuid === p.actorUuid;
      
      // Target information
      const targetId = context.primaryTargets[pId];
      p.targetName = context.participants[targetId]?.name || "";

      // Crowding information
      const crowd = context.crowding[pId];
      p.isCrowded = crowd?.opponentCount > 1;
      p.dexPenalty = crowd?.dexPenalty || 0;
      p.primaryOpponentName = context.participants[crowd?.primaryOpponentId]?.name || "";

      // Status Badge
      p.statusBadge = this._getParticipantStatusBadge(p, context);
      
      // Calculate effective target (snapshot or dynamic)
      p.attackTarget = p.attackTargetSnapshot || p.targetValue || 10;
      p.defenseTarget = p.defenseTargetSnapshot || p.targetValue || 10;
      
      if (p.dexPenalty) {
          p.attackTarget -= p.dexPenalty;
          p.defenseTarget -= p.dexPenalty;
      }
      
      // Determine which target to show/use for dice coloring
      const isAttacker = pId === exchange.attackerId || (phase === "primary-attack-selection" && pId === selectionTurn);
      p.currentEffectiveTarget = isAttacker ? p.attackTarget : p.defenseTarget;
      
      // Prepare selected dice information for templates
      p.selectedDiceIndices = [];
      const phase = context.turnState.phase;
      const selectionTurn = context.turnState.selectionTurn;
      const exchange = context.currentExchange;
      
      if (phase === "primary-attack-selection" && pId === context.turnState.initiativeOwnerId) {
        p.selectedDiceIndices = exchange.attackerSelectedDice || [];
      } else if (phase === "primary-defense-selection" && pId === selectionTurn) {
        p.selectedDiceIndices = exchange.defenderSelectedDice || [];
      } else if (pId === exchange.attackerId) {
        p.selectedDiceIndices = exchange.attackerSelectedDice || [];
      } else if (pId === exchange.defenderId) {
        p.selectedDiceIndices = exchange.defenderSelectedDice || [];
      }
      
      game.neuroshima?.log(`Participant ${p.name} context:`, {
          pId,
          selected: p.selectedDiceIndices,
          attackerSelectedDice: exchange.attackerSelectedDice,
          phase
      });
    }

    // Map teams to full participant objects and sort by initiative
    const sortByInitiative = (a, b) => (b.initiative || 0) - (a.initiative || 0);
    
    game.neuroshima?.log("Melee _prepareContext | debug", {
        teams: context.teams,
        participantIds: Object.keys(context.participants || {}),
        teamA: context.teams.A,
        teamB: context.teams.B,
        allParticipants: context.participants
    });

    context.teamsData = {
      A: (context.teams.A || []).map(id => context.participants[id]).filter(Boolean).sort(sortByInitiative),
      B: (context.teams.B || []).map(id => context.participants[id]).filter(Boolean).sort(sortByInitiative)
    };

    // Current exchange participants
    context.attacker = context.currentExchange.attackerId ? context.participants[context.currentExchange.attackerId] : null;
    context.defender = context.currentExchange.defenderId ? context.participants[context.currentExchange.defenderId] : null;

    context.currentPrompt = this._getPhasePrompt(context);

    return context;
  }

  /**
   * Returns a status badge for a participant based on current phase and context.
   * @private
   */
  _getParticipantStatusBadge(p, context) {
    const phase = context.turnState.phase;
    const selectionTurn = context.turnState.selectionTurn;
    const exchange = context.currentExchange;
    const crowd = context.crowding[p.id];

    if (!p.isActive) return { label: "Nieaktywny", class: "inactive" };
    if (!p.pool?.length) return { label: "Czeka na rzut", class: "waiting" };

    if (phase === "target-selection") {
      return context.primaryTargets[p.id] ? { label: "Cel wybrany", class: "ready" } : { label: "Wybierz cel", class: "active" };
    }

    if (p.id === exchange.attackerId) return { label: "Atakujący", class: "attacker" };
    if (p.id === exchange.defenderId) return { label: "Obrońca", class: "defender" };

    if (crowd?.opponentCount > 1) {
      if (p.id === crowd.primaryOpponentId) return { label: "Główny przeciwnik", class: "primary" };
      return { label: "Osaczony", class: "crowded" };
    }

    if (crowd?.extraAttackers?.includes(selectionTurn)) return { label: "Dodatkowy napastnik", class: "extra" };

    return { label: "Czeka", class: "waiting" };
  }

  /**
   * Generates a user-friendly instruction based on the current phase.
   * @private
   */
  _getPhasePrompt(context) {
    const phase = context.turnState.phase;
    const selectionTurnId = context.turnState.selectionTurn;
    const participant = context.participants[selectionTurnId];
    const name = participant?.name || "Ktoś";

    switch (phase) {
      case "awaiting-pool-rolls":
        const waitingCount = Object.values(context.participants).filter(p => !p.isActive || !p.pool?.length).length;
        return `Wszyscy rzucają 3k20 (Czeka: ${waitingCount})`;
      
      case "target-selection":
        return `Wybierzcie głównych przeciwników`;

      case "primary-attack-selection":
        return `${name} wybiera kości ataku`;
      
      case "primary-defense-selection":
        return `${name} wybiera kości obrony`;
      
      case "primary-ready":
        return "Główna wymiana gotowa! MG może ją rozstrzygnąć.";
      
      case "extra-attacks":
        return "Czas na dodatkowe ataki i darmowe obrony.";

      default:
        return "Inicjalizacja...";
    }
  }

  /**
   * Opens the 3k20 pool roll dialog with maneuver selection.
   */
  async _onOpenPoolDialog(participantId) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    const p = encounter?.participants[participantId];
    if (!p) return;

    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    const weapon = actor?.items.get(p.weaponId);

    const { NeuroshimaWeaponRollDialog } = await import("./weapon-roll-dialog.js");
    const dialog = new NeuroshimaWeaponRollDialog({
      actor,
      weapon,
      rollType: "melee",
      isPoolRoll: true,
      onRoll: async (rollResult) => {
        if (!rollResult) return;
        const results = (rollResult.modifiedResults || rollResult.results || rollResult.rawResults || []).map(r => typeof r === "object" ? r.original : r);
        const maneuver = rollResult.maneuver || "none";
        const tempoLevel = rollResult.tempoLevel || 0;
        await MeleeTurnService.setPool(this.encounterId, participantId, results, maneuver, tempoLevel);
      }
    });
    dialog.render(true);
  }

  /**
   * Hook for real-time updates.
   */
  static registerHooks() {
    Hooks.on("updateCombat", (combat, updates, options, userId) => {
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof MeleeCombatApp) {
          const encounter = MeleeStore.getEncounter(app.encounterId);
          if (!encounter) {
            game.neuroshima?.log(`Closing MeleeCombatApp ${app.encounterId} because encounter was deleted.`);
            app.close();
          } else {
            app.render();
          }
        }
      }
    });
  }
}
