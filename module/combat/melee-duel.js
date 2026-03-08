import { NeuroshimaMeleeDuelResolver } from "./melee-duel-resolver.js";
import { NEUROSHIMA } from "../config.js";

/**
 * Klasa zarządzająca stanem i logiką starcia w zwarciu (Opposed Melee) przy użyciu Combat Flags.
 * Centralizuje wszystkie operacje na starciu, zapewniając spójność danych między klientami.
 */
export class NeuroshimaMeleeDuel {
  /**
   * Stałe faz starcia (Enum).
   */
  static PHASES = Object.freeze({
    INITIATIVE: "initiative",
    POOL_ROLL: "pool-roll",
    MODIFICATION: "modification",
    SEGMENTS: "segments",
    RESOLVED: "resolved"
  });

  /**
   * @param {string} duelId - Unikalny identyfikator pojedynku w flagach Combata.
   * @param {Combat} combat - Dokument Combat, w którym toczy się starcie.
   */
  constructor(duelId, combat = game.combat) {
    this.duelId = duelId;
    this.combat = combat;
    if (!combat) {
        throw new Error("NeuroshimaMeleeDuel requires an active Combat.");
    }
  }

  /**
   * Znajduje aktywny pojedynek dla danego aktora w bieżącej walce.
   * @param {Actor} actor - Aktor do sprawdzenia.
   * @param {Combat} [combat=game.combat] - Opcjonalnie konkretny dokument Combat.
   * @returns {NeuroshimaMeleeDuel|null} Instancja pojedynku lub null.
   */
  static findActiveDuelForActor(actor, combat = game.combat) {
    if (!combat || !actor) return null;
    const duels = combat.getFlag("neuroshima", "duels") || {};
    
    // Get all relevant IDs for this actor/token
    const actorUuid = actor.uuid;
    const actorId = actor.id;
    const tokenUuid = actor.token?.uuid || (actor.isToken ? actor.uuid : null);
    
    game.neuroshima.log("findActiveDuelForActor | Sprawdzanie aktora:", {
        actorName: actor.name,
        actorUuid,
        tokenUuid,
        actorId
    });

    for (const duelId in duels) {
      const duel = duels[duelId];
      if (duel.status === "finished") continue;
      
      const isAttacker = duel.attacker.actorUuid === actorUuid || 
                         (tokenUuid && duel.attacker.tokenUuid === tokenUuid) ||
                         duel.attacker.actorUuid === actorId;

      const isDefender = duel.defender?.actorUuid === actorUuid || 
                         (tokenUuid && duel.defender?.tokenUuid === tokenUuid) ||
                         duel.defender?.actorUuid === actorId;

      const isPotentialTarget = duel.status === "waiting-defender" && 
                                (duel.attackerTargets || []).some(t => 
                                    t.uuid === actorUuid || 
                                    t.id === actorId || 
                                    (tokenUuid && t.uuid === tokenUuid)
                                );

      if (isAttacker || isDefender || isPotentialTarget) {
          game.neuroshima.log(`findActiveDuelForActor | Znaleziono pojedynek ${duelId}`, { isAttacker, isDefender, isPotentialTarget });
          return new NeuroshimaMeleeDuel(duelId, combat);
      }
    }
    return null;
  }

  /**
   * Pobiera aktualny stan starcia z flag Combata.
   */
  get state() {
    const duels = this.combat.getFlag("neuroshima", "duels") || {};
    const state = duels[this.duelId];
    if (!state) {
        game.neuroshima?.warn(`Brak danych pojedynku ${this.duelId} w flagach Combata!`);
        return null;
    }
    return state;
  }

  /**
   * Automatycznie optymalizuje rzuty kośćmi używając punktów umiejętności.
   */
  static _autoOptimizeDice(dice, target, skillPoints) {
    let mods = [0, 0, 0];
    let remaining = skillPoints;
    
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
   * Fabryka: Tworzy nową instancję starcia na podstawie rzutu inicjatywy atakującego.
   * Zapisuje stan w flagach Combata.
   */
  static async createFromAttack(attackerActor, weapon, targets = [], initiativeResult) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("createMeleeDuel", {
            attackerUuid: attackerActor.uuid,
            weaponId: weapon.id,
            targets: targets,
            initiativeResult: initiativeResult
        });
    }

