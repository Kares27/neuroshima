/**
 * Define a set of template paths to pre-load
 * Pre-loaded templates are compiled and cached for fast access when rendering
 * @return {Promise}
 */
export function registerHandlebarsHelpers() {

  // If you need to add Handlebars helpers, here are a few useful examples:
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

  // Helper for checking equipment
  Handlebars.registerHelper('isEquipped', function(item) {
    return item.system.equipable || false;
  });

  // Helper for damage type localization
  Handlebars.registerHelper('localizeDamage', function(damageType) {
    const damageMap = {
      'D': 'Draśnięcie',
      'L': 'Lekka',
      'C': 'Ciężka', 
      'K': 'Krytyczna',
      'sD': 'Siniak (D)',
      'sL': 'Siniak (L)',
      'sC': 'Siniak (C)',
      'sK': 'Siniak (K)'
    };
    return damageMap[damageType] || damageType;
  });

  // Helper for weapon type check
  Handlebars.registerHelper('isWeaponType', function(itemType, weaponType) {
    return itemType === weaponType;
  });

  // Only register if not already exists  
  if (!Handlebars.helpers.gte) {
    Handlebars.registerHelper('gte', function(a, b) {
      return a >= b;
    });
  }

  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper('eq', function(a, b) {
      return a === b;
    });
  }

  if (!Handlebars.helpers.checked) {
    Handlebars.registerHelper('checked', function(value) {
      return value ? 'checked' : '';
    });
  }

  // Helper for joining arrays
  Handlebars.registerHelper('join', function(array, separator) {
    if (!Array.isArray(array)) return '';
    return array.join(separator || ', ');
  });

  // Helper for wound location names
  Handlebars.registerHelper('getLocationName', function(location) {
    const names = {
      "head": "Głowa",
      "torso": "Tors", 
      "hands": "Ręce",
      "legs": "Nogi",
      "leftArm": "Lewa Ręka",
      "rightArm": "Prawa Ręka",
      "leftLeg": "Lewa Noga",
      "rightLeg": "Prawa Noga",
      "other": "Inne"
    };
    return names[location] || location;
  });

  // Helper for wound type names with tooltips
  Handlebars.registerHelper('getWoundTypeName', function(type) {
    const types = {
      "D": { short: "D", full: "Draśnięcie", class: "wound-type-scratch" },
      "L": { short: "L", full: "Lekkie", class: "wound-type-light" },
      "C": { short: "C", full: "Ciężkie", class: "wound-type-heavy" },
      "K": { short: "K", full: "Krytyczne", class: "wound-type-critical" }
    };
    
    const typeInfo = types[type];
    if (typeInfo) {
      return new Handlebars.SafeString(`<span class="wound-type ${typeInfo.class}" title="${typeInfo.full}">${typeInfo.short}</span>`);
    }
    return type;
  });

  // Helper for armor total (for Warhammer-style display)
  Handlebars.registerHelper('getArmorTotal', function(value) {
    return value || 0;
  });

  // Helper for calculating current AP (protection - damageAP)
  Handlebars.registerHelper('getCurrentAP', function(item, location) {
    const protection = item.system.protection[location] || 0;
    const damage = item.system.damageAP?.[location] || 0;
    return Math.max(0, protection - damage);
  });

  // Helper for calculating current durability (max - damage)
  Handlebars.registerHelper('getCurrentDurability', function(item) {
    const max = item.system.durability?.max || 0;
    const damage = item.system.damageDurability || 0;
    return Math.max(0, max - damage);
  });

  // Helper to check if armor protects a location
  Handlebars.registerHelper('protectsLocation', function(item, location) {
    return (item.system.protection[location] || 0) > 0;
  });
}