/*
 * "Mirror": the lock on the contact email.
 *
 * One 7×7 grid showing the left half of a padlock icon (fixed tiles, lit or
 * dark). The visitor lights the empty slots on the right so both halves match,
 * like a reflection. The lock opens by itself as soon as the picture is whole.
 *
 * The page never contains the solution or a readable address. The address is
 * stored XOR-encrypted with a key derived from the answer (SHA-256), plus a short
 * check value; only the correct set of slots produces the key. Optionally, set
 * data-endpoint on #emailGate to have a server (contact/worker.ts) check the
 * answer instead.
 */
(function () {
  "use strict";
  var card = document.getElementById("emailGate");
  if (!card) return;

  var N = 7;
  var KNOWN_LIT = [2, 3, 8, 15, 21, 22, 23, 24, 28, 29, 30, 35, 36, 37, 42, 43, 44, 45];
  var KNOWN_DARK = [0, 1, 7, 9, 10, 14, 16, 17, 31, 38];
  var SEALED = [91, 190, 46, 134, 111, 255, 126, 185, 224, 46, 236, 205, 18, 234, 145, 26, 214, 180, 80, 75, 151];
  var CHECK = "1c25c35d3a0698b0";
  var ENDPOINT = card.getAttribute("data-endpoint") || "";
  var LINKEDIN = "https://www.linkedin.com/in/davidgmilov/";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var openBtn = document.getElementById("emailOpen");
  var handle = document.getElementById("emailHandle");
  var dialog = null, slots = {}, lit = {}, msgEl, sendBtn, clearBtn, gridEl, busy = false, solvedEmail = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildGrid() {
    var known = {};
    KNOWN_LIT.forEach(function (i) { known[i] = "lit"; });
    KNOWN_DARK.forEach(function (i) { known[i] = "dark"; });
    var wrap = el("div", "dg-wrap dg-main");
    var g = el("div", "dg");
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", "Padlock grid. The left half is given; light the slots on the right so it matches, like a mirror.");
    for (var i = 0; i < N * N; i++) {
      var r = Math.floor(i / N), c = i % N, cell;
      if (known[i]) {
        cell = el("span", "dc dc-fixed " + (known[i] === "lit" ? "dc-given-on" : "dc-given-off") + (c === 3 ? " dc-axis" : ""));
        cell.setAttribute("aria-hidden", "true");
      } else {
        cell = el("button", "dc dc-tap");
        cell.type = "button";
        cell.setAttribute("aria-pressed", "false");
        cell.setAttribute("aria-label", "Slot, row " + (r + 1) + ", column " + (c + 1) + "; its mirror tile is " + (known[r * N + (N - 1 - c)] === "lit" ? "lit" : "dark"));
        cell.dataset.i = String(i);
        slots[i] = cell;
      }
      g.appendChild(cell);
    }
    wrap.appendChild(g);
    gridEl = g;
    return wrap;
  }

  function setLit(i, on) {
    var b = slots[i];
    if (!b) return;
    if (on) lit[i] = 1; else delete lit[i];
    b.classList.toggle("on", !!on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    var any = Object.keys(lit).length > 0;
    sendBtn.disabled = !any || busy;
    clearBtn.disabled = !any || busy;
    if (!ENDPOINT) autoCheck();
  }

  // Local mode: open as soon as the picture is whole, no button press needed.
  var checkSeq = 0;
  function autoCheck() {
    var seq = ++checkSeq;
    clearTimeout(autoCheck.t);
    autoCheck.t = setTimeout(function () {
      if (busy || solvedEmail) return;
      var list = Object.keys(lit).map(Number).sort(function (a, b) { return a - b; });
      if (!list.length) return;
      openLocally(list.join(",")).then(function (res) {
        if (seq === checkSeq && !solvedEmail && res && res.ok) unlock(res.email);
      }, function () {});
    }, 120);
  }

  // Tap toggles; dragging paints (or erases, if the drag started on a lit slot).
  function wirePainting(board) {
    var painting = false, mode = true, last = null, pressed = false;
    board.addEventListener("pointerdown", function (ev) {
      var t = ev.target.closest && ev.target.closest(".dc-tap");
      if (!t || busy || solvedEmail) return;
      pressed = true;   // the click that follows this press is already handled
      painting = true; last = t;
      mode = !lit[t.dataset.i];
      setLit(t.dataset.i, mode);
      if (board.setPointerCapture) board.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    board.addEventListener("pointermove", function (ev) {
      if (!painting) return;
      var t = document.elementFromPoint(ev.clientX, ev.clientY);
      t = t && t.closest ? t.closest(".dc-tap") : null;
      if (t && t !== last) { last = t; setLit(t.dataset.i, mode); }
    });
    function end() { painting = false; last = null; }
    board.addEventListener("pointerup", end);
    board.addEventListener("pointercancel", function () { end(); pressed = false; });
    // Keyboard and assistive tech: a click with no pointer press before it toggles.
    // (Touch taps also report click.detail === 0, so detail can't tell them apart.)
    board.addEventListener("click", function (ev) {
      if (pressed) { pressed = false; return; }
      var t = ev.target.closest && ev.target.closest(".dc-tap");
      if (!t || busy || solvedEmail) return;
      setLit(t.dataset.i, !lit[t.dataset.i]);
    });
  }

  function build() {
    dialog = el("dialog", "vault");
    dialog.setAttribute("aria-labelledby", "vaultTitle");
    var inner = el("div", "vault-inner");
    var close = el("button", "vault-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", function () { dialog.close(); });

    var head = el("div", "vault-head");
    head.appendChild(el("span", "vault-tag", "// lock"));
    var title = el("h3", "vault-title", "Mirror");
    title.id = "vaultTitle";
    head.appendChild(title);
    var prompt = el("p", "vault-prompt", "Half a padlock is drawn on the left. Tap the empty squares on the right to mirror it. The lock opens when both sides match.");

    var board = buildGrid();
    wirePainting(gridEl);

    var legend = el("p", "vault-controls-hint");
    legend.innerHTML = '<span class="lg lg-on"></span> lit &nbsp; <span class="lg lg-off"></span> dark &nbsp; <span class="lg lg-slot"></span> tap to light';

    var controls = el("div", "vault-controls");
    clearBtn = el("button", "eg-btn eg-ghost", "Clear");
    clearBtn.type = "button";
    clearBtn.disabled = true;
    clearBtn.addEventListener("click", function () { Object.keys(lit).forEach(function (i) { setLit(i, false); }); });
    sendBtn = el("button", "eg-btn", ENDPOINT ? "Transmit" : "Check");
    sendBtn.type = "button";
    sendBtn.disabled = true;
    sendBtn.addEventListener("click", submit);
    controls.appendChild(clearBtn);
    controls.appendChild(sendBtn);

    msgEl = el("p", "vault-msg");
    msgEl.setAttribute("aria-live", "polite");
    var alt = el("p", "vault-alt");
    alt.innerHTML = 'Rather not? <a href="' + LINKEDIN + '" target="_blank" rel="noopener">Message me on LinkedIn</a>.';

    [close, head, prompt, board, legend, controls, msgEl, alt].forEach(function (n) { inner.appendChild(n); });
    dialog.appendChild(inner);
    dialog.addEventListener("click", function (ev) { if (ev.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
  }

  function say(text, kind) {
    msgEl.textContent = text;
    msgEl.className = "vault-msg" + (kind ? " " + kind : "");
  }

  function fail() {
    gridEl.classList.remove("dg-wrong");
    void gridEl.offsetWidth;
    gridEl.classList.add("dg-wrong");
    say("Not whole yet. Each lit square on the left needs a lit square in the same spot on the right.", "warn");
  }

  function unlock(email) {
    solvedEmail = email;
    // Lit slots light up in a spiral outward from the centre.
    var order = Object.keys(lit).map(Number).sort(function (a, b) {
      var da = Math.abs(Math.floor(a / N) - 3) + Math.abs((a % N) - 3), db = Math.abs(Math.floor(b / N) - 3) + Math.abs((b % N) - 3);
      return da - db || Math.atan2(Math.floor(a / N) - 3, (a % N) - 3) - Math.atan2(Math.floor(b / N) - 3, (b % N) - 3);
    });
    var step = reduceMotion ? 0 : 60;
    if (!reduceMotion) gridEl.classList.add("dg-spin");
    order.forEach(function (i, k) { setTimeout(function () { if (slots[i]) slots[i].classList.add("trace"); }, k * step); });
    setTimeout(function () {
      dialog.classList.add("solved");
      say("", "");
      var box = el("div", "vault-open");
      box.appendChild(el("span", "vault-tag", "// unlocked"));
      var line = el("a", "vault-email");
      line.href = "mailto:" + email;
      box.appendChild(line);
      var copy = el("button", "eg-btn", "Copy");
      copy.type = "button";
      copy.addEventListener("click", function () {
        var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy"; }, 1400); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(email).then(done, function () {});
      });
      box.appendChild(copy);
      dialog.querySelector(".vault-controls").replaceWith(box);
      var hint = dialog.querySelector(".vault-controls-hint");
      if (hint) hint.remove();
      decrypt(line, email);
      handle.textContent = "";
      var a = el("a", "eg-link", email);
      a.href = "mailto:" + email;
      handle.appendChild(a);
      openBtn.textContent = "Show again";
      card.classList.add("revealed");
    }, order.length * step + (reduceMotion ? 0 : 450));
  }

  // Characters settle left to right out of noise.
  function decrypt(node, text) {
    if (reduceMotion) { node.textContent = text; return; }
    var glyphs = "▪▫◆◇○●◦⋅∴∵", t = 0, total = 22;
    var timer = setInterval(function () {
      t++;
      var keep = Math.floor((t / total) * text.length), s = "";
      for (var i = 0; i < text.length; i++) s += i < keep ? text[i] : glyphs[Math.floor(Math.random() * glyphs.length)];
      node.textContent = s;
      if (t >= total) { clearInterval(timer); node.textContent = text; }
    }, 34);
  }

  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (b) { return new Uint8Array(b); });
  }
  function hex(bytes) {
    var s = ""; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); return s;
  }

  // Local check: the answer is the decryption key; a wrong set of slots yields nothing.
  function openLocally(answer) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve({ offline: true });
    return sha256("tag|" + answer).then(function (t) {
      if (hex(t).slice(0, 16) !== CHECK) return { ok: false };
      return sha256("fragment|" + answer).then(function (k) {
        var out = "";
        for (var i = 0; i < SEALED.length; i++) out += String.fromCharCode(SEALED[i] ^ k[i]);
        return { ok: true, email: out };
      });
    });
  }

  function askServer(list) {
    return fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cells: list }), credentials: "omit" })
      .then(function (r) {
        if (r.status === 429) return { rate: true };
        var ct = r.headers.get("content-type") || "";
        if (!r.ok || ct.indexOf("application/json") === -1) return { offline: true };
        return r.json();
      })
      .catch(function () { return { offline: true }; });
  }

  function submit() {
    if (busy || solvedEmail) return;
    busy = true;
    sendBtn.disabled = clearBtn.disabled = true;
    say("…", "");
    var list = Object.keys(lit).map(Number).sort(function (a, b) { return a - b; });
    (ENDPOINT ? askServer(list) : openLocally(list.join(",")))
      .catch(function () { return { offline: true }; })
      .then(function (res) {
        busy = false;
        if (res && res.ok === true && typeof res.email === "string") { unlock(res.email); return; }
        sendBtn.disabled = clearBtn.disabled = !Object.keys(lit).length;
        if (res && res.rate) say("Too many attempts. Rest a minute, then try again.", "warn");
        else if (res && res.offline) say("The lock is unreachable right now. LinkedIn works.", "warn");
        else fail();
      });
  }

  openBtn.addEventListener("click", function () {
    if (!dialog) build();
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
  });
})();
