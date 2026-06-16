const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Default system conditions.
 * Stored as plain objects — name is a display string (user-editable for custom conditions).
 */
export const DEFAULT_CONDITIONS = [
  {
    id: "dead", name: "Martwy", key: "dead", img: "icons/svg/skull.svg",
    type: "boolean", allowNegative: false, builtin: true, booleanOnly: true, scripts: [],
    conditionCheckCode: `if (!["npc", "creature"].includes(this.actor.type)) return;
const maxHP = this.actor.type === "creature"
  ? (this.actor.getFlag("neuroshima", "creatureMaxHP") || this.actor.system.combat?.maxHP || 27)
  : (this.actor.system.hp?.max ?? 27);
if (maxHP > 0 && this.totalDamagePoints >= maxHP) await this.apply();`
  },
  { id: "asleep",      name: "Śpiący",        key: "asleep",      img: "icons/svg/sleep.svg",       type: "boolean", allowNegative: false, builtin: true, booleanOnly: true,  scripts: [], conditionCheckCode: "" },
  { id: "unconscious", name: "Nieprzytomny",  key: "unconscious", img: "icons/svg/unconscious.svg", type: "boolean", allowNegative: false, builtin: true, booleanOnly: true,  scripts: [], conditionCheckCode: "" },
  { id: "stunned",     name: "Ogłuszony",     key: "stunned",     img: "icons/svg/daze.svg",        type: "boolean", allowNegative: false, builtin: true, booleanOnly: true,  scripts: [], conditionCheckCode: "" },
  {
    id: "prone", name: "Leżący", key: "prone", img: "icons/svg/falling.svg",
    type: "boolean", allowNegative: false, builtin: true, booleanOnly: true, scripts: [],
    conditionCheckCode: `if (!["npc", "creature"].includes(this.actor.type)) return;
const maxHP = this.actor.type === "creature"
  ? (this.actor.getFlag("neuroshima", "creatureMaxHP") || this.actor.system.combat?.maxHP || 27)
  : (this.actor.system.hp?.max ?? 27);
if (maxHP > 0 && this.totalDamagePoints >= maxHP) await this.apply();`
  },
  { id: "restrained",  name: "Unieruchomiony", key: "restrained",  img: "icons/svg/net.svg",        type: "int",     allowNegative: false, builtin: true, booleanOnly: false, intOnly: true, scripts: [], conditionCheckCode: "" },
  { id: "paralyzed",   name: "Sparaliżowany",  key: "paralyzed",   img: "icons/svg/paralysis.svg",  type: "boolean", allowNegative: false, builtin: true, booleanOnly: true,  scripts: [], conditionCheckCode: "" },
  { id: "blind",       name: "Ślepy",          key: "blind",       img: "icons/svg/blind.svg",      type: "boolean", allowNegative: false, builtin: true, booleanOnly: true,  scripts: [], conditionCheckCode: "" },
  { id: "deaf",        name: "Głuchy",         key: "deaf",        img: "icons/svg/deaf.svg",       type: "boolean", allowNegative: false, builtin: true, booleanOnly: true,  scripts: [], conditionCheckCode: "" },
  { id: "frightened",  name: "Przestraszony",  key: "frightened",  img: "icons/svg/terror.svg",     type: "int",     allowNegative: false, builtin: true, booleanOnly: false, intOnly: true, scripts: [], conditionCheckCode: "" },
  {
    id: "bleeding", name: "Krwawienie", key: "bleeding",
    img: "icons/svg/blood.svg", type: "int", allowNegative: false, builtin: true, booleanOnly: false, intOnly: true,
    conditionCheckCode: "",
    scripts: [
      {
        trigger: "startTurn",
        label: "Bleeding — wound at start of turn",
        runIfDisabled: false,
        code: `// Bleeding: deals 1 Light wound per bleeding stack at the start of the actor's turn.
const stacks = this.actor.getConditionValue("bleeding");
if (stacks <= 0) return;
const { NeuroshimaDice } = game.neuroshima;
for (let i = 0; i < stacks; i++) {
  await NeuroshimaDice.applyDamage(this.actor, { damageType: "L", location: "torso", source: "Krwawienie" });
}
await this.sendMessage(\`<strong>Krwawienie (\${stacks}×)</strong>: \${stacks} rana/rany Lekka/Lekkie.\`);`
      }
    ]
  },
  { id: "diseased",    name: "Chory",         key: "diseased",    img: "icons/svg/degen.svg",       type: "boolean", allowNegative: false, builtin: true, booleanOnly: true,  scripts: [], conditionCheckCode: "" },
  {
    id: "poisoned", name: "Zatruty", key: "poisoned",
    img: "icons/svg/poison.svg", type: "int", allowNegative: false, builtin: true, booleanOnly: false, intOnly: true,
    conditionCheckCode: "",
    scripts: [
      {
        trigger: "startTurn",
        label: "Poisoning — penalty at start of turn",
        runIfDisabled: false,
        code: `// Poisoning: applies a -10% test penalty at the start of turn per stack.
const stacks = this.actor.getConditionValue("poisoned");
if (stacks <= 0) return;
await this.sendMessage(\`<strong>Zatrucie (\${stacks}×)</strong>: kara \${stacks * 10}% do testów.\`);`
      }
    ]
  },
  { id: "invisible",   name: "Niewidzialny",  key: "invisible",   img: "icons/svg/invisible.svg",   type: "boolean", allowNegative: false, builtin: true, booleanOnly: true,  scripts: [], conditionCheckCode: "" },
  { id: "berserker",   name: "Berserker",     key: "berserker",   img: "systems/neuroshima/assets/img/berserker.svg", type: "boolean", allowNegative: false, builtin: true, booleanOnly: true,  scripts: [], conditionCheckCode: "" },
  {
    id: "overweight", name: "Przeciążony", key: "overweight",
    img: "systems/neuroshima/assets/effects/weight.svg",
    type: "boolean", allowNegative: false, builtin: true, booleanOnly: true, scripts: [],
    conditionCheckCode: `const enc = this.encumbrance;
if (!enc || enc.enabled === false || enc.max <= 0) return;
if (enc.value >= enc.max) await this.apply();
else await this.remove();`
  },
  // ── Combat Maneuver conditions ─────────────────────────────────────────────────────────────
  // These 4 conditions are applied automatically by MeleeTurnService during melee encounters.
  // They are PURELY cosmetic / informational on the token HUD — the mechanical effects are
  // enforced by the resolution code, NOT by condition scripts.
  //
  // They CANNOT be toggled manually via the token HUD (blocked in actor.toggleStatusEffect).
  // They are cleared at the start of each new turn and when the encounter ends.
  //
  // • maneuver-pace  (int  1–3): Zwiększone tempo — difficulty raised by `value` levels for
  //   BOTH combatants.  Applied to the initiator AND their primary opponent simultaneously.
  // • maneuver-charge (bool):    Szarża — declared at initiative roll time; shows for turn 1
  //   only (chargeLevel reset to 0 at startNewTurn).
  // • maneuver-fury   (bool):    Furia — +2 Zręczność in attack; auto-hit when losing initiative.
  // • maneuver-full-defense (bool): Pełna obrona — +2 Zręczność in defense; 2-success
  //   takeover threshold.
  {
    id: "maneuver-pace", name: "Zwiększone tempo", key: "maneuver-pace",
    img: "icons/svg/clockwork.svg",
    type: "int", allowNegative: false, builtin: true, booleanOnly: false, intOnly: true, scripts: [], conditionCheckCode: ""
  },
  {
    id: "maneuver-charge", name: "Szarża", key: "maneuver-charge",
    img: "systems/neuroshima/assets/effects/fist.svg",
    type: "boolean", allowNegative: false, builtin: true, booleanOnly: true, scripts: [], conditionCheckCode: ""
  },
  {
    id: "maneuver-fury", name: "Furia", key: "maneuver-fury",
    img: "icons/svg/eye.svg",
    type: "boolean", allowNegative: false, builtin: true, booleanOnly: true, scripts: [], conditionCheckCode: ""
  },
  {
    id: "maneuver-full-defense", name: "Pełna obrona", key: "maneuver-full-defense",
    img: "systems/neuroshima/assets/effects/shield.svg",
    type: "boolean", allowNegative: false, builtin: true, booleanOnly: true, scripts: [], conditionCheckCode: ""
  }
];

