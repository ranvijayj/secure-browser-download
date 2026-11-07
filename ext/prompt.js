// SecureDL lock page. Modes:
//   right-click  prompt.html?url=…&tabId=…               "Download with password"
//   ask          …&ask=1&name=…&site=…                    a detected download that SecureDL stopped
//   pick         …&ask=1&pick=1&dlId=…                    a let-through download finished; lock the file on disk
//   local        prompt.html?local=1                       lock a file already on this computer
const params = new URLSearchParams(location.search);
const url = params.get("url") || "";
const tabId = Number(params.get("tabId")) || null;
const ask = params.get("ask") === "1";
const pickMode = params.get("pick") === "1";
const localMode = params.get("local") === "1";
const dlId = params.has("dlId") ? Number(params.get("dlId")) : null;
const site = params.get("site") || (() => { try { return new URL(url).host; } catch { return ""; } })();
const origin = (() => { try { return new URL(url).origin; } catch { return null; } })();
// Name Chrome determined for a detected download (real name even for page-made blob: downloads).
const askedName = (() => { const n = params.get("name") || ""; return n && !n.startsWith("file from") && n !== "download" ? n : ""; })();
const $ = (id) => document.getElementById(id);
const ICON = (name) => `<svg class="icon"><use href="icons.svg#${name}"/></svg>`;

// ---------- status area: one place for progress, errors and success ----------
function setStatus(state, title = "", body = "") {
  const s = $("status");
  s.dataset.state = state;
  s.className = state === "error" ? "callout error" : state === "ok" ? "callout ok" : state === "busy" ? "hint busyline" : "";
  s.innerHTML = "";
  if (!state) return;
  if (state === "busy") { s.textContent = title; return; }
  s.insertAdjacentHTML("beforeend", ICON(state === "ok" ? "check" : "alert"));
  const box = document.createElement("div");
  const b = document.createElement("b"); b.textContent = title; box.append(b);
  if (body) { const p = document.createElement("p"); p.textContent = body; box.append(p); }
  s.append(box);
}
function busy(on, label) {
  for (const id of ["go", "skip"]) $(id).disabled = on;
  $("go").classList.toggle("busy", on && !!label);
  $("go").textContent = on && label ? label : "Lock and save";
}

// ---------- set up the page for its mode ----------
$("askName").textContent = askedName || (url ? nameFromUrl(url) : "");
$("askSite").textContent = site ? "from " + site : "";
function badge(kind, text, icon) {
  $("badge").hidden = false; $("badge").className = "badge " + kind;
  $("badgeIcon").innerHTML = `<use href="icons.svg#${icon}"/>`; $("askState").textContent = text;
}
if (ask) {
  document.title = "SecureDL – Lock this download?";
  $("title").textContent = "Lock this download?";
  $("lede").textContent = "SecureDL stopped this download. Choose a password to save a locked copy, or save it without one.";
  badge("", "Stopped, nothing saved yet", "stop");
  $("skip").hidden = false; $("neverRow").hidden = !site; $("neverSite").textContent = site;
}
if (pickMode) {
  document.title = "SecureDL – Lock the downloaded file";
  $("title").textContent = "Lock the downloaded file";
  $("lede").textContent = "Choose a password, then pick the file. It will be locked and the unprotected copy deleted.";
  badge("warn", "Saved without a password", "alert");
  $("go").hidden = true; $("skip").hidden = true; $("neverRow").hidden = true;
  $("pick").hidden = false; $("pick").className = "callout info"; $("pickIntro").textContent = "Pick the downloaded file";
  $("pickHint").textContent = "Until you lock it, the unprotected file is in your Downloads folder.";
  $("pickStart").hidden = true;
  chrome.downloads.search({ id: dlId }).then(([d]) => {
    if (!d) return;
    const parts = d.filename.split(/[\\/]/);
    $("pickName").textContent = parts.pop(); $("pickDir").textContent = parts.join("/") || "your Downloads folder";
    $("askName").textContent = $("pickName").textContent;
    $("pickFileWrap").hidden = false;
  });
}
if (localMode) {
  document.title = "SecureDL – Lock a file";
  $("title").textContent = "Lock a file on this computer";
  $("lede").textContent = "Pick a file and choose a password. SecureDL saves a locked copy to Downloads.";
  $("card").hidden = true; $("localPick").hidden = false; $("localPick").style.marginBottom = "var(--s6)";
  $("localFile").onchange = () => {
    const f = $("localFile").files[0]; if (!f) return;
    $("localChosen").textContent = "";
    $("askName").textContent = f.name;
    $("askSite").textContent = (f.size / 1048576 >= 1 ? (f.size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(f.size / 1024)) + " KB") + " on this computer";
    $("card").hidden = false; $("localPick").style.marginBottom = "var(--s4)";
    $("localChosen").textContent = "Choose a different file";
  };
}

