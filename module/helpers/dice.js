import { NEUROSHIMA } from "../config.js";
import { NeuroshimaChatMessage } from "../documents/chat-message.js";
import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

/**
 * Helper class for Neuroshima 1.5 dice rolling logic.
 */
export class NeuroshimaDice {
  /**
   * Rolls initiative (Dexterity, Open Test).
   * @param {Object} params 
   * @returns {Promise<Object>} Roll data and SP result
   */
  static async rollInitiative(params) {
    const { 
        actor, 
        attribute = "dexterity", 
        skill = "", 
        useSkill = true, 
        difficulty = "average", 
        modifier = 0, 
        useArmorPenalty = false, 
        useWoundPenalty = true, 
        useDiseasePenalty = true,
        diseasePenalty: rawInitDiseasePenalty = 0,
        attributeBonus = 0, 
        skillBonus = 0, 
        isMeleeInitiative = false, 
        maneuver = "none",
        chargeLevel = 0,
        rollMode = game.settings.get("core", "rollMode") 
    } = params;
    
    game.neuroshima.group(`Initiative Roll: ${actor.name}`);
    
    // Check for Charge maneuver bonus
    let chargeBonus = 0;
    if (maneuver === "charge") {
        chargeBonus = chargeLevel || 2;
    } else if (isMeleeInitiative) {
        // Fallback to active encounter if not provided in params
        const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
        const encounter = NeuroshimaMeleeCombat.findActiveEncounterForActor(actor);
        if (encounter) {
            const p = encounter.participants[actor.uuid] || encounter.participants[actor.id];
            if (p && p.maneuver === "charge") {
                chargeBonus = p.chargeLevel || 2; 
            }
        }
    }

    // 1. Read attribute and skill values
    const attrValue = Number(actor.system.attributeTotals[attribute]) || 10;
    const isCreatureActor = actor?.type === "creature";
    const skillValue = useSkill
        ? (skill === "experience" && isCreatureActor
            ? (actor.system.experience ?? 0)
            : (Number(actor.system.skills[skill]?.value) || 0))
        : 0;
    
    // 2. Compute penalty modifiers (%)
    const basePenalty = NEUROSHIMA.difficulties[difficulty]?.min || 0;
    const armorPenalty = useArmorPenalty ? (actor.system.combat?.totalArmorPenalty || 0) : 0;
    const woundPenalty = useWoundPenalty ? (actor.system.combat?.totalWoundPenalty || 0) : 0;
    const initDiseasePenalty = useDiseasePenalty ? (rawInitDiseasePenalty || 0) : 0;
    const totalPenalty = basePenalty + modifier + armorPenalty + woundPenalty + initDiseasePenalty;
    
    const baseDiffObj = NEUROSHIMA.difficulties[difficulty] || NEUROSHIMA.difficulties.average;
    
    // 3. Execute the initiative test (Open Test)
    const rollResult = await this.rollTest({
        stat: attrValue + chargeBonus,
        skill: skillValue,
        penalties: {
            mod: modifier,
            base: basePenalty,
            armor: armorPenalty,
            wounds: woundPenalty,
            disease: initDiseasePenalty
        },
        isOpen: true,
        isInitiative: true,
        label: game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeTest"),
        actor: actor,
        attributeBonus: attributeBonus,
        skillBonus: skillBonus,
        rollMode: rollMode,
        chatMessage: false,
        attributeKey: attribute,
        skillKey: skill
    });

    const initiativeArgs = {
        actor,
        successPoints: rollResult.successPoints,
        rollData: rollResult,
        roll: rollResult.roll,
        attributeKey: attribute,
        skillKey: skill
    };
    await NeuroshimaScriptRunner.execute("getInitiativeFormula", initiativeArgs);
    rollResult.successPoints = initiativeArgs.successPoints ?? rollResult.successPoints;
    
    // Add tooltip to rollResult for reuse in duels
    rollResult.tooltip = this._buildOpenTestTooltip(rollResult, "NEUROSHIMA.MeleeOpposed.InitiativeTest");
    
    // 4. Post the roll result to chat (unless disabled)
    if (params.chatMessage !== false) {
        const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
        const rollMessage = await NeuroshimaChatMessage.renderInitiativeRoll(rollResult, actor, rollResult.roll);
        
        // Dice So Nice integration: wait for the animation before returning the result
        if (game.dice3d) {
            await new Promise((resolve) => {
                const timeout = setTimeout(resolve, 5000); // Fail-safe timeout
                Hooks.once("diceSoNiceRollComplete", (messageId) => {
                    if (messageId === rollMessage.id) {
                        clearTimeout(timeout);
                        resolve();
                    }
                });
            });
        }
    } else if (game.dice3d) {
        // No chat message (e.g. background roll), but still show 3D dice animation
        await game.dice3d.showForRoll(rollResult.roll, game.user, true);
    }

    game.neuroshima.log("Wynik inicjatywy:", rollResult.successPoints);
    game.neuroshima.groupEnd();
    
    return rollResult;
  }

  /**
   * Perform a weapon-specific roll (shooting or striking).
   */
  static async rollWeaponTest(params) {
    const { 
        weapon, 
        actor, 
        aimingLevel, 
        burstLevel, 
        difficulty, 
        hitLocation, 
        modifier, 
        applyArmor, 
        applyWounds, 
        applyDisease = true,
        diseasePenalty: rawDiseasePenalty = 0,
        isOpen, 
        skillBonus = 0, 
        attributeBonus = 0, 
        distance = 0,
        distancePenalty = 0,
        meleeAction = "attack", 
        maneuver = "none",
        tempoLevel = 0,
        isReroll = false, 
        chatMessage = true, 
        rollMode = game.settings.get("core", "rollMode"),
        options = {}
    } = params;
    
    // Open log group for this weapon roll
    game.neuroshima.group("Initializing weapon roll");
    game.neuroshima.log("Roll input parameters:", params);

    let bulletSequence = [];
    
    // Apply maneuver modifiers
    let effectiveAttributeBonus = attributeBonus;
    let effectiveDifficulty = difficulty;
    
    const isMelee = weapon.system.weaponType === "melee";
    
    if (isMelee) {
        if (maneuver === "fury" || maneuver === "fullDefense") {
            effectiveAttributeBonus += 2;
        } else if (maneuver === "increasedTempo") {
            const baseDiffObj = NEUROSHIMA.difficulties[difficulty] || NEUROSHIMA.difficulties.average;
            const shifted = this._getShiftedDifficulty(baseDiffObj, tempoLevel);
            // Find key for shifted difficulty
            effectiveDifficulty = Object.keys(NEUROSHIMA.difficulties).find(k => NEUROSHIMA.difficulties[k].label === shifted.label) || difficulty;
        }
    }

    // 1. Compute percentage penalties (base difficulty, wounds, armor, location, disease)
    const basePenalty = NEUROSHIMA.difficulties[effectiveDifficulty]?.min || 0;
    const armorPenalty = applyArmor ? (actor.system.combat?.totalArmorPenalty || 0) : 0;
    const woundPenalty = applyWounds ? (actor.system.combat?.totalWoundPenalty || 0) : 0;
    const diseasePenalty = applyDisease ? (rawDiseasePenalty || 0) : 0;
    
    // Weapon bonus for melee
    let weaponBonus = 0;
    const bonusMode = game.settings.get("neuroshima", "meleeBonusMode") || "attribute";
    if (isMelee) {
        weaponBonus = meleeAction === "attack" ? (weapon.system.attackBonus || 0) : (weapon.system.defenseBonus || 0);
    }

    const locationPenalty = this.getLocationPenalty(weapon.system.weaponType, hitLocation);
    const totalPenalty = basePenalty + modifier + armorPenalty + woundPenalty + diseasePenalty + locationPenalty + distancePenalty;

    game.neuroshima.log("Kalkulacja kar (%)", {
        basePenalty,
        effectiveDifficulty,
        modifier,
        armorPenalty,
        woundPenalty,
        locationPenalty,
        distancePenalty,
        totalPenalty,
        weaponBonus,
        effectiveAttributeBonus
    });

    // 2. Aiming level and dice count
    // Ranged weapons: 1-3 dice depending on aiming level (best die wins).
    // Melee: always 3 dice (3d20 test rule).
    const diceCount = isMelee ? 3 : (aimingLevel + 1);
    
    // Compute base damage (will be updated later for ranged ammo)
    let damageValue = isMelee 
        ? [weapon.system.damageMelee1, weapon.system.damageMelee2, weapon.system.damageMelee3].filter(d => d).join("/")
        : (weapon.system.damage || "0");

    // Roll the dice
    const roll = new Roll(`${diceCount}d20`);
    await roll.evaluate();
    
    // Collect results and find the best die (lowest value)
    const results = roll.terms[0].results.map(r => r.result);
    const rawResults = results.map(v => ({
        value: v,
        isNat1: v === 1,
        isNat20: v === 20
    }));
    const bestResult = Math.min(...results);

    // Final open/closed state — melee always uses a closed 3d20 test
    let finalIsOpen = isOpen;
    if (isMelee) {
        finalIsOpen = false;
    }

    game.neuroshima.log("Dice roll results", {
        weaponType: weapon.system.weaponType,
        diceCount,
        results,
        bestResult,
        finalIsOpen
    });

    // 3. Hit location — roll randomly if 'random' was selected
    let finalLocation = hitLocation;
    let locationRoll = null;
    if (hitLocation === "random") {
        locationRoll = await new Roll("1d20").evaluate();
        const rollVal = locationRoll.total;
        const entry = Object.entries(NEUROSHIMA.bodyLocations).find(([key, data]) => {
            return rollVal >= data.roll[0] && rollVal <= data.roll[1];
        });
        finalLocation = entry ? entry[0] : "torso";
        game.neuroshima.log("Hit location rolled", { roll: rollVal, location: finalLocation });
    }

    // 4. Burst fire — determine number of bullets fired
    let bulletsFired = this.getBulletsFired(weapon, burstLevel);
    const burstLabel = game.i18n.localize(NEUROSHIMA.burstLabels[burstLevel] || NEUROSHIMA.burstLabels[0]);

    game.neuroshima.log("Planning burst sequence", { bulletsFired, burstType: burstLabel });

    // 4.1. Magazine handling and ammo consumption (LIFO)
    let ammoDamage = weapon.system.damage;
    let ammoPiercing = weapon.system.piercing || 0;
    let ammoJamming = weapon.system.jamming || 20;
    
    const magazineId = weapon.system.magazine;
    const magazine = magazineId ? actor.items.get(magazineId) : null;
    
    const isRanged = weapon.system.weaponType === "ranged";
    const isThrown = weapon.system.weaponType === "thrown";

    // Validate ammo availability for ranged weapons
    if ((isRanged || isThrown) && !magazine) {
        if (weapon.system.caliber) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoMagazineSelected"));
            game.neuroshima.log("Rzut przerwany: brak wybranego magazynka");
            game.neuroshima.groupEnd();
            return;
        }
    }

