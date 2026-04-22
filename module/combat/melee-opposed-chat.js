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
    const { NeuroshimaWeaponRollDialog } = await import("../apps/weapon-roll-dialog.js");

    const lastRoll = attacker.system.lastWeaponRoll ?? {};
    const dialog = new NeuroshimaWeaponRollDialog({
      actor: attacker,
      weapon,
      rollType: "melee",
      meleeAction: "attack",
      targets: [targetUuid],
      lastRoll,
      isPoolRoll: true,
      onRoll: async (rawResult) => {
        if (!rawResult) return;
        await MeleeOpposedChat._createHandlerCard(rawResult, attacker, weapon, targetUuid, mode);
      },
      onClose: () => {}
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

    const { NeuroshimaWeaponRollDialog } = await import("../apps/weapon-roll-dialog.js");
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
    await message.setFlag("neuroshima", "opposedChat", { ...data, status: "resolved" });

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
      for (let i = 0; i < Math.max(attackDice.length, defenseDice.length); i++) {
        const aDie = attackDice[i];
        const dDie = defenseDice[i];
        const aWins = aDie?.isSuccess && (!dDie?.isSuccess || aDie.modified < (dDie?.modified ?? Infinity));
        const dWins = dDie?.isSuccess && (!aDie?.isSuccess || dDie.modified < (aDie?.modified ?? Infinity));
        pairWinners[i] = { attackWon: aWins ?? false, defenseWon: dWins ?? false };
      }
    }

    const pairedDice = Array.from({ length: Math.max(attackDiceDisplay.length, defenseDiceDisplay.length) }, (_, i) => {
      const aDie = attackDiceDisplay[i] ?? null;
      const dDie = defenseDiceDisplay[i] ?? null;
      if (!aDie && !dDie) return null;
      const pw = pairWinners[i] ?? {};
      return { label: `D${i + 1}`, attack: aDie, defense: dDie, attackWon: pw.attackWon ?? false, defenseWon: pw.defenseWon ?? false };
    }).filter(Boolean);

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
      const beastActions = attackerActor.items.filter(
        i => i.type === "beast-action" && i.system.costType === "success"
      );
      for (const action of beastActions) {
        const cost = action.system.successCost ?? 1;
        if (cost <= netSuccesses) {
          const hasEffects = action.effects?.size > 0;
          affordableBeastActions.push({
            id: action.id,
            name: action.name,
            img: action.img,
            cost,
            damage: action.system.damage || null,
            hasEffects,
            actionType: action.system.actionType || ""
          });
        }
      }
      affordableBeastActions.sort((a, b) => b.cost - a.cost);
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
      hasBeastActions: affordableBeastActions.length > 0
    };

    const resContent = await renderTemplate(
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
            hits,
            location,
            damage1: data.damage1,
            damage2: data.damage2,
            damage3: data.damage3,
            netSuccesses,
            affordableBeastActions,
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
    const updatedContent = await renderTemplate(
      "systems/neuroshima/templates/chat/melee-opposed-pending.hbs",
      updatedTemplateData
    );
    await message.update({ content: updatedContent });

    // Remove from meleePendings FIRST so when unsetFlag triggers a sheet re-render
    // (via updateActor hook) the combat entry is already gone.
    await MeleeOpposedChat._removePending(pending.id ?? data.defenderUuid);

    // Then clear the actor flag — this triggers updateActor → sheet re-render
    await MeleeOpposedChat._unsetDefenderFlag(data.defenderUuid);

    // Force re-render both sheets — defender's flag unset may not trigger attacker's re-render
    defenderActor?.sheet?.render();
    attackerActor?.sheet?.render();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

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

    const content = await renderTemplate(
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
            attackRaw: rawResult.results,
            attackModified: attackDice.map(d => ({
              original: d.value,
              modified: d.modified,
              isSuccess: d.isSuccess
            })),
            attackTarget: rawResult.target,
            attackSuccesses: attackerSuccesses,
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
          await msg.setFlag("neuroshima", "opposedChat", { ...chatData, status: "cancelled" });
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
      const attackData = {
        isMelee: true,
        actorId: attackerActor?.id,
        weaponId: rd.weaponId,
        label: weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
        damageMelee1: rd.damage1,
        damageMelee2: rd.damage2,
        damageMelee3: rd.damage3,
        finalLocation: rd.location,
        successPoints: hit.tier
      };
      const batch = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
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

    await message.setFlag("neuroshima", "opposedResult", { ...rd, applied: true });
  }

  /**
   * Apply selected beast actions from the resolve card.
   * Called when the GM clicks "Zastosuj akcje bestii" on the result card.
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

    for (const [actionId, count] of Object.entries(spentPerAction)) {
      const actionItem = attackerActor.items.get(actionId);
      if (!actionItem) continue;
      const cost   = actionItem.system.successCost ?? 1;
      const damage = actionItem.system.damage || null;

      totalSpent += cost * count;
      appliedNames.push(...Array(count).fill(actionItem.name));

      for (let n = 0; n < count; n++) {
        // Apply damage wound if action deals one
        if (damage) {
          const attackData = {
            isMelee: true,
            actorId: attackerActor.id,
            label: actionItem.name,
            damageMelee1: damage,
            damageMelee2: damage,
            damageMelee3: damage,
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

        // Apply embedded active effects from the beast action
        if (actionItem.effects?.size > 0) {
          for (const effect of actionItem.effects) {
            const effectData = effect.convertToApplied ? effect.convertToApplied() : effect.toObject();
            await defenderActor.applyEffect({ effectData: [effectData] });
          }
        }
      }
    }

    // Apply remaining pip-wins or success-points as normal weapon damage
    const remaining = rd.netSuccesses - totalSpent;
    if (remaining > 0) {
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
