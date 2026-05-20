import { NEUROSHIMA } from "../config.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * PHASE 3 - SETTINGS & CONFIGURATION SYSTEM
 * Application V2 for configuring healing-related settings using Foundry V13 API
 * Allows configuration of:
 * - Default healing test difficulties for each damage type (D/L/C/K)
 * - Patient card version (simple/extended)
 * 
 * Default difficulty values:
 * - Grazes and light wounds: Average
 * - Heavy and critical wounds: Problematic
 */
export class HealingConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
        id: "healing-config",
        tag: "form",
        classes: ["neuroshima", "healing-config"],
        window: {
            title: "NEUROSHIMA.Settings.HealingConfig.Title",
            resizable: true
        },
        position: {
            width: 500,
            height: "auto"
        },
        form: {
            handler: async function(event, form, formData) {
                await this._onSubmit(event, form, formData);
            },
            submitOnChange: false,
            closeOnSubmit: true
        }
    };

    /** @inheritdoc */
    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/healing-config.hbs"
        }
    };

    /** @inheritdoc */
    async _prepareContext(options) {
        const healingDifficulties = game.settings.get("neuroshima", "healingDifficulties") ?? {
            D: "average",
            L: "average",
            C: "problematic",
            K: "problematic"
        };
        
        const patientCardVersion = game.settings.get("neuroshima", "patientCardVersion");
        
        const difficultyOptions = Object.entries(NEUROSHIMA.difficulties).reduce((acc, [key, data]) => {
            acc[key] = game.i18n.localize(data.label);
            return acc;
        }, {});

        const patientCardOptions = {
            "simple": game.i18n.localize("NEUROSHIMA.Settings.PatientCardVersion.Simple"),
            "extended": game.i18n.localize("NEUROSHIMA.Settings.PatientCardVersion.Extended")
        };

        return {
            config: {
                healingDifficulties: healingDifficulties,
                patientCardVersion: patientCardVersion
            },
            damageTypes: [
                { key: "D", label: game.i18n.localize("NEUROSHIMA.Damage.Full.D"), abbr: "D" },
                { key: "L", label: game.i18n.localize("NEUROSHIMA.Damage.Full.L"), abbr: "L" },
                { key: "C", label: game.i18n.localize("NEUROSHIMA.Damage.Full.C"), abbr: "C" },
                { key: "K", label: game.i18n.localize("NEUROSHIMA.Damage.Full.K"), abbr: "K" }
            ],
            difficultyOptions: difficultyOptions,
            patientCardOptions: patientCardOptions
        };
    }

    /**
     * Handle form submission - saves healing settings
     * @param {Event} event 
     * @param {HTMLFormElement} form 
     * @param {FormDataExtended} formData 
     */
    async _onSubmit(event, form, formData) {
        const data = formData.object;
        
        game.neuroshima.log("Attempting to save healing settings:", data);
        game.neuroshima.log("Is GM:", game.user.isGM);
        
        try {
            const healingDifficulties = {
                "D": String(data["difficulty-D"] || "average"),
                "L": String(data["difficulty-L"] || "average"),
                "C": String(data["difficulty-C"] || "problematic"),
                "K": String(data["difficulty-K"] || "problematic")
            };
            
            const patientCardVersion = String(data.patientCardVersion || "simple");
            
            game.neuroshima.log("Settings to save:", {
                healingDifficulties,
                patientCardVersion
            });
            
            const updates = [
                game.settings.set("neuroshima", "healingDifficulties", healingDifficulties),
                game.settings.set("neuroshima", "patientCardVersion", patientCardVersion)
            ];
            
            await Promise.all(updates);
            
            const readback = game.settings.get("neuroshima", "healingDifficulties");
            game.neuroshima.log("Readback healingDifficulties:", readback);
            game.neuroshima.log("Healing settings saved successfully");
            
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.HealingConfig.Saved"));
        } catch (err) {
            game.neuroshima.error("Error saving healing settings:", err);
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.Notifications.SettingsSaveError") + ": " + err.message);
        }
    }
}