    // Pull bullets from the magazine and track its new state (informational pass before the roll)
    let magazineUpdateData = null;
    if (magazine && magazine.type === "magazine") {
        game.neuroshima.log("Planning magazine ammo consumption (LIFO)");
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
        
        // Adjust bullet count to what was actually available in the magazine
        const actualFired = bulletsFired - remainingToConsume;
        bulletsFired = actualFired;
        magazineUpdateData = contents;

        // Build bullet sequence with per-bullet stat overrides (special ammo)
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
        
        // The first bullet in the sequence defines base roll stats;
        // jam threshold is taken from the worst (lowest) value across the sequence.
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
        // Special handling for bows/slings (ammo drawn directly from inventory)
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

    // 5. Compute skill value and success threshold (must run before jam triggers)
    const baseDifficulty = this.getDifficultyFromPercent(totalPenalty);

    let skillValue = 0;
    let skillKey = weapon.system.skill;
    if (!skillKey || skillKey === "none") {
        const attrGroups = NEUROSHIMA.skillConfiguration[weapon.system.attribute || "dexterity"] || {};
        const firstGroup = Object.values(attrGroups)[0] || [];
        skillKey = firstGroup[0] || "";
    }
    if (skillKey && skillKey !== "none") {
        const isCreature = actor?.type === "creature";
        const baseSkill = (skillKey === "experience" && isCreature)
            ? (actor.system.experience ?? 0)
            : (actor.system.skills[skillKey]?.value || 0);
        skillValue = baseSkill + skillBonus;
        if (isMelee) {
            if (bonusMode === "skill" || bonusMode === "both") skillValue += weaponBonus;
        } else {
            skillValue += weaponBonus;
        }
    }

    let totalShift = 0;
    const allowCombatShift = game.settings.get("neuroshima", "allowCombatShift");
    if (allowCombatShift) {
        if (!isMelee) totalShift -= this.getSkillShift(skillValue);
        totalShift += this.getDiceShift(results);
    }

    const shiftedDifficulty = this._getShiftedDifficulty(baseDifficulty, totalShift);
    const finalDiff = shiftedDifficulty;

    const baseAttr = Number(actor.system.attributeTotals[weapon.system.attribute]) || 10;
    let finalStat = baseAttr + effectiveAttributeBonus;
    if (isMelee && (bonusMode === "attribute" || bonusMode === "both")) finalStat += weaponBonus;
    const target = finalStat + finalDiff.mod;

    game.neuroshima.log("Difficulty and Slider calculation", {
        baseDifficulty: baseDifficulty.label,
        sliderShift: totalShift,
        finalDifficulty: finalDiff.label,
        successThreshold: target,
        skillValue,
        finalStat
    });

    // Preliminary success check for jam trigger evaluation
    const _jamModified = Math.max(1, bestResult - skillValue);
    const jamWouldSucceed = !isMelee && bestResult !== 20 && _jamModified <= target;
    game.neuroshima.log("[JamCheck] jamWouldSucceed calculation", {
        isMelee,
        bestResult,
        skillValue,
        modifiedResult: _jamModified,
        target,
        jamWouldSucceed
    });

    // 5.1 Weapon jam check
    const weaponJammingValue = weapon.system.jamming || 20;
    let jammingThreshold = Math.min(weaponJammingValue, ammoJamming);

    // preWeaponShot: scripts can shift the threshold or force/prevent jamming
    const rollAnnotations = [];
    const preJamArgs = { actor, weapon, jammingThreshold, ammoJamming, bestResult, forceNoJam: false, forceJam: false, annotations: rollAnnotations, options };
    if (!isMelee) await NeuroshimaScriptRunner.execute("preWeaponShot", preJamArgs);
    jammingThreshold = preJamArgs.jammingThreshold;

    // Jam is checked against the BEST die (lowest roll) before any skill modifier is applied.
    let isJamming = isMelee        ? false
                  : preJamArgs.forceNoJam ? false
                  : preJamArgs.forceJam   ? true
                  : (bestResult >= jammingThreshold);

    // weaponJam: scripts can allow firing despite jam, or clear the jam entirely
    let canFireDespiteJam = false;
    let despiteJamBullets  = null;
    let jamWasCleared = false;
    if (isJamming) {
        const jamArgs = { actor, weapon, bestResult, jammingThreshold, wouldSucceed: jamWouldSucceed, canFireDespiteJam: false, clearJam: false, despiteJamBullets: null, annotations: rollAnnotations, options };
        await NeuroshimaScriptRunner.execute("weaponJam", jamArgs);
        canFireDespiteJam = jamArgs.canFireDespiteJam;
        if (jamArgs.clearJam) { isJamming = false; jamWasCleared = true; }
        if (canFireDespiteJam && typeof jamArgs.despiteJamBullets === "number" && jamArgs.despiteJamBullets > 0) {
            despiteJamBullets = Math.floor(jamArgs.despiteJamBullets);
        }
    }

    // Consume ammo: deduct if the weapon did NOT jam, OR a trick allows firing despite the jam
    if (!isJamming || canFireDespiteJam) {
        if (magazine && magazine.type === "magazine" && magazineUpdateData) {
            await magazine.update({ "system.contents": magazineUpdateData });
            game.neuroshima.log("Ammo consumed (no jam)");
        } else if (weapon.system.weaponType === "thrown" && magazineId && bulletsFired > 0) {
            const ammoItem = actor.items.get(magazineId);
            if (ammoItem && ammoItem.type === "ammo") {
                await ammoItem.update({ "system.quantity": ammoItem.system.quantity - 1 });
                game.neuroshima.log("Thrown ammo consumed (no jam)");
            }
        }
    } else {
        game.neuroshima.log("JAM: Ammo was NOT consumed");
    }

    let modifiedResults = [];
    let isSuccess = false;
    let successPoints = 0;
    let successCount = 0;
    let hitBullets = 0;
    let finalHitSequence = [];

    let totalPelletSP = 0;

    // Evaluate results by weapon type (Melee = 3d20 closed, Ranged = best of X)
    if (isMelee) {
        game.neuroshima.log("Starting Melee evaluation (3d20)");
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
            modifiedResults = evalData.modifiedResults;
        } else {
            const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");
            if (doubleSkill) {
                evalData.modifiedResults = diceObjects.map(d => ({
                    ...d,
                    modified: d.original,
                    isSuccess: d.original <= target && d.original !== 20,
                    isNat1: d.original === 1,
                    isNat20: d.original === 20
                }));
                const succCount = evalData.modifiedResults.filter(r => r.isSuccess).length;
                successPoints = succCount;
                isSuccess = succCount > 0;
                successCount = succCount;
            } else {
                this._evaluateClosedTest(evalData, diceObjects);
                successPoints = evalData.successCount;
                isSuccess = evalData.successCount > 0;
                successCount = evalData.successCount;
            }
            modifiedResults = evalData.modifiedResults;
        }
        
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
        game.neuroshima.log("Starting Ranged evaluation (best die)");
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

        // Advantage Points for ranged weapons: Target - (Best die - Skill)
        const modifiedBest = Math.max(1, bestResult - skillValue);
        const overflow = target - modifiedBest;
        
        if (finalIsOpen) {
            isSuccess = overflow >= 0;
            successPoints = overflow;
        } else {
            isSuccess = modifiedBest <= target && bestResult !== 20;
            successPoints = isSuccess ? 1 : 0;
        }

        // Number of successes for burst and pellet purposes (AP + 1)
        const pp = isSuccess ? (overflow + 1) : 0;

        // Evaluate hits in the burst (individually per bullet)
        if (isSuccess && (!isJamming || canFireDespiteJam)) {
            const usePelletCountLimit = game.settings.get("neuroshima", "usePelletCountLimit");
            let totalPelletHits = 0;

            // If a script set a bullet limit for despite-jam firing, cap the loop.
            // When canFireDespiteJam=true with no helper (despiteJamBullets=null), default to 1 bullet.
            const effectiveBullets = canFireDespiteJam
                ? Math.min(bulletsFired, despiteJamBullets ?? 1)
                : bulletsFired;

            // Iterate over every fired bullet (casing)
            for (let j = 0; j < effectiveBullets; j++) {
                // Bullet j hits only when our Advantage Points (pp) exceed j
                if (pp <= j) break; 

                const bullet = bulletSequence[j];
                if (!bullet) break;

                if (bullet.isPellet) {
                    // PELLET LOGIC for this specific casing
                    const basePelletDamage = this.getPelletDamageAtDistance(bullet.pelletRanges, distance);
                    
                    // Each subsequent burst bullet (j) reduces max pellets per shell by j.
                    // pp - j is the available Advantage Points for this specific shell.
                    const capacityPenalty = j;
                    const maxPelletsInShell = Math.max(0, (bullet.pelletCount || 1) - capacityPenalty);
                    
                    // Pellet count is the lesser of remaining AP and current shell capacity
                    let pelletsForThisShell = Math.max(0, pp - j);
                    
                    // Always cap to physical pellets in the shell (reduced by burst penalty);
                    // optionally apply the pellet count limit setting.
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
                    // Standard bullet logic
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

            // Commit hit results
            hitBullets = finalHitSequence.length;
            totalPelletSP = totalPelletHits;
        } else {
            hitBullets = 0;
            totalPelletSP = 0;
        }
    }

    game.neuroshima.log("Final test result", { isSuccess, successPoints, isJamming, hitBullets, jammingOnDie: results[0] });

    // 6a. Korygowanie Ognia (Fire Correction) — tylko dla nieudanej serii dystansowej
    let fireCorrectionData = null;
    const fireCorrectionEnabled = game.settings.get("neuroshima", "fireCorrection");
    if (fireCorrectionEnabled && !isMelee && !isJamming && burstLevel > 0 && bulletsFired > 0) {
        if (!isSuccess) {
            const modifiedBest = Math.max(1, bestResult - skillValue);
            const failureMargin = modifiedBest - target;
            if (failureMargin > 0) {
                const totalCorrectionCost = failureMargin * 3;
                const canCorrect = totalCorrectionCost < bulletsFired;
                fireCorrectionData = { failureMargin, totalCorrectionCost, bulletsFired, canCorrect, isSuccessCorrection: false };
                game.neuroshima.log("Fire Correction (failure)", fireCorrectionData);
            }
        } else {
            const remainingForCorrection = bulletsFired - hitBullets;
            const maxCorrectionHits = Math.floor(remainingForCorrection / 4);
            const canCorrect = maxCorrectionHits > 0;
            fireCorrectionData = { failureMargin: 0, totalCorrectionCost: 3, bulletsFired, hitBullets, remainingForCorrection, maxCorrectionHits, canCorrect, isSuccessCorrection: true };
            game.neuroshima.log("Korygowanie Ognia (sukces — dodatkowe trafienia)", fireCorrectionData);
        }
    }

    // 6. Build chat card roll data
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
        actorImg: actor.img,
        damage: damageValue,
        piercing: ammoPiercing,
        isJamming,
        firedDespiteJam: canFireDespiteJam,
        bestResult,
        modifiedResults,
        results,
        rawResults,
        target,
        skill: skillValue,
        baseSkill: skillValue - skillBonus,
        skillBonus: skillBonus,
        baseStat: finalStat - attributeBonus,
        attributeBonus: attributeBonus,
        stat: finalStat,
        maneuver,
        tempoLevel,
        isReroll,
        isSuccess,
        successPoints,
        hitBullets,
        totalPelletSP: totalPelletSP || 0,
        isPellet: !!bulletSequence[0]?.isPellet,
        isOpen: finalIsOpen,
        applyArmor,
        applyWounds,
        hitLocation,
        modifier,
        weaponId: weapon.id,
        actorId: actor.id,
        finalLocation,
        locationLabel: NEUROSHIMA.bodyLocations[finalLocation]?.label || finalLocation,
        locationRoll: locationRoll?.total,
        bulletsFired,
        totalPenalty,
        baseDifficultyLabel: NEUROSHIMA.difficulties[effectiveDifficulty]?.label || finalDiff.label,
        difficultyLabel: finalDiff.label,
        isCritSuccess: bestResult === 1,
        isCritFailure: (bestResult === 20 || isJamming),
        showTooltip: true,
        burstLevel,
        aimingLevel,
        distance,
        rollMode,
        debugMode: game.settings.get("neuroshima", "debugMode"),
        magazineId: (isRanged || isThrown) ? weapon.system.magazine : null,
        ammoId: (isThrown) ? weapon.system.magazine : null,
        penalties: {
            mod: modifier,
            armor: armorPenalty,
            wounds: woundPenalty,
            disease: diseasePenalty,
            location: locationPenalty,
            base: basePenalty
        },
        bulletSequence: bulletSequence || [],
        hitBulletsData: finalHitSequence,
        fireCorrectionData
    };

    // Generate rich tooltip for weapon test
    if (finalIsOpen) {
        rollData.tooltip = this._buildOpenTestTooltip(rollData, weapon.name);
    } else {
        rollData.tooltip = this._buildClosedTestTooltip(rollData, weapon.name);
    }

    // Group hits with identical damage/piercing for compact display
    this._groupHitsData(rollData);

    // postWeaponShot: scripts can react to the completed shot result (ranged/thrown only)
    if (!isMelee) {
        const postShotArgs = { actor, weapon, isSuccess, isJamming, firedDespiteJam: canFireDespiteJam, despiteJamBullets, hitBullets, bulletsFired, successPoints, rollData, annotations: rollAnnotations, options };
        await NeuroshimaScriptRunner.execute("postWeaponShot", postShotArgs);
    }
    rollData.annotations = rollAnnotations.filter(Boolean);

    // Update weapon jammed flag
    if (!isMelee) {
        if (isJamming) {
            await weapon.update({ "system.jammed": true });
        } else if (weapon.system.jammed && (isReroll || jamWasCleared)) {
            await weapon.update({ "system.jammed": false });
        }
    }

    game.neuroshima.log("Generowanie karty czatu", rollData);
    game.neuroshima.groupEnd();

    // In v1.5 melee is managed by MeleeDuel and the combat tracker.
    // The standard chat card is rendered only when the roll has not been
    // intercepted by pool-roll logic (chatMessage: false).
    if (!chatMessage) {
        return {
            ...rollData,
            roll
        };
    }

    const rollMessage = await NeuroshimaChatMessage.renderWeaponRoll(rollData, actor, roll);

    if (rollMessage) {
        const flags = rollMessage.getFlag("neuroshima", "rollData") ?? {};
        flags.messageId = rollMessage.id;
        await rollMessage.setFlag("neuroshima", "rollData", flags);
    }

    return rollMessage;
  }

