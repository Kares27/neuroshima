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
            height: 560
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

        return {
            config: {
                usePelletCountLimit: game.settings.get("neuroshima", "usePelletCountLimit"),
                allowCombatShift: game.settings.get("neuroshima", "allowCombatShift"),
                allowPainResistanceShift: game.settings.get("neuroshima", "allowPainResistanceShift"),
                meleeBonusMode: game.settings.get("neuroshima", "meleeBonusMode"),
                meleeCombatType: game.settings.get("neuroshima", "meleeCombatType"),
                doubleSkillAction: game.settings.get("neuroshima", "doubleSkillAction"),
                damageApplicationMinRole: game.settings.get("neuroshima", "damageApplicationMinRole"),
                painResistanceMinRole: game.settings.get("neuroshima", "painResistanceMinRole"),
                combatActionsMinRole: game.settings.get("neuroshima", "combatActionsMinRole"),
                unjamMinRole: game.settings.get("neuroshima", "unjamMinRole"),
                fireCorrection: game.settings.get("neuroshima", "fireCorrection")
            },
            roleOptions: roleOptions
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
            const prevPellet = game.settings.get("neuroshima", "usePelletCountLimit");
            const prevMeleeType = game.settings.get("neuroshima", "meleeCombatType");

            const updates = [
                game.settings.set("neuroshima", "usePelletCountLimit", !!data.usePelletCountLimit),
                game.settings.set("neuroshima", "allowCombatShift", !!data.allowCombatShift),
                game.settings.set("neuroshima", "allowPainResistanceShift", !!data.allowPainResistanceShift),
                game.settings.set("neuroshima", "meleeBonusMode", data.meleeBonusMode),
                game.settings.set("neuroshima", "meleeCombatType", data.meleeCombatType),
                game.settings.set("neuroshima", "doubleSkillAction", !!data.doubleSkillAction),
                game.settings.set("neuroshima", "damageApplicationMinRole", Number(data.damageApplicationMinRole)),
                game.settings.set("neuroshima", "painResistanceMinRole", Number(data.painResistanceMinRole)),
                game.settings.set("neuroshima", "combatActionsMinRole", Number(data.combatActionsMinRole)),
                game.settings.set("neuroshima", "unjamMinRole", Number(data.unjamMinRole)),
                game.settings.set("neuroshima", "fireCorrection", !!data.fireCorrection)
            ];
            
            await Promise.all(updates);
            
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.CombatConfig.Saved"));
            
            const needsReload = prevPellet !== !!data.usePelletCountLimit
                || prevMeleeType !== data.meleeCombatType;

            if (needsReload) {
                SettingsConfig.reloadConfirm({ world: true });
            }
        } catch (err) {
            console.error("Neuroshima | Błąd zapisu ustawień walki:", err);
            ui.notifications.error("Wystąpił błąd podczas zapisu ustawień.");
        }
    }
}
