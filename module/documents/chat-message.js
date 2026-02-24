import { NEUROSHIMA } from "../config.js";

/**
 * Rozszerzona klasa ChatMessage z ujednoliconym API renderowania kart czatu.
 * Zapewnia czysty interfejs do tworzenia i renderowania wszystkich typów wiadomości.
 */
export class NeuroshimaChatMessage extends ChatMessage {
  /**
   * Tworzy wiadomość handlera dla testu przeciwstawnego (WFRP4e Pattern).
   * 
   * @param {ChatMessage} attackMessage - Wiadomość rzutu ataku
   * @param {Actor} defender - Aktor obrońcy
   * @returns {Promise<ChatMessage>}
   */
  static async createOpposedHandler(attackMessage, defender) {
    const attackData = attackMessage.getFlag("neuroshima", "rollData");
    const attacker = game.actors.get(attackData.actorId);
    const requestId = foundry.utils.randomID();
    
    // Pobierz tokeny jeśli to możliwe (dla lepszego wsparcia wielu tokenów tego samego aktora)
    const attackerToken = canvas.tokens.get(ChatMessage.getSpeaker({ actor: attacker }).token);
    const defenderToken = canvas.tokens.placeables.find(t => t.actor?.id === defender.id && t.targeted.has(game.user)) 
                         || canvas.tokens.placeables.find(t => t.actor?.id === defender.id);

    game.neuroshima.group("NeuroshimaChatMessage | createOpposedHandler");
    game.neuroshima.log("Tworzenie handlera testu przeciwstawnego", {
      requestId,
      attacker: attacker?.name,
      defender: defender?.name,
      attackMessageId: attackMessage.id
    });

    const template = "systems/neuroshima/templates/chat/opposed-handler.hbs";
    const context = {
      requestId,
      status: "waiting",
      attacker: {
        id: attacker?.id,
        tokenId: attackerToken?.id,
        name: attackerToken?.name || attacker?.name,
        img: attackerToken?.document?.texture?.src || attacker?.img
      },
      defender: {
        id: defender.id,
        tokenId: defenderToken?.id,
        name: defenderToken?.name || defender.name,
        img: defenderToken?.document?.texture?.src || defender.img
      },
      isGM: game.user.isGM
    };

    const content = await this._renderTemplate(template, context);

    const handlerMessage = await this.create({
      user: game.user.id,
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "opposedHandler",
          opposedData: {
            requestId,
            status: "waiting",
            attackerId: attacker?.id,
            attackerTokenId: attackerToken?.id,
            defenderId: defender.id,
            defenderTokenId: defenderToken?.id,
            attackMessageId: attackMessage.id,
            mode: game.settings.get("neuroshima", "opposedMeleeMode")
          }
        }
      }
    });

    // Ustaw flagę pending na obrońcy
    await this.setOpposedPendingFlag(defender, requestId, handlerMessage.id);

    game.neuroshima.groupEnd();
    return handlerMessage;
  }

  /**
   * Ustawia flagę pending na obrońcy (obsługuje socket jeśli brak uprawnień).
   */
  static async setOpposedPendingFlag(actor, requestId, handlerMessageId) {
    // W walce wręcz zawsze 1v1 - wyczyść poprzednie testy
    const pending = actor.getFlag("neuroshima", "opposedPending") || {};
    const updates = {};
    for (const id of Object.keys(pending)) {
        updates[`flags.neuroshima.opposedPending.-=${id}`] = null;
    }

    const flagData = {
      handlerMessageId,
      requestId,
      createdAt: Date.now()
    };

    if (actor.isOwner || game.user.isGM) {
      if (Object.keys(updates).length > 0) {
          await actor.update(updates);
      }
      await actor.setFlag("neuroshima", "opposedPending", { [requestId]: flagData });
    } else {
      // Wyślij żądanie do GM przez socket
      game.socket.emit("system.neuroshima", {
        type: "opposed.setPending",
        actorUuid: actor.uuid,
        flagData,
        clearExisting: true
      });
    }
  }

  /**
   * Usuwa flagę pending na obrońcy.
   */
  static async clearOpposedPendingFlag(actor, requestId) {
    if (actor.isOwner || game.user.isGM) {
      await actor.update({ [`flags.neuroshima.opposedPending.-=${requestId}`]: null });
    } else {
      game.socket.emit("system.neuroshima", {
        type: "opposed.clearPending",
        actorUuid: actor.uuid,
        requestId
      });
    }
  }

  /**
   * Obsługa kliknięcia przycisku odpowiedzi w handlerze.
   */
  static async onClickOpposedResponse(event, message) {
    const opposedData = message.getFlag("neuroshima", "opposedData");
    if (!opposedData) return;

    const defender = game.actors.get(opposedData.defenderId);
    if (!defender) {
      ui.notifications.error(game.i18n.localize("NEUROSHIMA.Errors.DefenderNotFound"));
      return;
    }

    // Sprawdzenie uprawnień (owner obrońcy lub GM)
    if (!defender.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NotYourActor"));
      return;
    }

    // Otwórz dialog obrony
    const { NeuroshimaMeleeDefenseDialog } = await import('../dialogs/melee-defense-dialog.js');
    await NeuroshimaMeleeDefenseDialog.show(defender, message);
  }

  /**
   * Obsługa rozstrzygnięcia testu przeciwstawnego.
   * Może być wywołane przez kliknięcie (event) lub automatycznie przez hook (options).
   */
  static async resolveOpposed(event, message, options = {}) {
    const opposedData = message.getFlag("neuroshima", "opposedData");
    if (!opposedData) return;
    
    // Status musi być 'ready' dla kliknięć, ale dla auto-resolve pozwalamy jeśli mamy defenseMessageId
    const defenseMessageId = options.defenseMessageId || opposedData.defenseMessageId;
    if (opposedData.status === "resolved") return;
    if (opposedData.status !== "ready" && !options.defenseMessageId) return;

    const attackMessage = game.messages.get(opposedData.attackMessageId);
    const defenseMessage = game.messages.get(defenseMessageId);

    if (!attackMessage || !defenseMessage) {
        if (!options.defenseMessageId) {
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.Errors.MissingOpposedMessages"));
        }
        return;
    }

    // Importy
    const { NeuroshimaMeleeOpposed } = await import('../helpers/melee-opposed.js');

    // Oblicz wynik
    const attackFlags = attackMessage.getFlag("neuroshima", "rollData");
    const defenseFlags = defenseMessage.getFlag("neuroshima", "rollData");
    
    const opposedOptions = {
      mode: opposedData.mode,
      tier2At: game.settings.get("neuroshima", "opposedMeleeTier2At"),
      tier3At: game.settings.get("neuroshima", "opposedMeleeTier3At")
    };
    
    const result = NeuroshimaMeleeOpposed.compute(attackFlags, defenseFlags, opposedOptions);
    
    // Pobierz aktorów do renderowania
    const attacker = game.actors.get(opposedData.attackerId);
    const defender = game.actors.get(opposedData.defenderId);

    const opposedHTML = NeuroshimaMeleeOpposed.renderOpposedResult(result, attacker, defender);

    // Stwórz wiadomość wyniku
    const template = "systems/neuroshima/templates/chat/opposed-result.hbs";
    const content = await this._renderTemplate(template, {
      requestId: opposedData.requestId,
      opposedResultHTML: opposedHTML,
      winner: result.winner,
      spDifference: result.spDifference,
      isGM: game.user.isGM
    });

    const resultMessage = await this.create({
      user: game.user.id,
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "opposedResult",
          opposedResult: result,
          requestId: opposedData.requestId,
          attackMessageId: attackMessage.id,
          defenseMessageId: defenseMessage.id,
          defenderId: defender.id
        }
      }
    });

    // Zaktualizuj handler
    const updatedOpposedData = foundry.utils.mergeObject(opposedData, {
      status: "resolved",
      defenseMessageId: defenseMessage.id,
      resultMessageId: resultMessage.id
    });
    
    const handlerTemplate = "systems/neuroshima/templates/chat/opposed-handler.hbs";
    const handlerContent = await this._renderTemplate(handlerTemplate, {
      requestId: opposedData.requestId,
      status: "resolved",
      attacker: { name: attacker?.name, img: attacker?.img },
      defender: { name: defender.name, img: defender.img },
      isGM: game.user.isGM
    });

    await message.update({
      content: handlerContent,
      flags: { neuroshima: { opposedData: updatedOpposedData } }
    });

    // Wyczyść flagę pending na obrońcy
    await this.clearOpposedPendingFlag(defender, opposedData.requestId);
  }

  /**
   * Obsługa kliknięcia przycisku Apply Damage na karcie wyniku.
   */
  static async onApplyOpposedDamage(event, message) {
    const result = message.getFlag("neuroshima", "opposedResult");
    const defenderId = message.getFlag("neuroshima", "defenderId");
    const attackMessageId = message.getFlag("neuroshima", "attackMessageId");

    if (!result || !defenderId || !attackMessageId) {
      game.neuroshima.error("Missing data for applying opposed damage", { result, defenderId, attackMessageId });
      return;
    }

    const defender = game.actors.get(defenderId);
    const attackMessage = game.messages.get(attackMessageId);
    const attackData = attackMessage?.getFlag("neuroshima", "rollData");

    if (!defender || !attackData) return;

    // Sprawdzenie uprawnień (owner obrońcy lub GM)
    if (!defender.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NotYourActor"));
      return;
    }

    // Zapobieganie podwójnej aplikacji obrażeń
    if (message.getFlag("neuroshima", "damageApplied")) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.DamageAlreadyApplied"));
        return;
    }

    const { CombatHelper } = await import('../helpers/combat-helper.js');
    
    const options = {
      attackerMessageId: attackMessageId,
      spDifference: result.spDifference,
      isOpposed: true
    };

    await CombatHelper.applyDamageToActor(defender, attackData, options);

    // Oznacz wiadomość jako "obrażenia nałożone"
    await message.setFlag("neuroshima", "damageApplied", true);
    
    // Zaktualizuj przycisk w HTML
    const button = event.target.closest("button");
    if (button) {
        button.disabled = true;
        button.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("NEUROSHIMA.Roll.DamageApplied")}`;
    }

    ui.notifications.info(game.i18n.localize("NEUROSHIMA.Notifications.DamageApplied"));
  }

  /**
   * Typ wiadomości: 'roll' | 'weapon' | 'painResistance'
   */
  static TYPES = {
    ROLL: 'roll',
    WEAPON: 'weapon',
    PAIN_RESISTANCE: 'painResistance'
  };

  /**
   * Renderuje kartę testu umiejętności/atrybutu.
   * 
   * @param {Object} rollData - Dane przygotowane z NeuroshimaDice.rollTest()
   * @param {Actor} actor - Aktor wykonujący test
   * @param {Roll} roll - Obiekt Roll z wynikami kości
   * @returns {Promise<ChatMessage>}
   */
  static async renderRoll(rollData, actor, roll) {
    game.neuroshima.group("NeuroshimaChatMessage | renderRoll");
    game.neuroshima.log("Renderowanie karty testu umiejętności", {
      label: rollData.label,
      actor: actor?.name,
      skill: rollData.skill,
      stat: rollData.stat,
      isOpen: rollData.isOpen
    });

    const template = "systems/neuroshima/templates/chat/roll-card.hbs";
    const content = await this._renderTemplate(template, {
      ...rollData,
      config: NEUROSHIMA,
      showTooltip: this._canShowTooltip(actor)
    });

    game.neuroshima.log("Karta czatu utworzona", { messageType: this.TYPES.ROLL });
    game.neuroshima.groupEnd();

    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: this.TYPES.ROLL,
          rollData: {
            isWeapon: false,
            actorId: actor?.id,
            isOpen: rollData.isOpen,
            results: rollData.rawResults,
            rawResults: rollData.rawResults,
            totalPenalty: rollData.totalPenalty,
            penalties: rollData.penalties,
            target: rollData.target,
            skill: rollData.skill,
            skillBonus: rollData.skillBonus,
            attributeBonus: rollData.attributeBonus,
            baseSkill: rollData.baseSkill,
            baseStat: rollData.baseStat,
            isSuccess: rollData.isSuccess,
            successPoints: rollData.successPoints,
            difficultyLabel: rollData.difficultyLabel,
            baseDifficultyLabel: rollData.baseDifficultyLabel,
            label: rollData.label,
            isDebug: rollData.isDebug
          }
        }
      }
    });
  }

  /**
   * Renderuje kartę testu broni.
   * 
   * @param {Object} rollData - Dane przygotowane z NeuroshimaDice.rollWeaponTest()
   * @param {Actor} actor - Aktor wykonujący test
   * @param {Roll} roll - Obiekt Roll z wynikami kości
   * @returns {Promise<ChatMessage>}
   */
  static async renderWeaponRoll(rollData, actor, roll) {
    game.neuroshima.group("NeuroshimaChatMessage | renderWeaponRoll");
    game.neuroshima.log("Renderowanie karty testu broni", {
      label: rollData.label,
      actor: actor?.name,
      weaponType: rollData.isMelee ? "melee" : "ranged",
      damage: rollData.damage,
      bulletsFired: rollData.bulletsFired,
      isSuccess: rollData.isSuccess,
      successPoints: rollData.successPoints
    });

    const template = "systems/neuroshima/templates/chat/weapon-roll-card.hbs";
    const content = await this._renderTemplate(template, {
      ...rollData,
      config: NEUROSHIMA,
      showTooltip: this._canShowTooltip(actor),
      damageTooltipLabel: this._getDamageTooltip(rollData.damage),
      isGM: game.user.isGM
    });

    game.neuroshima.log("Karta czatu broni utworzona", { messageType: this.TYPES.WEAPON });
    game.neuroshima.groupEnd();

    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: this.TYPES.WEAPON,
          rollData: {
            isWeapon: true,
            isMelee: rollData.isMelee,
            weaponId: rollData.weaponId,
            actorId: actor?.id,
            isOpen: rollData.isOpen,
            results: rollData.results,
            totalPenalty: rollData.totalPenalty,
            penalties: rollData.penalties,
            target: rollData.target,
            skill: rollData.skill,
            skillBonus: rollData.skillBonus,
            attributeBonus: rollData.attributeBonus,
            baseSkill: rollData.baseSkill,
            baseStat: rollData.baseStat,
            isSuccess: rollData.isSuccess,
            successPoints: rollData.successPoints,
            difficultyLabel: rollData.difficultyLabel,
            finalLocation: rollData.finalLocation,
            locationRoll: rollData.locationRoll,
            bulletsFired: rollData.bulletsFired,
            hitBullets: rollData.hitBullets,
            hitBulletsData: rollData.hitBulletsData,
            totalPelletSP: rollData.totalPelletSP,
            isPellet: rollData.isPellet,
            distance: rollData.distance,
            damage: rollData.damage,
            jamming: rollData.isJamming,
            burstLevel: rollData.burstLevel,
            aimingLevel: rollData.aimingLevel,
            label: rollData.label,
            debugMode: rollData.debugMode,
            bulletSequence: rollData.bulletSequence,
            magazineId: rollData.magazineId,
            ammoId: rollData.ammoId
          }
        }
      }
    });
  }

  /**
   * Renderuje raport testów odporności na ból.
   * 
   * @param {Actor} actor - Aktor poddawany testom
   * @param {Array} results - Wyniki testów z CombatHelper.processPainResistance()
   * @param {Array<string>} woundIds - ID ran które zostały dodane
   * @param {number} reducedProjectiles - Liczba zredukowanych pocisków/ran
   * @param {Array} reducedDetails - Szczegółowe dane o redukcji dla każdego zredukowanego pocisku
   * @returns {Promise<ChatMessage>}
   */
  static async renderPainResistance(actor, results, woundIds, reducedProjectiles = 0, reducedDetails = []) {
    game.neuroshima.group("NeuroshimaChatMessage | renderPainResistance");
    game.neuroshima.log("Renderowanie raportu odporności na ból", {
      actor: actor?.name,
      totalTests: results.length,
      woundCount: woundIds.length,
      reducedCount: reducedProjectiles,
      reducedDetailsCount: reducedDetails.length
    });

    const template = "systems/neuroshima/templates/chat/pain-resistance-report.hbs";
    const passedCount = results.filter(r => r.isPassed).length;
    const failedCount = results.length - passedCount;
    
    // Build reduction details with HTML tooltips
    const reducedDetailsWithTooltip = reducedDetails.map(detail => {
      const armorSummary = detail.armorDetails.map(a => 
        `${a.name}: ${a.ratings} - ${a.damage} = ${a.effective} AP`
      ).join("<br>");
      
      const fullWoundName = game.i18n.localize(NEUROSHIMA.woundConfiguration[detail.originalDamage]?.fullLabel || "NEUROSHIMA.Items.Type.Wound");
      
      const tooltip = `
        <div class="neuroshima reduction-tooltip">
          <div style="margin-bottom: 8px;">
            <strong>${fullWoundName}</strong>
            (${game.i18n.localize(`NEUROSHIMA.Location.${detail.location.charAt(0).toUpperCase() + detail.location.slice(1)}`)})
          </div>
          <hr class="dotted-hr tiny" style="margin: 6px 0;">
          <div style="margin-bottom: 6px;">
            <strong>Pancerz:</strong><br>${armorSummary || "Brak"}
          </div>
          <div style="margin-bottom: 6px;">
            <strong>Przebicie:</strong> ${detail.piercing} PP
          </div>
          <div style="margin-bottom: 6px;">
            <strong>Całkowity AP:</strong> ${detail.totalArmor} - ${detail.piercing} = ${detail.reduction}
          </div>
          <div style="color: #888; font-size: 0.9em;">
            ${detail.originalDamage} [${detail.baseDamagePoints}] - ${detail.reduction} = Zredukowane
          </div>
        </div>
      `.trim();
      
      return { ...detail, tooltip, fullName: fullWoundName };
    });
    
    game.neuroshima.log("Podsumowanie testów", {
      passed: passedCount,
      failed: failedCount,
      total: results.length
    });

    // Przygotuj wyniki z tooltipami (miniaturowa wersja rzutu)
    const resultsWithTooltips = results.map(r => {
      let diceHtml = '<div class="dice-results-grid tiny">';
      r.modifiedResults.forEach((d, i) => {
        diceHtml += `
          <div class="die-result ${d.ignored ? 'ignored' : ''}">
            <span class="die-label tiny">D${i + 1}=</span>
            <div class="die-square-container tiny">
              <span class="die-square original tiny ${d.isNat1 ? 'nat-1' : ''} ${d.isNat20 ? 'nat-20' : ''}">${d.original}</span>
              ${r.skill > 0 && !d.ignored ? `
                <i class="fas fa-long-arrow-alt-right"></i> 
                <span class="die-square modified tiny ${d.isSuccess ? 'success' : 'failure'}">${d.modified}</span>
              ` : ''}
            </div>
          </div>`;
      });
      diceHtml += '</div>';

      const tooltip = `
        <div class="neuroshima roll-card tooltip-mode">
          <header class="roll-header tiny">
            ${game.i18n.localize(r.difficulty)}
          </header>
          <hr class="dotted-hr tiny">
          ${diceHtml}
          <hr class="dotted-hr tiny">
          <footer class="roll-outcome tiny">
            <div class="outcome-item">
              <span class="label">${game.i18n.localize('NEUROSHIMA.Roll.Target')}:</span>
              <span class="value">${r.target}</span>
            </div>
            <div class="outcome-item">
              <span class="label">${game.i18n.localize('NEUROSHIMA.Roll.SuccessPointsAbbr')}:</span>
              <span class="value"><strong>${r.successPoints}</strong></span>
            </div>
          </footer>
        </div>
      `.trim();

      return { ...r, tooltip };
    });

    const content = await this._renderTemplate(template, {
      actorId: actor.id,
      actorUuid: actor.uuid,
      actorName: actor.name,
      woundIds: woundIds,
      results: resultsWithTooltips,
      passedCount: passedCount,
      failedCount: failedCount,
      reducedCount: reducedProjectiles,
      reducedDetails: reducedDetailsWithTooltip,
      isGM: game.user.isGM,
      isReversed: false
    });

    game.neuroshima.log("Raport odporności na ból utworzony", { messageType: this.TYPES.PAIN_RESISTANCE });
    game.neuroshima.groupEnd();

    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: this.TYPES.PAIN_RESISTANCE,
          isPainResistanceReport: true,
          actorId: actor.id,
          actorUuid: actor.uuid,
          woundIds: woundIds,
          isReversed: false
        }
      }
    });
  }

  /**
   * Helper: Renderuje szablon Handlebars.
   * @private
   */
  static async _renderTemplate(template, data) {
    try {
      game.neuroshima.log("Renderowanie szablonu", { template });
      const html = await foundry.applications.handlebars.renderTemplate(template, data);
      game.neuroshima.log("Szablon renderowany pomyślnie", { templateLength: html.length });
      return html;
    } catch (error) {
      game.neuroshima.error("Błąd renderowania szablonu", { template, error: error.message });
      throw error;
    }
  }

  /**
   * Helper: Sprawdza czy użytkownik może widzieć tooltip.
   * @private
   */
  static _canShowTooltip(actor) {
    const rollTooltipMinRole = game.settings.get("neuroshima", "rollTooltipMinRole");
    const rollTooltipOwnerVisibility = game.settings.get("neuroshima", "rollTooltipOwnerVisibility");
    
    const canShow = game.user.role >= rollTooltipMinRole || 
                    (rollTooltipOwnerVisibility && (actor?.isOwner || game.user.isGM));
    
    game.neuroshima.log("Sprawdzenie uprawnień tooltip", {
      userRole: game.user.role,
      minRole: rollTooltipMinRole,
      isOwner: actor?.isOwner,
      isGM: game.user.isGM,
      ownerVisibility: rollTooltipOwnerVisibility,
      canShowTooltip: canShow
    });
    
    return canShow;
  }

  /**
   * Helper: Zwraca tooltip dla obrażeń (np. "Draśnięcie / Lekka Rana").
   * @private
   */
  static _getDamageTooltip(damage) {
    if (!damage) return null;
    
    const types = damage.split(",").map(d => d.trim().split("x").pop());
    const uniqueTypes = [...new Set(types)];
    
    const tooltip = uniqueTypes.map(t => {
      const config = NEUROSHIMA.woundConfiguration[t];
      return config ? game.i18n.localize(config.fullLabel) : t;
    }).join(" / ");
    
    game.neuroshima.log("Tooltip obrażeń", {
      damage,
      types: uniqueTypes,
      tooltip
    });
    
    return tooltip;
  }

  /**
   * Zwraca typ wiadomości.
   */
  get messageType() {
    const type = this.getFlag("neuroshima", "messageType");
    game.neuroshima.log("Getter: messageType", { id: this.id, type });
    return type;
  }

  /**
   * Zwraca dane rzutu z flag.
   */
  get rollData() {
    const data = this.getFlag("neuroshima", "rollData") || {};
    game.neuroshima.log("Getter: rollData", { id: this.id, hasData: Object.keys(data).length > 0 });
    return data;
  }

  /**
   * Sprawdza czy to wiadomość o rzucie.
   */
  get isRollMessage() {
    const isRoll = this.rollData?.isWeapon !== undefined;
    game.neuroshima.log("Getter: isRollMessage", { id: this.id, isRoll });
    return isRoll;
  }

  /**
   * Renderuje kartę pacjenta - zestawienie ran aktora dla medyka.
   * 
   * @param {Actor} actor - Aktor pacjenta
   * @returns {Promise<ChatMessage>}
   */
  static async renderPatientCard(actor) {
    game.neuroshima.group("NeuroshimaChatMessage | renderPatientCard");
    game.neuroshima.log("Renderowanie karty pacjenta", { actorName: actor.name });

    // Wygeneruj dane karty (late binding aby uniknąć circular dependency)
    const patientData = game.neuroshima.CombatHelper.generatePatientCard(actor);

    // Renderuj szablon
    const template = "systems/neuroshima/templates/chat/patient-card.hbs";
    const content = await this._renderTemplate(template, {
      ...patientData,
      config: NEUROSHIMA
    });

    game.neuroshima.log("Karta pacjenta utworzona", { messageType: "patientCard" });
    game.neuroshima.groupEnd();

    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "patientCard",
          isPatientCard: true,
          actorId: actor.id
        }
      }
    });
  }

  /**
   * Renderuje kartę pro­śby o leczenie - wyświetlana medykowi do zaakceptowania
   * 
   * @param {Actor} patientActor - Aktor pacjenta
   * @param {string} medicUserId - ID usera medyka
   * @param {string} requesterUserId - ID usera proszącego o leczenie
   * @returns {Promise<ChatMessage>}
   */
  static async renderHealingRequest(patientActor, medicUserId, requesterUserId) {
    game.neuroshima.group("NeuroshimaChatMessage | renderHealingRequest");
    game.neuroshima.log("Renderowanie pro­śby o leczenie", { 
      patientName: patientActor.name,
      medicUserId: medicUserId,
      requesterUserId: requesterUserId
    });

    // Generuj sessionId
    const sessionId = foundry.utils.randomID();
    
    // Wygeneruj dane karty pacjenta
    const patientData = game.neuroshima.CombatHelper.generatePatientCard(patientActor);
    
    // Pobierz dane usera proszącego
    const requesterUser = game.users.get(requesterUserId);
    const requesterName = requesterUser?.name || "Nieznany";

    // Pobierz wersję karty pacjenta
    const patientCardVersion = game.settings.get("neuroshima", "patientCardVersion");

    // Renderuj szablon
    const template = "systems/neuroshima/templates/chat/healing-request.hbs";
    const content = await this._renderTemplate(template, {
      ...patientData,
      sessionId: sessionId,
      patientActorUuid: patientActor.uuid,
      medicUserId: medicUserId,
      requesterUserId: requesterUserId,
      requesterName: requesterName,
      patientCardVersion: patientCardVersion,
      config: NEUROSHIMA
    });

    game.neuroshima.log("Pro­śba o leczenie utworzona", { 
      messageType: "healingRequest",
      sessionId: sessionId
    });
    game.neuroshima.groupEnd();

    // Tworzymy whisper do medyka (i opcjonalnie do pacjenta)
    // Jeśli pacjent to ten sam user co medical, dostaje tylko on
    const whisperTo = [medicUserId];
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: patientActor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      whisper: whisperTo,
      flags: {
        neuroshima: {
          messageType: "healingRequest",
          isHealingRequest: true,
          sessionId: sessionId,
          patientActorUuid: patientActor.uuid,
          patientActorId: patientActor.id,
          medicUserId: medicUserId,
          requesterUserId: requesterUserId
        }
      }
    });
  }

  /**
   * Renderuje kartę rzutu leczenia (Pierwsza Pomoc / Leczenie Ran)
   * 
   * @param {Actor} medicActor - Medyk wykonujący test
   * @param {Object} rollData - Dane z NeuroshimaDice.rollHealingTest()
   * @returns {Promise<ChatMessage>}
   */
  static async renderHealingRoll(medicActor, rollData) {
    game.neuroshima?.group("NeuroshimaChatMessage | renderHealingRoll");
    game.neuroshima?.log("Renderowanie karty rzutu leczenia", {
      medic: medicActor?.name,
      patient: rollData.patientActor?.name,
      method: rollData.healingMethod
    });

    const template = "systems/neuroshima/templates/chat/healing-roll-card.hbs";
    const content = await this._renderTemplate(template, {
      ...rollData,
      config: NEUROSHIMA
    });

    game.neuroshima?.log("Karta czatu leczenia utworzona");
    game.neuroshima?.groupEnd();

    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: medicActor }),
      content,
      rolls: [],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "healingRoll",
          isHealingRoll: true,
          medicActorId: medicActor.id,
          patientActorUuid: rollData.patientActor.uuid,
          healingMethod: rollData.healingMethod,
          rollData: rollData
        }
      }
    });
  }

  /**
   * Renderuje raport batch healing results na wzór pain-resistance
   */
  static async renderHealingBatchResults(medicActor, patientActor, healingMethod, results, successCount, failureCount, rerollData = {}) {
    game.neuroshima?.group("NeuroshimaChatMessage | renderHealingBatchResults");
    game.neuroshima?.log("Renderowanie batch raportu leczenia", {
      medic: medicActor?.name,
      patient: patientActor?.name,
      totalWounds: results.length,
      successes: successCount,
      failures: failureCount
    });

    const template = "systems/neuroshima/templates/chat/healing-roll-card.hbs";

    // Build tooltips for each result
    const resultsWithTooltips = results.map(r => {
      // Build dice results HTML
      let diceHtml = '<div class="dice-results-grid tiny">';
      r.modifiedResults.forEach((d, i) => {
        diceHtml += `
          <div class="die-result ${d.ignored ? 'ignored' : ''}">
            <span class="die-label tiny">D${i + 1}=</span>
            <div class="die-square-container tiny">
              <span class="die-square original tiny ${d.isNat1 ? 'nat-1' : ''} ${d.isNat20 ? 'nat-20' : ''}">${d.original}</span>
              ${r.skill > 0 && !d.ignored ? `
                <i class="fas fa-long-arrow-alt-right"></i> 
                <span class="die-square modified tiny ${d.isSuccess ? 'success' : 'failure'}">${d.modified}</span>
              ` : ''}
            </div>
          </div>`;
      });
      diceHtml += '</div>';

      const tooltip = `
        <div class="neuroshima roll-card tooltip-mode">
          <header class="roll-header tiny">
            ${game.i18n.localize(r.difficultyLabel)}
            ${game.i18n.localize("NEUROSHIMA.Roll.ClosedTest")}
            ${game.i18n.localize("NEUROSHIMA.Roll.On")}
            ${healingMethod === "firstAid" ? game.i18n.localize("NEUROSHIMA.Skills.firstAid") : game.i18n.localize("NEUROSHIMA.Skills.woundTreatment")}
          </header>
          <hr class="dotted-hr tiny">
          ${diceHtml}
          <hr class="dotted-hr tiny">
          <footer class="roll-outcome tiny">
            <div class="outcome-item">
              <span class="label">${game.i18n.localize('NEUROSHIMA.Attributes.Attributes')}:</span>
              <span class="value">${r.baseStat || 0}</span>
            </div>
            <div class="outcome-item">
              <span class="label">Umiejętność:</span>
              <span class="value">${r.skill || 0}</span>
            </div>
            <div class="outcome-item">
              <span class="label">${game.i18n.localize('NEUROSHIMA.Roll.Target')}:</span>
              <span class="value">${r.testTarget}</span>
            </div>
            <div class="outcome-item">
              <span class="label">${game.i18n.localize('NEUROSHIMA.Roll.SuccessPointsAbbr')}:</span>
              <span class="value"><strong>${r.successCount}</strong></span>
            </div>
          </footer>
        </div>
      `.trim();

      return { ...r, tooltip };
    });

    const content = await this._renderTemplate(template, {
      actorId: patientActor.id,
      actorUuid: patientActor.uuid,
      patientActor: patientActor,
      results: resultsWithTooltips,
      successCount: successCount,
      failureCount: failureCount,
      isGM: game.user.isGM
    });

    game.neuroshima?.log("Batch healing raport utworzony");
    game.neuroshima?.groupEnd();

    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: medicActor }),
      content,
      rolls: [],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "healingBatchResults",
          isHealingBatchResults: true,
          medicActorId: medicActor.id,
          patientActorUuid: patientActor.uuid,
          healingMethod: healingMethod,
          successCount: successCount,
          failureCount: failureCount,
          rerollData: rerollData,
          results: results
        }
      }
    });
  }

  /**
   * Sprawdza czy to raport odporności na ból.
   */
  get isPainResistanceReport() {
    const isPain = this.getFlag("neuroshima", "isPainResistanceReport") === true;
    game.neuroshima.log("Getter: isPainResistanceReport", { id: this.id, isPain });
    return isPain;
  }

  /**
   * Centralny dispatcher akcji dla kart czatu.
   * Rejestruje jeden listener na kontenerze HTML wiadomości.
   */
  static onChatAction(html) {
    html.addEventListener("click", async (event) => {
      const actionBtn = event.target.closest("[data-action]");
      if (!actionBtn) return;
      
      event.preventDefault();
      const action = actionBtn.dataset.action;
      const messageId = html.closest(".chat-message")?.dataset.messageId;
      const message = game.messages.get(messageId);
      
      if (!message) return;

      game.neuroshima.log("ChatMessage Action Dispatcher", { action, messageId });
      
      switch (action) {
        case "melee-defend":
          await this.onMeleeDefend(event, message);
          break;
        case "clickOpposedResponse":
          await this.onClickOpposedResponse(event, message);
          break;
        case "resolveOpposed":
          await this.resolveOpposed(event, message);
          break;
        case "applyDamage":
          await this.onApplyOpposedDamage(event, message);
          break;
      }
    });
  }

  /**
   * Obsługa kliknięcia przycisku "Obrona"
   */
  static async onMeleeDefend(event, message) {
    const flags = message.getFlag('neuroshima', 'rollData');
    if (!flags?.isMelee) {
      ui.notifications.error(game.i18n.localize('NEUROSHIMA.Errors.NotMeleeAttack'));
      return;
    }

    // Znajdź aktora, który może się bronić
    const defender = this._findDefenderActor(flags.targets);
    if (!defender) {
      ui.notifications.warn(game.i18n.localize('NEUROSHIMA.Warnings.CannotDefend'));
      return;
    }

    // Sprawdź, czy już był rzut obronny
    if (flags.opposedResult) {
      const confirm = await foundry.applications.api.DialogV2.confirm({
        window: {
          title: game.i18n.localize('NEUROSHIMA.Dialog.DefenseExists')
        },
        content: game.i18n.localize('NEUROSHIMA.Dialog.DefenseExistsContent'),
        rejectClose: false,
        modal: true
      });
      if (!confirm) return;
    }

    // Otwórz dialog wyboru typu obrony
    const { NeuroshimaMeleeDefenseDialog } = await import('../dialogs/melee-defense-dialog.js');
    await NeuroshimaMeleeDefenseDialog.show(defender, message);
  }

  /**
   * Znajduje aktora, który może się bronić
   * @param {Array<string>} targetIds - lista actorId z ataku
   * @returns {Actor|null}
   */
  static _findDefenderActor(targetIds) {
    if (!targetIds?.length) return null;

    // 1. Priorytet: Aktualnie namierzone tokeny (User Targets) - najsilniejszy wskaźnik intencji
    const userTargets = Array.from(game.user.targets);
    for (const token of userTargets) {
      if (token.actor && targetIds.includes(token.actor.id)) {
        return token.actor;
      }
    }

    // 2. Kontrolowane / Zaznaczone tokeny (Controlled Tokens)
    const controlled = canvas.tokens?.controlled ?? [];
    for (const token of controlled) {
      if (token.actor && targetIds.includes(token.actor.id)) {
        return token.actor;
      }
    }

    // 3. Postać przypisana do użytkownika (Assigned Character)
    const userActor = game.user.character;
    if (userActor && targetIds.includes(userActor.id)) {
      return userActor;
    }

    // 4. Logika dla GM - jeśli nic nie jest zaznaczone, ale kliknięto przycisk
    if (game.user.isGM) {
      // Pobierz pierwszego aktora z listy targetów, który istnieje w świecie
      const firstTarget = game.actors.get(targetIds[0]);
      if (firstTarget) return firstTarget;
    }

    // 5. Fallback: Jeśli użytkownik ma uprawnienia właściciela do któregoś z targetów
    // (Ważne dla graczy kontrolujących wielu aktorów bez przypisanej postaci głównej)
    for (const id of targetIds) {
      const actor = game.actors.get(id);
      if (actor?.isOwner) return actor;
    }

    return null;
  }

  /**
   * Rozstrzyga pojedynek melee (atak vs obrona)
   */
  static async resolveOpposedMelee(attackMessage, defenseMessage) {
    const attackFlags = attackMessage.getFlag('neuroshima', 'rollData');
    const defenseFlags = defenseMessage.getFlag('neuroshima', 'rollData');

    if (!attackFlags || !defenseFlags) {
      console.error('Neuroshima | Missing roll data for opposed test');
      return;
    }

    // Import klasy opposed
    const { NeuroshimaMeleeOpposed } = await import('../helpers/melee-opposed.js');

    // Oblicz wynik pojedynku
    const opposedOptions = {
      mode: game.settings.get("neuroshima", "opposedMeleeMode"),
      tier2At: game.settings.get("neuroshima", "opposedMeleeTier2At"),
      tier3At: game.settings.get("neuroshima", "opposedMeleeTier3At")
    };
    const opposed = NeuroshimaMeleeOpposed.compute(attackFlags, defenseFlags, opposedOptions);

    // Pobierz aktorów
    const attacker = game.actors.get(attackFlags.actorId);
    const defender = game.actors.get(defenseFlags.actorId);

    if (!attacker || !defender) {
      console.error('Neuroshima | Cannot find attacker or defender actors');
      return;
    }

    // Wygeneruj HTML wyniku
    const opposedHTML = NeuroshimaMeleeOpposed.renderOpposedResult(
      opposed,
      attacker,
      defender
    );

    // Zaktualizuj obie wiadomości
    const attackUpdate = foundry.utils.mergeObject(
      foundry.utils.deepClone(attackFlags),
      {
        opposedResult: opposed,
        opposedResultHTML: opposedHTML,
        opposedDefenseId: defenseMessage.id
      }
    );

    const defenseUpdate = foundry.utils.mergeObject(
      foundry.utils.deepClone(defenseFlags),
      {
        opposedResult: opposed,
        opposedResultHTML: opposedHTML,
        opposedAttackId: attackMessage.id
      }
    );

    await attackMessage.setFlag('neuroshima', 'rollData', attackUpdate);
    await defenseMessage.setFlag('neuroshima', 'rollData', defenseUpdate);

    // Wyświetl wynik w chacie jako nowa wiadomość
    await ChatMessage.create({
      content: opposedHTML,
      speaker: ChatMessage.getSpeaker({ actor: defender }),
      flags: {
        neuroshima: {
          opposedResult: opposed,
          attackMessageId: attackMessage.id,
          defenseMessageId: defenseMessage.id
        }
      }
    });

    // Jeśli atakujący wygrał - zastosuj obrażenia
    if (opposed.winner === 'attacker') {
      await this._applyOpposedDamage(attackMessage, defender, opposed);
    }
  }

  /**
   * Stosuje obrażenia z testu przeciwstawnego
   * @private
   */
  static async _applyOpposedDamage(attackMessage, defender, opposed) {
    const { CombatHelper } = await import('../helpers/combat-helper.js');
    
    // Przewaga SP atakującego
    const spDiff = opposed.spDifference;
    
    // Pobierz dane ataku
    const attackData = attackMessage.getFlag('neuroshima', 'rollData');
    
    // Przygotuj opcje dla applyDamage
    const options = {
        attackerMessageId: attackMessage.id,
        spDifference: spDiff,
        isOpposed: true
    };

    // Zastosuj obrażenia
    await CombatHelper.applyDamageToActor(defender, attackData, options);
  }
}