/**
 * Returns the current conditions from settings, falling back to defaults if empty.
 * For backwards compatibility: if a saved condition is missing `scripts` or `changes`
 * (saved before those fields were added), the DEFAULT_CONDITIONS entry is used as fallback.
 * @returns {object[]}
 */
export function getConditions() {
  try {
    const raw = game.settings.get("neuroshima", "conditions");
    const list = Array.isArray(raw) ? raw : (raw?.list ?? []);
    if (list.length === 0) return foundry.utils.deepClone(DEFAULT_CONDITIONS);

    const savedKeys = new Set(list.map(c => c.key));
    const allEntries = [
      ...list,
      ...DEFAULT_CONDITIONS.filter(d => !savedKeys.has(d.key)).map(d => foundry.utils.deepClone(d))
    ];

    return allEntries.map(saved => {
      const def = DEFAULT_CONDITIONS.find(d => d.key === saved.key);
      return {
        ...saved,
        builtin:            def?.builtin            ?? false,
        booleanOnly:        def?.booleanOnly        ?? false,
        intOnly:            def?.intOnly            ?? false,
        scripts:            saved.scripts            ?? def?.scripts            ?? [],
        changes:            saved.changes            ?? def?.changes            ?? [],
        conditionCheckCode: saved.conditionCheckCode ?? def?.conditionCheckCode ?? ""
      };
    });
  } catch {
    return foundry.utils.deepClone(DEFAULT_CONDITIONS);
  }
}

