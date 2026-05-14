import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/dice.js";
import { NeuroshimaItem } from "../documents/item.js";
import { NeuroshimaWeaponRollDialog } from "../apps/weapon-roll-dialog.js";
import { AmmunitionLoadingDialog } from "../apps/ammo-loading-dialog.js";
import { RestDialog } from "../apps/rest-dialog.js";
import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";
import { CombatHelper } from "../helpers/combat-helper.js";
import { getConditions } from "../apps/condition-config.js";
import { TraitChoiceDialog } from "../apps/trait-choice-dialog.js";
import { NeuroshimaGrenadeRollDialog } from "../apps/grenade-roll-dialog.js";
import { NeuroshimaBaseActorSheet } from "./actor-sheet-base.js";
import { getEffectiveArmorRatings } from "../helpers/mod-helpers.js";

function _collectArmorBonusByEffect(actor) {
  const byLoc = {};
  if (!actor) return byLoc;
  const seen = new Set();
  for (const effect of actor.appliedEffects ?? []) {
    const key = effect.origin ?? effect.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const change of effect.changes ?? []) {
      const m = change.key.match(/^system\.armorBonus\.(\w+)$/);
      if (!m) continue;
      const loc = m[1];
      if (!byLoc[loc]) byLoc[loc] = [];
      byLoc[loc].push({ name: effect.name, value: Number(change.value) || 0 });
    }
  }
  return byLoc;
}

/**
 * Actor sheet for Neuroshima 1.5 using ApplicationV2.
 */
