import { NeuroshimaMeleeDuelResolver } from "./melee-duel-resolver.js";
import { NEUROSHIMA } from "../config.js";

/**
 * Klasa zarządzająca stanem i logiką starcia w zwarciu (Opposed Melee).
 * Centralizuje wszystkie operacje na starciu, zapewniając spójność danych między klientami.
 * 
 * Cykl życia starcia (MELEE DUEL):
 * 1. createFromAttack: Atakujący rzuca 3k20, tworzona jest wiadomość z handlerem (status: "waiting-defender").
 * 2. joinDefender: Obrońca (stargetowany aktor) rzuca 3k20 i dołącza do wiadomości (status: "active", phase: "initiative").
 * 3. rollInitiative: Obie strony rzucają na Inicjatywę (Zręczność 3k20).
 * 4. updateInitiative: Po obu rzutach system ustala zwycięzcę (phase: "modification").
 * 5. modifyDie: (Opcjonalnie przy doubleSkillAction) Gracze rozdzielają punkty umiejętności.
 * 6. declareAction (Segments): Gracze wybierają kości do kolejnych 3 segmentów walki (phase: "segments").
 * 7. resolve (Duel Resolver): System rozstrzyga porównania kości i zadaje rany (phase: "resolved").
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
   * Wybiera kości najbliższe progu sukcesu (target) i obniża je tak, aby stały się sukcesami.
   * Algorytm zachłanny: Najpierw naprawia kości, którym brakuje najmniej do sukcesu.
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

    // Jeśli automatyczna optymalizacja jest włączona (brak reguły podwójnego działania), 
    // system sam rozdziela punkty skilla aby zmaksymalizować sukcesy gracza.
    if (!game.settings.get("neuroshima", "doubleSkillAction")) {
        modSelf = this._autoOptimizeDice(attackerDiceRaw, attackerStat, attackerSkill);
    }

    const state = {
      requestId: foundry.utils.randomID(), // Unikalny ID dla celów socketów i pending flags
      status: "waiting-defender",
      phase: "initiative", // initiative -> modification -> segments -> resolved
      turn: 1,
      currentSegment: 1,
      initiative: null, // 'attacker' lub 'defender'
      attacker: {
        actorUuid: attackerActor.uuid,
        tokenUuid: attackerActor.token?.uuid || null,
        name: attackerActor.name,
        img: attackerActor.img || "icons/svg/mystery-man.svg",
        stat: attackerStat,
        skillPoints: attackerSkill,
        modSelf: modSelf, // Tablica [x, y, z] modyfikatorów odjętych od odpowiednich kości
        modOpponent: [0, 0, 0], // (DoubleSkillAction) Tablica modyfikatorów dodanych kościom przeciwnika
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

    // Inicjatywa jest rzucana "cicho" (chatMessage: false).
    // Wynik jest zapisywany tylko we flagach duelu, a tooltip rzutu podpinany
    // pod plakietkę PP (Punkty Przewagi) w UI handlera.
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
            
            // Wyślij wynik do MG aby zaktualizował wiadomość duelu (synchronizacja stanu).
            // Używamy socketlib, ponieważ tylko GM może edytować flagi wiadomości systemowych.
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
   * Rozstrzyga, kto jest atakującym w tej turze walki wręcz.
   */
  async updateInitiative(role, rollResult) {
    if (!game.user.isGM) return;

    const state = foundry.utils.deepClone(this.state);
    const side = state[role];
    
    side.initiativeRoll = rollResult.successPoints;
    side.initiativeTooltip = rollResult.tooltip;

    // Po uzyskaniu obu wyników sprawdzamy kto wygrał:
    // Wyższe SP (Punkty Sukcesu) dają Inicjatywę. 
    // Przy remisie obie strony muszą rzucić ponownie (standard NS 1.5).
    if (state.attacker.initiativeRoll !== null && state.defender.initiativeRoll !== null) {
        if (state.attacker.initiativeRoll > state.defender.initiativeRoll) {
            state.initiative = "attacker";
            state.phase = "modification";
        } else if (state.defender.initiativeRoll > state.attacker.initiativeRoll) {
            state.initiative = "defender";
            state.phase = "modification";
        } else {
            // Remis - resetujemy rzuty i czekamy na ponowny roll.
            state.attacker.initiativeRoll = null;
            state.defender.initiativeRoll = null;
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeDraw"));
        }
    }

    state.version += 1;
    await this.update(state);
  }

  /**
   * Modyfikuje wynik kości (ręczne rozdzielanie umiejętności).
   * @param {string} actorRole - Rola gracza modyfikującego ('attacker' lub 'defender')
   * @param {string} targetRole - Rola gracza, którego kość jest modyfikowana (może być ten sam gracz)
   * @param {number} dieIndex - Indeks kości (0, 1 lub 2)
   * @param {number} delta - Zmiana (+1 wydaje punkt umiejętności, -1 go cofa)
   */
  async modifyDie(actorRole, targetRole, dieIndex, delta) {
    // Wszystkie modyfikacje przechodzą przez GM (socketlib), 
    // aby zapewnić atomowość operacji i spójność stanu flag.
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

    // Obliczamy ile punktów skilla gracz już wydał w sumie (na siebie + na przeciwnika).
    const currentSpent = side.modSelf.reduce((a, b) => a + b, 0) + side.modOpponent.reduce((a, b) => a + b, 0);
    
    // Walidacja dostępnych punktów (nie można wydać więcej niż skillValue).
    if (d > 0 && currentSpent >= side.skillPoints) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoSkillPoints"));
        return;
    }

    // Naturalna 20 (fumble) nie może być modyfikowana żadną umiejętnością (Zasady NS 1.5).
    const targetDieValue = state.dice[targetRole][idx];
    if (targetDieValue === 20) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.Natural20CannotBeModified"));
        return;
    }

    if (actorRole === targetRole) {
        // Obniżanie własnej kości (zwiększanie szansy na sukces).
        const currentMod = side.modSelf[idx];
        const newMod = Math.max(0, currentMod + d);
        
        // Kość nie może spaść poniżej 1 (naturalna 1 to krytyk).
        if (targetDieValue - newMod < 1 && d > 0) return;
        
        side.modSelf[idx] = newMod;
    } else {
        // Podwyższanie kości przeciwnika (tylko przy doubleSkillAction).
        // Gracz zmusza przeciwnika do rzutu wyższego, co może zmienić sukces w porażkę.
        const currentMod = side.modOpponent[idx];
        const newMod = Math.max(0, currentMod + d);
        
        // Kość nie może wzrosnąć powyżej 20 (uwzględniając ewentualne obniżenie przez przeciwnika).
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
   * Gracz wybiera od 1 do 3 kości, aby stworzyć cios (atak) lub obronę.
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
    // Jeśli nie ma zadeklarowanej akcji, kości wybiera ten, kto ma aktualnie inicjatywę (atakujący).
    // Jeśli akcja jest zadeklarowana, to druga strona musi wybrać kości do obrony (respondent).
    let allowedRole = state.initiative; 
    if (state.currentAction) {
        allowedRole = state.currentAction.side === "attacker" ? "defender" : "attacker";
    }

    if (role !== allowedRole) return;

    const side = state[role];
    if (!side.selectedDice) side.selectedDice = [];

    // Nie można wybrać kości, która została już zużyta w poprzednim segmencie.
    if (side.diceSpent[index]) return;

    const idx = side.selectedDice.indexOf(index);
    if (idx > -1) {
        side.selectedDice.splice(idx, 1);
    } else {
        // Max 3 kości zgodnie z mechaniką ciosów złożonych NS 1.5.
        if (side.selectedDice.length < 3) {
            side.selectedDice.push(index);
        }
    }

    state.version += 1;
    await this.update(state);
  }

  /**
   * Deklaruje akcję w segmencie (Atak lub Pas).
   * Atakujący (ten z inicjatywą) wybiera kości i tworzy propozycję ciosu.
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
        
        // Oblicz siłę ciosu (Power): liczba sukcesów wśród zaznaczonych kości.
        // Uwzględniamy modyfikatory własne (modSelf) oraz modyfikatory narzucone przez przeciwnika (modOpponent).
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

        // Akcja zostaje zapisana w stanie jako "oczekująca na reakcję obrońcy".
        state.currentAction = {
            side: role,
            sideName: side.name,
            type: totalSuccesses === 0 ? "failure" : (totalSuccesses === 1 ? "single" : "compound"),
            power: totalSuccesses,
            diceCount: selected.length,
            diceIndices: [...selected]
        };
        
        // Czyścimy tymczasowe zaznaczenie po deklaracji.
        side.selectedDice = [];
    } else if (type === "pass") {
        // Pasowanie segmentu - gracz z inicjatywą oddaje ruch bez ataku.
        // Zużywa jedną dostępną kość (zazwyczaj tę o najgorszym wyniku).
        const firstFree = side.diceSpent.indexOf(false);
        if (firstFree > -1) side.diceSpent[firstFree] = true;
        
        // Przechodzimy do kolejnego segmentu (lub kończymy starcie).
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

        // Zasada NS 1.5: Obrona przed ciosem złożonym wymaga przeznaczenia DOKŁADNIE tylu samo kości.
        if (selected.length !== requiredDice) {
            ui.notifications.warn(game.i18n.format("NEUROSHIMA.MeleeOpposed.ErrorMustSelectExactDice", { count: requiredDice }));
            return;
        }

        // Oblicz siłę obrony (liczba sukcesów).
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

        // Kości zostają oznaczone jako zużyte u obu stron, niezależnie od wyniku obrony.
        for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
        for (const i of selected) responder.diceSpent[i] = true;

        // LOGIKA PRZEJĘCIA INICJATYWY (Reversal):
        // Jeśli Atakujący wyrzucił porażkę (power=0), a Obrońca wyrzucił przynajmniej jeden sukces (totalDefenseSuccesses > 0),
        // to Obrońca przejmuje inicjatywę i staje się atakującym w następnych segmentach.
        if (action.power === 0 && totalDefenseSuccesses > 0) {
            state.initiative = responderRole;
            ui.notifications.info(game.i18n.format("NEUROSHIMA.MeleeOpposed.InitiativeTakenBy", { name: responder.name }));
        }

        // Sprawdzenie skuteczności obrony:
        // Obrona jest skuteczna, jeśli liczba sukcesów obrońcy >= liczbie sukcesów (power) atakującego.
        if (totalDefenseSuccesses < action.power) {
            // OBRONA NIESKUTECZNA - obliczamy i zapisujemy obrażenia segmentu.
            const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
            const dmg = NeuroshimaMeleeDuelResolver.calculateSegmentDamage(state, action);
            if (dmg) {
                if (!state.segments) state.segments = [{}, {}, {}];
                state.segments[state.currentSegment - 1].result = dmg;
            }
            ui.notifications.warn(game.i18n.format("NEUROSHIMA.MeleeOpposed.DefenseFailed", { need: action.power, have: totalDefenseSuccesses }));
        } else if (action.power > 0) {
            // OBRONA UDANA - atak został sparowany/uniknięty.
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.DefenseSuccess"));
        }
    } else {
        // PRZYJĘCIE OBRAŻEŃ (lub brak obrony):
        // Kości atakującego zostają zużyte.
        for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
        
        // ZASADA DAREMNEJ OBRONY: Nawet jeśli gracz nie broni się skutecznie, 
        // to i tak musi "spalić" kości w odpowiedzi na atak przeciwnika.
        const requiredDice = action.diceIndices.length;
        let spentCount = 0;
        for (let i = 0; i < 3 && spentCount < requiredDice; i++) {
            if (!responder.diceSpent[i]) {
                responder.diceSpent[i] = true;
                spentCount++;
            }
        }
        
        // Obrażenia wchodzą automatycznie jeśli atak był sukcesem.
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
