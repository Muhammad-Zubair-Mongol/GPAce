#!/usr/bin/env node

/**
 * Static module contract checker for the browser distribution.
 *
 * The checker intentionally models only edges that can be demonstrated from
 * source: ESM imports/exports, literal dynamic imports, CommonJS requires,
 * worker/module URL literals, and module scripts in HTML. Runtime globals and
 * runtime-resolved modules are represented by explicit, reviewable allowlists
 * in config/module-boundaries.json; they are never guessed from a missing
 * static edge.
 */

import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_CONFIG = path.join(DEFAULT_ROOT, 'config', 'module-boundaries.json');
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const nodeRequire = createRequire(import.meta.url);

function loadOptionalAstParser() {
  const candidates = [
    '@babel/parser',
    path.join(DEFAULT_ROOT, 'functions', 'node_modules', '@babel', 'parser')
  ];
  for (const candidate of candidates) {
    try {
      const resolved = nodeRequire.resolve(candidate);
      return nodeRequire(resolved);
    } catch {
      // The lexical parser below keeps the checker usable without a package install.
    }
  }
  return null;
}

const AST_PARSER = loadOptionalAstParser();

const ERROR_CODES = Object.freeze({
  CONFIG_INVALID: 'CONFIG_INVALID',
  ENTRYPOINT_MISSING: 'ENTRYPOINT_MISSING',
  NONEXISTENT_IMPORT: 'NONEXISTENT_IMPORT',
  OUTSIDE_ROOT_IMPORT: 'OUTSIDE_ROOT_IMPORT',
  ILLEGAL_BOUNDARY: 'ILLEGAL_BOUNDARY',
  MODULE_CYCLE: 'MODULE_CYCLE',
  UNALLOWLISTED_EXTERNAL: 'UNALLOWLISTED_EXTERNAL',
  UNRESOLVED_BARE_IMPORT: 'UNRESOLVED_BARE_IMPORT',
  MISSING_REQUIRED_EXPORT: 'MISSING_REQUIRED_EXPORT',
  RUNTIME_MODULE_MISSING: 'RUNTIME_MODULE_MISSING',
  RUNTIME_MODULE_CONFLICT: 'RUNTIME_MODULE_CONFLICT',
  RETIREMENT_UNPROVEN: 'RETIREMENT_UNPROVEN',
  RETIREMENT_REFERENCED: 'RETIREMENT_REFERENCED',
  RETIREMENT_REPLACEMENT_MISSING: 'RETIREMENT_REPLACEMENT_MISSING',
  RETIREMENT_EXPORT_MISSING: 'RETIREMENT_EXPORT_MISSING',
  GLOBAL_ALLOWLIST_MISMATCH: 'GLOBAL_ALLOWLIST_MISMATCH'
});

export class ModuleContractError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'ModuleContractError';
    this.code = code;
    this.details = details;
  }
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function toPosix(value) {
  return value.replaceAll('\\', '/');
}

function normalizeRelative(value) {
  const normalized = toPosix(path.posix.normalize(value || '.'));
  if (normalized === '.') return '';
  return normalized.replace(/^\.\//, '').replace(/^\//, '');
}

function stripQueryAndHash(value) {
  return value.split(/[?#]/, 1)[0];
}

function isExternalSpecifier(value) {
  return /^(?:https?:|data:|blob:|mailto:)/i.test(value);
}

function isLocalSpecifier(value) {
  return value.startsWith('.') || value.startsWith('/');
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern) {
  const source = toPosix(String(pattern));
  let expression = '^';
  for (let index = 0; index < source.length;) {
    if (source.startsWith('**', index)) {
      expression += '.*';
      index += 2;
      continue;
    }
    const character = source[index];
    if (character === '*') expression += '[^/]*';
    else if (character === '?') expression += '[^/]';
    else expression += escapeRegExp(character);
    index += 1;
  }
  return new RegExp(`${expression}$`);
}

function matchesPattern(value, pattern) {
  if (!pattern) return false;
  const candidate = normalizeRelative(value);
  const rawPattern = toPosix(String(pattern));
  if (rawPattern === candidate) return true;
  return globToRegExp(rawPattern).test(candidate);
}

function matchesAny(value, patterns) {
  return asArray(patterns).some((pattern) => matchesPattern(value, pattern));
}

function pathFromRoot(rootDir, relativePath) {
  const candidate = path.resolve(rootDir, ...normalizeRelative(relativePath).split('/'));
  const relative = path.relative(rootDir, candidate);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return candidate;
  }
  return null;
}

function projectPath(rootDir, absolutePath) {
  const relative = path.relative(rootDir, absolutePath);
  if (relative === '' || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    return null;
  }
  return normalizeRelative(relative);
}

async function pathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(absolutePath) {
  try {
    return JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  } catch (error) {
    throw new ModuleContractError(
      ERROR_CODES.CONFIG_INVALID,
      `Unable to read module boundary configuration: ${absolutePath}`,
      [{ path: absolutePath, message: error.message }]
    );
  }
}

async function readText(rootDir, relativePath) {
  const absolutePath = pathFromRoot(rootDir, relativePath);
  if (!absolutePath) return null;
  try {
    return await fs.readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

function decodeStringToken(raw) {
  if (!raw || raw.length < 2) return raw;
  const body = raw.slice(1, -1);
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (match, escaped) => {
    if (escaped.startsWith('u{')) return String.fromCodePoint(parseInt(escaped.slice(2, -1), 16));
    if (escaped.startsWith('u')) return String.fromCharCode(parseInt(escaped.slice(1), 16));
    if (escaped.startsWith('x')) return String.fromCharCode(parseInt(escaped.slice(1), 16));
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
    return simple[escaped] ?? escaped;
  });
}

function readStringToken(source, start) {
  const quote = source[start];
  let index = start + 1;
  let lineBreaks = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '\n') lineBreaks += 1;
    if (character === quote) {
      const raw = source.slice(start, index + 1);
      return { token: { type: 'string', value: decodeStringToken(raw), lineBreaks, index: start }, next: index + 1 };
    }
    index += 1;
  }
  return { token: { type: 'string', value: source.slice(start + 1), lineBreaks, index: start }, next: source.length };
}

function skipTemplate(source, start) {
  let index = start + 1;
  let lineBreaks = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      if (source[index + 1] === '\n') lineBreaks += 1;
      index += 2;
      continue;
    }
    if (character === '\n') lineBreaks += 1;
    if (character === '`') return { next: index + 1, lineBreaks };
    index += 1;
  }
  return { next: source.length, lineBreaks };
}

