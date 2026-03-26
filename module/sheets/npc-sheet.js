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
        { id: "notes",      group: "primary", label: "NEUROSHIMA.Tabs.Notes" }
      ],
      initial: "attributes"
    }
  };

  /** @override */
  static PARTS = {
    header:           { template: "systems/neuroshima/templates/actor/npc-header.hbs" },
    tabs:             { template: "templates/generic/tab-navigation.hbs" },
    attributes:       { template: "systems/neuroshima/templates/actor/parts/actor-attributes.hbs" },
    skills:           { template: "systems/neuroshima/templates/actor/parts/actor-skills.hbs", scrollable: [".skill-table"] },
    tricks:           { template: "systems/neuroshima/templates/actor/parts/actor-tricks.hbs" },
    combat:           { template: "systems/neuroshima/templates/actor/parts/actor-combat.hbs" },
    combatPaperDoll:  { template: "systems/neuroshima/templates/actor/parts/wounds-paper-doll-partial.hbs" },
    combatWoundsList: { template: "systems/neuroshima/templates/actor/parts/wounds-list-partial.hbs" },
    inventory:        { template: "systems/neuroshima/templates/actor/parts/actor-inventory.hbs", scrollable: [""] },
    notes:            { template: "systems/neuroshima/templates/actor/parts/actor-notes.hbs" }
  };
}
