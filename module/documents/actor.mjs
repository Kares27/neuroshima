/**
 * Extend the base Actor document by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */

import { reduceDiceResults, reduceSingleDie } from "../helpers/utils.mjs";

export class NeuroshimaActor extends Actor {

  /** @override */
  prepareData() {
    // Prepare data for the actor. Calling the super version of this executes
    // the following, in order: data reset (to clear active effects),
    // prepareBaseData(), prepareEmbeddedDocuments() (including active effects),
    // prepareDerivedData().
    super.prepareData();
  }

  /** @override */
  prepareBaseData() {
    // Data modifications in this step occur before processing embedded
    // documents or derived data.
  }

  /**
   * @override
   * Augment the basic actor data with additional dynamic data. Typically,
   * you'll want to handle most of your calculated/derived data in this step.
   * Data calculated in this step should generally not exist in template.json
   * (such as ability modifiers rather than ability scores) and should be
   * available both inside and outside of character sheets (such as if an actor
   * is queried and has a roll executed directly from a macro).
   */
  prepareDerivedData() {
    const actorData = this;
    const systemData = actorData.system;
    const flags = actorData.flags.neuroshima || {};

    // Make separate methods for each Actor type (character, npc, etc.) to keep
    // things organized.
    this._prepareCharacterData(actorData);
    this._prepareNpcData(actorData);
  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    if (actorData.type !== 'character') return;

    // Make modifications to data here. For example:
    const systemData = actorData.system;

    // Oblicz modyfikatory atrybutów i poziomy trudności
    if (systemData.attributes) {
      for (let [key, attribute] of Object.entries(systemData.attributes)) {
        // Oblicz poziomy trudności dla każdego atrybutu
        attribute.difficulties = this._calculateDifficultyLevels(attribute.value + attribute.mod);
      }
    }

    // Oblicz łączną wartość doświadczenia
    if (systemData.experience) {
      systemData.experience.current = systemData.experience.total - systemData.experience.spent;
    }

    // Upewnij się, że wounds i otherEffects są tablicami i wartości numeryczne są poprawne
    if (systemData.health) {
      if (!Array.isArray(systemData.health.wounds)) {
        systemData.health.wounds = [];
      }
      if (!Array.isArray(systemData.health.otherEffects)) {
        systemData.health.otherEffects = [];
      }
      
      // Upewnij się, że health values są liczbami
      if (typeof systemData.health.value !== 'number') {
        systemData.health.value = parseInt(systemData.health.value) || 0;
      }
      if (typeof systemData.health.max !== 'number') {
        systemData.health.max = parseInt(systemData.health.max) || 27;
      }
    }

    // Upewnij się, że armor values są liczbami
    if (systemData.armor) {
      systemData.armor.head = parseInt(systemData.armor.head) || 0;
      systemData.armor.torso = parseInt(systemData.armor.torso) || 0;
      systemData.armor.leftHand = parseInt(systemData.armor.leftHand) || 0;
      systemData.armor.rightHand = parseInt(systemData.armor.rightHand) || 0;
      systemData.armor.leftLeg = parseInt(systemData.armor.leftLeg) || 0;
      systemData.armor.rightLeg = parseInt(systemData.armor.rightLeg) || 0;
    }
  }

  /**
   * Prepare NPC type specific data.
   */
  _prepareNpcData(actorData) {
    if (actorData.type !== 'npc') return;

    // Make modifications to data here. For example:
    const systemData = actorData.system;
  }

  /**
   * Oblicza poziomy trudności dla danej wartości atrybutu
   */
  _calculateDifficultyLevels(attributeValue) {
    const difficulties = CONFIG.NEUROSHIMA.difficultyLevels;
    const levels = {};
    
    for (let [key, difficulty] of Object.entries(difficulties)) {
      levels[key] = {
        name: difficulty.name,
        value: Math.max(1, attributeValue + difficulty.modifier),
        modifier: difficulty.modifier,
        percentage: difficulty.percentage
      };
    }
    
    return levels;
  }

