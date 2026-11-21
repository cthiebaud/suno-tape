# suno-tape

Records a [Suno](https://suno.com) track's own authorized playback to a
file, via a Chrome extension. Like dubbing a radio broadcast to tape,
automated.

## Why this exists, and what it deliberately does not do

Suno encrypts its audio stream in transit; the player decrypts it
client-side before playback. There is no way to download a clean file by
intercepting the network request, and this project does not try to --
that would mean reverse-engineering Suno's content protection, which is
out of scope on principle, not just difficulty.

What *is* legitimate: recording the audio after it's been decrypted and
is already playing, the same way a tape recorder next to a speaker would.
That's what this extension automates -- it uses `chrome.tabCapture` to
grab the active tab's already-decoded audio directly, inside your own
browser, already signed into your own Suno account. Nothing here touches
or bypasses Suno's protection.

## Install

Unpacked, for now -- not published to the Chrome Web Store:

1. `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
   select the `extension/` folder.
2. Open a `suno.com` share or song page in a normal tab.
3. Click the extension's toolbar icon, or press its keyboard shortcut.

## Usage

- **Start recording**: the toolbar popup's button, or `Cmd+Shift+S` /
  `Ctrl+Shift+S` (configurable at `chrome://extensions/shortcuts`).
  Clicks play on the page and starts recording.
- **Stop recording**: the popup's button (only enabled while recording),
  or `Cmd+Shift+X` / `Ctrl+Shift+X`. Stops the capture directly --
  independent of whatever the page's own player is doing.
- Recording also stops on its own when the track's real `<audio>`/`<video>`
  element fires `ended` or `pause` -- so just pausing/stopping playback in
  Suno's own UI works too, no shortcut needed.
- The popup shows live status (idle / recording which track) and reflects
  whatever shortcuts are actually configured, so it stays correct even if
  you remap them.

A `.webm` file (320kbps opus), named after the track, lands in your
Downloads folder when a capture finishes. Convert to wav if needed:
`ffmpeg -i "<track name>-*.webm" out.wav`.

## How it works

1. `background.js` gets a `chrome.tabCapture` stream id for the active tab.
2. It spins up a hidden *offscreen document* (required in Manifest V3 --
   the background service worker itself can't call `getUserMedia`/
   `MediaRecorder`) and tells `content.js` (injected into the Suno page)
   to click play.
3. `content.js` finds the real `<audio>`/`<video>` element (filtering out
   a short "sil-*" silence placeholder Suno preloads alongside it), reads
   the track's name and duration from the page, and reports back once
   that element fires `ended` or `pause`.
4. `offscreen.js` records the tab's audio stream with `MediaRecorder` the
   whole time, and also routes it back to your speakers (capturing a tab
   silences it by default otherwise).
5. On stop, the recorded blob is handed back to `background.js` as a data
   URL -- `chrome.downloads` isn't available inside an offscreen document,
   so this is the one API call that *must* happen in the background
   script -- which saves it to Downloads, named `<track name>-<timestamp>.webm`.

## Known limitations

- **Real-time only.** This is a recording, not a download -- a 4-minute
  track takes 4 minutes.
- **Chrome (or Chromium-based) only**, by nature of using
  `chrome.tabCapture`.
- **DOM-dependent.** The play button, duration, and track name are found
  by best-effort DOM scraping (there's no public Suno API for any of
  this); if Suno reshuffles their player markup, `extension/content.js`'s
  selectors need updating.

## Debugging

If a capture produces no download, check (in this order):
- the service worker console (`chrome://extensions` → *service worker*
  link -- surfaces errors from `background.js`)
- the offscreen document's console (same page, under "Inspect views" --
  surfaces `getUserMedia`/`MediaRecorder` errors from `offscreen.js`)
- the Suno tab's own console (`content.js` errors)

After editing any file under `extension/`: reload the extension (the
circular reload icon on its card at `chrome://extensions`) *and* refresh
any already-open Suno tab -- content scripts are only (re-)injected on
page load, so an existing tab keeps running the old `content.js` until
refreshed. A crash mid-capture can also leave Chrome thinking a tab still
has "an active stream"; refreshing that tab clears it.
