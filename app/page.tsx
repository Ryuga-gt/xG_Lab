import { readFile } from "node:fs/promises";
import path from "node:path";

import FootballDashboard from "@/components/football-dashboard";
import type { DashboardDataset, EplAdvancedDataset } from "@/lib/dashboard-types";

async function loadDashboardData(): Promise<DashboardDataset | null> {
  const filePath = path.join(process.cwd(), "public", "data", "dashboard-data.json");

  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as DashboardDataset;
  } catch {
    return null;
  }
}

async function loadEplAdvancedData(): Promise<EplAdvancedDataset | null> {
  const filePath = path.join(process.cwd(), "public", "data", "epl-advanced-data.json");

  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as EplAdvancedDataset;
  } catch {
    return null;
  }
}

export default async function Home() {
  const [data, eplAdvancedData] = await Promise.all([loadDashboardData(), loadEplAdvancedData()]);

  if (!data || !eplAdvancedData) {
    return (
      <main className="dashboard-missing-data">
        <div>
          <p className="eyebrow">Football Dashboard Setup</p>
          <h1>Kaggle data payload not found</h1>
          <p>
            Build the data file first, then refresh this page.
          </p>
          <pre>{`npm install\nnpm run data:build`}</pre>
          <p>
            This pipeline downloads and processes:
            <a href="https://www.kaggle.com/datasets/davidcariboo/player-scores">
              davidcariboo/player-scores
            </a>
            ,{" "}
            <a href="https://www.kaggle.com/datasets/saurabhshahane/statsbomb-football-data/data">
              saurabhshahane/statsbomb-football-data
            </a>
            , and the EPL notebook output:
            <a href="https://www.kaggle.com/code/desalegngeb/english-premier-league-players-statistics">
              desalegngeb/english-premier-league-players-statistics
            </a>
          </p>
        </div>
      </main>
    );
  }

  return <FootballDashboard data={data} eplAdvancedData={eplAdvancedData} />;
}
