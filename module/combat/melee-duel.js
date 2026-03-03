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
   * Automatycznie optymalizuje rzuty kośćmi używając punktów umiejętności.
   * Wybiera kości najbliższe progu sukcesu i obniża je tak, aby stały się sukcesami.
   */
  static _autoOptimizeDice(dice, target, skillPoints) {
    let mods = [0, 0, 0];
    let remaining = skillPoints;
    
    // Tylko kości, które NIE są sukcesami i NIE są naturalnymi 20
    let candidates = dice.map((v, i) => ({ value: v, index: i }))
                        .filter(c => c.value > target && c.value !== 20)
                        .sort((a, b) => (a.value - target) - (b.value - target)); 
    
    for (const c of candidates) {
        const needed = c.value - target;
        if (needed <= remaining) {
            mods[c.index] = needed;
            remaining -= needed;
        }
    }
    return mods;
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

    let modSelf = [0, 0, 0];
    const attackerDiceRaw = (attackRollData.rawResults || []).map(r => typeof r === 'object' ? r.value : r);
    const attackerStat = attackRollData.target || 10;
    const attackerSkill = attackRollData.skill || 0;

    if (!game.settings.get("neuroshima", "doubleSkillAction")) {
        modSelf = this._autoOptimizeDice(attackerDiceRaw, attackerStat, attackerSkill);
    }

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
        stat: attackerStat,
        skillPoints: attackerSkill,
        modSelf: modSelf,
        modOpponent: [0, 0, 0],
        ready: false,
        diceSpent: [false, false, false],
        initiativeRoll: null,
        initiativeTooltip: "",
        rollTooltip: attackRollData.tooltip || ""
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
        attacker: attackerDiceRaw,
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
      doubleSkillAction: game.settings.get("neuroshima", "doubleSkillAction"),
      status: state.status,
      attacker: state.attacker,
      defender: state.defender,
      attackerDice: (state.dice.attacker || []).map((v, i) => {
        const modified = v - state.attacker.modSelf[i];
        return {
          original: v,
          modified: modified,
          modSelf: state.attacker.modSelf[i],
          modOpponent: 0,
          isNat1: v === 1,
          isNat20: v === 20,
          isSuccess: modified <= state.attacker.stat
        };
      }),
      defenderDice: [],
      attackerSkillTotal: state.attacker.skillPoints,
      attackerSkillRemaining: state.attacker.skillPoints - state.attacker.modSelf.reduce((a,b)=>a+b,0),
      defenderSkillTotal: 0,
      defenderSkillRemaining: 0,
      attackerTargets: state.attackerTargets,
      attackerTargetNumber: state.attacker.stat,
      defenderTargetNumber: state.defender.stat,
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

    const defenderDiceRaw = (defenseRollData.rawResults || []).map(r => typeof r === 'object' ? r.value : r);
    const defenderStat = defenseRollData.target || 10;
    const defenderSkill = defenseRollData.skill || 0;
    let modSelf = [0, 0, 0];

    if (!game.settings.get("neuroshima", "doubleSkillAction")) {
        modSelf = NeuroshimaMeleeDuel._autoOptimizeDice(defenderDiceRaw, defenderStat, defenderSkill);
    }

    state.defender = {
      actorUuid: defenderActor.uuid,
      tokenUuid: defenderActor.token?.uuid || null,
      name: defenderActor.name,
      img: defenderActor.img,
      stat: defenderStat,
      skillPoints: defenderSkill,
      modSelf: modSelf,
      modOpponent: [0, 0, 0],
      ready: false,
      diceSpent: [false, false, false],
      initiativeRoll: null,
      initiativeTooltip: "",
      rollTooltip: defenseRollData.tooltip || ""
    };

    state.defense = {
      weaponId,
      rollData: defenseRollData
    };

    // Zapisanie kości obrońcy
    state.dice.defender = defenderDiceRaw;

    state.initiative = null;
    state.phase = "initiative";
    state.status = "active";

    state.version += 1;
    await this.update(state);
  }

  /**
   * Inicjuje proces rzutu na inicjatywę dla danej roli.
   * Otwiera dialog dla właściciela aktora.
   * @param {string} role - 'attacker' lub 'defender'
   */
  async rollInitiative(role) {
    const state = this.state;
    const side = state[role];
    const actorDoc = await fromUuid(side.actorUuid);
    const actor = actorDoc?.actor || actorDoc;

    if (!actor || (!actor.isOwner && !game.user.isGM)) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NotYourActor"));
        return;
    }

    const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
    
    // Sugerowanie umiejętności na podstawie użytej broni
    let suggestedSkill = "";
    if (role === "attacker") {
        suggestedSkill = state.attack.rollData?.weapon?.system?.skill || "";
    } else if (role === "defender") {
        suggestedSkill = state.defense.rollData?.weapon?.system?.skill || "";
    }

    const dialog = new NeuroshimaInitiativeRollDialog({
        actor: actor,
        skill: suggestedSkill,
        isMeleeInitiative: true,
        onRoll: async (rollData) => {
            const rollResult = await game.neuroshima.NeuroshimaDice.rollInitiative({
                ...rollData,
                actor: actor,
                chatMessage: false
            });
            
            // Wyślij wynik do MG aby zaktualizował wiadomość duelu
            if (game.user.isGM) {
                await this.updateInitiative(role, {
                    successPoints: rollResult.successPoints,
                    tooltip: rollResult.tooltip || ""
                });
            } else {
                await game.neuroshima.socket.executeAsGM("updateMeleeInitiative", {
                    messageId: this.message.id,
                    role: role,
                    rollResult: {
                        successPoints: rollResult.successPoints,
                        tooltip: rollResult.tooltip || ""
                    }
                });
            }
            return rollResult;
        }
    });
    dialog.render(true);
  }

  /**
   * Aktualizuje wynik inicjatywy w stanie starcia (wywoływane przez GM).
   */
  async updateInitiative(role, rollResult) {
    if (!game.user.isGM) return;

    const state = foundry.utils.deepClone(this.state);
    const side = state[role];
    
    side.initiativeRoll = rollResult.successPoints;
    side.initiativeTooltip = rollResult.tooltip;

    // Jeśli obie strony rzuciły, rozstrzygnij inicjatywę
    if (state.attacker.initiativeRoll !== null && state.defender.initiativeRoll !== null) {
        if (state.attacker.initiativeRoll > state.defender.initiativeRoll) {
            state.initiative = "attacker";
            state.phase = "modification";
        } else if (state.defender.initiativeRoll > state.attacker.initiativeRoll) {
            state.initiative = "defender";
            state.phase = "modification";
        } else {
            // Remis - reset rzutów i powiadomienie
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

    const targetDieValue = state.dice[targetRole][idx];
    if (targetDieValue === 20) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.Natural20CannotBeModified"));
        return;
    }

    if (actorRole === targetRole) {
        // Modyfikacja własnej kości (tylko obniżanie)
        const currentMod = side.modSelf[idx];
        const newMod = Math.max(0, currentMod + d);
        
        // Nie można obniżyć kości poniżej 1
        if (targetDieValue - newMod < 1 && d > 0) return;
        
        side.modSelf[idx] = newMod;
    } else {
        // Modyfikacja kości przeciwnika (tylko podwyższanie)
        const currentMod = side.modOpponent[idx];
        const newMod = Math.max(0, currentMod + d);
        
        // Nie można podwyższyć kości powyżej 20
        const opponentModSelf = state[targetRole].modSelf[idx];
        if (targetDieValue - opponentModSelf + newMod > 20 && d > 0) return;
        
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
    const selected = side.selectedDice || [];
    
    if (type === "attack") {
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

        state.currentAction = {
            side: role,
            sideName: side.name,
            type: totalSuccesses === 0 ? "failure" : (totalSuccesses === 1 ? "single" : "compound"),
            power: totalSuccesses,
            diceCount: selected.length,
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
        const requiredDice = action.diceIndices.length;

        if (selected.length !== requiredDice) {
            ui.notifications.warn(game.i18n.format("NEUROSHIMA.MeleeOpposed.ErrorMustSelectExactDice", { count: requiredDice }));
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

        // Kości zużyte przez obie strony
        for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
        for (const i of selected) responder.diceSpent[i] = true;

        // Logika Przejęcia Inicjatywy (Reversal)
        // Jeśli Atakujący wyrzucił porażkę (power=0), a Obrońca sukces (>0), Inicjatywa przechodzi
        if (action.power === 0 && totalDefenseSuccesses > 0) {
            state.initiative = responderRole;
            ui.notifications.info(game.i18n.format("NEUROSHIMA.MeleeOpposed.InitiativeTakenBy", { name: responder.name }));
        }

        if (totalDefenseSuccesses < action.power) {
            // OBRONA NIESKUTECZNA - obrażenia wchodzą
            const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
            const dmg = NeuroshimaMeleeDuelResolver.calculateSegmentDamage(state, action);
            if (dmg) {
                if (!state.segments) state.segments = [{}, {}, {}];
                state.segments[state.currentSegment - 1].result = dmg;
            }
            ui.notifications.warn(game.i18n.format("NEUROSHIMA.MeleeOpposed.DefenseFailed", { need: action.power, have: totalDefenseSuccesses }));
        } else if (action.power > 0) {
            // OBRONA UDANA
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.DefenseSuccess"));
        }
    } else {
        // Przyjęcie obrażeń - zużyj kości atakującego
        for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
        
        // Zawsze zużyj kości obrońcy (Daremna obrona)
        const requiredDice = action.diceIndices.length;
        // W przypadku przyjęcia obrażeń bez zaznaczenia, system zużyje pierwsze dostępne kości obrońcy
        let spentCount = 0;
        for (let i = 0; i < 3 && spentCount < requiredDice; i++) {
            if (!responder.diceSpent[i]) {
                responder.diceSpent[i] = true;
                spentCount++;
            }
        }
        
        if (action.power > 0) {
            const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
            const dmg = NeuroshimaMeleeDuelResolver.calculateSegmentDamage(state, action);
            if (dmg) {
                if (!state.segments) state.segments = [{}, {}, {}];
                state.segments[state.currentSegment - 1].result = dmg;
            }
        }
    }

    // Wyczyść akcję i zaznaczenia
    state.currentAction = null;
    responder.selectedDice = [];
    
    await this._advanceSegment(state, action.diceIndices.length);
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
  async _advanceSegment(state, consumed = 1) {
    state.currentSegment += consumed;
    
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
        doubleSkillAction: game.settings.get("neuroshima", "doubleSkillAction"),
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
