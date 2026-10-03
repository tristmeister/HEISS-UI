import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { inputImageSize, prepareInputImage } from './input-image-sizing.js';

const image = (width, height) => sharp({ create: { width, height, channels: 4, background: { r: 40, g: 80, b: 120, alpha: 0.4 } } }).png().toBuffer();

test('portrait and landscape inputs fit different generation budgets without enlargement', async () => {
  for (const [width, height] of [[3000, 4000], [4000, 3000]]) {
    for (const pixels of [512 * 512, 1024 * 1024, 1280 * 720]) {
      const bytes = { buffer: await image(width, height), mime: 'image/png', name: 'source.png' };
      const result = await prepareInputImage(bytes, { pixels });
      const metadata = await sharp(result.buffer).metadata();
      assert.ok(metadata.width * metadata.height <= pixels);
      assert.ok(Math.abs(metadata.width / metadata.height - width / height) < 0.003);
      assert.ok(metadata.hasAlpha);
      assert.deepEqual(await sharp(bytes.buffer).metadata().then(({ width, height }) => [width, height]), [width, height]);
    }
  }
});

test('small inputs and the off switch keep exact source bytes', async () => {
  const bytes = { buffer: await image(400, 300), mime: 'image/png', name: 'small.png' };
  assert.equal((await prepareInputImage(bytes, { pixels: 1024 * 1024 })).buffer, bytes.buffer);
  assert.equal(await prepareInputImage(bytes), bytes);
});

test('EXIF orientation is respected when downscaling a JPEG', async () => {
  const buffer = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#334455' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await prepareInputImage({ buffer, mime: 'image/jpeg', name: 'rotated.jpg' }, { pixels: 512 * 512 });
  assert.ok(result.height > result.width);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.orientation, undefined);
  assert.equal(result.mime, 'image/png');
});

test('starter dimensions respect the model grid and tiny panoramas stay nonzero', () => {
  const size = inputImageSize(4000, 3000, 1024 * 1024, 16);
  assert.equal(size.width % 16, 0);
  assert.equal(size.height % 16, 0);
  assert.ok(size.width * size.height <= 1024 * 1024);
  assert.ok(inputImageSize(80000, 1, 10000).height >= 1);
});
