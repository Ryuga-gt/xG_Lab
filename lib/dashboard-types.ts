export type CompetitionFilterOption = {
  id: string;
  name: string;
  country: string;
  type: string;
};

export type LeaderboardPlayer = {
  playerId: number;
  name: string;
  club: string;
  country: string;
  position: string;
  subPosition: string;
  age: number | null;
  appearances: number;
  goals: number;
  assists: number;
  minutes: number;
  yellowCards: number;
  redCards: number;
  marketValue: number;
  performanceIndex: number;
};

export type ComboDashboard = {
  season: number;
  competitionId: string;
  competitionName: string;
  competitionCountry: string;
  competitionType: string;
  totals: {
    appearances: number;
    goals: number;
    assists: number;
    minutes: number;
    yellowCards: number;
    redCards: number;
    uniquePlayers: number;
    avgGoalsPerAppearance: number;
    avgMinutesPerAppearance: number;
  };
  topScorers: LeaderboardPlayer[];
  topAssisters: LeaderboardPlayer[];
  positionDistribution: Array<{
    position: string;
    count: number;
  }>;
  ageHistogram: Array<{
    bucket: string;
    count: number;
  }>;
  playerScatter: Array<{
    playerId: number;
    name: string;
    position: string;
    goals: number;
    assists: number;
    minutes: number;
    appearances: number;
    performanceIndex: number;
  }>;
  monthlyMomentum: Array<{
    month: string;
    appearances: number;
    goals: number;
    assists: number;
  }>;
  cardsByClub: Array<{
    club: string;
    yellowCards: number;
    redCards: number;
    totalCards: number;
  }>;
  marketValueByPosition: Array<{
    position: string;
    avgMarketValue: number;
    playerCount: number;
  }>;
  leaderboard: LeaderboardPlayer[];
};

export type DashboardDataset = {
  meta: {
    generatedAt: string;
    source: {
      name: string;
      url: string;
    };
    inspirations: Array<{
      name: string;
      url: string;
    }>;
    competitionsIncluded: number;
    rows: {
      appearancesProcessed: number;
      appearancesIncluded: number;
      appearancesSkipped: number;
      gamesLoaded: number;
      playersLoaded: number;
    };
  };
  filters: {
    seasons: number[];
    competitions: CompetitionFilterOption[];
  };
  overview: {
    totalAppearances: number;
    totalGoals: number;
    totalAssists: number;
    totalMinutes: number;
    totalCombos: number;
    totalUniquePlayersAcrossCombos: number;
    avgGoalsPerAppearance: number;
    avgMinutesPerAppearance: number;
  };
  globalSeries: {
    seasonTrend: Array<{
      season: number;
      appearances: number;
      goals: number;
      assists: number;
      minutes: number;
      avgGoalsPerAppearance: number;
    }>;
    competitionTrend: Array<{
      competitionId: string;
      competitionName: string;
      country: string;
      seasonsCovered: number;
      appearances: number;
      goals: number;
      assists: number;
      minutes: number;
      avgGoalsPerAppearance: number;
    }>;
    marketValueTrend: Array<{
      year: number;
      avgMarketValue: number;
      records: number;
    }>;
  };
  combos: Record<string, ComboDashboard>;
};

export type EplPlayerAdvancedRow = {
  seasonId: number;
  seasonName: string;
  playerId: number;
  playerName: string;
  teamId: number;
  teamName: string;
  country: string;
  minutes: number;
  appearances: number;
  starts: number;
  goals: number;
  nonPenaltyGoals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  xG: number;
  npxG: number;
  xA: number;
  keyPasses: number;
  passesAttempted: number;
  passesCompleted: number;
  progressivePasses: number;
  progressiveCarries: number;
  dribblesAttempted: number;
  dribblesCompleted: number;
  pressures: number;
  tackles: number;
  interceptions: number;
  ballRecoveries: number;
  yellowCards: number;
  redCards: number;
  goalsPer90: number;
  assistsPer90: number;
  shotsPer90: number;
  shotsOnTargetPer90: number;
  xGPer90: number;
  npxGPer90: number;
  xAPer90: number;
  keyPassesPer90: number;
  progressivePassesPer90: number;
  progressiveCarriesPer90: number;
  dribblesPer90: number;
  pressuresPer90: number;
  goalMinusXG: number;
  goalContributionPer90: number;
  passCompletionPct: number;
};

export type EplTeamAdvancedRow = {
  seasonId: number;
  seasonName: string;
  teamId: number;
  teamName: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  xGFor: number;
  xGAgainst: number;
  npxGFor: number;
  npxGAgainst: number;
  xGD: number;
  shotsFor: number;
  shotsAgainst: number;
  shotsOnTargetFor: number;
  shotsOnTargetAgainst: number;
  passesAttempted: number;
  passesCompleted: number;
  passCompletionPct: number;
  keyPasses: number;
  progressivePasses: number;
  progressiveCarries: number;
  pressures: number;
  interceptions: number;
  ballRecoveries: number;
  possessionPct: number;
  pointsPerGame: number;
  xGPerMatch: number;
  xGAPerMatch: number;
  spiRating: number;
};

export type SpiLeagueRatingRow = {
  leagueKey: string;
  competitionId: number;
  seasonId: number;
  leagueName: string;
  country: string;
  seasonName: string;
  teamName: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  pointsPerGame: number;
  goalDiffPerMatch: number;
  attackPerMatch: number;
  defensePerMatch: number;
  spiRating: number;
};

export type NotebookFigureInsight = {
  file: string;
  title: string;
  traceCount: number;
  traceTypes: string[];
  approxPoints: number;
  sampleLabels: string[];
};

export type EplAdvancedDataset = {
  meta: {
    generatedAt: string;
    sources: {
      statsbomb: {
        name: string;
        url: string;
        competitionId: number;
        seasonIds: number[];
      };
      eplNotebook: {
        name: string;
        url: string;
        outputVersionFigures: number;
      };
      analyst: {
        name: string;
        url: string;
        api: string;
        tmcl: string;
        seasonId: number;
        seasonName: string;
        rowsPlayers: number;
        rowsTeams: number;
      };
    };
    rows: {
      eplMatches: number;
      eplPlayers: number;
      eplTeams: number;
      spiRows: number;
      analystPlayers: number;
      analystTeams: number;
    };
  };
  filters: {
    eplSeasons: Array<{
      seasonId: number;
      seasonName: string;
    }>;
    spiLeagues: Array<{
      leagueKey: string;
      leagueName: string;
      country: string;
      seasonName: string;
    }>;
  };
  epl: {
    playerRows: EplPlayerAdvancedRow[];
    teamRows: EplTeamAdvancedRow[];
    topCompareRows: EplPlayerAdvancedRow[];
  };
  spiByLeague: SpiLeagueRatingRow[];
  notebookInsights: NotebookFigureInsight[];
};
