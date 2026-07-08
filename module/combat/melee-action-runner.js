/**
 * @file melee-action-runner.js
 * @description Execution layer for melee action outcomes in Neuroshima 1.5.
 *
 * MeleeActionRunner is the single execution point for all side-effects that
 * arise from a melee action resolving.  It replaces ad-hoc inline code in
 * MeleeOpposedChat and provides named, well-documented entry points that
 * effect scripts and other systems can also use.
 *
 * Responsibilities:
 *   - Fire onHitScripts (immediate and deferred) for trick actions
 *   - Apply trick hit damage through CombatHelper.applyDamageToActor
 *   - Apply queued-trick damage (successCost tricks from the queue section)
 *
 * Out of scope (handled elsewhere):
 *   - Duel card state mutation (applyDuelBatch / MeleeOpposedChat)
 *   - Beast activity effect application (applyBeastActions)
 *   - Damage accumulation display / notifications (applyOpposedDamage)
 *
 * ── Execution flow overview ─────────────────────────────────────────────────
 *
 *  Segment resolves → applyDuelBatch records hitEntry in state.hits
 *    → MeleeActionRunner.onHit({ state, hitEntry, isOwnerAttacker })
 *        └─ fireImmediateOnHitScript (fires during resolution if trick.immediate)
 *
 *  GM clicks "Apply Damage" → applyOpposedDamage iterates state.hits
 *    → for trick hits:
 *        MeleeActionRunner.fireOnHitScript(hit, rd, attackerActor, targetActor)
 *        MeleeActionRunner.applyTrickHitDamage(hit, context) → batch
 *    → for queue tricks (successCost):
 *        MeleeActionRunner.applyQueueTrickEntry(entry, context) → batch
 */

import { MeleeActionRegistry } from "./melee-action-registry.js";

export class MeleeActionRunner {

  // ── Segment-time execution ─────────────────────────────────────────────────

  /**
   * Entry point called immediately when a segment resolves to "hit" for an action.
   * Currently handles immediate-onHitScript execution for trick hits.
   * Deferred damage and non-immediate scripts are handled by applyOpposedDamage.
   *
   * @param {object}  args
   * @param {object}  args.state           - Duel card state flag object (mutable)
   * @param {object}  args.hitEntry        - The hit entry being added: { tier, damageType, trickId }
   * @param {boolean} args.isOwnerAttacker - True when the initiative owner is the attacker
   * @returns {Promise<void>}
   */
  static async onHit({ state, hitEntry, isOwnerAttacker }) {
    if (hitEntry.trickId) {
      await MeleeActionRunner.fireImmediateOnHitScript(state, hitEntry, isOwnerAttacker);
    }
  }

  /**
   * Fire the "immediate" onHitScript for a trick hit entry.
   *
   * Immediate scripts run at duel RESOLUTION time (inside applyDuelBatch) rather than
   * at damage-apply time (inside applyOpposedDamage).  Use this timing for effects that
   * must take place before the next segment begins, such as status effects, initiative
   * manipulation, or disarm triggers.
   *
   * A script is considered immediate when trickOnHitScripts[trickId].immediate === true.
   * Scripts without the immediate flag are handled by fireOnHitScript instead.
   *
   * Extracted from MeleeOpposedChat._fireImmediateOnHitScript.
   *
   * @param {object}  state           - Duel card state flag (mutable)
   * @param {object}  hitEntry        - { tier, damageType, trickId }
   * @param {boolean} isOwnerAttacker - True when the initiative owner is the attacker
   * @returns {Promise<void>}
   */
  static async fireImmediateOnHitScript(state, hitEntry, isOwnerAttacker) {
    const entry = state.trickOnHitScripts?.[hitEntry.trickId];
    if (!entry?.immediate) return;
    try {
      const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
      const effect = entry.effectUuid ? fromUuidSync(entry.effectUuid) : null;

      const ownerDoc = fromUuidSync(isOwnerAttacker
        ? (state.attackerTokenUuid || state.attackerUuid)
        : (state.defenderTokenUuid || state.defenderUuid));
      const ownerActor  = ownerDoc?.actor ?? ownerDoc;

      const targetDoc = fromUuidSync(isOwnerAttacker
        ? (state.defenderTokenUuid || state.defenderUuid)
        : (state.attackerTokenUuid || state.attackerUuid));
      const targetActor = targetDoc?.actor ?? targetDoc;

      const scriptObj = new NeuroshimaScript(
        { code: entry.code, trigger: "onMeleeHit", label: "onHitScript:immediate" },
        effect
      );
      await scriptObj.execute({ actor: ownerActor, target: targetActor, state, hit: hitEntry });
      game.neuroshima?.log?.("[MeleeActionRunner] immediate onHitScript executed", hitEntry.trickId);
    } catch (err) {
      game.neuroshima?.log?.("[MeleeActionRunner] immediate onHitScript error", hitEntry.trickId, err);
    }
  }

