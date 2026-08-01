import { NEUROSHIMA } from "../../config.js";
import { NeuroshimaScriptRunner } from "../neuroshima-script-engine.js";
import { NeuroshimaRollDialogBase } from "./roll-dialog-base.js";
import { AttributeTest, SkillTest, TestRules } from "../../tests.mjs";

/**
 * Dialog for skill/attribute rolls.
 * Uses WFRP-inspired re-render pattern: userEntry tracks user overrides,
 * scripts run fresh on every _prepareContext call, without DOM delta accumulation.
 */
export class NeuroshimaSkillRollDialog extends NeuroshimaRollDialogBase {
  constructor(options = {}) {
    super(options);

    this.stat = options.stat;
    this.skill = options.skill;
    this.label = options.label;
    this.isSkill = options.isSkill ?? false;
    this.skillKey = options.skillKey ?? "";
    this.testType = options.testType ?? null;
    this.testSubtype = options.testSubtype ?? null;

    const lastRoll =
      options.lastRoll
      || this.actor?.system?.lastRoll
      || {};

    this.rollOptions = {
      baseDifficulty:
        lastRoll.baseDifficulty
        || "average",

      modifier:
        lastRoll.modifier
        || 0,

      useArmorPenalty:
        lastRoll.useArmorPenalty
        ?? true,

      useWoundPenalty:
        lastRoll.useWoundPenalty
        ?? true,

      useDiseasePenalty:
        lastRoll.useDiseasePenalty
        ?? true,

      useEffectPenalty:
        lastRoll.useEffectPenalty
        ?? true,

      isOpen:
        lastRoll.isOpen
        ?? true,

      rollMode:
        lastRoll.rollMode
        || game.settings.get("core", "rollMode"),

      currentAttribute:
        options.currentAttribute
        || ""
    };

    this.resultCallback = options.resultCallback ?? null;
    this._onRollCallback = options.onRoll ?? null;
  }

  /**
   * Open the dialog and wait until the roll finishes or the user cancels it.
   * @param {object} options Dialog constructor options.
   * @returns {Promise<object|null>} Roll payload or null after cancellation.
   */
  static wait(options = {}) {
    return NeuroshimaRollDialogBase.prompt(this, options);
  }

  static DEFAULT_OPTIONS = {
    tag: "form",

    classes: [
      "neuroshima",
      "dialog",
      "standard-form",
      "roll-dialog-window",
      "roll-dialog",
      "skill-roll-dialog"
    ],

    position: {
      width: 520,
      height: "auto"
    },

    window: {
      resizable: false,
      minimizable: false
    },

    actions: {
      roll:
        NeuroshimaSkillRollDialog.prototype._onRoll,

      cancel:
        NeuroshimaSkillRollDialog.prototype._onCancel
    }
  };

  static PARTS = {
    form: {
      template:
        "systems/neuroshima/templates/dialog/roll-dialog.hbs"
    }
  };

  get title() {
    return `${
      game.i18n.localize("NEUROSHIMA.Actions.Roll")
    }: ${this.label}`;
  }

  /**
   * Zwraca Współczynnik, który powinien być faktycznie
   * użyty przez dialog i rzut.
   *
   * Kolejność:
   *
   * 1. Współczynnik wymuszony przez aktywny dialog modifier.
   * 2. Współczynnik ręcznie wybrany przez użytkownika.
   * 3. Współczynnik domyślny przekazany podczas otwarcia dialogu.
   *
   * Nadpisanie działa tylko podczas testu Umiejętności.
   */
  _resolveEffectiveAttributeKey(scriptFields = {}) {
    const baseAttributeKey =
      this.userEntry.attribute
      ?? this.rollOptions.currentAttribute
      ?? "";

    /*
     * Nie zmieniamy Współczynnika podczas testu
     * samego Współczynnika.
     */
    if (!this.isSkill) {
      return baseAttributeKey;
    }

    const requestedAttributeKey =
      scriptFields.attributeKey;

    /*
     * Sprawdzamy, czy skrypt podał prawidłowy klucz
     * zdefiniowany w konfiguracji systemu.
     */
    if (
      requestedAttributeKey
      && NEUROSHIMA.attributes?.[requestedAttributeKey]
    ) {
      return requestedAttributeKey;
    }

    return baseAttributeKey;
  }

