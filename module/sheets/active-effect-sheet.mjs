import { NEUROSHIMA } from "../helpers/config.mjs";

/**
 * Extend the base ActiveEffectConfig with Neuroshima system customizations
 * Adds Script tab and proper attribute key dropdowns
 */
export class NeuroshimaActiveEffectConfig extends ActiveEffectConfig {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["neuroshima", "sheet", "active-effect-config"],
      width: 560,
      height: 650,
      tabs: [
        { navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "details" }
      ]
    });
  }

  /** @override */
  get template() {
    return "systems/neuroshima/templates/active-effect-config.hbs";
  }

  /** @override */
  async getData(options = {}) {
    const context = await super.getData(options);
    
    // Ensure changes array exists
    if (!context.document.changes) {
      context.document.changes = [];
    }
    
    // Add attribute keys configuration for dropdown
    context.attributeKeys = this._prepareAttributeKeys();
    
    return context;
  }

  /**
   * Prepare attribute keys for dropdown selection
   * @private
   */
  _prepareAttributeKeys() {
    const attributeKeys = [];
    
    // Add actor attributes
    for (const [key, label] of Object.entries(NEUROSHIMA.attributes)) {
      attributeKeys.push({
        key: `system.attributes.${key}.value`,
        label: `Atrybut: ${label}`
      });
    }
    
    // Add armor locations
    const armorLocations = {
      "head": "Pancerz: Głowa",
      "torso": "Pancerz: Tułów",
      "leftHand": "Pancerz: Lewa ręka",
      "rightHand": "Pancerz: Prawa ręka",
      "leftLeg": "Pancerz: Lewa noga",
      "rightLeg": "Pancerz: Prawa noga"
    };
    
    for (const [key, label] of Object.entries(armorLocations)) {
      attributeKeys.push({
        key: `system.armor.${key}`,
        label: label
      });
    }
    
    // Add health values
    attributeKeys.push({
      key: `system.health.current`,
      label: "Zdrowie: Aktualne"
    });
    attributeKeys.push({
      key: `system.health.max`,
      label: "Zdrowie: Maksimum"
    });
    
    // Add other common values
    attributeKeys.push({
      key: `system.morale.current`,
      label: "Moral: Aktualne"
    });
    attributeKeys.push({
      key: `system.morale.max`,
      label: "Moral: Maksimum"
    });
    
    attributeKeys.sort((a, b) => a.label.localeCompare(b.label, "pl"));
    return attributeKeys;
  }

  /** @override */
  async activateListeners(html) {
    super.activateListeners(html);
    
    if (!this.isEditable) return;
    
    // Handle attribute key dropdown selection
    html.find("select.attribute-key-select").on("change", (event) => {
      const select = event.currentTarget;
      const key = select.value;
      if (key) {
        const keyInput = select.closest(".key-input-group").querySelector(".key-input");
        if (keyInput) {
          keyInput.value = key;
          keyInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
    
    // Handle add change button
    html.find("button.add-change").on("click", async (event) => {
      event.preventDefault();
      
      const changes = this.document.changes || [];
      const newChange = {
        key: "",
        mode: "OVERRIDE",
        value: "",
        priority: 0
      };
      
      changes.push(newChange);
      await this.document.update({ changes });
    });
    
    // Handle delete change button
    html.find("button.delete-change").on("click", async (event) => {
      event.preventDefault();
      
      const index = parseInt(event.currentTarget.dataset.changeIndex);
      const changes = this.document.changes || [];
      
      if (index >= 0 && index < changes.length) {
        changes.splice(index, 1);
        await this.document.update({ changes });
      }
    });
  }
}
