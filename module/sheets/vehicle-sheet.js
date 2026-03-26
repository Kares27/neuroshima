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
    position: { width: 620, height: 520 },
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
      }
    },
    dragDrop: [{ dragSelector: ".item[data-item-id]", dropSelector: "form" }]
  };

  /** @override */
  static PARTS = {
    main: { template: "systems/neuroshima/templates/actor/vehicle-sheet.hbs" }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor   = this.document;
    const system  = actor.system;

    context.actor    = actor;
    context.system   = system;
    context.config   = NEUROSHIMA;
    context.owner    = actor.isOwner;
    context.editable = this.isEditable;

    const items = actor.items.contents;
    context.weapons = items.filter(i => i.type === "weapon");
    context.gear    = items.filter(i => i.type === "gear");
    context.wounds  = items.filter(i => i.type === "wound");

    const hullPct = system.hull?.max > 0 ? Math.round((system.hull.value / system.hull.max) * 100) : 100;
    context.hullPct       = hullPct;
    context.hullCondition = hullPct >= 75 ? "good" : hullPct >= 40 ? "damaged" : "critical";

    const fuelPct = system.fuel?.max > 0 ? Math.round((system.fuel.value / system.fuel.max) * 100) : 100;
    context.fuelPct = fuelPct;

    return context;
  }

  /** @override */
  async _onDropItem(event, data) {
    const item = await fromUuid(data.uuid);
    if (!item) return;
    if (["weapon", "gear", "wound"].includes(item.type)) {
      return super._onDropItem(event, data);
    }
  }
}