/**
 * Small lexical tokenizer used when a full JS parser is not installed. It
 * preserves line numbers and string values, and deliberately ignores comments
 * and template literal contents so prose cannot become a false import edge.
 */
export function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      if (character === '\n') line += 1;
      index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') line += 1;
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (character === '\'' || character === '"') {
      const result = readStringToken(source, index);
      tokens.push({ ...result.token, line });
      line += result.token.lineBreaks;
      index = result.next;
      continue;
    }
    if (character === '`') {
      const result = skipTemplate(source, index);
      line += result.lineBreaks;
      index = result.next;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      tokens.push({ type: 'identifier', value: source.slice(start, index), line, index: start });
      continue;
    }
    if (/[0-9]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_.]/.test(source[index])) index += 1;
      tokens.push({ type: 'number', value: source.slice(start, index), line, index: start });
      continue;
    }
    const twoCharacter = source.slice(index, index + 2);
    const threeCharacter = source.slice(index, index + 3);
    if (['=>', '?.', '??', '&&', '||', '==', '!=', '<=', '>=', '++', '--', '**'].includes(twoCharacter)) {
      tokens.push({ type: 'punct', value: twoCharacter, line, index });
      index += 2;
      continue;
    }
    if (['===', '!==', '>>>', '...'].includes(threeCharacter)) {
      tokens.push({ type: 'punct', value: threeCharacter, line, index });
      index += 3;
      continue;
    }
    tokens.push({ type: 'punct', value: character, line, index });
    index += 1;
  }
  return tokens;
}

function astStringValue(node) {
  return node && (node.type === 'StringLiteral' || node.type === 'Literal' || node.type === 'DirectiveLiteral')
    ? node.value
    : null;
}

function astLine(node) {
  return node?.loc?.start?.line || 1;
}

function astParse(source) {
  if (!AST_PARSER) return null;
  try {
    return AST_PARSER.parse(source, {
      sourceType: 'unambiguous',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: [
        'jsx',
        'dynamicImport',
        'importMeta',
        'topLevelAwait',
        'classProperties',
        'classPrivateProperties',
        'optionalChaining',
        'nullishCoalescingOperator'
      ]
    });
  } catch {
    return null;
  }
}

function parseAstImports(source, file) {
  const ast = astParse(source);
  if (!ast) return null;
  const imports = [];
  const seen = new Set();
  const push = (specifier, kind, node) => {
    if (typeof specifier !== 'string' || specifier.length === 0) return;
    const key = `${kind}\0${specifier}\0${astLine(node)}`;
    if (seen.has(key)) return;
    seen.add(key);
    imports.push({ specifier, kind, line: astLine(node), file });
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.type === 'ImportDeclaration') push(astStringValue(node.source), 'import', node.source);
    else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      if (node.source) push(astStringValue(node.source), 'export-from', node.source);
    } else if (node.type === 'CallExpression') {
      if (node.callee?.type === 'Import') push(astStringValue(node.arguments?.[0]), 'dynamic-import', node.callee);
      if (node.callee?.type === 'Identifier' && node.callee.name === 'require') {
        push(astStringValue(node.arguments?.[0]), 'require', node.callee);
      }
    } else if (node.type === 'ImportExpression') {
      push(astStringValue(node.source), 'dynamic-import', node);
    } else if (node.type === 'NewExpression') {
      const name = node.callee?.type === 'Identifier' ? node.callee.name : '';
      if (['URL', 'Worker', 'SharedWorker'].includes(name)) {
        push(astStringValue(node.arguments?.[0]), 'runtime-url', node.callee);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'tokens' || key === 'errors') continue;
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast.program);
  return imports;
}

