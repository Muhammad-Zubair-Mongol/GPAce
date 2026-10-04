/** Step 26: Grind mode responsive collision and overflow verification. */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('../harness/node_modules/playwright');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const GRIND_CSS = fs.readFileSync('grind.css', 'utf8');
const NOTE_CSS = fs.readFileSync('css/grind.css', 'utf8');

function fixture() {
  return `<!doctype html>
  <html><head><meta charset="utf-8"></head><body>
    <nav class="top-nav"><div class="nav-brand"><img class="logo-brand" src="logo.png" alt="GPAce"><a href="#">GPAce</a></div><div class="nav-links"><a href="#">Grind</a></div></nav>
    <button class="relaxed-mode-btn">Relaxed mode</button>
    <button class="workspace-toggle">Workspace</button>
    <a class="feedback-button" href="#feedback">Feedback</a>
    <div class="container">
      <div class="home-dual-task-wrapper">
        <section class="home-task-card"><div class="home-card-header">General tasks <button>Add</button></div><div class="priority-task-box">A long task title that must wrap inside its card instead of widening the document.</div></section>
        <section class="home-task-card"><div class="home-card-header">Live schedule</div><div class="current-task-header"><h1 id="taskTitle">A very long current task heading that should remain readable on a narrow phone viewport</h1></div></section>
      </div>
      <div class="task-container"><div class="pomodoro-container"><div class="timer-mode-selector modern"><button>Focus</button><button>Break</button></div></div><div class="stats-container"><div class="stat-card">Status</div></div></div>
    </div>
    <div class="ai-researcher-container modern"><div class="workspace-content"><div style="width:720px">Assistant content that must stay inside the viewport.</div></div></div>
    <div class="workspace-panel"><div class="workspace-content"><iframe title="Workspace"></iframe></div></div>
    <div class="fab-container"><button class="scan-notes-button">Scan</button><button class="add-task-button">Add task</button></div>
    <button class="sync-tasks-btn"><span>Sync tasks</span></button>
  </body></html>`;
}

async function measure(page) {
  return page.evaluate(() => {
    const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null;
    const fixed = ['.relaxed-mode-btn', '.feedback-button', '.workspace-toggle', '.add-task-button', '.sync-tasks-btn'];
    const boxes = fixed.map(selector => ({ selector, rect: rect(selector) }));
    const maxRight = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      ...boxes.map(entry => entry.rect?.right || 0)
    );
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      maxRight,
      heading: rect('#taskTitle'),
      card: rect('.current-task-header'),
      fixed: boxes
    };
  });
}

describe('Step 26: Grind responsive layout', () => {
  let browser;
  let page;

  before(async () => {
    browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
    page = await browser.newPage();
    await page.setContent(fixture());
    await page.addStyleTag({
      content: `${GRIND_CSS}\n${NOTE_CSS}\n*, *::before, *::after { transition: none !important; animation: none !important; }`
    });
  });

  after(async () => {
    await browser.close();
  });

  it('keeps the document and fixed controls within 320, 390, 768, and 1440px viewports', async () => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const result = await measure(page);
      assert.ok(result.documentWidth <= width + 1, `${width}px document width was ${result.documentWidth}`);
      assert.ok(result.bodyWidth <= width + 1, `${width}px body width was ${result.bodyWidth}`);
      assert.ok(result.maxRight <= width + 1, `${width}px control exceeded viewport: ${JSON.stringify(result.fixed)}`);
    }
  });

  it('keeps the current task heading below the mobile control rail in each open/closed state', async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    for (const workspaceOpen of [false, true]) {
      for (const assistantExpanded of [false, true]) {
        await page.evaluate(({ workspaceOpen: open, assistantExpanded: expanded }) => {
          document.querySelector('.workspace-panel').classList.toggle('open', open);
          document.querySelector('.ai-researcher-container').classList.toggle('expanded', expanded);
          document.body.classList.toggle('workspace-open', open);
        }, { workspaceOpen, assistantExpanded });
        const result = await measure(page);
        assert.ok(result.documentWidth <= 391, `overflow in workspace=${workspaceOpen}, assistant=${assistantExpanded}`);
        assert.ok(result.heading.top >= result.card.top, 'task heading escaped its current-task card');
        const visibleControls = result.fixed.filter(({ rect }) => rect && rect.width > 0 && rect.height > 0);
        for (const control of visibleControls) {
          const overlaps = result.heading.left < control.rect.right && result.heading.right > control.rect.left
            && result.heading.top < control.rect.bottom && result.heading.bottom > control.rect.top;
          assert.equal(overlaps, false, `heading overlaps ${control.selector} in workspace=${workspaceOpen}, assistant=${assistantExpanded}`);
        }
      }
    }
  });

  it('uses local sizing constraints without introducing blanket horizontal overflow hiding', () => {
    const guardStart = GRIND_CSS.indexOf('Grind responsive collision guard');
    assert.notEqual(guardStart, -1, 'responsive guard is documented in grind.css');
    const guard = GRIND_CSS.slice(guardStart);
    assert.match(guard, /max-inline-size:\s*100vw/);
    assert.match(guard, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(guard, /(?:html|body)\s*\{[^}]*overflow-x\s*:\s*hidden/s);
    assert.match(NOTE_CSS, /\.fab-container\s*>\s*\.add-task-button/);
  });
});
