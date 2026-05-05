import { NEUROSHIMA } from "../config.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Dialog for rolling reputation checks.
 * Supports two modes:
 *   "skill" — threshold = reputation value + fame, standard open/closed test with difficulty
 *   "simple" — roll 1d100, success if result ≤ reputation value
 */
export class ReputationRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        this.actor = options.actor;
        this.reputationItem = options.reputationItem ?? null;

        const testMode = game.settings.get("neuroshima", "reputationTestMode") ?? "skill";
        const fame = this.actor?.system?.fame ?? 0;
        const repValue = this.reputationItem?.system?.value ?? 0;

        this.rollOptions = {
            testMode,
            isOpen: false,
            difficulty: "average",
            modifier: 0,
            useArmorPenalty: false,
            useWoundPenalty: true,
            fame,
            repValue,
            rollMode: game.settings.get("core", "rollMode")
        };
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["neuroshima", "dialog", "standard-form", "roll-dialog-window", "reputation-roll-dialog"],
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

        const armorPenalty = this.actor?.system?.combat?.totalArmorPenalty ?? 0;
        const woundPenalty = this.actor?.system?.combat?.totalWoundPenalty ?? 0;

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
        context.useArmorPenalty = this.rollOptions.useArmorPenalty;
        context.useWoundPenalty = this.rollOptions.useWoundPenalty;
        context.armorPenalty = armorPenalty;
        context.woundPenalty = woundPenalty;
        context.fame = this.rollOptions.fame;
        context.repValue = this.rollOptions.repValue;
        context.rollMode = this.rollOptions.rollMode;
        context.rollModes = CONFIG.Dice.rollModes;

        if (testMode === "skill") {
            const threshold = this.rollOptions.repValue + this.rollOptions.fame;
            context.threshold = threshold;
        }

        return context;
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
        const difficulty = data.difficulty ?? "average";
        const isOpen = data.isOpen === "true" || data.isOpen === true;
        const useArmorPenalty = !!data.useArmorPenalty;
        const useWoundPenalty = !!data.useWoundPenalty;

        const armorPenalty = useArmorPenalty ? (this.actor?.system?.combat?.totalArmorPenalty ?? 0) : 0;
        const woundPenalty = useWoundPenalty ? (this.actor?.system?.combat?.totalWoundPenalty ?? 0) : 0;

        const label = this.reputationItem?.name ?? game.i18n.localize("NEUROSHIMA.Reputation.Title");

        await game.neuroshima.NeuroshimaDice.rollTest({
            stat: repValue,
            skill: fame,
            penalties: {
                mod: modifier,
                base: NEUROSHIMA.difficulties[difficulty]?.min ?? 0,
                armor: armorPenalty,
                wounds: woundPenalty
            },
            isOpen,
            label,
            actor: this.actor,
            attributeBonus: 0,
            skillBonus: 0,
            rollMode,
            chatMessage: true
        });
    }

    async _onCancel(event, target) {
        return this.close();
    }
}