  // ── Damage-apply-time execution ────────────────────────────────────────────

  /**
   * Fire the deferred onHitScript for a trick hit entry.
   * Called by applyOpposedDamage when the GM confirms damage application.
   *
   * Deferred scripts (immediate === false or absent) run at apply-time so they can
   * use the final resolved actor state (e.g. after wounds are applied to the target).
   * Examples: Aramis – Rozbrojenie (script replaces damage), Boa – Pochwycenie.
   *
   * @param {object}  hit            - Hit entry from opposedResult.hits: { tier, damageType, trickId }
   * @param {object}  rd             - Opposed result flag data (read-only at this point)
   * @param {Actor}   attackerActor
   * @param {Actor}   targetActor
   * @returns {Promise<void>}
   */
  static async fireOnHitScript(hit, rd, attackerActor, targetActor) {
    const entry = rd.trickOnHitScripts?.[hit.trickId];
    if (!entry) return;
    try {
      const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
      const onHitCode  = typeof entry === "string" ? entry : entry.code;
      const effectUuid = typeof entry === "string" ? null  : entry.effectUuid;
      const effect     = effectUuid ? fromUuidSync(effectUuid) : null;
      const scriptObj  = new NeuroshimaScript(
        { code: onHitCode, trigger: "onMeleeHit", label: "onHitScript" },
        effect
      );
      await scriptObj.execute({ actor: attackerActor, target: targetActor, state: rd, hit });
      game.neuroshima?.log?.("[MeleeActionRunner] onHitScript executed for trick", hit.trickId);
    } catch (err) {
      game.neuroshima?.log?.("[MeleeActionRunner] onHitScript error for trick", hit.trickId, err);
    }
  }

