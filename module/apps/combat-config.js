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
            template: "systems/neuroshima/templates/apps/combat-config.hbs"
        }
    };

    /** @inheritdoc */
    async _prepareContext(options) {
        // Build role options
        const roleOptions = {
            0: game.i18n.localize("NEUROSHIMA.Settings.Roles.None"),
            1: game.i18n.localize("NEUROSHIMA.Settings.Roles.Player"),
            2: game.i18n.localize("NEUROSHIMA.Settings.Roles.Trusted"),
            3: game.i18n.localize("NEUROSHIMA.Settings.Roles.Assistant"),
            4: game.i18n.localize("NEUROSHIMA.Settings.Roles.Gamemaster")
        };

        const opposedModeOptions = {
            "sp": game.i18n.localize("NEUROSHIMA.Settings.OpposedMeleeMode.SP"),
            "dice": game.i18n.localize("NEUROSHIMA.Settings.OpposedMeleeMode.Dice"),
            "successes": game.i18n.localize("NEUROSHIMA.Settings.OpposedMeleeMode.Successes")
        };

        return {
            config: {
                usePelletCountLimit: game.settings.get("neuroshima", "usePelletCountLimit"),
                allowCombatShift: game.settings.get("neuroshima", "allowCombatShift"),
                opposedMeleeMode: game.settings.get("neuroshima", "opposedMeleeMode"),
                opposedMeleeTier2At: game.settings.get("neuroshima", "opposedMeleeTier2At"),
                opposedMeleeTier3At: game.settings.get("neuroshima", "opposedMeleeTier3At"),
                damageApplicationMinRole: game.settings.get("neuroshima", "damageApplicationMinRole"),
                painResistanceMinRole: game.settings.get("neuroshima", "painResistanceMinRole"),
                combatActionsMinRole: game.settings.get("neuroshima", "combatActionsMinRole")
            },
            roleOptions: roleOptions,
            opposedModeOptions: opposedModeOptions
        };
    }

    /**
     * Handle form submission.
     * @param {Event} event 
     * @param {HTMLFormElement} form 
     * @param {FormDataExtended} formData 
     */
    async _onSubmit(event, form, formData) {
        const data = formData.object;
        
        try {
            const updates = [
                game.settings.set("neuroshima", "usePelletCountLimit", !!data.usePelletCountLimit),
                game.settings.set("neuroshima", "allowCombatShift", !!data.allowCombatShift),
                game.settings.set("neuroshima", "opposedMeleeMode", data.opposedMeleeMode),
                game.settings.set("neuroshima", "opposedMeleeTier2At", Number(data.opposedMeleeTier2At)),
                game.settings.set("neuroshima", "opposedMeleeTier3At", Number(data.opposedMeleeTier3At)),
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
