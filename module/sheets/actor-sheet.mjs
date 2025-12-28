import {onManageActiveEffect, prepareActiveEffectCategories} from "../helpers/effects.mjs";
import { createDamageData, createDamageChatMessage } from "../helpers/combat-utils.mjs";

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class NeuroshimaActorSheet extends ActorSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["neuroshima", "sheet", "actor"],
      template: "systems/neuroshima/templates/actor/actor-character-sheet.hbs",
      width: 900,
      height: 800,
      minWidth: 900,
      minHeight: 800,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "attributes" }]
    });
  }

  /** @override */
  get template() {
    return `systems/neuroshima/templates/actor/actor-${this.actor.type}-sheet.hbs`;
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

  /** @override */
  async getData() {
    // Retrieve the data structure from the base sheet. You can inspect or log
    // the context variable to see the structure, but some key properties for
    // sheets are the actor object, the data object, whether or not it's
    // editable, the items array, and the effects array.
    const context = super.getData();

    // Use a safe clone of the actor data for further operations.
    const actorData = this.document.toObject(false);

    // Add the actor's data to context.data for easier access, as well as flags.
    context.system = actorData.system;
    context.flags = actorData.flags;
    
    // Ensure health is properly initialized in context
    if (!context.system.health) {
      context.system.health = { value: 0, max: 27 };
    }

    // Prepare character data and items.
    if (actorData.type == 'character') {
      this._prepareItems(context);
      await this._prepareCharacterData(context);
    }

    // Add roll data for TinyMCE editors.
    context.rollData = context.actor.getRollData();

    // Prepare active effects
    context.effects = prepareActiveEffectCategories(this.actor.effects);

    // Dodaj konfigurację systemu
    context.config = CONFIG.NEUROSHIMA;

    // Dodaj stan collapse dla sekcji ekwipunku
    context.collapsedSections = this.actor.getFlag('neuroshima', 'collapsedSections') || {};

    return context;
  }

  /**
   * Organize and classify Items for Character sheets.
   *
   * @param {Object} actorData The actor to prepare.
   *
   * @return {undefined}
   */
  async _prepareCharacterData(context) {
    // Handle ability scores.
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
    
    console.log('Neuroshima: Calculating armor from equipped items:', equippedArmor.length);
    
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
        console.log(`Neuroshima: Adding armor ${armor.name}:`, armor.system.protection);
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
    
    console.log('Neuroshima: Total armor calculated:', totalArmor);
    
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
      
      console.log('Neuroshima: Updating actor armor values from', currentArmor, 'to', totalArmor);
      
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
      console.log('Neuroshima: Actor system armor updated:', this.actor.system.armor);
    }
  }

  /**
   * Organize and classify Items for Character sheets.
   *
   * @param {Object} actorData The actor to prepare.
   *
   * @return {undefined}
   */
  _prepareItems(context) {
    // Initialize containers.
    const weapons = [];
    const ammunition = [];
    const armor = [];
    const equipment = [];
    const wounds = [];
    
    // Equipment containers
    const equippedWeapons = [];
    const equippedArmor = [];

    // Iterate through items, allocating to containers
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
          console.log('Neuroshima: Found equipped armor:', i.name, 'equipable:', i.system.equipable, 'protection:', i.system.protection);
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
    
    console.log('Neuroshima: Total armor items:', armor.length, 'Equipped armor:', equippedArmor.length);
    
    // Add helper functions to context
    context.getTotalWoundPenalty = this._getTotalWoundPenalty();
    context.getCurrentHealthValue = this._getCurrentHealthValue();
    context.getTotalArmorPenalty = this._getTotalArmorPenalty();
    context.getAmmoName = this._getAmmoName.bind(this);

  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Aktualizuj wyświetlanie specjalizacji
    this._updateSpecializationDisplay(html);

    // Restore collapsed sections state
    this._restoreCollapsedSections(html);

    // Section collapse toggle
    html.find('.section-collapse-toggle').click(this._onSectionCollapseToggle.bind(this));

    // Open item sheet when clicking on collapsed icon
    html.find('.item-icon-collapsed').click(ev => {
      const itemId = $(ev.currentTarget).data("itemId");
      const item = this.actor.items.get(itemId);
      if (item) {
        item.sheet.render(true);
      }
    });

    // Render the item sheet for viewing/editing prior to the editable check (only for equipment items, not tricks)
    html.find('.item .item-edit').click(ev => {
      const li = $(ev.currentTarget).parents(".item");
      const item = this.actor.items.get(li.data("itemId"));
      item.sheet.render(true);
    });

    // Open item sheet when clicking on item name
    html.find('.item-name').click(ev => {
      const li = $(ev.currentTarget).parents(".item");
      const item = this.actor.items.get(li.data("itemId"));
      if (item) {
        item.sheet.render(true);
      }
    });

    // Open item sheet when clicking on armor name
    html.find('.armor-name-tiny').click(ev => {
      const armorRow = $(ev.currentTarget).closest(".armor-item-row");
      const itemId = armorRow.data("itemId");
      const item = this.actor.items.get(itemId);
      if (item) {
        item.sheet.render(true);
      }
    });

    // Open item sheet when clicking on wound name
    html.find('.wound-name').click(ev => {
      const woundEntry = $(ev.currentTarget).closest(".wound-entry");
      const itemId = woundEntry.data("itemId");
      const item = this.actor.items.get(itemId);
      if (item) {
        item.sheet.render(true);
      }
    });

    // Roll attack when clicking on weapon name in Combat tab
    html.find('.weapon-name-rollable').click(ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const weaponItem = $(ev.currentTarget).closest(".weapon-item-clickable");
      const itemId = weaponItem.data("itemId");
      const fakeEvent = {
        preventDefault: () => {},
        currentTarget: { dataset: { itemId: itemId } }
      };
      this._onRollAttack(fakeEvent);
    });

    // Open weapon sheet when clicking edit icon in Combat tab
    html.find('.weapon-edit-icon').click(ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const itemId = $(ev.currentTarget).data("itemId");
      const item = this.actor.items.get(itemId);
      if (item) {
        item.sheet.render(true);
      }
    });

    // Prevent click propagation on weapon stats column to avoid conflicts
    html.find('.weapon-stats-column').on('click', (ev) => {
      // Only stop propagation if clicking on the stats column itself or its children (except weapon name)
      if (!$(ev.target).closest('.weapon-name-rollable').length) {
        ev.stopPropagation();
      }
    });

    // Prevent click propagation on weapon edit column to avoid conflicts
    html.find('.weapon-edit-column').on('click', (ev) => {
      ev.stopPropagation();
    });

    // -------------------------------------------------------------
    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    // Add Inventory Item
    html.find('.item-create').click(this._onItemCreate.bind(this));

    // Add Weapon with type selection dialog
    html.find('.item-create-weapon').click(this._onWeaponCreate.bind(this));

    // Delete Inventory Item (only for equipment items, not tricks)
    html.find('.item .item-delete').click(ev => {
      const li = $(ev.currentTarget).parents(".item");
      const item = this.actor.items.get(li.data("itemId"));
      item.delete();
      li.slideUp(200, () => this.render(false));
    });

    // Trick management
    html.find('.trick-create').click(this._onTrickCreate.bind(this));
    html.find('.trick-item .item-edit').click(this._onTrickEdit.bind(this));
    html.find('.trick-item .item-delete').click(this._onTrickDelete.bind(this));
    html.find('.trick-name.rollable').click(this._onTrickToggle.bind(this));

    // Active Effect management
    html.find(".effect-control").click(ev => onManageActiveEffect(ev, this.actor));

    // Wound active toggle icon
    html.find('.wound-active-toggle').click(this._onWoundActiveToggle.bind(this));

    // Wound healing toggle icon
    html.find('.wound-healing-toggle').click(this._onWoundHealingToggle.bind(this));

    // Equipment checkboxes (armor and weapons) - now using Font Awesome icons
    html.find('.item-equipped i[data-action="toggle-equipped"]').click(this._onEquipmentToggle.bind(this));

    // Item quantity modification - left/right click with optional Ctrl
    html.find('.item-quantity[data-action="modify-quantity"]').on('click contextmenu', this._onModifyQuantity.bind(this));

    // Rollable abilities.
    html.find('.rollable').click(this._onRoll.bind(this));

    // Testy atrybutów z nowego szablonu
    html.find('.attribute-button').click(this._onAttributeRoll.bind(this));
    html.find('.attribute-roll').click(this._onAttributeRoll.bind(this));

    // Testy umiejętności z nowego szablonu
    html.find('.skill-button').click(this._onSkillRoll.bind(this));
    html.find('.skill-roll').click(this._onSkillRoll.bind(this));

    // Przełączanie specjalizacji z nowego szablonu
    html.find('.category-button').click(this._onSpecializationToggle.bind(this));
    html.find('.specialization-toggle').click(this._onSpecializationToggle.bind(this));

    // Combat actions - armor damage tracking only (weapon controls removed)
    
    // Armor damage tracking - left click repairs, right click damages
    html.find('[data-action="modify-ap"]').on('click contextmenu', this._onModifyAP.bind(this));
    html.find('[data-action="modify-durability"]').on('click contextmenu', this._onModifyDurability.bind(this));

    // Drag events for items - enable dragging for both li.item and div.item
    if (this.actor.isOwner) {
      // Support both li.item and div.item for dragging
      html.find('.item').each((i, element) => {
        if (element.classList.contains("inventory-header")) return;
        // Skip if it doesn't have data-item-id (not an actual item)
        if (!element.dataset.itemId) return;
        element.setAttribute("draggable", true);
        element.addEventListener("dragstart", this._onDragStart.bind(this), false);
      });
    }
  }

  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    // Get the type of item to create.
    const type = header.dataset.type;
    
    // Special handling for wounds - show creation dialog
    if (type === 'wounds') {
      return this._showWoundCreationDialog();
    }
    
    // Standard item creation for other types
    const data = duplicate(header.dataset);
    const name = `New ${type.capitalize()}`;
    const itemData = {
      name: name,
      type: type,
      system: data
    };
    delete itemData.system["type"];

    return await Item.create(itemData, {parent: this.actor});
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  _onRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;

    // Handle item rolls.
    if (dataset.rollType) {
      if (dataset.rollType == 'item') {
        const itemId = element.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (item) return item.roll();
      }
    }

    // Handle rolls that supply the formula directly.
    if (dataset.roll) {
      let label = dataset.label ? `[ability] ${dataset.label}` : '';
      let roll = new Roll(dataset.roll, this.actor.getRollData());
      roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: label,
        rollMode: game.settings.get('core', 'rollMode'),
      });
      return roll;
    }
  }

  /**
   * Handle rzuty na atrybuty
   * @param {Event} event   The originating click event
   * @private
   */
  async _onAttributeRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    const attribute = dataset.attribute;

    // Wyświetl kompleksowy dialog testu z wszystkimi opcjami
    const rollOptions = await this._getRollDialog(attribute, null);
    if (!rollOptions) return; // Użytkownik anulował

    // Wykonaj rzut używając dice-roller.js
    await this._executeRoll(attribute, null, rollOptions);
  }

  /**
   * Handle rzuty na umiejętności
   * @param {Event} event   The originating click event
   * @private
   */
  async _onSkillRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    const attribute = dataset.attribute;
    const skill = dataset.skill;

    // Wyświetl kompleksowy dialog testu z wszystkimi opcjami
    const rollOptions = await this._getRollDialog(attribute, skill);
    if (!rollOptions) return; // Użytkownik anulował

    // Wykonaj rzut używając dice-roller.js
    await this._executeRoll(attribute, skill, rollOptions);
  }

  /**
   * Przełącz specjalizację
   * @param {Event} event   The originating click event
   * @private
   */
  async _onSpecializationToggle(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    const category = dataset.category;
    
    if (!category) return;
    
    const currentValue = this.actor.system.specializations?.categories?.[category] || false;
    await this.actor.update({
      [`system.specializations.categories.${category}`]: !currentValue
    });
    
    // Odśwież arkusz żeby zaktualizować style
    this.render(false);
  }

  /**
   * Aktualizuje wyświetlanie specjalizacji w arkuszu
   * @param {jQuery} html 
   * @private
   */
  _updateSpecializationDisplay(html) {
    const specializations = this.actor.system.specializations?.categories || {};
    
    // Dla każdej kategorii, sprawdź czy jest specjalizacją
    for (let [category, isSpecialized] of Object.entries(specializations)) {
      const categoryButton = html.find(`.category-button[data-category="${category}"]`);
      const categoryCell = categoryButton.closest('.category-cell');
      const skillButtons = categoryCell.closest('tr').find('.skill-button');
      
      if (isSpecialized) {
        categoryButton.addClass('specialized');
        categoryCell.addClass('specialized');
        skillButtons.addClass('specialized');
      } else {
        categoryButton.removeClass('specialized');
        categoryCell.removeClass('specialized');
        skillButtons.removeClass('specialized');
      }
    }
  }

  /**
   * Wyświetl kompleksowy dialog dla wykonania rzutu
   * @param {string} attribute - Klucz atrybutu (zr, pc, ch, sp, bd)
   * @param {string|null} skill - Klucz umiejętności lub null dla testu atrybutu
   * @returns {Promise<Object|null>} Opcje rzutu lub null jeśli anulowano
   * @private
   */
  async _getRollDialog(attribute, skill) {
    return new Promise((resolve) => {
      // Pobranie nazw do wyświetlenia
      const attributeName = CONFIG.NEUROSHIMA.attributes[attribute] || attribute;
      const skillName = skill ? this._getSkillName(attribute, skill) : null;
      const rollTitle = skillName ? `${skillName} (${attributeName})` : attributeName;

      // Pobierz kary z pancerza i ran
      const armorPenalty = this._getTotalArmorPenalty();
      const woundPenalty = this._getTotalWoundPenalty();

      // Opcje poziomów trudności - uproszczone nazwy
      const difficulties = [
        { key: 'easy', name: 'Łatwy', base: -20 },
        { key: 'average', name: 'Przeciętny', base: 0 },
        { key: 'problematic', name: 'Problematyczny', base: 11 },
        { key: 'hard', name: 'Trudny', base: 31 },
        { key: 'veryHard', name: 'Bardzo Trudny', base: 61 },
        { key: 'damnHard', name: 'Cholernie Trudny', base: 91 },
        { key: 'luck', name: 'Fart', base: 121 }
      ];

      let difficultyOptions = '';
      difficulties.forEach(diff => {
        const selected = diff.key === 'average' ? 'selected' : '';
        difficultyOptions += `<option value="${diff.key}" ${selected}>${diff.name}</option>`;
      });

      new Dialog({
        title: `Test: ${rollTitle}`,
        content: `
          <form class="neuroshima-roll-dialog">
            <div class="dialog-two-columns">
              <div class="left-column">
                <div class="form-group">
                  <label>TYP TESTU</label>
                  <select name="testType">
                    <option value="open">Test otwarty</option>
                    <option value="closed">Test zamknięty</option>
                  </select>
                </div>
                
                <div class="form-group">
                  <label>TRUDNOŚĆ</label>
                  <select name="difficulty">
                    ${difficultyOptions}
                  </select>
                </div>
              </div>
              
              <div class="right-column">
                <div class="modifiers-table">
                  <div class="modifier-item">
                    <label class="modifier-checkbox">
                      <input type="checkbox" name="applyModifier" checked />
                      <span class="modifier-label">Modyfikator</span>
                    </label>
                    <input type="number" name="percentageModifier" value="0" min="-100" max="100" class="modifier-input" />
                  </div>
                  
                  ${armorPenalty > 0 ? `
                    <div class="modifier-item">
                      <label class="modifier-checkbox">
                        <input type="checkbox" name="applyArmorPenalty" checked />
                        <span class="modifier-label">Pancerz</span>
                      </label>
                      <span class="modifier-value">+${armorPenalty}%</span>
                    </div>
                  ` : ''}
                  
                  ${woundPenalty > 0 ? `
                    <div class="modifier-item">
                      <label class="modifier-checkbox">
                        <input type="checkbox" name="applyWoundPenalty" checked />
                        <span class="modifier-label">Obrażenia</span>
                      </label>
                      <span class="modifier-value">+${woundPenalty}%</span>
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
            
            <div class="difficulty-preview-box"></div>
          </form>
        `,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d20"></i>',
            label: "Wykonaj rzut",
            callback: (html) => {
              const formData = new FormData(html[0].querySelector('form'));
              
              // Sprawdź, które modyfikatory są zaznaczone
              const applyModifier = formData.get('applyModifier') === 'on';
              const applyArmorPenalty = formData.get('applyArmorPenalty') === 'on';
              const applyWoundPenalty = formData.get('applyWoundPenalty') === 'on';
              
              const percentageModifier = parseInt(formData.get('percentageModifier')) || 0;
              
              const options = {
                testType: formData.get('testType'),
                difficulty: formData.get('difficulty'),
                percentageModifier: applyModifier ? percentageModifier : 0,
                armorPenalty: applyArmorPenalty ? armorPenalty : 0,
                woundPenalty: applyWoundPenalty ? woundPenalty : 0
              };
              resolve(options);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Anuluj",
            callback: () => resolve(null)
          }
        },
        default: "roll",
        render: (html) => {
          // Dodaj event listenery do wszystkich kontrolek
          html.find('[name="difficulty"], [name="percentageModifier"], [name="applyModifier"], [name="applyArmorPenalty"], [name="applyWoundPenalty"]').on('change', () => {
            this._updateDifficultyPreview(html, difficulties, armorPenalty, woundPenalty);
          });
          // Wywołaj raz na początku
          this._updateDifficultyPreview(html, difficulties, armorPenalty, woundPenalty);
        }
      }, { width: 450, classes: ["neuroshima", "neuroshima-dialog"] }).render(true);
    });
  }

  /**
   * Aktualizuje podgląd poziomu trudności w dialogu
   * @param {jQuery} html - HTML dialogu
   * @param {Array} difficulties - Lista poziomów trudności
   * @param {number} armorPenalty - Kara z pancerza
   * @param {number} woundPenalty - Kara z obrażeń
   * @param {string} weaponType - Typ broni ('melee' lub 'ranged') dla modyfikatora lokacji
   * @private
   */
  _updateDifficultyPreview(html, difficulties, armorPenalty = 0, woundPenalty = 0, weaponType = null) {
    const selectedDifficulty = html.find('[name="difficulty"]').val();
    const percentageModifier = parseInt(html.find('[name="percentageModifier"]').val()) || 0;
    
    // Sprawdź, które modyfikatory są zaznaczone
    const applyModifier = html.find('[name="applyModifier"]').is(':checked');
    const applyArmorPenalty = html.find('[name="applyArmorPenalty"]').is(':checked');
    const applyWoundPenalty = html.find('[name="applyWoundPenalty"]').is(':checked');
    
    const activeModifier = applyModifier ? percentageModifier : 0;
    const activeArmorPenalty = applyArmorPenalty ? armorPenalty : 0;
    const activeWoundPenalty = applyWoundPenalty ? woundPenalty : 0;
    
    // Pobierz modyfikator lokacji jeśli wybrano konkretną lokację
    let locationModifier = 0;
    const selectedLocation = html.find('[name="hitLocation"]').val();
    if (selectedLocation && selectedLocation !== 'random' && weaponType) {
      const location = CONFIG.NEUROSHIMA.hitLocations[selectedLocation];
      if (location) {
        locationModifier = weaponType === 'melee' ? location.meleeModifier : location.rangedModifier;
      }
    }
    
    const totalPenalties = activeArmorPenalty + activeWoundPenalty + locationModifier;
    
    const difficulty = difficulties.find(d => d.key === selectedDifficulty);
    if (difficulty) {
      const finalPercentage = difficulty.base + activeModifier + totalPenalties;
      
      // Buduj podgląd w stylu monochromatycznym
      let preview = `<div class="preview-line">Bazowy: ${difficulty.base}%</div>`;
      
      if (activeModifier !== 0) {
        preview += `<div class="preview-line">Modyfikator: ${activeModifier >= 0 ? '+' : ''}${activeModifier}%</div>`;
      }
      
      if (activeArmorPenalty > 0) {
        preview += `<div class="preview-line">Pancerz: +${activeArmorPenalty}%</div>`;
      }
      
      if (activeWoundPenalty > 0) {
        preview += `<div class="preview-line">Obrażenia: +${activeWoundPenalty}%</div>`;
      }
      
      if (locationModifier > 0) {
        preview += `<div class="preview-line">Lokacja: +${locationModifier}%</div>`;
      }
      
      preview += `<div class="preview-total">RAZEM: ${finalPercentage}%</div>`;
      
      // Sprawdź czy zmieniło to poziom trudności
      const newLevel = this.actor._getDifficultyFromPercentage(finalPercentage);
      if (newLevel !== selectedDifficulty) {
        const newDiff = difficulties.find(d => d.key === newLevel);
        preview += `<div class="preview-warning">→ Faktyczny poziom: ${newDiff?.name || 'Nieznany'}</div>`;
      }
      
      // Zaktualizuj podgląd
      let previewElement = html.find('.difficulty-preview-box');
      previewElement.html(preview);
    }
  }



  /**
   * Pobiera nazwę umiejętności
   * @param {string} attribute - Klucz atrybutu
   * @param {string} skill - Klucz umiejętności
   * @returns {string} Nazwa umiejętności
   * @private
   */
  /**
   * Pobiera polską nazwę umiejętności
   * Obsługuje zarówno standardowe umiejętności jak i customową wiedzę
   * 
   * @param {string} attribute - Klucz atrybutu
   * @param {string} skill - Klucz umiejętności
   * @returns {string} Polska nazwa umiejętności
   * @private
   */
  _getSkillName(attribute, skill) {
    // Specjalna obsługa wiedzy ogólnej - używa customowych nazw
    if (skill && skill.startsWith('wiedza.')) {
      const wiedzaKey = skill.replace('wiedza.', '');
      const customName = this.actor.system.skills?.sp?.wiedza?.[wiedzaKey.replace('poziom', 'nazwa')];
      if (customName && customName.trim()) {
        return customName;
      }
      return `Wiedza ${wiedzaKey}`; // fallback
    }
    
    // Pełny mapping standardowych umiejętności systemu Neuroshima 1.5
    const skillNames = {
      // === ZRĘCZNOŚĆ (ZR) ===
      // Walka wręcz
      'bijatyka': 'Bijatyka',
      'bron_reczna': 'Broń Ręczna',
      'rzucanie': 'Rzucanie',
      
      // Broń strzelecka
      'pistolety': 'Pistolety',
      'karabiny': 'Karabiny',
      'bron_maszynowa': 'Broń Maszynowa',
      
      // Broń dystansowa
      'luk': 'Łuk',
      'kusza': 'Kusza',
      'proca': 'Proca',
      
      // Prowadzenie pojazdów
      'samochod': 'Samochód',
      'ciezarowka': 'Ciężarówka',
      'motocykl': 'Motocykl',
      
      // Zdolności manualne
      'kradziez_kieszonkowa': 'Kradzież kieszonkowa',
      'zwinne_dlonie': 'Zwinne Dłonie',
      'otwieranie_zamkow': 'Otwieranie zamków',
      
      // === PERCEPCJA (PC) ===
      // Orientacja w terenie
      'wyczucie_kierunku': 'Wyczucie kierunku',
      'tropienie': 'Tropienie',
      'przygotowanie_pulapki': 'Przygotowanie pułapki',
      
      // Spostrzegawczość
      'nasluchiwanie': 'Nasłuchiwanie',
      'wypatrywanie': 'Wypatrywanie',
      'czujnosc': 'Czujność',
      
      // Kamuflaż
      'skradanie_sie': 'Skradanie się',
      'ukrywanie_sie': 'Ukrywanie się',
      'maskowanie': 'Maskowanie',
      
      // Przetrwanie
      'lowiectwo': 'Łowiectwo',
      'zdobywanie_wody': 'Zdobywanie wody',
      'znajomosc_terenu': 'Znajomość terenu',
      
      // === CHARYZMA (CH) ===
      // Negocjacje
      'perswazja': 'Perswazja',
      'zastraszanie': 'Zastraszanie',
      'zdolnosci_przywodcze': 'Zdolności przywódcze',
      
      // Empatia
      'postrzeganie_emocji': 'Postrzeganie emocji',
      'blef': 'Blef',
      'opieka_nad_zwierzetami': 'Opieka nad zwierzętami',
      
      // Siła woli
      'odpornosc_na_bol': 'Odporność na ból',
      'niezlomnosc': 'Niezłomność',
      'morale': 'Morale',
      
      // === SPRYT (SP) ===
      // Medycyna
      'leczenie_ran': 'Leczenie ran',
      'leczenie_chorob': 'Leczenie chorób',
      'pierwsza_pomoc': 'Pierwsza pomoc',
      
      // Technika
      'mechanika': 'Mechanika',
      'elektronika': 'Elektronika',
      'komputery': 'Komputery',
      
      // Sprzęt
      'maszyny_ciezkie': 'Maszyny ciężkie',
      'wozy_bojowe': 'Wozy bojowe',
      'kutry': 'Kutry',
      
      // Pirotechnika
      'rusznikarstwo': 'Rusznikarstwo',
      'wyrzutnie': 'Wyrzutnie',
      'materialy_wybuchowe': 'Materiały wybuchowe',
      
      // === BUDOWA (BD) ===
      // Sprawność
      'plywanie': 'Pływanie',
      'wspinaczka': 'Wspinaczka',
      'kondycja': 'Kondycja',
      
      // Jeździectwo
      'jazda_konna': 'Jazda konna',
      'powodzenie': 'Powodzenie',
      'ujezdzanie': 'Ujeżdżanie'
    };
    
    return skillNames[skill] || skill;
  }

  /**
   * Pobiera polską nazwę poziomu trudności
   * @param {string} difficulty - Klucz poziomu trudności
   * @returns {string} Polska nazwa
   * @private
   */
  _getDifficultyName(difficulty) {
    const difficultyNames = {
      'easy': 'Łatwy',
      'average': 'Przeciętny',
      'problematic': 'Problematyczny',
      'hard': 'Trudny',
      'veryHard': 'Bardzo Trudny',
      'damnHard': 'Cholernie Trudny',
      'luck': 'Fart'
    };
    return difficultyNames[difficulty] || difficulty;
  }

  /**
   * Wykonuje rzut używając systemu dice-roller
   * @param {string} attribute - Klucz atrybutu
   * @param {string|null} skill - Klucz umiejętności lub null
   * @param {Object} options - Opcje rzutu z dialogu
   * @private
   */
  async _executeRoll(attribute, skill, options) {
    // Import dice-roller z głównego folderu systemu
    const { NeuroshimaDiceRoller } = await import("../../dice-roller.js");
    
    // Pobierz dane potrzebne do rzutu
    const attributeData = this.actor.system.attributes[attribute];
    const attributeValue = attributeData.value + (attributeData.mod || 0);
    const skillValue = skill ? this._getSkillValue(attribute, skill) : 0;
    
    // Przygotuj modyfikatory trudności (zgodnie z dice-roller.js)
    const difficultyMods = {
      easy: 2,
      average: 0,
      problematic: -2,
      hard: -5,
      veryHard: -8,
      damnHard: -11,
      luck: -15
    };

    // Ustal typ rzutu
    const rollType = skill ? 'skill' : 'attribute';
    
    // Nazwa rzutu
    const rollName = skill ? this._getSkillName(attribute, skill) : CONFIG.NEUROSHIMA.attributes[attribute];

    // Dodaj kary z pancerza i ran do modyfikatora procentowego
    const totalPercentageModifier = options.percentageModifier + (options.armorPenalty || 0) + (options.woundPenalty || 0);

    try {
      // Wykonaj rzut używając dice-roller.js
      const result = await NeuroshimaDiceRoller.performRoll(
        this.actor,                    // actor
        rollName,                      // rollName
        skillValue,                    // rollLevel (skill value)
        attributeValue,                // attributeValue
        options.difficulty,            // difficulty
        difficultyMods,               // difficultyMods
        options.testType,             // testType
        rollType,                     // rollType
        attribute,                    // attributeKey
        totalPercentageModifier       // percentageModifier (includes penalties)
      );

      // Wyświetl wynik w chacie
      await this._displayRollResult(result, options);
      
    } catch (error) {
      console.error('Błąd podczas wykonywania rzutu:', error);
      ui.notifications.error('Wystąpił błąd podczas wykonywania rzutu!');
    }
  }

  /**
   * Pobiera wartość umiejętności
   * @param {string} attribute - Klucz atrybutu
   * @param {string} skill - Klucz umiejętności
   * @returns {number} Wartość umiejętności
   * @private
   */
  _getSkillValue(attribute, skill) {
    // Dla wiedzy - specjalna obsługa
    if (skill && skill.startsWith('wiedza.')) {
      const wiedzaKey = skill.replace('wiedza.', '');
      return this.actor.system.skills?.sp?.wiedza?.[wiedzaKey] || 0;
    }
    
    // Standardowe umiejętności
    return this.actor.system.skills?.[attribute]?.[skill] || 0;
  }

  /**
   * Wyświetla wynik rzutu w chacie z animacją kości w nowym formacie
   * Format: [Poziom] Test [Typ] na [umiejętność/atrybut]
   * D1: [wynik], D2: [wynik], D3: [wynik]
   * Punktów przewagi: [liczba]
   * 
   * @param {Object} result - Obiekt Roll z dice-roller.js zawierający neuroshimaData
   * @param {Object} options - Opcje rzutu zawierające informacje o karach
   * @private
   */
  async _displayRollResult(result, options = {}) {
    const rollData = result.neuroshimaData;
    
    // Przygotuj elementy komunikatu
    const difficultyName = this._getDifficultyDisplayName(rollData.difficulty);
    const testTypeText = rollData.testType === 'open' ? 'Otwarty' : 'Zamknięty';
    const targetName = rollData.rollName;
    
    // Przygotuj tooltip z informacjami o trudnościach (HTML)
    let tooltipRows = [];
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Próg:</span><span class="tooltip-value">${rollData.difficultyValue}</span></div>`);
    
    // Dodaj informacje o trudnościach
    const baseDifficulty = rollData.originalPercentage || 0;
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Bazowa trudność:</span><span class="tooltip-value">${baseDifficulty}%</span></div>`);
    
    if (options.percentageModifier && options.percentageModifier !== 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Modyfikator:</span><span class="tooltip-value">${options.percentageModifier >= 0 ? '+' : ''}${options.percentageModifier}%</span></div>`);
    }
    
    if (options.armorPenalty && options.armorPenalty > 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Pancerz:</span><span class="tooltip-value">+${options.armorPenalty}%</span></div>`);
    }
    
    if (options.woundPenalty && options.woundPenalty > 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Obrażenia:</span><span class="tooltip-value">+${options.woundPenalty}%</span></div>`);
    }
    
    const tooltipContent = tooltipRows.join('');
    
    // Format: [Poziom] Test [Typ] na [umiejętność/atrybut] + ikonka info
    const headerText = `${difficultyName} Test ${testTypeText} na ${targetName}`;
    
    // Wyniki poszczególnych kości z oznaczeniami D1, D2, D3
    const diceText = rollData.diceResults.map((result, index) => {
      // Dodaj klasę dla naturalnej 1 (krytyczny sukces) lub 20 (krytyczna porażka)
      let criticalClass = '';
      if (result === 1) {
        criticalClass = ' critical-success';
      } else if (result === 20) {
        criticalClass = ' critical-failure';
      }
      
      return `<div class="dice-result-item${criticalClass}">
        <span class="dice-label">D${index + 1}:</span>
        <span class="dice-value">${result}</span>
      </div>`;
    }).join('');
    
    // Sekcja redukcji - różna dla testów otwartych i zamkniętych
    let reductionText = '';
    const reductionPoints = rollData.rollLevel || 0;
    
    if (rollData.testType === 'open' && rollData.reducedDice && rollData.reducedDice.length > 0) {
      // TEST OTWARTY: Pokaż 2 najniższe kości po redukcji
      // Znajdź które kości zostały użyte (dwie najniższe)
      const sortedWithIndex = rollData.diceResults
        .map((val, idx) => ({ val, idx }))
        .sort((a, b) => a.val - b.val);
      
      const lowestTwoIndices = sortedWithIndex.slice(0, 2).map(item => item.idx).sort((a, b) => a - b);
      
      reductionText = `
        <div class="reduction-section">
          <div class="reduction-header">
            Po redukcji ${reductionPoints} pkt:
          </div>
          <div class="reduction-dice-grid">
            ${rollData.reducedDice.map((val, idx) => {
              // Pomaluj na zielono tę kość, która generuje sukcesy (wyższą wartość = finalResult)
              const isWinningDice = val === rollData.finalResult;
              const diceLabel = `D${lowestTwoIndices[idx] + 1}`;
              return `
                <div class="dice-result-item${isWinningDice ? ' winning-dice' : ''}">
                  <div class="dice-label">${diceLabel}</div>
                  <div class="dice-value">${val}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else if (rollData.testType === 'closed' && rollData.reducedDice && rollData.reducedDice.length > 0 && reductionPoints > 0) {
      // TEST ZAMKNIĘTY: Pokaż wszystkie 3 kości po redukcji
      reductionText = `
        <div class="reduction-section">
          <div class="reduction-header">
            Po redukcji ${reductionPoints} pkt:
          </div>
          <div class="reduction-dice-grid closed-test-grid">
            ${rollData.reducedDice.map((val, idx) => {
              // Pomaluj na zielono kości, które są <= próg (sukcesy)
              const isSuccess = val <= rollData.difficultyValue;
              const diceLabel = `D${idx + 1}`;
              return `
                <div class="dice-result-item${isSuccess ? ' winning-dice' : ''}">
                  <div class="dice-label">${diceLabel}</div>
                  <div class="dice-value">${val}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
    
    // Sekcja sukcesów - różna dla testów otwartych i zamkniętych
    let successSection = '';
    if (rollData.testType === 'open') {
      // Test otwarty: Punkty przewagi
      const advantageText = `Punktów przewagi: ${rollData.successCount}`;
      successSection = `
        <div class="advantage-result">
          <strong>${advantageText}</strong>
        </div>
      `;
    } else if (rollData.testType === 'closed') {
      // Test zamknięty: Liczba sukcesów (ile kości <= próg)
      const successText = `Liczba sukcesów: ${rollData.successCount}`;
      successSection = `
        <div class="closed-test-success">
          <strong>${successText}</strong>
        </div>
      `;
    }
    
    // Buduj kompletną zawartość wiadomości
    let content = `
      <div class="neuroshima-roll-result">
        <span class="skill-info-wrapper">
          <i class="fas fa-info-circle skill-info-icon"></i>
          <div class="skill-info-tooltip">
            ${tooltipContent}
          </div>
        </span>
        <h3>${headerText}</h3>
        <div class="roll-details">
          <div class="dice-results-grid">
            ${diceText}
          </div>
          ${reductionText}
          ${successSection}
        </div>
      </div>
    `;

    // Wyślij do chatu z animacją kości (kompatybilne z Dice So Nice)
    await result.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: content,
      rollMode: game.settings.get('core', 'rollMode')
    });
  }
  
  /**
   * Pobiera polską nazwę poziomu trudności do wyświetlenia
   * @param {string} difficulty - Klucz poziomu trudności
   * @returns {string} Polska nazwa
   * @private
   */
  _getDifficultyDisplayName(difficulty) {
    const names = {
      'easy': 'Łatwy',
      'average': 'Przeciętny', 
      'problematic': 'Problematyczny',
      'hard': 'Trudny',
      'veryHard': 'Bardzo Trudny',
      'damnHard': 'Cholernie Trudny',
      'luck': 'Fart'
    };
    return names[difficulty] || difficulty;
  }

  /* -------------------------------------------- */

  /**
   * Handle editing an item
   * @param {Event} event
   * @private
   */
  _onEditItem(event) {
    event.preventDefault();
    const itemId = event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) {
      item.sheet.render(true);
    }
  }

  /**
   * Handle unequipping an item
   * @param {Event} event
   * @private
   */
  async _onUnequipItem(event) {
    event.preventDefault();
    const itemId = event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) {
      await item.update({"system.equipable": false});
      // Refresh the sheet to recalculate armor
      this.render(false);
    }
  }

  /**
   * Handle rolling an attack with a weapon
   * @param {Event} event
   * @private
   */
  async _onRollAttack(event) {
    event.preventDefault();
    const itemId = event.currentTarget.dataset.itemId;
    const weapon = this.actor.items.get(itemId);
    
    if (!weapon) {
      ui.notifications.warn("Nie znaleziono broni!");
      return;
    }

    // Get weapon stats
    const attribute = weapon.system.attribute || 'zr';
    const skill = weapon.system.skill || 'bijatyka';
    
    // Check weapon type and use appropriate roll method
    if (weapon.type === 'weapon-ranged') {
      // Use special ranged weapon dialog
      await this._onRollRangedWeapon(weapon, attribute, skill);
    } else if (weapon.type === 'weapon-melee') {
      // Use melee weapon dialog (closed test)
      await this._onRollMeleeWeapon(weapon, attribute, skill);
    } else {
      // Use standard skill roll for thrown weapons
      const fakeEvent = {
        preventDefault: () => {},
        currentTarget: {
          dataset: {
            attribute: attribute,
            skill: skill
          }
        }
      };
      
      await this._onSkillRoll(fakeEvent);
    }
  }

  /**
   * Handle rolling a ranged weapon attack
   * @param {Item} weapon - The weapon item
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @private
   */
  async _onRollRangedWeapon(weapon, attribute, skill) {
    // Get weapon stats
    const rateOfFire = weapon.system.rateOfFire || 1;
    const weaponName = weapon.name;
    
    // Show ranged weapon dialog
    const rollOptions = await this._getRangedWeaponDialog(weapon, attribute, skill);
    if (!rollOptions) return; // User cancelled
    
    // Execute ranged weapon roll
    await this._executeRangedWeaponRoll(weapon, attribute, skill, rollOptions);
  }

  /**
   * Handle rolling a melee weapon attack (closed test)
   * @param {Item} weapon - The weapon item
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @private
   */
  async _onRollMeleeWeapon(weapon, attribute, skill) {
    // Show melee weapon dialog
    const rollOptions = await this._getMeleeWeaponDialog(weapon, attribute, skill);
    if (!rollOptions) return; // User cancelled
    
    // Execute melee weapon roll
    await this._executeMeleeWeaponRoll(weapon, attribute, skill, rollOptions);
  }

  /**
   * Show dialog for melee weapon attack
   * @param {Item} weapon - The weapon item
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @returns {Promise<Object|null>} Roll options or null if cancelled
   * @private
   */
  async _getMeleeWeaponDialog(weapon, attribute, skill) {
    return new Promise((resolve) => {
      const attributeName = CONFIG.NEUROSHIMA.attributes[attribute] || attribute;
      const skillName = this._getSkillName(attribute, skill);
      const weaponName = weapon.name;
      
      // Get penalties
      const armorPenalty = this._getTotalArmorPenalty();
      const woundPenalty = this._getTotalWoundPenalty();
      
      // Difficulty options
      const difficulties = [
        { key: 'easy', name: 'Łatwy', base: -20 },
        { key: 'average', name: 'Przeciętny', base: 0 },
        { key: 'problematic', name: 'Problematyczny', base: 11 },
        { key: 'hard', name: 'Trudny', base: 31 },
        { key: 'veryHard', name: 'Bardzo Trudny', base: 61 },
        { key: 'damnHard', name: 'Cholernie Trudny', base: 91 },
        { key: 'luck', name: 'Fart', base: 121 }
      ];
      
      let difficultyOptions = '';
      difficulties.forEach(diff => {
        const selected = diff.key === 'average' ? 'selected' : '';
        difficultyOptions += `<option value="${diff.key}" ${selected}>${diff.name}</option>`;
      });
      
      // Hit location options
      let locationOptions = '';
      for (const [key, location] of Object.entries(CONFIG.NEUROSHIMA.hitLocations)) {
        const selected = key === 'random' ? 'selected' : '';
        const modifier = key === 'random' ? '' : ` (+${location.meleeModifier}%)`;
        locationOptions += `<option value="${key}" ${selected}>${location.name}${modifier}</option>`;
      }
      
      new Dialog({
        title: `Atak: ${weaponName}`,
        content: `
          <form class="neuroshima-roll-dialog">
            <div class="dialog-two-columns">
              <div class="left-column">
                <div class="difficulty-box">
                  <div class="form-group">
                    <label>TYP AKCJI</label>
                    <select name="actionType">
                      <option value="attack" selected>Atak (${weapon.system.bonusAttack >= 0 ? '+' : ''}${weapon.system.bonusAttack})</option>
                      <option value="defense">Obrona (${weapon.system.bonusDefense >= 0 ? '+' : ''}${weapon.system.bonusDefense})</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>TRUDNOŚĆ</label>
                    <select name="difficulty">
                      ${difficultyOptions}
                    </select>
                  </div>
                  <div class="form-group">
                    <label>LOKACJA TRAFIENIA</label>
                    <select name="hitLocation">
                      ${locationOptions}
                    </select>
                  </div>
                </div>
              </div>
              
              <div class="right-column">
                <div class="modifiers-table">
                  <div class="modifier-item">
                    <label class="modifier-checkbox">
                      <input type="checkbox" name="applyModifier" checked />
                      <span class="modifier-label">Modyfikator</span>
                    </label>
                    <input type="number" name="percentageModifier" value="0" min="-100" max="100" class="modifier-input" />
                  </div>
                  
                  ${armorPenalty > 0 ? `
                    <div class="modifier-item">
                      <label class="modifier-checkbox">
                        <input type="checkbox" name="applyArmorPenalty" checked />
                        <span class="modifier-label">Pancerz</span>
                      </label>
                      <span class="modifier-value">+${armorPenalty}%</span>
                    </div>
                  ` : ''}
                  
                  ${woundPenalty > 0 ? `
                    <div class="modifier-item">
                      <label class="modifier-checkbox">
                        <input type="checkbox" name="applyWoundPenalty" checked />
                        <span class="modifier-label">Obrażenia</span>
                      </label>
                      <span class="modifier-value">+${woundPenalty}%</span>
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
            
            <div class="difficulty-preview-box"></div>
          </form>
        `,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d20"></i>',
            label: "Wykonaj atak",
            callback: (html) => {
              const formData = new FormData(html[0].querySelector('form'));
              
              const applyModifier = formData.get('applyModifier') === 'on';
              const applyArmorPenalty = formData.get('applyArmorPenalty') === 'on';
              const applyWoundPenalty = formData.get('applyWoundPenalty') === 'on';
              
              const percentageModifier = parseInt(formData.get('percentageModifier')) || 0;
              const actionType = formData.get('actionType');
              const hitLocation = formData.get('hitLocation');
              
              const options = {
                actionType: actionType,
                difficulty: formData.get('difficulty'),
                percentageModifier: applyModifier ? percentageModifier : 0,
                armorPenalty: applyArmorPenalty ? armorPenalty : 0,
                woundPenalty: applyWoundPenalty ? woundPenalty : 0,
                hitLocation: hitLocation
              };
              resolve(options);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Anuluj",
            callback: () => resolve(null)
          }
        },
        default: "roll",
        render: (html) => {
          // Update difficulty preview
          html.find('[name="difficulty"], [name="percentageModifier"], [name="applyModifier"], [name="applyArmorPenalty"], [name="applyWoundPenalty"], [name="hitLocation"]').on('change', () => {
            this._updateDifficultyPreview(html, difficulties, armorPenalty, woundPenalty, 'melee');
          });
          
          // Initial preview
          this._updateDifficultyPreview(html, difficulties, armorPenalty, woundPenalty, 'melee');
        }
      }, { width: 480, classes: ["neuroshima", "neuroshima-dialog"] }).render(true);
    });
  }

  /**
   * Execute melee weapon roll (closed test)
   * @param {Item} weapon - The weapon item
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @param {Object} options - Roll options
   * @private
   */
  async _executeMeleeWeaponRoll(weapon, attribute, skill, options) {
    // Oblicz łączny modyfikator procentowy (włączając kary)
    const totalPercentageModifier = (options.percentageModifier || 0) + 
                                   (options.armorPenalty || 0) + 
                                   (options.woundPenalty || 0);
    
    // Execute the roll as closed test
    const result = await this.actor.rollMeleeWeapon(
      weapon,
      attribute,
      skill,
      options.difficulty,
      totalPercentageModifier,
      options.actionType,
      options.hitLocation || 'random'
    );
    
    // Display result in chat
    await this._displayMeleeWeaponResult(weapon, attribute, skill, options, result);
  }

  /**
   * Display melee weapon roll result in chat
   * @param {Item} weapon - The weapon item
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @param {Object} options - Roll options
   * @param {Object} result - Roll result
   * @private
   */
  async _displayMeleeWeaponResult(weapon, attribute, skill, options, result) {
    const attributeName = CONFIG.NEUROSHIMA.attributes[attribute] || attribute;
    const skillName = this._getSkillName(attribute, skill);
    
    // Get difficulty name (use final difficulty after all modifiers)
    const difficultyName = this._getDifficultyDisplayName(result.finalDifficulty);
    
    // Build dice display
    let diceDisplay = '';
    for (let i = 0; i < result.dice.length; i++) {
      const original = result.dice[i];
      const reduced = result.reducedDice[i];
      const isSuccess = reduced <= result.threshold;
      
      diceDisplay += `
        <div class="dice-result ${isSuccess ? 'success' : 'failure'}">
          <div class="dice-value">${original}</div>
          ${result.reductionAmount > 0 ? `<div class="dice-reduced">→ ${reduced}</div>` : ''}
        </div>
      `;
    }
    
    // Determine hit/miss
    const isHit = result.successes > 0;
    const hitClass = isHit ? 'hit' : 'miss';
    const actionTypeText = result.actionType === 'attack' ? 'ATAK' : 'OBRONA';
    const hitText = isHit ? (result.actionType === 'attack' ? 'TRAFIENIE' : 'OBRONA UDANA') : (result.actionType === 'attack' ? 'PUDŁO' : 'OBRONA NIEUDANA');
    
    // Mapowanie typów obrażeń
    const damageTypeNames = {
      'D': 'Draśnięcie',
      'sD': 'Siniak (Draśnięcie)',
      'L': 'Lekkie',
      'sL': 'Siniak (Lekkie)',
      'C': 'Ciężkie',
      'sC': 'Siniak (Ciężkie)',
      'K': 'Krytyczne',
      'sK': 'Siniak (Krytyczne)'
    };
    
    // Build tooltip content (HTML with rows) - pokazuje pełne rozliczenie progu
    let tooltipRows = [];
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Atrybut:</span><span class="tooltip-value">${result.attributeValue}</span></div>`);
    if (result.attributeMod !== 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Mod. atrybutu:</span><span class="tooltip-value">${result.attributeMod >= 0 ? '+' : ''}${result.attributeMod}</span></div>`);
    }
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Umiejętność:</span><span class="tooltip-value">${result.skillLevel}</span></div>`);
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Trudność:</span><span class="tooltip-value">${this._getDifficultyName(result.finalDifficulty)} (${result.difficultyMod >= 0 ? '+' : ''}${result.difficultyMod})</span></div>`);
    if (result.locationModifier && result.locationModifier !== 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Mod. lokacji:</span><span class="tooltip-value">+${result.locationModifier}%</span></div>`);
    }
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Bonus broni (${result.actionType === 'attack' ? 'atak' : 'obrona'}):</span><span class="tooltip-value">${result.weaponBonus >= 0 ? '+' : ''}${result.weaponBonus}</span></div>`);
    tooltipRows.push(`<div class="tooltip-row tooltip-separator"><span class="tooltip-label"><strong>PRÓG:</strong></span><span class="tooltip-value"><strong>${result.threshold}</strong></span></div>`);
    if (result.reductionAmount > 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Redukcja kości:</span><span class="tooltip-value">-${result.reductionAmount}</span></div>`);
    }
    if (result.hitLocation && result.hitLocation.roll !== null) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Lokacja trafienia:</span><span class="tooltip-value">${result.hitLocation.roll}</span></div>`);
    }
    const tooltipContent = tooltipRows.join('');
    
    // Prepare damage application data if hit
    let damageApplicationData = null;
    if (isHit && result.actionType === 'attack' && result.damageType) {
      // Get targeted token (the one with red border)
      const targetedToken = Array.from(game.user.targets)[0];
      const targetedActor = targetedToken?.actor || null;
      
      damageApplicationData = {
        attackerId: this.actor.id,
        weaponName: weapon.name,
        damageType: result.damageType,
        location: result.hitLocation.key,
        locationName: result.hitLocation.name,
        hitCount: 1,
        penetration: 0, // Melee weapons don't have penetration
        targetedActorId: targetedActor?.id || null,
        targetedActor: targetedActor ? {
          id: targetedActor.id,
          name: targetedActor.name,
          img: targetedActor.img
        } : null,
        armorInfo: null,
        weakPoint: false
      };
      
      // Get armor info if target exists
      if (targetedActor) {
        const { getArmorAtLocation, isWeakPoint } = await import("../helpers/combat-utils.mjs");
        const locationKey = CONFIG.NEUROSHIMA.locationMapping[result.hitLocation.key] || result.hitLocation.key;
        const armor = getArmorAtLocation(targetedActor, locationKey);
        const weakPoint = isWeakPoint(targetedActor, locationKey);
        
        damageApplicationData.armorInfo = {
          armor: armor,
          penetration: 0,
          penetrationApplied: false,
          effectiveArmor: armor
        };
        damageApplicationData.weakPoint = weakPoint;
      }
    }
    
    // Render template
    const templateData = {
      tooltipContent,
      difficultyName,
      weaponName: weapon.name,
      actionTypeText,
      skillName,
      attributeName,
      diceDisplay,
      hitClass,
      hitText,
      successes: result.successes,
      totalDice: result.dice.length,
      hitLocation: result.hitLocation,
      damageType: result.damageType,
      damageTypeName: damageTypeNames[result.damageType] || result.damageType,
      isGM: game.user.isGM,
      ...damageApplicationData
    };
    
    const flavorContent = await renderTemplate(
      "systems/neuroshima/templates/chat/attack-roll.hbs",
      templateData
    );
    
    // Wyślij do chatu z animacją kości (kompatybilne z Dice So Nice)
    await result.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: flavorContent,
      rollMode: game.settings.get('core', 'rollMode'),
      flags: {
        neuroshima: {
          damageData: damageApplicationData
        }
      }
    });
  }

  /**
   * Show dialog for ranged weapon attack
   * @param {Item} weapon - The weapon item
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @returns {Promise<Object|null>} Roll options or null if cancelled
   * @private
   */
  async _getRangedWeaponDialog(weapon, attribute, skill) {
    return new Promise((resolve) => {
      const attributeName = CONFIG.NEUROSHIMA.attributes[attribute] || attribute;
      const skillName = this._getSkillName(attribute, skill);
      const weaponName = weapon.name;
      const rateOfFire = weapon.system.rateOfFire || 1;
      
      // Get penalties
      const armorPenalty = this._getTotalArmorPenalty();
      const woundPenalty = this._getTotalWoundPenalty();
      
      // Difficulty options
      const difficulties = [
        { key: 'easy', name: 'Łatwy', base: -20 },
        { key: 'average', name: 'Przeciętny', base: 0 },
        { key: 'problematic', name: 'Problematyczny', base: 11 },
        { key: 'hard', name: 'Trudny', base: 31 },
        { key: 'veryHard', name: 'Bardzo Trudny', base: 61 },
        { key: 'damnHard', name: 'Cholernie Trudny', base: 91 },
        { key: 'luck', name: 'Fart', base: 121 }
      ];
      
      let difficultyOptions = '';
      difficulties.forEach(diff => {
        const selected = diff.key === 'average' ? 'selected' : '';
        difficultyOptions += `<option value="${diff.key}" ${selected}>${diff.name}</option>`;
      });
      
      // Hit location options
      let locationOptions = '';
      for (const [key, location] of Object.entries(CONFIG.NEUROSHIMA.hitLocations)) {
        const modifier = location.rangedModifier;
        const modifierText = modifier > 0 ? ` (+${modifier}%)` : '';
        const selected = key === 'random' ? 'selected' : '';
        locationOptions += `<option value="${key}" ${selected}>${location.name}${modifierText}</option>`;
      }
      
      new Dialog({
        title: `Strzał: ${weaponName}`,
        content: `
          <form class="neuroshima-roll-dialog">
            <div class="dialog-two-columns">
              <div class="left-column">
                <div class="difficulty-box">
                  <div class="form-group">
                    <label>TRUDNOŚĆ</label>
                    <select name="difficulty">
                      ${difficultyOptions}
                    </select>
                  </div>
                  
                  <div class="form-group">
                    <label>LOKACJA TRAFIENIA</label>
                    <select name="hitLocation">
                      ${locationOptions}
                    </select>
                  </div>
                </div>
                
                <div class="aiming-slider-group">
                  <label class="slider-main-label">CELOWANIE: <span class="aiming-display">0</span></label>
                  <input type="range" name="aimingLevel" min="0" max="2" value="0" step="1" />
                  <div class="slider-value">
                    <span class="slider-description">Rzucane kości: <span class="dice-count">1</span>k20</span>
                  </div>
                </div>
              </div>
              
              <div class="right-column">
                <div class="modifiers-table">
                  <div class="modifier-item">
                    <label class="modifier-checkbox">
                      <input type="checkbox" name="applyModifier" checked />
                      <span class="modifier-label">Modyfikator</span>
                    </label>
                    <input type="number" name="percentageModifier" value="0" min="-100" max="100" class="modifier-input" />
                  </div>
                  
                  ${armorPenalty > 0 ? `
                    <div class="modifier-item">
                      <label class="modifier-checkbox">
                        <input type="checkbox" name="applyArmorPenalty" checked />
                        <span class="modifier-label">Pancerz</span>
                      </label>
                      <span class="modifier-value">+${armorPenalty}%</span>
                    </div>
                  ` : ''}
                  
                  ${woundPenalty > 0 ? `
                    <div class="modifier-item">
                      <label class="modifier-checkbox">
                        <input type="checkbox" name="applyWoundPenalty" checked />
                        <span class="modifier-label">Obrażenia</span>
                      </label>
                      <span class="modifier-value">+${woundPenalty}%</span>
                    </div>
                  ` : ''}
                </div>
                
                <div class="burst-slider-group">
                  <label class="slider-main-label">SERIA: <span class="burst-display">0</span></label>
                  <input type="range" name="burstLevel" min="0" max="3" value="0" step="1" />
                  <div class="slider-value">
                    <span class="slider-description">Wystrzelone pociski: <span class="bullets-count">1</span></span>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="difficulty-preview-box"></div>
          </form>
        `,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d20"></i>',
            label: "Wykonaj strzał",
            callback: (html) => {
              const formData = new FormData(html[0].querySelector('form'));
              
              const applyModifier = formData.get('applyModifier') === 'on';
              const applyArmorPenalty = formData.get('applyArmorPenalty') === 'on';
              const applyWoundPenalty = formData.get('applyWoundPenalty') === 'on';
              
              const percentageModifier = parseInt(formData.get('percentageModifier')) || 0;
              
              const options = {
                difficulty: formData.get('difficulty'),
                aimingLevel: parseInt(formData.get('aimingLevel')) || 0,
                burstLevel: parseInt(formData.get('burstLevel')) || 0,
                percentageModifier: applyModifier ? percentageModifier : 0,
                armorPenalty: applyArmorPenalty ? armorPenalty : 0,
                woundPenalty: applyWoundPenalty ? woundPenalty : 0,
                hitLocation: formData.get('hitLocation') || 'random'
              };
              resolve(options);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Anuluj",
            callback: () => resolve(null)
          }
        },
        default: "roll",
        render: (html) => {
          // Update aiming display
          html.find('[name="aimingLevel"]').on('input', (e) => {
            const value = parseInt(e.target.value);
            html.find('.aiming-display').text(value);
            html.find('.dice-count').text(1 + value);
          });
          
          // Update burst display
          html.find('[name="burstLevel"]').on('input', (e) => {
            const value = parseInt(e.target.value);
            const bulletsMultiplier = [1, 1, 3, 6];
            // Burst level 0 (single shot) always fires 1 bullet
            const bullets = value === 0 ? 1 : (bulletsMultiplier[value] * rateOfFire);
            html.find('.burst-display').text(value);
            html.find('.bullets-count').text(bullets);
          });
          
          // Update difficulty preview
          html.find('[name="difficulty"], [name="percentageModifier"], [name="applyModifier"], [name="applyArmorPenalty"], [name="applyWoundPenalty"], [name="hitLocation"]').on('change', () => {
            this._updateDifficultyPreview(html, difficulties, armorPenalty, woundPenalty, 'ranged');
          });
          
          // Initial preview
          this._updateDifficultyPreview(html, difficulties, armorPenalty, woundPenalty, 'ranged');
        }
      }, { width: 480, classes: ["neuroshima", "neuroshima-dialog"] }).render(true);
    });
  }

  /**
   * Execute ranged weapon roll
   * @param {Item} weapon - The weapon item
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @param {Object} options - Roll options
   * @private
   */
  async _executeRangedWeaponRoll(weapon, attribute, skill, options) {
    // Check if weapon has selected ammunition
    if (!weapon.system.selectedAmmo) {
      ui.notifications.warn(`${weapon.name} nie ma wybranego magazynka!`);
      return;
    }
    
    // Get the selected ammunition item
    const ammoId = weapon.system.selectedAmmo;
    const ammo = this.actor.items.get(ammoId);
    
    if (!ammo) {
      ui.notifications.warn(`Nie znaleziono wybranej amunicji dla ${weapon.name}!`);
      return;
    }
    
    // Check if magazine has ammunition
    const currentAmmo = ammo.system.ammo.value || 0;
    if (currentAmmo <= 0) {
      ui.notifications.warn(`${ammo.name} jest pusty! Przeładuj broń.`);
      return;
    }
    
    const rateOfFire = weapon.system.rateOfFire || 1;
    
    // Oblicz łączny modyfikator procentowy (włączając kary)
    const totalPercentageModifier = (options.percentageModifier || 0) + 
                                   (options.armorPenalty || 0) + 
                                   (options.woundPenalty || 0);
    
    // Execute the roll
    const result = await this.actor.rollRangedWeapon(
      weapon,
      attribute,
      skill,
      options.difficulty,
      options.aimingLevel,
      options.burstLevel,
      rateOfFire,
      totalPercentageModifier,
      options.hitLocation
    );
    
    // Deduct ammunition from selected magazine
    await this._deductAmmunition(weapon, result.bulletsFired);
    
    // Display result in chat
    await this._displayRangedWeaponResult(weapon, attribute, skill, options, result);
  }

  /**
   * Display ranged weapon roll result in chat
   * @param {Item} weapon - The weapon item
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @param {Object} options - Roll options
   * @param {Object} result - Roll result
   * @private
   */
  async _displayRangedWeaponResult(weapon, attribute, skill, options, result) {
    const attributeName = CONFIG.NEUROSHIMA.attributes[attribute] || attribute;
    const skillName = this._getSkillName(attribute, skill);
    
    // Get difficulty name (use final difficulty after all modifiers)
    const difficultyName = this._getDifficultyDisplayName(result.finalDifficulty);
    
    // Build dice display
    let diceDisplay = '';
    for (let i = 0; i < result.dice.length; i++) {
      const original = result.dice[i];
      const reduced = result.reducedDice[i];
      const isSuccess = reduced <= result.threshold;
      
      diceDisplay += `
        <div class="dice-result ${isSuccess ? 'success' : 'failure'}">
          <div class="dice-value">${original}</div>
          ${result.skillLevel > 0 ? `<div class="dice-reduced">→ ${reduced}</div>` : ''}
        </div>
      `;
    }
    
    // Determine hit/miss
    const isHit = result.successes > 0;
    const hitClass = isHit ? 'hit' : 'miss';
    const hitText = isHit ? 'TRAFIENIE' : 'PUDŁO';
    
    // Mapowanie typów obrażeń
    const damageTypeNames = {
      'D': 'Draśnięcie',
      'sD': 'Siniak (Draśnięcie)',
      'L': 'Lekkie',
      'sL': 'Siniak (Lekkie)',
      'C': 'Ciężkie',
      'sC': 'Siniak (Ciężkie)',
      'K': 'Krytyczne',
      'sK': 'Siniak (Krytyczne)'
    };
    
    // Build tooltip content (HTML with rows)
    let tooltipRows = [];
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Próg:</span><span class="tooltip-value">${result.threshold}</span></div>`);
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Celowanie:</span><span class="tooltip-value">${result.aimingLevel} (${result.dice.length}k20)</span></div>`);
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Seria:</span><span class="tooltip-value">${result.burstLevel} (${result.bulletsFired} pocisków)</span></div>`);
    if (result.successPoints !== undefined) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Punkty Sukcesu:</span><span class="tooltip-value">${result.successPoints} PS</span></div>`);
    }
    if (result.bulletsHit !== undefined && result.bulletsHit > 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Trafienia:</span><span class="tooltip-value">${result.bulletsHit}/${result.bulletsFired} kul</span></div>`);
    }
    if (result.locationModifier && result.locationModifier !== 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Mod. lokacji:</span><span class="tooltip-value">+${result.locationModifier}%</span></div>`);
    }
    if (result.skillLevel > 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Redukcja:</span><span class="tooltip-value">-${result.skillLevel}</span></div>`);
    }
    if (result.hitLocation && result.hitLocation.roll !== null) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Lokacja trafienia:</span><span class="tooltip-value">${result.hitLocation.roll}</span></div>`);
    }
    const tooltipContent = tooltipRows.join('');
    
    // Pobierz penetrację broni (może być nadpisana przez amunicję)
    let penetration = weapon.system.penetration || 0;
    if (weapon.system.selectedAmmo) {
      const ammo = this.actor.items.get(weapon.system.selectedAmmo);
      if (ammo && ammo.system.isOverriding) {
        penetration = ammo.system.overrides.penetration || penetration;
      }
    }
    
    // Prepare damage application data if hit
    let damageApplicationData = null;
    if (isHit && result.damageType) {
      // Get targeted token (the one with red border)
      const targetedToken = Array.from(game.user.targets)[0];
      const targetedActor = targetedToken?.actor || null;
      
      damageApplicationData = {
        attackerId: this.actor.id,
        weaponName: weapon.name,
        damageType: result.damageType,
        location: result.hitLocation.key,
        locationName: result.hitLocation.name,
        hitCount: result.bulletsHit || 1,
        penetration: penetration,
        targetedActorId: targetedActor?.id || null,
        targetedActor: targetedActor ? {
          id: targetedActor.id,
          name: targetedActor.name,
          img: targetedActor.img
        } : null,
        armorInfo: null,
        weakPoint: false
      };
      
      // Get armor info if target exists
      if (targetedActor) {
        const { getArmorAtLocation, isWeakPoint } = await import("../helpers/combat-utils.mjs");
        const locationKey = CONFIG.NEUROSHIMA.locationMapping[result.hitLocation.key] || result.hitLocation.key;
        const armor = getArmorAtLocation(targetedActor, locationKey);
        const weakPoint = isWeakPoint(targetedActor, locationKey);
        const effectiveArmor = Math.max(0, armor - penetration);
        
        damageApplicationData.armorInfo = {
          armor: armor,
          penetration: penetration,
          penetrationApplied: penetration > 0,
          effectiveArmor: effectiveArmor
        };
        damageApplicationData.weakPoint = weakPoint;
      }
    }
    
    // Render template
    const templateData = {
      tooltipContent,
      difficultyName,
      weaponName: weapon.name,
      actionTypeText: 'STRZAŁ',
      skillName,
      attributeName,
      diceDisplay,
      hitClass,
      hitText,
      successes: result.successes,
      totalDice: result.dice.length,
      bulletsHit: result.bulletsHit,
      bulletsFired: result.bulletsFired,
      successPoints: result.successPoints,
      hitLocation: result.hitLocation,
      damageType: result.damageType,
      damageTypeName: damageTypeNames[result.damageType] || result.damageType,
      isGM: game.user.isGM,
      ...damageApplicationData
    };
    
    const flavorContent = await renderTemplate(
      "systems/neuroshima/templates/chat/attack-roll.hbs",
      templateData
    );
    
    // Wyślij do chatu z animacją kości (kompatybilne z Dice So Nice)
    await result.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: flavorContent,
      rollMode: game.settings.get('core', 'rollMode'),
      flags: {
        neuroshima: {
          damageData: damageApplicationData
        }
      }
    });
  }

  /**
   * Deduct ammunition from selected magazine
   * @param {Item} weapon - The weapon item
   * @param {number} bulletsFired - Number of bullets to deduct
   * @private
   */
  async _deductAmmunition(weapon, bulletsFired) {
    // Check if weapon has selected ammunition
    if (!weapon.system.selectedAmmo) {
      console.log('Neuroshima: No ammunition selected for weapon:', weapon.name);
      return;
    }
    
    // Get the selected ammunition item
    const ammoId = weapon.system.selectedAmmo;
    const ammo = this.actor.items.get(ammoId);
    
    if (!ammo) {
      console.warn('Neuroshima: Selected ammunition not found:', ammoId);
      ui.notifications.warn(`Nie znaleziono wybranej amunicji dla ${weapon.name}!`);
      return;
    }
    
    // Get current ammo count
    const currentAmmo = ammo.system.ammo.value || 0;
    
    // Calculate new ammo count (minimum 0)
    const newAmmo = Math.max(0, currentAmmo - bulletsFired);
    
    // Update ammunition
    await ammo.update({
      'system.ammo.value': newAmmo
    });
    
    // Log the deduction
    console.log(`Neuroshima: Deducted ${bulletsFired} bullets from ${ammo.name}. Remaining: ${newAmmo}/${ammo.system.ammo.max}`);
    
    // Show notification if magazine is empty
    if (newAmmo === 0) {
      ui.notifications.warn(`${ammo.name} jest pusty!`);
    }
  }

  /**
   * Handle modifying armor AP for a specific location
   * Left click repairs (decreases damage), right click damages (increases damage)
   * @param {Event} event
   * @private
   */
  async _onModifyAP(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const itemId = event.currentTarget.dataset.itemId;
    const location = event.currentTarget.dataset.location;
    
    console.log('_onModifyAP called:', { itemId, location, eventType: event.type });
    
    const item = this.actor.items.get(itemId);
    
    if (!item) {
      console.error('Item not found:', itemId);
      ui.notifications.warn("Nie znaleziono pancerza!");
      return;
    }
    
    if (!location) {
      console.error('Location not found');
      ui.notifications.warn("Nie znaleziono lokacji!");
      return;
    }
    
    // Get current values
    const maxAP = item.system.protection[location] || 0;
    const currentDamage = item.system.damageAP?.[location] || 0;
    
    console.log('Current values:', { maxAP, currentDamage, protection: item.system.protection, damageAP: item.system.damageAP });
    
    // Determine if this is a repair (left click) or damage (right click)
    const isRepair = event.type === 'click';
    
    let newDamage;
    if (isRepair) {
      // Repair: decrease damage (but not below 0)
      newDamage = Math.max(0, currentDamage - 1);
    } else {
      // Damage: increase damage (but not above max AP)
      newDamage = Math.min(maxAP, currentDamage + 1);
    }
    
    console.log('Updating damage:', { oldDamage: currentDamage, newDamage });
    
    // Update the item
    await item.update({
      [`system.damageAP.${location}`]: newDamage
    });
    
    // Show notification
    const currentAP = maxAP - newDamage;
    const locationName = this._getLocationName(location);
    if (isRepair) {
      ui.notifications.info(`Naprawiono pancerz (${locationName}): ${currentAP}/${maxAP} AP`);
    } else {
      ui.notifications.info(`Uszkodzono pancerz (${locationName}): ${currentAP}/${maxAP} AP`);
    }
  }

  /**
   * Handle modifying armor durability
   * Left click repairs (decreases damage), right click damages (increases damage)
   * @param {Event} event
   * @private
   */
  async _onModifyDurability(event) {
    event.preventDefault();
    
    const itemId = event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(itemId);
    
    if (!item) {
      ui.notifications.warn("Nie znaleziono pancerza!");
      return;
    }
    
    // Get current values
    const maxDurability = item.system.durability?.max || 0;
    const currentDamage = item.system.damageDurability || 0;
    
    // Determine if this is a repair (left click) or damage (right click)
    const isRepair = event.type === 'click';
    
    let newDamage;
    if (isRepair) {
      // Repair: decrease damage (but not below 0)
      newDamage = Math.max(0, currentDamage - 1);
    } else {
      // Damage: increase damage (but not above max durability)
      newDamage = Math.min(maxDurability, currentDamage + 1);
    }
    
    // Update the item
    await item.update({
      "system.damageDurability": newDamage
    });
    
    // Show notification
    const currentDurability = maxDurability - newDamage;
    if (isRepair) {
      ui.notifications.info(`Naprawiono pancerz: ${currentDurability}/${maxDurability} Wytrzymałość`);
    } else {
      ui.notifications.info(`Uszkodzono pancerz: ${currentDurability}/${maxDurability} Wytrzymałość`);
    }
  }

  /**
   * Get localized location name
   * @param {string} location
   * @returns {string}
   * @private
   */
  _getLocationName(location) {
    const locationNames = {
      'head': 'Głowa',
      'torso': 'Tułów',
      'leftHand': 'Lewa Ręka',
      'rightHand': 'Prawa Ręka',
      'leftArm': 'Lewa Ręka',  // Alias for wounds system
      'rightArm': 'Prawa Ręka', // Alias for wounds system
      'leftLeg': 'Lewa Noga',
      'rightLeg': 'Prawa Noga',
      'hands': 'Ręce',  // Legacy support
      'legs': 'Nogi',   // Legacy support
      'other': 'Inne'
    };
    return locationNames[location] || location;
  }

  /* -------------------------------------------- */

  /**
   * Calculate total wound penalty
   * @returns {number}
   * @private
   */
  _getTotalWoundPenalty() {
    let totalPenalty = 0;
    
    // Add active wounds from items
    const woundItems = this.actor.items.filter(i => i.type === 'wounds');
    woundItems.forEach(wound => {
      if (wound.system.active && wound.system.penalty) {
        totalPenalty += parseInt(wound.system.penalty) || 0;
      }
    });
    
    return totalPenalty;
  }

  /**
   * Calculate current health value from wound points
   * @returns {number}
   * @private
   */
  _getCurrentHealthValue() {
    let totalDamage = 0;
    
    // Add damage points from active wounds
    const woundItems = this.actor.items.filter(i => i.type === 'wounds');
    woundItems.forEach(wound => {
      if (wound.system.active) {
        // Get damage points from config
        const damageType = CONFIG.NEUROSHIMA.damageTypes[wound.system.type];
        const points = damageType ? damageType.points : 0;
        totalDamage += points;
      }
    });
    
    return totalDamage;
  }

  /**
   * Calculate total armor penalty
   * @returns {number}
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
   * Get ammunition name by ID
   * @param {string} ammoId
   * @returns {string}
   * @private
   */
  _getAmmoName(ammoId) {
    if (!ammoId) return "";
    const ammo = this.actor.items.get(ammoId);
    return ammo ? ammo.name : "Nieznana amunicja";
  }

  /**
   * Handle wound active toggle icon click
   * @param {Event} event
   * @private
   */
  async _onWoundActiveToggle(event) {
    event.preventDefault();
    const icon = event.currentTarget;
    const itemId = icon.dataset.itemId;
    
    const wound = this.actor.items.get(itemId);
    if (wound) {
      const currentState = wound.system.active;
      await wound.update({
        "system.active": !currentState
      });
    }
  }

  /**
   * Handle wound healing toggle icon click
   * @param {Event} event
   * @private
   */
  async _onWoundHealingToggle(event) {
    event.preventDefault();
    const icon = event.currentTarget;
    const itemId = icon.dataset.itemId;
    
    const wound = this.actor.items.get(itemId);
    if (wound) {
      const currentState = wound.system.healing;
      await wound.update({
        "system.healing": !currentState
      });
    }
  }

  /**
   * Handle equipment toggle using Font Awesome icon (armor and weapons)
   * @param {Event} event
   * @private
   */
  async _onEquipmentToggle(event) {
    event.preventDefault();
    const icon = event.currentTarget;
    const itemId = icon.dataset.itemId;
    
    const item = this.actor.items.get(itemId);
    if (item) {
      const currentState = item.system.equipable;
      const newState = !currentState;
      
      console.log('Neuroshima: Equipment toggle for item:', itemId, 'from:', currentState, 'to:', newState);
      
      await item.update({
        "system.equipable": newState
      });
      
      // Refresh the sheet to recalculate armor
      this.render(false);
    }
  }

  /**
   * Handle item quantity modification
   * Left click: +1 (or +10 with Ctrl)
   * Right click: -1 (or -10 with Ctrl)
   * @param {Event} event
   * @private
   */
  async _onModifyQuantity(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const itemId = element.dataset.itemId;
    
    const item = this.actor.items.get(itemId);
    if (!item) return;
    
    const currentQuantity = item.system.quantity || 0;
    const isCtrlPressed = event.ctrlKey || event.metaKey;
    const isRightClick = event.type === 'contextmenu';
    
    // Determine the change amount
    let change = 1;
    if (isCtrlPressed) {
      change = 10;
    }
    
    // Apply the change based on click type
    let newQuantity = currentQuantity;
    if (isRightClick) {
      newQuantity = Math.max(0, currentQuantity - change);
    } else {
      newQuantity = currentQuantity + change;
    }
    
    console.log('Neuroshima: Quantity change for item:', itemId, 'from:', currentQuantity, 'to:', newQuantity);
    
    await item.update({
      "system.quantity": newQuantity
    });
    
    // No need to refresh - Foundry will update the display automatically
  }

  /**
   * Handle equipment checkbox change (armor and weapons)
   * @param {Event} event
   * @private
   */
  async _onEquipmentChange(event) {
    event.preventDefault();
    const checkbox = event.currentTarget;
    const isEquipped = checkbox.checked;
    
    // Get item ID from the checkbox name attribute
    // Format: items.{itemId}.system.equipable
    const name = checkbox.name;
    const itemId = name.split('.')[1];
    
    console.log('Neuroshima: Equipment checkbox changed for item:', itemId, 'equipped:', isEquipped);
    
    const item = this.actor.items.get(itemId);
    if (item) {
      await item.update({
        "system.equipable": isEquipped
      });
      
      // Refresh the sheet to recalculate armor
      this.render(false);
    }
  }

  /**
   * Show wound creation dialog
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
              
              // Get count (default to 1 if not specified)
              const count = parseInt(data.count) || 1;
              
              // Create wound items (one or multiple)
              const items = [];
              for (let i = 0; i < count; i++) {
                const itemData = {
                  name: data.name || "Nowe obrażenie",
                  type: "wounds",
                  system: {
                    location: data.location,
                    type: data.type,
                    penalty: parseInt(data.penalty) || 0,
                    active: true // Domyślnie aktywne
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
                
                // Escape HTML entities in tooltip content for safe attribute usage
                const escapeHtml = (text) => {
                  const map = {
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#039;'
                  };
                  return text.replace(/[&<>"']/g, m => map[m]);
                };
                
                // Send consolidated chat notification with test summary
                const speaker = ChatMessage.getSpeaker({ actor: this.actor });
                const damageTypeName = CONFIG.NEUROSHIMA.damageTypes[data.type]?.name || data.type;
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
   * Show weapon type selection dialog
   * @private
   */
  async _onWeaponCreate(event) {
    event.preventDefault();
    const template = "systems/neuroshima/templates/dialog/weapon-type-dialog.hbs";
    const html = await renderTemplate(template, {});
    
    return new Promise(resolve => {
      new Dialog({
        title: "Wybierz typ broni", 
        content: html,
        buttons: {
          create: {
            icon: '<i class="fas fa-check"></i>',
            label: "Stwórz",
            callback: async html => {
              const form = html[0].querySelector("form");
              const fd = new FormDataExtended(form);
              const data = fd.object;
              
              const weaponType = data.weaponType;
              const weaponNames = {
                'weapon-melee': 'Nowa broń biała',
                'weapon-ranged': 'Nowa broń strzelecka',
                'weapon-thrown': 'Nowa broń miotana'
              };
              
              // Create weapon item
              const itemData = {
                name: weaponNames[weaponType] || 'Nowa broń',
                type: weaponType,
                system: {}
              };
              
              const item = await Item.create(itemData, {parent: this.actor});
              resolve(item);
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
   * Restore collapsed sections state from actor flags
   * @param {jQuery} html
   * @private
   */
  _restoreCollapsedSections(html) {
    const collapsedSections = this.actor.getFlag('neuroshima', 'collapsedSections') || {};
    
    for (const [sectionName, isCollapsed] of Object.entries(collapsedSections)) {
      if (isCollapsed) {
        const sectionContent = html.find(`[data-section-content="${sectionName}"]`);
        const toggleButton = html.find(`[data-section="${sectionName}"].section-collapse-toggle`);
        
        if (sectionContent.length) {
          sectionContent.addClass('collapsed');
        }
        if (toggleButton.length) {
          toggleButton.addClass('collapsed');
        }
      }
    }
  }

  /**
   * Handle section collapse toggle
   * @param {Event} event
   * @private
   */
  async _onSectionCollapseToggle(event) {
    event.preventDefault();
    const button = $(event.currentTarget);
    const sectionName = button.data('section');
    const sectionContent = this.element.find(`[data-section-content="${sectionName}"]`);
    
    // Toggle collapsed state
    const isCollapsed = sectionContent.hasClass('collapsed');
    sectionContent.toggleClass('collapsed');
    button.toggleClass('collapsed');
    
    // Save state to actor flags
    const collapsedSections = this.actor.getFlag('neuroshima', 'collapsedSections') || {};
    collapsedSections[sectionName] = !isCollapsed;
    await this.actor.setFlag('neuroshima', 'collapsedSections', collapsedSections);
  }

  /* -------------------------------------------- */

  /**
   * Handle creating a new trick
   * @param {Event} event   The originating click event
   * @private
   */
  async _onTrickCreate(event) {
    event.preventDefault();
    
    const itemData = {
      name: "Nowa sztuczka",
      type: "trick",
      system: {
        description: "",
        requirements: []
      }
    };
    
    const item = await Item.create(itemData, {parent: this.actor});
    if (item) {
      item.sheet.render(true);
    }
  }

  /**
   * Handle editing a trick
   * @param {Event} event   The originating click event
   * @private
   */
  _onTrickEdit(event) {
    event.preventDefault();
    const itemId = $(event.currentTarget).data("itemId");
    const item = this.actor.items.get(itemId);
    if (item) {
      item.sheet.render(true);
    }
  }

  /**
   * Handle deleting a trick
   * @param {Event} event   The originating click event
   * @private
   */
  async _onTrickDelete(event) {
    event.preventDefault();
    const itemId = $(event.currentTarget).data("itemId");
    const item = this.actor.items.get(itemId);
    
    if (item) {
      const confirmed = await Dialog.confirm({
        title: "Usuń sztuczkę",
        content: `<p>Czy na pewno chcesz usunąć sztuczkę <strong>${item.name}</strong>?</p>`,
        yes: () => true,
        no: () => false
      });
      
      if (confirmed) {
        await item.delete();
        this.render(false);
      }
    }
  }

  /**
   * Handle toggling trick summary visibility
   * @param {Event} event   The originating click event
   * @private
   */
  _onTrickToggle(event) {
    event.preventDefault();
    const itemId = $(event.currentTarget).data("itemId");
    const summary = $(event.currentTarget).closest('.trick-item').find('.trick-summary');
    
    // Toggle visibility with slide animation
    summary.slideToggle(200);
  }

  /* -------------------------------------------- */

  /**
   * Handle the beginning of a drag event for an item
   * @param {DragEvent} event   The originating drag event
   * @private
   */
  _onDragStart(event) {
    const element = event.currentTarget;
    const itemId = element.dataset.itemId;
    
    if (!itemId) return;
    
    const item = this.actor.items.get(itemId);
    if (!item) return;
    
    // Set the drag data
    const dragData = item.toDragData();
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  /* -------------------------------------------- */

}