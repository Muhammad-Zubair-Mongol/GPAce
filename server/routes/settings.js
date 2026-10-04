'use strict';

const express = require('express');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { createAuthMiddleware } = require('../middleware/auth');
const { createHttpError, sendError } = require('../middleware/errors');

const DEFAULT_SETTINGS = Object.freeze({
  theme: 'dark',
  notifications: true,
  pomodoroDuration: 25
});

function validateUid(uid) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw createHttpError(400, 'INVALID_OWNER', 'Invalid settings owner', { expose: true });
  }
  return uid;
}

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createHttpError(400, 'INVALID_SETTINGS', 'Settings must be an object', { expose: true });
  }

  const allowed = new Set(['theme', 'notifications', 'pomodoroDuration', 'geminiModel', 'tavilyModel']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw createHttpError(400, 'INVALID_SETTINGS', `Unsupported setting: ${key}`, { expose: true });
  }

  const result = {};
  if (input.theme !== undefined) {
    if (!['dark', 'light', 'system'].includes(input.theme)) throw createHttpError(400, 'INVALID_SETTINGS', 'Invalid theme', { expose: true });
    result.theme = input.theme;
  }
  if (input.notifications !== undefined) {
    if (typeof input.notifications !== 'boolean') throw createHttpError(400, 'INVALID_SETTINGS', 'Invalid notifications setting', { expose: true });
    result.notifications = input.notifications;
  }
  if (input.pomodoroDuration !== undefined) {
    if (!Number.isFinite(input.pomodoroDuration) || input.pomodoroDuration < 1 || input.pomodoroDuration > 180) {
      throw createHttpError(400, 'INVALID_SETTINGS', 'Invalid pomodoro duration', { expose: true });
    }
    result.pomodoroDuration = input.pomodoroDuration;
  }
  for (const key of ['geminiModel', 'tavilyModel']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > 128) throw createHttpError(400, 'INVALID_SETTINGS', `Invalid ${key}`, { expose: true });
      result[key] = input[key];
    }
  }
  return result;
}

function createSettingsRouter(options = {}) {
  if (!options.store && (typeof options.rootDir !== 'string' || !path.isAbsolute(options.rootDir))) {
    throw new TypeError('settings rootDir must be an absolute path');
  }
  const router = express.Router();
  const rootDir = options.store ? null : path.resolve(options.rootDir);
  const fsApi = options.fs || fsp;
  const authenticate = typeof options.authenticate === 'function'
    ? options.authenticate
    : createAuthMiddleware(options.auth || options);

  function settingsPath(uid) {
    validateUid(uid);
    return path.join(rootDir, uid, 'settings.json');
  }

  function assertOwner(req) {
    const uid = req.user && req.user.uid;
    const requested = req.params.userId;
    if (!uid) throw createHttpError(401, 'AUTH_REQUIRED', 'Authentication required', { expose: true });
    if (requested !== uid) throw createHttpError(403, 'FORBIDDEN', 'You do not own this resource', { expose: true });
    return uid;
  }

  router.get('/:userId', authenticate, async (req, res, next) => {
    try {
      const uid = assertOwner(req);
      if (options.store) {
        const stored = await options.store.getSettings(uid);
        return res.json({ ...DEFAULT_SETTINGS, ...(stored ? validateSettings(stored) : {}) });
      }
      const filePath = settingsPath(uid);
      let text;
      try {
        text = await fsApi.readFile(filePath, 'utf8');
      } catch (error) {
        if (error && error.code === 'ENOENT') return res.json({ ...DEFAULT_SETTINGS });
        if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
          throw createHttpError(503, 'SETTINGS_UNAVAILABLE', 'Settings are temporarily unavailable', { expose: true, cause: error });
        }
        throw error;
      }
      let parsed;
      try { parsed = JSON.parse(text); } catch (error) {
        throw createHttpError(422, 'SETTINGS_CORRUPT', 'Stored settings are corrupt', { expose: true, cause: error });
      }
      return res.json({ ...DEFAULT_SETTINGS, ...validateSettings(parsed) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:userId', authenticate, async (req, res, next) => {
    try {
      const uid = assertOwner(req);
      const settings = validateSettings(req.body);
      if (options.store) {
        await options.store.saveSettings(uid, settings);
        return res.json({ success: true, settings });
      }
      const filePath = settingsPath(uid);
      const directory = path.dirname(filePath);
      await fsApi.mkdir(directory, { recursive: true });
      const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
      try {
        await fsApi.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf8');
        await fsApi.rename(tempPath, filePath);
      } catch (error) {
        await fsApi.unlink(tempPath).catch(() => {});
        if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
          throw createHttpError(503, 'SETTINGS_UNAVAILABLE', 'Settings are temporarily unavailable', { expose: true, cause: error });
        }
        throw error;
      }
      return res.json({ success: true, settings });
    } catch (error) {
      return next(error);
    }
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return sendError(res, error, req);
  });
  return router;
}

module.exports = { DEFAULT_SETTINGS, createSettingsRouter, validateSettings, validateUid };
