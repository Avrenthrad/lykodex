// Friends — two real, deliberately separate friend graphs:
//   - Steam friends: live online/in-game status + achievement-based
//     progress (GetPlayerSummaries + GetFriendList, only works if the
//     account's friends list is public). Self-contained real-time data
//     straight from Steam's own API.
//   - Real Lykodex friends (the app's own mutual friend-code system,
//     see lib/friends.js) who've linked Discord: their real Xbox/
//     PlayStation "currently playing" + accumulated hours, sourced
//     from the separate presence bot (see /discord-bot). Deliberately
//     excludes Steam activity for this group — Steam is already
//     covered, better, by the list above; re-showing the bot's lower-
//     fidelity Discord-sourced Steam reading would just double-report
//     the same real activity through a worse source (see
//     lib/crossPlatformActivity.js's TRACKED_PLATFORMS).
// These two lists aren't merged even when the same real person happens
// to be in both — there's no reliable way to match a Steam friend
// (identified by SteamID) to a Lykodex friend (identified by their
// Lykodex account) without a friend having exposed their linked Steam
// ID more broadly than profiles currently allow, so they stay as two
// honestly-separate sections rather than a guessed-at merge.
//
// The linked account's OWN progress used to render here too — it now
// has its own hero card on the Gaming dashboard (see
// ContinuePlayingCard.jsx, lib/friendsData.js's fetchContinuePlayingSlides)
// so it isn't duplicated on this panel anymore.

import { useEffect, useState } from "react";
import { fetchRealFriends } from "../lib/friendsData";
import { fetchOwnedGames } from "../lib/steam";
import {
  fetchCurrentActivity,
  fetchPlatformPlaytime,
  fetchCurrentActivityForUsers,
  fetchPlatformPlaytimeForUsers,
} from "../lib/crossPlatformActivity";
import { fetchFriends } from "../lib/friends";
import UnderConstructionOverlay from "./UnderConstructionOverlay";
import { AccountGatePanel } from "./AccountGate";

function initials(name) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function displayName(profile) {
  if (!profile) return "Someone";
  const full = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return full || profile.username || "Someone";
}

