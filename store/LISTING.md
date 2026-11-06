# Chrome Web Store submission: copy/paste sheet

## Store listing tab

**Name:** SecureDL – Password-protected downloads

**Summary** (132 char max):
Save downloads already password-protected. PDFs open in Preview; other files unlock in any browser. 100% local.

**Category:** Privacy & Security (or Productivity › Tools if that category isn't offered)

**Language:** English

**Description:**

Bank statements, tax forms, ID scans, contracts… They download to your Desktop or Downloads folder with no password, and they stay there.

SecureDL adds "Download with password" to the right-click menu. The file is downloaded into memory, encrypted on your device, and only the locked version is saved. The unprotected file never touches your disk.

HOW IT OPENS (no app to install)
• PDFs are saved as standard AES-256 password-protected PDFs. Double-click and Preview (Mac), Acrobat or Chrome asks for the password.
• Every other file type is saved as a self-unlocking .html file (AES-256-GCM, PBKDF2 with 600,000 iterations). Double-click, type the password in your browser, and the original file is restored. Works on Mac, Windows, Linux and phones.

FEATURES
• Right-click any link, image or video → Download with password
• Optional "Protect every download" mode
• Lock a file that's already on your disk
• Detects bot-check, login and error pages, so you never get a locked junk file
• Uses the page you're on to fetch the file, so downloads from sites you're signed in to still work

PRIVACY
• Everything happens locally in your browser. No servers, no accounts, no analytics, no tracking.
• Asks for no website access at install. It uses the tab you right-click in, and asks per site only if needed.
• Open source: [GitHub URL]

IMPORTANT: there is no password recovery. If you forget the password, the file cannot be opened. Keep the password in your password manager.

## Assets
- Icon: `ext/icons/128.png`
- Screenshots (1280×800): `store/screenshot-1.png`, `store/screenshot-2.png`
- Small promo tile (440×280): `store/promo-small.png`

## Privacy tab

**Single purpose:**
Save files the user chooses to download in password-protected (encrypted) form, so sensitive downloads are not stored unprotected on disk.

**Permission justifications:**
- `contextMenus`: adds the "Download with password" item to the right-click menu.
- `downloads`: saves the encrypted file to the user's Downloads folder; in the optional "Protect every download" mode, cancels the normal download so it can be saved encrypted instead.
- `activeTab`: when the user right-clicks a link, fetches the file from that tab so the request carries the site's normal sign-in and bot-check state.
- `scripting`: runs the fetch for that file inside the tab the user right-clicked in (same reason as activeTab). No page content is read or changed.
- `storage`: remembers whether "Protect every download" is on. No passwords or files are stored.
- Optional host access (`<all_urls>`), requested at runtime only: per site when a file is hosted on a different site than the page, or for all sites only if the user turns on "Protect every download".

**Remote code:** No. All code is bundled in the package.

**Data usage:** Check none of the data types. The extension does not collect or transmit any user data.
Certify: not sold to third parties; not used for unrelated purposes; not used for creditworthiness.

**Privacy policy URL:** `https://github.com/<you>/securedl/blob/main/PRIVACY.md`

## Distribution tab
- Visibility: Public
- Regions: All
- Price: Free
