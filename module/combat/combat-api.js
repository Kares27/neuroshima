/**
 * @file combat-api.js
 * @description Neuroshima 1.5 Melee Combat API — implementacja przebudowy.
 *
 * combat.js pozostaje niezmieniony jako implementacja referencyjna.
 * Ten plik definiuje nowe klasy domenowe i lifecycle manager, które są
 * wplecione w combat.js poprzez minimalne punkty integracji.
 *
 * Patrz sekcje 1–14 poniżej (diagnozy i plany zachowane w komentarzach).
 */

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 1: CORE DATA OBJECTS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * DuelContext — single source of truth dla całej wymiany melee.
 *
 * Cienki wrapper na istniejący obiekt `state` z flagi duelCard.
 * `fromFlag(state)` tworzy instancję która JEST statem (te same referencje),
 * dzięki czemu mutacje przez lifecycle wpływają na state bez dodatkowej
 * synchronizacji.
 *
 * RELACJA STATE ↔ DuelContext:
 *   state.activatedMeleePreRollMods  ←→  duel.activatedMods  (ta sama tablica)
 *   state.hits                       ←→  duel.hits
 *   state.initiativeOwnerSide        ←→  duel.initiativeOwnerSide
 *   (wszystkie pozostałe pola są tożsame — DuelContext rozszerza state)
 */
export class DuelContext {

  /**
   * Utwórz DuelContext z obiektu flag (istniejący state z duelCard flagi).
   * Tworzy instancję poprzez Object.assign — ta sama tablica activatedMods
   * co state.activatedMeleePreRollMods.
   *
   * @param {object} flagData  - state z message.getFlag("neuroshima","duelCard")
   * @returns {DuelContext}
   */
  static fromFlag(flagData) {
    const ctx = Object.create(DuelContext.prototype);
    Object.assign(ctx, flagData);
    if (!ctx.activatedMods) {
      ctx.activatedMods = ctx.activatedMeleePreRollMods ?? [];
      ctx.activatedMeleePreRollMods = ctx.activatedMods;
    }
    return ctx;
  }

  /**
   * Serializuj do plain object dla przechowania w fladze.
   * Ponieważ DuelContext.fromFlag przypisuje własności bezpośrednio na instancji,
   * wystarczy skopiować wszystkie własne właściwości z pominięciem _prywatnych.
   *
   * @returns {object}
   */
  toFlag() {
    const out = {};
    for (const key of Object.keys(this)) {
      if (!key.startsWith("_")) out[key] = this[key];
    }
    return out;
  }

  /**
   * Sprawdź czy efekt o danym UUID był aktywowany w pre-roll dialogu.
   * @param {string} effectUuid
   * @returns {boolean}
   */
  isModActivated(effectUuid) {
    return (this.activatedMods ?? []).includes(effectUuid);
  }

  /**
   * Dynamicznie aktywuj efekt (np. z triggera onMeleeHit).
   * Mutuje activatedMods (i tym samym activatedMeleePreRollMods).
   * @param {string} effectUuid
   */
  activateMod(effectUuid) {
    if (!this.activatedMods) this.activatedMods = this.activatedMeleePreRollMods = [];
    if (!this.activatedMods.includes(effectUuid)) this.activatedMods.push(effectUuid);
  }

  /**
   * Usuń aktywację efektu (consume activation).
   * Czyści z activatedMods — bo to ta sama tablica co activatedMeleePreRollMods,
   * jest też automatycznie czyste w state.
   * @param {string} effectUuid
   */
  deactivateMod(effectUuid) {
    if (!this.activatedMods) return;
    const idx = this.activatedMods.indexOf(effectUuid);
    if (idx !== -1) this.activatedMods.splice(idx, 1);
  }

  get attackerActor() {
    const doc = fromUuidSync(this.attackerTokenUuid || this.attackerUuid);
    return doc?.actor ?? doc ?? null;
  }

  get defenderActor() {
    const doc = fromUuidSync(this.defenderTokenUuid || this.defenderUuid);
    return doc?.actor ?? doc ?? null;
  }

  get isOwnerAttacker() {
    return this.initiativeOwnerSide === "attacker";
  }

  get ownerActor() {
    return this.isOwnerAttacker ? this.attackerActor : this.defenderActor;
  }

  get responderActor() {
    return this.isOwnerAttacker ? this.defenderActor : this.attackerActor;
  }

