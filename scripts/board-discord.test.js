import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../docs/api/_board/core.js";
import { cardUrl, createDiscordRoadmapSync, plain, roadmapMessage, updateMessage } from "../docs/api/_board/discord.js";
import { memoryStore } from "../docs/api/_board/store.js";

const ORIGIN = "https://heiss-ui.vercel.app";
const HOOK = "https://discord.com/api/webhooks/111/roadmap-token";
const env = { BOARD_ADMIN_PASSWORD: "hunter22", BOARD_ADMIN_NAME: "Leander" };

/** A fake Discord channel: keeps the webhook's messages in order, like the channel would show them. */
function fakeChannel({ fail = false } = {}) {
  const messages = [];
  const calls = [];
  let next = 1000;
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    const answer = (status, data) => new Response(data == null ? null : JSON.stringify(data), { status });
    if (fail) return answer(500, { message: "down" });
    const id = url.split("/messages/")[1]?.split("?")[0];
    if (method === "POST") {
      const message = { id: String(next++), ...body };
      messages.push(message);
      return answer(200, message);
    }
    const index = messages.findIndex((message) => message.id === id);
    if (index < 0) return answer(404, { message: "Unknown Message" });
    if (method === "PATCH") return answer(200, Object.assign(messages[index], body));
    if (method === "DELETE") {
      messages.splice(index, 1);
      return answer(204, null);
    }
  };
  return { messages, calls, fetchImpl };
}

function board(channelOptions) {
  const store = memoryStore();
  const channel = fakeChannel(channelOptions);
  const sync = createDiscordRoadmapSync({ store, webhookUrl: HOOK, fetchImpl: channel.fetchImpl, sleep: async () => {} });
  const options = { store, env, onEvent: (event) => sync.event(event) };
  const visitor = (ip) => {
    const jar = new Map();
    return async (body) => {
      const headers = { "x-forwarded-for": ip, origin: ORIGIN };
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const response = await handle(new Request(`${ORIGIN}/api/board/`, { method: "POST", headers, body: JSON.stringify(body) }), options);
      for (const line of response.headers.getSetCookie()) {
        const [name, value] = line.split(";")[0].split("=");
        jar.set(name, value);
      }
      return { status: response.status, ...(await response.json()) };
    };
  };
  return { store, sync, channel, visitor };
}

const words = (message) => JSON.stringify(message?.embeds || []);
const isRoadmap = (message) => /HEISS UI Roadmap/.test(words(message));

test("updates stack up as messages and the roadmap is always the newest one", async () => {
  const { channel, visitor } = board();
  const alice = visitor("203.0.113.7");
  const admin = visitor("192.0.2.9");
  await admin({ action: "login", password: "hunter22" });

  const { card } = await alice({ action: "create", type: "idea", title: "Batch upscale a whole run", name: "Alice" });
  assert.equal(channel.messages.length, 1, "someone else's new post only refreshes the roadmap");
  assert.ok(isRoadmap(channel.messages[0]));

  await admin({ action: "update", id: card.id, patch: { status: "planned" } });
  await admin({ action: "comment", id: card.id, body: "Good one. Details in https://github.com/tristmeister/HEISS-UI/issues/1" });
  await admin({ action: "update", id: card.id, patch: { status: "progress" } });
  await admin({ action: "update", id: card.id, patch: { status: "done" } });
  await admin({ action: "update", id: card.id, patch: { release: "v0.16.0" } });

  const log = channel.messages.map((message) => (isRoadmap(message) ? "roadmap" : message.embeds[0].title || message.embeds[0].author.name));
  assert.deepEqual(log, ["🗓️ Planned", "💬 Leander replied", "🛠️ Started", "🚀 Shipped", "🚀 Shipped in v0.16.0", "roadmap"]);
  assert.equal(channel.messages.filter(isRoadmap).length, 1, "the old roadmap copies are deleted");

  const reply = channel.messages[1];
  assert.match(words(reply), /https:\/\/github\.com\/tristmeister/, "links in my replies stay clickable");
  assert.match(words(reply), new RegExp(cardUrl(card.id).replace(/[.?]/g, "\\$&")));
  assert.match(words(channel.messages[4]), /Update HEISS UI to \*\*v0\.16\.0\*\*/);
  assert.match(words(channel.messages.at(-1)), /Recently done/);
  assert.match(words(channel.messages.at(-1)), /shipped in \*\*v0\.16\.0\*\*/);
});

