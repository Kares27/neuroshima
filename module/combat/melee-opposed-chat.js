/**
 * @file melee-opposed-chat.js
 * @description Chat-based opposed melee test for Neuroshima 1.5 — WFRP-style flow.
 *
 * Modes:
 *  - **opposedPips**      — each of the 3 dice compared individually; each won slot
 *                           generates an independent hit at that tier.
 *  - **opposedSuccesses** — net successes (attackerSuccesses − defenderSuccesses) →
 *                           damage tier = min(3, net).
 *
 * Flow (mirrors WFRP4e OpposedHandler):
 *  1. Attacker clicks a melee weapon with a target → `initiateAttack()` opens the
 *     weapon-roll dialog. After the roll:
 *     a. A "handler" chat card is posted showing the attacker's dice and the
 *        defender's available melee weapons as clickable buttons.
 *     b. `flags.neuroshima.oppose = { messageId }` is set on the defender's actor
 *        (via GM socket if needed) so their weapon-click also detects the pending.
 *
 *  2. Defender responds by one of:
 *     a. Clicking a weapon button on the chat card → `defendFromChat(messageId, weaponId)`.
 *     b. Clicking a melee weapon in their actor sheet → actor flag detected → `openDefenseDialog()`.
 *     c. Clicking "Join Fight" on the actor-sheet pending card → same path as (b).
 *
 *  3. `openDefenseDialog()` opens the weapon-roll dialog for defence.
 *     After the roll → `resolveOpposed()` computes result, posts the resolution card,
 *     removes the actor flag from the defender, removes the meleePending.
 *
 * Result is exactly 2 chat messages:
 *  - Message 1: handler card (attacker dice + defender weapon buttons).
 *  - Message 2: resolution card (both dice side by side, winner + damage applied).
 */

export class MeleeOpposedChat {

  // ── Public entry points ─────────────────────────────────────────────────

  /**
   * Start a chat-based opposed attack.
   *
   * @param {Actor}  attacker    Attacking actor
   * @param {Item}   weapon      Melee weapon item
   * @param {string} targetUuid  UUID of the defending token/actor
   * @param {string} mode        "opposedPips" | "opposedSuccesses"
   */
  static async initiateAttack(attacker, weapon, targetUuid, mode) {
    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");

    const lastRoll = attacker.system.lastWeaponRoll ?? {};
    attacker._neuroshimaAttackInitiated = true;
    const dialog = new NeuroshimaWeaponRollDialog({
      actor: attacker,
      weapon,
      rollType: "melee",
      meleeAction: "attack",
      targets: [targetUuid],
      lastRoll,
      isPoolRoll: true,
      onRoll: async (rawResult) => {
        delete attacker._neuroshimaAttackInitiated;
        if (!rawResult) return;
        const { NeuroshimaSocket: _NSAtk } = await import("../helpers/socket-helper.js");
        const { MeleeTurnService: _MTSAtk } = await import("./melee-turn-service.js");
        const attackerUuid = attacker.token?.uuid ?? attacker.uuid;
        const condKey = _MTSAtk._MANEUVER_TO_CONDITION[rawResult.maneuver] || null;
        const hasCharge = (rawResult.chargeLevel ?? 0) > 0;
        const tempoLevel = rawResult.tempoLevel || 0;
        game.neuroshima?.log("[melee-opposed-chat.initiateAttack.onRoll] applying conditions", { attackerUuid, condKey, hasCharge, tempoLevel, targetUuid });
        await _NSAtk.gmExecute("syncActorManeuverConditions", attackerUuid, condKey, hasCharge, tempoLevel);
        if (tempoLevel > 0) {
          await _NSAtk.gmExecute("syncActorManeuverConditions", targetUuid, null, false, tempoLevel);
        }
        await MeleeOpposedChat._createHandlerCard(rawResult, attacker, weapon, targetUuid, mode);
      },
      onClose: () => {
        delete attacker._neuroshimaAttackInitiated;
      }
    });

    await dialog.render(true);
  }

  /**
   * Called when a defender clicks a weapon button ON the chat card.
   *
   * @param {string}      messageId  The handler chat message ID
   * @param {string|null} weaponId   Item ID of the chosen weapon (null = unarmed)
   */
  static async defendFromChat(messageId, weaponId = null) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const data = message.getFlag("neuroshima", "opposedChat");
    if (!data || data.status !== "pending") {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyResolved"));
      return;
    }

