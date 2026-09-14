// Client helper: send a chat turn to the bring-your-own-LLM proxy.
// The provider config (base URL / key / model) is passed through to our
// own same-origin /api proxy, which does the actual call server-side —
// the browser never talks to the provider directly (many providers
// block browser-origin CORS, and it keeps the key off cross-origin
// requests). See src/lib/assistantProxy.js for the server core.

import { API_BASE } from "./apiBase";

export async function sendAssistantChat({ provider, messages }) {
  if (!provider) throw new Error("No provider configured.");

  const res = await fetch(`${API_BASE}/api/pricing?service=assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      messages,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
