# Local functionality audit — 2026-09-30

The app is usable locally for the flows verified below. This is not a claim that every envisioned feature works or that public deployment is complete.

## Verified here

- Static build: 20 pages, 199 files; module contract and deployment preflight pass.
- Browser matrix: 20 pages at 320, 390, 768, and 1440 pixels, in light, dark, and reduced-motion modes. The gate checks viewport overflow, 2× text sizing, focus, dialogs, local assets, and axe serious/critical findings. Reviewed exceptions and blocked external resources remain in `tests/fixtures/accessibility-matrix.json`.
- Main controls exercised in a local browser: academic semester menu, calendar view switching, extracted guide close, flashcard deck modal, Markdown sample and preview, priority formula help, alarms, subject-marks theme, and settings quote create/reload/delete.
- Pandoc 3.11, using the portable local binary via `PANDOC_PATH`: `/api/status` reports availability and a real Markdown-to-DOCX request produced a valid DOCX.
- Live Firebase access: an isolated Firestore record was saved, read back, and removed successfully. Firebase Authentication and the Firebase project are readable with application-default credentials.
- Live Gemini request: the local key responded successfully after changing the default model to `gemini-3.8-flash`.
- Backend contracts in the numbered harness cover auth isolation, uploads, settings, conversion errors and concurrency, task persistence/sync, timers, AI route failure handling, static deployment boundaries, accessibility, and performance fixtures.

## Work completed in this pass

Phone and 2× text layouts were corrected in landing, academic details, daily calendar, Markdown converter, and settings. Regression tests were aligned with cache-busted asset names and with settled browser layout. The local converter now accepts `PANDOC_PATH`.

The server now loads the local `.env` on direct startup, and Todoist's OAuth code exchange has been moved out of browser JavaScript. A mock exchange test verifies the origin check and confirms that the client secret stays server-side. The full 60-case harness passed again after these changes.

## Remaining limits

- Cloud deployment was not run. `mittifiedbusiness@gmail.com` authenticated with Google Cloud and application-default credentials, but billing is disabled on `mzm-gpace`; the Cloud Run API is also disabled. No Cloud Storage bucket appeared in the project's bucket list. These prerequisites block the durable upload API and a complete public release.
- Live Google sign-in through the app, Firestore writes such as flashcard deck creation, and Google Drive/Todoist connections were not end-to-end verified with real accounts. A visible local control or an offline contract test does not establish those integrations work in production.
- The Firebase password provider is disabled, and the available user credentials cannot sign Firebase custom tokens without enabling the IAM Credentials API and appropriate signing permission. Google sign-in through the app still needs a browser consent check.
- The old Todoist client secret was exposed in browser code before this fix. It must be rotated in Todoist's developer settings and the local `.env` updated before a live Todoist connection is safe to test or publish.
- The browser matrix blocks external requests; its documented waivers and lack of committed visual baselines limit what an accessibility pass proves.
- The portable Pandoc executable is currently under `temp/pandoc-3.11/pandoc-3.11/pandoc.exe`. The Cloud Run Dockerfile installs Pandoc, but a fresh local clone must install Pandoc or set `PANDOC_PATH` to a local copy for DOCX conversion.

Local run with the available portable converter (PowerShell):

```powershell
$env:PANDOC_PATH = (Resolve-Path 'temp/pandoc-3.11/pandoc-3.11/pandoc.exe').Path
npm.cmd start
```

The full numbered harness command is `node tests/harness/run-case.cjs --all`. Its current run log is `temp/final-harness.log`.
