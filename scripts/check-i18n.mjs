// Fails if en.json and so.json drift: missing keys, extra keys, or mismatched {placeholders}.
import { readFileSync } from 'node:fs';

const en = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'));
const so = JSON.parse(readFileSync('src/i18n/so.json', 'utf8'));
const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const problems = [];

for (const key of Object.keys(en)) {
  if (!(key in so)) problems.push(`so.json is missing "${key}"`);
  else if (vars(en[key]) !== vars(so[key])) problems.push(`"${key}" placeholders differ: en {${vars(en[key])}} vs so {${vars(so[key])}}`);
}
for (const key of Object.keys(so)) if (!(key in en)) problems.push(`so.json has unknown key "${key}"`);

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`i18n OK: ${Object.keys(en).length} strings in English and Somali`);