function collectPatternNames(pattern, names) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') names.add(pattern.name);
  else if (pattern.type === 'ObjectPattern') for (const property of pattern.properties || []) collectPatternNames(property.value || property.argument, names);
  else if (pattern.type === 'ArrayPattern') for (const element of pattern.elements || []) collectPatternNames(element, names);
  else if (pattern.type === 'RestElement') collectPatternNames(pattern.argument, names);
  else if (pattern.type === 'AssignmentPattern') collectPatternNames(pattern.left, names);
}

function parseAstExports(source) {
  const ast = astParse(source);
  if (!ast) return null;
  const names = new Set();
  for (const statement of ast.program.body || []) {
    if (statement.type === 'ExportDefaultDeclaration') {
      names.add('default');
      continue;
    }
    if (statement.type !== 'ExportNamedDeclaration') continue;
    for (const specifier of statement.specifiers || []) {
      if (specifier.exported?.name) names.add(specifier.exported.name);
      else if (specifier.exported?.value) names.add(specifier.exported.value);
    }
    const declaration = statement.declaration;
    if (!declaration) continue;
    if (declaration.id?.name) names.add(declaration.id.name);
    if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations || []) collectPatternNames(declarator.id, names);
    }
  }
  return [...names].sort();
}

function findNextString(tokens, start, terminators = new Set([';'])) {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'string') return { token, index };
    if (terminators.has(token.value)) return null;
  }
  return null;
}

function findMatching(tokens, start, open, close) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    else if (tokens[index].value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return tokens.length - 1;
}

/**
 * Extract source edges from the token stream. This is intentionally limited
 * to literal paths: resolving runtime-computed strings would invent evidence.
 */
