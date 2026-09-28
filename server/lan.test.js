import assert from "node:assert/strict";
import test from "node:test";
import { listensBeyondThisComputer, resolveLan } from "./lan.js";

test("off by default, on this computer only", () => {
  assert.deepEqual(resolveLan({ argv: [], env: {} }), { host: "127.0.0.1", source: "setting", saved: false });
});

test("--lan opens it for the run, whatever was saved", () => {
  assert.deepEqual(resolveLan({ argv: ["--lan"], env: { HEISS_LAN: "0" } }), { host: "0.0.0.0", source: "flag", saved: false });
});

test("the Settings switch, saved in .env, opens it", () => {
  const lan = resolveLan({ env: { HEISS_LAN: "1" }, fileKeys: new Set(["HEISS_LAN"]) });
  assert.equal(lan.host, "0.0.0.0");
  assert.equal(lan.source, "setting");
  assert.equal(lan.saved, true);
});

test("an older HOST=0.0.0.0 in .env counts as the switch, until the switch says otherwise", () => {
  const keys = new Set(["HOST"]);
  assert.equal(resolveLan({ env: { HOST: "0.0.0.0" }, fileKeys: keys }).saved, true);
  assert.equal(resolveLan({ env: { HOST: "0.0.0.0", HEISS_LAN: "0" }, fileKeys: new Set(["HOST", "HEISS_LAN"]) }).host, "127.0.0.1");
});

test("HOST from the shell outranks the switch", () => {
  const lan = resolveLan({ env: { HOST: "0.0.0.0", HEISS_LAN: "0" }, fileKeys: new Set(["HEISS_LAN"]) });
  assert.equal(lan.host, "0.0.0.0");
  assert.equal(lan.source, "shell");
});

test("only loopback hosts stay on this computer", () => {
  assert.equal(listensBeyondThisComputer("127.0.0.1"), false);
  assert.equal(listensBeyondThisComputer("::1"), false);
  assert.equal(listensBeyondThisComputer("0.0.0.0"), true);
  assert.equal(listensBeyondThisComputer("192.168.1.20"), true);
});
