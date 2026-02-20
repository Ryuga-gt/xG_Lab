#!/usr/bin/env python3
"""Build advanced EPL + SPI-style dashboard data from StatsBomb and Kaggle notebook outputs."""

from __future__ import annotations

import json
import math
import re
import ssl
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

EPL_COMPETITION_ID = 2
EPL_SEASON_IDS = {27, 44}
MIN_PLAYER_MINUTES = 180
MIN_SPI_MATCHES = 8

STATSBOMB_DATASET_HANDLE = "saurabhshahane/statsbomb-football-data"
NOTEBOOK_HANDLE = "desalegngeb/english-premier-league-players-statistics"

ANALYST_TMCL = "51r6ph2woavlbbpk8f29nynf8"
ANALYST_TOKEN = "LRkJ2MjwlC8RxUfVkne4"
ANALYST_TOURNAMENT_STATS_URL = "https://theanalyst.com/wp-json/sdapi/v1/soccerdata/tournamentstats"
ANALYST_SEASON_ID = 202526
ANALYST_SEASON_NAME = "2025/26 (Opta Analyst)"


@dataclass
class PlayerAccumulator:
    player_id: int
    player_name: str
    country: str
    season_id: int
    season_name: str
    minutes: float = 0.0
    appearances: int = 0
    starts: int = 0
    goals: int = 0
    non_penalty_goals: int = 0
    assists: int = 0
    shots: int = 0
    shots_on_target: int = 0
    xg: float = 0.0
    npxg: float = 0.0
    xa: float = 0.0
    key_passes: int = 0
    passes_attempted: int = 0
    passes_completed: int = 0
    progressive_passes: int = 0
    progressive_carries: int = 0
    dribbles_attempted: int = 0
    dribbles_completed: int = 0
    pressures: int = 0
    tackles: int = 0
    interceptions: int = 0
    ball_recoveries: int = 0
    yellow_cards: int = 0
    red_cards: int = 0


@dataclass
class TeamAccumulator:
    team_id: int
    team_name: str
    season_id: int
    season_name: str
    matches: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    points: int = 0
    goals_for: int = 0
    goals_against: int = 0
    xg_for: float = 0.0
    xg_against: float = 0.0
    npxg_for: float = 0.0
    npxg_against: float = 0.0
    shots_for: int = 0
    shots_against: int = 0
    shots_on_target_for: int = 0
    shots_on_target_against: int = 0
    passes_attempted: int = 0
    passes_completed: int = 0
    key_passes: int = 0
    progressive_passes: int = 0
    progressive_carries: int = 0
    pressures: int = 0
    interceptions: int = 0
    ball_recoveries: int = 0
    possession_sum: float = 0.0
    possession_matches: int = 0


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def to_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def parse_clock_to_abs_minute(clock: str | None, period: int | None, fallback: float) -> float:
    if not clock:
        return fallback

    try:
        minute_str, second_str = clock.split(":", 1)
        minute = int(minute_str)
        second = int(second_str)
    except (ValueError, AttributeError):
        return fallback

    period_offsets = {
        1: 0,
        2: 45,
        3: 90,
        4: 105,
        5: 120,
    }
    base = period_offsets.get(period or 1, 0)
    return base + minute + second / 60.0


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def compute_per_90(value: float, minutes: float) -> float:
    if minutes <= 0:
        return 0.0
    return value * 90.0 / minutes


def is_shot_on_target(outcome_name: str) -> bool:
    lowered = outcome_name.lower()
    if lowered == "goal":
        return True
    return "saved" in lowered and "off" not in lowered


def is_progressive(start_x: float, end_x: float) -> bool:
    delta = end_x - start_x
    if start_x < 60:
        return delta >= 15
    if start_x < 80:
        return delta >= 10
    return delta >= 5


