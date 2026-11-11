/*
 * Worksheets for a speaker of Buxori to fill in (translator/data/linguist/). Everything in
 * them is taken from the compiled index and from what the engine currently outputs, so
 * the linguist confirms or corrects specific forms instead of answering open questions.
 *
 *   node scripts/linguist-worksheets.ts
 *
 * The worksheets are inputs for a person. Nothing reads them back automatically: answers
 * are reviewed and then entered into the TSV / tests by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine } from '../src/engine/engine.ts';
import type { BuxoriIndex, PersonNumber, RootEntry, Tense } from '../src/lib/types.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'translator/data/linguist');
const index = JSON.parse(readFileSync(resolve(ROOT, 'src/data/buxori-index.json'), 'utf8')) as BuxoriIndex;
const engine = new Engine(index);
const roots = Object.values(index.roots.entries);
const tsv = (name: string, header: string[], rows: (string | number)[][]) => {
  writeFileSync(resolve(OUT, name), [header, ...rows].map((r) => r.map((c) => String(c).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n') + '\n');
  console.log(`${name}: ${rows.length} rows`);
};
const rowsOf = (e: RootEntry) => e.sources.map((s) => s.row).filter((r) => r < 100000).slice(0, 3).join(', ');

// ── 2. One English word, several Buxori words: which is the everyday default? ──
{
  const out: (string | number)[][] = [];
  for (const [gloss, ids] of Object.entries(index.roots.byGloss).sort()) {
    const es = ids.map((id) => index.roots.entries[id]).filter((e): e is RootEntry => !!e);
    const byPos = new Map<string, RootEntry[]>();
    for (const e of es) byPos.set(e.pos, [...(byPos.get(e.pos) ?? []), e]);
    for (const [pos, group] of byPos) {
      if (new Set(group.map((e) => e.lemma.key)).size < 2) continue;      // the choice is only real within one part of speech
      const picked = engine.lex.roots(gloss, pos as RootEntry['pos'])[0];
      out.push([gloss, pos, group.map((e) => `${e.lemma.text} (${e.glosses.map((g) => g.text).join('; ')}; TSV ${rowsOf(e)})`).join('  |  '), picked?.lemma.text ?? '', '', '']);
    }
  }
  tsv('2-word-choice.tsv', ['english', 'part_of_speech', 'buxori_words_in_the_book', 'translator_currently_picks', 'EVERYDAY_DEFAULT (fill in)', 'WHEN_TO_USE_THE_OTHERS (fill in: formal / Hebrew-origin / regional / different meaning …)'], out);
}

// ── 3. Verbs: five forms each that decide the whole conjugation ───────────────
{
  const FORMS: [string, Tense, PersonNumber, boolean][] = [
    ['I … (present)', 'present', '1sg', false], ['he/she … (present)', 'present', '3sg', false], ['they … (present)', 'present', '3pl', false],
    ['I don’t … (present)', 'present', '1sg', true], ['…! (command to one person)', 'imperative', '2sg', false],
    ['he/she …ed (past)', 'simple_past', '3sg', false], ['I am …ing (now)', 'present_continuous', '1sg', false],
  ];
  const out: (string | number)[][] = [];
  const verbs = roots.filter((e) => e.verb && !e.lemma.key.includes(' '))
    .sort((a, b) => Number(!!b.verb!.irregular) - Number(!!a.verb!.irregular) || a.lemma.key.localeCompare(b.lemma.key));
  for (const v of verbs) {
    const printed = (index.roots.verbForms[v.id] ?? []).length;
    for (const [label, tense, pn, negative] of FORMS) {
      let built = '';
      try { built = engine.morph.conjugate(v, tense, pn, { negative })?.text ?? ''; } catch { built = ''; }
      const attested = (index.roots.verbForms[v.id] ?? []).some((f) => f.tense === tense && f.pn === pn && f.negative === negative && f.form.toLowerCase() === built.toLowerCase());
      if (attested) continue;                                              // printed in the book: nothing to ask
      out.push([v.lemma.text, v.glosses[0]?.text ?? '', v.verb!.irregular ? 'irregular' : 'regular', printed ? 'partly' : 'no', label, built || '(could not build)', '', '']);
    }
  }
  tsv('3-verb-forms.tsv', ['infinitive', 'english', 'book_says', 'conjugation_table_printed', 'form', 'translator_builds (everyday / Regular register)', 'CORRECT? (y / n)', 'IF_NOT: the form you would say'], out);
}

// ── 4. Judge what the translator outputs today ───────────────────────────────
{
  const sentences = `I am happy|I'm very happy|I'm hungry|I am not hungry|I don't know|Don't go|I can't go|You are my friend|That is good|What is your name?|Where is my book?
I love you|Thank you|How are you?|Are you ok?|We are happy|He is sad|She is very beautiful|They are my friends|I want water|I want to eat|Good night|I am at home|It is cold
I like tea|My name is David|I have a brother|I don't have money|I can go|I have to go|I must go|I want to go|I don't want to eat|Who are you?|a very big house|He is here|I am here
He was at home|Where were you?|I go home|We bought bread|They buy|my book|three books|my brothers|the big house|I live in Israel now|Where are you from?|I want to buy bread
I know that he came|He said that he is sick|If you go, I go|If he comes, I will go|When I came home, he was reading|He came because he is sick|I did not go because I was sick
He is a doctor|I am a doctor|He was a doctor|The book is here|He is not here|I went|We didn't give|You used to go|He is talking|I had said|They don't work|He has six books
Where do you live?|What do you do?|Do you have a book?|I read this book|I bought bread yesterday|I have three brothers|My father is not a doctor|This is my book|My book is big
He is going|We are going|I am reading|She is reading a book|I will go tomorrow|He doesn't know|I don't have|They have|I know|I took|I became happy|Come!|Sit!|Give me the book
I see you|He sees me|I gave him the book|We went to the house|They came from Bukhara|I am from Bukhara|He is my brother|She is my sister|This is my mother|I have two sisters
The bread is good|The water is cold|The house is big|My friend is here|Good evening|Happy New Year|How much money do you have?|I am tired|I am sick|He is hungry`.split(/[|\n]/).map((x) => x.trim()).filter(Boolean);
  const out: (string | number)[][] = [];
  for (const en of sentences) {
    const r = engine.translate(en);
    const shown = r.variants.length ? r.variants.map((v) => `${v.text} (${v.register})`).join('  /  ') : r.text ?? r.hint?.text ?? '';
    out.push([en, shown || '(no translation)', r.status === 'exact' ? 'printed in the book' : r.text ? `built, ${r.tier} confidence` : r.hint ? 'draft only' : 'none', r.unknown.join(', ') || engine.unknownWords(en).join(', '), '', '']);
  }
  tsv('4-judge-these.tsv', ['english', 'translator_output', 'how_it_was_made', 'english_words_missing_from_the_book', 'VERDICT (right / acceptable / wrong)', 'WHAT_YOU_WOULD_SAY (everyday speech)'], out);
}

// ── 5. Everyday phrases the book does not print ──────────────────────────────
{
  const phrases = `Good morning|Good afternoon|Good evening|Good night|Goodbye|See you tomorrow|See you later|Welcome|Please|Thank you very much|You're welcome|Excuse me|I'm sorry|No problem
How are you?|I'm fine|And you?|What's new?|Nice to meet you|What is your name?|My name is …|Where are you from?|How old are you?|Do you speak Bukhori?|I don't understand|Please repeat|Speak slowly
Yes|No|Maybe|Of course|I don't know|I think so|Let's go|Come here|Sit down|Wait|Be careful|Help!|Happy birthday|Happy New Year|Happy holiday|Congratulations|Good luck|Bon appetit|Cheers|To life!
Get well soon|My condolences|God willing|Thank God|God forbid|Bless you|I love you|I miss you|I'm hungry|I'm thirsty|I'm tired|How much is it?|What time is it?|Where is the bathroom?|Call me`.split(/[|\n]/).map((x) => x.trim()).filter(Boolean);
  const out = phrases.map((en) => {
    const r = engine.translate(en.replace(' …', ''));
    return [en, r.status === 'exact' ? r.variants.map((v) => v.text).join(' / ') || r.text! : '', r.status === 'exact' ? 'yes' : 'no', '', '', ''];
  });
  tsv('5-everyday-phrases.tsv', ['english', 'book_has', 'printed_in_book', 'BUXORI (fill in, or confirm the book’s)', 'INFORMAL / FORMAL variants if they differ', 'NOTES (when it is said)'], out);
}
