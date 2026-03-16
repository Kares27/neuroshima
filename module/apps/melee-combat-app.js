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
      width: 800,
      height: 600
    },
    actions: {
      rollPool: function(event, target) {
          const actorId = target.dataset.actorId;
          return this.constructor._onRollPool(event, target, this.duelId);
      },
      selectDice: function(event, target) {
          return this.constructor._onSelectDice(event, target, this.duelId);
      },
      resolveSegment: function(event, target) {
          return this.constructor._onResolveSegment(event, target, this.duelId);
      },
      modifyDie: function(event, target) {
          return this.constructor._onModifyDie(event, target, this.duelId);
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
          // Re-renderuj wszystkie aktywne aplikacje walki wręcz
          Object.values(ui.windows).forEach(app => {
              if (app instanceof MeleeCombatApp) {
                  app.render();
              }
          });
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
    const meleeData = duels[this.duelId] || { active: false };
    const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");

    if (meleeData.active) {
        // Przeliczenie pozostałych punktów umiejętności
        meleeData.attacker.skillPointsRemaining = (meleeData.attacker.skillValue || 0) - (meleeData.attacker.skillSpent || 0);
        meleeData.defender.skillPointsRemaining = (meleeData.defender.skillValue || 0) - (meleeData.defender.skillSpent || 0);

        // Kara do Zręczności obrońcy za liczbę przeciwników (Główny + Dodatkowi)
        const opponentCount = 1 + (meleeData.multiOpponents?.length || 0);
        meleeData.defender.currentPenalty = opponentCount;
        meleeData.defender.effectiveTarget = meleeData.defender.targetValue - opponentCount;
        meleeData.attacker.effectiveTarget = meleeData.attacker.targetValue;

        // Pobranie danych o broniach
        for (const role of ["attacker", "defender"]) {
            const data = meleeData[role];
            if (data.weaponId) {
                const actorDoc = fromUuidSync(data.id);
                const actor = actorDoc?.actor || actorDoc;
                const weapon = actor?.items.get(data.weaponId);
                if (weapon) {
                    data.weaponName = weapon.name;
                    data.weaponImg = weapon.img;
                }
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
   * Rozstrzyga segment tury.
   */
  static async _onResolveSegment(event, target, duelId) {
    game.neuroshima.log("Rozstrzyganie segmentu dla starcia:", duelId);
    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
    await NeuroshimaMeleeCombat.resolveSegment(duelId);
  }
}
