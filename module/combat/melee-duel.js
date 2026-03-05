import { NeuroshimaMeleeDuelResolver } from "./melee-duel-resolver.js";
import { NEUROSHIMA } from "../config.js";

/**
 * Klasa zarządzająca stanem i logiką starcia w zwarciu (Opposed Melee) przy użyciu Combat Flags.
 * Centralizuje wszystkie operacje na starciu, zapewniając spójność danych między klientami.
 */
export class NeuroshimaMeleeDuel {
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
    const tokenUuid = actor.isToken ? actor.uuid : actor.token?.uuid;
    const tokenId = actor.isToken ? actor.id : actor.token?.id;
    const actorId = actor.id;

    for (const duelId in duels) {
      const duel = duels[duelId];
      if (duel.status === "finished") continue;
      
      const isAttacker = duel.attacker.actorUuid === actorUuid || 
                         duel.attacker.tokenUuid === tokenUuid ||
                         duel.attacker.actorUuid === actorId;

      const isDefender = duel.defender?.actorUuid === actorUuid || 
                         duel.defender?.tokenUuid === tokenUuid ||
                         duel.defender?.actorUuid === actorId;

      const isPotentialTarget = duel.status === "waiting-defender" && 
                                (duel.attackerTargets || []).some(t => 
                                    t.uuid === actorUuid || 
                                    t.id === actorId || 
                                    t.uuid === tokenUuid ||
                                    t.id === tokenId ||
                                    (actor.isToken && actor.token.document && t.uuid === actor.token.document.uuid)
                                );

      if (isAttacker || isDefender || isPotentialTarget) {
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
   * Fabryka: Tworzy nową instancję starcia na podstawie rzutu atakującego.
   * Zapisuje stan w flagach Combata.
   */
  static async createFromAttack(attackerActor, attackRollData, weaponId, targets = []) {
    if (!game.combat) {
        ui.notifications.error(game.i18n.localize("NEUROSHIMA.Warnings.NoCombatActive"));
        return null;
    }

    const duelId = foundry.utils.randomID();
    const dice = attackRollData.rawResults.map(r => typeof r === 'object' ? r.value : r);

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

    const attackerStat = attackRollData.target || 10;
    const attackerSkill = attackRollData.skill || 0;
    let modSelf = [0, 0, 0];

    if (!game.settings.get("neuroshima", "doubleSkillAction")) {
        modSelf = this._autoOptimizeDice(dice, attackerStat, attackerSkill);
    }

    const state = {
      id: duelId,
      status: "waiting-defender",
      phase: "initiative",
      turn: 1,
      currentSegment: 1,
      initiative: null,
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
        name: game.i18n.localize("NEUROSHIMA.MeleeOpposed.WaitingForDefender"), 
        img: "icons/svg/mystery-man.svg",
        stat: 10,
        skillPoints: 0,
        modSelf: [0, 0, 0],
        modOpponent: [0, 0, 0],
        ready: false,
        diceSpent: [false, false, false],
        initiativeRoll: null
      },
      attack: { weaponId, rollData: attackRollData },
      defense: { weaponId: null, rollData: null },
      dice: {
        attacker: dice,
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
   * Pobiera instancję duelu z ID.
   */
  static fromId(duelId, combat = game.combat) {
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
   * Dołącza obrońcę do starcia.
   */
  async joinDefender(defenderActor, defenseRollData, weaponId) {
    const state = foundry.utils.deepClone(this.state);
    if (!state || state.status !== "waiting-defender") return;

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
      img: defenderActor.img || "icons/svg/mystery-man.svg",
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

    state.defense = { weaponId, rollData: defenseRollData };
    state.dice.defender = defenderDiceRaw;
    state.phase = "initiative";
    state.status = "active";
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
            state.phase = "modification";
        } else if (state.defender.initiativeRoll > state.attacker.initiativeRoll) {
            state.initiative = "defender";
            state.phase = "modification";
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
    if (state.phase === "modification" && state.attacker.ready && state.defender.ready) {
        state.phase = "segments";
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
    if (!state || state.phase !== "segments") return;

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
    if (!state || state.phase !== "segments" || state.currentAction || state.initiative !== role) return;

    const side = state[role];
    const selected = side.selectedDice || [];
    
    if (type === "attack") {
        if (selected.length === 0) return;
        const dice = state.dice[role];
        const stat = side.stat;
        const opponentRole = role === "attacker" ? "defender" : "attacker";
        const modsOpponent = state[opponentRole].modOpponent;

        let totalSuccesses = 0;
        for (const i of selected) {
            const val = dice[i] - side.modSelf[i] + modsOpponent[i];
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
    if (!state || state.phase !== "segments" || !state.currentAction) return;

    const action = state.currentAction;
    const responderRole = action.side === "attacker" ? "defender" : "attacker";
    const responder = state[responderRole];

    if (response === "defend") {
        const selected = responder.selectedDice || [];
        if (selected.length !== action.diceIndices.length) {
            ui.notifications.warn(game.i18n.format("NEUROSHIMA.MeleeOpposed.ErrorMustSelectExactDice", { count: action.diceIndices.length }));
            return;
        }

        const dice = state.dice[responderRole];
        const stat = responder.stat;
        const opponentRole = action.side;
        const modsOpponent = state[opponentRole].modOpponent;

        let totalDefenseSuccesses = 0;
        for (const i of selected) {
            const val = dice[i] - responder.modSelf[i] + modsOpponent[i];
            if (val <= stat) totalDefenseSuccesses++;
        }

        for (const i of action.diceIndices) state[action.side].diceSpent[i] = true;
        for (const i of selected) responder.diceSpent[i] = true;

        if (action.power === 0 && totalDefenseSuccesses > 0) {
            state.initiative = responderRole;
            ui.notifications.info(game.i18n.format("NEUROSHIMA.MeleeOpposed.InitiativeTakenBy", { name: responder.name }));
        }

        if (totalDefenseSuccesses < action.power) {
            const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
            const dmg = NeuroshimaMeleeDuelResolver.calculateSegmentDamage(state, action);
            if (dmg) {
                if (!state.segments) state.segments = [{}, {}, {}];
                state.segments[state.currentSegment - 1].result = dmg;
            }
        }
    } else {
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
        state.phase = "resolved";
        const { NeuroshimaMeleeDuelResolver } = await import("./melee-duel-resolver.js");
        state.result = NeuroshimaMeleeDuelResolver.resolve(state);
    }
  }

  async finish() {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("finishMeleeDuel", { duelId: this.duelId });
    }
    const duels = this.combat.getFlag("neuroshima", "duels") || {};
    const newDuels = { ...duels };
    delete newDuels[this.duelId];
    await this.combat.setFlag("neuroshima", "duels", newDuels);
    
    // Explicitly refresh combat tracker
    ui.combat?.render(true);
  }

  async takeoverInitiative() {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("takeoverMeleeInitiative", { duelId: this.duelId });
    }
    const state = foundry.utils.deepClone(this.state);
    if (!state || state.phase !== "segments") return;
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
    state.phase = "initiative";
    state.status = "active";
    state.initiative = null;
    state.currentAction = null;
    state.result = null;
    state.segments = [{ result: null }, { result: null }, { result: null }];
    
    // Reset combatants for new turn
    for (const role of ["attacker", "defender"]) {
        state[role].ready = false;
        state[role].diceSpent = [false, false, false];
        state[role].initiativeRoll = null;
        state[role].selectedDice = [];
        state[role].modOpponent = [0, 0, 0];
        // Keep modSelf if not rerolling, but typically rules say new roll each turn
        // For simplicity, we'll keep the current dice but reset spent status
    }
    
    // However, rules say "At the beginning of each turn, fighters roll 3k20"
    // So we should probably clear the dice to force a reroll
    state.dice.attacker = [];
    state.dice.defender = [];
    
    state.version += 1;
    await this.update(state);
  }

  async reroll3k20(role) {
    if (!game.user.isGM) {
        return game.neuroshima.socket.executeAsGM("rerollMelee3k20", { duelId: this.duelId, role });
    }
    const state = foundry.utils.deepClone(this.state);
    if (!state) return;

    const roll = new Roll("3d20");
    await roll.evaluate();
    const dice = roll.terms[0].results.map(r => r.result);
    
    state.dice[role] = dice;
    state[role].modSelf = [0, 0, 0];
    
    const side = state[role];
    if (!game.settings.get("neuroshima", "doubleSkillAction")) {
        side.modSelf = NeuroshimaMeleeDuel._autoOptimizeDice(dice, side.stat, side.skillPoints);
    }

    state.version += 1;
    await this.update(state);
  }

  async update(newState) {
    if (!game.user.isGM) return;
    const duels = this.combat.getFlag("neuroshima", "duels") || {};
    duels[this.duelId] = newState;
    await this.combat.setFlag("neuroshima", "duels", duels);
    
    // Notify trackers
    const tracker = Object.values(foundry.applications.instances).find(a => a instanceof game.neuroshima.NeuroshimaMeleeDuelTracker && a.duelId === this.duelId);
    if (tracker) tracker.render(true);
  }
}
