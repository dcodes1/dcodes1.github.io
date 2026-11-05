# Email lock

The contact card on the portfolio opens a puzzle ("Deflection",
`assets/email-gate.js`): three solved grids show a beam that turns right at
every stone, and the visitor lights the path of a fourth.

## How it opens (default: no server)

The page contains the puzzle but **not the solution and not a readable
address**. The address is stored XOR-encrypted with `SHA-256("deflection|" +
answer)`, plus a 16-hex-digit check value `SHA-256("tag|" + answer)`. When the
visitor transmits, the browser hashes the lit cells. Only the right set of cells
matches the check value and decrypts the address. Nothing is sent over the
network.

- **Protects against:** scrapers, and anyone reading the HTML/JS or this
  repository.
- **Does not protect against:** a determined person who solves the puzzle, or
  who brute-forces the check value offline (about 10⁹ hashes). It is a courtesy
  gate, not access control.

To change the address or the puzzle, regenerate `SEALED` and `CHECK` from the
new answer. The recipe is in the private notes.

## Optional: server-checked mode (Cloudflare Worker)

For a stricter setup, deploy `contact/worker.ts` and set
`data-endpoint="/api/reveal"` on `#emailGate`. The browser then posts the cells
instead of decrypting locally; the Worker rate-limits per IP and returns the
address (a secret) only on a match. You can then also delete `SEALED`/`CHECK`
from `assets/email-gate.js`.

```
browser ──POST {cells:[…]}──▶ /api/reveal (Cloudflare Worker)
                              1. Origin must be davidmilov.com
                              2. rate limit: 5 attempts / minute / IP  → 429
                              3. validate input (unique ints 0–48)     → 400
                              4. compare with secret ANSWER            → {ok:false}
                              5. match                                 → {ok:true, email: secret EMAIL}
```

### Deploying the Worker

Requirements: the Cloudflare account that proxies `davidmilov.com`, and Node ≥ 22.

```bash
cd contact
npx wrangler@4 login
npx wrangler@4 secret put EMAIL     # paste the address
npx wrangler@4 secret put ANSWER    # paste the solution string from your private notes
npx wrangler@4 deploy
```

`wrangler.toml` routes `davidmilov.com/api/reveal` (and `www.`) to the Worker,
so the page calls its own domain and needs no CORS setup. The rate limiter is
the Workers Rate Limiting binding (Wrangler ≥ 4.36).

Check it:

```bash
curl -s -X POST https://davidmilov.com/api/reveal \
  -H 'Origin: https://davidmilov.com' -H 'content-type: application/json' \
  -d '{"cells":[0]}'
# → {"ok":false}
```

To serve the endpoint elsewhere (e.g. `*.workers.dev`), set
`data-endpoint="https://…/api/reveal"` on `#emailGate` in `index.html` and keep
`ALLOWED_ORIGINS` pointing at the site.

### What server mode does and does not protect

- **It does:** the solution is not in the client. With 5 tries per minute per
  IP, guessing through the endpoint is impractical (the answer is 10 specific
  cells of 43, about 1.9 billion possible sets of that size).
- **It does not:** stop a person who solves the puzzle once from sharing the
  address. The rate limiter counts per Cloudflare location and is
  approximate. It is a courtesy gate, not access control.
- **Optional hardening:** add Cloudflare Turnstile to the form and verify its
  token in the Worker before checking the answer. Rotate `EMAIL` (for example to
  an alias) if it starts attracting spam.

Tests: `tests/contact-worker.test.ts` (uses a fake answer and address) and the
lock section of `tests/e2e/site.e2e.mjs` (mock endpoint).
