import { NEUROSHIMA } from "../config.js";
import { TraitBrowserApp } from "../apps/trait-browser.js";
import { BeastActivitySheet } from "../apps/beast-activity-sheet.js";
import { installMod, attachMod, detachMod, removeMod, buildInstalledMap, buildModDeltaSummary, getEffectiveArmorRatings, getEffectiveArmorResistances, getEffectiveWeight, getEffectiveCost, computeWeaponEffective, buildWeaponWriteback } from "../helpers/mod-helpers.js";

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
      toggleTraitSummary: NeuroshimaItemSheet.prototype._onToggleTraitSummary,
      addResource: NeuroshimaItemSheet.prototype._onAddResource,
      deleteResource: NeuroshimaItemSheet.prototype._onDeleteResource,
      toggleResourceSummary: NeuroshimaItemSheet.prototype._onToggleResourceSummary,
      toggleResourceUnclamped: NeuroshimaItemSheet.prototype._onToggleResourceUnclamped,
      addRelationRow: NeuroshimaItemSheet.prototype._onAddRelationRow,
      deleteRelationRow: NeuroshimaItemSheet.prototype._onDeleteRelationRow,
      addBlastZone: NeuroshimaItemSheet.prototype._onAddBlastZone,
      removeBlastZone: NeuroshimaItemSheet.prototype._onRemoveBlastZone,
      addResistanceRow: NeuroshimaItemSheet.prototype._onAddResistanceRow,
      removeResistanceRow: NeuroshimaItemSheet.prototype._onRemoveResistanceRow,
      addResistanceDeltaRow: NeuroshimaItemSheet.prototype._onAddResistanceDeltaRow,
      removeResistanceDeltaRow: NeuroshimaItemSheet.prototype._onRemoveResistanceDeltaRow,
      attachMod: NeuroshimaItemSheet.prototype._onAttachMod,
      detachMod: NeuroshimaItemSheet.prototype._onDetachMod,
      removeMod: NeuroshimaItemSheet.prototype._onRemoveMod,
      uninstallMod: NeuroshimaItemSheet.prototype._onUninstallMod,
      removeContainerItem: NeuroshimaItemSheet.prototype._onRemoveContainerItem,
      editContainerItem: NeuroshimaItemSheet.prototype._onEditContainerItem,
      deleteContainerItem: NeuroshimaItemSheet.prototype._onDeleteContainerItem,
      toggleContainerLock: NeuroshimaItemSheet.prototype._onToggleContainerLock,
      toggleEquip: NeuroshimaItemSheet.prototype._onToggleEquip,
      toggleState: NeuroshimaItemSheet.prototype._onToggleState,
      addBeastActivity: NeuroshimaItemSheet.prototype._onAddBeastActivity,
      removeBeastActivity: NeuroshimaItemSheet.prototype._onRemoveBeastActivity,
      editBeastActivity: NeuroshimaItemSheet.prototype._onEditBeastActivity,
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

    if (item.type === "container" && data.type === "Item") {
      const sourceItem = await fromUuid(data.uuid);
      if (sourceItem) {
        await this._addItemToContainer(sourceItem, { move: !event.ctrlKey });
        return;
      }
    }

    if (data.type === "Item") {
      const sourceItem = await fromUuid(data.uuid);
      if (sourceItem?.type === "weapon-mod" && item.type === "weapon") {
        await installMod(item, sourceItem);
        if (sourceItem.actor && sourceItem.actor !== item.actor) {
          const qty = sourceItem.system.quantity ?? 1;
          if (qty <= 1) await sourceItem.delete();
          else await sourceItem.update({ "system.quantity": qty - 1 });
        }
        return;
      }
      if (sourceItem?.type === "armor-mod" && item.type === "armor") {
        await installMod(item, sourceItem);
        if (sourceItem.actor && sourceItem.actor !== item.actor) {
          const qty = sourceItem.system.quantity ?? 1;
          if (qty <= 1) await sourceItem.delete();
          else await sourceItem.update({ "system.quantity": qty - 1 });
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

    const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const userLevel = item.getUserLevel(game.user);
    const isGM = game.user.isGM;
    context.isLimitedView = !isGM && userLevel <= LEVELS.LIMITED;
    context.isObserverView = !isGM && userLevel === LEVELS.OBSERVER;

    const isContainerLocked = item.type === "container" && item.system.locked && !isGM;
    context.isContainerLocked = isContainerLocked;
    context.containerIsLocked = item.type === "container" && item.system.locked;

    const tabsByType = {
      disease: ["description", "stats", "resources", "effects"],
      trick: ["description", "resources", "effects"],
      trait: ["description", "effects"],
      gear: ["description", "stats", "resources", "effects"],
      "vehicle-mod": ["description", "stats", "resources", "effects"],
      "vehicle-damage": ["description", "stats", "effects"],
      specialization: ["description", "stats", "effects"],
      origin: ["description", "stats", "effects"],
      profession: ["description", "stats", "effects"],
      money: ["description", "stats", "effects"],
      reputation: ["description", "stats", "resources", "effects"],
      weapon: ["description", "stats", "resources", "effects", "mods"],
      armor: ["description", "stats", "resources", "effects", "mods"],
      "weapon-mod": ["description", "stats", "resources", "effects"],
      "armor-mod": ["description", "stats", "resources", "effects"],
      container: ["contents", "description", "stats", "effects"],
      "beast-action": ["stats", "description", "effects"],
      "beast-segment": ["stats", "description", "effects"]
    };
    let allowedTabs = tabsByType[item.type] || ["description", "stats", "resources", "effects"];

    if (context.isLimitedView) {
      allowedTabs = ["description"];
    } else if (isContainerLocked) {
      allowedTabs = ["contents", "description"];
    }

    if (!allowedTabs.includes(this.tabGroups.primary)) {
      this.tabGroups.primary = allowedTabs[0];
    }

    context.tabs = this._getTabs();
    if ((item.type === "beast-action" || item.type === "beast-segment") && context.tabs.stats) {
      context.tabs.stats.label = "NEUROSHIMA.Tabs.Stats";
    }
    if (context.isLimitedView || isContainerLocked) {
      const allowed = new Set(allowedTabs);
      for (const [id, tab] of Object.entries(context.tabs)) {
        if (!allowed.has(id)) delete context.tabs[id];
      }
    }
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
    context.isActorOwned = !!item.actor;

    const unjamMinRole = game.settings.get("neuroshima", "unjamMinRole") ?? 4;
    context.canUnjam = game.user.isGM || game.user.role >= unjamMinRole;
    context.isJammedWeapon = item.type === "weapon" && item.system.weaponType !== "grenade" && "jammed" in item.system;

    // Non-countable item types have no quantity, cost, or weight
    const NON_COUNTABLE = ["wound", "vehicle-damage", "vehicle-mod", "beast-action", "beast-segment", "specialization", "origin", "profession", "trick", "trait", "reputation", "disease", "facilities"];
    context.isNonCountable = NON_COUNTABLE.includes(item.type);
    context.isModItem = item.type === "weapon-mod" || item.type === "armor-mod";

    // Prepare type label
    let typeLabelKey = item.type.charAt(0).toUpperCase() + item.type.slice(1);
    if (item.type === "weapon" && item.system.weaponType) {
      typeLabelKey += item.system.weaponType.charAt(0).toUpperCase() + item.system.weaponType.slice(1);
    }
    context.typeLabel = `NEUROSHIMA.Items.Type.${typeLabelKey}`;

    if (item.type === "gear" && item.system.gearType && item.system.gearType !== "misc") {
      const i18nKey = NEUROSHIMA.gearTypes[item.system.gearType];
      context.gearTypeLabel = i18nKey ? game.i18n.localize(i18nKey) : item.system.gearType;
    }

    if (item.type === "money") {
      context.currencyValueLabel = game.settings.get("neuroshima", "currencyValueLabel") || "";
    }

    // Common options
    context.attributes = NEUROSHIMA.attributes;
    context.damageTypes = NEUROSHIMA.damageTypes;
    context.damageCategories = NEUROSHIMA.damageCategories;
    context.blastDamageTypes = NEUROSHIMA.blastDamageTypes;
    context.blastDamageTypesFull = NEUROSHIMA.blastDamageTypesFull;
    context.weaponSubtypes = NEUROSHIMA.weaponSubtypes;
    context.grenadeTypes = NEUROSHIMA.grenadeTypes;
    context.gearTypes = NEUROSHIMA.gearTypes;
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
    
    // Collect all unique calibers from world items (Weapons, Ammo, Magazines) for suggestions
    const worldCalibers = new Set();
    game.items.forEach(i => {
        if (["weapon", "ammo", "magazine"].includes(i.type) && i.system.caliber) {
            worldCalibers.add(i.system.caliber);
        }
    });
    if (item.actor) {
        item.actor.items.forEach(i => {
            if (["weapon", "ammo", "magazine"].includes(i.type) && i.system.caliber) {
                worldCalibers.add(i.system.caliber);
            }
        });
    }
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

    if (item.type === "reputation") {
      context.repMin = game.settings.get("neuroshima", "reputationMin") ?? -20;
      context.repMax = game.settings.get("neuroshima", "reputationMax") ?? 20;
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

    context.itemTest = item.system.tests?.value ?? "";

    context.itemEffects = item.effects.map(e => {
      const hasEnableScript = !!(e.getFlag?.("neuroshima", "enableScript"));
      const fromModId = e.getFlag?.("neuroshima", "fromModId") ?? null;
      const sourceName = fromModId
        ? (buildInstalledMap(item)[fromModId]?.name ?? fromModId)
        : null;
      return {
        id: e.id,
        name: e.name,
        icon: e.img || "icons/svg/aura.svg",
        disabled: e.disabled,
        suppressed: hasEnableScript && e.isSuppressed,
        scriptControlled: hasEnableScript,
        durationLabel: e.duration?.rounds ? `${e.duration.rounds}r` : (e.duration?.seconds ? `${e.duration.seconds}s` : "—"),
        fromModId,
        sourceName
      };
    });

    if (item.type === "weapon" || item.type === "armor") {
      const modsRaw = item.system.mods ?? {};
      context.isModded = !!(modsRaw.__modded);
      const installedMap = buildInstalledMap(item);
      context.installedMods = Object.entries(installedMap)
        .filter(([k]) => !k.startsWith("__"))
        .map(([id, snap]) => ({
          ...snap,
          id,
          deltaSummary: buildModDeltaSummary(snap, item.type),
          categoryLabel: game.i18n.localize(`NEUROSHIMA.Mods.Category.${snap.category ?? "modification"}`)
        }));

      if (context.isModded) {
        context.effectiveArmorRatings = getEffectiveArmorRatings(item);
        context.effectiveWeight = getEffectiveWeight(item);
        context.effectiveCost   = getEffectiveCost(item);
      }
      if (item.type === "armor") {
        const effRes = getEffectiveArmorResistances(item);
        context.effectiveArmorResistances = effRes;
        context.effectiveArmorResistanceRows = Object.entries(effRes).map(([category, locs]) => ({
          category,
          categoryLabel: game.i18n.localize(NEUROSHIMA.damageCategories[category]?.label ?? category),
          head:     locs.head     ?? 0,
          torso:    locs.torso    ?? 0,
          leftArm:  locs.leftArm  ?? 0,
          rightArm: locs.rightArm ?? 0,
          leftLeg:  locs.leftLeg  ?? 0,
          rightLeg: locs.rightLeg ?? 0
        }));
      }
      if (item.type === "armor" || item.type === "armor-mod") {
        context.resistanceCategories = Object.fromEntries(
          Object.entries(NEUROSHIMA.damageCategories).filter(([k]) => k !== "physical")
        );
      }

      if (item.type === "weapon-mod") {
        context.weaponModTypeSuggestions = NEUROSHIMA.weaponModTypeSuggestions ?? [];
      } else if (item.type === "armor-mod") {
        context.armorModTypeSuggestions = NEUROSHIMA.armorModTypeSuggestions ?? [];
      }
    }

    if (item.type === "weapon-mod") {
      context.weaponModTypeSuggestions = NEUROSHIMA.weaponModTypeSuggestions ?? [];
    } else if (item.type === "armor-mod") {
      context.armorModTypeSuggestions = NEUROSHIMA.armorModTypeSuggestions ?? [];
      if (!context.resistanceCategories) {
        context.resistanceCategories = Object.fromEntries(
          Object.entries(NEUROSHIMA.damageCategories).filter(([k]) => k !== "physical")
        );
      }
    }

    if (item.type === "container") {
      let contents;
      if (item.actor) {
        contents = Array.from(item.actor.items)
          .filter(i => i.getFlag("neuroshima", "containerId") === item.id)
          .map(c => ({
            id: c.id,
            name: c.name,
            img: c.img,
            type: c.type,
            quantity: c.system?.quantity ?? 1,
            weight: c.system?.weight ?? 0
          }));
      } else {
        contents = Array.from(item.system.contents || []).map((e, idx) => ({
          id: e._id || null,
          legacyIndex: idx,
          name: e.name,
          img: e.img,
          type: e.type,
          quantity: e.quantity ?? 1,
          weight: e.weight ?? 0
        }));
      }
      context.containerContents = contents;
      context.containerHasActor = !!item.actor;
      context.containerItemCount = contents.length;
      context.containerCurrentWeight = contents.reduce((sum, e) => sum + ((e.weight || 0) * (e.quantity || 1)), 0);
    }

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
    if (!effect) return;
    if (effect.getFlag("neuroshima", "enableScript")) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Effects.ScriptControlledWarn"));
      return;
    }
    await effect.update({ disabled: !effect.disabled });
  }

  async _onSaveItemTest(event, target) {
    const value = target.value ?? "";
    await this.document.update({ "system.tests.value": value });
  }

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "contents", group: "primary", label: "NEUROSHIMA.Tabs.Contents" },
        { id: "stats", group: "primary", label: "NEUROSHIMA.Tabs.Stats" },
        { id: "description", group: "primary", label: "NEUROSHIMA.Tabs.Description" },
        { id: "resources", group: "primary", label: "NEUROSHIMA.Tabs.Resources" },
        { id: "effects", group: "primary", label: "NEUROSHIMA.Tabs.Effects" },
        { id: "mods", group: "primary", label: "NEUROSHIMA.Tabs.Modifications" }
      ],
      initial: "description"
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
      scrollable: ["", ".sheet-body", ".contents-list-items", ".magazine-contents-section", ".spec-master-body", ".weapon-mod-stats", ".armor-mod-stats", ".weapon-mod-details", ".armor-mod-details"]
    },
    description: {
      template: "systems/neuroshima/templates/item/item-description.hbs"
    },
    resources: {
      template: "systems/neuroshima/templates/item/item-resources.hbs",
      scrollable: [".resources-list"]
    },
    effects: {
      template: "systems/neuroshima/templates/item/item-effects.hbs",
      scrollable: [".effects-list"]
    },
    mods: {
      template: "systems/neuroshima/templates/item/parts/mods-tab.hbs",
      scrollable: [".mods-list"]
    },
    contents: {
      template: "systems/neuroshima/templates/item/parts/container-contents.hbs",
      scrollable: [".container-contents-list"]
    }
  };

  /** @override */
  _detailsState = {};
  _scrollState = {};
  _isUpdating = false;
  _headerToggles = {};

  static _SCROLL_SELECTORS = [
    '[data-application-part="stats"]',
    "section.window-content",
    ".weapon-mod-stats",
    ".armor-mod-stats",
    ".weapon-mod-details",
    ".armor-mod-details"
  ];

  async _renderFrame(options) {
    const html = await super._renderFrame(options);
    if (!this.isEditable) return html;
    const item = this.document;
    const ellipsisBtn = html.querySelector(".fa-ellipsis-vertical, .fa-solid.fa-ellipsis-vertical")?.closest("button, a, .header-control");
    const sibling = ellipsisBtn ?? html.querySelector("[data-action='close']");
    const unjamMinRole = game.settings.get("neuroshima", "unjamMinRole") ?? 4;
    const canUnjam = game.user.isGM || game.user.role >= unjamMinRole;

    if (item.type === "container" && game.user.isGM) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "header-control container-lock-btn";
      Object.assign(btn.dataset, { action: "toggleState", property: "system.locked" });
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      sibling?.before(btn);
      this._headerToggles.locked = btn;
    }

    if (item.type === "weapon" && item.system.weaponType !== "grenade" && "jammed" in item.system && canUnjam) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "header-control jam-toggle-btn";
      Object.assign(btn.dataset, { action: "toggleState", property: "system.jammed" });
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      sibling?.before(btn);
      this._headerToggles.jammed = btn;
    }

    if ("equipped" in (item.system ?? {}) && (item.type !== "gear" || item.system.isWearable)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "header-control equip-toggle-btn";
      Object.assign(btn.dataset, { action: "toggleState", property: "system.equipped" });
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      sibling?.before(btn);
      this._headerToggles.equipped = btn;
    }

    return html;
  }

  async _preRender(context, options) {
    await super._preRender(context, options);
    this._scrollState = {};
    for (const sel of NeuroshimaItemSheet._SCROLL_SELECTORS) {
      const el = this.element?.querySelector(sel);
      if (el && el.scrollTop > 0) this._scrollState[sel] = el.scrollTop;
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const item = this.document;

    if (this._headerToggles.locked) {
      const isLocked = item.system.locked;
      this._headerToggles.locked.title = isLocked
        ? game.i18n.localize("NEUROSHIMA.Container.Unlock")
        : game.i18n.localize("NEUROSHIMA.Container.Lock");
      this._headerToggles.locked.innerHTML = isLocked
        ? `<i class="fas fa-lock" style="color:#ef4444;"></i>`
        : `<i class="fas fa-lock-open" style="color:#22c55e;"></i>`;
    }

    if (this._headerToggles.jammed) {
      const isJammed = !!item.system.jammed;
      this._headerToggles.jammed.title = isJammed
        ? game.i18n.localize("NEUROSHIMA.Items.Fields.JammedClear")
        : game.i18n.localize("NEUROSHIMA.Items.Fields.Jammed");
      this._headerToggles.jammed.innerHTML = isJammed
        ? `<img src="systems/neuroshima/assets/img/bullet-jam.svg" style="width:1em;height:1em;filter:drop-shadow(0 0 4px #ef4444);vertical-align:middle;">`
        : `<img src="systems/neuroshima/assets/img/bullet-jam.svg" style="width:1em;height:1em;opacity:0.35;vertical-align:middle;">`;
    }

    if (this._headerToggles.equipped) {
      const isEquipped = item.system.equipped;
      this._headerToggles.equipped.hidden = item.type === "gear" && !item.system.isWearable;
      this._headerToggles.equipped.title = isEquipped
        ? game.i18n.localize("NEUROSHIMA.Items.Fields.Unequip")
        : game.i18n.localize("NEUROSHIMA.Items.Fields.Equip");
      this._headerToggles.equipped.innerHTML = isEquipped
        ? `<i class="fas fa-shield" style="color:#22c55e;"></i>`
        : `<i class="fas fa-shield" style="opacity:0.35;"></i>`;
    }

    if (context.isObserverView) {
      this.element.querySelectorAll("input, select, textarea").forEach(el => {
        el.disabled = true;
      });
      this.element.querySelectorAll("[data-action]:not([data-action='editImage']):not([data-action='tab'])").forEach(el => {
        el.style.pointerEvents = "none";
        el.style.opacity = "0.5";
      });
    }

    this.element?.querySelectorAll("details[data-details-id]").forEach(d => {
      const id = d.dataset.detailsId;
      if (id in this._detailsState) d.open = this._detailsState[id];
      d.addEventListener("toggle", () => { this._detailsState[id] = d.open; });
    });

    requestAnimationFrame(() => {
      this.element?.querySelectorAll(".weapon-mod-section").forEach(d => d.classList.add("weapon-mod-ready"));
    });

    if (Object.keys(this._scrollState).length) {
      const savedState = { ...this._scrollState };
      setTimeout(() => {
        for (const [sel, top] of Object.entries(savedState)) {
          const el = this.element?.querySelector(sel);
          if (el) el.scrollTop = top;
        }
      }, 0);
    }

    this.element?.querySelectorAll(".delta-modifies-cost-cb").forEach(cb => {
      cb.addEventListener("change", () => {
        const costInput = cb.closest(".cost-input-row")?.querySelector("input[type='number']");
        if (costInput) costInput.disabled = !cb.checked;
      });
    });

    this.element?.querySelectorAll("input[name='system.overrideCaliber']").forEach(cb => {
      cb.addEventListener("change", () => {
        const row = cb.closest(".damage-input-row");
        const textInput = row?.querySelector("input[type='text']");
        if (textInput) textInput.disabled = !cb.checked;
      });
    });

    const activeTab = this.tabGroups?.primary;
    if (activeTab) {
      for (const partId of ["stats", "description", "resources", "effects", "mods", "contents"]) {
        const el = this.element?.querySelector(`[data-application-part="${partId}"]`);
        if (el) el.classList.toggle("active", partId === activeTab);
      }
    }

    if (["origin", "profession", "weapon", "armor", "container"].includes(item.type)) {
      const el = this.element;
      if (el && !el._dropBound) {
        el._dropBound = true;
        el.addEventListener("dragover", ev => ev.preventDefault());
        el.addEventListener("drop", ev => this._onDrop(ev));
      }
    }

    if (item.type === "container") {
      const contentsPart = this.element?.querySelector('[data-application-part="contents"]');
      if (contentsPart && !contentsPart._dragBound) {
        contentsPart._dragBound = true;
        contentsPart.addEventListener("dragstart", (ev) => {
          const row = ev.target.closest(".container-item-row");
          if (!row) return;
          const itemId = row.dataset.itemId;
          let dragData;
          if (item.actor && itemId) {
            const actorItem = item.actor.items.get(itemId);
            if (actorItem) dragData = { type: "Item", uuid: actorItem.uuid };
          } else if (itemId) {
            const entry = Array.from(item.system.contents || []).find(e => e._id === itemId);
            if (entry?.itemData) {
              const itemData = foundry.utils.deepClone(entry.itemData);
              delete itemData._id;
              dragData = { type: "Item", data: itemData };
            }
          }
          if (!dragData) { ev.preventDefault(); return; }
          ev.dataTransfer.setData("text/plain", JSON.stringify(dragData));
          this._pendingDrag = { entryId: itemId, ctrl: ev.ctrlKey };
        });
        contentsPart.addEventListener("dragend", async (ev) => {
          const pending = this._pendingDrag;
          this._pendingDrag = null;
          if (!pending?.entryId) return;
          if (ev.dataTransfer.dropEffect === "none") return;
          if (pending.ctrl) return;
          if (!item.actor) {
            const contents = Array.from(item.system.contents || []);
            const idx = contents.findIndex(e => e._id === pending.entryId);
            if (idx >= 0) {
              contents.splice(idx, 1);
              await item.update({ "system.contents": contents });
            }
          } else {
            const actorItem = item.actor.items.get(pending.entryId);
            if (actorItem) await actorItem.unsetFlag("neuroshima", "containerId");
          }
        });
      }
    }

    if (["weapon", "armor"].includes(item.type)) {
      const modsPart = this.element?.querySelector('[data-application-part="mods"]');
      if (modsPart && !modsPart._modsClickBound) {
        modsPart._modsClickBound = true;
        modsPart.addEventListener("click", async (ev) => {
          const btn = ev.target.closest("[data-action]");
          if (!btn) return;
          const action = btn.dataset.action;
          if (!["attachMod", "detachMod", "removeMod", "uninstallMod", "toggleModSummary", "openModSheet"].includes(action)) return;
          ev.preventDefault();
          ev.stopPropagation();
          const modId = btn.dataset.modId ?? btn.closest("[data-mod-id]")?.dataset.modId;
          if (!modId) return;
          if (action === "attachMod") await attachMod(this.document, modId);
          else if (action === "detachMod") await detachMod(this.document, modId);
          else if (action === "removeMod") await removeMod(this.document, modId);
          else if (action === "uninstallMod") { const { uninstallMod } = await import("../helpers/mod-helpers.js"); await uninstallMod(this.document, modId); }
          else if (action === "openModSheet") {
            const modItem = this.document.actor?.items.get(modId);
            if (modItem) {
              modItem.sheet.render(true);
            } else {
              const snap = (this.document.system.mods ?? {})[modId];
              if (snap?.uuid) {
                const doc = await fromUuid(snap.uuid);
                if (doc) doc.sheet.render(true);
              }
            }
          }
          else if (action === "toggleModSummary") {
            const wrap = modsPart.querySelector(`.mod-row-wrap[data-mod-id="${modId}"]`);
            wrap?.querySelector(".item-summary")?.classList.toggle("collapsed");
          }
        });
      }
    }

    if (["origin", "profession"].includes(item.type)) {
      this.element?.querySelectorAll("[data-trait-uuid]").forEach(row => {
        row.addEventListener("contextmenu", (ev) => {
          const uuid = row.dataset.traitUuid;
          if (uuid) this._showTraitContextMenu(ev, uuid);
        });
      });
    }

    const itemTestInput = this.element?.querySelector('.item-test-input');
    if (itemTestInput) {
      itemTestInput.addEventListener('change', async () => {
        await this.document.update({ "system.tests.value": itemTestInput.value.trim() });
      });
    }

    if (["weapon", "armor"].includes(item.type) && !this._modUpdateHookId) {
      this._modUpdateHookId = Hooks.on("updateItem", async (updatedItem, _change, _options, _userId) => {
        const parentId = updatedItem.getFlag("neuroshima", "modParentId");
        if (!parentId || parentId !== item.id) return;
        const modEntry = (item.system.mods ?? {})[updatedItem.id];
        if (modEntry?.attached && item.type === "weapon") {
          const modsRaw = foundry.utils.deepClone(item.system.mods ?? {});
          const installedMap = buildInstalledMap(item, modsRaw);
          const base = modsRaw.__baseStats;
          if (base) {
            const effective = computeWeaponEffective(base, installedMap);
            await item.update(buildWeaponWriteback(effective));
          }
        }
        this.render();
      });
    }

  }

  async close(options = {}) {
    if (this._modUpdateHookId) {
      Hooks.off("updateItem", this._modUpdateHookId);
      this._modUpdateHookId = null;
    }
    return super.close(options);
  }

  /**
   * Prepare the tabs configuration for the sheet.
   * @returns {Object}
   * @protected
   */
  _getTabs() {
    const item = this.document;
    const rawActiveTab = this.tabGroups.primary;

    // Tab visibility per item type
    const tabsByType = {
      disease: ["description", "stats", "resources", "effects"],
      trick: ["description", "resources", "effects"],
      trait: ["description", "effects"],
      gear: ["description", "stats", "resources", "effects"],
      "vehicle-mod": ["description", "stats", "resources", "effects"],
      "vehicle-damage": ["description", "stats", "effects"],
      specialization: ["description", "stats", "effects"],
      origin: ["description", "stats", "effects"],
      profession: ["description", "stats", "effects"],
      money: ["description", "stats", "effects"],
      reputation: ["description", "stats", "resources", "effects"],
      weapon: item.system?.weaponType === "grenade"
        ? ["description", "stats", "resources", "effects"]
        : ["description", "stats", "resources", "effects", "mods"],
      armor: ["description", "stats", "resources", "effects", "mods"],
      "weapon-mod": ["description", "stats", "resources", "effects"],
      "armor-mod": ["description", "stats", "resources", "effects"],
      facilities: ["description", "stats", "resources", "effects"],
      container: ["contents", "description", "stats", "effects"],
      "beast-action": ["stats", "description", "effects"],
      "beast-segment": ["stats", "description", "effects"]
    };

    const allowedTabs = tabsByType[item.type] || ["description", "stats", "resources", "effects"];

    // Fall back to the first allowed tab if the current one is not valid for this type
    const activeTab = allowedTabs.includes(rawActiveTab) ? rawActiveTab : null;

    // Build the active tab map
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

  async _onAddResource(event, target) {
    const item = this.document;
    const resources = Array.from(item.system.resources ?? []);
    resources.push({ key: "", label: "", value: 0, min: 0, max: 0, showInSummary: false, unclamped: false });
    await item.update({ "system.resources": resources });
  }

  async _onDeleteResource(event, target) {
    const item = this.document;
    const idx = parseInt(target.closest("[data-resource-index]")?.dataset.resourceIndex ?? "-1");
    if (idx < 0) return;
    const resources = Array.from(item.system.resources ?? []);
    resources.splice(idx, 1);
    await item.update({ "system.resources": resources });
  }

  async _onToggleResourceSummary(event, target) {
    const item = this.document;
    const idx = parseInt(target.dataset.resourceIndex ?? "-1");
    if (idx < 0) return;
    const resources = Array.from(item.system.resources ?? []);
    if (idx >= resources.length) return;
    const res = resources[idx];
    resources[idx] = { ...res, showInSummary: !res.showInSummary };
    await item.update({ "system.resources": resources });
  }

  async _onToggleResourceUnclamped(event, target) {
    const item = this.document;
    const idx = parseInt(target.dataset.resourceIndex ?? "-1");
    if (idx < 0) return;
    const resources = Array.from(item.system.resources ?? []);
    if (idx >= resources.length) return;
    const res = resources[idx];
    resources[idx] = { ...res, unclamped: !res.unclamped };
    await item.update({ "system.resources": resources });
  }

  async _onAddRelationRow(event, target) {
    const item = this.document;
    if (item.type !== "reputation") return;
    const table = Array.from(item.system.relationTable ?? []);
    table.push({ minVal: 0, maxVal: 0, name: "", color: "" });
    await item.update({ "system.relationTable": table });
  }

  async _onDeleteRelationRow(event, target) {
    const item = this.document;
    if (item.type !== "reputation") return;
    const idx = parseInt(target.dataset.index ?? "-1");
    if (idx < 0) return;
    const table = Array.from(item.system.relationTable ?? []);
    table.splice(idx, 1);
    await item.update({ "system.relationTable": table });
  }

  async _onAddBlastZone(event, target) {
    const item = this.document;
    if (item.type !== "weapon" || item.system.weaponType !== "grenade") return;
    const zones = foundry.utils.deepClone(item.system.blastZones ?? []);
    const maxRadius = zones.reduce((m, z) => Math.max(m, z.radius ?? 0), 0);
    zones.push({ radius: maxRadius + 1, damage: "L", knockdown: false, shrapnel: 0 });
    await item.update({ "system.blastZones": zones });
  }

  async _onRemoveBlastZone(event, target) {
    const item = this.document;
    if (item.type !== "weapon" || item.system.weaponType !== "grenade") return;
    const idx = parseInt(target.dataset.zoneIndex ?? "-1");
    if (idx < 0) return;
    const zones = foundry.utils.deepClone(item.system.blastZones ?? []);
    zones.splice(idx, 1);
    await item.update({ "system.blastZones": zones });
  }

  async _onAddResistanceDeltaRow(event, target) {
    const item = this.document;
    if (item.type !== "armor-mod") return;
    const deltas = foundry.utils.deepClone(item.system.resistanceDeltas ?? []);
    deltas.push({ category: "explosive", head: 0, torso: 0, leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 });
    await item.update({ "system.resistanceDeltas": deltas });
  }

  async _onRemoveResistanceDeltaRow(event, target) {
    const item = this.document;
    if (item.type !== "armor-mod") return;
    const idx = parseInt(target.dataset.resistanceIndex ?? "-1");
    if (idx < 0) return;
    const deltas = foundry.utils.deepClone(item.system.resistanceDeltas ?? []);
    deltas.splice(idx, 1);
    await item.update({ "system.resistanceDeltas": deltas });
  }

  async _onAddResistanceRow(event, target) {
    const item = this.document;
    if (item.type !== "armor") return;
    const resistances = foundry.utils.deepClone(item.system.armor?.resistances ?? []);
    resistances.push({ category: "explosive", head: 0, torso: 0, leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 });
    await item.update({ "system.armor.resistances": resistances });
  }

  async _onRemoveResistanceRow(event, target) {
    const item = this.document;
    if (item.type !== "armor") return;
    const idx = parseInt(target.dataset.resistanceIndex ?? "-1");
    if (idx < 0) return;
    const resistances = foundry.utils.deepClone(item.system.armor?.resistances ?? []);
    resistances.splice(idx, 1);
    await item.update({ "system.armor.resistances": resistances });
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

  async _onAttachMod(event, target) {
    const modId = target.dataset.modId ?? target.closest("[data-mod-id]")?.dataset.modId;
    if (!modId) return;
    await attachMod(this.document, modId);
  }

  async _onDetachMod(event, target) {
    const modId = target.dataset.modId ?? target.closest("[data-mod-id]")?.dataset.modId;
    if (!modId) return;
    await detachMod(this.document, modId);
  }

  async _onRemoveMod(event, target) {
    const modId = target.dataset.modId ?? target.closest("[data-mod-id]")?.dataset.modId;
    if (!modId) return;
    await removeMod(this.document, modId);
  }

  async _onUninstallMod(event, target) {
    const modId = target.dataset.modId ?? target.closest("[data-mod-id]")?.dataset.modId;
    if (!modId) return;
    const { uninstallMod } = await import("../helpers/mod-helpers.js");
    await uninstallMod(this.document, modId);
  }

  async _addItemToContainer(sourceItem, { move = false } = {}) {
    const container = this.document;
    if (container.type !== "container") return;
    if (sourceItem.uuid === container.uuid) return;

    const actor = container.actor;

    if (!actor) {
      const maxItems = container.system.maxItems;
      const contents = Array.from(container.system.contents || []);
      if (maxItems > 0 && contents.length >= maxItems) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Container.FullWarning"));
        return;
      }
      const snapshot = {
        _id: foundry.utils.randomID(),
        name: sourceItem.name,
        img: sourceItem.img || "systems/neuroshima/assets/img/backpack.svg",
        type: sourceItem.type,
        quantity: sourceItem.system?.quantity ?? 1,
        weight: sourceItem.system?.weight ?? 0,
        cost: sourceItem.system?.cost ?? 0,
        sourceUuid: sourceItem.uuid,
        itemData: sourceItem.toObject()
      };
      contents.push(snapshot);
      await container.update({ "system.contents": contents });
      if (move && !sourceItem.pack && !sourceItem.actor) {
        await sourceItem.delete();
      }
      return;
    }

    const maxItems = container.system.maxItems;
    if (maxItems > 0) {
      const currentCount = Array.from(actor.items).filter(i => i.getFlag("neuroshima", "containerId") === container.id).length;
      if (currentCount >= maxItems) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Container.FullWarning"));
        return;
      }
    }

    if (sourceItem.actor?.id === actor.id) {
      await sourceItem.setFlag("neuroshima", "containerId", container.id);
    } else {
      const itemData = sourceItem.toObject();
      foundry.utils.setProperty(itemData, "flags.neuroshima.containerId", container.id);
      await actor.createEmbeddedDocuments("Item", [itemData]);
    }
  }

  async _onRemoveContainerItem(event, target) {
    const container = this.document;
    if (container.type !== "container") return;
    const actor = container.actor;

    if (!actor) {
      const itemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
      if (itemId) {
        const contents = Array.from(container.system.contents || []);
        const idx = contents.findIndex(e => e._id === itemId);
        if (idx >= 0) {
          const entry = contents[idx];
          if (entry.itemData) {
            const itemData = foundry.utils.deepClone(entry.itemData);
            delete itemData._id;
            await Item.create(itemData);
          }
          contents.splice(idx, 1);
          await container.update({ "system.contents": contents });
          return;
        }
      }
      const idx = parseInt(target.dataset.contentIndex ?? target.closest("[data-content-index]")?.dataset.contentIndex ?? "-1");
      if (idx < 0) return;
      const contents = Array.from(container.system.contents || []);
      contents.splice(idx, 1);
      await container.update({ "system.contents": contents });
      return;
    }

    const childItemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
    if (!childItemId) return;
    const childItem = actor.items.get(childItemId);
    if (!childItem) return;
    await childItem.unsetFlag("neuroshima", "containerId");
  }

  async _onEditContainerItem(event, target) {
    const container = this.document;
    if (container.type !== "container") return;
    const actor = container.actor;

    if (!actor) {
      const entryId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
      if (!entryId) return;
      const entry = Array.from(container.system.contents || []).find(e => e._id === entryId);
      if (!entry) return;
      if (entry.sourceUuid) {
        try {
          const sourceItem = await fromUuid(entry.sourceUuid);
          if (sourceItem) { sourceItem.sheet.render(true); return; }
        } catch {}
      }
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Container.SourceNotFound"));
      return;
    }

    const childItemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
    if (!childItemId) return;
    const childItem = actor.items.get(childItemId);
    if (!childItem) return;
    childItem.sheet.render(true);
  }

  async _onDeleteContainerItem(event, target) {
    const container = this.document;
    if (container.type !== "container") return;
    const actor = container.actor;

    if (!actor) {
      const entryId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
      if (!entryId) return;
      const contents = Array.from(container.system.contents || []);
      const idx = contents.findIndex(e => e._id === entryId);
      if (idx < 0) return;
      contents.splice(idx, 1);
      await container.update({ "system.contents": contents });
      return;
    }

    const childItemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
    if (!childItemId) return;
    const childItem = actor.items.get(childItemId);
    if (!childItem) return;
    await childItem.deleteDialog();
  }

  async _onToggleState(event, target) {
    if (this._isUpdating) return;
    this._isUpdating = true;
    try {
      const property = target.dataset.property;
      const current = foundry.utils.getProperty(this.document, property);
      await this.submit({ updateData: { [property]: !current } });
    } finally {
      this._isUpdating = false;
    }
  }

  async _onToggleContainerLock() {
    if (!game.user.isGM) return;
    const container = this.document;
    if (container.type !== "container") return;
    await this.submit({ updateData: { "system.locked": !container.system.locked } });
  }

  async _onToggleEquip() {
    const item = this.document;
    if (!("equipped" in (item.system ?? {}))) return;
    await this.submit({ updateData: { "system.equipped": !item.system.equipped } });
  }

  async _onAddBeastActivity() {
    const item = this.document;
    if (item.type !== "beast-action" && item.type !== "beast-segment") return;
    const activities = foundry.utils.deepClone(item.system.activities ?? []);
    const base = {
      id: foundry.utils.randomID(),
      name: "",
      img: "",
      summary: "",
      gmNote: "",
      actionType: "",
      attribute: "dexterity",
      damage: "",
      piercing: 0,
      effectIds: []
    };
    if (item.type === "beast-segment") {
      base.costType = "segment";
      base.segmentCost = 1;
      base.skillMode = "experience";
      base.weaponType = "melee";
      base.damage1 = "D";
      base.damage2 = "L";
      base.damage3 = "C";
      base.range = 0;
    } else {
      base.costType = "success";
      base.successCost = 1;
    }
    activities.push(base);
    const updated = await item.update({ "system.activities": activities });
    if (updated) BeastActivitySheet.open(updated, base.id);
  }

  async _onRemoveBeastActivity(event, target) {
    const item = this.document;
    if (item.type !== "beast-action" && item.type !== "beast-segment") return;
    const activityId = target.closest("[data-activity-id]")?.dataset.activityId ?? target.dataset.activityId;
    if (!activityId) return;
    const activities = (item.system.activities ?? []).filter(a => a.id !== activityId);
    await item.update({ "system.activities": activities });
  }

  async _onEditBeastActivity(event, target) {
    const item = this.document;
    if (item.type !== "beast-action" && item.type !== "beast-segment") return;
    const activityId = target.closest("[data-activity-id]")?.dataset.activityId ?? target.dataset.activityId;
    if (!activityId) return;
    BeastActivitySheet.open(item, activityId);
  }

}
