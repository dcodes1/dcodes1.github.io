/*
 * End-to-end check of the real site in a browser, served the way GitHub Pages
 * serves it (unknown paths → 404.html). Covers the portfolio, routing, the
 * translator UI (both directions), lazy loading, the AI fallback (mocked), mobile
 * layout and JS errors.
 *
 *   npm run e2e        (needs a built translator/app: npm run build)
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
let aiEndpoint = '';          // injected into index.html for the AI-fallback test
let aiCalls = 0;
let lockOnline = true;        // mock of contact/worker.ts; accepts only the FAKE answer [0]
let lockEndpoint = '';        // injected as data-endpoint (server mode); empty = the page's own local lock
const FAKE_EMAIL = 'someone@example.com';

const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  if (p === '/__ai') {      // mock AI worker
    aiCalls++;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { text, examples } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ translation: `AI(${text})`, explanation: `grounded on ${examples.length} examples` }));
    });
    return;
  }
  if (p === '/api/reveal' && req.method === 'POST' && lockOnline) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { cells } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cells.join(',') === '0' ? { ok: true, email: FAKE_EMAIL } : { ok: false }));
    });
    return;
  }
  if (p.endsWith('/')) p += 'index.html';           // GitHub Pages serves index.html for directories
  const fp = join(ROOT, p);
  if (fp.startsWith(ROOT) && existsSync(fp) && statSync(fp).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] ?? 'application/octet-stream' });
    if (p === '/index.html' && (aiEndpoint || lockEndpoint)) {
      let h = readFileSync(fp, 'utf8');
      if (aiEndpoint) h = h.replace('<div id="translator-root">', `<div id="translator-root" data-ai-endpoint="${aiEndpoint}">`);
      if (lockEndpoint) h = h.replace('id="emailGate"', `id="emailGate" data-endpoint="${lockEndpoint}"`);
      return res.end(h);
    }
    return createReadStream(fp).pipe(res);
  }
  res.writeHead(404, { 'Content-Type': 'text/html' });
  createReadStream(join(ROOT, '404.html')).pipe(res);
});

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } };

await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
const errors = [];
const watch = (page) => page.on('pageerror', (e) => errors.push(e.message));

async function state(page) {
  return page.evaluate(() => ({
    path: location.pathname,
    portHidden: document.getElementById('view-portfolio').hidden,
    transHidden: document.getElementById('view-translator').hidden,
    activeTab: !!document.querySelector('[data-route="/translator"].active'),
    title: document.title,
  }));
}
const ready = (page) => page.waitForFunction(() => /^Ready/.test(document.getElementById('trStatus')?.textContent ?? ''), null, { timeout: 15000 });
async function translate(page, text) {
  await page.fill('#trInput', text);
  await page.click('#trGo');
  await page.waitForFunction(() => /^Ready/.test(document.getElementById('trStatus').textContent) && !document.querySelector('#trOutput.tr-empty'), null, { timeout: 10000 }).catch(() => {});
  return {
    out: (await page.textContent('#trOutput')).trim(),
    note: (await page.textContent('#trNote').catch(() => '')) ?? '',
    explain: (await page.$eval('.tr-explain', (e) => e.textContent).catch(() => '')) ?? '',
    badge: (await page.$eval('.tr-pane-foot .tr-badge', (e) => e.textContent).catch(() => '')) ?? '',
  };
}

try {
  // ── 1. Portfolio does not download the translator ───────────────────────
  const page = await browser.newPage();
  watch(page);
  const requested = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  let s = await state(page);
  ok('home shows portfolio', !s.portHidden && s.transHidden, s);
  ok('home tab not active', !s.activeTab, s);
  // Email lock: neither a readable address nor the solution is in any served file.
  const served = ['index.html', 'assets/email-gate.js', 'assets/site.css'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  ok('lock: no address in served files', !/@gmail|%40gmail|cdn-cgi/i.test(served) && !served.includes(['__cf', '_email__'].join('')) && !/[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i.test(served));
  ok('lock: card is sealed', /Sealed/.test(await page.textContent('#emailHandle')) && !/@/.test(await page.textContent('#emailGate')));
  // Local mode (no endpoint configured): wrong answers are refused without any network call.
  await page.click('#emailOpen');
  await page.waitForSelector('dialog.vault[open]');
  ok('lock: three solved examples + one grid', (await page.locator('.vault-examples .dg').count()) === 3 && (await page.locator('.dg-main .dc-tap').count()) === 43);
  ok('lock: transmit disabled until a cell is lit', await page.isDisabled('.vault-controls .eg-btn:not(.eg-ghost)'));
  const box = async (p, i) => (await p.locator(`.dc-tap[data-i="${i}"]`).boundingBox());
  const b43 = await box(page, 43), b46 = await box(page, 46);
  await page.mouse.move(b43.x + b43.width / 2, b43.y + b43.height / 2); await page.mouse.down();
  await page.mouse.move(b46.x + b46.width / 2, b46.y + b46.height / 2, { steps: 8 }); await page.mouse.up();
  ok('lock: dragging paints a run of cells', (await page.locator('.dc-tap.on').count()) === 4);
  const reqBefore = requested.length;
  await page.click('.vault-controls .eg-btn:not(.eg-ghost)');
  await page.waitForFunction(() => /holds/.test(document.querySelector('.vault-msg')?.textContent ?? ''));
  ok('lock (local): wrong answer → "The lock holds.", nothing revealed, no request', !/@/.test(await page.textContent('dialog.vault')) && requested.length === reqBefore);
  await page.click('.vault-controls .eg-ghost');
  ok('lock: clear empties the grid', (await page.locator('.dc-tap.on').count()) === 0);
  await page.keyboard.press('Escape');
  ok('lock: Escape closes the dialog', !(await page.isVisible('dialog.vault')));
  // Server mode (data-endpoint set): mock worker accepts only the fake answer [0].
  lockEndpoint = '/api/reveal';
  const sv = await browser.newPage(); watch(sv);
  await sv.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sv.click('#emailOpen');
  await sv.click('.dc-tap[data-i="1"]');
  await sv.click('.vault-controls .eg-btn:not(.eg-ghost)');
  await sv.waitForFunction(() => /holds/.test(document.querySelector('.vault-msg')?.textContent ?? ''));
  ok('lock (server): wrong answer refused', !/@/.test(await sv.textContent('dialog.vault')));
  await sv.click('.dc-tap[data-i="1"]');
  await sv.click('.dc-tap[data-i="0"]');
  await sv.click('.vault-controls .eg-btn:not(.eg-ghost)');
  await sv.waitForFunction((e) => document.querySelector('.vault-email')?.textContent === e, FAKE_EMAIL, { timeout: 6000 });
  ok('lock (server): correct answer unlocks with a mailto link', (await sv.getAttribute('.vault-email', 'href')) === 'mailto:' + FAKE_EMAIL);
  ok('lock: copy button shown', await sv.isVisible('.vault-open .eg-btn'));
  ok('lock: card shows the address afterwards', (await sv.getAttribute('#emailHandle a', 'href')) === 'mailto:' + FAKE_EMAIL);
  await sv.close();
  lockOnline = false;
  const off = await browser.newPage(); watch(off);
  await off.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await off.click('#emailOpen'); await off.click('.dc-tap[data-i="0"]'); await off.click('.vault-controls .eg-btn:not(.eg-ghost)');
  await off.waitForFunction(() => /unreachable/.test(document.querySelector('.vault-msg')?.textContent ?? ''), null, { timeout: 5000 }).then(() => ok('lock (server): endpoint down → clear message', true), () => ok('lock (server): endpoint down → clear message', false));
  await off.close();
  lockOnline = true; lockEndpoint = '';

  ok('portfolio does not load the translator bundle', !requested.some((u) => u.includes('/translator/app/')), requested.filter((u) => u.includes('translator')));
  ok('legacy engine.js no longer loaded', !requested.some((u) => u.endsWith('/translator/engine.js')));

  // ── 2. Routing ───────────────────────────────────────────────────────────
  await page.click('.nav-links a[data-route="/translator"]');
  s = await state(page);
  ok('nav → /translator', s.path === '/translator' && !s.transHidden && s.portHidden, s);
  ok('nav tab active', s.activeTab, s);
  ok('title', /Buxori/.test(s.title), s);
  await ready(page);
  ok('bundle + dataset loaded on first visit', requested.some((u) => /translator\/app\/translator\.js/.test(u)) && requested.some((u) => /buxori-index-.*\.json/.test(u)));

  // ── 3. English → Buxori ──────────────────────────────────────────────────
  let r = await translate(page, 'Good morning');
  ok('exact: Good morning → Safro tüvo!', r.out === 'Safro tüvo!', r);
  ok('exact: verified badge', /verified/.test(r.badge), r.badge);
  r = await translate(page, 'water');
  ok('exact: water → Maim', r.out === 'Maim', r);
  r = await translate(page, 'I live in Israel now');
  ok('grammar: verb-final, conjugated', r.out === 'Man aknun ba Isroel zindagi mekunam', r.out);
  ok('grammar: badge "built from rules"', /built from rules/.test(r.badge), r.badge);
  ok('grammar: steps shown', /How this was built/.test(r.explain) && /zindagi/.test(r.explain), r.explain.slice(0, 160));
  ok('grammar: source rows cited', /TSV \d+/.test(r.explain), r.explain.slice(0, 160));
  r = await translate(page, 'Where are you from?');
  ok('question: formal + informal shown', /informal/.test(r.out) && /formal/.test(r.out), r.out);
  ok('question: no English "are" leak', !/\bare\b/i.test(r.out), r.out);
  r = await translate(page, 'He has six zorbles');
  ok('unknown word not shown in output', !/zorbles/i.test(r.out), r.out);
  ok('unknown word reported', /zorbles/.test(r.note), r.note);
  r = await translate(page, 'xyzzy plorp');
  ok('nonsense: no translation', /no reliable translation/.test(r.out), r.out);
  r = await translate(page, 'my mom');
  ok('Regular register: my mom → Onim', r.out === 'Onim', r.out);
  ok('Literal form offered as alternative', /Onayam/.test(r.note), r.note);
  r = await translate(page, 'why?');
  ok('why → Chuva? (legacy charo fixed)', r.out === 'Chuva?', r.out);

  // Cyrillic toggle
  await page.click('.tr-script button:nth-child(2)');
  r = await translate(page, 'water');
  ok('Cyrillic toggle: Maim → Маим', r.out === 'Маим', r.out);
  await page.click('.tr-script button:nth-child(1)');

  // ── 4. Buxori → English ──────────────────────────────────────────────────
  await page.click('.tr-tabs > button:nth-child(2)');
  r = await translate(page, 'Худо');
  ok('reverse: Cyrillic Худо → G-d', /G-d/.test(r.out), r.out);
  r = await translate(page, 'meravam');
  ok('reverse: conjugated verb analysed → Raftan', /Raftan/.test(r.explain), r.explain.slice(0, 160));
  ok('reverse: output shows the meaning, not "not found"', /to go/.test(r.out) && !/not found/.test(r.out), r.out);
  ok('reverse: Literal meravam → everyday form merum shown', /Everyday \(Regular\) form: merum/.test(r.explain), r.explain.slice(0, 220));
  r = await translate(page, 'kitob');
  ok('reverse: approximate spelling flagged', /consonants only|approximate|ignoring/.test(r.note) && /Kitov/.test(r.explain), { note: r.note, ex: r.explain.slice(0, 120) });
  await page.click('.tr-tabs > button:nth-child(1)');

  // ── 5. History, back button, logo, anchors ──────────────────────────────
  await page.goBack();
  s = await state(page);
  ok('back → portfolio', s.path === '/' && !s.portHidden, s);
  await page.goForward();
  s = await state(page);
  ok('forward → translator', s.path === '/translator' && !s.transHidden, s);
  await page.click('.tr-back');
  s = await state(page);
  ok('"← Portfolio" → portfolio', s.path === '/' && !s.portHidden, s);
  await page.click('.nav-links a[data-route="/translator"]');
  await page.click('.nav-logo');
  s = await state(page);
  ok('logo → home', s.path === '/' && !s.portHidden, s);
  await page.click('.nav-links a[data-route="/translator"]');
  await page.click('.nav-links a[href="#projects"]');
  s = await state(page);
  ok('anchor from translator → portfolio', s.transHidden && !s.portHidden, s);
  await page.close();

  // ── 6. Direct visit to /translator (404.html → redirect → restore) ─────
  const p2 = await browser.newPage(); watch(p2);
  await p2.goto(BASE + '/translator', { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => location.pathname === '/translator' && !document.getElementById('view-translator').hidden, null, { timeout: 8000 }).catch(() => {});
  s = await state(p2);
  ok('direct /translator restores view', s.path === '/translator' && !s.transHidden, s);
  await ready(p2).then(() => ok('direct visit: translator ready', true)).catch(() => ok('direct visit: translator ready', false));
  await p2.close();

  // ── 7. AI fallback (mocked worker) ───────────────────────────────────────
  aiEndpoint = '/__ai'; aiCalls = 0;
  const p3 = await browser.newPage(); watch(p3);
  await p3.goto(BASE + '/translator', { waitUntil: 'domcontentloaded' });
  await ready(p3);
  r = await translate(p3, 'water');
  ok('AI mode: exact result skips the worker', r.out === 'Maim' && aiCalls === 0, { out: r.out, aiCalls });
  r = await translate(p3, 'I live in Israel now');
  ok('AI mode: worker called for non-verified input', aiCalls === 1, { aiCalls });
  ok('AI mode: AI output shown and labelled', r.out === 'AI(I live in Israel now)' && /ai-assisted/.test(r.badge) && /grounded on 8 examples/.test(r.note), r);
  aiEndpoint = '';
  await p3.close();

  // ── 8. Desktop + mobile layout ──────────────────────────────────────────
  const d = await browser.newPage({ viewport: { width: 1280, height: 900 } }); watch(d);
  await d.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok('desktop: nav links visible', await d.isVisible('.nav-links'));
  ok('desktop: hamburger hidden', !(await d.isVisible('.nav-toggle')));
  await d.evaluate(() => document.getElementById('certifications').scrollIntoView());
  const before = await d.evaluate(() => document.querySelector('.carousel-track-wrap').scrollLeft);
  await d.click('.carousel-next'); await d.waitForTimeout(600);
  const after = await d.evaluate(() => document.querySelector('.carousel-track-wrap').scrollLeft);
  ok('desktop: carousel next scrolls', after > before, { before, after });
  ok('desktop: one carousel dot active', (await d.locator('.carousel-dot.active').count()) === 1);
  await d.close();

  const m = await browser.newPage({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true }); watch(m);
  await m.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok('mobile: no horizontal overflow (portfolio)', await m.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  ok('mobile: hamburger visible', await m.isVisible('.nav-toggle'));
  ok('mobile: CTA visible', await m.isVisible('.nav-cta'));
  ok('mobile: menu closed initially', !(await m.isVisible('.nav-links')));
  await m.tap('.nav-toggle'); await m.waitForTimeout(300);
  ok('mobile: menu opens', await m.isVisible(".nav-links a[href='#projects']"));
  ok('mobile: aria-expanded true', (await m.getAttribute('.nav-toggle', 'aria-expanded')) === 'true');
  await m.tap(".nav-links a[href='#skills']"); await m.waitForTimeout(700);
  ok('mobile: menu closes after link', !(await m.isVisible('.nav-links')));
  ok('mobile: scrolled to skills', Math.abs(await m.evaluate(() => document.getElementById('skills').getBoundingClientRect().top)) < 120);
  const wide = await m.evaluate(() => [...document.querySelectorAll('section, .project-card, .intel-box, .contact-card, .hero-corner')]
    .filter((el) => el.offsetParent && el.getBoundingClientRect().right > innerWidth + 1).map((el) => el.id || el.className));
  ok('mobile: no element overflows the viewport', wide.length === 0, wide);
  await m.evaluate(() => document.getElementById('certifications').scrollIntoView());
  ok('mobile: carousel arrows hidden (swipe)', !(await m.isVisible('.carousel-btn')));
  await m.evaluate(() => document.querySelector('.carousel-track-wrap').scrollBy({ left: 400, behavior: 'instant' }));
  await m.waitForTimeout(400);
  ok('mobile: carousel dots follow swipe', await m.evaluate(() => [...document.querySelectorAll('.carousel-dot')].findIndex((x) => x.classList.contains('active'))) > 0);
  ok('mobile: nav touch targets ≥ 40px', await m.evaluate(() => ['.nav-toggle', '.nav-cta'].every((q) => document.querySelector(q).getBoundingClientRect().height >= 40)));
  await m.evaluate(() => document.getElementById('emailGate').scrollIntoView());
  await m.tap('#emailOpen');
  await m.waitForSelector('dialog.vault[open]');
  const fit = await m.evaluate(() => { const d = document.querySelector('dialog.vault').getBoundingClientRect(); return { l: d.left, r: d.right, w: innerWidth, over: document.documentElement.scrollWidth - innerWidth }; });
  ok('mobile lock: dialog fits the screen, no horizontal scroll', fit.l >= 0 && fit.r <= fit.w && fit.over <= 1, fit);
  const tapSize = await m.$eval('.dc-tap', (e) => e.getBoundingClientRect().width);
  ok('mobile lock: grid cells are comfortable tap targets (≥ 34px)', tapSize >= 34, { tapSize });
  await m.tap('.dc-tap[data-i="0"]');
  ok('mobile lock: tap lights a cell', (await m.locator('.dc-tap.on').count()) === 1);
  await m.tap('.vault-close');
  await m.evaluate(() => scrollTo(0, 0));
  await m.click('.nav-cta');
  s = await state(m);
  ok('mobile: CTA → translator', s.path === '/translator' && !s.transHidden, s);
  await ready(m);
  r = await translate(m, 'Where do you live?');
  ok('mobile translator: formal/informal shown', /informal/.test(r.out), r.out);
  ok('mobile translator: no horizontal overflow', await m.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  const btnW = await m.$eval('#trGo', (e) => e.getBoundingClientRect().width);
  ok('mobile translator: full-width Translate button', btnW > 300, { btnW });
  const small = await m.$$eval('.tr-tabs button, .tr-script button, #trGo, .tr-iconbtn', (els) => els.filter((e) => e.getBoundingClientRect().height < 32).map((e) => e.textContent));
  ok('mobile translator: touch targets ≥ 32px', small.length === 0, small);
  await m.close();

  // ── 9. Research page still fine ──────────────────────────────────────────
  const rp = await browser.newPage(); watch(rp);
  const resp = await rp.goto(BASE + '/research/', { waitUntil: 'domcontentloaded' });
  ok('research page loads', resp.status() === 200);
  await rp.close();

  ok('no JS errors on any page', errors.length === 0, errors);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
