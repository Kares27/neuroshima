import { NEUROSHIMA } from "./module/config.js";
import { NeuroshimaActor } from "./module/documents/actor.js";
import { NeuroshimaCombat } from "./module/documents/combat.js";
import { NeuroshimaCombatant } from "./module/documents/combatant.js";
import { NeuroshimaItem } from "./module/documents/item.js";
import { NeuroshimaChatMessage } from "./module/documents/chat-message.js";
import { NeuroshimaActorData } from "./module/data/actor-data.js";
import { WeaponData, ArmorData, GearData, AmmoData, MagazineData, TrickData, WoundData } from "./module/data/item-data.js";
import { NeuroshimaActorSheet } from "./module/sheets/actor-sheet.js";
import { NeuroshimaItemSheet } from "./module/sheets/item-sheet.js";
import { NeuroshimaDice } from "./module/helpers/dice.js";
import { CombatHelper } from "./module/helpers/combat-helper.js";
import { NeuroshimaMeleeCombat } from "./module/combat/melee-combat.js";
import { buildRef, resolveRef } from "./module/helpers/refs.js";
import { EncumbranceConfig } from "./module/apps/encumbrance-config.js";
import { CombatConfig } from "./module/apps/combat-config.js";
import { HealingConfig } from "./module/apps/healing-config.js";
import { DebugRollDialog } from "./module/apps/debug-roll-dialog.js";
import { EditRollDialog } from "./module/apps/edit-roll-dialog.js";
import { NeuroshimaInitiativeRollDialog } from "./module/apps/initiative-roll-dialog.js";
import { HealingApp } from "./module/apps/healing-app.js";
import { showHealingRollDialog } from "./module/apps/healing-roll-dialog.js";

import { NeuroshimaCombatTracker } from "./module/combat/combat-tracker.js";
import { MeleeCombatApp } from "./module/apps/melee-combat-app.js";

