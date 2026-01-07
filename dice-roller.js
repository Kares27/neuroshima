import { shouldDebug } from "./module/helpers/utils.mjs";

/**
 * ===================================================================
 * NEUROSHIMA 1.5 - SYSTEM RZUTÓW KOŚĆMI
 * ===================================================================
 * 
 * Ten plik zawiera kompletną implementację systemu testów Neuroshima 1.5.
 * Obsługuje zarówno testy otwarte jak i zamknięte, z pełną logiką
 * modyfikatorów, poziomów trudności i specjalnych przypadków.
 * 
 * POZIOMY TRUDNOŚCI I PROCENTY:
 * - Łatwy:           -20% do -1%    (base: -20%)
 * - Przeciętny:       0% do 10%     (base: 0%)
 * - Problematyczny:  11% do 30%     (base: 11%)
 * - Trudny:          31% do 60%     (base: 31%)
 * - Bardzo Trudny:   61% do 90%     (base: 61%)
 * - Cholernie Trudny: 91% do 120%   (base: 91%)
 * - Fart:            121%+          (base: 121%)
 * 
 * MODYFIKATORY POZIOMÓW TRUDNOŚCI (dodawane do atrybutu):
 * - Łatwy:           +2
 * - Przeciętny:       0
 * - Problematyczny:  -2
 * - Trudny:          -5
 * - Bardzo Trudny:   -8
 * - Cholernie Trudny: -11
 * - Fart:            -15
 */
export class NeuroshimaDiceRoller {
  
  /**
   * Zwraca definicje poziomów trudności z zakresami procentowymi
   * Każdy poziom ma:
   * - min/max: zakres procentowy dla tego poziomu
   * - base: domyślny procent przy wyborze tego poziomu
   * - name: polska nazwa poziomu
   * 
   * @returns {Object} Mapa poziomów trudności
   */
  static getDifficultyRanges() {
    return {
      easy: { min: -20, max: -1, base: -20, name: "Łatwy" },
      average: { min: 0, max: 10, base: 0, name: "Przeciętny" },
      problematic: { min: 11, max: 30, base: 11, name: "Problematyczny" },
      hard: { min: 31, max: 60, base: 31, name: "Trudny" },
      veryHard: { min: 61, max: 90, base: 61, name: "Bardzo Trudny" },
      damnHard: { min: 91, max: 120, base: 91, name: "Cholernie Trudny" },
      luck: { min: 121, max: 999, base: 121, name: "Fart" }
    };
  }

  /**
   * Pobiera bazowy procent dla poziomu trudności
   * To jest procent od którego zaczynamy dla danego poziomu
   * (dolna granica zakresu)
   * 
   * @param {String} difficulty - Klucz poziomu trudności
   * @returns {Number} Bazowy procent poziomu
   */
  static getDifficultyBasePercentage(difficulty) {
    const ranges = this.getDifficultyRanges();
    return ranges[difficulty]?.base || 0;
  }

  /**
   * Określa poziom trudności na podstawie finalnego procentu
   * Sprawdza w który zakres procentowy wpada podana wartość
   * 
   * @param {Number} percentage - Finalny procent po modyfikatorach
   * @returns {String} Klucz poziomu trudności
   */
  static getDifficultyFromPercentage(percentage) {
    const ranges = this.getDifficultyRanges();
    
    // Przeszukaj wszystkie poziomy trudności
    for (const [key, range] of Object.entries(ranges)) {
      if (percentage >= range.min && percentage <= range.max) {
        return key;
      }
    }
    
    // Jeśli procent przekracza wszystkie zakresy, zwróć "fart"
    if (percentage >= 121) return 'luck';
    
    // Jeśli procent jest poniżej wszystkich zakresów, zwróć "łatwy"
    return 'easy';
  }

  /**
   * Pobiera polską nazwę poziomu trudności
   * 
   * @param {String} difficulty - Klucz poziomu trudności
   * @returns {String} Polska nazwa poziomu
   */
  static getDifficultyName(difficulty) {
    const ranges = this.getDifficultyRanges();
    return ranges[difficulty]?.name || "Nieznany";
  }

