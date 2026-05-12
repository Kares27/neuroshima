import { NEUROSHIMA } from "../config.js";

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
        const NeuroshimaDice = game.neuroshima?.NeuroshimaDice;
        if (!NeuroshimaDice) return;

        const repValue = this.rollOptions.repValue;
        const fame = this.rollOptions.fame;

        const updateSummary = () => {
            const difficultyKey = el.querySelector('[name="difficulty"]')?.value ?? "average";
            const modifier = parseInt(el.querySelector('[name="modifier"]')?.value) || 0;
            const repBonus = parseInt(el.querySelector('[name="repBonus"]')?.value) || 0;

            const combinedStat = repValue + fame + repBonus;
            const baseDiff = NEUROSHIMA.difficulties[difficultyKey];
            const totalPenalty = (baseDiff?.min || 0) + modifier;

            const finalDiff = NeuroshimaDice.getDifficultyFromPercent(totalPenalty);
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

        const roll = new Roll("1d100");
        await roll.evaluate();
        const result = roll.total;
        const isSuccess = result <= threshold;

        const label = this.reputationItem?.name ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");
        const speaker = ChatMessage.getSpeaker({ actor: this.actor });

        const successText = isSuccess
            ? `<span class="roll-success">${game.i18n.localize("NEUROSHIMA.Roll.Success")}</span>`
            : `<span class="roll-failure">${game.i18n.localize("NEUROSHIMA.Roll.Failure")}</span>`;

        const content = `
<div class="neuroshima roll-result reputation-roll-result">
    <div class="roll-card-header">
        <img src="${this.actor?.img ?? ""}" class="roll-actor-img" title="${this.actor?.name ?? ""}"/>
        <div class="header-details">
            <h3>${label}</h3>
            <div class="roll-mode-info">${game.i18n.localize("NEUROSHIMA.Reputation.SimpleRoll")}</div>
        </div>
    </div>
    <div class="roll-outcome">
        <div class="roll-dice-result">${result}</div>
        <div class="roll-threshold">${game.i18n.localize("NEUROSHIMA.Roll.Target")}: ${threshold} (${game.i18n.localize("NEUROSHIMA.Reputation.Value")}: ${repValue} + ${game.i18n.localize("NEUROSHIMA.Reputation.Fame")}: ${fame})</div>
        <div class="roll-status">${successText}</div>
    </div>
</div>`;

        await ChatMessage.create({
            content,
            speaker,
            rolls: [roll],
            rollMode,
            type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5
        });
    }

    async _performSkillRoll(data, rollMode) {
        const repValue = this.rollOptions.repValue;
        const fame = this.rollOptions.fame;
        const modifier = parseInt(data.modifier) || 0;
        const repBonus = parseInt(data.repBonus) || 0;
        const difficulty = data.difficulty ?? "average";
        const isOpen = data.isOpen === "true" || data.isOpen === true;

        const label = this.reputationItem?.name ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");

        const result = await game.neuroshima.NeuroshimaDice.rollTest({
            stat: repValue + fame + repBonus,
            skill: 0,
            penalties: {
                mod: modifier,
                base: NEUROSHIMA.difficulties[difficulty]?.min ?? 0,
                armor: 0,
                wounds: 0
            },
            isOpen,
            label,
            actor: this.actor,
            attributeBonus: 0,
            skillBonus: 0,
            rollMode,
            chatMessage: false
        });

        if (!result) return;

        result.isReputationRoll = true;
        result.repRepValue = repValue;
        result.repFame = fame;
        result.repBonus = repBonus;

        const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
        await NeuroshimaChatMessage.renderRoll(result, this.actor, result.roll);
    }

    async _onCancel(event, target) {
        return this.close();
    }
}
