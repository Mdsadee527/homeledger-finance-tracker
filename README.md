# HomeLedger

A modern, offline household income & expense tracker. No install, no server, no accounts in the cloud — everything runs in your browser and data is stored locally.

## Run it

Double‑click **`index.html`** (or right‑click → Open with → your browser).
Works in Chrome, Edge, Firefox, Safari — desktop, tablet, and mobile.

## First steps

1. Click **Create account**, pick any username / password (stored only in this browser).
2. On the empty dashboard click **Load sample data** to explore, or start adding your own.
3. Use the green **＋ Income** / red **＋ Expense** buttons (top right) any time.

## Features

| Page | What it does |
|------|--------------|
| **Dashboard** | Totals, this‑month figures, income‑vs‑expense charts, recent transactions |
| **Transactions** | Full history — search, filter by type / month / category / date range, edit, delete, export CSV |
| **Monthly Budget** | Per‑category budgets with progress bars and over‑limit warnings |
| **Reports & Analytics** | Daily / weekly / monthly / yearly reports, category breakdown, savings trend, print to PDF |
| **Savings** | Total & monthly savings, savings rate, cumulative savings chart and history |
| **Calendar** | Month grid showing income/expense per day; click a day to see or add entries |
| **Categories** | Add / rename / delete your own income & expense categories |
| **Settings** | Currency symbol, light/dark theme, CSV & PDF export, JSON backup / restore, clear data |

## Your data

- Stored in your browser's `localStorage`, per account, on this device only.
- **Back it up:** Settings → *Download backup (JSON)*. Restore the same file on any device/browser.
- Clearing browser site data will erase it, so keep a backup.
- Export transactions to **CSV** (opens in Excel/Sheets) or a **PDF** via Settings / Reports.

## Notes

- The login is a lightweight local gate, not real security — anyone with access to this
  computer and browser profile can open the app. Don't treat it as a vault.
- Files: `index.html` (markup), `styles.css` (design, responsive + print), `app.js` (all logic).
  Everything is dependency‑free vanilla JS; charts are hand‑drawn SVG.
