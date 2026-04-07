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
      createItem:  async function(event, target) {
        const type = target.dataset.type || "weapon";
        const typeKey = type.charAt(0).toUpperCase() + type.slice(1);
        const name = game.i18n.localize(`NEUROSHIMA.Items.Type.${typeKey}`) || game.i18n.localize("NEUROSHIMA.NewItem");
        await this.document.createEmbeddedDocuments("Item", [{ name, type }]);
      },
      editItem:    async function(event, target) { const id = target.dataset.itemId || target.closest("[data-item-id]")?.dataset.itemId; this.document.items.get(id)?.sheet.render(true); },
      deleteItem:  async function(event, target) { const id = target.dataset.itemId || target.closest("[data-item-id]")?.dataset.itemId; await this.document.items.get(id)?.delete(); },
      editCrewMember: async function(event, target) {
        const actor = game.actors.get(target.dataset.actorId);
        if (actor) actor.sheet.render(true);
      },
      removeCrew: async function(event, target) {
        const actorId = target.dataset.actorId;
        const crewMembers = this.document.system.crewMembers.filter(m => m.actorId !== actorId);
        await this.document.update({ "system.crewMembers": crewMembers });
      },
      toggleCrewExposed: async function(event, target) {
        const actorId = target.dataset.actorId;
        const crewMembers = foundry.utils.deepClone(this.document.system.crewMembers.map(m => m.toObject?.() ?? m));
        const member = crewMembers.find(m => m.actorId === actorId);
        if (member) {
          member.exposed = !member.exposed;
          await this.document.update({ "system.crewMembers": crewMembers });
        }
      },
      setCrewRole: async function(event, target) {
        const actorId = target.dataset.actorId;
        const role = target.value;
        const crewMembers = foundry.utils.deepClone(this.document.system.crewMembers.map(m => m.toObject?.() ?? m));
        const member = crewMembers.find(m => m.actorId === actorId);
        if (member) {
          member.role = role;
          await this.document.update({ "system.crewMembers": crewMembers });
        }
      },
      toggleEquipped: async function(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (item) await item.update({ "system.equipped": !item.system.equipped });
      },
      configureHP: async function(event, target) {
          const { NeuroshimaActorSheet } = await import("./actor-sheet.js");
          return NeuroshimaActorSheet.prototype._onConfigureHP.call(this, event, target);
      },
      modifyDurability: async function(event, target) {
        const itemId  = target.dataset.itemId;
        const item    = this.document.items.get(itemId);
        if (!item || item.type !== "armor") return;
        const isRight   = event.type === "contextmenu";
        const current   = item.system.armor?.durabilityDamage || 0;
        const max       = item.system.armor?.durability || 0;
        const newDamage = Math.clamp(isRight ? current + 1 : current - 1, 0, max);
        if (newDamage !== current) await item.update({ "system.armor.durabilityDamage": newDamage });
      },
      modifyAP: async function(event, target) {
        const itemId   = target.dataset.itemId;
        const location = target.dataset.location;
        const item     = this.document.items.get(itemId);
        if (!item || item.type !== "armor" || !location) return;
        const isRight   = event.type === "contextmenu";
        const current   = item.system.armor?.damage?.[location] || 0;
        const max       = item.system.armor?.ratings?.[location] || 0;
        const newDamage = Math.clamp(isRight ? current + 1 : current - 1, 0, max);
        if (newDamage !== current) await item.update({ [`system.armor.damage.${location}`]: newDamage });
      },
      toggleHealing: async function(event, target) {
        const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
        if (item) await item.update({ "system.isHealing": !item.system.isHealing });
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
        { id: "equipment", group: "primary", label: "NEUROSHIMA.Tabs.Inventory" },
        { id: "notes",     group: "primary", label: "NEUROSHIMA.Tabs.Notes" }
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
    equipment: { template: "systems/neuroshima/templates/actors/vehicle/parts/vehicle-equipment.hbs", scrollable: [""] },
    notes:     { template: "systems/neuroshima/templates/actors/actor/parts/actor-notes.hbs" }
  };

  _getTabs() {
    const activeTab = this.tabGroups.primary;
    const tabs = foundry.utils.deepClone(this.constructor.TABS.primary.tabs).reduce((obj, t) => {
      obj[t.id] = t;
      return obj;
    }, {});
    for (const v of Object.values(tabs)) {
      v.active   = activeTab === v.id;
      v.cssClass = v.active ? "active" : "";
    }
    return tabs;
  }

  /** @override */
  async _prepareContext(options) {
    if (!this.tabGroups.primary) {
      this.tabGroups.primary = this.constructor.TABS.primary.initial;
    }

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

    context.vehicleAttributeList  = NEUROSHIMA.vehicleAttributes;
    context.vehicleMovementTypes  = NEUROSHIMA.vehicleMovementTypes;
    context.vehicleCrewPositions  = NEUROSHIMA.vehicleCrewPositions;

    context.crewMembers = (system.crewMembers ?? []).map((m) => {
      const raw     = m.toObject?.() ?? m;
      const crewActor = game.actors.get(raw.actorId);
      return {
        actorId: raw.actorId,
        role:    raw.role,
        exposed: raw.exposed,
        name:    crewActor?.name ?? game.i18n.localize("NEUROSHIMA.Unknown"),
        img:     crewActor?.img  ?? "icons/svg/mystery-man.svg",
        roleOptions: Object.entries(NEUROSHIMA.vehicleCrewPositions).map(([key, label]) => ({
          value:    key,
          label:    game.i18n.localize(label),
          selected: raw.role === key
        }))
      };
    });

    const items = actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.inventory = {
      weaponsMelee:   items.filter(i => i.type === "weapon" && i.system.weaponType === "melee"),
      weaponsRanged:  items.filter(i => i.type === "weapon" && i.system.weaponType === "ranged"),
      weaponsThrown:  items.filter(i => i.type === "weapon" && i.system.weaponType === "thrown"),
      armor:          items.filter(i => i.type === "armor"),
      gear:           items.filter(i => i.type === "gear"),
      magazines:      items.filter(i => i.type === "magazine")
    };

    const vehicleArmorKeys = NEUROSHIMA.vehicleArmorKeys;
    const vehicleLocationsConfig = NEUROSHIMA.vehicleLocations;

    context.vehicleArmorLocations = vehicleArmorKeys.map(key => ({
      key,
      label:      game.i18n.localize(vehicleLocationsConfig[key]),
      reduction:  system.armor?.[key]?.reduction  ?? 0,
      hitPenalty: system.armor?.[key]?.hitPenalty ?? 0,
      weakPoint:  system.armor?.[key]?.weakPoint  ?? false,
      items:      context.inventory.armor.filter(a => a.system.location === key && a.system.equipped)
    }));

    const damageItems = items.filter(i => i.type === "vehicle-damage");
    const totalDamagePoints = damageItems.reduce((sum, w) => sum + (w.system.penalty || 0), 0);
    const totalWoundPenalty = damageItems.reduce((sum, w) => sum + (w.system.penalty || 0), 0);
    const maxHP = actor.getFlag("neuroshima", "vehicleMaxHP") || 27;
    context.combat = {
      wounds:            damageItems,
      totalDamagePoints,
      totalWoundPenalty,
      maxHP
    };

    context.notes = {
      enriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.notes || "", {
        secrets: actor.isOwner,
        async: true,
        relativeTo: actor
      })
    };

    return context;
  }

  /** @override */
  async _onChangeForm(formConfig, event) {
    if (event.target.dataset.action === "setCrewRole") {
      const sel     = event.target;
      const actorId = sel.dataset.actorId;
      const role    = sel.value;
      const crewMembers = foundry.utils.deepClone(this.document.system.crewMembers.map(m => m.toObject?.() ?? m));
      const member = crewMembers.find(m => m.actorId === actorId);
      if (member) {
        member.role = role;
        await this.document.update({ "system.crewMembers": crewMembers });
      }
      return;
    }
    return super._onChangeForm(formConfig, event);
  }

  /** @override */
  async _onDropItem(event, data) {
    const item = await fromUuid(data.uuid);
    if (!item) return;
    if (["weapon", "gear", "armor", "magazine", "ammo", "vehicle-damage"].includes(item.type)) {
      return super._onDropItem(event, data);
    }
  }

  /** @override */
  async _onDropActor(event, data) {
    const dropped = await fromUuid(data.uuid);
    if (!dropped) return;
    const existing = this.document.system.crewMembers ?? [];
    if (existing.some(m => (m.toObject?.() ?? m).actorId === dropped.id)) return;
    const crewMembers = existing.map(m => m.toObject?.() ?? m);
    crewMembers.push({ actorId: dropped.id, role: "passenger", exposed: false });
    await this.document.update({ "system.crewMembers": crewMembers });
  }
}
