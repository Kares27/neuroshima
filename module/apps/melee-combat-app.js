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
      selectDie: function(event, target) {
        return this._onSelectDie(target.dataset.id, parseInt(target.dataset.index));
      },
      declareAttack: function(event, target) {
        return this._onDeclareAttack(target.dataset.id, parseInt(target.dataset.dice));
      },
      confirmSelection: function(event, target) {
        return this._onConfirmSelection(target.dataset.id);
      },
      resolveExchange: function(event, target) {
        return MeleeResolution.resolveExchange(this.encounterId);
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
      
      // Calculate effective target (snapshot or dynamic)
      p.effectiveTarget = p.effectiveTargetSnapshot || p.targetValue || 10;
      
      // Prepare selected dice information for templates
      p.selectedDiceIndices = [];
      if (pId === context.currentExchange.attackerId) {
        p.selectedDiceIndices = context.currentExchange.attackerSelectedDice || [];
      } else if (pId === context.currentExchange.defenderId) {
        p.selectedDiceIndices = context.currentExchange.defenderSelectedDice || [];
      }
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
        const waitingCount = Object.values(context.participants).filter(p => !p.pool?.length).length;
        return `Oczekiwanie na rzut puli 3k20 (${waitingCount} uczestników)`;
      
      case "exchange-declaration":
        return `Kolej ${name}: Wybierz typ ataku (1s / 2s / 3s)`;
      
      case "exchange-attacker-selection":
        const reqAttacker = context.currentExchange.declaredDiceCount || 0;
        const currentAttacker = context.currentExchange.attackerSelectedDice?.length || 0;
        return `${name}: Wybierz ${reqAttacker} kości ataku (${currentAttacker}/${reqAttacker})`;
      
      case "exchange-defender-selection":
        const reqDefender = context.currentExchange.declaredDiceCount || 0;
        const currentDefender = context.currentExchange.defenderSelectedDice?.length || 0;
        return `${name}: Wybierz ${reqDefender} kości obrony (${currentDefender}/${reqDefender})`;
      
      case "exchange-ready":
        return "Wymiana gotowa! MG może ją rozstrzygnąć.";
      
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
   * Handles die selection for attack or defense.
   */
  async _onSelectDie(participantId, index) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const p = updated.participants[participantId];
    if (!p || p.usedDice.includes(index)) return;

    const exchange = updated.currentExchange;
    const phase = updated.turnState.phase;
    let roleKey = null;
    
    // Strict phase checks for die selection
    if (phase === "exchange-attacker-selection" && participantId === exchange.attackerId) {
        roleKey = "attackerSelectedDice";
    } else if (phase === "exchange-defender-selection" && participantId === exchange.defenderId) {
        roleKey = "defenderSelectedDice";
    }
    
    if (!roleKey) {
        game.neuroshima?.warn("SelectDie | Selection not allowed at this phase/participant.", { phase, participantId });
        return; 
    }

    if (exchange[roleKey].includes(index)) {
      exchange[roleKey] = exchange[roleKey].filter(i => i !== index);
    } else {
      // Don't allow selecting more than declared dice count
      if (exchange[roleKey].length < exchange.declaredDiceCount) {
          exchange[roleKey].push(index);
      }
    }

    // Auto-advance phases if side is done
    if (phase === "exchange-attacker-selection" && exchange.attackerSelectedDice.length === exchange.declaredDiceCount) {
        updated.turnState.phase = "exchange-defender-selection";
        updated.turnState.selectionTurn = exchange.defenderId;
    } else if (phase === "exchange-defender-selection" && exchange.defenderSelectedDice.length === exchange.declaredDiceCount) {
        updated.turnState.phase = "exchange-ready";
        updated.turnState.selectionTurn = null;
    }

    await MeleeStore.updateEncounter(this.encounterId, updated);
  }

  /**
   * Declares an attack (1s, 2s, 3s).
   */
  async _onDeclareAttack(participantId, diceCount) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    if (!encounter || encounter.turnState.phase !== "exchange-declaration") return;

    const updated = foundry.utils.deepClone(encounter);
    const attacker = updated.participants[participantId];
    if (!attacker) return;

    // Use currentTargetId if set, otherwise find a target from the opposing team
    let targetId = attacker.currentTargetId;
    if (!targetId || !updated.participants[targetId]) {
      const opposingTeam = attacker.team === "A" ? "B" : "A";
      targetId = updated.teams[opposingTeam].find(id => updated.participants[id]?.isActive);
    }

    if (!targetId) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NoTargetFound"));
      return;
    }

    game.neuroshima?.log("Declaring melee attack", { participantId, targetId, diceCount });
    updated.currentExchange.attackerId = participantId;
    updated.currentExchange.defenderId = targetId;
    updated.currentExchange.declaredAction = "attack";
    updated.currentExchange.declaredDiceCount = diceCount;
    updated.turnState.phase = "exchange-attacker-selection";
    updated.turnState.selectionTurn = participantId;

    await MeleeStore.updateEncounter(this.encounterId, updated);
  }

  /**
   * Confirms selection and potentially triggers resolution if both sides are ready.
   */
  async _onConfirmSelection(participantId) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    if (!encounter) return;

    if (encounter.turnState.phase !== "exchange-ready") {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.ExchangeNotReady"));
        return;
    }

    game.neuroshima?.log("Confirming selection in melee exchange", { participantId, isGM: game.user.isGM });
    if (game.user.isGM) {
        await MeleeResolution.resolveExchange(this.encounterId);
    } else {
        ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeDuel.WaitingForGM"));
    }
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