// Inicjalizacja systemu Neuroshima 1.5
Hooks.once('init', async function() {
    console.log('Neuroshima 1.5 | Inicjalizacja systemu');

    CONFIG.ui.combat = NeuroshimaCombatTracker;
    MeleeCombatApp.registerHooks();

    // Hook to re-render actor sheets when combat updates (for melee pendings)
    Hooks.on("updateCombat", (combat, updates, options, userId) => {
        Object.values(ui.windows).forEach(app => {
            if (app instanceof NeuroshimaActorSheet) {
                app.render(false);
            }
        });
    });

    // Cleanup melee flags on combat delete
    Hooks.on("deleteCombat", async (combat) => {
        game.neuroshima?.log("Combat deleted, cleaning up melee flags");
        const encounters = combat.getFlag("neuroshima", "meleeEncounters") || {};
        for (const encounter of Object.values(encounters)) {
            for (const p of Object.values(encounter.participants)) {
                const doc = fromUuidSync(p.actorUuid);
                const actor = doc?.actor || doc;
                if (actor) {
                    await actor.unsetFlag("neuroshima", "activeMeleeEncounter");
                }
            }
        }
    });

    // Przypisanie niestandardowych klas i stałych (bezpieczne merge, aby nie usunąć socketu)
    game.neuroshima = Object.assign(game.neuroshima || {}, {
        NeuroshimaActor,
        NeuroshimaItem,
        NeuroshimaChatMessage,
        NeuroshimaInitiativeRollDialog,
        NeuroshimaDice,
        CombatHelper,
        NeuroshimaMeleeCombat,
        HealingApp,
        showHealingRollDialog,
        buildRef,
        resolveRef,
        config: NEUROSHIMA,
        log: (...args) => {
            if (game.settings.get("neuroshima", "debugMode")) {
                console.log("Neuroshima 1.5 |", ...args);
            }
        },
        group: (label) => {
            if (game.settings.get("neuroshima", "debugMode")) {
                console.group(`Neuroshima 1.5 | ${label}`);
            }
        },
        groupEnd: () => {
            if (game.settings.get("neuroshima", "debugMode")) {
                console.groupEnd();
            }
        },
        warn: (...args) => {
            if (game.settings.get("neuroshima", "debugMode")) {
                console.warn("Neuroshima 1.5 |", ...args);
            }
        },
        error: (...args) => {
            console.error("Neuroshima 1.5 |", ...args);
        },
        openDebugRoll: () => new DebugRollDialog().render(true),
        debugSkillRoll: (skillValue, statValue, penalty, isOpen, dice) => NeuroshimaDice.rollTest({
            skill: skillValue,
            stat: statValue,
            penalty: penalty,
            isOpen: isOpen,
            fixedDice: dice,
            isDebug: true,
            label: "Debug Skill Roll"
        }),
        debugAttributeRoll: (statValue, penalty, isOpen, dice) => NeuroshimaDice.rollTest({
            stat: statValue,
            penalty: penalty,
            isOpen: isOpen,
            fixedDice: dice,
            isDebug: true,
            label: "Debug Attribute Roll"
        })
    });

    // Handlebars Helpers
    Handlebars.registerHelper("capitalize", function(string) {
        if (!string) return "";
        return string.charAt(0).toUpperCase() + string.slice(1);
    });

    // Zdefiniowanie niestandardowych klas dokumentów
    CONFIG.Actor.documentClass = NeuroshimaActor;
    CONFIG.Combat.documentClass = NeuroshimaCombat;
    CONFIG.Combatant.documentClass = NeuroshimaCombatant;
    CONFIG.Item.documentClass = NeuroshimaItem;
    CONFIG.ChatMessage.documentClass = NeuroshimaChatMessage;

    // Inicjatywa
    CONFIG.Combat.initiative.formula = "0";

    // Rejestracja modeli danych
    CONFIG.Actor.dataModels.character = NeuroshimaActorData;
    CONFIG.Item.dataModels.weapon = WeaponData;
    CONFIG.Item.dataModels.armor = ArmorData;
    CONFIG.Item.dataModels.gear = GearData;
    CONFIG.Item.dataModels.ammo = AmmoData;
    CONFIG.Item.dataModels.magazine = MagazineData;
    CONFIG.Item.dataModels.trick = TrickData;
    CONFIG.Item.dataModels.wound = WoundData;

    Handlebars.registerHelper('gt', (a, b) => a > b);
    Handlebars.registerHelper('lt', (a, b) => a < b);
    Handlebars.registerHelper('ge', (a, b) => a >= b);
    Handlebars.registerHelper('le', (a, b) => a <= b);
    Handlebars.registerHelper('eq', (a, b) => a == b);
    Handlebars.registerHelper('ne', (a, b) => a != b);
    Handlebars.registerHelper('and', (a, b) => a && b);
    Handlebars.registerHelper('or', (a, b) => a || b);
    Handlebars.registerHelper('not', (a) => !a);
    Handlebars.registerHelper('add', (a, b) => a + b);
    Handlebars.registerHelper('abs', (a) => Math.abs(a));
    Handlebars.registerHelper('json', (context) => JSON.stringify(context));
    Handlebars.registerHelper('number', (v) => Number(v));
    Handlebars.registerHelper('inc', (v) => Number(v) + 1);
    Handlebars.registerHelper('ifThen', (c, a, b) => c ? a : b);
    Handlebars.registerHelper('meleeDieUsed', (list, index) => list?.includes(index));
    Handlebars.registerHelper('meleeDieSelected', (list, index) => list?.includes(index));
    Handlebars.registerHelper('capitalize', (str) => {
        if (!str || typeof str !== 'string') return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    });

    // Rejestracja arkuszy
    foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
    foundry.documents.collections.Actors.registerSheet("neuroshima", NeuroshimaActorSheet, {
        types: ["character"],
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.ActorCharacter"
    });

    foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
    foundry.documents.collections.Items.registerSheet("neuroshima", NeuroshimaItemSheet, {
        types: ["weapon", "armor", "gear", "trick", "ammo", "magazine", "wound"],
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.Item"
    });

    // Rejestracja ustawień systemowych
    game.settings.register("neuroshima", "debugMode", {
        name: "NEUROSHIMA.Settings.DebugMode.Name",
        hint: "NEUROSHIMA.Settings.DebugMode.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        requiresReload: false
    });

    game.settings.register("neuroshima", "requireBuildOnItems", {
        name: "NEUROSHIMA.Settings.RequireBuildOnItems.Name",
        hint: "NEUROSHIMA.Settings.RequireBuildOnItems.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        requiresReload: false
    });

    game.settings.register("neuroshima", "enableEncumbrance", {
        name: "NEUROSHIMA.Settings.EnableEncumbrance.Name",
        hint: "NEUROSHIMA.Settings.EnableEncumbrance.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true
    });

    game.settings.register("neuroshima", "allowCombatShift", {
        name: "NEUROSHIMA.Settings.AllowCombatShift.Name",
        hint: "NEUROSHIMA.Settings.AllowCombatShift.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        requiresReload: false
    });

    game.settings.register("neuroshima", "allowPainResistanceShift", {
        name: "NEUROSHIMA.Settings.AllowPainResistanceShift.Name",
        hint: "NEUROSHIMA.Settings.AllowPainResistanceShift.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        requiresReload: false
    });

    game.settings.register("neuroshima", "rollTooltipMinRole", {
        name: "NEUROSHIMA.Settings.RollTooltipMinRole.Name",
        hint: "NEUROSHIMA.Settings.RollTooltipMinRole.Hint",
        scope: "world",
        config: true,
        type: Number,
        choices: {
            0: "NEUROSHIMA.Settings.Roles.None",
            1: "NEUROSHIMA.Settings.Roles.Player",
            2: "NEUROSHIMA.Settings.Roles.Trusted",
            3: "NEUROSHIMA.Settings.Roles.Assistant",
            4: "NEUROSHIMA.Settings.Roles.Gamemaster"
        },
        default: 4,
        requiresReload: false
    });

    game.settings.register("neuroshima", "rollTooltipOwnerVisibility", {
        name: "NEUROSHIMA.Settings.RollTooltipOwnerVisibility.Name",
        hint: "NEUROSHIMA.Settings.RollTooltipOwnerVisibility.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        requiresReload: false
    });
    
    // Ustawienie limitujące liczbę śrucin (Buckshot/Birdshot) na podstawie statystyk amunicji
    game.settings.register("neuroshima", "usePelletCountLimit", {
        name: "NEUROSHIMA.Settings.UsePelletCountLimit.Name",
        hint: "NEUROSHIMA.Settings.UsePelletCountLimit.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register("neuroshima", "meleeBonusMode", {
        name: "NEUROSHIMA.Settings.MeleeBonusMode.Name",
        hint: "NEUROSHIMA.Settings.MeleeBonusMode.Hint",
        scope: "world",
        config: false,
        type: String,
        choices: {
            "attribute": "NEUROSHIMA.Settings.MeleeBonusMode.Attribute",
            "skill": "NEUROSHIMA.Settings.MeleeBonusMode.Skill",
            "both": "NEUROSHIMA.Settings.MeleeBonusMode.Both"
        },
        default: "attribute",
        requiresReload: false
    });

    game.settings.register("neuroshima", "meleeCombatType", {
        name: "NEUROSHIMA.Settings.MeleeCombatType.Name",
        hint: "NEUROSHIMA.Settings.MeleeCombatType.Hint",
        scope: "world",
        config: false,
        type: String,
        choices: {
            "default": "NEUROSHIMA.Settings.MeleeCombatType.Default",
            "opposedPips": "NEUROSHIMA.Settings.MeleeCombatType.OpposedPips",
            "opposedSuccesses": "NEUROSHIMA.Settings.MeleeCombatType.OpposedSuccesses"
        },
        default: "default",
        requiresReload: true
    });

    game.settings.register("neuroshima", "doubleSkillAction", {
        name: "NEUROSHIMA.Settings.DoubleSkillAction.Name",
        hint: "NEUROSHIMA.Settings.DoubleSkillAction.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        requiresReload: false
    });

    // Ustawienia widoczności interfejsu walki
    game.settings.register("neuroshima", "damageApplicationMinRole", {
        name: "NEUROSHIMA.Settings.DamageApplicationMinRole.Name",
        scope: "world",
        config: false,
        type: Number,
        default: 4
    });

    game.settings.register("neuroshima", "painResistanceMinRole", {
        name: "NEUROSHIMA.Settings.PainResistanceMinRole.Name",
        scope: "world",
        config: false,
        type: Number,
        default: 4
    });

    game.settings.register("neuroshima", "combatActionsMinRole", {
        name: "NEUROSHIMA.Settings.CombatActionsMinRole.Name",
        scope: "world",
        config: false,
        type: Number,
        default: 4
    });

    // Rejestracja menu ustawień
    game.settings.registerMenu("neuroshima", "combatConfig", {
        name: "NEUROSHIMA.Settings.CombatConfig.Label",
        label: "NEUROSHIMA.Settings.CombatConfig.Title",
        hint: "NEUROSHIMA.Settings.CombatConfig.Hint",
        icon: "fas fa-swords",
        type: CombatConfig,
        restricted: true
    });

    game.settings.registerMenu("neuroshima", "encumbranceConfig", {
        name: "NEUROSHIMA.Settings.EncumbranceConfig.Label",
        label: "NEUROSHIMA.Settings.EncumbranceConfig.Title",
        hint: "NEUROSHIMA.Settings.EncumbranceConfig.Hint",
        icon: "fas fa-weight-hanging",
        type: EncumbranceConfig,
        restricted: true,
        requiresReload: true
    });

    game.settings.registerMenu("neuroshima", "healingConfig", {
        name: "NEUROSHIMA.Settings.HealingConfig.Label",
        label: "NEUROSHIMA.Settings.HealingConfig.Title",
        hint: "NEUROSHIMA.Settings.HealingConfig.Hint",
        icon: "fas fa-syringe",
        type: HealingConfig,
        restricted: true
    });

    // Rejestracja ustawień udźwigu (ukryte z głównego menu)
    game.settings.register("neuroshima", "baseEncumbrance", {
        name: "NEUROSHIMA.Settings.BaseEncumbrance.Name",
        hint: "NEUROSHIMA.Settings.BaseEncumbrance.Hint",
        scope: "world",
        config: false,
        type: Number,
        default: 20,
        requiresReload: true
    });

    game.settings.register("neuroshima", "useConstitutionBonus", {
        name: "NEUROSHIMA.Settings.UseConstitutionBonus.Name",
        hint: "NEUROSHIMA.Settings.UseConstitutionBonus.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register("neuroshima", "encumbranceThreshold", {
        name: "NEUROSHIMA.Settings.EncumbranceThreshold.Name",
        hint: "NEUROSHIMA.Settings.EncumbranceThreshold.Hint",
        scope: "world",
        config: false,
        type: Number,
        default: 10,
        requiresReload: true
    });

    game.settings.register("neuroshima", "encumbranceBonusInterval", {
        name: "NEUROSHIMA.Settings.EncumbranceBonusInterval.Name",
        hint: "NEUROSHIMA.Settings.EncumbranceBonusInterval.Hint",
        scope: "world",
        config: false,
        type: Number,
        default: 2,
        requiresReload: true
    });

    game.settings.register("neuroshima", "encumbranceBonusValue", {
        name: "NEUROSHIMA.Settings.EncumbranceBonusValue.Name",
        hint: "NEUROSHIMA.Settings.EncumbranceBonusValue.Hint",
        scope: "world",
        config: false,
        type: Number,
        default: 5,
        requiresReload: true
    });

    game.settings.register("neuroshima", "patientCardVersion", {
        name: "NEUROSHIMA.Settings.PatientCardVersion.Name",
        hint: "NEUROSHIMA.Settings.PatientCardVersion.Hint",
        scope: "world",
        config: false,
        type: String,
        choices: {
            "simple": "NEUROSHIMA.Settings.PatientCardVersion.Simple",
            "extended": "NEUROSHIMA.Settings.PatientCardVersion.Extended"
        },
        default: "simple",
        requiresReload: true,
        onChange: (value) => {
            if (game.settings.get("neuroshima", "debugMode")) {
                console.log("Neuroshima | patientCardVersion changed:", value);
            }
        }
    });

    game.settings.register("neuroshima", "healingDifficulties", {
        name: "NEUROSHIMA.Settings.HealingDifficulties.Name",
        hint: "NEUROSHIMA.Settings.HealingDifficulties.Hint",
        scope: "world",
        config: false,
        type: Object,
        default: {
            "D": "average",
            "L": "average",
            "C": "problematic",
            "K": "problematic"
        },
        requiresReload: true,
        onChange: (value) => {
            if (game.settings.get("neuroshima", "debugMode")) {
                console.log("Neuroshima | healingDifficulties changed:", value);
            }
        }
    });

    // Wczytanie szablonów (v13 namespaced)
    const templates = [
        "systems/neuroshima/templates/actor/parts/actor-header.hbs",
        "systems/neuroshima/templates/actor/parts/actor-info.hbs",
        "systems/neuroshima/templates/actor/parts/actor-attributes.hbs",
        "systems/neuroshima/templates/actor/parts/actor-skills.hbs",
        "systems/neuroshima/templates/actor/parts/actor-tricks.hbs",
        "systems/neuroshima/templates/actor/parts/actor-combat.hbs",
        "systems/neuroshima/templates/actor/parts/actor-inventory.hbs",
        "systems/neuroshima/templates/actor/parts/actor-notes.hbs",
        "systems/neuroshima/templates/actor/parts/wounds-paper-doll.hbs",
        "systems/neuroshima/templates/actor/parts/wounds-list.hbs",
        "systems/neuroshima/templates/item/item-sheet.hbs",
        "systems/neuroshima/templates/item/item-header.hbs",
        "systems/neuroshima/templates/item/item-details.hbs",
        "systems/neuroshima/templates/item/item-effects.hbs",
        "systems/neuroshima/templates/item/parts/weapon-melee.hbs",
        "systems/neuroshima/templates/item/parts/weapon-ranged.hbs",
        "systems/neuroshima/templates/item/parts/weapon-thrown.hbs",
        "systems/neuroshima/templates/item/parts/ammo-details.hbs",
        "systems/neuroshima/templates/item/parts/wound-details.hbs",
        "systems/neuroshima/templates/item/parts/magazine-details.hbs",
        "systems/neuroshima/templates/item/parts/ammunition-details.hbs",
        "systems/neuroshima/templates/apps/healing-config.hbs",
        "systems/neuroshima/templates/apps/healing-app-main.hbs",
        "systems/neuroshima/templates/apps/healing-app-header.hbs",
        "systems/neuroshima/templates/apps/encumbrance-config.hbs",
        "systems/neuroshima/templates/apps/edit-roll-dialog.hbs",
        "systems/neuroshima/templates/apps/debug-roll-dialog.hbs",
        "systems/neuroshima/templates/apps/combat-config.hbs",
        "systems/neuroshima/templates/apps/melee/melee-app.hbs",
        "systems/neuroshima/templates/apps/melee/parts/melee-top-bar.hbs",
        "systems/neuroshima/templates/apps/melee/parts/fighter-card.hbs",
        "systems/neuroshima/templates/apps/melee/parts/arena-center.hbs",
        "systems/neuroshima/templates/apps/melee/parts/melee-action-bar.hbs",
        "systems/neuroshima/templates/apps/melee/parts/combat-log.hbs",
        "systems/neuroshima/templates/apps/melee/parts/footer-danger.hbs",
        "systems/neuroshima/templates/chat/weapon-roll-card.hbs",
        "systems/neuroshima/templates/chat/roll-card.hbs",
        "systems/neuroshima/templates/chat/patient-card.hbs",
        "systems/neuroshima/templates/chat/pain-resistance-report.hbs",
        "systems/neuroshima/templates/chat/rest-report.hbs",
        "systems/neuroshima/templates/chat/healing-roll-card.hbs",
        "systems/neuroshima/templates/chat/healing-request.hbs",
        "systems/neuroshima/templates/dialog/rest-dialog.hbs"
    ];
    
    await foundry.applications.handlebars.loadTemplates(templates);
    
    // Ręczna rejestracja partiali
    for (const path of templates) {
        if (path.includes("/parts/")) {
            const template = await getTemplate(path);
            Handlebars.registerPartial(path, template);
            
            // Rejestruj też pod skróconą nazwą (np. MeleeHeader) dla łatwiejszego użycia w HBS
            const shortName = path.split("/").pop().replace(".hbs", "").split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("");
            Handlebars.registerPartial(shortName, template);
        }
    }

    console.log("Neuroshima 1.5 | Szablony wczytane");
});

