// Tabletop College — real RPG and wargame tracking, Phase 1. Real
// manual session hours, real win/loss history, real D&D 5e rules
// search via Open5e. Deliberately no dice engine, no turn tracker,
// no infrastructure for future products — see lib/tabletop.js.

import { useEffect, useState } from "react";
import {
  fetchCampaigns, createCampaign, deleteCampaign,
  fetchCharacters, createCharacter, deleteCharacter,
  fetchSessions, logSession,
  fetchArmies, createArmy, deleteArmy,
  fetchUnits, addUnit, updateUnitStatus, removeUnit,
  fetchGames, logGame, deleteGame,
} from "../lib/tabletop";
import { searchSpells, searchMonsters } from "../lib/open5e";

const RPG_SYSTEMS = [
  { key: "dnd5e_2014", label: "D&D 5e (2014)" },
  { key: "dnd5e_2024", label: "D&D 5e (2024)" },
  { key: "pf2e", label: "Pathfinder 2e" },
  { key: "daggerheart", label: "Daggerheart" },
  { key: "cyberpunk_red", label: "Cyberpunk Red" },
  { key: "coc7", label: "Call of Cthulhu 7e" },
  { key: "custom_rpg", label: "Other / Homebrew" },
];

const WARGAME_SYSTEMS = [
  { key: "wh40k_10e", label: "Warhammer 40,000 (10th Ed)" },
  { key: "aos", label: "Age of Sigmar" },
  { key: "kill_team", label: "Kill Team" },
  { key: "wfh", label: "Warhammer: The Old World" },
  { key: "custom_wargame", label: "Other / Homebrew" },
];

const PAINTED_STATUSES = ["unassembled", "assembled", "primed", "partial", "finished"];
const PAINTED_LABELS = { unassembled: "Unassembled", assembled: "Assembled", primed: "Primed", partial: "Partial", finished: "Finished" };
const PAINTED_WEIGHT = { unassembled: 0, assembled: 0, primed: 0.25, partial: 0.5, finished: 1 };