test("votes, community comments, edits and reorders don't post anything new", async () => {
  const { channel, visitor } = board();
  const alice = visitor("203.0.113.7");
  const admin = visitor("192.0.2.9");
  await admin({ action: "login", password: "hunter22" });
  const { card } = await admin({ action: "create", type: "bug", title: "Gallery freezes on 4k videos" });
  assert.equal(channel.messages[0].embeds[0].title, "📝 Added to the board");
  await admin({ action: "update", id: card.id, patch: { status: "progress" } });
  const before = channel.messages.length;

  await alice({ action: "vote", id: card.id, on: true });
  await alice({ action: "comment", id: card.id, body: "Same here" });
  await admin({ action: "update", id: card.id, patch: { title: "Gallery freezes on long 4k videos" } });
  await admin({ action: "arrange", type: "bug", ids: [card.id] });

  assert.equal(channel.messages.length, before);
  assert.match(words(channel.messages.at(-1)), /long 4k videos/, "the roadmap was edited in place");
});

test("questions are answered, bugs are fixed", () => {
  const before = { status: "progress", release: "" };
  const done = (type) => updateMessage({ type: "updated", before, card: { id: "x", type, title: "T", status: "done", release: "" } }).embeds[0].title;
  assert.equal(done("question"), "✅ Answered");
  assert.equal(done("bug"), "✅ Fixed");
  assert.equal(done("idea"), "🚀 Shipped");
  assert.equal(updateMessage({ type: "commented", card: { id: "x", type: "idea", title: "T" }, comment: { admin: false, body: "hi" } }), null);
});

test("a roadmap message that was deleted by hand comes back", async () => {
  const { channel, store, sync, visitor } = board();
  await visitor("203.0.113.7")({ action: "create", type: "idea", title: "Regional prompting" });
  channel.messages.length = 0;
  await sync.event({ type: "arranged" });
  assert.equal(channel.messages.length, 1);
  assert.equal(await store.getIntegrationValue("discord:roadmap-message-id"), channel.messages[0].id);
});

test("the roadmap groups what's moving and stays inside Discord's limits", () => {
  const now = Date.UTC(2026, 9, 7);
  const cards = Array.from({ length: 40 }, (_, i) => ({
    id: `c${i}`,
    type: ["bug", "idea", "question"][i % 3],
    status: ["open", "planned", "progress", "done"][i % 4],
    title: `Card ${i} [with *markdown*] ${"long ".repeat(20)}`,
    release: i % 4 === 3 ? "v0.15.0" : "",
    createdAt: now - i * 3_600_000,
    statusAt: now - i * 3_600_000,
  }));
  const message = roadmapMessage(cards, now);
  assert.deepEqual(message.embeds.map((embed) => embed.title).slice(1), ["🛠️  In progress", "🗓️  Up next", "✅  Recently done"]);
  assert.ok(JSON.stringify(message.embeds).length < 6000);
  assert.match(message.embeds[1].description, /since <t:\d+:R>/, "relative times stay live in Discord");
  assert.match(message.embeds[1].description, /more on the board/);
  assert.ok(!/\[with \*markdown/.test(JSON.stringify(message.embeds)), "post titles can't format the message");
  assert.match(message.embeds[1].description, /#p-c2\)/, "links open the post itself");
});

test("other people's text can't ping, link or format its way in", () => {
  assert.equal(plain("@everyone"), "@\u200beveryone");
  assert.equal(plain("[click](https://evil.example)"), "\\[click\\](https:\u200b//evil.example)");
  assert.equal(plain("# big\n- list"), "\\# big\n\\- list");
});

test("a Discord outage never fails the board, and the next page load retries", async () => {
  const { store, visitor } = board({ fail: true });
  const response = await visitor("203.0.113.9")({ action: "create", type: "bug", title: "Webhook down" });
  assert.equal(response.status, 201);
  assert.equal(await store.getIntegrationValue("discord:roadmap-dirty"), "1");
});
