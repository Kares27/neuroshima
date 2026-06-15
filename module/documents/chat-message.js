import { NEUROSHIMA } from "../config.js";
import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

/**
 * Extended ChatMessage class with a unified API for rendering chat cards.
 * Provides a clean interface for creating and rendering all message types.
 */
export class NeuroshimaChatMessage extends ChatMessage {

  /**
   * Main chat card action dispatcher.
   * Called from the renderChatMessageHTML hook in system.js.
   */
  static onChatAction(html) {
    // Application V2 compatibility: html can be a HTMLElement or a jQuery object
    const root = (html instanceof HTMLElement) ? html : html[0];
    if (!root) return;

    // Resolve the chat message linked to this HTML element
    const messageId = root.closest(".chat-message")?.dataset.messageId;
    const message = game.messages.get(messageId);
    if (!message) return;

    // Delegate click events for action buttons
    root.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", async event => {
        event.preventDefault();
        const action = btn.dataset.action;
        
        switch (action) {
          case "reroll-healing":
            this.onRerollHealing(event, message);
            break;
          case "apply-healing":
            this.onApplyHealing(event, message);
            break;
          case "openHealPanel":
            this.onOpenHealPanel(event, message);
            break;
          case "start-melee":
            this.onStartMeleeDuel(event, message);
            break;
          case "meleeOpposedDefend":
            this.onMeleeOpposedDefend(event, btn, message);
            break;
          case "applyOpposedDamage":
            this.onApplyOpposedDamage(event, message);
            break;
          case "applyHailDamage":
            this.onApplyHailDamage(event, message);
            break;
          case "hailDefend":
            this.onHailDefend(event, message);
            break;
          case "executeRequiredTest":
            this.onExecuteRequiredTest(event, message);
            break;
          case "placeGrenadeTemplate":
            this.onPlaceGrenadeTemplate(event, btn, message);
            break;
          case "applyGrenadeDamage":
            this.onApplyGrenadeDamage(event, message);
            break;
          case "skillAllocAdjust":
            this.onSkillAllocAdjust(event, btn, message);
            break;
          case "skillAllocReset":
            this.onSkillAllocReset(event, btn, message);
            break;
          case "skillAllocConfirm":
            this.onSkillAllocConfirm(event, btn, message);
            break;
          case "duelPick":
            this.onDuelPick(event, btn, message);
            break;
          case "duelSwapInit":
            this.onDuelSwapInit(event, message);
            break;
          case "applyBeastActions": {
            const section = root.querySelector(".beast-action-spending");
            if (!section) break;
            const selectedActionIds = [];
            section.querySelectorAll(".beast-qty-value").forEach(el => {
              const qty = parseInt(el.textContent, 10) || 0;
              const id = el.dataset.actionId;
              for (let i = 0; i < qty; i++) selectedActionIds.push(id);
            });
            const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
            await MeleeOpposedChat.applyBeastActions(message.id, selectedActionIds);
            btn.disabled = true;
            btn.classList.add("applied");
            btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("NEUROSHIMA.BeastAction.Applied")}`;
            break;
          }
          case "engageBeastTarget":
            await this.onEngageBeastTarget(event, message);
            break;
        }
      });
    });

    this._bindBeastActionSpending(root);
    this._bindResultCardCollapsibles(root);

    root.querySelectorAll(".item-card-draggable[data-uuid]").forEach(el => {
      el.addEventListener("dragstart", event => {
        const uuid = el.dataset.uuid;
        if (!uuid) return;

        const messageId = root.closest(".chat-message")?.dataset.messageId;
        const message = messageId ? game.messages.get(messageId) : null;
        const cardData = message?.getFlag("neuroshima", "itemCard");

        if (cardData && cardData.remaining !== null && cardData.remaining <= 0) {
          event.preventDefault();
          return;
        }

        event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid, fromChatCard: true, messageId }));
      });
    });
  }

  /**
   * Initiates a melee duel based on a weapon roll.
   */
  static async onStartMeleeDuel(event, message) {
    const flags = message.getFlag("neuroshima", "rollData");
    if (!flags || !flags.isMelee) return;

    const attackerId = flags.actorId;
    const targets = flags.targets || [];

    if (targets.length === 0) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoMeleeTarget"));
        return;
    }

    const defenderId = targets[0];

    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
    await NeuroshimaMeleeCombat.startDuel(attackerId, defenderId, flags);
  }

  /**
   * Defender clicks a weapon (or Unarmed) button on the melee-opposed handler card.
   * `btn.dataset.weaponId` is the defender's item ID (empty string = unarmed).
   */
  static async onMeleeOpposedDefend(event, btn, message) {
    const weaponId = btn.dataset.weaponId || null;
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.defendFromChat(message.id, weaponId);
  }

  /**
   * Apply the opposed damage from the result card and visually disable the button.
   * Delegates to `MeleeOpposedChat.applyOpposedDamage`.
   *
   * @param {PointerEvent}  event
   * @param {ChatMessage}   message
   */
  static async onApplyOpposedDamage(event, message) {
    const btn = event.currentTarget;
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.applyOpposedDamage(message.id);
    if (btn) {
      btn.disabled = true;
      btn.classList.add("applied");
      btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DamageApplied")}`;
    }
  }

  /**
   * Apply the Grad Ciosów (hail of blows) damage from the result card and visually disable the button.
   * Delegates to `MeleeOpposedChat.applyHailDamage`.
   *
   * @param {PointerEvent}  event
   * @param {ChatMessage}   message
   */
  static async onApplyHailDamage(event, message) {
    const btn = event.currentTarget;
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.applyHailDamage(message.id);
    if (btn) {
      btn.disabled = true;
      btn.classList.add("applied");
      btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DamageApplied")}`;
    }
  }

  /**
   * Defender clicks the defend button on a Grad Ciosów handler card.
   * Delegates to `MeleeOpposedChat.hailDefendFromChat`.
   *
   * @param {PointerEvent}  event
   * @param {ChatMessage}   message
   */
  static async onHailDefend(event, message) {
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.hailDefendFromChat(message.id);
  }

  /**
   * Handle a die-pick click in the Grad Ciosów duel card.
   *
   * Permission check: non-GM players may only pick dice for the side they own.
   * GMs execute the mutation directly; players route through the socket helper so
   * that `applyDuelPick` always runs on the GM client.
   *
   * @param {PointerEvent}  event
   * @param {HTMLElement}   btn   - The clicked button (`data-side`, `data-die-idx`).
   * @param {ChatMessage}   message
   */
  static async onDuelPick(event, btn, message) {
    const side = btn.dataset.side;
    const dieIdx = parseInt(btn.dataset.dieIdx, 10);
    if (!side || isNaN(dieIdx)) return;

    if (!game.user.isGM) {
      const state = message.getFlag("neuroshima", "duelCard");
      if (!state) return;
      const attackerDoc = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
      const attackerActor = attackerDoc?.actor ?? attackerDoc;
      const defenderDoc = fromUuidSync(state.defenderUuid);
      const defenderActor = defenderDoc?.actor ?? defenderDoc;
      if (side === "attacker" && !attackerActor?.isOwner) return;
      if (side === "defender" && !defenderActor?.isOwner) return;
    }

    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    if (game.user.isGM) {
      await MeleeOpposedChat.applyDuelPick(message.id, side, dieIdx);
    } else if (game.neuroshima?.socket) {
      await game.neuroshima.socket.executeAsGM("applyDuelPick", message.id, side, dieIdx);
    }
  }

  /**
   * Swap the initiative / first-strike advantage between attacker and defender in
   * the active Grad Ciosów duel card.  GM-only action.
   *
   * @param {PointerEvent}  event
   * @param {ChatMessage}   message
   */
  static async onDuelSwapInit(event, message) {
    if (!game.user.isGM) return;
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.swapDuelInitiative(message.id);
  }

  /**
   * Adjust a skill-allocation die value by `delta` for the given spender and target side.
   *
   * Reads `data-spender`, `data-target`, `data-die-index`, and `data-delta` from `btn`.
   * Aborts if the card is no longer in `pending` status or the side has already confirmed.
   * GMs apply directly; players route through the socket helper.
   *
   * @param {PointerEvent}  event
   * @param {HTMLElement}   btn
   * @param {ChatMessage}   message
   */
  static async onSkillAllocAdjust(event, btn, message) {
    const spender   = btn.dataset.spender;
    const target    = btn.dataset.target;
    const dieIndex  = parseInt(btn.dataset.dieIndex ?? "0", 10);
    const delta     = parseInt(btn.dataset.delta ?? "1", 10);

    const allocData = message.getFlag("neuroshima", "skillAlloc");
    if (!allocData || allocData.status !== "pending") return;

    const sideConfirmed = spender === "attacker" ? allocData.attackerConfirmed : allocData.defenderConfirmed;
    if (sideConfirmed) return;

    const patch = { type: "adjust", spender, target, dieIndex, delta };
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");

    if (game.user.isGM) {
      await MeleeOpposedChat.applyAllocPatch(message.id, patch);
    } else if (game.neuroshima?.socket) {
      await game.neuroshima.socket.executeAsGM("applySkillAlloc", message.id, patch);
    }
  }