Hooks.once("ready", async function () {
    game.neuroshima.log("Tryb debugowania jest WŁĄCZONY");
    console.log("Neuroshima 1.5 | System gotowy");
});

// Dodanie opcji menu kontekstowego do wiadomości czatu
Hooks.on("getChatMessageContextOptions", (html, options) => {
    options.push({
        name: "NEUROSHIMA.Roll.SwitchToOpen",
        icon: '<i class="fas fa-eye"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const flags = message?.getFlag("neuroshima", "rollData");
            return flags && !flags.isOpen && game.user.isGM;
        },
        callback: li => {
            const message = game.messages.get(li.dataset.messageId);
            NeuroshimaDice.updateRollMessage(message, true);
        }
    });

    options.push({
        name: "NEUROSHIMA.Roll.SwitchToClosed",
        icon: '<i class="fas fa-eye-slash"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const flags = message?.getFlag("neuroshima", "rollData");
            return flags && flags.isOpen && game.user.isGM;
        },
        callback: li => {
            const message = game.messages.get(li.dataset.messageId);
            NeuroshimaDice.updateRollMessage(message, false);
        }
    });

    options.push({
        name: "NEUROSHIMA.Roll.RefundAmmo",
        icon: '<i class="fas fa-undo"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const flags = message?.getFlag("neuroshima", "rollData");
            const alreadyRefunded = message?.getFlag("neuroshima", "ammoRefunded");
            
            // Refundacja zależna od ustawionej rangi
            if (!CombatHelper.canPerformCombatAction()) return false;
            
            return flags?.isWeapon && (flags.bulletSequence?.length > 0) && !alreadyRefunded;
        },
        callback: li => {
            const message = game.messages.get(li.dataset.messageId);
            CombatHelper.refundAmmunition(message);
        }
    });

    options.push({
        name: "NEUROSHIMA.Roll.ReverseDamage",
        icon: '<i class="fas fa-history"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const isReport = message?.getFlag("neuroshima", "isPainResistanceReport");
            const alreadyReversed = message?.getFlag("neuroshima", "isReversed");
            
            // Reverse Damage zależna od ustawionej rangi
            if (!CombatHelper.canPerformCombatAction()) return false;

            return isReport && !alreadyReversed;
        },
        callback: li => {
            const message = game.messages.get(li.dataset.messageId);
            CombatHelper.reverseDamage(message);
        }
    });

    options.push({
        name: "NEUROSHIMA.Roll.ReverseRest",
        icon: '<i class="fas fa-bed"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const messageType = message?.getFlag("neuroshima", "messageType");
            const alreadyReversed = message?.getFlag("neuroshima", "isReversed");
            
            if (!CombatHelper.canPerformCombatAction()) return false;

            return messageType === "rest" && !alreadyReversed;
        },
        callback: li => {
            const message = game.messages.get(li.dataset.messageId);
            CombatHelper.reverseRest(message);
        }
    });

    options.push({
        name: "NEUROSHIMA.Actions.Reroll",
        icon: '<i class="fas fa-arrow-rotate-left"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const rollData = message?.getFlag("neuroshima", "rollData");
            const messageType = message?.getFlag("neuroshima", "messageType");
            
            // Tylko dla skill/attrybut testów i broni
            if (!rollData) return false;
            if (messageType !== "roll" && messageType !== "weapon") return false;
            
            // GM lub aktor który wykonał test
            const actor = game.actors.get(rollData.actorId);
            return game.user.isGM || actor?.isOwner;
        },
        callback: li => {
            const message = game.messages.get(li.dataset.messageId);
            const rollData = message?.getFlag("neuroshima", "rollData");
            const messageType = message?.getFlag("neuroshima", "messageType");
            const actor = game.actors.get(rollData?.actorId);
            
            if (!actor || !rollData) {
                ui.notifications.error("Nie można znaleźć wymaganych danych do przerzutu");
                return;
            }

            // Dialog potwierdzenia (DialogV2)
            new Promise(resolve => {
                const dialog = new foundry.applications.api.DialogV2({
                    window: {
                        title: game.i18n.localize("NEUROSHIMA.Dialogs.ConfirmReroll"),
                        icon: "fas fa-exclamation-triangle"
                    },
                    content: `<p style="padding: 10px;">${game.i18n.localize("NEUROSHIMA.Dialogs.RerollTestQuestion")}</p>`,
                    buttons: [
                        {
                            action: "yes",
                            label: game.i18n.localize("NEUROSHIMA.Actions.Reroll"),
                            default: true,
                            callback: () => resolve(true)
                        },
                        {
                            action: "no",
                            label: game.i18n.localize("NEUROSHIMA.Actions.Cancel"),
                            callback: () => resolve(false)
                        }
                    ]
                });
                dialog.render(true);
            }).then(async confirmed => {
                if (!confirmed) return;

                game.neuroshima?.group("Reroll Test");
                game.neuroshima?.log("Przerzucanie testu", {
                    actor: actor.name,
                    label: rollData.label,
                    type: messageType
                });

                if (messageType === "weapon") {
                    const weapon = actor.items.get(rollData.weaponId);
                    if (!weapon) {
                        ui.notifications.error("Nie można znaleźć broni do przerzutu");
                        game.neuroshima?.groupEnd();
                        return;
                    }

                    // Refund ammunition before rerolling to avoid double consumption
                    // Only refund if the previous roll actually consumed ammunition (no jamming)
                    if (!rollData.isJamming) {
                        await CombatHelper.refundAmmunition(message);
                    }

                    // Powtórz test broni
                    await game.neuroshima.NeuroshimaDice.rollWeaponTest({
                        weapon: weapon,
                        actor: actor,
                        aimingLevel: rollData.aimingLevel || 0,
                        burstLevel: rollData.burstLevel || 0,
                        difficulty: rollData.difficulty || "average",
                        hitLocation: rollData.hitLocation || "random",
                        modifier: rollData.modifier || 0,
                        applyArmor: rollData.applyArmor !== false,
                        applyWounds: rollData.applyWounds !== false,
                        isOpen: rollData.isOpen || false,
                        skillBonus: rollData.skillBonus || 0,
                        attributeBonus: rollData.attributeBonus || 0,
                        distance: rollData.distance || 0,
                        meleeAction: rollData.meleeAction || "attack",
                        isReroll: true,
                        rollMode: rollData.rollMode || game.settings.get("core", "rollMode")
                    }).finally(() => {
                        game.neuroshima?.groupEnd();
                    });
                } else {
                    // Powtórz test standardowy
                    await game.neuroshima.NeuroshimaDice.rollTest({
                        actor: actor,
                        label: rollData.label,
                        stat: rollData.baseStat,
                        skill: rollData.baseSkill,
                        skillBonus: rollData.skillBonus || 0,
                        attributeBonus: rollData.attributeBonus || 0,
                        penalties: rollData.penalties || { mod: 0, wounds: 0, armor: 0 },
                        isOpen: rollData.isOpen,
                        isCombat: rollData.isCombat || false,
                        isReroll: true,
                        rollMode: rollData.rollMode || game.settings.get("core", "rollMode")
                    }).finally(() => {
                        game.neuroshima?.groupEnd();
                    });
                }
            });
        }
    });
});

