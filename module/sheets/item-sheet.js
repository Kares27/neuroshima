import { NEUROSHIMA } from "../config.js";

import { TraitBrowserApp } from "../apps/trait-browser.js";

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
    actions: {
      editImage: NeuroshimaItemSheet.prototype._onEditImage,
      createEffect: NeuroshimaItemSheet.prototype._onCreateEffect,
      editEffect: NeuroshimaItemSheet.prototype._onEditEffect,
      deleteEffect: NeuroshimaItemSheet.prototype._onDeleteEffect,
      toggleEffect: NeuroshimaItemSheet.prototype._onToggleEffect,
      addTrait: NeuroshimaItemSheet.prototype._onAddTrait,
      traitContextMenu: NeuroshimaItemSheet.prototype._onTraitContextMenu,
      toggleTraitSummary: NeuroshimaItemSheet.prototype._onToggleTraitSummary
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
    const item = this.document;

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch(e) {
      return super._onDrop(event);
    }

    if (["origin", "profession"].includes(item.type) && data.type === "Item") {
      const sourceItem = await fromUuid(data.uuid);
      if (sourceItem?.type === "trait") {
        const uuid = data.uuid;
        const currentTraits = Array.from(item.system.traits || []);
        if (!currentTraits.includes(uuid)) {
          await item.update({ "system.traits": [...currentTraits, uuid] });
        }
        return;
      }
    }

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

  async _onAddTrait(event, target) {
    const item = this.document;
    const uuid = await TraitBrowserApp.pick();
    if (!uuid) return;
    const currentTraits = Array.from(item.system.traits || []);
    if (currentTraits.includes(uuid)) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Traits.AlreadyAdded"));
      return;
    }
    await item.update({ "system.traits": [...currentTraits, uuid] });
  }

  _onToggleTraitSummary(event, target) {
    const entry = target.closest("[data-trait-uuid]");
    if (!entry) return;
    const summary = entry.querySelector(".item-summary");
    if (!summary) return;
    summary.classList.toggle("collapsed");
  }

  _onTraitContextMenu(event, target) {
    const entry = target.closest("[data-trait-uuid]");
    const uuid = entry?.dataset.traitUuid;
    if (!uuid) return;
    this._showTraitContextMenu(event, uuid);
  }

  _showTraitContextMenu(event, uuid) {
    event.preventDefault();

    document.querySelectorAll(".ns-item-ctx-menu").forEach(el => el.remove());

    const menuItems = [
      { action: "edit",   icon: "fas fa-edit",  label: game.i18n.localize("Edit") },
      { action: "delete", icon: "fas fa-trash",  label: game.i18n.localize("Delete") }
    ];

    const menu = document.createElement("nav");
    menu.className = "ns-item-ctx-menu context-menu themed theme-dark";
    menu.style.cssText = "position:fixed;z-index:99999;";
    menu.innerHTML = `<menu class="context-items">${
      menuItems.map(m => `<li class="context-item" data-action="${m.action}"><i class="${m.icon} fa-fw"></i><span>${m.label}</span></li>`).join("")
    }</menu>`;
    document.body.appendChild(menu);

    const x = event.clientX;
    const y = event.clientY;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
      if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
    });

    menu.querySelectorAll(".context-item").forEach(li => {
      li.addEventListener("click", async (e) => {
        e.stopPropagation();
        const action = li.dataset.action;
        if (action === "edit") {
          const traitItem = await fromUuid(uuid);
          traitItem?.sheet?.render(true);
        } else if (action === "delete") {
          const item = this.document;
          const updated = (item.system.traits || []).filter(u => u !== uuid);
          await item.update({ "system.traits": updated });
        }
        menu.remove();
      });
    });

    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", close, { capture: true });
        document.removeEventListener("contextmenu", close, { capture: true });
      }
    };
    setTimeout(() => {
      document.addEventListener("click", close, { capture: true });
      document.addEventListener("contextmenu", close, { capture: true });
    }, 0);
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

    const tabsByType = {
      trick: ["description", "effects"],
      trait: ["description", "effects"],
      "vehicle-mod": ["stats", "description", "effects"],
      "vehicle-damage": ["stats", "description", "effects"],
      specialization: ["description", "stats", "effects"],
      origin: ["description", "stats", "effects"],
      profession: ["description", "stats", "effects"],
    };
    const allowedTabs = tabsByType[item.type] || ["stats", "description", "effects"];
    if (!allowedTabs.includes(this.tabGroups.primary)) {
      this.tabGroups.primary = allowedTabs[0];
    }

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

    // Non-countable item types have no quantity, cost, or weight
    const NON_COUNTABLE = ["wound", "vehicle-damage", "vehicle-mod", "beast-action", "specialization", "origin", "profession", "trick", "trait"];
    context.isNonCountable = NON_COUNTABLE.includes(item.type);

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
    context.vehicleLocations    = NEUROSHIMA.vehicleLocations;
    context.vehicleDamageTypes  = NEUROSHIMA.vehicleDamageTypes;

    if (item.type === "vehicle-mod" || item.type === "vehicle-damage") {
      context.vehicleModCategories = NEUROSHIMA.vehicleModCategories;
      const difficulties = {};
      for (const [key, val] of Object.entries(NEUROSHIMA.difficulties)) {
        difficulties[key] = val.label;
      }
      context.difficulties = difficulties;
    }
    
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
      const isCreature = item.actor?.type === "creature";
      const selectedAttr = item.system.attribute || "dexterity";
      const skillGroups = NEUROSHIMA.skillConfiguration[selectedAttr] || {};
      const skills = {};
      if (isCreature) {
        skills["experience"] = "NEUROSHIMA.Creature.Experience";
      } else {
        for (const [spec, skillList] of Object.entries(skillGroups)) {
          for (const skill of skillList) {
            skills[skill] = `NEUROSHIMA.Skills.${skill}`;
          }
        }
      }
      context.availableSkills = skills;
      // If stored skill is not in the available list (attr changed / default ""), use the first available skill
      const availableKeys = Object.keys(skills);
      if (!availableKeys.includes(item.system.skill)) {
        context.selectedSkill = availableKeys[0] ?? "";
        // Auto-migrate stale / empty skill to DB so dice.js always reads a valid key
        if (context.selectedSkill && item.isOwner && !item._autoMigratingSkill) {
          item._autoMigratingSkill = true;
          item.update({ "system.skill": context.selectedSkill }).finally(() => {
            delete item._autoMigratingSkill;
          });
        }
      } else {
        context.selectedSkill = item.system.skill;
      }
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

    if (item.type === "vehicle-mod") {
      context.enrichedRules = await foundry.applications.ux.TextEditor.enrichHTML(item.system.rules || "", {
        async: true,
        secrets: item.isOwner,
        rollData: item.getRollData(),
        relativeTo: item
      });
    }

    if (["specialization", "origin", "profession"].includes(item.type) && item.system.bonusText !== undefined) {
      context.bonusEnriched = await foundry.applications.ux.TextEditor.enrichHTML(item.system.bonusText || "", {
        async: true,
        secrets: item.isOwner,
        rollData: item.getRollData(),
        relativeTo: item
      });
    }

    if (["origin", "profession"].includes(item.type)) {
      const resolved = [];
      for (const uuid of (item.system.traits || [])) {
        if (!uuid) continue;
        const traitItem = await fromUuid(uuid);
        if (!traitItem) continue;
        const enriched = await foundry.applications.ux.TextEditor.enrichHTML(traitItem.system?.description || "", {
          async: true, secrets: item.isOwner, relativeTo: traitItem
        });
        resolved.push({
          uuid,
          name: traitItem.name,
          img: traitItem.img || "systems/neuroshima/assets/Brain.svg",
          enrichedDescription: enriched
        });
      }
      context.linkedTraitItems = resolved;
    }

    if (item.type === "specialization") {
      const specGroups = [];
      for (const [attrKey, specs] of Object.entries(NEUROSHIMA.skillConfiguration)) {
        const group = {
          attrKey,
          attrLabel: `NEUROSHIMA.Attributes.${attrKey.charAt(0).toUpperCase() + attrKey.slice(1)}`,
          specs: Object.keys(specs).map(specKey => ({
            key: specKey,
            label: `NEUROSHIMA.Specializations.${specKey}`,
            checked: item.system.skillSpecializations?.[specKey] ?? false
          }))
        };
        specGroups.push(group);
      }
      context.config = { ...context.config, specGroups };
    }

    // Prepare item effects
    context.itemEffects = item.effects.map(e => ({
      id: e.id,
      name: e.name,
      icon: e.img || "icons/svg/aura.svg",
      disabled: e.disabled,
      durationLabel: e.duration?.rounds ? `${e.duration.rounds}r` : (e.duration?.seconds ? `${e.duration.seconds}s` : "—")
    }));

    game.neuroshima.log(`Item Sheet Context prepared for ${item.name}`, context);

    return context;
  }

  async _onCreateEffect(event, target) {
    const [effect] = await this.document.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize("NEUROSHIMA.Effects.NewEffect"),
      icon: "icons/svg/aura.svg"
    }]);
    effect?.sheet.render(true);
  }

  async _onEditEffect(event, target) {
    const id = target.dataset.effectId ?? target.closest("[data-effect-id]")?.dataset.effectId;
    this.document.effects.get(id)?.sheet.render(true);
  }

  async _onDeleteEffect(event, target) {
    const id = target.dataset.effectId ?? target.closest("[data-effect-id]")?.dataset.effectId;
    await this.document.effects.get(id)?.delete();
  }

  async _onToggleEffect(event, target) {
    const id = target.dataset.effectId ?? target.closest("[data-effect-id]")?.dataset.effectId;
    const effect = this.document.effects.get(id);
    if (effect) await effect.update({ disabled: !effect.disabled });
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
      template: "systems/neuroshima/templates/item/item-details.hbs",
      scrollable: [".sheet-body", ".contents-list-items", ".magazine-contents-section", ".spec-master-body"]
    },
    description: {
      template: "systems/neuroshima/templates/item/item-description.hbs"
    },
    effects: {
      template: "systems/neuroshima/templates/item/item-effects.hbs"
    }
  };

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const activeTab = this.tabGroups?.primary;
    if (!activeTab) return;
    for (const partId of ["stats", "description", "effects"]) {
      const el = this.element?.querySelector(`[data-application-part="${partId}"]`);
      if (el) el.classList.toggle("active", partId === activeTab);
    }

    const item = this.document;
    if (["origin", "profession"].includes(item.type)) {
      const el = this.element;
      if (el && !el._traitDropBound) {
        el._traitDropBound = true;
        el.addEventListener("dragover", ev => ev.preventDefault());
        el.addEventListener("drop", ev => this._onDrop(ev));
      }

      this.element?.querySelectorAll("[data-trait-uuid]").forEach(row => {
        row.addEventListener("contextmenu", (ev) => {
          const uuid = row.dataset.traitUuid;
          if (uuid) this._showTraitContextMenu(ev, uuid);
        });
      });
    }

  }

  /**
   * Prepare the tabs configuration for the sheet.
   * @returns {Object}
   * @protected
   */
  _getTabs() {
    const item = this.document;
    const rawActiveTab = this.tabGroups.primary;

    // 1. Definicja widocznych tabów dla poszczególnych typów
    const tabsByType = {
      trick: ["description", "effects"],
      trait: ["description", "effects"],
      "vehicle-mod": ["stats", "description", "effects"],
      "vehicle-damage": ["stats", "description", "effects"],
      specialization: ["description", "stats", "effects"],
      origin: ["description", "stats", "effects"],
      profession: ["description", "stats", "effects"],
    };

    const allowedTabs = tabsByType[item.type] || ["stats", "description", "effects"];

    // Jeśli aktywna zakładka nie należy do dozwolonych (np. "stats" dla trick/trait), użyj pierwszej dozwolonej
    const activeTab = allowedTabs.includes(rawActiveTab) ? rawActiveTab : null;

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
