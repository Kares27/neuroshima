import { MeleeStore } from "./melee-store.js";
import { MeleeTurnService } from "./melee-turn-service.js";

/**
 * Handles exchange resolution logic: success/failure comparison, takeover, and damage triggers.
 */
export class MeleeResolution {
  /**
   * Resolves the primary exchange segment.
   * @param {string} id Encounter ID
   */
  static async resolvePrimaryExchange(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;
    const attackerId = exchange.attackerId;
    const defenderId = exchange.defenderId;
    const attacker = updated.participants[attackerId];
    const defender = updated.participants[defenderId];
    const diceCount = exchange.declaredDiceCount || 0;

    if (!attacker || !defender) return;

    // 1. Calculate Tempo Shift
    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    game.neuroshima?.log("Resolving primary melee exchange", { id, attacker: attacker.name, defender: defender.name, diceCount });
    
    const attackerTarget = this.getEffectiveTarget(attacker, tempoLevel, updated.crowding[attackerId]?.dexPenalty || 0, "attack");
    const defenderTarget = this.getEffectiveTarget(defender, tempoLevel, updated.crowding[defenderId]?.dexPenalty || 0, "defense");

    // 2. Calculate successes
    const attackerSuccesses = exchange.attackerSelectedDice.filter(idx => attacker.pool[idx] <= attackerTarget).length;
    const defenderSuccesses = exchange.defenderSelectedDice.filter(idx => defender.pool[idx] <= defenderTarget).length;

    let resultType = "miss";
    let logText = "";

    // 3. Resolution Logic
    if (attackerSuccesses >= diceCount && defenderSuccesses >= diceCount) {
      resultType = "block";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
    } else if (attackerSuccesses >= diceCount && defenderSuccesses < diceCount) {
      resultType = "hit";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogHit", { attacker: attacker.name, defender: defender.name, s: diceCount });
      const locationDieIndex = exchange.locationDieIndex ?? exchange.attackerSelectedDice[0];
      await this.applyDamage(updated, attackerId, defenderId, diceCount, locationDieIndex);
    } else if (attackerSuccesses < diceCount && defenderSuccesses >= diceCount) {
      const takeoverSuccessesRequired = (defender.maneuver === "fullDefense") ? 2 : 1;
      const actualAdvantage = defenderSuccesses - attackerSuccesses;

      if (actualAdvantage >= takeoverSuccessesRequired) {
        resultType = "takeover";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogTakeover", { attacker: defender.name, oldAttacker: attacker.name });
        updated.turnState.initiativeOwnerId = defenderId;
        
        if (attacker.maneuver === "fury") {
            logText += " " + game.i18n.format("NEUROSHIMA.MeleeDuel.LogFuryHit", { name: defender.name });
            await this.applyDamage(updated, defenderId, attackerId, 1, exchange.defenderSelectedDice[0]);
        }
      } else {
        resultType = "miss";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogDefensiveMiss", { attacker: attacker.name, defender: defender.name });
      }
    } else {
      resultType = "miss";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogDoubleMiss", { attacker: attacker.name, defender: defender.name });
    }

    // Update log and mark dice
    updated.log.push({ type: resultType, segment: updated.turnState.segment, text: logText });
    attacker.usedDice.push(...exchange.attackerSelectedDice);
    defender.usedDice.push(...exchange.defenderSelectedDice);

    // Clear current exchange
    updated.currentExchange = {
      attackerId: null,
      defenderId: null,
      declaredAction: null,
      declaredDiceCount: 0,
      attackerSelectedDice: [],
      defenderSelectedDice: [],
      resolutionType: "normal"
    };

    // Move to next in queue or finalize segment
    updated.turnState.queueIndex += 1;
    const queue = updated.turnState.segmentQueue || [];
    
    if (updated.turnState.queueIndex < queue.length) {
      const next = queue[updated.turnState.queueIndex];
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = next.attackerId;
    } else {
      // Finalize segment primary phase
      this.prepareExtraAttacks(updated);
      
      if (updated.extraAttackQueue.length > 0) {
        updated.turnState.phase = "extra-attacks";
      } else {
        updated.turnState.phase = "segment-end";
      }
    }

    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Calculates effective target considering tempo and crowding penalty.
   */
  static getEffectiveTarget(participant, tempoLevel, dexPenalty, mode = "attack") {
    const { NeuroshimaDice } = game.neuroshima;
    let target = mode === "attack" ? (participant.attackTargetSnapshot || 10) : (participant.defenseTargetSnapshot || 10);
    
    // Apply Dex penalty from crowding
    target -= dexPenalty;

    if (tempoLevel === 0) return target;
    const baseDiffObj = NeuroshimaDice.getDifficultyFromPercent(0);
    const shifted = NeuroshimaDice._getShiftedDifficulty(baseDiffObj, tempoLevel);
    return target + shifted.mod;
  }

  /**
   * Populates the extra attack queue for the current segment.
   */
  static prepareExtraAttacks(encounter) {
    encounter.extraAttackQueue = [];
    const segment = encounter.turnState.segment;
    
    // Any participant targeting someone who is NOT their primary opponent,
    // OR any participant whose target has already fought someone else this segment.
    // Wait, the rule is: Osaczony walczy normalnie tylko z jednym przeciwnikiem.
    // Pozostali przeciwnicy nadal atakują, ale ich ataki są rozliczane przez darmowe kości obrony.
    
    for (const attackerId in encounter.participants) {
      const attacker = encounter.participants[attackerId];
      if (!attacker.isActive || attackerId === encounter.currentExchange.attackerId) continue;
      
      const targetId = encounter.primaryTargets[attackerId];
      if (!targetId) continue;
      
      const targetCrowding = encounter.crowding[targetId];
      if (targetCrowding.primaryOpponentId !== attackerId) {
        // This is an extra attack
        encounter.extraAttackQueue.push({
          attackerId,
          defenderId: targetId,
          sourceSegment: segment,
          isBackAttack: false,
          resolved: false
        });
      }
    }
  }

  /**
   * Resolves extra attacks from the queue.
   */
  static async resolveExtraAttacks(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "extra-attacks") return;

    const updated = foundry.utils.deepClone(encounter);
    const queue = updated.extraAttackQueue;
    
    for (const attack of queue) {
      if (attack.resolved) continue;
      
      const attacker = updated.participants[attack.attackerId];
      const defender = updated.participants[attack.defenderId];
      if (!attacker || !defender) continue;
      
      // Attacker selects their best remaining dice automatically or asks?
      // Plan says: "system sam rzuca darmową obronę", but what about attacker?
      // Let's assume attacker uses their normal pool.
      // Wait, if they are an "extra attacker", they haven't used their dice yet.
      
      // Actually, let's keep it simple for now as requested by "Automatyzować darmową obronę".
      // We need to resolve each extra attack one by one or all at once.
      // The state machine has "extra-attacks" phase.
      
      await this.resolveSingleExtraAttack(updated, attack);
      attack.resolved = true;
    }

    updated.turnState.phase = "segment-end";
    await MeleeStore.updateEncounter(id, updated);
    
    // Finalize segment
    await MeleeTurnService.advanceSegment(id, encounter.currentExchange.declaredDiceCount);
  }

