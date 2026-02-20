import { NEUROSHIMA } from "../config.js";

/**
 * Rozszerzona klasa ChatMessage z ujednoliconym API renderowania kart czatu.
 * Zapewnia czysty interfejs do tworzenia i renderowania wszystkich typów wiadomości.
 */
export class NeuroshimaChatMessage extends ChatMessage {
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
   * Sprawdza czy to raport odporności na ból.
   */
  get isPainResistanceReport() {
    const isPain = this.getFlag("neuroshima", "isPainResistanceReport") === true;
    game.neuroshima.log("Getter: isPainResistanceReport", { id: this.id, isPain });
    return isPain;
  }
}
