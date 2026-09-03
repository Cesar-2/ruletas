const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json','utf8'));
p.scripts = p.scripts || {};
p.scripts.dev = 'ts-node-dev --respawn --transpile-only src/server.ts';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2));
console.log('ok');
