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
      },
      /**
       * Roll vehicle durability test for an existing damage item.
       * Result determines actual Sprawność and Agility penalties applied.
       */
      rollDurabilityTest: async function(event, target) {
        const itemId = target.closest("[data-item-id]")?.dataset.itemId;
        const item   = this.document.items.get(itemId);
        if (!item || item.type !== "vehicle-damage") return;

        const vehicle  = this.document;
        const system   = vehicle.system;
        const durStat  = (system.attributes?.durability ?? 0) + (system.modifiers?.durability ?? 0);
        const dmgType  = item.system.damageType || "VL";
        const cfg      = NEUROSHIMA.vehicleDamageConfiguration[dmgType];
        if (!cfg) return;

        const { NeuroshimaDice } = game.neuroshima;
        const label = `${game.i18n.localize("NEUROSHIMA.Vehicle.DurabilityTest")} (${vehicle.name})`;

        const rollData = await NeuroshimaDice.rollTest({
          stat:        durStat,
          skill:       0,
          label,
          actor:       null,
          isOpen:      false,
          penalties:   { mod: 0, wounds: 0, armor: 0, base: 0 },
          chatMessage: false
        });

        const passed = rollData?.success ?? false;
        const sprawnosc     = passed ? cfg.sprawnoscPassed      : cfg.sprawnoscFailed;
        const agilityPenalty = passed ? cfg.agilityPenaltyPassed : cfg.agilityPenaltyFailed;

        await item.update({
          "system.penalty":       sprawnosc,
          "system.agilityPenalty": agilityPenalty
        });

        const dmgLabel = game.i18n.localize(cfg.label);
        const passedStr = passed
          ? game.i18n.localize("NEUROSHIMA.Vehicle.DurabilityTestPassed")
          : game.i18n.localize("NEUROSHIMA.Vehicle.DurabilityTestFailed");

        const dice = (rollData?.modifiedResults ?? []).map(d => d.original).join(", ");

        await ChatMessage.create({
          content: `
            <div class="neuroshima chat-card">
              <div class="card-header"><strong>${label}</strong></div>
              <div class="card-body">
                <p><strong>${game.i18n.localize("NEUROSHIMA.Vehicle.DamageType.Label")}:</strong> ${dmgLabel}</p>
                <p><strong>${game.i18n.localize("NEUROSHIMA.Roll.Target")}:</strong> ${durStat}</p>
                <p><strong>${game.i18n.localize("NEUROSHIMA.Roll.Dice")}:</strong> ${dice}</p>
                <p class="${passed ? "success" : "failure"}"><strong>${passedStr}</strong></p>
                <p><strong>${game.i18n.localize("NEUROSHIMA.Vehicle.DamageSprawnoscAbbr")}:</strong> -${sprawnosc} &nbsp; <strong>${game.i18n.localize("NEUROSHIMA.Vehicle.DamageAgilityPenaltyAbbr")}:</strong> -${agilityPenalty}%</p>
              </div>
            </div>`,
          speaker: ChatMessage.getSpeaker({ actor: vehicle })
        });
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
}
