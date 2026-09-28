// Voice chat time tracking → Social Mastery.
//
// One session per person per server: join → leave (moving between
// channels stays in the same session). Two numbers are recorded:
//   total_seconds  — all time connected
//   active_seconds — only time that was genuinely social: not
//                    deafened, not in the AFK channel, and at least one
//                    other (non-bot) person in the same channel.
// Only active_seconds feeds Mastery, so idling alone doesn't count.
// Opt-in only (see tracking.js).
import { Events } from "discord.js";
import { supabase } from "./supabase.js";
import { trackedUserIdFor } from "./tracking.js";

const MIN_SESSION_SECONDS = 60; // ignore quick join/leave blips

// `${guildId}:${discordUserId}` -> { userId, guildId, startedAt, activeMs, activeSince }
const sessions = new Map();

// Pure — exported for tests.
export function isSocial(voiceState, humansInChannel, afkChannelId) {
  if (!voiceState?.channelId) return false;
  if (voiceState.channelId === afkChannelId) return false;
  if (voiceState.selfDeaf || voiceState.serverDeaf) return false;
  return humansInChannel >= 2;
}

// Pure — exported for tests. Returns the session with activity
// accounting advanced to `now` given the new eligibility.
export function applyEligibility(session, eligible, now) {
  const s = { ...session };
  if (eligible && s.activeSince == null) s.activeSince = now;
  if (!eligible && s.activeSince != null) {
    s.activeMs += now - s.activeSince;
    s.activeSince = null;
  }
  return s;
}

function humansIn(channel) {
  if (!channel) return 0;
  return channel.members.filter((m) => !m.user.bot).size;
}

function reevaluateChannel(channel, now) {
  if (!channel) return;
  const humans = humansIn(channel);
  for (const member of channel.members.values()) {
    const key = `${channel.guild.id}:${member.id}`;
    const s = sessions.get(key);
    if (!s) continue;
    sessions.set(key, applyEligibility(s, isSocial(member.voice, humans, channel.guild.afkChannelId), now));
  }
}

async function saveSession(s, now) {
  const closed = applyEligibility(s, false, now);
  const totalSeconds = Math.round((now - closed.startedAt) / 1000);
  if (totalSeconds < MIN_SESSION_SECONDS) return;
  const { error } = await supabase.from("discord_voice_sessions").insert({
    user_id: closed.userId,
    discord_guild_id: closed.guildId,
    started_at: new Date(closed.startedAt).toISOString(),
    ended_at: new Date(now).toISOString(),
    total_seconds: totalSeconds,
    active_seconds: Math.round(closed.activeMs / 1000),
  });
  if (error) console.error("discord_voice_sessions insert failed:", error.message);
}

async function startSession(guild, discordUserId, now) {
  const userId = await trackedUserIdFor(discordUserId);
  if (!userId) return;
  sessions.set(`${guild.id}:${discordUserId}`, { userId, guildId: guild.id, startedAt: now, activeMs: 0, activeSince: null });
}

export function registerVoiceTracking(client) {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      if (newState.member?.user.bot) return;
      const now = Date.now();
      const guild = newState.guild;
      const key = `${guild.id}:${newState.id}`;

      if (!oldState.channelId && newState.channelId) {
        await startSession(guild, newState.id, now);
      } else if (oldState.channelId && !newState.channelId) {
        const s = sessions.get(key);
        sessions.delete(key);
        if (s) await saveSession(s, now);
      }

      // Joins/leaves/moves/deafens change eligibility for everyone in
      // the affected channels (someone leaving can leave another alone).
      reevaluateChannel(oldState.channel, now);
      if (newState.channelId !== oldState.channelId) reevaluateChannel(newState.channel, now);
    } catch (err) {
      console.error("voiceStateUpdate handler failed:", err.message);
    }
  });
}

// On startup, pick up people already sitting in voice.
export async function seedVoiceSessions(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    for (const vs of guild.voiceStates.cache.values()) {
      if (!vs.channelId || vs.member?.user.bot) continue;
      await startSession(guild, vs.id, now);
    }
    for (const channel of guild.channels.cache.values()) {
      if (channel.isVoiceBased()) reevaluateChannel(channel, now);
    }
  }
}

export async function flushVoiceSessions() {
  const now = Date.now();
  for (const s of sessions.values()) await saveSession(s, now);
  sessions.clear();
}
