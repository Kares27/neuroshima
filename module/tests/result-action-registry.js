/**
 * Actions made available by a resolved test (damage, jam, healing, etc.).
 * Registration is separate from execution so previews and cancelled tests
 * cannot accidentally mutate documents.
 */
export class ResultActionRegistry {
  constructor() {
    this._actions = new Map();
    this._pending = new Set();
    this._waiters = [];
  }

  register(id, action) {
    if (!id || typeof action?.execute !== "function") return;
    this._actions.set(id, { id, label: id, ...action });
    if (action.requiresResolution) this._pending.add(id);
  }

  get(id) { return this._actions.get(id) ?? null; }
  list() { return [...this._actions.values()]; }

  async execute(id, test, payload = {}) {
    const action = this.get(id);
    if (!action) throw new Error(`Unknown test result action: ${id}`);
    const result = await action.execute(test, payload);
    if (result !== false) this.resolve(id);
    return result;
  }

  resolve(id) {
    this._pending.delete(id);
    if (!this._pending.size) this._flushWaiters();
  }

  dismiss(id) { this.resolve(id); }
  dismissAll() {
    this._pending.clear();
    this._flushWaiters();
  }

  get pending() { return [...this._pending]; }

  waitForResolution() {
    // Most existing actions are post-render and therefore non-blocking.
    // New staged actions opt in with requiresResolution:true.
    if (!this._pending.size) return Promise.resolve();
    return new Promise(resolve => this._waiters.push(resolve));
  }

  serialize() {
    return this.list().map(({ execute, ...action }) => ({
      ...action,
      pending: this._pending.has(action.id)
    }));
  }

  _flushWaiters() {
    for (const resolve of this._waiters.splice(0)) resolve();
  }
}