    if (!game.combat) {
        ui.notifications.error(game.i18n.localize("NEUROSHIMA.Warnings.NoCombatActive"));
        return null;
    }

    const duelId = foundry.utils.randomID();
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

    const state = {
      id: duelId,
      status: "waiting-defender",
      phase: NeuroshimaMeleeDuel.PHASES.INITIATIVE,
      turn: 1,
      currentSegment: 1,
      initiative: null,
      attacker: {
        actorUuid: attackerActor.uuid,
        tokenUuid: attackerActor.token?.uuid || null,
        name: attackerActor.name,
        img: attackerActor.img || "icons/svg/mystery-man.svg",
        stat: 10,
        skillPoints: 0,
        modSelf: [0, 0, 0],
        modOpponent: [0, 0, 0],
        ready: false,
        diceSpent: [false, false, false],
        initiativeRoll: initiativeResult.successPoints,
        initiativeTooltip: initiativeResult.tooltip || "",
        rollTooltip: "",
        maneuver: "none"
      },
      defender: { 
        actorUuid: null, 
        tokenUuid: null, 
        name: game.i18n.localize("NEUROSHIMA.MeleeOpposed.WaitingForDefender"), 
        img: "icons/svg/mystery-man.svg",
        stat: 10,
        skillPoints: 0,
        modSelf: [0, 0, 0],
        modOpponent: [0, 0, 0],
        ready: false,
        diceSpent: [false, false, false],
        initiativeRoll: null,
        maneuver: "none"
      },
      attack: { weaponId: weapon.id, weaponName: weapon.name },
      defense: { weaponId: null, weaponName: null },
      dice: {
        attacker: [],
        defender: []
      },
      segments: [
        { result: null },
        { result: null },
        { result: null }
      ],
      attackerTargets: targetsInfo,
      version: 1
    };

    const duels = game.combat.getFlag("neuroshima", "duels") || {};
    duels[duelId] = state;
    await game.combat.setFlag("neuroshima", "duels", duels);

    // Create a notification message
    await ChatMessage.create({
        user: game.user.id,
        content: `<h3>${game.i18n.localize("NEUROSHIMA.MeleeOpposed.DuelStarted")}</h3><p>${attackerActor.name} ${game.i18n.localize("NEUROSHIMA.MeleeOpposed.AttackInstruction")}</p>`,
        flags: { neuroshima: { duelId } }
    });

