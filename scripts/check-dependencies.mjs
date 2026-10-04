#!/usr/bin/env node

/**
 * Step 55 dependency and reproducibility gate.
 *
 * The checker intentionally consumes npm's lock graph and a normalized audit
 * report. It does not infer production reachability from npm's aggregate
 * severity counts. Registry access is optional: callers can provide an audit
 * JSON file or use --offline for deterministic local verification.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, moderate: 1, high: 2, critical: 3 });
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const DEFAULT_LEGACY_PACKAGES = ['@google/generative-ai'];

export class DependencyPolicyError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'DependencyPolicyError';
        this.code = details.code || 'DEPENDENCY_POLICY_FAILED';
        this.details = details;
    }
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortedObject(value) {
    if (Array.isArray(value)) return value.map(sortedObject);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedObject(value[key])]));
}

export function stableStringify(value) {
    return JSON.stringify(sortedObject(value), null, 2);
}

async function readJson(filePath) {
    const source = await fs.readFile(filePath, 'utf8');
    return JSON.parse(source.replace(/^\uFEFF/, ''));
}

function normalizePath(value) {
    return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function dependencySections(data) {
    return {
        dependencies: isObject(data?.dependencies) ? data.dependencies : {},
        devDependencies: isObject(data?.devDependencies) ? data.devDependencies : {},
        optionalDependencies: isObject(data?.optionalDependencies) ? data.optionalDependencies : {},
        peerDependencies: isObject(data?.peerDependencies) ? data.peerDependencies : {},
        engines: isObject(data?.engines) ? data.engines : {}
    };
}

export function compareLockedRoot(packageData, lockData) {
    const errors = [];
    const lockRoot = lockData?.packages?.[''];
    if (!isObject(lockRoot)) {
        return [{
            code: 'LOCKFILE_UNSUPPORTED',
            message: 'package-lock.json does not contain a lockfile v3 root package entry.'
        }];
    }
    if (lockData.lockfileVersion !== 3) {
        errors.push({
            code: 'LOCKFILE_VERSION',
            message: `Expected lockfileVersion 3, received ${lockData.lockfileVersion}.`
        });
    }
    if (packageData?.name !== lockRoot.name || packageData?.version !== lockRoot.version) {
        errors.push({
            code: 'LOCK_DRIFT',
            message: 'package.json name/version differ from the locked root package.',
            packageRoot: { name: packageData?.name, version: packageData?.version },
            lockRoot: { name: lockRoot.name, version: lockRoot.version }
        });
    }

    const packageSections = dependencySections(packageData);
    const lockSections = dependencySections(lockRoot);
    for (const section of Object.keys(packageSections)) {
        if (stableStringify(packageSections[section]) !== stableStringify(lockSections[section])) {
            errors.push({
                code: 'LOCK_DRIFT',
                section,
                message: `package.json ${section} do not match package-lock.json packages[""].${section}.`
            });
        }
    }
    return errors;
}

function packageNameFromNodePath(nodePath) {
    const normalized = normalizePath(nodePath);
    const parts = normalized.split('/').filter(Boolean);
    const index = parts.lastIndexOf('node_modules');
    if (index < 0 || !parts[index + 1]) return null;
    if (parts[index + 1].startsWith('@') && parts[index + 2]) {
        return `${parts[index + 1]}/${parts[index + 2]}`;
    }
    return parts[index + 1];
}

function parentNodePath(nodePath) {
    const normalized = normalizePath(nodePath);
    const marker = '/node_modules/';
    const index = normalized.lastIndexOf(marker);
    if (index >= 0) return normalized.slice(0, index);
    return '';
}

function resolveNodePackage(packageName, parentPath, packages) {
    let current = normalizePath(parentPath);
    while (true) {
        const candidate = current ? `${current}/node_modules/${packageName}` : `node_modules/${packageName}`;
        if (isObject(packages[candidate])) return candidate;
        if (!current) break;
        current = parentNodePath(current);
    }
    return null;
}

function directDependencies(data, sectionNames) {
    const result = {};
    for (const section of sectionNames) {
        const values = isObject(data?.[section]) ? data[section] : {};
        Object.assign(result, values);
    }
    return result;
}

export function buildReachability(packageData, lockData) {
    const packages = lockData?.packages || {};
    const production = new Set();
    const development = new Set();
    const missing = [];

    function walk(packageName, parentPath, target, rootScope) {
        const resolved = resolveNodePackage(packageName, parentPath, packages);
        if (!resolved) {
            missing.push({ packageName, parentPath: parentPath || null, scope: rootScope });
            return;
        }
        if (target.has(resolved)) return;
        target.add(resolved);
        const entry = packages[resolved] || {};
        // Peer dependencies are only traversed when npm materializes them as
        // regular lock entries. They are obligations, not proof that a
        // missing optional peer is installed in production.
        const childDependencies = directDependencies(entry, ['dependencies', 'optionalDependencies']);
        for (const childName of Object.keys(childDependencies).sort()) {
            walk(childName, resolved, target, rootScope);
        }
    }

    const prodRoots = directDependencies(packageData, ['dependencies', 'optionalDependencies']);
    const devRoots = directDependencies(packageData, ['devDependencies']);
    for (const name of Object.keys(prodRoots).sort()) walk(name, '', production, 'production');
    for (const name of Object.keys(devRoots).sort()) walk(name, '', development, 'development');

    return {
        production,
        development,
        missing,
        productionNames: new Set([...production].map(packageNameFromNodePath).filter(Boolean)),
        developmentNames: new Set([...development].map(packageNameFromNodePath).filter(Boolean))
    };
}

function dateOnly(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function todayStart(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function validateHttpsUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function validateAdvisoryExceptions(config, options = {}) {
    const errors = [];
    const warnings = [];
    const exceptions = Array.isArray(config?.exceptions) ? config.exceptions : null;
    const metadata = config?.metadata;
    const policy = config?.policy;
    if (!isObject(config) || config.version !== 1) {
        errors.push({ code: 'EXCEPTION_CONFIG_VERSION', message: 'Advisory exception config must declare version 1.' });
    }
    if (!isObject(metadata)) {
        errors.push({ code: 'EXCEPTION_METADATA_REQUIRED', message: 'Advisory exception metadata is required.' });
    } else {
        for (const field of ['owner', 'reviewedOn', 'source']) {
            if (typeof metadata[field] !== 'string' || !metadata[field].trim()) {
                errors.push({ code: 'EXCEPTION_METADATA_REQUIRED', field, message: `Exception metadata requires ${field}.` });
            }
        }
        if (metadata.reviewedOn && !dateOnly(metadata.reviewedOn)) {
            errors.push({ code: 'EXCEPTION_METADATA_DATE', field: 'reviewedOn', message: 'reviewedOn must be an ISO date.' });
        }
    }
    if (!isObject(policy)) {
        errors.push({ code: 'EXCEPTION_POLICY_REQUIRED', message: 'Advisory exception policy is required.' });
    }
    if (!exceptions) {
        errors.push({ code: 'EXCEPTION_LIST_REQUIRED', message: 'exceptions must be an array.' });
        return { errors, warnings, exceptions: [] };
    }

    const seen = new Set();
    const today = todayStart(options.now);
    for (const [index, exception] of exceptions.entries()) {
        const label = `exceptions[${index}]`;
        if (!isObject(exception)) {
            errors.push({ code: 'EXCEPTION_METADATA_REQUIRED', message: `${label} must be an object.` });
            continue;
        }
        for (const field of ['id', 'advisoryUrl', 'package', 'dependencyPath', 'reachabilityEvidence', 'owner', 'reviewedOn', 'expiresOn', 'reason']) {
            const value = exception[field];
            const validEvidence = field === 'reachabilityEvidence' && ((typeof value === 'string' && value.trim()) || (Array.isArray(value) && value.length > 0));
            if (field === 'reachabilityEvidence' ? !validEvidence : typeof value !== 'string' || !value.trim()) {
                errors.push({ code: 'EXCEPTION_METADATA_REQUIRED', field, message: `${label} requires ${field}.` });
            }
        }
        if (exception.id && seen.has(exception.id)) {
            errors.push({ code: 'DUPLICATE_EXCEPTION', id: exception.id, message: `Duplicate exception id ${exception.id}.` });
        }
        if (exception.id) seen.add(exception.id);
        if (exception.advisoryUrl && !validateHttpsUrl(exception.advisoryUrl)) {
            errors.push({ code: 'EXCEPTION_URL_INVALID', id: exception.id, message: `${label}.advisoryUrl must be an https URL.` });
        }
        if (exception.dependencyPath && (exception.dependencyPath.includes('..') || exception.dependencyPath.includes('*'))) {
            errors.push({ code: 'EXCEPTION_PATH_INVALID', id: exception.id, message: `${label}.dependencyPath cannot contain traversal or wildcards.` });
        }
        for (const field of ['reviewedOn', 'expiresOn']) {
            if (exception[field] && !dateOnly(exception[field])) {
                errors.push({ code: 'EXCEPTION_DATE_INVALID', id: exception.id, field, message: `${label}.${field} must be an ISO date.` });
            }
        }
        const expires = dateOnly(exception.expiresOn);
        if (expires && expires < today) {
            errors.push({ code: 'EXPIRED_EXCEPTION', id: exception.id, message: `${label} expired on ${exception.expiresOn}.` });
        } else if (expires && expires.getTime() - today.getTime() <= 30 * 24 * 60 * 60 * 1000) {
            warnings.push({ code: 'EXCEPTION_NEAR_EXPIRY', id: exception.id, message: `${label} expires on ${exception.expiresOn}.` });
        }
        if (exception.severity && !Object.hasOwn(SEVERITY_RANK, String(exception.severity).toLowerCase())) {
            errors.push({ code: 'EXCEPTION_SEVERITY_INVALID', id: exception.id, message: `${label}.severity is not recognized.` });
        }
    }
    return { errors, warnings, exceptions };
}

function advisoryObjects(vulnerability) {
    const via = Array.isArray(vulnerability?.via) ? vulnerability.via.filter(isObject) : [];
    return via.length ? via : [vulnerability];
}

function highestSeverity(vulnerability) {
    const values = [vulnerability?.severity, ...advisoryObjects(vulnerability).map(item => item.severity)];
    return values
        .map(value => String(value || '').toLowerCase())
        .sort((a, b) => (SEVERITY_RANK[b] || -1) - (SEVERITY_RANK[a] || -1))[0] || 'unknown';
}

function exceptionMatches(exception, packageName, nodes, advisoryUrls) {
    if (!exception || exception.package !== packageName) return false;
    if (!advisoryUrls.includes(exception.advisoryUrl)) return false;
    const pathValue = normalizePath(exception.dependencyPath);
    return nodes.some(node => {
        const normalized = normalizePath(node);
        return pathValue === normalized || pathValue === packageName || pathValue.endsWith(`>${packageName}`) || pathValue.endsWith(`/${packageName}`);
    });
}

export function evaluateAudit(report, reachability, exceptionResult, options = {}) {
    const findings = [];
    const errors = [];
    const warnings = [];
    const vulnerabilities = isObject(report?.vulnerabilities) ? report.vulnerabilities : {};
    const exceptions = exceptionResult?.exceptions || [];
    const failSeverities = new Set(options.failSeverities || ['high', 'critical']);

    for (const packageName of Object.keys(vulnerabilities).sort()) {
        const vulnerability = vulnerabilities[packageName] || {};
        const severity = highestSeverity(vulnerability);
        const nodes = Array.isArray(vulnerability.nodes) && vulnerability.nodes.length
            ? vulnerability.nodes.map(normalizePath)
            : [`node_modules/${packageName}`];
        const productionNodes = nodes.filter(node => reachability.production.has(node));
        const developmentNodes = nodes.filter(node => reachability.development.has(node) && !reachability.production.has(node));
        const reachabilityLabel = productionNodes.length ? 'production' : developmentNodes.length ? 'development' : 'unresolved';
        const advisoryUrls = advisoryObjects(vulnerability).map(item => item.url).filter(url => typeof url === 'string');
        const matchedException = exceptions.find(exception => exceptionMatches(exception, packageName, nodes, advisoryUrls));
        const blocking = reachabilityLabel === 'production' && failSeverities.has(severity);
        const finding = {
            package: packageName,
            severity,
            reachability: reachabilityLabel,
            nodes,
            advisoryUrls,
            exception: matchedException?.id || null,
            title: advisoryObjects(vulnerability).map(item => item.title).filter(Boolean).join('; ') || null
        };
        findings.push(finding);
        if (blocking && !matchedException) {
            errors.push({
                code: 'REACHABLE_HIGH_ADVISORY',
                package: packageName,
                severity,
                nodes: productionNodes,
                advisoryUrls,
                message: `${severity} advisory is reachable from production dependency graph: ${packageName}.`
            });
        } else if (blocking && matchedException) {
            warnings.push({
                code: 'ADVISORY_EXCEPTION_APPLIED',
                package: packageName,
                exception: matchedException.id,
                message: `Applied reviewed exception ${matchedException.id} to ${packageName}.`
            });
        } else if (reachabilityLabel === 'development' && failSeverities.has(severity)) {
            warnings.push({
                code: 'DEVELOPMENT_ONLY_ADVISORY',
                package: packageName,
                severity,
                message: `${severity} advisory is limited to development dependency paths: ${packageName}.`
            });
        }
    }
    return { findings, errors, warnings };
}

function purlFor(name, version) {
    return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

export function createSbom(packageData, lockData, reachability) {
    const packages = lockData?.packages || {};
    const components = [];
    const dependencies = [];
    for (const nodePath of Object.keys(packages).filter(key => key.startsWith('node_modules/')).sort()) {
        const entry = packages[nodePath];
        if (!isObject(entry) || !entry.version) continue;
        const name = packageNameFromNodePath(nodePath);
        if (!name) continue;
        const bomRef = purlFor(name, entry.version);
        const scope = reachability.production.has(nodePath)
            ? 'required'
            : reachability.development.has(nodePath)
                ? 'optional'
                : 'excluded';
        const component = {
            type: 'library',
            name,
            version: String(entry.version),
            scope,
            'bom-ref': bomRef,
            purl: bomRef,
            properties: [{ name: 'gpace:lock-path', value: nodePath }]
        };
        if (entry.integrity) {
            const [algorithm, content] = String(entry.integrity).split('-', 2);
            if (algorithm && content) component.hashes = [{ alg: algorithm.toUpperCase(), content }];
        }
        components.push(component);
        const childNames = directDependencies(entry, ['dependencies', 'optionalDependencies', 'peerDependencies']);
        const dependsOn = Object.keys(childNames).sort().map(childName => {
            const childPath = resolveNodePackage(childName, nodePath, packages);
            const child = childPath ? packages[childPath] : null;
            return child?.version ? purlFor(childName, child.version) : null;
        }).filter(Boolean);
        dependencies.push({ ref: bomRef, dependsOn });
    }
    const rootRef = purlFor(packageData.name || 'application', packageData.version || '0.0.0');
    return {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        version: 1,
        metadata: {
            component: { type: 'application', name: packageData.name || 'application', version: packageData.version || '0.0.0', 'bom-ref': rootRef }
        },
        components,
        dependencies: [{ ref: rootRef, dependsOn: components.filter(component => component.scope === 'required').map(component => component['bom-ref']).sort() }, ...dependencies]
    };
}

function runNpmAudit(rootDir, offline = false) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = ['audit', '--json', '--omit=dev', '--package-lock-only'];
    if (offline) args.push('--offline');
    const result = spawnSync(npm, args, {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: 45_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
    });
    const raw = String(result.stdout || '').trim();
    if (raw) {
        try {
            return { available: true, report: JSON.parse(raw), source: offline ? 'npm audit offline' : 'npm audit', exitCode: result.status };
        } catch {
            // npm can print a human network error instead of JSON; do not treat
            // that as an empty audit.
        }
    }
    return {
        available: false,
        report: null,
        source: offline ? 'offline fixture unavailable' : 'npm audit unavailable',
        exitCode: result.status,
        error: result.error?.message || 'npm audit did not return JSON'
    };
}

async function writeJson(filePath, value) {
    if (!filePath) return;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${stableStringify(value)}\n`);
}

export async function checkDependencies(options = {}) {
    const rootDir = path.resolve(options.rootDir || process.cwd());
    const packageData = options.packageData || await readJson(path.join(rootDir, 'package.json'));
    const lockData = options.lockData || await readJson(path.join(rootDir, 'package-lock.json'));
    const exceptionConfig = options.exceptionConfig || await readJson(options.exceptionPath || path.join(rootDir, 'config', 'advisory-exceptions.json'));
    const errors = [];
    const warnings = [];

    errors.push(...compareLockedRoot(packageData, lockData));
    if (!/^\s*>=?\s*22(?:\.|$)/.test(String(packageData.engines?.node || ''))) {
        errors.push({ code: 'NODE_ENGINE_POLICY', message: 'package.json must declare a Node 22-compatible engine.' });
    }
    if (options.requireNode22 && process.versions.node.split('.')[0] !== '22') {
        errors.push({ code: 'NODE_RUNTIME_POLICY', message: `CI dependency gate requires Node 22, running ${process.version}.` });
    }

    const reachability = buildReachability(packageData, lockData);
    if (reachability.missing.length) {
        errors.push({ code: 'LOCK_GRAPH_INCOMPLETE', message: 'A declared dependency could not be resolved in the lock graph.', missing: reachability.missing });
    }

    const exceptionResult = validateAdvisoryExceptions(exceptionConfig, { now: options.now });
    errors.push(...exceptionResult.errors);
    warnings.push(...exceptionResult.warnings);

    let auditResult;
    if (options.auditReport) {
        auditResult = { available: true, report: options.auditReport, source: 'provided audit fixture', exitCode: 0 };
    } else if (options.auditJsonPath) {
        try {
            auditResult = { available: true, report: await readJson(path.resolve(rootDir, options.auditJsonPath)), source: 'audit JSON file', exitCode: 0 };
        } catch (error) {
            auditResult = { available: false, report: null, source: 'audit JSON file', exitCode: null, error: error.message };
        }
    } else if (options.offline) {
        auditResult = { available: false, report: null, source: 'offline mode', exitCode: 0 };
    } else {
        auditResult = runNpmAudit(rootDir, false);
    }

    let findings = [];
    if (auditResult.available && auditResult.report) {
        const evaluated = evaluateAudit(auditResult.report, reachability, exceptionResult, options);
        findings = evaluated.findings;
        errors.push(...evaluated.errors);
        warnings.push(...evaluated.warnings);
    } else {
        const warning = {
            code: options.offline ? 'AUDIT_UNAVAILABLE_OFFLINE' : 'AUDIT_UNAVAILABLE',
            message: options.offline
                ? 'Registry audit was intentionally not contacted; deterministic fixture coverage is required.'
                : 'npm audit did not return a usable JSON report.'
        };
        if (options.ci && !options.allowAuditUnavailable && !options.offline) errors.push(warning);
        else warnings.push(warning);
    }

    const legacyPackages = Array.isArray(exceptionConfig?.policy?.legacyPackages)
        ? exceptionConfig.policy.legacyPackages
        : DEFAULT_LEGACY_PACKAGES;
    for (const legacyPackage of legacyPackages) {
        if (packageData.dependencies?.[legacyPackage]) {
            warnings.push({
                code: 'LEGACY_SDK_PRESENT',
                package: legacyPackage,
                message: `Legacy SDK ${legacyPackage} remains declared; migration evidence must remove it before release.`
            });
        }
    }

    const sbom = createSbom(packageData, lockData, reachability);
    const report = {
        policyVersion: 1,
        ok: errors.length === 0,
        errors,
        warnings,
        audit: {
            available: auditResult.available,
            source: auditResult.source,
            exitCode: auditResult.exitCode,
            findings
        },
        lock: {
            lockfileVersion: lockData.lockfileVersion,
            productionPackages: reachability.production.size,
            developmentPackages: reachability.development.size
        },
        sbom: {
            format: sbom.bomFormat,
            components: sbom.components.length
        }
    };
    await writeJson(options.sbomPath && path.resolve(rootDir, options.sbomPath), sbom);
    await writeJson(options.reportPath && path.resolve(rootDir, options.reportPath), { ...report, sbom });
    return { ...report, sbom, packageData, lockData, exceptionConfig, reachability };
}

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--root') options.rootDir = argv[++index];
        else if (argument === '--audit-json') options.auditJsonPath = argv[++index];
        else if (argument === '--sbom') options.sbomPath = argv[++index];
        else if (argument === '--report') options.reportPath = argv[++index];
        else if (argument === '--offline') options.offline = true;
        else if (argument === '--ci') options.ci = true;
        else if (argument === '--allow-audit-unavailable') options.allowAuditUnavailable = true;
        else if (argument === '--node22') options.requireNode22 = true;
        else if (argument === '--json') options.json = true;
        else if (argument === '--help' || argument === '-h') options.help = true;
        else throw new DependencyPolicyError(`Unknown argument ${argument}`, { code: 'CLI_ARGUMENT' });
    }
    return options;
}

function printHelp() {
    console.log(`Usage: node scripts/check-dependencies.mjs [options]

Options:
  --root <dir>                    Repository root (default: cwd)
  --audit-json <file>             npm audit JSON or deterministic fixture
  --sbom <file>                   Write deterministic CycloneDX SBOM
  --report <file>                 Write dependency policy report
  --offline                       Do not contact the registry; emit a warning
  --ci                            Enforce CI audit availability and policy
  --allow-audit-unavailable       Record unavailable audit as a warning in CI
  --node22                        Require the current process to be Node 22
  --json                          Print the complete report as JSON
  --help                          Show this help`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) {
            printHelp();
        } else {
            const result = await checkDependencies(options);
            if (options.json) console.log(stableStringify(result));
            else {
                console.log(`[dependency-check] ${result.ok ? 'PASS' : 'FAIL'}`);
                console.log(`[dependency-check] lock production=${result.lock.productionPackages} development=${result.lock.developmentPackages}`);
                console.log(`[dependency-check] audit=${result.audit.available ? 'available' : 'unavailable'} source=${result.audit.source}`);
                for (const warning of result.warnings) console.warn(`[dependency-check] WARNING ${warning.code}: ${warning.message}`);
                for (const error of result.errors) console.error(`[dependency-check] ERROR ${error.code}: ${error.message}`);
            }
            if (!result.ok) process.exitCode = 1;
        }
    } catch (error) {
        console.error(`[dependency-check] ERROR ${error.code || 'UNHANDLED'}: ${error.message}`);
        process.exitCode = 1;
    }
}
