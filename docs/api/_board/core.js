import crypto from "node:crypto";

/**
 * The feedback board's API, as one function from a Request to a Response so
 * it runs the same on Vercel, in a local preview and in tests.
 *
 * Anyone can post, upvote and comment, no account: a random cookie tells one
 * visitor's votes apart, and rate limits per (hashed) address keep it calm.
 * Moving, editing and deleting take the admin password, which signs a
 * session cookie.
 */

export const TYPES = ["bug", "idea", "question"];
export const STATUSES = ["open", "planned", "progress", "done", "closed"];

export const LIMITS = {
  title: 120,
  body: 4000,
  name: 40,
  setup: 3000,
  comment: 2000,
  release: 24,
  version: 40,
  bodyBytes: 24_000,
};

const VOTER = "hb_voter";
const ADMIN = "hb_admin";
const SESSION_DAYS = 30;

const RATES = {
  create: [6, 60 * 60],
  comment: [20, 60 * 60],
  vote: [150, 60 * 60],
  login: [8, 15 * 60],
};

class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Plain text, one line or many: no control characters, no runs of blank lines, trimmed and capped. */
export function clean(value, max, { multiline = false } = {}) {
  let text = String(value ?? "").normalize("NFC");
  text = multiline ? text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "") : text.replace(/[\u0000-\u001f\u007f]+/g, " ");
  text = multiline ? text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n") : text.replace(/\s{2,}/g, " ");
  text = text.trim();
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

const id = () => crypto.randomBytes(6).toString("base64url");

const cookies = (request) =>
  Object.fromEntries(
    (request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, decodeURIComponent(value.join("="))])
  );

