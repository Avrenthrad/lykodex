// Server-only. Never import this from browser code — it is the only
// place a stored provider key is attached to an outbound request, and
// it is also where we refuse to turn the proxy into an open relay.
//
// api/pricing.js (?service=assistant) and the dev-only Vite middleware
// both call dispatchAssistant() in assistantApi.js, which calls into
// here. The browser only ever sends a provider id plus the chat text.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const ASSISTANT_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 24_000;
const MAX_MODEL_CHARS = 128;
const MAX_URL_CHARS = 300;
const ROLES = new Set(["system", "user", "assistant"]);

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".localdomain"];
const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google",
  "instance-data",
]);

function fail(status, error) {
  return { ok: false, status, error };
}

function scrubSecret(text, secret) {
  if (typeof text !== "string") return "";
  const trimmed = text.length > 500 ? `${text.slice(0, 500)}…` : text;
  if (!secret) return trimmed;
  return trimmed.split(secret).join("[redacted]");
}

export function maskApiKey(apiKey) {
  if (!apiKey) return "";
  if (apiKey.length <= 4) return "••••";
  return `••••${apiKey.slice(-4)}`;
}

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) + n;
  }
  return value >>> 0;
}

function inCidr(ip, base, bits) {
  const addr = ipv4ToInt(ip);
  const network = ipv4ToInt(base);
  if (addr == null || network == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (addr & mask) === (network & mask);
}

// Ranges a public chat proxy must never dial: loopback, link-local
// (cloud metadata), RFC1918, CGNAT, multicast, and documentation nets.
const IPV4_BLOCKED = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedIpv4(ip) {
  return IPV4_BLOCKED.some(([base, bits]) => inCidr(ip, base, bits));
}

function isBlockedIp(address) {
  const ipVersion = isIP(address);
  if (ipVersion === 4) return isBlockedIpv4(address);
  if (ipVersion !== 6) return true;

  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    return isIP(mapped) !== 4 || isBlockedIpv4(mapped);
  }
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
  if (/^f[cd]/i.test(lower) || /^fe[89ab]/i.test(lower) || lower.startsWith("ff")) return true;
  if (lower.startsWith("2001:db8:")) return true;
  return false;
}

export function isExplicitLocalhost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function hostnameBlockedByName(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTS.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return false;
}

async function defaultResolveHost(hostname) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

// Returns the normalized API root (no trailing slash, no
// /chat/completions suffix) or a failure. `allowLocalhost` is true
// only for the local Vite dev server — production (anything with
// VERCEL set) requires https and a public address.
export async function assertSafeProviderUrl(baseUrl, { allowLocalhost = false, resolveHost = defaultResolveHost } = {}) {
  if (typeof baseUrl !== "string" || !baseUrl.trim() || baseUrl.trim().length > MAX_URL_CHARS) {
    return fail(400, "A provider base URL is required.");
  }

  let url;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return fail(400, "That base URL is not valid.");
  }

  if (url.username || url.password) return fail(400, "The base URL can't include a username or password.");
  if (url.search || url.hash) return fail(400, "The base URL can't include a query or hash.");

  const localhost = isExplicitLocalhost(url.hostname);
  if (url.protocol === "http:") {
    if (!(allowLocalhost && localhost)) {
      return fail(400, "Hosted providers need an https URL. http is only allowed for localhost in local dev.");
    }
  } else if (url.protocol !== "https:") {
    return fail(400, "The base URL must be https.");
  }

  if (hostnameBlockedByName(url.hostname) && !(allowLocalhost && localhost)) {
    return fail(400, "That host isn't allowed.");
  }

  const bareHost = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bareHost)) {
    if (isBlockedIp(bareHost) && !(allowLocalhost && localhost)) {
      return fail(400, "That address isn't allowed.");
    }
  } else if (!(allowLocalhost && localhost)) {
    let addresses;
    try {
      addresses = await resolveHost(url.hostname);
    } catch {
      return fail(400, "Could not resolve that host.");
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return fail(400, "Could not resolve that host.");
    }
    if (addresses.some((address) => isBlockedIp(address))) {
      return fail(400, "That host resolves to an address that isn't allowed.");
    }
  }

  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/chat\/completions$/i, "");
  const port = url.port ? `:${url.port}` : "";
  const root = `${url.protocol}//${url.hostname}${port}${path}`;
  return { ok: true, root, localhost };
}

export function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return fail(400, "At least one message is required.");
  }
  if (messages.length > MAX_MESSAGES) return fail(400, `Send at most ${MAX_MESSAGES} messages.`);

  let total = 0;
  const clean = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return fail(400, "Each message must be an object.");
    }
    if (!ROLES.has(message.role)) return fail(400, "Message role must be system, user, or assistant.");
    if (typeof message.content !== "string") return fail(400, "Message content must be text.");
    if (message.content.length > MAX_MESSAGE_CHARS) return fail(400, "A message is too long.");
    total += message.content.length;
    if (total > MAX_TOTAL_CHARS) return fail(400, "The conversation is too long.");
    clean.push({ role: message.role, content: message.content });
  }
  return { ok: true, messages: clean };
}

export function normalizeModel(model) {
  if (typeof model !== "string") return fail(400, "A model name is required.");
  const trimmed = model.trim();
  if (!trimmed || trimmed.length > MAX_MODEL_CHARS) return fail(400, "A model name is required.");
  if (!/^[\w.:@/+-]{1,128}$/.test(trimmed)) return fail(400, "That model name isn't allowed.");
  return { ok: true, model: trimmed };
}

async function readLimitedText(resp) {
  if (!resp.body || typeof resp.body.getReader !== "function") {
    const text = await resp.text();
    if (text.length > MAX_RESPONSE_CHARS) {
      return fail(502, "The provider response was too large.");
    }
    return { ok: true, text };
  }

  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_CHARS) {
      await reader.cancel().catch(() => {});
      return fail(502, "The provider response was too large.");
    }
    chunks.push(value);
  }
  return { ok: true, text: new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))) };
}

function pickUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const picked = {};
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
    if (Number.isFinite(usage[key])) picked[key] = usage[key];
  }
  return Object.keys(picked).length ? picked : null;
}

// `root` must already have passed assertSafeProviderUrl. Redirects are
// not followed: a 302 to a metadata address would bypass the check.
export async function assistantChat({
  root,
  apiKey,
  model,
  messages,
  timeoutMs = ASSISTANT_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(`${root}/chat/completions`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    });

    if (resp.status >= 300 && resp.status < 400) {
      return fail(502, "The provider tried to redirect the request, which isn't allowed.");
    }

    const read = await readLimitedText(resp);
    if (!read.ok) return read;

    let data = null;
    try {
      data = read.text ? JSON.parse(read.text) : null;
    } catch {
      data = null;
    }

    if (!resp.ok) {
      const providerMsg = data?.error?.message || data?.error || read.text || `Provider returned ${resp.status}`;
      const asText = typeof providerMsg === "string" ? providerMsg : "Provider request failed.";
      return fail(502, scrubSecret(asText, apiKey) || "Provider request failed.");
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return fail(502, "The provider returned an unexpected response.");
    }
    const echoedModel = typeof data?.model === "string" && data.model.length <= MAX_MODEL_CHARS ? data.model : model;
    return { ok: true, status: 200, message: content, model: echoedModel, usage: pickUsage(data?.usage) };
  } catch (err) {
    if (err?.name === "AbortError") return fail(504, "The provider took too long to respond.");
    return fail(502, "Could not reach the provider.");
  } finally {
    clearTimeout(timer);
  }
}
