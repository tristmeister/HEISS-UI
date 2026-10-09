// Imported near the top of index.js: installing as a side effect of the
// import means a crash while the rest of the server loads is written down too.
import { installCrashLog } from "./crash-log.js";

installCrashLog();