/**
 * Build an in-memory (synthetic) ActiveEffect document from a condition definition.
 * The returned document mimics a real AE: getFlag/setFlag/update all work,
 * but nothing is persisted to the database.  Writes are intercepted and routed
 * to the supplied saveCallback so data lands in the conditions setting.
 *
 * @param {object}   condDef      – condition definition from the setting
 * @param {Function} saveCallback – async (updatedFields) => void
 *                                  called with { name, img, changes, scripts }
 * @returns {ActiveEffect}
 */
function createSyntheticConditionEffect(condDef, saveCallback) {
  // A temporary, unsaved actor is needed as parent so the AE gets the full
  // Foundry document interface (toObject, schema, id, …).
  // Both need explicit _id so Foundry treats them as existing documents (not creation).
  const tempActor = new Actor({ _id: foundry.utils.randomID(), name: "_ns_temp", type: "npc" });

  const effectData = {
    _id:         foundry.utils.randomID(),
    name:        condDef.name         ?? "",
    img:         condDef.img          ?? "icons/svg/aura.svg",
    tint:        condDef._tint        ?? null,
    description: condDef._description ?? "",
    disabled:    condDef._disabled    ?? false,
    changes:     foundry.utils.deepClone(condDef.changes   ?? []),
    statuses:    [condDef.key],
    duration:    foundry.utils.deepClone(condDef._duration ?? {}),
    system: {
      scriptData: foundry.utils.deepClone(condDef.scripts ?? []),
    },
    flags: {
      neuroshima: {
        transferType:     condDef._transferType    ?? "owningDocument",
        documentType:     condDef._documentType    ?? "actor",
        equipTransfer:    condDef._equipTransfer   ?? false,
        manualChangeKeys: condDef._manualChangeKeys ?? false
      }
    }
  };

  const tempEffect = new CONFIG.ActiveEffect.documentClass(effectData, { parent: tempActor });

  // Marker used by NeuroshimaEffectSheet._processSubmitData to detect synthetic docs.
  tempEffect._isSyntheticConditionTemplate = true;

  /**
   * Core persistence handler — all writes go through here.
   * Merges changes into _source, re-initializes the DataModel so getters
   * reflect the new values, calls the save callback, then re-renders the sheet.
   */
  async function applyAndPersist(changes) {
    const expanded = foundry.utils.expandObject(changes);
    // updateSource validates against schema AND updates _source + re-initializes model
    if (typeof tempEffect.updateSource === "function") {
      try { tempEffect.updateSource(expanded); } catch { foundry.utils.mergeObject(tempEffect._source, expanded, { inplace: true, recursive: true }); }
    } else {
      foundry.utils.mergeObject(tempEffect._source, expanded, { inplace: true, recursive: true });
    }
    if (tempEffect.prepareData) tempEffect.prepareData();

    const src = tempEffect._source;
    await saveCallback({
      name:              src.name,
      img:               src.img,
      tint:              src.tint              ?? null,
      description:       src.description       ?? "",
      disabled:          src.disabled          ?? false,
      changes:           src.changes           ?? [],
      scripts:           src.system?.scriptData                 ?? [],
      _duration:         foundry.utils.deepClone(src.duration   ?? {}),
      _transferType:     src.flags?.neuroshima?.transferType    ?? "owningDocument",
      _documentType:     src.flags?.neuroshima?.documentType    ?? "actor",
      _equipTransfer:    src.flags?.neuroshima?.equipTransfer   ?? false,
      _manualChangeKeys: src.flags?.neuroshima?.manualChangeKeys ?? false
    });

    if (tempEffect._openSheet?.rendered) await tempEffect._openSheet.render();
  }

  tempEffect.update = async function(changes = {}, _options = {}) {
    await applyAndPersist(changes);
    return this;
  };

  // Override setFlag explicitly — Foundry's prototype setFlag calls this.update()
  // which should pick up our instance override, but we override here too for safety.
  tempEffect.setFlag = async function(scope, key, value) {
    await applyAndPersist({ [`flags.${scope}.${key}`]: value });
    return this;
  };

  return tempEffect;
}

