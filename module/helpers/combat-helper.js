import { NEUROSHIMA } from "../config.js";
import { NeuroshimaChatMessage } from "../documents/chat-message.js";

/**
 * Helper class for Neuroshima 1.5 combat-related automation.
 */
export class CombatHelper {
  /**
   * Refund ammunition consumed during a weapon roll.
   * @param {ChatMessage} message The roll chat message.
   * @returns {Promise<boolean>} Success status.
   */
  static async refundAmmunition(message) {
    const flags = message.getFlag("neuroshima", "rollData");
    
    game.neuroshima.group("CombatHelper | refundAmmunition");
    game.neuroshima.log("Parametry refundacji:", {
      hasFlags: !!flags,
      isWeapon: flags?.isWeapon,
      actorId: flags?.actorId,
      bulletSequenceLength: flags?.bulletSequence?.length,
      magazineId: flags?.magazineId,
      ammoId: flags?.ammoId
    });

    if (!flags || !flags.isWeapon) {
      game.neuroshima.log("Błąd: Brak flag lub wiadomość nie dotyczy broni");
      game.neuroshima.groupEnd();
      return false;
    }
    
    const actor = game.actors.get(flags.actorId);
    if (!actor) {
      game.neuroshima.log("Błąd: Nie znaleziono aktora", { actorId: flags.actorId });
      game.neuroshima.groupEnd();
      return false;
    }

    game.neuroshima.log("Aktor znaleziony:", {
      name: actor.name,
      type: actor.type,
      itemsCount: actor.items.size,
      allItemIds: Array.from(actor.items.keys())
    });

    const bulletSequence = flags.bulletSequence;
    if (!bulletSequence || bulletSequence.length === 0) {
      game.neuroshima.log("Błąd: Brak danych o trafionych pociskach (bulletSequence pusty)");
      game.neuroshima.groupEnd();
      return false;
    }

    game.neuroshima.log("Sekwencja pocisków do refundu:", bulletSequence);

    // Refund ammo in reverse order (LIFO)
    const refundSequence = [...bulletSequence].reverse();

    const magazineId = flags.magazineId;
    const ammoId = flags.ammoId;

    game.neuroshima.log("Próba refundu:", { magazineId, ammoId });

    if (magazineId) {
        const magazine = actor.items.get(magazineId);
        game.neuroshima.log("Szukanie magazynka:", {
          magazineId,
          found: !!magazine,
          type: magazine?.type,
          magazineInActorItems: Array.from(actor.items.keys()).includes(magazineId)
        });

        if (magazine && magazine.type === "magazine") {
            const contents = JSON.parse(JSON.stringify(magazine.system.contents || []));
            game.neuroshima.log("Zawartość przed refundem:", contents);
            
            for (const bullet of refundSequence) {
                const lastStack = contents[contents.length - 1];
                const canMerge = this._isSameAmmo(lastStack, bullet);
                
                game.neuroshima.log("Refund pocisku:", { 
                  bulletName: bullet.name, 
                  canMerge,
                  lastStackBefore: lastStack ? { name: lastStack.name, quantity: lastStack.quantity } : null
                });

                // Compare with current stack to see if we can merge
                if (canMerge) {
                    lastStack.quantity += 1;
                    game.neuroshima.log("Zwiększono quantity:", { 
                      name: lastStack.name, 
                      newQuantity: lastStack.quantity 
                    });
                } else {
                    const newStack = {
                        name: bullet.name,
                        img: bullet.img || "systems/neuroshima/assets/img/ammo.svg",
                        quantity: 1,
                        overrides: {
                            enabled: bullet.overrides?.enabled ?? (bullet.damage !== undefined),
                            damage: bullet.damage,
                            piercing: bullet.piercing,
                            jamming: bullet.jamming,
                            isPellet: bullet.isPellet,
                            pelletCount: bullet.pelletCount,
                            pelletRanges: bullet.pelletRanges
                        }
                    };
                    contents.push(newStack);
                    game.neuroshima.log("Dodano nowy stos:", newStack);
                }
            }
            
            game.neuroshima.log("Zawartość po refundzie:", contents);
            
            try {
                await magazine.update({ "system.contents": contents });
                game.neuroshima.log("Magazynek zaktualizowany, nowa zawartość:", magazine.system.contents);
            } catch (e) {
                game.neuroshima.error("Błąd podczas aktualizacji magazynka:", e);
                game.neuroshima.groupEnd();
                return false;
            }
            
            ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.AmmoRefunded", { 
                amount: bulletSequence.length, 
                name: magazine.name 
            }));