  /**
   * Override getRollData() that's supplied to rolls.
   */
  getRollData() {
    const data = super.getRollData();

    // Prepare character roll data.
    this._getCharacterRollData(data);
    this._getNpcRollData(data);

    return data;
  }

  /**
   * Prepare character roll data.
   */
  _getCharacterRollData(data) {
    if (this.type !== 'character') return;

    // Copy the ability scores to the top level, so that rolls can use
    // formulas like `@str.mod + 4`.
    if (data.attributes) {
      for (let [k, v] of Object.entries(data.attributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
    }

    // Add level for easier access, or fall back to 0.
    if (data.attributes.level) {
      data.lvl = data.attributes.level.value ?? 0;
    }
  }

  /**
   * Prepare NPC roll data.
   */
  _getNpcRollData(data) {
    if (this.type !== 'npc') return;

    // Process additional NPC data here.
  }

  /**
   * Wykonuje test otwarty na umiejętność lub atrybut
   */
  async rollOpenTest(attribute, skill = null, difficulty = 'przecietny') {
    const attributeData = this.system.attributes[attribute];
    let skillLevel = 0;
    
    if (skill) {
      if (skill === 'wiedza') {
        // Specjalna obsługa wiedzy - użyj pierwszego dostępnego poziomu
        const wiedza = this.system.skills[attribute].wiedza;
        skillLevel = Math.max(wiedza.poziom1, wiedza.poziom2, wiedza.poziom3, wiedza.poziom4, wiedza.poziom5, wiedza.poziom6);
      } else {
        skillLevel = this.system.skills[attribute][skill] || 0;
      }
    }
    
    let threshold = attributeData.value + attributeData.mod + skillLevel;

    // Konwertuj klucz trudności na polski format (na wypadek gdyby przekazano angielski)
    difficulty = this._convertDifficultyKeyToPolish(difficulty);

    // Modyfikator trudności (z reguły dotyczącej umiejętności podzielnych przez 4)
    let difficultyLevel = difficulty;
    if (skillLevel > 0) {
      const difficultyReduction = Math.floor(skillLevel / 4);
      const difficultyKeys = Object.keys(CONFIG.NEUROSHIMA.difficultyLevels);
      const currentIndex = difficultyKeys.indexOf(difficulty);
      const newIndex = Math.max(0, currentIndex - difficultyReduction);
      difficultyLevel = difficultyKeys[newIndex];
    }

    const difficultyMod = CONFIG.NEUROSHIMA.difficultyLevels[difficultyLevel].modifier;
    threshold += difficultyMod;

    // Rzut 3k20
    const roll = new Roll("3d20");
    await roll.evaluate();
    
    const dice = roll.terms[0].results.map(r => r.result).sort((a, b) => a - b);
    
    return this._processOpenTest(dice, threshold, skillLevel, difficultyLevel);
  }

  /**
   * Wykonuje test zamknięty na umiejętność lub atrybut
   */
  async rollClosedTest(attribute, skill = null, difficulty = 'przecietny') {
    const attributeData = this.system.attributes[attribute];
    let skillLevel = 0;
    
    if (skill) {
      if (skill === 'wiedza') {
        // Specjalna obsługa wiedzy - użyj pierwszego dostępnego poziomu
        const wiedza = this.system.skills[attribute].wiedza;
        skillLevel = Math.max(wiedza.poziom1, wiedza.poziom2, wiedza.poziom3, wiedza.poziom4, wiedza.poziom5, wiedza.poziom6);
      } else {
        skillLevel = this.system.skills[attribute][skill] || 0;
      }
    }
    
    let threshold = attributeData.value + attributeData.mod + skillLevel;

    // Konwertuj klucz trudności na polski format (na wypadek gdyby przekazano angielski)
    difficulty = this._convertDifficultyKeyToPolish(difficulty);

    // Modyfikator trudności (z reguły dotyczącej umiejętności podzielnych przez 4)
    let difficultyLevel = difficulty;
    if (skillLevel > 0) {
      const difficultyReduction = Math.floor(skillLevel / 4);
      const difficultyKeys = Object.keys(CONFIG.NEUROSHIMA.difficultyLevels);
      const currentIndex = difficultyKeys.indexOf(difficulty);
      const newIndex = Math.max(0, currentIndex - difficultyReduction);
      difficultyLevel = difficultyKeys[newIndex];
    }

    const difficultyMod = CONFIG.NEUROSHIMA.difficultyLevels[difficultyLevel].modifier;
    threshold += difficultyMod;

    // Rzut 3k20
    const roll = new Roll("3d20");
    await roll.evaluate();
    
    const dice = roll.terms[0].results.map(r => r.result);
    
    return this._processClosedTest(dice, threshold, difficultyLevel);
  }

  /**
   * Przetwarza wyniki testu otwartego
   */
  _processOpenTest(dice, threshold, skillLevel, finalDifficulty) {
    // Usuń najwyższą kość
    const sortedDice = [...dice].sort((a, b) => b - a);
    const workingDice = sortedDice.slice(1); // Usuń pierwszą (najwyższą)
    
    // Sprawdź jedynki i dwudziestki
    let difficultyAdjustment = 0;
    dice.forEach(die => {
      if (die === 1) difficultyAdjustment -= 1; // Łatwiej
      if (die === 20) difficultyAdjustment += 1; // Trudniej
    });

    // Zastosuj redukcję z poziomu umiejętności
    let reductionPoints = skillLevel;
    let finalDice = [...workingDice];
    
    if (reductionPoints > 0) {
      // Zredukuj wyniki kości
      finalDice = reduceDiceResults(workingDice, reductionPoints);
    }

    // Oblicz sukcesy (zgodnie z regułami - bierzemy najwyższą z dwóch najniższych kości)
    const highestOfWorking = Math.max(...finalDice);
    const successes = Math.max(0, threshold - highestOfWorking);
    
    return {
      dice: dice,
      workingDice: finalDice,
      threshold: threshold,
      successes: successes,
      difficultyAdjustment: difficultyAdjustment,
      finalDifficulty: finalDifficulty,
      skillLevel: skillLevel
    };
  }

  /**
   * Przetwarza wyniki testu zamkniętego
   */
  _processClosedTest(dice, threshold, finalDifficulty) {
    // Sprawdź jedynki i dwudziestki
    let difficultyAdjustment = 0;
    dice.forEach(die => {
      if (die === 1) difficultyAdjustment -= 1;
      if (die === 20) difficultyAdjustment += 1;
    });

    // Oblicz sukcesy - ile kości jest poniżej progu
    const successes = dice.filter(die => die <= threshold).length;
    
    return {
      dice: dice,
      threshold: threshold,
      successes: successes,
      difficultyAdjustment: difficultyAdjustment,
      finalDifficulty: finalDifficulty
    };
  }



  /**
   * Wykonuje rzut bronią białą (test zamknięty z redukcją kości)
   * @param {Item} weapon - Przedmiot broni
   * @param {string} attribute - Atrybut (np. 'zr')
   * @param {string} skill - Umiejętność (np. 'bijatyka')
   * @param {string} difficulty - Poziom trudności
   * @param {number} percentageModifier - Modyfikator procentowy (łącznie z karami)
   * @param {string} actionType - 'attack' lub 'defense'
   * @param {string} hitLocation - Klucz lokacji trafienia ('random', 'head', 'torso', etc.)
   * @returns {Promise<Object>} Wynik rzutu
   */
  async rollMeleeWeapon(weapon, attribute, skill, difficulty, percentageModifier = 0, actionType = 'attack', hitLocation = 'random') {
    const attributeData = this.system.attributes[attribute];
    const skillLevel = this.system.skills[attribute][skill] || 0;
    
    // Obsługa lokacji trafienia
    let actualLocation = null;
    let locationModifier = 0;
    
    if (hitLocation === 'random') {
      // Losuj lokację
      actualLocation = await this._rollHitLocation();
      locationModifier = 0; // Losowanie nie daje kary
    } else {
      // Użyj wybranej lokacji
      const locationData = CONFIG.NEUROSHIMA.hitLocations[hitLocation];
      actualLocation = {
        key: hitLocation,
        name: locationData.name,
        roll: null
      };
      locationModifier = locationData.meleeModifier;
    }
    
    // Przelicz poziom trudności z uwzględnieniem modyfikatorów procentowych i lokacji
    const baseDifficultyPercentage = this._getDifficultyPercentage(difficulty);
    const finalPercentage = baseDifficultyPercentage + percentageModifier + locationModifier;
    const finalDifficulty = this._getDifficultyFromPercentage(finalPercentage);
    
    // Pobierz bonus z broni w zależności od typu akcji
    const weaponBonus = actionType === 'attack' ? (weapon.system.bonusAttack || 0) : (weapon.system.bonusDefense || 0);
    
    // Konwertuj klucz trudności na polski format
    const polishDifficultyKey = this._convertDifficultyKeyToPolish(finalDifficulty);
    
    // Oblicz próg (współczynnik + modyfikator współczynnika + poziom umiejętności + modyfikator trudności + bonus broni)
    const difficultyMod = CONFIG.NEUROSHIMA.difficultyLevels[polishDifficultyKey]?.modifier || 0;
    const threshold = attributeData.value + attributeData.mod + skillLevel + difficultyMod + weaponBonus;

    // Rzut 3k20 (test zamknięty)
    const roll = new Roll('3d20');
    await roll.evaluate();
    
    const dice = roll.terms[0].results.map(r => r.result);
    
    // Sprawdź nat 1 i nat 20 dla zmiany poziomu trudności
    let difficultyAdjustment = 0;
    dice.forEach(die => {
      if (die === 1) difficultyAdjustment -= 1; // Łatwiej
      if (die === 20) difficultyAdjustment += 1; // Trudniej
    });

    // Redukcja kości w teście zamkniętym
    const reductionAmount = skillLevel > 0 ? Math.floor(skillLevel / 4) : 0;
    const reducedDice = reductionAmount > 0 ? reduceDiceResults(dice, reductionAmount) : [...dice];
    
    // Policz sukcesy (każda zredukowana kość <= próg = 1 sukces)
    const successes = reducedDice.filter(die => die <= threshold).length;
    
    // Określ typ obrażeń na podstawie liczby sukcesów (tylko dla ataku)
    let damageType = null;
    if (actionType === 'attack' && successes > 0) {
      if (successes >= 3) {
        damageType = weapon.system.damage.threeSuccess;
      } else if (successes >= 2) {
        damageType = weapon.system.damage.twoSuccess;
      } else if (successes >= 1) {
        damageType = weapon.system.damage.oneSuccess;
      }
      
      // Zwiększ poziom obrażeń o 1 przy trafieniu w głowę
      damageType = this._adjustDamageForHeadshot(damageType, actualLocation.key);
    }
    
    return {
      roll: roll,
      dice: dice,
      reducedDice: reducedDice,
      threshold: threshold,
      successes: successes,
      difficultyAdjustment: difficultyAdjustment,
      finalDifficulty: finalDifficulty,
      skillLevel: skillLevel,
      reductionAmount: reductionAmount,
      weaponBonus: weaponBonus,
      actionType: actionType,
      damageType: damageType,
      hitLocation: actualLocation,
      locationModifier: locationModifier,
      // Składniki progu dla wyświetlenia
      attributeValue: attributeData.value,
      attributeMod: attributeData.mod,
      difficultyMod: difficultyMod
    };
  }

  /**
   * Wykonuje rzut bronią zasięgową
   * @param {Item} weapon - Obiekt broni
   * @param {string} attribute - Atrybut (np. 'zr')
   * @param {string} skill - Umiejętność (np. 'karabiny')
   * @param {string} difficulty - Poziom trudności
   * @param {number} aimingLevel - Poziom celowania (0-2)
   * @param {number} burstLevel - Poziom serii (0-3)
   * @param {number} rateOfFire - Szybkostrzelność broni
   * @param {number} percentageModifier - Modyfikator procentowy (łącznie z karami)
   * @param {string} hitLocation - Klucz lokacji trafienia ('random', 'head', 'torso', etc.)
   * @returns {Promise<Object>} Wynik rzutu
   */
  async rollRangedWeapon(weapon, attribute, skill, difficulty, aimingLevel = 0, burstLevel = 0, rateOfFire = 1, percentageModifier = 0, hitLocation = 'random') {
    const attributeData = this.system.attributes[attribute];
    const skillLevel = this.system.skills[attribute][skill] || 0;
    
    // Obsługa lokacji trafienia
    let actualLocation = null;
    let locationModifier = 0;
    
    if (hitLocation === 'random') {
      // Losuj lokację
      actualLocation = await this._rollHitLocation();
      locationModifier = 0; // Losowanie nie daje kary
    } else {
      // Użyj wybranej lokacji
      const locationData = CONFIG.NEUROSHIMA.hitLocations[hitLocation];
      actualLocation = {
        key: hitLocation,
        name: locationData.name,
        roll: null
      };
      locationModifier = locationData.rangedModifier;
    }
    
    // Przelicz poziom trudności z uwzględnieniem modyfikatorów procentowych i lokacji
    const baseDifficultyPercentage = this._getDifficultyPercentage(difficulty);
    const finalPercentage = baseDifficultyPercentage + percentageModifier + locationModifier;
    const finalDifficulty = this._getDifficultyFromPercentage(finalPercentage);
    
    // Konwertuj klucz trudności na polski format
    const polishDifficultyKey = this._convertDifficultyKeyToPolish(finalDifficulty);
    
    // Oblicz próg (współczynnik + modyfikator współczynnika + modyfikator trudności)
    // UWAGA: NIE dodajemy poziomu umiejętności do progu (w przeciwieństwie do testów otwartych/zamkniętych)
    // UWAGA: Nie stosujemy redukcji trudności przez umiejętność/4
    const difficultyMod = CONFIG.NEUROSHIMA.difficultyLevels[polishDifficultyKey]?.modifier || 0;
    const threshold = attributeData.value + attributeData.mod + difficultyMod;

    // Oblicz liczbę kości (1 + celowanie)
    const numDice = 1 + aimingLevel;
    
    // Rzut kośćmi
    const roll = new Roll(`${numDice}d20`);
    await roll.evaluate();
    
    const dice = roll.terms[0].results.map(r => r.result);
    
    // Sprawdź nat 1 i nat 20 dla zmiany poziomu trudności
    let difficultyAdjustment = 0;
    dice.forEach(die => {
      if (die === 1) difficultyAdjustment -= 1; // Łatwiej
      if (die === 20) difficultyAdjustment += 1; // Trudniej
    });

    // Redukuj każdą kość punktami umiejętności (tylko do progu, nie niżej)
    // Jeśli wynik > próg: redukuj do progu (używając tylko potrzebnych punktów)
    // Jeśli wynik <= próg: nie redukuj (zostaw jak jest)
    const reducedDice = dice.map(die => {
      if (die > threshold) {
        // Redukuj tylko do progu (nie niżej)
        return Math.max(threshold, die - skillLevel);
      } else {
        // Już poniżej progu, nie redukuj
        return die;
      }
    });
    
    // Policz sukcesy (każda zredukowana kość <= próg = 1 sukces)
    const successes = reducedDice.filter(die => die <= threshold).length;
    
    // Oblicz Punkty Sukcesu (PS) - tylko dla najlepszej kości która trafiła
    // PS = threshold - reducedDie (dla najniższej zredukowanej kości która trafiła)
    let successPoints = 0;
    const hitDice = reducedDice.filter(die => die <= threshold);
    if (hitDice.length > 0) {
      const bestHit = Math.min(...hitDice); // Najniższa kość = najlepsze trafienie
      successPoints = threshold - bestHit;
    }
    
    // Oblicz liczbę pocisków na podstawie serii i szybkostrzelności
    // Seria 0 = zawsze 1 pocisk (pojedynczy strzał)
    // Seria 1+ = mnożnik × rateOfFire
    let bulletsFired;
    if (burstLevel === 0) {
      bulletsFired = 1; // Pojedynczy strzał zawsze 1 pocisk
    } else {
      const bulletsMultiplier = [1, 1, 3, 6]; // Seria 0=1, 1=1, 2=3, 3=6
      bulletsFired = bulletsMultiplier[burstLevel] * rateOfFire;
    }
    
    // Oblicz liczbę trafień
    let bulletsHit = 0;
    
    if (successes > 0) {
      if (burstLevel === 0) {
        // Pojedynczy strzał - zawsze 1 trafienie jeśli sukces
        bulletsHit = 1;
      } else {
        // Strzał serią - zastosuj mechanikę serii (po redukcji kości umiejętnościami):
        // 1. Jeśli wynik był POWYŻEJ progu i zredukowano go umiejętnościami DO progu:
        //    Trafienia = floor(Ilość pocisków / 4)
        // 2. Jeśli wynik PONIŻEJ progu (naturalnie lub po częściowej redukcji):
        //    - Trafienia podstawowe = (Próg - Wynik kości) + 1
        //    - Trafienia z serii = floor((Ilość pocisków - Trafienia podstawowe) / 4)
        //    - Razem = Trafienia podstawowe + Trafienia z serii
        
        // Znajdź najlepszą kość (najniższą po redukcji, która trafiła)
        const bestReducedDie = Math.min(...hitDice);
        
        // Znajdź oryginalną wartość tej kości (przed redukcją)
        const bestDieIndex = reducedDice.indexOf(bestReducedDie);
        const originalBestDie = dice[bestDieIndex];
        
        // Sprawdź czy kość była zredukowana umiejętnościami do progu
        if (originalBestDie > threshold && bestReducedDie === threshold) {
          // PRZYPADEK 1: Wynik był POWYŻEJ progu, ale zredukowano go umiejętnościami DO progu
          // Trafienia = floor(Ilość pocisków / 4)
          bulletsHit = Math.floor(bulletsFired / 4);
        } else {
          // PRZYPADEK 2: Wynik PONIŻEJ progu (naturalnie lub po częściowej redukcji)
          // Trafienia podstawowe = (Próg - Wynik kości) + 1
          const basicHits = (threshold - bestReducedDie) + 1;
          // Trafienia z serii = floor((Pozostałe pociski) / 4)
          const remainingBullets = bulletsFired - basicHits;
          const seriesHits = Math.max(0, Math.floor(remainingBullets / 4));
          // Razem
          bulletsHit = basicHits + seriesHits;
        }
        
        // Nigdy nie może być więcej trafień niż pocisków oddanych
        bulletsHit = Math.min(bulletsHit, bulletsFired);
      }
    }
    
    // Określ typ obrażeń (tylko jeśli trafiono)
    let damageType = null;
    if (bulletsHit > 0 && weapon.system.damage) {
      damageType = weapon.system.damage;
      
      // Zwiększ poziom obrażeń o 1 przy trafieniu w głowę
      damageType = this._adjustDamageForHeadshot(damageType, actualLocation.key);
    }
    
    return {
      roll: roll, // Dodaj obiekt Roll dla kompatybilności
      dice: dice,
      reducedDice: reducedDice,
      threshold: threshold,
      successes: successes,
      successPoints: successPoints, // Punkty Sukcesu (PS)
      bulletsHit: bulletsHit, // Liczba kul które trafiły w cel
      difficultyAdjustment: difficultyAdjustment,
      finalDifficulty: finalDifficulty,
      aimingLevel: aimingLevel,
      burstLevel: burstLevel,
      bulletsFired: bulletsFired,
      skillLevel: skillLevel,
      rateOfFire: rateOfFire,
      hitLocation: actualLocation,
      locationModifier: locationModifier,
      damageType: damageType
    };
  }

  /**
   * Konwertuje klucz trudności z angielskiego na polski
   * @param {string} difficulty - Klucz poziomu trudności (angielski lub polski)
   * @returns {string} Polski klucz poziomu trudności
   * @private
   */
  _convertDifficultyKeyToPolish(difficulty) {
    const keyMap = {
      'easy': 'latwy',
      'average': 'przecietny',
      'problematic': 'problematyczny',
      'hard': 'trudny',
      'veryHard': 'bardzo_trudny',
      'damnHard': 'cholernie_trudny',
      'luck': 'fart'
    };
    return keyMap[difficulty] || difficulty;
  }

  /**
   * Pobiera bazowy procent dla poziomu trudności
   * @param {string} difficulty - Klucz poziomu trudności (angielski lub polski)
   * @returns {number} Procent
   * @private
   */
  _getDifficultyPercentage(difficulty) {
    // Przetłumacz klucz jeśli jest angielski
    const polishKey = this._convertDifficultyKeyToPolish(difficulty);
    
    const percentageMap = {
      'latwy': -5,
      'przecietny': 5,
      'problematyczny': 20,
      'trudny': 45,
      'bardzo_trudny': 75,
      'cholernie_trudny': 105,
      'fart': 135
    };
    return percentageMap[polishKey] || 5;
  }

  /**
   * Określa poziom trudności na podstawie procentu
   * @param {number} percentage - Procent
   * @returns {string} Klucz poziomu trudności (angielski)
   * @private
   */
  _getDifficultyFromPercentage(percentage) {
    if (percentage >= 121) return 'luck';
    if (percentage >= 91) return 'damnHard';
    if (percentage >= 61) return 'veryHard';
    if (percentage >= 31) return 'hard';
    if (percentage >= 11) return 'problematic';
    if (percentage >= 0) return 'average';
    return 'easy';
  }

  /**
   * Losuje lokację trafienia na podstawie rzutu 1d20
   * @returns {Object} Obiekt z kluczem lokacji i nazwą
   * @private
   */
  async _rollHitLocation() {
    const roll = new Roll('1d20');
    await roll.evaluate();
    const result = roll.total;
    
    // Znajdź lokację na podstawie wyniku rzutu
    for (const [key, location] of Object.entries(CONFIG.NEUROSHIMA.hitLocations)) {
      if (key === 'random') continue;
      
      const [min, max] = location.diceRange;
      if (result >= min && result <= max) {
        return {
          key: key,
          name: location.name,
          roll: result
        };
      }
    }
    
    // Fallback na tułów (nie powinno się zdarzyć)
    return {
      key: 'torso',
      name: CONFIG.NEUROSHIMA.hitLocations.torso.name,
      roll: result
    };
  }

  /**
   * Zwiększa poziom obrażeń o 1 przy trafieniu w głowę
   * @param {string} damageType - Typ obrażeń (D, sD, L, sL, C, sC, K, sK)
   * @param {string} locationKey - Klucz lokacji trafienia
   * @returns {string} Zmodyfikowany typ obrażeń
   * @private
   */
  _adjustDamageForHeadshot(damageType, locationKey) {
    // Jeśli nie trafiono w głowę, zwróć oryginalny typ
    if (locationKey !== 'head') {
      return damageType;
    }
    
    // Mapa zwiększania poziomu obrażeń
    const damageProgression = {
      'D': 'L',    // Draśnięcie → Lekkie
      'sD': 'sL',  // Silne Draśnięcie → Silne Lekkie
      'L': 'C',    // Lekkie → Ciężkie
      'sL': 'sC',  // Silne Lekkie → Silne Ciężkie
      'C': 'K',    // Ciężkie → Krytyczne
      'sC': 'sK',  // Silne Ciężkie → Silne Krytyczne
      'K': 'K',    // Krytyczne → Krytyczne (maksymalny poziom)
      'sK': 'sK'   // Silne Krytyczne → Silne Krytyczne (maksymalny poziom)
    };
    
    return damageProgression[damageType] || damageType;
  }
}