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
    position: { width: 680, height: 750 },
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
        const vehicle = this.document;

        const { VehicleCrewSelectDialog } = await import("../apps/vehicle-crew-select-dialog.js");
        const crewDialog = new VehicleCrewSelectDialog({
          vehicle,
          weapon: item,
          onSelect: async (crewActor) => {
            const { NeuroshimaWeaponRollDialog } = await import("../apps/weapon-roll-dialog.js");
            const rollDialog = new NeuroshimaWeaponRollDialog({
              actor:    crewActor,
              weapon:   item,
              rollType: item.system.weaponType
            });
            rollDialog.render(true);
          }
        });
        crewDialog.render(true);
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
      rollDurability: async function(event, target) {
        const vehicle = this.document;
        const system  = vehicle.system;
        const durStat = (system.attributes?.durability ?? 0) + (system.modifiers?.durability ?? 0);
        const label   = game.i18n.localize(NEUROSHIMA.vehicleAttributes.durability.label);
        return NeuroshimaVehicleSheet._showRollDialog({ stat: durStat, skill: 0, label, actor: vehicle, isSkill: false });
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
      },

      createEffect: async function(event, target) {
        const [effect] = await this.document.createEmbeddedDocuments("ActiveEffect", [{
          name: game.i18n.localize("NEUROSHIMA.Effects.NewEffect"),
          icon: "icons/svg/aura.svg",
          origin: this.document.uuid
        }]);
        effect?.sheet.render(true);
      },

      editEffect: async function(event, target) {
        const id = target.dataset.effectId ?? target.closest("[data-effect-id]")?.dataset.effectId;
        this.document.effects.get(id)?.sheet.render(true);
      },

      deleteEffect: async function(event, target) {
        const id = target.dataset.effectId ?? target.closest("[data-effect-id]")?.dataset.effectId;
        await this.document.effects.get(id)?.delete();
      },

      toggleEffect: async function(event, target) {
        const id = target.dataset.effectId ?? target.closest("[data-effect-id]")?.dataset.effectId;
        const effect = this.document.effects.get(id);
        if (effect) await effect.update({ disabled: !effect.disabled });
      }
    },
    dragDrop: [{ dragSelector: ".item[data-item-id]", dropSelector: "form" }]
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "crew",      group: "primary", label: "NEUROSHIMA.Tabs.Crew" },
        { id: "mods",      group: "primary", label: "NEUROSHIMA.Tabs.Modifications" },
        { id: "combat",    group: "primary", label: "NEUROSHIMA.Tabs.Combat" },
        { id: "equipment", group: "primary", label: "NEUROSHIMA.Tabs.Inventory" },
        { id: "effects",   group: "primary", label: "NEUROSHIMA.Tabs.Effects" },
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
    mods:      { template: "systems/neuroshima/templates/actors/vehicle/parts/vehicle-mods.hbs", scrollable: [""] },
    combat:    { template: "systems/neuroshima/templates/actors/vehicle/parts/vehicle-combat.hbs", scrollable: [""] },
    equipment: { template: "systems/neuroshima/templates/actors/vehicle/parts/vehicle-equipment.hbs", scrollable: [""] },
    effects:   { template: "systems/neuroshima/templates/actors/parts/actor-effects.hbs" },
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
    context.vehicleDamageTypes    = NEUROSHIMA.vehicleDamageTypes;

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

    const modCategoryLabels = {
      engine:      game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Engine"),
      gearbox:     game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Gearbox"),
      brakes:      game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Brakes"),
      turbo:       game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Turbo"),
      boring:      game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Boring"),
      electronics: game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Electronics"),
      exhaust:     game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Exhaust"),
      suspension:  game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Suspension"),
      wheels:      game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Wheels"),
      frame:       game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Frame"),
      armor:       game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Armor"),
      surprises:   game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Surprises"),
      extras:      game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Extras"),
      other:       game.i18n.localize("NEUROSHIMA.VehicleMod.Categories.Other")
    };
    const modDifficultyLabels = {
      easy:           game.i18n.localize("NEUROSHIMA.Difficulty.Easy"),
      average:        game.i18n.localize("NEUROSHIMA.Difficulty.Average"),
      problematic:    game.i18n.localize("NEUROSHIMA.Difficulty.Problematic"),
      hard:           game.i18n.localize("NEUROSHIMA.Difficulty.Hard"),
      veryHard:       game.i18n.localize("NEUROSHIMA.Difficulty.VeryHard"),
      damnHard:       game.i18n.localize("NEUROSHIMA.Difficulty.DamnHard"),
      luck:           game.i18n.localize("NEUROSHIMA.Difficulty.Luck"),
      masterful:      game.i18n.localize("NEUROSHIMA.Difficulty.Masterful"),
      grandmasterful: game.i18n.localize("NEUROSHIMA.Difficulty.Grandmasterful")
    };
    context.mods               = items.filter(i => i.type === "vehicle-mod");
    context.modCategoryLabels  = modCategoryLabels;
    context.modDifficultyLabels = modDifficultyLabels;

    const damageItems = items.filter(i => i.type === "vehicle-damage");
    /** maxHP = efficiency (Sprawność) attribute + modifier */
    const maxHP = (system.attributes?.efficiency ?? 0) + (system.modifiers?.efficiency ?? 0);
    /** totalDamagePoints = sum of Sprawność reductions across all damage items */
    const totalDamagePoints = damageItems.reduce((sum, w) => sum + (w.system.penalty || 0), 0);
    /** totalAgilityPenalty = sum of Zwrotność penalties across all damage items */
    const totalAgilityPenalty = damageItems.reduce((sum, w) => sum + (w.system.agilityPenalty || 0), 0);
    context.combat = {
      wounds:             damageItems,
      totalDamagePoints,
      totalAgilityPenalty,
      maxHP
    };

    context.notes = {
      enriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.notes || "", {
        secrets: actor.isOwner,
        async: true,
        relativeTo: actor
      })
    };

    context.effects = actor.effects.map(e => ({
      id: e.id,
      name: e.name,
      icon: e.img || "icons/svg/aura.svg",
      disabled: e.disabled,
      sourceName: e.origin ? (fromUuidSync(e.origin)?.name ?? e.origin) : actor.name,
      durationLabel: e.duration?.rounds ? `${e.duration.rounds}r` : (e.duration?.seconds ? `${e.duration.seconds}s` : "—")
    }));

    return context;
  }

  /** @override */
  async _onChangeForm(formConfig, event) {
    const input = event.target;
    const name  = input?.getAttribute?.("name") ?? input?.name;

    if (name?.startsWith("items.")) {
      const parts        = name.split(".");
      const itemId       = parts[1];
      const propertyPath = parts.slice(2).join(".");
      const item         = this.document.items.get(itemId);
      if (!item) return;

      let value;
      if (input.type === "checkbox") {
        value = input.checked;
      } else if (input.type === "number") {
        value = Math.round(Number(input.value) || 0);
      } else {
        value = input.value;
      }

      game.neuroshima.log("vehicle _onChangeForm item update", { itemId, propertyPath, value });
      await item.update({ [propertyPath]: value });
      return;
    }

    if (input?.dataset?.action === "setCrewRole") {
      const actorId = input.dataset.actorId;
      const role    = input.value;
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
    if (["weapon", "gear", "armor", "magazine", "ammo", "vehicle-damage", "vehicle-mod"].includes(item.type)) {
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

  /**
   * Standard roll dialog — same pattern as character/creature sheets.
   * Used for the Wytrzymałość (durability) attribute roll.
   */
  static async _showRollDialog({ stat, skill, label, actor, isSkill = false }) {
    const { NeuroshimaDice } = game.neuroshima;
    const template  = "systems/neuroshima/templates/dialog/roll-dialog.hbs";
    const lastRoll  = actor?.system?.lastRoll || {};

    const data = {
      difficulties:    NEUROSHIMA.difficulties,
      attributeList:   NEUROSHIMA.vehicleAttributes,
      currentAttribute: "",
      baseDifficulty:  lastRoll.baseDifficulty || "average",
      modifier:        lastRoll.modifier || 0,
      armorPenalty:    0,
      woundPenalty:    0,
      useArmorPenalty: false,
      useWoundPenalty: false,
      isOpen:          lastRoll.isOpen ?? false,
      isSkill:         false,
      rollMode:        lastRoll.rollMode || game.settings.get("core", "rollMode"),
      rollModes:       CONFIG.Dice.rollModes
    };

    const content = await foundry.applications.handlebars.renderTemplate(template, data);

    const dialog = new foundry.applications.api.DialogV2({
      window: {
        title:    `${game.i18n.localize("NEUROSHIMA.Actions.Roll")}: ${label}`,
        position: { width: 450, height: 350 }
      },
      content,
      classes: ["neuroshima", "roll-dialog-window"],
      buttons: [
        {
          action:  "roll",
          label:   game.i18n.localize("NEUROSHIMA.Actions.Roll"),
          default: true,
          callback: async (event, button) => {
            const form        = button.form;
            const isOpen      = form.elements.isOpen.value === "true";
            const baseDiffKey = form.elements.baseDifficulty.value;
            const modifier    = parseInt(form.elements.modifier.value) || 0;
            const rollMode    = form.elements.rollMode.value;
            const skillBonus     = parseInt(form.elements.skillBonus?.value)     || 0;
            const attributeBonus = parseInt(form.elements.attributeBonus?.value) || 0;

            if (actor) {
              await actor.update({
                "system.lastRoll": { modifier, baseDifficulty: baseDiffKey, isOpen, rollMode }
              });
            }

            NeuroshimaDice.rollTest({
              stat,
              skill: 0,
              penalties: {
                mod:    modifier,
                base:   (NEUROSHIMA.difficulties[baseDiffKey]?.min || 0),
                armor:  0,
                wounds: 0
              },
              isOpen,
              label,
              actor,
              skillBonus,
              attributeBonus,
              rollMode
            });
          }
        },
        { action: "cancel", label: game.i18n.localize("Cancel") }
      ]
    });

    dialog.render(true);
  }
}
