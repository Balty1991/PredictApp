# PredictApp

Dashboard GitHub Pages pentru **fotbal** bazat pe **BSD Sports Data**.

## Ce face acum
- extrage evenimentele de fotbal
- extrage predicțiile de fotbal
- detectează unde există cote / bookmakers
- generează fișiere JSON în `data/`
- afișează în pagină:
  - număr evenimente
  - număr evenimente cu cote
  - evenimente live
  - număr predicții
  - ligi detectate

## Fișiere principale
- `index.html` - interfața dashboard
- `app.js` - încărcare și randare date
- `styles.css` - stilizare mobile-first
- `scripts/fetch-bsd-data.mjs` - scriptul care citește API-ul BSD
- `.github/workflows/update-football-data.yml` - actualizare automată

## Configurare
1. În repo, adaugă secretul GitHub:
   - `Settings -> Secrets and variables -> Actions -> New repository secret`
   - nume: `BSD_API_KEY`
   - valoare: cheia ta BSD

2. Verifică endpoint-urile din workflow:
   - `BSD_EVENTS_ENDPOINT`
   - `BSD_PREDICTIONS_ENDPOINT`
   - `BSD_LEAGUES_ENDPOINT`

   Am pus variantele cele mai probabile:
   - `/api/events/`
   - `/api/predictions/`
   - `/api/leagues/`

   Dacă în documentația BSD denumirea exactă este puțin diferită, modifici doar aceste 3 valori.

3. Activează GitHub Pages:
   - `Settings -> Pages`
   - `Deploy from a branch`
   - branch: `main`
   - folder: `/ (root)`

4. Rulează manual workflow-ul:
   - `Actions -> Update BSD football data -> Run workflow`

## Observație importantă
Nu pune cheia direct în `app.js` sau în HTML. Pe GitHub Pages ar deveni publică. De aceea cheia este folosită doar în GitHub Actions, iar front-end-ul citește doar JSON-ul generat.
