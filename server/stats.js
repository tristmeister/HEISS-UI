// Numbers for the About page. Computed from the gallery record only: nothing is
// tracked beyond what HEISS UI already keeps about its own outputs.

const dayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const nextDay = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + 1));
};

export function galleryStats(items = [], now = new Date()) {
  const done = items.filter((item) => item?.status === "done");
  const days = new Map();
  const workflows = new Map();
  let renderMs = 0;
  let pixels = 0;
  let first = "";
  for (const item of done) {
    renderMs += Number(item.durationMs || item.elapsedMs) || 0;
    pixels += (Number(item.width) || 0) * (Number(item.height) || 0);
    const key = dayKey(item.createdAt);
    if (key) days.set(key, (days.get(key) || 0) + 1);
    if (item.createdAt && (!first || item.createdAt < first)) first = item.createdAt;
    const workflow = item.settings?.profileId || item.model || "";
    if (workflow) workflows.set(workflow, (workflows.get(workflow) || 0) + 1);
  }

  // Streaks count consecutive days with at least one finished output.
  const sorted = [...days.keys()].sort();
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const key of sorted) {
    run = previous && nextDay(previous) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  let current = 0;
  if (days.has(today) || days.has(yesterday)) {
    let cursor = days.has(today) ? today : yesterday;
    while (days.has(cursor)) {
      current += 1;
      const [y, m, d] = cursor.split("-").map(Number);
      cursor = dayKey(new Date(y, m - 1, d - 1));
    }
  }

  const [busiestDay = "", busiestCount = 0] = [...days.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const [topWorkflow = "", topWorkflowCount = 0] = [...workflows.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return {
    outputs: done.length,
    images: done.filter((item) => item.type !== "video").length,
    videos: done.filter((item) => item.type === "video").length,
    upscales: done.filter((item) => item.upscale?.url || item.upscale?.status === "done").length,
    renderMs,
    megapixels: Math.round(pixels / 1e6),
    firstAt: first,
    activeDays: days.size,
    currentStreak: current,
    longestStreak: longest,
    busiestDay,
    busiestCount,
    topWorkflow,
    topWorkflowCount
  };
}
