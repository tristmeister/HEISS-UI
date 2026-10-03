/**
 * A stand-in ComfyUI for tests: the HTTP routes HEISS UI calls, and the
 * progress WebSocket (enough of RFC 6455 to send text frames). Each queued
 * prompt waits until the test finishes it, so a test can send progress first.
 */
import crypto from "node:crypto";
import http from "node:http";

function frame(text) {
  const payload = Buffer.from(text);
  const length = payload.length;
  const header = length < 126 ? Buffer.from([0x81, length])
    : length < 65536 ? Buffer.from([0x81, 126, length >> 8, length & 255])
    : Buffer.concat([Buffer.from([0x81, 127]), (() => { const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(length)); return size; })()]);
  return Buffer.concat([header, payload]);
}

export async function startFakeComfy({ objectInfo = {}, systemStats = {}, version = "0.34.1" } = {}) {
  const prompts = [];
  const history = {};
  const sockets = new Map();
  const waiting = new Map();
  // Runs that left the queue: finished (into history) or dropped (a restart).
  const ended = new Set();
  const deleted = [];
  // Workflows saved in ComfyUI's user folder: { "sub/name.json": workflow }.
  const savedWorkflows = {};
  let down = false;
  let count = 0;

  const json = (res, status, value) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const readBody = (req) => new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => { text += chunk; });
    req.on("end", () => { try { resolve(JSON.parse(text || "{}")); } catch { resolve({}); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    // Out of reach, the way a proxy in front of a stopped ComfyUI answers.
    if (down) return json(res, 503, { error: "down" });
    if (req.method === "POST" && url.pathname === "/prompt") {
      const body = await readBody(req);
      count += 1;
      // A current ComfyUI takes the id the client chose.
      const id = body.prompt_id || `prompt-${count}`;
      prompts.push({ id, ...body });
      json(res, 200, { prompt_id: id, number: count, node_errors: {} });
      waiting.get("prompt")?.(prompts.at(-1));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/history/")) {
      const id = decodeURIComponent(url.pathname.slice("/history/".length));
      json(res, 200, history[id] ? { [id]: history[id] } : {});
      return;
    }
    if (req.method === "GET" && url.pathname === "/history") return json(res, 200, history);
    if (req.method === "POST" && url.pathname === "/history") {
      const body = await readBody(req);
      for (const id of body.delete || []) {
        deleted.push(id);
        delete history[id];
      }
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/queue") {
      return json(res, 200, { queue_running: prompts.filter((item) => !ended.has(item.id)).map((item) => [0, item.id, {}, {}, []]), queue_pending: [] });
    }
    if (req.method === "GET" && url.pathname === "/object_info") return json(res, 200, objectInfo);
    if (req.method === "GET" && url.pathname === "/userdata") {
      return json(res, 200, Object.keys(savedWorkflows).map((name, index) => ({ path: name, size: 100, modified: 1700000000 + index })));
    }
    if (req.method === "GET" && url.pathname.startsWith("/userdata/")) {
      const file = decodeURIComponent(url.pathname.slice("/userdata/".length)).replace(/^workflows\//, "");
      return savedWorkflows[file] ? json(res, 200, savedWorkflows[file]) : json(res, 404, { error: "no such file" });
    }
    if (req.method === "GET" && url.pathname === "/system_stats") {
      return json(res, 200, { system: { comfyui_version: version, os: "posix", python_version: "3.12", pytorch_version: "2.8.0" }, devices: [{ name: "Fake GPU", type: "cuda", vram_total: 24e9, vram_free: 20e9 }], ...systemStats });
    }
    if (req.method === "GET" && url.pathname === "/internal/folder_paths") return json(res, 200, {});
    if (req.method === "POST" && ["/queue", "/interrupt", "/free"].includes(url.pathname)) return json(res, 200, {});
    json(res, 404, { error: "not in the fake" });
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://localhost");
    const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));
    const clientId = url.searchParams.get("clientId") || "";
    sockets.set(clientId, socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(clientId));
    waiting.get(`socket:${clientId}`)?.();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    prompts,
    /** Resolves with the next prompt queued (or the last one, if one already came). */
    nextPrompt: () => new Promise((resolve) => waiting.set("prompt", resolve)),
    /** Resolves once the job's progress socket is connected. */
    socketFor: (clientId) => new Promise((resolve) => (sockets.has(clientId) ? resolve() : waiting.set(`socket:${clientId}`, resolve))),
    connected: (clientId) => sockets.has(clientId),
    /** Stops (or resumes) answering: every route fails with 503 meanwhile. */
    setDown(value) { down = Boolean(value); },
    /** History entries HEISS UI asked ComfyUI to delete. */
    deleted,
    /** A run as ComfyUI's own page would leave it in history: prompt, canvas workflow, outputs. */
    addHistory(id, entry) { history[id] = entry; },
    savedWorkflows,
    /** Forgets a run without a result, as a ComfyUI restart does. */
    drop(promptId) { ended.add(promptId); },
    send(clientId, message) {
      sockets.get(clientId)?.write(frame(JSON.stringify(message)));
    },
    /** Records the run's result, the way ComfyUI's /history reports it. */
    finish(promptId, { outputs = {}, error = null } = {}) {
      const queued = prompts.find((item) => item.id === promptId) || {};
      // [number, prompt_id, graph, extra_data, outputs to run], as ComfyUI keeps it.
      const prompt = [0, promptId, queued.prompt || {}, { ...(queued.extra_data || {}), client_id: queued.client_id }, []];
      ended.add(promptId);
      history[promptId] = error
        ? { prompt, outputs: {}, status: { status_str: "error", completed: false, messages: [["execution_error", error]] } }
        : { prompt, outputs, status: { status_str: "success", completed: true, messages: [] } };
    },
    close() {
      for (const socket of sockets.values()) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}
