import { NEUROSHIMA } from "../../config.js";
import { ReputationTest, SkillTest, TestRules } from "../../tests.mjs";
import { NeuroshimaScriptRunner } from "../neuroshima-script-engine.js";
import { NeuroshimaRollDialogBase } from "./roll-dialog-base.js";

/**
 * Reputation roll dialog using the same WFRP-style modifier pipeline and
 * presentation as the standard attribute dialog.
 */
export class ReputationRollDialog extends NeuroshimaRollDialogBase {
  constructor(options = {}) {
    super(options);
    this.reputationItem = options.reputationItem ?? null;

    const testMode = game.settings.get("neuroshima", "reputationTestMode") ?? "skill";
    const fame = Number(this.actor?.system?.fame ?? 0) + Number(this.actor?.system?.fameBonus ?? 0);
    const reputationBonus = Number(this.actor?.system?.reputationBonus ?? 0);
    const baseRepValue = Number(this.reputationItem?.system?.value ?? 0);

    this.rollOptions = {
      testMode,
      isOpen: false,
      baseDifficulty: "average",
      modifier: 0,
      repBonus: 0,
      fame,
      repValue: baseRepValue + reputationBonus,
      rollMode: game.settings.get("core", "rollMode")
    };
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: [
      "neuroshima",
      "dialog",
      "standard-form",
      "roll-dialog-window",
      "roll-dialog",
      "reputation-roll-dialog"
    ],
    position: { width: 520, height: "auto" },
    window: {
      resizable: false,
      minimizable: false
    },
    actions: {
      roll: ReputationRollDialog.prototype._onRoll,
      cancel: ReputationRollDialog.prototype._onCancel
    }
  };

  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/dialog/reputation-roll-dialog.hbs"
    }
  };

  get title() {
    const actorName = this.actor?.name ?? "";
    const repName = this.reputationItem?.name
      ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");
    return `${game.i18n.localize("NEUROSHIMA.Reputation.Roll")}: ${repName} (${actorName})`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const testMode = this.rollOptions.testMode;
    const userModifier = Number(this.userEntry.modifier ?? this.rollOptions.modifier ?? 0);
    const userRepBonus = Number(this.userEntry.repBonus ?? this.rollOptions.repBonus ?? 0);
    const baseDifficulty = this.userEntry.baseDifficulty
      ?? this.rollOptions.baseDifficulty
      ?? "average";
    const isOpenRaw = this.userEntry.isOpen ?? this.rollOptions.isOpen ?? false;
    const isOpen = isOpenRaw === true || isOpenRaw === "true";
    const rollMode = this.userEntry.rollMode ?? this.rollOptions.rollMode;
    const repValue = Number(this.rollOptions.repValue ?? 0);
    const fame = Number(this.rollOptions.fame ?? 0);
    const label = this.reputationItem?.name
      ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");
    const targetActors = Array.from(game.user.targets || [])
      .map(token => token.actor)
      .filter(Boolean);

    const {
      dialogModifiers,
      scriptFields,
      modBreakdown,
      attrBreakdown,
      skillBreakdown,
      reputationBreakdown,
      preRollModifiers
    } = await NeuroshimaScriptRunner.computeDialogFields(
      this.actor,
      {
        rollType: "reputation",
        subtype: testMode,
        label,
        item: this.reputationItem,
        stat: repValue + fame,
        attribute: {
          key: "reputation",
          name: label,
          value: repValue + fame
        },
        attributeKey: "reputation",
        skill: null,
        skillKey: null,
        repBonus: userRepBonus,
        repValue,
        fame,
        reputation: {
          bonus: userRepBonus,
          value: repValue,
          fame
        },
        difficulty: baseDifficulty
      },
      this.selectedModifierIds,
      this.unselectedModifierIds,
      targetActors,
      {
        scriptFlags: this._scriptFlags,
        resolveFinalContext: ({ scriptFields: fields }) => {
          const effectiveDifficulty = (
            fields.difficulty
            && this.userEntry.baseDifficulty === undefined
          ) ? fields.difficulty : baseDifficulty;
          return {
            finalDifficulty: NeuroshimaScriptRunner.resolveFinalDifficultyKey({
              difficulty: effectiveDifficulty,
              difficultyShift: Number(fields.difficultyShift ?? 0),
              finalDifficultyShift: Number(fields.finalDifficultyShift ?? 0),
              penalties: [userModifier + Number(fields.modifier ?? 0)],
              skillShift: TestRules.skillShift(0)
            })
          };
        }
      }
    );

    this._dialogModifiers = dialogModifiers;
    this._scriptFields = scriptFields;
    this._preRollModifiers = preRollModifiers ?? [];
    this._breakdown = {
      mod: modBreakdown,
      attr: [
        ...attrBreakdown,
        ...(reputationBreakdown?.repBonus ?? [])
      ],
      skill: skillBreakdown
    };
    this._reputationBreakdown = reputationBreakdown ?? {
      repBonus: [],
      repValue: [],
      fame: []
    };
    this._userValues = {
      modifier: userModifier,
      attributeBonus: userRepBonus,
      skillBonus: 0
    };

    let effectiveDifficulty = (
      scriptFields.difficulty
      && this.userEntry.baseDifficulty === undefined
    ) ? scriptFields.difficulty : baseDifficulty;
    if (scriptFields.difficultyShift) {
      effectiveDifficulty = NeuroshimaScriptRunner.shiftDifficultyKey(
        effectiveDifficulty,
        scriptFields.difficultyShift
      );
    }

    Object.assign(context, {
      actor: this.actor,
      reputationItem: this.reputationItem,
      testMode,
      isSkillMode: testMode === "skill",
      isSimpleMode: testMode === "simple",
      difficulties: NEUROSHIMA.difficulties,
      baseDifficulty: effectiveDifficulty,
      isOpen,
      modifier: userModifier + Number(scriptFields.modifier ?? 0),
      repBonus: userRepBonus
        + Number(scriptFields.attributeBonus ?? 0)
        + Number(scriptFields.repBonus ?? 0),
      fame: fame + Number(scriptFields.fame ?? 0),
      repValue: repValue + Number(scriptFields.repValue ?? 0),
      rollMode,
      rollModes: CONFIG.Dice.rollModes,
      dialogModifiers
    });
    return context;
  }

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    const html = this.element;

    this._applyTooltips(html);
    const repBonusInput = html.querySelector('[name="repBonus"]');
    const repTooltip = this._buildTooltip(
      this._userValues.attributeBonus,
      Number(this._scriptFields.attributeBonus ?? 0)
        + Number(this._scriptFields.repBonus ?? 0),
      this._breakdown.attr
    );
    if (repBonusInput && repTooltip) {
      repBonusInput.dataset.tooltipHtml = repTooltip;
      delete repBonusInput.dataset.tooltip;
    }
    const applyPreparedTooltip = (selector, base, delta, breakdown) => {
      const input = html.querySelector(selector);
      const tooltip = this._buildTooltip(base, delta, breakdown);
      if (input && tooltip) {
        input.dataset.tooltipHtml = tooltip;
        delete input.dataset.tooltip;
      }
    };
    applyPreparedTooltip(
      '[data-reputation-field="value"]',
      this.rollOptions.repValue,
      this._scriptFields.repValue,
      this._reputationBreakdown.repValue
    );
    applyPreparedTooltip(
      '[data-reputation-field="fame"]',
      this.rollOptions.fame,
      this._scriptFields.fame,
      this._reputationBreakdown.fame
    );

    this._updateSummary(html);

    html.querySelectorAll('[data-action="clickModifier"].dm-toggleable').forEach(element => {
      element.addEventListener("click", () => {
        const effectId = element.dataset.dmEffectId;
        if (!effectId) return;
        if (element.classList.contains("dm-active")) {
          this.selectedModifierIds.delete(effectId);
          this.unselectedModifierIds.add(effectId);
        } else {
          this.unselectedModifierIds.delete(effectId);
          this.selectedModifierIds.add(effectId);
        }
        this.render();
      });
    });

    html.querySelectorAll("input, select").forEach(element => {
      element.addEventListener("change", event => this._onFieldChange(event));
    });
  }

  _resolveValues() {
    const fields = this._scriptFields ?? {};
    const userModifier = Number(this._userValues.modifier ?? 0);
    const userRepBonus = Number(this._userValues.attributeBonus ?? 0);
    let baseDifficulty = (
      fields.difficulty
      && this.userEntry.baseDifficulty === undefined
    ) ? fields.difficulty : (
      this.userEntry.baseDifficulty
      ?? this.rollOptions.baseDifficulty
      ?? "average"
    );
    if (fields.difficultyShift) {
      baseDifficulty = NeuroshimaScriptRunner.shiftDifficultyKey(
        baseDifficulty,
        fields.difficultyShift
      );
    }
    const isOpenRaw = this.userEntry.isOpen ?? this.rollOptions.isOpen ?? false;
    return {
      fields,
      modifier: userModifier + Number(fields.modifier ?? 0),
      repBonus: userRepBonus
        + Number(fields.attributeBonus ?? 0)
        + Number(fields.repBonus ?? 0),
      baseDifficulty,
      isOpen: isOpenRaw === true || isOpenRaw === "true",
      rollMode: this.userEntry.rollMode ?? this.rollOptions.rollMode,
      repValue: Number(this.rollOptions.repValue ?? 0) + Number(fields.repValue ?? 0),
      fame: Number(this.rollOptions.fame ?? 0) + Number(fields.fame ?? 0)
    };
  }

  _updateSummary(html = this.element) {
    const values = this._resolveValues();
    const basePenalty = Number(
      NEUROSHIMA.difficulties[values.baseDifficulty]?.min ?? 0
    );
    const totalPenalty = basePenalty + values.modifier;
    const penaltyDifficulty = TestRules.difficultyFromPercent(totalPenalty);
    const finalDifficulty = TestRules.clampMaximumDifficulty(
      TestRules.shiftDifficulty(
        penaltyDifficulty,
        -TestRules.skillShift(0)
          + Number(values.fields.finalDifficultyShift ?? 0)
      ),
      values.fields.maximumDifficulty
    );
    const simpleTarget = Math.max(
      0,
      values.repValue + values.fame + values.repBonus - values.modifier
    );
    const finalTarget = this.rollOptions.testMode === "simple"
      ? simpleTarget
      : values.repValue + values.fame + values.repBonus + Number(finalDifficulty.mod ?? 0);

    const modifierElement = html.querySelector(".rep-total-modifier");
    if (modifierElement) modifierElement.textContent = `${totalPenalty}%`;
    const difficultyElement = html.querySelector(".rep-final-difficulty");
    if (difficultyElement) {
      difficultyElement.textContent = game.i18n.localize(finalDifficulty.label);
    }
    const targetElement = html.querySelector(".rep-final-target");
    if (targetElement) targetElement.textContent = finalTarget;
  }

  async _onRoll(event) {
    event.preventDefault();
    const values = this._resolveValues();
    const submissionOptions = {
      rollType: "reputation",
      subtype: this.rollOptions.testMode
    };
    await this._runSubmissionScripts(this.reputationItem, submissionOptions);
    await this.close();

    if (this.rollOptions.testMode === "simple") {
      return this._performSimpleRoll(values, submissionOptions);
    }
    return this._performSkillRoll(values, submissionOptions);
  }

  async _performSimpleRoll(values, submissionOptions) {
    const threshold = Math.max(
      0,
      values.repValue + values.fame + values.repBonus - values.modifier
    );
    const label = this.reputationItem?.name
      ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");
    const test = new ReputationTest({
      subtype: "simple",
      actor: this.actor,
      item: this.reputationItem,
      attribute: { key: "reputation", value: threshold, name: label },
      preData: {
        label,
        annotations: [...(values.fields.annotations ?? [])]
      },
      context: {
        rollMode: values.rollMode,
        options: submissionOptions,
        eventArgs: submissionOptions
      }
    }, this.actor);
    if (values.fields.autoSuccess === true) {
      test.forceSuccess({ mode: "keepRoll" });
    }
    await test.roll();
    return test.result;
  }

  async _performSkillRoll(values, submissionOptions) {
    const label = this.reputationItem?.name
      ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");
    const test = new SkillTest({
      subtype: "reputation",
      actor: this.actor,
      item: this.reputationItem,
      attribute: {
        key: "reputation",
        value: values.repValue + values.fame
      },
      skill: { key: null, value: 0 },
      preData: {
        label,
        attributeBonus: values.repBonus,
        finalDifficultyShift: Number(values.fields.finalDifficultyShift ?? 0),
        maximumDifficulty: values.fields.maximumDifficulty ?? null,
        annotations: [...(values.fields.annotations ?? [])],
        dieManualBonus: Number(values.fields.dieManualBonus ?? 0),
        dieReductionBonus: Number(values.fields.dieReductionBonus ?? 0),
        penalties: {
          mod: values.modifier,
          base: Number(NEUROSHIMA.difficulties[values.baseDifficulty]?.min ?? 0),
          armor: 0,
          wounds: 0
        }
      },
      context: {
        isOpen: values.isOpen,
        rollMode: values.rollMode,
        options: submissionOptions,
        eventArgs: submissionOptions
      }
    }, this.actor);
    if (values.fields.autoSuccess === true) {
      test.forceSuccess({ mode: "keepRoll" });
    }
    await test.roll({ sendToChat: false });
    Object.assign(test.result, {
      isReputationRoll: true,
      repRepValue: values.repValue,
      repFame: values.fame,
      repBonus: values.repBonus
    });
    await test.sendToChat();
    return test.result;
  }

  _onCancel() {
    return this.close();
  }
}
