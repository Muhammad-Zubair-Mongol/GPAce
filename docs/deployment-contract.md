# GPAce deployment contract

This contract separates the browser distribution from the authenticated API. Firebase Hosting serves only the generated `dist/` directory. The backend is the independently named Cloud Run service `gpace-api` in `us-central1`; Hosting rewrites `/api/**`, `/uploads/**`, `/settings/**`, and `/socket.io/**` to that service before the single page fallback.

The browser calls the backend through `js/services/ApiClient.js`. Every protected request obtains a current Firebase ID token, applies a deadline, normalizes JSON errors, and reports 401/403 as an authentication failure so the caller can retain its local draft. Upload consumers send multipart data to `/api/upload`, then send only the returned opaque `uploadId` to analysis routes. Socket.IO receives the same verified token through its handshake auth object and is authorized to the owner room by the backend.

Research, Tavily, timetable, study-space, settings, and subtask requests are backend calls. Application bearer tokens are never attached to direct Google or other provider URLs. The API gateway owns provider credentials and returns JSON errors; an unknown `/api/**` request must not fall through to `index.html`.

Hosting applies `X-Content-Type-Options: nosniff`, a strict origin referrer policy, same-origin framing, and a restrictive permissions policy. HTML is revalidated on every request. Static CSS, JavaScript, module, data, font, image, and SVG assets use immutable caching. The backend is responsible for the equivalent JSON, MIME, cache, and security headers when a request is rewritten.

The static boundary excludes server code, private/data/archive/audit material, uploads, tests, package metadata, and hidden tool state through `.firebaseignore` and the allowlisted Step 47 builder. No production deploy is part of this change.

The API `Dockerfile` installs Pandoc into the Cloud Run image during `gcloud run deploy --source .`. The `/api/status` response checks the same converter used by `/api/convert`, so the Markdown page enables DOCX conversion only when the binary is available. Run `npm run deploy` to verify and build the browser artifact, deploy the API image, and then deploy Firebase Hosting. The `gcloud` and Firebase CLIs must be authenticated to the `mzm-gpace` project; users do not install Pandoc on their devices.

## Verification

Use Node 22 or newer from the repository root:

```text
npm run build:static
npm run check:static
npm run check:modules
node tests/harness/run-case.cjs 54
```

`npm run verify:deployment` runs the non-publishing checks together. The command intentionally does not call Firebase deploy. A deployment must name the frontend `dist` artifact and backend `gpace-api` independently and must be approved outside this contract.

## Reproducibility record

The source contract input digest is recorded after the leased files are finalized. It is a SHA-256 over the sorted relative paths and bytes of the deployment contract inputs; it is a validation record only and is not a published artifact.

- Input digest: `75c409bd54444e807cf1f2ad94975b7075c2d8e6b1877eb42b79d72994f91e22`
- Production artifact: not published by Step 54
