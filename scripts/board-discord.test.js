import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../docs/api/_board/core.js";
import { cardUrl, createDiscordSync, parseTags, plain, roadmapMessage } from "../docs/api/_board/discord.js";
import { memoryStore } from "../docs/api/_board/store.js";

const ORIGIN = "https://heiss-ui.vercel.app";
const ROADMAP = "https://discord.com/api/webhooks/111/roadmap-token";
const FEED = "https://discord.com/api/webhooks/222/feed-token";
const env = { BOARD_ADMIN_PASSWORD: "hunter22", BOARD_ADMIN_NAME: "Leander" };

/** A fake Discord: records every webhook call and answers like a forum or a text channel would. */
function fakeDiscord({ forum = true } = {}) {
  const calls = [];
  let next = 1000;
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || "GET", url, body });
    const answer = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if ((init.method || "GET") === "GET") return answer(200, { id: "222", guild_id: "999", channel_id: "555" });
    if (init.method === "PATCH") return answer(200, { id: url.split("/messages/")[1].split("?")[0] });
    if (url.startsWith(FEED) && !url.includes("thread_id=")) {
      if (forum && !body.thread_name) return answer(400, { code: 220001, message: "Webhooks posted to forum channels must have a thread_name or thread_id" });
      if (!forum && body.thread_name) return answer(400, { code: 220003, message: "Webhooks can only create threads in forum channels" });
    }
    const id = String(next++);
    return answer(200, { id, channel_id: body?.thread_name ? id : "555" });
  };
  return { calls, fetchImpl };
}

