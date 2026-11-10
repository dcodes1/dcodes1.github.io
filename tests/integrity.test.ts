/*
 * Integrity checks on src/data/buxori-index.json (run `npm run compile` first).
 * Re-reads the TSV itself, so it does not trust the compiler's own bookkeeping.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readTsv } from '../scripts/lib/tsv.ts';
import { canonicalKey, foldTsvStress, senses } from '../src/lib/normalizer.ts';
import type { Affix, BuxoriIndex, RootEntry, SourceRef, SyntaxRule, TemplatePart } from '../src/lib/types.ts';

const ROOT = resolve(import.meta.dirname, '..');
const idx = JSON.parse(readFileSync(resolve(ROOT, 'src/data/buxori-index.json'), 'utf8')) as BuxoriIndex;
const { rows } = readTsv(resolve(ROOT, 'translator/data/bukhori.tsv'));
const buxKey = (s: string) => canonicalKey(foldTsvStress(s));

// Each check becomes its own vitest case (collected here, asserted at the bottom).
const results: [name: string, ok: boolean, detail: string][] = [];
function check(name: string, cond: boolean, detail?: unknown) {
  results.push([name, cond, detail === undefined ? '' : (JSON.stringify(detail) ?? '').slice(0, 300)]);
}
const roots = Object.values(idx.roots.entries);
const affix = (id: string) => idx.affixes.entries[id as keyof typeof idx.affixes.entries] as Affix | undefined;
const rootsFor = (k: string) => (idx.roots.byKey[k as keyof typeof idx.roots.byKey] ?? []).map((id) => idx.roots.entries[id]!);
const verb = (k: string) => rootsFor(k).find((r) => r.verb) as RootEntry | undefined;
const rule = (id: string) => idx.syntaxRules.find((r) => r.id === id);

// ── 1. Every TSV row is accounted for exactly once ──────────────────────────
const where = new Map<number, Set<string>>();
const mark = (s: SourceRef | undefined, d: string) => { if (s) (where.get(s.row) ?? where.set(s.row, new Set()).get(s.row)!).add(d); };
for (const r of roots) for (const s of r.sources) mark(s, 'root');
for (const list of Object.values(idx.roots.inflected)) for (const e of list) mark(e.source, 'inflected');
for (const a of Object.values(idx.affixes.entries)) for (const al of a.allomorphs) for (const s of al.sources) {
  // attested -ba cites example rows as evidence; those rows' home is `examples`
  if (al.evidence !== 'attested') mark(s, 'affix');
}
for (const p of Object.values(idx.affixes.paradigms)) for (const s of p.sources) if (!where.get(s.row)?.has('affix')) mark(s, 'paradigm');
for (const r of idx.syntaxRules) for (const s of r.sources) mark(s, 'rule');
for (const e of Object.values(idx.examples)) mark(e.source, 'example');
for (const x of idx.excluded) mark({ row: x.row } as SourceRef, 'excluded');
const unaccounted = rows.filter((r) => !where.has(r.row)).map((r) => r.row);
check('every TSV row is accounted for', unaccounted.length === 0, unaccounted.slice(0, 15));
const excludedAndUsed = idx.excluded.filter((x) => (where.get(x.row)?.size ?? 0) > 1).map((x) => x.row);
check('no excluded row is also used elsewhere', excludedAndUsed.length === 0, excludedAndUsed);
check('meta row count matches TSV', idx.meta.source.rows === rows.length);
check('grammar rows all became rules', rows.filter((r) => r.entryType === 'grammar').every((r) => where.get(r.row)?.has('rule')));

// ── 2. Policy (owner decisions) ─────────────────────────────────────────────
check('default register is regular', idx.policy.defaultRegister === 'regular');
check('evidence precedence stated > attested > derived > borrowed', idx.policy.evidencePrecedence.join() === 'stated,attested,derived,borrowed');

// ── 3. Verbs ────────────────────────────────────────────────────────────────
const raftan = verb('raftan');
check('raftan present stem rav (stated)', raftan?.verb?.presentStem?.text === 'rav' && raftan.verb.presentStem.evidence === 'stated', raftan?.verb);
check('raftan past stem raft', raftan?.verb?.pastStem.text === 'raft', raftan?.verb?.pastStem);
check('raftan is irregular', raftan?.verb?.irregular === true);
const shudan = verb('shudan');
// The row that printed the present stem as -shud- is flagged REVIEW and no longer used.
check('shudan present stem is -shav- (the REVIEW row saying -shud- is excluded)', shudan?.verb?.presentStem?.text === 'shav' && !shudan?.verb?.conflicts?.length, shudan?.verb);
check('doshtan takes no me-', verb('doshtan')?.verb?.takesMe === false);
check('kardan present stem kun', verb('kardan')?.verb?.presentStem?.text === 'kun');
const zk = verb('zindagi kardan');
check('zindagi kardan is a nominal compound on kardan', zk?.verb?.compound?.preverb === 'zindagi' && idx.roots.entries[zk.verb.compound.auxiliary]?.lemma.key === 'kardan', zk?.verb);
check('compound present stem derived from auxiliary', zk?.verb?.presentStem?.text === 'kun' && zk.verb.presentStem.evidence === 'derived');
check('dodan literary stem dih', verb('dodan')?.verb?.literaryPresentStem?.text === 'dih');
check('byStem rav → raftan', (idx.roots.byStem['rav'] ?? []).some((x) => idx.roots.entries[x.root]?.lemma.key === 'raftan' && x.stem === 'present'));
check('byStem raft → raftan (past)', (idx.roots.byStem['raft'] ?? []).some((x) => idx.roots.entries[x.root]?.lemma.key === 'raftan' && x.stem === 'past'));
check('verb glosses indexed with and without "to"', (idx.roots.byGloss['go' as never] ?? []).length > 0 && (idx.roots.byGloss['to go' as never] ?? []).length > 0);

// ── 4. Affixes ──────────────────────────────────────────────────────────────
const obj = affix('obj');
const al = (a: Affix | undefined, form: string) => a?.allomorphs.find((x) => x.form === form);
check('object -a after consonant (stated, regular)', al(obj, '-a')?.environment.kind === 'after_consonant' && al(obj, '-a')?.evidence === 'stated' && al(obj, '-a')?.register === 'regular');
check('object -ya after vowel (stated)', al(obj, '-ya')?.environment.kind === 'after_vowel' && al(obj, '-ya')?.evidence === 'stated');
check('object -ro is literal, pronounced -a', al(obj, '-ro')?.register === 'literal' && /-a/.test(al(obj, '-ro')?.pronounced ?? ''));
check('object -ra is BORROWED from Tajik with a citation', al(obj, '-ra')?.evidence === 'borrowed' && al(obj, '-ra')?.borrowed?.from === 'tajik' && (al(obj, '-ra')?.borrowed?.citations.length ?? 0) > 0);
const ba = affix('dir.ba');
check('-ba is ATTESTED with example evidence', ba?.evidence === 'attested' && (ba.examples?.length ?? 0) >= 5, ba?.examples?.length);
check('-ba evidence rows are real sentences', (ba?.examples ?? []).every((e) => /ba\b/i.test(idx.examples[e]?.bux ?? '')));
const da = affix('loc.da');
check('locative -da is BORROWED, 2 citations, no TSV sources', da?.evidence === 'borrowed' && al(da, '-da')?.borrowed?.citations.length === 2 && al(da, '-da')?.sources.length === 0);
check('sentence particle -da kept separate from locative -da', affix('prt.da')?.category === 'sentence_particle' && (idx.affixes.byForm['da'] ?? []).length === 2);
const ez = affix('ezafe');
check('ezafe -i / -yi', al(ez, '-i')?.environment.kind === 'after_consonant' && al(ez, '-yi')?.environment.kind === 'after_vowel');
const ezafeRows = rows.filter((r) => r.entryType === 'vocab' && r.bukhori.startsWith('-')).map((r) => r.row);
check('the six "-i man…" vocab rows are ezafe sources, not roots', ezafeRows.length === 6 && ezafeRows.every((n) => al(ez, '-i')!.sources.some((s) => s.row === n)) && !roots.some((r) => r.lemma.text.startsWith('-')));
check('pref.me / neg.na / mood.bi / neg.ma prefixes', ['pref.me', 'neg.na', 'mood.bi', 'neg.ma'].every((i) => affix(i)?.position === 'prefix'));
check('mood.bi is poetic register', al(affix('mood.bi'), 'bi-')?.register === 'poetic');
check('plural -ho and literary -on/-yon', !!al(affix('pl.ho'), '-ho') && !!al(affix('pl.on'), '-on') && al(affix('pl.on'), '-yon')?.environment.kind === 'after_vowel');
check('possessive 1sg -am after consonant', al(affix('poss.1sg'), '-am')?.environment.kind === 'after_consonant');
check('possessive 1sg -im after a/i stem (drop vowel)', (() => { const x = al(affix('poss.1sg'), '-im'); return x?.environment.kind === 'after_vowel' && !!x.environment.dropFinalVowel; })());
check('possessive literal -yam', al(affix('poss.1sg'), '-yam')?.register === 'literal');
check('present 1pl -em pronounced -im', al(affix('end.present.1pl'), '-em')?.pronounced === '-im');
check('present 2pol -ed pronounced -et', al(affix('end.present.2pol'), '-ed')?.pronounced === '-et');
check('irregular present 1sg -um', !!al(affix('end.present.irr.1sg'), '-um'));
check('simple past 3sg Literal = zero ending', al(affix('end.simple_past.3sg'), '')?.register === 'literal');
check('classifier -ta + t-merge allomorph', al(affix('cls.ta'), '-a')?.environment.kind === 'after_segment');
check('derivational -chi / -jon / ham-', !!affix('der.chi') && !!affix('der.jon') && affix('der.ham')?.position === 'prefix');
for (const a of Object.values(idx.affixes.entries)) for (const x of a.allomorphs) {
  if (x.evidence === 'borrowed') check(`borrowed ${a.id} ${x.form} has citations`, (x.borrowed?.citations.length ?? 0) > 0 && x.sources.length === 0);
  else check(`${a.id} ${x.form || '∅'} has a TSV source`, x.sources.length > 0);
}

// ── 5. Paradigms ────────────────────────────────────────────────────────────
const kp = idx.affixes.paradigms['kardan.simple.past' as never];
check('kardan simple past 3sg prints both forms', JSON.stringify(kp?.fullForms?.['3sg']) === '["Ü kardak","kard"]', kp?.fullForms);
const cellIds = Object.values(idx.affixes.paradigms).flatMap((p) => Object.values(p.cells).flat());
check('every paradigm cell points to a real affix', cellIds.every((id) => !!affix(id)), cellIds.filter((id) => !affix(id)));

// ── 6. Rules ────────────────────────────────────────────────────────────────
const wo = rule('word_order');
check('word order: subject first, verb last, verbFinal', wo?.kind === 'word_order' && wo.verbFinal && JSON.stringify(wo.order[0]) === '{"role":"subject"}' && JSON.stringify(wo.order.at(-1)) === '{"role":"verb"}');
const cop = idx.syntaxRules.find((r) => r.kind === 'copula');
check('copula hast / nest, droppable', cop?.kind === 'copula' && cop.affirmative === 'hast' && cop.negative === 'nest' && cop.droppable);
check('three adposition rules (qati after, qatori/bo before)', idx.syntaxRules.filter((r) => r.kind === 'adposition').map((r) => r.kind === 'adposition' ? `${r.form}:${r.placement}` : '').sort().join() === 'bo:before,qati:after,qatori:before');
const pres = rule('simple_present_formation');
check('simple present = me- + present stem + ending, negation before me-', pres?.kind === 'verb_form' && pres.template.length === 3 && pres.negation?.placement === 'before_me');
check('compound verb rule lists auxiliaries', idx.syntaxRules.some((r) => r.kind === 'compound_verb' && r.auxiliaries.length >= 4));
const passive = rule('passive_voice');
check('passive = past participle + shudan + ending', passive?.kind === 'construction' && passive.template.some((p) => 'lexeme' in p && p.text === 'shudan'));
const refs = (t: TemplatePart[]): TemplatePart[] => t.flatMap((p) => ('optional' in p ? refs([p.optional]) : [p]));
const allParts = idx.syntaxRules.flatMap((r: SyntaxRule) => ('template' in r ? refs(r.template) : 'order' in r ? refs(r.order) : []));
check('every template affix exists', allParts.every((p) => !('affix' in p) || !!affix(p.affix)));
check('every template lexeme exists', allParts.every((p) => !('lexeme' in p) || !!idx.roots.entries[p.lexeme]));
check('rules link examples (direct object marker)', (rule('direct_object_marker')?.examples.length ?? 0) > 0);

// ── 7. Data hygiene ─────────────────────────────────────────────────────────
check('"sentence 1" is not an English gloss', !idx.roots.byGloss['sentence 1' as never] && !Object.keys(idx.roots.byGloss).some((k) => /^(sentence|line) \d/.test(k)));
check('placeholder rows are Buxori-only examples (en = null)', idx.examples['e1081' as never]?.en === null && idx.examples['e1081' as never]?.bux === 'Nomam Hayim.');
const heb = Object.values(idx.examples).filter((e) => e.language === 'hebrew');
check('4 Hebrew piyyut lines tagged hebrew', heb.length === 4);
check('no example has a placeholder English text', Object.values(idx.examples).every((e) => e.en === null || !/^(sentence|line)\s*\d/i.test(e.en)));
check('all keys normalized', roots.every((r) => r.lemma.key === buxKey(r.lemma.text) && r.forms.every((f) => f.key === buxKey(f.text))));
check('stress acutes folded, ü kept', buxKey('barodár') === 'barodar' && buxKey("Sholüm!") === 'sholüm' && buxKey("'Amak") === "'amak");
check('every root has a gloss', roots.every((r) => r.glosses.length > 0), roots.filter((r) => !r.glosses.length).map((r) => r.lemma.text));
check('index pointers resolve', [...Object.values(idx.roots.byKey), ...Object.values(idx.roots.byGloss)].flat().every((id) => !!idx.roots.entries[id]));
check('inflected onayam → base ona, possessive affix', (() => { const e = idx.roots.inflected['onayam' as never]?.[0]; return e?.baseText === 'ona' && e.affixes.some((a) => a.startsWith('poss.1sg')); })());
{
  const all = Object.values(idx.roots.inflected).flat();
  const unanalysed = all.filter((e) => !e.affixes.length);
  check('every inflected headword analysed', unanalysed.length === 0, unanalysed.map((e) => e.text));
  const first = (k: string) => idx.roots.inflected[k as never]?.[0]?.affixes ?? [];
  check('vowel-stem possessive: bovom = bov(o) + -om', first('bovom').includes('poss.1sg' as never));
  check('analytic possession: hoveri man = hover + ezafe + man', first('hoveri man').includes('ezafe' as never));
}
check('inflected reachable from English ("my mom")', (idx.roots.inflectedByGloss['my mom' as never] ?? []).includes('onayam' as never));
check('Hebrew-origin alternates typed (yak → ehod)', rootsFor('yak').some((r) => r.forms.some((f) => f.text === 'ehod' && f.kind === 'hebrew_origin')));
check('literary alternates typed (Qati → bo)', rootsFor('qati').some((r) => r.forms.some((f) => f.text === 'bo' && f.kind === 'literary')));
check('bracket pronunciation split (Ganov alt "duzd [duz]")', rootsFor('ganov').some((r) => r.forms.some((f) => f.text === 'duzd') && r.forms.some((f) => f.text === 'duz' && f.kind === 'spoken')));
check('numeric fraction parsed', roots.some((r) => r.numeric?.kind === 'fraction'));
check('senses: numbered and slash expansion', senses('1. entrance; 2. income').length === 2 && senses('his/her grandmother').map((s) => s.text).join('|') === 'his grandmother|her grandmother');
{
  // REVIEW rows are used nowhere and are listed for the owner instead.
  const blob = JSON.stringify({ r: idx.roots, a: idx.affixes, e: idx.examples });
  check('no REVIEW-flagged row is used by the index', !/"review":true/.test(blob));
  const list = readFileSync(new URL('../translator/data/review-rows.tsv', import.meta.url), 'utf8').trim().split('\n');
  check('review-rows.tsv lists the 9 REVIEW rows', list.length === 10 && idx.excluded.filter((x) => x.reason === 'review_flag').length === 9, list.length);
  // No two examples carry the same English + Buxori.
  const seen = new Set<string>();
  const dups = Object.values(idx.examples).filter((e) => e.en && (seen.has(`${e.en.toLowerCase()}|${e.bux.toLowerCase()}`) || !seen.add(`${e.en.toLowerCase()}|${e.bux.toLowerCase()}`)));
  check('no duplicate example pairs', dups.length === 0, dups.map((e) => e.bux));
  // …and every Buxori word + part of speech is one root, however often the book repeats it.
  const rk = new Set<string>();
  check('no duplicate roots', roots.every((r) => !rk.has(`${r.lemma.key}|${r.pos}`) && !!rk.add(`${r.lemma.key}|${r.pos}`)));
}
const ex = idx.excluded.reduce<Record<string, number>>((m, x) => ((m[x.reason] = (m[x.reason] ?? 0) + 1), m), {});
check('excluded = 180 no_answer, 13 stubs, 11 not transcribed', ex['no_answer'] === 180 && ex['fill_in_stub'] === 13 && ex['not_transcribed'] === 11, ex);

describe('index integrity', () => {
  test.each(results)('%s', (_name, ok, detail) => {
    expect(ok, detail).toBe(true);
  });
});
