/**
 * Neuroshima 1.5 System
 * System dla gry RPG Neuroshima 1.5 dla Foundry VTT
 */

// Import document classes
import { NeuroshimaActor } from "./module/documents/actor.mjs";
import { NeuroshimaItem } from "./module/documents/item.mjs";

// Import sheet classes
import { NeuroshimaActorSheet } from "./module/sheets/actor-sheet.mjs";
import { NeuroshimaNPCSheet } from "./module/sheets/npc-sheet.mjs";
import { NeuroshimaBeastSheet } from "./module/sheets/beast-sheet.mjs";
import { NeuroshimaItemSheet } from "./module/sheets/item-sheet.mjs";

// Import helper/utility classes and constants
import { NEUROSHIMA } from "./module/helpers/config.mjs";
import { preloadHandlebarsTemplates } from "./module/helpers/templates.mjs";
import { registerHandlebarsHelpers } from "./module/helpers/handlebars.mjs";
import { handleApplyDamageButton } from "./module/helpers/combat-utils.mjs";
import { registerSystemSettings, canSeeDamageApplication, canApplyDamage } from "./module/helpers/settings.mjs";

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once('init', function() {
  console.log('Neuroshima | Initializing Neuroshima System');

  // Assign custom classes and constants here
  CONFIG.NEUROSHIMA = NEUROSHIMA;

  // Register custom Document classes
  CONFIG.Actor.documentClass = NeuroshimaActor;
  CONFIG.Item.documentClass = NeuroshimaItem;

  // Register custom Application classes
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("neuroshima", NeuroshimaActorSheet, { 
    types: ["character"], 
    makeDefault: true 
  });
  Actors.registerSheet("neuroshima", NeuroshimaNPCSheet, { 
    types: ["npc"], 
    makeDefault: true 
  });
  Actors.registerSheet("neuroshima", NeuroshimaBeastSheet, { 
    types: ["beast"], 
    makeDefault: true 
  });

  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("neuroshima", NeuroshimaItemSheet, { 
    makeDefault: true 
  });

  // Register system settings
  registerSystemSettings();

  // Register Handlebars helpers
  registerHandlebarsHelpers();

  // Preload Handlebars templates
  return preloadHandlebarsTemplates();
});

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once("ready", function() {
  console.log('Neuroshima | System ready');
});

/* -------------------------------------------- */
/*  Chat Message Hooks                          */
/* -------------------------------------------- */