  get uncommittedOwnerDice() {
    const pool    = this.isOwnerAttacker ? this.attackDice : this.defenseDice;
    const usedSet = new Set(this.isOwnerAttacker ? (this.usedAttackDice ?? []) : (this.usedDefenseDice ?? []));
    return (pool ?? []).filter((_, i) => !usedSet.has(i));
  }

  get netSuccesses() {
    return (this.hits ?? []).length;
  }
}

/**
 * DuelSegmentContext — dane jednego segmentu wymiany.
 *
 * Dwa tryby tworzenia:
 *   fromOwnerCommit — gdy owner commituje kości (tylko N, ownerAction, ownerDiceIndices)
 *   fromResolution  — po rozstrzygnięciu (pełne dane: outcome, successes, hitEntry, action)
 */
export class DuelSegmentContext {

  /**
   * Zbuduj częściowy segment przy commitowaniu kości przez właściciela inicjatywy.
   * Używany przez DuelLifecycle.segmentStart() — responder jeszcze nie commitował.
   *
   * @param {object} params
   * @param {number}   params.N
   * @param {string}   params.ownerAction
   * @param {number[]} params.ownerDiceIndices
   * @returns {DuelSegmentContext}
   */
  static fromOwnerCommit({ N, ownerAction, ownerDiceIndices }) {
    const seg = Object.create(DuelSegmentContext.prototype);
    seg.N                    = N;
    seg.ownerAction          = ownerAction;
    seg.ownerDiceIndices     = ownerDiceIndices;
    seg.responderDiceIndices = null;
    seg.ownerSuccesses       = null;
    seg.responderSuccesses   = null;
    seg.attackerSuccesses    = null;
    seg.defenderSuccesses    = null;
    seg.outcome              = null;
    seg.hitEntry             = null;
    seg.action               = null;
    seg.trickId              = null;
    return seg;
  }

