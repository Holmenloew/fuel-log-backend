# VFK Fuel Log System

A digital fueling log for **Värnamo Flygklubb**, replacing paper fuel records with a shared web app backed by a Google Sheet. Tracks two separate tanks — 100LL and Jet A1 — independently, with their own logs, gauges, and calibration.



---

## How It Works

Three connected parts:

- **Frontend** (`public/index.html`) — the app itself. Runs entirely in the browser; never talks to Google directly.
- **Backend** (`netlify/functions/log-fuel.js`) — a Netlify Function that holds the Google service account credentials and is the only thing that reads or writes the Sheet.
- **Google Sheet** — the actual database. Every fueling, tank reading, and setting is a row. Tabs are created automatically by the backend as needed — nothing needs to be set up by hand inside the Sheet itself.

## Features

- Meter-based fueling log (Before/After pump counter readings, not manual liter entry), with sanity checks against implausible readings and a locked-by-default "Before" field to prevent accidental edits
- Two independently tracked tanks (100LL / Jet A1), each with its own capacity, dip-chart calibration, and pump counter calibration (for when a pump is physically replaced)
- Live tank-level gauge (estimated remaining volume + total dispensed), with a resettable dispensed counter
- Known Aircraft list with billing details (Name, Address, Phone, Email); unknown registrations trigger a one-time billing popup
- Wrong-tank fuel-type warning before a misfuel can be logged
- Whole-system access via QR code or passkey, separate from a fixed Settings password
- One-click, single-page printable tank sign (QR code + instructions + contact info)
- "Not connected" safety banner — the app never falls back to showing stale or locally-guessed numbers
- Excel export of all logged data, with a type-to-confirm gated option to clear the log history
- Shared Settings synced across every device via the Sheet's Config tab

## Project Structure

```
fuel-log-backend/
├── netlify.toml              Netlify build config
├── package.json              Declares the googleapis dependency
├── netlify/
│   └── functions/
│       └── log-fuel.js       Backend function (Google Sheets API)
└── public/
    ├── index.html            The app itself
    ├── favicon.ico
    ├── favicon-16x16.png
    ├── favicon-32x32.png
    ├── apple-touch-icon.png
    ├── icon-192.png
    ├── icon-512.png
    └── site.webmanifest
```

## Setup From Scratch

Full step-by-step instructions (including screenshots-worthy detail) are in the **VFK Fuel Log Manual**, Section 10. Short version:

1. **Create a Google Sheet** — any name, note its Sheet ID from the URL. No manual tab setup needed; the backend creates everything it needs on first use.
2. **Create a Google Cloud service account** — enable the Sheets API, create a service account, download its JSON key.
3. **Share the Sheet** with the service account's email (from the JSON key) as **Editor**. This is the most commonly missed step.
4. **Set environment variables** in Netlify (Site settings → Environment variables):

   | Variable | Value |
   |---|---|
   | `GOOGLE_CLIENT_EMAIL` | `client_email` from the JSON key file |
   | `GOOGLE_PRIVATE_KEY` | `private_key` from the same file, kept exactly as-is (including `\n` sequences) |
   | `SHEET_ID` | The Sheet ID from step 1 |
   | `FUEL_LOG_API_KEY` | Any long random string — the shared secret between the app and the backend |

5. Connect this repo to Netlify (`public` as the publish directory, `netlify/functions` as the functions directory — see `netlify.toml`) and deploy.

## Deploying Changes

Push to this repo's `main` branch (or use GitHub's web upload) and Netlify redeploys automatically. Most features touch **both** `public/index.html` and `netlify/functions/log-fuel.js` — update both together, or a change may silently only be half-applied.

> When editing `log-fuel.js` directly in GitHub's web editor, large pastes can silently get cut off. If the function crashes after an edit, re-paste the entire file from scratch and confirm the last line is exactly `};`.

## Security Notes

- The **system passkey** (QR code / manual entry) and the **Settings password** are two separate locks — getting into the app does not grant access to Settings.
- None of this is bank-grade security. Passwords and keys ultimately live in code that runs in the browser or in a small serverless function — this is meant to keep casual access and mistakes out, not to withstand a determined attacker.
- The backend's `FUEL_LOG_API_KEY` is the only thing standing between the public internet and your Sheet — keep it out of any public commits.

## Documentation

See the full **VFK Fuel Log Manual** (Word document) for complete usage instructions, an administrator's guide to every Settings feature, troubleshooting, and the full version history.

## Credits

Created by Holmenloew.
Developer: Daniel Holmenloew.
