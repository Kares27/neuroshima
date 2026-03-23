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
    const phase = context.turnState.phase;
    const selectionTurn = context.turnState.selectionTurn;
    const exchange = context.currentExchange;

    for (const pId in context.participants) {
      const p = context.participants[pId];
      p.id = pId;
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      p.isOwner = actor?.isOwner;
      p.isUserCharacter = game.user.character?.uuid === p.actorUuid;
      
      const weapon = actor?.items.get(p.weaponId);
      p.weaponName = weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed");
      p.maneuverLabel = p.maneuver && p.maneuver !== "none" 
        ? game.i18n.localize(`NEUROSHIMA.Roll.Maneuvers.${p.maneuver.charAt(0).toUpperCase() + p.maneuver.slice(1)}`) 
        : game.i18n.localize("NEUROSHIMA.Roll.Maneuvers.None");

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
      
      // Permissions and Actions
      p.canRollPool = p.isOwner && p.pool.length === 0 && phase === "awaiting-pool-rolls";
      p.canChooseTarget = p.isOwner && phase === "target-selection" && selectionTurn === pId;
      
      if (p.canChooseTarget) {
          const opposingTeam = p.team === "A" ? "B" : "A";
          p.availableTargets = (context.teams[opposingTeam] || [])
            .map(id => context.participants[id])
            .filter(opp => opp && opp.isActive);
      }

      p.canConfirmAttack = p.isOwner && phase === "primary-attack-selection" && selectionTurn === pId && exchange.attackerSelectedDice.length > 0;
      p.pendingAttackStrength = exchange.attackerSelectedDice.length;
      
      p.canConfirmDefense = p.isOwner && phase === "primary-defense-selection" && selectionTurn === pId && exchange.defenderSelectedDice.length === exchange.declaredDiceCount;

      // Prepare selected dice information for templates
      p.selectedDiceIndices = [];
      
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

    // Global Labels
    context.phaseLabel = game.i18n.localize(`NEUROSHIMA.MeleeDuel.Phase.${phase}`) || phase;
    context.initiativeOwnerName = context.participants[context.turnState.initiativeOwnerId]?.name || "---";

    // Prompt Header
    const promptData = this._getDetailedPrompt(context);
    context.promptTitle = promptData.title;
    context.promptTone = promptData.tone;
    context.currentPrompt = promptData.text;

    // Extra Attacks Enrichment
    context.extraAttackCards = (context.extraAttackQueue || []).map(entry => {
      const attacker = context.participants[entry.attackerId];
      const defender = context.participants[entry.defenderId];
      return {
        ...entry,
        attackerName: attacker?.name || "Nieznany",
        defenderName: defender?.name || "Nieznany",
        resultClass: entry.resolved ? (entry.result?.hit ? "is-hit" : "is-blocked") : "is-pending"
      };
    });

    // Current exchange participants
    context.attacker = exchange.attackerId ? context.participants[exchange.attackerId] : (phase === "primary-attack-selection" ? context.participants[selectionTurn] : null);
    context.defender = exchange.defenderId ? context.participants[exchange.defenderId] : (phase === "primary-defense-selection" ? context.participants[selectionTurn] : null);

    // Segment progress dots for header visualization
    const currentSeg = context.turnState.segment || 1;
    context.segmentDots = [1, 2, 3].map(i => ({
      number: i,
      state: i < currentSeg ? "done" : i === currentSeg ? "active" : "pending"
    }));

    // User role & turn detection (client-side: game.user is local)
    let myRole = "observer";
    let isMyTurn = false;
    for (const pId in context.participants) {
      const p = context.participants[pId];
      if (!p.isOwner) continue;
      if (pId === exchange.attackerId) myRole = "attacker";
      else if (pId === exchange.defenderId) myRole = "defender";
      if (pId === selectionTurn) isMyTurn = true;
    }
    context.isMyTurn = isMyTurn;
    context.myRole = myRole;

    // Damage preview from active attacker's weapon (for exchange banner and confirm button)
    if (exchange.attackerId) {
      const attackerP = context.participants[exchange.attackerId];
      if (attackerP) {
        const aDoc = fromUuidSync(attackerP.actorUuid);
        const aActor = aDoc?.actor || aDoc;
        const aWeapon = aActor?.items.get(attackerP.weaponId);
        if (aWeapon?.system) {
          context.attackDamagePreview = {
            s1: aWeapon.system.damageMelee1 || "D",
            s2: aWeapon.system.damageMelee2 || "L",
            s3: aWeapon.system.damageMelee3 || "C"
          };
          const key = `s${exchange.declaredDiceCount}`;
          context.currentDamageLabel = context.attackDamagePreview[key] || "";
        }
      }
    }

    // Per-participant damage preview (for confirm attack button)
    for (const pId in context.participants) {
      const p = context.participants[pId];
      const pDoc = fromUuidSync(p.actorUuid);
      const pActor = pDoc?.actor || pDoc;
      const pWeapon = pActor?.items.get(p.weaponId);
      p.damageMeleePreview = {
        s1: pWeapon?.system?.damageMelee1 || "D",
        s2: pWeapon?.system?.damageMelee2 || "L",
        s3: pWeapon?.system?.damageMelee3 || "C"
      };
    }

    // Personalized action hint for the local user
    context.userActionHint = this._getUserActionHint(context);

    return context;
  }

  /**
   * Returns a personalized action hint for the local user based on the current phase.
   * @private
   */
  _getUserActionHint(context) {
    const phase = context.turnState.phase;
    const exchange = context.currentExchange;
    const needed = exchange.declaredDiceCount || 0;

    if (phase === "awaiting-pool-rolls") {
      const needsRoll = Object.values(context.participants).some(p => p.isOwner && p.pool.length === 0);
      if (needsRoll) return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.RollPool"), urgent: true };
      return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingPool"), urgent: false };
    }

    if (phase === "target-selection") {
      const myTurnParticipant = Object.values(context.participants).find(p => p.isOwner && p.canChooseTarget);
      if (myTurnParticipant) return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.ChooseTarget"), urgent: true };
      return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingTarget"), urgent: false };
    }

    if (phase === "primary-attack-selection") {
      if (context.isMyTurn) return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.SelectAttack"), urgent: true };
      return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingAttack"), urgent: false };
    }

    if (phase === "primary-defense-selection") {
      if (context.isMyTurn) return { text: game.i18n.format("NEUROSHIMA.MeleeDuel.Hint.SelectDefense", { count: needed }), urgent: true };
      return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingDefense"), urgent: false };
    }

    if (phase === "primary-ready") {
      if (context.isGM) return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.ResolveReady"), urgent: true };
      return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingResolve"), urgent: false };
    }

    if (phase === "segment-end") {
      if (context.isGM) {
        const key = context.turnState.segment < 3 ? "NEUROSHIMA.MeleeDuel.Hint.NextSegment" : "NEUROSHIMA.MeleeDuel.Hint.EndTurn";
        return { text: game.i18n.localize(key), urgent: true };
      }
      return { text: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingGM"), urgent: false };
    }

    return { text: "", urgent: false };
  }

  /**
   * Generates detailed prompt info.
   * @private
   */
  _getDetailedPrompt(context) {
    const phase = context.turnState.phase;
    const selectionTurnId = context.turnState.selectionTurn;
    const participant = context.participants[selectionTurnId];
    const name = participant?.name || "Ktoś";

    const data = {
        title: game.i18n.localize("NEUROSHIMA.MeleeDuel.Title"),
        tone: "neutral",
        text: ""
    };

    switch (phase) {
      case "awaiting-pool-rolls":
        data.title = "Początek tury";
        data.tone = "info";
        const waitingCount = Object.values(context.participants).filter(p => !p.isActive || !p.pool?.length).length;
        data.text = `Wszyscy wybierają manewr i rzucają 3k20 (Czeka: ${waitingCount})`;
        break;
      
      case "target-selection":
        data.title = "Wybór przeciwników";
        data.tone = "action";
        data.text = `${name}: Wybierz swojego głównego przeciwnika`;
        break;

      case "primary-attack-selection":
        data.title = "Atak";
        data.tone = "attacker";
        data.text = `${name} wybiera kości ataku`;
        break;
      
      case "primary-defense-selection":
        data.title = "Obrona";
        data.tone = "defender";
        data.text = `${name} wybiera kości obrony`;
        break;
      
      case "primary-ready":
        data.title = "Gotowość";
        data.tone = "ready";
        data.text = "Wymiana gotowa do rozstrzygnięcia przez MG.";
        break;
      
      case "extra-attacks":
        data.title = "Grad ciosów";
        data.tone = "danger";
        data.text = "Dodatkowi napastnicy wykonują ataki. Osaczony broni się darmową obroną.";
        break;
      
      case "segment-end":
        data.title = "Koniec segmentu";
        data.tone = "success";
        data.text = context.turnState.segment < 3 ? "Segment zakończony. Przejdź do kolejnego." : "Tura zakończona. Przygotuj nową pulę.";
        break;

      default:
        data.text = "Inicjalizacja...";
    }
    return data;
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
