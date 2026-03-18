import { NEUROSHIMA } from "../config.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Aplikacja V2 obsługująca interfejs walki wręcz (Melee Duel).
 */
export class MeleeCombatApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(duelId, options = {}) {
    super(options);
    this.duelId = duelId;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    window: {
      title: "NEUROSHIMA.MeleeDuel.Title",
      resizable: true,
      icon: "fas fa-swords"
    },
    position: {
      width: 820,
      height: 850
    },
    actions: {
      rollPool: function(event, target) {
          const actorId = target.dataset.actorId;
          return this.constructor._onRollPool(event, target, this.duelId);
      },
      selectDice: function(event, target) {
          return this.constructor._onSelectDice(event, target, this.duelId);
      },
      modifyDie: function(event, target) {
          return this.constructor._onModifyDie(event, target, this.duelId);
      },
      confirmSelection: function(event, target) {
          return this.constructor._onConfirmSelection(event, target, this.duelId);
      },
      changeWeapon: function(event, target) {
          return this.constructor._onChangeWeapon(event, target, this.duelId);
      },
      freeDefense: function(event, target) {
          return this.constructor._onFreeDefense(event, target, this.duelId);
      }
    }
  };

  static PARTS = {
    main: {
        template: "systems/neuroshima/templates/apps/melee-combat-app.hbs"
    }
  };

  /**
   * Rejestruje hooki dla aplikacji.
   */
  static registerHooks() {
      Hooks.on("updateCombat", (combat, updates, options, userId) => {
          // Re-renderuj wszystkie aktywne aplikacje walki wręcz korzystając z rejestru instancji ApplicationV2
          for (const app of foundry.applications.instances.values()) {
              if (app.id.startsWith("melee-combat-app-")) {
                  game.neuroshima.log("Odświeżanie MeleeCombatApp (V2) po aktualizacji Combat");
                  app.render();
              }
          }
      });
  }

  /** @override */
  get id() {
    return `melee-combat-app-${this.duelId}`;
  }

  /** @override */
  async _prepareContext(options) {
    const combat = game.combat;
    const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
    // Deep clone to avoid polluting the flag reference in cache
    const meleeData = foundry.utils.deepClone(duels[this.duelId] || { active: false });
    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");

    if (meleeData.active) {
        // Przeliczenie pozostałych punktów umiejętności
        meleeData.attacker.skillPointsRemaining = (meleeData.attacker.skillValue || 0) - (meleeData.attacker.skillSpent || 0);
        meleeData.defender.skillPointsRemaining = (meleeData.defender.skillValue || 0) - (meleeData.defender.skillSpent || 0);

        // Kara do Zręczności za liczbę przeciwników (0 przy 1 przeciwniku, -X przy wielu)
        const multiOpponentPenalty = meleeData.multiOpponents?.length > 0 ? (1 + meleeData.multiOpponents.length) : 0;
        meleeData.attacker.currentPenalty = meleeData.attacker.id === meleeData.centralId ? multiOpponentPenalty : 0;
        meleeData.defender.currentPenalty = meleeData.defender.id === meleeData.centralId ? multiOpponentPenalty : 0;
        
        // Calculate effective targets including maneuvers and multi-opponent penalty
        const { NeuroshimaDice } = game.neuroshima;
        
        const calculateEffectiveTarget = (role) => {
            const data = meleeData[role];
            const otherRole = role === "attacker" ? "defender" : "attacker";
            const otherData = meleeData[otherRole];
            
            // Pobierz bazowe parametry zapisane przy rzucie puli
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

            // Uwzględnienie bonusów z broni (jeśli w trybie atrybutu)
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
            
            // Multi-opponent penalty only for the central participant
            if (data.id === meleeData.centralId) {
                target -= multiOpponentPenalty;
            }
            
            return target;
        };

        meleeData.attacker.effectiveTarget = calculateEffectiveTarget("attacker");
        meleeData.defender.effectiveTarget = calculateEffectiveTarget("defender");

        // Pobranie danych o broniach i przygotowanie kości do wyświetlenia
        for (const role of ["attacker", "defender"]) {
            const data = meleeData[role];
            const actorDoc = fromUuidSync(data.id);
            const actor = actorDoc?.actor || actorDoc;
            
            // Pobierz wszystkie wyekwipowane bronie białe aktora
            if (actor) {
                data.meleeWeapons = actor.items.filter(i => i.type === "weaponMelee" && i.system.equipped);
            }

            if (data.weaponId) {
                const weapon = actor?.items.get(data.weaponId);
                if (weapon) {
                    data.weaponName = weapon.name;
                    data.weaponImg = weapon.img;
                }
            }

            // Przekształcamy surowe rzuty (liczby) na obiekty z informacją o sukcesie
            if (data.dice && data.dice.length > 0) {
                data.dice = data.dice.map(val => {
                    const rawValue = typeof val === 'object' ? val.value : val;
                    return {
                        value: rawValue,
                        success: rawValue <= data.effectiveTarget && rawValue !== 20
                    };
                });
            }
        }
    }

    // Pobranie danych dodatkowych napastników (multi-opponent)
    const multiOpponentsData = [];
    if (meleeData.multiOpponents?.length) {
        for (const id of meleeData.multiOpponents) {
            const actorDoc = fromUuidSync(id);
            const actor = actorDoc?.actor || actorDoc;
            if (actor) {
                multiOpponentsData.push({
                    id: actor.uuid,
                    name: actor.name,
                    img: actor.img
                });
            }
        }
    }

    const attackerDoc = fromUuidSync(meleeData.attacker?.id);
    const attackerActor = attackerDoc?.actor || attackerDoc;
    const defenderDoc = fromUuidSync(meleeData.defender?.id);
    const defenderActor = defenderDoc?.actor || defenderDoc;

    const attackerInit = meleeData.attacker?.initiative || 0;
    const defenderInit = meleeData.defender?.initiative || 0;

    return {
        duelId: this.duelId,
        meleeData,
        multiOpponentsData,
        doubleSkill,
        isGM: game.user.isGM,
        isAttacker: game.user.character?.uuid === meleeData.attacker?.id || attackerActor?.isOwner,
        isDefender: game.user.character?.uuid === meleeData.defender?.id || defenderActor?.isOwner,
        attackerOwned: attackerActor?.isOwner,
        defenderOwned: defenderActor?.isOwner,
        attackerHasInit: attackerInit > defenderInit,
        defenderHasInit: defenderInit > attackerInit,
        canResolve: game.user.isGM && meleeData.phase === "segments",
        config: CONFIG.NEUROSHIMA
    };
  }

  /**
   * Wykonuje rzut darmową obroną przeciwko dodatkowemu napastnikowi.
   */
  static async _onFreeDefense(event, target, duelId) {
    const attackerId = target.dataset.actorId;
    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
    await NeuroshimaMeleeCombat.rollFreeDefense(null, attackerId, 1, duelId);
  }

  /**
   * Zmienia aktywną broń w starciu.
   */
  static async _onChangeWeapon(event, target, duelId) {
    const actorUuid = target.dataset.actorId;
    const newWeaponId = target.value;
    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
    await NeuroshimaMeleeCombat.changeWeapon(actorUuid, duelId, newWeaponId);
  }

  /**
   * Wykonuje rzut puli 3k20 dla aktora.
   */
  static async _onRollPool(event, target, duelId) {
    const actorUuid = target.dataset.actorId;
    const combat = game.combat;
    const duels = combat?.getFlag("neuroshima", "meleeDuels") || {};
    const meleeData = duels[duelId];
    if (!meleeData) return;

    game.neuroshima.log("MeleeCombatApp | _onRollPool", { actorUuid, duelId });

    const isAttacker = meleeData.attacker.id === actorUuid;
    const role = isAttacker ? "attacker" : "defender";
    
    const actorDoc = fromUuidSync(actorUuid);
    const actor = actorDoc?.actor || actorDoc;
    const weaponId = meleeData[role].weaponId;
    const weapon = actor?.items.get(weaponId);

    game.neuroshima.log(`Rola: ${role}, Broń ID: ${weaponId}`, { weapon });

    // Jeśli brak broni lub użytkownik chce gołego rzutu, używamy standardowej metody
    if (!actor || !weapon) {
        game.neuroshima.warn("Brak wybranej broni dla starcia. Wykonuję rzut podstawowy.");
        const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
        await NeuroshimaMeleeCombat.rollPool(actorUuid, duelId);
        return;
    }

    const { NeuroshimaWeaponRollDialog } = await import("./weapon-roll-dialog.js");
    const dialog = new NeuroshimaWeaponRollDialog({
        actor: actor,
        weapon: weapon,
        rollType: "melee",
        isPoolRoll: true,
        onRoll: async (rollResult) => {
            game.neuroshima.log("Otrzymano wynik rzutu puli z dialogu:", rollResult);
            const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
            // Przekazujemy wyniki kości z dialogu do logiki walki wręcz
            await NeuroshimaMeleeCombat.setPoolRollResults(duelId, actorUuid, rollResult);
        }
    });
    dialog.render(true);
  }

  /**
   * Wybiera kości na dany segment.
   */
  static async _onSelectDice(event, target, duelId) {
    const role = target.dataset.role;
    const index = parseInt(target.dataset.index);
    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
    await NeuroshimaMeleeCombat.selectDie(role, index, duelId);
  }

  /**
   * Modyfikuje wynik na kości (Umiejętność / Psucie).
   */
  static async _onModifyDie(event, target, duelId) {
    const amount = parseInt(target.dataset.amount);
    const dieIndex = parseInt(target.dataset.index);
    const role = target.dataset.role;
    event.stopPropagation();
    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
    await NeuroshimaMeleeCombat.modifyDie(role, dieIndex, amount, duelId);
  }

  /**
   * Zatwierdza wybór kości.
   */
  static async _onConfirmSelection(event, target, duelId) {
    const role = target.dataset.role;
    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
    await NeuroshimaMeleeCombat.confirmSelection(role, duelId);
  }
}
