import { NEUROSHIMA } from "../config.js";

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
    const mode = options.mode || game.settings.get("neuroshima", "opposedMeleeMode") || "successes";
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
      this._computeSuccessesMode(attackFlags, defenseFlags, result, options);
    }

    return result;
  }

  /**
   * Logika trybu Successes (Liczba sukcesów w teście zamkniętym)
   * @private
   */
  static _computeSuccessesMode(attackFlags, defenseFlags, result, options) {
    const atkSuccesses = attackFlags.successCount ?? 0;
    const defSuccesses = defenseFlags.successCount ?? 0;
    const advantage = atkSuccesses - defSuccesses;

    result.attackSP = atkSuccesses;
    result.defenseSP = defSuccesses;
    result.advantage = advantage;

    if (advantage > 0) {
      result.winner = 'attacker';
      result.outcome = 'attacker-won';
      // Wygrał z przewagą, spDifference to różnica sukcesów (1-3)
      result.spDifference = Math.clamp(advantage, 0, 3);
    } else if (advantage < 0) {
      result.winner = 'defender';
      result.outcome = 'defender-won';
      result.spDifference = 0;
    } else {
      // Remis sprzyja obrońcy
      result.winner = 'defender';
      result.outcome = 'tie';
      result.spDifference = 0;
    }
  }

  /**
   * Logika trybu Dice (Segmenty - porównanie zmodyfikowanych wyników)
   * @private
   */
  static _computeDiceMode(attackFlags, defenseFlags, result) {
    const atkResults = (attackFlags.modifiedResults || []).sort((a, b) => a.index - b.index);
    const defResults = (defenseFlags.modifiedResults || []).sort((a, b) => a.index - b.index);

    let attackerWins = 0;
    let defenderWins = 0;

    // Porównujemy każdą z 3 kości (segmenty) - bierzemy wyniki ZMODYFIKOWANE przez umiejętność
    for (let i = 0; i < 3; i++) {
      const atk = atkResults[i];
      const def = defResults[i];

      if (!atk || !def) continue;

      let segmentWinner = 'tie';
      
      // Nowa logika: kość brana pod uwagę tylko jeśli jest sukcesem (<= target)
      // Logika sukcesów jest już przeliczona w rollTest i zapisana w atk.isSuccess / def.isSuccess
      
      if (atk.isSuccess && !def.isSuccess) {
        segmentWinner = 'attacker';
        attackerWins++;
      } else if (!atk.isSuccess && def.isSuccess) {
        segmentWinner = 'defender';
        defenderWins++;
      } else if (atk.isSuccess && def.isSuccess) {
        // Obaj mają sukces - wygrywa ten z niższym wynikiem (bliżej 1)
        if (atk.modified < def.modified) {
          segmentWinner = 'attacker';
          attackerWins++;
        } else {
          // Remis w segmencie przy obu sukcesach sprzyja obrońcy
          segmentWinner = 'defender';
          defenderWins++;
        }
      } else {
        // Obaj porażka - obrońca wygrywa segment (lub remis)
        segmentWinner = 'defender';
        defenderWins++;
      }

      result.details.push({
        segment: i + 1,
        winner: segmentWinner,
        atkVal: atk.modified,
        defVal: def.modified
      });
    }

    result.advantage = `${attackerWins} - ${defenderWins}`;
    
    if (attackerWins > defenderWins) {
      result.winner = 'attacker';
      result.outcome = 'attacker-won';
      result.spDifference = Math.clamp(attackerWins - defenderWins, 0, 3);
    } else if (defenderWins > attackerWins) {
      result.winner = 'defender';
      result.outcome = 'defender-won';
      result.spDifference = 0;
    } else {
      // Ogólny remis sprzyja obrońcy
      result.winner = 'defender';
      result.outcome = 'tie';
      result.spDifference = 0;
    }
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
      detailsHtml = '<div class="opposed-details-grid">';
      detailsHtml += `
        <div class="grid-header">
            <span class="col-seg"></span>
            <span class="col-name">${atkName.split(' ')[0]}</span>
            <span class="col-vs"></span>
            <span class="col-name">${defName.split(' ')[0]}</span>
            <span class="col-win"></span>
        </div>`;
      opposed.details.forEach(d => {
        const winnerIcon = d.winner === 'attacker' ? '<i class="fas fa-swords"></i>' : (d.winner === 'defender' ? '<i class="fas fa-shield-alt"></i>' : '<i class="fas fa-balance-scale"></i>');
        const atkClass = d.winner === 'attacker' ? 'winner' : (d.winner === 'defender' ? 'loser' : '');
        const defClass = d.winner === 'defender' ? 'winner' : (d.winner === 'attacker' ? 'loser' : '');
        
        detailsHtml += `
          <div class="grid-row">
            <span class="col-seg">S${d.segment}</span>
            <span class="col-val ${atkClass}">${d.atkVal}</span>
            <span class="col-vs">vs</span>
            <span class="col-val ${defClass}">${d.defVal}</span>
            <span class="col-win">${winnerIcon}</span>
          </div>`;
      });
      detailsHtml += '</div>';
    }

    let atkVal = '';
    let defVal = '';
    if (opposed.mode === 'dice') {
        const parts = opposed.advantage.split(' - ');
        atkVal = `${parts[0]} <i class="fas fa-check"></i>`;
        defVal = `${parts[1]} <i class="fas fa-check"></i>`; 
    } else {
        atkVal = `${opposed.attackSP} ${game.i18n.localize('NEUROSHIMA.Roll.SuccessesAbbr')}`;
        defVal = `${opposed.defenseSP} ${game.i18n.localize('NEUROSHIMA.Roll.SuccessesAbbr')}`;
    }

    return `
      <div class="neuroshima melee-opposed-result ${outcomeClass}">
        <div class="opposed-summary">
          <div class="opposed-attacker">
            <span class="name">${atkName}</span>
            <span class="value">${atkVal}</span>
          </div>
          <div class="opposed-vs">vs</div>
          <div class="opposed-defender">
            <span class="name">${defName} (${defType})</span>
            <span class="value">${defVal}</span>
          </div>
        </div>
        <div class="opposed-outcome">
          ${outcomeText}
        </div>
        ${opposed.finalDamageValue ? `<div class="opposed-sp-diff">${game.i18n.localize('NEUROSHIMA.Roll.Damage')}: <strong>${opposed.finalDamageValue}</strong> (+${opposed.spDifference} PP)</div>` : (opposed.spDifference > 0 ? `<div class="opposed-sp-diff">+${opposed.spDifference} ${game.i18n.localize('NEUROSHIMA.Roll.SuccessPointsAbbr')} Obrażeń</div>` : '')}
        ${detailsHtml}
      </div>
    `;
  }

  /**
   * Sprawdza, czy dany actor może się bronić w tym teście
   * @param {Actor} actor
   * @param {Array<string>} targetUuids - lista UUID tokenów/aktorów z ataku
   * @returns {boolean}
   */
  static canDefend(actor, targetUuids) {
    if (!actor || !targetUuids?.length) return false;
    // Sprawdzamy zarówno UUID aktora jak i UUID dokumentu (jeśli to token)
    return targetUuids.includes(actor.uuid) || targetUuids.includes(actor.id);
  }
}
