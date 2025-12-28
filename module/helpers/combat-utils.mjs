/**
 * Combat utilities for Neuroshima system
 * Handles damage application, location rolling, and combat-related calculations
 */

/**
 * Roll for hit location using d20
 * @param {string} targetLocation - Specific location or "random" for dice roll
 * @returns {string} The hit location key (head, torso, leftArm, rightArm, leftLeg, rightLeg)
 */
export function rollHitLocation(targetLocation = "random") {
  // If specific location is targeted, return it
  if (targetLocation !== "random") {
    return targetLocation;
  }
  
  // Roll d20 for random location
  const roll = new Roll("1d20");
  roll.evaluate({async: false});
  const result = roll.total;
  
  // Find location based on dice range
  const hitLocations = CONFIG.NEUROSHIMA.hitLocations;
  for (const [key, location] of Object.entries(hitLocations)) {
    if (location.diceRange) {
      const [min, max] = location.diceRange;
      if (result >= min && result <= max) {
        return key;
      }
    }
  }
  
  // Default to torso if something goes wrong
  return "torso";
}

/**
 * Calculate damage type based on number of successes for melee weapons
 * @param {number} successes - Number of successes (1-3)
 * @param {object} weaponData - Weapon system data containing damage object
 * @returns {string} Damage type (D, L, C, K, sD, sL, sC, sK)
 */
export function calculateMeleeDamage(successes, weaponData) {
  if (!weaponData.damage) {
    return "L"; // Default to light damage
  }
  
  switch(successes) {
    case 1:
      return weaponData.damage.oneSuccess || "L";
    case 2:
      return weaponData.damage.twoSuccess || "C";
    case 3:
      return weaponData.damage.threeSuccess || "K";
    default:
      return "L";
  }
}

/**
 * Get armor value for a specific location on an actor
 * @param {Actor} actor - The actor to check armor for
 * @param {string} location - The hit location (head, torso, leftArm, rightArm, leftLeg, rightLeg)
 * @returns {number} Armor value at that location
 */
export function getArmorAtLocation(actor, location) {
  // Map location to armor property
  const locationMapping = CONFIG.NEUROSHIMA.locationMapping;
  const armorLocation = locationMapping[location] || location;
  
  // For beasts, check beastArmor
  if (actor.type === 'beast' && actor.system.beastArmor) {
    const armorData = actor.system.beastArmor[armorLocation];
    return armorData ? armorData.value : 0;
  }
  
  // For characters, check armor items
  if (actor.system.armor && actor.system.armor[armorLocation] !== undefined) {
    return actor.system.armor[armorLocation] || 0;
  }
  
  return 0;
}

/**
 * Check if location is a weak point (beasts only)
 * @param {Actor} actor - The beast actor
 * @param {string} location - The hit location
 * @returns {boolean} True if it's a weak point
 */
export function isWeakPoint(actor, location) {
  if (actor.type !== 'beast' || !actor.system.beastArmor) {
    return false;
  }
  
  const locationMapping = CONFIG.NEUROSHIMA.locationMapping;
  const armorLocation = locationMapping[location] || location;
  const armorData = actor.system.beastArmor[armorLocation];
  
  return armorData ? armorData.weakPoint : false;
}

/**
 * Create damage data object for chat message
 * @param {object} options - Damage options
 * @param {Actor} options.attacker - The attacking actor
 * @param {Actor} options.target - The target actor
 * @param {Item} options.weapon - The weapon used
 * @param {string} options.damageType - Type of damage (D, L, C, K, sD, sL, sC, sK)
 * @param {string} options.location - Hit location
 * @param {number} options.hitCount - Number of hits (for burst fire)
 * @param {number} options.penetration - Armor penetration value
 * @returns {object} Damage data for chat message
 */
export function createDamageData(options) {
  const {
    attacker,
    target,
    weapon,
    damageType,
    location,
    hitCount = 1,
    penetration = 0
  } = options;
  
  // Get armor at location
  const armor = getArmorAtLocation(target, location);
  const weakPoint = isWeakPoint(target, location);
  const effectiveArmor = Math.max(0, armor - penetration);
  
  // Get damage type info
  const damageTypeInfo = CONFIG.NEUROSHIMA.damageTypes[damageType];
  const locationInfo = CONFIG.NEUROSHIMA.hitLocations[location];
  
  return {
    attackerId: attacker.id,
    attackerName: attacker.name,
    targetId: target.id,
    targetName: target.name,
    weaponId: weapon?.id,
    weaponName: weapon?.name || "Nieznana broń",
    damageType: damageType,
    damageTypeName: damageTypeInfo?.name || damageType,
    location: location,
    locationName: locationInfo?.name || location,
    hitCount: hitCount,
    armor: armor,
    penetration: penetration,
    effectiveArmor: effectiveArmor,
    weakPoint: weakPoint,
    timestamp: Date.now()
  };
}

