/**
 * Utility functions shared across the Neuroshima system
 * Centralizes commonly duplicated helper functions
 */

/**
 * Escape HTML entities in text for safe attribute usage
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for HTML attributes
 */
export function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Unescape HTML entities in text
 * @param {string} text - Text to unescape
 * @returns {string} Unescaped text
 */
export function unescapeHtml(text) {
  const map = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#039;': "'"
  };
  return text.replace(/&(?:amp|lt|gt|quot|#039);/g, m => map[m]);
}

/**
 * Get difficulty modifier for closed tests
 * @param {string} testDifficulty - Difficulty key from config
 * @returns {number} Difficulty modifier
 */
export function getDifficultyModifier(testDifficulty) {
  const difficultyMods = {
    'easy': 2,
    'average': 0,
    'problematic': -2,
    'hard': -5,
    'veryHard': -8,
    'damnHard': -11,
    'luck': -15
  };
  return difficultyMods[testDifficulty] || 0;
}

/**
 * Get localized damage type name
 * @param {string} damageType - Damage type key (D, L, C, K, etc.)
 * @returns {string} Localized damage type name
 */
export function getDamageTypeName(damageType) {
  const damageTypeConfig = CONFIG.NEUROSHIMA.damageTypes[damageType];
  return damageTypeConfig?.name || damageType;
}

/**
 * Get localized difficulty name
 * @param {string} difficulty - Difficulty key (easy, average, problematic, hard, veryHard, damnHard, luck)
 * @returns {string} Localized difficulty name
 */
export function getDifficultyName(difficulty) {
  const difficultyNames = {
    'easy': 'Łatwy',
    'average': 'Przeciętny',
    'problematic': 'Problematyczny',
    'hard': 'Trudny',
    'veryHard': 'Bardzo Trudny',
    'damnHard': 'Cholernie Trudny',
    'luck': 'Fart'
  };
  return difficultyNames[difficulty] || difficulty;
}

/**
 * Reduce dice results using skill points
 * Used in both closed tests and ranged attacks
 * @param {number[]} dice - Array of dice results
 * @param {number} reductionPoints - Skill points to use for reduction
 * @returns {number[]} Reduced dice results
 */
export function reduceDiceResults(dice, reductionPoints) {
  const workingDice = [...dice].sort((a, b) => b - a);
  let remainingPoints = reductionPoints;
  
  while (remainingPoints > 0 && workingDice[0] > workingDice[1]) {
    const difference = workingDice[0] - workingDice[1];
    const pointsToUse = Math.min(difference, remainingPoints);
    
    workingDice[0] -= pointsToUse;
    remainingPoints -= pointsToUse;
  }
  
  while (remainingPoints > 0) {
    if (remainingPoints >= 2) {
      workingDice[0] -= 1;
      workingDice[1] -= 1;
      remainingPoints -= 2;
    } else {
      workingDice[0] -= 1;
      remainingPoints -= 1;
    }
  }
  
  return workingDice.sort((a, b) => a - b);
}

/**
 * Reduce single die by skill amount (used in ranged attacks)
 * Reduces die value but not below the threshold
 * @param {number} die - Die result
 * @param {number} skillLevel - Skill level reduction amount
 * @param {number} threshold - Minimum value (don't reduce below this)
 * @returns {number} Reduced die value
 */
export function reduceSingleDie(die, skillLevel, threshold) {
  if (die > threshold) {
    return Math.max(threshold, die - skillLevel);
  }
  return die;
}

/**
 * Log debug message if debug mode is enabled
 * @param {string} message - Message to log
 */
export function logDebug(message) {
  // Dynamically import to avoid circular dependency
  import("./settings.mjs").then(({ isDebugMode }) => {
    if (isDebugMode()) {
      console.log(`[Neuroshima Debug] ${message}`);
    }
  }).catch(() => {
    // Fallback if import fails
  });
}

/**
 * Synchronous debug check (use sparingly)
 * For performance-critical code, check this directly instead of logDebug()
 * @returns {boolean} True if debug mode is enabled
 */
export function shouldDebug() {
  try {
    return game.settings.get("neuroshima", "debugMode");
  } catch {
    return false;
  }
}
