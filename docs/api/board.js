// The feedback board's API: /api/board. The page is /board/, the logic lives in ./_board/.
import { handle } from "./_board/core.js";
import { createDiscordSync } from "./_board/discord.js";
import { storeFromEnv } from "./_board/store.js";

const store = storeFromEnv();
const discord = store
  ? createDiscordSync({
      store,
      roadmapWebhookUrl: process.env.DISCORD_BOARD_WEBHOOK_URL,
      feedWebhookUrl: process.env.DISCORD_BOARD_FEED_WEBHOOK_URL,
      forumTags: process.env.DISCORD_BOARD_FORUM_TAGS,
    })
  : null;
const mirror = discord?.enabled ? discord : null;

/**
 * Discord work finishes after the response when Vercel lets it (the same hook
 * @vercel/functions' waitUntil uses), so nobody waits on a webhook; elsewhere it's awaited.
 */
function later(work) {
  const context = globalThis[Symbol.for("@vercel/request-context")]?.get?.();
  if (typeof context?.waitUntil === "function") {
    context.waitUntil(work);
    return undefined;
  }
  return work;
}

const options = {
  store,
  env: process.env,
  onEvent: mirror ? (event) => later(mirror.event(event)) : null,
  links: mirror ? (cardId) => mirror.links(cardId) : null,
};

export async function GET(request) {
  const response = await handle(request, options);
  if (mirror && response.ok) await later(mirror.ensure());
  return response;
}

export const POST = (request) => handle(request, options);
export const OPTIONS = (request) => handle(request, options);
