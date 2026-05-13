/**
 * Centralised socketlib helpers for the Neuroshima system.
 *
 * Usage pattern — registering a handler (call once in initializeSocketlib):
 *
 *   NeuroshimaSocket.register("myAction", async (data) => { ... });
 *
 * Usage pattern — executing as GM (anywhere in client code):
 *
 *   await NeuroshimaSocket.gmExecute("myAction", data);
 *
 * If the caller IS the GM, the action runs directly in the same process.
 * If the caller is a player, the action is forwarded to the GM via socketlib.
 */
export class NeuroshimaSocket {
  /** @returns {object} The socketlib socket instance. */
  static get socket() {
    return game.neuroshima?.socket ?? null;
  }

  /**
   * Register a GM-side handler for a named socket action.
   * The handler receives exactly the arguments passed to `gmExecute`.
   *
   * @param {string}   action  - Unique action name (scoped per system).
   * @param {Function} handler - Async function executed on the GM client.
   */
  static register(action, handler) {
    const socket = NeuroshimaSocket.socket;
    if (!socket) {
      console.warn(`Neuroshima | NeuroshimaSocket.register: socket not ready (action=${action})`);
      return;
    }
    socket.register(action, handler);
  }

  /**
   * Execute a named GM action.
   *
   * - If the current user is the GM, the registered handler is invoked
   *   directly via `executeAsGM` (socketlib routes it locally).
   * - If the current user is a player, the action is forwarded to the GM
   *   via socketlib.
   *
   * @param {string} action - The action name registered via `register()`.
   * @param {...any} args   - Arguments forwarded to the handler.
   * @returns {Promise<any>} Resolves with the handler's return value.
   */
  static async gmExecute(action, ...args) {
    const socket = NeuroshimaSocket.socket;
    if (!socket) {
      console.error(`Neuroshima | NeuroshimaSocket.gmExecute: socket not available (action=${action})`);
      return null;
    }
    return socket.executeAsGM(action, ...args);
  }

  /**
   * Execute a named action on ALL connected clients.
   * @param {string} action - The action name registered via `register()`.
   * @param {...any} args   - Arguments forwarded to every client handler.
   * @returns {Promise<any[]>}
   */
  static async executeForAll(action, ...args) {
    const socket = NeuroshimaSocket.socket;
    if (!socket) return [];
    return socket.executeForEveryone(action, ...args);
  }
}
