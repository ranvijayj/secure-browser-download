// Shared by popup.html and options.html: detection setting, access status, activity log.
const ALL_SITES = { origins: ["<all_urls>"] };

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
  if (s < 60) return "now";
  if (s < 3600) return Math.round(s / 60) + " min";
  if (s < 86400) return Math.round(s / 3600) + " h";
  return new Date(t).toLocaleDateString();
}

// Short, plain outcome for a logged decision; the full reason stays in the tooltip.
function outcome(decision) {
  const d = decision.toLowerCase();
  if (d.startsWith("stopped and asked")) return ["asked", "Stopped and asked"];
  if (d.startsWith("asked")) return ["asked", "Asked"];
  if (d.includes("not intercepted")) return ["missed", "Not stopped: access missing"];
  if (d.includes("not a document")) return ["", "Not a document, saved normally"];
  if (d.includes("always save normally")) return ["", "Saved normally (site on your list)"];
  if (d.includes("closed without choosing")) return ["", "Closed, nothing saved"];
  if (d.includes("let through once")) return ["", "Let through once"];
  return ["", decision];
}

function renderLog(ul, log, max = 8) {
  ul.textContent = "";
  if (!log.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "No downloads yet."; ul.append(li); return; }
  for (const e of log.slice(0, max)) {
    const [tone, text] = outcome(e.decision);
    const li = document.createElement("li"); li.title = `${e.site}: ${e.decision}`;
    const dot = document.createElement("span"); dot.className = "dot " + tone;
    const f = document.createElement("span"); f.className = "file"; f.textContent = e.name;
    const t = document.createElement("time"); t.textContent = ago(e.t);
    const w = document.createElement("span"); w.className = "what"; w.textContent = `${text}, ${e.site}`;
    li.append(dot, f, t, w); ul.append(li);
  }
}
