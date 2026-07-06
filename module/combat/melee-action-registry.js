/**
 * @file melee-action-registry.js
 * @description Data layer for melee action normalization in Neuroshima 1.5.
 *
 * MeleeActionRegistry collects and normalizes melee action entries from every
 * source the system recognizes:
 *   - beast-action item activities (creature actors, success-cost)
 *   - legacy trick queue strings: "trick:ID:damage"
 *   - (future) getMeleeActions effect scripts (non-creature actors)
 *
 * The registry is a PURE DATA LAYER.  It never executes scripts, applies
 * effects, or mutates combat state.  All execution is delegated to
 * MeleeActionRunner and the existing combat.js pipeline.
 *
 * ── MeleeAction descriptor ──────────────────────────────────────────────────
 * Every normalized action is a plain object conforming to:
 *
 *   {
 *     id:               string      — composite "itemId::actId", trick id, etc.
 *     name:             string      — display name
 *     img:              string|null — image path
 *     type:             "beastActivity" | "trick" | "effectAction" | "weapon"
 *     sourceItemId:     string|null — id of originating Item
 *     sourceItemUuid:   string|null — uuid of originating Item
 *     sourceEffectUuid: string|null — uuid of originating ActiveEffect
 *     activityId:       string|null — activity.id within the source item
 *     costType:         "success" | "dice" | "segment"
 *     successCost:      number      — successes required (for costType "success")
 *     damage:           string|null — raw damage spec ("D", "sC", "2L + 1D", …)
 *     effectIds:        string[]    — ids of linked effects on the source item
 *     effectTiming:     "onUse" | "onHit" | "afterDamage"
 *     effectTarget:     "self" | "target" | "selected" | "manual"
 *     onHitScript:              string|null — JS code executed on hit (null = none)
 *     immediateOnHit:           boolean     — true → fire during resolution, not at apply-time
 *     gmNote:                   string      — GM-facing note from the activity definition
 *     applyEffectsAutomatically: boolean    — false → skip auto-apply (effects are manual/scripted)
 *     resolverKind:             "opposedMelee" | "directApply" — how the action resolves
 *     isAffordable:             boolean     — UI hint: action fits within current success budget
 *     hasEffects:               boolean     — shorthand for effectIds.length > 0
 *   }
 */

export class MeleeActionRegistry {

  // ── Damage spec parsing ────────────────────────────────────────────────────

  /**
   * Parse a damage spec string into an array of wound-type tokens.
   *
   * Format (case-sensitive wound abbreviations):
   *   ""          → []
   *   "—"         → []          (placeholder for "no damage")
   *   "D"         → ["D"]
   *   "sC"        → ["sC"]
   *   "3D"        → ["D","D","D"]
   *   "2L + 1D"   → ["L","L","D"]
   *
   * This method is the canonical implementation.  MeleeOpposedChat._parseDamageSpec
   * delegates to this method for backward compatibility.
   *
   * @param {string|null|undefined} damage
   * @returns {string[]} Array of wound-type strings; empty when there is no damage.
   */
  static parseDamageSpec(damage) {
    if (!damage || damage === "—") return [];
    const segments = damage.split(/\s*\+\s*/);
    const result = [];
    for (const seg of segments) {
      const m = seg.trim().match(/^(\d+)?([A-Za-z]+)$/);
      if (!m) continue;
      const n    = m[1] ? parseInt(m[1], 10) : 1;
      const type = m[2];
      for (let i = 0; i < n; i++) result.push(type);
    }
    return result;
  }

  // ── Beast action collection ────────────────────────────────────────────────

