import { NEUROSHIMA } from "../config.js";
import { NeuroshimaChatMessage } from "../documents/chat-message.js";

/**
 * Helper class for Neuroshima 1.5 dice rolling logic.
 */
export class NeuroshimaDice {
  /**
   * Perform a weapon-specific roll (shooting or striking).
   */
  static async rollWeaponTest(params) {
    const { weapon, actor, aimingLevel, burstLevel, difficulty, hitLocation, modifier, applyArmor, applyWounds, isOpen, skillBonus = 0, attributeBonus = 0, distance = 0, meleeAction = "attack" } = params;
    
    // Rozpoczęcie grupy logów dla rzutu bronią
    game.neuroshima.group("Inicjalizacja rzutu bronią");
    game.neuroshima.log("Parametry wejściowe rzutu:", params);

    let bulletSequence = [];
    
    // 1. Kalkulacja kar procentowych (trudność bazowa, rany, pancerz, lokacja)
    const basePenalty = NEUROSHIMA.difficulties[difficulty]?.min || 0;
    const armorPenalty = applyArmor ? (actor.system.combat?.totalArmorPenalty || 0) : 0;
    const woundPenalty = applyWounds ? (actor.system.combat?.totalWoundPenalty || 0) : 0;
    
    const isMelee = weapon.system.weaponType === "melee";
    
    // Weapon bonus for melee
    let weaponBonus = 0;
    if (isMelee) {
        weaponBonus = meleeAction === "attack" ? (weapon.system.attackBonus || 0) : (weapon.system.defenseBonus || 0);
    }

    const locationPenalty = this.getLocationPenalty(weapon.system.weaponType, hitLocation);
    const totalPenalty = basePenalty + modifier + armorPenalty + woundPenalty + locationPenalty;

    game.neuroshima.log("Kalkulacja kar (%)", {
        basePenalty,
        modifier,
        armorPenalty,
        woundPenalty,
        locationPenalty,
        totalPenalty,
        weaponBonus
    });

    // 2. Obsługa celowania i liczby kości
    // Broń dystansowa: 1-3 kości w zależności od poziomu celowania (wybieramy najlepszą).
    // Walka wręcz: Zawsze 3 kości (zasada testu 3k20).
    const diceCount = isMelee ? 3 : (aimingLevel + 1);
    
    // Obliczamy bazowe obrażenia (zostaną zaktualizowane później dla amunicji dystansowej)
    let damageValue = isMelee 
        ? [weapon.system.damageMelee1, weapon.system.damageMelee2, weapon.system.damageMelee3].filter(d => d).join("/")
        : (weapon.system.damage || "0");

    // Wykonanie rzutu kośćmi
    const roll = new Roll(`${diceCount}d20`);
    await roll.evaluate();
    
    // Pobranie wyników i wyznaczenie najlepszej kości (najniższej)
    const results = roll.terms[0].results.map(r => r.result);
    const bestResult = Math.min(...results);

    // Finalny stan otwartości testu (melee wymusza test zamknięty 3k20)
    let finalIsOpen = isOpen;
    if (isMelee) {
        finalIsOpen = false;
    }

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
            damageValue = ammoDamage;
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
                    if (ammoItem.system.overrideDamage) {
                        ammoDamage = ammoItem.system.damage;
                        damageValue = ammoDamage;
                    }
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
    
    // Próg sukcesu (Współczynnik + modyfikator PT + bonus do atrybutu + bonus broni)
    const baseAttr = actor.system.attributes[weapon.system.attribute] || 10;
    const finalStat = baseAttr + attributeBonus + weaponBonus;
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
    let finalHitSequence = [];

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
            // W trybie DICE dla melee, successPoints to liczba sukcesów (0-3)
            successPoints = evalData.successCount;
            isSuccess = evalData.successCount > 0;
            successCount = evalData.successCount;
        }
        modifiedResults = evalData.modifiedResults;
        
        if (isSuccess) {
            hitBullets = 1;
            finalHitSequence = [{
                damage: damageValue,
                piercing: ammoPiercing,
                successPoints: 1,
                isPellet: false
            }];
        }
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
                    // Ensure damage and piercing are explicitly preserved for different ammo types
                    const bulletDamage = bullet.damage !== undefined ? bullet.damage : ammoDamage;
                    const bulletPiercing = bullet.piercing !== undefined ? bullet.piercing : ammoPiercing;
                    
                    game.neuroshima.log(`Standardowy pocisk ${j + 1}`, {
                      bullet: bullet,
                      bulletDamage,
                      bulletPiercing,
                      fallbackDamage: ammoDamage,
                      fallbackPiercing: ammoPiercing
                    });
                    
