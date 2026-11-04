import { readFileSync } from 'node:fs';
const i = JSON.parse(readFileSync('src/data/buxori-index.json', 'utf8'));
const roots = Object.values(i.roots.entries);
console.log(JSON.stringify({
  missingPresentStems: roots.filter(e => e.verb && !e.verb.presentStem).map(e => ({lemma:e.lemma.text,compound:e.verb.compound,source:e.sources})),
  conflicts: roots.filter(e => e.verb?.conflicts).map(e => ({lemma:e.lemma.text,conflicts:e.verb.conflicts})),
  reviewRows: [...new Set(roots.flatMap(e => e.sources.filter(s => s.review).map(s => s.row)))],
  untranslatedExamples: Object.values(i.examples).filter(e => e.en === null).length,
  excluded: i.excluded
}, null, 2));
