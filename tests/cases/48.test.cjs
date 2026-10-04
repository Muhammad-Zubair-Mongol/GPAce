/**
 * Step 48: module contracts, runtime evidence, and safe controller retirement.
 *
 * The fixtures are deliberately small and isolated. They prove that the
 * checker reports missing local imports, illegal ownership crossings, and
 * strongly connected components, while also exercising HTML inline modules,
 * approved import-map/external dependencies, runtime-resolved retention, and
 * the retirement evidence gate.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { createTempDir } = require('../harness/helpers.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
let checkModuleContracts;
let parseStaticImports;
let parseExports;
let tempRoots = [];

async function writeFiles(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents);
  }
}

function fixtureConfig(overrides = {}) {
  return {
    version: 1,
    entrypoints: [{ file: 'index.html', includeInlineModules: true }],
    boundaries: [{
      name: 'browser-fixture',
      from: ['index.html', 'src/**', 'runtime/**'],
      allow: ['src/**', 'runtime/**', 'shared/**', 'index.html#inline-module-*'],
      deny: ['server/**', 'private/**', 'data/**', 'archive/**', 'audit/**', 'package-lock.json']
    }],
    requiredExports: [],
    runtimeResolvedModules: [],
    dynamicGlobals: [],
    virtualModules: [],
    externalAllowlist: [],
    enforceExternalAllowlist: true,
    ...overrides
  };
}

async function createFixture(files, config) {
  const temp = createTempDir('module-contracts-step48-');
  tempRoots.push(temp);
  await writeFiles(temp.path, {
    'config/module-boundaries.json': JSON.stringify(config, null, 2),
    ...files
  });
  return temp.path;
}

function errorCodes(report) {
  return report.errors.map((error) => error.code);
}

describe('Step 48: Module Contracts and Evidence-Based Retirement', () => {
  before(async () => {
    ({ checkModuleContracts, parseStaticImports, parseExports } = await import('../../scripts/check-module-contracts.mjs'));
  });

  after(async () => {
    for (const temp of tempRoots.splice(0)) temp.cleanup();
  });

  it('passes the real Grind graph and proves only the evidence-backed retirement', async () => {
    const report = await checkModuleContracts({ rootDir: ROOT_DIR });

    assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
    assert.deepEqual(report.unresolved, []);
    assert.deepEqual(report.cycles, []);
    assert.deepEqual(report.retainedRuntimeModules.sort(), ['js/pages/grind.js', 'js/sideDrawer.js']);
    assert.equal(report.retirements.length, 1);
    assert.equal(report.retirements[0].file, 'js/controllers/GrindInitializationController.js');
    assert.equal(report.retirements[0].ready, true);
    assert.equal(report.retirements[0].retainedPath, true);
  });

  it('smoke-loads the replacement and keeps the retired path runtime-safe', async () => {
    const replacement = await import(`${pathToFileURL(path.join(ROOT_DIR, 'js/pages/grind.js')).href}?step48=smoke`);
    const retired = await import(`${pathToFileURL(path.join(ROOT_DIR, 'js/controllers/GrindInitializationController.js')).href}?step48=smoke`);

    assert.equal(typeof replacement.initGrindPage, 'function');
    assert.equal(typeof replacement.getGrindState, 'function');
    assert.equal(typeof replacement.destroyGrindPage, 'function');
    assert.equal(retired.RETIREMENT_EVIDENCE.candidateLoaded, false);

    const first = await replacement.initGrindPage({ window: null, document: null });
    const second = await replacement.initGrindPage({ window: null, document: null });
    assert.strictEqual(first, second);
    replacement.destroyGrindPage();
  });

  it('extracts literal imports and exports without treating comments or templates as edges', () => {
    const imports = parseStaticImports(`
      // import './comment-missing.js';
      const prose = "import './string-missing.js'";
      const template = \`import('./template-missing.js')\`;
      import './real.js';
      const loaded = import('./lazy.js');
      export { value } from './re-export.js';
    `, 'fixture.js');

    assert.deepEqual(imports.map((item) => [item.kind, item.specifier]), [
      ['import', './real.js'],
      ['dynamic-import', './lazy.js'],
      ['export-from', './re-export.js']
    ]);
    assert.deepEqual(parseExports('export const value = 1; export default value;'), ['default', 'value']);
  });

  it('reports a nonexistent local import with its source and line', async () => {
    const root = await createFixture(
      {
        'index.html': '<script type="module" src="src/main.js"></script>',
        'src/main.js': "import './missing.js'; export const ready = true;"
      },
      fixtureConfig()
    );
    const report = await checkModuleContracts({ rootDir: root });

    assert.equal(report.ok, false);
    assert.ok(errorCodes(report).includes('NONEXISTENT_IMPORT'));
    const issue = report.errors.find((error) => error.code === 'NONEXISTENT_IMPORT');
    assert.equal(issue.from, 'src/main.js');
    assert.equal(issue.specifier, './missing.js');
    assert.equal(issue.line, 1);
  });

  it('reports an import that crosses an explicit ownership boundary', async () => {
    const root = await createFixture(
      {
        'index.html': '<script type="module" src="src/main.js"></script>',
        'src/main.js': "import secret from '../server/secret.js'; console.log(secret);",
        'server/secret.js': 'export default "private";'
      },
      fixtureConfig()
    );
    const report = await checkModuleContracts({ rootDir: root });

    assert.equal(report.ok, false);
    assert.ok(errorCodes(report).includes('ILLEGAL_BOUNDARY'));
    const issue = report.errors.find((error) => error.code === 'ILLEGAL_BOUNDARY');
    assert.equal(issue.from, 'src/main.js');
    assert.equal(issue.to, 'server/secret.js');
  });

  it('reports a strongly connected module component as a cycle', async () => {
    const root = await createFixture(
      {
        'index.html': '<script type="module" src="src/a.js"></script>',
        'src/a.js': "import './b.js'; export const a = true;",
        'src/b.js': "import './c.js'; export const b = true;",
        'src/c.js': "import './a.js'; export const c = true;"
      },
      fixtureConfig()
    );
    const report = await checkModuleContracts({ rootDir: root });

    assert.equal(report.ok, false);
    assert.ok(errorCodes(report).includes('MODULE_CYCLE'));
    assert.deepEqual(report.cycles, [['src/a.js', 'src/b.js', 'src/c.js']]);
  });

  it('resolves inline modules, approved external/import-map targets, virtual modules, and runtime roots', async () => {
    const root = await createFixture(
      {
        'index.html': `<script type="importmap">{
          "imports": { "fixture-lib": "https://cdn.example.test/lib@1.0.0.js" }
        }</script>
        <script type="module" src="src/main.js"></script>
        <script type="module">
          import runtime from "virtual:runtime";
          console.log(runtime);
        </script>`,
        'src/main.js': `
          import "fixture-lib";
          import "../shared/feature.js";
          import('./lazy.js');
          globalThis.runtimeHook = true;
        `,
        'src/lazy.js': 'export const lazy = true;',
        'shared/feature.js': 'export const feature = true;',
        'runtime/legacy.js': 'export const retained = true;'
      },
      fixtureConfig({
        virtualModules: [{ specifier: 'virtual:runtime', reason: 'browser-provided runtime' }],
        externalAllowlist: ['https://cdn.example.test/lib@1.0.0.js'],
        runtimeResolvedModules: [{ file: 'runtime/legacy.js', via: 'runtime loader', retain: true }],
        dynamicGlobals: [{ name: 'globalThis.runtimeHook', owner: 'src/main.js', required: true }]
      })
    );
    const report = await checkModuleContracts({ rootDir: root });

    assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
    assert.equal(report.external.length, 1);
    assert.equal(report.external[0].allowed, true);
    assert.equal(report.virtual.length, 1);
    assert.ok(report.edges.some((edge) => edge.kind === 'dynamic-import' && edge.to === 'src/lazy.js'));
    assert.ok(report.retainedRuntimeModules.includes('runtime/legacy.js'));
    assert.equal(report.runtimeGlobals[0].observed, true);
  });

  it('does not allow a retirement declaration to hide a live incoming edge', async () => {
    const root = await createFixture(
      {
        'index.html': '<script type="module" src="src/main.js"></script>',
        'src/main.js': "import '../legacy.js';",
        'legacy.js': 'export const old = true;',
        'src/replacement.js': 'export function replacement() {}'
      },
      fixtureConfig({
        requiredExports: [{ file: 'src/replacement.js', exports: ['replacement'] }],
        retirements: [{
          file: 'legacy.js',
          decision: 'retired',
          replacement: 'src/replacement.js',
          replacementExports: ['replacement'],
          staticEvidence: { incomingStaticEdges: 0, noDirectHtmlMount: true },
          runtimeEvidence: { browserEntrypoint: 'index.html', canonicalModule: 'src/replacement.js', candidateLoaded: false },
          smokeAssertions: [{ id: 'replacement-smoke', verified: true }]
        }]
      })
    );
    const report = await checkModuleContracts({ rootDir: root });

    assert.equal(report.ok, false);
    assert.ok(errorCodes(report).includes('RETIREMENT_REFERENCED'));
    assert.ok(errorCodes(report).includes('RETIREMENT_UNPROVEN'));
  });
});
