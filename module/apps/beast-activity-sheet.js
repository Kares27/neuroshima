import { NEUROSHIMA } from "../config.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Editing window for a single activity embedded inside a beast-action or beast-segment item.
 *
 * Activities are stored as plain schema objects in `item.system.activities[]`.
 * This sheet edits exactly one of them, identified by `activityId`.
 *
 * Architecture notes:
 * - One sheet instance per (item UUID, activity ID) pair.  The `#instances` map prevents
 *   duplicate windows for the same activity.
 * - `submitOnChange: true` — every form change auto-saves; the sheet never closes on submit.
 * - A `updateItem` hook is registered while the sheet is open so it re-renders whenever the
 *   backing item changes from any code path (e.g. another client or a script).
 * - `_selfUpdating` flag suppresses the full force-render that would normally follow a hook
 *   update triggered by this sheet's own submit — avoids a visible flicker.
 *
 * Effect linking model:
 * - `effectIds`        — ActiveEffect IDs on the parent item applied on success (or unconditionally
 *                        when `testRequired = false`).
 * - `onFailureEffectIds` — ActiveEffect IDs applied when the required test is failed.
 * - Stale IDs (effects that no longer exist on the item) are pruned at context-prepare time.
 */
export class BeastActivitySheet extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {

  /** @type {Map<string, BeastActivitySheet>} One open sheet per (itemUuid::activityId) key. */
  static #instances = new Map();

  /**
   * Open (or focus) the sheet for a specific activity.
   * Returns the existing instance if the sheet is already open.
   *
   * @param {Item}   item       - The beast-action or beast-segment item that owns the activity.
   * @param {string} activityId - The `id` field of the target activity schema object.
   * @returns {BeastActivitySheet}
   */
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

