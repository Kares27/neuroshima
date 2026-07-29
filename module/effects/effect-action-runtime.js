import { NeuroshimaScript } from "../apps/neuroshima-script-engine.js";
import { NeuroshimaTestBase } from "../tests.mjs";
import { buildRichTextTooltip } from "../helpers/tooltip-renderer.js";

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
  static _inFlight = new Set();

  static async collect(actor, rollData, surface = this.SURFACE_TEST, additions = []) {
    const entries = [];
    for (const addition of additions ?? []) {
      const effect = addition.effectUuid ? await fromUuid(addition.effectUuid) : null;
      const action = effect?.system?.actionDefs?.find(def => def.id === addition.actionId);
      if (!effect || !action || (action.type ?? "melee") !== "result") continue;
      const ref = await this._reference(effect, action, surface, actor, rollData);
      entries.push(foundry.utils.mergeObject(ref, addition.overrides ?? {}, { inplace: false }));
    }
    return Array.from(new Map(entries.map(entry => [entry.instanceId, entry])).values());
  }

  static async _reference(effect, action, surface, actor = null, rollData = {}) {
    const sourceItem = await this._sourceItem(effect);
    // `tooltip` is the legacy/shared melee field. Result actions persist their
    // rich description in the dedicated HTMLField added to the action schema.
    const description = String(action.description ?? action.tooltip ?? "").trim();
    let tooltipHtml = "";
    if (description) {
      const itemRollData = sourceItem?.getRollData?.() ?? {};
      const actorRollData = actor?.getRollData?.() ?? {};
      const enriched = await foundry.applications.ux.TextEditor.enrichHTML(description, {
        async: true,
        secrets: false,
        relativeTo: sourceItem ?? effect,
        rollData: {
          ...itemRollData,
          actor: actorRollData,
          test: rollData
        }
      });
      tooltipHtml = buildRichTextTooltip({
        title: action.name || effect.name,
        html: enriched
      });
    }
    return {
      instanceId: `${effect.uuid}::${action.id}::${surface}`,
      sourceEffectUuid: effect.uuid,
      actionId: action.id,
      surface,
      name: action.name || effect.name,
      img: effect.img || sourceItem?.img || "icons/svg/lightning.svg",
      tooltipHtml,
      used: false
    };
  }

  static async execute(message, instanceId) {
    const lockId = `${message.id}::${instanceId}`;
    if (this._inFlight.has(lockId)) {
      return ui.notifications.warn("Ta akcja jest już wykonywana.");
    }
    const serialized = foundry.utils.deepClone(message.getFlag("neuroshima", "test"));
    if (!serialized?.preData?.rollClass) {
      return ui.notifications.warn("Ta karta nie zawiera testu w nowym formacie.");
    }
    const test = await NeuroshimaTestBase.recreate(serialized);
    const rollData = test.result;
    const ref = (rollData.effectActions ?? []).find(entry => entry.instanceId === instanceId);
    if (!ref) return ui.notifications.warn("Ta akcja nie jest już dostępna na tej karcie.");
    if (ref.used || (test.context.usedResultActions ?? []).includes(instanceId)) {
      return ui.notifications.warn("Ta akcja została już użyta.");
    }

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
    const validation = await test.validateLinkedMutation();
    if (!validation.ok) {
      return ui.notifications.warn("Nie można już zmienić tej puli walki.");
    }
    const diceApi = test.getDiceApi();
    const resultApi = test.getResultApi();
    const ctx = this._context({
      actor, effect, sourceItem, action, rollData,
      surface: ref.surface, message, test, diceApi, resultApi
    });
    const code = String(action.executeScript ?? action.result?.executeScript ?? "").trim();
    const checkpoint = test.toData();
    this._inFlight.add(lockId);
    let claimed = false;
    try {
      if (game.neuroshima?.socket) {
        const claim = await game.neuroshima.socket.executeAsGM(
          "claimResultAction",
          message.id,
          instanceId,
          game.user.id
        );
        if (!claim?.ok) {
          return ui.notifications.warn(
            claim?.reason === "already-used"
              ? "Ta akcja została już użyta."
              : "Ta akcja jest już wykonywana."
          );
        }
        claimed = true;
      }
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
          context: test.context,
          eventContext: {
            phase: "result-action",
            actionId: action.id,
            instanceId
          },
          dice: diceApi,
          result: resultApi,
          links: {
            meleePool: foundry.utils.deepClone(test.context.meleePoolLink ?? null),
            opposed: foundry.utils.deepClone(test.context.opposedLink ?? null)
          },
          actionContext: ctx
        });
        if (result === false) return;
      }
      if (test.context.dirty) await test.recalculate();
      // The GM-side opposed refresh deliberately re-reads the source test card.
      // Persist the changed dice first, then let the authoritative refresh rebuild
      // the single duel message from both cards.
      if (test.context.opposedLink) {
        test.message = await test.updateMessage(message);
      }
      const syncResult = await test.syncLinkedState({
        reason: `result-action:${action.id}`
      });
      if (!syncResult.ok) {
        test.data = foundry.utils.deepClone(checkpoint);
        if (test.context.opposedLink) await test.updateMessage(message);
        return ui.notifications.warn("Nie udało się zsynchronizować zmiany z walką melee.");
      }
      test.context.usedResultActions ??= [];
      if (!test.context.usedResultActions.includes(instanceId)) {
        test.context.usedResultActions.push(instanceId);
      }
      const currentRef = (test.result.effectActions ?? [])
        .find(entry => entry.instanceId === instanceId);
      if (currentRef) currentRef.used = true;
      await test.updateMessage(message);
    } catch (error) {
      test.data = foundry.utils.deepClone(checkpoint);
      if (test.context.opposedLink) await test.updateMessage(message);
      console.error(`Neuroshima | executeScript failed for ${action.id}`, error);
      ui.notifications.error(`Nie udało się wykonać akcji: ${error.message}`);
    } finally {
      if (claimed && game.neuroshima?.socket) {
        await game.neuroshima.socket.executeAsGM(
          "releaseResultAction",
          message.id,
          instanceId
        );
      }
      this._inFlight.delete(lockId);
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

  static _context({
    actor,
    effect,
    sourceItem,
    action,
    rollData,
    surface,
    message,
    test = null,
    diceApi = test?.getDiceApi(),
    resultApi = test?.getResultApi()
  }) {
    // Preserve the original test API methods before decorating the object.
    // Calling diceApi.replace after assigning the wrapper back onto diceApi
    // would recurse into the wrapper indefinitely.
    const baseReplace = diceApi.replace.bind(diceApi);
    const baseCopy = diceApi.copy.bind(diceApi);
    const replace = (index, value, options = {}) =>
      baseReplace(index, value, {
        type: options.type ?? "replace",
        sourceIndex: Number.isInteger(options.sourceIndex) ? options.sourceIndex : null,
        label: options.label ?? action.name ?? effect.name,
        icon: options.icon ?? "fas fa-pen",
        effectUuid: effect.uuid
      });

    Object.assign(diceApi, {
      effective: this._effectiveDice(rollData),
      replace,
      copy: (source, target, options = {}) =>
        baseCopy(source, target, {
          ...options,
          type: "copy",
          sourceIndex: Number(source),
          label: options.label ?? action.name ?? effect.name,
          icon: options.icon ?? "fas fa-copy",
          effectUuid: effect.uuid
        }),
      // A result action is already attached to a visible roll card. Reuse the
      // same die selection used by selective rerolls instead of opening a
      // second modal picker over the chat.
      choose: options => this.chooseSelectedDice(message, rollData, options)
    });
    return {
      actor, effect, sourceItem, item: sourceItem, action, message, surface, rollData, test,
      dice: diceApi,
      result: resultApi
    };
  }

  static chooseDice(rollData, options = {}) {
    return this._chooseDice(rollData, options);
  }

  /**
   * Validate and return dice selected directly on a roll card.
   *
   * Result-card actions deliberately do not fall back to a modal dialog. This
   * keeps the interaction consistent with selective rerolls: mark dice first,
   * then press the action button.
   */
  static async chooseSelectedDice(
    message,
    rollData,
    { min = 1, max = 1, filter = null, prompt = "Wybierz kości na karcie rzutu." } = {}
  ) {
    const selectionMap = globalThis.window?._nsRerollSelectedMap;
    const selectedIndices = [...(selectionMap?.get(message?.id) ?? [])]
      .map(Number)
      .filter(Number.isInteger);
    min = Math.max(0, Number(min));
    max = Math.max(min, Number(max));

    if (selectedIndices.length < min || selectedIndices.length > max) {
      ui.notifications.warn(
        selectedIndices.length === 0
          ? String(prompt)
          : `Wybierz od ${min} do ${max} kości na karcie rzutu.`
      );
      return null;
    }

    const rolled = this._rolledDice(rollData);
    const effective = this._effectiveDice(rollData);
    const dice = rolled.map((value, index) => ({
      index,
      rolled: value,
      effective: effective[index]
    }));
    const selectedDice = selectedIndices.map(index => dice[index]).filter(Boolean);
    if (
      selectedDice.length !== selectedIndices.length
      || (typeof filter === "function" && selectedDice.some(die => !filter(die)))
    ) {
      ui.notifications.warn("Wybrana kość nie spełnia warunków tej akcji.");
      return null;
    }
    return selectedIndices;
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
