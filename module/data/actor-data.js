import { NEUROSHIMA } from "../config.js";

/**
 * Data model for Neuroshima Actors.
 */
export class NeuroshimaActorData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    
    // Helper to create attribute field
    const attributeField = () => new fields.NumberField({
      required: true,
      integer: true,
      initial: 6,
      min: 0,
      max: 40
    });

    // Helper to create modifier field
    const modifierField = () => new fields.NumberField({
      required: true,
      integer: true,
      initial: 0
    });

    // Helper to create skill field
    const skillField = () => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 20 }),
      label: new fields.StringField({ initial: "" }) // Used for Knowledge skills
    });

    const skillMap = {};
    const specializationMap = {};
    for (const attr of Object.values(NEUROSHIMA.skillConfiguration)) {
      for (const [specKey, specSkills] of Object.entries(attr)) {
        specializationMap[specKey] = new fields.BooleanField({ initial: false });
        for (const skill of specSkills) {
          skillMap[skill] = skillField();
        }
      }
    }

    return {
      specialization: new fields.StringField({ initial: "" }),
      origin: new fields.StringField({ initial: "" }),
      profession: new fields.StringField({ initial: "" }),
      xp: new fields.SchemaField({
        current: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        spent: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        total: new fields.NumberField({ integer: true, initial: 0, min: 0 })
      }),
      attributes: new fields.SchemaField({
        dexterity: attributeField(),
        perception: attributeField(),
        charisma: attributeField(),
        cleverness: attributeField(),
        constitution: attributeField()
      }),
      modifiers: new fields.SchemaField({
        dexterity: modifierField(),
        perception: modifierField(),
        charisma: modifierField(),
        cleverness: modifierField(),
        constitution: modifierField()
      }),
      skills: new fields.SchemaField(skillMap),
      specializations: new fields.SchemaField(specializationMap),
      lastRoll: new fields.SchemaField({
        modifier: new fields.NumberField({ integer: true, initial: 0 }),
        baseDifficulty: new fields.StringField({ initial: "average" }),
        useArmorPenalty: new fields.BooleanField({ initial: true }),
        useWoundPenalty: new fields.BooleanField({ initial: true }),
        isOpen: new fields.BooleanField({ initial: true })
      }),
      lastWeaponRoll: new fields.SchemaField({
        percentageModifier: new fields.NumberField({ integer: true, initial: 0 }),
        difficulty: new fields.StringField({ initial: "average" }),
        useArmorPenalty: new fields.BooleanField({ initial: true }),
        useWoundPenalty: new fields.BooleanField({ initial: true }),
        isOpen: new fields.BooleanField({ initial: false })
      }),
      notes: new fields.HTMLField({ initial: "" }),
      hp: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({ integer: true, initial: 27, min: 1 })
      }),
      combat: new fields.SchemaField({
        meleeInitiative: new fields.NumberField({ integer: true, initial: 0 })
      }),
      healingRate: new fields.NumberField({ integer: true, initial: 5, min: 1, max: 100 }),
      encumbrance: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0, min: 0 }),
        max: new fields.NumberField({ initial: 0, min: 0 }),
        pct: new fields.NumberField({ initial: 0, min: 0, max: 100 }),
        enabled: new fields.BooleanField({ initial: true })
      })
    };
  }

  /**
   * Shared preparation logic for attributes and combat stats.
   * @protected
   */
  _prepareSharedData() {
      const system = this;
      const actor = this.parent;
      const items = actor?.items ? Array.from(actor.items) : [];

      // 1. Attribute Totals and Thresholds
      this.attributeTotals = {};
      this.thresholds = {};
      const attributeKeys = system.attributes ? Object.keys(system.attributes) : [];
      
      for (let key of attributeKeys) {
          const attrValue = Number(system.attributes[key]) || 0;
          const modValue = Number(system.modifiers[key]) || 0;
          const totalValue = attrValue + modValue;
          
          this.attributeTotals[key] = totalValue;
          this.thresholds[key] = {};
          for (let [diffKey, diffValue] of Object.entries(NEUROSHIMA.difficulties)) {
              this.thresholds[key][diffKey] = totalValue + (diffValue.mod || 0);
          }
      }

      // 2. Combat Stats (Kary i Obrażenia)
      const combatUpdates = {
          totalArmorPenalty: items.reduce((total, i) => {
              if (i.type === "armor" && i.system.equipped) return total + (i.system.armor?.penalty || 0);
              return total;
          }, 0),
          totalWoundPenalty: items.reduce((total, i) => {
              if (i.type === "wound" && i.system.isActive) return total + (i.system.penalty || 0);
              return total;
          }, 0),
          totalDamagePoints: items.reduce((total, i) => {
              if (i.type === "wound" && i.system.isActive) {
                  const type = i.system.damageType;
                  const points = NEUROSHIMA.woundConfiguration[type]?.damageHealth || 0;
                  return total + points;
              }
              return total;
          }, 0)
      };

      // Safely merge into combat object
      if (!this.combat) this.combat = {};
      for (let [key, value] of Object.entries(combatUpdates)) {
          this.combat[key] = value;
      }
  }

  /** @override */
  prepareDerivedData() {
    if (!game.settings || !game.settings.settings?.has("neuroshima.enableEncumbrance")) return;

    const system = this;
    const actor = this.parent;

    try {
      // Shared logic for attributes and combat stats
      this._prepareSharedData();

      // Encumbrance logic (Character specific)
      const enableEncumbrance = game.settings.get("neuroshima", "enableEncumbrance") ?? true;
      const baseEnc = game.settings.get("neuroshima", "baseEncumbrance") ?? 20;
      const useConBonus = game.settings.get("neuroshima", "useConstitutionBonus") ?? true;
      const threshold = game.settings.get("neuroshima", "encumbranceThreshold") ?? 10;
      const interval = game.settings.get("neuroshima", "encumbranceBonusInterval") ?? 2;
      const bonusValue = game.settings.get("neuroshima", "encumbranceBonusValue") ?? 5;

      system.encumbrance.enabled = enableEncumbrance;
      if (enableEncumbrance) {
          const conValue = (Number(system.attributes.constitution) || 0) + (Number(system.modifiers.constitution) || 0);
          let maxWeight = baseEnc;
          if (useConBonus && conValue > threshold && interval > 0) {
              const bonusSteps = Math.floor((conValue - threshold) / interval);
              maxWeight += Math.max(0, bonusSteps * bonusValue);
          }
          system.encumbrance.max = parseFloat((maxWeight || 20).toFixed(2));
      } else {
          system.encumbrance.max = 999;
      }

      const totalWeight = (actor?.items || []).reduce((total, item) => total + (parseFloat(item.system?.totalWeight) || 0), 0);
      system.encumbrance.value = parseFloat((totalWeight || 0).toFixed(2));
      system.encumbrance.pct = system.encumbrance.max > 0 ? Math.min(100, (system.encumbrance.value / system.encumbrance.max) * 100) : 0;

      let color = "#44ff44";
      if (system.encumbrance.value >= system.encumbrance.max) color = "#ff4444";
      else if (system.encumbrance.pct >= 75) color = "#ffa500";
      else if (system.encumbrance.pct >= 50) color = "#ffff44";
      system.encumbrance.color = color;

    } catch (err) {
      if (game.settings.get("neuroshima", "debugMode")) console.error("Neuroshima 1.5 | Error in prepareDerivedData:", err);
    }
  }
}