  /**
   * Zbuduj pełny segment po rozstrzygnięciu obu stron.
   * Używany przez DuelLifecycle.segmentResolve().
   *
   * @param {object} params
   * @param {DuelContext} params.duel
   * @param {number}   params.N
   * @param {string}   params.ownerAction
   * @param {number[]} params.ownerDiceIndices
   * @param {number[]} params.responderDiceIndices
   * @param {number}   params.ownerSuccesses
   * @param {number}   params.responderSuccesses
   * @param {string}   params.outcome
   * @param {object|null} params.hitEntry
   * @param {object|null} params.action         - MeleeAction descriptor | null
   * @param {string|null} params.trickId
   * @returns {DuelSegmentContext}
   */
  static fromResolution({ duel, N, ownerAction, ownerDiceIndices, responderDiceIndices,
                          ownerSuccesses, responderSuccesses, outcome, hitEntry, action, trickId }) {
    const seg = Object.create(DuelSegmentContext.prototype);
    seg.N                    = N;
    seg.ownerAction          = ownerAction ?? "attack";
    seg.ownerDiceIndices     = ownerDiceIndices;
    seg.responderDiceIndices = responderDiceIndices;
    seg.ownerSuccesses       = ownerSuccesses;
    seg.responderSuccesses   = responderSuccesses;
    seg.attackerSuccesses    = duel.isOwnerAttacker ? ownerSuccesses : responderSuccesses;
    seg.defenderSuccesses    = duel.isOwnerAttacker ? responderSuccesses : ownerSuccesses;
    seg.outcome              = outcome;
    seg.hitEntry             = hitEntry ?? null;
    seg.action               = action ?? null;
    seg.trickId              = trickId ?? null;
    return seg;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 2: TRIGGER ARG BUILDERS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bazowe args wspólne dla wszystkich triggerów melee.
 * @param {DuelContext}             duel
 * @param {Actor}                   actor
 * @param {DuelSegmentContext|null} segment
 * @returns {object}
 */
function buildBaseArgs(duel, actor, segment = null) {
  const attackerActor = duel.attackerActor;
  const defenderActor = duel.defenderActor;
  const isAttacker    = actor === attackerActor;
  return {
    actor,
    duel,
    segment,
    isAttacker,
    attackerActor,
    defenderActor,
    state: duel
  };
}

/**
 * Args dla onMeleeHit / onMeleeBlock / onMeleeTakeover.
 * @param {DuelContext}        duel
 * @param {Actor}              actor
 * @param {DuelSegmentContext} segment
 * @returns {object}
 */
function buildSegmentArgs(duel, actor, segment) {
  return {
    ...buildBaseArgs(duel, actor, segment),
    outcome:           segment.outcome,
    action:            segment.action,
    diceCount:         segment.N,
    attackerSuccesses: segment.attackerSuccesses,
    defenderSuccesses: segment.defenderSuccesses,
    hitEntry:          segment.hitEntry,
    hits:              [...(duel.hits ?? [])]
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 3: LIFECYCLE MANAGER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * DuelLifecycle — orchestruje wywołania triggerów przez cały cykl życia duela.
 *
 * Zastępuje ad-hoc inline hook calls w applyDuelBatch i resolveOpposed.
 * Może koegzystować z combat.js — applyDuelBatch wywołuje DuelLifecycle,
 * lifecycle wywołuje triggery.
 *
 * KIEDY CO ODPALA:
 *   start()          — po ChatMessage.create() (pierwsza karta duela)
 *   segmentStart()   — gdy owner commituje kości (state → "responder")
 *   segmentResolve() — po rozstrzygnięciu segmentu (wynik hit/block/takeover)
 *   end()            — gdy state.status === "done" (wszystkie kości wyczerpane)
 */
export class DuelLifecycle {

  /**
   * Odpal onDuelStart dla obu uczestników.
   * Wywoływany raz — po stworzeniu wiadomości duel card.
   *
   * Args dla scriptera:
   *   args.duel, args.isAttacker, args.attackerActor, args.defenderActor
   *   args.segment = null
   *
   * @param {DuelContext} duel
   * @returns {Promise<void>}
   */
  static async start(duel) {
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const atk = duel.attackerActor;
      const def = duel.defenderActor;
      if (atk) {
        await NeuroshimaScriptRunner.execute("onDuelStart",
          { ...buildBaseArgs(duel, atk, null) });
      }
      if (def) {
        await NeuroshimaScriptRunner.execute("onDuelStart",
          { ...buildBaseArgs(duel, def, null) });
      }
    } catch (err) {
      game.neuroshima?.log("[DuelLifecycle.start] error", err);
    }
  }

  /**
   * Odpal onDuelSegmentStart dla obu uczestników.
   * Wywoływany gdy właściciel inicjatywy commituje kości (przed respondentem).
   *
   * Args dla scriptera:
   *   args.duel, args.segment.N, args.segment.ownerAction,
   *   args.segment.ownerDiceIndices
   *
   * @param {DuelContext}        duel
   * @param {DuelSegmentContext} segment  - fromOwnerCommit (bez outcome)
   * @returns {Promise<void>}
   */
  static async segmentStart(duel, segment) {
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const atk = duel.attackerActor;
      const def = duel.defenderActor;
      if (atk) {
        await NeuroshimaScriptRunner.execute("onDuelSegmentStart",
          { ...buildBaseArgs(duel, atk, segment) });
      }
      if (def) {
        await NeuroshimaScriptRunner.execute("onDuelSegmentStart",
          { ...buildBaseArgs(duel, def, segment) });
      }
    } catch (err) {
      game.neuroshima?.log("[DuelLifecycle.segmentStart] error", err);
    }
  }

  /**
   * Odpal trigger segmentowy (onMeleeHit / onMeleeBlock / onMeleeTakeover)
   * dla obu uczestników ORAZ action-scoped trigger dla zadeklarowanej akcji.
   *
   * Zastępuje inline hook block w applyDuelBatch (~linie 3205-3247 combat.js).
   *
   * Dodatkowe BC args (zachowane z obecnego kodu):
   *   args.context  — MeleeActionContext (legacy, dla istniejących skryptów)
   *   args.attackerId, args.defenderId — UUIDs
   *
   * @param {DuelContext}        duel
   * @param {DuelSegmentContext} segment
   * @param {object}             [legacyContext]  - MeleeActionContext z fromSegment (BC)
   * @returns {Promise<void>}
   */
  static async segmentResolve(duel, segment, legacyContext = null) {
    if (!["hit", "takeover", "draw"].includes(segment.outcome)) return;
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const trigger = segment.outcome === "hit"      ? "onMeleeHit"
                    : segment.outcome === "takeover" ? "onMeleeTakeover"
                    : "onMeleeBlock";

      const atk = duel.attackerActor;
      const def = duel.defenderActor;

      const extraBC = {
        context:    legacyContext,
        attackerId: duel.attackerTokenUuid || duel.attackerUuid,
        defenderId: duel.defenderTokenUuid || duel.defenderUuid
      };

      if (atk) {
        await NeuroshimaScriptRunner.execute(trigger, {
          ...buildSegmentArgs(duel, atk, segment), ...extraBC, isAttacker: true
        });
      }
      if (def) {
        await NeuroshimaScriptRunner.execute(trigger, {
          ...buildSegmentArgs(duel, def, segment), ...extraBC, isAttacker: false
        });
      }

      const declaredAction = duel.actions?.declared ?? null;
      if (declaredAction) {
        const actionTrigger = (segment.outcome === "hit" || segment.outcome === "draw")
          ? "onMeleeActionHit" : "onMeleeActionMiss";
        await declaredAction.executeTrigger(actionTrigger,
          buildSegmentArgs(duel, declaredAction.ownerActor ?? atk, segment));
      }
    } catch (err) {
      game.neuroshima?.log("[DuelLifecycle.segmentResolve] error", err);
    }
  }

  /**
   * Odpal onDuelEnd dla obu uczestników.
   * Wywoływany gdy state.status === "done" (wszystkie kości wyczerpane).
   *
   * Działa OBOK istniejącego meleeUpdate "turn-end" (pool-based compat).
   *
   * Args dla scriptera:
   *   args.duel (z duel.hits[], duel.netSuccesses), args.segment = null
   *
   * @param {DuelContext} duel
   * @returns {Promise<void>}
   */
  static async end(duel) {
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const atk = duel.attackerActor;
      const def = duel.defenderActor;
      if (atk) {
        await NeuroshimaScriptRunner.execute("onDuelEnd",
          { ...buildBaseArgs(duel, atk, null) });
      }
      if (def) {
        await NeuroshimaScriptRunner.execute("onDuelEnd",
          { ...buildBaseArgs(duel, def, null) });
      }
    } catch (err) {
      game.neuroshima?.log("[DuelLifecycle.end] error", err);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 4: ACTIVATION MODEL
   ══════════════════════════════════════════════════════════════════════════
   Dokumentacja modelu aktywacji — implementacja w DuelContext (powyżej).
   Patrz: isModActivated / activateMod / deactivateMod.
   ═══════════════════════════════════════════════════════════════════════════ */

/*
 * NOWY MODEL (aktywny):
 *
 *   JEDNO źródło prawdy: duel.activatedMods (alias do activatedMeleePreRollMods)
 *
 *   isActiveForMelee(args) w script-engine.js (linia 677):
 *     1. args.state?.activatedMeleePreRollMods?.includes(this.effect.uuid)  ← PRIMARY
 *     2. enc._effects._tricks fallback                                        ← legacy pool
 *
 *   deactivateMod(uuid):
 *     usuwa z activatedMods (= activatedMeleePreRollMods) → zero zombie activation
 *
 *   deactivateForMelee(args) w script-engine.js:
 *     PROBLEM: czyści tylko enc._effects._tricks, nie state.activatedMeleePreRollMods
 *     FIX (todo Faza 2): wywołać też duel.deactivateMod(this.effect.uuid)
 */

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 10: MeleeAction JAKO PIERWSZORZĘDNY OBIEKT DOMENOWY
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * MeleeAction — pierwszorzędny obiekt domenowy dla akcji melee.
 *
 * Zbudowany z normalized descriptor (MeleeActionRegistry).
 * Ma własny status lifecycle i może odpalać swoje triggery (action-scoped execution).
 *
 * Status lifecycle:
 *   available  → declared → active → resolved
 *                         → queued → resolved
 *                cancelled (miss/block)
 */
export class MeleeAction {

  /**
   * Utwórz MeleeAction z normalized descriptor (MeleeActionRegistry output).
   * Kopiuje wszystkie pola descriptora na instancję, ustawia status "available".
   *
   * @param {object}      descriptor  - POJO z normalizeEffectAction/_normalizeBeastActivity
   * @param {DuelContext} duel        - Kontekst duela (referencja)
   * @returns {MeleeAction}
   */
  static fromDescriptor(descriptor, duel) {
    const action = Object.create(MeleeAction.prototype);
    Object.assign(action, descriptor);
    action._duel        = duel;
    action.status       = "available";
    action._isAffordable = descriptor.isAffordable ?? true;
    return action;
  }

  /**
   * Wykonaj action-scoped trigger dla tego efektu/itemu.
   * Filtruje skrypty po sourceEffectUuid — odpala TYLKO skrypty tego efektu.
   * Scripter nie musi sprawdzać tożsamości efektu.
   *
   * @param {string} triggerName  - "onMeleeActionHit" | "onMeleeActionMiss" | …
   * @param {object} extraArgs    - Mergowane z args
   * @returns {Promise<void>}
   */
  async executeTrigger(triggerName, extraArgs = {}) {
    if (!this.sourceEffectUuid) return;
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const effect = fromUuidSync(this.sourceEffectUuid);
      if (!effect) return;
      const actor = effect.parent?.actor ?? effect.parent;
      if (!actor) return;

      const scripts = NeuroshimaScriptRunner.getScripts(actor, triggerName)
        .filter(s => s.effect?.uuid === this.sourceEffectUuid);

      const args = { ...extraArgs, action: this, actor };
      for (const script of scripts) {
        try {
          await script.execute(args);
        } catch (err) {
          game.neuroshima?.log(`[MeleeAction.executeTrigger] ${triggerName} error`, err);
        }
      }
    } catch (err) {
      game.neuroshima?.log(`[MeleeAction.executeTrigger] ${triggerName} outer error`, err);
    }
  }

  get sourceEffect() {
    if (!this.sourceEffectUuid) return null;
    return fromUuidSync(this.sourceEffectUuid);
  }

  get sourceItem() {
    if (!this.sourceItemUuid) return null;
    return fromUuidSync(this.sourceItemUuid);
  }

  get ownerActor() {
    return this._duel?.ownerActor ?? null;
  }

  get isAffordable() {
    return this._isAffordable;
  }

  get isPending() {
    return this.status === "available" || this.status === "declared";
  }

  get isResolved() {
    return this.status === "resolved" || this.status === "cancelled";
  }

  /**
   * Sprawdź czy akcja może być zadeklarowana w tym segmencie.
   * @param {DuelSegmentContext} segment
   * @returns {boolean}
   */
  isDeclarableIn(segment) {
    const N = segment.N ?? 1;
    if (this.minDice && N < this.minDice) return false;
    if (this.maxDice && N > this.maxDice) return false;
    if (this.costType === "success" && this.successCost > 0) {
      const budget = segment.ownerSuccesses ?? 0;
      return budget >= this.successCost;
    }
    return true;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 11: DuelActionPipeline — ACTION PIPELINE W DuelContext
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * DuelActionPipeline — zarządza akcjami przez cały cykl życia duela.
 *
 * Trzymany jako duel.actions. Transient (nie jest serializowany do flagi
 * w Fazie 1 — re-collectowany przy każdym segmencie).
 *
 * Odpowiedniki obecnego state:
 *   state.trickOnHitScripts    → actions.available
 *   state.committedTrickId     → actions.declared?.id
 *   state.committedTrickQueue  → actions.queued (current seg)
 *   state.allTrickQueue        → actions.queued (accumulated)
 *   affordableBeastActions     → actions.available (beast type)
 */
export class DuelActionPipeline {

  constructor() {
    this.available = [];
    this.declared  = null;
    this.active    = [];
    this.queued    = [];
    this.resolved  = [];
  }

  /**
   * Wypełnij available przez trigger collectMeleeActions.
   * Wywoływany przy segmentStart (przed commitowaniem kości przez ownera).
   *
   * @param {DuelContext}        duel
   * @param {DuelSegmentContext} segment
   * @returns {Promise<void>}
   */
  async collect(duel, segment) {
    this.available = [];
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const ownerActor = duel.ownerActor;
      if (!ownerActor) return;

      const lookupActionDef = _makeActionDefLookup(ownerActor);
      const rawActions = [];

      await NeuroshimaScriptRunner.execute("collectMeleeActions", {
        ...buildBaseArgs(duel, ownerActor, segment),
        actions:              rawActions,
        ownerHadHit:          (duel.hits ?? []).length > 0,
        uncommittedDice:      duel.uncommittedOwnerDice.length,
        uncommittedSuccesses: duel.uncommittedOwnerDice.filter(d => d.isSuccess).length,
        lookupActionDef
      });

      this.available = rawActions
        .filter(Boolean)
        .map(d => MeleeAction.fromDescriptor(d, duel));
    } catch (err) {
      game.neuroshima?.log("[DuelActionPipeline.collect] error", err);
    }
  }

  /**
   * Zadeklaruj akcję dla tego segmentu.
   * Przesuwa akcję z available → declared.
   * null = zwykły atak (bez specjalnej akcji).
   *
   * @param {MeleeAction|null} action
   */
  declare(action) {
    if (action) action.status = "declared";
    this.declared = action;
  }

  /**
   * Aktywuj zadeklarowaną akcję po hit.
   * Przesuwa declared → active, odpala onMeleeActionHit trigger.
   *
   * @param {DuelSegmentContext} segment
   * @returns {Promise<void>}
   */
  async activateOnHit(segment) {
    const action = this.declared;
    if (!action) return;
    action.status = "active";
    this.active.push(action);
    this.declared = null;
    await action.executeTrigger("onMeleeActionHit", { segment, duel: action._duel });
  }

  /**
   * Anuluj zadeklarowaną akcję (miss/block).
   * Przesuwa declared → cancelled.
   */
  cancelDeclared() {
    if (!this.declared) return;
    this.declared.status = "cancelled";
    this.resolved.push(this.declared);
    this.declared = null;
  }

  /**
   * Dodaj successCost akcję do kolejki (wypełniana przy segmentStart z queue).
   * @param {MeleeAction} action
   */
  enqueue(action) {
    action.status = "queued";
    this.queued.push(action);
  }

  /**
   * Rozwiąż kolejkę przy apply-time (po duel.end).
   * Odpala onMeleeActionQueued dla każdej akcji w kolejce.
   *
   * @param {DuelContext} duel
   * @returns {Promise<void>}
   */
  async resolveQueued(duel) {
    const toProcess = [...this.queued];
    this.queued = [];
    for (const action of toProcess) {
      action.status = "active";
      await action.executeTrigger("onMeleeActionQueued", { duel });
      action.status = "resolved";
      this.resolved.push(action);
    }
  }

  /**
   * Serialized form (tylko ids + statusy — descriptory są re-collectowane).
   * Faza 1: nie serializujemy, pipeline jest transient.
   * @returns {object}
   */
  toFlag() {
    return {
      queued:   this.queued.map(a => ({ id: a.id, sourceEffectUuid: a.sourceEffectUuid })),
      resolved: this.resolved.map(a => ({ id: a.id, status: a.status }))
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 12: collectMeleeActions — DOCELOWY TRIGGER
   ══════════════════════════════════════════════════════════════════════════
   getMeleeActions (legacy BC) — odpalany w _buildDuelContext jak dotychczas.
   collectMeleeActions (nowy) — odpalany OBOK getMeleeActions z tym samym triggerArgs
   + duel, bez isDialogScript, bez activateForMelee side-effectów.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 13: ACTION-SCOPED TRIGGER EXECUTION
   ══════════════════════════════════════════════════════════════════════════
   Implementacja w MeleeAction.executeTrigger() (powyżej).
   DuelLifecycle.segmentResolve() wywołuje:
     1. Globalny trigger (onMeleeHit) dla obu aktorów, wszystkich efektów
     2. Action-scoped (onMeleeActionHit) tylko na sourceEffect zadeklarowanej akcji
   ═══════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 14: PEŁNA LISTA TRIGGERÓW PO MIGRACJI
   ══════════════════════════════════════════════════════════════════════════
   Dodane do NeuroshimaScriptRunner.TRIGGERS w script-engine.js:
     onDuelStart, onDuelSegmentStart, onDuelEnd
     collectMeleeActions
     onMeleeActionHit, onMeleeActionMiss, onMeleeActionQueued, onMeleeActionResolved
   ═══════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   PRIVATE HELPERS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Zbuduj lookupActionDef helper dla danego aktora.
 * Wyszukuje actionDef po id lub name w efektach aktora i jego itemów.
 * Używany przez DuelActionPipeline.collect() i wiring w combat.js.
 *
 * @param {Actor} actor
 * @returns {function(string): object|null}
 */
export function _makeActionDefLookup(actor) {
  return (idOrName) => {
    const match = (d) => d.id === idOrName || d.name === idOrName;
    for (const effect of (actor.effects ?? [])) {
      const def = (effect.system?.actionDefs ?? []).find(match);
      if (def) return foundry.utils.deepClone(def);
    }
    for (const item of (actor.items ?? [])) {
      for (const effect of (item.effects ?? [])) {
        const def = (effect.system?.actionDefs ?? []).find(match);
        if (def) return foundry.utils.deepClone(def);
      }
    }
    return null;
  };
}
