// SecureDL encryption. Everything happens locally in the browser.
//  - PDFs   -> AES-256 password-protected PDF (opens natively in macOS Preview)
//  - Others -> self-unlocking .html (PBKDF2-SHA256 + AES-256-GCM, opens in any browser)

const KDF_ITER = 600000;
const enc = new TextEncoder();

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Files are processed in memory; refuse anything bigger than this rather than crash the tab.
var MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB (var so tests can lower it)

async function deriveKey(password, salt, usage = "encrypt", iterations = KDF_ITER) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, [usage]);
}

async function sha256(bytes) {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

// ---------- Password checks ----------
const COMMON_PASSWORDS = new Set(("password,password1,password123,12345678,123456789,1234567890,qwertyuiop," +
  "qwerty123,11111111,00000000,iloveyou,welcome1,admin123,letmein1,abc12345,abcd1234,passw0rd,sunshine," +
  "football,baseball,princess,trustno1,superman,whatever,starwars,1q2w3e4r,zaq12wsx,asdfghjkl,test1234").split(","));

// Returns { error } to block, { warning } to show but allow, or {} if fine.
function checkPassword(pw, confirm) {
  if (pw.length < 8) return { error: "Use at least 8 characters." };
  if (confirm !== undefined && pw !== confirm) return { error: "The two passwords don't match." };
  if (/^\s|\s$/.test(pw)) return { error: "Remove spaces at the start or end of the password." };
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(pw) || /^\d{8,11}$/.test(pw))
    return { warning: "It's one of the most common passwords. Anyone who gets the file could guess it quickly." };
  if (pw.length < 12 && !(/[a-z]/i.test(pw) && /\d|[^a-z0-9]/i.test(pw)))
    return { warning: "It's short and uses only one kind of character. A longer password, or a few random words, is much safer." };
  return {};
}

async function isPdf(blob) {
  const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  return new TextDecoder().decode(head).includes("%PDF-");
}

async function encryptPdf(blob, password) {
  const doc = await PDFLib.PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
  doc.encrypt({ userPassword: password, ownerPassword: password }); // AES-256 (V5/R6)
  return new Blob([await doc.save({ useObjectStreams: false })], { type: "application/pdf" });
}

async function encryptToHtml(blob, name, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  // Plaintext payload = [4-byte name length][name][file bytes] so the real name is hidden too.
  const nameBytes = enc.encode(name), data = new Uint8Array(await blob.arrayBuffer());
  const plain = new Uint8Array(4 + nameBytes.length + data.length);
  new DataView(plain.buffer).setUint32(0, nameBytes.length);
  plain.set(nameBytes, 4); plain.set(data, 4 + nameBytes.length);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const html = VAULT_TEMPLATE
    .replace("__SALT__", b64(salt)).replace("__IV__", b64(iv))
    .replace("__ITER__", String(KDF_ITER)).replace("__DATA__", b64(ct));
  return new Blob([html], { type: "text/html" });
}

// ---------- Self-check: prove the saved file opens with the password and gives back the original ----------
async function verifyPdf(outBlob, password, expectedPages) {
  const bytes = await outBlob.arrayBuffer();
  let openedWithout = false;
  try { await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); openedWithout = true; } catch {}
  if (openedWithout) throw new Error("self-check: PDF opened without a password");
  const doc = await PDFLib.PDFDocument.load(bytes, { password, updateMetadata: false });
  if (doc.getPageCount() !== expectedPages) throw new Error("self-check: page count changed");
}

async function openVault(html, password) {
  const get = (re) => (html.match(re) || [])[1];
  const S = get(/const S="([^"]+)"/), I = get(/I="([^"]+)"/), N = Number(get(/N=(\d+)/)), D = get(/D="([^"]+)"/);
  const u = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const key = await deriveKey(password, u(S), "decrypt", N);
  const p = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u(I) }, key, u(D)));
  const n = new DataView(p.buffer).getUint32(0);
  return { name: new TextDecoder().decode(p.subarray(4, 4 + n)), data: p.subarray(4 + n) };
}

async function verifyVault(outBlob, password, name, originalHash) {
  const html = await outBlob.text();
  if (html.includes("__DATA__") || !html.includes('const S="')) throw new Error("self-check: vault page is malformed");
  const back = await openVault(html, password);
  if (back.name !== name || (await sha256(back.data)) !== originalHash)
    throw new Error("self-check: unlocked file doesn't match the original");
}

