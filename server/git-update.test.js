import assert from "node:assert/strict";
import test from "node:test";
import { describeGitError, updateCheckout } from "./git-update.js";

const failure = (fields) => Object.assign(new Error(fields.message || "Command failed"), fields);

/** A checkout whose commands answer from `script`; records what ran. */
function checkout(script = {}) {
  const calls = [];
  let head = "aaaaaaa1111111";
  const run = async (command, args) => {
    const line = [command, ...args].join(" ");
    calls.push(line);
    const answer = Object.entries(script).find(([pattern]) => line.startsWith(pattern))?.[1];
    if (typeof answer === "function") return answer(line, calls);
    if (answer instanceof Error) throw answer;
    if (answer !== undefined) return answer;
    if (line === "git rev-parse HEAD") return `${head}\n`;
    if (line.startsWith("git pull")) { head = "bbbbbbb2222222"; return "Fast-forward"; }
    if (line.startsWith("git reset --hard")) { head = args[2]; return ""; }
    return "";
  };
  return { run, calls };
}

test("a clean checkout pulls, installs and builds", async () => {
  const { run, calls } = checkout({ "git status": "" });
  const result = await updateCheckout({ run, branch: "main" });
  assert.equal(result.from, "aaaaaaa1111111");
  assert.equal(result.to, "bbbbbbb2222222");
  assert.deepEqual(calls.filter((line) => !line.startsWith("git rev-parse")), [
    "git status --porcelain --untracked-files=no",
    "git pull --ff-only origin main",
    "npm install",
    "npm run build"
  ]);
});

test("a checkout with changes of its own is left alone, and says which", async () => {
  const { run, calls } = checkout({ "git status": " M server/index.js\n M src/main.tsx\n" });
  await assert.rejects(updateCheckout({ run }), (error) => /changes of its own \(server\/index\.js, src\/main\.tsx\)/.test(error.message) && error.localChanges.length === 2);
  assert.equal(calls.some((line) => line.startsWith("git pull")), false);
});

test("a build that fails goes back to the commit it came from and rebuilds that", async () => {
  let builds = 0;
  const { run, calls } = checkout({
    "git status": "",
    "npm run build": () => {
      builds += 1;
      if (builds === 1) throw failure({ code: 2, stderr: "src/main.tsx(1,1): error TS2304: Cannot find name 'x'.\n" });
      return "built";
    }
  });
  await assert.rejects(updateCheckout({ run }), (error) => {
    assert.match(error.message, /^Building the update failed: src\/main\.tsx\(1,1\): error TS2304/);
    assert.match(error.message, /went back to the version it had, and it still works/);
    assert.equal(error.rolledBack, true);
    return true;
  });
  assert.ok(calls.includes("git reset --hard aaaaaaa1111111"));
  assert.equal(calls.filter((line) => line === "npm install").length, 2, "the old packages come back too");
});

test("git and npm failures read as plain words", () => {
  assert.match(describeGitError(failure({ code: "ENOENT", message: "spawn git ENOENT" }), "pull"), /Git isn't installed/);
  assert.match(describeGitError(failure({ code: "ENOENT", message: "spawn npm ENOENT" }), "install"), /npm isn't available/);
  assert.match(describeGitError(failure({ code: 128, stderr: "fatal: unable to access 'https://github.com/x.git/': Could not resolve host: github.com" }), "fetch"), /Couldn't reach GitHub/);
  assert.match(describeGitError(failure({ code: 1, stderr: "npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org failed" }), "install"), /npm couldn't download/);
  assert.match(describeGitError(failure({ code: 128, stderr: "fatal: Not possible to fast-forward, aborting." }), "pull"), /commits of its own/);
  assert.match(describeGitError(failure({ code: 1, stderr: "error: Your local changes to the following files would be overwritten by merge" }), "pull"), /changed files/);
  assert.match(describeGitError(failure({ killed: true, signal: "SIGTERM" }), "build"), /took too long/);
  assert.equal(describeGitError(failure({ code: 1, stderr: "something odd\n" }), "pull"), "Downloading the update failed: something odd");
});
