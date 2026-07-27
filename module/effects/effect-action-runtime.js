import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/dice.js";
import { NeuroshimaScript } from "../apps/neuroshima-script-engine.js";
import { NeuroshimaTestFactory } from "../tests/test-factory.js";

/**
 * Runtime for post-roll actions declared by Active Effects.
 *
 * A normal effect trigger is the sole authority deciding whether an action
 * appears. Chat flags contain references only; executable code is resolved
 * again from the live effect when the button is pressed.
 */
export class EffectActionRuntime {
  static SURFACE_TEST = "testResult";
  static SURFACE_MELEE = "meleePool";

  static async collect(_actor, _rollData, surface = this.SURFACE_TEST, additions = []) {
    const entries = [];
    for (const addition of additions ?? []) {
      const effect = addition.effectUuid ? await fromUuid(addition.effectUuid) : null;
      const action = effect?.system?.actionDefs?.find(def => def.id === addition.actionId);
      if (!effect || !action || (action.type ?? "melee") !== "result") continue;
      const ref = await this._reference(effect, action, surface);
      entries.push(foundry.utils.mergeObject(ref, addition.overrides ?? {}, { inplace: false }));
    }
    return Array.from(new Map(entries.map(entry => [entry.instanceId, entry])).values());
  }

  static async _reference(effect, action, surface) {
    const sourceItem = await this._sourceItem(effect);
    return {
      instanceId: `${effect.uuid}::${action.id}::${surface}`,
      sourceEffectUuid: effect.uuid,
      actionId: action.id,
      surface,
      name: action.name || effect.name,
      img: effect.img || sourceItem?.img || "icons/svg/lightning.svg",
      used: false
    };
  }

  static async execute(message, instanceId) {
    const rollData = foundry.utils.deepClone(message.getFlag("neuroshima", "rollData") ?? {});
    const ref = (rollData.effectActions ?? []).find(entry => entry.instanceId === instanceId);
    if (!ref) return ui.notifications.warn("Ta akcja nie jest już dostępna na tej karcie.");
    if (ref.used) return ui.notifications.warn("Ta akcja została już użyta.");

    const effect = await fromUuid(ref.sourceEffectUuid);
    const action = effect?.system?.actionDefs?.find(def => def.id === ref.actionId);
    const actor = this._actor(effect, rollData);
    if (!effect || effect.disabled || effect.isSuppressed || !action || (action.type ?? "melee") !== "result") {
      return ui.notifications.warn("Efekt lub definicja tej akcji nie jest już aktywna.");
    }
    if (!game.user.isGM && !actor?.isOwner && message.author?.id !== game.user.id) {
      return ui.notifications.warn("Nie masz uprawnień do wykonania tej akcji.");
    }

    const sourceItem = await this._sourceItem(effect);
    const serialized = message.getFlag("neuroshima", "test");
    const test = serialized?.classId
      ? await NeuroshimaTestFactory.fromData({ ...serialized, rollData })
      : null;
    const ctx = this._context({
      actor, effect, sourceItem, action, rollData,
      surface: ref.surface, message, test
    });
    const code = String(action.executeScript ?? action.result?.executeScript ?? "").trim();
    try {
      if (code) {
        const script = new NeuroshimaScript({
          trigger: "internalAction",
          label: action.name || effect.name,
          throwOnError: true,
          code: `const ctx = args.actionContext;\n${code}`
        }, effect);
        const result = await script.execute({
          actor, item: sourceItem, rollData,
          test: test ?? { result: { rollData } },
          actionContext: ctx
        });
        if (result === false) return;
      }
      if (test) {
        test.markDirty("effectAction");
        await test.recalculate();
        await test.applyResultOverrides();
      } else {
        this._recalculate(rollData);
      }
      ref.used = true;
      await this.rerenderMessage(message, rollData);
    } catch (error) {
      console.error(`Neuroshima | executeScript failed for ${action.id}`, error);
      ui.notifications.error(`Nie udało się wykonać akcji: ${error.message}`);
    }
  }

