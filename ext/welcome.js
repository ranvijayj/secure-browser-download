// First-run page: choose a mode, give access, try it on a sample PDF.
const $ = (id) => document.getElementById(id);
const radios = () => [...document.querySelectorAll('input[name="mode"]')];
const SAMPLE = "https://raw.githubusercontent.com/ranvijayj/secure-browser-download/main/samples/try-securedl.pdf";

async function load() {
  const s = await readSettings();
  for (const r of radios()) r.checked = r.value === s.mode;
  const need = s.mode !== "off";
  $("stepAccess").style.opacity = need ? "" : ".5";
  $("grant").hidden = !need || s.granted; $("granted").hidden = !need || !s.granted;
  $("try").disabled = need && !s.granted;
  $("tryHint").textContent = s.mode === "off"
    ? "Right-click any link to a file and choose Download with password."
    : "SecureDL will stop this download and ask for a password.";
  $("try").hidden = s.mode === "off";
}
load();
chrome.permissions.onAdded.addListener(load);
for (const r of radios()) r.addEventListener("change", async () => { await saveMode(r.value); load(); });
$("grant").onclick = async () => { try { await chrome.permissions.request(ALL_SITES); } catch (e) { console.warn(e); } load(); };
// Opened in a normal tab so it's a real web download that SecureDL stops, like any other site's.
$("try").onclick = () => chrome.tabs.create({ url: SAMPLE, active: false });
