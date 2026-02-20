import { NEUROSHIMA } from "../config.js";

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
    if (!flags || !flags.isWeapon) return false;
    
    const actor = game.actors.get(flags.actorId);
    if (!actor) return false;

    const bulletSequence = flags.bulletSequence;
    if (!bulletSequence || bulletSequence.length === 0) return false;

    // Refund ammo in reverse order (LIFO)
    const refundSequence = [...bulletSequence].reverse();

    const magazineId = flags.magazineId;
    const ammoId = flags.ammoId;

    if (magazineId) {
        const magazine = actor.items.get(magazineId);
        if (magazine && magazine.type === "magazine") {
            const contents = JSON.parse(JSON.stringify(magazine.system.contents || []));
            
            for (const bullet of refundSequence) {
                const lastStack = contents[contents.length - 1];
                
                // Compare with current stack to see if we can merge
                if (this._isSameAmmo(lastStack, bullet)) {
                    lastStack.quantity += 1;
                } else {
                    contents.push({
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
                    });
                }
            }
            
            await magazine.update({ "system.contents": contents });
            
            ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.AmmoRefunded", { 
                amount: bulletSequence.length, 
                name: magazine.name 
            }));

            await message.setFlag("neuroshima", "ammoRefunded", true);
            return true;
        }
    } else if (ammoId) {
        // Handle thrown weapons (direct ammo consumption)
        const ammo = actor.items.get(ammoId);
        if (ammo && ammo.type === "ammo") {
            await ammo.update({ "system.quantity": ammo.system.quantity + bulletSequence.length });
            
            ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.AmmoRefunded", { 
                amount: bulletSequence.length, 
                name: ammo.name 
            }));

            await message.setFlag("neuroshima", "ammoRefunded", true);
            return true;
        }
    }

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
   * Apply damage from a weapon roll to a set of actors.
   * @param {ChatMessage} message The roll chat message.
   * @param {Array<Actor>} actors Array of actors to apply damage to.
   * @returns {Promise<void>}
   */
  static async applyDamage(message, actors) {
    const flags = message.getFlag("neuroshima", "rollData");
    
    game.neuroshima.group("CombatHelper | applyDamage");
    game.neuroshima.log("Parametry wejściowe:", { messageId: message.id, flags, actors: actors.map(a => a.name) });

    if (!flags || !flags.isWeapon) {
        game.neuroshima.log("Błąd: Brak flag lub wiadomość nie dotyczy broni.");
        game.neuroshima.groupEnd();
        return;
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
    
    // If it's a failure but GM is forcing damage, we need at least one bullet's worth of data
    if (hitBulletsData.length === 0 && isGM) {
        game.neuroshima.log("Ostrzeżenie: Brak danych o trafieniach. Używam danych bazowych dla wymuszenia obrażeń przez MG.");
        if (flags.bulletSequence && flags.bulletSequence.length > 0) {
            hitBulletsData = [flags.bulletSequence[0]];
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

    const location = flags.finalLocation || "torso";
    const isMelee = flags.isMelee;
    
    game.neuroshima.log("Logika obrażeń:", { isMelee, hitBulletsData, location });

    for (const actor of actors) {
        game.neuroshima.log(`Przetwarzanie aktora: ${actor.name}`);
        const sourceInfo = `<p><em>Źródło: ${flags.label || "Broń"} (${message.id})</em></p>`;
        
        // Przygotowanie listy surowych danych o ranach
        const rawWounds = [];

        if (isMelee) {
            const damageType = flags.damage || "L";
            rawWounds.push({
                name: game.i18n.localize(NEUROSHIMA.woundConfiguration[damageType]?.fullLabel || "NEUROSHIMA.Items.Type.Wound"),
                damageType: damageType
            });
        } else {
            for (const bullet of hitBulletsData) {
                const count = bullet.isPellet ? (bullet.successPoints || 1) : 1;
                const damageType = bullet.damage || (bullet.isPellet ? "D" : "L");
                
                for (let i = 0; i < count; i++) {
                    rawWounds.push({
                        name: game.i18n.localize(NEUROSHIMA.woundConfiguration[damageType]?.fullLabel || "NEUROSHIMA.Items.Type.Wound"),
                        damageType: damageType
                    });
                }
            }
        }

        if (rawWounds.length > 0) {
            // Wykonaj testy odporności na ból i uzyskaj finalne dane ran z karami
            const { processedWounds, results } = await this.processPainResistance(actor, rawWounds, location, sourceInfo);
            
            game.neuroshima.log(`Tworzenie ${processedWounds.length} ran dla ${actor.name}`, processedWounds);
            const createdWounds = await actor.createEmbeddedDocuments("Item", processedWounds);
            const woundIds = createdWounds.map(w => w.id);

            ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.DamageApplied", { 
                count: processedWounds.length, 
                name: actor.name 
            }));

            // Renderowanie raportu na czacie
            await this.renderPainResistanceReport(actor, results, woundIds);
        } else {
            game.neuroshima.log(`Nie wygenerowano żadnych ran dla ${actor.name}`);
        }
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
        const baseDifficultyKey = config?.difficulty || "average";
        const baseDifficulty = NEUROSHIMA.difficulties[baseDifficultyKey];
        
        // Rzut odporności na ból (test ZAMKNIĘTY zgodnie z zasadami 1.5, ignoruje kary z ran/pancerza)
        const roll = new Roll("3d20");
        await roll.evaluate();
        const diceResults = roll.terms[0].results.map(r => r.result);
        
        // Obliczanie Suwaka (tylko umiejętność i kości naturalne)
        const skillShift = game.neuroshima.NeuroshimaDice.getSkillShift(skillValue);
        const diceShift = game.neuroshima.NeuroshimaDice.getDiceShift(diceResults);
        const totalShift = skillShift + diceShift;
        
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
        const appliedPenalty = isPassed ? (config.penalties[0] || 0) : (config.penalties[1] || 0);
        
        results.push({
            name: wound.name,
            damageType,
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
   * Renderuje raport z testów odporności na ból do czatu korzystając z HBS.
   */
  static async renderPainResistanceReport(actor, results, woundIds) {
    const template = "systems/neuroshima/templates/chat/pain-resistance-report.hbs";
    const passedCount = results.filter(r => r.isPassed).length;
    const failedCount = results.length - passedCount;

    // Przygotuj wyniki z tooltipami (miniaturowa wersja rzutu na skill)
    const resultsWithTooltips = results.map(r => {
        let diceHtml = '<div class="dice-results-grid tiny">';
        r.modifiedResults.forEach((d, i) => {
            diceHtml += `
                <div class="die-result ${d.ignored ? 'ignored' : ''}">
                    <span class="die-label tiny">D${i+1}=</span>
                    <div class="die-square-container tiny">
                        <span class="die-square original tiny ${d.isNat1 ? 'nat-1' : ''} ${d.isNat20 ? 'nat-20' : ''}">${d.original}</span>
                        ${r.skill > 0 && !d.ignored ? `
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
                    ${game.i18n.localize(r.difficulty)}
                </header>
                <hr class="dotted-hr tiny">
                ${diceHtml}
                <hr class="dotted-hr tiny">
                <footer class="roll-outcome tiny">
                    <div class="outcome-item">
                        <span class="label">${game.i18n.localize('NEUROSHIMA.Roll.Target')}:</span>
                        <span class="value">${r.target}</span>
                    </div>
                    <div class="outcome-item">
                        <span class="label">${game.i18n.localize('NEUROSHIMA.Roll.SuccessPointsAbbr')}:</span>
                        <span class="value"><strong>${r.successPoints}</strong></span>
                    </div>
                </footer>
            </div>
        `.trim();

        return { ...r, tooltip };
    });
    
    const data = {
        actorId: actor.id,
        actorUuid: actor.uuid,
        actorName: actor.name,
        woundIds: woundIds,
        results: resultsWithTooltips,
        passedCount: passedCount,
        failedCount: failedCount,
        isGM: game.user.isGM,
        isReversed: false
    };

    const content = await foundry.applications.handlebars.renderTemplate(template, data);

    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        flags: {
            neuroshima: {
                isPainResistanceReport: true,
                actorId: actor.id,
                actorUuid: actor.uuid,
                woundIds: woundIds,
                isReversed: false
            }
        }
    });
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
}
