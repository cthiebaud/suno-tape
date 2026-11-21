const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const status = document.getElementById("status");

function setButtonLabel(btn, baseText, shortcut) {
  btn.textContent = shortcut ? `${baseText} (${shortcut})` : baseText;
}

async function labelButtonsWithShortcuts() {
  const commands = await chrome.commands.getAll();
  const byName = Object.fromEntries(commands.map((c) => [c.name, c.shortcut]));
  setButtonLabel(startBtn, "Start recording", byName["start-recording"]);
  setButtonLabel(stopBtn, "Stop recording", byName["stop-recording"]);
}

function render(recording, trackName) {
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
  if (recording) {
    status.textContent = trackName ? `Recording "${trackName}"...` : "Recording...";
  } else {
    status.textContent = "Open a suno.com share page, then click Start.";
  }
}

async function refreshStatus() {
  const s = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  render(s.recording, s.trackName);
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  status.textContent = "Starting...";
  try {
    const result = await chrome.runtime.sendMessage({ type: "POPUP_START" });
    if (result.ok) {
      render(true, result.trackName);
    } else {
      status.textContent = `Error: ${result.error}`;
      startBtn.disabled = false;
    }
  } catch (e) {
    status.textContent = `Error: ${e}`;
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "POPUP_STOP" });
    if (result.ok) {
      render(false);
      status.textContent = "Stopped -- saving to Downloads...";
    } else {
      status.textContent = `Error: ${result.error}`;
      stopBtn.disabled = false;
    }
  } catch (e) {
    status.textContent = `Error: ${e}`;
    stopBtn.disabled = false;
  }
});

labelButtonsWithShortcuts();
refreshStatus();
