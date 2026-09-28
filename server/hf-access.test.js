import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { hfFetch, hfTokenStatus, mirroredUrl, openTunnel, proxyFor } from "./hf-access.js";

const token = "hf_abcdefghijklmnopqrstuvwxyz1234";

test("the token goes to huggingface.co only, never along a redirect to the CDN", async () => {
  const seen = [];
  const transport = async (url, options) => {
    seen.push({ host: url.hostname, auth: options.headers.get("authorization") });
    if (url.hostname === "huggingface.co") return new Response(null, { status: 302, headers: { location: "https://cdn-lfs.hf.co/file?sig=1" } });
    return new Response("data", { status: 200 });
  };
  const response = await hfFetch("https://huggingface.co/org/repo/resolve/main/a.safetensors", { headers: { range: "bytes=0-" } }, { env: { HF_TOKEN: token }, transport });
  assert.equal(await response.text(), "data");
  assert.deepEqual(seen, [{ host: "huggingface.co", auth: `Bearer ${token}` }, { host: "cdn-lfs.hf.co", auth: null }]);
});

test("a mirror takes the downloads, and does not get the token", async () => {
  const env = { HF_ENDPOINT: "https://hf-mirror.com", HF_TOKEN: token };
  assert.equal(mirroredUrl("https://huggingface.co/org/repo/resolve/main/a.safetensors", env).href, "https://hf-mirror.com/org/repo/resolve/main/a.safetensors");
  assert.equal(mirroredUrl("https://example.com/x", env).href, "https://example.com/x");
  const seen = [];
  await hfFetch("https://huggingface.co/org/repo/resolve/main/a.safetensors", {}, { env, transport: async (url, options) => { seen.push([url.hostname, options.headers.get("authorization")]); return new Response("ok"); } });
  assert.deepEqual(seen, [["hf-mirror.com", null]]);
});

test("proxy variables are honoured, NO_PROXY included", () => {
  const env = { HTTPS_PROXY: "http://user:pa%40ss@proxy.local:3128", NO_PROXY: "localhost,.internal.corp,mirror.lan:8080" };
  assert.equal(proxyFor("https://huggingface.co/x", env)?.host, "proxy.local:3128");
  assert.equal(proxyFor("https://a.internal.corp/x", env), null);
  assert.equal(proxyFor("http://mirror.lan:8080/x", env), null);
  assert.equal(proxyFor("https://huggingface.co/x", { http_proxy: "proxy.lan:8080" })?.host, "proxy.lan:8080", "https falls back to HTTP_PROXY, scheme optional");
  assert.equal(proxyFor("https://huggingface.co/x", { HTTPS_PROXY: "http://p:1", NO_PROXY: "*" }), null);
  assert.equal(proxyFor("https://huggingface.co/x", {}), null);
});

test("a CONNECT tunnel carries bytes through the proxy, with its credentials", async () => {
  const echo = net.createServer((socket) => socket.pipe(socket));
  await new Promise((resolve) => echo.listen(0, "127.0.0.1", resolve));
  let auth = "";
  const proxy = http.createServer();
  proxy.on("connect", (request, client) => {
    auth = request.headers["proxy-authorization"] || "";
    const [host, port] = request.url.split(":");
    const upstream = net.connect(Number(port), host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(client);
      client.pipe(upstream);
    });
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    const socket = await openTunnel(new URL(`http://me:secret@127.0.0.1:${proxy.address().port}`), "127.0.0.1", echo.address().port);
    const answer = await new Promise((resolve) => { socket.once("data", (data) => resolve(String(data))); socket.write("ping"); });
    socket.destroy();
    assert.equal(answer, "ping");
    assert.equal(auth, `Basic ${Buffer.from("me:secret").toString("base64")}`);
  } finally {
    proxy.close();
    echo.close();
  }
});

test("Settings sees whether a token is set and where from, never the token", () => {
  const status = hfTokenStatus({ HF_TOKEN: token });
  assert.equal(status.set, true);
  assert.equal(status.source, "environment");
  assert.equal(status.editable, false);
  assert.ok(!JSON.stringify(status).includes(token));
  assert.deepEqual(hfTokenStatus({}), { set: false, source: "", editable: true });
});