  /**
   * @param {object} params
   * @param {Item}   params.item       - Owner item document.
   * @param {string} params.activityId - ID of the activity schema object being edited.
   * @param {object} [options]         - ApplicationV2 constructor options.
   */
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
      pickIcon:                  BeastActivitySheet._onPickIcon,
      addEffect:                 BeastActivitySheet._onAddEffect,
      linkSelectedEffect:        BeastActivitySheet._onLinkSelectedEffect,
      editEffect:                BeastActivitySheet._onEditEffect,
      removeEffect:              BeastActivitySheet._onRemoveEffect,
      addFailureEffect:          BeastActivitySheet._onAddFailureEffect,
      linkSelectedFailureEffect: BeastActivitySheet._onLinkSelectedFailureEffect,
      removeFailureEffect:       BeastActivitySheet._onRemoveFailureEffect
    }
  };

  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/apps/beast-activity-sheet.hbs"
    }
  };

  /** @type {{ sheet: string }} Current active tab group state. */
  tabGroups = { sheet: "identity" };

  /**
   * Resolve the live activity schema object from the parent item.
   * Returns `null` if the activity no longer exists (e.g. was deleted while the sheet was open).
   * @type {object|null}
   */
  get activity() {
    return (this.item.system.activities ?? []).find(a => a.id === this.activityId) ?? null;
  }

  /**
   * Window title shown in the ApplicationV2 header.
   * Falls back to the item name when the activity has no name of its own.
   * @type {string}
   */
  get title() {
    const act = this.activity;
    const base = act?.name || this.item.name;
    return `${game.i18n.localize("NEUROSHIMA.BeastAction.Sheet.Title")}: ${base}`;
  }

  /**
   * Build the tab descriptor objects consumed by the Handlebars template.
   * Marks the currently active tab with `cssClass: "active"`.
   * @returns {{ identity: object, activation: object, effects: object }}
   */
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

  /**
   * Build the full template context for the Handlebars form.
   *
   * Key responsibilities:
   * - Prunes stale effect IDs (effects deleted from the item since last save).
   * - Splits item effects into linked-success, linked-failure, and unlinked pools.
   * - Builds `testSkillGroups` — `{ attrKey, attrLabel, skills[] }` entries grouped by
   *   attribute for the skill `<select>` with `<optgroup>` headers.
   * - Derives boolean flags (`isMelee`, `isRanged`, etc.) for conditional template blocks.
   *
   * @override
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const activity = this.activity;
    if (!activity) return { missing: true };

    const validEffectIds = new Set(this.item.effects.map(e => e.id));
    const rawEffectIds   = activity.effectIds ?? [];
    const cleanEffectIds = rawEffectIds.filter(id => validEffectIds.has(id));

    const rawFailureIds   = activity.onFailureEffectIds ?? [];
    const cleanFailureIds = rawFailureIds.filter(id => validEffectIds.has(id));

    if (cleanEffectIds.length < rawEffectIds.length || cleanFailureIds.length < rawFailureIds.length) {
      const activities = foundry.utils.deepClone(this.item.system.activities ?? []);
      const idx = activities.findIndex(a => a.id === this.activityId);
      if (idx >= 0) {
        activities[idx].effectIds         = cleanEffectIds;
        activities[idx].onFailureEffectIds = cleanFailureIds;
        this.item.update({ "system.activities": activities });
      }
    }

    const effectIds        = new Set(cleanEffectIds);
    const failureEffectIds = new Set(cleanFailureIds);

    const toEffectRow = e => ({
      id: e.id,
      name: e.name,
      icon: e.img || "icons/svg/aura.svg",
      disabled: e.disabled,
      durationLabel: e.duration?.rounds
        ? `${e.duration.rounds}r`
        : (e.duration?.seconds ? `${e.duration.seconds}s` : "—")
    });

    const linkedEffects        = this.item.effects.filter(e => effectIds.has(e.id)).map(toEffectRow);
    const linkedFailureEffects = this.item.effects.filter(e => failureEffectIds.has(e.id)).map(toEffectRow);

    const unlinkedEffects = this.item.effects
      .filter(e => !effectIds.has(e.id) && !failureEffectIds.has(e.id))
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

    const testAttributes = {
      constitution: "NEUROSHIMA.Attributes.Constitution",
      dexterity:    "NEUROSHIMA.Attributes.Dexterity",
      perception:   "NEUROSHIMA.Attributes.Perception",
      charisma:     "NEUROSHIMA.Attributes.Charisma",
      cleverness:   "NEUROSHIMA.Attributes.Cleverness"
    };

    const skillConfig = NEUROSHIMA.skillConfiguration ?? {};
    const testSkillGroups = Object.entries(skillConfig).map(([attrKey, groups]) => {
      const cap = attrKey.charAt(0).toUpperCase() + attrKey.slice(1);
      const skills = Object.values(groups).flat().map(skill => ({
        key: skill,
        label: game.i18n.localize(`NEUROSHIMA.Skills.${skill}`)
      })).sort((a, b) => a.label.localeCompare(b.label));
      return { attrKey, attrLabel: game.i18n.localize(`NEUROSHIMA.Attributes.${cap}`), skills };
    });

    return {
      tabs:                this._getTabs(),
      activity,
      item:                this.item,
      linkedEffects,
      linkedFailureEffects,
      unlinkedEffects,
      attributes:          NEUROSHIMA.attributes,
      damageTypes:         NEUROSHIMA.damageTypes,
      testAttributes,
      testSkillGroups,
      isSegment:           activity.costType === "segment",
      isSegmentItem,
      weaponTypes,
      isMelee:             isSegmentItem && actWeaponType === "melee",
      isRanged:            isSegmentItem && actWeaponType === "ranged",
      isThrown:            isSegmentItem && actWeaponType === "thrown",
      isGrenade:           isSegmentItem && actWeaponType === "grenade",
      skillModes,
      editable:            this.item.isOwner
    };
  }

  /**
   * Register an `updateItem` hook on first render so the sheet reacts to external item changes.
   * Distinguishes self-initiated updates (via `_selfUpdating`) to avoid the forced full-render
   * that would otherwise cause a visible flicker every time the user changes a field.
   * @override
   */
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

  /**
   * Deregister the `updateItem` hook and remove the instance from the singleton map.
   * @override
   */
  _onClose(options) {
    if (this._itemHookId !== undefined) Hooks.off("updateItem", this._itemHookId);
    BeastActivitySheet.#instances.delete(this._instanceKey);
    super._onClose(options);
  }

  /**
   * Form submit handler — persists all editable activity fields to `item.system.activities`.
   *
   * Uses `_selfUpdating` to suppress the redundant force-render that the `updateItem` hook
   * would otherwise trigger immediately after the save.
   *
   * Checkbox fields (`testRequired`, `testIsOpen`) are normalised from the possible truthy
   * values emitted by form serialisation (`true`, `"true"`, `"on"`) to a plain boolean.
   *
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
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
    act.testRequired  = raw.testRequired === true || raw.testRequired === "true" || raw.testRequired === "on";
    act.testIsOpen    = raw.testIsOpen   === true || raw.testIsOpen   === "true" || raw.testIsOpen   === "on";
    if (raw.testType                !== undefined) act.testType                = raw.testType;
    if (raw.testKey                 !== undefined) act.testKey                 = raw.testKey;
    if (raw.testAttributeOverride   !== undefined) act.testAttributeOverride   = raw.testAttributeOverride;
    if (raw.testSuccesses           !== undefined) act.testSuccesses           = Number(raw.testSuccesses) || 1;

    this._selfUpdating = true;
    try {
      await this.item.update({ "system.activities": activities });
    } finally {
      this._selfUpdating = false;
    }
  }

  /**
   * Open the FilePicker to select a new icon for this activity.
   * Writes the chosen path back to `activities[idx].img`.
   *
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
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

  /**
   * Create a new ActiveEffect on the parent item and link it to this activity's `effectIds`.
   * If `target.dataset.effectId` is set the effect already exists and is just linked (no creation).
   * Opens the effect sheet after creation so the GM can configure it immediately.
   *
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
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

  /**
   * Open the sheet for an existing linked effect.
   * The effect ID is read from the nearest `[data-effect-id]` ancestor element.
   *
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  static async _onEditEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId ?? target.dataset.effectId;
    this.item.effects.get(effectId)?.sheet.render(true);
  }

  /**
   * Link an already-existing item effect (chosen from the dropdown) to this activity's `effectIds`.
   * The dropdown is identified by `[data-link-select]` on the success-effects fieldset.
   *
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
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

  /**
   * Unlink (and optionally delete) a linked success effect.
   * A `DialogV2.confirm` asks the GM whether to also delete the underlying effect
   * document or only remove the ID reference.
   *
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
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

  /**
   * Create a new ActiveEffect on the parent item and link it to this activity's `onFailureEffectIds`.
   * Always creates a fresh effect (no link-existing path — use the dropdown for that).
   * Opens the effect sheet immediately after creation.
   *
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  static async _onAddFailureEffect(event, target) {
    const [created] = await this.item.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize("NEUROSHIMA.Effects.NewEffect"),
      img: "icons/svg/aura.svg",
      transfer: false
    }]);
    if (!created) return;
    created.sheet.render(true);

    const activities = foundry.utils.deepClone(this.item.system.activities ?? []);
    const idx = activities.findIndex(a => a.id === this.activityId);
    if (idx < 0) return;
    const ids = activities[idx].onFailureEffectIds ?? [];
    if (!ids.includes(created.id)) ids.push(created.id);
    activities[idx].onFailureEffectIds = ids;
    await this.item.update({ "system.activities": activities });
  }

  /**
   * Link an already-existing item effect to this activity's `onFailureEffectIds`.
   * The dropdown is identified by `[data-failure-link-select]`.
   *
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  static async _onLinkSelectedFailureEffect(event, target) {
    const select = this.element?.querySelector("[data-failure-link-select]");
    const effectId = select?.value;
    if (!effectId) return;

    const activities = foundry.utils.deepClone(this.item.system.activities ?? []);
    const idx = activities.findIndex(a => a.id === this.activityId);
    if (idx < 0) return;
    const ids = activities[idx].onFailureEffectIds ?? [];
    if (!ids.includes(effectId)) ids.push(effectId);
    activities[idx].onFailureEffectIds = ids;
    await this.item.update({ "system.activities": activities });
  }

  /**
   * Unlink (and optionally delete) a linked failure effect.
   * Shares the same confirm-dialog pattern as `_onRemoveEffect`.
   *
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  static async _onRemoveFailureEffect(event, target) {
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
      activities[idx].onFailureEffectIds = (activities[idx].onFailureEffectIds ?? []).filter(id => id !== effectId);
      await this.item.update({ "system.activities": activities });
    }

    if (deleteAlso === true) {
      await this.item.effects.get(effectId)?.delete();
    }
  }
}
