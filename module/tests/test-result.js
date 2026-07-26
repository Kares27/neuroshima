/**
 * Stable, mutable result shared by every phase of a Neuroshima test.
 *
 * `data` is deliberately the same object returned to legacy chat renderers.
 * New code should use TestResult properties; `rollData` exists only as a
 * compatibility view for existing effect scripts.
 */
export class TestResult {
  constructor(data = {}) {
    this.data = data;
    this.roll = null;
    this.cancelled = false;
    this.skipped = false;
    this.forceSuccessMode = null;
    this.annotations = Array.isArray(data.annotations) ? data.annotations : [];
    this.tags = new Set();
  }

  get rollData() { return this.data; }
  get isSuccess() { return this.data.success === true; }
  set isSuccess(value) { this.data.success = value === true; }
  get successCount() { return Number(this.data.successCount ?? 0); }
  set successCount(value) { this.data.successCount = Number(value ?? 0); }
  get successPoints() { return Number(this.data.successPoints ?? 0); }
  set successPoints(value) { this.data.successPoints = Number(value ?? 0); }

  forceSuccess(mode) {
    this.forceSuccessMode = mode;
    this.data.autoSuccess = true;
    this.data.success = true;
    this.data.successCount = Math.max(1, Number(this.data.successCount ?? 0));
    if (this.data.isOpen) {
      this.data.successPoints = Math.max(0, Number(this.data.successPoints ?? 0));
    }
  }

  toLegacyData() {
    this.data.annotations = this.annotations;
    // Keep compatibility for callers without persisting a complex Roll in
    // ChatMessage flags or creating a circular test/result graph.
    Object.defineProperty(this.data, "roll", {
      value: this.roll,
      writable: true,
      configurable: true,
      enumerable: false
    });
    this.data.cancelled = this.cancelled;
    this.data.skipped = this.skipped;
    this.data.forceSuccessMode = this.forceSuccessMode;
    return this.data;
  }
}
