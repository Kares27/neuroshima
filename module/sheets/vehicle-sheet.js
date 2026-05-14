import { NEUROSHIMA } from "../config.js";
import { getConditions } from "../apps/condition-config.js";
import { NeuroshimaBaseActorSheet } from "./actor-sheet-base.js";

function _collectVehicleArmorBonusByEffect(actor) {
  const byLoc = {};
  if (!actor) return byLoc;
  const seen = new Set();
  for (const effect of actor.appliedEffects ?? []) {
    const key = effect.origin ?? effect.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const change of effect.changes ?? []) {
      const m = change.key.match(/^system\.armorBonus\.(\w+)$/);
      if (!m) continue;
      const loc = m[1];
      if (!byLoc[loc]) byLoc[loc] = [];
      byLoc[loc].push({ name: effect.name, value: Number(change.value) || 0 });
    }
  }
  return byLoc;
}

/**
 * Actor sheet for Vehicle actors (cars, bikes, trucks, etc.).
 */
export class NeuroshimaVehicleSheet extends NeuroshimaBaseActorSheet {
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
        const durStat = (system.attributes?.durability ?? 0) + (system.attributeBonuses?.durability ?? 0) + (system.modifiers?.durability ?? 0) + (system.bonuses?.durability ?? 0);
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
        const row = target.closest(".effect-row");
        const id = row?.dataset.effectId;
        const itemId = row?.dataset.itemId;
        const effect = itemId
          ? this.document.items.get(itemId)?.effects.get(id)
          : this.document.effects.get(id);
        effect?.sheet.render(true);
      },

      deleteEffect: async function(event, target) {
        const row = target.closest(".effect-row");
        if (row?.dataset.itemId) return;
        const id = row?.dataset.effectId;
        await this.document.effects.get(id)?.delete();
      },

      toggleEffect: async function(event, target) {
        const row = target.closest(".effect-row");
        const id = row?.dataset.effectId;
        const itemId = row?.dataset.itemId;
        const effect = itemId
          ? this.document.items.get(itemId)?.effects.get(id)
          : this.document.effects.get(id);
        if (effect) await effect.update({ disabled: !effect.disabled });
      },

      openSource: async function(event, target) {
        const itemId = target.dataset.itemId;
        this.document.items.get(itemId)?.sheet.render(true);
      },

      invokeItemScript: async function(event, target) {
        const { itemId, effectId, scriptIndex } = target.dataset;
        const item = this.document.items.get(itemId);
        if (!item) return;
        const effect = item.effects.get(effectId);
        if (!effect) return;
        const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
        await NeuroshimaScriptRunner.executeManual(this.document, effect, Number(scriptIndex));
      },

      toggleCondition: async function(event, target) {
        const key  = target.dataset.conditionKey;
        const type = target.dataset.conditionType;
        if (!key) return;
        if (type === "boolean") {
          await this.document.toggleStatusEffect(key);
        } else {
          if (event.button === 2 || event.type === "contextmenu") {
            await this.document.removeCondition(key);
          } else {
            await this.document.addCondition(key);
          }
        }
      },

      adjustConditionValue: async function(event, target) {
        const key = target.dataset.conditionKey;
        const allowNegative = target.dataset.allowNegative === "true";
        if (!key) return;
        const actor = this.document;
        let val = parseInt(target.value, 10);
        if (isNaN(val)) val = 0;
        if (!allowNegative) val = Math.max(0, val);
        const existing = actor.effects.find(
          e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
        );
        if (val === 0 && !allowNegative) {
          if (existing) await existing.delete();
          return;
        }
        if (existing) {
          await existing.setFlag("neuroshima", "conditionValue", val);
        } else if (val !== 0) {
          const condDef = getConditions().find(c => c.key === key);
          if (!condDef) return;
          await actor.createEmbeddedDocuments("ActiveEffect", [{
            name:        condDef.name,
            img:         condDef.img          ?? "icons/svg/aura.svg",
            tint:        condDef._tint        ?? null,
            description: condDef._description ?? "",
            disabled:    condDef._disabled    ?? false,
            statuses:    [key],
            changes:     foundry.utils.deepClone(condDef.changes   ?? []),
            duration:    foundry.utils.deepClone(condDef._duration ?? {}),
            flags: {
              neuroshima: {
                conditionNumbered: true,
                conditionValue:    val,
                scripts:           foundry.utils.deepClone(condDef.scripts      ?? []),
                transferType:      condDef._transferType  ?? "owningDocument",
                documentType:      condDef._documentType  ?? "actor",
                equipTransfer:     condDef._equipTransfer ?? false
              }
            }
          }]);
        }
      },

      adjustQuantity: async function(event, target) {
        const direction = event.button === 2 ? -1 : 1;
        const el = target.closest("[data-item-id]");
        const item = this.document.items.get(el?.dataset.itemId);
        if (!item || !("quantity" in item.system)) return;
        let amount = 1;
        if ((event.shiftKey) && (event.ctrlKey || event.metaKey)) amount = 1000;
        else if (event.ctrlKey || event.metaKey) amount = 100;
        else if (event.shiftKey) amount = 10;
        const newQuantity = Math.max(0, item.system.quantity + (amount * direction));
        await item.update({ "system.quantity": newQuantity });
      },

      consolidateMoney: async function(event, target) {
        const actor = this.document;
        const moneyItems = actor.items.filter(i => i.type === "money").sort((a, b) => b.system.coinValue - a.system.coinValue);
        if (!moneyItems.length) return;
        const totalBaseUnits = moneyItems.reduce((sum, i) => sum + (i.system.quantity * i.system.coinValue), 0);
        let remaining = totalBaseUnits;
        const updates = [];
        for (const item of moneyItems) {
          const count = Math.floor(remaining / item.system.coinValue);
          remaining -= count * item.system.coinValue;
          updates.push({ _id: item.id, "system.quantity": count });
        }
        await actor.updateEmbeddedDocuments("Item", updates);
      },

      toggleSummary: function(event, target) {
        const wrap = target.closest(".item-wrap");
        const summary = wrap?.querySelector(".item-summary");
        if (!summary) return;
        summary.classList.toggle("collapsed");
      },

      itemContextMenu: function(event, target) {
        const wrap = target.closest(".item-wrap");
        if (!wrap?.dataset.itemId) return;
        this._showItemContextMenu(event, wrap.dataset.itemId);
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
    effects:   { template: "systems/neuroshima/templates/actors/parts/actor-effects.hbs", scrollable: [""] },
    notes:     { template: "systems/neuroshima/templates/actors/actor/parts/actor-notes.hbs" }
  };

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
    const moneyItems = items.filter(i => i.type === "money").sort((a, b) => b.system.coinValue - a.system.coinValue);
    context.inventory = {
      money:          moneyItems,
      weaponsMelee:   items.filter(i => i.type === "weapon" && i.system.weaponType === "melee"),
      weaponsRanged:  items.filter(i => i.type === "weapon" && i.system.weaponType === "ranged"),
      weaponsThrown:  items.filter(i => i.type === "weapon" && i.system.weaponType === "thrown"),
      armor:          items.filter(i => i.type === "armor"),
      gear:           items.filter(i => i.type === "gear"),
      ammo:           items.filter(i => i.type === "ammo"),
      magazines:      items.filter(i => i.type === "magazine"),
      tricks:         items.filter(i => i.type === "trick"),
      traits:         items.filter(i => i.type === "trait")
    };

    const totalBaseUnits = moneyItems.reduce((sum, i) => sum + (i.system.quantity * i.system.coinValue), 0);
    const moneyDenominations = [];
    let remaining = totalBaseUnits;
    for (const item of moneyItems) {
      const count = Math.floor(remaining / item.system.coinValue);
      moneyDenominations.push({ name: item.name, count, coinValue: item.system.coinValue, id: item.id });
      remaining -= count * item.system.coinValue;
    }
    context.moneyData = {
      totalBaseUnits,
      totalBaseUnitsFormatted: totalBaseUnits.toLocaleString("pl-PL"),
      denominations: moneyDenominations,
      hasAny: moneyItems.length > 0
    };
    context.tricks = context.inventory.tricks;
    context.traits = context.inventory.traits;

    const vehicleArmorKeys = NEUROSHIMA.vehicleArmorKeys;
    const vehicleLocationsConfig = NEUROSHIMA.vehicleLocations;

    const vBonusAll    = Number(system.armorBonus?.all) || 0;
    const vPlateLabel  = game.i18n.localize("NEUROSHIMA.Vehicle.Armor");
    const vEffBonus    = _collectVehicleArmorBonusByEffect(actor);
    context.vehicleArmorLocations = vehicleArmorKeys.map(key => {
      const plate    = Number(system.armor?.[key]?.reduction) || 0;
      const bonusLoc = Number(system.armorBonus?.[key]) || 0;
      const bonus    = vBonusAll + bonusLoc;
      const locItems = context.inventory.armor.filter(a => a.system.location === key && a.system.equipped);
      const itemsAP  = locItems.reduce((s, a) => s + (Number(a.system.currentRating ?? a.system.rating) || 0), 0);

      const tooltipParts = [];
      if (plate > 0) tooltipParts.push(`${foundry.utils.escapeHTML(vPlateLabel)}: <strong>${plate}</strong>`);
      for (const itm of locItems) {
        const ap = Number(itm.system.currentRating ?? itm.system.rating) || 0;
        tooltipParts.push(`${foundry.utils.escapeHTML(itm.name)}: <strong>${ap}</strong>`);
      }
      for (const e of [...(vEffBonus.all ?? []), ...(vEffBonus[key] ?? [])]) {
        const sign = e.value >= 0 ? "+" : "";
        tooltipParts.push(`${foundry.utils.escapeHTML(e.name)}: <strong>${sign}${e.value}</strong>`);
      }

      return {
        key,
        label:            game.i18n.localize(vehicleLocationsConfig[key]),
        reduction:        plate,
        hitPenalty:       system.armor?.[key]?.hitPenalty ?? 0,
        weakPoint:        system.armor?.[key]?.weakPoint  ?? false,
        items:            locItems,
        totalEffectiveAP: plate + itemsAP + bonus,
        tooltip:          tooltipParts.join("<br>")
      };
    });

    const encValue = parseFloat(actor.items.reduce((t, i) => t + (parseFloat(i.system?.totalWeight) || 0), 0).toFixed(2));
    const encMax   = Number(system.maxLoad) || 0;
    const encPct   = encMax > 0 ? Math.min(100, (encValue / encMax) * 100) : 0;
    let encColor = "#3a8c3a";
    if (encValue >= encMax) encColor = "#9c2a2a";
    else if (encPct >= 75)  encColor = "#a05800";
    else if (encPct >= 50)  encColor = "#8c8000";
    context.vehicleEncumbrance = { value: encValue, max: encMax, pct: encPct, color: encColor };

    const enableEncumbrance = game.settings.get("neuroshima", "enableEncumbrance") ?? true;
    context.enableEncumbrance = enableEncumbrance;

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
    const maxHP = (system.attributes?.efficiency ?? 0) + (system.attributeBonuses?.efficiency ?? 0) + (system.modifiers?.efficiency ?? 0) + (system.bonuses?.efficiency ?? 0);
    /** totalDamagePoints = sum of Sprawność reductions across all damage items */
    const totalDamagePoints = damageItems.reduce((sum, w) => sum + (w.system.penalty || 0), 0);
    /** totalAgilityPenalty = sum of Zwrotność penalties across all damage items */
    const totalAgilityPenalty = damageItems.reduce((sum, w) => sum + (w.system.agilityPenalty || 0), 0);
    const totalArmorAP = (NEUROSHIMA.vehicleArmorKeys ?? []).reduce(
      (sum, key) => sum + (system.armor?.[key]?.reduction ?? 0), 0
    );
    context.combat = {
      wounds:             damageItems,
      totalDamagePoints,
      totalAgilityPenalty,
      totalArmorAP,
      maxHP
    };

    context.notes = {
      enriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.notes || "", {
        secrets: actor.isOwner,
        async: true,
        relativeTo: actor
      })
    };

    const condDefs = getConditions();
    const condTypeMap = Object.fromEntries(condDefs.map(c => [c.key, c.type ?? "boolean"]));
    const effectDurationLabel = (e) => e.duration?.rounds ? `${e.duration.rounds}r` : (e.duration?.seconds ? `${e.duration.seconds}s` : "—");
    const isTemporary = (e) => !!(
      e.duration?.rounds || e.duration?.seconds || e.duration?.turns ||
      e.getFlag("neuroshima", "fromAura") || e.getFlag("neuroshima", "fromArea")
    );
    const isConditionEffect = (e) => e.statuses?.size > 0;

    const temporary     = [];
    const passive       = [];
    const disabled      = [];
    const statusEffects = [];

    const pushEffect = (e, itemId, sourceName, sourceIcon, isItemEffect) => {
      const entry = {
        id: e.id,
        itemId: itemId ?? null,
        name: e.name,
        icon: e.img || "icons/svg/aura.svg",
        disabled: e.disabled,
        sourceName,
        sourceIcon,
        durationLabel: effectDurationLabel(e),
        isItemEffect: !!isItemEffect
      };
      if (isConditionEffect(e)) {
        const statusKey = [...(e.statuses ?? [])][0];
        entry.conditionType = condTypeMap[statusKey] ?? "boolean";
        statusEffects.push(entry);
      } else if (e.disabled) {
        disabled.push(entry);
      } else if (isTemporary(e)) {
        temporary.push(entry);
      } else {
        passive.push(entry);
      }
    };

    for (const e of actor.effects) {
      const fromAura = e.getFlag("neuroshima", "fromAura");
      const fromArea = e.getFlag("neuroshima", "fromArea");
      const sourceActorId = fromAura?.sourceActorId ?? fromArea?.sourceActorId ?? null;
      const sourceActor = sourceActorId ? game.actors.get(sourceActorId) : null;
      pushEffect(e, null, sourceActor?.name ?? actor.name, sourceActor?.img ?? actor.img ?? "icons/svg/mystery-man.svg", false);
    }

    for (const item of actor.items) {
      for (const e of item.effects) {
        const docType      = e.getFlag?.("neuroshima", "documentType")  ?? "actor";
        const transferType = e.getFlag?.("neuroshima", "transferType")  ?? "owningDocument";
        const equipTransfer = e.getFlag?.("neuroshima", "equipTransfer") ?? false;
        if (docType !== "actor" || transferType !== "owningDocument") continue;
        if (equipTransfer) continue;
        pushEffect(e, item.id, item.name, item.img || "icons/svg/item-bag.svg", true);
      }
    }

    context.effects = { temporary, passive, disabled, statusEffects };

    context.conditionStates = condDefs.map(c => {
      const isInt = c.type === "int";
      let active, value;
      if (isInt) {
        value  = actor.getConditionValue(c.key);
        active = value !== 0;
      } else {
        active = actor.statuses.has(c.key);
        value  = 0;
      }
      return {
        key:           c.key,
        name:          c.name,
        img:           c.img,
        type:          c.type,
        allowNegative: !!c.allowNegative,
        active,
        value
      };
    }).sort((a, b) => (a.type === "int" ? 1 : 0) - (b.type === "int" ? 1 : 0));

    context.itemManualScripts = this._prepareItemManualScripts(actor);

    return context;
  }

  _prepareItemManualScripts(actor) {
    const map = {};
    for (const item of (actor.items ?? [])) {
      const scripts = [];
      for (const eff of (item.effects ?? [])) {
        if (eff.disabled) continue;
        const flags = eff.getFlag?.("neuroshima", "scripts") ?? [];
        flags.forEach((s, idx) => {
          if (s.trigger === "manual") {
            const rawLabel = s.label || eff.name;
            const label = rawLabel
              .replace(/@effect\.name/g, eff.name)
              .replace(/@item\.name/g, item.name);
            scripts.push({
              itemId: item.id,
              effectId: eff.id,
              effectName: eff.name,
              scriptIndex: idx,
              label
            });
          }
        });
      }
      if (scripts.length) map[item.id] = scripts;
    }
    return map;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = this.element;
    html.querySelectorAll('[data-action="adjustQuantity"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const item = this.document.items.get(el.closest("[data-item-id]")?.dataset.itemId);
        if (!item || !("quantity" in item.system)) return;
        let amount = 1;
        if ((event.shiftKey) && (event.ctrlKey || event.metaKey)) amount = 1000;
        else if (event.ctrlKey || event.metaKey) amount = 100;
        else if (event.shiftKey) amount = 10;
        item.update({ "system.quantity": Math.max(0, item.system.quantity - amount) });
      });
    });

    html.querySelectorAll('.vehicle-mod-row[data-item-id]').forEach(row => {
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._showItemContextMenu(event, row.dataset.itemId);
      });
    });
  }

  _showItemContextMenu(event, itemId) {
    event.preventDefault();
    const item = this.document.items.get(itemId);
    if (!item) return;

    document.querySelectorAll('.ns-item-ctx-menu').forEach(el => el.remove());

    const menuItems = [
      { action: 'edit',      icon: 'fas fa-edit',    label: game.i18n.localize('Edit') },
      { action: 'post',      icon: 'fas fa-comment',  label: game.i18n.localize('NEUROSHIMA.ContextMenu.PostToChat') },
      { action: 'duplicate', icon: 'fas fa-copy',     label: game.i18n.localize('NEUROSHIMA.ContextMenu.Duplicate') },
      { action: 'delete',    icon: 'fas fa-trash',    label: game.i18n.localize('Delete') }
    ];

    const menu = document.createElement('nav');
    menu.className = 'ns-item-ctx-menu context-menu themed theme-dark';
    menu.style.cssText = 'position:fixed;z-index:99999;';
    menu.innerHTML = `<menu class="context-items">${
      menuItems.map(m => `<li class="context-item" data-action="${m.action}"><i class="${m.icon} fa-fw"></i><span>${m.label}</span></li>`).join('')
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

    menu.querySelectorAll('.context-item').forEach(li => {
      li.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = li.dataset.action;
        if (action === 'edit') item.sheet.render(true);
        else if (action === 'post') {
          const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
          await NeuroshimaChatMessage.postItemToChat(item, { actor: this.document });
        }
        else if (action === 'duplicate') item.clone({}, { save: true, parent: this.document });
        else if (action === 'delete') item.deleteDialog();
        menu.remove();
      });
    });

    const sheetEl = this.element;
    const cleanup = () => {
      menu.remove();
      document.removeEventListener('click', onDocClick, { capture: true });
      document.removeEventListener('contextmenu', onDocContext, { capture: true });
      document.removeEventListener('keydown', onEscape);
    };
    const onDocClick = (e) => {
      if (menu.contains(e.target)) return;
      if (sheetEl && sheetEl.contains(e.target)) return;
      cleanup();
    };
    const onDocContext = (e) => {
      if (menu.contains(e.target)) return;
      if (sheetEl && sheetEl.contains(e.target)) return;
      cleanup();
    };
    const onEscape = (e) => { if (e.key === 'Escape') cleanup(); };
    setTimeout(() => {
      document.addEventListener('click', onDocClick, { capture: true });
      document.addEventListener('contextmenu', onDocContext, { capture: true });
      document.addEventListener('keydown', onEscape);
    }, 0);
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
    if (["weapon", "gear", "armor", "magazine", "ammo", "vehicle-damage", "vehicle-mod", "money", "trick", "trait"].includes(item.type)) {
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