// ---------- password: strength meter, match line ----------
function strength(pw) {
  if (pw.length < 8) return [pw ? 1 : 0, pw ? "Too short" : "At least 8 characters"];
  const c = checkPassword(pw);
  if (c.error) return [1, c.error];
  if (c.warning) return [2, "Weak"];
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-z0-9]/i].filter((r) => r.test(pw)).length;
  return pw.length >= 16 || (pw.length >= 12 && classes >= 3) ? [4, "Strong"] : [3, "Good"];
}
function refreshPw() {
  const [lvl, word] = strength($("pw").value);
  $("meter").dataset.level = lvl; $("meterWord").textContent = word;
  const a = $("pw").value, b = $("pw2").value, m = $("match");
  if (!b) { m.innerHTML = ""; m.className = "match"; return; }
  const same = a === b;
  m.className = "match" + (same ? " ok" : "");
  m.innerHTML = same ? ICON("check") + "Passwords match" : "Doesn't match yet";
}
$("pw").addEventListener("input", () => { acceptedWeak = null; $("pwWarn").hidden = true; refreshPw(); });
$("pw2").addEventListener("input", refreshPw);
$("eye").onclick = () => {
  const show = $("pw").type === "password";
  $("pw").type = $("pw2").type = show ? "text" : "password";
  $("eye").textContent = show ? "Hide" : "Show"; $("eye").setAttribute("aria-pressed", String(show));
};

// ---------- getting the file ----------
// Runs INSIDE the source tab, so the request carries that page's cookies, origin and
// bot-check clearance, like the browser's own download would. Allowed by activeTab
// (right-click) or by the optional all-sites permission (automatic detection).
async function pageFetch(url) {
  try {
    const r = await fetch(url, { credentials: "include" });
    const b = await r.blob();
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b);
    });
    return { ok: r.ok, status: r.status, type: r.headers.get("content-type"),
      cd: r.headers.get("content-disposition"), finalUrl: r.url, dataUrl };
  } catch (e) { return { error: String(e.message || e) }; }
}

async function viaTab() {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: pageFetch, args: [url] });
  const r = res?.result;
  if (!r || r.error) throw new Error(r?.error || "page fetch failed");
  return { ...r, blob: await (await fetch(r.dataUrl)).blob() };
}

async function viaExtension() {
  let r;
  try { r = await fetch(url, { credentials: "include" }); }
  catch (e) {
    // Without host access for this site the request is blocked; ask the user for this one site.
    const has = origin && await chrome.permissions.contains({ origins: [origin + "/*"] });
    if (!has) { const err = new Error("needs-access"); err.needsAccess = true; throw err; }
    throw e;
  }
  return { ok: r.ok, status: r.status, type: r.headers.get("content-type"),
    cd: r.headers.get("content-disposition"), finalUrl: r.url, blob: await r.blob() };
}

