/**
 * Klasa zarządzająca logiką walki wręcz (Melee Duel) w systemie Neuroshima 1.5.
 * Odpowiada za synchronizację stanu starcia we flagach dokumentu Combat
 * oraz udostępnia metody do rzutu puli, modyfikacji kości i rozstrzygania segmentów.
 */
export class NeuroshimaMeleeCombat {
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
  static async initiateMeleePending(attackerUuid, defenderUuid, attackerInitiative, weaponId) {
    const combat = game.combat;
    if (!combat) {
        game.neuroshima.warn("Próba inicjalizacji starcia bez aktywnej walki.");
        return;
    }

    game.neuroshima.log("MeleeCombat | initiateMeleePending", { attackerUuid, defenderUuid, attackerInitiative });

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
        weaponId,
        active: true,
        timestamp: Date.now()
    };

    await combat.setFlag("neuroshima", `meleePendings.${pendingKey}`, pendingData);
    game.neuroshima.log(`Ustawiono flagę meleePendings.${pendingKey}`, pendingData);
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeDuel.PendingNotification"));
  }

  /**
   * Reakcja obrońcy na starcie - rzut na inicjatywę i start pojedynku.
   */
  static async respondToMeleePending(pendingUuid, defenderInitiative, defenderWeaponId = null) {
    const combat = game.combat;
    const pendingKey = pendingUuid.replace(/\./g, "-");
    const pendings = combat?.getFlag("neuroshima", "meleePendings") || {};
    const pending = pendings[pendingKey];
    
    game.neuroshima.log("Obrońca odpowiada na starcie:", { pendingUuid, defenderInitiative, pending, defenderWeaponId });

    if (!pending || !pending.active) {
        game.neuroshima.error("Nie znaleziono oczekującego starcia dla UUID:", pendingUuid);
        return;
    }

    const attackerId = pending.attackerId;
    const defenderId = pending.defenderId;
    const attackerInit = pending.attackerInitiative;
    const attackerWeaponId = pending.weaponId;

    // Rozstrzygnięcie kto ma inicjatywę
    let finalAttackerId, finalDefenderId, finalAttackerWeaponId, finalDefenderWeaponId;
    if (attackerInit >= defenderInitiative) {
        game.neuroshima.log("Atakujący wygrywa inicjatywę.");
        finalAttackerId = attackerId;
        finalDefenderId = defenderId;
        finalAttackerWeaponId = attackerWeaponId;
        finalDefenderWeaponId = defenderWeaponId;
    } else {
        game.neuroshima.log("Obrońca przejmuje inicjatywę (staje się atakującym).");
        finalAttackerId = defenderId;
        finalDefenderId = attackerId;
        finalAttackerWeaponId = defenderWeaponId;
        finalDefenderWeaponId = attackerWeaponId;
    }

    // Usuwamy pending przed startem właściwego pojedynku
    game.neuroshima.log("Usuwanie flagi pending przed startem pojedynku.");
    await combat.unsetFlag("neuroshima", `meleePendings.${pendingKey}`);

    // Startujemy właściwy pojedynek
    game.neuroshima.log("Parowanie zakończone. Startowanie starcia dla:", { finalAttackerId, finalDefenderId });
    await this.startDuel(finalAttackerId, finalDefenderId, finalAttackerWeaponId, finalDefenderWeaponId);
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

      await combat.unsetFlag("neuroshima", `meleePendings.${pendingKey}`);
      game.neuroshima.log("Usunięto pomyślnie oczekujące starcie.");
  }

  /**
   * Rozpoczyna nowy pojedynek 1v1 lub dodaje napastników do istniejącego.
   */
  static async startDuel(attackerId, defenderId, attackerWeaponId = null, defenderWeaponId = null) {
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
                await combat.setFlag("neuroshima", "meleeDuels", { [`${id}.multiOpponents`]: multiOpponents });
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
            targetValue: attacker.system.attributeTotals?.dexterity || 10,
            effectiveTarget: attacker.system.attributeTotals?.dexterity || 10,
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
            targetValue: defender.system.attributeTotals?.dexterity || 10,
            effectiveTarget: defender.system.attributeTotals?.dexterity || 10,
            usedDiceIndices: [],
            selectedIndices: []
        },
        phase: "pool-roll",
        currentSegment: 1,
        active: true,
        multiOpponents: []
    };

    duels[duelId] = meleeData;
    await combat.setFlag("neuroshima", "meleeDuels", duels);
    
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
      const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
      const duel = duels[duelId];
      if (!duel) return;

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
    const content = await renderTemplate("systems/neuroshima/templates/chat/melee-free-defense.hbs", {
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
   * Wykonuje rzut puli 3k20 dla danego aktora w starciu.
   * @param {string} actorId
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
        diceResults = externalResults.rawResults || [];
        effectiveTarget = externalResults.target || meleeData[role].effectiveTarget;
        game.neuroshima.log("Używam wyników z dialogu broni:", { diceResults, effectiveTarget });
    } else {
        const roll = await new Roll("3d20").evaluate();
        diceResults = roll.dice[0].results.map(r => r.result);
        effectiveTarget = meleeData[role].effectiveTarget;
        game.neuroshima.log("Wykonuję standardowy rzut 3k20:", diceResults);
    }

    // Kopia danych do aktualizacji
    const updatedMelee = foundry.utils.deepClone(meleeData);
    updatedMelee[role].dice = diceResults;
    updatedMelee[role].effectiveTarget = effectiveTarget;
    
    // Jeśli obie strony rzuciły, przechodzimy do fazy segmentów
    const otherRole = role === "attacker" ? "defender" : "attacker";
    if (updatedMelee[otherRole].dice.length > 0) {
        updatedMelee.phase = "segments";
        game.neuroshima.log("Obie strony rzuciły pulę, zmiana fazy na 'segments'");
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

    await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
    
    // Renderowanie wiadomości na czacie o rzucie puli
    await this._renderPoolChatMessage(actor, diceResults);
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
    const userRole = game.user.character?.id === meleeData.attacker.id ? "attacker" : (game.user.character?.id === meleeData.defender.id ? "defender" : "gm");
    
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

    await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
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
    await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
    game.neuroshima.groupEnd();
  }

  /**
   * Rozstrzyga bieżący segment tury.
   */
  static async resolveSegment(duelId) {
    const combat = game.combat;
    const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
    const meleeData = duels[duelId];
    if (!meleeData || !meleeData.active) return;

    game.neuroshima.group(`MeleeCombat | resolveSegment [${duelId}] (Segment ${meleeData.currentSegment})`);

    const attackerSelected = meleeData.attacker.selectedIndices || [];
    const defenderSelected = meleeData.defender.selectedIndices || [];

    if (attackerSelected.length === 0 || defenderSelected.length === 0) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.MeleeNeedsDefense"));
        game.neuroshima.groupEnd();
        return;
    }

    if (attackerSelected.length !== defenderSelected.length) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.MeleeMatchDiceCount"));
        game.neuroshima.groupEnd();
        return;
    }

    const updatedMelee = foundry.utils.deepClone(meleeData);
    const attackerDiceValues = attackerSelected.map(i => updatedMelee.attacker.dice[i]);
    const defenderDiceValues = defenderSelected.map(i => updatedMelee.defender.dice[i]);

    const opponentCount = 1 + (updatedMelee.multiOpponents?.length || 0);
    const effectiveDefenderTarget = updatedMelee.defender.targetValue - opponentCount;
    const effectiveAttackerTarget = updatedMelee.attacker.targetValue;

    game.neuroshima.log("Parametry rozstrzygania:", {
        attackerDice: attackerDiceValues,
        defenderDice: defenderDiceValues,
        attackerTarget: effectiveAttackerTarget,
        defenderTarget: effectiveDefenderTarget,
        opponentPenalty: opponentCount
    });

    const attackerSuccesses = attackerDiceValues.filter(v => v <= effectiveAttackerTarget).length;
    const defenderSuccesses = defenderDiceValues.filter(v => v <= effectiveDefenderTarget).length;

    game.neuroshima.log("Wyniki sukcesów:", { attackerSuccesses, defenderSuccesses });

    let result = "remis";
    let messageKey = "";

    if (attackerSuccesses === attackerSelected.length && defenderSuccesses === defenderSelected.length) {
        result = "remis";
        messageKey = "NEUROSHIMA.MeleeDuel.ResultRemis";
    } else if (attackerSuccesses === attackerSelected.length && defenderSuccesses < defenderSelected.length) {
        result = "hit";
        messageKey = "NEUROSHIMA.MeleeDuel.ResultHit";
        
        const attacker = game.actors.get(updatedMelee.attacker.id);
        const defender = game.actors.get(updatedMelee.defender.id);
        if (attacker && defender) {
            const attackData = {
                actorId: attacker.id,
                label: attacker.name,
                isMelee: true,
                successPoints: attackerSuccesses,
                damage: "L",
                finalLocation: this._determineLocation(attackerDiceValues)
            };
            game.neuroshima.log("Trafienie! Aplikowanie obrażeń:", attackData);
            await game.neuroshima.CombatHelper.applyDamageToActor(defender, attackData, { isOpposed: true });
        }
    } else if (attackerSuccesses < attackerSelected.length && defenderSuccesses === defenderSelected.length) {
        result = "takeover";
        messageKey = "NEUROSHIMA.MeleeDuel.ResultTakeover";
        game.neuroshima.log("Przejęcie inicjatywy!");
    } else {
        result = "miss";
        messageKey = "NEUROSHIMA.MeleeDuel.ResultMiss";
    }

    game.neuroshima.log(`Wynik segmentu: ${result}`);

    // Aktualizacja stanu
    updatedMelee.attacker.usedDiceIndices = [...updatedMelee.attacker.usedDiceIndices, ...attackerSelected];
    updatedMelee.defender.usedDiceIndices = [...updatedMelee.defender.usedDiceIndices, ...defenderSelected];
    updatedMelee.attacker.selectedIndices = [];
    updatedMelee.defender.selectedIndices = [];
    updatedMelee.currentSegment += attackerSelected.length;

    if (result === "takeover") {
        const oldAttacker = foundry.utils.deepClone(updatedMelee.attacker);
        const oldDefender = foundry.utils.deepClone(updatedMelee.defender);
        updatedMelee.attacker = oldDefender;
        updatedMelee.defender = oldAttacker;
    }

    if (updatedMelee.currentSegment > 3) {
        updatedMelee.phase = "resolve";
        updatedMelee.active = false; // Oznaczamy jako nieaktywny
        game.neuroshima.log("Tura zakończona (zużyto wszystkie segmenty)");
        await this.clearMeleeFlags(duelId);
    }

    await combat.setFlag("neuroshima", `meleeDuels.${duelId}`, updatedMelee);
    
    const message = game.i18n.localize(messageKey);
    await ChatMessage.create({
        content: `<h3>Segment ${meleeData.currentSegment}: ${message}</h3>`,
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
    const content = await renderTemplate("systems/neuroshima/templates/chat/melee-pool-card.hbs", {
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