// Returns { blob, filename } ready to save. Every output is decrypted again and compared
// with the original before it is returned; if that fails, nothing is saved.
async function encryptFile(blob, name, password) {
  if (blob.size > MAX_BYTES)
    throw new Error(`This file is ${(blob.size / 1048576).toFixed(0)} MB. SecureDL handles files up to ${MAX_BYTES / 1048576} MB.`);
  const safe = name.replace(/[\\/:*?"<>|]/g, "_");
  if (await isPdf(blob)) {
    let pages = null;
    try { pages = (await PDFLib.PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false })).getPageCount(); }
    catch (e) { console.warn("PDF can't be parsed (already encrypted or damaged); using HTML vault", e); }
    if (pages !== null) {
      const out = await encryptPdf(blob, password);
      await verifyPdf(out, password, pages);
      return { blob: out, filename: safe.replace(/\.pdf$/i, "") + " (locked).pdf", kind: "pdf" };
    }
  }
  const originalHash = await sha256(new Uint8Array(await blob.arrayBuffer()));
  const out = await encryptToHtml(blob, name, password);
  await verifyVault(out, password, name, originalHash);
  return { blob: out, filename: safe + ".locked.html", kind: "html" };
}

// Did we actually get the file, or a bot-check / login / error page instead?
// Returns null if it looks right, else { reason, message }.
async function checkDownload(blob, contentType, url) {
  const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
  const isHtml = /text\/html/i.test(contentType || "") || /^\s*(<!doctype html|<html)/i.test(head);
  let ext = "";
  try { ext = (new URL(url).pathname.match(/\.([a-z0-9]{1,5})$/i) || [])[1]?.toLowerCase() || ""; } catch {}
  // A "document" that is really a program (Windows .exe, Mac/Linux binary) is a classic trick.
  const DOC_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "rtf", "jpg", "jpeg", "png", "gif", "heic"];
  const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const hex = [...magic].map((b) => b.toString(16).padStart(2, "0")).join("");
  const isProgram = hex.startsWith("4d5a") || hex === "7f454c46" ||
    ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(hex);
  if (isProgram && DOC_EXT.includes(ext))
    return { reason: "disguised", message: `This file claims to be a .${ext} but is actually a program. It was not saved.` };
  if (/challenge-platform|cf_chl_|cf-chl|Just a moment\.\.\.|captcha/i.test(head) && isHtml)
    return { reason: "challenge", message: "The site showed a bot check (e.g. Cloudflare) instead of the file." };
  if (ext === "pdf" && !head.includes("%PDF-"))
    return { reason: isHtml ? "html" : "notpdf",
      message: isHtml ? "The site sent a web page (login or error page?) instead of the PDF." : "The file doesn't look like a PDF." };
  if (isHtml && ext && !["html", "htm", ""].includes(ext))
    return { reason: "html", message: "The site sent a web page (login or error page?) instead of the file." };
  if (blob.size === 0) return { reason: "empty", message: "The download was empty." };
  return null;
}

function nameFromUrl(url, contentDisposition) {
  const m = contentDisposition && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
  if (m) return decodeURIComponent(m[1]);
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "download";
  } catch { return "download"; }
}

