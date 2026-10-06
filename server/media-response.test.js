import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMediaBuffer } from './media-response.js';

function request(range) {
  const res = { headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, send(body) { this.body = body; }, end() {} };
  sendMediaBuffer({ headers: range ? { range } : {} }, res, Buffer.from('0123456789'));
  return res;
}
test('in-memory video supports complete, bounded, open-ended and suffix ranges', () => {
  assert.equal(request().headers['Content-Length'], 10);
  for (const [range, body, contentRange] of [['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=8-', '89', 'bytes 8-9/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-99', '89', 'bytes 8-9/10']]) {
    const res = request(range); assert.equal(res.code, 206); assert.equal(res.body.toString(), body); assert.equal(res.headers['Content-Range'], contentRange);
    assert.equal(res.headers['Content-Length'], body.length);
  }
});
test('invalid or unsatisfiable ranges return 416 with the file length', () => {
  for (const range of ['bytes=10-', 'bytes=6-4', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'garbage']) {
    const res = request(range); assert.equal(res.code, 416, range); assert.equal(res.headers['Content-Range'], 'bytes */10'); assert.equal(res.body, undefined);
  }
});
