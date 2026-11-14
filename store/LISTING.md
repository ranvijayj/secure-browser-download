# Chrome Web Store submission: copy/paste sheet

Live listing: https://chromewebstore.google.com/detail/olcbfjjoidcpkkadibkgpkpacmmahpga

## Store listing tab

**Name:** SecureDL – Password-protected downloads

**Summary** (132 char max):
Save downloads already password-protected. PDFs open in Preview; other files unlock in any browser. 100% local.

**Category:** Privacy & Security (or Productivity › Tools if that category isn't offered)

**Language:** English

**Description:**

Bank statements, tax forms, ID scans, contracts… They download to your Desktop or Downloads folder with no password, and they stay there.

SecureDL spots sensitive downloads as they start, stops them before anything is saved, and asks: lock it with a password? Or right-click any link → "Download with password". The file is downloaded into memory, encrypted on your device, and only the locked version is saved.

HOW IT OPENS (no app to install)
• PDFs are saved as standard AES-256 password-protected PDFs. Double-click and Preview (Mac), Acrobat or Chrome asks for the password.
• Every other file type is saved as a self-unlocking .html file (AES-256-GCM, PBKDF2 with 600,000 iterations). Double-click and type the password: the file opens right in your browser and stays locked. You can save an unlocked copy if you need to open it in another app. Works on Mac, Windows, Linux and phones.

FEATURES
• Automatic detection: asks when documents & images (or every file) start downloading
• "Always save from this site without asking" for sites you trust
• Works with downloads that pages build themselves, too
• "Recent downloads" shows what happened to each download and why
• Right-click any link, image or video → Download with password
• Lock a file that's already on your computer
• "Suggest a strong password": one click for a memorable four-word passphrase, with a Copy button
• A short welcome page on install sets everything up in under a minute
• Uses the page you're on to fetch the file, so downloads from sites you're signed in to still work

CHECKED BEFORE SAVING
• Every locked file is test-opened with your password and compared with the original before it's saved
• Refuses bot-check, login and error pages, so you never get a locked junk file
• Refuses programs disguised as documents (e.g. an .exe named invoice.pdf)
• Password confirmation, a strength meter and weak-password warnings
• Never overwrites an existing file

PRIVACY
• Everything happens locally in your browser. No servers, no accounts, no analytics, no tracking.
• Asks for no website access at install. It uses the tab you right-click in, and asks per site only if needed.
• Open source: https://github.com/ranvijayj/secure-browser-download

IMPORTANT: there is no password recovery. If you forget the password, the file cannot be opened. Keep the password in your password manager.

## Contact
- Developer contact email (Account page, shown publicly): `SecureDL-chrome@protonmail.com`
- Support URL: https://github.com/ranvijayj/secure-browser-download/issues

## Assets
- Icon: `ext/icons/128.png`
- Screenshots (1280×800): `store/screenshot-1.png`, `store/screenshot-2.png`
- Small promo tile (440×280): `store/promo-small.png`
- Promo video: upload `store/promo-video.mp4` (27 s, 1920×1080, no audio) to YouTube, then paste the YouTube link in the store's promo video field

## Privacy tab

**Single purpose:**
Save files the user chooses to download in password-protected (encrypted) form, so sensitive downloads are not stored unprotected on disk.

**Permission justifications:**
- `contextMenus`: adds the "Download with password" item to the right-click menu.
- `downloads`: saves the encrypted file to the user's Downloads folder. If the user turns on automatic detection, it also stops a starting download (so no unprotected copy is written) and asks whether to lock it; "Save without a password" restarts that download.
- `activeTab`: when the user right-clicks a link, fetches the file from that tab so the request carries the site's normal sign-in and bot-check state.
- `scripting`: runs the fetch for that file inside the tab the user right-clicked in (same reason as activeTab). No page content is read or changed.
- `storage`: remembers the detection setting and the user's "don't ask again" site list. No passwords or files are stored.
- Optional host access (`<all_urls>`), requested at runtime only: per site when a file is hosted on a different site than the page, or for all sites only if the user turns on automatic detection, so the detected file can be fetched for encryption.

**Remote code:** No. All code is bundled in the package.

**Data usage:** Check none of the data types. The extension does not collect or transmit any user data.
Certify: not sold to third parties; not used for unrelated purposes; not used for creditworthiness.

**Privacy policy URL:** `https://github.com/ranvijayj/secure-browser-download/blob/main/PRIVACY.md`

## Distribution tab
- Visibility: Public
- Regions: All
- Price: Free
