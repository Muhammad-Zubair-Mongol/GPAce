'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');

const { createApp } = require('./server/app');
const dataStorage = require('./server/dataStorage');
const { createGeminiProvider } = require('./server/services/gemini-provider');
const { configureSocketAuth } = require('./server/socket-auth');
const { CloudRepository, CloudUploadStore } = require('./server/services/cloud-store');

function cloudDependencies() {
  const bucketName = process.env.GPACE_UPLOAD_BUCKET;
  if (!bucketName) throw new Error('GPACE_UPLOAD_BUCKET is required for durable Cloud Run uploads');
  const { getApps, initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  if (!getApps().length) initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'mzm-gpace',
    storageBucket: bucketName
  });
  const repository = new CloudRepository(getFirestore());
  return { repository, uploadStore: new CloudUploadStore(getStorage().bucket(bucketName)), settingsStore: repository };
}

function optionalProvider(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'provider')) return options.provider;
  if (!process.env.GEMINI_API_KEY) return null;
  return createGeminiProvider({
    apiKey: process.env.GEMINI_API_KEY,
    modelName: process.env.GEMINI_MODEL || undefined
  });
}

function existingDirectory(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return undefined;
  try {
    return fs.statSync(candidate).isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

async function createServer(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('server options must be an object');
  }

  const server = http.createServer();
  const io = new Server(server, options.socket || {});
  const provider = optionalProvider(options);
  const cloud = process.env.K_SERVICE ? cloudDependencies() : {};
  const publicDir = existingDirectory(
    options.publicDir || process.env.GPACE_PUBLIC_DIR || path.join(__dirname, 'dist')
  );
  const app = await createApp({
    ...options,
    provider,
    repositories: options.repositories || cloud.repository || dataStorage,
    uploadStore: options.uploadStore || cloud.uploadStore,
    settingsStore: options.settingsStore || cloud.settingsStore,
    uploadRootDir: options.uploadRootDir || path.join(__dirname, 'uploads'),
    settingsRootDir: options.settingsRootDir || path.join(__dirname, 'data', 'settings'),
    publicDir,
    io
  });

  server.on('request', app);
  configureSocketAuth(io, {
    auth: options.auth,
    verifyIdToken: options.verifyIdToken
  });

  return { app, server, io, provider };
}

async function startServer(options = {}) {
  const runtime = await createServer(options);
  const port = options.port === undefined ? (process.env.PORT || 3000) : options.port;
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(port, () => {
      runtime.server.removeListener('error', reject);
      resolve();
    });
  });
  return runtime;
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  startServer()
    .then(({ server }) => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : process.env.PORT || 3000;
      console.log(`Server running at http://localhost:${port}`);
    })
    .catch(error => {
      console.error('Server startup failed:', error && error.message ? error.message : 'unknown error');
      process.exitCode = 1;
    });
}

module.exports = {
  createServer,
  optionalProvider,
  startServer
};
