/* Shared site chrome, loaded on every page: nav clock, footer year, mobile menu,
   scroll progress, command palette (Ctrl/⌘+K), card spotlight, reveal on scroll. */
(function () {
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Live clock in nav (UTC)
  const statusEl = document.querySelector('.nav-status');
  if (statusEl) {
    const tick = () => {
      const t = new Date().toISOString().substring(11, 19);
      statusEl.innerHTML = `<div class="status-dot"></div>${t} UTC`;
    };
    tick();
    setInterval(tick, 1000);
  }

  // Footer year
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Mobile menu
  const navEl = document.querySelector('nav');
  const navToggle = document.querySelector('.nav-toggle');
  if (navEl && navToggle) {
    const setMenu = (open) => {
      navEl.classList.toggle('open', open);
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    navToggle.addEventListener('click', () => setMenu(!navEl.classList.contains('open')));
    // Close after choosing a link, tapping outside, or pressing Escape.
    document.addEventListener('click', (e) => {
      if (!navEl.classList.contains('open')) return;
      if (e.target.closest('.nav-links a, .nav-cta, .nav-logo') || !e.target.closest('nav')) setMenu(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 860) setMenu(false); });
  }

  // Scroll progress line under the nav
  if (navEl) {
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    navEl.appendChild(bar);
    let queued = false;
    const paint = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ')';
      navEl.classList.toggle('scrolled', window.scrollY > 8);
    };
    const request = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    paint();
  }

  // Card spotlight: tell the hovered card where the pointer is (see --spot in site.css)
  const SPOT = '.project-card, .carousel-card, .post-card, .contact-card, .cert-card, .stat, .intel-box';
  if (window.matchMedia && matchMedia('(hover: hover)').matches) {
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest ? e.target.closest(SPOT) : null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  // Reveal on scroll. Content is only hidden once this script runs, and the
  // classes are removed after the transition so hover effects are untouched.
  if (!reduced && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        io.unobserve(el);
        el.classList.add('in');
        setTimeout(() => { el.classList.remove('rv', 'in'); el.style.removeProperty('--rv-d'); }, 1100);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    const targets = document.querySelectorAll('.section-header, .project-card, .skills-group, .carousel-wrap, .about-text, .intel-box, .contact-card, .post-card, .page-intro');
    targets.forEach((el) => {
      if (el.closest('#view-translator')) return;
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;   // already on screen: leave it alone
      const sibs = el.parentElement ? Array.prototype.filter.call(el.parentElement.children, (c) => c.tagName === el.tagName) : [el];
      el.style.setProperty('--rv-d', Math.min(sibs.indexOf(el), 4) * 0.07 + 's');
      el.classList.add('rv');
      io.observe(el);
    });
  }

  // ── Command palette ────────────────────────────────────────────────────
  if (!navEl || typeof HTMLDialogElement === 'undefined') return;
  const ITEMS = [
    { g: 'Navigate', t: 'Projects', k: 'work fogjack ops', i: '01', hash: 'projects' },
    { g: 'Navigate', t: 'Skills', k: 'toolset reverse engineering exploitation programming', i: '02', hash: 'skills' },
    { g: 'Navigate', t: 'Certifications', k: 'certs comptia security+ cysa+ degree', i: '03', hash: 'certifications' },
    { g: 'Navigate', t: 'Intel file', k: 'about bio background', i: '04', hash: 'about' },
    { g: 'Navigate', t: 'Contact', k: 'email reach message hire', i: '05', hash: 'contact' },
    { g: 'Pages', t: 'Buxori Translator', k: 'bukhori bukharian language tool english', i: '⇄', route: '/translator' },
    { g: 'Pages', t: 'Research', k: 'writeups write-ups blog articles', i: '§', href: '/research/' },
    { g: 'Pages', t: 'Dragon — RE case study', k: 'pwnable ghidra reverse engineering writeup', i: '§', href: '/research/dragon/' },
    { g: 'Links', t: 'GitHub', k: 'source code repos dcodes1', i: '↗', ext: 'https://github.com/dcodes1', e: 'github.com/dcodes1' },
    { g: 'Links', t: 'LinkedIn', k: 'profile professional network', i: '↗', ext: 'https://www.linkedin.com/in/davidgmilov/', e: 'davidgmilov' },
    { g: 'Page', t: 'Back to top', k: 'home start scroll up', i: '↑', top: true },
  ];
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-cmdk';
  btn.setAttribute('aria-label', 'Open command palette');
  btn.innerHTML = '<span>Search</span><kbd>' + (isMac ? '⌘K' : 'Ctrl K') + '</kbd>';
  navEl.insertBefore(btn, statusEl || navEl.querySelector('.nav-cta'));

  const dlg = document.createElement('dialog');
  dlg.className = 'cmdk';
  dlg.setAttribute('aria-label', 'Command palette');
  dlg.innerHTML =
    '<div class="cmdk-head"><span aria-hidden="true">&gt;</span>' +
    '<input class="cmdk-input" type="text" role="combobox" aria-expanded="true" aria-controls="cmdkList" aria-autocomplete="list" ' +
    'placeholder="Jump to a section, page or link…" autocomplete="off" autocapitalize="off" spellcheck="false"></div>' +
    '<ul class="cmdk-list" id="cmdkList" role="listbox" aria-label="Results"></ul>' +
    '<div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd>navigate</span><span><kbd>↵</kbd>open</span><span><kbd>esc</kbd>close</span></div>';
  document.body.appendChild(dlg);
  const input = dlg.querySelector('.cmdk-input');
  const list = dlg.querySelector('.cmdk-list');
  let shown = [], sel = 0;

  const run = (it) => {
    dlg.close();
    if (it.top) return window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    if (it.ext) return void window.open(it.ext, '_blank', 'noopener');
    // On the home page the router owns these links; elsewhere fall back to a normal visit.
    const link = it.hash ? document.querySelector('.nav-links a[href="#' + it.hash + '"]')
      : it.route ? document.querySelector('.nav-links a[data-route="' + it.route + '"]') : null;
    if (link) link.click();
    else location.href = it.hash ? '/#' + it.hash : (it.route || it.href);
  };
  const select = (n) => {
    sel = shown.length ? (n + shown.length) % shown.length : 0;
    list.querySelectorAll('.cmdk-item').forEach((el, i) => {
      el.setAttribute('aria-selected', String(i === sel));
      if (i === sel) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    });
  };
  const render = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    // Best match first: title starts with the query, then title contains it, then keywords.
    const score = (it) => {
      const t = it.t.toLowerCase(), hay = t + ' ' + it.k;
      if (!words.every((w) => hay.includes(w))) return -1;
      return words.reduce((n, w) => n + (t.startsWith(w) ? 3 : t.includes(w) ? 2 : 1), 0);
    };
    shown = words.length
      ? ITEMS.map((it, i) => ({ it, i, s: score(it) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.it)
      : ITEMS.slice();
    list.textContent = '';
    input.removeAttribute('aria-activedescendant');
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'cmdk-empty';
      li.textContent = 'No matches.';
      list.appendChild(li);
      return;
    }
    let group = '';
    shown.forEach((it, i) => {
      if (!words.length && it.g !== group) {      // group headings only for the full list
        group = it.g;
        const h = document.createElement('li');
        h.className = 'cmdk-group';
        h.setAttribute('role', 'presentation');
        h.textContent = group;
        list.appendChild(h);
      }
      const li = document.createElement('li');
      li.className = 'cmdk-item';
      li.id = 'cmdk-o' + i;
      li.setAttribute('role', 'option');
      const ic = document.createElement('i'); ic.setAttribute('aria-hidden', 'true'); ic.textContent = it.i;
      const tx = document.createElement('span'); tx.textContent = it.t;
      const hint = document.createElement('em'); hint.textContent = it.e || (it.hash ? '#' + it.hash : it.route || it.href || '');
      li.append(ic, tx, hint);
      li.addEventListener('click', () => run(it));
      li.addEventListener('pointermove', () => { if (sel !== i) select(i); });
      list.appendChild(li);
    });
    select(0);
  };
  const open = () => {
    if (dlg.open || document.querySelector('dialog[open]')) return;
    input.value = '';
    render();
    dlg.showModal();
    input.focus();
  };

  btn.addEventListener('click', open);
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) run(shown[sel]); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // click on the backdrop
  document.addEventListener('keydown', (e) => {
    const typing = e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (dlg.open) dlg.close(); else open();
    } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      open();
    }
  });
})();
