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
    const initiativeOwnerSide = "attacker";
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
      applied: false
    };

    const context = MeleeOpposedChat._buildDuelContext(state, attackerActor, defenderActor);
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

  static _buildDuelContext(state, attackerActor, defenderActor) {
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
      ownerDeclaredAttack, ownerDeclaredExit, ownerDeclaredNonCombat,
      responderConfirmActionType, responderConfirmLabel, responderExactDice,
      ownerIsCreature, ownerBeastActions, committedSuccessCount
    };
  }

  static async _renderDuelCard(message, state) {
    const attackerDoc = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc ?? null;
    const defenderDoc = fromUuidSync(state.defenderUuid);
    const defenderActor = defenderDoc?.actor ?? defenderDoc ?? null;

    const context = MeleeOpposedChat._buildDuelContext(state, attackerActor, defenderActor);
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

        if (game.user.isGM) {
          await MeleeOpposedChat.applyDuelBatch(message.id, pool, indices, actionType);
        } else if (game.neuroshima?.socket) {
          await game.neuroshima.socket.executeAsGM("applyDuelBatch", message.id, pool, indices, actionType);
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

    updateActionButtons();
    updateBeastQueue();
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
      const declaredAction = action || "attack";
      const ownerDicePool  = isOwnerAttacker ? state.attackDice : state.defenseDice;
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
        if (!diceIndices.length || diceIndices.length > 3) return;
      }
      state.declaredAction        = declaredAction;
      state.committedOwnerIndices = diceIndices;
      state.committedBeastQueue   = (Array.isArray(beastQueue) && beastQueue.length > 0) ? beastQueue : null;
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

        if (declaredAction === "attack") {
          if      (ownerSuccessCount > responderSuccessCount)  outcome = "hit";
          else if (ownerSuccessCount < responderSuccessCount)  outcome = "takeover";
          else if (ownerSuccessCount > 0)                      outcome = "draw";
          else                                                  outcome = "nothing";

          if (outcome === "hit") state.hits.push({ tier: N, damageType: state[`damage${N}`] ?? "?" });

          segAttackVal  = isOwnerAttacker ? ownerSuccessCount    : responderSuccessCount;
          segDefenseVal = isOwnerAttacker ? responderSuccessCount : ownerSuccessCount;

          if (outcome === "takeover") state.initiativeOwnerSide = isOwnerAttacker ? "defender" : "attacker";

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
          applied: false,
          beastActionsApplied: false
        });
      }

      await MeleeOpposedChat._renderDuelCard(message, state);
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
            isGradCios: rawResult.isGradCios || false
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
        await MeleeOpposedChat._resolveHailCard(message, hailCard, defenderActor, defenseResult);
      },
      onClose: () => {}
    });

    await dialog.render(true);
  }

  static async _resolveHailCard(message, hailCard, defenderActor, defenseResult) {
    await MeleeOpposedChat._setChatFlag(message, "hailCard", { ...hailCard, status: "resolved" });

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
          await NeuroshimaScriptRunner.postRequiredTest({
            title:                 activity.name || beastItem.name,
            testType:              activity.testType             || "attribute",
            testKey:               activity.testKey              || "constitution",
            testAttributeOverride: activity.testAttributeOverride || "",
            requiredSuccesses:     activity.testSuccesses        ?? 1,
            isOpen:                activity.testIsOpen           ?? false,
            baseDifficulty:        activity.testDifficulty       || "average",
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
