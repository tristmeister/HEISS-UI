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
    if (req.method === "POST" && url.pathname === "/prompt") {
      const body = await readBody(req);
      count += 1;
      const id = `prompt-${count}`;
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
    if (req.method === "GET" && url.pathname === "/history") return json(res, 200, {});
    if (req.method === "GET" && url.pathname === "/object_info") return json(res, 200, objectInfo);
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
    send(clientId, message) {
      sockets.get(clientId)?.write(frame(JSON.stringify(message)));
    },
    /** Records the run's result, the way ComfyUI's /history reports it. */
    finish(promptId, { outputs = {}, error = null } = {}) {
      history[promptId] = error
        ? { outputs: {}, status: { status_str: "error", completed: false, messages: [["execution_error", error]] } }
        : { outputs, status: { status_str: "success", completed: true, messages: [] } };
    },
    close() {
      for (const socket of sockets.values()) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}
