/**
 * The feedback board, mirrored into Discord. Two webhooks, both optional:
 *
 *   DISCORD_BOARD_WEBHOOK_URL       one roadmap message, edited in place: what's
 *                                   in progress, planned, just shipped and most
 *                                   wanted. Best in a read-only #roadmap channel.
 *   DISCORD_BOARD_FEED_WEBHOOK_URL  what happens on the board, as it happens. In a
 *                                   forum channel every post gets its own thread
 *                                   (follow it to hear when it moves or gets an
 *                                   answer); in a text channel it's one line per
 *                                   new post, status change, answer or vote milestone.
 *   DISCORD_BOARD_FORUM_TAGS        optional forum tag ids, "bug=123,idea=456,question=789".
 *
 * Discord is a best-effort mirror: every call here swallows its own failures so
 * the board never waits on or breaks because of it. The board stays the source of truth.
 */

const WEBHOOK_URL = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9._-]+$/;
const SITE = "https://heiss-ui.vercel.app";
const BOARD = `${SITE}/board/`;

const KEY = {
  roadmap: "discord:roadmap-message-id",
  dirty: "discord:roadmap-dirty",
  syncedAt: "discord:roadmap-synced-at",
  mode: "discord:feed-mode",
  guild: "discord:feed-guild",
  thread: (id) => `discord:thread:${id}`,
  milestone: (id) => `discord:milestone:${id}`,
};

const BRAND = 0x6f7bf7;
const TYPE = {
  bug: { emoji: "🐛", name: "Bug", color: 0xf0616d },
  idea: { emoji: "💡", name: "Idea", color: 0xf5b83d },
  question: { emoji: "❓", name: "Question", color: 0x4cc3f5 },
};
const STATUS = {
  open: { emoji: "🟣", name: "Open", color: BRAND },
  planned: { emoji: "🗓️", name: "Planned", color: 0x5b9cf6 },
  progress: { emoji: "🛠️", name: "In progress", color: 0xf59e0b },
  done: { emoji: "✅", name: "Done", color: 0x34c77b },
  closed: { emoji: "🔒", name: "Closed", color: 0x7c8190 },
};
const MILESTONES = [5, 10, 25, 50, 100, 250, 500, 1000];
const ROADMAP_COOLDOWN = 60_000;
const ACTIVE = new Set(["open", "planned", "progress"]);

/* ── Text helpers ───────────────────────────────────────────────────── */

export const cardUrl = (id) => `${BOARD}#p-${encodeURIComponent(id)}`;

/** User text shown as plain text: Discord markdown, links and mentions defused. */
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

/** A quoted excerpt of user text, at most `lines` lines. */
const quote = (text, max = 600, lines = 8) => {
  const body = cut(String(text || "").split("\n").slice(0, lines).join("\n"), max);
  return body ? body.split("\n").map((line) => `> ${plain(line)}`).join("\n") : "";
};

const when = (ms, style = "R") => `<t:${Math.floor(Number(ms || 0) / 1000)}:${style}>`;
const link = (card) => `[${plain(cut(card.title, 80))}](${cardUrl(card.id)})`;
const statusName = (card) => (card.status === "done" ? (card.type === "question" ? "Answered" : card.type === "bug" ? "Fixed" : "Shipped") : STATUS[card.status]?.name || "Open");
const statusLine = (card) => `${STATUS[card.status]?.emoji || "🟣"} ${statusName(card)}${card.status === "done" && card.release ? ` in **${plain(card.release)}**` : ""}`;
const votes = (card) => `▲ ${Number(card.votes) || 0}`;
const threadName = (card) => cut(`${TYPE[card.type]?.emoji || ""} ${card.title}`.trim(), 100);

const buttons = (...items) => [{ type: 1, components: items.filter(Boolean).slice(0, 5).map(([label, url, emoji]) => ({ type: 2, style: 5, label, url, ...(emoji ? { emoji: { name: emoji } } : {}) })) }];

/* ── What Discord shows ─────────────────────────────────────────────── */

