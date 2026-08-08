import { NeuroshimaRollTestRouter } from "../helpers/roll-test-router.js";
import { CombatHelper } from "../helpers/combat-helper.js";

const clone = value => foundry.utils.deepClone(value);
const entries = value => Object.values(value ?? {}).filter(entry => entry && typeof entry === "object");
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const GENERAL_ACTIVITY_ITEM_EXCLUSIONS = new Set(["beast-action", "beast-segment"]);

export function itemSupportsGeneralActivities(item) {
  return Boolean(item && !GENERAL_ACTIVITY_ITEM_EXCLUSIONS.has(item.type) &&
    item.system?.activities && !Array.isArray(item.system.activities));
}

export function createActivityData(type, item) {
  const id = foundry.utils.randomID();
  const metadata = CONFIG.NEUROSHIMA.activityTypes[type];
  if (!metadata) throw new Error(`Nieznany typ Activity: ${type}`);
  const base = {
    _id: id,
    type,
    name: metadata.label,
    img: metadata.img,
    sort: entries(item.system.activities).length * 10,
    description: "",
    chatText: "",
    visibility: "public",
    activation: { type: "manual", target: type === "damage" ? "selected" : "self" },
    uses: { spent: 0, max: null, recovery: [] },
    consumption: { targets: [] },
    effects: [],
    integrations: {},
    targeting: {}
  };
  if (type === "use") base.roll = { enabled: false, formula: "1d20" };
  if (type === "test") base.test = {
      kind: "attribute", attributeKey: "dexterity", skillKey: "",
      difficulty: "average", isOpen: false
    };
  if (["damage", "attack"].includes(type)) base.damage = {
      damageType: "L", damageCategory: "physical", location: "torso", piercing: 0,
      withPainResistance: true
    };
  if (type === "attack") base.attack = { mode: "melee" };
  return base;
}

export class ActivityConsumptionRegistry {
  static types = new Map();

  static register(type, handler) { this.types.set(type, handler); }

  static prepare(activity) {
    const updates = { before: {}, resources: clone(activity.item.system.resources ?? []),
      itemUses: clone(activity.item.system.uses ?? { spent: 0, max: null, recovery: [] }),
      quantity: activity.item.system.quantity };
    for (const target of activity.data.consumption?.targets ?? []) {
      const handler = this.types.get(target.type);
      if (!handler) throw new Error(`Nieobsługiwany typ zużycia: ${target.type}`);
      handler.prepare(activity, target, updates);
    }
    return updates;
  }

  static async apply(activity, prepared) {
    const update = {};
    if (prepared.activityUses) {
      prepared.before.activityUses = clone(activity.data.uses);
      update[`system.activities.${activity.id}.uses.spent`] = prepared.activityUses.spent;
    }
    if (prepared.itemUsesChanged) { prepared.before.itemUses = clone(activity.item.system.uses); update["system.uses"] = prepared.itemUses; }
    if (prepared.resourcesChanged) { prepared.before.resources = clone(activity.item.system.resources); update["system.resources"] = prepared.resources; }
    if (prepared.quantityChanged) { prepared.before.quantity = activity.item.system.quantity; update["system.quantity"] = prepared.quantity; }
    if (Object.keys(update).length) await activity.item.update(update);
    if (prepared.activityUses) activity.data.uses = clone(prepared.activityUses);
  }

  static async refund(activity, prepared) {
    const update = {};
    if (prepared.before.activityUses) update[`system.activities.${activity.id}.uses`] = prepared.before.activityUses;
    if (prepared.before.itemUses) update["system.uses"] = prepared.before.itemUses;
    if (prepared.before.resources) update["system.resources"] = prepared.before.resources;
    if (prepared.before.quantity !== undefined) update["system.quantity"] = prepared.before.quantity;
    if (Object.keys(update).length) await activity.item.update(update);
    if (prepared.before.activityUses) activity.data.uses = clone(prepared.before.activityUses);
  }
}

