/**
 * @deprecated Lifecycle ownership moved to NeuroshimaTestBase. This class is
 * retained as a compatibility adapter while legacy callers migrate to
 * `test.roll()`, `test.begin()` and `test.finish()`.
 */
export class TestRunner {
  static scriptRunner = null;

  static getScriptRunner() {
    const runner = this.scriptRunner ?? globalThis.game?.neuroshima?.NeuroshimaScriptRunner;
    if (!runner) throw new Error("NeuroshimaScriptRunner is not available");
    return runner;
  }

  static _attach(test) {
    test._scriptRunner = this.getScriptRunner();
    return test;
  }

  static async begin(test, options = {}) {
    return this._attach(test).begin(options);
  }

  static async finish(test, options = {}) {
    return this._attach(test).finish(options);
  }

  static async run(test, options = {}) {
    return this._attach(test).roll(options);
  }

  // Kept for older internal integrations which used these helpers directly.
  static _args(test) { return test.triggerArgs(); }
  static _metadata(test, phase) { return test.triggerMetadata(phase); }
  static async _dispatch(trigger, test, { phase, legacyTriggers = [] } = {}) {
    return this._attach(test).runTrigger(trigger, { phase, legacyTriggers });
  }
}