// Obsługa interakcji na kartach czatu (v13: renderChatMessageHTML)
Hooks.on("renderChatMessageHTML", (message, html) => {
    // Inicjalizacja akcji Neuroshima (Dispatcher)
    NeuroshimaChatMessage.onChatAction(html);

    // Obsługa Patient Card (UI toggles)
    const patientCard = html.querySelector(".neuroshima.patient-card");
    if (patientCard) {
        // Główny toggle dla wszystkich ran
        const woundsMainToggle = patientCard.querySelector(".wounds-main-toggle");
        if (woundsMainToggle) {
            woundsMainToggle.addEventListener("click", () => {
                const woundsContainer = patientCard.querySelector(".wounds-container");
                const isCollapsed = woundsMainToggle.dataset.collapsed === "true";
                woundsMainToggle.dataset.collapsed = !isCollapsed;
                woundsContainer.style.display = isCollapsed ? "block" : "none";
            });
        }

        // Toggle dla każdej lokacji
        patientCard.querySelectorAll(".location-toggle").forEach(toggle => {
            toggle.addEventListener("click", () => {
                const woundsList = toggle.closest(".location-group")?.querySelector(".wounds-list");
                if (woundsList) {
                    const isCollapsed = toggle.dataset.collapsed === "true";
                    toggle.dataset.collapsed = !isCollapsed;
                    woundsList.style.display = isCollapsed ? "block" : "none";
                }
            });
        });
    }

    // Obsługa Healing Request Card (UI toggles)
    const healingRequestCard = html.querySelector(".neuroshima.heal-request-card");
    if (healingRequestCard) {
        // Główny toggle dla wszystkich ran
        const woundsMainToggle = healingRequestCard.querySelector(".wounds-main-toggle");
        if (woundsMainToggle) {
            woundsMainToggle.addEventListener("click", () => {
                const woundsContainer = healingRequestCard.querySelector(".wounds-container");
                const isCollapsed = woundsMainToggle.dataset.collapsed === "true";
                woundsMainToggle.dataset.collapsed = !isCollapsed;
                woundsContainer.style.display = isCollapsed ? "block" : "none";
            });
        }

        // Toggle dla każdej lokacji
        healingRequestCard.querySelectorAll(".location-toggle").forEach(toggle => {
            toggle.addEventListener("click", () => {
                const woundsList = toggle.closest(".location-group")?.querySelector(".wounds-list");
                if (woundsList) {
                    const isCollapsed = toggle.dataset.collapsed === "true";
                    toggle.dataset.collapsed = !isCollapsed;
                    woundsList.style.display = isCollapsed ? "block" : "none";
                }
            });
        });
    }

    // Obsługa Healing Batch Report - stan wizualny przycisków
    const healingBatchReport = html.querySelector(".neuroshima.healing-batch-report");
    if (healingBatchReport) {
        const isApplied = message.getFlag("neuroshima", "healingApplied") === true;
        
        // Przycisk aplikacji leczenia
        const applyBtn = healingBatchReport.querySelector(".apply-healing-btn");
        if (applyBtn && isApplied) {
            applyBtn.disabled = true;
            applyBtn.textContent = "✓ " + game.i18n.localize("NEUROSHIMA.HealingRequest.ApplyHealing");
            applyBtn.classList.add("applied");
        }

        // Przycisk przerzutu
        if (isApplied) {
            healingBatchReport.querySelectorAll(".reroll-healing-btn").forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = "0.5";
                btn.style.cursor = "not-allowed";
                btn.title = game.i18n.localize("NEUROSHIMA.Warnings.HealingAlreadyApplied");
            });
        }
    }

    // Obsługa wyboru lokacji (Melee Opposed Result oraz Ranged Roll)
    const locationDropdown = html.querySelector(".opposed-location-dropdown");
    if (locationDropdown) {
        locationDropdown.addEventListener("change", async (ev) => {
            const newLocation = ev.target.value;
            await message.setFlag("neuroshima", "selectedLocation", newLocation);
            game.neuroshima?.log("Zmieniono wybraną lokację na karcie", { messageId: message.id, newLocation });
        });

        // Przywróć poprzednio wybraną lokację z flag
        const savedLocation = message.getFlag("neuroshima", "selectedLocation");
        if (savedLocation) {
            locationDropdown.value = savedLocation;
        }
    }

    const card = html.querySelector(".neuroshima.roll-card");
    if (!card) return;

    // Obsługa rozwijanego menu (ogólna dla kart roll-card)
    card.querySelectorAll(".collapsible-toggle").forEach(toggle => {
        toggle.addEventListener("click", (event) => {
            event.preventDefault();
            const section = toggle.closest(".collapsible-section") || card;
            const content = section.querySelector(".collapsible-content, .damage-application-content");
            if (content) {
                const isHidden = content.style.display === "none";
                content.style.display = isHidden ? (content.classList.contains("damage-application-content") ? "flex" : "block") : "none";
                const icon = toggle.querySelector("i");
                if (icon) {
                    icon.classList.toggle("fa-chevron-down", !isHidden);
                    icon.classList.toggle("fa-chevron-up", isHidden);
                }
                
                // Specyficzne odświeżanie dla taba obrażeń
                if (isHidden && content.classList.contains("damage-application-content")) {
                    const activeTab = card.querySelector(".damage-tab-header.active")?.dataset.tab || "targets";
                    updateCardTargets(card, activeTab);
                }
            }
        });
    });

    // Obsługa przełączania tabów obrażeń (tylko jeśli istnieją)
    card.querySelectorAll(".damage-tab-header").forEach(tabHeader => {
        tabHeader.addEventListener("click", () => {
            const tab = tabHeader.dataset.tab;
            
            // Przełącz nagłówki
            card.querySelectorAll(".damage-tab-header").forEach(h => h.classList.remove("active"));
            tabHeader.classList.add("active");

            // Przełącz kontenery
            card.querySelectorAll(".target-list").forEach(l => {
                l.style.display = l.dataset.tab === tab ? "block" : "none";
            });

            updateCardTargets(card, tab);
        });
    });

    // Przycisk nakładania obrażeń
    card.querySelectorAll(".apply-damage-button").forEach(btn => {
        btn.addEventListener("click", (event) => {
            event.preventDefault();
            
            game.neuroshima.group("Interfejs Obrażeń | Kliknięcie przycisku");
            
            const activeTab = card.querySelector(".damage-tab-header.active")?.dataset.tab;
            let actors = [];
            
            if (activeTab === "targets") {
                actors = Array.from(game.user.targets).map(t => t.actor).filter(a => a);
                game.neuroshima.log("Pobieranie aktorów z namierzonych celów:", actors.map(a => a.name));
            } else if (activeTab === "selected") {
                actors = canvas.tokens.controlled.map(t => t.actor).filter(a => a);
                game.neuroshima.log("Pobieranie aktorów z zaznaczonych tokenów:", actors.map(a => a.name));
            }
            
            if (actors.length > 0) {
                game.neuroshima.log("Wywoływanie CombatHelper.applyDamage...");
                CombatHelper.applyDamage(message, actors);
            } else {
                game.neuroshima.log("Błąd: Nie znaleziono żadnych aktorów do nałożenia obrażeń.");
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoTokensSelectedOrTargeted"));
            }
            
            game.neuroshima.groupEnd();
        });
    });

    // Przycisk wycofywania obrażeń (Reverse Damage)
    card.querySelectorAll(".reverse-damage-button").forEach(btn => {
        btn.addEventListener("click", (event) => {
            event.preventDefault();
            const reportMessage = game.messages.get(message.id);
            if (reportMessage) {
                CombatHelper.reverseDamage(reportMessage);
            }
        });
    });
});

