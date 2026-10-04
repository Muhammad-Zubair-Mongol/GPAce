'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const IMAGE_FORMATS = Object.freeze({
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  gif: { mime: 'image/gif', ext: 'gif' }
});

function createUploadError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  error.publicMessage = message;
  return error;
}

function assertSafeUid(uid) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw createUploadError(400, 'INVALID_OWNER', 'Invalid upload owner');
  }
  return uid;
}

function assertSafeUploadId(uploadId) {
  if (typeof uploadId !== 'string' || !/^[a-f0-9]{32}$/.test(uploadId)) {
    throw createUploadError(400, 'INVALID_UPLOAD_ID', 'Invalid upload ID');
  }
  return uploadId;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function detectPng(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { ...IMAGE_FORMATS.png, width, height };
}

function detectGif(buffer) {
  if (buffer.length < 10) return null;
  const signature = buffer.subarray(0, 6).toString('ascii');
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  if (!width || !height) return null;
  return { ...IMAGE_FORMATS.gif, width, height };
}

function detectJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    const isFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isFrame && segmentLength >= 7) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width && height) return { ...IMAGE_FORMATS.jpeg, width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  return detectPng(buffer) || detectJpeg(buffer) || detectGif(buffer);
}

class UploadStore {
  constructor(options = {}) {
    if (typeof options.rootDir !== 'string' || !path.isAbsolute(options.rootDir)) {
      throw new TypeError('UploadStore requires an absolute rootDir');
    }
    this.rootDir = path.resolve(options.rootDir);
    this.maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : 5 * 1024 * 1024;
    this.maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 3;
  }

  async _root() {
    await fsp.mkdir(this.rootDir, { recursive: true });
    const rootRealpath = await fsp.realpath(this.rootDir);
    return { root: this.rootDir, rootRealpath };
  }

  async _userDir(uid, create = false) {
    assertSafeUid(uid);
    const { root, rootRealpath } = await this._root();
    const directory = path.join(root, uid);
    if (create) await fsp.mkdir(directory, { recursive: true });
    let directoryRealpath;
    try {
      directoryRealpath = await fsp.realpath(directory);
    } catch (error) {
      if (error.code === 'ENOENT') return { directory, rootRealpath, directoryRealpath: null };
      throw error;
    }
    if (!isContained(rootRealpath, directoryRealpath)) {
      throw createUploadError(400, 'INVALID_UPLOAD_ROOT', 'Upload storage is outside its owner boundary');
    }
    // Continue all filesystem operations from the canonical path returned by
    // realpath. Windows may represent the same temporary directory with an
    // 8.3 short name before realpath normalization; mixing the two forms can
    // make a safe child look like an escape.
    return { directory: directoryRealpath, rootRealpath, directoryRealpath };
  }

  async save(uid, file) {
    const { directory, rootRealpath, directoryRealpath } = await this._userDir(uid, true);
    if (!directoryRealpath || !isContained(rootRealpath, directoryRealpath)) {
      throw createUploadError(400, 'INVALID_UPLOAD_ROOT', 'Upload storage is outside its owner boundary');
    }
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw createUploadError(400, 'INVALID_UPLOAD', 'Upload content is missing');
    }
    if (file.buffer.length > this.maxBytes) {
      throw createUploadError(413, 'UPLOAD_TOO_LARGE', 'Upload exceeds the size limit');
    }
    const format = detectImage(file.buffer);
    if (!format) {
      throw createUploadError(415, 'INVALID_IMAGE', 'Upload is not a supported image');
    }

    const uploadId = crypto.randomBytes(16).toString('hex');
    const finalPath = path.join(directory, `${uploadId}.${format.ext}`);
    const tempPath = path.join(directory, `.${uploadId}.${format.ext}.tmp`);
    if (!isContained(directoryRealpath, finalPath)) {
      throw createUploadError(400, 'INVALID_UPLOAD_PATH', 'Invalid upload path');
    }

    try {
      await fsp.writeFile(tempPath, file.buffer, { flag: 'wx' });
      await fsp.rename(tempPath, finalPath);
      const finalRealpath = await fsp.realpath(finalPath);
      if (!isContained(directoryRealpath, finalRealpath)) {
        await fsp.unlink(finalPath).catch(() => {});
        throw createUploadError(400, 'INVALID_UPLOAD_PATH', 'Invalid upload path');
      }
      return {
        uploadId,
        uid,
        mime: format.mime,
        extension: format.ext,
        size: file.buffer.length,
        width: format.width,
        height: format.height
      };
    } catch (error) {
      await fsp.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  async read(uid, uploadId) {
    assertSafeUploadId(uploadId);
    const { directory, directoryRealpath } = await this._userDir(uid, false);
    if (!directoryRealpath) throw createUploadError(404, 'UPLOAD_NOT_FOUND', 'Upload not found');
    const entries = await fsp.readdir(directory);
    const entry = entries.find(name => new RegExp(`^${uploadId}\\.(png|jpg|gif)$`).test(name));
    if (!entry) throw createUploadError(404, 'UPLOAD_NOT_FOUND', 'Upload not found');
    const filePath = path.join(directory, entry);
    const realpath = await fsp.realpath(filePath);
    if (!isContained(directoryRealpath, realpath)) {
      throw createUploadError(403, 'UPLOAD_FORBIDDEN', 'Upload is outside its owner boundary');
    }
    const buffer = await fsp.readFile(realpath);
    const format = detectImage(buffer);
    if (!format) throw createUploadError(422, 'INVALID_IMAGE', 'Stored upload is invalid');
    return { ...format, uploadId, uid, buffer };
  }

  async remove(uid, uploadId) {
    assertSafeUploadId(uploadId);
    const { directory } = await this._userDir(uid, false);
    for (const extension of Object.values(IMAGE_FORMATS).map(value => value.ext)) {
      await fsp.unlink(path.join(directory, `${uploadId}.${extension}`)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
}

module.exports = {
  IMAGE_FORMATS,
  UploadStore,
  assertSafeUid,
  assertSafeUploadId,
  createUploadError,
  detectImage,
  isContained
};