/**
 * Data model for NPC actors (named non-player characters).
 */
export class NeuroshimaNPCData extends NeuroshimaActorData {
  /** @override */
  static defineSchema() {
    const schema = super.defineSchema();
    const fields = foundry.data.fields;
    
    // Add threat field
    schema.threat = new fields.StringField({ initial: "" });
    
    return schema;
  }

  /** @override */
  prepareDerivedData() {
      try {
          this._prepareSharedData();
      } catch (err) {
          if (game.settings.get("neuroshima", "debugMode")) console.error("NPC prepareDerivedData error:", err);
      }
  }
}

/**
 * Data model for Creature actors (animals, mutants, monsters).
 * Creatures use the full attribute set but have natural armor instead of item armor,
 * and their HP capacity is fixed at 27 points (= 1 Critical wound).
 */
export class NeuroshimaCreatureData extends NeuroshimaActorData {
  /** @override */
  static defineSchema() {
    const parentSchema = super.defineSchema();
    const fields = foundry.data.fields;

    /** Per-body-part natural armor entry. */
    const naturalArmorPart = () => new fields.SchemaField({
      reduction:  new fields.NumberField({ initial: 0, min: 0, step: 0.5 }),
      hitPenalty: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      weakPoint:  new fields.BooleanField({ initial: false })
    });

    return {
      ...parentSchema,
      creatureType: new fields.StringField({ initial: "" }),
      terrain:      new fields.StringField({ initial: "" }),
      aggression:   new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      movement:     new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      isBerserker: new fields.BooleanField({ initial: false }),
      experience: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      kondycja:   new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      naturalArmor: new fields.SchemaField({
        head:     naturalArmorPart(),
        torso:    naturalArmorPart(),
        rightArm: naturalArmorPart(),
        leftArm:  naturalArmorPart(),
        rightLeg: naturalArmorPart(),
        leftLeg:  naturalArmorPart()
      }),
      lastRoll: new fields.SchemaField({
        modifier:        new fields.NumberField({ integer: true, initial: 0 }),
        baseDifficulty:  new fields.StringField({ initial: "average" }),
        useArmorPenalty: new fields.BooleanField({ initial: false }),
        useWoundPenalty: new fields.BooleanField({ initial: true }),
        isOpen:          new fields.BooleanField({ initial: true })
      }),
      lastWeaponRoll: new fields.SchemaField({
        percentageModifier: new fields.NumberField({ integer: true, initial: 0 }),
        difficulty:         new fields.StringField({ initial: "average" }),
        useArmorPenalty:    new fields.BooleanField({ initial: false }),
        useWoundPenalty:    new fields.BooleanField({ initial: true }),
        isOpen:             new fields.BooleanField({ initial: false })
      }),
      combat: new fields.SchemaField({
        meleeInitiative: new fields.NumberField({ integer: true, initial: 0 })
      }),
      notes: new fields.HTMLField({ initial: "" })
    };
  }