/** The roadmap message: a header and one embed per section that has something in it. */
export function roadmapMessage(cards, now = Date.now()) {
  const active = cards.filter((card) => ACTIVE.has(card.status));
  const byVotes = (a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0) || a.createdAt - b.createdAt;
  const progress = active.filter((card) => card.status === "progress").sort((a, b) => b.statusAt - a.statusAt);
  const planned = active.filter((card) => card.status === "planned").sort(byVotes);
  const shipped = cards.filter((card) => card.status === "done" && card.type !== "question" && now - (card.statusAt || 0) < 30 * 86_400_000).sort((a, b) => b.statusAt - a.statusAt);
  const wanted = active.filter((card) => card.status === "open" && card.type === "idea" && Number(card.votes) > 0).sort(byVotes);
  const bugs = active.filter((card) => card.type === "bug").length;
  const questions = active.filter((card) => card.type === "question" && card.status === "open").length;

  const section = (title, color, items, line, max = 6, empty = null) => {
    if (!items.length && !empty) return null;
    const shown = items.slice(0, max).map(line);
    const more = items.length > max ? `\n[+ ${items.length - max} more on the board](${BOARD})` : "";
    return { title, color, description: cut((shown.join("\n") || empty) + more, 4000) };
  };

  const stats = [
    `🛠️ **${progress.length}** in progress`,
    `🗓️ **${planned.length}** planned`,
    `🚀 **${shipped.length}** shipped this month`,
    `🐛 **${bugs}** open bug${bugs === 1 ? "" : "s"}`,
    questions ? `❓ **${questions}** waiting for an answer` : null,
  ].filter(Boolean);

  const embeds = [
    {
      title: "🗺️  HEISS UI Roadmap",
      url: BOARD,
      color: BRAND,
      description: [
        "What's being built right now, what's next, and what just shipped. Upvote what you want most on the board: votes decide what moves up.",
        "",
        stats.join(" · "),
      ].join("\n"),
    },
    section("🛠️  In progress", STATUS.progress.color, progress, (card) => `${TYPE[card.type].emoji} ${link(card)} · ${votes(card)} · started ${when(card.statusAt)}`, 8, "_Nothing on the bench right now._"),
    section("🗓️  Up next", STATUS.planned.color, planned, (card) => `${TYPE[card.type].emoji} ${link(card)} · ${votes(card)}`, 8, "_Nothing planned yet: vote for what should be._"),
    section("🚀  Recently shipped", STATUS.done.color, shipped, (card) => `${TYPE[card.type].emoji} ${link(card)}${card.release ? ` · **${plain(card.release)}**` : ""} · ${when(card.statusAt)}`, 6),
    section("🔥  Most wanted", 0xff6b4a, wanted, (card) => `${link(card)} · **${votes(card)}**`, 5),
  ].filter(Boolean);

  embeds[embeds.length - 1].footer = { text: "Updates by itself · heiss-ui.vercel.app/board" };
  embeds[embeds.length - 1].timestamp = new Date(now).toISOString();

  return {
    embeds,
    components: buttons(["Open the board", BOARD, "🗺️"], ["Suggest an idea", `${BOARD}?new=idea`, "💡"], ["Report a bug", `${BOARD}?new=bug`, "🐛"]),
    allowed_mentions: { parse: [] },
  };
}

/** The post itself: the first message of its forum thread, kept current. */
export function cardMessage(card) {
  const type = TYPE[card.type] || TYPE.idea;
  const fields = [
    { name: "Status", value: statusLine(card), inline: true },
    { name: "Votes", value: `**${votes(card)}**`, inline: true },
    card.source === "app" ? { name: "From", value: card.appVersion ? `the app, v${plain(card.appVersion)}` : "the app", inline: true } : null,
  ].filter(Boolean);
  return {
    embeds: [
      {
        author: { name: `${type.emoji} ${type.name} · ${cut(card.name || "Anonymous", 40)}` },
        title: cut(card.title, 256),
        url: cardUrl(card.id),
        color: card.status === "open" ? type.color : STATUS[card.status]?.color || type.color,
        description: quote(card.body, 1500, 20) || undefined,
        fields,
        footer: { text: "Mirrored from the HEISS UI board · votes and replies live there" },
        timestamp: new Date(card.createdAt || Date.now()).toISOString(),
      },
    ],
    components: buttons([card.type === "bug" ? "Same here: upvote" : "Upvote on the board", cardUrl(card.id), "▲"], ["Reply on the board", cardUrl(card.id), "💬"]),
    allowed_mentions: { parse: [] },
  };
}

