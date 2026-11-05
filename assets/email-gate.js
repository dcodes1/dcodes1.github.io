/*
 * "Deflection" — the lock on the contact email.
 *
 * Three solved grids and one unsolved grid. The visitor lights the cells of the
 * fourth path and transmits them. This file contains the puzzle, never the
 * solution and never the email: the server endpoint (contact/worker.ts) checks
 * the answer and only then returns the address. Configure the endpoint with
 * data-endpoint on #emailGate (default /api/reveal).
 */
(function () {
  "use strict";
  var card = document.getElementById("emailGate");
  if (!card) return;

  var N = 7;
  // entry: [row, col, heading] with heading 0 up, 1 right, 2 down, 3 left.
  var PUZZLE = {
    examples: [
      { entry: [0, 3, 2], stones: [2, 5, 8, 17, 19, 32, 40, 44], path: [3, 9, 10, 16, 23, 30, 35, 36, 37] },
      { entry: [2, 0, 1], stones: [0, 17, 26, 27, 34, 37, 48], path: [14, 15, 16, 23, 30, 31, 32, 33, 40, 47] },
      { entry: [1, 0, 1], stones: [0, 3, 11, 34, 38], path: [7, 8, 9, 10, 17, 24, 31, 32, 33, 40, 47] },
    ],
    test: { entry: [6, 0, 0], stones: [1, 5, 8, 9, 11, 14, 20, 21, 25, 31, 41] },
  };
  var ENDPOINT = card.getAttribute("data-endpoint") || "/api/reveal";
  var LINKEDIN = "https://www.linkedin.com/in/davidgmilov/";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var openBtn = document.getElementById("emailOpen");
  var handle = document.getElementById("emailHandle");
  var dialog = null, cells = [], lit = {}, msgEl, sendBtn, clearBtn, boardEl, busy = false, solvedEmail = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // A grid with its entry notch. interactive: test grid made of buttons.
  function grid(spec, interactive, label) {
    var wrap = el("div", "dg-wrap" + (interactive ? " dg-main" : ""));
    var g = el("div", "dg");
    g.setAttribute("role", interactive ? "group" : "img");
    g.setAttribute("aria-label", label);
    var stones = {}, path = {};
    spec.stones.forEach(function (i) { stones[i] = 1; });
    (spec.path || []).forEach(function (i) { path[i] = 1; });
    for (var i = 0; i < N * N; i++) {
      var r = Math.floor(i / N), c = i % N, cell;
      if (stones[i]) {
        cell = el("span", "dc dc-stone");
        cell.setAttribute("aria-hidden", "true");
      } else if (interactive) {
        cell = el("button", "dc dc-tap");
        cell.type = "button";
        cell.setAttribute("aria-pressed", "false");
        cell.setAttribute("aria-label", "Row " + (r + 1) + ", column " + (c + 1));
        cell.dataset.i = String(i);
        cells.push(cell);
      } else {
        cell = el("span", "dc" + (path[i] ? " dc-lit" : ""));
        cell.setAttribute("aria-hidden", "true");
      }
      g.appendChild(cell);
    }
    var e = spec.entry, notch = el("span", "dg-notch dg-notch-" + ["up", "right", "down", "left"][e[2]]);
    notch.setAttribute("aria-hidden", "true");
    notch.style.setProperty("--p", String(((e[2] === 1 || e[2] === 3 ? e[0] : e[1]) + 0.5) / N));
    wrap.appendChild(g);
    wrap.appendChild(notch);
    return wrap;
  }

  function setLit(i, on) {
    var b = cells.filter(function (x) { return x.dataset.i === String(i); })[0];
    if (!b) return;
    if (on) lit[i] = 1; else delete lit[i];
    b.classList.toggle("on", !!on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    sendBtn.disabled = !Object.keys(lit).length || busy;
    clearBtn.disabled = !Object.keys(lit).length || busy;
  }

  // Tap toggles; dragging paints (or erases, if the drag started on a lit cell).
  function wirePainting(board) {
    var painting = false, mode = true, last = null, moved = false;
    function cellAt(x, y) {
      var t = document.elementFromPoint(x, y);
      return t && t.classList && t.classList.contains("dc-tap") ? t : null;
    }
    board.addEventListener("pointerdown", function (ev) {
      var t = ev.target.closest && ev.target.closest(".dc-tap");
      if (!t || busy || solvedEmail) return;
      painting = true; moved = false; last = t;
      mode = !lit[t.dataset.i];
      setLit(t.dataset.i, mode);
      board.setPointerCapture && board.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    board.addEventListener("pointermove", function (ev) {
      if (!painting) return;
      var t = cellAt(ev.clientX, ev.clientY);
      if (t && t !== last) { moved = true; last = t; setLit(t.dataset.i, mode); }
    });
    function end() { painting = false; last = null; }
    board.addEventListener("pointerup", end);
    board.addEventListener("pointercancel", end);
    // Keyboard and assistive tech: a click without a pointer gesture toggles.
    board.addEventListener("click", function (ev) {
      var t = ev.target.closest && ev.target.closest(".dc-tap");
      if (!t || ev.detail !== 0 || busy || solvedEmail) return;
      setLit(t.dataset.i, !lit[t.dataset.i]);
    });
    void moved;
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
    var title = el("h3", "vault-title", "Deflection");
    title.id = "vaultTitle";
    head.appendChild(title);
    var prompt = el("p", "vault-prompt", "Three paths are known. Complete the fourth.");

    var row = el("div", "vault-examples");
    PUZZLE.examples.forEach(function (x, k) { row.appendChild(grid(x, false, "Solved example " + (k + 1))); });

    boardEl = grid(PUZZLE.test, true, "Unsolved grid: light the cells of the path");
    wirePainting(boardEl.querySelector(".dg"));

    var controls = el("div", "vault-controls");
    clearBtn = el("button", "eg-btn eg-ghost", "Clear");
    clearBtn.type = "button";
    clearBtn.disabled = true;
    clearBtn.addEventListener("click", function () { Object.keys(lit).forEach(function (i) { setLit(i, false); }); });
    sendBtn = el("button", "eg-btn", "Transmit");
    sendBtn.type = "button";
    sendBtn.disabled = true;
    sendBtn.addEventListener("click", submit);
    controls.appendChild(clearBtn);
    controls.appendChild(sendBtn);

    msgEl = el("p", "vault-msg");
    msgEl.setAttribute("aria-live", "polite");
    var hint = el("p", "vault-controls-hint", "Tap or drag to light cells.");
    var alt = el("p", "vault-alt");
    alt.innerHTML = 'Rather not? <a href="' + LINKEDIN + '" target="_blank" rel="noopener">Message me on LinkedIn</a>.';

    [close, head, prompt, row, boardEl, hint, controls, msgEl, alt].forEach(function (n) { inner.appendChild(n); });
    dialog.appendChild(inner);
    dialog.addEventListener("click", function (ev) { if (ev.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
  }

  function say(text, kind) {
    msgEl.textContent = text;
    msgEl.className = "vault-msg" + (kind ? " " + kind : "");
  }

  function fail() {
    var g = boardEl.querySelector(".dg");
    g.classList.remove("dg-wrong");
    void g.offsetWidth;
    g.classList.add("dg-wrong");
    say("The lock holds.", "warn");
  }

  // Order the lit cells as a path walked from the entry (for the unlock trace).
  function traceOrder() {
    var e = PUZZLE.test.entry, start = e[0] * N + e[1], seen = {}, out = [], queue = [start];
    if (!lit[start]) return Object.keys(lit).map(Number);
    seen[start] = 1;
    while (queue.length) {
      var i = queue.shift(); out.push(i);
      var r = Math.floor(i / N), c = i % N;
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(function (p) {
        var j = p[0] * N + p[1];
        if (p[0] >= 0 && p[0] < N && p[1] >= 0 && p[1] < N && lit[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
      });
    }
    return out;
  }

  function unlock(email) {
    solvedEmail = email;
    var order = traceOrder(), step = reduceMotion ? 0 : 70;
    order.forEach(function (i, k) {
      setTimeout(function () {
        var b = cells.filter(function (x) { return x.dataset.i === String(i); })[0];
        if (b) b.classList.add("trace");
      }, k * step);
    });
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
      // The card on the page shows the address too, for the rest of the visit.
      handle.textContent = "";
      var a = el("a", "eg-link", email);
      a.href = "mailto:" + email;
      handle.appendChild(a);
      openBtn.textContent = "Show again";
      card.classList.add("revealed");
    }, order.length * step + (reduceMotion ? 0 : 250));
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

  function submit() {
    if (busy || solvedEmail) return;
    busy = true;
    sendBtn.disabled = clearBtn.disabled = true;
    say("…", "");
    var payload = JSON.stringify({ cells: Object.keys(lit).map(Number).sort(function (a, b) { return a - b; }) });
    fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, credentials: "omit" })
      .then(function (r) {
        if (r.status === 429) return { rate: true };
        var ct = r.headers.get("content-type") || "";
        if (!r.ok || ct.indexOf("application/json") === -1) return { offline: true };
        return r.json();
      })
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