ActivityConsumptionRegistry.register("activityUses", {
  label: "Własne użycia",
  requiresTarget: false,
  availableForItem: () => true,
  prepare(activity, target, updates) {
    const amount = Math.max(0, number(target.value, 1));
    const uses = clone(updates.activityUses ?? activity.data.uses ?? { spent: 0, max: null, recovery: [] });
    const max = uses.max == null || uses.max === "" ? null : Math.max(0, number(uses.max));
    const available = max == null ? Infinity : Math.max(0, max - number(uses.spent));
    if (available < amount) throw new Error(`Activity „${activity.name}” nie ma wystarczającej liczby użyć.`);
    uses.spent = number(uses.spent) + amount;
    updates.activityUses = uses;
  }
});

ActivityConsumptionRegistry.register("itemResource", {
  label: "Zasób Itemu",
  requiresTarget: true,
  availableForItem: item => Array.isArray(item.system?.resources),
  prepare(activity, target, updates) {
    const amount = Math.max(0, number(target.value, 1));
    const index = updates.resources.findIndex(resource => resource.id === target.target);
    if (index < 0) throw new Error("Nie znaleziono wskazanego zasobu Itemu.");
    const resource = updates.resources[index];
    const next = number(resource.value) - amount;
    if (next < number(resource.min)) throw new Error(`Za mało zasobu „${resource.label || resource.key}”.`);
    updates.resources[index] = { ...resource, value: resource.unclamped ? next : Math.max(number(resource.min), next) };
    updates.resourcesChanged = true;
  }
});

ActivityConsumptionRegistry.register("itemQuantity", {
  label: "Ilość Itemu",
  requiresTarget: false,
  availableForItem: item => typeof item.system?.quantity === "number",
  prepare(activity, target, updates) {
    if (typeof updates.quantity !== "number") throw new Error("Ten Item nie posiada ilości.");
    const amount = Math.max(0, number(target.value, 1));
    if (updates.quantity < amount) throw new Error(`Za mała ilość Itemu „${activity.item.name}”.`);
    updates.quantity -= amount;
    updates.quantityChanged = true;
  }
});

ActivityConsumptionRegistry.register("itemUses", {
  label: "Użycia Itemu",
  requiresTarget: false,
  availableForItem: item => item.system?.uses != null,
  prepare(activity, target, updates) {
    const amount = Math.max(0, number(target.value, 1));
    const uses = clone(updates.itemUses);
    const max = uses.max == null || uses.max === "" ? null : Math.max(0, number(uses.max));
    const available = max == null ? Infinity : Math.max(0, max - number(uses.spent));
    if (available < amount) throw new Error(`Item „${activity.item.name}” nie ma wystarczającej liczby użyć.`);
    uses.spent = number(uses.spent) + amount;
    updates.itemUses = uses;
    updates.itemUsesChanged = true;
  }
});

export class NeuroshimaItemActivity {
  static type = "use";
  static metadata = { label: "Użycie", hint: "Ogólne użycie przedmiotu", img: "icons/svg/upgrade.svg" };
  static availableForItem(item) { return itemSupportsGeneralActivities(item); }

  constructor(data, item) {
    this.item = item;
    this.data = clone(data);
  }

  get id() { return this.data._id; }
  get type() { return this.data.type; }
  get name() { return this.data.name || this.item.name; }
  get img() { return this.data.img || this.item.img; }
  get uuid() { return `${this.item.uuid}.Activity.${this.id}`; }
  get parent() { return this.item; }
  get actor() { return this.item.actor ?? null; }
  get canUse() { return this.item.isOwner && this._validateAvailability(false); }

  toObject() { return clone(this.data); }

  openSheet() {
    const SheetClass = CONFIG.NEUROSHIMA.activityTypes?.[this.type]?.sheetClass;
    return SheetClass?.open?.(this.item, this.id) ?? null;
  }

  render(force = true) { return this.openSheet()?.render?.(force); }
  toDragData() { return { type: "Activity", uuid: this.uuid, itemUuid: this.item.uuid, activityId: this.id }; }

  _validateAvailability(throwError = true) {
    try {
      ActivityConsumptionRegistry.prepare(this);
      return true;
    } catch (error) {
      if (throwError) throw error;
      return false;
    }
  }

  async update(changes = {}) {
    const next = foundry.utils.mergeObject(clone(this.data), clone(changes), { inplace: false, recursive: true });
    next._id = this.id;
    next.type = this.type;
    await this.item.update({ [`system.activities.${this.id}`]: next });
    this.data = next;
    return this;
  }

