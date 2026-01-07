import {onManageActiveEffect, prepareActiveEffectCategories} from "../helpers/effects.mjs";
import {NeuroshimaDiceRoller} from "../../dice-roller.js";
import { createDamageData, createDamageChatMessage } from "../helpers/combat-utils.mjs";
import { getDamageTypeName, getDifficultyName, shouldDebug } from "../helpers/utils.mjs";

/**
 * Extend the basic ActorSheet for Beast type
 * @extends {ActorSheet}
 */
export class NeuroshimaBeastSheet extends ActorSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["neuroshima", "sheet", "actor", "beast"],
      template: "systems/neuroshima/templates/actor/actor-beast-sheet.hbs",
      width: 900,
      height: 800,
      minWidth: 900,
      minHeight: 800,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "attributes" }]
    });
  }

  /** @override */
  get template() {
    return `systems/neuroshima/templates/actor/actor-beast-sheet.hbs`;
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
    const context = super.getData();
    const actorData = this.document.toObject(false);

    context.system = actorData.system;
    context.flags = actorData.flags;
    
    // Ensure health is properly initialized
    if (!context.system.health) {
      context.system.health = { value: 0, max: 27 };
    }
    
    // Ensure action tracking is properly initialized
    if (!context.system.actionTracking) {
      context.system.actionTracking = { currentSuccesses: 0, maxSuccesses: 3 };
    }

    // Prepare beast data and items
    if (actorData.type == 'beast') {
      this._prepareItems(context);
      this._prepareBeastData(context);
    }

    // Add roll data for TinyMCE editors
    context.rollData = context.actor.getRollData();

    // Prepare active effects
    context.effects = prepareActiveEffectCategories(this.actor.effects);

    // Add system config
    context.config = CONFIG.NEUROSHIMA;

    // Add collapsed sections state
    context.collapsedSections = this.actor.getFlag('neuroshima', 'collapsedSections') || {};

    return context;
  }

  /**
   * Prepare Beast-specific data
   * @param {Object} context
   * @private
   */
  _prepareBeastData(context) {
    // Handle ability scores
    for (let [k, v] of Object.entries(context.system.attributes)) {
      v.label = game.i18n.localize(CONFIG.NEUROSHIMA.attributes[k]) ?? k;
    }
  }

  /**
   * Organize and classify Items for Beast sheets
   * @param {Object} context
   * @private
   */
  _prepareItems(context) {
    // Initialize containers
    const beastActions = [];
    const wounds = [];

    // Iterate through items, allocating to containers
    for (let i of context.items) {
      i.img = i.img || DEFAULT_TOKEN;
      
      // Classify by type
      if (i.type === 'beast-action') {
        beastActions.push(i);
      }
      else if (i.type === 'wounds') {
        wounds.push(i);
      }
    }

    // Assign to context
    context.beastActions = beastActions;
    context.wounds = wounds;
    
    // Add helper functions to context
    context.getTotalWoundPenalty = this._getTotalWoundPenalty();
    context.getCurrentHealthValue = this._getCurrentHealthValue();
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Update specialization display
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

    // Open item sheet when clicking on wound name
    html.find('.wound-name').click(ev => {
      const woundEntry = $(ev.currentTarget).closest(".wound-entry");
      const itemId = woundEntry.data("itemId");
      const item = this.actor.items.get(itemId);
      if (item) {
        item.sheet.render(true);
      }
    });

    // Open wound sheet when clicking edit icon
    html.find('.wound-entry .item-edit').click(ev => {
      const li = $(ev.currentTarget).parents(".item");
      const item = this.actor.items.get(li.data("itemId"));
      if (item) {
        item.sheet.render(true);
      }
    });

    // Roll attack when clicking on beast action name
    html.find('.beast-actions-section .weapon-name-rollable').click(ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const itemId = $(ev.currentTarget).closest('.equipment-item').data("itemId");
      const fakeEvent = {
        preventDefault: () => {},
        currentTarget: { dataset: { itemId: itemId } }
      };
      this._onRollBeastAction(fakeEvent);
    });

    // Open action sheet when clicking edit icon
    html.find('.beast-actions-section .weapon-edit-icon').click(ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const itemId = $(ev.currentTarget).data("itemId");
      const item = this.actor.items.get(itemId);
      if (item) {
        item.sheet.render(true);
      }
    });

    // Delete beast action when clicking delete icon
    html.find('.beast-actions-section .weapon-delete-icon').click(ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const itemId = $(ev.currentTarget).data("itemId");
      const item = this.actor.items.get(itemId);
      if (item) {
        item.delete();
      }
    });

    // Reset successes to 0
    html.find('.reset-successes-button').click(ev => {
      ev.preventDefault();
      this.actor.update({ 'system.actionTracking.currentSuccesses': 0 });
      ui.notifications.info('Sukcesy zresetowane na 0');
    });

    // -------------------------------------------------------------
    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    // Add Item
    html.find('.item-create').click(this._onItemCreate.bind(this));

    // Delete Item
    html.find('.item-delete').click(ev => {
      const li = $(ev.currentTarget).parents(".wound-entry");
      const item = this.actor.items.get(li.data("itemId"));
      if (item) {
        item.delete();
        li.slideUp(200, () => this.render(false));
      }
    });

    // Wound active toggle icon
    html.find('.wound-active-toggle').click(this._onWoundActiveToggle.bind(this));

    // Wound healing toggle icon
    html.find('.wound-healing-toggle').click(this._onWoundHealingToggle.bind(this));

    // Rollable abilities (attribute tests)
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

    // Active Effect management
    html.find(".effect-control").click(ev => onManageActiveEffect(ev, this.actor));
  }

  /* -------------------------------------------- */

  /**
   * Handle creating a new Owned Item for the actor
   * @param {Event} event
   * @private
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    const type = header.dataset.type;
    
    // Special handling for wounds - show creation dialog
    if (type === 'wounds') {
      return this._showWoundCreationDialog();
    }
    
    // Standard item creation for beast-action
    const itemData = {
      name: 'Nowa akcja',
      type: type,
      system: {}
    };
    
    return await Item.create(itemData, {parent: this.actor});
  }

  /* -------------------------------------------- */

  /**
   * Handle rolling a beast action using the 3k20 system
   * Supports two action systems: successes (roll first, then select action) and segments (select action first, then roll)
   * @param {Event} event
   * @private
   */
  async _onRollBeastAction(event) {
    event.preventDefault();
    const itemId = event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(itemId);
    
    if (!item) return;

    const actionSystem = item.system.actionSystem || 'successes';
    
    // Route to appropriate handler based on action system
    if (actionSystem === 'segments') {
      await this._handleSegmentSystemRoll(item);
    } else {
      await this._handleSuccessSystemRoll(item);
    }
  }
  
  /**
   * Handle success system: Roll 3k20 first, then allow action selection if conditions met
   * @param {Object} item - Beast action item
   * @private
   */
  async _handleSuccessSystemRoll(item) {
    const attribute = item.system.attribute || 'zr';
    const skill = item.system.skill || 'bijatyka';
    const attributeValue = this.actor.system.attributes[attribute]?.value || 5;
    const attributeMod = this.actor.system.attributes[attribute]?.mod || 0;
    const skillValue = this.actor.system.skills[attribute]?.[skill] || 0;
    
    // Check if specialized
    const specializationKey = this._getSpecializationKeyForSkill(skill);
    const isSpecialized = specializationKey ? 
      this.actor.system.specializations?.categories?.[specializationKey] : false;
    
    // Calculate total wound penalty
    const woundPenalty = this._getTotalWoundPenalty();
    
    // Difficulty levels with percentage bases (for difficulty selection)
    const difficulties = [
      { key: 'easy', name: 'Łatwy', base: -20 },
      { key: 'average', name: 'Przeciętny', base: 0 },
      { key: 'problematic', name: 'Problematyczny', base: 11 },
      { key: 'hard', name: 'Trudny', base: 31 },
      { key: 'veryHard', name: 'Bardzo Trudny', base: 61 },
      { key: 'damnHard', name: 'Cholernie Trudny', base: 91 },
      { key: 'luck', name: 'Fart', base: 121 }
    ];
    
    // Threshold modifiers (for dice-roller.js calculation)
    const difficultyMods = {
      easy: 2,
      average: 0,
      problematic: -2,
      hard: -5,
      veryHard: -8,
      damnHard: -11,
      luck: -15
    };
    
    // Build difficulty options for dialog with "average" selected by default
    let difficultyOptions = '';
    difficulties.forEach(diff => {
      const selected = diff.key === 'average' ? 'selected' : '';
      difficultyOptions += `<option value="${diff.key}" ${selected}>${diff.name}</option>`;
    });
    
    // Show dialog to choose difficulty (test type is always closed for beast actions)
    const options = await new Promise((resolve) => {
      new Dialog({
        title: `Test: ${item.name}`,
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
                  
                  ${woundPenalty > 0 ? `
                    <div class="modifier-item">
                      <label class="modifier-checkbox">
                        <input type="checkbox" name="applyWoundPenalty" checked />
                        <span class="modifier-label">Obrażenia</span>
                      </label>
                      <span class="modifier-value">+${woundPenalty}%</span>
                    </div>
                  ` : ''}
                  
                  ${isSpecialized ? `
                    <div class="modifier-item" style="background-color: #d4f4d4;">
                      <span style="color: #2d5016; font-weight: bold; font-size: 11px;">
                        ✓ SPECJALIZACJA (+2 do progu)
                      </span>
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
            callback: html => {
              const formData = new FormData(html[0].querySelector('form'));
              
              // Check which modifiers are selected
              const applyModifier = formData.get('applyModifier') === 'on';
              const applyWoundPenalty = formData.get('applyWoundPenalty') === 'on';
              
              const percentageModifier = parseInt(formData.get('percentageModifier')) || 0;
              
              const options = {
                testType: 'closed',  // Beast actions always use closed test
                difficulty: formData.get('difficulty'),
                percentageModifier: applyModifier ? percentageModifier : 0,
                woundPenalty: applyWoundPenalty ? woundPenalty : 0,
                isSpecialized: isSpecialized
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
          // Add event listeners to all controls
          html.find('[name="difficulty"], [name="percentageModifier"], [name="applyModifier"], [name="applyWoundPenalty"]').on('change', () => {
            this._updateBeastDifficultyPreview(html, difficulties, woundPenalty);
          });
          // Call once at the beginning
          this._updateBeastDifficultyPreview(html, difficulties, woundPenalty);
        }
      }, { width: 450, classes: ["neuroshima", "neuroshima-dialog"] }).render(true);
    });
    
    if (!options) return;
    
    // Calculate final attribute value with modifiers
    const finalAttributeValue = attributeValue + attributeMod + (isSpecialized ? 2 : 0);
    
    // Calculate total percentage modifier (custom modifier + wound penalty)
    const totalPercentageModifier = options.percentageModifier + options.woundPenalty;
    
    // Prepare roll name
    const skillName = CONFIG.NEUROSHIMA.skills?.[attribute]?.[skill] || skill;
    const rollName = `${item.name} (${skillName})`;
    
    try {
      // Perform roll using dice-roller.js
      const result = await NeuroshimaDiceRoller.performRoll(
        this.actor,                    // actor
        rollName,                      // rollName
        skillValue,                    // rollLevel (skill value)
        finalAttributeValue,           // attributeValue (includes specialization)
        options.difficulty,            // difficulty
        difficultyMods,                // difficultyMods (threshold modifiers)
        options.testType,              // testType
        'skill',                       // rollType
        attribute,                     // attributeKey
        totalPercentageModifier        // percentageModifier (custom + wound penalty)
      );
      
      // Update actor's current successes - add to existing pool but cap at maxSuccesses
      const successCount = result.neuroshimaData.successCount;
      const currentSuccesses = this.actor.system.actionTracking?.currentSuccesses || 0;
      const maxSuccesses = this.actor.system.actionTracking?.maxSuccesses || 3;
      const newSuccesses = Math.min(currentSuccesses + successCount, maxSuccesses);
      
      if (shouldDebug()) console.log(`[Neuroshima Beast] Roll completed: successCount=${successCount}, currentSuccesses=${currentSuccesses}, newSuccesses=${newSuccesses}`);
      
      await this.actor.update({ 'system.actionTracking.currentSuccesses': newSuccesses });
      
      // Warn if at max capacity
      if (newSuccesses >= maxSuccesses && successCount > 0) {
        ui.notifications.warn(`Pula sukcesów osiągnęła limit: ${newSuccesses}/${maxSuccesses}. Resetuj sukcesy przyciskiem ↻ gdy zakończy się tura.`);
      }
      
      // Display result in chat with beast action details (success system)
      // Pass newSuccesses so the button displays correct value
      await this._displayBeastActionResult(result, item, options, 'successes', null, newSuccesses);
      
    } catch (error) {
      console.error('Błąd podczas wykonywania rzutu beast-action:', error);
      ui.notifications.error('Wystąpił błąd podczas wykonywania rzutu!');
    }
  }
  
  /**
   * Handle segment system: Select action first, then roll 3k20 (no reduction)
   * @param {Object} item - Beast action item
   * @private
   */
  async _handleSegmentSystemRoll(item) {
    // First, show action selection dialog
    const selectedAction = await this._showActionSelectionDialog(item, 'segments');
    
    if (!selectedAction) return;
    
    // Now perform the roll (no reduction for segment system)
    const attribute = item.system.attribute || 'zr';
    const skill = item.system.skill || 'bijatyka';
    const attributeValue = this.actor.system.attributes[attribute]?.value || 5;
    const attributeMod = this.actor.system.attributes[attribute]?.mod || 0;
    
    // Check if specialized
    const specializationKey = this._getSpecializationKeyForSkill(skill);
    const isSpecialized = specializationKey ? 
      this.actor.system.specializations?.categories?.[specializationKey] : false;
    
    // Calculate total wound penalty
    const woundPenalty = this._getTotalWoundPenalty();
    
    // Difficulty levels
    const difficulties = [
      { key: 'easy', name: 'Łatwy', base: -20 },
      { key: 'average', name: 'Przeciętny', base: 0 },
      { key: 'problematic', name: 'Problematyczny', base: 11 },
      { key: 'hard', name: 'Trudny', base: 31 },
      { key: 'veryHard', name: 'Bardzo Trudny', base: 61 },
      { key: 'damnHard', name: 'Cholernie Trudny', base: 91 },
      { key: 'luck', name: 'Fart', base: 121 }
    ];
    
    const difficultyMods = {
      easy: 2,
      average: 0,
      problematic: -2,
      hard: -5,
      veryHard: -8,
      damnHard: -11,
      luck: -15
    };
    
    let difficultyOptions = '';
    difficulties.forEach(diff => {
      const selected = diff.key === 'average' ? 'selected' : '';
      difficultyOptions += `<option value="${diff.key}" ${selected}>${diff.name}</option>`;
    });
    
    // Show difficulty dialog
    const options = await new Promise((resolve) => {
      new Dialog({
        title: `Test: ${selectedAction.name}`,
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
                  
                  ${woundPenalty > 0 ? `
                    <div class="modifier-item">
                      <label class="modifier-checkbox">
                        <input type="checkbox" name="applyWoundPenalty" checked />
                        <span class="modifier-label">Obrażenia</span>
                      </label>
                      <span class="modifier-value">+${woundPenalty}%</span>
                    </div>
                  ` : ''}
                  
                  ${isSpecialized ? `
                    <div class="modifier-item" style="background-color: #d4f4d4;">
                      <span style="color: #2d5016; font-weight: bold; font-size: 11px;">
                        ✓ SPECJALIZACJA (+2 do progu)
                      </span>
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
            callback: html => {
              const formData = new FormData(html[0].querySelector('form'));
              
              const applyModifier = formData.get('applyModifier') === 'on';
              const applyWoundPenalty = formData.get('applyWoundPenalty') === 'on';
              
              const percentageModifier = parseInt(formData.get('percentageModifier')) || 0;
              
              const options = {
                testType: 'closed',
                difficulty: formData.get('difficulty'),
                percentageModifier: applyModifier ? percentageModifier : 0,
                woundPenalty: applyWoundPenalty ? woundPenalty : 0,
                isSpecialized: isSpecialized
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
          html.find('[name="difficulty"], [name="percentageModifier"], [name="applyModifier"], [name="applyWoundPenalty"]').on('change', () => {
            this._updateBeastDifficultyPreview(html, difficulties, woundPenalty);
          });
          this._updateBeastDifficultyPreview(html, difficulties, woundPenalty);
        }
      }, { width: 450, classes: ["neuroshima", "neuroshima-dialog"] }).render(true);
    });
    
    if (!options) return;
    
    // Calculate final attribute value
    const finalAttributeValue = attributeValue + attributeMod + (isSpecialized ? 2 : 0);
    const totalPercentageModifier = options.percentageModifier + options.woundPenalty;
    
    const skillName = CONFIG.NEUROSHIMA.skills?.[attribute]?.[skill] || skill;
    const rollName = `${selectedAction.name} (${skillName})`;
    
    try {
      // Perform roll WITHOUT reduction (skillValue = 0 for segment system)
      const result = await NeuroshimaDiceRoller.performRoll(
        this.actor,
        rollName,
        0,                             // NO REDUCTION for segment system
        finalAttributeValue,
        options.difficulty,
        difficultyMods,
        options.testType,
        'skill',
        attribute,
        totalPercentageModifier
      );
      
      // Display result with selected action details
      await this._displayBeastActionResult(result, item, options, 'segments', selectedAction);
      
    } catch (error) {
      console.error('Błąd podczas wykonywania rzutu beast-action (segment system):', error);
      ui.notifications.error('Wystąpił błąd podczas wykonywania rzutu!');
    }
  }
  
  /**
   * Display beast action roll result in chat
   * @param {Object} result - Roll result from dice-roller.js
   * @param {Object} item - Beast action item
   * @param {Object} options - Roll options
   * @param {string} actionSystem - 'successes' or 'segments'
   * @param {Object} selectedAction - Selected action (for segment system)
   * @param {number} passedSuccessCount - Current success count (to avoid stale data)
   * @private
   */
  async _displayBeastActionResult(result, item, options, actionSystem = 'successes', selectedAction = null, passedSuccessCount = null) {
    const rollData = result.neuroshimaData;
    
    // Prepare difficulty name and test type
    const difficultyName = NeuroshimaDiceRoller.getDifficultyName(rollData.difficulty);
    const testTypeText = rollData.testType === 'open' ? 'Otwarty' : 'Zamknięty';
    const targetName = item.name;
    
    // Prepare tooltip with difficulty information (HTML)
    let tooltipRows = [];
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Próg:</span><span class="tooltip-value">${rollData.difficultyValue}</span></div>`);
    
    // Add difficulty information
    const baseDifficulty = rollData.originalPercentage || 0;
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Bazowa trudność:</span><span class="tooltip-value">${baseDifficulty}%</span></div>`);
    
    if (options.percentageModifier && options.percentageModifier !== 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Modyfikator:</span><span class="tooltip-value">${options.percentageModifier >= 0 ? '+' : ''}${options.percentageModifier}%</span></div>`);
    }
    
    if (options.woundPenalty && options.woundPenalty > 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Obrażenia:</span><span class="tooltip-value">+${options.woundPenalty}%</span></div>`);
    }
    
    // Add action details to tooltip (from selectedAction for segments, from item for successes)
    const actionDetails = selectedAction || item.system;
    if (actionDetails.damage) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Obrażenia:</span><span class="tooltip-value">${actionDetails.damage}</span></div>`);
    }
    if (actionDetails.range) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Zasięg:</span><span class="tooltip-value">${actionDetails.range}</span></div>`);
    }
    if (actionDetails.special) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Specjalne:</span><span class="tooltip-value">${actionDetails.special}</span></div>`);
    }
    if (actionDetails.cost && actionSystem === 'segments') {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Koszt segmentów:</span><span class="tooltip-value">${actionDetails.cost}</span></div>`);
    }
    
    const tooltipContent = tooltipRows.join('');
    
    // Format: [Poziom] Test [Typ] na [akcja] + info icon
    const actionName = selectedAction ? selectedAction.name : targetName;
    const headerText = `${difficultyName} Test ${testTypeText} na ${actionName}`;
    
    // Dice results with D1, D2, D3 labels
    const diceText = rollData.diceResults.map((result, index) => {
      // Add class for natural 1 (critical success) or 20 (critical failure)
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
    
    // Reduction section - different for open and closed tests
    let reductionText = '';
    const reductionPoints = rollData.rollLevel || 0;
    
    if (rollData.testType === 'open' && rollData.reducedDice && rollData.reducedDice.length > 0) {
      // OPEN TEST: Show 2 lowest dice after reduction
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
              // Highlight the dice that generates successes (higher value = finalResult)
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
      // CLOSED TEST: Show all 3 dice after reduction
      reductionText = `
        <div class="reduction-section">
          <div class="reduction-header">
            Po redukcji ${reductionPoints} pkt:
          </div>
          <div class="reduction-dice-grid closed-test-grid">
            ${rollData.reducedDice.map((val, idx) => {
              // Highlight dice that are <= threshold (successes)
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
    
    // Success section - different for open and closed tests
    let successSection = '';
    if (rollData.testType === 'open') {
      // Open test: Advantage points
      const advantageText = `Punktów przewagi: ${rollData.successCount}`;
      successSection = `
        <div class="advantage-result">
          <strong>${advantageText}</strong>
        </div>
      `;
    } else if (rollData.testType === 'closed') {
      // Closed test: Number of successes (how many dice <= threshold)
      const successText = `Liczba sukcesów: ${rollData.successCount}`;
      successSection = `
        <div class="closed-test-success">
          <strong>${successText}</strong>
        </div>
      `;
      
      // For success system: Add "Execute Action" button if conditions are met
      if (actionSystem === 'successes') {
        const successCount = rollData.successCount;
        // Use passed success count if available (more reliable than reading from actor cache)
        const currentSuccesses = passedSuccessCount !== null ? passedSuccessCount : (this.actor.system.actionTracking?.currentSuccesses || 0);
        const actions = item.system.actions || [];
        
        // Check if current successes pool has at least 1 success AND there's at least one action affordable with current pool
        const hasValidActions = actions.some(action => action.cost <= currentSuccesses);
        
        if (currentSuccesses >= 1 && hasValidActions) {
          successSection += `
            <div class="execute-action-button-container">
              <button class="execute-beast-action" data-item-id="${item.id}" data-actor-id="${this.actor.id}" data-current-successes="${currentSuccesses}">
                <i class="fas fa-bolt"></i> Wykonaj Akcję (${currentSuccesses} ${currentSuccesses === 1 ? 'sukces' : currentSuccesses <= 4 ? 'sukcesy' : 'sukcesów'})
              </button>
            </div>
          `;
        }
      }
    }
    
    // Build complete message content (same format as actor-sheet.mjs)
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

    // Send to chat with dice animation (compatible with Dice So Nice)
    await result.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: content,
      rollMode: game.settings.get('core', 'rollMode')
    });
    
    // For segment system: If selected action has damage, show action execution immediately
    if (actionSystem === 'segments' && selectedAction && selectedAction.damage && selectedAction.actionType === 'attack') {
      await this._displayActionExecution(selectedAction, item, 0, 0);
    }
  }

  /* -------------------------------------------- */

  /**
   * Display action execution in chat (after selecting action from success roll)
   * @param {Object} action - Selected action
   * @param {Object} item - Beast action item
   * @param {number} previousSuccesses - Success count before action
   * @param {number} newSuccesses - Success count after action
   * @private
   */
  async _displayActionExecution(action, item, previousSuccesses, newSuccesses) {
    // Roll hit location if this is an attack
    let hitLocation = null;
    let locationKey = null;
    if (action.damage && action.actionType === 'attack') {
      const { rollHitLocation } = await import("../helpers/combat-utils.mjs");
      locationKey = rollHitLocation('random');
      hitLocation = CONFIG.NEUROSHIMA.hitLocations[locationKey];
    }
    
    // Prepare damage application data if attack
    let damageApplicationData = null;
    if (action.damage && action.actionType === 'attack') {
      // Get targeted token (the one with red border)
      const targetedToken = Array.from(game.user.targets)[0];
      const targetedActor = targetedToken?.actor || null;
      
      const damageCount = action.damageCount || 1;
      damageApplicationData = {
        attackerId: this.actor.id,
        weaponName: `${item.name} - ${action.name}`,
        damageType: action.damage,
        location: locationKey,
        locationName: hitLocation.name,
        hitCount: damageCount,
        penetration: 0, // Beast actions don't have penetration
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
        const mappedLocationKey = CONFIG.NEUROSHIMA.locationMapping[locationKey] || locationKey;
        const armor = getArmorAtLocation(targetedActor, mappedLocationKey);
        const weakPoint = isWeakPoint(targetedActor, mappedLocationKey);
        
        damageApplicationData.armorInfo = {
          armor: armor,
          penetration: 0,
          penetrationApplied: false,
          effectiveArmor: armor
        };
        damageApplicationData.weakPoint = weakPoint;
      }
    }
    
    // Build content with integrated damage application
    const content = `
      <div class="neuroshima-action-execution">
        <h3><i class="fas fa-bolt"></i> Wykonanie Akcji</h3>
        <div class="action-execution-details">
          <div class="action-execution-name"><strong>${action.name}</strong></div>
          <div class="action-execution-stats">
            ${action.damage ? `<div class="stat-row"><span class="stat-label">Obrażenia:</span> <span class="stat-value">${getDamageTypeName(action.damage)}</span></div>` : ''}
            ${hitLocation ? `<div class="stat-row"><span class="stat-label">Lokacja:</span> <span class="stat-value">${hitLocation.name}</span></div>` : ''}
            ${action.range ? `<div class="stat-row"><span class="stat-label">Zasięg:</span> <span class="stat-value">${action.range}</span></div>` : ''}
            ${action.special ? `<div class="stat-row"><span class="stat-label">Specjalne:</span> <span class="stat-value">${action.special}</span></div>` : ''}
            ${action.description ? `<div class="stat-row"><span class="stat-label">Opis:</span> <span class="stat-value">${action.description}</span></div>` : ''}
          </div>
          <div class="action-execution-cost">
            <div class="cost-row">
              <span class="cost-label">Koszt akcji:</span> <span class="cost-value">${action.cost} sukcesów</span>
            </div>
            <div class="cost-row">
              <span class="cost-label">Pozostałe sukcesy:</span> <span class="cost-value">${newSuccesses} / ${previousSuccesses}</span>
            </div>
          </div>
        </div>
        
        ${damageApplicationData ? await this._renderDamageApplicationSection(damageApplicationData) : ''}
      </div>
    `;
    
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: content,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      flags: {
        neuroshima: {
          damageData: damageApplicationData
        }
      }
    });
  }
  
  /**
   * Render damage application section for beast actions
   * @param {Object} damageData - Damage application data
   * @returns {Promise<string>} Rendered HTML
   * @private
   */
  async _renderDamageApplicationSection(damageData) {
    return await renderTemplate(
      "systems/neuroshima/templates/chat/damage-application-section.hbs",
      damageData
    );
  }

  /* -------------------------------------------- */

  /**
   * Show action selection dialog
   * @param {Object} item - Beast action item
   * @param {string} systemType - 'successes' or 'segments'
   * @param {number} availableSuccesses - Available successes (for success system)
   * @returns {Promise<Object|null>} Selected action or null if cancelled
   * @private
   */
  async _showActionSelectionDialog(item, systemType = 'segments', availableSuccesses = 0) {
    const actions = item.system.actions || [];
    
    if (actions.length === 0) {
      ui.notifications.warn('Brak zdefiniowanych akcji w tym zestawie!');
      return null;
    }
    
    // Filter actions based on system type
    let availableActions = actions;
    if (systemType === 'successes') {
      // Only show actions with cost <= available successes
      if (shouldDebug()) console.log(`[Neuroshima] Filtering actions: availableSuccesses=${availableSuccesses}, totalActions=${actions.length}`);
      availableActions = actions.filter(action => {
        if (shouldDebug()) console.log(`[Neuroshima] Checking action '${action.name}': cost=${action.cost}, available=${availableSuccesses}, canUse=${action.cost <= availableSuccesses}`);
        return action.cost <= availableSuccesses;
      });
      
      if (availableActions.length === 0) {
        const actionsList = actions.map(a => `${a.name} (koszt: ${a.cost})`).join(', ');
        ui.notifications.warn(`Brak akcji dostępnych dla tej liczby sukcesów! (${availableSuccesses})\nDostępne akcje: ${actionsList}`);
        return null;
      }
    }
    
    // Build action list HTML
    const actionListHTML = availableActions.map((action, index) => {
      const costLabel = systemType === 'segments' ? 'Segmenty' : 'Sukcesy';
      return `
        <div class="action-selection-item" data-action-index="${actions.indexOf(action)}">
          <div class="action-selection-radio">
            <input type="radio" name="selectedAction" value="${actions.indexOf(action)}" id="action-${index}" ${index === 0 ? 'checked' : ''}/>
          </div>
          <label for="action-${index}" class="action-selection-label">
            <div class="action-selection-name">${action.name}</div>
            <div class="action-selection-details">
              <span class="action-detail-item"><strong>Koszt:</strong> ${action.cost} ${costLabel}</span>
              ${action.damage ? `<span class="action-detail-item"><strong>Obrażenia:</strong> ${action.damageCount || 1}x ${action.damage}</span>` : ''}
              ${action.range ? `<span class="action-detail-item"><strong>Zasięg:</strong> ${action.range}</span>` : ''}
              ${action.special ? `<span class="action-detail-item"><strong>Specjalne:</strong> ${action.special}</span>` : ''}
            </div>
            ${action.description ? `<div class="action-selection-description">${action.description}</div>` : ''}
          </label>
        </div>
      `;
    }).join('');
    
    return new Promise((resolve) => {
      new Dialog({
        title: `Wybierz Akcję: ${item.name}`,
        content: `
          <form class="action-selection-dialog">
            <div class="action-selection-list">
              ${actionListHTML}
            </div>
          </form>
        `,
        buttons: {
          select: {
            icon: '<i class="fas fa-check"></i>',
            label: "Wybierz",
            callback: html => {
              const selectedIndex = parseInt(html.find('[name="selectedAction"]:checked').val());
              resolve(actions[selectedIndex]);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Anuluj",
            callback: () => resolve(null)
          }
        },
        default: "select"
      }, { width: 500, classes: ["neuroshima", "neuroshima-dialog", "action-selection-dialog"] }).render(true);
    });
  }

  /* -------------------------------------------- */

  /**
   * Update difficulty preview in beast action dialog
   * @param {jQuery} html - Dialog HTML
   * @param {Array} difficulties - Difficulty levels array
   * @param {number} woundPenalty - Wound penalty
   * @private
   */
  _updateBeastDifficultyPreview(html, difficulties, woundPenalty = 0) {
    const selectedDifficulty = html.find('[name="difficulty"]').val();
    const percentageModifier = parseInt(html.find('[name="percentageModifier"]').val()) || 0;
    
    // Check which modifiers are selected
    const applyModifier = html.find('[name="applyModifier"]').is(':checked');
    const applyWoundPenalty = html.find('[name="applyWoundPenalty"]').is(':checked');
    
    const activeModifier = applyModifier ? percentageModifier : 0;
    const activeWoundPenalty = applyWoundPenalty ? woundPenalty : 0;
    
    const difficulty = difficulties.find(d => d.key === selectedDifficulty);
    if (difficulty) {
      const finalPercentage = difficulty.base + activeModifier + activeWoundPenalty;
      
      // Build preview in monochromatic style (same as actor-sheet.mjs)
      let preview = `<div class="preview-line">Bazowy: ${difficulty.base}%</div>`;
      
      if (activeModifier !== 0) {
        preview += `<div class="preview-line">Modyfikator: ${activeModifier >= 0 ? '+' : ''}${activeModifier}%</div>`;
      }
      
      if (activeWoundPenalty > 0) {
        preview += `<div class="preview-line">Obrażenia: +${activeWoundPenalty}%</div>`;
      }
      
      preview += `<div class="preview-total">RAZEM: ${finalPercentage}%</div>`;
      
      // Check if this changed the difficulty level
      const newLevel = this.actor._getDifficultyFromPercentage(finalPercentage);
      if (newLevel !== selectedDifficulty) {
        const newDiff = difficulties.find(d => d.key === newLevel);
        preview += `<div class="preview-warning">→ Faktyczny poziom: ${newDiff?.name || 'Nieznany'}</div>`;
      }
      
      // Update preview
      let previewElement = html.find('.difficulty-preview-box');
      previewElement.html(preview);
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle clickable rolls
   * @param {Event} event
   * @private
   */
  _onRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;

    if (dataset.rollType) {
      if (dataset.rollType == 'attribute') {
        const attributeKey = dataset.attribute;
        const attribute = this.actor.system.attributes[attributeKey];
        const label = dataset.label;
        
        const woundPenalty = this._getTotalWoundPenalty();
        let threshold = (attribute.value || 0) + (attribute.mod || 0) - woundPenalty;
        threshold = Math.max(1, threshold);
        
        this._rollAttribute(attributeKey, label, threshold, woundPenalty);
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle skill rolls
   * @param {Event} event
   * @private
   */
  async _onSkillRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    
    const attribute = dataset.attribute;
    const skill = dataset.skill;
    
    // Get roll options from dialog
    const rollOptions = await this._getRollDialog(attribute, skill);
    
    if (!rollOptions) return; // User cancelled
    
    // Execute roll using dice-roller.js
    await this._executeRoll(attribute, skill, rollOptions);
  }

  /* -------------------------------------------- */

  /**
   * Roll an attribute test
   * @param {String} attributeKey
   * @param {String} label
   * @param {Number} threshold
   * @param {Number} woundPenalty
   * @private
   */
  async _rollAttribute(attributeKey, label, threshold, woundPenalty) {
    const roll = new Roll("1d10");
    await roll.evaluate();
    
    const result = roll.total;
    let successLevel = 0;
    
    if (result <= threshold) {
      if (result === 1) successLevel = 3;
      else if (result <= Math.ceil(threshold / 2)) successLevel = 2;
      else successLevel = 1;
    }
    
    const woundPenaltyText = woundPenalty > 0 ? ` <span style="color: #8b2e2e;">(-${woundPenalty}% kara z obrażeń)</span>` : '';
    
    let resultText = '';
    let resultColor = '';
    
    if (successLevel === 3) {
      resultText = '<strong style="color: #2e8b57;">SUKCES KRYTYCZNY!</strong>';
      resultColor = '#2e8b57';
    } else if (successLevel === 2) {
      resultText = '<strong style="color: #4a5c3a;">Podwójny sukces</strong>';
      resultColor = '#4a5c3a';
    } else if (successLevel === 1) {
      resultText = '<strong style="color: #8b5a3c;">Sukces</strong>';
      resultColor = '#8b5a3c';
    } else {
      resultText = '<strong style="color: #8b2e2e;">Porażka</strong>';
      resultColor = '#8b2e2e';
    }
    
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      roll: roll,
      content: `
        <div class="dice-roll">
          <div class="dice-result">
            <h2>Test: ${label}</h2>
            <div><strong>Próg:</strong> ${threshold}${woundPenaltyText}</div>
            <div><strong>Wynik rzutu:</strong> <span style="font-size: 1.5em; color: ${resultColor};">${result}</span></div>
            <div>${resultText}</div>
          </div>
        </div>
      `,
      type: CONST.CHAT_MESSAGE_TYPES.ROLL
    };
    
    ChatMessage.create(chatData);
  }

  /* -------------------------------------------- */

  /**
   * Get specialization key for a skill
   * @param {String} skill
   * @returns {String|null}
   * @private
   */
  _getSpecializationKeyForSkill(skill) {
    const specializationMap = {
      'bijatyka': 'walka_wrecz',
      'bron_reczna': 'walka_wrecz',
      'rzucanie': 'bron_dystansowa',
      'pistolety': 'bron_strzelecka',
      'karabiny': 'bron_strzelecka',
      'bron_maszynowa': 'bron_strzelecka',
      'luk': 'bron_dystansowa',
      'kusza': 'bron_dystansowa',
      'proca': 'bron_dystansowa',
      'samochod': 'prowadzenie_pojazdow',
      'ciezarowka': 'prowadzenie_pojazdow',
      'motocykl': 'prowadzenie_pojazdow',
      'kradziez_kieszonkowa': 'zdolnosci_manualne',
      'zwinne_dlonie': 'zdolnosci_manualne',
      'otwieranie_zamkow': 'zdolnosci_manualne',
      'wyczucie_kierunku': 'orientacja_w_terenie',
      'tropienie': 'orientacja_w_terenie',
      'przygotowanie_pulapki': 'orientacja_w_terenie',
      'nasluchiwanie': 'spostrzegawczosc',
      'wypatrywanie': 'spostrzegawczosc',
      'czujnosc': 'spostrzegawczosc',
      'skradanie_sie': 'kamuflaz',
      'ukrywanie_sie': 'kamuflaz',
      'maskowanie': 'kamuflaz',
      'lowiectwo': 'przetrwanie',
      'zdobywanie_wody': 'przetrwanie',
      'znajomosc_terenu': 'przetrwanie',
      'perswazja': 'negocjacje',
      'zastraszanie': 'negocjacje',
      'zdolnosci_przywodcze': 'negocjacje',
      'postrzeganie_emocji': 'empatia',
      'blef': 'empatia',
      'opieka_nad_zwierzetami': 'empatia',
      'odpornosc_na_bol': 'sila_woli',
      'niezlomnosc': 'sila_woli',
      'morale': 'sila_woli',
      'leczenie_ran': 'medycyna',
      'leczenie_chorob': 'medycyna',
      'pierwsza_pomoc': 'medycyna',
      'mechanika': 'technika',
      'elektronika': 'technika',
      'komputery': 'technika',
      'maszyny_ciezkie': 'sprzet',
      'wozy_bojowe': 'sprzet',
      'kutry': 'sprzet',
      'rusznikarstwo': 'pirotechnika',
      'wyrzutnie': 'pirotechnika',
      'materialy_wybuchowe': 'pirotechnika',
      'plywanie': 'sprawnosc',
      'wspinaczka': 'sprawnosc',
      'kondycja': 'sprawnosc',
      'jazda_konna': 'jezdictwo',
      'powodzenie': 'jezdictwo',
      'ujezdzanie': 'jezdictwo'
    };
    
    return specializationMap[skill] || null;
  }

  /* -------------------------------------------- */

  /**
   * Update specialization display
   * @param {jQuery} html
   * @private
   */
  _updateSpecializationDisplay(html) {
    const specializations = this.actor.system.specializations?.categories || {};
    
    // For each category, check if it's specialized
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

  /* -------------------------------------------- */

  /**
   * Restore collapsed sections state
   * @param {jQuery} html
   * @private
   */
  _restoreCollapsedSections(html) {
    const collapsedSections = this.actor.getFlag('neuroshima', 'collapsedSections') || {};
    
    for (const [sectionName, isCollapsed] of Object.entries(collapsedSections)) {
      if (isCollapsed) {
        const sectionContent = html.find(`[data-section-content="${sectionName}"]`);
        sectionContent.addClass('collapsed');
        
        const toggleButton = html.find(`[data-section="${sectionName}"]`);
        toggleButton.find('i').removeClass('fa-chevron-up').addClass('fa-chevron-down');
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle section collapse toggle
   * @param {Event} event
   * @private
   */
  async _onSectionCollapseToggle(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const sectionName = button.dataset.section;
    const sectionContent = $(button).closest('[data-section-content]');
    
    const isCurrentlyCollapsed = sectionContent.hasClass('collapsed');
    
    if (isCurrentlyCollapsed) {
      sectionContent.removeClass('collapsed');
      $(button).find('i').removeClass('fa-chevron-down').addClass('fa-chevron-up');
    } else {
      sectionContent.addClass('collapsed');
      $(button).find('i').removeClass('fa-chevron-up').addClass('fa-chevron-down');
    }
    
    // Save state to actor flags
    const collapsedSections = this.actor.getFlag('neuroshima', 'collapsedSections') || {};
    collapsedSections[sectionName] = !isCurrentlyCollapsed;
    await this.actor.setFlag('neuroshima', 'collapsedSections', collapsedSections);
  }

  /* -------------------------------------------- */

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

  /* -------------------------------------------- */

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

  /* -------------------------------------------- */

  /**
   * Get total wound penalty
   * @returns {Number}
   * @private
   */
  _getTotalWoundPenalty() {
    const wounds = this.actor.items.filter(i => i.type === 'wounds' && i.system.active);
    return wounds.reduce((total, wound) => total + (wound.system.penalty || 0), 0);
  }

  /* -------------------------------------------- */

  /**
   * Get current health value (calculated from wounds)
   * @returns {Number}
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
    
    // Return total damage (0 to max)
    const maxHealth = this.actor.system.health?.max || 27;
    return Math.min(totalDamage, maxHealth);
  }

  /* -------------------------------------------- */

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
              
              const createdItems = await Item.createDocuments(items, {parent: this.actor});
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

  /* -------------------------------------------- */

  /**
   * Handle attribute rolls
   * @param {Event} event
   * @private
   */
  async _onAttributeRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    const attribute = dataset.attribute;

    // Display complex test dialog with all options
    const rollOptions = await this._getRollDialog(attribute, null);
    if (!rollOptions) return; // User cancelled

    // Execute roll using dice-roller.js
    await this._executeRoll(attribute, null, rollOptions);
  }

  /* -------------------------------------------- */

  /**
   * Toggle specialization
   * @param {Event} event
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
    
    // Refresh sheet to update styles
    this.render(false);
  }

  /* -------------------------------------------- */

  /**
   * Display complex roll dialog
   * @param {string} attribute - Attribute key (zr, pc, ch, sp, bd)
   * @param {string|null} skill - Skill key or null for attribute test
   * @returns {Promise<Object|null>} Roll options or null if cancelled
   * @private
   */
  async _getRollDialog(attribute, skill) {
    return new Promise((resolve) => {
      // Get names for display
      const attributeName = CONFIG.NEUROSHIMA.attributes[attribute] || attribute;
      const skillName = skill ? this._getSkillName(attribute, skill) : null;
      const rollTitle = skillName ? `${skillName} (${attributeName})` : attributeName;

      // Get penalties from wounds (beasts don't have armor penalty)
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
              
              // Check which modifiers are checked
              const applyModifier = formData.get('applyModifier') === 'on';
              const applyWoundPenalty = formData.get('applyWoundPenalty') === 'on';
              
              const percentageModifier = parseInt(formData.get('percentageModifier')) || 0;
              
              const options = {
                testType: formData.get('testType'),
                difficulty: formData.get('difficulty'),
                percentageModifier: applyModifier ? percentageModifier : 0,
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
          // Add event listeners to all controls
          html.find('[name="difficulty"], [name="percentageModifier"], [name="applyModifier"], [name="applyWoundPenalty"]').on('change', () => {
            this._updateDifficultyPreview(html, difficulties, 0, woundPenalty);
          });
          // Call once at start
          this._updateDifficultyPreview(html, difficulties, 0, woundPenalty);
        }
      }, { width: 450, classes: ["neuroshima", "neuroshima-dialog"] }).render(true);
    });
  }

  /* -------------------------------------------- */

  /**
   * Update difficulty preview in dialog
   * @param {jQuery} html - Dialog HTML
   * @param {Array} difficulties - List of difficulty levels
   * @param {number} armorPenalty - Armor penalty (always 0 for beasts)
   * @param {number} woundPenalty - Wound penalty
   * @private
   */
  _updateDifficultyPreview(html, difficulties, armorPenalty = 0, woundPenalty = 0) {
    const selectedDifficulty = html.find('[name="difficulty"]').val();
    const percentageModifier = parseInt(html.find('[name="percentageModifier"]').val()) || 0;
    
    // Check which modifiers are checked
    const applyModifier = html.find('[name="applyModifier"]').is(':checked');
    const applyWoundPenalty = html.find('[name="applyWoundPenalty"]').is(':checked');
    
    const activeModifier = applyModifier ? percentageModifier : 0;
    const activeWoundPenalty = applyWoundPenalty ? woundPenalty : 0;
    
    const totalPenalties = activeWoundPenalty;
    
    const difficulty = difficulties.find(d => d.key === selectedDifficulty);
    if (difficulty) {
      const finalPercentage = difficulty.base + activeModifier + totalPenalties;
      
      // Build preview in monochrome style
      let preview = `<div class="preview-line">Bazowy: ${difficulty.base}%</div>`;
      
      if (activeModifier !== 0) {
        preview += `<div class="preview-line">Modyfikator: ${activeModifier >= 0 ? '+' : ''}${activeModifier}%</div>`;
      }
      
      if (activeWoundPenalty > 0) {
        preview += `<div class="preview-line">Obrażenia: +${activeWoundPenalty}%</div>`;
      }
      
      preview += `<div class="preview-total">RAZEM: ${finalPercentage}%</div>`;
      
      // Check if this changed the difficulty level
      const newLevel = this.actor._getDifficultyFromPercentage(finalPercentage);
      if (newLevel !== selectedDifficulty) {
        const newDiff = difficulties.find(d => d.key === newLevel);
        preview += `<div class="preview-warning">→ Faktyczny poziom: ${newDiff?.name || 'Nieznany'}</div>`;
      }
      
      // Update preview
      let previewElement = html.find('.difficulty-preview-box');
      previewElement.html(preview);
    }
  }

  /* -------------------------------------------- */

  /**
   * Execute roll using dice-roller.js
   * @param {string} attribute - Attribute key
   * @param {string|null} skill - Skill key or null
   * @param {Object} options - Roll options
   * @private
   */
  async _executeRoll(attribute, skill, options) {
    // Import dice-roller from main system folder
    const { NeuroshimaDiceRoller } = await import("../../dice-roller.js");
    
    // Get data needed for roll
    const attributeData = this.actor.system.attributes[attribute];
    const attributeValue = attributeData.value + (attributeData.mod || 0);
    const skillValue = skill ? this._getSkillValue(attribute, skill) : 0;
    
    // Prepare difficulty modifiers (according to dice-roller.js)
    const difficultyMods = {
      easy: 2,
      average: 0,
      problematic: -2,
      hard: -5,
      veryHard: -8,
      damnHard: -11,
      luck: -15
    };

    // Determine roll type
    const rollType = skill ? 'skill' : 'attribute';
    
    // Roll name
    const rollName = skill ? this._getSkillName(attribute, skill) : CONFIG.NEUROSHIMA.attributes[attribute];

    // Add wound penalty to percentage modifier
    const totalPercentageModifier = options.percentageModifier + (options.woundPenalty || 0);

    try {
      // Execute roll using dice-roller.js
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

      // Display result in chat
      await this._displayRollResult(result, options);
      
    } catch (error) {
      console.error('Błąd podczas wykonywania rzutu:', error);
      ui.notifications.error('Wystąpił błąd podczas wykonywania rzutu!');
    }
  }

  /* -------------------------------------------- */

  /**
   * Get skill value
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @returns {number} Skill value
   * @private
   */
  _getSkillValue(attribute, skill) {
    // For wiedza - special handling
    if (skill && skill.startsWith('wiedza.')) {
      const wiedzaKey = skill.replace('wiedza.', '');
      return this.actor.system.skills?.sp?.wiedza?.[wiedzaKey] || 0;
    }
    
    // Standard skills
    return this.actor.system.skills?.[attribute]?.[skill] || 0;
  }

  /* -------------------------------------------- */

  /**
   * Get skill name
   * @param {string} attribute - Attribute key
   * @param {string} skill - Skill key
   * @returns {string} Skill name
   * @private
   */
  _getSkillName(attribute, skill) {
    // Special handling for general knowledge - uses custom names
    if (skill && skill.startsWith('wiedza.')) {
      const wiedzaKey = skill.replace('wiedza.', '');
      const customName = this.actor.system.skills?.sp?.wiedza?.[wiedzaKey.replace('poziom', 'nazwa')];
      if (customName && customName.trim()) {
        return customName;
      }
      return `Wiedza ${wiedzaKey}`; // fallback
    }
    
    // Full mapping of standard Neuroshima 1.5 skills
    const skillNames = {
      // === ZRĘCZNOŚĆ (ZR) ===
      'bijatyka': 'Bijatyka',
      'bron_reczna': 'Broń Ręczna',
      'rzucanie': 'Rzucanie',
      'pistolety': 'Pistolety',
      'karabiny': 'Karabiny',
      'bron_maszynowa': 'Broń Maszynowa',
      'luk': 'Łuk',
      'kusza': 'Kusza',
      'proca': 'Proca',
      'samochod': 'Samochód',
      'ciezarowka': 'Ciężarówka',
      'motocykl': 'Motocykl',
      'kradziez_kieszonkowa': 'Kradzież kieszonkowa',
      'zwinne_dlonie': 'Zwinne Dłonie',
      'otwieranie_zamkow': 'Otwieranie zamków',
      
      // === PERCEPCJA (PC) ===
      'wyczucie_kierunku': 'Wyczucie kierunku',
      'tropienie': 'Tropienie',
      'przygotowanie_pulapki': 'Przygotowanie pułapki',
      'nasluchiwanie': 'Nasłuchiwanie',
      'wypatrywanie': 'Wypatrywanie',
      'czujnosc': 'Czujność',
      'skradanie_sie': 'Skradanie się',
      'ukrywanie_sie': 'Ukrywanie się',
      'maskowanie': 'Maskowanie',
      'lowiectwo': 'Łowiectwo',
      'zdobywanie_wody': 'Zdobywanie wody',
      'znajomosc_terenu': 'Znajomość terenu',
      
      // === CHARYZMA (CH) ===
      'perswazja': 'Perswazja',
      'zastraszanie': 'Zastraszanie',
      'zdolnosci_przywodcze': 'Zdolności przywódcze',
      'postrzeganie_emocji': 'Postrzeganie emocji',
      'blef': 'Blef',
      'opieka_nad_zwierzetami': 'Opieka nad zwierzętami',
      'odpornosc_na_bol': 'Odporność na ból',
      'niezlomnosc': 'Niezłomność',
      'morale': 'Morale',
      
      // === SPRYT (SP) ===
      'leczenie_ran': 'Leczenie ran',
      'leczenie_chorob': 'Leczenie chorób',
      'pierwsza_pomoc': 'Pierwsza pomoc',
      'mechanika': 'Mechanika',
      'elektronika': 'Elektronika',
      'komputery': 'Komputery',
      'maszyny_lekkie': 'Maszyny lekkie',
      'maszyny_ciezkie': 'Maszyny ciężkie',
      'wozy_bojowe': 'Wozy bojowe',
      'kutry': 'Kutry',
      'rusznikarstwo': 'Rusznikarstwo',
      'wyrzutnie': 'Wyrzutnie',
      'materialy_wybuchowe': 'Materiały wybuchowe',
      
      // === BUDOWA (BD) ===
      'plywanie': 'Pływanie',
      'wspinaczka': 'Wspinaczka',
      'kondycja': 'Kondycja',
      'jazda_konna': 'Jazda konna',
      'powodzenie': 'Powodzenie',
      'ujezdzanie': 'Ujeżdżanie'
    };
    
    return skillNames[skill] || skill;
  }

  /* -------------------------------------------- */

  /**
   * Display roll result in chat
   * @param {Object} result - Roll object from dice-roller.js containing neuroshimaData
   * @param {Object} options - Roll options containing penalty information
   * @private
   */
  async _displayRollResult(result, options = {}) {
    const rollData = result.neuroshimaData;
    
    // Prepare message elements
    const difficultyName = this._getDifficultyDisplayName(rollData.difficulty);
    const testTypeText = rollData.testType === 'open' ? 'Otwarty' : 'Zamknięty';
    const targetName = rollData.rollName;
    
    // Prepare tooltip with difficulty information (HTML)
    let tooltipRows = [];
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Próg:</span><span class="tooltip-value">${rollData.difficultyValue}</span></div>`);
    
    // Add difficulty information
    const baseDifficulty = rollData.originalPercentage || 0;
    tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Bazowa trudność:</span><span class="tooltip-value">${baseDifficulty}%</span></div>`);
    
    if (options.percentageModifier && options.percentageModifier !== 0) {
      tooltipRows.push(`<div class="tooltip-row"><span class="tooltip-label">Modyfikator:</span><span class="tooltip-value">${options.percentageModifier >= 0 ? '+' : ''}${options.percentageModifier}%</span></div>`);
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
    
    if (rollData.testType === 'open' && rollData.reducedDice && rollData.reducedDice.length > 0 && reductionPoints > 0) {
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

  /* -------------------------------------------- */

  /**
   * Get difficulty display name
   * @param {string} difficulty - Difficulty key
   * @returns {string} Display name
   * @private
   */
  _getDifficultyDisplayName(difficulty) {
    return getDifficultyName(difficulty);
  }
}