  /**
   * Groups hits with identical damage and piercing for more readable card display.
   * @private
   */
  static _groupHitsData(rollData) {
    if (!rollData.hitBulletsData || rollData.hitBulletsData.length === 0) return;
    
    const hits = rollData.hitBulletsData;
    
    // Group damage — count pellet successPoints as individual wounds
    const counts = hits.reduce((acc, h) => {
        const amount = h.isPellet ? (h.successPoints || 1) : 1;
        acc[h.damage] = (acc[h.damage] || 0) + amount;
        return acc;
    }, {});
    
    // Omit the "1x" prefix when there is only a single wound
    const totalWounds = Object.values(counts).reduce((a, b) => a + b, 0);
    
    rollData.damage = Object.entries(counts)
        .map(([damage, count]) => totalWounds > 1 ? `${count}x${damage}` : damage)
        .join(", ");

    // Group piercing values
    const pCounts = hits.reduce((acc, h) => {
        acc[h.piercing] = (acc[h.piercing] || 0) + 1;
        return acc;
    }, {});
    
    rollData.piercing = Object.entries(pCounts)
        .map(([piercing, count]) => hits.length > 1 ? `${count}x${piercing}` : piercing)
        .join(", ");
    
    // Mark the card as pellet if at least one hit is a pellet
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
    return NEUROSHIMA.difficulties.grandmasterful;
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
   * @param {string} [params.rollMode] - The roll mode to use (default: core setting)
   */
  static async rollTest({ stat, skill = 0, penalties = { mod: 0, wounds: 0, armor: 0 }, isOpen = false, isCombat = false, isDebug = false, isReroll = false, fixedDice = null, label = "", actor = null, skillBonus = 0, attributeBonus = 0, meleeAction = "attack", rollMode = game.settings.get("core", "rollMode"), chatMessage = true, isInitiative = false, attributeKey = null, skillKey = null, options = {}, resultCallback = null } = {}) {
    game.neuroshima.log("rollTest started", { stat, skill, label, actor: actor?.name, isInitiative });
    if (isNaN(stat)) {
        game.neuroshima.warn("rollTest received NaN stat!", { stat, label });
    }
    // Open log group for this standard roll
    game.neuroshima.group(`Inicjalizacja testu: ${label || "Standard"}`);

    const testAnnotations = [];
    if (actor && !isReroll && !isDebug) {
        const preArgs = { actor, stat, skill, skillBonus, attributeBonus, penalties: { ...penalties }, label, attributeKey, skillKey, autoSuccess: false, cancelled: false, annotations: testAnnotations, options };
        await NeuroshimaScriptRunner.execute("preRollTest", preArgs);
        if (preArgs.cancelled) {
            game.neuroshima.log("rollTest cancelled by preRollTest script");
            game.neuroshima.groupEnd();
            return null;
        }
        if (preArgs.autoSuccess) {
            game.neuroshima.log("rollTest auto-success by preRollTest script");
            game.neuroshima.groupEnd();
            if (chatMessage) {
                const autoMsg = preArgs.annotation || game.i18n.localize("NEUROSHIMA.Scripts.AutoSuccess");
                await ChatMessage.create({
                    content: `<div class="neuroshima roll-result"><strong>${label}</strong>: ${autoMsg}</div>`,
                    speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker()
                });
            }
            return { autoSuccess: true, successes: 1, cancelled: false };
        }
        stat = preArgs.stat ?? stat;
        skill = preArgs.skill ?? skill;
        skillBonus = preArgs.skillBonus ?? skillBonus;
        attributeBonus = preArgs.attributeBonus ?? attributeBonus;
        penalties = preArgs.penalties ?? penalties;
    }
    
    // Check whether the actor has a pending opposed test (Defense)
    const pendingOpposed = actor?.getFlag("neuroshima", "opposedPending") || {};
    const pendingIds = Object.keys(pendingOpposed);
    const isActuallyDefending = meleeAction === "defense" || pendingIds.length > 0;
    
    // Defense forces a closed test (except for Initiative rolls)
    let finalIsOpen = isOpen;
    if (isActuallyDefending && !isInitiative) {
        finalIsOpen = false;
    }

    const finalSkill = Number(skill || 0) + Number(skillBonus || 0);
    const finalStat = (Number(stat) || 0) + Number(attributeBonus || 0);

    // 1. Compute total penalty and base difficulty
    const totalPenalty = (Number(penalties.mod) || 0) + (Number(penalties.wounds) || 0) + (Number(penalties.armor) || 0) + (Number(penalties.base) || 0) + (Number(penalties.disease) || 0);
    const baseDifficulty = this.getDifficultyFromPercent(totalPenalty);
    
    // 2. Roll 3d20
    game.neuroshima.log("rollTest internal values", { stat, attributeBonus, finalStat, finalSkill });
    game.neuroshima.log("Evaluating roll 3d20...");
    const roll = new Roll("3d20");
    await roll.evaluate();
    game.neuroshima.log("Roll evaluated:", roll.total);

    // Override dice results for debugging (fixedDice)
    if (fixedDice && fixedDice.length === 3) {
        roll.terms[0].results.forEach((r, i) => {
            r.result = fixedDice[i];
        });
        roll._total = roll.terms[0].results.reduce((acc, r) => acc + r.result, 0);
    }
    
    const rawResults = roll.terms[0].results.map(r => r.result);
    
    // Build dice objects for evaluation
    const dice = rawResults.map((v, i) => ({
        original: v,
        index: i,
        modified: v,
        isSuccess: false,
        ignored: false
    }));

    // 3. Compute difficulty shifts (Slider)
    let totalShift = 0;
    const allowCombatShift = game.settings.get("neuroshima", "allowCombatShift");
    
    // Skill and dice shifts (natural 1s and 20s)
    if (!isCombat || allowCombatShift) {
        totalShift -= this.getSkillShift(finalSkill);
        totalShift += this.getDiceShift(rawResults);
    }

    const shiftedDifficulty = this._getShiftedDifficulty(baseDifficulty, totalShift);
    const ptMod = shiftedDifficulty.mod;
    
    // Final success threshold (Attribute + PT modifier)
    const target = finalStat + ptMod;

    game.neuroshima.log("Test parameters", { stat: finalStat, skill: finalSkill, penalties: totalPenalty, threshold: target, slider: totalShift });
    game.neuroshima.log("Raw dice results", rawResults);

    let rollData = {
      label,
      stat: finalStat,
      skill: finalSkill,
      skillBonus,
      attributeBonus,
      baseStat: stat,
      baseSkill: skill,
      baseDifficulty: baseDifficulty,
      penalties,
      penalty: totalPenalty,
      totalPenalty,
      baseDifficultyLabel: baseDifficulty.label,
      difficultyLabel: shiftedDifficulty.label,
      ptMod,
      target,
      isOpen: finalIsOpen,
      isCombat,
      isReroll,
      isDebug,
      rollMode,
      rawResults,
      isCritSuccess: false,
      isCritFailure: false,
      isGM: game.user.isGM,
      actorId: actor?.id,
      actorImg: actor?.img,
      attributeKey,
      skillKey,
      annotations: testAnnotations.filter(Boolean)
    };

    // 4. Evaluate the test (Open or Closed)
    if (finalIsOpen) {
      game.neuroshima.log("Ewaluacja: TEST OTWARTY");
      this._evaluateOpenTest(rollData, dice);
    } else if (isActuallyDefending) {
        // For defense, do not spend skill points automatically
        rollData.modifiedResults = dice.map(d => ({
            ...d,
            modified: d.original,
            isSuccess: d.original <= target && d.original !== 20,
            isNat1: d.original === 1,
            isNat20: d.original === 20
        }));
        const successes = rollData.modifiedResults.filter(r => r.isSuccess).length;
        rollData.successCount = successes;
        rollData.success = successes >= 2;
    } else {
      game.neuroshima.log("Evaluation: CLOSED TEST");
      this._evaluateClosedTest(rollData, dice);
    }

    game.neuroshima.log("Results after skill modification", rollData.modifiedResults);
    game.neuroshima.groupEnd();

    if (actor && !isReroll && !isDebug) {
        const postArgs = {
            actor,
            rollData,
            isSuccess: rollData.success ?? false,
            successCount: rollData.successCount ?? 0,
            roll,
            label,
            attributeKey,
            skillKey,
            annotations: testAnnotations,
            options
        };
        await NeuroshimaScriptRunner.execute("rollTest", postArgs);

        if (resultCallback) {
            await resultCallback({ isSuccess: rollData.success ?? false, successes: rollData.successCount ?? 0, rollData, actor });
        }
    }

    if (!chatMessage) {
        return {
            ...rollData,
            roll
        };
    }

    const rollMessage = await NeuroshimaChatMessage.renderRoll(rollData, actor, roll);

    return rollMessage;
  }

  /**
   * Returns the shifted difficulty level based on the Slider value.
   * @private
   */
  static _getShiftedDifficulty(base, shift) {
    const order = ["easy", "average", "problematic", "hard", "veryHard", "damnHard", "luck", "masterful", "grandmasterful"];
    
    // Guard against a missing difficulty object
    if (!base || !base.label) {
        return NEUROSHIMA.difficulties.average;
    }

    const baseKey = Object.keys(NEUROSHIMA.difficulties).find(key => NEUROSHIMA.difficulties[key]?.label === base.label);
    let index = order.indexOf(baseKey);
    
    if (index === -1) index = 1; // Default to average
    
    let shiftedIndex = Math.clamp(index + shift, 0, order.length - 1);
    return NEUROSHIMA.difficulties[order[shiftedIndex]] || NEUROSHIMA.difficulties.average;
  }

  /**
   * Closed (Standard) Test evaluation.
   * Success requires at least 2 dice equal to or below the threshold (target)
   * after optimally spending skill points.
   */
  static _evaluateClosedTest(data, diceObjects) {
    const { target, skill } = data;
    
    // Sort a copy of the dice by result for cheap-first cost analysis
    const sorted = [...diceObjects].sort((a, b) => a.original - b.original);

    // 1. Buy successes: cheapest dice first
    sorted.forEach(d => {
        d.cost = d.original <= target ? 0 : (d.original === 20 ? 999 : d.original - target);
    });
    sorted.sort((a, b) => a.cost - b.cost);
    
    let tempSkill = skill;
    sorted.forEach(d => {
        // A natural 20 is always a failure — spend no skill points on it.
        if (d.original === 20) {
            d.modified = 20;
            d.isSuccess = false;
            d.isNat1 = false;
            d.isNat20 = true;
            return;
        }
        // Spend points to reach target, but cannot go below 1.
        const maxSpendTo1 = Math.max(0, d.original - 1);
        const spent = tempSkill > 0 ? Math.min(tempSkill, d.cost, maxSpendTo1) : 0;
        tempSkill -= spent;
        d.modified = d.original - spent;
        d.isSuccess = d.modified <= target && d.original !== 20;
        d.isNat1 = d.original === 1;
        d.isNat20 = d.original === 20;
    });

    // 2. Optimization: distribute remaining skill points to further reduce successful dice,
    // potentially upgrading from 2 to 3 successes.
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

    // Restore original die order for the chat card
    data.modifiedResults = [...diceObjects].sort((a, b) => a.index - b.index);

    // Test passes when at least 2 dice are successes
    const successes = data.modifiedResults.filter(r => r.isSuccess).length;
    data.successCount = successes;
    data.success = successes >= 2;
    data.skillUsed = skill - tempSkill;
    data.remainingSkill = tempSkill;
    
    // Criticals (all 3 successes, or all failures with at least one natural 20)
    data.isCritSuccess = successes === 3;
    data.isCritFailure = successes === 0 && diceObjects.some(d => d.original === 20);
  }

  /**
   * Open Test evaluation.
   * Ignores the highest (worst) die; skill points are spent to minimize
   * the higher of the remaining two dice.
   */
  static _evaluateOpenTest(data, diceObjects) {
    const { target, skill } = data;
    
    // Sort to find the worst die
    const sorted = [...diceObjects].sort((a, b) => a.original - b.original);
    
    // Ignore the highest die (worst result)
    sorted[2].ignored = true;
    sorted[2].isSuccess = false;
    game.neuroshima.log(`_evaluateOpenTest: Ignoring die D${sorted[2].index + 1} (${sorted[2].original}). Pool: ${skill}`);

    // Take the two better dice
    let d1 = sorted[0];
    let d2 = sorted[1];
    
    let tempSkill = skill;
    
    // Step 1: Bring d2 down to d1's level.
    // Rule: a natural 20 cannot be modified and is an automatic failure.
    const diff = d2.original - d1.original;
    const maxSpendTo1_d2 = d2.original === 20 ? 0 : Math.max(0, d2.original - 1);
    const spentToMatch = tempSkill > 0 ? Math.min(tempSkill, diff, maxSpendTo1_d2) : 0;
    d2.modified = d2.original - spentToMatch;
    tempSkill -= spentToMatch;
    if (spentToMatch > 0) {
        game.neuroshima.log(`_evaluateOpenTest: Step 1 - Spent ${spentToMatch} pts to equalise die D${d2.index + 1} (${d2.original} -> ${d2.modified})`);
    }

    // Step 2: If points remain, reduce both dice evenly.
    if (tempSkill > 0) {
        // Calculate max spend per die without dropping below 1.
        // A natural 20 cannot be modified.
        const maxSpend_d1 = d1.original === 20 ? 0 : Math.max(0, d1.original - 1);
        const maxSpend_d2 = d2.original === 20 ? 0 : Math.max(0, d2.modified - 1);
        
        // Reduce both as far as possible without exceeding tempSkill
        let spentOnBoth = 0;
        while (tempSkill > 0 && ((d1.modified > 1 && d1.original !== 20) || (d2.modified > 1 && d2.original !== 20))) {
            if (d1.modified > 1 && d1.original !== 20 && tempSkill > 0) {
                d1.modified -= 1;
                tempSkill -= 1;
                spentOnBoth += 1;
            }
            if (d2.modified > 1 && d2.original !== 20 && tempSkill > 0) {
                d2.modified -= 1;
                tempSkill -= 1;
                spentOnBoth += 1;
            }
        }
        
        if (spentOnBoth > 0) {
            game.neuroshima.log(`_evaluateOpenTest: Step 2 - Spent ${spentOnBoth} pts to reduce both dice: D${d1.index + 1} (${d1.original} -> ${d1.modified}), D${d2.index + 1} (${d2.original} -> ${d2.modified})`);
        }
    } else if (tempSkill === skill) {
        d1.modified = d1.original;
        d2.modified = d2.original;
    }

    // Success on open test dice (natural 20 is always a failure)
    d1.isSuccess = d1.modified <= target && d1.original !== 20;
    d2.isSuccess = d2.modified <= target && d2.original !== 20;

    // Tag natural results
    diceObjects.forEach(d => {
        d.isNat1 = d.original === 1;
        d.isNat20 = d.original === 20;
    });

    // Advantage Points = threshold minus the higher of the two kept dice
    const finalHigherDie = Math.max(d1.modified, d2.modified);
    const successPoints = target - finalHigherDie;
    
    data.successPoints = successPoints;
    data.successCount = successPoints;
    data.success = successPoints >= 0;
    
    // Restore original die order
    data.modifiedResults = [...diceObjects].sort((a, b) => a.index - b.index);
  }

  /**
   * Helper to calculate skill shift (Suwak).
   */
  static getSkillShift(skill) {
    if (skill <= 0) return -1;
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
            successPoints = evalData.successCount;
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

    const template = isMelee
        ? "systems/neuroshima/templates/chat/melee-roll-card.hbs"
        : (isWeapon
            ? "systems/neuroshima/templates/chat/weapon-roll-card.hbs"
            : "systems/neuroshima/templates/chat/roll-card.hbs");

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

    // Handle array format [x, y] (common in V13 canvas.grid)
    if (Array.isArray(pos1)) pos1 = { x: pos1[0], y: pos1[1] };
    if (Array.isArray(pos2)) pos2 = { x: pos2[0], y: pos2[1] };
    
    // In Foundry V13, the most ruler-accurate measurement method is canvas.grid.measurePath
    const path = [{x: pos1.x, y: pos1.y}, {x: pos2.x, y: pos2.y}];
    let distance = 0;
    
    try {
        const measureResult = canvas.grid.measurePath(path);
        distance = measureResult.distance;

        if (game.settings.get("neuroshima", "debugMode")) {
            console.group("Neuroshima 1.5 | measureDistance Debug (V13)");
            console.log("Position 1:", pos1);
            console.log("Position 2:", pos2);
            console.log("measurePath result:", measureResult);
            console.log("Scene scale (grid):", canvas.grid.size, "px =", canvas.grid.distance, "m");
            console.groupEnd();
        }
    } catch (e) {
        console.error("Neuroshima 1.5 | Error measuring distance:", e);
        // Fallback to simple Euclidean measurement
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
   * Calculate healing effects WITHOUT updating wounds (preview only).
   * @param {Actor} patientActor - The patient actor
   * @param {Array} woundIds - IDs of wounds to heal
   * @param {string} healingMethod - "firstAid" or "woundTreatment"
   * @param {number} successCount - Number of successes from the test
   * @param {boolean} hadFirstAid - Whether the wound already had First Aid applied
   * @param {number} healingModifier - Additional % modifier per wound type
   * @returns {Object} Calculated changes (no updates applied)
   */
  static calculateHealingEffects(patientActor, woundIds, healingMethod, successCount, hadFirstAid = false, healingModifier = 0) {
    game.neuroshima?.group("NeuroshimaDice | calculateHealingEffects");
    game.neuroshima?.log("Calculating healing effects", {
      patient: patientActor.name,
      method: healingMethod,
      successCount: successCount,
      woundIds: woundIds,
      hadFirstAid: hadFirstAid
    });

    const isFirstAid = healingMethod === "firstAid";
    const isSuccess = successCount >= 2;
    
    // Determine penalty change based on result and method
    // Negative = reduces penalty (healing), positive = increases penalty (failure)
    let penaltyChange = 0;
    if (isSuccess) {
      if (isFirstAid) {
        penaltyChange = -5;
      } else {
        // Treat Wounds: 15% if fresh wound, 10% if had First Aid
        penaltyChange = hadFirstAid ? -10 : -15;
      }
    } else {
      // Failure always increases penalty by 5%
      penaltyChange = 5;
    }
    
    // Add per-wound healing modifier
    penaltyChange += healingModifier;

    game.neuroshima?.log("Penalty change determined", {
      penaltyChange: penaltyChange,
      baseChange: isSuccess ? (isFirstAid ? -5 : (hadFirstAid ? -10 : -15)) : 5,
      healingModifier: healingModifier,
      isSuccess: isSuccess,
      hadFirstAid: hadFirstAid
    });

    const healingResults = [];

    // Calculate effects for each wound (no updates applied)
    for (const woundId of woundIds) {
      const wound = patientActor.items.get(woundId);
      if (!wound || wound.type !== "wound") continue;

      const oldPenalty = wound.system.penalty || 0;
      let newPenalty = Math.max(0, oldPenalty + penaltyChange);

      if (isSuccess) {
        const origPenalty = wound.system.originalPenalty ?? oldPenalty;
        if (isFirstAid) {
          const faRemaining = Math.max(0, 5 - (wound.system.firstAidHealingApplied || 0));
          newPenalty = Math.max(oldPenalty - faRemaining, newPenalty);
        }
        newPenalty = Math.max(origPenalty - 15, newPenalty);
        newPenalty = Math.max(0, newPenalty);
      }

      game.neuroshima?.log("Penalty calculation for wound", {
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
        penaltyChange: newPenalty - oldPenalty,
        hadFirstAid: hadFirstAid
      });
    }

    game.neuroshima?.log("Healing effects calculated", {
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
   * Apply healing effects to selected wounds.
   * @param {Actor} patientActor - The patient actor
   * @param {Array} woundIds - IDs of wounds to heal
   * @param {string} healingMethod - "firstAid" or "woundTreatment"
   * @param {number} successCount - Number of successes from the test
   * @param {boolean} hadFirstAid - Whether the wound already had First Aid applied
   * @param {number} healingModifier - Additional % modifier per wound type
   * @returns {Promise<Object>} Information about the applied changes
   */
  static async applyHealingEffects(patientActor, woundIds, healingMethod, successCount, hadFirstAid = false, healingModifier = 0) {
    game.neuroshima?.group("NeuroshimaDice | applyHealingEffects");
    game.neuroshima?.log("Applying healing effects", {
      patient: patientActor.name,
      method: healingMethod,
      successCount: successCount,
      woundIds: woundIds,
      hadFirstAid: hadFirstAid
    });

    const isFirstAid = healingMethod === "firstAid";
    const isSuccess = successCount >= 2;
    
    // Negative = reduces penalty (healing), positive = increases penalty (failure)
    // First Aid: -5% (success) / +5% (failure)
    // Treat Wounds: -15% fresh / -10% (had first aid) on success, +5% on failure
    let penaltyChange = 0;
    if (isSuccess) {
      if (isFirstAid) {
        penaltyChange = -5;
      } else {
        // Treat Wounds: 15% if fresh wound, 10% if had First Aid
        penaltyChange = hadFirstAid ? -10 : -15;
      }
    } else {
      // Failure always increases penalty by 5%
      penaltyChange = 5;
    }
    
    // Add per-wound healing modifier
    penaltyChange += healingModifier;

    game.neuroshima?.log("Penalty change determined", {
      penaltyChange: penaltyChange,
      baseChange: isSuccess ? (isFirstAid ? -5 : (hadFirstAid ? -10 : -15)) : 5,
      healingModifier: healingModifier,
      isSuccess: isSuccess,
      hadFirstAid: hadFirstAid
    });

    const healingResults = [];
    const woundsToUpdate = [];

    // Apply healing effects to each wound
    for (const woundId of woundIds) {
      const wound = patientActor.items.get(woundId);
      if (!wound || wound.type !== "wound") continue;

      // Penalty cannot go below 0%
      const oldPenalty = wound.system.penalty || 0;
      const newPenalty = Math.max(0, oldPenalty + penaltyChange);

      game.neuroshima?.log("Penalty change for wound", {
        woundName: wound.name,
        oldPenalty: oldPenalty,
        newPenalty: newPenalty,
        penaltyChange: penaltyChange
      });

      // Update: penalty + system.isHealing = true + hadFirstAid if First Aid was successful
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

    // Update all wounds at once (batch update)
    if (woundsToUpdate.length > 0) {
      await patientActor.updateEmbeddedDocuments("Item", woundsToUpdate);
    }

    game.neuroshima?.log("Healing effects applied", {
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
    game.neuroshima?.log("Healing roll parameters:", {
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

    // 1. Calculate percentage penalties
    const basePenalty = NEUROSHIMA.difficulties[baseDifficulty]?.min || 0;
    const modifier = parseInt(penalties.mod) || 0;
    const armorPenalty = parseInt(penalties.armor) || 0;
    const woundPenalty = parseInt(penalties.wounds) || 0;
    const totalPenalty = basePenalty + modifier + armorPenalty + woundPenalty;

    game.neuroshima?.log("Penalty calculation (%)", {
      basePenalty,
      modifier,
      armorPenalty,
      woundPenalty,
      totalPenalty
    });

    // 2. Roll dice (3d20)
    const roll = new Roll("3d20");
    await roll.evaluate();
    
    const rawResults = roll.terms[0].results.map(r => r.result);

    // 3. Calculate skill bonuses
    const totalSkill = (skillValue || 0) + skillBonus;
    const skillShift = this.getSkillShift(totalSkill);

    // 4. Calculate final attribute value
    const finalStat = stat + attributeBonus;

    // 5. Calculate test result
    const penaltyDiff = this.getDifficultyFromPercent(totalPenalty);
    const finalDiff = this._getShiftedDifficulty(penaltyDiff, -skillShift);
    const testTarget = finalStat + (finalDiff.mod || 0);

    game.neuroshima?.log("Dice roll results", {
      rawResults,
      testTarget,
      skillValue,
      skillBonus,
      totalSkill
    });

    // 6. Evaluate test (always Closed Test for healing)
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

    // Create dice objects for evaluation
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
    this._evaluateClosedTest(rollData, diceObjects);

    game.neuroshima?.log("Healing test result", {
      method: healingMethod,
      patient: patientActor.name,
      successCount: rollData.successCount,
      target: testTarget
    });

    // 7. Apply healing effects to selected wounds
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

    game.neuroshima?.log("Preparing to render healing card", {
      healingEffectsApplied: !!healingEffects,
      woundCount: woundIds.length
    });

    // 8. Render the healing chat card
    await NeuroshimaChatMessage.renderHealingRoll(medicActor, rollData);

    game.neuroshima?.log("Healing card rendered");
    game.neuroshima?.groupEnd();
  }

  /**
   * Batch healing rolls — one closed test (3d20) per wound.
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
    game.neuroshima?.log("Starting batch healing roll", {
      medic: medicActor?.name,
      patient: patientActor?.name,
      method: healingMethod,
      woundCount: woundConfigs.length
    });

    // Base attribute (normally Dexterity, but can be overridden)
    let baseStat = stat;
    if (!baseStat) {
      baseStat = medicActor.system.attributes.dexterity + (medicActor.system.modifiers.dexterity || 0);
    }
    
    // Get skill value based on healing method
    const skillName = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
    const skillValue = medicActor.system.skills?.[skillName]?.value || 0;
    const totalSkill = skillValue + skillBonus;
    const skillShift = this.getSkillShift(totalSkill);
    const finalStat = baseStat + attributeBonus;

    const results = [];
    const healingResults = [];

    // Roll for each wound individually (separate 3d20 for each)
    for (const config of woundConfigs) {
      game.neuroshima?.log("Rolling test for wound", {
        woundName: config.woundName,
        difficulty: config.difficulty,
        modifier: config.modifier
      });

      // Step 1 - Roll dice (always 3d20 for healing)
      const roll = new Roll("3d20");
      await roll.evaluate();
      
      const rawResults = roll.terms[0].results.map(r => r.result);

      // Step 2 - Calculate test difficulty with modifiers
      // Base difficulty + modifier (global + armor + wounds)
      const baseDifficultyKey = config.difficulty || 'average';
      const baseDifficultyData = NEUROSHIMA.difficulties[baseDifficultyKey] || NEUROSHIMA.difficulties.average;
      const totalPenalty = (baseDifficultyData.min || 0) + config.modifier;
      const penaltyDiff = this.getDifficultyFromPercent(totalPenalty);
      
      // Total shift = skill shift + dice shift (nat 1s/20s) + retry penalty for failed attempts
      const diceShift = this.getDiceShift(rawResults);
      const failedAttempts = config.failedAttempts || 0;
      const totalShift = -skillShift + diceShift + failedAttempts;
      const finalDiff = this._getShiftedDifficulty(penaltyDiff, totalShift);
      const testTarget = finalStat + (finalDiff.mod || 0);
      
      const difficultyLabel = finalDiff.label;

      // Step 3 - Create dice objects for closed test evaluation
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

      // Step 4 - Evaluate closed test (count successes)
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

      // Evaluate closed test
      this._evaluateClosedTest(testRollData, diceObjects);

      game.neuroshima?.log("Test result for wound", {
        woundName: config.woundName,
        successCount: testRollData.successCount,
        isSuccess: testRollData.successCount >= 2
      });

      // 5. Calculate healing effects for this wound (don't apply yet)
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
        healingEffect: healingEffectResults[0],
        tooltip: this._buildClosedTestTooltip(testRollData, healingMethod === "firstAid" ? "NEUROSHIMA.Skills.firstAid" : "NEUROSHIMA.Skills.woundTreatment"),
        tooltipHtml: NeuroshimaDice.buildDiceTooltipHtml({
          modifiedResults: testRollData.modifiedResults,
          target: testTarget,
          skill: totalSkill,
          successCount: testRollData.successCount
        })
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

    game.neuroshima?.log("Batch roll complete", {
      totalWounds: results.length,
      successes: successCount,
      failures: failureCount
    });

    // 6. Render batch results
    await NeuroshimaChatMessage.renderHealingBatchResults(
      medicActor,
      patientActor,
      results,
      healingMethod,
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
   * Re-roll a healing test for a specific wound (without creating a new chat message).
   */
  static async rerollHealingTest(medicActor, patientActor, healingMethod, woundConfig, baseStat, skillBonus, attributeBonus) {
    game.neuroshima?.group("NeuroshimaDice | rerollHealingTest");
    game.neuroshima?.log("Re-rolling test for wound", {
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
    
    // Calculate total shift (skill + dice + retry penalty)
    const diceShift = this.getDiceShift(rawResults);
    const failedAttempts = woundConfig.failedAttempts || 0;
    const totalShift = -skillShift + diceShift + failedAttempts;
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
      baseDifficultyLabel: baseDifficultyData.label,
      penalties: {
        mod: woundConfig.modifier,
        armor: 0,
        wounds: 0,
        base: baseDifficultyData.min || 0
      },
      totalPenalty: totalPenalty,
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

    game.neuroshima?.log("Re-roll result for wound", {
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

    game.neuroshima?.groupEnd();

    return {
      woundId: woundConfig.woundId,
      woundName: woundConfig.woundName,
      damageType: woundConfig.damageType,
      successCount: testRollData.successCount,
      isSuccess: isSuccess,
      healingEffect: healingEffect.results[0],
      tooltip: this._buildClosedTestTooltip(testRollData, healingMethod === "firstAid" ? "NEUROSHIMA.Skills.firstAid" : "NEUROSHIMA.Skills.woundTreatment")
    };
  }

  /**
   * Universal method to build a calculation detail tooltip for any Neuroshima roll.
   * Can be used as a static JS method or a Handlebars helper.
   * @param {Object} rollData 
   * @returns {string} HTML string for the tooltip
   */
  static buildRollTooltip(rollData) {
    if (!rollData) return "";

    if (rollData.isGrenade) {
      const loc = (k) => game.i18n.localize(k);
      const distance     = rollData.distance ?? 0;
      const distPenalty  = rollData.distancePenalty ?? 0;
      const totalPenalty = rollData.totalPenalty ?? 0;
      const target       = rollData.target ?? 0;
      const diffLabel    = rollData.difficultyLabel ? loc(rollData.difficultyLabel) : "";
      let tooltip = `<strong>${loc('NEUROSHIMA.Grenade.Distance')}:</strong> ${distance}m<br>`;
      if (distPenalty !== 0) tooltip += `<strong>${loc('NEUROSHIMA.Roll.DistancePenalty')}:</strong> ${distPenalty}%<br>`;
      if (totalPenalty !== 0) tooltip += `<strong>${loc('NEUROSHIMA.Roll.TotalModifier')}:</strong> ${totalPenalty}%<br>`;
      if (diffLabel) tooltip += `<strong>${loc('NEUROSHIMA.Roll.BaseDifficulty')}:</strong> ${diffLabel}<br>`;
      tooltip += `<strong>${loc('NEUROSHIMA.Roll.Target')}:</strong> ${target}`;
      return tooltip.trim();
    }

    if (rollData.isReputationRoll) {
      const repValue = rollData.repRepValue ?? 0;
      const fame = rollData.repFame ?? 0;
      const repBonus = rollData.repBonus ?? 0;
      const totalPenalty = rollData.totalPenalty || rollData.penalty || 0;
      const baseDifficultyLabel = rollData.baseDifficultyLabel || rollData.difficultyLabel || "";
      const target = rollData.testTarget || rollData.target || 0;

      let tooltip = `<strong>${game.i18n.localize('NEUROSHIMA.Reputation.Value')}:</strong> ${repValue}<br>`;
      tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Reputation.Fame')}:</strong> ${fame}<br>`;
      if (repBonus !== 0) {
        tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Reputation.RepBonus')}:</strong> ${repBonus >= 0 ? "+" : ""}${repBonus}<br>`;
      }
      tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.PenaltyLabel')}:</strong> ${totalPenalty}%<br>`;
      tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.BaseDifficulty')}:</strong> ${game.i18n.localize(baseDifficultyLabel || 'NEUROSHIMA.Difficulty.Average')}<br>`;
      tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.Target')}:</strong> ${target}`;
      return tooltip.trim();
    }
    
    const penalties = rollData.penalties || {};
    const baseStat = rollData.baseStat || rollData.stat || 0;
    const attributeBonus = rollData.attributeBonus || 0;
    const baseSkill = rollData.baseSkill || rollData.skill || 0;
    const skillBonus = rollData.skillBonus || 0;
    const totalPenalty = rollData.totalPenalty || rollData.penalty || 0;
    const baseDifficultyLabel = rollData.baseDifficultyLabel || rollData.difficultyLabel || "";
    const target = rollData.testTarget || rollData.target || 0;

    let tooltip = `<strong>${game.i18n.localize('NEUROSHIMA.Attributes.Attributes')}:</strong> ${baseStat}<br>`;
    if (attributeBonus !== 0) {
        tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.AttributeBonusAbbr')}:</strong> ${attributeBonus}<br>`;
    }
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Items.Fields.Skill')}:</strong> ${baseSkill}<br>`;
    if (skillBonus !== 0) {
        tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.SkillBonusAbbr')}:</strong> ${skillBonus}<br>`;
    }
    
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.Penalties')}:</strong><br>`;
    tooltip += `&nbsp;&nbsp;&bull; ${game.i18n.localize('NEUROSHIMA.Roll.PenaltyMod')}: ${penalties.mod || 0}%<br>`;
    tooltip += `&nbsp;&nbsp;&bull; ${game.i18n.localize('NEUROSHIMA.Roll.PenaltyWounds')}: ${penalties.wounds || 0}%<br>`;
    tooltip += `&nbsp;&nbsp;&bull; ${game.i18n.localize('NEUROSHIMA.Roll.PenaltyArmor')}: ${penalties.armor || 0}%<br>`;
    
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.TotalModifier')}:</strong> ${totalPenalty}%<br>`;
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.BaseDifficulty')}:</strong> ${game.i18n.localize(baseDifficultyLabel)}<br>`;
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.Target')}:</strong> ${target}`;

    return tooltip.trim();
  }

  /**
   * Builds a compact dice-roll tooltip HTML — a mini version of roll-card.hbs.
   * Includes: test type, dice grid (D1/D2/D3 with colors), threshold, skill, penalties, success count.
   * Returns a plain string (not SafeString) so Handlebars escapes it correctly for data-tooltip attributes.
   * @param {Object} data
   * @param {Array}  data.modifiedResults  - dice objects { original, modified, isSuccess, ignored, isNat1, isNat20 }
   * @param {number} data.target           - roll threshold
   * @param {number} [data.skill]          - skill points used (0 = pure attribute)
   * @param {number} [data.successCount]   - number of successes
   * @param {string} [data.difficultyLabel]- i18n key for difficulty label
   * @param {boolean}[data.isOpen]         - open vs closed test
   * @param {Object} [data.penalties]      - { mod, wounds, armor }
   * @returns {string}
   */
  static buildDiceTooltipHtml(data) {
    if (!data?.modifiedResults?.length) return "";
    const { modifiedResults, target = 0, skill = 0, successCount, difficultyLabel, isOpen, penalties } = data;

    const successes = successCount ?? modifiedResults.filter(d => d.isSuccess).length;
    const loc = (k) => game.i18n.localize(k);

    // Dice grid — mirror roll-card.hbs structure with die-square-container
    const diceHtml = modifiedResults.map((d, i) => {
      const ignored = d.ignored ? " ignored" : "";
      const nat1 = d.isNat1 ? " nat-1" : "";
      const nat20 = d.isNat20 ? " nat-20" : "";
      const modCls = d.isSuccess ? "success" : "failure";
      let h = `<div class="die-result${ignored}">`;
      h += `<span class="die-label">D${i + 1} = </span>`;
      h += `<div class="die-square-container">`;
      h += `<span class="die-square original${nat1}${nat20}">${d.original}</span>`;
      if (skill > 0) {
        h += `<i class="fas fa-long-arrow-alt-right"></i>`;
        h += `<span class="die-square modified ${modCls}">${d.modified}</span>`;
      }
      h += `</div></div>`;
      return h;
    }).join("");

    // Header
    const testTypeLabel = isOpen ? loc("NEUROSHIMA.Roll.OpenTest") : loc("NEUROSHIMA.Roll.ClosedTest");
    const diffLabel = difficultyLabel ? loc(difficultyLabel) : "";
    const headerText = diffLabel ? `${diffLabel} ${testTypeLabel}` : testTypeLabel;

    // Footer — match roll-card.hbs .roll-outcome style
    let footerItems = `<div class="outcome-item"><span class="label">${loc("NEUROSHIMA.Roll.Target")}:</span><span class="value"><strong>${target}</strong></span></div>`;
    if (skill > 0) footerItems += `<div class="outcome-item"><span class="label">${loc("NEUROSHIMA.Items.Fields.Skill")}:</span><span class="value"><strong>${skill}</strong></span></div>`;
    if (penalties) {
      const totalPenalty = (penalties.mod || 0) + (penalties.wounds || 0) + (penalties.armor || 0);
      if (totalPenalty !== 0) footerItems += `<div class="outcome-item"><span class="label">${loc("NEUROSHIMA.Roll.TotalModifier")}:</span><span class="value"><strong>${totalPenalty}%</strong></span></div>`;
    }
    footerItems += `<div class="outcome-item"><span class="label">${loc("NEUROSHIMA.Roll.SuccessPointsAbbr")}:</span><span class="value"><strong>${successes}</strong></span></div>`;

    return [
      `<div class="neuroshima roll-card tooltip-inline">`,
      `<header class="roll-header"><div class="header-details"><div class="test-info">${headerText}</div></div></header>`,
      `<hr class="dotted-hr">`,
      `<div class="dice-results-grid">${diceHtml}</div>`,
      `<hr class="dotted-hr">`,
      `<footer class="roll-outcome">${footerItems}</footer>`,
      `</div>`
    ].join("");
  }

  static _buildOpenTestTooltip(testRollData, headerLabel) {
    return this.buildRollTooltip(testRollData);
  }

  static _buildClosedTestTooltip(testRollData, headerLabel) {
    return this.buildRollTooltip(testRollData);
  }

  static _buildHealingTooltip(testRollData, healingMethod) {
    const label = healingMethod === "firstAid" ? "NEUROSHIMA.Skills.firstAid" : "NEUROSHIMA.Skills.woundTreatment";
    return this._buildClosedTestTooltip(testRollData, label);
  }

  /**
   * Calculate the throw penalty for a grenade at a given distance.
   * @param {number} distance   - Distance in metres.
   * @param {number} build      - Thrower's Constitution attribute.
   * @param {number} [freeRange=10] - Distance (m) with no penalty.
   * @returns {number} Penalty percentage (positive = harder).
   */
  static getGrenadePenalty(distance, build = 0, freeRange = null, useBuildBonus = true) {
    const cfg = game.neuroshima?.config ?? {};
    const baseRange = freeRange ?? cfg.grenadeBaseRange ?? 10;
    const multiplier = cfg.grenadeDistanceMultiplier ?? 3;
    if (distance <= baseRange) return 0;
    const rawPenalty = Math.round((distance - baseRange) * multiplier);
    let buildBonus = 0;
    if (useBuildBonus) {
      const { grenadeConstitutionBonuses } = cfg;
      if (grenadeConstitutionBonuses) {
        for (const tier of grenadeConstitutionBonuses) {
          if (build >= tier.minBuild && build <= tier.maxBuild) {
            buildBonus = tier.bonus;
            break;
          }
        }
      }
    }
    return Math.max(0, rawPenalty - buildBonus);
  }

  /**
   * Perform a grenade throw roll.
   * @param {Object} params
   * @returns {Promise<Object>} Roll result data
   */
  static async rollGrenade(params) {
    const {
      actor,
      weapon,
      distance = 0,
      distancePenalty: providedDistancePenalty = null,
      modifier = 0,
      scriptModifier = 0,
      attributeBonus = 0,
      skillBonus = 0,
      armorPenalty = 0,
      useWoundPenalty = true,
      useDiseasePenalty = true,
      diseasePenalty: rawDiseasePenalty = 0,
      rollMode = game.settings.get("core", "rollMode")
    } = params;

    game.neuroshima.group(`Grenade Throw: ${weapon.name}`);

    const wData = weapon.system;

    const build = actor.system?.attributes?.constitution ?? 0;
    const useBuildBonus = wData.useBuildBonus !== false;
    const distancePenalty = providedDistancePenalty ?? this.getGrenadePenalty(distance, build, null, useBuildBonus);

    const woundPenalty   = useWoundPenalty   ? (actor?.system?.combat?.totalWoundPenalty ?? 0) : 0;
    const diseasePenalty = useDiseasePenalty  ? rawDiseasePenalty : 0;

    const totalPenalty = modifier + scriptModifier + armorPenalty + woundPenalty + diseasePenalty + distancePenalty;

    const baseDifficulty = this.getDifficultyFromPercent(totalPenalty);

    const attributeKey   = wData.attribute || "dexterity";
    const skillKey       = wData.skill || "throwing";
    const attributeValue = (actor.system?.attributeTotals?.[attributeKey] ?? actor.system?.attributes?.[attributeKey] ?? 0) + attributeBonus;
    const skillValue     = (actor.system?.skills?.[skillKey]?.value ?? 0) + skillBonus;
    const target         = attributeValue + (baseDifficulty?.mod ?? 0);

    game.neuroshima.log("Grenade throw calculation", {
      distance, distancePenalty, armorPenalty, woundPenalty, diseasePenalty, modifier, scriptModifier, totalPenalty, attributeValue, skillValue, target, baseDifficulty: baseDifficulty?.label
    });

    const roll = new Roll("3d20");
    await roll.evaluate();
    const rawResults = roll.dice[0].results.map(r => r.result);

    const dice = rawResults.map((r, i) => ({ original: r, index: i, modified: r }));
    const rollData = { target, skill: skillValue };
    this._evaluateClosedTest(rollData, dice);

    const { modifiedResults, successCount, success: isSuccess, isCritSuccess, isCritFailure } = rollData;

    const failureMargin = isSuccess ? 0 : (3 - successCount);
    const distanceFactor = distance <= 10 ? 1 : Math.ceil(distance / 10);
    const deviationMetres = isSuccess ? 0 : failureMargin * distanceFactor;

    const blastZones = [...(wData.blastZones ?? [])].sort((a, b) => a.radius - b.radius);
    const templateRadius = blastZones.length > 0 ? Math.max(...blastZones.map(z => z.radius)) : 0;

    const chatData = {
      isGrenade: true,
      actorId: actor.id,
      weaponId: weapon.id,
      actorImg: actor.prototypeToken?.texture?.src ?? actor.img,
      label: weapon.name,
      difficultyLabel: baseDifficulty?.label ?? "NEUROSHIMA.Difficulty.Average",
      modifiedResults,
      successCount,
      skill: skillValue,
      totalPenalty,
      target,
      isSuccess,
      isCritSuccess,
      isCritFailure,
      failureMargin,
      deviationMetres,
      distance,
      distancePenalty,
      blastZones,
      templateRadius,
      rollMode
    };

    game.neuroshima.log("Grenade throw result", chatData);

    const html = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/grenade-roll-card.hbs",
      chatData
    );

    const message = await ChatMessage.create({
      content: html,
      speaker: ChatMessage.getSpeaker({ actor }),
      rollMode,
      flags: { neuroshima: { grenadeRoll: chatData } }
    });

    game.neuroshima.groupEnd();
    return { ...chatData, message };
  }

  /**
   * Apply a wound directly to an actor, bypassing pain resistance tests.
   * Creates a wound item on the actor immediately.
   * Useful for scripted effects like Bleeding that deal automatic damage.
   *
   * @param {Actor}  actor
   * @param {Object} options
   * @param {string} options.damageType  - Wound type: "D", "L", "C", "K", "sD", "sL", "sC", "sK"
   * @param {string} [options.location]  - Hit location key (e.g. "torso", "head"). Defaults to "torso".
   * @param {string} [options.source]    - Description displayed in the wound's description field.
   * @returns {Promise<Item>}
   */
  static async applyWound(actor, { damageType = "L", location = "torso", source = "" } = {}) {
    const NEUROSHIMA = game.neuroshima?.config ?? {};
    const woundConfig = NEUROSHIMA.woundConfiguration?.[damageType] ?? {};
    const penalty = woundConfig?.penalties?.[0] ?? 20;
    const name = game.i18n.localize(`NEUROSHIMA.DamageType.${damageType}`) || damageType;
    const [created] = await actor.createEmbeddedDocuments("Item", [{
      name,
      type: "wound",
      system: {
        location,
        damageType,
        penalty,
        isActive: true,
        isHealing: false,
        description: source
      }
    }]);
    return created;
  }
}