export default function FriendSection({ isLoggedIn, onSignIn, onCreateAccount, linkedSteamId, onGoToLinking, userId }) {
  const [friends, setFriends] = useState([]);
  const [friendsStatus, setFriendsStatus] = useState("idle");

  // Real Lykodex friends' Xbox/PlayStation activity — independent of
  // Steam entirely, so this loads/shows regardless of linkedSteamId.
  const [lykodexFriends, setLykodexFriends] = useState([]);
  const [lykodexFriendsStatus, setLykodexFriendsStatus] = useState("idle");

  // Combined cross-platform playtime — Steam's own exact historical
  // total (fetchOwnedGames), plus whatever the separate presence bot
  // has accumulated for Xbox/PlayStation since Discord was linked (see
  // /discord-bot and lib/crossPlatformActivity.js). Independent of
  // linkedSteamId/userId's OTHER effects below since it needs both
  // pieces of data together before it can compute a combined total.
  const [totalPlaytime, setTotalPlaytime] = useState(null); // { steamHours, xboxHours, playstationHours, pcHours, totalHours }
  const [liveActivity, setLiveActivity] = useState(null); // { platform, game_name } from the bot, or null
  const [playtimeStatus, setPlaytimeStatus] = useState("idle");

  useEffect(() => {
    if (!userId) return;

    setPlaytimeStatus("loading");
    Promise.all([
      linkedSteamId ? fetchOwnedGames(linkedSteamId) : Promise.resolve([]),
      fetchPlatformPlaytime(userId),
      fetchCurrentActivity(userId),
    ])
      .then(([steamGames, platformRows, activity]) => {
        const steamMinutes = steamGames.reduce((sum, g) => sum + (g.playtime_forever || 0), 0);
        const xboxMinutes = platformRows
          .filter((r) => r.platform === "xbox")
          .reduce((sum, r) => sum + r.total_minutes, 0);
        const playstationMinutes = platformRows
          .filter((r) => r.platform === "playstation")
          .reduce((sum, r) => sum + r.total_minutes, 0);
        // Non-Steam PC games, tracked by the Discord bot (opt-in).
        const pcMinutes = platformRows
          .filter((r) => r.platform === "pc")
          .reduce((sum, r) => sum + r.total_minutes, 0);

        setTotalPlaytime({
          steamHours: Math.round(steamMinutes / 60),
          xboxHours: Math.round(xboxMinutes / 60),
          playstationHours: Math.round(playstationMinutes / 60),
          pcHours: Math.round(pcMinutes / 60),
          totalHours: Math.round((steamMinutes + xboxMinutes + playstationMinutes + pcMinutes) / 60),
        });
        setLiveActivity(activity?.game_name ? activity : null);
        setPlaytimeStatus("ready");
      })
      .catch((err) => {
        console.error("Cross-platform playtime fetch failed:", err);
        setPlaytimeStatus("error");
      });
  }, [userId, linkedSteamId]);

  useEffect(() => {
    if (!linkedSteamId) return;

    setFriendsStatus("loading");
    fetchRealFriends(linkedSteamId)
      .then((result) => {
        setFriends(result);
        setFriendsStatus("ready");
      })
      .catch((err) => {
        console.error("Friends fetch failed:", err);
        setFriendsStatus("error");
      });
  }, [linkedSteamId]);

  useEffect(() => {
    if (!userId) return;

    setLykodexFriendsStatus("loading");
    fetchFriends(userId)
      .then(async (realFriends) => {
        const friendIds = realFriends.map((f) => f.friend_id);
        const [activityByUser, playtimeByUser] = await Promise.all([
          fetchCurrentActivityForUsers(friendIds),
          fetchPlatformPlaytimeForUsers(friendIds),
        ]);
        setLykodexFriends(
          realFriends.map((f) => ({
            ...f,
            activity: activityByUser[f.friend_id] || null,
            playtime: playtimeByUser[f.friend_id] || { xboxHours: 0, playstationHours: 0 },
          }))
        );
        setLykodexFriendsStatus("ready");
      })
      .catch((err) => {
        console.error("Lykodex friends' cross-platform activity fetch failed:", err);
        setLykodexFriendsStatus("error");
      });
  }, [userId]);

  return (
    <section id="friends" className="panel panel--lime panel--wide">
      {!isLoggedIn && <UnderConstructionOverlay />}
      <div className="panel__head">
        <h2 className="panel__title">Friend Details</h2>
        <p className="panel__subtitle">
          Real Steam friends' live activity, plus real Lykodex friends' Xbox/PlayStation activity via Discord.
        </p>
      </div>

      {!isLoggedIn && (
        <AccountGatePanel
          message="Sign in to see your friends' activity and your own progress."
          onSignIn={onSignIn}
          onCreateAccount={onCreateAccount}
        />
      )}

      {isLoggedIn && (
        <div className="lykodex-friends-activity">
          <span className="feed-col__label">Friends' Xbox / PlayStation</span>
          {lykodexFriendsStatus === "loading" && <p className="panel__status">Loading…</p>}
          {lykodexFriendsStatus === "error" && (
            <p className="panel__status panel__status--error">Couldn't load friends' activity right now.</p>
          )}
          {lykodexFriendsStatus === "ready" && lykodexFriends.length === 0 && (
            <p className="panel__status">
              Add real Lykodex friends (Account Settings has your friend code) to see their Xbox/PlayStation
              activity here — works for anyone who's linked Discord, no Steam needed.
            </p>
          )}
          {lykodexFriendsStatus === "ready" && lykodexFriends.length > 0 && (
            <ul className="friend-list">
              {lykodexFriends.map((f) => (
                <li key={f.friend_id} className="friend-row">
                  {f.profile?.avatar_url ? (
                    <img src={f.profile.avatar_url} alt="" className="friend-row__avatar friend-row__avatar--img" loading="lazy" decoding="async" />
                  ) : (
                    <div className="friend-row__avatar" aria-hidden="true">{initials(displayName(f.profile))}</div>
                  )}

                  <div className="friend-row__identity">
                    <span className="friend-row__name">{displayName(f.profile)}</span>
                    <span className="friend-row__playing">
                      {f.activity
                        ? `Playing ${f.activity.game_name} on ${f.activity.platform === "xbox" ? "Xbox" : "PlayStation"}`
                        : "No console activity tracked yet"}
                    </span>
                  </div>

                  {(f.playtime.xboxHours > 0 || f.playtime.playstationHours > 0) ? (
                    <div className="friend-row__stat">
                      <span className="friend-row__stat-label">
                        {[
                          f.playtime.xboxHours > 0 ? `${f.playtime.xboxHours}h Xbox` : null,
                          f.playtime.playstationHours > 0 ? `${f.playtime.playstationHours}h PlayStation` : null,
                        ].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  ) : (
                    <div className="friend-row__stat" />
                  )}

                  <div className={`friend-row__online-dot ${f.activity ? "friend-row__online-dot--on" : ""}`} title={f.activity ? "Playing now" : "No live activity"} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isLoggedIn && !linkedSteamId && (
        <p className="panel__status">
          No Steam account linked yet —{" "}
          <button type="button" className="steam-sync-link" onClick={onGoToLinking}>
            link one on Account Linking
          </button>{" "}
          to see your Steam friends and progress.
        </p>
      )}

      {isLoggedIn && linkedSteamId && (
        <>
          {playtimeStatus === "ready" && totalPlaytime && (
            <div className="total-playtime">
              <div className="total-playtime__head">
                <span className="feed-col__label">Total playtime, every platform</span>
                {liveActivity && (
                  <span className="own-progress-row__live">
                    ● Playing {liveActivity.game_name}
                    {liveActivity.platform && liveActivity.platform !== "unknown" ? ` on ${liveActivity.platform}` : ""}
                  </span>
                )}
              </div>
              <span className="total-playtime__value">{totalPlaytime.totalHours.toLocaleString()}h</span>
              <div className="total-playtime__breakdown">
                <span>{totalPlaytime.steamHours}h Steam</span>
                {totalPlaytime.xboxHours > 0 && <span>{totalPlaytime.xboxHours}h Xbox</span>}
                {totalPlaytime.playstationHours > 0 && <span>{totalPlaytime.playstationHours}h PlayStation</span>}
                {totalPlaytime.pcHours > 0 && <span>{totalPlaytime.pcHours}h PC (non-Steam)</span>}
              </div>
              {totalPlaytime.xboxHours === 0 && totalPlaytime.playstationHours === 0 && (
                <p className="total-playtime__note">
                  Console hours start counting once your account is linked.
                </p>
              )}
            </div>
          )}

          <span className="feed-col__label">Steam Friends</span>
          {friendsStatus === "loading" && <p className="panel__status">Loading your friends…</p>}
          {friendsStatus === "error" && (
            <p className="panel__status panel__status--error">Couldn't load your friends right now.</p>
          )}
          {friendsStatus === "ready" && friends.length === 0 && (
            <p className="panel__status">No public friends list found on this Steam profile.</p>
          )}
          {friendsStatus === "ready" && friends.length > 0 && (
            <ul className="friend-list">
              {friends.map((f) => (
                <li key={f.steamid} className="friend-row">
                  {f.avatar ? (
                    <img src={f.avatar} alt="" className="friend-row__avatar friend-row__avatar--img" loading="lazy" decoding="async" />
                  ) : (
                    <div className="friend-row__avatar" aria-hidden="true">{initials(f.name)}</div>
                  )}

                  <div className="friend-row__identity">
                    <span className="friend-row__name">{f.name}</span>
                    <span className="friend-row__playing">
                      {f.playing ? `Playing ${f.playing}` : f.online ? "Online" : "Offline"}
                    </span>
                  </div>

                  {f.progress != null ? (
                    <div className="friend-row__stat">
                      <div className="friend-row__progress-bar">
                        <div className="friend-row__progress-fill" style={{ width: `${f.progress}%` }} />
                      </div>
                      <span className="friend-row__stat-label">{f.progress}% achievements</span>
                    </div>
                  ) : (
                    <div className="friend-row__stat" />
                  )}

                  <div className={`friend-row__online-dot ${f.online ? "friend-row__online-dot--on" : ""}`} title={f.online ? "Online" : "Offline"} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
