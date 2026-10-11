// Inbox — real 1:1 Direct Messages between real, mutual friends only.
// Master-detail, same shape as GuildsPage.jsx / BindersPage.jsx: a
// list of every friend (annotated with their last message and unread
// count, if any) that opens into one thread at a time.

import { useEffect, useState } from "react";
import { fetchInboxList, fetchThread, sendMessage, markThreadRead, fetchReadReceiptsEnabled } from "../lib/messages";
import { relativeTime } from "./price/priceUtils";
import MiniAvatar from "./MiniAvatar";

function displayName(profile) {
  if (!profile) return "Someone";
  const full = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return full || profile.username || "Someone";
}

export default function InboxPage({ onBack, userId, isLoggedIn, onSignIn, onCreateAccount, readReceiptsEnabled }) {
  const [conversations, setConversations] = useState([]);
  const [status, setStatus] = useState("loading");
  const [activeFriend, setActiveFriend] = useState(null);

  useEffect(() => {
    if (!isLoggedIn) {
      setStatus("ready");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, userId]);

  async function load() {
    setStatus("loading");
    try {
      const rows = await fetchInboxList(userId);
      setConversations(rows);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load Inbox:", err);
      setStatus("error");
    }
  }

  function openThread(convo) {
    setActiveFriend(convo);
  }

  function closeThread() {
    setActiveFriend(null);
    load(); // refresh unread counts/last-message previews after reading
  }

  if (activeFriend) {
    return (
      <ThreadView
        userId={userId}
        friendId={activeFriend.friend_id}
        friendProfile={activeFriend.profile}
        onBack={closeThread}
        readReceiptsEnabled={readReceiptsEnabled}
      />
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="price-page">
        <div className="price-page__head">
          <button type="button" className="back-link" onClick={onBack}>← Back</button>
          <h1 className="price-page__title">Inbox</h1>
          <p className="price-page__subtitle">Sign in to message your friends.</p>
        </div>
        <div className="backlog-add">
          <button type="button" className="linking-row__connect" onClick={onSignIn}>Sign in</button>
          <button type="button" className="linking-row__connect" onClick={onCreateAccount}>Create account</button>
        </div>
      </div>
    );
  }

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back</button>
        <h1 className="price-page__title">Inbox</h1>
        <p className="price-page__subtitle">Direct messages between you and your real friends.</p>
      </div>

      {status === "loading" && <p className="panel__status">Loading…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load your Inbox right now.</p>}

      {status === "ready" && conversations.length === 0 && (
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden="true">✉️</span>
          <p className="empty-state__body">Add a friend first — Inbox only works between real friends.</p>
        </div>
      )}

      {status === "ready" && conversations.length > 0 && (
        <ul className="backlog-list">
          {conversations.map((c) => (
            <li
              key={c.friend_id}
              className="backlog-card"
              style={{ cursor: "pointer" }}
              onClick={() => openThread(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openThread(c);
                }
              }}
            >
              <MiniAvatar profile={c.profile} />
              <div className="backlog-card__info">
                <span className="backlog-card__title">{displayName(c.profile)}</span>
                <span className="backlog-card__meta">
                  {c.lastMessage ? c.lastMessage.body.slice(0, 60) : "Say hello →"}
                  {c.lastMessage && ` · ${relativeTime(c.lastMessage.created_at)}`}
                </span>
              </div>
              {c.unreadCount > 0 && <span className="score-badge">{c.unreadCount}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThreadView({ userId, friendId, friendProfile, onBack, readReceiptsEnabled }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("loading");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [friendReadReceiptsEnabled, setFriendReadReceiptsEnabled] = useState(true);

  const canSeeReadReceipts = readReceiptsEnabled && friendReadReceiptsEnabled;

  useEffect(() => {
    load();
    fetchReadReceiptsEnabled(friendId)
      .then(setFriendReadReceiptsEnabled)
      .catch((err) => console.error("Failed to load friend's read receipts setting:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendId]);

  async function load() {
    setStatus("loading");
    try {
      const rows = await fetchThread(userId, friendId);
      setMessages(rows);
      setStatus("ready");
      markThreadRead(userId, friendId).catch((err) => console.error("Failed to mark thread read:", err));
    } catch (err) {
      console.error("Failed to load thread:", err);
      setStatus("error");
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const message = await sendMessage(userId, friendId, body.trim());
      setMessages((prev) => [...prev, message]);
      setBody("");
    } catch (err) {
      console.error("Failed to send message:", err);
    }
    setSending(false);
  }

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back to Inbox</button>
        <div className="binder-detail__head">
          <MiniAvatar profile={friendProfile} />
          <div className="binder-detail__info">
            <h1 className="price-page__title">{displayName(friendProfile)}</h1>
          </div>
        </div>
      </div>

      {status === "loading" && <p className="panel__status">Loading…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load this conversation right now.</p>}

      {status === "ready" && (
        <div className="dm-thread">
          {messages.length === 0 && <p className="panel__status">No messages yet — say hello below.</p>}
          {messages.map((m, i) => {
            const isMine = m.sender_id === userId;
            const isLastMine = isMine && !messages.slice(i + 1).some((later) => later.sender_id === userId);
            const status = isLastMine ? (canSeeReadReceipts && m.read_at ? "Read" : "Delivered") : null;
            return (
              <div key={m.id} className={`dm-row ${isMine ? "dm-row--mine" : ""}`}>
                <div className={`dm-bubble ${isMine ? "dm-bubble--mine" : ""}`}>
                  <span className="dm-bubble__body">{m.body}</span>
                </div>
                <span className="dm-bubble__meta">
                  {relativeTime(m.created_at)}
                  {status && ` · ${status}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <form className="price-search dm-compose" onSubmit={handleSend}>
        <input
          className="price-search__input"
          type="text"
          placeholder="Write a message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="submit" className="price-search__button" disabled={sending || !body.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
