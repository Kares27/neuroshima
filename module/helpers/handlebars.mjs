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

  if (!Handlebars.helpers.ne) {
    Handlebars.registerHelper('ne', function(a, b) {
      return a != b;
    });
  }

  if (!Handlebars.helpers.gt) {
    Handlebars.registerHelper('gt', function(a, b) {
      return a > b;
    });
  }

  if (!Handlebars.helpers.lt) {
    Handlebars.registerHelper('lt', function(a, b) {
      return a < b;
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

  // Helper for math operations (used in difficulty value calculations)
  if (!Handlebars.helpers.math) {
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
      return Math.max(1, result);
    });
  }

  // Helper to check if character is specialized in a category
  if (!Handlebars.helpers.isSpecialized) {
    Handlebars.registerHelper('isSpecialized', function(specializations, category) {
      return specializations?.categories?.[category] || false;
    });
  }

  // Helper to get CSS class for specialized categories
  if (!Handlebars.helpers.specializationClass) {
    Handlebars.registerHelper('specializationClass', function(specializations, category) {
      return (specializations?.categories?.[category]) ? 'specialized' : '';
    });
  }

  // Helper for calculating difficulty values in threshold tables
  if (!Handlebars.helpers.difficultyValue) {
    Handlebars.registerHelper('difficultyValue', function(attributeValue, attributeMod, difficultyMod) {
      const result = (attributeValue || 0) + (attributeMod || 0) + difficultyMod;
      return result;
    });
  }

  // Helper for translating beast action types
  if (!Handlebars.helpers.getActionTypeName) {
    Handlebars.registerHelper('getActionTypeName', function(actionType) {
      const types = {
        'attack': 'Atak',
        'defense': 'Obrona',
        'special': 'Specjalna',
        'movement': 'Ruch'
      };
      return types[actionType] || actionType;
    });
  }

  // Helper to check if effects object has any items
  if (!Handlebars.helpers.anyEffects) {
    Handlebars.registerHelper('anyEffects', function(effects) {
      if (!effects || typeof effects !== 'object') return false;
      for (const category of Object.values(effects)) {
        if (category.effects && Array.isArray(category.effects) && category.effects.length > 0) {
          return true;
        }
      }
      return false;
    });
  }
}