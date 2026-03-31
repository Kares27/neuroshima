import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/dice.js";
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Actor sheet for Creature actors (animals, mutants, monsters).
 *
 * Reuses the shared actor partials (attributes, skills, notes) so the layout
 * is identical to the character / NPC sheets. The combat tab uses a dedicated
 * creature-combat partial that shows natural armor, beast actions, and a
 * simplified wounds list instead of the full healing-panel system.
 */
export class NeuroshimaCreatureSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "actor", "actor-creature"],
    position: { width: 720, height: 680 },
    window: { title: "NEUROSHIMA.Sheet.ActorCreature", resizable: true },
    form: { submitOnChange: true, submitOnClose: true, submitOnUnfocus: true },
    actions: {
      editImage: async function(event, target) {
        const fp = new FilePicker({ type: "image", callback: src => this.document.update({ img: src }) });
        fp.browse(this.document.img);
      },

      rollAttribute: async function(event, target) {
        const attrKey = target.dataset.attribute;
        const actor   = this.document;
        const system  = actor.system;
        const attrValue = system.attributeTotals?.[attrKey] ?? (system.attributes[attrKey] || 0);
        const label     = game.i18n.localize(NEUROSHIMA.attributes[attrKey]?.label || attrKey);
        return NeuroshimaCreatureSheet._showRollDialog({ stat: attrValue, skill: 0, label, actor, isSkill: false });
      },

      rollSkill: async function(event, target) {
        const skillKey = target.dataset.skill;
        const actor    = this.document;
        const system   = actor.system;

        let attrKey = "";
        for (const [aKey, specs] of Object.entries(NEUROSHIMA.skillConfiguration)) {
          for (const skills of Object.values(specs)) {
            if (skills.includes(skillKey)) { attrKey = aKey; break; }
          }
          if (attrKey) break;
        }

        const statValue  = system.attributeTotals?.[attrKey] ?? 0;
        const skillValue = system.skills?.[skillKey]?.value ?? 0;
        const label      = game.i18n.localize(`NEUROSHIMA.Skills.${skillKey}`);

        return NeuroshimaCreatureSheet._showRollDialog({ stat: statValue, skill: skillValue, label, actor, isSkill: true, currentAttribute: attrKey });
      },

      toggleDifficulties: async function() {
        this._difficultiesCollapsed = !this._difficultiesCollapsed;
        this.render();
      },

      rollMeleeInitiative: async function() {
        const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
        const dialog = new NeuroshimaInitiativeRollDialog({ actor: this.document });
        const result = await dialog.render(true);
        if (!result) return;
        await this.document.update({ "system.combat.meleeInitiative": Number(result.successPoints) });
      },

      rollWeapon: async function(event, target) {
        const li   = target.closest("[data-item-id]");
        const item = this.document.items.get(li?.dataset.itemId ?? target.dataset.itemId);
        if (!item) return;
        const { NeuroshimaWeaponRollDialog } = await import("../apps/weapon-roll-dialog.js");
        const dialog = new NeuroshimaWeaponRollDialog({ actor: this.document, weapon: item, rollType: item.system.weaponType });
        dialog.render(true);
      },

      createItem: async function(event, target) {
        const type = target.dataset.type || "weapon";
        const name = `${game.i18n.localize("DOCUMENT.New")} ${game.i18n.localize(`TYPES.Item.${type}`) || type}`;
        return this.document.createEmbeddedDocuments("Item", [{ name, type }]);
      },

      editItem: async function(event, target) {
        const li = target.closest("[data-item-id]");
        this.document.items.get(li.dataset.itemId)?.sheet.render(true);
      },

      deleteItem: async function(event, target) {
        const li = target.closest("[data-item-id]");
        await this.document.items.get(li.dataset.itemId)?.delete();
      },

      toggleEquipped: async function(event, target) {
        const li   = target.closest("[data-item-id]");
        const item = this.document.items.get(li.dataset.itemId);
        if (item) await item.update({ "system.equipped": !item.system.equipped });
      },

      configureHP: async function() {
        const actor  = this.document;
        const current = actor.getFlag("neuroshima", "creatureMaxHP") || 27;

        const content = await foundry.applications.handlebars.renderTemplate(
          "systems/neuroshima/templates/dialog/hp-config.hbs",
          { critical: Math.max(1, Math.round(current / 27)), heavy: 0, light: 0, scratch: 0 }
        );

        const result = await foundry.applications.api.DialogV2.wait({
          window: {
            title:    game.i18n.localize("NEUROSHIMA.Dialog.MaxHP.Title"),
            position: { width: 320, height: "auto" }
          },
          content,
          classes: ["neuroshima", "dialog", "hp-config"],
          buttons: [
            {
              action: "save",
              label:  game.i18n.localize("NEUROSHIMA.Actions.Save"),
              default: true,
              callback: (event, button) => {
                const fd = new foundry.applications.ux.FormDataExtended(button.form).object;
                return {
                  critical: parseInt(fd.critical) || 0,
                  heavy:    parseInt(fd.heavy)    || 0,
                  light:    parseInt(fd.light)    || 0,
                  scratch:  parseInt(fd.scratch)  || 0
                };
              }
            },
            { action: "cancel", label: game.i18n.localize("NEUROSHIMA.Actions.Cancel") }
          ]
        });

        if (result && typeof result === "object") {
          const maxHP = (result.critical * 27) + (result.heavy * 9) + (result.light * 3) + (result.scratch * 1);
          await actor.setFlag("neuroshima", "creatureMaxHP", Math.max(1, maxHP));
          this.render();
        }
      }
    },
    dragDrop: [{ dragSelector: ".item[data-item-id]", dropSelector: "form" }]
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "attributes", group: "primary", label: "NEUROSHIMA.Tabs.Attributes" },
        { id: "combat",     group: "primary", label: "NEUROSHIMA.Tabs.Combat" },
        { id: "notes",      group: "primary", label: "NEUROSHIMA.Tabs.Notes" }
      ],
      initial: "attributes"
    }
  };

  /**
   * PARTS reuse shared actor partials wherever possible so that visual style
   * is identical to the character / NPC sheets.
   * @override
   */
  static PARTS = {
    header:     { template: "systems/neuroshima/templates/actors/creature/parts/creature-header.hbs" },
    tabs:       { template: "templates/generic/tab-navigation.hbs" },
    attributes: { template: "systems/neuroshima/templates/actors/actor/parts/actor-attributes.hbs" },
    skills:     { template: "systems/neuroshima/templates/actors/actor/parts/actor-skills.hbs", scrollable: [".skill-table"] },
    combat:     { template: "systems/neuroshima/templates/actors/creature/parts/creature-combat.hbs" },
    notes:      { template: "systems/neuroshima/templates/actors/actor/parts/actor-notes.hbs" }
  };

  /** @inheritdoc */
  constructor(options = {}) {
    super(options);
    this._difficultiesCollapsed = true;
  }

  /** @override */
  async _prepareContext(options) {
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

    context.attributeList         = NEUROSHIMA.attributes;
    context.difficulties          = NEUROSHIMA.difficulties;
    context.difficultiesCollapsed = this._difficultiesCollapsed;

    context.skillGroups = this._prepareSkillGroups();

    const items = actor.items.contents;
    context.inventory = {
      weaponsMelee:  items.filter(i => i.type === "weapon" && i.system.weaponType === "melee"),
      weaponsRanged: items.filter(i => i.type === "weapon" && i.system.weaponType === "ranged"),
      beastActions:  items.filter(i => i.type === "beast-action"),
      wounds:        items.filter(i => i.type === "wound")
    };

    const totalArmorPenalty = system.combat?.totalArmorPenalty || 0;
    const totalWoundPenalty = system.combat?.totalWoundPenalty || 0;
    const maxHP = actor.getFlag("neuroshima", "creatureMaxHP") || system.combat?.maxHP || 27;
    context.combat = {
      totalArmorPenalty,
      totalWoundPenalty,
      totalCombatPenalty: totalArmorPenalty + totalWoundPenalty,
      totalDamagePoints:  system.combat?.totalDamagePoints || 0,
      maxHP,
      meleeInitiative:    system.combat?.meleeInitiative || 0,
      wounds:             items.filter(i => i.type === "wound")
    };

    context.naturalArmorParts = Object.entries(NEUROSHIMA.bodyLocations).map(([key, data]) => ({
      key,
      label:      game.i18n.localize(data.label),
      reduction:  system.naturalArmor?.[key]?.reduction  ?? 0,
      hitPenalty: system.naturalArmor?.[key]?.hitPenalty ?? 0,
      weakPoint:  system.naturalArmor?.[key]?.weakPoint  ?? false
    }));

    context.beastActionTypes = {
      attack:   game.i18n.localize("NEUROSHIMA.BeastAction.Type.Attack"),
      special:  game.i18n.localize("NEUROSHIMA.BeastAction.Type.Special"),
      reaction: game.i18n.localize("NEUROSHIMA.BeastAction.Type.Reaction")
    };

    context.notes = {
      enriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.notes || "", {
        secrets: actor.isOwner,
        async: true,
        relativeTo: actor
      })
    };

    return context;
  }

  /**
   * Builds the skill-group data structure used by the shared actor-skills partial.
   * Mirrors the same method in NeuroshimaActorSheet.
   * @returns {object}
   */
  _prepareSkillGroups() {
    const groups  = {};
    const system  = this.document.system;
    const skillCfg = NEUROSHIMA.skillConfiguration;

    for (const [attrKey, specializations] of Object.entries(skillCfg)) {
      const attrConfig = NEUROSHIMA.attributes[attrKey];
      groups[attrKey] = {
        label: attrConfig.label,
        abbr:  attrConfig.abbr,
        specializations: {}
      };

      for (const [specKey, skills] of Object.entries(specializations)) {
        groups[attrKey].specializations[specKey] = {
          label: `NEUROSHIMA.Specializations.${specKey}`,
          owned: system.specializations?.[specKey] ?? false,
          skills: skills.map(skillKey => ({
            key:         skillKey,
            label:       `NEUROSHIMA.Skills.${skillKey}`,
            value:       system.skills?.[skillKey]?.value ?? 0,
            customLabel: system.skills?.[skillKey]?.label ?? "",
            isKnowledge: skillKey.startsWith("knowledge")
          }))
        };
      }
    }
    return groups;
  }

  /** @private */
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

  /** @override */
  async _onDropItem(event, data) {
    const item = await fromUuid(data.uuid);
    if (!item) return;
    if (["weapon", "wound", "beast-action"].includes(item.type)) {
      return super._onDropItem(event, data);
    }
  }

  /**
   * Universal roll dialog shared with the character sheet.
   * @param {object} opts
   * @param {number}  opts.stat
   * @param {number}  opts.skill
   * @param {string}  opts.label
   * @param {Actor}   opts.actor
   * @param {boolean} [opts.isSkill=false]
   * @param {string}  [opts.currentAttribute=""]
   */
  static async _showRollDialog({ stat, skill, label, actor, isSkill = false, currentAttribute = "" }) {
    const template     = "systems/neuroshima/templates/dialog/roll-dialog.hbs";
    const lastRoll     = actor.system.lastRoll || {};
    const armorPenalty = actor.system.combat?.totalArmorPenalty || 0;
    const woundPenalty = actor.system.combat?.totalWoundPenalty || 0;

    const data = {
      difficulties:    NEUROSHIMA.difficulties,
      attributeList:   NEUROSHIMA.attributes,
      currentAttribute,
      baseDifficulty:  lastRoll.baseDifficulty || "average",
      modifier:        lastRoll.modifier || 0,
      armorPenalty,
      woundPenalty,
      useArmorPenalty: lastRoll.useArmorPenalty ?? false,
      useWoundPenalty: lastRoll.useWoundPenalty ?? true,
      isOpen:          lastRoll.isOpen ?? true,
      isSkill,
      rollMode:        lastRoll.rollMode || game.settings.get("core", "rollMode"),
      rollModes:       CONFIG.Dice.rollModes
    };

    const content = await foundry.applications.handlebars.renderTemplate(template, data);

    const dialog = new foundry.applications.api.DialogV2({
      window: {
        title:    `${game.i18n.localize("NEUROSHIMA.Actions.Roll")}: ${label}`,
        position: { width: 450, height: isSkill ? 420 : 350 }
      },
      content,
      classes: ["neuroshima", "roll-dialog-window"],
      buttons: [
        {
          action: "roll",
          label:  game.i18n.localize("NEUROSHIMA.Actions.Roll"),
          default: true,
          callback: async (event, button) => {
            const form        = button.form;
            const isOpen      = form.elements.isOpen.value === "true";
            const baseDiffKey = form.elements.baseDifficulty.value;
            const modifier    = parseInt(form.elements.modifier.value)    || 0;
            const rollMode    = form.elements.rollMode.value;
            const useArmor    = form.elements.useArmorPenalty.checked;
            const armorVal    = useArmor ? (parseInt(form.elements.armorPenalty.value) || 0) : 0;
            const useWound    = form.elements.useWoundPenalty.checked;
            const woundVal    = useWound ? (parseInt(form.elements.woundPenalty.value) || 0) : 0;
            const skillBonus     = parseInt(form.elements.skillBonus.value)     || 0;
            const attributeBonus = parseInt(form.elements.attributeBonus.value) || 0;

            let finalStat = stat;
            if (isSkill && form.elements.attribute) {
              const selectedAttr = form.elements.attribute.value;
              finalStat = actor.system.attributeTotals?.[selectedAttr] ?? stat;
            }

            await actor.update({
              "system.lastRoll": { modifier, baseDifficulty: baseDiffKey, useArmorPenalty: useArmor, useWoundPenalty: useWound, isOpen, rollMode }
            });

            NeuroshimaDice.rollTest({
              stat: finalStat,
              skill,
              penalties: {
                mod:    modifier,
                base:   (NEUROSHIMA.difficulties[baseDiffKey]?.min || 0),
                armor:  armorVal,
                wounds: woundVal
              },
              isOpen,
              label,
              actor,
              skillBonus,
              attributeBonus,
              rollMode
            });
          }
        },
        { action: "cancel", label: game.i18n.localize("Cancel") }
      ]
    });

    dialog.render(true);
  }
}
