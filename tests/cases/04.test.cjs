'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { createUploadRouter } = require('../../server/routes/uploads');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');

function start(app) {
  const server = http.createServer(app);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function call(server, token, method, pathname, fields = []) {
  const form = new FormData();
  for (const field of fields) form.append(field.name, new Blob([field.body], { type: field.type }), field.filename || 'fixture.png');
  const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  return { response, body: await response.arrayBuffer() };
}

describe('Step 04: Owned and content-validated image uploads', () => {
  let rootDir;
  let server;
  let outside;

  before(async () => {
    rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gpace-upload-test-'));
    outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'gpace-upload-outside-'));
    const app = express();
    app.use('/uploads', createUploadRouter({
      rootDir,
      maxBytes: 1024,
      auth: { verifyIdToken: async token => ({ uid: token }) }
    }));
    server = await start(app);
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  });

  it('round-trips an owned image with canonical MIME and opaque ID', async () => {
    const upload = await call(server, 'userA', 'POST', '/uploads', [{ name: 'image', body: PNG, type: 'image/png' }]);
    assert.equal(upload.response.status, 201);
    const json = JSON.parse(Buffer.from(upload.body).toString('utf8'));
    assert.equal(json.uploads.length, 1);
    assert.match(json.uploads[0].uploadId, /^[a-f0-9]{32}$/);

    const read = await fetch(`http://127.0.0.1:${server.address().port}/uploads/${json.uploads[0].uploadId}`, { headers: { Authorization: 'Bearer userA' } });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), PNG);
  });

  it('rejects HTML bytes advertised as PNG and leaves no durable file', async () => {
    const result = await call(server, 'userA', 'POST', '/uploads', [{ name: 'image', body: '<html>bad</html>', type: 'image/png' }]);
    assert.equal(result.response.status, 415);
    const files = await fsp.readdir(path.join(rootDir, 'userA'));
    assert.equal(files.length, 1, 'only the earlier valid fixture remains');
    assert.equal(files[0].endsWith('.png'), true);
  });

  it('rejects oversized and too-many requests before publication', async () => {
    const oversized = await call(server, 'userB', 'POST', '/uploads', [{ name: 'image', body: Buffer.alloc(2048), type: 'image/png' }]);
    assert.equal(oversized.response.status, 413);
    const tooMany = await call(server, 'userB', 'POST', '/uploads', [
      { name: 'images', body: PNG, type: 'image/png', filename: 'one.png' },
      { name: 'images', body: PNG, type: 'image/png', filename: 'two.png' },
      { name: 'images', body: PNG, type: 'image/png', filename: 'three.png' },
      { name: 'images', body: PNG, type: 'image/png', filename: 'four.png' }
    ]);
    assert.equal(tooMany.response.status, 413);
    assert.equal(fs.existsSync(path.join(rootDir, 'userB')), false);
  });

  it('prevents cross-user reads and symlinked owner directories', async () => {
    const upload = await call(server, 'userA', 'POST', '/uploads', [{ name: 'image', body: PNG, type: 'image/png' }]);
    const id = JSON.parse(Buffer.from(upload.body).toString('utf8')).uploads[0].uploadId;
    const foreign = await fetch(`http://127.0.0.1:${server.address().port}/uploads/${id}`, { headers: { Authorization: 'Bearer userB' } });
    assert.equal(foreign.status, 404);

    await fsp.symlink(outside, path.join(rootDir, 'userC'), 'junction');
    const symlinked = await call(server, 'userC', 'POST', '/uploads', [{ name: 'image', body: PNG, type: 'image/png' }]);
    assert.equal(symlinked.response.status, 400);
    assert.equal((await fsp.readdir(outside)).length, 0);
  });
});
