const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

class Input {
  constructor(id, required = false) {
    this.id = id;
    this.required = required;
    this.value = '';
    this.hidden = true;
    this.attributes = {};
    this.listeners = new Map();
    this.textContent = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
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

class SettingsDocument {
  constructor() {
    this.nodes = new Map();
    for (const id of ['quoteText', 'quoteAuthor', 'roleModelName']) {
      this.nodes.set(id, new Input(id, true));
    }
    for (const id of ['quoteTextError', 'quoteAuthorError', 'roleModelNameError']) {
      this.nodes.set(id, new Input(id));
    }
    for (const id of ['quoteImage', 'roleModelImage']) this.nodes.set(id, new Input(id));
    this.nodes.set('addQuoteBtn', new Input('addQuoteBtn'));
    this.nodes.set('addRoleModelBtn', new Input('addRoleModelBtn'));
  }
  getElementById(id) { return this.nodes.get(id) || null; }
}

describe('Step 34: responsive settings forms and field-level validation', () => {
  it('associates required fields with programmatic error regions and keeps values on failure', () => {
    const html = fs.readFileSync(path.join(ROOT, 'settings.html'), 'utf8');
    for (const [field, error] of [
      ['quoteText', 'quoteTextError'],
      ['quoteAuthor', 'quoteAuthorError'],
      ['roleModelName', 'roleModelNameError']
    ]) {
      assert.match(html, new RegExp('id="' + field + '"[^>]*required'));
      assert.match(html, new RegExp('id="' + field + '"[^>]*aria-describedby="' + error + '"'));
      assert.match(html, new RegExp('id="' + error + '"[^>]*role="alert"'));
    }
    assert.match(html, /field-level feedback/);
    assert.match(html, /aria-invalid/);
  });

  it('marks empty actions invalid and clears the field error when a value is entered', () => {
    const html = fs.readFileSync(path.join(ROOT, 'settings.html'), 'utf8');
    const start = html.lastIndexOf('<script>', html.indexOf('field-level feedback'));
    const end = html.indexOf('</script>', start);
    assert.ok(start >= 0 && end > start);
    const documentRef = new SettingsDocument();
    vm.runInNewContext(html.slice(start + '<script>'.length, end), { document: documentRef });

    const quoteText = documentRef.getElementById('quoteText');
    const quoteAuthor = documentRef.getElementById('quoteAuthor');
    const textError = documentRef.getElementById('quoteTextError');
    const authorError = documentRef.getElementById('quoteAuthorError');
    documentRef.getElementById('addQuoteBtn').dispatch('click');
    assert.equal(quoteText.getAttribute('aria-invalid'), 'true');
    assert.equal(quoteAuthor.getAttribute('aria-invalid'), 'true');
    assert.equal(textError.hidden, false);
    assert.equal(authorError.hidden, false);

    quoteText.value = 'A useful quote';
    quoteAuthor.value = 'A study partner';
    quoteText.dispatch('input');
    quoteAuthor.dispatch('input');
    assert.equal(quoteText.getAttribute('aria-invalid'), 'false');
    assert.equal(quoteAuthor.getAttribute('aria-invalid'), 'false');
    assert.equal(textError.hidden, true);
    assert.equal(authorError.hidden, true);
    assert.equal(quoteText.value, 'A useful quote');
    assert.equal(quoteAuthor.value, 'A study partner');
  });

  it('keeps settings sections inside the viewport at compact and zoomed layouts', () => {
    const css = fs.readFileSync(path.join(ROOT, 'css/settings.css'), 'utf8');
    assert.match(css, /overflow-x:\s*hidden/);
    assert.match(css, /width:\s*100%/);
    assert.match(css, /min-inline-size:\s*0/);
    assert.match(css, /@media\s*\(max-width:\s*600px\)/);
    assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(css, /--color-foreground/);
  });
});
