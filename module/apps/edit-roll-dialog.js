const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { NeuroshimaDice } from "../helpers/dice.js";

/**
 * Dialog for editing an existing roll's properties (e.g. switching between Open and Closed test).
 */
export class EditRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(message, options={}) {
        super(options);
        this.message = message;
    }

    static DEFAULT_OPTIONS = {
        id: "edit-roll-dialog",
        tag: "form",
        classes: ["neuroshima", "edit-roll-dialog"],
        window: {
            title: "NEUROSHIMA | Edit Roll",
            resizable: false
        },
        position: {
            width: 350,
            height: "auto"
        },
        form: {
            handler: EditRollDialog.#onSubmit,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/edit-roll-dialog.hbs"
        }
    };

    /** @override */
    async _prepareContext(options) {
        const flags = this.message.getFlag("neuroshima", "rollData");
        return {
            rollData: flags
        };
    }

    /**
     * Handle form submission and update the message.
     */
    static async #onSubmit(event, form, formData) {
        const data = formData.object;
        const message = this.message;
        const isOpen = data.isOpen === "true";
        
        await NeuroshimaDice.updateRollMessage(message, isOpen);
    }
}
