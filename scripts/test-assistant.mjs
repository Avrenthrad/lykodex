// Mocked checks for the assistant proxy. No Supabase credentials and
// no real provider key are required: storage is an in-memory stand-in
// for the service_role table, and the provider is either a fake
// fetch or a localhost HTTP server.
//
//   node scripts/test-assistant.mjs

import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { dispatchAssistant } from "../src/lib/assistantApi.js";
import { maskApiKey } from "../src/lib/assistantProxy.js";

const SECRET = "sk-test-secret-do-not-leak-9f3a";
const USER = "11111111-1111-4111-8111-111111111111";

function createMemoryDb() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    async list(userId) {
      return rows.filter((row) => row.user_id === userId);
    },
    async get(userId, id) {
      return rows.find((row) => row.user_id === userId && row.id === id) || null;
    },
    async insert(row) {
      seq += 1;
      const stored = {
        ...row,
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        created_at: new Date().toISOString(),
      };
      rows.push(stored);
      return stored;
    },
    async remove(userId, id) {
      const index = rows.findIndex((row) => row.user_id === userId && row.id === id);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}

const resolveHost = async (hostname) => {
  if (hostname === "public.example") return ["93.184.216.34"];
  if (hostname === "rebind.example") return ["10.0.0.5"];
  throw new Error(`unexpected resolve ${hostname}`);
};

function noFetch() {
  return async () => {
    throw new Error("fetch should not have been called");
  };
}

async function savePublic(db, extra = {}) {
  return dispatchAssistant({
    db,
    userId: USER,
    mode: "save",
    allowLocalhost: false,
    resolveHost,
    fetchImpl: noFetch(),
    body: {
      label: "OpenAI",
      baseUrl: "https://public.example/v1/chat/completions",
      apiKey: SECRET,
      model: "gpt-4o-mini",
      ...extra,
    },
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("mask hides the full key", () => {
  assert.equal(maskApiKey(SECRET), "••••9f3a");
  assert.equal(maskApiKey("ab"), "••••");
  assert.equal(maskApiKey(""), "");
});

test("save stores the key server-side and returns only a mask", async () => {
  const db = createMemoryDb();
  const saved = await savePublic(db);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.provider.keyHint, "••••9f3a");
  assert.equal(JSON.stringify(saved.body).includes(SECRET), false);
  assert.equal(db.rows[0].api_key, SECRET);
  assert.equal(db.rows[0].base_url, "https://public.example/v1");

  const listed = await dispatchAssistant({
    db,
    userId: USER,
    mode: "list",
    body: {},
    resolveHost,
    fetchImpl: noFetch(),
  });
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.body).includes(SECRET), false);
  assert.equal(listed.body.providers[0].keyHint, "••••9f3a");
  assert.equal(Object.hasOwn(listed.body.providers[0], "api_key"), false);
  assert.equal(Object.hasOwn(listed.body.providers[0], "apiKey"), false);
});

test("another user cannot see or chat with the provider", async () => {
  const db = createMemoryDb();
  const saved = await savePublic(db);
  const other = "22222222-2222-4222-8222-222222222222";
  const listed = await dispatchAssistant({
    db,
    userId: other,
    mode: "list",
    body: {},
    fetchImpl: noFetch(),
  });
  assert.deepEqual(listed.body.providers, []);
  const chat = await dispatchAssistant({
    db,
    userId: other,
    mode: "chat",
    allowLocalhost: false,
    resolveHost,
    fetchImpl: noFetch(),
    body: { providerId: saved.body.provider.id, messages: [{ role: "user", content: "hi" }] },
  });
  assert.equal(chat.status, 404);
});

