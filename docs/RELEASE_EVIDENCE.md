# GPAce release evidence

Date: 2026-09-29  
Source: `D:\GPAce`  
Source identity: unversioned workspace (`gitCommitHash: unversioned`)  
Candidate status: evidence package prepared. Deployment status: not deployed. No secret configuration or user-data migration was performed.

## Candidate identity

The refreshed structural inventory contains 361 files and has content digest `51c7c0bafaa6d9dd0f7e0c1628dbd9028129a8e965ee7dbcd66b71d2f416af82`. The topology refresh produced 1,771 nodes and 1,590 edges from 26 deterministic analysis batches. It structurally analyzed 294 files, recorded 67 unsupported markup/configuration files, and found zero cycles in the resolved import graph. The fingerprint baseline covers all 361 inventoried files.

The authoritative artifacts are:

- `.ua/knowledge-graph.json` — refreshed structural graph and provenance.
- `.ua/fingerprints.json` — current 361-file fingerprint baseline.
- `.ua/meta.json` — source digest, inventory counts, and execution metadata.
- `.ua/intermediate/scan-result.json` — scanner inventory used by the graph refresh.
- `.ua/audit/harness-validation.json` — plan validation: 60 steps, 270 dependency edges, zero validation errors.

The graph is structural evidence. It does not infer runtime call edges, dynamic globals, cross-tab behavior, Firestore flows, or semantics for unsupported files. The unsupported-file list and the scanner limitations remain in the graph provenance.

## Verification commands

The final gate is:

```text
node.exe tests/harness/run-case.cjs --all
```

The single convergence case is:

```text
node.exe tests/harness/run-case.cjs 60
```

Supporting checks are:

```text
node.exe scripts/check-module-contracts.mjs
node.exe scripts/build-static.mjs --check
node.exe tests/harness/run-case.cjs 53
node.exe tests/harness/run-case.cjs 54
node.exe tests/harness/run-case.cjs 55
node.exe tests/harness/run-case.cjs 56
node.exe tests/harness/run-case.cjs 57
node.exe tests/harness/run-case.cjs 58
node.exe tests/harness/run-case.cjs 59
```

The release gate runs on Node.js 24.18.0 with npm 11.16.0 in this workspace. CI is locked to Node.js 22 and uses the root lockfile. The harness itself requires Node.js 22 or newer and has its own lockfile.

## Verification record

Step 60 passed `5/5` after the release artifacts were synchronized. The final full verification matrix exited 0 and reported `[run-case] ALL CASES SUMMARY: 60/60 passed`; every case reported zero skipped, todo, and failed tests. That `--all` output is the authoritative aggregate for all 60 cases.

Steps 01–59 were executed as their numbered cases before convergence. The targeted tail of the matrix passed with these observed counts: Step 53 `5/5`, Step 54 `7/7`, Step 55 `6/6`, Step 56 `2/2`, Step 57 `2/2`, Step 58 `4/4`, and Step 59 `6/6`. Earlier cases were also rerun after their dependent fixes; the final full verification matrix and its `--all` output are the authoritative aggregate for all 60 cases.

The browser matrix in Step 57 covered 20 local pages at widths 320, 390, 768, and 1440 in light, dark, and reduced-motion modes, including focus, dialogs, zoom, and axe checks. It captured screenshots but has no committed reviewed baseline directory. Its run emitted 111 documented browser warnings for blocked external/CDN requests, legacy assets, local scroll regions, and related fixture conditions.

The Step 53 Firestore contract case uses a deterministic offline contract oracle because the Firebase CLI/emulators are not installed in this environment. It does not contact a real project. Step 55 uses offline audit fixtures because the live registry was unavailable; its policy and lock-graph assertions still run against the current package and lock data. The Python plan validator could not start because the managed Python launcher returned a `PermissionError`; the checked-in JSON validation artifact and Step 60 ledger assertions provide the available plan-structure evidence.

The module-contract check passed with zero unresolved edges and zero cycles. The root static checker currently exits nonzero at the first pre-existing unpinned external, `https://cdn.jsdelivr.net/npm/chart.js`, and reports `[UNPINNED_EXTERNAL]`; the manifest contains other legacy external references with the same release limitation. Step 54's isolated static-build fixture passed `7/7`, which is the reproducible build evidence recorded for this offline candidate.

## Known limits and release boundary

- Step 57 carries an explicit wildcard legacy axe baseline waiver for pre-existing serious/critical findings across unleased pages. This is a documented accessibility debt baseline, not a clean zero-violation accessibility release claim. Runtime, focus, control, viewport, and asset checks remain fatal outside the reviewed exceptions.
- External CDN and Quill loading were blocked by the local network policy during browser runs. Browser evidence therefore applies to the disposable local fixture environment described by Step 57.
- `@google/generative-ai` remains in the dependency graph because live imports remain in unleased legacy roots (`study-spaces.html`, `workers/imageAnalysis.js`, `js/imageAnalyzer.js`, and `js/ContentClassifier.js`). The supported `@google/genai` path is present and the legacy retention is recorded by Step 55.
- The static asset manifest still contains a pre-existing unpinned Chart.js external dependency. Step 54 records this as a build limitation.
- Node test runs may emit the existing `MODULE_TYPELESS_PACKAGE_JSON` warning for legacy modules. It does not change the harness pass/fail result.
- No Firebase deployment, hosting publish, production API call, credential setup, or real-user migration was performed. Production release requires a separate review of the listed limits and explicit deployment authorization.

This document records a release candidate and its evidence. It does not authorize deployment.