def clean_title(text: str) -> str:
    cleaned = re.sub(r"<[^>]*>", "", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def extract_balanced(text: str, start_index: int, open_char: str, close_char: str) -> tuple[str, int]:
    depth = 0
    in_string = False
    escaped = False

    for idx in range(start_index, len(text)):
        ch = text[idx]

        if escaped:
            escaped = False
            continue

        if ch == "\\":
            escaped = True
            continue

        if ch == '"':
            in_string = not in_string
            continue

        if in_string:
            continue

        if ch == open_char:
            depth += 1
        elif ch == close_char:
            depth -= 1
            if depth == 0:
                return text[start_index : idx + 1], idx + 1

    raise ValueError("Unbalanced JSON block in notebook figure")


def parse_notebook_figure(figure_path: Path) -> dict[str, Any] | None:
    text = figure_path.read_text(encoding="utf-8", errors="ignore")
    marker = "Plotly.newPlot("
    marker_index = text.find(marker)
    if marker_index < 0:
        return None

    cursor = marker_index + len(marker)
    data_start = text.find("[", cursor)
    if data_start < 0:
        return None

    try:
        data_json, after_data = extract_balanced(text, data_start, "[", "]")
    except ValueError:
        return None

    layout_start = text.find("{", after_data)
    if layout_start < 0:
        return None

    try:
        layout_json, _ = extract_balanced(text, layout_start, "{", "}")
    except ValueError:
        return None

    try:
        traces = json.loads(data_json)
        layout = json.loads(layout_json)
    except json.JSONDecodeError:
        return None

    title_obj = layout.get("title")
    title_text = ""
    if isinstance(title_obj, dict):
        title_text = str(title_obj.get("text") or "")
    elif isinstance(title_obj, str):
        title_text = title_obj

    trace_types: list[str] = []
    sample_labels: list[str] = []
    approx_points = 0

    for trace in traces:
        trace_type = str(trace.get("type") or "unknown")
        trace_types.append(trace_type)

        labels = trace.get("labels")
        x_vals = trace.get("x")
        y_vals = trace.get("y")

        if isinstance(labels, list):
            approx_points = max(approx_points, len(labels))
            if not sample_labels:
                sample_labels = [str(label) for label in labels[:8]]
        elif isinstance(x_vals, list):
            approx_points = max(approx_points, len(x_vals))
            if not sample_labels:
                sample_labels = [str(value) for value in x_vals[:8]]
        elif isinstance(y_vals, list):
            approx_points = max(approx_points, len(y_vals))

    return {
        "file": figure_path.name,
        "title": clean_title(title_text) or figure_path.stem,
        "traceCount": len(traces),
        "traceTypes": sorted(set(trace_types)),
        "approxPoints": approx_points,
        "sampleLabels": sample_labels,
    }


def normalize_league_name(competition_name: str) -> str:
    return competition_name.strip()


def looks_like_league(name: str) -> bool:
    lowered = name.lower()

    blocked_terms = [
        "cup",
        "champions",
        "europa",
        "super cup",
        "copa",
        "world",
        "nations",
        "knockout",
        "qualification",
    ]
    if any(term in lowered for term in blocked_terms):
        return False

    league_terms = [
        "league",
        "liga",
        "bundesliga",
        "serie",
        "ligue",
        "eredivisie",
        "premier",
        "division",
        "championship",
        "superliga",
        "pro league",
    ]
    return any(term in lowered for term in league_terms)


def season_sort_key(season_name: str, season_id: int) -> tuple[int, int]:
    year_match = re.search(r"(19|20)\d{2}", season_name)
    if year_match:
        return (int(year_match.group(0)), season_id)
    return (season_id, season_id)


def resolve_statsbomb_data_dir(raw_dir: Path) -> Path:
    pointer_path = raw_dir / "statsbomb_source_path.txt"
    pointer = pointer_path.read_text(encoding="utf-8").strip() if pointer_path.exists() else ""
    if pointer:
        pointer_dir = Path(pointer)
        data_dir = pointer_dir / "data"
        if data_dir.exists():
            return data_dir

    try:
        import kagglehub
    except ImportError as exc:
        raise SystemExit(
            "StatsBomb path is missing. Run `npm run data:download` or install kagglehub."
        ) from exc

    downloaded_path = Path(kagglehub.dataset_download(STATSBOMB_DATASET_HANDLE))
    pointer_path.write_text(str(downloaded_path) + "\n", encoding="utf-8")
    return downloaded_path / "data"


def resolve_notebook_output_dir(raw_dir: Path) -> Path:
    pointer_path = raw_dir / "epl_notebook_output_path.txt"
    pointer = pointer_path.read_text(encoding="utf-8").strip() if pointer_path.exists() else ""
    if pointer:
        pointer_dir = Path(pointer)
        if pointer_dir.exists():
            return pointer_dir

    try:
        import kagglehub
    except ImportError as exc:
        raise SystemExit(
            "Notebook output path is missing. Run `npm run data:download` or install kagglehub."
        ) from exc

    output_path = Path(kagglehub.notebook_output_download(NOTEBOOK_HANDLE))
    pointer_path.write_text(str(output_path) + "\n", encoding="utf-8")
    return output_path


def fetch_analyst_tournament_stats() -> dict[str, Any] | None:
    query = urlencode({"tmcl": ANALYST_TMCL})
    request = Request(
        f"{ANALYST_TOURNAMENT_STATS_URL}?{query}",
        headers={
            "X-SDAPI-Token": ANALYST_TOKEN,
            "User-Agent": "Mozilla/5.0",
        },
    )

    try:
        with urlopen(request, timeout=30, context=ssl._create_unverified_context()) as response:
            payload = json.loads(response.read().decode("utf-8"))
            if isinstance(payload, dict):
                return payload
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"Warning: could not fetch Opta Analyst tournament stats ({exc})")

    return None