  _resolveEffectiveSkill(scriptFields = {}) {
    const requestedKey = scriptFields.skillKey;
    const key = requestedKey && (
      this.actor.system.skills?.[requestedKey]
      || (requestedKey === "experience" && this.actor.type === "creature")
    )
      ? requestedKey
      : this.skillKey;
    if (!this.isSkill || !key || key === this.skillKey) {
      return { key: this.skillKey || null, value: Number(this.skill ?? 0) };
    }
    const value = key === "experience" && this.actor.type === "creature"
      ? Number(this.actor.system.experience ?? 0)
      : Number(this.actor.system.skills?.[key]?.value ?? 0);
    return { key, value };
  }

  async _prepareContext(options) {
    const context =
      await super._prepareContext(options);

    const actorArmorPenalty =
      this.actor.system.combat?.totalArmorPenalty
      || 0;

    const actorWoundPenalty =
      this.actor.system.combat?.totalWoundPenalty
      || 0;

    const actorDiseasePenalty =
      this._computeActorDiseasePenalty();

    const actorEffectPenalty =
      this._computeActorEffectPenalty();

    const userModifier =
      this.userEntry.modifier
      ?? this.rollOptions.modifier
      ?? 0;

    const userAttrBonus =
      this.userEntry.attributeBonus
      ?? 0;

    const userSkillBonus =
      this.userEntry.skillBonus
      ?? 0;

    const baseDifficulty =
      this.userEntry.baseDifficulty
      ?? this.rollOptions.baseDifficulty
      ?? "average";

    const isOpenRaw =
      this.userEntry.isOpen
      ?? this.rollOptions.isOpen
      ?? true;

    const isOpen =
      isOpenRaw === true
      || isOpenRaw === "true";

    const useArmorPenalty =
      this.userEntry.useArmorPenalty
      ?? this.rollOptions.useArmorPenalty
      ?? true;

    const useWoundPenalty =
      this.userEntry.useWoundPenalty
      ?? this.rollOptions.useWoundPenalty
      ?? true;

    const useDiseasePenalty =
      this.userEntry.useDiseasePenalty
      ?? this.rollOptions.useDiseasePenalty
      ?? true;

    const useEffectPenalty =
      this.userEntry.useEffectPenalty
      ?? this.rollOptions.useEffectPenalty
      ?? true;

    const rollMode =
      this.userEntry.rollMode
      ?? this.rollOptions.rollMode;

    /*
     * Jest to Współczynnik bazowy, przed wykonaniem
     * aktywnych modyfikatorów dialogowych.
     */
    const baseAttributeKey =
      this.userEntry.attribute
      ?? this.rollOptions.currentAttribute
      ?? "";

    const skillObj =
      this.isSkill
        ? {
            name: this.label,
            value: this.skill,
            key: this.skillKey
          }
        : null;

    const attrValue =
      baseAttributeKey
        ? (
            this.actor.system.attributeTotals?.[
              baseAttributeKey
            ]
            ?? this.stat
          )
        : this.stat;

    /*
     * Ten obiekt jest przekazywany do skryptu jako dane tylko do odczytu:
     *
     * args.attribute
     *
     * Zmianę współczynnika skrypt zapisuje wyłącznie przez:
     * args.fields.attributeKey
     *
     * Reprezentuje Współczynnik używany przed
     * zastosowaniem dialog modifiera.
     */
    const attrObj = {
      name: baseAttributeKey,
      value: attrValue,
      key: baseAttributeKey
    };

    const targetActors = Array.from(
      game.user.targets || []
    )
      .map(token => token.actor)
      .filter(Boolean);

    const {
      dialogModifiers,
      scriptFields,
      modBreakdown,
      attrBreakdown,
      skillBreakdown,
      effectPenaltyBreakdown,
      preRollModifiers
    } = await NeuroshimaScriptRunner.computeDialogFields(
      this.actor,
      {
        rollType:
          this.isSkill
            ? "skill"
            : "attribute",

        label:
          this.label,

        stat:
          this.stat,

        skill:
          skillObj,

        attribute:
          attrObj,

        attributeKey:
          baseAttributeKey || null,

        skillKey:
          this.skillKey || null,

        difficulty:
          baseDifficulty
      },
      this.selectedModifierIds,
      this.unselectedModifierIds,
      targetActors,
      {
        scriptFlags: this._scriptFlags,
        resolveFinalContext: ({ scriptFields: sf }) => {
          const effectiveDifficulty = (sf.difficulty && this.userEntry.baseDifficulty === undefined)
            ? sf.difficulty
            : baseDifficulty;
          const totalSkill = (this.skill || 0) + userSkillBonus + (sf.skillBonus || 0);
          return {
            finalDifficulty: NeuroshimaScriptRunner.resolveFinalDifficultyKey({
              difficulty: effectiveDifficulty,
              difficultyShift: sf.difficultyShift || 0,
              finalDifficultyShift: Number(sf.finalDifficultyShift ?? 0),
              penalties: [
                userModifier + (sf.modifier || 0),
                useArmorPenalty ? actorArmorPenalty + (sf.armorDelta || 0) : 0,
                useWoundPenalty ? actorWoundPenalty + (sf.woundDelta || 0) : 0,
                useDiseasePenalty ? actorDiseasePenalty + (sf.diseasePenalty || 0) : 0,
                useEffectPenalty ? actorEffectPenalty + (sf.effectPenalty || 0) : 0
              ],
              skillShift: TestRules.skillShift(totalSkill)
            })
          };
        }
      }
    );

    /*
     * NOWE:
     *
     * Po wykonaniu skryptów ustalamy Współczynnik,
     * który faktycznie ma być używany.
     *
     * Dla Zawziętego sukinkota:
     *
     * scriptFields.attributeKey === "charisma"
     */
    const effectiveAttributeKey =
      this._resolveEffectiveAttributeKey(
        scriptFields
      );

    this._dialogModifiers =
      dialogModifiers;

    this._scriptFields =
      scriptFields;

    this._breakdown = {
      mod: modBreakdown,
      attr: attrBreakdown,
      skill: skillBreakdown,
      effect: effectPenaltyBreakdown
    };

    this._userValues = {
      modifier: userModifier,
      attributeBonus: userAttrBonus,
      skillBonus: userSkillBonus
    };

    this._preRollModifiers =
      preRollModifiers
      ?? [];

    context.actor =
      this.actor;

    context.difficulties =
      NEUROSHIMA.difficulties;

    context.attributeList =
      NEUROSHIMA.attributes;

    /*
     * ZMIANA:
     *
     * Wcześniej:
     *
     * context.currentAttribute = baseAttributeKey;
     *
     * Teraz szablon dostaje Współczynnik wynikowy.
     * Select w dialogu zaznaczy więc Charakter.
     */
    context.currentAttribute =
      effectiveAttributeKey;

    context.isSkill =
      this.isSkill;

    context.modifier =
      userModifier
      + scriptFields.modifier;

    context.attributeBonus =
      userAttrBonus
      + scriptFields.attributeBonus;

    context.skillBonus =
      userSkillBonus
      + scriptFields.skillBonus;

    context.dieManualBonus =
      this.userEntry.dieManualBonus
      ?? 0;

    context.dieReductionBonus =
      this.userEntry.dieReductionBonus
      ?? 0;

    context.armorPenalty =
      actorArmorPenalty
      + scriptFields.armorDelta;

    context.woundPenalty =
      actorWoundPenalty
      + scriptFields.woundDelta;

    context.diseasePenalty =
      actorDiseasePenalty
      + (
        scriptFields.diseasePenalty
        || 0
      );

    context.showDiseasePenalty =
      context.diseasePenalty > 0;

    context.showWeaponModifier =
      false;

    let effectDifficulty =
      (
        scriptFields.difficulty
        && this.userEntry.baseDifficulty === undefined
      )
        ? scriptFields.difficulty
        : baseDifficulty;

    if (scriptFields.difficultyShift) {
      effectDifficulty =
        NeuroshimaScriptRunner.shiftDifficultyKey(
          effectDifficulty,
          scriptFields.difficultyShift
        );
    }

    context.baseDifficulty =
      effectDifficulty;

    context.isOpen =
      isOpen;

    context.useArmorPenalty =
      useArmorPenalty;

    context.useWoundPenalty =
      useWoundPenalty;

    context.useDiseasePenalty =
      useDiseasePenalty;

    this._prepareEffectPenaltyContext(context, useEffectPenalty);

    context.rollMode =
      rollMode;

    context.rollModes =
      CONFIG.Dice.rollModes;

    context.dialogModifiers =
      dialogModifiers;

    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const html =
      this.element;

    this._applyTooltips(html);
    this._updateSummary(html);

    html
      .querySelectorAll(
        '[data-action="clickModifier"].dm-toggleable'
      )
      .forEach(li => {
        li.addEventListener("click", () => {
          const effectId =
            li.dataset.dmEffectId;

          if (!effectId) return;

          const isActive =
            li.classList.contains("dm-active");

          if (isActive) {
            this.selectedModifierIds.delete(
              effectId
            );

            this.unselectedModifierIds.add(
              effectId
            );
          } else {
            this.unselectedModifierIds.delete(
              effectId
            );

            this.selectedModifierIds.add(
              effectId
            );
          }

          /*
           * Ponowne renderowanie wykonuje ponownie
           * _prepareContext(), więc aktywny modifier
           * natychmiast zmieni context.currentAttribute.
           */
          this.render();
        });
      });

    html
      .querySelectorAll("input, select")
      .forEach(element => {
        element.addEventListener(
          "change",
          event => this._onFieldChange(event)
        );
      });

    html
      .querySelectorAll(".form-group")
      .forEach(group => {
        group.addEventListener(
          "click",
          event => {
            if (
              event.target.matches(
                "select, input"
              )
            ) {
              return;
            }

            const input =
              group.querySelector(
                "select, input"
              );

            if (!input) return;

            if (input.matches("select")) {
              input.focus();
            } else if (
              input.matches(
                'input[type="checkbox"]'
              )
            ) {
              input.checked =
                !input.checked;

              input.dispatchEvent(
                new Event(
                  "change",
                  { bubbles: true }
                )
              );
            } else if (
              input.matches(
                'input[type="number"]'
              )
            ) {
              input.focus();
              input.select();
            }
          }
        );
      });

    const cancelBtn =
      html.querySelector(
        '[data-action="cancel"]'
      );

    if (cancelBtn) {
      cancelBtn.addEventListener(
        "click",
        event => {
          event.preventDefault();
          this.close();
        }
      );
    }
  }

