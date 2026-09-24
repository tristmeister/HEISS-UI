import assert from "node:assert/strict";
import test from "node:test";

// A ComfyUI whose Manager is the 3.x custom node: no /v2 routes, results only
// visible as the installed list once its queue has run.
const calls = [];
let processing = 0;
const installed = {};
globalThis.fetch = async (url, options = {}) => {
  const { pathname } = new URL(url);
  const method = options.method || "GET";
  calls.push(`${method} ${pathname}`);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (pathname.startsWith("/v2/")) return new Response("", { status: 404 });
  if (pathname === "/manager/version") return new Response("V3.42", { headers: { "content-type": "text/plain" } });
  if (pathname === "/manager/queue/install" && method === "POST") {
    assert.equal(JSON.parse(options.body).id, "seedvr2_videoupscaler");
    return new Response("");
  }
  if (pathname === "/manager/queue/start" && method === "POST") {
    assert.equal(options.body, undefined, "bodyless, or Manager rejects it");
    processing = 2;
    return new Response("");
  }
  if (pathname === "/manager/queue/status") {
    if (processing > 0 && (processing -= 1) === 0) installed["seedvr2_videoupscaler"] = { ver: "2.5.0", cnr_id: "seedvr2_videoupscaler", enabled: true };
    return json({ is_processing: processing > 0 });
  }
  if (pathname === "/customnode/installed") return json(installed);
  return new Response("", { status: 404 });
};

test("a listed pack installs through the Manager 3 custom node's queue", { timeout: 20_000 }, async () => {
  const { packInstallState, startPackInstall } = await import("./pack-installer.js");
  const started = await startPackInstall("seedvr2");
  assert.equal(started.route, "manager");
  let state = started;
  for (let i = 0; i < 60 && state.status === "running"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    state = packInstallState("seedvr2");
  }
  assert.equal(state.status, "done", state.error);
  assert.ok(calls.includes("POST /manager/queue/install"));
  assert.ok(calls.includes("POST /manager/queue/start"));
});
