const fs = require('fs');

function extractJsonObjects(filePath) {
  const buf = fs.readFileSync(filePath);
  const text = buf.toString('latin1');
  const results = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{"_id"', i);
    if (start === -1) break;
    let depth = 0, j = start;
    while (j < text.length) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') {
        depth--;
        if (depth === 0) { j++; break; }
      }
      j++;
    }
    try {
      const obj = JSON.parse(text.slice(start, j));
      results.push(obj);
    } catch(e) {}
    i = start + 1;
  }
  return results;
}

const targetPath = process.argv[2];
const records = extractJsonObjects(targetPath);
console.log('Records found:', records.length);
records.forEach((r, idx) => {
  console.log(`\n--- [${idx}] ${r.name} (${r.type}) ---`);
  if (r.system?.scriptData || r.system?.scripts || r.effects?.length) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log('  (no scripts)');
  }
});
