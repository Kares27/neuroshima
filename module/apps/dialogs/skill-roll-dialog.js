import { NEUROSHIMA } from "../../config.js";
import { NeuroshimaScriptRunner } from "../neuroshima-script-engine.js";
import { NeuroshimaDice } from "../../helpers/dice.js";
import { NeuroshimaRollDialogBase } from "./roll-dialog-base.js";

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

    this.resultCallback =
      options.resultCallback
      ?? null;
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
     * Ten obiekt jest przekazywany do skryptu jako:
     *
     * args.attribute
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
                useDiseasePenalty ? actorDiseasePenalty + (sf.diseasePenalty || 0) : 0
              ],
              skillShift: NeuroshimaDice.getSkillShift(totalSkill)
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
      skill: skillBreakdown
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

    /*
     * ZMIANA:
     *
     * Podgląd celu używa teraz tego samego
     * Współczynnika co select w dialogu.
     */
    const currentAttribute =
      this._resolveEffectiveAttributeKey(sf);

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

    const totalSkill =
      (
        this.skill
        || 0
      )
      + skillBonus;

    const skillShift =
      NeuroshimaDice.getSkillShift(
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
      + diseasePenalty;

    const penaltyDiff =
      NeuroshimaDice.getDifficultyFromPercent(
        totalPenalty
      );

    const finalDiff = NeuroshimaDice.clampMaximumDifficulty(
      NeuroshimaDice._getShiftedDifficulty(
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

    const rollMode =
      this.userEntry.rollMode
      ?? this.rollOptions.rollMode;

    const currentAttribute =
      this._resolveEffectiveAttributeKey(sf);

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

    const submissionOptions = {
      skipPreRollTest: true
    };

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
        options: submissionOptions,
        fields: sf
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

        isOpen:
          isOpen === true
          || isOpen === "true",

        rollMode
      }
    });

    this.close();

    NeuroshimaDice.rollTest({
      stat: finalStat,
      skill: this.skill,
      penalties: {
        mod:combinedModifier,
        base: NEUROSHIMA.difficulties[ baseDiffKey]?.min || 0,
        armor:armorPenalty,
        wounds:woundPenalty,
        disease:diseasePenalty
      },

      isOpen:
        isOpen === true
        || isOpen === "true",

      label:
        this.label,

      actor:
        this.actor,

      skillBonus:
        combinedSkillBonus,

      attributeBonus:
        combinedAttrBonus,

      finalDifficultyShift:
        Number(sf.finalDifficultyShift ?? 0),

      maximumDifficulty:
        sf.maximumDifficulty || null,

      autoSuccess:
        sf.autoSuccess === true,

      annotations:
        sf.annotations || [],

      skillKey:
        this.skillKey
        || null,

      /*
       * Do właściwego rzutu trafia również
       * prawdziwy klucz użytego Współczynnika.
       */
      attributeKey:
        currentAttribute
        || null,

      rollMode,

      dieManualBonus:
        (
          Number(
            this.userEntry.dieManualBonus
            ?? 0
          )
          || 0
        )
        + (
          sf.dieManualBonus
          || 0
        ),

      dieReductionBonus:
        (
          Number(
            this.userEntry.dieReductionBonus
            ?? 0
          )
          || 0
        )
        + (
          sf.dieReductionBonus
          || 0
        ),

      options:
        submissionOptions,

      resultCallback:
        this.resultCallback
        ?? null
    });
  }

  _onCancel(event, target) {
    this.close();
  }
}
