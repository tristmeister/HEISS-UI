const WEBHOOK_URL = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/;
const MESSAGE_KEY = "discord:roadmap-message-id";
const DIRTY_KEY = "discord:roadmap-dirty";

const cardUrl = (id) => `https://heiss-ui.vercel.app/board/?id=${encodeURIComponent(id)}`;
const stateLabel = { planned: "Planned", progress: "In progress" };

function payload(cards) {
  const active = cards.filter((card) => !["done", "closed"].includes(card.status));
  const planned = active.filter((card) => card.status === "planned").slice(0, 5);
  const progress = active.filter((card) => card.status === "progress").slice(0, 5);
  const list = (items) => items.length
    ? items.map((card) => `• [${card.title.replace(/[\[\]]/g, "")}](<${cardUrl(card.id)}>)`).join("\n")
    : "Nothing here yet.";
  const description = [
    `**${active.length} active items** · ${active.filter((card) => card.type === "bug").length} bug reports · ${active.filter((card) => card.type === "idea").length} ideas`,
    "",
    `### ${stateLabel.planned} (${active.filter((card) => card.status === "planned").length})`,
    list(planned),
    "",
    `### ${stateLabel.progress} (${active.filter((card) => card.status === "progress").length})`,
    list(progress),
  ].join("\n");
  return {
    embeds: [{ title: "HEISS UI Roadmap", url: "https://heiss-ui.vercel.app/board/", description: description.slice(0, 4000), color: 0x6f7bf7, footer: { text: "Synced from the HEISS UI feedback board" } }],
    allowed_mentions: { parse: [] },
  };
}

export function createDiscordRoadmapSync({ store, webhookUrl, fetchImpl = globalThis.fetch }) {
  let queue = Promise.resolve();
  const enabled = WEBHOOK_URL.test(webhookUrl || "");
  const enqueue = (operation) => {
    queue = queue.then(operation, operation);
    return queue;
  };
  const markDirty = async (dirty) => store.setIntegrationValue(DIRTY_KEY, dirty ? "1" : "0");

  const update = (cards) => enqueue(async () => {
    if (!enabled) return;
    const body = payload(cards);
    const messageId = await store.getIntegrationValue(MESSAGE_KEY);
    try {
      if (messageId) {
        const response = await fetchImpl(`${webhookUrl}/messages/${encodeURIComponent(messageId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.ok) return markDirty(false);
        if (response.status !== 404) throw new Error(`Discord webhook answered ${response.status}`);
      }
      const response = await fetchImpl(`${webhookUrl}?wait=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Discord webhook answered ${response.status}`);
      const message = await response.json();
      await store.setIntegrationValue(MESSAGE_KEY, message.id);
      await markDirty(false);
    } catch (error) {
      await markDirty(true);
      console.error("Discord roadmap sync failed:", error?.message || error);
    }
  });

  return {
    update,
    async notify() {
      await markDirty(true);
      const { cards } = await store.list("");
      return update(cards);
    },
    async ensure() {
      if (!enabled) return;
      const messageId = await store.getIntegrationValue(MESSAGE_KEY);
      const dirty = await store.getIntegrationValue(DIRTY_KEY);
      if (!messageId || dirty === "1") {
        const { cards } = await store.list("");
        return update(cards);
      }
    },
  };
}
