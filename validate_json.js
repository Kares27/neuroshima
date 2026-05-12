var fs = require('fs');
['lang/en.json','lang/pl.json'].forEach(function(f) {
  try {
    JSON.parse(fs.readFileSync(f,'utf8'));
    console.log(f + ': valid');
  } catch(e) {
    console.log(f + ': INVALID - ' + e.message);
  }
});
