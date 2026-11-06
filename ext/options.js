const $ = (id) => document.getElementById(id);

async function load() {
  const s = await readSettings();
  $("mode").value = s.mode;
  $("state").textContent = MODE_TEXT[s.mode];
  const need = s.mode !== "off";
  $("access").hidden = !need;
  $("grant").hidden = !need || s.granted;
  $("accessText").innerHTML = s.granted
    ? "✅ Access granted. Automatic detection is working."
    : "⚠ <b>Not working yet:</b> Chrome hasn't given SecureDL access, so downloads aren't intercepted.";
  const ul = $("never"); ul.textContent = "";
  if (!s.neverAsk.length) { const li = document.createElement("li"); li.className = "hint"; li.textContent = "None."; ul.append(li); }
  for (const site of s.neverAsk) {
    const li = document.createElement("li"); li.textContent = site + " ";
    const a = document.createElement("a"); a.href = "#"; a.textContent = "remove";
    a.onclick = async (e) => { e.preventDefault(); await chrome.storage.local.set({ neverAsk: s.neverAsk.filter((x) => x !== site) }); };
    li.append(a); ul.append(li);
  }
  renderLog($("recent"), s.log);
}
load();
chrome.storage.onChanged.addListener(load);
chrome.permissions.onAdded.addListener(load);
chrome.permissions.onRemoved.addListener(load);

$("mode").onchange = async () => { await saveMode($("mode").value); load(); };
$("grant").onclick = async () => {
  try { await chrome.permissions.request(ALL_SITES); } catch (e) { console.warn(e); }
  load();
};
$("clearLog").onclick = () => chrome.storage.local.set({ log: [] });
if (location.hash === "#grant") $("grant").focus();
