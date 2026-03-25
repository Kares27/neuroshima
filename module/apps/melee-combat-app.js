import { MeleeStore } from "../combat/melee-store.js";
/**
 * @file melee-combat-app.js
 * @description ApplicationV2 UI for the Neuroshima 1.5 Melee Combat system.
 *
 * ## Architecture Overview
 *
 * The melee system uses a shared-state model stored in Combat flags via MeleeStore.
 * All state mutations go through MeleeTurnService (async, socketlib-backed for GM authority).
 *
 * ### Key files
 * - `melee-encounter.js`    — Encounter lifecycle (create/join/leave/end)
 * - `melee-store.js`        — Persistence layer (Combat flags + socketlib)
 * - `melee-turn-service.js` — All state transitions (turns, segments, pool, targets, skill allocation)
 * - `melee-resolution.js`   — Exchange resolution logic (successes, damage, takeover)
 * - `melee-combat-app.js`   — ApplicationV2 UI (this file)
 *
 * ### Combat flow per turn
 * 1. **awaiting-pool-rolls** — Each participant rolls their 3k20 pool via `_onOpenPoolDialog`.
 *    The pool roll dialog (`NeuroshimaWeaponRollDialog`) respects `doubleSkillAction` setting:
 *    - OFF: skill auto-applied (`_evaluateClosedTest`), `modifiedPool` stored
 *    - ON:  raw dice stored, skill budget tracked for manual allocation in the fighter card
 * 2. **target-selection** (multi-fight only) — Participants pick opponents via fighter card dropdowns.
 *    In 1v1, targets are auto-assigned and this phase is skipped.
 * 3. **primary-attack-selection** — Initiative holder selects dice to attack with (1–3 dice = 1–3 segments).
 * 4. **primary-defense-selection** — Defender selects the same number of dice to defend.
 * 5. **MeleeResolution.resolvePrimaryExchange** — Auto-resolves: compares successes, applies damage,
 *    handles takeover, runs extra attacks (crowding), then advances or ends the segment.
 *
 * ### DoubleSkillAction (combat setting)
 * When enabled, players can spend their skill points to:
 * - Reduce their own dice values (▼ button per die)
 * - Increase an opponent's dice values (↑ button per die — spoils their roll)
 * Allocations are tracked per participant in `selfReductions`, `opponentGains`, `spentOnOpponent`.
 * A reset button per fighter card lets the player undo all their allocations.
 *
 * ### Weapon selection
 * Before rolling the pool, players can switch weapon via dropdown.
 * Changing weapon mid-dialog automatically closes the open pool roll dialog.
 * Once the pool is rolled, the weapon is locked (shown as plain text).
 *
 * ### Segment/Turn controls (GM only)
 * Prev/Next segment buttons (arrow icons) move between segments 1–3.
 * Prev/Next turn buttons (step icons) skip or rewind full turns.
 * Advancing a turn resets all pools and starts a fresh target-selection/pool phase.
 */

import { MeleeEncounter } from "../combat/melee-encounter.js";
import { MeleeTurnService } from "../combat/melee-turn-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Melee Encounter Application (ApplicationV2) — arena view for Neuroshima 1.5 melee combat.
 * Players drive the combat through fighter cards; GM has segment/turn controls and full visibility.
 */