export function parseStaticImports(source, file = '<anonymous>') {
  const astImports = parseAstImports(source, file);
  if (astImports) return astImports;
  const tokens = tokenizeJavaScript(source);
  const imports = [];
  const seen = new Set();
  const push = (specifier, kind, token) => {
    if (typeof specifier !== 'string' || specifier.length === 0) return;
    const key = `${kind}\0${specifier}\0${token.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    imports.push({ specifier, kind, line: token.line, file });
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'identifier') continue;

    if (token.value === 'import') {
      const next = tokens[index + 1];
      if (next?.value === '.') continue;
      if (next?.value === '(') {
        const argument = tokens[index + 2];
        if (argument?.type === 'string') push(argument.value, 'dynamic-import', argument);
        continue;
      }
      const found = findNextString(tokens, index + 1);
      if (found) push(found.token.value, 'import', found.token);
      continue;
    }

    if (token.value === 'export') {
      const found = findNextString(tokens, index + 1);
      const hasFrom = tokens.slice(index + 1, found?.index ?? tokens.length).some((candidate) => candidate.value === 'from');
      if (hasFrom && found) push(found.token.value, 'export-from', found.token);
      continue;
    }

    if (token.value === 'require' && tokens[index + 1]?.value === '(') {
      const argument = tokens[index + 2];
      if (argument?.type === 'string') push(argument.value, 'require', argument);
      continue;
    }

    if (token.value === 'new' && ['URL', 'Worker', 'SharedWorker'].includes(tokens[index + 1]?.value)) {
      const argument = tokens[index + 2]?.value === '(' ? tokens[index + 3] : tokens[index + 2];
      if (argument?.type === 'string') push(argument.value, 'runtime-url', argument);
    }
  }
  return imports;
}

export function parseExports(source) {
  const astExports = parseAstExports(source);
  if (astExports) return astExports;
  const tokens = tokenizeJavaScript(source);
  const names = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== 'export') continue;
    const next = tokens[index + 1];
    if (!next) continue;
    if (next.value === 'default') {
      names.add('default');
      continue;
    }
    if (next.value === '{') {
      const end = findMatching(tokens, index + 1, '{', '}');
      for (let cursor = index + 2; cursor < end; cursor += 1) {
        if (tokens[cursor].type === 'identifier' && tokens[cursor - 1]?.value !== 'as') {
          names.add(tokens[cursor + 2]?.value === 'as' ? tokens[cursor + 3]?.value : tokens[cursor].value);
        }
      }
      continue;
    }
    if (['function', 'class', 'const', 'let', 'var', 'async'].includes(next.value)) {
      let cursor = index + 2;
      if (next.value === 'async' && tokens[cursor]?.value === 'function') cursor += 1;
      if (tokens[cursor]?.type === 'identifier') names.add(tokens[cursor].value);
    }
  }
  return [...names].sort();
}

function attributeMap(attributeSource) {
  const attributes = {};
  const expression = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = expression.exec(attributeSource))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function parseImportMap(body, sourceName) {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed.imports === 'object' ? parsed.imports : {};
  } catch (error) {
    return { __error: `${sourceName}: invalid import map JSON (${error.message})` };
  }
}

export function parseHtmlModules(source, file = '<anonymous>') {
  const scripts = [];
  const importMaps = {};
  const expression = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  let inlineIndex = 0;
  while ((match = expression.exec(source))) {
    const attributes = attributeMap(match[1]);
    const body = match[2] ?? '';
    const type = (attributes.type || '').toLowerCase();
    if (type === 'importmap') {
      Object.assign(importMaps, parseImportMap(body, file));
      continue;
    }
    if (type === 'module' || type === 'text/javascript+module') {
      if (attributes.src) {
        scripts.push({ specifier: attributes.src, kind: 'html-module-script', line: source.slice(0, match.index).split('\n').length });
      } else if (body.trim()) {
        inlineIndex += 1;
        scripts.push({
          specifier: `${file}#inline-module-${inlineIndex}`,
          kind: 'html-inline-module',
          line: source.slice(0, match.index).split('\n').length,
          inlineSource: body
        });
      }
    }
  }
  const preloadExpression = /<link\b([^>]*\brel\s*=\s*["']modulepreload["'][^>]*)>/gi;
  while ((match = preloadExpression.exec(source))) {
    const attributes = attributeMap(match[1]);
    if (attributes.href) scripts.push({ specifier: attributes.href, kind: 'html-modulepreload', line: source.slice(0, match.index).split('\n').length });
  }
  return { scripts, importMaps };
}

function normalizeRulePatterns(rule, keys) {
  for (const key of keys) {
    if (rule?.[key] !== undefined) return asArray(rule[key]);
  }
  return [];
}

function normalizedModuleRecord(relativePath, metadata = {}) {
  return {
    id: normalizeRelative(relativePath),
    kind: metadata.kind || 'module',
    origin: metadata.origin || null,
    importMap: metadata.importMap || {},
    source: metadata.source || null,
    exports: [],
    imports: []
  };
}

function configPatterns(config, key) {
  return asArray(config?.[key]).filter((value) => typeof value === 'string');
}

function allowlistedExternal(specifier, config) {
  const allowlist = [
    ...configPatterns(config, 'externalAllowlist'),
    ...asArray(config?.externalDependencies).map((item) => typeof item === 'string' ? item : item?.url).filter(Boolean)
  ];
  return allowlist.some((pattern) => {
    if (pattern.includes('*')) return matchesPattern(specifier, pattern);
    return specifier === pattern;
  });
}

function resolveImportMap(specifier, importMap) {
  if (!importMap || typeof importMap !== 'object') return null;
  if (typeof importMap[specifier] === 'string') return importMap[specifier];
  const prefixes = Object.keys(importMap)
    .filter((key) => key.endsWith('/') && specifier.startsWith(key))
    .sort((a, b) => b.length - a.length);
  if (prefixes.length === 0) return null;
  const prefix = prefixes[0];
  return importMap[prefix] + specifier.slice(prefix.length);
}

function virtualDependency(specifier, config) {
  const values = [
    ...asArray(config?.virtualModules),
    ...asArray(config?.virtualDependencies)
  ];
  return values.find((item) => {
    if (typeof item === 'string') return item === specifier;
    return item?.specifier === specifier || item?.path === specifier || item?.request === specifier;
  }) || null;
}

async function resolveLocalImport(rootDir, fromId, specifier) {
  const cleanSpecifier = stripQueryAndHash(specifier);
  const base = fromId.includes('#inline-module-') ? fromId.split('#', 1)[0] : fromId;
  const baseDirectory = path.posix.dirname(base);
  const requested = cleanSpecifier.startsWith('/')
    ? normalizeRelative(cleanSpecifier)
    : normalizeRelative(path.posix.join(baseDirectory, cleanSpecifier));
  const absoluteRequested = pathFromRoot(rootDir, requested);
  if (!absoluteRequested) return { type: 'outside', requested };

  const candidates = [requested];
  const extension = path.posix.extname(requested);
  if (!extension) {
    candidates.push(...[...SOURCE_EXTENSIONS].map((suffix) => `${requested}${suffix}`));
    candidates.push(...[...SOURCE_EXTENSIONS].map((suffix) => `${requested}/index${suffix}`));
  }
  for (const candidate of candidates) {
    const absolute = pathFromRoot(rootDir, candidate);
    if (absolute && await pathExists(absolute)) return { type: 'local', id: normalizeRelative(candidate), absolute };
  }
  return { type: 'missing', requested };
}

function entrypointValues(config) {
  const configured = [
    ...asArray(config?.entrypoints),
    ...asArray(config?.scope?.entrypoints)
  ];
  return configured.map((entry) => {
    if (typeof entry === 'string') return { file: normalizeRelative(entry), includeInlineModules: true };
    return {
      ...entry,
      file: normalizeRelative(entry?.file || entry?.html || entry?.path || ''),
      includeInlineModules: entry?.includeInlineModules !== false
    };
  }).filter((entry) => entry.file);
}

function runtimeModuleValues(config) {
  return [
    ...asArray(config?.runtimeResolvedModules),
    ...asArray(config?.scope?.runtimeResolvedModules),
    ...asArray(config?.retainedRuntimeModules)
  ].map((item) => typeof item === 'string' ? { file: normalizeRelative(item), retain: true } : {
    ...item,
    file: normalizeRelative(item?.file || item?.path || '')
  }).filter((item) => item.file);
}

function retirementValues(config) {
  return [
    ...asArray(config?.retirements),
    ...asArray(config?.retirementCandidates)
  ].map((item) => ({
    ...item,
    file: normalizeRelative(item?.file || item?.path || item?.candidate || '')
  })).filter((item) => item.file);
}

function requiredExportValues(config) {
  return asArray(config?.requiredExports).map((item) => {
    if (typeof item === 'string') return { file: normalizeRelative(item), exports: [] };
    return {
      ...item,
      file: normalizeRelative(item?.file || item?.path || ''),
      exports: asArray(item?.exports || item?.names)
    };
  }).filter((item) => item.file);
}

function moduleSeedValues(config) {
  return [
    ...asArray(config?.modules),
    ...asArray(config?.checkFiles),
    ...asArray(config?.scope?.modules)
  ].map((item) => typeof item === 'string' ? { file: normalizeRelative(item), kind: 'configured-module' } : {
    ...item,
    file: normalizeRelative(item?.file || item?.path || ''),
    kind: item?.kind || 'configured-module'
  }).filter((item) => item.file);
}

function dynamicGlobalValues(config) {
  return [
    ...asArray(config?.dynamicGlobals),
    ...asArray(config?.runtimeGlobals),
    ...asArray(config?.scope?.dynamicGlobals)
  ].map((item) => typeof item === 'string' ? { name: item } : item).filter((item) => item?.name);
}

function globalObserved(source, name) {
  const escaped = escapeRegExp(name);
  return new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped.replace(/\\\./g, '\\s*\\.\\s*')}(?:$|[^A-Za-z0-9_$])`).test(source);
}

function makeIssue(code, message, details = {}) {
  return { code, message, ...details };
}

async function collectConfiguredRoots(rootDir, config) {
  const values = [];
  const add = (file, kind, metadata = {}) => {
    const relative = normalizeRelative(file);
    if (relative) values.push({ file: relative, kind, ...metadata });
  };
  for (const entry of entrypointValues(config)) add(entry.file, 'html-entrypoint', { entry });
  for (const item of runtimeModuleValues(config)) add(item.file, 'runtime-resolved', { runtime: item });
  for (const item of moduleSeedValues(config)) add(item.file, item.kind);
  for (const item of requiredExportValues(config)) add(item.file, 'required-export');

  for (const root of configPatterns(config, 'sourceRoots')) {
    const absoluteRoot = pathFromRoot(rootDir, root);
    if (!absoluteRoot || !(await pathExists(absoluteRoot))) continue;
    const stat = await fs.stat(absoluteRoot);
    if (stat.isFile()) {
      add(projectPath(rootDir, absoluteRoot), 'source-root');
      continue;
    }
    async function visit(directory) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (['node_modules', '.git', '.ua'].includes(entry.name)) continue;
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(child);
        else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) || HTML_EXTENSIONS.has(path.extname(entry.name))) {
          add(projectPath(rootDir, child), 'source-root');
        }
      }
    }
    await visit(absoluteRoot);
  }
  return values;
}

function deduplicateSeeds(seeds) {
  const map = new Map();
  for (const seed of seeds) {
    if (!map.has(seed.file)) map.set(seed.file, seed);
    else if (seed.kind === 'runtime-resolved') map.get(seed.file).kind = seed.kind;
  }
  return [...map.values()].sort((a, b) => a.file.localeCompare(b.file));
}

function localSpecifierFromId(id) {
  return id.split('#', 1)[0];
}

async function scanContracts(rootDir, config) {
  const errors = [];
  const warnings = [];
  const nodes = new Map();
  const edges = [];
  const external = [];
  const virtual = [];
  const unresolved = [];
  const htmlImportMaps = new Map();
  const seeds = deduplicateSeeds(await collectConfiguredRoots(rootDir, config));
  const queue = [...seeds];
  const queued = new Set(queue.map((item) => item.file));

  const addNode = (id, metadata = {}) => {
    const normalized = normalizeRelative(id);
    if (!normalized) return null;
    if (!nodes.has(normalized)) nodes.set(normalized, normalizedModuleRecord(normalized, metadata));
    const node = nodes.get(normalized);
    if (metadata.kind === 'runtime-resolved') node.kind = 'runtime-resolved';
    if (metadata.importMap) node.importMap = { ...node.importMap, ...metadata.importMap };
    return node;
  };

  const addQueue = (id, metadata = {}) => {
    const normalized = normalizeRelative(id);
    if (!normalized || queued.has(normalized)) return;
    queued.add(normalized);
    queue.push({ file: normalized, ...metadata });
  };

  const resolveAndRecord = async (fromNode, importRecord, importMap = {}) => {
    const originalSpecifier = importRecord.specifier;
    let specifier = originalSpecifier;
    const mapped = resolveImportMap(specifier, importMap);
    if (mapped) specifier = mapped;

    // HTML script/src URLs are document-relative even when they omit './'.
    // Bare ESM specifiers remain bare and must resolve through an import map or
    // the explicit virtual-module allowlist.
    const htmlUrl = importRecord.kind === 'html-module-script' || importRecord.kind === 'html-modulepreload';
    if (htmlUrl && !isExternalSpecifier(specifier) && !isLocalSpecifier(specifier)) {
      specifier = `./${specifier}`;
    }

    if (isExternalSpecifier(specifier)) {
      const allowed = allowlistedExternal(specifier, config);
      const target = { from: fromNode.id, specifier: originalSpecifier, resolved: specifier, kind: importRecord.kind, line: importRecord.line, allowed };
      external.push(target);
      if (config.enforceExternalAllowlist && !allowed) {
        errors.push(makeIssue(ERROR_CODES.UNALLOWLISTED_EXTERNAL, `${fromNode.id}:${importRecord.line} uses an unallowlisted external module: ${specifier}`, target));
      }
      return;
    }

    const virtualMatch = virtualDependency(specifier, config) || virtualDependency(originalSpecifier, config);
    if (!isLocalSpecifier(specifier) && virtualMatch) {
      virtual.push({ from: fromNode.id, specifier: originalSpecifier, resolved: specifier, kind: importRecord.kind, reason: typeof virtualMatch === 'string' ? '' : virtualMatch.reason || '' });
      return;
    }

    if (!isLocalSpecifier(specifier)) {
      const target = { from: fromNode.id, specifier: originalSpecifier, resolved: specifier, kind: importRecord.kind, line: importRecord.line };
      unresolved.push(target);
      errors.push(makeIssue(ERROR_CODES.UNRESOLVED_BARE_IMPORT, `${fromNode.id}:${importRecord.line} has no import-map or virtual resolution for bare specifier ${originalSpecifier}`, target));
      return;
    }

    const resolved = await resolveLocalImport(rootDir, fromNode.origin || fromNode.id, specifier);
    if (resolved.type === 'outside') {
      const target = { from: fromNode.id, specifier: originalSpecifier, requested: resolved.requested, kind: importRecord.kind, line: importRecord.line };
      unresolved.push(target);
      errors.push(makeIssue(ERROR_CODES.OUTSIDE_ROOT_IMPORT, `${fromNode.id}:${importRecord.line} escapes the project root via ${originalSpecifier}`, target));
      return;
    }
    if (resolved.type !== 'local') {
      const target = { from: fromNode.id, specifier: originalSpecifier, requested: resolved.requested, kind: importRecord.kind, line: importRecord.line };
      unresolved.push(target);
      errors.push(makeIssue(ERROR_CODES.NONEXISTENT_IMPORT, `${fromNode.id}:${importRecord.line} imports a missing local module: ${originalSpecifier}`, target));
      return;
    }
    const targetNode = addNode(resolved.id, { origin: resolved.id, kind: 'module', importMap });
    const edge = { from: fromNode.id, to: targetNode.id, specifier: originalSpecifier, resolved: targetNode.id, kind: importRecord.kind, line: importRecord.line };
    edges.push(edge);
    fromNode.imports.push(edge);
    addQueue(targetNode.id, { kind: 'module', importMap });
  };

  while (queue.length > 0) {
    const seed = queue.shift();
    const normalized = normalizeRelative(seed.file);
    const absolute = pathFromRoot(rootDir, normalized);
    if (!absolute) {
      errors.push(makeIssue(ERROR_CODES.OUTSIDE_ROOT_IMPORT, `Configured module is outside the project root: ${normalized}`, { file: normalized }));
      continue;
    }
    const content = seed.inlineSource ?? await readText(rootDir, normalized);
    if (content === null) {
      const code = seed.kind === 'html-entrypoint' ? ERROR_CODES.ENTRYPOINT_MISSING : ERROR_CODES.RUNTIME_MODULE_MISSING;
      errors.push(makeIssue(code, `Configured ${seed.kind} does not exist: ${normalized}`, { file: normalized }));
      continue;
    }
    const node = addNode(normalized, { kind: seed.kind, origin: seed.origin || normalized, source: content, importMap: seed.importMap });
    node.source = content;
    node.exports = parseExports(content);

    if (HTML_EXTENSIONS.has(path.extname(localSpecifierFromId(normalized)).toLowerCase())) {
      const parsed = parseHtmlModules(content, normalized);
      htmlImportMaps.set(normalized, parsed.importMaps);
      if (parsed.importMaps.__error) warnings.push(parsed.importMaps.__error);
      const entry = entrypointValues(config).find((item) => item.file === normalized);
      const includeInline = entry?.includeInlineModules !== false;
      for (const script of parsed.scripts) {
        if (script.kind === 'html-inline-module' && !includeInline) continue;
        if (script.inlineSource !== undefined) {
          const inlineId = `${normalized}#inline-module-${script.specifier.split('#inline-module-')[1]}`;
          const inlineNode = addNode(inlineId, { kind: 'inline-module', origin: normalized, source: script.inlineSource, importMap: parsed.importMaps });
          const inlineEdge = { from: node.id, to: inlineNode.id, specifier: script.specifier, resolved: inlineNode.id, kind: script.kind, line: script.line };
          edges.push(inlineEdge);
          node.imports.push(inlineEdge);
          inlineNode.source = script.inlineSource;
          inlineNode.exports = parseExports(script.inlineSource);
          inlineNode.imports = [];
          inlineNode._queued = true;
          for (const importRecord of parseStaticImports(script.inlineSource, inlineNode.id)) await resolveAndRecord(inlineNode, importRecord, parsed.importMaps);
        } else {
          await resolveAndRecord(node, { ...script, file: normalized }, parsed.importMaps);
        }
      }
      continue;
    }

    for (const importRecord of parseStaticImports(content, normalized)) {
      await resolveAndRecord(node, importRecord, node.importMap || {});
    }
  }

  return { nodes, edges, external, virtual, unresolved, errors, warnings, seeds, htmlImportMaps };
}

