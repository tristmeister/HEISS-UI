import crypto from "node:crypto";

/**
 * Signed releases. Every release zip gets a `<zip>.sig` next to it on GitHub:
 * an Ed25519 signature, made in CI with a private key only the maintainer
 * holds (a GitHub secret), over the version, the file name and the zip's
 * SHA-256. The updater checks it against the public key below before it
 * unpacks anything, so a download is only installed if that key signed it:
 * a hacked GitHub account, a swapped asset or a tampered mirror is refused.
 *
 * Until the key below is filled in, updates are checked by SHA-256 alone, as
 * before. Once it is, a release without a valid signature is refused. Make
 * the key with `node scripts/release-keygen.mjs` (see CONTRIBUTING.md).
 */

// PLACEHOLDER: the release public key (base64 SPKI DER, one line), printed by
// `node scripts/release-keygen.mjs`. Empty means "not configured yet".
export const RELEASE_PUBLIC_KEY = "";

/** The key the updater checks against. HEISS_RELEASE_PUBLIC_KEY is for test feeds (HEISS_RELEASE_API). */
export function releasePublicKey() {
  return String(process.env.HEISS_RELEASE_PUBLIC_KEY || RELEASE_PUBLIC_KEY || "").trim();
}

export const signingConfigured = () => Boolean(releasePublicKey());

/** Exactly what is signed: nothing about a release can change without breaking it. */
export function signedStatement({ version, file, sha256 }) {
  return Buffer.from(`heiss-ui release signature v1\nversion: ${String(version).replace(/^v/, "")}\nfile: ${file}\nsha256: ${String(sha256).toLowerCase()}\n`, "utf8");
}

function publicKeyObject(value) {
  const text = String(value || "").trim();
  if (text.includes("BEGIN PUBLIC KEY")) return crypto.createPublicKey(text);
  return crypto.createPublicKey({ key: Buffer.from(text, "base64"), format: "der", type: "spki" });
}

/** The public half of a private key, as the one-line form RELEASE_PUBLIC_KEY holds. */
export function publicKeyLine(privateKeyPem) {
  return crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem)).export({ format: "der", type: "spki" }).toString("base64");
}

/** The .sig file for one zip: JSON with what was signed and the signature. */
export function signRelease({ version, file, sha256, privateKeyPem }) {
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("The release signing key must be an Ed25519 key (scripts/release-keygen.mjs makes one).");
  const signature = crypto.sign(null, signedStatement({ version, file, sha256 }), key).toString("base64");
  return `${JSON.stringify({ v: 1, version: String(version).replace(/^v/, ""), file, sha256: String(sha256).toLowerCase(), signature }, null, 2)}\n`;
}

/**
 * Checks a .sig against what was actually downloaded. Throws with a plain
 * sentence when anything does not match; returns true otherwise.
 */
export function verifyReleaseSignature({ sig, version, file, sha256, publicKey = releasePublicKey() }) {
  if (!publicKey) throw new Error("No release key is configured.");
  let parsed;
  try {
    parsed = typeof sig === "string" ? JSON.parse(sig) : sig;
  } catch {
    throw new Error("The release’s signature file can’t be read.");
  }
  if (parsed?.v !== 1 || typeof parsed.signature !== "string") throw new Error("The release’s signature file can’t be read.");
  const statement = signedStatement({ version, file, sha256 });
  let ok = false;
  try {
    ok = crypto.verify(null, statement, publicKeyObject(publicKey), Buffer.from(parsed.signature, "base64"));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("This release isn’t signed with HEISS UI’s release key.");
  return true;
}
