#!/usr/bin/env node
/**
 * Deterministic test runner for GPAce verification harness.
 * Executes tests/cases/NN.test.cjs or custom fixtures.
 * Enforces strict verification contract:
 * - Fails on missing files
 * - Fails on skipped / todo assertions
 * - Fails on unexpected external network
 * - Fails on zero assertions / empty tests
 */

const fs = require('node:fs');
const path = require('node:path');
// Clear any inherited test context so child runs are not considered recursive
delete process.env.NODE_TEST_CONTEXT;
const { run } = require('node:test');
const { spec } = require('node:test/reporters');
const { cleanupAllSync } = require('./helpers.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const CASES_DIR = path.resolve(ROOT_DIR, 'tests', 'cases');
const PRELOAD_SCRIPT = path.resolve(__dirname, 'preload.cjs');

async function runSingleCase(testFilePath) {
  if (!fs.existsSync(testFilePath)) {
    console.error(`[run-case] ERROR: Test file does not exist: ${testFilePath}`);
    return { success: false, reason: 'FILE_NOT_FOUND', exitCode: 1 };
  }

  console.log(`\n======================================================`);
  console.log(`[run-case] Running: ${path.relative(ROOT_DIR, testFilePath)}`);
  console.log(`======================================================\n`);

  let testCount = 0;
  let failCount = 0;
  let passCount = 0;
  let skipCount = 0;
  let todoCount = 0;
  let streamError = null;

  const testStream = run({
    files: [testFilePath],
    execArgv: ['--require', PRELOAD_SCRIPT]
  });

  // Track counts and errors from the test stream
  testStream.on('data', (event) => {
    if (event.type === 'test:pass') {
      if (event.data && event.data.skip) skipCount++;
      if (event.data && event.data.todo) todoCount++;
    } else if (event.type === 'test:fail') {
      failCount++;
    } else if (event.type === 'test:summary') {
      const counts = event.data && event.data.counts;
      if (counts) {
        testCount = counts.tests;
        failCount = counts.failed;
        passCount = counts.passed;
        skipCount += counts.skipped;
        todoCount += counts.todo;
      }
    }
  });

  testStream.on('error', (err) => {
    streamError = err;
  });

  // Format output with built-in spec reporter
  try {
    testStream.compose(new spec()).pipe(process.stdout);
  } catch (err) {
    console.error('[run-case] Reporter error:', err);
  }

  await new Promise((resolve) => {
    testStream.on('end', resolve);
    testStream.on('close', resolve);
  });

  // Check strict contract constraints
  let success = true;
  const reasons = [];

  if (streamError) {
    success = false;
    reasons.push(`Stream error: ${streamError.message}`);
  }

  if (failCount > 0) {
    success = false;
    reasons.push(`${failCount} test(s) failed`);
  }

  if (skipCount > 0) {
    success = false;
    reasons.push(`${skipCount} test(s) were skipped (skipped tests violate harness contract)`);
  }

  if (todoCount > 0) {
    success = false;
    reasons.push(`${todoCount} test(s) marked as todo (unimplemented assertions violate contract)`);
  }

  if (testCount === 0) {
    success = false;
    reasons.push(`Zero tests were executed (empty test cases violate harness contract)`);
  }

  if (!success) {
    console.error(`\n[run-case] FAILED: ${reasons.join('; ')}`);
    return { success: false, reason: reasons.join('; '), exitCode: 1 };
  }

  console.log(`\n[run-case] PASSED (${testCount} tests, 0 skipped, 0 failed)\n`);
  return { success: true, exitCode: 0, testCount };
}

function resolveCaseFile(arg) {
  // If argument is a full or relative path that exists
  const directPath = path.resolve(process.cwd(), arg);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  // If argument is a case number or ID like "46" or "1"
  let id = arg.replace(/^case-?/i, '');
  if (/^\d+$/.test(id)) {
    id = id.padStart(2, '0');
  }
  const casePath = path.resolve(CASES_DIR, `${id}.test.cjs`);
  return casePath;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node tests/harness/run-case.cjs <case-id|file-path|--all>');
    process.exit(1);
  }

  if (args[0] === '--all') {
    if (!fs.existsSync(CASES_DIR)) {
      console.error(`[run-case] Cases directory not found: ${CASES_DIR}`);
      process.exit(1);
    }
    const files = fs.readdirSync(CASES_DIR)
      .filter(f => /^\d+\.test\.cjs$/.test(f))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    if (files.length === 0) {
      console.error('[run-case] No test cases found in tests/cases/');
      process.exit(1);
    }

    console.log(`[run-case] Running all ${files.length} test cases...`);
    let overallSuccess = true;
    const failedCases = [];

    for (const file of files) {
      const casePath = path.resolve(CASES_DIR, file);
      const result = await runSingleCase(casePath);
      cleanupAllSync();
      if (!result.success) {
        overallSuccess = false;
        failedCases.push(file);
      }
    }

    console.log('\n======================================================');
    console.log(`[run-case] ALL CASES SUMMARY: ${files.length - failedCases.length}/${files.length} passed`);
    if (failedCases.length > 0) {
      console.error(`[run-case] Failed cases: ${failedCases.join(', ')}`);
      process.exit(1);
    }
    console.log('======================================================\n');
    process.exit(0);
  }

  // Single test case
  const targetPath = resolveCaseFile(args[0]);
  const result = await runSingleCase(targetPath);
  cleanupAllSync();
  process.exit(result.exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[run-case] Unhandled runner error:', err);
    cleanupAllSync();
    process.exit(1);
  });
}

module.exports = {
  runSingleCase,
  resolveCaseFile
};
