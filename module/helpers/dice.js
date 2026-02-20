import { NEUROSHIMA } from "../config.js";

/**
 * Helper class for Neuroshima 1.5 dice rolling logic.
 */
export class NeuroshimaDice {
  /**
   * Perform a weapon-specific roll (shooting or striking).
   */
  static async rollWeaponTest(params) {
    const { weapon, actor, aimingLevel, burstLevel, difficulty, hitLocation, modifier, applyArmor, applyWounds, isOpen, skillBonus = 0, attributeBonus = 0, distance = 0 } = params;
    
    // Rozpoczęcie grupy logów dla rzutu bronią
    game.neuroshima.group("Inicjalizacja rzutu bronią");
    game.neuroshima.log("Parametry wejściowe rzutu:", params);

    let bulletSequence = [];
    
    // 1. Kalkulacja kar procentowych (trudność bazowa, rany, pancerz, lokacja)
    const basePenalty = NEUROSHIMA.difficulties[difficulty]?.min || 0;
    const armorPenalty = applyArmor ? (actor.system.combat?.totalArmorPenalty || 0) : 0;
    const woundPenalty = applyWounds ? (actor.system.combat?.totalWoundPenalty || 0) : 0;
    
    const locationPenalty = this.getLocationPenalty(weapon.system.weaponType, hitLocation);
    const totalPenalty = basePenalty + modifier + armorPenalty + woundPenalty + locationPenalty;

    game.neuroshima.log("Kalkulacja kar (%)", {
        basePenalty,
        modifier,
        armorPenalty,
        woundPenalty,
        locationPenalty,
        totalPenalty
    });

    // 2. Obsługa celowania i liczby kości
    // Broń dystansowa: 1-3 kości w zależności od poziomu celowania (wybieramy najlepszą).
    // Walka wręcz: Zawsze 3 kości (zasada testu 3k20).
    const isMelee = weapon.system.weaponType === "melee";
    const diceCount = isMelee ? 3 : (aimingLevel + 1);
    
    // Wykonanie rzutu kośćmi
    const roll = new Roll(`${diceCount}d20`);
    await roll.evaluate();
    
    // Pobranie wyników i wyznaczenie najlepszej kości (najniższej)
    const results = roll.terms[0].results.map(r => r.result);
    const bestResult = Math.min(...results);

    // Finalny stan otwartości testu (melee może być otwarte lub zamknięte zgodnie z wyborem)
    const finalIsOpen = isOpen;

    game.neuroshima.log("Wyniki rzutu kośćmi", {
        weaponType: weapon.system.weaponType,
        diceCount,
        results,
        bestResult,
        finalIsOpen
    });

    // 3. Obsługa lokacji trafienia (losowanie jeśli wybrano 'random')
    let finalLocation = hitLocation;
    let locationRoll = null;
    if (hitLocation === "random") {
        locationRoll = await new Roll("1d20").evaluate();
        const rollVal = locationRoll.total;
        const entry = Object.entries(NEUROSHIMA.bodyLocations).find(([key, data]) => {
            return rollVal >= data.roll[0] && rollVal <= data.roll[1];
        });
        finalLocation = entry ? entry[0] : "torso";
        game.neuroshima.log("Wylosowano lokację trafienia", { rzut: rollVal, lokacja: finalLocation });
    }

    // 4. Obsługa serii (liczba wystrzelonych pocisków)
    let bulletsFired = this.getBulletsFired(weapon, burstLevel);
    const burstLabel = game.i18n.localize(NEUROSHIMA.burstLabels[burstLevel] || NEUROSHIMA.burstLabels[0]);

    game.neuroshima.log("Planowanie serii strzałów", { bulletsFired, typSerii: burstLabel });

    // 4.1. Obsługa magazynka i konsumpcja amunicji (LIFO)
    let ammoDamage = weapon.system.damage;
    let ammoPiercing = weapon.system.piercing || 0;
    let ammoJamming = weapon.system.jamming || 20;
    
    const magazineId = weapon.system.magazine;
    const magazine = magazineId ? actor.items.get(magazineId) : null;
    
    const isRanged = weapon.system.weaponType === "ranged";
    const isThrown = weapon.system.weaponType === "thrown";

    // Walidacja dostępności amunicji dla broni dystansowej
    if ((isRanged || isThrown) && !magazine) {
        if (weapon.system.caliber) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoMagazineSelected"));
            game.neuroshima.log("Rzut przerwany: brak wybranego magazynka");
            game.neuroshima.groupEnd();
            return;
        }
    }

