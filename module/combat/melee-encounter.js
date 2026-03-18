import { MeleeStore } from "./melee-store.js";

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

    const encounter = {
      id,
      mode: "duel",
      teams: {
        A: [attackerId],
        B: [defenderId]
      },
      participants: {
        [attackerId]: this._mapParticipant({ ...attackerData, id: attackerId }, "A"),
        [defenderId]: this._mapParticipant({ ...defenderData, id: defenderId }, "B")
      },
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
        initiativeOwnerId: attackerData.initiative >= defenderData.initiative ? attackerId : defenderId
      },
      log: []
    };

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
      currentTargetId: null,
      engagedBy: [],
      pool: [],
      usedDice: [],
      skillSpent: 0,
      maneuver: "none",
      chargeLevel: data.chargeLevel || 0,
      tempoLevel: 0,
      attackBonusSnapshot: 0,
      defenseBonusSnapshot: 0,
      effectiveTargetSnapshot: null,
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
