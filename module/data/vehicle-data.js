/**
 * Data model for Vehicle actors.
 */
export class VehicleActorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      agility: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      agilityPenalty: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      maxSpeed: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      acceleration: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      brakes: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      durability: new fields.NumberField({ integer: true, initial: 6, min: 0, max: 20 }),
      efficiency: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({ integer: true, initial: 20, min: 1 })
      }),
      weakPoints: new fields.SchemaField({
        front: new fields.BooleanField({ initial: false }),
        back: new fields.BooleanField({ initial: false }),
        leftSide: new fields.BooleanField({ initial: false }),
        rightSide: new fields.BooleanField({ initial: false }),
        bottom: new fields.BooleanField({ initial: false })
      }),
      notes: new fields.HTMLField({ initial: "" }),
      lastRoll: new fields.SchemaField({
        modifier: new fields.NumberField({ integer: true, initial: 0 }),
        isOpen: new fields.BooleanField({ initial: true })
      })
    };
  }

  prepareDerivedData() {
    const actor = this.parent;
    if (!actor?.items) return;

    const locations = ["front", "back", "leftSide", "rightSide", "bottom"];
    const computedArmor = {};
    for (const loc of locations) computedArmor[loc] = 0;

    for (const item of actor.items) {
      if (item.type === "vehicle-mod" && item.system.category === "armor" && item.system.equipped) {
        for (const loc of locations) {
          computedArmor[loc] += item.system.armorRatings?.[loc] || 0;
        }
      }
    }

    this.computedArmor = computedArmor;

    let totalAgilityPenalty = this.agilityPenalty || 0;
    let totalEfficiencyLoss = 0;

    for (const item of actor.items) {
      if (item.type === "vehicle-damage" && item.system.isActive) {
        totalAgilityPenalty += item.system.agilityPenalty || 0;
        totalEfficiencyLoss += item.system.efficiencyLoss || 0;
      }
    }

    this.totalAgilityPenalty = totalAgilityPenalty;
    this.totalEfficiencyLoss = totalEfficiencyLoss;
    this.effectiveAgility = Math.max(0, (this.agility || 0) - totalAgilityPenalty);
    this.remainingEfficiency = Math.max(0, (this.efficiency?.max || 0) - totalEfficiencyLoss);
    this.isDisabled = this.remainingEfficiency <= 0;
  }
}

/**
 * Data model for Vehicle Modification items.
 */
export class VehicleModData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.HTMLField({ initial: "" }),
      category: new fields.StringField({
        required: true,
        initial: "modification",
        choices: ["modification", "armor"]
      }),
      installDifficulty: new fields.StringField({
        required: true,
        initial: "average"
      }),
      equipped: new fields.BooleanField({ initial: false }),
      armorRatings: new fields.SchemaField({
        front: new fields.NumberField({ initial: 0, min: 0 }),
        back: new fields.NumberField({ initial: 0, min: 0 }),
        leftSide: new fields.NumberField({ initial: 0, min: 0 }),
        rightSide: new fields.NumberField({ initial: 0, min: 0 }),
        bottom: new fields.NumberField({ initial: 0, min: 0 })
      })
    };
  }
}

/**
 * Data model for Vehicle Damage items.
 */
export class VehicleDamageData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.HTMLField({ initial: "" }),
      location: new fields.StringField({
        required: true,
        initial: "front",
        choices: ["front", "back", "leftSide", "rightSide", "bottom", "unknown"]
      }),
      damageType: new fields.StringField({
        required: true,
        initial: "L",
        choices: ["L", "C", "K"]
      }),
      agilityPenalty: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      efficiencyLoss: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      isActive: new fields.BooleanField({ initial: true })
    };
  }
}
