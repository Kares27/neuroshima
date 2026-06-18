import { MeleeStore } from "./melee-store.js";
import { MeleeTurnService } from "./melee-turn-service.js";

/**
 * Chat-based renderer for Neuroshima 1.5 vanilla melee encounters.
 *
 * Replaces MeleeCombatApp (the floating 780×540 window) for the default
 * ("vanilla") melee combat type. One ChatMessage per active encounter is
 * created and re-rendered automatically whenever the encounter state changes.
 *
 * Flow:
 *  1. MeleeEncounter.create() → MeleeTurnCard.post(encounterId)
 *     → ChatMessage posted, message ID stored in combat flags
 *  2. Any state change (setPool, selectDie, confirmAttack, …)
 *     → MeleeStore.updateEncounter() → combat.setFlag()
 *     → updateCombat hook → MeleeTurnCard.updateAll() (GM only)
 *     → ChatMessage.update({ content }) → all clients see new state
 *  3. Client interaction (button click) → renderChatMessageHTML → onRender()
 *     → event listeners bound → calls MeleeTurnService.* / opens dialog
 */
export class MeleeTurnCard {
  static TEMPLATE = "systems/neuroshima/templates/chat/melee-turn-card.hbs";
  static FLAG_KEY = "meleeTurnCards";

  static _debouncedUpdate = null;

  // ── Public lifecycle ────────────────────────────────────────────────────

  /**
   * Post a new ChatMessage for an encounter.
   * The message ID is persisted in combat flags so it can be found later.
   *
   * @param {string} encounterId
   * @returns {Promise<ChatMessage|null>}
   */
  static async post(encounterId) {
    const encounter = MeleeStore.getEncounter(encounterId);
    if (!encounter) return null;

    const content = await this._render(encounter);
    const message = await ChatMessage.create({
      content,
      flags: { neuroshima: { meleeTurnCard: encounterId } },
      speaker: { alias: "⚔ Walka Wręcz" }
    });
    if (!message) return null;

    await this._storeMessageId(encounterId, message.id);
    return message;
  }

  /**
   * Re-render an existing card with the current encounter state.
   * When the encounter no longer exists, removes the card flag (leaves message as history).
   *
   * @param {string} encounterId
   */
  static async update(encounterId) {
    const messageId = this._getMessageId(encounterId);
    if (!messageId) return;

    const message = game.messages.get(messageId);
    if (!message) {
      await this._removeFlag(encounterId);
      return;
    }

    const encounter = MeleeStore.getEncounter(encounterId);
    if (!encounter) {
      await this._removeFlag(encounterId);
      return;
    }

    const content = await this._render(encounter);
    await message.update({ content });
  }

  /**
   * Re-render all active melee turn cards.
   * Should only be called on the GM client (authority for ChatMessage updates).
   *
   * @param {Combat} combat
   */
  static async updateAll(combat) {
    const cards = combat.getFlag("neuroshima", this.FLAG_KEY) || {};
    for (const encounterId of Object.keys(cards)) {
      await this.update(encounterId);
    }
  }

  // ── Client-side rendering hook ──────────────────────────────────────────