test("chat uses the stored key and ignores any attempt to pass one", async () => {
  const db = createMemoryDb();
  const saved = await savePublic(db);
  let seenAuth = null;
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls += 1;
    seenAuth = init.headers.Authorization;
    const body = JSON.parse(init.body);
    assert.equal(body.stream, false);
    assert.deepEqual(Object.keys(body).sort(), ["messages", "model", "stream"]);
    assert.equal(init.redirect, "manual");
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: "hello back" } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, secret: SECRET },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const leaked = await dispatchAssistant({
    db,
    userId: USER,
    mode: "chat",
    allowLocalhost: false,
    resolveHost,
    fetchImpl,
    body: {
      providerId: saved.body.provider.id,
      baseUrl: "https://169.254.169.254/",
      apiKey: "sk-attacker",
      messages: [{ role: "user", content: "hi" }],
    },
  });
  assert.equal(leaked.status, 400);
  assert.equal(calls, 0);

  const chat = await dispatchAssistant({
    db,
    userId: USER,
    mode: "chat",
    allowLocalhost: false,
    resolveHost,
    fetchImpl,
    body: {
      providerId: saved.body.provider.id,
      messages: [{ role: "user", content: "hi", tool: "ignore-me" }],
    },
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.message, "hello back");
  assert.equal(seenAuth, `Bearer ${SECRET}`);
  assert.equal(JSON.stringify(chat.body).includes(SECRET), false);
  assert.deepEqual(chat.body.usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
});

test("unsigned callers and missing mode are rejected", async () => {
  const db = createMemoryDb();
  const anon = await dispatchAssistant({ db, userId: null, mode: "list", body: {} });
  assert.equal(anon.status, 401);
  const mode = await dispatchAssistant({ db, userId: USER, mode: "drop", body: {}, fetchImpl: noFetch() });
  assert.equal(mode.status, 400);
});

test("refuses non-https, private, metadata, and rebinding targets", async () => {
  const db = createMemoryDb();
  const cases = [
    ["http://public.example/v1", "https"],
    ["https://169.254.169.254/latest", "isn't allowed"],
    ["https://10.1.2.3/v1", "isn't allowed"],
    ["https://metadata.google.internal/", "isn't allowed"],
    ["https://rebind.example/v1", "resolves"],
    ["https://user:pass@public.example/v1", "username"],
    ["http://localhost:11434/v1", "localhost"],
    ["https://public.example/v1?x=1", "query"],
  ];
  for (const [baseUrl, needle] of cases) {
    const result = await dispatchAssistant({
      db,
      userId: USER,
      mode: "save",
      allowLocalhost: false,
      resolveHost,
      fetchImpl: noFetch(),
      body: { label: "x", baseUrl, apiKey: SECRET, model: "m" },
    });
    assert.equal(result.status, 400, baseUrl);
    assert.match(result.body.error, new RegExp(needle, "i"));
    assert.equal(db.rows.length, 0, baseUrl);
  }
});

test("localhost http is allowed only when dev explicitly opts in", async () => {
  const db = createMemoryDb();
  const blocked = await dispatchAssistant({
    db,
    userId: USER,
    mode: "save",
    allowLocalhost: false,
    fetchImpl: noFetch(),
    body: { baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", model: "llama3.1" },
  });
  assert.equal(blocked.status, 400);

  const allowed = await dispatchAssistant({
    db,
    userId: USER,
    mode: "save",
    allowLocalhost: true,
    fetchImpl: noFetch(),
    body: { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "llama3.1:8b" },
  });
  assert.equal(allowed.status, 200, allowed.body.error);
  assert.equal(db.rows[0].api_key, "");
  assert.equal(allowed.body.provider.keyHint, "");
});

test("caps messages and rejects non-text content before any fetch", async () => {
  const db = createMemoryDb();
  const saved = await savePublic(db);
  const huge = await dispatchAssistant({
    db,
    userId: USER,
    mode: "chat",
    resolveHost,
    fetchImpl: noFetch(),
    body: {
      providerId: saved.body.provider.id,
      messages: [{ role: "user", content: "x".repeat(8001) }],
    },
  });
  assert.equal(huge.status, 400);
  const structured = await dispatchAssistant({
    db,
    userId: USER,
    mode: "chat",
    resolveHost,
    fetchImpl: noFetch(),
    body: {
      providerId: saved.body.provider.id,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    },
  });
  assert.equal(structured.status, 400);
});

test("does not follow provider redirects and scrubs echoed keys", async () => {
  const db = createMemoryDb();
  const saved = await savePublic(db);
  const redirected = await dispatchAssistant({
    db,
    userId: USER,
    mode: "chat",
    resolveHost,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    body: { providerId: saved.body.provider.id, messages: [{ role: "user", content: "hi" }] },
  });
  assert.equal(redirected.status, 502);
  assert.match(redirected.body.error, /redirect/i);

  const echoed = await dispatchAssistant({
    db,
    userId: USER,
    mode: "chat",
    resolveHost,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: `bad key ${SECRET}` } }), { status: 401 }),
    body: { providerId: saved.body.provider.id, messages: [{ role: "user", content: "hi" }] },
  });
  assert.equal(echoed.status, 502);
  assert.equal(echoed.body.error.includes(SECRET), false);
  assert.match(echoed.body.error, /redacted/);
});

