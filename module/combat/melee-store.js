/**
 * @file melee-store.js
 * @description Persistence layer for Neuroshima 1.5 Melee Encounters.
 *
 * All melee encounter state is stored in `game.combat` flags under the key
 * `neuroshima.meleeEncounters` as a map of `{ [encounterId]: EncounterData }`.
 *
 * State mutations from non-GM clients are routed through socketlib:
 * `game.neuroshima.socket.executeAsGM("updateCombatFlag", ...)` so that
 * only the GM actually writes to the Combat document.
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

    const encounters = foundry.utils.deepClone(this.getEncounters());
    encounters[id] = data;

    if (game.user.isGM || !game.neuroshima.socket) {
      await combat.setFlag("neuroshima", "meleeEncounters", encounters);
    } else {
      await game.neuroshima.socket.executeAsGM("updateCombatFlag", "meleeEncounters", encounters);
    }
  }

  /**
   * Removes an encounter and cleans up participant flags.
   */
  static async removeEncounter(id) {
    const combat = game.combat;
    if (!combat) return;

    game.neuroshima?.log("removeEncounter | start", { id, isGM: game.user.isGM });

    // If not GM and socket available, delegate to GM to handle cross-actor flag cleanup
    if (!game.user.isGM && game.neuroshima.socket) {
      return game.neuroshima.socket.executeAsGM("removeMeleeEncounter", id);
    }

    const encounter = this.getEncounter(id);
    if (!encounter) {
        game.neuroshima?.warn("removeEncounter | encounter not found in flags", { id });
        return;
    }

    // Clear flags on all participants (GM can do this for any actor)
    for (const p of Object.values(encounter.participants)) {
      try {
        const doc = fromUuidSync(p.actorUuid);
        const actor = doc?.actor || doc;
        if (actor) {
            await actor.unsetFlag("neuroshima", "activeMeleeEncounter");
            game.neuroshima?.log(`removeEncounter | cleared flag for actor ${actor.name}`);
        }
      } catch (e) {
        console.warn(`Neuroshima | Failed to unset flag for participant ${p.name}`, e);
      }
    }

    // Use unsetFlag for specific key deletion
    await combat.unsetFlag("neuroshima", `meleeEncounters.${id}`);
    game.neuroshima?.log("removeEncounter | encounter deleted via unsetFlag");

    ui.combat?.render(true);
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
    ui.combat?.render(true);
  }

  /**
   * Removes a specific melee pending.
   */
  static async removePending(pendingUuid) {
    const combat = game.combat;
    if (!combat || !pendingUuid) return;

    game.neuroshima?.log("removePending | start", { pendingUuid, isGM: game.user.isGM });

    if (!game.user.isGM && game.neuroshima.socket) {
        return game.neuroshima.socket.executeAsGM("removeMeleePending", pendingUuid);
    }

    const pendingKey = pendingUuid.replace(/\./g, "-");
    
    // Use unsetFlag for specific key deletion
    await combat.unsetFlag("neuroshima", `meleePendings.${pendingKey}`);
    game.neuroshima?.log("removePending | pending deleted via unsetFlag");
    
    ui.combat?.render(true);
  }
}
