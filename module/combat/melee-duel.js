import { NeuroshimaMeleeDuelResolver } from "./melee-duel-resolver.js";
import { NEUROSHIMA } from "../config.js";

/**
 * Klasa zarządzająca stanem i logiką starcia w zwarciu (Opposed Melee).
 * Centralizuje wszystkie operacje na starciu, zapewniając spójność danych.
 */
export class NeuroshimaMeleeDuel {
  /**
   * @param {ChatMessage} message - Wiadomość ChatMessage pełniąca rolę handlera starcia.
   */
  constructor(message) {
    this.message = message;
    if (!message.getFlag("neuroshima", "meleeDuel")) {
      // Inicjalizacja domyślnego stanu jeśli nie istnieje (powinno się dziać przy create)
      console.warn("Neuroshima 1.5 | NeuroshimaMeleeDuel: Brak flagi meleeDuel w wiadomości!");
    }
  }

  /**
   * Pobiera aktualny stan starcia z flag wiadomości.
   */
  get state() {
    const state = this.message.getFlag("neuroshima", "meleeDuel");
    if (!state) {
        game.neuroshima?.warn("Brak flagi meleeDuel w wiadomości", this.message.id);
        return {};
    }
    return state;
  }

  /**
   * Fabryka: Tworzy nową instancję starcia na podstawie rzutu atakującego.
   */
  static async createFromAttack(attackerActor, attackRollData, weaponId, targets = []) {
    const dice = attackRollData.rawResults.map(r => ({
      original: r.value,
      modified: r.value,
      nat20: r.isNat20
    }));

    // Pobranie danych o celach do wyświetlenia na karcie
    const targetsInfo = [];
    for (const uuid of targets) {
        const doc = await fromUuid(uuid);
        const a = doc?.actor || doc;
        if (a) {
            targetsInfo.push({ 
                uuid, 
                id: a.id,
                name: a.name, 
                img: a.img || "icons/svg/mystery-man.svg" 
            });
        }
    }

    // Pobierz aktora aby sprawdzić uprawnienia
    const attackerActorDoc = await fromUuid(attackerActor.uuid);
    const attacker = attackerActorDoc?.actor || attackerActorDoc;

    // Automatyczny rzut na inicjatywę dla atakującego
    const { NeuroshimaDice } = await import("../helpers/dice.js");
    let attackerDex = 10;
    if (attacker.system.attributes?.dexterity !== undefined) {
        const val = attacker.system.attributes.dexterity;
        attackerDex = typeof val === 'object' ? (Number(val.value) || 10) : (Number(val) || 10);
    }
    
    const initRollAttacker = await NeuroshimaDice.rollTest({
        stat: attackerDex,
        isOpen: true,
        label: game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeTest"),
        actor: attacker,
        chatMessage: false,
        isInitiative: true
    });
    const initTooltipAttacker = NeuroshimaDice._buildOpenTestTooltip(initRollAttacker, "NEUROSHIMA.MeleeOpposed.InitiativeTest");

    const state = {
      requestId: foundry.utils.randomID(),
      status: "waiting-defender",
      phase: "initiative", // initiative -> modification -> segments -> resolved
      turn: 1,
      currentSegment: 1,
      initiative: null, // 'attacker' or 'defender'
      attacker: {
        actorUuid: attackerActor.uuid,
        tokenUuid: attackerActor.token?.uuid || null,
        name: attackerActor.name,
        img: attackerActor.img || "icons/svg/mystery-man.svg",
        stat: attackRollData.stat || 10,
        skillPoints: attackRollData.skill || 0,
        modSelf: [0, 0, 0],
        modOpponent: [0, 0, 0],
        ready: false,
        diceSpent: [false, false, false],
        initiativeRoll: initRollAttacker.totalSuccesses || initRollAttacker.successCount || 0,
        initiativeTooltip: initTooltipAttacker
      },
      defender: { 
        actorUuid: null, 
        tokenUuid: null, 
        name: "Oczekiwanie...", 
        img: "",
        stat: 10,
        skillPoints: 0,
        modSelf: [0, 0, 0],
        modOpponent: [0, 0, 0],
        ready: false,
        diceSpent: [false, false, false],
        initiativeRoll: null
      },
      attack: { 
        weaponId, 
        rollData: attackRollData 
      },
      defense: { weaponId: null, rollData: null },
      dice: {
        attacker: (attackRollData.rawResults || []).map(r => typeof r === 'object' ? r.value : r),
        defender: []
      },
      segments: [
        { attackerAction: null, defenderAction: null, result: null },
        { attackerAction: null, defenderAction: null, result: null },
        { attackerAction: null, defenderAction: null, result: null }
      ],
      attackerTargets: targetsInfo,
      version: 1,
      result: null
    };

    const template = "systems/neuroshima/templates/chat/melee-opposed-handler.hbs";
    const context = {
      ...state,
      config: NEUROSHIMA,
      status: state.status,
      attacker: state.attacker,
      defender: state.defender,
      attackerDice: (state.dice.attacker || []).map((v, i) => ({
        original: v,
        modified: v,
        modSelf: 0,
        modOpponent: 0,
        isNat1: v === 1,
        isNat20: v === 20,
        isSuccess: v <= state.attacker.stat
      })),
      defenderDice: [],
      attackerSkillTotal: state.attacker.skillPoints,
      attackerSkillRemaining: state.attacker.skillPoints,
      defenderSkillTotal: 0,
      defenderSkillRemaining: 0,
      attackerTargets: state.attackerTargets,
      isAttacker: game.user.isGM || attackerActorDoc?.isOwner || false,
      isDefender: false,
      isReady: { attacker: false, defender: false },
      showTooltip: true
    };

    const content = await foundry.applications.handlebars.renderTemplate(template, context);

    const chatData = {
      user: game.user.id,
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "meleeOpposedHandler",
          meleeDuel: state,
          attackerUuid: state.attacker.actorUuid,
          attackerTargets: targets // Zachowujemy UUIDs dla sprawdzania uprawnień
        }
      }
    };

    return ChatMessage.create(chatData);
  }

  /**
   * Pobiera instancję duelu z istniejącej wiadomości.
   */
  static fromMessage(message) {
    if (!message) return null;
    const type = message.getFlag("neuroshima", "messageType");
    if (type !== "meleeOpposedHandler" && !message.getFlag("neuroshima", "meleeDuel")) {
        return null;
    }
    return new NeuroshimaMeleeDuel(message);
  }

  /**
   * Dołącza obrońcę do starcia.
   */
  async joinDefender(defenderActor, defenseRollData, weaponId) {
    const state = foundry.utils.deepClone(this.state);
    if (state.status !== "waiting-defender") return;

    // Automatyczny rzut na inicjatywę dla obrońcy
    const { NeuroshimaDice } = await import("../helpers/dice.js");
    let defenderDex = 10;
    if (defenderActor.system.attributes?.dexterity !== undefined) {
        const val = defenderActor.system.attributes.dexterity;
        defenderDex = typeof val === 'object' ? (Number(val.value) || 10) : (Number(val) || 10);
    }
    
    const initRollDefender = await NeuroshimaDice.rollTest({
        stat: defenderDex,
        isOpen: true,
        label: game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeTest"),
        actor: defenderActor,
        chatMessage: false,
        isInitiative: true
    });
    let initTooltipDefender = NeuroshimaDice._buildOpenTestTooltip(initRollDefender, "NEUROSHIMA.MeleeOpposed.InitiativeTest");
    let initTooltipAttacker = state.attacker.initiativeTooltip;

    const dice = defenseRollData.rawResults.map(r => ({
      original: r.value,
      modified: r.value,
      nat20: r.isNat20
    }));

    // Pobierz dane atakującego ze stanu
    const attackerActorDoc = await fromUuid(state.attacker.actorUuid);
    const attacker = attackerActorDoc?.actor || attackerActorDoc;
    let attackerDex = 10;
    if (attacker?.system?.attributes?.dexterity !== undefined) {
        const val = attacker.system.attributes.dexterity;
        attackerDex = typeof val === 'object' ? (Number(val.value) || 10) : (Number(val) || 10);
    }

    // Rozstrzygnięcie inicjatywy (automatyczny reroll przy remisie)
    let aInit = state.attacker.initiativeRoll || 0;
    let dInit = initRollDefender.totalSuccesses || initRollDefender.successCount || 0;

    while (aInit === dInit) {
        const rerollA = await NeuroshimaDice.rollTest({
            stat: attackerDex,
            isOpen: true,
            label: game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeTest") + " (Reroll)",
            actor: attacker,
            chatMessage: false,
            isInitiative: true
        });
        const rerollD = await NeuroshimaDice.rollTest({
            stat: defenderDex,
            isOpen: true,
            label: game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeTest") + " (Reroll)",
            actor: defenderActor,
            chatMessage: false,
            isInitiative: true
        });
        initTooltipAttacker = NeuroshimaDice._buildOpenTestTooltip(rerollA, "NEUROSHIMA.MeleeOpposed.InitiativeTest");
        initTooltipDefender = NeuroshimaDice._buildOpenTestTooltip(rerollD, "NEUROSHIMA.MeleeOpposed.InitiativeTest");
        aInit = rerollA.totalSuccesses || rerollA.successCount || 0;
        dInit = rerollD.totalSuccesses || rerollD.successCount || 0;
    }

    state.attacker.initiativeRoll = aInit;
    state.attacker.initiativeTooltip = initTooltipAttacker;
    state.defender = {
      actorUuid: defenderActor.uuid,
      tokenUuid: defenderActor.token?.uuid || null,
      name: defenderActor.name,
      img: defenderActor.img,
      stat: defenseRollData.stat || 10,
      skillPoints: defenseRollData.skill || 0,
      modSelf: [0, 0, 0],
      modOpponent: [0, 0, 0],
      ready: false,
      diceSpent: [false, false, false],
      initiativeRoll: dInit,
      initiativeTooltip: initTooltipDefender
    };

    state.defense = {
      weaponId,
      rollData: defenseRollData
    };

    // Zapisanie kości obrońcy
    state.dice.defender = (defenseRollData.rawResults || []).map(r => typeof r === 'object' ? r.value : r);

    state.initiative = aInit > dInit ? "attacker" : "defender";
    state.phase = "modification";
    state.status = "active";

    state.version += 1;
    await this.update(state);
  }

  /**
   * Wykonuje rzut na Inicjatywę zwarcia (Zręczność otwarta).
   * @param {string} role - 'attacker' lub 'defender'
   */
  async rollInitiative(role) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("rollMeleeInitiative", {
            messageId: this.message.id,
            role: role
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (state.phase !== "initiative") return;

    const side = state[role];
    const actorDoc = await fromUuid(side.actorUuid);
    // W v13 actorDoc może być TokenDocument lub Actor
    const actor = actorDoc?.actor || actorDoc;
    
    if (!actor || !actor.system) {
        game.neuroshima?.error("Nie znaleziono aktora dla rzutu inicjatywy:", side.actorUuid);
        return;
    }

    // Rzut na Zręczność (otwarty)
    const { NeuroshimaDice } = await import("../helpers/dice.js");
    
    // Pobieranie wartości atrybutu - obsługa różnych formatów dla pewności
    let dex = 10;
    if (actor.system.attributes?.dexterity !== undefined) {
        const val = actor.system.attributes.dexterity;
        dex = typeof val === 'object' ? (Number(val.value) || 10) : (Number(val) || 10);
    }
    
    game.neuroshima?.log("Inicjatywa: Pobrano Zręczność", {
        actor: actor.name,
        dex: dex,
        rawDex: actor.system.attributes?.dexterity
    });

    const rollResult = await NeuroshimaDice.rollTest({
        stat: dex,
        isOpen: true,
        label: game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeTest"),
        actor: actor
    });

    side.initiativeRoll = rollResult.totalSuccesses || rollResult.successCount || 0;
    
    // Jeśli obaj rzucili, rozstrzygnij
    if (state.attacker.initiativeRoll !== null && state.defender.initiativeRoll !== null) {
        if (state.attacker.initiativeRoll > state.defender.initiativeRoll) {
            state.initiative = "attacker";
            state.phase = "modification";
        } else if (state.defender.initiativeRoll > state.attacker.initiativeRoll) {
            state.initiative = "defender";
            state.phase = "modification";
        } else {
            // Remis - reset rzutów i powtórka
            state.attacker.initiativeRoll = null;
            state.defender.initiativeRoll = null;
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeDraw"));
        }
    }

    state.version += 1;
    await this.update(state);
  }

  /**
   * Modyfikuje wynik kości (wersja bezkonfliktowa).
   * @param {string} actorRole - Rola aktora wykonującego modyfikację ('attacker' lub 'defender')
   * @param {string} targetRole - Rola aktora, którego kość jest modyfikowana ('attacker' lub 'defender')
   * @param {number} dieIndex - Indeks kości (0-2)
   * @param {number} delta - Zmiana (+1 lub -1)
   */
  async modifyDie(actorRole, targetRole, dieIndex, delta) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("modifyMeleeDie", {
            messageId: this.message.id,
            side: actorRole,
            target: targetRole,
            index: dieIndex,
            delta: delta
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (state.status !== "active") return;
    
    const idx = parseInt(dieIndex);
    const d = parseInt(delta);
    
    const side = state[actorRole];
    if (!side) return;

    // Oblicz aktualne wydatki punktów
    const currentSpent = side.modSelf.reduce((a, b) => a + b, 0) + side.modOpponent.reduce((a, b) => a + b, 0);
    
    if (d > 0 && currentSpent >= side.skillPoints) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoSkillPoints"));
        return;
    }

    if (actorRole === targetRole) {
        // Modyfikacja własnej kości (tylko obniżanie)
        const currentMod = side.modSelf[idx];
        const newMod = Math.max(0, currentMod + d);
        
        // Nie można obniżyć kości poniżej 1
        const originalVal = state.dice[actorRole][idx];
        if (originalVal - newMod < 1 && d > 0) return;
        
        side.modSelf[idx] = newMod;
    } else {
        // Modyfikacja kości przeciwnika (tylko podwyższanie)
        const currentMod = side.modOpponent[idx];
        const newMod = Math.max(0, currentMod + d);
        
        // Nie można podwyższyć kości powyżej 20
        const originalVal = state.dice[targetRole][idx];
        const opponentModSelf = state[targetRole].modSelf[idx];
        if (originalVal - opponentModSelf + newMod > 20 && d > 0) return;
        
        side.modOpponent[idx] = newMod;
    }

    state.version += 1;
    await this.update(state);
  }

  /**
   * Resetuje wszystkie wydane punkty umiejętności dla danej roli.
   * @param {string} role - 'attacker' lub 'defender'
   */
  async resetPool(role) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("resetMeleePool", {
            messageId: this.message.id,
            role: role
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (state.status !== "active") return;
    
    const side = state[role];
    if (!side) return;

    // Resetuj tablice modyfikatorów
    side.modSelf = [0, 0, 0];
    side.modOpponent = [0, 0, 0];
    
    // Po resetowaniu punktów usuń status gotowości
    side.ready = false;

    state.version += 1;
    await this.update(state);
  }

  /**
   * Przełącza status gotowości strony.
   */
  async toggleReady(role) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("toggleMeleeReady", {
            messageId: this.message.id,
            role: role
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (state.status !== "active") return;
    
    if (state[role]) {
        state[role].ready = !state[role].ready;
        state.version += 1;
        
        // Jeśli obaj gotowi w fazie modyfikacji, przejdź do segmentów
        if (state.phase === "modification" && state.attacker.ready && state.defender.ready) {
            state.phase = "segments";
            state.currentSegment = 1;
            state.attacker.ready = false;
            state.defender.ready = false;
        }
        
        await this.update(state);
    }
  }

  /**
   * Zaznacza/odznacza kość do akcji w segmencie.
   */
  async selectDie(role, index) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("selectMeleeDie", {
            messageId: this.message.id,
            role,
            index
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (state.phase !== "segments") return;

    // Kto może teraz wybierać kości?
    let allowedRole = state.initiative; // Domyślnie aktywny (atakujący w danym segmencie)
    if (state.currentAction) {
        // Jeśli jest zadeklarowana akcja, to responder (obrońca) wybiera kości
        allowedRole = state.currentAction.side === "attacker" ? "defender" : "attacker";
    }

    if (role !== allowedRole) return;

    const side = state[role];
    if (!side.selectedDice) side.selectedDice = [];

    if (side.diceSpent[index]) return;

    const idx = side.selectedDice.indexOf(index);
    if (idx > -1) {
        side.selectedDice.splice(idx, 1);
    } else {
        // Max 3 kości
        if (side.selectedDice.length < 3) {
            side.selectedDice.push(index);
        }
    }

    state.version += 1;
    await this.update(state);
  }

  /**
   * Deklaruje akcję w segmencie (Atak lub Pas).
   */
  async declareAction(role, type) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("declareMeleeAction", {
            messageId: this.message.id,
            role,
            type
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (state.phase !== "segments" || state.currentAction) return;
    if (state.initiative !== role) return;

    const side = state[role];
    
    if (type === "attack") {
        const selected = side.selectedDice || [];
        if (selected.length === 0) return;

        // Oblicz siłę (liczba sukcesów wśród zaznaczonych)
        const dice = state.dice[role];
        const modsSelf = side.modSelf || [0, 0, 0];
        const otherRole = role === "attacker" ? "defender" : "attacker";
        const opponentModsOpponent = state[otherRole].modOpponent || [0, 0, 0];
        const stat = side.stat;

        let totalSuccesses = 0;
        for (const i of selected) {
            const val = dice[i] - modsSelf[i] + opponentModsOpponent[i];
            if (val <= stat) totalSuccesses++;
        }

        // Atak musi mieć przynajmniej jeden sukces, aby był atakiem (nawet jeśli wybieramy porażki do kompletu)
        if (totalSuccesses === 0) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposed.ErrorNoSuccessesInAction"));
            return;
        }

        state.currentAction = {
            side: role,
            sideName: side.name,
            type: totalSuccesses === 1 ? "single" : "compound",
            power: totalSuccesses,
            diceIndices: [...selected]
        };
        
        // Wyczyść zaznaczenie
        side.selectedDice = [];
    } else if (type === "pass") {
        // Pasowanie segmentu - zużywa jedną kość (najsłabszą/porażkę jeśli jest?)
        // Wg zasad po prostu przechodzimy dalej, oznaczając jedną kość jako wydaną jeśli trzeba
        // ale zwykle pas to po prostu brak akcji w tym segmencie.
        // Implementacja: oznacz pierwszą wolną kość jako wydaną.
        const firstFree = side.diceSpent.indexOf(false);
        if (firstFree > -1) side.diceSpent[firstFree] = true;
        
        await this._advanceSegment(state);
    }

    state.version += 1;
    await this.update(state);
  }

  /**
   * Reaguje na akcję przeciwnika (Obrona lub Przyjęcie Obrażeń).
   */
  async respondToAction(response) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("respondMeleeAction", {
            messageId: this.message.id,
            response
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (state.phase !== "segments" || !state.currentAction) return;

    const action = state.currentAction;
    const responderRole = action.side === "attacker" ? "defender" : "attacker";
    const responder = state[responderRole];

    if (response === "defend") {
        const selected = responder.selectedDice || [];
        if (selected.length === 0) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposed.ErrorNoDiceSelected"));
            return;
        }

        // Oblicz siłę obrony
        const dice = state.dice[responderRole];
        const modsSelf = responder.modSelf || [0, 0, 0];
        const opponentRole = action.side;
        const opponentModsOpponent = state[opponentRole].modOpponent || [0, 0, 0];
        const stat = responder.stat;

        let totalDefenseSuccesses = 0;
        for (const i of selected) {
            const val = dice[i] - modsSelf[i] + opponentModsOpponent[i];
            if (val <= stat) totalDefenseSuccesses++;
        }

        if (totalDefenseSuccesses < action.power) {
            // OBRONA NIESKUTECZNA - kości zużyte, obrażenia wchodzą
            for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
            for (const i of selected) responder.diceSpent[i] = true;

            const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
            const dmg = NeuroshimaMeleeDuelResolver.calculateSegmentDamage(state, action);
            if (dmg) {
                if (!state.segments) state.segments = [{}, {}, {}];
                state.segments[state.currentSegment - 1].result = dmg;
            }
            ui.notifications.warn(game.i18n.format("NEUROSHIMA.MeleeOpposed.DefenseFailed", { need: action.power, have: totalDefenseSuccesses }));
        } else {
            // OBRONA UDANA - kości zużyte, brak obrażeń
            for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
            for (const i of selected) responder.diceSpent[i] = true;
            
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.DefenseSuccess"));
        }
    } else {
        // Przyjęcie obrażeń - zużyj kości atakującego
        for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
        
        // TODO: Aplikacja obrażeń dla segmentu (jeśli to był atak)
        if (action.side === "attacker") {
            const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
            const dmg = NeuroshimaMeleeDuelResolver.calculateSegmentDamage(state, action);
            if (dmg) {
                // Dodaj do raportu tury
                if (!state.segments) state.segments = [{}, {}, {}];
                state.segments[state.currentSegment - 1].result = dmg;
            }
        }
    }

    // Wyczyść akcję i zaznaczenia
    state.currentAction = null;
    responder.selectedDice = [];
    
    await this._advanceSegment(state);
    state.version += 1;
    await this.update(state);
  }

  /**
   * Przejmuje inicjatywę.
   */
  async takeoverInitiative() {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("takeoverMeleeInitiative", {
            messageId: this.message.id
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (state.phase !== "segments" || state.currentAction) return;

    state.initiative = state.initiative === "attacker" ? "defender" : "attacker";
    ui.notifications.info(game.i18n.format("NEUROSHIMA.MeleeOpposed.InitiativeTakenBy", { name: state[state.initiative].name }));

    state.version += 1;
    await this.update(state);
  }

  /**
   * Przesuwa starcie do następnego segmentu lub kończy turę.
   * @private
   */
  async _advanceSegment(state) {
    state.currentSegment += 1;
    
    // Sprawdź czy koniec tury (3 segmenty lub brak kości)
    const attackerDone = state.attacker.diceSpent.every(s => s);
    const defenderDone = state.defender.diceSpent.every(s => s);

    if (state.currentSegment > 3 || (attackerDone && defenderDone)) {
        state.status = "resolved";
        state.phase = "resolved";
        // Finalne rozstrzygnięcie tury
        const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
        state.result = NeuroshimaMeleeDuelResolver.resolve(state);
    }
  }

  /**
   * Rozstrzyga starcie.
   */
  async resolve() {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("resolveMeleeDuel", {
            messageId: this.message.id
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (state.status !== "active") return;

    const result = NeuroshimaMeleeDuelResolver.resolve(state);
    state.result = result;
    state.status = "resolved";
    state.version += 1;

    await this.update(state);
  }

  /**
   * Aktualizuje stan wiadomości i re-renderuje jej zawartość.
   */
  async update(newState) {
    // Re-render template
    const template = "systems/neuroshima/templates/chat/melee-opposed-handler.hbs";
    
    // Pobierz dokumenty aktorów aby sprawdzić uprawnienia
    const attackerActor = await fromUuid(newState.attacker.actorUuid);
    const defenderActor = newState.defender.actorUuid ? await fromUuid(newState.defender.actorUuid) : null;

    // Obliczanie finalnych wyników kości dla widoku
    const prepareDice = (side, dice, stat, modsSelf, modsOpponent, spentIndices = []) => {
        return dice.map((v, i) => {
            const modified = v - modsSelf[i] + modsOpponent[i];
            return {
                original: v,
                modified: modified,
                modSelf: modsSelf[i],
                modOpponent: modsOpponent[i],
                isNat1: v === 1,
                isNat20: v === 20,
                isSuccess: modified <= stat,
                spent: newState[side].diceSpent[i],
                selected: newState[side].selectedDice?.includes(i) || false
            };
        });
    };

    const attackerDice = prepareDice("attacker", newState.dice.attacker, newState.attacker.stat, newState.attacker.modSelf, newState.defender.modOpponent);
    const defenderDice = prepareDice("defender", newState.dice.defender, newState.defender.stat, newState.defender.modSelf, newState.attacker.modOpponent);

    // Sprawdzanie czy można przejąć inicjatywę
    const canTakeoverInitiative = () => {
        if (newState.phase !== "segments" || newState.currentAction) return false;
        const currentActive = newState.initiative;
        const currentPassive = currentActive === "attacker" ? "defender" : "attacker";
        
        // Musi być właściciel strony pasywnej
        const passiveActor = currentPassive === "attacker" ? attackerActor : defenderActor;
        if (!game.user.isGM && !passiveActor?.isOwner) return false;

        // Warunek: Aktywny musiałby użyć porażki, a Pasywny ma sukces
        const activeDice = currentActive === "attacker" ? attackerDice : defenderDice;
        const passiveDice = currentActive === "attacker" ? defenderDice : attackerDice;

        const activeHasSuccess = activeDice.some(d => !d.spent && d.isSuccess);
        const passiveHasSuccess = passiveDice.some(d => !d.spent && d.isSuccess);

        return !activeHasSuccess && passiveHasSuccess;
    };

    const context = {
        ...newState,
        config: NEUROSHIMA,
        attacker: newState.attacker,
        defender: newState.defender,
        attackerDice,
        defenderDice,
        attackerSkillTotal: newState.attacker.skillPoints,
        attackerSkillRemaining: newState.attacker.skillPoints - (newState.attacker.modSelf.reduce((a,b)=>a+b,0) + newState.attacker.modOpponent.reduce((a,b)=>a+b,0)),
        defenderSkillTotal: newState.defender.skillPoints,
        defenderSkillRemaining: newState.defender.skillPoints - (newState.defender.modSelf.reduce((a,b)=>a+b,0) + newState.defender.modOpponent.reduce((a,b)=>a+b,0)),
        attackerTargetNumber: newState.attacker.stat,
        defenderTargetNumber: newState.defender.stat,
        isResolved: newState.status === "resolved",
        isReady: {
            attacker: newState.attacker.ready,
            defender: newState.defender.ready
        },
        resultMsg: newState.result?.winner === "attacker" 
            ? game.i18n.localize("NEUROSHIMA.MeleeOpposed.AttackerWins") 
            : (newState.result?.winner === "defender" ? game.i18n.localize("NEUROSHIMA.MeleeOpposed.DefenderWins") : ""),
        damageResult: newState.result?.damageResult,
        attackerSuccesses: newState.result?.attackerScore,
        defenderSuccesses: newState.result?.defenderScore,
        isAttacker: game.user.isGM || attackerActor?.isOwner || false,
        isDefender: game.user.isGM || defenderActor?.isOwner || false,
        isCurrentActive: newState.currentAction 
            ? false 
            : (newState.initiative === "attacker" ? (game.user.isGM || attackerActor?.isOwner) : (game.user.isGM || defenderActor?.isOwner)),
        isCurrentResponder: newState.currentAction
            ? (newState.currentAction.side === "attacker" ? (game.user.isGM || defenderActor?.isOwner) : (game.user.isGM || attackerActor?.isOwner))
            : false,
        canDeclareAttack: (newState.initiative === "attacker" ? attackerDice : defenderDice).some(d => !d.spent && d.isSuccess),
        canTakeoverInitiative: canTakeoverInitiative(),
        canSelectDice: {
            attacker: newState.currentAction 
                ? (newState.currentAction.side === "defender")
                : (newState.initiative === "attacker"),
            defender: newState.currentAction
                ? (newState.currentAction.side === "attacker")
                : (newState.initiative === "defender")
        },
        showTooltip: true
    };

    console.log("Neuroshima 1.5 | Duel Update Context:", context);

    const content = await foundry.applications.handlebars.renderTemplate(template, context);
    
    await this.message.update({
        content,
        "flags.neuroshima.meleeDuel": newState,
        "flags.neuroshima.status": newState.status,
        "flags.neuroshima.phase": newState.phase
    });
  }
}