// Hook do dynamicznego ukrywania elementów na kliencie na podstawie uprawnień (v13: renderChatMessageHTML)
Hooks.on("renderChatMessageHTML", (message, html) => {
    // Sprawdzenie uprawnień dla sekcji nakładania obrażeń
    const damageApplicationMinRole = game.settings.get("neuroshima", "damageApplicationMinRole");
    if (game.user.role < damageApplicationMinRole && !game.user.isGM) {
        const damageSection = html.querySelector(".apply-damage-section");
        if (damageSection) {
            damageSection.style.display = "none";
        }
    }

    // Sprawdzenie uprawnień dla szczegółów Odporności na Ból
    const painResistanceMinRole = game.settings.get("neuroshima", "painResistanceMinRole");
    if (game.user.role < painResistanceMinRole && !game.user.isGM) {
        const painResistanceDetails = html.querySelector(".pain-resistance-details");
        if (painResistanceDetails) {
            painResistanceDetails.remove();
        }
    }

    // Sprawdzenie uprawnień dla tooltipów w zwykłych rzutach
    const rollTooltipMinRole = game.settings.get("neuroshima", "rollTooltipMinRole");
    const rollTooltipOwnerVisibility = game.settings.get("neuroshima", "rollTooltipOwnerVisibility");
    
    // Pobranie ID aktora z flagi wiadomości
    const actorId = message.flags?.neuroshima?.rollData?.actorId;
    let actor = null;
    if (actorId) {
        actor = game.actors.get(actorId);
    }
    
    // Sprawdzenie, czy użytkownik ma uprawnienia do widzenia tooltipu
    const canShowTooltip = game.user.role >= rollTooltipMinRole || 
                          (rollTooltipOwnerVisibility && (actor?.isOwner || game.user.isGM));
    
    if (!canShowTooltip) {
        // Ukryj wszystkie data-tooltip w czacie
        const tooltipElements = html.querySelectorAll("[data-tooltip]");
        tooltipElements.forEach(el => {
            el.removeAttribute("data-tooltip");
            el.removeAttribute("data-tooltip-direction");
        });
    }
});

