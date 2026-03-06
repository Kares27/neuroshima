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
   * Pobiera efektywne PT (Współczynnik) dla danej roli uwzględniając manewry.
   */
  static getEffectiveStat(state, role) {
    const side = state[role];
    const otherRole = role === "attacker" ? "defender" : "attacker";
    const otherSide = state[otherRole];
    let stat = side.stat;

    // Furia: +2 do Zręczności w ataku
    if (side.maneuver === "fury" && state.initiative === role) {
        stat += 2;
    }

    // Pełna Obrona: +2 do Zręczności w obronie
    if (side.maneuver === "fullDefense" && state.initiative !== role) {
        stat += 2;
    }

    // Szarża: Bonus został już rozliczony w Inicjatywie, 
    // ale kara po przegranej Inicjatywie (-1 do -3 do Zręczności w 1. turze)
    // TODO: Zaimplementować karę za przegraną szarżę jeśli turn === 1

    return stat;
  }

  /**
   * Sprawdza czy kość jest sukcesem.
   */
  static isSuccess(value, index, role, state) {
    if (value === 20) return false;
    const side = state[role];
    const otherRole = role === "attacker" ? "defender" : "attacker";
    const otherSide = state[otherRole];
    const effectiveStat = this.getEffectiveStat(state, role);
    const modified = value - side.modSelf[index] + otherSide.modOpponent[index];
    return modified <= effectiveStat;
  }

  /**
   * Główna funkcja rozstrzygająca wynik całego starcia (tryb uproszczony/Successes).
   * @param {Object} state - Stan starcia z flags.neuroshima.meleeDuel
   * @returns {Object} Wynik starcia
   */
  static resolve(state) {
    if (!state.attacker || !state.defender) {
      return { winner: "none", tier: 0, explain: "Brak danych rzutów." };
    }

    const attackerSuccesses = state.dice.attacker.filter((v, i) => this.isSuccess(v, i, "attacker", state)).length;
    const defenderSuccesses = state.dice.defender.filter((v, i) => this.isSuccess(v, i, "defender", state)).length;

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
    const rollData = state.attack?.rollData;
    if (!rollData) return "D";

    const power = action.power; // Liczba sukcesów przeznaczonych na ten cios (1, 2 lub 3)

    // Próba pobrania z różnych struktur (system.damageMeleeX lub płaskie damageMeleeX)
    const d1 = rollData.system?.damageMelee1 || rollData.damageMelee1 || "D";
    const d2 = rollData.system?.damageMelee2 || rollData.damageMelee2 || "L";
    const d3 = rollData.system?.damageMelee3 || rollData.damageMelee3 || "C";

    if (power === 1) return d1;
    if (power === 2) return d2;
    if (power >= 3) return d3;
    
    return null;
  }
}
