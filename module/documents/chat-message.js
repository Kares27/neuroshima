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
          case "meleeOpposedDefend":
            this.onMeleeOpposedDefend(event, btn, message);
            break;
          case "applyOpposedDamage":
            this.onApplyOpposedDamage(event, message);
            break;
        }
      });
    });

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
   * Defender clicks a weapon (or Unarmed) button on the melee-opposed handler card.
   * `btn.dataset.weaponId` is the defender's item ID (empty string = unarmed).
   */
  static async onMeleeOpposedDefend(event, btn, message) {
    const weaponId = btn.dataset.weaponId || null;
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.defendFromChat(message.id, weaponId);
  }

  static async onApplyOpposedDamage(event, message) {
    const btn = event.currentTarget;
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.applyOpposedDamage(message.id);
    // Immediately disable the button in the DOM for the clicking user
    if (btn) {
      btn.disabled = true;
      btn.classList.add("applied");
      btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DamageApplied")}`;
    }
  }

  static _bindResultCardCollapsibles(_root) {
    // No collapsibles on result card currently — kept as hook point for future use.
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
      showTooltip: this._canShowTooltip(actor),
      isVanillaMelee: (game.settings.get("neuroshima", "meleeCombatType") || "default") === "default"
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
      isVanillaMelee: (game.settings.get("neuroshima", "meleeCombatType") || "default") === "default"
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
   * Renderuje raport testu Wytrzymałości pojazdu (jeden lub seria trafień).
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
   * Renderuje wiadomość czatu o odcięciu zacięcia broni przez gracza.
   * @param {Actor} actor   - Aktor który odciął broń
   * @param {Item}  weapon  - Broń która była zacięta
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
            return val ? parseInt(val) : null;
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
    let weight = null;
    let availability = null;
    let hasWeight = false;
    const dash = "—";
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
        armorRatings = locKeys.map(({ key, abbr }) => ({
          label: loc(`NEUROSHIMA.Items.Fields.${abbr}`),
          value: s.armor?.ratings?.[key] ?? 0
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
      default:
        if (s.quantity !== undefined) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
    }
    return { stats, armorRatings, armorBoxStats, magazineContents, weight, availability, hasWeight };
  }

  static async postItemToChat(item, { actor = null } = {}) {
    const limit = await NeuroshimaChatMessage.showItemCardLimitDialog();
    if (limit === "cancel" || limit === undefined) return;

    const description = item.system.description || "";
    const enriched = description ? await TextEditor.enrichHTML(description, { async: true }) : "";

    const typeKey = item.type.charAt(0).toUpperCase() + item.type.slice(1).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const typeLabel = game.i18n.localize(`NEUROSHIMA.Items.Type.${typeKey}`) || item.type;

    const { stats, armorRatings, armorBoxStats, magazineContents, weight, availability, hasWeight } = NeuroshimaChatMessage.buildItemChatStats(item);
    const hasStats = stats.length > 0 || !!armorRatings || !!armorBoxStats;
    const isUnlimited = limit === null;

    const content = await NeuroshimaChatMessage._renderTemplate(
      "systems/neuroshima/templates/chat/item-card.hbs",
      {
        name: item.name, img: item.img, type: item.type, typeLabel,
        uuid: item.uuid, description: enriched,
        stats, armorRatings, armorBoxStats, hasStats,
        magazineContents,
        weight, availability, hasWeight,
        remaining: limit, isUnlimited, isExhausted: false
      }
    );

    const rollMode = game.settings.get("core", "rollMode");
    const msgData = {
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker({}),
      content,
      flags: { neuroshima: { itemCard: { limit, remaining: limit, sourceActorId: actor?.id ?? null } } }
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
