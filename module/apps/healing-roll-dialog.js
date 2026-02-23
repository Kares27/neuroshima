import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/dice.js";

/**
 * PHASE 3 - SETTINGS SYSTEM
 * Helper: Get healing difficulty based on wound damage type from world settings
 * Pobiera ustawioną na świecie trudność testu leczenia dla danego typu obrażenia
 */
function getHealingDifficulty(damageType) {
  const diffs = game.settings.get("neuroshima", "healingDifficulties");
  return diffs?.[damageType] ?? "average";
}

/**
 * PHASE 2 - CLOSED TEST LOGIC
 * Helper: Get healing reduction percent based on method and wound history
 * Zwraca procent redukcji kary na ranie w zależności od metody leczenia i historii rany
 * Pierwsza pomoc: 5%
 * Leczenie ran: 15% (świeża) lub 10% (już opatrzona)
 */
function getHealingPercent(healingMethod, hadFirstAid = false) {
  if (healingMethod === "firstAid") {
    return 5; // ±5% for First Aid
  } else {
    // Treat Wounds: 15% if not previously treated, 10% if had First Aid
    return hadFirstAid ? 10 : 15;
  }
}

/**
 * PHASE 1 - CORE HEALING DIALOG & LAYOUT REDESIGN
 * Dialog for healing rolls with per-wound difficulty selection and dynamic updates
 * Wykorzystuje Application V2 API i wyświetla rany pogrupowane po typie obrażenia
 * Każda grupa ran ma:
 * - Dropdown do wyboru trudności testu (osobny dla każdego typu)
 * - Modifier % do redukcji kary (zaaplikowany na wszystkie rany tego typu)
 * - Dynamiczne podsumowanie z uwzględnieniem modyfikatorów
 */
