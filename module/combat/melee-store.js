/**
 * Handles persistence and synchronization for Melee Encounters via Combat flags.
 */
export class MeleeStore {
  /**
   * Retrieves all melee encounters from the active combat.
   */
  static getEncounters() {
    return game.combat?.getFlag("neuroshima", "meleeEncounters") || {};
  }

  /**
   * Retrieves a specific encounter by its ID.
   */
  static getEncounter(id) {
    const encounters = this.getEncounters();
    return encounters[id] || null;
  }

  /**
   * Updates an encounter. Uses socketlib if available to ensure GM permissions.
   */
  static async updateEncounter(id, data) {
    const combat = game.combat;
    if (!combat) return;

    if (game.neuroshima.socket) {
      await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleeEncounters.${id}`, data);
    } else {
      await combat.setFlag("neuroshima", `meleeEncounters.${id}`, data);
    }
  }

  /**
   * Removes an encounter and cleans up participant flags.
   */
  static async removeEncounter(id) {
    const combat = game.combat;
    if (!combat) return;

    const encounter = this.getEncounter(id);
    if (!encounter) return;

    // Clear flags on all participants
    for (const p of Object.values(encounter.participants)) {
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      if (actor) await actor.unsetFlag("neuroshima", "activeMeleeEncounter");
    }

    if (game.neuroshima.socket) {
      await game.neuroshima.socket.executeAsGM("unsetCombatFlag", `meleeEncounters.${id}`);
    } else {
      await combat.unsetFlag("neuroshima", `meleeEncounters.${id}`);
    }
  }

  /**
   * Cleans up all melee pendings.
   */
  static async clearAllPendings() {
    const combat = game.combat;
    if (!combat) return;

    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("unsetCombatFlag", "meleePendings");
    } else {
        await combat.unsetFlag("neuroshima", "meleePendings");
    }
  }
}
