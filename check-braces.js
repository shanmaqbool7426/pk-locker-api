const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\Shan Maqbool\\AndroidStudioProjects\\PKlocker\\app\\src\\main\\java\\com\\example\\pklocker\\ui\\devices\\DeviceListScreen.kt', 'utf-8');

let depth = 0;
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    if (line[j] === '{') depth++;
    else if (line[j] === '}') depth--;
  }
  if (depth < 0) {
    console.log(`EXTRA CLOSING BRACE AT LINE ${i + 1}`);
  }
}
console.log(`Final depth: ${depth}`);
