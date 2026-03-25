
/**
 * @file melee-turn-service.js
 * @description All state-transition logic for Neuroshima 1.5 Melee Encounters.
 *
 * ### Phase state machine
 * ```
 * awaiting-pool-rolls
 *   → target-selection        (multi-fight only; skipped in 1v1)
 *   → primary-attack-selection
 *   → primary-defense-selection
 *   → primary-ready           (triggers MeleeResolution.resolvePrimaryExchange)
 *   → segment-end             (segment advances or turn ends)
 *   → awaiting-pool-rolls     (next turn — pools reset)
 * ```
 *
 * ### Key rules
 * - Attacking with N dice costs N segments (segment pointer advances by N after resolution).
 * - Segments run 1–3; when all 3 are exhausted the turn ends and pools reset.
 * - In multi-fight, crowding applies a dexterity penalty per extra attacker.
 * - `doubleSkillAction` ON: skill budget is allocated manually via `allocateSkill()`.
 *   `doubleSkillAction` OFF: `_evaluateClosedTest` auto-applies skill during pool roll.
 */
import { MeleeStore } from "./melee-store.js";

/**
 * Handles turn transitions, segment resets, and maneuver application for Melee Encounters.
 */
export class MeleeTurnService {
  /**
   * Returns whether the encounter needs manual target selection (multi-fight).
   * @private
   */
  static _isMultiFight(encounter) {
    const activeA = (encounter.teams.A || []).filter(id => encounter.participants[id]?.isActive).length;
    const activeB = (encounter.teams.B || []).filter(id => encounter.participants[id]?.isActive).length;
    return (activeA + activeB) > 2;
  }

