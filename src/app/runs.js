// How the gallery groups itself: into moments (stretches of time you spent
// making things) and, inside each moment, into runs (the takes and variations
// of one idea). Plain JavaScript so `node --test` can check it without a build
// step; the types live beside it in runs.d.ts.
//
// Nothing here is stored. Grouping is a way of looking at the gallery, worked
// out afresh from what is loaded, so it can never strand an image or need
// tidying up, and switching it off leaves the gallery exactly as it was.
//
// Moments: a gap of more than MOMENT_GAP between two outputs starts a new one.
// An evening that runs into the small hours stays one evening; a morning and
// an evening on the same day are two.
//
// Runs: every output is scored against the last few members of the runs still
// open, and joins the best one that scores at least RUN_THRESHOLD. A run stays
// open until RUN_GAP passes without a new member: coming back to a prompt the
// next day starts a new run, even with the very same words.
// Comparing with recent members rather than the first means a prompt that is
// tweaked a little at a time (another film, another setting) stays one run,
// however far it ends up from where it started. The score is mostly the
// prompt: words weighted by how rare they are in this gallery, so shared
// boilerplate ("masterpiece, 8k, film still") counts for little and the
// subject for a lot. The model nudges it up or down; LoRAs barely do, since a
// stack often stays loaded while the subject changes.

/** A pause longer than this between two outputs starts a new moment. */
export const MOMENT_GAP_MS = 3 * 60 * 60 * 1000;
/** A run with nothing new for longer than this is closed; the same prompt later starts another. */
export const RUN_GAP_MS = 6 * 60 * 60 * 1000;
/** Two outputs this similar or more belong to one run. */
export const RUN_THRESHOLD = 0.55;
/** A run stacks once it has this many finished outputs. */
export const MIN_STACK = 3;
/** How many open runs, and how many of each one's latest members, a new output is compared with. */
const OPEN_RUNS = 8;
const RECENT_MEMBERS = 4;

const STOP_WORDS = new Set(("a an the of and or in on at to for by with from into onto over under is are be as it its "
  + "this that these those her his their our my your very some any while who which what where when there here "
  + "has have had was were been being than then so such just").split(" "));

