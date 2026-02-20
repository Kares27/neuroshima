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

      // 5. Progi atrybutów - bezpieczna iteracja po kluczach atrybutów
      this.thresholds = {};
      for (let key of Object.keys(NEUROSHIMA.attributes)) {
        const attrValue = Number(this.attributes[key]) || 0;
        const modValue = Number(this.modifiers[key]) || 0;
        const baseValue = attrValue + modValue;
        
        this.thresholds[key] = {};
        for (let [diffKey, diffValue] of Object.entries(NEUROSHIMA.difficulties)) {
          this.thresholds[key][diffKey] = baseValue + (diffValue.mod || 0);
        }
      }

      // 6. Statystyki bojowe (kary)
      this.combat = {
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
    } catch (err) {
      if (game.settings.get("neuroshima", "debugMode")) {
        console.error("Neuroshima 1.5 | Błąd krytyczny w prepareDerivedData:", err);
      }
    }
  }
}