  /**
   * Reset all die allocations for one side back to zero.
   * Aborts if the side has already confirmed or the card is not `pending`.
   * GMs apply directly; players route through the socket helper.
   *
   * @param {PointerEvent}  event
   * @param {HTMLElement}   btn   - Must carry `data-side` ("attacker" | "defender").
   * @param {ChatMessage}   message
   */
  static async onSkillAllocReset(event, btn, message) {
    const side = btn.dataset.side;
    const allocData = message.getFlag("neuroshima", "skillAlloc");
    if (!allocData || allocData.status !== "pending") return;

    const sideConfirmed = side === "attacker" ? allocData.attackerConfirmed : allocData.defenderConfirmed;
    if (sideConfirmed) return;

    const patch = { type: "reset", side };
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");

    if (game.user.isGM) {
      await MeleeOpposedChat.applyAllocPatch(message.id, patch);
    } else if (game.neuroshima?.socket) {
      await game.neuroshima.socket.executeAsGM("applySkillAlloc", message.id, patch);
    }
  }

  /**
   * Confirm (lock in) a side's die allocation.
   * When both sides confirm, `MeleeOpposedChat` resolves the allocation and proceeds.
   * GMs apply directly; players route through the socket helper.
   *
   * @param {PointerEvent}  event
   * @param {HTMLElement}   btn   - Must carry `data-side` ("attacker" | "defender").
   * @param {ChatMessage}   message
   */
  static async onSkillAllocConfirm(event, btn, message) {
    const side = btn.dataset.side;
    const allocData = message.getFlag("neuroshima", "skillAlloc");
    if (!allocData || allocData.status !== "pending") return;

    const sideConfirmed = side === "attacker" ? allocData.attackerConfirmed : allocData.defenderConfirmed;
    if (sideConfirmed) return;

    const patch = { type: "confirm", side };
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");

    if (game.user.isGM) {
      await MeleeOpposedChat.applyAllocPatch(message.id, patch);
    } else if (game.neuroshima?.socket) {
      await game.neuroshima.socket.executeAsGM("applySkillAlloc", message.id, patch);
    }
  }

  /**
   * Wire up the interactive beast-action spending UI inside a result card.
   *
   * Reads `data-net-successes` from the `.beast-action-spending` section and manages:
   * - Pick buttons (`.beast-action-pick-btn`) — increment a specific action's counter,
   *   disabled when the remaining budget is insufficient for that action's cost.
   * - Undo buttons (`.beast-qty-undo`) — decrement the counter for an action.
   * - `.beast-remaining` display — live remaining success-point budget.
   * - Apply button — disabled until at least one success point has been allocated.
   *
   * This is a pure DOM mutation; no data is written until the GM clicks Apply.
   *
   * @param {HTMLElement} root - Root element of the rendered chat card.
   */
  static _bindBeastActionSpending(root) {
    const section = root.querySelector(".beast-action-spending");
    if (!section) return;

    const netSuccesses = parseInt(section.dataset.netSuccesses, 10) || 0;
    const remainingEl = section.querySelector(".beast-remaining");
    const applyBtn    = section.querySelector("[data-action='applyBeastActions']");

    const getSpent = () => {
      let total = 0;
      section.querySelectorAll(".beast-qty-value").forEach(el => {
        const qty  = parseInt(el.textContent, 10) || 0;
        const cost = parseInt(el.closest(".beast-action-row")?.dataset.actionCost, 10) || 1;
        total += qty * cost;
      });
      return total;
    };

    const updateUI = () => {
      const remaining = netSuccesses - getSpent();
      if (remainingEl) remainingEl.textContent = remaining;
      if (applyBtn) applyBtn.disabled = remaining === netSuccesses;
      section.querySelectorAll(".beast-action-pick-btn").forEach(btn => {
        btn.disabled = remaining < (parseInt(btn.dataset.cost, 10) || 1);
      });
    };

    section.querySelectorAll(".beast-action-pick-btn").forEach(pickBtn => {
      pickBtn.addEventListener("click", () => {
        const id   = pickBtn.dataset.actionId;
        const cost = parseInt(pickBtn.dataset.cost, 10) || 1;
        if (getSpent() + cost > netSuccesses) return;
        const qtyEl   = section.querySelector(`.beast-qty-value[data-action-id="${id}"]`);
        const badgeEl = section.querySelector(`.beast-qty-badge[data-action-id="${id}"]`);
        if (!qtyEl) return;
        qtyEl.textContent = (parseInt(qtyEl.textContent, 10) || 0) + 1;
        if (badgeEl) badgeEl.style.display = "";
        updateUI();
      });
    });

    section.querySelectorAll(".beast-qty-undo").forEach(undoBtn => {
      undoBtn.addEventListener("click", () => {
        const id    = undoBtn.dataset.actionId;
        const qtyEl   = section.querySelector(`.beast-qty-value[data-action-id="${id}"]`);
        const badgeEl = section.querySelector(`.beast-qty-badge[data-action-id="${id}"]`);
        if (!qtyEl) return;
        const cur = parseInt(qtyEl.textContent, 10) || 0;
        if (cur > 0) qtyEl.textContent = cur - 1;
        if (badgeEl && parseInt(qtyEl.textContent, 10) === 0) badgeEl.style.display = "none";
        updateUI();
      });
    });

    updateUI();
  }

  /**
   * Bind collapsible section toggles inside item-card chat messages.
   * Clicking a `.item-card-collapsible-header` toggles the `collapsed` class on the
   * next sibling and rotates the chevron icon.
   *
   * @param {HTMLElement} root
   */
  static _bindResultCardCollapsibles(root) {
    root.querySelectorAll(".neuroshima.item-card .item-card-collapsible-header").forEach(header => {
      header.addEventListener("click", () => {
        const content = header.nextElementSibling;
        if (!content) return;
        const isCollapsed = content.classList.toggle("collapsed");
        header.querySelector(".item-card-chevron")?.classList.toggle("expanded", !isCollapsed);
      });
    });
  }

  /**
   * Execute the required test embedded in a `requiredTest` chat card.
   *
   * Flow:
   * 1. Read `requiredTestData` from message flags.
   * 2. Resolve the rolling actor from the current user (controlled token → assigned character).
   * 3. Build a `resultCallback` that, after the roll resolves:
   *    - Applies condition consequences (`onSuccess` / `onFailure` arrays).
   *    - Applies ActiveEffect UUIDs (`onSuccessEffectUuids` / `onFailureEffectUuids`) to
   *      the defender actor identified by `defenderActorUuid`.
   * 4. For skill tests: use `testAttributeOverride` if set, otherwise auto-detect from
   *    `NEUROSHIMA.skillConfiguration`.
   * 5. Open `NeuroshimaSkillRollDialog` with the resolved stats and callback.
   *
   * @param {PointerEvent}  event
   * @param {ChatMessage}   message
   */
  static async onExecuteRequiredTest(event, message) {
    const data = message.getFlag("neuroshima", "requiredTestData");
    if (!data) return;

    const actor = game.user.character ?? canvas.tokens?.controlled?.[0]?.actor ?? null;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.RequiredTest.NoActor"));
      return;
    }

    const actorUuid = actor.uuid;

    const _applyEffectUuids = async (effectUuids, targetActor) => {
      if (!effectUuids?.length || !targetActor) return;
      for (const uuid of effectUuids) {
        try {
          const effectDoc = await fromUuid(uuid);
          if (!effectDoc) continue;
          const { _id, ...rest } = effectDoc.toObject();
          await ActiveEffect.implementation.create(
            { ...rest, disabled: false, transfer: false, origin: effectDoc.parent?.uuid ?? uuid },
            { parent: targetActor }
          );
        } catch (err) {
          console.error("Neuroshima | onExecuteRequiredTest | failed to apply effect uuid:", uuid, err);
        }
      }
      game.neuroshima?.log("onExecuteRequiredTest | effects applied", { actorUuid: targetActor.uuid, effectUuids });
    };

