const fs = require('fs');
['pl','en'].forEach(lang => {
  try {
    JSON.parse(fs.readFileSync(`H:/FOUNDRY DATA/Data/systems/neuroshima/lang/${lang}.json`, 'utf8'));
    console.log(lang + '.json: OK');
  } catch(e) {
    console.log(lang + '.json ERROR: ' + e.message);
  }
});
