const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const DEFAULT_GRENADE_BONUSES = [
    { minBuild: 12, maxBuild: 14, bonus: 10 },
    { minBuild: 15, maxBuild: 16, bonus: 20 },
    { minBuild: 17, maxBuild: 99, bonus: 30 }
];

export class GrenadeConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "grenade-config",
        tag: "form",
        classes: ["neuroshima", "grenade-config"],
        window: {
            title: "NEUROSHIMA.Settings.GrenadeConfig.Title",
            resizable: true
        },
        position: { width: 480, height: "auto" },
        form: {
            handler: async function(event, form, formData) {
                await this._onSubmit(event, form, formData);
            },
            submitOnChange: false,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: { template: "systems/neuroshima/templates/apps/grenade-config.hbs" }
    };

    async _prepareContext(options) {
        const saved = game.settings.get("neuroshima", "grenadeConstitutionBonuses");
        const tiers = Array.isArray(saved) && saved.length ? saved : DEFAULT_GRENADE_BONUSES;
        const baseRange = game.settings.get("neuroshima", "grenadeBaseRange") ?? 10;
        const distanceMultiplier = game.settings.get("neuroshima", "grenadeDistanceMultiplier") ?? 3;
        return { tiers, baseRange, distanceMultiplier };
    }

    async _onSubmit(event, form, formData) {
        const data = formData.object;
        const tiers = [];
        let i = 0;
        while (data[`tiers.${i}.minBuild`] !== undefined) {
            tiers.push({
                minBuild: Number(data[`tiers.${i}.minBuild`]) || 0,
                maxBuild: Number(data[`tiers.${i}.maxBuild`]) || 0,
                bonus: Number(data[`tiers.${i}.bonus`]) || 0
            });
            i++;
        }
        const baseRange = Number(data.baseRange) || 10;
        const distanceMultiplier = Number(data.distanceMultiplier) || 3;
        await game.settings.set("neuroshima", "grenadeConstitutionBonuses", tiers);
        await game.settings.set("neuroshima", "grenadeBaseRange", baseRange);
        await game.settings.set("neuroshima", "grenadeDistanceMultiplier", distanceMultiplier);
        if (game.neuroshima?.config) {
            game.neuroshima.config.grenadeConstitutionBonuses = tiers;
            game.neuroshima.config.grenadeBaseRange = baseRange;
            game.neuroshima.config.grenadeDistanceMultiplier = distanceMultiplier;
        }
        ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.GrenadeConfig.Saved"));
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        html.querySelector(".add-tier")?.addEventListener("click", () => {
            this._addTier();
        });

        html.querySelectorAll(".remove-tier").forEach(btn => {
            btn.addEventListener("click", (ev) => {
                const idx = parseInt(ev.currentTarget.dataset.index);
                this._removeTier(idx);
            });
        });
    }

    async _addTier() {
        const saved = game.settings.get("neuroshima", "grenadeConstitutionBonuses");
        const tiers = Array.isArray(saved) && saved.length ? [...saved] : [...DEFAULT_GRENADE_BONUSES];
        tiers.push({ minBuild: 0, maxBuild: 99, bonus: 0 });
        await game.settings.set("neuroshima", "grenadeConstitutionBonuses", tiers);
        if (game.neuroshima?.config) game.neuroshima.config.grenadeConstitutionBonuses = tiers;
        this.render();
    }

    async _removeTier(index) {
        const saved = game.settings.get("neuroshima", "grenadeConstitutionBonuses");
        const tiers = Array.isArray(saved) ? [...saved] : [...DEFAULT_GRENADE_BONUSES];
        tiers.splice(index, 1);
        await game.settings.set("neuroshima", "grenadeConstitutionBonuses", tiers);
        if (game.neuroshima?.config) game.neuroshima.config.grenadeConstitutionBonuses = tiers;
        this.render();
    }
}
