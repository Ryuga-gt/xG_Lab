"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type {
  ComboDashboard,
  DashboardDataset,
  EplAdvancedDataset,
  EplPlayerAdvancedRow,
  EplTeamAdvancedRow,
  LeaderboardPlayer,
  SpiLeagueRatingRow,
} from "@/lib/dashboard-types";

type DashboardProps = {
  data: DashboardDataset;
  eplAdvancedData: EplAdvancedDataset;
};

type BaseSortField = "performanceIndex" | "goals" | "assists" | "minutes";

type EplSortField =
  | "goalContributionPer90"
  | "xGPer90"
  | "xAPer90"
  | "shotsPer90"
  | "keyPassesPer90"
  | "goalMinusXG";

type TeamSummary = {
  club: string;
  players: number;
  appearances: number;
  goals: number;
  assists: number;
  minutes: number;
  yellowCards: number;
  redCards: number;
  goalContributionPer90: number;
  avgPerformanceIndex: number;
};

type Spotlight =
  | { type: "base-player"; player: LeaderboardPlayer }
  | { type: "base-team"; team: TeamSummary }
  | { type: "epl-player"; player: EplPlayerAdvancedRow }
  | { type: "epl-team"; team: EplTeamAdvancedRow };

const TEAM_COLORS: Record<string, string> = {
  "arsenal": "#EF0107",
  "aston villa": "#670E36",
  "afc bournemouth": "#DA291C",
  "brighton & hove albion": "#0057B8",
  "burnley": "#6C1D45",
  "chelsea": "#034694",
  "crystal palace": "#1B458F",
  "everton": "#003399",
  "leicester city": "#003090",
  "liverpool": "#C8102E",
  "manchester city": "#6CABDD",
  "manchester united": "#DA291C",
  "newcastle united": "#241F20",
  "norwich city": "#00A650",
  "southampton": "#D71920",
  "stoke city": "#E03A3E",
  "sunderland": "#EB172B",
  "swansea city": "#111111",
  "tottenham hotspur": "#132257",
  "watford": "#FBEE23",
  "west bromwich albion": "#122F67",
  "west ham united": "#7A263A",
  "wolverhampton wanderers": "#FDB913",
  "blackburn rovers": "#0B4EA2",
  "bolton wanderers": "#001489",
  "birmingham city": "#0071C5",
  "charlton athletic": "#D4002A",
  "fulham": "#111111",
  "leeds united": "#1D428A",
  "middlesbrough": "#D71920",
  "portsmouth": "#00539F",
  "southampton fc": "#D71920",
};

const FALLBACK_TEAM_PALETTE = [
  "#00A3FF",
  "#FF2C51",
  "#FFEA8A",
  "#4DEB9B",
  "#7AF4FF",
  "#A7B7FF",
  "#F98F6F",
  "#C35BFF",
];

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact" });
const currencyCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});
const DEFAULT_LIST_LIMIT = 15;

type TooltipSeriesRow = {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
};

type ScatterTooltipField = {
  key: string;
  label: string;
  kind?: "integer" | "decimal" | "percent";
  decimals?: number;
};

function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getTeamColor(teamName: string): string {
  const normalized = normalizeTeamName(teamName);
  const direct = TEAM_COLORS[normalized];
  if (direct) {
    return direct;
  }
  return FALLBACK_TEAM_PALETTE[hashString(normalized) % FALLBACK_TEAM_PALETTE.length];
}

function getContrastColor(hexColor: string): string {
  const sanitized = hexColor.replace("#", "");
  if (sanitized.length !== 6) {
    return "#F4FAFF";
  }

  const red = Number.parseInt(sanitized.slice(0, 2), 16);
  const green = Number.parseInt(sanitized.slice(2, 4), 16);
  const blue = Number.parseInt(sanitized.slice(4, 6), 16);

  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.6 ? "#00131E" : "#F5FCFF";
}

function makeComboKey(season: number, competitionId: string): string {
  return `${season}__${competitionId}`;
}

function shortName(name: string, maxLength = 26): string {
  if (name.length <= maxLength) {
    return name;
  }
  return `${name.slice(0, maxLength - 1)}…`;
}

function per90(total: number, minutes: number): number {
  if (minutes <= 0) {
    return 0;
  }
  return (total * 90) / minutes;
}

function sortLeaderboard(
  leaderboard: LeaderboardPlayer[],
  sortField: BaseSortField,
  direction: "asc" | "desc",
): LeaderboardPlayer[] {
  const sorted = [...leaderboard].sort((a, b) => {
    const base = b[sortField] - a[sortField];
    if (base !== 0) {
      return direction === "desc" ? base : -base;
    }
    return a.name.localeCompare(b.name);
  });

  return sorted;
}

function sortEplPlayers(
  rows: EplPlayerAdvancedRow[],
  sortField: EplSortField,
  direction: "asc" | "desc",
): EplPlayerAdvancedRow[] {
  const sorted = [...rows].sort((a, b) => {
    const base = b[sortField] - a[sortField];
    if (base !== 0) {
      return direction === "desc" ? base : -base;
    }
    return a.playerName.localeCompare(b.playerName);
  });

  return sorted;
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="metric-card animate-rise">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-hint">{hint}</p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="dashboard-panel animate-rise">
      <div className="panel-header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function TeamBadge({ teamName }: { teamName: string }) {
  const color = getTeamColor(teamName);
  const textColor = getContrastColor(color);

  return (
    <span
      className="team-badge"
      style={{
        background: color,
        color: textColor,
      }}
    >
      {teamName}
    </span>
  );
}

function formatTooltipNumber(
  value: unknown,
  kind: "integer" | "decimal" | "percent" = "decimal",
  decimals = 2,
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  if (kind === "integer") {
    return numberFormatter.format(Math.round(value));
  }
  if (kind === "percent") {
    return `${value.toFixed(decimals)}%`;
  }
  return value.toFixed(decimals);
}

