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

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: KDF_ITER, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
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

// Returns { blob, filename } ready to save.
async function encryptFile(blob, name, password) {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_");
  if (await isPdf(blob)) {
    try {
      const base = safe.replace(/\.pdf$/i, "");
      return { blob: await encryptPdf(blob, password), filename: base + " (locked).pdf" };
    } catch (e) { console.warn("PDF encrypt failed, using HTML vault", e); }
  }
  return { blob: await encryptToHtml(blob, name, password), filename: safe + ".locked.html" };
}

// Did we actually get the file, or a bot-check / login / error page instead?
// Returns null if it looks right, else { reason, message }.
async function checkDownload(blob, contentType, url) {
  const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
  const isHtml = /text\/html/i.test(contentType || "") || /^\s*(<!doctype html|<html)/i.test(head);
  let ext = "";
  try { ext = (new URL(url).pathname.match(/\.([a-z0-9]{1,5})$/i) || [])[1]?.toLowerCase() || ""; } catch {}
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
  await chrome.downloads.download({ url, filename, saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return filename;
}

// The self-unlocking page. No external resources; works offline.
const VAULT_TEMPLATE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>🔒 Locked file</title>
<style>body{font:15px -apple-system,system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 20px;color:#222}
input{width:100%;padding:10px;font-size:15px;box-sizing:border-box;margin:10px 0}
button{padding:10px 18px;background:#1a73e8;color:#fff;border:0;border-radius:6px;font-size:15px;cursor:pointer}
#m{margin-top:14px}</style></head><body>
<h2>🔒 This file is password-protected</h2>
<p>Enter the password to unlock it. Nothing is uploaded; it is decrypted on this device.</p>
<input type="password" id="p" autofocus placeholder="Password"><button id="b">Unlock</button><div id="m"></div>
<script>
const S="__SALT__",I="__IV__",N=__ITER__,D="__DATA__";
const u=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function go(){const m=document.getElementById("m");m.textContent="Unlocking…";
try{const k0=await crypto.subtle.importKey("raw",new TextEncoder().encode(document.getElementById("p").value),"PBKDF2",false,["deriveKey"]);
const k=await crypto.subtle.deriveKey({name:"PBKDF2",salt:u(S),iterations:N,hash:"SHA-256"},k0,{name:"AES-GCM",length:256},false,["decrypt"]);
const p=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:u(I)},k,u(D)));
const n=new DataView(p.buffer).getUint32(0),name=new TextDecoder().decode(p.subarray(4,4+n));
const url=URL.createObjectURL(new Blob([p.subarray(4+n)]));
m.innerHTML="";const a=document.createElement("a");a.href=url;a.download=name;a.textContent="⬇ Save "+name;
a.style.fontSize="17px";m.append("✅ Unlocked. ",a);a.click();}
catch(e){m.textContent=e.name==="OperationError"?"❌ Wrong password.":"❌ "+e.message;}}
document.getElementById("b").onclick=go;document.getElementById("p").addEventListener("keydown",e=>{if(e.key==="Enter")go();});
</script></body></html>`;
