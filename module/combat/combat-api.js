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
    const _isHitOutcome = ["hit", "takeover", "draw"].includes(segment.outcome);
    const _hasAction    = !!(duel.actions?.declared);
    if (!_isHitOutcome && !_hasAction) return;
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");

      const atk = duel.attackerActor;
      const def = duel.defenderActor;

      const extraBC = {
        context:    legacyContext,
        attackerId: duel.attackerTokenUuid || duel.attackerUuid,
        defenderId: duel.defenderTokenUuid || duel.defenderUuid
      };

      if (_isHitOutcome) {
        const trigger = segment.outcome === "hit"      ? "onMeleeHit"
                      : segment.outcome === "takeover" ? "onMeleeTakeover"
                      : "onMeleeBlock";
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
   * Odpal beforeMeleeAction dla obu uczestników.
   * Wywoływany tuż przed rozstrzygnięciem segmentu (przed segmentResolve).
   *
   * @param {DuelContext}        duel
   * @param {DuelSegmentContext} segment  - fromResolution (outcome znany)
   * @param {object}             [legacyContext]
   * @returns {Promise<void>}
   */
  static async beforeAction(duel, segment, legacyContext = null) {
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const atk = duel.attackerActor;
      const def = duel.defenderActor;
      const extraBC = {
        context:    legacyContext,
        attackerId: duel.attackerTokenUuid || duel.attackerUuid,
        defenderId: duel.defenderTokenUuid || duel.defenderUuid
      };
      if (atk) {
        await NeuroshimaScriptRunner.execute("beforeMeleeAction", {
          ...buildSegmentArgs(duel, atk, segment), ...extraBC, isAttacker: true
        });
      }
      if (def) {
        await NeuroshimaScriptRunner.execute("beforeMeleeAction", {
          ...buildSegmentArgs(duel, def, segment), ...extraBC, isAttacker: false
        });
      }
    } catch (err) {
      game.neuroshima?.log("[DuelLifecycle.beforeAction] error", err);
    }
  }

  /**
   * Odpal afterMeleeAction dla obu uczestników.
   * Wywoływany zaraz po segmentResolve (triggery hit/block/takeover już odpalone).
   *
   * @param {DuelContext}        duel
   * @param {DuelSegmentContext} segment
   * @param {object}             [legacyContext]
   * @returns {Promise<void>}
   */
  static async afterAction(duel, segment, legacyContext = null) {
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const atk = duel.attackerActor;
      const def = duel.defenderActor;
      const extraBC = {
        context:    legacyContext,
        attackerId: duel.attackerTokenUuid || duel.attackerUuid,
        defenderId: duel.defenderTokenUuid || duel.defenderUuid
      };
      if (atk) {
        await NeuroshimaScriptRunner.execute("afterMeleeAction", {
          ...buildSegmentArgs(duel, atk, segment), ...extraBC, isAttacker: true
        });
      }
      if (def) {
        await NeuroshimaScriptRunner.execute("afterMeleeAction", {
          ...buildSegmentArgs(duel, def, segment), ...extraBC, isAttacker: false
        });
      }
    } catch (err) {
      game.neuroshima?.log("[DuelLifecycle.afterAction] error", err);
    }
  }

  /**
   * Odpal beforeMeleeDamage dla obu uczestników przed aplikacją obrażeń jednego hitu.
   * Wywoływany przez applyOpposedDamage dla każdego wpisu z rd.hits.
   *
   * Args dla scriptera:
   *   args.hit, args.rd, args.targetActor, args.attackerActor, args.defenderActor
   *   args.attackerId, args.defenderId, args.isAttacker
   *
   * @param {object} rd              - opposedResult flag data
   * @param {object} hit             - pojedynczy hit entry ({ tier, damageType, trickId })
   * @param {Actor}  attackerActor
   * @param {Actor}  defenderActor
   * @param {Actor}  targetActor
   * @returns {Promise<void>}
   */
  static async beforeDamage(rd, hit, attackerActor, defenderActor, targetActor) {
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const duel = DuelContext.fromFlag(rd);
      const base = {
        hit, rd, duel, targetActor, attackerActor, defenderActor,
        attackerId: rd.attackerUuid || rd.attackerTokenUuid,
        defenderId: rd.defenderUuid || rd.defenderTokenUuid
      };
      if (attackerActor) {
        await NeuroshimaScriptRunner.execute("beforeMeleeDamage",
          { ...base, actor: attackerActor, isAttacker: true });
      }
      if (defenderActor) {
        await NeuroshimaScriptRunner.execute("beforeMeleeDamage",
          { ...base, actor: defenderActor, isAttacker: false });
      }
    } catch (err) {
      game.neuroshima?.log("[DuelLifecycle.beforeDamage] error", err);
    }
  }

  /**
   * Odpal afterMeleeDamage dla obu uczestników po aplikacji obrażeń jednego hitu.
   *
   * @param {object}      rd
   * @param {object}      hit
   * @param {Actor}       attackerActor
   * @param {Actor}       defenderActor
   * @param {Actor}       targetActor
   * @param {object|null} batch  - wynik applyDamageToActor (results, woundIds, …)
   * @returns {Promise<void>}
   */
  static async afterDamage(rd, hit, attackerActor, defenderActor, targetActor, batch) {
    try {
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      const duel = DuelContext.fromFlag(rd);
      const base = {
        hit, rd, duel, targetActor, attackerActor, defenderActor, batch,
        attackerId: rd.attackerUuid || rd.attackerTokenUuid,
        defenderId: rd.defenderUuid || rd.defenderTokenUuid
      };
      if (attackerActor) {
        await NeuroshimaScriptRunner.execute("afterMeleeDamage",
          { ...base, actor: attackerActor, isAttacker: true });
      }
      if (defenderActor) {
        await NeuroshimaScriptRunner.execute("afterMeleeDamage",
          { ...base, actor: defenderActor, isAttacker: false });
      }
    } catch (err) {
      game.neuroshima?.log("[DuelLifecycle.afterDamage] error", err);
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
 *     FIXED (Faza 2): czyści też state.activatedMeleePreRollMods (args.state) i args.duel.activatedMods
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
      await NeuroshimaScriptRunner.executeScoped(
        triggerName,
        { ...extraArgs, action: this, actor },
        { sourceEffectUuid: this.sourceEffectUuid }
      );
    } catch (err) {
      game.neuroshima?.log(`[MeleeAction.executeTrigger] ${triggerName} error`, err);
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
   SEKCJA 11B: DuelDamageEngine — ENGINE APLIKACJI OBRAŻEŃ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * DuelDamageEngine — silnik aplikacji obrażeń po rozstrzygnięciu duela.
 *
 * Wyodrębniony z MeleeOpposedChat.applyOpposedDamage w combat.js.
 * Jest jedynym miejscem które:
 *   • sprawdza hit.cancelled (z beforeMeleeDamage)
 *   • aplikuje obrażenia przez CombatHelper
 *   • odpala afterMeleeDamage
 *   • odpala onMeleeActionResolved po każdej sztuczce
 *   • odpala onMeleeActionQueued przed każdą sztuczką z kolejki
 *
 * combat.js: applyOpposedDamage wywołuje DuelDamageEngine.processAll()
 * i obsługuje tylko UI (powiadomienia, renderPainResistanceReport, setFlag).
 */
export class DuelDamageEngine {

  /**
   * Przetwórz wszystkie hity i sztuczki z kolejki z opposedResult.
   *
   * @param {object}    rd   - opposedResult flag data
   * @param {object}    ctx
   * @param {Actor}     ctx.attackerActor
   * @param {Actor}     ctx.defenderActor
   * @param {Item|null} ctx.weaponItem
   * @param {object}    ctx.CombatHelper
   * @returns {Promise<{allResults: object[], allWoundIds: string[], totalReduced: number, allReducedDetails: object[]}>}
   */
  static async processAll(rd, { attackerActor, defenderActor, weaponItem, CombatHelper }) {
    const allResults        = [];
    const allWoundIds       = [];
    let   totalReduced      = 0;
    const allReducedDetails = [];
    const resolvedTrickIds  = new Set();

    const { MeleeActionRunner } = await import("./melee-action-runner.js");

    for (const hit of (rd.hits ?? [])) {
      let targetActor = defenderActor;
      if (hit.isBackHit && rd.escapeeUuid) {
        const escapeeDoc   = await fromUuid(rd.escapeeUuid);
        const escapeeActor = escapeeDoc?.actor ?? escapeeDoc;
        if (escapeeActor) targetActor = escapeeActor;
      }
      const isTrickHit = !!hit.trickId;

      await DuelLifecycle.beforeDamage(rd, hit, attackerActor, defenderActor, targetActor);

      if (hit.cancelled) {
        await DuelLifecycle.afterDamage(rd, hit, attackerActor, defenderActor, targetActor, null);
        continue;
      }

      if (isTrickHit && rd.trickOnHitScripts?.[hit.trickId]) {
        await MeleeActionRunner.fireOnHitScript(hit, rd, attackerActor, targetActor);
        await DuelLifecycle.afterDamage(rd, hit, attackerActor, defenderActor, targetActor, null);
      } else if (isTrickHit) {
        const trickResult = await MeleeActionRunner.applyTrickHitDamage(hit, {
          attackerActor, targetActor, weaponItem, rd, CombatHelper
        });
        if (trickResult.woundIds.length > 0 || trickResult.results.length > 0) {
          allResults.push(...trickResult.results);
          allWoundIds.push(...trickResult.woundIds);
          totalReduced += trickResult.reduced;
          allReducedDetails.push(...trickResult.reducedDetails);
        }
        await DuelLifecycle.afterDamage(rd, hit, attackerActor, defenderActor, targetActor, trickResult);
      } else if (hit.isBlockDamage) {
        const attackData = {
          isMelee:       true,
          actorId:       attackerActor?.id,
          weaponId:      rd.weaponId,
          label:         weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
          damageMelee1:  hit.damageType,
          damageMelee2:  hit.damageType,
          damageMelee3:  hit.damageType,
          finalLocation: rd.location,
          successPoints: hit.tier
        };
        const batch = await CombatHelper.applyDamageToActor(targetActor, attackData, {
          isOpposed:    true,
          spDifference: hit.tier,
          location:     rd.location,
          suppressChat: true
        });
        if (batch) {
          allResults.push(...(batch.results ?? []));
          allWoundIds.push(...(batch.woundIds ?? []));
          totalReduced += batch.reducedProjectiles ?? 0;
          allReducedDetails.push(...(batch.reducedDetails ?? []));
        }
        await DuelLifecycle.afterDamage(rd, hit, attackerActor, defenderActor, targetActor, batch ?? null);
      } else {
        const attackData = {
          isMelee:       true,
          actorId:       attackerActor?.id,
          weaponId:      rd.weaponId,
          label:         weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
          damageMelee1:  rd.damage1,
          damageMelee2:  rd.damage2,
          damageMelee3:  rd.damage3,
          finalLocation: rd.location,
          successPoints: hit.tier
        };
        const batch = await CombatHelper.applyDamageToActor(targetActor, attackData, {
          isOpposed:    true,
          spDifference: hit.tier,
          location:     rd.location,
          suppressChat: true
        });
        if (batch) {
          allResults.push(...(batch.results ?? []));
          allWoundIds.push(...(batch.woundIds ?? []));
          totalReduced += batch.reducedProjectiles ?? 0;
          allReducedDetails.push(...(batch.reducedDetails ?? []));
        }
        await DuelLifecycle.afterDamage(rd, hit, attackerActor, defenderActor, targetActor, batch ?? null);
      }

      if (isTrickHit && hit.trickId) resolvedTrickIds.add(hit.trickId);
    }

    await DuelDamageEngine._fireResolvedTriggers(rd, resolvedTrickIds, attackerActor);

    if (rd.pendingTrickQueue?.length > 0) {
      for (const trickEntry of rd.pendingTrickQueue) {
        if (trickEntry?.startsWith("trick:")) {
          const _qfc     = trickEntry.indexOf(":");
          const _qsc     = trickEntry.indexOf(":", _qfc + 1);
          const _qTrickId = _qsc > _qfc + 1
            ? trickEntry.slice(_qfc + 1, _qsc)
            : trickEntry.slice(_qfc + 1);
          const _qDesc = _qTrickId ? rd.trickOnHitScripts?.[_qTrickId] : null;
          if (_qDesc && typeof _qDesc !== "string" && _qDesc.effectUuid) {
            const _qDuel   = DuelContext.fromFlag(rd);
            const _qAction = MeleeAction.fromDescriptor({
              id:               _qTrickId,
              sourceEffectUuid: _qDesc.effectUuid,
              name:             _qDesc.name ?? _qTrickId
            }, _qDuel);
            _qAction.status = "queued";
            await _qAction.executeTrigger("onMeleeActionQueued", {
              actor:   attackerActor,
              duel:    _qDuel,
              trickId: _qTrickId
            });
          }
        }
        const queueResult = await MeleeActionRunner.applyQueueTrickEntry(trickEntry, {
          attackerActor, defenderActor, weaponItem, rd, CombatHelper
        });
        if (queueResult) {
          allResults.push(...queueResult.results);
          allWoundIds.push(...queueResult.woundIds);
          totalReduced += queueResult.reduced;
          allReducedDetails.push(...queueResult.reducedDetails);
        }
      }
    }

    return { allResults, allWoundIds, totalReduced, allReducedDetails };
  }

  /**
   * Odpal onMeleeActionResolved dla każdej sztuczki która trafiła w tym duellu.
   * Wywoływany raz po przetworzeniu wszystkich hitów.
   *
   * @param {object}  rd              - opposedResult flag data
   * @param {Set<string>} resolvedTrickIds - id trick'ów które miały hit
   * @param {Actor}   attackerActor
   * @returns {Promise<void>}
   */
  static async _fireResolvedTriggers(rd, resolvedTrickIds, attackerActor) {
    if (!resolvedTrickIds.size) return;
    try {
      const duel = DuelContext.fromFlag(rd);
      for (const trickId of resolvedTrickIds) {
        const desc = rd.trickOnHitScripts?.[trickId];
        if (!desc || typeof desc === "string" || !desc.effectUuid) continue;
        const action = MeleeAction.fromDescriptor({
          id:               trickId,
          sourceEffectUuid: desc.effectUuid,
          name:             desc.name ?? trickId
        }, duel);
        action.status = "resolved";
        await action.executeTrigger("onMeleeActionResolved", {
          actor:   attackerActor,
          duel,
          trickId
        });
      }
    } catch (err) {
      game.neuroshima?.log("[DuelDamageEngine._fireResolvedTriggers] error", err);
    }
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

function _shiftDamageTypeUnclamped(type, steps) {
  if (!steps) return type;
  const REGULAR = ["D", "L", "C", "K"];
  const BRUISE  = ["sD", "sL", "sC", "sK"];
  const track   = type?.startsWith("s") ? BRUISE : REGULAR;
  const idx     = track.indexOf(type);
  if (idx < 0) return type;
  const newIdx  = idx + steps;
  if (newIdx < 0) return null;
  return track[Math.min(newIdx, track.length - 1)];
}

function _duelGetLocation(roll) {
  if (roll <= 2)  return "head";
  if (roll <= 4)  return "rightArm";
  if (roll <= 6)  return "leftArm";
  if (roll <= 15) return "torso";
  if (roll <= 17) return "rightLeg";
  return "leftLeg";
}

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 15: MeleeActionContext — CONTEXT DLA HOOKÓW SEGMENTU
   (Przeniesione z combat.js — legacy context object dla BC)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Context object for a resolved melee segment.
 *
 * Przeniesiony z combat.js do combat-api.js aby DuelSegmentEngine mógł
 * go tworzyć bez cyklicznych zależności.
 *
 * Passed to onMeleeHit / onMeleeBlock / onMeleeTakeover hooks as args.context
 * for backward compatibility with existing scripts.
 */
export class MeleeActionContext {
  constructor({ action, attacker, defender, diceCount, outcome, hitEntry = null, messageId = null, state }) {
    this.action    = action;
    this.attacker  = attacker;
    this.defender  = defender;
    this.diceCount = diceCount;
    this.outcome   = outcome;
    this.hitEntry  = hitEntry;
    this.messageId = messageId;
    this.state     = state;
  }

  /**
   * Build a MeleeActionContext from the resolved segment data.
   * Reconstructs the action descriptor from state.trickOnHitScripts using the supplied
   * trickId (captured before committedTrickId is cleared). Returns action: null for plain attacks.
   * @param {object} params
   * @returns {MeleeActionContext}
   */
  static fromSegment({ state, trickId, attackerActor, defenderActor, attackerSuccesses,
                       defenderSuccesses, diceCount, outcome, hitEntry, messageId }) {
    const trickMeta = trickId ? (state.trickOnHitScripts?.[trickId] ?? null) : null;
    const action = trickId ? {
      id:               trickId,
      name:             trickMeta?.name             ?? trickId,
      damage:           hitEntry?.damageType        ?? null,
      effectIds:        trickMeta?.effectIds        ?? [],
      effectTiming:     trickMeta?.effectTiming     ?? "onHit",
      effectTarget:     trickMeta?.effectTarget     ?? "target",
      sourceEffectUuid: trickMeta?.effectUuid       ?? null
    } : null;
    return new MeleeActionContext({
      action,
      attacker: { actor: attackerActor, uuid: state.attackerUuid, successes: attackerSuccesses },
      defender: { actor: defenderActor, uuid: state.defenderUuid, successes: defenderSuccesses },
      diceCount, outcome, hitEntry: hitEntry ?? null, messageId, state
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SEKCJA 16: DuelSegmentEngine — SILNIK ROZSTRZYGNIĘCIA SEGMENTU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * DuelSegmentEngine — silnik rozstrzygnięcia segmentu (faza respondentem).
 *
 * Wyodrębniony z MeleeOpposedChat.applyDuelBatch w combat.js
 * (gałąź state.waitingFor === "responder", ~linie 2982–3403).
 *
 * Obsługuje:
 *   • porównanie sukcesów (attack/trick vs defend, berserker, flee, exit, nonCombat)
 *   • rejestrację hitów w state.hits
 *   • triggery: preOpposedAttacker, opposedAttacker, opposedDefender
 *   • cykl DuelLifecycle: beforeAction → segmentResolve → afterAction
 *   • akumulację trick queue
 *   • ustalenie wyniku końcowego i zapis flagi opposedResult
 *   • trigger onDuelEnd przez DuelLifecycle.end
 *
 * combat.js: applyDuelBatch wywołuje DuelSegmentEngine.processResponder()
 * i obsługuje tylko wyrenderowanie karty i czyszczenie warunków manewrów.
 */
export class DuelSegmentEngine {

  /**
   * Przetwórz fazę respondentem segmentu duelowego.
   * Mutuje `state` in-place (hity, usedDice, segments, status, itd.).
   *
   * @param {object}      state                   - duel card flag data (mutable deepClone)
   * @param {object}      params
   * @param {string}      params.pool             - pool przesłany przez respondentem
   * @param {string}      params.responderPool    - oczekiwany pool ("attacker"|"defender")
   * @param {boolean}     params.isOwnerAttacker  - true jeśli właściciel inicjatywy jest atakującym
   * @param {number[]}    params.diceIndices      - wybrane indeksy kości respondentem
   * @param {string|null} params.action           - zadeklarowana akcja respondentem (lub null)
   * @param {ChatMessage} params.message          - wiadomość karty duelowej
   * @param {Function}    params.onRender         - async (message, state) => void — wyrenderuj kartę
   * @param {Function}    params.onSyncInitiative - async (state) => void — sync initiative to tracker
   * @param {Function}    params.onClearManeuvers - async (actorOrDoc) => void — wyczyść warunki manewrów
   * @returns {Promise<boolean>} false jeśli pool nie pasuje lub validacja kości nie przeszła
   */
  static async processResponder(state, {
    pool, responderPool, isOwnerAttacker, diceIndices, action, message,
    onRender, onSyncInitiative, onClearManeuvers
  }) {
    const declaredAction  = state.declaredAction || "attack";
    const responderAction = action || (
      declaredAction === "exit"      ? "blockExit" :
      declaredAction === "nonCombat" ? "interrupt" : "defend"
    );

    const ownerDice     = isOwnerAttacker ? state.attackDice  : state.defenseDice;
    const responderDice = isOwnerAttacker ? state.defenseDice : state.attackDice;
    const ownerIndices  = state.committedOwnerIndices || [];
    const N             = ownerIndices.length;

    let outcome;
    let segAttackVal  = 0;
    let segDefenseVal = 0;

    if (declaredAction === "attack" && responderAction === "flee") {
      const escapeeUuid = isOwnerAttacker ? state.defenderUuid : state.attackerUuid;
      state.hits.push({ tier: 1, damageType: state.damage1 ?? "d", isBackHit: true, escapeeUuid });
      state._escapeeUuid = escapeeUuid;
      if (isOwnerAttacker) {
        state.usedAttackDice = [...(state.usedAttackDice || []), ...ownerIndices];
      } else {
        state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
      }
      outcome = "flee";

    } else if (declaredAction === "exit" && responderAction === "allowExit") {
      if (isOwnerAttacker) {
        state.usedAttackDice = [...(state.usedAttackDice || []), ...ownerIndices];
      } else {
        state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
      }
      outcome = "exit";

    } else if (declaredAction === "nonCombat" && responderAction === "seizeInit") {
      if (pool !== responderPool) return false;
      if (diceIndices.length !== N) return false;
      state.initiativeOwnerSide = isOwnerAttacker ? "defender" : "attacker";
      if (isOwnerAttacker) {
        state.usedAttackDice  = [...(state.usedAttackDice  || []), ...ownerIndices];
        state.usedDefenseDice = [...(state.usedDefenseDice || []), ...diceIndices];
      } else {
        state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
        state.usedAttackDice  = [...(state.usedAttackDice  || []), ...diceIndices];
      }
      outcome = "seizeInit";

    } else {
      if (pool !== responderPool) return false;

      if (declaredAction === "exit") {
        if (diceIndices.length !== 1) return false;
      } else if (declaredAction === "nonCombat") {
        if (!diceIndices.length) return false;
      } else {
        if (diceIndices.length !== N) return false;
      }

      const ownerSuccessCount     = ownerIndices.filter(i => ownerDice[i]?.isSuccess).length;
      const responderSuccessCount = diceIndices.filter(i => responderDice[i]?.isSuccess).length;
      const ownerHasSuccess       = ownerSuccessCount > 0;
      const responderHasSuccess   = responderSuccessCount > 0;

      const _segmentTrickId = state.committedTrickId ?? null;

      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");

      {
        const _paUuid  = isOwnerAttacker
          ? (state.attackerTokenUuid || state.attackerUuid)
          : (state.defenderTokenUuid || state.defenderUuid);
        const _paDoc   = fromUuidSync(_paUuid);
        const _paActor = _paDoc?.actor ?? _paDoc;
        if (_paActor) {
          await NeuroshimaScriptRunner.execute("preOpposedAttacker", {
            actor: _paActor, encounter: null, participant: null,
            difficultyTarget: 0, mode: "attack"
          });
        }
      }

      if (declaredAction === "attack" || declaredAction === "trick") {
        if (responderAction === "attack") {
          const hitDmgType = declaredAction === "trick" && state.committedTrickDamage
            ? state.committedTrickDamage
            : (state[`damage${N}`] ?? "?");

          const { MeleeActionRunner } = await import("./melee-action-runner.js");

          if (ownerSuccessCount > 0) {
            const hitEntry = { tier: N, damageType: hitDmgType };
            if (declaredAction === "trick" && state.committedTrickId) {
              hitEntry.trickId = state.committedTrickId;
            }
            state.hits.push(hitEntry);
            await MeleeActionRunner.onHit({ state, hitEntry, isOwnerAttacker });
          }

          if (responderSuccessCount > 0) {
            state.counterHits = state.counterHits ?? [];
            state.counterHits.push({ tier: N, damageType: state[`defenderDamage${N}`] ?? "D" });
          }

          if      (ownerSuccessCount > responderSuccessCount)  outcome = "hit";
          else if (ownerSuccessCount < responderSuccessCount)  outcome = "takeover";
          else if (ownerSuccessCount > 0)                      outcome = "draw";
          else                                                  outcome = "nothing";

          segAttackVal  = isOwnerAttacker ? ownerSuccessCount    : responderSuccessCount;
          segDefenseVal = isOwnerAttacker ? responderSuccessCount : ownerSuccessCount;

          if (outcome === "takeover") state.initiativeOwnerSide = isOwnerAttacker ? "defender" : "attacker";
          state.committedTrickId     = null;
          state.committedTrickDamage = null;

          {
            const _oaUuid  = isOwnerAttacker
              ? (state.attackerTokenUuid || state.attackerUuid)
              : (state.defenderTokenUuid || state.defenderUuid);
            const _oaDoc   = fromUuidSync(_oaUuid);
            const _oaActor = _oaDoc?.actor ?? _oaDoc;
            if (_oaActor) {
              const _oaResultType  = outcome === "hit" ? "hit" : outcome === "takeover" ? "takeover" : "block";
              const _ownerManeuver = isOwnerAttacker ? (state.attackerManeuver ?? null) : (state.defenderManeuver ?? null);
              await NeuroshimaScriptRunner.execute("opposedAttacker", {
                actor: _oaActor,
                resultType: _oaResultType,
                diceCount: N,
                encounter: null,
                attacker: { maneuver: _ownerManeuver },
                defender: {},
                attackerId: isOwnerAttacker ? state.attackerUuid : state.defenderUuid,
                defenderId: isOwnerAttacker ? state.defenderUuid : state.attackerUuid,
                attackerSuccesses: ownerSuccessCount,
                defenderSuccesses: responderSuccessCount,
                blockDamageShift: 0
              });
            }
          }

        } else {
          if      (ownerSuccessCount > responderSuccessCount)  outcome = "hit";
          else if (ownerSuccessCount < responderSuccessCount)  outcome = "takeover";
          else if (ownerSuccessCount > 0)                      outcome = "draw";
          else                                                  outcome = "nothing";

          if (outcome === "hit") {
            const hitDmgType = declaredAction === "trick" && state.committedTrickDamage
              ? state.committedTrickDamage
              : (state[`damage${N}`] ?? "?");
            const hitEntry = { tier: N, damageType: hitDmgType };
            if (declaredAction === "trick" && state.committedTrickId) {
              hitEntry.trickId = state.committedTrickId;
            }
            state.hits.push(hitEntry);
            const { MeleeActionRunner } = await import("./melee-action-runner.js");
            await MeleeActionRunner.onHit({ state, hitEntry, isOwnerAttacker });
          }

          segAttackVal  = isOwnerAttacker ? ownerSuccessCount    : responderSuccessCount;
          segDefenseVal = isOwnerAttacker ? responderSuccessCount : ownerSuccessCount;

          if (outcome === "takeover") state.initiativeOwnerSide = isOwnerAttacker ? "defender" : "attacker";
          state.committedTrickId     = null;
          state.committedTrickDamage = null;

          const _oppDefUuid  = isOwnerAttacker
            ? (state.defenderTokenUuid || state.defenderUuid)
            : (state.attackerTokenUuid || state.attackerUuid);
          const _oppDefDoc   = fromUuidSync(_oppDefUuid);
          const _oppDefActor = _oppDefDoc?.actor ?? _oppDefDoc;
          if (_oppDefActor) {
            const _oppResultType = outcome === "hit" ? "hit" : outcome === "takeover" ? "takeover" : "block";
            const _defObj = { blockDamageShift: 0 };
            const _oppArgs = {
              actor: _oppDefActor,
              resultType: _oppResultType,
              diceCount: N,
              encounter: null,
              attacker: {},
              defender: _defObj,
              participant: _defObj,
              attackerSuccesses: ownerSuccessCount,
              defenderSuccesses: responderSuccessCount,
              blockDamageShift: 0
            };
            await NeuroshimaScriptRunner.execute("opposedDefender", _oppArgs);
            const _bds = (_oppArgs.defender.blockDamageShift || 0) + (_oppArgs.blockDamageShift || 0);
            if (_bds !== 0) {
              if (!state.blockDamageShiftByActor) state.blockDamageShiftByActor = {};
              state.blockDamageShiftByActor[_oppDefUuid] = _bds;
            }
            const _effectiveShift = _bds || (state.blockDamageShiftByActor?.[_oppDefUuid] || 0);
            if (_effectiveShift !== 0 && outcome === "draw" && ownerSuccessCount > 0) {
              const _baseDmg    = state[`damage${N}`] ?? "D";
              const _shiftedDmg = _shiftDamageTypeUnclamped(_baseDmg, _effectiveShift);
              if (_shiftedDmg) state.hits.push({ tier: N, damageType: _shiftedDmg, isBlockDamage: true });
            }
          }

          {
            const _oaUuid  = isOwnerAttacker
              ? (state.attackerTokenUuid || state.attackerUuid)
              : (state.defenderTokenUuid || state.defenderUuid);
            const _oaDoc   = fromUuidSync(_oaUuid);
            const _oaActor = _oaDoc?.actor ?? _oaDoc;
            if (_oaActor) {
              const _oaResultType  = outcome === "hit" ? "hit" : outcome === "takeover" ? "takeover" : "block";
              const _ownerManeuver = isOwnerAttacker ? (state.attackerManeuver ?? null) : (state.defenderManeuver ?? null);
              await NeuroshimaScriptRunner.execute("opposedAttacker", {
                actor: _oaActor,
                resultType: _oaResultType,
                diceCount: N,
                encounter: null,
                attacker: { maneuver: _ownerManeuver },
                defender: {},
                attackerId: isOwnerAttacker ? state.attackerUuid : state.defenderUuid,
                defenderId: isOwnerAttacker ? state.defenderUuid : state.attackerUuid,
                attackerSuccesses: ownerSuccessCount,
                defenderSuccesses: responderSuccessCount,
                blockDamageShift: 0
              });
            }
          }
        }

      } else if (declaredAction === "exit") {
        outcome = (ownerHasSuccess && !responderHasSuccess) ? "exit" : "blocked";

      } else {
        const ownerSuccesses     = ownerIndices.filter(i => ownerDice[i]?.isSuccess).length;
        const responderSuccesses = diceIndices.filter(i => responderDice[i]?.isSuccess).length;
        outcome = responderSuccesses >= ownerSuccesses ? "interrupted" : "nonCombat";
      }

      const _isMeleeActionOutcome = outcome === "hit" || outcome === "takeover" || outcome === "draw";
      const _isMissOutcome = outcome === "nothing" && (declaredAction === "attack" || declaredAction === "trick");
      if (_isMeleeActionOutcome || _isMissOutcome) {
        const _atkUuid  = state.attackerTokenUuid || state.attackerUuid;
        const _defUuid  = state.defenderTokenUuid || state.defenderUuid;
        const _atkDoc   = fromUuidSync(_atkUuid);
        const _defDoc   = fromUuidSync(_defUuid);
        const _atkActor = _atkDoc?.actor ?? _atkDoc;
        const _defActor = _defDoc?.actor ?? _defDoc;
        const _atkSucc  = isOwnerAttacker ? ownerSuccessCount    : responderSuccessCount;
        const _defSucc  = isOwnerAttacker ? responderSuccessCount : ownerSuccessCount;
        const _currentHit = outcome === "hit" && state.hits?.length
          ? state.hits[state.hits.length - 1] : null;
        const _ctx = MeleeActionContext.fromSegment({
          state,
          trickId:           _segmentTrickId,
          attackerActor:     _atkActor,
          defenderActor:     _defActor,
          attackerSuccesses: _atkSucc,
          defenderSuccesses: _defSucc,
          diceCount:         N,
          outcome,
          hitEntry:          _currentHit,
          messageId:         message.id
        });
        const _duel     = DuelContext.fromFlag(state);
        const _pipeline = new DuelActionPipeline();
        if (_ctx.action) {
          const _declaredAction = MeleeAction.fromDescriptor(_ctx.action, _duel);
          _pipeline.declare(_declaredAction);
        }
        _duel.actions = _pipeline;
        const _segment = DuelSegmentContext.fromResolution({
          duel:                 _duel,
          N,
          ownerAction:          declaredAction,
          ownerDiceIndices:     ownerIndices,
          responderDiceIndices: diceIndices,
          ownerSuccesses:       ownerSuccessCount,
          responderSuccesses:   responderSuccessCount,
          outcome,
          hitEntry:             _currentHit,
          action:               _ctx.action ?? null,
          trickId:              _segmentTrickId
        });
        await DuelLifecycle.beforeAction(_duel, _segment, _ctx);
        await DuelLifecycle.segmentResolve(_duel, _segment, _ctx);
        await DuelLifecycle.afterAction(_duel, _segment, _ctx);
      }

      if (isOwnerAttacker) {
        state.usedAttackDice  = [...(state.usedAttackDice  || []), ...ownerIndices];
        state.usedDefenseDice = [...(state.usedDefenseDice || []), ...diceIndices];
      } else {
        state.usedDefenseDice = [...(state.usedDefenseDice || []), ...ownerIndices];
        state.usedAttackDice  = [...(state.usedAttackDice  || []), ...diceIndices];
      }
    }

    const seg = state.segments[state.currentSegment];
    seg.attackVal  = segAttackVal;
    seg.defenseVal = segDefenseVal;
    seg.outcome    = outcome;
    seg.tier       = N;

    for (let i = state.currentSegment + 1; i < state.currentSegment + N; i++) {
      if (i < state.segments.length) {
        state.segments[i].outcome = "spent";
        state.segments[i].tier    = 0;
      }
    }

    state.committedOwnerIndices = null;
    state.declaredAction        = null;

    if (state.committedTrickQueue?.length > 0) {
      state.allTrickQueue = [...(state.allTrickQueue || []), ...state.committedTrickQueue];
      state.committedTrickQueue = null;
    }

    await onSyncInitiative(state);

    const endingOutcomes = ["flee", "exit"];
    const isEnded     = endingOutcomes.includes(outcome);
    const nextSegment = state.currentSegment + N;
    const atkLeft     = state.attackDice.length  - (state.usedAttackDice  || []).length;
    const defLeft     = state.defenseDice.length - (state.usedDefenseDice || []).length;
    const hasNext     = !isEnded && nextSegment < state.segments.length && atkLeft > 0 && defLeft > 0;

    if (hasNext) {
      state.currentSegment = nextSegment;
      state.waitingFor     = "initiativeOwner";
    } else {
      state.status     = "done";
      state.waitingFor = null;
    }

    if (state.status === "done") {
      const locationRoll       = (state.attackDice[0]?.original) ?? 10;
      const location           = _duelGetLocation(locationRoll);
      const atkDoc             = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
      const atkActor           = atkDoc?.actor ?? atkDoc;
      const isCreatureAttacker = atkActor?.type === "creature";
      const isBeastAttack      = isCreatureAttacker && !state.weaponId;
      const netSuccesses       = state.hits.length;

      let affordableBeastActions = [];
      if (isBeastAttack && netSuccesses > 0 && atkActor) {
        const { MeleeActionRegistry } = await import("./melee-action-registry.js");
        const beastItemFilter = state.beastItemId ?? null;
        affordableBeastActions = MeleeActionRegistry.collectAffordableBeastActions(
          atkActor, beastItemFilter, netSuccesses
        );
      }

      await message.setFlag("neuroshima", "opposedResult", {
        attackerUuid:          state.attackerUuid,
        defenderUuid:          state.defenderUuid,
        weaponId:              state.weaponId,
        beastItemId:           state.beastItemId ?? null,
        hits:                  state.hits,
        location,
        escapeeUuid:           state._escapeeUuid ?? null,
        damage1:               state.damage1,
        damage2:               state.damage2,
        damage3:               state.damage3,
        netSuccesses,
        affordableBeastActions,
        isBeastAttack,
        pendingBeastQueue:     state.committedBeastQueue ?? null,
        pendingTrickQueue:     state.allTrickQueue?.length > 0 ? state.allTrickQueue : null,
        counterHits:           state.counterHits?.length > 0 ? state.counterHits : null,
        trickOnHitScripts:     state.trickOnHitScripts ?? null,
        applied:               false,
        beastActionsApplied:   false
      });
    }

    await onRender(message, state);

    if (state.status === "done") {
      const atkDoc = fromUuidSync(state.attackerTokenUuid || state.attackerUuid);
      const defDoc = fromUuidSync(state.defenderTokenUuid || state.defenderUuid);
      await onClearManeuvers(atkDoc?.actor ?? atkDoc);
      await onClearManeuvers(defDoc?.actor ?? defDoc);
      game.neuroshima?.log("[melee-opposed-chat.applyDuelBatch] maneuver conditions cleared after done", {
        attacker: state.attackerTokenUuid || state.attackerUuid,
        defender: state.defenderTokenUuid || state.defenderUuid
      });
      const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
      for (const doc of [atkDoc, defDoc]) {
        const actor = doc?.actor ?? doc;
        if (!actor) continue;
        await NeuroshimaScriptRunner.execute("meleeUpdate", {
          actor, phase: "turn-end",
          encounter: null, encounterId: null,
          participant: null, participantId: null,
          state
        });
      }
      await DuelLifecycle.end(DuelContext.fromFlag(state));
    }

    return true;
  }
}
