import { NeuroshimaSkillRollDialog } from "../apps/skill-roll-dialog.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Shared base class for Neuroshima actor sheets.
 *
 * Provides utilities that are identical across NeuroshimaActorSheet,
 * NeuroshimaCreatureSheet, and NeuroshimaVehicleSheet:
 *
 *  - `_getTabs()` — build active-tab map from TABS static config
 *  - `static _showRollDialog(opts)` — open a NeuroshimaSkillRollDialog
 */
export class NeuroshimaBaseActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /**
   * Build the tab map expected by HBS templates.
   * Reads `this.constructor.TABS.primary.tabs` and marks the active entry.
   * @returns {object} Map of tabId → tab descriptor with `active` and `cssClass` fields.
   */
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

  /**
   * Open a NeuroshimaSkillRollDialog for attribute or skill tests.
   * Shared across character, creature, and vehicle sheets.
   *
   * @param {object}  opts
   * @param {number}  opts.stat              - Attribute value.
   * @param {number}  [opts.skill=0]         - Skill value (0 for attribute-only tests).
   * @param {string}  opts.label             - Localised label shown in the dialog title.
   * @param {Actor}   opts.actor             - The rolling actor.
   * @param {boolean} [opts.isSkill=false]   - True when rolling a skill test.
   * @param {string}  [opts.currentAttribute=""] - Attribute key governing the skill.
   * @param {string}  [opts.skillKey=""]     - Skill key for last-roll persistence.
   * @returns {NeuroshimaSkillRollDialog}
   */
  static async _showRollDialog({ stat, skill = 0, label, actor, isSkill = false, currentAttribute = "", skillKey = "" }) {
    const dialog = new NeuroshimaSkillRollDialog({
      actor,
      stat,
      skill,
      label,
      isSkill,
      skillKey,
      currentAttribute,
      lastRoll: actor?.system?.lastRoll || {}
    });
    dialog.render(true);
    return dialog;
  }
}
