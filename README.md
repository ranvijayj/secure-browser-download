<p align="center"><img src="assets/icon-512.png" width="96" alt=""></p>

# SecureDL

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/olcbfjjoidcpkkadibkgpkpacmmahpga?label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/olcbfjjoidcpkkadibkgpkpacmmahpga)

**Downloads that arrive already locked.** A Chrome extension that saves sensitive downloads, like bank statements, tax forms and ID scans, password-protected. It can spot them automatically and ask, or you can right-click any link. Everything runs locally.

![SecureDL](store/screenshot-1.png)

## Why

On a Mac, the usual routine is: download the PDF, open it in Preview, File → Export, tick *Encrypt*, type a password, save, then delete the original. Most people skip it, and the files sit unprotected in Downloads, or sync to iCloud Drive or Google Drive.

SecureDL turns that into one step. When a document starts downloading, it stops it before anything is saved and asks whether to lock it. Or you can right-click any link → **Download with password**.

## How the files open (nothing to install)

| Downloaded file | Saved as | Opens with |
|---|---|---|
| PDF | `name (locked).pdf`, standard AES-256 PDF encryption | Double-click → Preview / Acrobat / Chrome ask for the password |
| Anything else | `name.locked.html`, AES-256-GCM, PBKDF2-SHA256 (600k iterations) | Double-click → type the password → the file opens right in your browser. Nothing is saved unless you click **Save an unlocked copy** |

**Opening a locked file. There are only two ways, and SecureDL itself isn't needed for either:**
1. **A locked PDF:** open it as you'd open any PDF. Preview, Acrobat or Chrome asks for the password every time. The file stays locked on disk.
2. **Any other locked file (`.locked.html`):** double-click it and type the password. Images, PDFs and text files are shown right in the page. For other types (Word, Excel, zip…), click **Save an unlocked copy**, open that copy in its app, and delete it when you're done. The `.locked.html` file itself stays locked.

The `.locked.html` file is a small, self-contained page with no network access. It works offline on Mac, Windows, Linux and phones. The original filename is encrypted too.

Try it: `samples/` has one of each. The password is `test1234`.

## Install