  _updateSummary(html) {
    if (!html) {
      html = this.element;
    }

    const sf =
      this._scriptFields || {};

    const uv =
      this._userValues || {};

    const userModifier =
      uv.modifier
      ?? 0;

    const userAttrBonus =
      uv.attributeBonus
      ?? 0;

    const userSkillBonus =
      uv.skillBonus
      ?? 0;

    const modifier =
      userModifier
      + (
        sf.modifier
        || 0
      );

    const attrBonus =
      userAttrBonus
      + (
        sf.attributeBonus
        || 0
      );

    const skillBonus =
      userSkillBonus
      + (
        sf.skillBonus
        || 0
      );

    let baseDifficulty =
      (
        sf.difficulty
        && this.userEntry.baseDifficulty === undefined
      )
        ? sf.difficulty
        : (
            this.userEntry.baseDifficulty
            ?? this.rollOptions.baseDifficulty
            ?? "average"
          );

    if (sf.difficultyShift) {
      baseDifficulty =
        NeuroshimaScriptRunner.shiftDifficultyKey(
          baseDifficulty,
          sf.difficultyShift
        );
    }

    const isOpenRaw =
      this.userEntry.isOpen
      ?? this.rollOptions.isOpen
      ?? true;

    const isOpen =
      isOpenRaw === true
      || isOpenRaw === "true";

    const useArmorPenalty =
      this.userEntry.useArmorPenalty
      ?? this.rollOptions.useArmorPenalty
      ?? true;

    const useWoundPenalty =
      this.userEntry.useWoundPenalty
      ?? this.rollOptions.useWoundPenalty
      ?? true;

    const useDiseasePenalty =
      this.userEntry.useDiseasePenalty
      ?? this.rollOptions.useDiseasePenalty
      ?? true;

    const useEffectPenalty =
      this.userEntry.useEffectPenalty
      ?? this.rollOptions.useEffectPenalty
      ?? true;

    /*
     * ZMIANA:
     *
     * Podgląd celu używa teraz tego samego
     * Współczynnika co select w dialogu.
     */
    const currentAttribute =
      this._resolveEffectiveAttributeKey(sf);
    const currentSkill = this._resolveEffectiveSkill(sf);

    const actorArmorPenalty =
      this.actor.system.combat?.totalArmorPenalty
      || 0;

    const actorWoundPenalty =
      this.actor.system.combat?.totalWoundPenalty
      || 0;

    const actorDiseasePenalty =
      this._computeActorDiseasePenalty();

    const armorPenalty =
      useArmorPenalty
        ? (
            actorArmorPenalty
            + (
              sf.armorDelta
              || 0
            )
          )
        : 0;

    const woundPenalty =
      useWoundPenalty
        ? (
            actorWoundPenalty
            + (
              sf.woundDelta
              || 0
            )
          )
        : 0;

    const diseasePenalty =
      useDiseasePenalty
        ? (
            actorDiseasePenalty
            + (
              sf.diseasePenalty
              || 0
            )
          )
        : 0;

    const effectPenalty =
      useEffectPenalty
        ? this._computeDialogEffectPenalty()
        : 0;

    const totalSkill =
      (
        currentSkill.value
        || 0
      )
      + skillBonus;

    const skillShift =
      TestRules.skillShift(
        totalSkill
      );

    let currentStatValue =
      this.stat;

    if (
      this.isSkill
      && currentAttribute
    ) {
      currentStatValue =
        this.actor.system.attributeTotals?.[
          currentAttribute
        ]
        ?? this.stat;
    }

    const finalStat =
      currentStatValue
      + attrBonus;

    const baseDiff =
      NEUROSHIMA.difficulties[
        baseDifficulty
      ];

    const totalPenalty =
      (
        baseDiff?.min
        || 0
      )
      + modifier
      + armorPenalty
      + woundPenalty
      + diseasePenalty
      + effectPenalty;

    const penaltyDiff =
      TestRules.difficultyFromPercent(
        totalPenalty
      );

    const finalDiff = TestRules.clampMaximumDifficulty(
      TestRules.shiftDifficulty(
        penaltyDiff,
        -skillShift
          + Number(sf.finalDifficultyShift ?? 0)
      ),
      sf.maximumDifficulty
    );

    const finalTarget =
      finalStat
      + (
        finalDiff.mod
        || 0
      );

    const totalElement =
      html.querySelector(
        ".total-modifier"
      );

    if (totalElement) {
      totalElement.textContent =
        `${totalPenalty}%`;
    }

    const difficultyElement =
      html.querySelector(
        ".final-difficulty"
      );

    if (difficultyElement) {
      difficultyElement.textContent =
        game.i18n.localize(
          finalDiff.label
        );
    }

    const targetElement =
      html.querySelector(
        ".final-target"
      );

    if (targetElement) {
      targetElement.textContent =
        finalTarget;
    }
  }

