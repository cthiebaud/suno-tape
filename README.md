# suno-tape

Records the audio a public [Suno](https://suno.com) share page plays, by
driving a real browser and capturing the operating system's actual audio
output through a loopback device. Like dubbing a radio broadcast to tape,
automated.

## Why this exists, and what it deliberately does not do

Suno encrypts its audio stream in transit; the player decrypts it
client-side before playback. There is no way to download a clean file by
intercepting the network request, and this project does not try to --
that would mean reverse-engineering Suno's content protection, which is
out of scope on principle, not just difficulty.

What *is* legitimate: recording the audio after it's been decrypted and
is already playing, the same way a tape recorder next to a speaker would.
That's what this tool automates -- it opens the share page like any
visitor, clicks play like any visitor, and records what the OS actually
outputs. Nothing here touches or bypasses Suno's protection.

## Requirements

- macOS (uses `avfoundation` for audio capture and `SwitchAudioSource` for
  device switching; no Linux/Windows support yet)
- [BlackHole](https://github.com/ExistentialAudio/BlackHole) (2ch), a free
  virtual audio loopback driver: `brew install blackhole-2ch`
- A **Multi-Output Device** combining BlackHole with your real output, so
  you can still hear playback while it's captured. Set this up once in
  **Audio MIDI Setup** (Applications/Utilities): the `+` button in the
  bottom left → *Create Multi-Output Device* → check both BlackHole 2ch
  and your normal output. Name it something you'll recognize (the default
  config below expects a device whose name contains "BlackHole").
- `brew install switchaudio-osx` (programmatic default-output switching)
- `ffmpeg`
- Python 3.9+, then:
  ```
  pip install -e .
  playwright install chromium
  ```

## Setup

Log in once, so captures run already authenticated (this avoids Suno's
anonymous-listening interruption, and the logged-out signup modal on
share pages):

```
suno-tape login
```

A real browser window opens. Log in to your own Suno account there, the
same way you always do, then come back to the terminal and press Enter.
Your session is saved to `~/.suno-tape/auth.json` -- re-run `login`
whenever it expires.

## Usage

```
suno-tape capture https://suno.com/s/XXXXXXXX out.wav
```

Options:
- `--output-device NAME` -- the system output device to switch to while
  recording (default: `BlackHole + Steinberg` -- change to match your own
  Multi-Output Device's name)
- `--input-device NAME` -- the `ffmpeg`/`avfoundation` input to record
  from (default: `BlackHole 2ch`)
- `--normalize` -- apply loudness normalization (`ffmpeg loudnorm`,
  -16 LUFS) after capture
- `--auth-path PATH` -- use a saved login from somewhere other than the
  default

The track's duration is read directly from the page, so the recording is
trimmed to exactly its real length (lead-in click latency is stripped
automatically via silence detection).

## How it works

1. Remember the current default audio output device.
2. Switch the default output to your Multi-Output Device (so playback
   feeds both BlackHole and your speakers).
3. Start `ffmpeg` recording from the BlackHole input.
4. Open the share page in a real (non-headless -- headless Chromium has
   no real audio sink) browser, dismiss any modal, read the track's
   duration, click the actual play button.
5. Wait for the track's real length, periodically dismissing any
   mid-playback interruption.
6. Stop the recording and restore the original output device.
7. Trim lead-in silence and cut to the track's exact duration.

## Known limitations

- **Real-time only.** This is a recording, not a download -- a 4-minute
  track takes 4 minutes.
- **macOS only**, for now (the audio-device plumbing is Core
  Audio/`avfoundation`-specific).
- **DOM-dependent.** The play button and duration are found by best-effort
  DOM scraping (there's no public Suno API for this); if Suno reshuffles
  their player markup, `suno_tape/capture.py`'s selectors need updating.
- **Anonymous listening is capped.** Without a logged-in session, Suno
  interrupts playback partway through with a "sign up to keep listening"
  wall, truncating the capture. `suno-tape login` is meant to fix this,
  but in testing the saved Playwright session still hit the wall -- not
  yet resolved for this CLI version. See `extension/` for the approach
  that sidesteps it entirely, by running inside your actual already-signed-in
  Chrome profile instead of a separate automated browser.

## extension/ -- the Chrome extension version

A second, architecturally different approach, in `extension/`: a Chrome
extension using `chrome.tabCapture` to grab the active tab's *decoded*
audio directly -- no virtual audio device, no macOS dependency, and no
separate login flow, since it runs inside your actual Chrome, already
signed into Suno however you normally are.

**Install (unpacked, for now -- not published to the Chrome Web Store):**
1. `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
   select the `extension/` folder.
2. Open a `suno.com` share page in a normal tab.
3. Press the shortcut (default `Cmd+Shift+S` on macOS, `Ctrl+Shift+S`
   elsewhere -- configurable at `chrome://extensions/shortcuts`), or click
   the extension's toolbar icon and press *Start recording*.
4. The extension clicks play and records until playback actually stops --
   listening to the real `<audio>`/`<video>` element's own `ended`/`pause`
   events, not a guessed timer -- then saves a `.webm` file to your
   Downloads folder.

Convert to wav afterward if needed: `ffmpeg -i suno-tape-*.webm out.wav`.

After editing any file under `extension/`: reload the extension at
`chrome://extensions` (the circular reload icon on its card) *and* refresh
any already-open Suno tab -- content scripts are only (re-)injected on
page load, so an existing tab keeps running the old `content.js` until
refreshed.

Verified end to end: keyboard shortcut → play → event-driven stop →
offscreen capture → background download, landing a `.webm` in Downloads.

One real gotcha hit along the way, worth knowing about: **`chrome.downloads`
is not available inside an offscreen document.** The capture itself has to
happen there (MV3 forbids `getUserMedia`/`MediaRecorder` in the service
worker), but the recorded blob is handed back to `background.js` -- which
has full API access -- as a data URL (`RECORDING_COMPLETE` message), and
*that's* what actually calls `chrome.downloads.download()`. If you're
debugging a future change here and see "Cannot read properties of
undefined (reading 'download')" in the offscreen console, this is why.

If a capture ever produces no download, check (in this order): the
service worker console (`chrome://extensions` → *service worker* link --
surfaces errors from `background.js`), the offscreen document's console
(same page -- surfaces `getUserMedia`/`MediaRecorder` errors from
`offscreen.js`), and the Suno tab's own console (`content.js` errors).
After editing any file under `extension/`, both reload the extension
*and* refresh any already-open Suno tab -- a crash mid-capture can also
leave Chrome thinking the tab still has "an active stream"; refreshing
the tab clears that.