const STATUS_NEWS = {
  planned: () => ({ title: "🗓️ Planned", text: "This is on the roadmap." }),
  progress: (card) => ({ title: "🛠️ In progress", text: card.type === "bug" ? "Being fixed right now." : "Being worked on right now." }),
  done: (card) =>
    card.type === "question"
      ? { title: "✅ Answered", text: "This one has its answer on the board." }
      : { title: card.type === "bug" ? `✅ Fixed${card.release ? ` in ${card.release}` : ""}` : `🚀 Shipped${card.release ? ` in ${card.release}` : ""}`, text: card.release ? `Update HEISS UI to **${plain(card.release)}** or newer to get it.` : "It's in the next release." },
  closed: () => ({ title: "🔒 Closed", text: "Closed on the board. The thread stays here for the record." }),
  open: () => ({ title: "🟣 Reopened", text: "Back open on the board." }),
};

/** One thing that happened to a post, as a message: inside its thread, or (`inline`) in a text channel. */
export function newsMessage(event, { inline = false } = {}) {
  const { card } = event;
  const type = TYPE[card.type] || TYPE.idea;
  const lead = inline ? `${type.emoji} ${link(card)}\n` : "";
  let embed;
  if (event.type === "created") {
    embed = {
      author: { name: `New ${type.name.toLowerCase()} · ${cut(card.name || "Anonymous", 40)}${card.source === "app" ? " · from the app" : ""}` },
      title: cut(card.title, 256),
      url: cardUrl(card.id),
      color: type.color,
      description: quote(card.body, 300, 4) || undefined,
    };
  } else if (event.type === "status") {
    const news = STATUS_NEWS[card.status]?.(card) || STATUS_NEWS.open(card);
    embed = { title: news.title, url: inline ? undefined : cardUrl(card.id), color: STATUS[card.status]?.color || BRAND, description: `${lead}${news.text}` };
  } else if (event.type === "released") {
    embed = { title: `🚀 Shipped in ${cut(card.release, 40)}`, color: STATUS.done.color, description: `${lead}Update HEISS UI to **${plain(card.release)}** or newer to get it.` };
  } else if (event.type === "commented") {
    const { comment } = event;
    embed = comment.admin
      ? { author: { name: `💬 ${cut(comment.name || "Maintainer", 40)} answered` }, color: BRAND, description: `${lead}${quote(comment.body, inline ? 700 : 1800, inline ? 10 : 30)}` }
      : { author: { name: `💬 ${cut(comment.name || "Someone", 40)} commented` }, color: 0x3a3d47, description: `${lead}${quote(comment.body, 500, 8)}` };
  } else if (event.type === "milestone") {
    embed = { title: `🔥 ${event.votes} upvotes`, color: 0xff6b4a, description: `${lead}${event.votes} people want this${card.type === "bug" ? " fixed" : ""}.` };
  } else if (event.type === "deleted") {
    embed = { title: "🗑️ Removed from the board", color: STATUS.closed.color, description: "This post was taken down, so nothing more will show up here." };
  }
  if (!embed) return null;
  return {
    embeds: [embed],
    components: event.type === "deleted" ? undefined : buttons([event.type === "commented" ? "Reply on the board" : "Open on the board", cardUrl(card.id)]),
    allowed_mentions: { parse: [] },
  };
}

/** Forum tag ids per type, from "bug=123,idea=456,question=789". */
export function parseTags(text) {
  const tags = {};
  for (const part of String(text || "").split(/[,\s]+/)) {
    const [name, value] = part.split("=");
    if (TYPE[name] && /^\d{5,25}$/.test(value || "")) tags[name] = value;
  }
  return tags;
}

