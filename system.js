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
import { buildRef, resolveRef } from "./module/helpers/refs.js";
import { EncumbranceConfig } from "./module/apps/encumbrance-config.js";
import { CombatConfig } from "./module/apps/combat-config.js";
import { HealingConfig } from "./module/apps/healing-config.js";
import { DebugRollDialog } from "./module/apps/debug-roll-dialog.js";
import { EditRollDialog } from "./module/apps/edit-roll-dialog.js";
import { NeuroshimaInitiativeRollDialog } from "./module/apps/initiative-roll-dialog.js";
import { HealingApp } from "./module/apps/healing-app.js";
import { showHealingRollDialog } from "./module/apps/healing-roll-dialog.js";

import { NeuroshimaMeleeDuel } from "./module/combat/melee-duel.js";
import { NeuroshimaMeleeDuelSockets } from "./module/combat/melee-duel-sockets.js";
import { NeuroshimaMeleeDuelResolver } from "./module/combat/melee-duel-resolver.js";

// Inicjalizacja systemu Neuroshima 1.5
Hooks.once('init', async function() {
    console.log('Neuroshima 1.5 | Inicjalizacja systemu');

    // Przypisanie niestandardowych klas i stałych (bezpieczne merge, aby nie usunąć socketu)
    game.neuroshima = Object.assign(game.neuroshima || {}, {
        NeuroshimaActor,
        NeuroshimaItem,
        NeuroshimaChatMessage,
        NeuroshimaMeleeDuel,
        NeuroshimaMeleeDuelSockets,
        NeuroshimaMeleeDuelResolver,
        NeuroshimaInitiativeRollDialog,
        NeuroshimaDice,
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
    Handlebars.registerHelper('inc', (v) => Number(v) + 1);
    Handlebars.registerHelper('ifThen', (c, a, b) => c ? a : b);

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

    // Ukrywanie przycisków w starciach w zwarciu (Opposed Melee)
    const meleeDuel = html.querySelector(".melee-opposed-handler");
    if (meleeDuel) {
        const duelFlag = message.getFlag("neuroshima", "meleeDuel");
        if (duelFlag) {
            const attackerUuid = duelFlag.attacker?.actorUuid;
            const defenderUuid = duelFlag.defender?.actorUuid;
            
            const attackerActor = attackerUuid ? fromUuidSync(attackerUuid) : null;
            const defenderActor = defenderUuid ? fromUuidSync(defenderUuid) : null;
            
            const isAttacker = game.user.isGM || attackerActor?.isOwner;
            const isDefender = game.user.isGM || defenderActor?.isOwner;
            
            // Jeśli nie jest atakującym, ukryj jego kontrolki
            if (!isAttacker) {
                html.querySelectorAll('.die-mod[data-side="attacker"]').forEach(b => b.style.display = "none");
                html.querySelectorAll('.ready-button[data-role="attacker"]').forEach(b => b.style.display = "none");
                html.querySelectorAll('.reset-pool-button[data-role="attacker"]').forEach(b => b.style.display = "none");
                html.querySelectorAll('.pool-line[data-role="attacker"]').forEach(b => b.style.display = "none");
                html.querySelectorAll('[data-action="select-die"][data-side="attacker"]').forEach(el => el.classList.remove('interactive'));
            }
            
            // Jeśli nie jest obrońcą, ukryj jego kontrolki
            if (!isDefender) {
                html.querySelectorAll('.die-mod[data-side="defender"]').forEach(b => b.style.display = "none");
                html.querySelectorAll('.ready-button[data-role="defender"]').forEach(b => b.style.display = "none");
                html.querySelectorAll('.reset-pool-button[data-role="defender"]').forEach(b => b.style.display = "none");
                html.querySelectorAll('.pool-line[data-role="defender"]').forEach(b => b.style.display = "none");
                html.querySelectorAll('[data-action="select-die"][data-side="defender"]').forEach(el => el.classList.remove('interactive'));
                
                // Przycisk dołączania do walki powinien być widoczny dla osób będących celem
                const joinBtn = html.querySelector('.join-duel-button');
                if (joinBtn) {
                    const targets = duelFlag.attackerTargets || [];
                    const isTarget = targets.some(t => {
                        const tUuid = typeof t === 'string' ? t : t.uuid;
                        const tActor = fromUuidSync(tUuid);
                        return tActor?.isOwner;
                    });
                    if (!isTarget && !game.user.isGM) {
                        joinBtn.style.display = "none";
                    }
                }
            }

            // Kontrolki segmentów (ukrywaj jeśli nie twoja kolej lub rola)
            const isActive = (duelFlag.initiative === "attacker" && isAttacker) || (duelFlag.initiative === "defender" && isDefender);
            if (!isActive && !game.user.isGM) {
                html.querySelectorAll('.active-controls').forEach(el => el.style.display = "none");
            }

            const isResponder = (duelFlag.initiative === "attacker" && isDefender) || (duelFlag.initiative === "defender" && isAttacker);
            if (!isResponder && !game.user.isGM) {
                html.querySelectorAll('.responder-controls').forEach(el => el.style.display = "none");
            }

            // Przejmowanie inicjatywy (tylko dla pasywnej strony)
            if (isActive && !game.user.isGM) {
                html.querySelectorAll('.takeover-ui').forEach(el => el.style.display = "none");
            }

            // Przycisk rozstrzygnięcia widoczny tylko dla GM
            const resolveBtn = html.querySelector('.resolve-duel-button');
            if (resolveBtn && !game.user.isGM) {
                resolveBtn.style.display = "none";
            }
        }
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
    
    // Melee Duel functions
    game.neuroshima.socket.register("setPending", NeuroshimaMeleeDuelSockets._onSetPending);
    game.neuroshima.socket.register("clearPending", NeuroshimaMeleeDuelSockets._onClearPending);
    game.neuroshima.socket.register("modifyMeleeDie", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            // Walidacja uprawnień (GM side)
            const state = duel.state;
            const actorUuid = data.side === "attacker" ? state.attacker.actorUuid : state.defender.actorUuid;
            const actorDoc = await fromUuid(actorUuid);
            const actor = actorDoc?.actor || actorDoc;
            
            // Pobierz ID użytkownika wysyłającego żądanie
            const userId = this.socketdata.userId;
            const user = game.users.get(userId);

            // Tylko GM lub właściciel aktora może modyfikować
            if (user?.isGM || actor?.testUserPermission(user, "OWNER")) {
                await duel.modifyDie(data.side, data.target, data.index, data.delta);
            } else {
                console.warn(`Neuroshima 1.5 | Brak uprawnień użytkownika ${userId} do roli ${data.side}`);
            }
        }
    });

    game.neuroshima.socket.register("resetMeleePool", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            const state = duel.state;
            const actorUuid = data.role === "attacker" ? state.attacker.actorUuid : state.defender.actorUuid;
            const actorDoc = await fromUuid(actorUuid);
            const actor = actorDoc?.actor || actorDoc;

            const userId = this.socketdata.userId;
            const user = game.users.get(userId);

            if (user?.isGM || actor?.testUserPermission(user, "OWNER")) {
                await duel.resetPool(data.role);
            }
        }
    });

    game.neuroshima.socket.register("toggleMeleeReady", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            const state = duel.state;
            const actorUuid = data.role === "attacker" ? state.attacker.actorUuid : state.defender.actorUuid;
            const actorDoc = await fromUuid(actorUuid);
            const actor = actorDoc?.actor || actorDoc;

            const userId = this.socketdata.userId;
            const user = game.users.get(userId);

            if (user?.isGM || actor?.testUserPermission(user, "OWNER")) {
                await duel.toggleReady(data.role);
            }
        }
    });

    game.neuroshima.socket.register("joinMeleeDuel", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            const actorDoc = await fromUuid(data.defenderData.actorUuid);
            const actor = actorDoc?.actor || actorDoc;
            
            const userId = this.socketdata.userId;
            const user = game.users.get(userId);

            if (user?.isGM || actor?.testUserPermission(user, "OWNER")) {
                await duel.joinDefender(actor, data.defenderData.rollData, data.defenderData.weaponId);
            }
        }
    });

    game.neuroshima.socket.register("rollMeleeInitiative", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            await duel.rollInitiative(data.role);
        }
    });

    game.neuroshima.socket.register("updateMeleeInitiative", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            await duel.updateInitiative(data.role, data.rollResult);
        }
    });

    game.neuroshima.socket.register("resolveMeleeDuel", NeuroshimaMeleeDuelSockets._onResolve);
    game.neuroshima.socket.register("applyMeleeDamage", NeuroshimaMeleeDuelSockets._onApplyDamage);
    
    // Healing functions
    game.neuroshima.socket.register("applyHealing", async (data) => {
        const { actor: patientActor } = await game.neuroshima.resolveRef(data.patientRef);
        if (!patientActor) return;
        
        await game.neuroshima.HealingApp.healWound(patientActor, data.woundId, data.action);
        
        const medicActor = data.medicRef ? (await game.neuroshima.resolveRef(data.medicRef))?.actor : null;
        if (medicActor) {
            const wound = patientActor.items.get(data.woundId);
            const woundName = wound?.name || "Rana";
            const actionLabel = game.i18n.localize(`NEUROSHIMA.HealingRequest.Action.${data.action}`);
            
            ui.notifications.info(game.i18n.format("NEUROSHIMA.HealingRequest.WoundHealedBy", {
                wound: woundName,
                medic: medicActor.name,
                action: actionLabel
            }));
        }
    });

    game.neuroshima.socket.register("selectMeleeDie", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            const state = duel.state;
            const actorUuid = data.role === "attacker" ? state.attacker.actorUuid : state.defender.actorUuid;
            const actorDoc = await fromUuid(actorUuid);
            const actor = actorDoc?.actor || actorDoc;

            const userId = this.socketdata.userId;
            const user = game.users.get(userId);

            if (user?.isGM || actor?.testUserPermission(user, "OWNER")) {
                await duel.selectDie(data.role, data.index);
            }
        }
    });

    game.neuroshima.socket.register("declareMeleeAction", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            const state = duel.state;
            const role = data.role; // attacker/defender
            const actorUuid = role === "attacker" ? state.attacker.actorUuid : state.defender.actorUuid;
            const actorDoc = await fromUuid(actorUuid);
            const actor = actorDoc?.actor || actorDoc;

            const userId = this.socketdata.userId;
            const user = game.users.get(userId);

            if (user?.isGM || actor?.testUserPermission(user, "OWNER")) {
                await duel.declareAction(role, data.type);
            }
        }
    });

    game.neuroshima.socket.register("respondMeleeAction", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            const state = duel.state;
            if (!state.currentAction) return;

            const responderRole = state.currentAction.side === "attacker" ? "defender" : "attacker";
            const actorUuid = responderRole === "attacker" ? state.attacker.actorUuid : state.defender.actorUuid;
            const actorDoc = await fromUuid(actorUuid);
            const actor = actorDoc?.actor || actorDoc;

            const userId = this.socketdata.userId;
            const user = game.users.get(userId);

            if (user?.isGM || actor?.testUserPermission(user, "OWNER")) {
                await duel.respondToAction(data.response);
            }
        }
    });

    game.neuroshima.socket.register("takeoverMeleeInitiative", async function(data) {
        const message = game.messages.get(data.messageId);
        if (!message) return;
        const duel = NeuroshimaMeleeDuel.fromMessage(message);
        if (duel) {
            const state = duel.state;
            // Przejęcie może zrobić tylko ten, kto NIE MA obecnie inicjatywy
            const roleToTakeover = state.initiative === "attacker" ? "defender" : "attacker";
            const actorUuid = roleToTakeover === "attacker" ? state.attacker.actorUuid : state.defender.actorUuid;
            const actorDoc = await fromUuid(actorUuid);
            const actor = actorDoc?.actor || actorDoc;

            const userId = this.socketdata.userId;
            const user = game.users.get(userId);

            if (user?.isGM || actor?.testUserPermission(user, "OWNER")) {
                await duel.takeoverInitiative();
            }
        }
    });

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