function graphCycles(nodes, edges) {
  const adjacency = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const edge of edges) {
    if (adjacency.has(edge.from) && adjacency.has(edge.to)) adjacency.get(edge.from).push(edge.to);
  }
  let index = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  const visit = (node) => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of adjacency.get(node) || []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(target)));
      }
    }
    if (lowLinks.get(node) === indices.get(node)) {
      const component = [];
      let target;
      do {
        target = stack.pop();
        onStack.delete(target);
        component.push(target);
      } while (target !== node);
      if (component.length > 1 || (component.length === 1 && adjacency.get(component[0]).includes(component[0]))) {
        components.push(component.sort());
      }
    }
  };
  for (const node of [...nodes.keys()].sort()) if (!indices.has(node)) visit(node);
  return components.sort((a, b) => a[0].localeCompare(b[0]));
}

function boundaryIssues(config, edges) {
  const issues = [];
  const rules = asArray(config?.boundaries);
  for (const edge of edges) {
    if (!edge.to || edge.to.startsWith('http') || edge.to.includes('#inline-module-')) continue;
    for (const rule of rules) {
      const sourcePatterns = normalizeRulePatterns(rule, ['from', 'sources', 'source', 'owners']);
      if (sourcePatterns.length > 0 && !matchesAny(edge.from, sourcePatterns)) continue;
      const destination = edge.to;
      const denyPatterns = normalizeRulePatterns(rule, ['deny', 'denied', 'forbid', 'forbidden']);
      const allowPatterns = normalizeRulePatterns(rule, ['allow', 'allowed', 'mayImport']);
      const denied = matchesAny(destination, denyPatterns);
      const disallowed = allowPatterns.length > 0 && !matchesAny(destination, allowPatterns);
      if (denied || disallowed) {
        issues.push(makeIssue(ERROR_CODES.ILLEGAL_BOUNDARY, `${edge.from} may not import ${destination} under boundary ${rule.name || 'unnamed'}`, {
          boundary: rule.name || null,
          from: edge.from,
          to: destination,
          specifier: edge.specifier,
          reason: denied ? 'deny-list' : 'outside-allow-list'
        }));
      }
    }
  }
  return issues;
}

