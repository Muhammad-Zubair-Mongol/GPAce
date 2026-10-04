# E2E Test Infra: GPAce Multi-Key, Navigation & PDF Ingestion

## Test Philosophy
- Opaque-box, requirement-driven testing. Derived from ORIGINAL_REQUEST.md.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise + Workload Testing.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|---------------------|:------:|:------:|:------:|:------:|
| 1 | Multi-line Key Input & Sanitization | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ | ✓ |
| 2 | Key Pool Smart Rotation | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ | ✓ |
| 3 | HTTP 429 Automatic Failover | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ | ✓ |
| 4 | tasks.html Decommissioning & Redirect | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ | ✓ |
| 5 | Navigation Bar Consistency (10 links) | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ | ✓ |
| 6 | Client-Side PDF Ingestion & Vision Extraction | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ | ✓ |
| 7 | Subject Grounding & Verification Modal | ORIGINAL_REQUEST R4 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test runner: `node tests/harness/run-case.cjs <case-name>`
- Static validator: `node scripts/build-static.mjs --check`
- Existing regression suites:
  - `tests/cases/header-consistency.test.cjs`
  - `tests/cases/20.test.cjs`
  - `tests/cases/33.test.cjs`
  - `tests/cases/41.test.cjs`
  - `tests/cases/47.test.cjs`
- New dedicated suites:
  - `tests/cases/gemini-key-rotation.test.cjs`
  - `tests/cases/tasks-decommission.test.cjs`
  - `tests/cases/pdf-task-ingestion.test.cjs`

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Key Pool Configuration & Failover during Multi-Call Ingestion | F1, F2, F3 | High |
| 2 | Direct Navigation & Bookmark Hit to tasks.html forwarding to grind.html | F4, F5 | Medium |
| 3 | Multi-page Syllabus PDF Ingestion with Partial Grounding & User Mapping | F6, F7, F2 | High |
| 4 | Static Site Build & Asset Distribution Check | F4, F5 | Medium |

## Acceptance Criteria
- 100% pass across all test cases with exit code 0.
- `scripts/build-static.mjs --check` passes with zero orphaned files or missing dependencies.
