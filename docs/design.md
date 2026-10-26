# Transmission Helm — visual design brief (v2, "Desktop console")

Reference points: Docker Desktop, Linear, Raycast, Arc. A console for a service, not a spreadsheet. Same features and shortcuts as before; different structure.

## Structure

```
┌──────────┬──────────────────────────────────────────────────────────────────┐
│ ⎈ Helm   │  Torrents                              ⌕ Search…     [ + Add ▾ ] │  header 52px
│          ├──────────────────────────────────────────────────────────────────┤
│ ▣ Torrents│ ┌ Downloading ┐ ┌ Seeding ┐ ┌ Transfer ┐ ┌ Disk ┐              │  stat cards
│ ⟳ Activity│ │ 3 · ↓1.2MB/s│ │ 9 ·↑80K │ │ 2.3 GB ↓ │ │1.2 TB│              │
│ ⚙ Daemon │ └─────────────┘ └─────────┘ └──────────┘ └──────┘              │
│          │ (All 47)(Downloading 3)(Seeding 9)(Stopped 2)(Error 1) · Folder ▾ Label ▾ Tracker ▾ · ⋯ │ filter chips
│          │ ┌──────────────────────────────────────────────────────────────┐ │
│          │ │ ☐ Name              Status      Progress   ↓     ↑    ETA  ⋯ │ │  table card
│          │ │ ☐ ubuntu-24.04…     ● Download  ━━━━░░ 52% 1.2M  80K  2h   ▶⏸🗑│ │
│          │ └──────────────────────────────────────────────────────────────┘ │
│ ● NAS ▾  │                                                                  │
│ ◐ Theme  │                                                                  │
└──────────┴──────────────────────────────────────────────────────────────────┘
          ┤ inspector (slides in from the right, 440px, over/beside the table) ├
Footer 28px: ● Connected · Transmission 4.1.3 · ↓ 1.6 MB/s ↑ 120 KB/s · Free 1.2 TB
```

### Rail (left, 200px, `--bg-rail`)

- Top: app mark (ship-wheel SVG in `--accent`, 22px) + "Transmission Helm" 13px semibold.
- Nav items 32px, 8px radius, 18px icon + label: **Torrents**, **Activity** (session statistics page: current/cumulative cards + a live speed graph), **Daemon** (Transmission options as a page), **Settings** (app options as a page). Active = `--rail-active-bg` + `--rail-active-fg`; hover `--hover`.
- Bottom: connection switcher pill (status dot + profile name + chevron; menu lists profiles and "Manage connections…"), and a theme segmented control (☀ / ☾ / ◐) bound to `app.settings.theme` via `app.updateSettings`.
- Rail is solid (`--bg-rail`) on all platforms; macOS vibrancy is turned off for v2 (set `vibrancy` undefined and `backgroundColor` to the page `--bg`). Keep the 78px traffic-light inset at the top of the rail: the app mark sits below it.

### Header (52px, `--bg-content`, bottom `--border`)

- Page title 15px semibold on the left. Centered-right: search field 280px (`.input`, magnifier, ⌘F). Right: `+ Add` primary split button (file / link), and a `⋯` ghost button with: Start all, Stop all, Alternate bandwidth (checkbox), Update blocklist, Update GeoIP, Columns…, Density ▸ (Comfortable/Compact).

### Torrents page

- **Stat cards** row (4 cards, 72px, `.card`): Downloading (count, ↓ total), Seeding (count, ↑ total), This session (downloaded/uploaded), Free space (bytes, with a thin usage bar when `total_size` known). Hidden when the window is narrower than 900px.
- **Filter chips** row: status chips with counts (selected = `--accent` bg, white text; others `.chip`), then dropdown chips Folder ▾ / Label ▾ / Tracker ▾ (menus with counts; selected value shown in the chip with an × to clear). Right end: density toggle (list/grid icon) and `⋯` for grouping options. Error chip is `.chip-danger` when count > 0.
- **Table card** (`.card`, fills the remaining height, scroll inside): header 36px `--fg-muted` 12px, sortable (chevron), column drag/resize/autosize preserved, right-click header → Columns dialog. Rows: comfortable 44px / compact 30px. Leading checkbox column (selection; shift/cmd still work on row click). Name cell: status dot icon + name (500 weight) + labels as tiny chips. **Status** cell: dot + text badge (Downloading accent, Seeding success, Stopped muted, Verifying warning, Error danger with the message in `title`). **Progress** cell: 6px bar + percent. Speeds, ETA, ratio, size etc. as columns per `app.ui.columns`. Trailing **actions** column (visible on hover/selection): ▶/⏸ toggle, ⋯ menu (full context menu). Selected rows `--selection`. No stripes, hover `--hover`, 1px `--border` row separators at 6% opacity.
- **Bulk bar**: when ≥1 selected, a floating pill at the bottom of the table card: "3 selected · Start · Stop · Remove · ⋯ · ×".
- **Empty states**: 48px inbox icon, title, hint, primary button.

### Inspector (details) — replaces the bottom pane

- Opens when a row is clicked (single click selects AND opens; Esc or × closes; selection stays). 440px panel on the right of the table card, resizable, with `--bg-content`, left `--border`. Header: name (14px semibold, two lines max) + status badge + close ×; a row of ghost icon actions (Start/Stop, Verify, Reannounce, Move, Labels, Remove ⋯).
- Segmented tabs: Overview · Files · Peers · Trackers. (Statistics moved to the Activity page.)
- Overview: progress card (bar + piece map + summary), then key/value groups "Transfer" and "Torrent" as stacked `.card`s (single column in 440px).
- Files/Peers/Trackers: the existing borderless tables, sized to the panel (fewer columns by default: Files = name/size/%/priority; Peers = host/country/client/↓/↑; Trackers = name/status/update in). Each table keeps its context menu and full column set via its own `⋯` chip at the top right of the tab.
- Window narrower than 1100px: the inspector overlays the table (slide-over with a scrim) instead of sitting beside it.

### Activity page

- Two `.card`s: Current session / Cumulative (downloaded, uploaded, ratio, files added, active time, sessions).
- A speed graph card: last 10 minutes of ↓/↑ from `app.snapshot.stats` sampled every poll, drawn on a canvas (accent + success lines, soft fills, 4 gridlines, legend). Keep samples in a renderer store; no new deps.

### Daemon page / Settings page

- The contents of the Transmission options and Application options dialogs rendered as pages: left column of section links (sticky), right column of `fieldset` groups with a sticky "Save changes" bar at the bottom appearing when dirty. Reuse the existing dialog form components by extracting their bodies into `DaemonOptionsForm.svelte` / `AppOptionsForm.svelte` used by both the page and the (still available) dialog.

### Theme

- `app.settings.theme` = system | light | dark. Renderer sets `<html data-theme>` ('light'/'dark', removed for system); CSS already handles both. Main mirrors it into `nativeTheme.themeSource` so native menus/dialogs match.

### Tokens and type

- Body 13px, `--fg`; secondary 12px; captions 11px uppercase `.section-title`; page title 15px; stat numbers 20px semibold (`--text-xl`).
- Radii: controls 6px, chips 999px, cards 12px, panels 12px.
- Accent `--accent` only for primary actions, active nav, selection, download progress. Green seeding, amber verifying, red error.
- Motion 120–180ms; inspector slides 200ms.
