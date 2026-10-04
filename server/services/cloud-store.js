'use strict';

const crypto = require('node:crypto');
const {
  assertSafeUid,
  assertSafeUploadId,
  createUploadError,
  detectImage,
  IMAGE_FORMATS
} = require('./upload-store');

class CloudRepository {
  constructor(db) {
    if (!db || typeof db.collection !== 'function') throw new TypeError('Firestore database is required');
    this.db = db;
  }

  document(uid, name) {
    assertSafeUid(uid);
    return this.db.collection('gpaceServerData').doc(uid).collection('records').doc(name);
  }

  async ready() { return this; }

  async saveTimetable(uid, events) {
    if (!Array.isArray(events)) throw new TypeError('Timetable events must be an array');
    await this.document(uid, 'timetable').set({ events });
    return true;
  }

  async getTimetable(uid) {
    const snapshot = await this.document(uid, 'timetable').get();
    const events = snapshot.data()?.events;
    return Array.isArray(events) ? events : [];
  }

  async clearTimetable(uid) { return this.saveTimetable(uid, []); }

  async saveSchedule(uid, tasks) {
    if (!Array.isArray(tasks)) throw new TypeError('Schedule tasks must be an array');
    await this.document(uid, 'schedule').set({ tasks });
    return true;
  }

  async getSchedule(uid) {
    const snapshot = await this.document(uid, 'schedule').get();
    const tasks = snapshot.data()?.tasks;
    return Array.isArray(tasks) ? tasks : [];
  }

  async getLocations(uid) {
    const snapshot = await this.document(uid, 'locations').get();
    const spaces = snapshot.data()?.spaces;
    return { spaces: Array.isArray(spaces) ? spaces : [] };
  }

  async saveLocation(uid, location) {
    if (!location || typeof location !== 'object' || Array.isArray(location)) {
      throw new TypeError('Location must be an object');
    }
    const additions = Array.isArray(location.spaces) ? location.spaces : [location];
    const ref = this.document(uid, 'locations');
    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.data()?.spaces;
      transaction.set(ref, { spaces: [...(Array.isArray(current) ? current : []), ...additions] });
    });
    return true;
  }

  async getSettings(uid) {
    const snapshot = await this.document(uid, 'settings').get();
    return snapshot.exists ? snapshot.data() : null;
  }

  async saveSettings(uid, settings) {
    await this.document(uid, 'settings').set(settings);
  }

  clearCache() {}

  forTenant(uid) {
    assertSafeUid(uid);
    return {
      uid,
      ready: () => this.ready(),
      getTimetable: () => this.getTimetable(uid),
      saveTimetable: events => this.saveTimetable(uid, events),
      clearTimetable: () => this.clearTimetable(uid),
      getLocations: () => this.getLocations(uid),
      saveLocation: location => this.saveLocation(uid, location),
      getSchedule: () => this.getSchedule(uid),
      saveSchedule: tasks => this.saveSchedule(uid, tasks),
      clearCache: () => this.clearCache()
    };
  }

  forUser(uid) { return this.forTenant(uid); }
}

class CloudUploadStore {
  constructor(bucket, options = {}) {
    if (!bucket || typeof bucket.file !== 'function') throw new TypeError('Cloud Storage bucket is required');
    this.bucket = bucket;
    this.maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : 5 * 1024 * 1024;
    this.maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 3;
  }

  object(uid, uploadId, extension) {
    assertSafeUid(uid);
    assertSafeUploadId(uploadId);
    return this.bucket.file(`gpace-uploads/${uid}/${uploadId}.${extension}`);
  }

  async save(uid, file) {
    assertSafeUid(uid);
    if (!file || !Buffer.isBuffer(file.buffer)) throw createUploadError(400, 'INVALID_UPLOAD', 'Upload content is missing');
    if (file.buffer.length > this.maxBytes) throw createUploadError(413, 'UPLOAD_TOO_LARGE', 'Upload exceeds the size limit');
    const format = detectImage(file.buffer);
    if (!format) throw createUploadError(415, 'INVALID_IMAGE', 'Upload is not a supported image');
    const uploadId = crypto.randomBytes(16).toString('hex');
    await this.object(uid, uploadId, format.ext).save(file.buffer, {
      resumable: false,
      metadata: { contentType: format.mime },
      preconditionOpts: { ifGenerationMatch: 0 }
    });
    return { uploadId, uid, mime: format.mime, extension: format.ext,
      size: file.buffer.length, width: format.width, height: format.height };
  }

  async read(uid, uploadId) {
    assertSafeUid(uid);
    assertSafeUploadId(uploadId);
    for (const { ext } of Object.values(IMAGE_FORMATS)) {
      try {
        const [buffer] = await this.object(uid, uploadId, ext).download();
        const format = detectImage(buffer);
        if (!format) throw createUploadError(422, 'INVALID_IMAGE', 'Stored upload is invalid');
        return { ...format, uploadId, uid, buffer };
      } catch (error) {
        if (error.code !== 404) throw error;
      }
    }
    throw createUploadError(404, 'UPLOAD_NOT_FOUND', 'Upload not found');
  }

  async remove(uid, uploadId) {
    assertSafeUid(uid);
    assertSafeUploadId(uploadId);
    await Promise.all(Object.values(IMAGE_FORMATS).map(({ ext }) =>
      this.object(uid, uploadId, ext).delete({ ignoreNotFound: true })));
  }
}

module.exports = { CloudRepository, CloudUploadStore };
