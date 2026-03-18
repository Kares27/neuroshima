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

    // Map teams to full participant objects for easier template access
    context.teamsData = {
      A: context.teams.A.map(id => context.participants[id]).filter(Boolean),
      B: context.teams.B.map(id => context.participants[id]).filter(Boolean)
    };

    // Current exchange participants
    context.attacker = context.currentExchange.attackerId ? context.participants[context.currentExchange.attackerId] : null;
    context.defender = context.currentExchange.defenderId ? context.participants[context.currentExchange.defenderId] : null;

    return context;
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
        const results = rollResult.rolls.map(r => r.result);
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
    let roleKey = null;
    
    if (participantId === exchange.attackerId) roleKey = "attackerSelectedDice";
    else if (participantId === exchange.defenderId) roleKey = "defenderSelectedDice";
    
    if (!roleKey) return; // Participant not in current exchange

    if (exchange[roleKey].includes(index)) {
      exchange[roleKey] = exchange[roleKey].filter(i => i !== index);
    } else {
      exchange[roleKey].push(index);
    }

    await MeleeStore.updateEncounter(this.encounterId, updated);
  }

  /**
   * Declares an attack (1s, 2s, 3s).
   */
  async _onDeclareAttack(participantId, diceCount) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    if (!encounter) return;

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
    updated.turnState.phase = "exchange-response";
    updated.turnState.selectionTurn = targetId;

    await MeleeStore.updateEncounter(this.encounterId, updated);
  }

  /**
   * Confirms selection and potentially triggers resolution if both sides are ready.
   */
  async _onConfirmSelection(participantId) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    if (!encounter) return;

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
          app.render();
        }
      }
    });
  }
}
