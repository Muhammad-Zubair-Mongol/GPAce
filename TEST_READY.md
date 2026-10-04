# TEST_READY: GPAce Navigation Header Automated Consistency Test Suite

**Milestone**: M_TEST  
**Test Suite Path**: `tests/cases/header-consistency.test.cjs`  
**Execution Command**: `node tests/harness/run-case.cjs header-consistency`  
**Alternative Direct Runner**: `node --test tests/cases/header-consistency.test.cjs`  
**Date**: 2026-09-30  
**Test Author**: Test Writer (E2E Testing Track)  
**Status**: ACTIVE & ARMED (Baseline established, 75 tests executed, 0 skipped, 0 todo)

---

## 1. Test Suite Overview

In accordance with **R4** of `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `TEST_INFRA.md`, the automated consistency test suite `tests/cases/header-consistency.test.cjs` has been created and verified. It rigorously inspects all **20 HTML application pages** defined in `config/assets-manifest.json` and `tests/fixtures/accessibility-matrix.json`.

The test suite enforces zero tolerance for:
- Missing or malformed canonical `<nav class="top-nav" id="mainNavigation" aria-label="Primary navigation">` landmark
- Non-standardized brand blocks or missing logo references (`assets/images/gpace-logo-white.png`, `.logo-brand`, link to `grind.html`)
- Incomplete navigation links (must include all 11 canonical links: `grind.html`, `tasks.html`, `study-spaces.html`, `daily-calendar.html`, `academic-details.html`, `extracted.html`, `subject-marks.html`, `flashcards.html`, `markdown-converter.html`, `sleep-saboteurs.html`, `settings.html`)
- Desynchronized active page indicators (`aria-current="page"` and `.active`)
- Missing utility controls (`button#navToggleBtn.nav-toggle`, `button.drawer-toggle`, and `button.theme-toggle`)
- Any inline `style="..."` attributes on `<nav>`, its child elements, or `<header>` elements (strict `GEMINI.md` compliance)
- Missing `<head>` stylesheet references (`css/design-tokens.css` and `css/components/navigation.css`) or viewport meta tags

---

## 2. 4-Tier Test Architecture & Coverage Summary

The test suite is structured strictly following the 4-tier methodology specified in `TEST_INFRA.md`:

| Tier | Category | Subtests / Assertions | Current Pass | Current Fail | Description |
|---|---|:---:|:---:|:---:|---|
| **Tier 1** | Feature Coverage (F1–F6) | 30 | 5 | 25 | Direct contract verification across 6 core features for all 20 pages |
| **Tier 2** | Boundary & Corner Cases (F1–F6) | 30 | 25 | 5 | Structural boundary tests, tag integrity, attribute resilience, asset existence |
| **Tier 3** | Cross-Feature Combinations | 10 | 3 | 7 | Pairwise interaction matrix (T3.X01 through T3.X10) |
| **Tier 4** | Real-World User Scenarios | 4 | 0 | 4 | End-to-end student navigation journeys |
| **Inventory** | Manifest & Disk Inventory | 1 | 1 | 0 | Proves all 20 target HTML pages physically exist on disk |
| **TOTAL** | **Full Suite** | **75** | **34** | **41** | **0 skipped, 0 todo, 100% deterministic, zero network dependencies** |

*Note*: 41 tests fail at the M_TEST stage because the 20 HTML pages still possess legacy fragmented header markup. As implementation milestones (M1, M2, M3) proceed, failing tests will turn green until reaching 100% pass in Milestone M4.

---

## 3. Feature Verification Checklist

### Feature 1: Canonical Landmark & Structural Shell
- [x] **T1.F1.01 Landmark Presence**: `<nav>` landmark on all 20 pages
- [x] **T1.F1.02 Primary Identifier**: `id="mainNavigation"` on `<nav>`
- [x] **T1.F1.03 Canonical Class**: `class="top-nav"` on `<nav>`
- [x] **T1.F1.04 Accessible Landmark Label**: `aria-label="Primary navigation"` on `<nav>`
- [x] **T1.F1.05 Unique Landmark Constraint**: Exactly one `id="mainNavigation"` per page

### Feature 2: Standardized Brand Block & Logo
- [x] **T1.F2.01 Brand Container**: `.nav-brand` element present inside navigation
- [x] **T1.F2.02 Brand Logo Class**: Brand `<img>` uses `.logo-brand` class (60px token)
- [x] **T1.F2.03 Brand Logo Source**: Brand `<img>` references `assets/images/gpace-logo-white.png`
- [x] **T1.F2.04 Accessible Alt Text**: Brand `<img>` declares `alt="GPAce Logo"`
- [x] **T1.F2.05 Brand Anchor Target**: Brand title links to `grind.html` with label "GPAce"

### Feature 3: Canonical Navigation Links & Active State
- [x] **T1.F3.01 Navigation Container**: Links container `#mainNavigationLinks` / `.nav-links`
- [x] **T1.F3.02 Complete Link Set**: All 11 links present (`grind.html`, `tasks.html`, `study-spaces.html`, `daily-calendar.html`, `academic-details.html`, `extracted.html`, `subject-marks.html`, `flashcards.html`, `markdown-converter.html`, `sleep-saboteurs.html`, `settings.html`)
- [x] **T1.F3.03 Active Page Indicator**: Matching current page anchor declares `aria-current="page"`
- [x] **T1.F3.04 Active Page Class**: Matching current page anchor applies `.active` class
- [x] **T1.F3.05 Single Active Element**: At most one link has `aria-current="page"` per page

