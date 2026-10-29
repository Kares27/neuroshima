import { buildDiceTooltipSection, renderTooltipSections } from "./tooltip-renderer.js";
import { NeuroshimaChoiceRouter } from "./choice-router.js";
import { NeuroshimaSocket } from "./socket-helper.js";

const SOCKET_ACTION = "rollTest:prompt";
const RECIPIENTS = new Set(["actorOwner", "executor", "gm"]);

/**
 * Routes an immediate Attribute/Skill Test dialog to the requested client.
 * Only plain data crosses the socket boundary; test instances remain local.
 */
export class NeuroshimaRollTestRouter {
  static registerSocketHandlers() {
    NeuroshimaSocket.register(SOCKET_ACTION, request => this._handleSocketRequest(request));
  }

  static _cancelledResult(request) {
    return {
      cancelled: true,
      success: false,
      isSuccess: false,
      successPoints: 0,
      successes: 0,
      type: request.type,
      attributeKey: request.attributeKey,
      skillKey: request.type === "skill" ? request.skillKey : null,
      difficulty: request.difficulty,
      isOpen: request.isOpen === true,
      test: null,
      result: null
    };
  }

  static _normalizeResult(payload, request, { preserveDocuments = false } = {}) {
    if (!payload) return this._cancelledResult(request);
    const success = payload.success === true || payload.isSuccess === true;
    const successPoints = Number(payload.successPoints ?? 0);
    return {
      cancelled: false,
      success,
      isSuccess: success,
      successPoints,
      successes: successPoints,
      type: request.type,
      attributeKey: request.attributeKey,
      skillKey: request.type === "skill" ? request.skillKey : null,
      difficulty: request.difficulty,
      isOpen: request.isOpen === true,
      test: preserveDocuments ? payload.test ?? null : null,
      result: preserveDocuments ? payload.result ?? payload.test?.result ?? null : null
    };
  }

  static async _openLocal(actor, request, { preserveDocuments = true } = {}) {
    if (!actor || actor.documentName !== "Actor") {
      throw new Error("rollTest: nie znaleziono Aktora na kliencie odbiorcy.");
    }
    const { NeuroshimaSkillRollDialog } = await import("../apps/dialogs/skill-roll-dialog.js");
    const payload = await NeuroshimaSkillRollDialog.wait({
      actor,
      stat: request.stat,
      skill: request.skill,
      label: request.label,
      isSkill: request.type === "skill",
      skillKey: request.skillKey ?? "",
      currentAttribute: request.attributeKey,
      lastRoll: {
        modifier: request.modifier,
        baseDifficulty: request.difficulty,
        useArmorPenalty: request.useArmorPenalty,
        useWoundPenalty: request.useWoundPenalty,
        useDiseasePenalty: request.useDiseasePenalty,
        useEffectPenalty: request.useEffectPenalty,
        isOpen: request.isOpen,
        rollMode: request.rollMode
      },
      testType: request.testType,
      testSubtype: request.testSubtype
    });
    return this._normalizeResult(payload, request, { preserveDocuments });
  }

  static async _handleSocketRequest(request) {
    try {
      const document = request.actorUuid ? await fromUuid(request.actorUuid) : null;
      const actor = document?.actor ?? document;
      const value = await this._openLocal(actor, request, { preserveDocuments: false });
      return { status: value.cancelled ? "cancelled" : "rolled", value };
    } catch (error) {
      return {
        status: "error",
        error: {
          name: error?.name ?? "Error",
          message: error?.message ?? String(error)
        }
      };
    }
  }

  static _getRecipientUser(actor, recipient) {
    if (recipient === "executor") return game.user;
    if (recipient === "gm") return NeuroshimaChoiceRouter.getFallbackGM();
    return NeuroshimaChoiceRouter.getPlayerOwner(actor)
      ?? NeuroshimaChoiceRouter.getFallbackGM();
  }