  /**
   * Collect and normalize all success-cost beast-action activities for a creature actor.
   * Used by MeleeOpposedChat._buildDuelContext to populate the action picker UI while
   * the initiative owner is choosing their committed dice.
   *
   * Only activities with costType === "success" are included; segment-cost activities
   * are handled by a separate pipeline.
   *
   * @param {Actor}       actor                 - The creature actor owning the beast-action items
   * @param {string|null} beastItemFilter        - When set, only include activities from this item id
   * @param {number}      committedSuccessCount  - Number of successes the owner has committed so far
   *                                              (used to set isAffordable on each action)
   * @returns {MeleeAction[]} Sorted ascending by successCost
   */
  static collectBeastActions(actor, beastItemFilter, committedSuccessCount) {
    const flat = [];
    for (const item of actor.items.filter(i =>
      i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter)
    )) {
      for (const act of (item.system.activities ?? [])) {
        if (act.costType !== "success") continue;
        flat.push(MeleeActionRegistry._normalizeBeastActivity(item, act, committedSuccessCount));
      }
    }
    return flat.sort((a, b) => a.successCost - b.successCost);
  }

  /**
   * Collect success-cost beast-action activities that are affordable given the net success budget.
   * Used by MeleeOpposedChat.applyDuelBatch when the duel resolves (state.status === "done")
   * to populate the list of actions the creature can spend their net successes on.
   *
   * @param {Actor}       actor           - The creature actor
   * @param {string|null} beastItemFilter - When set, only include activities from this item id
   * @param {number}      netSuccesses    - Total successes available for spending
   * @returns {MeleeAction[]} Sorted ascending by successCost
   */
  static collectAffordableBeastActions(actor, beastItemFilter, netSuccesses) {
    const flat = [];
    for (const item of actor.items.filter(i =>
      i.type === "beast-action" && (!beastItemFilter || i.id === beastItemFilter)
    )) {
      for (const act of (item.system.activities ?? [])) {
        if (act.costType !== "success") continue;
        if ((act.successCost ?? 1) > netSuccesses) continue;
        flat.push(MeleeActionRegistry._normalizeBeastActivity(item, act, netSuccesses));
      }
    }
    return flat.sort((a, b) => a.successCost - b.successCost);
  }

  // ── Queue normalization ────────────────────────────────────────────────────

  /**
   * Split a raw queue array (as passed to applyDuelBatch) into beast activity ids and
   * normalized trick action descriptors.
   *
   * Beast entries are raw composite id strings ("itemId::activityId").
   * Trick entries begin with the prefix "trick:" and are parsed into MeleeAction objects.
   *
   * @param {string[]|null} rawQueue
   * @returns {{ beastEntries: string[], trickActions: MeleeAction[] }}
   */
  static splitQueue(rawQueue) {
    if (!Array.isArray(rawQueue)) return { beastEntries: [], trickActions: [] };
    const beastEntries = [];
    const trickActions = [];
    for (const entry of rawQueue) {
      if (typeof entry !== "string") continue;
      if (entry.startsWith("trick:")) {
        const action = MeleeActionRegistry.parseTrickString(entry);
        if (action) trickActions.push(action);
      } else {
        beastEntries.push(entry);
      }
    }
    return { beastEntries, trickActions };
  }

  /**
   * Parse a legacy trick queue string ("trick:ID:damage") into a normalized MeleeAction.
   * Returns null when the entry is not a valid trick string.
   *
   * The damage field may contain the full damage spec including ":" separators, so
   * everything after the second ":" is treated as part of the damage string.
   *
   * @param {string} entry - e.g. "trick:barbarka-headbutt:sC" or "trick:disarm:"
   * @returns {MeleeAction|null}
   */
  static parseTrickString(entry) {
    if (!entry?.startsWith("trick:")) return null;
    const firstColon  = entry.indexOf(":");           // after "trick"
    const secondColon = entry.indexOf(":", firstColon + 1);
    const id          = secondColon > firstColon + 1
      ? entry.slice(firstColon + 1, secondColon)
      : entry.slice(firstColon + 1);
    const damage = secondColon !== -1 ? (entry.slice(secondColon + 1) || null) : null;
    if (!id) return null;

    return {
      id,
      name:             id,
      img:              null,
      type:             "trick",
      sourceItemId:     null,
      sourceItemUuid:   null,
      sourceEffectUuid: null,
      activityId:       null,
      costType:         "success",
      successCost:      1,
      damage,
      effectIds:        [],
      effectTiming:     "onHit",
      effectTarget:     "target",
      onHitScript:      null,
      immediateOnHit:   false,
      gmNote:           "",
      isAffordable:     true,
      hasEffects:       false
    };
  }

  /**
   * Serialize a normalized trick MeleeAction back to the legacy queue string format.
   * Used when the action must be passed through the existing string-based queue pipeline
   * for backward compatibility.
   *
   * @param {MeleeAction} action
   * @returns {string} e.g. "trick:barbarka-headbutt:sC"
   */
  static serializeTrickLegacy(action) {
    return `trick:${action.id}:${action.damage ?? ""}`;
  }

  // ── Effect-action normalization (non-creature actors) ─────────────────────

  /**
   * Normalize a single raw action entry produced by a `getMeleeActions` effect script into a
   * canonical `MeleeAction` descriptor.  Fills defaults for any missing fields.
   *
   * @param {object} entry               - Raw entry as pushed by a getMeleeActions script
   * @param {number} [availableSuccesses=0]
   * @returns {MeleeAction}
   */
  static normalizeEffectAction(entry, availableSuccesses = 0) {
    const successCost = entry.successCost ?? 0;
    const effectIds   = Array.isArray(entry.effectIds) ? entry.effectIds : [];
    return {
      id:                       entry.id             ?? `trick-${foundry.utils.randomID(8)}`,
      name:                     entry.name           ?? entry.label ?? "Sztuczka",
      img:                      entry.img            ?? "systems/neuroshima/assets/effects/gears.svg",
      type:                     "effectAction",
      sourceItemId:             null,
      sourceItemUuid:           null,
      sourceEffectUuid:         entry._effectUuid    ?? null,
      activityId:               null,
      costType:                 successCost > 0 ? "success" : "dice",
      successCost,
      damage:                   entry.damage         ?? null,
      effectIds,
      effectTiming:             entry.effectTiming   ?? "onHit",
      effectTarget:             entry.effectTarget   ?? "target",
      onHitScript:              entry.onHitScript    ?? null,
      immediateOnHit:           entry.immediateOnHit ?? false,
      gmNote:                   entry.gmNote ?? entry.annotation ?? "",
      applyEffectsAutomatically: entry.applyEffectsAutomatically ?? true,
      resolverKind:             entry.resolverKind   ?? "opposedMelee",
      minDice:                  entry.minDice        ?? 1,
      maxDice:                  entry.maxDice        ?? 3,
      isAffordable:             successCost === 0 || availableSuccesses >= successCost,
      hasEffects:               effectIds.length > 0
    };
  }

  /**
   * Normalize an array of raw `getMeleeActions` entries (from effect scripts) into canonical
   * `MeleeAction` descriptors.  Null / undefined entries are filtered out.
   *
   * @param {Array}  rawEntries         - Array of raw entries as pushed by getMeleeActions scripts
   * @param {number} [availableSuccesses=0]
   * @returns {MeleeAction[]}
   */
  static normalizeEffectActions(rawEntries, availableSuccesses = 0) {
    if (!Array.isArray(rawEntries)) return [];
    return rawEntries
      .filter(e => e != null)
      .map(e => MeleeActionRegistry.normalizeEffectAction(e, availableSuccesses));
  }

  /**
   * Collect all normalized melee actions for an actor.
   *
   * For creature actors (`actor.type === "beast"` or similar), delegates to
   * `collectBeastActions`.  For non-creature actors, normalizes the pre-collected
   * `extraActionsArr` produced by the `getMeleeActions` trigger.
   *
   * @param {Actor}  actor
   * @param {object} [options={}]
   * @param {boolean} [options.isCreature=false]        - When true, use beast activity collection
   * @param {string|null} [options.beastItemFilter=null] - Beast item filter (creature only)
   * @param {number} [options.availableSuccesses=0]     - Success budget for affordability check
   * @param {Array|null} [options.extraActionsArr=null] - Pre-collected script entries (non-creature)
   * @returns {MeleeAction[]}
   */
  static collectForActor(actor, {
    isCreature          = false,
    beastItemFilter     = null,
    availableSuccesses  = 0,
    extraActionsArr     = null
  } = {}) {
    if (isCreature) {
      return MeleeActionRegistry.collectBeastActions(actor, beastItemFilter, availableSuccesses);
    }
    if (!extraActionsArr?.length) return [];
    return MeleeActionRegistry.normalizeEffectActions(extraActionsArr, availableSuccesses);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Normalize a single beast-action activity object into a MeleeAction descriptor.
   * Reads all available fields from the activity and fills defaults for any that are absent.
   *
   * @param {Item}   item               - The beast-action Item document
   * @param {object} act                - Activity data from item.system.activities
   * @param {number} availableSuccesses - Used to compute the isAffordable flag
   * @returns {MeleeAction}
   */
  static _normalizeBeastActivity(item, act, availableSuccesses) {
    const successCost = act.successCost ?? 1;
    return {
      id:                       `${item.id}::${act.id}`,
      name:                     act.name  || item.name,
      img:                      act.img   || item.img,
      type:                     "beastActivity",
      sourceItemId:             item.id,
      sourceItemUuid:           item.uuid,
      sourceEffectUuid:         null,
      activityId:               act.id,
      costType:                 "success",
      successCost,
      damage:                   act.damage       || null,
      effectIds:                act.effectIds    ?? [],
      effectTiming:             act.effectTiming ?? "onUse",
      effectTarget:             act.effectTarget ?? "target",
      onHitScript:              null,
      immediateOnHit:           false,
      gmNote:                   act.gmNote ?? "",
      applyEffectsAutomatically: act.applyEffectsAutomatically ?? true,
      resolverKind:             act.resolverKind ?? "opposedMelee",
      isAffordable:             availableSuccesses >= successCost,
      hasEffects:               (act.effectIds?.length ?? 0) > 0
    };
  }
}
