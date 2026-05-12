import { MeleeStore } from "./melee-store.js";
/**
 * @file melee-resolution.js
 * @description Exchange resolution for Neuroshima 1.5 Melee Encounters.
 *
 * ### Resolution rules (NS 1.5 default mode)
 * - Attacker wins iff `attackerSuccesses > defenderSuccesses`.
 * - Damage tier is determined by `declaredDiceCount` (not success count):
 *   1 die → damageMelee1, 2 dice → damageMelee2, 3 dice → damageMelee3.
 * - Defender wins with higher successes: block (tie if fullDefense maneuver) or takeover
 *   (initiative passes to defender, who immediately becomes the next attacker).
 * - Extra attacks from crowding are queued in `extraAttackQueue` and resolved after the primary.
 * - After all exchanges, the segment pointer advances by `declaredDiceCount` (NS 1.5 cost rule).
 *   If the new segment > 3, the turn ends automatically.
 */
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

    // Branch to the appropriate resolution mode
    const resolutionMode = updated.resolutionMode || "normal";
    if (resolutionMode === "opposedPips") {
      await this._resolveOpposedPips(id, updated);
      return;
    }
    if (resolutionMode === "opposedSuccesses") {
      await this._resolveOpposedSuccesses(id, updated);
      return;
    }

    // ── Normal mode (default NS 1.5) ──────────────────────────────────────
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

    // 2. Calculate successes — prefer stored per-die flags (exact match to chat card).
    // Nat20 is always a failure regardless of target or skill spent.
    const _dieSuccess = (participant, idx, target) => {
      if (participant.dieResults) return participant.dieResults[idx]?.isSuccess ?? false;
      const val = participant.modifiedPool?.[idx] ?? participant.pool[idx];
      return participant.pool[idx] !== 20 && val <= target;
    };
    const attackerSuccesses = exchange.attackerSelectedDice.filter(idx => _dieSuccess(attacker, idx, attackerTarget)).length;
    const defenderSuccesses = exchange.defenderSelectedDice.filter(idx => _dieSuccess(defender, idx, defenderTarget)).length;

    let resultType = "miss";
    let logText = "";

    game.neuroshima?.log("Exchange successes", { attackerSuccesses, defenderSuccesses, diceCount, attackerTarget, defenderTarget });

    // 3. Resolution Logic (NS 1.5)
    // Attacker wins if they have strictly MORE successes than the defender.
    // Damage is based on diceCount (strength of the declared attack), not on success count.
    // On a tie or defender advantage → block or takeover.
    if (attackerSuccesses > defenderSuccesses) {
      resultType = "hit";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogHit", { attacker: attacker.name, defender: defender.name, s: diceCount });
      const locationDieIndex = exchange.locationDieIndex ?? exchange.attackerSelectedDice[0];
      const damageOptions = this._computeDamageOptions(diceCount, attacker);
      if (damageOptions.length === 1) {
        // Only one way to distribute: apply immediately
        await this.applyDamageDistributed(updated, attackerId, defenderId, damageOptions[0].hits, locationDieIndex);
      } else {
        // Multiple options: pause for attacker to choose
        updated.pendingDamage = {
          attackerId, defenderId, diceCount, locationDieIndex, options: damageOptions
        };
      }
    } else if (defenderSuccesses > attackerSuccesses) {
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
        resultType = "block";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
      }
    } else {
      // Equal successes (including both zero) — defender wins the tie
      resultType = "block";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
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
      attackerId: null, defenderId: null, declaredAction: null,
      declaredDiceCount: 0, attackerSelectedDice: [], defenderSelectedDice: [],
      resolutionType: "normal"
    };

    // 6b. If a hit requires attacker to choose damage distribution, pause here.
    if (updated.pendingDamage) {
      updated.turnState.phase = "damage-selection";
      updated.turnState.selectionTurn = updated.pendingDamage.attackerId;
      await MeleeStore.updateEncounter(id, updated);
      return;
    }

    await this._advanceAfterExchange(id, updated);
  }

  /**
   * Called by the attacker to confirm their chosen damage distribution.
   * Applies damage and resumes the normal exchange flow.
   * @param {string} id           Encounter ID
   * @param {number} optionIndex  Index into pendingDamage.options
   */
  static async confirmDamageDistribution(id, optionIndex) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "damage-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    const pending = updated.pendingDamage;
    if (!pending) return;

    const option = pending.options[optionIndex];
    if (!option) return;

    await this.applyDamageDistributed(updated, pending.attackerId, pending.defenderId, option.hits, pending.locationDieIndex);
    updated.pendingDamage = null;

    await this._advanceAfterExchange(id, updated);
  }

  /**
   * Handles queue advancement and segment progression after an exchange is resolved.
   * @private
   */
  static async _advanceAfterExchange(id, updated) {
    // Handle multi-player segment queue
    updated.turnState.queueIndex += 1;
    const queue = updated.turnState.segmentQueue || [];

    if (updated.turnState.queueIndex < queue.length) {
      const next = queue[updated.turnState.queueIndex];
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = next.attackerId;
      await MeleeStore.updateEncounter(id, updated);
      return;
    }

    // All primary exchanges done — auto-resolve extra attacks
    this.prepareExtraAttacks(updated);
    for (const attack of (updated.extraAttackQueue || [])) {
      if (!attack.resolved) {
        await this.resolveSingleExtraAttack(updated, attack);
        attack.resolved = true;
      }
    }

    // Auto-advance segment
    const cost = updated.turnState.segmentCost || 1;
    const newSeg = (updated.turnState.segment || 1) + cost;
    updated.turnState.segmentCost = 0;

    if (newSeg > 3) {
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
   * Opposed-by-Pips (Przeciwstawny na Oczkach) resolution.
   * Both combatants must commit exactly 3 dice.
   * Die slot 0 → tier-1 damage, slot 1 → tier-2 damage, slot 2 → tier-3 damage.
   * Attacker wins a slot when their die is a success AND (defender's die is not a success
   * OR attacker's effective value is strictly lower than defender's effective value).
   * Each won slot applies the corresponding weapon damage tier independently.
   * @private
   */
  static async _resolveOpposedPips(id, updated) {
    const exchange = updated.currentExchange;
    const attackerId = exchange.attackerId;
    const defenderId = exchange.defenderId;
    const attacker = updated.participants[attackerId];
    const defender = updated.participants[defenderId];

    if (!attacker || !defender) return;

    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    const attackerTarget = this.getEffectiveTarget(attacker, tempoLevel, updated.crowding[attackerId]?.dexPenalty || 0, "attack");
    const defenderTarget = this.getEffectiveTarget(defender, tempoLevel, updated.crowding[defenderId]?.dexPenalty || 0, "defense");

    game.neuroshima?.log("Resolving opposedPips exchange", {
      id, attacker: attacker.name, defender: defender.name, attackerTarget, defenderTarget
    });

    const aDice = exchange.attackerSelectedDice;
    const dDice = exchange.defenderSelectedDice;
    const slots = Math.min(aDice.length, dDice.length, 3);

    const _dieVal = (participant, idx) => participant.modifiedPool?.[idx] ?? participant.pool[idx];
    const _dieSuccess = (participant, idx, target) => {
      if (participant.dieResults) return participant.dieResults[idx]?.isSuccess ?? false;
      return participant.pool[idx] !== 20 && _dieVal(participant, idx) <= target;
    };

    const hits = [];
    const slotResults = [];

    for (let pos = 0; pos < slots; pos++) {
      const aIdx = aDice[pos];
      const dIdx = dDice[pos];
      const aSuccess = _dieSuccess(attacker, aIdx, attackerTarget);
      const dSuccess = _dieSuccess(defender, dIdx, defenderTarget);
      const aVal = _dieVal(attacker, aIdx);
      const dVal = _dieVal(defender, dIdx);
      const attackerWins = aSuccess && (!dSuccess || aVal < dVal);
      const tier = pos + 1;
      slotResults.push({ pos, tier, aVal, dVal, aSuccess, dSuccess, attackerWins });
      if (attackerWins) hits.push({ cost: tier, tier });
    }

    game.neuroshima?.log("OpposedPips slot results", { slotResults });

    let resultType;
    let logText;

    if (hits.length > 0) {
      resultType = "hit";
      const tierLabels = hits.map(h => `T${h.tier}`).join(", ");
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogOpposedPipsHit", {
        attacker: attacker.name,
        defender: defender.name,
        tiers: tierLabels
      });
      const locationDieIndex = aDice[0];
      await this.applyDamageDistributed(updated, attackerId, defenderId, hits, locationDieIndex);
    } else {
      // Check if defender can take over (defender had more winning slots)
      const defenderWonSlots = slotResults.filter(s => !s.attackerWins && s.dSuccess).length;
      const takeoverRequired = (defender.maneuver === "fullDefense") ? 2 : 1;

      if (defenderWonSlots >= takeoverRequired) {
        resultType = "takeover";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogTakeover", { attacker: defender.name, oldAttacker: attacker.name });
        updated.turnState.initiativeOwnerId = defenderId;

        if (attacker.maneuver === "fury") {
          logText += " " + game.i18n.format("NEUROSHIMA.MeleeDuel.LogFuryHit", { name: defender.name });
          await this.applyDamage(updated, defenderId, attackerId, 1, dDice[0]);
        }
      } else {
        resultType = "block";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
      }
    }

    updated.log.push({ type: resultType, turn: updated.turnState.turn, segment: updated.turnState.segment, text: logText });
    attacker.usedDice.push(...aDice);
    defender.usedDice.push(...dDice);
    updated.turnState.segmentCost = 3;
    updated.currentExchange = {
      attackerId: null, defenderId: null, declaredAction: null,
      declaredDiceCount: 0, attackerSelectedDice: [], defenderSelectedDice: [], resolutionType: "normal"
    };

    await this._advanceAfterExchange(id, updated);
  }

  /**
   * Opposed-by-Successes (Przeciwstawny na Sukcesach) resolution.
   * Attacker selects 1–3 dice, defender matches the count.
   * Net successes = attackerSuccesses − defenderSuccesses.
   * Damage tier = net successes (clamped 1–3). If net ≤ 0, defender can take over/block.
   * @private
   */
  static async _resolveOpposedSuccesses(id, updated) {
    const exchange = updated.currentExchange;
    const attackerId = exchange.attackerId;
    const defenderId = exchange.defenderId;
    const attacker = updated.participants[attackerId];
    const defender = updated.participants[defenderId];
    const diceCount = exchange.declaredDiceCount || 0;

    if (!attacker || !defender) return;

    const tempoLevel = Math.max(attacker.tempoLevel || 0, defender.tempoLevel || 0);
    const attackerTarget = this.getEffectiveTarget(attacker, tempoLevel, updated.crowding[attackerId]?.dexPenalty || 0, "attack");
    const defenderTarget = this.getEffectiveTarget(defender, tempoLevel, updated.crowding[defenderId]?.dexPenalty || 0, "defense");

    const _dieSuccess = (participant, idx, target) => {
      if (participant.dieResults) return participant.dieResults[idx]?.isSuccess ?? false;
      const val = participant.modifiedPool?.[idx] ?? participant.pool[idx];
      return participant.pool[idx] !== 20 && val <= target;
    };

    const attackerSuccesses = exchange.attackerSelectedDice.filter(idx => _dieSuccess(attacker, idx, attackerTarget)).length;
    const defenderSuccesses = exchange.defenderSelectedDice.filter(idx => _dieSuccess(defender, idx, defenderTarget)).length;
    const netSuccesses = attackerSuccesses - defenderSuccesses;

    game.neuroshima?.log("Resolving opposedSuccesses exchange", {
      id, attacker: attacker.name, defender: defender.name, attackerSuccesses, defenderSuccesses, netSuccesses
    });

    let resultType;
    let logText;

    if (netSuccesses > 0) {
      const tier = Math.min(3, netSuccesses);
      resultType = "hit";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogOpposedSuccessesHit", {
        attacker: attacker.name,
        defender: defender.name,
        net: netSuccesses,
        tier
      });
      const locationDieIndex = exchange.locationDieIndex ?? exchange.attackerSelectedDice[0];
      await this.applyDamageDistributed(updated, attackerId, defenderId, [{ cost: tier, tier }], locationDieIndex);
    } else if (netSuccesses < 0) {
      const defenderAdvantage = Math.abs(netSuccesses);
      const takeoverRequired = (defender.maneuver === "fullDefense") ? 2 : 1;

      if (defenderAdvantage >= takeoverRequired) {
        resultType = "takeover";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogTakeover", { attacker: defender.name, oldAttacker: attacker.name });
        updated.turnState.initiativeOwnerId = defenderId;

        if (attacker.maneuver === "fury") {
          logText += " " + game.i18n.format("NEUROSHIMA.MeleeDuel.LogFuryHit", { name: defender.name });
          await this.applyDamage(updated, defenderId, attackerId, 1, exchange.defenderSelectedDice[0]);
        }
      } else {
        resultType = "block";
        logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
      }
    } else {
      resultType = "block";
      logText = game.i18n.format("NEUROSHIMA.MeleeDuel.LogBlock", { attacker: attacker.name, defender: defender.name });
    }

    updated.log.push({ type: resultType, turn: updated.turnState.turn, segment: updated.turnState.segment, text: logText });
    attacker.usedDice.push(...exchange.attackerSelectedDice);
    defender.usedDice.push(...exchange.defenderSelectedDice);
    updated.turnState.segmentCost = diceCount;
    updated.currentExchange = {
      attackerId: null, defenderId: null, declaredAction: null,
      declaredDiceCount: 0, attackerSelectedDice: [], defenderSelectedDice: [], resolutionType: "normal"
    };

    await this._advanceAfterExchange(id, updated);
  }

  /**
   * Computes all valid damage distributions for a given dice count.
   * D = 1 die, L = 2 dice, C = 3 dice.
   * Returns an array of options, each with { label, hits[] }.
   * @param {number} diceCount   Number of dice spent (1–3)
   * @param {object} attacker    Participant data (for weapon damage tier labels)
   */
  static _computeDamageOptions(diceCount, attacker) {
    // Read damage tier labels directly from weapon (damageMeleePreview is a UI-only enrichment)
    const doc = fromUuidSync(attacker.actorUuid);
    const actor = doc?.actor || doc;
    const weapon = actor?.items.get(attacker.weaponId);
    const d1 = weapon?.system.damageMelee1 || "D";
    const d2 = weapon?.system.damageMelee2 || "L";
    const d3 = weapon?.system.damageMelee3 || "C";

    const tiers = [
      { cost: 1, tier: 1, label: d1 },
      { cost: 2, tier: 2, label: d2 },
      { cost: 3, tier: 3, label: d3 }
    ].filter(t => t.cost <= diceCount);

    // Generate all unique combinations via recursive partition
    const results = [];
    const seen = new Set();

    const recurse = (remaining, combo) => {
      if (remaining === 0) {
        const key = [...combo].sort((a, b) => b - a).join(",");
        if (!seen.has(key)) {
          seen.add(key);
          // Build hits list from combo (combo = array of tier costs)
          const sorted = [...combo].sort((a, b) => b - a);
          const hits = sorted.map(cost => tiers.find(t => t.cost === cost));
          // Build label: "1×C", "1×L + 1×D" etc.
          const counts = {};
          for (const t of hits) counts[t.label] = (counts[t.label] || 0) + 1;
          const label = Object.entries(counts)
            .map(([lbl, cnt]) => cnt > 1 ? `${cnt}×${lbl}` : lbl)
            .join(" + ");
          results.push({ label, hits });
        }
        return;
      }
      for (const t of tiers) {
        if (t.cost <= remaining) {
          combo.push(t.cost);
          recurse(remaining - t.cost, combo);
          combo.pop();
        }
      }
    };
    recurse(diceCount, []);
    return results;
  }

  /**
   * Applies a distributed damage sequence (multiple hits of varying tiers).
   * Each hit in `hits` is applied separately to allow different locations in the future.
   */
  static async applyDamageDistributed(encounter, attackerId, defenderId, hits, locationDieIndex) {
    const attacker = encounter.participants[attackerId];
    const defender = encounter.participants[defenderId];
    if (!attacker || !defender || !hits?.length) return;

    const attackerDoc = fromUuidSync(attacker.actorUuid);
    const defenderDoc  = fromUuidSync(defender.actorUuid);
    const attackerActor = attackerDoc?.actor || attackerDoc;
    const defenderActor  = defenderDoc?.actor  || defenderDoc;
    if (!attackerActor || !defenderActor) return;

    const weapon = attackerActor.items.get(attacker.weaponId);
    const { CombatHelper } = await import("../helpers/combat-helper.js");

    const rawValue = attacker.pool[locationDieIndex];
    const location = this._getLocationFromRoll(rawValue);

    // Collect all wounds from all hits, then create ONE chat message.
    const allResults = [];
    const allWoundIds = [];
    let totalReducedProjectiles = 0;
    const allReducedDetails = [];

    for (const hit of hits) {
      const attackData = {
        isMelee: true,
        actorId: attackerActor.id,
        weaponId: attacker.weaponId,
        label: weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
        successPoints: hit.cost,
        finalLocation: location,
        damageMelee1: weapon?.system.damageMelee1,
        damageMelee2: weapon?.system.damageMelee2,
        damageMelee3: weapon?.system.damageMelee3
      };
      const batchResult = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
        isOpposed: true, spDifference: hit.cost, location, suppressChat: true
      });
      if (batchResult) {
        allResults.push(...batchResult.results);
        allWoundIds.push(...batchResult.woundIds);
        totalReducedProjectiles += batchResult.reducedProjectiles;
        allReducedDetails.push(...batchResult.reducedDetails);
      }
    }

    // Single consolidated notification + chat message for all hits.
    if (allWoundIds.length > 0) {
      ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageApplied", {
        count: allWoundIds.length,
        name: defenderActor.name
      }));
    }
    if (allResults.length > 0 || totalReducedProjectiles > 0 || allWoundIds.length > 0) {
      await CombatHelper.renderPainResistanceReport(defenderActor, allResults, allWoundIds, totalReducedProjectiles, allReducedDetails);
    }
  }

  /**
   * Legacy single-tier damage helper kept for extra-attack resolution.
   * @private
   */
  static async applyDamage(encounter, attackerId, defenderId, diceCount, locationDieIndex) {
    const tier = { cost: diceCount, label: "" };
    await this.applyDamageDistributed(encounter, attackerId, defenderId, [tier], locationDieIndex);
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
