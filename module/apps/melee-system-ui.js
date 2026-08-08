import {
  MeleeActionCatalog,
  MeleeMigration,
  normalizeMeleeActivity,
  isMeleeEnabled,
  isMeleeSessionMarker,
  buildMeleeRequiredAction,
  meleePoolDice,
  meleeParticipantFromActor,
  meleeSessionDuelState
} from "../combat/melee-system.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** Shared declarative editor for Item and ActiveEffect melee activities. */
export class MeleeActivityEditor extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(document, activityId = null, options = {}) {
    super(options);
    this.document = document;
    this.activityId = activityId;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "melee-activity-editor"],
    window: { resizable: true },
    position: { width: 620, height: 720 },
    form: { handler: MeleeActivityEditor._submit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      addCondition: MeleeActivityEditor._addCondition,
      addOperation: MeleeActivityEditor._addOperation,
      newActivity: MeleeActivityEditor._newActivity,
      editActivity: MeleeActivityEditor._editActivity,
      removeActivity: MeleeActivityEditor._removeActivity
    }
  };

  static PARTS = { form: { template: "systems/neuroshima/templates/apps/melee-v2-config.hbs" } };

  get title() { return `Akcje melee: ${this.document.name}`; }

  get activities() {
    if (["beast-action", "beast-segment"].includes(this.document.type)) {
      return Array.from(this.document.system?.activities ?? []);
    }
    return this.document.documentName === "ActiveEffect"
      ? Array.from(this.document.system?.melee?.grantedActivities ?? [])
      : Array.from(this.document.getFlag("neuroshima", "meleeActivities") ?? []);
  }

  async _prepareContext() {
    const existing = this.activities.find(activity => activity.id === this.activityId);
    const activity = normalizeMeleeActivity(existing ?? {
      id: foundry.utils.randomID(), name: "Nowa akcja melee", category: "attack",
      activation: { role: "either", timing: "declaration", minDice: 1, maxDice: 3, successCost: 0, segmentCost: 0 },
      automation: { approval: "gm", resolver: "opposedSuccessPoints" }
    });
    this.activityId = activity.id;
    const quickOutcome = activity.outcomes[0] ?? null;
    const quickOperation = quickOutcome?.operations?.[0] ?? activity.operations[0] ?? null;
    const quickEditable = activity.outcomes.length <= 1 && activity.operations.length <= 1 &&
      (quickOutcome?.operations?.length ?? activity.operations.length) <= 1;
    const conditionRows = Array.from({ length: 3 }, (_, index) => {
      const condition = activity.conditions[index] ?? {};
      return { index, key: condition.key ?? "", value: condition.value ?? condition.stackKey ?? "" };
    });
    const meleeModifiers = Array.from(
      this.document.documentName === "ActiveEffect"
        ? (this.document.system?.melee?.modifiers ?? [])
        : (this.document.getFlag?.("neuroshima", "meleeDamageModifiers") ?? [])
    );
    return {
      activity,
      activityList: this.activities.map(entry => ({ id: entry.id, name: entry.name || entry.label || entry.id })),
      tagsText: activity.tags.join(", "),
      conditionsJson: JSON.stringify(activity.conditions, null, 2),
      outcomesJson: JSON.stringify(activity.outcomes, null, 2),
      operationsJson: JSON.stringify(activity.operations, null, 2),
      expiryRulesJson: JSON.stringify(this.document.system?.melee?.expiryRules ?? [], null, 2),
      modifiersJson: JSON.stringify(meleeModifiers, null, 2),
      restrictionsJson: JSON.stringify(this.document.system?.melee?.restrictions ?? [], null, 2),
      conditionRows,
      conditionChoices: [
        ["", "Brak"], ["hasInitiative", "Posiada inicjatywę"], ["lacksInitiative", "Nie posiada inicjatywy"],
        ["segment", "Segment (0–2)"], ["minDice", "Minimum kości"], ["maxDice", "Maksimum kości"],
        ["minSuccessPoints", "Minimum sukcesów"], ["previousHit", "Poprzednio trafiono"],
        ["targetHasEffect", "Cel ma status"], ["weaponTag", "Tag broni"], ["usageLimit", "Limit użyć"]
      ].map(([value, label]) => ({ value, label })),
      quick: {
        enabled: !!quickOperation && quickEditable,
        when: quickOutcome?.when ?? "hit",
        operationType: quickOperation?.type ?? "damage",
        target: quickOperation?.target ?? quickOutcome?.target ?? "opponent",
        effectUuid: quickOperation?.data?.effectUuid ?? quickOperation?.data?.sourceEffectUuid ?? "",
        stackMode: quickOperation?.data?.stackMode ?? "ignore",
        damage1: activity.damage.profile[1] ?? quickOperation?.data?.damageProfiles?.[0] ?? "",
        damage2: activity.damage.profile[2] ?? quickOperation?.data?.damageProfiles?.[1] ?? "",
        damage3: activity.damage.profile[3] ?? quickOperation?.data?.damageProfiles?.[2] ?? "",
        testType: activity.test?.type ?? "attribute",
        testKey: activity.test?.key ?? "",
        testDifficulty: activity.test?.difficulty ?? "average"
      },
      parameter: (() => {
        const parameter = activity.parameters[0] ?? { key: "", label: "", type: "number", default: 0, min: null, max: null, choices: [] };
        return { ...parameter, choicesText: (parameter.choices ?? []).map(choice => `${choice.value}: ${choice.label}`).join(", ") };
      })(),
      activityModifier: (() => {
        const change = activity.changes.find(entry => entry.type === "damageTierShift") ?? {};
        return {
          activityTagsText: Array.from(activity.selectors?.activityTags ?? activity.selectors?.tags ?? []).join(", "),
          weaponTagsText: Array.from(activity.selectors?.weaponTags ?? []).join(", "),
          tiersText: Array.from(change.tiers ?? [1, 2, 3]).join(", "),
          value: change.value ?? 1,
          priority: activity.priority ?? 100
        };
      })(),
      modifierTiers: [1, 2, 3].map(tier => {
        const modifier = meleeModifiers.find(entry => Number(entry.tier) === tier);
        return { tier, mode: modifier?.mode ?? "", value: modifier?.value ?? "", priority: modifier?.priority ?? 100 };
      }),
      modifierTagsText: Array.from(new Set(meleeModifiers.flatMap(modifier =>
        Array.from(modifier.selector?.tags ?? [])
      ))).join(", ") || "melee.attack",
      isEffect: this.document.documentName === "ActiveEffect",
      melee: this.document.system?.melee?.toObject?.() ?? this.document.system?.melee ?? {}
    };
  }

  static async _submit(_event, form, formData) {
    const data = formData.object;
    const parse = (value, label) => {
      try { return JSON.parse(value || "[]"); }
      catch (_error) { throw new Error(`${label}: niepoprawny JSON`); }
    };
    const conditions = [0, 1, 2].map(index => {
      const key = data[`condition${index}Key`];
      if (!key) return null;
      const value = data[`condition${index}Value`];
      if (["hasInitiative", "lacksInitiative", "previousHit"].includes(key)) return { key };
      if (key === "targetHasEffect") return { key, stackKey: value };
      return { key, value: ["segment", "minDice", "maxDice", "minSuccessPoints", "usageLimit"].includes(key)
        ? Number(value) : value };
    }).filter(Boolean);
    const useQuickOutcome = data.useQuickOutcome === true;
    const quickOperation = useQuickOutcome ? {
      id: foundry.utils.randomID(),
      type: data.operationType || "damage",
      target: data.operationTarget || "opponent",
      data: data.operationType === "damage"
        ? { damageProfiles: [data.damage1 || null, data.damage2 || null, data.damage3 || null] }
        : ["applyActiveEffect", "removeActiveEffect"].includes(data.operationType)
          ? { effectUuid: data.effectUuid || null, stackMode: data.effectStackMode || "ignore" }
          : data.operationType === "modifyInitiative"
            ? { to: data.operationTarget === "self" ? "self" : "opponent" }
            : {}
    } : null;
    const normalized = normalizeMeleeActivity({
      id: this.activityId,
      name: data.name,
      description: data.description,
      kind: data.kind || "action",
      category: data.category,
      tags: String(data.tags || "").split(",").map(tag => tag.trim()).filter(Boolean),
      activation: {
        role: data.role, timing: data.timing,
        minDice: Number(data.minDice), maxDice: Number(data.maxDice),
        exactDice: data.exactDice === "" || data.exactDice == null ? null : Number(data.exactDice),
        committedDice: {
          min: Number(data.minDice), max: Number(data.maxDice),
          exact: data.exactDice === "" || data.exactDice == null ? null : Number(data.exactDice)
        },
        successCost: Number(data.successCost), segmentCost: Number(data.segmentCost),
        requiredSuccesses: {
          min: Number(data.successCost),
          max: data.maxSuccesses === "" || data.maxSuccesses == null ? null : Number(data.maxSuccesses)
        },
        occupiedSegments: {
          mode: data.occupiedSegmentsMode || "selectedDice",
          value: data.occupiedSegmentsValue === "" || data.occupiedSegmentsValue == null
            ? null : Number(data.occupiedSegmentsValue)
        },
        responsePolicy: data.responsePolicy || "exact",
        uses: data.uses === "" || data.uses == null ? null : Number(data.uses),
        diceReusePolicy: {
          mode: data.diceReuseMode || "none",
          trigger: data.diceReuseTrigger || null
        }
      },
      conditions: conditions.length ? conditions : parse(data.conditionsJson, "Warunki"),
      test: data.testEnabled === true ? {
        type: data.testType || "attribute", key: data.testKey || "", difficulty: data.testDifficulty || "average"
      } : null,
      parameters: data.parameterKey ? [{
        key: data.parameterKey,
        label: data.parameterLabel || data.parameterKey,
        type: data.parameterType || "number",
        default: data.parameterDefault,
        min: data.parameterMin === "" ? null : Number(data.parameterMin),
        max: data.parameterMax === "" ? null : Number(data.parameterMax),
        choices: String(data.parameterChoices || "").split(",").map(entry => {
          const [value, ...label] = entry.split(":");
          return { value: value.trim(), label: (label.join(":").trim() || value.trim()) };
        }).filter(choice => choice.value)
      }] : [],
      selectors: {
        activityTags: String(data.activityModifierTags || "").split(",").map(tag => tag.trim()).filter(Boolean),
        weaponTags: String(data.activityModifierWeaponTags || "").split(",").map(tag => tag.trim()).filter(Boolean)
      },
      changes: (data.kind || "action") === "modifier" ? [{
        type: "damageTierShift",
        value: Number(data.activityModifierValue || 0),
        tiers: String(data.activityModifierTiers || "1,2,3").split(",").map(Number).filter(tier => [1, 2, 3].includes(tier))
      }] : [],
      priority: Number(data.activityModifierPriority ?? 100),
      damage: { mode: data.damageMode || "weapon", profile: { 1: data.damage1 || null, 2: data.damage2 || null, 3: data.damage3 || null } },
      outcomes: quickOperation ? [{
        id: foundry.utils.randomID(), when: data.outcomeWhen || "hit", target: quickOperation.target,
        label: data.outcomeLabel || "Wynik akcji", operations: [quickOperation]
      }] : parse(data.outcomesJson, "Wyniki"),
      operations: quickOperation ? [] : parse(data.operationsJson, "Operacje"),
      automation: { approval: data.approval, resolver: data.resolver }
    });
    const previous = this.activities.find(entry => entry.id === this.activityId);
    const activity = { ...(previous?.toObject?.() ?? previous ?? {}), ...normalized };
    if (["beast-action", "beast-segment"].includes(this.document.type)) {
      activity.meleeDamage = normalized.damage;
      activity.damage = previous?.damage ?? "";
    }
    const activities = this.activities.map(entry => entry.id === activity.id ? activity : entry);
    if (!activities.some(entry => entry.id === activity.id)) activities.push(activity);
    if (["beast-action", "beast-segment"].includes(this.document.type)) {
      await this.document.update({ "system.activities": activities });
      const typedModifiers = [1, 2, 3].map(tier => {
        const mode = data[`modifierTier${tier}Mode`];
        if (!mode) return null;
        return {
          selector: { tags: String(data.modifierTags || "melee.attack").split(",").map(value => value.trim()).filter(Boolean) },
          tier, mode, value: data[`modifierTier${tier}Value`],
          priority: Number(data[`modifierTier${tier}Priority`] ?? 100)
        };
      }).filter(Boolean);
      await this.document.setFlag("neuroshima", "meleeDamageModifiers",
        typedModifiers.length ? typedModifiers : parse(data.modifiersJson, "Modyfikatory"));
    } else if (this.document.documentName === "ActiveEffect") {
      const typedModifiers = [1, 2, 3].map(tier => {
        const mode = data[`modifierTier${tier}Mode`];
        if (!mode) return null;
        return {
          selector: { tags: String(data.modifierTags || "melee").split(",").map(value => value.trim()).filter(Boolean) },
          tier,
          mode,
          value: data[`modifierTier${tier}Value`],
          priority: Number(data[`modifierTier${tier}Priority`] ?? 100)
        };
      }).filter(Boolean);
      await this.document.update({
        "system.melee.stackKey": data.stackKey || "",
        "system.melee.stackMode": data.stackMode || "ignore",
        "system.melee.modifiers": typedModifiers.length ? typedModifiers : parse(data.modifiersJson, "Modyfikatory"),
        "system.melee.restrictions": parse(data.restrictionsJson, "Ograniczenia"),
        "system.melee.expiryRules": parse(data.expiryRulesJson, "Wygasanie"),
        "system.melee.grantedActivities": activities
      });
    } else {
      const typedModifiers = [1, 2, 3].map(tier => {
        const mode = data[`modifierTier${tier}Mode`];
        if (!mode) return null;
        return {
          selector: { tags: String(data.modifierTags || "melee.attack").split(",").map(value => value.trim()).filter(Boolean) },
          tier,
          mode,
          value: data[`modifierTier${tier}Value`],
          priority: Number(data[`modifierTier${tier}Priority`] ?? 100)
        };
      }).filter(Boolean);
      await this.document.setFlag("neuroshima", "meleeActivities", activities);
      await this.document.setFlag("neuroshima", "meleeDamageModifiers",
        typedModifiers.length ? typedModifiers : parse(data.modifiersJson, "Modyfikatory"));
    }
    ui.notifications.info("Zapisano definicję akcji melee.");
    this.render({ force: true });
  }

  static _addCondition() {
    const textarea = this.element.querySelector('[name="conditionsJson"]');
    const values = JSON.parse(textarea.value || "[]");
    values.push({ key: "always" });
    textarea.value = JSON.stringify(values, null, 2);
  }

  static _addOperation() {
    const textarea = this.element.querySelector('[name="operationsJson"]');
    const values = JSON.parse(textarea.value || "[]");
    values.push({ id: foundry.utils.randomID(), type: "chatEntry", target: "opponent", data: { text: "" } });
    textarea.value = JSON.stringify(values, null, 2);
  }

  static _newActivity() {
    this.activityId = foundry.utils.randomID();
    this.render({ force: true });
  }

  static _editActivity(_event, target) {
    this.activityId = target.closest("[data-activity-id]")?.dataset.activityId;
    this.render({ force: true });
  }

  static async _removeActivity(_event, target) {
    const id = target.closest("[data-activity-id]")?.dataset.activityId;
    if (!id) return;
    const activities = this.activities.filter(entry => entry.id !== id);
    if (["beast-action", "beast-segment"].includes(this.document.type)) {
      await this.document.update({ "system.activities": activities });
    } else if (this.document.documentName === "ActiveEffect") {
      await this.document.update({ "system.melee.grantedActivities": activities });
    } else await this.document.setFlag("neuroshima", "meleeActivities", activities);
    this.activityId = activities[0]?.id ?? foundry.utils.randomID();
    this.render({ force: true });
  }
}

