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
    const diceCount = exchange.declaredDiceCount || 0;

    if (!attacker || !defender) return;

    // 1. Calculate Tempo Shift (PT podsunięcie)
    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    game.neuroshima?.log("Resolving melee exchange", { id, attacker: attacker.name, defender: defender.name, diceCount });
    const { NeuroshimaDice } = game.neuroshima;
    
    const applyTempo = (participant) => {
      if (tempoLevel === 0) return participant.effectiveTargetSnapshot;
      const baseDiffObj = NeuroshimaDice.getDifficultyFromPercent(0); // Average
      const shifted = NeuroshimaDice._getShiftedDifficulty(baseDiffObj, tempoLevel);
      return participant.effectiveTargetSnapshot + shifted.mod;
    };

    const attackerTarget = applyTempo(attacker);
    const defenderTarget = applyTempo(defender);

    // 2. Calculate successes
    const attackerSuccesses = exchange.attackerSelectedDice.filter(idx => attacker.pool[idx] <= attackerTarget).length;
    const defenderSuccesses = exchange.defenderSelectedDice.filter(idx => defender.pool[idx] <= defenderTarget).length;

    let resultType = "miss"; // miss, hit, block, takeover
    let logText = "";

    // 3. Neuroshima Rule Resolution
    if (attackerSuccesses >= diceCount && defenderSuccesses >= diceCount) {
      resultType = "block";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
    } else if (attackerSuccesses >= diceCount && defenderSuccesses < diceCount) {
      resultType = "hit";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogHit", { attacker: attacker.name, defender: defender.name, s: diceCount });
      
      // Damage pipeline
      await this.applyDamage(updated, exchange.attackerId, exchange.defenderId, diceCount, exchange.attackerSelectedDice[0]);
    } else if (attackerSuccesses < diceCount && defenderSuccesses >= diceCount) {
      // Rule: Pełna obrona (takeover requires 2 successes advantage)
      const takeoverSuccessesRequired = (defender.maneuver === "fullDefense") ? 2 : 1;
      const actualAdvantage = defenderSuccesses - attackerSuccesses;

      if (actualAdvantage >= takeoverSuccessesRequired) {
        resultType = "takeover";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogTakeover", { attacker: defender.name, oldAttacker: attacker.name });
        
        // Rule: Furia (attacker takeover is a hit)
        if (attacker.maneuver === "fury") {
            logText += " " + game.i18n.format("NEUROSHIMA.MeleeDuel.LogFuryHit", { name: defender.name });
            // Fury hit is always 1s
            await this.applyDamage(updated, exchange.defenderId, exchange.attackerId, 1, exchange.defenderSelectedDice[0]);
        }
      } else {
        resultType = "miss";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogDefensiveMiss", { attacker: attacker.name, defender: defender.name });
      }
    } else {
      resultType = "miss";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogDoubleMiss", { attacker: attacker.name, defender: defender.name });
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
   * Triggers the damage pipeline for a hit.
   * @private
   */
  static async applyDamage(encounter, attackerId, defenderId, diceCount, locationDieIndex) {
    const attacker = encounter.participants[attackerId];
    const defender = encounter.participants[defenderId];
    if (!attacker || !defender) return;

    const attackerDoc = fromUuidSync(attacker.actorUuid);
    const defenderDoc = fromUuidSync(defender.actorUuid);
    const attackerActor = attackerDoc?.actor || attackerDoc;
    const defenderActor = defenderDoc?.actor || defenderDoc;
    if (!attackerActor || !defenderActor) return;

    const weapon = attackerActor.items.get(attacker.weaponId);
    const { CombatHelper } = await import("../helpers/combat-helper.js");

    // Get location from raw dice value
    const rawValue = attacker.pool[locationDieIndex];
    const location = this._getLocationFromRoll(rawValue);

    const attackData = {
      isMelee: true,
      actorId: attackerActor.id,
      weaponId: attacker.weaponId,
      label: weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
      successPoints: diceCount, // Used for selecting damage tier (1s, 2s, 3s)
      finalLocation: location,
      damageMelee1: weapon?.system.damageMelee1,
      damageMelee2: weapon?.system.damageMelee2,
      damageMelee3: weapon?.system.damageMelee3
    };

    await CombatHelper.applyDamageToActor(defenderActor, attackData, {
        isOpposed: true,
        spDifference: diceCount,
        location: location
    });
  }

  /**
   * Helper to map raw roll to body location.
   * @private
   */
  static _getLocationFromRoll(roll) {
    if (roll <= 2) return "head";
    if (roll <= 4) return "rightArm";
    if (roll <= 6) return "leftArm";
    if (roll <= 15) return "torso";
    if (roll <= 17) return "rightLeg";
    return "leftLeg";
  }
}