// Add event listeners to chat messages for beast action buttons
Hooks.on("renderChatMessage", (message, html, data) => {
  // Control visibility of damage application section based on user permissions
  const damageSection = html.find('.damage-application-section[data-damage-section="true"]');
  if (damageSection.length > 0) {
    if (!canSeeDamageApplication()) {
      damageSection.hide();
    }
  }
  
  // Handle "Execute Action" button for beast actions (success system)
  html.find('.execute-beast-action').click(async (event) => {
    event.preventDefault();
    const button = event.currentTarget;
    const actorId = button.dataset.actorId;
    const itemId = button.dataset.itemId;
    
    const actor = game.actors.get(actorId);
    const item = actor?.items.get(itemId);
    
    if (!actor || !item) {
      ui.notifications.error('Nie znaleziono aktora lub akcji!');
      return;
    }
    
    // Get current success pool from button data (passed when button was rendered)
    let currentSuccesses = parseInt(button.dataset.currentSuccesses) || 0;
    const maxSuccesses = actor.system.actionTracking?.maxSuccesses || 3;
    
    console.log(`[Neuroshima] Execute Beast Action: currentSuccesses=${currentSuccesses} (from button), maxSuccesses=${maxSuccesses}, actionItem=${item.name}`);
    
    if (currentSuccesses < 1) {
      ui.notifications.warn(`Brak dostępnych sukcesów! (${currentSuccesses}/${maxSuccesses}). Wykonaj rzut akcją aby wygenerować sukcesy.`);
      return;
    }
    
    // Get the actor's sheet to access the action selection dialog
    const sheet = actor.sheet;
    if (!sheet || !sheet._showActionSelectionDialog) {
      ui.notifications.error('Nie można otworzyć dialogu wyboru akcji!');
      return;
    }
    
    // Show action selection dialog with current success pool
    const selectedAction = await sheet._showActionSelectionDialog(item, 'successes', currentSuccesses);
    
    if (!selectedAction) {
      console.log(`[Neuroshima] Action selection cancelled`);
      return;
    }
    
    // Deduct action cost from current successes
    const newSuccessCount = currentSuccesses - selectedAction.cost;
    console.log(`[Neuroshima] Executing action: ${selectedAction.name}, cost=${selectedAction.cost}, remaining=${newSuccessCount}`);
    
    // Update actor
    console.log(`[Neuroshima] Updating actor: currentSuccesses ${currentSuccesses} -> ${newSuccessCount}`);
    await actor.update({ 'system.actionTracking.currentSuccesses': newSuccessCount });
    console.log(`[Neuroshima] Actor updated successfully`);
    
    // Display action execution in chat FIRST (before re-rendering sheet)
    if (sheet?._displayActionExecution) {
      console.log(`[Neuroshima] Calling _displayActionExecution from sheet`);
      await sheet._displayActionExecution(selectedAction, item, currentSuccesses, newSuccessCount);
    } else {
      console.log(`[Neuroshima] Sheet unavailable, creating fallback action execution message`);
      const damageTypeNames = {
        'D': 'Draśnięcie', 'sD': 'Siniak (Draśnięcie)',
        'L': 'Lekkie', 'sL': 'Siniak (Lekkie)',
        'C': 'Ciężkie', 'sC': 'Siniak (Ciężkie)',
        'K': 'Krytyczne', 'sK': 'Siniak (Krytyczne)'
      };
      
      const content = `
        <div class="neuroshima-action-execution">
          <h3><i class="fas fa-bolt"></i> Wykonanie Akcji</h3>
          <div class="action-execution-details">
            <div class="action-execution-name"><strong>${selectedAction.name}</strong></div>
            <div class="action-execution-stats">
              ${selectedAction.damage ? `<div class="stat-row"><span class="stat-label">Obrażenia:</span> <span class="stat-value">${damageTypeNames[selectedAction.damage] || selectedAction.damage}</span></div>` : ''}
              ${selectedAction.range ? `<div class="stat-row"><span class="stat-label">Zasięg:</span> <span class="stat-value">${selectedAction.range}</span></div>` : ''}
            </div>
            <div class="action-execution-cost">
              <div class="cost-row">
                <span class="cost-label">Koszt akcji:</span> <span class="cost-value">${selectedAction.cost} sukcesów</span>
              </div>
              <div class="cost-row">
                <span class="cost-label">Pozostałe sukcesy:</span> <span class="cost-value">${newSuccessCount} / ${currentSuccesses}</span>
              </div>
            </div>
          </div>
        </div>
      `;
      
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: actor }),
        content: content,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
    }
    
    // THEN refresh sheet to show updated success count
    if (sheet?.render) {
      console.log(`[Neuroshima] Refreshing sheet display...`);
      sheet.render(false);
    } else {
      console.log(`[Neuroshima] No sheet to refresh`);
    }
  });
  
  // Handle damage application tabs
  html.find('.damage-tab-button').click((event) => {
    event.preventDefault();
    const button = event.currentTarget;
    const tabName = button.dataset.tab;
    const container = button.closest('.damage-application-section');
    
    // Switch active tab button
    container.querySelectorAll('.damage-tab-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    // Switch active tab content
    container.querySelectorAll('.damage-tab-content').forEach(content => content.classList.remove('active'));
    container.querySelector(`[data-tab-content="${tabName}"]`).classList.add('active');
    
    // If switching to "selected" tab, populate the list
    if (tabName === 'selected') {
      const listContainer = container.querySelector('.selected-targets-list');
      if (listContainer) {
        populateSelectedTargetsList(listContainer, container);
      }
    }
  });
  
  // Handle "Apply Damage" button for damage application
  html.find('.apply-damage-button').click(async (event) => {
    event.preventDefault();
    const button = event.currentTarget;
    
    // Cooldown check (3 seconds)
    if (button.dataset.cooldown === 'true') {
      ui.notifications.warn('Czekaj na cooldown...');
      return;
    }
    
    // Set cooldown
    button.disabled = true;
    button.dataset.cooldown = 'true';
    button.style.opacity = '0.5';
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-hourglass-end"></i> Czekaj...';
    
    setTimeout(() => {
      button.disabled = false;
      button.dataset.cooldown = 'false';
      button.style.opacity = '1';
      button.innerHTML = originalText;
    }, 3000);
    
    const container = button.closest('.damage-application-section');
    const messageDiv = container.querySelector('.apply-damage-message');
    
    // Get damage data from button
    const attackerId = button.dataset.attackerId;
    const weaponName = button.dataset.weaponName;
    const damageType = button.dataset.damageType;
    const location = button.dataset.location;
    const hitCount = parseInt(button.dataset.hitCount) || 1;
    const penetration = parseInt(button.dataset.penetration) || 0;
    const attacker = game.actors.get(attackerId);
    
    // Determine which tab is active
    const activeTab = container.querySelector('.damage-tab-button.active').dataset.tab;
    
    let targetActors = [];
    
    if (activeTab === 'targeted') {
      // Single target from targeted tab
      const targetActorId = button.dataset.targetedActorId;
      if (!targetActorId) {
        messageDiv.textContent = '⚠️ Brak targetowanego celu.';
        messageDiv.style.display = 'block';
        messageDiv.style.color = '#ff6b6b';
        return;
      }
      // Find token on canvas that has this actor
      const targetToken = canvas.tokens?.placeables.find(t => t.actor?.id === targetActorId);
      if (!targetToken?.actor) {
        messageDiv.textContent = '❌ Cel nie znajduje się na planszy. Walka wymaga tokena na scenie.';
        messageDiv.style.display = 'block';
        messageDiv.style.color = '#ff6b6b';
        return;
      }
      targetActors = [targetToken.actor];
    } else if (activeTab === 'selected') {
      // Multiple targets from targeted tokens (game.user.targets)
      const targetedTokens = Array.from(game.user.targets) || [];
      if (targetedTokens.length === 0) {
        messageDiv.textContent = '⚠️ Brak targetowanych tokenów. Targetuj tokeny na planszy i spróbuj ponownie.';
        messageDiv.style.display = 'block';
        messageDiv.style.color = '#ff6b6b';
        return;
      }
      targetActors = targetedTokens.map(token => token.actor).filter(actor => actor);
    }
    
    if (targetActors.length === 0) {
      messageDiv.textContent = '❌ Nie znaleziono celów.';
      messageDiv.style.display = 'block';
      messageDiv.style.color = '#ff6b6b';
      return;
    }
    
    // Apply damage using combat-utils
    const { applyDamage } = await import("./module/helpers/combat-utils.mjs");
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    
    for (const targetActor of targetActors) {
      // Check permissions using settings
      if (!canApplyDamage(targetActor)) {
        failCount++;
        errors.push(`${targetActor.name}: Brak uprawnień`);
        continue;
      }
      
      try {
        // Get translated names for damage type and location
        const damageTypeInfo = CONFIG.NEUROSHIMA.damageTypes[damageType];
        const locationInfo = CONFIG.NEUROSHIMA.hitLocations[location];
        
        await applyDamage(targetActor, {
          damageType,
          damageTypeName: damageTypeInfo?.name || damageType,
          location,
          locationName: locationInfo?.name || location,
          weaponName,
          attackerName: attacker?.name || 'Nieznany',
          hitCount,
          penetration
        });
        successCount++;
      } catch (error) {
        console.error(`Error applying damage to ${targetActor.name}:`, error);
        failCount++;
        errors.push(`${targetActor.name}: ${error.message}`);
      }
    }
    
    // Display result message
    if (successCount > 0 && failCount === 0) {
      if (targetActors.length === 1) {
        messageDiv.textContent = `✓ Obrażenie zaaplikowane na ${targetActors[0].name}!`;
      } else {
        messageDiv.textContent = `✓ Obrażenie zaaplikowane na ${successCount} celów!`;
      }
      messageDiv.style.color = '#51cf66';
    } else if (successCount > 0 && failCount > 0) {
      messageDiv.textContent = `⚠️ Sukces: ${successCount}, Błędy: ${failCount}. ${errors.join(', ')}`;
      messageDiv.style.color = '#ffa94d';
    } else {
      messageDiv.textContent = `❌ Błędy: ${errors.join(', ')}`;
      messageDiv.style.color = '#ff6b6b';
    }
    messageDiv.style.display = 'block';
    
    // Auto-hide damage application section if enabled and successful
    const { shouldAutoHideDamageApplication } = await import("./module/helpers/settings.mjs");
    if (successCount > 0 && shouldAutoHideDamageApplication()) {
      setTimeout(() => {
        const wrapper = container.querySelector('.damage-application-content-wrapper');
        if (wrapper) {
          wrapper.classList.add('collapsed');
          const toggle = container.querySelector('.damage-collapse-toggle');
          if (toggle) {
            const icon = toggle.querySelector('i');
            icon.classList.remove('fa-chevron-up');
            icon.classList.add('fa-chevron-down');
          }
        }
      }, 2000); // Hide after 2 seconds to allow user to see the success message
    }
  });



  // Handle damage application section collapse/expand
  html.find('.damage-collapse-toggle').click((event) => {
    event.preventDefault();
    event.stopPropagation();
    const toggle = event.currentTarget;
    const wrapper = toggle.closest('.damage-application-section').querySelector('.damage-application-content-wrapper');
    
    if (wrapper) {
      wrapper.classList.toggle('collapsed');
      const icon = toggle.querySelector('i');
      if (wrapper.classList.contains('collapsed')) {
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
      } else {
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
      }
    }
  });
});

