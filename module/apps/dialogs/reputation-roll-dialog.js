import { NEUROSHIMA } from "../../config.js";
import { ReputationTest, SkillTest, TestRules } from "../../tests.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Dialog for rolling reputation checks.
 * Supports two modes:
 *   "skill" — pure attribute test: threshold = repValue + fame + repBonus + diffMod (no skill shift)
 *   "simple" — roll 1d100, success if result ≤ reputation value + fame
 */
export class ReputationRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        this.actor = options.actor;
        this.reputationItem = options.reputationItem ?? null;

        const testMode = game.settings.get("neuroshima", "reputationTestMode") ?? "skill";
        const fame = this.actor?.system?.fame ?? 0;
        const fameBonus = this.actor?.system?.fameBonus ?? 0;
        const reputationBonus = this.actor?.system?.reputationBonus ?? 0;
        const baseRepValue = this.reputationItem?.system?.value ?? 0;

        this.rollOptions = {
            testMode,
            isOpen: false,
            difficulty: "average",
            modifier: 0,
            repBonus: 0,
            fame: fame + fameBonus,
            repValue: baseRepValue + reputationBonus,
            rollMode: game.settings.get("core", "rollMode")
        };
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["neuroshima", "dialog", "standard-form", "roll-dialog-window", "roll-dialog", "reputation-roll-dialog"],
        position: { width: 460, height: "auto" },
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
        const repName = this.reputationItem?.name ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");
        return `${game.i18n.localize("NEUROSHIMA.Reputation.Roll")}: ${repName} (${actorName})`;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const testMode = this.rollOptions.testMode;

        context.actor = this.actor;
        context.reputationItem = this.reputationItem;
        context.testMode = testMode;
        context.isSkillMode = testMode === "skill";
        context.isSimpleMode = testMode === "simple";
        context.rollOptions = this.rollOptions;
        context.difficulties = NEUROSHIMA.difficulties;
        context.currentDifficulty = this.rollOptions.difficulty;
        context.isOpen = this.rollOptions.isOpen;
        context.modifier = this.rollOptions.modifier;
        context.repBonus = this.rollOptions.repBonus;
        context.fame = this.rollOptions.fame;
        context.repValue = this.rollOptions.repValue;
        context.rollMode = this.rollOptions.rollMode;
        context.rollModes = CONFIG.Dice.rollModes;

        return context;
    }

    async _onRender(context, options) {
        await super._onRender?.(context, options);
        if (this.rollOptions.testMode !== "skill") return;

        const el = this.element;

        const repValue = this.rollOptions.repValue;
        const fame = this.rollOptions.fame;

        const updateSummary = () => {
            const difficultyKey = el.querySelector('[name="difficulty"]')?.value ?? "average";
            const modifier = parseInt(el.querySelector('[name="modifier"]')?.value) || 0;
            const repBonus = parseInt(el.querySelector('[name="repBonus"]')?.value) || 0;

            const combinedStat = repValue + fame + repBonus;
            const baseDiff = NEUROSHIMA.difficulties[difficultyKey];
            const totalPenalty = (baseDiff?.min || 0) + modifier;

            const finalDiff = TestRules.difficultyFromPercent(totalPenalty);
            const finalTarget = combinedStat + (finalDiff.mod || 0);

            el.querySelector(".rep-total-modifier")?.replaceChildren(
                document.createTextNode(`${totalPenalty}%`)
            );
            const diffLabel = el.querySelector(".rep-final-difficulty");
            if (diffLabel) diffLabel.textContent = game.i18n.localize(finalDiff.label);
            const targetEl = el.querySelector(".rep-final-target");
            if (targetEl) targetEl.textContent = finalTarget;
        };

        el.addEventListener("change", updateSummary);
        el.addEventListener("input", updateSummary);
        updateSummary();
    }

    async _onRoll(event, target) {
        event.preventDefault();
        const form = this.element.querySelector("form") ?? this.element;
        const formData = new FormDataExtended(form);
        const data = formData.object;

        const testMode = data.testMode ?? this.rollOptions.testMode;
        const rollMode = data.rollMode ?? game.settings.get("core", "rollMode");

        await this.close();

        if (testMode === "simple") {
            await this._performSimpleRoll(data, rollMode);
        } else {
            await this._performSkillRoll(data, rollMode);
        }
    }

    async _performSimpleRoll(data, rollMode) {
        const repValue = this.rollOptions.repValue;
        const fame = this.rollOptions.fame;
        const threshold = repValue + fame;

        const label = this.reputationItem?.name ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");
        const test = new ReputationTest({
            subtype: "simple",
            actor: this.actor,
            item: this.reputationItem,
            attribute: { key: "reputation", value: threshold, name: label },
            preData: {
                label,
                penalties: {},
                annotations: []
            },
            context: {
                rollMode,
                eventArgs: {}
            }
        });
        await test.roll();
    }

    async _performSkillRoll(data, rollMode) {
        const repValue = this.rollOptions.repValue;
        const fame = this.rollOptions.fame;
        const modifier = parseInt(data.modifier) || 0;
        const repBonus = parseInt(data.repBonus) || 0;
        const difficulty = data.difficulty ?? "average";
        const isOpen = data.isOpen === "true" || data.isOpen === true;

        const label = this.reputationItem?.name ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");

        const test = new SkillTest({
          subtype: "reputation",
          actor: this.actor,
          item: this.reputationItem,
          attribute: { key: "reputation", value: repValue + fame + repBonus },
          skill: { key: null, value: 0 },
          preData: {
            label,
            penalties: {
                mod: modifier,
                base: NEUROSHIMA.difficulties[difficulty]?.min ?? 0,
                armor: 0,
                wounds: 0
            }
          },
          context: { isOpen, rollMode }
        });
        await test.roll({ sendToChat: false });
        const result = test.result;
        result.isReputationRoll = true;
        result.repRepValue = repValue;
        result.repFame = fame;
        result.repBonus = repBonus;

        await test.sendToChat();
    }

    async _onCancel(event, target) {
        return this.close();
    }
}
