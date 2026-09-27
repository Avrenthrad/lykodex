import { useEffect, useRef, useState } from "react";
import {
  deleteAssistantProvider,
  listAssistantProviders,
  loadActiveProviderId,
  saveActiveProviderId,
  saveAssistantProvider,
  sendAssistantChat,
} from "../lib/assistant";

const EMPTY_FORM = { label: "", baseUrl: "", apiKey: "", model: "" };

export default function AssistantPage({ onBack }) {
  const [providers, setProviders] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef(null);
  const activeProvider = providers.find((provider) => provider.id === activeId) || null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    let cancelled = false;
    listAssistantProviders()
      .then((data) => {
        if (cancelled) return;
        const next = Array.isArray(data?.providers) ? data.providers : [];
        setProviders(next);
        const stored = loadActiveProviderId();
        const selected = next.find((provider) => provider.id === stored)?.id || next[0]?.id || "";
        setActiveId(selected);
        if (selected) saveActiveProviderId(selected);
        setShowForm(next.length === 0);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Couldn't load providers.");
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectProvider(id) {
    setActiveId(id);
    saveActiveProviderId(id);
    setMessages([]);
    setError("");
  }

  async function handleSaveProvider(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const data = await saveAssistantProvider({
        label: form.label.trim(),
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        model: form.model.trim(),
      });
      const saved = data?.provider;
      if (!saved?.id) throw new Error("Couldn't save that provider.");
      setProviders((current) => [...current, saved]);
      setActiveId(saved.id);
      saveActiveProviderId(saved.id);
      setForm(EMPTY_FORM);
      setShowForm(false);
      setMessages([]);
    } catch (err) {
      setError(err?.message || "Couldn't save that provider.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveActive() {
    if (!activeProvider) return;
    setError("");
    try {
      await deleteAssistantProvider(activeProvider.id);
      const remaining = providers.filter((provider) => provider.id !== activeProvider.id);
      const nextId = remaining[0]?.id || "";
      setProviders(remaining);
      setActiveId(nextId);
      saveActiveProviderId(nextId);
      setMessages([]);
      if (remaining.length === 0) setShowForm(true);
    } catch (err) {
      setError(err?.message || "Couldn't remove that provider.");
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !activeProvider || loading) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setLoading(true);
    try {
      const data = await sendAssistantChat({ providerId: activeProvider.id, messages: nextMessages });
      setMessages([...nextMessages, { role: "assistant", content: data.message || "(empty response)" }]);
    } catch (err) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function handleComposerKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  return (
    <div className="price-page assistant-page">
      <div className="price-page__head">
        <div>
          <h1 className="price-page__title">Assistant</h1>
          <p className="price-page__subtitle">
            Bring your own LLM. Connect an OpenAI-compatible provider — the API key stays on your account.
          </p>
        </div>
        {onBack && (
          <button type="button" className="quickdash-reset-btn" onClick={onBack}>
            Back
          </button>
        )}
      </div>

      {loadingList ? (
        <p className="panel__status">Loading providers…</p>
      ) : (
        <div className="assistant-providers">
          {providers.length > 0 && (
            <label>
              Provider
              <select value={activeProvider?.id || ""} onChange={(e) => selectProvider(e.target.value)}>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label} · {provider.model}
                    {provider.keyHint ? ` · ${provider.keyHint}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="quickdash-reset-btn" onClick={() => setShowForm((open) => !open)}>
            {showForm ? "Cancel" : "Add provider"}
          </button>
          {activeProvider && (
            <button type="button" className="quickdash-reset-btn" onClick={handleRemoveActive}>
              Remove “{activeProvider.label}”
            </button>
          )}
        </div>
      )}

      {activeProvider?.keyHint && (
        <p className="assistant-key-hint">Key stored on your account ({activeProvider.keyHint}). It isn’t kept in this browser.</p>
      )}

      {showForm && !loadingList && (
        <form className="assistant-form" onSubmit={handleSaveProvider}>
          <label>
            Name
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. OpenAI, my Ollama"
              maxLength={60}
            />
          </label>
          <label>
            Base URL
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              autoCapitalize="off"
              required
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="Sent once, then only a masked hint is shown"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Model
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="gpt-4o-mini"
              spellCheck={false}
              autoCapitalize="off"
              required
            />
          </label>
          <p className="assistant-form__note">
            OpenAI, OpenRouter, Groq, and other OpenAI-compatible APIs need https. A local server on localhost is
            allowed only while you’re running the app in local dev. The key is stored for your account and is not
            returned after you save.
          </p>
          <div className="assistant-form__actions">
            <button type="submit" className="auth-form__submit" disabled={saving}>
              {saving ? "Saving…" : "Save provider"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="panel__status panel__status--error">{error}</p>}

      {!loadingList && !activeProvider ? (
        <p className="panel__status">Add a provider above to start chatting.</p>
      ) : activeProvider ? (
        <>
          <div className="assistant-chat" ref={scrollRef}>
            {messages.length === 0 && !loading && (
              <p className="assistant-chat__empty">
                Connected to {activeProvider.label} ({activeProvider.model}). Say hello below.
              </p>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`assistant-msg assistant-msg--${message.role}`}>
                <span className="assistant-msg__role">{message.role}</span>
                <div className="assistant-msg__body">{message.content}</div>
              </div>
            ))}
            {loading && (
              <div className="assistant-msg assistant-msg--assistant">
                <span className="assistant-msg__role">assistant</span>
                <div className="assistant-msg__body assistant-msg__body--typing">…</div>
              </div>
            )}
          </div>

          <form className="assistant-composer" onSubmit={handleSend}>
            <textarea
              className="assistant-composer__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask your assistant…"
              rows={2}
            />
            <button type="submit" className="auth-form__submit" disabled={loading || !input.trim()}>
              {loading ? "…" : "Send"}
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
