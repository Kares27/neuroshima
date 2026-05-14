import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/dice.js";
import { RestDialog } from "../apps/rest-dialog.js";
import { getConditions } from "../apps/condition-config.js";
import { NeuroshimaBaseActorSheet } from "./actor-sheet-base.js";
import { getEffectiveArmorRatings } from "../helpers/mod-helpers.js";

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
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "actor", "actor-creature"],
    position: { width: 720, height: 800 },
    window: { title: "NEUROSHIMA.Sheet.ActorCreature", resizable: true },
    form: { submitOnChange: true, submitOnClose: true, submitOnUnfocus: true },
    actions: {
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
        return NeuroshimaCreatureSheet._showRollDialog({ stat: attrValue, skill: 0, label, actor, isSkill: false });
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
        return NeuroshimaCreatureSheet._showRollDialog({ stat: 0, skill: exp, label, actor, isSkill: true, currentAttribute: "dexterity" });
      },

      rollKondycja: async function() {
        const actor  = this.document;
        const system = actor.system;
        const con    = system.attributeTotals?.["constitution"] ?? (system.attributes?.["constitution"] || 0);
        const label  = game.i18n.localize("NEUROSHIMA.Creature.Kondycja");
        return NeuroshimaCreatureSheet._showRollDialog({ stat: con, skill: 0, label, actor, isSkill: false });
      },

      toggleDifficulties: async function() {
        this._difficultiesCollapsed = !this._difficultiesCollapsed;
        this.render();
      },

      rollMeleeInitiative: async function() {
        const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
        const dialog = new NeuroshimaInitiativeRollDialog({ actor: this.document });
        const result = await dialog.render(true);
        if (!result) return;
        await this.document.update({ "system.combat.meleeInitiative": Number(result.successPoints) });
      },

      rollWeapon: async function(event, target) {
        const li   = target.closest("[data-item-id]");
        const item = this.document.items.get(li?.dataset.itemId ?? target.dataset.itemId);
        if (!item) return;

        if (item.system.weaponType === "melee") {

          // ── Chat-based opposed modes ──────────────────────────────────────
          const combatTypeSetting = game.settings.get("neuroshima", "meleeCombatType") || "default";
          if (combatTypeSetting === "opposedPips" || combatTypeSetting === "opposedSuccesses") {
            const myUuidsCheck = [this.document.uuid];
            if (this.document.token) myUuidsCheck.push(this.document.token.uuid);

            // 1. Actor flag (WFRP-style primary check)
            const opposeFlag = this.document.getFlag("neuroshima", "oppose");
            if (opposeFlag?.messageId) {
              const pendingMsg = game.messages.get(opposeFlag.messageId);
              const opposeData = pendingMsg?.getFlag("neuroshima", "opposedChat");
              if (opposeData?.status === "pending") {
                const syntheticPending = {
                  id: opposeData.defenderUuid,
                  attackerId: opposeData.attackerUuid,
                  attackerTokenUuid: opposeData.attackerTokenUuid,
                  defenderId: opposeData.defenderUuid,
                  mode: opposeData.mode,
                  opposedChatMessageId: opposeFlag.messageId
                };
                const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
                await MeleeOpposedChat.openDefenseDialog(this.document, syntheticPending, item.id);
                return;
              }
              await this.document.unsetFlag("neuroshima", "oppose");
            }

            // 2. Fallback: combat pending
            const combatPendings = game.combat?.getFlag("neuroshima", "meleePendings") || {};
            const opposedPending = Object.values(combatPendings).find(p => {
              if (!p.active || !p.mode) return false;
              return myUuidsCheck.some(u => game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, u));
            });
            if (opposedPending) {
              const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
              await MeleeOpposedChat.openDefenseDialog(this.document, opposedPending, item.id);
              return;
            }

            // 3. No pending — initiate new attack
            const rawTargets = Array.from(game.user.targets ?? []);
            const chatTargets = rawTargets.filter(t => !myUuidsCheck.includes(t.document.uuid));
            if (chatTargets.length > 0) {
              const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
              await MeleeOpposedChat.initiateAttack(this.document, item, chatTargets[0].document.uuid, combatTypeSetting);
              return;
            }
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
              const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
              await MeleeOpposedChat.openDefenseDialog(this.document, existingPending, item.id);
              return;
            }
            // ── Standard melee pending ────────────────────────────────────────
            const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
            const initiativeDialog = new NeuroshimaInitiativeRollDialog({
              actor: this.document,
              isMelee: true,
              meleeMode: "respond",
              pendingId: existingPending.id,
              weaponId: item.id,
              targets: [targetUuid],
              onRoll: async (rollData) => {
                const result = await game.neuroshima.NeuroshimaDice.rollInitiative({ ...rollData, actor: this.document, isMeleeInitiative: true });
                const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
                await NeuroshimaMeleeCombat.respondToMeleePending(existingPending.id, result.successPoints, item.id);
                return result;
              }
            });
            await initiativeDialog.render(true);
            return;
          }

          const activeEncounterId = this.document.getFlag("neuroshima", "activeMeleeEncounter");
          if (activeEncounterId && !targetUuid) {
            const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
            NeuroshimaMeleeCombat.openMeleeApp(activeEncounterId);
            return;
          }

          if (targetUuid) {
            if (!game.combat) {
              ui.notifications.warn("Najpierw utwórz Encounter w Combat Trackerze.");
              return;
            }
            const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
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

        const { NeuroshimaWeaponRollDialog } = await import("../apps/weapon-roll-dialog.js");
        const dialog = new NeuroshimaWeaponRollDialog({ actor: this.document, weapon: item, rollType: item.system.weaponType });
        dialog.render(true);
      },

      rollBeastAction: async function(event, target) {
        const li   = target.closest("[data-item-id]");
        const item = this.document.items.get(li?.dataset.itemId ?? target.dataset.itemId);
        if (!item || item.type !== "beast-action") return;

        const actor = this.document;
        const attrKey = item.system.attribute || "dexterity";
        const attrValue = actor.system.attributeTotals?.[attrKey] ?? (actor.system.attributes?.[attrKey] || 0);
        const exp = actor.system.experience ?? 0;

        const syntheticWeapon = {
          id: item.id,
          name: item.name,
          img: item.img,
          type: "weapon",
          system: {
            weaponType: "melee",
            attribute: attrKey,
            skill: "experience",
            attackBonus: 0,
            defenseBonus: 0,
            damageMelee1: item.system.damage || "D",
            damageMelee2: item.system.damage || "D",
            damageMelee3: item.system.damage || "D",
            requiredBuild: 0,
            piercing: item.system.piercing ?? 0,
            magazine: null,
            jamming: 20
          }
        };

        const combatTypeSetting = game.settings.get("neuroshima", "meleeCombatType") || "default";
        if (combatTypeSetting === "opposedPips" || combatTypeSetting === "opposedSuccesses") {
          const myUuidsCheck = [actor.uuid];
          if (actor.token) myUuidsCheck.push(actor.token.uuid);

          const opposeFlag = actor.getFlag("neuroshima", "oppose");
          if (opposeFlag?.messageId) {
            const pendingMsg = game.messages.get(opposeFlag.messageId);
            const opposeData = pendingMsg?.getFlag("neuroshima", "opposedChat");
            if (opposeData?.status === "pending") {
              const syntheticPending = {
                id: opposeData.defenderUuid,
                attackerId: opposeData.attackerUuid,
                attackerTokenUuid: opposeData.attackerTokenUuid,
                defenderId: opposeData.defenderUuid,
                mode: opposeData.mode,
                opposedChatMessageId: opposeFlag.messageId
              };
              const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
              await MeleeOpposedChat.openDefenseDialog(actor, syntheticPending, null, syntheticWeapon);
              return;
            }
            await actor.unsetFlag("neuroshima", "oppose");
          }

          const combatPendings = game.combat?.getFlag("neuroshima", "meleePendings") || {};
          const opposedPending = Object.values(combatPendings).find(p => {
            if (!p.active || !p.mode) return false;
            return myUuidsCheck.some(u => game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, u));
          });
          if (opposedPending) {
            const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
            await MeleeOpposedChat.openDefenseDialog(actor, opposedPending, null, syntheticWeapon);
            return;
          }

          const rawTargets = Array.from(game.user.targets ?? []);
          const chatTargets = rawTargets.filter(t => !myUuidsCheck.includes(t.document.uuid));
          if (chatTargets.length > 0) {
            const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
            await MeleeOpposedChat.initiateAttack(actor, syntheticWeapon, chatTargets[0].document.uuid, combatTypeSetting);
            return;
          }
        }

        const { NeuroshimaWeaponRollDialog } = await import("../apps/weapon-roll-dialog.js");
        const dialog = new NeuroshimaWeaponRollDialog({ actor, weapon: syntheticWeapon, rollType: "melee" });
        dialog.render(true);
      },

      createItem: async function(event, target) {
        const type = target.dataset.type || "weapon";
        const name = `${game.i18n.localize("DOCUMENT.New")} ${game.i18n.localize(`TYPES.Item.${type}`) || type}`;
        return this.document.createEmbeddedDocuments("Item", [{ name, type }]);
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
        if (!item) return;
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
        const itemId = target.dataset.itemId;
        const item   = this.document.items.get(itemId);
        if (!item || item.type !== "armor") return;
        const isRight    = event.type === "contextmenu";
        const current    = item.system.armor?.durabilityDamage || 0;
        const max        = item.system.armor?.durability || 0;
        const newDamage  = Math.clamp(isRight ? current + 1 : current - 1, 0, max);
        if (newDamage !== current) await item.update({ "system.armor.durabilityDamage": newDamage });
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

      toggleCondition: async function(event, target) {
        const key  = target.dataset.conditionKey;
        const type = target.dataset.conditionType;
        if (!key) return;
        if (type === "boolean") {
          await this.document.toggleStatusEffect(key);
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
        const existing = actor.effects.find(
          e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
        );
        if (val === 0 && !allowNegative) {
          if (existing) await existing.delete();
          return;
        }
        if (existing) {
          await existing.setFlag("neuroshima", "conditionValue", val);
        } else if (val !== 0) {
          const condDef = getConditions().find(c => c.key === key);
          if (!condDef) return;
          await actor.createEmbeddedDocuments("ActiveEffect", [{
            name:        condDef.name,
            img:         condDef.img          ?? "icons/svg/aura.svg",
            tint:        condDef._tint        ?? null,
            description: condDef._description ?? "",
            disabled:    condDef._disabled    ?? false,
            statuses:    [key],
            changes:     foundry.utils.deepClone(condDef.changes   ?? []),
            duration:    foundry.utils.deepClone(condDef._duration ?? {}),
            flags: {
              neuroshima: {
                conditionNumbered: true,
                conditionValue:    val,
                scripts:           foundry.utils.deepClone(condDef.scripts      ?? []),
                transferType:      condDef._transferType  ?? "owningDocument",
                documentType:      condDef._documentType  ?? "actor",
                equipTransfer:     condDef._equipTransfer ?? false
              }
            }
          }]);
        }
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

        if (messageId) {
          const msg = game.messages.get(messageId);
          const chatData = msg?.getFlag("neuroshima", "opposedChat");
          if (chatData?.status === "pending") {
            await msg.setFlag("neuroshima", "opposedChat", { ...chatData, status: "cancelled" });
          }
        }

        const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
        await MeleeOpposedChat._unsetDefenderFlag(pendingId);

        const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
        await NeuroshimaMeleeCombat.dismissMeleePending(pendingId);
      },

      respondToOpposed: async function(event, target) {
        const opposeFlag = this.document.getFlag("neuroshima", "oppose");
        if (opposeFlag?.messageId) {
          const pendingMsg = game.messages.get(opposeFlag.messageId);
          const opposeData = pendingMsg?.getFlag("neuroshima", "opposedChat");
          if (opposeData?.status === "pending") {
            const syntheticPending = {
              id: opposeData.defenderUuid,
              attackerId: opposeData.attackerUuid,
              attackerTokenUuid: opposeData.attackerTokenUuid,
              defenderId: opposeData.defenderUuid,
              mode: opposeData.mode,
              opposedChatMessageId: opposeFlag.messageId
            };
            const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
            await MeleeOpposedChat.openDefenseDialog(this.document, syntheticPending);
            return;
          }
          await this.document.unsetFlag("neuroshima", "oppose");
        }
        const pendings = game.combat?.getFlag("neuroshima", "meleePendings") || {};
        const pending = Object.values(pendings).find(p => p.active && p.mode &&
          game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, this.document.uuid));
        if (pending) {
          const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
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
      }
    },
    dragDrop: [{ dragSelector: ".item[data-item-id]", dropSelector: "form" }]
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

    context.attributeList         = NEUROSHIMA.attributes;
    context.difficulties          = NEUROSHIMA.difficulties;
    context.difficultiesCollapsed = this._difficultiesCollapsed;
    context.effectTooltips        = this._buildEffectTooltips(actor);
    context.experience            = system.experience ?? 0;
    context.kondycja              = system.kondycja   ?? 0;

    const items = actor.items.contents;
    const armorItems = items.filter(i => i.type === "armor");
    const equippedWeapons = items.filter(i => i.type === "weapon" && i.system.equipped &&
      (i.system.weaponType === "melee" || i.system.weaponType === "ranged" || i.system.weaponType === "thrown"));

    context.inventory = {
      weaponsMelee:   items.filter(i => i.type === "weapon" && i.system.weaponType === "melee"),
      weaponsRanged:  items.filter(i => i.type === "weapon" && i.system.weaponType === "ranged"),
      weaponsThrown:  items.filter(i => i.type === "weapon" && i.system.weaponType === "thrown"),
      armor:          armorItems,
      gear:           items.filter(i => i.type === "gear"),
      ammo:           items.filter(i => i.type === "ammo"),
      magazines:      items.filter(i => i.type === "magazine").map(m => {
        m.contentsReversed = [...(m.system.contents || [])].reverse();
        return m;
      }),
      beastActions:   [...items.filter(i => i.type === "beast-action"), ...equippedWeapons],

      wounds:         items.filter(i => i.type === "wound")
    };

    const anatomicalArmor = this._prepareAnatomicalArmor(armorItems.filter(i => i.system.equipped), actor);

    const bonusAll      = Number(system.armorBonus?.all) || 0;
    const natArmorLabel = game.i18n.localize("NEUROSHIMA.Creature.NaturalArmor");
    const effectBonus   = _collectCreatureArmorBonusByEffect(actor);
    context.armorLocations = Object.entries(NEUROSHIMA.bodyLocations).map(([key, data]) => {
      const reduction  = system.naturalArmor?.[key]?.reduction ?? 0;
      const locItems   = anatomicalArmor[key]?.items ?? [];
      const itemsAP    = anatomicalArmor[key]?.totalAP ?? 0;
      const bonusLoc   = Number(system.armorBonus?.[key]) || 0;
      const bonus      = bonusAll + bonusLoc;

      const tooltipParts = [];
      if (reduction > 0) tooltipParts.push(`${foundry.utils.escapeHTML(natArmorLabel)}: <strong>${reduction}</strong>`);
      for (const itm of locItems) {
        tooltipParts.push(`${foundry.utils.escapeHTML(itm.name)}: <strong>${itm.currentRating}</strong>`);
      }
      for (const e of [...(effectBonus.all ?? []), ...(effectBonus[key] ?? [])]) {
        const sign = e.value >= 0 ? "+" : "";
        tooltipParts.push(`${foundry.utils.escapeHTML(e.name)}: <strong>${sign}${e.value}</strong>`);
      }

      return {
        key,
        label:            game.i18n.localize(data.label),
        reduction,
        hitPenalty:       system.naturalArmor?.[key]?.hitPenalty ?? 0,
        weakPoint:        system.naturalArmor?.[key]?.weakPoint  ?? false,
        items:            locItems,
        totalAP:          itemsAP,
        totalEffectiveAP: reduction + itemsAP + bonus,
        tooltip:          tooltipParts.join("<br>")
      };
    });

    const totalArmorPenalty = system.combat?.totalArmorPenalty || 0;
    const totalWoundPenalty = system.combat?.totalWoundPenalty || 0;
    const maxHP = actor.getFlag("neuroshima", "creatureMaxHP") || system.combat?.maxHP || 27;
    const totalArmorAP = context.armorLocations.reduce((sum, loc) => sum + (loc.reduction || 0) + (loc.totalAP || 0), 0);
    const meleePendingsFromCombat = Object.values(game.combat?.getFlag("neuroshima", "meleePendings") || {})
      .filter(p => {
        if (!p.active) return false;
        if (p.opposedChatMessageId) {
          const msg = game.messages.get(p.opposedChatMessageId);
          const chatData = msg?.getFlag("neuroshima", "opposedChat");
          if (chatData?.status && chatData.status !== "pending") return false;
        }
        return true;
      })
      .map(p => {
        const matchesDefender = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, actor.uuid);
        const matchesAttacker = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.attackerId, actor.uuid);
        return { ...p, matchesDefender, matchesAttacker };
      })
      .filter(p => p.matchesDefender || p.matchesAttacker);

    const opposeFlag = actor.getFlag("neuroshima", "oppose");
    if (opposeFlag?.messageId && !meleePendingsFromCombat.some(p => p.matchesDefender)) {
      const msg = game.messages.get(opposeFlag.messageId);
      const data = msg?.getFlag("neuroshima", "opposedChat");
      if (data?.status === "pending") {
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
      totalCombatPenalty: totalArmorPenalty + totalWoundPenalty,
      totalDamagePoints:  system.combat?.totalDamagePoints || 0,
      totalArmorAP,
      maxHP,
      meleeInitiative:    system.combat?.meleeInitiative || 0,
      wounds:             items.filter(i => i.type === "wound"),
      meleePendings:      meleePendingsFromCombat
    };

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
    const isTemporary = (e) => !!(
      e.duration?.rounds || e.duration?.seconds || e.duration?.turns ||
      e.getFlag("neuroshima", "fromAura") || e.getFlag("neuroshima", "fromArea")
    );
    const isConditionEffect = (e) => e.statuses?.size > 0;

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
        isItemEffect: !!isItemEffect
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
        const fromAura = e.getFlag("neuroshima", "fromAura");
        const fromArea = e.getFlag("neuroshima", "fromArea");
        const sourceActorId = fromAura?.sourceActorId ?? fromArea?.sourceActorId ?? null;
        const sourceActor = sourceActorId ? game.actors.get(sourceActorId) : null;
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

    context.conditionStates = condDefs.map(c => {
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
    }).sort((a, b) => (a.type === "int" ? 1 : 0) - (b.type === "int" ? 1 : 0));

    context.itemManualScripts = this._prepareItemManualScripts(actor);

    return context;
  }

  _prepareItemManualScripts(actor) {
    const map = {};
    for (const item of (actor.items ?? [])) {
      const scripts = [];
      for (const eff of (item.effects ?? [])) {
        if (eff.disabled) continue;
        const flags = eff.getFlag?.("neuroshima", "scripts") ?? [];
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
    const tooltips = {};
    for (const key of attrKeys) tooltips[key] = "";
    for (const effect of actor.effects) {
      if (effect.disabled || effect.isSuppressed) continue;
      for (const change of (effect.changes ?? [])) {
        if (!change.key) continue;
        const attrMatch = change.key.match(/^system\.attributeBonuses\.(\w+)$/);
        const modMatch  = change.key.match(/^system\.bonuses\.(\w+)$/);
        const match = attrMatch || modMatch;
        if (!match) continue;
        const key = match[1];
        if (!attrKeys.includes(key)) continue;
        const val  = Number(change.value) || 0;
        const part = `${effect.name ?? "?"}: ${val >= 0 ? "+" : ""}${val}`;
        tooltips[key] = tooltips[key] ? tooltips[key] + "\n" + part : part;
      }
    }
    return tooltips;
  }

  /** @override */
  async _onDropItem(event, data) {
    const item = await fromUuid(data.uuid);
    if (!item) return;
    if (["weapon", "armor", "gear", "ammo", "magazine", "wound", "beast-action"].includes(item.type)) {
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
      locations[key] = { label: data.label, items: [], totalAP: 0 };
    }
    for (const item of equippedArmor) {
      const armor    = item.system.armor || {};
      const ratings  = getEffectiveArmorRatings(item);
      const damages  = armor.damage      || {};
      const durDamage   = armor.durabilityDamage || 0;
      const durability  = armor.durability       || 0;
      for (const [loc, rating] of Object.entries(ratings)) {
        if (rating > 0 && locations[loc]) {
          const locDamage   = damages[loc] || 0;
          const currentAP   = Math.max(0, rating - locDamage);
          const currentDur  = Math.max(0, durability - durDamage);
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
            currentRating:    currentAP
          });
        }
      }
    }
    return locations;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = this.element;

    html.querySelectorAll('[data-action="modifyDurability"]').forEach(el => {
      el.addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        const itemId  = event.currentTarget.dataset.itemId;
        const item    = this.document.items.get(itemId);
        if (!item || item.type !== "armor") return;
        const current   = item.system.armor?.durabilityDamage || 0;
        const max       = item.system.armor?.durability       || 0;
        const newDamage = Math.clamp(current + 1, 0, max);
        if (newDamage !== current) await item.update({ "system.armor.durabilityDamage": newDamage });
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
  }

  _showItemContextMenu(event, itemId) {
    event.preventDefault();
    const item = this.document.items.get(itemId);
    if (!item) return;

    document.querySelectorAll('.ns-item-ctx-menu').forEach(el => el.remove());

    const menuItems = [
      { action: 'edit',      icon: 'fas fa-edit',    label: game.i18n.localize('Edit') },
      { action: 'post',      icon: 'fas fa-comment',  label: game.i18n.localize('NEUROSHIMA.ContextMenu.PostToChat') },
      { action: 'duplicate', icon: 'fas fa-copy',     label: game.i18n.localize('NEUROSHIMA.ContextMenu.Duplicate') },
      { action: 'delete',    icon: 'fas fa-trash',    label: game.i18n.localize('Delete') }
    ];

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
