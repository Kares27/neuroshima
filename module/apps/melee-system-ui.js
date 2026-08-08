import {
  MeleeActionCatalog,
  MeleeMigration,
  isMeleeEnabled,
  isMeleeSessionMarker,
  buildMeleeRequiredAction,
  meleePoolDice,
  meleeParticipantFromActor,
  meleeSessionDuelState
} from "../combat/melee-system.js";


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

  static async beginAttack(actor, weapon, targetUuid, mode = "opposedPips") {
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
      onRoll: async (rawResult, attackerTest) => {
        if (!rawResult) return;
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
          return started;
        } catch (error) {
          await message.update({ content: `<div class="neuroshima melee-opposed-card"><p>${error.message}</p></div>` });
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
