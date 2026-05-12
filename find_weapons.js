var fs=require('fs');
var c=fs.readFileSync('system.js','utf8');
var lines = c.split('\n');
lines.forEach(function(l,i){
  if(l.indexOf('registerMenu')>-1||l.indexOf('EncumbranceConfig')>-1||l.indexOf('register(')>-1){
    console.log((i+1)+': '+l.trim());
  }
});
