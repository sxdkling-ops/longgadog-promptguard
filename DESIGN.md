# PromptGuard PH design decisions

Follows the `salam-ui-ux` skill (controlled direction, ERP look), ported to plain HTML/CSS/JS because this project has
no React or Tailwind build. Accessibility and finishing the task win over looks.

## Where things live

| Surface | File | Notes |
|---|---|---|
| Tokens and component classes | `gateway/static/pg.css` | Single source for the gateway pages |
| App shell (sidebar, top bar, theme, status, toasts, icons) | `gateway/static/pg.js` | Loaded right after `<div id="shell">` |
| Audit overview | `gateway/static/dashboard.html` | Stat tiles, bars, events data table |
| Detection policy | `gateway/static/policy.html` | Client list form, reference table |
| Status pill and notices on chatbot pages | `extension/content.js` | Closed shadow DOM, `pointer-events: none`. Tokens are duplicated there. |

## Tokens

- Brand: Salam teal scale (`--brand-50…950`, oklch). `brand-700` for primary buttons and links, `brand-600` focus ring
  and chart marks (dark: `brand-400` ring, `brand-300` links).
- Neutrals: slate. Page `slate-50` / dark `slate-900`; cards white / `slate-800`; text `slate-900` / `slate-600`.
- Status badges: `100` background + `800` text (dark `950` + `200`), always with a word or icon.
- Type: 16px body and inputs, one `h1` at 24px, card titles 18px, table headers 12px uppercase.
- Spacing 4 · 8 · 12 · 16 · 20 · 24 · 32. Radius: controls 8, cards 12, floating panel 16, badges full.
- Elevation: hairline borders on cards; shadow only on the floating panel, launcher and toasts.
- Motion: 150ms colours, 200ms drawer and panel; disabled under `prefers-reduced-motion`.

## Rules specific to this project

- Dark mode is `html.dark` plus `data-theme`, saved under `pgph.theme`. The extension panel follows the host page:
  `data-theme`, then a `dark` / `light` class on `<html>`, then the system setting.
- Meaning by badge tone: red = secret, never sent; brand = replaced with a placeholder; green = local AI or clean;
  slate = neutral or sent as-is. The word is always present.
- The extension is an absolute guard: it has no buttons, panels, toggles or settings. It only shows a status pill and
  timed notices, announced through `role="status"`. Notices name types and counts, never values.
- The only primary action in the product is "Save client list" (also Ctrl+S), on the admin policy page.
- Record lists use the data table pattern (search, sort, pagination, cards below 640px). "What is detected" is marked
  `table-rule-exempt` because it is a short static reference list.
- Sidebar is fixed at 1024px and up, a drawer below that (Escape and backdrop close it).
- No raw values on the dashboard: it only ever shows categories and counts.

## Not done

- No collapsible desktop sidebar or "Go to" command search (three destinations do not need them).
- The extension panel has no automated contrast audit; it reuses the audited tokens.
