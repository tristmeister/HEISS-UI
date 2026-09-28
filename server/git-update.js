/**
 * Updating a Git checkout from Settings › About: pull, install, build.
 *
 * A release copy swaps in a verified download instead (updater.js,
 * release-swap.js); this is only for copies cloned with git. It refuses to
 * touch a checkout with changes of its own, says what went wrong in plain
 * words instead of passing on git's or npm's output, and when the new
 * version will not install or build it goes back to the commit it came from,
 * so a failed update never leaves new sources beside an old or half-built app.
 */

/** The last meaningful line a command printed, for the end of a message. */
function lastLine(text = "") {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^npm (ERR|error)! *$/i.test(line)).at(-1) || "";
}

/** What a failed git or npm command means, in plain words. */
export function describeGitError(error, step = "") {
  const output = `${error?.stderr || ""}\n${error?.stdout || ""}\n${error?.message || ""}`;
  const tool = step === "install" || step === "build" ? "npm" : "git";
  if (error?.code === "ENOENT") {
    return tool === "git"
      ? "Git isn't installed. Install it from git-scm.com, or use the release zip instead."
      : "npm isn't available, so the update can't install its packages. Install Node.js 20.9 or newer (it includes npm), then try again.";
  }
  if (error?.killed || error?.signal === "SIGTERM") return `The ${step || tool} step took too long and was stopped. Try again, or update by hand in a terminal.`;
  if (/could not resolve host|unable to access|could not read from remote|connection (refused|timed out|reset)|network is unreachable|failed to connect|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET/i.test(output)) {
    return tool === "git"
      ? "Couldn't reach GitHub. Check the internet connection, then try again."
      : "npm couldn't download the packages. Check the internet connection, then try again.";
  }
  if (/not possible to fast-forward|diverg|non-fast-forward|refusing to merge/i.test(output)) {
    return "This copy has commits of its own that aren't on GitHub. Update it by hand, for example with git pull --rebase.";
  }
  if (/would be overwritten|local changes|uncommitted/i.test(output)) {
    return "This copy has changed files, and updating would overwrite them. Commit or stash them, then update again.";
  }
  if (/not a git repository/i.test(output)) return "This folder isn't a Git checkout.";
  if (/couldn't find remote ref|no such remote|does not appear to be a git repository/i.test(output)) {
    return "This copy's branch isn't on GitHub. Switch to main (git checkout main), or update by hand.";
  }
  if (/EACCES|EPERM|permission denied/i.test(output)) return "Can't write to this folder. Check its permissions, then try again.";
  if (/ENOSPC|no space left/i.test(output)) return "The disk is full. Free some space, then try again.";
  const detail = lastLine(error?.stderr) || lastLine(error?.stdout) || lastLine(error?.message);
  const what = { fetch: "Checking for updates", pull: "Downloading the update", install: "Installing the update's packages", build: "Building the update" }[step] || "The update";
  return `${what} failed${detail ? `: ${detail}` : "."}`;
}

/** Files git tracks that differ from the last commit (untracked files never block an update). */
export async function localChanges(run) {
  const text = await run("git", ["status", "--porcelain", "--untracked-files=no"]);
  return String(text).split(/\r?\n/).map((line) => line.slice(3).trim()).filter(Boolean);
}

/**
 * Pulls `branch`, installs and builds. `run(command, args)` runs a command in
 * the checkout and resolves to its output (rejecting like execFile). `npm` is
 * the npm command name for `run`. Resolves `{ pull, install, build, from, to }`;
 * rejects with an Error whose message is meant for people, and `rolledBack`
 * when it went back to `from`.
 */
export async function updateCheckout({ run, npm = "npm", branch = "main", log = () => {} }) {
  const step = async (name, command, args) => {
    try {
      return await run(command, args);
    } catch (error) {
      throw Object.assign(new Error(describeGitError(error, name)), { step: name, cause: error });
    }
  };

  const changed = await localChanges(run).catch((error) => { throw new Error(describeGitError(error, "fetch")); });
  if (changed.length) {
    const shown = changed.slice(0, 3).join(", ");
    throw Object.assign(new Error(`This copy has changes of its own (${shown}${changed.length > 3 ? ` and ${changed.length - 3} more` : ""}), so it wasn't updated. Commit or stash them, then update again, or update by hand with git pull.`), { localChanges: changed });
  }
  const from = String(await step("pull", "git", ["rev-parse", "HEAD"])).trim();
  const pull = await step("pull", "git", ["pull", "--ff-only", "origin", branch]);
  const to = String(await step("pull", "git", ["rev-parse", "HEAD"])).trim();
  try {
    const install = await step("install", npm, ["install"]);
    const build = await step("build", npm, ["run", "build"]);
    return { pull, install, build, from, to };
  } catch (error) {
    if (!from || from === to) throw error;
    // New sources next to old packages or a half-built app would not start: go back whole.
    log(`The update to ${to.slice(0, 7)} failed (${error.message}); going back to ${from.slice(0, 7)}.`);
    try {
      await run("git", ["reset", "--hard", from]);
    } catch (resetError) {
      throw Object.assign(new Error(`${error.message} Going back to the previous version failed too (${describeGitError(resetError, "pull")}). Run git reset --hard ${from.slice(0, 7)}, npm install and npm run build in a terminal.`), { step: error.step });
    }
    // The failed step may have changed packages or emptied dist/; put the old ones back.
    let restored = true;
    try {
      await run(npm, ["install"]);
      await run(npm, ["run", "build"]);
    } catch {
      restored = false;
    }
    const after = restored ? "This copy went back to the version it had." : "This copy went back to the version it had. Run npm install and npm run build in a terminal before starting it again.";
    throw Object.assign(new Error(`${error.message} ${after}`), { step: error.step, rolledBack: true, restored });
  }
}
