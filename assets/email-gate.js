/*
 * Email reveal gate. The address is not in the page source (so scrapers and
 * Cloudflare's obfuscation never see it); it is decoded only after the visitor
 * answers a quick puzzle: small arithmetic or "next number in the sequence".
 */
(function () {
  "use strict";
  var root = document.getElementById("emailGate");
  if (!root) return;

  // XOR-encoded, reversed character codes of the address.
  var CODE = [55, 53, 57, 116, 54, 51, 59, 55, 61, 26, 104, 44, 53, 54, 51, 55, 62, 51, 44, 59, 62];
  var KEY = 0x5a;

  var reveal = document.getElementById("emailReveal");
  var form = document.getElementById("emailForm");
  var question = document.getElementById("emailQuestion");
  var input = document.getElementById("emailAnswer");
  var msg = document.getElementById("emailMsg");
  var handle = document.getElementById("emailHandle");
  var answer = null;
  var tries = 0;

  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  function newPuzzle() {
    var kind = rnd(0, 2), q, a;
    if (kind === 0) {                      // arithmetic
      var x = rnd(3, 12), y = rnd(2, 9), op = ["+", "−", "×"][rnd(0, 2)];
      if (op === "−" && y > x) { var t = x; x = y; y = t; }
      a = op === "+" ? x + y : op === "−" ? x - y : x * y;
      q = "What is " + x + " " + op + " " + y + "?";
    } else if (kind === 1) {               // arithmetic sequence
      var s = rnd(1, 9), d = rnd(2, 7);
      q = "Next number: " + [s, s + d, s + 2 * d, s + 3 * d].join(", ") + ", ?";
      a = s + 4 * d;
    } else {                               // doubling sequence
      var g = rnd(1, 4);
      q = "Next number: " + [g, g * 2, g * 4, g * 8].join(", ") + ", ?";
      a = g * 16;
    }
    answer = a;
    question.textContent = q;
    input.value = "";
  }

  function decode() {
    var out = "";
    for (var i = CODE.length - 1; i >= 0; i--) out += String.fromCharCode(CODE[i] ^ KEY);
    return out;
  }

  function show() {
    var email = decode();
    handle.textContent = "";
    var a = document.createElement("a");
    a.href = "mailto:" + email;
    a.textContent = email;
    a.className = "eg-link";
    handle.appendChild(a);
    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "eg-btn eg-copy";
    copy.textContent = "Copy";
    copy.addEventListener("click", function () {
      var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy"; }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(email).then(done, function () {});
    });
    form.hidden = true;
    reveal.hidden = true;
    msg.textContent = "";
    root.querySelector(".eg-body").appendChild(copy);
    root.classList.add("revealed");
  }

  reveal.addEventListener("click", function () {
    newPuzzle();
    reveal.hidden = true;
    form.hidden = false;
    input.focus();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = parseInt(String(input.value).trim(), 10);
    if (v === answer) { show(); return; }
    tries++;
    msg.textContent = tries >= 3 ? "Not quite. Here's a different one." : "Not quite. Try another one.";
    newPuzzle();
    input.focus();
  });
})();