/**
 * Calculate armor from all armor items (not just equipped)
 */
function getCalculatedArmor(actor, locationKey) {
  let equippedItems = [];
  
  if (actor.items && actor.items.contents) {
    equippedItems = actor.items.contents;
  } else if (Array.isArray(actor.items)) {
    equippedItems = actor.items;
  } else if (typeof actor.items[Symbol.iterator] === 'function') {
    equippedItems = Array.from(actor.items);
  }
  
  console.log(`Neuroshima: getCalculatedArmor for ${actor.name} - checking ${equippedItems.length} items`);
  
  const armorItems = equippedItems.filter(item => item.type === 'armor' && item.system?.protection);
  console.log(`Neuroshima: Found ${armorItems.length} armor items with protection data`);
  
  let totalArmor = {head: 0, torso: 0, leftHand: 0, rightHand: 0, leftLeg: 0, rightLeg: 0};
  
  armorItems.forEach(armor => {
    console.log(`Neuroshima: Processing armor ${armor.name}:`, armor.system.protection);
    const damageAP = armor.system.damageAP || {};
    totalArmor.head += Math.max(0, (armor.system.protection.head || 0) - (damageAP.head || 0));
    totalArmor.torso += Math.max(0, (armor.system.protection.torso || 0) - (damageAP.torso || 0));
    totalArmor.leftHand += Math.max(0, (armor.system.protection.leftHand || 0) - (damageAP.leftHand || 0));
    totalArmor.rightHand += Math.max(0, (armor.system.protection.rightHand || 0) - (damageAP.rightHand || 0));
    totalArmor.leftLeg += Math.max(0, (armor.system.protection.leftLeg || 0) - (damageAP.leftLeg || 0));
    totalArmor.rightLeg += Math.max(0, (armor.system.protection.rightLeg || 0) - (damageAP.rightLeg || 0));
  });
  
  console.log(`Neuroshima: Total armor for ${locationKey}:`, totalArmor[locationKey]);
  return totalArmor[locationKey] || 0;
}

/**
 * Apply damage to target actor
 * Creates wound items on the target after reducing damage by armor
 * @param {Actor} target - The target actor
 * @param {object} damageData - Damage data with penetration
 * @returns {Promise<Item[]>} Created wound items
 */
