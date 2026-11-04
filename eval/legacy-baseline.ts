/* One-off: score the legacy engine (translator/engine.js + index_train.json,
 * built from the same split) on the frozen set. Output committed as
 * eval/baseline-legacy.json so the comparison survives the legacy code's removal. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate, type TestSet } from './metrics.ts';
const require = createRequire(import.meta.url);
const Engine = require('../translator/engine.js');
const set = JSON.parse(readFileSync(new URL('./testset.json', import.meta.url), 'utf8')) as TestSet;
const eng = new Engine(JSON.parse(readFileSync(new URL('../translator/data/index_train.json', import.meta.url), 'utf8')));
const { report, rows } = evaluate('legacy engine.js (index_train.json)', set, (en) => { const r = eng.translate(en); return { bux: r.bux ?? null, status: r.status }; });
writeFileSync(new URL('./baseline-legacy.json', import.meta.url), JSON.stringify({ report, predictions: rows.map((r) => ({ en: r.en, bux: r.pred.bux, status: r.pred.status, ok: r.ok })) }, null, 1));
console.log(JSON.stringify(report, null, 1));
