const $ = (id) => document.getElementById(id);
const ALL = { origins: ["<all_urls>"] };

async function load() {
  const { mode = "off", neverAsk = [], protectAll } = await chrome.storage.local.get(["mode", "neverAsk", "protectAll"]);
  const effective = mode !== "off" || protectAll ? (mode !== "off" ? mode : "ask-all") : "off";
  $("mode").value = effective !== "off" && !(await chrome.permissions.contains(ALL)) ? "off" : effective;
  $("modeHint").hidden = $("mode").value === "off";
  $("neverWrap").hidden = neverAsk.length === 0;
  $("neverList").textContent = neverAsk.join(", ");
}
load();

$("mode").onchange = async () => {
  const mode = $("mode").value;
  if (mode !== "off") {
    // Only automatic detection needs access to all sites; ask at the moment the user turns it on.
    const granted = await chrome.permissions.request(ALL);
    if (!granted) { $("mode").value = "off"; $("modeHint").hidden = true; return; }
  }
  await chrome.storage.local.set({ mode, protectAll: false });
  $("modeHint").hidden = mode === "off";
};
$("neverReset").onclick = async (e) => { e.preventDefault(); await chrome.storage.local.set({ neverAsk: [] }); load(); };

let acceptedWeak = null;
$("pw").addEventListener("input", () => { acceptedWeak = null; $("pwWarn").hidden = true; });
$("go").onclick = async () => {
  const f = $("file").files[0], pw = $("pw").value;
  if (!f) return ($("status").textContent = "Pick a file.");
  const check = checkPassword(pw, $("pw2").value);
  $("pwWarn").hidden = true;
  if (check.error) return ($("status").textContent = check.error);
  if (check.warning && acceptedWeak !== pw) {
    $("pwWarn").textContent = "⚠ " + check.warning + " Click Encrypt & save again to use it anyway.";
    $("pwWarn").hidden = false; acceptedWeak = pw; $("status").textContent = ""; return;
  }
  $("go").disabled = true;
  $("status").textContent = "Encrypting and test-opening…";
  try {
    const saved = await saveEncrypted(await encryptFile(f, f.name, pw));
    $("status").textContent = "✅ Saved " + saved + ". You can now delete the original.";
  } catch (e) {
    $("status").textContent = "❌ " + e.message + " Nothing was saved.";
  }
  $("go").disabled = false;
};
