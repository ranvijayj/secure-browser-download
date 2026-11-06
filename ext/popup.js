const $ = (id) => document.getElementById(id);

async function load() {
  const s = await readSettings();
  $("mode").value = s.mode;
  $("state").textContent = MODE_TEXT[s.mode] + (s.neverAsk.length ? ` Not asking for: ${s.neverAsk.join(", ")}.` : "");
  $("needAccess").hidden = !(s.mode !== "off" && !s.granted);
  renderLog($("recent"), s.log);
  $("recentWrap").open = s.mode !== "off" && s.log.length > 0;
}
load();
chrome.storage.onChanged.addListener(load);

$("mode").onchange = async () => {
  await saveMode($("mode").value);
  const s = await readSettings();
  // Access is requested in a normal tab, where Chrome's dialog can't close anything.
  if (s.mode !== "off" && !s.granted) chrome.tabs.create({ url: "options.html#grant" });
  load();
};
$("grant").onclick = () => chrome.tabs.create({ url: "options.html#grant" });

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
