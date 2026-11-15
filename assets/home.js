/* Home page only: hero signal grid, terminal typing, local time, current-section highlight. */
(function () {
  'use strict';
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hero = document.getElementById('hero');

  // ── Local time in the status terminal (location: IL) ─────────────────────
  var timeEl = document.getElementById('heroTime');
  if (timeEl) {
    try {
      var fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
      var showTime = function () { timeEl.textContent = fmt.format(new Date()); };
      showTime();
      setInterval(showTime, 15000);
    } catch (e) { /* keep the static fallback */ }
  }

  // ── Terminal: type the command, then print the output line by line ───────
  var body = document.querySelector('.hero-corner .term-body');
  var cmd = body && body.querySelector('.term-cmd');
  if (cmd && !reduced) {
    var rows = Array.prototype.slice.call(body.children, 1);
    var text = cmd.textContent;
    rows.forEach(function (r) { r.classList.add('term-hide'); });
    cmd.textContent = '';
    cmd.classList.add('typing');
    var n = 0;
    var printRow = function () {
      var r = rows.shift();
      if (!r) return;
      r.classList.remove('term-hide');
      setTimeout(printRow, 110);
    };
    var type = function () {
      cmd.textContent = text.slice(0, ++n);
      if (n < text.length) return setTimeout(type, 38 + Math.random() * 50);
      setTimeout(function () { cmd.classList.remove('typing'); printRow(); }, 320);
    };
    setTimeout(type, 700);
  }

  // ── Current section in the nav ───────────────────────────────────────────
  if ('IntersectionObserver' in window) {
    var links = {};
    ['projects', 'skills', 'certifications', 'about', 'contact'].forEach(function (id) {
      var a = document.querySelector('.nav-links a[href="#' + id + '"]');
      if (a && document.getElementById(id)) links[id] = a;
    });
    var setCurrent = function (id) {
      Object.keys(links).forEach(function (k) {
        var on = k === id;
        links[k].classList.toggle('current', on);
        if (on) links[k].setAttribute('aria-current', 'location'); else links[k].removeAttribute('aria-current');
      });
    };
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) setCurrent(en.target.id); });
    }, { rootMargin: '-45% 0px -54% 0px' });     // a thin band across the middle of the screen
    Object.keys(links).forEach(function (id) { spy.observe(document.getElementById(id)); });
    if (hero) spy.observe(hero);                  // "hero" has no link: clears the highlight
    // The translator view hides the portfolio; nothing is current there.
    window.addEventListener('popstate', function () { if (location.pathname.replace(/\/+$/, '') === '/translator') setCurrent(null); });
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a[data-route="/translator"]')) setCurrent(null); });
  }

  // ── Signal grid: pulses travelling along the hero's 56px grid lines ──────
  if (!hero || reduced) return;
  var CELL = 56, COLORS = ['34, 211, 138', '56, 189, 248'];
  var canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  var gridBg = hero.querySelector('.hero-grid-bg');
  hero.insertBefore(canvas, gridBg ? gridBg.nextSibling : hero.firstChild);
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, pulses = [], raf = 0, last = 0, onScreen = false;

  function spawn(p) {
    var cols = Math.max(1, Math.floor(W / CELL)), rws = Math.max(1, Math.floor(H / CELL));
    var horizontal = Math.random() < 0.5, forward = Math.random() < 0.5;
    p.x = Math.floor(Math.random() * (cols + 1)) * CELL;
    p.y = Math.floor(Math.random() * (rws + 1)) * CELL;
    p.dx = horizontal ? (forward ? 1 : -1) : 0;
    p.dy = horizontal ? 0 : (forward ? 1 : -1);
    p.speed = 45 + Math.random() * 75;
    p.left = CELL;                         // distance to the next intersection
    p.rgb = COLORS[Math.random() < 0.7 ? 0 : 1];
    p.trail = [];
    p.life = 4 + Math.random() * 7;        // seconds
    return p;
  }
  function resize() {
    var r = hero.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var want = Math.max(6, Math.min(18, Math.round(W * H / 70000)));
    while (pulses.length < want) pulses.push(spawn({}));
    pulses.length = want;
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    for (var i = 0; i < pulses.length; i++) {
      var p = pulses[i], step = p.speed * dt;
      p.life -= dt;
      while (step > 0) {
        var s = Math.min(step, p.left);
        p.x += p.dx * s; p.y += p.dy * s; p.left -= s; step -= s;
        if (p.left <= 0) {                 // at an intersection: sometimes turn
          p.left = CELL;
          if (Math.random() < 0.3) { var t = Math.random() < 0.5 ? 1 : -1; var ndx = p.dy * t; p.dy = p.dx * t; p.dx = ndx; }
        }
      }
      p.trail.push(p.x, p.y);
      if (p.trail.length > 64) p.trail.splice(0, 2);
      var m = p.trail.length / 2, fade = Math.min(1, Math.max(0, p.life));   // fade out in the last second
      for (var j = 1; j < m; j++) {
        var a = (j / m); a = a * a * 0.55 * fade;
        ctx.strokeStyle = 'rgba(' + p.rgb + ',' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(p.trail[(j - 1) * 2] + 0.5, p.trail[(j - 1) * 2 + 1] + 0.5);
        ctx.lineTo(p.trail[j * 2] + 0.5, p.trail[j * 2 + 1] + 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(' + p.rgb + ',' + (0.16 * fade).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x + 0.5, p.y + 0.5, 5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(' + p.rgb + ',' + (0.95 * fade).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x + 0.5, p.y + 0.5, 1.6, 0, 6.2832); ctx.fill();
      if (p.life <= 0 || p.x < -CELL || p.y < -CELL || p.x > W + CELL || p.y > H + CELL) spawn(p);
    }
  }
  function sync() {                        // only animate while the hero is visible in an active tab
    var run = onScreen && !document.hidden;
    if (run && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero); else window.addEventListener('resize', resize);
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; sync(); }).observe(hero);
  else onScreen = true;
  document.addEventListener('visibilitychange', sync);
  sync();
})();