  async _onRoll(event, target) {
    if (this._rollSubmitted) return null;
    this._rollSubmitted = true;

    try {
      return await this._submitRoll();
    } catch (error) {
      try {
        await this._onErrorCallback?.(error);
      } finally {
        await this.close();
      }
      throw error;
    }
  }

  async _submitRoll() {
    const sf =
      this._scriptFields || {};

    const uv =
      this._userValues || {};

    const userModifier =
      uv.modifier
      ?? 0;

    const userAttrBonus =
      uv.attributeBonus
      ?? 0;

    const userSkillBonus =
      uv.skillBonus
      ?? 0;

    const combinedModifier =
      userModifier
      + (
        sf.modifier
        || 0
      );

    const combinedAttrBonus =
      userAttrBonus
      + (
        sf.attributeBonus
        || 0
      );

    const combinedSkillBonus =
      userSkillBonus
      + (
        sf.skillBonus
        || 0
      );

    let baseDiffKey =
      (
        sf.difficulty
        && this.userEntry.baseDifficulty === undefined
      )
        ? sf.difficulty
        : (
            this.userEntry.baseDifficulty
            ?? this.rollOptions.baseDifficulty
            ?? "average"
          );

    if (sf.difficultyShift) {
      baseDiffKey =
        NeuroshimaScriptRunner.shiftDifficultyKey(
          baseDiffKey,
          sf.difficultyShift
        );
    }

    const isOpen =
      this.userEntry.isOpen
      ?? this.rollOptions.isOpen
      ?? true;

    const useArmor =
      this.userEntry.useArmorPenalty
      ?? this.rollOptions.useArmorPenalty
      ?? true;

    const useWound =
      this.userEntry.useWoundPenalty
      ?? this.rollOptions.useWoundPenalty
      ?? true;

    const useDisease =
      this.userEntry.useDiseasePenalty
      ?? this.rollOptions.useDiseasePenalty
      ?? true;

    const useEffects =
      this.userEntry.useEffectPenalty
      ?? this.rollOptions.useEffectPenalty
      ?? true;

    const rollMode =
      this.userEntry.rollMode
      ?? this.rollOptions.rollMode;

    const currentAttribute =
      this._resolveEffectiveAttributeKey(sf);
    const currentSkill =
      this._resolveEffectiveSkill(sf);

    const actorArmorPenalty =
      this.actor.system.combat?.totalArmorPenalty
      || 0;

    const actorWoundPenalty =
      this.actor.system.combat?.totalWoundPenalty
      || 0;

    const actorDiseasePenalty =
      this._computeActorDiseasePenalty();

    const armorPenalty =
      useArmor
        ? (
            actorArmorPenalty
            + (
              sf.armorDelta
              || 0
            )
          )
        : 0;

    const woundPenalty =
      useWound
        ? (
            actorWoundPenalty
            + (
              sf.woundDelta
              || 0
            )
          )
        : 0;

    const diseasePenalty =
      useDisease
        ? (
            actorDiseasePenalty
            + (
              sf.diseasePenalty
              || 0
            )
          )
        : 0;

    const effectPenalty =
      useEffects
        ? this._computeDialogEffectPenalty()
        : 0;

    const submissionOptions = {};
    if (this.testType) submissionOptions.rollType = this.testType;
    if (this.testSubtype) submissionOptions.subtype = this.testSubtype;

    for (
      const dialogModifier
      of this._dialogModifiers
    ) {
      if (
        !dialogModifier.activated
        || !dialogModifier._script?.submissionScript
      ) {
        continue;
      }

      await dialogModifier._script.runSubmission({
        actor: this.actor,
        item: this.item ?? null,
        options: submissionOptions,
        fields: sf,
        flags: this._scriptFlags
      });
    }

    let finalStat =
      this.stat;

    if (
      this.isSkill
      && currentAttribute
    ) {
      finalStat =
        this.actor.system.attributeTotals?.[
          currentAttribute
        ]
        ?? this.stat;
    }

    // Closing a submitted dialog is not cancellation. The prompt remains
    // pending until onRoll receives the completed result (or onError rejects).
    await this.close();

    await this.actor.update({
      "system.lastRoll": {
        modifier:
          userModifier,

        baseDifficulty:
          baseDiffKey,

        useArmorPenalty:
          useArmor,

        useWoundPenalty:
          useWound,

        useDiseasePenalty:
          useDisease,

        useEffectPenalty:
          useEffects,

        isOpen:
          isOpen === true
          || isOpen === "true",

        rollMode
      }
    });

    const TestClass = currentSkill.key ? SkillTest : AttributeTest;
    const test = this.actor._setupTest(TestClass, {
      attribute: { key: currentAttribute || null, value: finalStat },
      skill: { key: currentSkill.key || null, value: Number(currentSkill.value ?? 0) },
      preData: {
        label: this.label,
        skillBonus: combinedSkillBonus,
        attributeBonus: combinedAttrBonus,
        finalDifficultyShift: Number(sf.finalDifficultyShift ?? 0),
        maximumDifficulty: sf.maximumDifficulty || null,
        annotations: [...(sf.annotations || [])],
        dieManualBonus: (Number(this.userEntry.dieManualBonus ?? 0) || 0) + (sf.dieManualBonus || 0),
        dieReductionBonus: (Number(this.userEntry.dieReductionBonus ?? 0) || 0) + (sf.dieReductionBonus || 0),
        penalties: {
          mod: combinedModifier,
          base: NEUROSHIMA.difficulties[baseDiffKey]?.min || 0,
          armor: armorPenalty,
          wounds: woundPenalty,
          disease: diseasePenalty,
          effects: effectPenalty
        }
      },
      context: {
        isOpen: isOpen === true || isOpen === "true",
        rollMode,
        options: submissionOptions,
        eventArgs: submissionOptions
      }
    });
    if (sf.autoSuccess === true) {
      test.forceSuccess({ mode: "keepRoll" });
    }
    await test.roll();

    const successPoints = Number(test.result.successPoints ?? 0);
    const payload = {
      cancelled: false,
      success: test.result.success === true,
      isSuccess: test.result.success === true,
      successPoints,
      // One-release compatibility for consumers of the old callback key.
      successes: successPoints,
      test,
      result: test.result
    };

    if (this.resultCallback) {
      await this.resultCallback(payload);
    }
    if (this._onRollCallback) {
      await this._onRollCallback(payload);
    }
    return test.result;
  }

  _onCancel(event, target) {
    this.close();
  }
}
