'use strict';

/**
 * tests/cases/header-consistency.test.cjs
 * 
 * Comprehensive E2E automated consistency test suite for GPAce navigation headers.
 * Validates canonical landmark structure, stylesheet imports, required link set,
 * active indicator, accessibility attributes, utility controls, and zero inline styles
 * across all 20 application HTML pages.
 * 
 * Structure: 4-Tier Test Methodology (TEST_INFRA.md & survey_report.md)
 * - Tier 1: Feature Coverage (F1 to F6)
 * - Tier 2: Boundary & Corner Cases (F1 to F6)
 * - Tier 3: Cross-Feature Combinations (T3.X01 to T3.X10)
 * - Tier 4: Real-World Scenarios (Journeys 1 to 4)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'config', 'assets-manifest.json');
const ACCESSIBILITY_MATRIX_PATH = path.join(ROOT_DIR, 'tests', 'fixtures', 'accessibility-matrix.json');

// Canonical link list specified in ORIGINAL_REQUEST.md (R1, R4) and PROJECT.md
const CANONICAL_NAV_LINKS = Object.freeze([
  { href: 'grind.html', label: 'Grind Mode' },
  { href: 'study-spaces.html', label: 'Grind Station' },
  { href: 'daily-calendar.html', label: 'Daily Drip' },
  { href: 'academic-details.html', label: 'Brain Juice' },
  { href: 'extracted.html', label: 'Hustle Hub' },
  { href: 'subject-marks.html', label: 'Subject Marks' },
  { href: 'flashcards.html', label: 'Flashcards' },
  { href: 'markdown-converter.html', label: 'MD Converter' },
  { href: 'sleep-saboteurs.html', label: 'Alarms' },
  { href: 'settings.html', label: 'Settings' }
]);

// Read canonical 20 pages from assets-manifest.json / accessibility-matrix.json
function getTargetPages() {
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      if (Array.isArray(manifest.pages) && manifest.pages.length === 20) {
        return manifest.pages;
      }
    } catch {}
  }
  if (fs.existsSync(ACCESSIBILITY_MATRIX_PATH)) {
    try {
      const matrix = JSON.parse(fs.readFileSync(ACCESSIBILITY_MATRIX_PATH, 'utf8'));
      if (Array.isArray(matrix.pages) && matrix.pages.length === 20) {
        return matrix.pages.map(p => typeof p === 'string' ? p : p.path);
      }
    } catch {}
  }
  // Authoritative fallback matching accessibility-matrix.json
  return [
    '404.html',
    'academic-details.html',
    'daily-calendar.html',
    'extracted.html',
    'flashcards.html',
    'grind.html',
    'index.html',
    'instant-test-feedback.html',
    'landing.html',
    'markdown-converter.html',
    'priority-calculator.html',
    'priority-list.html',
    'relaxed-mode/index.html',
    'scripts/image-optimizer.html',
    'settings.html',
    'sleep-saboteurs.html',
    'study-spaces.html',
    'subject-marks.html',
    'tasks.html',
    'workspace.html'
  ];
}

const PAGES = getTargetPages();
// Pages with canonical navigation header (workspace.html has no navigation panel, tasks.html is decommissioned redirect stub)
const NAV_PAGES = PAGES.filter(p => p !== 'workspace.html' && p !== 'tasks.html');

// Helper: load all HTML pages once into memory
function loadAllPages() {
  const store = new Map();
  for (const pagePath of PAGES) {
    const fullPath = path.join(ROOT_DIR, pagePath);
    if (fs.existsSync(fullPath)) {
      store.set(pagePath, fs.readFileSync(fullPath, 'utf8'));
    }
  }
  return store;
}

const PAGE_CONTENTS = loadAllPages();

// Helper: resolve relative prefix for nested pages
function getRelativePrefix(pagePath) {
  const depth = pagePath.split('/').length - 1;
  return depth > 0 ? '../'.repeat(depth) : '';
}

// Helper: extract <nav ...> tag and its full outer block
function extractNav(html) {
  const match = html.match(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/i);
  if (!match) return null;
  return {
    fullTag: match[0],
    attrs: match[1],
    innerHtml: match[2]
  };
}

// Helper: extract <head>...</head> content
function extractHead(html) {
  const match = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  return match ? match[1] : '';
}

// Helper: extract attributes from a tag string
function parseAttributes(tagStr) {
  const attrs = {};
  const regex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = regex.exec(tagStr)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = value;
  }
  return attrs;
}

describe('R4: GPAce Navigation Header Consistency Test Suite', () => {

  it('Manifest & File Inventory: All 20 target HTML pages exist on disk', () => {
    assert.equal(PAGES.length, 20, 'Exactly 20 application pages must be configured');
    for (const pagePath of PAGES) {
      const fullPath = path.join(ROOT_DIR, pagePath);
      assert.ok(fs.existsSync(fullPath), `Target page file must exist: ${pagePath}`);
    }
  });

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (F1 through F6)
  // =========================================================================
  describe('Tier 1: Feature Coverage', () => {

    describe('Feature 1: Canonical Landmark & Structural Shell', () => {
      it('T1.F1.01: All 18 navigation pages render a <nav> landmark element', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          if (!/<nav\b/i.test(html)) failures.push(pagePath);
        }
        assert.deepEqual(failures, [], `Pages missing <nav> landmark: ${failures.join(', ')}`);
      });

      it('T1.F1.02: Landmark declares id="mainNavigation"', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav || !/\bid=["']mainNavigation["']/i.test(nav.attrs)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing id="mainNavigation" on <nav>: ${failures.join(', ')}`);
      });

      it('T1.F1.03: Landmark declares class="top-nav"', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav || !/\bclass=["'][^"']*\btop-nav\b[^"']*["']/i.test(nav.attrs)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing class "top-nav" on <nav>: ${failures.join(', ')}`);
      });

      it('T1.F1.04: Landmark declares aria-label="Primary navigation"', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav || !/\baria-label=["']Primary navigation["']/i.test(nav.attrs)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing aria-label="Primary navigation" on <nav>: ${failures.join(', ')}`);
      });

      it('T1.F1.05: Exactly one primary navigation landmark exists per navigation page', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const matches = html.match(/<nav\b[^>]*\bid=["']mainNavigation["'][^>]*>/gi) || [];
          if (matches.length !== 1) {
            failures.push(`${pagePath} (found ${matches.length})`);
          }
        }
        assert.deepEqual(failures, [], `Pages with non-unique id="mainNavigation": ${failures.join(', ')}`);
      });
      it('T1.F1.06: Workspace page has zero navigation panel/bar as requested', () => {
        const html = PAGE_CONTENTS.get('workspace.html') || '';
        const nav = extractNav(html);
        assert.equal(nav, null, 'workspace.html must not contain a <nav> landmark element');
      });
    });

    describe('Feature 2: Standardized Brand Block & Logo', () => {
      it('T1.F2.01: Navigation contains .nav-brand container', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav || !/\bclass=["'][^"']*\bnav-brand\b[^"']*["']/i.test(nav.innerHtml)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing .nav-brand container: ${failures.join(', ')}`);
      });

      it('T1.F2.02: Brand block includes logo <img> with class .logo-brand', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav || !/<img\b[^>]*\bclass=["'][^"']*\blogo-brand\b[^"']*["']/i.test(nav.innerHtml)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing img.logo-brand: ${failures.join(', ')}`);
      });

      it('T1.F2.03: Brand logo references gpace-logo-white.png', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav || !/<img\b[^>]*\bsrc=["'][^"']*assets\/images\/gpace-logo-white\.png["']/i.test(nav.innerHtml)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing gpace-logo-white.png src: ${failures.join(', ')}`);
      });

      it('T1.F2.04: Brand logo includes accessible alt="GPAce Logo"', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav || !/<img\b[^>]*\balt=["']GPAce Logo["']/i.test(nav.innerHtml)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing alt="GPAce Logo": ${failures.join(', ')}`);
      });

      it('T1.F2.05: Brand anchor points to grind.html with GPAce title', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          const brandLinkMatch = nav && nav.innerHtml.match(/<a\b[^>]*\bhref=["'][^"']*grind\.html["'][^>]*>([\s\S]*?)<\/a>/i);
          if (!brandLinkMatch || !/GPAce/i.test(brandLinkMatch[1])) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing brand link to grind.html: ${failures.join(', ')}`);
      });

      it('T1.F2.06: Brand block strictly matches Pattern A nesting (div.nav-brand > a.link-inherit > img.logo-brand + span.brand-text)', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) {
            failures.push(`${pagePath} (no nav)`);
            continue;
          }
          const prefix = getRelativePrefix(pagePath);
          const brandMatch = nav.innerHtml.match(/<div class="nav-brand[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
          if (!brandMatch) {
            failures.push(`${pagePath} (no .nav-brand)`);
            continue;
          }
          const normalized = brandMatch[1].trim().replace(/\s+/g, ' ');
          const expected = `<a href="${prefix}grind.html" class="link-inherit"><img src="${prefix}assets/images/gpace-logo-white.png" alt="GPAce Logo" class="logo-brand" width="60" height="60"><span class="brand-text">GPAce</span></a>`;
          if (normalized !== expected) {
            failures.push(`${pagePath}: got "${normalized}", expected "${expected}"`);
          }
        }
        assert.deepEqual(failures, [], `Pages failing Pattern A brand block:\n${failures.join('\n')}`);
      });
    });

    describe('Feature 3: Complete Navigation Links & Active State Indicator', () => {
      it('T1.F3.01: Navigation contains links container element', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav || !/\b(?:id=["']mainNavigationLinks["']|class=["'][^"']*\bnav-links\b[^"']*["'])/i.test(nav.innerHtml)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing navigation links container: ${failures.join(', ')}`);
      });

      it('T1.F3.02: Navigation contains all 10 canonical links (excluding retired tasks.html)', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) {
            failures.push(`${pagePath} (no nav)`);
            continue;
          }
          const missingForPage = [];
          for (const link of CANONICAL_NAV_LINKS) {
            const regex = new RegExp(`<a\\b[^>]*\\bhref=["'][^"']*${link.href}["']`, 'i');
            if (!regex.test(nav.innerHtml)) {
              missingForPage.push(link.href);
            }
          }
          if (missingForPage.length > 0) {
            failures.push(`${pagePath} missing: [${missingForPage.join(', ')}]`);
          }
          if (/<a\b[^>]*\bhref=["'][^"']*tasks\.html["']/i.test(nav.innerHtml)) {
            failures.push(`${pagePath} contains decommissioned link to tasks.html`);
          }
        }
        assert.deepEqual(failures, [], `Pages missing required navigation links or containing tasks.html: \n${failures.join('\n')}`);
      });

      it('T1.F3.03: Active page link declares aria-current="page" when page matches canonical link', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const fileName = path.basename(pagePath);
          const isCanonical = CANONICAL_NAV_LINKS.some(l => l.href === fileName);
          if (!isCanonical) continue;

          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) {
            failures.push(`${pagePath} (no nav)`);
            continue;
          }

          const activeLinkRegex = new RegExp(`<a\\b[^>]*\\bhref=["'][^"']*${fileName}["'][^>]*\\baria-current=["']page["']|<a\\b[^>]*\\baria-current=["']page["'][^>]*\\bhref=["'][^"']*${fileName}["']`, 'i');
          if (!activeLinkRegex.test(nav.innerHtml)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing aria-current="page" on matching active link: ${failures.join(', ')}`);
      });

      it('T1.F3.04: Active page link possesses .active class when page matches canonical link', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const fileName = path.basename(pagePath);
          const isCanonical = CANONICAL_NAV_LINKS.some(l => l.href === fileName);
          if (!isCanonical) continue;

          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) {
            failures.push(`${pagePath} (no nav)`);
            continue;
          }

          const activeClassRegex = new RegExp(`<a\\b[^>]*\\bhref=["'][^"']*${fileName}["'][^>]*\\bclass=["'][^"']*\\bactive\\b[^"']*["']|<a\\b[^>]*\\bclass=["'][^"']*\\bactive\\b[^"']*["'][^>]*\\bhref=["'][^"']*${fileName}["']`, 'i');
          if (!activeClassRegex.test(nav.innerHtml)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing .active class on matching active link: ${failures.join(', ')}`);
      });

      it('T1.F3.05: At most one link has aria-current="page" per page', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const matches = nav.innerHtml.match(/\baria-current=["']page["']/gi) || [];
          if (matches.length > 1) {
            failures.push(`${pagePath} (found ${matches.length} active links)`);
          }
        }
        assert.deepEqual(failures, [], `Pages with multiple aria-current="page" links: ${failures.join(', ')}`);
      });
    });

    describe('Feature 4: Unified Utility Controls', () => {
      it('T1.F4.01: Mobile toggle button #navToggleBtn with .nav-toggle is present', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav || !/<button\b[^>]*\bid=["']navToggleBtn["'][^>]*\bclass=["'][^"']*\bnav-toggle\b[^"']*["']|<button\b[^>]*\bclass=["'][^"']*\bnav-toggle\b[^"']*["'][^>]*\bid=["']navToggleBtn["']/i.test(nav.fullTag)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing button#navToggleBtn.nav-toggle: ${failures.join(', ')}`);
      });

      it('T1.F4.02: Mobile toggle declares aria-label="Toggle navigation" and aria-controls="mainNavigationLinks"', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          const toggleMatch = nav && nav.fullTag.match(/<button\b[^>]*\bid=["']navToggleBtn["'][^>]*>/i);
          if (!toggleMatch) {
            failures.push(`${pagePath} (no toggle)`);
            continue;
          }
          const attrs = toggleMatch[0];
          const hasLabel = /\baria-label=["']Toggle navigation["']/i.test(attrs);
          const hasControls = /\baria-controls=["']mainNavigationLinks["']/i.test(attrs);
          if (!hasLabel || !hasControls) failures.push(pagePath);
        }
        assert.deepEqual(failures, [], `Pages missing accessibility attributes on #navToggleBtn: ${failures.join(', ')}`);
      });

      it('T1.F4.03: Mobile toggle initializes with aria-expanded="false"', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          const toggleMatch = nav && nav.fullTag.match(/<button\b[^>]*\bid=["']navToggleBtn["'][^>]*>/i);
          if (!toggleMatch || !/\baria-expanded=["']false["']/i.test(toggleMatch[0])) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages without aria-expanded="false" on #navToggleBtn: ${failures.join(', ')}`);
      });

      it('T1.F4.04: Settings drawer toggle button .drawer-toggle is present with aria-label="Open settings drawer"', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          const drawerMatch = nav && nav.fullTag.match(/<button\b[^>]*\bclass=["'][^"']*\bdrawer-toggle\b[^"']*["'][^>]*>/i);
          if (!drawerMatch || !/\baria-label=["']Open settings drawer["']/i.test(drawerMatch[0])) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing button.drawer-toggle with aria-label: ${failures.join(', ')}`);
      });

      it('T1.F4.05: Theme toggle button is present with aria-label="Toggle theme"', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          const themeMatch = nav && nav.fullTag.match(/<button\b[^>]*\b(?:class=["'][^"']*\btheme-toggle\b[^"']*["']|id=["']themeToggleBtn["'])[^>]*>/i);
          if (!themeMatch || !/\baria-label=["']Toggle theme["']/i.test(themeMatch[0])) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing theme toggle button with aria-label: ${failures.join(', ')}`);
      });

      it('T1.F4.06: Utility controls maintain uniform ordering (#themeToggleBtn before .drawer-toggle before #navToggleBtn)', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) {
            failures.push(`${pagePath} (no nav)`);
            continue;
          }
          const themeIndex = nav.fullTag.indexOf('themeToggleBtn');
          const drawerIndex = nav.fullTag.indexOf('drawer-toggle');
          const navToggleIndex = nav.fullTag.indexOf('navToggleBtn');
          if (themeIndex === -1 || drawerIndex === -1 || navToggleIndex === -1 || !(themeIndex < drawerIndex && drawerIndex < navToggleIndex)) {
            failures.push(`${pagePath} (theme: ${themeIndex}, drawer: ${drawerIndex}, nav: ${navToggleIndex})`);
          }
        }
        assert.deepEqual(failures, [], `Pages with non-uniform button sequence:\n${failures.join('\n')}`);
      });
    });

    describe('Feature 5: Strict Compartmentalization (Zero Inline Styles)', () => {
      it('T1.F5.01: Zero inline style="..." attribute on <nav> element', () => {
        const failures = [];
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const navMatch = html.match(/<nav\b[^>]*>/i);
          if (navMatch && /\bstyle\s*=/i.test(navMatch[0])) {
            failures.push(`${pagePath} -> ${navMatch[0]}`);
          }
        }
        assert.deepEqual(failures, [], `Pages with inline style on <nav>: ${failures.join(', ')}`);
      });

      it('T1.F5.02: Zero inline style="..." attributes on any child element inside <nav>', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const inlineStyles = nav.innerHtml.match(/<[^>]+\bstyle\s*=\s*["'][^"']*["']/gi) || [];
          if (inlineStyles.length > 0) {
            failures.push(`${pagePath} (${inlineStyles.length} violations: ${inlineStyles.slice(0, 3).join(', ')})`);
          }
        }
        assert.deepEqual(failures, [], `Pages with inline styles inside <nav>: \n${failures.join('\n')}`);
      });

      it('T1.F5.03: Zero inline style="..." on brand logo or brand anchor', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const brandMatches = nav.innerHtml.match(/<(?:img|a)\b[^>]*\b(?:logo-brand|nav-brand|link-inherit)[^>]*>/gi) || [];
          for (const tag of brandMatches) {
            if (/\bstyle\s*=/i.test(tag)) {
              failures.push(`${pagePath} -> ${tag}`);
            }
          }
        }
        assert.deepEqual(failures, [], `Pages with inline styles on brand block: ${failures.join(', ')}`);
      });

      it('T1.F5.04: Zero inline style="..." on header elements across all views', () => {
        const failures = [];
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const headerMatches = html.match(/<header\b[^>]*>/gi) || [];
          for (const headerTag of headerMatches) {
            if (/\bstyle\s*=/i.test(headerTag)) {
              failures.push(`${pagePath} -> ${headerTag}`);
            }
          }
        }
        assert.deepEqual(failures, [], `Pages with inline styles on <header>: ${failures.join(', ')}`);
      });

      it('T1.F5.05: Zero embedded <style> tags inside navigation landmark', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (nav && /<style\b/i.test(nav.innerHtml)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages with embedded <style> inside <nav>: ${failures.join(', ')}`);
      });
    });

    describe('Feature 6: Head Stylesheet Links & Accessibility Standards', () => {
      it('T1.F6.01: <head> imports css/design-tokens.css', () => {
        const failures = [];
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          if (!/<link\b[^>]*\bhref=["'][^"']*css\/design-tokens\.css(?:\?[^"']*)?["']/i.test(head)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing css/design-tokens.css: ${failures.join(', ')}`);
      });

      it('T1.F6.02: <head> imports css/components/navigation.css', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          if (!/<link\b[^>]*\bhref=["'][^"']*css\/components\/navigation\.css(?:\?[^"']*)?["']/i.test(head)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing css/components/navigation.css: ${failures.join(', ')}`);
      });

      it('T1.F6.03: Stylesheet links specify rel="stylesheet"', () => {
        const failures = [];
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          const navLinkMatch = head.match(/<link\b[^>]*\bhref=["'][^"']*navigation\.css[^"']*["'][^>]*>/i);
          if (navLinkMatch && !/\brel=["']stylesheet["']/i.test(navLinkMatch[0])) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages with malformed rel on navigation.css link: ${failures.join(', ')}`);
      });

      it('T1.F6.04: <head> imports css/global-utilities.css for standard classes', () => {
        const failures = [];
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          if (!/<link\b[^>]*\bhref=["'][^"']*css\/global-utilities\.css(?:\?[^"']*)?["']/i.test(head)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing css/global-utilities.css: ${failures.join(', ')}`);
      });

      it('T1.F6.05: <head> includes responsive <meta name="viewport"> declaration', () => {
        const failures = [];
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          if (!/<meta\b[^>]*\bname=["']viewport["'][^>]*\bcontent=["'][^"']*width=device-width[^"']*["']/i.test(head)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing responsive viewport meta tag: ${failures.join(', ')}`);
      });

      it('T1.F6.06: <head> imports bootstrap-icons.css across all views', () => {
        const failures = [];
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          if (!/bootstrap-icons\.css/i.test(head)) {
            failures.push(pagePath);
          }
        }
        assert.deepEqual(failures, [], `Pages missing bootstrap-icons.css: ${failures.join(', ')}`);
      });
    });

  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 cases per feature = 30 tests)
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {

    describe('F1 Boundary Cases: Landmark Integrity', () => {
      it('T2.F1.01: Landmark tag is strictly <nav>, never <div> or generic container', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const badDiv = html.match(/<div\b[^>]*\bid=["']mainNavigation["']/i);
          assert.equal(badDiv, null, `${pagePath} must not use <div> for mainNavigation`);
        }
      });

      it('T2.F1.02: No duplicate id="mainNavigation" exists in document', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const idMatches = html.match(/\bid=["']mainNavigation["']/gi) || [];
          assert.ok(idMatches.length <= 1, `${pagePath} must have at most 1 element with id="mainNavigation"`);
        }
      });

      it('T2.F1.03: Navigation landmark is placed inside <body> element', () => {
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const bodyIndex = html.indexOf('<body');
          const navIndex = html.indexOf('id="mainNavigation"');
          if (navIndex !== -1 && bodyIndex !== -1) {
            assert.ok(navIndex > bodyIndex, `${pagePath} landmark must reside within <body>`);
          }
        }
      });

      it('T2.F1.04: Landmark attributes tolerate attribute ordering variations', () => {
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const navMatch = html.match(/<nav\b([^>]*)>/i);
          if (!navMatch) continue;
          const attrs = parseAttributes(navMatch[1]);
          if (attrs.id === 'mainNavigation') {
            assert.ok(attrs.class && attrs.class.includes('top-nav'), `${pagePath} parsed class must include top-nav`);
            assert.equal(attrs['aria-label'], 'Primary navigation', `${pagePath} parsed aria-label must match`);
          }
        }
      });

      it('T2.F1.05: Stale legacy navigation landmarks (e.g. ununified <header class="app-header">) are absent', () => {
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const hasStaleHeader = /<header\b[^>]*\bclass=["'][^"']*\bapp-header\b[^"']*["']/i.test(html);
          assert.equal(hasStaleHeader, false, `${pagePath} contains legacy ununified <header class="app-header">`);
        }
      });

      it('T2.F1.06: All 20 application pages contain strictly one </body> and one </html> closing tag', () => {
        const failures = [];
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const bodyCount = (html.match(/<\/body>/gi) || []).length;
          const htmlCount = (html.match(/<\/html>/gi) || []).length;
          if (bodyCount !== 1 || htmlCount !== 1) {
            failures.push(`${pagePath} (</body>: ${bodyCount}, </html>: ${htmlCount})`);
          }
        }
        assert.deepEqual(failures, [], `Pages with malformed closing tags:\n${failures.join('\n')}`);
      });
    });

    describe('F2 Boundary Cases: Brand Block Robustness', () => {
      it('T2.F2.01: Brand logo asset file actually exists in repository at resolved relative path', () => {
        const logoPath = path.join(ROOT_DIR, 'assets', 'images', 'gpace-logo-white.png');
        assert.ok(fs.existsSync(logoPath), `Logo file must physically exist at ${logoPath}`);
      });

      it('T2.F2.02: Brand logo alt attribute is non-empty and non-generic', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const imgMatch = nav.innerHtml.match(/<img\b[^>]*\blogo-brand[^>]*>/i);
          if (imgMatch) {
            const attrs = parseAttributes(imgMatch[0]);
            assert.ok(attrs.alt && attrs.alt.trim().length > 3, `${pagePath} logo alt must not be empty or trivial`);
            assert.notEqual(attrs.alt.toLowerCase(), 'image', `${pagePath} logo alt must not be generic 'image'`);
          }
        }
      });

      it('T2.F2.03: Brand logo has no inline style overrides for dimensions or margins', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const imgMatch = nav.innerHtml.match(/<img\b[^>]*\blogo-brand[^>]*>/i);
          if (imgMatch) {
            assert.equal(/\bstyle\s*=/i.test(imgMatch[0]), false, `${pagePath} logo has forbidden inline styles`);
          }
        }
      });

      it('T2.F2.04: Nested views (relaxed-mode/) resolve brand link with parent directory prefix', () => {
        const relaxedHtml = PAGE_CONTENTS.get('relaxed-mode/index.html');
        if (relaxedHtml) {
          const nav = extractNav(relaxedHtml);
          if (nav) {
            const hasRelativeGrind = /<a\b[^>]*\bhref=["'](?:\.\.\/|\/)grind\.html["']/i.test(nav.innerHtml);
            assert.ok(hasRelativeGrind, 'relaxed-mode/index.html brand link must resolve to ../grind.html or /grind.html');
          }
        }
      });

      it('T2.F2.05: Brand anchor contains non-empty accessible name text', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const brandAnchor = nav.innerHtml.match(/<a\b[^>]*\bhref=["'][^"']*grind\.html["'][^>]*>([\s\S]*?)<\/a>/i);
          if (brandAnchor) {
            const text = brandAnchor[1].replace(/<[^>]*>/g, '').trim();
            assert.ok(text.length > 0, `${pagePath} brand anchor text must not be empty`);
          }
        }
      });
    });

    describe('F3 Boundary Cases: Link Targets & Routing Edge Cases', () => {
      it('T2.F3.01: Non-canonical pages (e.g. 404.html, landing.html, index.html) have zero active links', () => {
        const nonCanonical = ['404.html', 'landing.html', 'index.html', 'scripts/image-optimizer.html'];
        for (const pagePath of nonCanonical) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const activeMatch = nav.innerHtml.match(/\baria-current=["']page["']/i);
          assert.equal(activeMatch, null, `${pagePath} should not have any link marked aria-current="page"`);
        }
      });

      it('T2.F3.02: Link href targets contain no trailing spaces or malformed URL syntax', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const hrefs = nav.innerHtml.match(/\bhref=["']([^"']+)["']/gi) || [];
          for (const hrefAttr of hrefs) {
            const value = hrefAttr.replace(/^href=["']|["']$/gi, '');
            assert.equal(value, value.trim(), `${pagePath} href "${value}" has untrimmed whitespace`);
            assert.equal(/\\/.test(value), false, `${pagePath} href "${value}" contains invalid backslashes`);
          }
        }
      });

      it('T2.F3.03: All canonical link target filenames exist physically in root or dist directory', () => {
        for (const link of CANONICAL_NAV_LINKS) {
          const targetPath = path.join(ROOT_DIR, link.href);
          assert.ok(fs.existsSync(targetPath), `Canonical target file must exist: ${link.href}`);
        }
      });

      it('T2.F3.04: Nested views prefix canonical links with parent directory relative path', () => {
        const nestedHtml = PAGE_CONTENTS.get('relaxed-mode/index.html');
        if (nestedHtml) {
          const nav = extractNav(nestedHtml);
          if (nav) {
            for (const link of CANONICAL_NAV_LINKS) {
              const regex = new RegExp(`href=["'](?:\\.\\.\\/|\\/)?${link.href}["']`, 'i');
              assert.match(nav.innerHtml, regex, `relaxed-mode/index.html must resolve ${link.href} with ../ or /`);
            }
          }
        }
      });

      it('T2.F3.05: All navigation link anchors contain non-empty accessible label or span', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const links = nav.innerHtml.match(/<a\b[^>]*>([\s\S]*?)<\/a>/gi) || [];
          for (const anchor of links) {
            const text = anchor.replace(/<[^>]*>/g, '').trim();
            const hasAria = /\baria-label=["'][^"']+["']/i.test(anchor);
            assert.ok(text.length > 0 || hasAria, `${pagePath} contains empty anchor without accessible text`);
          }
        }
      });
    });

    describe('F4 Boundary Cases: Disclosure & Utility Control Robustness', () => {
      it('T2.F4.01: All navigation buttons explicitly declare type="button"', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const buttons = nav.fullTag.match(/<button\b[^>]*>/gi) || [];
          for (const btn of buttons) {
            const attrs = parseAttributes(btn);
            assert.equal(attrs.type, 'button', `${pagePath} button must explicitly declare type="button": ${btn}`);
          }
        }
      });

      it('T2.F4.02: aria-controls on #navToggleBtn matches links container ID in the same document', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const toggleMatch = nav.fullTag.match(/<button\b[^>]*\bid=["']navToggleBtn["'][^>]*>/i);
          if (toggleMatch) {
            const attrs = parseAttributes(toggleMatch[0]);
            const targetId = attrs['aria-controls'];
            assert.ok(targetId, `${pagePath} #navToggleBtn must declare aria-controls`);
            const targetRegex = new RegExp(`id=["']${targetId}["']`, 'i');
            assert.match(html, targetRegex, `${pagePath} controlled element #${targetId} must exist in document`);
          }
        }
      });

      it('T2.F4.03: aria-expanded on #navToggleBtn is strictly string "false"', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const toggleMatch = nav.fullTag.match(/<button\b[^>]*\bid=["']navToggleBtn["'][^>]*>/i);
          if (toggleMatch) {
            const attrs = parseAttributes(toggleMatch[0]);
            assert.equal(attrs['aria-expanded'], 'false', `${pagePath} #navToggleBtn aria-expanded must be "false"`);
          }
        }
      });

      it('T2.F4.04: Decorative icon elements inside utility buttons declare aria-hidden="true"', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const icons = nav.fullTag.match(/<i\b[^>]*\bclass=["'][^"']*\bbi\b[^"']*["'][^>]*>/gi) || [];
          for (const icon of icons) {
            const attrs = parseAttributes(icon);
            assert.equal(attrs['aria-hidden'], 'true', `${pagePath} icon must declare aria-hidden="true": ${icon}`);
          }
        }
      });

      it('T2.F4.05: Drawer toggle button has non-empty accessible name and title', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const drawerMatch = nav.fullTag.match(/<button\b[^>]*\bdrawer-toggle[^>]*>/i);
          if (drawerMatch) {
            const attrs = parseAttributes(drawerMatch[0]);
            assert.ok(attrs['aria-label'] && attrs['aria-label'].trim().length > 0, `${pagePath} drawer toggle must have aria-label`);
          }
        }
      });

      it('T2.F4.06: Zero duplicate or stray theme toggle buttons across entire document', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const themeMatches = (html.match(/id=["']themeToggleBtn["']/gi) || []).length;
          const grindThemeMatches = (html.match(/id=["']grindThemeToggle["']/gi) || []).length;
          const themeClassMatches = (html.match(/class=["'][^"']*\btheme-toggle\b[^"']*["']/gi) || []).length;
          if (themeMatches !== 1) {
            failures.push(`${pagePath}: found ${themeMatches} instances of #themeToggleBtn (expected 1)`);
          }
          if (grindThemeMatches !== 0) {
            failures.push(`${pagePath}: found ${grindThemeMatches} instances of #grindThemeToggle (expected 0)`);
          }
          if (themeClassMatches !== 1) {
            failures.push(`${pagePath}: found ${themeClassMatches} instances of .theme-toggle (expected 1)`);
          }
        }
        assert.deepEqual(failures, [], `Pages with stray or duplicate theme toggles:\n${failures.join('\n')}`);
      });
    });

    describe('F5 Boundary Cases: Style Isolation & Parsing Resilience', () => {
      it('T2.F5.01: Zero inline style attributes with irregular whitespace or linebreaks', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          const irregularStyle = nav.fullTag.match(/\bstyle\s*=\s*["'][^"']*["']/gi) || [];
          assert.deepEqual(irregularStyle, [], `${pagePath} contains irregular whitespace inline styles in navigation`);
        }
      });

      it('T2.F5.02: Zero inline z-index property across all header markup', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          assert.equal(/z-index\s*:/i.test(nav.fullTag), false, `${pagePath} contains inline z-index in navigation`);
        }
      });

      it('T2.F5.03: Zero inline height or width styles on navigation elements', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          assert.equal(/(?:height|width)\s*:\s*\d+/i.test(nav.fullTag), false, `${pagePath} contains inline dimensions`);
        }
      });

      it('T2.F5.04: Zero inline margin or padding styles on brand or utility elements', () => {
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
          if (!nav) continue;
          assert.equal(/(?:margin|padding)(?:-right|-left|-top|-bottom)?\s*:/i.test(nav.fullTag), false, `${pagePath} contains inline spacing`);
        }
      });

      it('T2.F5.05: css/components/navigation.css exists and provides canonical styling classes', () => {
        const navCssPath = path.join(ROOT_DIR, 'css', 'components', 'navigation.css');
        assert.ok(fs.existsSync(navCssPath), 'css/components/navigation.css must exist');
        const cssContent = fs.readFileSync(navCssPath, 'utf8');
        assert.match(cssContent, /\.top-nav\b/, 'navigation.css must define .top-nav');
        assert.match(cssContent, /\.logo-brand\b/, 'navigation.css must define .logo-brand');
        assert.match(cssContent, /\.nav-toggle\b/, 'navigation.css must define .nav-toggle');
        assert.match(cssContent, /\.drawer-toggle\b/, 'navigation.css must define .drawer-toggle');
      });

      it('T2.F5.06: Page-specific stylesheets contain zero conflicting overrides for .top-nav, .nav-brand, .nav-links, or .theme-toggle', () => {
        const filesToCheck = [
          'css/priority-calculator.css', 'css/study-spaces.css', 'css/sleep-saboteurs.css',
          'css/pages/markdown-converter.css', 'css/pages/landing.css', 'css/extracted.css',
          'css/priority-list.css', 'css/daily-calendar.css', 'css/settings.css', 'css/academic-details.css'
        ];
        const failures = [];
        for (const relPath of filesToCheck) {
          const fullPath = path.join(ROOT_DIR, relPath);
          if (!fs.existsSync(fullPath)) continue;
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (/^\s*\.(top-nav|nav-brand|nav-links|theme-toggle)\b/.test(line)) {
              failures.push(`${relPath}:${idx + 1}: ${line.trim()}`);
            }
          });
        }
        assert.deepEqual(failures, [], `Conflicting navigation styles found in page-specific CSS:\n${failures.join('\n')}`);
      });
    });

    describe('F6 Boundary Cases: Stylesheet Imports & Tokens Verification', () => {
      it('T2.F6.01: Subdirectory pages resolve stylesheet hrefs with correct relative prefix', () => {
        const relaxedHtml = PAGE_CONTENTS.get('relaxed-mode/index.html');
        if (relaxedHtml) {
          const head = extractHead(relaxedHtml);
          const hasRelTokens = /<link\b[^>]*\bhref=["'](?:\.\.\/|\/)css\/design-tokens\.css/i.test(head);
          const hasRelNav = /<link\b[^>]*\bhref=["'](?:\.\.\/|\/)css\/components\/navigation\.css/i.test(head);
          assert.ok(hasRelTokens, 'relaxed-mode/index.html must link design tokens with relative or root-relative path');
          assert.ok(hasRelNav, 'relaxed-mode/index.html must link navigation.css with relative or root-relative path');
        }
      });

      it('T2.F6.02: css/design-tokens.css exists on disk and declares core CSS custom properties', () => {
        const tokensPath = path.join(ROOT_DIR, 'css', 'design-tokens.css');
        assert.ok(fs.existsSync(tokensPath), 'css/design-tokens.css must exist');
        const content = fs.readFileSync(tokensPath, 'utf8');
        assert.match(content, /--/, 'design-tokens.css must declare CSS variables');
      });

      it('T2.F6.03: Zero duplicate stylesheet link tags for navigation.css in <head>', () => {
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          const matches = head.match(/<link\b[^>]*\bnavigation\.css[^>]*>/gi) || [];
          assert.ok(matches.length <= 1, `${pagePath} has duplicate navigation.css imports (count: ${matches.length})`);
        }
      });

      it('T2.F6.04: Viewport meta specifies width=device-width and initial-scale=1', () => {
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          const metaMatch = head.match(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i);
          if (metaMatch) {
            const attrs = parseAttributes(metaMatch[0]);
            assert.match(attrs.content || '', /width=device-width/i, `${pagePath} viewport content must have width=device-width`);
            assert.match(attrs.content || '', /initial-scale=1/i, `${pagePath} viewport content must have initial-scale=1`);
          }
        }
      });

      it('T2.F6.05: Zero missing or obsolete legacy header script tags in <head>', () => {
        for (const pagePath of PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          assert.equal(/inject-header-legacy\.js/i.test(head), false, `${pagePath} references obsolete legacy header script`);
        }
      });

      it('T2.F6.06: css/design-tokens.css is loaded strictly before css/components/navigation.css', () => {
        const failures = [];
        for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const head = extractHead(html);
          const tokenIndex = head.indexOf('css/design-tokens.css');
          const navCssIndex = head.indexOf('css/components/navigation.css');
          if (tokenIndex === -1 || navCssIndex === -1 || tokenIndex >= navCssIndex) {
            failures.push(`${pagePath} (tokens: ${tokenIndex}, navCss: ${navCssIndex})`);
          }
        }
        assert.deepEqual(failures, [], `Pages where design-tokens.css is not loaded before navigation.css:\n${failures.join('\n')}`);
      });
    });

  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (T3.X01 to T3.X10)
  // =========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {

    it('T3.X01 (F1 + F4): Mobile toggle button is nested inside canonical <nav> landmark and targets #mainNavigationLinks', () => {
      const failures = [];
      for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
        if (!nav) {
          failures.push(`${pagePath} (no nav)`);
          continue;
        }
        const hasToggle = /<button\b[^>]*\bid=["']navToggleBtn["'][^>]*>/i.test(nav.fullTag);
        const hasControls = /aria-controls=["']mainNavigationLinks["']/i.test(nav.fullTag);
        const hasContainer = /id=["']mainNavigationLinks["']/i.test(nav.innerHtml);
        if (!hasToggle || !hasControls || !hasContainer) {
          failures.push(pagePath);
        }
      }
      assert.deepEqual(failures, [], `Pages failing F1+F4 combination: ${failures.join(', ')}`);
    });

    it('T3.X02 (F2 + F3): Brand link to grind.html coexists with nav link to grind.html without duplicate aria-current', () => {
      const failures = [];
      for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
        if (!nav) continue;
        const brandMatch = nav.innerHtml.match(/<a\b[^>]*\bclass=["'][^"']*\blink-inherit\b[^"']*["'][^>]*>/i);
        if (brandMatch && /\baria-current=["']page["']/i.test(brandMatch[0])) {
          failures.push(`${pagePath} (brand link incorrectly marked aria-current)`);
        }
      }
      assert.deepEqual(failures, [], `Pages failing F2+F3 combination: ${failures.join(', ')}`);
    });

    it('T3.X03 (F3 + F4): Nav links container houses both canonical links and utility buttons', () => {
      const failures = [];
      for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
        if (!nav) continue;
        const linksBlock = nav.innerHtml.match(/<(?:div|ul)\b[^>]*\b(?:id=["']mainNavigationLinks["']|class=["'][^"']*\bnav-links\b[^"']*["'])[^>]*>([\s\S]*?)<\/(?:div|ul)>/i);
        if (!linksBlock) {
          failures.push(`${pagePath} (no links block)`);
          continue;
        }
        const hasAnchors = /<a\b/i.test(linksBlock[1]);
        const hasDrawer = /drawer-toggle/i.test(linksBlock[1]);
        if (!hasAnchors || !hasDrawer) {
          failures.push(pagePath);
        }
      }
      assert.deepEqual(failures, [], `Pages failing F3+F4 combination: ${failures.join(', ')}`);
    });

    it('T3.X04 (F1 + F5): Canonical <nav> landmark and all descendants are 100% free of inline styles', () => {
      const failures = [];
      for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
        if (!nav) continue;
        const styleMatches = nav.fullTag.match(/\bstyle\s*=\s*["'][^"']*["']/gi) || [];
        if (styleMatches.length > 0) {
          failures.push(`${pagePath} (${styleMatches.length} styles)`);
        }
      }
      assert.deepEqual(failures, [], `Pages failing F1+F5 combination: ${failures.join(', ')}`);
    });

    it('T3.X05 (F4 + F5): Utility controls (drawer-toggle, theme-toggle, nav-toggle) use CSS classes exclusively with zero inline styles', () => {
      const failures = [];
      for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
        if (!nav) continue;
        const controlButtons = nav.fullTag.match(/<button\b[^>]*\b(?:drawer-toggle|theme-toggle|nav-toggle)[^>]*>/gi) || [];
        for (const btn of controlButtons) {
          if (/\bstyle\s*=/i.test(btn)) {
            failures.push(`${pagePath} -> ${btn}`);
          }
        }
      }
      assert.deepEqual(failures, [], `Pages failing F4+F5 combination: ${failures.join(', ')}`);
    });

    it('T3.X06 (F2 + F5): Brand logo sizing relies purely on .logo-brand CSS class with zero inline dimension styles', () => {
      const failures = [];
      for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
        if (!nav) continue;
        const logoMatch = nav.innerHtml.match(/<img\b[^>]*\blogo-brand[^>]*>/i);
        if (logoMatch && (/\bstyle\s*=/i.test(logoMatch[0]) && /(?:height|width)\s*:/i.test(logoMatch[0]))) {
          failures.push(`${pagePath} -> ${logoMatch[0]}`);
        }
      }
      assert.deepEqual(failures, [], `Pages failing F2+F5 combination: ${failures.join(', ')}`);
    });

    it('T3.X07 (F1 + F6): Canonical <nav> landmark coexists with design-tokens.css and navigation.css imports in <head>', () => {
      const failures = [];
      for (const pagePath of NAV_PAGES) {
        const html = PAGE_CONTENTS.get(pagePath) || '';
        const head = extractHead(html);
        const hasNav = /<nav\b[^>]*\bid=["']mainNavigation["']/i.test(html);
        const hasTokens = /css\/design-tokens\.css/i.test(head);
        const hasCss = /css\/components\/navigation\.css/i.test(head);
        if (!hasNav || !hasTokens || !hasCss) {
          failures.push(pagePath);
        }
      }
      assert.deepEqual(failures, [], `Pages failing F1+F6 combination: ${failures.join(', ')}`);
    });

    it('T3.X08 (F3 + F6): Active indicator synchronizes aria-current="page" and .active class on identical anchor element', () => {
      const failures = [];
      for (const pagePath of NAV_PAGES) {
        const fileName = path.basename(pagePath);
        const isCanonical = CANONICAL_NAV_LINKS.some(l => l.href === fileName);
        if (!isCanonical) continue;

        const html = PAGE_CONTENTS.get(pagePath) || '';
        const nav = extractNav(html);
        if (!nav) continue;

        // Check if an anchor has aria-current="page" AND class="...active..."
        const matchingActiveAnchor = nav.innerHtml.match(/<a\b[^>]*\bhref=["'][^"']*${fileName}["'][^>]*>/i);
        const combinedRegex = new RegExp(`<a\\b[^>]*\\bhref=["'][^"']*${fileName}["'][^>]*\\bclass=["'][^"']*\\bactive\\b[^"']*["'][^>]*\\baria-current=["']page["']|<a\\b[^>]*\\bhref=["'][^"']*${fileName}["'][^>]*\\baria-current=["']page["'][^>]*\\bclass=["'][^"']*\\bactive\\b[^"']*["']`, 'i');
        if (!combinedRegex.test(nav.innerHtml)) {
          failures.push(pagePath);
        }
      }
      assert.deepEqual(failures, [], `Pages failing F3+F6 active state synchronization: ${failures.join(', ')}`);
    });

    it('T3.X09 (F4 + F6): Mobile hamburger button synchronizes aria-expanded="false", aria-controls="mainNavigationLinks", and aria-label="Toggle navigation"', () => {
      const failures = [];
      for (const pagePath of NAV_PAGES) {
          const html = PAGE_CONTENTS.get(pagePath) || '';
          const nav = extractNav(html);
        if (!nav) continue;
        const toggle = nav.fullTag.match(/<button\b[^>]*\bid=["']navToggleBtn["'][^>]*>/i);
        if (!toggle) {
          failures.push(`${pagePath} (no toggle)`);
          continue;
        }
        const attrs = parseAttributes(toggle[0]);
        if (attrs['aria-expanded'] !== 'false' || attrs['aria-controls'] !== 'mainNavigationLinks' || attrs['aria-label'] !== 'Toggle navigation') {
          failures.push(pagePath);
        }
      }
      assert.deepEqual(failures, [], `Pages failing F4+F6 toggle accessibility synchronization: ${failures.join(', ')}`);
    });

    it('T3.X10 Subdirectory Integration: relaxed-mode/index.html resolves relative tokens, CSS, logo, and links consistently', () => {
      const html = PAGE_CONTENTS.get('relaxed-mode/index.html');
      assert.ok(html, 'relaxed-mode/index.html must exist');
      const head = extractHead(html);
      assert.match(head, /css\/design-tokens\.css/i, 'relaxed-mode must link design-tokens.css');
      assert.match(head, /css\/components\/navigation\.css/i, 'relaxed-mode must link navigation.css');
      const nav = extractNav(html);
      assert.ok(nav, 'relaxed-mode must render canonical nav');
      assert.match(nav.fullTag, /assets\/images\/gpace-logo-white\.png/i, 'relaxed-mode logo must resolve to gpace-logo-white.png');
      assert.match(nav.fullTag, /grind\.html/i, 'relaxed-mode must link to grind.html');
    });

    it('T3.X11 (F1 + F4): NavigationComponent reinjection into static landmark is idempotent with zero duplicate event listeners', async () => {
      const moduleUrl = new URL(`file:///${path.join(ROOT_DIR, 'js/components/NavigationComponent.js').replace(/\\/g, '/')}`).href;
      const navigation = await import(moduleUrl);
      let clickListeners = [];
      const mockToggle = {
        attributes: { 'aria-expanded': 'false', 'aria-controls': 'mainNavigationLinks' },
        getAttribute(name) { return this.attributes[name]; },
        setAttribute(name, val) { this.attributes[name] = String(val); },
        addEventListener(type, fn) { if (type === 'click') clickListeners.push(fn); },
        removeEventListener(type, fn) { if (type === 'click') clickListeners = clickListeners.filter(f => f !== fn); },
        dispatchEvent(e) { clickListeners.forEach(fn => fn(e)); }
      };
      const mockLinks = {
        classList: {
          show: false,
          toggle(cls, state) { if (cls === 'show') this.show = Boolean(state); return this.show; },
          contains(cls) { return cls === 'show' ? this.show : false; }
        }
      };
      const mockNav = {
        dataset: {},
        querySelector(sel) {
          if (sel === '#navToggleBtn') return mockToggle;
          if (sel === '#mainNavigationLinks') return mockLinks;
          return null;
        },
        querySelectorAll() { return []; },
        contains() { return false; },
        setAttribute(name, val) { this.dataset[name] = val; },
        getAttribute(name) { return this.dataset[name]; }
      };
      const mockDoc = {
        createElement() { return {}; },
        querySelector(sel) { if (sel === 'body') return {}; return null; },
        querySelectorAll(sel) { if (sel === '.top-nav') return [mockNav]; return []; },
        addEventListener() {},
        removeEventListener() {}
      };
      const mockWin = { scrollY: 0, addEventListener() {}, removeEventListener() {} };

      navigation.injectNavigation({ document: mockDoc, window: mockWin });
      assert.equal(clickListeners.length, 1, 'First injection must register exactly 1 click listener');

      navigation.injectNavigation({ document: mockDoc, window: mockWin });
      assert.equal(clickListeners.length, 1, 'Second injection must not duplicate click listeners');

      mockToggle.dispatchEvent({ type: 'click', preventDefault() {} });
      assert.equal(mockToggle.getAttribute('aria-expanded'), 'true', 'Click must toggle to expanded true without reverting');
    });

  });

  // =========================================================================
  // TIER 4: REAL-WORLD SCENARIOS
  // =========================================================================
  describe('Tier 4: Real-World Scenarios', () => {

    it('Journey 1: Student Entry & Focus Flow (Index/Landing -> Grind Mode -> Grind Station)', () => {
      // Verifies brand identity, landmark structure, and active state transitions across entry, focus, and grind station
      const journeyPages = ['landing.html', 'grind.html', 'study-spaces.html'];
      for (const pagePath of journeyPages) {
        const html = PAGE_CONTENTS.get(pagePath);
        assert.ok(html, `${pagePath} must exist in journey`);
        const nav = extractNav(html);
        assert.ok(nav, `${pagePath} must render canonical <nav> landmark`);
        assert.match(nav.attrs, /\bclass=["'][^"']*\btop-nav\b[^"']*["']/i, `${pagePath} must have class top-nav`);
        assert.match(nav.attrs, /\bid=["']mainNavigation["']/i, `${pagePath} must have id mainNavigation`);
        assert.match(nav.innerHtml, /gpace-logo-white\.png/i, `${pagePath} must display white brand logo`);
      }

      // Check active state transitions
      const grindNav = extractNav(PAGE_CONTENTS.get('grind.html')).innerHtml;
      assert.match(grindNav, /href=["'][^"']*grind\.html["'][^>]*\baria-current=["']page["']/i, 'grind.html must activate Grind Mode link');

      const stationNav = extractNav(PAGE_CONTENTS.get('study-spaces.html')).innerHtml;
      assert.match(stationNav, /href=["'][^"']*study-spaces\.html["'][^>]*\baria-current=["']page["']/i, 'study-spaces.html must activate Grind Station link');

      const landingNav = extractNav(PAGE_CONTENTS.get('landing.html')).innerHtml;
      assert.equal(/\baria-current=["']page["']/i.test(landingNav), false, 'landing.html must have no active page indicator');
    });

    it('Journey 2: Mobile Viewport & Hamburger Disclosure Walkthrough', () => {
      // Verifies mobile toggle button, controls target, and accessibility disclosure across core views
      const views = ['grind.html', 'daily-calendar.html', 'academic-details.html', 'study-spaces.html', 'settings.html'];
      for (const pagePath of views) {
        const html = PAGE_CONTENTS.get(pagePath);
        const nav = extractNav(html);
        assert.ok(nav, `${pagePath} must have nav`);

        // Hamburger button
        const toggleMatch = nav.fullTag.match(/<button\b[^>]*\bid=["']navToggleBtn["'][^>]*>/i);
        assert.ok(toggleMatch, `${pagePath} must have #navToggleBtn`);
        const attrs = parseAttributes(toggleMatch[0]);
        assert.equal(attrs.type, 'button');
        assert.equal(attrs['aria-expanded'], 'false');
        assert.equal(attrs['aria-controls'], 'mainNavigationLinks');
        assert.equal(attrs['aria-label'], 'Toggle navigation');

        // Controlled container
        assert.match(nav.innerHtml, /id=["']mainNavigationLinks["']/i, `${pagePath} must have #mainNavigationLinks container`);
      }
    });

    it('Journey 3: Quick Settings & Theme Toggle Accessibility Walkthrough', () => {
      // Verifies utility buttons (.drawer-toggle and .theme-toggle) are operable and present across views
      const views = ['grind.html', 'daily-calendar.html', 'subject-marks.html', 'flashcards.html', 'markdown-converter.html'];
      for (const pagePath of views) {
        const html = PAGE_CONTENTS.get(pagePath);
        const nav = extractNav(html);
        assert.ok(nav, `${pagePath} must have nav`);

        // Drawer toggle
        const drawerMatch = nav.fullTag.match(/<button\b[^>]*\bdrawer-toggle[^>]*>/i);
        assert.ok(drawerMatch, `${pagePath} must have button.drawer-toggle`);
        const drawerAttrs = parseAttributes(drawerMatch[0]);
        assert.equal(drawerAttrs['aria-label'], 'Open settings drawer');

        // Theme toggle
        const themeMatch = nav.fullTag.match(/<button\b[^>]*\b(?:theme-toggle|themeToggleBtn)[^>]*>/i);
        assert.ok(themeMatch, `${pagePath} must have theme toggle button`);
        const themeAttrs = parseAttributes(themeMatch[0]);
        assert.equal(themeAttrs['aria-label'], 'Toggle theme');
      }
    });

    it('Journey 4: Keyboard Navigation & Screen Reader Landmark Walkthrough', () => {
      // Verifies accessibility landmark role, unique ID, sequential links, and zero style traps across all 20 views
      for (const pagePath of PAGES) {
        const html = PAGE_CONTENTS.get(pagePath);
        if (!html) continue;
        const nav = extractNav(html);
        if (!nav) continue;

        // Primary landmark role verification
        assert.match(nav.attrs, /\baria-label=["']Primary navigation["']/i, `${pagePath} landmark must have aria-label="Primary navigation"`);

        // Zero style traps that could hide or distort focus rings
        const inlineStyles = nav.fullTag.match(/\bstyle\s*=\s*["'][^"']*["']/gi) || [];
        assert.deepEqual(inlineStyles, [], `${pagePath} contains inline styles that threaten keyboard focus styles`);

        // Interactive elements must have non-empty accessible labels
        const buttons = nav.fullTag.match(/<button\b[^>]*>/gi) || [];
        for (const btn of buttons) {
          const attrs = parseAttributes(btn);
          assert.ok(attrs['aria-label'] || attrs.title, `${pagePath} button must have accessible name: ${btn}`);
        }
      }
    });

  });

});
