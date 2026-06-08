import { NEUROSHIMA } from "../config.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class BeastActivitySheet extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {

  static #instances = new Map();

  static open(item, activityId) {
    const key = `${item.uuid}::${activityId}`;
    const existing = BeastActivitySheet.#instances.get(key);
    if (existing) {
      existing.bringToTop();
      return existing;
    }
    const sheet = new BeastActivitySheet({ item, activityId });
    BeastActivitySheet.#instances.set(key, sheet);
    sheet.render(true);
    return sheet;
  }

  constructor({ item, activityId }, options = {}) {
    super(options);
    this.item       = item;
    this.activityId = activityId;
    this._instanceKey = `${item.uuid}::${activityId}`;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "beast-activity-sheet"],
    window: {
      resizable: false,
      contentClasses: []
    },
    position: { width: 400, height: "auto" },
    form: {
      handler: BeastActivitySheet._onSubmit,
      submitOnChange: true,
      closeOnSubmit: false
    },
    actions: {
      pickIcon:           BeastActivitySheet._onPickIcon,
      addEffect:          BeastActivitySheet._onAddEffect,
      linkSelectedEffect: BeastActivitySheet._onLinkSelectedEffect,
      editEffect:         BeastActivitySheet._onEditEffect,
      removeEffect:       BeastActivitySheet._onRemoveEffect
    }
  };

  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/apps/beast-activity-sheet.hbs"
    }
  };

  tabGroups = { sheet: "identity" };

  get activity() {
    return (this.item.system.activities ?? []).find(a => a.id === this.activityId) ?? null;
  }

  get title() {
    const act = this.activity;
    const base = act?.name || this.item.name;
    return `${game.i18n.localize("NEUROSHIMA.BeastAction.Sheet.Title")}: ${base}`;
  }

  _getTabs() {
    const current = this.tabGroups.sheet ?? "identity";
    return {
      identity: {
        id: "identity", group: "sheet",
        label: "NEUROSHIMA.BeastAction.Sheet.TabIdentity",
        cssClass: current === "identity" ? "active" : ""
      },
      activation: {
        id: "activation", group: "sheet",
        label: "NEUROSHIMA.BeastAction.Sheet.TabActivation",
        cssClass: current === "activation" ? "active" : ""
      },
      effects: {
        id: "effects", group: "sheet",
        label: "NEUROSHIMA.Tabs.Effects",
        cssClass: current === "effects" ? "active" : ""
      }
    };
  }

  async _prepareContext(options) {
    const activity = this.activity;
    if (!activity) return { missing: true };

    const validEffectIds = new Set(this.item.effects.map(e => e.id));
    const rawEffectIds   = activity.effectIds ?? [];
    const cleanEffectIds = rawEffectIds.filter(id => validEffectIds.has(id));

    if (cleanEffectIds.length < rawEffectIds.length) {
      const activities = foundry.utils.deepClone(this.item.system.activities ?? []);
      const idx = activities.findIndex(a => a.id === this.activityId);
      if (idx >= 0) {
        activities[idx].effectIds = cleanEffectIds;
        this.item.update({ "system.activities": activities });
      }
    }

    const effectIds = new Set(cleanEffectIds);

    const linkedEffects = this.item.effects
      .filter(e => effectIds.has(e.id))
      .map(e => ({
        id: e.id,
        name: e.name,
        icon: e.img || "icons/svg/aura.svg",
        disabled: e.disabled,
        durationLabel: e.duration?.rounds
          ? `${e.duration.rounds}r`
          : (e.duration?.seconds ? `${e.duration.seconds}s` : "—")
      }));

    const unlinkedEffects = this.item.effects
      .filter(e => !effectIds.has(e.id))
      .map(e => ({ id: e.id, name: e.name }));

    const isSegmentItem = this.item.type === "beast-segment";
    const weaponTypes = {
      melee:   "NEUROSHIMA.Items.Type.WeaponMelee",
      ranged:  "NEUROSHIMA.Items.Type.WeaponRanged",
      thrown:  "NEUROSHIMA.Items.Type.WeaponThrown",
      grenade: "NEUROSHIMA.Items.Type.WeaponGrenade"
    };

    const actWeaponType = activity.weaponType || "melee";

    const skillModes = {
      experience: "NEUROSHIMA.BeastActivity.SkillMode.Experience",
      skill:      "NEUROSHIMA.BeastActivity.SkillMode.Skill",
      none:       "NEUROSHIMA.BeastActivity.SkillMode.None"
    };

    return {
      tabs:             this._getTabs(),
      activity,
      item:             this.item,
      linkedEffects,
      unlinkedEffects,
      attributes:       NEUROSHIMA.attributes,
      damageTypes:      NEUROSHIMA.damageTypes,
      isSegment:        activity.costType === "segment",
      isSegmentItem,
      weaponTypes,
      isMelee:          isSegmentItem && actWeaponType === "melee",
      isRanged:         isSegmentItem && actWeaponType === "ranged",
      isThrown:         isSegmentItem && actWeaponType === "thrown",
      isGrenade:        isSegmentItem && actWeaponType === "grenade",
      skillModes,
      editable:         this.item.isOwner
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (this._itemHookId !== undefined) Hooks.off("updateItem", this._itemHookId);
    this._itemHookId = Hooks.on("updateItem", (item) => {
      if (item.uuid !== this.item.uuid) return;
      this.item = item;
      if (this._selfUpdating) {
        this.render();
      } else {
        this.render({ force: true });
      }
    });
    this.changeTab(this.tabGroups.sheet ?? "identity", "sheet");
  }

  _onClose(options) {
    if (this._itemHookId !== undefined) Hooks.off("updateItem", this._itemHookId);
    BeastActivitySheet.#instances.delete(this._instanceKey);
    super._onClose(options);
  }

  static async _onSubmit(event, form, formData) {
    const raw = foundry.utils.expandObject(formData.object);
    const activities = foundry.utils.deepClone(this.item.system.activities ?? []);
    const idx = activities.findIndex(a => a.id === this.activityId);
    if (idx < 0) return;

    const act = activities[idx];
    if (raw.name                    !== undefined) act.name                    = raw.name;
    if (raw.img                     !== undefined) act.img                     = raw.img;
    if (raw.summary                 !== undefined) act.summary                 = raw.summary;
    if (raw.gmNote                  !== undefined) act.gmNote                  = raw.gmNote;
    if (raw.actionType              !== undefined) act.actionType              = raw.actionType;
    if (raw.costType                !== undefined) act.costType                = raw.costType;
    if (raw.segmentCost             !== undefined) act.segmentCost             = raw.segmentCost;
    if (raw.successCost             !== undefined) act.successCost             = raw.successCost;
    if (raw.skillMode               !== undefined) act.skillMode               = raw.skillMode;
    if (raw.weaponType              !== undefined) act.weaponType              = raw.weaponType;
    if (raw.range                   !== undefined) act.range                   = raw.range;
    if (raw.attribute               !== undefined) act.attribute               = raw.attribute;
    if (raw.damage1                 !== undefined) act.damage1                 = raw.damage1;
    if (raw.damage2                 !== undefined) act.damage2                 = raw.damage2;
    if (raw.damage3                 !== undefined) act.damage3                 = raw.damage3;
    if (raw.damage                  !== undefined) act.damage                  = raw.damage;
    if (raw.piercing                !== undefined) act.piercing                = raw.piercing;
    if (raw.jamming                 !== undefined) act.jamming                 = raw.jamming;

    this._selfUpdating = true;
    try {
      await this.item.update({ "system.activities": activities });
    } finally {
      this._selfUpdating = false;
    }
  }

  static async _onPickIcon(event, target) {
    if (!this.item.isOwner) return;
    const activity = this.activity;
    if (!activity) return;
    new FilePicker({
      type: "image",
      current: activity.img || "icons/svg/combat.svg",
      callback: async path => {
        const activities = foundry.utils.deepClone(this.item.system.activities ?? []);
        const idx = activities.findIndex(a => a.id === this.activityId);
        if (idx < 0) return;
        activities[idx].img = path;
        await this.item.update({ "system.activities": activities });
      }
    }).browse();
  }

  static async _onAddEffect(event, target) {
    const linkExisting = target.dataset.effectId;

    let effectId;
    if (linkExisting) {
      effectId = linkExisting;
    } else {
      const [created] = await this.item.createEmbeddedDocuments("ActiveEffect", [{
        name: game.i18n.localize("NEUROSHIMA.Effects.NewEffect"),
        img: "icons/svg/aura.svg",
        transfer: false
      }]);
      if (!created) return;
      effectId = created.id;
      created.sheet.render(true);
    }

    const activities = foundry.utils.deepClone(this.item.system.activities ?? []);
    const idx = activities.findIndex(a => a.id === this.activityId);
    if (idx < 0) return;
    const ids = activities[idx].effectIds ?? [];
    if (!ids.includes(effectId)) ids.push(effectId);
    activities[idx].effectIds = ids;
    await this.item.update({ "system.activities": activities });
  }

  static async _onEditEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId ?? target.dataset.effectId;
    this.item.effects.get(effectId)?.sheet.render(true);
  }

  static async _onLinkSelectedEffect(event, target) {
    const select = this.element?.querySelector("[data-link-select]");
    const effectId = select?.value;
    if (!effectId) return;

    const activities = foundry.utils.deepClone(this.item.system.activities ?? []);
    const idx = activities.findIndex(a => a.id === this.activityId);
    if (idx < 0) return;
    const ids = activities[idx].effectIds ?? [];
    if (!ids.includes(effectId)) ids.push(effectId);
    activities[idx].effectIds = ids;
    await this.item.update({ "system.activities": activities });
  }

  static async _onRemoveEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId ?? target.dataset.effectId;
    if (!effectId) return;

    const deleteAlso = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("NEUROSHIMA.BeastAction.Sheet.RemoveEffectTitle") },
      content: `<p>${game.i18n.localize("NEUROSHIMA.BeastAction.Sheet.RemoveEffectConfirm")}</p>`,
      yes: { label: game.i18n.localize("NEUROSHIMA.BeastAction.Sheet.RemoveEffectDelete"), icon: "fas fa-trash" },
      no:  { label: game.i18n.localize("NEUROSHIMA.BeastAction.Sheet.RemoveEffectUnlink"), icon: "fas fa-unlink" },
      rejectClose: false
    });

    const activities = foundry.utils.deepClone(this.item.system.activities ?? []);
    const idx = activities.findIndex(a => a.id === this.activityId);
    if (idx >= 0) {
      activities[idx].effectIds = (activities[idx].effectIds ?? []).filter(id => id !== effectId);
      await this.item.update({ "system.activities": activities });
    }

    if (deleteAlso === true) {
      await this.item.effects.get(effectId)?.delete();
    }
  }
}
