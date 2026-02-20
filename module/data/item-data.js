/**
 * Base schema for all Neuroshima items.
 */
function baseSchema() {
  const fields = foundry.data.fields;
  return {
    description: new fields.HTMLField({ initial: "" }),
    weight: new fields.NumberField({ required: true, initial: 0, min: 0 }),
    cost: new fields.NumberField({ required: true, initial: 0, min: 0 }),
    quantity: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 })
  };
}

/**
 * Equipable sub-schema.
 */
function equipableSchema() {
  const fields = foundry.data.fields;
  return {
    equipped: new fields.BooleanField({ initial: false })
  };
}

/**
 * Data model for Weapons.
 */
export class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...baseSchema(),
      ...equipableSchema(),
      weaponType: new fields.StringField({ 
        required: true, 
        initial: "melee", 
        choices: ["melee", "ranged", "thrown"] 
      }),
      requiredBuild: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      attribute: new fields.StringField({ initial: "dexterity" }),
      skill: new fields.StringField({ initial: "" }),
      attackBonus: new fields.NumberField({ integer: true, initial: 0 }),
      defenseBonus: new fields.NumberField({ integer: true, initial: 0 }),
      
      // Melee specific
      damageMelee1: new fields.StringField({ initial: "D" }),
      damageMelee2: new fields.StringField({ initial: "L" }),
      damageMelee3: new fields.StringField({ initial: "C" }),

      // Ranged specific
      rangedSubtype: new fields.StringField({ initial: "pistols" }),
      damage: new fields.StringField({ initial: "L" }),
      caliber: new fields.StringField({ initial: "" }),
      magazine: new fields.StringField({ initial: "" }),
      piercing: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      fireRate: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      capacity: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      jamming: new fields.NumberField({ integer: true, initial: 20, min: 0, max: 20 })
    };
  }
}

/**
 * Armor sub-schema.
 */
function armorSchema() {
  const fields = foundry.data.fields;
  return {
    ratings: new fields.SchemaField({
      head: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      torso: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      leftArm: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      rightArm: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      leftLeg: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      rightLeg: new fields.NumberField({ integer: true, initial: 0, min: 0 })
    }),
    durability: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
    durabilityDamage: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
    requiredBuild: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
    damage: new fields.SchemaField({
      head: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      torso: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      leftArm: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      rightArm: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      leftLeg: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      rightLeg: new fields.NumberField({ integer: true, initial: 0, min: 0 })
    }),
    penalty: new fields.NumberField({ integer: true, initial: 0, min: 0 })
  };
}

/**
 * Data model for Armor.
 */
export class ArmorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...baseSchema(),
      ...equipableSchema(),
      armor: new fields.SchemaField(armorSchema())
    };
  }
}

/**
 * Data model for Gear.
 */
export class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...baseSchema(),
      ...equipableSchema()
    };
  }
}

/**
 * Data model for Ammo.
 */
export class AmmoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...baseSchema(),
      caliber: new fields.StringField({ initial: "" }),
      isOverride: new fields.BooleanField({ initial: false }),
      overrideDamage: new fields.BooleanField({ initial: false }),
      damage: new fields.StringField({ initial: "L" }),
      overridePiercing: new fields.BooleanField({ initial: false }),
      piercing: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      overrideJamming: new fields.BooleanField({ initial: false }),
      jamming: new fields.NumberField({ integer: true, initial: 20, min: 0, max: 20 }),
      isPellet: new fields.BooleanField({ initial: false }),
      pelletCount: new fields.NumberField({ integer: true, initial: 1, min: 1 }),
      pelletRanges: new fields.SchemaField({
        range1: new fields.SchemaField({ 
            distance: new fields.NumberField({ initial: 2, min: 0 }), 
            damage: new fields.StringField({ initial: "K" }) 
        }),
        range2: new fields.SchemaField({ 
            distance: new fields.NumberField({ initial: 5, min: 0 }), 
            damage: new fields.StringField({ initial: "C" }) 
        }),
        range3: new fields.SchemaField({ 
            distance: new fields.NumberField({ initial: 10, min: 0 }), 
            damage: new fields.StringField({ initial: "L" }) 
        }),
        range4: new fields.SchemaField({ 
            distance: new fields.NumberField({ initial: 20, min: 0 }), 
            damage: new fields.StringField({ initial: "D" }) 
        })
      })
    };
  }
}

/**
 * Data model for Magazines.
 */
export class MagazineData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...baseSchema(),
      ...equipableSchema(),
      caliber: new fields.StringField({ initial: "" }),
      capacity: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      // contents: Array of { ammoId, name, quantity, overrides: { damage, piercing, jamming } }
      contents: new fields.ArrayField(new fields.ObjectField(), { initial: [] })
    };
  }

  /**
   * Get total number of bullets in magazine.
   */
  get totalCount() {
    return this.contents.reduce((acc, stack) => acc + stack.quantity, 0);
  }
}

/**
 * Data model for Tricks.
 */
export class TrickData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...baseSchema()
    };
  }
}

/**
 * Data model for Wounds.
 */
export class WoundData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.HTMLField({ initial: "" }),
      location: new fields.StringField({ 
        required: true, 
        initial: "torso",
        choices: ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"]
      }),
      damageType: new fields.StringField({ 
        required: true, 
        initial: "D"
      }),
      penalty: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      isHealing: new fields.BooleanField({ initial: false }),
      isActive: new fields.BooleanField({ initial: true })
    };
  }
}
