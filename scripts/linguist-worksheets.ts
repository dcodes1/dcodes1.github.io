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

// ── 8. Grammar words: the closed classes every sentence needs ────────────────
{
  const GROUPS: [string, string][] = [
    ['subject pronouns', 'I|you (one person, informal)|you (one person, polite)|he|she|it|we|you (several people)|they'],
    ['object pronouns', 'me|you (object, informal)|you (object, polite)|him|her|it (object)|us|them'],
    ['"to / for" + pronoun', 'to me|to you|to him|to her|to us|to them|for me|for you|with me|with you|with him|from me|about me'],
    ['possessives', 'my|your (informal)|your (polite)|his|her|its|our|their|mine|yours|ours|theirs'],
    ['reflexive and reciprocal', 'myself|yourself|himself|herself|ourselves|themselves|each other|one another|own (my own house)'],
    ['demonstratives', 'this|that|these|those|this one|that one|here|there|over there|such|so (like this)|the same|other|another'],
    ['question words', 'who|whom|whose|what|which|where|where to|where from|when|why|how|how much|how many|how long|how old|what kind of|what time'],
    ['indefinites and negatives', 'someone|something|somewhere|sometime|somehow|anyone|anything|anywhere|no one|nothing|nowhere|never|everyone|everything|everywhere|always'],
    ['quantifiers', 'all|every|each|both|some|any|many|much|a lot of|few|a few|little|a little|several|enough|too much|more|most|less|least|no (no money)|none|half|whole|only|also|even'],
    ['prepositions of place', 'in|inside|on|on top of|under|below|above|over|behind|in front of|next to|beside|between|among|near|far from|around|opposite|outside|at (at the door)|at (someone’s house)'],
    ['prepositions of direction', 'to|towards|into|onto|from|out of|off|through|across|along|up|down|past|back'],
    ['other prepositions', 'with (together with)|with (using a tool)|without|for|about|of|by (written by)|like (similar to)|as|instead of|except|against|because of|according to|in spite of|thanks to'],
    ['prepositions of time', 'before|after|during|until|since|for (for two hours)|ago|in (in two days)|at (at five o’clock)|on (on Saturday)|by (by tomorrow)|from … to …'],
    ['conjunctions', 'and|or|but|however|because|so (therefore)|therefore|if|unless|although|even if|while|when|as soon as|before (before he came)|after (after he came)|until (until he comes)|since (since he came)|that|whether|than|as … as|either … or|neither … nor|both … and|not only … but also|in order to|so that'],
    ['particles and answers', 'yes|no|not|maybe|of course|please|thank you|well (well, …)|then|still|yet|already|just|only|too (too big)|very|quite|almost|really|again|together|alone|perhaps|certainly|exactly'],
    ['time words', 'now|today|tomorrow|yesterday|the day after tomorrow|the day before yesterday|tonight|this morning|this evening|this week|next week|last week|this year|next year|last year|early|late|soon|later|before (earlier)|then (at that time)|often|sometimes|rarely|usually|every day|once|twice|three times|at first|finally|suddenly|immediately|for a long time'],
    ['numbers and counting', 'zero|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|twentieth|hundredth|last|half|a quarter|one and a half|twice as much|a pair|a dozen|both|once more|number|percent'],
    ['"to be", "to have", existence', 'I am|you are|he is|we are|they are|I was|I will be|I am not|there is|there are|there is no|there was|I have|I don’t have|I had|is there?|it is (it is cold)|it is necessary|it is possible|it is forbidden'],
    ['modal words', 'can|cannot|could|must|must not|have to|don’t have to|should|may (permission)|might|want|need|let (let him go)|let’s|would like|be able to|know how to|try to|begin to|finish (doing)|continue to|stop (doing)'],
  ];
  const out: (string | number)[][] = [];
  for (const [group, items] of GROUPS) for (const en of items.split('|')) {
    const plain = en.replace(/\s*\([^)]*\)/g, '').replace(/[“”"]/g, '').trim();
    // keep the labels the engine understands: polite → shumo, several people → plural
    const label = /polite/.test(en) ? ' (polite)' : /several people/.test(en) ? ' (pl.)' : /informal/.test(en) ? ' (sing.)' : '';
    const r = engine.translate(plain + label);
    const formal = r.variants.find((v) => v.register === 'formal')?.text, informal = r.variants.find((v) => v.register === 'informal')?.text;
    const text = label && r.variants.length ? (/polite|several/.test(en) ? formal : informal) ?? r.text : r.variants.map((v) => v.text).join(' / ') || r.text;
    const has = !text ? '' : r.status === 'exact' ? text : `${text} (built by rule)`;
    out.push([group, en, has, '', '']);
  }
  tsv('8-grammar-words.tsv', ['group', 'english', 'translator_has', 'BUXORI (fill in, or confirm / correct)', 'NOTES (position in the sentence, suffix or separate word, formal variant)'], out);
}

// ── 9. Vocabulary by topic, beyond the frequency list ─────────────────────────
{
  const TOPICS: [string, string][] = [
    ['family', 'husband|wife|son|daughter|parents|grandson|granddaughter|nephew|niece|cousin|twin|relative|ancestor|widow|orphan|bride|groom|wedding|engagement|birth|funeral|neighbor|guest|host|stranger|baby|teenager|adult|old man|old woman'],
    ['body and health', 'head|face|eye|ear|nose|mouth|lip|tooth|tongue|neck|throat|shoulder|arm|elbow|hand|finger|nail|chest|back|stomach|heart|lung|liver|kidney|bone|blood|skin|leg|knee|foot|toe|hair|beard|pain|fever|cough|cold (illness)|wound|medicine|pill|hospital|nurse|pharmacy|pregnant|healthy|blind|deaf|to breathe|to hurt|to heal|to faint|to vomit|to sweat'],
    ['food and cooking', 'breakfast|lunch|dinner|bread|rice|meat|beef|lamb|chicken|fish|egg|milk|cheese|butter|yogurt|oil|salt|pepper|sugar|honey|flour|soup|salad|onion|garlic|carrot|potato|tomato|cucumber|cabbage|eggplant|pumpkin|apple|pear|grape|melon|watermelon|pomegranate|apricot|peach|cherry|fig|lemon|nut|almond|raisin|tea|coffee|wine|juice|spoon|fork|knife|plate|bowl|cup|glass|pot|pan|oven|to cook|to boil|to fry|to bake|to cut|to peel|to pour|to taste|to chew|to swallow|hungry|thirsty|delicious|spicy|sour|sweet|bitter|fresh|rotten'],
    ['house and things', 'house|room|kitchen|bedroom|bathroom|toilet|roof|wall|floor|ceiling|door|window|stairs|yard|garden|gate|key|lock|bed|pillow|blanket|sheet|table|chair|shelf|cupboard|carpet|curtain|mirror|lamp|candle|stove|refrigerator|soap|towel|broom|bucket|needle|thread|scissors|hammer|nail|rope|box|bag|basket|bottle|to clean|to sweep|to wash|to build|to repair|to rent'],
    ['clothing', 'shirt|trousers|dress|skirt|coat|jacket|hat|scarf|gloves|socks|shoes|boots|belt|button|pocket|ring|earring|necklace|bracelet|watch|glasses|umbrella|to wear|to put on|to take off|to sew|to iron'],
    ['nature and weather', 'sun|moon|star|sky|cloud|rain|snow|wind|storm|thunder|lightning|fog|ice|heat|shade|earth|stone|sand|dust|mud|mountain|hill|valley|river|lake|sea|desert|forest|field|tree|leaf|flower|grass|root|seed|fire|smoke|ash|spring|summer|autumn|winter|hot|cold|warm|cool|wet|dry|to rain|to snow|to blow|to shine|to freeze|to melt|to grow|to burn'],
    ['animals', 'dog|cat|horse|donkey|cow|bull|sheep|goat|camel|pig|chicken|rooster|duck|goose|pigeon|sparrow|eagle|crow|mouse|rat|rabbit|fox|wolf|bear|lion|snake|frog|fish|fly|mosquito|bee|ant|spider|butterfly|worm|tail|wing|horn|feather|nest|egg|to bark|to bite|to fly|to swim|to hunt'],
    ['time and calendar', 'second|minute|hour|day|night|morning|noon|afternoon|evening|midnight|week|month|year|century|date|birthday|holiday|weekend|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|clock|calendar|season|age|past|future|beginning|end'],
    ['religion and community', 'God|prayer|blessing|synagogue|rabbi|Torah|Sabbath|holiday|Passover|Rosh Hashanah|Yom Kippur|Sukkot|Hanukkah|Purim|fast|kosher|charity|commandment|sin|soul|heaven|miracle|holy|cemetery|grave|mourning|memorial|circumcision|bar mitzvah|matchmaker|dowry|community|elder|custom|tradition|to pray|to bless|to fast|to believe|to forgive|to mourn'],
    ['people, feelings, character', 'friend|enemy|child|boy|girl|man|woman|person|people|name|life|death|love|hate|fear|hope|joy|sadness|anger|shame|pride|envy|surprise|worry|patience|respect|trust|truth|lie|secret|dream|memory|thought|idea|happy|sad|angry|afraid|tired|bored|lonely|proud|ashamed|jealous|kind|cruel|honest|lazy|clever|stupid|brave|shy|generous|stingy|polite|rude|stubborn|to love|to hate|to fear|to hope|to laugh|to cry|to smile|to worry|to miss|to remember|to forget|to dream'],
    ['work, school, money', 'work|job|profession|teacher|student|doctor|merchant|tailor|shoemaker|barber|baker|butcher|farmer|driver|soldier|judge|singer|musician|cook|servant|boss|worker|school|lesson|book|notebook|pen|pencil|paper|letter|word|language|question|answer|exam|money|price|coin|debt|loan|salary|profit|loss|tax|market|shop|customer|cheap|expensive|rich|poor|to work|to study|to teach|to learn|to read|to write|to count|to buy|to sell|to pay|to borrow|to lend|to earn|to spend|to save|to owe|to cost|to bargain'],
    ['travel and places', 'road|street|bridge|city|village|country|border|map|car|bus|train|plane|ship|bicycle|ticket|passport|suitcase|hotel|airport|station|north|south|east|west|left|right|straight|near|far|Bukhara|Samarkand|Tashkent|Israel|Jerusalem|America|New York|Russia|to travel|to arrive|to leave|to return|to cross|to turn|to stop|to wait|to get lost|to find|to visit|to move (house)'],
    ['everyday actions', 'to be|to have|to do|to make|to go|to come|to give|to take|to bring|to put|to say|to tell|to speak|to ask|to answer|to see|to look|to hear|to listen|to know|to think|to understand|to want|to need|to like|to eat|to drink|to sleep|to wake up|to get up|to sit|to stand|to lie down|to walk|to run|to jump|to fall|to open|to close|to begin|to finish|to help|to call|to send|to receive|to show|to hide|to throw|to catch|to pull|to push|to carry|to break|to cut|to tie|to fill|to empty|to choose|to change|to try|to use|to keep|to lose|to win|to play|to sing|to dance|to meet|to invite|to marry|to be born|to die|to live|to kill|to fight|to steal|to promise|to agree|to refuse|to allow|to forbid|to thank|to greet|to apologize|to congratulate'],
    ['describing things', 'big|small|long|short|tall|wide|narrow|thick|thin|heavy|light|full|empty|new|old|young|good|bad|beautiful|ugly|clean|dirty|easy|difficult|fast|slow|strong|weak|hard|soft|sharp|loud|quiet|bright|dark|right (correct)|wrong|true|false|same|different|important|necessary|possible|impossible|ready|free|busy|open|closed|alive|dead|red|blue|green|yellow|black|white|brown|gray|pink|orange|gold|silver'],
  ];
  const listed = new Set(readFileSync(resolve(ROOT, 'translator/data/missing-words.tsv'), 'utf8').split('\n').slice(1).map((l) => (l.split('\t')[4] ?? '').toLowerCase()));
  const seen = new Set<string>();
  const out: (string | number)[][] = [];
  for (const [topic, items] of TOPICS) for (const en of items.split('|')) {
    const plain = en.replace(/\s*\([^)]*\)/g, '').trim();
    const k = plain.toLowerCase();
    if (seen.has(k) || listed.has(k)) continue;
    seen.add(k);
    const r = engine.translate(plain);
    if (r.status === 'exact' || (r.text && r.tier === 'high')) continue;            // the book has it
    out.push([topic, en, '', '', '']);
  }
  tsv('9-topic-vocabulary.tsv', ['topic', 'english', 'BUXORI (fill in)', 'SPOKEN FORM / OTHER WORDS', 'NOTES'], out);
}

