import { NEUROSHIMA } from "./module/config.js";
import { NeuroshimaActor } from "./module/documents/actor.js";
import { NeuroshimaItem } from "./module/documents/item.js";
import { NeuroshimaActorData } from "./module/data/actor-data.js";
import { WeaponData, ArmorData, GearData, AmmoData, MagazineData, TrickData, WoundData } from "./module/data/item-data.js";
import { NeuroshimaActorSheet } from "./module/sheets/actor-sheet.js";
import { NeuroshimaItemSheet } from "./module/sheets/item-sheet.js";
import { NeuroshimaDice } from "./module/helpers/dice.js";
import { CombatHelper } from "./module/helpers/combat-helper.js";
import { EncumbranceConfig } from "./module/apps/encumbrance-config.js";
import { DebugRollDialog } from "./module/apps/debug-roll-dialog.js";
import { EditRollDialog } from "./module/apps/edit-roll-dialog.js";

// Inicjalizacja systemu Neuroshima 1.5
Hooks.once('init', async function() {
    console.log('Neuroshima 1.5 | Inicjalizacja systemu');

    // Przypisanie niestandardowych klas i stałych
    game.neuroshima = {
        NeuroshimaActor,
        NeuroshimaItem,
        NeuroshimaDice,
        CombatHelper,
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
        })
    };

    // Zdefiniowanie niestandardowych klas dokumentów
    CONFIG.Actor.documentClass = NeuroshimaActor;
    CONFIG.Item.documentClass = NeuroshimaItem;

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
    Handlebars.registerHelper('eq', (a, b) => a === b);
    Handlebars.registerHelper('ne', (a, b) => a !== b);
    Handlebars.registerHelper('add', (a, b) => a + b);
    Handlebars.registerHelper('json', (context) => JSON.stringify(context));

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
        config: true,
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
        config: true,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    // Rejestracja menu ustawień
    game.settings.registerMenu("neuroshima", "encumbranceConfig", {
        name: "NEUROSHIMA.Settings.EncumbranceConfig.Label",
        label: "NEUROSHIMA.Settings.EncumbranceConfig.Title",
        hint: "NEUROSHIMA.Settings.EncumbranceConfig.Hint",
        icon: "fas fa-weight-hanging",
        type: EncumbranceConfig,
        restricted: true,
        requiresReload: true
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

    // Wczytanie szablonów (v13 namespaced)
    await foundry.applications.handlebars.loadTemplates([
        "systems/neuroshima/templates/actor/parts/actor-header.hbs",
        "systems/neuroshima/templates/actor/parts/actor-info.hbs",
        "systems/neuroshima/templates/actor/parts/actor-attributes.hbs",
        "systems/neuroshima/templates/actor/parts/actor-skills.hbs",
        "systems/neuroshima/templates/actor/parts/actor-tricks.hbs",
        "systems/neuroshima/templates/actor/parts/actor-combat.hbs",
        "systems/neuroshima/templates/actor/parts/actor-inventory.hbs",
        "systems/neuroshima/templates/actor/parts/actor-notes.hbs",
        "systems/neuroshima/templates/item/item-sheet.hbs",
        "systems/neuroshima/templates/item/item-header.hbs",
        "systems/neuroshima/templates/item/item-details.hbs",
        "systems/neuroshima/templates/item/item-effects.hbs",
        "systems/neuroshima/templates/item/parts/weapon-melee.hbs",
        "systems/neuroshima/templates/item/parts/weapon-ranged.hbs",
        "systems/neuroshima/templates/item/parts/weapon-thrown.hbs",
        "systems/neuroshima/templates/item/parts/wound-details.hbs",
        "systems/neuroshima/templates/item/parts/ammo-details.hbs",
        "systems/neuroshima/templates/item/parts/magazine-details.hbs",
        "systems/neuroshima/templates/item/parts/ammunition-details.hbs"
    ]);

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
            return flags?.isWeapon && (flags.bulletSequence?.length > 0) && !alreadyRefunded && game.user.isGM;
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
            return isReport && !alreadyReversed && game.user.isGM;
        },
        callback: li => {
            const message = game.messages.get(li.dataset.messageId);
            CombatHelper.reverseDamage(message);
        }
    });
});

// Obsługa interakcji na kartach czatu
Hooks.on("renderChatMessage", (message, html, data) => {
    // html może być obiektem jQuery lub HTMLElement w zależności od wersji/kontekstu
    const element = html instanceof HTMLElement ? html : html[0];
    const card = element.querySelector(".neuroshima.roll-card");
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
        const img = token.document?.texture?.src || token.data?.img;
        html += `<div class="target-item">
            <img src="${img}" width="20" height="20" style="object-fit: cover; border-radius: 4px; border: 1px solid #777; margin-right: 5px;"/>
            <span>${token.name}</span>
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

// Rejestracja globalnych hooków dla odświeżania interfejsu
Hooks.on("targetToken", (user) => {
    if (user.id === game.user.id) refreshAllCombatCards();
});

Hooks.on("controlToken", () => {
    refreshAllCombatCards();
});