export async function applyDamage(target, damageData) {
  // Get global damage type mappings
  const baseDamageLevel = CONFIG.NEUROSHIMA.damageTypeValues[damageData.damageType] || 2;
  const penetration = damageData.penetration || 0;
  
  // Get location key for armor lookup
  const locationMapping = CONFIG.NEUROSHIMA.locationMapping;
  const locationKey = locationMapping[damageData.location] || damageData.location;
  
  console.log(`Neuroshima: Applying damage to ${target.name} (type: ${target.type}) at location "${damageData.location}" (mapped to "${locationKey}")`);
  
  // For characters and NPCs, ensure armor is initialized from items before applying damage
  if ((target.type === 'character' || target.type === 'npc') && (!target.system.armor || Object.values(target.system.armor).every(v => !v))) {
    console.log(`Neuroshima: Initializing armor for ${target.name} from items`);
    const initArmor = {head: 0, torso: 0, leftHand: 0, rightHand: 0, leftLeg: 0, rightLeg: 0};
    let items = [];
    if (target.items && target.items.contents) items = target.items.contents;
    else if (Array.isArray(target.items)) items = target.items;
    else if (typeof target.items[Symbol.iterator] === 'function') items = Array.from(target.items);
    
    items.filter(item => item.type === 'armor' && item.system?.protection).forEach(armor => {
      const damageAP = armor.system.damageAP || {};
      initArmor.head += Math.max(0, (armor.system.protection.head || 0) - (damageAP.head || 0));
      initArmor.torso += Math.max(0, (armor.system.protection.torso || 0) - (damageAP.torso || 0));
      initArmor.leftHand += Math.max(0, (armor.system.protection.leftHand || 0) - (damageAP.leftHand || 0));
      initArmor.rightHand += Math.max(0, (armor.system.protection.rightHand || 0) - (damageAP.rightHand || 0));
      initArmor.leftLeg += Math.max(0, (armor.system.protection.leftLeg || 0) - (damageAP.leftLeg || 0));
      initArmor.rightLeg += Math.max(0, (armor.system.protection.rightLeg || 0) - (damageAP.rightLeg || 0));
    });
    target.system.armor = initArmor;
    console.log(`Neuroshima: Armor initialized:`, initArmor);
  }
  
  // Calculate total armor protection at this location
  let totalArmor = 0;
  
  // For beasts with beastArmor
  if (target.type === 'beast' && target.system.beastArmor) {
    const armorData = target.system.beastArmor[locationKey];
    if (armorData) {
      totalArmor = armorData.value || 0;
    }
  } else if (target.type === 'character' || target.type === 'npc') {
    // For characters and NPCs, read armor from actor data
    if (target.system.armor && target.system.armor[locationKey] !== undefined) {
      totalArmor = target.system.armor[locationKey] || 0;
    }
    console.log(`Neuroshima: Reading armor for ${target.name} at ${locationKey}: ${totalArmor}`);
  } else if (target.system.armor && target.system.armor[locationKey] !== undefined) {
    // Fallback for other actor types
    totalArmor = target.system.armor[locationKey] || 0;
  }
  
  // Apply penetration to reduce armor
  const effectiveArmor = Math.max(0, totalArmor - penetration);
  
  // Reduce damage by armor
  const finalDamageLevel = Math.max(0, baseDamageLevel - effectiveArmor);
  
  // Get final damage type (0 means no damage)
  const finalDamageType = CONFIG.NEUROSHIMA.valueToDamageType[finalDamageLevel];
  
  const wounds = [];
  
  // Only create wounds if damage gets through armor
  if (finalDamageLevel > 0) {
    const damageTypeName = CONFIG.NEUROSHIMA.damageTypes[finalDamageType]?.name || finalDamageType;
    
    console.log(`Neuroshima: Creating ${damageData.hitCount} wounds for ${target.name}: ${finalDamageType} wounds`);
    
    // Create wound items
    for (let i = 0; i < damageData.hitCount; i++) {
      const woundData = {
        name: `${damageTypeName} - ${damageData.locationName}`,
        type: "wounds",
        system: {
          location: damageData.location,
          type: finalDamageType,
          penalty: 0,
          active: true,
          healing: false,
          description: `Obrażenie od: ${damageData.weaponName} (${damageData.attackerName}). Pancerz: ${totalArmor}, Penetracja: ${penetration}`
        }
      };
      wounds.push(woundData);
    }
    
    // Create all wounds at once with skipAutoChat flag
    const createdWounds = await Item.createDocuments(wounds, { parent: target, skipAutoChat: true });
    const createdWoundIds = createdWounds.map(w => w._id);
    
    // Wait for all resistance tests to complete
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        const allTested = createdWoundIds.every(id => {
          const wound = target.items.get(id);
          return wound?.system?.resistanceTest?.performed;
        });
        if (allTested) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 3000);
    });
    
    // Collect test results and count passed/failed
    const allTestResults = [];
    let passedCount = 0;
    let failedCount = 0;
    
    createdWoundIds.forEach(id => {
      const wound = target.items.get(id);
      const flags = wound.flags?.neuroshima?.resistanceTestResult;
      if (flags) {
        const status = flags.passed ? 'zdane' : 'niezdane';
        const diceStr = flags.diceRaw.join(',');
        const reducedStr = flags.diceReduced.join(',');
        const woundTypeName = CONFIG.NEUROSHIMA.damageTypes[flags.woundType]?.name || flags.woundType;
        const location = wound.system?.location || '';
        const locationName = CONFIG.NEUROSHIMA.woundLocations?.[location] || location;
        
        allTestResults.push({
          type: woundTypeName,
          location: locationName,
          passed: flags.passed,
          diceRaw: diceStr,
          diceReduced: reducedStr,
          successes: flags.successes
        });
        
        if (flags.passed) passedCount++;
        else failedCount++;
      }
    });
    
    // Build tooltip content for test results (as HTML)
    let passedTooltipContent = '<div class="wound-tooltip-content">';
    let failedTooltipContent = '<div class="wound-tooltip-content">';
    
    allTestResults.forEach(result => {
      const tooltipRow = `<div class="tooltip-row">
        <strong>${result.type} - ${result.location}<br></strong>
        <div style="font-size: 10px; color: #c4b498; margin-top: 2px;">[${result.diceRaw}] → [${result.diceReduced}] ${result.successes}/3</div>
      </div>`;
      
      if (result.passed) {
        passedTooltipContent += tooltipRow;
      } else {
        failedTooltipContent += tooltipRow;
      }
    });
    
    passedTooltipContent += '</div>';
    failedTooltipContent += '</div>';
    
    // Escape HTML entities in tooltip content for safe attribute usage
    const escapeHtml = (text) => {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return text.replace(/[&<>"']/g, m => map[m]);
    };
    
    // Send consolidated chat notification with test summary
    const speaker = ChatMessage.getSpeaker({ actor: target });
    let content = `<div class="wound-notification">
      <p class="wound-notification-title"><strong>${target.name}</strong> otrzymał ${damageData.hitCount} obrażenie(ń) typu <strong>${damageTypeName}</strong></p>`;
    
    if (passedCount > 0) {
      content += `<div class="wound-test-result passed">
        <div class="test-result-header wound-test-tooltip-trigger passed-tooltip">
          <span class="test-count">${passedCount}</span>
          <span class="test-label">Zdanych</span>
        </div>
      </div>`;
    }
    
    if (failedCount > 0) {
      content += `<div class="wound-test-result failed">
        <div class="test-result-header wound-test-tooltip-trigger failed-tooltip">
          <span class="test-count">${failedCount}</span>
          <span class="test-label">Niezdanych</span>
        </div>
      </div>`;
    }
    
    // Store tooltip content in data attributes for later retrieval
    content = content.replace(
      'class="test-result-header wound-test-tooltip-trigger passed-tooltip"',
      `class="test-result-header wound-test-tooltip-trigger passed-tooltip" data-tooltip-content="${escapeHtml(passedTooltipContent)}"`
    );
    content = content.replace(
      'class="test-result-header wound-test-tooltip-trigger failed-tooltip"',
      `class="test-result-header wound-test-tooltip-trigger failed-tooltip" data-tooltip-content="${escapeHtml(failedTooltipContent)}"`
    );
    
    content += `</div>`;
    
    await ChatMessage.create({
      speaker: speaker,
      content: content,
      type: CONST.CHAT_MESSAGE_TYPES.OOC
    });
    
    // Return fresh wound references
    return createdWoundIds.map(id => target.items.get(id));
  } else {
    // No wounds created due to armor
    console.log(`Neuroshima: Damage blocked by armor for ${target.name} at ${damageData.locationName}. Armor: ${totalArmor}, Penetration: ${penetration}, Base Damage: ${damageData.damageType}`);
    
    const damageTypeName = CONFIG.NEUROSHIMA.damageTypes[damageData.damageType]?.name || damageData.damageType;
    const speaker = ChatMessage.getSpeaker({ actor: target });
    const content = `
      <div class="wound-notification blocked" style="background: #d4edda; padding: 10px; border-radius: 5px;">
        <p><strong>${target.name}</strong> - Obrażenia typu <strong>${damageTypeName}</strong> zostały całkowicie zablokowane pancerzem!</p>
        <p><em>Pancerz: ${totalArmor}, Penetracja: ${penetration}</em></p>
      </div>
    `;
    
    await ChatMessage.create({
      speaker: speaker,
      content: content,
      type: CONST.CHAT_MESSAGE_TYPES.OOC
    });
    
    return [];
  }
}

