# Harness Execution Progress

Tracking engineering execution of `HARNESS_EXECUTION_PLAN.md` across 60 steps.

## Status Overview
- Total Steps: 60
- Completed Steps: 60 (Steps 46, 11, 40, 14, 13, 41, 16, 01, 02, 03, 04, 05, 06, 07, 15, 47, 24, 39, 08, 17, 18, 20, 09, 21, 19, 25, 42, 22, 23, 26, 10, 27, 30, 37, 12, 32, 38, 43, 49, 48, 29, 31, 34, 33, 35, 36, 44, 52, 28, 45, 50, 51, 54, 53, 55, 59, 56, 58, 57, 60)
- In-Progress Steps: 0
- Pending Steps: 0

---

## Published Read-Only Interface Agreement
All agents and tasks must conform to the following contracts:
1. **App Factory:** `createApp({ repositories, provider, jobs, auth, clock })` returns configured Express application without listening or calling `process.exit()`.
2. **Tenancy & Authentication:** Identity derived strictly from verified auth token (`req.user.uid`). Never trust client-supplied `userId` in body/params. All storage/uploads/jobs are scoped to verified UID.
3. **HTTP Error Envelope:** Standard JSON response shape `{ error: { code, message, requestId } }`. Secrets, internal stack traces, and absolute filesystem paths are strictly redacted.
4. **Task Envelope & State:** Canonical tasks include `{ id, version, revision, title, updatedAt, deleted: boolean }`. Tombstones track deletions deterministically.
5. **Durable-Write Acknowledgement:** Operations distinguish committed persistence from queued/pending outbox states. Never report success on failed or detached promises.
6. **Async Job Lifecycle:** Timetable/analysis jobs are owned by verified UID, bounded by timeouts, cancellable, and settle-once.

---

## Completed Tasks

### Step 46: Bootstrap an isolated deterministic verification harness
- **Track & Role:** Track D | Agent-Delta
- **Prerequisites:** NONE (Root bootstrap step)
- **Target Files Owned:**
  - `tests/harness/package.json`
  - `tests/harness/package-lock.json`
  - `tests/harness/run-case.cjs`
  - `tests/harness/helpers.cjs`
  - `tests/cases/46.test.cjs`
- **Actions Taken:**
  - Configured isolated `tests/harness/package.json` with dependencies `@firebase/rules-unit-testing`, `axe-core`, and `playwright`.
  - Installed and locked dependencies cleanly via `npm.cmd ci --prefix tests/harness`.
  - Created `tests/harness/helpers.cjs` offering deterministic test infrastructure:
    - Isolated temporary directory creation and auto-cleanup (`createTempDir`).
    - Web Storage API memory implementation with quota limits and mutation events (`createIsolatedStorage`).
    - Deterministic virtual clock with manual tick and timer queues (`createFakeClock`).
    - AI Provider mock for Gemini/Tavily with call logging and simulated statuses (`createProviderMock`).
    - Strict network guard intercepting `http.request`, `http.get`, `https.request`, `https.get`, and `globalThis.fetch` to prevent unauthorized external requests (`installNetworkGuard`).
    - Ephemeral local test server on `127.0.0.1:0` with clean connection shutdown (`createTestServer`).
    - Disposable browser profile helpers (`createDisposableBrowserProfile`).
    - Mock authentication identity factory (`createMockAuth`).
  - Created `tests/harness/run-case.cjs` supporting single case execution (`node tests/harness/run-case.cjs NN`) and batch runs (`--all`).
    - Enforced failure on missing test case files.
    - Enforced failure on skipped or todo assertions.
    - Enforced failure on unhandled errors, assertion failures, or empty test suites.
    - Preloaded network guard on all test processes.
  - Authored comprehensive self-tests in `tests/cases/46.test.cjs` verifying all runner contracts and helper modules.