export class MeleeCombatApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(encounterId, options = {}) {
    super(options);
    this.encounterId = encounterId;
    /** @type {Map<string, import("./weapon-roll-dialog.js").NeuroshimaWeaponRollDialog>} */
    this._openPoolDialogs = new Map();
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    window: {
      title: "NEUROSHIMA.MeleeDuel.Title",
      resizable: true,
      icon: "fas fa-swords"
    },
    position: {
      width: 780,
      height: 540
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
      },
      nextTurn: function() {
        return MeleeTurnService.startNewTurn(this.encounterId);
      },
      prevTurn: function() {
        return MeleeTurnService.prevTurn(this.encounterId);
      },
      prevSegment: function() {
        const encounter = MeleeStore.getEncounter(this.encounterId);
        if (!encounter) return;
        return MeleeTurnService.setSegment(this.encounterId, (encounter.turnState.segment || 1) - 1);
      },
      nextSegment: function() {
        const encounter = MeleeStore.getEncounter(this.encounterId);
        if (!encounter) return;
        return MeleeTurnService.setSegment(this.encounterId, (encounter.turnState.segment || 1) + 1);
      },
      spendSkillSelf: function(event, target) {
        const { id, index } = target.dataset;
        return MeleeTurnService.allocateSkill(this.encounterId, id, id, parseInt(index), 1);
      },
      unspendSkillSelf: function(event, target) {
        const { id, index } = target.dataset;
        return MeleeTurnService.allocateSkill(this.encounterId, id, id, parseInt(index), -1);
      },
      spendSkillOnOpponent: function(event, target) {
        const { spenderId, targetId, index } = target.dataset;
        return MeleeTurnService.allocateSkill(this.encounterId, spenderId, targetId, parseInt(index), 1);
      },
      unspendSkillOnOpponent: function(event, target) {
        const { spenderId, targetId, index } = target.dataset;
        return MeleeTurnService.allocateSkill(this.encounterId, spenderId, targetId, parseInt(index), -1);
      },
      resetSkillAllocation: function(event, target) {
        return MeleeTurnService.resetSkillAllocation(this.encounterId, target.dataset.id);
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
      p.isOwnerOrGM = p.isOwner || game.user.isGM;

      // Melee weapon list for weapon dropdown (owner/GM only)
      if (p.isOwnerOrGM && actor) {
        const meleeItems = (actor.items || []).filter(i =>
          i.type === "weapon" && i.system.weaponType === "melee" && i.system.equipped
        );
        const weaponMap = new Map(meleeItems.map(w => [w.id, { id: w.id, name: w.name, isCurrent: w.id === p.weaponId }]));
        if (!weaponMap.has(p.weaponId) && weapon) {
          weaponMap.set(p.weaponId, { id: p.weaponId, name: weapon.name, isCurrent: true });
        }
        p.meleeWeapons = [...weaponMap.values()].sort((a, b) => b.isCurrent - a.isCurrent);
      } else {
        p.meleeWeapons = [];
      }

      // Target & crowding
      const targetId = context.primaryTargets[pId];
      p.targetName = context.participants[targetId]?.name || "";
      const crowd = context.crowding[pId];
      p.isCrowded = crowd?.opponentCount > 1;
      p.dexPenalty = crowd?.dexPenalty || 0;

      // Effective target value — use != null to avoid falsy-zero issues
      const atkSnap = p.attackTargetSnapshot != null ? p.attackTargetSnapshot : (p.targetValue ?? 10);
      const defSnap = p.defenseTargetSnapshot != null ? p.defenseTargetSnapshot : (p.targetValue ?? 10);
      p.attackTarget = atkSnap - p.dexPenalty;
      p.defenseTarget = defSnap - p.dexPenalty;
      // During pool-roll and target-selection phases, colour chips against attackTarget
      // (matches what the dialog preview shows to the player)
      const isAttacker = pId === exchange.attackerId ||
        (phase === "primary-attack-selection" && pId === selectionTurn) ||
        phase === "awaiting-pool-rolls" ||
        phase === "target-selection";
      p.currentEffectiveTarget = isAttacker ? p.attackTarget : p.defenseTarget;

      // Per-participant active state
      p.isActiveSide = pId === selectionTurn;

      // Die selection indices
      p.selectedDiceIndices = [];
      if (phase === "primary-attack-selection" && pId === selectionTurn) {
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

      // Effective pool display (uses modifiedPool when doubleSkill OFF, raw pool when ON)
      const doubleSkill = game.settings.get("neuroshima", "doubleSkillAction");
      if (doubleSkill && phase === "awaiting-pool-rolls" && p.pool.length > 0) {
        p.effectivePool = p.pool.map((v, i) => {
          const reduction = (p.selfReductions || [])[i] || 0;
          const gain = (p.opponentGains || [])[i] || 0;
          const effective = v - reduction + gain;
          // For doubleSkill allocation phase: success is determined live against current target
          const isNat20 = v === 20;
          const isSuccess = !isNat20 && effective <= p.currentEffectiveTarget;
          return { raw: v, effective, reduction, gain, isSuccess, isNat20 };
        });
        const selfSpent = (p.selfReductions || []).reduce((a, b) => a + b, 0);
        const oppSpent = Object.values(p.spentOnOpponent || {})
          .reduce((sum, arr) => sum + arr.reduce((a, b) => a + b, 0), 0);
        p.skillRemaining = (p.skillBudget || 0) - selfSpent - oppSpent;
        p.isAllocationPhase = p.isOwner && p.pool.length > 0;
        const opponents = Object.values(context.participants).filter(
          opp => opp.team !== p.team && opp.isActive
        );
        const myOwnerOpponents = opponents.filter(opp => opp.isOwner);
        p.hasSpenderAvailable = myOwnerOpponents.some(opp => {
          const selfS = (opp.selfReductions || []).reduce((a, b) => a + b, 0);
          const oppS = Object.values(opp.spentOnOpponent || {})
            .reduce((s, arr) => s + arr.reduce((a, b) => a + b, 0), 0);
          return (opp.skillBudget || 0) - selfS - oppS > 0;
        });
        p.mySpenderIds = opponents.filter(opp => opp.isOwner).map(opp => ({
          spenderId: opp.id,
          remaining: (() => {
            const ss = (opp.selfReductions || []).reduce((a, b) => a + b, 0);
            const os = Object.values(opp.spentOnOpponent || {}).reduce((s, arr) => s + arr.reduce((a, b) => a + b, 0), 0);
            return (opp.skillBudget || 0) - ss - os;
          })()
        })).filter(s => s.remaining > 0);
      } else {
        const mp = p.modifiedPool;
        const dr = p.dieResults;
        p.effectivePool = (p.pool || []).map((v, i) => {
          const effective = mp && mp[i] !== undefined ? mp[i] : v;
          // Prefer stored per-die flags from the roll (exact match to chat card).
          // Fall back to live comparison if dieResults not available.
          const isNat20  = v === 20;
          const isSuccess = dr
            ? (dr[i]?.isSuccess ?? false)
            : (!isNat20 && effective <= p.currentEffectiveTarget);
          return { raw: v, effective, reduction: 0, gain: 0, isSuccess, isNat20 };
        });
        p.skillRemaining = 0;
        p.isAllocationPhase = false;
        p.hasSpenderAvailable = false;
        p.mySpenderIds = [];
      }
      context.doubleSkillEnabled = doubleSkill;

      // Flags for actions
      p.canRollPool = p.isOwner && p.pool.length === 0 && phase === "awaiting-pool-rolls";
      p.canChooseTarget = p.isOwner && phase === "target-selection" && selectionTurn === pId;
      if (p.canChooseTarget) {
        const opposingTeam = p.team === "A" ? "B" : "A";
        p.availableTargets = (context.teams[opposingTeam] || [])
          .map(id => context.participants[id])
          .filter(opp => opp?.isActive);
      }
      // Concurrent target dropdown (multi-fight, target-selection phase)
      const isMultiFight = (Object.values(context.participants).filter(pp => pp.isActive).length) > 2;
      if (phase === "target-selection" && p.isOwner && p.isActive && isMultiFight) {
        const opposingTeam = p.team === "A" ? "B" : "A";
        p.canChooseTargetDropdown = true;
        p.availableTargets = (context.teams[opposingTeam] || [])
          .map(id => context.participants[id])
          .filter(opp => opp?.isActive);
        p.currentTargetId = context.primaryTargets[pId] || "";
      } else {
        p.canChooseTargetDropdown = false;
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
      const myUnrolled = myParticipants.filter(p => p.pool.length === 0);
      if (myUnrolled.length > 0) {
        return { type: "waiting", message: game.i18n.localize("NEUROSHIMA.MeleeDuel.Hint.RollYourDice"), urgent: true };
      }
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
   * Opens the 3k20 pool roll dialog with maneuver/bonus selection.
   * Tracks the open dialog so it can be closed if the weapon is changed mid-dialog.
   */
  async _onOpenPoolDialog(participantId) {
    const encounter = MeleeStore.getEncounter(this.encounterId);
    const p = encounter?.participants[participantId];
    if (!p) return;

    // Close any previously open dialog for this participant
    this._openPoolDialogs.get(participantId)?.close();

    const doc = fromUuidSync(p.actorUuid);
    const actor = doc?.actor || doc;
    const weapon = actor?.items.get(p.weaponId);

    const { NeuroshimaWeaponRollDialog } = await import("./weapon-roll-dialog.js");
    const dialog = new NeuroshimaWeaponRollDialog({
      actor,
      weapon,
      rollType: "melee",
      isPoolRoll: true,
      onClose: () => {
        if (this._openPoolDialogs.get(participantId) === dialog) {
          this._openPoolDialogs.delete(participantId);
        }
      },
      onRoll: async (rollResult) => {
        this._openPoolDialogs.delete(participantId);
        if (!rollResult) return;
        const toNum = r => typeof r === "object" ? (r.value ?? r.result ?? r.original ?? Number(r)) : Number(r);
        const results = (rollResult.results || []).map(toNum);
        const modifiedPool = (rollResult.modifiedResults || []).map(r =>
          typeof r === "object" ? toNum({ value: r.modified ?? r.original }) : toNum(r)
        );
        // Per-die success flags from the roll — matches what the chat card shows.
        // isNat20 is stored separately so nat-20 dice always show as failure even
        // if skill reduced their value below the target.
        const dieResults = (rollResult.modifiedResults || []).map(r => ({
          isSuccess: typeof r === "object" ? (r.isSuccess ?? false) : false,
          isNat20:  typeof r === "object" ? (r.original === 20) : false
        }));
        const skillBudget = rollResult.skill ?? 0;
        const maneuver = rollResult.maneuver || "none";
        const tempoLevel = rollResult.tempoLevel || 0;
        const attributeBonus = rollResult.attributeBonus || 0;
        const rollTarget = typeof rollResult.target === "number" ? rollResult.target : null;
        const meleeAction = rollResult.meleeAction || "attack";
        await MeleeTurnService.setPool(this.encounterId, participantId, results, maneuver, tempoLevel, attributeBonus, modifiedPool, skillBudget, rollTarget, meleeAction, dieResults);
      }
    });
    this._openPoolDialogs.set(participantId, dialog);
    dialog.render(true);
  }

  /**
   * Attach change listeners for target and weapon selects after render.
   * @override
   */
  _onRender(context, options) {
    this.element.querySelectorAll(".fc-target-select").forEach(sel => {
      sel.addEventListener("change", ev => {
        const participantId = ev.currentTarget.dataset.participantId;
        const targetId = ev.currentTarget.value;
        if (participantId && targetId) {
          MeleeTurnService.setTarget(this.encounterId, participantId, targetId);
        }
      });
    });
    this.element.querySelectorAll(".fc-weapon-select").forEach(sel => {
      sel.addEventListener("change", ev => {
        const participantId = ev.currentTarget.dataset.participantId;
        const weaponId = ev.currentTarget.value;
        if (participantId && weaponId) {
          // Close any open pool dialog for this participant when weapon changes
          const openDialog = this._openPoolDialogs.get(participantId);
          if (openDialog) {
            openDialog.close();
            this._openPoolDialogs.delete(participantId);
          }
          MeleeTurnService.setWeapon(this.encounterId, participantId, weaponId);
        }
      });
    });
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
