import { useEffect, useRef, useState } from "react";
import {
  loadAssistantConfig,
  saveAssistantConfig,
  makeProviderId,
  getActiveProvider,
} from "../lib/assistantConfig";
import { sendAssistantChat } from "../lib/assistant";

const EMPTY_FORM = { label: "", baseUrl: "", apiKey: "", model: "" };

export default function AssistantPage({ onBack }) {
  const [config, setConfig] = useState(() => loadAssistantConfig());
  const activeProvider = getActiveProvider(config);

  const [showForm, setShowForm] = useState(config.providers.length === 0);
  const [form, setForm] = useState(EMPTY_FORM);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  function persist(next) {
    setConfig(next);
    saveAssistantConfig(next);
  }

  function handleSaveProvider(e) {
    e.preventDefault();
    const baseUrl = form.baseUrl.trim();
    const model = form.model.trim();
    if (!baseUrl || !model) return;
    const provider = {
      id: makeProviderId(),
      label: form.label.trim() || "My provider",
      baseUrl,
      apiKey: form.apiKey.trim(),
      model,
    };
    persist({ providers: [...config.providers, provider], activeId: provider.id });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setError("");
  }

  function handleRemoveActive() {
    if (!activeProvider) return;
    const providers = config.providers.filter((p) => p.id !== activeProvider.id);
    persist({ providers, activeId: providers[0]?.id ?? null });
    setMessages([]);
    if (providers.length === 0) setShowForm(true);
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
      const data = await sendAssistantChat({ provider: activeProvider, messages: nextMessages });
      setMessages([...nextMessages, { role: "assistant", content: data.message || "(empty response)" }]);
    } catch (err) {
      setError(err?.message || "Something went wrong.");
      setMessages(nextMessages);
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
            Bring your own LLM — connect any OpenAI-compatible provider and chat with it.
          </p>
        </div>
        {onBack && (
          <button type="button" className="quickdash-reset-btn" onClick={onBack}>
            Back
          </button>
        )}
      </div>

      <div className="assistant-providers">
        {config.providers.length > 0 && (
          <label>
            Provider
            <select
              value={activeProvider?.id || ""}
              onChange={(e) => persist({ ...config, activeId: e.target.value })}
            >
              {config.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · {p.model}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="quickdash-reset-btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Add provider"}
        </button>
        {activeProvider && (
          <button type="button" className="quickdash-reset-btn" onClick={handleRemoveActive}>
            Remove “{activeProvider.label}”
          </button>
        )}
      </div>

      {showForm && (
        <form className="assistant-form" onSubmit={handleSaveProvider}>
          <label>
            Name
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. OpenAI, my Ollama"
            />
          </label>
          <label>
            Base URL
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="sk-… (leave blank for keyless/local)"
            />
          </label>
          <label>
            Model
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </label>
          <p className="assistant-form__note">
            Any OpenAI-compatible endpoint works — OpenAI, OpenRouter, Groq, a local Ollama/vLLM, etc.
            Add several and switch between them above.
          </p>
          <div className="assistant-form__actions">
            <button type="submit" className="auth-form__submit">
              Save provider
            </button>
          </div>
        </form>
      )}

      {!activeProvider ? (
        <p className="panel__status">Add a provider above to start chatting.</p>
      ) : (
        <>
          <div className="assistant-chat" ref={scrollRef}>
            {messages.length === 0 && !loading && (
              <p className="assistant-chat__empty">
                Connected to {activeProvider.label} ({activeProvider.model}). Say hello below.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`assistant-msg assistant-msg--${m.role}`}>
                <span className="assistant-msg__role">{m.role}</span>
                <div className="assistant-msg__body">{m.content}</div>
              </div>
            ))}
            {loading && (
              <div className="assistant-msg assistant-msg--assistant">
                <span className="assistant-msg__role">assistant</span>
                <div className="assistant-msg__body assistant-msg__body--typing">…</div>
              </div>
            )}
          </div>

          {error && <p className="panel__status panel__status--error">{error}</p>}

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
      )}
    </div>
  );
}
