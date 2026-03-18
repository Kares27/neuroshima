import { NEUROSHIMA } from "../config.js";

/**
 * Klasa zarządzająca logiką walki wręcz (Melee Duel) w systemie Neuroshima 1.5.
 * Odpowiada za synchronizację stanu starcia we flagach dokumentu Combat
 * oraz udostępnia metody do rzutu puli, modyfikacji kości i rozstrzygania segmentów.
 */
export class NeuroshimaMeleeCombat {
  /**
   * Sprawdza czy dwa UUID wskazują na tego samego aktora.
   * Obsługuje zarówno Actor UUID jak i Token UUID.
   */
  static isSameActor(uuid1, uuid2) {
      if (!uuid1 || !uuid2) return false;
      if (uuid1 === uuid2) return true;

      const doc1 = fromUuidSync(uuid1);
      const doc2 = fromUuidSync(uuid2);
      if (!doc1 || !doc2) return false;

      const actor1 = doc1.actor || doc1;
      const actor2 = doc2.actor || doc2;
      return actor1.id === actor2.id;
  }

  /**
   * Znajduje aktywny pojedynek dla danego aktora.
   */
  static findActiveDuelForActor(actor) {
    const combat = game.combat;
    if (!combat) return null;
    const duels = combat.getFlag("neuroshima", "meleeDuels") || {};
    const uuid = actor.uuid;
    const tokenUuid = actor.token?.uuid;

    for (let duelId in duels) {
        const duel = duels[duelId];
        if (duel && duel.active) {
            if (duel.attacker.id === uuid || duel.defender.id === uuid || 
                (tokenUuid && (duel.attacker.id === tokenUuid || duel.defender.id === tokenUuid))) {
                return duel;
            }
        }
    }
    return null;
  }