function incomingEdges(edges, target) {
  return edges.filter((edge) => edge.to === target);
}

function retirementReport(config, scan) {
  const retirements = [];
  const errors = [];
  const runtimeIds = new Set(runtimeModuleValues(config).map((item) => item.file));
  for (const candidate of retirementValues(config)) {
    const staticIncoming = incomingEdges(scan.edges, candidate.file);
    const replacement = normalizeRelative(candidate.replacement || candidate.replacementModule || '');
    const replacementNode = replacement ? scan.nodes.get(replacement) : null;
    const evidence = candidate.staticEvidence || {};
    const runtimeEvidence = candidate.runtimeEvidence || {};
    const smokeAssertions = asArray(candidate.smokeAssertions);
    const staticReady = staticIncoming.length === 0
      && evidence.incomingStaticEdges === 0
      && evidence.noDirectHtmlMount === true;
    const runtimeReady = runtimeEvidence.candidateLoaded === false
      && Boolean(runtimeEvidence.browserEntrypoint)
      && Boolean(runtimeEvidence.canonicalModule);
    const smokeReady = smokeAssertions.length > 0 && smokeAssertions.every((item) => item?.verified === true);
    const replacementReady = Boolean(replacementNode) && asArray(candidate.replacementExports).every((name) => replacementNode.exports.includes(name));
    const referencedAsRuntime = runtimeIds.has(candidate.file);
    const ready = staticReady && runtimeReady && smokeReady && replacementReady && !referencedAsRuntime;
    const item = {
      file: candidate.file,
      decision: candidate.decision || 'retain-until-proven',
      replacement: replacement || null,
      staticIncomingEdges: staticIncoming,
      staticEvidence: { ...evidence, observedIncomingEdges: staticIncoming.length },
      runtimeEvidence,
      smokeAssertions,
      ready,
      retainedPath: candidate.keepPath !== false
    };
    retirements.push(item);
    if (referencedAsRuntime) {
      errors.push(makeIssue(ERROR_CODES.RUNTIME_MODULE_CONFLICT, `${candidate.file} is both retired and explicitly runtime-resolved`, { file: candidate.file }));
    }
    if (staticIncoming.length > 0) {
      errors.push(makeIssue(ERROR_CODES.RETIREMENT_REFERENCED, `${candidate.file} still has static incoming references`, { file: candidate.file, incoming: staticIncoming }));
    }
    if (replacement && !replacementNode) {
      errors.push(makeIssue(ERROR_CODES.RETIREMENT_REPLACEMENT_MISSING, `Retirement replacement does not resolve: ${replacement}`, { file: candidate.file, replacement }));
    }
    if (replacement && replacementNode) {
      const missing = asArray(candidate.replacementExports).filter((name) => !replacementNode.exports.includes(name));
      if (missing.length > 0) errors.push(makeIssue(ERROR_CODES.RETIREMENT_EXPORT_MISSING, `${replacement} does not export the required replacement surface`, { file: candidate.file, replacement, missing }));
    }
    if (candidate.decision === 'retired' || candidate.decision === 'retired-compatibility-stub') {
      if (!ready) errors.push(makeIssue(ERROR_CODES.RETIREMENT_UNPROVEN, `Retirement of ${candidate.file} is not supported by complete static, runtime, and smoke evidence`, { file: candidate.file, staticReady, runtimeReady, smokeReady, replacementReady }));
    }
  }
  return { retirements, errors };
}

