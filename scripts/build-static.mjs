#!/usr/bin/env node

/**
 * Build GPAce's browser distribution from an explicit, reviewable asset graph.
 *
 * The builder deliberately does not bundle or execute application code. HTML,
 * CSS, and native ES modules are copied byte-for-byte, while their literal
 * local references are followed and checked. The manifest is the boundary
 * between browser assets and repository material that must never be hosted.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_MANIFEST = path.join(PROJECT_ROOT, 'config', 'assets-manifest.json');
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'dist');

const FORBIDDEN_SEGMENTS = new Set([
  '.agent',
  '.codex',
  '.firebase',
  '.gemini',
  '.git',
  '.ua',
  '.vscode',
  'archive',
  'archives',
  'audit',
  'config',
  'coverage',
  'data',
  'functions',
  'node_modules',
  'private',
  'server',
  'temp',
  'tests',
  'uploads'
]);

const FORBIDDEN_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.test',
  '.env.production',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock'
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.7z',
  '.bak',
  '.db',
  '.key',
  '.log',
  '.pem',
  '.rar',
  '.secret',
  '.sql',
  '.tgz',
  '.zip'
]);

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs', '.cjs', '.svg']);
const PAGE_LIKE_EXTENSIONS = new Set(['.htm', '.html']);
const MODULE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

export class StaticBuildError extends Error {
  constructor(code, message, details = []) {
    super(`[${code}] ${message}`);
    this.name = 'StaticBuildError';
    this.code = code;
    this.details = Array.isArray(details) ? details : [details];
  }
}

function posixPath(value) {
  return String(value).replaceAll('\\', '/');
}

function stripQueryAndHash(value) {
  return value.split(/[?#]/, 1)[0];
}

function isProtocolRelative(value) {
  return value.startsWith('//');
}

function isExternalReference(value) {
  return /^(?:https?:|wss?:)/i.test(value) || isProtocolRelative(value);
}

function canonicalExternalUrl(value) {
  const raw = String(value).trim();
  const candidate = isProtocolRelative(raw) ? `https:${raw}` : raw;
  try {
    const url = new URL(candidate);
    return url.href;
  } catch {
    return null;
  }
}

function normalizeRelative(value, label, { allowLeadingSlash = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StaticBuildError('INVALID_PATH', `${label} must be a non-empty string.`);
  }

  const raw = posixPath(value.trim());
  if (raw.includes('\0')) {
    throw new StaticBuildError('INVALID_PATH', `${label} contains a null byte: ${value}`);
  }
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('\\')) {
    throw new StaticBuildError('INVALID_PATH', `${label} must be relative: ${value}`);
  }
  if (raw.startsWith('/')) {
    if (!allowLeadingSlash) {
      throw new StaticBuildError('INVALID_PATH', `${label} must not start with '/': ${value}`);
    }
  }

  const withoutLeadingSlash = raw.replace(/^\/+/, '');
  const normalized = path.posix.normalize(withoutLeadingSlash);
  if (!normalized || normalized === '.') {
    throw new StaticBuildError('INVALID_PATH', `${label} resolves to the root directory: ${value}`);
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new StaticBuildError('PATH_TRAVERSAL', `${label} escapes the distribution root: ${value}`);
  }
  return normalized;
}

function normalizeReferencePath(value, baseOutputPath, label) {
  const raw = stripQueryAndHash(String(value).trim());
  if (!raw || raw === '.') return '';

  const normalizedRaw = posixPath(raw);
  const joined = normalizedRaw.startsWith('/')
    ? normalizedRaw.slice(1)
    : path.posix.join(path.posix.dirname(baseOutputPath), normalizedRaw);
  return normalizeRelative(joined, label);
}

function assertSafeRepositoryPath(relativePath, label) {
  const normalized = normalizeRelative(relativePath, label);
  const segments = normalized.split('/');
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const lowerBase = segments.at(-1).toLowerCase();
  const extension = path.posix.extname(lowerBase);

  if (lowerSegments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new StaticBuildError(
      'FORBIDDEN_PATH',
      `${label} is outside the browser distribution boundary: ${normalized}`
    );
  }
  if (FORBIDDEN_FILE_NAMES.has(lowerBase) || lowerBase.startsWith('.env.')) {
    throw new StaticBuildError(
      'FORBIDDEN_FILE',
      `${label} names a private or dependency-lock file: ${normalized}`
    );
  }
  if (FORBIDDEN_EXTENSIONS.has(extension) || lowerBase === 'build-static.mjs') {
    throw new StaticBuildError(
      'FORBIDDEN_FILE',
      `${label} names an archive, credential, log, or build file: ${normalized}`
    );
  }
  return normalized;
}

function resolveWithin(rootDir, relativePath, label) {
  const root = path.resolve(rootDir);
  const absolute = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new StaticBuildError('PATH_TRAVERSAL', `${label} escapes the repository root.`);
  }
  return absolute;
}

function asList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new StaticBuildError('INVALID_MANIFEST', `${label} must be an array.`);
  }
  return value;
}

function normalizeEntry(entry, label) {
  if (typeof entry === 'string') {
    return {
      source: normalizeRelative(entry, `${label}.source`),
      output: normalizeRelative(entry, `${label}.output`)
    };
  }
  if (!entry || typeof entry !== 'object') {
    throw new StaticBuildError('INVALID_MANIFEST', `${label} must be a path or object.`);
  }
  const source = normalizeRelative(entry.source, `${label}.source`);
  const output = normalizeRelative(entry.output || source, `${label}.output`);
  return { source, output };
}

function normalizeExternalDependencies(rawDependencies) {
  const list = asList(rawDependencies, 'externalDependencies');
  const dependencies = [];
  const keys = new Set();

  for (const [index, dependency] of list.entries()) {
    const label = `externalDependencies[${index}]`;
    const item = typeof dependency === 'string' ? { url: dependency } : dependency;
    if (!item || typeof item !== 'object' || typeof item.url !== 'string') {
      throw new StaticBuildError('INVALID_MANIFEST', `${label} must contain a URL.`);
    }
    const url = canonicalExternalUrl(item.url);
    if (!url || !/^https?:$/i.test(new URL(url).protocol)) {
      throw new StaticBuildError('INVALID_MANIFEST', `${label}.url must be an HTTP(S) URL.`);
    }
    const kind = item.kind || 'external';
    const key = `${url}\u0000${kind}`;
    if (keys.has(key)) {
      throw new StaticBuildError('DUPLICATE_EXTERNAL', `${label} duplicates ${item.url}.`);
    }
    keys.add(key);
    dependencies.push({
      url,
      kind,
      license: typeof item.license === 'string' ? item.license : '',
      source: typeof item.source === 'string' ? item.source : '',
      pinned: item.pinned !== false
    });
  }
  return dependencies;
}

function normalizeVirtualDependencies(rawDependencies) {
  const list = asList(rawDependencies, 'virtualDependencies');
  const virtual = new Map();
  for (const [index, dependency] of list.entries()) {
    const item = typeof dependency === 'string' ? { path: dependency } : dependency;
    if (!item || typeof item !== 'object') {
      throw new StaticBuildError('INVALID_MANIFEST', `virtualDependencies[${index}] is invalid.`);
    }
    const virtualPath = normalizeRelative(
      item.path,
      `virtualDependencies[${index}].path`,
      { allowLeadingSlash: true }
    );
    virtual.set(virtualPath, {
      path: virtualPath,
      reason: typeof item.reason === 'string' ? item.reason : 'Documented runtime endpoint.'
    });
  }
  return virtual;
}

function normalizeManifest(rawManifest) {
  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) {
    throw new StaticBuildError('INVALID_MANIFEST', 'The assets manifest must be a JSON object.');
  }
  if (rawManifest.version !== 1) {
    throw new StaticBuildError('INVALID_MANIFEST', 'Only assets manifest version 1 is supported.');
  }

  const rawPages = rawManifest.pages ?? rawManifest.entryPages;
  const pageEntries = asList(rawPages, 'pages').map((entry, index) =>
    normalizeEntry(entry, `pages[${index}]`)
  );
  if (pageEntries.length === 0) {
    throw new StaticBuildError('INVALID_MANIFEST', 'The manifest must declare at least one page.');
  }

  const outputPages = new Set();
  const sourcePages = new Set();
  for (const page of pageEntries) {
    if (outputPages.has(page.output)) {
      throw new StaticBuildError('DUPLICATE_PAGE', `Page output is declared more than once: ${page.output}`);
    }
    if (sourcePages.has(page.source)) {
      throw new StaticBuildError('DUPLICATE_PAGE', `Page source is declared more than once: ${page.source}`);
    }
    outputPages.add(page.output);
    sourcePages.add(page.source);
  }

  if (rawManifest.expectedPageCount !== undefined && rawManifest.expectedPageCount !== pageEntries.length) {
    throw new StaticBuildError(
      'PAGE_COUNT_MISMATCH',
      `Manifest expected ${rawManifest.expectedPageCount} pages but declares ${pageEntries.length}.`
    );
  }

  const assetFiles = asList(rawManifest.assetFiles ?? rawManifest.assets, 'assetFiles').map((entry, index) =>
    normalizeEntry(entry, `assetFiles[${index}]`)
  );
  const assetRoots = asList(rawManifest.assetRoots, 'assetRoots').map((entry, index) =>
    assertSafeRepositoryPath(entry, `assetRoots[${index}]`)
  );
  const requiredFiles = asList(rawManifest.requiredFiles, 'requiredFiles').map((entry, index) =>
    assertSafeRepositoryPath(entry, `requiredFiles[${index}]`)
  );

  const aliases = new Map();
  const rawAliases = rawManifest.aliases || {};
  if (!rawAliases || typeof rawAliases !== 'object' || Array.isArray(rawAliases)) {
    throw new StaticBuildError('INVALID_MANIFEST', 'aliases must be an object.');
  }
  for (const [output, value] of Object.entries(rawAliases)) {
    const outputPath = normalizeRelative(output, `aliases.${output}`, { allowLeadingSlash: true });
    const source = typeof value === 'string' ? value : value?.source;
    aliases.set(outputPath, {
      output: outputPath,
      source: assertSafeRepositoryPath(source, `aliases.${output}`)
    });
  }

  const externalDependencies = normalizeExternalDependencies(
    rawManifest.externalDependencies ?? rawManifest.external ?? []
  );
  const externalByUrl = new Map();
  for (const dependency of externalDependencies) {
    externalByUrl.set(dependency.url, dependency);
  }

  const virtualDependencies = normalizeVirtualDependencies(
    rawManifest.virtualDependencies ?? rawManifest.virtual ?? []
  );
  const virtualRoutes = new Set(
    asList(rawManifest.virtualRoutes, 'virtualRoutes').map((route, index) =>
      normalizeRelative(route, `virtualRoutes[${index}]`, { allowLeadingSlash: true })
    )
  );

  const requirePinnedExternalAssets = rawManifest.requirePinnedExternalAssets !== false;
  if (requirePinnedExternalAssets) {
    for (const dependency of externalDependencies) {
      if (['cdn', 'asset', 'font'].includes(dependency.kind) && !dependency.pinned) {
        throw new StaticBuildError(
          'UNPINNED_EXTERNAL',
          `External ${dependency.kind} dependency is not pinned: ${dependency.url}`
        );
      }
      if (['cdn', 'asset', 'font'].includes(dependency.kind) && !dependency.license) {
        throw new StaticBuildError(
          'MISSING_EXTERNAL_LICENSE',
          `External ${dependency.kind} dependency has no license record: ${dependency.url}`
        );
      }
    }
  }

  return {
    pageEntries,
    assetFiles,
    assetRoots,
    requiredFiles,
    aliases,
    externalDependencies,
    externalByUrl,
    virtualDependencies,
    virtualRoutes,
    requirePinnedExternalAssets
  };
}

async function readManifest({ rootDir, manifestPath, manifest }) {
  if (manifest !== undefined) {
    return { rawManifest: manifest, manifestPath: null };
  }
  const selectedPath = manifestPath || path.join(rootDir, 'config', 'assets-manifest.json');
  const absolutePath = path.resolve(selectedPath);
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  } catch (error) {
    throw new StaticBuildError(
      'MANIFEST_READ_FAILED',
      `Could not read ${absolutePath}: ${error.message}`
    );
  }
  return { rawManifest: raw, manifestPath: absolutePath };
}

async function lstatFile(rootDir, relativePath, label) {
  const absolutePath = resolveWithin(rootDir, relativePath, label);
  let stats;
  try {
    stats = await fs.lstat(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new StaticBuildError('MISSING_SOURCE', `${label} does not exist: ${relativePath}`);
    }
    throw new StaticBuildError('SOURCE_READ_FAILED', `${label} could not be read: ${error.message}`);
  }
  if (stats.isSymbolicLink()) {
    throw new StaticBuildError('SYMLINK_SOURCE', `${label} may not be a symbolic link: ${relativePath}`);
  }
  return { absolutePath, stats };
}

async function walkFiles(rootDir, relativeRoot) {
  const { absolutePath, stats } = await lstatFile(rootDir, relativeRoot, 'assetRoot');
  if (!stats.isDirectory()) {
    return [relativeRoot];
  }

  const files = [];
  async function visit(absoluteDirectory, relativeDirectory) {
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = posixPath(path.posix.join(relativeDirectory, entry.name));
      assertSafeRepositoryPath(relativePath, 'assetRoot entry');
      const absoluteEntry = path.join(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new StaticBuildError('SYMLINK_SOURCE', `Asset roots may not contain symbolic links: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absoluteEntry, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  await visit(absolutePath, relativeRoot);
  return files;
}

function getAttributeMap(attributeSource) {
  const attributes = new Map();
  const attributePattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attributePattern.exec(attributeSource))) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function getAttribute(attributes, name) {
  return attributes.get(name) ?? '';
}

function splitSrcSet(value) {
  return String(value)
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
}

function extractInlineScripts(source) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    scripts.push({ attributes: getAttributeMap(match[1]), body: match[2] });
  }
  return scripts;
}

function extractStyleBlocks(source) {
  const styles = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let match;
  while ((match = pattern.exec(source))) styles.push(match[1]);
  return styles;
}

function extractImportMaps(source, pagePath) {
  const importMaps = [];
  for (const inlineScript of extractInlineScripts(source)) {
    if (getAttribute(inlineScript.attributes, 'type').toLowerCase() !== 'importmap') continue;
    try {
      const parsed = JSON.parse(inlineScript.body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          !parsed.imports || typeof parsed.imports !== 'object' || Array.isArray(parsed.imports)) {
        throw new Error('the imports object is missing');
      }
      importMaps.push(parsed);
    } catch (error) {
      throw new StaticBuildError(
        'INVALID_IMPORT_MAP',
        `Invalid import map in ${pagePath}: ${error.message}`
      );
    }
  }
  return importMaps;
}

function mergeImportMaps(importMaps) {
  const imports = {};
  for (const importMap of importMaps) {
    for (const [specifier, target] of Object.entries(importMap.imports)) {
      if (typeof target !== 'string' || !target.trim()) {
        throw new StaticBuildError('INVALID_IMPORT_MAP', `Import map target for ${specifier} must be a string.`);
      }
      imports[specifier] = target;
    }
  }
  return { imports };
}

function resolveImportMapSpecifier(specifier, importMap) {
  if (!importMap || !importMap.imports) return specifier;
  if (Object.hasOwn(importMap.imports, specifier)) return importMap.imports[specifier];

  let bestPrefix = '';
  for (const prefix of Object.keys(importMap.imports)) {
    if (prefix.endsWith('/') && specifier.startsWith(prefix) && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
    }
  }
  if (!bestPrefix) return specifier;
  return `${importMap.imports[bestPrefix]}${specifier.slice(bestPrefix.length)}`;
}

function extractTags(source) {
  const tags = [];
  const pattern = /<([a-z][\w:-]*)\b([^>]*?)>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    tags.push({ name: match[1].toLowerCase(), attributes: getAttributeMap(match[2]) });
  }
  return tags;
}

function isIgnoredReference(value) {
  const raw = String(value).trim();
  return !raw || raw.startsWith('#') || /^(?:data|blob|about|javascript|mailto):/i.test(raw);
}

function isPageAnchor(tagName, value) {
  if (!['a', 'area'].includes(tagName)) return false;
  const target = stripQueryAndHash(value);
  if (!target || target === '/') return false;
  return PAGE_LIKE_EXTENSIONS.has(path.posix.extname(posixPath(target)).toLowerCase()) || target.startsWith('/');
}

function hasToken(attributes, name, token) {
  return getAttribute(attributes, name).toLowerCase().split(/\s+/).includes(token);
}

function moduleSpecifiers(source) {
  const references = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^;\n]*?\sfrom\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*["']([^"']+)["']/g,
    /\bimportScripts\s*\(\s*["']([^"']+)["']/g,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
    /\bserviceWorker\.register\s*\(\s*["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) references.push(match[1]);
  }
  return references;
}

function cssReferences(source) {
  const references = [];
  const patterns = [
    /@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) references.push(match[1].trim());
  }
  return references;
}

export async function buildStatic(options = {}) {
  const rootDir = path.resolve(options.rootDir || PROJECT_ROOT);
  const checkOnly = options.check === true;
  const outputDir = path.resolve(options.outDir || path.join(rootDir, 'dist'));
  const { rawManifest, manifestPath } = await readManifest({
    rootDir,
    manifestPath: options.manifestPath || (options.manifest ? null : path.join(rootDir, 'config', 'assets-manifest.json')),
    manifest: options.manifest
  });
  const manifest = normalizeManifest(rawManifest);

  // Keep the same path spelling used by callers. On Windows, realpath can
  // expand an 8.3 temp path while outDir still uses its short spelling;
  // comparing those two spellings would reject a valid child directory.
  const rootAbsolute = path.resolve(rootDir);
  const outputRelativeToRoot = path.relative(rootAbsolute, outputDir);
  if (outputRelativeToRoot === '' || outputRelativeToRoot === '..' || outputRelativeToRoot.startsWith(`..${path.sep}`)) {
    throw new StaticBuildError('INVALID_OUTPUT', 'The distribution output must be a child of the repository root.');
  }
  if (outputRelativeToRoot.split(path.sep).some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()))) {
    throw new StaticBuildError('INVALID_OUTPUT', `The distribution output is in a forbidden directory: ${outputDir}`);
  }

  const copyEntries = new Map();
  const queue = [];
  const pageSourceByOutput = new Map(manifest.pageEntries.map((page) => [page.output, page.source]));
  const references = [];
  const externalReferences = new Set();
  const virtualReferences = new Set();
  const moduleEntriesByPage = new Map();
  const aliasHits = new Map();

  async function addCopy(sourcePath, outputPath, reason) {
    const source = assertSafeRepositoryPath(sourcePath, 'source path');
    const output = assertSafeRepositoryPath(outputPath, 'output path');
    await lstatFile(rootDir, source, reason || 'source');

    const existing = copyEntries.get(output);
    if (existing) {
      if (existing.source !== source) {
        throw new StaticBuildError(
          'OUTPUT_COLLISION',
          `Two sources would occupy ${output}: ${existing.source} and ${source}`
        );
      }
      return false;
    }
    const entry = { source, output, reason: reason || 'manifest' };
    copyEntries.set(output, entry);
    queue.push(entry);
    return true;
  }

  function checkExternal(rawReference, fromPath) {
    const canonical = canonicalExternalUrl(rawReference);
    if (!canonical) {
      throw new StaticBuildError('INVALID_EXTERNAL', `Invalid external reference in ${fromPath}: ${rawReference}`);
    }
    const dependency = manifest.externalByUrl.get(canonical);
    if (!dependency) {
      throw new StaticBuildError(
        'UNAPPROVED_EXTERNAL',
        `External reference is not allowlisted in ${fromPath}: ${rawReference}`
      );
    }
    externalReferences.add(canonical);
    return { kind: 'external', target: canonical, dependency };
  }

  function resolveVirtual(urlPath) {
    return manifest.virtualDependencies.get(urlPath) || null;
  }

  async function recordReference(rawReference, fromEntry, kind, { moduleEntry = false, importMap = null } = {}) {
    const raw = String(rawReference).trim();
    if (isIgnoredReference(raw)) return;

    if (isExternalReference(raw)) {
      const external = checkExternal(raw, fromEntry.output);
      references.push({ from: fromEntry.output, raw, kind, resolution: external.kind, target: external.target });
      return;
    }

    const target = normalizeReferencePath(raw, fromEntry.output, `${fromEntry.output} reference`);
    if (!target) return;

    const virtual = resolveVirtual(target);
    if (virtual) {
      virtualReferences.add(target);
      references.push({ from: fromEntry.output, raw, kind, resolution: 'virtual', target });
      return;
    }

    if (moduleEntry) {
      let entries = moduleEntriesByPage.get(fromEntry.output);
      if (!entries) {
        entries = new Set();
        moduleEntriesByPage.set(fromEntry.output, entries);
      }
      if (entries.has(target)) {
        throw new StaticBuildError(
          'DUPLICATE_MODULE_ENTRY',
          `The page ${fromEntry.output} loads the native module more than once: ${target}`
        );
      }
      entries.add(target);
    }

    const alias = manifest.aliases.get(target);
    const source = alias?.source || pageSourceByOutput.get(target) || target;
    if (alias) {
      aliasHits.set(target, alias.source);
    }

    try {
      await addCopy(source, target, `${fromEntry.output} -> ${raw}`);
    } catch (error) {
      if (error instanceof StaticBuildError && error.code === 'MISSING_SOURCE') {
        throw new StaticBuildError(
          'UNRESOLVED_REFERENCE',
          `Local ${kind} reference from ${fromEntry.output} does not resolve: ${raw}`,
          [target, source]
        );
      }
      throw error;
    }
    const copiedEntry = copyEntries.get(target);
    if (importMap && copiedEntry && !copiedEntry.importMap) copiedEntry.importMap = importMap;
    references.push({ from: fromEntry.output, raw, kind, resolution: 'local', target, source });
  }

  async function scanCss(source, entry) {
    for (const reference of cssReferences(source)) {
      await recordReference(reference, entry, 'css');
    }
  }

  async function scanJavaScript(source, entry, importMap = entry.importMap || null) {
    // Vendored distributables are copied as a complete asset root. Regex
    // scanning minified bundles mistakes string fragments for module imports.
    if (entry.output.startsWith('assets/vendor/')) return;
    for (const reference of moduleSpecifiers(source)) {
      const mappedReference = resolveImportMapSpecifier(reference, importMap);
      await recordReference(mappedReference, entry, 'module');
    }
  }

  async function scanHtml(source, entry) {
    const importMap = mergeImportMaps(extractImportMaps(source, entry.output));
    for (const target of Object.values(importMap.imports)) {
      await recordReference(target, entry, 'importmap');
    }

    for (const tag of extractTags(source)) {
      const { name, attributes } = tag;
      const src = getAttribute(attributes, 'src');
      const href = getAttribute(attributes, 'href');
      const poster = getAttribute(attributes, 'poster');
      const srcSet = getAttribute(attributes, 'srcset');
      const isModule = name === 'script' && getAttribute(attributes, 'type').toLowerCase() === 'module';

      if (name === 'script' && src) {
        await recordReference(src, entry, 'script', { moduleEntry: isModule, importMap });
      }
      if (name === 'link' && href) await recordReference(href, entry, 'link');
      if (['img', 'audio', 'video', 'source', 'track', 'iframe', 'object', 'embed', 'input'].includes(name)) {
        if (src) await recordReference(src, entry, 'media');
        if (poster) await recordReference(poster, entry, 'media');
        for (const candidate of splitSrcSet(srcSet)) await recordReference(candidate, entry, 'media');
      }
      if (['a', 'area'].includes(name) && href && isExternalReference(href)) {
        const external = checkExternal(href, entry.output);
        references.push({ from: entry.output, raw: href, kind: 'link', resolution: external.kind, target: external.target });
      } else if (isPageAnchor(name, href)) {
        const route = normalizeReferencePath(href, entry.output, `${entry.output} link`);
        if (route && !pageSourceByOutput.has(route) && !resolveVirtual(route) && !manifest.virtualRoutes.has(route)) {
          await recordReference(href, entry, 'link');
        }
      }

      const inlineStyle = getAttribute(attributes, 'style');
      if (inlineStyle) await scanCss(inlineStyle, entry);
    }

    for (const inlineScript of extractInlineScripts(source)) {
      if (!getAttribute(inlineScript.attributes, 'src') &&
          getAttribute(inlineScript.attributes, 'type').toLowerCase() !== 'importmap') {
        await scanJavaScript(inlineScript.body, entry, importMap);
      }
    }
    for (const styleBlock of extractStyleBlocks(source)) await scanCss(styleBlock, entry);
  }

  for (const page of manifest.pageEntries) {
    await addCopy(page.source, page.output, 'manifest page');
  }
  for (const asset of manifest.assetFiles) {
    await addCopy(asset.source, asset.output, 'manifest asset');
  }
  for (const requiredFile of manifest.requiredFiles) {
    await addCopy(requiredFile, requiredFile, 'required browser token asset');
  }
  for (const assetRoot of manifest.assetRoots) {
    const files = await walkFiles(rootDir, assetRoot);
    for (const file of files) await addCopy(file, file, `asset root ${assetRoot}`);
  }

  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const entry = queue[queueIndex++];
    const { absolutePath } = await lstatFile(rootDir, entry.source, 'asset');
    const extension = path.posix.extname(entry.output).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const source = await fs.readFile(absolutePath, 'utf8');
    if (extension === '.html') await scanHtml(source, entry);
    else if (extension === '.css') await scanCss(source, entry);
    else if (MODULE_EXTENSIONS.has(extension)) await scanJavaScript(source, entry);
  }

  for (const reference of references) {
    if (reference.resolution === 'local' && !copyEntries.has(reference.target)) {
      throw new StaticBuildError(
        'UNRESOLVED_REFERENCE',
        `Reference did not produce an output file: ${reference.from} -> ${reference.raw}`
      );
    }
  }

  const outputEntries = [...copyEntries.values()].sort((a, b) => a.output.localeCompare(b.output));
  const outputFiles = outputEntries.map((entry) => entry.output);
  const report = {
    version: 1,
    manifest: manifestPath ? posixPath(path.relative(rootDir, manifestPath)) : null,
    output: posixPath(path.relative(rootDir, outputDir)),
    pages: manifest.pageEntries.map((page) => page.output).sort(),
    files: outputFiles,
    references: references.slice().sort((a, b) => `${a.from}:${a.raw}`.localeCompare(`${b.from}:${b.raw}`)),
    external: [...externalReferences].sort(),
    virtual: [...virtualReferences].sort(),
    aliases: Object.fromEntries([...aliasHits.entries()].sort(([a], [b]) => a.localeCompare(b))),
    counts: {
      pages: manifest.pageEntries.length,
      files: outputFiles.length,
      localReferences: references.filter((reference) => reference.resolution === 'local').length,
      externalReferences: externalReferences.size,
      virtualReferences: virtualReferences.size
    },
    checkOnly
  };

  if (checkOnly) return report;

  const outputParent = path.dirname(outputDir);
  await fs.mkdir(outputParent, { recursive: true });
  const temporaryOutput = await fs.mkdtemp(path.join(outputParent, `.${path.basename(outputDir)}.tmp-`));
  try {
    for (const entry of outputEntries) {
      const destination = path.join(temporaryOutput, ...entry.output.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const source = await fs.readFile(path.join(rootDir, ...entry.source.split('/')));
      await fs.writeFile(destination, source);
    }
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rename(temporaryOutput, outputDir);
  } catch (error) {
    await fs.rm(temporaryOutput, { recursive: true, force: true }).catch(() => {});
    if (error instanceof StaticBuildError) throw error;
    throw new StaticBuildError('OUTPUT_WRITE_FAILED', `Could not write ${outputDir}: ${error.message}`);
  }

  return report;
}

function parseCliArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') options.check = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--root') options.rootDir = args[++index];
    else if (argument === '--manifest') options.manifestPath = args[++index];
    else if (argument === '--out-dir') options.outDir = args[++index];
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new StaticBuildError('CLI_USAGE', `Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/build-static.mjs [options]

Options:
  --root <directory>     Repository root (default: project root)
  --manifest <file>     Assets manifest (default: config/assets-manifest.json)
  --out-dir <directory> Distribution directory (default: dist)
  --check                Validate the graph without writing files
  --json                 Print the deterministic build report as JSON
  --help                 Show this help
`);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const report = await buildStatic(options);
      console.log(`[build-static] PASSED: ${report.counts.pages} pages, ${report.counts.files} files`);
      if (options.json) console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    if (error instanceof StaticBuildError) {
      console.error(`[build-static] FAILED ${error.message}`);
      for (const detail of error.details) console.error(`[build-static] detail: ${detail}`);
    } else {
      console.error(`[build-static] FAILED: ${error.stack || error.message}`);
    }
    process.exitCode = 1;
  }
}