export async function showHealingRollDialog({
  medicActor,
  patientActor,
  wounds = [],
  lastRoll = {}
}) {
  game.neuroshima?.group("showHealingRollDialog");
  game.neuroshima?.log("Otwarcie dialoga leczenia", {
    medyk: medicActor?.name,
    pacjent: patientActor?.name,
    liczbaRan: wounds.length
  });

  const template = "systems/neuroshima/templates/dialog/healing-roll-dialog.hbs";

  // PHASE 1: Group wounds by damage type for compact display
  // Wyświetla wiele ran jako "4x L, 2x C" zamiast listy
  const woundGroupMap = {};
  const woundIds = {}; // Store all wound IDs for each damage type
  
  wounds.forEach(wound => {
    const damageType = wound.damageType;
    // PHASE 3: Get base difficulty from settings (D/L default to Average, C/K to Problematic)
    if (!woundGroupMap[damageType]) {
      woundGroupMap[damageType] = {
        damageType: damageType,
        count: 0,
        // difficulty: pobierana z ustawień świata (PHASE 3)
        difficulty: getHealingDifficulty(damageType),
        difficultyLabel: `NEUROSHIMA.Roll.${getHealingDifficulty(damageType) === 'average' ? 'Average' : 'Problematic'}`,
        // healingPercent: procent redukcji kary (PHASE 2)
        healingPercent: getHealingPercent(lastRoll.healingMethod || "firstAid", wound.hadFirstAid),
        woundList: []
      };
      woundIds[damageType] = [];
    }
    woundGroupMap[damageType].count++;
    woundGroupMap[damageType].woundList.push(wound);
    woundIds[damageType].push(wound.id);
  });

  // PHASE 1: Convert wound map to array for template
  const woundGroups = Object.values(woundGroupMap);

  const armorPenalty = medicActor.system.combat?.totalArmorPenalty || 0;
  const woundPenalty = medicActor.system.combat?.totalWoundPenalty || 0;

  let healingMethod = lastRoll.healingMethod || "firstAid";
  if (healingMethod === "treatWounds") {
    healingMethod = "woundTreatment";
  }

  const skillName = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
  const skillValue = medicActor.system.skills?.[skillName]?.value || 0;

  const data = {
    woundGroups: woundGroups,
    woundGroupCount: woundGroups.length,
    totalWounds: wounds.length,
    percentageModifier: lastRoll.percentageModifier || 0,
    healingMethod: healingMethod,
    currentAttribute: lastRoll.currentAttribute || "cleverness",
    attributeList: NEUROSHIMA.attributes,
    difficulties: NEUROSHIMA.difficulties,
    armorPenalty: armorPenalty,
    woundPenalty: woundPenalty,
    useArmorPenalty: lastRoll.useArmorPenalty ?? false,
    useWoundPenalty: lastRoll.useWoundPenalty ?? true,
    woundIds: woundIds,
    wounds: wounds,
    skillValue: skillValue,
    skillBonus: lastRoll.skillBonus || 0,
    attributeBonus: lastRoll.attributeBonus || 0
  };

  const content = await foundry.applications.handlebars.renderTemplate(template, data);

  const dialog = new foundry.applications.api.DialogV2({
    window: { 
      title: `${game.i18n.localize("NEUROSHIMA.HealingRequest.Title")} - ${patientActor.name}`,
      position: { width: 480, height: 600 }
    },
    content: content,
    classes: ["neuroshima", "roll-dialog-window"],
    buttons: [
      {
        action: "roll",
        label: game.i18n.localize("NEUROSHIMA.Actions.Roll"),
        default: true,
        callback: async (event, button, dialog) => {
          const form = button.form;
          const healingMethod = form.elements.healingMethod.value;
          const selectedAttr = form.elements.attribute.value;
          const globalModifier = parseInt(form.elements.globalModifier.value) || 0;
          
          const useArmor = form.elements.useArmorPenalty.checked;
          const useWound = form.elements.useWoundPenalty.checked;
          
          const skillBonus = parseInt(form.elements.skillBonus.value) || 0;
          const attributeBonus = parseInt(form.elements.attributeBonus.value) || 0;

          // PHASE 1: Build wound configs from grouped wounds
          // Rozpakuj pogrupowane rany do konfiguracji dla każdej rany
          // Każda konfiguracja zawiera: woundId, difficulty, modifier (trudności), healingModifier (% leczenia)
          const woundConfigs = [];
          woundGroups.forEach(group => {
            // Per-damage-type healing modifier (% do redukcji kary)
            const healingModifier = parseInt(form.querySelector(`[name="modifier-${group.damageType}"]`)?.value) || 0;
            // PHASE 1: Per-damage-type difficulty selection
            const selectedDifficulty = form.querySelector(`[name="difficulty-${group.damageType}"]`)?.value || group.difficulty;
            // PHASE 2: Calculate total difficulty modifier (global + armor + wounds)
            const difficultyModifier = globalModifier + 
              (useArmor ? armorPenalty : 0) + 
              (useWound ? woundPenalty : 0);
            
            // PHASE 1: Create config for each individual wound
            group.woundList.forEach(wound => {
              woundConfigs.push({
                woundId: wound.id,
                woundName: wound.name,
                damageType: wound.damageType,
                difficulty: selectedDifficulty,
                modifier: difficultyModifier,
                healingModifier: healingModifier,
                hadFirstAid: wound.hadFirstAid || false
              });
            });
          });
          
          // Save last roll data
          await medicActor.update({
            "system.lastRoll": {
              percentageModifier: globalModifier,
              healingMethod: healingMethod,
              currentAttribute: selectedAttr,
              useArmorPenalty: useArmor,
              useWoundPenalty: useWound,
              skillBonus: skillBonus,
              attributeBonus: attributeBonus
            }
          });

          game.neuroshima?.log("Wykonywanie batch rzutu leczenia", {
            medyk: medicActor.name,
            metoda: healingMethod,
            atrybut: selectedAttr,
            liczbaRan: woundConfigs.length
          });

          const attrValue = medicActor.system.attributes[selectedAttr] + (medicActor.system.modifiers[selectedAttr] || 0);

          await NeuroshimaDice.rollBatchHealingTests({
            medicActor: medicActor,
            patientActor: patientActor,
            healingMethod: healingMethod,
            woundConfigs: woundConfigs,
            stat: attrValue,
            skillBonus: skillBonus,
            attributeBonus: attributeBonus
          });

          game.neuroshima?.groupEnd();
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("NEUROSHIMA.Actions.Cancel")
      }
    ]
  });

  dialog.render(true);

  // PHASE 1: Add event listeners for dynamic updates when user changes values
  // Dialog dynamicznie aktualizuje podsumowanie kli kiedy użytkownik zmienia opcje
  setTimeout(() => {
    const html = $(dialog.element);

    // PHASE 1: Update summary section with current selections
    // Przelicza i wyświetla:
    // - Zmienę umiejętności w zależności od wybranej metody
    // - Zmianę modyfikatora trudności (global + pancerz + rany)
    // - Zmianę trudności testu (z uwzględnieniem modyfikatorów)
    // - Zmianę procentu leczenia (w zależności od metody)
    const updateSummary = () => {
      const healingMethod = html.find('[name="healingMethod"]').val();
      const selectedAttr = html.find('[name="attribute"]').val();
      const globalModifier = parseInt(html.find('[name="globalModifier"]').val()) || 0;
      const useArmor = html.find('[name="useArmorPenalty"]').is(':checked');
      const useWound = html.find('[name="useWoundPenalty"]').is(':checked');
      
      const skillBonus = parseInt(html.find('[name="skillBonus"]').val()) || 0;
      const attributeBonus = parseInt(html.find('[name="attributeBonus"]').val()) || 0;
      
      // PHASE 1: Update skill value when healing method changes
      // Zmienia wyświetlaną wartość umiejętności w zależności od wyboru metody
      const newSkillName = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
      const newSkillValue = medicActor.system.skills?.[newSkillName]?.value || 0;
      html.find('[name="skillValue"]').val(newSkillValue);
      
      // PHASE 2: Calculate difficulty modifier (global + armor + wounds)
      // Suma modyfikatorów trudności testu
      const difficultyModifierVal = globalModifier + 
        (useArmor ? armorPenalty : 0) + 
        (useWound ? woundPenalty : 0);
      
      html.find('.difficulty-modifier').text(`${difficultyModifierVal}%`);
      
      // PHASE 2: Calculate adjusted difficulties with modifiers
      // Przelicza zmianę trudności testu w zależności od modyfikatora trudności
      // Podobnie do normalnego rzutu umiejętności (slider do dostosowania trudności)
      const difficultyCount = {};
      const difficultyWithModifier = {};
      
      woundGroups.forEach(group => {
        const selectedDifficulty = html.find(`[name="difficulty-${group.damageType}"]`).val() || group.difficulty;
        const difficultyData = NEUROSHIMA.difficulties[selectedDifficulty] || NEUROSHIMA.difficulties.average;
        const diffLabel = game.i18n.localize(difficultyData.label);
        
        if (!difficultyCount[selectedDifficulty]) {
          difficultyCount[selectedDifficulty] = { label: diffLabel, count: 0, baseMod: difficultyData.mod };
        }
        difficultyCount[selectedDifficulty].count += group.count;
        
        // PHASE 2: Calculate adjusted difficulty based on total penalty (base + modifiers)
        // Zwraca zmienioną trudność testu (np. Average -> Problematic jeśli modyfikator -20%)
        const totalPenalty = (difficultyData.min || 0) + difficultyModifierVal;
        const adjustedDiffData = NeuroshimaDice.getDifficultyFromPercent(totalPenalty);
        const adjustedDiffLabel = game.i18n.localize(adjustedDiffData.label);
        const diffShift = adjustedDiffData.mod - difficultyData.mod;
        
        const modifierKey = `${selectedDifficulty}-${difficultyModifierVal}`;
        if (!difficultyWithModifier[modifierKey]) {
          difficultyWithModifier[modifierKey] = {
            base: diffLabel,
            adjusted: adjustedDiffLabel,
            shift: diffShift,
            count: 0
          };
        }
        difficultyWithModifier[modifierKey].count += group.count;
      });
      
      // PHASE 2: Build difficulty summary text with adjusted difficulties
      // Wyświetla "4x Average" zamiast "4x Easy" jeśli modyfikator zmienił trudność
      const diffSummaryParts = Object.entries(difficultyWithModifier).map(([_, data]) => {
        return `${data.count}x ${data.adjusted}`;
      });
      html.find('.final-difficulty').text(diffSummaryParts.join(', '));
      
      // Update healing percent for all wound groups
      woundGroups.forEach(group => {
        const newPercent = getHealingPercent(healingMethod, group.woundList[0]?.hadFirstAid);
        const woundRow = html.find(`tr[data-damage-type="${group.damageType}"]`);
        woundRow.find('.wound-healing-percent')
          .text(`${newPercent > 0 ? '+' : ''}${newPercent}%`);
      });
    };

    // Event listeners
    html.on('change', '[name="healingMethod"], [name="attribute"], [name="useArmorPenalty"], [name="useWoundPenalty"], .difficulty-select', updateSummary);
    html.on('input', '[name="globalModifier"], [name="skillBonus"], [name="attributeBonus"], .wound-modifier', updateSummary);

    updateSummary();
  }, 100);

  return dialog;
}
