import { NEUROSHIMA } from "./module/config.js";
import { NeuroshimaActor } from "./module/documents/actor.js";
import { NeuroshimaItem } from "./module/documents/item.js";
import { NeuroshimaChatMessage } from "./module/documents/chat-message.js";
import { NeuroshimaActorData } from "./module/data/actor-data.js";
import { WeaponData, ArmorData, GearData, AmmoData, MagazineData, TrickData, WoundData } from "./module/data/item-data.js";
import { NeuroshimaActorSheet } from "./module/sheets/actor-sheet.js";
import { NeuroshimaItemSheet } from "./module/sheets/item-sheet.js";
import { NeuroshimaDice } from "./module/helpers/dice.js";
import { CombatHelper } from "./module/helpers/combat-helper.js";
import { buildRef, resolveRef } from "./module/helpers/refs.js";
import { EncumbranceConfig } from "./module/apps/encumbrance-config.js";
import { CombatConfig } from "./module/apps/combat-config.js";
import { HealingConfig } from "./module/apps/healing-config.js";
import { DebugRollDialog } from "./module/apps/debug-roll-dialog.js";
import { EditRollDialog } from "./module/apps/edit-roll-dialog.js";
import { HealingApp } from "./module/apps/healing-app.js";
import { NeuroshimaMeleePanel } from "./module/apps/melee-panel.js";
import { showHealingRollDialog } from "./module/apps/healing-roll-dialog.js";
import { NeuroshimaMeleeDefenseDialog } from "./module/dialogs/melee-defense-dialog.js";
import { NeuroshimaMeleeOpposed } from "./module/helpers/melee-opposed.js";

