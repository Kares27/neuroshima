
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
   * Maps maneuver string values (from pool-roll dialog) to their condition key.
   * Tempo and Szarża are tracked separately via tempoLevel / chargeLevel.
   */
  static _MANEUVER_TO_CONDITION = {
    fury:         "maneuver-fury",
    furia:        "maneuver-fury",
    fullDefense:  "maneuver-full-defense",
    pelnaObrona:  "maneuver-full-defense"
  };

  /** All 4 maneuver condition keys — used for bulk-removal. */
  static _MANEUVER_CONDITION_KEYS = [
    "maneuver-pace",
    "maneuver-charge",
    "maneuver-fury",
    "maneuver-full-defense"
  ];

  /**
   * Removes all 4 maneuver conditions from an actor.
   * Silently skips actors the caller does not own (cosmetic conditions only).
   * @param {Actor} actor
   */
  static async _clearManeuverConditions(actor) {
    if (!actor) return;
    if (!game.user.isGM && !actor.isOwner) return;
    for (const key of this._MANEUVER_CONDITION_KEYS) {
      try { await actor.removeCondition(key); } catch { /* noop */ }
    }
  }

  /**
   * Syncs all maneuver conditions for one participant after setPool.
   *
   * MANEUVER condition rules:
   *
   * • Furia / Fury (maneuver-fury):
   *   Boolean condition.  Applied to the participant who declared "fury" in the pool dialog.
   *   Rule effect (+2 Zręczność in attack) is already baked into attackTargetSnapshot via
   *   rollWeaponTest.  The condition is cosmetic/informational for the token HUD and scripts.
   *
   * • Pełna obrona / Full Defense (maneuver-full-defense):
   *   Boolean condition.  Applied to the participant who declared "fullDefense".
   *   Rule effect (+2 Zręczność in defense, 2-success takeover requirement) is enforced in
   *   defenseTargetSnapshot (via rollWeaponTest) and in getEffectiveTarget / resolution code.
   *
   * • Szarża / Charge (maneuver-charge):
   *   Boolean condition.  Applied when `participant.chargeLevel > 0` (set during initiative roll).
   *   NOTE — chargeLevel tracks the bonus declared at initiative time (+1..+3 to Zręczność on
   *   the initiative test).  Rule: the SAME value becomes a PENALTY on the first pool roll if the
   *   charge user LOSES the initiative test.  Enforcement of that penalty and the restriction
   *   "cannot use defensive maneuvers on the first turn" is currently left to the pool-roll dialog
   *   and is NOT automatically enforced by this code.
   *   chargeLevel is reset to 0 at startNewTurn so the condition only appears on turn 1.
   *
   * • Zwiększone tempo / Increased Pace (maneuver-pace):
   *   Int condition (stores the effective tempo level, 1–3).  Applied to BOTH the participant
   *   AND their primary opponent because the rule raises the PT for both combatants equally.
   *   `effectiveTempo = Math.max(all participants' tempoLevel)` ensures consistency even if
   *   both sides declare the maneuver.
   *
   * @param {object} encounter     Full (updated) encounter data from MeleeStore.
   * @param {string} participantId ID of the participant who just called setPool.
   */
  static async _applyParticipantManeuverConditions(encounter, participantId) {
    const p = encounter.participants[participantId];
    if (!p) return;

    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;

    // Tempo is a shared effect — always take the max across all active participants.
    const effectiveTempo = Math.max(
      0, ...Object.values(encounter.participants).map(q => q.tempoLevel ?? 0)
    );

    const _syncOne = async (participant, participantActor) => {
      if (!participantActor) return;
      if (!game.user.isGM && !participantActor.isOwner) return;
      await this._clearManeuverConditions(participantActor);
      const condKey = this._MANEUVER_TO_CONDITION[participant.maneuver];
      if (condKey) await participantActor.addCondition(condKey).catch(() => {});
      // Szarża condition: show as long as chargeLevel > 0 (turn 1 only).
      if ((participant.chargeLevel ?? 0) > 0) await participantActor.addCondition("maneuver-charge").catch(() => {});
      // Tempo condition: int value = effective level (for display and potential script use).
      if (effectiveTempo > 0) await participantActor.addCondition("maneuver-pace", effectiveTempo).catch(() => {});
    };

    await _syncOne(p, actor);

    // Push tempo condition to the opponent as well (they share the raised PT).
    const opponentId = encounter.primaryTargets?.[participantId];
    const opponent = opponentId ? encounter.participants[opponentId] : null;
    if (opponent) {
      const opDoc = fromUuidSync(opponent.actorUuid);
      const opActor = opDoc?.actor || opDoc;
      await _syncOne(opponent, opActor);
    }
  }

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
      p.chargeLevel = 0;
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

    // MANEUVER — Trash collector (new turn):
    // All 4 maneuver conditions (maneuver-pace, maneuver-charge, maneuver-fury,
    // maneuver-full-defense) are purely turn-scoped.  At the start of each new turn
    // we strip them from every active participant so the token HUD always reflects the
    // current (not previous) turn's maneuver choice.
    // NOTE: chargeLevel is also reset to 0 above — Szarża only applies to the first turn.
    for (const p of Object.values(updated.participants)) {
      if (!p.isActive) continue;
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      if (actor) await this._clearManeuverConditions(actor);
    }
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
   * @param {{isSuccess:boolean,isNat20:boolean}[]|null} dieResults  Per-die success flags pre-computed by rollWeaponTest
   */
  static async setPool(id, participantId, results, maneuver = "none", tempoLevel = 0, attributeBonus = 0, modifiedPool = null, skillBudget = 0, rollTarget = null, meleeAction = "attack", dieResults = null, damageShift = 0) {
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

      // ── increasedTempo guard ────────────────────────────────────────────
      // rollWeaponTest bakes the tempo difficulty-shift into its returned
      // target value (via effectiveDifficulty → basePenalty → totalPenalty →
      // getDifficultyFromPercent → finalDiff.mod).  getEffectiveTarget() then
      // re-applies the shift a second time.  To avoid this double-count we
      // deliberately fall through to the approximate fallback when the roll was
      // made with increasedTempo.  The fallback snapshot contains NO tempo
      // shift, so getEffectiveTarget() applies it exactly once — which is the
      // correct behaviour (both participants pay the same raised PT).
      const _usePreferred = rollTarget !== null && rollTarget !== undefined
        && maneuver !== "increasedTempo";

      if (_usePreferred) {
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
        // ── Fallback (no target passed, or increasedTempo) ─────────────────
        // Approximate from actor state. NOTE: this can be inaccurate when armor/
        // wound penalties are present because totalArmorPenalty is a percentage
        // that must be converted via getDifficultyFromPercent, not subtracted directly.
        // For increasedTempo: tempo is intentionally NOT included here — it will
        // be applied by getEffectiveTarget() during exchange resolution so that
        // BOTH participants (attacker AND defender) pay the raised PT equally.
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
    p.damageShift = damageShift || 0;
    p.usedDice = [];
    p.skillSpent = 0;
    // Store per-die success flags from the roll (canonical source of truth matching chat card).
    p.dieResults = dieResults?.length === results.length ? dieResults : null;

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
    await this._applyParticipantManeuverConditions(updated, participantId);
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
        // "Attacked do not choose" — auto-assign them to their primary attacker
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
   * Declares a non-combat action (costs X segments, sends a chat message).
   * The attacker spends the selected dice as segments without entering a duel.
   */
  static async performAction(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-attack-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    if (participantId !== updated.turnState.selectionTurn) return;

    const exchange = updated.currentExchange;
    const selectedDice = exchange.attackerSelectedDice || [];
    if (selectedDice.length === 0) return;

    const diceCount = selectedDice.length;
    const p = updated.participants[participantId];
    if (!p) return;

    // Count successes so the GM can see them in chat
    const dr = p.dieResults;
    const mp = p.modifiedPool;
    const target = p.attackTargetSnapshot != null ? p.attackTargetSnapshot : (p.targetValue ?? 10);
    const successCount = selectedDice.filter(i => {
      if (dr) return dr[i]?.isSuccess ?? false;
      const val = mp ? mp[i] : p.pool[i];
      return p.pool[i] !== 20 && val <= target;
    }).length;

    p.usedDice.push(...selectedDice);

    // Send chat message
    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    const content = game.i18n.format("NEUROSHIMA.MeleeDuel.PerformActionMsg", {
      name: p.name, segments: diceCount, successes: successCount
    });
    ChatMessage.create({
      content: `<div class="neuroshima-roll-card"><p>${content}</p></div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });

    // Clear exchange
    updated.currentExchange = {
      attackerId: null, defenderId: null, declaredAction: null,
      declaredDiceCount: 0, attackerSelectedDice: [], defenderSelectedDice: [],
      resolutionType: "normal"
    };

    // Advance segment by dice count used
    const newSeg = (updated.turnState.segment || 1) + diceCount;
    updated.log.push({
      type: "action",
      turn: updated.turnState.turn,
      segment: updated.turnState.segment,
      text: content
    });

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
   * Confirms attack selection and moves to defense selection.
   */
  static async confirmAttack(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-attack-selection") return;

    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;

    if (participantId !== updated.turnState.selectionTurn) return;
    if (exchange.attackerSelectedDice.length === 0) return;

    // opposedPips mode requires exactly 3 dice committed by the attacker
    if ((updated.resolutionMode || "normal") === "opposedPips" && exchange.attackerSelectedDice.length !== 3) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.OpposedPips.MustSelectAll"));
      return;
    }

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
    const defender = updated.participants[exchange.defenderId];
    const defenderPoolSize = (defender?.pool || []).length;
    const usedCount = (defender?.usedDice || []).length;
    const availableDefenderDice = defenderPoolSize - usedCount;
    const requiredDiceCount = Math.min(exchange.declaredDiceCount, availableDefenderDice);
    if (exchange.defenderSelectedDice.length !== requiredDiceCount) return;

    await MeleeStore.updateEncounter(id, updated);

    const { MeleeResolution } = await import("./melee-resolution.js");
    await MeleeResolution.resolvePrimaryExchange(id);
  }

  static async berserkerAcceptHit(id, participantId) {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter || encounter.turnState.phase !== "primary-defense-selection") return;
    const updated = foundry.utils.deepClone(encounter);
    const exchange = updated.currentExchange;
    if (participantId !== exchange.defenderId) return;
    exchange.defenderSelectedDice = [];
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
      p.chargeLevel = 0;
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

    // MANEUVER — Trash collector (prevTurn / GM rewind):
    // Same cleanup as startNewTurn — maneuver conditions are reset so the rewound
    // turn starts with a clean slate.
    for (const p of Object.values(updated.participants)) {
      if (!p.isActive) continue;
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      if (actor) await this._clearManeuverConditions(actor);
    }
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
    const _allocAllowedPhases = ["awaiting-pool-rolls", "primary-attack-selection", "primary-defense-selection"];
    if (!_allocAllowedPhases.includes(encounter.turnState.phase)) return;

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
