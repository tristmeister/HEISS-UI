/**
 * The feedback board, mirrored into one Discord channel through
 * DISCORD_BOARD_WEBHOOK_URL, as an update channel for the roadmap:
 *
 *   - When the maintainer moves a post, ships it, replies to it or adds one,
 *     that goes in as its own message, so the channel reads as a log of what changed.
 *   - The roadmap (in progress, up next, recently done) is always the last
 *     message: after each update it's posted again below it and the old copy
 *     is deleted. Quieter changes (an edited title, a reorder) edit it in place.
 *
 * Votes and community comments stay on the board. Discord is a best-effort
 * mirror: every call here swallows its own failures, so the board never breaks
 * because of it, and a failed sync is retried on the next page load.
 */

const WEBHOOK_URL = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9._-]+$/;
const BOARD = "https://heiss-ui.vercel.app/board/";

const KEY = {
  roadmap: "discord:roadmap-message-id",
  dirty: "discord:roadmap-dirty",
};

const BRAND = 0x6f7bf7;
const TYPE = {
  bug: { emoji: "🐛", name: "Bug" },
  idea: { emoji: "💡", name: "Idea" },
  question: { emoji: "❓", name: "Question" },
};
const COLOR = { open: BRAND, planned: 0x5b9cf6, progress: 0xf59e0b, done: 0x34c77b, closed: 0x7c8190 };
const RECENT = 30 * 86_400_000;

/* ── Text helpers ───────────────────────────────────────────────────── */

export const cardUrl = (id) => `${BOARD}#p-${encodeURIComponent(id)}`;

