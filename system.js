import { NEUROSHIMA } from "./module/config.js";
import { NeuroshimaActor } from "./module/documents/actor.js";
import { NeuroshimaCombat, NeuroshimaCombatant } from "./module/documents/combat.js";
import { NeuroshimaItem } from "./module/documents/item.js";
import { NeuroshimaChatMessage } from "./module/documents/chat-message.js";
import { NeuroshimaActiveEffect, NeuroshimaActiveEffectData } from "./module/documents/active-effect.js";
import { NeuroshimaActorData, NeuroshimaNPCData, NeuroshimaCreatureData, NeuroshimaVehicleData, HomeBaseData } from "./module/data/actor-data.js";
import { WeaponData, ArmorData, GearData, AmmoData, MagazineData, TrickData, TraitData, WoundData, BeastActionData, BeastSegmentData, SpecializationData, OriginData, ProfessionData, VehicleDamageData, VehicleModData, MoneyData, ReputationData, DiseaseData, WeaponModData, ArmorModData, FacilitiesData, ContainerData } from "./module/data/item-data.js";
import { NeuroshimaActorSheet } from "./module/sheets/actor-sheet.js";
import { NeuroshimaNPCSheet } from "./module/sheets/npc-sheet.js";
import { NeuroshimaCreatureSheet } from "./module/sheets/creature-sheet.js";
import { NeuroshimaVehicleSheet } from "./module/sheets/vehicle-sheet.js";
import { NeuroshimaHomeBaseSheet } from "./module/sheets/home-base-sheet.js";
import { NeuroshimaItemSheet } from "./module/sheets/item-sheet.js";
import { NeuroshimaEffectSheet } from "./module/sheets/neuroshima-effect-sheet.js";
import { NeuroshimaScriptRunner } from "./module/apps/neuroshima-script-engine.js";
import { NeuroshimaDice } from "./module/helpers/dice.js";
import { CombatHelper } from "./module/helpers/combat-helper.js";
import { NeuroshimaMeleeCombat } from "./module/combat/melee-combat.js";
import { buildRef, resolveRef } from "./module/helpers/mod-helpers.js";
import { EncumbranceConfig } from "./module/apps/config/encumbrance-config.js";
import { CombatConfig } from "./module/apps/config/combat-config.js";
import { DistanceConfig, DEFAULT_DISTANCE_PENALTIES } from "./module/apps/config/distance-config.js";
import { HealingConfig } from "./module/apps/config/healing-config.js";
import { ConditionConfig, applyConditionsToStatusEffects } from "./module/apps/config/condition-config.js";
import { ReputationSettingsApp } from "./module/apps/config/reputation-settings.js";
import { CurrencyGearConfig, DEFAULT_CURRENCY } from "./module/apps/config/currency-gear-config.js";
import { DamageCategoryConfig, _applyCustomDamageCategories } from "./module/apps/config/damage-category-config.js";
import { GrenadeConfig } from "./module/apps/config/grenade-config.js";
import { DebugRollDialog } from "./module/apps/dialogs/debug-roll-dialog.js";
import { EditRollDialog } from "./module/apps/dialogs/minor-dialogs.js";
import { NeuroshimaInitiativeRollDialog } from "./module/apps/dialogs/initiative-roll-dialog.js";
import { HealingApp } from "./module/apps/healing-app.js";
import { showHealingRollDialog } from "./module/apps/dialogs/healing-roll-dialog.js";
import { TraitBrowserApp } from "./module/apps/trait-browser.js";
import { registerRadiationHooks } from "./module/region-behaviors/danger-zone.js";
import { registerMigrationHook, normalizeAll, normalizeActor } from "./module/helpers/migration.js";
import { RadiationZoneBehaviorType } from "./module/region-behaviors/radiation-zone.js";
import { GMToolkitApp } from "./module/apps/gm/gm-toolkit.js";
import { GMAddXPApp } from "./module/apps/gm/gm-xp-app.js";
import { GMApplyDamageApp } from "./module/apps/gm/gm-damage-app.js";
import { GMGroupCheckApp, registerGroupCheckChatListeners } from "./module/apps/gm/gm-group-check-app.js";
import { GMPayoutApp } from "./module/apps/gm/gm-payout-app.js";
import { GMReputationApp } from "./module/apps/gm/gm-reputation-app.js";

import { NeuroshimaCombatTracker } from "./module/combat/combat-tracker.js";
import { MeleeCombatApp } from "./module/apps/melee-combat-app.js";
import { MeleeVanillaChat } from "./module/combat/melee-vanilla-chat.js";
import { MeleeOpposedChat } from "./module/combat/melee-opposed-chat.js";

