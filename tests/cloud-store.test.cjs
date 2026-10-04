const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudRepository, CloudUploadStore } = require('../server/services/cloud-store');
const express = require('express');
const { createSettingsRouter } = require('../server/routes/settings');
const { createTestServer } = require('./harness/helpers.cjs');

function firestore() {
  const records = new Map();
  const document = key => ({
    get: async () => ({ exists: records.has(key), data: () => records.get(key) }),
    set: async value => { records.set(key, structuredClone(value)); }
  });
  return {
    collection: name => ({ doc: uid => ({ collection: sub => ({ doc: record => document(`${name}/${uid}/${sub}/${record}`) }) }) }),
    runTransaction: async callback => callback({ get: ref => ref.get(), set: (ref, value) => ref.set(value) })
  };
}

function bucket() {
  const objects = new Map();
  return { file: name => ({
    save: async bytes => { objects.set(name, Buffer.from(bytes)); },
    download: async () => {
      if (!objects.has(name)) throw Object.assign(new Error('missing'), { code: 404 });
      return [Buffer.from(objects.get(name))];
    },
    delete: async () => { objects.delete(name); }
  }) };
}

test('Cloud repository persists tenant data across API instances', async () => {
  const db = firestore();
  const first = new CloudRepository(db);
  const second = new CloudRepository(db);
  await first.forTenant('userA').saveTimetable([{ title: 'Class' }]);
  await first.forTenant('userA').saveSchedule([{ title: 'Study' }]);
  await first.forTenant('userA').saveLocation({ name: 'Library' });
  await first.saveSettings('userA', { theme: 'dark' });
  assert.deepEqual(await second.forTenant('userA').getTimetable(), [{ title: 'Class' }]);
  assert.deepEqual(await second.forTenant('userA').getSchedule(), [{ title: 'Study' }]);
  assert.deepEqual(await second.forTenant('userA').getLocations(), { spaces: [{ name: 'Library' }] });
  assert.deepEqual(await second.getSettings('userA'), { theme: 'dark' });
  assert.deepEqual(await second.forTenant('userB').getTimetable(), []);
  assert.equal(await second.getSettings('userB'), null);
});

test('Cloud uploads remain owner-scoped across API instances', async () => {
  const storage = bucket();
  const first = new CloudUploadStore(storage);
  const second = new CloudUploadStore(storage);
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  const saved = await first.save('userA', { buffer: png });
  const read = await second.read('userA', saved.uploadId);
  assert.deepEqual(read.buffer, png);
  await assert.rejects(() => second.read('userB', saved.uploadId), error => error.code === 'UPLOAD_NOT_FOUND');
  await second.remove('userA', saved.uploadId);
  await assert.rejects(() => first.read('userA', saved.uploadId), error => error.code === 'UPLOAD_NOT_FOUND');
});

test('Settings API reads and writes through the cloud store', async () => {
  const store = new CloudRepository(firestore());
  const app = express();
  app.use(express.json());
  app.use('/api/settings', createSettingsRouter({
    store,
    authenticate: (req, _res, next) => { req.user = { uid: 'userA' }; next(); }
  }));
  const server = await createTestServer(app);
  try {
    const saved = await fetch(`${server.url}/api/settings/userA`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'light', notifications: false })
    });
    assert.equal(saved.status, 200);
    const loaded = await fetch(`${server.url}/api/settings/userA`);
    assert.equal(loaded.status, 200);
    assert.deepEqual(await loaded.json(), { theme: 'light', notifications: false, pomodoroDuration: 25 });
    const other = await fetch(`${server.url}/api/settings/userB`);
    assert.equal(other.status, 403);
  } finally {
    await server.close();
  }
});
