import { MeleeStore } from "./melee-store.js";
import { MeleeTurnService } from "./melee-turn-service.js";

/**
 * Handles exchange resolution logic: success/failure comparison, takeover, and damage triggers.
 * After primary resolution, automatically resolves extra attacks and advances the segment.
 */
export class MeleeResolution {
  /**
   * Resolves the primary exchange and auto-advances the combat state.
   * Chain: primary resolution → extra attacks → segment advance (all automatic).
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

    // 4. Update log and mark dice as used
    updated.log.push({
      type: resultType,
      turn: updated.turnState.turn,
      segment: updated.turnState.segment,
      text: logText
    });
    attacker.usedDice.push(...exchange.attackerSelectedDice);
    defender.usedDice.push(...exchange.defenderSelectedDice);

    // 5. Store segment cost before clearing exchange (X dice = X segments consumed)
    updated.turnState.segmentCost = diceCount;

    // 6. Clear current exchange
    updated.currentExchange = {
      attackerId: null,
      defenderId: null,
      declaredAction: null,
      declaredDiceCount: 0,
      attackerSelectedDice: [],
      defenderSelectedDice: [],
      resolutionType: "normal"
    };

    // 7. Handle multi-player segment queue
    updated.turnState.queueIndex += 1;
    const queue = updated.turnState.segmentQueue || [];

    if (updated.turnState.queueIndex < queue.length) {
      // More primary exchanges in this segment — move to next pair
      const next = queue[updated.turnState.queueIndex];
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = next.attackerId;
      await MeleeStore.updateEncounter(id, updated);
      return;
    }

    // 8. All primary exchanges done — auto-resolve extra attacks
    this.prepareExtraAttacks(updated);
    for (const attack of (updated.extraAttackQueue || [])) {
      if (!attack.resolved) {
        await this.resolveSingleExtraAttack(updated, attack);
        attack.resolved = true;
      }
    }

    // 9. Auto-advance segment
    const cost = updated.turnState.segmentCost || 1;
    const newSeg = (updated.turnState.segment || 1) + cost;
    updated.turnState.segmentCost = 0;

    if (newSeg > 3) {
      // End of turn — save then start new turn (resets pools)
      await MeleeStore.updateEncounter(id, updated);
      await MeleeTurnService.startNewTurn(id);
    } else {
      updated.turnState.segment = newSeg;
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      await MeleeStore.updateEncounter(id, updated);
    }
  }

  /**
   * Calculates effective target considering tempo and crowding penalty.
   */
  static getEffectiveTarget(participant, tempoLevel, dexPenalty, mode = "attack") {
    const { NeuroshimaDice } = game.neuroshima;
    let target = mode === "attack" ? (participant.attackTargetSnapshot || 10) : (participant.defenseTargetSnapshot || 10);

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

    for (const attackerId in encounter.participants) {
      const attacker = encounter.participants[attackerId];
      if (!attacker.isActive || attackerId === encounter.currentExchange.attackerId) continue;

      const targetId = encounter.primaryTargets[attackerId];
      if (!targetId) continue;

      const targetCrowding = encounter.crowding[targetId];
      if (targetCrowding.primaryOpponentId !== attackerId) {
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
   * Resolves a single extra attack with automatic defender free roll.
   */
  static async resolveSingleExtraAttack(encounter, attack) {
    const attacker = encounter.participants[attack.attackerId];
    const defender = encounter.participants[attack.defenderId];

    const availableDiceIndices = attacker.pool.map((v, i) => ({ v, i }))
      .filter(d => !attacker.usedDice.includes(d.i))
      .sort((a, b) => a.v - b.v);

    if (availableDiceIndices.length === 0) return;

    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    const attackerTarget = this.getEffectiveTarget(attacker, tempoLevel, encounter.crowding[attack.attackerId]?.dexPenalty || 0, "attack");

    const successesIndices = availableDiceIndices.filter(d => d.v <= attackerTarget).map(d => d.i);
    const diceCount = Math.min(3, successesIndices.length);

    if (diceCount === 0) {
      attacker.usedDice.push(availableDiceIndices[0].i);
      encounter.log.push({
        type: "miss",
        turn: encounter.turnState.turn,
        segment: encounter.turnState.segment,
        text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogExtraAttackMiss", { attacker: attacker.name, defender: defender.name })
      });
      return;
    }

    const selectedIndices = successesIndices.slice(0, diceCount);
    attacker.usedDice.push(...selectedIndices);

    const defenderTarget = this.getEffectiveTarget(defender, tempoLevel, encounter.crowding[attack.defenderId]?.dexPenalty || 0, "defense");
    const freeRoll = new Roll(`${diceCount}d20`);
    await freeRoll.evaluate();

    const freeSuccesses = freeRoll.terms[0].results.filter(r => r.result <= defenderTarget).length;
    const diceHtml = freeRoll.terms[0].results.map(r =>
      `<span class="die ${r.result <= defenderTarget ? "success" : "failure"}">${r.result}</span>`
    ).join(" ");

    if (freeSuccesses >= diceCount) {
      encounter.log.push({
        type: "block",
        turn: encounter.turnState.turn,
        segment: encounter.turnState.segment,
        text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogExtraAttackBlocked", { attacker: attacker.name, defender: defender.name, dice: diceHtml })
      });
    } else {
      encounter.log.push({
        type: "hit",
        turn: encounter.turnState.turn,
        segment: encounter.turnState.segment,
        text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogExtraAttackHit", { attacker: attacker.name, defender: defender.name, s: diceCount, dice: diceHtml })
      });
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

    const rawValue = attacker.pool[locationDieIndex];
    const location = this._getLocationFromRoll(rawValue);

    const attackData = {
      isMelee: true,
      actorId: attackerActor.id,
      weaponId: attacker.weaponId,
      label: weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
      successPoints: diceCount,
      finalLocation: location,
      damageMelee1: weapon?.system.damageMelee1,
      damageMelee2: weapon?.system.damageMelee2,
      damageMelee3: weapon?.system.damageMelee3
    };

    await CombatHelper.applyDamageToActor(defenderActor, attackData, {
      isOpposed: true,
      spDifference: diceCount,
      location
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