def map_from_analyst_player_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    player_root = payload.get("player")
    if not isinstance(player_root, dict):
        return []

    def keyed_rows(category: str, section: str) -> dict[str, dict[str, Any]]:
        category_obj = player_root.get(category)
        if not isinstance(category_obj, dict):
            return {}
        rows = category_obj.get(section)
        if not isinstance(rows, list):
            return {}

        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            key = str(row.get("player_uuid") or "")
            if not key:
                key = str(to_int(row.get("player_id")))
            if not key:
                continue
            result[key] = row
        return result

    attack_overall = keyed_rows("attack", "overall")
    attack_non_pen = keyed_rows("attack", "nonPenalty")
    possession_chance_creation = keyed_rows("possession", "chanceCreation")
    possession_passing = keyed_rows("possession", "passing")
    carries_overall = keyed_rows("carries", "overall")
    defending_overall = keyed_rows("defending", "overall")
    defending_discipline = keyed_rows("defending", "discipline")

    all_keys = {
        *attack_overall.keys(),
        *attack_non_pen.keys(),
        *possession_chance_creation.keys(),
        *possession_passing.keys(),
        *carries_overall.keys(),
        *defending_overall.keys(),
        *defending_discipline.keys(),
    }

    rows: list[dict[str, Any]] = []

    for player_key in all_keys:
        attack_row = attack_overall.get(player_key, {})
        non_pen_row = attack_non_pen.get(player_key, {})
        chance_row = possession_chance_creation.get(player_key, {})
        pass_row = possession_passing.get(player_key, {})
        carry_row = carries_overall.get(player_key, {})
        defend_row = defending_overall.get(player_key, {})
        discipline_row = defending_discipline.get(player_key, {})

        player_id = to_int(
            attack_row.get("player_id")
            or non_pen_row.get("player_id")
            or chance_row.get("player_id")
            or pass_row.get("player_id")
            or carry_row.get("player_id")
            or defend_row.get("player_id")
            or discipline_row.get("player_id")
        )
        if player_id == 0:
            continue

        player_name = str(
            attack_row.get("player")
            or non_pen_row.get("player")
            or chance_row.get("player")
            or pass_row.get("player")
            or carry_row.get("player")
            or defend_row.get("player")
            or discipline_row.get("player")
            or f"Player {player_id}"
        )

        team_id = to_int(
            attack_row.get("team_id")
            or non_pen_row.get("team_id")
            or chance_row.get("team_id")
            or pass_row.get("team_id")
            or carry_row.get("team_id")
            or defend_row.get("team_id")
            or discipline_row.get("team_id")
        )
        team_name = str(
            attack_row.get("contestantName")
            or non_pen_row.get("contestantName")
            or chance_row.get("contestantName")
            or pass_row.get("contestantName")
            or carry_row.get("contestantName")
            or defend_row.get("contestantName")
            or discipline_row.get("contestantName")
            or f"Team {team_id}"
        )

        minutes = to_float(
            attack_row.get("mins_played")
            or chance_row.get("mins_played")
            or pass_row.get("mins_played")
            or carry_row.get("mins_played")
            or defend_row.get("mins_played")
            or discipline_row.get("mins_played")
        )
        if minutes <= 0:
            continue

        appearances = to_int(
            attack_row.get("apps")
            or chance_row.get("apps")
            or pass_row.get("apps")
            or carry_row.get("apps")
            or defend_row.get("apps")
            or discipline_row.get("apps")
        )

        goals = to_int(attack_row.get("goals"))
        assists = to_int(chance_row.get("assists"))
        shots = to_int(attack_row.get("shots"))
        shots_on_target = to_int(attack_row.get("shots_on_target"))
        xg = to_float(attack_row.get("xg"))
        np_goals = to_int(non_pen_row.get("np_goals"))
        npxg = to_float(non_pen_row.get("np_xg"))
        if npxg <= 0:
            npxg = xg
        xa = to_float(chance_row.get("xa"))
        key_passes = to_int(chance_row.get("chances_created") or chance_row.get("op_chances_created"))
        passes_attempted = to_int(pass_row.get("passes"))
        passes_completed = to_int(pass_row.get("successful_passes"))
        progressive_passes = to_int(pass_row.get("successful_final_third_passes"))
        progressive_carries = to_int(carry_row.get("progressive_carries"))
        dribbles_attempted = to_int(carry_row.get("carries"))
        dribbles_completed = to_int(carry_row.get("carries"))
        tackles = to_int(defend_row.get("tackles"))
        interceptions = to_int(defend_row.get("interceptions"))
        ball_recoveries = to_int(defend_row.get("recoveries"))
        yellow_cards = to_int(discipline_row.get("yellows"))
        red_cards = to_int(discipline_row.get("reds"))

        rows.append(
            {
                "seasonId": ANALYST_SEASON_ID,
                "seasonName": ANALYST_SEASON_NAME,
                "playerId": player_id,
                "playerName": player_name,
                "teamId": team_id,
                "teamName": team_name,
                "country": "Unknown",
                "minutes": round(minutes, 1),
                "appearances": appearances,
                "starts": appearances,
                "goals": goals,
                "nonPenaltyGoals": np_goals if np_goals > 0 else goals,
                "assists": assists,
                "shots": shots,
                "shotsOnTarget": shots_on_target,
                "xG": round(xg, 3),
                "npxG": round(npxg, 3),
                "xA": round(xa, 3),
                "keyPasses": key_passes,
                "passesAttempted": passes_attempted,
                "passesCompleted": passes_completed,
                "progressivePasses": progressive_passes,
                "progressiveCarries": progressive_carries,
                "dribblesAttempted": dribbles_attempted,
                "dribblesCompleted": dribbles_completed,
                "pressures": 0,
                "tackles": tackles,
                "interceptions": interceptions,
                "ballRecoveries": ball_recoveries,
                "yellowCards": yellow_cards,
                "redCards": red_cards,
                "goalsPer90": round(compute_per_90(goals, minutes), 3),
                "assistsPer90": round(compute_per_90(assists, minutes), 3),
                "shotsPer90": round(compute_per_90(shots, minutes), 3),
                "shotsOnTargetPer90": round(compute_per_90(shots_on_target, minutes), 3),
                "xGPer90": round(compute_per_90(xg, minutes), 3),
                "npxGPer90": round(compute_per_90(npxg, minutes), 3),
                "xAPer90": round(compute_per_90(xa, minutes), 3),
                "keyPassesPer90": round(compute_per_90(key_passes, minutes), 3),
                "progressivePassesPer90": round(compute_per_90(progressive_passes, minutes), 3),
                "progressiveCarriesPer90": round(compute_per_90(progressive_carries, minutes), 3),
                "dribblesPer90": round(compute_per_90(dribbles_attempted, minutes), 3),
                "pressuresPer90": 0.0,
                "goalMinusXG": round(goals - xg, 3),
                "goalContributionPer90": round(compute_per_90(goals + assists, minutes), 3),
                "passCompletionPct": round(
                    100.0 * passes_completed / passes_attempted,
                    2,
                ) if passes_attempted > 0 else 0.0,
            }
        )

    return rows


