import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse";

import type {
  CompetitionFilterOption,
  DashboardDataset,
  LeaderboardPlayer,
} from "../lib/dashboard-types";

type CsvRow = Record<string, string>;

type PlayerInfo = {
  id: number;
  name: string;
  position: string;
  subPosition: string;
  citizenship: string;
  currentClubName: string;
  birthYear: number | null;
  marketValue: number;
};

type CompetitionInfo = {
  id: string;
  name: string;
  country: string;
  type: string;
};

type GameInfo = {
  season: number;
  competitionId: string;
  date: string;
};

type PlayerAggregate = {
  playerId: number;
  name: string;
  country: string;
  position: string;
  subPosition: string;
  club: string;
  marketValue: number;
  age: number | null;
  appearances: number;
  goals: number;
  assists: number;
  minutes: number;
  yellowCards: number;
  redCards: number;
};

type ClubCardAggregate = {
  yellowCards: number;
  redCards: number;
};

type MonthAggregate = {
  appearances: number;
  goals: number;
  assists: number;
};

type ComboAccumulator = {
  season: number;
  competitionId: string;
  totals: {
    appearances: number;
    goals: number;
    assists: number;
    minutes: number;
    yellowCards: number;
    redCards: number;
  };
  players: Map<number, PlayerAggregate>;
  clubCards: Map<string, ClubCardAggregate>;
  monthlyMomentum: Map<string, MonthAggregate>;
};

const RAW_DATA_DIR = process.env.KAGGLE_DATA_DIR
  ? path.resolve(process.env.KAGGLE_DATA_DIR)
  : path.join(process.cwd(), "data", "raw");
const OUTPUT_PATH = path.join(process.cwd(), "public", "data", "dashboard-data.json");

const REQUIRED_FILES = [
  "appearances.csv",
  "competitions.csv",
  "games.csv",
  "clubs.csv",
  "players.csv",
  "player_valuations.csv",
] as const;

const COMPETITION_LIMIT = Number(process.env.COMPETITION_LIMIT ?? 16);
const TOP_PLAYER_LIMIT = Number(process.env.TOP_PLAYER_LIMIT ?? 14);
const TABLE_LIMIT = Number(process.env.TABLE_LIMIT ?? 80);
const SCATTER_LIMIT = Number(process.env.SCATTER_LIMIT ?? 100);
const CLUB_CARD_LIMIT = Number(process.env.CLUB_CARD_LIMIT ?? 12);

const FORCED_COMPETITIONS = ["CL", "EL"];