  /**
   * Resets the encounter state for a new turn.
   */
  static async startNewTurn(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    updated.turnState.turn += 1;
    updated.turnState.segment = 1;
    updated.turnState.segmentCost = 0;
    updated.turnState.selectionTurn = null;

    // Reset pool data for all participants
    for (const pId in updated.participants) {
      const p = updated.participants[pId];
      p.pool = [];
      p.modifiedPool = null;
      p.skillBudget = 0;
      p.selfReductions = [];
      p.opponentGains = [];
      p.spentOnOpponent = {};
      p.usedDice = [];
      p.skillSpent = 0;
      p.maneuver = "none";
      p.tempoLevel = 0;
      p.attackTargetSnapshot = null;
      p.defenseTargetSnapshot = null;
    }

    // Reset primary targets
    for (const pId in updated.participants) {
      updated.primaryTargets[pId] = null;
    }

    // Build initiative order for the new turn
    const sortedIds = Object.values(updated.participants)
      .filter(p => p.isActive)
      .sort((a, b) => b.initiative - a.initiative)
      .map(p => p.id);
    updated.turnState.initiativeOrder = sortedIds;

    updated.log.push({
      type: "system",
      segment: 1,
      text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogNewTurn", { turn: updated.turnState.turn })
    });

    if (this._isMultiFight(updated)) {
      updated.turnState.phase = "target-selection";
      updated.turnState.selectionTurn = sortedIds[0];
      this.updateCrowding(updated);
      this._advanceTargetSelection(updated);
    } else {
      // 1v1: auto-set targets
      const [aId, bId] = sortedIds;
      if (aId && bId) {
        updated.primaryTargets[aId] = bId;
        updated.primaryTargets[bId] = aId;
      }
      this.updateCrowding(updated);
      updated.turnState.phase = "awaiting-pool-rolls";
    }

    game.neuroshima?.log("Starting new turn for melee encounter", { id, turn: updated.turnState.turn });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Sets the 3k20 pool for a participant and snapshots their combat target values for the turn.
   *
   * @param {string}   id             Encounter ID
   * @param {string}   participantId  Participant ID
   * @param {number[]} results        Raw dice results [d1, d2, d3]
   * @param {string}   maneuver       Chosen maneuver ("none"|"fury"|"fullDefense"|...)
   * @param {number}   tempoLevel     Tempo shift level
   * @param {number}   attributeBonus Situational bonus from roll dialog
   * @param {number[]|null} modifiedPool  Skill-adjusted dice (doubleSkill OFF only)
   * @param {number}   skillBudget    Skill points for manual allocation (doubleSkill ON only)
   * @param {number|null} rollTarget  Exact roll target from rollWeaponTest (preferred source of truth)
   * @param {string}   meleeAction    "attack" or "defense" — determines which weapon bonus was used in the roll
   */
  static async setPool(id, participantId, results, maneuver = "none", tempoLevel = 0, attributeBonus = 0, modifiedPool = null, skillBudget = 0, rollTarget = null, meleeAction = "attack") {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const p = updated.participants[participantId];
    if (!p) return;

    // Fetch actor to read weapon bonuses for snapshot
    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    
    if (actor) {
      const weapon = actor.items.get(p.weaponId);
      const attribute = weapon?.system.attribute || "dexterity";
      const baseTarget = actor.system.attributeTotals?.[attribute] || 10;

      p.targetValue = baseTarget;
      p.attackBonusSnapshot = weapon?.system.attackBonus || 0;
      p.defenseBonusSnapshot = weapon?.system.defenseBonus || 0;

      if (rollTarget !== null && rollTarget !== undefined) {
        // ── Preferred path ─────────────────────────────────────────────────
        // Use the exact target that rollWeaponTest computed (correctly converts
        // % armor/wound penalties → difficulty mod, adds weapon bonus, etc.)
        // The roll was made for one action (attack or defense); derive the other
        // by swapping the weapon bonus component.
        if (meleeAction === "defense") {
          p.defenseTargetSnapshot = rollTarget;
          p.attackTargetSnapshot = rollTarget - p.defenseBonusSnapshot + p.attackBonusSnapshot;
        } else {
          p.attackTargetSnapshot = rollTarget;
          p.defenseTargetSnapshot = rollTarget - p.attackBonusSnapshot + p.defenseBonusSnapshot;
        }
      } else {
        // ── Fallback (no target passed) ─────────────────────────────────────
        // Approximate from actor state. NOTE: this can be inaccurate when armor/
        // wound penalties are present because totalArmorPenalty is a percentage
        // that must be converted via getDifficultyFromPercent, not subtracted directly.
        const armorPenalty = actor.system.combat?.totalArmorPenalty || 0;
        const woundPenalty = actor.system.combat?.totalWoundPenalty || 0;
        const totalPct = armorPenalty + woundPenalty;
        const diffMod = game.neuroshima?.NeuroshimaDice
          ? (game.neuroshima.NeuroshimaDice.getDifficultyFromPercent?.(totalPct)?.mod ?? 0)
          : 0;

        let attackManeuverBonus = 0;
        let defenseManeuverBonus = 0;
        if (maneuver === "furia" || maneuver === "fury") attackManeuverBonus = 2;
        if (maneuver === "fullDefense" || maneuver === "pelnaObrona") defenseManeuverBonus = 2;

        p.attackTargetSnapshot = baseTarget + p.attackBonusSnapshot + attackManeuverBonus + attributeBonus + diffMod;
        p.defenseTargetSnapshot = baseTarget + p.defenseBonusSnapshot + defenseManeuverBonus + attributeBonus + diffMod;
      }

      game.neuroshima?.log("setPool snapshot", {
        name: p.name, rollTarget, meleeAction,
        attackTarget: p.attackTargetSnapshot, defenseTarget: p.defenseTargetSnapshot
      });
    }

    p.pool = results;
    p.maneuver = maneuver;
    p.tempoLevel = tempoLevel;
    p.usedDice = [];
    p.skillSpent = 0;

    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");
    if (doubleSkill) {
      p.modifiedPool = null;
      p.skillBudget = skillBudget;
      p.selfReductions = new Array(results.length).fill(0);
      p.opponentGains = new Array(results.length).fill(0);
      p.spentOnOpponent = {};
    } else {
      p.modifiedPool = modifiedPool?.length === results.length ? modifiedPool : null;
      p.skillBudget = 0;
      p.selfReductions = [];
      p.opponentGains = [];
      p.spentOnOpponent = {};
    }

    // Check if all active participants have rolled their pools
    const allRolled = Object.values(updated.participants).every(p => !p.isActive || p.pool.length > 0);
    if (allRolled) {
      // Ensure initiative order is set (may not be for 1v1 created before multi-fight)
      if (!updated.turnState.initiativeOrder?.length) {
        const sortedIds = Object.values(updated.participants)
          .filter(p => p.isActive)
          .sort((a, b) => b.initiative - a.initiative)
          .map(p => p.id);
        updated.turnState.initiativeOrder = sortedIds;
      }

      // For 1v1 (duel mode): ensure targets are set if somehow missing
      for (const pId in updated.participants) {
        const participant = updated.participants[pId];
        if (!participant.isActive) continue;
        const opposingTeam = participant.team === "A" ? "B" : "A";
        const opponents = updated.teams[opposingTeam].filter(id => updated.participants[id]?.isActive);
        if (opponents.length === 1 && !updated.primaryTargets[pId]) {
          updated.primaryTargets[pId] = opponents[0];
        }
      }

      this.updateCrowding(updated);

      // Go directly to attack selection — targets were already chosen before pool roll
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      this._buildSegmentQueue(updated);
    }

    game.neuroshima?.log("Setting pool for participant", { id, participantId, results, maneuver, attributeBonus });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Moves target selection to the next eligible participant in initiative order.
   * When all targets are assigned, advances to awaiting-pool-rolls.
   * @private
   */
  static _advanceTargetSelection(encounter) {
    const order = encounter.turnState.initiativeOrder || [];
    const participants = encounter.participants;
    const primaryTargets = encounter.primaryTargets;

    let nextId = null;
    for (const id of order) {
      if (!participants[id]?.isActive) continue;
      if (primaryTargets[id]) continue; // Already chosen

      const isAttacked = Object.values(primaryTargets).includes(id);
      if (isAttacked) {
        // "Zaatakowani nie wybierają" — auto-assign them to their primary attacker
        const attackers = Object.entries(primaryTargets)
          .filter(([, tid]) => tid === id)
          .map(([aid]) => aid);

        if (attackers.length > 0) {
          primaryTargets[id] = attackers[0];
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
      // All targets assigned — proceed to pool rolls
      encounter.turnState.phase = "awaiting-pool-rolls";
      encounter.turnState.selectionTurn = null;
    }
  }

  /**
   * Builds the queue of primary exchanges for the current segment.
   * @private
   */
  static _buildSegmentQueue(encounter) {
    const queue = [];
    const handled = new Set();
    const attackerId = encounter.turnState.initiativeOwnerId;
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
        .map(([attackerId]) => attackerId);

      const myTarget = encounter.primaryTargets[pId];
      const primaryOpponentId = targetingMe.includes(myTarget) ? myTarget : (targetingMe[0] || null);
      const extraAttackers = targetingMe.filter(id => id !== primaryOpponentId);

      let dexPenalty = 0;
      if (targetingMe.length > 1) {
        dexPenalty = targetingMe.length;
      }

      encounter.crowding[pId] = {
        primaryOpponentId,
        opponentCount: targetingMe.length,
        dexPenalty,
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
    if (phase === "primary-attack-selection" && participantId === updated.turnState.selectionTurn) {
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

    if (participantId !== updated.turnState.selectionTurn) return;
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
   */
  static async confirmDefense(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-defense-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;

    if (participantId !== exchange.defenderId) return;
    if (exchange.defenderSelectedDice.length !== exchange.declaredDiceCount) return;

    await MeleeStore.updateEncounter(id, updated);

    const { MeleeResolution } = await import("./melee-resolution.js");
    await MeleeResolution.resolvePrimaryExchange(id);
  }

  /**
   * Goes back one turn (GM control). Never goes below turn 1.
   * Resets pools and targets the same way startNewTurn does.
   */
  static async prevTurn(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    updated.turnState.turn = Math.max(1, (updated.turnState.turn || 1) - 1);
    updated.turnState.segment = 1;
    updated.turnState.segmentCost = 0;
    updated.turnState.selectionTurn = null;

    for (const pId in updated.participants) {
      const p = updated.participants[pId];
      p.pool = [];
      p.modifiedPool = null;
      p.skillBudget = 0;
      p.selfReductions = [];
      p.opponentGains = [];
      p.spentOnOpponent = {};
      p.usedDice = [];
      p.skillSpent = 0;
      p.maneuver = "none";
      p.tempoLevel = 0;
      p.attackTargetSnapshot = null;
      p.defenseTargetSnapshot = null;
    }

    for (const pId in updated.participants) {
      updated.primaryTargets[pId] = null;
    }

    const sortedIds = Object.values(updated.participants)
      .filter(p => p.isActive)
      .sort((a, b) => b.initiative - a.initiative)
      .map(p => p.id);
    updated.turnState.initiativeOrder = sortedIds;

    updated.log.push({
      type: "system",
      segment: 1,
      text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogNewTurn", { turn: updated.turnState.turn })
    });

    if (this._isMultiFight(updated)) {
      updated.turnState.phase = "target-selection";
      updated.turnState.selectionTurn = sortedIds[0];
      this.updateCrowding(updated);
      this._advanceTargetSelection(updated);
    } else {
      const [aId, bId] = sortedIds;
      if (aId && bId) {
        updated.primaryTargets[aId] = bId;
        updated.primaryTargets[bId] = aId;
      }
      this.updateCrowding(updated);
      updated.turnState.phase = "awaiting-pool-rolls";
    }

    game.neuroshima?.log("GM: prevTurn", { id, turn: updated.turnState.turn });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Manually sets the segment (GM control). Clamped to 1–3.
   */
  static async setSegment(id, segment) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    updated.turnState.segment = Math.max(1, Math.min(3, segment));
    updated.turnState.segmentCost = 0;

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

    updated.turnState.phase = "primary-attack-selection";
    updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;

    game.neuroshima?.log("GM: setSegment", { id, segment: updated.turnState.segment });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Changes the active weapon for a participant (before or after pool roll).
   */
  static async setWeapon(id, participantId, weaponId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const p = updated.participants[participantId];
    if (!p) return;

    p.weaponId = weaponId;

    // Re-snapshot targets if pool already rolled (recalculate from new weapon)
    if (p.pool?.length > 0) {
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      if (actor) {
        const weapon = actor.items.get(weaponId);
        const attribute = weapon?.system.attribute || "dexterity";
        const baseTarget = actor.system.attributeTotals?.[attribute] || 10;
        const armorPenalty = actor.system.combat?.totalArmorPenalty || 0;
        const woundPenalty = actor.system.combat?.totalWoundPenalty || 0;
        const totalPenalty = armorPenalty + woundPenalty;
        const attributeBonus = p.attackTargetSnapshot
          ? (p.attackTargetSnapshot - (p.targetValue || baseTarget) - (p.attackBonusSnapshot || 0))
          : 0;
        p.targetValue = baseTarget;
        p.attackBonusSnapshot = weapon?.system.attackBonus || 0;
        p.defenseBonusSnapshot = weapon?.system.defenseBonus || 0;
        p.attackTargetSnapshot = baseTarget + p.attackBonusSnapshot + attributeBonus - totalPenalty;
        p.defenseTargetSnapshot = baseTarget + p.defenseBonusSnapshot + attributeBonus - totalPenalty;
      }
    }

    game.neuroshima?.log("setWeapon", { participantId, weaponId });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Allocates a skill point from spender to a target die.
   * delta +1 = spend 1 point; -1 = unspend 1 point.
   * Same participant = reduce own die; different participant = increase opponent's die.
   */
  static async allocateSkill(id, spenderId, targetId, dieIndex, delta) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;
    if (encounter.turnState.phase !== "awaiting-pool-rolls") return;

    const updated = foundry.utils.deepClone(encounter);
    const spender = updated.participants[spenderId];
    const target = updated.participants[targetId];
    if (!spender || !target) return;

    const selfSpent = (spender.selfReductions || []).reduce((a, b) => a + b, 0);
    const oppSpent = Object.values(spender.spentOnOpponent || {})
      .reduce((sum, arr) => sum + arr.reduce((a, b) => a + b, 0), 0);
    const remaining = (spender.skillBudget || 0) - selfSpent - oppSpent;

    if (spenderId === targetId) {
      if (!spender.selfReductions) spender.selfReductions = new Array(spender.pool.length).fill(0);
      const current = (spender.selfReductions[dieIndex] || 0);
      if (delta > 0) {
        if (remaining <= 0) return;
        if ((spender.pool[dieIndex] || 1) - current <= 1) return;
        spender.selfReductions[dieIndex] = current + 1;
      } else {
        if (current <= 0) return;
        spender.selfReductions[dieIndex] = current - 1;
      }
    } else {
      if (!spender.spentOnOpponent[targetId]) {
        spender.spentOnOpponent[targetId] = new Array(target.pool.length).fill(0);
      }
      if (!target.opponentGains) target.opponentGains = new Array(target.pool.length).fill(0);
      const currentGain = target.opponentGains[dieIndex] || 0;
      if (delta > 0) {
        if (remaining <= 0) return;
        if ((target.pool[dieIndex] || 0) + currentGain >= 20) return;
        spender.spentOnOpponent[targetId][dieIndex] = (spender.spentOnOpponent[targetId][dieIndex] || 0) + 1;
        target.opponentGains[dieIndex] = currentGain + 1;
      } else {
        const spent = spender.spentOnOpponent[targetId]?.[dieIndex] || 0;
        if (spent <= 0) return;
        spender.spentOnOpponent[targetId][dieIndex] = spent - 1;
        target.opponentGains[dieIndex] = Math.max(0, currentGain - 1);
      }
    }

    game.neuroshima?.log("allocateSkill", { spenderId, targetId, dieIndex, delta, remaining });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Resets all skill allocations made by a participant, restoring opponent dice to their original state.
   */
  static async resetSkillAllocation(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const spender = updated.participants[participantId];
    if (!spender) return;

    for (const [targetId, allocations] of Object.entries(spender.spentOnOpponent || {})) {
      const target = updated.participants[targetId];
      if (!target) continue;
      for (let i = 0; i < allocations.length; i++) {
        if (!target.opponentGains) target.opponentGains = [];
        target.opponentGains[i] = Math.max(0, (target.opponentGains[i] || 0) - (allocations[i] || 0));
      }
    }

    spender.selfReductions = new Array(spender.pool.length).fill(0);
    spender.spentOnOpponent = {};

    game.neuroshima?.log("resetSkillAllocation", { participantId });
    await MeleeStore.updateEncounter(id, updated);
  }

  /**
   * Moves to the next segment or ends the turn if no dice are left.
   * (Kept for backward compatibility — auto-resolution still uses this internally.)
   */
  static async advanceSegment(id) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const updated = foundry.utils.deepClone(encounter);
    const cost = updated.turnState.segmentCost || 1;
    updated.turnState.segment += cost;
    updated.turnState.segmentCost = 0;

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
      await this.startNewTurn(id);
    } else {
      updated.turnState.phase = "primary-attack-selection";
      updated.turnState.selectionTurn = updated.turnState.initiativeOwnerId;
      await MeleeStore.updateEncounter(id, updated);
    }
  }
}