  /**
   * Adjustuje poziom trudności w oparciu o poziom umiejętności
   * REGUŁA: Jeśli poziom umiejętności jest podzielny przez 4, poziom trudności spada o 1
   * REGUŁA: Jeśli poziom umiejętności wynosi 0, poziom trudności rośnie o 1
   * 
   * @param {String} currentDifficulty - Aktualny poziom trudności
   * @param {Number} skillLevel - Poziom umiejętności
   * @returns {String} Nowy poziom trudności
   */
  static adjustDifficultyBySkillLevel(currentDifficulty, skillLevel) {
    let adjustment = 0;
    
    // Skill = 0: +1 poziom trudności (trudniej)
    if (skillLevel === 0) {
      adjustment = 1;
      if (shouldDebug()) console.log(`SKILL ADJUSTMENT: Skill = 0, zwiększam trudność o 1 poziom`);
    }
    // Skill podzielny przez 4: -1 poziom trudności (łatwiej)
    else if (skillLevel > 0 && skillLevel % 4 === 0) {
      adjustment = -1;
      if (shouldDebug()) console.log(`SKILL ADJUSTMENT: Skill ${skillLevel} podzielny przez 4, zmniejszam trudność o 1 poziom`);
    }
    
    return this.adjustDifficultyByLevel(currentDifficulty, adjustment);
  }

  /**
   * Adjustuje poziom trudności w oparciu o poziom wiedzy
   * Identyczna logika jak dla umiejętności
   * 
   * @param {String} currentDifficulty - Aktualny poziom trudności
   * @param {Number} knowledgeLevel - Poziom wiedzy
   * @returns {String} Nowy poziom trudności
   */
  static adjustDifficultyByKnowledgeLevel(currentDifficulty, knowledgeLevel) {
    // Używamy tej samej logiki co dla umiejętności
    return this.adjustDifficultyBySkillLevel(currentDifficulty, knowledgeLevel);
  }

  /**
   * Adjustuje poziom trudności o określoną liczbę poziomów
   * Pozytywne wartości = trudniej, negatywne = łatwiej
   * 
   * @param {String} currentDifficulty - Aktualny poziom trudności
   * @param {Number} adjustment - Ilość poziomów do zmiany (+/-)
   * @returns {String} Nowy poziom trudności
   */
  static adjustDifficultyByLevel(currentDifficulty, adjustment) {
    if (adjustment === 0) return currentDifficulty;

    // Kolejność poziomów trudności (od najłatwiejszego do najtrudniejszego)
    const difficultyOrder = ['easy', 'average', 'problematic', 'hard', 'veryHard', 'damnHard', 'luck'];
    const currentIndex = difficultyOrder.indexOf(currentDifficulty);
    
    if (currentIndex === -1) {
      console.warn(`Nieznany poziom trudności: ${currentDifficulty}`);
      return currentDifficulty;
    }
    
    // Oblicz nowy indeks (ograniczony do dostępnych poziomów)
    const newIndex = Math.max(0, Math.min(difficultyOrder.length - 1, currentIndex + adjustment));
    const newDifficulty = difficultyOrder[newIndex];
    
    if (shouldDebug()) console.log(`DIFFICULTY ADJUSTMENT: ${currentDifficulty} ${adjustment > 0 ? '+' : ''}${adjustment} → ${newDifficulty}`);
    return newDifficulty;
  }

