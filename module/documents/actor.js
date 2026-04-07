export class NeuroshimaActor extends Actor {
  /** @override */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    const updates = {};
    if (data.type === "character") {
      updates["prototypeToken.actorLink"] = true;
    }
    const actorIcons = {
      vehicle: "systems/neuroshima/assets/img/carkey.svg"
    };
    if (actorIcons[data.type] && (!data.img || data.img === "icons/svg/mystery-man.svg")) {
      updates.img = actorIcons[data.type];
    }
    if (Object.keys(updates).length > 0) {
      this.updateSource(updates);
    }
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
  }

  /**
   * Unified initiative roll for Neuroshima 1.5.
   * @param {Object} rollOptions - Initial options for the dialog.
   * @returns {Promise<Object>} The roll result.
   */
  async rollInitiativeDialog(rollOptions = {}) {
    const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
    const { NeuroshimaDice } = await import("../helpers/dice.js");

    return new Promise((resolve) => {
      let resolved = false;
      const dialog = new NeuroshimaInitiativeRollDialog({
        actor: this,
        ...rollOptions,
        onRoll: async (data) => {
          resolved = true;
          const result = await NeuroshimaDice.rollInitiative({
            ...data,
            actor: this
          });
          resolve(result);
          return result;
        },
        onClose: () => {
          if (!resolved) resolve(null);
        }
      });
      dialog.render(true);
    });
  }

  /** @override */
  async rollInitiative(options = {}) {
    // If we're already in combat, get the combatant
    const combatant = options.combatant || this.token?.combatant || game.combat?.getCombatantByActor(this.id);
    
    // Open the dialog
    const result = await this.rollInitiativeDialog({
        combatant: combatant,
        ...options
    });
    
    if (!result) return null;

    // Success Points are used as initiative value
    const initiativeValue = Number(result.successPoints);
    
    // If we have a combatant, update their initiative in the tracker
    if (combatant) {
        game.neuroshima.log(`Updating combatant ${combatant.id} initiative to ${initiativeValue}`);
        await combatant.update({ initiative: initiativeValue });
    }
    
    return initiativeValue;
  }
}
