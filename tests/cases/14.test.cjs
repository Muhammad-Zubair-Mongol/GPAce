/**
 * Step 14: Refresh root runtime and vulnerable dependency lock.
 * Verifies that:
 * - Runtime engine constraints are pinned in .nvmrc and package.json (node >= 22.0.0)
 * - Resolved dependencies in package.json and package-lock.json meet secure floor versions:
 *     - express >= 4.22.3
 *     - multer >= 2.4.0
 *     - @google/genai present and loadable
 *     - @google/generative-ai retained as compatibility alias
 *     - socket.io >= 4.8.4
 *     - compression >= 1.8.2
 * - Dependency tree has zero production vulnerabilities (npm audit clean)
 * - Module imports and runtime compatibility fixtures pass for Express, Multer, and Google GenAI SDKs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const http = require('node:http');

const {
  createTempDir,
  createTestServer
} = require('../harness/helpers.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

describe('Step 14: Root Runtime & Secure Dependency Lock Verification', () => {

  describe('Runtime Engine Constraints', () => {
    it('pins Node 22 baseline in .nvmrc', () => {
      const nvmrcPath = path.join(ROOT_DIR, '.nvmrc');
      assert.ok(fs.existsSync(nvmrcPath), '.nvmrc file must exist');
      const content = fs.readFileSync(nvmrcPath, 'utf8').trim();
      assert.match(content, /^v?22(\.|$)/, '.nvmrc must pin Node 22 baseline');
    });

    it('declares engines: { node: ">=22.0.0" } in package.json', () => {
      const pkgPath = path.join(ROOT_DIR, 'package.json');
      assert.ok(fs.existsSync(pkgPath), 'package.json must exist');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      assert.ok(pkg.engines, 'package.json must have engines field');
      assert.ok(pkg.engines.node, 'engines.node must be specified');
      assert.strictEqual(pkg.engines.node, '>=22.0.0', 'engines.node must be ">=22.0.0"');
    });

    it('current node process satisfies the engine constraint', () => {
      const nodeVersion = process.version; // e.g. "v24.18.0"
      const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
      assert.ok(major >= 22, `Current Node major version (${major}) must be >= 22`);
    });
  });

  describe('Manifest & Lockfile Integrity', () => {
    it('manifest includes modern patched dependencies and compatibility aliases', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
      const deps = pkg.dependencies || {};

      assert.ok(deps['@google/genai'], '@google/genai must be present in dependencies');
      assert.ok(deps['@google/generative-ai'], '@google/generative-ai must be retained as compatibility alias');
      assert.ok(deps['multer'], 'multer must be present in dependencies');
      assert.ok(deps['express'], 'express must be present in dependencies');
      assert.ok(deps['socket.io'], 'socket.io must be present in dependencies');
      assert.ok(deps['compression'], 'compression must be present in dependencies');
    });

    it('package-lock.json resolves dependencies to patched, non-vulnerable versions', () => {
      const lockPath = path.join(ROOT_DIR, 'package-lock.json');
      assert.ok(fs.existsSync(lockPath), 'package-lock.json must exist');
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

      // Helper to find installed version in package-lock (packages object in lockfile v2/v3)
      function getResolvedVersion(pkgName) {
        if (lock.packages) {
          const direct = lock.packages[`node_modules/${pkgName}`];
          if (direct && direct.version) return direct.version;
        }
        if (lock.dependencies && lock.dependencies[pkgName]) {
          return lock.dependencies[pkgName].version;
        }
        return null;
      }

      // Check multer >= 2.4.0
      const multerVer = getResolvedVersion('multer');
      assert.ok(multerVer, 'multer must be resolved in package-lock.json');
      const multerMajor = parseInt(multerVer.split('.')[0], 10);
      const multerMinor = parseInt(multerVer.split('.')[1], 10);
      assert.ok(
        multerMajor > 2 || (multerMajor === 2 && multerMinor >= 4),
        `Resolved multer version (${multerVer}) must be at least 2.4.0`
      );

      // Check express >= 4.22.3 (or 5.x)
      const expressVer = getResolvedVersion('express');
      assert.ok(expressVer, 'express must be resolved in package-lock.json');
      const [expMajor, expMinor, expPatch] = expressVer.split('.').map(n => parseInt(n, 10));
      const isExpressPatched = (expMajor > 4) || (expMajor === 4 && (expMinor > 22 || (expMinor === 22 && expPatch >= 3)));
      assert.ok(
        isExpressPatched,
        `Resolved express version (${expressVer}) must be >= 4.22.3 to ensure path-to-regexp / body-parser / qs fixes`
      );

      // Check @google/genai resolved
      const genaiVer = getResolvedVersion('@google/genai');
      assert.ok(genaiVer, '@google/genai must be resolved in package-lock.json');

      // Check @google/generative-ai resolved
      const generativeAiVer = getResolvedVersion('@google/generative-ai');
      assert.ok(generativeAiVer, '@google/generative-ai must be resolved in package-lock.json');

      // Check socket.io >= 4.8.4
      const socketIoVer = getResolvedVersion('socket.io');
      assert.ok(socketIoVer, 'socket.io must be resolved in package-lock.json');
      const [sMajor, sMinor, sPatch] = socketIoVer.split('.').map(n => parseInt(n, 10));
      assert.ok(
        sMajor > 4 || (sMajor === 4 && (sMinor > 8 || (sMinor === 8 && sPatch >= 4))),
        `Resolved socket.io version (${socketIoVer}) must be >= 4.8.4`
      );

      // Check compression >= 1.8.2
      const compVer = getResolvedVersion('compression');
      assert.ok(compVer, 'compression must be resolved in package-lock.json');
      const [cMajor, cMinor, cPatch] = compVer.split('.').map(n => parseInt(n, 10));
      assert.ok(
        cMajor > 1 || (cMajor === 1 && (cMinor > 8 || (cMinor === 8 && cPatch >= 2))),
        `Resolved compression version (${compVer}) must be >= 1.8.2`
      );
    });

    it('dependency lock produces zero vulnerabilities on npm audit', () => {
      let result;
      if (process.platform === 'win32') {
        result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd audit --json'], {
          cwd: ROOT_DIR,
          encoding: 'utf8'
        });
      } else {
        result = spawnSync('npm', ['audit', '--json'], {
          cwd: ROOT_DIR,
          encoding: 'utf8'
        });
      }

      assert.ok(result.stdout, 'npm audit must produce JSON output');
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch (err) {
        assert.fail(`Failed to parse npm audit output: ${err.message}\nRaw: ${result.stdout}`);
      }

      const totalVulns = report.metadata && report.metadata.vulnerabilities
        ? (report.metadata.vulnerabilities.total || 0)
        : 0;

      assert.strictEqual(
        totalVulns,
        0,
        `Expected 0 npm audit vulnerabilities, found ${totalVulns}: ${JSON.stringify(report.metadata && report.metadata.vulnerabilities)}`
      );
    });
  });

  describe('Module Import & API Compatibility', () => {
    it('imports @google/genai successfully with expected SDK interface', () => {
      const genai = require('@google/genai');
      assert.ok(genai, '@google/genai module must be loadable');
      assert.ok(
        typeof genai.GoogleGenAI === 'function' || typeof genai.GoogleGenerativeAI === 'function' || typeof genai.Client === 'function',
        '@google/genai must export a client or SDK class'
      );
    });

    it('imports @google/generative-ai compatibility alias successfully', () => {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      assert.strictEqual(
        typeof GoogleGenerativeAI,
        'function',
        '@google/generative-ai must export GoogleGenerativeAI constructor'
      );
    });

    it('initializes Express app with compression and parses JSON requests', async () => {
      const express = require('express');
      const compression = require('compression');

      const app = express();
      app.use(compression());
      app.use(express.json());

      app.get('/health', (req, res) => {
        res.json({ status: 'healthy', timestamp: Date.now() });
      });

      app.post('/echo', (req, res) => {
        res.json({ echo: req.body });
      });

      const serverHandle = await createTestServer(app);
      try {
        const healthRes = await fetch(`${serverHandle.url}/health`);
        assert.strictEqual(healthRes.status, 200);
        const healthData = await healthRes.json();
        assert.strictEqual(healthData.status, 'healthy');

        const echoRes = await fetch(`${serverHandle.url}/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'step14-verification' })
        });
        assert.strictEqual(echoRes.status, 200);
        const echoData = await echoRes.json();
        assert.deepStrictEqual(echoData.echo, { message: 'step14-verification' });
      } finally {
        await serverHandle.close();
      }
    });

    it('verifies Multer diskStorage handles multipart file upload with Express', async () => {
      const express = require('express');
      const multer = require('multer');

      const tempDir = createTempDir('multer-test-');
      try {
        const storage = multer.diskStorage({
          destination: function (req, file, cb) {
            cb(null, tempDir.path);
          },
          filename: function (req, file, cb) {
            cb(null, `test-${file.originalname}`);
          }
        });

        const upload = multer({ storage });
        const app = express();

        app.post('/upload', upload.single('attachment'), (req, res) => {
          if (!req.file) {
            return res.status(400).json({ error: 'No file received' });
          }
          res.json({
            filename: req.file.filename,
            size: req.file.size,
            mimetype: req.file.mimetype,
            userId: req.body.userId || 'none'
          });
        });

        const serverHandle = await createTestServer(app);
        try {
          const formData = new FormData();
          const fileContent = 'GPAce test file upload verification content';
          const blob = new Blob([fileContent], { type: 'text/plain' });
          formData.append('attachment', blob, 'sample.txt');
          formData.append('userId', 'user_step14');

          const uploadRes = await fetch(`${serverHandle.url}/upload`, {
            method: 'POST',
            body: formData
          });

          assert.strictEqual(uploadRes.status, 200, 'Upload request must succeed with 200 OK');
          const data = await uploadRes.json();
          assert.strictEqual(data.filename, 'test-sample.txt');
          assert.strictEqual(data.size, Buffer.byteLength(fileContent));
          assert.strictEqual(data.userId, 'user_step14');

          // Verify file was written to disk
          const savedFilePath = path.join(tempDir.path, 'test-sample.txt');
          assert.ok(fs.existsSync(savedFilePath), 'Uploaded file must exist on disk');
          const savedContent = fs.readFileSync(savedFilePath, 'utf8');
          assert.strictEqual(savedContent, fileContent, 'File content on disk must match uploaded content');
        } finally {
          await serverHandle.close();
        }
      } finally {
        tempDir.cleanup();
      }
    });

    it('attaches Socket.IO Server to HTTP server without errors and closes cleanly', async () => {
      const express = require('express');
      const { Server } = require('socket.io');

      const app = express();
      const server = http.createServer(app);
      const io = new Server(server);

      assert.ok(io, 'Socket.IO Server instance must be created');

      await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => resolve());
        server.on('error', reject);
      });

      try {
        const addr = server.address();
        assert.ok(addr && addr.port > 0, 'Server must have an allocated port');
        io.emit('test-event', { payload: 'hello' });
      } finally {
        await new Promise((resolve) => {
          io.close(() => {
            server.close(() => resolve());
          });
        });
      }
    });
  });
});