// Inicjalizacja systemu Neuroshima 1.5
Hooks.once('init', async function() {
    console.log('Neuroshima 1.5 | Inicjalizacja systemu');

    // Przypisanie niestandardowych klas i stałych
    game.neuroshima = {
        NeuroshimaActor,
        NeuroshimaItem,
        NeuroshimaChatMessage,
        NeuroshimaDice,
        NeuroshimaMeleeOpposed,
        NeuroshimaMeleeDefenseDialog,
        CombatHelper,
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
        }),
        meleePanel: new NeuroshimaMeleePanel()
    };

    // Zdefiniowanie niestandardowych klas dokumentów
    CONFIG.Actor.documentClass = NeuroshimaActor;
    CONFIG.Item.documentClass = NeuroshimaItem;
    CONFIG.ChatMessage.documentClass = NeuroshimaChatMessage;

    // Rejestracja modeli danych
    CONFIG.Actor.dataModels.character = NeuroshimaActorData;
    CONFIG.Item.dataModels.weapon = WeaponData;
    CONFIG.Item.dataModels.armor = ArmorData;
    CONFIG.Item.dataModels.gear = GearData;
    CONFIG.Item.dataModels.ammo = AmmoData;
    CONFIG.Item.dataModels.magazine = MagazineData;
    CONFIG.Item.dataModels.trick = TrickData;
    CONFIG.Item.dataModels.wound = WoundData;

    // Handlebars Helpers
    Handlebars.registerHelper('capitalize', function(string) {
        if (!string) return "";
        return string.charAt(0).toUpperCase() + string.slice(1);
    });

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

    // Ustawienia walki wręcz (Opposed Melee)
    game.settings.register("neuroshima", "opposedMeleeMode", {
        name: "NEUROSHIMA.Settings.OpposedMeleeMode.Name",
        hint: "NEUROSHIMA.Settings.OpposedMeleeMode.Hint",
        scope: "world",
        config: false,
        type: String,
        choices: {
            "successes": "NEUROSHIMA.Settings.OpposedMeleeMode.Successes",
            "dice": "NEUROSHIMA.Settings.OpposedMeleeMode.Dice",
            "vanilla": "NEUROSHIMA.Settings.OpposedMeleeMode.Vanilla"
        },
        default: "successes",
        requiresReload: false
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
        "systems/neuroshima/templates/chat/weapon-roll-card.hbs",
        "systems/neuroshima/templates/chat/roll-card.hbs",
        "systems/neuroshima/templates/chat/patient-card.hbs",
        "systems/neuroshima/templates/chat/pain-resistance-report.hbs",
        "systems/neuroshima/templates/chat/rest-report.hbs",
        "systems/neuroshima/templates/chat/healing-roll-card.hbs",
        "systems/neuroshima/templates/chat/healing-request.hbs",
        "systems/neuroshima/templates/chat/opposed-handler.hbs",
        "systems/neuroshima/templates/chat/opposed-result.hbs",
        "systems/neuroshima/templates/dialog/rest-dialog.hbs",
        "systems/neuroshima/templates/dialog/melee-defense.hbs"
    ];
    
    await foundry.applications.handlebars.loadTemplates(templates);
    
    // Ręczna rejestracja partiali (na wypadek gdyby loadTemplates w AppV2 tego nie robiło globalnie)
    for (const path of templates) {
        if (path.includes("/parts/")) {
            const template = await getTemplate(path);
            Handlebars.registerPartial(path, template);
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
        name: "NEUROSHIMA.Actions.StartMeleeOpposed",
        icon: '<i class="fas fa-swords"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const flags = message?.getFlag("neuroshima", "rollData");
            const messageType = message?.getFlag("neuroshima", "messageType");
            return flags?.isWeapon && flags.isMelee && game.user.isGM;
        },
        callback: async li => {
            const message = game.messages.get(li.dataset.messageId);
            const targets = Array.from(game.user.targets);
            if (targets.length === 0) {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoTargetSelected"));
                return;
            }
            
            for (const target of targets) {
                if (target.actor) {
                    await NeuroshimaChatMessage.createOpposedHandler(message, target.actor);
                }
            }
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

    // Przycisk Start Vanilla Melee
    card.querySelectorAll(".start-vanilla-melee").forEach(btn => {
        btn.addEventListener("click", async (event) => {
            event.preventDefault();
            const rollData = message.getFlag("neuroshima", "rollData");
            if (!rollData) return;

            const attacker = game.actors.get(rollData.actorId);
            
            // 1. Spróbuj znaleźć obrońcę w danych rzutu
            let defender = null;
            const targetUuid = rollData.targets?.[0];
            if (targetUuid) {
                const targetDoc = await fromUuid(targetUuid);
                defender = targetDoc?.actor || targetDoc;
            }

            // 2. Jeśli nie ma w rzucie, weź aktualnie namierzony cel (User Targets)
            if (!defender) {
                const userTarget = Array.from(game.user.targets)[0];
                defender = userTarget?.actor;
            }

            if (attacker && defender) {
                await CombatHelper.startVanillaMelee(attacker, defender);
            } else {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoMeleeTarget"));
            }
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

// Socket handlers dla leczenia ran (tylko GM)
Hooks.on("ready", () => {
    game.socket.on("system.neuroshima", async (data) => {
        if (!game.user.isGM) return;
        
        game.neuroshima?.group(`Socket | ${data.type}`);
        
        try {
            if (data.type === "heal.apply") {
                game.neuroshima?.log("Otrzymanie żądania leczenia od medyka", {
                    patientRef: data.patientRef,
                    medicRef: data.medicRef,
                    woundId: data.woundId,
                    action: data.action,
                    sessionId: data.sessionId
                });
                
                // Ponowny resolve refs po stronie GM (Security)
                const { actor: patientActor } = await game.neuroshima.resolveRef(data.patientRef);
                const { actor: medicActor } = await game.neuroshima.resolveRef(data.medicRef);

                if (!patientActor) {
                    game.neuroshima?.error("Socket heal.apply: Nie znaleziono aktora pacjenta", data.patientRef);
                    return;
                }

                // Opcjonalna walidacja sesji jeśli sessionId zostało przekazane
                if (data.sessionId) {
                    const message = game.messages.find(m => m.getFlag("neuroshima", "sessionId") === data.sessionId);
                    if (message) {
                        const messageMedicRef = message.getFlag("neuroshima", "medicRef");
                        if (messageMedicRef && messageMedicRef.uuid !== data.medicRef?.uuid) {
                             game.neuroshima?.error("Socket heal.apply: Medyk nie zgadza się z sesją", {
                                 sessionMedic: messageMedicRef.uuid,
                                 requestMedic: data.medicRef?.uuid
                             });
                             return;
                        }
                    }
                }

                // Wykonaj leczenie
                await game.neuroshima.HealingApp.healWound(patientActor, data.woundId, data.action);
                
                // Feedback na czacie (opcjonalnie)
                if (medicActor) {
                    const wound = patientActor.items.get(data.woundId);
                    // Jeśli rany już nie ma, znaczy że została wyleczona całkowicie (usunięta)
                    const woundName = wound?.name || "Rana";
                    const actionLabel = game.i18n.localize(`NEUROSHIMA.HealingRequest.Action.${data.action}`);
                    
                    ui.notifications.info(game.i18n.format("NEUROSHIMA.HealingRequest.WoundHealedBy", {
                        wound: woundName,
                        medic: medicActor.name,
                        action: actionLabel
                    }));
                }
            } else if (data.type === "opposed.setPending") {
                game.neuroshima?.log("Otrzymanie żądania ustawienia flagi pending", data);
                const actor = await fromUuid(data.actorUuid);
                if (actor) {
                    if (data.clearExisting) {
                        const pending = actor.getFlag("neuroshima", "opposedPending") || {};
                        const updates = {};
                        for (const id of Object.keys(pending)) {
                            updates[`flags.neuroshima.opposedPending.-=${id}`] = null;
                        }
                        if (Object.keys(updates).length > 0) await actor.update(updates);
                    }
                    await actor.setFlag("neuroshima", "opposedPending", { [data.flagData.requestId]: data.flagData });
                }
            } else if (data.type === "opposed.clearPending") {
                game.neuroshima?.log("Otrzymanie żądania usunięcia flagi pending", data);
                const actor = await fromUuid(data.actorUuid);
                if (actor) {
                    await actor.update({ [`flags.neuroshima.opposedPending.-=${data.requestId}`]: null });
                }
            } else if (data.type === "opposed.resolve") {
                game.neuroshima?.log("Otrzymanie żądania rozstrzygnięcia testu przeciwstawnego", data);
                const handlerMessage = game.messages.get(data.handlerMessageId);
                if (handlerMessage) {
                    await NeuroshimaChatMessage.resolveOpposed(null, handlerMessage, { defenseMessageId: data.defenseMessageId });
                }
            } else if (data.type === "selectMeleeDie") {
                if (!game.user.isGM) return;
                const combat = game.combats.get(data.combatId);
                if (combat) {
                    await game.neuroshima.CombatHelper.selectMeleeDie(combat, data.side, data.index);
                }
            }
        } catch (err) {
            game.neuroshima?.error(`Błąd podczas obsługi socketu ${data.type}:`, err);
        } finally {
            game.neuroshima?.groupEnd();
        }
    });
});

// Rejestracja globalnych hooków dla odświeżania interfejsu
Hooks.on("updateCombat", (combat, changed, options, userId) => {
    if (changed.flags?.neuroshima?.melee) {
        if (game.neuroshima.meleePanel?.rendered) {
            game.neuroshima.meleePanel.render();
        }
    }
});

Hooks.on("targetToken", (user) => {
    if (user.id === game.user.id) refreshAllCombatCards();
});

Hooks.on("controlToken", () => {
    refreshAllCombatCards();
});

// Automatyczne linkowanie rzutów do oczekujących testów przeciwstawnych
Hooks.on("createChatMessage", async (message, options, userId) => {
    console.log("Neuroshima | createChatMessage Hook triggered", { messageId: message.id, userId });
    if (userId !== game.user.id) return;
    
    const rollData = message.getFlag("neuroshima", "rollData");
    if (!rollData || !rollData.actorId) {
        console.log("Neuroshima | createChatMessage - No rollData or actorId, skipping automation");
        return;
    }
    
    const actor = game.actors.get(rollData.actorId);
    if (!actor) {
        console.log("Neuroshima | createChatMessage - Actor not found:", rollData.actorId);
        return;
    }
    
    const pendingOpposed = actor.getFlag("neuroshima", "opposedPending") || {};
    const requestIds = Object.keys(pendingOpposed);
    console.log("Neuroshima | createChatMessage - Pending opposed tests:", requestIds);
    
    if (requestIds.length > 0) {
        // Melee zawsze 1v1 - bierzemy pierwszy (i jedyny) oczekujący test
        const requestId = requestIds[0];
        const pendingData = pendingOpposed[requestId];
        const handlerMessage = game.messages.get(pendingData.handlerMessageId);
        
        console.log("Neuroshima | createChatMessage - Linked handler found:", { 
            handlerId: pendingData.handlerMessageId, 
            exists: !!handlerMessage 
        });

        if (handlerMessage) {
            const opposedData = handlerMessage.getFlag("neuroshima", "opposedData");
            console.log("Neuroshima | createChatMessage - Opposed data status:", opposedData?.status);
            
            if (opposedData && opposedData.status === "waiting") {
                // Linkuj ten rzut jako rzut obronny i od razu rozwiąż
                console.log("Neuroshima | createChatMessage - Auto-resolving opposed test", { requestId, messageId: message.id });
                
                try {
                    // Rozwiązujemy test automatycznie
                    await NeuroshimaChatMessage.resolveOpposed(null, handlerMessage, { defenseMessageId: message.id });
                    console.log("Neuroshima | createChatMessage - Auto-resolve finished");
                    ui.notifications.info(game.i18n.localize("NEUROSHIMA.MeleeOpposed.LinkedToTest"));
                } catch (err) {
                    console.error("Neuroshima | Error in auto-resolve hook:", err);
                }
            }
        }
    }
});
