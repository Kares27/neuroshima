import { NEUROSHIMA } from "../config.js";

/**
 * Rozszerzona klasa ChatMessage z ujednoliconym API renderowania kart czatu.
 * Zapewnia czysty interfejs do tworzenia i renderowania wszystkich typów wiadomości.
 */
export class NeuroshimaChatMessage extends ChatMessage {

  /**
   * Główny dispatcher akcji na kartach czatu.
   * Wywoływany z hooka renderChatMessageHTML w system.js.
   */
  static onChatAction(html) {
    // Application V2 compatibility: html can be a HTMLElement or a jQuery object
    const root = (html instanceof HTMLElement) ? html : html[0];
    if (!root) return;

    // Pobierz wiadomość powiązaną z HTMLem
    const messageId = root.closest(".chat-message")?.dataset.messageId;
    const message = game.messages.get(messageId);
    if (!message) return;

    // Delegacja zdarzeń dla przycisków akcji
    root.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", event => {
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
        }
      });
    });
  }

  /**
   * Rozpoczyna starcie w zwarciu na podstawie rzutu bronią.
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

    // Jeśli jest wielu przeciwników, bierzemy pierwszego jako głównego (standard 1v1)
    // TODO: Obsługa wielu przeciwników w NeuroshimaMeleeCombat.startDuel
    const defenderId = targets[0];

    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
    await NeuroshimaMeleeCombat.startDuel(attackerId, defenderId);
  }

  /**
   * Obsługa przerzutu leczenia.
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

    // Pobierz dane leczenia z flag
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
        // Aktualizacja wyników w wiadomości
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
    const updates = [];
    const toDelete = [];

    for (const r of results) {
        const wound = patient.items.get(r.woundId);
        if (!wound || wound.type !== "wound") continue;

        const hEffect = r.healingEffect;
        if (!hEffect) continue;

        if (hEffect.newPenalty <= 0) {
            toDelete.push(r.woundId);
        } else {
            const currentAttempts = wound.system.healingAttempts || 0;
            const updateData = {
                _id: r.woundId,
                "system.penalty": hEffect.newPenalty,
                "system.healingAttempts": currentAttempts + 1
            };
            
            // Tylko jeśli test był udany, oznaczamy jako "w trakcie leczenia"
            if (r.isSuccess) {
                updateData["system.isHealing"] = true;
                // Jeśli to była Pierwsza Pomoc, oznaczamy to na ranie
                if (message.getFlag("neuroshima", "healingMethod") === "firstAid") {
                    updateData["system.hadFirstAid"] = true;
                }
            }
            
            updates.push(updateData);
        }
    }

    if (!patient.isOwner && !game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("applyHealingBatch", {
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
   * Typ wiadomości: 'roll' | 'weapon' | 'painResistance'
   */
  static TYPES = {
    ROLL: 'roll',
    WEAPON: 'weapon',
    PAIN_RESISTANCE: 'painResistance',
    INITIATIVE: 'initiative'
  };

  /**
   * Renderuje kartę testu umiejętności/atrybutu.
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
   * Renderuje kartę testu inicjatywy.
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
   * Renderuje kartę testu broni.
   */
  static async renderWeaponRoll(rollData, actor, roll) {
    const template = rollData.isMelee 
      ? "systems/neuroshima/templates/chat/melee-roll-card.hbs"
      : "systems/neuroshima/templates/chat/weapon-roll-card.hbs";
      
    // Pobranie danych o celach dla walki wręcz
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

    const content = await this._renderTemplate(template, {
      ...rollData,
      meleeTargets: targetsData,
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
          messageType: this.TYPES.WEAPON,
          rollData: {
            ...rollData,
            rollMode
          }
        }
      }
    };

    ChatMessage.applyRollMode(chatData, rollMode);
    return this.create(chatData);
  }

  /**
   * Renderuje kartę prośby o leczenie.
   */
  static async renderHealingRequest(patientActor, medicActor, requesterId) {
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
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: patientActor }),
      content: content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "healingRequest",
          patientUuid: patientActor.uuid,
          medicUuid: medicActor?.uuid,
          requesterId: requesterId
        }
      }
    });
  }

  /**
   * Renderuje Kartę Pacjenta do czatu.
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
   * Renderuje raport Odporności na Ból.
   */
  static async renderPainResistance(actor, results, woundIds, reducedCount = 0, reducedDetails = [], options = {}) {
    const template = "systems/neuroshima/templates/chat/pain-resistance-report.hbs";
    
    const passedCount = results.filter(r => r.isPassed).length;
    const failedCount = results.filter(r => !r.isPassed).length;

    const context = {
      actorName: actor.name,
      actorId: actor.id,
      actorUuid: actor.uuid,
      results: results,
      woundIds: woundIds,
      passedCount,
      failedCount,
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
   * Renderuje kartę rzutu leczenia.
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
   * Helper do renderowania szablonów Handlebars.
   */
  static async _renderTemplate(template, context) {
    // v13+ pattern
    if (foundry.applications?.handlebars?.renderTemplate) {
        return await foundry.applications.handlebars.renderTemplate(template, context);
    }
    // Fallback for v12/v11
    if (typeof renderTemplate === "function") {
        return await renderTemplate(template, context);
    }
    return "";
  }

  /**
   * Sprawdza czy użytkownik może widzieć tooltipy rzutów.
   */
  static _canShowTooltip(actor) {
    const minRole = game.settings.get("neuroshima", "rollTooltipMinRole");
    if (game.user.role >= minRole) return true;
    if (game.settings.get("neuroshima", "rollTooltipOwnerVisibility") && actor?.isOwner) return true;
    return false;
  }

  /**
   * Generuje tooltip dla typu obrażeń.
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
}