/**
 * Populate the selected targets list with controlled/selected tokens
 * @param {HTMLElement} listContainer - The list container element
 * @param {HTMLElement} damageSection - The damage application section
 */
function populateSelectedTargetsList(listContainer, damageSection) {
  // Clear existing content
  listContainer.innerHTML = '';
  
  // Get currently selected tokens on canvas (the ones with white border when clicked)
  const selectedTokens = canvas.tokens?.controlled || [];
  
  if (selectedTokens.length === 0) {
    listContainer.innerHTML = `
      <div class="no-target-message">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Brak wyselekcjonowanych tokenów na planszy</p>
      </div>
    `;
    return;
  }
  
  // Get damage data from button
  const button = damageSection.querySelector('.apply-damage-button');
  const location = button.dataset.location;
  const locationName = CONFIG.NEUROSHIMA.hitLocations[location]?.name || location;
  const penetration = parseInt(button.dataset.penetration) || 0;
  
  // Create a card for each selected token
  selectedTokens.forEach(token => {
    if (!token.actor) return;
    
    const actor = token.actor;
    
    // Get armor info
    const locationKey = CONFIG.NEUROSHIMA.locationMapping[location] || location;
    let armor = 0;
    if (actor.type === 'character') {
      armor = actor.system.armor?.[locationKey] || 0;
    } else if (actor.type === 'beast') {
      armor = actor.system.armor || 0;
    }
    
    const effectiveArmor = Math.max(0, armor - penetration);
    const weakPoint = actor.type === 'beast' && actor.system.weakPoints?.[locationKey];
    
    // Build card HTML
    const cardHTML = `
      <div class="target-info selected-target-card" data-actor-id="${actor.id}">
        <img src="${actor.img}" alt="${actor.name}" class="target-avatar"/>
        <div class="target-name">${actor.name}</div>
      </div>
    `;
    
    listContainer.insertAdjacentHTML('beforeend', cardHTML);
  });
}

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

