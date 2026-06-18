import { MeleeStore } from "./melee-store.js";
import { MeleeTurnService } from "./melee-turn-service.js";

const TEMPLATES = {
  pool:    "systems/neuroshima/templates/chat/melee-vanilla-pool.hbs",
  battle:  "systems/neuroshima/templates/chat/melee-vanilla-battle.hbs",
  result:  "systems/neuroshima/templates/chat/melee-vanilla-result.hbs"
};

export class MeleeVanillaChat {
  static FLAG_KEY = "vanillaCards";
  static _debouncedSync = null;

  // ── Hook Registration ───────────────────────────────────────────────────

  static registerHooks() {
    MeleeVanillaChat._debouncedSync = foundry.utils.debounce(async () => {
      if (!game.user.isGM) return;
      const mode = game.settings.get("neuroshima", "meleeCombatType") || "default";
      if (mode !== "default") return;
      if (game.combat) await MeleeVanillaChat._syncAll(game.combat);
    }, 300);

    Hooks.on("updateCombat", (combat, updates) => {
      if (!foundry.utils.hasProperty(updates, "flags.neuroshima.meleeEncounters")) return;
      MeleeVanillaChat._debouncedSync();
    });
  }

  // ── renderChatMessageHTML handler ──────────────────────────────────────

