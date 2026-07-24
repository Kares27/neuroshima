import { NEUROSHIMA } from "../config.js";

/**
 * Runtime registry for result actions declared by Active Effects.
 *
 * Chat flags contain only document/action references. Scripts are always resolved
 * from the current ActiveEffect immediately before execution, so editing or
 * disabling an effect cannot leave stale executable code in an old message.
 */
export class EffectActionRuntime {
  static SURFACE_TEST = "testResult";
  static SURFACE_MELEE = "meleePool";

  static _effects(actor) {
    if (!actor) return [];
    const direct = Array.from(actor.effects ?? []);
    // Transferred item effects already exist in actor.effects. Only non-transfer
    // effects are read from the embedded item to avoid duplicate buttons.
    const itemEffects = Array.from(actor.items ?? [])
      .flatMap(item => Array.from(item.effects ?? []).filter(effect => !effect.transfer));
    return [...direct, ...itemEffects].filter(effect => !effect.disabled && !effect.isSuppressed);
  }

  static async collect(actor, rollData, surface = this.SURFACE_TEST, additions = []) {
    const entries = [];
    for (const effect of this._effects(actor)) {
      for (const raw of (effect.system?.actionDefs ?? [])) {
        if ((raw.type ?? "melee") !== "result") continue;
        const surfaceConfig = raw.result?.surfaces?.[surface];
        if (!surfaceConfig?.enabled) continue;

        const ctx = this._context({ actor, effect, action: raw, rollData, surface, preview: true });
        if (!(await this._available(raw, ctx))) continue;
        entries.push(await this._reference(effect, raw, surface, surfaceConfig));
      }
    }

    // Trigger scripts may add a reference or override presentation, but never
    // executable source. Duplicate ids intentionally collapse to one button.
    for (const addition of additions ?? []) {
      const effect = addition.effectUuid ? await fromUuid(addition.effectUuid) : null;
      const raw = effect?.system?.actionDefs?.find(def => def.id === addition.actionId);
      if (!effect || !raw || (raw.type ?? "melee") !== "result") continue;
      const ref = await this._reference(effect, raw, surface, raw.result?.surfaces?.[surface] ?? {});
      entries.push(foundry.utils.mergeObject(ref, addition.overrides ?? {}, { inplace: false }));
    }
    return Array.from(new Map(entries.map(entry => [entry.instanceId, entry])).values());
  }

  static async _reference(effect, action, surface, surfaceConfig) {
    const sourceItem = await this._sourceItem(effect);
    const tooltip = action.tooltip
      ? await foundry.applications.ux.TextEditor.enrichHTML(action.tooltip, {
          async: true, rollData: sourceItem?.actor?.getRollData?.() ?? {}, relativeTo: sourceItem ?? effect
        })
      : "";
    const instanceId = `${effect.uuid}::${action.id}::${surface}`;
    return {
      instanceId,
      actionId: action.id,
      sourceEffectUuid: effect.uuid,
      sourceItemUuid: sourceItem?.uuid ?? null,
      surface,
      name: action.name || effect.name,
      img: action.img || sourceItem?.img || effect.img,
      tooltipHtml: tooltip,
      selection: surfaceConfig.selection ?? { type: "none" },
      resource: action.resource ?? null,
      oncePerMessage: action.usage?.oncePerMessage !== false,
      used: false
    };
  }

  static async _available(action, ctx) {
    const code = action.result?.availabilityScript?.trim();
    if (!code) return true;
    try {
      return (await (new AsyncFunction("ctx", `"use strict";\n${code}`))(ctx)) !== false;
    } catch (error) {
      console.error(`Neuroshima | availabilityScript failed for ${action.id}`, error);
      return false;
    }
  }

  static async execute(message, instanceId, selection = []) {
    const rollData = foundry.utils.deepClone(message.getFlag("neuroshima", "rollData") ?? {});
    const ref = (rollData.effectActions ?? []).find(entry => entry.instanceId === instanceId);
    if (!ref) return ui.notifications.warn("Ta akcja nie jest już dostępna na tej karcie.");
    if (ref.used && ref.oncePerMessage) return ui.notifications.warn("Ta akcja została już użyta.");

    const effect = await fromUuid(ref.sourceEffectUuid);
    const action = effect?.system?.actionDefs?.find(def => def.id === ref.actionId);
    const actor = this._actor(effect, rollData);
    if (!effect || effect.disabled || effect.isSuppressed || !action || (action.type ?? "melee") !== "result") {
      return ui.notifications.warn("Efekt lub definicja tej akcji nie jest już aktywna.");
    }
    if (!game.user.isGM && !actor?.isOwner && message.author?.id !== game.user.id) {
      return ui.notifications.warn("Nie masz uprawnień do wykonania tej akcji.");
    }

    const resource = await this._resource(effect, action.resource);
    const cost = Math.max(0, Number(action.resource?.cost ?? 0));
    if (cost && (!resource || Number(resource.entry.value) < cost)) {
      return ui.notifications.warn("Brak wystarczającej liczby użyć zasobu.");
    }

    const ctx = this._context({
      actor, effect, action, rollData, surface: ref.surface, message, selection, preview: false
    });
    const code = action.result?.executeScript?.trim();
    try {
      if (code) await (new AsyncFunction("ctx", `"use strict";\n${code}`))(ctx);
      if (action.result?.recalculate !== false) this._recalculate(rollData);
      if (cost) await this._spend(resource, cost);
      if (ref.oncePerMessage) ref.used = true;
      await this._updateMessage(message, rollData);
    } catch (error) {
      console.error(`Neuroshima | executeScript failed for ${action.id}`, error);
      ui.notifications.error(`Nie udało się wykonać akcji: ${error.message}`);
    }
  }