  async delete() {
    await this.item.update({ [`system.activities.-=${this.id}`]: null });
  }

  async _resolveTargets(options = {}) {
    const uniqueActors = values => [...new Map(values.filter(Boolean).map(actor => [actor.uuid, actor])).values()];
    const mode = this.data.activation?.target ?? "self";
    if (mode === "self") return [this.actor].filter(Boolean);
    const targeted = uniqueActors([...(game.user.targets ?? [])].map(token => token.actor));
    if (mode === "selected") return targeted;
    if (mode === "manual") {
      const supplied = Array.isArray(options.targets) ? options.targets.filter(Boolean) : [];
      if (supplied.length) return uniqueActors(supplied.map(target => target.actor ?? target));
      const candidates = new Map();
      for (const token of canvas?.tokens?.placeables ?? []) {
        if (token.actor?.visible || token.actor?.isOwner || game.user.isGM) {
          candidates.set(token.actor.uuid, token.actor);
        }
      }
      for (const actor of game.actors ?? []) {
        if (actor.visible || actor.isOwner || game.user.isGM) candidates.set(actor.uuid, actor);
      }
      if (!candidates.size) return [];
      const content = `<form class="neuroshima activity-manual-target"><label>Cel<select name="actorUuid">
        ${[...candidates.values()].map(actor => `<option value="${actor.uuid}">${actor.name}</option>`).join("")}
      </select></label></form>`;
      const actorUuid = await foundry.applications.api.DialogV2.wait({
        window: { title: `Cel: ${this.name}` }, content,
        classes: ["neuroshima", "activity-target-dialog"],
        buttons: [{
          action: "select", label: "Wybierz", default: true,
          callback: (_event, button) => button.form?.elements?.actorUuid?.value ?? null
        }, { action: "cancel", label: "Anuluj", callback: () => null }],
        rejectClose: false
      });
      return actorUuid && candidates.has(actorUuid) ? [candidates.get(actorUuid)] : [];
    }
    return [];
  }

  async _createMessage(targets) {
    const rollData = {
      ...(this.item.getRollData?.() ?? {}),
      actor: this.actor?.getRollData?.() ?? {}
    };
    const enrich = source => foundry.applications.ux.TextEditor.enrichHTML(source ?? "", {
      async: true,
      secrets: this.item.isOwner,
      rollData,
      relativeTo: this.item
    });
    const [chatText, description] = await Promise.all([
      enrich(this.data.chatText),
      enrich(this.data.description)
    ]);
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/item-activity-card.hbs",
      {
        activity: this.data,
        item: this.item,
        actor: this.actor,
        chatText,
        description,
        typeLabel: CONFIG.NEUROSHIMA.activityTypes[this.type]?.label ?? this.type,
        targets: targets.map(actor => actor.name),
        usesRemaining: this.data.uses?.max == null || this.data.uses.max === ""
          ? null
          : Math.max(0, number(this.data.uses.max) - number(this.data.uses.spent))
      }
    );
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content,
      flags: { neuroshima: { itemActivity: { itemUuid: this.item.uuid, activityId: this.id, type: this.type } } }
    };
    if (this.data.visibility === "gm") {
      messageData.whisper = ChatMessage.getWhisperRecipients("GM").map(user => user.id);
    } else if (this.data.visibility === "owner" && this.actor) {
      messageData.whisper = game.users
        .filter(user => user.active && (user.isGM || this.actor.testUserPermission(user, "OWNER")))
        .map(user => user.id);
    }
    return ChatMessage.create(messageData);
  }

  async _applyEffects(targets) {
    const applications = (this.data.effects ?? []).map(entry => typeof entry === "string"
      ? { effectId: entry, operation: this.data.effectOperation ?? "apply", target: "target", when: "use" }
      : entry).filter(entry => (entry.when ?? "use") === "use");
    const ids = new Set(applications.map(entry => entry.effectId).filter(Boolean));
    if (!ids.size || !targets.length) return [];
    if (applications.every(entry => entry.operation === "remove")) {
      const removed = [];
      for (const target of targets) {
        if (!target?.isOwner && !game.user.isGM) continue;
        const matches = [...(target.effects ?? [])].filter(effect => {
          const source = effect.getFlag("neuroshima", "itemActivity");
          return source?.itemUuid === this.item.uuid &&
            source?.activityId === this.id && ids.has(source?.effectId);
        });
        if (!matches.length) continue;
        await target.deleteEmbeddedDocuments("ActiveEffect", matches.map(effect => effect.id));
        removed.push(...matches);
      }
      return removed;
    }
    const templates = [...(this.item.effects ?? [])].filter(effect => ids.has(effect.id));
    const created = [];
    for (const target of targets) {
      if (!target?.isOwner && !game.user.isGM) continue;
      const data = templates.map(effect => {
        const copy = effect.toObject();
        delete copy._id;
        copy.disabled = false;
        copy.transfer = false;
        copy.origin = this.uuid;
        foundry.utils.setProperty(copy, "flags.neuroshima.itemActivity", {
          itemUuid: this.item.uuid, activityId: this.id, effectId: effect.id
        });
        return copy;
      });
      if (data.length) created.push(...await target.createEmbeddedDocuments("ActiveEffect", data));
    }
    return created;
  }

  async use(options = {}) {
    if (!this.item.isOwner) throw new Error("Nie masz uprawnień do użycia tego Itemu.");
    const preparedConsumption = ActivityConsumptionRegistry.prepare(this);
    const targets = await this._resolveTargets(options);
    if (this.data.activation?.target === "manual" && !targets.length) return null;
    if (["selected", "manual"].includes(this.data.activation?.target) && !targets.length) {
      throw new Error("Ta Activity wymaga zaznaczonego celu.");
    }
    await ActivityConsumptionRegistry.apply(this, preparedConsumption);
    try {
      const result = await this.execute({ ...options, targets });
      const effects = await this._applyEffects(targets);
      const message = await this._createMessage(targets);
      return { activity: this, message, effects, result,
        refund: () => ActivityConsumptionRegistry.refund(this, preparedConsumption) };
    } catch (error) {
      await ActivityConsumptionRegistry.refund(this, preparedConsumption);
      throw error;
    }
  }

  async execute(_context) { return null; }
}

