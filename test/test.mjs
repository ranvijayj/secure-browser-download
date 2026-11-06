// Runs the extension's real crypto.js in Node and verifies both output formats independently.
import fs from "fs"; import vm from "vm"; import { execFileSync } from "child_process";
import * as PDFLib from "@cantoo/pdf-lib";

let fails = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; };
const ctx = { PDFLib, Blob, URL, TextEncoder, TextDecoder, crypto, btoa, atob, console, chrome: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../ext/crypto.js", import.meta.url), "utf8"), ctx);

// ---------- 1. PDF -> AES-256 locked PDF ----------
const src = await PDFLib.PDFDocument.create();
src.addPage().drawText("TOP SECRET bank statement", { x: 50, y: 700 });
const pdfIn = new Blob([await src.save({ useObjectStreams: false })]);
const pdfOut = await ctx.encryptFile(pdfIn, "statement.pdf", "correct-horse");
ok(pdfOut.filename === "statement (locked).pdf", "PDF filename: " + pdfOut.filename);
const pdfPath = "/tmp/t-locked.pdf";
fs.writeFileSync(pdfPath, Buffer.from(await pdfOut.blob.arrayBuffer()));
const info = execFileSync("qpdf", ["--show-encryption", "--password=correct-horse", pdfPath]).toString();
ok(/R = 6/.test(info) && /AESv3/.test(info), "PDF uses AES-256 (R6, AESv3) – the format Preview opens");
let wrong = false; try { execFileSync("qpdf", ["--check", "--password=nope", pdfPath], { stdio: "pipe" }); } catch { wrong = true; }
ok(wrong, "PDF rejects wrong password");
execFileSync("qpdf", ["--password=correct-horse", "--decrypt", "--qdf", pdfPath, "/tmp/t-dec.pdf"]);
ok(fs.readFileSync("/tmp/t-dec.pdf").includes("TOP SECRET"), "PDF opens with right password and content intact");
ok(!fs.readFileSync(pdfPath).includes("TOP SECRET"), "PDF text not readable in locked file");

// ---------- 2. Any other file -> self-unlocking HTML ----------
const secret = new Uint8Array(300000).map((_, i) => (i * 7) % 256); // binary-ish test file
const marker = new TextEncoder().encode("TOP SECRET passport scan"); secret.set(marker, 1000);
const htmlOut = await ctx.encryptFile(new Blob([secret]), "passport.jpg", "correct-horse");
ok(htmlOut.filename === "passport.jpg.locked.html", "HTML filename: " + htmlOut.filename);
const html = await htmlOut.blob.text();
ok(!html.includes("TOP SECRET") && !html.includes("passport.jpg"), "contents and real filename hidden in .html");

// Run the vault page's own inline script with a tiny DOM stub.
async function unlock(password) {
  const listeners = {};
  const els = { p: { value: password, addEventListener: (ev, fn) => (listeners[ev] = fn) }, b: {}, m: { textContent: "", innerHTML: "", append(...a) { this.out = a; } } };
  let saved = null;
  const sandbox = {
    crypto, TextEncoder, TextDecoder, DataView, Uint8Array, atob, Blob,
    URL: { createObjectURL: (b) => { saved = b; return "blob:x"; } },
    document: { getElementById: (id) => els[id], createElement: () => ({ style: {}, click() {} }) }
  };
  vm.createContext(sandbox);
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], sandbox);
  // Typing a normal letter must NOT be blocked (regression: typing didn't work).
  let blocked = false;
  listeners.keydown?.({ key: "a", preventDefault: () => (blocked = true) });
  if (blocked || els.p.onkeydown) throw new Error("vault password box blocks typing");
  await els.b.onclick();
  return { msg: els.m.textContent, saved, name: els.m.out?.[1]?.download };
}
const bad = await unlock("wrong-pass");
ok(bad.msg === "❌ Wrong password." && !bad.saved, "HTML vault rejects wrong password");
const good = await unlock("correct-horse");
const back = new Uint8Array(await good.saved.arrayBuffer());
ok(good.name === "passport.jpg" && back.length === secret.length && back.every((v, i) => v === secret[i]),
  "HTML vault restores exact original bytes and filename");

// ---------- 2b. Wrong-content detection (real Cloudflare page the user hit) ----------
const cf = `<!DOCTYPE html>\n<html lang="en-US">\n<head><title>Just a moment...</title></head><body>
<script>window._cf_chl_opt={cType:'managed'};a.src='/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1';</script></body></html>`;
const u = "https://file-examples.com/wp-content/storage/2017/10/file-example_PDF_500_kB.pdf";
ok((await ctx.checkDownload(new Blob([cf]), "text/html; charset=UTF-8", u))?.reason === "challenge", "detects real Cloudflare challenge page");
ok((await ctx.checkDownload(new Blob([cf]), null, u))?.reason === "challenge", "detects it even without content-type");
ok((await ctx.checkDownload(new Blob(["<html>Sign in</html>"]), "text/html", "https://x.com/a.docx"))?.reason === "html", "detects login page instead of .docx");
ok((await ctx.checkDownload(pdfIn, "application/pdf", u)) === null, "accepts a real PDF");
ok((await ctx.checkDownload(new Blob(["<html>hi</html>"]), "text/html", "https://x.com/page.html")) === null, "accepts a real .html download");
ok((await ctx.checkDownload(new Blob([]), "application/octet-stream", "https://x.com/a.bin"))?.reason === "empty", "rejects empty download");

// ---------- 3. Lint: no `onkey… = e => cond && fn()` (returns false => blocks typing) ----------
for (const f of fs.readdirSync(new URL("../ext", import.meta.url)).filter((f) => f.endsWith(".js") || f.endsWith(".html"))) {
  const src = fs.readFileSync(new URL("../ext/" + f, import.meta.url), "utf8");
  ok(!/\bonkey(down|press|up)\s*=/.test(src), `${f}: no onkey* handlers that can swallow keystrokes`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