  /**
   * ===================================================================
   * GŁÓWNA FUNKCJA WYKONYWANIA RZUTÓW
   * ===================================================================
   * 
   * Uniwersalna funkcja wykonująca rzuty dla umiejętności, wiedzy i atrybutów.
   * Implementuje pełną logikę systemu Neuroshima 1.5:
   * 
   * PROCES RZUTU:
   * 1. Ustal bazowy procent dla wybranego poziomu trudności
   * 2. Zastosuj modyfikator procentowy od użytkownika
   * 3. Określ finalny poziom trudności na podstawie procenta
   * 4. Zastosuj modyfikatory za poziom umiejętności/wiedzy
   * 5. Wykonaj rzut 3k20
   * 6. Sprawdź jedynki (1) i dwudziestki (20) - modyfikują trudność
   * 7. Oblicz finalne wartości i sukcesy
   * 
   * @param {Object} actor - Aktor wykonujący rzut
   * @param {String} rollName - Nazwa umiejętności/wiedzy/atrybutu
   * @param {Number} rollLevel - Poziom umiejętności/wiedzy (0 dla atrybutów)
   * @param {Number} attributeValue - Wartość atrybutu
   * @param {String} difficulty - Wybrany poziom trudności
   * @param {Object} difficultyMods - Mapy modyfikatorów poziomów (+2, 0, -2, -5, -8, -11, -15)
   * @param {String} testType - Typ testu ("open" lub "closed")
   * @param {String} rollType - Typ rzutu ("skill", "knowledge", "attribute")
   * @param {String} attributeKey - Klucz atrybutu (dla umiejętności)
   * @param {Number} percentageModifier - Dodatkowy modyfikator procentowy
   * @returns {Object} Obiekt Roll z wynikami w neuroshimaData
   */
  static async performRoll(actor, rollName, rollLevel, attributeValue, difficulty, difficultyMods, testType, rollType = 'skill', attributeKey = null, percentageModifier = 0) {
    if (shouldDebug()) console.log(`
=== NEUROSHIMA DICE ROLL START ===
Wykonuję ${testType} test dla ${rollType}: ${rollName}
${rollType === 'skill' ? `Atrybut: ${attributeKey} (${attributeValue}), Skill: ${rollLevel}` : ''}
${rollType === 'knowledge' ? `Wiedza: ${rollLevel}, Inteligencja: ${attributeValue}` : ''}
${rollType === 'attribute' ? `Test czystego atrybutu: ${attributeKey} (${attributeValue})` : ''}
Wybrany poziom trudności: ${difficulty}
Modyfikator procentowy: ${percentageModifier}%
`);
    
    // KROK 1: Oblicz bazowy procent dla wybranego poziomu trudności
    const baseDifficultyPercentage = this.getDifficultyBasePercentage(difficulty);
    if (shouldDebug()) console.log(`KROK 1: Bazowy procent poziomu ${difficulty}: ${baseDifficultyPercentage}%`);
    
    // Zachowaj oryginalny poziom trudności dla referencji
    const originalDifficulty = difficulty;
    const originalPercentage = baseDifficultyPercentage;
    
    // KROK 2: Zastosuj modyfikator procentowy od użytkownika
    let currentPercentage = baseDifficultyPercentage + percentageModifier;
    if (shouldDebug()) console.log(`KROK 2: Po zastosowaniu modyfikatora ${percentageModifier}%: ${currentPercentage}%`);
    
    // KROK 3: Określ finalny poziom trudności na podstawie procenta
    const percentageAdjustedDifficulty = this.getDifficultyFromPercentage(currentPercentage);
    if (shouldDebug()) console.log(`KROK 3: Poziom trudności po modyfikatorze procentowym: ${difficulty} → ${percentageAdjustedDifficulty}`);
    
    // KROK 4: Zastosuj modyfikatory za poziom umiejętności/wiedzy
    let levelAdjustedDifficulty;
    if (rollType === 'skill') {
      levelAdjustedDifficulty = this.adjustDifficultyBySkillLevel(percentageAdjustedDifficulty, rollLevel);
    } else if (rollType === 'knowledge') {
      levelAdjustedDifficulty = this.adjustDifficultyByKnowledgeLevel(percentageAdjustedDifficulty, rollLevel);
    } else if (rollType === 'attribute') {
      // Dla czystych testów atrybutów nie ma adjustmentu za poziom
      levelAdjustedDifficulty = percentageAdjustedDifficulty;
      if (shouldDebug()) console.log(`KROK 4: Test atrybutu - brak adjustmentu za poziom`);
    } else {
      levelAdjustedDifficulty = percentageAdjustedDifficulty; // fallback
    }
    
    if (shouldDebug()) console.log(`KROK 4: Poziom trudności po adjustmencie za poziom: ${percentageAdjustedDifficulty} → ${levelAdjustedDifficulty}`);
    
    // KROK 5: Wykonaj rzut 3k20 używając standardowego systemu Foundry
    // To zapewnia kompatybilność z modułami jak Dice So Nice
    // Używamy standardowego 3d20 dla obu typów testów (otwarty i zamknięty)
    let roll = new Roll("3d20", actor?.getRollData() || {});
    let rollResult = await roll.evaluate();
    
    // Animacja rzutu będzie wyświetlona później wraz z wynikami
    
    // Pobierz wyniki kości
    const diceResults = rollResult.terms[0].results.map(r => r.result);
    if (shouldDebug()) console.log(`KROK 5: Rzut 3k20: [${diceResults.join(', ')}]`);
    
    // KROK 6: Sprawdź jedynki (1) i dwudziestki (20)
    // Jedynki zawsze ułatwiają test (w obu typach)
    // Dwudziestki utrudniają tylko w testach otwartych
    const criticalSuccesses = diceResults.filter(result => result === 1).length;
    const criticalFailures = testType === "open" ? diceResults.filter(result => result === 20).length : 0;
    
    if (shouldDebug()) console.log(`KROK 6: Jedynki (łatwiej): ${criticalSuccesses}, Dwudziestki (trudniej): ${criticalFailures}${testType === "closed" ? " (test zamknięty - dwudziestki nie liczą się jako porażka)" : ""}`);
    
    // Zastosuj modyfikacje trudności od jedynek i dwudziestek
    let finalDifficulty = levelAdjustedDifficulty;
    const netCriticalAdjustment = criticalSuccesses - criticalFailures;
    
    if (netCriticalAdjustment !== 0) {
      if (shouldDebug()) console.log(`KROK 6: Adjustment od kości krytycznych: ${netCriticalAdjustment}`);
      finalDifficulty = this.adjustDifficultyByLevel(levelAdjustedDifficulty, -netCriticalAdjustment);
      if (shouldDebug()) console.log(`KROK 6: Finalny poziom trudności: ${levelAdjustedDifficulty} → ${finalDifficulty}`);
    }
    
    // KROK 7: Oblicz próg trudności (atrybut + modyfikator poziomu trudności)
    // UWAGA: Może być ujemny! (np. Fart z niskim atrybutem = ujemny próg)
    const difficultyModifier = difficultyMods[finalDifficulty];
    if (difficultyModifier === undefined) {
      console.error(`BŁĄD: Brak modyfikatora dla poziomu trudności: ${finalDifficulty}`);
      console.error(`Dostępne modyfikatory:`, Object.keys(difficultyMods));
    }
    const difficultyValue = attributeValue + (difficultyModifier || 0);
    if (shouldDebug()) console.log(`KROK 7: Próg trudności: ${attributeValue} + ${difficultyModifier || 0} = ${difficultyValue}${difficultyValue < 0 ? ' (UJEMNY!)' : ''}`);
    
    // KROK 8: Oblicz wyniki w zależności od typu testu
    let successCount = 0;
    let finalResult = 0;
    let reducedDice = [0, 0, 0];
    
    // Posortuj kości od najniższej do najwyższej
    const sortedDice = [...diceResults].sort((a, b) => a - b);
    
    if (testType === "open") {
      // === TEST OTWARTY ===
      // Używamy dwóch najniższych kości i redukujemy je poziomem umiejętności
      const lowestTwo = sortedDice.slice(0, 2);
      if (shouldDebug()) console.log(`TEST OTWARTY: Dwie najniższe kości: [${lowestTwo.join(', ')}]`);
      
      // Rozprowadź punkty umiejętności między kości
      let remainingPoints = rollLevel;
      if (shouldDebug()) console.log(`Punkty ${rollType} do rozprowadzenia: ${remainingPoints}`);
      
      reducedDice = [...lowestTwo];
      
      // Strategia redukcji: najpierw wyrównaj kości, potem redukuj obie równomiernie
      while (remainingPoints > 0) {
        if (shouldDebug()) console.log(`Pozostało punktów: ${remainingPoints}, Aktualne kości: [${reducedDice.join(', ')}]`);
        
        if (reducedDice[0] < reducedDice[1]) {
          // Redukuj wyższą kość
          reducedDice[1]--;
          remainingPoints--;
          if (shouldDebug()) console.log(`Redukcja wyższej kości: [${reducedDice.join(', ')}]`);
        } else {
          // Redukuj obie kości równomiernie
          if (remainingPoints >= 2) {
            reducedDice[0]--;
            reducedDice[1]--;
            remainingPoints -= 2;
            if (shouldDebug()) console.log(`Redukcja obu kości: [${reducedDice.join(', ')}]`);
          } else {
            // Zostało tylko 1 punkt - redukuj pierwszą kość
            reducedDice[0]--;
            remainingPoints--;
            if (shouldDebug()) console.log(`Redukcja pierwszej kości: [${reducedDice.join(', ')}]`);
          }
        }
        
        // Zabezpieczenie - kości nie mogą spaść poniżej 1
        reducedDice[0] = Math.max(1, reducedDice[0]);
        reducedDice[1] = Math.max(1, reducedDice[1]);
        
        // Jeśli obie kości są już na 1, przerwij
        if (reducedDice[0] === 1 && reducedDice[1] === 1) {
          if (shouldDebug()) console.log(`Obie kości osiągnęły minimum (1), przerywam redukcję`);
          break;
        }
      }
      
      if (shouldDebug()) console.log(`Finalne zredukowane kości: [${reducedDice.join(', ')}]`);
      
      // Wybierz WYŻSZĄ z dwóch zredukowanych kości jako finalny wynik
      finalResult = Math.max(reducedDice[0], reducedDice[1]);
      if (shouldDebug()) console.log(`Finalny wynik (wyższa z dwóch): ${finalResult}`);
      
      // Oblicz sukcesy (próg - wynik, może być ujemny jeśli próg ujemny lub wynik bardzo wysoki)
      successCount = difficultyValue - finalResult;
      if (shouldDebug()) console.log(`Sukcesy: ${difficultyValue} - ${finalResult} = ${successCount}${successCount < 0 ? ' (PORAŻKA)' : ''}`);
      
    } else {
      // === TEST ZAMKNIĘTY ===
      // Redukujemy wszystkie 3 kości poziomem umiejętności, potem liczymy ile <= próg
      if (shouldDebug()) console.log(`TEST ZAMKNIĘTY: Kości przed redukcją: [${diceResults.join(', ')}]`);
      
      // Kopiuj wszystkie kości do redukcji
      reducedDice = [...diceResults];
      let remainingPoints = rollLevel;
      if (shouldDebug()) console.log(`Punkty ${rollType} do rozprowadzenia: ${remainingPoints}`);
      
      // Strategia redukcji: redukuj najwyższe kości najpierw (aby zmaksymalizować szanse na sukces)
      while (remainingPoints > 0) {
        // Znajdź indeks najwyższej kości
        let maxIndex = 0;
        let maxValue = reducedDice[0];
        for (let i = 1; i < reducedDice.length; i++) {
          if (reducedDice[i] > maxValue) {
            maxValue = reducedDice[i];
            maxIndex = i;
          }
        }
        
        // Redukuj najwyższą kość
        if (reducedDice[maxIndex] > 1) {
          reducedDice[maxIndex]--;
          remainingPoints--;
          if (shouldDebug()) console.log(`Redukcja kości D${maxIndex + 1}: ${maxValue} → ${reducedDice[maxIndex]}, pozostało punktów: ${remainingPoints}`);
        } else {
          // Wszystkie kości są już na 1, przerwij
          if (shouldDebug()) console.log(`Wszystkie kości osiągnęły minimum (1), przerywam redukcję`);
          break;
        }
      }
      
      if (shouldDebug()) console.log(`Kości po redukcji: [${reducedDice.join(', ')}]`);
      if (shouldDebug()) console.log(`Sprawdzam kości przeciw progowi ${difficultyValue}${difficultyValue < 0 ? ' (UJEMNY!)' : ''}`);
      
      // Liczymy ile kości wypadło <= próg trudności
      for (let i = 0; i < reducedDice.length; i++) {
        if (reducedDice[i] <= difficultyValue) {
          successCount++;
          if (shouldDebug()) console.log(`Kość D${i + 1}: ${reducedDice[i]} <= ${difficultyValue} → SUKCES`);
        } else {
          if (shouldDebug()) console.log(`Kość D${i + 1}: ${reducedDice[i]} > ${difficultyValue} → PORAŻKA`);
        }
      }
      
      if (shouldDebug()) console.log(`Łączna liczba sukcesów: ${successCount}${difficultyValue < 0 && successCount === 0 ? ' (próg ujemny = brak sukcesów)' : ''}`);
    }
    
    // KROK 9: Przygotuj dane wyniku dla Foundry
    // Wszystkie informacje o rzucie są przechowywane w neuroshimaData
    roll.neuroshimaData = {
      // === PODSTAWOWE DANE RZUTU ===
      rollType: rollType,                                    // 'skill', 'knowledge', 'attribute'
      rollName: rollName,                                     // Nazwa tego co testujemy
      testType: testType,                                     // 'open' lub 'closed'
      
      // === WYNIKI KOŚCI ===
      diceResults: diceResults,                               // [x, y, z] - surowe wyniki 3k20
      lowestTwo: testType === "open" ? sortedDice.slice(0, 2) : [], // Dwie najniższe (dla testu otwartego)
      reducedDice: reducedDice,                               // Kości po redukcji (test otwarty)
      finalResult: finalResult,                               // Finalny wynik (test otwarty)
      
      // === WARTOŚCI TESTOWE ===
      rollLevel: rollLevel,                                   // Poziom umiejętności/wiedzy
      attributeValue: attributeValue,                         // Wartość atrybutu
      difficultyValue: difficultyValue,                       // Próg trudności (atrybut + mod)
      successCount: successCount,                             // Liczba sukcesów
      
      // === KRYTYCZNE KOŚCI ===
      criticalSuccesses: criticalSuccesses,                   // Liczba jedynek
      criticalFailures: criticalFailures,                     // Liczba dwudziestek
      
      // === POZIOMY TRUDNOŚCI (ŚLAD ZMIAN) ===
      initialDifficulty: originalDifficulty,                  // Oryginalnie wybrany poziom
      percentageAdjustedDifficulty: percentageAdjustedDifficulty, // Po modyfikatorze %
      levelAdjustedDifficulty: levelAdjustedDifficulty,       // Po modyfikatorze za poziom
      difficulty: finalDifficulty,                            // Finalny poziom trudności
      
      // === PROCENTY ===
      originalPercentage: originalPercentage,                 // Bazowy % oryginalnego poziomu
      currentPercentage: currentPercentage,                   // % po modyfikatorze użytkownika
      finalPercentage: this.getDifficultyBasePercentage(finalDifficulty), // % finalnego poziomu
      percentageModifier: percentageModifier,                 // Modyfikator % od użytkownika
      
      // === DODATKOWE DANE SPECYFICZNE DLA TYPU ===
      ...(rollType === 'skill' && {
        skillName: rollName,
        skillValue: rollLevel,
        attributeKey: attributeKey
      }),
      ...(rollType === 'knowledge' && {
        knowledgeName: rollName,
        knowledgeLevel: rollLevel
      }),
      ...(rollType === 'attribute' && {
        attributeName: rollName,
        attributeKey: attributeKey
      })
    };
    
    if (shouldDebug()) console.log(`
=== NEUROSHIMA DICE ROLL COMPLETE ===
Finalny wynik: ${successCount} sukcesów
Poziom trudności: ${originalDifficulty} → ${finalDifficulty}
Procent: ${originalPercentage}% → ${currentPercentage}%
Rzut: [${diceResults.join(', ')}] → ${testType === 'open' ? `[${reducedDice.join(', ')}] → ${finalResult}` : `${successCount} sukcesów`}
`);
    
    return roll;
  }
}