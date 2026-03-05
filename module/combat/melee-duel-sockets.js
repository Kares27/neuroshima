/**
 * Warstwa komunikacji socketowej dla starć w zwarciu przy użyciu Combat Flags.
 * Przekierowuje wrażliwe żądania (zmiana stanu) do Mistrza Gry.
 */
export class NeuroshimaMeleeDuelSockets {
  static async _onUpdateInitiative(data) {
    const { duelId, role, rollResult } = data;
    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (duel) await duel.updateInitiative(role, rollResult);
  }

  static async _onModifyDie(data) {
    const { duelId, side, target, index, delta } = data;
    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (duel) await duel.modifyDie(side, target, index, delta);
  }

  static async _onToggleReady(data) {
    const { duelId, role } = data;
    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (duel) await duel.toggleReady(role);
  }

  static async _onSelectDie(data) {
    const { duelId, role, index } = data;
    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (duel) await duel.selectDie(role, index);
  }

  static async _onDeclareAction(data) {
    const { duelId, role, type } = data;
    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (duel) await duel.declareAction(role, type);
  }

  static async _onRespondAction(data) {
    const { duelId, response } = data;
    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (duel) await duel.respondToAction(response);
  }

  static async _onTakeoverInitiative(data) {
    const { duelId } = data;
    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (duel) await duel.takeoverInitiative();
  }

  static async _onFinishDuel(data) {
    const { duelId } = data;
    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (duel) await duel.finish();
  }

  static async _onNextTurn(data) {
    const { duelId } = data;
    const { NeuroshimaMeleeDuel } = await import("./melee-duel.js");
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (duel) await duel.nextTurn();
  }
}
