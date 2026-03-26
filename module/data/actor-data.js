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
      specialization: new fields.StringField({ initial: "" }), // This is general character specialization/focus
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

  /** @override */
  prepareDerivedData() {
    // 1. Zabezpieczenie: prepareData może uruchomić się przed pełną inicjalizacją ustawień
    if (!game.settings || !game.settings.settings?.has("neuroshima.enableEncumbrance")) return;

    const system = this;
    const actor = this.parent;
    const difficulties = NEUROSHIMA.difficulties;

    try {
      // 2. Pobieranie ustawień z bezpiecznymi fallbackami 
      const enableEncumbrance = game.settings.get("neuroshima", "enableEncumbrance") ?? true;
      const baseEnc = game.settings.get("neuroshima", "baseEncumbrance") ?? 20;
      const useConBonus = game.settings.get("neuroshima", "useConstitutionBonus") ?? true;
      const threshold = game.settings.get("neuroshima", "encumbranceThreshold") ?? 10;
      const interval = game.settings.get("neuroshima", "encumbranceBonusInterval") ?? 2;
      const bonusValue = game.settings.get("neuroshima", "encumbranceBonusValue") ?? 5;

      // 3. Obliczanie udźwigu
      system.encumbrance.enabled = enableEncumbrance;
      if (enableEncumbrance) {
          // UWAGA: W v13 NumberField zwraca bezpośrednio liczbę, nie używamy .value
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

      // 4. Sumowanie wagi - bezpieczna iteracja po przedmiotach 
      const items = actor?.items ? Array.from(actor.items) : [];
      const totalWeight = items.reduce((total, item) => {
        return total + (parseFloat(item.system?.totalWeight) || 0);
      }, 0);

      system.encumbrance.value = parseFloat((totalWeight || 0).toFixed(2));
      system.encumbrance.pct = system.encumbrance.max > 0 ? Math.min(100, (system.encumbrance.value / system.encumbrance.max) * 100) : 0;

      // Determine color based on load
      let color = "#44ff44"; // Green (< 50%)
      if (system.encumbrance.value >= system.encumbrance.max) color = "#ff4444"; // Red (>= 100%)
      else if (system.encumbrance.pct >= 75) color = "#ffa500"; // Orange (>= 75%)
      else if (system.encumbrance.pct >= 50) color = "#ffff44"; // Yellow (>= 50%)
      system.encumbrance.color = color;

      // 5. Atrybuty całkowite i Progi - bezpieczna iteracja po kluczach atrybutów
      this.attributeTotals = {};
      this.thresholds = {};
      for (let key of Object.keys(NEUROSHIMA.attributes)) {
        const attrValue = Number(this.attributes[key]) || 0;
        const modValue = Number(this.modifiers[key]) || 0;
        const totalValue = attrValue + modValue;
        
        this.attributeTotals[key] = totalValue;
        this.thresholds[key] = {};
        for (let [diffKey, diffValue] of Object.entries(NEUROSHIMA.difficulties)) {
          this.thresholds[key][diffKey] = totalValue + (diffValue.mod || 0);
        }
      }

      // 6. Statystyki bojowe (kary) - merge derived data into the combat object
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

      // Safely merge properties into the existing combat object to preserve meleeInitiative
      for (let [key, value] of Object.entries(combatUpdates)) {
        this.combat[key] = value;
      }
    } catch (err) {
      if (game.settings.get("neuroshima", "debugMode")) {
        console.error("Neuroshima 1.5 | Błąd krytyczny w prepareDerivedData:", err);
      }
    }
  }
}

/**
 * Data model for NPC actors (named non-player characters).
 * Shares the same structure as a player character but without encumbrance tracking.
 */
export class NeuroshimaNPCData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;

    const attributeField = () => new fields.NumberField({ required: true, integer: true, initial: 6, min: 0, max: 40 });
    const modifierField  = () => new fields.NumberField({ required: true, integer: true, initial: 0 });
    const skillField     = () => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 20 }),
      label: new fields.StringField({ initial: "" })
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
      origin:         new fields.StringField({ initial: "" }),
      profession:     new fields.StringField({ initial: "" }),
      threat:         new fields.StringField({ initial: "" }),
      attributes: new fields.SchemaField({
        dexterity:    attributeField(),
        perception:   attributeField(),
        charisma:     attributeField(),
        cleverness:   attributeField(),
        constitution: attributeField()
      }),
      modifiers: new fields.SchemaField({
        dexterity:    modifierField(),
        perception:   modifierField(),
        charisma:     modifierField(),
        cleverness:   modifierField(),
        constitution: modifierField()
      }),
      skills:         new fields.SchemaField(skillMap),
      specializations: new fields.SchemaField(specializationMap),
      lastRoll: new fields.SchemaField({
        modifier:        new fields.NumberField({ integer: true, initial: 0 }),
        baseDifficulty:  new fields.StringField({ initial: "average" }),
        useArmorPenalty: new fields.BooleanField({ initial: true }),
        useWoundPenalty: new fields.BooleanField({ initial: true }),
        isOpen:          new fields.BooleanField({ initial: true })
      }),
      lastWeaponRoll: new fields.SchemaField({
        percentageModifier: new fields.NumberField({ integer: true, initial: 0 }),
        difficulty:         new fields.StringField({ initial: "average" }),
        useArmorPenalty:    new fields.BooleanField({ initial: true }),
        useWoundPenalty:    new fields.BooleanField({ initial: true }),
        isOpen:             new fields.BooleanField({ initial: false })
      }),
      notes: new fields.HTMLField({ initial: "" }),
      hp: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max:   new fields.NumberField({ integer: true, initial: 27, min: 1 })
      }),
      combat: new fields.SchemaField({
        meleeInitiative: new fields.NumberField({ integer: true, initial: 0 })
      }),
      healingRate: new fields.NumberField({ integer: true, initial: 5, min: 1, max: 100 })
    };
  }

  /** @override */
  prepareDerivedData() {
    if (!game.settings || !game.settings.settings?.has("neuroshima.enableEncumbrance")) return;

    const system = this;
    const actor  = this.parent;

    try {
      this.attributeTotals = {};
      this.thresholds      = {};
      for (const key of Object.keys(NEUROSHIMA.attributes)) {
        const total = (Number(system.attributes[key]) || 0) + (Number(system.modifiers[key]) || 0);
        this.attributeTotals[key] = total;
        this.thresholds[key] = {};
        for (const [diffKey, diffValue] of Object.entries(NEUROSHIMA.difficulties)) {
          this.thresholds[key][diffKey] = total + (diffValue.mod || 0);
        }
      }

      const items = actor?.items ? Array.from(actor.items) : [];
      const combatUpdates = {
        totalArmorPenalty: items.reduce((t, i) => i.type === "armor" && i.system.equipped ? t + (i.system.armor?.penalty || 0) : t, 0),
        totalWoundPenalty: items.reduce((t, i) => i.type === "wound" && i.system.isActive  ? t + (i.system.penalty || 0) : t, 0),
        totalDamagePoints: items.reduce((t, i) => {
          if (i.type === "wound" && i.system.isActive) {
            return t + (NEUROSHIMA.woundConfiguration[i.system.damageType]?.damageHealth || 0);
          }
          return t;
        }, 0)
      };
      for (const [key, value] of Object.entries(combatUpdates)) {
        this.combat[key] = value;
      }
    } catch (err) {
      if (game.settings.get("neuroshima", "debugMode")) console.error("NPC prepareDerivedData error:", err);
    }
  }
}

