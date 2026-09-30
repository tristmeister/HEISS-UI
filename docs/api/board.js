// The feedback board's API: /api/board. The page is /board/, the logic lives in ./_board/.
import { handle } from "./_board/core.js";
import { storeFromEnv } from "./_board/store.js";

const store = storeFromEnv();
const run = (request) => handle(request, { store, env: process.env });

export const GET = run;
export const POST = run;
export const OPTIONS = run;
