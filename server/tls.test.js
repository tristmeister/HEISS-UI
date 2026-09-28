import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listenPlan } from "./listen.js";
import { inspectTls } from "./tls.js";

// A throwaway self-signed pair for studio.test and 127.0.0.1, valid until 2126,
// and a key that belongs to nothing. Test fixtures only.
const cert = `-----BEGIN CERTIFICATE-----
MIIBRDCB66ADAgECAgkAgkaGEjbixX4wCgYIKoZIzj0EAwIwFjEUMBIGA1UEAwwL
c3R1ZGlvLnRlc3QwIBcNMjYwOTI4MTQ1MjIzWhgPMjEyNjA5MDQxNDUyMjNaMBYx
FDASBgNVBAMMC3N0dWRpby50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE
d0cAxP27qA5MVMRxRGVP5rRGEd6j2EMmAOeI8tGUaG9t5j3LzkcJOL++cT+YsEsI
f1LqCfHXKAcRORXrhzXoJ6MgMB4wHAYDVR0RBBUwE4ILc3R1ZGlvLnRlc3SHBH8A
AAEwCgYIKoZIzj0EAwIDSAAwRQIgSH5a1QlIK6jeA1Z6GGbMk4Kg+NENz1QM9Yu9
0uwNuIQCIQDb/WvftrpO5RDsK9ISobmjbL1We7t+blEyCmvrrkBA3Q==
-----END CERTIFICATE-----
`;
const key = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIDIU8DZVpNJvg1jgu98we3yGRd2RGmNX2ChNT3E4FAanoAoGCCqGSM49
AwEHoUQDQgAEd0cAxP27qA5MVMRxRGVP5rRGEd6j2EMmAOeI8tGUaG9t5j3LzkcJ
OL++cT+YsEsIf1LqCfHXKAcRORXrhzXoJw==
-----END EC PRIVATE KEY-----
`;
const strangerKey = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIPxLXymOIZK8QZU7dbOzb6l8Yc+NZFikcibVq8bHWcO4oAoGCCqGSM49
AwEHoUQDQgAEHp7uHp705/Mb2DwHzo40e69LIuF2ziGvN658O6eXCOX1tusq0GSZ
99NdD2OtCCO9SVmM+ZMLkZjj1l7J/K5cqw==
-----END EC PRIVATE KEY-----
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-tls-"));
const write = (name, text) => { const file = path.join(dir, name); fs.writeFileSync(file, text); return file; };
const certFile = write("studio.crt", cert);
const keyFile = write("studio.key", key);

test("a matching certificate and key are ready, with the names browsers will accept", () => {
  const report = inspectTls(certFile, keyFile);
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.names, ["studio.test", "127.0.0.1"]);
  assert.equal(report.expired, false);
  assert.ok(report.pem.cert.length && report.pem.key.length);
});

test("a wrong key, a missing file or something that isn't PEM is refused in plain words", () => {
  assert.match(inspectTls(certFile, write("stranger.key", strangerKey)).error, /doesn’t belong/);
  assert.match(inspectTls(path.join(dir, "nope.crt"), keyFile).error, /isn’t there/);
  assert.match(inspectTls(write("junk.crt", "hello"), keyFile).error, /PEM|certificate/);
  assert.equal(inspectTls("", "").configured, false);
});

test("with a certificate, other devices get HTTPS and plain HTTP stays on this computer", () => {
  const ready = inspectTls(certFile, keyFile);
  assert.deepEqual(listenPlan({ host: "0.0.0.0", tls: ready }), { httpHost: "127.0.0.1", httpsHost: "0.0.0.0", tlsProblem: "" });
  // LAN mode off: nothing about HTTPS, nothing changes.
  assert.deepEqual(listenPlan({ host: "127.0.0.1", tls: ready }), { httpHost: "127.0.0.1", httpsHost: "", tlsProblem: "" });
  // No certificate: plain HTTP for everyone, as before.
  assert.deepEqual(listenPlan({ host: "0.0.0.0", tls: inspectTls("", "") }), { httpHost: "0.0.0.0", httpsHost: "", tlsProblem: "" });
});

test("a certificate that can't be used keeps the network closed instead of falling back to plain HTTP", () => {
  const broken = inspectTls(certFile, write("other.key", strangerKey));
  const plan = listenPlan({ host: "0.0.0.0", tls: broken });
  assert.equal(plan.httpHost, "127.0.0.1");
  assert.equal(plan.httpsHost, "");
  assert.match(plan.tlsProblem, /doesn’t belong/);
});
