import { NeuroshimaScript } from "../apps/neuroshima-script-engine.js";
import { NeuroshimaTestBase } from "../tests.mjs";

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
    const serialized = foundry.utils.deepClone(message.getFlag("neuroshima", "test"));
    if (!serialized?.preData?.rollClass) {
      return ui.notifications.warn("Ta karta nie zawiera testu w nowym formacie.");
    }
    const test = await NeuroshimaTestBase.recreate(serialized);
    const rollData = test.result;
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
          test,
          actionContext: ctx
        });
        if (result === false) return;
      }
      if (test.context.dirty) await test.recalculate();
      ref.used = true;
      await test.updateMessage(message);
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
      return test.replaceDie(index, value, {
        type: options.type ?? "replace",
        sourceIndex: Number.isInteger(options.sourceIndex) ? options.sourceIndex : null,
        label: options.label ?? action.name ?? effect.name,
        icon: options.icon ?? "fas fa-pen",
        effectUuid: effect.uuid
      });
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
        addSuccesses: amount => test.addSuccesses(amount),
        addSuccessPoints: amount => test.addSuccessPoints(amount),
        forceSuccess: () => test.forceSuccess(),
        forceFailure: () => test.forceFailure(),
        addAnnotation: text => test.addAnnotation(text)
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

}