const cookie = (request, name, value, { maxAge, strict = false, path = "/" }) => {
  const secure = new URL(request.url).protocol === "https:";
  return [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${maxAge}`, "HttpOnly", `SameSite=${strict ? "Strict" : "Lax"}`, secure ? "Secure" : ""].filter(Boolean).join("; ");
};

const addressOf = (request) => (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";

/** Rate limit keys never keep an address, only a salted hash of it. */
const rateKey = (request, action, salt) => `${action}:${crypto.createHash("sha256").update(`${salt}:${addressOf(request)}`).digest("base64url").slice(0, 22)}`;

const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
};

/* ── Admin sessions ─────────────────────────────────────────────────── */

const secretOf = (env) => env.BOARD_SESSION_SECRET || (env.BOARD_ADMIN_PASSWORD ? crypto.createHash("sha256").update(`heiss-board:${env.BOARD_ADMIN_PASSWORD}`).digest("hex") : "");

const sign = (secret, text) => crypto.createHmac("sha256", secret).update(text).digest("base64url");

export function sessionToken(env, now = Date.now()) {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `v1.${exp}.${sign(secretOf(env), exp)}`;
}

export function validSession(env, token, now = Date.now()) {
  const secret = secretOf(env);
  const [version, exp, mac] = String(token || "").split(".");
  if (!secret || version !== "v1" || !exp || !mac || !(Number(exp) > now)) return false;
  const expected = Buffer.from(sign(secret, exp));
  const given = Buffer.from(mac);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const passwordMatches = (env, password) => {
  if (!env.BOARD_ADMIN_PASSWORD) return false;
  const a = crypto.createHash("sha256").update(String(env.BOARD_ADMIN_PASSWORD)).digest();
  const b = crypto.createHash("sha256").update(String(password ?? "")).digest();
  return crypto.timingSafeEqual(a, b);
};

/* ── Cards ──────────────────────────────────────────────────────────── */

/** A new card from what a visitor sent, or a Problem saying what's wrong with it. */
export function newCard(input, now = Date.now()) {
  const type = TYPES.includes(input.type) ? input.type : null;
  if (!type) throw new Problem(400, "Pick bug, idea or question.");
  const title = clean(input.title, LIMITS.title);
  if (title.length < 4) throw new Problem(400, "Give it a title of a few words.");
  return {
    id: id(),
    type,
    status: "open",
    title,
    body: clean(input.body, LIMITS.body, { multiline: true }),
    name: clean(input.name, LIMITS.name),
    setup: clean(input.setup, LIMITS.setup, { multiline: true }),
    source: input.source === "app" ? "app" : "web",
    appVersion: clean(input.appVersion, LIMITS.version),
    release: "",
    pos: null,
    createdAt: now,
    updatedAt: now,
    statusAt: now,
  };
}

/** What an admin may change on a card. */
export function applyPatch(card, patch, now = Date.now()) {
  const next = { ...card };
  if (patch.type !== undefined) {
    if (!TYPES.includes(patch.type)) throw new Problem(400, "Unknown column.");
    if (patch.type !== card.type) next.pos = null;
    next.type = patch.type;
  }
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new Problem(400, "Unknown status.");
    if (patch.status !== card.status) next.statusAt = now;
    next.status = patch.status;
  }
  if (patch.title !== undefined) {
    const title = clean(patch.title, LIMITS.title);
    if (title.length < 2) throw new Problem(400, "A title can’t be empty.");
    next.title = title;
  }
  if (patch.body !== undefined) next.body = clean(patch.body, LIMITS.body, { multiline: true });
  if (patch.release !== undefined) next.release = clean(patch.release, LIMITS.release);
  next.updatedAt = now;
  return next;
}

/* ── Handler ────────────────────────────────────────────────────────── */

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });

async function readBody(request) {
  const text = await request.text();
  if (text.length > LIMITS.bodyBytes) throw new Problem(413, "That’s too long to send.");
  try {
    const body = JSON.parse(text || "{}");
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new Problem(400, "That didn’t arrive as JSON.");
  }
}

/**
 * Handles one request. `store` is from store.js (null when the board isn't
 * set up), `env` holds BOARD_ADMIN_PASSWORD and friends. `onEvent` hears what
 * changed (created, updated, commented, voted, arranged, deleted) and `links`
 * adds places to follow a post elsewhere; neither can fail a request.
 */
export async function handle(request, { store, env = {}, now = () => Date.now(), onEvent = null, links = null } = {}) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" },
    });
  }
  if (!store) return json(503, { ok: false, ready: false, error: "The board isn’t set up yet." });

  const jar = cookies(request);
  const admin = validSession(env, jar[ADMIN], now());
  let voter = /^[\w-]{16,40}$/.test(jar[VOTER] || "") ? jar[VOTER] : "";
  const setCookies = [];
  const needVoter = () => {
    if (!voter) {
      voter = crypto.randomBytes(16).toString("base64url");
      setCookies.push(cookie(request, VOTER, voter, { maxAge: 400 * 86_400 }));
    }
    return voter;
  };
  const reply = (status, body) => {
    const response = json(status, body);
    for (const line of setCookies) response.headers.append("set-cookie", line);
    return response;
  };
  const salt = env.BOARD_SESSION_SECRET || env.BOARD_ADMIN_PASSWORD || "heiss-board";
  const limit = async (action) => {
    const [max, seconds] = RATES[action];
    if (!(await store.hit(rateKey(request, action, salt), max, seconds))) throw new Problem(429, "That’s a lot at once. Try again in a while.");
  };
  const emit = async (event) => {
    try {
      await onEvent?.(event);
    } catch (error) {
      console.error(`board: ${event.type} listener failed:`, error?.message || error);
    }
  };
  const needAdmin = () => {
    if (!admin) throw new Problem(401, "Sign in as admin first.");
    if (!sameOrigin(request)) throw new Problem(403, "Not from this page.");
  };

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const cardId = url.searchParams.get("id");
      if (cardId) {
        const found = await store.get(cardId, voter);
        if (!found) throw new Problem(404, "That post is gone.");
        const elsewhere = links ? await Promise.resolve(links(cardId)).catch(() => ({})) : {};
        return reply(200, { ok: true, admin, ...found, links: elsewhere || {} });
      }
      const { cards, voted } = await store.list(voter);
      if (url.searchParams.get("view") === "summary") {
        const active = cards.filter((card) => !["done", "closed"].includes(card.status));
        const count = (type) => active.filter((card) => card.type === type).length;
        return reply(200, {
          ok: true,
          counts: { bug: count("bug"), idea: count("idea"), question: count("question"), done: cards.length - active.length },
          progress: active
            .filter((card) => card.status === "progress")
            .sort((a, b) => b.statusAt - a.statusAt)
            .slice(0, 3)
            .map(({ id, type, title }) => ({ id, type, title })),
        });
      }
      const live = new Set(cards.map((card) => card.id));
      return reply(200, { ok: true, admin, cards, voted: voted.filter((cardId) => live.has(cardId)) });
    }

    if (request.method !== "POST") throw new Problem(405, "Not here.");
    const body = await readBody(request);

    switch (body.action) {
      case "create": {
        // A filled honeypot is a bot: say thanks, keep nothing.
        if (body.website) return reply(200, { ok: true, card: null });
        await limit("create");
        const card = newCard(body, now());
        await store.create(card);
        // Posting from the board counts as the author's upvote; the app has no board cookie.
        let votes = 0;
        if (card.source === "web" && sameOrigin(request)) votes = await store.vote(card.id, needVoter(), true);
        await emit({ type: "created", card: { ...card, votes, comments: 0 } });
        return reply(201, { ok: true, card: { ...card, votes, comments: 0 } });
      }

      case "vote": {
        if (!sameOrigin(request)) throw new Problem(403, "Not from this page.");
        const card = await store.raw(String(body.id || ""));
        if (!card) throw new Problem(404, "That post is gone.");
        await limit("vote");
        const votes = await store.vote(card.id, needVoter(), body.on !== false);
        await emit({ type: "voted", card, votes, on: body.on !== false });
        return reply(200, { ok: true, id: card.id, votes, voted: body.on !== false });
      }

      case "comment": {
        if (!sameOrigin(request)) throw new Problem(403, "Not from this page.");
        if (body.website) return reply(200, { ok: true, comment: null });
        const card = await store.raw(String(body.id || ""));
        if (!card) throw new Problem(404, "That post is gone.");
        const text = clean(body.body, LIMITS.comment, { multiline: true });
        if (!text) throw new Problem(400, "Write something first.");
        if (!admin) await limit("comment");
        const comment = {
          id: id(),
          body: text,
          name: admin ? clean(env.BOARD_ADMIN_NAME || "Maintainer", LIMITS.name) : clean(body.name, LIMITS.name),
          admin,
          createdAt: now(),
        };
        needVoter();
        const count = await store.addComment(card.id, comment);
        await emit({ type: "commented", card, comment });
        return reply(201, { ok: true, comment, comments: count });
      }

      case "login": {
        if (!sameOrigin(request)) throw new Problem(403, "Not from this page.");
        if (!env.BOARD_ADMIN_PASSWORD) throw new Problem(503, "Set BOARD_ADMIN_PASSWORD first.");
        await limit("login");
        if (!passwordMatches(env, body.password)) throw new Problem(401, "That’s not the password.");
        setCookies.push(cookie(request, ADMIN, sessionToken(env, now()), { maxAge: SESSION_DAYS * 86_400, strict: true }));
        return reply(200, { ok: true, admin: true });
      }

      case "logout": {
        setCookies.push(cookie(request, ADMIN, "", { maxAge: 0, strict: true }));
        return reply(200, { ok: true, admin: false });
      }

      case "update": {
        needAdmin();
        const card = await store.raw(String(body.id || ""));
        if (!card) throw new Problem(404, "That post is gone.");
        const next = applyPatch(card, body.patch || {}, now());
        await store.save(next);
        await emit({ type: "updated", before: card, card: next });
        return reply(200, { ok: true, card: next });
      }

      case "arrange": {
        // One column in its new order, after a drag: the cards take this column and these positions.
        needAdmin();
        if (!TYPES.includes(body.type)) throw new Problem(400, "Unknown column.");
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))].slice(0, 500);
        const found = (await store.rawMany(ids)).filter(Boolean);
        const at = now();
        const order = new Map(ids.map((cardId, index) => [cardId, index]));
        const moved = found.map((card) => ({ ...card, type: body.type, pos: order.get(card.id), updatedAt: card.type === body.type ? card.updatedAt : at }));
        await store.saveMany(moved);
        await emit({ type: "arranged", cards: moved });
        return reply(200, { ok: true, cards: moved.map(({ id, type, pos }) => ({ id, type, pos })) });
      }

      case "delete": {
        needAdmin();
        const card = await store.raw(String(body.id || ""));
        await store.remove(String(body.id || ""));
        if (card) await emit({ type: "deleted", card });
        return reply(200, { ok: true });
      }

      case "deleteComment": {
        needAdmin();
        const removed = await store.removeComment(String(body.id || ""), String(body.commentId || ""));
        if (!removed) throw new Problem(404, "That comment is gone.");
        return reply(200, { ok: true });
      }

      default:
        throw new Problem(400, "Unknown action.");
    }
  } catch (error) {
    if (error instanceof Problem) return reply(error.status, { ok: false, error: error.message });
    console.error("board:", error);
    return reply(500, { ok: false, error: "The board couldn’t do that just now. Try again in a moment." });
  }
}
