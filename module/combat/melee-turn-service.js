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
      updated.turnState.phase = "exchange-declaration";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
    }

    game.neuroshima?.log("Setting pool for participant", { id, participantId, results, maneuver });
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
      updated.turnState.phase = "exchange-declaration";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      await MeleeStore.updateEncounter(id, updated);
    }
  }
}