export class NeuroshimaActorSheet extends NeuroshimaBaseActorSheet {
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "actor"],
    position: {
      width: 750,
      height: 850
    },
    window: {
      title: "NEUROSHIMA.Sheet.ActorTitle",
      resizable: true,

    },
    // W AppV2 scrollable działa tak samo - tablica selektorów CSS
    renderConfig: {
      scrollable: [".skill-table",".inventory",".combat"]
    },
    form: {
      submitOnChange: true,
      submitOnClose: true,
      submitOnUnfocus: true
    },
    forms: {
      standard: {
        elements: {
          "system.notes": {
            editor: {
              engine: "prosemirror",
              collaborative: false
            }
          }
        }
      }
    },
    actions: {
      editImage: this.prototype._onEditImage,
      toggleDifficulties: this.prototype._onToggleDifficulties,
      rollAttribute: this.prototype._onRollAttribute, 
      rollSkill: this.prototype._onRollSkill,
      createItem: this.prototype._onCreateItem,
      editItem: this.prototype._onEditItem,
      deleteItem: this.prototype._onDeleteItem,
      toggleEquipped: this.prototype._onToggleEquipped,
      adjustQuantity: this.prototype._onAdjustQuantity,
      modifyDurability: this.prototype._onModifyDurability,
      modifyAP: this.prototype._onModifyAP,
      toggleHealing: this.prototype._onToggleHealing,
      configureHP: this.prototype._onConfigureHP,
      rollWeapon: this.prototype._onRollWeapon,
      rollMeleeInitiative: this.prototype._onRollMeleeInitiative,
      respondToOpposed: this.prototype._onRespondToOpposed,
      dismissOpposed: this.prototype._onDismissOpposed,
      unloadMagazine: this.prototype._onUnloadMagazine,
      showPatientCard: this.prototype._onShowPatientCard,
      requestHealing: this.prototype._onRequestHealing,
      toggleCombatLayout: this.prototype._onToggleCombatLayout,
      rest: this.prototype._onRest,
      createEffect: this.prototype._onCreateEffect,
      editEffect: this.prototype._onEditEffect,
      deleteEffect: this.prototype._onDeleteEffect,
      toggleEffect: this.prototype._onToggleEffect,
      openSource: this.prototype._onOpenSource,
      invokeItemScript: this.prototype._onInvokeItemScript,
      toggleCondition: this.prototype._onToggleCondition,
      adjustConditionValue: this.prototype._onAdjustConditionValue,
      revertXpEntry: this.prototype._onRevertXpEntry,
      toggleKnowledgeEdit: this.prototype._onToggleKnowledgeEdit,
      toggleSummary: this.prototype._onToggleSummary,
      itemContextMenu: this.prototype._onItemContextMenu,
      postItemToChat: this.prototype._onPostItemToChat,
      toggleJammed: this.prototype._onToggleJammed,
      consolidateMoney: this.prototype._onConsolidateMoney,
      adjustFame: this.prototype._onAdjustFame,
      rollReputation: this.prototype._onRollReputation,
      rollReputationItem: this.prototype._onRollReputationItem,
      adjustRepValue: this.prototype._onAdjustRepValue,
      sortReputationItems: this.prototype._onSortReputationItems,
      adjustDiseaseState: this.prototype._onAdjustDiseaseState,
      adjustTransientPenalty: this.prototype._onAdjustTransientPenalty
    },
    dragDrop: [
      { dragSelector: ".item[data-item-id]", dropSelector: "form" },
      { dragSelector: ".effect-row[data-effect-id]:not([data-item-id])", dropSelector: "form" }
    ]
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "attributes", group: "primary", label: "NEUROSHIMA.Tabs.Attributes" },
        { id: "tricks", group: "primary", label: "NEUROSHIMA.Tabs.Tricks" },
        { id: "combat", group: "primary", label: "NEUROSHIMA.Tabs.Combat" },
        { id: "inventory", group: "primary", label: "NEUROSHIMA.Tabs.Inventory" },
        { id: "effects", group: "primary", label: "NEUROSHIMA.Tabs.Effects" },
        { id: "reputation", group: "primary", label: "NEUROSHIMA.Tabs.Reputation" },
        { id: "notes", group: "primary", label: "NEUROSHIMA.Tabs.Notes" }
      ],
      initial: "attributes"
    }
  };

  /** @override */
  static PARTS = {
    header: { template: "systems/neuroshima/templates/actors/actor/parts/actor-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    attributes: { template: "systems/neuroshima/templates/actors/actor/parts/actor-attributes.hbs", scrollable: [""] },
    skills: { template: "systems/neuroshima/templates/actors/actor/parts/actor-skills.hbs", scrollable: [".skill-table"] },
    tricks: { template: "systems/neuroshima/templates/actors/actor/parts/actor-tricks.hbs" },
    combat: { template: "systems/neuroshima/templates/actors/actor/parts/actor-combat.hbs",  scrollable: [""] },
    combatPaperDoll: { template: "systems/neuroshima/templates/actors/actor/parts/wounds-paper-doll-partial.hbs" ,  scrollable: [".paper-doll-scrollable"]},
    combatWoundsList: { template: "systems/neuroshima/templates/actors/actor/parts/wounds-list-partial.hbs" ,  scrollable: [".wounds-list-container"]},
    inventory: { template: "systems/neuroshima/templates/actors/actor/parts/actor-inventory.hbs", scrollable: [""]},
    effects: { template: "systems/neuroshima/templates/actors/parts/actor-effects.hbs", scrollable: [""] },
    reputation: { template: "systems/neuroshima/templates/actors/actor/parts/actor-reputation.hbs", scrollable: [""] },
    notes: { template: "systems/neuroshima/templates/actors/actor/parts/actor-notes.hbs", scrollable: [""] }
  };

  /** @inheritdoc */
  constructor(options={}) {
    super(options);
    this._difficultiesCollapsed = true;
    this._isRolling = false;
    this._selectedWoundLocation = null;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;

    context.actor = actor;
    context.system = system;
    context.config = NEUROSHIMA;
    context.tabs = this._getTabs();
    context.enableEncumbrance = game.settings.get("neuroshima", "enableEncumbrance");

    // Prepare Attributes
    context.attributeList = NEUROSHIMA.attributes;
    context.difficulties = NEUROSHIMA.difficulties;
    context.effectTooltips = this._buildEffectTooltips(actor);
    context.difficultiesCollapsed = this._difficultiesCollapsed;

    // Prepare Skills
    context.skillGroups = this._prepareSkillGroups();

    // Map owner and editable for templates
    context.owner = this.document.isOwner;
    context.editable = this.isEditable;
    context.isGM = game.user.isGM;
    context.isCharacter = actor.type === "character";

    // Organize Items - Sort by 'sort' property to allow manual reordering
    const items = actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const moneyItems = items.filter(i => i.type === "money").sort((a, b) => b.system.coinValue - a.system.coinValue);
    context.inventory = {
      weaponsMelee: items.filter(i => i.type === "weapon" && i.system.weaponType === "melee"),
      weaponsRanged: items.filter(i => i.type === "weapon" && i.system.weaponType === "ranged"),
      weaponsThrown: items.filter(i => i.type === "weapon" && (i.system.weaponType === "thrown" || i.system.weaponType === "grenade")),
      armor: items.filter(i => i.type === "armor"),
      gear: items.filter(i => i.type === "gear"),
      ammo: items.filter(i => i.type === "ammo"),
      magazines: items.filter(i => i.type === "magazine").map(m => {
          m.contentsReversed = [...(m.system.contents || [])].reverse();
          return m;
      }),
      money: moneyItems
    };

    const totalBaseUnits = moneyItems.reduce((sum, i) => sum + (i.system.quantity * i.system.coinValue), 0);
    const moneyDenominations = [];
    let remaining = totalBaseUnits;
    for (const item of moneyItems) {
        const count = Math.floor(remaining / item.system.coinValue);
        moneyDenominations.push({ name: item.name, count, coinValue: item.system.coinValue, id: item.id });
        remaining -= count * item.system.coinValue;
    }
    context.moneyData = {
        totalBaseUnits,
        totalBaseUnitsFormatted: totalBaseUnits.toLocaleString("pl-PL"),
        denominations: moneyDenominations,
        hasAny: moneyItems.length > 0
    };
    context.tricks = items.filter(i => i.type === "trick");
    context.traits = items.filter(i => i.type === "trait");

    const traitSourceMap = {};
    for (const t of context.traits) {
      const src = t.getFlag?.("neuroshima", "traitSource");
      if (src) traitSourceMap[t.id] = src;
    }
    context.traitSourceMap = traitSourceMap;

    context.wounds = items.filter(i => i.type === "wound");
    context.itemManualScripts = this._prepareItemManualScripts(actor);
    context.background = await this._prepareBackground(actor);

    const totalArmorPenalty = system.combat.totalArmorPenalty || 0;
    const totalWoundPenalty = system.combat.totalWoundPenalty || 0;
    const totalDiseasePenalty = actor.items
      .filter(i => i.type === "disease" && (i.system.diseaseType ?? "chronic") === "transient")
      .reduce((sum, i) => sum + (Number(i.system.transientPenalty) || 0), 0);
    const totalCombatPenalty = totalArmorPenalty + totalWoundPenalty + totalDiseasePenalty;

    const penaltyLines = [];
    if (totalArmorPenalty) penaltyLines.push(`${game.i18n.localize("NEUROSHIMA.Roll.Armor")}: ${totalArmorPenalty}%`);
    if (totalWoundPenalty) penaltyLines.push(`${game.i18n.localize("NEUROSHIMA.Roll.Wounds")}: ${totalWoundPenalty}%`);
    if (totalDiseasePenalty) penaltyLines.push(`${game.i18n.localize("NEUROSHIMA.Roll.Disease")}: ${totalDiseasePenalty}%`);
    const penaltyTooltip = penaltyLines.length
      ? penaltyLines.join("<br>")
      : `${game.i18n.localize("NEUROSHIMA.Wound.TotalPenaltyAbbr")}: 0%`;

    const healingRate = system.healingRate || 5;
    
    // Get patient card version for healing panel
    const patientCardVersion = game.settings.get("neuroshima", "patientCardVersion");
    
    // Load saved wound location from actor flags, default to torso
    // Only load from flags on first init or if explicitly unset (allows renderPartial to preserve state)
    if (this._selectedWoundLocation === null || this._selectedWoundLocation === undefined) {
      this._selectedWoundLocation = actor.getFlag("neuroshima", "selectedWoundLocation") || "torso";
    }
    
    game.neuroshima?.log("_prepareContext selectedWoundLocation", { 
      value: this._selectedWoundLocation,
      type: typeof this._selectedWoundLocation
    });
    
    // Prepare patient data for extended healing panel
    // BUILD DATA ALWAYS - needed for extended wounds display
    let patientData = CombatHelper.generatePatientCard(actor);
    let locationsMap = {};
    let woundsByLocation = {};
    
    // Create wounds organized by location for extended wounds editing
    for (const location of patientData.locations) {
      locationsMap[location.key] = location;
      location.wounds = location.wounds
        .map(woundData => {
          const woundItem = actor.items.get(woundData.id);
          if (!woundItem) return null;
          return {
            ...woundData,
            uuid: woundItem.uuid,
            img: woundItem.img,
            system: woundItem.system,
            damageType: woundItem.system.damageType || "D",
            penalty: woundItem.system.penalty || 0,
            isHealing: woundItem.system.isHealing || false,
            hadFirstAid: woundItem.system.hadFirstAid || false,
            healingAttempts: woundItem.system.healingAttempts || 0,
            estimatedHealingDays: Math.ceil((woundItem.system.penalty || 0) / 5)
          };
        })
        .filter(w => w !== null);
      woundsByLocation[location.key] = location.wounds;
    }
    
    // IMPORTANT: Filter patientData.locations to only include the selected location
    // This ensures the template loop only iterates over the active location
    const selectedLocation = patientData.locations.find(loc => loc.key === this._selectedWoundLocation);
    let locationsForTemplate = selectedLocation ? [selectedLocation] : patientData.locations.slice(0, 1);
    
    // Safety check: ensure locationsForTemplate is not empty
    if (locationsForTemplate.length === 0 && patientData.locations.length > 0) {
      locationsForTemplate = [patientData.locations[0]];
      game.neuroshima?.log("WARNING: locationsForTemplate was empty, using first location as fallback");
    }

    const selectedLocationLabel = locationsForTemplate[0]?.label || "";
    
    game.neuroshima?.log("Filtering locations for template", {
      selectedLocationKey: this._selectedWoundLocation,
      foundSelectedLocation: !!selectedLocation,
      locationsForTemplateCount: locationsForTemplate.length,
      allLocationsCount: patientData.locations.length,
      selectedLocationLabel: selectedLocationLabel,
      selectedLocationKey2: locationsForTemplate[0]?.key || "none"
    });

    // Prepare Combat Tab Data
    const weapons = this._prepareCombatWeapons(items);
    const unjamMinRole = game.settings.get("neuroshima", "unjamMinRole") ?? 4;
    const canUnjam = game.user.isGM || game.user.role >= unjamMinRole;
    context.combat = {
      armor: items.filter(i => i.type === "armor" && i.system.equipped),
      weapons: weapons,
      weaponsRanged: weapons.filter(w => w.type === "ranged" || w.type === "thrown" || w.type === "grenade"),
      weaponsMelee: weapons.filter(w => w.type === "melee"),
      canUnjam,
      wounds: context.wounds,
      activeWounds: items.filter(i => i.type === "wound" && i.system.isActive),
      totalArmorPenalty: totalArmorPenalty,
      totalWoundPenalty: totalWoundPenalty,
      totalCombatPenalty: totalCombatPenalty,
      penaltyTooltip: penaltyTooltip,
      totalDamagePoints: system.combat.totalDamagePoints,
      meleeInitiative: system.combat.meleeInitiative || 0,
      movement: system.movement ?? 2,
      movement2: (system.movement ?? 2) * 2,
      movement3: (system.movement ?? 2) * 3,
      currentHP: system.hp.value || 0,
      maxHP: system.hp.max || 27,
      healingRate: healingRate,
      healingDaysRequired: Math.ceil(totalWoundPenalty / healingRate),
      anatomicalArmor: this._prepareAnatomicalArmor(items.filter(i => i.type === "armor" && i.system.equipped), actor),
      patientCardVersion: patientCardVersion,
      patientData: { ...patientData, locations: patientData.locations }, 
      locationsMap: locationsMap,
      woundsByLocation: woundsByLocation,
      selectedWoundLocation: this._selectedWoundLocation,
      selectedLocationLabel: selectedLocationLabel,
      woundsFirst: actor.getFlag("neuroshima", "woundsFirst") || false,
      activeMeleeEncounter: actor.getFlag("neuroshima", "activeMeleeEncounter"),
      meleePendings: (() => {
        // Primary: read from combat flag
        // Also cross-check the chat message status: if the message is already "resolved"
        // or "cancelled" the pending must not show even if the combat flag hasn't been
        // cleaned up yet (socket propagation delay on non-GM clients).
        const fromCombat = Object.values(game.combat?.getFlag("neuroshima", "meleePendings") || {})
          .filter(p => {
            if (!p.active) return false;
            if (p.opposedChatMessageId) {
              const msg = game.messages.get(p.opposedChatMessageId);
              const chatData = msg?.getFlag("neuroshima", "opposedChat");
              if (chatData?.status && chatData.status !== "pending") return false;
            }
            return true;
          })
          .map(p => {
            const matchesDefender = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, actor.uuid);
            const matchesAttacker = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.attackerId, actor.uuid);
            return { ...p, matchesDefender, matchesAttacker };
          })
          .filter(p => p.matchesDefender || p.matchesAttacker);

        // Fallback: if this actor has an oppose flag set but no combat-tracker entry was found,
        // build a synthetic pending so the tab still shows the pending card.
        const opposeFlag = actor.getFlag("neuroshima", "oppose");
        if (opposeFlag?.messageId && !fromCombat.some(p => p.matchesDefender)) {
          const msg = game.messages.get(opposeFlag.messageId);
          const data = msg?.getFlag("neuroshima", "opposedChat");
          if (data?.status === "pending") {
            const attackerDoc = fromUuidSync(data.attackerUuid);
            const attackerActor = attackerDoc?.actor ?? attackerDoc;
            fromCombat.push({
              id: data.defenderUuid,
              attackerId: data.attackerUuid,
              defenderId: data.defenderUuid,
              attackerName: attackerActor?.name ?? "?",
              defenderName: actor.name,
              mode: data.mode,
              opposedChatMessageId: opposeFlag.messageId,
              active: true,
              matchesDefender: true,
              matchesAttacker: false
            });
          }
        }
        return fromCombat;
      })()
    };
    
    game.neuroshima?.log("_prepareContext meleePendings sync", {
      actorName: actor.name,
      myUuids: [actor.uuid, actor.token?.uuid].filter(Boolean),
      allPendings: game.combat?.getFlag("neuroshima", "meleePendings")
    });
    
    game.neuroshima?.log("_prepareContext context.combat.selectedWoundLocation", {
      value: context.combat.selectedWoundLocation,
      patientDataLocationsCount: context.combat.patientData?.locations?.length || 0,
      locations: context.combat.patientData?.locations?.map(l => ({ key: l.key, label: l.label })) || []
    });

    context.reputationItems = items.filter(i => i.type === "reputation");

    {
      const globalRelTable = game.settings.get("neuroshima", "reputationRelationTable") ?? [];
      const useColors = game.settings.get("neuroshima", "reputationUseColors") ?? false;
      const colorNames = game.settings.get("neuroshima", "reputationColorNames") ?? false;
      const showAsProgressBar = game.settings.get("neuroshima", "reputationShowAsProgressBar") ?? false;
      const repMin = game.settings.get("neuroshima", "reputationMin") ?? 0;
      const repMax = game.settings.get("neuroshima", "reputationMax") ?? 20;
      const reputationBonus = this.document.system?.reputationBonus ?? 0;
      const fameBonus = this.document.system?.fameBonus ?? 0;

      const repBonusTooltipParts = [];
      const fameBonusTooltipParts = [];
      for (const effect of (this.document.effects ?? [])) {
        if (effect.disabled || effect.isSuppressed) continue;
        for (const change of (effect.changes ?? [])) {
          const val = Number(change.value) || 0;
          if (change.key === "system.reputationBonus") {
            repBonusTooltipParts.push(`${effect.name ?? "?"}: ${val >= 0 ? "+" : ""}${val}`);
          } else if (change.key === "system.fameBonus") {
            fameBonusTooltipParts.push(`${effect.name ?? "?"}: ${val >= 0 ? "+" : ""}${val}`);
          }
        }
      }

      context.reputationBonus = reputationBonus;
      context.fameBonus = fameBonus;
      context.effectiveFame = (this.document.system?.fame ?? 0) + fameBonus;
      context.fameBonusTooltip = fameBonusTooltipParts.length ? fameBonusTooltipParts.join("<br>") : null;
      context.repBonusTooltip = repBonusTooltipParts.length ? repBonusTooltipParts.join("<br>") : null;
      context.showRepAsProgressBar = showAsProgressBar;
      context.repMin = repMin;
      context.repMax = repMax;
      context.repSortAsc = this._repSortAsc ?? false;

      const _hexContrastColor = (hex) => {
        if (!hex || !hex.startsWith("#") || hex.length < 7) return "#f0f0f0";
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#1a1a1a" : "#f0f0f0";
      };

      const _buildMarkers = (sortedTable, range) => {
        const markers = [];
        for (let i = 0; i < sortedTable.length - 1; i++) {
          const boundary = sortedTable[i].maxVal ?? 0;
          const pct = Math.round(Math.min(100, Math.max(0, ((boundary - repMin) / range) * 100)));
          markers.push({ pct, color: sortedTable[i + 1].color ?? null });
        }
        return markers;
      };

      const relMap = {};
      for (const item of context.reputationItems) {
        const baseVal = item.system?.value ?? 0;
        const effectiveVal = baseVal + reputationBonus;
        const activeTable = (item.system?.overrideRelations && item.system?.relationTable?.length)
          ? item.system.relationTable
          : globalRelTable;
        const sorted = [...activeTable].sort((a, b) => (a.minVal ?? 0) - (b.minVal ?? 0));
        let rel = sorted.find(r => effectiveVal >= (r.minVal ?? 0) && effectiveVal <= (r.maxVal ?? 0));
        if (!rel && sorted.length) {
          if (effectiveVal < (sorted[0].minVal ?? 0)) rel = sorted[0];
          else rel = sorted[sorted.length - 1];
        }
        const range = Math.max(1, repMax - repMin);
        const pct = Math.round(Math.min(100, Math.max(0, ((effectiveVal - repMin) / range) * 100)));
        const markers = _buildMarkers(sorted, range);
        if (rel) {
          const color = rel.color ?? null;
          relMap[item.id] = {
            name: rel.name,
            color: useColors ? color : null,
            nameColor: colorNames ? color : null,
            progressPct: pct,
            progressColor: color,
            progressTextColor: _hexContrastColor(color),
            markers
          };
        } else {
          relMap[item.id] = { name: null, color: null, nameColor: null, progressPct: pct, progressColor: null, progressTextColor: "#f0f0f0", markers };
        }
        item.effectiveValue = effectiveVal;
      }
      context.reputationRelationMap = relMap;
    }

    // Prepare notes object
    context.notes = {
      raw: system.notes || "",
      enriched: await foundry.applications.ux.TextEditor.enrichHTML(system.notes || "", {
        async: true,
        secrets: this.document.isOwner,
        rollData: this.document.getRollData(),
        relativeTo: this.document
      }),
      xpLog: [...(system.xpLog ?? [])].reverse().map(e => ({
        ...e,
        costClass:    e.cost > 0 ? "xp-cost-spent" : (e.cost < 0 ? "xp-cost-gain" : "xp-cost-free"),
        costDisplay:  e.cost < 0 ? "+" + Math.abs(e.cost) : (e.cost > 0 ? "-" + e.cost : null)
      }))
    };

    // Prepare effects — collect from actor directly + all owned items
    const condDefs = getConditions();
    const condTypeMap = Object.fromEntries(condDefs.map(c => [c.key, c.type ?? "boolean"]));

    const effectDurationLabel = (e) => e.duration?.rounds ? `${e.duration.rounds}r` : (e.duration?.seconds ? `${e.duration.seconds}s` : "—");
    const isTemporary = (e) => !!(
      e.duration?.rounds || e.duration?.seconds || e.duration?.turns ||
      e.getFlag("neuroshima", "fromAura") || e.getFlag("neuroshima", "fromArea")
    );
    const isConditionEffect = (e) => e.statuses?.size > 0;

    const temporary    = [];
    const passive      = [];
    const disabled     = [];
    const statusEffects = [];
    const diseaseEffects = [];

    const pushEffect = (e, itemId, sourceName, sourceIcon, isItemEffect, isDiseaseItem = false) => {
      const hasEnableScript = !!(e.getFlag?.("neuroshima", "enableScript"));
      const entry = {
        id: e.id,
        itemId: itemId ?? null,
        name: e.name,
        icon: e.img || "icons/svg/aura.svg",
        disabled: e.disabled,
        suppressed: hasEnableScript && e.isSuppressed,
        scriptControlled: hasEnableScript,
        sourceName,
        sourceIcon,
        durationLabel: effectDurationLabel(e),
        isItemEffect: !!isItemEffect
      };
      if (isDiseaseItem) {
        diseaseEffects.push(entry);
      } else if (isConditionEffect(e)) {
        const statusKey = [...(e.statuses ?? [])][0];
        entry.conditionType = condTypeMap[statusKey] ?? "boolean";
        statusEffects.push(entry);
      } else if (e.disabled) {
        disabled.push(entry);
      } else if (isTemporary(e)) {
        temporary.push(entry);
      } else {
        passive.push(entry);
      }
    };

    for (const e of actor.effects) {
      if (e.getFlag("neuroshima", "fromEquipTransfer")) {
        const originItem = e.origin ? actor.items.find(i => i.uuid === e.origin) : null;
        const srcName = originItem?.name ?? actor.name;
        const srcIcon = originItem?.img  ?? actor.img ?? "icons/svg/mystery-man.svg";
        pushEffect(e, originItem?.id ?? null, srcName, srcIcon, !!originItem);
      } else {
        const fromAura = e.getFlag("neuroshima", "fromAura");
        const fromArea = e.getFlag("neuroshima", "fromArea");
        const sourceActorId = fromAura?.sourceActorId ?? fromArea?.sourceActorId ?? null;
        const sourceActor = sourceActorId ? game.actors.get(sourceActorId) : null;
        const srcName = sourceActor?.name ?? actor.name;
        const srcIcon = sourceActor?.img  ?? actor.img ?? "icons/svg/mystery-man.svg";
        pushEffect(e, null, srcName, srcIcon, false);
      }
    }

    for (const item of actor.items) {
      const isDisease = item.type === "disease";
      for (const e of item.effects) {
        if (isDisease) {
          pushEffect(e, item.id, item.name, item.img || "icons/svg/item-bag.svg", true, true);
          continue;
        }
        const fromModId = e.getFlag?.("neuroshima", "fromModId");
        if (fromModId) {
          const modSnap = item.system?.mods?.[fromModId];
          if (modSnap?.attached) {
            pushEffect(e, item.id, item.name, item.img || "icons/svg/item-bag.svg", true);
          }
          continue;
        }
        if (item.type === "weapon-mod" || item.type === "armor-mod") continue;
        const docType      = e.getFlag?.("neuroshima", "documentType")  ?? "actor";
        const transferType = e.getFlag?.("neuroshima", "transferType")  ?? "owningDocument";
        const equipTransfer = e.getFlag?.("neuroshima", "equipTransfer") ?? false;
        if (docType !== "actor" || transferType !== "owningDocument") continue;
        if (equipTransfer) continue;
        pushEffect(e, item.id, item.name, item.img || "icons/svg/item-bag.svg", true);
      }
    }

    statusEffects.sort((a, b) => {
      const order = { boolean: 0, int: 1 };
      return (order[a.conditionType] ?? 0) - (order[b.conditionType] ?? 0);
    });

    const diseaseStateKeys = ["none", "firstSymptoms", "acute", "critical", "terminal"];
    const diseaseStateLbls = {
      none:          game.i18n.localize("NEUROSHIMA.Disease.State.None"),
      firstSymptoms: game.i18n.localize("NEUROSHIMA.Disease.State.FirstSymptoms"),
      acute:         game.i18n.localize("NEUROSHIMA.Disease.State.Acute"),
      critical:      game.i18n.localize("NEUROSHIMA.Disease.State.Critical"),
      terminal:      game.i18n.localize("NEUROSHIMA.Disease.State.Terminal")
    };
    const diseaseItems = actor.items
      .filter(i => i.type === "disease")
      .sort((a, b) => {
        const typeOrder = { chronic: 0, transient: 1 };
        return (typeOrder[a.system.diseaseType ?? "chronic"] ?? 0) - (typeOrder[b.system.diseaseType ?? "chronic"] ?? 0);
      })
      .map(item => {
        const currentState = item.system.currentState ?? "none";
        const stateIndex = diseaseStateKeys.indexOf(currentState);
        const filledCount = Math.max(0, stateIndex);
        const stateDots = [0, 1, 2, 3].map(i => ({ index: i, filled: i < filledCount }));
        const diseaseType = item.system.diseaseType ?? "chronic";
        const typeKey = diseaseType === "transient" ? "NEUROSHIMA.Disease.Type.TransientShort" : "NEUROSHIMA.Disease.Type.ChronicShort";
        return {
          id: item.id,
          name: item.name,
          img: item.img || "icons/svg/item-bag.svg",
          diseaseType,
          diseaseTypeShort: game.i18n.localize(typeKey),
          currentState,
          stateIndex,
          stateLabel: diseaseStateLbls[currentState] ?? currentState,
          transientPenalty: item.system.transientPenalty ?? 0,
          stateDots
        };
      });

    const chronicDiseaseItems   = diseaseItems.filter(d => d.diseaseType === "chronic");
    const transientDiseaseItems = diseaseItems.filter(d => d.diseaseType === "transient");

    context.effects = { temporary, passive, disabled, statusEffects, disease: diseaseEffects };
    context.diseaseItems = diseaseItems;
    context.chronicDiseaseItems   = chronicDiseaseItems;
    context.transientDiseaseItems = transientDiseaseItems;
    context.showDiseaseSection    = true;
    context.effectsAny = temporary.length > 0 || passive.length > 0 || disabled.length > 0 || statusEffects.length > 0 || diseaseEffects.length > 0 || diseaseItems.length > 0;

    // Conditions panel — WFRP-style: int conditions stored as ActiveEffects
    context.conditionStates = condDefs.map(c => {
      const isInt = c.type === "int";
      let active, value;
      if (isInt) {
        value  = actor.getConditionValue(c.key);
        active = value !== 0;
      } else {
        active = actor.statuses.has(c.key);
        value  = 0;
      }
      return {
        key:           c.key,
        name:          c.name,
        img:           c.img,
        type:          c.type,
        allowNegative: !!c.allowNegative,
        active,
        value
      };
    }).sort((a, b) => (a.type === "int" ? 1 : 0) - (b.type === "int" ? 1 : 0));

    return context;
  }

  /** @override */
  _prepareSubmitData(event, form, formData) {
    this._saveWoundsScroll();

    const data = formData.object;

    for (const key of Object.keys(data)) {
      if (key.startsWith("items.")) delete data[key];
    }
    if (data.items && typeof data.items === "object") {
      delete data.items;
    }

    if (!data.name) {
      data.name = this.document.name;
    }

    return super._prepareSubmitData(event, form, formData);
  }

  async _prepareBackground(actor) {
    const bgTypes = ["specialization", "origin", "profession"];
    const slots = { specialization: null, origin: null, profession: null, disease: null, extras: [] };
    const seen = { specialization: false, origin: false, profession: false };

    const diseaseStates = ["none", "firstSymptoms", "acute", "critical", "terminal"];
    const diseaseStateLabels = {
      none:          game.i18n.localize("NEUROSHIMA.Disease.State.None"),
      firstSymptoms: game.i18n.localize("NEUROSHIMA.Disease.State.FirstSymptoms"),
      acute:         game.i18n.localize("NEUROSHIMA.Disease.State.Acute"),
      critical:      game.i18n.localize("NEUROSHIMA.Disease.State.Critical"),
      terminal:      game.i18n.localize("NEUROSHIMA.Disease.State.Terminal")
    };

    for (const item of actor.items) {
      if (item.type === "disease" && !slots.disease) {
        const currentState = item.system.currentState ?? "none";
        const stateIndex = diseaseStates.indexOf(currentState);
        const filledCount = Math.max(0, stateIndex);
        const stateDots = [0, 1, 2, 3].map(i => ({
          index: i,
          filled: i < filledCount,
          label: diseaseStateLabels[diseaseStates[i + 1]] ?? ""
        }));
        slots.disease = {
          id: item.id,
          name: item.name,
          img: item.img,
          type: item.type,
          system: item.system,
          currentState,
          stateIndex,
          stateLabel: diseaseStateLabels[currentState] ?? currentState,
          stateDots
        };
        continue;
      }

      if (!bgTypes.includes(item.type)) continue;
      const slot = item.type;
      const enriched = item.system.bonusText
        ? await TextEditor.enrichHTML(item.system.bonusText, { relativeTo: item, rollData: item.getRollData?.() ?? {} })
        : "";
      const activeSpecializations = slot === "specialization" && item.system.skillSpecializations
        ? Object.entries(item.system.skillSpecializations).filter(([, v]) => v).map(([k]) => k)
        : [];
      const wrapped = { id: item.id, name: item.name, img: item.img, type: item.type, system: item.system, bonusEnriched: enriched, activeSpecializations };
      if (!seen[slot]) {
        slots[slot] = wrapped;
        seen[slot] = true;
      } else {
        const typeCap = slot.charAt(0).toUpperCase() + slot.slice(1);
        slots.extras.push({ ...wrapped, typeCap });
      }
    }
    return slots;
  }

  _buildEffectTooltips(actor) {
    const attrKeys = Object.keys(NEUROSHIMA.attributes);
    const tooltips = {};
    for (const key of attrKeys) tooltips[key] = "";

    const addAttrChanges = (effect) => {
      if (effect.disabled || effect.isSuppressed) return;
      for (const change of (effect.changes ?? [])) {
        if (!change.key) continue;
        const attrMatch   = change.key.match(/^system\.attributeBonuses\.(\w+)$/);
        const modMatch    = change.key.match(/^system\.bonuses\.(\w+)$/);
        const directMatch = change.key.match(/^system\.attributes\.(\w+)$/);
        const modsMatch   = change.key.match(/^system\.modifiers\.(\w+)$/);
        const match = attrMatch || modMatch || directMatch || modsMatch;
        if (!match) continue;
        const key = match[1];
        if (!attrKeys.includes(key)) continue;
        const val = Number(change.value) || 0;
        if (!val) continue;
        const part = `${effect.name ?? "?"}: ${val >= 0 ? "+" : ""}${val}`;
        tooltips[key] = tooltips[key] ? tooltips[key] + "<br>" + part : part;
      }
    };

    const actorItemUUIDs = new Set(actor.items.map(i => i.uuid));
    for (const effect of actor.effects) {
      const origin = effect.origin ?? "";
      const isItemCopy = [...actorItemUUIDs].some(uuid => origin.startsWith(uuid));
      if (isItemCopy) continue;
      addAttrChanges(effect);
    }
    for (const item of actor.items) {
      for (const effect of item.effects) {
        addAttrChanges(effect);
      }
    }
    return tooltips;
  }

  /** @override */
  async _processSubmitData(event, form, submitData) {
    for (const key of Object.keys(this.document.system.attributes ?? {})) {
      const path = `system.attributes.${key}`;
      const submitted = foundry.utils.getProperty(submitData, path);
      if (submitted === undefined) continue;
      let aeBonus = 0;
      for (const effect of (this.document.appliedEffects ?? [])) {
        for (const change of (effect.changes ?? [])) {
          if (change.key === path && Number(change.mode) === CONST.ACTIVE_EFFECT_MODES.ADD) {
            aeBonus += Number(change.value) || 0;
          }
        }
      }
      if (aeBonus !== 0) {
        foundry.utils.setProperty(submitData, path, Math.max(0, Number(submitted) - aeBonus));
      }
    }
    for (const key of Object.keys(this.document.system.skills ?? {})) {
      const path = `system.skills.${key}.value`;
      const submitted = foundry.utils.getProperty(submitData, path);
      if (submitted === undefined) continue;
      let aeBonus = 0;
      for (const effect of (this.document.appliedEffects ?? [])) {
        for (const change of (effect.changes ?? [])) {
          if (change.key === path && Number(change.mode) === CONST.ACTIVE_EFFECT_MODES.ADD) {
            aeBonus += Number(change.value) || 0;
          }
        }
      }
      if (aeBonus !== 0) {
        foundry.utils.setProperty(submitData, path, Math.max(0, Number(submitted) - aeBonus));
      }
    }
    return super._processSubmitData(event, form, submitData);
  }

  /** @override */
  async _onChangeForm(formConfig, event) {
    const input = event.target;
    const name = input?.getAttribute?.("name") ?? input?.name;

    if (name?.startsWith("items.")) {
      const parts = name.split(".");
      const itemId = parts[1];
      const propertyPath = parts.slice(2).join(".");
      const item = this.document.items.get(itemId);
      if (!item) return;

      let value;
      if (input.type === "checkbox") {
        value = input.checked;
      } else if (input.type === "number") {
        value = Math.round(Number(input.value) || 0);
      } else {
        value = input.value;
      }

      game.neuroshima.log("_onChangeForm item update", { itemId, propertyPath, value });
      await item.update({ [propertyPath]: value });
      return;
    }

    const isCharacter = this.document.type === "character";

    const attrMatch = name?.match(/^system\.attributes\.(\w+)$/);
    if (attrMatch) {
      const key    = attrMatch[1];
      const newVal = Number(input.value);
      const oldVal = Number(this.document.system.attributes?.[key]) || 0;
      if (isCharacter && newVal > oldVal) {
        const { getAttrTotalCost, showXpDialog, applyXpEntry } = await import("../helpers/xp.js");
        const cost       = getAttrTotalCost(oldVal, newVal);
        const currentXp  = (Number(this.document.system.xp?.total) || 0) - (Number(this.document.system.xp?.spent) || 0);
        const attrLabel  = game.i18n.localize(NEUROSHIMA.attributes[key]?.label ?? key);
        const desc       = game.i18n.format("NEUROSHIMA.XP.Log.AttributeRaise", { attr: attrLabel, from: oldVal, to: newVal });
        const choice     = await showXpDialog(cost, desc, currentXp);
        if (choice === null) { input.value = oldVal; return; }
        const attrPath = `system.attributes.${key}`;
        let attrAeBonus = 0;
        for (const effect of (this.document.appliedEffects ?? [])) {
          for (const change of (effect.changes ?? [])) {
            if (change.key === attrPath && Number(change.mode) === CONST.ACTIVE_EFFECT_MODES.ADD) {
              attrAeBonus += Number(change.value) || 0;
            }
          }
        }
        const storedAttr = Math.max(0, newVal - attrAeBonus);
        const updateData = {};
        foundry.utils.setProperty(updateData, attrPath, storedAttr);
        applyXpEntry(this.document, updateData, choice.free ? 0 : choice.cost, desc, oldVal, attrPath);
        await this.document.update(updateData, { ns_skip_xp: true });
        return;
      }
      return super._onChangeForm(formConfig, event);
    }

    const skillMatch = name?.match(/^system\.skills\.(\w+)\.value$/);
    if (skillMatch) {
      const key    = skillMatch[1];
      const newVal = Number(input.value);
      const oldVal = Number(this.document.system.skills?.[key]?.value) || 0;
      if (isCharacter && newVal > oldVal) {
        const { getSkillTotalCost, showXpDialog, applyXpEntry } = await import("../helpers/xp.js");
        const cost       = getSkillTotalCost(key, oldVal, newVal, this.document);
        const currentXp  = (Number(this.document.system.xp?.total) || 0) - (Number(this.document.system.xp?.spent) || 0);
        const skillLabel = game.i18n.localize(`NEUROSHIMA.Skills.${key}`) || key;
        const desc       = game.i18n.format("NEUROSHIMA.XP.Log.SkillRaise", { skill: skillLabel, from: oldVal, to: newVal });
        const choice     = await showXpDialog(cost, desc, currentXp);
        if (choice === null) { input.value = oldVal; return; }
        const skillPath = `system.skills.${key}.value`;
        let valueAeBonus = 0;
        for (const effect of (this.document.appliedEffects ?? [])) {
          for (const change of (effect.changes ?? [])) {
            if (change.key === skillPath && Number(change.mode) === CONST.ACTIVE_EFFECT_MODES.ADD) {
              valueAeBonus += Number(change.value) || 0;
            }
          }
        }
        const storedVal  = Math.max(0, newVal - valueAeBonus);
        const updateData = {};
        foundry.utils.setProperty(updateData, skillPath, storedVal);
        applyXpEntry(this.document, updateData, choice.free ? 0 : choice.cost, desc, oldVal, skillPath);
        await this.document.update(updateData, { ns_skip_xp: true });
        return;
      }
      return super._onChangeForm(formConfig, event);
    }

    if (name === "system.xp.total") {
      if (!isCharacter) return super._onChangeForm(formConfig, event);
      const newVal = Number(input.value);
      const oldVal = Number(this.document.system.xp?.total) || 0;
      if (newVal > oldVal) {
        const amount = newVal - oldVal;
        const { showXpGrantDialog, applyXpGrantEntry } = await import("../helpers/xp.js");
        const result = await showXpGrantDialog(amount);
        if (result === null) {
          input.value = oldVal;
          return;
        }
        const updateData = {};
        foundry.utils.setProperty(updateData, "system.xp.total", newVal);
        applyXpGrantEntry(this.document, updateData, amount, result.reason);
        await this.document.update(updateData, { ns_skip_xp: true });
        return;
      }
      input.value = oldVal;
      return;
    }

    if (name === "system.xp.spent") {
      if (!isCharacter) return super._onChangeForm(formConfig, event);
      const newVal = Number(input.value);
      const oldVal = Number(this.document.system.xp?.spent) || 0;
      if (newVal < 0) { input.value = oldVal; return; }
      if (newVal > oldVal) {
        const total = Number(this.document.system.xp?.total) || 0;
        if (newVal > total) {
          ui.notifications?.warn(game.i18n.localize("NEUROSHIMA.XP.Deduct.ExceedsTotal"));
          input.value = oldVal;
          return;
        }
        const amount = newVal - oldVal;
        const { showXpDeductDialog } = await import("../helpers/xp.js");
        const result = await showXpDeductDialog(amount);
        if (result === null) { input.value = oldVal; return; }
        const current = total - oldVal;
        const entry = {
          id:            foundry.utils.randomID(),
          date:          new Date().toLocaleDateString("pl-PL"),
          description:   result.reason,
          cost:          amount,
          xpBefore:      current,
          xpAfter:       current - amount,
          previousValue: oldVal,
          fieldPath:     "system.xp.spent"
        };
        const log = foundry.utils.deepClone(this.document.system.xpLog ?? []);
        log.push(entry);
        await this.document.update({ "system.xp.spent": newVal, "system.xpLog": log }, { ns_skip_xp: true });
        return;
      }
      input.value = oldVal;
      return;
    }

    return super._onChangeForm(formConfig, event);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    
    const html = this.element;
    
    // Add listeners for custom actions
    html.querySelectorAll('[data-action="adjustFame"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._onAdjustFame(event, event.currentTarget);
      });
    });

    html.querySelectorAll('[data-action="adjustRepValue"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._onAdjustRepValue(event, event.currentTarget);
      });
    });

    html.querySelectorAll('[data-action="adjustDiseaseState"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._onAdjustDiseaseState(event, event.currentTarget);
      });
    });

    html.querySelectorAll('.rep-ctx-btn').forEach(el => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wrap = el.closest('.item-wrap[data-item-id]');
        if (wrap) this._showItemContextMenu(event, wrap.dataset.itemId);
      });
    });

    this._initRepGripDrag(html);

    html.querySelectorAll('[data-action="adjustQuantity"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._onAdjustQuantity(event, event.currentTarget);
      });
    });

    html.querySelectorAll('[data-action="modifyDurability"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this._onModifyDurability(event, event.currentTarget);
      });
    });

    html.querySelectorAll('[data-action="modifyAP"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this._onModifyAP(event, event.currentTarget);
      });
    });

    // Right-click to decrement int-type condition icons
    html.querySelectorAll('[data-action="toggleCondition"][data-condition-type="int"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this._onToggleCondition(event, event.currentTarget);
      });
    });

    // Condition value spans — click to ±1/±10, right-click to decrement
    html.querySelectorAll('.condition-int-span').forEach(el => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const delta = event.ctrlKey ? 10 : 1;
        const allowNeg = el.dataset.allowNegative === "true";
        let val = parseInt(el.dataset.value, 10) || 0;
        val += delta;
        if (!allowNeg) val = Math.max(0, val);
        el.dataset.value = val;
        el.textContent = val;
        this._onAdjustConditionValue(event, el);
      });
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.ctrlKey ? 10 : 1;
        const allowNeg = el.dataset.allowNegative === "true";
        let val = parseInt(el.dataset.value, 10) || 0;
        val -= delta;
        if (!allowNeg) val = Math.max(0, val);
        el.dataset.value = val;
        el.textContent = val;
        this._onAdjustConditionValue(event, el);
      });
    });

    // Transient disease penalty inputs — save on change
    html.querySelectorAll('[data-action="adjustTransientPenalty"]').forEach(el => {
      el.addEventListener('change', (event) => {
        this._onAdjustTransientPenalty(event, event.currentTarget);
      });
    });

    // Item context menu — right-click on .item-wrap
    html.querySelectorAll('.item-wrap[data-item-id]').forEach(wrap => {
      wrap.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._showItemContextMenu(event, wrap.dataset.itemId);
      });
    });

    // Add listeners for paper doll in extended healing panel
    // We check for hotspots repeatedly for a short period if not found immediately
    // to account for ApplicationV2 part injection timing
    const setupHotspots = () => {
      const hotspots = html.querySelectorAll('.body-location-hotspot');
      if (hotspots.length > 0) {
        hotspots.forEach(hotspot => {
          // Avoid duplicate listeners
          if (hotspot.getAttribute('data-listener-active')) return;
          hotspot.setAttribute('data-listener-active', 'true');
          
          hotspot.addEventListener('click', (event) => {
            event.preventDefault();
            // Save selected location to actor flags
            const locationKey = event.currentTarget.dataset.location;
            this._selectedWoundLocation = locationKey;
            this.document.setFlag("neuroshima", "selectedWoundLocation", locationKey);
            // Render wounds list to show selected location BEFORE updating visual state
            this.render({ parts: ["combatWoundsList"] }).then(() => {
              // Update visual state after render completes
              this._onPaperDollLocationSelect(event, event.currentTarget);
            });
          });
        });
        
        // Initialize paper doll with saved location
        this._initializeWoundLocationPanel(this.element);
        return true;
      }
      return false;
    };

    if (!setupHotspots()) {
      // Try again after a short delay if not found immediately
      setTimeout(setupHotspots, 100);
    }
    
    // Re-attach listeners to wounds list if it was updated
    const woundItems = html.querySelectorAll('.wounds-list-part .wound-item');
    if (woundItems.length > 0) {
      game.neuroshima?.log("_onRender: Wound items found, listeners should be handled by form", {
        count: woundItems.length
      });
    }

    // Przywróć scroll wounds-list-container jeśli był zapisany
    if (this._woundsScrollTop != null) {
      const container = html.querySelector(".wounds-list-container");
      if (container) {
        container.scrollTop = this._woundsScrollTop;
      }
      this._woundsScrollTop = null;
    }

    // Listenery dla walki wręcz (Neuroshima 1.5)
    html.querySelectorAll('[data-action="ignore-melee"]').forEach(el => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        this._onIgnoreMelee(event);
      });
    });

    // Explicit drag-and-drop for actor-owned effects (not from items)
    html.querySelectorAll('.effect-row[data-effect-id]').forEach(el => {
      if (el.dataset.itemId) return;
      el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', (event) => {
        event.stopPropagation();
        const effectId = el.dataset.effectId;
        const effect = this.document.effects.get(effectId);
        if (!effect) return;
        event.dataTransfer.setData("text/plain", JSON.stringify(effect.toDragData()));
      });
    });



  }

  /**
   * Initialize wound location panel - ensures active class is set and wounds are visible
   * @private
   */
  _initializeWoundLocationPanel(html) {
    const hotspots = html.querySelectorAll('.body-location-hotspot');
    const targetHotspot = Array.from(hotspots).find(h => h.dataset.location === this._selectedWoundLocation);
    
    game.neuroshima?.log("_initializeWoundLocationPanel", {
      hotspotsFound: hotspots.length,
      selectedLocation: this._selectedWoundLocation,
      targetFound: !!targetHotspot
    });
    
    if (targetHotspot) {
      this._onPaperDollLocationSelect(null, targetHotspot);
    } else if (hotspots.length > 0) {
      // Fallback: if saved location not found, use first available (torso)
      const torsoHotspot = Array.from(hotspots).find(h => h.dataset.location === "torso") || hotspots[0];
      this._selectedWoundLocation = torsoHotspot.dataset.location;
      game.neuroshima?.log("_initializeWoundLocationPanel fallback", {
        usedLocation: this._selectedWoundLocation
      });
      this._onPaperDollLocationSelect(null, torsoHotspot);
    } else {
      game.neuroshima?.log("_initializeWoundLocationPanel ERROR: No hotspots found!");
    }
  }

  /** @override */
  _onUpdate(changed, options, userId) {
    const changedKeys = Object.keys(changed);
    let itemsChanged = false;
    let onlyWoundsChanged = true;
    let hpChanged = false;

    // Zapisz pozycję scrolla wounds-list-container
    this._saveWoundsScroll();

    for (const key of changedKeys) {
      if (key === "items") {
        itemsChanged = true;
        // Check array-based update
        const updates = Array.isArray(changed.items) ? changed.items : [];
        for (const itemData of updates) {
          const item = this.document.items.get(itemData._id);
          if (item && item.type !== "wound") onlyWoundsChanged = false;
        }
      } else if (key.startsWith("items.")) {
        itemsChanged = true;
        const parts = key.split(".");
        const itemId = parts[1];
        const item = this.document.items.get(itemId);
        if (item && item.type !== "wound") onlyWoundsChanged = false;
      } else if (key.includes("hp") || key.includes("health")) {
        hpChanged = true;
      } else {
        onlyWoundsChanged = false;
      }
    }

    let renderPromise;
    if (itemsChanged) {
      if (onlyWoundsChanged) {
        renderPromise = this.render({ parts: ["header", "combatWoundsList"] });
      } else {
        renderPromise = this.render({ parts: ["header", "combat", "combatPaperDoll", "combatWoundsList", "inventory"] });
      }
    } else if (hpChanged) {
      renderPromise = this.render({ parts: ["header", "combat", "combatPaperDoll", "combatWoundsList"] });
    } else {
      return super._onUpdate(changed, options, userId);
    }

    return renderPromise;
  }

  /**
   * Zapisuje aktualną pozycję scrolla listy ran.
   * @private
   */
  _saveWoundsScroll() {
    const container = this.element?.querySelector(".wounds-list-container");
    if (container) {
      this._woundsScrollTop = container.scrollTop;
    }
  }

  /** @override */
  _onCreateDocuments(documents, options, userId) {
    if (documents.some(d => d.type === "wound")) {
      this._saveWoundsScroll();
    }
    return super._onCreateDocuments(documents, options, userId);
  }

  /** @override */
  _onUpdateDocuments(documents, options, userId) {
    if (documents.some(d => d.type === "wound")) {
      this._saveWoundsScroll();
    }
    return super._onUpdateDocuments(documents, options, userId);
  }

  /** @override */
  _onDeleteDocuments(documents, options, userId) {
    if (documents.some(d => d.type === "wound")) {
      this._saveWoundsScroll();
    }
    return super._onDeleteDocuments(documents, options, userId);
  }

  /** @override */
  _onDragStart(event) {
    const el = event.currentTarget;
    const effectId = el.dataset.effectId;
    if (effectId && !el.dataset.itemId) {
      const effect = this.document.effects.get(effectId);
      if (effect) {
        event.dataTransfer.setData("text/plain", JSON.stringify(effect.toDragData()));
        return;
      }
    }
    return super._onDragStart(event);
  }

  /** @override */
  async _onDropActiveEffect(event, data) {
    const effect = await ActiveEffect.fromDropData(data);
    if (!effect) return false;
    if (!this.document.isOwner) return false;
    if (this.document.uuid === effect.parent?.uuid) return false;
    const effectData = effect.toObject();
    delete effectData._id;
    effectData.transfer = false;
    game.neuroshima.log(`[DragDrop] Dropping effect "${effect.name}" onto actor "${this.document.name}"`);
    return this.document.createEmbeddedDocuments("ActiveEffect", [effectData]);
  }

  /** @override */
  async _onDrop(event) {
    game.neuroshima.log("_onDrop triggered");
    try {
      const rawData = TextEditor.getDragEventData(event);
      if (rawData?.fromChatCard) {
        event._fromChatCard = true;
        event._itemCardMessageId = rawData.messageId ?? null;
      }
    } catch(e) {}
    return super._onDrop(event);
  }

  /** @override */
  async _onDropItem(event, item) {
    game.neuroshima.log("_onDropItem triggered", {item});

    // W ApplicationV2 drugim argumentem jest już Document, ale na wszelki wypadek obsługujemy oba przypadki
    const sourceItem = (item instanceof foundry.abstract.Document) ? item : await NeuroshimaItem.fromDropData(item);
    if ( !sourceItem ) return super._onDropItem(event, item);

    // Sprawdź czy upuszczamy amunicję na magazynek lub broń z magazynkiem
    const targetEl = event.target.closest(".magazine-container, .magazine-item-row, .equipment-item, .item[data-item-id]");
    const targetId = targetEl?.dataset.itemId;
    let targetItem = this.document.items.get(targetId);

    // Jeśli targetItem to nie magazynek, sprawdź czy upuszczono na broń dystansową, która ma przypisany magazynek
    if (targetItem && targetItem.type !== "magazine") {
        if (targetItem.type === "weapon" && targetItem.system.weaponType === "ranged" && targetItem.system.magazine) {
            targetItem = this.document.items.get(targetItem.system.magazine);
        }
    }

    if (sourceItem.type === "ammo" && targetItem?.type === "magazine") {
        event.stopPropagation();
        this._onLoadAmmoIntoMagazine(sourceItem, targetItem);
        return false;
    }

    if (["specialization", "origin", "profession"].includes(sourceItem.type)) {
      return this._onDropBackgroundItem(event, sourceItem, item);
    }

    if (sourceItem.type === "disease" && ["character", "npc"].includes(this.document.type)) {
      return this._onDropDiseaseItem(event, sourceItem);
    }

    if (sourceItem.type === "trick" && this.document.type === "character") {
      const alreadyOwned = this.document.items.some(i => i.type === "trick" && i.name === sourceItem.name);
      if (!alreadyOwned) {
        const { TRICK_COST, showXpDialog, applyXpEntry } = await import("../helpers/xp.js");
        const actor = this.document;
        const currentXp = actor.system.xp?.current ?? 0;
        const result = await showXpDialog(
          TRICK_COST,
          game.i18n.format("NEUROSHIMA.XP.Dialog.TrickDescription", { name: sourceItem.name }),
          currentXp
        );
        if (result === null) return false;
        if (!result.free) {
          const changed = {};
          applyXpEntry(actor, changed, result.cost, sourceItem.name, null, null);
          await actor.update(changed);
        }
      }
    }

    const fromChatCard = event._fromChatCard || item?.fromChatCard;

    if (fromChatCard) {
        const msgId = event._itemCardMessageId ?? item?.messageId;
        if (msgId) {
            const preventSelfTake = game.settings.get("neuroshima", "itemCardPreventSelfTake") ?? false;
            if (preventSelfTake) {
                const msg = game.messages.get(msgId);
                const sourceActorId = msg?.getFlag("neuroshima", "itemCard")?.sourceActorId;
                if (sourceActorId && sourceActorId === this.document.id) {
                    ui.notifications.warn(game.i18n.localize("NEUROSHIMA.ItemCard.SelfTakeBlocked"));
                    return;
                }
            }
        }
        const itemData = sourceItem.toObject();
        delete itemData._id;
        await this.document.createEmbeddedDocuments("Item", [itemData]);
        if (msgId) {
            const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
            await NeuroshimaChatMessage.decrementItemCardLimit(msgId);
        }
        return;
    }

    const result = await super._onDropItem(event, item);
    
    if (result && event.ctrlKey && sourceItem.actor && (sourceItem.actor.id !== this.document.id)) {
        await sourceItem.delete();
        game.neuroshima.log(`Moved item ${sourceItem.name} from actor ${sourceItem.actor.name} to ${this.document.name}`);
    }
    
    return result;
  }

  /**
   * Handle dropping a background item (specialization / origin / profession) onto the actor.
   * Replaces any existing item of the same type and updates system text field.
   * @private
   */
  async _onDropBackgroundItem(event, sourceItem, rawDropData) {
    const actor = this.document;
    const type = sourceItem.type;
    const fieldMap = { specialization: "system.specialization", origin: "system.origin", profession: "system.profession" };
    const fieldPath = fieldMap[type];

    const existing = actor.items.filter(i => i.type === type && i.id !== sourceItem.id);
    for (const old of existing) await old.delete();

    let created;
    if (sourceItem.parent?.id !== actor.id) {
      [created] = await actor.createEmbeddedDocuments("Item", [sourceItem.toObject()]);
      if (sourceItem.actor && sourceItem.actor.id !== actor.id) await sourceItem.delete();
    } else {
      created = sourceItem;
    }

    const updateData = { [fieldPath]: created.name };

    if (type === "specialization" && created.system.skillSpecializations) {
      for (const [specKey, enabled] of Object.entries(created.system.skillSpecializations)) {
        if (enabled) updateData[`system.specializations.${specKey}`] = true;
      }
    }

    await actor.update(updateData);
    game.neuroshima.log(`[Background] dropped ${type} "${created.name}" onto actor "${actor.name}"`);

    if (["origin", "profession"].includes(type) && actor.type === "character") {
      const traits = Array.from(created.system.traits || []);
      if (traits.length > 0) {
        await this._showTraitChoiceDialog(traits, created.name, created.id, type, actor, created, fieldPath);
      }
    }
  }

  async _onDropDiseaseItem(event, sourceItem) {
    const actor = this.document;

    if (sourceItem.parent?.id !== actor.id) {
      await actor.createEmbeddedDocuments("Item", [sourceItem.toObject()]);
      if (sourceItem.actor && sourceItem.actor.id !== actor.id) await sourceItem.delete();
    }
    game.neuroshima.log(`[Disease] dropped "${sourceItem.name}" onto actor "${actor.name}"`);
  }

  async _onAdjustDiseaseState(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if (!item || item.type !== "disease") return;

    const states = ["none", "firstSymptoms", "acute", "critical", "terminal"];
    const current = item.system.currentState ?? "none";
    const currentIndex = states.indexOf(current);

    let newIndex;
    if (event.button === 2 || event.type === "contextmenu") {
      newIndex = Math.max(0, currentIndex - 1);
    } else {
      newIndex = Math.min(4, currentIndex + 1);
    }

    const newState = states[Math.max(0, Math.min(4, newIndex))];
    await item.update({ "system.currentState": newState });
  }

  async _onAdjustTransientPenalty(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if (!item || item.type !== "disease") return;
    const value = parseInt(target.value) || 0;
    await item.update({ "system.transientPenalty": value });
  }

  async _showTraitChoiceDialog(traitUuids, sourceName, sourceItemId, sourceType, actor, sourceCreatedItem, sourceFieldPath) {
    const resolved = [];
    for (const uuid of traitUuids) {
      const item = await fromUuid(uuid);
      if (item) resolved.push({ uuid, item });
    }
    if (resolved.length === 0) return;

    const prompt = game.i18n.format("NEUROSHIMA.Traits.ChooseTraitPrompt", { source: sourceName });
    const chosenUuid = await TraitChoiceDialog.wait(resolved, prompt);

    if (!chosenUuid) {
      if (sourceCreatedItem) {
        await sourceCreatedItem.delete();
        if (sourceFieldPath) await actor.update({ [sourceFieldPath]: "" });
        game.neuroshima.log(`[Trait] Dialog cancelled — removed "${sourceName}" from actor "${actor.name}"`);
      }
      return;
    }

    const chosenItem = await fromUuid(chosenUuid);
    if (!chosenItem) return;

    const existingLinked = actor.items.filter(i =>
      i.type === "trait" && i.getFlag?.("neuroshima", "traitSource")?.itemId === sourceItemId
    );
    for (const old of existingLinked) await old.delete();

    const itemData = chosenItem.toObject();
    foundry.utils.setProperty(itemData, "flags.neuroshima.traitSource", {
      type: sourceType,
      itemId: sourceItemId,
      name: sourceName
    });
    await actor.createEmbeddedDocuments("Item", [itemData]);
    game.neuroshima.log(`[Trait] Copied trait "${chosenItem.name}" from "${sourceName}" to actor "${actor.name}" (source tracked)`);
  }

  /**
   * Handle loading ammo into a magazine.
   * @private
   */
  async _onLoadAmmoIntoMagazine(ammo, magazine) {
      game.neuroshima.log("Inicjalizacja ładowania amunicji", { ammo, magazine });
      const amount = await AmmunitionLoadingDialog.wait({ ammo, magazine });
      if (!amount || isNaN(amount)) {
          game.neuroshima.log("Anulowano ładowanie amunicji lub brak ilości");
          return;
      }

      const contents = [...(magazine.system.contents || [])];
      
      const ammoData = {
          ammoId: ammo.id,
          name: ammo.name,
          img: ammo.img,
          quantity: amount,
          overrides: {
              enabled: ammo.system.isOverride,
              damage: ammo.system.overrideDamage ? ammo.system.damage : null,
              piercing: ammo.system.overridePiercing ? ammo.system.piercing : null,
              jamming: ammo.system.overrideJamming ? ammo.system.jamming : null,
              // Kopiowanie parametrów śrutu do nadpisań magazynka (LIFO)
              isPellet: ammo.system.isPellet,
              pelletCount: ammo.system.isPellet ? (ammo.system.pelletCount || 1) : 1,
              pelletRanges: ammo.system.isPellet ? ammo.system.pelletRanges : null
          }
      };

      game.neuroshima.log("Przygotowanie danych amunicji do dodania", ammoData);

      // Dodaj nową amunicję do magazynka (na górę stosu) - Sprawdź czy można połączyć z ostatnim
      const lastStack = contents[contents.length - 1];
      if (this._isSameAmmo(lastStack, ammoData)) {
          lastStack.quantity += ammoData.quantity;
          game.neuroshima.log("Połączono ze stosującym się elementem w magazynku", { lastStack });
      } else {
          contents.push(ammoData);
      }

      game.neuroshima.log("Aktualizacja zawartości magazynka", { contents });
      await magazine.update({ "system.contents": contents });
      
      // Odejmij amunicję z ekwipunku
      if (ammo.system.quantity <= amount) {
          game.neuroshima.log("Usuwanie pustego stosu amunicji z ekwipunku");
          await ammo.delete();
      } else {
          game.neuroshima.log("Aktualizacja ilości amunicji w ekwipunku", { remaining: ammo.system.quantity - amount });
          await ammo.update({ "system.quantity": ammo.system.quantity - amount });
      }

      ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.AmmoLoaded", {
          amount,
          ammo: ammo.name,
          mag: magazine.name
      }));
  }

  /**
   * Handle unloading a magazine.
   * @private
   */
  async _onUnloadMagazine(event, target) {
      const magId = typeof target === 'string' ? target : target.closest("[data-item-id]").dataset.itemId;
      const magazine = this.document.items.get(magId);
      if (!magazine || magazine.type !== "magazine") return;

      const contents = magazine.system.contents;
      if (!contents.length) return;

      // Group identical consecutive stacks in the magazine contents before unloading to inventory
      // to avoid creating multiple separate items if they are already identical.
      const groupedContents = [];
      for (const stack of contents) {
          const last = groupedContents[groupedContents.length - 1];
          if (this._isSameAmmo(last, stack)) {
              last.quantity += stack.quantity;
          } else {
              groupedContents.push(stack);
          }
      }

      const actor = this.document;

      // Zwróć amunicję do ekwipunku
      for (const stack of groupedContents) {
          // Szukaj istniejącej amunicji tego samego typu (nazwa, kaliber ORAZ identyczne nadpisania)
          let existingAmmo = actor.items.find(i => {
              if (i.type !== "ammo" || i.name !== stack.name || i.system.caliber !== magazine.system.caliber) return false;
              return this._isSameAmmo(i, stack);
          });
          
          if (existingAmmo) {
              await existingAmmo.update({ "system.quantity": existingAmmo.system.quantity + stack.quantity });
          } else {
              // Stwórz nowy przedmiot amunicji
              await NeuroshimaItem.create({
                  name: stack.name,
                  type: "ammo",
                  img: stack.img || "systems/neuroshima/assets/img/ammo.svg",
                  system: {
                      quantity: stack.quantity,
                      caliber: magazine.system.caliber,
                      // Przywracamy statystyki z zapisanego stacka
                      isOverride: stack.overrides?.enabled || false,
                      overrideDamage: !!stack.overrides?.damage,
                      damage: stack.overrides?.damage || "L",
                      overridePiercing: !!stack.overrides?.piercing,
                      piercing: stack.overrides?.piercing || 0,
                      overrideJamming: !!stack.overrides?.jamming,
                      jamming: stack.overrides?.jamming || 20,
                      isPellet: stack.overrides?.isPellet || false,
                      pelletCount: stack.overrides?.pelletCount || 1,
                      pelletRanges: stack.overrides?.pelletRanges || null
                  }
              }, { parent: actor });
          }
      }

      await magazine.update({ "system.contents": [] });
      ui.notifications.info(game.i18n.format("NEUROSHIMA.Notifications.MagazineUnloaded", { name: magazine.name }));
  }

  /**
   * Compare two ammo stacks or an item and a stack definition to see if they are identical in stats.
   * @private
   */
  _isSameAmmo(s1, s2) {
      if (!s1 || !s2) return false;
      if (s1.name !== s2.name) return false;
      
      // Handle comparing Actor Item to Magazine Stack or Magazine Stack to Magazine Stack
      const getStats = (obj) => {
          if (obj.system) { // Actor Item
              const s = obj.system;
              return {
                  damage: s.damage ?? "L",
                  piercing: s.piercing ?? 0,
                  jamming: s.jamming ?? 20,
                  isPellet: !!s.isPellet,
                  pelletCount: s.pelletCount ?? 1,
                  pelletRanges: s.pelletRanges || null,
                  enabled: !!s.isOverride
              };
          } else { // Magazine Stack
              const o = obj.overrides || {};
              return {
                  damage: o.damage ?? "L",
                  piercing: o.piercing ?? 0,
                  jamming: o.jamming ?? 20,
                  isPellet: !!o.isPellet,
                  pelletCount: o.pelletCount ?? 1,
                  pelletRanges: o.pelletRanges || null,
                  enabled: !!o.enabled
              };
          }
      };

      const stats1 = getStats(s1);
      const stats2 = getStats(s2);

      let samePelletStats = true;
      if (stats1.isPellet && stats2.isPellet) {
          samePelletStats = stats1.pelletCount === stats2.pelletCount;
          if (samePelletStats && stats1.pelletRanges && stats2.pelletRanges) {
              samePelletStats = JSON.stringify(stats1.pelletRanges) === JSON.stringify(stats2.pelletRanges);
          }
      }

      return stats1.damage === stats2.damage && 
             stats1.piercing === stats2.piercing && 
             stats1.jamming === stats2.jamming && 
             stats1.isPellet === stats2.isPellet &&
             stats1.enabled === stats2.enabled &&
             samePelletStats;
  }

  /**
   * Toggle the visibility of difficulty thresholds.
   */
  async _onToggleDifficulties(event, target) {
    this._difficultiesCollapsed = !this._difficultiesCollapsed;
    this.render({ parts: ["attributes"] });
  }

  /**
   * Handle changing the actor profile image.
   */
  async _onEditImage(event, target) {
    const actor = this.document;
    const tokenizerMod = game.modules.get("tokenizer");
    if (tokenizerMod?.active) {
      if (typeof TokenizerManager !== "undefined" && TokenizerManager.tokenizeActor) {
        return TokenizerManager.tokenizeActor(actor);
      }
      if (tokenizerMod.api?.launch) return tokenizerMod.api.launch(actor);
      if (tokenizerMod.api?.tokenizeActor) return tokenizerMod.api.tokenizeActor(actor);
    }
    return new FilePicker({
      type: "image",
      current: actor.img,
      callback: async path => {
        await actor.update({ img: path });
      }
    }).browse();
  }

  async _onRollAttribute(event, target) {
    const attrKey = target.dataset.attribute;
    const actor = this.document;
    const system = actor.system;
    
    const attrValue = system.attributeTotals[attrKey];
    const label = game.i18n.localize(NEUROSHIMA.attributes[attrKey].label);

    return NeuroshimaActorSheet._showRollDialog({
      stat: attrValue,
      skill: 0,
      label: label,
      actor: actor,
      isSkill: false,
      currentAttribute: attrKey
    });
  }

  async _onRollSkill(event, target) {
    if (event.target.closest("input, button, a, select")) return;
    if (target.classList.contains("knowledge-editing")) return;
    const skillKey = target.dataset.skill;
    const actor = this.document;
    const system = actor.system;

    // Find which attribute this skill belongs to
    let attrKey = "";
    for (const [aKey, specs] of Object.entries(NEUROSHIMA.skillConfiguration)) {
      for (const skills of Object.values(specs)) {
        if (skills.includes(skillKey)) {
          attrKey = aKey;
          break;
        }
      }
      if (attrKey) break;
    }

    const statValue = system.attributeTotals[attrKey];
    const skillValue = system.skillTotals?.[skillKey] ?? system.skills[skillKey].value;

    let label;
    if (skillKey.startsWith("knowledge")) {
      const customLabel = system.skills[skillKey]?.label?.trim();
      label = customLabel || game.i18n.localize(`NEUROSHIMA.Skills.${skillKey}`);
    } else {
      label = game.i18n.localize(`NEUROSHIMA.Skills.${skillKey}`);
    }

    return NeuroshimaActorSheet._showRollDialog({
      stat: statValue,
      skill: skillValue,
      label: label,
      actor: actor,
      isSkill: true,
      currentAttribute: attrKey,
      skillKey
    });
  }

  _onToggleKnowledgeEdit(event, target) {
    const skillKey = target.dataset.skill;
    const skillItem = target.closest(".skill-item");
    const labelEl = skillItem.querySelector(".skill-knowledge-label");
    const input = skillItem.querySelector(".skill-label-input");
    const icon = target.querySelector("i");
    const isEditing = skillItem.classList.contains("knowledge-editing");

    if (isEditing) {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      skillItem.classList.remove("knowledge-editing");
      const newLabel = input.value.trim();
      const fallback = game.i18n.localize(`NEUROSHIMA.Skills.${skillKey}`);
      labelEl.textContent = newLabel ? newLabel : fallback;
      icon.className = "fas fa-check";
      requestAnimationFrame(() => { icon.className = "fas fa-pen"; });
    } else {
      skillItem.classList.add("knowledge-editing");
      input.focus();
      input.select();
      icon.className = "fas fa-check";
    }
  }

  /**
   * Prepare weapon data for combat tab with magazine information.
   */
  _prepareCombatWeapons(items) {
    const weapons = items.filter(i => i.type === "weapon" && i.system.equipped);
    const magazines = items.filter(i => i.type === "magazine");

    return weapons.map(weapon => {
      const wData = weapon.system;
      const weaponObj = {
        id: weapon.id,
        uuid: weapon.uuid,
        name: weapon.name,
        img: weapon.img,
        type: wData.weaponType,
        attack: wData.attackBonus || 0,
        defense: wData.defenseBonus || 0,
        damage: wData.damage || "",
        piercing: wData.piercing || 0,
        fireRate: wData.fireRate || 0,
        jammed: !!wData.jammed
      };

      if (wData.weaponType === "melee") {
        weaponObj.damage = [wData.damageMelee1, wData.damageMelee2, wData.damageMelee3].filter(d => d).join("/");
      } else if (wData.weaponType === "grenade") {
        const blastZones = wData.blastZones ?? [];
        weaponObj.isGrenade = true;
        weaponObj.freeThrowDistance = wData.freeThrowDistance ?? 10;
        weaponObj.maxRange = blastZones.length > 0 ? Math.max(...blastZones.map(z => z.radius ?? 0)) : 0;
        weaponObj.blastZones = blastZones;
      } else {
        // Handle ranged and thrown weapon ammo stats
        let ammoJamming = wData.jamming || 20;
        
        // Find matching magazine
        // We only show a magazine if it's explicitly selected by ID or Name
        let magazine = null;
        if (wData.magazine) {
            magazine = magazines.find(m => m.id === wData.magazine || m.name === wData.magazine);
        }
        
        if (magazine) {
          const contents = magazine.system.contents || [];
          weaponObj.magazine = {
            id: magazine.id,
            name: magazine.name,
            count: magazine.system.totalCount,
            max: magazine.system.capacity,
            contents: contents,
            contentsReversed: [...contents].reverse(),
            tooltip: contents.length > 0 ? [...contents].reverse().map(c => {
                let s = `• ${c.name} (x${c.quantity})`;
                if (c.overrides?.enabled) {
                    const mods = [];
                    if (c.overrides.damage) mods.push(`Obr: ${c.overrides.damage}`);
                    if (c.overrides.piercing !== null) mods.push(`PP: ${c.overrides.piercing}`);
                    if (c.overrides.jamming !== null) mods.push(`Zac: ${c.overrides.jamming}`);
                    if (mods.length) s += ` [${mods.join(", ")}]`;
                }
                return s;
            }).join("\n") : game.i18n.localize("NEUROSHIMA.Items.Fields.None")
          };
          
          if (contents.length > 0) {
              const topStack = contents[contents.length - 1];
              // Stats for next shot (TOP of LIFO stack)
              weaponObj.damage = topStack.overrides?.enabled && topStack.overrides.damage ? topStack.overrides.damage : wData.damage;
              weaponObj.piercing = topStack.overrides?.enabled && topStack.overrides.piercing !== null ? topStack.overrides.piercing : (wData.piercing || 0);
              
              // Jamming is the weakest link among ALL loaded bullets
              const contentJamming = contents.map(c => 
                  (c.overrides?.enabled && c.overrides.jamming !== null) ? c.overrides.jamming : (wData.jamming || 20)
              );
              ammoJamming = Math.min(wData.jamming || 20, ...contentJamming);
          }
        } else if (wData.weaponType === "thrown" && wData.magazine) {
            // Special handling for thrown weapons using ammo items
            const ammoItem = items.find(i => i.id === wData.magazine);
            if (ammoItem && ammoItem.type === "ammo") {
                weaponObj.damage = (ammoItem.system.isOverride && ammoItem.system.overrideDamage) ? ammoItem.system.damage : wData.damage;
                weaponObj.piercing = (ammoItem.system.isOverride && ammoItem.system.overridePiercing) ? ammoItem.system.piercing : (wData.piercing || 0);
                
                const stackJamming = (ammoItem.system.isOverride && ammoItem.system.overrideJamming) ? ammoItem.system.jamming : (wData.jamming || 20);
                ammoJamming = Math.min(wData.jamming || 20, stackJamming);
                weaponObj.ammoName = ammoItem.name;
                weaponObj.ammoCount = ammoItem.system.quantity;
            }
        }
        
        weaponObj.jamming = ammoJamming;
      }

      return weaponObj;
    });
  }

  /**
   * Group equipped armor by anatomical location and calculate totals.
   */
  _prepareAnatomicalArmor(equippedArmor, actor = null) {
    const locations = {};
    for (const [key, data] of Object.entries(NEUROSHIMA.bodyLocations)) {
      locations[key] = { label: data.label, items: [], totalAP: 0, bonusAP: 0 };
    }

    for (const item of equippedArmor) {
      const armor = item.system.armor || {};
      const ratings = getEffectiveArmorRatings(item);
      const damages = armor.damage || {};
      const durDamage = armor.durabilityDamage || 0;
      const durability = armor.durability || 0;

      for (const [loc, rating] of Object.entries(ratings)) {
        if (rating > 0 && locations[loc]) {
          const locDamage = damages[loc] || 0;
          const currentAP = Math.max(0, rating - locDamage);
          const currentDur = Math.max(0, durability - durDamage);
          
          locations[loc].totalAP += currentAP;
          locations[loc].items.push({
            id: item.id,
            name: item.name,
            img: item.img,
            durability: durability,
            durabilityDamage: durDamage,
            currentDurability: currentDur,
            rating: rating,
            damage: locDamage,
            currentRating: currentAP
          });
        }
      }
    }

    if (actor?.system?.armorBonus) {
      const bonusAll = Number(actor.system.armorBonus.all) || 0;
      for (const key of Object.keys(locations)) {
        const bonusLoc = Number(actor.system.armorBonus[key]) || 0;
        const total = bonusAll + bonusLoc;
        if (total !== 0) {
          locations[key].totalAP += total;
          locations[key].bonusAP = total;
        }
      }
    }

    const effectBonus = _collectArmorBonusByEffect(actor);
    for (const [key, loc] of Object.entries(locations)) {
      const parts = [];
      for (const itm of loc.items) {
        parts.push(`${foundry.utils.escapeHTML(itm.name)}: <strong>${itm.currentRating}</strong>`);
      }
      for (const e of [...(effectBonus.all ?? []), ...(effectBonus[key] ?? [])]) {
        const sign = e.value >= 0 ? "+" : "";
        parts.push(`${foundry.utils.escapeHTML(e.name)}: <strong>${sign}${e.value}</strong>`);
      }
      loc.tooltip = parts.join("<br>");
    }

    return locations;
  }

  /**
   * Handle modifying armor durability damage via click.
   */
  async _onModifyDurability(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if (!item || item.type !== "armor") return;

    const isRightClick = event.type === "contextmenu";
    const currentDamage = item.system.armor?.durabilityDamage || 0;
    const maxDurability = item.system.armor?.durability || 0;

    let newDamage = isRightClick ? currentDamage + 1 : currentDamage - 1;
    newDamage = Math.clamp(newDamage, 0, maxDurability);

    if (newDamage !== currentDamage) {
      return item.update({ "system.armor.durabilityDamage": newDamage });
    }
  }

  /**
   * Handle modifying armor AP damage via click.
   */
  async _onModifyAP(event, target) {
    const itemId = target.dataset.itemId;
    const location = target.dataset.location;
    const item = this.document.items.get(itemId);
    if (!item || item.type !== "armor" || !location) return;

    const isRightClick = event.type === "contextmenu";
    const currentDamage = item.system.armor?.damage?.[location] || 0;
    const maxAP = item.system.armor?.ratings?.[location] || 0;

    let newDamage = isRightClick ? currentDamage + 1 : currentDamage - 1;
    newDamage = Math.clamp(newDamage, 0, maxAP);

    if (newDamage !== currentDamage) {
      return item.update({ [`system.armor.damage.${location}`]: newDamage });
    }
  }

  /**
   * Handle toggling the healing state of a wound.
   */
  async _onToggleHealing(event, target) {
    const li = target.closest(".item");
    const item = this.document.items.get(li.dataset.itemId);
    if (!item || item.type !== "wound") return;
    
    this._saveWoundsScroll();
    // _onUpdate hook will handle selective rendering of combat part only
    return item.update({ "system.isHealing": !item.system.isHealing });
  }

  /**
   * Handle rolling a weapon attack.
   */
  async _onRollWeapon(event, target) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
    
    // Zapobieganie wielokrotnym wywołaniom (np. double click)
    if (this._isRolling) {
        game.neuroshima.log("_onRollWeapon: Rzut jest już w toku, ignoruję dodatkowe kliknięcie.");
        return;
    }
    this._isRolling = true;

    const itemId = target.closest(".item")?.dataset.itemId;
    const weapon = this.document.items.get(itemId);
    if (!weapon) {
        this._isRolling = false;
        return;
    }
    
    try {
        game.neuroshima.group(`_onRollWeapon: ${weapon.name}`);
        game.neuroshima.log("Inicjalizacja rzutu bronią");

        // Walidacja wyboru magazynka/amunicji przed wyrenderowaniem dialogu
        const wData = weapon.system;
        const isRanged = wData.weaponType === "ranged";
        const isThrown = wData.weaponType === "thrown";

        if ((isRanged || isThrown) && wData.caliber) {
            if (!wData.magazine) {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoMagazineSelected"));
                game.neuroshima.log("Błąd: Brak wybranego magazynka");
                throw new Error("No magazine selected");
            }
            
            const magazine = this.document.items.get(wData.magazine);
            if (!magazine || (magazine.type === "magazine" && magazine.system.totalCount <= 0)) {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.OutOfAmmo"));
                game.neuroshima.log("Błąd: Brak amunicji w magazynku");
                throw new Error("Out of ammo");
            }

            if (magazine.type === "ammo" && magazine.system.quantity <= 0) {
                ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.OutOfAmmo"));
                game.neuroshima.log("Błąd: Brak amunicji w ekwipunku");
                throw new Error("Out of ammo");
            }
        }

        if (wData.jammed && wData.weaponType !== "melee") {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.WeaponIsJammed"));
            game.neuroshima.log("Błąd: Broń jest zacięta, nie można oddać strzału");
            throw new Error("Weapon is jammed");
        }

        const lastRoll = this.document.system.lastWeaponRoll || {};
        let distance = 0;
        let targets = Array.from(game.user.targets ?? []);
        let targetUuids = targets.map(t => t.document.uuid);
        let grenadeTargetPoint = null;

        if (weapon.system.weaponType === "grenade" && targets.length > 0) {
            for (const t of targets) t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
            targets = [];
            targetUuids = [];
        }

        // Tryb wyboru na mapie jeśli brak targetów
        if (targetUuids.length === 0) {
            const actorSourceToken = this._getSourceToken();
            if (actorSourceToken) {
                game.neuroshima.log("Brak aktywnych targetów, przechodzę do trybu wyboru na mapie");
                await this.minimize();
                const _grenadeBlastZones = weapon.system.blastZones ?? [];
                const _grenadeRadius = (weapon.system.weaponType === "grenade" && _grenadeBlastZones.length > 0)
                    ? Math.max(..._grenadeBlastZones.map(z => z.radius))
                    : 0;
                const targetData = await this._waitForTarget({ templateRadius: _grenadeRadius });
                await this.maximize();

                if (targetData && !targetData.cancelled) {
                    game.neuroshima.log("Otrzymano dane z mapy:", targetData);
                    distance = targetData.distance || 0;

                    if (weapon.system.weaponType === "grenade") {
                        if (targetData.point) {
                            grenadeTargetPoint = targetData.point;
                        } else if (targetData.token) {
                            const gs = canvas.grid?.size ?? 100;
                            const td = targetData.token.document;
                            grenadeTargetPoint = { x: td.x + (td.width * gs) / 2, y: td.y + (td.height * gs) / 2 };
                        }
                    }

                    if (targetData.token) {
                        targetData.token.setTarget(true, { releaseOthers: true });
                        targets = [targetData.token];
                        targetUuids = targets.map(t => t.document.uuid);
                    }
                } else if (!targetData) {
                    game.neuroshima.log("Timeout wyboru celu — anulowanie rzutu");
                    this._isRolling = false;
                    game.neuroshima.groupEnd();
                    return;
                } else {
                    game.neuroshima.log("Anulowano wybór celu (PPM) — otwieranie dialogu bez celu");
                }
            } else {
                game.neuroshima.log("Brak tokena aktora na scenie — otwieranie dialogu bez celu (tryb narracyjny)");
            }
        }
        // Detect distance for ranged/thrown weapons
        if (weapon.system.weaponType !== "melee") {
            const actorToken = this._getSourceToken();
            if (actorToken && targets.length > 0) {
                distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, targets[0]);
                game.neuroshima.log(`Znaleziono aktywny target: ${targets[0].name}, dystans: ${distance}m`);
            }
        }

        game.neuroshima.log("Otwieranie dialogu rzutu z dystansem:", distance);
        game.neuroshima.groupEnd();

    // Jeśli to broń biała i (mamy cel LUB mamy oczekującego atakującego LUB jesteśmy w aktywnym pojedynku), inicjujemy/kontynuujemy
    if (weapon.system.weaponType === "melee") {

        // ── Chat-based opposed modes ─────────────────────────────────────────
        const combatTypeSetting = game.settings.get("neuroshima", "meleeCombatType") || "default";
        if (combatTypeSetting === "opposedPips" || combatTypeSetting === "opposedSuccesses") {
            const myUuidsCheck = [this.document.uuid];
            if (this.document.token) myUuidsCheck.push(this.document.token.uuid);

            // 1. Check actor flag (WFRP-style: set on defender when attack is pending)
            const opposeFlag = this.document.getFlag("neuroshima", "oppose");
            if (opposeFlag?.messageId) {
                const pendingMsg = game.messages.get(opposeFlag.messageId);
                const opposeData = pendingMsg?.getFlag("neuroshima", "opposedChat");
                if (opposeData?.status === "pending") {
                    const syntheticPending = {
                        id: opposeData.defenderUuid,
                        attackerId: opposeData.attackerUuid,
                        attackerTokenUuid: opposeData.attackerTokenUuid,
                        defenderId: opposeData.defenderUuid,
                        mode: opposeData.mode,
                        opposedChatMessageId: opposeFlag.messageId
                    };
                    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
                    await MeleeOpposedChat.openDefenseDialog(this.document, syntheticPending, weapon.id);
                    this._isRolling = false;
                    return;
                }
                // Stale flag — clean it up
                await this.document.unsetFlag("neuroshima", "oppose");
            }

            // 2. Fallback: combat pending (covers same-client scenarios without socket)
            const combatPendings = game.combat?.getFlag("neuroshima", "meleePendings") || {};
            const opposedPending = Object.values(combatPendings).find(p => {
                if (!p.active || !p.mode) return false;
                return myUuidsCheck.some(u => game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, u));
            });
            if (opposedPending) {
                const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
                await MeleeOpposedChat.openDefenseDialog(this.document, opposedPending, weapon.id);
                this._isRolling = false;
                return;
            }

            // 3. No pending — initiate a new opposed attack against the current target
            const chatTargets = targetUuids.filter(uuid => !myUuidsCheck.includes(uuid));
            if (chatTargets.length > 0) {
                const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
                await MeleeOpposedChat.initiateAttack(this.document, weapon, chatTargets[0], combatTypeSetting);
                this._isRolling = false;
                return;
            }
        }
        // ── End chat-based opposed branch ────────────────────────────────────

        const combat = game.combat;
        const pendings = combat?.getFlag("neuroshima", "meleePendings") || {};
        
        const myUuids = [this.document.uuid];
        if (this.document.token) myUuids.push(this.document.token.uuid);

        // Ignoruj cele, które są nami samymy
        const actualTargets = targetUuids.filter(uuid => !myUuids.includes(uuid));
        let targetUuid = actualTargets[0];
        let existingPending = null;

        // 1. Sprawdź czy ktoś nas atakuje (Pending)
        // Jeśli mamy cel, który nas atakuje - to on jest priorytetem
        if (targetUuid) {
            existingPending = Object.values(pendings).find(p => {
                if (!p.active) return false;
                const amIDefender = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, this.document.uuid);
                const isHeAttacker = game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.attackerId, targetUuid);
                return amIDefender && isHeAttacker;
            });
        } 
        
        // Jeśli nie mamy wybranego atakującego jako celu, ale KTOŚ nas atakuje, odpowiedzmy na pierwszy dostępny atak
        if (!existingPending) {
            existingPending = Object.values(pendings).find(p => p.active && game.neuroshima.NeuroshimaMeleeCombat.isSameActor(p.defenderId, this.document.uuid));
            if (existingPending) targetUuid = existingPending.attackerId;
        }

        // 2. Jeśli mamy na sobie atak - musimy na niego odpowiedzieć
        if (existingPending) {
            // ── Opposed-chat mode: weapon-roll dialog instead of initiative ──
            if (existingPending.mode) {
                const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
                await MeleeOpposedChat.openDefenseDialog(this.document, existingPending, weapon.id);
                this._isRolling = false;
                return;
            }
            // ── Standard melee pending ────────────────────────────────────────
            const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
            const initiativeDialog = new NeuroshimaInitiativeRollDialog({
                actor: this.document,
                isMelee: true,
                meleeMode: "respond",
                pendingId: existingPending.id,
                weaponId: weapon.id,
                targets: [targetUuid],
                onRoll: async (rollData) => {
                    const result = await game.neuroshima.NeuroshimaDice.rollInitiative({
                        ...rollData,
                        actor: this.document,
                        isMeleeInitiative: true
                    });
                    
                    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
                    await NeuroshimaMeleeCombat.respondToMeleePending(existingPending.id, result.successPoints, weapon.id);
                    
                    this._isRolling = false;
                    return result;
                },
                onClose: () => { this._isRolling = false; }
            });
            await initiativeDialog.render(true);
            return;
        }

        // 3. Jeśli nie ma pendingu, ale jesteśmy w aktywnym starciu - otwórz panel
        const activeEncounterId = this.document.getFlag("neuroshima", "activeMeleeEncounter");
        if (activeEncounterId && !targetUuid) {
            const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
            NeuroshimaMeleeCombat.openMeleeApp(activeEncounterId);
            this._isRolling = false;
            return;
        }

        // 4. Jeśli mamy cel i nie ma na nas pendingu - inicjujemy nowy atak
        if (targetUuid) {
            if (!game.combat) {
                ui.notifications.warn("Najpierw utwórz Encounter w Combat Trackerze.");
                this._isRolling = false;
                return;
            }
            const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
            const initiativeDialog = new NeuroshimaInitiativeRollDialog({
                actor: this.document,
                isMelee: true,
                meleeMode: "initiate",
                weaponId: weapon.id,
                targets: targets,
                onClose: () => { this._isRolling = false; }
            });
            await initiativeDialog.render(true);
            return;
        }
    }

        if (weapon.system.weaponType === "grenade") {
            const grenadeDialog = new NeuroshimaGrenadeRollDialog({
                actor: this.document,
                weapon: weapon,
                distance: distance || 0,
                grenadeTargetPoint,
                onClose: () => { this._isRolling = false; }
            });
            await grenadeDialog.render(true);
        } else {
            const dialog = new NeuroshimaWeaponRollDialog({
                actor: this.document,
                weapon: weapon,
                rollType: (isRanged || isThrown) ? "ranged" : "melee",
                targets: targetUuids,
                lastRoll: {
                    ...lastRoll,
                    distance: distance || lastRoll.distance
                },
                onClose: () => { this._isRolling = false; }
            });
            await dialog.render(true);
        }
    } catch (err) {
        game.neuroshima.log("Przerwano rzut bronią lub wystąpił błąd:", err.message);
        this._isRolling = false;
        game.neuroshima.groupEnd();
    }
  }

  /**
   * Znajduje najlepszy token reprezentujący aktora na aktualnej scenie.
   * @private
   */
  _getSourceToken() {
    // 1. Jeśli aktor jest powiązany z konkretnym tokenem (unlinked/synthetic)
    if (this.document.token) return this.document.token.object;

    // 2. Pobierz wszystkie tokeny tego aktora na aktualnej scenie
    const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === this.document.id);
    if (tokens.length === 0) return null;
    if (tokens.length === 1) return tokens[0];

    // 3. Priorytet dla tokenów kontrolowanych przez aktualnego użytkownika
    const controlled = tokens.filter(t => t.controlled);
    if (controlled.length > 0) return controlled[0];

    // 4. Jeśli MG ma otwarty arkusz i nic nie kontroluje, bierzemy pierwszy znaleziony
    return tokens[0];
  }

  /**
   * Oczekuje na kliknięcie na token lub punkt na mapie w celu obliczenia dystansu.
   * @param {object} [options]
   * @param {number} [options.templateRadius] Jeśli > 0, pokazuje podgląd szablonu granatu podczas celowania.
   * @private
   */
  async _waitForTarget(options = {}) {
    const { templateRadius = 0 } = options;
    const actorToken = this._getSourceToken();
    if (!actorToken) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoActorTokenOnCanvas"));
        return null;
    }

    const body = document.body;
    const originalCursor = body.style.cursor;
    body.style.cursor = "crosshair";

    const snapPos = (x, y) => {
        try {
            if (canvas.grid?.getSnappedPoint)
                return canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
            return { x, y };
        } catch (e) { return { x, y }; }
    };

    let previewObj = null;
    let previewDoc = null;

    if (templateRadius > 0 && canvas?.templates?.preview) {
        try {
            const tplData = {
                t: "circle", user: game.user.id, x: 0, y: 0,
                distance: templateRadius, fillColor: game.user.color ?? "#FF0000"
            };
            previewDoc = new CONFIG.MeasuredTemplate.documentClass(tplData, { parent: canvas.scene });
            previewObj = new CONFIG.MeasuredTemplate.objectClass(previewDoc);
            canvas.templates.preview.addChild(previewObj);
            await previewObj.draw();
            canvas.templates.activate();
        } catch (e) {
            console.warn("Neuroshima | Template preview (waitForTarget) failed:", e);
            previewObj = null;
        }
    }

    const destroyPreview = () => {
        if (previewObj) {
            try { canvas.templates.preview.removeChild(previewObj); previewObj.destroy({ children: true }); } catch (e) {}
            previewObj = null;
        }
        for (const t of Array.from(game.user.targets)) {
            t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
        }
    };

    game.neuroshima.log("_waitForTarget: Rozpoczynam przechwytywanie kliknięcia (window capture)");
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.Notifications.SelectTargetOrPoint"));

    return new Promise((resolve) => {
        let cleanupCalled = false;

        const cleanup = (clearPreview = true) => {
            if (cleanupCalled) return;
            cleanupCalled = true;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mousedown', onMouseDown, { capture: true });
            window.removeEventListener('contextmenu', onContextMenu, { capture: true });
            body.style.cursor = originalCursor;
            if (clearPreview) destroyPreview();
        };

        const onMouseMove = () => {
            if (!previewObj || !canvas?.mousePosition) return;
            const pos = snapPos(canvas.mousePosition.x, canvas.mousePosition.y);
            try { previewDoc.updateSource(pos); previewObj.refresh?.(); } catch (e) {}
            if (previewObj?.shape && canvas?.tokens?.placeables) {
                const gs = canvas.grid?.size ?? 100;
                const inIds = canvas.tokens.placeables
                    .filter(t => {
                        const td = t.document;
                        const cx = td.x + (td.width  * gs) / 2;
                        const cy = td.y + (td.height * gs) / 2;
                        return previewObj.shape.contains(cx - pos.x, cy - pos.y);
                    })
                    .map(t => t.id);
                const currentIds = new Set(Array.from(game.user.targets).map(t => t.id));
                for (const t of Array.from(game.user.targets)) {
                    if (!inIds.includes(t.id))
                        t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
                }
                for (const id of inIds) {
                    if (!currentIds.has(id)) {
                        const t = canvas.tokens.get(id);
                        if (t) t.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true });
                    }
                }
            }
        };

        const onMouseDown = async (event) => {
            if (event.button !== 0 && event.button !== 2) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            if (event.button === 2) {
                cleanup(true);
                game.neuroshima.log("_waitForTarget: Wybór anulowany przez użytkownika");
                resolve({ cancelled: true });
                return;
            }

            cleanup(false);

            const worldPos = { x: canvas.mousePosition.x, y: canvas.mousePosition.y };

            const clickedToken = canvas.tokens.placeables.find(t => {
                if (!t.visible) return false;
                const b = t.bounds;
                return worldPos.x >= b.x && worldPos.x <= (b.x + b.width) &&
                       worldPos.y >= b.y && worldPos.y <= (b.y + b.height);
            });

            destroyPreview();

            if (clickedToken) {
                clickedToken.setTarget(true, { releaseOthers: true });
                const distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, clickedToken);
                resolve({ distance, token: clickedToken });
            } else {
                const gridPos = canvas.grid.getCenterPoint
                    ? canvas.grid.getCenterPoint({ x: worldPos.x, y: worldPos.y })
                    : canvas.grid.getCenter(worldPos.x, worldPos.y);
                const distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, gridPos);
                resolve({ distance, point: gridPos });
            }
        };

        const onContextMenu = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };

        if (previewObj) window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mousedown', onMouseDown, { capture: true });
        window.addEventListener('contextmenu', onContextMenu, { capture: true });

        setTimeout(() => {
            if (!cleanupCalled) {
                cleanup(true);
                resolve(null);
            }
        }, 30000);
    });
  }

  /**
   * Handle creating a new Item.
   */
  async _onCreateItem(event, target) {
    // If target is an icon or nested element, find the closest button/action element
    const actionElement = target.closest("[data-action]") || target;
    const type = actionElement.dataset.type;
    let location = actionElement.dataset.location || actionElement.dataset.locationKey;
    
    // Fallback: check if there's a parent location header to get location from
    if (!location && type === "wound") {
      const headerElement = actionElement.closest(".location-wounds-header");
      if (headerElement) {
        location = headerElement.dataset.location;
      }
    }
    
    game.neuroshima?.log("_onCreateItem", { 
      type, 
      location, 
      targetTag: target.tagName,
      actionElementTag: actionElement.tagName,
      target: actionElement.outerHTML.substring(0, 150)
    });
    
    // Default name based on type
    let label = game.i18n.localize(`NEUROSHIMA.Items.Type.${type.charAt(0).toUpperCase() + type.slice(1)}`);
    
    // Special case for Wound creation from the plus button
    if (type === "wound") {
        label = game.i18n.localize("NEUROSHIMA.Items.Type.Wound");
    }

    const itemData = {
      name: label || type,
      type: type,
      system: {}
    };

    if (actionElement.dataset.weaponType) {
      itemData.system.weaponType = actionElement.dataset.weaponType;
    }

    if (actionElement.dataset.diseaseType && type === "disease") {
      itemData.system.diseaseType = actionElement.dataset.diseaseType;
    }

    // Pre-fill location if creating wound from extended section
    if (location && type === "wound") {
      this._saveWoundsScroll();
      itemData.system.location = location;
      game.neuroshima?.log("_onCreateItem setting wound location", { location, itemData });
    }

    // Create the item - _onUpdate hook will handle selective rendering
    return this.document.createEmbeddedDocuments("Item", [itemData]);
  }

  /**
   * Handle configuring max HP for the actor.
   */
  async _onConfigureHP(event, target) {
    const actor = this.document;
    
    // Retrieve base multipliers or default to 1 crit (27 pts)
    const hpConfig = actor.getFlag("neuroshima", "hpConfig") || {
        critical: Math.floor((actor.system.hp?.max || 27) / 27) || 1,
        heavy: 0,
        light: 0,
        scratch: 0
    };

    const content = await renderTemplate("systems/neuroshima/templates/dialog/hp-config.hbs", hpConfig);

    const result = await foundry.applications.api.DialogV2.wait({
      window: { 
        title: game.i18n.localize("NEUROSHIMA.Dialog.MaxHP.Title"),
        position: { width: 320, height: "auto" }
      },
      content: content,
      buttons: [
        {
          action: "save",
          label: game.i18n.localize("NEUROSHIMA.Actions.Save"),
          default: true,
          callback: (event, button, dialog) => {
              const formData = new foundry.applications.ux.FormDataExtended(button.form).object;
              return {
                  critical: parseInt(formData.critical) || 0,
                  heavy: parseInt(formData.heavy) || 0,
                  light: parseInt(formData.light) || 0,
                  scratch: parseInt(formData.scratch) || 0
              };
          }
        },
        {
            action: "cancel",
            label: game.i18n.localize("NEUROSHIMA.Actions.Cancel")
        }
      ],
      classes: ["neuroshima", "dialog", "hp-config"]
    });

    if (result && typeof result === "object") {
      const maxHP = (result.critical * 27) + (result.heavy * 9) + (result.light * 3) + (result.scratch * 1);
      await actor.setFlag("neuroshima", "hpConfig", result);
      await actor.update({ "system.hp.max": Math.max(1, maxHP) });
    }
  }

  /**
   * Handle editing an owned Item.
   */
  async _onEditItem(event, target) {
    const li = target.closest("[data-item-id]");
    const item = this.document.items.get(li.dataset.itemId);
    return item.sheet.render(true);
  }

  /**
   * Handle deleting an owned Item.
   */
  async _onDeleteItem(event, target) {
    const li = target.closest("[data-item-id]");
    const item = this.document.items.get(li.dataset.itemId);
    if (!item) return;
    
    // Save scroll position for wounds list before deletion re-render
    if (item.type === "wound") {
      this._saveWoundsScroll();
    }

    if (["origin", "profession"].includes(item.type)) {
      const linkedTraitCopies = this.document.items.filter(i =>
        i.type === "trait" && i.getFlag?.("neuroshima", "traitSource")?.itemId === item.id
      );
      for (const t of linkedTraitCopies) await t.delete();
    }

    return item.delete();
  }

  /**
   * Handle toggling the equipped state of an owned Item.
   */
  async _onToggleEquipped(event, target) {
    const li = target.closest(".item");
    const item = this.document.items.get(li.dataset.itemId);
    if (!item || !("equipped" in item.system)) return;
    const newEquipped = !item.system.equipped;
    await item.update({ "system.equipped": newEquipped });
  }

  async _onToggleJammed(event, target) {
    const unjamMinRole = game.settings.get("neuroshima", "unjamMinRole") ?? 4;
    if (!game.user.isGM && game.user.role < unjamMinRole) return;
    const li = target.closest(".item");
    const item = this.document.items.get(li.dataset.itemId);
    if (!item || !("jammed" in item.system)) return;
    if (!item.system.jammed) return;
    await item.update({ "system.jammed": false });
    if (this.document.type === "character") {
      await CONFIG.ChatMessage.documentClass.renderUnjam(this.document, item);
    }
  }

  async _onConsolidateMoney(event, target) {
    const actor = this.document;
    const moneyItems = actor.items.filter(i => i.type === "money").sort((a, b) => b.system.coinValue - a.system.coinValue);
    if (!moneyItems.length) return;
    const totalBaseUnits = moneyItems.reduce((sum, i) => sum + (i.system.quantity * i.system.coinValue), 0);
    let remaining = totalBaseUnits;
    const updates = [];
    for (const item of moneyItems) {
        const count = Math.floor(remaining / item.system.coinValue);
        remaining -= count * item.system.coinValue;
        updates.push({ _id: item.id, "system.quantity": count });
    }
    await actor.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * Handle changing the quantity of an owned Item.
   */
  async _onAdjustFame(event, target) {
    event.preventDefault();
    const direction = event.button === 2 ? -1 : 1;
    const current = this.document.system.fame ?? 0;
    const newValue = Math.max(-40, Math.min(40, current + direction));
    return this.document.update({ "system.fame": newValue });
  }

  async _onRollReputation(event, target) {
    event.preventDefault();
    const { ReputationRollDialog } = await import("../apps/reputation-roll-dialog.js");
    const dialog = new ReputationRollDialog({ actor: this.document });
    dialog.render(true);
  }

  async _onRollReputationItem(event, target) {
    event.preventDefault();
    const li = target.closest(".item");
    const itemId = li?.dataset.itemId ?? target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if (!item || item.type !== "reputation") return;
    const { ReputationRollDialog } = await import("../apps/reputation-roll-dialog.js");
    const dialog = new ReputationRollDialog({ actor: this.document, reputationItem: item });
    dialog.render(true);
  }

  async _onAdjustRepValue(event, target) {
    event.preventDefault();
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if (!item || item.type !== "reputation") return;

    const direction = event.button === 2 ? -1 : 1;

    let amount = 1;
    if ((event.shiftKey) && (event.ctrlKey || event.metaKey)) amount = 100;
    else if (event.ctrlKey || event.metaKey) amount = 10;
    else if (event.shiftKey) amount = 5;

    const repMin = game.settings.get("neuroshima", "reputationMin") ?? -20;
    const repMax = game.settings.get("neuroshima", "reputationMax") ?? 20;
    const current = item.system.value ?? 0;
    const newValue = Math.max(repMin, Math.min(repMax, current + direction * amount));
    return item.update({ "system.value": newValue });
  }

  async _onSortReputationItems(event, target) {
    event.preventDefault();
    this._repSortAsc = !(this._repSortAsc ?? false);
    const repItems = this.document.items.filter(i => i.type === "reputation");
    const reputationBonus = this.document.system?.reputationBonus ?? 0;
    const asc = this._repSortAsc;
    const sorted = [...repItems].sort((a, b) => {
      const av = (a.system?.value ?? 0) + reputationBonus;
      const bv = (b.system?.value ?? 0) + reputationBonus;
      return asc ? av - bv : bv - av;
    });
    const updates = sorted.map((item, idx) => ({ _id: item.id, sort: (idx + 1) * CONST.SORT_INTEGER_DENSITY }));
    return this.document.updateEmbeddedDocuments("Item", updates);
  }

  _initRepGripDrag(html) {
    const container = html.querySelector(".rep-items-section .inventory-items");
    if (!container) return;

    let dragSrc = null;

    const getWrap = (el) => el?.closest?.(".item-wrap[data-item-id]");

    container.querySelectorAll(".rep-grip-handle").forEach(handle => {
      const wrap = getWrap(handle);
      if (!wrap) return;

      handle.addEventListener("mousedown", () => {
        wrap.setAttribute("draggable", "false");
      });

      handle.addEventListener("dragstart", (ev) => {
        ev.stopPropagation();
        dragSrc = wrap;
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", wrap.dataset.itemId);
        setTimeout(() => wrap.classList.add("rep-dragging"), 0);
      });

      handle.addEventListener("dragend", () => {
        wrap.setAttribute("draggable", "true");
        wrap.classList.remove("rep-dragging");
        container.querySelectorAll(".rep-drop-target").forEach(el => el.classList.remove("rep-drop-target"));
        dragSrc = null;
      });

      wrap.addEventListener("dragover", (ev) => {
        if (!dragSrc || dragSrc === wrap) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        container.querySelectorAll(".rep-drop-target").forEach(el => el.classList.remove("rep-drop-target"));
        wrap.classList.add("rep-drop-target");
      });

      wrap.addEventListener("drop", async (ev) => {
        if (!dragSrc || dragSrc === wrap) return;
        ev.preventDefault();
        ev.stopPropagation();

        wrap.classList.remove("rep-drop-target");

        const srcId = dragSrc.dataset.itemId;
        const tgtId = wrap.dataset.itemId;
        if (!srcId || !tgtId) return;

        const allWraps = [...container.querySelectorAll(".item-wrap[data-item-id]")];
        const srcIdx = allWraps.indexOf(dragSrc);
        const tgtIdx = allWraps.indexOf(wrap);

        const repItems = this.document.items.filter(i => i.type === "reputation");
        const orderedIds = allWraps.map(w => w.dataset.itemId).filter(id => repItems.some(i => i.id === id));

        const reordered = [...orderedIds];
        const [removed] = reordered.splice(srcIdx, 1);
        reordered.splice(tgtIdx, 0, removed);

        const updates = reordered.map((id, idx) => ({ _id: id, sort: (idx + 1) * CONST.SORT_INTEGER_DENSITY }));
        await this.document.updateEmbeddedDocuments("Item", updates);
      });
    });
  }

  async _onAdjustQuantity(event, target) {
    const direction = event.button === 2 ? -1 : 1;
    return this._onQuantityChange(event, target, direction);
  }

  async _onQuantityChange(event, target, direction) {
    const li = target.closest(".item");
    const item = this.document.items.get(li.dataset.itemId);
    if (!item || !("quantity" in item.system)) return;

    let amount = 1;
    if ((event.shiftKey) && (event.ctrlKey || event.metaKey)) amount = 1000;
    else if (event.ctrlKey || event.metaKey) amount = 100;
    else if (event.shiftKey) amount = 10;

    const newQuantity = Math.max(0, item.system.quantity + (amount * direction));
    return item.update({ "system.quantity": newQuantity });
  }

  /**
   * Organize skills into a structure easy to render in the template.
   */
  _prepareSkillGroups() {
    const groups = {};
    const skillConfig = NEUROSHIMA.skillConfiguration;
    const system = this.document.system;
    const actor = this.document;

    const skillTooltips = {};
    const addSkillChanges = (effect) => {
      if (effect.disabled || effect.isSuppressed) return;
      for (const change of (effect.changes ?? [])) {
        const mBonus = change.key?.match(/^system\.skillBonuses\.(\w+)$/);
        const mValue = change.key?.match(/^system\.skills\.(\w+)\.value$/);
        const m = mBonus ?? mValue;
        if (!m) continue;
        const sKey = m[1];
        const val = Number(change.value) || 0;
        if (!val) continue;
        const part = `${effect.name ?? "?"}: ${val >= 0 ? "+" : ""}${val}`;
        skillTooltips[sKey] = skillTooltips[sKey] ? skillTooltips[sKey] + "<br>" + part : part;
      }
    };
    const _itemUUIDs = new Set((actor.items ?? []).map(i => i.uuid));
    for (const effect of (actor.effects ?? [])) {
      const origin = effect.origin ?? "";
      if ([..._itemUUIDs].some(uuid => origin.startsWith(uuid))) continue;
      addSkillChanges(effect);
    }
    for (const item of (actor.items ?? [])) {
      for (const effect of item.effects) {
        addSkillChanges(effect);
      }
    }

    for (const [attrKey, specializations] of Object.entries(skillConfig)) {
      const attrConfig = NEUROSHIMA.attributes[attrKey];
      groups[attrKey] = {
        label: attrConfig.label,
        abbr: attrConfig.abbr,
        specializations: {}
      };

      for (const [specKey, skills] of Object.entries(specializations)) {
        groups[attrKey].specializations[specKey] = {
          label: `NEUROSHIMA.Specializations.${specKey}`,
          owned: system.specializations[specKey],
          skills: skills.map(skillKey => ({
            key: skillKey,
            label: `NEUROSHIMA.Skills.${skillKey}`,
            value: system.skills[skillKey].value,
            total: system.skillTotals?.[skillKey] ?? system.skills[skillKey].value,
            bonus: system.skillBonuses?.[skillKey] ?? 0,
            bonusTooltip: skillTooltips[skillKey] ?? "",
            customLabel: system.skills[skillKey].label,
            isKnowledge: skillKey.startsWith("knowledge")
          }))
        };
      }
    }
    return groups;
  }

  /**
   * Publiczna metoda rzutu na inicjatywę, wywoływana np. z trackera.
   */
  async rollInitiative(options = {}) {
    if (options.isMelee) {
        return this._onRespondToOpposed(null, { dataset: { pendingId: options.pendingId } });
    }
    // Domyślny rzut na inicjatywę (nie-melee)
    return this._onRollMeleeInitiative(new Event("click"));
  }

  /**
   * Rzut na inicjatywę melee z poziomu arkusza.
   */
  async _onRollMeleeInitiative(event) {
    event.preventDefault();
    const actor = this.document;

    const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
    
    const dialog = new NeuroshimaInitiativeRollDialog({
        actor: actor,
        skill: "", // Gracz wybierze sam
        isMeleeInitiative: true,
        onRoll: async (rollData) => {
            const rollResult = await game.neuroshima.NeuroshimaDice.rollInitiative({
                ...rollData,
                actor: actor,
                chatMessage: true // Ten rzut chcemy widzieć na czacie
            });
            
            // Zapisz wynik w systemie aktora
            game.neuroshima.log("Aktualizacja inicjatywy melee:", {
                successPoints: rollResult.successPoints,
                actor: actor.name,
                path: "system.combat.meleeInitiative"
            });
            await actor.update({ "system.combat.meleeInitiative": rollResult.successPoints });
            
            // Wymuś odświeżenie UI jeśli rzut był bez DSN (dla pewności)
            if (!game.dice3d) this.render(false);
            
            return rollResult;
        }
    });
    dialog.render(true);
  }

  /**
   * Reakcja obrońcy na starcie - rzut na inicjatywę i start pojedynku.
   */
  async _onRespondToOpposed(event, target) {
      if (this._isRolling) return;
      
      const activeEncounterId = this.document.getFlag("neuroshima", "activeMeleeEncounter");
      if (activeEncounterId) {
          const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
          return NeuroshimaMeleeCombat.openMeleeApp(activeEncounterId);
      }

      const pendingId = target.dataset.pendingId;

      // ── Opposed-chat mode: check actor flag first, then combat pending ────
      const opposeFlag = this.document.getFlag("neuroshima", "oppose");
      if (opposeFlag?.messageId) {
          const pendingMsg = game.messages.get(opposeFlag.messageId);
          const opposeData = pendingMsg?.getFlag("neuroshima", "opposedChat");
          if (opposeData?.status === "pending") {
              const syntheticPending = {
                  id: opposeData.defenderUuid,
                  attackerId: opposeData.attackerUuid,
                  attackerTokenUuid: opposeData.attackerTokenUuid,
                  defenderId: opposeData.defenderUuid,
                  mode: opposeData.mode,
                  opposedChatMessageId: opposeFlag.messageId
              };
              const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
              await MeleeOpposedChat.openDefenseDialog(this.document, syntheticPending);
              return;
          }
          await this.document.unsetFlag("neuroshima", "oppose");
      }
      // Fallback: combat pending with mode
      const combat = game.combat;
      const pendings = combat?.getFlag("neuroshima", "meleePendings") || {};
      const pending = Object.values(pendings).find(p => (p.id === pendingId || p.defenderId === pendingId) && p.mode);
      if (pending) {
          const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
          await MeleeOpposedChat.openDefenseDialog(this.document, pending);
          return;
      }
      // ── End opposed-chat branch ──────────────────────────────────────────

      this._isRolling = true;
      const { NeuroshimaInitiativeRollDialog } = await import("../apps/initiative-roll-dialog.js");
      const dialog = new NeuroshimaInitiativeRollDialog({
          actor: this.document,
          isMelee: true,
          meleeMode: "respond",
          pendingId,
          onRoll: async (rollData) => {
              const result = await game.neuroshima.NeuroshimaDice.rollInitiative({
                  ...rollData,
                  actor: this.document,
                  isMeleeInitiative: true
              });
              
              const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
              await NeuroshimaMeleeCombat.respondToMeleePending(pendingId, result.successPoints);
              
              this._isRolling = false;
              return result;
          },
          onClose: () => { this._isRolling = false; }
      });
      await dialog.render(true);
  }

  /**
   * Anuluje oczekujące starcie.
   */
  async _onDismissOpposed(event, target) {
      if (event) event.stopPropagation();
      const pendingId = target.dataset.pendingId;

      let messageId = null;
      const combat = game.combat;
      if (combat) {
        const pendingKey = pendingId.replace(/\./g, "-");
        const pendings = combat.getFlag("neuroshima", "meleePendings") || {};
        messageId = pendings[pendingKey]?.opposedChatMessageId;
      }
      if (!messageId) {
        const defDoc = fromUuidSync(pendingId);
        const defActor = defDoc?.actor ?? defDoc;
        messageId = defActor?.getFlag("neuroshima", "oppose")?.messageId;
      }

      if (messageId) {
        const msg = game.messages.get(messageId);
        const chatData = msg?.getFlag("neuroshima", "opposedChat");
        if (chatData?.status === "pending") {
          await msg.setFlag("neuroshima", "opposedChat", { ...chatData, status: "cancelled" });
        }
      }

      const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
      await NeuroshimaMeleeCombat.dismissMeleePending(pendingId);

      const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
      await MeleeOpposedChat._unsetDefenderFlag(pendingId);
  }

  /**
   * Pokaż kartę pacjenta na czacie.
   */
  async _onShowPatientCard(event) {
    event.preventDefault();
    game.neuroshima.log("Wyświetlanie karty pacjenta dla:", this.actor.name);
    
    await game.neuroshima.NeuroshimaChatMessage.renderPatientCard(this.actor);
  }

  /**
   * Poproś medyka o leczenie - zachowanie zależy od ustawienia patientCardVersion
   * - "simple": pokaż zwykłą kartę pacjenta
   * - "extended": pokaż dialog wyboru medyka i wyślij prośbę o leczenie
   */
  /**
   * Prośba o leczenie dla medyka.
   */
  async _onRequestHealing(event) {
    event.preventDefault();
    game.neuroshima.log("Prosimy o leczenie dla:", this.actor.name);

    // Sprawdź wersję karty pacjenta
    const patientCardVersion = game.settings.get("neuroshima", "patientCardVersion");
    
    // Wersja uproszczona - pokaż kartę pacjenta bez prośby
    if (patientCardVersion === "simple") {
      game.neuroshima.log("Wyświetlanie uproszczonej karty pacjenta (bez prośby do medyka)");
      await game.neuroshima.NeuroshimaChatMessage.renderPatientCard(this.actor);
      ui.notifications.info(game.i18n.localize("NEUROSHIMA.PatientCard.ShowPatientCard"));
      return;
    }

    // Wersja rozszerzona - pokaż dialog i wyślij prośbę
    game.neuroshima.log("Wersja rozszerzona: wyświetlanie dialoga wyboru medyka");

    // Pobierz listę potencjalnych medyków (tylko PC aktywnych graczy)
    const possibleMedics = game.users
        .filter(u => u.active && !u.isGM && u.character)
        .filter(u => u.character.id !== this.actor.id);

    if (possibleMedics.length === 0) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.HealingRequest.NoMedicsAvailable"));
      return;
    }

    const medicChoices = {};
    for (const user of possibleMedics) {
      medicChoices[user.id] = `${user.character.name} (${user.name})`;
    }

    const content = `
      <div class="neuroshima medic-selection-dialog">
        <div class="form-group">
          <p style="margin-bottom: 10px;">${game.i18n.localize("NEUROSHIMA.HealingRequest.RequestHealingHint")}</p>
          <label for="medic-select">${game.i18n.localize("NEUROSHIMA.HealingRequest.ChooseMedic")}:</label>
          <select id="medic-select">
            ${Object.entries(medicChoices).map(([userId, label]) => 
              `<option value="${userId}">${label}</option>`
            ).join("")}
          </select>
        </div>
      </div>
    `;

    const selectedUserId = await foundry.applications.api.DialogV2.wait({
      window: {
        title: game.i18n.localize("NEUROSHIMA.HealingRequest.SelectMedic"),
        classes: ["neuroshima", "medic-selection"]
      },
      content: content,
      buttons: [
        {
          action: "confirm",
          label: game.i18n.localize("NEUROSHIMA.HealingRequest.SendRequest"),
          default: true,
          icon: "fas fa-check",
          callback: (event, button) => {
            const select = button.form.querySelector("#medic-select");
            return select.value;
          }
        },
        {
          action: "cancel",
          label: game.i18n.localize("NEUROSHIMA.Dialog.Cancel"),
          icon: "fas fa-times",
          callback: () => null
        }
      ]
    });

    if (!selectedUserId) return;

    const medicUser = game.users.get(selectedUserId);
    const medicActor = medicUser?.character;
    if (!medicActor) {
      ui.notifications.error(game.i18n.localize("NEUROSHIMA.HealingRequest.MedicNotFound"));
      return;
    }

    try {
      game.neuroshima.log("Wysyłanie prośby o leczenie", {
        pacjent: this.actor.name,
        medyk: medicActor.name
      });

      // Renderuj kartę prośby o leczenie
      await game.neuroshima.NeuroshimaChatMessage.renderHealingRequest(
        this.actor,
        medicActor,
        game.user.id
      );

      ui.notifications.info(game.i18n.format("NEUROSHIMA.HealingRequest.RequestSent", {
        medic: medicActor.name
      }));
    } catch (err) {
      game.neuroshima.log("Błąd podczas wysyłania prośby:", err);
      ui.notifications.error(game.i18n.localize("NEUROSHIMA.HealingRequest.HealingFailed"));
    }
  }

  /**
   * Toggle the layout of the combat tab (top-row vs wounds-section order).
   */
  async _onToggleCombatLayout(event, target) {
    event.preventDefault();
    const actor = this.document;
    const current = actor.getFlag("neuroshima", "woundsFirst") || false;
    await actor.setFlag("neuroshima", "woundsFirst", !current);
    await this.render();
  }

  /**
   * Handle paper doll location selection in extended healing panel
   */
  _onPaperDollLocationSelect(event, hotspot) {
    const locationKey = hotspot.dataset.location;
    
    game.neuroshima?.log("_onPaperDollLocationSelect visually marking hotspot", { locationKey });
    
    // Remove selected class from all hotspots in the diagram
    this.element.querySelectorAll('.body-location-hotspot').forEach(hs => {
      hs.classList.remove('selected');
    });
    
    // Add selected class to the current hotspot
    hotspot.classList.add('selected');
    
    game.neuroshima?.log("Paper doll location selected visually", { location: locationKey });
  }

  /**
   * Handle the rest action.
   * @private
   */
  async _onRest(event, target) {
    const actor = this.document;
    const restData = await RestDialog.wait();
    
    // Check if restData is valid and has expected properties
    if (restData && typeof restData === 'object' && restData.days !== undefined) {
      await CombatHelper.rest(actor, restData);
    }
  }

  async _onCreateEffect(event, target) {
    const effectData = {
      name: game.i18n.localize("NEUROSHIMA.Effects.NewEffect"),
      icon: "icons/svg/aura.svg",
      origin: this.document.uuid
    };
    const [effect] = await this.document.createEmbeddedDocuments("ActiveEffect", [effectData]);
    effect?.sheet.render(true);
  }

  _resolveEffect(target) {
    const row = target.closest(".effect-row");
    const id = row?.dataset.effectId;
    const itemId = row?.dataset.itemId;
    if (itemId) {
      const fromItem = this.document.items.get(itemId)?.effects.get(id) ?? null;
      if (fromItem) return fromItem;
      return this.document.effects.get(id) ?? null;
    }
    return this.document.effects.get(id) ?? null;
  }

  _resolveEffectForEdit(target) {
    const row = target.closest(".effect-row");
    const id = row?.dataset.effectId;
    const itemId = row?.dataset.itemId;
    if (itemId) {
      const actorEffect = this.document.effects.get(id);
      if (actorEffect?.getFlag("neuroshima", "fromEquipTransfer")) {
        const sourceId = actorEffect.getFlag("neuroshima", "sourceEffectId");
        const item = this.document.items.get(itemId);
        if (item) {
          if (sourceId) {
            const src = item.effects.get(sourceId);
            if (src) return src;
          }
          const byId = item.effects.get(id);
          if (byId) return byId;
        }
        return actorEffect;
      }
      const fromItem = this.document.items.get(itemId)?.effects.get(id) ?? null;
      if (fromItem) return fromItem;
      return actorEffect ?? this.document.effects.get(id) ?? null;
    }
    return this.document.effects.get(id) ?? null;
  }

  async _onEditEffect(event, target) {
    this._resolveEffectForEdit(target)?.sheet.render(true);
  }

  async _onDeleteEffect(event, target) {
    const row = target.closest("[data-effect-id]");
    if (row?.dataset.itemId) return;
    await this._resolveEffect(target)?.delete();
  }

  async _onToggleEffect(event, target) {
    const effect = this._resolveEffect(target);
    if (!effect) return;
    if (effect.getFlag("neuroshima", "enableScript")) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Effects.ScriptControlledWarn"));
      return;
    }
    await effect.update({ disabled: !effect.disabled });
  }

  async _onOpenSource(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    item?.sheet.render(true);
  }

  async _onToggleCondition(event, target) {
    const key = target.dataset.conditionKey;
    const type = target.dataset.conditionType;
    if (!key) return;
    const actor = this.document;

    if (type === "boolean") {
      await actor.toggleStatusEffect(key);
    } else {
      if (event.button === 2 || event.type === "contextmenu") {
        await actor.removeCondition(key);
      } else {
        await actor.addCondition(key);
      }
    }
  }

  async _onAdjustConditionValue(event, target) {
    const key = target.dataset.conditionKey;
    const allowNegative = target.dataset.allowNegative === "true";
    if (!key) return;
    const actor = this.document;
    let val = parseInt(target.dataset.value ?? target.textContent, 10);
    if (isNaN(val)) val = 0;
    if (!allowNegative) val = Math.max(0, val);

    const existing = actor.effects.find(
      e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
    );
    if (val === 0 && !allowNegative) {
      if (existing) await existing.delete();
      return;
    }
    if (existing) {
      await existing.setFlag("neuroshima", "conditionValue", val);
    } else if (val !== 0) {
      const condDef = getConditions().find(c => c.key === key);
      game.neuroshima?.log(`[_onAdjustConditionValue] creating AE for "${key}" scripts:`, condDef?.scripts);
      if (!condDef) return;
      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name:        condDef.name,
        img:         condDef.img          ?? "icons/svg/aura.svg",
        tint:        condDef._tint        ?? null,
        description: condDef._description ?? "",
        disabled:    condDef._disabled    ?? false,
        statuses:    [key],
        changes:     foundry.utils.deepClone(condDef.changes   ?? []),
        duration:    foundry.utils.deepClone(condDef._duration ?? {}),
        flags: {
          neuroshima: {
            conditionNumbered: true,
            conditionValue:    val,
            scripts:           foundry.utils.deepClone(condDef.scripts      ?? []),
            transferType:      condDef._transferType  ?? "owningDocument",
            documentType:      condDef._documentType  ?? "actor",
            equipTransfer:     condDef._equipTransfer ?? false
          }
        }
      }]);
    }
  }

  _prepareItemManualScripts(actor) {
    const map = {};
    for (const item of (actor.items ?? [])) {
      const scripts = [];
      for (const eff of (item.effects ?? [])) {
        if (eff.disabled) continue;
        const docType = eff.getFlag?.("neuroshima", "documentType") ?? "actor";
        const flags = eff.getFlag?.("neuroshima", "scripts") ?? [];
        flags.forEach((s, idx) => {
          if (s.trigger === "manual") {
            const rawLabel = s.label || eff.name;
            const label = NeuroshimaScriptRunner._resolveItemRef(rawLabel, item, eff);
            scripts.push({
              itemId: item.id,
              effectId: eff.id,
              effectName: eff.name,
              scriptIndex: idx,
              label,
              isItemOnly: docType === "item"
            });
          }
        });
      }
      if (scripts.length) map[item.id] = scripts;
    }
    return map;
  }

  async _onInvokeItemScript(event, target) {
    const { itemId, effectId, scriptIndex } = target.dataset;
    const item = this.document.items.get(itemId);
    if (!item) return ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Scripts.NoActor"));
    const effect = item.effects.get(effectId);
    if (!effect) return;

    const actor = this.document;

    const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
    await NeuroshimaScriptRunner.executeManual(actor, effect, Number(scriptIndex));
  }

  async _onRevertXpEntry(event, target) {
    if (!game.user.isGM) return;
    const entryId = target.dataset.entryId;
    if (!entryId) return;
    const { revertXpEntry } = await import("../helpers/xp.js");
    await revertXpEntry(this.document, entryId);
  }

  _onToggleSummary(event, target) {
    const wrap = target.closest(".item-wrap");
    const summary = wrap?.querySelector(".item-summary");
    if (!summary) return;
    summary.classList.toggle("collapsed");
    const chevron = wrap.querySelector(".item-summary-toggle i");
    if (chevron) chevron.classList.toggle("fa-chevron-down");
  }

  _onItemContextMenu(event, target) {
    const wrap = target.closest(".item-wrap");
    if (!wrap?.dataset.itemId) return;
    this._showItemContextMenu(event, wrap.dataset.itemId);
  }

  _showItemContextMenu(event, itemId) {
    event.preventDefault();
    const item = this.document.items.get(itemId);
    if (!item) return;

    document.querySelectorAll('.ns-item-ctx-menu').forEach(el => el.remove());

    const isMagazine = item.type === 'magazine';
    const menuItems = [
      { action: 'edit',      icon: 'fas fa-edit',    label: game.i18n.localize('Edit') },
      { action: 'post',      icon: 'fas fa-comment',  label: game.i18n.localize('NEUROSHIMA.ContextMenu.PostToChat') },
      { action: 'duplicate', icon: 'fas fa-copy',     label: game.i18n.localize('NEUROSHIMA.ContextMenu.Duplicate') },
    ];
    if (isMagazine) {
      menuItems.push({ action: 'unload', icon: 'fas fa-eject', label: game.i18n.localize('NEUROSHIMA.Actions.Unload') });
    }
    menuItems.push({ action: 'delete', icon: 'fas fa-trash', label: game.i18n.localize('Delete') });

    const menu = document.createElement('nav');
    menu.className = 'ns-item-ctx-menu context-menu themed theme-dark';
    menu.style.cssText = 'position:fixed;z-index:99999;';
    menu.innerHTML = `<menu class="context-items">${
      menuItems.map(m => `<li class="context-item" data-action="${m.action}"><i class="${m.icon} fa-fw"></i><span>${m.label}</span></li>`).join('')
    }</menu>`;
    document.body.appendChild(menu);

    const x = event.clientX;
    const y = event.clientY;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
      if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
    });

    menu.querySelectorAll('.context-item').forEach(li => {
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = li.dataset.action;
        if (action === 'edit')      item.sheet.render(true);
        else if (action === 'post')      this._postItemToChat(itemId);
        else if (action === 'duplicate') item.clone({}, { save: true, parent: this.document });
        else if (action === 'unload')    this._onUnloadMagazine(e, itemId);
        else if (action === 'delete')    item.deleteDialog();
        menu.remove();
      });
    });

    const sheetEl = this.element;
    const cleanup = () => {
      menu.remove();
      document.removeEventListener('click', onDocClick, { capture: true });
      document.removeEventListener('contextmenu', onDocContext, { capture: true });
      document.removeEventListener('keydown', onEscape);
    };
    const onDocClick = (e) => {
      if (menu.contains(e.target)) return;
      if (sheetEl && sheetEl.contains(e.target)) return;
      cleanup();
    };
    const onDocContext = (e) => {
      if (menu.contains(e.target)) return;
      if (sheetEl && sheetEl.contains(e.target)) return;
      cleanup();
    };
    const onEscape = (e) => {
      if (e.key === 'Escape') cleanup();
    };
    setTimeout(() => {
      document.addEventListener('click', onDocClick, { capture: true });
      document.addEventListener('contextmenu', onDocContext, { capture: true });
      document.addEventListener('keydown', onEscape);
    }, 0);
  }

  async _postItemToChat(itemId) {
    const item = this.document.items.get(itemId);
    if (!item) return;
    const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
    await NeuroshimaChatMessage.postItemToChat(item, { actor: this.document });
  }

  async _showItemCardLimitDialog() {
    const content = `
      <div class="neuroshima item-card-limit-dialog">
        <h4 class="item-card-limit-heading">${game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Label")}</h4>
        <div class="form-group">
          <div class="form-fields">
            <input type="number" name="limit" min="1" placeholder="∞" autofocus style="width:100%">
          </div>
        </div>
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Title") },
      content,
      buttons: [
        {
          action: "confirm",
          label: game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Confirm"),
          icon: "fas fa-check",
          default: true,
          callback: (event, button) => {
            const val = button.form.elements.limit.value.trim();
            return val ? parseInt(val) : null;
          }
        },
        {
          action: "cancel",
          label: game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Cancel"),
          icon: "fas fa-times",
          callback: () => "cancel"
        }
      ],
      classes: ["neuroshima"],
      rejectClose: false
    });

    return result;
  }

  _buildItemChatStats(item) {
    const loc = (key) => game.i18n.localize(key);
    const s = item.system;
    const stats = [];
    let armorRatings = null;
    let armorBoxStats = null;
    let magazineContents = null;
    let weight = null;
    let availability = null;
    let hasWeight = false;

    const dash = "—";

    const attrLabel = (key) => {
      const cfg = NEUROSHIMA?.attributes?.[key];
      return cfg ? loc(cfg.label) : (key || dash);
    };
    const skillLabel = (key) => {
      const k = `NEUROSHIMA.Skills.${key}`;
      const t = loc(k);
      return t !== k ? t : (key || dash);
    };

    if (s.weight !== undefined) {
      hasWeight = true;
      weight = s.weight ?? 0;
      availability = s.availability ?? null;
    }

    switch (item.type) {
      case "weapon": {
        const wType = s.weaponType ?? "melee";
        const wTypeLabel = loc(`NEUROSHIMA.Items.Fields.${wType.charAt(0).toUpperCase() + wType.slice(1)}`);
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.WeaponSubtype"), value: wTypeLabel || wType });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Attribute"), value: attrLabel(s.attribute) });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Skill"), value: skillLabel(s.skill) });
        if (wType === "melee") {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: `${s.damageMelee1 || dash} / ${s.damageMelee2 || dash} / ${s.damageMelee3 || dash}` });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
        } else {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Caliber"), value: s.caliber || dash });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: s.damage || dash });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.FireRateAbbr"), value: s.fireRate ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Capacity"), value: s.capacity ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.JammingAbbr"), value: s.jamming ?? 20 });
        }
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.RequiredBuild"), value: s.requiredBuild ?? 0 });
        if (s.attackBonus !== 0) stats.push({ label: loc("NEUROSHIMA.Items.Fields.AttackBonusAbbr"), value: (s.attackBonus > 0 ? "+" : "") + s.attackBonus });
        if (s.defenseBonus !== 0) stats.push({ label: loc("NEUROSHIMA.Items.Fields.DefenseBonusAbbr"), value: (s.defenseBonus > 0 ? "+" : "") + s.defenseBonus });
        break;
      }
      case "armor": {
        const locKeys = [
          { key: "head",     abbr: "HeadAbbr" },
          { key: "torso",    abbr: "TorsoAbbr" },
          { key: "leftArm",  abbr: "LeftArmAbbr" },
          { key: "rightArm", abbr: "RightArmAbbr" },
          { key: "leftLeg",  abbr: "LeftLegAbbr" },
          { key: "rightLeg", abbr: "RightLegAbbr" }
        ];
        armorRatings = locKeys.map(({ key, abbr }) => ({
          label: loc(`NEUROSHIMA.Items.Fields.${abbr}`),
          value: s.armor?.ratings?.[key] ?? 0
        }));
        const dur = (s.armor?.durability ?? 0) - (s.armor?.durabilityDamage ?? 0);
        armorBoxStats = [
          { label: loc("NEUROSHIMA.Items.Fields.DurabilityAbbr"), value: `${dur} / ${s.armor?.durability ?? 0}` },
          { label: loc("NEUROSHIMA.Items.Fields.RequiredBuild"), value: s.armor?.requiredBuild ?? 0 },
          { label: loc("NEUROSHIMA.Items.Fields.ArmorPenalty"), value: s.armor?.penalty ?? 0 }
        ];
        break;
      }
      case "gear": {
        if (s.cost > 0) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Cost"), value: s.cost });
        if (s.quantity !== undefined) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
      }
      case "ammo": {
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Caliber"), value: s.caliber || dash });
        if (s.isOverride) {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: s.damage || dash });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.JammingAbbr"), value: s.jamming ?? 20 });
        }
        if (s.isPellet) {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PelletCount"), value: s.pelletCount });
        }
        if (s.quantity !== undefined) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
      }
      case "magazine": {
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Caliber"), value: s.caliber || dash });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Capacity"), value: `${s.totalCount ?? 0} / ${s.capacity ?? 0}` });
        magazineContents = (s.contents || []).filter(c => c.quantity > 0).map(c => ({ name: c.name || dash, quantity: c.quantity }));
        break;
      }
      case "money": {
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.CoinValue"), value: s.coinValue });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
      }
      case "reputation": {
        stats.push({ label: loc("NEUROSHIMA.Reputation.Value"), value: s.value });
        break;
      }
      case "beastAction":
      case "beast-action": {
        if (s.actionType) stats.push({ label: loc("NEUROSHIMA.BeastAction.TypeLabel"), value: s.actionType });
        if (s.costType === "success") {
          stats.push({ label: loc("NEUROSHIMA.BeastAction.SuccessCost"), value: `${s.successCost} SP` });
        } else {
          stats.push({ label: loc("NEUROSHIMA.BeastAction.SegmentCost"), value: `${s.segmentCost} seg.` });
        }
        if (s.attribute) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Attribute"), value: attrLabel(s.attribute) });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: s.damage || dash });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
        break;
      }
      case "vehicleMod":
      case "vehicle-mod": {
        if (s.category) {
          const catKey = `NEUROSHIMA.VehicleMod.Categories.${s.category.charAt(0).toUpperCase() + s.category.slice(1)}`;
          stats.push({ label: loc("NEUROSHIMA.VehicleMod.Category"), value: loc(catKey) });
        }
        if (s.installDifficulty) {
          const diffCfg = NEUROSHIMA?.difficulties?.[s.installDifficulty];
          stats.push({ label: loc("NEUROSHIMA.VehicleMod.InstallDifficulty"), value: diffCfg ? loc(diffCfg.label) : s.installDifficulty });
        }
        break;
      }
      default:
        break;
    }

    return { stats, armorRatings, armorBoxStats, magazineContents, weight, availability, hasWeight };
  }

  async _onPostItemToChat(event, target) {
    const wrap = target.closest(".item-wrap");
    await this._postItemToChat(wrap?.dataset.itemId);
  }
}