// Try each way of getting the file; accept the first one that is really the file.
async function getFile() {
  const problems = [];
  for (const [label, attempt] of [["page", viaTab], ["extension", viaExtension]]) {
    if (label === "page" && !tabId) continue;
    try {
      const r = await attempt();
      // Check the body first: bot checks usually come back as HTTP 403 *with* a challenge page.
      const bad = (await checkDownload(r.blob, r.type, r.finalUrl || url))
        || (!r.ok && { reason: "http", message: `The server refused the download (HTTP ${r.status}).` });
      if (!bad) return r;
      problems.push(bad); console.warn("SecureDL", label, bad);
      if (bad.reason === "disguised") break;                   // don't retry a dangerous file
    } catch (e) {
      if (e.needsAccess) problems.push({ reason: "access", message: "" });
      else problems.push({ reason: "error", message: e.message });
      console.warn("SecureDL", label, e);
    }
  }
  const pick = problems.find((p) => p.reason === "disguised")
    || problems.find((p) => p.reason === "challenge")
    || problems.find((p) => p.reason === "access")
    || problems[problems.length - 1] || { message: "Download failed." };
  const err = new Error(pick.message);
  err.needsAccess = pick.reason === "access";
  err.fallback = pick.reason !== "disguised";
  throw err;
}

// ---------- outcomes ----------
let savedId = null;
function succeed(saved, extra = "") {
  $("title").textContent = "Locked and saved";
  $("lede").textContent = ask ? "The unprotected file was never saved." : pickMode ? "The unprotected copy was deleted." : "Open it with the password you just chose.";
  $("card").hidden = false; $("card").classList.add("sealed");
  badge("ok", "Locked", "lock");
  $("form").hidden = true; $("pick").hidden = true; $("localPick").hidden = true;
  setStatus("ok", "Saved " + saved, "It's in your Downloads folder." + (extra ? " " + extra : ""));
  $("done").hidden = false; $("showFolder").hidden = savedId === null; $("doneBtn").focus();
  chrome.runtime.sendMessage({ type: "handled" }).catch(() => {});
}
function fail(message) {
  setStatus("error", "Nothing was saved", message.replace(/\s*(Nothing was saved\.|It was not saved\.)\s*$/, ""));
}
$("showFolder").onclick = () => savedId !== null && chrome.downloads.show(savedId);
$("doneBtn").onclick = () => chrome.tabs.getCurrent((t) => t && chrome.tabs.remove(t.id));

async function rememberNeverAsk() {
  const { neverAsk = [] } = await chrome.storage.local.get("neverAsk");
  if (!neverAsk.includes(site)) await chrome.storage.local.set({ neverAsk: [...neverAsk, site] });
}
function closeSoon(ms = 1500) {
  chrome.runtime.sendMessage({ type: "handled" }).catch(() => {});
  setTimeout(() => chrome.tabs.getCurrent((t) => t && chrome.tabs.remove(t.id)), ms);
}
async function save(out) {
  const name = await saveEncrypted(out);
  savedId = saveEncrypted.lastId ?? null;
  return name;
}

// ---------- Lock and save ----------
let acceptedWeak = null;   // password the user confirmed despite a weakness warning
function passwordOk() {
  const pw = $("pw").value;
  const check = checkPassword(pw, $("pw2").value);
  $("pwWarn").hidden = true;
  if (check.error) { setStatus("error", "Check the password", check.error); return null; }
  if (check.warning && acceptedWeak !== pw) {
    $("pwWarnText").textContent = check.warning + " Press Lock and save again to use it anyway.";
    $("pwWarn").hidden = false; setStatus("");
    acceptedWeak = pw;
    return null;
  }
  return pw;
}

async function run() {
  if (pickMode) return;
  const pw = passwordOk(); if (!pw) return;
  $("fallback").hidden = true; $("access").hidden = true;
  if (localMode) return lockLocal(pw);
  busy(true, "Downloading…"); setStatus("busy", "Downloading the file into memory…");
  try {
    const r = await getFile();
    const name = (ask && askedName) || nameFromUrl(r.finalUrl || url, r.cd);
    busy(true, "Locking…"); setStatus("busy", "Encrypting and test-opening the locked file…");
    succeed(await save(await encryptFile(r.blob, name, pw)));
  } catch (e) {
    if (e.needsAccess) {
      setStatus(""); $("accessHost").textContent = new URL(url).host; $("access").hidden = false;
    } else {
      fail(e.message);
      if (e.fallback && !ask) $("fallback").hidden = false;
      if (e.fallback && ask) $("pick").hidden = false;
    }
  }
  busy(false);
}