  /** @override */
  prepareDerivedData() {
    try {
      this._prepareSharedData();
      // Creatures have a fixed HP capacity of 27 (equivalent to 1 Critical wound).
      this.combat.maxHP = 27;
    } catch (err) {
      if (game.settings.get("neuroshima", "debugMode")) console.error("Creature prepareDerivedData error:", err);
    }
  }
}

/**
 * Data model for Vehicle actors (cars, trucks, bikes, etc.).
 */
export class NeuroshimaVehicleData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;

    const attrField = () => new fields.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 40 });
    const modField  = () => new fields.NumberField({ required: true, integer: true, initial: 0 });

    return {
      vehicleType: new fields.StringField({ initial: "" }),
      attributes: new fields.SchemaField({
        agility:      attrField(),
        topSpeed:     attrField(),
        acceleration: attrField(),
        brakes:       attrField(),
        durability:   attrField(),
        efficiency:   attrField()
      }),
      modifiers: new fields.SchemaField({
        agility:      modField(),
        topSpeed:     modField(),
        acceleration: modField(),
        brakes:       modField(),
        durability:   modField(),
        efficiency:   modField()
      }),
      crew: new fields.SchemaField({
        current: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max:     new fields.NumberField({ integer: true, initial: 2, min: 0 })
      }),
      passengers: new fields.SchemaField({
        current: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max:     new fields.NumberField({ integer: true, initial: 4, min: 0 })
      }),
      crewMembers: new fields.ArrayField(new fields.SchemaField({
        actorId:  new fields.StringField({ initial: "", required: true }),
        role:     new fields.StringField({ initial: "passenger" }),
        exposed:  new fields.BooleanField({ initial: false })
      }), { initial: [] }),
      movement: new fields.StringField({ initial: "wheeled" }),
      fuelType: new fields.StringField({ initial: "" }),
      fuel: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max:   new fields.NumberField({ integer: true, initial: 0, min: 0 })
      }),
      cost:  new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      notes: new fields.HTMLField({ initial: "" }),

      lastRoll: new fields.SchemaField({
        modifier:        modField(),
        baseDifficulty:  new fields.StringField({ initial: "average" }),
        isOpen:          new fields.BooleanField({ initial: false }),
        rollMode:        new fields.StringField({ initial: "roll" })
      }, { required: false }),
      /** Per-section vehicle armor plate */
      armor: new fields.SchemaField({
        front:     new fields.SchemaField({ reduction: new fields.NumberField({ initial: 0, min: 0, step: 0.5 }), hitPenalty: new fields.NumberField({ integer: true, initial: 0, min: 0 }), weakPoint: new fields.BooleanField({ initial: false }) }),
        rightSide: new fields.SchemaField({ reduction: new fields.NumberField({ initial: 0, min: 0, step: 0.5 }), hitPenalty: new fields.NumberField({ integer: true, initial: 0, min: 0 }), weakPoint: new fields.BooleanField({ initial: false }) }),
        leftSide:  new fields.SchemaField({ reduction: new fields.NumberField({ initial: 0, min: 0, step: 0.5 }), hitPenalty: new fields.NumberField({ integer: true, initial: 0, min: 0 }), weakPoint: new fields.BooleanField({ initial: false }) }),
        rear:      new fields.SchemaField({ reduction: new fields.NumberField({ initial: 0, min: 0, step: 0.5 }), hitPenalty: new fields.NumberField({ integer: true, initial: 0, min: 0 }), weakPoint: new fields.BooleanField({ initial: false }) }),
        bottom:    new fields.SchemaField({ reduction: new fields.NumberField({ initial: 0, min: 0, step: 0.5 }), hitPenalty: new fields.NumberField({ integer: true, initial: 0, min: 0 }), weakPoint: new fields.BooleanField({ initial: false }) })
      })
    };
  }
}
