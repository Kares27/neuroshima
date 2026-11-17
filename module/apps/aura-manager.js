import { stampEffectStart, effectHasExpired, NeuroshimaAreas } from "../helpers/foundry-compat.js";
/**
 * Manages Aura (anchored to actor token) and Area (static template) effect transfer types.
 *
 * Aura copies on target actors are tagged:
 *   flags.neuroshima.fromAura = { sourceEffectId, sourceActorId }
 *
 * Area copies on target actors are tagged:
 *   flags.neuroshima.fromArea = { templateId, sourceEffectId, sourceActorId }
 */
export class NeuroshimaAuraManager {

  static semaphore = new foundry.utils.Semaphore(1);

  static _isActive(effect) {
    return !effect.disabled && !effect.isSuppressed && !effectHasExpired(effect);
  }

  static async _resolveSource(uuid) {
    try { return await fromUuid(uuid); }
    catch (error) {
      game.neuroshima?.log("Aura/Area | Unavailable source", { uuid, error });
      return null;
    }
  }

  // ─── Script helpers ───────────────────────────────────────────────────────

  /**
   * Execute a raw script string with the given context variables.
   * Used for filterScript and preApplyScript.
   * @param {string}  code     - Script to run
   * @param {object}  context  - Variables injected into scope
   * @returns {*} Script return value, or undefined on error
   */
  static async _evalScript(code, context = {}) {
    if (!code?.trim()) return undefined;
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction(...Object.keys(context), `"use strict";\n${code}`);
      return await fn(...Object.values(context));
    } catch (e) {
      console.error("NS | Aura/Area script error:", e);
    }
  }

  /**
   * Build a set of helper functions injected into filter/preApply script contexts.
   *
   * Helpers available in filterScript  (actor = targetActor, sourceActor = sourceActor):
   *   isFriendlyToken(actor)          — true if the token's disposition is FRIENDLY
   *   isHostileToken(actor)           — true if the token's disposition is HOSTILE
   *   isNeutralToken(actor)           — true if the token's disposition is NEUTRAL
   *   isActorType(actor, type)        — true if actor.type === type (e.g. "character", "creature")
   *   isSameDisposition(actorA, actorB) — true if both tokens share the same disposition
   *
   * @returns {object} Plain helper functions to spread into an eval context.
   */
  static _buildAuraScriptHelpers() {
    const getTokenDisposition = (a) => {
      const tokenDoc = a?.getActiveTokens?.()?.[0]?.document;
      if (tokenDoc?.disposition !== undefined) return tokenDoc.disposition;
      const proto = a?.prototypeToken?.disposition;
      return proto !== undefined ? proto : null;
    };
    return {
      /**
       * Returns true when the actor's scene token has FRIENDLY disposition.
       * Falls back to prototypeToken disposition when no scene token is present.
       * @param {Actor} a
       */
      isFriendlyToken: (a) => getTokenDisposition(a) === CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      /**
       * Returns true when the actor's scene token has HOSTILE disposition.
       * @param {Actor} a
       */
      isHostileToken:  (a) => getTokenDisposition(a) === CONST.TOKEN_DISPOSITIONS.HOSTILE,
      /**
       * Returns true when the actor's scene token has NEUTRAL disposition.
       * @param {Actor} a
       */
      isNeutralToken:  (a) => getTokenDisposition(a) === CONST.TOKEN_DISPOSITIONS.NEUTRAL,
      /**
       * Returns true when actor.type equals the given type string.
       * Common types: "character", "creature", "npc", "vehicle", "homeBase".
       * @param {Actor}  a
       * @param {string} type
       */
      isActorType: (a, type) => a?.type === type,
      /**
       * Returns true when both actors share the same token disposition.
       * Useful for filtering auras to allies or enemies.
       * @param {Actor} a
       * @param {Actor} b
       */
      isSameDisposition: (a, b) => {
        const da = getTokenDisposition(a);
        const db = getTokenDisposition(b);
        return da !== null && db !== null && da === db;
      }
    };
  }

  /**
   * Run preApplyScript for an effect.
   * Runs on source actor context. Returns false → prevents application.
   * Context variables: actor (source), effect, targetActor + filter helpers.
   * @param {ActiveEffect} effect
   * @param {Actor}        sourceActor
   * @param {Actor}        targetActor
   * @returns {boolean} true = proceed, false = blocked
   */
  static async _runPreApplyScript(effect, sourceActor, targetActor) {
    const code = effect.getFlag("neuroshima", "preApplyScript");
    if (!code?.trim()) return true;
    const helpers = this._buildAuraScriptHelpers();
    const result = await this._evalScript(code, { actor: sourceActor, effect, targetActor, ...helpers });
    return result !== false;
  }

  /**
   * Run filterScript for an effect against a specific target actor.
   * Returns true → PREVENTS application.
   * Context variables: actor (target), effect, sourceActor + filter helpers.
   * @param {ActiveEffect} effect
   * @param {Actor}        targetActor
   * @param {Actor}        sourceActor
   * @returns {boolean} true = blocked, false = proceed
   */
  static async _runFilterScript(effect, targetActor, sourceActor) {
    const code = effect.getFlag("neuroshima", "filterScript");
    if (!code?.trim()) return false;
    const helpers = this._buildAuraScriptHelpers();
    const result = await this._evalScript(code, { actor: targetActor, effect, sourceActor, ...helpers });
    return !!result;
  }

  // ─── Render Aura (visual MeasuredTemplate) ───────────────────────────────

  /**
   * Ensure a visual area (MeasuredTemplate V13 / Region V14) exists for every active auraActor effect
   * positioned at the source token center. V13 visuals are optional; V14 uses
   * Region visibility modes unless the user explicitly disables the visual area.
   *
   * Called in three situations:
   *   1. Token moves (updateToken hook) — updates position only.
   *   2. Effect flags change (updateActiveEffect hook) — updates ALL visual properties
   *      including radius and the appearance supported by the current generation so that the canvas
   *      immediately reflects a changed auraRadius or templateData without requiring a
   *      token move or toggle cycle.
   *   3. Canvas ready / token created — initial placement.
   *
   * The method also removes orphan templates whose source effect has been deleted or
   * disabled (by comparing the set of active auraRender effect IDs against all templates
   * tagged with flags.neuroshima.auraVisual for this actor).
   *
   * @param {TokenDocument}              sourceToken
   * @param {Actor}                      sourceActor
   * @param {TokenDocument|null}         movedToken       - Token that just moved (may be null).
   * @param {{x:number,y:number}|null}   movedTokenNewPos - Pre-computed pixel position from
   *                                                         preUpdateToken; avoids stale-doc issues.
   */
  static async _syncRenderTemplates(sourceToken, sourceActor, movedToken, movedTokenNewPos) {
    if (!canvas?.scene) return;
    const auraEffects = this._getActorAuraEffects(sourceActor).filter(e =>
      this._isActive(e) && Number(e.getFlag("neuroshima", "auraRadius")) > 0 &&
      !e.getFlag("neuroshima", "auraTransferred") &&
      NeuroshimaAreas.rendersAura(e)
    );

    const allTemplates = NeuroshimaAreas.documents();

    for (const effect of auraEffects) {
      const radiusUnits = Number(effect.getFlag("neuroshima", "auraRadius") ?? 0);
      if (!radiusUnits) continue;

      const posData = this._resolveTokenPos(sourceToken, movedToken, movedTokenNewPos);
      const gs = canvas.grid.size;
      const cx = posData.x + (posData.width  * gs) / 2;
      const cy = posData.y + (posData.height * gs) / 2;

      const tplData = effect.getFlag("neuroshima", "templateData") ?? {};
      const fillColor   = tplData.fillColor   ?? game.user?.color?.css ?? "#4444ff";
      const borderColor = tplData.borderColor ?? fillColor;
      const fillOpacity = tplData.fillOpacity ?? 0.1;

      const existing = allTemplates.find(t =>
        t.getFlag("neuroshima", "auraVisual")?.effectId === effect.id &&
        this._matchesVisualSource(t.getFlag("neuroshima", "auraVisual"), sourceActor.id, sourceActor.uuid)
      );

      if (existing) {
        // Update ALL visual properties — not just position — so that a radius or
        // colour change applied via Advanced Config is immediately reflected on the
        // canvas without the user needing to move the token or toggle the effect.
        await NeuroshimaAreas.update(existing, {
          x: cx,
          y: cy,
          distance: radiusUnits,
          fillColor,
          borderColor,
          fillAlpha: fillOpacity,
          ...NeuroshimaAreas.auraAppearance(effect, sourceToken),
          "flags.neuroshima.auraVisual": { effectId: effect.id, actorId: sourceActor.id, actorUuid: sourceActor.uuid, tokenId: sourceToken.id }
        }, { skipAreaCheck: true, ns_skipAuraCheck: true });
      } else {
        await NeuroshimaAreas.create( [{
          t: "circle",
          x: cx,
          y: cy,
          distance: radiusUnits,
          fillColor,
          borderColor,
          fillAlpha: fillOpacity,
          hidden: false,
          ...NeuroshimaAreas.auraAppearance(effect, sourceToken),
          flags: {
            neuroshima: {
              auraVisual: { effectId: effect.id, actorId: sourceActor.id, actorUuid: sourceActor.uuid, tokenId: sourceToken.id }
            }
          }
        }], { ns_skipAuraCheck: true });
      }
    }

    const activeEffectIds = new Set(auraEffects.map(e => e.id));
    for (const t of allTemplates) {
      const av = t.getFlag("neuroshima", "auraVisual");
      if (!this._matchesVisualSource(av, sourceActor.id, sourceActor.uuid)) continue;
      if (!activeEffectIds.has(av.effectId)) {
        await t.delete();
      }
    }
  }

  /**
   * Remove all visual aura templates for a given actor (or a specific effect).
   * @param {string}      sourceActorId
   * @param {string|null} effectId  - If null, removes all for the actor.
   */
  static _matchesVisualSource(visual, actorId, actorUuid = null) {
    return Boolean(visual && (actorUuid && visual.actorUuid ? visual.actorUuid === actorUuid : visual.actorId === actorId));
  }

  static async _removeRenderTemplates(sourceActorId, effectId = null, sourceActorUuid = null) {
    if (!canvas?.scene) return;
    const toDelete = NeuroshimaAreas.documents().filter(t => {
      const av = t.getFlag("neuroshima", "auraVisual");
      if (!av) return false;
      if (!this._matchesVisualSource(av, sourceActorId, sourceActorUuid)) return false;
      return effectId === null || av.effectId === effectId;
    });
    for (const t of toDelete) await t.delete();
  }

  // ─── Aura (anchored to token) ────────────────────────────────────────────

  /**
   * Refresh all aura effects across the entire scene.
   *
   * @param {TokenDocument|null} movedToken    - The token that just moved (from updateToken hook).
   * @param {{x:number,y:number}|null} movedTokenNewPos
   *   New pixel position captured in preUpdateToken from the `changes` object.
   *   This is the authoritative new position; it avoids any stale-document issues
   *   where the EmbeddedCollection might not yet reflect the update when the hook fires.
   */
  static async refreshAllAuras(movedToken = null, movedTokenNewPos = null) {
    return this.semaphore.add(async () => {
      if (!canvas?.scene) return;
      game.neuroshima?.log("Aura | refreshAllAuras", {
        movedTokenId: movedToken?.id ?? null,
        movedTokenNewPos
      });

      const isLinkedUuid = (uuid) => !uuid.includes(".Token.");

      const sourceTokenByActorUuid = new Map();
      for (const tokenDoc of canvas.scene.tokens) {
        const actor = tokenDoc.actor;
        if (!actor) continue;
        const hasAuras = this._getActorAuraEffects(actor).length > 0;
        if (!hasAuras) continue;
        if (isLinkedUuid(actor.uuid)) {
          if (!sourceTokenByActorUuid.has(actor.uuid)) {
            sourceTokenByActorUuid.set(actor.uuid, { tokenDoc, actor });
          }
          if (movedToken && tokenDoc.id === movedToken.id) {
            sourceTokenByActorUuid.set(actor.uuid, { tokenDoc, actor });
          }
        } else {
          sourceTokenByActorUuid.set(tokenDoc.id, { tokenDoc, actor });
        }
      }

      for (const { tokenDoc, actor } of sourceTokenByActorUuid.values()) {
        await this._updateActorAuras(tokenDoc, actor, movedToken, movedTokenNewPos);
      }
      await this._cleanupOrphanAuraCopies();
      for (const area of NeuroshimaAreas.documents()) {
        if (area.getFlag("neuroshima", "fromAreaEffect")) await this._applyAreaEffect(area, movedToken, movedTokenNewPos);
      }
    });
  }

  /**
   * Apply or remove aura effect copies for all auraActor effects on sourceActor.
   * Respects: keep, filterScript, preApplyScript.
   *
   * @param {TokenDocument}              sourceToken
   * @param {Actor}                      sourceActor
   * @param {TokenDocument|null}         movedToken       - Token that just moved.
   * @param {{x:number,y:number}|null}   movedTokenNewPos - Pre-computed new pixel position.
   */
  static async _updateActorAuras(sourceToken, sourceActor, movedToken = null, movedTokenNewPos = null) {
    const auraEffects = this._getActorAuraEffects(sourceActor).filter(e =>
      this._isActive(e) &&
      !e.getFlag("neuroshima", "auraTransferred")
    );

    game.neuroshima?.log("Aura | _updateActorAuras", {
      source: sourceActor.name,
      effects: auraEffects.map(e => e.name)
    });

    const sceneActorTokens = this._collectSceneActorTokens(sourceActor);

    const sourcePosData = this._resolveTokenPos(sourceToken, movedToken, movedTokenNewPos);

    for (const effect of auraEffects) {
      const radiusUnits = Number(effect.getFlag("neuroshima", "auraRadius") ?? 0);
      if (!Number.isFinite(radiusUnits) || radiusUnits <= 0) {
        game.neuroshima?.log("Aura | skipping effect (no radius)", { effect: effect.name });
        if (!effect.getFlag("neuroshima", "auraKeep")) {
          await this.removeAllCopiesForEffect(effect.id, sourceActor.id, sourceActor.uuid);
        }
        continue;
      }

      const keep = effect.getFlag("neuroshima", "auraKeep") ?? false;

      const inRange = new Map();
      for (const { token, actor } of sceneActorTokens.values()) {
        const targetPosData = this._resolveTokenPos(token, movedToken, movedTokenNewPos);
        const dist = this._measureDistanceFromPos(sourcePosData, targetPosData);
        game.neuroshima?.log("Aura | distance check", {
          source: sourceActor.name, target: actor.name,
          dist: dist.toFixed(2), radiusUnits, inRange: dist <= radiusUnits
        });
        if (dist <= radiusUnits && !inRange.has(actor.uuid)) {
          inRange.set(actor.uuid, actor);
        }
      }

      const sourceTokenId = sourceToken.id;
      const sourceActorUuid = sourceActor.uuid;

      for (const [, targetActor] of inRange) {
        if (await this._runFilterScript(effect, targetActor, sourceActor)) {
          inRange.delete(targetActor.uuid);
          continue;
        }
        const hasCopy = (targetActor.effects ?? []).some(e => {
          const fa = e.getFlag("neuroshima", "fromAura");
          return fa?.sourceEffectId === effect.id && fa?.sourceActorUuid === sourceActorUuid;
        });
        game.neuroshima?.log("Aura | hasCopy check", {
          from: sourceActor.name, to: targetActor.name, sourceActorUuid, hasCopy, effectName: effect.name
        });
        if (hasCopy) continue;

        const preOk = await this._runPreApplyScript(effect, sourceActor, targetActor);
        if (!preOk) {
          game.neuroshima?.log("Aura | blocked by preApplyScript", { from: sourceActor.name, to: targetActor.name });
          continue;
        }

        game.neuroshima?.log("Aura | applying copy", { from: sourceActor.name, to: targetActor.name, effect: effect.name });
        await this._applyAuraCopy(effect, sourceActor, targetActor, sourceTokenId, sourceActorUuid);
      }

      if (!keep) {
        for (const { actor: targetActor } of sceneActorTokens.values()) {
          if (inRange.has(targetActor.uuid)) continue;
          const copies = (targetActor.effects ?? []).filter(e => {
            const fa = e.getFlag("neuroshima", "fromAura");
            return fa?.sourceEffectId === effect.id && fa?.sourceActorUuid === sourceActorUuid;
          });
          if (copies.length) {
            game.neuroshima?.log("Aura | removing copy (out of range)", { from: sourceActor.name, to: targetActor.name, effect: effect.name });
            await targetActor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id), { ns_skipAuraCleanup: true });
          }
        }
      }
    }

    await this._cleanupStaleAuraCopies(sourceActor, sceneActorTokens, sourceToken.id);
    await this._syncRenderTemplates(sourceToken, sourceActor, movedToken, movedTokenNewPos);
  }

  /**
   * Resolve the effective pixel position for a token.
   * If this token is the one that just moved AND we have a pre-computed new position
   * (from preUpdateToken), use that instead of the token document's (possibly stale) values.
   *
   * @param {TokenDocument}            token
   * @param {TokenDocument|null}       movedToken
   * @param {{x:number,y:number}|null} movedTokenNewPos
   * @returns {{ x: number, y: number, width: number, height: number }}
   */
  static _resolveTokenPos(token, movedToken, movedTokenNewPos) {
    if (movedTokenNewPos && movedToken && token.id === movedToken.id) {
      return { x: movedTokenNewPos.x ?? token.x, y: movedTokenNewPos.y ?? token.y,
        width: movedTokenNewPos.width ?? token.width, height: movedTokenNewPos.height ?? token.height,
        elevation: movedTokenNewPos.elevation ?? token.elevation ?? 0 };
    }
    return { x: token.x, y: token.y, width: token.width, height: token.height, elevation: token.elevation ?? 0 };
  }

  /**
   * Remove aura copies for effects that are no longer active (deleted/disabled).
   */
  static async _cleanupStaleAuraCopies(sourceActor, sceneActorTokens, sourceTokenId = null) {
    const activeIds = new Set(
      this._getActorAuraEffects(sourceActor)
        .filter(e => this._isActive(e) && !e.getFlag("neuroshima", "auraTransferred"))
        .map(e => e.id)
    );
    game.neuroshima?.log("Aura | _cleanupStaleAuraCopies", {
      sourceActor: sourceActor.name, sourceTokenId, activeAuraEffectIds: [...activeIds]
    });
    const sourceActorUuid = sourceActor.uuid;
    const tokens = sceneActorTokens ?? this._collectSceneActorTokens(sourceActor);
    for (const { actor: targetActor } of tokens.values()) {
      const stale = (targetActor.effects ?? []).filter(e => {
        const fa = e.getFlag("neuroshima", "fromAura");
        if (!fa) return false;
        const matchesSource = fa.sourceActorUuid
          ? fa.sourceActorUuid === sourceActorUuid
          : fa.sourceActorId === sourceActor.id;
        if (!matchesSource) return false;
        return !activeIds.has(fa.sourceEffectId);
      });
      if (stale.length) {
        game.neuroshima?.log("Aura | _cleanupStaleAuraCopies removing stale", {
          from: sourceActor.name, to: targetActor.name,
          stale: stale.map(e => ({ id: e.id, name: e.name, fromAura: e.getFlag("neuroshima", "fromAura") }))
        });
        await targetActor.deleteEmbeddedDocuments("ActiveEffect", stale.map(e => e.id), { ns_skipAuraCleanup: true });
      }
    }
  }

  /** Reconcile sources removed from a token, item or Actor, including the last aura. */
  static async _cleanupOrphanAuraCopies() {
    const actors = new Map();
    for (const token of canvas.scene.tokens) if (token.actor) actors.set(token.actor.uuid, token.actor);
    const active = new Map();
    const sourceEffect = (actor, id) => {
      if (!actor) return null;
      if (!active.has(actor.uuid)) active.set(actor.uuid, this._getActorAuraEffects(actor)
        .filter(effect => this._isActive(effect) && !effect.getFlag("neuroshima", "auraTransferred")));
      return active.get(actor.uuid).find(effect => effect.id === id);
    };
    for (const actor of actors.values()) {
      const stale = [];
      for (const copy of actor.effects ?? []) {
        const source = copy.getFlag("neuroshima", "fromAura");
        if (!source) continue;
        let owner = source.sourceActorUuid ? actors.get(source.sourceActorUuid)
          : Array.from(actors.values()).find(entry => entry.id === source.sourceActorId);
        // Manually transferred auras need not have a source token in the viewed scene.
        if (!owner && !source.sourceTokenId) {
          owner = source.sourceActorUuid ? await this._resolveSource(source.sourceActorUuid) : game.actors.get(source.sourceActorId);
          owner = owner?.actor ?? owner;
        }
        if (!sourceEffect(owner, source.sourceEffectId)) stale.push(copy.id);
      }
      if (stale.length) await actor.deleteEmbeddedDocuments("ActiveEffect", stale, { ns_skipAuraCleanup: true });
    }
    for (const document of NeuroshimaAreas.documents()) {
      const visual = document.getFlag("neuroshima", "auraVisual");
      if (!visual) continue;
      const owner = visual.actorUuid ? actors.get(visual.actorUuid)
        : Array.from(actors.values()).find(actor => actor.id === visual.actorId);
      const effect = sourceEffect(owner, visual.effectId);
      if (!effect || !NeuroshimaAreas.rendersAura(effect)
        || effect.getFlag("neuroshima", "auraTransferred") || !(Number(effect.getFlag("neuroshima", "auraRadius")) > 0)) {
        await document.delete();
      }
    }
  }

  /**
   * Remove ALL aura copies for a specific source effect across all scene actors.
   * Called when the source aura effect is deleted or when its actor token is removed.
   * @param {string|null} effectId      - Source effect ID, or null to match any effect from actor.
   * @param {string}      sourceActorId
   */
  static async removeAllCopiesForEffect(effectId, sourceActorId, sourceActorUuid = null) {
    if (!canvas?.scene) return;
    for (const tokenDoc of canvas.scene.tokens) {
      const targetActor = tokenDoc.actor;
      if (!targetActor) continue;
      const copies = (targetActor.effects ?? []).filter(e => {
        const fa = e.getFlag("neuroshima", "fromAura");
        if (!fa) return false;
        const matchesSource = (sourceActorUuid && fa.sourceActorUuid)
          ? fa.sourceActorUuid === sourceActorUuid
          : fa.sourceActorId === sourceActorId;
        if (!matchesSource) return false;
        return effectId === null || fa.sourceEffectId === effectId;
      });
      if (copies.length) {
        await targetActor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id), { ns_skipAuraCleanup: true });
      }
    }
    await this._removeRenderTemplates(sourceActorId, effectId, sourceActorUuid);
  }

  /**
   * Remove ALL area copies sourced from a specific effect from all scene actors.
   * Called when the source effect is deleted.
   * @param {string} effectId
   * @param {string} sourceActorId
   */
  static async removeAllAreaCopiesForEffect(effectId, sourceActorId, sourceActorUuid = null) {
    if (!canvas?.scene) return;
    for (const tokenDoc of canvas.scene.tokens) {
      const targetActor = tokenDoc.actor;
      if (!targetActor) continue;
      const copies = (targetActor.effects ?? []).filter(e => {
        const fa = e.getFlag("neuroshima", "fromArea");
        return fa?.sourceEffectId === effectId && (sourceActorUuid && fa.sourceActorUuid
          ? fa.sourceActorUuid === sourceActorUuid : fa?.sourceActorId === sourceActorId);
      });
      if (copies.length) {
        await targetActor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id));
      }
    }
  }

  /**
   * Give specific actors an independent emitter of this transferred aura.
   * Recipients emit a normal aura; their range copies cannot emit or transfer again.
   *
   * Respects filterScript and preApplyScript — same as range auras.
   *
   * @param {ActiveEffect} effect        - The aura effect (must have auraTransferred=true)
   * @param {Actor}        sourceActor   - The actor owning the effect
   * @param {Actor[]}      [targets]     - Target actors. If omitted, uses current user token targets.
   */
  static async applyTransferredAuraCopies(effect, sourceActor, targets = null) {
    if (!this._isActive(effect) || effect.getFlag("neuroshima", "transferType") !== "auraActor"
      || effect.getFlag("neuroshima", "auraTransferred") !== true) return;
    return this.semaphore.add(() => this._applyTransferredAuraCopies(effect, sourceActor, targets));
  }

  static async _applyTransferredAuraCopies(effect, sourceActor, targets) {
    if (!this._isActive(effect) || effect.getFlag("neuroshima", "transferType") !== "auraActor"
      || effect.getFlag("neuroshima", "auraTransferred") !== true) return;
    return this.semaphore.add(() => this._applyTransferredAuraCopies(effect, sourceActor, targets));
  }

  static async _applyTransferredAuraCopies(effect, sourceActor, targets) {
    if (!this._isActive(effect)) return;
    const resolvedTargets = targets ?? Array.from(game.user.targets).map(t => t.actor).filter(a => a);
    if (!resolvedTargets.length) {
      game.neuroshima?.log("Aura | applyTransferredAuraCopies: no targets");
      return;
    }
    for (const targetActor of new Set(resolvedTargets.map(target => target.actor ?? target))) {
      const hasCopy = (targetActor.effects ?? []).some(e => {
        return e.getFlag("neuroshima", "sourceEffect") === effect.uuid
          && e.getFlag("neuroshima", "transferType") === "auraActor"
          && !e.getFlag("neuroshima", "auraTransferred");
      });
      if (hasCopy) {
        game.neuroshima?.log("Aura | applyTransferredAuraCopies: already has copy", { target: targetActor.name });
        continue;
      }
      const preOk = await this._runPreApplyScript(effect, sourceActor, targetActor);
      if (!preOk) {
        game.neuroshima?.log("Aura | applyTransferredAuraCopies: blocked by preApplyScript", { target: targetActor.name });
        continue;
      }
      const filtered = await this._runFilterScript(effect, targetActor, sourceActor);
      if (filtered) {
        game.neuroshima?.log("Aura | applyTransferredAuraCopies: blocked by filterScript", { target: targetActor.name });
        continue;
      }
      game.neuroshima?.log("Aura | applyTransferredAuraCopies: applying copy", { source: sourceActor.name, target: targetActor.name });
      const data = effect.convertToApplied();
      stampEffectStart(data);
      await targetActor.createEmbeddedDocuments("ActiveEffect", [data], { ns_skipAuraTrigger: true });
    }
  }

  /**
   * Create a copy of an aura effect on a target actor, tagged for cleanup.
   */
  static async _applyAuraCopy(effect, sourceActor, targetActor, sourceTokenId = null, sourceActorUuid = null) {
    const data = effect.convertToApplied();
    data.origin = sourceActor.uuid;
    stampEffectStart(data);
    foundry.utils.setProperty(data, "flags.neuroshima.fromAura", {
      sourceEffectId: effect.id,
      sourceActorId:  sourceActor.id,
      sourceActorUuid: sourceActorUuid ?? sourceActor.uuid,
      sourceTokenId:  sourceTokenId
    });
    foundry.utils.setProperty(data, "flags.neuroshima.transferType", "owningDocument");
    await targetActor.createEmbeddedDocuments("ActiveEffect", [data], { ns_skipAuraTrigger: true });
  }

  /**
   * Display scrolling text on all visible tokens of a given actor.
   * Displays effect feedback above visible actor tokens.
   * @param {string} text
   * @param {Actor}  actor
   */
  static _displayScrollingText(text, actor) {
    if (!canvas?.interface) return;
    for (const t of actor.getActiveTokens()) {
      if (!t.visible || !t.renderable) continue;
      canvas.interface.createScrollingText(t.center, text, {
        anchor:          CONST.TEXT_ANCHOR_POINTS.CENTER,
        direction:       CONST.TEXT_ANCHOR_POINTS.TOP,
        distance:        2 * t.h,
        fontSize:        36,
        fill:            "0xFFFFFF",
        stroke:          "0x000000",
        strokeThickness: 4,
        jitter:          0.25
      });
    }
  }

  /**
   * Collect all auraActor effects for an actor, including effects embedded on
   * owned items that have transferType = "auraActor".
   *
   * Item effects respect equipTransfer: if an effect has equipTransfer=true and
   * the owning item is unequipped (system.equipped === false), the effect is skipped.
   *
   * @param {Actor} actor
   * @returns {ActiveEffect[]}
   */
  static _getActorAuraEffects(actor) {
    const results = [];
    for (const e of actor.effects ?? []) {
      if (e.getFlag("neuroshima", "transferType") === "auraActor") results.push(e);
    }
    for (const item of actor.items ?? []) {
      if (["weapon-mod", "armor-mod"].includes(item.type)) continue;
      const isUnequipped = item.system?.equipped === false;
      for (const e of item.effects ?? []) {
        if (e.getFlag("neuroshima", "transferType") !== "auraActor") continue;
        const equipTransfer = e.getFlag("neuroshima", "equipTransfer") ?? false;
        if (equipTransfer && isUnequipped) continue;
        results.push(e);
      }
    }
    return results;
  }

  /**
   * Collect a map of all unique actor–token pairs on the scene, excluding the given actor.
   * Key: tokenId  Value: { token, actor }
   * Uses actor.uuid for exclusion (unique per unlinked token, shared for linked tokens).
   */
  static _collectSceneActorTokens(excludeActor) {
    const map = new Map();
    const excludeUuid = excludeActor?.uuid ?? null;
    for (const tokenDoc of canvas.scene.tokens) {
      const actor = tokenDoc.actor;
      if (!actor) continue;
      if (excludeUuid && actor.uuid === excludeUuid) continue;
      map.set(tokenDoc.id, { token: tokenDoc, actor });
    }
    return map;
  }

  /**
   * Measure distance in scene units between two position objects.
   * Uses Euclidean (straight-line) distance converted to scene distance units.
   * @param {{ x: number, y: number, width: number, height: number }} posA
   * @param {{ x: number, y: number, width: number, height: number }} posB
   * @returns {number} Distance in scene distance units (e.g. metres, feet)
   */
  static _measureDistanceFromPos(posA, posB) {
    const gs = canvas.grid.size;
    const ax = posA.x + (posA.width  * gs) / 2;
    const ay = posA.y + (posA.height * gs) / 2;
    const bx = posB.x + (posB.width  * gs) / 2;
    const by = posB.y + (posB.height * gs) / 2;
    const pixelDist = Math.hypot(bx - ax, by - ay);
    return (pixelDist / gs) * (canvas.grid.distance ?? 1);
  }

  // ─── Area (static template) ───────────────────────────────────────────────

  /**
   * Place a MeasuredTemplate for an Area-type effect.
   * @param {ActiveEffect} effect
   * @param {Actor}        actor
   */
  static async placeAreaTemplate(effect, actor) {
    const radius = Number(effect.getFlag("neuroshima", "auraRadius") ?? 0);
    if (!Number.isFinite(radius) || radius <= 0) {
      ui.notifications.warn("NS | Area effect requires a radius to be configured on the effect.");
      return;
    }
    if (!canvas?.scene) {
      ui.notifications.warn("NS | No active scene found.");
      return;
    }

    const token = actor?.getActiveTokens()[0]?.document;
    const gs = canvas.grid.size;
    const x = token ? token.x + (token.width * gs) / 2 : canvas.dimensions.width / 2;
    const y = token ? token.y + (token.height * gs) / 2 : canvas.dimensions.height / 2;

    const templateData = {
      t: "circle",
      x,
      y,
      distance: radius,
      fillColor: game.user.color ?? "#FF0000",
      borderColor: game.user.color ?? "#FF0000",
      flags: {
        neuroshima: {
          fromAreaEffect: {
            effectId: effect.id,
            effectUuid: effect.uuid,
            actorUuid: actor?.uuid ?? null,
            actorId: actor?.id ?? null
          }
        }
      }
    };

    const docs = await NeuroshimaAreas.create([templateData], { ns_skipAreaCheck: true });
    if (docs?.length) {
      NeuroshimaAreas.layer()?.get(docs[0].id)?.control({ releaseOthers: true });
      ui.notifications.info("NS | Area template placed. You can drag it to reposition.");
      await this.applyAreaEffect(docs[0]);
    }
  }

  /**
   * Apply area effect copies to actors within the template's area.
   * Respects: keep, filterScript, preApplyScript, areaDuration (instantaneous removes template after).
   * Called on createMeasuredTemplate and updateMeasuredTemplate.
   * @param {MeasuredTemplateDocument} templateDoc
   */
  static async applyAreaEffect(templateDoc) {
    return this.semaphore.add(() => this._applyAreaEffect(templateDoc));
  }

  static async _applyAreaEffect(templateDoc, movedToken = null, movedTokenNewPos = null) {
    const fromArea = templateDoc.getFlag("neuroshima", "fromAreaEffect");
    if (!fromArea) return;
    const { effectId, actorId } = fromArea;

    const sourceActor = fromArea.actorUuid ? await this._resolveSource(fromArea.actorUuid) : game.actors.get(actorId);
    const effect = fromArea.effectUuid ? await this._resolveSource(fromArea.effectUuid) : sourceActor?.effects?.get(effectId);
    const scene = templateDoc.parent ?? canvas.scene;
    if (templateDoc.parent && templateDoc.id && !NeuroshimaAreas.get(templateDoc.id, scene)) return;
    if (!effect || !this._isActive(effect) || effect.getFlag("neuroshima", "transferType") !== "areaActor") {
      await this.removeAreaCopies(templateDoc.id, { force: true, scene });
      return;
    }

    const keep = effect.getFlag("neuroshima", "auraKeep") ?? false;
    const duration = effect.getFlag("neuroshima", "areaDuration") ?? "sustained";

    const gs = scene.grid?.size ?? canvas.grid.size;

    const inRange = new Set();

    for (const tokenDoc of scene.tokens) {
      const targetActor = tokenDoc.actor;
      if (!targetActor) continue;

      const pos = this._resolveTokenPos(tokenDoc, movedToken, movedTokenNewPos);
      const centerX = pos.x + (pos.width * gs) / 2;
      const centerY = pos.y + (pos.height * gs) / 2;
      if (!NeuroshimaAreas.contains(templateDoc, centerX, centerY, pos.elevation)) continue;
      if (await this._runFilterScript(effect, targetActor, sourceActor)) continue;

      inRange.add(targetActor.uuid);

      const hasCopy = (targetActor.effects ?? []).some(e =>
        e.getFlag("neuroshima", "fromArea")?.templateId === templateDoc.id
      );
      if (hasCopy) continue;

      const preOk = await this._runPreApplyScript(effect, sourceActor, targetActor);
      if (!preOk) continue;

      const baseData = this._buildAreaCopyData(effect, templateDoc.id, effectId, actorId, sourceActor);
      await targetActor.createEmbeddedDocuments("ActiveEffect", [baseData]);
    }

    if (!keep) {
      for (const tokenDoc of scene.tokens) {
        const targetActor = tokenDoc.actor;
        if (!targetActor || inRange.has(targetActor.uuid)) continue;
        const copies = (targetActor.effects ?? []).filter(e =>
          e.getFlag("neuroshima", "fromArea")?.templateId === templateDoc.id
        );
        if (copies.length) {
          await targetActor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id), { ns_skipAuraCleanup: true });
        }
      }
    }

    if (duration === "instantaneous") {
      await templateDoc.delete({ ns_skipAreaCleanup: true });
    }
  }

  /**
   * Remove all area-effect copies associated with the given template from all scene actors.
   * @param {string}  templateId
   * @param {object}  [opts]
   * @param {boolean} [opts.force=false] - Skip the keep flag check and always remove.
   */
  static async removeAreaCopies(templateId, { force = false, scene = canvas?.scene } = {}) {
    if (!scene) return;
    for (const tokenDoc of scene.tokens) {
      const targetActor = tokenDoc.actor;
      if (!targetActor) continue;
      const copies = (targetActor.effects ?? []).filter(e =>
        e.getFlag("neuroshima", "fromArea")?.templateId === templateId
      );
      if (!copies.length) continue;

      if (!force) {
        const fa = copies[0].getFlag("neuroshima", "fromArea");
        const srcActor = fa?.sourceActorUuid ? await this._resolveSource(fa.sourceActorUuid) : fa?.sourceActorId ? game.actors.get(fa.sourceActorId) : null;
        const srcEffect = fa?.sourceEffectUuid ? await this._resolveSource(fa.sourceEffectUuid) : srcActor?.effects?.get(fa?.sourceEffectId);
        if (srcEffect?.getFlag("neuroshima", "auraKeep")) continue;
      }

      await targetActor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id));
    }
  }

  /**
   * Build the effect data object for an area copy.
   */
  static _buildAreaCopyData(effect, templateId, sourceEffectId, sourceActorId, sourceActor = null) {
    const data = effect.convertToApplied();
    stampEffectStart(data);
    sourceActor ??= effect.actor ?? game.actors.get(sourceActorId);
    if (sourceActor) data.origin = sourceActor.uuid;
    foundry.utils.setProperty(data, "flags.neuroshima.fromArea", { templateId, sourceEffectId, sourceActorId, sourceActorUuid: sourceActor?.uuid ?? null, sourceEffectUuid: effect.uuid ?? null });
    foundry.utils.setProperty(data, "flags.neuroshima.transferType", "owningDocument");
    return data;
  }
}
