#!/usr/bin/env python3
"""Download Kaggle football datasets and prepare local data pointers."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

PLAYER_SCORES_DATASET = "davidcariboo/player-scores"
STATSBOMB_DATASET = "saurabhshahane/statsbomb-football-data"
EPL_NOTEBOOK_HANDLE = "desalegngeb/english-premier-league-players-statistics"

PLAYER_SCORES_FILES = [
    "appearances.csv",
    "games.csv",
    "players.csv",
    "competitions.csv",
    "clubs.csv",
    "player_valuations.csv",
]


def copy_player_scores_files(source_dir: Path, target_dir: Path) -> None:
    copied: list[str] = []
    missing: list[str] = []

    for file_name in PLAYER_SCORES_FILES:
        src = source_dir / file_name
        dst = target_dir / file_name
        if not src.exists():
            missing.append(file_name)
            continue
        shutil.copy2(src, dst)
        copied.append(file_name)

    if copied:
        print("Copied player-scores files:")
        for file_name in copied:
            print(f"  - {file_name}")

    if missing:
        print("Missing player-scores files:")
        for file_name in missing:
            print(f"  - {file_name}")

    if not copied:
        raise SystemExit("No player-scores files copied. Check dataset availability and retry.")


def write_pointer(pointer_path: Path, value: str) -> None:
    pointer_path.parent.mkdir(parents=True, exist_ok=True)
    pointer_path.write_text(value.strip() + "\n", encoding="utf-8")


def main() -> None:
    try:
        import kagglehub
    except ImportError as exc:
        raise SystemExit(
            "kagglehub is required. Install it with: python3 -m pip install kagglehub"
        ) from exc

    project_root = Path(__file__).resolve().parent.parent
    target_dir = project_root / "data" / "raw"
    target_dir.mkdir(parents=True, exist_ok=True)

    print(f"Downloading dataset: {PLAYER_SCORES_DATASET}")
    player_scores_path = Path(kagglehub.dataset_download(PLAYER_SCORES_DATASET))
    print(f"Player-scores cache path: {player_scores_path}")
    copy_player_scores_files(player_scores_path, target_dir)

    print(f"Downloading dataset: {STATSBOMB_DATASET}")
    statsbomb_path = Path(kagglehub.dataset_download(STATSBOMB_DATASET))
    print(f"StatsBomb cache path: {statsbomb_path}")
    write_pointer(target_dir / "statsbomb_source_path.txt", str(statsbomb_path))

    print(f"Downloading notebook output: {EPL_NOTEBOOK_HANDLE}")
    notebook_output_path = Path(kagglehub.notebook_output_download(EPL_NOTEBOOK_HANDLE))
    print(f"EPL notebook output cache path: {notebook_output_path}")
    write_pointer(target_dir / "epl_notebook_output_path.txt", str(notebook_output_path))

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "player_scores_dataset": PLAYER_SCORES_DATASET,
        "player_scores_path": str(player_scores_path),
        "statsbomb_dataset": STATSBOMB_DATASET,
        "statsbomb_path": str(statsbomb_path),
        "epl_notebook_handle": EPL_NOTEBOOK_HANDLE,
        "epl_notebook_output_path": str(notebook_output_path),
    }
    (target_dir / "sources_manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )

    print(f"Data pointers written in: {target_dir}")


if __name__ == "__main__":
    main()