async function lockLocal(pw) {
  const f = $("localFile").files[0];
  if (!f) return setStatus("error", "Choose a file first", "Use Choose a file above.");
  busy(true, "Locking…"); setStatus("busy", "Encrypting and test-opening the locked file…");
  try { succeed(await save(await encryptFile(f, f.name, pw)), "You can delete the original now."); }
  catch (e) { fail(e.message); }
  busy(false);
}

// ---------- Save without a password ----------
// SecureDL stopped the original, so start it again without a password.
async function saveNormally(always) {
  busy(true);
  if (always) await rememberNeverAsk();
  const name = askedName || nameFromUrl(url);
  let r = await chrome.runtime.sendMessage({ type: "savePlain", url, filename: name, site }).catch(() => null);
  if (r?.needsPage && tabId) {
    // Page-made (blob:) file: fetch it from the page and save it as-is.
    try {
      const f = await viaTab();
      if (!(await checkDownload(f.blob, f.type, url))) { await saveEncrypted({ blob: f.blob, filename: name }); r = { ok: true }; }
    } catch (e) { console.warn("SecureDL", e); }
  }
  if (!r?.ok) {
    // Can't start it again: let the next download from this site through once.
    await chrome.runtime.sendMessage({ type: "passOnce", site }).catch(() => {});
    setStatus("ok", `Click the download button on ${site} again`, `${site} built this file inside the page and has already discarded it, so SecureDL can't save it for you. Your next download from ${site} in the next 3 minutes goes through without asking.`);
    $("form").hidden = true;
    return;
  }
  setStatus("busy", always ? `Saving without a password. SecureDL won't ask again for ${site}.` : "Saving without a password.");
  closeSoon(always ? 1500 : 800);
}
$("skip").onclick = () => saveNormally(false);
$("never").onclick = (e) => { e.preventDefault(); saveNormally(true); };

// ---------- Fallback: download it normally once, then lock the downloaded copy ----------
$("pickStart").onclick = async () => {
  $("pickStart").disabled = true;
  const r = await chrome.runtime.sendMessage({ type: "downloadThenLock", url, filename: askedName || nameFromUrl(url), site }).catch(() => null);
  if (r?.started) {
    $("pickHint").textContent = "Downloading normally… A page to lock it opens as soon as it finishes.";
    closeSoon(2500);
  } else if (r?.clickAgain) {
    $("pickHint").textContent = `Now click the download button on ${site} again. When it finishes, SecureDL opens a page to lock it.`;
    $("pickStart").hidden = true;
    chrome.runtime.sendMessage({ type: "handled" }).catch(() => {});
  } else {
    $("pickHint").textContent = "Couldn't start the download. Nothing was saved.";
    $("pickStart").disabled = false;
  }
};
$("pickFile").onchange = async () => {
  const f = $("pickFile").files[0];
  const [d] = await chrome.downloads.search({ id: dlId });
  if (!f || !d) return;
  // Make sure the picked file is the one that was downloaded before deleting anything.
  const expectName = d.filename.split(/[\\/]/).pop();
  if (f.name !== expectName || f.size !== d.fileSize) return setStatus("error", "That's a different file", `Choose “${expectName}”.`);
  const pw = passwordOk(); if (!pw) return;
  setStatus("busy", "Encrypting and test-opening the locked file…");
  try {
    const saved = await save(await encryptFile(f, f.name, pw));
    await chrome.downloads.removeFile(dlId).catch(() => {});
    await chrome.downloads.erase({ id: dlId }).catch(() => {});
    succeed(saved);
  } catch (e) { fail(e.message); }
};

$("allow").onclick = async () => {
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (granted) run(); else setStatus("error", "Access not granted", "Nothing was saved.");
};
$("go").onclick = run;
for (const id of ["pw", "pw2"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
refreshPw();
