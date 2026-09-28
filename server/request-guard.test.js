import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { classifyClient, isPrivateAddress } from "./client-trust.js";
import { hostAllowed, hostnameOf, requestGuard } from "./request-guard.js";

/** Just enough of an Express request and response for the middleware. */
function run(guard, { method = "POST", path = "/api/gallery/clear", headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries({ host: "localhost:8787", ...headers }).map(([key, value]) => [key.toLowerCase(), value]));
  const req = {
    method,
    path,
    headers: lower,
    is(type) { return String(lower["content-type"] || "").includes(type.split("/")[1]) ? type : false; }
  };
  const result = { status: 0, body: null, passed: false };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  guard(req, res, () => { result.passed = true; });
  return result;
}

const guard = requestGuard({ lan: () => false });
const lanGuard = requestGuard({ lan: () => true, extraHosts: () => ["studio.tail1234.ts.net"] });

test("the studio's own page gets through: same origin plus the header or JSON", () => {
  assert.ok(run(guard, { headers: { "sec-fetch-site": "same-origin", "x-heiss": "1" } }).passed);
  assert.ok(run(guard, { headers: { origin: "http://localhost:8787", "content-type": "application/json" } }).passed);
  assert.ok(run(guard, { method: "GET", path: "/api/gallery" }).passed);
});

test("a bodyless POST from another website is refused (the old gallery wipe)", () => {
  const result = run(guard, { headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } });
  assert.equal(result.passed, false);
  assert.equal(result.status, 403);
  assert.equal(result.body.reason, "origin");
  // Old browsers without Sec-Fetch-Site still send an Origin that does not match.
  assert.equal(run(guard, { headers: { origin: "https://evil.example", "x-heiss": "1" } }).passed, false);
  assert.equal(run(guard, { headers: { origin: "null", "x-heiss": "1" } }).passed, false);
  // Another app on localhost is same-site, not same-origin.
  assert.equal(run(guard, { headers: { "sec-fetch-site": "same-site", "x-heiss": "1" } }).passed, false);
});

test("a same-origin request still needs the header or JSON, which only the studio sends", () => {
  const result = run(guard, { headers: { "sec-fetch-site": "same-origin", "content-type": "text/plain" } });
  assert.equal(result.passed, false);
  assert.equal(result.body.reason, "header");
  // curl and scripts: no browser headers at all, the studio header is enough.
  assert.ok(run(guard, { headers: { "x-heiss": "1" } }).passed);
});

test("other sites cannot read or embed /api and /comfy either", () => {
  assert.equal(run(guard, { method: "GET", path: "/comfy/view", headers: { "sec-fetch-site": "cross-site" } }).passed, false);
  // The page itself is not guarded; only the API is.
  assert.ok(run(guard, { method: "GET", path: "/", headers: { "sec-fetch-site": "cross-site", host: "evil.example" } }).passed);
});

test("DNS rebinding: a request naming another host is refused before anything runs", () => {
  const result = run(guard, { method: "GET", path: "/api/gallery", headers: { host: "rebind.evil.example:8787" } });
  assert.equal(result.passed, false);
  assert.equal(result.body.reason, "host");
  assert.equal(run(guard, { method: "GET", path: "/api/gallery", headers: { host: "" } }).passed, false);
});

test("hosts: loopback always, the machine's own addresses only in LAN mode, extra names when configured", () => {
  for (const host of ["localhost:8787", "127.0.0.1:8787", "[::1]:8787", "LOCALHOST.:5173", "app.localhost"]) assert.ok(hostAllowed(host), host);
  const lanAddress = Object.values(os.networkInterfaces()).flat().find((entry) => entry && !entry.internal && entry.family === "IPv4")?.address;
  if (lanAddress) {
    assert.equal(hostAllowed(`${lanAddress}:8787`), false);
    assert.ok(hostAllowed(`${lanAddress}:8787`, { lan: true }));
  }
  assert.equal(hostAllowed("192.0.2.77:8787", { lan: true }), false);
  assert.ok(run(lanGuard, { method: "GET", path: "/api/gallery", headers: { host: "studio.tail1234.ts.net:8788" } }).passed);
  process.env.HEISS_ALLOWED_HOSTS = "studio.home.arpa, https://other.lan/";
  try {
    assert.ok(hostAllowed("studio.home.arpa"));
    assert.ok(hostAllowed("other.lan:8787"));
  } finally {
    delete process.env.HEISS_ALLOWED_HOSTS;
  }
  assert.equal(hostnameOf("[fe80::1]:8787"), "fe80::1");
});

test("a request through a proxy is never this computer", () => {
  const local = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
  assert.equal(classifyClient(local).thisComputer, true);
  for (const header of ["x-forwarded-for", "forwarded", "x-real-ip", "via"]) {
    const proxied = classifyClient({ socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { [header]: "203.0.113.9" } });
    assert.equal(proxied.thisComputer, false, header);
    assert.equal(proxied.proxied, true);
    assert.equal(proxied.network, false, "LAN mode off: nobody else");
    assert.equal(classifyClient({ socket: { remoteAddress: "127.0.0.1" }, headers: { [header]: "x" } }, { lanActions: true }).network, true);
  }
});

test("devices on the network are only let in with LAN mode on, and never from a public address", () => {
  const phone = { socket: { remoteAddress: "::ffff:192.168.1.40" }, headers: {} };
  assert.deepEqual(classifyClient(phone), { address: "192.168.1.40", proxied: false, thisComputer: false, network: false });
  assert.equal(classifyClient(phone, { lanActions: true }).network, true);
  assert.equal(classifyClient({ socket: { remoteAddress: "8.8.8.8" }, headers: {} }, { lanActions: true }).network, false);
  for (const address of ["10.0.0.2", "172.16.4.1", "172.31.255.1", "192.168.0.1", "100.101.102.103", "fd7a:115c:a1e0::1", "fe80::1"]) assert.ok(isPrivateAddress(address), address);
  for (const address of ["172.32.0.1", "100.128.0.1", "1.1.1.1", "2001:db8::1"]) assert.equal(isPrivateAddress(address), false, address);
});

test("only the dev proxy with the right token may say who is behind it", () => {
  const viaVite = (token, client = "192.168.1.40") => classifyClient({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-heiss-dev-token": token, "x-heiss-dev-client": client } }, { lanActions: true, devToken: "secret-token" });
  assert.equal(viaVite("secret-token").thisComputer, false);
  assert.equal(viaVite("secret-token").address, "192.168.1.40");
  assert.equal(viaVite("secret-token", "127.0.0.1").thisComputer, true);
  // A wrong token changes nothing: still just the socket.
  assert.equal(viaVite("guess").address, "127.0.0.1");
  // A token sent from elsewhere is not believed at all.
  assert.equal(classifyClient({ socket: { remoteAddress: "192.168.1.40" }, headers: { "x-heiss-dev-token": "secret-token", "x-heiss-dev-client": "127.0.0.1" } }, { devToken: "secret-token" }).thisComputer, false);
});
