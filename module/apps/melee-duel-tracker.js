import { NEUROSHIMA } from "../config.js";
import { NeuroshimaMeleeDuel } from "../combat/melee-duel.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Application V2 dla trackera walki wręcz (Melee Duel).
 * Obsługuje wiele niezależnych instancji starć na raz korzystając z Combat Flags.
 */
export class NeuroshimaMeleeDuelTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @static */
  static instances = new Map();

  constructor(options={}) {
    super(options);
    this.duelId = options.duelId;
  }

  /**
   * Fabryka: Pobiera lub tworzy instancję trackera dla konkretnego pojedynku.
   * @param {string} duelId 
   * @returns {NeuroshimaMeleeDuelTracker}
   */
  static async open(duelId) {
    if (this.instances.has(duelId)) {
        const app = this.instances.get(duelId);
        app.render(true);
        return app;
    }
    const app = new NeuroshimaMeleeDuelTracker({ duelId });
    this.instances.set(duelId, app);
    app.render(true);
    return app;
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["neuroshima", "melee-duel-tracker", "standard-form"],
    position: { width: 550, height: "auto" },
    window: {
      resizable: true,
      minimizable: true,
      controls: [
        {
          icon: "fas fa-sync",
          label: "NEUROSHIMA.Actions.Refresh",
          action: "refresh"
        }
      ]
    },
    actions: {
        refresh: function() { this.render(true); },
        selectManeuver: NeuroshimaMeleeDuelTracker.prototype._onSelectManeuver,
        selectDie: NeuroshimaMeleeDuelTracker.prototype._onSelectDie,
        reroll3k20: NeuroshimaMeleeDuelTracker.prototype._onRollPool,
        rollPool: NeuroshimaMeleeDuelTracker.prototype._onRollPool,
        rollInitiative: NeuroshimaMeleeDuelTracker.prototype._onRollInitiative,
        modDie: NeuroshimaMeleeDuelTracker.prototype._onModDie,
        toggleReady: NeuroshimaMeleeDuelTracker.prototype._onToggleReady,
        declareAction: NeuroshimaMeleeDuelTracker.prototype._onDeclareAction,
        selectDie: NeuroshimaMeleeDuelTracker.prototype._onSelectDie,
        respondAction: NeuroshimaMeleeDuelTracker.prototype._onRespondAction,
        takeoverInitiative: NeuroshimaMeleeDuelTracker.prototype._onTakeoverInitiative,
        nextTurn: NeuroshimaMeleeDuelTracker.prototype._onNextTurn,
        finishDuel: NeuroshimaMeleeDuelTracker.prototype._onFinishDuel
    }
  };

  /** @override */
  static PARTS = {
    header: {
        template: "systems/neuroshima/templates/apps/melee-tracker-header.hbs"
    },
    content: {
        template: "systems/neuroshima/templates/apps/melee-tracker-content.hbs"
    },
    footer: {
        template: "systems/neuroshima/templates/apps/melee-tracker-footer.hbs"
    }
  };

  /** @override */
  get title() {
    const duel = this.duel;
    if (!duel) return game.i18n.localize("NEUROSHIMA.MeleeOpposed.Duel");
    const state = duel.state;
    if (!state) return game.i18n.localize("NEUROSHIMA.MeleeOpposed.Duel");
    return `${game.i18n.localize("NEUROSHIMA.MeleeOpposed.Duel")}: ${state.attacker.name} vs ${state.defender.name || '?'}`;
  }

  /**
   * Pobiera instancję logiki pojedynku.
   */
  get duel() {
    return NeuroshimaMeleeDuel.fromId(this.duelId);
  }

  /** @override */
  async _prepareContext(options) {
    const duel = this.duel;
    const state = duel?.state;
    if (!state) {
        this.close();
        return { error: "Duel not found" };
    }

    const isAttacker = game.user.isGM || (state.attacker.actorUuid === game.user.character?.uuid) || (fromUuidSync(state.attacker.actorUuid)?.isOwner);
    const isDefender = game.user.isGM || (state.defender?.actorUuid && (state.defender.actorUuid === game.user.character?.uuid || fromUuidSync(state.defender.actorUuid)?.isOwner));

    const prepareDice = (role) => {
        const side = state[role];
        const dice = state.dice[role] || [];
        const otherRole = role === "attacker" ? "defender" : "attacker";
        const otherSide = state[otherRole];
        return dice.map((v, i) => ({
            index: i,
            original: v,
            modified: v - (side.modSelf?.[i] || 0) + (otherSide?.modOpponent?.[i] || 0),
            spent: side.diceSpent[i],
            selected: side.selectedDice?.includes(i),
            isSuccess: (v - (side.modSelf?.[i] || 0) + (otherSide?.modOpponent?.[i] || 0)) <= side.stat && v !== 20,
            isNat20: v === 20
        }));
    };

    const PHASES = NeuroshimaMeleeDuel.PHASES;
    const canSelect = state.phase === PHASES.SEGMENTS;
    const doubleSkillAction = game.settings.get("neuroshima", "doubleSkillAction");

    const attackerCanRoll = state.phase === PHASES.POOL_ROLL;
    const defenderCanRoll = state.phase === PHASES.POOL_ROLL && state.defender?.actorUuid !== null;

    // Check specifically which side(s) should act
    let attackerActive = false;
    let defenderActive = false;

    // Show active highlighting only after setup is done (both initiative and pool rolls are in)
    // This starts from MODIFICATION (if double skill is on) or SEGMENTS phase.
    const setupComplete = state.dice.attacker.length > 0 && state.dice.defender.length > 0;
    if (setupComplete && (state.phase === PHASES.MODIFICATION || state.phase === PHASES.SEGMENTS)) {
        if (state.phase === PHASES.SEGMENTS) {
            if (state.currentAction) {
                // Defense phase: responder's turn
                const responderRole = state.currentAction.side === "attacker" ? "defender" : "attacker";
                attackerActive = (responderRole === "attacker");
                defenderActive = (responderRole === "defender");
            } else {
                // Declaration phase: initiative holder's turn
                attackerActive = (state.initiative === "attacker");
                defenderActive = (state.initiative === "defender");
            }
        } else if (state.phase === PHASES.MODIFICATION) {
            // Shared phase: active if haven't finished task
            attackerActive = !state.attacker.ready;
            defenderActive = !state.defender.ready;
        }
    }

    const isMyTurn = (attackerActive && isAttacker) || (defenderActive && isDefender);

    return {
      ...state,
      PHASES,
      duelId: this.duelId,
      config: NEUROSHIMA,
      isAttacker,
      isDefender,
      isMyTurn,
      attackerActive,
      defenderActive,
      attackerDice: prepareDice("attacker"),
      defenderDice: prepareDice("defender"),
      attackerCanRoll,
      defenderCanRoll,
      currentSegmentData: state.segments[state.currentSegment - 1],
      isManeuverPhase: false,
      isInitiativePhase: state.phase === PHASES.INITIATIVE,
      isPoolRollPhase: state.phase === PHASES.POOL_ROLL,
      canModify: state.phase === PHASES.MODIFICATION && doubleSkillAction,
      canSelect,
      doubleSkillAction,
      isGM: game.user.isGM
    };
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  async _onSelectManeuver(event, target) {
    const { role, maneuver } = target.dataset;
    await this.duel?.selectManeuver(role, maneuver);
  }

  async _onRollPool(event, target) {
    const role = target.dataset.role;
    await this.duel?.rollPool(role);
  }

  async _onRollInitiative(event, target) {
    const role = target.dataset.role;
    await this.duel?.rollInitiative(role);
  }

  async _onModDie(event, target) {
    const { side, targetSide, index, delta } = target.dataset;
    await this.duel?.modifyDie(side, targetSide, parseInt(index), parseInt(delta));
  }

  async _onToggleReady(event, target) {
    const role = target.dataset.role;
    await this.duel?.toggleReady(role);
  }

  async _onSelectDie(event, target) {
    const { role, index } = target.dataset;
    await this.duel?.selectDie(role, parseInt(index));
  }

  async _onDeclareAction(event, target) {
    const { role, type } = target.dataset;
    await this.duel?.declareAction(role, type);
  }

  async _onRespondAction(event, target) {
    const { response } = target.dataset;
    await this.duel?.respondToAction(response);
  }

  async _onTakeoverInitiative(event, target) {
    await this.duel?.takeoverInitiative();
  }

  async _onNextTurn(event, target) {
    await this.duel?.nextTurn();
  }

  async _onFinishDuel(event, target) {
    await this.duel?.finish();
    this.close();
  }

  /** @override */
  _onClose(options) {
    NeuroshimaMeleeDuelTracker.instances.delete(this.duelId);
    super._onClose(options);
  }
}
