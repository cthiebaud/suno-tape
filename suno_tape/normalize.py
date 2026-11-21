"""Loudness normalization, replacing the manual Audacity step."""

import subprocess
from pathlib import Path


def normalize(wav_path: Path, target_lufs: float = -16.0) -> None:
    """Single-pass ffmpeg loudnorm to `target_lufs`, in place."""
    wav_path = Path(wav_path)
    tmp = wav_path.with_suffix(".normalized.wav")
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(wav_path),
            "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
            str(tmp),
        ],
        check=True, capture_output=True,
    )
    tmp.replace(wav_path)