/**
 * Data model for Creature actors (animals, mutants, monsters).
 */
export class NeuroshimaCreatureData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    const attrField = () => new fields.NumberField({ required: true, integer: true, initial: 6, min: 0, max: 40 });
    const modField  = () => new fields.NumberField({ required: true, integer: true, initial: 0 });

    return {
      creatureType:  new fields.StringField({ initial: "" }),
      instinct:      new fields.StringField({ initial: "" }),
      naturalAttack: new fields.StringField({ initial: "" }),
      attributes: new fields.SchemaField({
        dexterity:    attrField(),
        perception:   attrField(),
        constitution: attrField()
      }),
      modifiers: new fields.SchemaField({
        dexterity:    modField(),
        perception:   modField(),
        constitution: modField()
      }),
      lastWeaponRoll: new fields.SchemaField({
        percentageModifier: new fields.NumberField({ integer: true, initial: 0 }),
        difficulty:         new fields.StringField({ initial: "average" }),
        useArmorPenalty:    new fields.BooleanField({ initial: true }),
        useWoundPenalty:    new fields.BooleanField({ initial: true }),
        isOpen:             new fields.BooleanField({ initial: false })
      }),
      hp: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max:   new fields.NumberField({ integer: true, initial: 10, min: 1 })
      }),
      combat: new fields.SchemaField({
        meleeInitiative: new fields.NumberField({ integer: true, initial: 0 })
      }),
      notes: new fields.HTMLField({ initial: "" })
    };
  }

  /** @override */
  prepareDerivedData() {
    if (!game.settings || !game.settings.settings?.has("neuroshima.enableEncumbrance")) return;

    const system = this;
    const actor  = this.parent;

    try {
      const creatureAttrs = { dexterity: true, perception: true, constitution: true };
      this.attributeTotals = {};
      this.thresholds = {};
      for (const key of Object.keys(creatureAttrs)) {
        const total = (Number(system.attributes[key]) || 0) + (Number(system.modifiers[key]) || 0);
        this.attributeTotals[key] = total;
        this.thresholds[key] = {};
        for (const [diffKey, diffValue] of Object.entries(NEUROSHIMA.difficulties)) {
          this.thresholds[key][diffKey] = total + (diffValue.mod || 0);
        }
      }

      const items = actor?.items ? Array.from(actor.items) : [];
      const combatUpdates = {
        totalArmorPenalty: items.reduce((t, i) => i.type === "armor" && i.system.equipped ? t + (i.system.armor?.penalty || 0) : t, 0),
        totalWoundPenalty: items.reduce((t, i) => i.type === "wound" && i.system.isActive  ? t + (i.system.penalty || 0) : t, 0),
        totalDamagePoints: items.reduce((t, i) => {
          if (i.type === "wound" && i.system.isActive) {
            return t + (NEUROSHIMA.woundConfiguration[i.system.damageType]?.damageHealth || 0);
          }
          return t;
        }, 0)
      };
      for (const [key, value] of Object.entries(combatUpdates)) {
        this.combat[key] = value;
      }
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

    return {
      vehicleType:  new fields.StringField({ initial: "" }),
      speed: new fields.SchemaField({
        max:     new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        current: new fields.NumberField({ integer: true, initial: 0, min: 0 })
      }),
      hull: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, initial: 10, min: 0 }),
        max:   new fields.NumberField({ integer: true, initial: 10, min: 1 })
      }),
      armor:      new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      crew: new fields.SchemaField({
        current: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max:     new fields.NumberField({ integer: true, initial: 2, min: 0 })
      }),
      passengers: new fields.SchemaField({
        current: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max:     new fields.NumberField({ integer: true, initial: 4, min: 0 })
      }),
      fuel: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, initial: 50, min: 0 }),
        max:   new fields.NumberField({ integer: true, initial: 50, min: 1 })
      }),
      condition: new fields.StringField({ initial: "good" }),
      notes:     new fields.HTMLField({ initial: "" })
    };
  }
}