/**
 * Aktualizuje listę celów/zaznaczonych tokenów na karcie czatu.
 */
function updateCardTargets(card, tab) {
    if (!card) return;
    const targetList = card.querySelector(`.target-list[data-tab="${tab}"]`);
    if (!targetList) return;
    
    let tokens = [];
    let emptyLabel = "";

    if (tab === "targets") {
        tokens = Array.from(game.user.targets);
        emptyLabel = game.i18n.localize("NEUROSHIMA.Roll.NoTargets");
    } else {
        tokens = canvas.tokens.controlled;
        emptyLabel = game.i18n.localize("NEUROSHIMA.Roll.NoSelected");
    }

    if (tokens.length === 0) {
        targetList.innerHTML = `<div class="target-item no-targets" style="opacity: 0.6; font-style: italic;">
            ${emptyLabel}
        </div>`;
        return;
    }

    let html = "";
    for (const token of tokens) {
        if (!token) continue;
        const img = token.document?.texture?.src || token.data?.img || token.img;
        html += `<div class="target-item">
            <img src="${img}" width="20" height="20" style="object-fit: cover; border-radius: 4px; border: 1px solid #777; margin-right: 5px;"/>
            <span>${token.name || "Unknown"}</span>
        </div>`;
    }
    targetList.innerHTML = html;
}