/* ── The sync ───────────────────────────────────────────────────────── */

class DiscordError extends Error {
  constructor(status, body) {
    super(`Discord answered ${status}${body?.message ? `: ${body.message}` : ""}`);
    this.status = status;
    this.code = body?.code;
  }
}

export function createDiscordSync({ store, roadmapWebhookUrl, feedWebhookUrl, forumTags = "", fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const roadmapHook = WEBHOOK_URL.test(roadmapWebhookUrl || "") ? roadmapWebhookUrl : "";
  const feedHook = WEBHOOK_URL.test(feedWebhookUrl || "") ? feedWebhookUrl : "";
  const tags = parseTags(forumTags);
  let queue = Promise.resolve();
  const enqueue = (operation) => (queue = queue.then(operation, operation));

  /** One webhook call; waits out a short rate limit once, and drops link buttons if Discord won't take them. */
  async function call(method, url, body, { retry = true } = {}) {
    const response = await fetchImpl(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 429 && retry) {
      const wait = Number((await response.json().catch(() => ({}))).retry_after) || 1;
      if (wait <= 5) {
        await sleep(wait * 1000);
        return call(method, url, body, { retry: false });
      }
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.ok) return data;
    if (response.status === 400 && body?.components && retry && /component/i.test(JSON.stringify(data || ""))) {
      const { components, ...rest } = body;
      return call(method, url, rest, { retry: false });
    }
    throw new DiscordError(response.status, data);
  }
  const query = (base, params) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== ""));
    return `${base}?${search}`;
  };

  /* Roadmap */

  async function syncRoadmap() {
    if (!roadmapHook) return;
    try {
      const { cards } = await store.list("");
      const body = roadmapMessage(cards, now());
      const messageId = await store.getIntegrationValue(KEY.roadmap);
      let done = false;
      if (messageId) {
        try {
          await call("PATCH", query(`${roadmapHook}/messages/${encodeURIComponent(messageId)}`, { with_components: "true" }), body);
          done = true;
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
      if (!done) {
        const message = await call("POST", query(roadmapHook, { wait: "true", with_components: "true" }), body);
        await store.setIntegrationValue(KEY.roadmap, message.id);
      }
      await store.setIntegrationValue(KEY.dirty, "0");
      await store.setIntegrationValue(KEY.syncedAt, String(now()));
    } catch (error) {
      await store.setIntegrationValue(KEY.dirty, "1").catch(() => {});
      console.error("Discord roadmap sync failed:", error?.message || error);
    }
  }

  /* Feed */

  const threadOf = async (cardId) => {
    const value = await store.getIntegrationValue(KEY.thread(cardId));
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  };

  async function feedMode() {
    return (await store.getIntegrationValue(KEY.mode)) || "forum";
  }

  /** A forum thread for this post, made now if it doesn't have one yet. Null in a text channel. */
  async function ensureThread(card) {
    const known = await threadOf(card.id);
    if (known) return known;
    if ((await feedMode()) !== "forum") return null;
    try {
      const message = await call("POST", query(feedHook, { wait: "true", with_components: "true" }), {
        ...cardMessage(card),
        thread_name: threadName(card),
        applied_tags: tags[card.type] ? [tags[card.type]] : undefined,
      });
      const thread = { thread: message.channel_id, message: message.id };
      await store.setIntegrationValue(KEY.thread(card.id), JSON.stringify(thread));
      return thread;
    } catch (error) {
      // 220003: webhooks only make threads in forum channels, so this one is a text channel.
      if (error.code === 220003) {
        await store.setIntegrationValue(KEY.mode, "text");
        return null;
      }
      throw error;
    }
  }

  async function postInline(message) {
    try {
      await call("POST", feedHook, message);
    } catch (error) {
      // 220001: a forum channel wants a thread; switch and let the next event make one.
      if (error.code === 220001) await store.setIntegrationValue(KEY.mode, "forum");
      else throw error;
    }
  }

  /** Posts one piece of news: into the post's thread in a forum, or as a line in a text channel. */
  async function announce(event, { textChannel = true } = {}) {
    const thread = await ensureThread(event.card);
    if (thread) {
      const message = newsMessage(event);
      if (message) await call("POST", query(feedHook, { thread_id: thread.thread, with_components: "true" }), message);
      return thread;
    }
    if (textChannel && (await feedMode()) === "text") {
      const message = newsMessage(event, { inline: true });
      if (message) await postInline(message);
    }
    return null;
  }

  async function refreshStarter(card) {
    const thread = await threadOf(card.id);
    if (!thread) return;
    await call("PATCH", query(`${feedHook}/messages/${thread.message}`, { thread_id: thread.thread, with_components: "true" }), cardMessage(card));
  }

  async function feed(event) {
    if (!feedHook) return;
    try {
      switch (event.type) {
        case "created": {
          const made = await ensureThread(event.card);
          if (!made && (await feedMode()) === "text") await postInline(newsMessage(event, { inline: true }));
          break;
        }
        case "updated": {
          const { before, card } = event;
          if (before.status !== card.status) await announce({ type: "status", card });
          else if (card.status === "done" && card.release && card.release !== before.release) await announce({ type: "released", card });
          await refreshStarter(card);
          break;
        }
        case "commented":
          // Community chatter stays in the post's thread; a text channel only hears the maintainer's answers.
          await announce(event, { textChannel: event.comment.admin });
          break;
        case "voted": {
          const reached = [...MILESTONES].reverse().find((mark) => event.votes >= mark);
          if (!event.on || !reached || event.votes !== reached) {
            if ((await threadOf(event.card.id)) && event.votes % 5 === 0) await refreshStarter({ ...event.card, votes: event.votes });
            break;
          }
          if (Number(await store.getIntegrationValue(KEY.milestone(event.card.id))) >= reached) break;
          await store.setIntegrationValue(KEY.milestone(event.card.id), String(reached));
          const card = { ...event.card, votes: event.votes };
          await announce({ type: "milestone", card, votes: reached });
          await refreshStarter(card);
          break;
        }
        case "deleted": {
          const thread = await threadOf(event.card.id);
          if (thread) await call("POST", query(feedHook, { thread_id: thread.thread }), newsMessage(event));
          break;
        }
      }
    } catch (error) {
      console.error(`Discord feed (${event.type}) failed:`, error?.message || error);
    }
  }

  return {
    enabled: Boolean(roadmapHook || feedHook),

    /** One board event: the feed hears about it, and the roadmap follows (votes only mark it stale). */
    event(event) {
      return enqueue(async () => {
        await feed(event);
        if (!roadmapHook) return;
        if (event.type === "voted" || event.type === "commented") await store.setIntegrationValue(KEY.dirty, "1").catch(() => {});
        else await syncRoadmap();
      });
    },

    /** On page loads: brings a stale roadmap up to date, at most once a minute. */
    ensure() {
      if (!roadmapHook) return Promise.resolve();
      return enqueue(async () => {
        const [messageId, dirty, syncedAt] = await Promise.all([store.getIntegrationValue(KEY.roadmap), store.getIntegrationValue(KEY.dirty), store.getIntegrationValue(KEY.syncedAt)]);
        if (!messageId || (dirty === "1" && now() - (Number(syncedAt) || 0) > ROADMAP_COOLDOWN)) await syncRoadmap();
      });
    },

    /** Where to follow a post on Discord, when it has a thread there. */
    async links(cardId) {
      if (!feedHook) return {};
      try {
        const thread = await threadOf(cardId);
        if (!thread) return {};
        let guild = await store.getIntegrationValue(KEY.guild);
        if (!guild) {
          guild = (await call("GET", feedHook))?.guild_id || "";
          if (guild) await store.setIntegrationValue(KEY.guild, guild);
        }
        return guild ? { discord: `https://discord.com/channels/${guild}/${thread.thread}` } : {};
      } catch (error) {
        console.error("Discord thread link failed:", error?.message || error);
        return {};
      }
    },
  };
}