export default function TabletopHomePage({ onBack, isLoggedIn, userId, onSignIn, onCreateAccount }) {
  const [section, setSection] = useState("rpg"); // rpg | wargames | rules

  if (!isLoggedIn) {
    return (
      <div className="price-page">
        <div className="price-page__head">
          <button type="button" className="back-link" onClick={onBack}>← Back to Overview</button>
          <p className="price-page__subtitle">Real campaigns, real session hours, real game history.</p>
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
        <button type="button" className="back-link" onClick={onBack}>← Back to Overview</button>
        <p className="price-page__subtitle">Real campaigns and armies — yours, tracked honestly.</p>
      </div>

      <div className="backlog-status-tabs">
        <button type="button" className={`quickdash-reset-btn ${section === "rpg" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("rpg")}>RPG</button>
        <button type="button" className={`quickdash-reset-btn ${section === "wargames" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("wargames")}>Wargames</button>
        <button type="button" className={`quickdash-reset-btn ${section === "dice" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("dice")}>Dice</button>
        <button type="button" className={`quickdash-reset-btn ${section === "rules" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("rules")}>Rules</button>
      </div>

      {section === "rpg" && <RpgSection userId={userId} />}
      {section === "wargames" && <WargamesSection userId={userId} />}
      {section === "dice" && <DiceSection />}
      {section === "rules" && <RulesSection />}
    </div>
  );
}

// ---------- RPG ----------

function RpgSection({ userId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [status, setStatus] = useState("loading");
  const [activeCampaign, setActiveCampaign] = useState(null);

  const [name, setName] = useState("");
  const [systemKey, setSystemKey] = useState("dnd5e_2014");
  const [role, setRole] = useState("player");
  const [externalVttUrl, setExternalVttUrl] = useState("");
  const [dndbeyondUrl, setDndbeyondUrl] = useState("");

  useEffect(() => { loadCampaigns(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadCampaigns() {
    setStatus("loading");
    try {
      const rows = await fetchCampaigns(userId);
      setCampaigns(rows);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load campaigns:", err);
      setStatus("error");
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createCampaign(userId, {
        name: name.trim(), systemKey, role,
        externalVttUrl: externalVttUrl.trim() || null,
        dndbeyondUrl: dndbeyondUrl.trim() || null,
      });
      setName(""); setExternalVttUrl(""); setDndbeyondUrl("");
      loadCampaigns();
    } catch (err) {
      console.error("Failed to create campaign:", err);
    }
  }

  async function handleDelete(campaignId) {
    try {
      await deleteCampaign(campaignId);
      if (activeCampaign?.id === campaignId) setActiveCampaign(null);
      loadCampaigns();
    } catch (err) {
      console.error("Failed to delete campaign:", err);
    }
  }

  if (activeCampaign) {
    return <CampaignDetail userId={userId} campaign={activeCampaign} onBack={() => { setActiveCampaign(null); loadCampaigns(); }} />;
  }

  return (
    <div>
      <form className="backlog-add" onSubmit={handleCreate} style={{ marginTop: "16px" }}>
        <input className="price-search__input" placeholder="Campaign name…" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={systemKey} onChange={(e) => setSystemKey(e.target.value)}>
          {RPG_SYSTEMS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="player">Player</option>
          <option value="gm">GM</option>
          <option value="both">Both</option>
        </select>
        <button type="submit" className="price-search__button">Create campaign</button>
      </form>
      <details style={{ marginBottom: "16px" }}>
        <summary className="panel__status" style={{ cursor: "pointer" }}>Connections (optional — VTT / D&amp;D Beyond links)</summary>
        <div className="backlog-add" style={{ marginTop: "8px" }}>
          <input className="price-search__input" placeholder="Roll20 / Foundry URL (optional)" value={externalVttUrl} onChange={(e) => setExternalVttUrl(e.target.value)} />
          <input className="price-search__input" placeholder="D&amp;D Beyond campaign URL (optional)" value={dndbeyondUrl} onChange={(e) => setDndbeyondUrl(e.target.value)} />
          <p className="panel__status" style={{ fontSize: "11px" }}>Just a link-out — no account sync, no scraping. These attach to the next campaign you create above.</p>
        </div>
      </details>

      {status === "loading" && <p className="panel__status">Loading campaigns…</p>}
      {status === "ready" && campaigns.length === 0 && <p className="panel__status">No campaigns yet — create one above.</p>}
      {status === "ready" && campaigns.length > 0 && (
        <ul className="backlog-list">
          {campaigns.map((c) => (
            <li key={c.id} className="backlog-card">
              <div className="backlog-card__info">
                <span className="backlog-card__title">{c.name}</span>
                <div className="backlog-card__meta">
                  <span>{RPG_SYSTEMS.find((s) => s.key === c.system_key)?.label || c.system_key}</span>
                  <span>{Math.round(c.total_session_minutes / 60)}h logged</span>
                </div>
              </div>
              <button type="button" className="linking-row__connect" onClick={() => setActiveCampaign(c)}>Open</button>
              <button type="button" className="game-popup__close" onClick={() => handleDelete(c.id)} aria-label="Delete">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignDetail({ userId, campaign, onBack }) {
  const [characters, setCharacters] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState("loading");

  const [charName, setCharName] = useState("");
  const [charClass, setCharClass] = useState("");

  const [sessionDate, setSessionDate] = useState(new Date().toISOString().slice(0, 10));
  const [sessionMinutes, setSessionMinutes] = useState("");
  const [sessionRecap, setSessionRecap] = useState("");

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setStatus("loading");
    try {
      const [allChars, sessionRows] = await Promise.all([fetchCharacters(userId), fetchSessions(campaign.id)]);
      setCharacters(allChars.filter((c) => c.campaign_id === campaign.id));
      setSessions(sessionRows);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load campaign detail:", err);
      setStatus("error");
    }
  }

  async function handleAddCharacter(e) {
    e.preventDefault();
    if (!charName.trim()) return;
    try {
      await createCharacter(userId, { name: charName.trim(), systemKey: campaign.system_key, campaignId: campaign.id, classOrPlaybook: charClass.trim() || null });
      setCharName(""); setCharClass("");
      loadAll();
    } catch (err) {
      console.error("Failed to add character:", err);
    }
  }

  async function handleLogSession(e) {
    e.preventDefault();
    try {
      await logSession(userId, campaign.id, {
        playedAt: sessionDate,
        durationMinutes: sessionMinutes ? Number(sessionMinutes) : null,
        recap: sessionRecap.trim() || null,
      });
      setSessionMinutes(""); setSessionRecap("");
      loadAll();
    } catch (err) {
      console.error("Failed to log session:", err);
    }
  }

  const totalHours = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0) / 60;

  return (
    <div>
      <button type="button" className="back-link" onClick={onBack} style={{ marginTop: "16px" }}>← Back to Campaigns</button>
      <h2 className="price-page__title" style={{ fontSize: "22px" }}>{campaign.name}</h2>

      <div className="backlog-summary">
        <div className="panel__stat">
          <span className="panel__stat-value">{sessions.length}</span>
          <span className="panel__stat-label">Sessions</span>
        </div>
        <div className="panel__stat">
          <span className="panel__stat-value">{totalHours.toFixed(1)}h</span>
          <span className="panel__stat-label">Total hours</span>
        </div>
        <div className="panel__stat">
          <span className="panel__stat-value">{characters.length}</span>
          <span className="panel__stat-label">Characters</span>
        </div>
      </div>

      {(campaign.external_vtt_url || campaign.dndbeyond_campaign_url) && (
        <div className="backlog-add" style={{ marginTop: "12px" }}>
          <span className="feed-col__label">Connections</span>
          {campaign.external_vtt_url && (
            <a href={campaign.external_vtt_url} target="_blank" rel="noopener noreferrer" className="steam-sync-link">Open VTT →</a>
          )}
          {campaign.dndbeyond_campaign_url && (
            <a href={campaign.dndbeyond_campaign_url} target="_blank" rel="noopener noreferrer" className="steam-sync-link">Open D&amp;D Beyond campaign →</a>
          )}
        </div>
      )}

      <span className="feed-col__label" style={{ display: "block", marginTop: "20px" }}>Characters</span>
      <form className="backlog-add" onSubmit={handleAddCharacter}>
        <input className="price-search__input" placeholder="Character name…" value={charName} onChange={(e) => setCharName(e.target.value)} />
        <input className="price-search__input" placeholder="Class / playbook (optional)" value={charClass} onChange={(e) => setCharClass(e.target.value)} />
        <button type="submit" className="price-search__button">Add</button>
      </form>
      {characters.length > 0 && (
        <ul className="backlog-list">
          {characters.map((c) => (
            <li key={c.id} className="backlog-card">
              <div className="backlog-card__info">
                <span className="backlog-card__title">{c.name}</span>
                {c.class_or_playbook && <span className="backlog-card__meta">{c.class_or_playbook}</span>}
              </div>
              <button type="button" className="game-popup__close" onClick={() => deleteCharacter(c.id).then(loadAll).catch((err) => console.error("Failed to delete character:", err))} aria-label="Remove">✕</button>
            </li>
          ))}
        </ul>
      )}

      <span className="feed-col__label" style={{ display: "block", marginTop: "20px" }}>Log a session</span>
      <form className="backlog-add" onSubmit={handleLogSession}>
        <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
        <input className="price-search__input" type="number" min="0" placeholder="Minutes played" value={sessionMinutes} onChange={(e) => setSessionMinutes(e.target.value)} style={{ maxWidth: "140px" }} />
        <input className="price-search__input" placeholder="Recap (optional)" value={sessionRecap} onChange={(e) => setSessionRecap(e.target.value)} />
        <button type="submit" className="price-search__button">Log session</button>
      </form>

      {status === "ready" && sessions.length > 0 && (
        <ul className="calendar-list">
          {sessions.map((s) => (
            <li key={s.id} className="calendar-row">
              <span className="calendar-row__date">{s.played_at}</span>
              <div className="calendar-row__body">
                <span className="calendar-row__event">
                  {s.duration_minutes ? `${(s.duration_minutes / 60).toFixed(1)}h` : "No time logged"}
                  {s.recap ? ` — ${s.recap}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Wargames ----------

function WargamesSection({ userId }) {
  const [view, setView] = useState("armies"); // armies | games
  const [armies, setArmies] = useState([]);
  const [games, setGames] = useState([]);
  const [status, setStatus] = useState("loading");
  const [activeArmy, setActiveArmy] = useState(null);

  const [armyName, setArmyName] = useState("");
  const [armySystem, setArmySystem] = useState("wh40k_10e");
  const [armyFaction, setArmyFaction] = useState("");

  const [opponent, setOpponent] = useState("");
  const [result, setResult] = useState("win");
  const [gameArmyId, setGameArmyId] = useState("");

  useEffect(() => { loadAll(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setStatus("loading");
    try {
      const [armyRows, gameRows] = await Promise.all([fetchArmies(userId), fetchGames(userId)]);
      setArmies(armyRows);
      setGames(gameRows);
      if (!gameArmyId && armyRows.length > 0) setGameArmyId(armyRows[0].id);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load wargame data:", err);
      setStatus("error");
    }
  }

  async function handleCreateArmy(e) {
    e.preventDefault();
    if (!armyName.trim()) return;
    try {
      await createArmy(userId, { name: armyName.trim(), systemKey: armySystem, faction: armyFaction.trim() || null });
      setArmyName(""); setArmyFaction("");
      loadAll();
    } catch (err) {
      console.error("Failed to create army:", err);
    }
  }

  async function handleLogGame(e) {
    e.preventDefault();
    try {
      await logGame(userId, { systemKey: armySystem, armyId: gameArmyId || null, opponentName: opponent.trim() || null, result });
      setOpponent("");
      loadAll();
    } catch (err) {
      console.error("Failed to log game:", err);
    }
  }

  const wins = games.filter((g) => g.result === "win").length;
  const losses = games.filter((g) => g.result === "loss").length;
  const draws = games.filter((g) => g.result === "draw").length;
  const winRate = games.length > 0 ? Math.round((wins / games.length) * 100) : 0;

  if (activeArmy) {
    return <ArmyDetail userId={userId} army={activeArmy} onBack={() => { setActiveArmy(null); loadAll(); }} />;
  }

  return (
    <div>
      <div className="backlog-status-tabs" style={{ marginTop: "16px" }}>
        <button type="button" className={`quickdash-reset-btn ${view === "armies" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setView("armies")}>Armies</button>
        <button type="button" className={`quickdash-reset-btn ${view === "games" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setView("games")}>Game History</button>
      </div>

      {view === "armies" && (
        <>
          <form className="backlog-add" onSubmit={handleCreateArmy}>
            <input className="price-search__input" placeholder="Army name…" value={armyName} onChange={(e) => setArmyName(e.target.value)} />
            <select value={armySystem} onChange={(e) => setArmySystem(e.target.value)}>
              {WARGAME_SYSTEMS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <input className="price-search__input" placeholder="Faction (optional)" value={armyFaction} onChange={(e) => setArmyFaction(e.target.value)} />
            <button type="submit" className="price-search__button">Create army</button>
          </form>

          {status === "ready" && armies.length === 0 && <p className="panel__status">No armies yet — create one above.</p>}
          {status === "ready" && armies.length > 0 && (
            <ul className="backlog-list">
              {armies.map((a) => (
                <li key={a.id} className="backlog-card">
                  <div className="backlog-card__info">
                    <span className="backlog-card__title">{a.name}</span>
                    <div className="backlog-card__meta">
                      <span>{WARGAME_SYSTEMS.find((s) => s.key === a.system_key)?.label || a.system_key}</span>
                      {a.faction && <span>{a.faction}</span>}
                    </div>
                  </div>
                  <button type="button" className="linking-row__connect" onClick={() => setActiveArmy(a)}>Open</button>
                  <button type="button" className="game-popup__close" onClick={() => deleteArmy(a.id).then(loadAll).catch((err) => console.error("Failed to delete army:", err))} aria-label="Delete">✕</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {view === "games" && (
        <>
          {games.length > 0 && (
            <div className="backlog-summary">
              <div className="panel__stat"><span className="panel__stat-value">{wins}</span><span className="panel__stat-label">Wins</span></div>
              <div className="panel__stat"><span className="panel__stat-value">{losses}</span><span className="panel__stat-label">Losses</span></div>
              <div className="panel__stat"><span className="panel__stat-value">{draws}</span><span className="panel__stat-label">Draws</span></div>
              <div className="panel__stat"><span className="panel__stat-value">{winRate}%</span><span className="panel__stat-label">Win rate</span></div>
            </div>
          )}

          {armies.length > 0 && (
            <form className="backlog-add" onSubmit={handleLogGame}>
              <select value={gameArmyId} onChange={(e) => setGameArmyId(e.target.value)}>
                {armies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <input className="price-search__input" placeholder="Opponent (optional)" value={opponent} onChange={(e) => setOpponent(e.target.value)} />
              <select value={result} onChange={(e) => setResult(e.target.value)}>
                <option value="win">Win</option>
                <option value="loss">Loss</option>
                <option value="draw">Draw</option>
                <option value="unfinished">Unfinished</option>
              </select>
              <button type="submit" className="price-search__button">Log game</button>
            </form>
          )}
          {armies.length === 0 && <p className="panel__status">Create an army first to log a game.</p>}

          {games.length > 0 && (
            <ul className="calendar-list">
              {games.map((g) => (
                <li key={g.id} className="calendar-row">
                  <span className="calendar-row__date">{g.played_at}</span>
                  <div className="calendar-row__body">
                    <span className="calendar-row__event" style={{ textTransform: "capitalize" }}>
                      {g.result}{g.opponent_name ? ` vs ${g.opponent_name}` : ""}
                    </span>
                  </div>
                  <button type="button" className="game-popup__close" onClick={() => deleteGame(g.id).then(loadAll).catch((err) => console.error("Failed to delete game:", err))} aria-label="Delete">✕</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ArmyDetail({ userId, army, onBack }) {
  const [units, setUnits] = useState([]);
  const [status, setStatus] = useState("loading");
  const [unitName, setUnitName] = useState("");
  const [modelCount, setModelCount] = useState(1);

  useEffect(() => { loadUnits(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadUnits() {
    setStatus("loading");
    try {
      const rows = await fetchUnits(army.id);
      setUnits(rows);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load units:", err);
      setStatus("error");
    }
  }

  async function handleAddUnit(e) {
    e.preventDefault();
    if (!unitName.trim()) return;
    try {
      await addUnit(userId, army.id, { name: unitName.trim(), modelCount: Number(modelCount) || 1 });
      setUnitName(""); setModelCount(1);
      loadUnits();
    } catch (err) {
      console.error("Failed to add unit:", err);
    }
  }

  const totalModels = units.reduce((sum, u) => sum + u.model_count, 0);
  const paintedWeightedSum = units.reduce((sum, u) => sum + PAINTED_WEIGHT[u.painted_status] * u.model_count, 0);
  const paintedPct = totalModels > 0 ? Math.round((paintedWeightedSum / totalModels) * 100) : 0;

  return (
    <div>
      <button type="button" className="back-link" onClick={onBack} style={{ marginTop: "16px" }}>← Back to Armies</button>
      <h2 className="price-page__title" style={{ fontSize: "22px" }}>{army.name}</h2>

      {units.length > 0 && (
        <div className="backlog-summary">
          <div className="panel__stat"><span className="panel__stat-value">{units.length}</span><span className="panel__stat-label">Units</span></div>
          <div className="panel__stat"><span className="panel__stat-value">{totalModels}</span><span className="panel__stat-label">Models</span></div>
          <div className="panel__stat"><span className="panel__stat-value">{paintedPct}%</span><span className="panel__stat-label">Painted (weighted)</span></div>
        </div>
      )}

      <form className="backlog-add" onSubmit={handleAddUnit}>
        <input className="price-search__input" placeholder="Unit name…" value={unitName} onChange={(e) => setUnitName(e.target.value)} />
        <input className="price-search__input" type="number" min="1" placeholder="Model count" value={modelCount} onChange={(e) => setModelCount(e.target.value)} style={{ maxWidth: "140px" }} />
        <button type="submit" className="price-search__button">Add unit</button>
      </form>

      {status === "ready" && units.length === 0 && <p className="panel__status">No units yet — add one above.</p>}
      {status === "ready" && units.length > 0 && (
        <ul className="backlog-list">
          {units.map((u) => (
            <li key={u.id} className="backlog-card">
              <div className="backlog-card__info">
                <span className="backlog-card__title">{u.name} {u.model_count > 1 && `×${u.model_count}`}</span>
              </div>
              <select
                className="backlog-card__status-select"
                value={u.painted_status}
                onChange={(e) => updateUnitStatus(u.id, e.target.value).then(loadUnits).catch((err) => console.error("Failed to update unit status:", err))}
              >
                {PAINTED_STATUSES.map((s) => <option key={s} value={s}>{PAINTED_LABELS[s]}</option>)}
              </select>
              <button type="button" className="game-popup__close" onClick={() => removeUnit(u.id).then(loadUnits).catch((err) => console.error("Failed to remove unit:", err))} aria-label="Remove">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Dice ----------

const DICE_FACES = [4, 6, 8, 10, 12, 20, 100];

function DiceSection() {
  const [notation, setNotation] = useState("1d20");
  const [results, setResults] = useState(null);

  function rollDie(faces) {
    return Math.floor(Math.random() * faces) + 1;
  }

  function handleQuickRoll(faces) {
    const value = rollDie(faces);
    setNotation(`1d${faces}`);
    setResults({ rolls: [value], sum: value, faces });
  }

  function handleNotationRoll(e) {
    e.preventDefault();
    const match = notation.trim().match(/^(\d+)d(\d+)$/i);
    if (!match) {
      setResults({ error: true });
      return;
    }
    const count = Math.min(Number(match[1]), 100); // capped to prevent abuse
    const faces = Number(match[2]);
    const rolls = Array.from({ length: count }, () => rollDie(faces));
    setResults({ rolls, sum: rolls.reduce((a, b) => a + b, 0), faces });
  }

  return (
    <div style={{ marginTop: "16px" }}>
      <div className="backlog-status-tabs">
        {DICE_FACES.map((f) => (
          <button key={f} type="button" className="quickdash-reset-btn" onClick={() => handleQuickRoll(f)}>
            d{f}
          </button>
        ))}
      </div>

      <form className="price-search" onSubmit={handleNotationRoll}>
        <input
          className="price-search__input"
          placeholder="e.g. 3d6"
          value={notation}
          onChange={(e) => setNotation(e.target.value)}
          style={{ maxWidth: "160px" }}
        />
        <button type="submit" className="price-search__button">Roll</button>
      </form>

      {results?.error && <p className="panel__status panel__status--error">Use notation like 1d20 or 3d6.</p>}
      {results && !results.error && (
        <div className="backlog-summary">
          <div className="panel__stat">
            <span className="panel__stat-value">{results.sum}</span>
            <span className="panel__stat-label">Total</span>
          </div>
          <div className="panel__stat">
            <span className="panel__stat-value" style={{ fontSize: "16px" }}>{results.rolls.join(", ")}</span>
            <span className="panel__stat-label">Individual rolls</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Rules ----------

function RulesSection() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("spells");
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("idle");

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setStatus("loading");
    try {
      const data = kind === "spells" ? await searchSpells(query.trim()) : await searchMonsters(query.trim());
      setResults(data);
      setStatus("ready");
    } catch (err) {
      console.error("Rules search failed:", err);
      setStatus("error");
    }
  }

  return (
    <div style={{ marginTop: "16px" }}>
      <p className="panel__status">
        D&D 5e has real, open SRD content via Open5e. Other systems don't have a legitimate open API —
        use your character sheet's link-out URL or personal notes instead.
      </p>

      <form className="price-search" onSubmit={handleSearch}>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="spells">Spells</option>
          <option value="monsters">Monsters</option>
        </select>
        <input className="price-search__input" placeholder={`Search ${kind}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="price-search__button">Search</button>
      </form>

      {status === "loading" && <p className="panel__status">Searching…</p>}
      {status === "ready" && results.length === 0 && <p className="panel__status">No results.</p>}
      {status === "ready" && results.length > 0 && (
        <ul className="backlog-list">
          {results.map((r) => (
            <li key={r.slug} className="backlog-card">
              <div className="backlog-card__info">
                <span className="backlog-card__title">{r.name}</span>
                <div className="backlog-card__meta">
                  {kind === "spells" ? (
                    <span>Level {r.level} · {r.school}</span>
                  ) : (
                    <span>{r.type} · CR {r.cr}</span>
                  )}
                </div>
                <p className="backlog-card__meta" style={{ maxWidth: "480px" }}>
                  {r.desc?.slice(0, 200)}{r.desc?.length > 200 ? "…" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <a href="https://open5e.com" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
        D&D 5e SRD content provided by Open5e
      </a>
    </div>
  );
}