  /**
   * Inicjuje proces starcia - ustawia flagę oczekiwania na obrońcę.
   */
  static async initiateMeleePending(attackerUuid, defenderUuid, attackerInitiative, weaponId, maneuver = "none", chargeLevel = 0) {
    const combat = game.combat;
    if (!combat) {
        game.neuroshima.warn("Próba inicjalizacji starcia bez aktywnej walki.");
        return;
    }

    game.neuroshima.log("MeleeCombat | initiateMeleePending", { attackerUuid, defenderUuid, attackerInitiative, maneuver, chargeLevel });

    const attackerDoc = fromUuidSync(attackerUuid);
    const defenderDoc = fromUuidSync(defenderUuid);
    
    if (!attackerDoc || !defenderDoc) {
        game.neuroshima.error("Błąd inicjalizacji Pending: Nie znaleziono dokumentów.", { attackerUuid, defenderUuid });
        return;
    }

    const attackerActor = attackerDoc.actor || attackerDoc;
    const defenderActor = defenderDoc.actor || defenderDoc;

    // Kluczem jest UUID dokumentu (zastępujemy kropki, by nie tworzyć zagnieżdżonych flag)
    const pendingKey = defenderUuid.replace(/\./g, "-");
    const pendingData = {
        id: defenderUuid, // Oryginalny UUID jako ID
        attackerId: attackerUuid,
        defenderId: defenderUuid,
        attackerName: attackerActor.name,
        defenderName: defenderActor.name,
        attackerInitiative,
        attackerManeuver: maneuver,
        attackerChargeLevel: chargeLevel,
        weaponId,
        active: true,
        timestamp: Date.now()
    };

    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleePendings.${pendingKey}`, pendingData);
    } else {
        await combat.setFlag("neuroshima", `meleePendings.${pendingKey}`, pendingData);
    }
    
    game.neuroshima.log(`Ustawiono flagę meleePendings.${pendingKey}`, pendingData);
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeDuel.PendingNotification"));
  }

  /**
   * Reakcja obrońcy na starcie - rzut na inicjatywę i start pojedynku.
   */
  static async respondToMeleePending(pendingUuid, defenderInitiative, defenderWeaponId = null, maneuver = "none", chargeLevel = 0) {
    const combat = game.combat;
    const pendingKey = pendingUuid.replace(/\./g, "-");
    const pendings = combat?.getFlag("neuroshima", "meleePendings") || {};
    const pending = pendings[pendingKey];
    
    game.neuroshima.log("Obrońca odpowiada na starcie:", { pendingUuid, defenderInitiative, pending, defenderWeaponId, maneuver, chargeLevel });

    if (!pending || !pending.active) {
        game.neuroshima.error("Nie znaleziono oczekującego starcia dla UUID:", pendingUuid);
        return;
    }

    const attackerId = pending.attackerId;
    const defenderId = pending.defenderId;
    const attackerInit = pending.attackerInitiative;
    const attackerWeaponId = pending.weaponId;
    const attackerManeuver = pending.attackerManeuver || "none";
    const attackerChargeLevel = pending.attackerChargeLevel || 0;

    // Rozstrzygnięcie kto ma inicjatywę
    let finalAttackerId, finalDefenderId, finalAttackerWeaponId, finalDefenderWeaponId, finalAttackerManeuver, finalDefenderManeuver, finalAttackerChargeLevel, finalDefenderChargeLevel;
    
    if (attackerInit >= defenderInitiative) {
        game.neuroshima.log("Atakujący wygrywa inicjatywę.");
        finalAttackerId = attackerId;
        finalDefenderId = defenderId;
        finalAttackerWeaponId = attackerWeaponId;
        finalDefenderWeaponId = defenderWeaponId;
        finalAttackerManeuver = attackerManeuver;
        finalDefenderManeuver = maneuver;
        finalAttackerChargeLevel = attackerChargeLevel;
        finalDefenderChargeLevel = chargeLevel;
    } else {
        game.neuroshima.log("Obrońca przejmuje inicjatywę (staje się atakującym).");
        finalAttackerId = defenderId;
        finalDefenderId = attackerId;
        finalAttackerWeaponId = defenderWeaponId;
        finalDefenderWeaponId = attackerWeaponId;
        finalAttackerManeuver = maneuver;
        finalDefenderManeuver = attackerManeuver;
        finalAttackerChargeLevel = chargeLevel;
        finalDefenderChargeLevel = attackerChargeLevel;
    }

    // Usuwamy pending przed startem właściwego pojedynku
    game.neuroshima.log("Usuwanie flagi pending przed startem pojedynku.");
    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("unsetCombatFlag", `meleePendings.${pendingKey}`);
    } else {
        await combat.unsetFlag("neuroshima", `meleePendings.${pendingKey}`);
    }

    // Startujemy właściwy pojedynek
    game.neuroshima.log("Parowanie zakończone. Startowanie starcia dla:", { finalAttackerId, finalDefenderId });
    await this.startDuel(finalAttackerId, finalDefenderId, finalAttackerWeaponId, finalDefenderWeaponId, {
        attackerInitiative: Math.max(attackerInit, defenderInitiative),
        defenderInitiative: Math.min(attackerInit, defenderInitiative),
        attackerManeuver: finalAttackerManeuver,
        defenderManeuver: finalDefenderManeuver,
        attackerChargeLevel: finalAttackerChargeLevel,
        defenderChargeLevel: finalDefenderChargeLevel
    });
  }

  /**
   * Anuluje oczekujące starcie.
   */
  static async dismissMeleePending(pendingUuid) {
      const combat = game.combat;
      if (!combat) return;
      game.neuroshima.log("Usuwanie oczekującego starcia (Dismiss):", pendingUuid);
      
      const pendingKey = pendingUuid.replace(/\./g, "-");
      const pendings = combat.getFlag("neuroshima", "meleePendings") || {};
      if (!pendings[pendingKey]) {
          game.neuroshima.warn("Próba usunięcia nieistniejącego starcia:", pendingUuid);
          return;
      }

      if (game.neuroshima.socket) {
          await game.neuroshima.socket.executeAsGM("unsetCombatFlag", `meleePendings.${pendingKey}`);
      } else {
          await combat.unsetFlag("neuroshima", `meleePendings.${pendingKey}`);
      }
      game.neuroshima.log("Usunięto pomyślnie oczekujące starcie.");
  }

  /**
   * Rozpoczyna nowy pojedynek 1v1 lub dodaje napastników do istniejącego.
   */
  static async startDuel(attackerId, defenderId, attackerWeaponId = null, defenderWeaponId = null, initiativeData = {}) {
    const combat = game.combat;
    if (!combat) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoActiveCombat"));
        return;
    }

    game.neuroshima.group("MeleeCombat | startDuel");
    game.neuroshima.log("Inicjalizacja starcia:", { attackerId, defenderId, attackerWeaponId, defenderWeaponId });

    const attacker = (fromUuidSync(attackerId) instanceof foundry.abstract.Document) ? fromUuidSync(attackerId)?.actor || fromUuidSync(attackerId) : game.actors.get(attackerId);
    const defender = (fromUuidSync(defenderId) instanceof foundry.abstract.Document) ? fromUuidSync(defenderId)?.actor || fromUuidSync(defenderId) : game.actors.get(defenderId);
    
    if (!attacker || !defender) {
        game.neuroshima.error("Nie znaleziono aktora atakującego lub broniącego.", { attackerId, defenderId, attacker, defender });
        game.neuroshima.groupEnd();
        return;
    }

    const duelId = `${attacker.uuid}-${defender.uuid}`.replace(/\./g, "-");
    const duels = combat.getFlag("neuroshima", "meleeDuels") || {};

    game.neuroshima.log(`Sprawdzanie istnienia pojedynku dla ID: ${duelId}`);

    // Sprawdź czy starcie z tym obrońcą już trwa
    for (let id in duels) {
        const d = duels[id];
        if (d.active && d.defender.id === defender.uuid) {
            game.neuroshima.log("Znaleziono aktywne starcie z tym obrońcą. Sprawdzam dodatkowych napastników.");
            if (d.multiOpponents.length >= 4) {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.MeleeLimitReached"));
                game.neuroshima.groupEnd();
                return;
            }
            if (!d.multiOpponents.includes(attacker.uuid) && d.attacker.id !== attacker.uuid) {
                game.neuroshima.log("Dodawanie nowego napastnika do listy multiOpponents.");
                const multiOpponents = [...d.multiOpponents, attacker.uuid];
                const updateData = { multiOpponents };
                if (!d.log) updateData.log = [];
                
                if (game.neuroshima.socket) {
                    await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleeDuels.${id}`, updateData);
                } else {
                    await combat.setFlag("neuroshima", `meleeDuels.${id}`, updateData);
                }
                await attacker.setFlag("neuroshima", "activeMeleeDuel", id);
                game.neuroshima.log("Dodano dodatkowego napastnika do multi-starcia.", { attackerName: attacker.name });
            }
            this.openMeleeApp(id);
            game.neuroshima.groupEnd();
            return;
        }
    }

    game.neuroshima.log("Tworzenie nowego obiektu starcia (MeleeDuel).");
        const attackerSkill = this._getMeleeSkill(attacker, attackerWeaponId);
    const defenderSkill = this._getMeleeSkill(defender, defenderWeaponId);

    const attackerWeapon = attacker.items.get(attackerWeaponId);
    const defenderWeapon = defender.items.get(defenderWeaponId);
    const attackerAttr = attackerWeapon?.system.attribute || "dexterity";
    const defenderAttr = defenderWeapon?.system.attribute || "dexterity";

    const meleeData = {
        id: duelId,
        attacker: {
            id: attacker.uuid,
            name: attacker.name,
            img: attacker.img,
            weaponId: attackerWeaponId,
            dice: [],
            skillValue: attackerSkill.value,
            skillName: attackerSkill.name,
            skillSpent: 0,
            targetValue: attacker.system.attributeTotals?.[attackerAttr] || 10,
            effectiveTarget: attacker.system.attributeTotals?.[attackerAttr] || 10,
            initiative: initiativeData.attackerInitiative || 0,
            usedDiceIndices: [],
            selectedIndices: []
        },
        defender: {
            id: defender.uuid,
            name: defender.name,
            img: defender.img,
            weaponId: defenderWeaponId,
            dice: [],
            skillValue: defenderSkill.value,
            skillName: defenderSkill.name,
            skillSpent: 0,
            targetValue: defender.system.attributeTotals?.[defenderAttr] || 10,
            effectiveTarget: defender.system.attributeTotals?.[defenderAttr] || 10,
            initiative: initiativeData.defenderInitiative || 0,
            usedDiceIndices: [],
            selectedIndices: []
        },
        phase: "pool-roll",
        currentTurn: 1,
        currentSegment: 1,
        currentAttacker: "attacker", // Kto aktualnie ma inicjatywę w segmencie
        centralId: defender.uuid,     // Kto jest celem ataku grupowego (alone person)
        active: true,
        selectionTurn: null, // Będzie ustawione po rzutach puli
        multiOpponents: [],
        log: []
    };

    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleeDuels.${duelId}`, meleeData);
    } else {
        duels[duelId] = meleeData;
        await combat.setFlag("neuroshima", "meleeDuels", duels);
    }
    
    // Ustawiamy flagi na aktorach/combatantach dla szybkiego dostępu (WFRP style)
    await this._setActorMeleeFlags(attacker, defender, duelId);

    this.openMeleeApp(duelId);
    game.neuroshima.groupEnd();
  }

  /**
   * Ustawia flagi pomocnicze na aktorach biorących udział w pojedynku.
   * @private
   */
  static async _setActorMeleeFlags(attacker, defender, duelId) {
      const attackerDoc = attacker.actor || attacker;
      const defenderDoc = defender.actor || defender;
      await attackerDoc.setFlag("neuroshima", "activeMeleeDuel", duelId);
      await defenderDoc.setFlag("neuroshima", "activeMeleeDuel", duelId);
      game.neuroshima.log(`Ustawiono flagi activeMeleeDuel dla ${attackerDoc.name} i ${defenderDoc.name}`);
  }

  /**
   * Czyści flagi po zakończeniu pojedynku.
   */
  static async clearMeleeFlags(duelId) {
      const combat = game.combat;
      if (!combat) return;

      const duels = combat.getFlag("neuroshima", "meleeDuels") || {};
      const duel = duels[duelId];
      if (!duel) return;

      if (game.neuroshima.socket) {
          await game.neuroshima.socket.executeAsGM("unsetCombatFlag", `meleeDuels.${duelId}`);
      } else {
          await combat.unsetFlag("neuroshima", `meleeDuels.${duelId}`);
      }
      
      const attackerDoc = fromUuidSync(duel.attacker.id);
      const defenderDoc = fromUuidSync(duel.defender.id);
      const attacker = attackerDoc?.actor || attackerDoc;
      const defender = defenderDoc?.actor || defenderDoc;

      if (attacker) await attacker.unsetFlag("neuroshima", "activeMeleeDuel");
      if (defender) await defender.unsetFlag("neuroshima", "activeMeleeDuel");
      
      for (const uuid of duel.multiOpponents || []) {
          const opponentDoc = fromUuidSync(uuid);
          const opponent = opponentDoc?.actor || opponentDoc;
          if (opponent) await opponent.unsetFlag("neuroshima", "activeMeleeDuel");
      }
      
      game.neuroshima.log(`Wyczyszczono flagi activeMeleeDuel dla starcia ${duelId}`);
  }

  /**
   * Usuwa aktywne starcie i czyści flagi wszystkich uczestników.
   */
  static async dismissMeleeDuel(duelId) {
      if (!game.user.isGM) return;
      await this.clearMeleeFlags(duelId);
  }

  /**
   * Wykonuje rzut "darmową obroną" przeciwko dodatkowemu napastnikowi.
   */
  static async rollFreeDefense(defenderUuid, attackerUuid, diceCount = 1, duelId = null) {
    const defenderDoc = fromUuidSync(defenderUuid);
    const attackerDoc = fromUuidSync(attackerUuid);
    const defender = defenderDoc?.actor || defenderDoc;
    const attacker = attackerDoc?.actor || attackerDoc;
    if (!defender || !attacker) return;

    const combat = game.combat;
    const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
    const meleeData = duelId ? duels[duelId] : Object.values(duels).find(d => d.defender.id === defenderUuid);
    
    // Kara do Zręczności obrońcy = liczba przeciwników (Główny + Dodatkowi)
    const opponentCount = 1 + (meleeData?.multiOpponents?.length || 0);
    const targetValue = (defender.system.attributeTotals?.dexterity || 10) - opponentCount;

    // Rzut darmowymi kośćmi "z powietrza"
    const roll = await new Roll(`${diceCount}d20`).evaluate();
    const results = roll.dice[0].results.map(r => r.result);
    const successes = results.filter(v => v <= targetValue).length;
    const isSuccess = successes === diceCount;

    // Renderowanie wiadomości na czacie
    const content = await foundry.applications.handlebars.renderTemplate("systems/neuroshima/templates/chat/melee-free-defense.hbs", {
        defender,
        attacker,
        results,
        targetValue,
        diceCount,
        successes,
        isSuccess,
        config: CONFIG.NEUROSHIMA
    });

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: defender }),
        content,
        flags: { neuroshima: { type: "freeDefense" } }
    });

    if (!isSuccess) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.DefenseFailed"));
    } else {
        ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeDuel.DefenseSuccess"));
    }
  }

  /**
   * Pomocnicza metoda do pobrania wartości umiejętności walki wręcz.
   * @private
   */
  static _getMeleeSkill(actor, weaponId = null) {
    if (weaponId) {
        const weapon = actor.items.get(weaponId);
        if (weapon && weapon.system.skill) {
            const skillKey = weapon.system.skill; // e.g. "handWeapon"
            const skillValue = actor.system.skills?.dexterity?.[skillKey] || 0;
            return { name: skillKey, value: skillValue };
        }
    }

    const brawl = actor.system.skills?.dexterity?.brawl || 0;
    const handWeapon = actor.system.skills?.dexterity?.handWeapon || 0;
    
    // Prosta heurystyka: wybierz wyższą, chyba że będziemy przekazywać broń w przyszłości
    if (handWeapon > brawl) {
        return { name: "handWeapon", value: handWeapon };
    }
    return { name: "brawl", value: brawl };
  }

  /**
   * Zmienia aktywną broń w starciu dla danego aktora.
   */
  static async changeWeapon(actorUuid, duelId, newWeaponId) {
    const combat = game.combat;
    const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
    const meleeData = duels[duelId];
    if (!meleeData || !meleeData.active) return;

    const updatedMelee = foundry.utils.deepClone(meleeData);
    const role = updatedMelee.attacker.id === actorUuid ? "attacker" : "defender";
    
    const actorDoc = fromUuidSync(actorUuid);
    const actor = actorDoc?.actor || actorDoc;
    if (!actor) return;

    const weapon = actor.items.get(newWeaponId);
    if (!weapon) return;

    const skill = this._getMeleeSkill(actor, newWeaponId);
    updatedMelee[role].weaponId = newWeaponId;
    updatedMelee[role].skillValue = skill.value;
    updatedMelee[role].skillName = skill.name;
    updatedMelee[role].skillSpent = 0; // Resetujemy wydane punkty przy zmianie broni

    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleeDuels.${duelId}`, updatedMelee);
    } else {
        await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
    }
    
    game.neuroshima.log(`Zmieniono broń dla ${actor.name} na ${weapon.name}`);
  }

  /**
   * Wykonuje rzut puli 3k20 dla danego aktora w starciu.
   * @param {string} actorUuid
   * @param {string} duelId
   * @param {Object} [externalResults] Opcjonalne wyniki z zewnętrznego dialogu broni
   */
  static async rollPool(actorUuid, duelId, externalResults = null) {
    const combat = game.combat;
    const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
    const meleeData = duels[duelId];
    if (!meleeData || !meleeData.active) return;

    game.neuroshima.group(`MeleeCombat | rollPool [${duelId}]`);
    game.neuroshima.log("Rzut puli dla aktora:", actorUuid);

    const role = meleeData.attacker.id === actorUuid ? "attacker" : "defender";
    const actorDoc = fromUuidSync(actorUuid);
    const actor = actorDoc?.actor || actorDoc;
    if (!actor) {
        game.neuroshima.error("Nie znaleziono aktora.");
        game.neuroshima.groupEnd();
        return;
    }

    let diceResults, effectiveTarget;
    if (externalResults) {
        // Zapewniamy, że diceResults to tablica liczb (wyciągamy 'value' jeśli to obiekt)
        const raw = externalResults.results || externalResults.rawResults || [];
        diceResults = raw.map(r => {
            if (typeof r === 'object' && r !== null) {
                return Number(r.value ?? r.result ?? r.original ?? 0);
            }
            return Number(r);
        });
        effectiveTarget = (externalResults.target !== undefined) ? externalResults.target : meleeData[role].effectiveTarget;
        game.neuroshima.log("Używam wyników z dialogu broni (znormalizowane):", { diceResults, effectiveTarget });
    } else {
        const roll = await new Roll("3d20").evaluate();
        diceResults = roll.dice[0].results.map(r => r.result);
        effectiveTarget = meleeData[role].effectiveTarget;
        game.neuroshima.log("Wykonuję standardowy rzut 3k20:", diceResults);
    }

    // Kopia danych do aktualizacji
    const updatedMelee = foundry.utils.deepClone(meleeData);
    updatedMelee[role].dice = diceResults;
    
    // Zapisywanie modyfikatorów z rzutu puli do obiektu starcia
    if (externalResults) {
        updatedMelee[role].difficulty = externalResults.difficulty || "average";
        updatedMelee[role].attributeBonus = externalResults.attributeBonus || 0;
        updatedMelee[role].modifier = externalResults.modifier || 0;
        updatedMelee[role].maneuver = externalResults.maneuver || "none";
        updatedMelee[role].tempoLevel = externalResults.tempoLevel || 0;
        
        const weaponId = meleeData[role].weaponId;
        const weapon = actor.items.get(weaponId);
        
        // Target recalculation including dialog modifiers
        const weaponAttr = weapon?.system?.attribute || "dexterity";
        const baseAttr = Number(actor.system.attributeTotals[weaponAttr]) || 10;
        const basePenalty = NEUROSHIMA.difficulties[updatedMelee[role].difficulty]?.min || 0;
        const totalPenalty = basePenalty + updatedMelee[role].modifier;
        
        const { NeuroshimaDice } = await import("../helpers/dice.js");
        const baseDiffObj = NeuroshimaDice.getDifficultyFromPercent(totalPenalty);
        
        let effectiveAttrBonus = updatedMelee[role].attributeBonus;
        let finalDiff = baseDiffObj;
        
        if (updatedMelee[role].maneuver === "fury" || updatedMelee[role].maneuver === "fullDefense") {
            effectiveAttrBonus += 2;
        } else if (updatedMelee[role].maneuver === "increasedTempo") {
            finalDiff = NeuroshimaDice._getShiftedDifficulty(baseDiffObj, updatedMelee[role].tempoLevel);
        }
        
        effectiveTarget = baseAttr + effectiveAttrBonus + finalDiff.mod;
        
        // Weapon bonus if attribute mode
        const bonusMode = game.settings.get("neuroshima", "meleeBonusMode") || "attribute";
        if (bonusMode === "attribute" || bonusMode === "both") {
            const weaponBonus = (role === "attacker") ? (weapon.system.attackBonus || 0) : (weapon.system.defenseBonus || 0);
            effectiveTarget += weaponBonus;
        }
    }
    
    updatedMelee[role].effectiveTarget = effectiveTarget;
    
    // Jeśli obie strony rzuciły, przechodzimy do fazy segmentów
    const otherRole = role === "attacker" ? "defender" : "attacker";
    if (updatedMelee[otherRole].dice.length > 0) {
        updatedMelee.phase = "segments";
        // Ustawiamy turę wyboru na tego, kto ma wyższą inicjatywę
        const attackerInit = updatedMelee.attacker.initiative || 0;
        const defenderInit = updatedMelee.defender.initiative || 0;
        updatedMelee.selectionTurn = attackerInit >= defenderInit ? "attacker" : "defender";
        game.neuroshima.log(`Obie strony rzuciły pulę, zmiana fazy na 'segments'. Tura wyboru: ${updatedMelee.selectionTurn}`);
    }

    // Automatyczna optymalizacja rzutów (jeśli zasada Double Skill Action jest wyłączona)
    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");
    if (!doubleSkill) {
        game.neuroshima.log("Automatyczna optymalizacja (Double Skill Action wyłączone)");
        const optimized = this._autoOptimizeDice(diceResults, updatedMelee[role].skillValue, effectiveTarget);
        updatedMelee[role].dice = optimized.dice;
        updatedMelee[role].skillSpent = optimized.spent;
        game.neuroshima.log("Wyniki po optymalizacji:", optimized);
    }

    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleeDuels.${duelId}`, updatedMelee);
    } else {
        await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
    }
    
    // Ręczne wywołanie odświeżenia dla ApplicationV2
    for (const app of foundry.applications.instances.values()) {
        if (app.id === `melee-combat-app-${duelId}`) {
            app.render(true);
        }
    }
    
    // Renderowanie wiadomości na czacie o rzucie puli
    // Przygotowujemy dane obiektowe dla szablonu HBS
    const hbsDice = diceResults.map(val => {
        const numVal = Number(typeof val === 'object' ? (val.value ?? val.result ?? 0) : val);
        return {
            value: numVal,
            success: numVal <= effectiveTarget
        };
    });
    await this._renderPoolChatMessage(actor, hbsDice);
    game.neuroshima.groupEnd();
  }

  /**
   * Alias dla rollPool wywoływany z dialogu broni.
   */
  static async setPoolRollResults(duelId, actorId, rollResults) {
      return this.rollPool(actorId, duelId, rollResults);
  }

  /**
   * Automatycznie optymalizuje rzuty kośćmi wykorzystując dostępne punkty umiejętności.
   * @param {number[]} dice Oryginalne wyniki kości
   * @param {number} skill Dostępne punkty umiejętności
   * @param {number} target Próg sukcesu (Zręczność)
   * @returns {Object} { dice: number[], spent: number }
   * @private
   */
  static _autoOptimizeDice(dice, skill, target) {
    let remainingSkill = skill;
    let modifiedDice = [...dice];

    // Najpierw modyfikujemy te, którym brakuje najmniej do sukcesu
    const diceToOptimize = dice
        .map((val, idx) => ({ val, idx, diff: val - target }))
        .filter(d => d.diff > 0 && d.val !== 20) // Ignorujemy sukcesy i naturalne 20
        .sort((a, b) => a.diff - b.diff);

    for (let d of diceToOptimize) {
        if (remainingSkill >= d.diff) {
            modifiedDice[d.idx] = target;
            remainingSkill -= d.diff;
        } else if (remainingSkill > 0) {
            modifiedDice[d.idx] -= remainingSkill;
            remainingSkill = 0;
        }
    }

    return {
        dice: modifiedDice,
        spent: skill - remainingSkill
    };
  }

  /**
   * Manualna modyfikacja kości (używana przy Double Skill Action).
   */
  static async modifyDie(role, index, amount, duelId) {
    const combat = game.combat;
    const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
    const meleeData = duels[duelId];
    if (!meleeData || !meleeData.active) return;

    game.neuroshima.group(`MeleeCombat | modifyDie [${duelId}]`);
    game.neuroshima.log(`Modyfikacja kości roli ${role} [indeks ${index}] o ${amount}`);

    // Kto klika?
    const userRole = game.user.character?.uuid === meleeData.attacker.id ? "attacker" : (game.user.character?.uuid === meleeData.defender.id ? "defender" : "gm");
    
    // Punkty umiejętności są pobierane od osoby, która klika (modyfikuje)
    const modifierRole = userRole === "gm" ? (role === "attacker" ? "attacker" : "defender") : userRole;
    
    const updatedMelee = foundry.utils.deepClone(meleeData);
    const targetDice = updatedMelee[role].dice;
    
    // Zabezpieczenie Naturalnej 20
    if (targetDice[index] === 20) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.Natural20CannotBeModified"));
        game.neuroshima.groupEnd();
        return;
    }

    // Sprawdzenie dostępnych punktów
    const skillRemaining = updatedMelee[modifierRole].skillValue - updatedMelee[modifierRole].skillSpent;
    const absAmount = Math.abs(amount);
    
    if (skillRemaining < absAmount) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoSkillPoints"));
        game.neuroshima.groupEnd();
        return;
    }

    // Jeśli modyfikujemy własne, odejmujemy (zmniejszamy wynik)
    // Jeśli modyfikujemy przeciwnika ("psucie"), dodajemy (zwiększamy wynik)
    const direction = (role === modifierRole) ? -1 : 1;
    targetDice[index] = Math.clamp(targetDice[index] + (absAmount * direction), 1, 20);
    updatedMelee[modifierRole].skillSpent += absAmount;

    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleeDuels.${duelId}`, updatedMelee);
    } else {
        await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
    }
    game.neuroshima.groupEnd();
  }

  /**
   * Zaznacza kość do użycia w bieżącym segmencie.
   */
  static async selectDie(role, index, duelId) {
    const combat = game.combat;
    const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
    const meleeData = duels[duelId];
    if (!meleeData || !meleeData.active) return;

    game.neuroshima.group(`MeleeCombat | selectDie [${duelId}]`);
    game.neuroshima.log(`Wybór kości roli ${role} [indeks ${index}]`);

    const updatedMelee = foundry.utils.deepClone(meleeData);
    
    // Sprawdź czy to tura tej roli
    if (updatedMelee.selectionTurn && updatedMelee.selectionTurn !== role) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NotYourSelectionTurn"));
        game.neuroshima.groupEnd();
        return;
    }

    const roleData = updatedMelee[role];

    // Czy ta kość była już zużyta?
    if (roleData.usedDiceIndices.includes(index)) {
        game.neuroshima.log("Kość została już zużyta w poprzednich segmentach.");
        game.neuroshima.groupEnd();
        return;
    }

    const selectedIndices = roleData.selectedIndices || [];
    if (selectedIndices.includes(index)) {
        // Odznacz
        selectedIndices.splice(selectedIndices.indexOf(index), 1);
        game.neuroshima.log("Odznaczono kość.");
    } else {
        // Zaznacz (limit 3)
        if (selectedIndices.length < 3) {
            selectedIndices.push(index);
            game.neuroshima.log("Zaznaczono kość.");
        } else {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.MeleeDiceLimit"));
        }
    }

    roleData.selectedIndices = selectedIndices;
    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleeDuels.${duelId}`, updatedMelee);
    } else {
        await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
    }
    game.neuroshima.groupEnd();
  }

  /**
   * Zatwierdza wybór kości i przełącza turę na drugiego gracza.
   */
  static async confirmSelection(role, duelId) {
      const combat = game.combat;
      const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
      const meleeData = duels[duelId];
      if (!meleeData || !meleeData.active) return;

      if (meleeData.selectionTurn !== role) {
          ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NotYourSelectionTurn"));
          return;
      }

      const updatedMelee = foundry.utils.deepClone(meleeData);
      const otherRole = role === "attacker" ? "defender" : "attacker";
      
      const attackerSelected = updatedMelee.attacker.selectedIndices || [];
      const defenderSelected = updatedMelee.defender.selectedIndices || [];
      const mySelected = role === "attacker" ? attackerSelected : defenderSelected;
      const otherSelected = role === "attacker" ? defenderSelected : attackerSelected;

      // Walidacja: nie można zatwierdzić 0 kości
      if (mySelected.length === 0) {
          ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.MeleeNeedsDice"));
          return;
      }

      // Walidacja: jeśli druga strona już wybrała kości, my musimy wybrać TĄ SAMĄ LICZBĘ (zasada Neuroshimy)
      if (otherSelected.length > 0 && mySelected.length !== otherSelected.length) {
          ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.MeleeMatchDiceCount"));
          return;
      }

      // Jeśli tylko jedna strona ma wybrany zestaw kości, przełączamy turę na drugą stronę
      if (otherSelected.length === 0) {
          updatedMelee.selectionTurn = otherRole;
          
          // Jeśli jednak druga strona nie ma już żadnych kości do użycia, musimy rozstrzygnąć to co mamy
          const otherData = updatedMelee[otherRole];
          if (otherData.usedDiceIndices.length >= otherData.dice.length) {
              updatedMelee.selectionTurn = "gm";
          }
      } else {
          // Obie strony wybrały kości - przechodzimy do rozstrzygnięcia
          updatedMelee.selectionTurn = "gm";
      }

      if (game.neuroshima.socket) {
          await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleeDuels.${duelId}`, updatedMelee);
      } else {
          await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
      }

      // Automatyczne rozstrzygnięcie jeśli obie strony dokonały wyboru lub tura przeszła na GM
      if (updatedMelee.selectionTurn === "gm") {
          game.neuroshima.log("Warunki spełnione. Automatyczne rozstrzyganie segmentów.");
          await this.resolveSegment(duelId, updatedMelee);
      }
  }

  /**
   * Rozstrzyga bieżący segment tury.
   * @param {string} duelId
   * @param {Object} [externalData] Opcjonalne dane do użycia zamiast czytania z flagi
   */
  static async resolveSegment(duelId, externalData = null) {
    const combat = game.combat;
    const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
    const meleeData = externalData || duels[duelId];
    if (!meleeData || !meleeData.active) return;

    game.neuroshima.group(`MeleeCombat | resolveSegment [${duelId}] (Segment ${meleeData.currentSegment})`);

    const attackerSelected = meleeData.attacker.selectedIndices || [];
    const defenderSelected = meleeData.defender.selectedIndices || [];

    // Jeśli ktoś nie ma kości, a turn się nie skończył, to bierzemy pustą tablicę dla niego
    // Ale normalnie confirmSelection pilnuje, żeby było tyle samo.
    if (attackerSelected.length === 0 && defenderSelected.length === 0) {
        game.neuroshima.log("Brak wybranych kości po obu stronach. Sprawdzam czy koniec tury.");
        // Jeśli to koniec tury (wszystkie kości zużyte), to inkrementujemy tura
        const updatedMelee = foundry.utils.deepClone(meleeData);
        if (updatedMelee.currentSegment >= 3 || (updatedMelee.attacker.usedDiceIndices.length >= updatedMelee.attacker.dice.length && updatedMelee.defender.usedDiceIndices.length >= updatedMelee.defender.dice.length)) {
            await this._advanceTurn(duelId, updatedMelee);
        }
        game.neuroshima.groupEnd();
        return;
    }

    if (attackerSelected.length !== defenderSelected.length) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.MeleeMatchDiceCount"));
        game.neuroshima.groupEnd();
        return;
    }

    const updatedMelee = foundry.utils.deepClone(meleeData);
    const attackerDiceValues = attackerSelected.map(i => {
        const die = updatedMelee.attacker.dice[i];
        return typeof die === 'object' ? Number(die.value) : Number(die);
    });
    const defenderDiceValues = defenderSelected.map(i => {
        const die = updatedMelee.defender.dice[i];
        return typeof die === 'object' ? Number(die.value) : Number(die);
    });

    const multiOpponentPenalty = updatedMelee.multiOpponents?.length > 0 ? (1 + updatedMelee.multiOpponents.length) : 0;
    
    // Calculate final effective targets including maneuvers and multi-opponent penalty
    const { NeuroshimaDice } = await import("../helpers/dice.js");
    
    const calculateEffectiveTarget = (role) => {
        const data = updatedMelee[role];
        const otherRole = role === "attacker" ? "defender" : "attacker";
        const otherData = updatedMelee[otherRole];
        
        // Apply base difficulty and percentage modifier from pool roll
        const diffKey = data.difficulty || "average";
        const basePenalty = NEUROSHIMA.difficulties[diffKey]?.min || 0;
        const totalPenalty = basePenalty + (data.modifier || 0);
        
        const baseDiffObj = NeuroshimaDice.getDifficultyFromPercent(totalPenalty);
        
        let bonus = (data.attributeBonus || 0);
        let shift = 0;
        
        // Apply maneuver bonuses (+2 to attribute)
        if (data.maneuver === "fury" || data.maneuver === "fullDefense") {
            bonus += 2;
        }
        
        // Apply increased tempo shift (affects both sides)
        const myTempo = (data.maneuver === "increasedTempo") ? (Number(data.tempoLevel) || 0) : 0;
        const otherTempo = (otherData.maneuver === "increasedTempo") ? (Number(otherData.tempoLevel) || 0) : 0;
        shift += Math.max(myTempo, otherTempo);
        
        const shiftedDiff = NeuroshimaDice._getShiftedDifficulty(baseDiffObj, shift);
        
        let target = (data.targetValue || 10) + bonus + shiftedDiff.mod;
        
        // Apply weapon bonus to target if setting allows
        const bonusMode = game.settings.get("neuroshima", "meleeBonusMode") || "attribute";
        if (bonusMode === "attribute" || bonusMode === "both") {
            const actorDoc = fromUuidSync(data.id);
            const actor = actorDoc?.actor || actorDoc;
            const weapon = actor?.items.get(data.weaponId);
            if (weapon) {
                const weaponBonus = (role === "attacker") ? (weapon.system.attackBonus || 0) : (weapon.system.defenseBonus || 0);
                target += weaponBonus;
            }
        }
        
        // Multi-opponent penalty only for the central participant (the one being ganged up on)
        if (data.id === updatedMelee.centralId) {
            target -= multiOpponentPenalty;
        }
        
        return target;
    };

    const effectiveAttackerTarget = calculateEffectiveTarget("attacker");
    const effectiveDefenderTarget = calculateEffectiveTarget("defender");

    game.neuroshima.log("Parametry rozstrzygania:", {
        attackerDice: attackerDiceValues,
        defenderDice: defenderDiceValues,
        attackerTarget: effectiveAttackerTarget,
        defenderTarget: effectiveDefenderTarget,
        opponentPenalty: multiOpponentPenalty,
        maneuvers: {
            attacker: updatedMelee.attacker.maneuver,
            defender: updatedMelee.defender.maneuver
        }
    });

    const attackerSuccesses = attackerDiceValues.filter(v => v <= effectiveAttackerTarget && v !== 20).length;
    const defenderSuccesses = defenderDiceValues.filter(v => v <= effectiveDefenderTarget && v !== 20).length;

    let result = "miss";
    let messageKey = "NEUROSHIMA.MeleeDuel.ResultMiss";
    
    // Log entry construction
    if (!updatedMelee.log) updatedMelee.log = [];
    const logEntry = {
        segment: meleeData.currentSegment,
        type: "miss",
        text: ""
    };

    // New logic: Attacker hits if they have more successes than the defender
    if (attackerSuccesses > defenderSuccesses) {
        result = "hit";
        messageKey = "NEUROSHIMA.MeleeDuel.ResultHit";
        logEntry.type = "hit";
        
        const attacker = game.actors.get(updatedMelee.attacker.id);
        const defender = game.actors.get(updatedMelee.defender.id);
        
        // Base damage based on attacker successes
        let damageLevel = attackerSuccesses >= 3 ? "K" : (attackerSuccesses === 2 ? "C" : "L");
        const location = this._determineLocation(attackerDiceValues);
        
        // Raise damage if 1-2 was rolled or head hit (max 1 raise)
        const hasNaturalRaise = attackerDiceValues.some(v => v <= 2);
        const isHeadHit = location === "head";
        let raised = false;
        
        if (hasNaturalRaise || isHeadHit) {
            const nextLevel = { "D": "L", "L": "C", "C": "K", "K": "K" };
            const oldLevel = damageLevel;
            damageLevel = nextLevel[damageLevel] || damageLevel;
            if (oldLevel !== damageLevel) raised = true;
        }

        logEntry.text = game.i18n.format("NEUROSHIMA.MeleeDuel.LogHit", {
            attacker: updatedMelee.attacker.name,
            defender: updatedMelee.defender.name,
            damage: damageLevel,
            location: game.i18n.localize(`NEUROSHIMA.BodyLocations.${location}`)
        });
        
        if (raised) {
            logEntry.text += ` (${game.i18n.localize("NEUROSHIMA.Roll.CritSuccess")})`;
        }

        if (attacker && defender) {
            const attackData = {
                actorId: attacker.id,
                label: attacker.name,
                isMelee: true,
                successPoints: attackerSuccesses,
                damage: damageLevel,
                finalLocation: location
            };
            game.neuroshima.log("Trafienie! Aplikowanie obrażeń:", attackData);
            await game.neuroshima.CombatHelper.applyDamageToActor(defender, attackData, { isOpposed: true });
        }
    } else {
        // defenderSuccesses >= attackerSuccesses -> Blocked
        const isFullDefense = updatedMelee.defender.maneuver === "fullDefense";
        const advantage = defenderSuccesses - attackerSuccesses;
        
        if (advantage > 0) {
            // Potential Takeover
            if (isFullDefense) {
                updatedMelee.defender.fullDefenseAccumulator = (updatedMelee.defender.fullDefenseAccumulator || 0) + advantage;
            }
            
            const canTakeover = !isFullDefense || (updatedMelee.defender.fullDefenseAccumulator >= 2);
            
            if (canTakeover) {
                result = "takeover";
                messageKey = "NEUROSHIMA.MeleeDuel.ResultTakeover";
                logEntry.type = "takeover";
                if (isFullDefense) updatedMelee.defender.fullDefenseAccumulator = 0;
                
                logEntry.text = game.i18n.format("NEUROSHIMA.MeleeDuel.LogTakeover", {
                    newAttacker: updatedMelee.defender.name,
                    oldAttacker: updatedMelee.attacker.name
                });
                
                // Fury rule
                if (updatedMelee.attacker.maneuver === "fury") {
                    const attacker = game.actors.get(updatedMelee.attacker.id);
                    const defender = game.actors.get(updatedMelee.defender.id);
                    if (attacker && defender) {
                        const counterAttackData = {
                            actorId: defender.id,
                            label: defender.name,
                            isMelee: true,
                            successPoints: defenderSuccesses,
                            damage: defenderSuccesses >= 3 ? "K" : (defenderSuccesses === 2 ? "C" : "L"),
                            finalLocation: this._determineLocation(defenderDiceValues)
                        };
                        await game.neuroshima.CombatHelper.applyDamageToActor(attacker, counterAttackData, { isOpposed: true });
                        logEntry.text += " " + game.i18n.localize("NEUROSHIMA.MeleeDuel.LogFuryHit");
                    }
                }
            } else {
                // Blocked but not enough for Full Defense takeover
                result = "remis";
                messageKey = "NEUROSHIMA.MeleeDuel.ResultRemis";
                logEntry.type = "remis";
                logEntry.text = game.i18n.format("NEUROSHIMA.MeleeDuel.LogFullDefenseBlock", {
                    defender: updatedMelee.defender.name
                });
            }
        } else {
            // attackerSuccesses == defenderSuccesses -> Remis
            result = "remis";
            messageKey = "NEUROSHIMA.MeleeDuel.ResultRemis";
            logEntry.type = "remis";
            logEntry.text = game.i18n.format("NEUROSHIMA.MeleeDuel.LogRemis", {
                attacker: updatedMelee.attacker.name,
                defender: updatedMelee.defender.name,
                count: attackerSuccesses
            });
        }
    }

    updatedMelee.log.unshift(logEntry); // Newest at top
    if (updatedMelee.log.length > 20) updatedMelee.log.pop();

    game.neuroshima.log(`Wynik segmentu: ${result}`);

    // Aktualizacja stanu
    updatedMelee.attacker.usedDiceIndices = [...updatedMelee.attacker.usedDiceIndices, ...attackerSelected];
    updatedMelee.defender.usedDiceIndices = [...updatedMelee.defender.usedDiceIndices, ...defenderSelected];
    updatedMelee.attacker.selectedIndices = [];
    updatedMelee.defender.selectedIndices = [];
    
    // Inkrementacja segmentu o liczbę zużytych kości (1 kość = 1 segment)
    updatedMelee.currentSegment += attackerSelected.length;

    if (result === "takeover") {
        const oldAttacker = foundry.utils.deepClone(updatedMelee.attacker);
        const oldDefender = foundry.utils.deepClone(updatedMelee.defender);
        updatedMelee.attacker = oldDefender;
        updatedMelee.defender = oldAttacker;
        
        // Persist initiative: The one who took over should have higher initiative now
        // so they are the "Attacker" from now on.
        const maxInit = Math.max(updatedMelee.attacker.initiative || 0, updatedMelee.defender.initiative || 0);
        updatedMelee.attacker.initiative = maxInit + 1;
        updatedMelee.defender.initiative = maxInit;
    }

    // Sprawdzenie czy tura się skończyła (wykorzystano 3 segmenty lub brak kości u obu stron)
    const attackerOut = updatedMelee.attacker.usedDiceIndices.length >= updatedMelee.attacker.dice.length;
    const defenderOut = updatedMelee.defender.usedDiceIndices.length >= updatedMelee.defender.dice.length;

    if (updatedMelee.currentSegment > 3 || (attackerOut && defenderOut)) {
        updatedMelee.currentTurn = (updatedMelee.currentTurn || 1) + 1;
        updatedMelee.currentSegment = 1;
        updatedMelee.phase = "pool-roll";
        
        // Log turn end
        updatedMelee.log.unshift({
            segment: 3,
            type: "system",
            text: game.i18n.format("NEUROSHIMA.MeleeDuel.LogTurnEnd", { turn: updatedMelee.currentTurn - 1 })
        });

        // Resetujemy kości dla obu stron, aby umożliwić nowy rzut puli w nowej turze
        updatedMelee.attacker.dice = [];
        updatedMelee.attacker.usedDiceIndices = [];
        updatedMelee.attacker.selectedIndices = [];
        updatedMelee.defender.dice = [];
        updatedMelee.defender.usedDiceIndices = [];
        updatedMelee.defender.selectedIndices = [];
        updatedMelee.selectionTurn = null; 
        game.neuroshima.log(`Tura zakończona, rozpoczęcie tury ${updatedMelee.currentTurn}`);
    } else {
        // Resetujemy turę wyboru dla kolejnego segmentu (zaczyna posiadacz inicjatywy)
        const attackerInit = updatedMelee.attacker.initiative || 0;
        const defenderInit = updatedMelee.defender.initiative || 0;
        updatedMelee.selectionTurn = attackerInit >= defenderInit ? "attacker" : "defender";
        
        // Jeśli posiadacz inicjatywy nie ma już kości, tura przechodzi na drugą osobę
        if (updatedMelee[updatedMelee.selectionTurn].usedDiceIndices.length >= updatedMelee[updatedMelee.selectionTurn].dice.length) {
            updatedMelee.selectionTurn = updatedMelee.selectionTurn === "attacker" ? "defender" : "attacker";
        }
    }

    if (game.neuroshima.socket) {
        await game.neuroshima.socket.executeAsGM("updateCombatFlag", `meleeDuels.${duelId}`, updatedMelee);
    } else {
        await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
    }
    
    const message = game.i18n.localize(messageKey);
    await ChatMessage.create({
        content: `<div class="neuroshima chat-card melee-result-card">
            <div class="card-header">
                <i class="fas fa-swords"></i>
                <span>${game.i18n.localize("NEUROSHIMA.MeleeDuel.Title")} - ${game.i18n.localize("NEUROSHIMA.Roll.Segment")} ${meleeData.currentSegment}</span>
            </div>
            <div class="card-content">
                <div class="result-label">${message}</div>
            </div>
        </div>`,
        speaker: { alias: game.i18n.localize("NEUROSHIMA.MeleeDuel.Title") }
    });
    game.neuroshima.groupEnd();
  }

  /**
   * Ustala lokację trafienia na podstawie surowych wyników kości (niezmodyfikowanych).
   * Przy ciosach łączonych atakujący wybiera (tutaj: bierzemy pierwszą jako domyślną).
   * @private
   */
  static _determineLocation(diceValues) {
    const val = diceValues[0]; // TODO: Pozwolić graczowi wybrać kość lokacji przy 2s/3s
    if (val <= 2) return "head";
    if (val <= 4) return "rightArm";
    if (val <= 6) return "leftArm";
    if (val <= 15) return "torso";
    if (val <= 18) return "rightLeg";
    return "leftLeg";
  }

  /**
   * Otwiera interfejs walki wręcz.
   */
  static async openMeleeApp(duelId) {
    const { MeleeCombatApp } = await import("../apps/melee-combat-app.js");
    
    // Sprawdź czy okno dla tego duelId jest już otwarte
    const appId = `melee-combat-app-${duelId}`;
    const existing = Object.values(ui.windows).find(app => app.id === appId);
    if (existing) {
        existing.bringToFront();
        return existing;
    }

    const app = new MeleeCombatApp(duelId);
    return app.render(true);
  }

  /**
   * Prywatna metoda do renderowania wiadomości o rzucie puli.
   * @private
   */
  static async _renderPoolChatMessage(actor, dice) {
    const content = await foundry.applications.handlebars.renderTemplate("systems/neuroshima/templates/chat/melee-pool-card.hbs", {
        actor,
        dice,
        config: CONFIG.NEUROSHIMA
    });

    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content,
        flags: { neuroshima: { type: "meleePool" } }
    });
  }
}