async function saveEncrypted({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  // Tell the background the intended name first (see ownNames in background.js).
  await chrome.runtime.sendMessage({ type: "ownName", url, filename }).catch(() => {});
  // uniquify: never overwrite an existing file with the same name.
  saveEncrypted.lastId = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return filename;
}

// The self-unlocking page. No external resources; works offline.
const VAULT_TEMPLATE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Locked file</title>
<style>
:root{color-scheme:light dark;--canvas:#F3F5F8;--surface:#fff;--ink:#142033;--slate:#5A6577;--line:#DCE2EA;--tint:#C3CEDF;--blue:#2242C7;--on-blue:#fff;--green:#16794A;--green-soft:#E5F4EC;--red:#B3261E;--red-soft:#FDECEA}
@media (prefers-color-scheme:dark){:root{--canvas:#0F1319;--surface:#171C24;--ink:#E8ECF2;--slate:#9AA4B4;--line:#29313D;--tint:#2E3A4D;--blue:#8EA6FF;--on-blue:#0F1319;--green:#5BD08F;--green-soft:#142A1F;--red:#FF8A80;--red-soft:#341A19}}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:400 15px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:640px;margin:10vh auto 48px;padding:0 20px}
h1{font-size:22px;line-height:28px;font-weight:600;letter-spacing:-.01em;margin:0 0 8px}
p{margin:0 0 24px;color:var(--slate)}
.env{border:1px solid var(--line);border-radius:10px;padding:8px;margin-bottom:24px;background:repeating-linear-gradient(-45deg,var(--tint) 0 1.5px,transparent 1.5px 5px),var(--surface)}
.lab{display:flex;gap:12px;align-items:center;background:var(--surface);border-radius:6px;padding:12px 16px}
.lab svg{width:28px;height:28px;flex:none;stroke:var(--slate);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.lab b{display:block;font-size:17px;line-height:24px;font-weight:600}.lab span{color:var(--slate);font-size:13px;line-height:18px}
label{display:block;font-weight:500;margin-bottom:4px}
.row{display:flex;gap:8px}
input{flex:1;min-width:0;height:44px;padding:0 12px;font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:6px}
input:focus-visible{outline:2px solid var(--blue);outline-offset:0;border-color:var(--blue)}
button,.save{height:44px;padding:0 20px;font:500 15px/44px inherit;font-family:inherit;color:var(--on-blue);background:var(--blue);border:0;border-radius:6px;cursor:pointer;text-decoration:none;display:inline-block}
button:focus-visible,.save:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
#m{margin-top:16px;min-height:22px;color:var(--slate)}
#m[data-state=error]{color:var(--red)}
#m[data-state=ok]{color:var(--ink)}
.ok{display:flex;gap:8px;align-items:center;background:var(--green-soft);border-radius:10px;padding:12px 16px;font-weight:600}
.view{margin-top:16px;border:1px solid var(--line);border-radius:10px;background:var(--surface);overflow:hidden}
.view img{display:block;max-width:100%;margin:0 auto}
.view iframe{display:block;width:100%;height:70vh;border:0}
.view pre{margin:0;padding:16px;max-height:60vh;overflow:auto;font:13px/19px ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.none{padding:16px;color:var(--slate)}
.save{margin-top:16px;background:var(--surface)!important;color:var(--ink)!important;border:1px solid var(--line)!important;line-height:42px!important}
.note{margin-top:8px;font-size:13px;line-height:18px;color:var(--slate)}
small{display:block;margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--slate);font-size:12px;line-height:16px}
</style></head><body><main>
<h1>This file is locked</h1>
<p>Enter the password to open it here. The file stays locked; nothing is saved or uploaded unless you choose to.</p>
<div class="env"><div class="lab"><svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/></svg>
<div><b>Locked file</b><span>The file name is hidden until it's unlocked.</span></div></div></div>
<label for="p">Password</label>
<div class="row"><input type="password" id="p" autofocus autocomplete="current-password"><button id="b">Unlock</button></div>
<div id="m" role="status" aria-live="polite"></div>
<small>Locked with SecureDL (AES-256). Without the password, this file can't be opened.</small>
</main>
<script>
const S="__SALT__",I="__IV__",N=__ITER__,D="__DATA__";
const u=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function go(){const m=document.getElementById("m");m.dataset.state="busy";m.textContent="Unlocking…";
try{const k0=await crypto.subtle.importKey("raw",new TextEncoder().encode(document.getElementById("p").value),"PBKDF2",false,["deriveKey"]);
const k=await crypto.subtle.deriveKey({name:"PBKDF2",salt:u(S),iterations:N,hash:"SHA-256"},k0,{name:"AES-GCM",length:256},false,["decrypt"]);
const p=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:u(I)},k,u(D)));
const n=new DataView(p.buffer).getUint32(0),name=new TextDecoder().decode(p.subarray(4,4+n));
const bytes=p.subarray(4+n),x=(name.split(".").pop()||"").toLowerCase();
const T={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",bmp:"image/bmp",avif:"image/avif",pdf:"application/pdf",txt:"text/plain",csv:"text/plain",json:"text/plain",md:"text/plain",log:"text/plain",xml:"text/plain"};
const url=URL.createObjectURL(new Blob([bytes],{type:T[x]||"application/octet-stream"}));
const el=(t,c,txt)=>{const e=document.createElement(t);if(c)e.className=c;if(txt)e.textContent=txt;return e;};
m.innerHTML="";m.dataset.state="ok";
const head=el("div","ok","Unlocked: "+name);const view=el("div","view");
if(T[x]&&T[x].startsWith("image/")){const i=el("img");i.src=url;i.alt=name;view.append(i);}
else if(x==="pdf"){const f=el("iframe");f.src=url;f.title=name;view.append(f);}
else if(T[x]==="text/plain"){const pre=el("pre");pre.textContent=new TextDecoder().decode(bytes.subarray(0,500000));view.append(pre);}
else view.append(el("div","none","This kind of file can't be shown in a browser. Save an unlocked copy to open it in its app."));
const a=el("a","save","Save an unlocked copy");a.href=url;a.download=name;
m.append(head,view,a,el("div","note","The copy has no password, so delete it when you're done. This locked file stays as it is."));}
catch(e){m.dataset.state="error";m.textContent=e.name==="OperationError"?"Wrong password. Try again.":"Couldn't unlock: "+e.message;}}
document.getElementById("b").onclick=go;document.getElementById("p").addEventListener("keydown",e=>{if(e.key==="Enter")go();});
</script></body></html>`;
