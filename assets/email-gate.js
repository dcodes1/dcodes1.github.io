/*
 * "Deflection": the lock on the contact email.
 *
 * Three solved grids and one unsolved grid. The visitor lights the cells of the
 * fourth path and transmits them.
 *
 * The page never contains the solution or a readable address. The address is
 * stored XOR-encrypted with a key derived from the answer (SHA-256), plus a short
 * check value. Only the correct set of cells produces the key. Optionally, set
 * data-endpoint on #emailGate to have a server (contact/worker.ts) check the
 * answer instead.
 */
(function () {
  "use strict";
  var card = document.getElementById("emailGate");
  if (!card) return;

  var N = 7;
  // entry: [row, col, heading] with heading 0 up, 1 right, 2 down, 3 left.
  var PUZZLE = {
    examples: [
      { entry: [1, 0, 1], stones: [1, 12, 15, 34, 39], path: [7, 8, 9, 10, 11, 18, 25, 28, 29, 30, 31, 32] },
      { entry: [6, 6, 3], stones: [1, 24, 26, 37, 44], path: [31, 32, 33, 34, 38, 45, 46, 47, 48] },
      { entry: [6, 2, 0], stones: [4, 9, 20, 41, 46], path: [16, 17, 18, 19, 23, 26, 30, 33, 37, 40, 44, 47] },
    ],
    test: { entry: [0, 5, 2], stones: [6, 11, 22, 33, 38, 39] },
  };
  var SEALED = [146, 83, 114, 101, 187, 36, 169, 234, 161, 13, 187, 70, 243, 92, 131, 72, 225, 182, 180, 193, 252];
  var CHECK = "769cab8d5d8cc53c";
  var ENDPOINT = card.getAttribute("data-endpoint") || "";
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

  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (b) { return new Uint8Array(b); });
  }
  function hex(bytes) {
    var s = ""; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); return s;
  }

  // Local check: the answer is the decryption key; a wrong set of cells yields nothing.
  function openLocally(answer) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve({ offline: true });
    return sha256("tag|" + answer).then(function (t) {
      if (hex(t).slice(0, 16) !== CHECK) return { ok: false };
      return sha256("deflection|" + answer).then(function (k) {
        var out = "";
        for (var i = 0; i < SEALED.length; i++) out += String.fromCharCode(SEALED[i] ^ k[i]);
        return { ok: true, email: out };
      });
    });
  }

  function askServer(cellsList) {
    return fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cells: cellsList }), credentials: "omit" })
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
