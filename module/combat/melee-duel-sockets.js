/**
 * Warstwa komunikacji socketowej dla starć w zwarciu.
 * Przekierowuje wrażliwe żądania (zmiana stanu) do Mistrza Gry.
 */
export class NeuroshimaMeleeDuelSockets {
  /**
   * Obsługa ustawiania flagi pending przez GM.
   */
  static async _onSetPending(data) {
    game.neuroshima.log("NeuroshimaMeleeDuelSockets._onSetPending:", data);
    const doc = await fromUuid(data.actorUuid);
    const actor = doc?.actor || doc;
    if (actor) {
        if (data.clearExisting) {
            const pending = actor.getFlag("neuroshima", "opposedPending") || {};
            const updates = {};
            for (const id of Object.keys(pending)) {
                updates[`flags.neuroshima.opposedPending.-=${id}`] = null;
            }
            if (Object.keys(updates).length > 0) await actor.update(updates);
        }
        await actor.setFlag("neuroshima", `opposedPending.${data.flagData.requestId}`, data.flagData);
        game.neuroshima.log(`Flaga ustawiona dla ${actor.name}`);
        // Wymuszenie odświeżenia arkusza jeśli jest otwarty
        const sheet = Object.values(foundry.applications.instances).find(app => app.document === actor);
        if (sheet) sheet.render(true);
        else if (typeof actor.render === "function") actor.render(false);
    } else {
        game.neuroshima.error(`Nie znaleziono aktora dla UUID: ${data.actorUuid}`);
    }
  }

  /**
   * Obsługa czyszczenia flagi pending przez GM.
   */
  static async _onClearPending(data) {
    game.neuroshima.log("NeuroshimaMeleeDuelSockets._onClearPending:", data);
    const doc = await fromUuid(data.actorUuid);
    const actor = doc?.actor || doc;
    if (actor) {
        if (data.requestId === "meleePending") {
            await actor.unsetFlag("neuroshima", "meleePending");
        } else {
            await actor.update({ [`flags.neuroshima.opposedPending.-=${data.requestId}`]: null });
        }
        game.neuroshima.log(`Flaga wyczyszczona dla ${actor.name}`);
        // Wymuszenie odświeżenia arkusza jeśli jest otwarty
        const sheet = Object.values(foundry.applications.instances).find(app => app.document === actor);
        if (sheet) sheet.render(true);
        else if (typeof actor.render === "function") actor.render(false);
    }
  }

  /**
   * Obsługa rozstrzygnięcia starcia przez GM.
   */
  static async _onResolve(data) {
    const { messageId } = data;
    const message = game.messages.get(messageId);
    if (!message) return;

    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = new NeuroshimaMeleeDuel(message);
    await duel.resolve();
  }

  /**
   * Obsługa zaznaczania kości przez GM.
   */
  static async _onSelectDie(data) {
    const { messageId, role, index } = data;
    const message = game.messages.get(messageId);
    if (!message) return;

    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = new NeuroshimaMeleeDuel(message);
    await duel.selectDie(role, index);
  }

  /**
   * Obsługa deklarowania akcji przez GM.
   */
  static async _onDeclareAction(data) {
    const { messageId, role, type } = data;
    const message = game.messages.get(messageId);
    if (!message) return;

    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = new NeuroshimaMeleeDuel(message);
    await duel.declareAction(role, type);
  }

  /**
   * Obsługa reagowania na akcję przez GM.
   */
  static async _onRespondAction(data) {
    const { messageId, response } = data;
    const message = game.messages.get(messageId);
    if (!message) return;

    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = new NeuroshimaMeleeDuel(message);
    await duel.respondToAction(response);
  }

  /**
   * Obsługa przejmowania inicjatywy przez GM.
   */
  static async _onTakeoverInitiative(data) {
    const { messageId } = data;
    const message = game.messages.get(messageId);
    if (!message) return;

    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = new NeuroshimaMeleeDuel(message);
    await duel.takeoverInitiative();
  }

  /**
   * Obsługa aplikowania obrażeń przez GM.
   */
  static async _onApplyDamage(data) {
    // Implementacja aplikowania obrażeń przez CombatHelper
    const { messageId } = data;
    const message = game.messages.get(messageId);
    if (!message) return;

    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = new NeuroshimaMeleeDuel(message);
    const state = duel.state;
    
    if (state.status !== "resolved" || !state.result?.damageResult) return;

    const { CombatHelper } = await import("../helpers/combat-helper.js");
    const defenderActor = await fromUuid(state.defender.actorUuid);
    
    if (defenderActor) {
        // Logika aplikowania obrażeń w zależności od wyniku
        // Np. CombatHelper.applyDamage(defenderActor, state.result.damageResult, state.attack.rollData.finalLocation);
        ui.notifications.info(`Aplikowanie obrażeń ${state.result.damageResult} dla ${defenderActor.name}`);
    }
  }
}