function requiredExportIssues(config, scan) {
  const errors = [];
  for (const requirement of requiredExportValues(config)) {
    const node = scan.nodes.get(requirement.file);
    if (!node) {
      errors.push(makeIssue(ERROR_CODES.RUNTIME_MODULE_MISSING, `Required module does not resolve: ${requirement.file}`, { file: requirement.file }));
      continue;
    }
    const missing = requirement.exports.filter((name) => !node.exports.includes(name));
    if (missing.length > 0) errors.push(makeIssue(ERROR_CODES.MISSING_REQUIRED_EXPORT, `${requirement.file} is missing required exports`, { file: requirement.file, missing, exports: node.exports }));
  }
  return errors;
}

function dynamicGlobalIssues(config, scan) {
  const errors = [];
  const observations = [];
  for (const item of dynamicGlobalValues(config)) {
    const owner = normalizeRelative(item.owner || item.file || '');
    const node = owner ? scan.nodes.get(owner) : null;
    const observed = node ? globalObserved(node.source || '', item.name) : false;
    observations.push({ name: item.name, owner: owner || null, observed, reason: item.reason || null });
    if (item.required === true && !observed) {
      errors.push(makeIssue(ERROR_CODES.GLOBAL_ALLOWLIST_MISMATCH, `Allowlisted runtime global is not observed in its owner: ${item.name}`, { ...item, observed: false }));
    }
  }
  return { observations, errors };
}

