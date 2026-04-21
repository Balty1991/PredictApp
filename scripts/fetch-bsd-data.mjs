import fs from "node:fs";
import path from "node:path";

const API_BASE = process.env.BSD_API_BASE || "https://sports.bzzoiro.com";
const API_KEY = process.env.BSD_API_KEY || "";

const DEFAULT_CANDIDATES = {
  events: [
    process.env.BSD_EVENTS_ENDPOINT || "/api/events/",
    "/api/events/?sport=football",
    "/api/events/?sport=soccer",
    "/api/football/events/",
    "/api/matches/"
  ],
  predictions: [
    process.env.BSD_PREDICTIONS_ENDPOINT || "/api/predictions/",
    "/api/predictions/?sport=football",
    "/api/predictions/?sport=soccer",
    "/api/football/predictions/",
    "/api/tips/"
  ],
  leagues: [
    process.env.BSD_LEAGUES_ENDPOINT || "/api/leagues/",
    "/api/leagues/?sport=football",
    "/api/football/leagues/",
    "/api/competitions/"
  ]
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toAbsoluteUrl(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value, API_BASE).toString();
}

function getBaseHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}

function getAuthStrategies() {
  return [
    { name: "bearer", headers: { Authorization: `Bearer ${API_KEY}` } },
    { name: "x-api-key", headers: { "X-API-Key": API_KEY } },
    { name: "apikey-header", headers: { apikey: API_KEY } },
    { name: "token", headers: { Authorization: `Token ${API_KEY}` } },
    { name: "api-key-auth", headers: { Authorization: `Api-Key ${API_KEY}` } },
    { name: "query-api_key", query: { api_key: API_KEY } },
    { name: "query-apikey", query: { apikey: API_KEY } },
    { name: "query-key", query: { key: API_KEY } },
    { name: "query-token", query: { token: API_KEY } }
  ];
}

function withQuery(url, query = {}) {
  const next = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") next.searchParams.set(key, value);
  }
  return next.toString();
}

async function fetchJson(label, endpoint, authStrategy) {
  const baseUrl = toAbsoluteUrl(endpoint);
  const url = withQuery(baseUrl, authStrategy.query || {});
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...getBaseHeaders(),
      ...(authStrategy.headers || {})
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`[${label}] ${response.status} ${response.statusText} via ${authStrategy.name} @ ${url} :: ${text.slice(0, 300)}`);
  }

  try {
    return { url, payload: JSON.parse(text), auth: authStrategy.name };
  } catch (error) {
    throw new Error(`[${label}] răspuns non-JSON via ${authStrategy.name} @ ${url} :: ${text.slice(0, 180)}`);
  }
}

async function fetchFirstWorking(label, candidates) {
  const tried = [];
  const authStrategies = getAuthStrategies();

  for (const candidate of unique(candidates)) {
    for (const authStrategy of authStrategies) {
      try {
        const result = await fetchJson(label, candidate, authStrategy);
        return { ...result, tried };
      } catch (error) {
        tried.push(error.message);
      }
    }
  }

  return { url: null, payload: null, auth: null, tried };
}

function looksLikeRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function maybeObjectMapToArray(value) {
  if (!looksLikeRecord(value)) return null;
  const values = Object.values(value);
  if (!values.length) return null;
  if (values.every(looksLikeRecord)) return values;
  return null;
}

function deepFindArray(payload, depth = 0) {
  if (depth > 4 || payload == null) return null;
  if (Array.isArray(payload)) return payload;

  const objectMap = maybeObjectMapToArray(payload);
  if (objectMap) return objectMap;

  if (looksLikeRecord(payload)) {
    for (const value of Object.values(payload)) {
      const found = deepFindArray(value, depth + 1);
      if (found) return found;
    }
  }

  return null;
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
    "leagues",
    "fixtures",
    "tips"
  ];

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];

    const objectMap = maybeObjectMapToArray(payload?.[key]);
    if (objectMap) return objectMap;
  }

  return deepFindArray(payload) || [];
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
  if (!API_KEY) {
    throw new Error("Secretul BSD_API_KEY lipsește din GitHub Actions.");
  }

  ensureDataDir();

  const eventsResult = await fetchFirstWorking("events", DEFAULT_CANDIDATES.events);
  const predictionsResult = await fetchFirstWorking("predictions", DEFAULT_CANDIDATES.predictions);
  const leaguesResult = await fetchFirstWorking("leagues", DEFAULT_CANDIDATES.leagues);

  const errors = [
    ...eventsResult.tried,
    ...predictionsResult.tried,
    ...leaguesResult.tried
  ];

  const rawEvents = extractArray(eventsResult.payload, ["events", "matches", "fixtures"]).filter(isFootball);
  const rawPredictions = extractArray(predictionsResult.payload, ["predictions", "tips"]).filter(isFootball);
  const rawLeagues = extractArray(leaguesResult.payload, ["leagues", "competitions"]);

  const events = sortByStartTime(rawEvents.map(normalizeEvent));
  const predictions = sortByStartTime(rawPredictions.map(normalizePrediction));
  const leagues = rawLeagues.length
    ? rawLeagues.map(normalizeLeague).filter(item => item.name)
    : [...new Set(events.map(item => item.league).filter(Boolean))].map(name => ({ name }));

  writeJson("football-raw.json", {
    generatedAt: new Date().toISOString(),
    requests: {
      eventsUrl: eventsResult.url,
      predictionsUrl: predictionsResult.url,
      leaguesUrl: leaguesResult.url,
      eventsAuth: eventsResult.auth,
      predictionsAuth: predictionsResult.auth,
      leaguesAuth: leaguesResult.auth
    },
    errors,
    samples: {
      event: rawEvents[0] || null,
      prediction: rawPredictions[0] || null,
      league: rawLeagues[0] || null
    },
    payloadShapes: {
      eventsTopKeys: eventsResult.payload && typeof eventsResult.payload === "object" ? Object.keys(eventsResult.payload).slice(0, 20) : [],
      predictionsTopKeys: predictionsResult.payload && typeof predictionsResult.payload === "object" ? Object.keys(predictionsResult.payload).slice(0, 20) : [],
      leaguesTopKeys: leaguesResult.payload && typeof leaguesResult.payload === "object" ? Object.keys(leaguesResult.payload).slice(0, 20) : []
    }
  });

  if (!events.length && !predictions.length) {
    console.error("Detalii endpoint-uri BSD:", errors);
    throw new Error("Autentificarea BSD nu a trecut încă sau schema datelor rămâne diferită. Logul arată acum și metoda de autentificare încercată.");
  }

  writeJson("football-overview.json", buildOverview(events, predictions, leagues, errors));
  writeJson("football-events.json", { generatedAt: new Date().toISOString(), count: events.length, items: events });
  writeJson("football-predictions.json", { generatedAt: new Date().toISOString(), count: predictions.length, items: predictions });
  writeJson("football-leagues.json", { generatedAt: new Date().toISOString(), count: leagues.length, items: leagues });

  console.log(`OK: ${events.length} evenimente, ${predictions.length} predicții, ${leagues.length} ligi.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
