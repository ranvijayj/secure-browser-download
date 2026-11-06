const $ = (id) => document.getElementById(id);
const ALL = { origins: ["<all_urls>"] };

(async () => {
  const { protectAll } = await chrome.storage.local.get("protectAll");
  $("all").checked = !!protectAll && await chrome.permissions.contains(ALL);
})();

$("all").onchange = async () => {
  if ($("all").checked) {
    // Only this mode needs access to all sites; ask at the moment the user turns it on.
    const granted = await chrome.permissions.request(ALL);
    if (!granted) { $("all").checked = false; return; }
  }
  await chrome.storage.local.set({ protectAll: $("all").checked });
};

$("go").onclick = async () => {
  const f = $("file").files[0], pw = $("pw").value;
  if (!f) return ($("status").textContent = "Pick a file.");
  if (pw.length < 8) return ($("status").textContent = "Use at least 8 characters.");
  $("go").disabled = true;
  $("status").textContent = "Encrypting…";
  try {
    const saved = await saveEncrypted(await encryptFile(f, f.name, pw));
    $("status").textContent = "✅ Saved " + saved + ". You can now delete the original.";
  } catch (e) {
    $("status").textContent = "❌ " + e.message;
  }
  $("go").disabled = false;
};
