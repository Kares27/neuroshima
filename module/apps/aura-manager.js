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
   * Run preApplyScript for an effect.
   * Runs on source actor context. Returns false → prevents application.
   * @param {ActiveEffect} effect
   * @param {Actor}        sourceActor
   * @param {Actor}        targetActor
   * @returns {boolean} true = proceed, false = blocked
   */
  static async _runPreApplyScript(effect, sourceActor, targetActor) {
    const code = effect.getFlag("neuroshima", "preApplyScript");
    if (!code?.trim()) return true;
    const result = await this._evalScript(code, { actor: sourceActor, effect, targetActor });
    return result !== false;
  }

  /**
   * Run filterScript for an effect against a specific target actor.
   * Returns true → PREVENTS application.
   * @param {ActiveEffect} effect
   * @param {Actor}        targetActor
   * @param {Actor}        sourceActor
   * @returns {boolean} true = blocked, false = proceed
   */
  static async _runFilterScript(effect, targetActor, sourceActor) {
    const code = effect.getFlag("neuroshima", "filterScript");
    if (!code?.trim()) return false;
    const result = await this._evalScript(code, { actor: targetActor, effect, sourceActor });
    return !!result;
  }

  // ─── Render Aura (visual MeasuredTemplate) ───────────────────────────────

  /**
   * Ensure a visual MeasuredTemplate exists for every active auraActor effect
   * that has auraRender=true, positioned at the source token center.
   * Creates the template if missing; updates position when the token moves.
   *
   * @param {TokenDocument}              sourceToken
   * @param {Actor}                      sourceActor
   * @param {TokenDocument|null}         movedToken
   * @param {{x:number,y:number}|null}   movedTokenNewPos
   */
  static async _syncRenderTemplates(sourceToken, sourceActor, movedToken, movedTokenNewPos) {
    if (!canvas?.scene) return;
    const auraEffects = (sourceActor.effects ?? []).filter(e =>
      e.getFlag("neuroshima", "transferType") === "auraActor" &&
      !e.disabled &&
      !e.getFlag("neuroshima", "auraTransferred") &&
      e.getFlag("neuroshima", "auraRender")
    );

    const allTemplates = canvas.scene.templates.contents;

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
        t.getFlag("neuroshima", "auraVisual")?.actorId  === sourceActor.id
      );

      if (existing) {
        await existing.update({ x: cx, y: cy }, { skipAreaCheck: true, ns_skipAuraCheck: true });
      } else {
        await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [{
          t: "circle",
          x: cx,
          y: cy,
          distance: radiusUnits,
          fillColor,
          borderColor,
          fillAlpha: fillOpacity,
          hidden: false,
          flags: {
            neuroshima: {
              auraVisual: { effectId: effect.id, actorId: sourceActor.id }
            }
          }
        }], { ns_skipAuraCheck: true });
      }
    }

    const activeEffectIds = new Set(auraEffects.map(e => e.id));
    for (const t of allTemplates) {
      const av = t.getFlag("neuroshima", "auraVisual");
      if (!av || av.actorId !== sourceActor.id) continue;
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
  static async _removeRenderTemplates(sourceActorId, effectId = null) {
    if (!canvas?.scene) return;
    const toDelete = canvas.scene.templates.contents.filter(t => {
      const av = t.getFlag("neuroshima", "auraVisual");
      if (!av) return false;
      if (av.actorId !== sourceActorId) return false;
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
        const hasAuras = (actor.effects ?? []).some(e =>
          e.getFlag("neuroshima", "transferType") === "auraActor" && !e.disabled
        );
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
    const auraEffects = (sourceActor.effects ?? []).filter(e =>
      e.getFlag("neuroshima", "transferType") === "auraActor" &&
      !e.disabled &&
      !e.getFlag("neuroshima", "auraTransferred")
    );

    if (!auraEffects.length) return;
    game.neuroshima?.log("Aura | _updateActorAuras", {
      source: sourceActor.name,
      effects: auraEffects.map(e => e.name)
    });

    const sceneActorTokens = this._collectSceneActorTokens(sourceActor);

    const sourcePosData = this._resolveTokenPos(sourceToken, movedToken, movedTokenNewPos);

    for (const effect of auraEffects) {
      const radiusUnits = Number(effect.getFlag("neuroshima", "auraRadius") ?? 0);
      if (!radiusUnits) {
        game.neuroshima?.log("Aura | skipping effect (no radius)", { effect: effect.name });
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

        const filtered = await this._runFilterScript(effect, targetActor, sourceActor);
        if (filtered) {
          game.neuroshima?.log("Aura | blocked by filterScript", { from: sourceActor.name, to: targetActor.name });
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
      return { x: movedTokenNewPos.x, y: movedTokenNewPos.y, width: token.width, height: token.height };
    }
    return { x: token.x, y: token.y, width: token.width, height: token.height };
  }

  /**
   * Remove aura copies for effects that are no longer active (deleted/disabled).
   */
  static async _cleanupStaleAuraCopies(sourceActor, sceneActorTokens, sourceTokenId = null) {
    const activeIds = new Set(
      (sourceActor.effects ?? [])
        .filter(e => e.getFlag("neuroshima", "transferType") === "auraActor" && !e.disabled)
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
    await this._removeRenderTemplates(sourceActorId, effectId);
  }

  /**
   * Remove ALL area copies sourced from a specific effect from all scene actors.
   * Called when the source effect is deleted.
   * @param {string} effectId
   * @param {string} sourceActorId
   */
  static async removeAllAreaCopiesForEffect(effectId, sourceActorId) {
    if (!canvas?.scene) return;
    for (const tokenDoc of canvas.scene.tokens) {
      const targetActor = tokenDoc.actor;
      if (!targetActor) continue;
      const copies = (targetActor.effects ?? []).filter(e => {
        const fa = e.getFlag("neuroshima", "fromArea");
        return fa?.sourceEffectId === effectId && fa?.sourceActorId === sourceActorId;
      });
      if (copies.length) {
        await targetActor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id));
      }
    }
  }

  /**
   * Apply a "Transferred Aura" effect (auraTransferred=true) to specific target actors.
   * Unlike range-based auras, transferred auras are not applied automatically by proximity.
   * Call this when you want to manually push the aura to specific actors (e.g. from a script).
   *
   * Respects filterScript and preApplyScript — same as range auras.
   *
   * @param {ActiveEffect} effect        - The aura effect (must have auraTransferred=true)
   * @param {Actor}        sourceActor   - The actor owning the effect
   * @param {Actor[]}      [targets]     - Target actors. If omitted, uses current user token targets.
   */
  static async applyTransferredAuraCopies(effect, sourceActor, targets = null) {
    const resolvedTargets = targets ?? Array.from(game.user.targets).map(t => t.actor).filter(a => a);
    if (!resolvedTargets.length) {
      game.neuroshima?.log("Aura | applyTransferredAuraCopies: no targets");
      return;
    }
    for (const targetActor of resolvedTargets) {
      const hasCopy = (targetActor.effects ?? []).some(e => {
        const fa = e.getFlag("neuroshima", "fromAura");
        return fa?.sourceEffectId === effect.id && fa?.sourceActorId === sourceActor.id;
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
      await this._applyAuraCopy(effect, sourceActor, targetActor);
    }
  }

  /**
   * Create a copy of an aura effect on a target actor, tagged for cleanup.
   */
  static async _applyAuraCopy(effect, sourceActor, targetActor, sourceTokenId = null, sourceActorUuid = null) {
    const data = effect.toObject();
    delete data._id;
    data.transfer = false;
    data.origin = sourceActor.uuid;
    data.duration = foundry.utils.mergeObject(data.duration ?? {}, { startTime: game.time.worldTime });
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
   * Mirrors warhammer-lib's TokenHelpers.displayScrollingText pattern.
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
    if (!radius) {
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
            actorId: actor?.id ?? null
          }
        }
      }
    };

    const docs = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
    if (docs?.length) {
      canvas.templates.get(docs[0].id)?.control({ releaseOthers: true });
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
    const fromArea = templateDoc.getFlag("neuroshima", "fromAreaEffect");
    if (!fromArea) return;
    const { effectId, actorId } = fromArea;

    const sourceActor = game.actors.get(actorId);
    const effect = sourceActor?.effects?.get(effectId);
    if (!effect) return;

    const keep = effect.getFlag("neuroshima", "auraKeep") ?? false;
    const duration = effect.getFlag("neuroshima", "areaDuration") ?? "sustained";

    await canvas.scene.refresh?.();
    const templateObj = canvas.templates.get(templateDoc.id);
    if (!templateObj?.shape) return;

    const originX = templateDoc.x;
    const originY = templateDoc.y;
    const gs = canvas.grid.size;

    const inRange = new Set();

    for (const tokenDoc of canvas.scene.tokens) {
      const targetActor = tokenDoc.actor;
      if (!targetActor) continue;

      const centerX = tokenDoc.x + (tokenDoc.width * gs) / 2 - originX;
      const centerY = tokenDoc.y + (tokenDoc.height * gs) / 2 - originY;
      if (!templateObj.shape.contains(centerX, centerY)) continue;

      inRange.add(targetActor.id);

      const hasCopy = (targetActor.effects ?? []).some(e =>
        e.getFlag("neuroshima", "fromArea")?.templateId === templateDoc.id
      );
      if (hasCopy) continue;

      const preOk = await this._runPreApplyScript(effect, sourceActor, targetActor);
      if (!preOk) continue;

      const filtered = await this._runFilterScript(effect, targetActor, sourceActor);
      if (filtered) continue;

      const baseData = this._buildAreaCopyData(effect, templateDoc.id, effectId, actorId);
      await targetActor.createEmbeddedDocuments("ActiveEffect", [baseData]);
    }

    if (!keep) {
      for (const tokenDoc of canvas.scene.tokens) {
        const targetActor = tokenDoc.actor;
        if (!targetActor || inRange.has(targetActor.id)) continue;
        const copies = (targetActor.effects ?? []).filter(e =>
          e.getFlag("neuroshima", "fromArea")?.templateId === templateDoc.id
        );
        if (copies.length) {
          await targetActor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id), { ns_skipAuraCleanup: true });
        }
      }
    }

    if (duration === "instantaneous") {
      await templateDoc.delete();
    }
  }

  /**
   * Remove all area-effect copies associated with the given template from all scene actors.
   * @param {string}  templateId
   * @param {object}  [opts]
   * @param {boolean} [opts.force=false] - Skip the keep flag check and always remove.
   */
  static async removeAreaCopies(templateId, { force = false } = {}) {
    if (!canvas?.scene) return;
    for (const tokenDoc of canvas.scene.tokens) {
      const targetActor = tokenDoc.actor;
      if (!targetActor) continue;
      const copies = (targetActor.effects ?? []).filter(e =>
        e.getFlag("neuroshima", "fromArea")?.templateId === templateId
      );
      if (!copies.length) continue;

      if (!force) {
        const fa = copies[0].getFlag("neuroshima", "fromArea");
        const srcActor = fa?.sourceActorId ? game.actors.get(fa.sourceActorId) : null;
        const srcEffect = srcActor?.effects?.get(fa?.sourceEffectId);
        if (srcEffect?.getFlag("neuroshima", "auraKeep")) continue;
      }

      await targetActor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id));
    }
  }

  /**
   * Build the effect data object for an area copy.
   */
  static _buildAreaCopyData(effect, templateId, sourceEffectId, sourceActorId) {
    const data = effect.toObject();
    delete data._id;
    data.transfer = false;
    data.duration = foundry.utils.mergeObject(data.duration ?? {}, { startTime: game.time.worldTime });
    const sourceActor = game.actors.get(sourceActorId);
    if (sourceActor) data.origin = sourceActor.uuid;
    foundry.utils.setProperty(data, "flags.neuroshima.fromArea", { templateId, sourceEffectId, sourceActorId });
    foundry.utils.setProperty(data, "flags.neuroshima.transferType", "owningDocument");
    return data;
  }
}
