# PitchPulse Football Dashboard

Interactive football analytics dashboard built with Next.js and Recharts.

## Data sources

- [Kaggle - davidcariboo/player-scores](https://www.kaggle.com/datasets/davidcariboo/player-scores)
- [Kaggle - saurabhshahane/statsbomb-football-data](https://www.kaggle.com/datasets/saurabhshahane/statsbomb-football-data/data)
- [Kaggle Notebook - desalegngeb/english-premier-league-players-statistics](https://www.kaggle.com/code/desalegngeb/english-premier-league-players-statistics)
- [Opta Analyst EPL Stats](https://theanalyst.com/competition/premier-league/stats)

## Design and stat inspirations

- [FBref Premier League Stats](https://fbref.com/en/comps/9/Premier-League-Stats)
- [Soccer Power Index Tableau](https://public.tableau.com/app/profile/irvin.palacios/viz/SoccerPowerIndex/SoccerPowerIndex)
- [xGStat EPL compare page](https://www.xgstat.com/competitions/premier-league/2025-2026/players/compare?category=attacking)
- [WhoScored](https://www.whoscored.com/), [SofaScore](https://www.sofascore.com/), [Understat](https://understat.com/)

## What this dashboard includes

- Multi-competition season filters (global dataset)
- Clickable player and team drill-down panels
- Fixed-label top scorer/assister charts (improved visibility)
- Advanced contribution charts (G+A/90, distribution, impact scatter)
- EPL advanced section from StatsBomb events:
  - xG, npxG, xA, shots/90, key passes/90, progressive actions/90
  - goal minus xG over/under-performance
- xGStat-style attacking comparison charts:
  - chance creation leaders (shots vs xG)
  - clinical finishers (conversion% vs xG)
  - finishing vs xG (goals vs xG)
  - shot quality vs volume (xG vs shots)
- Opta Analyst EPL season integration (`2025/26`) merged into the EPL season selector
- SPI-style team power table with league filter
- Notebook integration panel from Kaggle EPL notebook outputs

## Data outputs

- `public/data/dashboard-data.json` (global dashboard dataset)
- `public/data/epl-advanced-data.json` (EPL advanced + SPI-style dataset)

## Scripts

- `npm run data:download`
  - Downloads all Kaggle sources
  - Copies player-scores CSVs to `data/raw`
  - Stores StatsBomb and notebook output cache pointers in `data/raw`
- `npm run data:prepare`
  - Builds `dashboard-data.json`
  - Builds `epl-advanced-data.json`
- `npm run data:build`
  - Runs download + prepare

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Build local data payloads:

```bash
npm run data:build
```

3. Start development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Optional data tuning

Global dashboard preprocessing supports:

```bash
COMPETITION_LIMIT=12 TOP_PLAYER_LIMIT=12 TABLE_LIMIT=60 npm run data:prepare
```

You can point global CSV processing to an existing directory:

```bash
KAGGLE_DATA_DIR=/absolute/path/to/player-scores/files npm run data:prepare
```

## Deploy on Vercel

1. Run `npm run data:build` locally so both JSON outputs are generated.
2. Commit and push the repo.
3. Import into Vercel.
4. Use default Next.js settings:
- Build command: `npm run build`
- Output: Next.js default

The app is precomputed at build time, so Vercel does not need live Kaggle download access.
