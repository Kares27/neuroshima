/**
 * Extend the base Item document by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Item}
 */
export class NeuroshimaItem extends Item {

  /** @override */
  prepareData() {
    // Prepare data for the item. Calling the super version of this executes
    // the following, in order: data reset (to clear active effects),
    // prepareBaseData(), prepareEmbeddedDocuments() (including active effects),
    // prepareDerivedData().
    super.prepareData();
  }

  /** @override */
  prepareBaseData() {
    // Data modifications in this step occur before processing embedded
    // documents or derived data.
  }

  /**
   * @override
   * Augment the item data with additional dynamic data. Typically,
   * you'll want to handle most of your calculated/derived data in this step.
   * Data calculated in this step should generally not exist in template.json
   * (such as ability modifiers rather than ability scores) and should be
   * available both inside and outside of character sheets (such as if an item
   * is queried and has a roll executed directly from a macro).
   */
  prepareDerivedData() {
    const itemData = this;
    const systemData = itemData.system;
    const flags = itemData.flags.neuroshima || {};

    // Make separate methods for each Item type (weapon, armor, etc.) to keep
    // things organized.
    this._prepareWeaponData(itemData);
    this._prepareArmorData(itemData);
  }

  /** @override */
  async _onCreate(data, options, userId) {
    await super._onCreate(data, options, userId);

    // Auto-perform resistance test for wound items
    if (this.type === 'wounds' && this.actor) {
      const skipAutoChat = options?.skipAutoChat || false;
      await this._performResistanceTestOnCreation(skipAutoChat);
    }
  }

  async _performResistanceTestOnCreation(skipAutoChat = false) {
    try {
      // Check if this wound type should skip resistance test
      const woundType = this.system?.type;
      const damageTypeConfig = CONFIG.NEUROSHIMA.damageTypes[woundType];
      if (damageTypeConfig?.skipResistanceTest) {
        // Skip resistance test for this wound type
        await this.actor.updateEmbeddedDocuments('Item', [{
          _id: this._id,
          'system.resistanceTest.performed': true,
          'system.resistanceTest.passed': false,
          'system.resistanceTest.successes': 0
        }]);
        return;
      }
      
      const { performWoundResistanceTest } = await import("../helpers/combat-utils.mjs");
      
      const testResult = await performWoundResistanceTest(this.actor, this);
      
      if (testResult.performedTest) {
        const updateData = {
          _id: this._id,
          'system.penalty': testResult.penalty,
          'system.resistanceTest.performed': true,
          'system.resistanceTest.passed': testResult.passed,
          'system.resistanceTest.successes': testResult.successes,
          'flags.neuroshima.resistanceTestResult': testResult
        };
        
        await this.actor.updateEmbeddedDocuments('Item', [updateData]);
        
        if (!skipAutoChat) {
          const damageTypeName = CONFIG.NEUROSHIMA.damageTypes[testResult.woundType]?.name || testResult.woundType;
          const location = this.system?.location || '';
          const locationName = CONFIG.NEUROSHIMA.woundLocations?.[location] || location;
          const diceStr = testResult.diceRaw.join(',');
          const reducedStr = testResult.diceReduced.join(',');
          
          // Build tooltip content for single wound
          const tooltipContent = `<div class="wound-tooltip-content">
            <div class="tooltip-row">
              <strong>${damageTypeName} - ${locationName}</strong>
              <div>[${diceStr}] → [${reducedStr}] ${testResult.successes}/3</div>
            </div>
          </div>`;
          
          // Escape HTML for attribute
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
          
          const resultClass = testResult.passed ? 'passed' : 'failed';
          const resultLabel = testResult.passed ? 'Zdane' : 'Niezdane';
          
          let resultHtml = `<div class="wound-notification">
            <p class="wound-notification-title"><strong>${this.actor.name}</strong> otrzymał 1 obrażenie typu <strong>${damageTypeName}</strong></p>
            <div class="wound-test-result ${resultClass}">
              <div class="test-result-header wound-test-tooltip-trigger ${resultClass}-tooltip" data-tooltip-content="${escapeHtml(tooltipContent)}">
                <span class="test-count">1</span>
                <span class="test-label">${resultLabel}</span>
              </div>
            </div>
          </div>`;
          
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: resultHtml,
            type: CONST.CHAT_MESSAGE_TYPES.OOC
          });
        }
      }
    } catch (error) {
      console.error('Error performing auto resistance test on wound creation:', error);
    }
  }

  /**
   * Prepare Weapon type specific data
   */
  _prepareWeaponData(itemData) {
    if (itemData.type !== 'weapon') return;

    // Make modifications to data here. For example:
    const systemData = itemData.system;
  }

  /**
   * Prepare Armor type specific data
   */
  _prepareArmorData(itemData) {
    if (itemData.type !== 'armor') return;

    // Make modifications to data here. For example:
    const systemData = itemData.system;
  }

  /**
   * Override getRollData() that's supplied to rolls.
   */
  getRollData() {
    // If present, return the actor's roll data.
    if ( !this.actor ) return null;
    const rollData = this.actor.getRollData();
    // Grab the item's system data as well.
    rollData.item = foundry.utils.deepClone(this.system);

    return rollData;
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  async roll() {
    const item = this;

    // Initialize chat data.
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    const label = `[${item.type}] ${item.name}`;

    // If there's no roll data, send a chat message.
    if (!this.system.formula) {
      ChatMessage.create({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
        content: item.system.description ?? ''
      });
    }
    // Otherwise, create a roll and send a chat message from it.
    else {
      // Retrieve roll data.
      const rollData = this.getRollData();

      // Invoke the roll and submit it to chat.
      const roll = new Roll(rollData.item.formula, rollData);
      // If you need to store the value first, uncomment the next line.
      // let result = await roll.roll({async: true});
      roll.toMessage({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
      });
      return roll;
    }
  }
}