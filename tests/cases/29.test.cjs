const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('Step 29: shared button states and motion preferences', () => {
  it('provides semantic focus, disabled, busy, and error states', () => {
    const css = fs.readFileSync(path.join(ROOT, 'css/components/buttons.css'), 'utf8');
    const tokens = fs.readFileSync(path.join(ROOT, 'css/design-tokens.css'), 'utf8');

    assert.match(tokens, /--color-focus\s*:/);
    assert.match(tokens, /--color-disabled-foreground\s*:/);
    assert.match(css, /:focus-visible[\s\S]*?outline:\s*3px/);
    assert.match(css, /\[aria-busy="true"\]/);
    assert.match(css, /\[aria-invalid="true"\]/);
    assert.match(css, /--color-disabled-foreground/);
    assert.match(css, /--color-disabled-background/);
    assert.match(css, /--color-disabled-border/);
    assert.match(css, /--danger-color/);
  });

  it('documents touch target sizes and preserves busy feedback under reduced motion', () => {
    const css = fs.readFileSync(path.join(ROOT, 'css/components/buttons.css'), 'utf8');
    const utilities = fs.readFileSync(path.join(ROOT, 'css/global-utilities.css'), 'utf8');

    assert.match(css, /min-block-size:\s*44px/);
    assert.match(css, /min-inline-size:\s*44px/);
    assert.match(css, /documented 24px exception/i);
    assert.match(css, /min-block-size:\s*24px/);
    assert.match(css, /min-inline-size:\s*24px/);
    assert.match(utilities, /\.touch-target-compact[\s\S]*?min-inline-size:\s*24px/);

    const reducedMotion = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\n\}/i)?.[0] || '';
    assert.ok(reducedMotion, 'a reduced-motion contract is required');
    assert.match(reducedMotion, /animation:\s*none/);
    assert.match(reducedMotion, /opacity:\s*1/);
    assert.match(reducedMotion, /transition-duration/);
  });
});