  /**
   * Ask for dice only when the surface definition requires them. The selection
   * is transient UI state and is passed to execute(); it is not stored as code.
   */
  static async chooseAndExecute(message, instanceId) {
    const rollData = message.getFlag("neuroshima", "rollData") ?? {};
    const ref = (rollData.effectActions ?? []).find(entry => entry.instanceId === instanceId);
    const selection = ref?.selection ?? {};
    if (selection.type !== "die") return this.execute(message, instanceId, []);

    const values = rollData.modifiedResults ?? rollData.rawResults ?? [];
    const min = Math.max(0, Number(selection.min ?? 0));
    const max = Math.max(min, Number(selection.max ?? values.length));
    const fields = values.map((value, index) =>
      `<label class="ns-effect-die-choice"><input type="checkbox" name="die" value="${index}"> D${index + 1}: <strong>${value}</strong></label>`
    ).join("");
    const picked = await foundry.applications.api.DialogV2.prompt({
      window: { title: ref?.name ?? "Wybierz kości" },
      content: `<form class="ns-effect-die-picker"><p>Wybierz od ${min} do ${max} kości.</p>${fields}</form>`,
      ok: {
        label: "Wykonaj",
        callback: (_event, button) => Array.from(button.form.querySelectorAll('[name="die"]:checked'), el => Number(el.value))
      },
      rejectClose: false
    });
    if (!Array.isArray(picked)) return;
    if (picked.length < min || picked.length > max) {
      return ui.notifications.warn(`Wybierz od ${min} do ${max} kości.`);
    }
    return this.execute(message, instanceId, picked);
  }

  static _actor(effect, rollData) {
    const parent = effect?.parent;
    if (parent?.documentName === "Actor") return parent;
    if (parent?.documentName === "Item" && parent.actor) return parent.actor;
    return game.actors.get(rollData.actorId);
  }

  static async _sourceItem(effect) {
    if (effect?.parent?.documentName === "Item") return effect.parent;
    if (!effect?.origin) return null;
    const origin = await fromUuid(effect.origin);
    if (origin?.documentName === "Item") return origin;
    return origin?.parent?.documentName === "Item" ? origin.parent : null;
  }

  static async _resource(effect, config) {
    if (!config?.key) return null;
    const item = await this._sourceItem(effect);
    const resources = item?.system?.resources ?? [];
    const index = resources.findIndex(entry => entry.key === config.key);
    return index < 0 ? null : { item, index, entry: resources[index] };
  }

  static async _spend(resource, cost) {
    const resources = foundry.utils.deepClone(resource.item.system.resources ?? []);
    resources[resource.index].value = Math.max(0, Number(resources[resource.index].value) - cost);
    await resource.item.update({ "system.resources": resources });
  }

  static _context({ actor, effect, action, rollData, surface, message = null, selection = [], preview }) {
    const selected = Array.isArray(selection) ? selection.map(Number).filter(Number.isInteger) : [];
    return {
      actor, effect, sourceItem: effect?.parent?.documentName === "Item" ? effect.parent : null,
      action, message, surface, preview, rollData, selection: selected,
      dice: {
        values: rollData.modifiedResults ?? rollData.rawResults ?? [],
        selected,
        get: index => (rollData.modifiedResults ?? rollData.rawResults ?? [])[index],
        set: (index, value) => {
          const values = rollData.modifiedResults ??= [...(rollData.rawResults ?? [])];
          values[index] = Number(value);
        }
      },
      result: {
        addSuccesses: amount => {
          rollData.effectActionSuccessBonus = Number(rollData.effectActionSuccessBonus ?? 0) + Number(amount ?? 0);
        },
        setSuccess: value => { rollData.effectActionForcedSuccess = Boolean(value); },
        annotate: (label, value = "") => {
          const suffix = value === "" ? "" : `: ${String(value)}`;
          (rollData.annotations ??= []).push(`${String(label)}${suffix}`);
        }
      }
    };
  }

  static _recalculate(data) {
    const bonus = Number(data.effectActionSuccessBonus ?? 0);
    if (bonus) {
      data.successCount = Math.max(0, Number(data.successCount ?? 0) + bonus);
      data.successPoints = Math.max(0, Number(data.successPoints ?? 0) + bonus);
    }
    if (data.effectActionForcedSuccess !== undefined) data.isSuccess = data.effectActionForcedSuccess;
    else if (bonus > 0 && Number(data.successCount) > 0) data.isSuccess = true;
    data.effectActionSuccessBonus = 0;
  }

  static async _updateMessage(message, rollData) {
    const type = message.getFlag("neuroshima", "messageType");
    const template = type === "initiative"
      ? "systems/neuroshima/templates/chat/initiative-roll-card.hbs"
      : rollData.isMelee
        ? "systems/neuroshima/templates/chat/melee-roll-card.hbs"
        : type === "weapon"
          ? "systems/neuroshima/templates/chat/weapon-roll-card.hbs"
          : "systems/neuroshima/templates/chat/roll-card.hbs";
    const content = await foundry.applications.handlebars.renderTemplate(template, {
      ...rollData, config: NEUROSHIMA, isGM: game.user.isGM
    });
    await message.update({ content, "flags.neuroshima.rollData": rollData });
  }
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