/**
 * Check the configured module graph. The function returns a report instead of
 * throwing so callers can inspect every violation at once.
 */
export async function checkModuleContracts(options = {}) {
  const rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
  const configPath = path.resolve(rootDir, options.configPath || 'config/module-boundaries.json');
  const config = await readJson(configPath);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new ModuleContractError(ERROR_CODES.CONFIG_INVALID, 'Module boundary configuration must be a JSON object');
  }
  const scan = await scanContracts(rootDir, config);
  const cycles = graphCycles(scan.nodes, scan.edges);
  const boundaryErrors = boundaryIssues(config, scan.edges);
  const retirement = retirementReport(config, scan);
  const exportErrors = requiredExportIssues(config, scan);
  const globalResult = dynamicGlobalIssues(config, scan);
  const report = {
    ok: false,
    rootDir,
    configPath,
    configVersion: config.version ?? null,
    errors: [],
    warnings: scan.warnings,
    files: [...scan.nodes.keys()].sort(),
    edges: scan.edges.slice().sort((a, b) => `${a.from}\0${a.to}`.localeCompare(`${b.from}\0${b.to}`)),
    external: scan.external,
    virtual: scan.virtual,
    unresolved: scan.unresolved,
    cycles,
    boundaryViolations: boundaryErrors,
    retainedRuntimeModules: runtimeModuleValues(config).map((item) => item.file),
    runtimeGlobals: globalResult.observations,
    retirements: retirement.retirements,
    exports: Object.fromEntries([...scan.nodes.entries()].map(([id, node]) => [id, node.exports]))
  };
  report.errors = [
    ...scan.errors,
    ...boundaryErrors,
    ...cycles.map((cycle) => makeIssue(ERROR_CODES.MODULE_CYCLE, `Module cycle detected: ${cycle.join(' -> ')}`, { cycle })),
    ...retirement.errors,
    ...exportErrors,
    ...globalResult.errors
  ];
  report.ok = report.errors.length === 0;
  return report;
}

export async function assertModuleContracts(options = {}) {
  const report = await checkModuleContracts(options);
  if (!report.ok) {
    const first = report.errors[0];
    throw new ModuleContractError(first?.code || 'MODULE_CONTRACT_FAILED', first?.message || 'Module contract check failed', report.errors);
  }
  return report;
}

function printTextReport(report) {
  const lines = [
    `module-contracts: ${report.ok ? 'PASS' : 'FAIL'}`,
    `files: ${report.files.length}`,
    `edges: ${report.edges.length}`,
    `retained runtime modules: ${report.retainedRuntimeModules.length}`,
    `cycles: ${report.cycles.length}`,
    `unresolved: ${report.unresolved.length}`
  ];
  for (const issue of report.errors) lines.push(`${issue.code}: ${issue.message}`);
  for (const retirement of report.retirements) lines.push(`retirement ${retirement.file}: ${retirement.ready ? 'proven' : 'unproven'}`);
  return lines.join('\n');
}

function cliOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.rootDir = argv[++index];
    else if (argument === '--config') options.configPath = argv[++index];
    else if (argument === '--json') options.json = true;
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const report = await checkModuleContracts(cliOptions(process.argv.slice(2)));
    console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : printTextReport(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error(`${error.code || 'MODULE_CONTRACT_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}

export { ERROR_CODES };
