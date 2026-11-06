import fs from "fs"; import vm from "vm"; import * as PDFLib from "@cantoo/pdf-lib";
const ctx = { PDFLib, Blob, URL, TextEncoder, TextDecoder, crypto, btoa, atob, console, chrome: {} };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(new URL("../ext/crypto.js", import.meta.url),"utf8"), ctx);
const d = await PDFLib.PDFDocument.create(); const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
d.addPage().drawText("SecureDL sample: if you can read this, Preview unlocked it!", { x: 50, y: 700, size: 16, font: f });
for (const [b,n] of [[new Blob([await d.save()]),"sample.pdf"],[new Blob(["SecureDL sample text file. Unlocked successfully!\n"]),"sample-note.txt"]]) {
  const o = await ctx.encryptFile(b, n, "test1234"); fs.writeFileSync(new URL("../samples/", import.meta.url).pathname + o.filename, Buffer.from(await o.blob.arrayBuffer())); console.log(o.filename);
}
