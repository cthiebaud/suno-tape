// Orchestrates one capture: gets a MediaStream id for the active tab,
// spins up the offscreen document (required in MV3 -- service workers
// can't call getUserMedia/MediaRecorder themselves), tells the content
// script to click play, and stops recording when the content script
// reports that playback actually stopped (ended, or paused/stopped by
// hand) -- not on a guessed timer.

const STOP_TAIL_MS = 500; // small buffer to catch a trailing reverb tail

let activeCaptureTabId = null;
let activeTrackName = null;

function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|]/g, "_").trim() || "suno-tape";
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record the active tab's audio to a file.",
  });
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function startCapture(tabId) {
  if (activeCaptureTabId !== null) {
    throw new Error(`already recording tab ${activeCaptureTabId}`);
  }

  await ensureOffscreenDocument();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  const playResult = await chrome.tabs.sendMessage(tabId, { type: "START_PLAYBACK" });
  if (!playResult || !playResult.clicked) {
    throw new Error(
      "could not find/click the play button -- Suno's page markup may " +
      "have changed, see extension/content.js"
    );
  }
  if (!playResult.hasMediaElement) {
    throw new Error(
      "could not find the real <audio>/<video> element on the page -- " +
      "won't know when playback stops, see extension/content.js"
    );
  }

  const beginResult = await chrome.runtime.sendMessage({ type: "BEGIN_RECORDING", streamId });
  if (!beginResult || !beginResult.ok) {
    throw new Error(`recording failed to start: ${beginResult && beginResult.error}`);
  }

  activeCaptureTabId = tabId;
  activeTrackName = playResult.trackName || null;
  setBadge("REC", "#d33");
  return { duration: playResult.duration, trackName: activeTrackName };
}

function finishCapture() {
  console.log("suno-tape background: sending STOP_RECORDING");
  chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
  activeCaptureTabId = null;
  setBadge("", null);
}

async function startCaptureOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return startCapture(tab.id);
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "stop-recording") {
    if (activeCaptureTabId === null) {
      console.log("suno-tape: stop-recording pressed, but nothing is recording");
      return;
    }
    finishCapture();
    return;
  }
  if (command !== "start-recording") return;
  startCaptureOnActiveTab().catch((err) => {
    setBadge("ERR", "#d33");
    console.error("suno-tape:", err);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "POPUP_START") {
    startCaptureOnActiveTab()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async sendResponse
  }

  if (msg.type === "POPUP_STOP") {
    if (activeCaptureTabId === null) {
      sendResponse({ ok: false, error: "not recording" });
    } else {
      finishCapture();
      sendResponse({ ok: true });
    }
    return;
  }

  if (msg.type === "GET_STATUS") {
    sendResponse({ recording: activeCaptureTabId !== null, trackName: activeTrackName });
    return;
  }

  if (msg.type === "PLAYBACK_STOPPED") {
    // from the content script, once the real media element fires
    // 'ended' or 'pause' -- only act on it for the tab we're recording.
    if (sender.tab && sender.tab.id === activeCaptureTabId) {
      console.log(`suno-tape: playback ${msg.reason}, stopping recording`);
      setTimeout(finishCapture, STOP_TAIL_MS);
    }
  }

  if (msg.type === "RECORDING_COMPLETE") {
    // from the offscreen document, which can't call chrome.downloads itself.
    const base = sanitizeFilename(activeTrackName || "suno-tape");
    const filename = `${base}-${Date.now()}.webm`;
    activeTrackName = null;
    chrome.downloads.download({ url: msg.dataUrl, filename })
      .then((downloadId) => console.log("suno-tape: download started, id =", downloadId))
      .catch((err) => console.error("suno-tape: download failed", err));
  }
});
