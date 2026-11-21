// Runs on suno.com pages. Finds and clicks the real play control, and
// reports when playback actually stops (naturally ending, or the user
// pausing/stopping it) by listening to the real <audio>/<video> element's
// own 'ended'/'pause' events -- not a guessed timer. Best-effort DOM
// scraping throughout, since there's no public Suno API for any of this.

const PLAY_BUTTON_SELECTOR = "button[aria-label='Playbar: Play button']";

function readTimeLikeTextNodes() {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim();
    if (/^\d+:\d{2}$/.test(t)) out.push(t);
  }
  return out;
}

function parseMmSs(text) {
  const m = /^(\d+):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function dismissAnyModal() {
  const buttons = Array.from(document.querySelectorAll("button"));
  const closeBtn = buttons.find(
    (b) => (b.getAttribute("aria-label") || "").toLowerCase() === "close"
  );
  if (closeBtn) {
    closeBtn.click();
    return true;
  }
  return false;
}

function getDurationSeconds() {
  const labels = readTimeLikeTextNodes();
  if (labels.length === 0) return null;
  return parseMmSs(labels[labels.length - 1]);
}

function getTrackName() {
  // Suno's <title> is "<track name> by <user> | Suno" on share/song pages.
  const m = /^(.*) by .+ \| Suno$/.exec(document.title);
  return (m ? m[1] : document.title).trim();
}

function clickPlay() {
  const btn = document.querySelector(PLAY_BUTTON_SELECTOR);
  if (!btn) return false;
  btn.click();
  return true;
}

function findRealMediaElement() {
  // Suno preloads a short "sil-*" silence placeholder alongside the real
  // player; the real element has no fixed currentSrc until its
  // MediaSource attaches. Exclude the decoy, take whatever's left.
  const els = Array.from(document.querySelectorAll("audio, video"));
  return els.find((el) => !(el.currentSrc || "").includes("sil-")) || null;
}

// Reports exactly once, however playback stopped.
function reportWhenPlaybackStops(mediaEl) {
  console.log("suno-tape content: watching media element, loop =", mediaEl.loop,
              "duration =", mediaEl.duration);

  let reported = false;
  const report = (reason) => {
    if (reported) return;
    reported = true;
    mediaEl.removeEventListener("ended", onEnded);
    mediaEl.removeEventListener("pause", onPause);
    clearInterval(pollId);
    console.log("suno-tape content: reporting PLAYBACK_STOPPED,", reason);
    chrome.runtime.sendMessage({ type: "PLAYBACK_STOPPED", reason });
  };
  const onEnded = () => report("ended");
  const onPause = () => report("paused");
  mediaEl.addEventListener("ended", onEnded);
  mediaEl.addEventListener("pause", onPause);

  // Backstop: some players never fire a real 'ended' event at natural
  // completion (e.g. a looping underlying element, or MediaSource quirks
  // that skip the standard end-of-stream signal) -- poll the actual
  // playback position directly too.
  const pollId = setInterval(() => {
    if (Number.isFinite(mediaEl.duration) && mediaEl.duration > 0 &&
        mediaEl.currentTime >= mediaEl.duration - 0.25) {
      report("ended (polled)");
    }
  }, 500);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "START_PLAYBACK") {
    dismissAnyModal();
    setTimeout(() => {
      dismissAnyModal();
      const duration = getDurationSeconds();
      const trackName = getTrackName();
      const mediaEl = findRealMediaElement();
      if (mediaEl) reportWhenPlaybackStops(mediaEl);
      const clicked = clickPlay();
      sendResponse({ clicked, duration, trackName, hasMediaElement: !!mediaEl });
    }, 300);
    return true; // async sendResponse
  }
});

// Defensively dismiss any mid-playback "sign up to keep listening" wall
// that might appear despite being logged in.
setInterval(dismissAnyModal, 2000);