  static onRender(root, message) {
    const cardFlag = message.getFlag("neuroshima", "vanillaCard");
    if (!cardFlag) return;

    const { encounterId, type } = cardFlag;

    MeleeVanillaChat._applyOwnerVisibility(root);

    root.querySelectorAll("[data-mvc-action='rollPool']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeVanillaChat._doRollPool(btn, encounterId);
      });
    });

    if (type === "battle") {
      MeleeVanillaChat._bindBattleDiceToggles(root);
    }

    root.querySelectorAll("[data-mvc-action='confirmAttack']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeVanillaChat._doConfirmAttack(btn, encounterId, root);
      });
    });

    root.querySelectorAll("[data-mvc-action='confirmDefense']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeVanillaChat._doConfirmDefense(btn, encounterId, root);
      });
    });

    root.querySelectorAll("[data-mvc-action='acceptHit']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeVanillaChat._doAcceptHit(btn, encounterId);
      });
    });

    root.querySelectorAll("[data-mvc-action='performAction']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        const participantId = btn.dataset.participantId;
        await MeleeTurnService.performAction(encounterId, participantId);
      });
    });

    root.querySelectorAll("[data-mvc-action='confirmDamage']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        const { MeleeResolution } = await import("./melee-resolution.js");
        await MeleeResolution.confirmDamageDistribution(encounterId, parseInt(btn.dataset.optionIndex, 10));
      });
    });

    root.querySelectorAll("[data-mvc-action='endEncounter']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        const { MeleeEncounter } = await import("./melee-encounter.js");
        await MeleeEncounter.end(encounterId);
      });
    });

    root.querySelectorAll("[data-mvc-action='nextTurn']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await MeleeTurnService.startNewTurn(encounterId);
      });
    });
  }

  // ── Entry Point ─────────────────────────────────────────────────────────

  static async startTurn(encounterId) {
    if (!game.user.isGM) {
      if (game.neuroshima?.socket) {
        await game.neuroshima.socket.executeAsGM("postVanillaCard", "start", encounterId);
      }
      return;
    }
    await MeleeVanillaChat._syncEncounter(encounterId);
  }

  // ── Sync (GM only) ──────────────────────────────────────────────────────

  static async _syncAll(combat) {
    const encounters = combat.getFlag("neuroshima", "meleeEncounters") || {};
    for (const encounterId of Object.keys(encounters)) {
      await MeleeVanillaChat._syncEncounter(encounterId);
    }
  }

  static async _syncEncounter(encounterId) {
    const encounter = MeleeStore.getEncounter(encounterId);
    if (!encounter) return;

    const phase     = encounter.turnState.phase;
    const turn      = encounter.turnState.turn || 1;
    const segment   = encounter.turnState.segment || 1;
    const queueIdx  = encounter.turnState.queueIndex ?? 0;
    const exchangeId = `${turn}-${segment}-${queueIdx}`;

    const tracking = MeleeVanillaChat._getTracking(encounterId);

    if (phase === "awaiting-pool-rolls" || phase === "target-selection") {
      if (!tracking.poolCardId || tracking.lastPoolTurn !== turn) {
        await MeleeVanillaChat._postPoolCard(encounterId, encounter, turn);
      } else {
        await MeleeVanillaChat._updatePoolCard(encounterId, encounter);
      }
      return;
    }

    if (phase === "primary-attack-selection") {
      if (tracking.lastBattleExchangeId !== exchangeId) {
        await MeleeVanillaChat._postBattleCard(encounterId, encounter, exchangeId);
      }
      return;
    }

    if (phase === "primary-defense-selection") {
      if (tracking.lastBattleExchangeId !== exchangeId) {
        await MeleeVanillaChat._postBattleCard(encounterId, encounter, exchangeId);
      } else {
        await MeleeVanillaChat._updateBattleCard(encounterId, encounter);
      }
      return;
    }

    if (phase === "damage-selection") {
      if (tracking.lastPostedPhase !== "result" || tracking.lastPostedExchangeId !== exchangeId) {
        await MeleeVanillaChat._postResultCard(encounterId, encounter, null);
        const t = MeleeVanillaChat._getTracking(encounterId);
        await MeleeVanillaChat._setTracking(encounterId, {
          ...t,
          lastPostedPhase: "result",
          lastPostedExchangeId: exchangeId
        });
      }
    }
  }

  // ── Card Posts ──────────────────────────────────────────────────────────

  static async _postPoolCard(encounterId, encounter, turn) {
    const context = MeleeVanillaChat._buildPoolContext(encounter);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.pool, context);
    const message = await ChatMessage.create({
      content,
      flags: { neuroshima: { vanillaCard: { encounterId, type: "pool" } } },
      speaker: { alias: "⚔ Walka Wręcz" }
    });
    if (!message) return;

    const t = MeleeVanillaChat._getTracking(encounterId);
    await MeleeVanillaChat._setTracking(encounterId, {
      ...t,
      poolCardId: message.id,
      lastPoolTurn: turn,
      lastPostedPhase: "pool",
      lastPostedExchangeId: null
    });
  }

  static async _updatePoolCard(encounterId, encounter) {
    const tracking = MeleeVanillaChat._getTracking(encounterId);
    if (!tracking.poolCardId) return;
    const message = game.messages.get(tracking.poolCardId);
    if (!message) return;
    const context = MeleeVanillaChat._buildPoolContext(encounter);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.pool, context);
    await message.update({ content });
  }

  static async _postBattleCard(encounterId, encounter, exchangeId) {
    const context = MeleeVanillaChat._buildBattleContext(encounter);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.battle, context);
    const message = await ChatMessage.create({
      content,
      flags: { neuroshima: { vanillaCard: { encounterId, type: "battle" } } },
      speaker: { alias: "⚔ Walka Wręcz" }
    });
    if (!message) return;
    const t = MeleeVanillaChat._getTracking(encounterId);
    await MeleeVanillaChat._setTracking(encounterId, {
      ...t,
      battleCardId: message.id,
      lastBattleExchangeId: exchangeId
    });
  }

  static async _updateBattleCard(encounterId, encounter) {
    const tracking = MeleeVanillaChat._getTracking(encounterId);
    if (!tracking.battleCardId) {
      const turn = encounter.turnState.turn || 1;
      const segment = encounter.turnState.segment || 1;
      const queueIdx = encounter.turnState.queueIndex ?? 0;
      await MeleeVanillaChat._postBattleCard(encounterId, encounter, `${turn}-${segment}-${queueIdx}`);
      return;
    }
    const message = game.messages.get(tracking.battleCardId);
    if (!message) {
      const turn = encounter.turnState.turn || 1;
      const segment = encounter.turnState.segment || 1;
      const queueIdx = encounter.turnState.queueIndex ?? 0;
      await MeleeVanillaChat._postBattleCard(encounterId, encounter, `${turn}-${segment}-${queueIdx}`);
      return;
    }
    const context = MeleeVanillaChat._buildBattleContext(encounter);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.battle, context);
    await message.update({ content });
  }

  static async _postResultCard(encounterId, encounter, exchangeSnap) {
    const context = MeleeVanillaChat._buildResultContext(encounter, exchangeSnap);
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.result, context);
    await ChatMessage.create({
      content,
      flags: { neuroshima: { vanillaCard: { encounterId, type: "result" } } },
      speaker: { alias: "⚔ Walka Wręcz" }
    });
  }

  // ── Context Builders ────────────────────────────────────────────────────

  static _buildPoolContext(encounter) {
    const phase = encounter.turnState.phase;
    const turn  = encounter.turnState.turn || 1;
    const segment = encounter.turnState.segment || 1;

    const teamsA = (encounter.teams.A || []).map(id => {
      const p = encounter.participants[id];
      if (!p) return null;
      return MeleeVanillaChat._enrichParticipantForPool(p, id, encounter);
    }).filter(Boolean);

    const teamsB = (encounter.teams.B || []).map(id => {
      const p = encounter.participants[id];
      if (!p) return null;
      return MeleeVanillaChat._enrichParticipantForPool(p, id, encounter);
    }).filter(Boolean);

    const selectionOwner = phase === "target-selection"
      ? encounter.participants[encounter.turnState.selectionTurn]?.name || ""
      : null;

    return {
      encounterId: encounter.id,
      turn,
      segment,
      phase,
      isTargetSelection: phase === "target-selection",
      selectionOwnerName: selectionOwner,
      initiativeOwnerName: encounter.participants[encounter.turnState.initiativeOwnerId]?.name || "---",
      segmentDots: [1, 2, 3].map(i => ({
        number: i,
        state: i < segment ? "done" : i === segment ? "active" : "pending"
      })),
      teamsA,
      teamsB,
      allRolled: Object.values(encounter.participants).every(p => !p.isActive || p.pool.length > 0)
    };
  }

  static _enrichParticipantForPool(p, pId, encounter) {
    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    const weapon = actor?.items.get(p.weaponId);

    const meleeWeapons = actor
      ? (actor.items || [])
          .filter(i => i.type === "weapon" && i.system.weaponType === "melee" && i.system.equipped)
          .map(w => ({ id: w.id, name: w.name, isCurrent: w.id === p.weaponId }))
      : [];
    if (weapon && !meleeWeapons.some(w => w.id === p.weaponId)) {
      meleeWeapons.unshift({ id: p.weaponId, name: weapon.name, isCurrent: true });
    }

    const crowd = encounter.crowding[pId] || {};
    const dexPenalty = crowd.dexPenalty || 0;

    const effectivePool = (p.pool || []).map((v, i) => {
      const mp = p.modifiedPool;
      const effective = mp && mp[i] !== undefined ? mp[i] : v;
      const isNat20 = v === 20;
      const isSuccess = p.dieResults
        ? (p.dieResults[i]?.isSuccess ?? false)
        : (!isNat20 && effective <= ((p.attackTargetSnapshot ?? p.targetValue ?? 10) - dexPenalty));
      return { raw: v, effective, isSuccess, isNat20, index: i };
    });

    return {
      id: pId,
      name: p.name,
      img: p.img,
      actorUuid: p.actorUuid,
      initiative: p.initiative,
      maneuver: p.maneuver,
      hasPool: p.pool.length > 0,
      effectivePool,
      needsPool: p.pool.length === 0 && (encounter.turnState.phase === "awaiting-pool-rolls" || encounter.turnState.phase === "target-selection"),
      weaponName: weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
      meleeWeapons,
      weaponId: p.weaponId,
      isInitiativeOwner: pId === encounter.turnState.initiativeOwnerId,
      isCrowded: (crowd.opponentCount || 0) > 1,
      dexPenalty
    };
  }

  static _buildResultContext(encounter, snap) {
    const log = encounter.log || [];
    const lastEntry = log.slice(-1)[0];

    return {
      encounterId: encounter.id,
      resultType:  lastEntry?.type  || "block",
      resultText:  lastEntry?.text  || "",
      isHit:        lastEntry?.type === "hit",
      isBlock:      lastEntry?.type === "block",
      isTakeover:   lastEntry?.type === "takeover",
      pendingDamage: encounter.pendingDamage || null,
      turn:    encounter.turnState.turn || 1,
      segment: encounter.turnState.segment || 1
    };
  }

  static _buildBattleContext(encounter) {
    const phase = encounter.turnState.phase;
    const exchange = encounter.currentExchange;
    const isAttackerTurn = phase === "primary-attack-selection";
    const isDefenderTurn = phase === "primary-defense-selection";

    const attackerId = isAttackerTurn ? encounter.turnState.selectionTurn : exchange.attackerId;
    const defenderId = isAttackerTurn
      ? encounter.primaryTargets[attackerId]
      : exchange.defenderId;

    const attacker = encounter.participants[attackerId];
    const defender = encounter.participants[defenderId];
    if (!attacker || !defender) return {};

    const turn = encounter.turnState.turn || 1;
    const segment = encounter.turnState.segment || 1;

    const atkCrowd = encounter.crowding[attackerId] || {};
    const defCrowd = encounter.crowding[defenderId] || {};
    const atkDexPenalty = atkCrowd.dexPenalty || 0;
    const defDexPenalty = defCrowd.dexPenalty || 0;
    const atkTarget = (attacker.attackTargetSnapshot ?? attacker.targetValue ?? 10) - atkDexPenalty;
    const defTarget = (defender.defenseTargetSnapshot ?? defender.targetValue ?? 10) - defDexPenalty;

    const attackerSelectedDice = exchange.attackerSelectedDice || [];

    const attackerPool = (attacker.pool || []).map((v, i) => {
      const mp = attacker.modifiedPool;
      const eff = mp?.[i] !== undefined ? mp[i] : v;
      const isNat20 = v === 20;
      const isSuccess = attacker.dieResults
        ? (attacker.dieResults[i]?.isSuccess ?? false)
        : (!isNat20 && eff <= atkTarget);
      const isUsed = (attacker.usedDice || []).includes(i);
      const isSelected = attackerSelectedDice.includes(i);
      return { raw: v, effective: eff, isSuccess, isNat20, isUsed, isSelected, index: i };
    });

    const defenderPool = (defender.pool || []).map((v, i) => {
      const mp = defender.modifiedPool;
      const eff = mp?.[i] !== undefined ? mp[i] : v;
      const isNat20 = v === 20;
      const isSuccess = defender.dieResults
        ? (defender.dieResults[i]?.isSuccess ?? false)
        : (!isNat20 && eff <= defTarget);
      const isUsed = (defender.usedDice || []).includes(i);
      return { raw: v, effective: eff, isSuccess, isNat20, isUsed, index: i };
    });

    const atkDoc = fromUuidSync(attacker.actorUuid);
    const atkActor = atkDoc?.actor || atkDoc;
    const atkWeapon = atkActor?.items.get(attacker.weaponId);

    const defDoc = fromUuidSync(defender.actorUuid);
    const defActor = defDoc?.actor || defDoc;
    const defWeapon = defActor?.items.get(defender.weaponId);

    const atkIsCreature = atkActor?.type === "creature";
    const atkBeastActions = atkIsCreature
      ? (atkActor.items || [])
          .filter(i => i.type === "beast-action")
          .flatMap(i => (i.system?.activities ?? []).map(act => ({
            id: `${i.id}::${act.id}`,
            itemId: i.id,
            activityId: act.id,
            name: act.name || i.name,
            cost: act.costType === "success" ? (act.successCost ?? 1) : (act.segmentCost ?? 1),
            costType: act.costType ?? "success"
          })))
      : [];

    const defIsBerserker = defActor?.statuses?.has("berserker") ?? false;

    const availableDefenderDice = defenderPool.filter(d => !d.isUsed).length;
    const neededDiceCount = Math.min(exchange.declaredDiceCount || 0, availableDefenderDice);

    return {
      encounterId: encounter.id,
      turn,
      segment,
      segmentDots: [1, 2, 3].map(i => ({
        number: i,
        state: i < segment ? "done" : i === segment ? "active" : "pending"
      })),
      isAttackerTurn,
      isDefenderTurn,
      attacker: {
        id: attackerId,
        name: attacker.name,
        img: attacker.img,
        actorUuid: attacker.actorUuid,
        initiative: attacker.initiative,
        maneuver: attacker.maneuver,
        isInitiativeOwner: attackerId === encounter.turnState.initiativeOwnerId,
        attackTarget: atkTarget,
        weaponName: atkIsCreature
          ? game.i18n.localize("NEUROSHIMA.MeleeDuel.BeastActions")
          : (atkWeapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed")),
        effectivePool: attackerPool,
        isCrowded: (atkCrowd.opponentCount || 0) > 1,
        dexPenalty: atkDexPenalty,
        isCreature: atkIsCreature,
        beastActions: atkBeastActions,
        damageTiers: (() => {
          if (!atkWeapon) return null;
          if (atkWeapon.type === "beast-action") {
            const firstAct = (atkWeapon.system?.activities ?? [])[0];
            const dmg = firstAct?.damage || null;
            return dmg ? { s1: dmg, s2: dmg, s3: dmg } : null;
          }
          return {
            s1: atkWeapon.system?.damageMelee1 || "D",
            s2: atkWeapon.system?.damageMelee2 || "L",
            s3: atkWeapon.system?.damageMelee3 || "C"
          };
        })()
      },
      defender: {
        id: defenderId,
        name: defender.name,
        img: defender.img,
        actorUuid: defender.actorUuid,
        initiative: defender.initiative,
        isInitiativeOwner: defenderId === encounter.turnState.initiativeOwnerId,
        defenseTarget: defTarget,
        weaponName: defWeapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
        effectivePool: defenderPool,
        isCrowded: (defCrowd.opponentCount || 0) > 1,
        dexPenalty: defDexPenalty,
        isBerserker: defIsBerserker,
        neededDiceCount
      }
    };
  }

  // ── Action Handlers ─────────────────────────────────────────────────────

  static async _doRollPool(btn, encounterId) {
    const participantId = btn.dataset.participantId;
    const encounter = MeleeStore.getEncounter(encounterId);
    const p = encounter?.participants[participantId];
    if (!p) return;

    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    if (!actor?.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NotYourFighter"));
      return;
    }

    const weapon = actor?.items.get(p.weaponId);
    const crowd  = encounter?.crowding?.[participantId];
    const crowdingDexPenalty = crowd?.dexPenalty || 0;

    // Szarża (Charge) penalty: if the participant declared charge at initiative (+1..+3 to Zręczność)
    // but LOST the initiative roll, that same value becomes a penalty on the first pool roll.
    const isFirstTurn = (encounter?.turnState?.turn ?? 1) === 1;
    const hasInitiative = encounter?.turnState?.initiativeOwnerId === participantId;
    const chargeDexPenalty = (isFirstTurn && !hasInitiative && (p.chargeLevel ?? 0) > 0)
      ? (p.chargeLevel ?? 0) : 0;

    const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");

    const dialog = new NeuroshimaWeaponRollDialog({
      actor,
      weapon,
      rollType: "melee",
      isPoolRoll: true,
      crowdingDexPenalty,
      chargeDexPenalty,
      onClose: () => {},
      onRoll: async (rollResult) => {
        game.neuroshima?.log("[melee-vanilla-chat.onRoll] callback fired", { encounterId, participantId, maneuver: rollResult?.maneuver, tempoLevel: rollResult?.tempoLevel });
        if (!rollResult) return;
        const toNum = r => typeof r === "object"
          ? (r.value ?? r.result ?? r.original ?? Number(r))
          : Number(r);
        const results      = (rollResult.results || []).map(toNum);
        const modifiedPool = (rollResult.modifiedResults || []).map(r =>
          typeof r === "object" ? toNum({ value: r.modified ?? r.original }) : toNum(r)
        );
        const dieResults   = (rollResult.modifiedResults || []).map(r => ({
          isSuccess: typeof r === "object" ? (r.isSuccess ?? false) : false,
          isNat20:   typeof r === "object" ? (r.original === 20) : false
        }));
        await MeleeTurnService.setPool(
          encounterId, participantId, results,
          rollResult.maneuver || "none",
          rollResult.tempoLevel || 0,
          rollResult.attributeBonus || 0,
          modifiedPool,
          rollResult.skill ?? 0,
          typeof rollResult.target === "number" ? rollResult.target : null,
          rollResult.meleeAction || "attack",
          dieResults,
          rollResult.damageShift || 0,
          rollResult.damageShift1 || 0,
          rollResult.damageShift2 || 0,
          rollResult.damageShift3 || 0
        );
      }
    });
    dialog.render(true);
  }

  static async _doConfirmAttack(btn, encounterId, root) {
    const participantId = btn.dataset.participantId;

    const chips = [...root.querySelectorAll(".die-chip-mvc.mvc-die-selected")];
    if (chips.length === 0) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.SelectDiceFirst"));
      return;
    }

    const selectedIndices = chips.map(c => parseInt(c.dataset.index, 10));

    btn.disabled = true;
    for (const idx of selectedIndices) {
      await MeleeTurnService.selectDie(encounterId, participantId, idx);
    }
    await MeleeTurnService.confirmAttack(encounterId, participantId);
  }

  static async _doAcceptHit(btn, encounterId) {
    const participantId = btn.dataset.participantId;
    const doc = fromUuidSync(btn.dataset.meleeOwner);
    const actor = doc?.actor || doc;
    if (!actor?.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NotYourFighter"));
      return;
    }
    btn.disabled = true;

    const encBefore = MeleeStore.getEncounter(encounterId);
    if (!encBefore) return;
    const turn     = encBefore.turnState.turn || 1;
    const segment  = encBefore.turnState.segment || 1;
    const queueIdx = encBefore.turnState.queueIndex ?? 0;
    const exchangeId = `${turn}-${segment}-${queueIdx}`;

    await MeleeTurnService.berserkerAcceptHit(encounterId, participantId);

    const encAfter = MeleeStore.getEncounter(encounterId);
    if (!encAfter) return;

    if (!game.user.isGM) {
      if (game.neuroshima?.socket) {
        await game.neuroshima.socket.executeAsGM("postVanillaCard", "result", encounterId);
      }
    } else {
      await MeleeVanillaChat._postResultCard(encounterId, encAfter, null);
      const t = MeleeVanillaChat._getTracking(encounterId);
      await MeleeVanillaChat._setTracking(encounterId, {
        ...t,
        lastPostedPhase: "result",
        lastPostedExchangeId: exchangeId
      });
    }
  }

  static async _doConfirmDefense(btn, encounterId, root) {
    const participantId = btn.dataset.participantId;
    const neededCount   = parseInt(btn.dataset.neededCount ?? "0", 10);

    const chips = [...root.querySelectorAll(".die-chip-mvc.mvc-die-selected")];
    const selectedIndices = chips.map(c => parseInt(c.dataset.index, 10));

    if (selectedIndices.length !== neededCount) {
      ui.notifications.warn(
        game.i18n.format("NEUROSHIMA.MeleeDuel.DefenseWrongCount", {
          selected: selectedIndices.length,
          needed: neededCount
        })
      );
      return;
    }

    const encBefore = MeleeStore.getEncounter(encounterId);
    if (!encBefore) return;

    const exchange   = encBefore.currentExchange;
    const turn       = encBefore.turnState.turn || 1;
    const segment    = encBefore.turnState.segment || 1;
    const queueIdx   = encBefore.turnState.queueIndex ?? 0;
    const exchangeId = `${turn}-${segment}-${queueIdx}`;

    btn.disabled = true;

    for (const idx of selectedIndices) {
      await MeleeTurnService.selectDie(encounterId, participantId, idx);
    }
    await MeleeTurnService.confirmDefense(encounterId, participantId);

    const encAfter = MeleeStore.getEncounter(encounterId);
    if (!encAfter) return;

    if (!game.user.isGM) {
      if (game.neuroshima?.socket) {
        await game.neuroshima.socket.executeAsGM("postVanillaCard", "result", encounterId);
      }
    } else {
      await MeleeVanillaChat._postResultCard(encounterId, encAfter, null);
      const t = MeleeVanillaChat._getTracking(encounterId);
      await MeleeVanillaChat._setTracking(encounterId, {
        ...t,
        lastPostedPhase: "result",
        lastPostedExchangeId: exchangeId
      });
    }
  }

  // ── Client-side: die toggles ────────────────────────────────────────────

  static _bindBattleDiceToggles(root) {
    const confirmAttack = root.querySelector("[data-mvc-action='confirmAttack']");
    const confirmDefense = root.querySelector("[data-mvc-action='confirmDefense']");
    const neededCount = confirmDefense
      ? parseInt(confirmDefense.dataset.neededCount ?? "0", 10)
      : null;

    const updateButtons = () => {
      const selected = root.querySelectorAll(".die-chip-mvc.mvc-die-selected");
      const count = selected.length;

      const countEl = root.querySelector(".mvc-selected-count");
      if (countEl) countEl.textContent = count;

      if (confirmAttack) {
        const ok = count > 0;
        confirmAttack.disabled = !ok;
        confirmAttack.classList.toggle("is-disabled", !ok);
        confirmAttack.classList.toggle("pulse", ok);
      }

      if (confirmDefense && neededCount !== null) {
        const ok = count === neededCount;
        confirmDefense.disabled = !ok;
        confirmDefense.classList.toggle("is-disabled", !ok);
        confirmDefense.classList.toggle("pulse", ok);
      }
    };

    root.querySelectorAll(".die-chip-mvc:not(.is-used)").forEach(chip => {
      chip.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        chip.classList.toggle("mvc-die-selected");
        updateButtons();
      });
    });

    updateButtons();
  }

  // ── Owner visibility ────────────────────────────────────────────────────

  static _applyOwnerVisibility(root) {
    root.querySelectorAll("[data-melee-owner]").forEach(el => {
      const ownerUuid = el.dataset.meleeOwner;
      if (!ownerUuid) return;
      const doc    = fromUuidSync(ownerUuid);
      const actor  = doc?.actor || doc;
      const canAct = game.user.isGM || actor?.isOwner;
      if (!canAct) {
        if (el.tagName === "BUTTON") {
          el.disabled = true;
          el.classList.add("is-disabled");
          el.style.pointerEvents = "none";
          el.style.opacity = "0.35";
        } else if (el.tagName === "SELECT") {
          el.disabled = true;
        } else {
          el.style.opacity = "0.35";
          el.style.pointerEvents = "none";
        }
      }
    });
  }

  // ── Tracking helpers ────────────────────────────────────────────────────

  static _getTracking(encounterId) {
    const all = game.combat?.getFlag("neuroshima", MeleeVanillaChat.FLAG_KEY) || {};
    return all[encounterId] || {};
  }

  static async _setTracking(encounterId, data) {
    const combat = game.combat;
    if (!combat) return;
    const all = foundry.utils.deepClone(combat.getFlag("neuroshima", MeleeVanillaChat.FLAG_KEY) || {});
    all[encounterId] = data;
    if (game.user.isGM || !game.neuroshima?.socket) {
      await combat.setFlag("neuroshima", MeleeVanillaChat.FLAG_KEY, all);
    } else {
      await game.neuroshima.socket.executeAsGM("updateCombatFlag", MeleeVanillaChat.FLAG_KEY, all);
    }
  }
}