/** Someone else's text shown as plain text: Discord markdown, links and mentions defused. */
export function plain(text) {
  return String(text ?? "")
    .replace(/([\\`*_~|[\]<>])/g, "\\$1")
    .replace(/^(\s*)([#-]|\d+\.)/gm, "$1\\$2")
    .replace(/@/g, "@​")
    .replace(/https?:\/\//gi, (scheme) => scheme.replace(":", ":​"));
}

const cut = (text, max) => {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};

/** The maintainer's own words as a quote block. Links and formatting work; nobody gets pinged. */
const quote = (text, max = 1800) =>
  cut(text, max)
    .split("\n")
    .map((line) => `> ${line.replace(/@(everyone|here)/g, "@​$1")}`)
    .join("\n");

const when = (ms) => `<t:${Math.floor(Number(ms || 0) / 1000)}:R>`;
const link = (card) => `[${plain(cut(card.title, 90))}](${cardUrl(card.id)})`;
const doneWord = (card) => (card.type === "question" ? "Answered" : card.type === "bug" ? "Fixed" : "Shipped");
const button = (label, url) => [{ type: 1, components: [{ type: 2, style: 5, label, url }] }];

/* ── What Discord shows ─────────────────────────────────────────────── */

/** The roadmap: a header and one embed per section. */
export function roadmapMessage(cards, now = Date.now()) {
  const recent = (a, b) => (b.statusAt || 0) - (a.statusAt || 0);
  const progress = cards.filter((card) => card.status === "progress").sort(recent);
  const planned = cards.filter((card) => card.status === "planned").sort(recent);
  const done = cards.filter((card) => card.status === "done" && now - (card.statusAt || 0) < RECENT).sort(recent);
  const open = cards.filter((card) => card.status === "open");

  const section = (title, color, items, line, empty, max = 8) => {
    if (!items.length && !empty) return null;
    const more = items.length > max ? `\n[+ ${items.length - max} more on the board](${BOARD})` : "";
    return { title, color, description: cut((items.slice(0, max).map(line).join("\n") || empty) + more, 4000) };
  };
  const count = (n, word) => `**${n}** ${word}`;

  const embeds = [
    {
      title: "🗺️  HEISS UI Roadmap",
      url: BOARD,
      color: BRAND,
      description: [
        "What I'm working on, what's next and what just landed. Changes and replies show up above this as they happen.",
        "",
        [count(progress.length, "in progress"), count(planned.length, "planned"), count(done.length, "done this month"), count(open.length, "open on the board")].join("  ·  "),
      ].join("\n"),
    },
    section("🛠️  In progress", COLOR.progress, progress, (card) => `${TYPE[card.type].emoji} ${link(card)} · since ${when(card.statusAt)}`, "_Nothing right now._"),
    section("🗓️  Up next", COLOR.planned, planned, (card) => `${TYPE[card.type].emoji} ${link(card)}`, "_Nothing planned yet._"),
    section("✅  Recently done", COLOR.done, done, (card) => `${TYPE[card.type].emoji} ${link(card)} · ${doneWord(card).toLowerCase()}${card.release ? ` in **${plain(card.release)}**` : ""} ${when(card.statusAt)}`, null, 6),
  ].filter(Boolean);

  const last = embeds[embeds.length - 1];
  last.footer = { text: "Kept up to date from the feedback board" };
  last.timestamp = new Date(now).toISOString();

  return {
    embeds,
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: "Open the board", url: BOARD },
          { type: 2, style: 5, label: "Suggest an idea", url: `${BOARD}?new=idea` },
          { type: 2, style: 5, label: "Report a bug", url: `${BOARD}?new=bug` },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

const MOVED = {
  open: () => ["↩️ Back on the board", COLOR.open],
  planned: () => ["🗓️ Planned", COLOR.planned],
  progress: (card) => [card.type === "bug" ? "🛠️ Working on a fix" : "🛠️ Started", COLOR.progress],
  done: (card) => [`${card.type === "idea" ? "🚀" : "✅"} ${doneWord(card)}${card.release ? ` in ${card.release}` : ""}`, COLOR.done],
  closed: () => ["🔒 Closed", COLOR.closed],
};

/** One change as an update message, or null when it isn't one worth posting. */
export function updateMessage(event) {
  const { card } = event;
  if (!card) return null;
  const type = TYPE[card.type] || TYPE.idea;
  const about = `${type.emoji} ${link(card)}`;
  let embed = null;

  if (event.type === "created" && event.admin) {
    embed = { title: "📝 Added to the board", color: COLOR.open, description: about };
  } else if (event.type === "updated" && event.before.status !== card.status) {
    const [title, color] = (MOVED[card.status] || MOVED.open)(card);
    embed = { title: cut(title, 256), color, description: about };
    if (card.status === "done" && card.release && card.type !== "question") embed.description += `\nUpdate HEISS UI to **${plain(card.release)}** or newer to get it.`;
  } else if (event.type === "updated" && card.status === "done" && card.release && card.release !== event.before.release && card.type !== "question") {
    embed = { title: cut(`🚀 Shipped in ${card.release}`, 256), color: COLOR.done, description: `${about}\nUpdate HEISS UI to **${plain(card.release)}** or newer to get it.` };
  } else if (event.type === "commented" && event.comment?.admin) {
    embed = { author: { name: `💬 ${cut(event.comment.name || "Maintainer", 60)} replied` }, color: BRAND, description: `${about}\n\n${quote(event.comment.body)}` };
  }

  if (!embed) return null;
  return { embeds: [embed], components: button("Open on the board", cardUrl(card.id)), allowed_mentions: { parse: [] } };
}

/* ── The sync ───────────────────────────────────────────────────────── */

class DiscordError extends Error {
  constructor(status, body) {
    super(`Discord answered ${status}${body?.message ? `: ${body.message}` : ""}`);
    this.status = status;
  }
}

export function createDiscordRoadmapSync({ store, webhookUrl, fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const hook = WEBHOOK_URL.test(webhookUrl || "") ? webhookUrl : "";
  let queue = Promise.resolve();
  const enqueue = (operation) => (queue = queue.then(operation, operation));

  /** One webhook call. Waits out a short rate limit once, and drops the buttons if Discord won't take them. */
  async function call(method, path, body, { retry = true } = {}) {
    const url = `${hook}${path}${path.includes("?") ? "&" : "?"}with_components=true`;
    const response = await fetchImpl(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (response.status === 429 && retry) {
      const wait = Number((await response.json().catch(() => ({}))).retry_after) || 1;
      if (wait <= 5) {
        await sleep(wait * 1000);
        return call(method, path, body, { retry: false });
      }
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.ok) return data;
    if (response.status === 400 && body?.components && retry && /component/i.test(JSON.stringify(data || ""))) {
      const { components, ...rest } = body;
      return call(method, path, rest, { retry: false });
    }
    throw new DiscordError(response.status, data);
  }

  const roadmap = async () => roadmapMessage((await store.list("")).cards, now());

  /** Posts the roadmap as the newest message, then removes the copy above. */
  async function moveRoadmapDown() {
    const old = await store.getIntegrationValue(KEY.roadmap);
    const message = await call("POST", "?wait=true", await roadmap());
    await store.setIntegrationValue(KEY.roadmap, message.id);
    if (old && old !== message.id) {
      try {
        await call("DELETE", `/messages/${encodeURIComponent(old)}`);
      } catch (error) {
        if (error.status !== 404) console.error("Discord: the old roadmap message stayed:", error.message);
      }
    }
  }

  /** Brings the roadmap up to date where it is, or posts it if it's gone. */
  async function editRoadmap() {
    const id = await store.getIntegrationValue(KEY.roadmap);
    if (id) {
      try {
        await call("PATCH", `/messages/${encodeURIComponent(id)}`, await roadmap());
        return;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    await moveRoadmapDown();
  }

  const guarded = (work) =>
    enqueue(async () => {
      if (!hook) return;
      try {
        await work();
        await store.setIntegrationValue(KEY.dirty, "0");
      } catch (error) {
        await store.setIntegrationValue(KEY.dirty, "1").catch(() => {});
        console.error("Discord roadmap sync failed:", error?.message || error);
      }
    });

  return {
    enabled: Boolean(hook),

    /** A board event: an update message plus the roadmap below it, or just a fresh roadmap. */
    event(event) {
      if (event.type === "voted" || (event.type === "commented" && !event.comment?.admin)) return Promise.resolve();
      const update = updateMessage(event);
      return guarded(async () => {
        if (!update) return editRoadmap();
        await call("POST", "", update);
        await moveRoadmapDown();
      });
    },

    /** On page loads: posts the roadmap if it's missing, or retries a sync that failed. */
    async ensure() {
      if (!hook) return;
      const [id, dirty] = await Promise.all([store.getIntegrationValue(KEY.roadmap), store.getIntegrationValue(KEY.dirty)]);
      if (!id || dirty === "1") return guarded(editRoadmap);
    },
  };
}
