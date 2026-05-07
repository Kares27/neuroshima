import { NEUROSHIMA } from "./module/config.js";
import { NeuroshimaActor } from "./module/documents/actor.js";
import { NeuroshimaCombat } from "./module/documents/combat.js";
import { NeuroshimaCombatant } from "./module/documents/combatant.js";
import { NeuroshimaItem } from "./module/documents/item.js";
import { NeuroshimaChatMessage } from "./module/documents/chat-message.js";
import { NeuroshimaActiveEffect } from "./module/documents/active-effect.js";
import { NeuroshimaActorData, NeuroshimaNPCData, NeuroshimaCreatureData, NeuroshimaVehicleData } from "./module/data/actor-data.js";
import { WeaponData, ArmorData, GearData, AmmoData, MagazineData, TrickData, TraitData, WoundData, BeastActionData, SpecializationData, OriginData, ProfessionData, VehicleDamageData, VehicleModData, MoneyData, ReputationData } from "./module/data/item-data.js";
import { NeuroshimaActorSheet } from "./module/sheets/actor-sheet.js";
import { NeuroshimaNPCSheet } from "./module/sheets/npc-sheet.js";
import { NeuroshimaCreatureSheet } from "./module/sheets/creature-sheet.js";
import { NeuroshimaVehicleSheet } from "./module/sheets/vehicle-sheet.js";
import { NeuroshimaItemSheet } from "./module/sheets/item-sheet.js";
import { NeuroshimaEffectSheet } from "./module/sheets/neuroshima-effect-sheet.js";
import { NeuroshimaScriptRunner } from "./module/apps/neuroshima-script-engine.js";
import { NeuroshimaDice } from "./module/helpers/dice.js";
import { CombatHelper } from "./module/helpers/combat-helper.js";
import { NeuroshimaMeleeCombat } from "./module/combat/melee-combat.js";
import { buildRef, resolveRef } from "./module/helpers/refs.js";
import { EncumbranceConfig } from "./module/apps/encumbrance-config.js";
import { CombatConfig } from "./module/apps/combat-config.js";
import { DistanceConfig, DEFAULT_DISTANCE_PENALTIES } from "./module/apps/distance-config.js";
import { HealingConfig } from "./module/apps/healing-config.js";
import { ConditionConfig, applyConditionsToStatusEffects } from "./module/apps/condition-config.js";
import { ReputationSettingsApp } from "./module/apps/reputation-settings.js";
import { DebugRollDialog } from "./module/apps/debug-roll-dialog.js";
import { EditRollDialog } from "./module/apps/edit-roll-dialog.js";
import { NeuroshimaInitiativeRollDialog } from "./module/apps/initiative-roll-dialog.js";
import { HealingApp } from "./module/apps/healing-app.js";
import { showHealingRollDialog } from "./module/apps/healing-roll-dialog.js";
import { TraitBrowserApp } from "./module/apps/trait-browser.js";

import { NeuroshimaCombatTracker } from "./module/combat/combat-tracker.js";
import { MeleeCombatApp } from "./module/apps/melee-combat-app.js";

