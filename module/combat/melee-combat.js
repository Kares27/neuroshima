import { NEUROSHIMA } from "../config.js";
import { MeleeEncounter } from "./melee-encounter.js";
import { MeleeStore } from "./melee-store.js";
import { MeleeCombatApp } from "../apps/melee-combat-app.js";

/**
 * Compatibility layer for Melee Combat.
 * Redirects legacy calls to the new MeleeEncounter system.
 */
export class NeuroshimaMeleeCombat {
  /**
   * Checks if two UUIDs represent the same actor.
   */
  static isSameActor(uuid1, uuid2) {
      if (!uuid1 || !uuid2) return false;
      if (uuid1 === uuid2) return true;

      const doc1 = fromUuidSync(uuid1);
      const doc2 = fromUuidSync(uuid2);
      if (!doc1 || !doc2) return false;

      const actor1 = doc1.actor || doc1;
      const actor2 = doc2.actor || doc2;
      return actor1.id === actor2.id;
  }

  /**
   * Legacy alias for pre-V12 code.
   * Old code still asks for an active "duel", now it should receive the active encounter.
   */
  static findActiveDuelForActor(actor) {
    return this.findActiveEncounterForActor(actor);
  }

  /**
   * Legacy pending dismissal kept for combat tracker / older UI hooks.
   */
  static async dismissMeleePending(pendingUuid) {
    const combat = game.combat;
    if (!combat || !pendingUuid) return;

    const pendingKey = pendingUuid.replace(/\./g, "-");

    if (game.neuroshima.socket) {
      await game.neuroshima.socket.executeAsGM("unsetCombatFlag", `meleePendings.${pendingKey}`);
    } else {
      await combat.unsetFlag("neuroshima", `meleePendings.${pendingKey}`);
    }
  }

  /**
   * Legacy alias for duel dismissal.
   */
  static async dismissMeleeDuel(id) {
    return this.clearMeleeFlags(id);
  }

  /**
   * Finds an active encounter for a given actor.
   */
  static findActiveEncounterForActor(actor) {
    const id = actor.getFlag("neuroshima", "activeMeleeEncounter");
    if (!id) return null;
    return MeleeStore.getEncounter(id);
  }

  /**
   * Initiates a pending melee state (waiting for defender).
   */
  static async initiateMeleePending(attackerUuid, defenderUuid, attackerInitiative, weaponId, maneuver = "none", chargeLevel = 0) {
    const combat = game.combat;
    if (!combat) return;

    const attackerDoc = fromUuidSync(attackerUuid);
    const defenderDoc = fromUuidSync(defenderUuid);
    const attackerActor = attackerDoc?.actor || attackerDoc;
    const defenderActor = defenderDoc?.actor || defenderDoc;

    if (!attackerActor || !defenderActor) return;

    const pendingKey = defenderUuid.replace(/\./g, "-");
    const pendingData = {
        id: defenderUuid,
        attackerId: attackerUuid,
        defenderId: defenderUuid,
        attackerName: attackerActor.name,
        defenderName: defenderActor.name,
        attackerInitiative,
        attackerManeuver: maneuver,
        attackerChargeLevel: chargeLevel,
        weaponId,
        active: true,
        timestamp: Date.now()
    };

    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleePendings.${pendingKey}`, pendingData);
    } else {
        await combat.setFlag("neuroshima", `meleePendings.${pendingKey}`, pendingData);
    }
    
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeDuel.PendingNotification"));
  }

  /**
   * Responds to a pending melee and starts the encounter.
   */
  static async respondToMeleePending(pendingUuid, defenderInitiative, defenderWeaponId = null, maneuver = "none", chargeLevel = 0) {
    const combat = game.combat;
    const pendingKey = pendingUuid.replace(/\./g, "-");
    const pendings = combat?.getFlag("neuroshima", "meleePendings") || {};
    const pending = pendings[pendingKey];

    if (!pending || !pending.active) return;

    // Clean up pending
    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("unsetCombatFlag", `meleePendings.${pendingKey}`);
    } else {
        await combat.unsetFlag("neuroshima", `meleePendings.${pendingKey}`);
    }

    const attackerDoc = fromUuidSync(pending.attackerId);
    const defenderDoc = fromUuidSync(pending.defenderId);
    
    const attackerData = {
      id: pending.attackerId,
      actorUuid: pending.attackerId,
      tokenUuid: attackerDoc?.token?.uuid || null,
      actorId: attackerDoc?.id || null,
      name: pending.attackerName,
      img: attackerDoc?.img || "",
      weaponId: pending.weaponId,
      initiative: pending.attackerInitiative,
      chargeLevel: pending.attackerChargeLevel
    };

    const defenderData = {
      id: pending.defenderId,
      actorUuid: pending.defenderId,
      tokenUuid: defenderDoc?.token?.uuid || null,
      actorId: defenderDoc?.id || null,
      name: defenderDoc?.name || "",
      img: defenderDoc?.img || "",
      weaponId: defenderWeaponId,
      initiative: defenderInitiative,
      chargeLevel: chargeLevel
    };

    const encounterId = await MeleeEncounter.create(attackerData, defenderData);
    this.openMeleeApp(encounterId);
  }

  /**
   * Opens the MeleeCombatApp for a specific encounter.
   */
  static openMeleeApp(id) {
    const app = new MeleeCombatApp(id);
    app.render(true);
  }

  /**
   * Legacy method support for clearing flags.
   */
  static async clearMeleeFlags(id) {
    await MeleeStore.removeEncounter(id);
  }
}