- **Chrome Web Store (recommended):** [Add SecureDL to Chrome](https://chromewebstore.google.com/detail/olcbfjjoidcpkkadibkgpkpacmmahpga). It updates automatically.
- **Power users (unpacked, no automatic updates):**
  1. Download `SecureDL-vX.Y.Z.zip` from [Releases](https://github.com/ranvijayj/secure-browser-download/releases/latest) and unzip it.
  2. Go to `chrome://extensions` and turn on **Developer mode**.
  3. Click **Load unpacked** and select the unzipped folder.
- **From source:** `git clone https://github.com/ranvijayj/secure-browser-download` → `chrome://extensions` → turn on Developer mode → **Load unpacked** → select `ext/`.

### Releasing a new version
1. Bump `version` in `ext/manifest.json` (and `package.json`) and update `RELEASE_NOTES.md`.
2. Commit and push to `main`. GitHub Actions sees the new version, runs the tests, and publishes release `vX.Y.Z` with the zip. To do it by hand, go to **Actions → release → Run workflow**.
3. Upload the same zip to the Chrome Web Store.

## Use

- **Automatic:** toolbar icon → *When a download starts* →
  - **Ask me for documents & images** (PDF, Office, CSV, images, archives…), or
  - **Ask me for every download**.

  Chrome asks once to give SecureDL access to all sites, which it needs to fetch the file. If access is missing, the toolbar icon shows a red **!**.
  The download is **stopped immediately**, so nothing is saved, not even a partial file. Then a "Lock this download?" tab opens:
  - **Lock and save:** SecureDL downloads the file again and saves only the locked copy.
  - **Save without a password:** the download is restarted as normal.
  - **Always save from <site> without asking:** the same, and SecureDL stops asking for that site.
  - **Close the tab:** nothing is saved.

  Why stop instead of pause? Chrome holds a download for an extension for only about 10 seconds, then saves it anyway. That's too short to type a password.
  Downloads a page builds itself (`blob:` downloads) are handled too. If the file can't be fetched again (single-use links, files the page already discarded), choose **Download it normally, then lock it**. It's let through once; when it finishes you pick it, it's locked, and the unprotected copy is deleted.
  **Recent downloads** in the popup and Settings shows what SecureDL did with each download and why. Check it first if something wasn't intercepted.
- **First run:** a welcome page lets you choose a mode, give access and try it on a sample PDF.
- **Suggest a strong password** fills a four-word passphrase (from the EFF word list) with a Copy button.
- **Right-click** any link, image or video → **Download with password**.
- **Toolbar icon → Lock a file on this computer.** This opens in a tab, because on macOS a file dialog would close the toolbar popup.

## Checks before anything is saved

| Check | What happens |
|---|---|
| Password and confirmation match, at least 8 characters, no leading or trailing spaces | Blocked until fixed |
| Common, repeated or all-digit passwords | Warning; press again to use it anyway |
| Site returned a bot-check (Cloudflare), login, error or empty page instead of the file | Refused, nothing saved |
| A "document" that is really a program (Windows/Mac/Linux executable named `.pdf`, `.jpg`…) | Refused, nothing saved |
| File larger than 1 GB (everything is processed in memory) | Refused with a clear message |
| **Self-check:** the encrypted output is opened again with your password. A PDF must not open without the password and must keep its page count. A `.locked.html` file must decrypt to exactly the original bytes (SHA-256) and filename. | If any of this fails, nothing is saved |
| A file with the same name already exists | Saved as `name (1)…`, never overwritten |
| Automatic mode: a detected download | Stopped at once (Chrome deletes the partial file); nothing reaches the disk unless you choose Save without a password |

## Security model

- **Local only.** No servers, accounts, analytics or remote code. See [PRIVACY.md](PRIVACY.md).
- **Minimal permissions.** No website access at install. A right-click gives temporary access to that one tab (`activeTab`). Other sites are requested one at a time if needed, and all sites only if you turn on automatic detection.
- **Fetches like the page does.** The file is fetched from inside the tab you right-clicked in, so sign-ins and bot checks (for example Cloudflare) behave as they do for a normal download.
- **Refuses junk.** If a site returns a bot-check, login, error or empty page instead of the file, nothing is saved.
- **No recovery.** There is no backdoor and no password reset. Lose the password and the file is gone. Use a password manager.

What it does **not** protect against: malware on your computer, or someone watching you type the password. The file is held in memory unencrypted while it's being encrypted. Encryption also adds no protection once you unlock and save the original somewhere. In automatic mode, Chrome may briefly write part of the file to a temporary `.crdownload` file before SecureDL stops the download. Stopping it deletes that file. **Save without a password** downloads the file a second time.

## Limitations

- Files a site generates in the page itself (`blob:` downloads) can't be re-fetched. Download normally, then use **Lock a file on this computer**.
- Very large files (hundreds of MB) are processed in memory.
- PDFs that are already encrypted are saved as `.locked.html` instead.

## Development

```bash
npm install
npm test          # unit tests (needs qpdf) + end-to-end tests in real Chrome
npm run build     # dist/securedl-<version>.zip, ready for the Chrome Web Store
npm run screenshots
```

The end-to-end suite loads the extension into Chrome and types passwords with real keystrokes. It runs against a local server that imitates a Cloudflare-protected PDF, a login page, an image, and slow, instant and fake (`MZ`) downloads. It uses Chrome's real download handling, not Playwright's override, which skips the step extensions hook into. For automatic detection it checks:
- a fast 2 MB PDF leaves nothing on disk even after 45 seconds with the form unfilled.
- Lock and save, Save without a password, and Always save from <site> without asking each do what they say.
- installers are ignored in documents-only mode.
- page-made and single-use downloads work through the "download then lock" fallback.
- closing the tab saves nothing.

It also checks that the shipped manifest requests no site access up front.

## Design

The UI follows [DESIGN.md](DESIGN.md). It's a "security envelope" design: the tint pattern printed inside confidential envelopes marks the file card, and the card seals when the file is locked. It uses IBM Plex Sans, one ink-blue accent, and full light and dark themes. `node tools/shots.mjs <dir>` screenshots every screen in both themes.

## License

MIT. Bundles [pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (MIT) and [IBM Plex Sans](https://github.com/IBM/plex) (SIL Open Font License 1.1).
