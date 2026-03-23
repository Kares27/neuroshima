import { MeleeStore } from "../combat/melee-store.js";
import { MeleeEncounter } from "../combat/melee-encounter.js";
import { MeleeTurnService } from "../combat/melee-turn-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Melee Encounter Application (ApplicationV2) — simplified arena view.
 * Players drive the combat; GM only needs Reset and End controls.
 */
export class MeleeCombatApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(encounterId, options = {}) {
    super(options);
    this.encounterId = encounterId;
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    window: {
      title: "NEUROSHIMA.MeleeDuel.Title",
      resizable: true,
      icon: "fas fa-swords"
    },
    position: {
      width: 640,
      height: 520
    },
    actions: {
      openPoolDialog: function(event, target) {
        return this._onOpenPoolDialog(target.dataset.id);
      },
      selectTarget: function(event, target) {
        return MeleeTurnService.setTarget(this.encounterId, target.dataset.id, target.dataset.targetId);
      },
      selectDie: function(event, target) {
        return MeleeTurnService.selectDie(this.encounterId, target.dataset.id, parseInt(target.dataset.index));
      },
      confirmAttack: function(event, target) {
        return MeleeTurnService.confirmAttack(this.encounterId, target.dataset.id);
      },
      confirmDefense: function(event, target) {
        return MeleeTurnService.confirmDefense(this.encounterId, target.dataset.id);
      },
      endEncounter: function() {
        return MeleeEncounter.end(this.encounterId);
      },
      resetTurn: function() {
        return MeleeTurnService.startNewTurn(this.encounterId);
      }
    }
  };

  static PARTS = {
    main: {
      template: "systems/neuroshima/templates/apps/melee/melee-app.hbs"
    }
  };

  /** @override */
  get id() {
    return `melee-encounter-${this.encounterId}`;
  }

  /** @override */
  async _prepareContext(options) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    if (!encounter) return { active: false };

    const context = foundry.utils.deepClone(encounter);
    context.isGM = game.user.isGM;

    const phase = context.turnState.phase;
    const selectionTurn = context.turnState.selectionTurn;
    const exchange = context.currentExchange;

    // ── Enrich participants ────────────────────────────────────────────────
    for (const pId in context.participants) {
      const p = context.participants[pId];
      p.id = pId;
      const doc = fromUuidSync(p.actorUuid);
      const actor = doc?.actor || doc;
      p.isOwner = actor?.isOwner;

      const weapon = actor?.items.get(p.weaponId);
      p.weaponName = weapon?.name || game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed");

      // Target & crowding
      const targetId = context.primaryTargets[pId];
      p.targetName = context.participants[targetId]?.name || "";
      const crowd = context.crowding[pId];
      p.isCrowded = crowd?.opponentCount > 1;
      p.dexPenalty = crowd?.dexPenalty || 0;

      // Effective target value
      p.attackTarget = (p.attackTargetSnapshot || p.targetValue || 10) - p.dexPenalty;
      p.defenseTarget = (p.defenseTargetSnapshot || p.targetValue || 10) - p.dexPenalty;
      const isAttacker = pId === exchange.attackerId ||
        (phase === "primary-attack-selection" && pId === selectionTurn);
      p.currentEffectiveTarget = isAttacker ? p.attackTarget : p.defenseTarget;

      // Die selection indices
      p.selectedDiceIndices = [];
      if (phase === "primary-attack-selection" && pId === context.turnState.initiativeOwnerId) {
        p.selectedDiceIndices = exchange.attackerSelectedDice || [];
      } else if (phase === "primary-defense-selection" && pId === selectionTurn) {
        p.selectedDiceIndices = exchange.defenderSelectedDice || [];
      } else if (pId === exchange.attackerId) {
        p.selectedDiceIndices = exchange.attackerSelectedDice || [];
      } else if (pId === exchange.defenderId) {
        p.selectedDiceIndices = exchange.defenderSelectedDice || [];
      }

      // Damage preview from weapon
      const pWeapon = actor?.items.get(p.weaponId);
      p.damageMeleePreview = {
        s1: pWeapon?.system?.damageMelee1 || "D",
        s2: pWeapon?.system?.damageMelee2 || "L",
        s3: pWeapon?.system?.damageMelee3 || "C"
      };

      // Flags for actions
      p.canRollPool = p.isOwner && p.pool.length === 0 && phase === "awaiting-pool-rolls";
      p.canChooseTarget = p.isOwner && phase === "target-selection" && selectionTurn === pId;
      if (p.canChooseTarget) {
        const opposingTeam = p.team === "A" ? "B" : "A";
        p.availableTargets = (context.teams[opposingTeam] || [])
          .map(id => context.participants[id])
          .filter(opp => opp?.isActive);
      }
      p.canConfirmAttack = p.isOwner && phase === "primary-attack-selection" &&
        selectionTurn === pId && exchange.attackerSelectedDice.length > 0;
      p.pendingAttackStrength = exchange.attackerSelectedDice.length;
      p.canConfirmDefense = p.isOwner && phase === "primary-defense-selection" &&
        selectionTurn === pId &&
        exchange.defenderSelectedDice.length === exchange.declaredDiceCount;

      game.neuroshima?.log(`Participant ${p.name}:`, { pId, selected: p.selectedDiceIndices, phase });
    }

    // ── Teams sorted by initiative ────────────────────────────────────────
    const sortByInitiative = (a, b) => (b.initiative || 0) - (a.initiative || 0);
    context.teamsData = {
      A: (context.teams.A || []).map(id => context.participants[id]).filter(Boolean).sort(sortByInitiative),
      B: (context.teams.B || []).map(id => context.participants[id]).filter(Boolean).sort(sortByInitiative)
    };

    // ── Primary fighters (for arena view) ────────────────────────────────
    context.fA = context.teamsData.A[0] || null;
    context.fB = context.teamsData.B[0] || null;
    if (context.fA) context.fA.isActiveSide = context.fA.id === selectionTurn;
    if (context.fB) context.fB.isActiveSide = context.fB.id === selectionTurn;

    // ── Segment progress dots ────────────────────────────────────────────
    const currentSeg = context.turnState.segment || 1;
    context.segmentDots = [1, 2, 3].map(i => ({
      number: i,
      state: i < currentSeg ? "done" : i === currentSeg ? "active" : "pending"
    }));

    // ── Phase label ──────────────────────────────────────────────────────
    context.phaseLabel = this._getPhaseLabel(phase);
    context.initiativeOwnerName = context.participants[context.turnState.initiativeOwnerId]?.name || "---";

    // ── Arena center: declared strength or last result ───────────────────
    context.arenaStrength = exchange.declaredDiceCount || 0;
    const lastResultEntry = [...(context.log || [])]
      .reverse()
      .find(e => ["hit", "block", "takeover", "miss"].includes(e.type));
    if (lastResultEntry && exchange.declaredDiceCount === 0) {
      context.arenaLastResult = this._buildArenaResult(lastResultEntry.type);
    }

    // ── Attack damage preview for arena center ────────────────────────────
    if (exchange.attackerId) {
      const ap = context.participants[exchange.attackerId];
      if (ap) {
        const aDoc = fromUuidSync(ap.actorUuid);
        const aActor = aDoc?.actor || aDoc;
        const aWeapon = aActor?.items.get(ap.weaponId);
        if (aWeapon?.system) {
          const preview = {
            s1: aWeapon.system.damageMelee1 || "D",
            s2: aWeapon.system.damageMelee2 || "L",
            s3: aWeapon.system.damageMelee3 || "C"
          };
          const key = `s${exchange.declaredDiceCount}`;
          context.currentDamageLabel = preview[key] || "";
          context.attackDamagePreview = preview;
        }
      }
    }

    // ── Action bar for the local user ────────────────────────────────────
    context.actionBar = this._buildActionBar(context, phase, exchange);

    return context;
  }

  /**
   * Returns a short phase label for the top bar.
   * @private
   */
  _getPhaseLabel(phase) {
    const map = {
      "awaiting-pool-rolls": game.i18n.localize("NEUROSHIMA.MeleeDuel.Phase.awaiting-pool-rolls"),
      "target-selection": game.i18n.localize("NEUROSHIMA.MeleeDuel.Phase.target-selection"),
      "primary-attack-selection": game.i18n.localize("NEUROSHIMA.MeleeDuel.Phase.primary-attack-selection"),
      "primary-defense-selection": game.i18n.localize("NEUROSHIMA.MeleeDuel.Phase.primary-defense-selection"),
      "primary-ready": game.i18n.localize("NEUROSHIMA.MeleeDuel.Phase.primary-ready"),
      "segment-end": game.i18n.localize("NEUROSHIMA.MeleeDuel.Phase.segment-end")
    };
    return map[phase] || phase;
  }

  /**
   * Builds the arena result object shown in the center between exchanges.
   * @private
   */
  _buildArenaResult(type) {
    const map = {
      hit:      { icon: "fa-explosion",    label: game.i18n.localize("NEUROSHIMA.MeleeDuel.ResultHit"),      cls: "hit" },
      block:    { icon: "fa-shield",       label: game.i18n.localize("NEUROSHIMA.MeleeDuel.ResultBlock"),    cls: "block" },
      takeover: { icon: "fa-bolt",         label: game.i18n.localize("NEUROSHIMA.MeleeDuel.ResultTakeover"), cls: "takeover" },
      miss:     { icon: "fa-circle-xmark", label: game.i18n.localize("NEUROSHIMA.MeleeDuel.ResultMiss"),     cls: "miss" }
    };
    return map[type] || null;
  }

  /**
   * Builds the contextual action bar data for the local user.
   * @private
   */
  _buildActionBar(context, phase, exchange) {
    const myParticipants = Object.values(context.participants).filter(p => p.isOwner && p.isActive);

    if (phase === "awaiting-pool-rolls") {
      const myUnrolled = myParticipants.find(p => p.pool.length === 0);
      if (myUnrolled) return { type: "roll", actorId: myUnrolled.id, urgent: true };
      return { type: "waiting", message: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingPool"), urgent: false };
    }

    if (phase === "target-selection") {
      const myChooser = myParticipants.find(p => p.canChooseTarget);
      if (myChooser) return {
        type: "target",
        actorId: myChooser.id,
        availableTargets: myChooser.availableTargets || [],
        urgent: true
      };
      return { type: "waiting", message: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingTarget"), urgent: false };
    }

    if (phase === "primary-attack-selection") {
      const myAttacker = myParticipants.find(p => p.id === context.turnState.selectionTurn);
      if (myAttacker) {
        const sel = exchange.attackerSelectedDice.length;
        return {
          type: "attack",
          actorId: myAttacker.id,
          selectedCount: sel,
          canConfirm: sel > 0,
          damageTiers: myAttacker.damageMeleePreview,
          urgent: true
        };
      }
      const selName = context.participants[context.turnState.selectionTurn]?.name || "...";
      return { type: "waiting", message: `${selName} ${game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingAttack")}`, urgent: false };
    }

    if (phase === "primary-defense-selection") {
      const myDefender = myParticipants.find(p => p.id === exchange.defenderId && p.id === context.turnState.selectionTurn);
      if (myDefender) {
        const sel = exchange.defenderSelectedDice.length;
        const req = exchange.declaredDiceCount;
        return {
          type: "defense",
          actorId: myDefender.id,
          selectedCount: sel,
          requiredCount: req,
          canConfirm: sel === req,
          urgent: true
        };
      }
      const selName = context.participants[context.turnState.selectionTurn]?.name || "...";
      return { type: "waiting", message: `${selName} ${game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.WaitingDefense")}`, urgent: false };
    }

    return { type: "waiting", message: "", urgent: false };
  }

  /**
   * Returns a status badge for a participant based on current phase.
   * @private
   */
  _getParticipantStatusBadge(p, context) {
    const phase = context.turnState.phase;
    const exchange = context.currentExchange;

    if (!p.isActive) return { label: "Nieaktywny", class: "inactive" };
    if (!p.pool?.length) return { label: "Czeka na rzut", class: "waiting" };
    if (p.id === exchange.attackerId) return { label: "Atakujący", class: "attacker" };
    if (p.id === exchange.defenderId) return { label: "Obrońca", class: "defender" };
    if (p.isCrowded) return { label: "Osaczony", class: "crowded" };
    return { label: "Czeka", class: "waiting" };
  }

  /**
   * Opens the 3k20 pool roll dialog with maneuver selection.
   */
  async _onOpenPoolDialog(participantId) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    const p = encounter?.participants[participantId];
    if (!p) return;

    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    const weapon = actor?.items.get(p.weaponId);

    const { NeuroshimaWeaponRollDialog } = await import("./weapon-roll-dialog.js");
    const dialog = new NeuroshimaWeaponRollDialog({
      actor,
      weapon,
      rollType: "melee",
      isPoolRoll: true,
      onRoll: async (rollResult) => {
        if (!rollResult) return;
        const results = (rollResult.modifiedResults || rollResult.results || rollResult.rawResults || [])
          .map(r => typeof r === "object" ? r.original : r);
        const maneuver = rollResult.maneuver || "none";
        const tempoLevel = rollResult.tempoLevel || 0;
        await MeleeTurnService.setPool(this.encounterId, participantId, results, maneuver, tempoLevel);
      }
    });
    dialog.render(true);
  }

  /**
   * Hook for real-time updates when combat flags change.
   */
  static registerHooks() {
    Hooks.on("updateCombat", (combat, updates, options, userId) => {
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof MeleeCombatApp) {
          const encounter = MeleeStore.getEncounter(app.encounterId);
          if (!encounter) {
            game.neuroshima?.log(`Closing MeleeCombatApp ${app.encounterId} — encounter deleted.`);
            app.close();
          } else {
            app.render();
          }
        }
      }
    });
  }
}
