/**
 * Step 47: Build an allowlisted multi-page static distribution.
 *
 * The fixtures exercise the distribution boundary without reading or serving
 * the application's current production graph. They cover native module and
 * CSS traversal, virtual Socket.IO handling, exact external allowlisting,
 * reproducibility, aliases, duplicate module detection, unresolved references,
 * and sensitive-file exclusion.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');

const { createTempDir } = require('../harness/helpers.cjs');

let buildStatic;
let StaticBuildError;
let tempRoots = [];

async function writeFiles(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents);
  }
}

async function readFiles(root) {
  const files = [];
  async function visit(directory, relativeDirectory = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath, relativePath);
      else files.push({ path: relativePath.replaceAll('\\', '/'), contents: await fs.readFile(absolutePath) });
    }
  }
  await visit(root);
  return files;
}

function fixtureManifest(overrides = {}) {
  return {
    version: 1,
    pages: ['index.html', 'about.html'],
    assetRoots: [],
    requiredFiles: [],
    assetFiles: [],
    aliases: {},
    virtualDependencies: [],
    virtualRoutes: [],
    requirePinnedExternalAssets: true,
    externalDependencies: [],
    ...overrides
  };
}

async function createFixture(files, manifest) {
  const temp = createTempDir('static-step47-');
  tempRoots.push(temp);
  await writeFiles(temp.path, {
    'config/assets-manifest.json': JSON.stringify(manifest, null, 2),
    ...files
  });
  return {
    root: temp.path,
    manifestPath: path.join(temp.path, 'config', 'assets-manifest.json'),
    out: path.join(temp.path, 'dist')
  };
}

function assertBuildError(error, code) {
  assert.ok(error instanceof StaticBuildError, `expected StaticBuildError, got ${error}`);
  assert.equal(error.code, code);
  return true;
}

describe('Step 47: Allowlisted Static Distribution', () => {
  before(async () => {
    ({ buildStatic, StaticBuildError } = await import('../../scripts/build-static.mjs'));
  });

  after(async () => {
    for (const temp of tempRoots.splice(0)) temp.cleanup();
  });

  it('follows pages, native modules, CSS imports, media, and documented virtual endpoints', async () => {
    const fixture = await createFixture(
      {
        'index.html': `<!doctype html>
          <link rel="stylesheet" href="css/site.css">
          <script type="module" src="app.js"></script>
          <script src="/socket.io/socket.io.js"></script>
          <script src="https://cdn.example.test/lib@1.2.3.js"></script>
          <a href="about.html">About</a>
          <img src="media/logo.svg" alt="Logo">`,
        'about.html': '<!doctype html><a href="index.html">Home</a>',
        'app.js': 'import { feature } from "./feature.js"; new Worker("./worker.js"); console.log(feature);',
        'feature.js': 'export const feature = "fixture";',
        'worker.js': 'importScripts("./worker-helper.js");',
        'worker-helper.js': 'self.onmessage = () => {};',
        'css/site.css': '@import "./theme.css"; .logo { background: url("../media/logo.svg"); }',
        'css/theme.css': ':root { --fixture: #123456; }',
        'media/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>'
      },
      fixtureManifest({
        virtualDependencies: [{ path: '/socket.io/socket.io.js', reason: 'fixture backend endpoint' }],
        externalDependencies: [{
          url: 'https://cdn.example.test/lib@1.2.3.js',
          kind: 'cdn',
          license: 'MIT',
          source: 'fixture package',
          pinned: true
        }],
        assetRoots: ['media']
      })
    );

    const report = await buildStatic({
      rootDir: fixture.root,
      manifestPath: fixture.manifestPath,
      outDir: fixture.out
    });

    assert.deepEqual(report.pages, ['about.html', 'index.html']);
    assert.deepEqual(report.virtual, ['socket.io/socket.io.js']);
    assert.deepEqual(report.external, ['https://cdn.example.test/lib@1.2.3.js']);
    for (const file of [
      'about.html',
      'app.js',
      'feature.js',
      'worker.js',
      'worker-helper.js',
      'css/site.css',
      'css/theme.css',
      'media/logo.svg'
    ]) {
      await fs.access(path.join(fixture.out, ...file.split('/')));
    }
    await assert.rejects(fs.access(path.join(fixture.out, 'socket.io', 'socket.io.js')));
    assert.match(
      (await fs.readFile(path.join(fixture.out, 'app.js'), 'utf8')),
      /import \{ feature \} from "\.\/feature\.js"/
    );
  });

  it('produces byte-identical output across two clean builds', async () => {
    const fixture = await createFixture(
      {
        'index.html': '<script type="module" src="app.js"></script>',
        'about.html': '<link rel="stylesheet" href="style.css">',
        'app.js': 'export const build = "stable";',
        'style.css': 'body { color: #123456; }'
      },
      fixtureManifest()
    );
    const firstOut = path.join(fixture.root, 'dist-one');
    const secondOut = path.join(fixture.root, 'dist-two');

    await buildStatic({ rootDir: fixture.root, manifestPath: fixture.manifestPath, outDir: firstOut });
    await buildStatic({ rootDir: fixture.root, manifestPath: fixture.manifestPath, outDir: secondOut });

    const first = await readFiles(firstOut);
    const second = await readFiles(secondOut);
    assert.deepEqual(
      first.map((file) => [file.path, file.contents.toString('hex')]),
      second.map((file) => [file.path, file.contents.toString('hex')])
    );
  });

  it('resolves a declared source alias at the URL requested by the page', async () => {
    const fixture = await createFixture(
      {
        'index.html': '<script type="module" src="js/cache.js"></script>',
        'about.html': '<p>fixture</p>',
        'vendor/cache.js': 'export const cache = "public";'
      },
      fixtureManifest({ aliases: { 'js/cache.js': 'vendor/cache.js' } })
    );

    const report = await buildStatic({
      rootDir: fixture.root,
      manifestPath: fixture.manifestPath,
      outDir: fixture.out
    });

    assert.equal(report.aliases['js/cache.js'], 'vendor/cache.js');
    assert.equal(await fs.readFile(path.join(fixture.out, 'js', 'cache.js'), 'utf8'), 'export const cache = "public";');
    await assert.rejects(fs.access(path.join(fixture.out, 'vendor', 'cache.js')));
  });

  it('validates import-map targets and resolves bare module specifiers', async () => {
    const fixture = await createFixture(
      {
        'index.html': `<script type="importmap">
          { "imports": { "fixture/": "https://cdn.example.test/lib@1.2.3/" } }
        </script>
        <script type="module">import value from "fixture/module.js"; console.log(value);</script>`,
        'about.html': '<p>fixture</p>'
      },
      fixtureManifest({
        externalDependencies: [
          {
            url: 'https://cdn.example.test/lib@1.2.3/',
            kind: 'cdn',
            license: 'MIT',
            source: 'fixture import map',
            pinned: true
          },
          {
            url: 'https://cdn.example.test/lib@1.2.3/module.js',
            kind: 'cdn',
            license: 'MIT',
            source: 'fixture import map',
            pinned: true
          }
        ]
      })
    );

    const report = await buildStatic({
      rootDir: fixture.root,
      manifestPath: fixture.manifestPath,
      outDir: fixture.out
    });

    assert.deepEqual(report.external, [
      'https://cdn.example.test/lib@1.2.3/',
      'https://cdn.example.test/lib@1.2.3/module.js'
    ]);
  });

  it('flags duplicate native module entries on one page', async () => {
    const fixture = await createFixture(
      {
        'index.html': '<script type="module" src="app.js"></script><script type="module" src="./app.js"></script>',
        'about.html': '<p>fixture</p>',
        'app.js': 'export const ok = true;'
      },
      fixtureManifest()
    );

    await assert.rejects(
      buildStatic({ rootDir: fixture.root, manifestPath: fixture.manifestPath, outDir: fixture.out }),
      (error) => assertBuildError(error, 'DUPLICATE_MODULE_ENTRY')
    );
  });

  it('rejects missing local references and unapproved external resources', async () => {
    const missing = await createFixture(
      {
        'index.html': '<img src="missing.png">',
        'about.html': '<p>fixture</p>'
      },
      fixtureManifest()
    );
    await assert.rejects(
      buildStatic({ rootDir: missing.root, manifestPath: missing.manifestPath, outDir: missing.out }),
      (error) => assertBuildError(error, 'UNRESOLVED_REFERENCE')
    );

    const external = await createFixture(
      {
        'index.html': '<script src="https://unapproved.example.test/app.js"></script>',
        'about.html': '<p>fixture</p>'
      },
      fixtureManifest()
    );
    await assert.rejects(
      buildStatic({ rootDir: external.root, manifestPath: external.manifestPath, outDir: external.out }),
      (error) => assertBuildError(error, 'UNAPPROVED_EXTERNAL')
    );
  });

  it('keeps private, backend, data, archive, audit, upload, and lock files out of dist', async () => {
    const fixture = await createFixture(
      {
        'index.html': '<script src="public/app.js"></script>',
        'about.html': '<p>fixture</p>',
        'public/app.js': 'console.log("browser");',
        '.env': 'SHOULD_NOT_SHIP=1',
        'package-lock.json': '{}',
        'server/private.js': 'secret',
        'data/timetable.json': '{}',
        'uploads/user.html': '<p>private</p>',
        'archive/old.zip': 'archive',
        '.ua/audit/report.json': '{}'
      },
      fixtureManifest({ assetRoots: ['public'] })
    );

    await buildStatic({ rootDir: fixture.root, manifestPath: fixture.manifestPath, outDir: fixture.out });
    const output = await readFiles(fixture.out);
    const outputPaths = output.map((file) => file.path);
    assert.deepEqual(outputPaths, ['about.html', 'index.html', 'public/app.js']);
    assert.equal(outputPaths.some((file) => /(?:\.env|package-lock|server|data|uploads|archive|audit)/i.test(file)), false);
  });

  it('keeps the checked-in topology explicit and requires common token CSS', async () => {
    const manifestPath = path.resolve(__dirname, '..', '..', 'config', 'assets-manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.expectedPageCount, 20);
    assert.equal(manifest.pages.length, 20);
    assert.deepEqual(manifest.pages, [
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
    ]);
    assert.ok(manifest.requiredFiles.includes('css/design-tokens.css'));
    assert.ok(manifest.requiredFiles.includes('css/global-utilities.css'));
    assert.ok(manifest.virtualDependencies.some((dependency) => dependency.path === '/socket.io/socket.io.js'));
    assert.equal(manifest.assetRoots.some((root) => /(?:server|data|uploads|audit|tests)/i.test(root)), false);
  });
});
