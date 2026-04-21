const state = {
  overview: null,
  events: [],
  predictions: [],
  leagues: [],
  filters: {
    search: "",
    league: ""
  }
};

const summaryCards = document.getElementById("summaryCards");
const leagueChips = document.getElementById("leagueChips");
const eventsTableBody = document.getElementById("eventsTableBody");
const predictionsTableBody = document.getElementById("predictionsTableBody");
const leagueSelect = document.getElementById("leagueSelect");
const searchInput = document.getElementById("searchInput");
const lastUpdated = document.getElementById("lastUpdated");
const eventsCount = document.getElementById("eventsCount");
const predictionsCount = document.getElementById("predictionsCount");
const refreshButton = document.getElementById("refreshButton");

const files = {
  overview: "./data/football-overview.json",
  events: "./data/football-events.json",
  predictions: "./data/football-predictions.json",
  leagues: "./data/football-leagues.json"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("ro-RO").format(Number(value));
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  const normalized = num > 1 ? num : num * 100;
  return `${normalized.toFixed(1)}%`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function makeBadge(text) {
  const lowered = String(text || "").toLowerCase();
  let cls = "warn";
  if (["yes", "true", "available", "full", "ok", "live"].some(token => lowered.includes(token))) cls = "good";
  if (["none", "no", "closed", "missing"].some(token => lowered.includes(token))) cls = "danger";
  return `<span class="badge ${cls}">${escapeHtml(text || "—")}</span>`;
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Nu am putut încărca ${path}`);
  return response.json();
}

function renderSummary() {
  const cards = state.overview?.cards || [];
  if (!cards.length) {
    summaryCards.innerHTML = `<article class="stat-card"><div class="label">Date indisponibile</div><div class="meta">Rulează workflow-ul GitHub pentru a genera fișierele JSON.</div></article>`;
    return;
  }

  summaryCards.innerHTML = cards.map(card => `
    <article class="stat-card">
      <div class="label">${escapeHtml(card.label)}</div>
      <div class="value">${escapeHtml(formatNumber(card.value))}</div>
      <div class="meta">${escapeHtml(card.meta || "")}</div>
    </article>
  `).join("");

  const generatedAt = state.overview?.generatedAt;
  lastUpdated.textContent = generatedAt ? `Ultima actualizare: ${formatDate(generatedAt)}` : "Ultima actualizare indisponibilă";
}

function renderLeagueOptions() {
  const allLeagues = new Set();

  state.leagues.forEach(item => {
    if (item?.name) allLeagues.add(item.name);
  });

  state.events.forEach(item => {
    if (item?.league) allLeagues.add(item.league);
  });

  state.predictions.forEach(item => {
    if (item?.league) allLeagues.add(item.league);
  });

  const current = state.filters.league;
  const options = ["<option value=''>Toate ligile</option>"]
    .concat([...allLeagues].sort((a, b) => a.localeCompare(b)).map(name => {
      const selected = current === name ? "selected" : "";
      return `<option value="${escapeHtml(name)}" ${selected}>${escapeHtml(name)}</option>`;
    }));

  leagueSelect.innerHTML = options.join("");
}

function renderLeagueChips() {
  const leagueMap = new Map();

  state.events.forEach(item => {
    const key = item.league || "Necunoscut";
    leagueMap.set(key, (leagueMap.get(key) || 0) + 1);
  });

  const chips = [...leagueMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (!chips.length) {
    leagueChips.innerHTML = `<span class="chip">Nicio ligă încărcată</span>`;
    return;
  }

  leagueChips.innerHTML = chips.map(([league, count]) => `
    <button class="chip" data-league="${escapeHtml(league)}">${escapeHtml(league)} · ${formatNumber(count)}</button>
  `).join("");

  leagueChips.querySelectorAll("[data-league]").forEach(button => {
    button.addEventListener("click", () => {
      state.filters.league = button.dataset.league || "";
      renderLeagueOptions();
      renderTables();
    });
  });
}

function matchFilters(item) {
  const search = state.filters.search.trim().toLowerCase();
  const league = state.filters.league.trim().toLowerCase();

  const haystack = [
    item.homeTeam,
    item.awayTeam,
    item.league,
    item.country,
    item.pick
  ].join(" ").toLowerCase();

  const matchesSearch = !search || haystack.includes(search);
  const matchesLeague = !league || String(item.league || "").toLowerCase() === league;

  return matchesSearch && matchesLeague;
}

function renderTables() {
  const filteredEvents = state.events.filter(matchFilters);
  const filteredPredictions = state.predictions.filter(matchFilters);

  eventsCount.textContent = formatNumber(filteredEvents.length);
  predictionsCount.textContent = formatNumber(filteredPredictions.length);

  eventsTableBody.innerHTML = filteredEvents.length
    ? filteredEvents.slice(0, 250).map(item => `
      <tr>
        <td>${escapeHtml(formatDate(item.startTime))}</td>
        <td><strong>${escapeHtml(item.homeTeam || "—")} - ${escapeHtml(item.awayTeam || "—")}</strong></td>
        <td>${escapeHtml(item.league || "—")}</td>
        <td>${makeBadge(item.status || "—")}</td>
        <td>${item.hasOdds ? makeBadge("Da") : makeBadge("Nu")}</td>
        <td>${escapeHtml(formatNumber(item.bookmakerCount || 0))}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6" class="empty-row">Nu există evenimente pentru filtrele curente.</td></tr>`;

  predictionsTableBody.innerHTML = filteredPredictions.length
    ? filteredPredictions.slice(0, 250).map(item => `
      <tr>
        <td>${escapeHtml(formatDate(item.startTime))}</td>
        <td><strong>${escapeHtml(item.homeTeam || "—")} - ${escapeHtml(item.awayTeam || "—")}</strong></td>
        <td>${escapeHtml(item.league || "—")}</td>
        <td>${escapeHtml(item.pick || "—")}</td>
        <td>${escapeHtml(formatPercent(item.probability))}</td>
        <td>${escapeHtml(item.confidence ? formatPercent(item.confidence) : "—")}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6" class="empty-row">Nu există predicții pentru filtrele curente.</td></tr>`;
}

async function boot() {
  try {
    const [overview, events, predictions, leagues] = await Promise.all([
      loadJson(files.overview),
      loadJson(files.events),
      loadJson(files.predictions),
      loadJson(files.leagues)
    ]);

    state.overview = overview;
    state.events = Array.isArray(events.items) ? events.items : [];
    state.predictions = Array.isArray(predictions.items) ? predictions.items : [];
    state.leagues = Array.isArray(leagues.items) ? leagues.items : [];

    renderSummary();
    renderLeagueOptions();
    renderLeagueChips();
    renderTables();
  } catch (error) {
    summaryCards.innerHTML = `<article class="stat-card"><div class="label">Eroare la încărcare</div><div class="meta">${escapeHtml(error.message)}</div></article>`;
    lastUpdated.textContent = "Datele nu au putut fi încărcate";
    leagueChips.innerHTML = `<span class="chip">Verifică workflow-ul și fișierele JSON</span>`;
    eventsTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">Date indisponibile</td></tr>`;
    predictionsTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">Date indisponibile</td></tr>`;
  }
}

searchInput.addEventListener("input", event => {
  state.filters.search = event.target.value || "";
  renderTables();
});

leagueSelect.addEventListener("change", event => {
  state.filters.league = event.target.value || "";
  renderTables();
});

refreshButton.addEventListener("click", () => window.location.reload());

boot();
