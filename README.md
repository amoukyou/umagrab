# UMAGrab

A Chrome extension that overlays real-time UMA Oracle status on Polymarket event pages.

When you visit any Polymarket event page, UMAGrab automatically fetches all markets in that event and shows their UMA Oracle settlement status in a floating panel.

## What it does

- **Auto-detect** — Opens a floating panel on any `polymarket.com/event/*` page
- **UMA status** — Shows each market's oracle state: `Requested`, `Proposed`, `Disputed`, or `Settled`
- **Market IDs** — Displays the `#market_id` for each market
- **Quick links** — Two buttons per market:
  - **tero** — Jump to [tero.market/uma](https://tero.market/uma) with that market expanded
  - **uma** — Jump to [oracle.uma.xyz](https://oracle.uma.xyz) with the exact transaction
- **Hover linking** — Hover over a market on the Polymarket page and the panel highlights the matching entry (and vice versa)
- **SPA-aware** — Detects navigation within Polymarket's single-page app and updates automatically

## How it looks

On each market row you see:

```
#1712295  Will WTI Crude Oil (WTI) hit (HIGH) $140 in April?
          REQUESTED                        [tero] [uma]
```

The top of the panel shows a summary:

```
Requested: 8  |  Proposed: 3  |  Settled: 3  |  Total: 14
```

## Data sources

1. **Gamma API** (`gamma-api.polymarket.com`) — Fetches the list of markets for the current event
2. **tero.market UMA API** (`tero.market/uma/api`) — Queries indexed UMA Oracle data (with fallback strategies: event_slug → siblings → individual search)

No API keys required. All data is public.

## Install

1. Clone this repo or download the ZIP
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder
5. Visit any Polymarket event page — the panel appears automatically

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Chrome Extension Manifest V3 config |
| `content.js` | Core logic: event detection, API calls, panel rendering, hover linking |
| `style.css` | Light-theme panel styles |
| `icon48.png` | Extension icon (48px) |
| `icon128.png` | Extension icon (128px) |

## How hover linking works

Polymarket renders market cards as Radix accordion items with an absolute-positioned overlay that captures mouse events. UMAGrab works around this by:

1. Selecting all market cards via `div[data-orientation="vertical"].group.cursor-pointer`
2. Matching them to Gamma API markets **by order** (verified to be identical)
3. Using `mousemove` with bounding-rect hit testing instead of `mouseenter` (which gets blocked by the overlay)

## License

MIT
