// Account Settings page.
// Everything here is passed down as controlled props from App.jsx,
// which handles real persistence to Supabase (and localStorage as a
// logged-out fallback) — this component itself stays presentation-only.
//
// Covers: name, avatar upload (preview only), per-platform usernames/
// friend codes with per-field visibility, Twitch/Kick names, timezone,
// theme, platform preferences, and a QR code for adding Lykodex friends.
//
// FIXED A REAL BUG: phone number, timezone, per-platform friend codes,
// streaming names, and their visibility settings used to be plain
// local useState right here in this component — never threaded up to
// App.jsx, never written to Supabase. They looked like they saved
// (typing worked fine) but silently reset to blank on every refresh,
// which is exactly the bug that got reported. Now they're real,
// controlled props like everything else on this page, bundled into
// one profileDetails object/column rather than nine separate ones.
// Also removed a "Save changes" button that had no click handler at
// all — every field on this page already auto-saves (debounced,
// same as the rest of the app), so a dead button implying otherwise
// was actively misleading, not just unfinished.

import { useEffect, useMemo, useState } from "react";
import ReorderableList from "./ReorderableList";
import { faviconFor, shortStoreName } from "./price/priceUtils";
import { COLLEGES as ALL_COLLEGES } from "../data/colleges";
import { supabase } from "../lib/supabaseClient";
import { fetchMyFriendCode } from "../lib/friends";
import { checkIsLykodexDelegate } from "../lib/auth";
import { useApp } from "../hooks/useApp";
import CollegeIcon from "./CollegeIcon";

const platforms = [
  { id: "steam", label: "Steam", placeholder: "e.g. mysteamname" },
  { id: "playstation", label: "PlayStation", placeholder: "PSN online ID" },
  { id: "xbox", label: "Xbox", placeholder: "Xbox gamertag" },
  { id: "epic", label: "Epic Games", placeholder: "Epic display name" },
  { id: "riot", label: "Riot Games", placeholder: "Riot ID#Tag (LoL / Valorant)" },
  { id: "discord", label: "Discord", placeholder: "username" },
  { id: "nintendo", label: "Nintendo", placeholder: "Friend code (SW-0000-0000-0000)" },
];

const streaming = [
  { id: "twitch", label: "Twitch", placeholder: "channel name" },
  { id: "kick", label: "Kick", placeholder: "channel name" },
  { id: "youtube", label: "YouTube", placeholder: "channel handle (@name)" },
];

const visibilityOptions = ["Public", "Friends only", "Private"];

// Pull the full IANA timezone list from the browser itself instead of
// hardcoding one — every modern browser ships this list already.
function getTimezoneList() {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    // Fallback for older environments that don't support this API yet.
    return ["UTC", "Australia/Darwin", "America/New_York", "Europe/London", "Asia/Tokyo"];
  }
}

function initialVisibility(fields) {
  const map = {};
  fields.forEach((f) => { map[f.id] = "Friends only"; });
  return map;
}