                    finalHitSequence.push({
                        ...bullet,
                        damage: bulletDamage,
                        piercing: bulletPiercing,
                        successPoints: 1, 
                        shellIndex: j + 1
                    });
                }
            }

            // Aktualizacja danych rzutu
            hitBullets = finalHitSequence.length;
            totalPelletSP = totalPelletHits;
        } else {
            hitBullets = 0;
            totalPelletSP = 0;
        }
    }

    game.neuroshima.log("Wynik końcowy testu", { isSuccess, successPoints, isJamming, hitBullets, jammingOnDie: results[0] });

    // 6. Przygotowanie danych do karty czatu
    const rollData = {
        label: weapon.name,
        actionLabel: burstLabel,
        isWeapon: true,
        isMelee,
        meleeAction: isMelee ? (params.meleeAction || "attack") : null,
        damageMelee1: isMelee ? weapon.system.damageMelee1 : null,
        damageMelee2: isMelee ? weapon.system.damageMelee2 : null,
        damageMelee3: isMelee ? weapon.system.damageMelee3 : null,
        targets: isMelee ? (params.targets ?? []) : [],
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
        distance,
        debugMode: game.settings.get("neuroshima", "debugMode"),
        magazineId: (isRanged || isThrown) ? weapon.system.magazine : null,
        ammoId: (isThrown) ? weapon.system.magazine : null,
        penalties: {
            mod: modifier,
            armor: armorPenalty,
            wounds: woundPenalty,
            location: locationPenalty,
            base: basePenalty
        },
        bulletSequence: bulletSequence || [],
        hitBulletsData: finalHitSequence
    };

    // Obsługa różnej amunicji w jednej serii (wyświetlanie wielu statystyk)
    this._groupHitsData(rollData);

    game.neuroshima.log("Generowanie karty czatu", rollData);
    game.neuroshima.groupEnd();

    const rollMessage = await NeuroshimaChatMessage.renderWeaponRoll(rollData, actor, roll);

    if (rollMessage) {
        const flags = rollMessage.getFlag("neuroshima", "rollData") ?? {};
        flags.messageId = rollMessage.id;
        await rollMessage.setFlag("neuroshima", "rollData", flags);

        // Melee Opposed Test Start (WFRP4e Pattern)
        if (isMelee && rollData.targets?.length > 0) {
            for (const targetUuid of rollData.targets) {
                const targetDoc = await fromUuid(targetUuid);
                const targetActor = targetDoc?.actor || targetDoc;
                if (targetActor instanceof Actor) {
                    await NeuroshimaChatMessage.createOpposedHandler(rollMessage, targetActor);
                }
            }
        }
    }

    return rollMessage;
  }

  /**
   * Grupuje trafienia o tych samych obrażeniach i przebiciu dla lepszej czytelności.
   * @private
   */
  static _groupHitsData(rollData) {
    if (!rollData.hitBulletsData || rollData.hitBulletsData.length === 0) return;
    
    const hits = rollData.hitBulletsData;
    
    // Grupowanie obrażeń - uwzględniamy liczbę śrucin (successPoints) dla każdego trafienia
    const counts = hits.reduce((acc, h) => {
        const amount = h.isPellet ? (h.successPoints || 1) : 1;
        acc[h.damage] = (acc[h.damage] || 0) + amount;
        return acc;
    }, {});
    
    // Jeśli mamy tylko jeden typ obrażeń i jedną jednostkę, nie pokazujemy "1x"
    const totalWounds = Object.values(counts).reduce((a, b) => a + b, 0);
    
    rollData.damage = Object.entries(counts)
        .map(([damage, count]) => totalWounds > 1 ? `${count}x${damage}` : damage)
        .join(", ");

    // Grupowanie przebicia
    const pCounts = hits.reduce((acc, h) => {
        acc[h.piercing] = (acc[h.piercing] || 0) + 1;
        return acc;
    }, {});
    
    rollData.piercing = Object.entries(pCounts)
        .map(([piercing, count]) => hits.length > 1 ? `${count}x${piercing}` : piercing)
        .join(", ");
    
    // Aktualizacja flagi isPellet dla całej karty, jeśli choć jedno trafienie to śrut
    rollData.isPellet = hits.some(h => h.isPellet);
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
    console.log("Neuroshima | rollTest started", { label, actor: actor?.name });
    // Rozpoczęcie grupy logów dla testu standardowego
    game.neuroshima.group(`Inicjalizacja testu: ${label || "Standard"}`);
    
    const finalSkill = skill + skillBonus;
    const finalStat = stat + attributeBonus;

    // 1. Obliczanie całkowitej kary i trudności bazowej
    const totalPenalty = (penalties.mod || 0) + (penalties.wounds || 0) + (penalties.armor || 0);
    const baseDifficulty = this.getDifficultyFromPercent(totalPenalty);
    
    // 2. Wykonanie rzutu 3k20
    console.log("Neuroshima | Evaluating roll 3d20...");
    const roll = new Roll("3d20");
    await roll.evaluate();
    console.log("Neuroshima | Roll evaluated:", roll.total);

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

    return NeuroshimaChatMessage.renderRoll(rollData, actor, roll);
  }

  /**
   * Wyznacza przesunięty poziom trudności na podstawie Suwaka.
   * @private
   */
  static _getShiftedDifficulty(base, shift) {
    const order = ["easy", "average", "problematic", "hard", "veryHard", "damnHard", "luck", "masterfull", "grandmasterfull"];
    
    // Zabezpieczenie przed brakiem obiektu trudności
    if (!base || !base.label) {
        return NEUROSHIMA.difficulties.average;
    }

    const baseKey = Object.keys(NEUROSHIMA.difficulties).find(key => NEUROSHIMA.difficulties[key]?.label === base.label);
    let index = order.indexOf(baseKey);
    
    if (index === -1) index = 1; // Domyślnie przeciętny
    
    let shiftedIndex = Math.clamp(index + shift, 0, order.length - 1);
    return NEUROSHIMA.difficulties[order[shiftedIndex]] || NEUROSHIMA.difficulties.average;
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
   * Check if user can see damage application section on weapon card.
   */
  static canShowDamageApplication(actor) {
    const minRole = game.settings.get("neuroshima", "damageApplicationMinRole");
    if (game.user.role >= minRole) return true;
    if (actor?.isOwner || game.user.isGM) return true;
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
    let finalHitSequence = [];

    const isWeapon = flags.isWeapon;
    const isMelee = flags.isMelee;
    const isJamming = flags.jamming === true || flags.isJamming === true;

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
        
        if (isWeapon && isSuccess) {
            hitBullets = 1;
            finalHitSequence = [{
                damage: flags.damage || "L",
                piercing: flags.piercing || 0,
                successPoints: 1,
                isPellet: false
            }];
        }
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

        if (isSuccess && !isJamming) {
            const usePelletCountLimit = game.settings.get("neuroshima", "usePelletCountLimit");
            let totalPelletHits = 0;
            const originalSequence = flags.bulletSequence || flags.hitBulletsData || [];

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
        isJamming,
        successPoints,
        successCount,
        modifiedResults,
        hitBullets,
        totalPelletSP,
        hitBulletsData: finalHitSequence,
        debugMode: game.settings.get("neuroshima", "debugMode")
    });

    const template = isWeapon 
        ? "systems/neuroshima/templates/chat/weapon-roll-card.hbs"
        : "systems/neuroshima/templates/chat/roll-card.hbs";

    const showTooltip = NeuroshimaChatMessage._canShowTooltip(actor);
    const content = await foundry.applications.handlebars.renderTemplate(template, {
        ...updatedData,
        config: NEUROSHIMA,
        showTooltip,
        damageTooltipLabel: isWeapon ? NeuroshimaChatMessage._getDamageTooltip(updatedData.damage) : "",
        isGM: game.user.isGM
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

  /**
   * Oblicza efekty leczenia BEZ aktualizacji ran (tylko do wyświetlenia)
   * @param {Actor} patientActor - Pacjent
   * @param {Array} woundIds - IDs ran do leczenia
   * @param {string} healingMethod - "firstAid" lub "woundTreatment"
   * @param {number} successCount - Liczba sukcesów z testu
   * @param {boolean} hadFirstAid - Czy rana miała First Aid
   * @param {number} healingModifier - Modyfikator do redukcji % (per-typ rany)
   * @returns {Object} Informacje o obliczonych zmianach (bez aktualizacji!)
   */
  static calculateHealingEffects(patientActor, woundIds, healingMethod, successCount, hadFirstAid = false, healingModifier = 0) {
    game.neuroshima?.group("NeuroshimaDice | calculateHealingEffects");
    game.neuroshima?.log("Obliczanie efektów leczenia", {
      patient: patientActor.name,
      method: healingMethod,
      successCount: successCount,
      woundIds: woundIds,
      hadFirstAid: hadFirstAid
    });

    const isFirstAid = healingMethod === "firstAid";
    const isSuccess = successCount >= 2;
    
    // Ustal zmianę kary na podstawie wyniku i metody
    // Ujemna = zmniejsza karę (leczenie), dodatnia = zwiększa karę (porażka)
    let penaltyChange = 0;
    if (isSuccess) {
      // Sukces: zmniejsza karę
      if (isFirstAid) {
        penaltyChange = -5;
      } else {
        // Leczenie ran: 15% if fresh, 10% if had First Aid
        penaltyChange = hadFirstAid ? -10 : -15;
      }
    } else {
      // Porażka: zawsze zwiększa karę o 5%
      penaltyChange = 5;
    }
    
    // Add per-wound healing modifier
    penaltyChange += healingModifier;

    game.neuroshima?.log("Zmiana kary ustalona", {
      penaltyChange: penaltyChange,
      baseChange: isSuccess ? (isFirstAid ? -5 : (hadFirstAid ? -10 : -15)) : 5,
      healingModifier: healingModifier,
      isSuccess: isSuccess,
      hadFirstAid: hadFirstAid
    });

    const healingResults = [];

    // Oblicz efekty na każdą ranę (bez aktualizacji!)
    for (const woundId of woundIds) {
      const wound = patientActor.items.get(woundId);
      if (!wound || wound.type !== "wound") continue;

      const oldPenalty = wound.system.penalty || 0;
      const newPenalty = Math.max(0, oldPenalty + penaltyChange);

      game.neuroshima?.log("Obliczenie kary na ranie", {
        woundName: wound.name,
        oldPenalty: oldPenalty,
        newPenalty: newPenalty,
        penaltyChange: penaltyChange
      });

      healingResults.push({
        woundId: woundId,
        woundName: wound.name,
        damageType: wound.system.damageType || "D",
        oldPenalty: oldPenalty,
        newPenalty: newPenalty,
        penaltyChange: penaltyChange,
        hadFirstAid: hadFirstAid
      });
    }

    game.neuroshima?.log("Efekty leczenia obliczone", {
      resultsCount: healingResults.length
    });

    game.neuroshima?.groupEnd();

    return {
      isSuccess: isSuccess,
      healingMethod: healingMethod,
      penaltyChange: penaltyChange,
      results: healingResults
    };
  }

  /**
   * Aplikuje efekty leczenia na wybrane rany
   * @param {Actor} patientActor - Pacjent
   * @param {Array} woundIds - IDs ran do leczenia
   * @param {string} healingMethod - "firstAid" lub "woundTreatment"
   * @param {number} successCount - Liczba sukcesów z testu
   * @param {boolean} hadFirstAid - Czy rana miała First Aid
   * @param {number} healingModifier - Modyfikator do redukcji % (per-typ rany)
   * @returns {Promise<Object>} Informacje o zastosowanych zmianach
   */
  /**
   * PHASE 5 - APPLY HEALING FUNCTIONALITY
   * Calculate and apply healing effects to wounds
   * Oblicza i aplikuje efekty leczenia do ran na podstawie wyniku testu
   * 
   * @param {Actor} patientActor - Postać pacjenta
   * @param {Array} woundIds - ID ran do leczenia
   * @param {string} healingMethod - "firstAid" lub "woundTreatment"
   * @param {number} successCount - Liczba wyników sukcesu (ze zmienionego wyniku - 3 sukcesy = 2+ PT)
   * @param {boolean} hadFirstAid - Czy rana była już opatrzona
   * @param {number} healingModifier - Dodatkowy procent modyfikatora leczenia
   */
  static async applyHealingEffects(patientActor, woundIds, healingMethod, successCount, hadFirstAid = false, healingModifier = 0) {
    game.neuroshima?.group("NeuroshimaDice | applyHealingEffects");
    game.neuroshima?.log("Aplikowanie efektów leczenia", {
      patient: patientActor.name,
      method: healingMethod,
      successCount: successCount,
      woundIds: woundIds,
      hadFirstAid: hadFirstAid
    });

    // PHASE 2: Determine healing reduction based on method and result
    const isFirstAid = healingMethod === "firstAid";
    const isSuccess = successCount >= 2;
    
    // PHASE 2: Calculate penalty change based on method and result
    // Ujemna = zmniejsza karę (leczenie), dodatnia = zwiększa karę (porażka)
    // Pierwsza pomoc: -5% (sukces) / +5% (porażka)
    // Leczenie ran: -15% fresh / -10% (opatrzona) na sukces, +5% na porażkę
    let penaltyChange = 0;
    if (isSuccess) {
      // Sukces: zmniejsza karę
      if (isFirstAid) {
        penaltyChange = -5;
      } else {
        // Treat Wounds: 15% if fresh wound, 10% if had First Aid
        penaltyChange = hadFirstAid ? -10 : -15;
      }
    } else {
      // Porażka: zawsze zwiększa karę o 5%
      penaltyChange = 5;
    }
    
    // PHASE 1: Add per-wound healing modifier (% to change)
    penaltyChange += healingModifier;

    game.neuroshima?.log("Zmiana kary ustalona", {
      penaltyChange: penaltyChange,
      baseChange: isSuccess ? (isFirstAid ? -5 : (hadFirstAid ? -10 : -15)) : 5,
      healingModifier: healingModifier,
      isSuccess: isSuccess,
      hadFirstAid: hadFirstAid
    });

    const healingResults = [];
    const woundsToUpdate = [];

    // PHASE 5: Apply healing effects to each wound
    // Aktualizuj każdą ranę: zmniejsz karę, oznacz jako w trakcie leczenia, czy dodaj hadFirstAid
    for (const woundId of woundIds) {
      const wound = patientActor.items.get(woundId);
      if (!wound || wound.type !== "wound") continue;

      // PHASE 5: Calculate new wound penalty after healing
      // Kara nie może być poniżej 0%
      const oldPenalty = wound.system.penalty || 0;
      const newPenalty = Math.max(0, oldPenalty + penaltyChange);

      game.neuroshima?.log("Zmiana kary na ranie", {
        woundName: wound.name,
        oldPenalty: oldPenalty,
        newPenalty: newPenalty,
        penaltyChange: penaltyChange
      });

      // PHASE 5: Prepare update data for wound
      // Zmiana: penalty + system.isHealing = true + hadFirstAid jeśli First Aid was successful
      const updateData = {
        _id: woundId,
        "system.penalty": newPenalty,
        "system.isHealing": true
      };
      if (isFirstAid && isSuccess) {
        updateData["system.hadFirstAid"] = true;
      }

      woundsToUpdate.push(updateData);

      healingResults.push({
        woundId: woundId,
        woundName: wound.name,
        damageType: wound.system.damageType || "D",
        oldPenalty: oldPenalty,
        newPenalty: newPenalty,
        penaltyChange: penaltyChange
      });
    }

    // PHASE 5: Update all wounds at once (batch update)
    // Aktualizuj wszystkie rany jednym calliem do bazy danych
    if (woundsToUpdate.length > 0) {
      await patientActor.updateEmbeddedDocuments("Item", woundsToUpdate);
    }

    game.neuroshima?.log("Efekty leczenia zastosowane", {
      resultsCount: healingResults.length
    });

    game.neuroshima?.groupEnd();

    return {
      isSuccess: isSuccess,
      healingMethod: healingMethod,
      penaltyChange: penaltyChange,
      results: healingResults
    };
  }

  /**
   * Perform a healing test (First Aid or Treat Wounds)
   */
  static async rollHealingTest(params) {
    const {
      medicActor,
      patientActor,
      healingMethod,
      skillValue,
      stat,
      penalties = {},
      isOpen = false,
      baseDifficulty = "average",
      wounds = [],
      skillBonus = 0,
      attributeBonus = 0
    } = params;

    game.neuroshima?.group("NeuroshimaDice | rollHealingTest");
    game.neuroshima?.log("Parametry rzutu leczenia:", {
      medicName: medicActor?.name,
      patientName: patientActor?.name,
      healingMethod,
      skillValue,
      stat,
      skillBonus,
      attributeBonus,
      baseDifficulty,
      woundCount: wounds.length
    });

    // 1. Kalkulacja kar procentowych
    const basePenalty = NEUROSHIMA.difficulties[baseDifficulty]?.min || 0;
    const modifier = parseInt(penalties.mod) || 0;
    const armorPenalty = parseInt(penalties.armor) || 0;
    const woundPenalty = parseInt(penalties.wounds) || 0;
    const totalPenalty = basePenalty + modifier + armorPenalty + woundPenalty;

    game.neuroshima?.log("Kalkulacja kar (%)", {
      basePenalty,
      modifier,
      armorPenalty,
      woundPenalty,
      totalPenalty
    });

    // 2. Wykonaj rzut kośćmi (3k20)
    const roll = new Roll("3d20");
    await roll.evaluate();
    
    const rawResults = roll.terms[0].results.map(r => r.result);

    // 3. Oblicz bonusy do umiejętności
    const totalSkill = (skillValue || 0) + skillBonus;
    const skillShift = this.getSkillShift(totalSkill);

    // 4. Oblicz finalny atrybut
    const finalStat = stat + attributeBonus;

    // 5. Oblicz wynik testu
    const penaltyDiff = this.getDifficultyFromPercent(totalPenalty);
    const finalDiff = this._getShiftedDifficulty(penaltyDiff, -skillShift);
    const testTarget = finalStat + (finalDiff.mod || 0);

    game.neuroshima?.log("Wyniki rzutu kośćmi", {
      rawResults,
      testTarget,
      skillValue,
      skillBonus,
      totalSkill
    });

    // 6. Ewaluuj test (ZAWSZE Closed Test)
    const healingMethodLabel = healingMethod === "firstAid" ? game.i18n.localize("NEUROSHIMA.Items.Fields.Skills.firstAid") : game.i18n.localize("NEUROSHIMA.Items.Fields.Skills.woundTreatment");
    let rollData = {
      medicActor,
      patientActor,
      healingMethod,
      label: `${healingMethodLabel} - ${patientActor.name}`,
      baseStat: stat,
      baseSkill: skillValue,
      skillBonus,
      attributeBonus,
      stat: finalStat,
      skill: totalSkill,
      target: testTarget,
      penalties: {
        mod: (NEUROSHIMA.difficulties[baseDifficulty]?.min || 0) + modifier,
        armor: armorPenalty,
        wounds: woundPenalty
      },
      totalPenalty,
      baseDifficultyLabel: NEUROSHIMA.difficulties[baseDifficulty]?.label || "NEUROSHIMA.Roll.Average",
      difficultyLabel: finalDiff.label,
      ptMod: finalDiff.mod || 0,
      testTarget,
      isOpen: false,
      isCombat: false,
      isDebug: false,
      rawResults,
      isCritSuccess: false,
      isCritFailure: false,
      isGM: game.user.isGM,
      wounds: wounds
    };

    // Stwórz obiekty kości do ewaluacji
    const diceObjects = rawResults.map((result, idx) => ({
      original: result,
      modified: result,
      isSuccess: result <= testTarget,
      isNat1: result === 1,
      isNat20: result === 20,
      ignored: false,
      cost: 0,
      index: idx
    }));

    // Ewaluuj closed test
    this._evaluateClosedTest(rollData, diceObjects);

    game.neuroshima?.log("Rezultat testu leczenia", {
      metoda: healingMethod,
      pacjent: patientActor.name,
      succesCount: rollData.successCount,
      target: testTarget
    });

    // 7. Aplikuj efekty leczenia na wybrane rany
    const woundIds = wounds.map(w => w.id).filter(id => id);
    let healingEffects = null;
    if (woundIds.length > 0) {
      healingEffects = await this.applyHealingEffects(
        patientActor,
        woundIds,
        healingMethod,
        rollData.successCount
      );
      rollData.healingEffects = healingEffects;
    }

    game.neuroshima?.log("Przygotowanie do renderowania karty leczenia", {
      healingEffectsApplied: !!healingEffects,
      woundCount: woundIds.length
    });

    // 8. Renderuj kartę czatu rzutu leczenia
    await NeuroshimaChatMessage.renderHealingRoll(medicActor, rollData);

    game.neuroshima?.log("Karta leczenia renderowana");
    game.neuroshima?.groupEnd();
  }

  /**
   * Batch healing rolls - one test per wound
   */
  /**
   * PHASE 2 - CLOSED TEST LOGIC & PHASE 1 - CORE HEALING
   * Perform individual closed tests for each wound
   * Wykonuje oddzielne testy (3k20) dla każdej rany z uwzględnieniem:
   * - Zamkniętych testów (closed test evaluation)
   * - Przesunięć umiejętności i kości
   * - Dynamicznego dostosowania trudności testu
   * - Obliczania efektów leczenia
   */
  static async rollBatchHealingTests({
    medicActor,
    patientActor,
    healingMethod,
    woundConfigs,
    stat = null,
    skillBonus = 0,
    attributeBonus = 0
  }) {
    game.neuroshima?.group("NeuroshimaDice | rollBatchHealingTests");
    game.neuroshima?.log("Rozpoczęcie batch rzutu leczenia", {
      medyk: medicActor?.name,
      pacjent: patientActor?.name,
      metoda: healingMethod,
      liczbaRan: woundConfigs.length
    });

    // PHASE 2: Prepare base stats for closed test evaluation
    // Atrybut bazowy (normalnie Zręczność, ale może być wybrany inny)
    let baseStat = stat;
    if (!baseStat) {
      baseStat = medicActor.system.attributes.dexterity + (medicActor.system.modifiers.dexterity || 0);
    }
    
    // PHASE 1: Get skill value based on healing method
    // Pierwsza pomoc vs Leczenie ran
    const skillName = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
    const skillValue = medicActor.system.skills?.[skillName]?.value || 0;
    const totalSkill = skillValue + skillBonus;
    // PHASE 2: Calculate skill shift (from skill points)
    const skillShift = this.getSkillShift(totalSkill);
    const finalStat = baseStat + attributeBonus;

    const results = [];
    const healingResults = [];

    // PHASE 1: Roll for each wound individually (separate 3k20 for each)
    // Każda rana dostaje oddzielny test (nie bulk)
    for (const config of woundConfigs) {
      game.neuroshima?.log("Rzucanie test dla rany", {
        woundName: config.woundName,
        difficulty: config.difficulty,
        modifier: config.modifier
      });

      // PHASE 2: Step 1 - Roll dice (always 3k20 for healing)
      const roll = new Roll("3d20");
      await roll.evaluate();
      
      const rawResults = roll.terms[0].results.map(r => r.result);

      // PHASE 2: Step 2 - Calculate test difficulty with modifiers
      // Base difficulty (z ustawień) + modyfikator trudności (global + pancerz + rany)
      const baseDifficultyKey = config.difficulty || 'average';
      const baseDifficultyData = NEUROSHIMA.difficulties[baseDifficultyKey] || NEUROSHIMA.difficulties.average;
      const totalPenalty = (baseDifficultyData.min || 0) + config.modifier;
      const penaltyDiff = this.getDifficultyFromPercent(totalPenalty);
      
      // PHASE 2: Calculate total shift for difficulty adjustment (skill + dice)
      // Przesunięcie umiejętności (ze skill points) + przesunięcie kości (1 lub 20)
      const diceShift = this.getDiceShift(rawResults);
      const totalShift = -skillShift + diceShift;
      const finalDiff = this._getShiftedDifficulty(penaltyDiff, totalShift);
      const testTarget = finalStat + (finalDiff.mod || 0);
      
      // PHASE 2: Get final difficulty label after all shifts
      const difficultyLabel = finalDiff.label;

      // PHASE 2: Step 3 - Create dice objects for closed test evaluation
      // Każda kość ma: original, modified, success status, nat1/20 status
      const diceObjects = rawResults.map((result, idx) => ({
        original: result,
        modified: result,
        isSuccess: result <= testTarget,
        isNat1: result === 1,
        isNat20: result === 20,
        ignored: false,
        cost: 0,
        index: idx
      }));

      // PHASE 2: Step 4 - Evaluate closed test (count successes)
      const testRollData = {
        medicActor,
        patientActor,
        healingMethod,
        rawResults,
        testTarget,
        target: testTarget,
        woundId: config.woundId,
        woundName: config.woundName,
        damageType: config.damageType,
        difficulty: config.difficulty,
        difficultyLabel: difficultyLabel,
        baseSkill: skillValue,
        skillBonus: skillBonus,
        baseStat: stat,
        attributeBonus: attributeBonus,
        stat: finalStat,
        skill: totalSkill,
        ptMod: finalDiff.mod || 0,
        isOpen: false,
        isCombat: false,
        successCount: 0,
        isCritSuccess: false,
        isCritFailure: false,
        isGM: game.user.isGM
      };

      // Evaluate closed test
      this._evaluateClosedTest(testRollData, diceObjects);

      game.neuroshima?.log("Wynik testu na rani", {
        woundName: config.woundName,
        successCount: testRollData.successCount,
        isSuccess: testRollData.successCount >= 2
      });

      // 5. Calculate healing effects to this wound (don't apply yet!)
      const healingEffectResults = game.neuroshima.HealingApp.calculateHealingResults(
        patientActor,
        [config.woundId],
        testRollData.successCount,
        healingMethod,
        config.hadFirstAid,
        config.healingModifier
      );

      // Collect result for reporting
      const isSuccess = testRollData.successCount >= 2;
      results.push({
        woundId: config.woundId,
        woundName: config.woundName,
        damageType: config.damageType,
        difficulty: config.difficulty,
        testTarget,
        successCount: testRollData.successCount,
        isSuccess: isSuccess,
        modifiedResults: testRollData.modifiedResults,
        rawResults: rawResults,
        baseStat: baseStat,
        skill: totalSkill,
        skillBonus: skillBonus,
        attributeBonus: attributeBonus,
        finalStat: finalStat,
        ptMod: testRollData.ptMod,
        difficultyLabel: testRollData.difficultyLabel,
        skillShift: -skillShift,
        diceShift: diceShift,
        healingEffect: healingEffectResults[0]
      });

      healingResults.push({
        woundId: config.woundId,
        woundName: config.woundName,
        isSuccess: isSuccess,
        oldPenalty: healingEffectResults[0].oldPenalty,
        newPenalty: healingEffectResults[0].newPenalty,
        penaltyChange: healingEffectResults[0].penaltyChange
      });
    }

    // Count successes and failures
    const successCount = results.filter(r => r.isSuccess).length;
    const failureCount = results.length - successCount;

    game.neuroshima?.log("Batch rzut zakończony", {
      totalWounds: results.length,
      successes: successCount,
      failures: failureCount
    });

    // 6. Render batch results
    await NeuroshimaChatMessage.renderHealingBatchResults(
      medicActor,
      patientActor,
      healingMethod,
      results,
      successCount,
      failureCount,
      {
        woundConfigs: woundConfigs,
        stat: baseStat,
        skillBonus: skillBonus,
        attributeBonus: attributeBonus
      }
    );

    game.neuroshima?.groupEnd();
    return results;
  }

  /**
   * Przerzut na konkretną ranę w healing (bez tworzenia chat message)
   */
  static async rerollHealingTest(medicActor, patientActor, healingMethod, woundConfig, baseStat, skillBonus, attributeBonus) {
    game.neuroshima?.group("NeuroshimaDice | rerollHealingTest");
    game.neuroshima?.log("Przerzut testu na ranie", {
      woundName: woundConfig.woundName,
      damageType: woundConfig.damageType,
      difficulty: woundConfig.difficulty
    });

    const skillName = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
    const skillValue = medicActor.system.skills?.[skillName]?.value || 0;
    const totalSkill = skillValue + skillBonus;
    const skillShift = this.getSkillShift(totalSkill);
    const finalStat = baseStat + attributeBonus;

    // Roll dice
    const roll = new Roll("3d20");
    await roll.evaluate();
    
    const rawResults = roll.terms[0].results.map(r => r.result);

    // Calculate difficulty
    const baseDifficultyKey = woundConfig.difficulty || 'average';
    const baseDifficultyData = NEUROSHIMA.difficulties[baseDifficultyKey] || NEUROSHIMA.difficulties.average;
    const totalPenalty = (baseDifficultyData.min || 0) + woundConfig.modifier;
    const penaltyDiff = this.getDifficultyFromPercent(totalPenalty);
    
    // Calculate total shift (skill + dice)
    const diceShift = this.getDiceShift(rawResults);
    const totalShift = -skillShift + diceShift;
    const finalDiff = this._getShiftedDifficulty(penaltyDiff, totalShift);
    const testTarget = finalStat + (finalDiff.mod || 0);

    // Create dice objects
    const diceObjects = rawResults.map((result, idx) => ({
      original: result,
      modified: result,
      isSuccess: result <= testTarget,
      isNat1: result === 1,
      isNat20: result === 20,
      ignored: false,
      cost: 0,
      index: idx
    }));

    // Evaluate closed test
    const testRollData = {
      medicActor,
      patientActor,
      healingMethod,
      rawResults,
      testTarget,
      target: testTarget,
      woundId: woundConfig.woundId,
      woundName: woundConfig.woundName,
      damageType: woundConfig.damageType,
      difficulty: woundConfig.difficulty,
      difficultyLabel: finalDiff.label,
      baseSkill: skillValue,
      skillBonus: skillBonus,
      baseStat: baseStat,
      attributeBonus: attributeBonus,
      stat: finalStat,
      skill: totalSkill,
      ptMod: finalDiff.mod || 0,
      isOpen: false,
      isCombat: false,
      successCount: 0,
      isCritSuccess: false,
      isCritFailure: false,
      isGM: game.user.isGM
    };

    // Evaluate
    this._evaluateClosedTest(testRollData, diceObjects);

    game.neuroshima?.log("Wynik przerzutu na ranie", {
      woundName: woundConfig.woundName,
      successCount: testRollData.successCount,
      isSuccess: testRollData.successCount >= 2
    });

    // Calculate healing effects (don't apply yet - user clicks Apply Healing button)
    const isSuccess = testRollData.successCount >= 2;
    const healingEffect = this.calculateHealingEffects(
      patientActor,
      [woundConfig.woundId],
      healingMethod,
      testRollData.successCount,
      woundConfig.hadFirstAid,
      woundConfig.healingModifier
    );

    // Build tooltip (same as batch report)
    let diceHtml = '<div class="dice-results-grid tiny">';
    testRollData.modifiedResults.forEach((d, i) => {
      diceHtml += `
        <div class="die-result ${d.ignored ? 'ignored' : ''}">
          <span class="die-label tiny">D${i + 1}=</span>
          <div class="die-square-container tiny">
            <span class="die-square original tiny ${d.isNat1 ? 'nat-1' : ''} ${d.isNat20 ? 'nat-20' : ''}">${d.original}</span>
            ${totalSkill > 0 && !d.ignored ? `
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
          ${game.i18n.localize(testRollData.difficultyLabel)}
          ${game.i18n.localize("NEUROSHIMA.Roll.ClosedTest")}
          ${game.i18n.localize("NEUROSHIMA.Roll.On")}
          ${healingMethod === "firstAid" ? game.i18n.localize("NEUROSHIMA.Skills.firstAid") : game.i18n.localize("NEUROSHIMA.Skills.woundTreatment")}
        </header>
        <hr class="dotted-hr tiny">
        ${diceHtml}
        <hr class="dotted-hr tiny">
        <footer class="roll-outcome tiny">
          <div class="outcome-item">
            <span class="label">${game.i18n.localize('NEUROSHIMA.Attributes.Attributes')}:</span>
            <span class="value">${testRollData.baseStat || 0}</span>
          </div>
          <div class="outcome-item">
            <span class="label">Umiejętność:</span>
            <span class="value">${testRollData.skill || 0}</span>
          </div>
          <div class="outcome-item">
            <span class="label">${game.i18n.localize('NEUROSHIMA.Roll.Target')}:</span>
            <span class="value">${testRollData.testTarget}</span>
          </div>
          <div class="outcome-item">
            <span class="label">${game.i18n.localize('NEUROSHIMA.Roll.SuccessPointsAbbr')}:</span>
            <span class="value"><strong>${testRollData.successCount}</strong></span>
          </div>
        </footer>
      </div>
    `.trim();

    game.neuroshima?.groupEnd();

    return {
      woundId: woundConfig.woundId,
      woundName: woundConfig.woundName,
      damageType: woundConfig.damageType,
      successCount: testRollData.successCount,
      isSuccess: isSuccess,
      healingEffect: healingEffect.results[0],
      tooltip: tooltip
    };
  }
}