/**
 * Odświeża listy celów na wszystkich widocznych sekcjach nakładania obrażeń.
 */
function refreshAllCombatCards() {
    document.querySelectorAll(".neuroshima.roll-card").forEach(card => {
        const content = card.querySelector(".damage-application-content");
        if (content && content.style.display !== "none") {
            const activeTab = card.querySelector(".damage-tab-header.active")?.dataset.tab || "targets";
            updateCardTargets(card, activeTab);
        }
    });
}

/**
 * Inicjalizacja socketlib dla systemu.
 */
function initializeSocketlib() {
    if (typeof socketlib === "undefined") return;
    if (!game.neuroshima) {
        game.neuroshima = {}; // Awaryjna inicjalizacja jeśli system.js init jeszcze nie przeszedł
    }
    if (game.neuroshima.socket) return; // Już zainicjalizowane

    game.neuroshima.socket = socketlib.registerSystem("neuroshima");
    if (!game.neuroshima.socket) return;

    console.log("Neuroshima 1.5 | Rejestracja handlerów Socketlib");
    
    // Healing batch application
    game.neuroshima.socket.register("applyHealingBatch", async (data) => {
        const doc = await fromUuid(data.patientUuid);
        const patient = doc?.actor || doc;
        if (!patient) return;

        const results = data.results || [];
        const updates = [];
        const toDelete = [];
        
        const message = data.messageId ? game.messages.get(data.messageId) : null;
        const method = message?.getFlag("neuroshima", "healingMethod");

        for (const r of results) {
            const wound = patient.items.get(r.woundId);
            if (!wound || wound.type !== "wound") continue;

            const hEffect = r.healingEffect;
            if (!hEffect) continue;

            if (hEffect.newPenalty <= 0) {
                toDelete.push(r.woundId);
            } else {
                const currentAttempts = wound.system.healingAttempts || 0;
                const updateData = {
                    _id: r.woundId,
                    "system.penalty": hEffect.newPenalty,
                    "system.healingAttempts": currentAttempts + 1
                };
                
                if (r.isSuccess) {
                    updateData["system.isHealing"] = true;
                    if (method === "firstAid") {
                        updateData["system.hadFirstAid"] = true;
                    }
                }
                
                updates.push(updateData);
            }
        }

        if (updates.length > 0) {
            await patient.updateEmbeddedDocuments("Item", updates);
        }

        if (toDelete.length > 0) {
            await patient.deleteEmbeddedDocuments("Item", toDelete);
        }

        if (message) {
            await message.setFlag("neuroshima", "healingApplied", true);
        }
    });

    // Combat Flag Proxy - Allows players to update flags on the Combat document
    game.neuroshima.socket.register("updateCombatFlag", async (key, value) => {
        const combat = game.combat;
        if (!combat) return;
        return combat.setFlag("neuroshima", key, value);
    });

    // Combat Flag Proxy - Allows players to unset flags on the Combat document
    game.neuroshima.socket.register("unsetCombatFlag", async (key) => {
        const combat = game.combat;
        if (!combat) return;
        return combat.unsetFlag("neuroshima", key);
    });

    // Specialized handler to end melee encounters (handles cross-actor flag cleanup)
    game.neuroshima.socket.register("removeMeleeEncounter", async (id) => {
        const { MeleeStore } = await import("./module/combat/melee-store.js");
        return MeleeStore.removeEncounter(id);
    });

    // Specialized handler to remove a melee pending
    game.neuroshima.socket.register("removeMeleePending", async (pendingUuid) => {
        const { MeleeStore } = await import("./module/combat/melee-store.js");
        return MeleeStore.removePending(pendingUuid);
    });
}

// Rejestracja socketlib po załadowaniu modułu
Hooks.once("socketlib.ready", () => {
    initializeSocketlib();
});

// Zapasowa inicjalizacja w setup (na wypadek gdyby hook socketlib.ready już przeszedł)
Hooks.once("setup", () => {
    initializeSocketlib();
});

// Rejestracja globalnych hooków dla odświeżania interfejsu
Hooks.on("targetToken", (user) => {
    if (user.id === game.user.id) refreshAllCombatCards();
});

Hooks.on("controlToken", () => {
    refreshAllCombatCards();
});
