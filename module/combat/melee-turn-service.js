import { MeleeStore } from "./melee-store.js";

/**
 * Handles turn transitions, segment resets, and maneuver application for Melee Encounters.
 */
export class MeleeTurnService {
  /**
   * Resets the encounter state for a new turn.
   */
  static async startNewTurn(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    updated.turnState.turn += 1;
    updated.turnState.segment = 1;
    updated.turnState.phase = "awaiting-pool-rolls";
    updated.turnState.selectionTurn = null;

    // Reset pool data for all participants
    for (const pId in updated.participants) {
      const p = updated.participants[pId];
      p.pool = [];
      p.usedDice = [];
      p.skillSpent = 0;
      p.maneuver = "none"; // Maneuvers are chosen at the start of each turn
      p.tempoLevel = 0;
    }

    updated.log.push({
      type: "system",
      segment: 1,
      text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogNewTurn", { turn: updated.turnState.turn })
    });

    game.neuroshima?.log("Starting new turn for melee encounter", { id, turn: updated.turnState.turn });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Sets the 3k20 pool for a participant and snapshots their combat values for the turn.
   */
  static async setPool(id, participantId, results, maneuver = "none", tempoLevel = 0) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const p = updated.participants[participantId];
    if (!p) return;

    // Fetch actor to calculate current snapshots
    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    
    if (actor) {
      const weapon = actor.items.get(p.weaponId);
      const attribute = weapon?.system.attribute || "dexterity";
      const baseTarget = actor.system.attributeTotals?.[attribute] || 10;
      
      // Calculate effective target with current wounds/armor and maneuver bonuses
      let maneuverBonus = 0;
      if (maneuver === "fury" || maneuver === "fullDefense") maneuverBonus = 2;
      
      p.targetValue = baseTarget;
      p.attackBonusSnapshot = weapon?.system.attackBonus || 0;
      p.defenseBonusSnapshot = weapon?.system.defenseBonus || 0;
      
      // Initial effective target (will be shifted by Increased Tempo during resolution)
      p.effectiveTargetSnapshot = baseTarget + maneuverBonus;
    }

    p.pool = results;
    p.maneuver = maneuver;
    p.tempoLevel = tempoLevel;
    p.usedDice = [];
    p.skillSpent = 0;

    // Check if all active participants have rolled their pools
    const allRolled = Object.values(updated.participants).every(p => !p.isActive || p.pool.length > 0);
    if (allRolled) {
      updated.turnState.phase = "target-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;

      // Automation: if only one possible target for a team, auto-set it
      for (const pId in updated.participants) {
        const p = updated.participants[pId];
        const opposingTeam = p.team === "A" ? "B" : "A";
        const opponents = updated.teams[opposingTeam].filter(id => updated.participants[id]?.isActive);
        if (opponents.length === 1) {
          updated.primaryTargets[pId] = opponents[0];
        }
      }

      this.updateCrowding(updated);

      // Re-check if everyone chose their target
      const allTargetsSet = Object.values(updated.participants).every(p => !p.isActive || updated.primaryTargets[p.id]);
      if (allTargetsSet) {
        updated.turnState.phase = "primary-attack-selection";
        updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      }
    }

    game.neuroshima?.log("Setting pool for participant", { id, participantId, results, maneuver });
    await MeleeStore.updateEncounter(id, updated);
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

    // Automation: if everyone chose their target, move to primary-attack-selection
    const allTargetsSet = Object.values(updated.participants).every(p => !p.isActive || updated.primaryTargets[p.id]);
    if (allTargetsSet) {
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
    }

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
        .map(([attackerId, targetId]) => attackerId);

      const myTarget = encounter.primaryTargets[pId];
      const primaryOpponentId = targetingMe.includes(myTarget) ? myTarget : (targetingMe[0] || null);
      const extraAttackers = targetingMe.filter(id => id !== primaryOpponentId);

      encounter.crowding[pId] = {
        primaryOpponentId,
        opponentCount: targetingMe.length,
        dexPenalty: Math.max(0, targetingMe.length - 1),
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
    if (phase === "primary-attack-selection" && participantId === updated.turnState.initiativeOwnerId) {
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
      // Limit to 3 dice
      if (exchange[roleKey].length < 3) {
        exchange[roleKey].push(index);
      }
    }

    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Confirms attack selection and moves to defense selection.
   */
  static async confirmAttack(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-attack-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;
    
    if (participantId !== updated.turnState.initiativeOwnerId) return;
    if (exchange.attackerSelectedDice.length === 0) return;

    exchange.attackerId = participantId;
    exchange.declaredDiceCount = exchange.attackerSelectedDice.length;
    exchange.defenderId = updated.primaryTargets[participantId];
    
    updated.turnState.phase = "primary-defense-selection";
    updated.turnState.selectionTurn = exchange.defenderId;

    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Confirms defense selection and moves to primary-ready.
   */
  static async confirmDefense(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-defense-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;

    if (participantId !== exchange.defenderId) return;
    if (exchange.defenderSelectedDice.length !== exchange.declaredDiceCount) return;

    updated.turnState.phase = "primary-ready";
    updated.turnState.selectionTurn = null;

    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Moves to the next segment or ends the turn if no dice are left.
   */
  static async advanceSegment(id, cost = 1) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    updated.turnState.segment += cost;

    if (updated.turnState.segment > 3) {
      // End of turn, start new turn
      await this.startNewTurn(id);
    } else {
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      await MeleeStore.updateEncounter(id, updated);
    }
  }
}
