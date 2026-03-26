const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Actor sheet for Creature actors (animals, mutants, monsters).
 */
export class NeuroshimaCreatureSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "actor", "actor-creature"],
    position: { width: 620, height: 560 },
    window: { title: "NEUROSHIMA.Sheet.ActorCreature", resizable: true },
    form: { submitOnChange: true, submitOnClose: true, submitOnUnfocus: true },
    actions: {
      editImage: async function(event, target) {
        const fp = new FilePicker({ type: "image", callback: src => this.document.update({ img: src }) });
        fp.browse(this.document.img);
      },
      rollWeapon: async function(event, target) {
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);
        if (!item) return;
        const { NeuroshimaWeaponRollDialog } = await import("../apps/weapon-roll-dialog.js");
        const dialog = new NeuroshimaWeaponRollDialog({ actor: this.document, weapon: item, rollType: item.system.weaponType });
        dialog.render(true);
      },
      createItem:  async function(event, target) { await this.document.createEmbeddedDocuments("Item", [{ name: game.i18n.localize("NEUROSHIMA.NewItem"), type: target.dataset.type || "weapon" }]); },
      editItem:    async function(event, target) { this.document.items.get(target.dataset.itemId)?.sheet.render(true); },
      deleteItem:  async function(event, target) { await this.document.items.get(target.dataset.itemId)?.delete(); },
      toggleEquipped: async function(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (item) await item.update({ "system.equipped": !item.system.equipped });
      },
      rollMeleeInitiative: async function() {
        const result = await this.document.rollInitiativeDialog();
        if (!result) return;
        await this.document.update({ "system.combat.meleeInitiative": Number(result.successPoints) });
      }
    },
    dragDrop: [{ dragSelector: ".item[data-item-id]", dropSelector: "form" }]
  };

  /** @override */
  static PARTS = {
    main: { template: "systems/neuroshima/templates/actor/creature-sheet.hbs" }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor   = this.document;
    const system  = actor.system;

    context.actor  = actor;
    context.system = system;
    context.config = NEUROSHIMA;
    context.owner    = actor.isOwner;
    context.editable = this.isEditable;

    context.creatureAttributes = [
      { key: "dexterity",    label: "NEUROSHIMA.Attributes.Dexterity",    abbr: "NEUROSHIMA.Attributes.Abbr.Dexterity" },
      { key: "perception",   label: "NEUROSHIMA.Attributes.Perception",   abbr: "NEUROSHIMA.Attributes.Abbr.Perception" },
      { key: "constitution", label: "NEUROSHIMA.Attributes.Constitution", abbr: "NEUROSHIMA.Attributes.Abbr.Constitution" }
    ];

    const items = actor.items.contents;
    context.inventory = {
      weaponsMelee:  items.filter(i => i.type === "weapon" && i.system.weaponType === "melee"),
      weaponsRanged: items.filter(i => i.type === "weapon" && i.system.weaponType === "ranged"),
      armor:         items.filter(i => i.type === "armor"),
      wounds:        items.filter(i => i.type === "wound")
    };

    const totalArmorPenalty = system.combat?.totalArmorPenalty || 0;
    const totalWoundPenalty = system.combat?.totalWoundPenalty || 0;
    context.combat = {
      totalArmorPenalty,
      totalWoundPenalty,
      totalCombatPenalty: totalArmorPenalty + totalWoundPenalty,
      totalDamagePoints:  system.combat?.totalDamagePoints || 0,
      maxHP:              system.hp?.max || 10
    };

    return context;
  }

  /** @override */
  async _onDropItem(event, data) {
    const item = await fromUuid(data.uuid);
    if (!item) return;
    if (["weapon", "armor", "wound", "gear"].includes(item.type)) {
      return super._onDropItem(event, data);
    }
  }
}
