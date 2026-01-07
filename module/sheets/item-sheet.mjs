/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheet}
 */

import { prepareActiveEffectCategories } from "../helpers/effects.mjs";

export class NeuroshimaItemSheet extends ItemSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["neuroshima", "sheet", "item"],
      width: 520,
      height: 550,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
    });
  }

  /** @override */
  get template() {
    const path = "systems/neuroshima/templates/item";
    // Return a single sheet for all item types.
    // return `${path}/item-sheet.hbs`;

    // Alternatively, you could use the following return statement to do a
    // unique item sheet by type, like `weapon-sheet.hbs`.
    return `${path}/item-${this.item.type}-sheet.hbs`;
  }

  /* -------------------------------------------- */

  /** @override */
  async getData() {
    // Retrieve base data structure.
    const context = super.getData();

    // Use a safe clone of the item data for further operations.
    const itemData = this.item.toObject(false);

    // Retrieve the roll data for TinyMCE editors.
    context.rollData = {};
    let actor = this.object?.parent ?? null;
    if (actor) {
      context.rollData = actor.getRollData();
    }

    // Add the actor's data to context.data for easier access, as well as flags.
    context.system = itemData.system;
    context.flags = itemData.flags;

    // Enrich description for ProseMirror editor
    const TextEditorClass = foundry.applications?.ux?.TextEditor?.implementation || TextEditor;
    context.enrichedDescription = await TextEditorClass.enrichHTML(
      this.item.system.description || '',
      {
        secrets: this.item.isOwner,
        async: true,
        relativeTo: this.item
      }
    );

    // For weapon-ranged, add available ammunition
    if (this.item.type === 'weapon-ranged' && actor) {
      context.availableAmmo = actor.items.filter(item => item.type === 'ammunition');
    }

    // For beast-action, ensure actions is always an array
    if (this.item.type === 'beast-action') {
      if (!Array.isArray(context.system.actions)) {
        context.system.actions = [];
      }
    }

    // Prepare active effects
    context.effects = prepareActiveEffectCategories(this.item.effects);

    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    // Handle attribute selection change for weapons
    html.find('#attribute-select').change(this._onAttributeChange.bind(this));
    
    // Handle override checkbox for ammunition
    html.find('#override-checkbox').change(this._onOverrideToggle.bind(this));

    // Beast-action specific listeners
    html.find('.add-action').click(this._onAddAction.bind(this));
    html.find('.delete-action').click(this._onDeleteAction.bind(this));
    html.find('.expand-action').click(this._onExpandAction.bind(this));

    // Handle effect controls
    html.find(".effect-create").click(ev => {
      ev.preventDefault();
      this.item.createEmbeddedDocuments("ActiveEffect", [{
        name: "Nowy Efekt",
        icon: "icons/svg/aura.svg",
        origin: this.item.uuid
      }]).then(effects => {
        if (effects.length > 0) {
          effects[0].sheet.render(true);
        }
      });
    });
    
    html.find(".effect-edit").click(ev => {
      ev.preventDefault();
      const effectId = ev.currentTarget.closest(".effect").dataset.effectId;
      const effect = this.item.effects.get(effectId);
      if (effect) {
        effect.sheet.render(true);
      }
    });
    
    html.find(".effect-toggle").click(ev => {
      ev.preventDefault();
      const effectId = ev.currentTarget.closest(".effect").dataset.effectId;
      const effect = this.item.effects.get(effectId);
      if (effect) {
        effect.update({ disabled: !effect.disabled });
      }
    });
    
    html.find(".effect-delete").click(ev => {
      ev.preventDefault();
      const effectId = ev.currentTarget.closest(".effect").dataset.effectId;
      this.item.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
    });
    
    html.find(".effect-click").click(ev => {
      ev.preventDefault();
      const effectId = ev.currentTarget.closest(".effect").dataset.effectId;
      const effect = this.item.effects.get(effectId);
      if (effect) {
        effect.sheet.render(true);
      }
    });

    // Initialize skill dropdown on render
    this._initializeSkillDropdown(html);
  }

  /**
   * Handle attribute selection change
   * @param {Event} event
   * @private
   */
  async _onAttributeChange(event) {
    const selectedAttribute = event.target.value;
    const skillSelect = $(event.target).closest('form').find('#skill-select');
    
    // Clear and populate skills for selected attribute
    this._populateSkillDropdown(skillSelect, selectedAttribute);
  }

  /**
   * Handle ammunition override toggle
   * @param {Event} event
   * @private
   */
  _onOverrideToggle(event) {
    const isOverriding = event.target.checked;
    const overrideSection = $(event.target).closest('form').find('.override-section');
    
    if (isOverriding) {
      overrideSection.show();
    } else {
      overrideSection.hide();
    }
  }

  /**
   * Initialize skill dropdown on sheet render
   * @param {jQuery} html
   * @private
   */
  _initializeSkillDropdown(html) {
    const attributeSelect = html.find('#attribute-select');
    const skillSelect = html.find('#skill-select');
    
    if (attributeSelect.length && skillSelect.length) {
      const currentAttribute = attributeSelect.val() || 'zr';
      this._populateSkillDropdown(skillSelect, currentAttribute);
      
      // Set current skill value if exists
      if (this.item.system.skill) {
        skillSelect.val(this.item.system.skill);
      }
    }
  }

  /**
   * Populate skill dropdown based on selected attribute
   * @param {jQuery} skillSelect
   * @param {string} attribute
   * @private
   */
  _populateSkillDropdown(skillSelect, attribute) {
    skillSelect.empty();
    
    // Get skills for the selected attribute from CONFIG
    const skillCategories = CONFIG.NEUROSHIMA.skills?.[attribute] || {};
    
    // Add empty option
    skillSelect.append('<option value="">-- Wybierz umiejętność --</option>');
    
    // Add skills for selected attribute
    for (let [categoryKey, categorySkills] of Object.entries(skillCategories)) {
      // Skip knowledge categories (we'll handle them separately)
      if (categoryKey === 'wiedza1' || categoryKey === 'wiedza2') {
        continue;
      }
      
      // Add skills from this category
      for (let [skillKey, skillName] of Object.entries(categorySkills)) {
        const selected = this.item.system.skill === skillKey ? 'selected' : '';
        skillSelect.append(`<option value="${skillKey}" ${selected}>${skillName}</option>`);
      }
    }
  }

  /**
   * Handle adding a new action to beast-action item
   * @param {Event} event
   * @private
   */
  async _onAddAction(event) {
    event.preventDefault();
    
    // Ensure actions is always an array
    let actions = this.item.system.actions;
    if (!Array.isArray(actions)) {
      actions = [];
    }
    
    const newAction = {
      name: `Akcja ${actions.length + 1}`,
      cost: 1,
      damage: "",
      range: "",
      actionType: "attack",
      special: "",
      description: ""
    };
    
    await this.item.update({
      "system.actions": [...actions, newAction]
    });
  }

  /**
   * Handle deleting an action from beast-action item
   * @param {Event} event
   * @private
   */
  async _onDeleteAction(event) {
    event.preventDefault();
    
    const index = parseInt(event.currentTarget.dataset.actionIndex);
    const actions = [...this.item.system.actions];
    
    // Confirm deletion
    const confirm = await Dialog.confirm({
      title: "Usuń Akcję",
      content: `<p>Czy na pewno chcesz usunąć akcję <strong>${actions[index].name}</strong>?</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (confirm) {
      actions.splice(index, 1);
      await this.item.update({
        "system.actions": actions
      });
    }
  }

  /**
   * Handle expanding/collapsing action details
   * @param {Event} event
   * @private
   */
  _onExpandAction(event) {
    event.preventDefault();
    
    const button = $(event.currentTarget);
    const index = button.data('action-index');
    const detailsRow = button.closest('tbody').find(`.action-details[data-action-index="${index}"]`);
    const icon = button.find('i');
    
    if (detailsRow.is(':visible')) {
      detailsRow.hide();
      icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
    } else {
      detailsRow.show();
      icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
    }
  }

  /**
   * Override _updateObject to properly handle actions array
   * @param {Event} event
   * @param {Object} formData
   * @private
   */
  async _updateObject(event, formData) {
    // If this is a beast-action, we need to manually reconstruct the actions array
    if (this.item.type === 'beast-action') {
      const actions = [];
      const expandedData = foundry.utils.expandObject(formData);
      
      // If actions exist in the expanded data, use them
      if (expandedData.system?.actions) {
        // Convert the actions object to an array
        const actionsObj = expandedData.system.actions;
        
        // If it's already an array, use it directly
        if (Array.isArray(actionsObj)) {
          actions.push(...actionsObj);
        } else {
          // If it's an object with numeric keys, convert to array
          const indices = Object.keys(actionsObj).map(k => parseInt(k)).sort((a, b) => a - b);
          for (const index of indices) {
            actions.push(actionsObj[index]);
          }
        }
        
        // Replace the actions in formData
        formData['system.actions'] = actions;
        
        // Remove the expanded actions object to avoid conflicts
        delete formData['system.actions.0'];
        delete formData['system.actions.1'];
        delete formData['system.actions.2'];
        delete formData['system.actions.3'];
        delete formData['system.actions.4'];
        delete formData['system.actions.5'];
        delete formData['system.actions.6'];
        delete formData['system.actions.7'];
        delete formData['system.actions.8'];
        delete formData['system.actions.9'];
        
        // Remove all keys that start with 'system.actions.' and contain a dot after the index
        for (const key of Object.keys(formData)) {
          if (key.startsWith('system.actions.') && key.split('.').length > 3) {
            delete formData[key];
          }
        }
      }
    }
    
    // Call the parent update method
    return super._updateObject(event, formData);
  }

}