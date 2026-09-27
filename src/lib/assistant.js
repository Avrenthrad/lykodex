// Client helper for the bring-your-own-LLM proxy. The API key is sent
// once, on save, and is never read back. Chat names a provider id;
// api/pricing.js loads the key with the service-role client.
//
// The only thing kept in this browser is which provider row is
// selected (a uuid). That is not a secret — the key itself lives in
// assistant_providers.

import { API_BASE } from "./apiBase";
import { supabase } from "./supabaseClient";

const ACTIVE_PROVIDER_KEY = "lykodex:assistant-active-provider";

async function callAssistant(mode, body) {
  if (!supabase) throw new Error("Accounts aren't set up yet.");
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const res = await fetch(`${API_BASE}/api/pricing?service=assistant&mode=${encodeURIComponent(mode)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export function listAssistantProviders() {
  return callAssistant("list");
}

export function saveAssistantProvider(provider) {
  return callAssistant("save", {
    label: provider.label,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
  });
}

export function deleteAssistantProvider(id) {
  return callAssistant("delete", { id });
}

export function sendAssistantChat({ providerId, messages }) {
  return callAssistant("chat", { providerId, messages });
}

export function loadActiveProviderId() {
  try {
    return localStorage.getItem(ACTIVE_PROVIDER_KEY) || "";
  } catch {
    return "";
  }
}

export function saveActiveProviderId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_PROVIDER_KEY, id);
    else localStorage.removeItem(ACTIVE_PROVIDER_KEY);
  } catch {
    // Private-mode storage can throw; the selection just won't stick.
  }
}
