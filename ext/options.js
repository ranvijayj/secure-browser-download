const $ = (id) => document.getElementById(id);
const radios = () => [...document.querySelectorAll('input[name="mode"]')];

async function load() {
  const s = await readSettings();
  for (const r of radios()) r.checked = r.value === s.mode;
  const need = s.mode !== "off";
  $("access").hidden = !need;
  $("access").className = "callout " + (s.granted ? "ok" : "warn");
  $("accessIcon").innerHTML = `<use href="icons.svg#${s.granted ? "check" : "alert"}"/>`;
  $("accessTitle").textContent = s.granted ? "Working" : "Not working yet";
  $("accessText").textContent = s.granted
    ? "SecureDL can stop downloads and fetch them to lock them."
    : "SecureDL needs access to all sites so it can stop a download and fetch the file to lock it. Files are never sent anywhere.";
  $("grant").hidden = s.granted;

  const ul = $("never"); ul.textContent = "";
  if (!s.neverAsk.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "None. Add one with “Always save from … without asking” when SecureDL asks."; ul.append(li); }
  for (const site of s.neverAsk) {
    const li = document.createElement("li"); li.style.gridTemplateColumns = "1fr auto";
    const f = document.createElement("span"); f.className = "file"; f.textContent = site;
    const a = document.createElement("a"); a.href = "#"; a.textContent = "Remove";
    a.onclick = async (e) => { e.preventDefault(); await chrome.storage.local.set({ neverAsk: s.neverAsk.filter((x) => x !== site) }); };
    li.append(f, a); ul.append(li);
  }
  renderLog($("recent"), s.log, 15);
}
load();
chrome.storage.onChanged.addListener(load);
chrome.permissions.onAdded.addListener(load);
chrome.permissions.onRemoved.addListener(load);

for (const r of radios()) r.addEventListener("change", async () => { await saveMode(r.value); load(); });
$("grant").onclick = async () => {
  try { await chrome.permissions.request(ALL_SITES); } catch (e) { console.warn(e); }
  load();
};
$("clearLog").onclick = () => chrome.storage.local.set({ log: [] });
if (location.hash === "#grant") $("grant").focus();