- **Verification Commands & Results:**
  - `npm.cmd ci --prefix tests/harness`: Exited with code 0 (90 packages added, 0 vulnerabilities).
  - `node tests/harness/run-case.cjs 46`: Exited with code 0 (11/11 tests passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - Node 24 runtime was detected on host (plan specifies >= Node 22 compatibility). All code is verified on Node 24.18.0.
  - Step 46 unlock allows parallel scheduling of dependent tracks.

### Step 11: Make local JSON repositories durable and tenant-scoped
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `server/dataStorage.js`
  - `tests/cases/11.test.cjs`
- **Actions Taken:**
  - Implemented `ready()` lifecycle awaiting directories creation on cold start.
  - Implemented strict per-tenant partitioning under `data/users/<uid>/<store>.json` with disjoint in-memory caching.
  - Added strict UID validation preventing illegal characters and path traversal attacks with typed `StorageError`.
  - Added `MutexQueue` to serialize writes per tenant per store, ensuring concurrent append bursts retain every record.
  - Implemented temp-plus-rename atomic file replacement; simulated write/rename failures preserve last known good data and reject with typed error.
  - Implemented corrupt file preservation (`.corrupt.<timestamp>` files) with typed `CORRUPT_DATA` errors rather than silent defaults.
  - Enforced explicit owner migration (`migrateLegacyData`) for legacy singletons to prevent silent data inheritance.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 11`: Exited 0 (12/12 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - None. Ready for downstream integration in Steps 05, 08, 09.

### Step 40: Make local storage outcomes and user boundaries explicit
- **Track & Role:** Track C | Agent-Gamma
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `js/utils/StorageAdapter.js`
  - `js/services/StorageService.js`
  - `js/services/SecureStorage.js`
  - `js/auth.js`
  - `tests/cases/40.test.cjs`
- **Actions Taken:**
  - Implemented `StorageOutcome` with explicit typed statuses (`success`, `quota_exceeded`, `security_denied`, `corrupt`, `missing`).
  - Added strict distinction between quota errors (code 22) and security/sandbox errors (code 18).
  - Implemented user key-spacing (`gpace_u_<uid>_` for authenticated users and `gpace_anon_` for anonymous sessions).
  - Preserved uncommitted offline drafts across auth transitions while wiping in-memory user caches upon sign-out / account switch.
  - Ensured failed migrations retain the original source keys and data for recovery.
  - Hardened `SecureStorage`: throws `CryptoError` on failure and prohibits silent plaintext fallback; isolates PBKDF2 seeds per UID.
  - Scoped storage clear operations to current user namespace so third-party and unrelated origin data survive intact.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 40`: Exited 0 (16/16 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - Unblocks Step 41 (canonical task envelopes and one-way migration).

### Step 14: Refresh root runtime and vulnerable dependency lock
- **Track & Role:** Track A | Agent-Omega
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `package.json`
  - `package-lock.json`
  - `.nvmrc`
  - `tests/cases/14.test.cjs`
- **Actions Taken:**
  - Pinned Node 22 engine baseline in `.nvmrc` (`22`) and `package.json` (`engines: { "node": ">=22.0.0" }`).
  - Upgraded Express to `^4.22.3` (resolving CVEs in path-to-regexp, qs, and body-parser).
  - Upgraded Multer to `^2.4.0` meeting the reviewed floor for DoS and aborted upload fixes.
  - Added supported `@google/genai` (`^2.24.0`) and preserved `@google/generative-ai` (`^0.24.0`) as compatibility alias.
  - Upgraded `socket.io` to `^4.8.4` and `compression` to `^1.8.2`.
  - Regenerated `package-lock.json` cleanly; verified `npm.cmd audit` yields 0 production vulnerabilities.
  - Verified `npm.cmd ci` installs cleanly in ~7s with 0 vulnerabilities.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 14`: Exited 0 (11/11 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - Unblocks Steps 01, 02, 03, 06, 07, 12 in Track A.

### Step 13: Codify Firestore ownership and document-shape rules
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `firestore.rules`
  - `tests/cases/13.test.cjs`
- **Actions Taken:**
  - Rewrote `firestore.rules` with strict ownership enforcement (`isOwner(userId)`), denying all cross-user and unauthenticated reads and writes.
  - Implemented document-shape validation functions for task documents and task envelopes.
  - Defined explicit own-user subcollections: `tasks`, `completed-tasks`, `settings`, `academic`, `semesters`, `subjects`, `alarms`, `flashcards`, `workspaces`.
  - Barred legacy `/projects` and denied unknown top-level collection access.
  - Built comprehensive behavioral test suite in `tests/cases/13.test.cjs` using `@firebase/rules-unit-testing`.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 13`: Exited 0 (24/24 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - Unblocks Step 42 (replace cloud list overwrites with acknowledged revisions).

### Step 41: Validate canonical task envelopes and one-way migration
- **Track & Role:** Track C | Agent-Gamma
- **Prerequisites:** Steps 40, 46
- **Target Files Owned:**
  - `js/core/TaskRepository.js`
  - `js/core/TaskSystemLoader.js`
  - `tests/cases/41.test.cjs`
- **Actions Taken:**
  - Implemented typed envelope parsing (`readEnvelope` / `_readV5`) returning typed statuses (`valid`, `missing`, `corrupt`) with schema (`gpac_v5`), version, array, task identity (`id`), and checksum validation.
  - Made valid empty v5 envelopes (`data: []`) and committed migration markers authoritative, preventing resurrection of legacy keys (resolving ST01/ST03).
  - Preserved corrupted JSON envelopes in storage for explicit recovery without blind overwrites.
  - Implemented UID-derived tenancy: all direct repository keys, migration markers, priority caches, and backups scoped under `gpac_u_<uid>_` (or `gpac_anon_`), preventing cross-user leakage or legacy task theft.
  - Exposed `ready()` lifecycle contract to page consumers; guarded `TaskSystemLoader` so readiness never reports healthy after failed initialization.
  - Removed dangerous global `localStorage` monkeypatches.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 41`: Exited 0 (13/13 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - Unblocks Step 42 (along with Step 13, Step 40, Step 46).

### Step 16: Repair Grind page module bootstrap
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `grind.html`
  - `js/pages/grind.js`
  - `tests/cases/16.test.cjs`
- **Actions Taken:**
  - Consolidated Grind startup around the native `js/pages/grind.js` module entry and removed the unreferenced `GrindInitializationController` mount.
  - Added exported, awaited `initGrindPage`, `getGrindState`, and `destroyGrindPage` lifecycle functions with idempotent initialization.
  - Guarded optional DOM controls and unavailable storage so missing dependencies do not create uncaught listener or persistence errors.
  - Added behavioral coverage for script topology, duplicate references, essential markup, repeated initialization, missing DOM elements, and disabled storage.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 16`: Exited 0 (8/8 tests passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - The run emitted Node's existing `MODULE_TYPELESS_PACKAGE_JSON` warning for the browser module; it does not affect the acceptance result and should be considered when the root module/build strategy is revisited.
  - `py .ua/audit/validate_harness.py` could not be rerun in this shell because the installed Python launcher returned an access-denied error for its managed runtime.

### Step 01: Extract an injectable Express application factory
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 14 and 46
- **Target Files Owned:**
  - `server/app.js`
  - `tests/cases/01.test.cjs`
- **Actions Taken:**
  - Added an asynchronous `createApp({ repositories, provider, jobs, auth, clock })` factory that composes Express middleware without opening a listener, reading credentials, mutating process environment, or constructing a provider implicitly.
  - Awaited injected provider readiness and surfaced startup failures to the caller instead of converting them into a false-ready application.
  - Added an ephemeral HTTP fixture route, health response, dependency injection storage, and sanitized application error boundary for the isolated factory contract.
  - Added behavioral coverage for provider readiness, injected repository routing, controlled bootstrap failure, and listener-free import/factory use.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 01`: Exited 0 (4/4 tests passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - The legacy `server.js` listener and route surface remains wired separately until the later router integration steps; the factory is the new isolated composition boundary for downstream work.

### Step 02: Define verified identity and HTTP error middleware
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 14 and 46
- **Target Files Owned:**
  - `server/middleware/auth.js`
  - `server/middleware/errors.js`
  - `tests/cases/02.test.cjs`
- **Actions Taken:**
  - Added injectable bearer-token verification with Firebase loading deferred until an authenticated request, deriving ownership only from the verified `uid`.
  - Added explicit ownership checks and a configured origin policy with denied-origin preflight behavior.
  - Standardized typed JSON errors as `{ error: { code, message, requestId } }`, with stable request IDs and redaction of provider credentials and filesystem paths.
  - Added behavioral tests for missing/invalid tokens, cross-user ownership, origin policy, internal-error redaction, and typed public errors.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 02`: Exited 0 (5/5 tests passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - These middleware factories are exported for later secured-router integration; the legacy server remains mounted separately until Step 49.

### Step 03: Create a dedicated public asset boundary
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 14 and 46
- **Target Files Owned:**
  - `server/public-assets.js`
  - `tests/cases/03.test.cjs`
- **Actions Taken:**
  - Added an explicit absolute build-directory boundary with realpath containment checks, dot/path traversal rejection, and no repository-root default.
  - Added nosniff and cache policy headers, static asset serving, and a narrow HTML navigation fallback that never captures API/source/private paths.
  - Added fixture coverage proving public assets work while source, data, lockfiles, archives, dot paths, and traversal requests return 404.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 03`: Exited 0 (3/3 tests passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - Step 47 owns the reproducible build directory; Step 49 owns mounting this boundary into the final application order.

### Step 04: Implement owned and content-validated image uploads
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 02, 14, 46
- **Target Files Owned:**
  - `server/routes/uploads.js`
  - `server/services/upload-store.js`
  - `tests/cases/04.test.cjs`
- **Actions Taken:**
  - Added authenticated multipart upload handling that derives the owner from verified identity, limits file count and bytes, validates image signatures/dimensions, publishes through a temporary file and atomic rename, and returns opaque upload IDs.
  - Added canonical per-user reads with realpath containment and symlink escape rejection; invalid content and partial uploads do not become durable files.
  - Added behavioral coverage for valid round trips, spoofed HTML, size/count limits, cross-user reads, and symlinked owner directories.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 04`: Exited 0 (4/4 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - Windows canonicalizes temporary paths through both 8.3 and long-name forms; the store now uses the resolved realpath consistently before containment checks.

### Step 05: Replace broken settings reads with an owned contract
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 02, 11, 14, 46
- **Target Files Owned:**
  - `server/routes/settings.js`
  - `tests/cases/05.test.cjs`
- **Actions Taken:**
  - Added an authenticated per-user settings router with allowlisted fields, atomic writes, owner checks, and defaults only for a genuinely missing file.
  - Preserved distinct corrupt JSON and permission/unavailable responses instead of converting them into empty settings.
  - Added behavioral coverage for save/load, missing defaults, corrupt and permission failures, forged user IDs, and unsupported fields.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 05`: Exited 0 (4/4 passed, 0 skipped, 0 failed).

### Step 06: Bound document conversion and isolate temporary files
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 14, 46
- **Target Files Owned:**
  - `server/routes/conversion.js`
  - `server/services/converter.js`
  - `tests/cases/06.test.cjs`
- **Actions Taken:**
  - Added validated markdown/byte limits, request-specific temporary directories, argument-array Pandoc execution with bounded output/deadline, typed unavailable/timeout errors, and independent cleanup attempts.
  - Added behavioral coverage for invalid input, unavailable tools, concurrent isolation, hung-child termination, download cleanup, and cleanup failures.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 06`: Exited 0 (6/6 passed, 0 skipped, 0 failed).

### Step 07: Separate provider initialization from browser image APIs
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 14, 46
- **Target Files Owned:**
  - `server/services/gemini-provider.js`
  - `js/imageAnalyzer.js`
  - `tests/cases/07.test.cjs`
- **Actions Taken:**
  - Added request/user-scoped provider construction with an awaited ready contract, isolated configuration, no per-request environment mutation, and failure-before-generation behavior.
  - Split Node Buffer/file/data URL ingestion from the browser FileReader adapter while preserving browser exports.
  - Added behavioral coverage for readiness ordering, initialization failure, identity/configuration isolation, and Node operation without browser globals.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 07`: Exited 0 (4/4 passed, 0 skipped, 0 failed).

### Step 15: Modernize the Firebase callable runtime and configuration
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `functions/package.json`
  - `functions/package-lock.json`
  - `functions/index.js`
  - `tests/cases/15.test.cjs`
- **Actions Taken:**
  - Migrated the availability callable to the Functions v2 `onCall` surface with `defineSecret('GEMINI_API_KEY')`, Node 22 metadata, and a response limited to key availability.
  - Removed the unused legacy Gemini SDK from the Functions lockfile and kept module loading free of client construction or network calls.
  - Added behavioral coverage for runtime/lock state, secret API usage, missing/configured local secrets, and import-time side effects.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 15`: Exited 0 (4/4 passed, 0 skipped, 0 failed). Firebase emitted its expected missing-local-secret warning during the fixture.

### Step 47: Build an allowlisted multi-page static distribution
- **Track & Role:** Track D | Agent-Omega
- **Prerequisites:** Steps 46, 14
- **Target Files Owned:**
  - `scripts/build-static.mjs`
  - `config/assets-manifest.json`
  - `tests/cases/47.test.cjs`
- **Actions Taken:**
  - Added an explicit 20-page distribution allowlist with native-module, CSS, media, import-map, alias, virtual-endpoint, duplicate, and external-resource validation.
  - Added forbidden-file exclusions and reproducible clean-build output checks, keeping private/backend/data/archive/audit/upload/lock artifacts out of the distribution.
  - Added deterministic fixtures covering topology, aliases, import-map resolution, duplicate entries, missing references, unsafe externals, exclusions, and reproducibility.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 47`: Exited 0 (8/8 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - The full application graph still reports existing unpinned Chart.js CDN and missing `css/search-modal.css` source-topology blockers; no production distribution was generated or deployed.

### Step 24: Make priority scoring and worker results deterministic
- **Track & Role:** Track B | Agent-Gamma
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `priority-calculator.js`
  - `js/priority-worker-wrapper.js`
  - `tests/cases/24.test.cjs`
- **Actions Taken:**
  - Added a deterministic calendar-day scoring policy with finite hostile-input handling, overdue caps, and stable project/task tie ordering.
  - Added a bounded worker wrapper with explicit silent-exit, timeout, termination, and cleanup outcomes while keeping direct and worker paths equivalent.
  - Added behavioral coverage across timezone offsets, DST, invalid numerics/dates, ordering, worker agreement, silent exit, and deadlines.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 24`: Exited 0 (5/5 passed, 0 skipped, 0 failed).

### Step 39: Bound timer persistence and verify one active owner
- **Track & Role:** Track C | Agent-Gamma
- **Prerequisites:** Steps 16, 40, 46
- **Target Files Owned:**
  - `js/pomodoroTimer.js`
  - `js/controllers/TimerController.js`
  - `js/pomodoroGlobal.js`
  - `tests/cases/39.test.cjs`
- **Actions Taken:**
  - Bounded persistence to the five-second boundary, made deadline completion idempotent across background jumps, and disposed stale callbacks/listeners on teardown.
  - Made timer-controller initialization idempotent and enforced one active global Pomodoro owner with clean disposal.
  - Added behavioral coverage for persistence cadence, background completion, pause/resume/reset semantics, repeated construction, and controller lifecycle.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 39`: Exited 0 (5/5 passed, 0 skipped, 0 failed).

### Step 08: Make timetable analysis an atomic bounded job
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 02, 04, 07, 11, 46
- **Target Files Owned:**
  - `server/routes/timetable.js`
  - `server/services/analysis-jobs.js`
  - `tests/cases/08.test.cjs`
- **Actions Taken:**
  - Added owned upload-ID validation, bounded queue/worker lifecycle, settle-once cancellation and deadline handling, and atomic replacement persistence that preserves the prior timetable on failed analysis or persistence.
  - Scoped cache and socket output by verified user, validated event dates/times/timezones, and released queue capacity on cancellation.
  - Added behavioral coverage for failure/silent-exit/timeout/persistence-error preservation, foreign uploads, tenant isolation, schema validation, and cancellation cleanup.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 08`: Exited 0 (5/5 passed, 0 skipped, 0 failed).

### Step 17: Repair Settings page startup and missing entry reference
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `settings.html`
  - `js/pages/settings.js`
  - `tests/cases/17.test.cjs`
- **Actions Taken:**
  - Consolidated Settings startup on one explicit module entry, removed the stale entry reference, and made initialization idempotent with guarded optional navigation dependencies.
  - Made offline/storage failures visible as pending/failed state instead of false saved success.
  - Added behavioral coverage for entry topology and the initialization/persistence failure contract.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 17`: Exited 0 (2/2 passed, 0 skipped, 0 failed). The fixture emits the expected missing-document/module warning while exercising the guarded path.

### Step 18: Make Workspace editor startup deterministic
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `workspace.html`
  - `js/workspace-core.js`
  - `tests/cases/18.test.cjs`
- **Actions Taken:**
  - Added a single explicit Quill dependency/readiness boundary, loads it once, and restores editor content only after readiness.
  - Added retryable initialization failure state and blocked early writes until the editor is ready.
  - Added behavioral coverage for successful readiness/content restoration, failed-load retry behavior, duplicate script prevention, and the explicit readiness promise.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 18`: Exited 0 (3/3 passed, 0 skipped, 0 failed). Node emitted its existing module-type warning for the browser module.

### Step 20: Unify theme and semantic color tokens
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `css/design-tokens.css`
  - `js/theme-manager.js`
  - `js/themeManager.js`
  - `tests/cases/20.test.cjs`
- **Actions Taken:**
  - Unified stored/system theme selection behind one API and kept the historical filename as a compatibility facade.
  - Added semantic foreground, muted, accent, and link tokens with contrast assertions for both themes.
  - Added behavioral coverage for persisted preference round trips, first-load system preference, semantic WCAG AA contrast, and compatibility loading.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 20`: Exited 0 (3/3 passed, 0 skipped, 0 failed). Node emitted its existing browser-module type warning.

### Step 09: Isolate study-space analysis and location storage
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 02, 04, 07, 11, 46
- **Target Files Owned:**
  - `server/routes/study-spaces.js`
  - `tests/cases/09.test.cjs`
- **Actions Taken:**
  - Added an owned study-space router that validates upload ownership before provider use, parses and validates provider output, and distinguishes analysis success from durable-save success.
  - Added tenant-scoped location retrieval and prevented malformed output or storage failure from being reported as a saved result.
  - Added behavioral coverage for auth/order of operations, malformed provider JSON, persistence failure, owner retrieval, and cross-user isolation.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 09`: Exited 0 (4/4 passed, 0 skipped, 0 failed).

### Step 21: Replace unsafe task-card string interpolation
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `js/controllers/TaskDisplayController.js`
  - `tests/cases/21.test.cjs`
- **Actions Taken:**
  - Reworked priority task rendering to use inert text nodes/validated action IDs, avoiding HTML interpolation of hostile task fields.
  - Added deterministic render hashing that skips identical successful renders but keeps failed renders retryable, with repository injection and inert error-state text.
  - Added behavioral coverage for hostile fields, action delegation, duplicate-render behavior, failed-render retry, and injected repositories.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 21`: Exited 0 (3/3 passed, 0 skipped, 0 failed). Node emitted its existing browser-module type warning.

### Step 19: Consolidate shared navigation rendering
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `js/components/NavigationComponent.js`
  - `css/components/navigation.css`
  - `tests/cases/19.test.cjs`
- **Actions Taken:**
  - Consolidated navigation injection around one landmark, current-route state, and idempotent reinjection behavior.
  - Defined separate mobile and desktop visibility contracts so desktop navigation remains usable without an unnecessary modal trap.
  - Added behavioral coverage for landmark/current-route output, repeated rendering, and responsive visibility semantics.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 19`: Exited 0 (2/2 passed, 0 skipped, 0 failed). Node emitted its existing browser-module type warning.

### Step 25: Normalize and validate academic mark entries
- **Track & Role:** Track B | Agent-Gamma
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `js/subject-marks.js`
  - `js/subject-marks-ui.js`
  - `tests/cases/25.test.cjs`
- **Actions Taken:**
  - Added case/whitespace-normalized category mapping, strict finite/range/positive-total validation, and durable-write ordering for subject marks.
  - Preserved the previous durable entry and entered UI values across cloud persistence failure, and updated weighted performance only after durable success.
  - Added a narrow browser-listener guard in the adjacent `js/weightage-connector.js` import boundary so the real module can be exercised in Node fixtures without changing browser registration.
  - Added behavioral coverage for category normalization, invalid values, weighted updates, persistence failure retention, and UI/cloud failure behavior.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 25`: Exited 0 (5/5 passed, 0 skipped, 0 failed). The fixture emits expected validation/persistence diagnostics and the existing browser-module type warning.

### Step 42: Replace cloud list overwrites with acknowledged revisions
- **Track & Role:** Track C | Agent-Gamma
- **Prerequisites:** Steps 13, 40, 41, 46
- **Target Files Owned:**
  - `js/firestore.js`
  - `js/services/SyncOutbox.js`
  - `tests/cases/42.test.cjs`
- **Actions Taken:**
  - Added revision/tombstone merge semantics that preserve disjoint stale-client edits, prefer newer tombstones, and allow only explicitly newer reopens.
  - Added a persistent per-user/project outbox with revision coalescing, failed-work retention, explicit acknowledgement, and idempotent replay protection.
  - Added a Firestore transaction/status boundary without network access in the fixture.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 42`: Exited 0 (6/6 passed, 0 skipped, 0 failed).

### Step 22: Harden stored link rendering and URL policy
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `js/taskLinks.js`
  - `tests/cases/22.test.cjs`
- **Actions Taken:**
  - Added HTTP(S)-only URL normalization, rejected dangerous/custom schemes and disallowed bare URLs, and rendered malformed imported records visibly without click targets.
  - Replaced string HTML/inline JavaScript paths with inert DOM construction, safe external-link attributes, validated action delegation, and task-scoped deletion.
  - Added behavioral coverage for URL policy, malformed records, safe opening, stored-link isolation, and source-level absence of unsafe rendering patterns.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 22`: Exited 0 (2/2 passed, 0 skipped, 0 failed).

### Step 23: Isolate generated simulations from the application origin
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Steps 16, 46
- **Target Files Owned:**
  - `js/ai-researcher.js`
  - `grind.html`
  - `tests/cases/23.test.cjs`
- **Actions Taken:**
  - Reduced generated simulation frames to `sandbox="allow-scripts"`, removed same-origin and unnecessary permissions, and added explicit frame title/size semantics.
  - Added a source-checked per-session token and opaque-origin `postMessage` handshake that rejects forged source/origin/token messages, times out, cleans listeners, and exposes a retryable failure path.
  - Added behavioral coverage for handshake authenticity, timeout/recovery, static/regenerated sandbox markup, and forbidden permissions.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 23`: Exited 0 (3/3 passed, 0 skipped, 0 failed).

### Step 26: Resolve Grind mobile panel collisions
- **Track & Role:** Track B | Agent-Delta
- **Prerequisites:** Steps 16, 46
- **Target Files Owned:**
  - `grind.css`
  - `css/grind.css`
  - `tests/cases/26.test.cjs`
- **Actions Taken:**
  - Added local responsive sizing constraints for the Grind control rail/panels and heading so open/closed mobile states stay within the viewport without blanket overflow hiding.
  - Added deterministic viewport coverage at 320, 390, 768, and 1440 pixels, including fixed-control collision checks and overflow policy.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 26`: Exited 0 (3/3 passed, 0 skipped, 0 failed).

### Step 10: Give research proxy explicit deadlines and safe errors
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 02, 07, 46
- **Target Files Owned:**
  - `server/routes/research.js`
  - `tests/cases/10.test.cjs`
- **Actions Taken:**
  - Added validated query/model/temperature contracts, authenticated per-user concurrency limits, bounded upstream deadlines, cancellation propagation, and typed timeout/rate/upstream errors.
  - Kept retries disabled for committed requests and redacted query/key content from ordinary logs; injected provider adapters keep the fixture offline.
  - Added behavioral coverage for malformed/anonymous input, upstream 429, deadlines, concurrency-slot release, and client cancellation.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 10`: Exited 0 (5/5 passed, 0 skipped, 0 failed).

### Step 27: Repair Tasks page loading and empty/error states
- **Track & Role:** Track B | Agent-Delta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `tasks.html`
  - `js/tasksManager.js`
  - `tests/cases/27.test.cjs`
- **Actions Taken:**
  - Distinguished disconnected, loading, valid-empty, failure, and recovered task states without silently authenticating or forcing reloads.
  - Added one bounded retry and preserved project/section/sort/search filters across refresh.
  - Added behavioral coverage for absent integration/search controls, empty-account rendering, retry recovery, and filter persistence.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 27`: Exited 0 (4/4 passed, 0 skipped, 0 failed).

### Step 30: Repair stale entry-page asset references
- **Track & Role:** Track B | Agent-Delta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `index.html`
  - `landing.html`
  - `academic-details.html`
  - `priority-calculator.html`
  - `tests/cases/30.test.cjs`
- **Actions Taken:**
  - Removed known stale local resource references, kept remaining local assets resolvable, and guarded the index redirect against repeated execution.
  - Preserved the landing page viewport contract at phone widths and exposed the priority formula helper as a named, readable control.
  - Added behavioral/static coverage for asset resolution, responsive landing layout, operable priority helper copy, and redirect idempotence.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 30`: Exited 0 (4/4 passed, 0 skipped, 0 failed).

### Step 37: Make conflict resolution dialog keyboard-accessible
- **Track & Role:** Track C | Agent-Delta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `js/components/ConflictModal.js`
  - `tests/cases/37.test.cjs`
- **Actions Taken:**
  - Added a named dialog lifecycle that inerts the background, traps focus, restores the opener, and keeps Escape from silently resolving a conflict.
  - Serialized concurrent conflict shows and prevented deferred conflicts from being reported as synced.
  - Added behavioral coverage for dialog semantics/focus, unresolved Escape behavior, serialization, and truthful sync status.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 37`: Exited 0 (2/2 passed, 0 skipped, 0 todo, 0 failed).

### Step 12: Validate subtask operations at the server boundary
- **Track & Role:** Track A | Agent-Alpha
- **Prerequisites:** Steps 02, 07, 14, 46
- **Target Files Owned:**
  - `server/routes/subtasks.js`
  - `tests/cases/12.test.cjs`
- **Actions Taken:**
  - Added authenticated subtask input validation, provider-output validation, bounded execution/deadline handling, and task identity checks before returning results.
  - Added one behavioral contract covering authorization, malformed input/provider output, deadlines, and identity preservation.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 12`: Exited 0 (1/1 passed, 0 skipped, 0 failed).

### Step 32: Give the settings drawer a complete focus lifecycle
- **Track & Role:** Track C | Agent-Delta
- **Prerequisites:** Step 46
- **Target Files Owned:**
  - `js/sideDrawer.js`
  - `css/sideDrawer.css`
  - `tests/cases/32.test.cjs`
- **Actions Taken:**
  - Added mobile modal semantics with inert background, initial focus, Escape handling, focus trapping, and opener restoration.
  - Kept desktop behavior as a non-modal complementary panel with immediate docked visibility and restored focus.
  - Added behavioral coverage for both responsive modes, focus lifecycle, ARIA/inert state, Escape, and keyboard trapping.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 32`: Exited 0 (2/2 passed, 0 skipped, 0 failed).

### Step 38: Distinguish recovery from a legitimate empty first run
- **Track & Role:** Track C | Agent-Delta
- **Prerequisites:** Steps 41, 46
- **Target Files Owned:**
  - `js/components/RecoveryModal.js`
  - `tests/cases/38.test.cjs`
- **Actions Taken:**
  - Made empty/invalid backup stores an honest hidden fresh result and kept recovery actions behind a named dialog with disabled empty slots, inert background, focus trap, and safe Escape deferral.
  - Awaited repository restore, retained backups after failure, supported retry, restored the opener, and removed reload-based recovery behavior.
  - Added behavioral coverage for fresh-run handling, dialog/accessibility lifecycle, async restore failure, retention, retry, and no reload.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 38`: Exited 0 (3/3 passed, 0 skipped, 0 failed).

### Step 43: Bridge TaskService to one validated task repository
- **Track & Role:** Track C | Agent-Delta
- **Prerequisites:** Steps 21, 41, 42, 46
- **Target Files Owned:**
  - `js/services/TaskService.js`
  - `js/controllers/TaskDisplayController.js`
  - `tests/cases/43.test.cjs`
- **Actions Taken:**
  - Added an injectable canonical repository facade with validated IDs/defaults, truthful local commit outcomes, and explicit stale tombstone versus newer reopen policy.
  - Made TaskDisplayController consume canonical state exactly once while preserving legacy caller compatibility.
  - Added behavioral coverage for malformed/default-overridden tasks, failed commits/cache/version rollback, stale pending/deleted state, explicit reopen, and display-read count.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 43`: Exited 0 (4/4 passed, 0 skipped, 0 failed). Node emitted its existing browser-module type warning.

### Step 49: Wire secured routers before UI fallback
- **Track & Role:** Track D | Agent-Alpha
- **Prerequisites:** Steps 01–12, 15, 46, 47
- **Target Files Owned:**
  - `server/app.js`
  - `server.js`
  - `server/socket-auth.js`
  - `tests/cases/49.test.cjs`
- **Actions Taken:**
  - Replaced the legacy composition path with dependency-injected bootstrap wiring, authenticated routers, typed API 404s, and the allowlisted public-asset/UI fallback order.
  - Kept non-AI startup usable without optional provider credentials and preserved JSON behavior for AI/placeholder routes.
  - Added verified UID-derived socket authentication/room assignment and cross-user/anonymous API probes.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 49`: Exited 0 (4/4 passed, 0 skipped, 0 failed).

### Step 48: Check module boundaries and retire only proven-unused code
- **Track & Role:** Track D | Agent-Omega
- **Prerequisites:** Steps 16, 17, 18, 27, 30, 46
- **Target Files Owned:**
  - `scripts/check-module-contracts.mjs`
  - `config/module-boundaries.json`
  - `js/controllers/GrindInitializationController.js`
  - `tests/cases/48.test.cjs`
- **Actions Taken:**
  - Added a literal import/export graph checker with source/line diagnostics, ownership-boundary enforcement, cycle detection, inline/import-map/virtual-module resolution, and runtime-root checks.
  - Preserved the old Grind controller as a zero-side-effect compatibility shim because evidence supports retirement of its implementation while runtime resolution still benefits from the path.
  - Added behavioral fixtures for real-graph validation, comments/templates, missing imports, illegal boundaries, cycles, approved virtual/external targets, runtime roots, and retirement-edge protection.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 48`: Exited 0 (8/8 passed, 0 skipped, 0 failed). Node emitted its existing module-type warning during the replacement smoke load.

### Step 29: Standardize shared controls and reduced-motion styling
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Steps 20, 46
- **Target Files Owned:**
  - `css/components/buttons.css`
  - `css/global-utilities.css`
  - `tests/cases/29.test.cjs`
- **Actions Taken:**
  - Standardized visible focus, disabled/busy/error states, touch-target sizing, and reduced-motion behavior across shared controls.
  - Preserved busy feedback while removing nonessential continuous animation under reduced-motion preferences.
  - Added behavioral/static coverage for semantic states, target-size documentation, motion preferences, and feedback persistence.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 29`: Exited 0 (2/2 passed, 0 skipped, 0 failed).

### Step 31: Complete navigation disclosure keyboard semantics
- **Track & Role:** Track C | Agent-Beta
- **Prerequisites:** Steps 19, 46
- **Target Files Owned:**
  - `js/components/NavigationComponent.js`
  - `tests/cases/31.test.cjs`
- **Actions Taken:**
  - Added Enter/Space disclosure, Escape close with focus restoration, outside-click close and ARIA state updates for the mobile menu.
  - Kept desktop navigation keyboard-accessible without applying a modal focus trap.
  - Added behavioral coverage for disclosure keys, Escape, focus restoration, outside clicks, and desktop tab order.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 31`: Exited 0 (2/2 passed, 0 skipped, 0 failed). Node emitted its existing browser-module type warning.

### Step 34: Fix Settings form reflow and contrast
- **Track & Role:** Track C | Agent-Beta
- **Prerequisites:** Steps 17, 20, 46
- **Target Files Owned:**
  - `settings.html`
  - `css/settings.css`
  - `tests/cases/34.test.cjs`
- **Actions Taken:**
  - Added field-level validation regions, required-field relationships, error clearing on valid input, and retained values through failure.
  - Constrained Settings sections for compact widths and zoomed reflow while preserving unobscured theme contrast.
  - Added behavioral/static coverage for programmatic errors, invalid actions, error clearing, viewport containment, and reflow.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 34`: Exited 0 (3/3 passed, 0 skipped, 0 failed).

### Step 33: Make task filters labelled and responsive
- **Track & Role:** Track C | Agent-Beta
- **Prerequisites:** Steps 27, 46
- **Target Files Owned:**
  - `tasks.html`
  - `css/pages/tasks.css`
  - `styles/tasks.css`
  - `tests/cases/33.test.cjs`
- **Actions Taken:**
  - Associated project/section/sort filters with visible labels and stable IDs, added separate auth-action grouping, and kept interactive controls out of nested buttons.
  - Preserved keyboard state updates and wrapped filters/auth controls at narrow widths.
  - Added behavioral/static coverage for labels, IDs, keyboard changes, responsive containment, and authentication-control separation.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 33`: Exited 0 (3/3 passed, 0 skipped, 0 failed).

### Step 35: Name Grind controls and embedded regions
- **Track & Role:** Track C | Agent-Beta
- **Prerequisites:** Steps 23, 46
- **Target Files Owned:**
  - `grind.html`
  - `tests/cases/35.test.cjs`
- **Actions Taken:**
  - Added meaningful names to Grind controls/frames, a labelled duration field, and inspectable stats semantics while retaining the minimal simulation sandbox.
  - Preserved live-controller rejection of out-of-range timer input.
  - Added behavioral/static coverage for names, frame titles, scrollable-region semantics, stats inspection, and timer validation.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 35`: Exited 0 (2/2 passed, 0 skipped, 0 failed). Node emitted its existing browser-module type warning.

### Step 36: Correct Workspace toolbar and attachment semantics
- **Track & Role:** Track C | Agent-Beta
- **Prerequisites:** Steps 18, 46
- **Target Files Owned:**
  - `workspace.html`
  - `js/workspace-attachments.js`
  - `tests/cases/36.test.cjs`
- **Actions Taken:**
  - Added valid status semantics for zero attachments and list/listitem semantics for one or many files.
  - Named the embedding/toolbar actions and restored editor focus after attachment actions.
  - Added behavioral coverage for empty/list states, names, multiple attachments, actions, and focus restoration.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 36`: Exited 0 (2/2 passed, 0 skipped, 0 failed).

### Step 44: Repair sync queue acknowledgement and cross-tab lifecycle
- **Track & Role:** Track C | Agent-Gamma
- **Prerequisites:** Steps 41, 42, 43, 46
- **Target Files Owned:**
  - `js/data-sync-manager.js`
  - `js/cross-tab-sync.js`
  - `js/core/TaskRepository.js`
  - `tests/cases/44.test.cjs`
- **Actions Taken:**
  - Kept unsupported queue entries inspectable, released `isSyncing` after persistence failure, and prevented failed batches from advancing the success timestamp.
  - Removed exact queue/cross-tab lifecycle handlers on destroy and preserved unsaved editor drafts during cross-tab task UI updates without navigation.
  - Added behavioral coverage for queue failures, acknowledgement state, lifecycle cleanup, and two-tab draft/task behavior.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 44`: Exited 0 (5/5 passed, 0 skipped, 0 failed). Expected unsupported-entry diagnostics were emitted by the fixture.

### Step 52: Prove security boundaries with adversarial fixtures
- **Track & Role:** Track D | Agent-Alpha
- **Prerequisites:** Steps 04, 21, 22, 23, 49, 46
- **Target Files Owned:**
  - `tests/fixtures/security-payloads.json`
  - `tests/cases/52.test.cjs`
- **Actions Taken:**
  - Added local hostile fixtures covering disclosure/traversal, spoofed uploads, symlink escapes, cross-user access, markup/URL injection, and forged simulation readiness.
  - Added network/process guards, valid-safe controls, and synchronized disposable-port cleanup so the security suite fails on external capability use or leaked handles.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 52`: Exited 0 (5/5 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - All security fixtures stayed local and offline; no production credentials or data were used.

### Step 28: Align priority-list reads with the canonical repository
- **Track & Role:** Track B | Agent-Beta
- **Prerequisites:** Steps 41, 43, 46
- **Target Files Owned:**
  - `priority-list.html`
  - `js/priority-list-utils.js`
  - `tests/cases/28.test.cjs`
- **Actions Taken:**
  - Switched priority-list loading to canonical repository state, filtering completed/deleted records without consulting the legacy cache.
  - Limited refresh work to affected canonical task events and rendered legitimate empty state without recovery controls or reloads.
  - Added behavioral/static coverage for canonical filtering, affected-only refresh, empty/unavailable distinction, and page topology.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 28`: Exited 0 (5/5 passed, 0 skipped, 0 failed). Node emitted its existing browser-module type warning.

### Step 45: Make Workspace autosave truthful and disposable
- **Track & Role:** Track C | Agent-Gamma
- **Prerequisites:** Steps 18, 40, 44, 46
- **Target Files Owned:**
  - `js/workspace-core.js`
  - `js/workspace-document.js`
  - `tests/cases/45.test.cjs`
- **Actions Taken:**
  - Made autosave install one interval and remove the interval plus pagehide listener on dispose.
  - Kept failed or quota-like local writes from advancing saved state, and retained a recoverable local draft when the awaited remote save fails.
  - Restored the exact acknowledged local draft after a fresh workspace load.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 45`: Exited 0 (4/4 passed, 0 skipped, 0 failed). The offline remote-save fixture emitted the expected diagnostic while preserving the local draft.

### Step 50: Make task completion a recoverable atomic transition
- **Track & Role:** Track D | Agent-Gamma
- **Prerequisites:** Steps 41, 43, 44, 46
- **Target Files Owned:**
  - `js/core/TaskRepository.js`
  - `tests/cases/50.test.cjs`
- **Actions Taken:**
  - Added a recoverable completion transaction that stages task and completed-history state, acknowledges the committed view, and restores the prior durable snapshot across injected write failures.
  - Made retries idempotent, restored migrated legacy data from an acknowledged backup, and published one committed cross-tab transition only after durable completion.
  - Added failure-boundary coverage across task, migration marker, schema, history, and backup writes.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 50`: Exited 0 (3/3 passed, 0 skipped, 0 failed). Expected fixture durability diagnostics were emitted for injected failures.

### Step 51: Connect conflict choices to durable resolution
- **Track & Role:** Track D | Agent-Gamma
- **Prerequisites:** Steps 37, 38, 42, 43, 44, 50, 46
- **Target Files Owned:**
  - `js/core/TaskRepository.js`
  - `js/components/ConflictModal.js`
  - `tests/cases/51.test.cjs`
- **Actions Taken:**
  - Added one awaited repository conflict coordinator that preserves local and remote revisions, applies local/remote/deterministic merge choices, and acknowledges only after durable persistence.
  - Made cancel/defer, failed persistence, retry, and ordered later conflicts recoverable; concurrent unseen revisions reopen reconciliation instead of overwriting unseen data.
  - Delegated browser conflict events to the repository coordinator and added six behavioral tests.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 51`: Exited 0 (6/6 passed, 0 skipped, 0 failed). The expected injected durability warning was emitted during the rejection test.
  - Regression checks: Steps 44 (5/5), 45 (4/4), and 50 (3/3) passed after the repository changes.

### Step 54: Integrate authenticated browser contracts and hosting artifacts
- **Track & Role:** Track D | Agent-Omega
- **Prerequisites:** Steps 14, 15, 16, 17, 18, 20, 23, 26, 27, 28, 29, 30, 31, 33, 34, 35, 36, 40, 47, 48, 49, 46
- **Target Files Owned:**
  - `firebase.json`
  - `.firebaseignore`
  - `package.json`
  - `package-lock.json` (reviewed; no lock change was required)
  - `docs/deployment-contract.md`
  - `js/services/ApiClient.js`
  - `js/timetableAnalyzer.js`
  - `js/studySpaceAnalyzer.js`
  - `js/controllers/ScheduleController.js`
  - `js/calendarManager.js`
  - `js/studySpacesManager.js`
  - `js/priority-list-utils.js`
  - `js/apiSettingsManager.js`
  - `js/ai-researcher.js`
  - `tests/cases/54.test.cjs`
- **Actions Taken:**
  - Added a shared authenticated `ApiClient` with verified token retrieval, request IDs, deadline/abort handling, normalized errors, opaque upload IDs, and direct-provider blocking.
  - Migrated the leased timetable, study-space, scheduling, calendar, priority, settings, and research consumers away from raw/path-based API contracts and preserved caller drafts on authorization failures.
  - Pointed Hosting at `dist`, excluded private/source/test artifacts, ordered API rewrites before the UI fallback, added security/cache headers, and documented the deployment boundary and reproducible static build.
  - Kept the legacy Gemini SDK because live imports remain in unleased roots; the case reports this evidence-gated limitation rather than claiming retirement.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 54`: Exited 0 (7/7 passed, 0 skipped, 0 failed).

### Step 53: Verify Firestore multi-user rules and sync races
- **Track & Role:** Track D | Agent-Delta
- **Prerequisites:** Steps 13, 15, 42, 43, 51, 46
- **Target Files Owned:**
  - `firebase.emulators.json`
  - `tests/fixtures/firestore-contracts.json`
  - `tests/cases/53.test.cjs`
- **Actions Taken:**
  - Pinned a demo-local Auth/Firestore emulator configuration and a sanitized contract fixture covering identity, schema/version, tombstones, concurrent edits, offline replay, and account switching.
  - Added a deterministic offline oracle that enforces owner/non-owner/anonymous access, malformed operations, concurrent unrelated-task merge, stale tombstone protection, explicit newer reopen, acknowledgement-gated replay, and account isolation.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 53`: Exited 0 (5/5 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - Firebase CLI/emulators are unavailable in this environment; the case reports that fact and does not contact production endpoints or use credentials.

### Step 55: Gate dependency exposure and CI reproducibility
- **Track & Role:** Track D | Agent-Omega
- **Prerequisites:** Steps 07, 14, 15, 54, 46
- **Target Files Owned:**
  - `.github/workflows/verify.yml`
  - `scripts/check-dependencies.mjs`
  - `config/advisory-exceptions.json`
  - `tests/cases/55.test.cjs`
- **Actions Taken:**
  - Added an offline deterministic dependency policy/SBOM checker that fails for reachable production high/critical advisories, invalid or expired exceptions, and lock drift while separating unreachable/development findings.
  - Added CI configuration for Node 22, locked installs, dependency/SBOM checks, build verification, and no secret/deployment steps.
  - Added behavioral coverage for clean policy output, seeded advisory reachability, exception metadata, lock drift, offline audit reporting, CLI artifacts, and CI configuration.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 55`: Exited 0 (6/6 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - The policy is designed to run offline in this environment; live registry advisory refresh remains an external CI concern. No deployment or production credentials were used.

### Step 59: Rehearse schema migration and rollback without user data
- **Track & Role:** Track D | Agent-Gamma
- **Prerequisites:** Steps 11, 38, 40, 41, 42, 43, 45, 50, 51, 53, 46
- **Target Files Owned:**
  - `docs/migration-rollback.md`
  - `tests/fixtures/migration-corpus.json`
  - `tests/cases/59.test.cjs`
- **Actions Taken:**
  - Added a sanitized legacy/v5/corrupt/empty/tombstoned migration corpus and documented state markers, backup verification, resumability, rollback, and ownership boundaries.
  - Tested ID/history/tombstone/draft preservation, malformed-source retention, idempotent migration, four durable interruption boundaries, disposable rollback, and authenticated ownership isolation.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 59`: Exited 0 (6/6 passed, 0 skipped, 0 failed). Expected corruption/interruption diagnostics and the existing module-type warning were emitted.
- **Remaining Concerns / Notes:**
  - A committed migration marker remains authoritative after partial migration; tests reset markers only in disposable storage as documented. No user data or browser profiles were read.

### Step 56: Exercise complete student workflows with isolated fixtures
- **Track & Role:** Track D | Agent-Delta
- **Prerequisites:** Steps 24, 25, 28, 39, 45, 49, 50, 51, 53, 54, 46
- **Target Files Owned:**
  - `tests/fixtures/student-journeys.json`
  - `tests/cases/56.test.cjs`
- **Actions Taken:**
  - Added deterministic clean and migrated student journey fixtures spanning onboarding, subject marks, task creation, priority rendering, Grind complete/reopen, and workspace save/reload.
  - Covered local-only/offline/resume behavior, injected storage/backend/provider failures, durable identity across transitions, loopback-only provider calls, and retained input/drafts.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 56`: Exited 0 (4/4 passed, 0 skipped, 0 failed). Expected fixture storage/backend diagnostics and an existing module-type warning were emitted.

### Step 58: Measure hot-path performance and bound resource growth
- **Track & Role:** Track D | Agent-Alpha
- **Prerequisites:** Steps 24, 39, 44, 45, 49, 54, 46
- **Target Files Owned:**
  - `tests/fixtures/performance-budget.json`
  - `scripts/profile-hot-paths.mjs`
  - `tests/cases/58.test.cjs`
- **Actions Taken:**
  - Added a deterministic UTC 1000-task profiler with five samples, fixed median/p95 budgets, worker/direct digest parity, 20 lifecycle cycles, two-tab sync, bounded backend deadline probes, and durable timer-boundary checks.
  - Closed simulated listeners/workers/channels and made the profiler report explicit bounded deadline evidence while preserving the locked thresholds.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 58`: Exited 0 (4/4 passed, 0 skipped, 0 failed).
- **Remaining Concerns / Notes:**
  - Profiling is Node-only; browser rendering metrics, Firebase emulator behavior, and device variance require a separate environment. No live workers, listeners, or external endpoints remain in the fixture.

### Step 57: Run cross-page accessibility and viewport regression gates
- **Track & Role:** Track D | Agent-Beta / QA takeover
- **Prerequisites:** Steps 19, 20, 26, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 54, 46
- **Target Files Owned:**
  - `tests/fixtures/accessibility-matrix.json`
  - `tests/cases/57.test.cjs`
- **Actions Taken:**
  - Added a 20-page matrix at 320/390/768/1440 widths and light/dark/reduced-motion modes with deterministic asset, viewport, focus, dialog, keyboard, and axe checks.
  - Added exact owner/criterion/reason/remediation metadata for observed legacy assets, controls, and viewport baselines; unexpected local requests, unlisted controls, focus failures, runtime errors, and unlisted viewport findings remain fatal.
  - Ran the local Chrome/Playwright path, captured active-page screenshots, and retained explicit limitations for blocked external/CDN requests and missing visual baselines.
- **Verification Commands & Results:**
  - `node tests/harness/run-case.cjs 57`: Exited 0 (2/2 passed, 0 skipped, 0 failed). Browser traversal covered the full matrix; 111 expected warnings were reported.
- **Remaining Concerns / Notes:**
  - The matrix contains an explicit wildcard legacy axe baseline waiver for existing serious/critical findings on unleased pages. It records accessibility debt and does not certify zero axe violations for release. Quill/CDN and other external requests were blocked locally; no production endpoints were used.

### Step 60: Converge the evidence-backed release candidate
- **Track & Role:** Track D | Agent-Omega / orchestrator closure
- **Prerequisites:** Steps 01-59
- **Target Files Owned:**
  - `README.md`
  - `docs/RELEASE_EVIDENCE.md`
  - `.ua/knowledge-graph.json`
  - `.ua/fingerprints.json`
  - `.ua/meta.json`
  - `tests/cases/60.test.cjs`
- **Actions Taken:**
  - Refreshed the deterministic structural topology and fingerprint baseline from the current workspace: 361 inventoried files, 294 structurally analyzed files, 67 unsupported files, 1,771 graph nodes, 1,590 graph edges, zero resolved import cycles, and digest `51c7c0bafaa6d9dd0f7e0c1628dbd9028129a8e965ee7dbcd66b71d2f416af82`.
  - Added the convergence ledger case and synchronized the README, release evidence, execution metadata, plan checkbox, and task manifest with the verified candidate state.
  - Stabilized the remaining browser and application behavior gates: simulation-frame handshake, task retry lifecycle, deterministic layout assertions, and legacy-page teardown handling.
- **Verification Commands & Results:**
  - `node.exe tests/harness/run-case.cjs 60`: Exited 0 (5/5 passed, 0 skipped, 0 todo, 0 failed).
  - `node.exe tests/harness/run-case.cjs --all`: Exited 0; `[run-case] ALL CASES SUMMARY: 60/60 passed`, with zero skipped, todo, or failed tests in every case.
  - `node.exe scripts/check-module-contracts.mjs`: PASS; unresolved edges 0 and cycles 0.
  - Step 54 isolated static-build fixture: 7/7 passed. The root static checker remains a documented limitation because the manifest contains unpinned legacy externals and currently stops at the Chart.js CDN URL.
- **Remaining Concerns / Notes:**
  - Firebase CLI/emulators were unavailable, so Step 53 uses its deterministic offline contract oracle. The managed Python launcher returned `PermissionError`; checked-in JSON validation remains valid with 60 steps and 270 dependency edges.
  - Step 57 captured the full matrix and emitted 111 documented browser warnings. The wildcard legacy axe waiver and lack of committed visual baselines remain documented review limits.
  - The legacy `@google/generative-ai` dependency and unpinned external manifest entries remain recorded by the release evidence. This is an evidence-backed release candidate; no deployment, credential setup, production API call, or user-data migration was performed.
