import { NEUROSHIMA } from "../config.js";
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Actor sheet for Vehicle actors (cars, bikes, trucks, etc.).
 */
export class NeuroshimaVehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "actor", "actor-vehicle"],
    position: { width: 650, height: 680 },
    window: { title: "NEUROSHIMA.Sheet.ActorVehicle", resizable: true },
    form: { submitOnChange: true, submitOnClose: true, submitOnUnfocus: true },
    actions: {
      editImage: async function(event, target) {
        const fp = new FilePicker({ type: "image", callback: src => this.document.update({ img: src }) });
        fp.browse(this.document.img);
      },
      rollWeapon: async function(event, target) {
        const itemId = target.dataset.itemId;
        const item   = this.document.items.get(itemId);
        if (!item) return;
        const { NeuroshimaWeaponRollDialog } = await import("../apps/weapon-roll-dialog.js");
        const dialog = new NeuroshimaWeaponRollDialog({ actor: this.document, weapon: item, rollType: item.system.weaponType });
        dialog.render(true);
      },
      createItem:  async function(event, target) { await this.document.createEmbeddedDocuments("Item", [{ name: game.i18n.localize("NEUROSHIMA.NewItem"), type: target.dataset.type || "weapon" }]); },
      editItem:    async function(event, target) { this.document.items.get(target.dataset.itemId)?.sheet.render(true); },
      deleteItem:  async function(event, target) { await this.document.items.get(target.dataset.itemId)?.delete(); },
      toggleEquipped: async function(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (item) await item.update({ "system.equipped": !item.system.equipped });
      },
      configureHP: async function(event, target) {
          const { NeuroshimaActorSheet } = await import("./actor-sheet.js");
          return NeuroshimaActorSheet.prototype._onConfigureHP.call(this, event, target);
      }
    },
    dragDrop: [{ dragSelector: ".item[data-item-id]", dropSelector: "form" }]
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "crew",      group: "primary", label: "NEUROSHIMA.Tabs.Crew" },
        { id: "combat",    group: "primary", label: "NEUROSHIMA.Tabs.Combat" },
        { id: "equipment", group: "primary", label: "NEUROSHIMA.Tabs.Inventory" }
      ],
      initial: "crew"
    }
  };

  /** @override */
  static PARTS = {
    header:    { template: "systems/neuroshima/templates/actors/vehicle/parts/vehicle-header.hbs" },
    tabs:      { template: "templates/generic/tab-navigation.hbs" },
    crew:      { template: "systems/neuroshima/templates/actors/vehicle/parts/vehicle-crew.hbs", scrollable: [""] },
    combat:    { template: "systems/neuroshima/templates/actors/vehicle/parts/vehicle-combat.hbs", scrollable: [""] },
    equipment: { template: "systems/neuroshima/templates/actors/vehicle/parts/vehicle-equipment.hbs", scrollable: [""] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor   = this.document;
    const system  = actor.system;

    context.actor    = actor;
    context.system   = system;
    context.config   = NEUROSHIMA;
    context.tabs     = this._getTabs();
    context.owner    = actor.isOwner;
    context.editable = this.isEditable;
    context.isGM     = game.user.isGM;

    context.vehicleAttributeList = NEUROSHIMA.vehicleAttributes;

    const items = actor.items.contents;
    context.weapons = items.filter(i => i.type === "weapon");
    context.gear    = items.filter(i => i.type === "gear");

    return context;
  }

  /** @override */
  async _onDropItem(event, data) {
    const item = await fromUuid(data.uuid);
    if (!item) return;
    if (["weapon", "gear"].includes(item.type)) {
      return super._onDropItem(event, data);
    }
  }
}
