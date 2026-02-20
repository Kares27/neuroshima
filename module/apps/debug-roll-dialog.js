const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { NeuroshimaDice } from "../helpers/dice.js";

/**
 * Dialog for testing roll logic with manual parameters and dice results.
 */
export class DebugRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "debug-roll-dialog",
        tag: "form",
        classes: ["neuroshima", "debug-roll-dialog"],
        window: {
            title: "NEUROSHIMA | Debug Roll Tool",
            resizable: false
        },
        position: {
            width: 400,
            height: "auto"
        },
        form: {
            handler: DebugRollDialog.#onSubmit,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/debug-roll-dialog.hbs"
        }
    };

    /** @override */
    async _prepareContext(options) {
        return {};
    }

    /**
     * Handle form submission and trigger the roll.
     */
    static async #onSubmit(event, form, formData) {
        const data = formData.object;
        
        // Handle partial fixed dice (fill missing with random)
        const diceKeys = ["d1", "d2", "d3"];
        const fixedDice = await Promise.all(diceKeys.map(async key => {
            if (data[key] !== null && data[key] !== "") return Number(data[key]);
            const r = new Roll("1d20");
            await r.evaluate();
            return r.total;
        }));

        await NeuroshimaDice.rollTest({
            stat: Number(data.stat),
            skill: Number(data.skill),
            penalties: {
                mod: Number(data.penalty),
                wounds: 0,
                armor: 0
            },
            isOpen: !!data.isOpen,
            isCombat: !!data.isCombat,
            isDebug: true,
            fixedDice: fixedDice,
            label: "DEBUG ROLL"
        });
    }
}