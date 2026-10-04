/** Step 27: Tasks page state, retry, and filter preservation verification. */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('../harness/node_modules/playwright');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TASKS_MANAGER_SOURCE = fs.readFileSync('js/tasksManager.js', 'utf8');

function fixture({ filters = true } = {}) {
  return `<!doctype html><html><body>
    ${filters ? '<input id="taskSearch" aria-label="Search tasks"><select id="projectFilter"><option value="">All Projects</option></select><select id="sectionFilter"><option value="">All Sections</option></select><select id="sortFilter"><option value="dateAddedDesc">Newest</option><option value="priorityAsc">Priority</option></select>' : ''}
    <main id="tasksList"></main>
  </body></html>`;
}

async function installIntegration(page, mode, tasks = []) {
  await page.evaluate(({ mode: initialMode, initialTasks }) => {
    window.__fixture = {
      mode: initialMode,
      tasks: initialTasks,
      calls: 0,
      authenticated: initialMode !== 'disconnected'
    };
    if (initialMode === 'loading') {
      window.__fixture.deferred = new Promise(resolve => { window.__fixture.resolve = resolve; });
    }
    window.todoistIntegration = {
      async isAuthenticated() {
        return window.__fixture.authenticated;
      },
      async getTasks() {
        window.__fixture.calls += 1;
        if (window.__fixture.mode === 'error' && window.__fixture.calls === 1) {
          throw new Error('Todoist temporarily unavailable');
        }
        if (window.__fixture.mode === 'loading') return window.__fixture.deferred;
        return window.__fixture.tasks;
      },
      initiateLogin() {
        window.__fixture.loginCalls = (window.__fixture.loginCalls || 0) + 1;
      }
    };
  }, { mode, initialTasks: tasks });
  await page.addScriptTag({ content: TASKS_MANAGER_SOURCE });
}

async function waitForState(page, state) {
  await page.waitForFunction(expected => document.querySelector('#tasksList')?.dataset.state === expected, state);
}

describe('Step 27: Tasks manager states and filters', () => {
  let browser;
  let page;

  before(async () => {
    browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent(fixture({ filters: false }));
  });

  afterEach(async () => {
    await page.close();
  });

  after(async () => {
    await browser.close();
  });

  it('renders a disconnected state when the integration and search field are absent', async () => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.evaluate(() => { window.todoistIntegration = null; });
    await page.addScriptTag({ content: TASKS_MANAGER_SOURCE });
    await waitForState(page, 'disconnected');

    assert.equal(await page.locator('#tasksList').getAttribute('data-state'), 'disconnected');
    assert.equal(await page.locator('#connectTodoistBtn').textContent(), 'Connect Todoist');
    assert.deepEqual(pageErrors, [], 'missing optional controls must not throw during initialization');
  });

  it('keeps loading and valid empty account states distinct', async () => {
    await page.setContent(fixture());
    await installIntegration(page, 'loading');
    await waitForState(page, 'loading');
    assert.match(await page.locator('#tasksList').textContent(), /Loading tasks/);

    await page.evaluate(() => window.__fixture.resolve([]));
    await waitForState(page, 'empty');
    assert.match(await page.locator('#tasksList').textContent(), /No tasks found/);
    assert.equal(await page.locator('#tasksList .task-state-empty').getAttribute('role'), 'status');
  });

  it('retries a failed load once and renders recovered tasks without authenticating automatically', async () => {
    const tasks = [{ id: 't-1', content: 'Recovered task', priority: 2, created_at: '2026-09-28T10:00:00Z' }];
    await page.setContent(fixture());
    await installIntegration(page, 'error', tasks);
    await waitForState(page, 'error');
    assert.equal(await page.locator('#tasksRetry').textContent(), 'Retry');
    assert.equal(await page.evaluate(() => window.__fixture.loginCalls || 0), 0);

    // Dispatch the two activations in one browser turn. The first request may
    // complete immediately; a second Playwright actionability click would
    // then race with the legitimate replacement of the error view.
    await page.evaluate(() => {
      const retry = document.querySelector('#tasksRetry');
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await waitForState(page, 'ready');
    assert.equal(await page.evaluate(() => window.__fixture.calls), 2, 'duplicate retry clicks share one in-flight request');
    assert.deepEqual(await page.locator('.task-title').allTextContents(), ['Recovered task']);
  });

  it('preserves project, section, sort, and search filters across refresh', async () => {
    const tasks = [
      { id: 'a', content: 'Alpha planning', project_id: 'p1', project_name: 'Alpha', section_id: 's1', section_name: 'Today', priority: 2, created_at: '2026-09-28T09:00:00Z' },
      { id: 'b', content: 'Alpha review', project_id: 'p1', project_name: 'Alpha', section_id: 's2', section_name: 'Later', priority: 1, created_at: '2026-09-27T09:00:00Z' },
      { id: 'c', content: 'Beta report', project_id: 'p2', project_name: 'Beta', section_id: 's3', section_name: 'Today', priority: 3, created_at: '2026-09-26T09:00:00Z' }
    ];
    await page.setContent(fixture());
    await installIntegration(page, 'ready', tasks);
    await waitForState(page, 'ready');

    await page.selectOption('#projectFilter', 'p1');
    await page.selectOption('#sectionFilter', 's2');
    await page.selectOption('#sortFilter', 'priorityAsc');
    await page.locator('#taskSearch').fill('review');
    assert.deepEqual(await page.locator('.task-title').allTextContents(), ['Alpha review']);

    await page.evaluate(() => window.tasksManager.loadTasks());
    await waitForState(page, 'ready');
    assert.equal(await page.locator('#projectFilter').inputValue(), 'p1');
    assert.equal(await page.locator('#sectionFilter').inputValue(), 's2');
    assert.equal(await page.locator('#sortFilter').inputValue(), 'priorityAsc');
    assert.equal(await page.locator('#taskSearch').inputValue(), 'review');
    assert.deepEqual(await page.locator('.task-title').allTextContents(), ['Alpha review']);
  });
});
