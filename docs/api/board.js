// The feedback board's API: /api/board. The page is /board/, the logic lives in ./_board/.
import { handle } from "./_board/core.js";
import { createDiscordRoadmapSync } from "./_board/discord.js";
import { storeFromEnv } from "./_board/store.js";

const store = storeFromEnv();
const sync = store
  ? createDiscordRoadmapSync({ store, webhookUrl: process.env.DISCORD_BOARD_WEBHOOK_URL })
  : null;

// Keep Discord as a best-effort mirror so a webhook outage never blocks feedback.
if (sync) {
  for (const method of ["create", "save", "saveMany", "remove"]) {
    const original = store[method].bind(store);
    store[method] = async (...args) => {
      const result = await original(...args);
      try {
        await sync.notify();
      } catch (error) {
        console.error("Discord roadmap sync could not queue an update:", error?.message || error);
      }
      return result;
    };
  }
}

export async function GET(request) {
  const response = await handle(request, { store, env: process.env });
  if (sync && response.ok) {
    try {
      await sync.ensure();
    } catch (error) {
      console.error("Discord roadmap sync could not refresh:", error?.message || error);
    }
  }
  return response;
}

export const POST = (request) => handle(request, { store, env: process.env });
export const OPTIONS = (request) => handle(request, { store, env: process.env });