/**
 * Override CONFIG.statusEffects with our conditions.
 * Call this once during init (after settings are ready).
 */
export function applyConditionsToStatusEffects() {
  const conditions = getConditions();
  CONFIG.statusEffects = conditions.map(c => ({
    id:       c.key,
    name:     c.name,
    img:      c.img,
    icon:     c.img,
    statuses: [c.key],
    changes:  foundry.utils.deepClone(c.changes ?? []),
    flags: {
      neuroshima: {
        scripts: foundry.utils.deepClone(c.scripts ?? [])
      }
    }
  }));
}

/**
 * Simple ApplicationV2 code editor for a condition's conditionCheckCode.
 * Uses the native <code-mirror> web component so the experience is consistent
 * with the rest of the effect-script editors.
 */
class ConditionCheckEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(condDef, onSave, options = {}) {
    super(options);
    this._condDef = condDef;
    this._onSave  = onSave;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "condition-check-editor"],
    window: {
      resizable: true,
      contentClasses: ["standard-form"]
    },
    position: { width: 560, height: 500 },
    form: {
      handler: ConditionCheckEditor._onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/apps/condition-check-editor.hbs"
    }
  };

  get title() {
    const base = game.i18n.localize("NEUROSHIMA.Settings.ConditionConfig.CheckEditorTitle");
    return `${base}: ${this._condDef.name}`;
  }

  async _prepareContext(options) {
    return { code: this._condDef.conditionCheckCode ?? "" };
  }

  static async _onSubmit(event, form, formData) {
    const cm = form.querySelector("code-mirror[name='conditionCheckCode']");
    const code = cm?.value ?? "";
    await this._onSave(code);
  }
}

/**
 * ApplicationV2 settings menu for managing actor conditions/states.
 */
