import fs from "node:fs";
import path from "node:path";

const API_BASE = process.env.BSD_API_BASE || "https://sports.bzzoiro.com";
const API_KEY = process.env.BSD_API_KEY || "";

const ENDPOINTS = {
  events: process.env.BSD_EVENTS_ENDPOINT || "/api/events/",
  predictions: process.env.BSD_PREDICTIONS_ENDPOINT || "/api/predictions/",
  leagues: process.env.BSD_LEAGUES_ENDPOINT || "/api/leagues/"
};

function toAbsoluteUrl(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value, API_BASE).toString();
}

function buildHeaders() {
  const headers = {
    Accept: "application/json"
  };

  if (API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`;
    headers["X-API-Key"] = API_KEY;
    headers["x-api-key"] = API_KEY;
  }

  return headers;
}

async function fetchJson(label, endpoint) {
  const url = toAbsoluteUrl(endpoint);
  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders()
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`[${label}] ${response.status} ${response.statusText}: ${text.slice(0, 250)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`[${label}] răspunsul nu este JSON valid.`);
  }
}

function extractArray(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload;

  const keys = [
    ...preferredKeys,
    "items",
    "data",
    "results",
    "response",
    "events",
    "matches",
    "predictions",
    "leagues"
  ];

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }

  if (payload && typeof payload === "object") {
    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        for (const nested of Object.values(value)) {
          if (Array.isArray(nested)) return nested;
        }
      }
    }
  }

  return [];
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function maybeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickTeamName(team) {
  if (!team) return null;
  if (typeof team === "string") return team;
  return firstDefined(team.name, team.team_name, team.short_name, team.title);
}

function pickLeagueName(item) {
  return firstDefined(
    item.league_name,
    item.competition_name,
    item.tournament_name,
    item.league?.name,
    item.competition?.name,
    item.tournament?.name,
    typeof item.league === "string" ? item.league : null
  );
}

function pickCountryName(item) {
  return firstDefined(
    item.country,
    item.country_name,
    item.league?.country,
    item.competition?.country,
    item.area?.name
  );
}

function pickStatus(item) {
  const rawStatus = firstDefined(
    item.status,
    item.state,
    item.match_status,
    item.fixture_status,
    item.time_status,
    item.live ? "live" : null
  );

  if (typeof rawStatus === "object") {
    return firstDefined(rawStatus.short, rawStatus.long, rawStatus.name, JSON.stringify(rawStatus));
  }

  return rawStatus || "unknown";
}

function countBookmakers(item) {
  const odds = firstDefined(item.odds, item.bookmakers, item.markets, item.prices);
  if (Array.isArray(item.bookmakers)) return item.bookmakers.length;
  if (Array.isArray(item.odds)) return item.odds.length;
  if (odds && typeof odds === "object") return Object.keys(odds).length;
  return 0;
}

function countMarkets(item) {
  if (Array.isArray(item.markets)) return item.markets.length;
  if (item.odds && typeof item.odds === "object") return Object.keys(item.odds).length;
  return 0;
}

function hasOdds(item) {
  return Boolean(
    item.has_odds ||
    item.hasOdds ||
    (Array.isArray(item.bookmakers) && item.bookmakers.length) ||
    (Array.isArray(item.odds) && item.odds.length) ||
    (item.odds && typeof item.odds === "object" && Object.keys(item.odds).length)
  );
}

function isFootball(item) {
  const sport = firstDefined(item.sport, item.sport_name, item.category, item.game);
  if (!sport) return true;
  return /football|soccer/i.test(String(sport));
}

function normalizeEvent(item) {
  const home = firstDefined(
    pickTeamName(item.home_team),
    pickTeamName(item.homeTeam),
    item.home_name,
    item.team_home,
    item.home
  );

  const away = firstDefined(
    pickTeamName(item.away_team),
    pickTeamName(item.awayTeam),
    item.away_name,
    item.team_away,
    item.away
  );

  return {
    id: firstDefined(item.id, item.event_id, item.fixture_id, item.match_id),
    startTime: firstDefined(item.start_time, item.kickoff, item.commence_time, item.date, item.match_date),
    status: pickStatus(item),
    league: pickLeagueName(item),
    country: pickCountryName(item),
    homeTeam: home,
    awayTeam: away,
    hasOdds: hasOdds(item),
    bookmakerCount: countBookmakers(item),
    marketCount: countMarkets(item)
  };
}

