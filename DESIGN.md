# SecureDL design system

**Subject:** a privacy tool that stops sensitive downloads (bank statements, tax forms, ID scans) and saves them password-locked.
**Audience:** everyday people, mostly on a Mac, often mid-task on a bank or government site.
**Primary job of every screen:** make one quick, confident decision, "lock it or not", then get out of the way.
**Feeling:** calm, precise, trustworthy. Like official paperwork, not a hacker tool and not a SaaS dashboard.

## Direction: the security envelope

The thing everyone recognises from confidential mail is the **security envelope**: the fine blue-grey tint pattern printed inside so nobody can read through it. SecureDL uses that tint as its **one signature element**. The file you're about to save sits on a card with that pattern, like a document going into an envelope. When it's locked, the card is **sealed**: a solid tint with a lock mark. That seal is the only orchestrated motion in the product, and it happens in response to your action.

Everything else stays quiet: plain surfaces, one accent color, no gradients, no shadows, no decoration.

Checked against generic defaults, and rejected:
- cream background with a terracotta accent
- dark background with an acid accent
- rows of identical rounded cards
- all-caps eyebrow labels
- meta strings joined with "·"
- emoji used as icons
- arrows appended to buttons
- gradient washes

## Color

| Token | Light | Dark | Role |
|---|---|---|---|
| `--canvas` | `#F3F5F8` | `#0F1319` | Page background (tab pages) |
| `--surface` | `#FFFFFF` | `#171C24` | Inputs, label strip on the file card, popup background |
| `--ink` | `#142033` | `#E8ECF2` | Primary text |
| `--slate` | `#5A6577` | `#9AA4B4` | Secondary text, hints |
| `--line` | `#DCE2EA` | `#29313D` | Borders, dividers |
| `--tint` | `#C3CEDF` | `#2E3A4D` | Security-envelope pattern, seal |
| `--blue` | `#2242C7` | `#8EA6FF` | Primary actions, links, focus ring: "signature ink" |
| `--green` | `#16794A` | `#5BD08F` | Success: locked and saved |
| `--amber` | `#8A5300` on `#FFF4E0` | `#F2B866` on `#2E2414` | Warnings: weak password, unprotected file on disk |
| `--red` | `#B3261E` on `#FDECEA` | `#FF8A80` on `#341A19` | Errors: nothing was saved |

Text contrast is at least 4.5:1 on its background in both themes. The blue is the only accent; green, amber and red are used only for states.

## Typography

- **IBM Plex Sans** (bundled, OFL) for all UI: 400 text, 500 labels and buttons, 600 headings and filenames. Plex comes from engineering documentation, so it reads like a well-made form rather than a startup landing page.
- The self-unlocking `.locked.html` page uses the system UI font, because it must stay a single small file.
- Scale (px / line-height): 12/16 fine print, 13/18 hints, 15/22 body (14/20 in the popup), 17/24 filenames, 22/28 page titles. Sentence case everywhere. Numbers use `font-variant-numeric: tabular-nums`.

## Spacing, shape, depth

- 4px base scale: 4, 8, 12, 16, 20, 24, 32, 40.
- Tab pages: one left-aligned column, 460px max, 56px from the top. Popup: 340px wide, 16px padding.
- Radius: 6px for inputs and buttons, 10px for the file card and callouts. Nothing is pill-shaped except the strength meter segments.
- No shadows. Separation comes from `--line` borders and the canvas/surface contrast. Focus ring: 2px `--blue`, 2px offset, always visible.

## Components

- **File card**: tint-pattern border band (8px) around a surface label strip with a file icon, the filename (17/600), the site, and one state badge: "Stopped, nothing saved yet", "Saved without a password" (amber), or "Locked" (green, sealed).
- **Password field**: a visible label, and a text "Show/Hide" toggle inside the field (no eye emoji).
- **Strength meter**: 4 segments plus a word: Too short, Weak, Okay, Strong. Weak passwords still need a second press, with the reason given.
- **Confirmation**: a live "Passwords match" line (green) or "Doesn't match yet" (slate).
- **Buttons**:
  - Primary: blue fill, white text.
  - Secondary: surface fill with a line border.
  - Quiet: a link.
  - Busy state: a spinner plus a verb ("Locking…").
  - Disabled: 50% opacity.
- **Callout**: icon, one-line title, short body, at most one action. Variants are info (blue), warning (amber) and error (red). Errors say what happened and what to do; they never apologise.
- **Success panel**: replaces the form. Shows the sealed card, "Locked and saved to Downloads", and the actions *Show in folder* and *Done*.
- **Choice list** (popup mode): a radio row with a title and a one-line description. Selected rows get a blue border.
- **Activity row**: a status dot (blue asked, slate skipped, amber not intercepted), the filename, a short outcome and the time.

## Icons

One inline SVG set: 20px, 1.75px stroke, round caps, `currentColor`. Lock, file, check, alert, info, folder, settings. No emoji anywhere in the UI.

## Motion

Only on user action:
- the seal on success: the tint closes over the label in 280ms ease-out.
- callouts appear in 120ms.

All motion is off when `prefers-reduced-motion` is set.

## Copy

The product verb is **lock**: "Lock this download?", "Lock and save", "Locked and saved".
- **Save normally:** "Save without a password".
- **Never-ask:** "Always save from {site} without asking".

Say what happens, from the user's side, in sentence case. Keep fine print to one line: "If you forget this password, the file can't be opened. Nothing is uploaded."