// Inicjalizacja systemu Neuroshima 1.5
Hooks.once('init', async function() {
    console.log('Neuroshima 1.5 | Inicjalizacja systemu');

    CONFIG.ui.combat = NeuroshimaCombatTracker;
    MeleeCombatApp.registerHooks();

    const _isActorSheet = (app) => app instanceof NeuroshimaActorSheet || app instanceof NeuroshimaCreatureSheet;

    // Hook to re-render actor sheets when combat updates (for melee pendings)
    Hooks.on("updateCombat", (combat, updates, options, userId) => {
        Object.values(ui.windows).forEach(app => {
            if (_isActorSheet(app)) app.render(false);
        });
    });

    // Hide GM-only elements in chat messages for non-GM users
    Hooks.on("renderChatMessage", (message, html) => {
        // Normalize: html may be an HTMLElement (v13 AppV2) or a jQuery object (legacy paths)
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;

        if (!game.user.isGM) {
            root.querySelectorAll("[data-gm-only]").forEach(el => { el.style.display = "none"; });
            return;
        }

        // Beast action spending — quantity +/− buttons and apply button (GM only)
        const spending = root.querySelector(".beast-action-spending");
        if (!spending) return;

        const maxSuccesses = parseInt(spending.dataset.netSuccesses ?? "0", 10);
        const quantities   = {}; // actionId → count

        function recalc() {
            let spent = 0;
            for (const [id, qty] of Object.entries(quantities)) {
                const row  = spending.querySelector(`.beast-action-row[data-action-id="${id}"]`);
                const cost = parseInt(row?.dataset.actionCost ?? "1", 10);
                spent += cost * qty;
            }
            spending.querySelector(".spent-value").textContent = spent;

            // Disable + buttons that would exceed the budget
            spending.querySelectorAll(".beast-qty-plus").forEach(btn => {
                const id   = btn.dataset.actionId;
                const cost = parseInt(btn.dataset.cost ?? "1", 10);
                const cur  = quantities[id] ?? 0;
                btn.disabled = (spent + cost) > maxSuccesses;
            });

            // Enable apply button only when something is selected
            const applyBtn = spending.querySelector(".apply-beast-actions-btn");
            if (applyBtn) applyBtn.disabled = spent === 0;
        }

        spending.querySelectorAll(".beast-qty-plus").forEach(btn => {
            btn.addEventListener("click", () => {
                const id   = btn.dataset.actionId;
                const cost = parseInt(btn.dataset.cost ?? "1", 10);
                let spent  = 0;
                for (const [bid, qty] of Object.entries(quantities)) {
                    const brow = spending.querySelector(`.beast-action-row[data-action-id="${bid}"]`);
                    spent += parseInt(brow?.dataset.actionCost ?? "1", 10) * qty;
                }
                if (spent + cost > maxSuccesses) return;
                quantities[id] = (quantities[id] ?? 0) + 1;
                spending.querySelector(`.beast-qty-value[data-action-id="${id}"]`).textContent = quantities[id];
                recalc();
            });
        });

        spending.querySelectorAll(".beast-qty-minus").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.actionId;
                if ((quantities[id] ?? 0) <= 0) return;
                quantities[id] -= 1;
                spending.querySelector(`.beast-qty-value[data-action-id="${id}"]`).textContent = quantities[id];
                recalc();
            });
        });

        spending.querySelector(".apply-beast-actions-btn")?.addEventListener("click", async () => {
            const selected = [];
            for (const [id, qty] of Object.entries(quantities)) {
                for (let i = 0; i < qty; i++) selected.push(id);
            }
            if (!selected.length) return;
            const { MeleeOpposedChat } = await import("./module/combat/melee-opposed-chat.js");
            await MeleeOpposedChat.applyBeastActions(message.id, selected);
            spending.querySelector(".apply-beast-actions-btn").disabled = true;
            spending.querySelector(".apply-beast-actions-btn").textContent = "✓ Zastosowano";
        });

        recalc();
    });

    // Re-render all open actor sheets when an opposed chat message is resolved/cancelled.
    // This clears pending attacker/defender cards on BOTH clients (attacker and defender)
    // without relying on the combat flag propagation which can be delayed on non-GM clients.
    Hooks.on("updateChatMessage", (message) => {
        const opposedData = message.getFlag("neuroshima", "opposedChat");
        if (!opposedData) return;
        if (opposedData.status !== "resolved" && opposedData.status !== "cancelled") return;
        Object.values(ui.windows).forEach(app => {
            if (_isActorSheet(app)) app.render(false);
        });
    });

    // Script triggers: combat lifecycle
    Hooks.on("combatStart", async (combat) => {
        if (!game.user.isGM) return;
        await NeuroshimaScriptRunner.runStartCombat(combat);
    });

    Hooks.on("combatTurnChange", async (combat, prior, current) => {
        if (!game.user.isGM) return;
        const priorCombatant = prior ? combat.combatants.get(prior.combatantId) : null;
        const currentCombatant = current ? combat.combatants.get(current.combatantId) : null;
        if (priorCombatant) await NeuroshimaScriptRunner.runEndTurn(combat, priorCombatant);
        await NeuroshimaScriptRunner.expireEffects(combat);
        if (currentCombatant) await NeuroshimaScriptRunner.runStartTurn(combat, currentCombatant);
    });

    Hooks.on("combatRound", async (combat, updates, options) => {
        if (!game.user.isGM) return;
        if (options?.direction === 1 || updates?.round > (options?.previousRound ?? 0)) {
            await NeuroshimaScriptRunner.expireEffects(combat);
            await NeuroshimaScriptRunner.runStartRound(combat);
        } else {
            await NeuroshimaScriptRunner.runEndRound(combat);
        }
    });

    // Cleanup melee flags on combat delete
    Hooks.on("deleteCombat", async (combat) => {
        if (game.user.isGM) await NeuroshimaScriptRunner.runEndCombat(combat);
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
        NeuroshimaScriptRunner,
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
    CONFIG.ActiveEffect.documentClass = NeuroshimaActiveEffect;

    // Inicjatywa
    CONFIG.Combat.initiative.formula = "0";

    // Rejestracja modeli danych
    CONFIG.Actor.dataModels.character = NeuroshimaActorData;
    CONFIG.Actor.dataModels.npc      = NeuroshimaNPCData;
    CONFIG.Actor.dataModels.creature = NeuroshimaCreatureData;
    CONFIG.Actor.dataModels.vehicle  = NeuroshimaVehicleData;
    CONFIG.Item.dataModels.weapon = WeaponData;
    CONFIG.Item.dataModels.armor = ArmorData;
    CONFIG.Item.dataModels.gear = GearData;
    CONFIG.Item.dataModels.ammo = AmmoData;
    CONFIG.Item.dataModels.magazine = MagazineData;
    CONFIG.Item.dataModels.trick = TrickData;
    CONFIG.Item.dataModels.trait = TraitData;
    CONFIG.Item.dataModels.wound = WoundData;
    CONFIG.Item.dataModels["beast-action"]      = BeastActionData;
    CONFIG.Item.dataModels["specialization"]    = SpecializationData;
    CONFIG.Item.dataModels["origin"]            = OriginData;
    CONFIG.Item.dataModels["profession"]        = ProfessionData;
    CONFIG.Item.dataModels["vehicle-damage"]    = VehicleDamageData;
    CONFIG.Item.dataModels["vehicle-mod"]       = VehicleModData;
    CONFIG.Item.dataModels["money"]             = MoneyData;
    CONFIG.Item.dataModels["reputation"]        = ReputationData;

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
    Handlebars.registerHelper('neuroshimaRollTooltip', (rollData) => {
        return NeuroshimaDice.buildRollTooltip(rollData);
    });
    Handlebars.registerHelper('neuroshimaDiceTooltip', (modifiedResults, target, skill) => {
        if (!modifiedResults?.length) return "";
        const dice = modifiedResults.map((d, i) => {
            const cls = d.ignored ? "ignored" : (d.isSuccess ? "success" : "failure");
            const nat = d.isNat1 ? " nat-1" : (d.isNat20 ? " nat-20" : "");
            let html = `<div class="die-result ${cls}">`;
            html += `<span class="die-label">D${i + 1}=</span>`;
            html += `<span class="die-square original${nat}">${d.original}</span>`;
            if (skill > 0) {
                html += `<i class="fas fa-long-arrow-alt-right" style="font-size:0.7em;margin:0 2px;"></i>`;
                html += `<span class="die-square modified ${cls}">${d.modified}</span>`;
            }
            html += `</div>`;
            return html;
        }).join("");
        const successCount = modifiedResults.filter(d => d.isSuccess).length;
        const targetLabel = game.i18n.localize("NEUROSHIMA.Roll.Target");
        const spLabel = game.i18n.localize("NEUROSHIMA.Roll.SuccessPointsAbbr");
        return `<div class="neuroshima-dice-tooltip">`
            + `<div class="dice-results-grid" style="gap:2px;">${dice}</div>`
            + `<div style="margin-top:4px;font-size:0.85em;"><strong>${targetLabel}:</strong> ${target} &nbsp;`
            + `<strong>${spLabel}:</strong> ${successCount}</div></div>`;
    });
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
    foundry.documents.collections.Actors.registerSheet("neuroshima", NeuroshimaNPCSheet, {
        types: ["npc"],
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.ActorNPC"
    });
    foundry.documents.collections.Actors.registerSheet("neuroshima", NeuroshimaCreatureSheet, {
        types: ["creature"],
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.ActorCreature"
    });
    foundry.documents.collections.Actors.registerSheet("neuroshima", NeuroshimaVehicleSheet, {
        types: ["vehicle"],
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.ActorVehicle"
    });

    foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
    foundry.documents.collections.Items.registerSheet("neuroshima", NeuroshimaItemSheet, {
        types: ["weapon", "armor", "gear", "trick", "trait", "ammo", "magazine", "wound", "beast-action", "specialization", "origin", "profession", "vehicle-damage", "vehicle-mod", "money", "reputation"],
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.Item"
    });

    foundry.applications.apps.DocumentSheetConfig.unregisterSheet(ActiveEffect, "core", foundry.applications.sheets.ActiveEffectConfig);
    foundry.applications.apps.DocumentSheetConfig.registerSheet(ActiveEffect, "neuroshima", NeuroshimaEffectSheet, {
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.Effect"
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
        default: true,
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
    
    game.settings.register("neuroshima", "itemCardPreventSelfTake", {
        name: "NEUROSHIMA.Settings.ItemCardPreventSelfTake.Name",
        hint: "NEUROSHIMA.Settings.ItemCardPreventSelfTake.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
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
        config: false,
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

    game.settings.register("neuroshima", "unjamMinRole", {
        name: "NEUROSHIMA.Settings.UnjamMinRole.Name",
        scope: "world",
        config: false,
        type: Number,
        default: 4
    });

    game.settings.register("neuroshima", "fireCorrection", {
        name: "NEUROSHIMA.Settings.FireCorrection.Name",
        hint: "NEUROSHIMA.Settings.FireCorrection.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        requiresReload: false
    });

    game.settings.register("neuroshima", "distancePenalties", {
        scope: "world",
        config: false,
        type: Object,
        default: DEFAULT_DISTANCE_PENALTIES
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

    game.settings.registerMenu("neuroshima", "distanceConfig", {
        name: "NEUROSHIMA.Settings.DistanceConfig.Label",
        label: "NEUROSHIMA.Settings.DistanceConfig.Title",
        hint: "NEUROSHIMA.Settings.DistanceConfig.MenuHint",
        icon: "fas fa-ruler-horizontal",
        type: DistanceConfig,
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

    game.settings.registerMenu("neuroshima", "conditionConfig", {
        name: "NEUROSHIMA.Settings.ConditionConfig.Label",
        label: "NEUROSHIMA.Settings.ConditionConfig.Title",
        hint: "NEUROSHIMA.Settings.ConditionConfig.MenuHint",
        icon: "fas fa-virus",
        type: ConditionConfig,
        restricted: true
    });

    game.settings.register("neuroshima", "conditions", {
        scope: "world",
        config: false,
        type: Object,
        default: []
    });

    game.settings.registerMenu("neuroshima", "reputationConfig", {
        name: "NEUROSHIMA.Settings.ReputationConfig.Label",
        label: "NEUROSHIMA.Settings.ReputationConfig.Title",
        hint: "NEUROSHIMA.Settings.ReputationConfig.Hint",
        icon: "fas fa-handshake",
        type: ReputationSettingsApp,
        restricted: true
    });

    game.settings.register("neuroshima", "reputationTestMode", {
        name: "NEUROSHIMA.Settings.ReputationTestMode.Name",
        hint: "NEUROSHIMA.Settings.ReputationTestMode.Hint",
        scope: "world",
        config: false,
        type: String,
        choices: {
            "skill": "NEUROSHIMA.Settings.ReputationTestMode.Skill",
            "simple": "NEUROSHIMA.Settings.ReputationTestMode.Simple"
        },
        default: "skill"
    });

    game.settings.register("neuroshima", "reputationMin", {
        name: "NEUROSHIMA.Settings.ReputationMin.Name",
        scope: "world",
        config: false,
        type: Number,
        default: 0
    });

    game.settings.register("neuroshima", "reputationMax", {
        name: "NEUROSHIMA.Settings.ReputationMax.Name",
        scope: "world",
        config: false,
        type: Number,
        default: 20
    });

    game.settings.register("neuroshima", "reputationUseColors", {
        name: "NEUROSHIMA.Settings.ReputationUseColors.Name",
        hint: "NEUROSHIMA.Settings.ReputationUseColors.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register("neuroshima", "reputationColorNames", {
        name: "NEUROSHIMA.Settings.ReputationColorNames.Name",
        hint: "NEUROSHIMA.Settings.ReputationColorNames.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register("neuroshima", "reputationRelationTable", {
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    game.settings.register("neuroshima", "reputationFameThreshold", {
        name: "NEUROSHIMA.Settings.ReputationFameThreshold.Name",
        scope: "world",
        config: false,
        type: Number,
        default: 20
    });

    game.settings.register("neuroshima", "reputationFamePoints", {
        name: "NEUROSHIMA.Settings.ReputationFamePoints.Name",
        scope: "world",
        config: false,
        type: Number,
        default: 1
    });

    game.settings.register("neuroshima", "reputationShowAsProgressBar", {
        name: "NEUROSHIMA.Settings.ReputationShowAsProgressBar.Name",
        hint: "NEUROSHIMA.Settings.ReputationShowAsProgressBar.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false
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

    // Nadpisz CONFIG.statusEffects naszymi stanami z ustawień
    applyConditionsToStatusEffects();

    // Wczytanie szablonów (v13 namespaced)
    const templates = [
        "systems/neuroshima/templates/actors/actor/parts/actor-header.hbs",
        "systems/neuroshima/templates/actors/creature/parts/creature-header.hbs",
        "systems/neuroshima/templates/actors/vehicle/parts/vehicle-header.hbs",
        "systems/neuroshima/templates/actors/npc/parts/npc-header.hbs",
        "systems/neuroshima/templates/actors/actor/parts/actor-info.hbs",
        "systems/neuroshima/templates/actors/actor/parts/actor-attributes.hbs",
        "systems/neuroshima/templates/actors/actor/parts/actor-skills.hbs",
        "systems/neuroshima/templates/actors/actor/parts/actor-tricks.hbs",
        "systems/neuroshima/templates/actors/actor/parts/actor-combat.hbs",
        "systems/neuroshima/templates/actors/actor/parts/actor-inventory.hbs",
        "systems/neuroshima/templates/actors/actor/parts/actor-notes.hbs",
        "systems/neuroshima/templates/actors/actor/parts/wounds-paper-doll.hbs",
        "systems/neuroshima/templates/actors/actor/parts/wounds-list.hbs",
        "systems/neuroshima/templates/item/item-sheet.hbs",
        "systems/neuroshima/templates/item/item-header.hbs",
        "systems/neuroshima/templates/item/item-details.hbs",
        "systems/neuroshima/templates/item/item-effects.hbs",
        "systems/neuroshima/templates/item/parts/weapon-melee.hbs",
        "systems/neuroshima/templates/item/parts/weapon-ranged.hbs",
        "systems/neuroshima/templates/item/parts/weapon-thrown.hbs",
        "systems/neuroshima/templates/item/parts/ammo-details.hbs",
        "systems/neuroshima/templates/item/parts/wound-details.hbs",
        "systems/neuroshima/templates/item/parts/vehicle-damage-details.hbs",
        "systems/neuroshima/templates/item/parts/vehicle-mod-details.hbs",
        "systems/neuroshima/templates/item/parts/magazine-details.hbs",
        "systems/neuroshima/templates/item/parts/ammunition-details.hbs",
        "systems/neuroshima/templates/apps/healing-config.hbs",
        "systems/neuroshima/templates/apps/healing-app-main.hbs",
        "systems/neuroshima/templates/apps/healing-app-header.hbs",
        "systems/neuroshima/templates/apps/encumbrance-config.hbs",
        "systems/neuroshima/templates/apps/edit-roll-dialog.hbs",
        "systems/neuroshima/templates/apps/debug-roll-dialog.hbs",
        "systems/neuroshima/templates/apps/combat-config.hbs",
        "systems/neuroshima/templates/apps/vehicle-crew-select-dialog.hbs",
        "systems/neuroshima/templates/apps/melee/melee-app.hbs",
        "systems/neuroshima/templates/apps/melee/parts/melee-top-bar.hbs",
        "systems/neuroshima/templates/apps/melee/parts/fighter-card.hbs",
        "systems/neuroshima/templates/apps/melee/parts/arena-center.hbs",
        "systems/neuroshima/templates/apps/melee/parts/melee-action-bar.hbs",
        "systems/neuroshima/templates/apps/melee/parts/combat-log.hbs",
        "systems/neuroshima/templates/apps/melee/parts/footer-danger.hbs",
        "systems/neuroshima/templates/apps/melee/parts/melee-gm-controls.hbs",
        "systems/neuroshima/templates/chat/weapon-roll-card.hbs",
        "systems/neuroshima/templates/chat/roll-card.hbs",
        "systems/neuroshima/templates/chat/patient-card.hbs",
        "systems/neuroshima/templates/chat/pain-resistance-report.hbs",
        "systems/neuroshima/templates/chat/rest-report.hbs",
        "systems/neuroshima/templates/chat/healing-roll-card.hbs",
        "systems/neuroshima/templates/chat/healing-request.hbs",
        "systems/neuroshima/templates/dialog/rest-dialog.hbs",
        "systems/neuroshima/templates/dialog/hp-config.hbs",
        "systems/neuroshima/templates/apps/effect-sheet-scripts.hbs",
        "systems/neuroshima/templates/apps/script-editor.hbs",
        "systems/neuroshima/templates/prosemirror/text-colour.hbs"
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

    // ── Token PIXI counter for numbered conditions ────────────────────────────
    // Mirrors WFRP4e's FoundryOverrides: override _drawEffects and _drawEffect
    // so that int-type conditions show their stack count on the token icon.

    foundry.canvas.placeables.Token.prototype._drawEffects = async function () {
        this.effects.renderable = false;
        this.effects.removeChildren().forEach(c => c.destroy());
        this.effects.bg = this.effects.addChild(new PIXI.Graphics());
        this.effects.bg.zIndex = -1;
        this.effects.overlay = null;

        const activeEffects = this.actor?.temporaryEffects ?? [];
        const overlayEffect = activeEffects.findLast(e => e.img && e.getFlag("core", "overlay"));

        const promises = [];
        for (const [i, effect] of activeEffects.entries()) {
            if (!effect.img) continue;
            const condValue = effect.getFlag("neuroshima", "conditionNumbered")
                ? (effect.getFlag("neuroshima", "conditionValue") ?? null)
                : null;
            const promise = effect === overlayEffect
                ? this._drawOverlay(effect.img, effect.tint)
                : this._drawEffect(effect.img, effect.tint, condValue);
            promises.push(promise.then(e => { if (e) e.zIndex = i; }));
        }
        await Promise.allSettled(promises);

        this.effects.sortChildren();
        this.effects.renderable = true;
        this.renderFlags.set({ refreshEffects: true });
    };

    foundry.canvas.placeables.Token.prototype._drawEffect = async function (src, tint, value) {
        if (!src) return;
        const tex = await foundry.canvas.loadTexture(src, { fallback: "icons/svg/hazard.svg" });
        const icon = new PIXI.Sprite(tex);
        icon.tint = tint ?? 0xFFFFFF;
        icon.scale.set(1.25);
        if (value) {
            const style = CONFIG.canvasTextStyle.clone();
            style.fontSize = 16;
            style.strokeThickness = 2;
            const text = new foundry.canvas.containers.PreciseText(String(value), style);
            text.scale.x = 12;
            text.scale.y = 12;
            text.x = icon.width * 0.58;
            text.y = icon.height * 0.55;
            icon.addChild(text);
        }
        return this.effects.addChild(icon);
    };

});

Hooks.once("ready", () => {
    if (typeof ProseMirrorMenu === "undefined") return;
    const _origOnAction = ProseMirrorMenu.prototype._onAction;
    ProseMirrorMenu.prototype._onAction = function(event) {
        const view = this.view;
        if (!view) return _origOnAction.call(this, event);
        const origFocus = view.focus.bind(view);
        view.focus = function(...args) {
            try { return origFocus(...args); } catch {}
        };
        try {
            return _origOnAction.call(this, event);
        } finally {
            view.focus = origFocus;
        }
    };
});

Hooks.on("getProseMirrorMenuItems", (menu, items) => {
    if (menu.view?.dom?.closest?.(".monks-journal-sheet, .journal-sheet.journal-entry-page")) return;

    if (!menu.schema.marks.nscolor) {
        const colorMarkSpec = {
            attrs: { color: {} },
            inclusive: true,
            parseDOM: [{ tag: "span", getAttrs: dom => ({ color: dom.style.color }) }],
            toDOM: (mark) => ["span", { style: `color: ${mark.attrs.color}` }]
        };
        try {
            const Schema = menu.schema.constructor;
            const extended = new Schema({
                nodes: menu.schema.spec.nodes,
                marks: menu.schema.spec.marks.append({ nscolor: colorMarkSpec })
            });
            menu.schema.marks.nscolor = extended.marks.nscolor;
        } catch (e) {
            game.neuroshima?.log("ProseMirror nscolor mark extension failed:", e);
            return;
        }
    }

    const scopes = menu.constructor._MENU_ITEM_SCOPES;
    items.push({
        action: "ns-text-colour",
        title: game.i18n.localize("NEUROSHIMA.ProseMirror.FontColor"),
        icon: '<i class="fas fa-palette fa-fw"></i>',
        scope: scopes?.BOTH ?? "both",
        cmd: _nsChangeTextColourPrompt.bind(menu)
    });
});

function _nsRgbToHex(rgb) {
    if (!rgb) return null;
    if (rgb.startsWith("#")) return rgb;
    const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    return "#" + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, "0")).join("");
}

async function _nsChangeTextColourPrompt() {
    const state = this.view.state;
    const { $from, $to } = state.selection;
    const mark = this.schema.marks.nscolor;
    if (!mark) return;

    const editorDefaultColor = _nsRgbToHex(window.getComputedStyle(this.view.dom).color) ?? "#000000";
    let data = { color: editorDefaultColor };

    try {
        const { node } = this.view.domAtPos($from.pos);
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (el) {
            const computed = _nsRgbToHex(window.getComputedStyle(el).color);
            if (computed) data.color = computed;
        }
    } catch {}

    const dialog = await this._showDialog(
        "ns-text-colour",
        "systems/neuroshima/templates/prosemirror/text-colour.hbs",
        { data }
    );
    const form = dialog.querySelector("form");
    form.elements.update.addEventListener("click", () => {
        const color = form.elements.color?.value;
        if (!color) return;
        const colorMark = this.schema.marks.nscolor.create({ color });
        const tr = state.tr.addMark($from.pos, $to.pos, colorMark);
        this.view.dispatch(tr);
        dialog.remove();
    });
    form.elements.cancel.addEventListener("click", () => dialog.remove());
}

// Add counter badge to int-type conditions on the token HUD.
// Toggle logic is handled by NeuroshimaActor#toggleStatusEffect override.
Hooks.on("renderTokenHUD", (hud, html) => {
    const actor = hud.object?.actor;
    if (!actor) return;

    const condDefs = (() => {
        try { return game.settings.get("neuroshima", "conditions"); } catch { return []; }
    })();
    const intConditions = new Map(
        condDefs.filter(c => c.type === "int").map(c => [c.key, c])
    );
    if (intConditions.size === 0) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    root.querySelectorAll(".effect-control[data-status-id]").forEach(el => {
        const statusId = el.dataset.statusId;
        if (!intConditions.has(statusId)) return;

        const val = actor.getConditionValue(statusId);
        el.classList.toggle("active", val !== 0);

        if (val !== 0) {
            const badge = document.createElement("span");
            badge.className = "condition-int-badge";
            badge.textContent = val;
            el.style.position = "relative";
            el.appendChild(badge);
        }
    });
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
        name: "NEUROSHIMA.Roll.ReverseWounds",
        icon: '<i class="fas fa-heart-broken"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const messageType = message?.getFlag("neuroshima", "messageType");
            const woundIds = message?.getFlag("neuroshima", "woundIds") ?? [];
            const alreadyReversed = message?.getFlag("neuroshima", "isReversed");

            if (!CombatHelper.canPerformCombatAction()) return false;

            return messageType === "painResistanceReport" && woundIds.length > 0 && !alreadyReversed;
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
                    updateCardTargets(card, activeTab, message);
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

            updateCardTargets(card, tab, message);
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
                const snapshotTargets = message.getFlag("neuroshima", "rollData")?.snapshotTargets ?? [];
                if (snapshotTargets.length > 0) {
                    actors = snapshotTargets.map(t => game.actors.get(t.id)).filter(a => a);
                    game.neuroshima.log("Pobieranie aktorów z zachowanych celów (snapshot):", actors.map(a => a.name));
                } else {
                    actors = Array.from(game.user.targets).map(t => t.actor).filter(a => a);
                    game.neuroshima.log("Pobieranie aktorów z aktualnie namierzonych celów:", actors.map(a => a.name));
                }
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

    // Przycisk Korygowania Ognia
    card.querySelectorAll(".fire-correction-button").forEach(btn => {
        const isApplied = message.getFlag("neuroshima", "fireCorrectionApplied");
        const isSuccessCorrection = btn.dataset.successCorrection === "true";

        if (isApplied && !isSuccessCorrection) {
            btn.disabled = true;
            btn.classList.add("applied");
        }

        btn.addEventListener("click", async (event) => {
            event.preventDefault();
            if (btn.disabled) return;

            const rollData = message.getFlag("neuroshima", "rollData") ?? {};
            const actorId = rollData.actorId;

            if (isSuccessCorrection) {
                const fcData = rollData.fireCorrectionData ?? {};
                const maxCorrectionHits = fcData.maxCorrectionHits ?? Math.floor((fcData.bulletsFired ?? rollData.bulletsFired ?? 0) / 4);
                const prevHits = Number(message.getFlag("neuroshima", "correctedHits") ?? 0);

                if (prevHits >= maxCorrectionHits) {
                    ui.notifications.warn(game.i18n.localize("NEUROSHIMA.FireCorrection.NotEnoughAmmo"));
                    btn.disabled = true;
                    btn.classList.add("applied");
                    return;
                }

                const newHits = prevHits + 1;
                await message.setFlag("neuroshima", "correctedHits", newHits);
                await message.setFlag("neuroshima", "fireCorrectionApplied", true);
                await message.setFlag("neuroshima", "fireCorrectionIsSuccess", true);

                if (newHits >= maxCorrectionHits) {
                    btn.disabled = true;
                    btn.classList.add("applied");
                }

                ui.notifications.info(game.i18n.format("NEUROSHIMA.FireCorrection.AppliedSuccess", { hits: newHits, max: maxCorrectionHits }));
                game.neuroshima.log("Korygowanie Ognia (sukces) zastosowane", { totalHits: newHits, maxCorrectionHits, bulletsFired });
                return;
            }

            const cost = Number(btn.dataset.correctionCost) || 0;
            const bulletsFired = rollData.bulletsFired ?? 0;
            const afterInitial = bulletsFired - cost;
            const correctedHits = afterInitial >= 1 ? Math.ceil(afterInitial / 4) : 0;
            await message.setFlag("neuroshima", "fireCorrectionApplied", true);
            await message.setFlag("neuroshima", "correctedHits", correctedHits);
            btn.disabled = true;
            btn.classList.add("applied");
            ui.notifications.info(game.i18n.format("NEUROSHIMA.FireCorrection.Applied", { cost, hits: correctedHits }));
            game.neuroshima.log("Korygowanie Ognia zastosowane (porażka)", { cost, correctedHits, bulletsFired });
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
    // Jeśli obrażenia z opposed result zostały już nałożone — zablokuj przycisk
    const opposedResult = message.getFlag("neuroshima", "opposedResult");
    if (opposedResult?.applied) {
        const applyBtn = html.querySelector(".apply-opposed-damage-btn");
        if (applyBtn) {
            applyBtn.disabled = true;
            applyBtn.classList.add("applied");
            applyBtn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DamageApplied")}`;
        }
    }

    // Obsługa stanu po Korygowaniu Ognia
    const fireCorrectionApplied = message.getFlag("neuroshima", "fireCorrectionApplied");
    if (fireCorrectionApplied) {
        const correctedHits = message.getFlag("neuroshima", "correctedHits") ?? 0;
        const fireCorrectionIsSuccess = message.getFlag("neuroshima", "fireCorrectionIsSuccess") ?? false;
        const rollDataFC = message.getFlag("neuroshima", "rollData") ?? {};

        if (fireCorrectionIsSuccess) {
            const fcBtn = html.querySelector(".fire-correction-button");
            if (fcBtn) {
                const fcDataR = rollDataFC.fireCorrectionData ?? {};
                const maxCorrectionHits = fcDataR.maxCorrectionHits ?? Math.floor((fcDataR.bulletsFired ?? rollDataFC.bulletsFired ?? 0) / 4);
                if (correctedHits >= maxCorrectionHits) {
                    fcBtn.disabled = true;
                    fcBtn.classList.add("applied");
                } else {
                    fcBtn.disabled = false;
                    fcBtn.classList.remove("applied");
                }
            }
        } else {
            const fcBtn = html.querySelector(".fire-correction-button");
            if (fcBtn) { fcBtn.disabled = true; fcBtn.classList.add("applied"); }

            const footer = html.querySelector(".roll-outcome");
            if (footer) {
                footer.classList.remove("failure");
                footer.classList.add("corrected");
            }

            const rollStatusEl = html.querySelector(".roll-status .value");
            if (rollStatusEl) {
                rollStatusEl.classList.remove("failure");
                rollStatusEl.classList.add("corrected-status");
                rollStatusEl.innerHTML = `<strong>${game.i18n.localize("NEUROSHIMA.FireCorrection.CorrectedStatus")}</strong>`;
            }

            const ppItems = html.querySelectorAll(".success-points .label, .success-points .value");
            ppItems.forEach(el => el.classList.add("corrected-pp"));
        }

        const debugMode = rollDataFC.debugMode ?? false;
        if (debugMode) {
            const existing = html.querySelector(".fire-correction-debug");
            if (existing) existing.remove();

            const bulletsFiredDbg = rollDataFC.bulletsFired ?? 0;
            const fcDataDbg = rollDataFC.fireCorrectionData ?? {};
            const debugEl = document.createElement("div");
            debugEl.className = "fire-correction-debug";

            if (fireCorrectionIsSuccess) {
                const initialHitsDbg = fcDataDbg.hitBullets ?? 0;
                const remainingDbg = fcDataDbg.remainingForCorrection ?? (bulletsFiredDbg - initialHitsDbg);
                const maxHits = fcDataDbg.maxCorrectionHits ?? Math.floor(remainingDbg / 4);
                debugEl.innerHTML = `
                    <div class="fc-debug-header"><i class="fas fa-bug"></i> Korygowanie Ognia — krok po kroku (Sukces)</div>
                    <div class="fc-debug-row"><span class="fc-debug-label">Pociski wystrzelone:</span><span class="fc-debug-value">${bulletsFiredDbg}</span></div>
                    <div class="fc-debug-row"><span class="fc-debug-label">Trafień z rzutu:</span><span class="fc-debug-value">${initialHitsDbg}</span></div>
                    <div class="fc-debug-row fc-debug-formula"><span class="fc-debug-label">Dostępne do korekty:</span><span class="fc-debug-value">${bulletsFiredDbg} − ${initialHitsDbg} = <strong>${remainingDbg}</strong></span></div>
                    <div class="fc-debug-row fc-debug-formula"><span class="fc-debug-label">Maks. dodatkowych trafień:</span><span class="fc-debug-value">⌊${remainingDbg} ÷ 4⌋ = <strong>${maxHits}</strong></span></div>
                    <div class="fc-debug-row"><span class="fc-debug-label">Cykl (na trafienie):</span><span class="fc-debug-value">3 kule korekty + 1 trafienie</span></div>
                    <div class="fc-debug-row fc-debug-result"><span class="fc-debug-label">Dodatkowe trafienia:</span><span class="fc-debug-value"><strong>${correctedHits} / ${maxHits}</strong></span></div>`;
            } else {
                const failureMarginDbg = fcDataDbg.failureMargin ?? 0;
                const corrCost = failureMarginDbg * 3;
                const remaining = bulletsFiredDbg - corrCost;
                const hitsCalc = remaining >= 1 ? Math.ceil(remaining / 4) : 0;
                debugEl.innerHTML = `
                    <div class="fc-debug-header"><i class="fas fa-bug"></i> Korygowanie Ognia — krok po kroku (Porażka)</div>
                    <div class="fc-debug-row"><span class="fc-debug-label">Pociski wystrzelone:</span><span class="fc-debug-value">${bulletsFiredDbg}</span></div>
                    <div class="fc-debug-row"><span class="fc-debug-label">Punkty Porażki:</span><span class="fc-debug-value">${failureMarginDbg}</span></div>
                    <div class="fc-debug-row fc-debug-formula"><span class="fc-debug-label">Koszt korekcji:</span><span class="fc-debug-value">${failureMarginDbg} × 3 = <strong>${corrCost} kul</strong></span></div>
                    <div class="fc-debug-row fc-debug-formula"><span class="fc-debug-label">Pozostałe pociski:</span><span class="fc-debug-value">${bulletsFiredDbg} − ${corrCost} = <strong>${remaining}</strong></span></div>
                    <div class="fc-debug-row fc-debug-formula"><span class="fc-debug-label">Trafienia:</span><span class="fc-debug-value">⌈${remaining} ÷ 4⌉ = <strong>${hitsCalc}</strong></span></div>
                    <div class="fc-debug-row fc-debug-result"><span class="fc-debug-label">Wynik:</span><span class="fc-debug-value"><strong>${correctedHits} trafień</strong></span></div>`;
            }

            const corrRow = html.querySelector(".fire-correction-row");
            const pelletsSection = html.querySelector(".pellet-hits-section");
            const applyDmgSection = html.querySelector(".apply-damage-section");

            if (corrRow) {
                const pelletAnchor = applyDmgSection ?? corrRow;
                if (pelletsSection) pelletAnchor.after(pelletsSection);
                const debugAnchor = pelletsSection ?? pelletAnchor;
                debugAnchor.after(debugEl);
            } else {
                const rollOutcome = html.querySelector(".roll-outcome");
                if (rollOutcome) rollOutcome.before(debugEl);
            }

            if (correctedHits > 0) {
                html.querySelectorAll(".pellet-hit-item.fire-correction-cycle").forEach(el => el.remove());
                html.querySelectorAll(".fire-correction-cycles").forEach(el => el.remove());

                const failureMarginDbg = fcDataDbg.failureMargin ?? 0;
                const perBulletDamage = rollDataFC.hitBulletsData?.[0]?.damage ?? rollDataFC.damage ?? "?";
                const initialHitsCount = (rollDataFC.hitBulletsData ?? []).length || html.querySelectorAll(".pellet-hits-section .pellet-hit-item:not(.fire-correction-cycle)").length;

                const pelletsSection = html.querySelector(".pellet-hits-section");
                if (pelletsSection) {
                    for (let i = 1; i <= correctedHits; i++) {
                        const bulletNumber = initialHitsCount + i;
                        const item = document.createElement("div");
                        item.className = "pellet-hit-item fire-correction-cycle";
                        item.innerHTML = `
                            <span class="pellet-label corrected-pellet-label">Pocisk ${bulletNumber}:</span>
                            <span class="pellet-damage corrected-pellet-damage"><strong>${perBulletDamage}</strong></span>`;
                        pelletsSection.appendChild(item);
                    }
                }

                let cycleItems = "";
                let poolRemaining = fireCorrectionIsSuccess
                    ? (fcDataDbg.remainingForCorrection ?? (bulletsFiredDbg - (fcDataDbg.hitBullets ?? 0)))
                    : bulletsFiredDbg;

                for (let i = 1; i <= correctedHits; i++) {
                    const available = poolRemaining;
                    const correctionCost = (fireCorrectionIsSuccess || i > 1) ? 3 : (failureMarginDbg * 3);
                    const result = available - correctionCost - 1;
                    const tooltipMath = correctionCost !== 3
                        ? `${available} − ${correctionCost} − 1 = ${result}`
                        : `${available} − 3 − 1 = ${result}`;
                    cycleItems += `
                        <div class="pellet-hit-item">
                            <span class="pellet-label">Pocisk Korygowany ${i}</span>
                            <span class="pellet-damage" data-tooltip="${tooltipMath}"><strong>${result}</strong></span>
                        </div>`;
                    poolRemaining = result;
                }

                const cyclesEl = document.createElement("div");
                cyclesEl.className = "pellet-hits-section fire-correction-cycles";
                cyclesEl.innerHTML = cycleItems;
                debugEl.after(cyclesEl);
            }
        }

        const weaponDetails = html.querySelector(".weapon-details");
        if (weaponDetails) {
            const existing = weaponDetails.querySelector(".detail-item.corrected-hits-detail");
            if (existing) {
                existing.querySelector(".value").innerHTML = `<strong>${correctedHits}</strong>`;
            } else {
                const detail = document.createElement("div");
                detail.className = "detail-item corrected-hits-detail";
                detail.innerHTML = `<span class="label">${game.i18n.localize("NEUROSHIMA.FireCorrection.HitsLabel")}:</span>
                    <span class="value corrected-pp"><strong>${correctedHits}</strong></span>`;
                weaponDetails.appendChild(detail);
            }
        }
    }

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
function updateCardTargets(card, tab, message) {
    if (!card) return;
    const targetList = card.querySelector(`.target-list[data-tab="${tab}"]`);
    if (!targetList) return;
    
    let emptyLabel = "";
    let html = "";

    if (tab === "targets") {
        emptyLabel = game.i18n.localize("NEUROSHIMA.Roll.NoTargets");
        const snapshotTargets = message?.getFlag("neuroshima", "rollData")?.snapshotTargets ?? [];
        if (snapshotTargets.length > 0) {
            for (const t of snapshotTargets) {
                html += `<div class="target-item">
                    <img src="${t.img}" width="20" height="20" style="object-fit: cover; border-radius: 4px; border: 1px solid #777; margin-right: 5px;"/>
                    <span>${t.name || "Unknown"}</span>
                </div>`;
            }
        } else {
            const tokens = Array.from(game.user.targets);
            if (tokens.length === 0) {
                targetList.innerHTML = `<div class="target-item no-targets" style="opacity: 0.6; font-style: italic;">${emptyLabel}</div>`;
                return;
            }
            for (const token of tokens) {
                if (!token) continue;
                const img = token.document?.texture?.src || token.data?.img || token.img;
                html += `<div class="target-item">
                    <img src="${img}" width="20" height="20" style="object-fit: cover; border-radius: 4px; border: 1px solid #777; margin-right: 5px;"/>
                    <span>${token.name || "Unknown"}</span>
                </div>`;
            }
        }
    } else {
        emptyLabel = game.i18n.localize("NEUROSHIMA.Roll.NoSelected");
        const tokens = canvas.tokens.controlled;
        if (tokens.length === 0) {
            targetList.innerHTML = `<div class="target-item no-targets" style="opacity: 0.6; font-style: italic;">${emptyLabel}</div>`;
            return;
        }
        for (const token of tokens) {
            if (!token) continue;
            const img = token.document?.texture?.src || token.data?.img || token.img;
            html += `<div class="target-item">
                <img src="${img}" width="20" height="20" style="object-fit: cover; border-radius: 4px; border: 1px solid #777; margin-right: 5px;"/>
                <span>${token.name || "Unknown"}</span>
            </div>`;
        }
    }

    if (!html) {
        targetList.innerHTML = `<div class="target-item no-targets" style="opacity: 0.6; font-style: italic;">${emptyLabel}</div>`;
        return;
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

    // Actor flag proxy — allows non-owner clients to set/unset flags on any actor (GM executes)
    game.neuroshima.socket.register("setActorFlag", async (actorUuid, scope, key, value) => {
        const doc = await fromUuid(actorUuid);
        const actor = doc?.actor ?? doc;
        if (!actor) return;
        return actor.setFlag(scope, key, value);
    });

    game.neuroshima.socket.register("unsetActorFlag", async (actorUuid, scope, key) => {
        const doc = await fromUuid(actorUuid);
        const actor = doc?.actor ?? doc;
        if (!actor) return;
        return actor.unsetFlag(scope, key);
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

Hooks.on("createActor", async (actor, options, userId) => {
    if (!["character", "npc"].includes(actor.type)) return;
    if (userId !== game.user.id) return;
    await actor.createEmbeddedDocuments("Item", [{
        type: "money",
        name: "Gamble",
        img: "systems/neuroshima/assets/img/banknote.svg",
        system: { coinValue: 1, quantity: 0, weight: 0 }
    }]);
});

Hooks.on("updateItem", async (item, changes, options, userId) => {
    if (item.type !== "reputation") return;
    if (!item.parent || item.parent.documentName !== "Actor") return;
    if (userId !== game.user.id) return;
    if (options?.ns_skipFameRecalc) return;

    const newValue = foundry.utils.getProperty(changes, "system.value");
    if (newValue === undefined || newValue === null) return;

    const threshold = game.settings.get("neuroshima", "reputationFameThreshold") ?? 20;
    const famePerThreshold = game.settings.get("neuroshima", "reputationFamePoints") ?? 1;
    if (threshold <= 0 || famePerThreshold <= 0) return;

    const actor = item.parent;
    const reputationBonus = actor.system?.reputationBonus ?? 0;
    const effectiveValue = newValue + reputationBonus;
    const flagKey = `repFameBonus.${item.id}`;
    const prevBonus = actor.getFlag("neuroshima", flagKey) ?? 0;
    const newBonus = Math.floor(Math.max(0, effectiveValue) / threshold) * famePerThreshold;

    const delta = newBonus - prevBonus;
    if (delta === 0) return;

    const currentFame = actor.system?.fame ?? 0;
    const updatedFame = Math.clamp(currentFame + delta, -40, 40);

    await actor.setFlag("neuroshima", flagKey, newBonus);
    await actor.update({ "system.fame": updatedFame }, { ns_skipFameRecalc: true });
});

Hooks.on("deleteItem", async (item, options, userId) => {
    if (item.type !== "reputation") return;
    if (!item.parent || item.parent.documentName !== "Actor") return;
    if (userId !== game.user.id) return;

    const actor = item.parent;
    const flagKey = `repFameBonus.${item.id}`;
    const prevBonus = actor.getFlag("neuroshima", flagKey) ?? 0;
    if (prevBonus === 0) return;

    const currentFame = actor.system?.fame ?? 0;
    const updatedFame = Math.clamp(currentFame - prevBonus, -40, 40);
    await actor.unsetFlag("neuroshima", flagKey);
    await actor.update({ "system.fame": updatedFame }, { ns_skipFameRecalc: true });
});

Hooks.on("getItemDirectoryEntryContext", (html, options) => {
    options.push({
        name: game.i18n.localize("NEUROSHIMA.ContextMenu.PostToChat"),
        icon: '<i class="fas fa-comment"></i>',
        condition: (li) => {
            const item = game.items.get(li.dataset?.entryId ?? li.dataset?.documentId ?? li[0]?.dataset?.entryId ?? li[0]?.dataset?.documentId);
            return !!item;
        },
        callback: async (li) => {
            const item = game.items.get(li.dataset?.entryId ?? li.dataset?.documentId ?? li[0]?.dataset?.entryId ?? li[0]?.dataset?.documentId);
            if (!item) return;
            const { NeuroshimaChatMessage } = await import("./module/documents/chat-message.js");
            await NeuroshimaChatMessage.postItemToChat(item, {});
        }
    });
});

Hooks.on("renderItemDirectory", (app, html) => {
    const el = html instanceof HTMLElement ? html : html[0];
    if (!el) return;

    el.addEventListener("drop", async (event) => {
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (data.type !== "Item" || !data.uuid) return;
        if (!data.uuid.includes(".Item.")) return;

        const item = await fromUuid(data.uuid);
        if (!item || !item.parent) return;

        event.stopPropagation();

        const itemData = item.toObject();
        delete itemData._id;
        await Item.create(itemData);
        ui.notifications.info(game.i18n.format("NEUROSHIMA.Items.ExportedToSidebar", { name: item.name }));
    });
});
