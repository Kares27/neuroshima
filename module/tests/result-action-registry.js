/**
 * Actions made available by a resolved test (damage, jam, healing, etc.).
 * Registration is separate from execution so previews and cancelled tests
 * cannot accidentally mutate documents.
 */
export class ResultActionRegistry {
  constructor() {
    this._actions = new Map();
  }

  register(id, action) {
    if (!id || typeof action?.execute !== "function") return;
    this._actions.set(id, { id, label: id, ...action });
  }

  get(id) { return this._actions.get(id) ?? null; }
  list() { return [...this._actions.values()]; }

  async execute(id, test, payload = {}) {
    const action = this.get(id);
    if (!action) throw new Error(`Unknown test result action: ${id}`);
    return action.execute(test, payload);
  }
}
