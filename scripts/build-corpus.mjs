// Builds corpus/en-so.tsv: a parallel English → Somali corpus from
//   1. every UI string (src/i18n/en.json + so.json),
//   2. the hand-written vocabulary and sentences (corpus/vocabulary.tsv),
//   3. navigation templates expanded with real Mogadishu street names and distances.
// The output can train or evaluate a translation model, or seed a translation-memory tool.
import { readFileSync, writeFileSync } from 'node:fs';

const en = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'));
const so = JSON.parse(readFileSync('src/i18n/so.json', 'utf8'));
const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
const clean = text => text.replace(/[\t\n]/g, ' ');

const rows = [];
const add = (english, somali, type, domain, source) => rows.push([clean(english), clean(somali), type, domain, source]);

// 1. UI strings (placeholders kept so the corpus also documents the templates).
for (const [key, english] of Object.entries(en)) {
  if (!so[key] || key.startsWith('app.name')) continue;
  add(english, so[key], /\s/.test(english) ? (/[.?!]$/.test(english) ? 'sentence' : 'phrase') : 'word', key.split('.')[0], `ui:${key}`);
}

// 2. Vocabulary.
const vocab = readFileSync('corpus/vocabulary.tsv', 'utf8').trim().split(/\r?\n/).slice(1);
for (const line of vocab) {
  const [english, somali, type, domain] = line.split('\t');
  add(english, somali, type, domain, 'vocabulary');
}

// 3. Expanded navigation sentences.
const streets = ['Wadada Maka Al-Mukarama', 'Wadada Liido', 'Wadada Wadnaha', 'Wadada Afgooye', 'Wadada Sodonka', 'Wadada Industriyaalka'];
const distances = [[100, '100 meters', '100 mitir'], [300, '300 meters', '300 mitir'], [500, '500 meters', '500 mitir'], [1500, '1.5 kilometers', '1.5 kiiloomitir']];
const turns = ['turn.left', 'turn.right', 'turn.slightLeft', 'turn.slightRight', 'turn.sharpLeft', 'turn.sharpRight'];
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

for (const street of streets) {
  for (const turn of turns) {
    const e = fill(en['instr.turnOnto'], { turn: en[turn], street }), s = fill(so['instr.turnOnto'], { turn: so[turn], street });
    add(e, s, 'sentence', 'navigation', 'template:instr.turnOnto');
    for (const [, dEn, dSo] of distances.slice(0, 2)) {
      add(fill(en['instr.inDistance'], { distance: dEn, instruction: lower(e) }), fill(so['instr.inDistance'], { distance: dSo, instruction: lower(s) }),
        'sentence', 'navigation', 'template:instr.inDistance');
    }
  }
  add(fill(en['instr.continueOn'], { street }), fill(so['instr.continueOn'], { street }), 'sentence', 'navigation', 'template:instr.continueOn');
  for (let n = 1; n <= 4; n++) {
    add(fill(en['instr.roundaboutOnto'], { nth: en[`ordinal.${n}`], street }), fill(so['instr.roundaboutOnto'], { nth: so[`ordinal.${n}`], street }),
      'sentence', 'navigation', 'template:instr.roundaboutOnto');
  }
}
for (const dir of ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']) {
  add(fill(en['instr.depart'], { dir: en[`dir.${dir}`] }), fill(so['instr.depart'], { dir: so[`dir.${dir}`] }), 'sentence', 'navigation', 'template:instr.depart');
}
for (const n of [2, 3, 5, 10]) {
  add(fill(en['closure.reportedBy'], { n, ago: fill(en['time.minAgo'], { n: 4 }) }), fill(so['closure.reportedBy'], { n, ago: fill(so['time.minAgo'], { n: 4 }) }),
    'sentence', 'condition', 'template:closure.reportedBy');
}

// De-duplicate on the English side + Somali side.
const seen = new Set();
const unique = rows.filter(r => { const k = `${r[0]}\u0000${r[1]}`; if (seen.has(k)) return false; seen.add(k); return true; });
writeFileSync('corpus/en-so.tsv', ['english\tsomali\ttype\tdomain\tsource', ...unique.map(r => r.join('\t'))].join('\n') + '\n');
console.log(`corpus/en-so.tsv: ${unique.length} pairs`);