    return new NeuroshimaMeleeDuel(duelId);
  }

  /**
   * Dołącza obrońcę do starcia na podstawie rzutu inicjatywy.
   */
  static async join(duelId, defenderActor, initiativeResult, weaponId = null) {
    if (!game.user.isGM) {
        game.neuroshima.log(`MeleeDuel | Wywołano join() przez użytkownika, deleguję do GM-a. Duel: ${duelId}`);
        return game.neuroshima.socket.executeAsGM("joinMeleeDuel", {
            duelId: duelId,
            defenderData: {
                actorUuid: defenderActor.uuid,
                rollResult: initiativeResult,
                weaponId: weaponId
            }
        });
    }

    game.neuroshima.group(`MeleeDuel | join() as GM: ${duelId}`);
    const duel = NeuroshimaMeleeDuel.fromId(duelId);
    if (!duel) {
        game.neuroshima.error(`MeleeDuel | Nie znaleziono pojedynku o ID: ${duelId}`);
        game.neuroshima.groupEnd();
        return;
    }

    const state = foundry.utils.deepClone(duel.state);
    if (!state) {
        game.neuroshima.error(`MeleeDuel | Stan pojedynku jest pusty!`);
        game.neuroshima.groupEnd();
        return;
    }

    if (state.status !== "waiting-defender") {
        game.neuroshima.warn(`MeleeDuel | Pojedynek nie jest w stanie oczekiwania na obrońcę (status: ${state.status})`);
        game.neuroshima.groupEnd();
        return;
    }

    const weapon = defenderActor.items.get(weaponId);
    game.neuroshima.log(`Obrońca: ${defenderActor.name}, Broń: ${weapon?.name || "Brak"}, Inicjatywa: ${initiativeResult.successPoints} SP`);

    const defenderRollData = {
        damageMelee1: weapon?.system?.damageMelee1 || "D",
        damageMelee2: weapon?.system?.damageMelee2 || "L",
        damageMelee3: weapon?.system?.damageMelee3 || "C"
    };

    state.defender = {
      actorUuid: defenderActor.uuid,
      tokenUuid: defenderActor.token?.uuid || null,
      name: defenderActor.name,
      img: defenderActor.img || "icons/svg/mystery-man.svg",
      stat: 10,
      skillPoints: 0,
      modSelf: [0, 0, 0],
      modOpponent: [0, 0, 0],
      ready: false,
      diceSpent: [false, false, false],
      initiativeRoll: initiativeResult.successPoints,
      initiativeTooltip: initiativeResult.tooltip || "",
      maneuver: "none"
    };

    state.defense = { 
        weaponId, 
        weaponName: weapon?.name || null,
        rollData: defenderRollData
    };
    state.status = "active";
    state.phase = NeuroshimaMeleeDuel.PHASES.INITIATIVE;
    state.version += 1;

    // Resolve initial initiative if both rolled
    if (state.attacker.initiativeRoll !== null && state.defender.initiativeRoll !== null) {
        game.neuroshima.log(`Rozstrzyganie inicjatywy: ${state.attacker.initiativeRoll} vs ${state.defender.initiativeRoll}`);
        if (state.attacker.initiativeRoll > state.defender.initiativeRoll) {
            state.initiative = "attacker";
            state.phase = NeuroshimaMeleeDuel.PHASES.POOL_ROLL;
        } else if (state.defender.initiativeRoll > state.attacker.initiativeRoll) {
            state.initiative = "defender";
            state.phase = NeuroshimaMeleeDuel.PHASES.POOL_ROLL;
        } else {
            // Tie - reset initiative to reroll
            state.attacker.initiativeRoll = null;
            state.defender.initiativeRoll = null;
            state.phase = NeuroshimaMeleeDuel.PHASES.INITIATIVE;
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeDraw"));
        }
    }

    await duel.update(state);
    game.neuroshima.log("Pojedynek zaktualizowany pomyślnie.");
    game.neuroshima.groupEnd();
  }

  /**
   * Pobiera instancję duelu z ID.
   */
  static fromId(duelId, combat = null) {
    if (!combat) {
        // Try to find combat containing this duelId
        combat = game.combats.find(c => {
            const duels = c.getFlag("neuroshima", "duels") || {};
            return !!duels[duelId];
        });
    }
    if (!combat) combat = game.combat;
    if (!combat) return null;
    
    const duels = combat.getFlag("neuroshima", "duels") || {};
    if (!duels[duelId]) return null;
    return new NeuroshimaMeleeDuel(duelId, combat);
  }

  /**
   * Pobiera instancję duelu z wiadomości czatu.
   * @param {ChatMessage} message - Wiadomość zawierająca duelId w flagach.
   * @returns {NeuroshimaMeleeDuel|null}
   */
  static fromMessage(message) {
    const duelId = message.getFlag("neuroshima", "duelId");
    if (!duelId) return null;
    return NeuroshimaMeleeDuel.fromId(duelId);
  }

  /**
   * Wykonuje rzut pulą 3k20 dla danej strony.
   */
  async rollPool(role) {
    const state = this.state;
    
    // Block pool roll if initiative is not yet established
    if (state.phase === NeuroshimaMeleeDuel.PHASES.INITIATIVE || (state.attacker.initiativeRoll === null || state.defender.initiativeRoll === null)) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposed.ErrorRollInitiativeFirst"));
        return;
    }

    const side = state[role];
    const actorDoc = await fromUuid(side.actorUuid);
    const actor = actorDoc?.actor || actorDoc;

    if (!actor || (!actor.isOwner && !game.user.isGM)) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NotYourActor"));
        return;
    }

    const weaponId = role === "attacker" ? state.attack.weaponId : state.defense.weaponId;
    const weapon = actor.items.get(weaponId);

    const { NeuroshimaWeaponRollDialog } = await import("../apps/weapon-roll-dialog.js");
    const dialog = new NeuroshimaWeaponRollDialog({
        actor: actor,
        weapon: weapon,
        rollType: "melee",
        isPoolRoll: true,
        duelId: this.duelId,
        onRoll: async (rollResult) => {
            if (game.user.isGM) {
                await this.updatePool(role, rollResult);
            } else {
                await game.neuroshima.socket.executeAsGM("updateMeleePool", {
                    duelId: this.duelId,
                    role: role,
                    rollResult: rollResult
                });
            }
        }
    });
    dialog.render(true);
  }

  async updatePool(role, rollResult) {
    if (!game.user.isGM) return;
    
    game.neuroshima.log(`MeleeDuel | updatePool(${role})`, rollResult);
    
    if (!rollResult) {
        game.neuroshima.error("MeleeDuel | Brak rollResult w updatePool!");
        return;
    }

    const state = foundry.utils.deepClone(this.state);
    const side = state[role];
    
    // Pobieramy kości w sposób bezpieczny, wspierając różne formaty rollResult
    let rawDice = [];
    if (rollResult.rawResults && Array.isArray(rollResult.rawResults)) {
        rawDice = rollResult.rawResults;
    } else if (rollResult.results && Array.isArray(rollResult.results)) {
        rawDice = rollResult.results;
    } else if (rollResult.roll?.terms?.[0]?.results) {
        rawDice = rollResult.roll.terms[0].results;
    }

    const dice = rawDice.map(r => {
        if (typeof r === 'object') return r.result ?? r.value ?? r.original ?? 0;
        return r;
    });

    if (dice.length === 0) {
        game.neuroshima.error("MeleeDuel | Nie udało się wyodrębnić kości z rollResult!", rollResult);
        return;
    }

    state.dice[role] = dice;
    side.stat = rollResult.target || rollResult.stat || 10;
    side.skillPoints = rollResult.skill || 0;
    side.rollTooltip = rollResult.tooltip || "";
    side.ready = true;

    // Auto-optimize if setting is off
    if (!game.settings.get("neuroshima", "doubleSkillAction")) {
        side.modSelf = NeuroshimaMeleeDuel._autoOptimizeDice(dice, side.stat, side.skillPoints);
    }

    // Check if both sides are ready
    if (state.dice.attacker.length > 0 && state.dice.defender.length > 0) {
        state.phase = game.settings.get("neuroshima", "doubleSkillAction") ? NeuroshimaMeleeDuel.PHASES.MODIFICATION : NeuroshimaMeleeDuel.PHASES.SEGMENTS;
        state.attacker.ready = false;
        state.defender.ready = false;
        state.currentSegment = 1;
    }

    state.version += 1;
    await this.update(state);
  }

  async selectManeuver(role, maneuver) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("selectMeleeManeuver", {
            duelId: this.duelId,
            role,
            maneuver
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (!state || state.phase !== "maneuver") return;

    state[role].maneuver = maneuver;
    
    // If both maneuvers selected, move to pool-roll phase
    if (state.attacker.maneuver !== "none" && state.defender?.maneuver !== "none") {
        state.phase = "pool-roll";
    }

    state.version += 1;
    await this.update(state);
  }

  /**
   * Inicjuje proces rzutu na inicjatywę.
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
    let suggestedSkill = role === "attacker" ? state.attack.rollData?.weapon?.system?.skill : state.defense.rollData?.weapon?.system?.skill;

    const dialog = new NeuroshimaInitiativeRollDialog({
        actor: actor,
        skill: suggestedSkill || "",
        isMeleeInitiative: true,
        onRoll: async (rollData) => {
            const rollResult = await game.neuroshima.NeuroshimaDice.rollInitiative({
                ...rollData,
                actor: actor,
                chatMessage: false
            });
            
            if (game.user.isGM) {
                await this.updateInitiative(role, {
                    successPoints: rollResult.successPoints,
                    tooltip: rollResult.tooltip || ""
                });
            } else {
                await game.neuroshima.socket.executeAsGM("updateMeleeInitiative", {
                    duelId: this.duelId,
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

  async updateInitiative(role, rollResult) {
    if (!game.user.isGM) return;
    const state = foundry.utils.deepClone(this.state);
    const side = state[role];
    
    side.initiativeRoll = rollResult.successPoints;
    side.initiativeTooltip = rollResult.tooltip;

    if (state.attacker.initiativeRoll !== null && state.defender.initiativeRoll !== null) {
        if (state.attacker.initiativeRoll > state.defender.initiativeRoll) {
            state.initiative = "attacker";
            state.phase = NeuroshimaMeleeDuel.PHASES.POOL_ROLL;
        } else if (state.defender.initiativeRoll > state.attacker.initiativeRoll) {
            state.initiative = "defender";
            state.phase = NeuroshimaMeleeDuel.PHASES.POOL_ROLL;
        } else {
            state.attacker.initiativeRoll = null;
            state.defender.initiativeRoll = null;
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeDraw"));
        }
    }

    state.version += 1;
    await this.update(state);
  }

  async modifyDie(actorRole, targetRole, dieIndex, delta) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("modifyMeleeDie", {
            duelId: this.duelId,
            side: actorRole,
            target: targetRole,
            index: dieIndex,
            delta: delta
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (!state || state.status !== "active") return;

    const isModifyingSelf = actorRole === targetRole;
    const isDoubleSkillEnabled = game.settings.get("neuroshima", "doubleSkillAction");

    if (!isModifyingSelf && !isDoubleSkillEnabled) {
        ui.notifications.warn("Podwójne działanie umiejętności (modyfikowanie kości przeciwnika) jest wyłączone w ustawieniach systemu.");
        return;
    }
    
    const side = state[actorRole];
    const currentSpent = side.modSelf.reduce((a, b) => a + b, 0) + side.modOpponent.reduce((a, b) => a + b, 0);
    
    if (delta > 0 && currentSpent >= side.skillPoints) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoSkillPoints"));
        return;
    }

    const targetDieValue = state.dice[targetRole][dieIndex];
    if (targetDieValue === 20) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.Natural20CannotBeModified"));
        return;
    }

    if (actorRole === targetRole) {
        side.modSelf[dieIndex] = Math.max(0, side.modSelf[dieIndex] + delta);
    } else {
        side.modOpponent[dieIndex] = Math.max(0, side.modOpponent[dieIndex] + delta);
    }

    state.version += 1;
    await this.update(state);
  }

  async toggleReady(role) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("toggleMeleeReady", {
            duelId: this.duelId,
            role: role
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (!state || state.status !== "active") return;
    
    state[role].ready = !state[role].ready;
    if (state.phase === NeuroshimaMeleeDuel.PHASES.MODIFICATION && state.attacker.ready && state.defender.ready) {
        state.phase = NeuroshimaMeleeDuel.PHASES.SEGMENTS;
        state.currentSegment = 1;
        state.attacker.ready = false;
        state.defender.ready = false;
    }
    
    state.version += 1;
    await this.update(state);
  }

  async selectDie(role, index) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("selectMeleeDie", {
            duelId: this.duelId,
            role,
            index
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (!state || state.phase !== NeuroshimaMeleeDuel.PHASES.SEGMENTS) return;

    let allowedRole = state.initiative; 
    if (state.currentAction) {
        allowedRole = state.currentAction.side === "attacker" ? "defender" : "attacker";
    }

    if (role !== allowedRole) return;
    const side = state[role];
    if (!side.selectedDice) side.selectedDice = [];
    if (side.diceSpent[index]) return;

    const idx = side.selectedDice.indexOf(index);
    if (idx > -1) side.selectedDice.splice(idx, 1);
    else if (side.selectedDice.length < 3) side.selectedDice.push(index);

    state.version += 1;
    await this.update(state);
  }

  async declareAction(role, type) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("declareMeleeAction", {
            duelId: this.duelId,
            role,
            type
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (!state || state.phase !== NeuroshimaMeleeDuel.PHASES.SEGMENTS || state.currentAction || state.initiative !== role) return;

    const side = state[role];
    const selected = side.selectedDice || [];
    
    if (type === "attack") {
        if (selected.length === 0) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposed.SelectDiceInstruction"));
            return;
        }
        
        const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
        const dice = state.dice[role];
        const stat = side.stat;

        let totalSuccesses = 0;
        for (const i of selected) {
            if (NeuroshimaMeleeDuelResolver.isSuccess(dice[i], i, role, state)) {
                totalSuccesses++;
            }
        }

        state.currentAction = {
            side: role,
            sideName: side.name,
            type: totalSuccesses === 0 ? "failure" : (totalSuccesses === 1 ? "single" : "compound"),
            power: totalSuccesses,
            diceCount: selected.length,
            diceIndices: [...selected]
        };
        side.selectedDice = [];
    } else if (type === "pass") {
        const firstFree = side.diceSpent.indexOf(false);
        if (firstFree > -1) side.diceSpent[firstFree] = true;
        await this._advanceSegment(state);
    }

    state.version += 1;
    await this.update(state);
  }

  async respondToAction(response) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("respondMeleeAction", {
            duelId: this.duelId,
            response
        });
    }

    const state = foundry.utils.deepClone(this.state);
    if (!state || state.phase !== NeuroshimaMeleeDuel.PHASES.SEGMENTS || !state.currentAction) return;

    const action = state.currentAction;
    const responderRole = action.side === "attacker" ? "defender" : "attacker";
    const responder = state[responderRole];

    if (response === "defend") {
        const selected = responder.selectedDice || [];
        if (selected.length !== action.diceIndices.length) {
            ui.notifications.warn(game.i18n.format("NEUROSHIMA.MeleeOpposed.ErrorMustSelectExactDice", { count: action.diceIndices.length }));
            return;
        }

        const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
        const dice = state.dice[responderRole];
        
        let totalDefenseSuccesses = 0;
        for (const i of selected) {
            if (NeuroshimaMeleeDuelResolver.isSuccess(dice[i], i, responderRole, state)) {
                totalDefenseSuccesses++;
            }
        }

        // Marking dice as spent
        for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
        for (const i of selected) responder.diceSpent[i] = true;

        const initiatorRole = action.side;
        
        // RESOLUTION LOGIC
        // 1. Success vs Success: Draw
        // 2. Success vs Failure: Hit
        // 3. Failure vs Success: Initiative Takeover
        // 4. Failure vs Failure: Draw

        // For compound hits, power is the number of successes in the attack.
        // Defense must have SAME OR MORE successes to block.
        const hit = action.power > totalDefenseSuccesses;
        
        // Takeover logic: Attacker 0s vs Defender > 0s
        let takeover = action.power === 0 && totalDefenseSuccesses > 0;
        
        // Full Defense adjustment: needs 2 successes to takeover
        if (takeover && responder.maneuver === "fullDefense" && totalDefenseSuccesses < 2) {
            takeover = false;
        }

        let resultMsg = "";
        const attackerName = state[action.side].name;
        const defenderName = responder.name;

        if (takeover) {
            state.initiative = responderRole;
            resultMsg = game.i18n.format("NEUROSHIMA.MeleeOpposed.InitiativeTakenBy", { name: defenderName });
            
            // Fury maneuver: losing initiative results in being hit
            if (state[action.side].maneuver === "fury") {
                const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
                const dmg = NeuroshimaMeleeDuelResolver.calculateSegmentDamage(state, { 
                    side: responderRole, 
                    power: 1 
                });
                
                if (!state.segments) state.segments = [{ result: null }, { result: null }, { result: null }];
                state.segments[state.currentSegment - 1].resultDefender = dmg;
                resultMsg += " " + game.i18n.format("NEUROSHIMA.MeleeOpposed.FuryHitBack", { 
                    attacker: defenderName, 
                    defender: attackerName,
                    damage: dmg 
                });
            }
            ui.notifications.info(resultMsg);
        }

        if (hit && action.power > 0) {
            const dmg = NeuroshimaMeleeDuelResolver.calculateSegmentDamage(state, action);
            if (dmg) {
                if (!state.segments) state.segments = [{}, {}, {}];
                state.segments[state.currentSegment - 1].result = dmg;
                resultMsg = game.i18n.format("NEUROSHIMA.MeleeOpposed.HitSuccess", { 
                    attacker: attackerName, 
                    defender: defenderName,
                    damage: dmg 
                });
            }
        } else if (!takeover) {
            resultMsg = game.i18n.format("NEUROSHIMA.MeleeOpposed.DefenseSuccess", { 
                attacker: attackerName, 
                defender: defenderName 
            });
        }
        
        // Create chat message for feedback
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: await fromUuid(state[action.side].actorUuid) }),
            content: `<div class="neuroshima chat-card melee-segment-result">
                <h3>${game.i18n.localize("NEUROSHIMA.MeleeOpposed.Segment")} ${state.currentSegment}</h3>
                <p>${resultMsg}</p>
                <div class="dice-info">
                    <span>${attackerName}: ${action.power}s</span> vs 
                    <span>${defenderName}: ${totalDefenseSuccesses}s</span>
                </div>
            </div>`,
            flags: { neuroshima: { duelId: this.duelId } }
        });

        // Special case for Fury maneuver: Failure vs Success is a hit for defender
        if (!takeover && action.power === 0 && totalDefenseSuccesses > 0 && state[action.side].maneuver === "fury") {
             const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
             // Fury damage is always at least 1s? Or based on defender's weapon?
             // Rules say "każde przejęcie inicjatywy jest celnym ciosem". 
             // We'll treat it as 1s hit from defender.
             // TODO: Logic for defender hit back in fury
        }

    } else {
        // Ignored defense
        for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
        let spentCount = 0;
        for (let i = 0; i < 3 && spentCount < action.diceIndices.length; i++) {
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
                const attackerName = state[action.side].name;
                const defenderName = responder.name;
                
                await ChatMessage.create({
                    user: game.user.id,
                    content: `<div class="neuroshima chat-card melee-segment-result ignored">
                        <h3>${game.i18n.localize("NEUROSHIMA.MeleeOpposed.Segment")} ${state.currentSegment}</h3>
                        <p>${game.i18n.format("NEUROSHIMA.MeleeOpposed.HitIgnored", { 
                            attacker: attackerName, 
                            defender: defenderName,
                            damage: dmg 
                        })}</p>
                    </div>`,
                    flags: { neuroshima: { duelId: this.duelId } }
                });
            }
        }
    }

    state.currentAction = null;
    responder.selectedDice = [];
    await this._advanceSegment(state, action.diceIndices.length);
    state.version += 1;
    await this.update(state);
  }

  async _advanceSegment(state, consumed = 1) {
    state.currentSegment += consumed;
    const attackerDone = state.attacker.diceSpent.every(s => s);
    const defenderDone = state.defender.diceSpent.every(s => s);

    if (state.currentSegment > 3 || (attackerDone && defenderDone)) {
        state.status = "resolved";
        state.phase = NeuroshimaMeleeDuel.PHASES.RESOLVED;
        const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
        state.result = NeuroshimaMeleeDuelResolver.resolve(state);
        
        // Create turn summary message
        const attackerName = state.attacker.name;
        const defenderName = state.defender.name;
        
        let summaryHtml = `<div class="neuroshima chat-card melee-turn-summary">
            <h3>${game.i18n.localize("NEUROSHIMA.MeleeOpposed.TurnSummary")} ${state.turn}</h3>
            <ul>`;
        
        (state.segments || []).forEach((seg, i) => {
            if (seg.result || seg.resultDefender) {
                summaryHtml += `<li><strong>${game.i18n.localize("NEUROSHIMA.MeleeOpposed.Segment")} ${i + 1}:</strong> `;
                if (seg.result) summaryHtml += `${attackerName} -> ${seg.result} `;
                if (seg.resultDefender) summaryHtml += `${defenderName} -> ${seg.resultDefender}`;
                summaryHtml += `</li>`;
            }
        });
        
        summaryHtml += `</ul></div>`;
        
        await ChatMessage.create({
            user: game.user.id,
            content: summaryHtml,
            flags: { neuroshima: { duelId: this.duelId } }
        });
    }
  }

  async finish() {
    game.neuroshima.log("MeleeDuel | Wywołano finish()", { duelId: this.duelId, isGM: game.user.isGM });
    
    if (!game.user.isGM) {
        game.neuroshima.log("MeleeDuel | Przekierowanie finish() przez socket");
        return game.neuroshima.socket.executeAsGM("finishMeleeDuel", { duelId: this.duelId });
    }
    
    const combat = this.combat || game.combat;
    if (!combat) {
        game.neuroshima.error("MeleeDuel | Brak dokumentu Combat w finish()");
        return;
    }

    game.neuroshima.log("MeleeDuel | Usuwanie pojedynku z flag metodą explicit delete", this.duelId);
    await combat.setFlag("neuroshima", `duels.-=${this.duelId}`, null);
    game.neuroshima.log("MeleeDuel | Flagi zaktualizowane pomyślnie");
    
    // Explicitly refresh combat tracker
    if (ui.sidebar?.tabs?.combat) {
        game.neuroshima.log("MeleeDuel | Wymuszanie renderowania paska bocznego");
        ui.sidebar.tabs.combat.render(true);
    }
  }

  async takeoverInitiative() {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("takeoverMeleeInitiative", { duelId: this.duelId });
    }
    const state = foundry.utils.deepClone(this.state);
    if (!state || state.phase !== NeuroshimaMeleeDuel.PHASES.SEGMENTS) return;
    state.initiative = state.initiative === "attacker" ? "defender" : "attacker";
    state.version += 1;
    await this.update(state);
  }

  async nextTurn() {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("nextMeleeTurn", { duelId: this.duelId });
    }
    const state = foundry.utils.deepClone(this.state);
    if (!state) return;
    
    state.turn += 1;
    state.currentSegment = 1;
    state.status = "active";
    state.currentAction = null;
    state.result = null;
    state.segments = [{ result: null }, { result: null }, { result: null }];
    
    // Reset combatants for new turn
    for (const role of ["attacker", "defender"]) {
        state[role].ready = false;
        state[role].diceSpent = [false, false, false];
        state[role].selectedDice = [];
        state[role].modSelf = [0, 0, 0];
        state[role].modOpponent = [0, 0, 0];
        // Persistent initiative: DO NOT clear initiativeRoll (SP values)
        // Clearing dice forces a new roll for the turn.
    }

    state.dice.attacker = [];
    state.dice.defender = [];

    // Persist initiative if it was already established
    if (state.initiative) {
        state.phase = NeuroshimaMeleeDuel.PHASES.POOL_ROLL;
        // Also keep the initiative roll values for reference if needed, 
        // but typically pool roll is next.
    } else {
        state.phase = NeuroshimaMeleeDuel.PHASES.INITIATIVE;
        state.attacker.initiativeRoll = null;
        state.defender.initiativeRoll = null;
    }
    
    state.version += 1;
    await this.update(state);
  }

  async reroll3k20(role) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("rerollMelee3k20", { duelId: this.duelId, role });
    }
    const state = foundry.utils.deepClone(this.state);
    if (!state) return;

    if (state.phase === "initiative" || (state.attacker.initiativeRoll === null || state.defender.initiativeRoll === null)) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeOpposed.ErrorRollInitiativeFirst"));
        return;
    }

    const roll = new Roll("3d20");
    await roll.evaluate();
    const dice = roll.terms[0].results.map(r => r.result);
    
    state.dice[role] = dice;
    state[role].modSelf = [0, 0, 0];
    state[role].modOpponent = [0, 0, 0];
    
    const side = state[role];
    if (!game.settings.get("neuroshima", "doubleSkillAction")) {
        const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
        const effectiveStat = NeuroshimaMeleeDuelResolver.getEffectiveStat(state, role);
        side.modSelf = NeuroshimaMeleeDuel._autoOptimizeDice(dice, effectiveStat, side.skillPoints);
    }

    state.version += 1;
    await this.update(state);
  }

  async update(newState) {
    if (!game.user.isGM) return;
    const combat = this.combat || game.combat;
    if (!combat) return;

    const duels = foundry.utils.deepClone(combat.getFlag("neuroshima", "duels") || {});
    duels[this.duelId] = newState;
    await combat.setFlag("neuroshima", "duels", duels);
    
    // Notify trackers
    const tracker = Object.values(foundry.applications.instances).find(a => a instanceof game.neuroshima.NeuroshimaMeleeDuelTracker && a.duelId === this.duelId);
    if (tracker) tracker.render(true);
  }
}
