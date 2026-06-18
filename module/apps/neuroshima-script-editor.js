import { NeuroshimaScriptRunner } from "./neuroshima-script-engine.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class NeuroshimaScriptEditor extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(effect, index, options = {}) {
    super(options);
    this.effect = effect;
    this.scriptIndex = index;
    this._cmSaveTimer = null;
    // Local pending state — used to pass isDialogScript value through
    // the render cycle without relying on the possibly-stale this.effect reference.
    // Set immediately on checkbox toggle, cleared after render picks it up.
    this._pendingIsDialogScript = null;
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["neuroshima", "script-editor"],
    window: { resizable: true },
    position: { width: 640, height: 620 }
  };

  static PARTS = {
    form: { template: "systems/neuroshima/templates/apps/script-editor.hbs" }
  };

  /**
   * Always return the most up-to-date effect document.
   * When a parent Item/Actor is updated, Foundry recreates embedded documents —
   * this.effect may become a stale reference to the old object. Using the UUID
   * ensures we always read from the live document registry.
   */
  get _freshEffect() {
    return fromUuidSync(this.effect.uuid) ?? this.effect;
  }

  get title() {
    const scripts = this._freshEffect.system?.scriptData ?? [];
    const label = scripts[this.scriptIndex]?.label;
    return label || game.i18n.localize("NEUROSHIMA.Scripts.NewScript");
  }

  async _prepareContext(options) {
    const scripts = this._freshEffect.system?.scriptData ?? [];
    const scriptData = foundry.utils.deepClone(scripts[this.scriptIndex]) || { trigger: "manual", label: "", code: "" };
    scriptData.code             = (scriptData.code             ?? "").trimEnd();
    scriptData.hideScript       = (scriptData.hideScript       ?? "").trimEnd();
    scriptData.activateScript   = (scriptData.activateScript   ?? "").trimEnd();
    scriptData.submissionScript = (scriptData.submissionScript ?? "").trimEnd();
    scriptData.dialogCode       = (scriptData.dialogCode       ?? "").trimEnd();
    scriptData.isDialogScript   = scriptData.isDialogScript ?? false;

    // _pendingIsDialogScript overrides the stored value for the render immediately
    // following a checkbox toggle, so the UI reflects the user's intent even if
    // the Foundry document cache hasn't updated yet.
    if (this._pendingIsDialogScript !== null) {
      scriptData.isDialogScript = this._pendingIsDialogScript;
      this._pendingIsDialogScript = null;
    }

    // showDialogSubScripts: show hideScript/activateScript blocks
    // for dialog trigger OR for getMeleeActions with isDialogScript enabled.
    const showDialogSubScripts = scriptData.trigger === "dialog" ||
      (scriptData.trigger === "getMeleeActions" && scriptData.isDialogScript);
    // isMeleeActionsScript: show the isDialogScript checkbox only for getMeleeActions.
    const isMeleeActionsScript = scriptData.trigger === "getMeleeActions";
    // showDialogCode: getMeleeActions + isDialogScript — show the separate dialogCode field
    // (pre-roll dialog modifier, args.fields.*). The main `code` remains the passive push script.
    const showDialogCode = scriptData.trigger === "getMeleeActions" && scriptData.isDialogScript;
    // showSubmissionScript: show the submissionScript editor block.
    // For getMeleeActions in dialog mode, submissionScript runs when modifier is checked and Attack clicked.
    const showSubmissionScript = scriptData.trigger === "dialog" ||
      (scriptData.trigger === "getMeleeActions" && scriptData.isDialogScript);
    return {
      scriptData,
      triggers: NeuroshimaScriptRunner.TRIGGERS,
      index: this.scriptIndex,
      showDialogSubScripts,
      isMeleeActionsScript,
      showDialogCode,
      showSubmissionScript
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const form = this.element;

    form.querySelector('select[name="trigger"]')?.addEventListener("change", async () => {
      await this._persist(form);
      this.render({ force: true });
    });

    form.querySelector('input[name="label"]')?.addEventListener("change", () => this._persist(form));
    form.querySelector('input[name="runIfDisabled"]')?.addEventListener("change", () => this._persist(form));
    form.querySelector('input[name="targeter"]')?.addEventListener("change", () => this._persist(form));
    form.querySelector('input[name="defendingAgainst"]')?.addEventListener("change", () => this._persist(form));

    // isDialogScript toggle: save the new value into _pendingIsDialogScript BEFORE
    // persisting, so that the re-render uses the correct value even if the
    // Foundry document cache still holds the old embedded document reference.
    const isDialogEl = form.querySelector('input[name="isDialogScript"]');
    if (isDialogEl) {
      isDialogEl.addEventListener("change", async () => {
        this._pendingIsDialogScript = isDialogEl.checked;
        await this._persist(form);
        this.render({ force: true });
      });
    }

    form.querySelectorAll("code-mirror").forEach(cm => {
      cm.addEventListener("change", () => {
        clearTimeout(this._cmSaveTimer);
        this._cmSaveTimer = setTimeout(() => this._persist(form), 400);
      });
    });

    form.querySelector(".ns-se-save-btn")?.addEventListener("click", async () => {
      await this._persist(form);
      await this.close();
    });
  }

  _readCmValue(form, name) {
    return form.querySelector(`code-mirror[name="${name}"]`)?.value ?? undefined;
  }

  async _persist(form) {
    // Use the fresh effect reference so we never write back stale data
    // from a superseded embedded document instance.
    const effect = this._freshEffect;
    const scripts = foundry.utils.deepClone(effect.system?.scriptData ?? []);
    if (!scripts[this.scriptIndex]) return;
    const s = scripts[this.scriptIndex];

    const labelEl = form.querySelector('input[name="label"]');
    if (labelEl) s.label = labelEl.value;

    const triggerEl = form.querySelector('select[name="trigger"]');
    if (triggerEl) s.trigger = triggerEl.value;

    const ridEl = form.querySelector('input[name="runIfDisabled"]');
    s.runIfDisabled = ridEl ? ridEl.checked : (s.runIfDisabled ?? false);

    const targeterEl = form.querySelector('input[name="targeter"]');
    s.targeter = targeterEl ? targeterEl.checked : (s.targeter ?? false);

    const defendingEl = form.querySelector('input[name="defendingAgainst"]');
    s.defendingAgainst = defendingEl ? defendingEl.checked : (s.defendingAgainst ?? false);

    // _pendingIsDialogScript is authoritative when set (checkbox was just toggled).
    // Fall back to reading the DOM element, then the stored value.
    const isDialogScriptEl = form.querySelector('input[name="isDialogScript"]');
    if (this._pendingIsDialogScript !== null) {
      s.isDialogScript = this._pendingIsDialogScript;
    } else {
      s.isDialogScript = isDialogScriptEl ? isDialogScriptEl.checked : (s.isDialogScript ?? false);
    }

    const code = this._readCmValue(form, "code");
    if (code !== undefined) s.code = code;

    const hideScript = this._readCmValue(form, "hideScript");
    if (hideScript !== undefined) s.hideScript = hideScript;

    const activateScript = this._readCmValue(form, "activateScript");
    if (activateScript !== undefined) s.activateScript = activateScript;

    const submissionScript = this._readCmValue(form, "submissionScript");
    if (submissionScript !== undefined) s.submissionScript = submissionScript;

    const dialogCode = this._readCmValue(form, "dialogCode");
    if (dialogCode !== undefined) s.dialogCode = dialogCode;

    await effect.update({ "system.scriptData": scripts });
    // Refresh our local reference after the update — the embedded document
    // instance may have been recreated by Foundry's document lifecycle.
    this.effect = this._freshEffect;
  }

}
