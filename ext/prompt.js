const params = new URLSearchParams(location.search);
const url = params.get("url");
const tabId = Number(params.get("tabId")) || null;
const origin = (() => { try { return new URL(url).origin; } catch { return null; } })();
const $ = (id) => document.getElementById(id);
$("src").textContent = url;

const MIN_PW = 8;

// Runs INSIDE the source tab, so the request carries that page's cookies, origin and
// bot-check clearance, like the browser's own download would. Allowed by activeTab
// (right-click) or by the optional all-sites permission (protect-every-download mode).
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
    } catch (e) {
      if (e.needsAccess) problems.push({ reason: "access", message: "" });
      else problems.push({ reason: "error", message: e.message });
      console.warn("SecureDL", label, e);
    }
  }
  const pick = problems.find((p) => p.reason === "challenge")
    || problems.find((p) => p.reason === "access")
    || problems[problems.length - 1] || { message: "Download failed." };
  const err = new Error(pick.message);
  err.needsAccess = pick.reason === "access";
  err.fallback = true;
  throw err;
}

async function run() {
  const pw = $("pw").value;
  if (pw.length < MIN_PW) return ($("status").textContent = `Use at least ${MIN_PW} characters.`);
  $("go").disabled = true;
  $("fallback").hidden = true; $("access").hidden = true;
  try {
    $("status").textContent = "Downloading into memory…";
    const r = await getFile();
    const name = nameFromUrl(r.finalUrl || url, r.cd);
    $("status").textContent = "Encrypting…";
    const saved = await saveEncrypted(await encryptFile(r.blob, name, pw));
    $("status").textContent = "✅ Saved " + saved;
    setTimeout(() => chrome.tabs.getCurrent((t) => t && chrome.tabs.remove(t.id)), 1500);
  } catch (e) {
    if (e.needsAccess) {
      $("status").textContent = "";
      $("accessHost").textContent = new URL(url).host;
      $("access").hidden = false;
    } else {
      $("status").textContent = "❌ " + e.message + " Nothing was saved.";
      if (e.fallback) $("fallback").hidden = false;
    }
    $("go").disabled = false;
  }
}

$("allow").onclick = async () => {
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (granted) run(); else $("status").textContent = "Access not granted. Nothing was saved.";
};
$("go").onclick = run;
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
$("eye").onclick = () => { const p = $("pw"); p.type = p.type === "password" ? "text" : "password"; p.focus(); };
