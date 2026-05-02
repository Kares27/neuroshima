import { NeuroshimaActorSheet } from "./actor-sheet.js";

/**
 * Actor sheet for NPC actors. Extends the character sheet but removes the
 * encumbrance tab and adds a "Threat" header field.
 */
export class NeuroshimaNPCSheet extends NeuroshimaActorSheet {
  /** @override */
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    foundry.utils.deepClone(NeuroshimaActorSheet.DEFAULT_OPTIONS),
    {
      window: { title: "NEUROSHIMA.Sheet.ActorNPC" },
      classes: ["neuroshima", "sheet", "actor", "actor-npc"]
    }
  );

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "attributes", group: "primary", label: "NEUROSHIMA.Tabs.Attributes" },
        { id: "tricks",     group: "primary", label: "NEUROSHIMA.Tabs.Tricks" },
        { id: "combat",     group: "primary", label: "NEUROSHIMA.Tabs.Combat" },
        { id: "inventory",  group: "primary", label: "NEUROSHIMA.Tabs.Inventory" },
        { id: "effects",    group: "primary", label: "NEUROSHIMA.Tabs.Effects" },
        { id: "notes",      group: "primary", label: "NEUROSHIMA.Tabs.Notes" }
      ],
      initial: "attributes"
    }
  };

  /** @override */
  static PARTS = {
    header:           { template: "systems/neuroshima/templates/actors/npc/parts/npc-header.hbs" },
    tabs:             { template: "templates/generic/tab-navigation.hbs" },
    attributes:       { template: "systems/neuroshima/templates/actors/actor/parts/actor-attributes.hbs", scrollable: [""] },
    skills:           { template: "systems/neuroshima/templates/actors/actor/parts/actor-skills.hbs", scrollable: [".skill-table"] },
    tricks:           { template: "systems/neuroshima/templates/actors/actor/parts/actor-tricks.hbs" },
    combat:           { template: "systems/neuroshima/templates/actors/actor/parts/actor-combat.hbs", scrollable: [""] },
    combatPaperDoll:  { template: "systems/neuroshima/templates/actors/actor/parts/wounds-paper-doll-partial.hbs", scrollable: [".paper-doll-scrollable"] },
    combatWoundsList: { template: "systems/neuroshima/templates/actors/actor/parts/wounds-list-partial.hbs", scrollable: [".wounds-list-container"] },
    inventory:        { template: "systems/neuroshima/templates/actors/actor/parts/actor-inventory.hbs", scrollable: [""] },
    effects:          { template: "systems/neuroshima/templates/actors/parts/actor-effects.hbs", scrollable: [""] },
    notes:            { template: "systems/neuroshima/templates/actors/actor/parts/actor-notes.hbs", scrollable: [""] }
  };
}