    const defenderDoc = fromUuidSync(data.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    if (!defenderActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    if (!defenderActor.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.NotYourTurn"));
      return;
    }

    // Build a synthetic pending object so openDefenseDialog can work
    const pending = {
      id: data.defenderUuid,
      attackerId: data.attackerUuid,
      attackerTokenUuid: data.attackerTokenUuid,
      defenderId: data.defenderUuid,
      mode: data.mode,
      opposedChatMessageId: messageId
    };

    await MeleeOpposedChat.openDefenseDialog(defenderActor, pending, weaponId);
  }

  /**
   * Open the defender's weapon-roll dialog.
   * Called from `defendFromChat`, `_onRespondToOpposed`, or actor-sheet weapon-click.
   *
   * @param {Actor}  defenderActor
   * @param {Object} pending         Must have `mode`, `opposedChatMessageId`
   * @param {string} [weaponId]      Item ID of weapon chosen by defender (optional)
   * @param {Object} [syntheticWeapon] Pre-built synthetic weapon object (e.g. from beast action)
   */
  static async openDefenseDialog(defenderActor, pending, weaponId = null, syntheticWeapon = null) {
    if (!defenderActor.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.NotYourTurn"));
      return;
    }

    const messageId = pending.opposedChatMessageId;
    const message = game.messages.get(messageId);
    if (!message) {
      ui.notifications.warn("Pending chat card not found.");
      return;
    }

    const data = message.getFlag("neuroshima", "opposedChat");
    if (!data || data.status !== "pending") {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyResolved"));
      return;
    }

    // Resolve the weapon: prefer synthetic (beast action), then clicked, then equipped, then any melee
    let defWeapon = syntheticWeapon ?? (weaponId ? defenderActor.items.get(weaponId) : null);
    if (!defWeapon) {
      defWeapon = defenderActor.items.find(
        i => i.type === "weapon" && i.system.weaponType === "melee" && i.system.equipped
      ) ?? defenderActor.items.find(i => i.type === "weapon" && i.system.weaponType === "melee");
    }

    // Unarmed fallback — synthetic brawl weapon, opens dialog normally
    if (!defWeapon) {
      defWeapon = {
        id: null,
        name: game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.Unarmed"),
        img: "systems/neuroshima/assets/img/weapon-melee.svg",
        type: "weapon",
        system: {
          weaponType: "melee",
          attribute: "dexterity",
          skill: "brawl",
          attackBonus: 0,
          defenseBonus: 0,
          damageMelee1: "D",
          damageMelee2: "L",
          damageMelee3: "C",
          requiredBuild: 0,
          piercing: 0,
          magazine: null,
          jamming: 20
        }
      };
    }

    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");
    const lastRoll = defenderActor.system.lastWeaponRoll ?? {};

    const dialog = new NeuroshimaWeaponRollDialog({
      actor: defenderActor,
      weapon: defWeapon,
      rollType: "melee",
      meleeAction: "defense",
      targets: [pending.attackerId],
      lastRoll,
      isPoolRoll: true,
      onRoll: async (rawResult) => {
        if (!rawResult) return;
        const { NeuroshimaSocket: _NSDef } = await import("../helpers/socket-helper.js");
        const { MeleeTurnService: _MTSDef } = await import("./melee-turn-service.js");
        const defenderUuid = defenderActor.token?.uuid ?? defenderActor.uuid;
        const condKey = _MTSDef._MANEUVER_TO_CONDITION[rawResult.maneuver] || null;
        const tempoLevel = rawResult.tempoLevel || 0;
        game.neuroshima?.log("[melee-opposed-chat.openDefenseDialog.onRoll] applying conditions", { defenderUuid, condKey, tempoLevel });
        await _NSDef.gmExecute("syncActorManeuverConditions", defenderUuid, condKey, false, tempoLevel);
        if (tempoLevel > 0) {
          const atkUuid = data.attackerTokenUuid || data.attackerUuid;
          await _NSDef.gmExecute("syncActorManeuverConditions", atkUuid, null, false, tempoLevel);
        }
        await MeleeOpposedChat.resolveOpposed(messageId, pending, defenderActor, rawResult);
      },
      onClose: () => {}
    });

    await dialog.render(true);
  }

  /**
   * Resolve the opposed test and post the resolution card.
   *
   * @param {string} messageId      Handler chat-message ID
   * @param {Object} pending
   * @param {Actor}  defenderActor
   * @param {Object} defenseResult  Raw result from NeuroshimaDice.rollWeaponTest
   */
  static async resolveOpposed(messageId, pending, defenderActor, defenseResult) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const data = message.getFlag("neuroshima", "opposedChat");
    if (!data || data.status !== "pending") return;

    // Mark as resolved immediately (prevents double-click / double-response)
    await MeleeOpposedChat._setChatFlag(message, "opposedChat", { ...data, status: "resolved" });

    const attackerDoc = fromUuidSync(data.attackerTokenUuid || data.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;

    const mode = data.mode;
    const attackDice = data.attackModified;
    const attackTarget = data.attackTarget;
    const attackSuccesses = data.attackSuccesses;

    const defenseDice = (defenseResult.modifiedResults || []).map(r => ({
      original: r.original,
      modified: r.modified,
      isSuccess: r.isSuccess,
      isNat1: r.isNat1 ?? (r.original === 1),
      isNat20: r.isNat20 ?? (r.original === 20)
    }));
    const defenseTarget = defenseResult.target;
    const defenseSuccesses = defenseResult.successPoints
      ?? defenseDice.filter(r => r.isSuccess).length;

    const attackerName = attackerActor?.name ?? "Attacker";
    const defenderName = defenderActor.name;

    // ── Double-skill allocation branch ────────────────────────────────────
    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");
    const attackerSkillBudget = data.attackerSkillBudget ?? 0;
    const defenderSkillBudget = defenseResult.skill ?? 0;

    if (doubleSkill && (attackerSkillBudget > 0 || defenderSkillBudget > 0)) {
      await MeleeOpposedChat._createAllocationCard({
        data, attackerActor, defenderActor,
        attackDice, defenseDice, attackTarget, defenseTarget,
        attackSuccesses, defenseSuccesses,
        attackerSkillBudget, defenderSkillBudget
      });
      await MeleeOpposedChat._updateHandlerToResolved(message, data, attackerActor, defenderActor);
      await MeleeOpposedChat._removePending(pending.id ?? data.defenderUuid);
      await MeleeOpposedChat._unsetDefenderFlag(data.defenderUuid);
      defenderActor?.sheet?.render();
      attackerActor?.sheet?.render();
      return;
    }

    // ── Interactive duel card (default meleeCombatType setting) ──────────
    if ((game.settings.get("neuroshima", "meleeCombatType") || "default") === "default") {
      try {
        await MeleeOpposedChat._createDuelCard(message, data, attackerActor, defenderActor, attackDice, defenseDice, attackTarget, defenseTarget);
        await MeleeOpposedChat._updateHandlerToResolved(message, data, attackerActor, defenderActor);
      } catch (err) {
        console.error("Neuroshima | resolveOpposed: failed to create duel card", err);
      } finally {
        await MeleeOpposedChat._removePending(pending.id ?? data.defenderUuid);
        await MeleeOpposedChat._unsetDefenderFlag(data.defenderUuid);
        defenderActor?.sheet?.render();
        attackerActor?.sheet?.render();
      }
      return;
    }

    // ── Resolution logic ──────────────────────────────────────────────────
    let hits = [];
    let resultType = "block";
    let resultText = "";

    if (mode === "opposedPips") {
      for (let i = 0; i < 3; i++) {
        const aDie = attackDice[i];
        const dDie = defenseDice[i];
        if (!aDie) continue;
        const aWins = aDie.isSuccess &&
          (!dDie?.isSuccess || aDie.modified < (dDie?.modified ?? Infinity));
        if (aWins) {
          const tier = i + 1;
          hits.push({ tier, damageType: data[`damage${tier}`] });
        }
      }
      if (hits.length > 0) {
        resultType = "hit";
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogPipsHit", {
          attacker: attackerName,
          defender: defenderName,
          tiers: hits.map(h => `D${h.tier}(${h.damageType})`).join(", ")
        });
      } else {
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogBlock", {
          attacker: attackerName, defender: defenderName
        });
      }
    } else {
      const net = attackSuccesses - defenseSuccesses;
      if (net > 0) {
        resultType = "hit";
        const tier = Math.min(3, net);
        hits.push({ tier, damageType: data[`damage${tier}`] });
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogSuccessesHit", {
          attacker: attackerName, defender: defenderName,
          net, tier, damage: data[`damage${tier}`]
        });
      } else {
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogBlock", {
          attacker: attackerName, defender: defenderName
        });
      }
    }

    // ── Post resolution card ──────────────────────────────────────────────
    const attackDiceDisplay = attackDice.map((d, i) => ({
      label: `D${i + 1}`, ...d,
      isNat1: d.original === 1,
      isNat20: d.original === 20
    }));
    const defenseDiceDisplay = defenseDice.map((d, i) => ({
      label: `D${i + 1}`, ...d,
      isNat1: d.original === 1,
      isNat20: d.original === 20
    }));

    const pairWinners = {};
    if (mode === "opposedPips") {
      for (let i = 0; i < 3; i++) {
        const aDie = attackDice[i];
        const dDie = defenseDice[i];
        const aWins = aDie?.isSuccess && (!dDie?.isSuccess || aDie.modified < (dDie?.modified ?? Infinity));
        const dWins = dDie?.isSuccess && (!aDie?.isSuccess || dDie.modified < (aDie?.modified ?? Infinity));
        pairWinners[i] = { attackWon: aWins ?? false, defenseWon: dWins ?? false };
      }
    }

    const pairedDice = Array.from({ length: 3 }, (_, i) => {
      const aDie = attackDiceDisplay[i] ?? null;
      const dDie = defenseDiceDisplay[i] ?? null;
      const pw = pairWinners[i] ?? {};
      return { label: `D${i + 1}`, attack: aDie, defense: dDie, attackWon: pw.attackWon ?? false, defenseWon: pw.defenseWon ?? false };
    });

    // ── Beast action spending (creature attackers only) ───────────────────
    // Sort hits ascending by tier so fallback always applies lowest-tier first,
    // keeping the highest-tier (heaviest) hits for normal damage when partially spent.
    hits.sort((a, b) => a.tier - b.tier);

    const isCreatureAttacker = attackerActor?.type === "creature";
    let netSuccesses = 0;
    if (mode === "opposedSuccesses") {
      netSuccesses = Math.max(0, attackSuccesses - defenseSuccesses);
    } else {
      netSuccesses = hits.length; // won pips = action point budget
    }

    const affordableBeastActions = [];
    if (isCreatureAttacker && netSuccesses > 0) {
      const beastItemFilter = data.beastItemId ?? null;
      const beastItems = attackerActor.items.filter(i => i.type === "beast-action");
      for (const item of beastItems.filter(i => !beastItemFilter || i.id === beastItemFilter)) {
        for (const act of (item.system.activities ?? [])) {
          if (act.costType !== "success") continue;
          const cost = act.successCost ?? 1;
          if (cost <= netSuccesses) {
            affordableBeastActions.push({
              id: `${item.id}::${act.id}`,
              itemId: item.id,
              name: act.name || item.name,
              img: act.img || item.img,
              cost,
              damage: act.damage || null,
              gmNote: act.gmNote || "",
              hasEffects: (act.effectIds?.length ?? 0) > 0
            });
          }
        }
      }
      affordableBeastActions.sort((a, b) => a.cost - b.cost);
    }

    const resolutionData = {
      mode,
      modeLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${mode}`),
      attackerName,
      attackerImg: attackerActor?.img,
      defenderName,
      defenderImg: defenderActor.img,
      weaponName: attackerActor?.items?.get(data.weaponId)?.name ?? "",
      attackDice: attackDiceDisplay,
      defenseDice: defenseDiceDisplay,
      pairedDice,
      attackTarget,
      defenseTarget,
      attackSuccesses,
      defenseSuccesses,
      resultType,
      resultText,
      hits,
      isHit: resultType === "hit",
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      isCreatureAttacker,
      netSuccesses,
      affordableBeastActions,
      hasBeastActions: affordableBeastActions.length > 0,
      isBeastAttack: isCreatureAttacker && !data.weaponId
    };

    const resContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-result.hbs",
      resolutionData
    );

    const locationRoll = data.attackRaw?.[0] ?? 10;
    const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);

    const rollMode = game.settings.get("core", "rollMode");
    await ChatMessage.create({
      content: resContent,
      flags: {
        neuroshima: {
          opposedResult: {
            attackerUuid: data.attackerUuid,
            defenderUuid: data.defenderUuid,
            weaponId: data.weaponId,
            beastItemId: data.beastItemId ?? null,
            hits,
            location,
            damage1: data.damage1,
            damage2: data.damage2,
            damage3: data.damage3,
            netSuccesses,
            affordableBeastActions,
            isBeastAttack: isCreatureAttacker && !data.weaponId,
            applied: false,
            beastActionsApplied: false
          }
        }
      },
      speaker: { alias: "⚔" },
      rollMode
    });

    // Update handler card to "resolved" state (no dice needed — shown in resolution card)
    const updatedTemplateData = {
      mode,
      modeLabel: resolutionData.modeLabel,
      attackerName,
      attackerImg: attackerActor?.img,
      weaponName: resolutionData.weaponName,
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      defenderName,
      defenderImg: defenderActor.img,
      defenderWeapons: [],
      status: "resolved"
    };
    const updatedContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-pending.hbs",
      updatedTemplateData
    );
    await MeleeOpposedChat._updateChatContent(message, updatedContent);

    // Remove from meleePendings FIRST so when unsetFlag triggers a sheet re-render
    // (via updateActor hook) the combat entry is already gone.
    await MeleeOpposedChat._removePending(pending.id ?? data.defenderUuid);

    // Then clear the actor flag — this triggers updateActor → sheet re-render
    await MeleeOpposedChat._unsetDefenderFlag(data.defenderUuid);

    // Force re-render both sheets — defender's flag unset may not trigger attacker's re-render
    defenderActor?.sheet?.render();
    attackerActor?.sheet?.render();

    // MANEUVER — Trash collector (non-default path):
    // For direct (non-duel-card) resolution, clear maneuver conditions here — this is
    // the final step of the exchange, equivalent to state.status === "done" on a duel card.
    {
      const { NeuroshimaSocket: _NSClear } = await import("../helpers/socket-helper.js");
      await _NSClear.gmExecute("clearActorManeuverConditions", data.attackerTokenUuid || data.attackerUuid);
      await _NSClear.gmExecute("clearActorManeuverConditions", data.defenderTokenUuid || data.defenderUuid);
      game.neuroshima?.log("[melee-opposed-chat.resolveOpposed] maneuver conditions cleared (direct path)", {
        attacker: data.attackerTokenUuid || data.attackerUuid,
        defender: data.defenderTokenUuid || data.defenderUuid
      });
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Update the handler card to "resolved" state.
   * @private
   */
  static async _updateHandlerToResolved(message, data, attackerActor, defenderActor) {
    const mode = data.mode;
    const attackerName = attackerActor?.name ?? "Attacker";
    const defenderName = defenderActor?.name ?? "Defender";
    const weaponName = attackerActor?.items?.get(data.weaponId)?.name ?? "";
    const modeLabel = game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${mode}`);
    const updatedTemplateData = {
      mode,
      modeLabel,
      attackerName,
      attackerImg: attackerActor?.img,
      weaponName,
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      defenderName,
      defenderImg: defenderActor?.img,
      defenderWeapons: [],
      status: "resolved"
    };
    const updatedContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-pending.hbs",
      updatedTemplateData
    );
    await MeleeOpposedChat._updateChatContent(message, updatedContent);
  }

  static async _createDuelCard(handlerMessage, data, attackerActor, defenderActor, attackDice, defenseDice, attackTarget, defenseTarget) {
    if (data.isGradCios) {
      const atkSuccessCount = attackDice.filter(d => d.isSuccess).length;
      const defSuccessCount = defenseDice.filter(d => d.isSuccess).length;
      const rollMode = data.rollMode ?? game.settings.get("core", "rollMode");
      const toChip = d => ({ value: d.modified ?? d.original ?? d.value, isSuccess: d.isSuccess, isNat20: d.isNat20 ?? false });
      const netSuccesses = atkSuccessCount - defSuccessCount;

      if (netSuccesses > 0) {
        const tier = Math.min(netSuccesses, 3);
        const damage = data[`damage${tier}`] ?? data.damage1 ?? "?";
        const locationRoll = data.attackRaw?.[0] ?? 10;
        const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);
        const outcomeLabel = game.i18n.format("NEUROSHIMA.GradCios.Hit", { n: tier, dmg: damage });
        const hitContent = await foundry.applications.handlebars.renderTemplate(
          "systems/neuroshima/templates/chat/melee-hail-card.hbs",
          {
            attackerName:    attackerActor?.name ?? "",
            attackerImg:     attackerActor?.img  ?? "",
            defenderName:    defenderActor?.name ?? "",
            defenderImg:     defenderActor?.img  ?? "",
            attackDiceChips: attackDice.map(toChip),
            attackSuccesses: atkSuccessCount,
            isPending:       false,
            isDone:          true,
            defenseDiceChips: defenseDice.map(toChip),
            isBlocked: false,
            hasHit:    true,
            outcomeLabel
          }
        );
        await ChatMessage.create({
          content: hitContent,
          flags: {
            neuroshima: {
              hailResult: {
                attackerUuid: data.attackerUuid,
                defenderUuid: data.defenderUuid,
                weaponId:     data.weaponId,
                tier,
                damage1:  data.damage1,
                damage2:  data.damage2,
                damage3:  data.damage3,
                location
              }
            }
          },
          speaker: { alias: "⚔" },
          rollMode
        });
      } else {
        const outcomeLabel = netSuccesses === 0
          ? game.i18n.localize("NEUROSHIMA.GradCios.EqualSuccessesBlock")
          : game.i18n.localize("NEUROSHIMA.GradCios.Blocked");
        const blockContent = await foundry.applications.handlebars.renderTemplate(
          "systems/neuroshima/templates/chat/melee-hail-card.hbs",
          {
            attackerName:    attackerActor?.name ?? "",
            attackerImg:     attackerActor?.img  ?? "",
            defenderName:    defenderActor?.name ?? "",
            defenderImg:     defenderActor?.img  ?? "",
            attackDiceChips: attackDice.map(toChip),
            attackSuccesses: atkSuccessCount,
            isPending:       false,
            isDone:          true,
            defenseDiceChips: defenseDice.map(toChip),
            isBlocked: true,
            hasHit:    false,
            outcomeLabel
          }
        );
        await ChatMessage.create({ content: blockContent, speaker: { alias: "⚔" }, rollMode });
      }
      return;
    }

    const segCount = Math.min(3, attackDice.length, defenseDice.length || 1);
    const initiativeOwnerSide = data.szachistaYield ? "defender" : "attacker";
    const state = {
      status: "picking",
      initiativeOwnerSide,
      isGradCios: data.isGradCios || false,
      waitingFor: "initiativeOwner",
      committedOwnerIndices: null,
      currentSegment: 0,
      attackerUuid: data.attackerUuid,
      attackerTokenUuid: data.attackerTokenUuid ?? null,
      defenderUuid: data.defenderUuid,
      defenderTokenUuid: data.defenderTokenUuid ?? null,
      weaponId: data.weaponId,
      beastItemId: data.beastItemId ?? null,
      attackDice,
      defenseDice,
      attackTarget,
      defenseTarget,
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      usedAttackDice: [],
      usedDefenseDice: [],
      segments: Array.from({ length: segCount }, (_, i) => ({
        segNum: i + 1,
        attackVal: null,
        defenseVal: null,
        outcome: null
      })),
      hits: [],
      applied: false,
      activatedMeleePreRollMods: data.activatedMeleePreRollMods ?? []
    };

    const context = await MeleeOpposedChat._buildDuelContext(state, attackerActor, defenderActor);
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-duel-card.hbs",
      context
    );
    const rollMode = game.settings.get("core", "rollMode");
    await ChatMessage.create({
      content,
      flags: { neuroshima: { duelCard: state } },
      speaker: { alias: "⚔" },
      rollMode
    });
    await MeleeOpposedChat._syncInitiativeToTracker(state);
  }

  static async _buildDuelContext(state, attackerActor, defenderActor) {
    const {
      attackDice, defenseDice, usedAttackDice, usedDefenseDice,
      waitingFor, initiativeOwnerSide, committedOwnerIndices,
      currentSegment, status, hits, segments, isGradCios
    } = state;

    const declaredAction = state.declaredAction || null;

    const isOwnerAttacker  = initiativeOwnerSide === "attacker";
    const isOwnerTurn      = status === "picking" && waitingFor === "initiativeOwner";
    const isResponderTurn  = status === "picking" && waitingFor === "responder";
    const ownerPool        = isOwnerAttacker ? "attacker" : "defender";
    const responderPool    = isOwnerAttacker ? "defender" : "attacker";
    const committedIndices = committedOwnerIndices || [];

    const gradCiosVisibleAttackSet = (isGradCios && ownerPool === "attacker")
      ? isOwnerTurn
        ? new Set(
            (attackDice || [])
              .map((d, i) => d.isSuccess ? i : -1)
              .filter(i => i >= 0)
          )
        : new Set(committedIndices)
      : null;

    const attackDiceChips = (attackDice || []).map((d, idx) => {
      const isUsed      = (usedAttackDice || []).includes(idx);
      const isCommitted = !isUsed && ownerPool === "attacker" && committedIndices.includes(idx);
      let isClickable = false;
      let isHidden = false;
      if (!isUsed && !isCommitted) {
        if (isOwnerTurn    && ownerPool    === "attacker") isClickable = true;
        if (isResponderTurn && responderPool === "attacker") isClickable = true;
        if (isGradCios && !d.isSuccess) isClickable = false;
      }
      if (gradCiosVisibleAttackSet !== null && !isUsed) {
        isHidden = !gradCiosVisibleAttackSet.has(idx);
        if (isHidden) isClickable = false;
      }
      return {
        idx, value: d.modified ?? d.original,
        isSuccess: d.isSuccess,
        isNat1: d.isNat1 ?? (d.original === 1),
        isNat20: d.isNat20 ?? (d.original === 20),
        isUsed, isCommitted, isClickable, isHidden
      };
    });

    const gradCiosAtkSuccessCount = (attackDice || []).filter(d => d.isSuccess).length;
    const gradCiosVisibleDefenseSet = (isGradCios && ownerPool === "attacker")
      ? isResponderTurn
        ? new Set(
            (defenseDice || [])
              .map((d, i) => d.isSuccess ? i : -1)
              .filter(i => i >= 0)
              .slice(0, committedIndices.length)
          )
        : new Set(
            (defenseDice || [])
              .map((d, i) => ({ v: d.modified ?? d.original ?? 0, i }))
              .sort((a, b) => a.v - b.v)
              .slice(0, gradCiosAtkSuccessCount)
              .map(({ i }) => i)
          )
      : null;

    const defenseDiceChips = (defenseDice || []).map((d, idx) => {
      const isUsed      = (usedDefenseDice || []).includes(idx);
      const isCommitted = !isUsed && ownerPool === "defender" && committedIndices.includes(idx);
      let isClickable = false;
      let isHidden = false;
      if (!isUsed && !isCommitted) {
        if (isOwnerTurn    && ownerPool    === "defender") isClickable = true;
        if (isResponderTurn && responderPool === "defender") isClickable = true;
        if (isGradCios && !d.isSuccess) isClickable = false;
      }
      if (gradCiosVisibleDefenseSet !== null && !isUsed) {
        isHidden = !gradCiosVisibleDefenseSet.has(idx);
        if (isHidden) isClickable = false;
      }
      return {
        idx, value: d.modified ?? d.original,
        isSuccess: d.isSuccess,
        isNat1: d.isNat1 ?? (d.original === 1),
        isNat20: d.isNat20 ?? (d.original === 20),
        isUsed, isCommitted, isClickable, isHidden
      };
    });

    const responderExactDice = gradCiosVisibleDefenseSet !== null
      ? gradCiosVisibleDefenseSet.size
      : committedIndices.length;

    const segmentDots = (segments || []).map((s, i) => {
      let dotClass = "";
      if (s.outcome !== null) dotClass = `is-done is-${s.outcome}`;
      else if (status === "picking" && i === currentSegment) dotClass = "is-active";
      return { segNum: s.segNum, dotClass };
    });

    const ownerName     = isOwnerAttacker ? (attackerActor?.name ?? "") : (defenderActor?.name ?? "");
    const responderName = isOwnerAttacker ? (defenderActor?.name ?? "") : (attackerActor?.name ?? "");
    const effectiveDeclared      = declaredAction || (isResponderTurn ? "attack" : null);
    const ownerDeclaredAttack    = isResponderTurn && effectiveDeclared === "attack";
    const ownerDeclaredExit      = isResponderTurn && effectiveDeclared === "exit";
    const ownerDeclaredNonCombat = isResponderTurn && effectiveDeclared === "nonCombat";
    // Sztuczka — traktowana jak atak (obrońca broni się tak samo)
    const ownerDeclaredTrick        = isResponderTurn && effectiveDeclared === "trick";
    const ownerDeclaredAttackOrTrick = ownerDeclaredAttack || ownerDeclaredTrick;

    let responderConfirmActionType = "defend";
    let responderConfirmLabel      = game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelConfirmDefense");
    if (declaredAction === "exit") {
      responderConfirmActionType = "blockExit";
      responderConfirmLabel      = game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelBlockExit");
    } else if (declaredAction === "nonCombat") {
      responderConfirmActionType = "interrupt";
      responderConfirmLabel      = game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelInterrupt");
    }

    let phaseBanner = "";
    if (status === "picking") {
      const segLabel = `${game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelSegment")} ${currentSegment + 1}`;
      if (isOwnerTurn) {
        phaseBanner = `${segLabel}: ${ownerName} ${game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelWaitingOwner")}`;
      } else {
        const n = committedIndices.length;
        const actionTextMap = {
          attack:    game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelOwnerAttacks"),
          exit:      game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelOwnerExits"),
          nonCombat: game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelOwnerNonCombat"),
        };
        const actionText = actionTextMap[declaredAction] || actionTextMap.attack;
        phaseBanner = `${segLabel}: ${ownerName} ${actionText}. ${responderName} ${game.i18n.format("NEUROSHIMA.MeleeDuel.DuelWaitingResponder", { n })}`;
      }
    } else {
      phaseBanner = game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelDone");
    }

    const ownerActorUuid     = isOwnerAttacker ? state.attackerUuid : state.defenderUuid;
    const responderActorUuid = isOwnerAttacker ? state.defenderUuid : state.attackerUuid;

    const ownerActorDoc = fromUuidSync(isOwnerAttacker ? (state.attackerTokenUuid || state.attackerUuid) : state.defenderUuid);
    const ownerActor    = ownerActorDoc?.actor ?? ownerActorDoc;
    const ownerIsCreature = ownerActor?.type === "creature";

    const ownerDiceArr = isOwnerAttacker ? (attackDice || []) : (defenseDice || []);
    const committedSuccessCount = committedIndices.filter(i => ownerDiceArr[i]?.isSuccess).length;

    let ownerBeastActions = null;
    if (ownerIsCreature) {
      const flat = [];
      const ownerBeastItemFilter = state.beastItemId ?? null;
      for (const item of ownerActor.items.filter(i => i.type === "beast-action" && (!ownerBeastItemFilter || i.id === ownerBeastItemFilter))) {
        for (const act of (item.system.activities ?? [])) {
          if (act.costType !== "success") continue;
          flat.push({
            id: `${item.id}::${act.id}`,
            itemId: item.id,
            name: act.name || item.name,
            img: act.img || item.img,
            successCost: act.successCost ?? 1,
            damage: act.damage || null,
            isAffordable: committedSuccessCount >= (act.successCost ?? 1)
          });
        }
      }
      if (flat.length > 0) {
        ownerBeastActions = flat.sort((a, b) => a.successCost - b.successCost);
      }
    }

    // getMeleeActions trigger — fires for non-creature actors during their own turn.
    // Effect scripts push extra action entries (sztuczki like Barbarka) to args.actions.
    // Actions with successCost > 0 appear in a queue section (like beast actions, budget = uncommitted successes).
    // Actions without successCost appear as standalone attack-alternative buttons.
    let ownerExtraActions = null;  // trick action buttons (all types)
    if (ownerActor && !ownerIsCreature && status === "picking" && isOwnerTurn) {
      // --- helper context for effect scripts ---
      const ownerDiceArrFull = isOwnerAttacker ? (attackDice || []) : (defenseDice || []);
      const usedOwnerSet = new Set(isOwnerAttacker ? (usedAttackDice || []) : (usedDefenseDice || []));
      const uncommittedOwnerDice = ownerDiceArrFull.filter((_, i) => !usedOwnerSet.has(i));
      const uncommittedDiceCount    = uncommittedOwnerDice.length;
      const uncommittedSuccessCount = uncommittedOwnerDice.filter(d => d.isSuccess).length;

      // Segments resolved before the current one (outcome not null and not "spent")
      const pastSegs = (segments || []).slice(0, currentSegment).filter(s => s.outcome && s.outcome !== "spent");
      // ownerHadHit: any previous segment with outcome "hit" (from attacker's perspective)
      const ownerHadHit      = pastSegs.some(s => s.outcome === "hit");
      const ownerPreviousHits = pastSegs.filter(s => s.outcome === "hit");

      // getMeleeActions — two modes:
      // • isDialogScript === false: always fires passively, pushes actions to extraActionsArr.
      // • isDialogScript === true: shown as checkbox in the pre-roll weapon dialog.
      //   On the duel card its passive `code` runs only when the modifier was activated
      //   in the pre-roll dialog (UUID present in state.activatedMeleePreRollMods).
      const activatedPreRollMods = new Set(state.activatedMeleePreRollMods ?? []);
      const extraActionsArr = [];
      try {
        const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
        const triggerArgs = {
          actor: ownerActor,
          state,
          actions: extraActionsArr,
          ownerHadHit,
          ownerPreviousHits,
          uncommittedDice: uncommittedDiceCount,
          uncommittedSuccesses: uncommittedSuccessCount
        };

        const allMeleeScripts = NeuroshimaScriptRunner.getScripts(ownerActor, "getMeleeActions");
        for (const script of allMeleeScripts) {
          if (script.isDialogScript) {
            const effectUuid = script.effect?.uuid;
            if (effectUuid && activatedPreRollMods.has(effectUuid)) {
              try {
                await script.execute(triggerArgs);
              } catch (err) {
                game.neuroshima?.log("[getMeleeActions] dialog script exec error", err);
              }
            }
          } else {
            try {
              await script.execute(triggerArgs);
            } catch (err) {
              game.neuroshima?.log("[getMeleeActions] trigger error", err);
            }
          }
        }
      } catch (err) {
        game.neuroshima?.log("[getMeleeActions] trigger error", err);
      }
      if (extraActionsArr.length > 0) {
        const normalized = extraActionsArr.map(a => ({
          id:          a.id          ?? `trick-${foundry.utils.randomID(8)}`,
          name:        a.name        ?? a.label ?? "Sztuczka",
          img:         a.img         ?? "systems/neuroshima/assets/effects/gears.svg",
          damage:      a.damage      ?? "D",
          successCost: a.successCost ?? 0,
          minDice:     a.minDice     ?? 1,
          maxDice:     a.maxDice     ?? 3,
          annotation:  a.annotation  ?? null,
          onHitScript: a.onHitScript ?? null
        }));
        ownerExtraActions = normalized.length ? normalized : null;

        const onHitMap = {};
        for (const a of normalized) {
          if (a.onHitScript) onHitMap[a.id] = a.onHitScript;
        }
        if (Object.keys(onHitMap).length > 0) {
          state.trickOnHitScripts = { ...(state.trickOnHitScripts ?? {}), ...onHitMap };
        }
      }
    }

    const damageTiers = (state.damage1 || state.damage2 || state.damage3) ? {
      d: state.damage1 ?? "?",
      l: state.damage2 ?? "?",
      k: state.damage3 ?? "?"
    } : null;

    const resolvedSegs = (segments || []).filter(s => s.outcome !== null).map(s => ({
      segNum: s.segNum,
      attackVal: s.attackVal,
      defenseVal: s.defenseVal,
      outcome: s.outcome,
      outcomeLabel: game.i18n.localize(`NEUROSHIMA.MeleeDuel.DuelSegResult.${s.outcome}`)
    }));

    const confirmOwnerLabel = game.i18n.format("NEUROSHIMA.MeleeDuel.DuelConfirmAttack", { n: 0 });
    const canSwapInit = game.user.isGM && status === "picking" && !isGradCios;

    return {
      status,
      attackerName: attackerActor?.name ?? "Attacker",
      attackerImg:  attackerActor?.img  ?? "",
      defenderName: defenderActor?.name ?? "Defender",
      defenderImg:  defenderActor?.img  ?? "",
      phaseBanner, segmentDots, attackDiceChips, defenseDiceChips, resolvedSegs,
      hits: hits || [], hasHits: (hits || []).length > 0, isDone: status === "done",
      isOwnerAttacker, isOwnerTurn, isResponderTurn,
      ownerPool, responderPool, ownerActorUuid, responderActorUuid,
      committedOwnerCount: committedIndices.length,
      damageTiers, confirmOwnerLabel, canSwapInit, isGradCios: isGradCios || false,
      ownerDeclaredAttack, ownerDeclaredExit, ownerDeclaredNonCombat, ownerDeclaredTrick, ownerDeclaredAttackOrTrick,
      responderConfirmActionType, responderConfirmLabel, responderExactDice,
      ownerIsCreature, ownerBeastActions, committedSuccessCount,
      ownerExtraActions,
      isGM:    game.user.isGM,
      canUndo: game.user.isGM && (state.segmentHistory?.length ?? 0) > 0,
      canRedo: game.user.isGM && (state.segmentFuture?.length  ?? 0) > 0
    };
  }

  static async _renderDuelCard(message, state) {
    const attackerDoc = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc ?? null;
    const defenderDoc = fromUuidSync(state.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc ?? null;

    const context = await MeleeOpposedChat._buildDuelContext(state, attackerActor, defenderActor);
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-duel-card.hbs",
      context
    );
    await message.setFlag("neuroshima", "duelCard", state);
    await message.update({ content });
  }

  static onRenderDuelCard(root, message) {
    root = root instanceof HTMLElement ? root : root[0];
    if (!root) return;

    const state = message.getFlag("neuroshima", "duelCard");
    if (!state || state.status !== "picking") return;

    root.querySelectorAll("[data-melee-owner]").forEach(el => {
      const ownerUuid = el.dataset.meleeOwner;
      if (!ownerUuid) return;
      const doc   = fromUuidSync(ownerUuid);
      const actor = doc?.actor ?? doc;
      const canAct = game.user.isGM || actor?.isOwner;
      if (!canAct) {
        el.style.opacity       = "0.4";
        el.style.pointerEvents = "none";
      }
    });

    const updateActionButtons = () => {
      const selectedChips = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
      const count        = selectedChips.length;
      const hasSuccess   = selectedChips.some(chip => chip.classList.contains("is-success"));
      const successCount = selectedChips.filter(chip => chip.classList.contains("is-success")).length;

      root.querySelectorAll(".mdc-action-choice").forEach(btn => {
        const noDice      = btn.dataset.noDice === "true";
        const exactDice   = btn.dataset.exactDice  !== undefined ? parseInt(btn.dataset.exactDice,  10) : null;
        const minDice     = btn.dataset.minDice     !== undefined ? parseInt(btn.dataset.minDice,    10) : null;
        const maxDice     = btn.dataset.maxDice     !== undefined ? parseInt(btn.dataset.maxDice,    10) : null;
        const needSuccess = btn.dataset.needSuccess === "true";
        const minSuccess  = btn.dataset.minSuccess  !== undefined ? parseInt(btn.dataset.minSuccess, 10) : null;

        let ok;
        if (noDice) {
          ok = true;
        } else if (exactDice !== null) {
          ok = count === exactDice;
        } else {
          const min = minDice ?? 1;
          const max = maxDice ?? Infinity;
          ok = count >= min && count <= max;
        }
        if (ok && needSuccess && !hasSuccess) ok = false;
        if (ok && minSuccess !== null && successCount < minSuccess) ok = false;

        btn.disabled = !ok;
        btn.classList.toggle("is-disabled", !ok);
        btn.classList.toggle("is-ready",    ok);
      });
    };

    root.querySelectorAll("button.die-chip-mvc").forEach(chip => {
      chip.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        chip.classList.toggle("mvc-die-selected");
        updateActionButtons();
        updateBeastQueue();
        updateTrickQueue();
      });
    });

    root.querySelectorAll(".mdc-action-choice").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;

        const actionType = btn.dataset.actionType;
        const pool       = btn.dataset.pool;
        const selected   = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
        const indices    = selected.map(c => parseInt(c.dataset.dieIdx, 10)).filter(n => !isNaN(n));

        // Sztuczki gracza (getMeleeActions) mają action-type="trick" z dodatkowymi atrybutami.
        // Kodujemy jako "trick:ID:damage" aby applyDuelBatch mógł parsować metadane sztuczki.
        let actionArg = actionType;
        if (actionType === "trick") {
          const trickId     = btn.dataset.trickId     ?? "";
          const trickDamage = btn.dataset.trickDamage ?? "";
          actionArg = `trick:${trickId}:${trickDamage}`;
        }

        // Jeśli gracz zatwierdza atak i ma aktywną kolejkę sztuczek (successCost > 0),
        // zbieramy zakolejkowane sztuczki i przekazujemy jako beastQueue z prefiksem "trick:".
        // applyDuelBatch rozpozna te wpisy i oddzieli je od akcji bestii.
        let extraQueue = null;
        if (actionType === "attack") {
          const tqs = root.querySelector(".mdc-trick-queue-section");
          if (tqs) {
            const trickItems = [];
            tqs.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
              const qty = parseInt(el.textContent, 10) || 0;
              const id  = el.dataset.trickId;
              const dmg = el.dataset.trickDamage;
              if (qty > 0 && id && dmg) {
                for (let i = 0; i < qty; i++) trickItems.push(`trick:${id}:${dmg}`);
              }
            });
            if (trickItems.length) extraQueue = trickItems;
          }

          // getMeleeActions dialog modifiers — zaznaczone checkboxy uruchamiają swój skrypt
          // i dodają wypchnięte akcje jako trick-queue entries (aplikowane bezwarunkowo).
          const dmsSection = root.querySelector(".mdc-dialog-modifiers-section");
          if (dmsSection) {
            const checkedMods = [...dmsSection.querySelectorAll(".mdc-dialog-mod-check:checked")];
            if (checkedMods.length > 0) {
              try {
                const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
                const duelState = message.getFlag("neuroshima", "duelCard");
                const ownerUuid = root.querySelector("[data-melee-owner]")?.dataset.meleeOwner;
                const ownerDocMod = fromUuidSync(ownerUuid);
                const ownerActorMod = ownerDocMod?.actor ?? ownerDocMod;

                const segments = duelState?.segments ?? [];
                const currentSeg = duelState?.currentSegment ?? 0;
                const pastSegs = segments.slice(0, currentSeg).filter(s => s.outcome && s.outcome !== "spent");
                const ownerIsAttacker = duelState?.initiativeOwnerSide === "attacker";
                const ownerDiceArr = ownerIsAttacker ? (duelState?.attackDice ?? []) : (duelState?.defenseDice ?? []);
                const usedSet = new Set(ownerIsAttacker ? (duelState?.usedAttackDice ?? []) : (duelState?.usedDefenseDice ?? []));
                const uncommitted = ownerDiceArr.filter((_, ii) => !usedSet.has(ii));

                for (const cb of checkedMods) {
                  const entry = cb.closest("[data-effect-uuid]");
                  const effectUuid = entry?.dataset.effectUuid;
                  const scriptIdx  = parseInt(entry?.dataset.scriptIdx ?? "-1", 10);
                  if (!effectUuid || scriptIdx < 0) continue;

                  const eff = fromUuidSync(effectUuid);
                  if (!eff) continue;
                  const scriptData = eff.system?.scriptData?.[scriptIdx];
                  if (!scriptData) continue;

                  const script = new NeuroshimaScript(scriptData, eff);
                  const dialogActions = [];
                  // Skrypt zatwierdzenia dla trybu isDialogScript:
                  // Jeśli zdefiniowany submissionScript → wywołaj runSubmission() (dedykowany handler zatwierdzenia).
                  // Fallback → execute() (główny skrypt "code"), dla zachowania wstecznej kompatybilności.
                  const triggerArgs = {
                    actor: ownerActorMod,
                    state: duelState,
                    actions: dialogActions,
                    ownerHadHit: pastSegs.some(s => s.outcome === "hit"),
                    ownerPreviousHits: pastSegs.filter(s => s.outcome === "hit"),
                    uncommittedDice: uncommitted.length,
                    uncommittedSuccesses: uncommitted.filter(d => d.isSuccess).length
                  };
                  try {
                    if (script.submissionScript) {
                      await script.runSubmission(triggerArgs);
                    } else {
                      await script.execute(triggerArgs);
                    }
                  } catch (err) {
                    game.neuroshima?.log("[getMeleeActions dialog] script exec error", err);
                  }
                  // Wszystkie akcje z dialogowego modifikatora wchodzą jako trick-queue entries.
                  for (const a of dialogActions) {
                    if (!a.id || !a.damage) continue;
                    if (!extraQueue) extraQueue = [];
                    extraQueue.push(`trick:${a.id}:${a.damage}`);
                  }
                }
              } catch (err) {
                game.neuroshima?.log("[getMeleeActions dialog] import error", err);
              }
            }
          }
        }

        if (game.user.isGM) {
          await MeleeOpposedChat.applyDuelBatch(message.id, pool, indices, actionArg, extraQueue);
        } else if (game.neuroshima?.socket) {
          await game.neuroshima.socket.executeAsGM("applyDuelBatch", message.id, pool, indices, actionArg, extraQueue);
        }
      });
    });

    const beastQueueSection = root.querySelector(".mdc-beast-queue-section");
    const updateBeastQueue = () => {
      if (!beastQueueSection) return;
      const budgetRemainingEl = beastQueueSection.querySelector(".mdc-beast-budget-remaining");
      const budgetTotalEl     = beastQueueSection.querySelector(".mdc-beast-budget-total");
      const confirmBtn        = beastQueueSection.querySelector(".mdc-beast-confirm-btn");

      const budget = root.querySelectorAll("button.die-chip-mvc.mvc-die-selected").length;

      let spent = 0;
      beastQueueSection.querySelectorAll(".mdc-beast-qty-val").forEach(el => {
        const qty  = parseInt(el.textContent, 10) || 0;
        const cost = parseInt(el.closest(".mdc-beast-action-entry")?.dataset.cost, 10) || 1;
        spent += qty * cost;
      });

      const remaining = budget - spent;
      if (budgetRemainingEl) budgetRemainingEl.textContent = remaining;
      if (budgetTotalEl)     budgetTotalEl.textContent     = budget;

      beastQueueSection.querySelectorAll(".mdc-beast-pick-btn").forEach(btn => {
        const cost = parseInt(btn.dataset.cost, 10) || 1;
        btn.disabled = remaining < cost;
        btn.classList.toggle("is-disabled", remaining < cost);
        btn.classList.toggle("is-ready",    remaining >= cost);
      });

      if (confirmBtn) {
        const ok = spent > 0 && remaining >= 0;
        confirmBtn.disabled = !ok;
        confirmBtn.classList.toggle("is-disabled", !ok);
        confirmBtn.classList.toggle("is-ready",    ok);
      }
    };

    if (beastQueueSection) {
      beastQueueSection.querySelectorAll(".mdc-beast-pick-btn").forEach(pickBtn => {
        pickBtn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const id   = pickBtn.dataset.actionId;
          const cost = parseInt(pickBtn.dataset.cost, 10) || 1;
          const budget  = root.querySelectorAll("button.die-chip-mvc.mvc-die-selected").length;
          let spent = 0;
          beastQueueSection.querySelectorAll(".mdc-beast-qty-val").forEach(el => {
            spent += (parseInt(el.textContent, 10) || 0) * (parseInt(el.closest(".mdc-beast-action-entry")?.dataset.cost, 10) || 1);
          });
          if (spent + cost > budget) return;
          const qtyEl   = beastQueueSection.querySelector(`.mdc-beast-qty-val[data-action-id="${id}"]`);
          const badgeEl = beastQueueSection.querySelector(`.mdc-beast-qty-badge[data-action-id="${id}"]`);
          if (!qtyEl) return;
          qtyEl.textContent = (parseInt(qtyEl.textContent, 10) || 0) + 1;
          if (badgeEl) badgeEl.style.display = "";
          updateBeastQueue();
        });
      });

      beastQueueSection.querySelectorAll(".mdc-beast-undo-btn").forEach(undoBtn => {
        undoBtn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const id      = undoBtn.dataset.actionId;
          const qtyEl   = beastQueueSection.querySelector(`.mdc-beast-qty-val[data-action-id="${id}"]`);
          const badgeEl = beastQueueSection.querySelector(`.mdc-beast-qty-badge[data-action-id="${id}"]`);
          if (!qtyEl) return;
          const cur = parseInt(qtyEl.textContent, 10) || 0;
          if (cur > 0) qtyEl.textContent = cur - 1;
          if (badgeEl && parseInt(qtyEl.textContent, 10) === 0) badgeEl.style.display = "none";
          updateBeastQueue();
        });
      });

      const confirmBtn = beastQueueSection.querySelector(".mdc-beast-confirm-btn");
      if (confirmBtn) {
        confirmBtn.addEventListener("click", async e => {
          e.preventDefault();
          e.stopPropagation();
          if (confirmBtn.disabled) return;
          const pool    = confirmBtn.dataset.pool;
          const selected = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
          const indices  = selected.map(c => parseInt(c.dataset.dieIdx, 10)).filter(n => !isNaN(n));
          const beastQueue = [];
          beastQueueSection.querySelectorAll(".mdc-beast-qty-val").forEach(el => {
            const qty = parseInt(el.textContent, 10) || 0;
            const actionId = el.dataset.actionId;
            if (qty > 0 && actionId) {
              for (let i = 0; i < qty; i++) beastQueue.push(actionId);
            }
          });
          if (game.user.isGM) {
            await MeleeOpposedChat.applyDuelBatch(message.id, pool, indices, "attack", beastQueue.length ? beastQueue : null);
          } else if (game.neuroshima?.socket) {
            await game.neuroshima.socket.executeAsGM("applyDuelBatch", message.id, pool, indices, "attack", beastQueue.length ? beastQueue : null);
          }
        });
      }
    }

    // getMeleeActions trick queue — sekcja dla sztuczek gracza z successCost > 0.
    // Budżet = liczba sukcesów wśród zaznaczonych kości (klasa is-success).
    // Gracz wybiera ile razy użyć danej sztuczki; przy zatwierdzeniu "Attack"
    // kolejka jest kodowana jako "trick:ID:damage" i przekazywana do applyDuelBatch.
    const trickQueueSection = root.querySelector(".mdc-trick-queue-section");

    const updateTrickQueue = () => {
      if (!trickQueueSection) return;
      const selectedChips    = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
      const successBudget    = selectedChips.filter(c => c.classList.contains("is-success")).length;

      let spent = 0;
      trickQueueSection.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
        const qty  = parseInt(el.textContent, 10) || 0;
        const cost = parseInt(
          el.closest(".mdc-trick-action-entry")?.dataset.cost ?? "1", 10
        ) || 1;
        spent += qty * cost;
      });

      const remaining = successBudget - spent;
      const remainingEl = trickQueueSection.querySelector(".mdc-trick-budget-remaining");
      const totalEl     = trickQueueSection.querySelector(".mdc-trick-budget-total");
      if (remainingEl) remainingEl.textContent = remaining;
      if (totalEl)     totalEl.textContent     = successBudget;

      trickQueueSection.querySelectorAll(".mdc-trick-pick-btn").forEach(btn => {
        const cost = parseInt(btn.dataset.cost, 10) || 1;
        btn.disabled = remaining < cost;
        btn.classList.toggle("is-disabled", remaining < cost);
        btn.classList.toggle("is-ready",    remaining >= cost);
      });
    };

    if (trickQueueSection) {
      trickQueueSection.querySelectorAll(".mdc-trick-pick-btn").forEach(pickBtn => {
        pickBtn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const id   = pickBtn.dataset.trickId;
          const dmg  = pickBtn.dataset.damage;
          const cost = parseInt(pickBtn.dataset.cost, 10) || 1;

          const selectedChips = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
          const successBudget = selectedChips.filter(c => c.classList.contains("is-success")).length;
          let spent = 0;
          trickQueueSection.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
            spent += (parseInt(el.textContent, 10) || 0) *
                     (parseInt(el.closest(".mdc-trick-action-entry")?.dataset.cost ?? "1", 10) || 1);
          });
          if (spent + cost > successBudget) return;

          const qtyEl   = trickQueueSection.querySelector(`.mdc-trick-qty-val[data-trick-id="${id}"]`);
          const badgeEl = trickQueueSection.querySelector(`.mdc-trick-qty-badge[data-trick-id="${id}"]`);
          if (!qtyEl) return;
          qtyEl.textContent = (parseInt(qtyEl.textContent, 10) || 0) + 1;
          if (badgeEl) badgeEl.style.display = "";
          updateTrickQueue();
        });
      });

      trickQueueSection.querySelectorAll(".mdc-trick-undo-btn").forEach(undoBtn => {
        undoBtn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const id      = undoBtn.dataset.trickId;
          const qtyEl   = trickQueueSection.querySelector(`.mdc-trick-qty-val[data-trick-id="${id}"]`);
          const badgeEl = trickQueueSection.querySelector(`.mdc-trick-qty-badge[data-trick-id="${id}"]`);
          if (!qtyEl) return;
          const cur = parseInt(qtyEl.textContent, 10) || 0;
          if (cur > 0) qtyEl.textContent = cur - 1;
          if (badgeEl && parseInt(qtyEl.textContent, 10) === 0) badgeEl.style.display = "none";
          updateTrickQueue();
        });
      });
    }

    // Dialog modifier checkboxes — explicit click handler because Foundry chat messages
    // may not properly propagate native label/checkbox interactions.
    // Clicking the entry label toggles the checkbox and updates the visual state.
    root.querySelectorAll(".mdc-dialog-mod-entry").forEach(entry => {
      entry.addEventListener("click", e => {
        e.stopPropagation();
        const cb = entry.querySelector(".mdc-dialog-mod-check");
        if (!cb) return;
        if (e.target === cb) return;
        cb.checked = !cb.checked;
      });
    });

    // Trick queue confirm button — works like beast confirm button:
    // collects selected dice + trick queue items and submits as "attack" action.
    // Allows mixing tricks with normal attack (all selected dice go to attack comparison,
    // tricks are additional effects resolved on top based on success budget).
    const trickConfirmBtn = root.querySelector(".mdc-trick-confirm-btn");
    if (trickConfirmBtn && trickQueueSection) {
      trickConfirmBtn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        if (trickConfirmBtn.disabled) return;
        const pool    = trickConfirmBtn.dataset.pool;
        const selected = [...root.querySelectorAll("button.die-chip-mvc.mvc-die-selected")];
        const indices  = selected.map(c => parseInt(c.dataset.dieIdx, 10)).filter(n => !isNaN(n));
        const trickItems = [];
        trickQueueSection.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
          const qty = parseInt(el.textContent, 10) || 0;
          const id  = el.dataset.trickId;
          const dmg = el.dataset.trickDamage;
          if (qty > 0 && id && dmg) {
            for (let i = 0; i < qty; i++) trickItems.push(`trick:${id}:${dmg}`);
          }
        });
        if (game.user.isGM) {
          await MeleeOpposedChat.applyDuelBatch(message.id, pool, indices, "attack", trickItems.length ? trickItems : null);
        } else if (game.neuroshima?.socket) {
          await game.neuroshima.socket.executeAsGM("applyDuelBatch", message.id, pool, indices, "attack", trickItems.length ? trickItems : null);
        }
      });
    }

    updateActionButtons();
    updateBeastQueue();
    updateTrickQueue();

    // Trick confirm button state — enabled when dice are selected (like beast confirm).
    const updateTrickConfirm = () => {
      if (!trickConfirmBtn) return;
      const selectedCount = root.querySelectorAll("button.die-chip-mvc.mvc-die-selected").length;
      let spent = 0;
      if (trickQueueSection) {
        trickQueueSection.querySelectorAll(".mdc-trick-qty-val").forEach(el => {
          spent += parseInt(el.textContent, 10) || 0;
        });
      }
      const ok = selectedCount >= 1;
      trickConfirmBtn.disabled = !ok;
      trickConfirmBtn.classList.toggle("is-disabled", !ok);
      trickConfirmBtn.classList.toggle("is-ready", ok);
    };
    updateTrickConfirm();

    // Re-run after die chip clicks.
    root.querySelectorAll("button.die-chip-mvc").forEach(chip => {
      chip.addEventListener("click", updateTrickConfirm);
    });
    if (trickQueueSection) {
      trickQueueSection.querySelectorAll(".mdc-trick-pick-btn, .mdc-trick-undo-btn").forEach(b => {
        b.addEventListener("click", updateTrickConfirm);
      });
    }
  }

  static async applyDuelBatch(messageId, pool, diceIndices, action = null, beastQueue = null) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const state = foundry.utils.deepClone(message.getFlag("neuroshima", "duelCard"));
    if (!state || state.status !== "picking") return;

    const isOwnerAttacker = state.initiativeOwnerSide === "attacker";
    const ownerPool       = isOwnerAttacker ? "attacker" : "defender";
    const responderPool   = isOwnerAttacker ? "defender" : "attacker";

    if (state.waitingFor === "initiativeOwner") {
      if (pool !== ownerPool) return;

      // Segment history — save a snapshot of the full state BEFORE this segment begins.
      // Strips segmentHistory/segmentFuture from the snapshot to avoid recursive nesting.
      // Used by undoDuelSegment / redoDuelSegment so the GM can roll back mistakes.
      const snapshot = foundry.utils.deepClone(state);
      delete snapshot.segmentHistory;
      delete snapshot.segmentFuture;
      if (!state.segmentHistory) state.segmentHistory = [];
      state.segmentHistory.push(snapshot);
      state.segmentFuture = [];  // clear redo stack when a new action is taken

      const rawAction      = action || "attack";
      const ownerDicePool  = isOwnerAttacker ? state.attackDice : state.defenseDice;

      // Sztuczki gracza mają format "trick:ID:damage" (np. "trick:barbarka-head-butt:sC").
      // Traktujemy je jak atak — porównanie sukcesów — ale przy trafieniu używamy
      // damage z sztuczki zamiast damage${N} z uzbrojenia.
      const isTrick = rawAction.startsWith("trick:");
      let declaredAction = rawAction;
      let committedTrickId     = null;
      let committedTrickDamage = null;
      if (isTrick) {
        const parts = rawAction.split(":");
        committedTrickId     = parts[1] ?? null;
        committedTrickDamage = parts[2] ?? null;
        declaredAction = "trick";
      }

      if (declaredAction === "exit") {
        if (diceIndices.length !== 1) return;
      } else if (declaredAction === "nonCombat") {
        if (!diceIndices.length || diceIndices.length > 3) return;
        const hasSuccess = diceIndices.some(i => ownerDicePool[i]?.isSuccess);
        if (!hasSuccess) {
          ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.DuelNonCombatNeedSuccess"));
          return;
        }
      } else {
        // attack, trick — wymagają co najmniej 1, max 3 kości
        if (!diceIndices.length || diceIndices.length > 3) return;
      }
      state.declaredAction        = declaredAction;
      state.committedOwnerIndices = diceIndices;
      // Rozdziel beastQueue na akcje bestii i sztuczki gracza (trick: prefix).
      // Sztuczki z successCost wrzucane są przez UI jako "trick:ID:damage" w tym samym parametrze.
      const rawBeastItems = Array.isArray(beastQueue) ? beastQueue.filter(id => !id.startsWith("trick:")) : [];
      const rawTrickItems = Array.isArray(beastQueue) ? beastQueue.filter(id =>  id.startsWith("trick:")) : [];
      state.committedBeastQueue  = rawBeastItems.length  > 0 ? rawBeastItems  : null;
      state.committedTrickQueue  = rawTrickItems.length  > 0 ? rawTrickItems  : null;
      // Zapisz metadane sztuczki — używane przy rozstrzygnięciu w fazie responder
      state.committedTrickId     = committedTrickId;
      state.committedTrickDamage = committedTrickDamage;
      state.waitingFor            = "responder";
      await MeleeOpposedChat._renderDuelCard(message, state);
      return;
    }

    if (state.waitingFor === "responder") {
      const declaredAction  = state.declaredAction || "attack";
      const responderAction = action || (
        declaredAction === "exit"      ? "blockExit" :
        declaredAction === "nonCombat" ? "interrupt" : "defend"
      );

      const ownerDice     = isOwnerAttacker ? state.attackDice  : state.defenseDice;
      const responderDice = isOwnerAttacker ? state.defenseDice : state.attackDice;
      const ownerIndices  = state.committedOwnerIndices || [];
      const N             = ownerIndices.length;

      let outcome;
      let segAttackVal  = 0;
      let segDefenseVal = 0;

      // ── attack / flee ──────────────────────────────────────────────────
      if (declaredAction === "attack" && responderAction === "flee") {
        const escapeeUuid = isOwnerAttacker ? state.defenderUuid : state.attackerUuid;
        state.hits.push({ tier: 1, damageType: state.damage1 ?? "d", isBackHit: true, escapeeUuid });
        state._escapeeUuid = escapeeUuid;
        if (isOwnerAttacker) {
          state.usedAttackDice = [...(state.usedAttackDice || []), ...ownerIndices];
        } else {
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
        }
        outcome = "flee";

      // ── exit / allowExit ───────────────────────────────────────────────
      } else if (declaredAction === "exit" && responderAction === "allowExit") {
        if (isOwnerAttacker) {
          state.usedAttackDice = [...(state.usedAttackDice || []), ...ownerIndices];
        } else {
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
        }
        outcome = "exit";

      // ── nonCombat / seizeInit ──────────────────────────────────────────
      } else if (declaredAction === "nonCombat" && responderAction === "seizeInit") {
        if (pool !== responderPool) return;
        if (diceIndices.length !== N) return;
        state.initiativeOwnerSide = isOwnerAttacker ? "defender" : "attacker";
        if (isOwnerAttacker) {
          state.usedAttackDice  = [...(state.usedAttackDice  || []), ...ownerIndices];
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...diceIndices];
        } else {
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
          state.usedAttackDice  = [...(state.usedAttackDice  || []), ...diceIndices];
        }
        outcome = "seizeInit";

      // ── default dice comparison ────────────────────────────────────────
      } else {
        if (pool !== responderPool) return;

        if (declaredAction === "exit") {
          if (diceIndices.length !== 1) return;
        } else if (declaredAction === "nonCombat") {
          if (!diceIndices.length) return;
        } else {
          if (diceIndices.length !== N) return;
        }

        const ownerSuccessCount    = ownerIndices.filter(i => ownerDice[i]?.isSuccess).length;
        const responderSuccessCount = diceIndices.filter(i => responderDice[i]?.isSuccess).length;
        const ownerHasSuccess     = ownerSuccessCount > 0;
        const responderHasSuccess  = responderSuccessCount > 0;

        if (declaredAction === "attack" || declaredAction === "trick") {
          if      (ownerSuccessCount > responderSuccessCount)  outcome = "hit";
          else if (ownerSuccessCount < responderSuccessCount)  outcome = "takeover";
          else if (ownerSuccessCount > 0)                      outcome = "draw";
          else                                                  outcome = "nothing";

          if (outcome === "hit") {
            // Sztuczki gracza mają własny, stały typ obrażeń niezależny od uzbrojenia.
            // Dla zwykłego ataku używamy damage${N} z profilu broni.
            const hitDmgType = declaredAction === "trick" && state.committedTrickDamage
              ? state.committedTrickDamage
              : (state[`damage${N}`] ?? "?");
            const hitEntry = { tier: N, damageType: hitDmgType };
            if (declaredAction === "trick" && state.committedTrickId) {
              hitEntry.trickId = state.committedTrickId;
            }
            state.hits.push(hitEntry);
          }

          segAttackVal  = isOwnerAttacker ? ownerSuccessCount    : responderSuccessCount;
          segDefenseVal = isOwnerAttacker ? responderSuccessCount : ownerSuccessCount;

          if (outcome === "takeover") state.initiativeOwnerSide = isOwnerAttacker ? "defender" : "attacker";
          // Wyczyść metadane sztuczki po rozstrzygnięciu segmentu
          state.committedTrickId     = null;
          state.committedTrickDamage = null;

        } else if (declaredAction === "exit") {
          outcome = (ownerHasSuccess && !responderHasSuccess) ? "exit" : "blocked";

        } else {
          const ownerSuccesses     = ownerIndices.filter(i => ownerDice[i]?.isSuccess).length;
          const responderSuccesses = diceIndices.filter(i => responderDice[i]?.isSuccess).length;
          outcome = responderSuccesses >= ownerSuccesses ? "interrupted" : "nonCombat";
        }

        if (isOwnerAttacker) {
          state.usedAttackDice  = [...(state.usedAttackDice  || []), ...ownerIndices];
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...diceIndices];
        } else {
          state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
          state.usedAttackDice  = [...(state.usedAttackDice  || []), ...diceIndices];
        }
      }

      const seg = state.segments[state.currentSegment];
      seg.attackVal  = segAttackVal;
      seg.defenseVal = segDefenseVal;
      seg.outcome    = outcome;
      seg.tier       = N;

      for (let i = state.currentSegment + 1; i < state.currentSegment + N; i++) {
        if (i < state.segments.length) {
          state.segments[i].outcome = "spent";
          state.segments[i].tier    = 0;
        }
      }

      state.committedOwnerIndices = null;
      state.declaredAction        = null;

      // Akumuluj sztuczki z kolejki (successCost) — są niezależne od wyniku porównania kości.
      // Sztuczki w queue są "opłacone" sukcesami gracza z góry, więc zawsze się aplikują.
      if (state.committedTrickQueue?.length > 0) {
        state.allTrickQueue = [...(state.allTrickQueue || []), ...state.committedTrickQueue];
        state.committedTrickQueue = null;
      }

      await MeleeOpposedChat._syncInitiativeToTracker(state);

      const endingOutcomes = ["flee", "exit"];
      const isEnded     = endingOutcomes.includes(outcome);
      const nextSegment = state.currentSegment + N;
      const atkLeft     = state.attackDice.length  - (state.usedAttackDice  || []).length;
      const defLeft     = state.defenseDice.length - (state.usedDefenseDice || []).length;
      const hasNext     = !isEnded && nextSegment < state.segments.length && atkLeft > 0 && defLeft > 0;

      if (hasNext) {
        state.currentSegment = nextSegment;
        state.waitingFor = "initiativeOwner";
      } else {
        state.status     = "done";
        state.waitingFor = null;
      }

      if (state.status === "done") {
        const locationRoll = (state.attackDice[0]?.original) ?? 10;
        const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);

        const atkDoc = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
        const atkActor = atkDoc?.actor ?? atkDoc;
        const isCreatureAttacker = atkActor?.type === "creature";
        const isBeastAttack = isCreatureAttacker && !state.weaponId;
        const netSuccesses = state.hits.length;

        const affordableBeastActions = [];
        if (isBeastAttack && netSuccesses > 0 && atkActor) {
          const beastItemFilter = state.beastItemId ?? null;
          for (const item of atkActor.items.filter(i => i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter))) {
            for (const act of (item.system.activities ?? [])) {
              if (act.costType !== "success") continue;
              const cost = act.successCost ?? 1;
              if (cost <= netSuccesses) {
                affordableBeastActions.push({
                  id: `${item.id}::${act.id}`,
                  itemId: item.id,
                  name: act.name || item.name,
                  img: act.img || item.img,
                  cost,
                  damage: act.damage || null,
                  gmNote: act.gmNote || "",
                  hasEffects: (act.effectIds?.length ?? 0) > 0
                });
              }
            }
          }
          affordableBeastActions.sort((a, b) => a.cost - b.cost);
        }

        await message.setFlag("neuroshima", "opposedResult", {
          attackerUuid: state.attackerUuid,
          defenderUuid: state.defenderUuid,
          weaponId: state.weaponId,
          beastItemId: state.beastItemId ?? null,
          hits: state.hits,
          location,
          escapeeUuid: state._escapeeUuid ?? null,
          damage1: state.damage1,
          damage2: state.damage2,
          damage3: state.damage3,
          netSuccesses,
          affordableBeastActions,
          isBeastAttack,
          pendingBeastQueue: state.committedBeastQueue ?? null,
          // Sztuczki gracza z kolejki (successCost) — aplikowane razem z normalnymi obrażeniami
          pendingTrickQueue: state.allTrickQueue?.length > 0 ? state.allTrickQueue : null,
          applied: false,
          beastActionsApplied: false
        });
      }

      await MeleeOpposedChat._renderDuelCard(message, state);

      // MANEUVER — Trash collector (duel card resolved):
      // Clear maneuver conditions from both combatants only after all dice have been
      // spent on the card (state.status === "done").  Conditions must remain active
      // during the exchange so resolution code (pełna obrona 2-success threshold,
      // furia auto-hit, etc.) can still read them on subsequent segments.
      if (state.status === "done") {
        const { MeleeTurnService: _MTS } = await import("./melee-turn-service.js");
        const atkDoc = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
        const defDoc = fromUuidSync(state.defenderTokenUuid || state.defenderUuid);
        await _MTS._clearManeuverConditions(atkDoc?.actor ?? atkDoc);
        await _MTS._clearManeuverConditions(defDoc?.actor ?? defDoc);
        game.neuroshima?.log("[melee-opposed-chat.applyDuelBatch] maneuver conditions cleared after done", {
          attacker: state.attackerTokenUuid || state.attackerUuid,
          defender: state.defenderTokenUuid || state.defenderUuid
        });
      }
    }
  }

  static async applyDuelPick(messageId, side, dieIdx) {
    await MeleeOpposedChat.applyDuelBatch(messageId, side, [dieIdx]);
  }

  static async swapDuelInitiative(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const state = foundry.utils.deepClone(message.getFlag("neuroshima", "duelCard"));
    if (!state || state.status !== "picking") return;
    if (state.isGradCios) return;

    state.initiativeOwnerSide = state.initiativeOwnerSide === "attacker" ? "defender" : "attacker";
    state.committedOwnerIndices = null;
    state.waitingFor = "initiativeOwner";

    await MeleeOpposedChat._syncInitiativeToTracker(state);
    await MeleeOpposedChat._renderDuelCard(message, state);
  }

  /**
   * Undo the last segment decision and restore the duel to the state
   * it was in before that segment's initiativeOwner pick.
   * Only available to the GM. Works like CTRL+Z — the undone state
   * goes onto the redo stack so it can be restored with redoDuelSegment.
   */
  static async undoDuelSegment(messageId) {
    if (!game.user.isGM) return;
    const message = game.messages.get(messageId);
    if (!message) return;

    const state = foundry.utils.deepClone(message.getFlag("neuroshima", "duelCard"));
    if (!state?.segmentHistory?.length) return;

    // Current state stripped of history/future → goes to redo stack
    const current = foundry.utils.deepClone(state);
    delete current.segmentHistory;
    delete current.segmentFuture;

    const prev = state.segmentHistory[state.segmentHistory.length - 1];
    prev.segmentHistory = state.segmentHistory.slice(0, -1);
    prev.segmentFuture  = [current, ...(state.segmentFuture || [])];

    game.neuroshima?.log("[melee-opposed-chat] undoDuelSegment", {
      historyLength: prev.segmentHistory.length,
      futureLength:  prev.segmentFuture.length
    });
    await MeleeOpposedChat._renderDuelCard(message, prev);
  }

  /**
   * Redo a previously undone segment decision.
   * Works like CTRL+Y — restores the most recently undone state.
   */
  static async redoDuelSegment(messageId) {
    if (!game.user.isGM) return;
    const message = game.messages.get(messageId);
    if (!message) return;

    const state = foundry.utils.deepClone(message.getFlag("neuroshima", "duelCard"));
    if (!state?.segmentFuture?.length) return;

    const current = foundry.utils.deepClone(state);
    delete current.segmentHistory;
    delete current.segmentFuture;

    const next = state.segmentFuture[0];
    next.segmentHistory = [...(state.segmentHistory || []), current];
    next.segmentFuture  = state.segmentFuture.slice(1);

    game.neuroshima?.log("[melee-opposed-chat] redoDuelSegment", {
      historyLength: next.segmentHistory.length,
      futureLength:  next.segmentFuture.length
    });
    await MeleeOpposedChat._renderDuelCard(message, next);
  }

  static async _syncInitiativeToTracker(state) {
    if (!game.combat) return;
    const groups = foundry.utils.deepClone(game.combat.getFlag("neuroshima", "meleeGroups") || []);
    const atkUuid = state.attackerUuid;
    const defUuid = state.defenderUuid;
    const groupIdx = groups.findIndex(g =>
      (g.fighters || []).some(f => f.uuid === atkUuid) &&
      (g.fighters || []).some(f => f.uuid === defUuid)
    );
    if (groupIdx === -1) return;
    const newOwnerUuid = state.initiativeOwnerSide === "attacker" ? atkUuid : defUuid;
    if (groups[groupIdx].initiativeOwnerId === newOwnerUuid) return;
    groups[groupIdx].initiativeOwnerId = newOwnerUuid;
    await game.combat.setFlag("neuroshima", "meleeGroups", groups);
  }

  /**
   * Create the skill-allocation card when doubleSkillAction is ON and either side has a budget.
   * @private
   */
  static async _createAllocationCard({ data, attackerActor, defenderActor,
      attackDice, defenseDice, attackTarget, defenseTarget,
      attackSuccesses, defenseSuccesses, attackerSkillBudget, defenderSkillBudget }) {
    const allocData = {
      status: "pending",
      mode: data.mode,
      attackerUuid: data.attackerUuid,
      defenderUuid: data.defenderUuid,
      weaponId: data.weaponId,
      beastItemId: data.beastItemId ?? null,
      attackDice,
      defenseDice,
      attackTarget,
      defenseTarget,
      attackSuccesses,
      defenseSuccesses,
      damage1: data.damage1,
      damage2: data.damage2,
      damage3: data.damage3,
      attackerSkillBudget,
      defenderSkillBudget,
      attackerSelfReductions: [0, 0, 0],
      attackerOpponentGains: [0, 0, 0],
      defenderSelfReductions: [0, 0, 0],
      defenderOpponentGains: [0, 0, 0],
      attackerConfirmed: false,
      defenderConfirmed: false
    };

    const context = MeleeOpposedChat._buildAllocationContext(allocData, attackerActor, defenderActor);
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-skill-allocation.hbs",
      context
    );

    const rollMode = game.settings.get("core", "rollMode");
    await ChatMessage.create({
      content,
      flags: { neuroshima: { skillAlloc: allocData } },
      speaker: { alias: "⚔" },
      rollMode
    });
  }

  /**
   * Build context for the skill-allocation template from stored allocData.
   * @private
   */
  static _buildAllocationContext(allocData, attackerActor, defenderActor) {
    const {
      attackDice, defenseDice,
      attackerSelfReductions, attackerOpponentGains,
      defenderSelfReductions, defenderOpponentGains,
      attackerSkillBudget, defenderSkillBudget,
      attackTarget, defenseTarget,
      attackerConfirmed, defenderConfirmed
    } = allocData;

    const attackerBudgetUsed = (attackerSelfReductions || []).reduce((a, b) => a + b, 0)
      + (attackerOpponentGains || []).reduce((a, b) => a + b, 0);
    const defenderBudgetUsed = (defenderSelfReductions || []).reduce((a, b) => a + b, 0)
      + (defenderOpponentGains || []).reduce((a, b) => a + b, 0);
    const attackerBudgetRemaining = (attackerSkillBudget || 0) - attackerBudgetUsed;
    const defenderBudgetRemaining = (defenderSkillBudget || 0) - defenderBudgetUsed;

    const pairedDice = Array.from({ length: 3 }, (_, i) => {
      const aDie = (attackDice || [])[i] ?? null;
      const dDie = (defenseDice || [])[i] ?? null;

      const atkSelf = (attackerSelfReductions || [])[i] || 0;
      const atkOpp  = (attackerOpponentGains  || [])[i] || 0;
      const defSelf = (defenderSelfReductions || [])[i] || 0;
      const defOpp  = (defenderOpponentGains  || [])[i] || 0;

      const rawAtkVal = aDie?.modified ?? aDie?.original ?? null;
      const rawDefVal = dDie?.modified ?? dDie?.original ?? null;

      const effAtkVal = rawAtkVal !== null ? Math.min(20, Math.max(1, rawAtkVal - atkSelf + defOpp)) : null;
      const effDefVal = rawDefVal !== null ? Math.min(20, Math.max(1, rawDefVal - defSelf + atkOpp)) : null;

      const effectiveAttack = effAtkVal !== null ? {
        value: effAtkVal,
        isSuccess: effAtkVal <= (attackTarget || 0) && effAtkVal !== 20,
        isNat1: effAtkVal === 1,
        isNat20: effAtkVal === 20
      } : null;

      const effectiveDefense = effDefVal !== null ? {
        value: effDefVal,
        isSuccess: effDefVal <= (defenseTarget || 0) && effDefVal !== 20,
        isNat1: effDefVal === 1,
        isNat20: effDefVal === 20
      } : null;

      const attackDelta = (effAtkVal !== null && rawAtkVal !== null) ? effAtkVal - rawAtkVal : 0;
      const defenseDelta = (effDefVal !== null && rawDefVal !== null) ? effDefVal - rawDefVal : 0;

      const attackCanSelfSpend = !!aDie && !attackerConfirmed && attackerBudgetRemaining > 0 && (effAtkVal ?? 0) > 1 && (aDie?.original ?? rawAtkVal) !== 20;
      const defenderCanSelfSpend = !!dDie && !defenderConfirmed && defenderBudgetRemaining > 0 && (effDefVal ?? 0) > 1 && (dDie?.original ?? rawDefVal) !== 20;
      const attackerCanOpponentSpend = !!dDie && !attackerConfirmed && attackerBudgetRemaining > 0 && (effDefVal ?? 20) < 20;
      const defenderCanOpponentSpend = !!aDie && !defenderConfirmed && defenderBudgetRemaining > 0 && (effAtkVal ?? 20) < 20;

      return {
        label: `D${i + 1}`,
        effectiveAttack,
        effectiveDefense,
        attackModified: attackDelta !== 0,
        defenseModified: defenseDelta !== 0,
        attackDeltaDisplay: attackDelta > 0 ? `+${attackDelta}` : `${attackDelta}`,
        defenseDeltaDisplay: defenseDelta > 0 ? `+${defenseDelta}` : `${defenseDelta}`,
        attackCanSelfSpend,
        defenderCanSelfSpend,
        attackerCanOpponentSpend,
        defenderCanOpponentSpend,
        attackSelfAlloc: atkSelf > 0,
        defSelfAlloc: defSelf > 0,
        atkOppAllocDefense: atkOpp > 0,
        defOppAllocAttack: defOpp > 0
      };
    });

    return {
      mode: allocData.mode,
      modeLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${allocData.mode}`),
      attackerName: attackerActor?.name ?? allocData.attackerUuid,
      attackerImg: attackerActor?.img,
      defenderName: defenderActor?.name ?? allocData.defenderUuid,
      defenderImg: defenderActor?.img,
      attackerBudgetRemaining,
      defenderBudgetRemaining,
      attackerConfirmed,
      defenderConfirmed,
      pairedDice
    };
  }

  /**
   * Apply a skill allocation adjustment patch to the allocation card.
   * Called from the socket handler so the GM can safely update the message flag.
   */
  static async applyAllocPatch(messageId, patch) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const allocData = message.getFlag("neuroshima", "skillAlloc");
    if (!allocData || allocData.status !== "pending") return;

    const updated = foundry.utils.deepClone(allocData);

    if (patch.type === "adjust") {
      const { spender, target, dieIndex, delta } = patch;
      const arr = spender === "attacker"
        ? (target === "self" ? updated.attackerSelfReductions : updated.attackerOpponentGains)
        : (target === "self" ? updated.defenderSelfReductions : updated.defenderOpponentGains);

      const attackerBudgetUsed = (updated.attackerSelfReductions || []).reduce((a, b) => a + b, 0)
        + (updated.attackerOpponentGains || []).reduce((a, b) => a + b, 0);
      const defenderBudgetUsed = (updated.defenderSelfReductions || []).reduce((a, b) => a + b, 0)
        + (updated.defenderOpponentGains || []).reduce((a, b) => a + b, 0);
      const attackerRemaining = (updated.attackerSkillBudget || 0) - attackerBudgetUsed;
      const defenderRemaining = (updated.defenderSkillBudget || 0) - defenderBudgetUsed;
      const remaining = spender === "attacker" ? attackerRemaining : defenderRemaining;

      const attackDie = (updated.attackDice || [])[dieIndex];
      const defenseDie = (updated.defenseDice || [])[dieIndex];

      if (delta > 0 && remaining <= 0) return;

      if (spender === "attacker" && target === "self") {
        const atkSelf = arr[dieIndex] || 0;
        const defOpp  = (updated.defenderOpponentGains || [])[dieIndex] || 0;
        const rawVal  = attackDie?.modified ?? attackDie?.original ?? 0;
        const effVal  = rawVal - atkSelf + defOpp;
        if (delta > 0 && (attackDie?.original ?? rawVal) === 20) return;
        if (delta > 0 && effVal <= 1) return;
        if (delta < 0 && atkSelf <= 0) return;
      } else if (spender === "defender" && target === "self") {
        const defSelf = arr[dieIndex] || 0;
        const atkOpp  = (updated.attackerOpponentGains || [])[dieIndex] || 0;
        const rawVal  = defenseDie?.modified ?? defenseDie?.original ?? 0;
        const effVal  = rawVal - defSelf + atkOpp;
        if (delta > 0 && (defenseDie?.original ?? rawVal) === 20) return;
        if (delta > 0 && effVal <= 1) return;
        if (delta < 0 && defSelf <= 0) return;
      } else if (spender === "attacker" && target === "opponent") {
        const atkOpp  = arr[dieIndex] || 0;
        const defSelf = (updated.defenderSelfReductions || [])[dieIndex] || 0;
        const rawVal  = defenseDie?.modified ?? defenseDie?.original ?? 0;
        const effVal  = rawVal - defSelf + atkOpp;
        if (delta > 0 && effVal >= 20) return;
        if (delta < 0 && atkOpp <= 0) return;
      } else if (spender === "defender" && target === "opponent") {
        const defOpp  = arr[dieIndex] || 0;
        const atkSelf = (updated.attackerSelfReductions || [])[dieIndex] || 0;
        const rawVal  = attackDie?.modified ?? attackDie?.original ?? 0;
        const effVal  = rawVal - atkSelf + defOpp;
        if (delta > 0 && effVal >= 20) return;
        if (delta < 0 && defOpp <= 0) return;
      }

      arr[dieIndex] = (arr[dieIndex] || 0) + delta;

    } else if (patch.type === "reset") {
      if (patch.side === "attacker") {
        updated.attackerSelfReductions = [0, 0, 0];
        updated.attackerOpponentGains  = [0, 0, 0];
      } else {
        updated.defenderSelfReductions = [0, 0, 0];
        updated.defenderOpponentGains  = [0, 0, 0];
      }
    } else if (patch.type === "confirm") {
      if (patch.side === "attacker") updated.attackerConfirmed = true;
      else updated.defenderConfirmed = true;
    }

    await message.setFlag("neuroshima", "skillAlloc", updated);

    // Re-render the card HTML
    const attackerDoc = fromUuidSync(updated.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    const defenderDoc = fromUuidSync(updated.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;

    const context = MeleeOpposedChat._buildAllocationContext(updated, attackerActor, defenderActor);
    const newContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-skill-allocation.hbs",
      context
    );
    await message.update({ content: newContent });

    if (updated.attackerConfirmed && updated.defenderConfirmed) {
      await MeleeOpposedChat.resolveFromAllocation(messageId);
    }
  }

  /**
   * Resolve the opposed test from a confirmed allocation card.
   */
  static async resolveFromAllocation(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const allocData = message.getFlag("neuroshima", "skillAlloc");
    if (!allocData || allocData.status !== "pending") return;
    if (!allocData.attackerConfirmed || !allocData.defenderConfirmed) return;

    await message.setFlag("neuroshima", "skillAlloc", { ...allocData, status: "resolved" });

    const attackerDoc = fromUuidSync(allocData.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    const defenderDoc = fromUuidSync(allocData.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;

    const mode = allocData.mode;
    const {
      attackDice, defenseDice,
      attackerSelfReductions, attackerOpponentGains,
      defenderSelfReductions, defenderOpponentGains,
      attackTarget, defenseTarget,
      damage1, damage2, damage3
    } = allocData;

    // Compute effective dice after allocation
    const effectiveAttackDice = (attackDice || []).map((d, i) => {
      if (!d) return null;
      const atkSelf = (attackerSelfReductions || [])[i] || 0;
      const defOpp  = (defenderOpponentGains  || [])[i] || 0;
      const rawVal  = d.modified ?? d.original;
      const effVal  = Math.min(20, Math.max(1, rawVal - atkSelf + defOpp));
      return {
        original: d.original,
        modified: effVal,
        isSuccess: effVal <= (attackTarget || 0) && effVal !== 20,
        isNat1: effVal === 1,
        isNat20: effVal === 20
      };
    }).filter(Boolean);

    const effectiveDefenseDice = (defenseDice || []).map((d, i) => {
      if (!d) return null;
      const defSelf = (defenderSelfReductions || [])[i] || 0;
      const atkOpp  = (attackerOpponentGains  || [])[i] || 0;
      const rawVal  = d.modified ?? d.original;
      const effVal  = Math.min(20, Math.max(1, rawVal - defSelf + atkOpp));
      return {
        original: d.original,
        modified: effVal,
        isSuccess: effVal <= (defenseTarget || 0) && effVal !== 20,
        isNat1: effVal === 1,
        isNat20: effVal === 20
      };
    }).filter(Boolean);

    const attackSuccesses = effectiveAttackDice.filter(d => d.isSuccess).length;
    const defenseSuccesses = effectiveDefenseDice.filter(d => d.isSuccess).length;

    const attackerName = attackerActor?.name ?? "Attacker";
    const defenderName = defenderActor?.name ?? "Defender";

    // Resolution logic (same as resolveOpposed)
    let hits = [];
    let resultType = "block";
    let resultText = "";

    if (mode === "opposedPips") {
      for (let i = 0; i < 3; i++) {
        const aDie = effectiveAttackDice[i];
        const dDie = effectiveDefenseDice[i];
        if (!aDie) continue;
        const aWins = aDie.isSuccess && (!dDie?.isSuccess || aDie.modified < (dDie?.modified ?? Infinity));
        if (aWins) {
          const tier = i + 1;
          hits.push({ tier, damageType: allocData[`damage${tier}`] });
        }
      }
      if (hits.length > 0) {
        resultType = "hit";
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogPipsHit", {
          attacker: attackerName, defender: defenderName,
          tiers: hits.map(h => `D${h.tier}(${h.damageType})`).join(", ")
        });
      } else {
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogBlock", {
          attacker: attackerName, defender: defenderName
        });
      }
    } else {
      const net = attackSuccesses - defenseSuccesses;
      if (net > 0) {
        resultType = "hit";
        const tier = Math.min(3, net);
        hits.push({ tier, damageType: allocData[`damage${tier}`] });
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogSuccessesHit", {
          attacker: attackerName, defender: defenderName,
          net, tier, damage: allocData[`damage${tier}`]
        });
      } else {
        resultText = game.i18n.format("NEUROSHIMA.MeleeOpposedChat.LogBlock", {
          attacker: attackerName, defender: defenderName
        });
      }
    }

    const attackDiceDisplay = effectiveAttackDice.map((d, i) => ({
      label: `D${i + 1}`, ...d, isNat1: d.original === 1, isNat20: d.original === 20
    }));
    const defenseDiceDisplay = effectiveDefenseDice.map((d, i) => ({
      label: `D${i + 1}`, ...d, isNat1: d.original === 1, isNat20: d.original === 20
    }));

    const pairWinners = {};
    if (mode === "opposedPips") {
      for (let i = 0; i < 3; i++) {
        const aDie = effectiveAttackDice[i];
        const dDie = effectiveDefenseDice[i];
        const aWins = aDie?.isSuccess && (!dDie?.isSuccess || aDie.modified < (dDie?.modified ?? Infinity));
        const dWins = dDie?.isSuccess && (!aDie?.isSuccess || dDie.modified < (aDie?.modified ?? Infinity));
        pairWinners[i] = { attackWon: aWins ?? false, defenseWon: dWins ?? false };
      }
    }

    const pairedDice = Array.from({ length: 3 }, (_, i) => {
      const aDie = attackDiceDisplay[i] ?? null;
      const dDie = defenseDiceDisplay[i] ?? null;
      const pw = pairWinners[i] ?? {};
      return { label: `D${i + 1}`, attack: aDie, defense: dDie, attackWon: pw.attackWon ?? false, defenseWon: pw.defenseWon ?? false };
    });

    hits.sort((a, b) => a.tier - b.tier);

    const isCreatureAttacker = attackerActor?.type === "creature";
    let netSuccesses = 0;
    if (mode === "opposedSuccesses") {
      netSuccesses = Math.max(0, attackSuccesses - defenseSuccesses);
    } else {
      netSuccesses = hits.length;
    }

    const affordableBeastActions = [];
    if (isCreatureAttacker && netSuccesses > 0) {
      const beastItemFilter = allocData.beastItemId ?? null;
      for (const item of attackerActor.items.filter(i => i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter))) {
        for (const act of (item.system.activities ?? [])) {
          if (act.costType !== "success") continue;
          const cost = act.successCost ?? 1;
          if (cost <= netSuccesses) {
            affordableBeastActions.push({
              id: `${item.id}::${act.id}`,
              itemId: item.id,
              name: act.name || item.name,
              img: act.img || item.img,
              cost,
              damage: act.damage || null,
              gmNote: act.gmNote || "",
              hasEffects: (act.effectIds?.length ?? 0) > 0
            });
          }
        }
      }
      affordableBeastActions.sort((a, b) => a.cost - b.cost);
    }

    const weaponName = attackerActor?.items?.get(allocData.weaponId)?.name ?? "";

    const resolutionData = {
      mode, modeLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${mode}`),
      attackerName, attackerImg: attackerActor?.img,
      defenderName, defenderImg: defenderActor?.img,
      weaponName,
      attackDice: attackDiceDisplay, defenseDice: defenseDiceDisplay,
      pairedDice, attackTarget, defenseTarget,
      attackSuccesses, defenseSuccesses,
      resultType, resultText, hits,
      isHit: resultType === "hit",
      damage1, damage2, damage3,
      isCreatureAttacker, netSuccesses,
      affordableBeastActions, hasBeastActions: affordableBeastActions.length > 0,
      isBeastAttack: isCreatureAttacker && !allocData.weaponId
    };

    const resContent = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-result.hbs",
      resolutionData
    );

    const locationRoll = (allocData.attackDice?.[0]?.original) ?? 10;
    const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);

    const rollMode = game.settings.get("core", "rollMode");
    await ChatMessage.create({
      content: resContent,
      flags: {
        neuroshima: {
          opposedResult: {
            attackerUuid: allocData.attackerUuid,
            defenderUuid: allocData.defenderUuid,
            weaponId: allocData.weaponId,
            beastItemId: allocData.beastItemId ?? null,
            hits, location,
            damage1, damage2, damage3,
            netSuccesses, affordableBeastActions,
            isBeastAttack: isCreatureAttacker && !allocData.weaponId,
            applied: false, beastActionsApplied: false
          }
        }
      },
      speaker: { alias: "⚔" },
      rollMode
    });
  }

  /**
   * Create the handler chat card and set the actor flag on the defender.
   * @private
   */
  static async _createHandlerCard(rawResult, attacker, weapon, targetUuid, mode) {
    const targetDoc = fromUuidSync(targetUuid);
    const targetActor = targetDoc?.actor ?? targetDoc;
    if (!targetActor) {
      ui.notifications.warn("Target actor not found.");
      return;
    }

    // ── Cancel any stale pendings where this attacker already has an open attack ──
    await MeleeOpposedChat._cancelStalePendingsByAttacker(attacker.uuid);

    const attackDice = (rawResult.modifiedResults || []).map((r, i) => ({
      label: `D${i + 1}`,
      value: r.original,
      modified: r.modified,
      isSuccess: r.isSuccess,
      isNat1: r.isNat1,
      isNat20: r.isNat20
    }));
    const attackerSuccesses = rawResult.successPoints
      ?? attackDice.filter(d => d.isSuccess).length;

    if (rawResult.isGradCios && attackerSuccesses === 0) {
      const rollMode = rawResult.rollMode ?? game.settings.get("core", "rollMode");
      const missContent = await foundry.applications.handlebars.renderTemplate(
        "systems/neuroshima/templates/chat/melee-hail-card.hbs",
        { isMiss: true, attackerName: attacker.name }
      );
      await ChatMessage.create({ content: missContent, speaker: { alias: "⚔" }, rollMode });
      return;
    }

    // Collect defender's melee weapons for the chat buttons (WFRP style)
    const defenderWeapons = targetActor.items
      .filter(i => i.type === "weapon" && i.system.weaponType === "melee")
      .map(i => ({ id: i.id, name: i.name, img: i.img }));

    const templateData = {
      mode,
      modeLabel: game.i18n.localize(`NEUROSHIMA.MeleeOpposedChat.Mode.${mode}`),
      attackerName: attacker.name,
      attackerImg: attacker.img,
      weaponName: weapon.name,
      damage1: weapon.system.damageMelee1,
      damage2: weapon.system.damageMelee2,
      damage3: weapon.system.damageMelee3,
      attackDice,
      attackerTarget: rawResult.target,
      attackerSuccesses,
      defenderName: targetActor.name,
      defenderImg: targetActor.img,
      defenderWeapons,
      status: "pending"
    };

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-pending.hbs",
      templateData
    );

    const rollMode = rawResult.rollMode ?? game.settings.get("core", "rollMode");
    const chatMsg = await ChatMessage.create({
      content,
      flags: {
        neuroshima: {
          opposedChat: {
            mode,
            status: "pending",
            attackerUuid: attacker.uuid,
            attackerTokenUuid: attacker.token?.uuid ?? null,
            defenderUuid: targetActor.uuid,
            defenderTokenUuid: targetDoc?.uuid ?? null,
            weaponId: weapon.id,
            beastItemId: weapon.beastItemId ?? null,
            attackRaw: rawResult.results,
            attackModified: attackDice.map(d => ({
              original: d.value,
              modified: d.modified,
              isSuccess: d.isSuccess
            })),
            attackTarget: rawResult.target,
            attackSuccesses: attackerSuccesses,
            attackerSkillBudget: rawResult.skill ?? 0,
            damage1: weapon.system.damageMelee1,
            damage2: weapon.system.damageMelee2,
            damage3: weapon.system.damageMelee3,
            isGradCios: rawResult.isGradCios || false,
            szachistaYield: !!(await attacker.getFlag("neuroshima", "_szachistaYield")),
            activatedMeleePreRollMods: rawResult.activatedMeleePreRollMods ?? []
          }
        }
      },
      speaker: { alias: "⚔" },
      rollMode
    });

    await attacker.unsetFlag("neuroshima", "_szachistaYield");

    if (!chatMsg) return;

    // ── Register in meleePendings FIRST (actor-sheet combat tab pending card) ──
    // Must be set before actor flag so the sheet re-render triggered by the flag
    // already finds the pending data.
    const combat = game.combat;
    if (combat) {
      const defenderUuid = targetActor.uuid;
      const pendingKey = defenderUuid.replace(/\./g, "-");
      const pendingData = {
        id: defenderUuid,
        attackerId: attacker.uuid,
        attackerTokenUuid: attacker.token?.uuid ?? null,
        defenderId: defenderUuid,
        defenderTokenUuid: targetDoc?.uuid ?? null,
        attackerName: attacker.name,
        defenderName: targetActor.name,
        mode,
        opposedChatMessageId: chatMsg.id,
        attackerInitiative: attackerSuccesses,
        weaponId: weapon.id,
        active: true,
        timestamp: Date.now()
      };
      const pendings = foundry.utils.deepClone(
        combat.getFlag("neuroshima", "meleePendings") || {}
      );
      pendings[pendingKey] = pendingData;
      if (game.user.isGM || !game.neuroshima?.socket) {
        await combat.setFlag("neuroshima", "meleePendings", pendings);
      } else {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", "meleePendings", pendings);
      }
      ui.combat?.render(true);
    }

    // ── Set actor flag on defender SECOND (WFRP: flags.oppose) ───────────
    // Setting this last ensures the meleePendings combat flag is already written
    // before the actor's sheet re-renders in response to the flag change.
    await MeleeOpposedChat._setDefenderFlag(targetActor.uuid, chatMsg.id);
  }

  /**
   * Cancel all still-pending attacks where `attackerUuid` is the attacker.
   * Called before registering a new attack so stale pendings don't accumulate.
   * @private
   */
  static async _cancelStalePendingsByAttacker(attackerUuid) {
    const combat = game.combat;
    const stalePendings = [];

    if (combat) {
      const pendings = combat.getFlag("neuroshima", "meleePendings") || {};
      for (const [key, p] of Object.entries(pendings)) {
        if (!p.active) continue;
        const sameAttacker = game.neuroshima?.NeuroshimaMeleeCombat?.isSameActor?.(p.attackerId, attackerUuid)
          ?? (p.attackerId === attackerUuid);
        if (sameAttacker) stalePendings.push({ key, pending: p });
      }
    } else {
      // No combat — scan all actors for oppose flags pointing to pending messages from this attacker
      for (const actor of game.actors) {
        const oppFlag = actor.getFlag("neuroshima", "oppose");
        if (!oppFlag?.messageId) continue;
        const msg = game.messages.get(oppFlag.messageId);
        const chatData = msg?.getFlag("neuroshima", "opposedChat");
        if (!chatData || chatData.status !== "pending") continue;
        const sameAttacker = game.neuroshima?.NeuroshimaMeleeCombat?.isSameActor?.(chatData.attackerUuid, attackerUuid)
          ?? (chatData.attackerUuid === attackerUuid);
        if (sameAttacker) stalePendings.push({ key: null, pending: { defenderId: actor.uuid, opposedChatMessageId: oppFlag.messageId } });
      }
    }

    for (const { key, pending } of stalePendings) {
      // Mark handler message as cancelled
      if (pending.opposedChatMessageId) {
        const msg = game.messages.get(pending.opposedChatMessageId);
        const chatData = msg?.getFlag("neuroshima", "opposedChat");
        if (chatData?.status === "pending") {
          await MeleeOpposedChat._setChatFlag(msg, "opposedChat", { ...chatData, status: "cancelled" });
        }
      }
      // Unset defender actor flag
      if (pending.defenderId) {
        await MeleeOpposedChat._unsetDefenderFlag(pending.defenderId);
      }
      // Remove from combat flag
      if (key && combat) {
        await combat.unsetFlag("neuroshima", `meleePendings.${key}`);
      }
    }

    if (stalePendings.length > 0) ui.combat?.render(true);
  }

  /** Update a chat message flag via socket if the caller is not the GM. @private */
  static async _setChatFlag(message, key, value) {
    if (!message) return;
    if (game.user.isGM || !game.neuroshima?.socket) {
      return message.setFlag("neuroshima", key, value);
    }
    return game.neuroshima.socket.executeAsGM("setChatMessageFlag", message.id, "neuroshima", key, value);
  }

  /** Update chat message content via socket if the caller is not the GM. @private */
  static async _updateChatContent(message, content) {
    if (!message) return;
    if (game.user.isGM || !game.neuroshima?.socket) {
      return message.update({ content });
    }
    return game.neuroshima.socket.executeAsGM("updateChatMessageContent", message.id, content);
  }

  /** Set flags.neuroshima.oppose on the defender's actor via socket if needed. @private */
  static async _setDefenderFlag(defenderUuid, messageId) {
    const defenderDoc = fromUuidSync(defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    if (!defenderActor) return;

    const value = { messageId };
    if (defenderActor.isOwner || game.user.isGM) {
      await defenderActor.setFlag("neuroshima", "oppose", value);
    } else if (game.neuroshima?.socket) {
      await game.neuroshima.socket.executeAsGM("setActorFlag", defenderUuid, "neuroshima", "oppose", value);
    }
  }

  /** Remove flags.neuroshima.oppose from the defender's actor. @private */
  static async _unsetDefenderFlag(defenderUuid) {
    const defenderDoc = fromUuidSync(defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    if (!defenderActor) return;

    if (defenderActor.isOwner || game.user.isGM) {
      await defenderActor.unsetFlag("neuroshima", "oppose");
    } else if (game.neuroshima?.socket) {
      await game.neuroshima.socket.executeAsGM("unsetActorFlag", defenderUuid, "neuroshima", "oppose");
    }
  }

  /** Remove the pending entry from meleePendings after resolution. @private */
  static async _removePending(pendingId) {
    const combat = game.combat;
    if (!combat) return;
    const pendingKey = pendingId.replace(/\./g, "-");
    const pendings = foundry.utils.deepClone(
      combat.getFlag("neuroshima", "meleePendings") || {}
    );
    if (pendings[pendingKey]) {
      pendings[pendingKey].active = false;
    }
    delete pendings[pendingKey];
    if (game.user.isGM || !game.neuroshima?.socket) {
      await combat.setFlag("neuroshima", "meleePendings", pendings);
    } else {
      await game.neuroshima.socket.executeAsGM("updateCombatFlag", "meleePendings", pendings);
    }
    ui.combat?.render(true);
  }

  /**
   * Apply damage stored in an opposed result card's flags.
   * Called when the GM clicks the "Apply Damage" button on the result card.
   */
  static async applyOpposedDamage(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const rd = message.getFlag("neuroshima", "opposedResult");
    if (!rd) return;
    if (rd.applied) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyApplied"));
      return;
    }
    if (!rd.hits || rd.hits.length === 0) {
      ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.NoHits"));
      return;
    }

    if (rd.isBeastAttack) {
      const queue = rd.pendingBeastQueue ?? [];
      if (queue.length > 0) {
        await MeleeOpposedChat.applyBeastActions(messageId, queue);
        const refreshed = message.getFlag("neuroshima", "opposedResult");
        await message.setFlag("neuroshima", "opposedResult", { ...refreshed, applied: true });
      } else {
        await message.setFlag("neuroshima", "opposedResult", { ...rd, applied: true });
      }
      return;
    }

    const defenderDoc = await fromUuid(rd.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    const attackerDoc  = await fromUuid(rd.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    if (!defenderActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    const { CombatHelper } = await import("../helpers/combat-helper.js");
    const weaponItem = attackerActor?.items?.get(rd.weaponId);

    const allResults = [];
    const allWoundIds = [];
    let totalReduced = 0;
    const allReducedDetails = [];

    for (const hit of rd.hits) {
      let targetActor = defenderActor;
      if (hit.isBackHit && rd.escapeeUuid) {
        const escapeeDoc = await fromUuid(rd.escapeeUuid);
        const escapeeActor = escapeeDoc?.actor ?? escapeeDoc;
        if (escapeeActor) targetActor = escapeeActor;
      }
      // Sztuczki gracza mają stały typ obrażeń niezależny od profilu broni.
      // Aby applyDamageToActor wybrał właściwy typ, nadpisujemy wszystkie trzy
      // pola damageMelee wartością z sztuczki — tier zostanie obliczony z hit.tier
      // i dla każdej wartości indeksu zwróci tę samą cyfrę.
      const isTrickHit = !!hit.trickId;

      // onHitScript — jeśli sztuczka ma zdefiniowany skrypt zamiast obrażeń (np. rozbrojenie Aramis),
      // uruchamiamy go zamiast applyDamageToActor. Skrypt dostaje pełny kontekst walki.
      // args: { actor (atakujący), target (broniony), state (stan pojedynku), hit (dane trafienia) }
      if (isTrickHit && rd.trickOnHitScripts?.[hit.trickId]) {
        try {
          const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
          const onHitCode = rd.trickOnHitScripts[hit.trickId];
          const scriptObj = new NeuroshimaScript({ code: onHitCode, trigger: "getMeleeActions", label: "onHitScript" }, null);
          await scriptObj.execute({
            actor:  attackerActor,
            target: targetActor,
            state:  rd,
            hit
          });
          game.neuroshima?.log?.("[applyDuelBatch] onHitScript executed for trick", hit.trickId);
        } catch (err) {
          game.neuroshima?.log?.("[applyDuelBatch] onHitScript error for trick", hit.trickId, err);
        }
        continue;
      }

      const attackData = {
        isMelee: true,
        actorId: attackerActor?.id,
        weaponId: rd.weaponId,
        label: weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
        damageMelee1: isTrickHit ? hit.damageType : rd.damage1,
        damageMelee2: isTrickHit ? hit.damageType : rd.damage2,
        damageMelee3: isTrickHit ? hit.damageType : rd.damage3,
        finalLocation: rd.location,
        successPoints: hit.tier
      };
      const batch = await CombatHelper.applyDamageToActor(targetActor, attackData, {
        isOpposed: true,
        spDifference: hit.tier,
        location: rd.location,
        suppressChat: true
      });
      if (batch) {
        allResults.push(...(batch.results ?? []));
        allWoundIds.push(...(batch.woundIds ?? []));
        totalReduced += batch.reducedProjectiles ?? 0;
        allReducedDetails.push(...(batch.reducedDetails ?? []));
      }
    }

    // Sztuczki gracza z kolejki (successCost) — niezależne od wyniku porównania kości,
    // opłacone sukcesami jeszcze przed rozstrzygnięciem walki. Format: "trick:ID:damage".
    if (rd.pendingTrickQueue?.length > 0) {
      for (const trickEntry of rd.pendingTrickQueue) {
        if (!trickEntry.startsWith("trick:")) continue;
        const parts = trickEntry.split(":");
        const trickDamage = parts[2];
        if (!trickDamage) continue;
        const trickAttackData = {
          isMelee: true,
          actorId: attackerActor?.id,
          label: `${weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed")} (sztuczka)`,
          damageMelee1: trickDamage,
          damageMelee2: trickDamage,
          damageMelee3: trickDamage,
          finalLocation: rd.location,
          successPoints: 1
        };
        const trickBatch = await CombatHelper.applyDamageToActor(defenderActor, trickAttackData, {
          isOpposed: true,
          spDifference: 1,
          location: rd.location,
          suppressChat: true
        });
        if (trickBatch) {
          allResults.push(...(trickBatch.results ?? []));
          allWoundIds.push(...(trickBatch.woundIds ?? []));
          totalReduced += trickBatch.reducedProjectiles ?? 0;
          allReducedDetails.push(...(trickBatch.reducedDetails ?? []));
        }
      }
    }

    if (allWoundIds.length > 0) {
      ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageApplied", {
        count: allWoundIds.length, name: defenderActor.name
      }));
    }
    if (allResults.length > 0 || totalReduced > 0 || allWoundIds.length > 0) {
      await CombatHelper.renderPainResistanceReport(
        defenderActor, allResults, allWoundIds, totalReduced, allReducedDetails
      );
    }

    if (attackerActor?.type === "creature") {
      const beastItemFilter = rd.beastItemId ?? null;
      const beastItems = attackerActor.items.filter(i =>
        i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter)
      );
      for (const beastItem of beastItems) {
        for (const activity of (beastItem.system.activities ?? [])) {
          const linkedEffectIds = new Set(activity.effectIds ?? []);
          for (const effect of beastItem.effects) {
            if (!linkedEffectIds.has(effect.id)) continue;
            try {
              const { _id, ...rest } = effect.toObject();
              await ActiveEffect.implementation.create(
                { ...rest, disabled: false, transfer: false, origin: beastItem.uuid },
                { parent: defenderActor }
              );
            } catch (err) {
              console.error("Neuroshima | Failed to auto-apply beast effect:", err);
            }
          }
        }
      }
    }

    await message.setFlag("neuroshima", "opposedResult", { ...rd, applied: true });
  }

  static async _createPendingHailCard(rawResult, attacker, weapon, targetActor, targetDoc, attackDice, attackerSuccesses) {
    const toChip = d => ({ value: d.modified ?? d.value, isSuccess: d.isSuccess, isNat20: d.isNat20 ?? false });
    const rollMode = rawResult.rollMode ?? game.settings.get("core", "rollMode");

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-hail-card.hbs",
      {
        attackerName: attacker.name,
        attackerImg:  attacker.img,
        defenderName: targetActor.name,
        defenderImg:  targetActor.img,
        attackDiceChips: attackDice.map(toChip),
        attackSuccesses,
        isPending: true,
        isDone:    false,
        defenderActorUuid: targetActor.uuid,
        defenseRequiredLabel: game.i18n.format("NEUROSHIMA.GradCios.DefenseRequired", { n: attackerSuccesses })
      }
    );

    const chatMsg = await ChatMessage.create({
      content,
      flags: {
        neuroshima: {
          hailCard: {
            status:    "pending",
            attackerUuid: attacker.uuid,
            defenderUuid: targetActor.uuid,
            weaponId:     weapon.id,
            attackModified: attackDice.map(d => ({
              original:  d.value,
              modified:  d.modified,
              isSuccess: d.isSuccess,
              isNat20:   d.isNat20 ?? false
            })),
            attackerSuccesses,
            damage1: weapon.system.damageMelee1,
            damage2: weapon.system.damageMelee2,
            damage3: weapon.system.damageMelee3
          }
        }
      },
      speaker: { alias: "⚔" },
      rollMode
    });

    if (!chatMsg) return;

    const combat = game.combat;
    if (combat) {
      const defenderUuid = targetActor.uuid;
      const pendingKey   = defenderUuid.replace(/\./g, "-");
      const pendingData  = {
        id:               defenderUuid,
        attackerId:       attacker.uuid,
        attackerTokenUuid: attacker.token?.uuid ?? null,
        defenderId:       defenderUuid,
        defenderTokenUuid: targetDoc?.uuid ?? null,
        attackerName:     attacker.name,
        defenderName:     targetActor.name,
        mode:             "hail",
        opposedChatMessageId: chatMsg.id,
        attackerInitiative:   attackerSuccesses,
        weaponId:         weapon.id,
        active:           true,
        timestamp:        Date.now()
      };
      const pendings = foundry.utils.deepClone(combat.getFlag("neuroshima", "meleePendings") || {});
      pendings[pendingKey] = pendingData;
      if (game.user.isGM || !game.neuroshima?.socket) {
        await combat.setFlag("neuroshima", "meleePendings", pendings);
      } else {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", "meleePendings", pendings);
      }
      ui.combat?.render(true);
    }

    await MeleeOpposedChat._setDefenderFlag(targetActor.uuid, chatMsg.id);
  }

  static async hailDefendFromChat(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const hailCard = message.getFlag("neuroshima", "hailCard");
    if (!hailCard || hailCard.status !== "pending") {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyResolved"));
      return;
    }

    const defenderDoc   = fromUuidSync(hailCard.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    if (!defenderActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    if (!defenderActor.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.NotYourTurn"));
      return;
    }

    let defWeapon = defenderActor.items.find(
      i => i.type === "weapon" && i.system.weaponType === "melee" && i.system.equipped
    ) ?? defenderActor.items.find(i => i.type === "weapon" && i.system.weaponType === "melee");

    if (!defWeapon) {
      defWeapon = {
        id: null,
        name: game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.Unarmed"),
        img:  "systems/neuroshima/assets/img/weapon-melee.svg",
        type: "weapon",
        system: {
          weaponType: "melee", attribute: "dexterity", skill: "brawl",
          attackBonus: 0, defenseBonus: 0,
          damageMelee1: "D", damageMelee2: "L", damageMelee3: "C",
          requiredBuild: 0, piercing: 0, magazine: null, jamming: 20
        }
      };
    }

    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");
    const lastRoll = defenderActor.system.lastWeaponRoll ?? {};

    const dialog = new NeuroshimaWeaponRollDialog({
      actor:       defenderActor,
      weapon:      defWeapon,
      rollType:    "melee",
      meleeAction: "defense",
      targets:     [hailCard.attackerUuid],
      lastRoll,
      isPoolRoll:  true,
      onRoll: async (defenseResult) => {
        if (!defenseResult) return;
        const { NeuroshimaSocket: _NSHailDef } = await import("../helpers/socket-helper.js");
        const { MeleeTurnService: _MTSHailDef } = await import("./melee-turn-service.js");
        const defenderUuid = defenderActor.token?.uuid ?? defenderActor.uuid;
        const condKey = _MTSHailDef._MANEUVER_TO_CONDITION[defenseResult.maneuver] || null;
        const tempoLevel = defenseResult.tempoLevel || 0;
        game.neuroshima?.log("[melee-opposed-chat.hailCard.onRoll] applying conditions", { defenderUuid, condKey, tempoLevel, attackerUuid: hailCard.attackerUuid });
        await _NSHailDef.gmExecute("syncActorManeuverConditions", defenderUuid, condKey, false, tempoLevel);
        if (tempoLevel > 0) {
          await _NSHailDef.gmExecute("syncActorManeuverConditions", hailCard.attackerUuid, null, false, tempoLevel);
        }
        await MeleeOpposedChat._resolveHailCard(message, hailCard, defenderActor, defenseResult);
      },
      onClose: () => {}
    });

    await dialog.render(true);
  }

  static async _resolveHailCard(message, hailCard, defenderActor, defenseResult) {
    await MeleeOpposedChat._setChatFlag(message, "hailCard", { ...hailCard, status: "resolved" });

    const { NeuroshimaSocket: _NSHailResolve } = await import("../helpers/socket-helper.js");
    const defenderUuid = defenderActor.token?.uuid ?? defenderActor.uuid;
    game.neuroshima?.log("[melee-opposed-chat._resolveHailCard] clearing maneuver conditions", { attacker: hailCard.attackerUuid, defender: defenderUuid });
    await _NSHailResolve.gmExecute("clearActorManeuverConditions", hailCard.attackerUuid);
    await _NSHailResolve.gmExecute("clearActorManeuverConditions", defenderUuid);

    const attackDice  = hailCard.attackModified;
    const defenseDice = (defenseResult.modifiedResults || []).map(r => ({
      original:  r.original,
      modified:  r.modified,
      isSuccess: r.isSuccess,
      isNat20:   r.isNat20 ?? false
    }));

    const atkSuccessCount = attackDice.filter(d => d.isSuccess).length;
    const defSuccessCount = defenseDice.filter(d => d.isSuccess).length;
    const netSuccesses    = atkSuccessCount - defSuccessCount;

    const toChip = d => ({ value: d.modified ?? d.original, isSuccess: d.isSuccess, isNat20: d.isNat20 ?? false });

    const attackerDoc   = fromUuidSync(hailCard.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;

    let updatedContent;
    let hailResult = null;

    if (netSuccesses > 0) {
      const tier     = Math.min(netSuccesses, 3);
      const damage   = hailCard[`damage${tier}`] ?? hailCard.damage1 ?? "?";
      const locationRoll = attackDice[0]?.original ?? 10;
      const location = MeleeOpposedChat._getLocationFromRoll(locationRoll);
      const outcomeLabel = game.i18n.format("NEUROSHIMA.GradCios.Hit", { n: tier, dmg: damage });

      hailResult = {
        attackerUuid: hailCard.attackerUuid,
        defenderUuid: hailCard.defenderUuid,
        weaponId:     hailCard.weaponId,
        tier,
        damage1:  hailCard.damage1,
        damage2:  hailCard.damage2,
        damage3:  hailCard.damage3,
        location,
        applied:  false
      };

      updatedContent = await foundry.applications.handlebars.renderTemplate(
        "systems/neuroshima/templates/chat/melee-hail-card.hbs",
        {
          attackerName:    attackerActor?.name ?? "",
          attackerImg:     attackerActor?.img  ?? "",
          defenderName:    defenderActor.name,
          defenderImg:     defenderActor.img,
          attackDiceChips: attackDice.map(toChip),
          attackSuccesses: atkSuccessCount,
          isPending:       false,
          isDone:          true,
          defenseDiceChips: defenseDice.map(toChip),
          isBlocked:       false,
          hasHit:          true,
          outcomeLabel
        }
      );
    } else {
      const outcomeLabel = netSuccesses === 0
        ? game.i18n.localize("NEUROSHIMA.GradCios.EqualSuccessesBlock")
        : game.i18n.localize("NEUROSHIMA.GradCios.Blocked");

      updatedContent = await foundry.applications.handlebars.renderTemplate(
        "systems/neuroshima/templates/chat/melee-hail-card.hbs",
        {
          attackerName:    attackerActor?.name ?? "",
          attackerImg:     attackerActor?.img  ?? "",
          defenderName:    defenderActor.name,
          defenderImg:     defenderActor.img,
          attackDiceChips: attackDice.map(toChip),
          attackSuccesses: atkSuccessCount,
          isPending:       false,
          isDone:          true,
          defenseDiceChips: defenseDice.map(toChip),
          isBlocked:       true,
          hasHit:          false,
          outcomeLabel
        }
      );
    }

    if (hailResult) {
      await MeleeOpposedChat._setChatFlag(message, "hailResult", hailResult);
    }
    await MeleeOpposedChat._updateChatContent(message, updatedContent);

    await MeleeOpposedChat._removePending(hailCard.defenderUuid);
    await MeleeOpposedChat._unsetDefenderFlag(hailCard.defenderUuid);
    defenderActor?.sheet?.render();
    attackerActor?.sheet?.render();
  }

  static async applyHailDamage(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const hr = message.getFlag("neuroshima", "hailResult");
    if (!hr) return;
    if (hr.applied) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.AlreadyApplied"));
      return;
    }

    const defenderDoc = await fromUuid(hr.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    const attackerDoc  = await fromUuid(hr.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    if (!defenderActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    const { CombatHelper } = await import("../helpers/combat-helper.js");
    const weaponItem = attackerActor?.items?.get(hr.weaponId);

    const attackData = {
      isMelee:      true,
      actorId:      attackerActor?.id,
      weaponId:     hr.weaponId,
      label:        weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
      damageMelee1: hr.damage1,
      damageMelee2: hr.damage2,
      damageMelee3: hr.damage3,
      finalLocation: hr.location,
      successPoints: hr.tier
    };
    const batch = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
      isOpposed:    true,
      spDifference: hr.tier,
      location:     hr.location,
      suppressChat: true
    });

    if (batch) {
      const woundIds = batch.woundIds ?? [];
      if (woundIds.length > 0) {
        ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageApplied", {
          count: woundIds.length, name: defenderActor.name
        }));
      }
      const allResults = batch.results ?? [];
      const totalReduced = batch.reducedProjectiles ?? 0;
      const allReducedDetails = batch.reducedDetails ?? [];
      if (allResults.length > 0 || totalReduced > 0 || woundIds.length > 0) {
        await CombatHelper.renderPainResistanceReport(
          defenderActor, allResults, woundIds, totalReduced, allReducedDetails
        );
      }
    }

    await message.setFlag("neuroshima", "hailResult", { ...hr, applied: true });
  }

  /**
   * Apply selected beast actions from the resolve card.
   * Called when the GM clicks "Zastosuj akcje bestii" on the result card.
   *
   * For activities with `testRequired === true`: posts a Required Test chat card whispered
   * to the defender's owning player(s) and all GMs (`whisperToDefender: true`).
   * For activities without `testRequired`: creates the linked ActiveEffects on the defender
   * immediately.
   *
   * @param {string}   messageId
   * @param {string[]} selectedActionIds   Item IDs of chosen beast actions (may repeat)
   */
  static async applyBeastActions(messageId, selectedActionIds) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const rd = message.getFlag("neuroshima", "opposedResult");
    if (!rd) return;
    if (rd.beastActionsApplied) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.BeastAction.AlreadyApplied"));
      return;
    }

    const defenderDoc = await fromUuid(rd.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc;
    const attackerDoc  = await fromUuid(rd.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    if (!defenderActor || !attackerActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DefenderNotFound"));
      return;
    }

    const { CombatHelper } = await import("../helpers/combat-helper.js");
    const location = rd.location ?? "torso";

    const beastItemFilter = rd.beastItemId ?? null;
    const beastItemsForEffects = attackerActor.items.filter(i =>
      i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter)
    );
    const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
    for (const beastItem of beastItemsForEffects) {
      for (const activity of (beastItem.system.activities ?? [])) {
        if (activity.testRequired) {
          const resolveUuids = (ids = []) =>
            ids.map(id => beastItem.effects.get(id)).filter(Boolean).map(e => e.uuid);
          game.neuroshima?.log("[MeleeOpposedChat._applySelectedActions] posting required test for beast activity", { activityName: activity.name, testType: activity.testType, testKey: activity.testKey, defenderName: defenderActor?.name, defenderUuid: defenderActor?.uuid });
          await NeuroshimaScriptRunner.postRequiredTest({
            title:                 activity.name || beastItem.name,
            testType:              activity.testType             || "attribute",
            testKey:               activity.testKey              || "constitution",
            testAttributeOverride: activity.testAttributeOverride || "",
            requiredSuccesses:     activity.testSuccesses        ?? 1,
            isOpen:                activity.testIsOpen           ?? false,
            baseDifficulty:        activity.testDifficulty       || "average",
            defenderActorUuid:     defenderActor?.uuid ?? "",
            whisperToDefender:     true,
            onSuccessEffectUuids:  resolveUuids(activity.effectIds),
            onFailureEffectUuids:  resolveUuids(activity.onFailureEffectIds)
          });
          continue;
        }
        const linkedEffectIds = new Set(activity.effectIds ?? []);
        for (const effect of beastItem.effects) {
          if (!linkedEffectIds.has(effect.id)) continue;
          try {
            const { _id, ...rest } = effect.toObject();
            await ActiveEffect.implementation.create(
              { ...rest, disabled: false, transfer: false, origin: beastItem.uuid },
              { parent: defenderActor }
            );
          } catch (err) {
            console.error("Neuroshima | Failed to auto-apply beast effect:", err);
          }
        }
      }
    }

    const spentPerAction = {};
    let totalSpent = 0;
    for (const actionId of selectedActionIds) {
      spentPerAction[actionId] = (spentPerAction[actionId] ?? 0) + 1;
    }

    const allWoundIds = [];
    const allResults  = [];
    let totalReduced  = 0;
    const allReducedDetails = [];
    const appliedNames = [];

    for (const [compositeId, count] of Object.entries(spentPerAction)) {
      const [itemId, activityId] = compositeId.split("::");
      const actionItem = attackerActor.items.get(itemId);
      if (!actionItem) continue;
      const activity = (actionItem.system.activities ?? []).find(a => a.id === activityId);
      if (!activity) continue;
      const cost   = activity.successCost ?? 1;
      const damage = activity.damage || null;
      const label  = activity.name || actionItem.name;

      totalSpent += cost * count;
      appliedNames.push(...Array(count).fill(label));

      for (let n = 0; n < count; n++) {
        if (damage) {
          const freshDefDoc = await fromUuid(rd.defenderUuid);
          const freshDefender = freshDefDoc?.actor ?? freshDefDoc;
          if (!freshDefender) continue;
          const attackData = {
            isMelee: true,
            actorId: attackerActor.id,
            label,
            damageMelee1: damage,
            damageMelee2: damage,
            damageMelee3: damage,
            finalLocation: location,
            successPoints: 1
          };
          const batch = await CombatHelper.applyDamageToActor(freshDefender, attackData, {
            isOpposed: true, spDifference: 1, location, suppressChat: true
          });
          if (batch) {
            allResults.push(...(batch.results ?? []));
            allWoundIds.push(...(batch.woundIds ?? []));
            totalReduced += batch.reducedProjectiles ?? 0;
            allReducedDetails.push(...(batch.reducedDetails ?? []));
          }
        }
      }
    }

    // Apply remaining pip-wins or success-points as normal weapon damage.
    // For beast attacks (synthetic weapon, no real weaponId) remaining successes are wasted —
    // all damage must be chosen explicitly through beast action spending.
    const remaining = rd.netSuccesses - totalSpent;
    if (remaining > 0 && !rd.isBeastAttack) {
      if (rd.mode === "opposedPips") {
        // opposedPips: hits are sorted ascending by tier (done in resolveOpposed).
        // Beast actions consumed the first `totalSpent` pips (lowest tiers).
        // The remaining hits keep their own tier-specific damageType.
        const sortedHits = [...(rd.hits ?? [])].sort((a, b) => a.tier - b.tier);
        const remainingHits = sortedHits.slice(totalSpent);
        for (const hit of remainingHits) {
          if (!hit.damageType) continue;
          const attackData = {
            isMelee: true,
            actorId: attackerActor.id,
            label: attackerActor.items.get(rd.weaponId)?.name ?? "—",
            damageMelee1: hit.damageType,
            damageMelee2: hit.damageType,
            damageMelee3: hit.damageType,
            finalLocation: location,
            successPoints: 1
          };
          const batch = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
            isOpposed: true, spDifference: 1, location, suppressChat: true
          });
          if (batch) {
            allResults.push(...(batch.results ?? []));
            allWoundIds.push(...(batch.woundIds ?? []));
            totalReduced += batch.reducedProjectiles ?? 0;
            allReducedDetails.push(...(batch.reducedDetails ?? []));
          }
        }
      } else {
        // opposedSuccesses: remaining net successes map to a single damage tier.
        const remainingTier = Math.min(3, remaining);
        const damageType = rd[`damage${remainingTier}`];
        if (damageType) {
          const attackData = {
            isMelee: true,
            actorId: attackerActor.id,
            label: attackerActor.items.get(rd.weaponId)?.name ?? "—",
            damageMelee1: rd.damage1,
            damageMelee2: rd.damage2,
            damageMelee3: rd.damage3,
            finalLocation: location,
            successPoints: remainingTier
          };
          const batch = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
            isOpposed: true, spDifference: remainingTier, location, suppressChat: true
          });
          if (batch) {
            allResults.push(...(batch.results ?? []));
            allWoundIds.push(...(batch.woundIds ?? []));
            totalReduced += batch.reducedProjectiles ?? 0;
            allReducedDetails.push(...(batch.reducedDetails ?? []));
          }
        }
      }
    }

    if (allWoundIds.length > 0 || appliedNames.length > 0) {
      ui.notifications.info(
        `${defenderActor.name}: ${appliedNames.join(", ")}` +
        (allWoundIds.length > 0 ? ` (+${allWoundIds.length} rana/y)` : "")
      );
    }
    if (allResults.length > 0 || totalReduced > 0 || allWoundIds.length > 0) {
      await CombatHelper.renderPainResistanceReport(
        defenderActor, allResults, allWoundIds, totalReduced, allReducedDetails
      );
    }

    await message.setFlag("neuroshima", "opposedResult", { ...rd, beastActionsApplied: true });
  }

  /** Map first attack die roll to a body location. @private */
  static _getLocationFromRoll(roll) {
    if (roll <= 2)  return "head";
    if (roll <= 4)  return "rightArm";
    if (roll <= 6)  return "leftArm";
    if (roll <= 15) return "torso";
    if (roll <= 17) return "rightLeg";
    return "leftLeg";
  }
}
