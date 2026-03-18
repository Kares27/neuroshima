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

    game.neuroshima?.log("removeEncounter", { id, isGM: game.user.isGM });

    // If not GM and socket available, delegate to GM to handle cross-actor flag cleanup
    if (!game.user.isGM && game.neuroshima.socket) {
      return game.neuroshima.socket.executeAsGM("removeMeleeEncounter", id);
    }

    const encounter = this.getEncounter(id);
    if (!encounter) {
        game.neuroshima?.warn("removeEncounter | encounter not found", { id });
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

    const encounters = foundry.utils.deepClone(this.getEncounters());
    if (encounters[id]) {
        delete encounters[id];
        await combat.setFlag("neuroshima", "meleeEncounters", encounters);
        game.neuroshima?.log("removeEncounter | encounter deleted and flag set");
    }

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

    game.neuroshima?.log("removePending", { pendingUuid, isGM: game.user.isGM });

    if (!game.user.isGM && game.neuroshima.socket) {
        return game.neuroshima.socket.executeAsGM("removeMeleePending", pendingUuid);
    }

    const pendingKey = pendingUuid.replace(/\./g, "-");
    const pendings = foundry.utils.deepClone(combat.getFlag("neuroshima", "meleePendings") || {});
    
    game.neuroshima?.log("removePending | current pendings", { 
        count: Object.keys(pendings).length,
        hasKey: !!pendings[pendingKey],
        pendingKey
    });

    if (pendings[pendingKey]) {
        delete pendings[pendingKey];
        await combat.setFlag("neuroshima", "meleePendings", pendings);
        game.neuroshima?.log("removePending | pending deleted and flag set");
    } else {
        game.neuroshima?.warn("removePending | pending key not found", { pendingKey });
    }
    
    ui.combat?.render(true);
  }
}