export class UseActivity extends NeuroshimaItemActivity {
  static type = "use";

  async execute() {
    const config = this.data.roll ?? {};
    if (config.enabled !== true || !String(config.formula ?? "").trim()) return null;
    const rollData = {
      ...(this.item.getRollData?.() ?? {}),
      actor: this.actor?.getRollData?.() ?? {}
    };
    const roll = await new Roll(String(config.formula), rollData).evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `${this.item.name}: ${this.name}`,
      rollMode: game.settings.get("core", "rollMode")
    });
    return roll;
  }
}

export class TestActivity extends NeuroshimaItemActivity {
  static type = "test";
  static metadata = { label: "Test", hint: "Wykonaj test Neuroshimy", img: "icons/svg/d20-grey.svg" };

  async execute() {
    const actor = this.actor;
    if (!actor) throw new Error("Activity Test wymaga Itemu osadzonego na Aktorze.");
    const config = this.data.test ?? {};
    const isSkill = config.kind === "skill";
    const attributeKey = config.attributeKey || "dexterity";
    const skillKey = isSkill ? config.skillKey : null;
    return NeuroshimaRollTestRouter.roll(actor, {
      type: isSkill ? "skill" : "attribute",
      actorUuid: actor.uuid,
      attributeKey,
      skillKey,
      stat: number(actor.system.attributeTotals?.[attributeKey] ?? actor.system.attributes?.[attributeKey]?.value),
      skill: isSkill ? number(actor.system.skillTotals?.[skillKey] ?? actor.system.skills?.[skillKey]?.value) : 0,
      label: this.name,
      modifier: 0,
      difficulty: config.difficulty || "average",
      isOpen: config.isOpen === true,
      useArmorPenalty: true,
      useWoundPenalty: true,
      useDiseasePenalty: true,
      useEffectPenalty: true,
      rollMode: game.settings.get("core", "rollMode"),
      testType: "itemActivity",
      testSubtype: this.type
    }, { recipient: "executor" });
  }
}

export class DamageActivity extends NeuroshimaItemActivity {
  static type = "damage";
  static metadata = { label: "Obrażenia", hint: "Zastosuj obrażenia", img: "icons/svg/blood.svg" };

