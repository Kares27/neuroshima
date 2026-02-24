/**
 * Logika testów przeciwstawnych dla walki wręcz
 * Wzorowana na WFRP4e OpposedTest
 */
export class NeuroshimaMeleeOpposed {
  
  /**
   * Porównuje wyniki ataku i obrony, określa zwycięzcę
   * @param {Object} attackFlags - rollData z wiadomości ataku
   * @param {Object} defenseFlags - rollData z wiadomości obrony
   * @param {Object} options - Dodatkowe opcje (mode, thresholds)
   * @returns {Object} Wynik pojedynku
   */
  static compute(attackFlags, defenseFlags, options = {}) {
    const mode = options.mode || game.settings.get("neuroshima", "opposedMeleeMode") || "sp";
    const atkSuccess = attackFlags.isSuccess ?? false;
    const defSuccess = defenseFlags.isSuccess ?? false;
    
    const result = {
      winner: null,              // 'attacker' | 'defender' | 'tie'
      mode,
      attackSuccess: atkSuccess,
      defenseSuccess: defSuccess,
      spDifference: 0,           // 0..3 sukcesy obrażeniowe
      advantage: 0,              // Surowa różnica SP lub wygrane segmenty
      attackMessageId: attackFlags.messageId,
      defenseMessageId: defenseFlags.messageId,
      defenseType: defenseFlags.defenseType ?? 'unknown',
      timestamp: Date.now(),
      details: []                // Szczegóły per segment (dla trybu dice)
    };

    if (mode === "dice") {
      this._computeDiceMode(attackFlags, defenseFlags, result);
    } else {
      this._computeSPMode(attackFlags, defenseFlags, result, options);
    }

    return result;
  }

  /**
   * Logika trybu SP (Punkty Sukcesu)
   * @private
   */
  static _computeSPMode(attackFlags, defenseFlags, result, options) {
    const atkSP = attackFlags.successPoints ?? 0;
    const defSP = defenseFlags.successPoints ?? 0;
    const advantage = atkSP - defSP;

    result.attackSP = atkSP;
    result.defenseSP = defSP;
    result.advantage = advantage;

    // Testy przeciwstawne w Neuroshimie zawsze porównują SP, 
    // nawet jeśli obie strony mają ujemne SP (porażka).
    // Zwycięzcą jest ten, kto ma WIĘCEJ Punktów Sukcesu (lub mniej Punktów Porażki).

    if (advantage > 0) {
      result.winner = 'attacker';
      if (result.attackSuccess && result.defenseSuccess === false) {
          result.outcome = 'defense-failed';
      } else if (result.attackSuccess && result.defenseSuccess) {
          result.outcome = 'attacker-won';
      } else {
          result.outcome = 'both-failed'; // Atakujący wygrał, bo mniej przegrał
      }

      // Obrażenia zadaje tylko jeśli atak był sukcesem (atkSP >= 0)
      if (result.attackSuccess) {
        result.spDifference = this._mapAdvantageToTier(advantage, options);
      } else {
        result.spDifference = 0;
      }
    } else if (advantage < 0) {
      result.winner = 'defender';
      if (!result.attackSuccess && result.defenseSuccess) {
          result.outcome = 'attack-failed';
      } else if (!result.attackSuccess && !result.defenseSuccess) {
          result.outcome = 'both-failed'; // Obrońca wygrał, bo mniej przegrał
      } else {
          result.outcome = 'defender-won';
      }
      result.spDifference = 0;
    } else {
      // Remis sprzyja obrońcy
      result.winner = 'defender';
      result.outcome = 'tie';
      result.spDifference = 0;
    }
  }

  /**
   * Logika trybu Dice (Segmenty)
   * @private
   */
  static _computeDiceMode(attackFlags, defenseFlags, result) {
    const atkResults = (attackFlags.modifiedResults || []).sort((a, b) => a.index - b.index);
    const defResults = (defenseFlags.modifiedResults || []).sort((a, b) => a.index - b.index);

    let attackerWins = 0;
    let defenderWins = 0;

    // Porównujemy każdą z 3 kości (segmenty)
    for (let i = 0; i < 3; i++) {
      const atk = atkResults[i];
      const def = defResults[i];

      if (!atk || !def) continue;

      let segmentWinner = 'tie';
      if (atk.isSuccess && !def.isSuccess) {
        segmentWinner = 'attacker';
        attackerWins++;
      } else if (!atk.isSuccess && def.isSuccess) {
        segmentWinner = 'defender';
        defenderWins++;
      }

      result.details.push({
        segment: i + 1,
        winner: segmentWinner,
        atkSuccess: atk.isSuccess,
        defSuccess: def.isSuccess
      });
    }

    result.advantage = attackerWins;
    result.spDifference = Math.clamp(attackerWins, 0, 3);

    if (attackerWins > defenderWins) {
      result.winner = 'attacker';
      result.outcome = 'attacker-won';
    } else if (defenderWins > attackerWins) {
      result.winner = 'defender';
      result.outcome = 'defender-won';
    } else {
      result.winner = 'tie';
      result.outcome = 'tie';
    }
  }