/**
 * Create chat message with damage information and "Apply Damage" button
 * @param {object} damageData - Damage data from createDamageData
 * @returns {Promise<ChatMessage>} Created chat message
 */
export async function createDamageChatMessage(damageData) {
  // Prepare template data
  const templateData = {
    ...damageData,
    armorReduced: damageData.armor > 0,
    penetrationApplied: damageData.penetration > 0,
    canApply: game.user.isGM || damageData.targetId === game.user.character?.id
  };
  
  // Render template
  const template = "systems/neuroshima/templates/chat/damage-application.hbs";
  const content = await renderTemplate(template, templateData);
  
  // Create chat message
  const chatData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({actor: game.actors.get(damageData.attackerId)}),
    content: content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      neuroshima: {
        damageData: damageData
      }
    }
  };
  
  return ChatMessage.create(chatData);
}

/**
 * Handle "Apply Damage" button click from chat message
 * @param {HTMLElement} button - The clicked button element
 */
export async function handleApplyDamageButton(button) {
  if (!game.user.isGM) {
    ui.notifications.error("Tylko GM może aplikować obrażenia");
    return;
  }

  const messageId = button.closest(".chat-message").dataset.messageId;
  const message = game.messages.get(messageId);
  
  if (!message) {
    ui.notifications.error("Nie można znaleźć wiadomości czatu");
    return;
  }
  
  const damageData = message.flags?.neuroshima?.damageData;
  if (!damageData) {
    ui.notifications.error("Brak danych o obrażeniach");
    return;
  }
  
  const target = game.actors.get(damageData.targetId);
  if (!target) {
    ui.notifications.error("Nie można znaleźć celu");
    return;
  }
  
  const wounds = await applyDamage(target, damageData);
  
  button.disabled = true;
  button.classList.add("applied");
  button.innerHTML = '<i class="fas fa-check-circle"></i> Obrażenia zaaplikowane';
  
  ui.notifications.info(`Zaaplikowano ${wounds.length} obrażenie(ń) na ${target.name}`);
}