test("times out a provider that never answers", async () => {
  const db = createMemoryDb();
  const saved = await savePublic(db);
  const result = await dispatchAssistant({
    db,
    userId: USER,
    mode: "chat",
    resolveHost,
    timeoutMs: 30,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    }),
    body: { providerId: saved.body.provider.id, messages: [{ role: "user", content: "hi" }] },
  });
  assert.equal(result.status, 504);
});

test("delete removes only the caller's row", async () => {
  const db = createMemoryDb();
  const saved = await savePublic(db);
  const missing = await dispatchAssistant({
    db,
    userId: "22222222-2222-4222-8222-222222222222",
    mode: "delete",
    body: { id: saved.body.provider.id },
  });
  assert.equal(missing.status, 404);
  assert.equal(db.rows.length, 1);
  const removed = await dispatchAssistant({
    db,
    userId: USER,
    mode: "delete",
    body: { id: saved.body.provider.id },
  });
  assert.equal(removed.status, 200);
  assert.equal(db.rows.length, 0);
});

test("a missing table is a setup error, not a raw database dump", async () => {
  const db = {
    async list() {
      const err = new Error('relation "public.assistant_providers" does not exist');
      err.code = "42P01";
      throw err;
    },
  };
  const result = await dispatchAssistant({ db, userId: USER, mode: "list", body: {} });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /migration/i);
});

test("live localhost provider round-trip through the real fetch path", async () => {
  const hits = { chat: 0, secret: 0 };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/secret")) hits.secret += 1;
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      hits.chat += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        model: body.model,
        choices: [{ message: { content: `pong:${body.messages.at(-1).content}` } }],
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const db = createMemoryDb();
    const saved = await dispatchAssistant({
      db,
      userId: USER,
      mode: "save",
      allowLocalhost: true,
      body: {
        label: "Local",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: SECRET,
        model: "local-model",
      },
    });
    assert.equal(saved.status, 200, saved.body.error);
    const chat = await dispatchAssistant({
      db,
      userId: USER,
      mode: "chat",
      allowLocalhost: true,
      body: {
        providerId: saved.body.provider.id,
        messages: [{ role: "user", content: "ping" }],
      },
    });
    assert.equal(chat.status, 200, chat.body.error);
    assert.equal(chat.body.message, "pong:ping");
    assert.equal(JSON.stringify(chat.body).includes(SECRET), false);
    assert.equal(hits.secret, 0);
    assert.equal(hits.chat, 1);
  } finally {
    server.close();
  }
});

test("client source does not persist provider keys", () => {
  const client = readFileSync(new URL("../src/lib/assistant.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/components/AssistantPage.jsx", import.meta.url), "utf8");
  assert.equal(client.includes("localStorage"), true);
  assert.match(client, /assistant-active-provider/);
  assert.doesNotMatch(client, /assistant-providers:v1/);
  assert.doesNotMatch(page, /localStorage/);
  assert.doesNotMatch(page, /apiKey:\s*provider/);
  assert.match(page, /providerId: activeProvider.id/);
});

test("vite middleware and pricing handler both refuse a body key on chat", () => {
  const pricing = readFileSync(new URL("../api/pricing.js", import.meta.url), "utf8");
  const vite = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
  assert.match(pricing, /dispatchAssistant/);
  assert.match(pricing, /allowLocalhost: !process\.env\.VERCEL/);
  assert.match(vite, /allowLocalhost: true/);
  assert.doesNotMatch(vite, /assistantChat\(payload\)/);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(err);
  }
}

try {
  await import("../api/pricing.js");
  console.log("ok - api/pricing.js loads");
} catch (err) {
  failed += 1;
  console.error("not ok - api/pricing.js loads");
  console.error(err);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log(`\n${tests.length + 1} passed`);
