import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-video-previews-test-'));
process.env.HEISS_DATA_DIR = path.join(dir, 'data');
const previews = await import('./video-previews.js');
let encoder;
try { encoder = createRequire(import.meta.url)('ffmpeg-static'); } catch { encoder = 'ffmpeg'; }
let available = true;
try { execFileSync(encoder, ['-version'], { stdio: 'ignore' }); } catch { available = false; }
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('real encoder produces a small silent preview, reuses it, and invalidates/removes derivatives', { skip: !available }, async () => {
  const source = path.join(dir, 'original.mp4');
  // Leave MP4 metadata at the end: the private seekable input must handle this too.
  execFileSync(encoder, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '10', '-c:v', 'libx264', '-threads', '1', '-crf', '18', '-c:a', 'aac', source]);
  const identity = 'library:fixture:original.mp4';
  const [one, same] = await Promise.all([previews.getFileVideoPreview(source, identity), previews.getFileVideoPreview(source, identity)]);
  assert.equal(one, same);
  assert.ok(fs.statSync(one).size < fs.statSync(source).size / 2);
  const inspect = (file) => {
    const result = spawnSync(encoder, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /384x216/);
    assert.match(result.stderr, /12 fps/);
    assert.doesNotMatch(result.stderr, /Audio:/);
    return result.stderr;
  };
  assert.match(inspect(one), /Duration: 00:00:08\.00/);
  const app = express();
  app.get('/preview', (req, res) => previews.sendVideoPreview(req, res, one));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/preview`, { headers: { Range: 'bytes=0-7' } });
    assert.equal(response.status, 206, 'the dot-directory cache is served, including byte ranges');
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal((await response.arrayBuffer()).byteLength, 8);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  const before = fs.readdirSync(path.dirname(one));
  const privateBuffer = await previews.getPrivateVideoPreview(fs.readFileSync(source));
  assert.ok(privateBuffer.length > 100);
  assert.deepEqual(fs.readdirSync(path.dirname(one)), before, 'Hidden preview leaves no plaintext file');
  const privateFile = path.join(dir, 'private-preview.mp4');
  fs.writeFileSync(privateFile, privateBuffer); // Test-only output so its decoder/streams can be inspected.
  inspect(privateFile);
  const now = new Date(Date.now() + 2000); fs.utimesSync(source, now, now);
  const changed = await previews.getFileVideoPreview(source, identity);
  assert.notEqual(changed, one);
  assert.equal(await previews.forgetItemVideoPreviews({ type: 'video', url: '/api/library/file?folder=fixture&path=original.mp4' }), 2);
  assert.equal(fs.existsSync(one), false); assert.equal(fs.existsSync(changed), false);
});
