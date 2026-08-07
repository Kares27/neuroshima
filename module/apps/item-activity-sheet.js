import {
  ActivityConsumptionRegistry,
  activityFromItem,
  createActivityData,
  itemSupportsGeneralActivities
} from "../activities/item-activity.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemActivitySheet extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static instances = new Map();

  static open(item, activityId) {
    const key = `${item.uuid}::${activityId}`;
    const existing = this.instances.get(key);
    if (existing) { existing.bringToTop(); return existing; }
    const app = new this({ item, activityId });
    this.instances.set(key, app);
    app.render(true);
    return app;
  }

  static async createForItem(item) {
    if (!itemSupportsGeneralActivities(item)) return null;
    // Persist generated IDs before an Activity can reference a parent resource.
    // This also upgrades legacy resource rows whose former schema had no ID.
    if (Array.isArray(item.system.resources) && item.system.resources.length) {
      await item.update({
        "system.resources": item.system.resources.map(resource => ({
          ...(resource.toObject?.() ?? resource),
          id: resource.id || foundry.utils.randomID(),
          recovery: resource.recovery ?? []
        }))
      }, { render: false });
    }
    const types = Object.entries(CONFIG.NEUROSHIMA.activityTypes)
      .filter(([, config]) => config.configurable !== false && config.documentClass.availableForItem(item));
    const content = `
      <form class="neuroshima activity-type-choice">
        <p class="hint">Typ określa, co Activity robi. Moment użycia konfiguruje się osobno.</p>
        ${types.map(([type, config], index) => `
          <label class="activity-type-option">
            <input type="radio" name="activityType" value="${type}" ${index === 0 ? "checked" : ""}>
            <img src="${config.img}" alt="">
            <span><strong>${config.label}</strong><small>${config.hint}</small></span>
          </label>`).join("")}
      </form>`;
    const type = await foundry.applications.api.DialogV2.wait({
      window: { title: "Nowa aktywność" }, content,
      classes: ["neuroshima", "activity-create-dialog"],
      buttons: [{
        action: "create", label: "Utwórz aktywność", icon: "fa-solid fa-plus", default: true,
        callback: (_event, button) => button.form?.elements?.activityType?.value ?? null
      }, { action: "cancel", label: "Anuluj", callback: () => null }],
      rejectClose: false
    });
    if (!type) return null;
    const data = createActivityData(type, item);
    await item.update({ [`system.activities.${data._id}`]: data });
    return this.open(item, data._id);
  }

  constructor({ item, activityId }, options = {}) {
    super(options);
    this.item = item;
    this.activityId = activityId;
    this.activeTab = "identity";
    this.activeActivationTab = "time";
    this._key = `${item.uuid}::${activityId}`;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "item-activity-sheet"],
    window: { resizable: true },
    position: { width: 620, height: 680 },
    form: { handler: ItemActivitySheet._submit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      tab: ItemActivitySheet._selectTab,
      activationTab: ItemActivitySheet._selectActivationTab,
      pickImage: ItemActivitySheet._pickImage,
      addConsumption: ItemActivitySheet._addConsumption,
      removeConsumption: ItemActivitySheet._removeConsumption,
      deleteActivity: ItemActivitySheet._deleteActivity,
      useActivity: ItemActivitySheet._useActivity
    }
  };

  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/apps/item-activity-sheet.hbs",
      scrollable: [".activity-sheet-body"]
    }
  };

  get activity() { return activityFromItem(this.item, this.activityId); }
  get title() { return `${this.activity?.name ?? "Activity"} — ${this.item.name}`; }

  async _prepareContext() {
    const activity = this.activity;
    if (!activity) return {};
    const data = activity.data;
    const max = data.uses?.max;
    const remaining = max == null || max === "" ? null : Math.max(0, Number(max) - Number(data.uses?.spent ?? 0));
    const consumptionTypes = [...ActivityConsumptionRegistry.types.entries()]
      .filter(([, config]) => config.availableForItem?.(this.item) !== false)
      .map(([type, config]) => ({ type, label: config.label, requiresTarget: config.requiresTarget === true }));
    const consumption = (data.consumption?.targets ?? []).map((entry, index) => ({
      ...entry, index,
      isActivityUses: entry.type === "activityUses",
      isItemResource: entry.type === "itemResource",
      isItemQuantity: entry.type === "itemQuantity",
      types: consumptionTypes.map(option => ({ ...option, selected: option.type === entry.type }))
    }));
    return {
      item: this.item,
      activity: data,
      activityType: CONFIG.NEUROSHIMA.activityTypes[data.type],
      isUse: data.type === "use",
      isTest: data.type === "test",
      isDamage: data.type === "damage",
      isSkillTest: data.test?.kind === "skill",
      remaining,
      activationTabs: ["time", "consumption", "targeting"].map(id => ({
        id,
        active: id === this.activeActivationTab
      })),
      consumption,
      resources: (this.item.system.resources ?? []).map(resource => ({ ...resource })),
      effects: [...this.item.effects].map(effect => ({
        id: effect.id, name: effect.name, img: effect.img,
        selected: (data.effects ?? []).includes(effect.id)
      })),
      effectOperationApply: data.effectOperation !== "remove",
      effectOperationRemove: data.effectOperation === "remove",
      tabs: ["identity", "activation", "effect"].map(id => ({ id, active: id === this.activeTab })),
      attributes: Object.entries(CONFIG.NEUROSHIMA?.attributes ?? game.neuroshima?.config?.attributes ?? {})
        .map(([key, value]) => ({ key, label: game.i18n.localize(value) })),
      skills: Object.entries(CONFIG.NEUROSHIMA?.skills ?? game.neuroshima?.config?.skills ?? {})
        .map(([key, value]) => ({ key, label: game.i18n.localize(value) })),
      difficulties: Object.entries(CONFIG.NEUROSHIMA?.difficulties ?? game.neuroshima?.config?.difficulties ?? {})
        .map(([key, value]) => ({
          key,
          label: game.i18n.localize(value.label),
          selected: key === data.test?.difficulty
        })),
      damageTypes: ["D", "L", "C", "K", "sD", "sL", "sC", "sK"],
      damageCategories: Object.entries(game.neuroshima?.config?.damageCategories ?? {})
        .map(([key, value]) => ({
          key,
          label: game.i18n.localize(value.label ?? value),
          selected: key === (data.damage?.damageCategory ?? "physical")
        })),
      locations: ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"].map(key => ({
        key, label: game.i18n.localize(`NEUROSHIMA.HitLocation.${key}`)
      }))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element?.querySelectorAll("[data-activity-panel]").forEach(panel => {
      panel.hidden = panel.dataset.activityPanel !== this.activeTab;
    });
    this.element?.querySelectorAll("[data-activation-panel]").forEach(panel => {
      panel.hidden = panel.dataset.activationPanel !== this.activeActivationTab;
    });
    this.element?.querySelectorAll('.activity-consumption-row select[name$=".type"]').forEach(select => {
      const syncTarget = () => {
        const targetSelect = select.parentElement?.querySelector('select[name$=".target"]');
        if (targetSelect) targetSelect.disabled = select.value !== "itemResource";
      };
      select.addEventListener("change", syncTarget);
      syncTarget();
    });
  }

  static async _submit(_event, form, _formData) {
    const activity = this.activity;
    if (!activity) return;
    const fd = new FormData(form);
    const get = key => fd.get(key);
    const nullableNumber = value => value === "" || value == null ? null : Number(value);
    const data = {
      name: String(get("name") || activity.name),
      img: String(get("img") || activity.img),
      description: String(get("description") || ""),
      chatText: String(get("chatText") || ""),
      visibility: String(get("visibility") || "public"),
      effectOperation: String(get("effectOperation") || "apply"),
      roll: {
        enabled: get("roll.enabled") === "on",
        formula: String(get("roll.formula") || activity.data.roll?.formula || "1d20")
      },
      activation: {
        type: String(get("activation.type") || "manual"),
        target: String(get("activation.target") || "self")
      },
      uses: {
        spent: Math.max(0, Number(get("uses.spent") || 0)),
        max: nullableNumber(get("uses.max")),
        recovery: activity.data.uses?.recovery ?? []
      },
      effects: fd.getAll("effects"),
      test: {
        kind: String(get("test.kind") || "attribute"),
        attributeKey: String(get("test.attributeKey") || "dexterity"),
        skillKey: String(get("test.skillKey") || ""),
        difficulty: String(get("test.difficulty") || "average"),
        isOpen: get("test.isOpen") === "on"
      },
      damage: {
        damageType: String(get("damage.damageType") || "L"),
        damageCategory: String(get("damage.damageCategory") || "physical"),
        location: String(get("damage.location") || "torso"),
        piercing: Math.max(0, Number(get("damage.piercing") || 0)),
        withPainResistance: get("damage.withPainResistance") === "on"
      }
    };
    const targets = (activity.data.consumption?.targets ?? []).map((entry, index) => ({
      ...entry,
      type: String(get(`consumption.${index}.type`) || entry.type || "activityUses"),
      target: String(get(`consumption.${index}.target`) || ""),
      value: Math.max(0, Number(get(`consumption.${index}.value`) || 0)),
      scaling: false
    }));
    data.consumption = { targets };
    await activity.update(data);
    this.render({ force: true });
  }

  static _selectTab(_event, target) {
    this.activeTab = target.dataset.tab;
    this.render({ force: true });
  }

  static _selectActivationTab(_event, target) {
    this.activeActivationTab = target.dataset.activationTab;
    this.render({ force: true });
  }

  static async _pickImage() {
    const picker = new FilePicker({
      type: "image", current: this.activity?.img,
      callback: async path => { await this.activity.update({ img: path }); this.render({ force: true }); }
    });
    picker.render(true);
  }

  static async _addConsumption() {
    const activity = this.activity;
    const targets = [...(activity.data.consumption?.targets ?? []), {
      id: foundry.utils.randomID(), type: "activityUses", target: "", value: 1, scaling: false
    }];
    await activity.update({ consumption: { targets } });
    this.render({ force: true });
  }

  static async _removeConsumption(_event, target) {
    const index = Number(target.dataset.index);
    const targets = [...(this.activity.data.consumption?.targets ?? [])];
    targets.splice(index, 1);
    await this.activity.update({ consumption: { targets } });
    this.render({ force: true });
  }

  static async _deleteActivity() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Usuń Activity" }, content: `<p>Usunąć Activity „${this.activity.name}”?</p>`
    });
    if (!confirmed) return;
    await this.activity.delete();
    await this.close();
  }

  static async _useActivity() {
    try { await this.activity.use(); }
    catch (error) { ui.notifications.error(error.message); console.error("Neuroshima | Activity use failed", error); }
  }

  async close(options = {}) {
    ItemActivitySheet.instances.delete(this._key);
    return super.close(options);
  }
}
