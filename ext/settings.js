// Shared by popup.html and options.html: detection setting, access status, activity log.
const ALL_SITES = { origins: ["<all_urls>"] };

const MODE_TEXT = {
  "off": "Only right-click downloads are locked.",
  "ask-docs": "Downloads of documents & images pause and ask whether to lock them.",
  "ask-all": "Every download pauses and asks whether to lock it."
};

async function readSettings() {
  const s = await chrome.storage.local.get(["mode", "neverAsk", "log", "protectAll"]);
  return { mode: s.mode || (s.protectAll ? "ask-all" : "off"), neverAsk: s.neverAsk || [], log: s.log || [],
    granted: await chrome.permissions.contains(ALL_SITES) };
}

// Save FIRST. Asking Chrome for access can close the toolbar popup (especially on macOS),
// so the choice must already be stored by then.
async function saveMode(mode) {
  await chrome.storage.local.set({ mode, protectAll: false });
}

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : new Date(t).toLocaleString();
}

function renderLog(ul, log) {
  ul.textContent = "";
  if (!log.length) { const li = document.createElement("li"); li.className = "hint"; li.textContent = "No downloads seen yet."; ul.append(li); return; }
  for (const e of log.slice(0, 8)) {
    const li = document.createElement("li");
    const b = document.createElement("b"); b.textContent = e.name;
    const d = document.createElement("div"); d.className = "hint"; d.textContent = `${e.site} · ${ago(e.t)} · ${e.decision}`;
    li.append(b, d); ul.append(li);
  }
}
