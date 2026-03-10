/**
 * Czysty resolver dla starć w zwarciu (Neuroshima 1.5).
 * Odpowiada za obliczenie wyniku starcia (Duel) na podstawie przekazanego stanu flag.
 * 
 * Logika Neuroshima 1.5:
 * 1. Obrażenia są zadawane i rozliczane w każdym segmencie osobno.
 * 2. Końcowy resolver służy jedynie do podsumowania przebiegu rundy.
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
   * Główna funkcja podsumowująca wynik starcia (runda zakończona).
   * @param {Object} state - Stan starcia z flags.neuroshima.meleeDuel
   * @returns {Object} Podsumowanie starcia
   */
  static resolve(state) {
    if (!state.attacker || !state.defender) {
      return { winner: "none", isResolved: true, explain: "Brak danych rzutów." };
    }

    let attackerHits = 0;
    let defenderHits = 0;
    let damageList = [];

    (state.segments || []).forEach(seg => {
        if (seg.result) {
            attackerHits++;
            damageList.push(seg.result);
        }
        if (seg.resultDefender) {
            defenderHits++;
            damageList.push(seg.resultDefender);
        }
    });

    let winner = "none";
    if (attackerHits > defenderHits) winner = "attacker";
    else if (defenderHits > attackerHits) winner = "defender";

    return {
      winner,
      attackerHits,
      defenderHits,
      damageList,
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
    const role = action.side; // attacker lub defender
    const rollData = role === "attacker" ? state.attack?.rollData : state.defense?.rollData;
    
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
