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
  execFileSync(encoder, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '10', '-c:v', 'libx264', '-threads', '1', '-crf', '18', '-c:a', 'aac', source]);
  const identity = 'library:fixture:original.mp4';
  const [one, same] = await Promise.all([previews.getFileVideoPreview(source, identity), previews.getFileVideoPreview(source, identity)]);
  assert.equal(one, same);
  assert.ok(fs.statSync(one).size < fs.statSync(source).size / 2);
  const inspect = (file) => {
    const result = spawnSync(encoder, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /720x40[46]/, 'fits 720 px, the size grid tiles show it at');
    assert.match(result.stderr, /24 fps/);
    assert.doesNotMatch(result.stderr, /Audio:/);
    return result.stderr;
  };
  assert.match(inspect(one), /Duration: 00:00:08\.00/);
  // The still comes from the original, needs no preview, and is cached beside it.
  const poster = await previews.getFileVideoPoster(source, identity);
  assert.match(poster, /\.jpg$/);
  assert.equal(await previews.getFileVideoPoster(source, identity), poster);
  assert.equal(fs.readFileSync(poster).subarray(0, 2).toString('hex'), 'ffd8');
  assert.deepEqual(await previews.probeVideo(source), { width: 1280, height: 720, durationMs: 10000 });
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
  const [privateBuffer, sameTime] = await Promise.all([previews.getPrivateVideoPreview(fs.readFileSync(source), 'vault:one'), previews.getPrivateVideoPreview(fs.readFileSync(source), 'vault:one')]);
  assert.ok(privateBuffer.length > 100);
  assert.equal(sameTime, privateBuffer, 'requests at the same time share one encode');
  assert.equal(await previews.getPrivateVideoPreview(fs.readFileSync(source), 'vault:one'), privateBuffer, 'a Hidden preview is encoded once, then kept in memory');
  previews.forgetPrivateVideoPreviews('vault:one');
  assert.notEqual(await previews.getPrivateVideoPreview(fs.readFileSync(source), 'vault:one'), privateBuffer, 'forgetting drops it');
  assert.deepEqual(fs.readdirSync(path.dirname(one)), before, 'Hidden preview leaves no plaintext file');
  const privateFile = path.join(dir, 'private-preview.mp4');
  fs.writeFileSync(privateFile, privateBuffer); // Test-only output so its decoder/streams can be inspected.
  inspect(privateFile);
  const now = new Date(Date.now() + 2000); fs.utimesSync(source, now, now);
  const changed = await previews.getFileVideoPreview(source, identity);
  assert.notEqual(changed, one);
  // Both previews and the still go: nothing of a hidden or deleted video stays in the cache.
  assert.equal(await previews.forgetItemVideoPreviews({ type: 'video', url: '/api/library/file?folder=fixture&path=original.mp4' }), 3);
  assert.equal(fs.existsSync(poster), false);
  assert.equal(fs.existsSync(one), false); assert.equal(fs.existsSync(changed), false);
});
