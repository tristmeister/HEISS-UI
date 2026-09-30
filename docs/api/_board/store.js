/**
 * Where the feedback board keeps its cards: Upstash Redis over its REST API
 * (what Vercel's Redis integration sets up), or memory for local previews and
 * tests. Both answer the same calls with the same shapes.
 *
 * Keys, under one prefix:
 *   cards            hash  id → card JSON
 *   votes            hash  id → vote count
 *   ccount           hash  id → comment count
 *   comments:<id>    list  comment JSON, oldest first
 *   voter:<voter>    set   ids this visitor upvoted
 *   rate:<key>       counter with a TTL
 */

const pairs = (flat) => {
  const out = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  else if (flat && typeof flat === "object") Object.assign(out, flat);
  return out;
};

const parse = (json) => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

/** Cards with their counts, oldest first; the page sorts. */
const assemble = (cardsHash, votesHash, commentsHash) =>
  Object.values(cardsHash)
    .map(parse)
    .filter(Boolean)
    .map((card) => ({ ...card, votes: Math.max(0, Number(votesHash[card.id]) || 0), comments: Math.max(0, Number(commentsHash[card.id]) || 0) }))
    .sort((a, b) => a.createdAt - b.createdAt);

export function redisStore({ url, token, prefix = "board:", fetchImpl = globalThis.fetch }) {
  const k = (key) => prefix + key;
  const base = url.replace(/\/+$/, "");

  const pipeline = async (commands) => {
    const response = await fetchImpl(`${base}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`Redis answered ${response.status}`);
    const results = await response.json();
    return results.map((item) => {
      if (item?.error) throw new Error(`Redis: ${item.error}`);
      return item?.result;
    });
  };

  return {
    kind: "redis",

    async list(voter) {
      const [cards, votes, comments, voted] = await pipeline([
        ["HGETALL", k("cards")],
        ["HGETALL", k("votes")],
        ["HGETALL", k("ccount")],
        voter ? ["SMEMBERS", k(`voter:${voter}`)] : ["ECHO", "[]"],
      ]);
      return { cards: assemble(pairs(cards), pairs(votes), pairs(comments)), voted: Array.isArray(voted) ? voted : [] };
    },

    async get(id, voter) {
      const [card, votes, comments, voted] = await pipeline([
        ["HGET", k("cards"), id],
        ["HGET", k("votes"), id],
        ["LRANGE", k(`comments:${id}`), "0", "-1"],
        voter ? ["SISMEMBER", k(`voter:${voter}`), id] : ["ECHO", "0"],
      ]);
      const parsed = card ? parse(card) : null;
      if (!parsed) return null;
      const list = (comments || []).map(parse).filter(Boolean);
      return { card: { ...parsed, votes: Math.max(0, Number(votes) || 0), comments: list.length }, comments: list, voted: Number(voted) === 1 };
    },

    async create(card) {
      await pipeline([["HSET", k("cards"), card.id, JSON.stringify(card)]]);
      return card;
    },

    async save(card) {
      await pipeline([["HSET", k("cards"), card.id, JSON.stringify(card)]]);
      return card;
    },

    async raw(id) {
      const [card] = await pipeline([["HGET", k("cards"), id]]);
      return card ? parse(card) : null;
    },

    async rawMany(ids) {
      if (!ids.length) return [];
      const [cards] = await pipeline([["HMGET", k("cards"), ...ids]]);
      return (cards || []).map((card) => (card ? parse(card) : null));
    },

    async saveMany(cards) {
      if (!cards.length) return;
      await pipeline([["HSET", k("cards"), ...cards.flatMap((card) => [card.id, JSON.stringify(card)])]]);
    },

    async remove(id) {
      await pipeline([
        ["HDEL", k("cards"), id],
        ["HDEL", k("votes"), id],
        ["HDEL", k("ccount"), id],
        ["DEL", k(`comments:${id}`)],
      ]);
    },

    /** Turns this visitor's vote on or off; returns the new count. */
    async vote(id, voter, on) {
      const [changed] = await pipeline([[on ? "SADD" : "SREM", k(`voter:${voter}`), id]]);
      if (Number(changed) !== 1) {
        const [count] = await pipeline([["HGET", k("votes"), id]]);
        return Math.max(0, Number(count) || 0);
      }
      const [count] = await pipeline([["HINCRBY", k("votes"), id, on ? "1" : "-1"]]);
      return Math.max(0, Number(count) || 0);
    },

    async addComment(id, comment) {
      const [, count] = await pipeline([
        ["RPUSH", k(`comments:${id}`), JSON.stringify(comment)],
        ["HINCRBY", k("ccount"), id, "1"],
      ]);
      return Number(count) || 0;
    },

    async removeComment(id, commentId) {
      const [items] = await pipeline([["LRANGE", k(`comments:${id}`), "0", "-1"]]);
      const match = (items || []).find((item) => parse(item)?.id === commentId);
      if (!match) return false;
      await pipeline([
        ["LREM", k(`comments:${id}`), "1", match],
        ["HINCRBY", k("ccount"), id, "-1"],
      ]);
      return true;
    },

    /** Counts one hit against `key`; false once it has seen more than `limit` in the window. */
    async hit(key, limit, seconds) {
      // Starts the window only when there is none, then counts.
      const [, count] = await pipeline([
        ["SET", k(`rate:${key}`), "0", "EX", String(seconds), "NX"],
        ["INCR", k(`rate:${key}`)],
      ]);
      return Number(count) <= limit;
    },
  };
}

export function memoryStore() {
  const cards = new Map();
  const votes = new Map();
  const comments = new Map();
  const voters = new Map();
  const rates = new Map();
  const copy = (value) => (value == null ? value : structuredClone(value));

  return {
    kind: "memory",

    async list(voter) {
      const counts = Object.fromEntries([...comments].map(([id, list]) => [id, list.length]));
      return {
        cards: assemble(Object.fromEntries([...cards].map(([id, card]) => [id, JSON.stringify(card)])), Object.fromEntries(votes), counts),
        voted: [...(voters.get(voter) || [])],
      };
    },

    async get(id, voter) {
      const card = cards.get(id);
      if (!card) return null;
      const list = copy(comments.get(id) || []);
      return { card: { ...copy(card), votes: votes.get(id) || 0, comments: list.length }, comments: list, voted: Boolean(voters.get(voter)?.has(id)) };
    },

    async create(card) {
      cards.set(card.id, copy(card));
      return card;
    },
    async save(card) {
      cards.set(card.id, copy(card));
      return card;
    },
    async raw(id) {
      return copy(cards.get(id) || null);
    },
    async rawMany(ids) {
      return ids.map((id) => copy(cards.get(id) || null));
    },
    async saveMany(list) {
      for (const card of list) cards.set(card.id, copy(card));
    },

    async remove(id) {
      cards.delete(id);
      votes.delete(id);
      comments.delete(id);
    },

    async vote(id, voter, on) {
      const set = voters.get(voter) || new Set();
      voters.set(voter, set);
      const had = set.has(id);
      if (on && !had) {
        set.add(id);
        votes.set(id, (votes.get(id) || 0) + 1);
      } else if (!on && had) {
        set.delete(id);
        votes.set(id, Math.max(0, (votes.get(id) || 0) - 1));
      }
      return votes.get(id) || 0;
    },

    async addComment(id, comment) {
      const list = comments.get(id) || [];
      list.push(copy(comment));
      comments.set(id, list);
      return list.length;
    },

    async removeComment(id, commentId) {
      const list = comments.get(id) || [];
      const index = list.findIndex((item) => item.id === commentId);
      if (index < 0) return false;
      list.splice(index, 1);
      return true;
    },

    async hit(key, limit, seconds, now = Date.now()) {
      const entry = rates.get(key);
      if (!entry || entry.until <= now) {
        rates.set(key, { count: 1, until: now + seconds * 1000 });
        return 1 <= limit;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
  };
}

/**
 * The store the environment asks for: Redis when its REST address and token
 * are set, memory for a local preview, and none on Vercel without Redis (the
 * board says it isn't set up rather than forgetting posts between requests).
 */
export function storeFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore({ url, token, prefix: env.BOARD_PREFIX || "board:" });
  if (env.VERCEL) return null;
  return memoryStore();
}