export default function AccountSettingsPage({
  onBack,
  avatarUrl,
  onAvatarChange,
  firstName,
  onFirstNameChange,
  lastName,
  onLastNameChange,
  username,
  onUsernameChange,
  accentColor,
  // No longer used directly — the swatch row below now calls
  // setAccentColorExplicit() from useApp() so it can also mark the
  // choice as customized (see AppContext.jsx). Kept in the prop list
  // rather than stripped here so App.jsx's wiring doesn't need editing
  // as part of this change; harmless to just ignore.
  onAccentColorChange: _onAccentColorChange,
  themeMode,
  onThemeModeChange,
  wallpaperUrl,
  onWallpaperChange,
  platformOrder,
  onPlatformOrderChange,
  xbxpricesKey,
  onXbxpricesKeyChange,
  platpricesKey,
  onPlatpricesKeyChange,
  profileDetails,
  onProfileDetailsChange,
  selectedColleges,
  onSelectedCollegesChange,
  shareActivityWithGuilds,
  onShareActivityWithGuildsChange,
  readReceiptsEnabled,
  onReadReceiptsEnabledChange,
  discordTrackingEnabled,
  onDiscordTrackingEnabledChange,
  userId,
  onGoToFriends,
}) {
  // "Act as Lykodex" — reached via useApp() directly rather than as a
  // prop like everything else on this page (an intentional, isolated
  // exception here) since this is exclusive to one account and doesn't
  // belong threaded through every other page's props just for this.
  const { actingAsLykodex, actAsLykodex, returnToMyAccount, setAccentColorExplicit } = useApp();
  const [isLykodexDelegate, setIsLykodexDelegate] = useState(false);
  const [lykodexToggleStatus, setLykodexToggleStatus] = useState("idle"); // idle | working | error
  useEffect(() => {
    if (!userId) return;
    checkIsLykodexDelegate().then(setIsLykodexDelegate);
  }, [userId]);

  async function handleToggleLykodex() {
    setLykodexToggleStatus("working");
    try {
      if (actingAsLykodex) {
        await returnToMyAccount();
      } else {
        await actAsLykodex();
      }
      setLykodexToggleStatus("idle");
    } catch (err) {
      console.error("Failed to toggle Lykodex persona:", err);
      setLykodexToggleStatus("error");
    }
  }

  const [friendCode, setFriendCode] = useState("");
  useEffect(() => {
    if (!userId) return;
    fetchMyFriendCode(userId)
      .then(setFriendCode)
      .catch((err) => console.error("Failed to load friend code:", err));
  }, [userId]);

  const details = profileDetails || {};
  const phoneNumber = details.phoneNumber || "";
  const phoneVisibility = details.phoneVisibility || "Private";
  const timezone = details.timezone || "Australia/Darwin";
  const friendNameDisplay = details.friendNameDisplay || "both";
  const platformValues = details.platformValues || {};
  const platformVisibility = details.platformVisibility || initialVisibility(platforms);
  const streamValues = details.streamValues || {};
  const streamLinks = details.streamLinks || {};
  const streamVisibility = details.streamVisibility || initialVisibility(streaming);

  const timezones = useMemo(getTimezoneList, []);
  const [avatarStatus, setAvatarStatus] = useState("idle"); // idle | uploading | error
  const [avatarBroken, setAvatarBroken] = useState(false);
  useEffect(() => {
    setAvatarBroken(false);
  }, [avatarUrl]);

  // Real upload to Supabase Storage — this used to just create a
  // browser-local blob: URL, which looked like it worked but was
  // never actually saved anywhere. It broke on the very next refresh,
  // new session, or different device, because there was never a real
  // file behind it. This uploads for real and saves back a genuine,
  // permanent public URL.
  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setAvatarStatus("uploading");
    try {
      // file.name doesn't always have a usable extension (camera
      // captures, pasted images) — fall back to deriving one from the
      // MIME type rather than uploading to a garbage path.
      const nameExt = file.name.includes(".") ? file.name.split(".").pop() : "";
      const mimeExt = file.type?.split("/")?.[1];
      const ext = (nameExt || mimeExt || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${userId}/avatar.${ext || "png"}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      // Cache-bust so the new image actually shows immediately —
      // browsers otherwise cache the old image at this same URL.
      onAvatarChange(`${data.publicUrl}?t=${Date.now()}`);
      setAvatarStatus("idle");
    } catch (err) {
      console.error("Failed to upload avatar:", err);
      setAvatarStatus("error");
    }
  }

  const [wallpaperStatus, setWallpaperStatus] = useState("idle"); // idle | uploading | error

  // Real upload to Supabase Storage — same pattern as the avatar
  // upload above (real public URL, not a throwaway blob: URL).
  async function handleWallpaperChange(e) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setWallpaperStatus("uploading");
    try {
      const nameExt = file.name.includes(".") ? file.name.split(".").pop() : "";
      const mimeExt = file.type?.split("/")?.[1];
      const ext = (nameExt || mimeExt || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${userId}/wallpaper.${ext || "jpg"}`;

      const { error: uploadError } = await supabase.storage
        .from("wallpapers")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("wallpapers").getPublicUrl(path);
      onWallpaperChange(`${data.publicUrl}?t=${Date.now()}`);
      setWallpaperStatus("idle");
    } catch (err) {
      console.error("Failed to upload wallpaper:", err);
      setWallpaperStatus("error");
    }
  }

  return (
    <div className="settings-page">
      {onBack && (
        <button type="button" className="back-link" onClick={onBack}>← Back to Gaming</button>
      )}
      <div className="settings-page__head">
        <h1 className="settings-page__title">Account settings</h1>
        <p className="settings-page__subtitle">Manage your profile, linked platform names, and privacy.</p>
      </div>

      {/* Avatar + name */}
      <section className="settings-card">
        <div className="settings-avatar-row">
          <div className="settings-avatar">
            {avatarUrl && !avatarBroken ? (
              <img
                src={avatarUrl}
                alt="Profile avatar preview"
                decoding="async"
                onError={() => setAvatarBroken(true)}
              />
            ) : (
              <span className="settings-avatar__placeholder">
                {(firstName[0] || "") + (lastName[0] || "") || "?"}
              </span>
            )}
          </div>
          <div className="settings-avatar__controls">
            <label className="settings-avatar__upload">
              Upload photo
              <input type="file" accept="image/*" onChange={handleAvatarChange} hidden />
            </label>
            <span className="settings-avatar__hint">
              {avatarStatus === "uploading" ? "Uploading…" : avatarStatus === "error" ? "Upload failed — try again" : "Square image, 512×512px recommended."}
            </span>
          </div>
        </div>

        <label className="auth-form__field">
          <span>Username</span>
          <input value={username} onChange={(e) => onUsernameChange(e.target.value)} placeholder="johndash" autoComplete="username" />
        </label>

        <div className="settings-form-row">
          <label className="auth-form__field">
            <span>First name</span>
            <input value={firstName} onChange={(e) => onFirstNameChange(e.target.value)} placeholder="John" />
          </label>
          <label className="auth-form__field">
            <span>Last name</span>
            <input value={lastName} onChange={(e) => onLastNameChange(e.target.value)} placeholder="Dashboard" />
          </label>
        </div>

        <div className="identifier-row">
          <span className="identifier-row__label">Phone number</span>
          <input
            className="identifier-row__input"
            type="tel"
            placeholder="+61 400 000 000"
            value={phoneNumber}
            onChange={(e) => onProfileDetailsChange({ phoneNumber: e.target.value })}
          />
          <select
            className="identifier-row__visibility"
            value={phoneVisibility}
            onChange={(e) => onProfileDetailsChange({ phoneVisibility: e.target.value })}
          >
            {visibilityOptions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <p className="settings-card__note">Used so friends can find you by phone number — kept private by default.</p>
      </section>

      {/* Platform identifiers */}
      <section className="settings-card">
        <h2 className="settings-card__title">Platform usernames &amp; friend codes</h2>
        <p className="settings-card__note">Choose who can see each one on your profile.</p>

        <div className="identifier-list">
          {platforms.map((p) => (
            <div key={p.id} className="identifier-row">
              <span className="identifier-row__label">{p.label}</span>
              <input
                className="identifier-row__input"
                placeholder={p.placeholder}
                value={platformValues[p.id] || ""}
                onChange={(e) => onProfileDetailsChange({ platformValues: { ...platformValues, [p.id]: e.target.value } })}
              />
              <select
                className="identifier-row__visibility"
                value={platformVisibility[p.id]}
                onChange={(e) => onProfileDetailsChange({ platformVisibility: { ...platformVisibility, [p.id]: e.target.value } })}
              >
                {visibilityOptions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      {/* Streaming */}
      <section className="settings-card">
        <h2 className="settings-card__title">Streaming</h2>

        <div className="identifier-list">
          {streaming.map((p) => (
            <div key={p.id} className="stream-row">
              <div className="identifier-row">
                <span className="identifier-row__label">{p.label}</span>
                <input
                  className="identifier-row__input"
                  placeholder={p.placeholder}
                  value={streamValues[p.id] || ""}
                  onChange={(e) => onProfileDetailsChange({ streamValues: { ...streamValues, [p.id]: e.target.value } })}
                />
                <select
                  className="identifier-row__visibility"
                  value={streamVisibility[p.id]}
                  onChange={(e) => onProfileDetailsChange({ streamVisibility: { ...streamVisibility, [p.id]: e.target.value } })}
                >
                  {visibilityOptions.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <input
                className="identifier-row__input stream-row__link"
                placeholder={`Link to your ${p.label} channel home page (optional)`}
                value={streamLinks[p.id] || ""}
                onChange={(e) => onProfileDetailsChange({ streamLinks: { ...streamLinks, [p.id]: e.target.value } })}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Timezone */}
      <section className="settings-card">
        <h2 className="settings-card__title">Region</h2>
        <p className="settings-card__note">Sets your local time and currency for prices and reset countdowns.</p>

        <label className="auth-form__field settings-timezone">
          <span>Timezone</span>
          <select value={timezone} onChange={(e) => onProfileDetailsChange({ timezone: e.target.value })}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </label>
      </section>

      {/* Preferences */}
      <section className="settings-card">
        <h2 className="settings-card__title">Preferences</h2>
        <p className="settings-card__note">How friends' names appear across Lykodex.</p>

        <div className="pref-choice-group" role="radiogroup" aria-label="Friend name display">
          <label className="pref-choice">
            <input
              type="radio"
              name="friendNameDisplay"
              value="username"
              checked={friendNameDisplay === "username"}
              onChange={(e) => onProfileDetailsChange({ friendNameDisplay: e.target.value })}
            />
            <span>Username only</span>
          </label>
          <label className="pref-choice">
            <input
              type="radio"
              name="friendNameDisplay"
              value="realname"
              checked={friendNameDisplay === "realname"}
              onChange={(e) => onProfileDetailsChange({ friendNameDisplay: e.target.value })}
            />
            <span>First name + Last name</span>
          </label>
          <label className="pref-choice">
            <input
              type="radio"
              name="friendNameDisplay"
              value="both"
              checked={friendNameDisplay === "both"}
              onChange={(e) => onProfileDetailsChange({ friendNameDisplay: e.target.value })}
            />
            <span>Both (e.g. "John Dashboard (@johndash)")</span>
          </label>
        </div>
      </section>

      {/* Privacy */}
      <section className="settings-card">
        <h2 className="settings-card__title">Privacy</h2>
        <p className="settings-card__note">
          Off by default — turn this on if you want your Guild-mates to see it.
        </p>
        <label className="toggle-row">
          <span className="toggle-row__label">Share my activity with Guilds</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={shareActivityWithGuilds}
              onChange={(e) => onShareActivityWithGuildsChange(e.target.checked)}
            />
            <span className="toggle-switch__track" />
            <span className="toggle-switch__thumb" />
          </span>
        </label>

        <p className="settings-card__note">
          Mutual — you only see when a friend's read your messages if they also have this on,
          and turning it off hides your own read status from them too.
        </p>
        <label className="toggle-row">
          <span className="toggle-row__label">Read receipts</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={readReceiptsEnabled}
              onChange={(e) => onReadReceiptsEnabledChange(e.target.checked)}
            />
            <span className="toggle-switch__track" />
            <span className="toggle-switch__thumb" />
          </span>
        </label>

        <p className="settings-card__note">
          Off by default. When on, the Lykodex Discord bot records your game playtime (Xbox,
          PlayStation and non-Steam PC), voice chat time, and Spotify / Watching time from your
          Discord status, and counts it toward your Mastery. Needs Discord linked and a server
          shared with the bot. Nothing before you turn this on can be backfilled.
        </p>
        <label className="toggle-row">
          <span className="toggle-row__label">Discord activity tracking</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={discordTrackingEnabled}
              onChange={(e) => onDiscordTrackingEnabledChange(e.target.checked)}
            />
            <span className="toggle-switch__track" />
            <span className="toggle-switch__thumb" />
          </span>
        </label>
      </section>

      {/* Appearance */}
      <section className="settings-card">
        <h2 className="settings-card__title">Appearance</h2>
        <p className="settings-card__note">
          Pick a mode and an accent colour — every accent works in both light and dark mode.
        </p>

        <div className="pref-choice-group" role="radiogroup" aria-label="Appearance mode">
          <label className="pref-choice">
            <input
              type="radio"
              name="themeMode"
              value="dark"
              checked={themeMode === "dark"}
              onChange={(e) => onThemeModeChange(e.target.value)}
            />
            <span>Dark mode</span>
          </label>
          <label className="pref-choice">
            <input
              type="radio"
              name="themeMode"
              value="light"
              checked={themeMode === "light"}
              onChange={(e) => onThemeModeChange(e.target.value)}
            />
            <span>Light mode</span>
          </label>
        </div>

        <div className="accent-swatch-row" role="radiogroup" aria-label="Accent colour">
          {[
            { id: "gold", label: "Gold" },
            { id: "red", label: "Red" },
            { id: "purple", label: "Purple" },
            { id: "blue", label: "Blue" },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              className={`accent-swatch accent-swatch--${option.id} ${accentColor === option.id ? "accent-swatch--active" : ""}`}
              onClick={() => setAccentColorExplicit(option.id)}
              aria-pressed={accentColor === option.id}
              title={option.label}
            >
              <span className="accent-swatch__dot" />
              <span className="accent-swatch__label">{option.label}</span>
            </button>
          ))}
        </div>

        <div className="settings-wallpaper">
          <span className="settings-card__note" style={{ marginTop: 0 }}>Site wallpaper (optional)</span>
          <div className="settings-wallpaper__row">
            {wallpaperUrl ? (
              <img src={wallpaperUrl} alt="" className="settings-wallpaper__preview" decoding="async" />
            ) : (
              <span className="settings-wallpaper__placeholder">No wallpaper set</span>
            )}
            <div className="settings-avatar__controls">
              <label className="settings-avatar__upload">
                {wallpaperUrl ? "Change wallpaper" : "Upload wallpaper"}
                <input type="file" accept="image/*" onChange={handleWallpaperChange} hidden />
              </label>
              {wallpaperUrl && (
                <button type="button" className="quickdash-reset-btn" onClick={() => onWallpaperChange(null)}>
                  Clear wallpaper
                </button>
              )}
              <span className="settings-avatar__hint">
                {wallpaperStatus === "uploading" ? "Uploading…" : wallpaperStatus === "error" ? "Upload failed — try again" : "Shown behind the app with a dark scrim so text stays readable."}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Colleges — the same picker shown at onboarding, but editable
          any time here. Fixes a real gap: onboarding's College Picker
          only ever runs once at signup, so anyone whose account
          predates it (or who just changes their mind later) had no
          way to ever add more Colleges without this. */}
      <section className="settings-card">
        <h2 className="settings-card__title">Colleges</h2>
        <p className="settings-card__note">
          Choose what shows up in your top navigation.
        </p>
        <div className="college-picker-grid">
          {ALL_COLLEGES.map((college) => (
            <button
              key={college.id}
              type="button"
              className={`college-picker-card ${selectedColleges?.includes(college.id) ? "college-picker-card--selected" : ""}`}
              onClick={() => {
                const current = selectedColleges || ["gaming"];
                const next = current.includes(college.id)
                  ? current.filter((id) => id !== college.id)
                  : [...current, college.id];
                onSelectedCollegesChange(next);
              }}
              aria-pressed={selectedColleges?.includes(college.id)}
            >
              <CollegeIcon collegeId={college.id} size={26} className="college-picker-card__icon" />
              <span className="college-picker-card__label">{college.label}</span>
              <span className="college-picker-card__tagline">{college.tagline}</span>
              {!college.built && <span className="college-picker-card__badge">Coming soon</span>}
              {selectedColleges?.includes(college.id) && (
                <span className="college-picker-card__check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Platform Preferences */}
      <section className="settings-card">
        <h2 className="settings-card__title">Platform Preferences</h2>
        <p className="settings-card__note">
          Drag to rank your most-used stores top to bottom — your wishlist price cards will
          show them left to right in this same order.
        </p>
        <ReorderableList
          items={platformOrder}
          onReorder={onPlatformOrderChange}
          renderItem={(storeName) => {
            const favicon = faviconFor(storeName);
            return (
              <>
                {favicon && <img src={favicon} alt="" decoding="async" />}
                {shortStoreName(storeName)}
              </>
            );
          }}
        />
      </section>

      {/* API Keys */}
      <section className="settings-card">
        <h2 className="settings-card__title">API Keys</h2>
        <p className="settings-card__note">
          Optional — both XBXprices and PlatPrices give every account a small free monthly
          quota. If a lot of people share this app's built-in keys, everyone splits the same
          quota. Plugging in your own free key here means your usage draws from your own
          quota instead. Leave blank to keep using the shared one.
        </p>

        <label className="api-key-field">
          <span>
            XBXprices key (Xbox pricing) —{" "}
            <a href="https://xbxprices.com" target="_blank" rel="noopener noreferrer">get a free key</a>
          </span>
          <input
            type="password"
            placeholder="Paste your XBXprices key"
            value={xbxpricesKey}
            onChange={(e) => onXbxpricesKeyChange(e.target.value)}
            autoComplete="off"
          />
        </label>

        <label className="api-key-field">
          <span>
            PlatPrices key (PlayStation pricing/trophies) —{" "}
            <a href="https://platprices.com/api-request" target="_blank" rel="noopener noreferrer">get a free key</a>
          </span>
          <input
            type="password"
            placeholder="Paste your PlatPrices key"
            value={platpricesKey}
            onChange={(e) => onPlatpricesKeyChange(e.target.value)}
            autoComplete="off"
          />
        </label>
      </section>

      {/* Add friends — a real per-account code (profiles.friend_code),
          not the hardcoded placeholder this used to show. Managing
          requests/removing friends lives on the real Friends page;
          this is just the "here's your code" quick-reference. */}
      <section className="settings-card">
        <h2 className="settings-card__title">Add friends</h2>
        <p className="settings-card__note">
          Your friend code never changes, even if you rename your username later.
        </p>

        <div className="friend-code-row">
          <span className="friend-code-row__code">{friendCode || "…"}</span>
          {onGoToFriends && (
            <button type="button" className="linking-row__connect" onClick={onGoToFriends}>
              Manage friends
            </button>
          )}
        </div>
      </section>

      {/* Exclusive to the one registered delegate account — see
          lib/auth.js/api/pricing.js's lykodex-session handler. Also
          shown while actingAsLykodex is true even if isLykodexDelegate
          just came back false, since that check runs against whatever
          session is CURRENTLY active — once swapped to Lykodex, it's
          checking Lykodex against itself, not the real delegate, so it
          would otherwise hide the one control needed to flip back. */}
      {(isLykodexDelegate || actingAsLykodex) && (
        <section className="settings-card">
          <h2 className="settings-card__title">Lykodex system account</h2>
          <p className="settings-card__note">
            {actingAsLykodex
              ? "You're currently acting as Lykodex — everything in the app (profile, friends, guild leadership) is Lykodex's, not yours, until you switch back."
              : "Switch your whole session to the Lykodex system account — the official leader of the 5 default College guilds. Exclusive to your account."}
          </p>
          <button
            type="button"
            className="linking-row__connect"
            onClick={handleToggleLykodex}
            disabled={lykodexToggleStatus === "working"}
          >
            {lykodexToggleStatus === "working"
              ? "Switching…"
              : actingAsLykodex
                ? "Return to my account"
                : "Act as Lykodex"}
          </button>
          {lykodexToggleStatus === "error" && (
            <p className="panel__status panel__status--error">Couldn't switch — try again.</p>
          )}
        </section>
      )}

      <p className="panel__status">Changes save automatically as you type.</p>
    </div>
  );
}