def map_from_analyst_team_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    team_root = payload.get("team")
    if not isinstance(team_root, dict):
        return []

    def keyed_rows(category: str, section: str) -> dict[str, dict[str, Any]]:
        category_obj = team_root.get(category)
        if not isinstance(category_obj, dict):
            return {}
        rows = category_obj.get(section)
        if not isinstance(rows, list):
            return {}

        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            key = str(row.get("team_uuid") or "")
            if not key:
                key = str(to_int(row.get("team_id")))
            if not key:
                continue
            result[key] = row
        return result

    attack_overall = keyed_rows("attack", "overall")
    possession_overall = keyed_rows("possession", "overall")
    defending_overall = keyed_rows("defending", "overall")
    sequences_overall = keyed_rows("sequences", "overall")

    all_keys = {
        *attack_overall.keys(),
        *possession_overall.keys(),
        *defending_overall.keys(),
        *sequences_overall.keys(),
    }

    rows: list[dict[str, Any]] = []

    for team_key in all_keys:
        attack_row = attack_overall.get(team_key, {})
        possession_row = possession_overall.get(team_key, {})
        defending_row = defending_overall.get(team_key, {})
        sequence_row = sequences_overall.get(team_key, {})

        team_id = to_int(
            attack_row.get("team_id")
            or possession_row.get("team_id")
            or defending_row.get("team_id")
            or sequence_row.get("team_id")
        )
        if team_id == 0:
            continue

        team_name = str(
            attack_row.get("contestantName")
            or possession_row.get("contestantName")
            or defending_row.get("contestantName")
            or sequence_row.get("contestantName")
            or f"Team {team_id}"
        )

        matches = to_int(
            attack_row.get("played")
            or possession_row.get("played")
            or defending_row.get("played")
            or sequence_row.get("played")
        )
        if matches <= 0:
            continue

        goals_for = to_int(attack_row.get("goals"))
        goals_against = to_int(defending_row.get("goals_against"))
        xg_for = to_float(attack_row.get("xg"))
        xg_against = to_float(defending_row.get("xg_against"))
        shots_for = to_int(attack_row.get("total_shots"))
        shots_against = to_int(defending_row.get("total_shots_against"))
        shots_on_target_for = to_int(attack_row.get("sot"))
        shots_on_target_against = to_int(defending_row.get("sot_against"))
        passes_attempted = to_int(possession_row.get("passes"))
        passes_completed = to_int(possession_row.get("successful_pass"))
        key_passes = to_int(sequence_row.get("direct_attacks"))
        progressive_passes = to_int(possession_row.get("successful_final_third_passes"))
        pressures = to_int(sequence_row.get("pressed_sequences"))
        interceptions = to_int(possession_row.get("interceptions"))
        ball_recoveries = to_int(possession_row.get("rec"))
        possession_pct = to_float(possession_row.get("pos_perc"))

        goal_diff = goals_for - goals_against
        xgd = xg_for - xg_against
        gd_per_match = goal_diff / matches
        xgd_per_match = xgd / matches
        attack_per_match = xg_for / matches if matches else 0.0
        defense_per_match = xg_against / matches if matches else 0.0
        spi_rating = clamp(50.0 + gd_per_match * 10.0 + xgd_per_match * 22.0 + attack_per_match * 4.0 - defense_per_match * 3.0, 0.0, 100.0)

        rows.append(
            {
                "seasonId": ANALYST_SEASON_ID,
                "seasonName": ANALYST_SEASON_NAME,
                "teamId": team_id,
                "teamName": team_name,
                "matches": matches,
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "points": 0,
                "goalsFor": goals_for,
                "goalsAgainst": goals_against,
                "goalDifference": goal_diff,
                "xGFor": round(xg_for, 3),
                "xGAgainst": round(xg_against, 3),
                "npxGFor": round(xg_for, 3),
                "npxGAgainst": round(xg_against, 3),
                "xGD": round(xgd, 3),
                "shotsFor": shots_for,
                "shotsAgainst": shots_against,
                "shotsOnTargetFor": shots_on_target_for,
                "shotsOnTargetAgainst": shots_on_target_against,
                "passesAttempted": passes_attempted,
                "passesCompleted": passes_completed,
                "passCompletionPct": round(
                    100.0 * passes_completed / passes_attempted,
                    2,
                ) if passes_attempted > 0 else 0.0,
                "keyPasses": key_passes,
                "progressivePasses": progressive_passes,
                "progressiveCarries": 0,
                "pressures": pressures,
                "interceptions": interceptions,
                "ballRecoveries": ball_recoveries,
                "possessionPct": round(possession_pct, 2),
                "pointsPerGame": 0.0,
                "xGPerMatch": round(xg_for / matches, 3),
                "xGAPerMatch": round(xg_against / matches, 3),
                "spiRating": round(spi_rating, 2),
            }
        )

    return rows