Hooks.once('init', function() {
  // Register Handlebars helpers
  Handlebars.registerHelper('concat', function() {
    var outStr = '';
    for (var arg in arguments) {
      if (typeof arguments[arg] != 'object') {
        outStr += arguments[arg];
      }
    }
    return outStr;
  });

  Handlebars.registerHelper('toLowerCase', function(str) {
    return str.toLowerCase();
  });

  Handlebars.registerHelper('eq', function(a, b) {
    return a == b;
  });

  Handlebars.registerHelper('ne', function(a, b) {
    return a != b;
  });

  Handlebars.registerHelper('gt', function(a, b) {
    return a > b;
  });

  Handlebars.registerHelper('lt', function(a, b) {
    return a < b;
  });

  Handlebars.registerHelper('math', function() {
    let result = 0;
    for (let i = 0; i < arguments.length - 1; i += 2) {
      if (i === 0) {
        result = parseFloat(arguments[i]) || 0;
      } else {
        const operator = arguments[i];
        const operand = parseFloat(arguments[i + 1]) || 0;
        
        switch (operator) {
          case '+':
            result += operand;
            break;
          case '-':
            result -= operand;
            break;
          case '*':
            result *= operand;
            break;
          case '/':
            result /= operand;
            break;
        }
      }
    }
    return Math.max(1, result); // Minimum 1 dla progów testów
  });

  Handlebars.registerHelper('join', function(array, separator) {
    if (Array.isArray(array)) {
      return array.join(separator || ', ');
    }
    return '';
  });

  Handlebars.registerHelper('isSpecialized', function(specializations, category) {
    return specializations?.categories?.[category] || false;
  });

  Handlebars.registerHelper('specializationClass', function(specializations, category) {
    return (specializations?.categories?.[category]) ? 'specialized' : '';
  });

  // Helper do kalkulacji poziomów trudności w tabeli współczynników
  // Kalkuluje: wartość_atrybutu + modyfikator_atrybutu + modyfikator_poziomu_trudności
  // UWAGA: Może być ujemny! (np. przy Farcie z niskim atrybutem)
  Handlebars.registerHelper('difficultyValue', function(attributeValue, attributeMod, difficultyMod) {
    const result = (attributeValue || 0) + (attributeMod || 0) + difficultyMod;
    return result; // Może być ujemny - to jest zgodne z regułami!
  });

  // Helper do tłumaczenia typów akcji bestii
  Handlebars.registerHelper('getActionTypeName', function(actionType) {
    const types = {
      'attack': 'Atak',
      'defense': 'Obrona',
      'special': 'Specjalna',
      'movement': 'Ruch'
    };
    return types[actionType] || actionType;
  });
});