function normalizePrediction(item) {
  const home = firstDefined(
    pickTeamName(item.home_team),
    pickTeamName(item.homeTeam),
    item.home_name,
    item.team_home,
    item.home
  );

  const away = firstDefined(
    pickTeamName(item.away_team),
    pickTeamName(item.awayTeam),
    item.away_name,
    item.team_away,
    item.away
  );

  return {
    id: firstDefined(item.id, item.prediction_id, item.event_id, item.match_id),
    eventId: firstDefined(item.event_id, item.match_id, item.fixture_id),
    startTime: firstDefined(item.start_time, item.kickoff, item.commence_time, item.date, item.match_date),
    league: pickLeagueName(item),
    country: pickCountryName(item),
    homeTeam: home,
    awayTeam: away,
    model: firstDefined(item.model, item.provider, item.source),
    market: firstDefined(item.market, item.prediction_type, item.bet_type),
    pick: firstDefined(item.pick, item.prediction, item.tip, item.selection, item.outcome),
    probability: maybeNumber(firstDefined(item.probability, item.win_probability, item.prob, item.confidence_score)),
    confidence: maybeNumber(firstDefined(item.confidence, item.confidence_score, item.score))
  };
}

function normalizeLeague(item) {
  return {
    id: firstDefined(item.id, item.league_id, item.competition_id),
    name: firstDefined(item.name, item.league_name, item.competition_name, item.title),
    country: firstDefined(item.country, item.country_name, item.area?.name),
    season: firstDefined(item.season, item.current_season)
  };
}

function sortByStartTime(items) {
  return [...items].sort((a, b) => {
    const aTime = a.startTime ? new Date(a.startTime).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.startTime ? new Date(b.startTime).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function buildOverview(events, predictions, leagues, errors) {
  const liveNow = events.filter(item => /live|1h|2h|ht|ft/i.test(String(item.status))).length;
  const withOdds = events.filter(item => item.hasOdds).length;
  const leagueNames = new Set(
    [...events, ...predictions]
      .map(item => item.league)
      .filter(Boolean)
  );

  return {
    generatedAt: new Date().toISOString(),
    cards: [
      { label: "Evenimente", value: events.length, meta: "meciuri extrase din endpoint-ul events" },
      { label: "Cu cote", value: withOdds, meta: "evenimente unde au fost detectate odds/bookmakers" },
      { label: "Live acum", value: liveNow, meta: "calculat din statusul meciurilor" },
      { label: "Predicții", value: predictions.length, meta: "înregistrări extrase din endpoint-ul predictions" },
      { label: "Ligi", value: Math.max(leagues.length, leagueNames.size), meta: "ligile identificate în dataset" }
    ],
    errors
  };
}

function ensureDataDir() {
  fs.mkdirSync("data", { recursive: true });
}

function writeJson(filename, content) {
  fs.writeFileSync(path.join("data", filename), JSON.stringify(content, null, 2) + "\n", "utf8");
}

async function main() {
  const errors = [];
  let eventsPayload = null;
  let predictionsPayload = null;
  let leaguesPayload = null;

  try {
    eventsPayload = await fetchJson("events", ENDPOINTS.events);
  } catch (error) {
    errors.push(error.message);
  }

  try {
    predictionsPayload = await fetchJson("predictions", ENDPOINTS.predictions);
  } catch (error) {
    errors.push(error.message);
  }

  try {
    leaguesPayload = await fetchJson("leagues", ENDPOINTS.leagues);
  } catch (error) {
    errors.push(error.message);
  }

  const rawEvents = extractArray(eventsPayload, ["events", "matches"]).filter(isFootball);
  const rawPredictions = extractArray(predictionsPayload, ["predictions"]).filter(isFootball);
  const rawLeagues = extractArray(leaguesPayload, ["leagues"]);

  const events = sortByStartTime(rawEvents.map(normalizeEvent));
  const predictions = sortByStartTime(rawPredictions.map(normalizePrediction));
  const leagues = rawLeagues.length
    ? rawLeagues.map(normalizeLeague).filter(item => item.name)
    : [...new Set(events.map(item => item.league).filter(Boolean))].map(name => ({ name }));

  if (!events.length && !predictions.length) {
    throw new Error(
      "Nu s-au putut normaliza date utile din BSD. Verifică în workflow endpoint-urile BSD_*_ENDPOINT și eventual schema JSON exactă din documentație."
    );
  }

  ensureDataDir();

  writeJson("football-overview.json", buildOverview(events, predictions, leagues, errors));
  writeJson("football-events.json", { generatedAt: new Date().toISOString(), count: events.length, items: events });
  writeJson("football-predictions.json", { generatedAt: new Date().toISOString(), count: predictions.length, items: predictions });
  writeJson("football-leagues.json", { generatedAt: new Date().toISOString(), count: leagues.length, items: leagues });
  writeJson("football-raw.json", {
    generatedAt: new Date().toISOString(),
    endpoints: ENDPOINTS,
    errors,
    samples: {
      event: rawEvents[0] || null,
      prediction: rawPredictions[0] || null,
      league: rawLeagues[0] || null
    }
  });

  console.log(`OK: ${events.length} evenimente, ${predictions.length} predicții, ${leagues.length} ligi.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
