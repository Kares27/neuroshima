/**
 * Custom Combatant class for Neuroshima 1.5.
 */
export class NeuroshimaCombatant extends Combatant {
  /** @override */
  async rollInitiative(formula) {
    if (!this.actor) return this;
    
    // Use the actor's unified initiative dialog
    await this.actor.rollInitiative({
        combatant: this,
        formula: formula
    });
    
    return this;
  }

  /** @override */
  getInitiativeRoll(formula) {
    // Return a dummy roll if someone calls this directly, 
    // to avoid "Unresolved StringTerm undefined" errors.
    // However, our rollInitiative override should handle the actual logic.
    formula = formula || "0";
    return new Roll(formula);
  }
}