    // Pobieranie pocisków z magazynka i aktualizacja jego stanu (tylko informacyjnie przed rzutem)
    let magazineUpdateData = null;
    if (magazine && magazine.type === "magazine") {
        game.neuroshima.log("Planowanie pobrania pocisków z magazynka (LIFO)");
        const contents = JSON.parse(JSON.stringify(magazine.system.contents || []));
        let remainingToConsume = bulletsFired;
        const consumedAmmo = [];
        
        while (remainingToConsume > 0 && contents.length > 0) {
            const topStack = contents[contents.length - 1];
            const toTake = Math.min(remainingToConsume, topStack.quantity);
            
            consumedAmmo.push({
                name: topStack.name,
                quantity: toTake,
                overrides: topStack.overrides
            });
            
            topStack.quantity -= toTake;
            remainingToConsume -= toTake;
            
            if (topStack.quantity <= 0) contents.pop();
        }
        
        // Aktualizacja liczby faktycznie wystrzelonych pocisków (jeśli magazynek był zbyt pusty)
        const actualFired = bulletsFired - remainingToConsume;
        bulletsFired = actualFired;
        magazineUpdateData = contents;

        // Budowanie sekwencji pocisków z uwzględnieniem nadpisań statystyk (amunicja specjalna)
        const newSequence = [];
        for (const consumed of consumedAmmo) {
            for (let i = 0; i < consumed.quantity; i++) {
                newSequence.push({
                    name: consumed.name,
                    damage: consumed.overrides?.enabled && consumed.overrides.damage ? consumed.overrides.damage : weapon.system.damage,
                    piercing: consumed.overrides?.enabled && consumed.overrides.piercing !== null ? consumed.overrides.piercing : (weapon.system.piercing || 0),
                    jamming: consumed.overrides?.enabled && consumed.overrides.jamming !== null ? consumed.overrides.jamming : (weapon.system.jamming || 20),
                    isPellet: !!consumed.overrides?.isPellet,
                    pelletCount: consumed.overrides?.isPellet ? (consumed.overrides.pelletCount || 1) : 1,
                    pelletRanges: consumed.overrides?.isPellet ? consumed.overrides.pelletRanges : null
                });
            }
        }
        bulletSequence = newSequence;
        
        // Pierwszy pocisk w serii definiuje bazowe statystyki rzutu, 
        // ale zacięcie jest brane z najgorszej (najniższej) wartości w serii.
        if (bulletSequence.length > 0) {
            const firstBullet = bulletSequence[0];
            ammoDamage = firstBullet.damage;
            ammoPiercing = firstBullet.piercing;
            const seqJamming = bulletSequence.map(b => b.jamming);
            ammoJamming = seqJamming.length > 0 ? Math.min(...seqJamming) : (weapon.system.jamming || 20);

            game.neuroshima.log("Parametry amunicji w serii", { damage: ammoDamage, piercing: ammoPiercing, jamming: ammoJamming });
        }
        
        if (remainingToConsume > 0) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.OutOfAmmoDuringBurst"));
        }
    } else if (weapon.system.weaponType === "thrown" && magazineId) {
        // Specjalna obsługa łuków/procy (amunicja bezpośrednio z ekwipunku)
        const ammoItem = actor.items.get(magazineId);
        if (ammoItem && ammoItem.type === "ammo") {
            if (ammoItem.system.quantity > 0) {
                if (ammoItem.system.isOverride) {
                    if (ammoItem.system.overrideDamage) ammoDamage = ammoItem.system.damage;
                    if (ammoItem.system.overridePiercing) ammoPiercing = ammoItem.system.piercing;
                    if (ammoItem.system.overrideJamming) ammoJamming = ammoItem.system.jamming;
                }
                
                bulletSequence = [{
                    name: ammoItem.name,
                    damage: (ammoItem.system.isOverride && ammoItem.system.overrideDamage) ? ammoItem.system.damage : weapon.system.damage,
                    piercing: (ammoItem.system.isOverride && ammoItem.system.overridePiercing) ? ammoItem.system.piercing : (weapon.system.piercing || 0),
                    jamming: (ammoItem.system.isOverride && ammoItem.system.overrideJamming) ? ammoItem.system.jamming : (weapon.system.jamming || 20),
                    isPellet: !!ammoItem.system.isPellet,
                    pelletCount: ammoItem.system.isPellet ? (ammoItem.system.pelletCount || 1) : 1,
                    pelletRanges: ammoItem.system.isPellet ? ammoItem.system.pelletRanges : null
                }];
                bulletsFired = 1;
            } else {
                ui.notifications.warn(game.i18n.format("NEUROSHIMA.Notifications.OutOfAmmo", { name: ammoItem.name }));
                bulletsFired = 0;
            }
        }
    }

    // 5. Rozstrzygnięcie sukcesu
    const weaponJammingValue = weapon.system.jamming || 20;
    const jammingThreshold = Math.min(weaponJammingValue, ammoJamming);
    // Zacięcie sprawdzamy na podstawie NAJLEPSZEJ kości (najniższy wynik) przed jakąkolwiek modyfikacją przez umiejętność.
    const isJamming = isMelee ? false : (bestResult >= jammingThreshold);

    // Konsumpcja amunicji tylko jeśli broń się NIE zacięła
    if (!isJamming) {
        if (magazine && magazine.type === "magazine" && magazineUpdateData) {
            await magazine.update({ "system.contents": magazineUpdateData });
            game.neuroshima.log("Amunicja zużyta (brak zacięcia)");
        } else if (weapon.system.weaponType === "thrown" && magazineId && bulletsFired > 0) {
            const ammoItem = actor.items.get(magazineId);
            if (ammoItem && ammoItem.type === "ammo") {
                await ammoItem.update({ "system.quantity": ammoItem.system.quantity - 1 });
                game.neuroshima.log("Amunicja miotana zużyta (brak zacięcia)");
            }
        }
    } else {
        game.neuroshima.log("ZACIĘCIE: Amunicja NIE została zużyta");
    }

    // Wyznaczenie ostatecznej trudności po uwzględnieniu Suwaka
    const baseDifficulty = this.getDifficultyFromPercent(totalPenalty);
    
    let skillValue = 0;
    const skillKey = weapon.system.skill;
    if (skillKey) skillValue = (actor.system.skills[skillKey]?.value || 0) + skillBonus;
    
    // Obliczanie przesunięć (Suwak)
    let totalShift = 0;
    const allowCombatShift = game.settings.get("neuroshima", "allowCombatShift");
    if (allowCombatShift) {
        totalShift += this.getSkillShift(skillValue);
        totalShift += this.getDiceShift(results);
    }

    const shiftedDifficulty = this._getShiftedDifficulty(baseDifficulty, totalShift);
    const finalDiff = shiftedDifficulty;
    
    // Próg sukcesu (Współczynnik + modyfikator PT + bonus do atrybutu)
    const baseAttr = actor.system.attributes[weapon.system.attribute] || 10;
    const finalStat = baseAttr + attributeBonus;
    const target = finalStat + finalDiff.mod;

    game.neuroshima.log("Kalkulacja trudności i Suwaka", {
        bazowaTrudnosc: baseDifficulty.label,
        przesuniecieSuwaka: totalShift,
        ostatecznaTrudnosc: finalDiff.label,
        progSukcesu: target,
        skillValue,
        finalStat
    });

    let modifiedResults = [];
    let isSuccess = false;
    let successPoints = 0;
    let successCount = 0;
    let hitBullets = 0;

    let totalPelletSP = 0;

    // Ewaluacja wyników w zależności od typu broni (Melee = 3k20, Ranged = Najlepsza z X)
    if (isMelee) {
        game.neuroshima.log("Rozpoczynam ewaluację Walki Wręcz (3k20)");
        const diceObjects = results.map((v, i) => ({
            original: v,
            index: i,
            modified: v,
            isSuccess: false,
            ignored: false
        }));

        const evalData = { target, skill: skillValue };
        
        if (finalIsOpen) {
            this._evaluateOpenTest(evalData, diceObjects);
            successPoints = evalData.successPoints;
            isSuccess = evalData.success;
        } else {
            this._evaluateClosedTest(evalData, diceObjects);
            successPoints = evalData.success ? 1 : 0;
            isSuccess = evalData.success;
            successCount = evalData.successCount;
        }
        modifiedResults = evalData.modifiedResults;
        
        if (isSuccess) hitBullets = 1;
    } else {
        game.neuroshima.log("Rozpoczynam ewaluację Broni Dystansowej (Najlepsza kość)");
        modifiedResults = results.map((v, i) => {
            const modified = Math.max(1, v - skillValue);
            const succ = finalIsOpen ? (target - modified >= 0) : (modified <= target && v !== 20);
            return {
                original: v,
                modified: modified,
                isSuccess: succ,
                isBest: v === bestResult,
                isNat1: v === 1,
                isNat20: v === 20,
                index: i
            };
        });

        // Punkty Przewagi dla broni dystansowej: Target - (Najlepsza kość - Skill)
        const modifiedBest = Math.max(1, bestResult - skillValue);
        const overflow = target - modifiedBest;
        
        if (finalIsOpen) {
            isSuccess = overflow >= 0;
            successPoints = overflow;
        } else {
            isSuccess = modifiedBest <= target && bestResult !== 20;
            successPoints = isSuccess ? 1 : 0;
        }

        // Liczba sukcesów dla celów serii i śrutu (PP + 1)
        const pp = isSuccess ? (overflow + 1) : 0;

        // 5.1 Ewaluacja trafień w serii (Indywidualna dla każdego pocisku)
        if (isSuccess && !isJamming) {
            const finalHitSequence = [];
            const usePelletCountLimit = game.settings.get("neuroshima", "usePelletCountLimit");
            let totalPelletHits = 0;

            // Iterujemy po wszystkich wystrzelonych pociskach (łuskach)
            for (let j = 0; j < bulletsFired; j++) {
                // Pocisk j-ty trafia tylko jeśli nasze Punkty Przewagi (pp) są większe od j
                if (pp <= j) break; 

                const bullet = bulletSequence[j];
                if (!bullet) break;

                if (bullet.isPellet) {
                    // LOGIKA ŚRUTU dla tej konkretnej łuski
                    const basePelletDamage = this.getPelletDamageAtDistance(bullet.pelletRanges, distance);
                    
                    // Każdy kolejny pocisk w serii (j) redukuje maksymalną liczbę śrucin o j.
                    // pp - j to liczba dostępnych punktów przewagi dla tego konkretnego pocisku.
                    const capacityPenalty = j;
                    const maxPelletsInShell = Math.max(0, (bullet.pelletCount || 1) - capacityPenalty);
                    
                    // Liczba śrucin to mniejsza z wartości: pozostałe PP lub aktualna pojemność łuski
                    let pelletsForThisShell = Math.max(0, pp - j);
                    
                    // Zawsze ograniczamy do fizycznej liczby śrucin w łusce (pomniejszonej o karę serii)
                    // oraz opcjonalnie stosujemy limit jeśli ustawienie jest włączone.
                    if (usePelletCountLimit || pelletsForThisShell > maxPelletsInShell) {
                        pelletsForThisShell = Math.min(pelletsForThisShell, maxPelletsInShell);
                    }

                    if (pelletsForThisShell > 0) {
                        totalPelletHits += pelletsForThisShell;
                        finalHitSequence.push({
                            ...bullet,
                            damage: basePelletDamage,
                            successPoints: pelletsForThisShell,
                            shellIndex: j + 1
                        });
                    }
                } else {
                    // LOGIKA STANDARDOWEGO POCISKU
                    finalHitSequence.push({
                        ...bullet,
                        successPoints: 1, 
                        shellIndex: j + 1
                    });
                }
            }

            // Aktualizacja danych rzutu
            hitBullets = finalHitSequence.length;
            totalPelletSP = totalPelletHits;
            bulletSequence = finalHitSequence;
        } else {
            hitBullets = 0;
            totalPelletSP = 0;
        }
    }

    game.neuroshima.log("Wynik końcowy testu", { isSuccess, successPoints, isJamming, hitBullets, jammingOnDie: results[0] });

    // 6. Przygotowanie danych do karty czatu
    const damageValue = isMelee 
        ? [weapon.system.damageMelee1, weapon.system.damageMelee2, weapon.system.damageMelee3].filter(d => d).join("/")
        : ammoDamage;

    const rollData = {
        label: weapon.name,
        actionLabel: burstLabel,
        isWeapon: true,
        isMelee,
        weaponId: weapon.id,
        actorId: actor.id,
        damage: damageValue,
        piercing: ammoPiercing,
        isJamming,
        bestResult,
        modifiedResults,
        results,
        target,
        skill: skillValue,
        baseSkill: skillValue - skillBonus,
        skillBonus: skillBonus,
        baseStat: finalStat - attributeBonus,
        attributeBonus: attributeBonus,
        stat: finalStat,
        isSuccess,
        successPoints,
        hitBullets,
        totalPelletSP: totalPelletSP || 0,
        isPellet: !!bulletSequence[0]?.isPellet,
        isOpen: finalIsOpen,
        finalLocation,
        locationLabel: NEUROSHIMA.bodyLocations[finalLocation]?.label || finalLocation,
        locationRoll: locationRoll?.total,
        bulletsFired,
        totalPenalty,
        difficultyLabel: finalDiff.label,
        isCritSuccess: bestResult === 1,
        isCritFailure: (bestResult === 20 || isJamming),
        showTooltip: true,
        burstLevel,
        aimingLevel,
        debugMode: game.settings.get("neuroshima", "debugMode"),
        penalties: {
            mod: modifier,
            armor: armorPenalty,
            wounds: woundPenalty,
            location: locationPenalty,
            base: basePenalty
        },
        bulletSequence: bulletSequence || [],
        hitBulletsData: (isSuccess && !isJamming) ? (bulletSequence.length > 0 ? bulletSequence.slice(0, hitBullets) : []) : []
    };

    // Obsługa różnej amunicji w jednej serii (wyświetlanie wielu statystyk)
    this._groupHitsData(rollData);

    game.neuroshima.log("Generowanie karty czatu", rollData);
    game.neuroshima.groupEnd();

    return this.renderWeaponRollCard(rollData, actor, roll);
  }

  /**
   * Grupuje trafienia o tych samych obrażeniach i przebiciu dla lepszej czytelności.
   * @private
   */
  static _groupHitsData(rollData) {
    if (!rollData.hitBulletsData || rollData.hitBulletsData.length === 0) return;
    
    const hits = rollData.hitBulletsData;
    
    // Grupowanie obrażeń
    const counts = hits.reduce((acc, h) => {
        acc[h.damage] = (acc[h.damage] || 0) + 1;
        return acc;
    }, {});
    
    rollData.damage = Object.entries(counts)
        .map(([damage, count]) => hits.length > 1 ? `${count}x${damage}` : damage)
        .join(", ");

    // Grupowanie przebicia
    const pCounts = hits.reduce((acc, h) => {
        acc[h.piercing] = (acc[h.piercing] || 0) + 1;
        return acc;
    }, {});
    
    rollData.piercing = Object.entries(pCounts)
        .map(([piercing, count]) => hits.length > 1 ? `${count}x${piercing}` : piercing)
        .join(", ");
  }

  /**
   * Determine pellet damage based on distance.
   * @param {Object} ranges 
   * @param {Number} distance 
   * @returns {String}
   */
  static getPelletDamageAtDistance(ranges, distance) {
    if (!ranges) return "D";
    
    const r1 = ranges.range1;
    const r2 = ranges.range2;
    const r3 = ranges.range3;
    const r4 = ranges.range4;

    if (distance <= r1.distance) return r1.damage;
    if (distance <= r2.distance) return r2.damage;
    if (distance <= r3.distance) return r3.damage;
    if (distance <= r4.distance) return r4.damage;
    
    return "D"; // Default if beyond all ranges
  }

  /**
   * Render standard roll result to chat.
   */
  static async renderRollCard(data, actor, roll) {
    const template = "systems/neuroshima/templates/chat/roll-card.hbs";
    const showTooltip = this.canShowTooltip(actor);

    const content = await foundry.applications.handlebars.renderTemplate(template, {
        ...data,
        config: NEUROSHIMA,
        showTooltip
    });

    return ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content,
        rolls: [roll],
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        flags: {
            neuroshima: {
                rollData: {
                    isWeapon: false,
                    actorId: actor?.id,
                    isOpen: data.isOpen,
                    results: data.rawResults,
                    rawResults: data.rawResults,
                    totalPenalty: data.totalPenalty,
                    penalties: data.penalties,
                    target: data.target,
                    skill: data.skill,
                    skillBonus: data.skillBonus,
                    attributeBonus: data.attributeBonus,
                    baseSkill: data.baseSkill,
                    baseStat: data.baseStat,
                    difficultyLabel: data.difficultyLabel,
                    baseDifficultyLabel: data.baseDifficultyLabel,
                    label: data.label,
                    isDebug: data.isDebug
                }
            }
        }
    });
  }

  /**
   * Render weapon roll result to chat.
   */
  static async renderWeaponRollCard(data, actor, roll) {
    const template = "systems/neuroshima/templates/chat/weapon-roll-card.hbs";
    const showTooltip = this.canShowTooltip(actor);

    const content = await foundry.applications.handlebars.renderTemplate(template, {
        ...data,
        config: NEUROSHIMA,
        showTooltip,
        damageTooltipLabel: this.getDamageTooltip(data.damage)
    });

    return ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content,
        rolls: [roll],
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        flags: {
            neuroshima: {
                rollData: {
                    isWeapon: true,
                    isMelee: data.isMelee,
                    weaponId: data.weaponId,
                    actorId: actor?.id,
                    isOpen: data.isOpen,
                    results: data.results,
                    totalPenalty: data.totalPenalty,
                    penalties: data.penalties,
                    target: data.target,
                    skill: data.skill,
                    skillBonus: data.skillBonus,
                    attributeBonus: data.attributeBonus,
                    baseSkill: data.baseSkill,
                    baseStat: data.baseStat,
                    difficultyLabel: data.difficultyLabel,
                    finalLocation: data.finalLocation,
                    locationRoll: data.locationRoll,
                    bulletsFired: data.bulletsFired,
                    hitBullets: data.hitBullets,
                    hitBulletsData: data.hitBulletsData,
                    totalPelletSP: data.totalPelletSP,
                    isPellet: data.isPellet,
                    distance: data.distance,
                    damage: data.damage,
                    jamming: data.isJamming,
                    burstLevel: data.burstLevel,
                    aimingLevel: data.aimingLevel,
                    label: data.label
                }
            }
        }
    });
  }

  /**
   * Calculate PT (difficulty modifier) based on total percentage penalty.
   * @param {number} percent 
   * @returns {Object} The difficulty object from config
   */
  static getDifficultyFromPercent(percent) {
    const diffs = Object.values(NEUROSHIMA.difficulties);
    // Find the first difficulty where percent falls into [min, max]
    const found = diffs.find(d => percent >= d.min && percent <= d.max);
    
    if (found) return found;
    
    // Fallback for values outside defined ranges
    if (percent < 0) return NEUROSHIMA.difficulties.easy;
    return NEUROSHIMA.difficulties.grandmasterfull;
  }

  /**
   * Main entry point for performing a Neuroshima roll.
   * @param {Object} params
   * @param {number} params.stat - Base attribute value
   * @param {number} params.skill - Skill level (points to subtract from dice)
   * @param {Object} [params.penalties] - Detailed percentage penalties
   * @param {number} [params.penalties.mod=0] - General modifier penalty
   * @param {number} [params.penalties.wounds=0] - Wounds penalty
   * @param {number} [params.penalties.armor=0] - Armor penalty
   * @param {boolean} [params.isOpen=false] - Whether this is an Open Test
   * @param {boolean} [params.isCombat=false] - Whether this is a combat action (shooting, hitting, etc.)
   * @param {boolean} [params.isDebug=false] - Whether this is a debug roll
   * @param {number[]} [params.fixedDice] - Fixed dice results for debugging
   * @param {string} [params.label] - Label for the roll
   * @param {Object} [params.actor] - The actor performing the roll
   * @param {number} [params.skillBonus=0] - Additional bonus to skill
   * @param {number} [params.attributeBonus=0] - Additional bonus to attribute
   */
  static async rollTest({ stat, skill = 0, penalties = { mod: 0, wounds: 0, armor: 0 }, isOpen = false, isCombat = false, isDebug = false, fixedDice = null, label = "", actor = null, skillBonus = 0, attributeBonus = 0 } = {}) {
    // Rozpoczęcie grupy logów dla testu standardowego
    game.neuroshima.group(`Inicjalizacja testu: ${label || "Standard"}`);
    
    const finalSkill = skill + skillBonus;
    const finalStat = stat + attributeBonus;

    // 1. Obliczanie całkowitej kary i trudności bazowej
    const totalPenalty = (penalties.mod || 0) + (penalties.wounds || 0) + (penalties.armor || 0);
    const baseDifficulty = this.getDifficultyFromPercent(totalPenalty);
    
    // 2. Wykonanie rzutu 3k20
    const roll = new Roll("3d20");
    await roll.evaluate();

    // Obsługa rzutów wymuszonych (do celów debugowania)
    if (fixedDice && fixedDice.length === 3) {
        roll.terms[0].results.forEach((r, i) => {
            r.result = fixedDice[i];
        });
        roll._total = roll.terms[0].results.reduce((acc, r) => acc + r.result, 0);
    }
    
    const rawResults = roll.terms[0].results.map(r => r.result);
    
    // Przygotowanie obiektów kości do dalszej obróbki
    const dice = rawResults.map((v, i) => ({
        original: v,
        index: i,
        modified: v,
        isSuccess: false,
        ignored: false
    }));

    // 3. Obliczanie przesunięć trudności (Suwak)
    let totalShift = 0;
    const allowCombatShift = game.settings.get("neuroshima", "allowCombatShift");
    
    // Suwak umiejętności i kości (naturalne 1 i 20)
    if (!isCombat || allowCombatShift) {
        totalShift -= this.getSkillShift(finalSkill);
        totalShift += this.getDiceShift(rawResults);
    }

    const shiftedDifficulty = this._getShiftedDifficulty(baseDifficulty, totalShift);
    const ptMod = shiftedDifficulty.mod;
    
    // Ostateczny próg sukcesu (Atrybut + PT)
    const target = finalStat + ptMod;

    game.neuroshima.log("Parametry testu", { stat: finalStat, skill: finalSkill, kary: totalPenalty, prog: target, suwak: totalShift });
    game.neuroshima.log("Surowe wyniki kości", rawResults);

    let rollData = {
      label,
      stat: finalStat,
      skill: finalSkill,
      skillBonus,
      attributeBonus,
      baseStat: stat,
      baseSkill: skill,
      penalties,
      totalPenalty,
      baseDifficultyLabel: baseDifficulty.label,
      difficultyLabel: shiftedDifficulty.label,
      ptMod,
      target,
      isOpen,
      isCombat,
      isDebug,
      rawResults,
      isCritSuccess: false,
      isCritFailure: false,
      isGM: game.user.isGM
    };

    // 4. Ewaluacja testu w zależności od typu (Otwarty / Zamknięty)
    if (isOpen) {
      game.neuroshima.log("Ewaluacja: TEST OTWARTY");
      this._evaluateOpenTest(rollData, dice);
    } else {
      game.neuroshima.log("Ewaluacja: TEST ZAMKNIĘTY");
      this._evaluateClosedTest(rollData, dice);
    }

    game.neuroshima.log("Wyniki po modyfikacji (użycie umiejętności)", rollData.modifiedResults);
    game.neuroshima.groupEnd();

    await this.renderRollCard(rollData, actor, roll);
    return roll;
  }

  /**
   * Wyznacza przesunięty poziom trudności na podstawie Suwaka.
   * @private
   */
  static _getShiftedDifficulty(base, shift) {
    const order = ["easy", "average", "problematic", "hard", "veryHard", "damnHard", "luck", "masterfull", "grandmasterfull"];
    const baseKey = Object.keys(NEUROSHIMA.difficulties).find(key => NEUROSHIMA.difficulties[key].label === base.label);
    let index = order.indexOf(baseKey);
    
    if (index === -1) index = 1; // Domyślnie przeciętny
    
    let shiftedIndex = Math.clamp(index + shift, 0, order.length - 1);
    return NEUROSHIMA.difficulties[order[shiftedIndex]];
  }

  /**
   * Logika Testu Zamkniętego (Standardowego).
   * Sukces następuje, gdy co najmniej 2 kości są mniejsze lub równe progowi (target)
   * po optymalnym rozdzieleniu punktów umiejętności.
   */
  static _evaluateClosedTest(data, diceObjects) {
    const { target, skill } = data;
    
    // Kopia kości posortowana według wyników dla łatwiejszej analizy kosztów
    const sorted = [...diceObjects].sort((a, b) => a.original - b.original);

    // 1. Sukcesy: kupujemy brakujące sukcesy (najtańsze najpierw)
    sorted.forEach(d => {
        d.cost = d.original <= target ? 0 : (d.original === 20 ? 999 : d.original - target);
    });
    sorted.sort((a, b) => a.cost - b.cost);
    
    let tempSkill = skill;
    sorted.forEach(d => {
        // Możemy wydać punkty, aby osiągnąć target, ale nie możemy zejść poniżej 1.
        const maxSpendTo1 = Math.max(0, d.original - 1);
        const spent = tempSkill > 0 ? Math.min(tempSkill, d.cost, maxSpendTo1) : 0;
        tempSkill -= spent;
        d.modified = d.original - spent;
        d.isSuccess = d.modified <= target && d.original !== 20;
        d.isNat1 = d.original === 1;
        d.isNat20 = d.original === 20;
    });

    // 2. Optymalizacja: jeśli zostały punkty umiejętności, rozdzielamy je na kości sukcesu
    // aby obniżyć ich wyniki (równomiernie), co pozwala osiągać lepsze rezultaty (np. 3 sukcesy zamiast 2).
    if (tempSkill > 0) {
        const successfulDice = sorted.filter(d => d.isSuccess && d.original !== 1);
        while (tempSkill > 0 && successfulDice.some(d => d.modified > 1)) {
            successfulDice.sort((a, b) => b.modified - a.modified);
            const highest = successfulDice[0];
            if (!highest || highest.modified <= 1) break;
            highest.modified -= 1;
            tempSkill -= 1;
        }
    }

    // Przywrócenie oryginalnej kolejności kości dla karty czatu
    data.modifiedResults = [...diceObjects].sort((a, b) => a.index - b.index);

    // Test jest zdany, jeśli co najmniej 2 kości odniosły sukces
    const successes = data.modifiedResults.filter(r => r.isSuccess).length;
    data.successCount = successes;
    data.success = successes >= 2;
    data.skillUsed = skill - tempSkill;
    data.remainingSkill = tempSkill;
    
    // Krytyki (wszystkie kości sukcesem lub brak sukcesów z pechem)
    data.isCritSuccess = successes === 3;
    data.isCritFailure = successes === 0 && diceObjects.some(d => d.original === 20);
  }

  /**
   * Logika Testu Otwartego.
   * Ignorujemy najwyższy (najgorszy) wynik, a punkty umiejętności wydajemy
   * na zminimalizowanie wyższego z dwóch pozostałych wyników.
   */
  static _evaluateOpenTest(data, diceObjects) {
    const { target, skill } = data;
    
    // Sortowanie kości w celu znalezienia najgorszego wyniku
    const sorted = [...diceObjects].sort((a, b) => a.original - b.original);
    
    // Ignorowanie najwyższej kości (najgorszy wynik)
    sorted[2].ignored = true;
    sorted[2].isSuccess = false;
    game.neuroshima.log(`_evaluateOpenTest: Ignoruję kość D${sorted[2].index + 1} (${sorted[2].original}). Pula: ${skill}`);

    // Pobranie dwóch lepszych kości
    let d1 = sorted[0];
    let d2 = sorted[1];
    
    let tempSkill = skill;
    
    // Optymalizacja: chcemy zminimalizować wyższy z dwóch pozostałych wyników.
    // Krok 1: Zbijamy gorszą kość (d2) do poziomu lepszej kości (d1).
    const diff = d2.original - d1.original;
    const maxSpendTo1_d2 = Math.max(0, d2.original - 1);
    const spentToMatch = tempSkill > 0 ? Math.min(tempSkill, diff, maxSpendTo1_d2) : 0;
    d2.modified = d2.original - spentToMatch;
    tempSkill -= spentToMatch;
    if (spentToMatch > 0) {
        game.neuroshima.log(`_evaluateOpenTest: Krok 1 - Wydano ${spentToMatch} pkt na wyrównanie kości D${d2.index + 1} (${d2.original} -> ${d2.modified})`);
    }

    // Krok 2: Jeśli zostały punkty umiejętności, obniżamy obie kości po równo.
    if (tempSkill > 0) {
        // Obliczamy ile maksymalnie możemy wydać na każdą kość aby nie spadła poniżej 1
        const maxSpend_d1 = Math.max(0, d1.original - 1);
        const maxSpend_d2 = Math.max(0, d2.modified - 1);
        
        // Obniżamy obie o tyle ile się da, nie przekraczając tempSkill
        let spentOnBoth = 0;
        while (tempSkill > 0 && (d1.modified > 1 || d2.modified > 1)) {
            if (d1.modified > 1 && tempSkill > 0) {
                d1.modified -= 1;
                tempSkill -= 1;
                spentOnBoth += 1;
            }
            if (d2.modified > 1 && tempSkill > 0) {
                d2.modified -= 1;
                tempSkill -= 1;
                spentOnBoth += 1;
            }
        }
        
        if (spentOnBoth > 0) {
            game.neuroshima.log(`_evaluateOpenTest: Krok 2 - Wydano ${spentOnBoth} pkt na redukcję obu kości: D${d1.index + 1} (${d1.original} -> ${d1.modified}), D${d2.index + 1} (${d2.original} -> ${d2.modified})`);
        }
    } else if (tempSkill === skill) {
        d1.modified = d1.original;
        d2.modified = d2.original;
    }

    // Sukces na kościach otwartego testu
    d1.isSuccess = d1.modified <= target;
    d2.isSuccess = d2.modified <= target;

    // Flagi naturalnych wyników
    diceObjects.forEach(d => {
        d.isNat1 = d.original === 1;
        d.isNat20 = d.original === 20;
    });

    // Punkty Przewagi to różnica między progiem a gorszą z dwóch kości
    const finalHigherDie = Math.max(d1.modified, d2.modified);
    const successPoints = target - finalHigherDie;
    
    data.successPoints = successPoints;
    data.success = successPoints >= 0;
    
    // Przywrócenie kolejności kości
    data.modifiedResults = [...diceObjects].sort((a, b) => a.index - b.index);
  }

  /**
   * Helper to calculate skill shift (Suwak).
   */
  static getSkillShift(skill) {
    if (skill <= 0) return 0;
    return Math.floor(skill / 4);
  }

  /**
   * Helper to calculate dice shift based on Nat 1s and Nat 20s.
   */
  static getDiceShift(results) {
    let shift = 0;
    results.forEach(r => {
        if (r === 1) shift -= 1;
        if (r === 20) shift += 1;
    });
    return shift;
  }

  /**
   * Get formatted damage string for tooltip.
   */
  static getDamageTooltip(damage) {
    if (!damage) return "";
    const types = damage.split(",").map(d => d.trim().split("x").pop());
    const uniqueTypes = [...new Set(types)];
    
    return uniqueTypes.map(t => {
        const config = NEUROSHIMA.woundConfiguration[t];
        return config ? game.i18n.localize(config.fullLabel) : t;
    }).join(" / ");
  }

  /**
   * Check if current user can see detailed roll breakdown.
   */
  static canShowTooltip(actor) {
    const minRole = game.settings.get("neuroshima", "rollTooltipMinRole");
    const ownerVisibility = game.settings.get("neuroshima", "rollTooltipOwnerVisibility");
    
    if (game.user.role >= minRole) return true;
    if (ownerVisibility && (actor?.isOwner || game.user.isGM)) return true;
    
    return false;
  }

  /**
   * Calculate number of bullets fired based on weapon ROF and burst level.
   */
  static getBulletsFired(weapon, burstLevel) {
    const rof = weapon.system.fireRate || 1;
    switch (parseInt(burstLevel)) {
        case 1: return rof; // Short
        case 2: return rof * 3; // Long
        case 3: return rof * 6; // Full
        default: return 1; // Single
    }
  }

  /**
   * Calculate location penalty based on weapon type and location key.
   */
  static getLocationPenalty(weaponType, locationKey) {
    if (locationKey === "random" || locationKey === "torso") return 0;
    const locData = NEUROSHIMA.bodyLocations[locationKey];
    if (!locData) return 0;
    
    return locData.modifiers[weaponType] || 0;
  }

  /**
   * Re-evaluate a roll message (e.g. switching between Open/Closed test).
   */
  static async updateRollMessage(message, isOpen) {
    const flags = message.getFlag("neuroshima", "rollData");
    if (!flags) return;

    const actor = game.actors.get(flags.actorId);
    if (!actor) return;

    const results = flags.results || flags.rawResults;
    if (!results) return;

    const skillValue = flags.skill;
    const target = flags.target;

    let successPoints = 0;
    let successCount = 0;
    let isSuccess = false;
    let modifiedResults = [];
    let hitBullets = 0;
    let totalPelletSP = 0;

    const isWeapon = flags.isWeapon;
    const isMelee = flags.isMelee;

    // Standard Roll or Melee weapon (both use 3 dice and pool points)
    if (!isWeapon || isMelee) {
        const diceObjects = results.map((v, i) => ({
            original: v,
            index: i,
            modified: v,
            isSuccess: false,
            ignored: false
        }));

        const evalData = { target, skill: skillValue };
        if (isOpen) {
            this._evaluateOpenTest(evalData, diceObjects);
            successPoints = evalData.successPoints;
            isSuccess = evalData.success;
        } else {
            this._evaluateClosedTest(evalData, diceObjects);
            successCount = evalData.successCount;
            successPoints = evalData.success ? 1 : 0;
            isSuccess = evalData.success;
        }
        modifiedResults = evalData.modifiedResults;
        if (isWeapon && isSuccess) hitBullets = 1;
    } else {
        // Ranged/Thrown weapon logic
        const bestResult = Math.min(...results);
        modifiedResults = results.map((v, i) => {
            const modified = Math.max(1, v - skillValue);
            const succ = isOpen ? (target - modified >= 0) : (modified <= target && v !== 20);
            return {
                original: v,
                modified: modified,
                isSuccess: succ,
                isBest: v === bestResult,
                isNat1: v === 1,
                isNat20: v === 20,
                index: i
            };
        });

        const modifiedBest = Math.max(1, bestResult - skillValue);
        const overflow = target - modifiedBest;
        
        if (isOpen) {
            isSuccess = overflow >= 0;
            successPoints = overflow;
        } else {
            isSuccess = modifiedBest <= target && bestResult !== 20;
            successPoints = isSuccess ? 1 : 0;
            successCount = isSuccess ? 1 : 0;
        }

        const pp = isSuccess ? (overflow + 1) : 0;
        const isJamming = flags.jamming;

        if (isSuccess && !isJamming) {
            const finalHitSequence = [];
            const usePelletCountLimit = game.settings.get("neuroshima", "usePelletCountLimit");
            let totalPelletHits = 0;
            const originalSequence = flags.hitBulletsData || [];

            for (let j = 0; j < flags.bulletsFired; j++) {
                if (pp <= j) break;
                
                const bullet = originalSequence[j] || originalSequence[0]; 
                if (!bullet) break;

                if (bullet.isPellet) {
                    const pelletsForThisShell = usePelletCountLimit 
                        ? Math.clamp(pp - j, 0, bullet.pelletCount || 1) 
                        : (pp - j);

                    if (pelletsForThisShell > 0) {
                        totalPelletHits += pelletsForThisShell;
                        finalHitSequence.push({
                            ...bullet,
                            successPoints: pelletsForThisShell,
                            shellIndex: j + 1
                        });
                    }
                } else {
                    finalHitSequence.push({
                        ...bullet,
                        successPoints: 1,
                        shellIndex: j + 1
                    });
                }
            }
            hitBullets = finalHitSequence.length;
            totalPelletSP = totalPelletHits;
        }
    }

    const updatedData = foundry.utils.mergeObject(flags, {
        isOpen,
        isSuccess,
        successPoints,
        successCount,
        modifiedResults,
        hitBullets,
        totalPelletSP
    });

    const template = isWeapon 
        ? "systems/neuroshima/templates/chat/weapon-roll-card.hbs"
        : "systems/neuroshima/templates/chat/roll-card.hbs";

    const content = await foundry.applications.handlebars.renderTemplate(template, {
        ...updatedData,
        config: NEUROSHIMA,
        showTooltip: this.canShowTooltip(actor),
        damageTooltipLabel: isWeapon ? this.getDamageTooltip(updatedData.damage) : ""
    });

    await message.update({ content, flags: { neuroshima: { rollData: updatedData } } });
  }

  /**
   * Measures distance between two points/tokens in world units (meters).
   */
  static measureDistance(p1, p2) {
    if (!p1 || !p2) return 0;
    
    let pos1 = p1.center || p1;
    let pos2 = p2.center || p2;

    // Obsługa formatu tablicowego [x, y] (częsty w V13 canvas.grid)
    if (Array.isArray(pos1)) pos1 = { x: pos1[0], y: pos1[1] };
    if (Array.isArray(pos2)) pos2 = { x: pos2[0], y: pos2[1] };
    
    // W Foundry V13 najlepszym sposobem na pomiar zgodny z linijką (Ruler)
    // jest użycie canvas.grid.measurePath.
    const path = [{x: pos1.x, y: pos1.y}, {x: pos2.x, y: pos2.y}];
    let distance = 0;
    
    try {
        const measureResult = canvas.grid.measurePath(path);
        distance = measureResult.distance;

        // Logowanie szczegółowe dla debugowania
        if (game.settings.get("neuroshima", "debugMode")) {
            console.group("Neuroshima 1.5 | measureDistance Debug (V13)");
            console.log("Pozycja 1:", pos1);
            console.log("Pozycja 2:", pos2);
            console.log("Wynik measurePath:", measureResult);
            console.log("Skala sceny (grid):", canvas.grid.size, "px =", canvas.grid.distance, "m");
            console.groupEnd();
        }
    } catch (e) {
        console.error("Neuroshima 1.5 | Błąd podczas pomiaru dystansu:", e);
        // Fallback do prostego pomiaru euklidesowego
        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const pixelDist = Math.sqrt(dx*dx + dy*dy);
        const gridSize = canvas.grid.size || 100;
        const gridDist = canvas.grid.distance || 2;
        distance = (pixelDist / gridSize) * gridDist;
    }
    
    return Math.round(distance * 10) / 10;
  }
}
