'use strict';

const express = require('express');
const multer = require('multer');
const { createAuthMiddleware } = require('../middleware/auth');
const { createHttpError, sendError } = require('../middleware/errors');
const { UploadStore } = require('../services/upload-store');

function defaultAuthentication(options) {
  if (typeof options.authenticate === 'function') return options.authenticate;
  return createAuthMiddleware(options.auth || options);
}

function createUploadRouter(options = {}) {
  const router = express.Router();
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 3;
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : 5 * 1024 * 1024;
  const store = options.store || new UploadStore({ rootDir: options.rootDir, maxBytes, maxFiles });
  const authenticate = defaultAuthentication(options);
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: maxFiles, fields: 16 }
  }).fields([
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: maxFiles }
  ]);

  router.post('/', authenticate, (req, res, next) => {
    parser(req, res, async error => {
      if (error) return next(error);
      try {
        const files = Object.values(req.files || {}).flat();
        if (!files.length) throw createHttpError(400, 'UPLOAD_REQUIRED', 'At least one image is required', { expose: true });
        if (files.length > maxFiles) throw createHttpError(413, 'TOO_MANY_FILES', 'Too many images', { expose: true });

        const saved = [];
        try {
          for (const file of files) saved.push(await store.save(req.user.uid, file));
        } catch (saveError) {
          await Promise.all(saved.map(item => store.remove(req.user.uid, item.uploadId).catch(() => {})));
          throw saveError;
        }
        return res.status(201).json({ success: true, uploads: saved });
      } catch (routeError) {
        return next(routeError);
      }
    });
  });

  router.get('/:uploadId', authenticate, async (req, res, next) => {
    try {
      const upload = await store.read(req.user.uid, req.params.uploadId);
      res.setHeader('Content-Type', upload.mime);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(upload.buffer);
    } catch (error) {
      return next(error);
    }
  });

  router.use((error, req, res, next) => {
    if (error && error.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, createHttpError(413, 'UPLOAD_TOO_LARGE', 'Upload exceeds the size limit', { expose: true }), req);
    }
    if (error && error.code === 'LIMIT_FILE_COUNT') {
      return sendError(res, createHttpError(413, 'TOO_MANY_FILES', 'Too many images', { expose: true }), req);
    }
    return next(error);
  });

  return router;
}

module.exports = { createUploadRouter };
