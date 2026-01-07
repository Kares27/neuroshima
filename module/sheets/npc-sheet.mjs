import {onManageActiveEffect, prepareActiveEffectCategories} from "../helpers/effects.mjs";
import { NeuroshimaActorSheet } from "./actor-sheet.mjs";
import { escapeHtml, getDamageTypeName, shouldDebug } from "../helpers/utils.mjs";

/**
 * Rozszerza arkusz postaci Character Sheet dla typu NPC.
 * Dziedziczy całą logikę walki z NeuroshimaActorSheet (karty postaci).
 * Główna różnica: NPC Sheet nie zawiera sekcji doświadczenia.
 * Wszystkie metody rzutów (atrybut, umiejętność, broń) są dziedziczone.
 * 
 * @extends {NeuroshimaActorSheet}
 */
export class NeuroshimaNPCSheet extends NeuroshimaActorSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["neuroshima", "sheet", "actor", "npc"],
      template: "systems/neuroshima/templates/actor/actor-npc-sheet.hbs",
      width: 900,
      height: 800,
      minWidth: 900,
      minHeight: 800,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "attributes" }]
    });
  }

  /** @override */
  get template() {
    return `systems/neuroshima/templates/actor/actor-npc-sheet.hbs`;
  }

  /* -------------------------------------------- */

  /** @override */
  async _render(force, options) {
    // Save scroll positions before rendering
    const scrollPositions = {};
    if (this.element && this.element.length) {
      const scrollableElements = this.element.find('.tab[data-tab]');
      scrollableElements.each((i, el) => {
        const tabName = el.dataset.tab;
        scrollPositions[tabName] = el.scrollTop;
      });
    }

    // Perform the render
    await super._render(force, options);

    // Restore scroll positions after rendering
    if (Object.keys(scrollPositions).length > 0) {
      const scrollableElements = this.element.find('.tab[data-tab]');
      scrollableElements.each((i, el) => {
        const tabName = el.dataset.tab;
        if (scrollPositions[tabName] !== undefined) {
          el.scrollTop = scrollPositions[tabName];
        }
      });
    }
  }

  /* -------------------------------------------- */

  /** 
   * Przygotowuje dane kontekstu dla szablonu arkusza NPC.
   * Mapuje dane aktora, inicjalizuje zdolności i efekty.
   * @override 
   */
  async getData() {
    const context = await ActorSheet.prototype.getData.call(this);
    const actorData = this.document.toObject(false);

    context.actor = this.actor;
    context.system = actorData.system;
    context.flags = actorData.flags;
    
    if (!context.system.health) {
      context.system.health = { value: 0, max: 27 };
    }

    context.items = this.actor.items.map(item => item.toObject(false));

    this._prepareItems(context);
    await this._prepareNPCData(context);

    context.rollData = this.actor.getRollData();
    context.effects = prepareActiveEffectCategories(this.actor.effects);
    context.config = CONFIG.NEUROSHIMA;
    context.collapsedSections = this.actor.getFlag('neuroshima', 'collapsedSections') || {};

    if (shouldDebug()) console.log('Neuroshima NPC: Context before return:', {
      hasWeapons: !!context.weapons,
      hasArmor: !!context.armor,
      weaponsLength: context.weapons?.length,
      armorLength: context.armor?.length
    });

    return context;
  }

  /**
   * Przygotowuje dane specificzne dla NPC - mapuje nazwy współczynników
   * i inicjalizuje wartości domyślne.
   * @param {Object} context - Kontekst szablonu
   * @private
   */
  async _prepareNPCData(context) {
    for (let [k, v] of Object.entries(context.system.attributes)) {
      v.label = game.i18n.localize(CONFIG.NEUROSHIMA.attributes[k]) ?? k;
    }
    
    // Calculate total armor from equipped items
    await this._calculateTotalArmor(context);
  }

  /**
   * Calculate total armor protection from equipped items
   * @param {Object} context
   * @private
   */
  async _calculateTotalArmor(context) {
    const equippedArmor = context.items.filter(item => 
      item.type === 'armor' && item.system.equipable
    );
    
    if (shouldDebug()) console.log('Neuroshima: Calculating armor from equipped items:', equippedArmor.length);
    
    let totalArmor = {
      head: 0,
      torso: 0,
      leftHand: 0,
      rightHand: 0,
      leftLeg: 0,
      rightLeg: 0
    };
    
    equippedArmor.forEach(armor => {
      if (armor.system.protection) {
        if (shouldDebug()) console.log(`Neuroshima: Adding armor ${armor.name}:`, armor.system.protection);
        const damageAP = armor.system.damageAP || {};
        
        // Calculate current AP (max - damage) for each location
        totalArmor.head += Math.max(0, (armor.system.protection.head || 0) - (damageAP.head || 0));
        totalArmor.torso += Math.max(0, (armor.system.protection.torso || 0) - (damageAP.torso || 0));
        totalArmor.leftHand += Math.max(0, (armor.system.protection.leftHand || 0) - (damageAP.leftHand || 0));
        totalArmor.rightHand += Math.max(0, (armor.system.protection.rightHand || 0) - (damageAP.rightHand || 0));
        totalArmor.leftLeg += Math.max(0, (armor.system.protection.leftLeg || 0) - (damageAP.leftLeg || 0));
        totalArmor.rightLeg += Math.max(0, (armor.system.protection.rightLeg || 0) - (damageAP.rightLeg || 0));
      }
    });
    
    if (shouldDebug()) console.log('Neuroshima: Total armor calculated:', totalArmor);
    
    // Update context armor values immediately for rendering
    context.system.armor = totalArmor;
    
    // Also update actor's armor values if they have changed
    const currentArmor = this.actor.system.armor;
    if (currentArmor.head !== totalArmor.head || 
        currentArmor.torso !== totalArmor.torso ||
        currentArmor.leftHand !== totalArmor.leftHand || 
        currentArmor.rightHand !== totalArmor.rightHand ||
        currentArmor.leftLeg !== totalArmor.leftLeg ||
        currentArmor.rightLeg !== totalArmor.rightLeg) {
      
      if (shouldDebug()) console.log('Neuroshima: Updating actor armor values from', currentArmor, 'to', totalArmor);
      
      // Update the armor values (this will be saved automatically)
      await this.actor.update({
        "system.armor.head": totalArmor.head,
        "system.armor.torso": totalArmor.torso,
        "system.armor.leftHand": totalArmor.leftHand,
        "system.armor.rightHand": totalArmor.rightHand,
        "system.armor.leftLeg": totalArmor.leftLeg,
        "system.armor.rightLeg": totalArmor.rightLeg
      });
      
      // Also update local actor system to ensure synchronization
      this.actor.system.armor = totalArmor;
      if (shouldDebug()) console.log('Neuroshima: Actor system armor updated:', this.actor.system.armor);
    }
  }

  /**
   * Organizuje i klasyfikuje przedmioty aktora dla wyświetlenia na arkuszu NPC.
   * Dzieli przedmioty na kategorie (broń, amunicję, pancerz, ekwipunek, obrażenia)
   * i wybiera wyposażone przedmioty. 
   * Przygotowuje również dostępne dane amunicji dla uzbrojonych broni dystansowych.
   * Dodaje helper funkcje do kontekstu szablonu.
   *
   * @param {Object} context - Kontekst szablonu z listą przedmiotów
   * @private
   */
  _prepareItems(context) {
    const weapons = [];
    const ammunition = [];
    const armor = [];
    const equipment = [];
    const wounds = [];
    
    const equippedWeapons = [];
    const equippedArmor = [];

    for (let i of context.items) {
      i.img = i.img || DEFAULT_TOKEN;
      
      // Classify by type
      if (i.type === 'weapon-melee' || i.type === 'weapon-ranged' || i.type === 'weapon-thrown') {
        weapons.push(i);
        if (i.system.equipable) {
          equippedWeapons.push(i);
        }
      }
      else if (i.type === 'ammunition') {
        ammunition.push(i);
      }
      else if (i.type === 'armor') {
        armor.push(i);
        if (i.system.equipable) {
          if (shouldDebug()) console.log('Neuroshima: Found equipped armor:', i.name, 'equipable:', i.system.equipable, 'protection:', i.system.protection);
          equippedArmor.push(i);
        }
      }
      else if (i.type === 'equipment') {
        equipment.push(i);
      }
      else if (i.type === 'wounds') {
        wounds.push(i);
      }
    }

    // Assign and return
    context.weapons = weapons;
    context.ammunition = ammunition;
    context.armor = armor;
    context.equipment = equipment;
    context.wounds = wounds;
    context.equippedWeapons = equippedWeapons;
    context.equippedArmor = equippedArmor;
    
    if (shouldDebug()) console.log('Neuroshima NPC: Context after _prepareItems:', {
      weapons: weapons.length,
      armor: armor.length,
      equipment: equipment.length,
      wounds: wounds.length
    });
    
    // Add available ammunition for each equipped weapon
    context.equippedWeapons.forEach(weapon => {
      if (weapon.type === 'weapon-ranged') {
        weapon.availableAmmo = ammunition;
        
        // Add selected ammo details for display
        if (weapon.system.selectedAmmo) {
          const selectedAmmo = ammunition.find(a => a._id === weapon.system.selectedAmmo);
          if (selectedAmmo) {
            weapon.selectedAmmoData = {
              name: selectedAmmo.name,
              current: selectedAmmo.system.ammo.value,
              max: selectedAmmo.system.ammo.max
            };
          }
        }
      }
    });
    
    if (shouldDebug()) console.log('Neuroshima: Total armor items:', armor.length, 'Equipped armor:', equippedArmor.length);
    
    // Add helper functions to context
    context.getTotalWoundPenalty = this._getTotalWoundPenalty();
    context.getCurrentHealthValue = this._getCurrentHealthValue();
    context.getTotalArmorPenalty = this._getTotalArmorPenalty();
    context.getAmmoName = this._getAmmoName.bind(this);
  }

  /* -------------------------------------------- */

  /** 
   * Aktywuje event listenery dla interakcji użytkownika na arkuszu.
   * Tylko NPC-specific listenery. Pozostałe są dziedziczone z parent klasy.
   * @override 
   */
  activateListeners(html) {
    super.activateListeners(html);
    this._updateSpecializationDisplay(html);
    this._restoreCollapsedSections(html);

    // Section collapse toggle (NPC-specific)
    html.find('.section-collapse-toggle').click(this._onSectionCollapseToggle.bind(this));

    // Open item sheet when clicking on collapsed icon (NPC-specific)
    html.find('.item-icon-collapsed').click(ev => {
      const itemId = $(ev.currentTarget).data("itemId");
      const item = this.actor.items.get(itemId);
      if (item) {
        item.sheet.render(true);
      }
    });

    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;
  }

  /**
   * Handle creating a new Owned Item for the actor.
   * NPC Sheet only needs custom handling for wounds.
   * @override
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    const type = header.dataset.type;
    
    // Special handling for wounds - show creation dialog
    if (type === 'wounds') {
      return this._showWoundCreationDialog();
    }
    
    // Delegate to parent for standard item creation
    return super._onItemCreate(event);
  }

  /**
   * Wyświetla dialog tworzenia obrażenia z wyborem lokalizacji, typu i kary.
   * Zsynchronizowany z Character Sheet.
   * 
   * @private
   */
  async _showWoundCreationDialog() {
    const template = "systems/neuroshima/templates/dialog/wound-creation-dialog.hbs";
    const html = await renderTemplate(template, {
      damageTypes: CONFIG.NEUROSHIMA.damageTypes,
      woundLocations: CONFIG.NEUROSHIMA.woundLocations
    });
    
    return new Promise(resolve => {
      new Dialog({
        title: "Dodaj obrażenie", 
        content: html,
        buttons: {
          create: {
            icon: '<i class="fas fa-check"></i>',
            label: "Stwórz",
            callback: async html => {
              const form = html[0].querySelector("form");
              const fd = new FormDataExtended(form);
              const data = fd.object;
              
              const count = parseInt(data.count) || 1;
              
              const items = [];
              for (let i = 0; i < count; i++) {
                const itemData = {
                  name: data.name || "Nowe obrażenie",
                  type: "wounds",
                  system: {
                    location: data.location,
                    type: data.type,
                    penalty: parseInt(data.penalty) || 0,
                    active: true
                  }
                };
                items.push(itemData);
              }
              
              const createdItems = await Item.createDocuments(items, {parent: this.actor, skipAutoChat: true});
              
              // If multiple wounds, wait for all resistance tests and send consolidated message
              if (count > 1) {
                const createdWoundIds = createdItems.map(w => w._id);
                
                // Wait for all resistance tests to complete
                await new Promise(resolve => {
                  const checkInterval = setInterval(() => {
                    const allTested = createdWoundIds.every(id => {
                      const wound = this.actor.items.get(id);
                      return wound?.system?.resistanceTest?.performed;
                    });
                    if (allTested) {
                      clearInterval(checkInterval);
                      resolve();
                    }
                  }, 50);
                  setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve();
                  }, 3000);
                });
                
                // Collect test results and count passed/failed
                const allTestResults = [];
                let passedCount = 0;
                let failedCount = 0;
                
                createdWoundIds.forEach(id => {
                  const wound = this.actor.items.get(id);
                  const flags = wound.flags?.neuroshima?.resistanceTestResult;
                  if (flags) {
                    const woundTypeName = CONFIG.NEUROSHIMA.damageTypes[flags.woundType]?.name || flags.woundType;
                    const location = wound.system?.location || '';
                    const locationName = CONFIG.NEUROSHIMA.woundLocations?.[location] || location;
                    const diceStr = flags.diceRaw.join(',');
                    const reducedStr = flags.diceReduced.join(',');
                    
                    allTestResults.push({
                      type: woundTypeName,
                      location: locationName,
                      passed: flags.passed,
                      diceRaw: diceStr,
                      diceReduced: reducedStr,
                      successes: flags.successes
                    });
                    
                    if (flags.passed) passedCount++;
                    else failedCount++;
                  }
                });
                
                // Build tooltip content for test results (as HTML)
                let passedTooltipContent = '<div class="wound-tooltip-content">';
                let failedTooltipContent = '<div class="wound-tooltip-content">';
                
                allTestResults.forEach(result => {
                  const tooltipRow = `<div class="tooltip-row">
                    <strong>${result.type} - ${result.location}</strong>
                    <div>[${result.diceRaw}] → [${result.diceReduced}] ${result.successes}/3</div>
                  </div>`;
                  
                  if (result.passed) {
                    passedTooltipContent += tooltipRow;
                  } else {
                    failedTooltipContent += tooltipRow;
                  }
                });
                
                passedTooltipContent += '</div>';
                failedTooltipContent += '</div>';
                
                // Send consolidated chat notification with test summary
                const speaker = ChatMessage.getSpeaker({ actor: this.actor });
                const damageTypeName = getDamageTypeName(data.type);
                let content = `<div class="wound-notification">
                  <p class="wound-notification-title"><strong>${this.actor.name}</strong> otrzymał ${count} obrażenie(ń) typu <strong>${damageTypeName}</strong></p>`;
                
                if (passedCount > 0) {
                  content += `<div class="wound-test-result passed">
                    <div class="test-result-header wound-test-tooltip-trigger passed-tooltip" data-tooltip-content="${escapeHtml(passedTooltipContent)}">
                      <span class="test-count">${passedCount}</span>
                      <span class="test-label">Zdanych</span>
                    </div>
                  </div>`;
                }
                
                if (failedCount > 0) {
                  content += `<div class="wound-test-result failed">
                    <div class="test-result-header wound-test-tooltip-trigger failed-tooltip" data-tooltip-content="${escapeHtml(failedTooltipContent)}">
                      <span class="test-count">${failedCount}</span>
                      <span class="test-label">Niezdanych</span>
                    </div>
                  </div>`;
                }
                
                content += `</div>`;
                
                await ChatMessage.create({
                  speaker: speaker,
                  content: content,
                  type: CONST.CHAT_MESSAGE_TYPES.OOC
                });
              } else if (count === 1) {
                // For single wound, let the item's _onCreate handle the chat message
                // Just wait for the test to complete
                const woundId = createdItems[0]._id;
                await new Promise(resolve => {
                  const checkInterval = setInterval(() => {
                    const wound = this.actor.items.get(woundId);
                    if (wound?.system?.resistanceTest?.performed) {
                      clearInterval(checkInterval);
                      resolve();
                    }
                  }, 50);
                  setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve();
                  }, 3000);
                });
              }
              
              resolve(createdItems);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Anuluj",
            callback: () => resolve(null)
          }
        },
        default: "create"
      }).render(true);
    });
  }

  /**
   * Przełącza widok obrażeń (pełny/zwinięty).
   * @param {Event} event - Zdarzenie kliknięcia
   * @private
   */
  async _onSectionCollapseToggle(event) {
    event.preventDefault();
    const sectionName = $(event.currentTarget).data("section");
    
    const collapsedSections = await this.actor.getFlag('neuroshima', 'collapsedSections') || {};
    collapsedSections[sectionName] = !collapsedSections[sectionName];
    
    await this.actor.setFlag('neuroshima', 'collapsedSections', collapsedSections);
    this.render(false);
  }

  /**
   * Przywraca stan sekcji (zwinięte/rozwinięte) z flagi aktora.
   * @param {jQuery} html - Element arkusza
   * @private
   */
  async _restoreCollapsedSections(html) {
    const collapsedSections = await this.actor.getFlag('neuroshima', 'collapsedSections') || {};
    
    for (const [sectionName, isCollapsed] of Object.entries(collapsedSections)) {
      if (isCollapsed) {
        const section = html.find(`[data-section="${sectionName}"]`);
        if (section) {
          section.closest('.section').find('.section-content').hide();
          section.find('i').removeClass('fa-chevron-down').addClass('fa-chevron-right');
        }
      }
    }
  }

  /**
   * Przełącza wyświetlanie specjalizacji dla umiejętności.
   * @param {jQuery} html - Element arkusza
   * @private
   */
  _updateSpecializationDisplay(html) {
    html.find('.skill-entry').each((i, element) => {
      const hasSpecializations = $(element).find('.specialization').length > 0;
      $(element).find('.category-button').toggle(hasSpecializations);
    });
  }

  /**
   * Oblicza całkowitą karę z aktywnych obrażeń.
   * Używane w szablonach do wyświetlania kary w dialogach rzutów.
   * @returns {number} Całkowita kara z obrażeń
   * @private
   */
  _getTotalWoundPenalty() {
    let totalPenalty = 0;
    const woundItems = this.actor.items.filter(i => i.type === 'wounds');
    woundItems.forEach(wound => {
      if (wound.system.active && wound.system.penalty) {
        totalPenalty += parseInt(wound.system.penalty) || 0;
      }
    });
    return totalPenalty;
  }

  /**
   * Oblicza aktualną wartość zdrowia (różnica między max a aktualnym).
   * Używane w szablonach do wyświetlania paska zdrowia.
   * @returns {function} Funkcja zwracająca wartość zdrowia
   * @private
   */
  _getCurrentHealthValue() {
    let totalDamage = 0;
    
    const woundItems = this.actor.items.filter(i => i.type === 'wounds');
    woundItems.forEach(wound => {
      if (wound.system.active) {
        const damageType = CONFIG.NEUROSHIMA.damageTypes[wound.system.type];
        const points = damageType ? damageType.points : 0;
        totalDamage += points;
      }
    });
    
    return totalDamage;
  }

  /**
   * Oblicza całkowitą karę z wyposażonego pancerza.
   * Używane w szablonach do wyświetlania kary w dialogach rzutów.
   * @returns {number} Całkowita kara z pancerza
   * @private
   */
  _getTotalArmorPenalty() {
    const equippedArmor = this.actor.items.filter(item => 
      item.type === 'armor' && item.system.equipable
    );
    
    let totalPenalty = 0;
    equippedArmor.forEach(armor => {
      if (armor.system.penalty) {
        totalPenalty += parseInt(armor.system.penalty) || 0;
      }
    });
    
    return totalPenalty;
  }

  /**
   * Wyszukuje nazwę amunicji po ID przedmiotu.
   * Używane w interfejsie do wyświetlania nazwy wybranej amunicji.
   * @param {string} ammoId - ID przedmiotu amunicji
   * @returns {string} Nazwa amunicji lub pusty string
   * @private
   */
  _getAmmoName(ammoId) {
    const ammoItem = this.actor.items.get(ammoId);
    return ammoItem ? ammoItem.name : '';
  }

  /**
   * Called on any click to close open events, like the item-menu
   * @private
   */
  _onCloseEvent(event) {
    event.preventDefault();
    let li = $(event.currentTarget).parents(".open");
    li.slideUp(200, () => this.render(false));
  }
}
