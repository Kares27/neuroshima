/**
 * Definiuje ścieżki szablonów do wczytania podczas inicjalizacji systemu
 * @return {Promise}
 */
export const preloadHandlebarsTemplates = async function() {
  return loadTemplates([
    // Actor partials
    "systems/neuroshima/templates/actor/parts/actor-attributes.hbs",
    "systems/neuroshima/templates/actor/parts/actor-npc-attributes.hbs",
    "systems/neuroshima/templates/actor/parts/actor-skills.hbs", 
    "systems/neuroshima/templates/actor/parts/actor-combat.hbs",
    "systems/neuroshima/templates/actor/parts/actor-tricks.hbs",
    "systems/neuroshima/templates/actor/parts/actor-equipment.hbs",
    "systems/neuroshima/templates/actor/parts/actor-notes.hbs",
    
    // Beast actor partials
    "systems/neuroshima/templates/actor/parts/beast-attributes.hbs",
    "systems/neuroshima/templates/actor/parts/beast-combat.hbs",
    "systems/neuroshima/templates/actor/parts/beast-notes.hbs",
    
    // Item sheets
    "systems/neuroshima/templates/item/item-weapon-melee-sheet.hbs",
    "systems/neuroshima/templates/item/item-weapon-ranged-sheet.hbs",
    "systems/neuroshima/templates/item/item-weapon-thrown-sheet.hbs",
    "systems/neuroshima/templates/item/item-ammunition-sheet.hbs",
    "systems/neuroshima/templates/item/item-armor-sheet.hbs",
    "systems/neuroshima/templates/item/item-equipment-sheet.hbs",
    "systems/neuroshima/templates/item/item-beast-action-sheet.hbs",
    
    // Item partials
    "systems/neuroshima/templates/item/parts/item-effects.hbs",
    
    // Dialog templates
    "systems/neuroshima/templates/dialog/wound-creation-dialog.hbs",
    "systems/neuroshima/templates/dialog/weapon-type-dialog.hbs",
    
    // Chat templates
    "systems/neuroshima/templates/chat/damage-application.hbs",
    "systems/neuroshima/templates/chat/attack-roll.hbs",
    "systems/neuroshima/templates/chat/damage-application-section.hbs"
  ]);
};