function timeOf(item) {
  const value = Date.parse(item?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

/** The words that carry a prompt: lowercased, LoRA tags and weights gone, plurals folded. */
export function promptWords(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/:\s*-?\d+(\.\d+)?/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ");
  const out = new Set();
  for (const word of words) {
    if (word.length < 2 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue;
    out.add(word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
  }
  return out;
}

function loraNames(item) {
  const loras = item?.settings?.loras;
  if (!Array.isArray(loras)) return [];
  return loras.filter((lora) => lora && lora.enabled !== false && lora.name).map((lora) => String(lora.name).toLowerCase());
}

function overlap(a, b) {
  if (!a.length && !b.length) return 1;
  const set = new Set(a);
  const shared = b.filter((name) => set.has(name)).length;
  return shared / new Set([...a, ...b]).size;
}

/**
 * Word weights for one gallery: how rare each word is across its distinct
 * prompts. A word in almost every prompt weighs little; a subject weighs a lot.
 * With only a handful of prompts there is nothing to learn yet, so all weigh 1.
 */
export function wordWeights(items) {
  const seen = new Set();
  const counts = new Map();
  let prompts = 0;
  for (const item of items) {
    const key = String(item?.prompt || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    prompts += 1;
    for (const word of promptWords(key)) counts.set(word, (counts.get(word) || 0) + 1);
  }
  const weights = new Map();
  if (prompts < 8) return { weightOf: () => 1 };
  const ceiling = Math.log(1 + prompts);
  for (const [word, count] of counts) weights.set(word, 0.15 + 0.85 * Math.log(1 + prompts / count) / ceiling);
  return { weightOf: (word) => weights.get(word) ?? 1 };
}

/**
 * How alike two prompts are, 0 to 1: half weighted Jaccard (how much of all
 * their words they share), half weighted overlap (how much of the shorter one
 * the longer contains), so adding a clause to a prompt keeps it close.
 */
export function promptSimilarity(a, b, weightOf = () => 1) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  let sumA = 0;
  let sumB = 0;
  for (const word of a) {
    const weight = weightOf(word);
    sumA += weight;
    if (b.has(word)) shared += weight;
  }
  for (const word of b) sumB += weightOf(word);
  const union = sumA + sumB - shared;
  if (union <= 0) return 0;
  return 0.5 * (shared / union) + 0.5 * (shared / Math.min(sumA, sumB));
}

/** How strongly two outputs belong to one run. Same job is certain; the rest is mostly the prompt. */
export function runScore(a, b, weightOf = () => 1) {
  if (a.item.jobId && a.item.jobId === b.item.jobId) return 1;
  if (!a.words.size || !b.words.size) return 0;
  if ((a.item.type || "image") !== (b.item.type || "image")) return 0;
  let score = a.prompt === b.prompt ? 0.9 : promptSimilarity(a.words, b.words, weightOf);
  if (a.item.model && b.item.model) score += a.item.model === b.item.model ? 0.06 : -0.12;
  if (a.loras.length || b.loras.length) score += 0.04 * (overlap(a.loras, b.loras) - 0.5);
  return score;
}

/* --------------------------------------------------------------- Moments */

function dayStart(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Morning, afternoon, evening or night, and the day it belongs to: the small hours count to the evening before. */
function daypart(time) {
  const hour = new Date(time).getHours();
  if (hour < 5) return { part: "night", day: dayStart(time - 6 * 60 * 60 * 1000) };
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";
  return { part, day: dayStart(time) };
}

const PART_LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

/**
 * A moment's name, the way you'd say it: "This evening", "Last night",
 * "Monday night", "Sun, Sep 28". A moment spanning most of a day
 * is named for the day alone.
 */
export function momentTitle(start, end, now = Date.now()) {
  const { part, day } = daypart(start);
  const today = daypart(now).day;
  const days = Math.round((today - day) / 86_400_000);
  const allDay = end - start > 8 * 60 * 60 * 1000;
  if (days <= 0) {
    if (allDay) return { title: "Today", part: "" };
    return { title: part === "night" ? "Tonight" : `This ${part}`, part: "" };
  }
  if (days === 1) return { title: allDay ? "Yesterday" : part === "night" ? "Last night" : `Yesterday ${part}`, part: "" };
  const date = new Date(day);
  if (days < 7) {
    const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
    return { title: allDay ? weekday : `${weekday} ${part}`, part: "" };
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const title = date.toLocaleDateString(undefined, sameYear ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return { title, part: allDay ? "" : PART_LABEL[part] };
}

/* ------------------------------------------------------------- Grouping */

/**
 * Groups a newest-first gallery. Returns its moments (each with its items,
 * still newest first) and its runs, with a lookup from an output to its run. Only runs with MIN_STACK finished outputs are returned;
 * smaller ones are just images.
 */
export function groupGallery(items, { now = Date.now(), runs: findRuns = true } = {}) {
  const runOf = new Map();
  const runList = [];
  const moments = [];
  let current = null;
  let previousTime = 0;
  for (const item of items) {
    const time = timeOf(item) || previousTime || now;
    // Newest first: a gap opens when this one is much older than the last.
    if (!current || (previousTime - time) > MOMENT_GAP_MS) {
      current = { items: [], start: time, end: time };
      moments.push(current);
    }
    current.items.push(item);
    current.start = Math.min(current.start, time);
    current.end = Math.max(current.end, time);
    previousTime = time;
  }

  const { weightOf } = findRuns ? wordWeights(items) : { weightOf: () => 1 };
  const prepared = new Map();
  const prepare = (item) => {
    let entry = prepared.get(item.prompt || "");
    if (!entry) {
      entry = { prompt: String(item.prompt || "").trim().toLowerCase(), words: item.promptProtected ? new Set() : promptWords(item.prompt) };
      prepared.set(item.prompt || "", entry);
    }
    return { item, time: timeOf(item), prompt: entry.prompt, words: entry.words, loras: loraNames(item) };
  };

  const result = moments.map((moment) => {
    const oldest = moment.items.at(-1);
    const id = `moment:${oldest?.id || moment.start}`;
    const { title, part } = momentTitle(moment.start, moment.end, now);
    return { id, title, part, start: moment.start, end: moment.end, items: moment.items };
  });
  if (!findRuns) return { moments: result, runs: runList, runOf };

  // Oldest first, across the whole gallery: a run isn't cut by a moment, only
  // by RUN_GAP without anything new.
  const momentOf = new Map();
  result.forEach((moment) => { for (const item of moment.items) momentOf.set(item.id, moment.id); });
  const open = [];
  const made = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.status !== "done" && item.status !== "pending") continue;
    const entry = prepare(item);
    for (let position = open.length - 1; position >= 0; position -= 1) {
      if (entry.time - open[position].last > RUN_GAP_MS) open.splice(position, 1);
    }
    let best = null;
    let bestScore = RUN_THRESHOLD;
    for (const run of open) {
      for (const member of run.recent) {
        const score = runScore(entry, member, weightOf);
        if (score >= bestScore) { best = run; bestScore = score; }
      }
    }
    if (!best) {
      best = { members: [], recent: [], last: entry.time };
      made.push(best);
      open.unshift(best);
      if (open.length > OPEN_RUNS) open.pop();
    } else {
      // The run just used moves to the front, so the busiest ideas stay open.
      open.splice(open.indexOf(best), 1);
      open.unshift(best);
    }
    best.members.push(item);
    best.recent.push(entry);
    best.last = Math.max(best.last, entry.time);
    if (best.recent.length > RECENT_MEMBERS) best.recent.shift();
  }
  for (const run of made) {
    const done = run.members.filter((item) => item.status === "done");
    if (done.length < MIN_STACK) continue;
    const newestFirst = run.members.slice().reverse();
    const prompts = new Set(newestFirst.map((item) => String(item.prompt || "").trim().toLowerCase()));
    const record = {
      id: `run:${run.members[0].id}`,
      momentId: momentOf.get(newestFirst[0].id) || "",
      items: newestFirst,
      count: done.length,
      live: newestFirst.some((item) => item.status === "pending"),
      cover: newestFirst.find((item) => item.status === "done"),
      variations: prompts.size,
      model: newestFirst.find((item) => item.model)?.model || "",
      type: newestFirst[0].type || "image",
      start: timeOf(run.members[0]),
      end: run.last,
    };
    runList.push(record);
    for (const item of newestFirst) runOf.set(item.id, record);
  }
  return { moments: result, runs: runList, runOf };
}

/** The line a run's stack leads with: the first clause of its newest prompt, without weights or tags. */
export function runTitle(run) {
  const prompt = String(run.cover?.prompt || run.items[0]?.prompt || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[()[\]{}]/g, "")
    .replace(/:\s*-?\d+(\.\d+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const clause = prompt.split(/[,.;|\n]/)[0].trim() || prompt;
  const text = clause.length > 64 ? `${clause.slice(0, 61).replace(/\s+\S*$/, "")}…` : clause;
  return text ? text[0].toUpperCase() + text.slice(1) : "Untitled run";
}
