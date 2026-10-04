/**
 * Step 45: truthful workspace autosave and draft recovery.
 * All editor, timer, storage, and remote calls are local deterministic fixtures.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function makeStorage(initial = {}, { fail = null } = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  return {
    values,
    fail,
    get(key, fallback) {
      return values.has(key) ? clone(values.get(key)) : clone(fallback);
    },
    set(key, value) {
      if (this.fail && this.fail(key, value)) return false;
      values.set(key, clone(value));
      return { success: true, status: 'success', value: clone(value) };
    }
  };
}

function makeDocument() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        dataset: {},
        hidden: false,
        disabled: false,
        textContent: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {}
      });
    }
    return elements.get(id);
  };
  return {
    readyState: 'complete',
    body: { appendChild() {}, removeChild() {} },
    getElementById: id => id === 'missing' ? null : element(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    elements
  };
}

function makeWindow(documentRef, { storage = null } = {}) {
  const intervals = new Map();
  const events = new Map();
  let nextTimer = 1;
  const toasts = [];
  const windowRef = {
    document: documentRef,
    localStorage: storage,
    parent: {},
    toasts,
    addEventListener(type, callback) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      events.get(type)?.delete(callback);
    },
    dispatch(type, event = {}) {
      for (const callback of Array.from(events.get(type) || [])) callback({ type, ...event });
    },
    listenerCount(type) {
      return (events.get(type) || new Set()).size;
    },
    setInterval(callback, delay) {
      const id = nextTimer++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    runInterval(id) {
      intervals.get(id)?.callback();
    },
    intervalCount() {
      return intervals.size;
    },
    showToast(message, type) {
      toasts.push({ message, type });
    },
    updateToolbarState() {},
    get intervals() {
      return intervals;
    }
  };
  return windowRef;
}

class FakeQuill {
  constructor() {
    this.content = { ops: [{ insert: 'initial\n' }] };
    this.handlers = new Map();
    this.history = { undo() {}, redo() {} };
    this.root = { innerHTML: '<p>initial</p>' };
  }

  on(type, callback) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(callback);
  }

  emit(type, value = {}) {
    for (const callback of this.handlers.get(type) || []) callback(value);
  }

  getContents() {
    return clone(this.content);
  }

  setContents(content) {
    this.content = clone(content);
  }

  getText() {
    return (this.content.ops || []).map(op => typeof op.insert === 'string' ? op.insert : '').join('');
  }
}

function loadWorkspaceCore(windowRef) {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'workspace-core.js'), 'utf8');
  let executable = source.replace(/export function /g, 'function ');
  executable += '\nglobalThis.__workspaceCore = { initWorkspace, destroyWorkspace, getWorkspaceState, startAutoSave, stopAutoSave, hasUnsavedChanges };';
  const context = {
    console,
    Date,
    Error,
    Math,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    JSON,
    window: windowRef,
    // Deliberately omit global document so the module does not auto-bootstrap.
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(executable, context, { filename: 'workspace-core.js' });
  return context.__workspaceCore;
}

function loadWorkspaceDocument({ windowRef, storage, editor, state }) {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'workspace-document.js'), 'utf8');
  let executable = source.replace(/export\s*\{[\s\S]*?\};/, '');
  executable += '\nglobalThis.__workspaceDocument = { saveContent, saveDocument };';
  const context = {
    console,
    Date,
    Error,
    JSON,
    Promise,
    String,
    Number,
    Object,
    window: windowRef,
    localStorage: null,
    quill: editor,
    editorState: state,
    updateLastSaved: () => { state.lastSavedRendered = true; },
    document: windowRef.document
  };
  windowRef.getStorage = () => storage;
  windowRef.editorState = state;
  vm.runInNewContext(executable, context, { filename: 'workspace-document.js' });
  return context.__workspaceDocument;
}

describe('Step 45: workspace autosave truthfulness and recovery', () => {
  it('owns one autosave interval and removes it plus pagehide on dispose', async () => {
    const documentRef = makeDocument();
    const storage = makeStorage();
    const windowRef = makeWindow(documentRef, { storage });
    const editor = new FakeQuill();
    windowRef.Quill = function QuillFixture() { return editor; };
    let saveCalls = 0;
    windowRef.saveContent = async () => {
      saveCalls += 1;
      return { status: 'committed', committed: true };
    };
    const core = loadWorkspaceCore(windowRef);
    await core.initWorkspace({
      documentRef,
      windowRef,
      storage,
      Quill: windowRef.Quill,
      skipDomReady: true
    });

    assert.equal(windowRef.intervalCount(), 1);
    assert.equal(windowRef.listenerCount('pagehide'), 1);
    assert.equal(core.startAutoSave(documentRef, windowRef), false);

    editor.emit('text-change');
    const timerId = [...windowRef.intervals.keys()][0];
    windowRef.runInterval(timerId);
    await Promise.resolve();
    assert.equal(saveCalls, 1);

    core.destroyWorkspace();
    assert.equal(windowRef.intervalCount(), 0);
    assert.equal(windowRef.listenerCount('pagehide'), 0);
    windowRef.runInterval(timerId);
    assert.equal(saveCalls, 1);
  });

  it('does not report saved or advance lastSaved after false or quota-like local writes', async () => {
    const documentRef = makeDocument();
    const state = { dirtyRevision: 1, savedRevision: 0, dirty: true, lastSaved: null };
    const windowRef = makeWindow(documentRef);
    const editor = new FakeQuill();
    const failingStorage = makeStorage({}, { fail: () => true });
    const documentApi = loadWorkspaceDocument({ windowRef, storage: failingStorage, editor, state });

    const result = await documentApi.saveContent({ revision: 1 });
    assert.equal(result.status, 'error');
    assert.equal(result.committed, false);
    assert.equal(state.lastSaved, null);
    assert.equal(state.dirty, true);
    assert.equal(state.saveStatus, 'error');
    assert.equal(windowRef.toasts.some(toast => toast.type === 'success'), false);

    const quotaStorage = makeStorage({}, {
      fail: () => { throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' }); }
    });
    const quotaResult = await documentApi.saveContent({ revision: 1 });
    // Switch the adapter only after the first real failed write so both false
    // and throwing storage boundaries are covered by the same production path.
    windowRef.getStorage = () => quotaStorage;
    const quotaApi = loadWorkspaceDocument({ windowRef, storage: quotaStorage, editor, state });
    const secondResult = await quotaApi.saveContent({ revision: 1 });
    assert.equal(quotaResult.status, 'error');
    assert.equal(secondResult.status, 'error');
    assert.equal(state.lastSaved, null);
  });

  it('reports local saved and sync pending when the awaited remote save fails', async () => {
    const documentRef = makeDocument();
    const state = { dirtyRevision: 4, savedRevision: 0, dirty: true, lastSaved: null };
    const storage = makeStorage();
    const windowRef = makeWindow(documentRef, { storage });
    const editor = new FakeQuill();
    windowRef.parent = {
      saveDocumentToServer: async () => { throw new Error('offline server'); }
    };
    const documentApi = loadWorkspaceDocument({ windowRef, storage, editor, state });

    const result = await documentApi.saveContent({ revision: 4 });

    assert.equal(result.status, 'pending');
    assert.equal(result.local.status, 'committed');
    assert.equal(result.remote.status, 'pending');
    assert.equal(state.lastSaved instanceof Date, true);
    assert.equal(state.dirty, false);
    assert.equal(state.saveStatus, 'local-saved-sync-pending');
    assert.equal(state.syncStatus, 'pending');
    assert.equal(windowRef.toasts.at(-1).message, 'Document saved locally; sync pending.');
    assert.deepEqual(storage.get('workspaceContent', null), editor.getContents());
  });

  it('restores the exact acknowledged local draft after a fresh workspace load', async () => {
    const content = { ops: [{ insert: 'acknowledged draft\n' }, { insert: 'second line' }] };
    const storage = makeStorage({ workspaceContent: content });

    const firstDocument = makeDocument();
    const firstWindow = makeWindow(firstDocument, { storage });
    const firstEditor = new FakeQuill();
    firstEditor.content = content;
    const firstState = { dirtyRevision: 2, savedRevision: 2, dirty: false, lastSaved: new Date() };
    const firstApi = loadWorkspaceDocument({ windowRef: firstWindow, storage, editor: firstEditor, state: firstState });
    const saveResult = await firstApi.saveContent({ revision: 2 });
    assert.equal(saveResult.committed, true);

    const secondDocument = makeDocument();
    const secondWindow = makeWindow(secondDocument, { storage });
    const secondEditor = new FakeQuill();
    secondWindow.Quill = function QuillFixture() { return secondEditor; };
    secondWindow.saveContent = () => saveResult;
    const secondCore = loadWorkspaceCore(secondWindow);
    await secondCore.initWorkspace({
      documentRef: secondDocument,
      windowRef: secondWindow,
      storage,
      Quill: secondWindow.Quill,
      skipDomReady: true
    });

    assert.deepEqual(secondEditor.getContents(), content);
    assert.equal(secondCore.getWorkspaceState().dirty, false);
    secondCore.destroyWorkspace();
  });
});
