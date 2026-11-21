// Lives in the hidden offscreen document (MV3 requires this -- the
// background service worker itself can't call getUserMedia/MediaRecorder).
// Captures the tab's audio stream, records it, and saves the result.

let recorder = null;
let chunks = [];
let audioContext = null;

async function beginRecording(streamId) {
  console.log("suno-tape offscreen: beginRecording", streamId);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });
  console.log("suno-tape offscreen: got stream", stream.getAudioTracks());

  // Capturing a tab's audio silences it by default; route it back out so
  // you can still hear what's being recorded.
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(audioContext.destination);

  chunks = [];
  recorder = new MediaRecorder(stream, {
    mimeType: "audio/webm;codecs=opus",
    audioBitsPerSecond: 320000,
  });

  recorder.ondataavailable = (e) => {
    console.log("suno-tape offscreen: ondataavailable", e.data.size, "bytes");
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onerror = (e) => {
    console.error("suno-tape offscreen: MediaRecorder error", e.error || e);
  };

  recorder.onstop = async () => {
    console.log("suno-tape offscreen: onstop, chunks:", chunks.length,
                "total bytes:", chunks.reduce((n, c) => n + c.size, 0));
    try {
      const blob = new Blob(chunks, { type: "audio/webm" });
      // chrome.downloads isn't available inside an offscreen document --
      // hand the data back to the background service worker, which has
      // full API access, to actually trigger the download.
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      console.log("suno-tape offscreen: sending RECORDING_COMPLETE,",
                  dataUrl.length, "chars");
      // filename (track name + timestamp) is decided by background.js,
      // which knows the track name and has access to chrome.downloads.
      chrome.runtime.sendMessage({ type: "RECORDING_COMPLETE", dataUrl });
    } catch (err) {
      console.error("suno-tape offscreen: failed to package recording", err);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
      audioContext.close();
    }
  };

  recorder.start();
  console.log("suno-tape offscreen: recorder.start() called, state =", recorder.state);
}

function stopRecording() {
  console.log("suno-tape offscreen: stopRecording, recorder =",
              recorder && recorder.state);
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  } else {
    console.warn("suno-tape offscreen: stopRecording called but no active recorder");
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "BEGIN_RECORDING") {
    beginRecording(msg.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("suno-tape offscreen: beginRecording failed", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // async sendResponse
  }
  if (msg.type === "STOP_RECORDING") {
    stopRecording();
  }
});
