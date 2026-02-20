import { NEUROSHIMA } from "../config.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Basic item sheet for Neuroshima 1.5 using ApplicationV2.
 */
export class NeuroshimaItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "item"],
    window: {
      resizable: true,
    },
    position: {
      width: 500,
      height: 450
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
      submitOnUnfocus: true,
    },
    renderConfig: {
      scrollable: [".sheet-body", ".contents-list-items", ".magazine-contents-section"]
    },
    actions: {
      editImage: this.prototype._onEditImage
    },
    dragDrop: [{ dragSelector: ".item", dropSelector: "form" }],
    forms: {
      standard: {
        elements: {
          "system.description": {
            editor: {
              engine: "prosemirror",
              collaborative: false
            }
          }
        }
      }
    }
  };

  /** @override */
  async _onDrop(event) {
    game.neuroshima.log("_onDrop triggered on Item Sheet");
    return super._onDrop(event);
  }

  /** @override */
  async _onDropItem(event, data) {
    const item = this.document;
    if (item.type !== "magazine") return super._onDropItem(event, data);

    const sourceItem = await NeuroshimaItem.fromDropData(data);
    if (sourceItem?.type === "ammo") {
        const actorSheet = item.actor?.sheet;
        if (actorSheet) {
            return actorSheet._onLoadAmmoIntoMagazine(sourceItem, item);
        }
    }
    return super._onDropItem(event, data);
  }

  /** @inheritdoc */
  constructor(options={}) {
    super(options);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    context.item = item;
    context.system = item.system;
    context.fields = item.system.schema.fields;
    context.source = item.system.toObject();
    context.tabs = this._getTabs();
    context.enableEncumbrance = game.settings.get("neuroshima", "enableEncumbrance");
    context.usePelletCountLimit = game.settings.get("neuroshima", "usePelletCountLimit");
    context.config = NEUROSHIMA;

    // Prepare visual ammo stacks for magazine (reversed for LIFO visualization)
    if (item.type === "magazine") {
      context.displayContents = [...(item.system.contents || [])].reverse().map(stack => {
        const mods = [];
        if (stack.overrides?.enabled) {
          if (stack.overrides.damage) mods.push(`${game.i18n.localize("NEUROSHIMA.Items.Fields.Damage")}: ${stack.overrides.damage}`);
          if (stack.overrides.piercing !== null) mods.push(`PP: ${stack.overrides.piercing}`);
          if (stack.overrides.jamming !== null) mods.push(`Zac: ${stack.overrides.jamming}`);
        }
        stack.tooltip = mods.length ? mods.join("\n") : "";
        return stack;
      });
    }

    // Map owner and editable for templates
    context.owner = item.isOwner;
    context.editable = this.isEditable;

    // Prepare type label
    let typeLabelKey = item.type.charAt(0).toUpperCase() + item.type.slice(1);
    if (item.type === "weapon" && item.system.weaponType) {
      typeLabelKey += item.system.weaponType.charAt(0).toUpperCase() + item.system.weaponType.slice(1);
    }
    context.typeLabel = `NEUROSHIMA.Items.Type.${typeLabelKey}`;

    // Common options
    context.attributes = NEUROSHIMA.attributes;
    context.damageTypes = NEUROSHIMA.damageTypes;
    context.weaponSubtypes = NEUROSHIMA.weaponSubtypes;
    context.locations = NEUROSHIMA.locations;
    
    // Collect all unique calibers from world items (Weapons) for suggestions
    const worldCalibers = new Set();
    game.items.forEach(i => {
        if (i.type === "weapon" && i.system.caliber) {
            worldCalibers.add(i.system.caliber);
        }
    });
    context.worldCalibers = Array.from(worldCalibers).sort();

    // Skill and Magazine filtering
    if (item.type === "weapon") {
      const selectedAttr = item.system.attribute || "dexterity";
      const skillGroups = NEUROSHIMA.skillConfiguration[selectedAttr] || {};
      const skills = {};
      for (const [spec, skillList] of Object.entries(skillGroups)) {
        for (const skill of skillList) {
          skills[skill] = `NEUROSHIMA.Skills.${skill}`;
        }
      }
      context.availableSkills = skills;
      context.availableMagazines = {};
      context.availableAmmo = {};

      // Populate magazines or ammo if owned by actor
      if (item.actor) {
        if (item.system.weaponType === "ranged") {
          const magazines = item.actor.items.filter(i => 
            i.type === "magazine" && 
            (i.system.caliber === item.system.caliber || !item.system.caliber)
          );
          context.availableMagazines = magazines.map(mag => {
            const contents = mag.system.contents || [];
            const tooltip = contents.length > 0 ? [...contents].reverse().map(c => `• ${c.name} (x${c.quantity})`).join("\n") : game.i18n.localize("NEUROSHIMA.Items.Fields.None");
            return {
              id: mag.id,
              name: `${mag.name} (${mag.system.totalCount}/${mag.system.capacity})`,
              tooltip: tooltip
            };
          });
        } else if (item.system.weaponType === "thrown") {
          const ammo = item.actor.items.filter(i => 
            i.type === "ammo" && 
            (i.system.caliber === item.system.caliber || !item.system.caliber)
          );
          context.availableAmmo = ammo.map(a => {
            let tooltip = `${game.i18n.localize("NEUROSHIMA.Items.Fields.Quantity")}: ${a.system.quantity}`;
            if (a.system.isOverride) {
              const mods = [];
              if (a.system.overrideDamage) mods.push(`Obr: ${a.system.damage}`);
              if (a.system.overridePiercing) mods.push(`PP: ${a.system.piercing}`);
              if (a.system.overrideJamming) mods.push(`Zac: ${a.system.jamming}`);
              if (mods.length) tooltip += `\n[${mods.join(", ")}]`;
            }
            return {
              id: a.id,
              name: `${a.name} (${a.system.quantity})`,
              tooltip: tooltip
            };
          });
        }
      }
    }

    // Prepare description object
    context.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(item.system.description || "", {
      async: true,
      secrets: item.isOwner,
      rollData: item.getRollData(),
      relativeTo: item
    });

    game.neuroshima.log(`Item Sheet Context prepared for ${item.name}`, context);

    return context;
  }

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "stats", group: "primary", label: "NEUROSHIMA.Tabs.Stats" },
        { id: "description", group: "primary", label: "NEUROSHIMA.Tabs.Description" },
        { id: "effects", group: "primary", label: "NEUROSHIMA.Tabs.Effects" }
      ],
      initial: "stats"
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/neuroshima/templates/item/item-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    stats: {
      template: "systems/neuroshima/templates/item/item-details.hbs"
    },
    description: {
      template: "systems/neuroshima/templates/item/item-description.hbs"
    },
    effects: {
      template: "systems/neuroshima/templates/item/item-effects.hbs"
    }
  };

  /**
   * Prepare the tabs configuration for the sheet.
   * @returns {Object}
   * @protected
   */
  _getTabs() {
    const item = this.document;
    const activeTab = this.tabGroups.primary;

    // 1. Definicja widocznych tabów dla poszczególnych typów
    const tabsByType = {
      trick: ["description", "effects"],
      // Pozostałe typy domyślnie dostaną wszystko (stats, description, effects)
    };

    const allowedTabs = tabsByType[item.type] || ["stats", "description", "effects"];

    // 2. Filtrowanie i mapowanie
    const tabs = allowedTabs.reduce((obj, id) => {
      const tabData = this.constructor.TABS.primary.tabs.find(t => t.id === id);
      if (tabData) {
        const isActive = activeTab === id || (!activeTab && id === allowedTabs[0]);
        obj[id] = {
          ...tabData,
          active: isActive,
          cssClass: isActive ? "active" : ""
        };
      }
      return obj;
    }, {});

    return tabs;
  }

  /**
   * Handle changing the item profile image.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   * @private
   */
  async _onEditImage(event, target) {
    const item = this.document;
    return new FilePicker({
      type: "image",
      current: item.img,
      callback: async path => {
        await item.update({ img: path });
      }
    }).browse();
  }
}
