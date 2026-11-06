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

// ---------- 2c. Password checks ----------
const pc = (pw, c) => ctx.checkPassword(pw, c === undefined ? pw : c);
ok(pc("short1").error, "rejects passwords under 8 characters");
ok(pc("correct-horse", "correct-hose").error?.includes("match"), "rejects mismatched confirmation");
ok(pc(" padded-pass ").error, "rejects leading/trailing spaces");
ok(pc("password123").warning && pc("aaaaaaaaaa").warning && pc("19870412").warning, "warns on common / repeated / all-digit passwords");
ok(pc("abcdefgh").warning, "warns on short letters-only password");
ok(!pc("tangerine-kayak-41").warning && !pc("tangerine-kayak-41").error, "accepts a strong password");

// ---------- 2d. Disguised programs, size limit ----------
const exe = new Uint8Array(64); exe.set([0x4d, 0x5a]);   // Windows "MZ" header
ok((await ctx.checkDownload(new Blob([exe]), "application/pdf", "https://x.com/invoice.pdf"))?.reason === "disguised", "refuses a Windows program disguised as .pdf");
const macho = new Uint8Array(64); macho.set([0xcf, 0xfa, 0xed, 0xfe]);
ok((await ctx.checkDownload(new Blob([macho]), "image/jpeg", "https://x.com/photo.jpg"))?.reason === "disguised", "refuses a Mac program disguised as .jpg");
ok((await ctx.checkDownload(new Blob([exe]), "application/octet-stream", "https://x.com/setup.exe")) === null, "allows a real .exe that says it's an .exe");
vm.runInContext("MAX_BYTES = 1000", ctx);
let tooBig = null; try { await ctx.encryptFile(new Blob([new Uint8Array(2000)]), "big.bin", "tangerine-kayak-41"); } catch (e) { tooBig = e.message; }
ok(tooBig && /handles files up to/.test(tooBig), "refuses files over the size limit: " + tooBig);
vm.runInContext("MAX_BYTES = 1024 * 1024 * 1024", ctx);

// ---------- 2e. Self-check catches broken output ----------
const goodVault = await ctx.encryptToHtml(new Blob(["hello"]), "a.txt", "tangerine-kayak-41");
const helloHash = await ctx.sha256(new TextEncoder().encode("hello"));
let caught;
const tampered = new Blob([(await goodVault.text()).replace(/D="([A-Za-z0-9+/])/, (m, c) => 'D="' + (c === "A" ? "B" : "A"))]);
caught = null; try { await ctx.verifyVault(tampered, "tangerine-kayak-41", "a.txt", helloHash); } catch (e) { caught = e; }
ok(caught, "self-check rejects a corrupted vault");
caught = null; try { await ctx.verifyVault(goodVault, "tangerine-kayak-41", "a.txt", await ctx.sha256(new TextEncoder().encode("other"))); } catch (e) { caught = e; }
ok(caught, "self-check rejects a vault whose contents don't match the original");
caught = null; try { await ctx.verifyPdf(pdfIn, "tangerine-kayak-41", 1); } catch (e) { caught = e; }
ok(caught?.message.includes("without a password"), "self-check rejects a PDF that opens without a password");
caught = null; try { await ctx.verifyPdf(pdfOut.blob, "correct-horse", 5); } catch (e) { caught = e; }
ok(caught?.message.includes("page count"), "self-check rejects a PDF whose pages changed");

// ---------- 3. Lint: no `onkey… = e => cond && fn()` (returns false => blocks typing) ----------
for (const f of fs.readdirSync(new URL("../ext", import.meta.url)).filter((f) => f.endsWith(".js") || f.endsWith(".html"))) {
  const src = fs.readFileSync(new URL("../ext/" + f, import.meta.url), "utf8");
  ok(!/\bonkey(down|press|up)\s*=/.test(src), `${f}: no onkey* handlers that can swallow keystrokes`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
