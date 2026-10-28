import { remainingArmorDurability, armorLocationProtects, modifyArmorDurability } from "../helpers/armor-durability.js";
import { armorLocationProtections } from "../helpers/armor-location.js";
import { postBeastRequiredTest, applyBeastEffectIds } from "../helpers/beast-required-test.js";
import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";
import { buildItemPreviewTooltip } from "../helpers/item-tooltip.js";
import { clampArmor, preserveArmorSourceValues } from "../helpers/armor-limit.js";
import { beastActivities, resolveBeastActionItem, createBeastSegmentWeapon, createBeastSegmentGrenade, createBeastCombatWeapon, isBeastAbility, isBeastAction, isBeastSegment } from "../helpers/beast-actions.js";
import { NEUROSHIMA } from "../config.js";
import { createLoadedMagazineFromWeapon } from "../helpers/ammunition.js";
import { NeuroshimaDice } from "../helpers/dice.js";
import { RestDialog } from "../apps/dialogs/minor-dialogs.js";
import { getConditions } from "../apps/config/condition-config.js";
import { NeuroshimaBaseActorSheet } from "./actor-sheet-base.js";
import { getEffectiveArmorRatings, getEffectiveArmorResistances, getEffectiveRadiationResistance } from "../helpers/mod-helpers.js";
import {
  EFFECT_PENALTY_KEY,
  LEGACY_EFFECT_PENALTY_KEY
} from "../helpers/effect-penalty.js";
import {
  buildBreakdownTooltip,
  buildRichTextTooltip,
  collectAttributeEffectSources,
  collectDocumentEffectSources,
  renderTooltipSections
} from "../helpers/tooltip-renderer.js";

function _collectCreatureArmorBonusByEffect(actor) {
  const byLoc = {};
  if (!actor) return byLoc;
  const seen = new Set();
  for (const effect of actor.appliedEffects ?? []) {
    const key = effect.origin ?? effect.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const change of effect.changes ?? []) {
      const m = change.key.match(/^system\.armorBonus\.(\w+)$/);
      if (!m) continue;
      const loc = m[1];
      if (!byLoc[loc]) byLoc[loc] = [];
      byLoc[loc].push({ name: effect.name, value: Number(change.value) || 0 });
    }
  }
  return byLoc;
}

/**
 * Actor sheet for Creature actors (animals, mutants, monsters).
 *
 * Reuses the shared actor partials (attributes, skills, notes) so the layout
 * is identical to the character / NPC sheets. The combat tab uses a dedicated
 * creature-combat partial that shows natural armor, beast actions, and a
 * simplified wounds list instead of the full healing-panel system.
 */
export class NeuroshimaCreatureSheet extends NeuroshimaBaseActorSheet {
  async _processSubmitData(event, form, submitData) {
    // Embedded items save through their own change handler, never an actor form snapshot.
    delete submitData.items;
    for (const key of Object.keys(submitData)) {
      if (key.startsWith("items.")) delete submitData[key];
    }
    preserveArmorSourceValues(this.document, event, submitData);
    return super._processSubmitData(event, form, submitData);
  }

  async _onChangeForm(formConfig, event) {
    const input = event.target;
    const name = input?.getAttribute?.("name") ?? input?.name;
    if (name === "system.naturalArmorReduction") {
      if (!this.document.isOwner || !this.isEditable || input.value.trim() === "") return;
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      await this.document.update({ "system.naturalArmorReduction": Math.max(0, value) });
      return;
    }
    if (!name?.startsWith("items.")) return super._onChangeForm(formConfig, event);
    if (!this.document.isOwner || !this.isEditable) return;
    const [, itemId, ...path] = name.split(".");
    const item = this.document.items.get(itemId);
    const property = path.join(".");
    if (!item || item.type !== "wound"
      || !["system.location", "system.damageType", "system.penalty"].includes(property)) return;
    const value = input.type === "number" ? Math.max(0, Math.round(Number(input.value) || 0)) : input.value;
    await item.update({ [property]: value });
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "actor", "actor-creature"],
    position: { width: 720, height: 800 },
    window: { title: "NEUROSHIMA.Sheet.ActorCreature", resizable: true },
    form: { submitOnChange: true, submitOnClose: true, submitOnUnfocus: true },
    actions: {
      openMeleeSession: async function(_event, target) {
        const session = await game.neuroshima.melee.get(target.closest("[data-session-id]")?.dataset.sessionId);
        if (session) game.neuroshima.melee.openMessage(session);
      },
      cancelMeleeSession: async function(event, target) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        const sessionId = target.dataset.sessionId
          ?? target.closest("[data-session-id]")?.dataset.sessionId;

        try {
          const session = sessionId
            ? await game.neuroshima.melee.get(sessionId)
            : null;

          if (session) {
            await game.neuroshima.melee.dispatch({
              type: "endSession", side: null, payload: { reason: "cancelled" },
              sessionId: session.id, messageId: session.messageId,
              expectedRevision: session.revision, commandId: foundry.utils.randomID()
            });
          }

          await this.render({ force: true });
        } catch (error) {
          ui.notifications.error(error.message);
          console.error("Neuroshima | Failed to dismiss creature melee session", error);
        }
      },
      editImage: async function(event, target) {
        const fp = new FilePicker({ type: "image", callback: src => this.document.update({ img: src }) });
        fp.browse(this.document.img);
      },

      rollAttribute: async function(event, target) {
        const attrKey = target.dataset.attribute;
        const actor   = this.document;
        const system  = actor.system;
        const attrValue = system.attributeTotals?.[attrKey] ?? (system.attributes[attrKey] || 0);
        const label     = game.i18n.localize(NEUROSHIMA.attributes[attrKey]?.label || attrKey);
        return NeuroshimaCreatureSheet._showRollDialog({ stat: attrValue, skill: 0, label, actor, isSkill: false, currentAttribute: attrKey });
      },

      rollSkill: async function(event, target) {
        const skillKey = target.dataset.skill;
        const actor    = this.document;
        const system   = actor.system;

        let attrKey = "";
        for (const [aKey, specs] of Object.entries(NEUROSHIMA.skillConfiguration)) {
          for (const skills of Object.values(specs)) {
            if (skills.includes(skillKey)) { attrKey = aKey; break; }
          }
          if (attrKey) break;
        }

        const statValue  = system.attributeTotals?.[attrKey] ?? 0;
        const skillValue = system.skills?.[skillKey]?.value ?? 0;
        const label      = game.i18n.localize(`NEUROSHIMA.Skills.${skillKey}`);

        return NeuroshimaCreatureSheet._showRollDialog({ stat: statValue, skill: skillValue, label, actor, isSkill: true, currentAttribute: attrKey, skillKey });
      },

      rollExperience: async function() {
        const actor  = this.document;
        const system = actor.system;
        const exp    = system.experience ?? 0;
        const label  = game.i18n.localize("NEUROSHIMA.Creature.Experience");
        return NeuroshimaCreatureSheet._showRollDialog({ stat: 0, skill: exp, label, actor, isSkill: true, currentAttribute: "dexterity", skillKey: "experience" });
      },

      rollKondycja: async function() {
        const actor  = this.document;
        const system = actor.system;
        const con    = system.attributeTotals?.["constitution"] ?? (system.attributes?.["constitution"] || 0);
        const label  = game.i18n.localize("NEUROSHIMA.Creature.Kondycja");
        return NeuroshimaCreatureSheet._showRollDialog({ stat: con, skill: 0, label, actor, isSkill: false, currentAttribute: "constitution" });
      },

      toggleDifficulties: async function() {
        this._difficultiesCollapsed = !this._difficultiesCollapsed;
        this.render();
      },

      rollMeleeInitiative: async function() {
        const actor = this.document;
        const combat = game.combat;
        // A synthetic token actor must update its own token's combatant.
        const combatant = actor.token
          ? combat?.combatants.find(c => c.tokenId === actor.token.id)
          : combat?.getCombatantsByActor(actor.id)[0];
        const result = await actor.rollInitiativeDialog({ combatant, skill: "experience" });
        if (!result) return;
        const value = Number(result.initiative ?? result.successPoints);
        if (!Number.isFinite(value)) return;
        await actor.update({ "system.combat.meleeInitiative": Math.trunc(value) });
      },

