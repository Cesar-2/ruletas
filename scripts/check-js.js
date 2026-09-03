const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
if (!match) throw new Error('No script tag found');
new Function(match[1]);
console.log('script ok');
