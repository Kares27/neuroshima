/**
 * Register system settings for Neuroshima
 */
import { shouldDebug } from "./utils.mjs";

export function registerSystemSettings() {
  
  /**
   * Setting: Who can see damage application section in chat
   * Controls visibility of the damage application UI in attack roll chat messages
   */
  game.settings.register("neuroshima", "damageApplicationVisibility", {
    name: "Widoczność aplikowania obrażeń",
    hint: "Określa, kto może widzieć sekcję aplikowania obrażeń w wiadomościach czatu z atakami. Domyślnie tylko GM.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "gm": "Tylko GM",
      "assistant": "GM i Assistant GM",
      "trusted": "GM, Assistant GM i Trusted Players",
      "player": "Wszyscy gracze"
    },
    default: "gm",
    onChange: value => {
      if (shouldDebug()) console.log(`Neuroshima | Damage application visibility changed to: ${value}`);
      // Refresh all chat messages to apply new visibility settings
      ui.chat.render(true);
    }
  });

  /**
   * Setting: Who can apply damage
   * Controls who has permission to click "Apply Damage" button
   */
  game.settings.register("neuroshima", "damageApplicationPermission", {
    name: "Uprawnienia do aplikowania obrażeń",
    hint: "Określa, kto może klikać przycisk 'Aplikuj Obrażenie' i faktycznie aplikować obrażenia na postacie. Domyślnie tylko GM.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "gm": "Tylko GM",
      "assistant": "GM i Assistant GM",
      "trusted": "GM, Assistant GM i Trusted Players",
      "player": "Wszyscy gracze (mogą aplikować na swoje postacie)"
    },
    default: "gm",
    onChange: value => {
      if (shouldDebug()) console.log(`Neuroshima | Damage application permission changed to: ${value}`);
    }
  });

  /**
   * Setting: Auto-hide damage application after use
   * If enabled, the damage application section will be hidden after damage is applied
   */
  game.settings.register("neuroshima", "autoHideDamageApplication", {
    name: "Auto-ukrywanie po aplikacji",
    hint: "Jeśli włączone, sekcja aplikowania obrażeń zostanie automatycznie ukryta po zaaplikowaniu obrażeń.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => {
      if (shouldDebug()) console.log(`Neuroshima | Auto-hide damage application: ${value}`);
    }
  });

  /**
   * Setting: Collapsable damage application section
   * If enabled, the damage application section can be collapsed/expanded
   */
  game.settings.register("neuroshima", "collapsableDamageSection", {
    name: "Collapsable sekcja aplikowania obrażeń",
    hint: "Jeśli włączone, sekcja aplikowania obrażeń będzie mogła być zwijana/rozwijana zamiast ukrywania. Dostęp tylko dla GM.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => {
      if (shouldDebug()) console.log(`Neuroshima | Collapsable damage section: ${value}`);
    }
  });

  /**
   * Setting: Enable debug logging
   * If enabled, the system will output debug information to console
   */
  game.settings.register("neuroshima", "debugMode", {
    name: "Tryb debugowania",
    hint: "Jeśli włączone, system będzie wypisywać informacje debugowania do konsoli przeglądarki. Przydatne do diagnozowania problemów.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: value => {
      if (shouldDebug()) console.log(`Neuroshima | Debug mode: ${value}`);
    }
  });

  if (shouldDebug()) console.log('Neuroshima | System settings registered');
}

/**
 * Check if current user can see damage application section
 * @returns {boolean} True if user has permission to see the section
 */
export function canSeeDamageApplication() {
  const setting = game.settings.get("neuroshima", "damageApplicationVisibility");
  const user = game.user;
  
  switch (setting) {
    case "gm":
      return user.isGM;
    case "assistant":
      return user.isGM || user.role >= CONST.USER_ROLES.ASSISTANT;
    case "trusted":
      return user.isGM || user.role >= CONST.USER_ROLES.TRUSTED;
    case "player":
      return true; // Everyone can see
    default:
      return user.isGM; // Fallback to GM only
  }
}

/**
 * Check if current user can apply damage
 * @param {Actor} targetActor - The target actor (optional, for ownership check)
 * @returns {boolean} True if user has permission to apply damage
 */
export function canApplyDamage(targetActor = null) {
  const setting = game.settings.get("neuroshima", "damageApplicationPermission");
  const user = game.user;
  
  switch (setting) {
    case "gm":
      return user.isGM;
    case "assistant":
      return user.isGM || user.role >= CONST.USER_ROLES.ASSISTANT;
    case "trusted":
      return user.isGM || user.role >= CONST.USER_ROLES.TRUSTED;
    case "player":
      // Players can apply damage if they own the target actor
      if (targetActor) {
        return targetActor.isOwner || user.isGM;
      }
      return true;
    default:
      return user.isGM; // Fallback to GM only
  }
}

/**
 * Check if damage application should auto-hide after use
 * @returns {boolean} True if auto-hide is enabled
 */
export function shouldAutoHideDamageApplication() {
  return game.settings.get("neuroshima", "autoHideDamageApplication");
}

/**
 * Check if debug mode is enabled
 * @returns {boolean} True if debug mode is enabled
 */
export function isDebugMode() {
  return game.settings.get("neuroshima", "debugMode");
}