export class ConditionConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._conditions = null;
  }

  /** @inheritdoc */
  static DEFAULT_OPTIONS = {
    id: "condition-config",
    tag: "form",
    classes: ["neuroshima", "condition-config"],
    window: {
      title: "NEUROSHIMA.Settings.ConditionConfig.Title",
      resizable: true
    },
    position: {
      width: 640,
      height: "auto"
    },
    form: {
      handler: async function(event, form, formData) {
        await this._onSubmit(event, form, formData);
      },
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      addCondition:        ConditionConfig.prototype._onAddCondition,
      deleteCondition:     ConditionConfig.prototype._onDeleteCondition,
      pickImage:           ConditionConfig.prototype._onPickImage,
      resetConditions:     ConditionConfig.prototype._onResetConditions,
      editConditionEffect: ConditionConfig.prototype._onEditConditionEffect,
      editConditionCheck:  ConditionConfig.prototype._onEditConditionCheck
    }
  };

  /** @inheritdoc */
  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/apps/condition-config.hbs"
    }
  };

  /** @inheritdoc */
  async _prepareContext(options) {
    if (!this._conditions) {
      this._conditions = foundry.utils.deepClone(getConditions());
    }
    return {
      conditions: this._conditions.map(c => ({
        ...c,
        typeFixed: !!(c.booleanOnly || c.intOnly)
      }))
    };
  }

  /**
   * Collect current form values back into this._conditions
   * so they are not lost when re-rendering after add/delete.
   * Merges only form-visible fields; scripts, changes, etc. are preserved
   * from the existing _conditions entry.
   * @param {HTMLFormElement} form
   */
  _collectFormState(form) {
    const fd = new FormDataExtended(form);
    const raw = fd.object;

    const updated = [];
    let i = 0;
    while (raw[`condition-${i}-key`] !== undefined) {
      const existing = this._conditions[i] ?? {};
      const isBuiltin    = !!existing.builtin;
      const isBoolOnly   = !!existing.booleanOnly;
      const isIntOnly    = !!existing.intOnly;
      updated.push({
        ...existing,
        id:            raw[`condition-${i}-id`]   || existing.id || foundry.utils.randomID(8),
        name:          isBuiltin ? existing.name  : (raw[`condition-${i}-name`]  || ""),
        key:           isBuiltin ? existing.key   : (raw[`condition-${i}-key`]   || ""),
        img:           raw[`condition-${i}-img`]   || "icons/svg/aura.svg",
        type:          isBoolOnly ? "boolean" : (isIntOnly ? "int" : (raw[`condition-${i}-type`] || "boolean")),
        allowNegative: isBuiltin ? !!existing.allowNegative : !!raw[`condition-${i}-allowNegative`]
      });
      i++;
    }
    if (updated.length > 0) this._conditions = updated;
  }

  /**
   * Add a new empty condition row.
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  async _onAddCondition(event, target) {
    const form = this.element.querySelector("form") ?? this.element;
    this._collectFormState(form);
    this._conditions.push({
      id:            foundry.utils.randomID(8),
      name:          "",
      key:           "",
      img:           "icons/svg/aura.svg",
      type:          "boolean",
      allowNegative: false
    });
    this.render();
  }

  /**
   * Delete a condition row.
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  async _onDeleteCondition(event, target) {
    const idx = parseInt(target.dataset.index ?? "-1", 10);
    if (idx < 0) return;
    const form = this.element.querySelector("form") ?? this.element;
    this._collectFormState(form);
    if (this._conditions[idx]?.builtin) return;
    this._conditions.splice(idx, 1);
    this.render();
  }

  /**
   * Open FilePicker for condition image selection.
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  async _onPickImage(event, target) {
    const idx = parseInt(target.dataset.index ?? "-1", 10);
    if (idx < 0) return;

    const currentImg = this._conditions[idx]?.img ?? "icons/svg/aura.svg";
    const fp = new foundry.applications.apps.FilePicker({
      type: "image",
      current: currentImg,
      callback: (path) => {
        const form = this.element.querySelector("form") ?? this.element;
        this._collectFormState(form);
        if (this._conditions[idx]) this._conditions[idx].img = path;
        this.render();
      }
    });
    fp.browse(currentImg);
  }

  /**
   * Open the NeuroshimaEffectSheet on a synthetic in-memory ActiveEffect built
   * from the condition definition.  Saves are intercepted and written back to
   * this._conditions[idx] so data persists when the user submits ConditionConfig.
   * No hidden actor or DB document is created.
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  async _onEditConditionEffect(event, target) {
    const idx = parseInt(target.dataset.index ?? "-1", 10);
    if (idx < 0) return;

    const form = this.element.querySelector("form") ?? this.element;
    this._collectFormState(form);
    const condDef = this._conditions[idx];
    if (!condDef?.key) {
      return ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Settings.ConditionConfig.NoKeyWarning"));
    }

    // Save callback: writes effect data back into this._conditions[idx]
    const self = this;
    const saveCallback = async ({ name, img, tint, description, disabled, changes, scripts, _duration, _transferType, _documentType, _equipTransfer, _manualChangeKeys }) => {
      const cond = self._conditions[idx];
      if (!cond) return;
      cond.name              = name              ?? cond.name;
      cond.img               = img               ?? cond.img;
      cond._tint             = tint              ?? cond._tint        ?? null;
      cond._description      = description       ?? cond._description ?? "";
      cond._disabled         = disabled          ?? cond._disabled    ?? false;
      cond.changes           = changes           ?? cond.changes      ?? [];
      cond.scripts           = scripts           ?? cond.scripts      ?? [];
      cond._duration         = _duration         ?? cond._duration    ?? {};
      cond._transferType     = _transferType     ?? cond._transferType ?? "owningDocument";
      cond._documentType     = _documentType     ?? cond._documentType ?? "actor";
      cond._equipTransfer    = _equipTransfer    ?? cond._equipTransfer ?? false;
      cond._manualChangeKeys = _manualChangeKeys ?? false;
      game.neuroshima?.log(`[ConditionConfig] saveCallback for "${cond.key}" — scripts:`, foundry.utils.deepClone(cond.scripts));
    };

    const tempEffect = createSyntheticConditionEffect(condDef, saveCallback);

    const { NeuroshimaEffectSheet } = await import("../../sheets/neuroshima-effect-sheet.js");
    const sheet = new NeuroshimaEffectSheet({ document: tempEffect });
    tempEffect._openSheet = sheet;
    sheet.render(true);
  }

  /**
   * Open a simple dialog to edit the auto-check script for a condition.
   * The script runs inside _checkAutoConditions on the actor whenever actor/item data changes.
   * Context (this): NeuroshimaConditionCheckContext — see actor.js.
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  async _onEditConditionCheck(event, target) {
    const idx = parseInt(target.dataset.index ?? "-1", 10);
    if (idx < 0) return;
    const form = this.element.querySelector("form") ?? this.element;
    this._collectFormState(form);
    const condDef = this._conditions[idx];
    if (!condDef) return;

    const self = this;
    const editor = new ConditionCheckEditor(condDef, async (code) => {
      if (self._conditions[idx]) self._conditions[idx].conditionCheckCode = code;
    });
    editor.render(true);
  }

  /**
   * Reset conditions to system defaults.
   * @param {PointerEvent} event
   * @param {HTMLElement}  target
   */
  async _onResetConditions(event, target) {
    this._conditions = foundry.utils.deepClone(DEFAULT_CONDITIONS);
    this.render();
  }

  /**
   * Handle form submission — save conditions to settings.
   * @param {Event}            event
   * @param {HTMLFormElement}  form
   * @param {FormDataExtended} formData
   */
  async _onSubmit(event, form, formData) {
    this._collectFormState(form);

    const conditions = this._conditions
      .filter(c => c.key.trim().length > 0 && c.name.trim().length > 0)
      .map(c => ({
        id:            c.id || foundry.utils.randomID(8),
        name:          c.name.trim(),
        key:           c.key.trim().toLowerCase().replace(/\s+/g, "_"),
        img:           c.img || "icons/svg/aura.svg",
        type:          c.booleanOnly ? "boolean" : (c.intOnly ? "int" : (c.type === "int" ? "int" : "boolean")),
        allowNegative: (c.booleanOnly || c.type !== "int") ? false : !!c.allowNegative,
        builtin:       !!c.builtin,
        booleanOnly:   !!c.booleanOnly,
        intOnly:       !!c.intOnly,
        scripts:            c.scripts            ?? [],
        changes:            c.changes            ?? [],
        conditionCheckCode: c.conditionCheckCode  ?? "",
        _tint:              c._tint              ?? null,
        _description:  c._description  ?? "",
        _disabled:     c._disabled     ?? false,
        _duration:     c._duration     ?? {},
        _transferType: c._transferType ?? "owningDocument",
        _documentType: c._documentType ?? "actor",
        _equipTransfer:c._equipTransfer ?? false
      }));

    game.neuroshima?.log("[ConditionConfig] _onSubmit — saving conditions:", conditions.map(c => ({ key: c.key, scriptsCount: c.scripts?.length ?? 0, changesCount: c.changes?.length ?? 0 })));
    await game.settings.set("neuroshima", "conditions", conditions);
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.ConditionConfig.Saved"));
    game.neuroshima?.log("Conditions saved:", conditions);
    SettingsConfig.reloadConfirm({ world: true });
  }
}
