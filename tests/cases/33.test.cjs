const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

class Field {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.listeners = new Map();
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  dispatch(type) {
    const event = { type, target: this };
    (this.listeners.get(type) || []).forEach(handler => handler(event));
  }
}

class FilterDocument {
  constructor() {
    this.fields = new Map(['projectFilter', 'sectionFilter', 'sortFilter'].map(id => [id, new Field(id)]));
    this.listeners = new Map();
  }
  getElementById(id) { return this.fields.get(id) || null; }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
}

describe('Step 33: responsive task filters and separate authentication controls', () => {
  it('associates every filter with a visible label and preserves the filter IDs', () => {
    const html = fs.readFileSync(path.join(ROOT, 'tasks.html'), 'utf8');
    for (const [id, label] of [
      ['projectFilter', 'Project'],
      ['sectionFilter', 'Section'],
      ['sortFilter', 'Sort']
    ]) {
      assert.match(html, new RegExp('<label[^>]+for="' + id + '"[^>]*>[\\s\\S]*?' + label + '[\\s\\S]*?<select[^>]+id="' + id + '"', 'i'));
      assert.match(html, new RegExp('<select[^>]+id="' + id + '"[^>]+aria-label=', 'i'));
    }

    assert.doesNotMatch(html, /id="authButton"[^>]*>[\s\S]*?<button/i);
    assert.match(html, /normalizeAuthControls/);
    assert.match(html, /data-auth-actions="true"/);
  });

  it('updates the correct project, section, and sort state from keyboard-select changes', () => {
    const { TasksManager } = require(path.join(ROOT, 'js/tasksManager.js'));
    const documentRef = new FilterDocument();
    const manager = Object.create(TasksManager.prototype);
    manager.document = documentRef;
    manager.window = {};
    manager.filters = { project: '', section: '', sort: 'dateAddedDesc', search: '' };
    manager._listenersBound = false;
    let renders = 0;
    let sectionRefreshes = 0;
    manager.renderCurrentTasks = () => { renders += 1; };
    manager.populateSectionOptions = () => { sectionRefreshes += 1; };

    manager.setupEventListeners();
    const project = documentRef.getElementById('projectFilter');
    const section = documentRef.getElementById('sectionFilter');
    const sort = documentRef.getElementById('sortFilter');

    project.value = 'project-7';
    project.dispatch('change');
    assert.equal(manager.filters.project, 'project-7');
    assert.equal(manager.filters.section, '');
    assert.equal(section.value, '');
    assert.equal(sectionRefreshes, 1);

    section.value = 'section-2';
    section.dispatch('change');
    assert.equal(manager.filters.section, 'section-2');

    sort.value = 'priorityDesc';
    sort.dispatch('change');
    assert.equal(manager.filters.sort, 'priorityDesc');
    assert.equal(renders, 3);
  });

  it('wraps filters and authentication controls at the audited narrow widths', () => {
    const pageCss = fs.readFileSync(path.join(ROOT, 'css/pages/tasks.css'), 'utf8');
    const legacyCss = fs.readFileSync(path.join(ROOT, 'styles/tasks.css'), 'utf8');
    for (const css of [pageCss, legacyCss]) {
      assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
      assert.match(css, /@media\s*\(max-width:\s*600px\)/);
      assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
      assert.match(css, /flex-wrap:\s*wrap/);
      assert.match(css, /min-inline-size:\s*0/);
    }
  });
});
