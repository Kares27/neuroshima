const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Application V2 for configuring combat-related settings.
 */
export class CombatConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
        id: "combat-config",
        tag: "form",
        classes: ["neuroshima", "combat-config"],
        window: {
            title: "NEUROSHIMA.Settings.CombatConfig.Title",
            resizable: true
        },
        position: {
            width: 450,
            height: "auto"
        },
        form: {
            handler: CombatConfig.#onSubmit,
            submitOnChange: false,
            closeOnSubmit: true
        }
    };

    /** @inheritdoc */
    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/combat-config.hbs"
        }
    };

    /** @inheritdoc */
    async _prepareContext(options) {
        return {
            config: {
                usePelletCountLimit: game.settings.get("neuroshima", "usePelletCountLimit"),
                damageApplicationMinRole: game.settings.get("neuroshima", "damageApplicationMinRole"),
                painResistanceMinRole: game.settings.get("neuroshima", "painResistanceMinRole"),
                combatActionsMinRole: game.settings.get("neuroshima", "combatActionsMinRole")
            },
            roles: {
                0: "NEUROSHIMA.Settings.Roles.None",
                1: "NEUROSHIMA.Settings.Roles.Player",
                2: "NEUROSHIMA.Settings.Roles.Trusted",
                3: "NEUROSHIMA.Settings.Roles.Assistant",
                4: "NEUROSHIMA.Settings.Roles.Gamemaster"
            }
        };
    }

    /**
     * Handle form submission.
     * @param {Event} event 
     * @param {HTMLFormElement} form 
     * @param {FormDataExtended} formData 
     */
    static async #onSubmit(event, form, formData) {
        const data = formData.object;
        
        try {
            const updates = [
                game.settings.set("neuroshima", "usePelletCountLimit", !!data.usePelletCountLimit),
                game.settings.set("neuroshima", "damageApplicationMinRole", Number(data.damageApplicationMinRole)),
                game.settings.set("neuroshima", "painResistanceMinRole", Number(data.painResistanceMinRole)),
                game.settings.set("neuroshima", "combatActionsMinRole", Number(data.combatActionsMinRole))
            ];
            
            await Promise.all(updates);
            
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.CombatConfig.Saved"));
            
            // Reload if pellet count limit changed as it requires reload
            if (game.settings.get("neuroshima", "usePelletCountLimit") !== !!data.usePelletCountLimit) {
                SettingsConfig.reloadConfirm({ world: true });
            }
        } catch (err) {
            console.error("Neuroshima | Błąd zapisu ustawień walki:", err);
            ui.notifications.error("Wystąpił błąd podczas zapisu ustawień.");
        }
    }
}