// System initialization
Hooks.once('init', async function() {
    console.log('Neuroshima 1.5 | Inicjalizacja systemu');

    CONFIG.fontDefinitions["Special Elite"] = {
        editor: true,
        fonts: [{ urls: ["systems/neuroshima/fonts/SpecialElite.ttf"], weight: 400, style: "normal" }]
    };

    CONFIG.defaultFontFamily = "Special Elite";

    CONFIG.ui.combat = NeuroshimaCombatTracker;
    MeleeCombatApp.registerHooks();
    MeleeVanillaChat.registerHooks();

    const _isActorSheet = (app) => app instanceof NeuroshimaActorSheet || app instanceof NeuroshimaCreatureSheet;

    Hooks.on("updateActor", (actor, changes) => {
        if (foundry.utils.hasProperty(changes, "system.combat.meleeInitiative")) {
            ui.combat?.render(false);
        }
    });

    // Hook to re-render actor sheets when combat updates (for melee pendings)
    Hooks.on("updateCombat", async (combat, updates, options, userId) => {
        const appInstances = Object.values(foundry.applications?.instances ?? ui.windows ?? {});
        appInstances.forEach(app => {
            if (_isActorSheet(app)) app.render(false);
        });
        if (game.user.isGM) await NeuroshimaScriptRunner.runUpdateCombat(combat, updates);
    });

    // Hide GM-only elements in chat messages for non-GM users
    Hooks.on("renderChatMessageHTML", (message, html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;

        // Skill allocation card visibility — runs for all users
        const allocCard = root.querySelector(".melee-skill-allocation");
        if (allocCard) {
            const allocData = message.getFlag("neuroshima", "skillAlloc");
            if (allocData) {
                const attackerDoc = fromUuidSync(allocData.attackerUuid);
                const attackerActor = attackerDoc?.actor ?? attackerDoc;
                const defenderDoc = fromUuidSync(allocData.defenderUuid);
                const defenderActor = defenderDoc?.actor ?? defenderDoc;
                const isAttacker = game.user.isGM || (attackerActor && attackerActor.isOwner);
                const isDefender = game.user.isGM || (defenderActor && defenderActor.isOwner);

                root.querySelectorAll("[data-alloc-visible]").forEach(el => {
                    const sides = (el.dataset.allocVisible || "").split(" ");
                    const show = sides.some(s => {
                        if (s === "gm") return game.user.isGM;
                        if (s === "attacker") return isAttacker;
                        if (s === "defender") return isDefender;
                        return false;
                    });
                    if (!show) el.style.display = "none";
                });
            }
        }

        if (!game.user.isGM) {
            root.querySelectorAll("[data-gm-only]").forEach(el => { el.style.display = "none"; });
            root.querySelectorAll("[data-debug-gm-only]").forEach(el => { el.style.display = "none"; });
            return;
        }

        const debugOn = game.settings.get("neuroshima", "debugMode");
        if (!debugOn) {
            root.querySelectorAll("[data-debug-gm-only]").forEach(el => { el.style.display = "none"; });
        }
    });

    // Re-render all open actor sheets when an opposed chat message is resolved/cancelled.
    // This clears pending attacker/defender cards on BOTH clients (attacker and defender)
    // without relying on the combat flag propagation which can be delayed on non-GM clients.
    Hooks.on("updateChatMessage", (message) => {
        const opposedData = message.getFlag("neuroshima", "opposedChat");
        if (!opposedData) return;
        if (opposedData.status !== "resolved" && opposedData.status !== "cancelled") return;
        const appInstances = Object.values(foundry.applications?.instances ?? ui.windows ?? {});
        appInstances.forEach(app => {
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

    // Assign custom classes and constants (safe merge to preserve socket)
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
        openGMToolkit: () => GMToolkitApp.open(),
        openXPApp: () => GMAddXPApp.open(),
        openDamageApp: () => GMApplyDamageApp.open(),
        openGroupCheckApp: () => GMGroupCheckApp.open(),
        openPayoutApp: () => GMPayoutApp.open(),
        openReputationApp: () => GMReputationApp.open(),
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
        migration: { normalizeAll, normalizeActor },
        applyDamage: async (actor, config = {}) => {
            const {
                damage         = "L",
                location       = "torso",
                piercing       = 0,
                armorBypass    = false,
                penaltyOverride,
                label,
                suppressChat   = false
            } = config;

            if (penaltyOverride !== undefined && penaltyOverride !== null) {
                const penalty = Number(penaltyOverride);
                game.neuroshima?.log(`applyDamage | direct wound (${damage}, -${penalty}%) → ${actor.name} @ ${location}`);
                await NeuroshimaDice.applyDamage(actor, {
                    damageType: damage,
                    location,
                    penaltyOverride: penalty,
                    additionalSystem: {
                        originalPenalty:         penalty,
                        hadFirstAid:             false,
                        healingAttempts:         0,
                        failedFirstAidAttempts:  0,
                        failedTreatmentAttempts: 0,
                        firstAidHealingApplied:  0
                    }
                });
                return;
            }

            const attackData = {
                damage,
                piercing:   armorBypass ? 9999 : (Number(piercing) || 0),
                isMelee:    false,
                weaponType: null,
                label:      label ?? "Script Damage"
            };
            game.neuroshima?.log(`applyDamage | pipeline (${damage}) → ${actor.name} @ ${location}`);
            return CombatHelper.applyDamageToActor(actor, attackData, { location, suppressChat });
        }
    });

    // Handlebars Helpers
    Handlebars.registerHelper("capitalize", function(string) {
        if (!string) return "";
        return string.charAt(0).toUpperCase() + string.slice(1);
    });

    // Register custom document classes
    CONFIG.Actor.documentClass = NeuroshimaActor;
    CONFIG.Combat.documentClass = NeuroshimaCombat;
    CONFIG.Combatant.documentClass = NeuroshimaCombatant;
    CONFIG.Item.documentClass = NeuroshimaItem;
    CONFIG.ChatMessage.documentClass = NeuroshimaChatMessage;
    CONFIG.ActiveEffect.documentClass = NeuroshimaActiveEffect;

    // Initiative
    CONFIG.Combat.initiative.formula = "0";

    // Register data models
    CONFIG.Actor.dataModels.character = NeuroshimaActorData;
    CONFIG.Actor.dataModels.npc      = NeuroshimaNPCData;
    CONFIG.Actor.dataModels.creature = NeuroshimaCreatureData;
    CONFIG.Actor.dataModels.vehicle  = NeuroshimaVehicleData;
    CONFIG.Actor.dataModels.homeBase = HomeBaseData;
    CONFIG.ActiveEffect.dataModels.base = NeuroshimaActiveEffectData;
    CONFIG.Item.dataModels.weapon = WeaponData;
    CONFIG.Item.dataModels.armor = ArmorData;
    CONFIG.Item.dataModels.gear = GearData;
    CONFIG.Item.dataModels.ammo = AmmoData;
    CONFIG.Item.dataModels.magazine = MagazineData;
    CONFIG.Item.dataModels.trick = TrickData;
    CONFIG.Item.dataModels.trait = TraitData;
    CONFIG.Item.dataModels.wound = WoundData;
    CONFIG.Item.dataModels["beast-action"]      = BeastActionData;
    CONFIG.Item.dataModels["beast-segment"]     = BeastSegmentData;
    CONFIG.Item.dataModels["specialization"]    = SpecializationData;
    CONFIG.Item.dataModels["origin"]            = OriginData;
    CONFIG.Item.dataModels["profession"]        = ProfessionData;
    CONFIG.Item.dataModels["vehicle-damage"]    = VehicleDamageData;
    CONFIG.Item.dataModels["vehicle-mod"]       = VehicleModData;
    CONFIG.Item.dataModels["money"]             = MoneyData;
    CONFIG.Item.dataModels["reputation"]        = ReputationData;
    CONFIG.Item.dataModels["disease"]           = DiseaseData;
    CONFIG.Item.dataModels["weapon-mod"]        = WeaponModData;
    CONFIG.Item.dataModels["armor-mod"]         = ArmorModData;
    CONFIG.Item.dataModels["facilities"]        = FacilitiesData;
    CONFIG.Item.dataModels["container"]         = ContainerData;

    registerRadiationHooks();
    registerGroupCheckChatListeners();

    CONFIG.RegionBehavior.dataModels["radiationZone"] = RadiationZoneBehaviorType;
    CONFIG.RegionBehavior.typeLabels["radiationZone"] = "NEUROSHIMA.RegionBehavior.RadiationZone.label";
    CONFIG.RegionBehavior.typeIcons["radiationZone"]  = "fa-solid fa-radiation";

    CONFIG.Item.defaultIcons = CONFIG.Item.defaultIcons ?? {};
    CONFIG.Item.defaultIcons["weapon-mod"] = "systems/neuroshima/assets/img/modification-weapon.svg";
    CONFIG.Item.defaultIcons["facilities"] = "systems/neuroshima/assets/img/facilities.svg";
    CONFIG.Item.defaultIcons["container"]  = "icons/svg/item-bag.svg";

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
    Handlebars.registerHelper('nsItemPreviewTooltip', (img, name, weight, cost) => {
        if (!img) return "";
        const safeName = Handlebars.escapeExpression(name ?? "");
        const safeImg  = Handlebars.escapeExpression(img);
        const wNum = typeof weight === "number" ? weight : parseFloat(weight);
        const cNum = typeof cost   === "number" ? cost   : parseFloat(cost);
        const hasW = !isNaN(wNum);
        const hasC = !isNaN(cNum);
        let statsHtml = "";
        if (hasW || hasC) {
            const wChip = hasW ? `<span class='ns-tip-stat'><i class='fas fa-weight-hanging'></i> ${wNum} kg</span>` : "";
            const cFormatted = Number.isInteger(cNum) ? cNum.toLocaleString("pl-PL") : cNum.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const cChip = hasC ? `<span class='ns-tip-stat'><i class='fas fa-coins'></i> ${cFormatted}</span>` : "";
            statsHtml = `<div class='ns-item-preview-stats'>${wChip}${cChip}</div>`;
        }
        return `<div class='ns-item-preview'><div class='ns-item-preview-name'>${safeName}</div><img src='${safeImg}' />${statsHtml}</div>`;
    });
    Handlebars.registerHelper('nsGearTypeLabel', (gearType) => {
        if (!gearType || gearType === "misc") return "";
        const NEUROSHIMA = game.neuroshima.config;
        const i18nKey = NEUROSHIMA.gearTypes[gearType];
        return i18nKey ? game.i18n.localize(i18nKey) : gearType;
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
    Handlebars.registerHelper('grenadeMaxRadius', (zones) => {
        if (!zones || !zones.length) return 0;
        return Math.max(...zones.map(z => z.radius ?? 0));
    });
    Handlebars.registerHelper('damageLabel', (damageKey) => {
        if (!damageKey || damageKey === "none") return game.i18n.localize("NEUROSHIMA.Damage.None");
        const key = `NEUROSHIMA.Damage.${damageKey}`;
        const loc = game.i18n.localize(key);
        return loc !== key ? loc : damageKey;
    });

    Handlebars.registerHelper('locationAbbrev', (locationKey) => {
        if (!locationKey) return "-";
        const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
        const key = `NEUROSHIMA.LocationAbbrev.${capitalize(locationKey)}`;
        const loc = game.i18n.localize(key);
        return loc !== key ? loc : locationKey;
    });

    Handlebars.registerHelper('locationFull', (locationKey) => {
        if (!locationKey) return "-";
        const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
        const key = `NEUROSHIMA.Location.${capitalize(locationKey)}`;
        const loc = game.i18n.localize(key);
        return loc !== key ? loc : locationKey;
    });

    Handlebars.registerHelper('formatDelta', (v) => {
        const n = Number(v);
        if (isNaN(n)) return v;
        return n > 0 ? `+${n}` : `${n}`;
    });

    Handlebars.registerHelper('hasAttachedMods', (mods) => {
        if (!mods || typeof mods !== 'object') return false;
        return Object.entries(mods).some(([k, v]) => !k.startsWith('__') && v?.attached);
    });

    Handlebars.registerHelper('attachedMods', (mods) => {
        if (!mods || typeof mods !== 'object') return [];
        return Object.entries(mods)
            .filter(([k, v]) => !k.startsWith('__') && v?.attached)
            .map(([, v]) => v);
    });

    Handlebars.registerHelper('nsDamageCategoryLabel', (category) => {
        const cat = NEUROSHIMA.damageCategories?.[category];
        if (!cat) return category ?? "";
        return game.i18n.localize(cat.label);
    });

    Handlebars.registerHelper('nsModTooltip', (mods, deltaKey, overrideKey) => {
        if (!mods || typeof mods !== 'object') return '';
        const lines = [];
        for (const [key, snap] of Object.entries(mods)) {
            if (key.startsWith('__') || !snap?.attached) continue;
            if (overrideKey && snap[overrideKey]) {
                const val = snap[deltaKey];
                if (val !== undefined && val !== null && val !== '') {
                    lines.push(`${snap.name}: ${val}`);
                }
            } else {
                const delta = Number(snap[deltaKey] ?? 0);
                if (delta !== 0) {
                    lines.push(`${snap.name}: ${delta > 0 ? '+' : ''}${delta}`);
                }
            }
        }
        return lines.join('<br>');
    });

    // Register sheets
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
    foundry.documents.collections.Actors.registerSheet("neuroshima", NeuroshimaHomeBaseSheet, {
        types: ["homeBase"],
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.ActorHomeBase"
    });

    foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
    foundry.documents.collections.Items.registerSheet("neuroshima", NeuroshimaItemSheet, {
        types: ["weapon", "armor", "gear", "trick", "trait", "ammo", "magazine", "wound", "beast-action", "beast-segment", "specialization", "origin", "profession", "vehicle-damage", "vehicle-mod", "money", "reputation", "disease", "weapon-mod", "armor-mod", "facilities", "container"],
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.Item"
    });

    foundry.applications.apps.DocumentSheetConfig.unregisterSheet(ActiveEffect, "core", foundry.applications.sheets.ActiveEffectConfig);
    foundry.applications.apps.DocumentSheetConfig.registerSheet(ActiveEffect, "neuroshima", NeuroshimaEffectSheet, {
        makeDefault: true,
        label: "NEUROSHIMA.Sheet.Effect"
    });

    // Internal schema version — used by the migration system to track which
    // migration steps have already been applied to this world's data.
    game.settings.register("neuroshima", "schemaVersion", {
        scope: "world",
        config: false,
        type: String,
        default: "0.0"
    });

    // Register system settings
    game.settings.register("neuroshima", "customGearTypes", {
        scope: "world",
        config: false,
        type: String,
        default: "[]"
    });

    game.settings.register("neuroshima", "currencies", {
        scope: "world",
        config: false,
        type: String,
        default: "[]"
    });

    game.settings.register("neuroshima", "currencyNameLabel", {
        scope: "world",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register("neuroshima", "currencyValueLabel", {
        scope: "world",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register("neuroshima", "gearTypePriceModifiers", {
        scope: "world",
        config: false,
        type: String,
        default: "{}"
    });

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

    // Setting that limits pellet count (Buckshot/Birdshot) based on ammo stats
    game.settings.register("neuroshima", "usePelletCountLimit", {
        name: "NEUROSHIMA.Settings.UsePelletCountLimit.Name",
        hint: "NEUROSHIMA.Settings.UsePelletCountLimit.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register("neuroshima", "sessionID", {
        name: "NEUROSHIMA.GMToolkit.Session.SettingName",
        hint: "NEUROSHIMA.GMToolkit.Session.SettingHint",
        scope: "world",
        config: false,
        type: Number,
        default: 1,
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

    // Combat UI visibility settings
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

    // Register settings menus
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

    game.settings.registerMenu("neuroshima", "currencyGearConfig", {
        name: "NEUROSHIMA.Settings.CurrencyGearConfig.Label",
        label: "NEUROSHIMA.Settings.CurrencyGearConfig.Title",
        hint: "NEUROSHIMA.Settings.CurrencyGearConfig.MenuHint",
        icon: "fas fa-coins",
        type: CurrencyGearConfig,
        restricted: true
    });

    game.settings.registerMenu("neuroshima", "grenadeConfig", {
        name: "NEUROSHIMA.Settings.GrenadeConfig.Label",
        label: "NEUROSHIMA.Settings.GrenadeConfig.Title",
        hint: "NEUROSHIMA.Settings.GrenadeConfig.Hint",
        icon: "fas fa-bomb",
        type: GrenadeConfig,
        restricted: true
    });

    game.settings.registerMenu("neuroshima", "damageCategoryConfig", {
        name: "NEUROSHIMA.Settings.DamageCategoryConfig.Label",
        label: "NEUROSHIMA.Settings.DamageCategoryConfig.Title",
        hint: "NEUROSHIMA.Settings.DamageCategoryConfig.MenuHint",
        icon: "fas fa-burst",
        type: DamageCategoryConfig,
        restricted: true
    });

    game.settings.register("neuroshima", "customDamageCategories", {
        scope: "world",
        config: false,
        type: String,
        default: "[]"
    });

    game.settings.register("neuroshima", "grenadeConstitutionBonuses", {
        scope: "world",
        config: false,
        type: Array,
        default: [
            { minBuild: 12, maxBuild: 14, bonus: 10 },
            { minBuild: 15, maxBuild: 16, bonus: 20 },
            { minBuild: 17, maxBuild: 99, bonus: 30 }
        ]
    });

    game.settings.register("neuroshima", "grenadeBaseRange", {
        scope: "world",
        config: false,
        type: Number,
        default: 10
    });

    game.settings.register("neuroshima", "grenadeDistanceMultiplier", {
        scope: "world",
        config: false,
        type: Number,
        default: 3
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

    game.settings.register("neuroshima", "defaultReputationItems", {
        name: "NEUROSHIMA.Settings.DefaultReputationItems.Name",
        hint: "NEUROSHIMA.Settings.DefaultReputationItems.Hint",
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    // Encumbrance settings (hidden from the main settings menu)
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

    game.settings.register("neuroshima", "allowRepeatedHealing", {
        name: "NEUROSHIMA.Settings.AllowRepeatedHealing.Name",
        hint: "NEUROSHIMA.Settings.AllowRepeatedHealing.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register("neuroshima", "healingScriptModifierOnFailure", {
        name: "NEUROSHIMA.Settings.HealingScriptModifierOnFailure.Name",
        hint: "NEUROSHIMA.Settings.HealingScriptModifierOnFailure.Hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    // Override CONFIG.statusEffects with conditions from settings
    applyConditionsToStatusEffects();

    // Load templates (v13 namespaced)
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
        "systems/neuroshima/templates/item/parts/weapon-grenade.hbs",
        "systems/neuroshima/templates/item/parts/ammo-details.hbs",
        "systems/neuroshima/templates/item/parts/wound-details.hbs",
        "systems/neuroshima/templates/item/parts/vehicle-damage-details.hbs",
        "systems/neuroshima/templates/item/parts/vehicle-mod-details.hbs",
        "systems/neuroshima/templates/item/parts/weapon-mod-details.hbs",
        "systems/neuroshima/templates/item/parts/armor-mod-details.hbs",
        "systems/neuroshima/templates/item/parts/mods-tab.hbs",
        "systems/neuroshima/templates/item/parts/magazine-details.hbs",
        "systems/neuroshima/templates/item/parts/ammunition-details.hbs",
        "systems/neuroshima/templates/apps/reputation-settings.hbs",
        "systems/neuroshima/templates/apps/currency-gear-config.hbs",
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
        "systems/neuroshima/templates/chat/melee-turn-card.hbs",
        "systems/neuroshima/templates/chat/melee-vanilla-pool.hbs",
        "systems/neuroshima/templates/chat/melee-vanilla-attack.hbs",
        "systems/neuroshima/templates/chat/melee-vanilla-defense.hbs",
        "systems/neuroshima/templates/chat/melee-vanilla-result.hbs",
        "systems/neuroshima/templates/chat/weapon-roll-card.hbs",
        "systems/neuroshima/templates/chat/grenade-blast-result.hbs",
        "systems/neuroshima/templates/chat/grenade-blast-pain-report.hbs",
        "systems/neuroshima/templates/chat/roll-card.hbs",
        "systems/neuroshima/templates/chat/patient-card.hbs",
        "systems/neuroshima/templates/chat/pain-resistance-report.hbs",
        "systems/neuroshima/templates/chat/rest-report.hbs",
        "systems/neuroshima/templates/chat/xp-grant-report.hbs",
        "systems/neuroshima/templates/chat/payout-report.hbs",
        "systems/neuroshima/templates/chat/reputation-report.hbs",
        "systems/neuroshima/templates/apps/gm-payout-app.hbs",
        "systems/neuroshima/templates/apps/gm-reputation-app.hbs",
        "systems/neuroshima/templates/chat/healing-roll-card.hbs",
        "systems/neuroshima/templates/chat/healing-request.hbs",
        "systems/neuroshima/templates/chat/required-test-card.hbs",
        "systems/neuroshima/templates/chat/beast-engage-target-card.hbs",
        "systems/neuroshima/templates/dialog/rest-dialog.hbs",
        "systems/neuroshima/templates/dialog/hp-config.hbs",
        "systems/neuroshima/templates/apps/effect-sheet-scripts.hbs",
        "systems/neuroshima/templates/apps/script-editor.hbs",
        "systems/neuroshima/templates/apps/condition-check-editor.hbs",
        "systems/neuroshima/templates/prosemirror/text-colour.hbs",
        "systems/neuroshima/templates/chat/melee-duel-card.hbs",
        "systems/neuroshima/templates/apps/beast-activity-sheet.hbs"
    ];
    
    await foundry.applications.handlebars.loadTemplates(templates);
    
    // Register partials manually
    for (const path of templates) {
        if (path.includes("/parts/")) {
            const template = await foundry.applications.handlebars.getTemplate(path);
            Handlebars.registerPartial(path, template);
            
            // Also register under a short PascalCase name (e.g. MeleeHeader) for easier use in HBS
            const shortName = path.split("/").pop().replace(".hbs", "").split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("");
            Handlebars.registerPartial(shortName, template);
        }
    }

    console.log("Neuroshima 1.5 | Szablony wczytane");
});

Hooks.once("i18nInit", () => {
    foundry.helpers.Localization.localizeDataModel(RadiationZoneBehaviorType);
});

Hooks.once("ready", () => {
    try {
        const customTypes = JSON.parse(game.settings.get("neuroshima", "customGearTypes") || "[]");
        for (const label of customTypes) {
            if (label && typeof label === "string") {
                NEUROSHIMA.gearTypes[label] = label;
            }
        }
    } catch(e) {}
});

Hooks.once("ready", () => {
    try {
        const custom = JSON.parse(game.settings.get("neuroshima", "customDamageCategories") || "[]");
        _applyCustomDamageCategories(custom);
    } catch(e) {}
});

registerMigrationHook();

Hooks.once("ready", async function () {
    if (game.user.isGM) {
        const migrateEffect = async (effect) => {
            const oldScripts = effect.getFlag("neuroshima", "scripts");
            if (!Array.isArray(oldScripts) || !oldScripts.length) return;
            if (effect.system?.scriptData?.length) return;
            await effect.update({
                "system.scriptData": oldScripts,
                "flags.neuroshima.-=scripts": null
            });
        };
        for (const actor of game.actors) {
            for (const effect of actor.effects) await migrateEffect(effect);
            for (const item of actor.items) {
                for (const effect of item.effects) await migrateEffect(effect);
            }
        }
        for (const item of game.items) {
            for (const effect of item.effects) await migrateEffect(effect);
        }
    }

    game.neuroshima.log("Tryb debugowania jest WŁĄCZONY");
    console.log("Neuroshima 1.5 | System gotowy");

    const savedGrenadeBonuses = game.settings.get("neuroshima", "grenadeConstitutionBonuses");
    if (Array.isArray(savedGrenadeBonuses) && savedGrenadeBonuses.length) {
        NEUROSHIMA.grenadeConstitutionBonuses = savedGrenadeBonuses;
    }

    const savedGrenadeBaseRange = game.settings.get("neuroshima", "grenadeBaseRange");
    if (savedGrenadeBaseRange != null) NEUROSHIMA.grenadeBaseRange = savedGrenadeBaseRange;

    const savedGrenadeMultiplier = game.settings.get("neuroshima", "grenadeDistanceMultiplier");
    if (savedGrenadeMultiplier != null) NEUROSHIMA.grenadeDistanceMultiplier = savedGrenadeMultiplier;

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

Hooks.once("ready", async () => {
    if (!game.user.isGM) return;
    for (const actor of game.actors) {
        const items = [...actor.items];
        for (const item of items) {
            if (item.type !== "container") continue;
            const contents = item.system.contents;
            if (!contents?.length) continue;
            const itemsToCreate = contents.map(entry => {
                const base = entry.itemData ?? {
                    name: entry.name,
                    img: entry.img || "systems/neuroshima/assets/img/backpack.svg",
                    type: entry.type || "gear",
                    system: { quantity: entry.quantity ?? 1, weight: entry.weight ?? 0, cost: entry.cost ?? 0 }
                };
                foundry.utils.setProperty(base, "flags.neuroshima.containerId", item.id);
                return base;
            });
            await item.update({ "system.contents": [] });
            await actor.createEmbeddedDocuments("Item", itemsToCreate);
        }
    }
});


Hooks.on("createItem", async (item, _options, userId) => {
    if (item.type !== "container") return;
    if (!item.actor) return;
    if (userId !== game.user.id) return;
    const contents = item.system.contents || [];
    if (!contents.length) return;
    await item.update({ "system.contents": [] });
    const itemsToCreate = contents.map(entry => {
        const base = foundry.utils.deepClone(entry.itemData ?? {
            name: entry.name,
            img: entry.img || "systems/neuroshima/assets/img/backpack.svg",
            type: entry.type || "gear",
            system: { quantity: entry.quantity ?? 1, weight: entry.weight ?? 0, cost: entry.cost ?? 0 }
        });
        foundry.utils.setProperty(base, "flags.neuroshima.containerId", item.id);
        return base;
    });
    await item.actor.createEmbeddedDocuments("Item", itemsToCreate);
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

Hooks.on("getProseMirrorMenuDropDowns", (menu, config) => {
    const fontsDd = config.fonts;
    if (!fontsDd) return;
    const entries = fontsDd.entries ?? fontsDd.items ?? [];
    const already = entries.some(e => (e.title ?? e.label ?? "") === "Special Elite");
    if (!already) {
        entries.unshift({
            title: "Special Elite",
            action: "font-family",
            attrs: { style: "font-family: 'Special Elite'" },
            priority: 1
        });
        if (fontsDd.entries) fontsDd.entries = entries;
        else if (fontsDd.items) fontsDd.items = entries;
    }
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

Hooks.on("renderTokenHUD", (hud, html) => {
    const meleeCombatType = (() => {
        try { return game.settings.get("neuroshima", "meleeCombatType"); } catch { return "default"; }
    })();
    if (meleeCombatType !== "default") return;
    if (!game.user.isGM) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    const combatBtn = root.querySelector('.control-icon[data-action="combat"]');
    if (!combatBtn) return;

    const tokenDoc = hud.object?.document;
    if (!tokenDoc) return;

    const activeId   = ui.combat?._activeGroupId;
    const isInActive = NeuroshimaCombatTracker.inMeleeGroup(tokenDoc, activeId || undefined);

    const fistBtn = document.createElement("button");
    fistBtn.type = "button";
    fistBtn.className = "control-icon" + (isInActive ? " active" : "");
    fistBtn.dataset.action = "toggleMelee";
    fistBtn.dataset.tooltip = game.i18n.localize("NEUROSHIMA.MeleeDuel.AddToMelee");
    fistBtn.setAttribute("aria-label", game.i18n.localize("NEUROSHIMA.MeleeDuel.AddToMelee"));
    fistBtn.innerHTML = `<i class="fa-solid fa-hand-fist"></i>`;
    combatBtn.after(fistBtn);

    fistBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const selected  = canvas.tokens?.controlled ?? [];
        const tokenDocs = selected.length > 0
            ? selected.map(t => t.document).filter(Boolean)
            : [tokenDoc];
        await NeuroshimaCombatTracker.toggleMeleeGroupToken(tokenDocs);
    });
});

// Add context menu options for chat messages
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
            
            // Refund availability depends on the configured role
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
        name: "NEUROSHIMA.Grenade.BlastReport.ReverseAll",
        icon: '<i class="fas fa-bomb"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const messageType = message?.getFlag("neuroshima", "messageType");
            const allWoundIds = message?.getFlag("neuroshima", "allWoundIds") ?? [];
            const alreadyReversed = message?.getFlag("neuroshima", "isReversed");
            if (!CombatHelper.canPerformCombatAction()) return false;
            return messageType === "grenadeBlastReport" && allWoundIds.length > 0 && !alreadyReversed;
        },
        callback: async li => {
            const message = game.messages.get(li.dataset.messageId);
            const actorDamages = message?.getFlag("neuroshima", "actorDamages") ?? [];
            const alreadyReversed = message?.getFlag("neuroshima", "isReversed");
            if (alreadyReversed) return;
            let totalReversed = 0;
            for (const ad of actorDamages) {
                if (!ad.woundIds?.length) continue;
                let actor = null;
                if (ad.actorUuid) {
                    const doc = await fromUuid(ad.actorUuid);
                    actor = doc?.actor ?? doc;
                }
                if (!actor && ad.actorId) actor = game.actors.get(ad.actorId);
                if (!actor) continue;
                const existing = ad.woundIds.filter(id => actor.items.has(id));
                if (existing.length > 0) {
                    await actor.deleteEmbeddedDocuments("Item", existing);
                    totalReversed += existing.length;
                }
            }
            await message.setFlag("neuroshima", "isReversed", true);
            if (totalReversed > 0) {
                ui.notifications.info(game.i18n.format("NEUROSHIMA.Grenade.BlastReport.Reversed", { count: totalReversed }));
            }
            const html = document.createElement("div");
            html.innerHTML = message.content;
            const statusDiv = document.createElement("div");
            statusDiv.className = "refund-status";
            statusDiv.style.cssText = "text-align:center;font-style:italic;opacity:0.7;margin-top:5px;border-top:1px dashed #777;padding-top:5px;";
            statusDiv.textContent = game.i18n.localize("NEUROSHIMA.Notifications.StatusReversed");
            html.appendChild(statusDiv);
            await message.update({ content: html.innerHTML });
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
        name: "NEUROSHIMA.Roll.ResetDieReduction",
        icon: '<i class="fas fa-rotate-left"></i>',
        condition: li => {
            if (!game.user.isGM) return false;
            const message = game.messages.get(li.dataset.messageId);
            const msgType = message?.getFlag("neuroshima", "messageType");
            const trickUsed = message?.getFlag("neuroshima", "trickBonusUsed");
            return (msgType === "roll" || msgType === "initiative") && trickUsed === true;
        },
        callback: async li => {
            const message = game.messages.get(li.dataset.messageId);
            const { NeuroshimaDice } = await import("./module/helpers/dice.js");
            await NeuroshimaDice.resetTrickDieBonus(message);
            if (window._nsTrickState) delete window._nsTrickState[message.id];
        }
    });

    options.push({
        name: "NEUROSHIMA.Actions.Reroll",
        icon: '<i class="fas fa-arrow-rotate-left"></i>',
        condition: li => {
            const message = game.messages.get(li.dataset.messageId);
            const rollData = message?.getFlag("neuroshima", "rollData");
            const messageType = message?.getFlag("neuroshima", "messageType");
            
            if (!rollData) return false;
            if (messageType !== "roll" && messageType !== "weapon" && messageType !== "initiative") return false;

            const isRerolled = message?.getFlag("neuroshima", "rerolled");
            if (isRerolled && !game.user.isGM) return false;
            
            const actor = game.actors.get(rollData.actorId);
            return game.user.isGM || actor?.isOwner;
        },
        callback: async li => {
            const message = game.messages.get(li.dataset.messageId);
            const rollData = message?.getFlag("neuroshima", "rollData");
            const messageType = message?.getFlag("neuroshima", "messageType");
            const actor = game.actors.get(rollData?.actorId);
            
            if (!actor || !rollData) {
                ui.notifications.error("Nie można znaleźć wymaganych danych do przerzutu");
                return;
            }

            const selected = window._nsRerollSelectedMap?.get(message.id);
            const hasSelected = selected?.size > 0;

            const confirmed = await new Promise(resolve => {
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
            });
            if (!confirmed) return;

            if (hasSelected) {
                const { NeuroshimaDice } = await import("./module/helpers/dice.js");
                await NeuroshimaDice.partialRerollTest(message, [...selected]);
                return;
            }

            game.neuroshima?.group("Reroll Test");
            game.neuroshima?.log("Przerzucanie testu", { actor: actor.name, label: rollData.label, type: messageType });

            if (messageType === "weapon") {
                const weapon = actor.items.get(rollData.weaponId);
                if (!weapon) {
                    ui.notifications.error("Nie można znaleźć broni do przerzutu");
                    game.neuroshima?.groupEnd();
                    return;
                }

                if (!rollData.isJamming) {
                    await CombatHelper.refundAmmunition(message);
                }

                try {
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
                    });
                    await message.setFlag("neuroshima", "rerolled", true);
                } finally { game.neuroshima?.groupEnd(); }
            } else if (messageType === "initiative") {
                try {
                    await game.neuroshima.NeuroshimaDice.rollInitiative({
                        actor: actor,
                        attribute: rollData.attributeKey || "dexterity",
                        skill: rollData.skillKey || "",
                        useSkill: !!(rollData.skillKey),
                        modifier: rollData.penalties?.mod || 0,
                        skillBonus: rollData.skillBonus || 0,
                        attributeBonus: rollData.attributeBonus || 0,
                        rollMode: rollData.rollMode || game.settings.get("core", "rollMode"),
                        isReroll: true
                    });
                    await message.setFlag("neuroshima", "rerolled", true);
                } finally { game.neuroshima?.groupEnd(); }
            } else {
                try {
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
                    });
                    await message.setFlag("neuroshima", "rerolled", true);
                } finally { game.neuroshima?.groupEnd(); }
            }
        }
    });

    options.push({
        name: game.i18n.localize("NEUROSHIMA.MeleeDuel.StartDuelFromTarget"),
        icon: '<i class="fas fa-swords"></i>',
        condition: li => {
            if (!game.user.isGM) return false;
            const message = game.messages.get(li.dataset.messageId);
            const rollData = message?.getFlag("neuroshima", "rollData");
            return !!(rollData?.isMelee && rollData?.meleeAction === "attack");
        },
        callback: async li => {
            const message = game.messages.get(li.dataset.messageId);
            const rollData = message?.getFlag("neuroshima", "rollData");
            if (!rollData?.isMelee) return;

            let defenderUuid = null;
            const gmTargeted = [...game.user.targets];
            if (gmTargeted.length > 0) {
                defenderUuid = gmTargeted[0].document?.uuid ?? gmTargeted[0].actor?.uuid ?? null;
            }
            if (!defenderUuid && rollData.targets?.length > 0) {
                defenderUuid = rollData.targets[0];
            }
            if (!defenderUuid) {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.MeleeDuel.NoTargetForDuel"));
                return;
            }

            const attackerActor = (() => {
                if (message.speaker?.token) {
                    const scene = game.scenes.get(message.speaker.scene);
                    const tok = scene?.tokens.get(message.speaker.token);
                    if (tok?.actor) return tok.actor;
                }
                return game.actors.get(rollData.actorId);
            })();
            if (!attackerActor) return;

            let weapon = rollData.weaponId ? attackerActor.items.get(rollData.weaponId) : null;

            if (!weapon && rollData.beastItemId) {
                const beastItem = attackerActor.items.get(rollData.beastItemId);
                if (beastItem) {
                    const byTier = {};
                    for (const act of (beastItem.system.activities ?? [])) {
                        const t = Math.min(3, Math.max(1, act.successCost ?? 1));
                        if (!byTier[t]) byTier[t] = act.damage || "D";
                    }
                    weapon = {
                        id: null,
                        beastItemId: beastItem.id,
                        name: beastItem.name,
                        img: beastItem.img,
                        type: "weapon",
                        system: {
                            weaponType: "melee",
                            attribute: beastItem.system?.attribute || "dexterity",
                            skill: "experience",
                            attackBonus: 0,
                            defenseBonus: 0,
                            damageMelee1: byTier[1] ?? byTier[2] ?? byTier[3] ?? "D",
                            damageMelee2: byTier[2] ?? byTier[1] ?? byTier[3] ?? "D",
                            damageMelee3: byTier[3] ?? byTier[2] ?? byTier[1] ?? "D",
                            requiredBuild: 0,
                            piercing: 0,
                            magazine: null,
                            jamming: 20
                        }
                    };
                }
            }

            if (!weapon && attackerActor.type === "creature") {
                const sourceItems = attackerActor.items.filter(i => i.type === "beast-action");
                if (sourceItems.length) {
                    const sourceItem = sourceItems[0];
                    const byTier = {};
                    for (const item of sourceItems) {
                        for (const act of (item.system.activities ?? [])) {
                            const t = Math.min(3, Math.max(1, act.successCost ?? 1));
                            if (!byTier[t]) byTier[t] = act.damage || "D";
                        }
                    }
                    weapon = {
                        id: null,
                        beastItemId: sourceItem.id,
                        name: sourceItem.name,
                        img: sourceItem.img,
                        type: "weapon",
                        system: {
                            weaponType: "melee",
                            attribute: sourceItem.system?.attribute || "dexterity",
                            skill: "experience",
                            attackBonus: 0,
                            defenseBonus: 0,
                            damageMelee1: byTier[1] ?? byTier[2] ?? byTier[3] ?? "D",
                            damageMelee2: byTier[2] ?? byTier[1] ?? byTier[3] ?? "D",
                            damageMelee3: byTier[3] ?? byTier[2] ?? byTier[1] ?? "D",
                            requiredBuild: 0,
                            piercing: 0,
                            magazine: null,
                            jamming: 20
                        }
                    };
                }
            }

            if (!weapon) return;

            const mode = game.settings.get("neuroshima", "meleeCombatType") || "opposedPips";

            const rawResult = {
                modifiedResults: rollData.modifiedResults || [],
                successPoints: rollData.successPoints ?? 0,
                target: rollData.target,
                skill: rollData.skill ?? 0,
                rollMode: rollData.rollMode || game.settings.get("core", "rollMode")
            };

            const { MeleeOpposedChat } = await import("./module/combat/melee-opposed-chat.js");
            await MeleeOpposedChat._createHandlerCard(rawResult, attackerActor, weapon, defenderUuid, mode);
        }
    });
});

// Chat card interactions (v13: renderChatMessageHTML)
Hooks.on("renderChatMessageHTML", (message, html) => {
    // Initialize Neuroshima chat actions dispatcher
    NeuroshimaChatMessage.onChatAction(html);

    // Melee Vanilla Chat (default mode only)
    if ((game.settings.get("neuroshima", "meleeCombatType") || "default") === "default") {
        MeleeVanillaChat.onRender(html, message);
    }

    // Duel card (opposedPips / opposedSuccesses modes)
    if (message.getFlag("neuroshima", "duelCard")) {
        MeleeOpposedChat.onRenderDuelCard(html, message);
    }

    // Patient Card — collapsible UI
    const patientCard = html.querySelector(".neuroshima.patient-card");
    if (patientCard) {
        // Main toggle for all wounds
        const woundsMainToggle = patientCard.querySelector(".wounds-main-toggle");
        if (woundsMainToggle) {
            woundsMainToggle.addEventListener("click", () => {
                const woundsContainer = patientCard.querySelector(".wounds-container");
                const isCollapsed = woundsMainToggle.dataset.collapsed === "true";
                woundsMainToggle.dataset.collapsed = !isCollapsed;
                woundsContainer.style.display = isCollapsed ? "block" : "none";
            });
        }

        // Per-location toggle
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

    // Healing Request Card — collapsible UI
    const healingRequestCard = html.querySelector(".neuroshima.heal-request-card");
    if (healingRequestCard) {
        const woundsMainToggle = healingRequestCard.querySelector(".wounds-main-toggle");
        if (woundsMainToggle) {
            woundsMainToggle.addEventListener("click", () => {
                const woundsContainer = healingRequestCard.querySelector(".wounds-container");
                const isCollapsed = woundsMainToggle.dataset.collapsed === "true";
                woundsMainToggle.dataset.collapsed = !isCollapsed;
                woundsContainer.style.display = isCollapsed ? "block" : "none";
            });
        }

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

    // Healing Batch Report — visual button state
    const healingBatchReport = html.querySelector(".neuroshima.healing-batch-report");
    if (healingBatchReport) {
        const isApplied = message.getFlag("neuroshima", "healingApplied") === true;
        
        // Apply healing button
        const applyBtn = healingBatchReport.querySelector(".apply-healing-btn");
        if (applyBtn && isApplied) {
            applyBtn.disabled = true;
            applyBtn.textContent = "✓ " + game.i18n.localize("NEUROSHIMA.HealingRequest.ApplyHealing");
            applyBtn.classList.add("applied");
        }

        // Reroll button
        if (isApplied) {
            healingBatchReport.querySelectorAll(".reroll-healing-btn").forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = "0.5";
                btn.style.cursor = "not-allowed";
                btn.title = game.i18n.localize("NEUROSHIMA.Warnings.HealingAlreadyApplied");
            });
        }
    }

    // Selective dice reroll — click die-square.original to mark; context menu reroll uses selection
    const rollCard = html.querySelector(".neuroshima.roll-card, .neuroshima.weapon-roll-card, .neuroshima.melee-roll-card");
    if (rollCard) {
        const messageType = message?.getFlag("neuroshima", "messageType");
        const rollData = message?.getFlag("neuroshima", "rollData");
        if ((messageType === "roll" || messageType === "weapon" || messageType === "initiative") && rollData) {
            const actor = game.actors.get(rollData.actorId);
            const canReroll = game.user.isGM || actor?.isOwner;
            if (canReroll) {
                const isRerolled = message?.getFlag("neuroshima", "rerolled");
                const rerolledIndices = message?.getFlag("neuroshima", "rerolledIndices") ?? [];

                const dieElements = rollCard.querySelectorAll(".dice-results-grid .die-result");

                if (isRerolled && !game.user.isGM) {
                    rerolledIndices.forEach(idx => {
                        const dieEl = rollCard.querySelector(`.die-result[data-die-index="${idx}"]`);
                        dieEl?.querySelector(".die-square.original")?.classList.add("ns-selected-for-reroll");
                    });
                } else {
                    const trickPending = (messageType === "roll" || messageType === "initiative")
                        && (rollData?.dieManualBonus || 0) > 0
                        && !message?.getFlag("neuroshima", "trickBonusUsed");

                    window._nsRerollSelectedMap ??= new Map();
                    const selected = new Set();
                    window._nsRerollSelectedMap.set(message.id, selected);

                    if (!trickPending) {
                        dieElements.forEach(dieEl => {
                            if (dieEl.classList.contains("ignored")) return;
                            const square = dieEl.querySelector(".die-square.original");
                            if (!square) return;
                            square.classList.add("ns-rerollable");
                            square.addEventListener("click", () => {
                                const idx = parseInt(dieEl.dataset.dieIndex);
                                if (selected.has(idx)) {
                                    selected.delete(idx);
                                    square.classList.remove("ns-selected-for-reroll");
                                } else {
                                    selected.add(idx);
                                    square.classList.add("ns-selected-for-reroll");
                                }
                            });
                        });
                    }
                }
            }
        }
    }

    // Trick die bonus — select whole die-result rows to distribute reduction points, then apply
    const trickRollCard = html.querySelector(".neuroshima.roll-card");
    if (trickRollCard) {
        const trickMsgType = message?.getFlag("neuroshima", "messageType");
        const trickRollData = message?.getFlag("neuroshima", "rollData");
        if ((trickMsgType === "roll" || trickMsgType === "initiative") && trickRollData) {
            const trickBonus = trickRollData.dieManualBonus || 0;
            const trickUsed  = message?.getFlag("neuroshima", "trickBonusUsed");
            const trickActor = game.actors.get(trickRollData.actorId);
            const canUseTrick = game.user.isGM || trickActor?.isOwner;

            if (trickBonus > 0 && !trickUsed && canUseTrick) {
                if (!window._nsTrickState) window._nsTrickState = {};
                if (!window._nsTrickState[message.id]) {
                    window._nsTrickState[message.id] = { reductions: {}, remaining: trickBonus };
                }
                const state = window._nsTrickState[message.id];

                const updateDiePreview = (dieEl, idx) => {
                    const dieMod = (trickRollData.modifiedResults || [])[idx];
                    if (!dieMod) return;
                    const reduction = state.reductions[idx] || 0;
                    const trickModified = Math.max(1, dieMod.modified - reduction);
                    const isSucc = trickModified <= (trickRollData.target || 0) && dieMod.original !== 20;
                    const container = dieEl.querySelector(".die-square-container");

                    dieEl.querySelectorAll(".ns-trick-injected").forEach(e => e.remove());

                    const modSq = dieEl.querySelector(".die-square.modified");
                    if (modSq?.dataset.trickOrig !== undefined) {
                        modSq.textContent = modSq.dataset.trickOrig;
                        modSq.className = `die-square modified ${dieMod.isSuccess ? "success" : "failure"}`;
                        delete modSq.dataset.trickOrig;
                    }

                    if (reduction > 0) {
                        const existingMod = dieEl.querySelector(".die-square.modified");
                        if (existingMod) {
                            if (existingMod.dataset.trickOrig === undefined) {
                                existingMod.dataset.trickOrig = existingMod.textContent.trim();
                            }
                            existingMod.textContent = trickModified;
                            existingMod.className = `die-square modified ${isSucc ? "success" : "failure"}`;
                        } else {
                            const arrow = document.createElement("i");
                            arrow.className = "fas fa-long-arrow-alt-right ns-trick-injected";
                            const sq = document.createElement("span");
                            sq.className = `die-square modified ns-trick-injected ${isSucc ? "success" : "failure"}`;
                            sq.textContent = trickModified;
                            container.appendChild(arrow);
                            container.appendChild(sq);
                        }
                    }
                };

                const refreshAll = () => {
                    trickRollCard.querySelectorAll(".dice-results-grid .die-result:not(.ignored)").forEach(el => {
                        const i = parseInt(el.dataset.dieIndex);
                        const cur = state.reductions[i] || 0;
                        const dieMod = (trickRollData.modifiedResults || [])[i];
                        const canReduce = dieMod && (dieMod.modified - cur) > 1;
                        el.querySelector(".ns-trick-minus")?.toggleAttribute("disabled", cur <= 0);
                        el.querySelector(".ns-trick-plus")?.toggleAttribute("disabled", state.remaining <= 0 || !canReduce);
                    });
                    const counter = trickRollCard.querySelector(".ns-trick-counter");
                    if (counter) counter.textContent = `${game.i18n.localize("NEUROSHIMA.Roll.DieReductionCounter")} ${state.remaining} / ${trickBonus}`;
                };

                if (!trickRollCard.querySelector(".ns-trick-counter")) {
                    const counter = document.createElement("div");
                    counter.className = "ns-trick-counter";
                    counter.textContent = `${game.i18n.localize("NEUROSHIMA.Roll.DieReductionCounter")} ${state.remaining} / ${trickBonus}`;
                    const firstHr = trickRollCard.querySelector("hr.dotted-hr");
                    firstHr?.insertAdjacentElement("beforebegin", counter);
                }

                trickRollCard.querySelectorAll(".dice-results-grid .die-result").forEach(dieEl => {
                    if (dieEl.classList.contains("ignored")) return;
                    const idx = parseInt(dieEl.dataset.dieIndex);
                    const dieMod = (trickRollData.modifiedResults || [])[idx];

                    if (!dieMod || dieMod.original === 20 || dieMod.modified <= 1) return;

                    if (!dieEl.querySelector(".ns-trick-btns")) {
                        const btns = document.createElement("div");
                        btns.className = "ns-trick-btns";
                        btns.innerHTML = `
                            <button class="ns-trick-plus" type="button">+</button>
                            <button class="ns-trick-minus" type="button" disabled>−</button>
                        `;
                        dieEl.appendChild(btns);

                        btns.querySelector(".ns-trick-plus").addEventListener("click", async (ev) => {
                            ev.stopPropagation();
                            if (state.remaining > 0) {
                                state.reductions[idx] = (state.reductions[idx] || 0) + 1;
                                state.remaining--;
                                updateDiePreview(dieEl, idx);
                                refreshAll();
                                if (state.remaining === 0) {
                                    const { NeuroshimaSocket } = await import("./module/helpers/socket-helper.js");
                                    await NeuroshimaSocket.gmExecute("applyTrickDieBonus", message.id, { ...state.reductions });
                                    delete window._nsTrickState[message.id];
                                }
                            }
                        });

                        btns.querySelector(".ns-trick-minus").addEventListener("click", (ev) => {
                            ev.stopPropagation();
                            const cur = state.reductions[idx] || 0;
                            if (cur > 0) {
                                state.reductions[idx] = cur - 1;
                                state.remaining++;
                                updateDiePreview(dieEl, idx);
                                refreshAll();
                            }
                        });
                    }

                    updateDiePreview(dieEl, idx);
                });

                refreshAll();
            }
        }
    }

    // Location dropdown (Melee Opposed Result and Ranged Roll cards)
    const locationDropdown = html.querySelector(".opposed-location-dropdown");
    if (locationDropdown) {
        locationDropdown.addEventListener("change", async (ev) => {
            const newLocation = ev.target.value;
            await message.setFlag("neuroshima", "selectedLocation", newLocation);
            game.neuroshima?.log("Zmieniono wybraną lokację na karcie", { messageId: message.id, newLocation });
        });

        // Restore previously selected location from message flags
        const savedLocation = message.getFlag("neuroshima", "selectedLocation");
        if (savedLocation) {
            locationDropdown.value = savedLocation;
        }
    }

    const card = html.querySelector(".neuroshima.roll-card");
    if (!card) return;

    // Collapsible sections (all roll cards)
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
                
                // Refresh damage tab content on expand
                if (isHidden && content.classList.contains("damage-application-content")) {
                    const activeTab = card.querySelector(".damage-tab-header.active")?.dataset.tab || "targets";
                    updateCardTargets(card, activeTab, message);
                }
            }
        });
    });

    // Damage tab switching
    card.querySelectorAll(".damage-tab-header").forEach(tabHeader => {
        tabHeader.addEventListener("click", () => {
            const tab = tabHeader.dataset.tab;
            
            // Switch active header
            card.querySelectorAll(".damage-tab-header").forEach(h => h.classList.remove("active"));
            tabHeader.classList.add("active");

            // Switch visible container
            card.querySelectorAll(".target-list").forEach(l => {
                l.style.display = l.dataset.tab === tab ? "block" : "none";
            });

            updateCardTargets(card, tab, message);
        });
    });

    // Apply damage button
    card.querySelectorAll(".apply-damage-button").forEach(btn => {
        btn.addEventListener("click", async (event) => {
            event.preventDefault();
            
            game.neuroshima.group("Interfejs Obrażeń | Kliknięcie przycisku");
            
            const activeTab = card.querySelector(".damage-tab-header.active")?.dataset.tab;
            let actors = [];
            
            if (activeTab === "targets") {
                const snapshotTargets = message.getFlag("neuroshima", "rollData")?.snapshotTargets ?? [];
                if (snapshotTargets.length > 0) {
                    const resolved = await Promise.all(snapshotTargets.map(async t => {
                        if (t.uuid) {
                            const doc = await fromUuid(t.uuid);
                            return doc?.actor ?? (doc instanceof Actor ? doc : null);
                        }
                        return game.actors.get(t.id) ?? null;
                    }));
                    actors = resolved.filter(a => a);
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

    // Fire correction button
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

    // Reverse Damage button
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

// Dynamically hide elements based on user permissions (v13: renderChatMessageHTML)
Hooks.on("renderChatMessageHTML", (message, html) => {
    // Block the damage button if opposed result damage was already applied
    const opposedResult = message.getFlag("neuroshima", "opposedResult");
    if (opposedResult?.applied) {
        const applyBtn = html.querySelector(".apply-opposed-damage-btn");
        if (applyBtn) {
            applyBtn.disabled = true;
            applyBtn.classList.add("applied");
            applyBtn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DamageApplied")}`;
        }
    }

    // Restore fire correction visual state
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

    // Permission check for damage application section
    const damageApplicationMinRole = game.settings.get("neuroshima", "damageApplicationMinRole");
    if (game.user.role < damageApplicationMinRole && !game.user.isGM) {
        const damageSection = html.querySelector(".apply-damage-section");
        if (damageSection) {
            damageSection.style.display = "none";
        }
    }

    // Permission check for Pain Resistance details
    const painResistanceMinRole = game.settings.get("neuroshima", "painResistanceMinRole");
    if (game.user.role < painResistanceMinRole && !game.user.isGM) {
        const painResistanceDetails = html.querySelector(".pain-resistance-details");
        if (painResistanceDetails) {
            painResistanceDetails.remove();
        }
    }

    // Permission check for roll tooltips
    const rollTooltipMinRole = game.settings.get("neuroshima", "rollTooltipMinRole");
    const rollTooltipOwnerVisibility = game.settings.get("neuroshima", "rollTooltipOwnerVisibility");
    
    // Get actor ID from message flags
    const actorId = message.flags?.neuroshima?.rollData?.actorId;
    let actor = null;
    if (actorId) {
        actor = game.actors.get(actorId);
    }
    
    // Check if user has permission to view tooltips
    const canShowTooltip = game.user.role >= rollTooltipMinRole || 
                          (rollTooltipOwnerVisibility && (actor?.isOwner || game.user.isGM));
    
    if (!canShowTooltip) {
        // Remove all tooltip attributes from the chat card
        const tooltipElements = html.querySelectorAll("[data-tooltip]");
        tooltipElements.forEach(el => {
            el.removeAttribute("data-tooltip");
            el.removeAttribute("data-tooltip-direction");
        });
    }
});


/**
 * Refresh the targets/selected-tokens list on a chat card.
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
 * Register the socketlib socket for the system and attach all socket handlers.
 */
function initializeSocketlib() {
    if (typeof socketlib === "undefined") return;
    if (!game.neuroshima) {
        game.neuroshima = {}; // Emergency init if system.js hasn't fired yet
    }
    if (game.neuroshima.socket) return; // Already initialized

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

    game.neuroshima.socket.register("computeGrenadeBlast", async (data) => {
        const { templateId, messageId } = data;
        const templateDoc = canvas?.scene?.getEmbeddedDocument("MeasuredTemplate", templateId);
        if (!templateDoc) {
            console.warn("Neuroshima | computeGrenadeBlast: brak szablonu", templateId);
            return;
        }
        const blastZones = templateDoc.getFlag("neuroshima", "grenadeBlastZones") ?? [];
        const message    = game.messages.get(messageId);
        const actorId    = message?.getFlag("neuroshima", "grenadeRoll")?.actorId;
        const actor      = actorId ? game.actors.get(actorId) : null;
        game.neuroshima.log("computeGrenadeBlast (via socket)", { templateId, messageId, blastZonesCount: blastZones.length, hasActor: !!actor, hasMessage: !!message });
        const { NeuroshimaChatMessage } = await import("./module/documents/chat-message.js");
        await NeuroshimaChatMessage._computeGrenadeBlast(templateDoc, blastZones, actor, message);
    });

    game.neuroshima.socket.register("deleteGrenadeTemplates", async (messageId) => {
        if (!canvas?.scene || !messageId) return;
        const existing = canvas.scene.templates.filter(t => t.getFlag("neuroshima", "grenadeMessageId") === messageId);
        if (existing.length > 0) {
            await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", existing.map(t => t.id));
        }
    });

    game.neuroshima.socket.register("createGrenadeTemplate", async (templateData) => {
        if (!canvas?.scene) return null;
        const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
        return created?.[0]?.id ?? null;
    });

    // Chat message flag proxy — lets non-GM clients update message flags via GM
    game.neuroshima.socket.register("setChatMessageFlag", async (messageId, scope, key, value) => {
        const message = game.messages.get(messageId);
        if (!message) return;
        return message.setFlag(scope, key, value);
    });

    game.neuroshima.socket.register("updateChatMessageContent", async (messageId, content) => {
        const message = game.messages.get(messageId);
        if (!message) return;
        return message.update({ content });
    });

    game.neuroshima.socket.register("postVanillaCard", async (cardType, encounterId) => {
        const { MeleeVanillaChat } = await import("./module/combat/melee-vanilla-chat.js");
        if (cardType === "start") {
            await MeleeVanillaChat._syncEncounter(encounterId);
        } else if (cardType === "result") {
            const { MeleeStore } = await import("./module/combat/melee-store.js");
            const enc = MeleeStore.getEncounter(encounterId);
            if (enc) await MeleeVanillaChat._postResultCard(encounterId, enc, null);
        }
    });

    // Trick die bonus — applied as GM so the message can always be updated
    game.neuroshima.socket.register("applyTrickDieBonus", async (messageId, reductions) => {
        const { NeuroshimaDice } = await import("./module/helpers/dice.js");
        const message = game.messages.get(messageId);
        if (!message) return;
        await NeuroshimaDice.applyTrickDieBonus(message, reductions);
    });

    game.neuroshima.socket.register("resetTrickDieBonus", async (messageId) => {
        const { NeuroshimaDice } = await import("./module/helpers/dice.js");
        const message = game.messages.get(messageId);
        if (!message) return;
        await NeuroshimaDice.resetTrickDieBonus(message);
    });

    // Skill allocation patch — executed as GM so the message flag can be written
    game.neuroshima.socket.register("applySkillAlloc", async (messageId, patch) => {
        const { MeleeOpposedChat } = await import("./module/combat/melee-opposed-chat.js");
        await MeleeOpposedChat.applyAllocPatch(messageId, patch);
    });

    game.neuroshima.socket.register("applyDuelPick", async (messageId, side, dieIdx) => {
        await MeleeOpposedChat.applyDuelBatch(messageId, side, [dieIdx]);
    });

    game.neuroshima.socket.register("applyDuelBatch", async (messageId, pool, diceIndices, action, beastQueue) => {
        await MeleeOpposedChat.applyDuelBatch(messageId, pool, diceIndices, action ?? null, beastQueue ?? null);
    });

    game.neuroshima.socket.register("healingRequestPrompt", async ({ patientUuid, patientName, patientPortrait, requesterUserId, medicActorUuid, isPrivate }) => {
        const gmNeedsActorPick = game.user.isGM && !medicActorUuid;

        const dropZoneSection = gmNeedsActorPick ? `
            <p>${game.i18n.localize("NEUROSHIMA.HealingRequest.ChooseMedicActor")}</p>
            <div class="ns-section-divider">
                <div class="ns-actor-container" id="ns-medic-drop-zone">
                    <div id="ns-medic-preview"><p>${game.i18n.localize("NEUROSHIMA.HealingRequest.DropActorHint")}</p></div>
                </div>
                <div class="flexrow">
                    <button type="button" id="ns-pick-prompt-token" style="width:100%;">
                        <i class="fas fa-expand"></i> ${game.i18n.localize("NEUROSHIMA.HealingRequest.PickControlledToken")}
                    </button>
                </div>
            </div>` : "";

        const TIMEOUT_MS = 60_000;
        let autoCloseTimer = null;

        const _setupDropZone = () => {
            const dropZone = document.querySelector("#ns-medic-drop-zone");
            if (!dropZone || dropZone.dataset.nsSetup) return;
            dropZone.dataset.nsSetup = "1";

            const appEl = dropZone.closest(".app, .window-app, dialog");
            const acceptBtn = appEl?.querySelector('[data-action="accept"]');
            const preview = document.querySelector("#ns-medic-preview");

            if (acceptBtn) acceptBtn.disabled = true;

            autoCloseTimer = setTimeout(() => {
                autoCloseTimer = null;
                appEl?.querySelector(".header-button.close")?.click();
            }, TIMEOUT_MS);

            const resolveActor = (data) => {
                if (data.uuid) {
                    const doc = fromUuidSync?.(data.uuid) ?? null;
                    return doc?.actor ?? doc;
                }
                if (data.actorId) return game.actors.get(data.actorId) ?? null;
                if (data.tokenId) {
                    if (data.sceneId) return fromUuidSync?.(`Scene.${data.sceneId}.Token.${data.tokenId}`)?.actor ?? null;
                    return canvas.tokens.get(data.tokenId)?.actor ?? null;
                }
                return null;
            };

            const setPreview = (actor) => {
                dropZone.dataset.actorUuid = actor.uuid;
                if (preview) {
                    preview.innerHTML = `
                        <div class="flexcol" style="align-items:center;gap:4px;">
                            <img src="${actor.img}" style="width:52px;height:52px;border-radius:4px;object-fit:cover;" />
                            <span>${actor.name}</span>
                        </div>`;
                }
                if (acceptBtn) acceptBtn.disabled = false;
            };

            let dragCounter = 0;
            dropZone.addEventListener("dragover", e => e.preventDefault());
            dropZone.addEventListener("dragenter", e => {
                e.preventDefault();
                dragCounter++;
                dropZone.classList.add("drag-over");
            });
            dropZone.addEventListener("dragleave", () => {
                dragCounter = Math.max(0, dragCounter - 1);
                if (dragCounter === 0) dropZone.classList.remove("drag-over");
            });
            dropZone.addEventListener("drop", e => {
                e.preventDefault();
                dragCounter = 0;
                dropZone.classList.remove("drag-over");
                let data;
                try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
                if (data.type !== "Actor" && data.type !== "Token") return;
                const actor = resolveActor(data);
                if (actor) setPreview(actor);
            });

            document.querySelector("#ns-pick-prompt-token")?.addEventListener("click", () => {
                const controlled = canvas?.tokens?.controlled ?? [];
                if (controlled.length !== 1) {
                    ui.notifications.warn(game.i18n.localize("NEUROSHIMA.HealingRequest.SelectOneToken"));
                    return;
                }
                const actor = controlled[0].actor;
                if (actor) setPreview(actor);
            });
        };

        if (gmNeedsActorPick) {
            requestAnimationFrame(() => {
                _setupDropZone();
                if (!document.querySelector("#ns-medic-drop-zone")?.dataset.nsSetup) {
                    setTimeout(_setupDropZone, 100);
                }
            });
        }

        const result = await foundry.applications.api.DialogV2.wait({
            window: {
                title: game.i18n.localize("NEUROSHIMA.HealingRequest.Title"),
                icon: "fas fa-heartbeat"
            },
            content: `
                <div class="neuroshima healing-request-prompt">
                    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
                        ${patientPortrait ? `<img src="${patientPortrait}" style="width:48px;height:48px;border-radius:4px;border:1px solid #888;object-fit:cover;" />` : ""}
                        <p style="margin:0;">${game.i18n.format("NEUROSHIMA.HealingRequest.RequestReceived", { patient: patientName })}</p>
                    </div>
                    ${dropZoneSection}
                    <div class="ns-timer-bar"><div class="ns-timer-fill"></div></div>
                </div>`,
            buttons: [
                {
                    action: "accept",
                    label: game.i18n.localize("NEUROSHIMA.HealingRequest.Accept"),
                    icon: "fas fa-check",
                    default: true,
                    callback: (event, button) => {
                        const pickedUuid = button.form?.querySelector("#ns-medic-drop-zone")?.dataset.actorUuid ?? null;
                        return { accepted: true, pickedUuid };
                    }
                },
                {
                    action: "decline",
                    label: game.i18n.localize("NEUROSHIMA.HealingRequest.Decline"),
                    icon: "fas fa-times",
                    callback: () => ({ accepted: false, pickedUuid: null })
                }
            ],
            rejectClose: false
        });

        if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }

        if (!result?.accepted) {
            if (requesterUserId) {
                const { NeuroshimaSocket } = await import("./module/helpers/socket-helper.js");
                await NeuroshimaSocket.executeAsUser("healingRequestDeclined", requesterUserId, {
                    medicName: game.user.character?.name ?? game.user.name
                });
            }
            return false;
        }

        const resolvedMedicUuid = result.pickedUuid ?? medicActorUuid ?? game.user.character?.uuid ?? null;
        if (!resolvedMedicUuid) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.HealingRequest.NoActorForGM"));
            return false;
        }

        const medicDoc = await fromUuid(resolvedMedicUuid);
        const medicActor = medicDoc?.actor ?? medicDoc;
        const medicName = medicActor?.name ?? game.user.name;

        const gmUserIds = game.users.filter(u => u.isGM).map(u => u.id);
        const whisperIds = (isPrivate ?? false)
            ? [...new Set([requesterUserId, game.user.id, ...gmUserIds].filter(Boolean))]
            : [];

        await ChatMessage.create({
            user: game.user.id,
            speaker: medicActor ? ChatMessage.getSpeaker({ actor: medicActor }) : ChatMessage.getSpeaker({}),
            content: `<div class="neuroshima healing-started" style="display:flex;align-items:center;gap:8px;">
                <i class="fas fa-heartbeat" style="color:#c44;"></i>
                <span>${game.i18n.format("NEUROSHIMA.HealingRequest.HealingStarted", { medic: medicName, patient: patientName })}</span>
            </div>`,
            whisper: whisperIds,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER,
            flags: {
                neuroshima: {
                    messageType: "healingStarted",
                    patientUuid,
                    medicUuid: resolvedMedicUuid
                }
            }
        });

        const { HealingApp } = await import("./module/apps/healing-app.js");
        const app = new HealingApp({
            patientRef: { uuid: patientUuid },
            medicRef: { uuid: resolvedMedicUuid },
            isPrivate: isPrivate ?? false
        });
        app.render(true);
        return true;
    });

    game.neuroshima.socket.register("healingRequestDeclined", async ({ medicName }) => {
        ui.notifications.warn(game.i18n.format("NEUROSHIMA.HealingRequest.RequestDeclined", { medic: medicName }));
    });

}

// Register socketlib after module load
Hooks.once("socketlib.ready", () => {
    initializeSocketlib();
});

// Fallback init in setup (in case the socketlib.ready hook already fired)
Hooks.once("setup", () => {
    initializeSocketlib();
});

// "Request Healing" button in the player list (analogous to Item Piles' Request Trade)
Hooks.on("renderPlayers", (app, html) => {
    if (!game.user.isGM && !game.user.character) return;

    const label = game.i18n.localize("NEUROSHIMA.HealingRequest.RequestHealingButton");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ns-request-healing-button";
    btn.innerHTML = `<i class="fas fa-heartbeat"></i> ${label}`;
    btn.addEventListener("click", async () => {
        const { NeuroshimaActorSheet } = await import("./module/sheets/actor-sheet.js");
        NeuroshimaActorSheet.requestHealingFor(game.user.character ?? null);
    });

    const list = html.querySelector?.("#players-active .players-list")
        ?? html.find?.("#players-active .players-list")?.[0];
    if (list) list.append(btn);
});

// Global hooks for UI refresh
Hooks.on("targetToken", (user) => {
    if (user.id === game.user.id) refreshAllCombatCards();
});

Hooks.on("controlToken", () => {
    refreshAllCombatCards();
});

Hooks.on("createToken", async (tokenDocument, options, userId) => {
    if (userId !== game.user.id) return;
    await NeuroshimaScriptRunner.runCreateToken(tokenDocument);
    if (game.user.isGM) {
        const { NeuroshimaAuraManager } = await import("./module/apps/aura-manager.js");
        await NeuroshimaAuraManager.refreshAllAuras();
    }
});

Hooks.on("preUpdateToken", (tokenDocument, changes, options) => {
    if (!game.user.isGM) return;
    if (!("x" in changes) && !("y" in changes)) return;
    if (!options._nsNewPos) options._nsNewPos = {};
    options._nsNewPos[tokenDocument.id] = {
        x: changes.x ?? tokenDocument.x,
        y: changes.y ?? tokenDocument.y
    };
});

Hooks.on("updateToken", async (tokenDocument, changes, options) => {
    if (!game.user.isGM) return;
    if (!("x" in changes) && !("y" in changes)) return;
    const { NeuroshimaAuraManager } = await import("./module/apps/aura-manager.js");
    const movedTokenNewPos = options._nsNewPos?.[tokenDocument.id] ?? null;
    await NeuroshimaAuraManager.refreshAllAuras(tokenDocument, movedTokenNewPos);
});

Hooks.on("deleteToken", async (tokenDocument, options, userId) => {
    if (!game.user.isGM) return;
    const { NeuroshimaAuraManager } = await import("./module/apps/aura-manager.js");
    const actor = tokenDocument.actor;
    const deletedTokenId = tokenDocument.id;
    if (actor) {
        await NeuroshimaAuraManager.removeAllCopiesForEffect(null, actor.id, actor.uuid);
    }
    for (const otherToken of canvas.scene?.tokens ?? []) {
        if (otherToken.id === deletedTokenId) continue;
        const otherActor = otherToken.actor;
        if (!otherActor) continue;
        const stale = (otherActor.effects ?? []).filter(e => {
            const fa = e.getFlag("neuroshima", "fromAura");
            if (!fa || !actor) return false;
            return fa.sourceActorUuid
                ? fa.sourceActorUuid === actor.uuid
                : fa.sourceActorId === actor.id && fa.sourceTokenId === deletedTokenId;
        });
        if (stale.length) {
            await otherActor.deleteEmbeddedDocuments("ActiveEffect", stale.map(e => e.id), { ns_skipAuraCleanup: true });
        }
    }
});

Hooks.on("canvasReady", async () => {
    if (!game.user.isGM) return;
    const { NeuroshimaAuraManager } = await import("./module/apps/aura-manager.js");
    await NeuroshimaAuraManager.refreshAllAuras();
});

let _worldTimeUpdatePending = false;
Hooks.on("updateWorldTime", async (worldTime, dt) => {
    if (!game.user.isGM) return;
    _worldTimeUpdatePending = true;
    try {
        await NeuroshimaScriptRunner.runWorldTimeUpdate(worldTime, dt);
    } finally {
        setTimeout(() => { _worldTimeUpdatePending = false; }, 200);
    }
});

Hooks.on("simple-calendar.dateTimeChange", async (data) => {
    if (!game.user.isGM) return;
    if (_worldTimeUpdatePending) return;
    const currentWorldTime = game.time.worldTime;
    const dt = typeof data?.diff === "number" ? data.diff : 0;
    if (dt === 0) return;
    await NeuroshimaScriptRunner.runWorldTimeUpdate(currentWorldTime, dt);
});

Hooks.on("createMeasuredTemplate", async (templateDoc, options, userId) => {
    if (templateDoc.getFlag("neuroshima", "fromAreaEffect")) {
        if (!game.user.isGM) return;
        const { NeuroshimaAuraManager } = await import("./module/apps/aura-manager.js");
        await NeuroshimaAuraManager.applyAreaEffect(templateDoc);
    }

    if (templateDoc.getFlag("neuroshima", "isGrenadeTemplate")) {
        const gmActive = game.users.some(u => u.isGM && u.active);
        if (!game.user.isGM && gmActive) return;

        const blastZones = templateDoc.getFlag("neuroshima", "grenadeBlastZones") ?? [];
        const messageId  = templateDoc.getFlag("neuroshima", "grenadeMessageId");
        const message    = game.messages.get(messageId);
        const actorId    = message?.getFlag("neuroshima", "grenadeRoll")?.actorId;
        const actor      = actorId ? game.actors.get(actorId) : null;
        game.neuroshima.log("createMeasuredTemplate | granat", { templateId: templateDoc.id, isGM: game.user.isGM, blastZonesCount: blastZones.length, messageId, hasActor: !!actor });
        const { NeuroshimaChatMessage } = await import("./module/documents/chat-message.js");
        await NeuroshimaChatMessage._computeGrenadeBlast(templateDoc, blastZones, actor, message);
    }
});

Hooks.on("updateMeasuredTemplate", async (templateDoc, changes, options, userId) => {
    if (!game.user.isGM) return;
    if (!templateDoc.getFlag("neuroshima", "fromAreaEffect")) return;
    const { NeuroshimaAuraManager } = await import("./module/apps/aura-manager.js");
    await NeuroshimaAuraManager.applyAreaEffect(templateDoc);
});

Hooks.on("deleteMeasuredTemplate", async (templateDoc, options, userId) => {
    if (!game.user.isGM) return;
    if (!templateDoc.getFlag("neuroshima", "fromAreaEffect")) return;
    const { NeuroshimaAuraManager } = await import("./module/apps/aura-manager.js");
    await NeuroshimaAuraManager.removeAreaCopies(templateDoc.id);
});

Hooks.on("createActor", async (actor, options, userId) => {
    if (!["character", "npc"].includes(actor.type)) return;
    if (userId !== game.user.id) return;

    const itemsToCreate = [];

    let currencies = [];
    try {
        const saved = JSON.parse(game.settings.get("neuroshima", "currencies") || "null");
        if (Array.isArray(saved) && saved.length) currencies = saved;
    } catch(e) {}
    if (!currencies.length) currencies = [DEFAULT_CURRENCY];
    for (const c of currencies) {
        itemsToCreate.push({
            type: "money",
            name: c.name,
            img:  c.img || DEFAULT_CURRENCY.img,
            system: { coinValue: c.coinValue ?? 1, quantity: 0, weight: c.weight ?? 0 }
        });
    }

    const defaultRepItems = game.settings.get("neuroshima", "defaultReputationItems") ?? [];
    for (const r of defaultRepItems) {
        if (!r.name) continue;
        itemsToCreate.push({
            type: "reputation",
            name: r.name,
            img:  r.img || "systems/neuroshima/assets/img/shaking-hands.svg",
            system: { value: 0 }
        });
    }

    if (itemsToCreate.length) {
        await actor.createEmbeddedDocuments("Item", itemsToCreate);
    }
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

Hooks.once("item-piles-ready", () => {
    const NEUROSHIMA_IP_STYLE_DEFAULTS = {
        "inactive":              "rgba(144,144,130,1)",
        "minor-inactive":        "rgba(80,78,70,1)",
        "shadow-primary":        "rgba(160,46,46,0.8)",
        "even-color":            "rgba(0,0,0,0.12)",
        "odd-color":             "rgba(0,0,0,0.04)",
        "border-dark-primary":   "rgba(25,24,19,1)",
        "border-light-primary":  "rgba(181,179,164,1)",
        "text-light-highlight":  "rgba(216,216,200,1)",
        "text-important":        "rgba(160,46,46,1)"
    };
    try {
        const saved = game.settings.get("item-piles", "cssVariables") ?? {};
        const alreadySet = Object.keys(NEUROSHIMA_IP_STYLE_DEFAULTS).every(
            k => saved[k] === NEUROSHIMA_IP_STYLE_DEFAULTS[k]
        );
        if (!alreadySet) {
            game.settings.set("item-piles", "cssVariables", NEUROSHIMA_IP_STYLE_DEFAULTS);
        }
        for (const [key, value] of Object.entries(NEUROSHIMA_IP_STYLE_DEFAULTS)) {
            document.documentElement.style.setProperty(`--item-piles-${key}`, value);
        }
    } catch(e) { }

    const ipStyle = document.createElement("style");
    ipStyle.id = "neuroshima-itempiles-overrides";
    document.head.querySelector("#neuroshima-itempiles-overrides")?.remove();
    ipStyle.textContent = `
        .item-piles-app .item-piles-item-row .item-piles-img-container {
            height: 64px;
            min-height: 64px;
            max-height: 64px;
            min-width: 48px;
            max-width: 128px;
            width: max-content;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            flex-shrink: 0;
        }
        .item-piles-app .item-piles-item-row .item-piles-img-container .item-piles-img {
            height: 100%;
            width: auto;
        }
        .item-piles-app .item-piles-img-container.not-for-sale {
            position: relative;
        }
        .item-piles-app .item-piles-img-container.not-for-sale::before {
            content: "";
            position: absolute;
            inset: 0;
            background: rgba(220, 38, 38, 0.2);
            border-radius: 3px;
            z-index: 1;
            transform: none;
            border-top: none;
        }
        .item-piles-app .item-piles-img-container.not-for-sale::after {
            content: "";
            position: absolute;
            inset: 0;
            background-image: url("/systems/neuroshima/assets/img/scales.svg");
            background-size: 60%;
            background-repeat: no-repeat;
            background-position: center;
            z-index: 2;
            pointer-events: none;
            opacity: 0.85;
            filter: drop-shadow(0 0 2px rgba(0,0,0,0.8));
        }

        .item-piles-app .item-piles-item-sublist {
            background-color: rgba(255, 255, 255, 0.05);
        }

        .item-piles-app .item-piles-trading-sheet .item-piles-quantity-text {
            background-color: rgba(255, 255, 255, 0.08);
            color: rgba(216, 216, 200, 1);
        }
        .item-piles-app .item-piles-trading-sheet .item-piles-quantity-text:hover {
            background-color: rgba(255, 255, 255, 0.18);
        }

        .item-piles-chat-card li:nth-child(odd) {
            background-color: rgba(255, 255, 255, 0.08);
        }

        .price-list {
            background-color: rgba(28, 26, 22, 0.98);
            color: rgba(216, 216, 200, 1);
            border: 1px solid rgba(80, 78, 70, 0.7);
        }
        .price-list .price-group.selected {
            background-color: rgba(255, 255, 255, 0.12);
        }
        .price-list .price-group:hover {
            background-color: rgba(255, 255, 255, 0.18);
        }
        .price-list .price-group:not(:last-child) {
            border-bottom-color: rgba(80, 78, 70, 0.5);
        }
        .price-list .price-group .price-group-container * {
            color: rgba(216, 216, 200, 1);
        }
    `;
    document.head.appendChild(ipStyle);

    try {
        const rawLabels = Object.values(NEUROSHIMA.gearTypes).map(v => game.i18n.localize(v));
        const stale = new Set([
            ...rawLabels,
            ...rawLabels.map(l => "\uFFFF" + l),
            ...rawLabels.map(l => "\u200A" + l)
        ]);
        const freshLabels = rawLabels.map(l => "\u200A" + l);
        const existing = game.settings.get("item-piles", "customItemCategories") ?? [];
        const userDefined = existing.filter(l => !stale.has(l));
        const merged = [...userDefined, ...freshLabels];
        const changed = merged.length !== existing.length || merged.some((v, i) => v !== existing[i]);
        if (changed) game.settings.set("item-piles", "customItemCategories", merged);
    } catch(e) { }

    game.itempiles.API.addSystemIntegration({
        VERSION: "1.0.0",

        ACTOR_CLASS_TYPE: "npc",

        ITEM_CLASS_LOOT_TYPE: "gear",
        ITEM_CLASS_WEAPON_TYPE: "weapon",
        ITEM_CLASS_EQUIPMENT_TYPE: "gear",

        ITEM_QUANTITY_ATTRIBUTE: "system.quantity",
        ITEM_PRICE_ATTRIBUTE: "system.effectiveCost",

        ITEM_TYPE_ATTRIBUTE: "pileCategory",

        ITEM_FILTERS: [
            { path: "type", filters: "container,trait,trick,wound,specialization,origin,profession,vehicle-damage,reputation,disease,facility" }
        ],

        ITEM_COST_TRANSFORMER: (item, currencies) => {
            return Number(foundry.utils.getProperty(item, "system.effectiveCost") ?? foundry.utils.getProperty(item, "system.cost")) || 0;
        },

        PRICE_MODIFIER_TRANSFORMER: ({ buyPriceModifier, sellPriceModifier, item }) => {
            if (item?.type !== "gear") return { buyPriceModifier, sellPriceModifier };
            const gearType = item?.system?.gearType ?? "misc";
            let modifiers = {};
            try {
                modifiers = JSON.parse(game.settings.get("neuroshima", "gearTypePriceModifiers") || "{}");
            } catch(e) {}
            const mod = modifiers[gearType];
            let buyMult = 1, sellMult = 1;
            if (typeof mod === "number")             { buyMult = sellMult = mod; }
            else if (mod && typeof mod === "object") { buyMult = mod.buy ?? 1; sellMult = mod.sell ?? 1; }
            return {
                buyPriceModifier:  buyPriceModifier  * buyMult,
                sellPriceModifier: sellPriceModifier * sellMult
            };
        },

        ITEM_SIMILARITIES: ["name", "type"],

        CURRENCIES: (() => {
            let saved = [];
            try {
                const raw = JSON.parse(game.settings.get("neuroshima", "currencies") || "null");
                if (Array.isArray(raw) && raw.length) saved = raw;
            } catch(e) {}
            if (!saved.length) saved = [DEFAULT_CURRENCY];
            return saved.map(c => ({
                type: "item",
                name: c.name,
                img:  c.img || DEFAULT_CURRENCY.img,
                abbreviation: c.abbreviation || `{#}${c.name}`,
                data: {
                    item: {
                        name:   c.name,
                        type:   "money",
                        img:    c.img || DEFAULT_CURRENCY.img,
                        system: { coinValue: c.coinValue ?? 1, quantity: 1, weight: c.weight ?? 0 }
                    }
                },
                primary:      !!c.primary,
                exchangeRate: c.exchangeRate ?? 1
            }));
        })()
    });

    Hooks.on("createItem", async (item, _options, userId) => {
        if (userId !== game.userId) return;

        if (item.type === "gear") {
            const gearType = item.system?.gearType ?? "misc";
            const i18nKey = NEUROSHIMA.gearTypes[gearType];
            const label = "\u200A" + (i18nKey ? game.i18n.localize(i18nKey) : game.i18n.localize("NEUROSHIMA.GearType.misc"));
            await item.setFlag("item-piles", "item.customCategory", label);
        }

        const actor = item.parent;
        if (actor instanceof Actor && game.user.isGM) {
            await actor._checkAutoConditions?.();
        }
    });

    Hooks.on("updateItem", async (item, changes, _options, userId) => {
        if (userId !== game.userId) return;

        if (item.type === "gear" && foundry.utils.hasProperty(changes, "system.gearType")) {
            const gearType = changes.system?.gearType ?? "misc";
            const i18nKey = NEUROSHIMA.gearTypes[gearType];
            const label = "\u200A" + (i18nKey ? game.i18n.localize(i18nKey) : game.i18n.localize("NEUROSHIMA.GearType.misc"));
            await item.setFlag("item-piles", "item.customCategory", label);
        }

        const actor = item.parent;
        if (actor instanceof Actor && game.user.isGM) {
            await actor._checkAutoConditions?.();
        }
    });

    Hooks.on("deleteItem", async (item, _options, userId) => {
        if (userId !== game.userId) return;
        const actor = item.parent;
        if (actor instanceof Actor && game.user.isGM) {
            await actor._checkAutoConditions?.();
        }
    });
});

