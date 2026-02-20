const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Application V2 for configuring encumbrance settings.
 */
export class EncumbranceConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
        id: "encumbrance-config",
        tag: "form",
        classes: ["neuroshima", "encumbrance-config"],
        window: {
            title: "NEUROSHIMA.Settings.EncumbranceConfig.Title",
            resizable: true
        },
        position: {
            width: 450,
            height: "auto"
        },
        form: {
            handler: EncumbranceConfig.#onSubmit,
            submitOnChange: false,
            closeOnSubmit: true
        }
    };

    /** @inheritdoc */
    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/encumbrance-config.hbs"
        }
    };

    /** @inheritdoc */
    async _prepareContext(options) {
        return {
            config: {
                enableEncumbrance: game.settings.get("neuroshima", "enableEncumbrance"),
                baseEncumbrance: game.settings.get("neuroshima", "baseEncumbrance"),
                useConstitutionBonus: game.settings.get("neuroshima", "useConstitutionBonus"),
                encumbranceThreshold: game.settings.get("neuroshima", "encumbranceThreshold"),
                encumbranceBonusInterval: game.settings.get("neuroshima", "encumbranceBonusInterval"),
                encumbranceBonusValue: game.settings.get("neuroshima", "encumbranceBonusValue")
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
        if (game.settings.get("neuroshima", "debugMode")) {
            console.log("Neuroshima | Próba zapisu danych udźwigu:", data);
        }

        try {
            const updates = [
                game.settings.set("neuroshima", "enableEncumbrance", !!data.enableEncumbrance),
                game.settings.set("neuroshima", "baseEncumbrance", Number(data.baseEncumbrance)),
                game.settings.set("neuroshima", "useConstitutionBonus", !!data.useConstitutionBonus),
                game.settings.set("neuroshima", "encumbranceThreshold", Number(data.encumbranceThreshold)),
                game.settings.set("neuroshima", "encumbranceBonusInterval", Number(data.encumbranceBonusInterval)),
                game.settings.set("neuroshima", "encumbranceBonusValue", Number(data.encumbranceBonusValue))
            ];
            
            await Promise.all(updates);
            
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.EncumbranceConfig.Saved"));

            // Prompt for reload since these settings require it
            SettingsConfig.reloadConfirm({ world: true });
        } catch (err) {
            console.error("Neuroshima | Błąd zapisu udźwigu:", err);
            ui.notifications.error("Wystąpił błąd podczas zapisu ustawień.");
        }
    }

    /** @inheritdoc */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = $(this.element);
        
        // Dynamic visibility logic
        const toggleBonusFields = (enabled) => {
            const fields = html.find('.constitution-bonus-field');
            if (enabled) fields.show(200);
            else fields.hide(200);
        };

        html.find('input[name="useConstitutionBonus"]').on('change', event => {
            toggleBonusFields(event.currentTarget.checked);
        });
    }
}