// ── 10. One sentence per construction ────────────────────────────────────────
{
  const SETS: [string, string][] = [
    ['statements: who does what', 'The boy reads a book.|The woman gave the child an apple.|My brother sent me a letter.|The teacher showed the students the book.|We live in a big house.|They work in the market every day.'],
    ['negation', 'I do not eat meat.|He never comes.|Nobody came.|I saw nothing.|I have no money.|He is not at home.|Don’t tell anyone.|I did not see anyone anywhere.'],
    ['questions', 'Is he your brother?|Did you eat?|Are you coming or not?|He is your brother, isn’t he?|Who gave you this?|What did you buy?|Which book do you want?|Whose house is this?|Why didn’t you come?|How did you find it?|How many children do you have?|How much does this cost?|What time is it?|How old are you?|Do you want tea or coffee?'],
    ['tenses of one verb (to write)', 'I write.|I am writing now.|I wrote.|I was writing.|I used to write.|I have written.|I had written.|I will write.|I will have written.|I would write.|I would have written.|Write!|Don’t write!|Let him write.|Let’s write.'],
    ['commands and requests', 'Come here!|Please sit down.|Don’t go!|Give it to me.|Let me see.|Could you help me?|Would you like some tea?|May I come in?|You must not smoke here.'],
    ['can, must, want, need', 'I can swim.|I could not sleep.|You must go now.|You don’t have to come.|You should rest.|I want to sleep.|I want you to come.|I need a doctor.|I need to buy bread.|He knows how to read.|I tried to open the door.|She began to cry.|He stopped working.'],
    ['“to be” and “to have”', 'I am a teacher.|You are tired.|She is beautiful.|We are at home.|They were here yesterday.|I will be there tomorrow.|There is a book on the table.|There are no people in the street.|Is there water?|I have two brothers.|He had a car.|I will have time tomorrow.|This house has three rooms.'],
    ['possession and “of”', 'my father’s house|the door of the house|a friend of mine|the teacher’s book|This book is mine.|Whose is it?|a cup of tea|a glass of water|the city of Bukhara|my brother’s wife’s mother'],
    ['adjectives and comparison', 'a big red apple|This house is bigger than that one.|He is the oldest brother.|She is as tall as her mother.|This is less expensive.|the most beautiful girl|It is too hot.|It is very cold.|It is not big enough.|The more you read, the more you know.'],
    ['numbers, counting, measures', 'three books|the third book|two kilos of rice|half an hour|one and a half years|both brothers|all three of us|twenty-five people|the first time|twice a week|ten percent|It costs fifty dollars.|I am thirty years old.|It is half past three.|on the fifth of May|in 1990'],
    ['place and direction', 'The book is on the table.|The cat is under the bed.|He stands behind the door.|She sat next to me.|We walked through the garden.|He came out of the house.|I am going to the market.|He came from Samarkand.|Put it in the box.|Take it out of the bag.|She went up the stairs.|The shop is far from here.|Turn left.'],
    ['time', 'I came yesterday.|I will come in two days.|He left three years ago.|I have lived here for ten years.|I have been waiting since morning.|We eat at seven o’clock.|He works from morning until evening.|I will finish by tomorrow.|on Saturday|in the morning|at night|every week|during the wedding'],
    ['“that” clauses and reported speech', 'I know that he is here.|I think he will come.|He said that he was tired.|She asked me where I live.|I don’t know whether he came.|Tell him to come.|He told me not to wait.|I heard that she got married.|It is good that you came.|I hope you are well.'],
    ['“who / which / where” clauses', 'the man who came yesterday|the book that I read|the woman whom I saw|the house where I live|the day when we met|the boy whose father is a doctor|everything that I know|the one who knows|The people who live here are kind.'],
    ['if', 'If you come, I will be glad.|If it rains, we will stay home.|If I had money, I would buy a house.|If you had come, you would have seen him.|If you want, come.|Unless you hurry, you will be late.|Even if he asks, don’t tell him.|I wish I knew.'],
    ['time clauses', 'When I came home, he was sleeping.|When you arrive, call me.|Before he left, he ate.|After we ate, we went out.|While I was reading, she was cooking.|Wait until I come.|Since he left, I have not seen him.|As soon as he came, we began.'],
    ['reason, purpose, result, contrast', 'I stayed home because I was sick.|He was tired, so he slept.|I came to see you.|I came so that you would not be alone.|Although he is old, he works.|He is rich but not happy.|Not only he but also his brother came.|Either you or I will go.|Neither he nor she knows.'],
    ['passive and “someone made someone do”', 'The house was built last year.|The letter was written by my father.|The door is closed.|The bread has been eaten.|It is said that he is rich.|I had my shoes repaired.|She made him wait.|He let me go.|The teacher made the students read.'],
    ['myself, each other', 'I saw myself in the mirror.|He did it himself.|They love each other.|We help one another.|She bought herself a dress.|Wash yourself.'],
    ['something, anything, everything', 'Someone is knocking.|I want something to eat.|Is anyone there?|I can’t find it anywhere.|Everyone knows him.|Each child got an apple.|Some people like it, others don’t.|Any child can do this.|Whoever comes, tell me.|Whatever you want.'],
    ['impersonal and weather', 'It is raining.|It is snowing.|It is hot today.|It is late.|It is necessary to go.|It is possible.|It is forbidden to enter.|It seems that he is sick.|It is difficult to say.|There is no time.'],
    ['verbs with a helper word (compound verbs)', 'I work.|I am working.|I did not work.|I want to work.|He talked to me.|She fell in love.|We got married.|They got tired.|I got up early.|He fell asleep.|She became a doctor.|I made a mistake.|He took a photo.|We had a rest.'],
    ['politeness and address', 'How are you? (to a friend)|How are you? (to an elder)|Come in, please. (to a guest)|Thank you. – You’re welcome.|Excuse me, where is the market?|Dear grandmother, …|Mr. David, …|May God give you health.|Congratulations on the wedding.|May his memory be a blessing.'],
    ['exclamations and feelings', 'What a beautiful day!|How good!|Oh no!|Really?|Of course!|What a pity!|Thank God!|God forbid!|Well done!|Be careful!|Hurry up!|Never mind.|I am so happy!|I am very sorry.'],
  ];
  const out: (string | number)[][] = [];
  for (const [construction, items] of SETS) for (const en of items.split('|')) {
    const r = engine.translate(en.replace(/\s*\([^)]*\)/g, ''));
    const shown = r.variants.length ? r.variants.map((v) => v.text).join(' / ') : r.text ?? '';
    out.push([construction, en, shown ? `${shown}${r.status === 'exact' ? ' (printed)' : r.tier === 'low' ? ' (draft)' : ''}` : '', '', '']);
  }
  tsv('10-sentences-by-construction.tsv', ['construction', 'english', 'translator_output (blank = cannot translate yet)', 'BUXORI: how you would say it', 'NOTES (word order, other ways to say it)'], out);
}