function ScatterTooltipCard({
  active,
  payload,
  nameKey,
  teamKey,
  fields,
}: {
  active?: boolean;
  payload?: TooltipSeriesRow[];
  nameKey: string;
  teamKey?: string;
  fields: ScatterTooltipField[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  const title = String(point[nameKey] ?? "Player");
  const team = teamKey ? String(point[teamKey] ?? "") : "";

  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{title}</p>
      {team ? <p className="chart-tooltip-subtitle">{team}</p> : null}
      <div className="chart-tooltip-grid">
        {fields.map((field) => (
          <p key={field.key}>
            <span>{field.label}</span>
            <strong>{formatTooltipNumber(point[field.key], field.kind, field.decimals)}</strong>
          </p>
        ))}
      </div>
    </div>
  );
}

export default function FootballDashboard({ data, eplAdvancedData }: DashboardProps) {
  const combos = useMemo(() => Object.values(data.combos), [data.combos]);

  const latestSeason = data.filters.seasons[0] ?? combos[0]?.season ?? 0;

  const seasonCompetitionMap = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const combo of combos) {
      const set = map.get(combo.season) ?? new Set<string>();
      set.add(combo.competitionId);
      map.set(combo.season, set);
    }
    return map;
  }, [combos]);

  const [selectedSeason, setSelectedSeason] = useState<number>(latestSeason);
  const [competitionSelection, setCompetitionSelection] = useState<string>(() => {
    const initialCombo = combos.find((combo) => combo.season === latestSeason);
    return initialCombo?.competitionId ?? "";
  });

  const [search, setSearch] = useState<string>("");
  const [sortField, setSortField] = useState<BaseSortField>("performanceIndex");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);

  const eplDefaultSeason = eplAdvancedData.filters.eplSeasons[0]?.seasonId ?? 27;
  const [selectedEplSeason, setSelectedEplSeason] = useState<number>(eplDefaultSeason);
  const [eplMinMinutes, setEplMinMinutes] = useState<number>(540);
  const [eplSearch, setEplSearch] = useState<string>("");
  const [eplSortField, setEplSortField] = useState<EplSortField>("goalContributionPer90");
  const [eplSortDirection, setEplSortDirection] = useState<"asc" | "desc">("desc");

  const defaultSpiLeague = eplAdvancedData.filters.spiLeagues[0]?.leagueKey ?? "";
  const [selectedSpiLeague, setSelectedSpiLeague] = useState<string>(defaultSpiLeague);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const axisTick = { fill: "var(--axis-tick)", fontSize: 12, fontWeight: 600 } as const;
  const axisNameTick = { fill: "var(--axis-tick-strong)", fontSize: 12, fontWeight: 700 } as const;

  function isExpanded(sectionKey: string): boolean {
    return Boolean(expandedSections[sectionKey]);
  }

  function getVisibleRows<T>(rows: T[], sectionKey: string, limit = DEFAULT_LIST_LIMIT): T[] {
    if (rows.length <= limit || isExpanded(sectionKey)) {
      return rows;
    }
    return rows.slice(0, limit);
  }

  function toggleExpanded(sectionKey: string): void {
    setExpandedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  }

  function renderShowMore(sectionKey: string, totalRows: number, limit = DEFAULT_LIST_LIMIT) {
    if (totalRows <= limit) {
      return null;
    }
    return (
      <div className="show-more-wrap">
        <button
          type="button"
          className="show-more-button"
          onClick={() => toggleExpanded(sectionKey)}
        >
          {isExpanded(sectionKey) ? "Show less" : `Show more (${totalRows - limit} more)`}
        </button>
      </div>
    );
  }

  const availableCompetitions = useMemo(() => {
    const allowedCompetitionIds = seasonCompetitionMap.get(selectedSeason) ?? new Set<string>();
    return data.filters.competitions.filter((competition) => allowedCompetitionIds.has(competition.id));
  }, [data.filters.competitions, selectedSeason, seasonCompetitionMap]);

  const selectedCompetitionId = useMemo(() => {
    if (availableCompetitions.length === 0) {
      return "";
    }
    const isStillAvailable = availableCompetitions.some(
      (competition) => competition.id === competitionSelection,
    );
    return isStillAvailable ? competitionSelection : availableCompetitions[0].id;
  }, [availableCompetitions, competitionSelection]);

  const selectedCombo: ComboDashboard | undefined = useMemo(() => {
    if (!selectedCompetitionId) {
      return undefined;
    }
    return data.combos[makeComboKey(selectedSeason, selectedCompetitionId)];
  }, [data.combos, selectedCompetitionId, selectedSeason]);

  const filteredLeaderboard = useMemo(() => {
    if (!selectedCombo) {
      return [];
    }

    const lowered = search.trim().toLowerCase();
    const base = lowered
      ? selectedCombo.leaderboard.filter((row) => {
          return (
            row.name.toLowerCase().includes(lowered) ||
            row.club.toLowerCase().includes(lowered) ||
            row.country.toLowerCase().includes(lowered)
          );
        })
      : selectedCombo.leaderboard;

    return sortLeaderboard(base, sortField, sortDirection);
  }, [search, selectedCombo, sortDirection, sortField]);

  const mainTeamSummaries = useMemo(() => {
    if (!selectedCombo) {
      return [];
    }

    const map = new Map<string, TeamSummary>();
    for (const player of selectedCombo.leaderboard) {
      const existing = map.get(player.club) ?? {
        club: player.club,
        players: 0,
        appearances: 0,
        goals: 0,
        assists: 0,
        minutes: 0,
        yellowCards: 0,
        redCards: 0,
        goalContributionPer90: 0,
        avgPerformanceIndex: 0,
      };

      existing.players += 1;
      existing.appearances += player.appearances;
      existing.goals += player.goals;
      existing.assists += player.assists;
      existing.minutes += player.minutes;
      existing.yellowCards += player.yellowCards;
      existing.redCards += player.redCards;
      existing.avgPerformanceIndex += player.performanceIndex;
      map.set(player.club, existing);
    }

    return Array.from(map.values())
      .map((team) => {
        const teamsize = team.players || 1;
        return {
          ...team,
          goalContributionPer90: Number(
            per90(team.goals + team.assists, Math.max(team.minutes, 1)).toFixed(3),
          ),
          avgPerformanceIndex: Number((team.avgPerformanceIndex / teamsize).toFixed(2)),
        };
      })
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.club.localeCompare(b.club));
  }, [selectedCombo]);

  const contributionLeaders = useMemo(() => {
    if (!selectedCombo) {
      return [];
    }

    return selectedCombo.leaderboard
      .filter((player) => player.minutes >= 450)
      .map((player) => ({
        ...player,
        goalContributionPer90: per90(player.goals + player.assists, player.minutes),
      }))
      .sort((a, b) => b.goalContributionPer90 - a.goalContributionPer90);
  }, [selectedCombo]);

  const contributionHistogram = useMemo(() => {
    if (!selectedCombo) {
      return [];
    }

    const buckets = [
      { label: "0.00-0.20", min: 0.0, max: 0.2 },
      { label: "0.20-0.40", min: 0.2, max: 0.4 },
      { label: "0.40-0.60", min: 0.4, max: 0.6 },
      { label: "0.60-0.80", min: 0.6, max: 0.8 },
      { label: "0.80-1.10", min: 0.8, max: 1.1 },
      { label: "1.10+", min: 1.1, max: Number.POSITIVE_INFINITY },
    ];

    const result = buckets.map((bucket) => ({ bucket: bucket.label, count: 0 }));

    for (const player of selectedCombo.leaderboard) {
      if (player.minutes < 450) {
        continue;
      }
      const value = per90(player.goals + player.assists, player.minutes);
      const bucketIndex = buckets.findIndex((bucket) => value >= bucket.min && value < bucket.max);
      if (bucketIndex >= 0) {
        result[bucketIndex].count += 1;
      }
    }

    return result;
  }, [selectedCombo]);

  const mainScatter = useMemo(() => {
    if (!selectedCombo) {
      return [];
    }

    return selectedCombo.leaderboard
      .filter((player) => player.minutes >= 360)
      .map((player) => ({
        playerId: player.playerId,
        name: player.name,
        club: player.club,
        goalsPer90: per90(player.goals, player.minutes),
        assistsPer90: per90(player.assists, player.minutes),
        minutes: player.minutes,
      }))
      .sort((a, b) => b.goalsPer90 + b.assistsPer90 - (a.goalsPer90 + a.assistsPer90))
      .slice(0, 120);
  }, [selectedCombo]);

  const selectedComboTeamRows = mainTeamSummaries;

  const competitionTrendForSeason = useMemo(() => {
    return combos
      .filter((combo) => combo.season === selectedSeason)
      .map((combo) => ({
        competitionId: combo.competitionId,
        competitionName: combo.competitionName,
        appearances: combo.totals.appearances,
        goals: combo.totals.goals,
        assists: combo.totals.assists,
        minutes: combo.totals.minutes,
        goalRate: combo.totals.avgGoalsPerAppearance,
      }))
      .sort((a, b) => b.appearances - a.appearances || b.goalRate - a.goalRate);
  }, [combos, selectedSeason]);

  const eplPlayersForSeason = useMemo(() => {
    const lowered = eplSearch.trim().toLowerCase();

    const filtered = eplAdvancedData.epl.playerRows.filter((row) => {
      if (row.seasonId !== selectedEplSeason) {
        return false;
      }
      if (row.minutes < eplMinMinutes) {
        return false;
      }
      if (!lowered) {
        return true;
      }
      return (
        row.playerName.toLowerCase().includes(lowered) ||
        row.teamName.toLowerCase().includes(lowered) ||
        row.country.toLowerCase().includes(lowered)
      );
    });

    return sortEplPlayers(filtered, eplSortField, eplSortDirection);
  }, [eplAdvancedData.epl.playerRows, eplMinMinutes, eplSearch, eplSortDirection, eplSortField, selectedEplSeason]);

  const eplTeamsForSeason = useMemo(() => {
    return eplAdvancedData.epl.teamRows
      .filter((row) => row.seasonId === selectedEplSeason)
      .sort((a, b) => b.spiRating - a.spiRating || b.points - a.points || a.teamName.localeCompare(b.teamName));
  }, [eplAdvancedData.epl.teamRows, selectedEplSeason]);

  const eplTopXG = useMemo(() => {
    return eplPlayersForSeason.slice().sort((a, b) => b.xG - a.xG);
  }, [eplPlayersForSeason]);

  const eplTopXA = useMemo(() => {
    return eplPlayersForSeason.slice().sort((a, b) => b.xA - a.xA);
  }, [eplPlayersForSeason]);

  const eplCompareScatter = useMemo(() => {
    return eplPlayersForSeason
      .slice()
      .sort((a, b) => b.goalContributionPer90 - a.goalContributionPer90)
      .slice(0, 120);
  }, [eplPlayersForSeason]);

  const eplOverUnder = useMemo(() => {
    return eplPlayersForSeason
      .slice()
      .sort((a, b) => Math.abs(b.goalMinusXG) - Math.abs(a.goalMinusXG))
      .slice(0, 120);
  }, [eplPlayersForSeason]);

  const eplAttackingRows = useMemo(() => {
    return eplPlayersForSeason
      .filter((row) => row.shots >= 5)
      .map((row) => ({
        playerId: row.playerId,
        playerName: row.playerName,
        teamName: row.teamName,
        minutes: row.minutes,
        goals: row.goals,
        assists: row.assists,
        shots: row.shots,
        shotsPer90: row.shotsPer90,
        xG: row.xG,
        xGPer90: row.xGPer90,
        xA: row.xA,
        goalContributionPer90: row.goalContributionPer90,
        goalConversionPct: row.shots > 0 ? (row.goals / row.shots) * 100 : 0,
        xGPerShot: row.shots > 0 ? row.xG / row.shots : 0,
      }))
      .sort((a, b) => b.xG - a.xG);
  }, [eplPlayersForSeason]);

  const eplAttackingAverages = useMemo(() => {
    if (eplAttackingRows.length === 0) {
      return {
        xG: 0,
        shots: 0,
        goals: 0,
        goalConversionPct: 0,
      };
    }

    const totals = eplAttackingRows.reduce(
      (accumulator, row) => {
        accumulator.xG += row.xG;
        accumulator.shots += row.shots;
        accumulator.goals += row.goals;
        accumulator.goalConversionPct += row.goalConversionPct;
        return accumulator;
      },
      {
        xG: 0,
        shots: 0,
        goals: 0,
        goalConversionPct: 0,
      },
    );

    return {
      xG: totals.xG / eplAttackingRows.length,
      shots: totals.shots / eplAttackingRows.length,
      goals: totals.goals / eplAttackingRows.length,
      goalConversionPct: totals.goalConversionPct / eplAttackingRows.length,
    };
  }, [eplAttackingRows]);

  const eplTeamScatterRows = useMemo(() => {
    return eplTeamsForSeason.map((row) => ({
      ...row,
      xGPerMatch: row.xGPerMatch,
      xGAPerMatch: row.xGAPerMatch,
    }));
  }, [eplTeamsForSeason]);

  const spiRows = useMemo(() => {
    const filtered = eplAdvancedData.spiByLeague.filter((row) => row.leagueKey === selectedSpiLeague);
    return filtered.slice().sort((a, b) => b.spiRating - a.spiRating || b.goalDifference - a.goalDifference);
  }, [eplAdvancedData.spiByLeague, selectedSpiLeague]);

  const selectedSpiLeagueMeta = useMemo(() => {
    return eplAdvancedData.filters.spiLeagues.find((row) => row.leagueKey === selectedSpiLeague);
  }, [eplAdvancedData.filters.spiLeagues, selectedSpiLeague]);

  if (!selectedCombo) {
    return (
      <div className="dashboard-empty-state">
        <h1>No dashboard data found for the selected filter.</h1>
        <p>Regenerate data with `npm run data:build` and reload the app.</p>
      </div>
    );
  }

  const topScorerRows = getVisibleRows(selectedCombo.topScorers, "topScorers");
  const topAssisterRows = getVisibleRows(selectedCombo.topAssisters, "topAssisters");
  const contributionLeaderRows = getVisibleRows(contributionLeaders, "contributionLeaders");
  const teamDisciplineRows = getVisibleRows(selectedCombo.cardsByClub, "teamDiscipline");
  const competitionGoalRows = getVisibleRows(competitionTrendForSeason, "competitionGoalRates");
  const leaderboardRows = getVisibleRows(filteredLeaderboard, "baseLeaderboard");
  const teamOverviewRows = getVisibleRows(selectedComboTeamRows, "baseTeamOverview");
  const eplTopXGRows = getVisibleRows(eplTopXG, "eplTopXG");
  const eplTopXARows = getVisibleRows(eplTopXA, "eplTopXA");
  const eplOverUnderRows = getVisibleRows(eplOverUnder, "eplOverUnder");
  const eplTeamTableRows = getVisibleRows(eplTeamsForSeason, "eplTeamTable");
  const eplPlayerTableRows = getVisibleRows(eplPlayersForSeason, "eplPlayerTable");
  const spiRankingRows = getVisibleRows(spiRows, "spiRanking");
  const spiTableRows = getVisibleRows(spiRows, "spiTable");
  const notebookRows = getVisibleRows(eplAdvancedData.notebookInsights, "notebookInsights");

  return (
    <main className="football-dashboard">
      <div className="dashboard-shell">
        <header className="dashboard-hero animate-rise">
          <div>
            <p className="eyebrow">Cyber Football Intelligence</p>
            <h1>PitchPulse Dashboard</h1>
            <p className="hero-copy">
              Interactive football analytics inspired by FBref, xGStat, and Opta Analyst, combining
              Kaggle player-scores, StatsBomb event data, and Opta-style attacking outputs.
            </p>
          </div>
          <div className="meta-box">
            <p>
              Generated: <strong>{new Date(data.meta.generatedAt).toLocaleString()}</strong>
            </p>
            <p>
              Competitions included: <strong>{data.meta.competitionsIncluded}</strong>
            </p>
            <p>
              EPL advanced players: <strong>{compactFormatter.format(eplAdvancedData.meta.rows.eplPlayers)}</strong>
            </p>
            <p>
              Analyst rows: <strong>{compactFormatter.format(eplAdvancedData.meta.rows.analystPlayers)}</strong>
            </p>
          </div>
        </header>

        <section className="control-strip animate-rise">
          <label>
            Season
            <select
              value={selectedSeason}
              onChange={(event) => setSelectedSeason(Number(event.target.value))}
            >
              {data.filters.seasons.map((season) => (
                <option key={season} value={season}>
                  {season}
                </option>
              ))}
            </select>
          </label>

          <label>
            Competition
            <select
              value={selectedCompetitionId}
              onChange={(event) => setCompetitionSelection(event.target.value)}
            >
              {availableCompetitions.map((competition) => (
                <option key={competition.id} value={competition.id}>
                  {competition.name} ({competition.id})
                </option>
              ))}
            </select>
          </label>

          <div className="selection-summary">
            <p>
              <strong>{selectedCombo.competitionName}</strong> | {selectedCombo.competitionCountry}
            </p>
            <p>{selectedCombo.competitionType.replaceAll("_", " ")}</p>
          </div>
        </section>

        <section className="metrics-grid">
          <MetricCard
            label="Appearances"
            value={numberFormatter.format(selectedCombo.totals.appearances)}
            hint="Player match entries"
          />
          <MetricCard
            label="Goals"
            value={numberFormatter.format(selectedCombo.totals.goals)}
            hint={`Avg ${selectedCombo.totals.avgGoalsPerAppearance.toFixed(2)} per appearance`}
          />
          <MetricCard
            label="Assists"
            value={numberFormatter.format(selectedCombo.totals.assists)}
            hint="Direct goal contributions"
          />
          <MetricCard
            label="Unique Players"
            value={numberFormatter.format(selectedCombo.totals.uniquePlayers)}
            hint={`Avg ${selectedCombo.totals.avgMinutesPerAppearance.toFixed(0)} minutes per appearance`}
          />
        </section>

        <section className="panel-grid panel-grid-two">
          <Panel
            title="Top Scorers"
            subtitle="X-axis: Goals | Y-axis: Player name. Click bars for individual player view."
          >
            <ResponsiveContainer width="100%" height={330}>
              <BarChart
                data={topScorerRows}
                layout="vertical"
                margin={{ top: 8, right: 20, left: 28, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  label={{ value: "Goals (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={215}
                  tick={axisNameTick}
                  interval={0}
                  tickLine={false}
                  tickFormatter={(value) => shortName(value, 28)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--tooltip-border)",
                    borderRadius: 12,
                    color: "var(--tooltip-text)",
                  }}
                  labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--tooltip-text)" }}
                  formatter={(value) => numberFormatter.format(Number(value))}
                />
                <Bar
                  dataKey="goals"
                  radius={[0, 7, 7, 0]}
                  fill="var(--chart-primary)"
                  onClick={(_, index) => {
                    const player = topScorerRows[index];
                    if (player) {
                      setSpotlight({ type: "base-player", player });
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
            {renderShowMore("topScorers", selectedCombo.topScorers.length)}
          </Panel>

          <Panel
            title="Top Assisters"
            subtitle="X-axis: Assists | Y-axis: Player name. Click bars for individual player view."
          >
            <ResponsiveContainer width="100%" height={330}>
              <BarChart
                data={topAssisterRows}
                layout="vertical"
                margin={{ top: 8, right: 20, left: 28, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  label={{ value: "Assists (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={215}
                  tick={axisNameTick}
                  interval={0}
                  tickLine={false}
                  tickFormatter={(value) => shortName(value, 28)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--tooltip-border)",
                    borderRadius: 12,
                    color: "var(--tooltip-text)",
                  }}
                  labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--tooltip-text)" }}
                  formatter={(value) => numberFormatter.format(Number(value))}
                />
                <Bar
                  dataKey="assists"
                  radius={[0, 7, 7, 0]}
                  fill="var(--chart-secondary)"
                  onClick={(_, index) => {
                    const player = topAssisterRows[index];
                    if (player) {
                      setSpotlight({ type: "base-player", player });
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
            {renderShowMore("topAssisters", selectedCombo.topAssisters.length)}
          </Panel>
        </section>

        <section className="panel-grid panel-grid-three">
          <Panel
            title="Goal Contribution / 90"
            subtitle="X-axis: Goal contribution per 90 | Y-axis: Player name (min 450 minutes)"
          >
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={contributionLeaderRows} layout="vertical" margin={{ left: 25, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  label={{
                    value: "Goal Contribution / 90 (X-axis)",
                    position: "insideBottom",
                    offset: -2,
                    fill: "var(--axis-label)",
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={165}
                  tick={axisNameTick}
                  interval={0}
                  tickLine={false}
                  tickFormatter={(value) => shortName(value, 20)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--tooltip-border)",
                    borderRadius: 12,
                    color: "var(--tooltip-text)",
                  }}
                  labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--tooltip-text)" }}
                  formatter={(value) => Number(value).toFixed(3)}
                />
                <Bar dataKey="goalContributionPer90" fill="var(--chart-tertiary)" radius={[0, 7, 7, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {renderShowMore("contributionLeaders", contributionLeaders.length)}
          </Panel>

          <Panel
            title="Contribution Distribution"
            subtitle="X-axis: G+A per 90 bucket | Y-axis: Number of players"
          >
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={contributionHistogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  dataKey="bucket"
                  tick={axisTick}
                  label={{ value: "G+A per 90 (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  tick={axisTick}
                  label={{
                    value: "Player Count (Y-axis)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--axis-label)",
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--tooltip-border)",
                    borderRadius: 12,
                    color: "var(--tooltip-text)",
                  }}
                  labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--tooltip-text)" }}
                  formatter={(value) => numberFormatter.format(Number(value))}
                />
                <Bar dataKey="count" fill="var(--chart-quaternary)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel
            title="Goals/90 vs Assists/90"
            subtitle="X-axis: Goals per 90 | Y-axis: Assists per 90 | Hover includes player name"
          >
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 20, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  dataKey="goalsPer90"
                  name="Goals/90"
                  tick={axisTick}
                  label={{ value: "Goals / 90 (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="number"
                  dataKey="assistsPer90"
                  name="Assists/90"
                  tick={axisTick}
                  label={{
                    value: "Assists / 90 (Y-axis)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--axis-label)",
                  }}
                />
                <ZAxis type="number" dataKey="minutes" range={[70, 360]} name="Minutes" />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={(
                    <ScatterTooltipCard
                      nameKey="name"
                      teamKey="club"
                      fields={[
                        { key: "minutes", label: "Minutes", kind: "integer" },
                        { key: "goalsPer90", label: "Goals/90", kind: "decimal", decimals: 3 },
                        { key: "assistsPer90", label: "Assists/90", kind: "decimal", decimals: 3 },
                      ]}
                    />
                  )}
                />
                <Scatter data={mainScatter} fill="var(--chart-primary)" />
              </ScatterChart>
            </ResponsiveContainer>
          </Panel>
        </section>

        <section className="panel-grid panel-grid-two">
          <Panel
            title="Chance Creation Leaders"
            subtitle="X-axis: xG | Y-axis: Shots | Hover includes player name, team, and attacking stats"
          >
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 18, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  dataKey="xG"
                  tick={axisTick}
                  label={{ value: "xG (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="number"
                  dataKey="shots"
                  tick={axisTick}
                  label={{
                    value: "Shots (Y-axis)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--axis-label)",
                  }}
                />
                <ReferenceLine x={eplAttackingAverages.xG} stroke="var(--chart-reference)" strokeDasharray="4 4" />
                <ReferenceLine y={eplAttackingAverages.shots} stroke="var(--chart-reference)" strokeDasharray="4 4" />
                <Tooltip
                  content={(
                    <ScatterTooltipCard
                      nameKey="playerName"
                      teamKey="teamName"
                      fields={[
                        { key: "minutes", label: "Minutes", kind: "integer" },
                        { key: "xG", label: "xG", kind: "decimal", decimals: 2 },
                        { key: "shots", label: "Shots", kind: "integer" },
                        { key: "goalConversionPct", label: "Goal Conv %", kind: "percent", decimals: 1 },
                      ]}
                    />
                  )}
                />
                <Scatter data={eplAttackingRows} fill="var(--chart-primary)" />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="filter-note">
              Filters applied: minutes ≥ {eplMinMinutes}, shots ≥ 5, season ={" "}
              {eplAdvancedData.filters.eplSeasons.find((season) => season.seasonId === selectedEplSeason)?.seasonName}
            </p>
          </Panel>

          <Panel
            title="Team Discipline"
            subtitle="X-axis: Card count | Y-axis: Team name. Click stacks for team detail."
          >
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={teamDisciplineRows} layout="vertical" margin={{ left: 24, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  label={{ value: "Cards (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="category"
                  dataKey="club"
                  width={205}
                  tick={axisNameTick}
                  interval={0}
                  tickLine={false}
                  tickFormatter={(value) => shortName(value, 28)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--tooltip-border)",
                    borderRadius: 12,
                    color: "var(--tooltip-text)",
                  }}
                  labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--tooltip-text)" }}
                  formatter={(value) => numberFormatter.format(Number(value))}
                />
                <Bar
                  dataKey="yellowCards"
                  stackId="cards"
                  fill="var(--chart-secondary)"
                  onClick={(payload) => {
                    if (!payload || typeof payload !== "object") {
                      return;
                    }
                    const clubName = String((payload as { club?: string }).club ?? "");
                    const team = mainTeamSummaries.find((row) => row.club === clubName);
                    if (team) {
                      setSpotlight({ type: "base-team", team });
                    }
                  }}
                />
                <Bar
                  dataKey="redCards"
                  stackId="cards"
                  fill="var(--chart-tertiary)"
                  onClick={(payload) => {
                    if (!payload || typeof payload !== "object") {
                      return;
                    }
                    const clubName = String((payload as { club?: string }).club ?? "");
                    const team = mainTeamSummaries.find((row) => row.club === clubName);
                    if (team) {
                      setSpotlight({ type: "base-team", team });
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
            {renderShowMore("teamDiscipline", selectedCombo.cardsByClub.length)}
          </Panel>
        </section>

        <section className="panel-grid panel-grid-two">
          <Panel
            title="Competition Goal Rates"
            subtitle="X-axis: Goals per appearance | Y-axis: Competition (selected season only)"
          >
            <ResponsiveContainer width="100%" height={310}>
              <BarChart data={competitionGoalRows} layout="vertical" margin={{ left: 26, right: 14 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  label={{
                    value: "Goals / Appearance (X-axis)",
                    position: "insideBottom",
                    offset: -2,
                    fill: "var(--axis-label)",
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="competitionName"
                  width={190}
                  tick={axisNameTick}
                  interval={0}
                  tickLine={false}
                  tickFormatter={(value) => shortName(value, 25)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--tooltip-border)",
                    borderRadius: 12,
                    color: "var(--tooltip-text)",
                  }}
                  labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--tooltip-text)" }}
                  formatter={(value, name) => {
                    if (name === "goalRate") {
                      return [Number(value).toFixed(3), "Goal rate"];
                    }
                    return [numberFormatter.format(Number(value)), name];
                  }}
                />
                <Bar dataKey="goalRate" fill="var(--chart-quaternary)" radius={[0, 7, 7, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {renderShowMore("competitionGoalRates", competitionTrendForSeason.length)}
          </Panel>

          <Panel
            title="Clinical Finishers"
            subtitle="X-axis: xG | Y-axis: Goal conversion %. Hover shows player + finishing stats."
          >
            <ResponsiveContainer width="100%" height={310}>
              <ScatterChart margin={{ top: 18, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  dataKey="xG"
                  tick={axisTick}
                  label={{ value: "xG (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="number"
                  dataKey="goalConversionPct"
                  tick={axisTick}
                  label={{
                    value: "Goal Conversion % (Y-axis)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--axis-label)",
                  }}
                />
                <ReferenceLine x={eplAttackingAverages.xG} stroke="var(--chart-reference)" strokeDasharray="4 4" />
                <ReferenceLine
                  y={eplAttackingAverages.goalConversionPct}
                  stroke="var(--chart-reference)"
                  strokeDasharray="4 4"
                />
                <Tooltip
                  content={(
                    <ScatterTooltipCard
                      nameKey="playerName"
                      teamKey="teamName"
                      fields={[
                        { key: "minutes", label: "Minutes", kind: "integer" },
                        { key: "xG", label: "xG", kind: "decimal", decimals: 2 },
                        { key: "goalConversionPct", label: "Goal Conv %", kind: "percent", decimals: 1 },
                        { key: "goals", label: "Goals", kind: "integer" },
                      ]}
                    />
                  )}
                />
                <Scatter data={eplAttackingRows} fill="var(--chart-tertiary)" />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="filter-note">
              Filters applied: minutes ≥ {eplMinMinutes}, shots ≥ 5, season ={" "}
              {eplAdvancedData.filters.eplSeasons.find((season) => season.seasonId === selectedEplSeason)?.seasonName}
            </p>
          </Panel>
        </section>

        <section className="panel-grid panel-grid-two">
          <Panel
            title="Finishing vs xG"
            subtitle="X-axis: xG | Y-axis: Goals | Hover shows player, xG, goals, and delta"
          >
            <ResponsiveContainer width="100%" height={310}>
              <ScatterChart margin={{ top: 18, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  dataKey="xG"
                  tick={axisTick}
                  label={{ value: "xG (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="number"
                  dataKey="goals"
                  tick={axisTick}
                  label={{
                    value: "Goals (Y-axis)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--axis-label)",
                  }}
                />
                <ReferenceLine x={eplAttackingAverages.xG} stroke="var(--chart-reference)" strokeDasharray="4 4" />
                <ReferenceLine y={eplAttackingAverages.goals} stroke="var(--chart-reference)" strokeDasharray="4 4" />
                <Tooltip
                  content={(
                    <ScatterTooltipCard
                      nameKey="playerName"
                      teamKey="teamName"
                      fields={[
                        { key: "minutes", label: "Minutes", kind: "integer" },
                        { key: "xG", label: "xG", kind: "decimal", decimals: 2 },
                        { key: "goals", label: "Goals", kind: "integer" },
                        { key: "goalConversionPct", label: "Goal Conv %", kind: "percent", decimals: 1 },
                      ]}
                    />
                  )}
                />
                <Scatter data={eplAttackingRows} fill="var(--chart-primary)" />
              </ScatterChart>
            </ResponsiveContainer>
          </Panel>

          <Panel
            title="Shot Quality vs Volume"
            subtitle="X-axis: Shots | Y-axis: xG | Hover shows player, xG per shot, and finishing context"
          >
            <ResponsiveContainer width="100%" height={310}>
              <ScatterChart margin={{ top: 18, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  dataKey="shots"
                  tick={axisTick}
                  label={{ value: "Shots (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="number"
                  dataKey="xG"
                  tick={axisTick}
                  label={{
                    value: "xG (Y-axis)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--axis-label)",
                  }}
                />
                <ReferenceLine x={eplAttackingAverages.shots} stroke="var(--chart-reference)" strokeDasharray="4 4" />
                <ReferenceLine y={eplAttackingAverages.xG} stroke="var(--chart-reference)" strokeDasharray="4 4" />
                <Tooltip
                  content={(
                    <ScatterTooltipCard
                      nameKey="playerName"
                      teamKey="teamName"
                      fields={[
                        { key: "minutes", label: "Minutes", kind: "integer" },
                        { key: "shots", label: "Shots", kind: "integer" },
                        { key: "xG", label: "xG", kind: "decimal", decimals: 2 },
                        { key: "xGPerShot", label: "xG per shot", kind: "decimal", decimals: 3 },
                      ]}
                    />
                  )}
                />
                <Scatter data={eplAttackingRows} fill="var(--chart-secondary)" />
              </ScatterChart>
            </ResponsiveContainer>
          </Panel>
        </section>

        <section className="dashboard-panel animate-rise">
          <div className="panel-header">
            <h3>Player Leaderboard (Current Selection)</h3>
            <p>Click player or team names to open individual/team detail views.</p>
          </div>

          <div className="leaderboard-toolbar">
            <input
              type="text"
              placeholder="Search by player, club, or country"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <select
              value={sortField}
              onChange={(event) => setSortField(event.target.value as BaseSortField)}
            >
              <option value="performanceIndex">Sort: Performance Index</option>
              <option value="goals">Sort: Goals</option>
              <option value="assists">Sort: Assists</option>
              <option value="minutes">Sort: Minutes</option>
            </select>

            <button
              type="button"
              onClick={() =>
                setSortDirection((current) => (current === "desc" ? "asc" : "desc"))
              }
            >
              Direction: {sortDirection.toUpperCase()}
            </button>
          </div>

          <div className="leaderboard-table-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Club</th>
                  <th>Apps</th>
                  <th>Goals</th>
                  <th>Assists</th>
                  <th>G+A/90</th>
                  <th>Minutes</th>
                  <th>Cards</th>
                  <th>Value</th>
                  <th>Index</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.map((player) => {
                  const gaPer90 = per90(player.goals + player.assists, player.minutes);
                  return (
                    <tr key={`${player.playerId}-${player.name}`}>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setSpotlight({ type: "base-player", player })}
                        >
                          <strong>{player.name}</strong>
                        </button>
                        <span>{player.country}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            const team = mainTeamSummaries.find((item) => item.club === player.club);
                            if (team) {
                              setSpotlight({ type: "base-team", team });
                            }
                          }}
                        >
                          {player.club}
                        </button>
                      </td>
                      <td>{numberFormatter.format(player.appearances)}</td>
                      <td>{numberFormatter.format(player.goals)}</td>
                      <td>{numberFormatter.format(player.assists)}</td>
                      <td>{gaPer90.toFixed(3)}</td>
                      <td>{numberFormatter.format(player.minutes)}</td>
                      <td>
                        {player.yellowCards}/{player.redCards}
                      </td>
                      <td>{player.marketValue > 0 ? currencyCompactFormatter.format(player.marketValue) : "-"}</td>
                      <td>{player.performanceIndex.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {renderShowMore("baseLeaderboard", filteredLeaderboard.length)}
        </section>

        <section className="dashboard-panel animate-rise">
          <div className="panel-header">
            <h3>Team Overview (Current Selection)</h3>
            <p>Aggregated team outputs from the filtered competition + season.</p>
          </div>

          <div className="leaderboard-table-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Players</th>
                  <th>Apps</th>
                  <th>Goals</th>
                  <th>Assists</th>
                  <th>G+A/90</th>
                  <th>Cards</th>
                  <th>Avg Index</th>
                </tr>
              </thead>
              <tbody>
                {teamOverviewRows.map((team) => (
                  <tr key={team.club}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setSpotlight({ type: "base-team", team })}
                      >
                        {team.club}
                      </button>
                    </td>
                    <td>{numberFormatter.format(team.players)}</td>
                    <td>{numberFormatter.format(team.appearances)}</td>
                    <td>{numberFormatter.format(team.goals)}</td>
                    <td>{numberFormatter.format(team.assists)}</td>
                    <td>{team.goalContributionPer90.toFixed(3)}</td>
                    <td>
                      {team.yellowCards}/{team.redCards}
                    </td>
                    <td>{team.avgPerformanceIndex.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {renderShowMore("baseTeamOverview", selectedComboTeamRows.length)}
        </section>

        <section className="dashboard-hero subsection-header animate-rise">
          <div>
            <p className="eyebrow">EPL Advanced Section</p>
            <h2>EPL Advanced Attack, Creation, and Team Profiles</h2>
            <p className="hero-copy">
              EPL-focused metrics inspired by xGStat and Opta Analyst, mixing StatsBomb + Opta-style
              attacking splits: xG, xA, shots, conversion, chance creation, and finishing delta.
            </p>
          </div>
          <div className="meta-box">
            <p>
              EPL seasons: <strong>{eplAdvancedData.filters.eplSeasons.length}</strong>
            </p>
            <p>
              Notebook figures parsed: <strong>{eplAdvancedData.notebookInsights.length}</strong>
            </p>
            <p>
              StatsBomb matches: <strong>{eplAdvancedData.meta.rows.eplMatches}</strong>
            </p>
            <p>
              Analyst season rows: <strong>{eplAdvancedData.meta.rows.analystPlayers}</strong>
            </p>
          </div>
        </section>

        <section className="control-strip animate-rise">
          <label>
            EPL Season
            <select
              value={selectedEplSeason}
              onChange={(event) => setSelectedEplSeason(Number(event.target.value))}
            >
              {eplAdvancedData.filters.eplSeasons.map((season) => (
                <option key={season.seasonId} value={season.seasonId}>
                  {season.seasonName}
                </option>
              ))}
            </select>
          </label>

          <label>
            Min Minutes
            <select
              value={eplMinMinutes}
              onChange={(event) => setEplMinMinutes(Number(event.target.value))}
            >
              <option value={180}>180</option>
              <option value={360}>360</option>
              <option value={540}>540</option>
              <option value={720}>720</option>
              <option value={900}>900</option>
            </select>
          </label>

          <label>
            Search EPL Players
            <input
              type="text"
              value={eplSearch}
              placeholder="Player, team, country"
              onChange={(event) => setEplSearch(event.target.value)}
            />
          </label>
        </section>

        <section className="panel-grid panel-grid-two">
          <Panel
            title="EPL Top xG"
            subtitle="X-axis: xG | Y-axis: Player name. Colors follow team palette."
          >
            <ResponsiveContainer width="100%" height={330}>
              <BarChart data={eplTopXGRows} layout="vertical" margin={{ left: 26, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  label={{ value: "xG (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="category"
                  dataKey="playerName"
                  width={185}
                  tick={axisNameTick}
                  interval={0}
                  tickLine={false}
                  tickFormatter={(value) => shortName(value, 23)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--tooltip-border)",
                    borderRadius: 12,
                    color: "var(--tooltip-text)",
                  }}
                  labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--tooltip-text)" }}
                  formatter={(value) => Number(value).toFixed(3)}
                />
                <Bar
                  dataKey="xG"
                  radius={[0, 7, 7, 0]}
                  onClick={(_, index) => {
                    const player = eplTopXGRows[index];
                    if (player) {
                      setSpotlight({ type: "epl-player", player });
                    }
                  }}
                >
                  {eplTopXGRows.map((row) => (
                    <Cell key={`${row.playerId}-xg`} fill={getTeamColor(row.teamName)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {renderShowMore("eplTopXG", eplTopXG.length)}
          </Panel>

          <Panel
            title="EPL Top xA"
            subtitle="X-axis: xA | Y-axis: Player name. Colors follow team palette."
          >
            <ResponsiveContainer width="100%" height={330}>
              <BarChart data={eplTopXARows} layout="vertical" margin={{ left: 26, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  label={{ value: "xA (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="category"
                  dataKey="playerName"
                  width={185}
                  tick={axisNameTick}
                  interval={0}
                  tickLine={false}
                  tickFormatter={(value) => shortName(value, 23)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--tooltip-border)",
                    borderRadius: 12,
                    color: "var(--tooltip-text)",
                  }}
                  labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--tooltip-text)" }}
                  formatter={(value) => Number(value).toFixed(3)}
                />
                <Bar
                  dataKey="xA"
                  radius={[0, 7, 7, 0]}
                  onClick={(_, index) => {
                    const player = eplTopXARows[index];
                    if (player) {
                      setSpotlight({ type: "epl-player", player });
                    }
                  }}
                >
                  {eplTopXARows.map((row) => (
                    <Cell key={`${row.playerId}-xa`} fill={getTeamColor(row.teamName)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {renderShowMore("eplTopXA", eplTopXA.length)}
          </Panel>
        </section>

        <section className="panel-grid panel-grid-two">
          <Panel
            title="xG/90 vs xA/90"
            subtitle="X-axis: xG per 90 | Y-axis: xA per 90 | Hover includes player name + team"
          >
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 20, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  dataKey="xGPer90"
                  name="xG/90"
                  tick={axisTick}
                  label={{ value: "xG / 90 (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="number"
                  dataKey="xAPer90"
                  name="xA/90"
                  tick={axisTick}
                  label={{
                    value: "xA / 90 (Y-axis)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--axis-label)",
                  }}
                />
                <ZAxis type="number" dataKey="shotsPer90" name="Shots/90" range={[60, 420]} />
                <Tooltip
                  content={(
                    <ScatterTooltipCard
                      nameKey="playerName"
                      teamKey="teamName"
                      fields={[
                        { key: "minutes", label: "Minutes", kind: "integer" },
                        { key: "xGPer90", label: "xG/90", kind: "decimal", decimals: 3 },
                        { key: "xAPer90", label: "xA/90", kind: "decimal", decimals: 3 },
                        { key: "shotsPer90", label: "Shots/90", kind: "decimal", decimals: 2 },
                      ]}
                    />
                  )}
                />
                <Scatter data={eplCompareScatter} fill="var(--chart-primary)" />
              </ScatterChart>
            </ResponsiveContainer>
          </Panel>

          <Panel
            title="Goal - xG Delta"
            subtitle="X-axis: Goal minus xG | Y-axis: Player name | Positive = overperformance"
          >
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={eplOverUnderRows} layout="vertical" margin={{ left: 26, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  label={{ value: "Goal - xG (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                />
                <YAxis
                  type="category"
                  dataKey="playerName"
                  width={180}
                  tick={axisNameTick}
                  interval={0}
                  tickLine={false}
                  tickFormatter={(value) => shortName(value, 23)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--tooltip-border)",
                    borderRadius: 12,
                    color: "var(--tooltip-text)",
                  }}
                  labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--tooltip-text)" }}
                  formatter={(value) => Number(value).toFixed(3)}
                />
                <Bar
                  dataKey="goalMinusXG"
                  radius={[0, 7, 7, 0]}
                  onClick={(_, index) => {
                    const player = eplOverUnderRows[index];
                    if (player) {
                      setSpotlight({ type: "epl-player", player });
                    }
                  }}
                >
                  {eplOverUnderRows.map((row) => (
                    <Cell
                      key={`${row.playerId}-delta`}
                      fill={row.goalMinusXG >= 0 ? "var(--chart-positive)" : "var(--chart-negative)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {renderShowMore("eplOverUnder", eplOverUnder.length)}
          </Panel>
        </section>

        <section className="panel-grid panel-grid-two">
          <Panel
            title="EPL Team Advanced Table"
            subtitle="Season-filtered team profile using xG, shot volume, possession, passing, and SPI-style score"
          >
            <div className="leaderboard-table-wrap">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Played</th>
                    <th>xG</th>
                    <th>xGA</th>
                    <th>xGD</th>
                    <th>Shots</th>
                    <th>Poss%</th>
                    <th>Pass%</th>
                    <th>SPI</th>
                  </tr>
                </thead>
                <tbody>
                  {eplTeamTableRows.map((team) => (
                    <tr key={`${team.seasonId}-${team.teamId}`}>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setSpotlight({ type: "epl-team", team })}
                        >
                          {team.teamName}
                        </button>
                      </td>
                      <td>{team.matches}</td>
                      <td>{team.xGFor.toFixed(2)}</td>
                      <td>{team.xGAgainst.toFixed(2)}</td>
                      <td>{team.xGD.toFixed(2)}</td>
                      <td>{numberFormatter.format(team.shotsFor)}</td>
                      <td>{team.possessionPct.toFixed(1)}</td>
                      <td>{team.passCompletionPct.toFixed(1)}</td>
                      <td>{team.spiRating.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {renderShowMore("eplTeamTable", eplTeamsForSeason.length)}
          </Panel>

          <Panel
            title="Team xG vs xGA"
            subtitle="X-axis: xG per match | Y-axis: xGA per match | Hover includes team name and season stats"
          >
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 20, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                <XAxis
                  type="number"
                  dataKey="xGPerMatch"
                  tick={axisTick}
                  label={{
                    value: "xG per Match (X-axis)",
                    position: "insideBottom",
                    offset: -2,
                    fill: "var(--axis-label)",
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="xGAPerMatch"
                  tick={axisTick}
                  label={{
                    value: "xGA per Match (Y-axis)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--axis-label)",
                  }}
                />
                <Tooltip
                  content={(
                    <ScatterTooltipCard
                      nameKey="teamName"
                      fields={[
                        { key: "matches", label: "Matches", kind: "integer" },
                        { key: "xGPerMatch", label: "xG/Match", kind: "decimal", decimals: 3 },
                        { key: "xGAPerMatch", label: "xGA/Match", kind: "decimal", decimals: 3 },
                        { key: "xGD", label: "xGD", kind: "decimal", decimals: 2 },
                      ]}
                    />
                  )}
                />
                <Scatter data={eplTeamScatterRows} fill="var(--chart-quaternary)" />
              </ScatterChart>
            </ResponsiveContainer>
          </Panel>
        </section>

        <section className="dashboard-panel animate-rise">
          <div className="panel-header">
            <h3>EPL Player Compare Table (xGStat-style columns)</h3>
            <p>
              Includes attacking and progression metrics: xG, npxG, xA, shots/90, key passes/90,
              progressive actions, and goal minus xG.
            </p>
          </div>

          <div className="leaderboard-toolbar">
            <select
              value={eplSortField}
              onChange={(event) => setEplSortField(event.target.value as EplSortField)}
            >
              <option value="goalContributionPer90">Sort: G+A / 90</option>
              <option value="xGPer90">Sort: xG / 90</option>
              <option value="xAPer90">Sort: xA / 90</option>
              <option value="shotsPer90">Sort: Shots / 90</option>
              <option value="keyPassesPer90">Sort: Key Passes / 90</option>
              <option value="goalMinusXG">Sort: Goal - xG</option>
            </select>

            <button
              type="button"
              onClick={() =>
                setEplSortDirection((current) => (current === "desc" ? "asc" : "desc"))
              }
            >
              Direction: {eplSortDirection.toUpperCase()}
            </button>
          </div>

          <div className="leaderboard-table-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Team</th>
                  <th>Min</th>
                  <th>G</th>
                  <th>xG</th>
                  <th>xA</th>
                  <th>Shots/90</th>
                  <th>xG/90</th>
                  <th>xA/90</th>
                  <th>KP/90</th>
                  <th>Prog P/90</th>
                  <th>G-xG</th>
                </tr>
              </thead>
              <tbody>
                {eplPlayerTableRows.map((player) => (
                  <tr key={`${player.seasonId}-${player.playerId}`}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setSpotlight({ type: "epl-player", player })}
                      >
                        {player.playerName}
                      </button>
                      <span>{player.country}</span>
                    </td>
                    <td>
                      <TeamBadge teamName={player.teamName} />
                    </td>
                    <td>{numberFormatter.format(Math.round(player.minutes))}</td>
                    <td>{player.goals}</td>
                    <td>{player.xG.toFixed(2)}</td>
                    <td>{player.xA.toFixed(2)}</td>
                    <td>{player.shotsPer90.toFixed(2)}</td>
                    <td>{player.xGPer90.toFixed(3)}</td>
                    <td>{player.xAPer90.toFixed(3)}</td>
                    <td>{player.keyPassesPer90.toFixed(2)}</td>
                    <td>{player.progressivePassesPer90.toFixed(2)}</td>
                    <td>{player.goalMinusXG.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {renderShowMore("eplPlayerTable", eplPlayersForSeason.length)}
        </section>

        <section className="dashboard-panel animate-rise">
          <div className="panel-header">
            <h3>SPI-Style Team Power Index (League Filter)</h3>
            <p>
              Modeled league strength view inspired by SPI dashboards. Filter a league to inspect
              team power scores and supporting rate stats.
            </p>
          </div>

          <div className="leaderboard-toolbar">
            <select
              value={selectedSpiLeague}
              onChange={(event) => setSelectedSpiLeague(event.target.value)}
            >
              {eplAdvancedData.filters.spiLeagues.map((league) => (
                <option key={league.leagueKey} value={league.leagueKey}>
                  {league.leagueName} ({league.country}, {league.seasonName})
                </option>
              ))}
            </select>
            {selectedSpiLeagueMeta ? (
              <div className="selection-pill">
                {selectedSpiLeagueMeta.leagueName} | {selectedSpiLeagueMeta.country} | {selectedSpiLeagueMeta.seasonName}
              </div>
            ) : null}
          </div>

          <section className="panel-grid panel-grid-two inner-panel-grid">
            <Panel title="League SPI Ranking" subtitle="Higher score indicates stronger overall profile">
              <ResponsiveContainer width="100%" height={310}>
                <BarChart data={spiRankingRows} layout="vertical" margin={{ left: 24, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.55} />
                  <XAxis
                    type="number"
                    tick={axisTick}
                    domain={[0, 100]}
                    label={{ value: "SPI Rating (X-axis)", position: "insideBottom", offset: -2, fill: "var(--axis-label)" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="teamName"
                    width={180}
                    tick={axisNameTick}
                    interval={0}
                    tickLine={false}
                    tickFormatter={(value) => shortName(value, 24)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--tooltip-bg)",
                      border: "1px solid var(--tooltip-border)",
                      borderRadius: 12,
                      color: "var(--tooltip-text)",
                    }}
                    labelStyle={{ color: "var(--tooltip-title)", fontWeight: 700 }}
                    itemStyle={{ color: "var(--tooltip-text)" }}
                    formatter={(value) => Number(value).toFixed(2)}
                  />
                  <Bar dataKey="spiRating" fill="var(--chart-primary)" radius={[0, 7, 7, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {renderShowMore("spiRanking", spiRows.length)}
            </Panel>

            <Panel title="SPI Table" subtitle="Points rate, goal differential and attack/defense rates">
              <div className="leaderboard-table-wrap">
                <table className="leaderboard-table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>SPI</th>
                      <th>Pts</th>
                      <th>PPG</th>
                      <th>GD</th>
                      <th>GD/Match</th>
                      <th>Attack</th>
                      <th>Defense</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spiTableRows.map((row: SpiLeagueRatingRow) => (
                      <tr key={`${row.leagueKey}-${row.teamName}`}>
                        <td>{row.teamName}</td>
                        <td>{row.spiRating.toFixed(1)}</td>
                        <td>{row.points}</td>
                        <td>{row.pointsPerGame.toFixed(2)}</td>
                        <td>{row.goalDifference}</td>
                        <td>{row.goalDiffPerMatch.toFixed(2)}</td>
                        <td>{row.attackPerMatch.toFixed(2)}</td>
                        <td>{row.defensePerMatch.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {renderShowMore("spiTable", spiRows.length)}
            </Panel>
          </section>
        </section>

        <section className="dashboard-panel animate-rise">
          <div className="panel-header">
            <h3>EPL Notebook Integration</h3>
            <p>
              Parsed metadata from Kaggle notebook output figures (titles, trace types, and sample axes)
              to align this dashboard with the EPL notebook&apos;s visual analysis topics.
            </p>
          </div>

          <div className="notebook-grid">
            {notebookRows.map((figure) => (
              <article key={figure.file} className="notebook-card">
                <p className="notebook-title">{figure.title}</p>
                <p>
                  File: <strong>{figure.file}</strong>
                </p>
                <p>
                  Traces: <strong>{figure.traceCount}</strong> | Types: {figure.traceTypes.join(", ")}
                </p>
                <p>
                  Approx points: <strong>{numberFormatter.format(figure.approxPoints)}</strong>
                </p>
              </article>
            ))}
          </div>
          {renderShowMore("notebookInsights", eplAdvancedData.notebookInsights.length)}
        </section>

        <footer className="dashboard-footer">
          <p>
            Sources: <a href={data.meta.source.url}>{data.meta.source.name}</a> |{" "}
            <a href={eplAdvancedData.meta.sources.statsbomb.url}>{eplAdvancedData.meta.sources.statsbomb.name}</a>
            | <a href={eplAdvancedData.meta.sources.eplNotebook.url}>{eplAdvancedData.meta.sources.eplNotebook.name}</a>
            | <a href={eplAdvancedData.meta.sources.analyst.url}>{eplAdvancedData.meta.sources.analyst.name}</a>
          </p>
          <p>
            Inspirations: {" "}
            {data.meta.inspirations.map((inspiration, index) => (
              <span key={inspiration.name}>
                <a href={inspiration.url}>{inspiration.name}</a>
                {index < data.meta.inspirations.length - 1 ? " | " : ""}
              </span>
            ))}
          </p>
        </footer>
      </div>

      {spotlight ? (
        <div className="spotlight-overlay" onClick={() => setSpotlight(null)}>
          <aside className="spotlight-panel" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="spotlight-close" onClick={() => setSpotlight(null)}>
              Close
            </button>

            {spotlight.type === "base-player" ? (
              <div className="spotlight-content">
                <p className="eyebrow">Player Detail</p>
                <h3>{spotlight.player.name}</h3>
                <p>{spotlight.player.club}</p>
                <div className="spotlight-metrics">
                  <div>
                    <span>Goals</span>
                    <strong>{spotlight.player.goals}</strong>
                  </div>
                  <div>
                    <span>Assists</span>
                    <strong>{spotlight.player.assists}</strong>
                  </div>
                  <div>
                    <span>Minutes</span>
                    <strong>{numberFormatter.format(spotlight.player.minutes)}</strong>
                  </div>
                  <div>
                    <span>G+A / 90</span>
                    <strong>
                      {per90(
                        spotlight.player.goals + spotlight.player.assists,
                        spotlight.player.minutes,
                      ).toFixed(3)}
                    </strong>
                  </div>
                  <div>
                    <span>Cards</span>
                    <strong>
                      {spotlight.player.yellowCards}/{spotlight.player.redCards}
                    </strong>
                  </div>
                  <div>
                    <span>Perf Index</span>
                    <strong>{spotlight.player.performanceIndex.toFixed(2)}</strong>
                  </div>
                </div>
              </div>
            ) : null}

            {spotlight.type === "base-team" ? (
              <div className="spotlight-content">
                <p className="eyebrow">Team Detail</p>
                <h3>{spotlight.team.club}</h3>
                <div className="spotlight-metrics">
                  <div>
                    <span>Players</span>
                    <strong>{numberFormatter.format(spotlight.team.players)}</strong>
                  </div>
                  <div>
                    <span>Apps</span>
                    <strong>{numberFormatter.format(spotlight.team.appearances)}</strong>
                  </div>
                  <div>
                    <span>Goals</span>
                    <strong>{numberFormatter.format(spotlight.team.goals)}</strong>
                  </div>
                  <div>
                    <span>Assists</span>
                    <strong>{numberFormatter.format(spotlight.team.assists)}</strong>
                  </div>
                  <div>
                    <span>G+A / 90</span>
                    <strong>{spotlight.team.goalContributionPer90.toFixed(3)}</strong>
                  </div>
                  <div>
                    <span>Avg Index</span>
                    <strong>{spotlight.team.avgPerformanceIndex.toFixed(2)}</strong>
                  </div>
                </div>
              </div>
            ) : null}

            {spotlight.type === "epl-player" ? (
              <div className="spotlight-content">
                <p className="eyebrow">EPL Player Advanced</p>
                <h3>{spotlight.player.playerName}</h3>
                <TeamBadge teamName={spotlight.player.teamName} />
                <div className="spotlight-metrics">
                  <div>
                    <span>Minutes</span>
                    <strong>{numberFormatter.format(Math.round(spotlight.player.minutes))}</strong>
                  </div>
                  <div>
                    <span>xG</span>
                    <strong>{spotlight.player.xG.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>xA</span>
                    <strong>{spotlight.player.xA.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>npxG</span>
                    <strong>{spotlight.player.npxG.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Shots / 90</span>
                    <strong>{spotlight.player.shotsPer90.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>KP / 90</span>
                    <strong>{spotlight.player.keyPassesPer90.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Prog Pass / 90</span>
                    <strong>{spotlight.player.progressivePassesPer90.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>G-xG</span>
                    <strong>{spotlight.player.goalMinusXG.toFixed(2)}</strong>
                  </div>
                </div>
              </div>
            ) : null}

            {spotlight.type === "epl-team" ? (
              <div className="spotlight-content">
                <p className="eyebrow">EPL Team Advanced</p>
                <h3>{spotlight.team.teamName}</h3>
                <div className="spotlight-metrics">
                  <div>
                    <span>Points</span>
                    <strong>{spotlight.team.points}</strong>
                  </div>
                  <div>
                    <span>xG</span>
                    <strong>{spotlight.team.xGFor.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>xGA</span>
                    <strong>{spotlight.team.xGAgainst.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>xGD</span>
                    <strong>{spotlight.team.xGD.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Possession</span>
                    <strong>{spotlight.team.possessionPct.toFixed(1)}%</strong>
                  </div>
                  <div>
                    <span>Pass Completion</span>
                    <strong>{spotlight.team.passCompletionPct.toFixed(1)}%</strong>
                  </div>
                  <div>
                    <span>Pressures</span>
                    <strong>{numberFormatter.format(spotlight.team.pressures)}</strong>
                  </div>
                  <div>
                    <span>SPI-style</span>
                    <strong>{spotlight.team.spiRating.toFixed(1)}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </main>
  );
}
