# Email lock: server side

The contact card on the portfolio opens a puzzle ("Deflection",
`assets/email-gate.js`). The browser has the puzzle, but **not the solution
and not the email address**. It posts the lit cells to `POST /api/reveal`;
this Worker checks them and only then returns the address.

```
browser ──POST {cells:[…]}──▶ /api/reveal (Cloudflare Worker)
                              1. Origin must be davidmilov.com
                              2. rate limit: 5 attempts / minute / IP  → 429
                              3. validate input (unique ints 0–48)     → 400
                              4. compare with secret ANSWER            → {ok:false}
                              5. match                                 → {ok:true, email: secret EMAIL}
```

Until the Worker is deployed, the lock says it is unreachable and points to
LinkedIn. The site itself never contains the address.

## Deploy (once)

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

## What this does and does not protect

- **It does:** the address is in no public file, so scrapers that read the
  repository or the HTML don't get it. Brute force is impractical: the answer
  is a specific set of 12 of 38 cells (over 2 billion possible sets), with 5
  tries per minute per IP. The solution is not in the client, so it can't be
  extracted from the JavaScript.
- **It does not:** stop a person who solves the puzzle once from sharing the
  address. The rate limiter counts per Cloudflare location and is
  approximate. It is a courtesy gate, not access control.
- **Optional hardening:** add Cloudflare Turnstile to the form and verify its
  token in the Worker before checking the answer. Rotate `EMAIL` (for example to
  an alias) if it starts attracting spam.

Tests: `tests/contact-worker.test.ts` (uses a fake answer and address) and the
lock section of `tests/e2e/site.e2e.mjs` (mock endpoint).
