import assert from "node:assert/strict";
import test from "node:test";
import { applyPatch, clean, handle, newCard, sessionToken, validSession } from "../docs/api/_board/core.js";
import { memoryStore, redisStore, storeFromEnv } from "../docs/api/_board/store.js";

const ORIGIN = "https://heiss-ui.vercel.app";
const env = { BOARD_ADMIN_PASSWORD: "hunter22" };

/** A small browser: keeps cookies between calls like the board page would. */
function visitor(store, { origin = ORIGIN, ip = "203.0.113.7", now } = {}) {
  const jar = new Map();
  const call = async (method, body, query = "") => {
    const headers = { "x-forwarded-for": ip };
    if (origin) headers.origin = origin;
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const request = new Request(`${ORIGIN}/api/board/${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const response = await handle(request, { store, env, now });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, value] = pair.split("=");
      if (/Max-Age=0/.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  return {
    jar,
    list: () => call("GET"),
    get: (id) => call("GET", null, `?id=${id}`),
    post: (body) => call("POST", body),
  };
}

test("clean keeps text plain, trimmed and capped", () => {
  assert.equal(clean("  a\u0000b  \n c ", 20), "a b c");
  assert.equal(clean("line one\r\n\r\n\r\n\r\nline two  ", 50, { multiline: true }), "line one\n\nline two");
  assert.equal(clean("x".repeat(30), 10), "x".repeat(10));
});

test("a new card needs a type and a real title", () => {
  assert.throws(() => newCard({ type: "rant", title: "Hello there" }), /bug, idea or question/);
  assert.throws(() => newCard({ type: "idea", title: " hi " }), /title/);
  const card = newCard({ type: "idea", title: "Dark mode for the dark mode", body: "please" }, 1000);
  assert.equal(card.status, "open");
  assert.equal(card.setup, "");
  assert.equal(card.pos, null);
  assert.equal(card.source, "web");
  assert.equal(card.createdAt, 1000);
});

test("admin patches change only what they name and stamp status changes", () => {
  const card = newCard({ type: "bug", title: "Broken thing" }, 1);
  const next = applyPatch(card, { status: "progress" }, 5);
  assert.equal(next.status, "progress");
  assert.equal(next.statusAt, 5);
  assert.equal(next.title, "Broken thing");
  assert.throws(() => applyPatch(card, { status: "maybe" }), /Unknown status/);
  assert.equal(applyPatch({ ...card, pos: 3 }, { type: "idea" }).pos, null);
});

test("sessions are signed, expire and die with a new password", () => {
  const token = sessionToken(env, 0);
  assert.ok(validSession(env, token, 1));
  assert.ok(!validSession(env, token, 31 * 86_400_000));
  assert.ok(!validSession({ BOARD_ADMIN_PASSWORD: "other" }, token, 1));
  assert.ok(!validSession(env, token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), 1));
  assert.ok(!validSession({}, token, 1));
});

test("anyone can post, and the author's post starts with their vote", async () => {
  const store = memoryStore();
  const alice = visitor(store);
  const created = await alice.post({ action: "create", type: "idea", title: "Batch prompts from a file", body: "One per line", name: "Alice" });
  assert.equal(created.status, 201);
  assert.equal(created.body.card.votes, 1);
  assert.ok(alice.jar.has("hb_voter"));

  const board = await alice.list();
  assert.equal(board.body.cards.length, 1);
  assert.deepEqual(board.body.voted, [created.body.card.id]);
  assert.equal(board.body.admin, false);
});

test("votes toggle per visitor and never double count", async () => {
  const store = memoryStore();
  const alice = visitor(store);
  const bob = visitor(store, { ip: "198.51.100.2" });
  const { body } = await alice.post({ action: "create", type: "bug", title: "Upscale button does nothing" });
  const cardId = body.card.id;

  assert.equal((await bob.post({ action: "vote", id: cardId, on: true })).body.votes, 2);
  assert.equal((await bob.post({ action: "vote", id: cardId, on: true })).body.votes, 2);
  assert.equal((await bob.post({ action: "vote", id: cardId, on: false })).body.votes, 1);
  assert.equal((await bob.post({ action: "vote", id: "nope", on: true })).status, 404);
});

test("the app can post from another origin, without a cookie or a vote", async () => {
  const store = memoryStore();
  const app = visitor(store, { origin: "http://localhost:8787" });
  const sent = await app.post({ action: "create", type: "bug", title: "Generation failed: Out of memory", setup: "HEISS UI 0.14.0\nGPU: RTX 3060", source: "app", appVersion: "0.14.0" });
  assert.equal(sent.status, 201);
  assert.equal(sent.headers.get("access-control-allow-origin"), "*");
  assert.equal(sent.body.card.votes, 0);
  assert.equal(sent.body.card.source, "app");
  assert.match(sent.body.card.setup, /RTX 3060/);
  assert.ok(!app.jar.has("hb_voter"));
  // But it can't vote or comment from there.
  assert.equal((await app.post({ action: "vote", id: sent.body.card.id })).status, 403);
});

test("a filled honeypot is thanked and dropped", async () => {
  const store = memoryStore();
  const bot = visitor(store);
  const sent = await bot.post({ action: "create", type: "idea", title: "Buy cheap things", website: "http://spam.example" });
  assert.equal(sent.status, 200);
  assert.equal((await bot.list()).body.cards.length, 0);
});

test("posting is rate limited per address", async () => {
  const store = memoryStore();
  const eager = visitor(store);
  for (let i = 0; i < 6; i++) assert.equal((await eager.post({ action: "create", type: "idea", title: `Idea number ${i}` })).status, 201);
  const seventh = await eager.post({ action: "create", type: "idea", title: "Idea number 7" });
  assert.equal(seventh.status, 429);
  const other = visitor(store, { ip: "192.0.2.50" });
  assert.equal((await other.post({ action: "create", type: "idea", title: "Someone else" })).status, 201);
});

test("comments show on the card, and admin replies are marked", async () => {
  const store = memoryStore();
  const alice = visitor(store);
  const admin = visitor(store, { ip: "192.0.2.9" });
  const { body } = await alice.post({ action: "create", type: "question", title: "Does it run on Intel Macs?" });
  const cardId = body.card.id;
  assert.equal((await alice.post({ action: "comment", id: cardId, body: "   " })).status, 400);
  await alice.post({ action: "comment", id: cardId, body: "Asking for a friend", name: "Alice" });
  await admin.post({ action: "login", password: "hunter22" });
  await admin.post({ action: "comment", id: cardId, body: "From source, yes.", name: "Pretender" });

  const detail = await alice.get(cardId);
  assert.equal(detail.body.comments.length, 2);
  assert.equal(detail.body.comments[1].admin, true);
  assert.equal(detail.body.comments[1].name, "Maintainer");
  assert.equal((await alice.list()).body.cards[0].comments, 2);

  assert.equal((await admin.post({ action: "deleteComment", id: cardId, commentId: detail.body.comments[0].id })).status, 200);
  assert.equal((await alice.get(cardId)).body.comments.length, 1);
});

test("moving, editing and deleting take the admin password", async () => {
  const store = memoryStore();
  const alice = visitor(store);
  const admin = visitor(store, { ip: "192.0.2.9" });
  const { body } = await alice.post({ action: "create", type: "idea", title: "Queue reordering" });
  const cardId = body.card.id;

  assert.equal((await alice.post({ action: "update", id: cardId, patch: { status: "done" } })).status, 401);
  assert.equal((await alice.post({ action: "delete", id: cardId })).status, 401);
  assert.equal((await admin.post({ action: "login", password: "wrong" })).status, 401);

  const login = await admin.post({ action: "login", password: "hunter22" });
  assert.equal(login.status, 200);
  assert.ok(admin.jar.has("hb_admin"));
  assert.equal((await admin.list()).body.admin, true);

  const moved = await admin.post({ action: "update", id: cardId, patch: { status: "progress", type: "bug", title: "Queue reordering (drag)" } });
  assert.equal(moved.body.card.status, "progress");
  assert.equal(moved.body.card.type, "bug");

  const second = (await alice.post({ action: "create", type: "bug", title: "Second bug here" })).body.card.id;
  const arranged = await admin.post({ action: "arrange", type: "bug", ids: [second, cardId] });
  assert.deepEqual(arranged.body.cards.map((c) => c.pos), [0, 1]);

  assert.equal((await admin.post({ action: "delete", id: cardId })).status, 200);
  assert.equal((await alice.list()).body.cards.length, 1);

  await admin.post({ action: "logout" });
  assert.equal((await admin.list()).body.admin, false);
});

test("admin actions refuse another origin even with the cookie", async () => {
  const store = memoryStore();
  const admin = visitor(store);
  await admin.post({ action: "login", password: "hunter22" });
  const { body } = await admin.post({ action: "create", type: "idea", title: "Something good" });
  const cookie = [...admin.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const forged = new Request(`${ORIGIN}/api/board/`, { method: "POST", headers: { origin: "https://evil.example", cookie }, body: JSON.stringify({ action: "delete", id: body.card.id }) });
  assert.equal((await handle(forged, { store, env })).status, 403);
});

test("the summary counts what's open and names what's in progress", async () => {
  const store = memoryStore();
  const admin = visitor(store);
  await admin.post({ action: "login", password: "hunter22" });
  const a = (await admin.post({ action: "create", type: "idea", title: "Idea one here" })).body.card.id;
  await admin.post({ action: "create", type: "bug", title: "Bug one here" });
  const c = (await admin.post({ action: "create", type: "bug", title: "Bug two here" })).body.card.id;
  await admin.post({ action: "update", id: a, patch: { status: "progress" } });
  await admin.post({ action: "update", id: c, patch: { status: "done" } });
  const request = new Request(`${ORIGIN}/api/board/?view=summary`);
  const body = await (await handle(request, { store, env })).json();
  assert.deepEqual(body.counts, { bug: 1, idea: 1, question: 0, done: 1 });
  assert.deepEqual(body.progress.map((card) => card.title), ["Idea one here"]);
});

test("without storage the board says it isn't set up", async () => {
  const response = await handle(new Request(`${ORIGIN}/api/board/`), { store: null, env });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ready, false);
  assert.equal(storeFromEnv({ VERCEL: "1" }), null);
  assert.equal(storeFromEnv({}).kind, "memory");
  assert.equal(storeFromEnv({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" }).kind, "redis");
});

test("the Redis store speaks Upstash's pipeline API", async () => {
  const sent = [];
  const fake = async (url, init) => {
    const commands = JSON.parse(init.body);
    sent.push({ url, auth: init.headers.authorization, commands });
    const results = commands.map(([cmd]) => {
      if (cmd === "HGETALL") return { result: ["abc", JSON.stringify({ id: "abc", title: "T", createdAt: 1 })] };
      if (cmd === "SMEMBERS") return { result: ["abc"] };
      if (cmd === "SADD") return { result: 1 };
      if (cmd === "HINCRBY") return { result: 4 };
      return { result: null };
    });
    return new Response(JSON.stringify(results));
  };
  const store = redisStore({ url: "https://x.upstash.io/", token: "tok", prefix: "b:", fetchImpl: fake });
  const listed = await store.list("v1");
  assert.equal(sent[0].url, "https://x.upstash.io/pipeline");
  assert.equal(sent[0].auth, "Bearer tok");
  assert.deepEqual(sent[0].commands[0], ["HGETALL", "b:cards"]);
  assert.equal(listed.cards[0].title, "T");
  assert.deepEqual(listed.voted, ["abc"]);
  assert.equal(await store.vote("abc", "v1", true), 4);
});