function valueOrUnknown(value: string | undefined, fallback = "Unknown"): string {
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function toInt(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function parseYearFromDate(dateInput: string | undefined): number | null {
  if (!dateInput || dateInput.length < 4) {
    return null;
  }
  const year = Number(dateInput.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((token) => (token.length > 0 ? token[0].toUpperCase() + token.slice(1) : token))
    .join(" ");
}

function formatCompetitionName(rawName: string | undefined, competitionId: string): string {
  if (!rawName || rawName.trim().length === 0) {
    return competitionId;
  }
  if (rawName.includes("-")) {
    return humanizeSlug(rawName);
  }
  return rawName
    .split(" ")
    .map((token) =>
      token.length > 0 ? token[0].toUpperCase() + token.slice(1).toLowerCase() : token,
    )
    .join(" ");
}

function makeComboKey(season: number, competitionId: string): string {
  return `${season}__${competitionId}`;
}

function getAgeBucket(age: number | null): string {
  if (age === null || age <= 0) {
    return "Unknown";
  }
  if (age < 20) {
    return "Under 20";
  }
  if (age <= 23) {
    return "20-23";
  }
  if (age <= 27) {
    return "24-27";
  }
  if (age <= 31) {
    return "28-31";
  }
  return "32+";
}

function performanceIndex(player: {
  goals: number;
  assists: number;
  minutes: number;
  yellowCards: number;
  redCards: number;
}): number {
  const positive = player.goals * 4 + player.assists * 3 + player.minutes / 90;
  const negative = player.yellowCards * 0.4 + player.redCards * 2;
  return Number((positive - negative).toFixed(2));
}

async function ensureRequiredFiles(rawDir: string): Promise<void> {
  for (const file of REQUIRED_FILES) {
    const filePath = path.join(rawDir, file);
    try {
      await access(filePath);
    } catch {
      throw new Error(`Missing required file: ${filePath}. Run npm run data:download first.`);
    }
  }
}

async function* readCsv(filePath: string): AsyncGenerator<CsvRow> {
  const parser = createReadStream(filePath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_quotes: true,
    }),
  );

  for await (const record of parser) {
    yield record as CsvRow;
  }
}

function getOrCreateCombo(
  comboMap: Map<string, ComboAccumulator>,
  season: number,
  competitionId: string,
): ComboAccumulator {
  const key = makeComboKey(season, competitionId);
  const existing = comboMap.get(key);
  if (existing) {
    return existing;
  }

  const created: ComboAccumulator = {
    season,
    competitionId,
    totals: {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0,
      yellowCards: 0,
      redCards: 0,
    },
    players: new Map(),
    clubCards: new Map(),
    monthlyMomentum: new Map(),
  };

  comboMap.set(key, created);
  return created;
}

function sortLeaderboard(
  players: PlayerAggregate[],
  metric: "goals" | "assists" | "performance",
): LeaderboardPlayer[] {
  const sorted = [...players].sort((a, b) => {
    if (metric === "goals") {
      return (
        b.goals - a.goals ||
        b.assists - a.assists ||
        b.minutes - a.minutes ||
        a.name.localeCompare(b.name)
      );
    }
    if (metric === "assists") {
      return (
        b.assists - a.assists ||
        b.goals - a.goals ||
        b.minutes - a.minutes ||
        a.name.localeCompare(b.name)
      );
    }

    return (
      performanceIndex(b) - performanceIndex(a) ||
      b.goals - a.goals ||
      b.assists - a.assists ||
      b.minutes - a.minutes ||
      a.name.localeCompare(b.name)
    );
  });

  return sorted.slice(0, TABLE_LIMIT).map((player) => ({
    playerId: player.playerId,
    name: player.name,
    club: player.club,
    country: player.country,
    position: player.position,
    subPosition: player.subPosition,
    age: player.age,
    appearances: player.appearances,
    goals: player.goals,
    assists: player.assists,
    minutes: player.minutes,
    yellowCards: player.yellowCards,
    redCards: player.redCards,
    marketValue: player.marketValue,
    performanceIndex: performanceIndex(player),
  }));
}

function finalizeCombo(
  combo: ComboAccumulator,
  competitionInfo: CompetitionInfo | undefined,
): DashboardDataset["combos"][string] {
  const players = Array.from(combo.players.values());

  const positionCounts = new Map<string, number>();
  const ageCounts = new Map<string, number>();
  const marketValueByPosition = new Map<string, { sum: number; count: number }>();

  for (const player of players) {
    positionCounts.set(player.position, (positionCounts.get(player.position) ?? 0) + 1);
    const ageBucket = getAgeBucket(player.age);
    ageCounts.set(ageBucket, (ageCounts.get(ageBucket) ?? 0) + 1);

    if (player.marketValue > 0) {
      const current = marketValueByPosition.get(player.position) ?? { sum: 0, count: 0 };
      current.sum += player.marketValue;
      current.count += 1;
      marketValueByPosition.set(player.position, current);
    }
  }

  const playerPoolForCharts = players.filter((player) => player.minutes >= 180);

  const topScorers = sortLeaderboard(playerPoolForCharts, "goals").slice(0, TOP_PLAYER_LIMIT);
  const topAssisters = sortLeaderboard(playerPoolForCharts, "assists").slice(0, TOP_PLAYER_LIMIT);
  const leaderboard = sortLeaderboard(players, "performance");

  const playerScatter = [...playerPoolForCharts]
    .sort((a, b) => {
      return (
        performanceIndex(b) - performanceIndex(a) ||
        b.goals + b.assists - (a.goals + a.assists) ||
        b.minutes - a.minutes
      );
    })
    .slice(0, SCATTER_LIMIT)
    .map((player) => ({
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      goals: player.goals,
      assists: player.assists,
      minutes: player.minutes,
      appearances: player.appearances,
      performanceIndex: performanceIndex(player),
    }));

  const cardsByClub = Array.from(combo.clubCards.entries())
    .map(([club, cards]) => ({
      club,
      yellowCards: cards.yellowCards,
      redCards: cards.redCards,
      totalCards: cards.yellowCards + cards.redCards,
    }))
    .sort((a, b) => b.totalCards - a.totalCards || a.club.localeCompare(b.club))
    .slice(0, CLUB_CARD_LIMIT);

  const monthlyMomentum = Array.from(combo.monthlyMomentum.entries())
    .map(([month, values]) => ({
      month,
      appearances: values.appearances,
      goals: values.goals,
      assists: values.assists,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const positionDistribution = Array.from(positionCounts.entries())
    .map(([position, count]) => ({ position, count }))
    .sort((a, b) => b.count - a.count || a.position.localeCompare(b.position));

  const ageHistogram = ["Under 20", "20-23", "24-27", "28-31", "32+", "Unknown"].map(
    (bucket) => ({
      bucket,
      count: ageCounts.get(bucket) ?? 0,
    }),
  );

  const marketValueByPositionSeries = Array.from(marketValueByPosition.entries())
    .map(([position, values]) => ({
      position,
      avgMarketValue: Math.round(values.sum / values.count),
      playerCount: values.count,
    }))
    .sort((a, b) => b.avgMarketValue - a.avgMarketValue)
    .slice(0, 10);

  const avgGoalsPerAppearance =
    combo.totals.appearances > 0 ? combo.totals.goals / combo.totals.appearances : 0;
  const avgMinutesPerAppearance =
    combo.totals.appearances > 0 ? combo.totals.minutes / combo.totals.appearances : 0;

  return {
    season: combo.season,
    competitionId: combo.competitionId,
    competitionName: competitionInfo?.name ?? combo.competitionId,
    competitionCountry: competitionInfo?.country ?? "Unknown",
    competitionType: competitionInfo?.type ?? "Unknown",
    totals: {
      appearances: combo.totals.appearances,
      goals: combo.totals.goals,
      assists: combo.totals.assists,
      minutes: combo.totals.minutes,
      yellowCards: combo.totals.yellowCards,
      redCards: combo.totals.redCards,
      uniquePlayers: players.length,
      avgGoalsPerAppearance: Number(avgGoalsPerAppearance.toFixed(4)),
      avgMinutesPerAppearance: Number(avgMinutesPerAppearance.toFixed(2)),
    },
    topScorers,
    topAssisters,
    positionDistribution,
    ageHistogram,
    playerScatter,
    monthlyMomentum,
    cardsByClub,
    marketValueByPosition: marketValueByPositionSeries,
    leaderboard,
  };
}

async function main(): Promise<void> {
  await ensureRequiredFiles(RAW_DATA_DIR);

  const competitions = new Map<string, CompetitionInfo>();
  const clubs = new Map<number, string>();
  const players = new Map<number, PlayerInfo>();
  const games = new Map<number, GameInfo>();

  const competitionMatchCounts = new Map<string, number>();
  const comboMap = new Map<string, ComboAccumulator>();
  const marketValueByYear = new Map<number, { totalValue: number; rows: number }>();

  let appearancesProcessed = 0;
  let appearancesIncluded = 0;
  let appearancesSkipped = 0;

  console.log("Loading competitions...");
  for await (const row of readCsv(path.join(RAW_DATA_DIR, "competitions.csv"))) {
    const competitionId = valueOrUnknown(row.competition_id, "");
    if (!competitionId) {
      continue;
    }

    competitions.set(competitionId, {
      id: competitionId,
      name: formatCompetitionName(row.name, competitionId),
      country: valueOrUnknown(row.country_name),
      type: valueOrUnknown(row.type),
    });
  }

  console.log("Loading clubs...");
  for await (const row of readCsv(path.join(RAW_DATA_DIR, "clubs.csv"))) {
    const clubId = toInt(row.club_id);
    if (clubId === 0) {
      continue;
    }
    clubs.set(clubId, valueOrUnknown(row.name));
  }

  console.log("Loading players...");
  for await (const row of readCsv(path.join(RAW_DATA_DIR, "players.csv"))) {
    const playerId = toInt(row.player_id);
    if (playerId === 0) {
      continue;
    }

    const birthYear = parseYearFromDate(row.date_of_birth);
    players.set(playerId, {
      id: playerId,
      name: valueOrUnknown(row.name),
      position: valueOrUnknown(row.position),
      subPosition: valueOrUnknown(row.sub_position),
      citizenship: valueOrUnknown(row.country_of_citizenship),
      currentClubName: valueOrUnknown(row.current_club_name, "Unassigned"),
      birthYear,
      marketValue: toInt(row.market_value_in_eur),
    });
  }

  console.log("Loading games and selecting competitions...");
  for await (const row of readCsv(path.join(RAW_DATA_DIR, "games.csv"))) {
    const gameId = toInt(row.game_id);
    const season = toInt(row.season);
    const competitionId = valueOrUnknown(row.competition_id, "");

    if (!gameId || !season || !competitionId) {
      continue;
    }

    games.set(gameId, {
      season,
      competitionId,
      date: valueOrUnknown(row.date, ""),
    });

    competitionMatchCounts.set(
      competitionId,
      (competitionMatchCounts.get(competitionId) ?? 0) + 1,
    );
  }

  const selectedCompetitionIds = new Set(
    [...competitionMatchCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, COMPETITION_LIMIT)
      .map(([competitionId]) => competitionId),
  );

  for (const forcedCompetitionId of FORCED_COMPETITIONS) {
    if (competitionMatchCounts.has(forcedCompetitionId)) {
      selectedCompetitionIds.add(forcedCompetitionId);
    }
  }

  const selectedCompetitionList = Array.from(selectedCompetitionIds).sort((a, b) => {
    const nameA = competitions.get(a)?.name ?? a;
    const nameB = competitions.get(b)?.name ?? b;
    return nameA.localeCompare(nameB);
  });

  console.log(`Selected competitions (${selectedCompetitionList.length}):`);
  for (const competitionId of selectedCompetitionList) {
    const label = competitions.get(competitionId)?.name ?? competitionId;
    const gamesCount = competitionMatchCounts.get(competitionId) ?? 0;
    console.log(`  - ${label} (${competitionId}): ${gamesCount.toLocaleString()} games`);
  }

  console.log("Processing appearances...");
  for await (const row of readCsv(path.join(RAW_DATA_DIR, "appearances.csv"))) {
    appearancesProcessed += 1;

    const competitionId = valueOrUnknown(row.competition_id, "");
    if (!selectedCompetitionIds.has(competitionId)) {
      appearancesSkipped += 1;
      continue;
    }

    const gameId = toInt(row.game_id);
    const gameInfo = games.get(gameId);
    if (!gameInfo) {
      appearancesSkipped += 1;
      continue;
    }

    const season = gameInfo.season;
    const combo = getOrCreateCombo(comboMap, season, competitionId);

    const goals = toInt(row.goals);
    const assists = toInt(row.assists);
    const minutes = toInt(row.minutes_played);
    const yellowCards = toInt(row.yellow_cards);
    const redCards = toInt(row.red_cards);

    combo.totals.appearances += 1;
    combo.totals.goals += goals;
    combo.totals.assists += assists;
    combo.totals.minutes += minutes;
    combo.totals.yellowCards += yellowCards;
    combo.totals.redCards += redCards;

    const playerId = toInt(row.player_id);
    const playerInfo = players.get(playerId);

    const playerName = playerInfo?.name ?? valueOrUnknown(row.player_name, `Player ${playerId}`);
    const playerPosition = playerInfo?.position ?? "Unknown";
    const playerSubPosition = playerInfo?.subPosition ?? "Unknown";
    const playerCountry = playerInfo?.citizenship ?? "Unknown";
    const playerAge = playerInfo?.birthYear ? season - playerInfo.birthYear : null;
    const playerMarketValue = playerInfo?.marketValue ?? 0;

    const clubId = toInt(row.player_club_id);
    const clubName = clubs.get(clubId) ?? playerInfo?.currentClubName ?? "Unknown Club";

    const playerAggregate = combo.players.get(playerId) ?? {
      playerId,
      name: playerName,
      country: playerCountry,
      position: playerPosition,
      subPosition: playerSubPosition,
      club: clubName,
      marketValue: playerMarketValue,
      age: playerAge,
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0,
      yellowCards: 0,
      redCards: 0,
    };

    playerAggregate.appearances += 1;
    playerAggregate.goals += goals;
    playerAggregate.assists += assists;
    playerAggregate.minutes += minutes;
    playerAggregate.yellowCards += yellowCards;
    playerAggregate.redCards += redCards;

    combo.players.set(playerId, playerAggregate);

    if (yellowCards > 0 || redCards > 0) {
      const clubCards = combo.clubCards.get(clubName) ?? { yellowCards: 0, redCards: 0 };
      clubCards.yellowCards += yellowCards;
      clubCards.redCards += redCards;
      combo.clubCards.set(clubName, clubCards);
    }

    const month = valueOrUnknown(row.date || gameInfo.date, "").slice(0, 7);
    if (month.length === 7) {
      const monthly = combo.monthlyMomentum.get(month) ?? { appearances: 0, goals: 0, assists: 0 };
      monthly.appearances += 1;
      monthly.goals += goals;
      monthly.assists += assists;
      combo.monthlyMomentum.set(month, monthly);
    }

    appearancesIncluded += 1;

    if (appearancesProcessed % 250_000 === 0) {
      console.log(`  - processed ${appearancesProcessed.toLocaleString()} appearance rows`);
    }
  }

  console.log("Processing market values...");
  for await (const row of readCsv(path.join(RAW_DATA_DIR, "player_valuations.csv"))) {
    const year = parseYearFromDate(row.date);
    const marketValue = toInt(row.market_value_in_eur);
    if (!year || marketValue <= 0) {
      continue;
    }

    const aggregate = marketValueByYear.get(year) ?? { totalValue: 0, rows: 0 };
    aggregate.totalValue += marketValue;
    aggregate.rows += 1;
    marketValueByYear.set(year, aggregate);
  }

  console.log("Finalizing dashboard payload...");

  const finalizedCombos = [...comboMap.values()]
    .map((combo) => {
      const competitionInfo = competitions.get(combo.competitionId);
      return finalizeCombo(combo, competitionInfo);
    })
    .sort((a, b) => {
      return (
        b.season - a.season ||
        a.competitionName.localeCompare(b.competitionName) ||
        a.competitionId.localeCompare(b.competitionId)
      );
    });

  const combos: DashboardDataset["combos"] = {};
  for (const combo of finalizedCombos) {
    combos[makeComboKey(combo.season, combo.competitionId)] = combo;
  }

  const seasonTrendMap = new Map<
    number,
    { appearances: number; goals: number; assists: number; minutes: number }
  >();
  const competitionTrendMap = new Map<
    string,
    { appearances: number; goals: number; assists: number; minutes: number; seasons: Set<number> }
  >();

  let totalAppearances = 0;
  let totalGoals = 0;
  let totalAssists = 0;
  let totalMinutes = 0;
  let totalUniquePlayersAcrossCombos = 0;

  for (const combo of finalizedCombos) {
    totalAppearances += combo.totals.appearances;
    totalGoals += combo.totals.goals;
    totalAssists += combo.totals.assists;
    totalMinutes += combo.totals.minutes;
    totalUniquePlayersAcrossCombos += combo.totals.uniquePlayers;

    const season = seasonTrendMap.get(combo.season) ?? {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0,
    };
    season.appearances += combo.totals.appearances;
    season.goals += combo.totals.goals;
    season.assists += combo.totals.assists;
    season.minutes += combo.totals.minutes;
    seasonTrendMap.set(combo.season, season);

    const competition = competitionTrendMap.get(combo.competitionId) ?? {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0,
      seasons: new Set<number>(),
    };
    competition.appearances += combo.totals.appearances;
    competition.goals += combo.totals.goals;
    competition.assists += combo.totals.assists;
    competition.minutes += combo.totals.minutes;
    competition.seasons.add(combo.season);
    competitionTrendMap.set(combo.competitionId, competition);
  }

  const seasonTrend = Array.from(seasonTrendMap.entries())
    .map(([season, values]) => ({
      season,
      appearances: values.appearances,
      goals: values.goals,
      assists: values.assists,
      minutes: values.minutes,
      avgGoalsPerAppearance:
        values.appearances > 0 ? Number((values.goals / values.appearances).toFixed(4)) : 0,
    }))
    .sort((a, b) => a.season - b.season);

  const competitionTrend = Array.from(competitionTrendMap.entries())
    .map(([competitionId, values]) => {
      const metadata = competitions.get(competitionId);
      return {
        competitionId,
        competitionName: metadata?.name ?? competitionId,
        country: metadata?.country ?? "Unknown",
        seasonsCovered: values.seasons.size,
        appearances: values.appearances,
        goals: values.goals,
        assists: values.assists,
        minutes: values.minutes,
        avgGoalsPerAppearance:
          values.appearances > 0 ? Number((values.goals / values.appearances).toFixed(4)) : 0,
      };
    })
    .sort((a, b) => b.appearances - a.appearances || a.competitionName.localeCompare(b.competitionName));

  const marketValueTrend = Array.from(marketValueByYear.entries())
    .map(([year, values]) => ({
      year,
      avgMarketValue: Math.round(values.totalValue / values.rows),
      records: values.rows,
    }))
    .sort((a, b) => a.year - b.year);

  const seasons = Array.from(new Set(finalizedCombos.map((combo) => combo.season))).sort(
    (a, b) => b - a,
  );

  const competitionFilters: CompetitionFilterOption[] = selectedCompetitionList.map((competitionId) => {
    const metadata = competitions.get(competitionId);
    return {
      id: competitionId,
      name: metadata?.name ?? competitionId,
      country: metadata?.country ?? "Unknown",
      type: metadata?.type ?? "Unknown",
    };
  });

  const dataset: DashboardDataset = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: {
        name: "Kaggle - Player Scores",
        url: "https://www.kaggle.com/datasets/davidcariboo/player-scores",
      },
      inspirations: [
        {
          name: "FBref",
          url: "https://fbref.com/en/",
        },
        {
          name: "WhoScored",
          url: "https://www.whoscored.com/",
        },
        {
          name: "SofaScore",
          url: "https://www.sofascore.com/",
        },
        {
          name: "Understat",
          url: "https://understat.com/",
        },
      ],
      competitionsIncluded: competitionFilters.length,
      rows: {
        appearancesProcessed,
        appearancesIncluded,
        appearancesSkipped,
        gamesLoaded: games.size,
        playersLoaded: players.size,
      },
    },
    filters: {
      seasons,
      competitions: competitionFilters,
    },
    overview: {
      totalAppearances,
      totalGoals,
      totalAssists,
      totalMinutes,
      totalCombos: finalizedCombos.length,
      totalUniquePlayersAcrossCombos,
      avgGoalsPerAppearance:
        totalAppearances > 0 ? Number((totalGoals / totalAppearances).toFixed(4)) : 0,
      avgMinutesPerAppearance:
        totalAppearances > 0 ? Number((totalMinutes / totalAppearances).toFixed(2)) : 0,
    },
    globalSeries: {
      seasonTrend,
      competitionTrend,
      marketValueTrend,
    },
    combos,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(dataset));

  const fileSizeMb = (Buffer.byteLength(JSON.stringify(dataset)) / 1024 / 1024).toFixed(2);
  console.log(`Dashboard payload written to ${OUTPUT_PATH} (${fileSizeMb} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