      rollWeapon: async function(event, target) {
        const li   = target.closest("[data-item-id]");
        const item = this.document.items.get(li?.dataset.itemId ?? target.dataset.itemId);
        if (!item) return;

        if (item.system.weaponType === "melee") {

          // ── Chat-based opposed modes ──────────────────────────────────────
          const combatTypeSetting = game.settings.get("neuroshima", "meleeCombatType") || "default";
          const effectiveMode = combatTypeSetting === "default" ? "opposedPips" : combatTypeSetting;
          const { MeleeOpposedChat: MeleeRouter } = await import("../combat/combat.js");
          const routedMelee = await MeleeRouter.routeWeaponClick(
            this.document,
            item,
            Array.from(game.user.targets ?? []).map(token => token.document.uuid),
            effectiveMode
          );
          if (routedMelee.handled) return;
          {
            const myUuidsCheck = [this.document.uuid];
            if (this.document.token) myUuidsCheck.push(this.document.token.uuid);

            // 1. Actor flag (primary check)
            const opposeFlag = game.neuroshima?.melee?.enabled?.() ? null : this.document.getFlag("neuroshima", "oppose");
            if (opposeFlag?.messageId) {
              const pendingMsg = game.messages.get(opposeFlag.messageId);
              const opposeData = pendingMsg?.getFlag("neuroshima", "opposedChat");
              if (["pending", "awaitingDefender"].includes(opposeData?.status)) {
                const syntheticPending = {
                  id: opposeData.defenderUuid,
                  attackerId: opposeData.attackerUuid,
                  attackerTokenUuid: opposeData.attackerTokenUuid,
                  defenderId: opposeData.defenderUuid,
                  mode: opposeData.mode,
                  opposedChatMessageId: opposeFlag.messageId
                };
                const { MeleeOpposedChat } = await import("../combat/combat.js");
                await MeleeOpposedChat.openDefenseDialog(this.document, syntheticPending, item.id);
                return;
              }
              await this.document.unsetFlag("neuroshima", "oppose");
            }

            // 2. Fallback: combat pending
            const combatPendings = game.neuroshima?.melee?.enabled?.() ? {} : (game.combat?.getFlag("neuroshima", "meleePendings") || {});
            const opposedPending = Object.values(combatPendings).find(p => {
              if (!p.active || !p.mode) return false;
              return myUuidsCheck.some(u => game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, u));
            });
            if (opposedPending) {
              const { MeleeOpposedChat } = await import("../combat/combat.js");
              await MeleeOpposedChat.openDefenseDialog(this.document, opposedPending, item.id);
              return;
            }

            // 3. No pending — initiate new attack
            const rawTargets = Array.from(game.user.targets ?? []);
            const chatTargets = rawTargets.filter(t => !myUuidsCheck.includes(t.document.uuid));
            if (chatTargets.length > 0) {
              const { MeleeOpposedChat } = await import("../combat/combat.js");
              await MeleeOpposedChat.initiateAttack(this.document, item, chatTargets[0].document.uuid, effectiveMode);
              return;
            }
            const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");
            const dialog = new NeuroshimaWeaponRollDialog({
              actor: this.document,
              weapon: item,
              rollType: "melee",
              meleeAction: "attack",
              targets: [],
              isPoolRoll: true
            });
            await dialog.render(true);
            return;
          }
          // ── End chat-based opposed branch ─────────────────────────────────

          const combat = game.combat;
          const pendings = combat?.getFlag("neuroshima", "meleePendings") || {};
          const targets = Array.from(game.user.targets ?? []);
          const myUuids = [this.document.uuid];
          if (this.document.token) myUuids.push(this.document.token.uuid);
          const actualTargets = targets.filter(t => !myUuids.includes(t.document.uuid));
          let targetUuid = actualTargets[0]?.document.uuid;

          let existingPending = null;
          if (targetUuid) {
            existingPending = Object.values(pendings).find(p => {
              if (!p.active) return false;
              const amIDefender = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, this.document.uuid);
              const isHeAttacker = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.attackerId, targetUuid);
              return amIDefender && isHeAttacker;
            });
          }
          if (!existingPending) {
            existingPending = Object.values(pendings).find(p => p.active && game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, this.document.uuid));
            if (existingPending) targetUuid = existingPending.attackerId;
          }

          if (existingPending) {
            // ── Opposed-chat mode: weapon-roll dialog instead of initiative ──
            if (existingPending.mode) {
              const { MeleeOpposedChat } = await import("../combat/combat.js");
              await MeleeOpposedChat.openDefenseDialog(this.document, existingPending, item.id);
              return;
            }
            // ── Standard melee pending ────────────────────────────────────────
            const { NeuroshimaInitiativeRollDialog } = await import("../apps/dialogs/initiative-roll-dialog.js");
            const initiativeDialog = new NeuroshimaInitiativeRollDialog({
              actor: this.document,
              isMelee: true,
              meleeMode: "respond",
              pendingId: existingPending.id,
              weaponId: item.id,
              targets: [targetUuid],
              onRoll: async (result) => {
                const { NeuroshimaMeleeCombat } = await import("../combat/combat.js");
                await NeuroshimaMeleeCombat.respondToMeleePending(
                  existingPending.id,
                  Number(result.initiative ?? result.successPoints),
                  item.id
                );
                return result;
              }
            });
            await initiativeDialog.render(true);
            return;
          }

          const activeEncounterId = this.document.getFlag("neuroshima", "activeMeleeEncounter");
          if (activeEncounterId && !targetUuid) {
            const { NeuroshimaMeleeCombat } = await import("../combat/combat.js");
            NeuroshimaMeleeCombat.openMeleeApp(activeEncounterId);
            return;
          }

          if (targetUuid) {
            if (!game.combat) {
              ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.CreateEncounterFirst"));
              return;
            }
            const { NeuroshimaInitiativeRollDialog } = await import("../apps/dialogs/initiative-roll-dialog.js");
            const initiativeDialog = new NeuroshimaInitiativeRollDialog({
              actor: this.document,
              isMelee: true,
              meleeMode: "initiate",
              weaponId: item.id,
              targets: actualTargets
            });
            await initiativeDialog.render(true);
            return;
          }
        }

        const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");
        const dialog = new NeuroshimaWeaponRollDialog({ actor: this.document, weapon: item, rollType: item.system.weaponType });
        dialog.render(true);
      },

      rollBeastAttack: async function(event, target) {
        const actor = this.document;
        const sourceItems = actor.items.filter(i => isBeastAction(i));
        if (!sourceItems.length) return;

        const syntheticWeapon = createBeastCombatWeapon(actor);

        const combatTypeSetting = game.settings.get("neuroshima", "meleeCombatType") || "default";
        const effectiveMode = combatTypeSetting === "default" ? "opposedPips" : combatTypeSetting;

        const myUuidsCheck = [actor.uuid];
        if (actor.token) myUuidsCheck.push(actor.token.uuid);

        const opposeFlag = game.neuroshima?.melee?.enabled?.() ? null : actor.getFlag("neuroshima", "oppose");
        if (opposeFlag?.messageId) {
          const pendingMsg = game.messages.get(opposeFlag.messageId);
          const opposeData = pendingMsg?.getFlag("neuroshima", "opposedChat");
          if (["pending", "awaitingDefender"].includes(opposeData?.status)) {
            const syntheticPending = {
              id: opposeData.defenderUuid,
              attackerId: opposeData.attackerUuid,
              attackerTokenUuid: opposeData.attackerTokenUuid,
              defenderId: opposeData.defenderUuid,
              mode: opposeData.mode,
              opposedChatMessageId: opposeFlag.messageId
            };
            const { MeleeOpposedChat } = await import("../combat/combat.js");
            await MeleeOpposedChat.openDefenseDialog(actor, syntheticPending, null, syntheticWeapon);
            return;
          }
          await actor.unsetFlag("neuroshima", "oppose");
        }

        const combatPendings = game.neuroshima?.melee?.enabled?.() ? {} : (game.combat?.getFlag("neuroshima", "meleePendings") || {});
        const opposedPending = Object.values(combatPendings).find(p => {
          if (!p.active || !p.mode) return false;
          return myUuidsCheck.some(u => game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, u));
        });
        if (opposedPending) {
          const { MeleeOpposedChat } = await import("../combat/combat.js");
          await MeleeOpposedChat.openDefenseDialog(actor, opposedPending, null, syntheticWeapon);
          return;
        }

        const rawTargets = Array.from(game.user.targets ?? []);
        let chatTargets = rawTargets.filter(t => !myUuidsCheck.includes(t.document.uuid));

        if (chatTargets.length === 0) {
          const actorSourceToken = this._getSourceToken();
          if (actorSourceToken) {
            await this.minimize();
            const targetData = await this._waitForTarget();
            await this.maximize();

            if (!targetData) {
              return;
            } else if (!targetData.cancelled && targetData.token) {
              targetData.token.setTarget(true, { releaseOthers: true });
              chatTargets = [targetData.token];
            }
          }
        }

        if (chatTargets.length > 0) {
          const { MeleeOpposedChat } = await import("../combat/combat.js");
          await MeleeOpposedChat.initiateAttack(actor, syntheticWeapon, chatTargets[0].document.uuid, effectiveMode);
          return;
        }

        const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");
        const dialog = new NeuroshimaWeaponRollDialog({ actor, weapon: syntheticWeapon, rollType: "melee" });
        dialog.render(true);
      },

      rollBeastAction: async function(event, target) {
        const itemId     = target.dataset.itemId;
        const activityId = target.dataset.activityId;
        const item       = activityId ? resolveBeastActionItem(this.document, itemId, activityId) : this.document.items.get(itemId);
        if (!item || !isBeastSegment(item)) return;

        const act = activityId
          ? beastActivities(item).find(a => a.id === activityId)
          : beastActivities(item)[0];
        if (!act) return;

        const actor = this.document;

        if ((act.actionType ?? "attack") === "action") {
          const targetActor = Array.from(game.user.targets ?? [])[0]?.actor;
          if (act.testRequired) {
            if (!targetActor) {
              ui.notifications.warn(game.i18n.localize("NEUROSHIMA.BeastRequired.NeedTarget"));
              return;
            }
            await postBeastRequiredTest(item, act, targetActor, NeuroshimaScriptRunner);
          } else if (act.applyEffectsAutomatically !== false) {
            const recipient = act.effectTarget === "self" ? actor : act.effectTarget === "target" ? targetActor : null;
            await applyBeastEffectIds(item, [...(act.effectIds ?? []), ...(act.alwaysEffectIds ?? [])], recipient);
          }

          const effects = (act.effectIds ?? [])
            .map(id => item.effects.get(id))
            .filter(Boolean)
            .map(e => ({ name: e.name, img: e.img || "icons/svg/aura.svg" }));
          const content = await foundry.applications.handlebars.renderTemplate(
            "systems/neuroshima/templates/chat/beast-segment-action-card.hbs",
            {
              actorName:    actor.name,
              actorImg:     actor.img,
              activityName: act.name || item.name,
              activityImg:  act.img || item.img || "icons/svg/combat.svg",
              summary:      act.summary || "",
              gmNote:       act.gmNote  || "",
              effects
            }
          );
          const rollMode = game.settings.get("core", "rollMode");
          await ChatMessage.create({
            content,
            speaker: ChatMessage.getSpeaker({ actor }),
            rollMode
          });
          return;
        }

        const weaponType = act.weaponType || "melee";

        const isMeleeAct = weaponType === "melee";
        const syntheticWeapon = createBeastSegmentWeapon(actor, item, act);

        const combatTypeSetting = game.settings.get("neuroshima", "meleeCombatType") || "default";
        const effectiveMode = combatTypeSetting === "default" ? "opposedPips" : combatTypeSetting;
        if (isMeleeAct) {
          const myUuidsCheck = [actor.uuid];
          if (actor.token) myUuidsCheck.push(actor.token.uuid);

          const opposeFlag = game.neuroshima?.melee?.enabled?.() ? null : actor.getFlag("neuroshima", "oppose");
          if (opposeFlag?.messageId) {
            const pendingMsg = game.messages.get(opposeFlag.messageId);
            const opposeData = pendingMsg?.getFlag("neuroshima", "opposedChat");
            if (["pending", "awaitingDefender"].includes(opposeData?.status)) {
              const syntheticPending = {
                id: opposeData.defenderUuid,
                attackerId: opposeData.attackerUuid,
                attackerTokenUuid: opposeData.attackerTokenUuid,
                defenderId: opposeData.defenderUuid,
                mode: opposeData.mode,
                opposedChatMessageId: opposeFlag.messageId
              };
              const { MeleeOpposedChat } = await import("../combat/combat.js");
              await MeleeOpposedChat.openDefenseDialog(actor, syntheticPending, null, syntheticWeapon);
              return;
            }
            await actor.unsetFlag("neuroshima", "oppose");
          }

          const combatPendings = game.neuroshima?.melee?.enabled?.() ? {} : (game.combat?.getFlag("neuroshima", "meleePendings") || {});
          const opposedPending = Object.values(combatPendings).find(p => {
            if (!p.active || !p.mode) return false;
            return myUuidsCheck.some(u => game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, u));
          });
          if (opposedPending) {
            const { MeleeOpposedChat } = await import("../combat/combat.js");
            await MeleeOpposedChat.openDefenseDialog(actor, opposedPending, null, syntheticWeapon);
            return;
          }

          const rawTargets = Array.from(game.user.targets ?? []);
          const chatTargets = rawTargets.filter(t => !myUuidsCheck.includes(t.document.uuid));
          if (chatTargets.length > 0) {
            const { MeleeOpposedChat } = await import("../combat/combat.js");
            await MeleeOpposedChat.initiateAttack(actor, syntheticWeapon, chatTargets[0].document.uuid, effectiveMode);
            return;
          }
        }

        if (weaponType === "grenade") {
          const grenade = createBeastSegmentGrenade(actor, item, act);
          const { NeuroshimaGrenadeRollDialog } = await import("../apps/dialogs/grenade-roll-dialog.js");
          const grenadeDialog = new NeuroshimaGrenadeRollDialog({ actor, grenade });
          grenadeDialog.render(true);
          return;
        }

        const rollType = (weaponType === "ranged" || weaponType === "thrown") ? weaponType : "melee";
        const { NeuroshimaWeaponRollDialog } = await import("../apps/dialogs/weapon-roll-dialog.js");
        const dialog = new NeuroshimaWeaponRollDialog({ actor, weapon: syntheticWeapon, rollType });
        dialog.render(true);
      },

      createItem: async function(event, target) {
        const type = target.dataset.type || "weapon";
        const name = `${game.i18n.localize("DOCUMENT.New")} ${game.i18n.localize(`TYPES.Item.${type}`) || type}`;
        const itemData = { name, type };
        if (type === "beast-ability" && ["action", "segment"].includes(target.dataset.category)) {
          itemData.system = { abilityCategory: target.dataset.category, costType: target.dataset.category === "segment" ? "segment" : "success" };
          itemData.name = game.i18n.localize(target.dataset.category === "segment" ? "NEUROSHIMA.BeastAbility.NewSegment" : "NEUROSHIMA.BeastAbility.NewAction");
        }
        const [created] = await this.document.createEmbeddedDocuments("Item", [itemData]);
        if (created && type === "beast-ability") created.sheet.render(true);
        return created;
      },

      editItem: async function(event, target) {
        const li = target.closest("[data-item-id]");
        this.document.items.get(li.dataset.itemId)?.sheet.render(true);
      },


      deleteItem: async function(event, target) {
        const li = target.closest("[data-item-id]");
        await this.document.items.get(li.dataset.itemId)?.delete();
      },

      toggleEquipped: async function(event, target) {
        const li   = target.closest("[data-item-id]");
        const item = this.document.items.get(li.dataset.itemId);
        if (!item?.isEquippable) return;
        const newEquipped = !item.system.equipped;
        await item.update({ "system.equipped": newEquipped });
      },

      configureHP: async function() {
        const actor  = this.document;
        const current = actor.getFlag("neuroshima", "creatureMaxHP") || 27;

        const content = await foundry.applications.handlebars.renderTemplate(
          "systems/neuroshima/templates/dialog/hp-config.hbs",
          { critical: Math.max(1, Math.round(current / 27)), heavy: 0, light: 0, scratch: 0 }
        );

        const result = await foundry.applications.api.DialogV2.wait({
          window: {
            title:    game.i18n.localize("NEUROSHIMA.Dialog.MaxHP.Title"),
            position: { width: 320, height: "auto" }
          },
          content,
          classes: ["neuroshima", "dialog", "hp-config"],
          buttons: [
            {
              action: "save",
              label:  game.i18n.localize("NEUROSHIMA.Actions.Save"),
              default: true,
              callback: (event, button) => {
                const fd = new foundry.applications.ux.FormDataExtended(button.form).object;
                return {
                  critical: parseInt(fd.critical) || 0,
                  heavy:    parseInt(fd.heavy)    || 0,
                  light:    parseInt(fd.light)    || 0,
                  scratch:  parseInt(fd.scratch)  || 0
                };
              }
            },
            { action: "cancel", label: game.i18n.localize("NEUROSHIMA.Actions.Cancel") }
          ]
        });

        if (result && typeof result === "object") {
          const maxHP = (result.critical * 27) + (result.heavy * 9) + (result.light * 3) + (result.scratch * 1);
          await actor.setFlag("neuroshima", "creatureMaxHP", Math.max(1, maxHP));
          this.render();
        }
      },

      modifyDurability: async function(event, target) {
        return modifyArmorDurability(this, event, target);
      },

      modifyAP: async function(event, target) {
        const itemId   = target.dataset.itemId;
        const location = target.dataset.location;
        const item     = this.document.items.get(itemId);
        if (!item || item.type !== "armor" || !location) return;
        const isRight   = event.type === "contextmenu";
        const current   = item.system.armor?.damage?.[location] || 0;
        const max       = item.system.armor?.ratings?.[location] || 0;
        const newDamage = Math.clamp(isRight ? current + 1 : current - 1, 0, max);
        if (newDamage !== current) await item.update({ [`system.armor.damage.${location}`]: newDamage });
      },

      adjustQuantity: async function(event, target) {
        const li   = target.closest("[data-item-id]");
        const item = this.document.items.get(li?.dataset.itemId);
        if (!item) return;
        const isRight = event.type === "contextmenu";
        const current = item.system.quantity ?? 1;
        const next    = Math.max(0, isRight ? current - 1 : current + 1);
        await item.update({ "system.quantity": next });
      },

      toggleHealing: async function(event, target) {
        const li   = target.closest("[data-item-id]");
        const item = this.document.items.get(li?.dataset.itemId);
        if (item?.type === "wound") await item.update({ "system.isHealing": !item.system.isHealing });
      },

      rest: async function() {
        const { CombatHelper } = await import("../helpers/combat-helper.js");
        const restData = await RestDialog.wait();
        if (restData && typeof restData === "object" && restData.days !== undefined) {
          await CombatHelper.rest(this.document, restData);
          this.render();
        }
      },

      createEffect: async function(event, target) {
        const [effect] = await this.document.createEmbeddedDocuments("ActiveEffect", [{
          name: game.i18n.localize("NEUROSHIMA.Effects.NewEffect"),
          icon: "icons/svg/aura.svg",
          origin: this.document.uuid
        }]);
        effect?.sheet.render(true);
      },

      editEffect: async function(event, target) {
        const row = target.closest(".effect-row");
        const id = row?.dataset.effectId;
        const itemId = row?.dataset.itemId;
        const effect = itemId
          ? this.document.items.get(itemId)?.effects.get(id)
          : this.document.effects.get(id);
        effect?.sheet.render(true);
      },

      deleteEffect: async function(event, target) {
        const row = target.closest(".effect-row");
        if (row?.dataset.itemId) return;
        const id = row?.dataset.effectId;
        await this.document.effects.get(id)?.delete();
      },

      toggleEffect: async function(event, target) {
        const row = target.closest(".effect-row");
        const id = row?.dataset.effectId;
        const itemId = row?.dataset.itemId;
        const effect = itemId
          ? this.document.items.get(itemId)?.effects.get(id)
          : this.document.effects.get(id);
        if (effect) await effect.update({ disabled: !effect.disabled });
      },

      openSource: async function(event, target) {
        const itemId = target.dataset.itemId;
        this.document.items.get(itemId)?.sheet.render(true);
      },

      invokeItemScript: async function(event, target) {
        const { itemId, effectId, scriptIndex } = target.dataset;
        const item = this.document.items.get(itemId);
        if (!item) return;
        const effect = item.effects.get(effectId);
        if (!effect) return;
        const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
        await NeuroshimaScriptRunner.executeManual(this.document, effect, Number(scriptIndex));
      },
      invokeEffectScript: NeuroshimaBaseActorSheet.prototype._onInvokeEffectScript,
      consolidateMoney: async function() {
        if (!this.document.isOwner) return;
        const items = this.document.items.filter(item => item.type === "money" && item.system.coinValue > 0)
          .sort((a, b) => b.system.coinValue - a.system.coinValue);
        let remaining = items.reduce((sum, item) => sum + item.system.quantity * item.system.coinValue, 0);
        const updates = items.map(item => {
          const quantity = Math.floor(remaining / item.system.coinValue);
          remaining -= quantity * item.system.coinValue;
          return { _id: item.id, "system.quantity": quantity };
        });
        if (updates.length) await this.document.updateEmbeddedDocuments("Item", updates);
      },
      toggleGearCategory: NeuroshimaBaseActorSheet.prototype._onToggleGearCategory,

      toggleCondition: async function(event, target) {
        const key  = target.dataset.conditionKey;
        const type = target.dataset.conditionType;
        if (!key) return;
        if (type === "boolean") {
          await this.document.toggleStatusEffect(key, { active: !this.document.hasCondition(key) });
        } else {
          if (event.button === 2 || event.type === "contextmenu") {
            await this.document.removeCondition(key);
          } else {
            await this.document.addCondition(key);
          }
        }
      },

      adjustConditionValue: async function(event, target) {
        const key = target.dataset.conditionKey;
        const allowNegative = target.dataset.allowNegative === "true";
        if (!key) return;
        const actor = this.document;
        let val = parseInt(target.value, 10);
        if (isNaN(val)) val = 0;
        if (!allowNegative) val = Math.max(0, val);
        await actor.setConditionValue(key, val);
      },

      dismissOpposed: async function(event, target) {
        if (event) event.stopPropagation();
        const pendingId = target.dataset.pendingId;

        let messageId = null;
        const combat = game.combat;
        if (combat) {
          const pendingKey = pendingId.replace(/\./g, "-");
          const pendings = combat.getFlag("neuroshima", "meleePendings") || {};
          messageId = pendings[pendingKey]?.opposedChatMessageId;
        }
        if (!messageId) {
          const defDoc = fromUuidSync(pendingId);
          const defActor = defDoc?.actor ?? defDoc;
          messageId = defActor?.getFlag("neuroshima", "oppose")?.messageId;
        }

        const { MeleeOpposedChat } = await import("../combat/combat.js");

        if (messageId) {
          const msg = game.messages.get(messageId);
          const chatData = msg?.getFlag("neuroshima", "opposedChat");
          if (["pending", "awaitingDefender"].includes(chatData?.status)) {
            await MeleeOpposedChat._setChatFlag(msg, "opposedChat", { ...chatData, status: "cancelled" });
          }
        }

        await MeleeOpposedChat._unsetDefenderFlag(pendingId);

        const { NeuroshimaMeleeCombat } = await import("../combat/combat.js");
        await NeuroshimaMeleeCombat.dismissMeleePending(pendingId);

        this.render(false);
      },

      respondToOpposed: async function(event, target) {
        const opposeFlag = this.document.getFlag("neuroshima", "oppose");
        if (opposeFlag?.messageId) {
          const pendingMsg = game.messages.get(opposeFlag.messageId);
          const opposeData = pendingMsg?.getFlag("neuroshima", "opposedChat");
          if (["pending", "awaitingDefender"].includes(opposeData?.status)) {
            const syntheticPending = {
              id: opposeData.defenderUuid,
              attackerId: opposeData.attackerUuid,
              attackerTokenUuid: opposeData.attackerTokenUuid,
              defenderId: opposeData.defenderUuid,
              mode: opposeData.mode,
              opposedChatMessageId: opposeFlag.messageId
            };
            const { MeleeOpposedChat } = await import("../combat/combat.js");
            await MeleeOpposedChat.openDefenseDialog(this.document, syntheticPending);
            return;
          }
          await this.document.unsetFlag("neuroshima", "oppose");
        }
        const pendings = game.combat?.getFlag("neuroshima", "meleePendings") || {};
        const pending = Object.values(pendings).find(p => p.active && p.mode &&
          game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, this.document.uuid));
        if (pending) {
          const { MeleeOpposedChat } = await import("../combat/combat.js");
          await MeleeOpposedChat.openDefenseDialog(this.document, pending);
        }
      },

      toggleSummary: function(event, target) {
        const wrap = target.closest(".item-wrap");
        const summary = wrap?.querySelector(".item-summary");
        if (!summary) return;
        summary.classList.toggle("collapsed");
      },

      itemContextMenu: function(event, target) {
        const wrap = target.closest(".item-wrap");
        if (!wrap?.dataset.itemId) return;
        this._showItemContextMenu(event, wrap.dataset.itemId);
      },

      takeFromContainer: async function(event, target) {
        const actor = this.document;
        const childItemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
        if (!childItemId) return;
        const childItem = actor.items.get(childItemId);
        if (!childItem || !childItem.getFlag("neuroshima", "containerId")) return;
        await childItem.unsetFlag("neuroshima", "containerId");
      }
    },
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "attributes", group: "primary", label: "NEUROSHIMA.Tabs.Attributes" },
        { id: "combat",     group: "primary", label: "NEUROSHIMA.Tabs.Combat" },
        { id: "inventory",  group: "primary", label: "NEUROSHIMA.Tabs.Inventory" },
        { id: "effects",    group: "primary", label: "NEUROSHIMA.Tabs.Effects" },
        { id: "notes",      group: "primary", label: "NEUROSHIMA.Tabs.Notes" }
      ],
      initial: "attributes"
    }
  };

  /**
   * PARTS reuse shared actor partials wherever possible so that visual style
   * is identical to the character / NPC sheets.
   * @override
   */
  static PARTS = {
    header:     { template: "systems/neuroshima/templates/actors/creature/parts/creature-header.hbs" },
    tabs:       { template: "templates/generic/tab-navigation.hbs" },
    attributes: { template: "systems/neuroshima/templates/actors/creature/parts/creature-attributes.hbs", scrollable: [""] },
    combat:     { template: "systems/neuroshima/templates/actors/creature/parts/creature-combat.hbs", scrollable: [".creature-actions-list", ".creature-maneuvers-list", ".creature-combat-col", ""] },
    inventory:  { template: "systems/neuroshima/templates/actors/creature/parts/creature-inventory.hbs", scrollable: [""] },
    effects:    { template: "systems/neuroshima/templates/actors/parts/actor-effects.hbs", scrollable: [""] },
    notes:      { template: "systems/neuroshima/templates/actors/actor/parts/actor-notes.hbs" }
  };

  /** @inheritdoc */
  constructor(options = {}) {
    super(options);
    this._difficultiesCollapsed = true;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor   = this.document;
    const system  = actor.system;

    context.actor    = actor;
    context.system   = system;
    context.config   = NEUROSHIMA;
    context.tabs     = this._getTabs();
    context.owner    = actor.isOwner;
    context.editable = this.isEditable;
    context.isGM     = game.user.isGM;
    this._applyPermissionRestrictions(context);

    context.attributeList         = NEUROSHIMA.attributes;
    context.difficulties          = NEUROSHIMA.difficulties;
    context.difficultiesCollapsed = this._difficultiesCollapsed;
    context.effectTooltips        = this._buildEffectTooltips(actor);
    context.experience            = system.experience ?? 0;
    context.kondycja              = system.kondycja   ?? 0;

    context.enableEncumbrance = game.settings.get("neuroshima", "enableEncumbrance");

    const items = [...actor.items.contents].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    context.inventoryMaxLoadEditable = true;
    context.itemDescriptions = Object.fromEntries(await Promise.all(items.map(async item => [item.id,
      await foundry.applications.ux.TextEditor.enrichHTML(item.system.description || "", {
        async: true, secrets: item.isOwner, relativeTo: item,
        rollData: { ...item.getRollData(), actor: actor.getRollData() }
      })
    ])));
    context.itemPreviewTooltips = Object.fromEntries(items.map(item => [item.id,
      buildItemPreviewTooltip(item.img, item.name, item.system.weight, item.system.cost, context.itemDescriptions[item.id])
    ]));
    const armorItems = items.filter(i => i.type === "armor");
    const equippedWeapons = items.filter(i => i.type === "weapon" && i.system.equipped &&
      (i.system.weaponType === "melee" || i.system.weaponType === "ranged" || i.system.weaponType === "thrown"));

    const containerChildIds = new Set(
      items.filter(i => i.getFlag("neuroshima", "containerId")).map(i => i.id)
    );
    const modChildIds = new Set(
      items.filter(i => i.getFlag("neuroshima", "modParentId")).map(i => i.id)
    );
    const topItems = items.filter(i => !containerChildIds.has(i.id) && !modChildIds.has(i.id));
    context.inventory = {
      containers: items.filter(i => i.type === "container").map(c => {
        const cnt = items.filter(i => i.getFlag("neuroshima", "containerId") === c.id).length;
        const max = c.system.maxItems || 0;
        c.fillPct = max > 0 ? Math.min(100, Math.round(cnt / max * 100)) : 0;
        c.itemCount = cnt;
        return c;
      }),
      weaponsMelee:   topItems.filter(i => i.type === "weapon" && i.system.weaponType === "melee"),
      weaponsRanged:  topItems.filter(i => i.type === "weapon" && ["ranged", "launcher"].includes(i.system.weaponType)),
      weaponsThrown:  topItems.filter(i => i.type === "weapon" && i.system.weaponType === "thrown"),
      grenades:       topItems.filter(i => i.type === "grenade"),
      armor:          topItems.filter(i => i.type === "armor"),
      money:          topItems.filter(i => i.type === "money"),
      weaponMods:     topItems.filter(i => i.type === "weapon-mod"),
      armorMods:      topItems.filter(i => i.type === "armor-mod"),
      gear:           topItems.filter(i => i.type === "gear"),
      hasWearableGear: topItems.some(i => i.type === "gear" && i.isEquippable),
      ammo:           topItems.filter(i => i.type === "ammo"),
      magazines:      topItems.filter(i => i.type === "magazine").map(m => {
        m.contentsReversed = [...(m.system.contents || [])].reverse();
        return m;
      }),
      beastActions:      equippedWeapons,
      beastActionItems: topItems.filter(i => isBeastAction(i))
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(item => ({
          id: item.id, name: item.name, img: item.img,
          successCost: item.system.successCost ?? 1,
          damage: item.system.damage || null,
          actionType: item.system.actionType || "",
          hasEffects: (item.system.effectIds ?? []).length > 0
        })),
      beastSegmentItems: topItems.filter(i => isBeastSegment(i)).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(item => ({
        id: item.id, name: item.name, img: item.img,
        segmentCost: item.system.segmentCost ?? 1,
        skillMode: item.system.skillMode || "experience",
        weaponType: item.system.weaponType || "melee",
        damage: item.system.damage || null,
        actionType: item.system.actionType || "",
        gmNote: item.system.gmNote || "",
        hasEffects: item.effects.size > 0
      })),

      wounds:         topItems.filter(i => i.type === "wound")
    };
    this._prepareGearGroups(context.inventory);
    context.moneyData = { totalBaseUnitsFormatted: context.inventory.money.reduce((sum, item) =>
      sum + (Number(item.system.quantity) || 0) * (Number(item.system.coinValue) || 0), 0).toLocaleString(game.i18n.lang) };
    context.currencyDisplayName = game.settings.get("neuroshima", "currencyNameLabel") || "Gamble";
    const armorEffectiveResistances = {};
    for (const armorItem of context.inventory.armor) {
      const effRes = getEffectiveArmorResistances(armorItem);
      const rows = Object.entries(effRes).map(([category, locs]) => ({
        category,
        categoryLabel: game.i18n.localize(NEUROSHIMA.damageCategories[category]?.label ?? category),
        head:     clampArmor(actor, locs.head ?? 0, category),
        torso:    clampArmor(actor, locs.torso ?? 0, category),
        leftArm:  clampArmor(actor, locs.leftArm ?? 0, category),
        rightArm: clampArmor(actor, locs.rightArm ?? 0, category),
        leftLeg:  clampArmor(actor, locs.leftLeg ?? 0, category),
        rightLeg: clampArmor(actor, locs.rightLeg ?? 0, category)
      }));
      armorEffectiveResistances[armorItem.id] = rows.length > 0 ? rows : null;
    }
    context.armorEffectiveResistances = armorEffectiveResistances;

    const attachedModsByItemId = {};
    for (const modItem of actor.items) {
      if (!["weapon-mod", "armor-mod"].includes(modItem.type)) continue;
      const parentId = modItem.getFlag("neuroshima", "modParentId");
      if (!parentId) continue;
      const parentItem = actor.items.get(parentId);
      if (!parentItem) continue;
      const modState = parentItem.system?.mods?.[modItem.id];
      if (!modState?.attached) continue;
      if (!attachedModsByItemId[parentId]) attachedModsByItemId[parentId] = [];
      const effectText = modItem.system?.effectText ?? "";
      attachedModsByItemId[parentId].push({
        name: modItem.name,
        effectText,
        tooltipHtml: buildRichTextTooltip({ title: modItem.name, html: effectText })
      });
    }
    context.attachedModsByItemId = attachedModsByItemId;


    const anatomicalArmor = this._prepareAnatomicalArmor(armorItems.filter(i => i.system.equipped), actor);

    context.naturalArmorReductionAll = clampArmor(actor, Number(actor._source?.system?.naturalArmorReduction ?? 0));
    const commonReduction = Math.max(0, Number(system.naturalArmorReduction) || 0);
    const bonusAll      = Number(system.armorBonus?.all) || 0;
    const natArmorLabel = game.i18n.localize("NEUROSHIMA.Creature.NaturalArmor");
    const effectBonus   = _collectCreatureArmorBonusByEffect(actor);
    context.armorLocations = Object.entries(NEUROSHIMA.bodyLocations).filter(([key, data]) => !data.paperDollOnly).map(([key, data]) => {
      const reduction  = system.naturalArmor?.[key]?.reduction ?? 0;
      const locItems   = anatomicalArmor[key]?.items ?? [];
      const itemsAP    = anatomicalArmor[key]?.totalAP ?? 0;
      const bonusLoc   = Number(system.armorBonus?.[key]) || 0;
      const bonus      = bonusAll + bonusLoc;

      const armorSources = [
        ...(commonReduction !== 0 ? [{ label: "NEUROSHIMA.Creature.NaturalArmor.CommonReduction", value: commonReduction }] : []),
        ...(reduction !== 0 ? [{ label: natArmorLabel, value: reduction }] : []),
        ...locItems.map(item => ({ label: item.name, value: Number(item.currentRating ?? 0) })),
        ...[...(effectBonus.all ?? []), ...(effectBonus[key] ?? [])]
          .map(effect => ({ label: effect.name, value: effect.value }))
      ];

      return {
        key,
        label:            game.i18n.localize(data.label),
        reduction: clampArmor(actor, reduction),
        hitPenalty:       system.naturalArmor?.[key]?.hitPenalty ?? 0,
        weakPoint:        system.naturalArmor?.[key]?.weakPoint  ?? false,
        items:            locItems,
        protections:      armorLocationProtections(actor, key),
        totalAP:          itemsAP,
        totalEffectiveAP: clampArmor(actor, commonReduction + reduction + itemsAP + bonus),
        tooltip:          buildBreakdownTooltip({
          title: data.label,
          sources: armorSources,
          totalValue: clampArmor(actor, commonReduction + reduction + itemsAP + bonus)
        })
      };
    });

    const totalArmorPenalty = system.combat?.totalArmorPenalty || 0;
    const totalWoundPenalty = system.combat?.totalWoundPenalty || 0;
    const totalDiseasePenalty = actor.items
      .filter(i => i.type === "disease" && (i.system.diseaseType ?? "chronic") === "transient")
      .reduce((sum, i) => sum + (Number(i.system.transientPenalty) || 0), 0);
    const totalEffectPenalty = Number(system.combat?.effectPenalty ?? 0) || 0;
    const effectPenaltySourceMap = collectDocumentEffectSources(
      actor,
      [EFFECT_PENALTY_KEY, LEGACY_EFFECT_PENALTY_KEY]
    );
    const effectPenaltySources = [
      ...(effectPenaltySourceMap[EFFECT_PENALTY_KEY] ?? []),
      ...(effectPenaltySourceMap[LEGACY_EFFECT_PENALTY_KEY] ?? [])
    ];
    const totalCombatPenalty = totalArmorPenalty + totalWoundPenalty
      + totalDiseasePenalty + totalEffectPenalty;
    const penaltyTooltip = renderTooltipSections([
      {
        title: "NEUROSHIMA.Wound.TotalPenalty",
        rows: [
          { label: "NEUROSHIMA.Roll.Armor", value: totalArmorPenalty, suffix: "%" },
          { label: "NEUROSHIMA.Roll.Wounds", value: totalWoundPenalty, suffix: "%" },
          { label: "NEUROSHIMA.Roll.Disease", value: totalDiseasePenalty, suffix: "%" }
        ].filter(row => row.value)
      },
      ...(totalEffectPenalty !== 0 || effectPenaltySources.length ? [{
        title: "NEUROSHIMA.Roll.Effects",
        rows: [
          ...effectPenaltySources.map(source => ({
            label: source.label,
            value: source.value,
            signed: source.signed,
            suffix: "%"
          })),
          {
            label: "NEUROSHIMA.Roll.Total",
            value: totalEffectPenalty,
            suffix: "%",
            emphasis: true
          }
        ]
      }] : []),
      {
        kind: "threshold",
        rows: [{
          label: "NEUROSHIMA.Roll.Total",
          value: totalCombatPenalty,
          suffix: "%",
          emphasis: true
        }]
      }
    ]);
    const maxHP = actor.getFlag("neuroshima", "creatureMaxHP") || system.combat?.maxHP || 27;
    const totalArmorAP = context.armorLocations.reduce((sum, loc) => sum + (loc.reduction || 0) + (loc.totalAP || 0), 0);
    const meleePendingsFromCombat = game.neuroshima?.melee?.enabled?.()
      ? game.neuroshima.melee.list().filter(session => session.status === "active" &&
        Object.values(session.participants ?? {}).some(participant =>
          participant.actorUuid === actor.uuid || participant.tokenUuid === actor.token?.uuid
        )).sort((left, right) => Number(right.updatedAt ?? right.createdAt ?? 0) - Number(left.updatedAt ?? left.createdAt ?? 0))
        .slice(0, 1).map(session => {
          const matchesAttacker = session.participants.attacker.actorUuid === actor.uuid ||
            session.participants.attacker.tokenUuid === actor.token?.uuid;
          const perspective = matchesAttacker ? session.participants.attacker : session.participants.defender;
          const opponent = matchesAttacker ? session.participants.defender : session.participants.attacker;
          return {
          id: session.id,
          sessionId: session.id,
          isMeleeSession: true,
          attackerName: session.participants.attacker.name,
          defenderName: session.participants.defender.name,
          perspectiveName: perspective.name,
          perspectiveImg: perspective.img,
          opponentName: opponent.name,
          opponentImg: opponent.img,
          segment: Number(session.exchange?.currentSegment ?? 0) + 1,
          initiativeName: Object.values(session.participants).find(participant =>
            participant.actorUuid === session.initiative.ownerId || participant.tokenUuid === session.initiative.ownerId
          )?.name ?? "?",
          waitingText: session.phase === "awaitingDefenderRoll"
            ? `Oczekuje na obronę: ${session.participants.defender.name}`
            : session.phase === "response" ? "Oczekuje na odpowiedź" : "Oczekuje na deklarację",
          matchesAttacker,
          matchesDefender: session.participants.defender.actorUuid === actor.uuid ||
            session.participants.defender.tokenUuid === actor.token?.uuid
        };
        })
      : Object.values(game.combat?.getFlag("neuroshima", "meleePendings") || {})
      .filter(p => {
        if (!p.active) return false;
        if (p.opposedChatMessageId) {
          const msg = game.messages.get(p.opposedChatMessageId);
          const chatData = msg?.getFlag("neuroshima", "opposedChat");
          if (chatData?.status && !["pending", "awaitingDefender"].includes(chatData.status)) return false;
        }
        return true;
      })
      .map(p => {
        const matchesDefender = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, actor.uuid);
        const matchesAttacker = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.attackerId, actor.uuid);
        return { ...p, matchesDefender, matchesAttacker };
      })
      .filter(p => p.matchesDefender || p.matchesAttacker);

    const opposeFlag = game.neuroshima?.melee?.enabled?.() ? null : actor.getFlag("neuroshima", "oppose");
    if (opposeFlag?.messageId && !meleePendingsFromCombat.some(p => p.matchesDefender)) {
      const msg = game.messages.get(opposeFlag.messageId);
      const data = msg?.getFlag("neuroshima", "opposedChat");
      if (["pending", "awaitingDefender"].includes(data?.status)) {
        const attackerDoc = fromUuidSync(data.attackerUuid);
        const attackerActor = attackerDoc?.actor ?? attackerDoc;
        meleePendingsFromCombat.push({
          id: data.defenderUuid,
          attackerId: data.attackerUuid,
          defenderId: data.defenderUuid,
          attackerName: attackerActor?.name ?? "?",
          defenderName: actor.name,
          mode: data.mode,
          opposedChatMessageId: opposeFlag.messageId,
          active: true,
          matchesDefender: true,
          matchesAttacker: false
        });
      }
    }

    context.combat = {
      totalArmorPenalty,
      totalWoundPenalty,
      totalDiseasePenalty,
      totalEffectPenalty,
      totalCombatPenalty,
      penaltyTooltip,
      totalDamagePoints:  system.combat?.totalDamagePoints || 0,
      totalArmorAP,
      maxHP,
      meleeInitiative:    system.combat?.meleeInitiative || 0,
      movement2:          (system.movement ?? 0) * 2,
      movement3:          (system.movement ?? 0) * 3,
      wounds:             items.filter(i => i.type === "wound"),
      meleePendings:      meleePendingsFromCombat.slice(-1)
    };
    context.effectiveRadiationResistance = getEffectiveRadiationResistance(actor);

    context.beastActionTypes = {
      attack:   game.i18n.localize("NEUROSHIMA.BeastAction.Type.Attack"),
      special:  game.i18n.localize("NEUROSHIMA.BeastAction.Type.Special"),
      reaction: game.i18n.localize("NEUROSHIMA.BeastAction.Type.Reaction")
    };

    context.notes = {
      enriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.notes || "", {
        secrets: actor.isOwner,
        async: true,
        relativeTo: actor
      })
    };

    const condDefs = getConditions();
    const condTypeMap = Object.fromEntries(condDefs.map(c => [c.key, c.type ?? "boolean"]));
    const effectDurationLabel = (e) => e.duration?.rounds ? `${e.duration.rounds}r` : (e.duration?.seconds ? `${e.duration.seconds}s` : "—");
    const isTemporary = (e) => e.isTemporary;
    const isConditionEffect = (e) => e.isCondition;

    const temporary     = [];
    const passive       = [];
    const disabled      = [];
    const statusEffects = [];

    const pushEffect = (e, itemId, sourceName, sourceIcon, isItemEffect) => {
      const entry = {
        id: e.id,
        itemId: itemId ?? null,
        name: e.name,
        icon: e.img || "icons/svg/aura.svg",
        disabled: e.disabled,
        sourceName,
        sourceIcon,
        durationLabel: effectDurationLabel(e),
        isItemEffect: !!isItemEffect,
        manualScripts: this._prepareEffectManualScripts(e, itemId ? actor.items.get(itemId) : null)
      };
      if (isConditionEffect(e)) {
        const statusKey = [...(e.statuses ?? [])][0];
        entry.conditionType = condTypeMap[statusKey] ?? "boolean";
        statusEffects.push(entry);
      } else if (e.disabled) {
        disabled.push(entry);
      } else if (isTemporary(e)) {
        temporary.push(entry);
      } else {
        passive.push(entry);
      }
    };

    for (const e of actor.effects) {
      if (e.getFlag("neuroshima", "fromEquipTransfer")) {
        const originItem = e.origin ? actor.items.find(i => i.uuid === e.origin) : null;
        pushEffect(e, originItem?.id ?? null, originItem?.name ?? actor.name, originItem?.img ?? actor.img ?? "icons/svg/mystery-man.svg", !!originItem);
      } else {
        const sourceActor = e.sourceActor;
        pushEffect(e, null, sourceActor?.name ?? actor.name, sourceActor?.img ?? actor.img ?? "icons/svg/mystery-man.svg", false);
      }
    }

    for (const item of actor.items) {
      for (const e of item.effects) {
        const docType      = e.getFlag?.("neuroshima", "documentType")  ?? "actor";
        const transferType = e.getFlag?.("neuroshima", "transferType")  ?? "owningDocument";
        const equipTransfer = e.getFlag?.("neuroshima", "equipTransfer") ?? false;
        if (docType !== "actor" || transferType !== "owningDocument") continue;
        if (equipTransfer) continue;
        pushEffect(e, item.id, item.name, item.img || "icons/svg/item-bag.svg", true);
      }
    }

    context.effects = { temporary, passive, disabled, statusEffects };

    // Split conditions into two groups rendered in separate panels:
    //   conditionStates       → general status effects (Stany)
    //   combatConditionStates → maneuver / berserker states shown in "Stany w Walce"
    const COMBAT_CONDITION_KEYS = new Set(["berserker", "maneuver-charge", "maneuver-fury", "maneuver-full-defense", "maneuver-pace"]);
    const allConditionStates = condDefs.map(c => {
      const isInt = c.type === "int";
      let active, value;
      if (isInt) {
        value  = actor.getConditionValue(c.key);
        active = value !== 0;
      } else {
        active = actor.statuses.has(c.key);
        value  = 0;
      }
      return {
        key:           c.key,
        name:          c.name,
        img:           c.img,
        type:          c.type,
        allowNegative: !!c.allowNegative,
        active,
        value
      };
    });
    context.conditionStates = allConditionStates
      .filter(c => !COMBAT_CONDITION_KEYS.has(c.key))
      .sort((a, b) => (a.type === "int" ? 1 : 0) - (b.type === "int" ? 1 : 0));
    context.combatConditionStates = allConditionStates
      .filter(c => COMBAT_CONDITION_KEYS.has(c.key))
      .sort((a, b) => (a.type === "int" ? 1 : 0) - (b.type === "int" ? 1 : 0));

    context.itemManualScripts = this._prepareItemManualScripts(actor);

    return context;
  }

  _prepareItemManualScripts(actor) {
    const map = {};
    for (const item of (actor.items ?? [])) {
      const scripts = [];
      for (const eff of (item.effects ?? [])) {
        if (eff.disabled) continue;
        const flags = eff.system?.scriptData ?? [];
        flags.forEach((s, idx) => {
          if (s.trigger === "manual") {
            const rawLabel = s.label || eff.name;
            const label = rawLabel
              .replace(/@effect\.name/g, eff.name)
              .replace(/@item\.name/g, item.name);
            scripts.push({
              itemId: item.id,
              effectId: eff.id,
              effectName: eff.name,
              scriptIndex: idx,
              label
            });
          }
        });
      }
      if (scripts.length) map[item.id] = scripts;
    }
    return map;
  }

  /**
   * Builds the skill-group data structure used by the shared actor-skills partial.
   * Mirrors the same method in NeuroshimaActorSheet.
   * @returns {object}
   */
  _prepareSkillGroups() {
    const groups  = {};
    const system  = this.document.system;
    const skillCfg = NEUROSHIMA.skillConfiguration;

    for (const [attrKey, specializations] of Object.entries(skillCfg)) {
      const attrConfig = NEUROSHIMA.attributes[attrKey];
      groups[attrKey] = {
        label: attrConfig.label,
        abbr:  attrConfig.abbr,
        specializations: {}
      };

      for (const [specKey, skills] of Object.entries(specializations)) {
        groups[attrKey].specializations[specKey] = {
          label: `NEUROSHIMA.Specializations.${specKey}`,
          owned: system.specializations?.[specKey] ?? false,
          skills: skills.map(skillKey => ({
            key:         skillKey,
            label:       `NEUROSHIMA.Skills.${skillKey}`,
            value:       system.skills?.[skillKey]?.value ?? 0,
            customLabel: system.skills?.[skillKey]?.label ?? "",
            isKnowledge: skillKey.startsWith("knowledge")
          }))
        };
      }
    }
    return groups;
  }

  _buildEffectTooltips(actor) {
    const attrKeys = Object.keys(NEUROSHIMA.attributes);
    const changesByKey = collectAttributeEffectSources(actor, attrKeys);
    return Object.fromEntries(attrKeys.map(key => {
      const sources = changesByKey[key];
      const total = Number(actor.system.attributeTotals?.[key] ?? 0);
      const sourceTotal = sources
        .filter(source => source.signed !== false)
        .reduce((sum, source) => sum + Number(source.value ?? 0), 0);
      return [key, buildBreakdownTooltip({
        title: NEUROSHIMA.attributes[key]?.label ?? key,
        baseValue: total - sourceTotal,
        sources,
        totalValue: total
      })];
    }));
  }

  /** @override */
  async _onDropItem(event, data) {
    const item = await fromUuid(data.uuid);
    if (!item) return;
    if (["weapon", "armor", "gear", "ammo", "magazine", "wound", "beast-ability", "grenade", "container", "money", "weapon-mod", "armor-mod"].includes(item.type)) {
      return super._onDropItem(event, data);
    }
  }

  /**
   * Builds anatomical armor data (equipped armor items aggregated per body location).
   * Mirrors the same method in NeuroshimaActorSheet.
   * @param {Item[]} equippedArmor
   * @returns {object}
   */
  _prepareAnatomicalArmor(equippedArmor) {
    const locations = {};
    for (const [key, data] of Object.entries(NEUROSHIMA.bodyLocations)) {
      if (data.paperDollOnly) continue;
      locations[key] = { label: data.label, items: [], totalAP: 0 };
    }
    for (const item of equippedArmor) {
      const armor    = item.system.armor || {};
      const ratings  = getEffectiveArmorRatings(item);
      const resistances = getEffectiveArmorResistances(item);
      const resistanceRatings = getEffectiveArmorResistances(item, { includeDamage: false });
      const damages  = armor.damage      || {};
      const durDamage   = armor.durabilityDamage || 0;
      const durability  = armor.durability       || 0;
      for (const [loc, rating] of Object.entries(ratings)) {
        if (locations[loc] && (rating > 0 || Object.entries(resistanceRatings).some(([category, row]) => category !== "physical" && Number(row[loc]) > 0))) {
          const locDamage   = damages[loc] || 0;
          const currentAP   = armorLocationProtects(armor, loc) ? Math.max(0, rating - locDamage) : 0;
          const currentDur  = remainingArmorDurability(armor, loc) ?? 0;
          locations[loc].totalAP += currentAP;
          locations[loc].items.push({
            id:               item.id,
            name:             item.name,
            img:              item.img,
            durability,
            durabilityDamage: durDamage,
            currentDurability: currentDur,
            rating,
            damage:           locDamage,
            explosiveDamaged: Number(armor.resistanceDamage?.explosive?.[loc]) > 0 || !armorLocationProtects(armor, loc),
            explosiveProtection: clampArmor(this.document, resistances.explosive?.[loc] ?? 0, "explosive"),
            currentRating:    clampArmor(this.document, currentAP)
          });
        }
      }
    }
    return locations;
  }

  /** Use the native Item payload when dragging a beast definition. */
  _onDragStart(event) {
    const row = event.currentTarget?.closest?.(".item[data-item-id]")
      ?? event.target?.closest?.(".item[data-item-id]");
    const item = this.document.items.get(row?.dataset.itemId);
    if (item && isBeastAbility(item)) {
      if (!this.document.isOwner || !event.dataTransfer) return;
      event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
      return;
    }
    return super._onDragStart(event);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = this.element;

    html.querySelectorAll('[data-action="modifyDurability"]').forEach(el => {
      el.addEventListener('contextmenu', async event => {
        event.preventDefault();
        await modifyArmorDurability(this, event, event.currentTarget);
      });
    });

    html.querySelectorAll('[data-action="modifyAP"]').forEach(el => {
      el.addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        const itemId   = event.currentTarget.dataset.itemId;
        const location = event.currentTarget.dataset.location;
        const item     = this.document.items.get(itemId);
        if (!item || item.type !== "armor" || !location) return;
        const current   = item.system.armor?.damage?.[location]   || 0;
        const max       = item.system.armor?.ratings?.[location]  || 0;
        const newDamage = Math.clamp(current + 1, 0, max);
        if (newDamage !== current) await item.update({ [`system.armor.damage.${location}`]: newDamage });
      });
    });

    // Condition value spans (int-type): LMB +1/+10, RMB -1/-10.
    // These listeners are required here because creature-sheet ACTIONS.adjustConditionValue
    // reads target.value (designed for <input> elements), whereas the template renders <span>
    // elements with data-value. We update the span state manually then call _onAdjustConditionValue.
    html.querySelectorAll('.condition-int-span').forEach(el => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const delta = event.ctrlKey ? 10 : 1;
        const allowNeg = el.dataset.allowNegative === "true";
        let val = parseInt(el.dataset.value, 10) || 0;
        val += delta;
        if (!allowNeg) val = Math.max(0, val);
        el.dataset.value = val;
        el.textContent = val;
        this._onAdjustConditionValue(event, el);
      });
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.ctrlKey ? 10 : 1;
        const allowNeg = el.dataset.allowNegative === "true";
        let val = parseInt(el.dataset.value, 10) || 0;
        val -= delta;
        if (!allowNeg) val = Math.max(0, val);
        el.dataset.value = val;
        el.textContent = val;
        this._onAdjustConditionValue(event, el);
      });
    });

    html.querySelectorAll('.container-grid-cell[data-item-id]').forEach(cell => {
      cell.addEventListener('dragover', (event) => {
        event.preventDefault();
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => {
        cell.classList.remove('drag-over');
      });
      cell.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        cell.classList.remove('drag-over');
        const containerId = cell.dataset.itemId;
        const container = this.document.items.get(containerId);
        if (!container || container.type !== "container") return;
        if (container.system.locked && !game.user.isGM) return;
        let dragData;
        try { dragData = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (dragData.type !== "Item") return;
        const sourceItem = await fromUuid(dragData.uuid);
        if (!sourceItem || sourceItem.uuid === container.uuid) return;
        const actor = this.document;
        const maxItems = container.system.maxItems;
        if (maxItems > 0) {
          const cnt = actor.items.filter(i => i.getFlag("neuroshima", "containerId") === containerId).length;
          if (cnt >= maxItems) { ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Container.FullWarning")); return; }
        }
        if (sourceItem.actor?.id === actor.id) {
          await sourceItem.setFlag("neuroshima", "containerId", containerId);
        } else {
          const itemData = sourceItem.toObject();
          foundry.utils.setProperty(itemData, "flags.neuroshima.containerId", containerId);
          await actor.createEmbeddedDocuments("Item", [itemData]);
        }
      });
    });
  }

  /**
   * Persist a changed int-condition value to the backing ActiveEffect.
   * Mirrors NeuroshimaActorSheet._onAdjustConditionValue — duplicated here because
   * creature-sheet does not extend NeuroshimaActorSheet.
   * Called from the .condition-int-span click/contextmenu listeners in _onRender.
   */
  async _onAdjustConditionValue(event, target) {
    const key = target.dataset.conditionKey;
    const allowNegative = target.dataset.allowNegative === "true";
    if (!key) return;
    const actor = this.document;
    let val = parseInt(target.dataset.value ?? target.textContent, 10);
    if (isNaN(val)) val = 0;
    if (!allowNegative) val = Math.max(0, val);
    await actor.setConditionValue(key, val);
  }

  _showItemContextMenu(event, itemId) {
    event.preventDefault();
    const item = this.document.items.get(itemId);
    if (!item) return;

    document.querySelectorAll('.ns-item-ctx-menu').forEach(el => el.remove());

    const isContainer = item.type === 'container';
    const canGenerateMagazine = item.type === 'weapon'
      && ['ranged', 'launcher'].includes(item.system.weaponType);
    const menuItems = [
      { action: 'edit',      icon: 'fas fa-edit',    label: game.i18n.localize('Edit') },
      { action: 'post',      icon: 'fas fa-comment',  label: game.i18n.localize('NEUROSHIMA.ContextMenu.PostToChat') },
      { action: 'duplicate', icon: 'fas fa-copy',     label: game.i18n.localize('NEUROSHIMA.ContextMenu.Duplicate') },
    ];
    if (canGenerateMagazine) {
      menuItems.push({ action: 'generateMagazine', icon: 'fas fa-boxes-stacked', label: game.i18n.localize('NEUROSHIMA.ContextMenu.GenerateLoadedMagazine') });
    }
    if (isContainer && game.user.isGM) {
      const locked = item.system.locked;
      menuItems.push({ action: 'toggleLock', icon: locked ? 'fas fa-lock-open' : 'fas fa-lock', label: game.i18n.localize(locked ? 'NEUROSHIMA.Container.Unlock' : 'NEUROSHIMA.Container.Lock') });
    }
    menuItems.push({ action: 'delete', icon: 'fas fa-trash', label: game.i18n.localize('Delete') });

    const menu = document.createElement('nav');
    menu.className = 'ns-item-ctx-menu context-menu themed theme-dark';
    menu.style.cssText = 'position:fixed;z-index:99999;';
    menu.innerHTML = `<menu class="context-items">${
      menuItems.map(m => `<li class="context-item" data-action="${m.action}"><i class="${m.icon} fa-fw"></i><span>${m.label}</span></li>`).join('')
    }</menu>`;
    document.body.appendChild(menu);

    const x = event.clientX;
    const y = event.clientY;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
      if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
    });

    menu.querySelectorAll('.context-item').forEach(li => {
      li.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = li.dataset.action;
        if (action === 'edit') item.sheet.render(true);
        else if (action === 'post') {
          const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
          await NeuroshimaChatMessage.postItemToChat(item, { actor: this.document });
        }
        else if (action === 'duplicate') item.clone({}, { save: true, parent: this.document });
        else if (action === 'generateMagazine') await createLoadedMagazineFromWeapon(this.document, item);
        else if (action === 'toggleLock') item.update({ "system.locked": !item.system.locked });
        else if (action === 'delete') item.deleteDialog();
        menu.remove();
      });
    });

    const sheetEl = this.element;
    const cleanup = () => {
      menu.remove();
      document.removeEventListener('click', onDocClick, { capture: true });
      document.removeEventListener('contextmenu', onDocContext, { capture: true });
      document.removeEventListener('keydown', onEscape);
    };
    const onDocClick = (e) => {
      if (menu.contains(e.target)) return;
      if (sheetEl && sheetEl.contains(e.target)) return;
      cleanup();
    };
    const onDocContext = (e) => {
      if (menu.contains(e.target)) return;
      if (sheetEl && sheetEl.contains(e.target)) return;
      cleanup();
    };
    const onEscape = (e) => { if (e.key === 'Escape') cleanup(); };
    setTimeout(() => {
      document.addEventListener('click', onDocClick, { capture: true });
      document.addEventListener('contextmenu', onDocContext, { capture: true });
      document.addEventListener('keydown', onEscape);
    }, 0);
  }
}
