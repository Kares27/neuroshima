export class TestTransformationQueue {
  constructor() {
    this._entries = [];
  }

  add(transform, { id = null, priority = 0 } = {}) {
    if (typeof transform !== "function") return;
    this._entries.push({ transform, id, priority });
  }

  async apply(test) {
    const entries = [...this._entries].sort((a, b) => a.priority - b.priority);
    this._entries.length = 0;
    for (const entry of entries) await entry.transform(test);
  }
}

export class SideEffectQueue {
  constructor() {
    this._entries = [];
  }

  add(effect, { id = null, priority = 0 } = {}) {
    if (typeof effect !== "function") return;
    this._entries.push({ effect, id, priority });
  }

  async commit(test) {
    const entries = [...this._entries].sort((a, b) => a.priority - b.priority);
    this._entries.length = 0;
    for (const entry of entries) await entry.effect(test);
  }

  clear() {
    this._entries.length = 0;
  }
}