  /**
   * Called from the renderChatMessageHTML hook.
   * Binds event listeners and applies per-user visibility.
   *
   * @param {HTMLElement} root    Chat message root element
   * @param {ChatMessage} message Foundry chat message document
   */
  static onRender(root, message) {
    const encounterId = message.getFlag("neuroshima", "meleeTurnCard");
    if (!encounterId) return;

    // ── Visibility: disable interactive elements for non-owners ───────────
    root.querySelectorAll("[data-melee-owner]").forEach(el => {
      const ownerUuid = el.dataset.meleeOwner;
      if (!ownerUuid) return;
      const doc = fromUuidSync(ownerUuid);
      const actor = doc?.actor || doc;
      const canInteract = game.user.isGM || (actor?.isOwner);
      if (!canInteract) {
        if (el.tagName === "BUTTON") {
          el.disabled = true;
          el.classList.add("is-disabled");
          el.style.opacity = "0.35";
          el.style.pointerEvents = "none";
        } else if (el.tagName === "SELECT") {
          el.disabled = true;
        } else {
          el.style.opacity = "0.35";
          el.style.pointerEvents = "none";
        }
      }
    });

    // ── Action buttons (data-melee-action) ────────────────────────────────
    root.querySelectorAll("[data-melee-action]").forEach(btn => {
      btn.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const action = btn.dataset.meleeAction;
        await MeleeTurnCard._handleAction(action, btn, encounterId);
      });
    });

    // ── Weapon change select ──────────────────────────────────────────────
    root.querySelectorAll(".mtc-weapon-select").forEach(sel => {
      sel.addEventListener("change", async ev => {
        const participantId = ev.currentTarget.dataset.participantId;
        const weaponId = ev.currentTarget.value;
        if (participantId && weaponId) {
          await MeleeTurnService.setWeapon(encounterId, participantId, weaponId);
        }
      });
    });

    // ── Target change select ──────────────────────────────────────────────
    root.querySelectorAll(".mtc-target-select").forEach(sel => {
      sel.addEventListener("change", async ev => {
        const participantId = ev.currentTarget.dataset.participantId;
        const targetId = ev.currentTarget.value;
        if (participantId && targetId) {
          await MeleeTurnService.setTarget(encounterId, participantId, targetId);
        }
      });
    });
  }

  // ── Hook registration ───────────────────────────────────────────────────

  /**
   * Register the updateCombat hook that re-renders active cards.
   * Uses debouncing to prevent excessive re-renders during rapid state changes.
   */
  static registerHooks() {
    MeleeTurnCard._debouncedUpdate = foundry.utils.debounce(async () => {
      if (!game.user.isGM) return;
      if (game.combat) await MeleeTurnCard.updateAll(game.combat);
    }, 300);

    Hooks.on("updateCombat", (combat, updates) => {
      if (!foundry.utils.hasProperty(updates, "flags.neuroshima.meleeEncounters")) return;
      MeleeTurnCard._debouncedUpdate();
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Render the template with the current encounter state.
   * @private
   */
  static async _render(encounter) {
    const context = this._buildContext(encounter);
    return foundry.applications.handlebars.renderTemplate(this.TEMPLATE, context);
  }

  /**
   * Store the message ID for an encounter in combat flags.
   * @private
   */
  static async _storeMessageId(encounterId, messageId) {
    const combat = game.combat;
    if (!combat) return;
    const cards = foundry.utils.deepClone(combat.getFlag("neuroshima", this.FLAG_KEY) || {});
    cards[encounterId] = messageId;
    if (game.user.isGM || !game.neuroshima?.socket) {
      await combat.setFlag("neuroshima", this.FLAG_KEY, cards);
    } else {
      await game.neuroshima.socket.executeAsGM("updateCombatFlag", this.FLAG_KEY, cards);
    }
  }

  /**
   * Remove the message ID flag for an encounter (called when encounter ends).
   * Leaves the ChatMessage in chat as a read-only summary.
   * @private
   */
  static async _removeFlag(encounterId) {
    const combat = game.combat;
    if (!combat) return;
    await combat.unsetFlag("neuroshima", `${this.FLAG_KEY}.${encounterId}`);
  }

  /**
   * Get the ChatMessage ID for an encounter.
   * @private
   */
  static _getMessageId(encounterId) {
    return game.combat?.getFlag("neuroshima", this.FLAG_KEY)?.[encounterId] ?? null;
  }

  /**
   * Build template context from encounter data.
   * All heavy lifting mirrors MeleeCombatApp._prepareContext but
   * is server-side (called from GM during updateAll).
   * @private
   */
  static _buildContext(encounter) {
    const context = foundry.utils.deepClone(encounter);

    const phase = context.turnState.phase;
    const selectionTurn = context.turnState.selectionTurn;
    const exchange = context.currentExchange;
    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");

    for (const pId in context.participants) {
      const p = context.participants[pId];
      p.id = pId;

      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;

      const weapon = actor?.items.get(p.weaponId);
      p.weaponName = weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed");

      // Weapon list for dropdown (shown when pool not yet rolled)
      if (actor) {
        const meleeItems = (actor.items || []).filter(i =>
          i.type === "weapon" && i.system.weaponType === "melee" && i.system.equipped
        );
        p.meleeWeapons = meleeItems.map(w => ({ id: w.id, name: w.name, isCurrent: w.id === p.weaponId }));
        if (!p.meleeWeapons.some(w => w.id === p.weaponId) && weapon) {
          p.meleeWeapons.unshift({ id: p.weaponId, name: weapon.name, isCurrent: true });
        }
      } else {
        p.meleeWeapons = [];
      }

      // Target display name
      const targetId = context.primaryTargets[pId];
      p.targetName = context.participants[targetId]?.name || "";

      // Crowding
      const crowd = context.crowding[pId];
      p.isCrowded = crowd?.opponentCount > 1;
      p.dexPenalty = crowd?.dexPenalty || 0;

      // Effective target values (attack vs defense)
      const atkSnap = p.attackTargetSnapshot != null ? p.attackTargetSnapshot : (p.targetValue ?? 10);
      const defSnap = p.defenseTargetSnapshot != null ? p.defenseTargetSnapshot : (p.targetValue ?? 10);
      p.attackTarget = atkSnap - p.dexPenalty;
      p.defenseTarget = defSnap - p.dexPenalty;

      const isAttackerContext = pId === exchange.attackerId ||
        (phase === "primary-attack-selection" && pId === selectionTurn) ||
        phase === "awaiting-pool-rolls" || phase === "target-selection";
      p.currentEffectiveTarget = isAttackerContext ? p.attackTarget : p.defenseTarget;

      // Die selection index tracking
      p.selectedDiceIndices = [];
      if (phase === "primary-attack-selection" && pId === selectionTurn) {
        p.selectedDiceIndices = exchange.attackerSelectedDice || [];
      } else if (phase === "primary-defense-selection" && pId === exchange.defenderId) {
        p.selectedDiceIndices = exchange.defenderSelectedDice || [];
      } else if (pId === exchange.attackerId) {
        p.selectedDiceIndices = exchange.attackerSelectedDice || [];
      } else if (pId === exchange.defenderId) {
        p.selectedDiceIndices = exchange.defenderSelectedDice || [];
      }

      // Build effectivePool — same logic as MeleeCombatApp._prepareContext
      const mp = p.modifiedPool;
      const dr = p.dieResults;

      if (doubleSkill && p.pool.length > 0) {
        const selfSpent = (p.selfReductions || []).reduce((a, b) => a + b, 0);
        const oppSpent = Object.values(p.spentOnOpponent || {})
          .reduce((sum, arr) => sum + arr.reduce((a, b) => a + b, 0), 0);
        p.skillRemaining = (p.skillBudget || 0) - selfSpent - oppSpent;
        p.isAllocationPhase = true;

        p.effectivePool = p.pool.map((v, i) => {
          const reduction = (p.selfReductions || [])[i] || 0;
          const gain = (p.opponentGains || [])[i] || 0;
          const effective = v - reduction + gain;
          const isNat20 = v === 20;
          const isSuccess = !isNat20 && effective <= p.currentEffectiveTarget;
          return { raw: v, effective, isSuccess, isNat20, index: i };
        });
      } else {
        p.skillRemaining = 0;
        p.isAllocationPhase = false;

        p.effectivePool = (p.pool || []).map((v, i) => {
          const effective = mp && mp[i] !== undefined ? mp[i] : v;
          const isNat20 = v === 20;
          const isSuccess = dr
            ? (dr[i]?.isSuccess ?? false)
            : (!isNat20 && effective <= p.currentEffectiveTarget);
          return { raw: v, effective, isSuccess, isNat20, index: i };
        });
      }

      // Damage preview from weapon
      const pWeapon = actor?.items.get(p.weaponId);
      p.damageMeleePreview = {
        s1: pWeapon?.system?.damageMelee1 || "D",
        s2: pWeapon?.system?.damageMelee2 || "L",
        s3: pWeapon?.system?.damageMelee3 || "C"
      };

      // Phase-specific state flags used in the template
      p.isInitiativeOwner = pId === context.turnState.initiativeOwnerId;
      p.needsPool = p.pool.length === 0 && phase === "awaiting-pool-rolls";
      p.isAttacking = phase === "primary-attack-selection" && pId === selectionTurn;
      p.isDefending = phase === "primary-defense-selection" && pId === exchange.defenderId;

      if (p.isAttacking) {
        p.pendingDiceCount = exchange.attackerSelectedDice.length;
      }
      if (p.isDefending) {
        p.declaredCount = exchange.declaredDiceCount;
        p.selectedDefenseCount = exchange.defenderSelectedDice.length;
      }
    }

    // Teams sorted by initiative descending
    context.teamsData = {
      A: (context.teams.A || []).map(id => context.participants[id]).filter(Boolean)
        .sort((a, b) => (b.initiative || 0) - (a.initiative || 0)),
      B: (context.teams.B || []).map(id => context.participants[id]).filter(Boolean)
        .sort((a, b) => (b.initiative || 0) - (a.initiative || 0))
    };

    // Segment progress dots
    const currentSeg = context.turnState.segment || 1;
    context.segmentDots = [1, 2, 3].map(i => ({
      number: i,
      state: i < currentSeg ? "done" : i === currentSeg ? "active" : "pending"
    }));

    context.initiativeOwnerName = context.participants[context.turnState.initiativeOwnerId]?.name || "---";
    context.phaseLabel = this._getPhaseLabel(phase);

    // Last 4 log entries, most recent first
    context.recentLog = (context.log || []).slice(-4).reverse();

    // Pending damage distribution
    context.pendingDamage = encounter.pendingDamage || null;

    return context;
  }

  /**
   * Returns a localized label for the current phase.
   * @private
   */
  static _getPhaseLabel(phase) {
    const map = {
      "awaiting-pool-rolls": "NEUROSHIMA.MeleeDuel.Phase.AwaitingPoolRolls",
      "target-selection": "NEUROSHIMA.MeleeDuel.Phase.TargetSelection",
      "primary-attack-selection": "NEUROSHIMA.MeleeDuel.Phase.AttackSelection",
      "primary-defense-selection": "NEUROSHIMA.MeleeDuel.Phase.DefenseSelection",
      "damage-selection": "NEUROSHIMA.MeleeDuel.Phase.DamageSelection",
      "segment-end": "NEUROSHIMA.MeleeDuel.Phase.SegmentEnd"
    };
    return game.i18n.localize(map[phase] || phase);
  }

  // ── Action dispatch ─────────────────────────────────────────────────────

  /**
   * Handle a melee turn card action button click.
   * @private
   */
  static async _handleAction(action, btn, encounterId) {
    switch (action) {
      case "rollPool":
        await MeleeTurnCard._doRollPool(btn, encounterId);
        break;

      case "selectDie":
        await MeleeTurnService.selectDie(
          encounterId,
          btn.dataset.participantId,
          parseInt(btn.dataset.index, 10)
        );
        break;

      case "confirmAttack":
        await MeleeTurnService.confirmAttack(encounterId, btn.dataset.participantId);
        break;

      case "confirmDefense":
        await MeleeTurnService.confirmDefense(encounterId, btn.dataset.participantId);
        break;

      case "performAction":
        await MeleeTurnService.performAction(encounterId, btn.dataset.participantId);
        break;

      case "confirmDamage": {
        const { MeleeResolution } = await import("./melee-resolution.js");
        await MeleeResolution.confirmDamageDistribution(encounterId, parseInt(btn.dataset.optionIndex, 10));
        break;
      }

      case "endEncounter": {
        const { MeleeEncounter } = await import("./melee-encounter.js");
        await MeleeEncounter.end(encounterId);
        break;
      }

      case "nextTurn":
        await MeleeTurnService.startNewTurn(encounterId);
        break;

      case "prevTurn":
        await MeleeTurnService.prevTurn(encounterId);
        break;

      case "nextSegment": {
        const enc = MeleeStore.getEncounter(encounterId);
        if (enc) await MeleeTurnService.setSegment(encounterId, (enc.turnState.segment || 1) + 1);
        break;
      }

      case "prevSegment": {
        const enc = MeleeStore.getEncounter(encounterId);
        if (enc) await MeleeTurnService.setSegment(encounterId, (enc.turnState.segment || 1) - 1);
        break;
      }

      case "resetSkill":
        await MeleeTurnService.resetSkillAllocation(encounterId, btn.dataset.participantId);
        break;
    }
  }

  /**
   * Open the 3k20 weapon-roll dialog for a participant.
   * Replicates the logic of MeleeCombatApp._onOpenPoolDialog but triggers from the chat card.
   * @private
   */
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
    const crowd = encounter?.crowding?.[participantId];
    const crowdingDexPenalty = crowd?.dexPenalty || 0;

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
        game.neuroshima?.log("[melee-turn-card.onRoll] callback fired", { encounterId, participantId, maneuver: rollResult?.maneuver, tempoLevel: rollResult?.tempoLevel });
        if (!rollResult) return;
        const toNum = r => typeof r === "object"
          ? (r.value ?? r.result ?? r.original ?? Number(r))
          : Number(r);

        const results = (rollResult.results || []).map(toNum);
        const modifiedPool = (rollResult.modifiedResults || []).map(r =>
          typeof r === "object" ? toNum({ value: r.modified ?? r.original }) : toNum(r)
        );
        const dieResults = (rollResult.modifiedResults || []).map(r => ({
          isSuccess: typeof r === "object" ? (r.isSuccess ?? false) : false,
          isNat20: typeof r === "object" ? (r.original === 20) : false
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
}
