/**
 * Step 60: evidence-backed release-candidate convergence.
 *
 * This case audits the release package itself. It does not silently replace
 * the numbered behavioral cases: it verifies that all 60 are present, that
 * the dependency ledger is coherent, and that the source, topology, and
 * evidence artifacts describe the same candidate.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const readText = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));

test('Step 60: the 60-step ledger is complete, unique, and dependency-valid', () => {
  const tasks = readJson('.ua/audit/harness-tasks.json');
  const validation = readJson('.ua/audit/harness-validation.json');
  const ids = tasks.map((task) => task.id);

  assert.equal(tasks.length, 60);
  assert.deepEqual(ids, Array.from({ length: 60 }, (_, index) => String(index + 1).padStart(2, '0')));
  assert.equal(new Set(ids).size, 60);
  assert.equal(validation.valid, true);
  assert.equal(validation.steps, 60);
  assert.deepEqual(validation.errors, []);

  const pending = tasks.filter((task) => !task.checked).map((task) => task.id);
  assert.ok(pending.length <= 1, `unexpected pending steps: ${pending.join(', ')}`);
  if (pending.length === 1) assert.equal(pending[0], '60');

  const knownIds = new Set(ids);
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      assert.ok(knownIds.has(dependency), `${task.id} depends on unknown step ${dependency}`);
    }
  }
});

test('Step 60: every numbered case is executable source with no skipped or todo assertions', () => {
  const caseFiles = fs.readdirSync(path.join(ROOT, 'tests', 'cases'))
    .filter((name) => /^\d{2}\.test\.cjs$/.test(name))
    .sort();
  assert.equal(caseFiles.length, 60);

  for (const [index, file] of caseFiles.entries()) {
    assert.equal(file, `${String(index + 1).padStart(2, '0')}.test.cjs`);
    const source = readText(path.join('tests', 'cases', file));
    assert.match(source, /node:test/);
    assert.doesNotMatch(source, /\b(?:test|it|describe)\.(?:skip|todo)\s*\(/,
      `${file} contains a skipped or todo assertion`);
  }
});

test('Step 60: README, release evidence, and runtime manifests describe the candidate', () => {
  const readme = readText('README.md');
  const evidence = readText('docs/RELEASE_EVIDENCE.md');
  const packageData = readJson('package.json');

  assert.match(readme, /Node\.js[^\n]*22/i);
  assert.match(readme, /run-case\.cjs --all/);
  assert.match(readme, /RELEASE_EVIDENCE\.md/);
  assert.match(evidence, /2026-09-29/);
  assert.match(evidence, /not deployed/i);
  assert.match(evidence, /Firebase|emulator/i);
  assert.match(evidence, /axe/i);
  assert.equal(packageData.engines.node, '>=22.0.0');
  assert.equal(typeof packageData.scripts['build:static'], 'string');
  assert.equal(typeof packageData.scripts['check:modules'], 'string');
  assert.equal(typeof packageData.scripts['verify:deployment'], 'string');
});

test('Step 60: topology, fingerprints, metadata, and scan inventory share one source digest', () => {
  const graph = readJson('.ua/knowledge-graph.json');
  const fingerprints = readJson('.ua/fingerprints.json');
  const meta = readJson('.ua/meta.json');
  const scan = readJson('.ua/intermediate/scan-result.json');

  assert.ok(graph.nodes.length > 0);
  assert.ok(graph.edges.length > 0);
  assert.ok(graph.auditProvenance);
  assert.equal(graph.auditProvenance.mode, 'structural-only');
  assert.equal(graph.auditProvenance.contentDigest, scan.contentDigest);
  assert.equal(graph.auditProvenance.refresh.inventoryDigest, scan.contentDigest);
  assert.equal(meta.contentDigest, scan.contentDigest);
  assert.equal(meta.analyzedFiles, scan.totalFiles);
  assert.equal(meta.mode, 'structural-only');
  assert.equal(Object.keys(fingerprints.files).length, scan.totalFiles);
  assert.equal(fingerprints.gitCommitHash, 'unversioned');
  assert.equal(meta.execution.topologyFiles, scan.totalFiles);
  assert.equal(meta.execution.topologyNodes, graph.nodes.length);
  assert.equal(meta.execution.fingerprintFiles, Object.keys(fingerprints.files).length);
});

test('Step 60: evidence records the release boundary and known verification limits', () => {
  const evidence = readText('docs/RELEASE_EVIDENCE.md');
  assert.match(evidence, /full verification matrix/i);
  assert.match(evidence, /Python.*validator/i);
  assert.match(evidence, /wildcard.*axe|axe.*wildcard/i);
  assert.match(evidence, /legacy.*Gemini|@google\/generative-ai/i);
  assert.match(evidence, /Chart\.js/i);
  assert.match(evidence, /production|deployment/i);
});