  /**
   * Apply damage for a single trick hit entry to the target actor.
   *
   * Parses the damage spec string (e.g. "D", "sC", "2L + 1D") and calls
   * CombatHelper.applyDamageToActor once per wound token.  Each wound goes through
   * the full damage pipeline: preApplyDamage → armor reduction → takeDamage.
   *
   * Returns an accumulated batch result so the caller can aggregate wounds and
   * display a single pain-resistance report.
   *
   * Extracted from the trick-hit branch of MeleeOpposedChat.applyOpposedDamage.
   *
   * @param {object}   hit                    - { tier, damageType, trickId }
   * @param {object}   context
   * @param {Actor}    context.attackerActor
   * @param {Actor}    context.targetActor
   * @param {Item|null} context.weaponItem    - May be null for unarmed attacks
   * @param {object}   context.rd             - Opposed result flag data
   * @param {object}   context.CombatHelper   - Imported CombatHelper module
   * @returns {Promise<{ results: any[], woundIds: string[], reduced: number, reducedDetails: any[] }>}
   */
  static async applyTrickHitDamage(hit, { attackerActor, targetActor, weaponItem, rd, CombatHelper }) {
    const trickWounds = MeleeActionRegistry.parseDamageSpec(hit.damageType);
    game.neuroshima?.log?.("[MeleeActionRunner] applying trick hit damage",
      { trickId: hit.trickId, damageType: hit.damageType, wounds: trickWounds });

    const allResults       = [];
    const allWoundIds      = [];
    let   totalReduced     = 0;
    const allReducedDetails = [];

    if (trickWounds.length === 0) return { results: [], woundIds: [], reduced: 0, reducedDetails: [] };

    for (const woundType of trickWounds) {
      const attackData = {
        isMelee:       true,
        actorId:       attackerActor?.id,
        weaponId:      rd.weaponId,
        label:         weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed"),
        damageMelee1:  woundType,
        damageMelee2:  woundType,
        damageMelee3:  woundType,
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
    }
    return { results: allResults, woundIds: allWoundIds, reduced: totalReduced, reducedDetails: allReducedDetails };
  }

  /**
   * Process a single entry from the pending trick queue (successCost tricks).
   *
   * Queue tricks are pre-paid at the start of the segment: the player spends successes
   * before the dice comparison occurs.  They always trigger regardless of segment outcome.
   *
   * Handles both the onHitScript and the damage application for one queue entry.
   * Returns an accumulated batch result or null if there is no damage.
   *
   * Extracted from the pendingTrickQueue loop in MeleeOpposedChat.applyOpposedDamage.
   *
   * @param {string}   trickEntry             - Legacy "trick:ID:damage" string
   * @param {object}   context
   * @param {Actor}    context.attackerActor
   * @param {Actor}    context.defenderActor
   * @param {Item|null} context.weaponItem
   * @param {object}   context.rd
   * @param {object}   context.CombatHelper
   * @returns {Promise<{ results: any[], woundIds: string[], reduced: number, reducedDetails: any[] }|null>}
   */
  static async applyQueueTrickEntry(trickEntry, { attackerActor, defenderActor, weaponItem, rd, CombatHelper }) {
    if (!trickEntry?.startsWith("trick:")) return null;

    const firstColon  = trickEntry.indexOf(":");
    const secondColon = trickEntry.indexOf(":", firstColon + 1);
    const trickId     = secondColon > firstColon + 1
      ? trickEntry.slice(firstColon + 1, secondColon)
      : trickEntry.slice(firstColon + 1);
    const trickDamage = secondColon !== -1 ? trickEntry.slice(secondColon + 1) : "";

    if (!trickId) return null;

    if (rd.trickOnHitScripts?.[trickId]) {
      try {
        const { NeuroshimaScript } = await import("../apps/neuroshima-script-engine.js");
        const entry2      = rd.trickOnHitScripts[trickId];
        const onHitCode   = typeof entry2 === "string" ? entry2 : entry2.code;
        const effectUuid  = typeof entry2 === "string" ? null   : entry2.effectUuid;
        const effect      = effectUuid ? fromUuidSync(effectUuid) : null;
        const scriptObj   = new NeuroshimaScript(
          { code: onHitCode, trigger: "getMeleeActions", label: "onHitScript" },
          effect
        );
        await scriptObj.execute({
          actor:  attackerActor,
          target: defenderActor,
          state:  rd,
          hit:    { trickId, damageType: trickDamage, tier: 1 }
        });
        game.neuroshima?.log?.("[MeleeActionRunner] queue trick onHitScript executed", trickId);
      } catch (err) {
        game.neuroshima?.log?.("[MeleeActionRunner] queue trick onHitScript error", trickId, err);
      }
    }

    const queueWounds = MeleeActionRegistry.parseDamageSpec(trickDamage);
    game.neuroshima?.log?.("[MeleeActionRunner] queue trick damage",
      { trickId, trickDamage, wounds: queueWounds });

    if (queueWounds.length === 0) return null;

    const allResults       = [];
    const allWoundIds      = [];
    let   totalReduced     = 0;
    const allReducedDetails = [];

    for (const woundType of queueWounds) {
      const attackData = {
        isMelee:       true,
        actorId:       attackerActor?.id,
        label:         `${weaponItem?.name ?? game.i18n.localize("NEUROSHIMA.MeleeDuel.Unarmed")} (sztuczka)`,
        damageMelee1:  woundType,
        damageMelee2:  woundType,
        damageMelee3:  woundType,
        finalLocation: rd.location,
        successPoints: 1
      };
      const batch = await CombatHelper.applyDamageToActor(defenderActor, attackData, {
        isOpposed:    true,
        spDifference: 1,
        location:     rd.location,
        suppressChat: true
      });
      if (batch) {
        allResults.push(...(batch.results ?? []));
        allWoundIds.push(...(batch.woundIds ?? []));
        totalReduced += batch.reducedProjectiles ?? 0;
        allReducedDetails.push(...(batch.reducedDetails ?? []));
      }
    }
    return { results: allResults, woundIds: allWoundIds, reduced: totalReduced, reducedDetails: allReducedDetails };
  }
}