export class MeleeSessionPresenter {
  static _resultMessagePromises = new Map();
  static _diceFromResult(result = {}) {
    return (result.modifiedResults ?? []).map((die, index) => ({
      id: die.id || `die-${index + 1}-${foundry.utils.randomID(6)}`,
      raw: die.original ?? result.rawResults?.[index] ?? die.modified,
      modified: die.modified ?? die.original,
      target: result.target,
      isSuccess: die.isSuccess === true,
      successPoints: die.isSuccess === true ? 1 : 0,
      changes: result.diceChanges?.filter(change => change.index === index) ?? []
    }));
  }

  static async _actor(participant) {
    const document = await fromUuid(participant?.tokenUuid || participant?.actorUuid);
    return document?.actor ?? document ?? null;
  }

  static async _pendingContext(session, status = "pending") {
    const attacker = await this._actor(session.participants.attacker);
    const defender = await this._actor(session.participants.defender);
    const defenderWeapons = Array.from(defender?.items ?? [])
      .filter(item => item.type === "weapon" && item.system?.weaponType === "melee")
      .map(item => ({ id: item.id, name: item.name, img: item.img }));
    return {
      mode: session.mode,
      modeLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${session.mode}`),
      attackerName: attacker?.name ?? session.participants.attacker.name,
      attackerImg: attacker?.img ?? "",
      defenderName: defender?.name ?? session.participants.defender.name,
      defenderImg: defender?.img ?? "",
      defenderWeapons,
      canDefend: game.user.isGM || defender?.isOwner === true,
      status
    };
  }

  static async beginAttack(actor, weapon, targetUuid, mode = "opposedPips", lifecycle = {}) {
    if (!isMeleeEnabled()) throw new Error("Silnik walki wręcz jest niedostępny.");
    const targetDocument = await fromUuid(targetUuid);
    const defender = targetDocument?.actor ?? targetDocument;
    if (!actor || !defender) throw new Error("Nie udało się odnaleźć uczestników zwarcia.");
    const { NeuroshimaWeaponRollDialog } = await import("./dialogs/weapon-roll-dialog.js");
    const dialog = new NeuroshimaWeaponRollDialog({
      actor,
      weapon,
      rollType: "melee",
      meleeAction: "attack",
      targets: [targetUuid],
      lastRoll: actor.system.lastWeaponRoll ?? {},
      isPoolRoll: true,
      onCancel: () => lifecycle.onCancel?.(),
      onRoll: async (rawResult, attackerTest) => {
        if (!rawResult) {
          const error = new Error("Nie udało się wykonać rzutu ataku wręcz.");
          lifecycle.onError?.(error);
          return;
        }
        const sessionId = foundry.utils.randomID(16);
        const startCommandId = foundry.utils.randomID(16);
        const sourceWeapon = weapon?.beastItemId ? actor.items?.get?.(weapon.beastItemId) ?? weapon : weapon;
        const attackerParticipant = meleeParticipantFromActor(actor, { weapon: sourceWeapon });
        const defenderParticipant = meleeParticipantFromActor(defender);
        const preview = {
          id: sessionId,
          mode,
          participants: { attacker: attackerParticipant, defender: defenderParticipant }
        };
        const content = await foundry.applications.handlebars.renderTemplate(
          "systems/neuroshima/templates/chat/melee-opposed-pending.hbs",
          await this._pendingContext(preview)
        );
        const message = await ChatMessage.create({
          speaker: { alias: "⚔" },
          content,
          rollMode: rawResult.rollMode ?? game.settings.get("core", "rollMode"),
          flags: { neuroshima: { melee: {
            sessionId, cardType: "pending", renderedRevision: -1
          } } }
        });
        const variant = rawResult.isGradCios === true ? "gradCiosow" : "standard";
        try {
          const started = await game.neuroshima.melee.requestStart({
            id: sessionId,
            startCommandId,
            messageId: message.id,
            attacker: attackerParticipant,
            defender: defenderParticipant,
            initiativeOwnerId: attackerParticipant.actorUuid,
            variant,
            mode,
            attackerRoll: {
              dice: this._diceFromResult(rawResult),
              target: rawResult.target
            },
            metadata: {
              attackerTestMessageId: attackerTest?.message?.id ?? null,
              weaponId: sourceWeapon?.id ?? null,
              beastItemId: weapon?.beastItemId ?? null,
              beastActivityId: weapon?.beastActivityId ?? null,
              damage1: rawResult.damageMelee1 ?? weapon?.system?.damageMelee1 ?? "D",
              damage2: rawResult.damageMelee2 ?? weapon?.system?.damageMelee2 ?? "L",
              damage3: rawResult.damageMelee3 ?? weapon?.system?.damageMelee3 ?? "K",
              location: rawResult.finalLocation ?? null,
              headDamageApplied: rawResult.headDamageApplied === true,
              attackerManeuver: rawResult.maneuver ?? null,
              activatedMeleePreRollMods: rawResult.activatedMeleePreRollMods ?? []
            }
          });
          if (attackerTest?.message) {
            attackerTest.context.opposedLink = {
              type: "meleeSession", sessionId, role: "attacker", messageId: message.id
            };
            await attackerTest.updateMessage(attackerTest.message);
          }
          lifecycle.onComplete?.(started, rawResult, attackerTest);
          return started;
        } catch (error) {
          await message.update({ content: `<div class="neuroshima melee-opposed-card"><p>${error.message}</p></div>` });
          lifecycle.onError?.(error);
          throw error;
        }
      }
    });
    dialog.render(true);
    return dialog;
  }

  static async context(session) {
    const ownerSide = session.participants.attacker.actorUuid === session.initiative.ownerId ? "attacker" : "defender";
    const activities = {};
    for (const side of ["attacker", "defender"]) {
      const participant = session.participants[side];
      const doc = await fromUuid(participant.tokenUuid || participant.actorUuid);
      const actor = doc?.actor ?? doc;
      const weapon = participant.weaponUuid ? await fromUuid(participant.weaponUuid) : null;
      activities[side] = actor ? MeleeActionCatalog.collect(actor, { item: weapon }).map(activity => ({
        ...activity,
        sourceItemUuid: activity.source.itemUuid,
        sourceEffectUuid: activity.source.effectUuid
      })) : [];
    }
    const requiredAction = await buildMeleeRequiredAction(session, game.user);
    const poolRows = ["attacker", "defender"].map(side => ({
      side,
      name: session.participants[side].name,
      dice: meleePoolDice(session, side)
    })).filter(row => row.dice.length);
    return {
      session,
      poolRows,
      requiredAction,
      ownerSide,
      responderSide: ownerSide === "attacker" ? "defender" : "attacker",
      ownerActivities: activities[ownerSide],
      responderActivities: activities[ownerSide === "attacker" ? "defender" : "attacker"],
      ownerName: session.participants[ownerSide].name,
      activities,
      canGM: game.user.isGM,
      canAct: {
        attacker: requiredAction.side === "attacker" && requiredAction.canAct,
        defender: requiredAction.side === "defender" && requiredAction.canAct
      },
      isAwaitingAttacker: session.phase === "awaitingAttackerRoll",
      isAwaitingDefender: session.phase === "awaitingDefenderRoll",
      isDeclaration: session.phase === "declaration",
      isResponse: session.phase === "response",
      isPending: session.phase === "pendingOutcomes",
      canAdvance: session.phase === "resolution",
      isComplete: session.phase === "complete"
    };
  }

  static async renderMessage(message, root) {
    if (!isMeleeEnabled()) return;
    const marker = message.getFlag("neuroshima", "melee");
    if (!isMeleeSessionMarker(marker)) return;
    const session = await game.neuroshima.melee.get(marker.sessionId, { messageId: message.id });
    if (!session) return;
    const element = root instanceof HTMLElement ? root : root?.[0];
    if (!element) return;
    await this.activate(element, session, message);
  }

  static async renderSession(session) {
    if (!game.user?.isGM) return null;
    const message = game.messages.get(session.messageId);
    if (!message) return null;
    let template;
    let context;
    let cardType;
    if (session.phase === "awaitingDefenderRoll" ||
        (session.phase === "complete" && session.endReason === "cancelled" && !session.hailResult)) {
      template = "systems/neuroshima/templates/chat/melee-opposed-pending.hbs";
      context = await this._pendingContext(session, session.endReason === "cancelled" ? "cancelled" : "pending");
      cardType = "pending";
    } else if (session.variant === "gradCiosow" && session.hailResult) {
      const attacker = await this._actor(session.participants.attacker);
      const defender = await this._actor(session.participants.defender);
      const result = session.hailResult;
      const toChip = die => ({
        value: die.modified ?? die.raw,
        isSuccess: die.isSuccess,
        isNat20: die.raw === 20
      });
      template = "systems/neuroshima/templates/chat/melee-hail-card.hbs";
      context = {
        attackerName: attacker?.name ?? session.participants.attacker.name,
        attackerImg: attacker?.img ?? "",
        defenderName: defender?.name ?? session.participants.defender.name,
        defenderImg: defender?.img ?? "",
        attackDiceChips: meleePoolDice(session, "attacker").map(toChip),
        defenseDiceChips: meleePoolDice(session, "defender").map(toChip),
        attackSuccesses: result.attackerSuccesses,
        isPending: false,
        isDone: true,
        isBlocked: result.blocked,
        hasHit: !result.blocked,
        outcomeLabel: result.blocked
          ? (result.netSuccesses === 0
            ? game.i18n.localize("NEUROSHIMA.GradCios.EqualSuccessesBlock")
            : game.i18n.localize("NEUROSHIMA.GradCios.Blocked"))
          : game.i18n.format("NEUROSHIMA.GradCios.Hit", { n: result.tier, dmg: result.damage })
      };
      cardType = "hail";
    } else if (session.exchange) {
      const { MeleeOpposedChat } = await import("../combat/combat.js");
      const attacker = await this._actor(session.participants.attacker);
      const defender = await this._actor(session.participants.defender);
      template = "systems/neuroshima/templates/chat/melee-duel-card.hbs";
      const duelState = meleeSessionDuelState(session);
      context = await MeleeOpposedChat._buildDuelContext(duelState, attacker, defender);
      const hasAppliedOutcome = session.result?.applied || session.hailResult?.applied ||
        session.pendingOutcomes.some(outcome => outcome.status === "applied");
      if (hasAppliedOutcome) {
        context.canUndo = false;
        context.canRedo = false;
      }
      const ownerSide = duelState.initiativeOwnerSide;
      const actingSide = session.phase === "response"
        ? (ownerSide === "attacker" ? "defender" : "attacker")
        : ownerSide;
      const actingRole = session.phase === "response" ? "responder" : "owner";
      const actingTimings = session.phase === "response"
        ? ["either", "response", "modifyDeclaration"]
        : ["either", "declaration", "modifyDeclaration", "followUp", "supplement"];
      const configuredEntries = (session.metadata.activitySnapshots?.[actingSide] ?? [])
        .filter(snapshot => ["either", actingRole].includes(snapshot.definition.activation.role) &&
          actingTimings.includes(snapshot.definition.activation.timing))
        .filter(snapshot => !session.metadata.beastActivityId ||
          snapshot.definition.source.kind !== "beast" ||
          snapshot.definition.kind === "modifier" ||
          snapshot.definition.id === session.metadata.beastActivityId)
        .map(snapshot => ({
        id: snapshot.definition.id,
        runtimeId: snapshot.runtimeId,
        sourceItemUuid: snapshot.definition.source.itemUuid,
        sourceEffectUuid: snapshot.definition.source.effectUuid,
        kind: snapshot.definition.kind,
        name: snapshot.definition.name,
        img: snapshot.definition.img,
        gmNote: snapshot.definition.description,
        minDice: snapshot.definition.activation.minDice,
        maxDice: snapshot.definition.activation.maxDice,
        exactDice: snapshot.definition.activation.exactDice,
        noDice: Number(snapshot.definition.activation.maxDice) === 0,
        successCost: Math.max(
          Number(snapshot.definition.activation.successCost ?? 0),
          Number(snapshot.definition.activation.requiredSuccesses?.min ?? 0)
        ),
        damage: snapshot.definition.damage?.profile?.[1]
          ?? snapshot.definition.operations?.find(operation => operation.type === "damage")?.data?.damage
          ?? "",
        parameters: snapshot.definition.parameters
      }));
      const configuredActivities = configuredEntries.filter(entry => entry.kind !== "modifier");
      const configuredModifiers = configuredEntries.filter(entry => entry.kind === "modifier");
      if (session.phase === "response") {
        context.responderExtraActions = configuredActivities;
        context.responderActivityModifiers = configuredModifiers;
      } else {
        context.ownerActivityModifiers = configuredModifiers;
      }
      if (session.phase !== "response" && configuredActivities.length) {
        const byId = new Map([...(context.ownerExtraActions ?? []), ...configuredActivities]
          .map(activity => [activity.runtimeId || `${activity.sourceEffectUuid || activity.sourceItemUuid || "legacy"}::${activity.id}`, activity]));
        context.ownerExtraActions = [...byId.values()];
      }
      context.pendingMeleeOutcomes = (session.pendingOutcomes ?? [])
        .filter(outcome => outcome.status === "pending")
        .map(outcome => ({ id: outcome.id, label: outcome.label }));
      context.damageModifierSummary = (session.exchange.declaration?.damageSnapshot?.modifiers ?? []).map(modifier => ({
        sourceName: modifier.sourceName,
        tier: modifier.tier,
        before: modifier.before,
        after: modifier.after
      }));
      if (session.metadata.beastActivityId && Array.isArray(context.ownerBeastActions)) {
        context.ownerBeastActions = context.ownerBeastActions.filter(activity =>
          activity.id === session.metadata.beastActivityId ||
          String(activity.id).endsWith(`::${session.metadata.beastActivityId}`)
        );
      }
      cardType = duelState.status === "done" ? "result" : "duel";
    } else return null;
    const content = await foundry.applications.handlebars.renderTemplate(template, context);
    if (cardType !== "pending" &&
        (!session.messages.duelMessageId || session.messages.duelMessageId === session.messages.pendingMessageId)) {
      const existing = this._resultMessagePromises.get(session.id);
      if (existing) return existing;
      const creation = (async () => {
        const pending = game.messages.get(session.messages.pendingMessageId || session.messageId);
        if (pending) {
          const resolvedContent = await foundry.applications.handlebars.renderTemplate(
            "systems/neuroshima/templates/chat/melee-opposed-pending.hbs",
            await this._pendingContext(session, "resolved")
          );
          await pending.update({
            content: resolvedContent,
            "flags.neuroshima.melee.cardType": "pending",
            "flags.neuroshima.melee.renderedRevision": session.revision
          });
        }
        const resultMessage = await ChatMessage.create({
          speaker: { alias: "⚔" },
          content,
          flags: { neuroshima: { melee: {
            sessionId: session.id, cardType, renderedRevision: session.revision
          } } }
        });
        await game.neuroshima.melee.bindResultMessage(session.id, resultMessage.id, session.revision);
        return resultMessage;
      })();
      this._resultMessagePromises.set(session.id, creation);
      try { return await creation; }
      finally { this._resultMessagePromises.delete(session.id); }
    }
    await message.update({
      content,
      "flags.neuroshima.melee": {
        sessionId: session.id,
        cardType,
        renderedRevision: session.revision
      }
    });
    return message;
  }

  /** Open the normal weapon-roll dialog and submit its 3d20 pool to the session. */
  static async openRoll(session, side, weaponId = null) {
    const expectedPhase = side === "attacker" ? "awaitingAttackerRoll" : "awaitingDefenderRoll";
    if (session.phase !== expectedPhase) {
      ui.notifications.warn("Ten rzut melee został już wykonany albo sesja oczekuje na drugą stronę.");
      return null;
    }
    const participant = session.participants[side];
    const requiredAction = await buildMeleeRequiredAction(session, game.user);
    if (requiredAction.side !== side || !requiredAction.canAct) {
      ui.notifications.warn("Nie masz uprawnień do wykonania tego rzutu melee.");
      return null;
    }
    const actorDoc = await fromUuid(participant.tokenUuid || participant.actorUuid);
    const actor = actorDoc?.actor ?? actorDoc;
    if (!actor) throw new Error("Nie udało się odnaleźć Aktora dla rzutu melee.");

    let weapon = weaponId ? actor.items?.get?.(weaponId) : null;
    weapon ??= participant.weaponUuid ? await fromUuid(participant.weaponUuid) : null;
    if (["beast-action", "beast-segment"].includes(weapon?.type)) {
      const beastItem = weapon;
      weapon = {
        id: null, uuid: beastItem.uuid, beastItemId: beastItem.id,
        name: beastItem.name, img: beastItem.img, type: "weapon",
        system: {
          weaponType: "melee", attribute: beastItem.system.attribute || "dexterity", skill: "experience",
          attackBonus: 0, defenseBonus: 0, piercing: 0,
          damageMelee1: "D", damageMelee2: "D", damageMelee3: "D"
        }
      };
    }
    weapon ??= {
      id: null, name: "Walka bez broni", img: actor.img, type: "weapon",
      system: {
        weaponType: "melee", attribute: "dexterity", skill: "melee",
        attackBonus: 0, defenseBonus: 0, piercing: 0,
        damageMelee1: "D", damageMelee2: "D", damageMelee3: "D"
      }
    };

    const { NeuroshimaWeaponRollDialog } = await import("./dialogs/weapon-roll-dialog.js");
    const gradDefenseDice = session.variant === "gradCiosow" && side === "defender"
      ? Math.min(3, Math.max(1, meleePoolDice(session, "attacker").filter(die => die.isSuccess).length || 1))
      : null;
    const dialog = new NeuroshimaWeaponRollDialog({
      actor,
      weapon,
      rollType: "melee",
      meleeAction: side === "attacker" ? "attack" : "defense",
      targets: [],
      isPoolRoll: true,
      fixedMeleeDiceCount: gradDefenseDice ?? (session.variant === "standard" ? 3 : null),
      gradCiosDefense: gradDefenseDice != null,
      onRoll: async (result, test) => {
        const dice = this._diceFromResult(result);
        try {
          const submitted = await game.neuroshima.melee.dispatch({
            type: "submitRoll",
            side,
            payload: {
              dice,
              target: result.target,
              maneuver: result.maneuver ?? null,
              testMessageId: test?.message?.id ?? null,
              weaponUuid: weapon?.uuid ?? null,
              defenderDamage1: weapon?.system?.damageMelee1 ?? "D",
              defenderDamage2: weapon?.system?.damageMelee2 ?? "L",
              defenderDamage3: weapon?.system?.damageMelee3 ?? "K"
            },
            sessionId: session.id,
            messageId: session.messageId,
            expectedRevision: session.revision,
            commandId: foundry.utils.randomID()
          });
          if (test?.message) {
            test.context.opposedLink = {
              type: "meleeSession", sessionId: session.id, role: side, messageId: session.messageId
            };
            await test.updateMessage(test.message);
          }
          return submitted;
        } catch (error) {
          ui.notifications.error(`Nie udało się zapisać rzutu melee: ${error.message}`);
          console.error("Neuroshima | Melee submitRoll failed", error);
          throw error;
        }
      }
    });
    dialog.render(true);
    return dialog;
  }

  static async activate(root, session, message = null) {
    // Foundry can expose more than one chat-render hook for the same DOM node.
    // Binding twice makes a die toggle on and immediately off during one click.
    // Mark the actual rendered card before the first await so concurrent hooks
    // cannot attach a second set of listeners to the same controls.
    const interactionSurface = root.querySelector(
      ".melee-duel-card, .melee-opposed-card, .melee-hail-card"
    ) ?? root;
    if (interactionSurface.dataset.neuroshimaMeleeBound === "true") return;
    interactionSurface.dataset.neuroshimaMeleeBound = "true";

    if (session.phase === "awaitingDefenderRoll" && !game.user.isGM) {
      const defender = await this._actor(session.participants.defender);
      if (defender?.isOwner !== true) {
        root.querySelectorAll(".defender-options").forEach(element => { element.hidden = true; });
      }
    }
    root.querySelectorAll(".melee-opposed-defend-btn").forEach(button => button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const latest = await game.neuroshima.melee.get(session.id, { messageId: session.messageId });
      if (latest?.phase !== "awaitingDefenderRoll") {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyResolved"));
        return;
      }
      const defender = await this._actor(latest.participants.defender);
      if (!game.user.isGM && defender?.isOwner !== true) {
        ui.notifications.warn("Tylko właściciel obrońcy lub MG może wykonać ten rzut.");
        return;
      }
      try {
        await this.openRoll(latest, "defender", button.dataset.weaponId || null);
      } catch (error) {
        ui.notifications.error(error.message);
      }
    }));
    if (session.exchange && message) {
      root.querySelectorAll("[data-melee-outcome-id]").forEach(button => button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const latest = await game.neuroshima.melee.get(session.id, { messageId: message.id });
        await game.neuroshima.melee.dispatch({
          type: "approveOutcome", side: null,
          payload: { outcomeId: button.dataset.meleeOutcomeId },
          sessionId: latest.id, messageId: message.id,
          expectedRevision: latest.revision, commandId: foundry.utils.randomID()
        });
      }));
      message._neuroshimaMeleeSession = { ...session, duelState: meleeSessionDuelState(session) };
      const { MeleeOpposedChat } = await import("../combat/combat.js");
      MeleeOpposedChat.onRenderDuelCard(root, message);
      return;
    }
    root.querySelectorAll("[data-melee-command]").forEach(button => button.addEventListener("click", async event => {
      event.preventDefault();
      let type = button.dataset.meleeCommand;
      const side = button.dataset.side;
      const payload = {};
      if (type === "roll") {
        try {
          await this.openRoll(session, side);
        } catch (error) {
          ui.notifications.error(error.message);
          console.error("Neuroshima | Melee roll dialog failed", error);
        }
        return;
      }
      if (type === "approveOutcome") payload.outcomeId = button.dataset.outcomeId;
      if (type === "commitExchangeAction") {
        const select = root.querySelector(`[data-activity-select="${side}"]`);
        const option = select?.selectedOptions?.[0];
        payload.activity = {
          activityId: option?.dataset.activityId,
          sourceItemUuid: option?.dataset.sourceItemUuid || null,
          sourceEffectUuid: option?.dataset.sourceEffectUuid || null
        };
        payload.selectedDieIds = Array.from(root.querySelectorAll(`[data-die-side="${side}"]:checked`)).map(input => input.value);
        payload.parameterValues = {};
        payload.modifierRefs = [];
      }
      try {
        await game.neuroshima.melee.dispatch({
          type, side, payload, sessionId: session.id, messageId: session.messageId,
          expectedRevision: session.revision, commandId: foundry.utils.randomID()
        });
      } catch (error) {
        ui.notifications.error(error.message);
      }
    }));
  }
}

function injectEditorButton(app, element) {
  if (!isMeleeEnabled() || !app.document?.isOwner) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const header = root?.querySelector(".window-header");
  if (!header || header.querySelector("[data-open-melee]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.openMelee = "";
  button.className = "header-control icon fa-solid fa-swords";
  button.dataset.tooltip = "Konfiguracja akcji melee";
  button.addEventListener("click", () => new MeleeActivityEditor(app.document).render(true));
  header.querySelector(".close")?.before(button);
}

function openMeleeMessage(session) {
  ui.sidebar?.activateTab?.("chat");
  setTimeout(() => {
    const element = document.querySelector(`[data-message-id="${session.messageId}"]`);
    element?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    element?.classList.add("melee-session-highlight");
    setTimeout(() => element?.classList.remove("melee-session-highlight"), 1200);
  }, 100);
}

function refreshMeleeProjections(session = null) {
  ui.combat?.render?.();
  // ApplicationV2 actor sheets live in `applications.instances`; `ui.windows`
  // only covers the legacy application registry. Read both so ending a melee
  // session immediately removes its projection from every open Combat tab.
  const applications = new Set([
    ...Object.values(ui.windows ?? {}),
    ...Array.from(foundry.applications?.instances?.values?.() ?? [])
  ]);
  for (const app of applications) {
    const actor = app.document?.documentName === "Actor" ? app.document : null;
    if (!actor) continue;
    if (session) {
      const involved = ["attacker", "defender"].some(side => {
        const participant = session.participants?.[side];
        return participant?.actorUuid === actor.uuid || participant?.tokenUuid === actor.token?.uuid;
      });
      if (!involved) continue;
    }
    app.render?.({ force: false });
  }
}

async function projectTracker(html) {
  if (!isMeleeEnabled()) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  root?.querySelectorAll(".melee-session-tracker-badge").forEach(element => element.remove());
  for (const session of game.neuroshima.melee.list()) {
    if (session.status !== "active") continue;
    const requiredAction = await buildMeleeRequiredAction(session, game.user);
    for (const side of ["attacker", "defender"]) {
      const participant = session.participants[side];
      const combatant = game.combat?.combatants.find(entry =>
        entry.actor?.uuid === participant.actorUuid || entry.token?.uuid === participant.tokenUuid);
      const row = root?.querySelector(`[data-combatant-id="${combatant?.id}"]`);
      if (!row) continue;
      const badge = document.createElement("span");
      badge.className = "melee-session-tracker-badge";
      badge.dataset.tooltip = `${session.participants.attacker.name} → ${session.participants.defender.name}\nSegment ${session.exchange.currentSegment + 1}/3\n${requiredAction.waitingText}`;
      badge.dataset.sessionId = session.id;
      const icon = session.initiative.ownerId === participant.actorUuid
        ? "fa-solid fa-swords"
        : "fa-regular fa-shield";
      badge.innerHTML = `<i class="${icon}"></i><span>${session.participants[side === "attacker" ? "defender" : "attacker"].name}</span>`;
      badge.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openMeleeMessage(session);
      });
      if (requiredAction.canAct && requiredAction.side === side) {
        badge.classList.add("can-act");
        badge.dataset.tooltip += "\nKliknij nazwę, aby otworzyć kartę oczekującej akcji.";
        const actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.className = "melee-session-tracker-action";
        actionButton.dataset.tooltip = requiredAction.label;
        actionButton.innerHTML = requiredAction.kind === "roll"
          ? '<i class="fa-solid fa-dice-d20"></i>'
          : '<i class="fa-solid fa-arrow-up-right-from-square"></i>';
        actionButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          if (requiredAction.kind === "roll") {
            try {
              await MeleeSessionPresenter.openRoll(session, side);
            } catch (error) {
              ui.notifications.error(error.message);
            }
          } else openMeleeMessage(session);
        });
        badge.append(actionButton);
      }
      row.querySelector(".token-name")?.append(badge);
    }
  }
}

export function registerMeleeSystemUI() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    MeleeSessionPresenter.renderMessage(message, html).catch(error => {
      console.error("Neuroshima | Failed to activate melee chat controls", error);
    });
  });
  Hooks.on("renderNeuroshimaItemSheet", injectEditorButton);
  Hooks.on("renderNeuroshimaEffectSheet", injectEditorButton);
  Hooks.on("renderCombatTrackerHTML", (_app, html) => projectTracker(html));
  Hooks.on("renderCombatTracker", (_app, html) => projectTracker(html));
  Hooks.on("neuroshimaMeleeSessionUpdated", session => {
    if (game.user?.isGM) {
      MeleeSessionPresenter.renderSession(session).catch(error => {
        console.error("Neuroshima | Failed to render canonical melee session", error);
      });
    }
    refreshMeleeProjections(session);
  });
  game.neuroshima.melee.beginAttack = (...args) => MeleeSessionPresenter.beginAttack(...args);
  game.neuroshima.melee.openEditor = (document, activityId) => new MeleeActivityEditor(document, activityId).render(true);
  game.neuroshima.melee.openRoll = (session, side) => MeleeSessionPresenter.openRoll(session, side);
  game.neuroshima.melee.openMessage = session => openMeleeMessage(session);
  game.neuroshima.melee.act = async (session, side) => {
    const action = await buildMeleeRequiredAction(session, game.user);
    if (!action.canAct) throw new Error("Nie masz uprawnień do wykonania oczekującej akcji melee.");
    if (action.kind === "roll") return MeleeSessionPresenter.openRoll(session, side || action.side);
    return openMeleeMessage(session);
  };
  game.neuroshima.melee.dryRun = options => MeleeMigration.dryRun(options);
}
