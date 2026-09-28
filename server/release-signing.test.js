import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { publicKeyLine, RELEASE_PUBLIC_KEY, signRelease, verifyReleaseSignature } from "./release-signing.js";
import { installable, pickAsset } from "./updater.js";

const pem = (key) => key.export({ format: "pem", type: "pkcs8" });
const { privateKey } = crypto.generateKeyPairSync("ed25519");
const { privateKey: stranger } = crypto.generateKeyPairSync("ed25519");
const publicKey = publicKeyLine(pem(privateKey));
const release = { version: "0.12.0", file: "heiss-ui-0.12.0.zip", sha256: "ab".repeat(32) };

test("a signed release verifies with its public key, and only as exactly this release", () => {
  const sig = signRelease({ ...release, privateKeyPem: pem(privateKey) });
  assert.equal(verifyReleaseSignature({ sig, ...release, publicKey }), true);
  assert.throws(() => verifyReleaseSignature({ sig, ...release, sha256: "cd".repeat(32), publicKey }), /isn’t signed/, "other bytes");
  assert.throws(() => verifyReleaseSignature({ sig, ...release, version: "0.13.0", publicKey }), /isn’t signed/, "an old signed zip passed off as newer");
  assert.throws(() => verifyReleaseSignature({ sig, ...release, file: "heiss-ui-0.12.0-windows-x64.zip", publicKey }), /isn’t signed/);
  assert.throws(() => verifyReleaseSignature({ sig, ...release, publicKey: publicKeyLine(pem(stranger)) }), /isn’t signed/, "someone else's key");
  assert.throws(() => verifyReleaseSignature({ sig: "not json", ...release, publicKey }), /can’t be read/);
  assert.throws(() => signRelease({ ...release, privateKeyPem: pem(crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey) }), /Ed25519/);
});

test("until a release key is configured, updates install on their checksum as before", () => {
  assert.equal(RELEASE_PUBLIC_KEY, "", "the placeholder ships empty");
  const asset = pickAsset({ tag_name: "v0.12.0", assets: [{ name: "heiss-ui-0.12.0.zip", browser_download_url: "https://example.test/z.zip", digest: `sha256:${"a".repeat(64)}` }] });
  assert.deepEqual(installable(asset), { ok: true, reason: "" });
  assert.equal(installable({ ...asset, sha256: "" }).reason, "checksum");
});

test("once a key is configured, a release without a signature won't install itself", () => {
  process.env.HEISS_RELEASE_PUBLIC_KEY = publicKey;
  try {
    const unsigned = pickAsset({ tag_name: "v0.12.0", assets: [{ name: "heiss-ui-0.12.0.zip", browser_download_url: "https://example.test/z.zip", digest: `sha256:${"a".repeat(64)}` }] });
    assert.deepEqual(installable(unsigned), { ok: false, reason: "unsigned" });
    const signed = pickAsset({ tag_name: "v0.12.0", assets: [
      { name: "heiss-ui-0.12.0.zip", browser_download_url: "https://example.test/z.zip", digest: `sha256:${"a".repeat(64)}` },
      { name: "heiss-ui-0.12.0.zip.sig", browser_download_url: "https://example.test/z.zip.sig" }
    ] });
    assert.equal(signed.sigUrl, "https://example.test/z.zip.sig");
    assert.deepEqual(installable(signed), { ok: true, reason: "" });
  } finally {
    delete process.env.HEISS_RELEASE_PUBLIC_KEY;
  }
});
