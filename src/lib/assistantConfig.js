// Client-side storage for the user's LLM provider(s).
//
// PROTOTYPE-GRADE, read this before extending: providers — including
// each API key — live in this browser's localStorage and are sent
// per-request to our own same-origin /api proxy, which forwards them to
// the chosen OpenAI-compatible endpoint. That keeps the prototype
// self-contained (no account or DB needed to try it) but is
// deliberately NOT the production posture: everywhere else in Lykodex a
// third-party secret lives in a service_role-only Supabase table and
// never reaches the browser (see xbox_tokens / psn_tokens, proxied via
// api/pricing.js). Before shipping this for real, move provider rows +
// keys into such a table keyed by user_id and have the proxy read them
// server-side, so a key is never persisted in or sent from the client.

const STORAGE_KEY = "lykodex:assistant-providers:v1";

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadAssistantConfig() {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  const parsed = safeParse(raw);
  if (!parsed || !Array.isArray(parsed.providers)) return { providers: [], activeId: null };
  return {
    providers: parsed.providers,
    activeId: parsed.activeId ?? parsed.providers[0]?.id ?? null,
  };
}

export function saveAssistantConfig(config) {
  const next = {
    providers: Array.isArray(config?.providers) ? config.providers : [],
    activeId: config?.activeId ?? null,
  };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function makeProviderId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getActiveProvider(config) {
  if (!config?.providers?.length) return null;
  return config.providers.find((p) => p.id === config.activeId) || config.providers[0];
}
