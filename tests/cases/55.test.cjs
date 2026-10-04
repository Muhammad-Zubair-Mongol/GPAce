/**
 * Step 55: dependency exposure and CI reproducibility.
 *
 * Audit registry access is deliberately avoided in these tests. The seeded
 * reports exercise the same npm-audit v2 shape that the CI workflow consumes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createTempDir } = require('../harness/helpers.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
let checkDependencies;
let createSbom;
let buildReachability;
let validateAdvisoryExceptions;
let stableStringify;

test.before(async () => {
    ({ checkDependencies, createSbom, buildReachability, validateAdvisoryExceptions, stableStringify } =
        await import('../../scripts/check-dependencies.mjs'));
});
const CLEAN_AUDIT = Object.freeze({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { high: 0, critical: 0, total: 0 } }
});

function fixturePackage({ production = {}, development = {} } = {}) {
    return {
        name: 'fixture-app',
        version: '1.0.0',
        engines: { node: '>=22.0.0' },
        dependencies: production,
        devDependencies: development
    };
}

function fixtureLock(packageData, entries = {}) {
    const root = {
        name: packageData.name,
        version: packageData.version,
        engines: packageData.engines,
        dependencies: packageData.dependencies,
        devDependencies: packageData.devDependencies
    };
    return {
        name: packageData.name,
        version: packageData.version,
        lockfileVersion: 3,
        requires: true,
        packages: { '': root, ...entries }
    };
}

function policyConfig(exceptions = []) {
    return {
        version: 1,
        metadata: {
            owner: 'fixture-owner',
            reviewedOn: '2026-09-01',
            source: 'offline fixture',
            reviewCadenceDays: 30
        },
        policy: {
            failSeverities: ['high', 'critical'],
            productionReachability: 'lock-graph',
            offlineAudit: 'warning-with-fixture-coverage',
            legacyPackages: []
        },
        exceptions
    };
}

function advisory(packageName, severity, url, nodePath = `node_modules/${packageName}`) {
    return {
        auditReportVersion: 2,
        vulnerabilities: {
            [packageName]: {
                name: packageName,
                severity,
                isDirect: true,
                via: [{
                    source: url,
                    title: `${packageName} fixture advisory`,
                    url,
                    severity
                }],
                nodes: [nodePath]
            }
        },
        metadata: { vulnerabilities: { [severity]: 1, total: 1 } }
    };
}

function mergeAudits(...reports) {
    const vulnerabilities = {};
    for (const report of reports) Object.assign(vulnerabilities, report.vulnerabilities);
    return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { total: Object.keys(vulnerabilities).length } } };
}

test('Step 55: current locked dependencies pass the offline policy and emit a deterministic SBOM', async () => {
    const result = await checkDependencies({
        rootDir: ROOT_DIR,
        auditReport: CLEAN_AUDIT,
        now: '2026-09-29'
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
    assert.equal(result.audit.available, true);
    assert.equal(result.sbom.bomFormat, 'CycloneDX');
    assert.ok(result.sbom.components.some(component => component.name === '@google/genai'));
    assert.ok(result.warnings.some(warning => warning.code === 'LEGACY_SDK_PRESENT'));
    assert.doesNotMatch(stableStringify(result.sbom), /"(?:apiKey|secret|token)"\s*:/i);

    const second = createSbom(result.packageData, result.lockData, buildReachability(result.packageData, result.lockData));
    assert.equal(stableStringify(result.sbom), stableStringify(second));
});

test('Step 55: only reachable production high/critical advisories block the gate', async () => {
    const packageData = fixturePackage({
        production: { 'prod-package': '1.0.0' },
        development: { 'dev-package': '1.0.0' }
    });
    const lockData = fixtureLock(packageData, {
        'node_modules/prod-package': { version: '1.0.0', resolved: 'https://registry.example/prod.tgz', integrity: 'sha512-cHJvZA==' },
        'node_modules/dev-package': { version: '1.0.0', resolved: 'https://registry.example/dev.tgz', integrity: 'sha512-ZGV2' }
    });
    const audit = mergeAudits(
        advisory('prod-package', 'high', 'https://github.com/advisories/GHSA-prod'),
        advisory('dev-package', 'critical', 'https://github.com/advisories/GHSA-dev')
    );
    const result = await checkDependencies({ packageData, lockData, exceptionConfig: policyConfig(), auditReport: audit });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.code === 'REACHABLE_HIGH_ADVISORY' && error.package === 'prod-package'));
    assert.ok(result.warnings.some(warning => warning.code === 'DEVELOPMENT_ONLY_ADVISORY' && warning.package === 'dev-package'));
    assert.equal(result.errors.some(error => error.package === 'dev-package'), false);
});

test('Step 55: exception metadata is validated before a reachable advisory can be waived', async () => {
    const packageData = fixturePackage({ production: { 'prod-package': '1.0.0' } });
    const lockData = fixtureLock(packageData, {
        'node_modules/prod-package': { version: '1.0.0', resolved: 'https://registry.example/prod.tgz', integrity: 'sha512-cHJvZA==' }
    });
    const url = 'https://github.com/advisories/GHSA-prod';
    const validException = {
        id: 'fixture-prod-exception',
        advisoryUrl: url,
        package: 'prod-package',
        dependencyPath: 'node_modules/prod-package',
        reachabilityEvidence: ['lock graph: fixture-app > prod-package', 'runtime: production route fixture'],
        owner: 'security@example.test',
        reviewedOn: '2026-09-01',
        expiresOn: '2099-12-31',
        severity: 'high',
        reason: 'Fixture demonstrates an explicit, time-bounded review.'
    };
    const passed = await checkDependencies({
        packageData,
        lockData,
        exceptionConfig: policyConfig([validException]),
        auditReport: advisory('prod-package', 'high', url),
        now: '2026-09-29'
    });
    assert.equal(passed.ok, true, JSON.stringify(passed.errors, null, 2));
    assert.ok(passed.warnings.some(warning => warning.code === 'ADVISORY_EXCEPTION_APPLIED'));

    const expired = { ...validException, id: 'expired', expiresOn: '2026-01-01' };
    const invalid = validateAdvisoryExceptions(policyConfig([expired]), { now: '2026-09-29' });
    assert.ok(invalid.errors.some(error => error.code === 'EXPIRED_EXCEPTION'));
    assert.ok(invalid.errors.some(error => error.code === 'EXCEPTION_METADATA_REQUIRED') === false);

    const missingMetadata = { ...validException, id: 'missing-owner', owner: '' };
    const metadataResult = validateAdvisoryExceptions(policyConfig([missingMetadata]), { now: '2026-09-29' });
    assert.ok(metadataResult.errors.some(error => error.code === 'EXCEPTION_METADATA_REQUIRED' && error.field === 'owner'));
});

test('Step 55: lock drift is a hard failure and offline audit availability is explicit', async () => {
    const packageData = fixturePackage({ production: { 'prod-package': '1.0.0' } });
    const lockData = fixtureLock(fixturePackage());
    const drift = await checkDependencies({
        packageData,
        lockData,
        exceptionConfig: policyConfig(),
        offline: true,
        now: '2026-09-29'
    });
    assert.equal(drift.ok, false);
    assert.ok(drift.errors.some(error => error.code === 'LOCK_DRIFT'));
    assert.ok(drift.warnings.some(warning => warning.code === 'AUDIT_UNAVAILABLE_OFFLINE'));

    const clean = await checkDependencies({
        packageData: fixturePackage(),
        lockData: fixtureLock(fixturePackage()),
        exceptionConfig: policyConfig(),
        offline: true,
        now: '2026-09-29'
    });
    assert.equal(clean.ok, true, JSON.stringify(clean.errors, null, 2));
    assert.ok(clean.warnings.some(warning => warning.code === 'AUDIT_UNAVAILABLE_OFFLINE'));
});

test('Step 55: CLI writes policy and SBOM artifacts without contacting production services', async () => {
    const fixture = createTempDir('gpace-step55-cli-');
    try {
        const packageData = fixturePackage({ production: { 'prod-package': '1.0.0' } });
        const lockData = fixtureLock(packageData, {
            'node_modules/prod-package': { version: '1.0.0', resolved: 'https://registry.example/prod.tgz', integrity: 'sha512-cHJvZA==' }
        });
        await fs.mkdir(path.join(fixture.path, 'config'), { recursive: true });
        await fs.writeFile(path.join(fixture.path, 'package.json'), JSON.stringify(packageData));
        await fs.writeFile(path.join(fixture.path, 'package-lock.json'), JSON.stringify(lockData));
        await fs.writeFile(path.join(fixture.path, 'config', 'advisory-exceptions.json'), JSON.stringify(policyConfig()));
        await fs.writeFile(path.join(fixture.path, 'audit.json'), JSON.stringify(CLEAN_AUDIT));

        const args = [
            'scripts/check-dependencies.mjs', '--root', fixture.path,
            '--audit-json', 'audit.json', '--sbom', 'artifacts/sbom.json', '--report', 'artifacts/report.json', '--offline'
        ];
        const first = spawnSync(process.execPath, args, { cwd: ROOT_DIR, encoding: 'utf8', windowsHide: true });
        assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
        const firstSbom = await fs.readFile(path.join(fixture.path, 'artifacts', 'sbom.json'), 'utf8');
        const firstReport = await fs.readFile(path.join(fixture.path, 'artifacts', 'report.json'), 'utf8');
        const second = spawnSync(process.execPath, args, { cwd: ROOT_DIR, encoding: 'utf8', windowsHide: true });
        assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
        assert.equal(firstSbom, await fs.readFile(path.join(fixture.path, 'artifacts', 'sbom.json'), 'utf8'));
        assert.equal(firstReport, await fs.readFile(path.join(fixture.path, 'artifacts', 'report.json'), 'utf8'));
    } finally {
        fixture.cleanup();
    }
});

test('Step 55: CI pins Node 22, locked installs, audit/SBOM checks and build without secrets or deployment', async () => {
    const workflow = await fs.readFile(path.join(ROOT_DIR, '.github', 'workflows', 'verify.yml'), 'utf8');
    assert.match(workflow, /node-version:\s*22/);
    assert.match(workflow, /npm ci --ignore-scripts/);
    assert.match(workflow, /npm audit --omit=dev/);
    assert.match(workflow, /scripts\/check-dependencies\.mjs/);
    assert.match(workflow, /dependency-sbom\.json/);
    assert.match(workflow, /run-case\.cjs 55/);
    assert.match(workflow, /npm run build:static/);
    assert.doesNotMatch(workflow, /firebase\s+deploy|firebase-tools|secrets\./i);

    const config = JSON.parse(await fs.readFile(path.join(ROOT_DIR, 'config', 'advisory-exceptions.json'), 'utf8'));
    const validation = validateAdvisoryExceptions(config, { now: '2026-09-29' });
    assert.deepEqual(validation.errors, []);
    assert.deepEqual(config.exceptions, []);
});
