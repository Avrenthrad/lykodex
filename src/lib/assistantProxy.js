// Server-side core for the "bring your own LLM" assistant. It forwards
// a chat request to any OpenAI-compatible endpoint using the
// caller-supplied base URL + key + model.
//
// IMPORTANT: this is a server-only module — it is where the user's key
// touches the wire. It must never be imported by browser code. The
// client talks to it only through the /api proxy. Two thin adapters
// reuse this one core: api/pricing.js's `service=assistant` dispatch
// (production, on Vercel) and the dev-only Vite middleware in
// vite.config.js (so `npm run dev` can serve /api without the Vercel
// CLI, which isn't installed here).

const DEFAULT_TIMEOUT_MS = 30000;

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== "string") return null;
  let url = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) return null;
  // Accept either an API root (…/v1) or a full …/chat/completions and
  // normalize to the root, so a caller can paste whichever they have.
  url = url.replace(/\/chat\/completions$/i, "");
  return url;
}

export async function assistantChat({ baseUrl, apiKey, model, messages, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const root = normalizeBaseUrl(baseUrl);
  if (!root) return { ok: false, status: 400, error: "A valid http(s) base URL is required." };
  if (!model || typeof model !== "string") return { ok: false, status: 400, error: "A model name is required." };
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, error: "At least one message is required." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    });

    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON error body (e.g. an HTML 502 from a proxy) — surfaced as text below.
    }

    if (!resp.ok) {
      const providerMsg = data?.error?.message || data?.error || text || `Provider returned ${resp.status}`;
      return {
        ok: false,
        status: resp.status,
        error: typeof providerMsg === "string" ? providerMsg : JSON.stringify(providerMsg),
      };
    }

    const message = data?.choices?.[0]?.message?.content ?? "";
    return { ok: true, status: 200, message, model: data?.model || model, usage: data?.usage || null };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ok: false, status: 504, error: "The provider took too long to respond." };
    }
    return { ok: false, status: 502, error: `Could not reach the provider: ${err?.message || String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}
