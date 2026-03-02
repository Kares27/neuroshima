/**
 * Czysty resolver dla starć w zwarciu.
 * Odpowiada za obliczenie wyniku starcia na podstawie przekazanego stanu.
 */
export class NeuroshimaMeleeDuelResolver {
  /**
   * Główna funkcja rozstrzygająca.
   * @param {Object} state - Stan starcia z flags.neuroshima.meleeDuel
   * @returns {Object} Wynik starcia
   */
  static resolve(state) {
    if (!state.attacker || !state.defender) {
      return { winner: "none", tier: 0, explain: "Brak danych rzutów." };
    }

    const attackerTarget = state.attacker.stat;
    const defenderTarget = state.defender.stat;

    // Oblicz sukcesy uwzględniając modyfikatory obu stron
    // Finalna kość Atakującego [i] = rawDice[i] - modSelf[i] + defender.modOpponent[i]
    const attackerSuccesses = state.dice.attacker.filter((v, i) => {
        const modified = v - state.attacker.modSelf[i] + state.defender.modOpponent[i];
        return modified <= attackerTarget && v !== 20;
    }).length;

    // Finalna kość Obrońcy [i] = rawDice[i] - modSelf[i] + attacker.modOpponent[i]
    const defenderSuccesses = state.dice.defender.filter((v, i) => {
        const modified = v - state.defender.modSelf[i] + state.attacker.modOpponent[i];
        return modified <= defenderTarget && v !== 20;
    }).length;

    const spDifference = attackerSuccesses - defenderSuccesses;
    let winner = "none";
    let damageResult = "";

    if (attackerSuccesses > defenderSuccesses) {
      winner = "attacker";
      const weapon = state.attack.rollData;
      const tier = Math.clamp(spDifference, 1, 3);
      if (tier === 1) damageResult = weapon.damageMelee1 || "L";
      else if (tier === 2) damageResult = weapon.damageMelee2 || "C";
      else if (tier >= 3) damageResult = weapon.damageMelee3 || "K";
    } else {
      // Remis lub wygrana obrońcy
      winner = "defender";
    }

    return {
      winner,
      spDifference,
      attackerScore: attackerSuccesses,
      defenderScore: defenderSuccesses,
      damageResult,
      isResolved: true
    };
  }

  /**
   * Oblicza obrażenia dla konkretnego segmentu.
   * @param {Object} state - Stan starcia
   * @param {Object} action - Deklarowana akcja (atak)
   * @returns {string} Kod obrażeń (np. "L", "C", "K")
   */
  static calculateSegmentDamage(state, action) {
    const weapon = state.attack.rollData;
    const power = action.power; // 1, 2 lub 3 sukcesy

    if (power === 1) return weapon.damageMelee1 || "L";
    if (power === 2) return weapon.damageMelee2 || "C";
    if (power >= 3) return weapon.damageMelee3 || "K";
    
    return null;
  }
}