            await message.setFlag("neuroshima", "ammoRefunded", true);
            game.neuroshima.groupEnd();
            return true;
        }
    } else if (ammoId) {
        // Handle thrown weapons (direct ammo consumption)
        const ammo = actor.items.get(ammoId);
        game.neuroshima.log("Amunicja (thrown):", { found: !!ammo, type: ammo?.type });

        if (ammo && ammo.type === "ammo") {
            const oldQuantity = ammo.system.quantity;
            const newQuantity = oldQuantity + bulletSequence.length;
            game.neuroshima.log("Aktualizacja ilości amunicji:", { oldQuantity, newQuantity });

            await ammo.update({ "system.quantity": newQuantity });
            
            ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.AmmoRefunded", { 
                amount: bulletSequence.length, 
                name: ammo.name 
            }));

            await message.setFlag("neuroshima", "ammoRefunded", true);
            game.neuroshima.groupEnd();
            return true;
        }
    }

    game.neuroshima.log("Błąd: Nie znaleziono magazynka ani amunicji");
    game.neuroshima.groupEnd();
    return false;
  }

  /**
   * Compare two ammo stacks or a stack and a bullet definition to see if they are identical.
   * @private
   */
  static _isSameAmmo(stack, bullet) {
    if (!stack || !bullet) return false;
    if (stack.name !== bullet.name) return false;
    
    // Magazine stack uses 'overrides' property, bullet from sequence is flat or has 'overrides'
    const sO = stack.overrides || {};
    const bO = bullet.overrides || bullet; 
    
    // Check key combat properties for merging
    const sameDamage = (sO.damage ?? "L") === (bO.damage ?? "L");
    const samePiercing = (sO.piercing ?? 0) === (bO.piercing ?? 0);
    const sameJamming = (sO.jamming ?? 20) === (bO.jamming ?? 20);
    const samePellet = (!!sO.isPellet) === (!!bO.isPellet);
    
    let samePelletStats = true;
    if (samePellet && !!sO.isPellet) {
        samePelletStats = (sO.pelletCount ?? 1) === (bO.pelletCount ?? 1);
        // Deep comparison of pelletRanges if needed, but usually pelletCount is enough for same-named ammo
        if (samePelletStats && sO.pelletRanges && bO.pelletRanges) {
            samePelletStats = JSON.stringify(sO.pelletRanges) === JSON.stringify(bO.pelletRanges);
        }
    }
    
    return sameDamage && samePiercing && sameJamming && samePellet && samePelletStats;
  }

  /**
   * Apply damage to a single actor with optional opposed test data.
   * @param {Actor} actor The defender actor.
   * @param {Object} attackData The rollData from the attack.
   * @param {Object} options Additional options (isOpposed, spDifference, attackerMessageId).
   */
  static async applyDamageToActor(actor, attackData, options = {}) {
    game.neuroshima.group(`CombatHelper | applyDamageToActor: ${actor.name}`);
    
    // We can reuse the applyDamage logic by creating a mock message if needed,
    // but it's better to refactor applyDamage to call this, or just implement it here.
    
    const location = options.location || attackData.finalLocation || "torso";
    const isMelee = attackData.isMelee;
    const initialDamageType = attackData.damage || "L";
    const piercing = attackData.piercing || 0;
    const spDifference = options.spDifference ?? attackData.successPoints ?? 0;
    
    // Dla walki wręcz wybieramy odpowiednie pole obrażeń (damageMelee1/2/3) na podstawie spDifference
    let damageType = initialDamageType;
    if (isMelee) {
        if (spDifference <= 0 && options.isOpposed) {
            game.neuroshima.log("Walka wręcz: spDifference <= 0, brak obrażeń.");
            game.neuroshima.groupEnd();
            return;
        }
        
        // Próba pobrania bezpośrednich pól z broni lub z zapisanych danych rzutu
        const attacker = attackData.actorId ? game.actors.get(attackData.actorId) : null;
        const weapon = attacker && attackData.weaponId ? attacker.items.get(attackData.weaponId) : null;
        
        let damageProfiles = [];
        if (attackData.damageMelee1) {
            // Używamy danych zapisanych w rzucie (najbezpieczniejsze dla persistence)
            damageProfiles = [
                attackData.damageMelee1,
                attackData.damageMelee2 || "L",
                attackData.damageMelee3 || "C"
            ];
            game.neuroshima.log("Walka wręcz: Pobrane profile z danych rzutu", damageProfiles);
        } else if (weapon && weapon.system.weaponType === "melee") {
            damageProfiles = [
                weapon.system.damageMelee1 || "D",
                weapon.system.damageMelee2 || "L",
                weapon.system.damageMelee3 || "C"
            ];
            game.neuroshima.log("Walka wręcz: Pobrane profile bezpośrednio z broni", damageProfiles);
        } else {
            damageProfiles = initialDamageType.split("/").map(s => s.trim());
        }

        const tier = Math.clamp(spDifference, 1, 3);
        damageType = damageProfiles[tier - 1] || damageProfiles[0] || "L";
        game.neuroshima.log(`Walka wręcz: spDifference=${spDifference}, wybrany profil obrażeń=${damageType} (z ${initialDamageType})`);
    }

    const sourceInfo = `<p><em>Źródło: ${attackData.label || "Broń"} ${options.attackerMessageId ? `(${options.attackerMessageId})` : ""}</em></p>`;
    
    const rawWounds = [];
    const reducedDetails = [];
    let totalProjectiles = 0;
    let reducedProjectiles = 0;

    if (isMelee) {
        totalProjectiles = 1;
        
        // Apply armor reduction
        const reductionData = this.reduceArmorDamageWithDetails(actor, location, damageType, piercing);
        
        if (reductionData.reducedDamageType) {
            rawWounds.push({
                name: game.i18n.localize(NEUROSHIMA.woundConfiguration[reductionData.reducedDamageType]?.fullLabel || "NEUROSHIMA.Items.Type.Wound"),
                damageType: reductionData.reducedDamageType
            });
        } else {
            reducedProjectiles++;
            reducedDetails.push(reductionData);
        }
    } else {
        const hitBulletsData = attackData.hitBulletsData || [{
            damage: damageType,
            piercing: piercing,
            successPoints: attackData.successPoints || 1
        }];

        for (const bullet of hitBulletsData) {
            const count = bullet.isPellet ? (bullet.successPoints || 1) : 1;
            for (let i = 0; i < count; i++) {
                totalProjectiles++;
                const reductionData = this.reduceArmorDamageWithDetails(actor, location, bullet.damage || damageType, bullet.piercing ?? piercing);
                if (reductionData.reducedDamageType) {
                    rawWounds.push({
                        name: game.i18n.localize(NEUROSHIMA.woundConfiguration[reductionData.reducedDamageType]?.fullLabel || "NEUROSHIMA.Items.Type.Wound"),
                        damageType: reductionData.reducedDamageType
                    });
                } else {
                    reducedProjectiles++;
                    reducedDetails.push(reductionData);
                }
            }
        }
    }

    if (rawWounds.length > 0 || reducedProjectiles > 0) {
        let results = [];
        let woundIds = [];
        
        if (rawWounds.length > 0) {
            const painResistanceData = await this.processPainResistance(actor, rawWounds, location, sourceInfo);
            results = painResistanceData.results;
            const createdWounds = await actor.createEmbeddedDocuments("Item", painResistanceData.processedWounds);
            woundIds = createdWounds.map(w => w.id);

            ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageApplied", { 
                count: painResistanceData.processedWounds.length, 
                name: actor.name 
            }));
        }

        await this.renderPainResistanceReport(actor, results, woundIds, reducedProjectiles, reducedDetails);
    }
    
    game.neuroshima.groupEnd();
  }

  /**
   * Apply damage from a weapon roll to a set of actors.
   * @param {ChatMessage} message The roll chat message.
   * @param {Array<Actor>} actors Array of actors to apply damage to.
   * @returns {Promise<void>}
   */
  static async applyDamage(message, actors) {
    let flags = message.getFlag("neuroshima", "rollData");
    const opposedResult = message.getFlag("neuroshima", "opposedResult");
    const attackMessageId = message.getFlag("neuroshima", "attackMessageId");

    game.neuroshima.group("CombatHelper | applyDamage");
    
    // Jeśli wiadomość to raport wyniku starcia (Opposed Result), pobierz dane z oryginalnego ataku
    if (!flags && opposedResult && attackMessageId) {
        const attackMessage = game.messages.get(attackMessageId);
        if (attackMessage) {
            flags = attackMessage.getFlag("neuroshima", "rollData");
            if (flags) {
                flags = foundry.utils.mergeObject(foundry.utils.deepClone(flags), {
                    opposedResult: opposedResult
                });
                game.neuroshima.log("Pobrano dane ataku z powiązanej wiadomości:", { attackMessageId });
            }
        }
    }

    game.neuroshima.log("Parametry wejściowe:", { messageId: message.id, flags, actors: actors.map(a => a.name) });

    if (!flags || !flags.isWeapon) {
        game.neuroshima.log("Błąd: Brak flag lub wiadomość nie dotyczy broni.");
        game.neuroshima.groupEnd();
        return;
    }

    // Sprawdź, czy to atak melee oczekujący na obronę
    if (flags.isMelee && flags.targets?.length > 0) {
        // Jeśli nie ma wyniku opposed, nie pozwól na Apply Damage
        if (!flags.opposedResult) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.MeleeNeedsDefense"));
            game.neuroshima.groupEnd();
            return;
        }

        // Jeśli obrona wygrała, nie stosuj obrażeń
        if (flags.opposedResult.winner !== "attacker") {
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.Info.DefenseBlockedDamage"));
            game.neuroshima.groupEnd();
            return;
        }
    }

    // Allow GM to force damage application even on failed tests
    const isSuccess = flags.isSuccess === true;
    const isGM = game.user.isGM;

    if (!isSuccess && !isGM) {
        game.neuroshima.log("Błąd: Test nie był udany, a użytkownik nie jest MG.");
        game.neuroshima.groupEnd();
        return;
    }

    let hitBulletsData = flags.hitBulletsData || [];
    
    // If it's a failure but GM is forcing damage, we need bullet data
    if (hitBulletsData.length === 0 && isGM) {
        game.neuroshima.log("Ostrzeżenie: Brak danych o trafieniach. Używam danych bazowych dla wymuszenia obrażeń przez MG.");
        if (flags.bulletSequence && flags.bulletSequence.length > 0) {
            // For GM force, use ALL bullets from sequence, not just first
            hitBulletsData = flags.bulletSequence.map(bullet => ({
                ...bullet,
                successPoints: bullet.successPoints || 1
            }));
            game.neuroshima.log("Wymuszenie obrażeń: Użycie wszystkich pocisków z serii", {
              bulletCount: hitBulletsData.length,
              bullets: hitBulletsData.map(b => ({ damage: b.damage, piercing: b.piercing }))
            });
        } else {
            // Fallback for melee or when no sequence exists
            hitBulletsData = [{
                damage: flags.damage || "L",
                piercing: flags.piercing || 0,
                isPellet: flags.isPellet || false,
                successPoints: flags.successPoints || 1
            }];
        }
    }

    const isMelee = flags.isMelee;
    
    // Pobierz wybraną lokację z flag (nadpisuje domyślną z rzutu)
    const selectedLocation = message.getFlag("neuroshima", "selectedLocation");
    const location = selectedLocation || flags.finalLocation || "torso";
    
    game.neuroshima.log("Logika obrażeń:", { 
      isMelee, 
      location,
      selectedLocation,
      finalLocationFromFlags: flags.finalLocation,
      hitBulletsData: hitBulletsData.map(b => ({
        damage: b.damage,
        piercing: b.piercing,
        isPellet: b.isPellet,
        successPoints: b.successPoints
      }))
    });

    for (const actor of actors) {
        await this.applyDamageToActor(actor, flags, { 
            attackerMessageId: message.id,
            location: location,
            spDifference: flags.opposedResult?.spDifference,
            isOpposed: !!flags.opposedResult
        });
    }
    game.neuroshima.groupEnd();
  }

  /**
   * Wykonuje serię testów odporności na ból i przygotowuje dane przedmiotów ran.
   * @param {Actor} actor 
   * @param {Array} rawWounds 
   * @param {string} location
   * @param {string} sourceInfo
   * @returns {Promise<Object>} { processedWounds, results }
   */
  static async processPainResistance(actor, rawWounds, location, sourceInfo) {
    game.neuroshima.group(`Przetwarzanie odporności na ból: ${actor.name}`);
    
    const skillKey = "painResistance";
    const skillValue = actor.system.skills[skillKey]?.value || 0;
    const statKey = "charisma";
    const statValue = actor.system.attributes[statKey] || 10;
    
    const results = [];
    const processedWounds = [];
    
    for (const wound of rawWounds) {
        const damageType = wound.damageType;
        const config = NEUROSHIMA.woundConfiguration[damageType];
        
        // Trudność bazowa z konfiguracji rany
        let baseDifficulty = config?.difficulty || NEUROSHIMA.difficulties.average;
        
        // Jeśli konfiguracja rany ma null (np. rany typu K), użyj domyślnego lub skip
        if (!baseDifficulty) baseDifficulty = NEUROSHIMA.difficulties.average;
        
        // Rzut odporności na ból (test ZAMKNIĘTY zgodnie z zasadami 1.5, ignoruje kary z ran/pancerza)
        const roll = new Roll("3d20");
        await roll.evaluate();
        const diceResults = roll.terms[0].results.map(r => r.result);
        
        // Obliczanie Suwaka (tylko umiejętność i kości naturalne)
        const allowShift = game.settings.get("neuroshima", "allowPainResistanceShift");
        let totalShift = 0;
        if (allowShift) {
            const skillShift = game.neuroshima.NeuroshimaDice.getSkillShift(skillValue);
            const diceShift = game.neuroshima.NeuroshimaDice.getDiceShift(diceResults);
            totalShift = -skillShift + diceShift;
        }
        
        const shiftedDiff = game.neuroshima.NeuroshimaDice._getShiftedDifficulty(baseDifficulty, totalShift);
        const target = statValue + shiftedDiff.mod;
        
        // Ewaluacja testu zamkniętego (min. 2 sukcesy dla udanego testu)
        const diceObjects = diceResults.map((v, i) => ({ 
            original: v, 
            index: i, 
            modified: v, 
            isSuccess: false, 
            ignored: false,
            isNat1: v === 1,
            isNat20: v === 20
        }));
        
        const evalData = { target, skill: skillValue };
        game.neuroshima.NeuroshimaDice._evaluateClosedTest(evalData, diceObjects);
        
        const isPassed = evalData.success; // true if successCount >= 2
        // Penalties: [zdany, niezdany]
        const appliedPenalty = isPassed ? (config?.penalties[0] || 0) : (config?.penalties[1] || 0);
        
        results.push({
            name: wound.name,
            damageType,
            baseDifficulty: baseDifficulty.label,
            totalShift: totalShift,
            difficulty: shiftedDiff.label,
            isPassed,
            penalty: appliedPenalty,
            dice: diceResults.join(", "),
            modifiedResults: evalData.modifiedResults,
            successPoints: evalData.successCount, // W teście zamkniętym punkty przewagi to liczba sukcesów
            target: target,
            skill: skillValue,
            isCritSuccess: evalData.isCritSuccess,
            isCritFailure: evalData.isCritFailure
        });

        processedWounds.push({
            name: wound.name,
            type: "wound",
            system: {
                location: location,
                damageType: damageType,
                penalty: appliedPenalty,
                description: sourceInfo
            }
        });
    }

    game.neuroshima.groupEnd();
    return { processedWounds, results };
  }

  /**
   * Renderuje raport z testów odporności na ból do czatu.
   * Deleguje do NeuroshimaChatMessage API.
   * @param {Actor} actor
   * @param {Array} results - Wyniki testów pain-resistance
   * @param {Array<string>} woundIds - ID ran
   * @param {number} reducedProjectiles - Liczba zredukowanych pocisków/ran
   * @param {Array} reducedDetails - Szczegółowe dane o redukcji dla każdego zredukowanego pocisku
   */
  static async renderPainResistanceReport(actor, results, woundIds, reducedProjectiles = 0, reducedDetails = []) {
    return NeuroshimaChatMessage.renderPainResistance(actor, results, woundIds, reducedProjectiles, reducedDetails);
  }

  /**
   * Cofa nałożone obrażenia (usuwa powiązane przedmioty typu 'wound').
   */
  static async reverseDamage(message) {
    if (!game.user.isGM) return;
    
    game.neuroshima.group("CombatHelper | reverseDamage");
    
    // Pobieranie flag w sposób bardziej bezpośredni
    const actorUuid = message.getFlag("neuroshima", "actorUuid");
    const actorId = message.getFlag("neuroshima", "actorId");
    const woundIds = message.getFlag("neuroshima", "woundIds") || [];
    const isReversed = message.getFlag("neuroshima", "isReversed");

    game.neuroshima.log("Pobrane dane z flag:", { actorUuid, actorId, woundIds, isReversed });

    if (isReversed) {
        game.neuroshima.log("Anulowano: Obrażenia zostały już wycofane.");
        game.neuroshima.groupEnd();
        return;
    }

    // Rozwiązywanie aktora (Token lub Library)
    let actor = null;
    if (actorUuid) {
        const doc = await fromUuid(actorUuid);
        actor = doc?.actor || doc; // fromUuid może zwrócić TokenDocument lub Actor
    } 
    
    if (!actor && actorId) {
        actor = game.actors.get(actorId);
    }

    if (!actor) {
        game.neuroshima.error("Nie znaleziono aktora.", { actorUuid, actorId });
        ui.notifications.error(game.i18n.localize("NEUROSHIMA.Notifications.ActorNotFound"));
        game.neuroshima.groupEnd();
        return;
    }

    game.neuroshima.log(`Znaleziono aktora: ${actor.name} (${actor.uuid})`);

    // Pobierz tylko te rany, które wciąż istnieją na aktorze
    // Sprawdzamy ID rany w kolekcji przedmiotów aktora
    const actorItems = actor.items;
    const existingWoundIds = woundIds.filter(id => actorItems.has(id));
    
    game.neuroshima.log("Wynik wyszukiwania ran:", { 
        szukaneIds: woundIds, 
        znalezioneIds: existingWoundIds,
        wszystkiePrzedmiotyAktora: actorItems.map(i => i.id)
    });

    if (existingWoundIds.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", existingWoundIds);
        ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageReversed", { 
            count: existingWoundIds.length, 
            name: actor.name 
        }));
    } else {
        game.neuroshima.log("Ostrzeżenie: Żadna z rzuconych ran nie została znaleziona na aktorze.");
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoWoundsFoundToReverse"));
    }

    // Aktualizacja flagi
    await message.setFlag("neuroshima", "isReversed", true);

    // Dodanie wizualnego indykatora do wiadomości
    const html = document.createElement("div");
    html.innerHTML = message.content;
    
    const oldStatus = html.querySelector(".refund-status");
    if (oldStatus) oldStatus.remove();

    const statusDiv = document.createElement("div");
    statusDiv.className = "refund-status";
    statusDiv.style.textAlign = "center";
    statusDiv.style.fontStyle = "italic";
    statusDiv.style.opacity = "0.7";
    statusDiv.style.marginTop = "5px";
    statusDiv.style.borderTop = "1px dashed #777";
    statusDiv.style.paddingTop = "5px";
    statusDiv.textContent = game.i18n.localize("NEUROSHIMA.Notifications.StatusReversed");
    
    html.appendChild(statusDiv);
    
    await message.update({ content: html.innerHTML });
    
    game.neuroshima.groupEnd();
  }

  /**
   * Sprawdza czy użytkownik może zobaczyć szczegóły raportu Odporności na Ból.
   */
  static canShowPainResistanceDetails(actor) {
    const minRole = game.settings.get("neuroshima", "painResistanceMinRole");
    if (game.user.role >= minRole) return true;
    if (actor?.isOwner || game.user.isGM) return true;
    return false;
  }

  /**
   * Sprawdza czy użytkownik może wykonywać akcje specjalne (Refundacja, Cofnięcie).
   */
  static canPerformCombatAction() {
    const minRole = game.settings.get("neuroshima", "combatActionsMinRole");
    return game.user.role >= minRole || game.user.isGM;
  }

  /**
   * Helper to shift hit location based on a numerical value.
   * Useful for pellet spread rules or other mechanics.
   * @param {string} originalLocation The starting location key (e.g., 'torso').
   * @param {number} shift The amount to shift (negative shifts towards lower roll values / head).
   * @returns {string} The new location key.
   */
  static getShiftedLocation(originalLocation, shift) {
    if (shift === 0) return originalLocation;

    // Body locations in Neuroshima (1-20 roll range order)
    // 1-2: Head, 3-4: Right Arm, 5-6: Left Arm, 7-16: Torso, 17-18: Right Leg, 19-20: Left Leg
    const locationOrder = ["head", "rightArm", "leftArm", "torso", "rightLeg", "leftLeg"];
    
    // Simple implementation based on indices
    let currentIndex = locationOrder.indexOf(originalLocation);
    if (currentIndex === -1) currentIndex = 3; // Torso default

    // Calculate new index
    let newIndex = Math.clamp(currentIndex + shift, 0, locationOrder.length - 1);
    return locationOrder[newIndex];
  }

  /**
   * Shift location based on the actual 1d20 roll value.
   * @param {number} originalRoll 
   * @param {number} shift 
   * @returns {string}
   */
  static getShiftedLocationByRoll(originalRoll, shift) {
    const newRoll = Math.clamp(originalRoll + shift, 1, 20);
    const entry = Object.entries(NEUROSHIMA.bodyLocations).find(([key, data]) => {
        return newRoll >= data.roll[0] && newRoll <= data.roll[1];
    });
    return entry ? entry[0] : "torso";
  }

  /**
   * Trigger a Pain Resistance roll for an actor.
   * @param {Actor} actor The actor who received damage.
   * @returns {Promise<Roll|null>} The result of the roll.
   */
  static async triggerPainResistance(actor) {
    if (!actor) return null;

    // In Neuroshima 1.5, Pain Resistance is a skill roll based on Willpower (Charyzma)
    // We use our standard dice helper to initiate the test.
    const skillKey = "painResistance";
    const skillValue = actor.system.skills[skillKey]?.value || 0;
    const statKey = "charisma"; // Default for Pain Resistance
    const statValue = actor.system.attributes[statKey] || 10;

    // Notify the user
    ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.TriggeringPainResistance", { name: actor.name }));

    return game.neuroshima.NeuroshimaDice.rollTest({
        skill: skillValue,
        stat: statValue,
        label: game.i18n.localize("NEUROSHIMA.Skills.painResistance"),
        actor: actor,
        isOpen: false // Usually a closed test
    });
  }

  /**
   * Zmniejsza obrażenia i zwraca szczegółowe dane redukcji dla tooltipa.
   * @private
   */
  static reduceArmorDamageWithDetails(actor, location, damageType, piercing) {
    const reductionData = {
      originalDamage: damageType,
      piercing: piercing,
      location: location,
      armorDetails: [],
      totalArmor: 0,
      reduction: 0,
      reducedDamageType: null
    };

    // Get effective armor value at hit location (ratings - damage, must be equipped)
    const equipedArmor = actor.items.filter(item => 
      item.type === "armor" && item.system.equipped === true
    );
    
    let totalArmorRating = 0;
    for (const armor of equipedArmor) {
      const effectiveValue = armor.system.effectiveArmor?.[location] || 0;
      const ratings = armor.system.armor?.ratings?.[location] || 0;
      const damage = armor.system.armor?.damage?.[location] || 0;
      
      totalArmorRating += effectiveValue;
      reductionData.armorDetails.push({
        name: armor.name,
        ratings,
        damage,
        effective: effectiveValue
      });
    }

    reductionData.totalArmor = totalArmorRating;
    
    // Calculate reduction: Armor - Piercing
    const reduction = totalArmorRating - piercing;
    let actualReduction = 0;
    
    if (reduction >= 1) {
      actualReduction = Math.floor(reduction);
      if (reduction % 1 >= 0.5) {
        actualReduction += 1;
      }
    } else if (reduction > 0) {
      actualReduction = 1;
    }

    reductionData.reduction = actualReduction;
    
    // Get wound reduction points from config (not HP points!)
    const woundConfig = NEUROSHIMA.woundConfiguration[damageType];
    const baseDamagePoints = woundConfig?.damagePoints || 1;
    const reducedDamagePoints = Math.max(0, baseDamagePoints - actualReduction);
    
    // Map reduced points to damage type
    let reducedDamageType = null;
    
    if (reducedDamagePoints === 0) {
      reducedDamageType = null;
    } else if (reducedDamagePoints >= 4) {
      reducedDamageType = "K";
    } else if (reducedDamagePoints === 3) {
      reducedDamageType = "C";
    } else if (reducedDamagePoints === 2) {
      reducedDamageType = "L";
    } else {
      reducedDamageType = "D";
    }

    reductionData.reducedDamageType = reducedDamageType;
    reductionData.baseDamagePoints = baseDamagePoints;
    reductionData.reducedDamagePoints = reducedDamagePoints;

    return reductionData;
  }

  /**
   * Reduces damage based on actor's armor at the hit location.
   * Applies armor reduction logic: Armor Rating - Piercing = Real Reduction
   * If reduction is not complete (e.g., 2.5 armor, 2 piercing = 0.5), the remainder counts as 1 point.
   * 
   * Damage reduction uses wound reduction points (not HP points):
   * - Draśnięcie [D]: 1 pkt redukcji
   * - Lekka Rana [L]: 2 pkt redukcji
   * - Ciężka Rana [C]: 3 pkt redukcji
   * - Krytyczna Rana [K]: 4 pkt redukcji
   * 
   * @param {Actor} actor - Target actor
   * @param {string} location - Hit location (torso, head, etc.)
   * @param {string} damageType - Original damage type (D, L, C, K)
   * @param {number} piercing - Piercing value from weapon/ammo
   * @returns {string|null} Reduced damage type or null if completely negated
   */
  static reduceArmorDamage(actor, location, damageType, piercing) {
    game.neuroshima.group("CombatHelper | reduceArmorDamage");
    
    game.neuroshima.log("Kalkulacja efektywnego AP pancerza", {
      actor: actor.name,
      location,
      damageType,
      piercing
    });
    
    // Get effective armor value at hit location (ratings - damage, must be equipped)
    const equipedArmor = actor.items.filter(item => 
      item.type === "armor" && item.system.equipped === true
    );
    
    let totalArmorRating = 0;
    for (const armor of equipedArmor) {
      const effectiveValue = armor.system.effectiveArmor?.[location] || 0;
      const ratings = armor.system.armor?.ratings?.[location] || 0;
      const damage = armor.system.armor?.damage?.[location] || 0;
      
      game.neuroshima.log(`Pancerz: ${armor.name}`, {
        location,
        ratings,
        damage,
        effective: effectiveValue
      });
      
      totalArmorRating += effectiveValue;
    }
    
    game.neuroshima.log("Redukcja obrażeń przez pancerz", {
      actor: actor.name,
      location,
      damageType,
      piercing,
      totalArmorRating
    });
    
    // Calculate reduction: Armor - Piercing
    const reduction = totalArmorRating - piercing;
    let actualReduction = 0;
    
    if (reduction >= 1) {
      // Full point reduction
      actualReduction = Math.floor(reduction);
      
      // If there's a half point remainder, count it as 1 additional reduction
      if (reduction % 1 >= 0.5) {
        actualReduction += 1;
      }
    } else if (reduction > 0) {
      // Partial reduction (e.g., 0.5 or 0.25) counts as 1
      actualReduction = 1;
    }
    
    game.neuroshima.log("Kalkulacja redukcji pancerza", {
      rawReduction: reduction,
      actualReduction
    });
    
    // Get wound reduction points from config (not HP points!)
    const woundConfig = NEUROSHIMA.woundConfiguration[damageType];
    const baseDamagePoints = woundConfig?.damagePoints || 1;
    const reducedDamagePoints = Math.max(0, baseDamagePoints - actualReduction);
    
    game.neuroshima.log("Redukcja punktów obrażeń (punkty redukcji)", {
      baseDamagePoints,
      actualReduction,
      reducedDamagePoints
    });
    
    // Map reduced points to damage type
    let reducedDamageType = null;
    
    if (reducedDamagePoints === 0) {
      // No damage after reduction
      game.neuroshima.log("Obrażenia całkowicie zneutralizowane przez pancerz");
      reducedDamageType = null;
    } else if (reducedDamagePoints >= 4) {
      reducedDamageType = "K";
    } else if (reducedDamagePoints === 3) {
      reducedDamageType = "C";
    } else if (reducedDamagePoints === 2) {
      reducedDamageType = "L";
    } else {
      reducedDamageType = "D";
    }
    
    game.neuroshima.log("Ostateczny typ obrażeń", {
      originalType: damageType,
      reducedType: reducedDamageType
    });
    
    game.neuroshima.groupEnd();
    return reducedDamageType;
  }

  /**
   * Generuje dane Karty Pacjenta - zestawienie wszystkich ran aktora zgrupowanych po lokacjach
   * @param {Actor} actor - Aktor pacjenta
   * @returns {Object} Dane do szablonu karty pacjenta
   */
  static generatePatientCard(actor) {
    game.neuroshima.group("CombatHelper | generatePatientCard");
    
    // Sprawdzenie HP - mogą być na różnych ścieżkach
    const hpValue = actor.system.hp?.value ?? actor.system.health?.value ?? 0;
    const hpMax = actor.system.hp?.max ?? actor.system.health?.max ?? 27;
    
    game.neuroshima.log("Generowanie karty pacjenta:", { 
      actorName: actor.name,
      hpValue: hpValue,
      hpMax: hpMax,
      systemHp: actor.system.hp,
      systemHealth: actor.system.health
    });

    // Pobierz wszystkie rany
    const wounds = actor.items.filter(item => item.type === "wound");
    
    game.neuroshima.log("Znalezione rany:", { count: wounds.length, wounds: wounds.map(w => ({ name: w.name, location: w.system.location, type: w.system.damageType, penalty: w.system.penalty })) });

    // Zgrupuj rany po lokacjach
    const woundsByLocation = {};
    let totalPenalty = 0;

    for (const wound of wounds) {
      const location = wound.system.location || "unknown";
      const damageType = wound.system.damageType || "L";
      const penalty = wound.system.penalty || 0;

      totalPenalty += penalty;

      if (!woundsByLocation[location]) {
        woundsByLocation[location] = [];
      }

      // Pobierz pełną nazwę typu obrażenia z konfiguracji
      const woundConfig = NEUROSHIMA.woundConfiguration[damageType] || {};
      const fullWoundName = game.i18n.localize(woundConfig.fullLabel || "NEUROSHIMA.Items.Type.Wound");

      // Usuń "Rana" z nazwy jeśli na końcu
      let displayName = wound.name;
      if (displayName.endsWith(" Rana")) {
        displayName = displayName.slice(0, -5).trim();
      } else if (displayName.endsWith("Rana")) {
        displayName = displayName.slice(0, -4).trim();
      }

      // Estimate healing days: 1 day = 5% reduction
      const estimatedHealingDays = Math.ceil(penalty / 5);
      
      woundsByLocation[location].push({
        id: wound.id,
        name: displayName,
        damageType: damageType,
        fullWoundName: fullWoundName,
        penalty: penalty,
        isHealing: wound.system.isHealing || false,
        healingDays: wound.system.healingDays || 0,
        hadFirstAid: wound.system.hadFirstAid || false,
        healingAttempts: wound.system.healingAttempts || 0,
        estimatedHealingDays: estimatedHealingDays
      });
    }

    // Konwertuj do tablicy z informacjami o lokacjach (wszystkie lokacje, nawet bez ran)
    const locationsList = Object.entries(NEUROSHIMA.bodyLocations).map(([locationKey, locationData]) => {
      const wounds = woundsByLocation[locationKey] || [];
      const locationLabel = locationData.label || "NEUROSHIMA.Location.Unknown";
      return {
        key: locationKey,
        label: game.i18n.localize(locationLabel),
        wounds: wounds
      };
    }).sort((a, b) => a.label.localeCompare(b.label));

    const patientCardData = {
      actorName: actor.name,
      actorId: actor.id,
      actorImg: actor.img,
      totalHP: hpMax,
      currentHP: hpValue,
      totalPenalty: totalPenalty,
      woundCount: wounds.length,
      locations: locationsList,
      hasWounds: wounds.length > 0,
      config: NEUROSHIMA
    };

    game.neuroshima.log("Karta pacjenta wygenerowana:", { 
      actorName: patientCardData.actorName,
      currentHP: patientCardData.currentHP,
      totalHP: patientCardData.totalHP,
      woundCount: patientCardData.woundCount
    });
    game.neuroshima.groupEnd();

    return patientCardData;
  }

}