function board({ forum = true } = {}) {
  const store = memoryStore();
  const discord = fakeDiscord({ forum });
  const sync = createDiscordSync({ store, roadmapWebhookUrl: ROADMAP, feedWebhookUrl: FEED, forumTags: "bug=1234567,idea=7654321", fetchImpl: discord.fetchImpl, sleep: async () => {} });
  const options = { store, env, onEvent: (event) => sync.event(event), links: (id) => sync.links(id) };
  const visitor = (ip) => {
    const jar = new Map();
    const call = async (method, body, query = "") => {
      const headers = { "x-forwarded-for": ip, origin: ORIGIN };
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const response = await handle(new Request(`${ORIGIN}/api/board/${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), options);
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(";");
        const [name, value] = pair.split("=");
        jar.set(name, value);
      }
      return response.json();
    };
    return { post: (body) => call("POST", body), get: (id) => call("GET", null, `?id=${id}`) };
  };
  return { store, sync, discord, visitor };
}

const feedPosts = (calls) => calls.filter((call) => call.method === "POST" && call.url.startsWith(FEED));
const text = (call) => JSON.stringify(call.body);

test("in a forum, every post gets a thread, and the maintainer's answer lands in it", async () => {
  const { discord, visitor } = board();
  const alice = visitor("203.0.113.7");
  const admin = visitor("192.0.2.9");
  const { card } = await alice.post({ action: "create", type: "question", title: "Does it run on Intel Macs?", body: "I have a 2019 iMac.", name: "Alice" });

  const [opening] = feedPosts(discord.calls);
  assert.equal(opening.body.thread_name, "❓ Does it run on Intel Macs?");
  assert.match(opening.url, /wait=true/);
  assert.equal(opening.body.embeds[0].url, cardUrl(card.id));
  assert.match(opening.body.embeds[0].url, /#p-/, "links open the post, not just the board");
  assert.deepEqual(opening.body.allowed_mentions, { parse: [] });

  await admin.post({ action: "login", password: "hunter22" });
  await admin.post({ action: "comment", id: card.id, body: "From source, yes. The packaged app is Apple Silicon only." });
  const answer = feedPosts(discord.calls).at(-1);
  assert.match(answer.url, /thread_id=\d+/);
  assert.match(text(answer), /Leander answered/);
  assert.match(text(answer), /From source, yes/);

  await admin.post({ action: "update", id: card.id, patch: { status: "done" } });
  const news = feedPosts(discord.calls).at(-1);
  assert.match(news.url, /thread_id=/);
  assert.match(text(news), /Answered/);
  const starterEdit = discord.calls.filter((call) => call.method === "PATCH" && call.url.startsWith(FEED)).at(-1);
  assert.match(text(starterEdit), /Answered/, "the thread's first message shows the new status");

  const detail = await alice.get(card.id);
  assert.match(detail.links.discord, /^https:\/\/discord\.com\/channels\/999\/\d+$/);
});

test("shipping says which version to update to, and forum tags follow the type", async () => {
  const { discord, visitor } = board();
  const admin = visitor("192.0.2.9");
  const { card } = await admin.post({ action: "create", type: "idea", title: "Batch upscale a whole run" });
  assert.deepEqual(feedPosts(discord.calls)[0].body.applied_tags, ["7654321"]);
  await admin.post({ action: "login", password: "hunter22" });
  await admin.post({ action: "update", id: card.id, patch: { status: "progress" } });
  assert.match(text(feedPosts(discord.calls).at(-1)), /In progress/);
  await admin.post({ action: "update", id: card.id, patch: { status: "done" } });
  await admin.post({ action: "update", id: card.id, patch: { release: "v0.16.0" } });
  const shipped = feedPosts(discord.calls).at(-1);
  assert.match(text(shipped), /Shipped in v0\.16\.0/);
  assert.match(text(shipped), /Update HEISS UI to/);
});

test("in a text channel, the feed is news lines: no threads, no community chatter", async () => {
  const { discord, store, visitor } = board({ forum: false });
  const alice = visitor("203.0.113.7");
  const admin = visitor("192.0.2.9");
  const { card } = await alice.post({ action: "create", type: "bug", title: "Gallery freezes on 4k videos" });
  assert.equal(await store.getIntegrationValue("discord:feed-mode"), "text");
  const lines = () => feedPosts(discord.calls).filter((call) => !call.body.thread_name);
  assert.equal(lines().length, 1);
  assert.match(text(lines()[0]), /New bug/);

  await alice.post({ action: "comment", id: card.id, body: "Same here" });
  assert.equal(lines().length, 1, "a community comment stays on the board");

  await admin.post({ action: "login", password: "hunter22" });
  await admin.post({ action: "comment", id: card.id, body: "Found it, fix coming." });
  await admin.post({ action: "update", id: card.id, patch: { status: "progress" } });
  assert.equal(lines().length, 3);
  assert.match(text(lines()[1]), /answered/);
  assert.match(text(lines()[2]), /Being fixed right now/);
  assert.match(text(lines()[2]), /Gallery freezes/, "a text line names the post it's about");
  assert.deepEqual((await alice.get(card.id)).links, {});
});

test("vote milestones are announced once, however often people toggle", async () => {
  const { discord, visitor } = board();
  const { card } = await visitor("198.51.100.1").post({ action: "create", type: "idea", title: "Prompt history search" });
  for (let i = 2; i <= 5; i++) await visitor(`198.51.100.${i}`).post({ action: "vote", id: card.id, on: true });
  const fifth = visitor("198.51.100.5");
  await fifth.post({ action: "vote", id: card.id, on: false });
  await fifth.post({ action: "vote", id: card.id, on: true });
  const milestones = feedPosts(discord.calls).filter((call) => /5 upvotes/.test(text(call)));
  assert.equal(milestones.length, 1);
});

test("the roadmap is one message, posted once and then edited; votes only mark it stale", async () => {
  const { discord, store, sync, visitor } = board();
  const admin = visitor("192.0.2.9");
  await admin.post({ action: "login", password: "hunter22" });
  const { card } = await admin.post({ action: "create", type: "idea", title: "Regional prompting" });
  await admin.post({ action: "update", id: card.id, patch: { status: "progress" } });
  const roadmap = discord.calls.filter((call) => call.url.startsWith(ROADMAP));
  assert.equal(roadmap.filter((call) => call.method === "POST").length, 1);
  assert.ok(roadmap.filter((call) => call.method === "PATCH").length >= 1);
  assert.match(text(roadmap.at(-1)), /In progress/);
  assert.match(text(roadmap.at(-1)), /Regional prompting/);

  const before = discord.calls.length;
  await visitor("203.0.113.40").post({ action: "vote", id: card.id, on: true });
  assert.equal(discord.calls.filter((call, i) => i >= before && call.url.startsWith(ROADMAP)).length, 0);
  assert.equal(await store.getIntegrationValue("discord:roadmap-dirty"), "1");
  await store.setIntegrationValue("discord:roadmap-synced-at", "0");
  await sync.ensure();
  assert.equal(await store.getIntegrationValue("discord:roadmap-dirty"), "0");
});

test("the roadmap groups what's moving and stays inside Discord's limits", () => {
  const now = Date.UTC(2026, 9, 7);
  const cards = Array.from({ length: 40 }, (_, i) => ({
    id: `c${i}`,
    type: ["bug", "idea", "question"][i % 3],
    status: ["open", "planned", "progress", "done"][i % 4],
    title: `Card ${i} [with *markdown*] ${"long ".repeat(20)}`,
    votes: i,
    release: i % 4 === 3 ? "v0.15.0" : "",
    createdAt: now - i * 3_600_000,
    statusAt: now - i * 3_600_000,
  }));
  const message = roadmapMessage(cards, now);
  const titles = message.embeds.map((embed) => embed.title);
  assert.deepEqual(titles.slice(1), ["🛠️  In progress", "🗓️  Up next", "🚀  Recently shipped", "🔥  Most wanted"]);
  assert.ok(JSON.stringify(message.embeds).length < 6000);
  assert.ok(message.embeds.at(-1).timestamp);
  assert.match(message.embeds[1].description, /<t:\d+:R>/, "relative times stay live in Discord");
  assert.match(message.embeds[1].description, /more on the board/);
  assert.ok(!/\[with \*markdown/.test(JSON.stringify(message.embeds)), "user markdown is escaped");
});

test("user text can't ping, link or format its way into Discord", () => {
  assert.equal(plain("@everyone"), "@\u200beveryone");
  assert.equal(plain("[click](https://evil.example)"), "\\[click\\](https:\u200b//evil.example)");
  assert.equal(plain("# big\n- list"), "\\# big\n\\- list");
  assert.deepEqual(parseTags("bug=12345, idea=nope question=67890 other=11111"), { bug: "12345", question: "67890" });
});

test("a Discord outage never fails the board", async () => {
  const store = memoryStore();
  const sync = createDiscordSync({ store, roadmapWebhookUrl: ROADMAP, feedWebhookUrl: FEED, fetchImpl: async () => new Response("{}", { status: 500 }), sleep: async () => {} });
  const options = { store, env, onEvent: (event) => sync.event(event), links: (id) => sync.links(id) };
  const request = new Request(`${ORIGIN}/api/board/`, { method: "POST", headers: { origin: ORIGIN, "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ action: "create", type: "bug", title: "Webhook down" }) });
  const response = await handle(request, options);
  assert.equal(response.status, 201);
  assert.equal(await store.getIntegrationValue("discord:roadmap-dirty"), "1");
});