def main() -> None:
    project_root = Path(__file__).resolve().parent.parent
    raw_dir = project_root / "data" / "raw"
    output_path = project_root / "public" / "data" / "epl-advanced-data.json"

    raw_dir.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    statsbomb_data_dir = resolve_statsbomb_data_dir(raw_dir)
    notebook_output_dir = resolve_notebook_output_dir(raw_dir)

    competitions = load_json(statsbomb_data_dir / "competitions.json")
    competition_lookup: dict[tuple[int, int], dict[str, Any]] = {}
    for row in competitions:
        key = (to_int(row.get("competition_id")), to_int(row.get("season_id")))
        competition_lookup[key] = row

    epl_matches: dict[int, dict[str, Any]] = {}
    epl_team_stats: dict[tuple[int, int], TeamAccumulator] = {}
    epl_player_stats: dict[tuple[int, int], PlayerAccumulator] = {}
    epl_player_team_minutes: dict[tuple[int, int], dict[int, float]] = defaultdict(lambda: defaultdict(float))

    print("Loading EPL matches and scorelines...")
    for season_id in sorted(EPL_SEASON_IDS):
        match_file = statsbomb_data_dir / "matches" / str(EPL_COMPETITION_ID) / f"{season_id}.json"
        if not match_file.exists():
            continue

        matches = load_json(match_file)
        for match in matches:
            match_id = to_int(match.get("match_id"))
            if match_id == 0:
                continue

            season_obj = match.get("season") or {}
            season_name = str(season_obj.get("season_name") or f"Season {season_id}")

            home_team = match.get("home_team") or {}
            away_team = match.get("away_team") or {}

            home_team_id = to_int(home_team.get("home_team_id"))
            away_team_id = to_int(away_team.get("away_team_id"))
            home_team_name = str(home_team.get("home_team_name") or f"Team {home_team_id}")
            away_team_name = str(away_team.get("away_team_name") or f"Team {away_team_id}")

            home_score = to_int(match.get("home_score"))
            away_score = to_int(match.get("away_score"))

            epl_matches[match_id] = {
                "match_id": match_id,
                "season_id": season_id,
                "season_name": season_name,
                "match_date": str(match.get("match_date") or ""),
                "home_team_id": home_team_id,
                "away_team_id": away_team_id,
                "home_team_name": home_team_name,
                "away_team_name": away_team_name,
                "home_score": home_score,
                "away_score": away_score,
            }

            for team_id, team_name in ((home_team_id, home_team_name), (away_team_id, away_team_name)):
                key = (season_id, team_id)
                if key not in epl_team_stats:
                    epl_team_stats[key] = TeamAccumulator(
                        team_id=team_id,
                        team_name=team_name,
                        season_id=season_id,
                        season_name=season_name,
                    )

            home_acc = epl_team_stats[(season_id, home_team_id)]
            away_acc = epl_team_stats[(season_id, away_team_id)]

            home_acc.matches += 1
            away_acc.matches += 1

            home_acc.goals_for += home_score
            home_acc.goals_against += away_score
            away_acc.goals_for += away_score
            away_acc.goals_against += home_score

            if home_score > away_score:
                home_acc.wins += 1
                home_acc.points += 3
                away_acc.losses += 1
            elif away_score > home_score:
                away_acc.wins += 1
                away_acc.points += 3
                home_acc.losses += 1
            else:
                home_acc.draws += 1
                away_acc.draws += 1
                home_acc.points += 1
                away_acc.points += 1

    print(f"EPL matches loaded: {len(epl_matches)}")

    print("Processing EPL events and lineups for advanced metrics...")
    processed_matches = 0

    for match_id, match_info in sorted(epl_matches.items()):
        season_id = match_info["season_id"]
        season_name = match_info["season_name"]

        events_file = statsbomb_data_dir / "events" / f"{match_id}.json"
        lineups_file = statsbomb_data_dir / "lineups" / f"{match_id}.json"

        if not events_file.exists() or not lineups_file.exists():
            continue

        events = load_json(events_file)
        lineups = load_json(lineups_file)

        max_match_minute = 95.0
        if events:
            max_match_minute = max(
                (
                    to_float(event.get("minute")) + to_float(event.get("second")) / 60.0
                    for event in events
                ),
                default=95.0,
            )
            max_match_minute = max(max_match_minute, 90.0)

        player_country_by_id: dict[int, str] = {}

        for team_lineup in lineups:
            team_id = to_int(team_lineup.get("team_id"))
            team_name = str(team_lineup.get("team_name") or f"Team {team_id}")

            team_key = (season_id, team_id)
            if team_key not in epl_team_stats:
                epl_team_stats[team_key] = TeamAccumulator(
                    team_id=team_id,
                    team_name=team_name,
                    season_id=season_id,
                    season_name=season_name,
                )

            for player in team_lineup.get("lineup") or []:
                player_id = to_int(player.get("player_id"))
                if player_id == 0:
                    continue

                player_name = str(player.get("player_name") or f"Player {player_id}")
                country_obj = player.get("country") or {}
                country_name = str(country_obj.get("name") or "Unknown")
                player_country_by_id[player_id] = country_name

                player_key = (season_id, player_id)
                if player_key not in epl_player_stats:
                    epl_player_stats[player_key] = PlayerAccumulator(
                        player_id=player_id,
                        player_name=player_name,
                        country=country_name,
                        season_id=season_id,
                        season_name=season_name,
                    )

                player_acc = epl_player_stats[player_key]

                positions = player.get("positions") or []
                minutes_played = 0.0
                started = False

                for position in positions:
                    from_time = parse_clock_to_abs_minute(
                        position.get("from"),
                        to_int(position.get("from_period")) or 1,
                        0.0,
                    )
                    to_time = parse_clock_to_abs_minute(
                        position.get("to"),
                        to_int(position.get("to_period")) or 2,
                        max_match_minute,
                    ) if position.get("to") else max_match_minute

                    minutes_played += max(0.0, to_time - from_time)

                    if str(position.get("start_reason") or "") == "Starting XI":
                        started = True

                if started:
                    player_acc.starts += 1

                if minutes_played > 0:
                    player_acc.appearances += 1
                    player_acc.minutes += minutes_played
                    epl_player_team_minutes[player_key][team_id] += minutes_played

                cards = player.get("cards") or []
                for card in cards:
                    card_type = str(card.get("card_type") or "").lower()
                    if "yellow" in card_type:
                        player_acc.yellow_cards += 1
                    if "red" in card_type:
                        player_acc.red_cards += 1

        shot_xg_by_event_id: dict[str, float] = {}
        for event in events:
            if (event.get("type") or {}).get("name") != "Shot":
                continue
            event_id = str(event.get("id") or "")
            shot = event.get("shot") or {}
            shot_xg_by_event_id[event_id] = to_float(shot.get("statsbomb_xg"))

        team_possession_events: dict[int, int] = defaultdict(int)
        possession_events_total = 0

        for event in events:
            team_obj = event.get("team") or {}
            team_id = to_int(team_obj.get("id"))
            team_name = str(team_obj.get("name") or f"Team {team_id}")
            team_key = (season_id, team_id)

            if team_key not in epl_team_stats:
                epl_team_stats[team_key] = TeamAccumulator(
                    team_id=team_id,
                    team_name=team_name,
                    season_id=season_id,
                    season_name=season_name,
                )

            team_acc = epl_team_stats[team_key]

            possession_team_obj = event.get("possession_team") or {}
            possession_team_id = to_int(possession_team_obj.get("id"))
            if possession_team_id:
                team_possession_events[possession_team_id] += 1
                possession_events_total += 1

            event_type = (event.get("type") or {}).get("name")

            player_obj = event.get("player") or {}
            player_id = to_int(player_obj.get("id"))
            player_name = str(player_obj.get("name") or f"Player {player_id}")

            player_acc: PlayerAccumulator | None = None
            if player_id:
                player_key = (season_id, player_id)
                if player_key not in epl_player_stats:
                    epl_player_stats[player_key] = PlayerAccumulator(
                        player_id=player_id,
                        player_name=player_name,
                        country=player_country_by_id.get(player_id, "Unknown"),
                        season_id=season_id,
                        season_name=season_name,
                    )
                player_acc = epl_player_stats[player_key]

            if event_type == "Shot":
                shot = event.get("shot") or {}
                xg = to_float(shot.get("statsbomb_xg"))
                shot_type = (shot.get("type") or {}).get("name") or ""
                outcome_name = (shot.get("outcome") or {}).get("name") or ""
                penalty = str(shot_type).lower() == "penalty"

                team_acc.shots_for += 1
                team_acc.xg_for += xg
                if not penalty:
                    team_acc.npxg_for += xg
                if is_shot_on_target(str(outcome_name)):
                    team_acc.shots_on_target_for += 1

                if player_acc is not None:
                    player_acc.shots += 1
                    player_acc.xg += xg
                    if not penalty:
                        player_acc.npxg += xg
                    if is_shot_on_target(str(outcome_name)):
                        player_acc.shots_on_target += 1

                    if str(outcome_name).lower() == "goal":
                        player_acc.goals += 1
                        if not penalty:
                            player_acc.non_penalty_goals += 1

            elif event_type == "Pass":
                pass_data = event.get("pass") or {}
                team_acc.passes_attempted += 1

                pass_outcome = pass_data.get("outcome")
                completed = pass_outcome is None
                if completed:
                    team_acc.passes_completed += 1

                if pass_data.get("shot_assist"):
                    team_acc.key_passes += 1

                location = event.get("location") or [0, 0]
                end_location = pass_data.get("end_location") or [0, 0]
                if (
                    isinstance(location, list)
                    and isinstance(end_location, list)
                    and len(location) >= 1
                    and len(end_location) >= 1
                ):
                    if is_progressive(to_float(location[0]), to_float(end_location[0])):
                        team_acc.progressive_passes += 1

                if player_acc is not None:
                    player_acc.passes_attempted += 1
                    if completed:
                        player_acc.passes_completed += 1

                    if pass_data.get("shot_assist"):
                        player_acc.key_passes += 1
                        assisted_shot_id = str(pass_data.get("assisted_shot_id") or "")
                        if assisted_shot_id:
                            player_acc.xa += shot_xg_by_event_id.get(assisted_shot_id, 0.0)

                    if pass_data.get("goal_assist"):
                        player_acc.assists += 1

                    if (
                        isinstance(location, list)
                        and isinstance(end_location, list)
                        and len(location) >= 1
                        and len(end_location) >= 1
                    ):
                        if is_progressive(to_float(location[0]), to_float(end_location[0])):
                            player_acc.progressive_passes += 1

            elif event_type == "Carry":
                carry_data = event.get("carry") or {}
                location = event.get("location") or [0, 0]
                end_location = carry_data.get("end_location") or [0, 0]

                if (
                    isinstance(location, list)
                    and isinstance(end_location, list)
                    and len(location) >= 1
                    and len(end_location) >= 1
                ):
                    if is_progressive(to_float(location[0]), to_float(end_location[0])):
                        team_acc.progressive_carries += 1
                        if player_acc is not None:
                            player_acc.progressive_carries += 1

            elif event_type == "Dribble":
                if player_acc is not None:
                    player_acc.dribbles_attempted += 1
                    dribble_data = event.get("dribble") or {}
                    outcome_name = str((dribble_data.get("outcome") or {}).get("name") or "")
                    if outcome_name.lower() == "complete":
                        player_acc.dribbles_completed += 1

            elif event_type == "Pressure":
                team_acc.pressures += 1
                if player_acc is not None:
                    player_acc.pressures += 1

            elif event_type == "Duel":
                duel_data = event.get("duel") or {}
                duel_type = str((duel_data.get("type") or {}).get("name") or "")
                if duel_type.lower() == "tackle" and player_acc is not None:
                    player_acc.tackles += 1

            elif event_type == "Interception":
                team_acc.interceptions += 1
                if player_acc is not None:
                    player_acc.interceptions += 1

            elif event_type == "Ball Recovery":
                team_acc.ball_recoveries += 1
                if player_acc is not None:
                    player_acc.ball_recoveries += 1

        if possession_events_total > 0:
            for team_id, event_count in team_possession_events.items():
                team_key = (season_id, team_id)
                if team_key not in epl_team_stats:
                    continue
                team_acc = epl_team_stats[team_key]
                team_acc.possession_sum += event_count / possession_events_total * 100.0
                team_acc.possession_matches += 1

        home_team_key = (season_id, match_info["home_team_id"])
        away_team_key = (season_id, match_info["away_team_id"])

        if home_team_key in epl_team_stats and away_team_key in epl_team_stats:
            home = epl_team_stats[home_team_key]
            away = epl_team_stats[away_team_key]

            home.xg_against += away.xg_for
            away.xg_against += home.xg_for
            home.npxg_against += away.npxg_for
            away.npxg_against += home.npxg_for
            home.shots_against += away.shots_for
            away.shots_against += home.shots_for
            home.shots_on_target_against += away.shots_on_target_for
            away.shots_on_target_against += home.shots_on_target_for

        processed_matches += 1
        if processed_matches % 50 == 0:
            print(f"  - processed {processed_matches} EPL matches")

    print("Building EPL player rows...")
    player_rows: list[dict[str, Any]] = []

    for (season_id, player_id), acc in epl_player_stats.items():
        if acc.minutes <= 0:
            continue

        team_minutes = epl_player_team_minutes[(season_id, player_id)]
        primary_team_id = max(team_minutes, key=team_minutes.get) if team_minutes else 0
        primary_team_name = (
            epl_team_stats[(season_id, primary_team_id)].team_name
            if (season_id, primary_team_id) in epl_team_stats
            else "Unknown"
        )

        row = {
            "seasonId": season_id,
            "seasonName": acc.season_name,
            "playerId": player_id,
            "playerName": acc.player_name,
            "teamId": primary_team_id,
            "teamName": primary_team_name,
            "country": acc.country,
            "minutes": round(acc.minutes, 1),
            "appearances": acc.appearances,
            "starts": acc.starts,
            "goals": acc.goals,
            "nonPenaltyGoals": acc.non_penalty_goals,
            "assists": acc.assists,
            "shots": acc.shots,
            "shotsOnTarget": acc.shots_on_target,
            "xG": round(acc.xg, 3),
            "npxG": round(acc.npxg, 3),
            "xA": round(acc.xa, 3),
            "keyPasses": acc.key_passes,
            "passesAttempted": acc.passes_attempted,
            "passesCompleted": acc.passes_completed,
            "progressivePasses": acc.progressive_passes,
            "progressiveCarries": acc.progressive_carries,
            "dribblesAttempted": acc.dribbles_attempted,
            "dribblesCompleted": acc.dribbles_completed,
            "pressures": acc.pressures,
            "tackles": acc.tackles,
            "interceptions": acc.interceptions,
            "ballRecoveries": acc.ball_recoveries,
            "yellowCards": acc.yellow_cards,
            "redCards": acc.red_cards,
            "goalsPer90": round(compute_per_90(acc.goals, acc.minutes), 3),
            "assistsPer90": round(compute_per_90(acc.assists, acc.minutes), 3),
            "shotsPer90": round(compute_per_90(acc.shots, acc.minutes), 3),
            "shotsOnTargetPer90": round(compute_per_90(acc.shots_on_target, acc.minutes), 3),
            "xGPer90": round(compute_per_90(acc.xg, acc.minutes), 3),
            "npxGPer90": round(compute_per_90(acc.npxg, acc.minutes), 3),
            "xAPer90": round(compute_per_90(acc.xa, acc.minutes), 3),
            "keyPassesPer90": round(compute_per_90(acc.key_passes, acc.minutes), 3),
            "progressivePassesPer90": round(compute_per_90(acc.progressive_passes, acc.minutes), 3),
            "progressiveCarriesPer90": round(compute_per_90(acc.progressive_carries, acc.minutes), 3),
            "dribblesPer90": round(compute_per_90(acc.dribbles_attempted, acc.minutes), 3),
            "pressuresPer90": round(compute_per_90(acc.pressures, acc.minutes), 3),
            "goalMinusXG": round(acc.goals - acc.xg, 3),
            "goalContributionPer90": round(
                compute_per_90(acc.goals + acc.assists, acc.minutes),
                3,
            ),
            "passCompletionPct": round(
                100.0 * acc.passes_completed / acc.passes_attempted,
                2,
            ) if acc.passes_attempted > 0 else 0.0,
        }
        player_rows.append(row)

    player_rows.sort(
        key=lambda row: (
            row["seasonName"],
            row["xG"] + row["xA"],
            row["minutes"],
        ),
        reverse=True,
    )

    print("Building EPL team rows...")
    team_rows: list[dict[str, Any]] = []
    for (_, _), acc in epl_team_stats.items():
        if acc.matches == 0:
            continue

        ppg = acc.points / acc.matches
        gd_per_match = (acc.goals_for - acc.goals_against) / acc.matches
        xgd_per_match = (acc.xg_for - acc.xg_against) / acc.matches if acc.matches else 0.0
        spi_rating = clamp(45.0 + ppg * 16.0 + gd_per_match * 10.0 + xgd_per_match * 18.0, 0.0, 100.0)

        team_rows.append(
            {
                "seasonId": acc.season_id,
                "seasonName": acc.season_name,
                "teamId": acc.team_id,
                "teamName": acc.team_name,
                "matches": acc.matches,
                "wins": acc.wins,
                "draws": acc.draws,
                "losses": acc.losses,
                "points": acc.points,
                "goalsFor": acc.goals_for,
                "goalsAgainst": acc.goals_against,
                "goalDifference": acc.goals_for - acc.goals_against,
                "xGFor": round(acc.xg_for, 3),
                "xGAgainst": round(acc.xg_against, 3),
                "npxGFor": round(acc.npxg_for, 3),
                "npxGAgainst": round(acc.npxg_against, 3),
                "xGD": round(acc.xg_for - acc.xg_against, 3),
                "shotsFor": acc.shots_for,
                "shotsAgainst": acc.shots_against,
                "shotsOnTargetFor": acc.shots_on_target_for,
                "shotsOnTargetAgainst": acc.shots_on_target_against,
                "passesAttempted": acc.passes_attempted,
                "passesCompleted": acc.passes_completed,
                "passCompletionPct": round(
                    100.0 * acc.passes_completed / acc.passes_attempted,
                    2,
                ) if acc.passes_attempted else 0.0,
                "keyPasses": acc.key_passes,
                "progressivePasses": acc.progressive_passes,
                "progressiveCarries": acc.progressive_carries,
                "pressures": acc.pressures,
                "interceptions": acc.interceptions,
                "ballRecoveries": acc.ball_recoveries,
                "possessionPct": round(
                    acc.possession_sum / acc.possession_matches,
                    2,
                ) if acc.possession_matches else 0.0,
                "pointsPerGame": round(ppg, 3),
                "xGPerMatch": round(acc.xg_for / acc.matches, 3),
                "xGAPerMatch": round(acc.xg_against / acc.matches, 3),
                "spiRating": round(spi_rating, 2),
            }
        )

    analyst_player_rows: list[dict[str, Any]] = []
    analyst_team_rows: list[dict[str, Any]] = []
    analyst_payload = fetch_analyst_tournament_stats()
    if analyst_payload is not None:
        print("Merging Opta Analyst EPL tournament stats...")
        analyst_player_rows = map_from_analyst_player_payload(analyst_payload)
        analyst_team_rows = map_from_analyst_team_payload(analyst_payload)
        player_rows.extend(analyst_player_rows)
        team_rows.extend(analyst_team_rows)

    player_rows.sort(
        key=lambda row: (
            row["seasonName"],
            row["xG"] + row["xA"],
            row["minutes"],
        ),
        reverse=True,
    )
    team_rows.sort(key=lambda row: (row["seasonName"], row["spiRating"], row["xGD"]), reverse=True)

    season_filters = sorted(
        {
            (row["seasonId"], row["seasonName"])
            for row in team_rows
        },
        key=lambda item: season_sort_key(item[1], item[0]),
        reverse=True,
    )

    print("Building SPI-style ratings by league...")
    league_team_stats: dict[tuple[str, str], dict[str, Any]] = {}
    league_meta: dict[str, dict[str, Any]] = {}

    matches_root = statsbomb_data_dir / "matches"
    for competition_dir in matches_root.iterdir():
        if not competition_dir.is_dir():
            continue

        competition_id = to_int(competition_dir.name)
        for season_file in competition_dir.glob("*.json"):
            season_id = to_int(season_file.stem)
            competition_meta = competition_lookup.get((competition_id, season_id))
            if not competition_meta:
                continue

            competition_name = str(competition_meta.get("competition_name") or "")
            country_name = str(competition_meta.get("country_name") or "Unknown")
            season_name = str(competition_meta.get("season_name") or season_id)
            gender = str(competition_meta.get("competition_gender") or "")

            if gender and gender.lower() != "male":
                continue
            if not looks_like_league(competition_name):
                continue

            league_key = f"{competition_id}__{season_id}"
            league_meta[league_key] = {
                "competitionId": competition_id,
                "seasonId": season_id,
                "leagueName": normalize_league_name(competition_name),
                "country": country_name,
                "seasonName": season_name,
            }

            matches = load_json(season_file)
            for match in matches:
                home = match.get("home_team") or {}
                away = match.get("away_team") or {}

                home_name = str(home.get("home_team_name") or "Unknown")
                away_name = str(away.get("away_team_name") or "Unknown")

                home_score = to_int(match.get("home_score"))
                away_score = to_int(match.get("away_score"))

                home_key = (league_key, home_name)
                away_key = (league_key, away_name)

                if home_key not in league_team_stats:
                    league_team_stats[home_key] = {
                        "matches": 0,
                        "wins": 0,
                        "draws": 0,
                        "losses": 0,
                        "points": 0,
                        "goalsFor": 0,
                        "goalsAgainst": 0,
                    }
                if away_key not in league_team_stats:
                    league_team_stats[away_key] = {
                        "matches": 0,
                        "wins": 0,
                        "draws": 0,
                        "losses": 0,
                        "points": 0,
                        "goalsFor": 0,
                        "goalsAgainst": 0,
                    }

                home_stats = league_team_stats[home_key]
                away_stats = league_team_stats[away_key]

                home_stats["matches"] += 1
                away_stats["matches"] += 1

                home_stats["goalsFor"] += home_score
                home_stats["goalsAgainst"] += away_score
                away_stats["goalsFor"] += away_score
                away_stats["goalsAgainst"] += home_score

                if home_score > away_score:
                    home_stats["wins"] += 1
                    away_stats["losses"] += 1
                    home_stats["points"] += 3
                elif away_score > home_score:
                    away_stats["wins"] += 1
                    home_stats["losses"] += 1
                    away_stats["points"] += 3
                else:
                    home_stats["draws"] += 1
                    away_stats["draws"] += 1
                    home_stats["points"] += 1
                    away_stats["points"] += 1

    latest_league_keys: set[str] = set()
    by_competition: dict[int, list[str]] = defaultdict(list)

    for league_key, meta in league_meta.items():
        by_competition[meta["competitionId"]].append(league_key)

    for competition_id, league_keys in by_competition.items():
        league_keys.sort(
            key=lambda key: season_sort_key(
                str(league_meta[key]["seasonName"]),
                int(league_meta[key]["seasonId"]),
            ),
            reverse=True,
        )
        latest_league_keys.add(league_keys[0])

    spi_rows: list[dict[str, Any]] = []
    for (league_key, team_name), stats in league_team_stats.items():
        if league_key not in latest_league_keys:
            continue

        matches = stats["matches"]
        if matches < MIN_SPI_MATCHES:
            continue

        goals_for = stats["goalsFor"]
        goals_against = stats["goalsAgainst"]
        points = stats["points"]

        ppg = points / matches
        gd_per_match = (goals_for - goals_against) / matches
        attack = goals_for / matches
        defense = goals_against / matches

        spi_rating = clamp(42.0 + ppg * 18.0 + gd_per_match * 12.0 + (attack - defense) * 8.0, 0.0, 100.0)

        meta = league_meta[league_key]
        spi_rows.append(
            {
                "leagueKey": league_key,
                "competitionId": meta["competitionId"],
                "seasonId": meta["seasonId"],
                "leagueName": meta["leagueName"],
                "country": meta["country"],
                "seasonName": meta["seasonName"],
                "teamName": team_name,
                "matches": matches,
                "wins": stats["wins"],
                "draws": stats["draws"],
                "losses": stats["losses"],
                "points": points,
                "goalsFor": goals_for,
                "goalsAgainst": goals_against,
                "goalDifference": goals_for - goals_against,
                "pointsPerGame": round(ppg, 3),
                "goalDiffPerMatch": round(gd_per_match, 3),
                "attackPerMatch": round(attack, 3),
                "defensePerMatch": round(defense, 3),
                "spiRating": round(spi_rating, 2),
            }
        )

    spi_rows.sort(key=lambda row: (row["leagueName"], row["spiRating"], row["points"]), reverse=True)

    spi_leagues = sorted(
        {
            (row["leagueKey"], row["leagueName"], row["country"], row["seasonName"])
            for row in spi_rows
        },
        key=lambda row: (row[1], row[3]),
    )

    print("Parsing EPL notebook output figure metadata...")
    notebook_figures: list[dict[str, Any]] = []
    figures_dir = notebook_output_dir / "iframe_figures"
    if figures_dir.exists():
        for figure_file in sorted(figures_dir.glob("figure_*.html")):
            parsed = parse_notebook_figure(figure_file)
            if parsed:
                notebook_figures.append(parsed)

    top_players = [
        row
        for row in sorted(
            player_rows,
            key=lambda row: (row["xG"] + row["xA"], row["minutes"]),
            reverse=True,
        )
        if row["minutes"] >= MIN_PLAYER_MINUTES
    ][:200]

    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sources": {
                "statsbomb": {
                    "name": "Kaggle - StatsBomb Football Data",
                    "url": "https://www.kaggle.com/datasets/saurabhshahane/statsbomb-football-data/data",
                    "competitionId": EPL_COMPETITION_ID,
                    "seasonIds": sorted(EPL_SEASON_IDS),
                },
                "eplNotebook": {
                    "name": "Kaggle Notebook - English Premier League Players Statistics",
                    "url": "https://www.kaggle.com/code/desalegngeb/english-premier-league-players-statistics",
                    "outputVersionFigures": len(notebook_figures),
                },
                "analyst": {
                    "name": "Opta Analyst Premier League Stats",
                    "url": "https://theanalyst.com/competition/premier-league/stats",
                    "api": ANALYST_TOURNAMENT_STATS_URL,
                    "tmcl": ANALYST_TMCL,
                    "seasonId": ANALYST_SEASON_ID,
                    "seasonName": ANALYST_SEASON_NAME,
                    "rowsPlayers": len(analyst_player_rows),
                    "rowsTeams": len(analyst_team_rows),
                },
            },
            "rows": {
                "eplMatches": len(epl_matches),
                "eplPlayers": len(player_rows),
                "eplTeams": len(team_rows),
                "spiRows": len(spi_rows),
                "analystPlayers": len(analyst_player_rows),
                "analystTeams": len(analyst_team_rows),
            },
        },
        "filters": {
            "eplSeasons": [
                {
                    "seasonId": season_id,
                    "seasonName": season_name,
                }
                for season_id, season_name in season_filters
            ],
            "spiLeagues": [
                {
                    "leagueKey": key,
                    "leagueName": league,
                    "country": country,
                    "seasonName": season_name,
                }
                for key, league, country, season_name in spi_leagues
            ],
        },
        "epl": {
            "playerRows": player_rows,
            "teamRows": team_rows,
            "topCompareRows": top_players,
        },
        "spiByLeague": spi_rows,
        "notebookInsights": notebook_figures,
    }

    output_path.write_text(json.dumps(payload), encoding="utf-8")
    output_size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Wrote {output_path} ({output_size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
