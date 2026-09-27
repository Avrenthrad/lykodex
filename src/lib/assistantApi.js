// Server-only dispatch for ?service=assistant. The browser never
// receives api_key: list/save return maskApiKey()'s hint, and chat
// loads the key from assistant_providers inside this process.
//
// Callers must already have authenticated the user. Passing a
// client-supplied base URL or key on chat is rejected so this cannot
// be used as an open proxy.

import {
  assertSafeProviderUrl,
  assistantChat,
  maskApiKey,
  normalizeMessages,
  normalizeModel,
} from "./assistantProxy.js";

const MAX_PROVIDERS = 8;
const MAX_LABEL_CHARS = 60;
const MAX_KEY_CHARS = 512;
const MAX_BODY_CHARS = 64_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function http(status, body) {
  return { status, body };
}

export function toPublicProvider(row) {
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    model: row.model,
    keyHint: maskApiKey(row.api_key),
    createdAt: row.created_at,
  };
}

function normalizeLabel(label) {
  if (label == null || label === "") return { ok: true, label: "My provider" };
  if (typeof label !== "string") return { ok: false, error: "That provider name isn't allowed." };
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_LABEL_CHARS) return { ok: false, error: "That provider name isn't allowed." };
  if ([...trimmed].some((ch) => ch.charCodeAt(0) < 32)) {
    return { ok: false, error: "That provider name isn't allowed." };
  }
  return { ok: true, label: trimmed };
}

function normalizeApiKey(apiKey, { allowEmpty }) {
  if (apiKey == null || apiKey === "") {
    if (allowEmpty) return { ok: true, apiKey: "" };
    return { ok: false, error: "An API key is required for this provider." };
  }
  if (typeof apiKey !== "string" || apiKey.length > MAX_KEY_CHARS || /\s/.test(apiKey)) {
    return { ok: false, error: "That API key isn't allowed." };
  }
  return { ok: true, apiKey };
}

function storageFailure(err) {
  const message = String(err?.message || "");
  const code = String(err?.code || "");
  const missingTable = code === "42P01"
    || (/assistant_providers/i.test(message) && /does not exist|schema cache/i.test(message));
  if (missingTable) {
    return http(503, {
      error: "Assistant storage isn't set up yet. Run the assistant_providers migration in Supabase, then try again.",
    });
  }
  console.error("assistant storage:", code || message.slice(0, 200));
  return http(500, { error: "Couldn't reach assistant storage." });
}

export function supabaseAssistantDb(admin) {
  const columns = "id, label, base_url, api_key, model, created_at";
  return {
    async list(userId) {
      const { data, error } = await admin
        .from("assistant_providers")
        .select(columns)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async get(userId, id) {
      const { data, error } = await admin
        .from("assistant_providers")
        .select(columns)
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async insert(row) {
      const { data, error } = await admin
        .from("assistant_providers")
        .insert(row)
        .select(columns)
        .single();
      if (error) throw error;
      return data;
    },
    async remove(userId, id) {
      const { data, error } = await admin
        .from("assistant_providers")
        .delete()
        .eq("user_id", userId)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      return (data || []).length > 0;
    },
  };
}

export async function dispatchAssistant({
  db,
  userId,
  mode,
  body,
  allowLocalhost = false,
  fetchImpl,
  resolveHost,
  timeoutMs,
} = {}) {
  if (!userId) return http(401, { error: "Not signed in." });
  if (!db) return http(500, { error: "Server not configured for this." });

  const payload = body && typeof body === "object" ? body : {};
  try {
    if (JSON.stringify(payload).length > MAX_BODY_CHARS) {
      return http(413, { error: "Request body is too large." });
    }
  } catch {
    return http(400, { error: "Request body is not valid JSON." });
  }

  try {
    if (mode === "list") {
      const rows = await db.list(userId);
      return http(200, { providers: rows.map(toPublicProvider) });
    }

    if (mode === "save") {
      if (payload.providerId !== undefined) {
        return http(400, { error: "Save a new provider without a provider id." });
      }
      const label = normalizeLabel(payload.label);
      if (!label.ok) return http(400, { error: label.error });
      const model = normalizeModel(payload.model);
      if (!model.ok) return http(400, { error: model.error });
      const target = await assertSafeProviderUrl(payload.baseUrl, { allowLocalhost, resolveHost });
      if (!target.ok) return http(target.status, { error: target.error });
      const key = normalizeApiKey(payload.apiKey, { allowEmpty: Boolean(allowLocalhost && target.localhost) });
      if (!key.ok) return http(400, { error: key.error });

      const existing = await db.list(userId);
      if (existing.length >= MAX_PROVIDERS) {
        return http(400, { error: `You can save up to ${MAX_PROVIDERS} providers.` });
      }

      const row = await db.insert({
        user_id: userId,
        label: label.label,
        base_url: target.root,
        api_key: key.apiKey,
        model: model.model,
      });
      return http(200, { provider: toPublicProvider(row) });
    }

    if (mode === "delete") {
      if (typeof payload.id !== "string" || !UUID_RE.test(payload.id)) {
        return http(400, { error: "A provider id is required." });
      }
      const removed = await db.remove(userId, payload.id);
      if (!removed) return http(404, { error: "Provider not found." });
      return http(200, { ok: true });
    }

    if (mode === "chat") {
      // Credentials on this request would make the proxy an open relay
      // again. Chat may only name a row this user already saved.
      if (payload.baseUrl !== undefined || payload.apiKey !== undefined) {
        return http(400, { error: "Send providerId only. The provider URL and API key stay on the server." });
      }
      if (typeof payload.providerId !== "string" || !UUID_RE.test(payload.providerId)) {
        return http(400, { error: "A provider id is required." });
      }
      const messages = normalizeMessages(payload.messages);
      if (!messages.ok) return http(messages.status, { error: messages.error });

      const row = await db.get(userId, payload.providerId);
      if (!row) return http(404, { error: "Provider not found." });

      const target = await assertSafeProviderUrl(row.base_url, { allowLocalhost, resolveHost });
      if (!target.ok) {
        return http(400, { error: "This provider's URL is no longer allowed. Remove it and add an https endpoint." });
      }
      const model = normalizeModel(row.model);
      if (!model.ok) return http(400, { error: model.error });

      const chat = await assistantChat({
        root: target.root,
        apiKey: row.api_key,
        model: model.model,
        messages: messages.messages,
        timeoutMs,
        fetchImpl,
      });
      if (!chat.ok) return http(chat.status, { error: chat.error });
      return http(200, { message: chat.message, model: chat.model, usage: chat.usage });
    }

    return http(400, { error: "Missing or invalid mode parameter." });
  } catch (err) {
    return storageFailure(err);
  }
}
