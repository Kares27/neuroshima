/**
 * Custom Combatant document for Neuroshima 1.5.
 *
 * Delegates initiative rolling to the actor, which is responsible for
 * presenting the appropriate dialog and computing the final value.
 */
export class NeuroshimaCombatant extends Combatant {
  /**
   * Delegate to the actor's `rollInitiative` method so that the system-specific
   * dialog and formula logic are centralised on the actor side.
   * @override
   */
  async rollInitiative(formula) {
    if (!this.actor) return this;
    await this.actor.rollInitiative({
        combatant: this,
        formula: formula
    });
    return this;
  }

  /**
   * Returns a zero-value Roll as a stub — actual initiative values are written
   * directly to the combatant document by the actor's roll handler, not
   * computed here.
   * @override
   */
  getInitiativeRoll(formula) {
    formula = formula || "0";
    return new Roll(formula);
  }
}

/**
 * Custom Combat document for Neuroshima 1.5.
 *
 * Overrides `rollInitiative` to route through the actor's roll handler rather
 * than Foundry's default formula-based path, giving the actor full control over
 * the dialog, modifiers, and the final written value.
 */
export class NeuroshimaCombat extends Combat {
  /**
   * Roll initiative for one or more combatants.
   *
   * Each affected combatant is resolved to its actor; the actor's
   * `rollInitiative` method is called and expected to return the numeric
   * initiative value (or `null`/`undefined` to abort that combatant).
   * Collected updates are written in a single `updateEmbeddedDocuments` call.
   *
   * Note: when `ids` contains more than one entry (Roll All / Roll NPCs), a
   * dialog is still shown per combatant — this is intentional for Neuroshima
   * because initiative choices are meaningful.  If that becomes unwieldy the
   * batch path can be separated later.
   *
   * @param {string|string[]} ids             - Combatant id(s) to roll for.
   * @param {object}          [options]
   * @param {string}          [options.formula]      - Optional override formula (passed through to the actor).
   * @param {boolean}         [options.updateTurn=true] - Whether to re-sync the current turn index after writing.
   * @param {object}          [options.messageOptions] - Reserved for future chat-message customisation.
   * @returns {Promise<NeuroshimaCombat>}
   * @override
   */
  async rollInitiative(ids, {formula, updateTurn=true, messageOptions={}}={}) {
    const combatantIds = typeof ids === "string" ? [ids] : ids;

    const updates = [];

    for (const id of combatantIds) {
      const combatant = this.combatants.get(id);
      if (!combatant?.actor) continue;

      const initiativeValue = await combatant.actor.rollInitiative({ combatant, formula });

      game.neuroshima.log(`Initiative roll for ${combatant.name}:`, initiativeValue);

      if (initiativeValue === null || initiativeValue === undefined) continue;

      updates.push({ _id: id, initiative: initiativeValue });
    }

    if (updates.length > 0) {
      await this.updateEmbeddedDocuments("Combatant", updates);
    }

    if (updateTurn) {
      await this.update({ turn: this.turn });
    }

    return this;
  }
}