/**
 * Toggle damage application section visibility
 * @param {HTMLElement} toggle - The toggle button element
 */
export function toggleDamageApplicationSection(toggle) {
  const section = toggle.closest(".damage-application").querySelector(".damage-actions");
  const icon = toggle.querySelector("i");
  
  if (section.classList.contains("collapsed")) {
    section.classList.remove("collapsed");
    icon.classList.remove("fa-chevron-down");
    icon.classList.add("fa-chevron-up");
  } else {
    section.classList.add("collapsed");
    icon.classList.remove("fa-chevron-up");
    icon.classList.add("fa-chevron-down");
  }
}

/**
 * Perform a resistance test for a single wound (closed test)
 * Automatically called when a wound item is created on an actor
 * @param {Actor} actor - The actor receiving the wound
 * @param {Item} wound - The wound item
 * @returns {Promise<object>} Result with test details
 */
export async function performWoundResistanceTest(actor, wound) {
  console.log(`Neuroshima: performWoundResistanceTest START for wound "${wound.name}"`);
  
  const woundType = wound.system.type;
  const consequence = CONFIG.NEUROSHIMA.woundConsequences[woundType];
  
  if (!consequence || consequence.testDifficulty === null) {
    console.log(`Neuroshima: No consequence or testDifficulty for wound type ${woundType}`);
    return {
      woundId: wound._id,
      woundName: wound.name,
      woundType: woundType,
      performedTest: false,
      reason: 'No test required for this wound type'
    };
  }
  
  const skillValue = actor.system.skills?.ch?.odpornosc_na_bol || 0;
  const attributeValue = actor.system.attributes.ch.value + (actor.system.attributes.ch.mod || 0);
  const testDifficulty = consequence.testDifficulty;
  
  const difficultyMods = { easy: 2, average: 0, problematic: -2, hard: -5, veryHard: -8, damnHard: -11, luck: -15 };
  const diffMod = testDifficulty ? (difficultyMods[testDifficulty] || 0) : 0;
  const threshold = attributeValue + diffMod;
  
  const roll = new Roll('3d20', actor.getRollData ? actor.getRollData() : {});
  await roll.evaluate();
  const diceResults = roll.terms[0].results.map(r => r.result);
  
  let reducedDice = [...diceResults];
  let remainingPoints = skillValue;
  
  while (remainingPoints > 0) {
    let maxIndex = 0;
    let maxValue = reducedDice[0];
    for (let j = 1; j < reducedDice.length; j++) {
      if (reducedDice[j] > maxValue) {
        maxValue = reducedDice[j];
        maxIndex = j;
      }
    }
    
    if (reducedDice[maxIndex] > 1) {
      reducedDice[maxIndex]--;
      remainingPoints--;
    } else {
      break;
    }
  }
  
  let successes = 0;
  for (let j = 0; j < reducedDice.length; j++) {
    if (reducedDice[j] <= threshold) {
      successes++;
    }
  }
  
  const passed = successes >= 2;
  const penalty = passed ? consequence.passedPenalty : consequence.failedPenalty;
  
  console.log(`Neuroshima: Wound test result - Raw[${diceResults}] → Reduced[${reducedDice}] vs Threshold${threshold} = ${successes} successes, Penalty: ${penalty}%`);
  
  return {
    woundId: wound._id,
    woundName: wound.name,
    woundType: woundType,
    performedTest: true,
    diceRaw: diceResults,
    diceReduced: reducedDice,
    threshold: threshold,
    successes: successes,
    passed: passed,
    penalty: penalty,
    skillValue: skillValue,
    attributeValue: attributeValue,
    testDifficulty: testDifficulty
  };
}


