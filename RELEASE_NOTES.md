**SecureDL saves sensitive downloads password-locked.** It stops a bank statement or tax form before it's saved and asks for a password. Only the locked copy reaches your disk. Everything happens on your computer.

**Most people should install from the [Chrome Web Store](https://chromewebstore.google.com/detail/olcbfjjoidcpkkadibkgpkpacmmahpga)**, which updates automatically.

## Install unpacked (power users)
1. Download **SecureDL-v1.4.1.zip** below and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped **SecureDL-v1.4.1** folder (the one that contains `manifest.json`).
4. Pin SecureDL from the puzzle-piece menu.
5. Optional: click the SecureDL icon → **Ask for documents** to have downloads stopped automatically. Chrome then asks once for access.

To update, unzip the new version over the old folder and click ↻ on the SecureDL card in `chrome://extensions`.

## What's in 1.4.1
- **Opening a locked file is clearer and safer.** A `.locked.html` file now opens for viewing in the page: images, PDFs and text are shown right there. An unlocked copy is saved only when you click **Save an unlocked copy**, with a reminder that it has no password. Before, unlocking saved an unprotected copy automatically.
- A clearer message when a site (for example GitHub) builds a file inside the page and discards it before SecureDL can save it.

## What's in 1.4.0
- A new "security envelope" design for every screen, with light and dark themes.
- Live password strength meter and confirmation check, plus **Show in folder** after saving.
- **Lock a file on this computer** now opens in a tab, so the macOS file dialog no longer closes the popup.
- Detected downloads are stopped before anything is saved (since 1.3.0).

## How locked files open
- **PDFs:** standard AES-256 password-protected PDF. Double-click it, and Preview or Acrobat asks for the password.
- **Other files:** a self-unlocking `.locked.html` file. Open it in any browser and enter the password; the file is shown right in the page.

There's no password recovery. Keep the password in your password manager.
