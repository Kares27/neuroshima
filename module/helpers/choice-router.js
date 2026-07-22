import { NeuroshimaSocket } from "./socket-helper.js";
import { TraitChoiceDialog } from "../apps/dialogs/trait-choice-dialog.js";
import { ListChoiceDialog } from "../apps/dialogs/list-choice-dialog.js";
import { PointAllocationDialog } from "../apps/dialogs/point-allocation-dialog.js";

/**
 * Routes decisions to the active player who owns an Actor while leaving all
 * document mutations on the client which initiated the operation.
 */
export class NeuroshimaChoiceRouter {
  /** Select the first eligible player in a deterministic priority order. */
  static getPlayerOwner(actor) {
    if (!actor) return null;
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const owners = game.users
      .filter(user => user.active && !user.isGM && actor.testUserPermission(user, OWNER))
      .sort((a, b) => a.id.localeCompare(b.id));

    return owners.find(user => user.character?.id === actor.id)
      ?? owners.find(user => user.id === game.user.id)
      ?? owners[0]
      ?? null;
  }

  static getFallbackGM() {
    // The current client is necessarily connected while it is executing this
    // operation. Foundry's `active` flag may briefly lag behind during setup or
    // user-presence synchronisation, so never reject the current GM because of it.
    if (game.user.isGM) return game.user;
    return game.users.find(user => user.active && user.isGM) ?? null;
  }

  static getChoiceUser(actor) {
    return this.getPlayerOwner(actor) ?? this.getFallbackGM() ?? null;
  }

  static async _showTraitChoice(payload) {
    const actor = payload.actorUuid ? await fromUuid(payload.actorUuid) : null;
    const traits = await Promise.all(payload.choices.map(async choice => {
      const item = await fromUuid(choice.uuid);
      return {
        uuid: choice.uuid,
        item: item ?? { name: choice.name, img: choice.img, system: {} }
      };
    }));
    const value = await TraitChoiceDialog.wait(traits, payload.prompt, actor);
    return value === null ? { status: "cancelled" } : { status: "selected", value };
  }

  static async _showListChoice(payload) {
    const actor = payload.actorUuid ? await fromUuid(payload.actorUuid) : null;
    const value = await ListChoiceDialog.wait(payload.items, payload.prompt, payload.title, actor);
    return value === null ? { status: "cancelled" } : { status: "selected", value };
  }

  static async _showPointAllocation(payload) {
    const value = await PointAllocationDialog.wait(payload.options);
    return value === null ? { status: "cancelled" } : { status: "selected", value };
  }

  static registerSocketHandlers() {
    NeuroshimaSocket.register("choice:trait", payload => this._showTraitChoice(payload));
    NeuroshimaSocket.register("choice:list", payload => this._showListChoice(payload));
    NeuroshimaSocket.register("choice:pointAllocation", payload => this._showPointAllocation(payload));
  }

  static async _askUser(action, user, payload) {
    if (!user) return null;
    if (user.id === game.user.id) return this._showLocally(action, payload);
    try {
      return await NeuroshimaSocket.executeAsUser(action, user.id, payload);
    } catch (error) {
      console.warn(`Neuroshima | ${action} failed for ${user.name}`, error);
      return null;
    }
  }

  static _showLocally(action, payload) {
    if (action === "choice:trait") return this._showTraitChoice(payload);
    if (action === "choice:list") return this._showListChoice(payload);
    if (action === "choice:pointAllocation") return this._showPointAllocation(payload);
    return null;
  }

  static async _route(actor, action, payload, isAllowed) {
    const playerOwner = this.getPlayerOwner(actor);
    if (playerOwner) {
      const response = await this._askUser(action, playerOwner, payload);
      if (response?.status === "cancelled") return null;
      if (response?.status === "selected" && isAllowed(response.value)) return response.value;
    }

    // Cancellation is an intentional answer. A missing/invalid remote answer,
    // however, may still be recovered by asking an active GM.
    const fallbackGM = this.getFallbackGM();
    if (!fallbackGM) {
      console.warn(`Neuroshima | ${action}: no active Actor owner or GM available for this choice`);
      return null;
    }

    const response = await this._askUser(action, fallbackGM, payload);
    if (response?.status === "selected" && isAllowed(response.value)) return response.value;
    return null;
  }

  static async chooseTrait(actor, resolvedTraits, prompt) {
    const choices = resolvedTraits.map(({ uuid, item }) => ({
      uuid,
      name: item.name,
      img: item.img || "systems/neuroshima/assets/Brain.svg"
    }));
    const allowed = new Set(choices.map(choice => choice.uuid));
    return this._route(actor, "choice:trait", { actorUuid: actor.uuid, prompt, choices }, value => allowed.has(value));
  }

  static async chooseFromList(actor, { items = [], prompt = "", title = "" } = {}) {
    // Clone before crossing the socket boundary and validate the returned value
    // against the original choices; remote clients never authorize arbitrary data.
    const choices = foundry.utils.deepClone(items);
    const allowed = new Set(choices.map(choice => choice.value));
    return this._route(actor, "choice:list", { actorUuid: actor?.uuid, items: choices, prompt, title }, value => allowed.has(value));
  }

  static async allocatePoints(actor, options = {}) {
    // Functions cannot be serialized through Foundry sockets. Local validation
    // runs only after the structural/pool validation of the remote response.
    const { validate, ...serializableOptions } = options;
    const payloadOptions = foundry.utils.deepClone(serializableOptions);
    const rows = payloadOptions.rows ?? [];
    const rowByKey = new Map(rows.map(row => [String(row.key), row]));
    const rowKeys = new Set(rowByKey.keys());
    const isAllowed = value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      if (Object.keys(value).some(key => !rowKeys.has(key))) return false;
      let spent = 0;
      for (const key of rowKeys) {
        const amount = Number(value[key]);
        const row = rowByKey.get(key);
        const min = Number.isFinite(Number(row.min)) ? Number(row.min) : 0;
        const max = Number.isFinite(Number(row.max)) ? Number(row.max) : Number(payloadOptions.pool ?? 0);
        if (!Number.isFinite(amount) || amount < min || amount > max) return false;
        spent += amount;
      }
      const pool = Math.max(0, Number(payloadOptions.pool) || 0);
      return payloadOptions.requireExact === false ? spent <= pool : spent === pool;
    };
    const result = await this._route(
      actor,
      "choice:pointAllocation",
      { actorUuid: actor?.uuid, options: payloadOptions },
      isAllowed
    );
    if (result && typeof validate === "function") {
      const validation = await validate(result, rows);
      if (validation === false || typeof validation === "string") {
        if (typeof validation === "string" && validation) ui.notifications.warn(validation);
        return null;
      }
    }
    return result;
  }
}
