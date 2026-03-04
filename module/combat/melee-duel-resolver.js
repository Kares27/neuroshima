/**
 * Czysty resolver dla starć w zwarciu (Neuroshima 1.5).
 * Odpowiada za obliczenie wyniku starcia (Duel) na podstawie przekazanego stanu flag.
 * 
 * Logika rozstrzygania (WFRP4e Pattern):
 * 1. Porównujemy liczbę sukcesów (SP) obu stron.
 * 2. Zwycięzca zadaje obrażenia zależne od RÓŻNICY sukcesów (spDifference).
 * 3. Tier obrażeń (Draśnięcie/Lekka/Ciężka/Krytyczna) jest mapowany 1:1 na spDifference.
 */
export class NeuroshimaMeleeDuelResolver {
  /**
   * Główna funkcja rozstrzygająca wynik całego starcia (tryb uproszczony/Successes).
   * @param {Object} state - Stan starcia z flags.neuroshima.meleeDuel
   * @returns {Object} Wynik starcia
   */
  static resolve(state) {
    if (!state.attacker || !state.defender) {
      return { winner: "none", tier: 0, explain: "Brak danych rzutów." };
    }

    const attackerTarget = state.attacker.stat;
    const defenderTarget = state.defender.stat;

    // Oblicz sukcesy uwzględniając modyfikatory obu stron (DoubleSkillAction logic).
    // Finalna kość Atakującego [i] = rzut - własne obniżenie + podwyższenie przez obrońcę.
    const attackerSuccesses = state.dice.attacker.filter((v, i) => {
        const modified = v - state.attacker.modSelf[i] + state.defender.modOpponent[i];
        return modified <= attackerTarget && v !== 20;
    }).length;

    // Finalna kość Obrońcy [i] = rzut - własne obniżenie + podwyższenie przez atakującego.
    const defenderSuccesses = state.dice.defender.filter((v, i) => {
        const modified = v - state.defender.modSelf[i] + state.attacker.modOpponent[i];
        return modified <= defenderTarget && v !== 20;
    }).length;

    const spDifference = attackerSuccesses - defenderSuccesses;
    let winner = "none";
    let damageResult = "";

    if (attackerSuccesses > defenderSuccesses) {
      // Wygrana atakującego: zadaje obrażenia na podstawie tieru broni.
      winner = "attacker";
      const weapon = state.attack.rollData;
      // spDifference 1 = Melee1 (D), 2 = Melee2 (L), 3+ = Melee3 (C/K).
      const tier = Math.clamp(spDifference, 1, 3);
      if (tier === 1) damageResult = weapon.damageMelee1 || "L";
      else if (tier === 2) damageResult = weapon.damageMelee2 || "C";
      else if (tier >= 3) damageResult = weapon.damageMelee3 || "K";
    } else {
      // Remis lub wygrana obrońcy (brak obrażeń w standardowym teście przeciwstawnym).
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
   * Oblicza obrażenia dla konkretnego segmentu walki (tryb zaawansowany/Segments).
   * @param {Object} state - Stan starcia
   * @param {Object} action - Deklarowana akcja (atak) zawierająca siłę (Power)
   * @returns {string} Kod obrażeń pobrany ze statystyk broni
   */
  static calculateSegmentDamage(state, action) {
    const weapon = state.attack.rollData;
    const power = action.power; // Liczba sukcesów przeznaczonych na ten cios (1, 2 lub 3)

    // Zgodnie z rozdziałem Zbrojownia: 1s = Melee1, 2s = Melee2, 3s = Melee3.
    if (power === 1) return weapon.damageMelee1 || "L";
    if (power === 2) return weapon.damageMelee2 || "C";
    if (power >= 3) return weapon.damageMelee3 || "K";
    
    return null;
  }
}