/* -------------------------------------------- */
/*  Token Selection Hook                        */
/* -------------------------------------------- */

/**
 * Hook that fires when a token is selected/deselected on the canvas
 * Updates the "Selected" tab in all visible damage application sections
 */
Hooks.on('controlToken', (token, controlled) => {
  // Find all visible damage application sections with "selected" tab active
  const chatMessages = document.querySelectorAll('.chat-message');
  
  chatMessages.forEach(messageEl => {
    const damageSection = messageEl.querySelector('.damage-application-section');
    if (!damageSection) return;
    
    // Check if "selected" tab is currently active
    const selectedTab = damageSection.querySelector('[data-tab-content="selected"]');
    if (!selectedTab || !selectedTab.classList.contains('active')) return;
    
    // Refresh the selected targets list
    const listContainer = selectedTab.querySelector('.selected-targets-list');
    if (listContainer) {
      populateSelectedTargetsList(listContainer, damageSection);
    }
  });
});

/* -------------------------------------------- */
/*  Wound Notification Tooltips                 */
/* -------------------------------------------- */

Hooks.on('renderChatMessageHTML', (message, html, data) => {
  const woundNotification = html.querySelector('.wound-notification');
  if (!woundNotification) return;
  
  const unescapeHtml = (text) => {
    const map = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#039;': "'"
    };
    return text.replace(/&(?:amp|lt|gt|quot|#039);/g, m => map[m]);
  };
  
  const tooltipTriggers = html.querySelectorAll('.wound-test-tooltip-trigger');
  
  tooltipTriggers.forEach((trigger) => {
    const tooltipContent = trigger.dataset.tooltipContent;
    if (!tooltipContent) return;
    
    trigger.addEventListener('mouseenter', () => {
      // Create custom tooltip
      let existingTooltip = document.querySelector('.wound-tooltip-custom');
      if (existingTooltip) existingTooltip.remove();
      
      const tooltipDiv = document.createElement('div');
      tooltipDiv.className = 'wound-tooltip-custom';
      tooltipDiv.innerHTML = unescapeHtml(tooltipContent);
      
      // Position tooltip
      document.body.appendChild(tooltipDiv);
      
      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltipDiv.getBoundingClientRect();
      const padding = 10;
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };
      
      // Try to position to the left
      let leftPos = triggerRect.left - tooltipRect.width - padding;
      
      // Adjust horizontal position if goes off left
      if (leftPos < padding) {
        leftPos = triggerRect.right + padding;
      }
      
      // Adjust if goes off right
      if (leftPos + tooltipRect.width > viewport.width - padding) {
        leftPos = viewport.width - tooltipRect.width - padding;
      }
      
      // Vertical positioning - center on screen
      let topPos = triggerRect.top - tooltipRect.height / 2;
      
      // Adjust if goes off top
      if (topPos < padding) {
        topPos = padding;
      }
      
      // Adjust if goes off bottom
      if (topPos + tooltipRect.height > viewport.height - padding) {
        topPos = viewport.height - tooltipRect.height - padding;
      }
      
      tooltipDiv.style.position = 'fixed';
      tooltipDiv.style.left = leftPos + 'px';
      tooltipDiv.style.top = topPos + 'px';
      tooltipDiv.style.pointerEvents = 'auto';
      
      // Allow scrolling on the tooltip
      tooltipDiv.addEventListener('wheel', (e) => {
        e.stopPropagation();
      });
      
      // Hide tooltip when leaving both trigger and tooltip
      const hideTooltip = () => {
        tooltipDiv.remove();
        trigger.removeEventListener('mouseleave', hideTooltip);
        tooltipDiv.removeEventListener('mouseleave', hideTooltip);
      };
      
      trigger.addEventListener('mouseleave', hideTooltip);
      tooltipDiv.addEventListener('mouseleave', hideTooltip);
    });
  });
});

