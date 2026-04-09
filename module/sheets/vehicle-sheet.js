import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/dice.js";
import { NeuroshimaWeaponRollDialog } from "../apps/weapon-roll-dialog.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class NeuroshimaVehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "actor", "vehicle"],
    position: {
      width: 720,
      height: 780
    },
    window: {
      title: "NEUROSHIMA.Sheet.Vehicle",
      resizable: true
    },
    renderConfig: {
      scrollable: [".vehicle-mods-list", ".vehicle-crew-list"]
    },
    form: {
      submitOnChange: true,
      submitOnClose: true,
      submitOnUnfocus: true
    },
    forms: {
      standard: {
        elements: {
          "system.notes": {
            editor: {
              engine: "prosemirror",
              collaborative: false
            }
          }
        }
      }
    },
    actions: {
      editImage: this.prototype._onEditImage,
      rollDurability: this.prototype._onRollDurability,
      createItem: this.prototype._onCreateItem,
      editItem: this.prototype._onEditItem,
      deleteItem: this.prototype._onDeleteItem,
      toggleEquipped: this.prototype._onToggleEquipped,
      toggleDamageActive: this.prototype._onToggleDamageActive,
      rollWeapon: this.prototype._onRollWeapon
    },
    dragDrop: [{ dragSelector: ".item[data-item-id]", dropSelector: "form" }]
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "stats", group: "primary", label: "NEUROSHIMA.Tabs.Stats" },
        { id: "crew", group: "primary", label: "NEUROSHIMA.Tabs.Crew" },
        { id: "mods", group: "primary", label: "NEUROSHIMA.Tabs.Mods" },
        { id: "combat", group: "primary", label: "NEUROSHIMA.Tabs.Combat" },
        { id: "notes", group: "primary", label: "NEUROSHIMA.Tabs.Notes" }
      ],
      initial: "stats"
    }
  };

  static PARTS = {
    header: { template: "systems/neuroshima/templates/actor/vehicle/parts/vehicle-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    stats: { template: "systems/neuroshima/templates/actor/vehicle/parts/vehicle-stats.hbs" },
    crew: { template: "systems/neuroshima/templates/actor/vehicle/parts/vehicle-crew.hbs" },
    mods: { template: "systems/neuroshima/templates/actor/vehicle/parts/vehicle-mods.hbs", scrollable: [".vehicle-mods-list"] },
    combat: { template: "systems/neuroshima/templates/actor/vehicle/parts/vehicle-combat.hbs", scrollable: [".vehicle-combat-scroll"] },
    notes: { template: "systems/neuroshima/templates/actor/vehicle/parts/vehicle-notes.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;

    context.actor = actor;
    context.system = system;
    context.source = system.toObject();
    context.tabs = this._getTabs();
    context.config = NEUROSHIMA;
    context.owner = actor.isOwner;
    context.editable = this.isEditable;

    context.difficulties = Object.entries(NEUROSHIMA.difficulties).reduce((obj, [key, val]) => {
      obj[key] = val.label;
      return obj;
    }, {});

    context.vehicleLocations = {
      front: "NEUROSHIMA.Vehicle.Location.Front",
      back: "NEUROSHIMA.Vehicle.Location.Back",
      leftSide: "NEUROSHIMA.Vehicle.Location.LeftSide",
      rightSide: "NEUROSHIMA.Vehicle.Location.RightSide",
      bottom: "NEUROSHIMA.Vehicle.Location.Bottom"
    };

    const items = Array.from(actor.items);

    context.vehicleMods = items.filter(i => i.type === "vehicle-mod").sort((a, b) => {
      if (a.system.category !== b.system.category) return a.system.category === "armor" ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    context.armorMods = context.vehicleMods.filter(i => i.system.category === "armor");
    context.modificationMods = context.vehicleMods.filter(i => i.system.category === "modification");

    context.weapons = items.filter(i => i.type === "weapon" && i.system.weaponType === "ranged").map(w => ({
      ...w,
      id: w.id,
      img: w.img,
      name: w.name,
      system: w.system,
      uuid: w.uuid,
      equipped: w.system.equipped
    }));

    context.vehicleDamages = items.filter(i => i.type === "vehicle-damage");

    const computedArmor = system.computedArmor || {};
    context.armorGrid = ["front", "back", "leftSide", "rightSide", "bottom"].map(loc => ({
      key: loc,
      label: `NEUROSHIMA.Vehicle.Location.${loc.charAt(0).toUpperCase() + loc.slice(1)}`,
      armor: computedArmor[loc] || 0,
      weakPoint: system.weakPoints?.[loc] || false,
      hasArmor: (computedArmor[loc] || 0) > 0
    }));

    context.totalAgilityPenalty = system.totalAgilityPenalty || 0;
    context.effectiveAgility = system.effectiveAgility ?? system.agility;
    context.remainingEfficiency = system.remainingEfficiency ?? system.efficiency?.max;
    context.isDisabled = system.isDisabled || false;

    context.modCategories = {
      modification: "NEUROSHIMA.Vehicle.Mod.Category.Modification",
      armor: "NEUROSHIMA.Vehicle.Mod.Category.Armor"
    };

    context.vehicleDamageTypes = {
      L: "NEUROSHIMA.Vehicle.Damage.Light",
      C: "NEUROSHIMA.Vehicle.Damage.Heavy",
      K: "NEUROSHIMA.Vehicle.Damage.Critical"
    };

    context.enrichedNotes = await foundry.applications.ux.TextEditor.enrichHTML(system.notes || "", {
      async: true,
      secrets: actor.isOwner,
      rollData: actor.getRollData?.() || {},
      relativeTo: actor
    });

    game.neuroshima?.log(`Vehicle Sheet Context prepared for ${actor.name}`, context);
    return context;
  }

  _getTabs() {
    const activeTab = this.tabGroups?.primary || "stats";
    const tabs = {};
    for (const tabData of this.constructor.TABS.primary.tabs) {
      tabs[tabData.id] = {
        ...tabData,
        active: activeTab === tabData.id,
        cssClass: activeTab === tabData.id ? "active" : ""
      };
    }
    return tabs;
  }

  async _onEditImage(event, target) {
    return new FilePicker({
      type: "image",
      current: this.actor.img,
      callback: async path => await this.actor.update({ img: path })
    }).browse();
  }

  async _onRollDurability(event, target) {
    const actor = this.actor;
    const durability = actor.system.durability || 0;
    const lastRoll = actor.system.lastRoll || {};
    const modifier = lastRoll.modifier || 0;
    const isOpen = lastRoll.isOpen ?? true;

    await NeuroshimaDice.rollTest({
      actor,
      label: game.i18n.localize("NEUROSHIMA.Vehicle.RollDurability"),
      stat: durability,
      skill: 0,
      penalties: { mod: modifier, wounds: 0, armor: 0 },
      isOpen,
      isCombat: false
    });
  }

  async _onCreateItem(event, target) {
    const type = target.dataset.type;
    if (!type) return;
    const typeKey = type.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("");
    const name = game.i18n.localize(`NEUROSHIMA.Items.Type.${typeKey}`);
    await this.actor.createEmbeddedDocuments("Item", [{ name, type }]);
  }

  async _onEditItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    item?.sheet?.render(true);
  }

  async _onDeleteItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DOCUMENT.Delete") },
      content: `<p>${game.i18n.format("DOCUMENT.DeleteWarning", { name: item.name })}</p>`,
      yes: { callback: async () => item.delete() }
    });
  }

  async _onToggleEquipped(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    await item.update({ "system.equipped": !item.system.equipped });
  }

  async _onToggleDamageActive(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    await item.update({ "system.isActive": !item.system.isActive });
  }

  async _onRollWeapon(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const weapon = this.actor.items.get(itemId);
    if (!weapon) return;

    const dialog = new NeuroshimaWeaponRollDialog({ weapon, actor: this.actor });
    dialog.render(true);
  }

  async _onDropItem(event) {
    const data = foundry.applications.ux.TextEditor.getDragEventData(event);
    if (data.type !== "Item") return;

    const item = await Item.fromDropData(data);
    if (!item) return;

    const allowedTypes = ["weapon", "vehicle-mod", "vehicle-damage", "gear"];
    if (!allowedTypes.includes(item.type)) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Vehicle.InvalidItemType"));
      return;
    }

    if (item.type === "weapon" && item.system.weaponType !== "ranged") {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Vehicle.OnlyRangedWeapons"));
      return;
    }

    return super._onDropItem(event);
  }
}
