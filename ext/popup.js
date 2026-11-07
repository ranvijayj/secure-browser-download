const $ = (id) => document.getElementById(id);
const radios = () => [...document.querySelectorAll('input[name="mode"]')];

async function load() {
  const s = await readSettings();
  for (const r of radios()) r.checked = r.value === s.mode;
  $("needAccess").hidden = !(s.mode !== "off" && !s.granted);
  renderLog($("recent"), s.log, 4);
  $("recentWrap").hidden = s.mode === "off" && s.log.length === 0;
}
load();
chrome.storage.onChanged.addListener(load);

for (const r of radios()) r.addEventListener("change", async () => {
  await saveMode(r.value);
  const s = await readSettings();
  // Access is requested in a normal tab, where Chrome's dialog can't close anything.
  if (s.mode !== "off" && !s.granted) chrome.tabs.create({ url: "options.html#grant" });
  load();
});
$("grant").onclick = () => chrome.tabs.create({ url: "options.html#grant" });
// Locking a local file happens in a tab: on macOS the file dialog would close this popup.
$("lockLocal").onclick = () => chrome.tabs.create({ url: "prompt.html?local=1" });
