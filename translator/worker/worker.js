/*
 * Optional Layer-3 retrieval-augmented translation worker (Cloudflare Workers).
 *
 * WHY THIS IS OPTIONAL AND OFF BY DEFAULT
 * ---------------------------------------
 * The site is static (GitHub Pages) and Layers 1-2.5 run entirely in the
 * browser from the indexed TSV. This worker only matters for input that is NOT
 * covered by the dataset, where the frontend otherwise says "no verified
 * translation". It calls an LLM, but ONLY with real English->Buxori examples
 * retrieved from the TSV (passed in by the client), and instructs the model to
 * reuse that attested Bukhori vocabulary rather than substitute Tajik/Persian/
 * Russian. The output is always flagged in the UI as AI-assisted, never as a
 * verified dataset entry.
 *
 * SECURITY: the Anthropic API key lives only in the Worker secret
 * (ANTHROPIC_API_KEY). It is never shipped to, or reachable from, the browser.
 *
 * DEPLOY (see translator/README.md for the full walkthrough):
 *   npm i -g wrangler
 *   wrangler secret put ANTHROPIC_API_KEY
 *   wrangler deploy
 * Then set RAG_ENDPOINT in index.html to the deployed URL.
 *
 * If you never deploy this, nothing breaks — the translator stays a faithful
 * dataset lookup tool.
 */

const MODEL = "claude-opus-4-8";            // override via env.MODEL
const MAX_INPUT = 500;                       // chars
const MAX_EXAMPLES = 12;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "server not configured" }, 503, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, cors); }

    const text = String(body.text || "").slice(0, MAX_INPUT).trim();
    if (!text) return json({ error: "empty input" }, 400, cors);

    const examples = Array.isArray(body.examples)
      ? body.examples.slice(0, MAX_EXAMPLES).filter((e) => e && e.en && e.bux)
      : [];
    // Refuse to "translate" with no grounding — that would be exactly the
    // generic-LLM behaviour the project forbids.
    if (examples.length === 0) {
      return json({ error: "no dataset examples supplied; refusing ungrounded translation" }, 422, cors);
    }

    const exampleBlock = examples
      .map((e) => `English: ${sanitize(e.en)}\nBuxori: ${sanitize(e.bux)}`)
      .join("\n\n");

    const system =
      "You translate English into Buxori (Bukharian, a Judeo-Tajik language), " +
      "written in the Latin transliteration used by the reference examples. " +
      "You MUST ground every choice in the provided English->Buxori examples: " +
      "reuse their vocabulary, spelling, diacritics (ü, á, é, í, ö, etc.), and " +
      "word order. Do NOT substitute Standard Tajik, Persian, Dari, or Russian " +
      "words. If the examples do not cover a needed word, keep the English word " +
      "as-is rather than inventing Buxori. Output ONLY the Buxori translation, " +
      "no explanations, no quotes.";

    const user =
      `Reference English->Buxori examples from the dataset:\n\n${exampleBlock}\n\n` +
      `Translate this English into Buxori, following the examples' vocabulary and style:\n"${sanitize(text)}"`;

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: env.MODEL || MODEL,
          max_tokens: 300,
          temperature: 0,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        return json({ error: "upstream " + resp.status, detail: t.slice(0, 200) }, 502, cors);
      }
      const data = await resp.json();
      const bux = (data.content && data.content[0] && data.content[0].text || "").trim();
      if (!bux) return json({ error: "empty model output" }, 502, cors);
      return json({ bux, confidence: 0.5, source: "rag", grounded_on: examples.length }, 200, cors);
    } catch (err) {
      return json({ error: "request failed", detail: String(err).slice(0, 200) }, 502, cors);
    }
  },
};

function sanitize(s) {
  // Collapse whitespace; strip control chars. Keep all Bukhori diacritics.
  return String(s).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}
