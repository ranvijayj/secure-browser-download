const params = new URLSearchParams(location.search);
const url = params.get("url");
const tabId = Number(params.get("tabId")) || null;
const ask = params.get("ask") === "1";               // opened automatically for a detected download
const dlId = params.has("dlId") ? Number(params.get("dlId")) : null;
const site = params.get("site") || "";
const origin = (() => { try { return new URL(url).origin; } catch { return null; } })();
const $ = (id) => document.getElementById(id);
$("src").textContent = url;

if (ask) {
  document.title = "SecureDL – Lock this download?";
  $("title").textContent = "Lock this download?";
  $("askInfo").hidden = false; $("skip").hidden = false; $("neverRow").hidden = false;
  $("askName").textContent = params.get("name") || "download";
  $("askSite").textContent = site; $("neverSite").textContent = site;
  chrome.downloads.search({ id: dlId }).then(([d]) => { if (d?.state === "complete") $("askDone").hidden = false; });
}

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

// The original (paused or finished) download: remove it once the locked copy is saved.
async function discardOriginal() {
  if (dlId === null) return;
  const [d] = await chrome.downloads.search({ id: dlId });
  if (!d) return;
  if (d.state === "in_progress") await chrome.downloads.cancel(dlId).catch(() => {});
  if (d.state === "complete" && d.exists) await chrome.downloads.removeFile(dlId).catch(() => {});
  await chrome.downloads.erase({ id: dlId }).catch(() => {});
}

async function rememberNeverAsk() {
  if (!ask || !$("never").checked || !site) return;
  const { neverAsk = [] } = await chrome.storage.local.get("neverAsk");
  if (!neverAsk.includes(site)) await chrome.storage.local.set({ neverAsk: [...neverAsk, site] });
}

function closeSoon(ms = 1500) {
  chrome.runtime.sendMessage({ type: "handled" }).catch(() => {});
  setTimeout(() => chrome.tabs.getCurrent((t) => t && chrome.tabs.remove(t.id)), ms);
}

let acceptedWeak = null;   // password the user confirmed despite a weakness warning
async function run() {
  const pw = $("pw").value;
  const check = checkPassword(pw, $("pw2").value);
  $("pwWarn").hidden = true;
  if (check.error) return ($("status").textContent = check.error);
  if (check.warning && acceptedWeak !== pw) {
    $("pwWarn").textContent = "⚠ " + check.warning + " Press Encrypt & save again to use it anyway.";
    $("pwWarn").hidden = false; $("status").textContent = "";
    acceptedWeak = pw;
    return;
  }
  $("go").disabled = true; $("skip").disabled = true;
  $("fallback").hidden = true; $("access").hidden = true;
  try {
    $("status").textContent = "Downloading into memory…";
    const r = await getFile();
    const name = nameFromUrl(r.finalUrl || url, r.cd);
    $("status").textContent = "Encrypting and test-opening…";
    const saved = await saveEncrypted(await encryptFile(r.blob, name, pw));
    await discardOriginal();
    await rememberNeverAsk();
    $("status").textContent = "✅ Saved " + saved;
    closeSoon();
  } catch (e) {
    if (e.needsAccess) {
      $("status").textContent = "";
      $("accessHost").textContent = new URL(url).host;
      $("access").hidden = false;
    } else {
      $("status").textContent = "❌ " + e.message + (/not saved|Nothing was saved/.test(e.message) ? "" : " Nothing was saved.");
      if (e.fallback && !ask) $("fallback").hidden = false;
    }
    $("go").disabled = false; $("skip").disabled = false;
  }
}

$("skip").onclick = async () => {
  $("skip").disabled = true; $("go").disabled = true;
  const [d] = await chrome.downloads.search({ id: dlId });
  if (d?.state === "in_progress" && d.paused) await chrome.downloads.resume(dlId).catch(() => {});
  await rememberNeverAsk();
  $("status").textContent = "Saving normally, without a password.";
  closeSoon(800);
};
$("allow").onclick = async () => {
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (granted) run(); else $("status").textContent = "Access not granted. Nothing was saved.";
};
$("go").onclick = run;
for (const id of ["pw", "pw2"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
$("pw").addEventListener("input", () => { acceptedWeak = null; $("pwWarn").hidden = true; });
$("eye").onclick = () => {
  const t = $("pw").type === "password" ? "text" : "password";
  $("pw").type = t; $("pw2").type = t; $("pw").focus();
};
