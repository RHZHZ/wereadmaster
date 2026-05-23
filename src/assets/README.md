Generated and project-local visual assets used by the React application shell.

## Current Assets

- `hero-reading-dashboard.png`: dashboard hero atmosphere image.
- `empty-shelf.png`: bookshelf empty-state illustration.
- `empty-notes.png`: notes empty-state illustration.
- `report-card-bg.png`: statistics report background.
- `generated/onboarding-local-vault.png`: first-run local credential/data safety illustration.
- `generated/app-icon-master.png`: generated app icon source used to derive Tauri icon formats.
- `generated/release-cover.png`: release/download cover candidate; not imported by the app runtime.

## Image2 Generation Policy

Only generate bitmap assets when they materially improve onboarding, packaging, or empty states.
Do not generate normal UI controls, text-heavy panels, icons that should stay vector-like, or discovery/search content cards.

Recommended future Image2 assets:

- App icon master source, then export platform icon formats for Tauri.
- First-run credential onboarding illustration with no embedded text.
- Discovery empty recommendation illustration if real usage shows the current code-native empty state is too plain.
- Release/download cover image for sharing the installer.

Keep generated assets text-free where possible. UI copy should remain code-native for accessibility, localization, and responsive layout.

## Generated Asset Notes

- `app-icon-master.png` prompt: premium vector-friendly desktop app icon combining a book, reading notes, and subtle orbit/library motif; no text, letters, trademarks, or real logos.
- `onboarding-local-vault.png` prompt: text-free onboarding illustration showing reading shelf, private notes, and API key/data stored in a local desktop vault.
- `release-cover.png` prompt: text-free product launch cover with desktop reading dashboard silhouettes, book spines, notes, and local-first privacy atmosphere.
