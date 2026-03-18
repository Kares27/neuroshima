/**
 * Custom Combat class for Neuroshima 1.5.
 */
export class NeuroshimaCombat extends Combat {
  /** @override */
  async rollInitiative(ids, {formula, updateTurn=true, messageOptions={}}={}) {
    // Structure of ids can be a single string or an array of strings
    const combatantIds = typeof ids === "string" ? [ids] : ids;

    // For Neuroshima, we want to show a dialog for each combatant if it's a manual roll.
    // However, rolling "All" or "NPCs" should probably be handled differently to avoid dialog spam.
    // For now, we'll focus on the single-combatant roll which is the most common use case for the button.
    
    const updates = [];
    const messages = [];

    for (const id of combatantIds) {
      const combatant = this.combatants.get(id);
      if (!combatant?.actor) continue;

      // If it's a single roll, or if the user is the owner, show the dialog.
      // If we're rolling for multiple (like Roll All), and it's not the GM, 
      // we might want to skip the dialog or use defaults, but Neuroshima rules 
      // usually involve choices.
      
      let initiativeValue;
      
      // If this is a single roll (typical for the button click), use the dialog.
      if (combatantIds.length === 1) {
        initiativeValue = await combatant.actor.rollInitiative({ combatant, formula });
      } else {
        // For multiple rolls (Roll All / Roll NPCs), we might want to automate it 
        // to avoid 20 dialogs popping up. Let's use a default roll for NPCs 
        // and only show dialogs for PCs if the user owns them?
        // Actually, let's just use the dialog for now and see how it feels.
        initiativeValue = await combatant.actor.rollInitiative({ combatant, formula });
      }

      game.neuroshima.log(`Initiative roll for ${combatant.name}:`, initiativeValue);

      if (initiativeValue === null || initiativeValue === undefined) continue;

      updates.push({
        _id: id,
        initiative: initiativeValue
      });
    }

    // Update combatants
    if (updates.length > 0) {
        await this.updateEmbeddedDocuments("Combatant", updates);
    }

    // Ensure the turn order is updated if requested
    if (updateTurn) {
        await this.update({ turn: this.turn });
    }

    return this;
  }
}