  static async resolveSingleExtraAttack(encounter, attack) {
    const attacker = encounter.participants[attack.attackerId];
    const defender = encounter.participants[attack.defenderId];
    
    // Automation: extra attacker uses their best available dice to form the strongest possible success (1s, 2s or 3s)
    const availableDiceIndices = attacker.pool.map((v, i) => ({v, i}))
      .filter(d => !attacker.usedDice.includes(d.i))
      .sort((a, b) => a.v - b.v); // Best (lowest) first

    if (availableDiceIndices.length === 0) return;

    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    const attackerTarget = this.getEffectiveTarget(attacker, tempoLevel, encounter.crowding[attack.attackerId]?.dexPenalty || 0, "attack");
    
    // Find how many of the best available dice are successes
    const successesIndices = availableDiceIndices.filter(d => d.v <= attackerTarget).map(d => d.i);
    
    // Attempt the strongest possible cios (max 3s)
    const diceCount = Math.min(3, successesIndices.length);
    if (diceCount === 0) {
        // No successes, just use one failing die and miss
        attacker.usedDice.push(availableDiceIndices[0].i);
        encounter.log.push({ 
            type: "miss", 
            segment: encounter.turnState.segment, 
            text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogExtraAttackMiss", { attacker: attacker.name, defender: defender.name }) 
        });
        return;
    }

    const selectedIndices = successesIndices.slice(0, diceCount);
    attacker.usedDice.push(...selectedIndices);

    let logText = "";
    // Defender gets free defense roll
    const defenderTarget = this.getEffectiveTarget(defender, tempoLevel, encounter.crowding[attack.defenderId]?.dexPenalty || 0, "defense");
    const freeRoll = new Roll(`${diceCount}d20`);
    await freeRoll.evaluate();
    
    const freeSuccesses = freeRoll.terms[0].results.filter(r => r.result <= defenderTarget).length;
    
    // Show free roll in log/chat
    const diceHtml = freeRoll.terms[0].results.map(r => `<span class="die ${r.result <= defenderTarget ? 'success' : 'failure'}">${r.result}</span>`).join(" ");
    
    if (freeSuccesses >= diceCount) {
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogExtraAttackBlocked", { 
        attacker: attacker.name, 
        defender: defender.name,
        dice: diceHtml
      });
      encounter.log.push({ type: "block", segment: encounter.turnState.segment, text: logText });
    } else {
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogExtraAttackHit", { 
        attacker: attacker.name, 
        defender: defender.name, 
        s: diceCount,
        dice: diceHtml
      });
      encounter.log.push({ type: "hit", segment: encounter.turnState.segment, text: logText });
      await this.applyDamage(encounter, attack.attackerId, attack.defenderId, diceCount, selectedIndices[0]);
    }
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
