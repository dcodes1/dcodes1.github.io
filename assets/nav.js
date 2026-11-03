/* Shared site chrome: nav clock, footer year, mobile menu. Loaded on every page. */
(function () {
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
})();