    let resultCallback = null;
    if (data.onSuccess || data.onFailure || data.onSuccessEffectUuids?.length || data.onFailureEffectUuids?.length) {
      const successConsequence = data.onSuccess ?? null;
      const failureConsequence = data.onFailure ?? null;
      resultCallback = async ({ isSuccess }) => {
        if (successConsequence || failureConsequence) {
          const consequence = isSuccess ? successConsequence : failureConsequence;
          if (consequence) {
            const actions = Array.isArray(consequence) ? consequence : [consequence];
            for (const action of actions) {
              if (action.addCondition) await actor.addCondition(action.addCondition, action.value ?? 1);
            }
          }
        }
        const effectUuids = isSuccess ? (data.onSuccessEffectUuids ?? []) : (data.onFailureEffectUuids ?? []);
        await _applyEffectUuids(effectUuids, actor);
        game.neuroshima?.log("onExecuteRequiredTest | consequence applied", { actorUuid, isSuccess });
      };
    }

    const { NeuroshimaSkillRollDialog } = await import("../apps/dialogs/skill-roll-dialog.js");
    const lastRoll = {
      ...(actor.system?.lastRoll ?? {}),
      isOpen: data.isOpen,
      baseDifficulty: data.baseDifficulty || actor.system?.lastRoll?.baseDifficulty || "average"
    };

