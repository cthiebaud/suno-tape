"""Core capture logic: drive a Suno share page and record its authorized
playback via an OS audio loopback device (e.g. BlackHole on macOS).

This never touches Suno's encrypted stream -- the page is loaded like any
visitor would, play is clicked like any visitor would, and what's recorded
is the operating system's actual audio output. It is exactly the
Blackhole-into-Audacity workflow, automated end to end.
"""

from __future__ import annotations

import re
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

from .auth import DEFAULT_AUTH_PATH

PLAY_BUTTON_SELECTOR = "button[aria-label='Playbar: Play button']"

# Best-effort DOM scraping, not a documented Suno API: if Suno reshuffles
# its player markup this stops finding the button/time labels and needs
# updating. There is no public API for any of this -- see README.
TIME_NODE_SCRIPT = """() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while (n = walker.nextNode()) {
        const t = n.textContent.trim();
        if (/^\\d+:\\d{2}$/.test(t)) out.push(t);
    }
    return out;
}"""


def _parse_mmss(text: str) -> float:
    m = re.match(r"(\d+):(\d{2})$", text.strip())
    if not m:
        raise ValueError(f"not a mm:ss time: {text!r}")
    minutes, seconds = m.groups()
    return int(minutes) * 60 + int(seconds)


@contextmanager
def switched_output_device(device_name: str):
    """Temporarily switch the system's default audio OUTPUT device,
    restoring the original one on exit -- even on error or Ctrl-C."""
    original = subprocess.run(
        ["SwitchAudioSource", "-c"], capture_output=True, text=True, check=True
    ).stdout.strip()
    subprocess.run(["SwitchAudioSource", "-s", device_name], check=True)
    try:
        yield
    finally:
        subprocess.run(["SwitchAudioSource", "-s", original], check=True)


def _start_recording(input_device: str, out_path: Path, max_seconds: float) -> subprocess.Popen:
    cmd = [
        "ffmpeg", "-y",
        "-f", "avfoundation", "-i", f"none:{input_device}",
        "-t", f"{max_seconds:.2f}",
        "-loglevel", "error",
        str(out_path),
    ]
    return subprocess.Popen(cmd)


def _stop_recording(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def _dismiss_any_modal(page) -> None:
    """Best-effort: close the logged-out signup modal, or a mid-playback
    "log in to keep listening" interruption, if either is showing. A no-op
    if neither is present -- safe to call speculatively at any time."""
    try:
        page.get_by_role("button", name="Close").first.click(timeout=1500)
        print("dismissed a modal", file=sys.stderr)
    except Exception:
        pass


def _read_total_duration(page) -> float:
    """The playbar shows 'elapsed / total' as two mm:ss text nodes; the
    last one on the page is the total duration."""
    labels = page.evaluate(TIME_NODE_SCRIPT)
    if not labels:
        raise RuntimeError(
            "could not find a mm:ss duration label on the page -- "
            "Suno's player markup may have changed, see README"
        )
    return _parse_mmss(labels[-1])


def _trim_to_content(raw_path: Path, out_path: Path, duration: float, threshold_db: float = -50.0) -> None:
    """Strip the lead-in silence before playback actually started (click
    latency varies run to run), then cut exactly `duration` seconds from
    there -- the track's own real length, known from the page."""
    detect = subprocess.run(
        [
            "ffmpeg", "-i", str(raw_path),
            "-af", f"silencedetect=noise={threshold_db}dB:d=0.1",
            "-f", "null", "-",
        ],
        capture_output=True, text=True,
    )
    match = re.search(r"silence_end: ([\d.]+)", detect.stderr)
    start = float(match.group(1)) if match else 0.0
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(raw_path),
            "-ss", f"{start:.2f}", "-t", f"{duration:.2f}",
            "-ar", "48000",
            str(out_path),
        ],
        check=True, capture_output=True,
    )


def capture(
    share_url: str,
    out_wav: Path,
    *,
    output_device: str = "BlackHole + Steinberg",
    input_device: str = "BlackHole 2ch",
    auth_path: Path = DEFAULT_AUTH_PATH,
    tail_padding: float = 2.0,
) -> Path:
    """Record the audio a Suno share page plays, via an OS audio loopback.

    Requires a loopback device (BlackHole) and an output device that feeds
    it while still letting you hear it (a macOS Multi-Output Device
    combining BlackHole with your real output) -- see README for setup.
    """
    out_wav = Path(out_wav)
    raw_path = out_wav.with_suffix(".raw.wav")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False, args=["--autoplay-policy=no-user-gesture-required"]
        )
        context_kwargs = {}
        if Path(auth_path).exists():
            context_kwargs["storage_state"] = str(auth_path)
        else:
            print(
                f"no saved login at {auth_path} -- running logged out "
                f"(run `suno-tape login` first to avoid listening limits)",
                file=sys.stderr,
            )
        context = browser.new_context(**context_kwargs)
        page = context.new_page()
        page.goto(share_url, wait_until="networkidle", timeout=30000)
        _dismiss_any_modal(page)
        page.wait_for_timeout(500)

        duration = _read_total_duration(page)
        print(f"track duration: {duration:.0f}s", file=sys.stderr)

        with switched_output_device(output_device):
            proc = _start_recording(input_device, raw_path, duration + tail_padding + 10)
            time.sleep(1)  # let ffmpeg actually open the device before playback starts
            page.locator(PLAY_BUTTON_SELECTOR).first.click(timeout=8000)
            print("playback started", file=sys.stderr)

            deadline = time.monotonic() + duration + tail_padding
            while time.monotonic() < deadline:
                time.sleep(1)
                _dismiss_any_modal(page)  # in case of a mid-playback interruption

            _stop_recording(proc)

        browser.close()

    _trim_to_content(raw_path, out_wav, duration)
    raw_path.unlink(missing_ok=True)
    return out_wav
