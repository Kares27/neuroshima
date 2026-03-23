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
      
      p.targetValue = baseTarget;
      p.attackBonusSnapshot = weapon?.system.attackBonus || 0;
      p.defenseBonusSnapshot = weapon?.system.defenseBonus || 0;
      
      // Calculate effective targets for attack and defense
      let attackManeuverBonus = 0;
      let defenseManeuverBonus = 0;
      if (maneuver === "furia" || maneuver === "fury") attackManeuverBonus = 2;
      if (maneuver === "fullDefense" || maneuver === "pelnaObrona") defenseManeuverBonus = 2;
      
      // We store the base targets plus weapon/maneuver bonuses. 
      // Dexterity penalties (crowding) and Increased Tempo will be applied during resolution.
      p.attackTargetSnapshot = baseTarget + p.attackBonusSnapshot + attackManeuverBonus;
      p.defenseTargetSnapshot = baseTarget + p.defenseBonusSnapshot + defenseManeuverBonus;
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
      
      // Build initiative order (descending)
      const sortedIds = Object.values(updated.participants)
        .filter(p => p.isActive)
        .sort((a, b) => b.initiative - a.initiative)
        .map(p => p.id);
      
      updated.turnState.initiativeOrder = sortedIds;
      updated.turnState.selectionTurn = sortedIds[0];

      // Automation: if only one possible target for a team, auto-set it for obvious 1v1 cases
      for (const pId in updated.participants) {
        const p = updated.participants[pId];
        if (!p.isActive) continue;
        const opposingTeam = p.team === "A" ? "B" : "A";
        const opponents = updated.teams[opposingTeam].filter(id => updated.participants[id]?.isActive);
        if (opponents.length === 1 && !updated.primaryTargets[pId]) {
          updated.primaryTargets[pId] = opponents[0];
        }
      }

      this.updateCrowding(updated);
      this._advanceTargetSelection(updated);
    }

    game.neuroshima?.log("Setting pool for participant", { id, participantId, results, maneuver });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Moves target selection to the next eligible participant in initiative order.
   * @private
   */
  static _advanceTargetSelection(encounter) {
    const order = encounter.turnState.initiativeOrder || [];
    const participants = encounter.participants;
    const primaryTargets = encounter.primaryTargets;

    // A participant is skipped if they are already being targeted by someone else 
    // AND they haven't set their target yet (the "attacked don't choose" rule).
    // Actually, the rule is: those who were attacked do not choose their opponent, 
    // unless they choose someone who is NOT attacking them? No, NS 1.5 is:
    // "zaatakowani nie wybierają przeciwnika".
    
    let nextId = null;
    for (const id of order) {
        if (!participants[id]?.isActive) continue;
        if (primaryTargets[id]) continue; // Already chosen

        const isAttacked = Object.values(primaryTargets).includes(id);
        if (isAttacked) {
            // "Zaatakowani nie wybierają" - we automatically set their target 
            // to whoever attacked them (if only one) or mark as 'handled'
            const attackers = Object.entries(primaryTargets)
                .filter(([aid, tid]) => tid === id)
                .map(([aid, tid]) => aid);
            
            if (attackers.length > 0) {
                primaryTargets[id] = attackers[0]; // Primary attacker
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
        // Everyone has a target or is attacked
        encounter.turnState.phase = "primary-attack-selection";
        encounter.turnState.selectionTurn = encounter.turnState.initiativeOwnerId;
        
        // Build the segmentQueue for the first segment
        this._buildSegmentQueue(encounter);
    }
  }

  /**
   * Builds the queue of primary exchanges for the current segment.
   * @private
   */
  static _buildSegmentQueue(encounter) {
      const queue = [];
      const handled = new Set();

      // Participants with initiative are attackers
      const attackerId = encounter.turnState.initiativeOwnerId;
      // This is slightly more complex in multi: NS 1.5 doesn't have a clear "all vs all" initiative order 
      // for WHO ATTACKS FIRST in a segment, it's usually the side with overall initiative.
      // We'll follow the initiativeOwnerId's team as primary attackers.
      
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
        .map(([attackerId, targetId]) => attackerId);

      const myTarget = encounter.primaryTargets[pId];
      const primaryOpponentId = targetingMe.includes(myTarget) ? myTarget : (targetingMe[0] || null);
      const extraAttackers = targetingMe.filter(id => id !== primaryOpponentId);

      // Rule: 1 enemy = 0 penalty, N>1 enemies = N penalty.
      let dexPenalty = 0;
      if (targetingMe.length > 1) {
          dexPenalty = targetingMe.length;
      }

      encounter.crowding[pId] = {
        primaryOpponentId,
        opponentCount: targetingMe.length,
        dexPenalty: dexPenalty,
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
   * Confirms defense selection and immediately triggers auto-resolution.
   * No "primary-ready" phase — resolution is fully automatic.
   */
  static async confirmDefense(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-defense-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;

    if (participantId !== exchange.defenderId) return;
    if (exchange.defenderSelectedDice.length !== exchange.declaredDiceCount) return;

    // Save the defender's dice selection first
    await MeleeStore.updateEncounter(id, updated);

    // Auto-resolve immediately (dynamic import avoids circular dependency)
    const { MeleeResolution } = await import("./melee-resolution.js");
    await MeleeResolution.resolvePrimaryExchange(id);
  }

  /**
   * Moves to the next segment or ends the turn if no dice are left.
   */
  static async advanceSegment(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    // X declared dice = X segments consumed; default to 1 for safety
    const cost = updated.turnState.segmentCost || 1;
    updated.turnState.segment += cost;
    updated.turnState.segmentCost = 0;

    // Reset exchange
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
      // End of turn, start new turn
      await this.startNewTurn(id);
    } else {
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      await MeleeStore.updateEncounter(id, updated);
    }
  }
}
