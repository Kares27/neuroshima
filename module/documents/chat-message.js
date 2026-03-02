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
    const chatCard = html[0] || html;
    if (!chatCard) return;

    // Pobierz wiadomość powiązaną z HTMLem
    const messageId = chatCard.closest(".chat-message")?.dataset.messageId;
    const message = game.messages.get(messageId);
    if (!message) return;

    // Delegacja zdarzeń dla przycisków akcji
    chatCard.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", event => {
        event.preventDefault();
        const action = btn.dataset.action;
        
        switch (action) {
          case "mod-die":
            this._onModDie(event, message);
            break;
          case "toggle-ready":
            this._onToggleReady(event, message);
            break;
          case "roll-initiative":
            this._onRollInitiative(event, message);
            break;
          case "reset-pool":
            this._onResetPool(event, message);
            break;
          case "join-melee":
            this.onJoinMelee(event, message);
            break;
          case "resolve-duel":
            this._onResolveDuel(event, message);
            break;
          case "reroll-healing":
            this.onRerollHealing(event, message);
            break;
          case "apply-healing":
            this.onApplyHealing(event, message);
            break;
          case "openHealPanel":
            this.onOpenHealPanel(event, message);
            break;
          case "select-die":
            this._onSelectMeleeDie(event, message);
            break;
          case "declare-melee":
            this._onDeclareMeleeAction(event, message);
            break;
          case "respond-melee":
            this._onRespondMeleeAction(event, message);
            break;
          case "takeover-initiative":
            this._onTakeoverMeleeInitiative(event, message);
            break;
        }
      });
    });
  }

  /**
   * Wybór kości do segmentu.
   */
  static async _onSelectMeleeDie(event, message) {
    const btn = event.currentTarget;
    const { side, index } = btn.dataset;
    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (duel) {
        await duel.selectDie(side, parseInt(index));
    }
  }

  /**
   * Deklaracja akcji w segmencie.
   */
  static async _onDeclareMeleeAction(event, message) {
    const btn = event.currentTarget;
    const { type } = btn.dataset;
    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (duel) {
        const role = duel.state.initiative;
        await duel.declareAction(role, type);
    }
  }

  /**
   * Reakcja na akcję w segmencie.
   */
  static async _onRespondMeleeAction(event, message) {
    const btn = event.currentTarget;
    const { response } = btn.dataset;
    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (duel) {
        await duel.respondToAction(response);
    }
  }

  /**
   * Przejęcie inicjatywy.
   */
  static async _onTakeoverMeleeInitiative(event, message) {
    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (duel) {
        await duel.takeoverInitiative();
    }
  }

  /**
   * Delegacja modyfikacji kości do klasy NeuroshimaMeleeDuel (wersja bezkonfliktowa).
   */
  static async _onModDie(event, message) {
    const btn = event.currentTarget;
    const { side, target, index, delta } = btn.dataset;
    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (duel) {
        // side: kogo punkty wydajemy ('attacker'/'defender')
        // target: czyje kości modyfikujemy ('attacker'/'defender')
        await duel.modifyDie(side, target, parseInt(index), parseInt(delta));
    }
  }

  /**
   * Delegacja przełączenia gotowości.
   */
  static async _onToggleReady(event, message) {
    const btn = event.currentTarget;
    const { role } = btn.dataset;
    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (duel) {
        await duel.toggleReady(role);
    }
  }

  /**
   * Obsługa rzutu na inicjatywę.
   */
  static async _onRollInitiative(event, message) {
    const btn = event.currentTarget;
    const { role } = btn.dataset;
    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (duel) {
        await duel.rollInitiative(role);
    }
  }

  /**
   * Delegacja resetu puli punktów.
   */
  static async _onResetPool(event, message) {
    const btn = event.currentTarget;
    const { role } = btn.dataset;
    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (duel) {
        await duel.resetPool(role);
    }
  }

  /**
   * Delegacja rozstrzygnięcia starcia do klasy NeuroshimaMeleeDuel.
   */
  static async _onResolveDuel(event, message) {
    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (duel) {
        await duel.resolve();
    }
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
   * Obsługa przycisku 'Dołącz' na karcie starcia.
   */
  static async onJoinMelee(event, message) {
    const actor = game.user.character || canvas.tokens.controlled[0]?.actor;
    if (!actor) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoActorTokenOnCanvas"));
        return;
    }

    const duel = game.neuroshima.NeuroshimaMeleeDuel.fromMessage(message);
    if (!duel) return;

    const targets = duel.state.attackerTargets || [];
    // Sprawdzamy UUID oraz ID aktora dla kompatybilności
    const isTarget = targets.some(t => t === actor.uuid || t === actor.id || (typeof t === 'object' && t.uuid === actor.uuid));
    
    if (!isTarget && !game.user.isGM) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.CannotDefend"));
        return;
    }

    // Wyczyszczenie flagi pending
    const requestId = duel.state.requestId;
    if (requestId) {
        await this.clearOpposedPendingFlag(actor, requestId);
    } else {
        await this.clearOpposedPendingFlag(actor, "meleePending");
    }

    ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.InstructionDefender"));
    if (actor.sheet) actor.sheet.render(true);
  }

  /**
   * Obsługa odpowiedzi na test przeciwstawny (np. z arkusza).
   */
  static async onClickOpposedResponse(event, message) {
    return this.onJoinMelee(event, message);
  }

  /**
   * Czyści flagę oczekującego testu na aktorze.
   */
  static async clearOpposedPendingFlag(actor, requestId) {
    if (!actor || !requestId) return;
    
    if (actor.isOwner || game.user.isGM) {
        await actor.unsetFlag("neuroshima", `opposedPending.${requestId}`);
        if (typeof actor.render === "function") actor.render(false);
    } else {
        return game.neuroshima.socket.executeAsGM("clearPending", {
            actorUuid: actor.uuid,
            requestId: requestId
        });
    }
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
