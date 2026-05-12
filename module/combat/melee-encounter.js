import { MeleeStore } from "./melee-store.js";
/**
 * @file melee-encounter.js
 * @description Lifecycle management for Neuroshima 1.5 Melee Encounters.
 *
 * Encounters are identified by a composite ID: `${attackerParticipantId}-${defenderParticipantId}`.
 * Each encounter tracks two teams (A and B) and the full participant roster.
 *
 * ### Encounter data shape (relevant fields)
 * ```js
 * {
 *   id, mode, teams: { A: [...], B: [...] },
 *   participants: { [id]: { actorUuid, name, img, team, initiative, isActive,
 *     weaponId, pool, modifiedPool, skillBudget, selfReductions, opponentGains,
 *     spentOnOpponent, usedDice, maneuver, tempoLevel,
 *     attackTargetSnapshot, defenseTargetSnapshot } },
 *   primaryTargets: { [attackerId]: defenderId },
 *   crowding: { [id]: { primaryOpponentId, opponentCount, dexPenalty, extraAttackers } },
 *   extraAttackQueue: [],
 *   currentExchange: { attackerId, defenderId, declaredDiceCount,
 *     attackerSelectedDice, defenderSelectedDice },
 *   turnState: { turn, segment, phase, initiativeOwnerId, initiativeOrder,
 *     selectionTurn, segmentCost },
 *   log: [{ type, segment, text }]
 * }
 * ```
 */
import { MeleeTurnService } from "./melee-turn-service.js";

/**
 * Manages Melee Encounter lifecycle: create, join, leave, end.
 */
export class MeleeEncounter {
  /**
   * Initializes a new melee encounter between two participants.
   * @param {Object} attackerData 
   * @param {Object} defenderData 
   * @returns {Promise<string>} New encounter ID
   */
  static async create(attackerData, defenderData) {
    const attackerId = attackerData.id.replace(/\./g, "-");
    const defenderId = defenderData.id.replace(/\./g, "-");
    const id = `${attackerId}-${defenderId}`;

    const combatTypeSetting = game.settings.get("neuroshima", "meleeCombatType") || "default";
    const resolutionModeMap = { default: "normal", opposedPips: "opposedPips", opposedSuccesses: "opposedSuccesses" };
    const resolutionMode = resolutionModeMap[combatTypeSetting] || "normal";

    const encounter = {
      id,
      mode: "duel",
      resolutionMode,
      teams: {
        A: [attackerId],
        B: [defenderId]
      },
      participants: {
        [attackerId]: this._mapParticipant({ ...attackerData, id: attackerId }, "A"),
        [defenderId]: this._mapParticipant({ ...defenderData, id: defenderId }, "B")
      },
      primaryTargets: {
        [attackerId]: defenderId,
        [defenderId]: attackerId
      },
      crowding: {
        [attackerId]: {
          primaryOpponentId: defenderId,
          opponentCount: 1,
          dexPenalty: 0,
          extraAttackers: []
        },
        [defenderId]: {
          primaryOpponentId: attackerId,
          opponentCount: 1,
          dexPenalty: 0,
          extraAttackers: []
        }
      },
      extraAttackQueue: [],
      currentExchange: {
        attackerId: null,
        defenderId: null,
        declaredAction: null,
        declaredDiceCount: 0,
        attackerSelectedDice: [],
        defenderSelectedDice: [],
        resolutionType: "normal"
      },
      turnState: {
        turn: 1,
        segment: 1,
        phase: "awaiting-pool-rolls",
        selectionTurn: null,
        initiativeOrder: [],
        segmentQueue: [],
        queueIndex: 0,
        segmentCost: 0,
        initiativeOwnerId: attackerData.initiative >= defenderData.initiative ? attackerId : defenderId
      },
      log: []
    };

    MeleeTurnService.updateCrowding(encounter);

    game.neuroshima?.log("Creating melee encounter", { id, attacker: attackerData.name, defender: defenderData.name });
    await MeleeStore.updateEncounter(id, encounter);
    await this._setParticipantFlags(encounter);
    return id;
  }

  /**
   * Participant joins an existing encounter.
   * @param {string} id Encounter ID
   * @param {Object} participantData 
   * @param {string} team "A" or "B"
   */
  static async join(id, participantData, team = "A") {
    const encounter = MeleeStore.getEncounter(id);
    if (!encounter) return;

    const participantId = participantData.id.replace(/\./g, "-");
    const updated = foundry.utils.deepClone(encounter);
    updated.participants[participantId] = this._mapParticipant({ ...participantData, id: participantId }, team);
    updated.teams[team].push(participantId);
    updated.mode = (updated.teams.A.length > 1 || updated.teams.B.length > 1) ? "group" : "duel";

    updated.primaryTargets[participantId] = null;
    updated.crowding[participantId] = {
      primaryOpponentId: null,
      opponentCount: 0,
      dexPenalty: 0,
      extraAttackers: []
    };

    // If now multi-fight and no pools have been rolled yet, switch to target-selection
    const isMultiFight = updated.mode === "group";
    const anyPoolRolled = Object.values(updated.participants).some(p => p.isActive && p.pool.length > 0);
    if (isMultiFight && !anyPoolRolled && updated.turnState.phase === "awaiting-pool-rolls") {
      for (const pId in updated.participants) {
        if (updated.participants[pId].isActive) updated.primaryTargets[pId] = null;
      }
      const sortedIds = Object.values(updated.participants)
        .filter(p => p.isActive)
        .sort((a, b) => b.initiative - a.initiative)
        .map(p => p.id);
      updated.turnState.initiativeOrder = sortedIds;
      updated.turnState.phase = "target-selection";
      updated.turnState.selectionTurn = sortedIds[0];
      MeleeTurnService.updateCrowding(updated);
      MeleeTurnService._advanceTargetSelection(updated);
    }

    await MeleeStore.updateEncounter(id, updated);
    const doc = fromUuidSync(participantData.actorUuid);
    const actor = doc?.actor || doc;
    if (actor) await actor.setFlag("neuroshima", "activeMeleeEncounter", id);
  }

  /**
   * Maps raw participant data to the internal encounter structure.
   * @private
   */
  static _mapParticipant(data, team) {
    return {
      id: data.id,
      actorUuid: data.actorUuid,
      tokenUuid: data.tokenUuid,
      actorId: data.actorId,
      name: data.name,
      img: data.img,
      team,
      weaponId: data.weaponId,
      initiative: data.initiative,
      pool: [],
      usedDice: [],
      skillSpent: 0,
      maneuver: "none",
      chargeLevel: data.chargeLevel || 0,
      tempoLevel: 0,
      attackBonusSnapshot: 0,
      defenseBonusSnapshot: 0,
      attackTargetSnapshot: null,
      defenseTargetSnapshot: null,
      isActive: true
    };
  }

  /**
   * Sets the active encounter flag on all participants.
   * @private
   */
  static async _setParticipantFlags(encounter) {
    for (const p of Object.values(encounter.participants)) {
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      if (actor) await actor.setFlag("neuroshima", "activeMeleeEncounter", encounter.id);
    }
  }

  /**
   * Closes the encounter and cleans up.
   */
  static async end(id) {
    await MeleeStore.removeEncounter(id);
  }
}
