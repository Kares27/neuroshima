import {
    DEFAULT_UNARMED_DAMAGE_TABLE,
    UNARMED_DAMAGE_TYPES,
    normalizeUnarmedDamageTable
} from "../../combat/unarmed.js";

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
            width: 620,
            height: 700
        },
        form: {
            handler: async function(event, form, formData) {
                await this._onSubmit(event, form, formData);
            },
            submitOnChange: false,
            closeOnSubmit: true
        },
        actions: {
            addUnarmedThreshold: CombatConfig.prototype._onAddUnarmedThreshold,
            removeUnarmedThreshold: CombatConfig.prototype._onRemoveUnarmedThreshold,
            resetUnarmedThresholds: CombatConfig.prototype._onResetUnarmedThresholds
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

        const normalizedUnarmedDamageTable = normalizeUnarmedDamageTable(
            this._unarmedDamageTable ?? game.settings.get("neuroshima", "unarmedDamageTable")
        );
        const unarmedDamageTable = (normalizedUnarmedDamageTable.length
            ? normalizedUnarmedDamageTable
            : DEFAULT_UNARMED_DAMAGE_TABLE).map((row, index) => ({
            ...row,
            index,
            maxBuildValue: row.maxBuild ?? "",
            damageChoices: UNARMED_DAMAGE_TYPES.map(value => ({ value, selected: value === row.damage1 })),
            damage2Choices: UNARMED_DAMAGE_TYPES.map(value => ({ value, selected: value === row.damage2 })),
            damage3Choices: UNARMED_DAMAGE_TYPES.map(value => ({ value, selected: value === row.damage3 }))
        }));

        const config = {
                armorLimitEnabled: game.settings.get("neuroshima", "armorLimitEnabled"),
                armorLimitCharacter: game.settings.get("neuroshima", "armorLimitCharacter"),
                armorLimitCreature: game.settings.get("neuroshima", "armorLimitCreature"),
                armorLimitVehicle: game.settings.get("neuroshima", "armorLimitVehicle"),
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
            };

        return {
            config: { ...config, ...(this._configDraft ?? {}) },
            roleOptions: roleOptions,
            unarmedDamageTable
        };
    }

    async _onChangeForm(formConfig, event) {
        if (event.target?.name === "armorLimitEnabled") {
            const table = this.element?.querySelector("[data-armor-limit-table]");
            if (table) table.hidden = !event.target.checked;
            return;
        }
        return super._onChangeForm(formConfig, event);
    }

    _readUnarmedDamageTable() {
        const rows = Array.from(this.element?.querySelectorAll?.("[data-unarmed-row]") ?? []).map(row => ({
            maxBuild: row.querySelector('[name$=".maxBuild"]')?.value ?? null,
            damage1: row.querySelector('[name$=".damage1"]')?.value,
            damage2: row.querySelector('[name$=".damage2"]')?.value,
            damage3: row.querySelector('[name$=".damage3"]')?.value
        }));
        const normalized = normalizeUnarmedDamageTable(rows);
        return normalized.length ? normalized : DEFAULT_UNARMED_DAMAGE_TABLE.map(row => ({ ...row }));
    }

    _readConfigDraft() {
        const value = name => this.element?.querySelector?.(`[name="${name}"]`);
        return {
            armorLimitEnabled: value("armorLimitEnabled")?.checked === true,
            armorLimitCharacter: Number(value("armorLimitCharacter")?.value ?? 6),
            armorLimitCreature: Number(value("armorLimitCreature")?.value ?? 6),
            armorLimitVehicle: Number(value("armorLimitVehicle")?.value ?? 6),
            usePelletCountLimit: value("usePelletCountLimit")?.checked === true,
            allowCombatShift: value("allowCombatShift")?.checked === true,
            allowPainResistanceShift: value("allowPainResistanceShift")?.checked === true,
            meleeBonusMode: value("meleeBonusMode")?.value,
            meleeCombatType: value("meleeCombatType")?.value,
            doubleSkillAction: value("doubleSkillAction")?.checked === true,
            damageApplicationMinRole: Number(value("damageApplicationMinRole")?.value),
            painResistanceMinRole: Number(value("painResistanceMinRole")?.value),
            combatActionsMinRole: Number(value("combatActionsMinRole")?.value),
            unjamMinRole: Number(value("unjamMinRole")?.value),
            fireCorrection: value("fireCorrection")?.checked === true
        };
    }

    _onAddUnarmedThreshold() {
        this._configDraft = this._readConfigDraft();
        const rows = this._readUnarmedDamageTable();
        const finite = rows.filter(row => row.maxBuild !== null);
        const nextMax = (finite.at(-1)?.maxBuild ?? 8) + 2;
        rows.push({ maxBuild: nextMax, damage1: "sD", damage2: "sD", damage3: "sD" });
        this._unarmedDamageTable = normalizeUnarmedDamageTable(rows);
        this.render({ force: true });
    }

    _onRemoveUnarmedThreshold(_event, target) {
        this._configDraft = this._readConfigDraft();
        const rows = this._readUnarmedDamageTable();
        rows.splice(Number(target.closest("[data-unarmed-row]")?.dataset.unarmedRow), 1);
        this._unarmedDamageTable = normalizeUnarmedDamageTable(rows);
        this.render({ force: true });
    }

    _onResetUnarmedThresholds() {
        this._configDraft = this._readConfigDraft();
        this._unarmedDamageTable = DEFAULT_UNARMED_DAMAGE_TABLE.map(row => ({ ...row }));
        this.render({ force: true });
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

            const armorLimits = ["Character", "Creature", "Vehicle"].map(group => {
                const value = Number(data[`armorLimit${group}`]);
                if (!Number.isFinite(value) || value < 0) throw new Error("Invalid armor limit");
                return { group, value };
            });
            const updates = [
                game.settings.set("neuroshima", "armorLimitEnabled", !!data.armorLimitEnabled),
                ...armorLimits.map(({ group, value }) => game.settings.set("neuroshima", `armorLimit${group}`, value)),
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
                game.settings.set("neuroshima", "fireCorrection", !!data.fireCorrection),
                game.settings.set("neuroshima", "unarmedDamageTable", this._readUnarmedDamageTable())
            ];
            
            await Promise.all(updates);
            
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.CombatConfig.Saved"));
            
            const needsReload = prevPellet !== !!data.usePelletCountLimit
                || prevMeleeType !== data.meleeCombatType;

            if (needsReload) {
                SettingsConfig.reloadConfirm({ world: true });
            }
        } catch (err) {
            console.error("Neuroshima | Error saving combat settings:", err);
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.Notifications.SettingsSaveError"));
        }
    }
}