  static chooseAndExecute(message, instanceId) {
    return this.execute(message, instanceId);
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

  static _rolledDice(rollData) {
    return [...(rollData.rolledResults ?? rollData.rawResults ?? [])].map(Number);
  }

  static _effectiveDice(rollData) {
    if (Array.isArray(rollData.modifiedResults) && rollData.modifiedResults.length) {
      return rollData.modifiedResults.map(die => Number(die?.modified ?? die?.original ?? die));
    }
    return (rollData.rawResults ?? []).map(Number);
  }

  static _context({ actor, effect, sourceItem, action, rollData, surface, message, test = null }) {
    const replace = (index, value, options = {}) => {
      index = Number(index);
      value = Number(value);
      if (!Array.isArray(rollData.rawResults) || !Number.isInteger(index)) return false;
      if (index < 0 || index >= rollData.rawResults.length || !Number.isFinite(value)) return false;
      rollData.rolledResults ??= [...rollData.rawResults];
      rollData.diceChanges ??= [];
      value = Math.clamp(Math.trunc(value), 1, 20);
      const oldValue = rollData.rawResults[index];
      if (oldValue === value) return false;
      rollData.rawResults[index] = value;
      rollData.diceChanges.push({
        type: options.type ?? "replace",
        targetIndex: index,
        sourceIndex: Number.isInteger(options.sourceIndex) ? options.sourceIndex : null,
        oldValue,
        newValue: value,
        label: options.label ?? action.name ?? effect.name,
        icon: options.icon ?? "fas fa-pen",
        effectUuid: effect.uuid
      });
      return true;
    };

    return {
      actor, effect, sourceItem, item: sourceItem, action, message, surface, rollData, test,
      dice: {
        rolled: this._rolledDice(rollData),
        effective: this._effectiveDice(rollData),
        get: index => this._effectiveDice(rollData)[Number(index)],
        choose: options => this._chooseDice(rollData, options),
        replace,
        copy: (source, target, options = {}) =>
          replace(target, this._effectiveDice(rollData)[Number(source)], {
            ...options, type: "copy", sourceIndex: Number(source)
          })
      },
      result: {
        addSuccesses: amount => {
          rollData.effectActionSuccessBonus = Number(rollData.effectActionSuccessBonus ?? 0) + Number(amount ?? 0);
        },
        addSuccessPoints: amount => {
          rollData.effectActionSuccessPointsBonus = Number(rollData.effectActionSuccessPointsBonus ?? 0) + Number(amount ?? 0);
        },
        forceSuccess: () => { rollData.effectActionForcedSuccess = true; },
        forceFailure: () => { rollData.effectActionForcedSuccess = false; },
        annotate: text => {
          const annotation = String(text ?? "").trim();
          if (annotation) (rollData.annotations ??= []).push(annotation);
        }
      }
    };
  }

  static async _chooseDice(rollData, { min = 1, max = 1, filter = null, prompt = "Wybierz kości." } = {}) {
    const rolled = this._rolledDice(rollData);
    const effective = this._effectiveDice(rollData);
    const dice = rolled.map((value, index) => ({ index, rolled: value, effective: effective[index] }));
    const available = typeof filter === "function" ? dice.filter(filter) : dice;
    min = Math.max(0, Number(min));
    max = Math.max(min, Number(max));
    const fields = available.map(die =>
      `<label class="ns-effect-die-choice"><input type="checkbox" name="die" value="${die.index}"> D${die.index + 1}: <strong>${die.rolled}</strong></label>`
    ).join("");
    const picked = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Wybierz kości" },
      content: `<form class="ns-effect-die-picker"><p>${foundry.utils.escapeHTML(String(prompt))}</p>${fields}</form>`,
      ok: {
        label: "Wybierz",
        callback: (_event, button) => Array.from(
          button.form.querySelectorAll('[name="die"]:checked'),
          element => Number(element.value)
        )
      },
      rejectClose: false
    });
    if (!Array.isArray(picked)) return null;
    if (picked.length < min || picked.length > max) {
      ui.notifications.warn(`Wybierz od ${min} do ${max} kości.`);
      return null;
    }
    return picked;
  }

  static _recalculate(data) {
    if (data.diceChanges?.length) {
      NeuroshimaDice.recalculateRollTestAfterScripts({ result: { rollData: data } });
    }
    const bonus = Number(data.effectActionSuccessBonus ?? 0);
    const pointsBonus = Number(data.effectActionSuccessPointsBonus ?? 0);
    if (bonus) {
      data.successCount = Math.max(0, Number(data.successCount ?? 0) + bonus);
      data.successPoints = Math.max(0, Number(data.successPoints ?? 0) + bonus);
    }
    if (pointsBonus) data.successPoints = Math.max(0, Number(data.successPoints ?? 0) + pointsBonus);
    if (data.effectActionForcedSuccess !== undefined) {
      data.success = data.isSuccess = data.effectActionForcedSuccess;
    } else {
      data.isSuccess = Boolean(data.success);
      if (bonus > 0 && Number(data.successCount) > 0) data.success = data.isSuccess = true;
    }
    data.effectActionSuccessBonus = 0;
    data.effectActionSuccessPointsBonus = 0;
  }

  static async rerenderMessage(message, rollData) {
    const type = message.getFlag("neuroshima", "messageType");
    const actor = game.actors.get(rollData.actorId);
    const minTooltipRole = game.settings.get("neuroshima", "rollTooltipMinRole");
    const showTooltip = game.user.role >= minTooltipRole
      || (game.settings.get("neuroshima", "rollTooltipOwnerVisibility") && actor?.isOwner);
    const template = type === "initiative"
      ? "systems/neuroshima/templates/chat/initiative-roll-card.hbs"
      : type === "healingRoll"
        ? "systems/neuroshima/templates/chat/healing-roll-card.hbs"
      : rollData.isMelee
        ? "systems/neuroshima/templates/chat/melee-roll-card.hbs"
        : type === "weapon"
          ? "systems/neuroshima/templates/chat/weapon-roll-card.hbs"
          : "systems/neuroshima/templates/chat/roll-card.hbs";
    const content = await foundry.applications.handlebars.renderTemplate(template, {
      ...rollData,
      config: NEUROSHIMA,
      isGM: game.user.isGM,
      showTooltip,
      patientRef: { uuid: rollData.patientActor?.uuid },
      medicRef: { uuid: actor?.uuid }
    });
    const testData = message.getFlag("neuroshima", "test");
    if (testData) testData.rollData = rollData;
    await message.update({
      content,
      "flags.neuroshima.rollData": rollData,
      "flags.neuroshima.test": testData
    });
  }
}