  async execute({ targets }) {
    if (!targets.length) throw new Error("Activity Obrażenia wymaga zaznaczonego celu.");
    const config = this.data.damage ?? {};
    const results = [];
    for (const actor of targets) {
      results.push(await CombatHelper.applyDamageToActor(actor, {
        // CombatHelper currently resolves attackerId through game.actors. Never
        // point an unlinked token at its prototype Actor by accident.
        actorId: this.actor?.isToken ? null : (this.actor?.id ?? null),
        weaponId: this.item.id,
        weaponType: "activity",
        label: `${this.item.name}: ${this.name}`,
        damage: config.damageType || "L",
        piercing: number(config.piercing),
        damageCategory: config.damageCategory || "physical",
        finalLocation: config.location || "torso",
        hitBulletsData: [{
          damage: config.damageType || "L",
          piercing: number(config.piercing),
          successPoints: 1
        }]
      }, {
        location: config.location || "torso",
        withPainResistance: config.withPainResistance !== false
      }));
    }
    return results;
  }
}

/** Attack delegates to the existing weapon resolver; it does not duplicate combat rules. */
export class AttackActivity extends NeuroshimaItemActivity {
  static type = "attack";
  static metadata = { label: "Atak", hint: "Wykonaj atak istniejącym resolverem broni", img: "icons/svg/sword.svg" };

  async execute(context) {
    const mode = this.data.attack?.mode ?? this.item.system?.weaponType ?? "melee";
    if (!this.actor) throw new Error("Activity Atak wymaga Itemu osadzonego na Aktorze.");
    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");
    const dialog = new NeuroshimaWeaponRollDialog({
      actor: this.actor,
      weapon: this.item,
      rollType: mode === "melee" ? "melee" : mode,
      targets: [...(game.user.targets ?? [])],
      activity: this,
      activityContext: context
    });
    dialog.render(true);
    return dialog;
  }
}

/** Stable, type-indexed pseudo-document collection exposed as Item#activities. */
export class ActivityCollection extends Map {
  #byType = new Map();

  constructor(item) {
    super();
    for (const data of entries(item.system?.activities)) {
      const ActivityClass = CONFIG.NEUROSHIMA.activityTypes?.[data.type]?.documentClass;
      if (!ActivityClass) continue;
      const activity = new ActivityClass(data, item);
      this.set(activity.id, activity);
      const typed = this.#byType.get(activity.type) ?? [];
      typed.push(activity);
      this.#byType.set(activity.type, typed);
    }
  }

  getByType(type) { return [...(this.#byType.get(type) ?? [])].sort(sortActivities); }
  get length() { return this.size; }
  [Symbol.iterator]() { return this.values(); }
  filter(predicate) { return [...this.values()].filter(predicate); }
  find(predicate) { return [...this.values()].find(predicate); }
  map(mapper) { return [...this.values()].sort(sortActivities).map(mapper); }
}

const sortActivities = (a, b) => number(a.data.sort) - number(b.data.sort);

export function registerItemActivitySystem(systemConfig = {}, sheetClass = null) {
  CONFIG.NEUROSHIMA = Object.assign(CONFIG.NEUROSHIMA ?? {}, systemConfig);
  CONFIG.NEUROSHIMA.activityTypes = {
    use: { ...UseActivity.metadata, type: "use", documentClass: UseActivity, sheetClass, configurable: true },
    test: { ...TestActivity.metadata, type: "test", documentClass: TestActivity, sheetClass, configurable: true },
    damage: { ...DamageActivity.metadata, type: "damage", documentClass: DamageActivity, sheetClass, configurable: true },
    attack: { ...AttackActivity.metadata, type: "attack", documentClass: AttackActivity, sheetClass, configurable: true }
  };
  CONFIG.NEUROSHIMA.activityConsumptionTypes = ActivityConsumptionRegistry.types;
}

export function activityFromItem(item, activityId) {
  if (!itemSupportsGeneralActivities(item)) return null;
  const data = item.system.activities?.[activityId];
  if (!data) return null;
  const ActivityClass = CONFIG.NEUROSHIMA.activityTypes?.[data.type]?.documentClass;
  return ActivityClass ? new ActivityClass(data, item) : null;
}

export function activitiesFromItem(item) {
  return itemSupportsGeneralActivities(item) ? new ActivityCollection(item) : new Map();
}
