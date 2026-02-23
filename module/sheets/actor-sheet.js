import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/dice.js";
import { NeuroshimaItem } from "../documents/item.js";
import { NeuroshimaWeaponRollDialog } from "../apps/weapon-roll-dialog.js";
import { AmmunitionLoadingDialog } from "../apps/ammo-loading-dialog.js";
import { CombatHelper } from "../helpers/combat-helper.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Actor sheet for Neuroshima 1.5 using ApplicationV2.
 */
export class NeuroshimaActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "actor"],
    position: {
      width: 750,
      height: 850
    },
    window: {
      title: "NEUROSHIMA.Sheet.ActorTitle",
      resizable: true,

    },
    // W AppV2 scrollable działa tak samo - tablica selektorów CSS
    renderConfig: {
      scrollable: [".skill-table",".inventory",".combat"]
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
      toggleDifficulties: this.prototype._onToggleDifficulties,
      rollAttribute: this.prototype._onRollAttribute, 
      rollSkill: this.prototype._onRollSkill,
      createItem: this.prototype._onCreateItem,
      editItem: this.prototype._onEditItem,
      deleteItem: this.prototype._onDeleteItem,
      toggleEquipped: this.prototype._onToggleEquipped,
      adjustQuantity: this.prototype._onAdjustQuantity,
      modifyDurability: this.prototype._onModifyDurability,
      modifyAP: this.prototype._onModifyAP,
      toggleHealing: this.prototype._onToggleHealing,
      configureHP: this.prototype._onConfigureHP,
      rollWeapon: this.prototype._onRollWeapon,
      unloadMagazine: this.prototype._onUnloadMagazine,
      showPatientCard: this.prototype._onShowPatientCard,
      requestHealing: this.prototype._onRequestHealing,
      toggleCombatLayout: this.prototype._onToggleCombatLayout
    },
    dragDrop: [{ dragSelector: ".item[data-item-id]", dropSelector: "form" }]
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "attributes", group: "primary", label: "NEUROSHIMA.Tabs.Attributes" },
        { id: "tricks", group: "primary", label: "NEUROSHIMA.Tabs.Tricks" },
        { id: "combat", group: "primary", label: "NEUROSHIMA.Tabs.Combat" },
        { id: "inventory", group: "primary", label: "NEUROSHIMA.Tabs.Inventory" },
        { id: "notes", group: "primary", label: "NEUROSHIMA.Tabs.Notes" }
      ],
      initial: "attributes"
    }
  };

  /** @override */
  static PARTS = {
    header: { template: "systems/neuroshima/templates/actor/parts/actor-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    attributes: { template: "systems/neuroshima/templates/actor/parts/actor-attributes.hbs" },
    skills: { template: "systems/neuroshima/templates/actor/parts/actor-skills.hbs", scrollable: [".skill-table"] },
    tricks: { template: "systems/neuroshima/templates/actor/parts/actor-tricks.hbs" },
    combat: { template: "systems/neuroshima/templates/actor/parts/actor-combat.hbs",  scrollable: [""] },
    combatPaperDoll: { template: "systems/neuroshima/templates/actor/parts/wounds-paper-doll-partial.hbs" ,  scrollable: [".paper-doll-scrollable"]},
    combatWoundsList: { template: "systems/neuroshima/templates/actor/parts/wounds-list-partial.hbs" ,  scrollable: [".wounds-list-container"]},
    inventory: { template: "systems/neuroshima/templates/actor/parts/actor-inventory.hbs", scrollable: [""]},
    notes: { template: "systems/neuroshima/templates/actor/parts/actor-notes.hbs" }
  };

  /** @inheritdoc */
  constructor(options={}) {
    super(options);
    this._difficultiesCollapsed = true;
    this._isRolling = false;
    this._selectedWoundLocation = null;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;

    context.actor = actor;
    context.system = system;
    context.config = NEUROSHIMA;
    context.tabs = this._getTabs();
    context.enableEncumbrance = game.settings.get("neuroshima", "enableEncumbrance");

    // Prepare Attributes
    context.attributeList = NEUROSHIMA.attributes;
    context.difficulties = NEUROSHIMA.difficulties;
    context.difficultiesCollapsed = this._difficultiesCollapsed;

    // Prepare Skills
    context.skillGroups = this._prepareSkillGroups();

    // Map owner and editable for templates
    context.owner = this.document.isOwner;
    context.editable = this.isEditable;

    // Organize Items - Sort by 'sort' property to allow manual reordering
    const items = actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.inventory = {
      weaponsMelee: items.filter(i => i.type === "weapon" && i.system.weaponType === "melee"),
      weaponsRanged: items.filter(i => i.type === "weapon" && i.system.weaponType === "ranged"),
      weaponsThrown: items.filter(i => i.type === "weapon" && i.system.weaponType === "thrown"),
      armor: items.filter(i => i.type === "armor"),
      gear: items.filter(i => i.type === "gear"),
      ammo: items.filter(i => i.type === "ammo"),
      magazines: items.filter(i => i.type === "magazine").map(m => {
          m.contentsReversed = [...(m.system.contents || [])].reverse();
          return m;
      })
    };
    context.tricks = items.filter(i => i.type === "trick");
    context.wounds = items.filter(i => i.type === "wound");

    const totalArmorPenalty = system.combat.totalArmorPenalty || 0;
    const totalWoundPenalty = system.combat.totalWoundPenalty || 0;
    const totalCombatPenalty = totalArmorPenalty + totalWoundPenalty;
    const penaltyTooltip = `${game.i18n.localize("NEUROSHIMA.Armor.TotalPenalty")}: ${totalArmorPenalty}% | ${game.i18n.localize("NEUROSHIMA.Wound.TotalPenalty")}: ${totalWoundPenalty}%`;

    const healingRate = system.healingRate || 5;
    
    // Get patient card version for healing panel
    const patientCardVersion = game.settings.get("neuroshima", "patientCardVersion");
    
    // Load saved wound location from actor flags, default to torso
    // Only load from flags on first init or if explicitly unset (allows renderPartial to preserve state)
    if (this._selectedWoundLocation === null || this._selectedWoundLocation === undefined) {
      this._selectedWoundLocation = actor.getFlag("neuroshima", "selectedWoundLocation") || "torso";
    }
    
    game.neuroshima?.log("_prepareContext selectedWoundLocation", { 
      value: this._selectedWoundLocation,
      type: typeof this._selectedWoundLocation
    });
    
    // Prepare patient data for extended healing panel
    // BUILD DATA ALWAYS - needed for extended wounds display
    let patientData = CombatHelper.generatePatientCard(actor);
    let locationsMap = {};
    let woundsByLocation = {};
    
    // Create wounds organized by location for extended wounds editing
    for (const location of patientData.locations) {
      locationsMap[location.key] = location;
      location.wounds = location.wounds
        .map(woundData => {
          const woundItem = actor.items.get(woundData.id);
          if (!woundItem) return null;
          return {
            ...woundData,
            uuid: woundItem.uuid,
            img: woundItem.img,
            system: woundItem.system,
            damageType: woundItem.system.damageType || "D",
            penalty: woundItem.system.penalty || 0,
            isHealing: woundItem.system.isHealing || false,
            hadFirstAid: woundItem.system.hadFirstAid || false,
            healingAttempts: woundItem.system.healingAttempts || 0,
            estimatedHealingDays: Math.ceil((woundItem.system.penalty || 0) / 5)
          };
        })
        .filter(w => w !== null);
      woundsByLocation[location.key] = location.wounds;
    }
    
    // IMPORTANT: Filter patientData.locations to only include the selected location
    // This ensures the template loop only iterates over the active location
    const selectedLocation = patientData.locations.find(loc => loc.key === this._selectedWoundLocation);
    let locationsForTemplate = selectedLocation ? [selectedLocation] : patientData.locations.slice(0, 1);
    
    // Safety check: ensure locationsForTemplate is not empty
    if (locationsForTemplate.length === 0 && patientData.locations.length > 0) {
      locationsForTemplate = [patientData.locations[0]];
      game.neuroshima?.log("WARNING: locationsForTemplate was empty, using first location as fallback");
    }

    const selectedLocationLabel = locationsForTemplate[0]?.label || "";
    
    game.neuroshima?.log("Filtering locations for template", {
      selectedLocationKey: this._selectedWoundLocation,
      foundSelectedLocation: !!selectedLocation,
      locationsForTemplateCount: locationsForTemplate.length,
      allLocationsCount: patientData.locations.length,
      selectedLocationLabel: selectedLocationLabel,
      selectedLocationKey2: locationsForTemplate[0]?.key || "none"
    });

    // Prepare Combat Tab Data
    context.combat = {
      armor: items.filter(i => i.type === "armor" && i.system.equipped),
      weapons: this._prepareCombatWeapons(items),
      wounds: context.wounds,
      activeWounds: items.filter(i => i.type === "wound" && i.system.isActive),
      totalArmorPenalty: totalArmorPenalty,
      totalWoundPenalty: totalWoundPenalty,
      totalCombatPenalty: totalCombatPenalty,
      penaltyTooltip: penaltyTooltip,
      totalDamagePoints: system.combat.totalDamagePoints,
      currentHP: system.hp.value || 0,
      maxHP: system.hp.max || 27,
      healingRate: healingRate,
      healingDaysRequired: Math.ceil(totalWoundPenalty / healingRate),
      anatomicalArmor: this._prepareAnatomicalArmor(items.filter(i => i.type === "armor" && i.system.equipped)),
      patientCardVersion: patientCardVersion,
      patientData: { ...patientData, locations: patientData.locations }, // Przekazujemy wszystkie lokacje
      locationsMap: locationsMap,
      woundsByLocation: woundsByLocation,
      selectedWoundLocation: this._selectedWoundLocation,
      selectedLocationLabel: selectedLocationLabel,
      woundsFirst: actor.getFlag("neuroshima", "woundsFirst") || false
    };
    
    game.neuroshima?.log("_prepareContext context.combat.selectedWoundLocation", {
      value: context.combat.selectedWoundLocation,
      patientDataLocationsCount: context.combat.patientData?.locations?.length || 0,
      locations: context.combat.patientData?.locations?.map(l => ({ key: l.key, label: l.label })) || []
    });

    // Prepare notes object
    context.notes = {
      raw: system.notes || "",
      enriched: await foundry.applications.ux.TextEditor.enrichHTML(system.notes || "", {
        async: true,
        secrets: this.document.isOwner,
        rollData: this.document.getRollData(),
        relativeTo: this.document
      })
    };

    return context;
  }

  /** @override */
  _prepareSubmitData(event, form, formData) {
    game.neuroshima.log("_prepareSubmitData triggered", {event, formData});

    // Zapisz pozycję scrollu wounds-list-container przed edycją
    const woundsListContainer = this.element?.querySelector(".wounds-list-container");
    this._woundsScrollTop = woundsListContainer?.scrollTop ?? 0;

    const data = formData.object;
    // Handle embedded items updates (e.g. from wounds table)
    const itemUpdates = {};
    
    // ActorSheetV2 can provide flattened or expanded data depending on how it was processed.
    // We check for both flattened "items.ID.system.prop" keys and expanded "items" object.
    for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("items.")) {
            const parts = key.split(".");
            const itemId = parts[1];
            const propertyPath = parts.slice(2).join("."); // e.g. "system.location"
            
            if (!itemUpdates[itemId]) itemUpdates[itemId] = { _id: itemId };
            foundry.utils.setProperty(itemUpdates[itemId], propertyPath, value);
            
            // Delete from main data to avoid updating actor with item data
            delete data[key];
        }
    }

    // Also check for expanded objects if they exist
    if (data.items && typeof data.items === "object") {
        for (const [itemId, itemData] of Object.entries(data.items)) {
            if (typeof itemData === "object") {
                if (!itemUpdates[itemId]) itemUpdates[itemId] = { _id: itemId };
                foundry.utils.mergeObject(itemUpdates[itemId], itemData);
            }
        }
        delete data.items;
    }

    // Perform updates for embedded items
    if (Object.keys(itemUpdates).length > 0) {
      const updates = Object.values(itemUpdates);
      game.neuroshima.log("Executing updateEmbeddedDocuments:", updates);
      this.document.updateEmbeddedDocuments("Item", updates);
    }

    if (!data.name) {
      data.name = this.document.name;
    }
    return super._prepareSubmitData(event, form, formData);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    
    const html = this.element;
    
    // Add listeners for custom actions
    html.querySelectorAll('[data-action="adjustQuantity"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this._onAdjustQuantity(event, event.currentTarget);
      });
    });

    html.querySelectorAll('[data-action="modifyDurability"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this._onModifyDurability(event, event.currentTarget);
      });
    });

    html.querySelectorAll('[data-action="modifyAP"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this._onModifyAP(event, event.currentTarget);
      });
    });

    // Add listeners for paper doll in extended healing panel
    // We check for hotspots repeatedly for a short period if not found immediately
    // to account for ApplicationV2 part injection timing
    const setupHotspots = () => {
      const hotspots = html.querySelectorAll('.body-location-hotspot');
      if (hotspots.length > 0) {
        hotspots.forEach(hotspot => {
          // Avoid duplicate listeners
          if (hotspot.getAttribute('data-listener-active')) return;
          hotspot.setAttribute('data-listener-active', 'true');
          
          hotspot.addEventListener('click', (event) => {
            event.preventDefault();
            // Save selected location to actor flags
            const locationKey = event.currentTarget.dataset.location;
            this._selectedWoundLocation = locationKey;
            this.document.setFlag("neuroshima", "selectedWoundLocation", locationKey);
            // Render wounds list to show selected location BEFORE updating visual state
            this.render({ parts: ["combatWoundsList"] }).then(() => {
              // Update visual state after render completes
              this._onPaperDollLocationSelect(event, event.currentTarget);
            });
          });
        });
        
        // Initialize paper doll with saved location
        this._initializeWoundLocationPanel(this.element);
        return true;
      }
      return false;
    };

    if (!setupHotspots()) {
      // Try again after a short delay if not found immediately
      setTimeout(setupHotspots, 100);
    }
    
    // Re-attach listeners to wounds list if it was updated
    const woundItems = html.querySelectorAll('.wounds-list-part .wound-item');
    if (woundItems.length > 0) {
      game.neuroshima?.log("_onRender: Wound items found, listeners should be handled by form", {
        count: woundItems.length
      });
    }

    // Przywróć scroll wounds-list-container jeśli był zapisany
    if (this._woundsScrollTop != null) {
      const container = html.querySelector(".wounds-list-container");
      if (container) {
        container.scrollTop = this._woundsScrollTop;
      }
      this._woundsScrollTop = null;
    }
  }

  /**
   * Initialize wound location panel - ensures active class is set and wounds are visible
   * @private
   */
  _initializeWoundLocationPanel(html) {
    const hotspots = html.querySelectorAll('.body-location-hotspot');
    const targetHotspot = Array.from(hotspots).find(h => h.dataset.location === this._selectedWoundLocation);
    
    game.neuroshima?.log("_initializeWoundLocationPanel", {
      hotspotsFound: hotspots.length,
      selectedLocation: this._selectedWoundLocation,
      targetFound: !!targetHotspot
    });
    
    if (targetHotspot) {
      this._onPaperDollLocationSelect(null, targetHotspot);
    } else if (hotspots.length > 0) {
      // Fallback: if saved location not found, use first available (torso)
      const torsoHotspot = Array.from(hotspots).find(h => h.dataset.location === "torso") || hotspots[0];
      this._selectedWoundLocation = torsoHotspot.dataset.location;
      game.neuroshima?.log("_initializeWoundLocationPanel fallback", {
        usedLocation: this._selectedWoundLocation
      });
      this._onPaperDollLocationSelect(null, torsoHotspot);
    } else {
      game.neuroshima?.log("_initializeWoundLocationPanel ERROR: No hotspots found!");
    }
  }

  /** @override */
  _onUpdate(changed, options, userId) {
    const changedKeys = Object.keys(changed);
    let itemsChanged = false;
    let onlyWoundsChanged = true;
    let hpChanged = false;

    // Zapisz pozycję scrolla wounds-list-container
    const woundsListContainer = this.element?.querySelector('.wounds-list-container');
    const scrollPosition = woundsListContainer?.scrollTop || 0;

    for (const key of changedKeys) {
      if (key.startsWith("items")) {
        itemsChanged = true;
        const parts = key.split(".");
        const itemId = parts[1];
        const item = this.document.items.get(itemId);
        if (item && item.type !== "wound") onlyWoundsChanged = false;
      } else if (key.includes("hp") || key.includes("health")) {
        hpChanged = true;
      } else {
        onlyWoundsChanged = false;
      }
    }

    let renderPromise;
    if (itemsChanged) {
      if (onlyWoundsChanged) {
        renderPromise = this.render({ parts: ["header", "combatWoundsList"] });
      } else {
        renderPromise = this.render({ parts: ["header", "combat", "combatPaperDoll", "combatWoundsList", "inventory"] });
      }
    } else if (hpChanged) {
      renderPromise = this.render({ parts: ["header", "combat", "combatPaperDoll", "combatWoundsList"] });
    } else {
      return super._onUpdate(changed, options, userId);
    }

    // Przywróć scrollPosition
    if (renderPromise && onlyWoundsChanged) {
      renderPromise.then(() => {
        const newWoundsListContainer = this.element?.querySelector('.wounds-list-container');
        if (newWoundsListContainer) {
          newWoundsListContainer.scrollTop = scrollPosition;
        }
      });
    }

    return renderPromise;
  }

  /** @override */
  async _onDrop(event) {
    game.neuroshima.log("_onDrop triggered");
    return super._onDrop(event);
  }

  /** @override */
  async _onDropItem(event, item) {
    game.neuroshima.log("_onDropItem triggered", {item});

    // W ApplicationV2 drugim argumentem jest już Document, ale na wszelki wypadek obsługujemy oba przypadki
    const sourceItem = (item instanceof foundry.abstract.Document) ? item : await NeuroshimaItem.fromDropData(item);
    if ( !sourceItem ) return super._onDropItem(event, item);

    // Sprawdź czy upuszczamy amunicję na magazynek lub broń z magazynkiem
    const targetEl = event.target.closest(".magazine-container, .magazine-item-row, .equipment-item, .item[data-item-id]");
    const targetId = targetEl?.dataset.itemId;
    let targetItem = this.document.items.get(targetId);

    // Jeśli targetItem to nie magazynek, sprawdź czy upuszczono na broń dystansową, która ma przypisany magazynek
    if (targetItem && targetItem.type !== "magazine") {
        if (targetItem.type === "weapon" && targetItem.system.weaponType === "ranged" && targetItem.system.magazine) {
            targetItem = this.document.items.get(targetItem.system.magazine);
        }
    }

    if (sourceItem.type === "ammo" && targetItem?.type === "magazine") {
        // Powstrzymaj natywny drop/sortowanie przy ładowaniu amunicji
        event.stopPropagation();
        this._onLoadAmmoIntoMagazine(sourceItem, targetItem);
        return false;
    }

    // Pozwól natywnej implementacji obsłużyć tworzenie/sortowanie przedmiotu
    const result = await super._onDropItem(event, item);
    
    // Jeśli przedmiot został stworzony (nowy dokument) i pochodzi od innego aktora, usuń oryginał (ruch)
    // UWAGA: super._onDropItem w AppV2 może zwracać stworzony przedmiot lub wynik sortowania
    if (result && !event.altKey && sourceItem.actor && (sourceItem.actor.id !== this.document.id)) {
        await sourceItem.delete();
        game.neuroshima.log(`Moved item ${sourceItem.name} from actor ${sourceItem.actor.name} to ${this.document.name}`);
    }
    
    return result;
  }

  /**
   * Handle loading ammo into a magazine.
   * @private
   */
  async _onLoadAmmoIntoMagazine(ammo, magazine) {
      game.neuroshima.log("Inicjalizacja ładowania amunicji", { ammo, magazine });
      const amount = await AmmunitionLoadingDialog.wait({ ammo, magazine });
      if (!amount || isNaN(amount)) {
          game.neuroshima.log("Anulowano ładowanie amunicji lub brak ilości");
          return;
      }

      const contents = [...(magazine.system.contents || [])];
      
      const ammoData = {
          ammoId: ammo.id,
          name: ammo.name,
          img: ammo.img,
          quantity: amount,
          overrides: {
              enabled: ammo.system.isOverride,
              damage: ammo.system.overrideDamage ? ammo.system.damage : null,
              piercing: ammo.system.overridePiercing ? ammo.system.piercing : null,
              jamming: ammo.system.overrideJamming ? ammo.system.jamming : null,
              // Kopiowanie parametrów śrutu do nadpisań magazynka (LIFO)
              isPellet: ammo.system.isPellet,
              pelletCount: ammo.system.isPellet ? (ammo.system.pelletCount || 1) : 1,
              pelletRanges: ammo.system.isPellet ? ammo.system.pelletRanges : null
          }
      };

      game.neuroshima.log("Przygotowanie danych amunicji do dodania", ammoData);

      // Dodaj nową amunicję do magazynka (na górę stosu) - Sprawdź czy można połączyć z ostatnim
      const lastStack = contents[contents.length - 1];
      if (this._isSameAmmo(lastStack, ammoData)) {
          lastStack.quantity += ammoData.quantity;
          game.neuroshima.log("Połączono ze stosującym się elementem w magazynku", { lastStack });
      } else {
          contents.push(ammoData);
      }

      game.neuroshima.log("Aktualizacja zawartości magazynka", { contents });
      await magazine.update({ "system.contents": contents });
      
      // Odejmij amunicję z ekwipunku
      if (ammo.system.quantity <= amount) {
          game.neuroshima.log("Usuwanie pustego stosu amunicji z ekwipunku");
          await ammo.delete();
      } else {
          game.neuroshima.log("Aktualizacja ilości amunicji w ekwipunku", { remaining: ammo.system.quantity - amount });
          await ammo.update({ "system.quantity": ammo.system.quantity - amount });
      }

      ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.AmmoLoaded", {
          amount,
          ammo: ammo.name,
          mag: magazine.name
      }));
  }

  /**
   * Handle unloading a magazine.
   * @private
   */
  async _onUnloadMagazine(event, target) {
      const magId = target.closest("[data-item-id]").dataset.itemId;
      const magazine = this.document.items.get(magId);
      if (!magazine || magazine.type !== "magazine") return;

      const contents = magazine.system.contents;
      if (!contents.length) return;

      // Group identical consecutive stacks in the magazine contents before unloading to inventory
      // to avoid creating multiple separate items if they are already identical.
      const groupedContents = [];
      for (const stack of contents) {
          const last = groupedContents[groupedContents.length - 1];
          if (this._isSameAmmo(last, stack)) {
              last.quantity += stack.quantity;
          } else {
              groupedContents.push(stack);
          }
      }

      const actor = this.document;

      // Zwróć amunicję do ekwipunku
      for (const stack of groupedContents) {
          // Szukaj istniejącej amunicji tego samego typu (nazwa, kaliber ORAZ identyczne nadpisania)
          let existingAmmo = actor.items.find(i => {
              if (i.type !== "ammo" || i.name !== stack.name || i.system.caliber !== magazine.system.caliber) return false;
              return this._isSameAmmo(i, stack);
          });
          
          if (existingAmmo) {
              await existingAmmo.update({ "system.quantity": existingAmmo.system.quantity + stack.quantity });
          } else {
              // Stwórz nowy przedmiot amunicji
              await NeuroshimaItem.create({
                  name: stack.name,
                  type: "ammo",
                  img: stack.img || "systems/neuroshima/assets/img/ammo.svg",
                  system: {
                      quantity: stack.quantity,
                      caliber: magazine.system.caliber,
                      // Przywracamy statystyki z zapisanego stacka
                      isOverride: stack.overrides?.enabled || false,
                      overrideDamage: !!stack.overrides?.damage,
                      damage: stack.overrides?.damage || "L",
                      overridePiercing: !!stack.overrides?.piercing,
                      piercing: stack.overrides?.piercing || 0,
                      overrideJamming: !!stack.overrides?.jamming,
                      jamming: stack.overrides?.jamming || 20,
                      isPellet: stack.overrides?.isPellet || false,
                      pelletCount: stack.overrides?.pelletCount || 1,
                      pelletRanges: stack.overrides?.pelletRanges || null
                  }
              }, { parent: actor });
          }
      }

      await magazine.update({ "system.contents": [] });
      ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.MagazineUnloaded", { name: magazine.name }));
  }

  /**
   * Compare two ammo stacks or an item and a stack definition to see if they are identical in stats.
   * @private
   */
  _isSameAmmo(s1, s2) {
      if (!s1 || !s2) return false;
      if (s1.name !== s2.name) return false;
      
      // Handle comparing Actor Item to Magazine Stack or Magazine Stack to Magazine Stack
      const getStats = (obj) => {
          if (obj.system) { // Actor Item
              const s = obj.system;
              return {
                  damage: s.damage ?? "L",
                  piercing: s.piercing ?? 0,
                  jamming: s.jamming ?? 20,
                  isPellet: !!s.isPellet,
                  pelletCount: s.pelletCount ?? 1,
                  pelletRanges: s.pelletRanges || null,
                  enabled: !!s.isOverride
              };
          } else { // Magazine Stack
              const o = obj.overrides || {};
              return {
                  damage: o.damage ?? "L",
                  piercing: o.piercing ?? 0,
                  jamming: o.jamming ?? 20,
                  isPellet: !!o.isPellet,
                  pelletCount: o.pelletCount ?? 1,
                  pelletRanges: o.pelletRanges || null,
                  enabled: !!o.enabled
              };
          }
      };

      const stats1 = getStats(s1);
      const stats2 = getStats(s2);

      let samePelletStats = true;
      if (stats1.isPellet && stats2.isPellet) {
          samePelletStats = stats1.pelletCount === stats2.pelletCount;
          if (samePelletStats && stats1.pelletRanges && stats2.pelletRanges) {
              samePelletStats = JSON.stringify(stats1.pelletRanges) === JSON.stringify(stats2.pelletRanges);
          }
      }

      return stats1.damage === stats2.damage && 
             stats1.piercing === stats2.piercing && 
             stats1.jamming === stats2.jamming && 
             stats1.isPellet === stats2.isPellet &&
             stats1.enabled === stats2.enabled &&
             samePelletStats;
  }

  /**
   * Toggle the visibility of difficulty thresholds.
   */
  async _onToggleDifficulties(event, target) {
    this._difficultiesCollapsed = !this._difficultiesCollapsed;
    this.render({ parts: ["attributes"] });
  }

  /**
   * Handle changing the actor profile image.
   */
  async _onEditImage(event, target) {
    const actor = this.document;
    return new FilePicker({
      type: "image",
      current: actor.img,
      callback: async path => {
        await actor.update({ img: path });
      }
    }).browse();
  }

  async _onRollAttribute(event, target) {
    const attrKey = target.dataset.attribute;
    const actor = this.document;
    const system = actor.system;
    
    const attrValue = system.attributes[attrKey] + (system.modifiers[attrKey] || 0);
    const label = game.i18n.localize(NEUROSHIMA.attributes[attrKey].label);

    return this._showRollDialog({
      stat: attrValue,
      skill: 0,
      label: label,
      actor: actor,
      isSkill: false
    });
  }

  async _onRollSkill(event, target) {
    const skillKey = target.dataset.skill;
    const actor = this.document;
    const system = actor.system;

    // Find which attribute this skill belongs to
    let attrKey = "";
    for (const [aKey, specs] of Object.entries(NEUROSHIMA.skillConfiguration)) {
      for (const skills of Object.values(specs)) {
        if (skills.includes(skillKey)) {
          attrKey = aKey;
          break;
        }
      }
      if (attrKey) break;
    }

    const statValue = system.attributes[attrKey] + (system.modifiers[attrKey] || 0);
    const skillValue = system.skills[skillKey].value;
    const label = game.i18n.localize(`NEUROSHIMA.Skills.${skillKey}`);

    return this._showRollDialog({
      stat: statValue,
      skill: skillValue,
      label: label,
      actor: actor,
      isSkill: true,
      currentAttribute: attrKey
    });
  }

  /**
   * Universal roll dialog for Neuroshima tests.
   */
  async _showRollDialog({ stat, skill, label, actor, isSkill = false, currentAttribute = "" }) {
    const template = "systems/neuroshima/templates/dialog/roll-dialog.hbs";
    const lastRoll = actor.system.lastRoll || {};
    
    const armorPenalty = actor.system.combat?.totalArmorPenalty || 0;
    const woundPenalty = actor.system.combat?.totalWoundPenalty || 0;

    const data = {
      difficulties: NEUROSHIMA.difficulties,
      attributeList: NEUROSHIMA.attributes,
      currentAttribute: currentAttribute,
      baseDifficulty: lastRoll.baseDifficulty || "average",
      modifier: lastRoll.modifier || 0,
      armorPenalty: armorPenalty,
      woundPenalty: woundPenalty,
      useArmorPenalty: lastRoll.useArmorPenalty ?? true,
      useWoundPenalty: lastRoll.useWoundPenalty ?? true,
      isOpen: lastRoll.isOpen ?? true,
      isSkill: isSkill
    };
    const content = await foundry.applications.handlebars.renderTemplate(template, data);

    const dialog = new foundry.applications.api.DialogV2({
      window: { 
        title: `${game.i18n.localize("NEUROSHIMA.Actions.Roll")}: ${label}`,
        position: { width: 450, height: isSkill ? 420 : 350 }
      },
      content: content,
      classes: ["neuroshima", "roll-dialog-window"],
      buttons: [
        {
          action: "roll",
          label: game.i18n.localize("NEUROSHIMA.Actions.Roll"),
          default: true,
          callback: async (event, button, dialog) => {
            const form = button.form;
            const isOpen = form.elements.isOpen.value === "true";
            const baseDiffKey = form.elements.baseDifficulty.value;
            const modifier = parseInt(form.elements.modifier.value) || 0;
            const useArmor = form.elements.useArmorPenalty.checked;
            const armorPenalty = useArmor ? (parseInt(form.elements.armorPenalty.value) || 0) : 0;
            const useWound = form.elements.useWoundPenalty.checked;
            const woundPenalty = useWound ? (parseInt(form.elements.woundPenalty.value) || 0) : 0;
            
            const skillBonus = parseInt(form.elements.skillBonus.value) || 0;
            const attributeBonus = parseInt(form.elements.attributeBonus.value) || 0;

            let finalStat = stat;
            if (isSkill && form.elements.attribute) {
              const selectedAttr = form.elements.attribute.value;
              finalStat = actor.system.attributes[selectedAttr] + (actor.system.modifiers[selectedAttr] || 0);
            }

            // Save last roll data
            await actor.update({
              "system.lastRoll": {
                modifier,
                baseDifficulty: baseDiffKey,
                useArmorPenalty: useArmor,
                useWoundPenalty: useWound,
                isOpen
              }
            });

            NeuroshimaDice.rollTest({
              stat: finalStat,
              skill,
              penalties: {
                mod: (NEUROSHIMA.difficulties[baseDiffKey]?.min || 0) + modifier,
                armor: armorPenalty,
                wounds: woundPenalty
              },
              isOpen,
              label,
              actor,
              skillBonus,
              attributeBonus
            });
          }
        },
        {
          action: "cancel",
          label: game.i18n.localize("Cancel")
        }
      ]
    });

    dialog.render(true);

    // Add event listeners for dynamic summary updates and interactions
    setTimeout(() => {
      const html = $(dialog.element);
      
      // Make form-groups clickable to focus/toggle inputs
      html.find('.form-group').on('click', (ev) => {
        if ($(ev.target).is('select, input')) return;
        const input = $(ev.currentTarget).find('select, input').first();
        if (input.is('select')) {
          input.focus();
        } else if (input.is('input[type="checkbox"]')) {
          input.prop('checked', !input.prop('checked')).trigger('change');
        } else if (input.is('input[type="number"]')) {
          input.focus().select();
        }
      });

      const updateSummary = () => {
        const isOpen = html.find('[name="isOpen"]').val() === "true";
        const baseDiffKey = html.find('[name="baseDifficulty"]').val();
        const modifier = parseInt(html.find('[name="modifier"]').val()) || 0;
        const useArmor = html.find('[name="useArmorPenalty"]').is(':checked');
        const armorPenalty = useArmor ? (parseInt(html.find('[name="armorPenalty"]').val()) || 0) : 0;
        const useWound = html.find('[name="useWoundPenalty"]').is(':checked');
        const woundPenalty = useWound ? (parseInt(html.find('[name="woundPenalty"]').val()) || 0) : 0;
        
        const skillBonus = parseInt(html.find('[name="skillBonus"]').val()) || 0;
        const attributeBonus = parseInt(html.find('[name="attributeBonus"]').val()) || 0;
        
        const totalSkill = (skill || 0) + skillBonus;
        const skillShift = NeuroshimaDice.getSkillShift(totalSkill);

        let currentStatValue = stat;
        if (isSkill && html.find('[name="attribute"]').length) {
          const selectedAttr = html.find('[name="attribute"]').val();
          currentStatValue = actor.system.attributes[selectedAttr] + (actor.system.modifiers[selectedAttr] || 0);
        }
        const finalStat = currentStatValue + attributeBonus;

        const baseDiff = NEUROSHIMA.difficulties[baseDiffKey];
        const totalPenalty = (baseDiff?.min || 0) + modifier + armorPenalty + woundPenalty;
        
        const penaltyDiff = NeuroshimaDice.getDifficultyFromPercent(totalPenalty);
        const finalDiff = NeuroshimaDice._getShiftedDifficulty(penaltyDiff, -skillShift);
        
        const finalTarget = finalStat + (finalDiff.mod || 0);

        html.find('.total-modifier').text(`${totalPenalty}%`);
        html.find('.final-difficulty').text(game.i18n.localize(finalDiff.label));
        html.find('.final-target').text(finalTarget);
      };

      html.on('change input', 'input, select', updateSummary);
      updateSummary();
    }, 100);

    return dialog;
  }

  /**
   * Prepare weapon data for combat tab with magazine information.
   */
  _prepareCombatWeapons(items) {
    const weapons = items.filter(i => i.type === "weapon" && i.system.equipped);
    const magazines = items.filter(i => i.type === "magazine");

    return weapons.map(weapon => {
      const wData = weapon.system;
      const weaponObj = {
        id: weapon.id,
        name: weapon.name,
        img: weapon.img,
        type: wData.weaponType,
        attack: wData.attackBonus || 0,
        defense: wData.defenseBonus || 0,
        damage: wData.damage || "",
        piercing: wData.piercing || 0,
        fireRate: wData.fireRate || 0
      };

      if (wData.weaponType === "melee") {
        weaponObj.damage = [wData.damageMelee1, wData.damageMelee2, wData.damageMelee3].filter(d => d).join("/");
      } else {
        // Handle ranged and thrown weapon ammo stats
        let ammoJamming = wData.jamming || 20;
        
        // Find matching magazine
        // We only show a magazine if it's explicitly selected by ID or Name
        let magazine = null;
        if (wData.magazine) {
            magazine = magazines.find(m => m.id === wData.magazine || m.name === wData.magazine);
        }
        
        if (magazine) {
          const contents = magazine.system.contents || [];
          weaponObj.magazine = {
            id: magazine.id,
            name: magazine.name,
            count: magazine.system.totalCount,
            max: magazine.system.capacity,
            contents: contents,
            contentsReversed: [...contents].reverse(),
            tooltip: contents.length > 0 ? [...contents].reverse().map(c => {
                let s = `• ${c.name} (x${c.quantity})`;
                if (c.overrides?.enabled) {
                    const mods = [];
                    if (c.overrides.damage) mods.push(`Obr: ${c.overrides.damage}`);
                    if (c.overrides.piercing !== null) mods.push(`PP: ${c.overrides.piercing}`);
                    if (c.overrides.jamming !== null) mods.push(`Zac: ${c.overrides.jamming}`);
                    if (mods.length) s += ` [${mods.join(", ")}]`;
                }
                return s;
            }).join("\n") : game.i18n.localize("NEUROSHIMA.Items.Fields.None")
          };
          
          if (contents.length > 0) {
              const topStack = contents[contents.length - 1];
              // Stats for next shot (TOP of LIFO stack)
              weaponObj.damage = topStack.overrides?.enabled && topStack.overrides.damage ? topStack.overrides.damage : wData.damage;
              weaponObj.piercing = topStack.overrides?.enabled && topStack.overrides.piercing !== null ? topStack.overrides.piercing : (wData.piercing || 0);
              
              // Jamming is the weakest link among ALL loaded bullets
              const contentJamming = contents.map(c => 
                  (c.overrides?.enabled && c.overrides.jamming !== null) ? c.overrides.jamming : (wData.jamming || 20)
              );
              ammoJamming = Math.min(wData.jamming || 20, ...contentJamming);
          }
        } else if (wData.weaponType === "thrown" && wData.magazine) {
            // Special handling for thrown weapons using ammo items
            const ammoItem = items.find(i => i.id === wData.magazine);
            if (ammoItem && ammoItem.type === "ammo") {
                weaponObj.damage = (ammoItem.system.isOverride && ammoItem.system.overrideDamage) ? ammoItem.system.damage : wData.damage;
                weaponObj.piercing = (ammoItem.system.isOverride && ammoItem.system.overridePiercing) ? ammoItem.system.piercing : (wData.piercing || 0);
                
                const stackJamming = (ammoItem.system.isOverride && ammoItem.system.overrideJamming) ? ammoItem.system.jamming : (wData.jamming || 20);
                ammoJamming = Math.min(wData.jamming || 20, stackJamming);
                weaponObj.ammoName = ammoItem.name;
                weaponObj.ammoCount = ammoItem.system.quantity;
            }
        }
        
        weaponObj.jamming = ammoJamming;
      }

      return weaponObj;
    });
  }

  /**
   * Group equipped armor by anatomical location and calculate totals.
   */
  _prepareAnatomicalArmor(equippedArmor) {
    const locations = {};
    for (const [key, data] of Object.entries(NEUROSHIMA.bodyLocations)) {
      locations[key] = { label: data.label, items: [], totalAP: 0 };
    }

    for (const item of equippedArmor) {
      const armor = item.system.armor || {};
      const ratings = armor.ratings || {};
      const damages = armor.damage || {};
      const durDamage = armor.durabilityDamage || 0;
      const durability = armor.durability || 0;

      for (const [loc, rating] of Object.entries(ratings)) {
        if (rating > 0 && locations[loc]) {
          const locDamage = damages[loc] || 0;
          const currentAP = Math.max(0, rating - locDamage);
          const currentDur = Math.max(0, durability - durDamage);
          
          locations[loc].totalAP += currentAP;
          locations[loc].items.push({
            id: item.id,
            name: item.name,
            img: item.img,
            durability: durability,
            durabilityDamage: durDamage,
            currentDurability: currentDur,
            rating: rating,
            damage: locDamage,
            currentRating: currentAP
          });
        }
      }
    }
    return locations;
  }

  /**
   * Handle modifying armor durability damage via click.
   */
  async _onModifyDurability(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if (!item || item.type !== "armor") return;

    const isRightClick = event.type === "contextmenu";
    const currentDamage = item.system.armor?.durabilityDamage || 0;
    const maxDurability = item.system.armor?.durability || 0;

    let newDamage = isRightClick ? currentDamage + 1 : currentDamage - 1;
    newDamage = Math.clamp(newDamage, 0, maxDurability);

    if (newDamage !== currentDamage) {
      return item.update({ "system.armor.durabilityDamage": newDamage });
    }
  }

  /**
   * Handle modifying armor AP damage via click.
   */
  async _onModifyAP(event, target) {
    const itemId = target.dataset.itemId;
    const location = target.dataset.location;
    const item = this.document.items.get(itemId);
    if (!item || item.type !== "armor" || !location) return;

    const isRightClick = event.type === "contextmenu";
    const currentDamage = item.system.armor?.damage?.[location] || 0;
    const maxAP = item.system.armor?.ratings?.[location] || 0;

    let newDamage = isRightClick ? currentDamage + 1 : currentDamage - 1;
    newDamage = Math.clamp(newDamage, 0, maxAP);

    if (newDamage !== currentDamage) {
      return item.update({ [`system.armor.damage.${location}`]: newDamage });
    }
  }

  /**
   * Handle toggling the healing state of a wound.
   */
  async _onToggleHealing(event, target) {
    const li = target.closest(".item");
    const item = this.document.items.get(li.dataset.itemId);
    if (!item || item.type !== "wound") return;
    // _onUpdate hook will handle selective rendering of combat part only
    return item.update({ "system.isHealing": !item.system.isHealing });
  }

  /**
   * Handle rolling a weapon attack.
   */
  async _onRollWeapon(event, target) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
    
    // Zapobieganie wielokrotnym wywołaniom (np. double click)
    if (this._isRolling) {
        game.neuroshima.log("_onRollWeapon: Rzut jest już w toku, ignoruję dodatkowe kliknięcie.");
        return;
    }
    this._isRolling = true;

    const itemId = target.closest(".item")?.dataset.itemId;
    const weapon = this.document.items.get(itemId);
    if (!weapon) {
        this._isRolling = false;
        return;
    }
    
    try {
        game.neuroshima.group(`_onRollWeapon: ${weapon.name}`);
        game.neuroshima.log("Inicjalizacja rzutu bronią");

        // Walidacja wyboru magazynka/amunicji przed wyrenderowaniem dialogu
        const wData = weapon.system;
        const isRanged = wData.weaponType === "ranged";
        const isThrown = wData.weaponType === "thrown";

        if ((isRanged || isThrown) && wData.caliber) {
            if (!wData.magazine) {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoMagazineSelected"));
                game.neuroshima.log("Błąd: Brak wybranego magazynka");
                throw new Error("No magazine selected");
            }
            
            const magazine = this.document.items.get(wData.magazine);
            if (!magazine || (magazine.type === "magazine" && magazine.system.totalCount <= 0)) {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.OutOfAmmo"));
                game.neuroshima.log("Błąd: Brak amunicji w magazynku");
                throw new Error("Out of ammo");
            }

            if (magazine.type === "ammo" && magazine.system.quantity <= 0) {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.OutOfAmmo"));
                game.neuroshima.log("Błąd: Brak amunicji w ekwipunku");
                throw new Error("Out of ammo");
            }
        }

        const lastRoll = this.document.system.lastWeaponRoll || {};
        let distance = 0;

        // Obsługa automatycznego wyboru celu dla broni dystansowej/miotanej
        if (isRanged || isThrown) {
            const targets = game.user.targets;
            const actorToken = this._getSourceToken();
            game.neuroshima.log("Źródłowy token aktora:", actorToken?.name || "Brak");

            if (targets.size > 0 && actorToken) {
                // Jeśli mamy już cele, pobierz dystans do pierwszego z nich
                const targetToken = Array.from(targets)[0]; 
                distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, targetToken);
                game.neuroshima.log(`Znaleziono aktywny target: ${targetToken.name}, dystans: ${distance}m`);
            } else {
                // Brak celi lub tokena źródłowego - uruchom tryb wyboru na mapie
                game.neuroshima.log("Brak aktywnych targetów, przechodzę do trybu wyboru na mapie");
                await this.minimize();
                
                const targetData = await this._waitForTarget();
                
                await this.maximize();
        
                if (targetData) {
                    distance = targetData.distance;
                    game.neuroshima.log("Otrzymano dane z mapy:", targetData);
                    if (targetData.token) {
                        targetData.token.setTarget(true, { releaseOthers: true });
                    } else {
                        // Jeśli kliknięto w mapę (nie w token), wyczyść stare targety
                        game.user.targets.clear();
                    }
                } else {
                    game.neuroshima.log("Anulowano wybór celu na mapie");
                    this._isRolling = false;
                    return;
                }
            }
        }

        game.neuroshima.log("Otwieranie dialogu rzutu z dystansem:", distance);
        game.neuroshima.groupEnd();

        const dialog = new NeuroshimaWeaponRollDialog({
          actor: this.document,
          weapon: weapon,
          rollType: weapon.system.weaponType === "melee" ? "melee" : "ranged",
          lastRoll: {
              ...lastRoll,
              distance: distance || lastRoll.distance
          },
          onClose: () => { this._isRolling = false; }
        });
        
        await dialog.render(true);
    } catch (err) {
        game.neuroshima.log("Przerwano rzut bronią lub wystąpił błąd:", err.message);
        this._isRolling = false;
        game.neuroshima.groupEnd();
    }
  }

  /**
   * Znajduje najlepszy token reprezentujący aktora na aktualnej scenie.
   * @private
   */
  _getSourceToken() {
    // 1. Jeśli aktor jest powiązany z konkretnym tokenem (unlinked/synthetic)
    if (this.document.token) return this.document.token.object;

    // 2. Pobierz wszystkie tokeny tego aktora na aktualnej scenie
    const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === this.document.id);
    if (tokens.length === 0) return null;
    if (tokens.length === 1) return tokens[0];

    // 3. Priorytet dla tokenów kontrolowanych przez aktualnego użytkownika
    const controlled = tokens.filter(t => t.controlled);
    if (controlled.length > 0) return controlled[0];

    // 4. Jeśli MG ma otwarty arkusz i nic nie kontroluje, bierzemy pierwszy znaleziony
    return tokens[0];
  }

  /**
   * Oczekuje na kliknięcie na token lub punkt na mapie w celu obliczenia dystansu.
   * @private
   */
  async _waitForTarget() {
    const actorToken = this._getSourceToken();
    if (!actorToken) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoActorTokenOnCanvas"));
        return null;
    }

    // Zmiana kursora na celownik dla lepszego feedbacku
    const body = document.body;
    const originalCursor = body.style.cursor;
    body.style.cursor = "crosshair";

    game.neuroshima.log("_waitForTarget: Rozpoczynam przechwytywanie kliknięcia (window capture)");
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.Notifications.SelectTargetOrPoint"));

    return new Promise((resolve) => {
        const onMouseDown = async (event) => {
            // Obsługujemy tylko LPM (0) i PPM (2)
            if (event.button !== 0 && event.button !== 2) return;

            // Blokujemy domyślne akcje i propagację (Foundry nie otworzy arkusza)
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            // Sprzątanie
            window.removeEventListener('mousedown', onMouseDown, true);
            window.removeEventListener('contextmenu', onContextMenu, true);
            body.style.cursor = originalCursor;

            if (event.button === 2) { // PPM = Anulowanie
                game.neuroshima.log("_waitForTarget: Wybór anulowany przez użytkownika");
                resolve(null);
                return;
            }

            // Pobieramy aktualną pozycję myszy w świecie gry bezpośrednio z silnika Foundry (V13)
            // canvas.mousePosition jest automatycznie aktualizowany i przeliczany przez system.
            const worldPos = { x: canvas.mousePosition.x, y: canvas.mousePosition.y };
            game.neuroshima.log("_waitForTarget: Pozycja kliknięcia (world):", worldPos);
            
            // Szukanie tokena pod kursorem
            const clickedToken = canvas.tokens.placeables.find(t => {
                if (!t.visible) return false;
                const b = t.bounds;
                return worldPos.x >= b.x && worldPos.x <= (b.x + b.width) &&
                       worldPos.y >= b.y && worldPos.y <= (b.y + b.height);
            });

            if (clickedToken) {
                game.neuroshima.log(`_waitForTarget: Wybrano token: ${clickedToken.name}. Ustawiam jako target.`);
                // Programowe ustawienie targetu dla użytkownika (V13 compatible)
                clickedToken.setTarget(true, { releaseOthers: true });
                
                const distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, clickedToken);
                game.neuroshima.log(`_waitForTarget: Obliczony dystans do tokena: ${distance}m`);

                resolve({
                    distance,
                    token: clickedToken
                });
            } else {
                game.neuroshima.log("_waitForTarget: Kliknięto w puste miejsce. Obliczam dystans do punktu.");
                // V13: canvas.grid.getCenter zwraca środek komórki siatki dla podanych współrzędnych
                const gridPos = canvas.grid.getCenter(worldPos.x, worldPos.y);
                
                const distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, gridPos);
                game.neuroshima.log(`_waitForTarget: Obliczony dystans do punktu: ${distance}m`);
                
                resolve({
                    distance,
                    point: gridPos
                });
            }
        };

        const onContextMenu = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };

        // Nasłuchujemy na window z capture: true, aby być przed jakimkolwiek innym listenerem
        window.addEventListener('mousedown', onMouseDown, true);
        window.addEventListener('contextmenu', onContextMenu, true);
    });
  }

  /**
   * Handle creating a new Item.
   */
  async _onCreateItem(event, target) {
    // If target is an icon or nested element, find the closest button/action element
    const actionElement = target.closest("[data-action]") || target;
    const type = actionElement.dataset.type;
    let location = actionElement.dataset.location || actionElement.dataset.locationKey;
    
    // Fallback: check if there's a parent location header to get location from
    if (!location && type === "wound") {
      const headerElement = actionElement.closest(".location-wounds-header");
      if (headerElement) {
        location = headerElement.dataset.location;
      }
    }
    
    game.neuroshima?.log("_onCreateItem", { 
      type, 
      location, 
      targetTag: target.tagName,
      actionElementTag: actionElement.tagName,
      target: actionElement.outerHTML.substring(0, 150)
    });
    
    // Default name based on type
    let label = game.i18n.localize(`NEUROSHIMA.Items.Type.${type.charAt(0).toUpperCase() + type.slice(1)}`);
    
    // Special case for Wound creation from the plus button
    if (type === "wound") {
        label = game.i18n.localize("NEUROSHIMA.Items.Type.Wound");
    }

    const itemData = {
      name: label || type,
      type: type,
      system: {}
    };

    if (actionElement.dataset.weaponType) {
      itemData.system.weaponType = actionElement.dataset.weaponType;
    }

    // Pre-fill location if creating wound from extended section
    if (location && type === "wound") {
      itemData.system.location = location;
      game.neuroshima?.log("_onCreateItem setting wound location", { location, itemData });
    }

    // Create the item - _onUpdate hook will handle selective rendering
    return this.document.createEmbeddedDocuments("Item", [itemData]);
  }

  /**
   * Handle configuring max HP for the actor.
   */
  async _onConfigureHP(event, target) {
    const actor = this.document;
    const currentMax = actor.system.hp?.max || 27;
    
    const content = `
      <div class="form-group standard-form" style="padding: 10px;">
        <label>${game.i18n.localize("NEUROSHIMA.Dialog.MaxHP.Label")}</label>
        <div class="form-fields">
          <input type="number" name="maxHP" value="${currentMax}" min="1" style="width: 60px;">
        </div>
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { 
        title: game.i18n.localize("NEUROSHIMA.Dialog.MaxHP.Title"),
        position: { width: 300, height: "auto" }
      },
      content: content,
      buttons: [
        {
          action: "save",
          label: game.i18n.localize("NEUROSHIMA.Actions.Save"),
          default: true,
          callback: (event, button, dialog) => new foundry.applications.ux.FormDataExtended(button.form).object.maxHP
        },
        {
            action: "cancel",
            label: game.i18n.localize("NEUROSHIMA.Actions.Cancel")
        }
      ],
      classes: ["neuroshima", "dialog"]
    });

    if (result) {
      await actor.update({ "system.hp.max": parseInt(result) });
    }
  }

  /**
   * Handle editing an owned Item.
   */
  async _onEditItem(event, target) {
    const li = target.closest(".item");
    const item = this.document.items.get(li.dataset.itemId);
    return item.sheet.render(true);
  }

  /**
   * Handle deleting an owned Item.
   */
  async _onDeleteItem(event, target) {
    const li = target.closest("[data-item-id]");
    const item = this.document.items.get(li.dataset.itemId);
    if (!item) return;
    // _onUpdate hook will handle selective rendering of combat part only
    return item.delete();
  }

  /**
   * Handle toggling the equipped state of an owned Item.
   */
  async _onToggleEquipped(event, target) {
    const li = target.closest(".item");
    const item = this.document.items.get(li.dataset.itemId);
    if (!item || !("equipped" in item.system)) return;
    return item.update({ "system.equipped": !item.system.equipped });
  }

  /**
   * Handle changing the quantity of an owned Item.
   */
  async _onAdjustQuantity(event, target) {
    const direction = event.button === 2 ? -1 : 1;
    return this._onQuantityChange(event, target, direction);
  }

  async _onQuantityChange(event, target, direction) {
    const li = target.closest(".item");
    const item = this.document.items.get(li.dataset.itemId);
    if (!item || !("quantity" in item.system)) return;

    let amount = 1;
    if (event.ctrlKey || event.metaKey) amount = 100;
    else if (event.shiftKey) amount = 10;

    const newQuantity = Math.max(0, item.system.quantity + (amount * direction));
    return item.update({ "system.quantity": newQuantity });
  }

  /**
   * Organize skills into a structure easy to render in the template.
   */
  _prepareSkillGroups() {
    const groups = {};
    const skillConfig = NEUROSHIMA.skillConfiguration;
    const system = this.document.system;

    for (const [attrKey, specializations] of Object.entries(skillConfig)) {
      const attrConfig = NEUROSHIMA.attributes[attrKey];
      groups[attrKey] = {
        label: attrConfig.label,
        abbr: attrConfig.abbr,
        specializations: {}
      };

      for (const [specKey, skills] of Object.entries(specializations)) {
        groups[attrKey].specializations[specKey] = {
          label: `NEUROSHIMA.Specializations.${specKey}`,
          owned: system.specializations[specKey],
          skills: skills.map(skillKey => ({
            key: skillKey,
            label: `NEUROSHIMA.Skills.${skillKey}`,
            value: system.skills[skillKey].value,
            customLabel: system.skills[skillKey].label,
            isKnowledge: skillKey.startsWith("knowledge")
          }))
        };
      }
    }
    return groups;
  }

  /**
   * Pokaż kartę pacjenta na czacie.
   */
  async _onShowPatientCard(event) {
    event.preventDefault();
    game.neuroshima.log("Wyświetlanie karty pacjenta dla:", this.actor.name);
    
    await game.neuroshima.NeuroshimaChatMessage.renderPatientCard(this.actor);
  }

  /**
   * Poproś medyka o leczenie - zachowanie zależy od ustawienia patientCardVersion
   * - "simple": pokaż zwykłą kartę pacjenta
   * - "extended": pokaż dialog wyboru medyka i wyślij prośbę o leczenie
   */
  async _onRequestHealing(event) {
    event.preventDefault();
    game.neuroshima.log("Prosimy o leczenie dla:", this.actor.name);

    // Sprawdź wersję karty pacjenta
    const patientCardVersion = game.settings.get("neuroshima", "patientCardVersion");
    
    game.neuroshima.log("Wersja karty pacjenta:", { version: patientCardVersion });

    // Wersja uproszczona - pokaż kartę pacjenta bez prośby
    if (patientCardVersion === "simple") {
      game.neuroshima.log("Wyświetlanie uproszczonej karty pacjenta (bez prośby do medyka)");
      await game.neuroshima.NeuroshimaChatMessage.renderPatientCard(this.actor);
      ui.notifications.info(game.i18n.localize("NEUROSHIMA.PatientCard.ShowPatientCard"));
      return;
    }

    // Wersja rozszerzona - pokaż dialog i wyślij prośbę
    game.neuroshima.log("Wersja rozszerzona: wyświetlanie dialoga wyboru medyka");

    // Pobierz lista aktywnych userów (oprócz siebie)
    const activeUsers = game.users.filter(u => 
      u.active && u.id !== game.user.id
    );

    if (activeUsers.length === 0) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.HealingRequest.NoMedicsAvailable"));
      return;
    }

    // Stwórz dialog wyboru medyka (DialogV2)
    const medicChoices = {};
    for (const user of activeUsers) {
      medicChoices[user.id] = user.name;
    }

    const content = `
      <form class="neuroshima medic-selection-dialog">
        <div class="form-group">
          <label for="medic-select">${game.i18n.localize("NEUROSHIMA.HealingRequest.ChooseMedic")}:</label>
          <select id="medic-select" name="medicId">
            ${Object.entries(medicChoices).map(([id, name]) => 
              `<option value="${id}">${name}</option>`
            ).join("")}
          </select>
        </div>
      </form>
    `;

    const medicUserId = await foundry.applications.api.DialogV2.wait({
      window: {
        title: game.i18n.localize("NEUROSHIMA.HealingRequest.SelectMedic"),
        classes: ["neuroshima", "medic-selection"]
      },
      content: content,
      buttons: [
        {
          action: "confirm",
          label: game.i18n.localize("NEUROSHIMA.HealingRequest.SendRequest"),
          default: true,
          icon: "fas fa-check",
          callback: (event) => {
            const form = event.target.closest("form");
            return form.querySelector("#medic-select").value;
          }
        },
        {
          action: "cancel",
          label: game.i18n.localize("NEUROSHIMA.Dialog.Cancel"),
          icon: "fas fa-times",
          callback: () => null
        }
      ]
    });

    if (!medicUserId) {
      game.neuroshima.log("Anulowano wysyłanie prośby o leczenie");
      return;
    }

    const medicUser = game.users.get(medicUserId);
    if (!medicUser) {
      ui.notifications.error(game.i18n.localize("NEUROSHIMA.HealingRequest.MedicNotFound"));
      return;
    }

    try {
      game.neuroshima.log("Wysyłanie prośby o leczenie", {
        pacjent: this.actor.name,
        medyk: medicUser.name
      });

      // Renderuj kartę prośby o leczenie
      await game.neuroshima.NeuroshimaChatMessage.renderHealingRequest(
        this.actor,
        medicUserId,
        game.user.id
      );

      ui.notifications.info(game.i18n.format("NEUROSHIMA.HealingRequest.RequestSent", {
        medic: medicUser.name
      }));
    } catch (err) {
      game.neuroshima.log("Błąd podczas wysyłania prośby:", err);
      ui.notifications.error(game.i18n.localize("NEUROSHIMA.HealingRequest.HealingFailed"));
    }
  }

  /**
   * Toggle the layout of the combat tab (top-row vs wounds-section order).
   */
  async _onToggleCombatLayout(event, target) {
    event.preventDefault();
    const actor = this.document;
    const current = actor.getFlag("neuroshima", "woundsFirst") || false;
    await actor.setFlag("neuroshima", "woundsFirst", !current);
    await this.render();
  }

  /**
   * Handle paper doll location selection in extended healing panel
   */
  _onPaperDollLocationSelect(event, hotspot) {
    const locationKey = hotspot.dataset.location;
    
    game.neuroshima?.log("_onPaperDollLocationSelect visually marking hotspot", { locationKey });
    
    // Remove selected class from all hotspots in the diagram
    this.element.querySelectorAll('.body-location-hotspot').forEach(hs => {
      hs.classList.remove('selected');
    });
    
    // Add selected class to the current hotspot
    hotspot.classList.add('selected');
    
    game.neuroshima?.log("Paper doll location selected visually", { location: locationKey });
  }

  /**
   * Prepare the tabs configuration for the sheet.
   */
  _getTabs() {
    const activeTab = this.tabGroups.primary;
    const tabs = foundry.utils.deepClone(this.constructor.TABS.primary.tabs).reduce((obj, t) => {
      obj[t.id] = t;
      return obj;
    }, {});

    for (const v of Object.values(tabs)) {
      v.active = activeTab === v.id;
      v.cssClass = v.active ? "active" : "";
    }
    return tabs;
  }
}
