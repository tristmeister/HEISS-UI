// Makes the key pair that signs HEISS UI releases. Run it once, on your own
// computer, never in CI:
//
//   node scripts/release-keygen.mjs            # writes ~/.config/heiss-ui/release-signing-key.pem
//   node scripts/release-keygen.mjs --out <file>
//
// The private key goes to a file outside the repository, readable only by
// you, and is never printed. The public key is printed with the two steps
// that finish the setup: paste it into server/release-signing.js, and hand
// the private key to GitHub Actions as a secret.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInside } from "../server/paths.js";
import { publicKeyLine } from "../server/release-signing.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = path.resolve(outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : path.join(os.homedir(), ".config", "heiss-ui", "release-signing-key.pem"));
const fail = (message) => { console.error(`\n✗ ${message}\n`); process.exit(1); };

if (isInside(root, out, { orSame: true })) fail("Keep the private key outside the repository, where git can never pick it up.");
if (fs.existsSync(out)) {
  fail(`${out} already exists. A new key would stop every installed copy from updating once they trust the old one.\n  Its public key is ${publicKeyLine(fs.readFileSync(out, "utf8"))}\n  Move the file away first if you really mean to replace it.`);
}

const { privateKey } = crypto.generateKeyPairSync("ed25519");
const pem = privateKey.export({ format: "pem", type: "pkcs8" });
fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
fs.writeFileSync(out, pem, { mode: 0o600, flag: "wx" });
try { fs.chmodSync(out, 0o600); } catch { /* Windows keeps its own ACLs. */ }

const publicKey = publicKeyLine(pem);
console.log(`
✓ Wrote the private key to ${out} (only you can read it).
  Back it up somewhere safe and offline. Lose it, and installed copies can
  only move to a new key through a release signed with this one.

Public key:

  ${publicKey}

Finish the setup:

  1. Put the public key in server/release-signing.js:

       export const RELEASE_PUBLIC_KEY = "${publicKey}";

  2. Give the private key to the release workflow as a secret:

       gh secret set HEISS_RELEASE_SIGNING_KEY -R <owner>/<repo> < "${out}"   (the repository the release workflow runs in)

  From the next release on, CI signs every zip, and copies that have the
  public key refuse any release that isn't signed with it.
`);