  /**
   * Mapuje surową przewagę na tier obrażeń (1-3)
   * @private
   */
  static _mapAdvantageToTier(advantage, options = {}) {
    if (advantage <= 0) return 0;
    
    const tier2 = options.tier2At || game.settings.get("neuroshima", "opposedMeleeTier2At") || 3;
    const tier3 = options.tier3At || game.settings.get("neuroshima", "opposedMeleeTier3At") || 6;

    if (advantage < tier2) return 1;
    if (advantage < tier3) return 2;
    return 3;
  }

  /**
   * Generuje HTML z podsumowaniem pojedynku (do wstawienia w chat)
   * @param {Object} opposed - wynik z compute()
   * @param {Actor} attacker
   * @param {Actor} defender
   * @returns {string} HTML
   */
  static renderOpposedResult(opposed, attacker, defender) {
    const atkName = attacker.name;
    const defName = defender.name;
    const defType = game.i18n.localize(`NEUROSHIMA.DefenseType.${opposed.defenseType}`);

    let outcomeText = '';
    let outcomeClass = '';

    const labels = {
      attacker: atkName,
      defender: defName,
      defenseType: defType,
      spDiff: opposed.spDifference,
      advantage: opposed.advantage
    };

    switch (opposed.outcome) {
      case 'both-failed':
        outcomeText = game.i18n.format('NEUROSHIMA.MeleeOpposed.BothFailed', labels);
        outcomeClass = 'opposed-both-failed';
        break;

      case 'attack-failed':
        outcomeText = game.i18n.format('NEUROSHIMA.MeleeOpposed.AttackFailed', labels);
        outcomeClass = 'opposed-attack-failed';
        break;

      case 'defense-failed':
        outcomeText = game.i18n.format('NEUROSHIMA.MeleeOpposed.DefenseFailed', labels);
        outcomeClass = 'opposed-defense-failed';
        break;

      case 'attacker-won':
        outcomeText = game.i18n.format('NEUROSHIMA.MeleeOpposed.AttackerWon', labels);
        outcomeClass = 'opposed-attacker-won';
        break;

      case 'defender-won':
        outcomeText = game.i18n.format('NEUROSHIMA.MeleeOpposed.DefenderWon', labels);
        outcomeClass = 'opposed-defender-won';
        break;

      case 'tie':
        outcomeText = game.i18n.format('NEUROSHIMA.MeleeOpposed.Tie', labels);
        outcomeClass = 'opposed-tie';
        break;
    }

    let detailsHtml = '';
    if (opposed.mode === 'dice' && opposed.details?.length > 0) {
      detailsHtml = '<div class="opposed-details" style="font-size: 0.9em; margin-top: 5px; border-top: 1px dotted #ccc; padding-top: 5px;">';
      opposed.details.forEach(d => {
        const winnerIcon = d.winner === 'attacker' ? '<i class="fas fa-swords"></i>' : (d.winner === 'defender' ? '<i class="fas fa-shield-alt"></i>' : '<i class="fas fa-balance-scale"></i>');
        detailsHtml += `
          <div class="segment-row" style="display: flex; justify-content: space-between; align-items: center;">
            <span>S${d.segment}:</span>
            <span>A: ${d.atkSuccess ? '✓' : '✗'}</span>
            <span>D: ${d.defSuccess ? '✓' : '✗'}</span>
            <span>${winnerIcon}</span>
          </div>`;
      });
      detailsHtml += '</div>';
    }

    const atkVal = opposed.mode === 'dice' ? `${opposed.advantage} ✓` : `${opposed.attackSP} SP`;
    const defVal = opposed.mode === 'dice' ? `${opposed.details.filter(d => d.defSuccess).length} ✓` : `${opposed.defenseSP} SP`;

    return `
      <div class="melee-opposed-result ${outcomeClass}" style="padding: 5px; border: 1px solid #999; border-radius: 3px; background: rgba(0,0,0,0.05);">
        <h3 style="margin: 0 0 5px 0; border-bottom: 1px solid #999;">${game.i18n.localize('NEUROSHIMA.MeleeOpposed.Title')} (${opposed.mode.toUpperCase()})</h3>
        <div class="opposed-summary" style="display: flex; justify-content: space-between; align-items: center; font-weight: bold;">
          <div class="opposed-attacker" style="text-align: left; flex: 1;">
            ${atkName}<br>${atkVal}
          </div>
          <div class="opposed-vs" style="margin: 0 10px;">vs</div>
          <div class="opposed-defender" style="text-align: right; flex: 1;">
            ${defName} (${defType})<br>${defVal}
          </div>
        </div>
        <div class="opposed-outcome" style="margin-top: 5px; text-align: center; font-style: italic; border-top: 1px solid #ccc; padding-top: 5px;">
          ${outcomeText}
        </div>
        ${opposed.spDifference > 0 ? `<div class="opposed-sp-diff" style="text-align: center; font-weight: bold; color: #800;">+${opposed.spDifference} Sukcesy Obrażeń</div>` : ''}
        ${detailsHtml}
      </div>
    `;
  }

  /**
   * Sprawdza, czy dany actor może się bronić w tym teście
   * @param {Actor} actor
   * @param {Array<string>} targetIds - lista actorId z ataku
   * @returns {boolean}
   */
  static canDefend(actor, targetIds) {
    if (!actor || !targetIds?.length) return false;
    return targetIds.includes(actor.id);
  }
}
