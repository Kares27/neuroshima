import { NEUROSHIMA } from "../config.js";
import { buildRef, resolveRef } from "../helpers/refs.js";

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
    
    // Pobierz tokeny jeśli to możliwe
    const attackerToken = canvas.tokens.get(attackMessage.speaker.token);
    const defenderToken = canvas.tokens.placeables.find(t => t.actor?.id === defender.id && t.targeted.has(game.user)) 
                         || canvas.tokens.placeables.find(t => t.actor?.id === defender.id);

    // Buduj referencje (refs.js)
    const attackerRef = buildRef({ token: attackerToken, actor: attacker });
    const defenderRef = buildRef({ token: defenderToken, actor: defender });

    game.neuroshima.group("NeuroshimaChatMessage | createOpposedHandler");
    game.neuroshima.log("Tworzenie handlera testu przeciwstawnego (Refs Mode)", {
      requestId,
      attackerRef,
      defenderRef,
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

    // Dziedzicz widoczność z ataku, ale zapewnij, że obrońca widzi handler
    let whisper = attackMessage.whisper || [];
    if (whisper.length > 0) {
        const defenderUsers = game.users.filter(u => defender.testUserPermission(u, "OWNER")).map(u => u.id);
        whisper = Array.from(new Set([...whisper, ...defenderUsers]));
    }

    const handlerMessage = await this.create({
      user: game.user.id,
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      whisper: whisper,
      blind: attackMessage.blind,
      flags: {
        neuroshima: {
          messageType: "opposedHandler",
          opposedData: {
            requestId,
            status: "waiting",
            attackerRef,
            defenderRef,
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

    // Resolve defender from ref
    const { actor: defender } = await resolveRef(opposedData.defenderRef || { kind: "actor", uuid: `Actor.${opposedData.defenderId}` });
    
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
    console.log("Neuroshima | resolveOpposed started", { 
        messageId: message.id, 
        options,
        byHook: !!options.defenseMessageId 
    });

    const opposedData = message.getFlag("neuroshima", "opposedData");
    if (!opposedData) {
        console.warn("Neuroshima | resolveOpposed - No opposedData found on message");
        return;
    }
    
    if (opposedData.status === "resolved" || opposedData.isProcessing) {
        console.log("Neuroshima | resolveOpposed - Already resolved or processing");
        return;
    }
    
    // Status musi być 'ready' dla kliknięć, ale dla auto-resolve pozwalamy jeśli mamy defenseMessageId
    const defenseMessageId = options.defenseMessageId || opposedData.defenseMessageId;
    
    // Ustawienie flagi przetwarzania aby uniknąć race condition
    await message.setFlag("neuroshima", "opposedData.isProcessing", true);

    console.log("Neuroshima | resolveOpposed state:", {
        status: opposedData.status,
        defenseMessageId,
        alreadyResolved: opposedData.status === "resolved"
    });

    // Sprawdź uprawnienia do aktualizacji wiadomości handlera
    if (!message.isOwner && !game.user.isGM) {
        console.log("Neuroshima | resolveOpposed - No permission to update handler, emitting socket", {
            handlerId: message.id,
            defenseId: defenseMessageId
        });
        await message.setFlag("neuroshima", "opposedData.isProcessing", false);
        game.socket.emit("system.neuroshima", {
            type: "opposed.resolve",
            handlerMessageId: message.id,
            defenseMessageId: defenseMessageId
        });
        return;
    }

    if (opposedData.status !== "ready" && !options.defenseMessageId) {
        console.log("Neuroshima | resolveOpposed - Not ready and no defenseMessageId provided");
        await message.setFlag("neuroshima", "opposedData.isProcessing", false);
        return;
    }

    const attackMessage = game.messages.get(opposedData.attackMessageId);
    const defenseMessage = game.messages.get(defenseMessageId);

    if (!attackMessage || !defenseMessage) {
        console.error("Neuroshima | resolveOpposed - Missing messages:", { 
            attackMessage: !!attackMessage, 
            defenseMessage: !!defenseMessage 
        });
        await message.setFlag("neuroshima", "opposedData.isProcessing", false);
        if (!options.defenseMessageId) {
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.Errors.MissingOpposedMessages"));
        }
        return;
    }

    console.log("Neuroshima | resolveOpposed - Messages found, starting computation...");

    try {
        // Importy
        const { NeuroshimaMeleeOpposed } = await import('../helpers/melee-opposed.js');

        // Oblicz wynik
        const attackFlags = attackMessage.getFlag("neuroshima", "rollData");
        const defenseFlags = defenseMessage.getFlag("neuroshima", "rollData");
        
        const opposedOptions = {
          mode: opposedData.mode
        };
        
        console.log("Neuroshima | resolveOpposed - Computing results...");
        const result = NeuroshimaMeleeOpposed.compute(attackFlags, defenseFlags, opposedOptions);
        
        // Automatyczne przypisanie konkretnych obrażeń z broni na podstawie spDifference
        if (result.winner === 'attacker' && result.spDifference > 0) {
            const damageKey = `damageMelee${result.spDifference}`;
            result.finalDamageValue = attackFlags[damageKey] || attackFlags.damage || "D";
            game.neuroshima.log("Przypisano obrażenia z poziomu (Tier):", { 
                spDifference: result.spDifference, 
                damage: result.finalDamageValue 
            });
        }

        console.log("Neuroshima | resolveOpposed - Result computed:", result);
        
        // Pobierz aktorów do renderowania
        const { actor: attacker } = await resolveRef(opposedData.attackerRef || { kind: "actor", uuid: `Actor.${opposedData.attackerId}` });
        const { actor: defender } = await resolveRef(opposedData.defenderRef || { kind: "actor", uuid: `Actor.${opposedData.defenderId}` });

        if (!defender) {
            console.error("Neuroshima | resolveOpposed - Defender not found after resolveRef");
            return;
        }

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

        console.log("Neuroshima | resolveOpposed - Creating result message...");
        const resultMessage = await NeuroshimaChatMessage.create({
          user: game.user.id,
          content,
          style: CONST.CHAT_MESSAGE_STYLES.OTHER,
          whisper: attackMessage.whisper,
          blind: attackMessage.blind,
          flags: {
            neuroshima: {
              messageType: "opposedResult",
              opposedResult: result,
              requestId: opposedData.requestId,
              attackMessageId: attackMessage.id,
              defenseMessageId: defenseMessage.id,
              defenderRef: opposedData.defenderRef || buildRef({ actor: defender })
            }
          }
        });

        console.log("Neuroshima | resolveOpposed - Updating handler status to resolved...");
        // Zaktualizuj handler i zresetuj flagę przetwarzania
        const currentData = message.getFlag("neuroshima", "opposedData");
        const updatedOpposedData = foundry.utils.mergeObject(currentData, {
          status: "resolved",
          isProcessing: false,
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

        console.log("Neuroshima | resolveOpposed - Clearing pending flag...");
        // Wyczyść flagę pending na obrońcy
        await this.clearOpposedPendingFlag(defender, opposedData.requestId);
        console.log("Neuroshima | resolveOpposed - DONE");
    } catch (err) {
        console.error("Neuroshima | Error in resolveOpposed:", err);
        await message.setFlag("neuroshima", "opposedData.isProcessing", false);
    }
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

    // Use provided rollMode or default
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
            isWeapon: false,
            actorId: actor?.id,
            isOpen: rollData.isOpen,
            results: rollData.rawResults,
            rawResults: rollData.rawResults,
            totalPenalty: rollData.totalPenalty,
            penalties: rollData.penalties,
            penalty: rollData.penalty,
            target: rollData.target,
            skill: rollData.skill,
            skillBonus: rollData.skillBonus,
            attributeBonus: rollData.attributeBonus,
            baseSkill: rollData.baseSkill,
            baseStat: rollData.baseStat,
            baseDifficulty: rollData.baseDifficulty,
            isSuccess: rollData.isSuccess,
            successPoints: rollData.successPoints,
            successCount: rollData.successCount,
            modifiedResults: rollData.modifiedResults,
            difficultyLabel: rollData.difficultyLabel,
            baseDifficultyLabel: rollData.baseDifficultyLabel,
            label: rollData.label,
            isReroll: rollData.isReroll,
            isDebug: rollData.isDebug,
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
    
    // Przygotuj listę lokacji dla dropdowna
    const hitLocations = Object.entries(NEUROSHIMA.bodyLocations).map(([key, data]) => ({
        key: key,
        label: data.label
    }));

    const content = await this._renderTemplate(template, {
      ...rollData,
      hitLocations,
      config: NEUROSHIMA,
      showTooltip: this._canShowTooltip(actor),
      damageTooltipLabel: this._getDamageTooltip(rollData.damage),
      isGM: game.user.isGM,
      opposedMode: game.settings.get("neuroshima", "opposedMeleeMode")
    });

    game.neuroshima.log("Karta czatu broni utworzona", { messageType: this.TYPES.WEAPON });
    game.neuroshima.groupEnd();

    // Use provided rollMode or default
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
            successCount: rollData.successCount,
            modifiedResults: rollData.modifiedResults,
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
            ammoId: rollData.ammoId,
            hitLocation: rollData.hitLocation,
            modifier: rollData.modifier,
            aimingLevel: rollData.aimingLevel,
            burstLevel: rollData.burstLevel,
            distance: rollData.distance,
            meleeAction: rollData.meleeAction,
            applyArmor: rollData.applyArmor,
            applyWounds: rollData.applyWounds,
            isReroll: rollData.isReroll,
            rollMode: rollMode
          }
        }
      }
    };

    ChatMessage.applyRollMode(chatData, rollMode);
    return this.create(chatData);
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
            ${game.i18n.localize(r.baseDifficulty)} 
            ${r.totalShift !== 0 ? `(${r.totalShift > 0 ? '+' : ''}${r.totalShift} Suwak)` : ''}
            <i class="fas fa-long-arrow-alt-right"></i>
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

    const rollMode = game.settings.get("core", "rollMode");
    const chatData = {
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
    };

    ChatMessage.applyRollMode(chatData, rollMode);
    return this.create(chatData);
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
   * @param {Actor|TokenDocument} patient - Cel leczenia
   * @returns {Promise<ChatMessage>}
   */
  static async renderPatientCard(patient) {
    game.neuroshima.group("NeuroshimaChatMessage | renderPatientCard");
    
    // Rozwiąż pacjenta do aktora
    const actor = patient instanceof Actor ? patient : patient.actor;
    game.neuroshima.log("Renderowanie karty pacjenta", { actorName: actor?.name });

    // Buduj referencję
    const patientRef = buildRef({ 
        token: patient instanceof TokenDocument ? patient : (patient.token || null),
        actor: actor 
    });

    // Wygeneruj dane karty
    const patientData = game.neuroshima.CombatHelper.generatePatientCard(actor);

    // Renderuj szablon
    const template = "systems/neuroshima/templates/chat/patient-card.hbs";
    const content = await this._renderTemplate(template, {
      ...patientData,
      patientRef,
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
          patientRef
        }
      }
    });
  }

  /**
   * Renderuje kartę prośby o leczenie - wyświetlana medykowi do zaakceptowania
   * 
   * @param {Actor|TokenDocument} patient - Cel leczenia
   * @param {Actor} medicActor - Wybrany aktor medyka
   * @param {string} requesterUserId - ID usera proszącego o leczenie
   * @returns {Promise<ChatMessage>}
   */
  static async renderHealingRequest(patient, medicActor, requesterUserId) {
    game.neuroshima.group("NeuroshimaChatMessage | renderHealingRequest");
    
    // Rozwiąż pacjenta do aktora
    const patientActor = patient instanceof Actor ? patient : patient.actor;
    
    game.neuroshima.log("Renderowanie prośby o leczenie", { 
      patientName: patientActor?.name,
      medicName: medicActor?.name,
      requesterUserId: requesterUserId
    });

    // Buduj referencje
    const patientRef = buildRef({ 
        token: patient instanceof TokenDocument ? patient : (patient.token || null),
        actor: patientActor 
    });
    const medicRef = buildRef({ actor: medicActor });

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
    console.log("Neuroshima | Tworzenie prośby o leczenie", {
      patientName: patientActor.name,
      patientRef,
      medicRef
    });

    const content = await this._renderTemplate(template, {
      ...patientData,
      sessionId: sessionId,
      patientRef,
      medicRef,
      requesterUserId: requesterUserId,
      requesterName: requesterName,
      patientCardVersion: patientCardVersion,
      config: NEUROSHIMA
    });

    game.neuroshima.log("Prośba o leczenie utworzona", { 
      messageType: "healingRequest",
      sessionId: sessionId
    });
    game.neuroshima.groupEnd();

    // Tworzymy whisper do medyka (użytkownicy, których PC to ten aktor, lub GMy jeśli chcemy by widzieli)
    // Priorytet: userzy którzy mają tę postać jako PC
    let whisperTo = game.users.filter(u => u.character?.uuid === medicRef.uuid).map(u => u.id);
    
    // Fallback: jeśli nikt nie ma tej postaci jako PC, whisperuj do wszystkich ownerów (w tym GMów)
    if (whisperTo.length === 0) {
        whisperTo = game.users.filter(u => medicActor.testUserPermission(u, "OWNER")).map(u => u.id);
    }
    
    // Dodaj GMa do whispera zawsze, aby mógł nadzorować
    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
    whisperTo = [...new Set([...whisperTo, ...gmIds])];
    
    // Dodaj proszącego do whispera, aby widział status swojej prośby
    if (!whisperTo.includes(requesterUserId)) {
        whisperTo.push(requesterUserId);
    }
    
    game.neuroshima.log("Tworzenie wiadomości prośby o leczenie z flagami", {
      sessionId: sessionId,
      patientRef,
      medicRef,
      requesterUserId
    });

    const messageData = {
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
          patientRef,
          medicRef,
          requesterUserId: requesterUserId
        }
      }
    };

    return this.create(messageData);
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

    const patientRef = buildRef({ 
        token: rollData.patientActor.token || null,
        actor: rollData.patientActor 
    });
    const medicRef = buildRef({ actor: medicActor });

    const template = "systems/neuroshima/templates/chat/healing-roll-card.hbs";
    const content = await this._renderTemplate(template, {
      ...rollData,
      patientRef,
      medicRef,
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
          sessionId: foundry.utils.randomID(),
          medicRef,
          patientRef,
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

    const patientRef = buildRef({ 
        token: patientActor.token || null,
        actor: patientActor 
    });
    const medicRef = buildRef({ actor: medicActor });

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
      patientRef,
      medicRef,
      patientActor: patientActor,
      results: resultsWithTooltips,
      successCount: successCount,
      failureCount: failureCount,
      isGM: game.user.isGM
    });

    game.neuroshima?.log("Batch healing raport utworzony", {
      medicRef,
      patientRef,
      resultsCount: results?.length,
      healingMethod
    });
    game.neuroshima?.groupEnd();

    const sessionId = foundry.utils.randomID();
    const messageData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: medicActor }),
      content,
      rolls: [],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "healingBatchResults",
          isHealingBatchResults: true,
          sessionId: sessionId,
          medicRef,
          patientRef,
          healingMethod: healingMethod,
          successCount: successCount,
          failureCount: failureCount,
          rerollData: rerollData,
          results: results
        }
      }
    };

    game.neuroshima?.log("NeuroshimaChatMessage | Creating message with data:", messageData);

    const message = await ChatMessage.create(messageData);
    
    // Dodatkowe zabezpieczenie: wymuszenie zapisu flag jeśli nie weszły w create
    if (!message.getFlag("neuroshima", "results")) {
        game.neuroshima?.log("NeuroshimaChatMessage | Flags missing after create, forcing update...");
        await message.setFlag("neuroshima", {
            messageType: "healingBatchResults",
            isHealingBatchResults: true,
            sessionId: sessionId,
            medicRef,
            patientRef,
            healingMethod: healingMethod,
            successCount: successCount,
            failureCount: failureCount,
            rerollData: rerollData,
            results: results
        });
    }

    return message;
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
        case "openHealPanel":
          await this.onOpenHealPanel(event, message);
          break;
        case "apply-healing":
        case "applyHealing":
          await this.onApplyHealing(event, message);
          break;
        case "reroll-healing":
        case "rerollHealing":
          await this.onRerollHealing(event, message);
          break;
        case "selectOpposedLocation":
          await this.onSelectOpposedLocation(event, message);
          break;
      }
    });

    // Dodaj obsługę zmiany w dropdownach lokacji
    html.addEventListener("change", async (event) => {
      const actionBtn = event.target.closest("[data-action]");
      if (!actionBtn) return;
      
      const action = actionBtn.dataset.action;
      const messageId = html.closest(".chat-message")?.dataset.messageId;
      const message = game.messages.get(messageId);
      
      if (!message) return;

      if (action === "selectOpposedLocation") {
        await this.onSelectOpposedLocation(event, message);
      }
    });
  }

  /**
   * Obsługa aplikacji leczenia z karty raportu.
   */
  static async onApplyHealing(event, message) {
    // Agresywne pobieranie flag (getFlag lub bezpośredni dostęp)
    const neuroFlags = message.getFlag("neuroshima") || message.flags?.neuroshima || {};
    const medicRef = neuroFlags.medicRef;
    const patientRef = neuroFlags.patientRef;
    const results = neuroFlags.results;

    game.neuroshima.log("onApplyHealing | Debug Flags", {
        messageId: message.id,
        neuroFlags: neuroFlags,
        hasResults: !!results,
        isResultsArray: Array.isArray(results)
    });
    
    const healingMethod = neuroFlags.healingMethod || "woundTreatment";
    const rerollData = neuroFlags.rerollData || {};
    
    if (!medicRef || !patientRef || !results || !Array.isArray(results)) {
        ui.notifications.error("Brak wymaganych danych do aplikacji leczenia");
        return;
    }

    // Zapobieganie podwójnej aplikacji leczenia
    if (message.getFlag("neuroshima", "healingApplied")) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.HealingAlreadyApplied"));
        return;
    }

    // Rozwiąż referencje
    const { actor: medicActor } = await game.neuroshima.resolveRef(medicRef);
    const { actor: patientActor } = await game.neuroshima.resolveRef(patientRef);

    if (!medicActor || !patientActor) {
        ui.notifications.error("Nie można znaleźć wymaganych aktorów do aplikacji leczenia");
        return;
    }

    // Sprawdzenie uprawnień (medyk lub GM)
    if (!medicActor.isOwner && !game.user.isGM) {
        ui.notifications.warn("Tylko medyk lub GM może aplikować leczenie");
        return;
    }

    game.neuroshima?.group("NeuroshimaChatMessage | onApplyHealing");
    
    try {
        const woundConfigs = rerollData.woundConfigs || [];
        const woundModifierMap = {};
        woundConfigs.forEach(config => {
            woundModifierMap[config.woundId] = config.healingModifier || 0;
        });

        const applicationResults = [];
        for (const result of results) {
            const healingModifier = woundModifierMap[result.woundId] || 0;
            
            // Aplikuj leczenie tej rany
            const healingResults = await game.neuroshima.HealingApp.applyHealingToWounds(
                patientActor,
                [result.woundId],
                result.successCount,
                healingMethod,
                result.healingEffect?.hadFirstAid || false,
                healingModifier
            );

            applicationResults.push({
                woundId: result.woundId,
                woundName: result.woundName,
                healingResults: healingResults
            });
        }

        // Oznacz wiadomość jako "leczenie zaaplikowane"
        await message.setFlag("neuroshima", "healingApplied", true);
        
        // Zaktualizuj przycisk w HTML jeśli istnieje
        const button = event.target.closest("button");
        if (button) {
            button.disabled = true;
            button.innerHTML = `✓ ${game.i18n.localize("NEUROSHIMA.HealingRequest.ApplyHealing")}`;
            button.classList.add("applied");
        }

        ui.notifications.info(game.i18n.localize("NEUROSHIMA.HealingRequest.HealingApplied"));
    } catch (error) {
        game.neuroshima?.error("Błąd podczas aplikacji leczenia", error);
        ui.notifications.error("Błąd podczas aplikacji leczenia: " + error.message);
    } finally {
        game.neuroshima?.groupEnd();
    }
  }

  /**
   * Obsługa przerzutu leczenia konkretnej rany.
   */
  static async onRerollHealing(event, message) {
    const flags = message.getFlag("neuroshima") || {};
    const rerollData = flags.rerollData;
    const results = flags.results;
    const healingMethod = flags.healingMethod;
    const medicRef = flags.medicRef;
    const patientRef = flags.patientRef;
    const woundId = event.target.closest("[data-wound-id]")?.dataset.woundId;

    if (!rerollData || !results || !healingMethod || !medicRef || !patientRef || !woundId) {
        ui.notifications.error("Brak danych do przerzutu");
        return;
    }

    // Zapobieganie przerzutom po aplikacji
    if (message.getFlag("neuroshima", "healingApplied")) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.HealingAlreadyApplied"));
        return;
    }

    // Rozwiąż referencje
    const { actor: medicActor } = await game.neuroshima.resolveRef(medicRef);
    const { actor: patientActor } = await game.neuroshima.resolveRef(patientRef);

    if (!medicActor || !patientActor) {
        ui.notifications.error("Nie można znaleźć wymaganych aktorów do przerzutu");
        return;
    }

    // Sprawdzenie uprawnień (medyk lub GM)
    if (!medicActor.isOwner && !game.user.isGM) {
        ui.notifications.warn("Tylko medyk lub GM może przerzucać testy");
        return;
    }

    // Dialog potwierdzenia
    const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: {
            title: game.i18n.localize("NEUROSHIMA.Dialogs.ConfirmReroll"),
            icon: "fas fa-exclamation-triangle"
        },
        content: `<p style="padding: 10px;">${game.i18n.localize("NEUROSHIMA.Dialogs.RerollWoundQuestion")}</p>`,
        rejectClose: false,
        modal: true
    });

    if (!confirmed) return;

    game.neuroshima?.group("NeuroshimaChatMessage | onRerollHealing");
    
    try {
        // Znajdź konfigurację dla konkretnej rany
        const woundConfig = rerollData.woundConfigs.find(w => w.woundId === woundId);
        if (!woundConfig) {
            ui.notifications.error("Nie można znaleźć konfiguracji rany");
            return;
        }

        // Przerzuć test
        const rerollResult = await game.neuroshima.NeuroshimaDice.rerollHealingTest(
            medicActor,
            patientActor,
            healingMethod,
            woundConfig,
            rerollData.stat,
            rerollData.skillBonus,
            rerollData.attributeBonus
        );

        // Aktualizuj wynik w UI (wyszukaj wiersz rany i zmień status)
        const woundItem = event.target.closest(".wound-item");
        if (woundItem && rerollResult) {
            const successIcon = woundItem.querySelector("i.fas");
            const penaltyValue = woundItem.querySelector(".penalty-value");
            const isNowSuccess = rerollResult.successCount >= 2;
            const wasSuccess = woundItem.classList.contains("success");
            
            if (isNowSuccess !== wasSuccess) {
                if (successIcon) {
                    successIcon.classList.toggle("fa-check", isNowSuccess);
                    successIcon.classList.toggle("fa-times", !isNowSuccess);
                }
                woundItem.classList.toggle("success", isNowSuccess);
                woundItem.classList.toggle("failure", !isNowSuccess);
            }
            
            if (penaltyValue && rerollResult.healingEffect) {
                const reduction = rerollResult.healingEffect.reduction;
                penaltyValue.textContent = `${isNowSuccess ? '-' : '+'}${reduction}%`;
            }
            
            if (rerollResult.tooltip) {
                woundItem.dataset.tooltip = rerollResult.tooltip;
            }
            
            // Zaktualizuj dane w flagach wiadomości, aby aplikacja uwzględniła przerzut
            const updatedResults = results.map(r => r.woundId === woundId ? {
                ...r,
                successCount: rerollResult.successCount,
                healingEffect: rerollResult.healingEffect,
                modifiedResults: rerollResult.modifiedResults,
                tooltip: rerollResult.tooltip
            } : r);
            
            await message.setFlag("neuroshima", "results", updatedResults);
        }
    } catch (error) {
        game.neuroshima?.error("Błąd podczas przerzutu", error);
        ui.notifications.error("Błąd podczas przerzutu: " + error.message);
    } finally {
        game.neuroshima?.groupEnd();
    }
  }

  /**
   * Obsługa otwierania panelu leczenia z karty czatu.
   */
  static async onOpenHealPanel(event, message) {
    const flags = message.getFlag("neuroshima") || message.flags?.neuroshima || {};
    
    let patientRef = flags.patientRef;
    let medicRef = flags.medicRef;
    const sessionId = flags.sessionId;

    // Fallback dla starszych wiadomości lub specyficznych przypadków
    if (!patientRef) {
        if (flags.patientActorUuid) {
            patientRef = { kind: "actor", uuid: flags.patientActorUuid };
        } else if (flags.rollData?.actorId) {
            patientRef = { kind: "actor", uuid: `Actor.${flags.rollData.actorId}` };
        }
    }

    if (!medicRef && flags.medicActorId) {
        medicRef = { kind: "actor", uuid: `Actor.${flags.medicActorId}` };
    }

    if (!patientRef) {
      ui.notifications.error(game.i18n.localize("NEUROSHIMA.Errors.PatientNotFound"));
      return;
    }

    // Rozwiąż referencje
    const { actor: patientActor } = await resolveRef(patientRef);
    
    // Medyk jest opcjonalny (tylko w healingRequest)
    let medicActor = null;
    if (medicRef) {
        const resolved = await resolveRef(medicRef);
        medicActor = resolved.actor;
    }

    if (!patientActor) {
      ui.notifications.error(game.i18n.localize("NEUROSHIMA.Errors.PatientNotFound"));
      return;
    }

    // Sprawdzenie uprawnień: GM lub Owner medyka lub Owner pacjenta
    const isGM = game.user.isGM;
    const isMedicOwner = medicActor ? medicActor.isOwner : false;
    const isPatientOwner = patientActor.isOwner;

    if (!isGM && !isMedicOwner && !isPatientOwner) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoPermission"));
      return;
    }

    // Otwórz HealingApp
    const { HealingApp } = await import("../apps/healing-app.js");
    const app = new HealingApp({
      patientRef,
      medicRef,
      sessionId
    });
    app.render(true);
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

    if (attackFlags.opposedResolved || defenseFlags.opposedResolved) return;

    // Import klasy opposed
    const { NeuroshimaMeleeOpposed } = await import('../helpers/melee-opposed.js');

    // Oblicz wynik pojedynku
    const opposedOptions = {
      mode: game.settings.get("neuroshima", "opposedMeleeMode")
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
        opposedDefenseId: defenseMessage.id,
        opposedResolved: true
      }
    );

    const defenseUpdate = foundry.utils.mergeObject(
      foundry.utils.deepClone(defenseFlags),
      {
        opposedResult: opposed,
        opposedResultHTML: opposedHTML,
        opposedAttackId: attackMessage.id,
        opposedResolved: true
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