    if (data.testType === "skill") {
      let attrKey = data.testAttributeOverride || "";
      if (!attrKey) {
        for (const [aKey, specs] of Object.entries(NEUROSHIMA.skillConfiguration ?? {})) {
          for (const skills of Object.values(specs)) {
            if (skills.includes(data.testKey)) { attrKey = aKey; break; }
          }
          if (attrKey) break;
        }
      }
      const stat = actor.system?.attributeTotals?.[attrKey] ?? 0;
      const skill = actor.system?.skillTotals?.[data.testKey] ?? actor.system?.skills?.[data.testKey]?.value ?? 0;
      const loc = `NEUROSHIMA.Skills.${data.testKey}`;
      const translated = game.i18n.localize(loc);
      const label = data.title || (translated !== loc ? translated : data.testKey);

      const dialog = new NeuroshimaSkillRollDialog({ actor, stat, skill, label, isSkill: true, skillKey: data.testKey, currentAttribute: attrKey, lastRoll, resultCallback });
      dialog.render(true);
    } else if (data.testType === "attribute") {
      const stat = actor.system?.attributeTotals?.[data.testKey] ?? 0;
      const attrDef = NEUROSHIMA.attributes?.[data.testKey];
      const label = data.title || (attrDef?.label ? game.i18n.localize(attrDef.label) : data.testKey);

      const dialog = new NeuroshimaSkillRollDialog({ actor, stat, skill: 0, label, isSkill: false, currentAttribute: data.testKey, lastRoll, resultCallback });
      dialog.render(true);
    }
  }

  /**
   * Handle click on "Rozpocznij walkę z celem" in a beast-engage-target chat card.
   * Reconstructs the synthetic weapon from the beast item stored in message flags,
   * then calls MeleeOpposedChat.initiateAttack against the current GM-selected target.
   *
   * @param {PointerEvent} event
   * @param {ChatMessage}  message
   */
  static async onEngageBeastTarget(event, message) {
    const data = message.getFlag("neuroshima", "beastEngageData");
    if (!data) return;

    const rawTargets = Array.from(game.user.targets ?? []);
    if (rawTargets.length === 0) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.BeastAction.EngageTarget.NoTarget"));
      return;
    }

    const attackerDoc = await fromUuid(data.attackerUuid);
    const attackerActor = attackerDoc?.actor ?? attackerDoc;
    if (!attackerActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.BeastAction.EngageTarget.NoAttacker"));
      return;
    }

    const myUuidsCheck = [attackerActor.uuid];
    if (attackerActor.token) myUuidsCheck.push(attackerActor.token.uuid);

    const sourceItems = data.beastItemId
      ? attackerActor.items.filter(i => i.id === data.beastItemId && i.type === "beast-action")
      : attackerActor.items.filter(i => i.type === "beast-action");

    const byTier = {};
    for (const item of sourceItems) {
      for (const act of (item.system.activities ?? [])) {
        const t = Math.min(3, Math.max(1, act.successCost ?? 1));
        if (!byTier[t]) byTier[t] = act.damage || "D";
      }
    }

    if (Object.keys(byTier).length === 0) return;

    const sourceItem = sourceItems[0];
    const syntheticWeapon = {
      id: null,
      beastItemId: sourceItem?.id ?? null,
      name: sourceItem?.name ?? attackerActor.name,
      img: sourceItem?.img ?? attackerActor.img,
      type: "weapon",
      system: {
        weaponType: "melee",
        attribute: sourceItem?.system?.attribute || "dexterity",
        skill: "experience",
        attackBonus: 0,
        defenseBonus: 0,
        damageMelee1: byTier[1] ?? byTier[2] ?? byTier[3] ?? "D",
        damageMelee2: byTier[2] ?? byTier[1] ?? byTier[3] ?? "D",
        damageMelee3: byTier[3] ?? byTier[2] ?? byTier[1] ?? "D",
        requiredBuild: 0,
        piercing: 0,
        magazine: null,
        jamming: 20
      }
    };

    const chatTargets = rawTargets.filter(t => !myUuidsCheck.includes(t.document.uuid));
    if (chatTargets.length === 0) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.BeastAction.EngageTarget.NoTarget"));
      return;
    }

    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.initiateAttack(attackerActor, syntheticWeapon, chatTargets[0].document.uuid, data.mode);
  }

  /**
   * Reconcile the current user's token targets with the given list of token IDs.
   * Tokens not in `tokenIds` are un-targeted; tokens in `tokenIds` but not yet
   * targeted are set as targets.  Uses `groupSelection` to avoid clearing unrelated targets.
   *
   * @param {string[]} tokenIds
   */
  static _setTokenTargets(tokenIds) {
    const currentIds = new Set(Array.from(game.user.targets).map(t => t.id));
    for (const t of Array.from(game.user.targets)) {
      if (!tokenIds.includes(t.id))
        t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
    }
    for (const id of tokenIds) {
      if (!currentIds.has(id)) {
        const t = canvas?.tokens?.get(id);
        if (t) t.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true });
      }
    }
  }

  /** Remove all current token targets for the current user. */
  static _clearTokenTargets() {
    for (const t of Array.from(game.user.targets)) {
      t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
    }
  }

  /**
   * Place a grenade blast circle template on the canvas.
   * After placement, computes blast zone damage for all tokens inside and posts a results chat message.
   */
  static async onPlaceGrenadeTemplate(event, btn, message) {
    return this.startGrenadeTemplatePlacement(message);
  }

  /**
   * Delete all existing grenade blast templates linked to `messageId` from the scene.
   * Delegates to the GM socket helper so the operation always runs with GM permissions.
   *
   * @param {string} messageId
   */
  static async _deleteExistingGrenadeTemplates(messageId) {
    if (!canvas?.scene || !messageId) return;
    const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");
    await NeuroshimaSocket.gmExecute("deleteGrenadeTemplates", messageId);
  }

  /**
   * Place a grenade blast-circle template at a specific canvas point.
   *
   * Clears any pre-existing templates for the same message, snaps the point to grid
   * centre (when possible), then delegates template creation to the GM socket helper.
   *
   * @param {ChatMessage}       message
   * @param {{ x: number, y: number }} point - Canvas coordinates.
   */
  static async placeGrenadeTemplateAt(message, point) {
    if (!canvas?.scene) return;

    const grenadeData = message.getFlag("neuroshima", "grenadeRoll");
    if (!grenadeData) return;

    const radius     = Number(grenadeData.templateRadius ?? 0);
    const blastZones = grenadeData.blastZones ?? [];
    if (!radius) return;

    await this._deleteExistingGrenadeTemplates(message.id);

    const snapPos = (x, y) => {
      try {
        if (canvas.grid?.getSnappedPoint)
          return canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
        return { x, y };
      } catch (e) { return { x, y }; }
    };

    const snapped = snapPos(point.x, point.y);

    const templateData = {
      t: "circle",
      user: game.user.id,
      x: snapped.x,
      y: snapped.y,
      distance: radius,
      fillColor: game.user.color ?? "#FF0000",
      flags: {
        neuroshima: {
          isGrenadeTemplate: true,
          grenadeBlastZones: blastZones,
          grenadeMessageId: message.id
        }
      }
    };

    const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");
    await NeuroshimaSocket.gmExecute("createGrenadeTemplate", templateData);
  }

  /**
   * Enter grenade-template placement mode.
   *
   * Validates that there is an active scene and that the grenade roll has a non-zero blast radius,
   * then attaches a one-shot `click` listener to the canvas that resolves the drop point and
   * calls `placeGrenadeTemplateAt`.
   *
   * @param {ChatMessage} message
   */
  static async startGrenadeTemplatePlacement(message) {
    if (!canvas?.scene) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoScene"));
      return;
    }

    const grenadeData = message.getFlag("neuroshima", "grenadeRoll");
    if (!grenadeData) return;

    const radius     = Number(grenadeData.templateRadius ?? 0);
    const blastZones = grenadeData.blastZones ?? [];

    if (!radius) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Grenade.NoRadius"));
      return;
    }

    await this._deleteExistingGrenadeTemplates(message.id);

    const templateData = {
      t: "circle",
      user: game.user.id,
      x: 0,
      y: 0,
      distance: radius,
      fillColor: game.user.color ?? "#FF0000",
      flags: {
        neuroshima: {
          isGrenadeTemplate: true,
          grenadeBlastZones: blastZones,
          grenadeMessageId: message.id
        }
      }
    };

    canvas.templates.activate();

    const doc = new CONFIG.MeasuredTemplate.documentClass(templateData, { parent: canvas.scene });
    let previewObj = null;

    try {
      previewObj = new CONFIG.MeasuredTemplate.objectClass(doc);
      canvas.templates.preview.addChild(previewObj);
      await previewObj.draw();
    } catch (e) {
      console.warn("Neuroshima | Template preview draw failed:", e);
      previewObj = null;
    }

    const snapPos = (x, y) => {
      try {
        if (canvas.grid?.getSnappedPoint) {
          return canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
        }
        return canvas.grid?.getSnappedPosition?.(x, y, 1) ?? { x, y };
      } catch (e) { return { x, y }; }
    };

    const updateDynamicTargets = (originX, originY) => {
      if (!previewObj?.shape || !canvas?.tokens?.placeables) return;
      const gs = canvas.grid?.size ?? 100;
      const targetIds = canvas.tokens.placeables
        .filter(tokenObj => {
          const td = tokenObj.document;
          const cx = td.x + (td.width  * gs) / 2;
          const cy = td.y + (td.height * gs) / 2;
          return previewObj.shape.contains(cx - originX, cy - originY);
        })
        .map(t => t.id);
      NeuroshimaChatMessage._setTokenTargets(targetIds);
    };

    const updatePreview = (x, y) => {
      const pos = snapPos(x, y);
      try { doc.updateSource(pos); previewObj?.refresh?.(); } catch (e) {}
      updateDynamicTargets(pos.x, pos.y);
    };

    const cleanup = (clearTargets = true) => {
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onDown);
      canvas.stage.off("rightdown", onRight);
      if (clearTargets) NeuroshimaChatMessage._clearTokenTargets();
      if (previewObj) {
        try { canvas.templates.preview.removeChild(previewObj); previewObj.destroy({ children: true }); } catch (e) {}
        previewObj = null;
      }
    };

    const onMove = (pixi_event) => {
      try {
        const global = pixi_event.global ?? pixi_event.data?.global;
        if (!global) return;
        const pos = canvas.stage.toLocal(global);
        updatePreview(pos.x, pos.y);
      } catch (e) {}
    };

    const onDown = async (pixi_event) => {
      const button = pixi_event.button ?? pixi_event.data?.button;
      if (button !== 0) return;
      try {
        const global = pixi_event.global ?? pixi_event.data?.global;
        const raw = global ? canvas.stage.toLocal(global) : { x: doc.x, y: doc.y };
        const snapped = snapPos(raw.x, raw.y);
        cleanup(false);
        const data = { ...templateData, ...snapped };
        const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");
        await NeuroshimaSocket.gmExecute("createGrenadeTemplate", data);
      } catch (e) {
        console.error("Neuroshima | Template placement failed:", e);
        cleanup();
      }
    };

    const onRight = () => { cleanup(true); };

    canvas.stage.on("pointermove", onMove);
    canvas.stage.on("pointerdown", onDown);
    canvas.stage.on("rightdown", onRight);
  }

  /**
   * Compute grenade blast damage for tokens within a placed template.
   * Targets all tokens inside the radius, rolls random locations, and posts a
   * damage-application card with a collapsible per-target damage section.
   * @param {MeasuredTemplateDocument} templateDoc
   * @param {Array} blastZones
   * @param {Actor|null} sourceActor
   * @param {ChatMessage|null} sourceMessage
   */
  static async _computeGrenadeBlast(templateDoc, blastZones, sourceActor, sourceMessage) {
    game.neuroshima.group("_computeGrenadeBlast");

    let templateObj = canvas.templates.get(templateDoc.id);
    if (!templateObj?.shape) {
      await new Promise(r => setTimeout(r, 150));
      templateObj = canvas.templates.get(templateDoc.id);
    }

    game.neuroshima.log("Stan szablonu", {
      templateId: templateDoc.id, found: !!templateObj, hasShape: !!templateObj?.shape,
      blastZonesCount: blastZones.length, tokenCount: canvas.scene.tokens.size
    });

    if (!templateObj?.shape) {
      game.neuroshima.log("ERROR: missing PIXI template object after delay");
      game.neuroshima.groupEnd();
      return;
    }

    const originX     = templateDoc.x;
    const originY     = templateDoc.y;
    const gs          = canvas.grid.size;
    const gridDist    = canvas.scene.grid.distance || 1;
    const NS          = game.neuroshima?.config ?? {};
    const bodyLocs    = NS.bodyLocations ?? {};

    const resolveLocation = async () => {
      const roll = await new Roll("1d20").evaluate();
      const val  = roll.total;
      const entry = Object.entries(bodyLocs).find(([, d]) => d.roll && val >= d.roll[0] && val <= d.roll[1]);
      return entry ? { key: entry[0], label: entry[1].label } : { key: "torso", label: "NEUROSHIMA.Location.Torso" };
    };

    const sortedZones = [...blastZones].sort((a, b) => a.radius - b.radius);
    const rawResults = [];
    const targetIds = [];

    for (const tokenDoc of canvas.scene.tokens) {
      const centerX = tokenDoc.x + (tokenDoc.width  * gs) / 2;
      const centerY = tokenDoc.y + (tokenDoc.height * gs) / 2;
      const relX    = centerX - originX;
      const relY    = centerY - originY;
      if (!templateObj.shape.contains(relX, relY)) continue;

      targetIds.push(tokenDoc.id);

      const pixelDist = Math.sqrt(relX * relX + relY * relY);
      const metres    = (pixelDist / gs) * gridDist;
      const zone      = sortedZones.find(z => metres <= z.radius);

      game.neuroshima.log(`Token ${tokenDoc.name}`, { metres: metres.toFixed(2), zone });

      const actor     = tokenDoc.actor;
      const tokenName = tokenDoc.name || actor?.name || "?";

      const shrapnelCount = zone?.shrapnel ?? 0;
      const damage        = zone?.damage ?? "none";
      const loc = damage !== "none" ? await resolveLocation() : null;

      rawResults.push({
        tokenName,
        tokenId:       tokenDoc.id,
        actorId:       actor?.id ?? null,
        actorUuid:     actor?.uuid ?? null,
        distanceM:     Math.round(metres * 10) / 10,
        damage,
        locationKey:   loc?.key ?? null,
        locationLabel: loc?.label ?? null,
        knockdown:     zone?.knockdown ?? false,
        shrapnelCount
      });
    }

    NeuroshimaChatMessage._setTokenTargets(targetIds);
    game.neuroshima.log("Wyniki wybuchu", { rawResultsCount: rawResults.length });

    if (!rawResults.length) {
      game.neuroshima.groupEnd();
      ui.notifications.info(game.i18n.localize("NEUROSHIMA.Grenade.NoTargetsInBlast"));
      return;
    }

    game.neuroshima.log("Wyniki wybuchu", { rawResultsCount: rawResults.length });

    if (sourceMessage) {
      const origData = sourceMessage.getFlag("neuroshima", "grenadeRoll") ?? {};
      const updatedChatData = {
        ...origData,
        blastResults: rawResults,
        damageApplied: false
      };
      const newContent = await this._renderTemplate(
        "systems/neuroshima/templates/chat/grenade-roll-card.hbs",
        updatedChatData
      );
      await sourceMessage.update({
        content: newContent,
        "flags.neuroshima.grenadeRoll": updatedChatData,
        "flags.neuroshima.grenadeResults": rawResults,
        "flags.neuroshima.damageApplied": false
      });
      game.neuroshima.log("Explosion results added to existing message");
    } else {
      const grenadeLabel = sourceActor?.name ?? game.i18n.localize("NEUROSHIMA.Items.Type.Weapon");
      const context = {
        actorId:         sourceActor?.id ?? null,
        actorImg:        sourceActor?.img ?? "icons/svg/mystery-man.svg",
        grenadeLabel,
        blastResults:    rawResults,
        damageApplied:   false
      };
      const template = "systems/neuroshima/templates/chat/grenade-blast-result.hbs";
      const content  = await this._renderTemplate(template, context);
      await this.create({
        user:    game.user.id,
        speaker: sourceActor ? ChatMessage.getSpeaker({ actor: sourceActor }) : undefined,
        content,
        style:   CONST.CHAT_MESSAGE_STYLES.OTHER,
        flags: {
          neuroshima: {
            messageType:    "grenadeBlastResult",
            actorId:        sourceActor?.id ?? null,
            grenadeResults: rawResults,
            damageApplied:  false
          }
        }
      });
    }

    game.neuroshima.log("Explosion results card published");
    game.neuroshima.groupEnd();
  }

  /**
   * Apply grenade blast damage to all targets listed in the blast result card.
   * Runs pain resistance rolls via CombatHelper infrastructure for each target.
   */
  static async onApplyGrenadeDamage(event, message) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.GMOnly"));
      return;
    }

    if (message.getFlag("neuroshima", "damageApplied")) {
      ui.notifications.info(game.i18n.localize("NEUROSHIMA.Grenade.BlastDamageApplied"));
      return;
    }

    const grenadeResults = message.getFlag("neuroshima", "grenadeResults")
      ?? message.getFlag("neuroshima", "grenadeRoll")?.blastResults
      ?? [];
    if (!grenadeResults.length) return;

    const btn = event.currentTarget;
    btn.disabled = true;

    const { CombatHelper } = await import("../helpers/combat-helper.js");

    const grenadeLabel = message.getFlag("neuroshima", "grenadeLabel")
      ?? message.getFlag("neuroshima", "grenadeRoll")?.label
      ?? game.i18n.localize("NEUROSHIMA.Items.Type.Weapon");

    const NS         = game.neuroshima?.config ?? {};
    const bodyLocs   = NS.bodyLocations ?? {};

    const resolveLocation = async () => {
      const roll  = await new Roll("1d20").evaluate();
      const val   = roll.total;
      const entry = Object.entries(bodyLocs).find(([, d]) => d.roll && val >= d.roll[0] && val <= d.roll[1]);
      return entry ? { key: entry[0], label: entry[1].label } : { key: "torso", label: "NEUROSHIMA.Location.Torso" };
    };

    const actorDamages = [];

    for (const result of grenadeResults) {
      if (!result.actorUuid && !result.actorId) continue;

      let actor = null;
      if (result.actorUuid) {
        const doc = await fromUuid(result.actorUuid);
        actor = doc?.actor ?? doc;
      }
      if (!actor && result.actorId) actor = game.actors.get(result.actorId);
      if (!actor) continue;

      const combinedResults        = [];
      const combinedWoundIds       = [];
      let   combinedReduced        = 0;
      const combinedReducedDetails = [];
      const shrapnelRolled         = [];

      if (result.damage && result.damage !== "none" && result.locationKey) {
        const attackData = {
          damage:         result.damage,
          finalLocation:  result.locationKey,
          label:          grenadeLabel,
          isMelee:        false,
          isGrenade:      true,
          piercing:       0,
          hitBulletsData: [{ damage: result.damage, piercing: 0, successPoints: 1 }]
        };
        const partial = await CombatHelper.applyDamageToActor(actor, attackData, {
          location:          result.locationKey,
          attackerMessageId: message.id,
          suppressChat:      true
        });
        if (partial) {
          combinedResults.push(...(partial.results ?? []));
          combinedWoundIds.push(...(partial.woundIds ?? []));
          combinedReduced += partial.reducedProjectiles ?? 0;
          combinedReducedDetails.push(...(partial.reducedDetails ?? []));
        }
      }

      const shrapnelCount = result.shrapnelCount ?? 0;
      for (let s = 0; s < shrapnelCount; s++) {
        const sRoll = await new Roll("1d20").evaluate();
        const sv    = sRoll.total;
        let sDmg    = null;
        if      (sv <= 5)  sDmg = "C";
        else if (sv <= 10) sDmg = "L";
        else if (sv <= 15) sDmg = "D";

        const sLoc = await resolveLocation();
        shrapnelRolled.push({ roll: sv, damage: sDmg, locationKey: sLoc.key, locationLabel: sLoc.label });

        if (sDmg) {
          const sAttack = {
            damage:         sDmg,
            finalLocation:  sLoc.key,
            label:          grenadeLabel + " (fragment)",
            isMelee:        false,
            isGrenade:      true,
            piercing:       0,
            hitBulletsData: [{ damage: sDmg, piercing: 0, successPoints: 1 }]
          };
          const sPartial = await CombatHelper.applyDamageToActor(actor, sAttack, {
            location:          sLoc.key,
            attackerMessageId: message.id,
            suppressChat:      true
          });
          if (sPartial) {
            combinedResults.push(...(sPartial.results ?? []));
            combinedWoundIds.push(...(sPartial.woundIds ?? []));
            combinedReduced += sPartial.reducedProjectiles ?? 0;
            combinedReducedDetails.push(...(sPartial.reducedDetails ?? []));
          }
        }
      }

      actorDamages.push({
        actorId:              actor.id,
        actorUuid:            actor.uuid,
        actorName:            actor.name,
        distanceM:            result.distanceM,
        damage:               result.damage,
        locationLabel:        result.locationLabel,
        knockdown:            result.knockdown,
        shrapnelRolled,
        results:              combinedResults,
        woundIds:             combinedWoundIds,
        reducedCount:         combinedReduced,
        reducedDetails:       combinedReducedDetails,
        passedCount:          combinedResults.filter(r => !r.isCritical && r.isPassed).length,
        failedCount:          combinedResults.filter(r => !r.isCritical && !r.isPassed).length,
        criticalCount:        combinedResults.filter(r => r.isCritical).length
      });
    }

    if (actorDamages.length > 0) {
      const allWoundIds = actorDamages.flatMap(d => d.woundIds);
      const content = await this._renderTemplate(
        "systems/neuroshima/templates/chat/grenade-blast-pain-report.hbs",
        { grenadeLabel, actorDamages, config: NEUROSHIMA ?? game.neuroshima?.config }
      );
      await this.create({
        user:    game.user.id,
        content,
        style:   CONST.CHAT_MESSAGE_STYLES.OTHER,
        flags: {
          neuroshima: {
            messageType:  "grenadeBlastReport",
            grenadeLabel,
            actorDamages,
            allWoundIds,
            isReversed:   false
          }
        }
      });
    }

    await message.setFlag("neuroshima", "damageApplied", true);

    const grenadeRollData = message.getFlag("neuroshima", "grenadeRoll");
    if (grenadeRollData) {
      const updatedData = { ...grenadeRollData, damageApplied: true };
      const newContent = await this._renderTemplate(
        "systems/neuroshima/templates/chat/grenade-roll-card.hbs",
        updatedData
      );
      await message.update({
        content: newContent,
        "flags.neuroshima.grenadeRoll": updatedData
      });
    } else {
      btn.textContent = "✓ " + game.i18n.localize("NEUROSHIMA.Grenade.BlastDamageApplied");
      btn.classList.add("applied");
    }
  }

  /**
   * Handle a healing test re-roll.
   */
  static async onRerollHealing(event, message) {
    const btn = event.currentTarget;
    const woundId = btn.dataset.woundId;
    const card = btn.closest(".healing-batch-report");
    const patientUuid = card?.dataset.patientUuid;
    const medicUuid = card?.dataset.medicUuid;
    
    if (!patientUuid || !medicUuid) return;

    const patient = await fromUuid(patientUuid);
    const medic = await fromUuid(medicUuid);
    
    if (!patient || !medic) return;

    // Read healing data from message flags
    const flags = message.getFlag("neuroshima");
    const method = flags.healingMethod;
    const extraData = flags.extraData || {};
    const woundConfig = extraData.woundConfigs?.find(c => c.woundId === woundId);
    
    if (!woundConfig) {
        ui.notifications.warn("Nie znaleziono konfiguracji rany dla przerzutu.");
        return;
    }

    // Trigger reroll via NeuroshimaDice
    const { NeuroshimaDice } = await import("../helpers/dice.js");
    const newResult = await NeuroshimaDice.rerollHealingTest(
        medic, 
        patient, 
        method, 
        woundConfig,
        extraData.stat,
        extraData.skillBonus,
        extraData.attributeBonus
    );

    if (newResult) {
        // Update the results list in the message
        const results = [...(flags.results || [])];
        const idx = results.findIndex(r => r.woundId === woundId);
        if (idx !== -1) {
            results[idx] = {
                ...results[idx],
                ...newResult
            };
            
            const successCount = results.filter(r => r.isSuccess).length;
            const failedCount = results.length - successCount;

            const context = {
                medicActor: medic,
                patientActor: patient,
                results,
                method,
                successCount,
                failedCount,
                patientRef: { uuid: patient.uuid },
                medicRef: { uuid: medic.uuid },
                config: NEUROSHIMA
            };

            const template = "systems/neuroshima/templates/chat/healing-roll-card.hbs";
            const content = await this._renderTemplate(template, context);

            await message.update({
                content,
                "flags.neuroshima.results": results
            });
        }
    }
  }

  /**
   * Aplikuje wyniki leczenia do aktora.
   */
  static async onApplyHealing(event, message) {
    const btn = event.currentTarget;
    const card = btn.closest(".healing-batch-report");
    const patientUuid = card?.dataset.patientUuid;
    if (!patientUuid) return;

    const patient = await fromUuid(patientUuid);
    if (!patient) return;

    const results = message.getFlag("neuroshima", "results") || [];
    const healingMethod = message.getFlag("neuroshima", "healingMethod");
    const extraData = message.getFlag("neuroshima", "extraData") || {};
    const isFirstAid = healingMethod === "firstAid";
    const updates = [];
    const toDelete = [];

    for (const r of results) {
        const wound = patient.items.get(r.woundId);
        if (!wound || wound.type !== "wound") continue;

        const hEffect = r.healingEffect;
        if (!hEffect) continue;

        const isSuccess = r.isSuccess;
        const oldPenalty = wound.system.penalty || 0;
        const origPenalty = wound.system.originalPenalty ?? oldPenalty;
        const firstAidApplied = wound.system.firstAidHealingApplied || 0;
        const hadFirstAid = wound.system.hadFirstAid || false;

        const woundCfg = extraData.woundConfigs?.find(c => c.woundId === r.woundId);
        const healingModifier = woundCfg?.healingModifier || 0;

        let penaltyChange;
        if (isSuccess) {
            penaltyChange = isFirstAid ? -5 : (hadFirstAid ? -10 : -15);
        } else {
            penaltyChange = 5;
        }
        penaltyChange += healingModifier;

        let newPenalty = Math.max(0, oldPenalty + penaltyChange);

        if (isSuccess) {
            if (isFirstAid) {
                const faRemaining = Math.max(0, 5 - firstAidApplied);
                newPenalty = Math.max(oldPenalty - faRemaining, newPenalty);
            }
            newPenalty = Math.max(origPenalty - 15, newPenalty);
            newPenalty = Math.max(0, newPenalty);
        }

        const updateData = {
            _id: r.woundId,
            "system.healingAttempts": (wound.system.healingAttempts || 0) + 1
        };

        if (wound.system.originalPenalty === null || wound.system.originalPenalty === undefined) {
            updateData["system.originalPenalty"] = oldPenalty;
        }

        if (isSuccess) {
            updateData["system.isHealing"] = true;
            if (isFirstAid) {
                updateData["system.hadFirstAid"] = true;
                const actualHealed = oldPenalty - newPenalty;
                updateData["system.firstAidHealingApplied"] = firstAidApplied + actualHealed;
                updateData["system.failedFirstAidAttempts"] = 0;
            } else {
                updateData["system.failedTreatmentAttempts"] = 0;
            }
        } else {
            if (isFirstAid) {
                updateData["system.failedFirstAidAttempts"] = (wound.system.failedFirstAidAttempts || 0) + 1;
            } else {
                updateData["system.failedTreatmentAttempts"] = (wound.system.failedTreatmentAttempts || 0) + 1;
            }
        }

        if (newPenalty <= 0) {
            toDelete.push(r.woundId);
        } else {
            updateData["system.penalty"] = newPenalty;
            updates.push(updateData);
        }
    }

    if (!patient.isOwner && !game.user.isGM) {
        const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");
        return NeuroshimaSocket.gmExecute("applyHealingBatch", {
            patientUuid: patient.uuid,
            results: results,
            messageId: message.id
        });
    }

    if (updates.length > 0) {
        await patient.updateEmbeddedDocuments("Item", updates);
    }
    
    if (toDelete.length > 0) {
        await patient.deleteEmbeddedDocuments("Item", toDelete);
    }

    await message.setFlag("neuroshima", "healingApplied", true);
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.Notifications.HealingApplied"));
  }

  /**
   * Otwiera panel leczenia.
   */
  static async onOpenHealPanel(event, message) {
    const patientUuid = message.getFlag("neuroshima", "patientUuid");
    const medicUuid = message.getFlag("neuroshima", "medicUuid") || game.user.character?.uuid;
    
    const { HealingApp } = await import("../apps/healing-app.js");
    const app = new HealingApp({
        patientRef: { uuid: patientUuid },
        medicRef: { uuid: medicUuid }
    });
    app.render(true);
  }

  /**
   * Message type constants: 'roll' | 'weapon' | 'painResistance'
   */
  static TYPES = {
    ROLL: 'roll',
    WEAPON: 'weapon',
    PAIN_RESISTANCE: 'painResistance',
    INITIATIVE: 'initiative'
  };

  /**
   * Renders a skill/attribute test card.
   */
  static async renderRoll(rollData, actor, roll) {
    const template = "systems/neuroshima/templates/chat/roll-card.hbs";
    const content = await this._renderTemplate(template, {
      ...rollData,
      config: NEUROSHIMA,
      showTooltip: this._canShowTooltip(actor)
    });

    const rollMode = rollData.rollMode || game.settings.get("core", "rollMode");
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: this.TYPES.ROLL,
          rollData: {
            ...rollData,
            rollMode: rollMode
          }
        }
      }
    };

    ChatMessage.applyRollMode(chatData, rollMode);
    return this.create(chatData);
  }

  /**
   * Renders an initiative test card.
   */
  static async renderInitiativeRoll(rollData, actor, roll) {
    const template = "systems/neuroshima/templates/chat/initiative-roll-card.hbs";
    
    // Pobranie danych o celach (dla inicjatywy zwarcia)
    let targetsData = [];
    if (rollData.isInitiative && rollData.targets?.length > 0) {
        for (const targetId of rollData.targets) {
            let targetActor = game.actors.get(targetId);
            if (!targetActor) {
                const doc = await fromUuid(targetId);
                targetActor = doc?.actor || doc;
            }
            if (targetActor) {
                targetsData.push({
                    id: targetActor.id,
                    name: targetActor.name,
                    img: targetActor.img
                });
            }
        }
    }

    const content = await this._renderTemplate(template, {
      ...rollData,
      meleeTargets: targetsData,
      config: NEUROSHIMA,
      showTooltip: this._canShowTooltip(actor),
      isVanillaMelee: false
    });

    const rollMode = rollData.rollMode || game.settings.get("core", "rollMode");
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: this.TYPES.INITIATIVE,
          rollData: {
            ...rollData,
            rollMode: rollMode
          }
        }
      }
    };

    ChatMessage.applyRollMode(chatData, rollMode);
    return this.create(chatData);
  }

  /**
   * Renders a weapon test card.
   */
  static async renderWeaponRoll(rollData, actor, roll) {
    const template = rollData.isMelee 
      ? "systems/neuroshima/templates/chat/melee-roll-card.hbs"
      : "systems/neuroshima/templates/chat/weapon-roll-card.hbs";
      
    // Fetch target actor data for melee roll cards
    let targetsData = [];
    if (rollData.isMelee && rollData.meleeAction === "attack" && rollData.targets?.length > 0) {
        for (const targetId of rollData.targets) {
            let targetActor = game.actors.get(targetId);
            if (!targetActor) {
                const doc = await fromUuid(targetId);
                targetActor = doc?.actor || doc;
            }
            if (targetActor) {
                targetsData.push({
                    id: targetActor.id,
                    name: targetActor.name,
                    img: targetActor.img
                });
            }
        }
    }

    let snapshotTargets = [];
    if (!rollData.isMelee) {
        for (const token of game.user.targets) {
            const targetActor = token.actor;
            if (targetActor) {
                snapshotTargets.push({
                    id: targetActor.id,
                    uuid: targetActor.uuid,
                    name: targetActor.name,
                    img: token.document?.texture?.src || targetActor.img
                });
            }
        }
    }

    const content = await this._renderTemplate(template, {
      ...rollData,
      meleeTargets: targetsData,
      config: NEUROSHIMA,
      showTooltip: this._canShowTooltip(actor),
      isVanillaMelee: false
    });

    const rollMode = rollData.rollMode || game.settings.get("core", "rollMode");
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: this.TYPES.WEAPON,
          rollData: {
            ...rollData,
            rollMode,
            snapshotTargets
          }
        }
      }
    };

    ChatMessage.applyRollMode(chatData, rollMode);
    return this.create(chatData);
  }

  /**
   * Renders a healing request card.
   */
  static async renderHealingRequest(patientActor, medicActor, requesterId, options = {}) {
    const { medicUserId = null, isPrivate = false } = options;
    const template = "systems/neuroshima/templates/chat/healing-request.hbs";
    const patientData = game.neuroshima.CombatHelper.generatePatientCard(patientActor);
    const requester = game.users.get(requesterId);

    const context = {
      ...patientData,
      requesterName: requester?.name || game.user.name,
      patientCardVersion: "short",
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);

    const gmUserIds  = game.users.filter(u => u.isGM).map(u => u.id);
    const whisperIds = [...new Set([medicUserId, ...gmUserIds].filter(Boolean))];

    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: patientActor }),
      content: content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      whisper: whisperIds,
      flags: {
        neuroshima: {
          messageType: "healingRequest",
          patientUuid: patientActor.uuid,
          medicUuid: medicActor?.uuid ?? null
        }
      }
    });
  }

  /**
   * Renders a Patient Card to chat.
   */
  static async renderPatientCard(actor) {
    const template = "systems/neuroshima/templates/chat/patient-card.hbs";
    const patientData = game.neuroshima.CombatHelper.generatePatientCard(actor);
    const context = {
      ...patientData,
      config: NEUROSHIMA,
      isGM: game.user.isGM
    };

    const content = await this._renderTemplate(template, context);
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "patientCard",
          actorId: actor.id,
          actorUuid: actor.uuid
        }
      }
    });
  }

  /**
   * Renders a Pain Resistance report.
   */
  static async renderPainResistance(actor, results, woundIds, reducedCount = 0, reducedDetails = [], options = {}) {
    const template = "systems/neuroshima/templates/chat/pain-resistance-report.hbs";
    
    const normalResults = results.filter(r => !r.isCritical);
    const passedCount = normalResults.filter(r => r.isPassed).length;
    const failedCount = normalResults.filter(r => !r.isPassed).length;
    const criticalCount = results.filter(r => r.isCritical).length;

    const context = {
      actorName: actor.name,
      actorId: actor.id,
      actorUuid: actor.uuid,
      results: results,
      woundIds: woundIds,
      passedCount,
      failedCount,
      criticalCount,
      reducedCount,
      reducedDetails,
      sourceInfo: options.sourceInfo || "",
      armorReductionOnly: options.armorReductionOnly || false,
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "painResistanceReport",
          actorId: actor.id,
          actorUuid: actor.uuid,
          woundIds,
          results,
          isReversed: false
        }
      }
    });
  }

  /**
   * Renders a Vehicle Durability test report (single or burst hit).
   */
  static async renderVehicleDamage(actor, results, negatedItems, woundIds, sourceLabel = "") {
    const template = "systems/neuroshima/templates/chat/vehicle-damage-report.hbs";

    const passedCount  = results.filter(r => r.isPassed).length;
    const failedCount  = results.filter(r => !r.isPassed).length;
    const negatedCount = negatedItems.length;

    const context = {
      actorName:    actor.name,
      actorId:      actor.id,
      actorUuid:    actor.uuid,
      results,
      negatedItems,
      woundIds,
      passedCount,
      failedCount,
      negatedCount,
      sourceInfo: sourceLabel ? `<em>${sourceLabel}</em>` : "",
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);

    return this.create({
      user:    game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      style:   CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType:     "vehicleDamageReport",
          actorId:         actor.id,
          actorUuid:       actor.uuid,
          woundIds,
          results,
          isReversed:      false,
          isVehicleDamage: true
        }
      }
    });
  }

  /**
   * Renders a healing roll card.
   */
  static async renderHealingRoll(medicActor, rollData) {
    const template = "systems/neuroshima/templates/chat/healing-roll-card.hbs";
    
    const context = {
      ...rollData,
      patientRef: { uuid: rollData.patientActor?.uuid },
      medicRef: { uuid: medicActor?.uuid },
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: medicActor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "healingRoll",
          rollData: {
            ...rollData,
            medicId: medicActor?.id,
            patientId: rollData.patientActor?.id
          }
        }
      }
    });
  }

  /**
   * Renderuje raport zbiorczy z leczenia wielu ran.
   */
  static async renderHealingBatchResults(medicActor, patientActor, results, method, extraData = {}) {
    const template = "systems/neuroshima/templates/chat/healing-roll-card.hbs";
    
    if (!Array.isArray(results)) {
        game.neuroshima?.error("renderHealingBatchResults: results is not an array", results);
        return;
    }

    const successCount = results.filter(r => r.isSuccess).length;
    const failedCount = results.filter(r => !r.isSuccess).length;

    const successTooltip = results.filter(r => r.isSuccess).map(r => `<div>${r.woundName} (${r.damageType})</div>`).join("");
    const failedTooltip = results.filter(r => !r.isSuccess).map(r => `<div>${r.woundName} (${r.damageType})</div>`).join("");

    const context = {
      medicActor,
      patientActor,
      results,
      method,
      successCount,
      failedCount,
      successTooltip,
      failedTooltip,
      patientRef: { uuid: patientActor.uuid },
      medicRef: { uuid: medicActor?.uuid },
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: medicActor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "healingBatchReport",
          results,
          healingMethod: method,
          patientUuid: patientActor.uuid,
          medicUuid: medicActor?.uuid,
          healingApplied: false,
          extraData: extraData
        }
      }
    });
  }

  /**
   * Helper for rendering Handlebars templates.
   */
  static async _renderTemplate(template, context) {
    // v13+ pattern
    if (foundry.applications?.handlebars?.renderTemplate) {
        return await foundry.applications.handlebars.renderTemplate(template, context);
    }
    // Fallback for v12/v11
    if (typeof renderTemplate === "function") {
        return await foundry.applications.handlebars.renderTemplate(template, context);
    }
    return "";
  }

  /**
   * Renders a chat message when a player clears a weapon jam.
   * @param {Actor} actor   - The actor who cleared the jam
   * @param {Item}  weapon  - The weapon that was jammed
   */
  static async renderUnjam(actor, weapon) {
    const text = game.i18n.format("NEUROSHIMA.Weapon.UnjamMessage", { weapon: weapon.name });
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="neuroshima roll-card">
        <header class="roll-header">
          <div class="actor-image-container">
            <img src="${actor.img}" width="32" height="32" title="${actor.name}"/>
          </div>
          <div class="header-details">
            <div class="test-info">${text}</div>
          </div>
        </header>
      </div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "weaponUnjam",
          actorId: actor.id,
          weaponId: weapon.id
        }
      }
    });
  }

  /**
   * Checks whether the current user can see roll tooltips.
   */
  static _canShowTooltip(actor) {
    const minRole = game.settings.get("neuroshima", "rollTooltipMinRole");
    if (game.user.role >= minRole) return true;
    if (game.settings.get("neuroshima", "rollTooltipOwnerVisibility") && actor?.isOwner) return true;
    return false;
  }

  /**
   * Generates a tooltip label for a damage type.
   */
  static _getDamageTooltip(damageType) {
    if (!damageType) return "";
    const types = damageType.split("/").map(t => t.trim());
    const labels = types.map(t => {
      const config = NEUROSHIMA.woundConfiguration[t];
      return config ? game.i18n.localize(config.label) : t;
    });
    return labels.join(" / ");
  }

  static async showItemCardLimitDialog() {
    const content = `
      <div class="neuroshima item-card-limit-dialog">
        <h4 class="item-card-limit-heading">${game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Label")}</h4>
        <div class="form-group">
          <div class="form-fields">
            <input type="number" name="limit" min="1" placeholder="∞" autofocus style="width:100%">
          </div>
        </div>
      </div>
    `;
    return foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Title") },
      content,
      buttons: [
        {
          action: "confirm",
          label: game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Confirm"),
          icon: "fas fa-check",
          default: true,
          callback: (event, button) => {
            const val = button.form.elements.limit.value.trim();
            return val ? parseInt(val) : "unlimited";
          }
        },
        {
          action: "cancel",
          label: game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Cancel"),
          icon: "fas fa-times",
          callback: () => "cancel"
        }
      ],
      classes: ["neuroshima"],
      rejectClose: false
    });
  }

  static buildItemChatStats(item) {
    const loc = (key) => game.i18n.localize(key);
    const s = item.system;
    const stats = [];
    let armorRatings = null;
    let armorBoxStats = null;
    let magazineContents = null;
    let containerContents = null;
    let containerLocked = false;
    let weight = null;
    let availability = null;
    let hasWeight = false;
    const dash = "—";
    const actor = item.actor;
    let attachedMods;
    if (actor) {
      attachedMods = [];
      for (const modItem of actor.items) {
        if (!["weapon-mod", "armor-mod"].includes(modItem.type)) continue;
        const parentId = modItem.getFlag?.("neuroshima", "modParentId");
        if (parentId !== item.id) continue;
        const modState = s.mods?.[modItem.id];
        if (!modState?.attached) continue;
        attachedMods.push({
          name: modItem.name,
          img: modItem.img,
          effectText: NeuroshimaScriptRunner._resolveItemRef(modItem.system?.effectText ?? "", item, null, modItem.system, modItem.id)
        });
      }
    } else {
      attachedMods = Object.entries(s.mods || {})
        .filter(([k, v]) => !k.startsWith('__') && v?.attached)
        .map(([modId, v]) => ({
          ...v,
          effectText: NeuroshimaScriptRunner._resolveItemRef(v.effectText ?? "", item, null, v, modId)
        }));
    }
    const summaryResources = (s.resources ?? []).filter(r => r.showInSummary).map(r => {
      const modId = r._fromModId ?? null;
      const modSnap = modId ? (s.mods?.[modId] ?? null) : null;
      return {
        ...r,
        label: NeuroshimaScriptRunner._resolveItemRef(r.label ?? "", item, null, modSnap, modId)
      };
    });
    const attrLabel = (key) => {
      const cfg = NEUROSHIMA?.attributes?.[key];
      return cfg ? loc(cfg.label) : (key || dash);
    };
    const skillLabel = (key) => {
      const k = `NEUROSHIMA.Skills.${key}`;
      const t = loc(k);
      return t !== k ? t : (key || dash);
    };
    if (s.weight !== undefined) {
      hasWeight = true;
      weight = s.weight ?? 0;
      availability = s.availability ?? null;
    }
    switch (item.type) {
      case "weapon": {
        const wType = s.weaponType ?? "melee";
        const wTypeLabel = loc(`NEUROSHIMA.Items.Fields.${wType.charAt(0).toUpperCase() + wType.slice(1)}`);
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.WeaponSubtype"), value: wTypeLabel || wType });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Attribute"), value: attrLabel(s.attribute) });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Skill"), value: skillLabel(s.skill) });
        if (wType === "melee") {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: `${s.damageMelee1 || dash} / ${s.damageMelee2 || dash} / ${s.damageMelee3 || dash}` });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
        } else {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Caliber"), value: s.caliber || dash });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: s.damage || dash });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.FireRateAbbr"), value: s.fireRate ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Capacity"), value: s.capacity ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.JammingAbbr"), value: s.jamming ?? 20 });
        }
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.RequiredBuild"), value: s.requiredBuild ?? 0 });
        if (s.attackBonus !== 0) stats.push({ label: loc("NEUROSHIMA.Items.Fields.AttackBonusAbbr"), value: (s.attackBonus > 0 ? "+" : "") + s.attackBonus });
        if (s.defenseBonus !== 0) stats.push({ label: loc("NEUROSHIMA.Items.Fields.DefenseBonusAbbr"), value: (s.defenseBonus > 0 ? "+" : "") + s.defenseBonus });
        break;
      }
      case "armor": {
        const locKeys = [
          { key: "head",     abbr: "HeadAbbr" },
          { key: "torso",    abbr: "TorsoAbbr" },
          { key: "leftArm",  abbr: "LeftArmAbbr" },
          { key: "rightArm", abbr: "RightArmAbbr" },
          { key: "leftLeg",  abbr: "LeftLegAbbr" },
          { key: "rightLeg", abbr: "RightLegAbbr" }
        ];
        const eff = s.effectiveArmor ?? {};
        armorRatings = locKeys.map(({ key, abbr }) => ({
          label: loc(`NEUROSHIMA.Items.Fields.${abbr}`),
          value: eff[key] ?? s.armor?.ratings?.[key] ?? 0
        }));
        const dur = (s.armor?.durability ?? 0) - (s.armor?.durabilityDamage ?? 0);
        armorBoxStats = [
          { label: loc("NEUROSHIMA.Items.Fields.DurabilityAbbr"), value: `${dur} / ${s.armor?.durability ?? 0}` },
          { label: loc("NEUROSHIMA.Items.Fields.RequiredBuild"), value: s.armor?.requiredBuild ?? 0 },
          { label: loc("NEUROSHIMA.Items.Fields.ArmorPenalty"), value: s.armor?.penalty ?? 0 }
        ];
        break;
      }
      case "gear": {
        if (s.cost > 0) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Cost"), value: s.cost });
        if (s.quantity !== undefined) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
      }
      case "ammo": {
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Caliber"), value: s.caliber || dash });
        if (s.isOverride) {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: s.damage || dash });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.JammingAbbr"), value: s.jamming ?? 20 });
        }
        if (s.isPellet) stats.push({ label: loc("NEUROSHIMA.Items.Fields.PelletCount"), value: s.pelletCount });
        if (s.quantity !== undefined) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
      }
      case "magazine": {
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Caliber"), value: s.caliber || dash });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Capacity"), value: `${s.totalCount ?? 0} / ${s.capacity ?? 0}` });
        magazineContents = (s.contents || []).filter(c => c.quantity > 0).map(c => ({ name: c.name || dash, quantity: c.quantity }));
        break;
      }
      case "money": {
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.CoinValue"), value: s.coinValue });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
      }
      case "reputation": {
        stats.push({ label: loc("NEUROSHIMA.Reputation.Value"), value: s.value });
        break;
      }
      case "container": {
        if (s.locked) {
          containerLocked = true;
        } else {
          let children;
          if (item.actor) {
            children = Array.from(item.actor.items).filter(i => i.getFlag("neuroshima", "containerId") === item.id);
          } else {
            children = (s.contents || []).map(e => ({ name: e.name, img: e.img, system: { quantity: e.quantity ?? 1 }, type: e.type }));
          }
          const cnt = children.length;
          if (s.maxItems > 0) stats.push({ label: loc("NEUROSHIMA.Container.MaxItems"), value: `${cnt} / ${s.maxItems}` });
          else stats.push({ label: loc("NEUROSHIMA.Container.Items"), value: cnt });
          containerContents = children.map(e => ({
            name: e.name,
            img: e.img,
            quantity: e.system?.quantity ?? 1,
            type: e.type
          }));
        }
        break;
      }
      default:
        if (s.quantity !== undefined) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
    }
    return { stats, armorRatings, armorBoxStats, magazineContents, containerContents, containerLocked, weight, availability, hasWeight, attachedMods, summaryResources };
  }

  static async postItemToChat(item, { actor = null } = {}) {
    const limit = await NeuroshimaChatMessage.showItemCardLimitDialog();
    if (!limit || limit === "cancel") return;

    const description = item.system.description || "";
    const enriched = description ? await TextEditor.enrichHTML(description, { async: true }) : "";

    const typeKey = item.type.charAt(0).toUpperCase() + item.type.slice(1).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const typeLabel = game.i18n.localize(`NEUROSHIMA.Items.Type.${typeKey}`) || item.type;

    const { stats, armorRatings, armorBoxStats, magazineContents, containerContents, containerLocked, weight, availability, hasWeight, attachedMods, summaryResources } = NeuroshimaChatMessage.buildItemChatStats(item);
    const hasStats = stats.length > 0 || !!armorRatings || !!armorBoxStats;
    const isUnlimited = limit === "unlimited";
    const remaining = isUnlimited ? null : limit;

    const content = await NeuroshimaChatMessage._renderTemplate(
      "systems/neuroshima/templates/chat/item-card.hbs",
      {
        name: item.name, img: item.img, type: item.type, typeLabel,
        uuid: item.uuid, description: enriched,
        stats, armorRatings, armorBoxStats, hasStats,
        magazineContents, containerContents, containerLocked,
        attachedMods, summaryResources,
        weight, availability, hasWeight,
        remaining, isUnlimited, isExhausted: false
      }
    );

    const rollMode = game.settings.get("core", "rollMode");
    const msgData = {
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker({}),
      content,
      flags: { neuroshima: { itemCard: { limit: remaining, remaining, sourceActorId: actor?.id ?? null } } }
    };
    ChatMessage.applyRollMode(msgData, rollMode);
    await ChatMessage.create(msgData);
  }

  static async decrementItemCardLimit(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const cardData = message.getFlag("neuroshima", "itemCard");
    if (!cardData || cardData.remaining === null) return;

    const newRemaining = Math.max(0, cardData.remaining - 1);
    const isExhausted = newRemaining <= 0;

    const parser = new DOMParser();
    const doc = parser.parseFromString(message.content, "text/html");

    const badge = doc.querySelector(".item-card-qty-badge");
    if (badge) {
      badge.textContent = `${newRemaining} ×`;
      badge.dataset.remaining = newRemaining;
    }

    if (isExhausted) {
      const card = doc.querySelector(".neuroshima.item-card");
      if (card) card.classList.add("item-card-exhausted");
      const draggable = doc.querySelector(".item-card-draggable");
      if (draggable) draggable.setAttribute("draggable", "false");
    }

    await message.update({
      content: doc.body.innerHTML,
      flags: { neuroshima: { itemCard: { ...cardData, remaining: newRemaining } } }
    });
  }
}