  static _throwRemoteError(data) {
    const error = new Error(data?.message ?? "rollTest: zdalny rzut zakończył się błędem.");
    error.name = data?.name ?? "Error";
    error.neuroshimaRemoteRollError = true;
    throw error;
  }

  static async _askRemote(user, request) {
    const response = await NeuroshimaSocket.executeAsUser(SOCKET_ACTION, user.id, request);
    if (!response) throw new Error(`rollTest: brak odpowiedzi użytkownika „${user.name}”.`);
    if (response.status === "error") this._throwRemoteError(response.error);
    if (!["rolled", "cancelled"].includes(response.status)) {
      throw new Error("rollTest: nieprawidłowa odpowiedź zdalnego klienta.");
    }
    return response.value;
  }

  static async roll(actor, request, { recipient = "actorOwner" } = {}) {
    if (!RECIPIENTS.has(recipient)) {
      throw new Error(`rollTest: nieprawidłowy odbiorca „${recipient}”.`);
    }

    let user = this._getRecipientUser(actor, recipient);
    if (!user) throw new Error("rollTest: brak aktywnego odbiorcy dialogu.");
    if (user.id === game.user.id) {
      return this._openLocal(actor, request, { preserveDocuments: true });
    }

    try {
      return await this._askRemote(user, request);
    } catch (error) {
      // actorOwner has an explicit GM fallback when its player disconnects or
      // the targeted socket request cannot be delivered. A real remote roll
      // error is surfaced by _askRemote and must not silently open a second roll.
      if (recipient !== "actorOwner" || error.neuroshimaRemoteRollError === true) throw error;
      const fallbackGM = NeuroshimaChoiceRouter.getFallbackGM();
      if (!fallbackGM || fallbackGM.id === user.id) throw error;
      user = fallbackGM;
      if (user.id === game.user.id) {
        return this._openLocal(actor, request, { preserveDocuments: true });
      }
      return this._askRemote(user, request);
    }
  }
}

/**
 * Presentation and roll-dialog utilities.
 *
 * Test construction, rolling, evaluation, recalculation and side effects live
 * exclusively in `module/tests.mjs`.
 */
export class NeuroshimaDice {
  static measureDistance(first, second) {
    if (!first || !second) return 0;
    let a = first.center || first;
    let b = second.center || second;
    if (Array.isArray(a)) a = { x: a[0], y: a[1] };
    if (Array.isArray(b)) b = { x: b[0], y: b[1] };
    try {
      return canvas.grid.measurePath([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]).distance;
    } catch (_error) {
      const pixels = Math.hypot(b.x - a.x, b.y - a.y);
      return pixels / (canvas.grid.size || 100) * (canvas.grid.distance || 2);
    }
  }

  static _groupHitsData(rollData) {
    const hits = rollData?.hitBulletsData ?? [];
    if (!hits.length) return;
    const damage = new Map();
    const piercing = new Map();
    for (const hit of hits) {
      damage.set(hit.damage, (damage.get(hit.damage) ?? 0) + (hit.isPellet ? hit.successPoints || 1 : 1));
      piercing.set(hit.piercing, (piercing.get(hit.piercing) ?? 0) + 1);
    }
    const woundCount = [...damage.values()].reduce((sum, count) => sum + count, 0);
    rollData.damage = [...damage].map(([type, count]) => woundCount > 1 ? `${count}x${type}` : type).join(", ");
    rollData.piercing = [...piercing].map(([value, count]) => hits.length > 1 ? `${count}x${value}` : value).join(", ");
    rollData.isPellet = hits.some(hit => hit.isPellet);
  }

  static buildDiceTooltipHtml(data) {
    const section = buildDiceTooltipSection(data);
    return section ? renderTooltipSections([section]) : "";
  }

  /** Preserve the script API while keeping wound creation in the combat helper. */
  static async applyDamage(actor, options) {
    const { CombatHelper } = await import("./combat-helper.js");
    return CombatHelper.applyDamage(actor, options);
  }
}