### Feature 4: Unified Utility Controls
- [x] **T1.F4.01 Mobile Toggle Button**: `button#navToggleBtn` with `.nav-toggle`
- [x] **T1.F4.02 Disclosure Accessibility**: `aria-label="Toggle navigation"` and `aria-controls="mainNavigationLinks"`
- [x] **T1.F4.03 Disclosure Initial State**: `aria-expanded="false"` on `#navToggleBtn`
- [x] **T1.F4.04 Settings Drawer Toggle**: `button.drawer-toggle` with `aria-label="Open settings drawer"`
- [x] **T1.F4.05 Theme Toggle Button**: `button.theme-toggle` / `button#themeToggleBtn` with `aria-label="Toggle theme"`

### Feature 5: Strict Compartmentalization (Zero Inline Styles)
- [x] **T1.F5.01 Landmark Styles**: Zero inline `style="..."` on `<nav>` element
- [x] **T1.F5.02 Child Element Styles**: Zero inline `style="..."` on any child element inside `<nav>`
- [x] **T1.F5.03 Brand Block Styles**: Zero inline `style="..."` on brand logo or brand anchor
- [x] **T1.F5.04 Header Tag Styles**: Zero inline `style="..."` on any `<header>` elements
- [x] **T1.F5.05 Embedded Style Tags**: Zero `<style>` tags embedded inside `<nav>` markup

### Feature 6: Head Stylesheet Links & Accessibility Standards
- [x] **T1.F6.01 Design Tokens Imported**: `<head>` imports `css/design-tokens.css`
- [x] **T1.F6.02 Navigation CSS Imported**: `<head>` imports `css/components/navigation.css`
- [x] **T1.F6.03 Valid Stylesheet Relation**: Links declare `rel="stylesheet"`
- [x] **T1.F6.04 Global Utilities Imported**: `<head>` imports `css/global-utilities.css`
- [x] **T1.F6.05 Responsive Viewport Meta**: `<meta name="viewport" content="width=device-width, initial-scale=1">`

---

## 4. The 20 Target Application Pages Inspected

1. `404.html`
2. `academic-details.html`
3. `daily-calendar.html`
4. `extracted.html`
5. `flashcards.html`
6. `grind.html`
7. `index.html`
8. `instant-test-feedback.html`
9. `landing.html`
10. `markdown-converter.html`
11. `priority-calculator.html`
12. `priority-list.html`
13. `relaxed-mode/index.html`
14. `scripts/image-optimizer.html`
15. `settings.html`
16. `sleep-saboteurs.html`
17. `study-spaces.html`
18. `subject-marks.html`
19. `tasks.html`
20. `workspace.html`

---

## 5. Instructions for Implementation Agents (M1, M2, M3)

1. **Milestone M1 (Canonical Component & CSS Architecture)**:
   - Ensure `js/components/NavigationComponent.js` exports canonical links including `tasks.html`, theme toggle button, and base path resolution (`../` for subdirectory pages).
   - Ensure `css/components/navigation.css` provides all sizing rules (`.logo-brand { height: 60px; aspect-ratio: 1; }`), eliminating any need for inline styles.

2. **Milestone M2 (HTML Unification: Groups 1 & 2 - 10 Pages)**:
   - Unify `grind.html`, `tasks.html`, `priority-list.html`, `priority-calculator.html`, `daily-calendar.html`, `academic-details.html`, `subject-marks.html`, `study-spaces.html`, `extracted.html`, `instant-test-feedback.html`.
   - Embed canonical `<nav class="top-nav" id="mainNavigation" aria-label="Primary navigation">` directly into HTML bodies.
   - Insert `<link href="css/design-tokens.css" rel="stylesheet">` and `<link href="css/components/navigation.css" rel="stylesheet">` in `<head>`.
   - Remove legacy inline styles (`style="height: 80px; margin-right: 0px;"`).
   - Run `node tests/harness/run-case.cjs header-consistency` to observe failures decrease.

3. **Milestone M3 (HTML Unification: Groups 3 & 4 + Extra - 10 Pages)**:
   - Unify `flashcards.html`, `workspace.html`, `settings.html`, `markdown-converter.html`, `sleep-saboteurs.html`, `index.html`, `landing.html`, `relaxed-mode/index.html`, `404.html`, `scripts/image-optimizer.html`.
   - For `relaxed-mode/index.html`, use `../` relative prefixes for stylesheet and image paths.
   - Run `node tests/harness/run-case.cjs header-consistency` to verify all 75 tests pass.

4. **Milestone M4 (Final Integration & Gate)**:
   - Execute `node tests/harness/run-case.cjs header-consistency` — assert 75 passed, 0 skipped, 0 failed.
   - Execute full regression gate `node tests/harness/run-case.cjs --all`.
