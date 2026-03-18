import { MeleeStore } from "./melee-store.js";
import { MeleeTurnService } from "./melee-turn-service.js";

/**
 * Handles exchange resolution logic: success/failure comparison, takeover, and damage triggers.
 */
export class MeleeResolution {
  /**
   * Resolves a single exchange segment.
   * @param {string} id Encounter ID
   */
  static async resolveExchange(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;
    const attacker = updated.participants[exchange.attackerId];
    const defender = updated.participants[exchange.defenderId];

    if (!attacker || !defender) return;

    // 1. Calculate successes for both sides
    const attackerSuccesses = this._calculateSuccesses(attacker, exchange.attackerSelectedDice);
    const defenderSuccesses = this._calculateSuccesses(defender, exchange.defenderSelectedDice);

    const diceCount = exchange.declaredDiceCount;
    let resultType = "miss"; // miss, hit, block, takeover
    let logText = "";

    // 2. Compare based on rules
    if (attackerSuccesses >= diceCount && defenderSuccesses >= diceCount) {
      resultType = "block";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
    } else if (attackerSuccesses >= diceCount && defenderSuccesses < diceCount) {
      resultType = "hit";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogHit", { attacker: attacker.name, defender: defender.name, s: diceCount });
      // TODO: Trigger damage calculation
    } else if (attackerSuccesses < diceCount && defenderSuccesses >= diceCount) {
      // Check for Pełna obrona (requires 2 successes advantage for takeover)
      if (defender.maneuver === "fullDefense") {
          // This needs state across exchanges or a different rule interpretation
          // According to instructions: "takeover dopiero przy przewadze 2 sukcesów"
          // Let's assume for now 1v1 takeover logic
          resultType = "takeover";
      } else {
          resultType = "takeover";
      }
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogTakeover", { attacker: defender.name, oldAttacker: attacker.name });
    } else {
      resultType = "miss";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogMiss", { attacker: attacker.name, defender: defender.name });
    }

    // 3. Update state
    updated.log.push({
      type: resultType,
      segment: updated.turnState.segment,
      text: logText
    });

    // Mark dice as used
    attacker.usedDice.push(...exchange.attackerSelectedDice);
    defender.usedDice.push(...exchange.defenderSelectedDice);

    // Handle Takeover
    if (resultType === "takeover") {
      updated.turnState.initiativeOwnerId = defender.id;
    }

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

    await MeleeStore.updateEncounter(id, updated);
    
    // 4. Advance segment based on diceCount (1s, 2s, 3s)
    await MeleeTurnService.advanceSegment(id, diceCount);
  }

  /**
   * Helper to count successes in a set of dice indices.
   * @private
   */
  static _calculateSuccesses(participant, selectedIndices) {
    if (!selectedIndices || selectedIndices.length === 0) return 0;
    
    // Simple check: how many values are <= effective target
    // We should account for skillSpent if we want more accuracy, 
    // but in Melee 1.5 skill is spent dynamically.
    let successes = 0;
    const target = participant.effectiveTargetSnapshot || participant.targetValue || 10;
    
    for (const idx of selectedIndices) {
      if (participant.pool[idx] <= target) successes++;
    }
    return successes;
  }
}
