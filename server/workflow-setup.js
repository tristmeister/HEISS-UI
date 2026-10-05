/**
 * Gets an imported workflow ready to run: installs the node packs it needs,
 * restarts ComfyUI once, and checks nothing else broke. One job at a time.
 *
 *   snapshot → install each pack → restart → health check
 *
 * Healthy: the job ends "done" and says nothing more. A regression (a pack
 * that worked before no longer loads, node types gone) ends "regressed" with
 * an undo offer. ComfyUI not coming back at all is undone right away, since
 * nothing works in that state; the person is told after.
 *
 * ComfyUI's own process is started outside HEISS, so the restart and the
 * checks come in as functions (index.js wires them to ComfyUI-Manager and the
 * restart watcher).
 */
import { packInstallFinished, startResolvedPackInstall } from "./pack-installer.js";
import { installHealth, installSnapshot, recordAddedFolders, saveInstallSnapshot, takeInstallSnapshot, undoInstall } from "./install-safety.js";

let job = null;

function view() {
  if (!job) return null;
  const { promise, ...rest } = job;
  return rest;
}

export function workflowSetupState() {
  return view();
}

/**
 * Starts a setup job. `packs`: resolver output the person approved (registry
 * packs need no approval; the route only passes unregistered ones the person
 * said yes to). `deps`: { comfyState, restartComfy, waitForRestart }.
 */
export function startWorkflowSetup({ packs = [], workflowName = "" }, deps) {
  if (job?.status === "running") throw new Error("Another setup is still running.");
  if (!packs.length) throw new Error("Nothing to install.");
  job = {
    id: `setup-${Date.now()}`,
    workflowName,
    status: "running",
    step: "Getting ready",
    packs: packs.map((pack) => ({ key: pack.key, name: pack.name, status: "waiting", error: "" })),
    snapshotId: "",
    health: null,
    message: "",
    startedAt: Date.now(),
    finishedAt: 0
  };
  const current = job;
  current.promise = run(current, packs, deps).catch((error) => {
    Object.assign(current, { status: "error", step: "", message: error.message, finishedAt: Date.now() });
  });
  return view();
}

async function run(current, packs, deps) {
  const before = await deps.comfyState().catch(() => ({ loaded: [], nodeTypes: [] }));
  const snapshot = await takeInstallSnapshot({ reason: current.workflowName ? `For ${current.workflowName}` : "Workflow setup", packs, loaded: before.loaded, nodeTypes: before.nodeTypes });
  current.snapshotId = snapshot.id;
  let installed = 0;
  for (const [index, pack] of packs.entries()) {
    const row = current.packs[index];
    row.status = "installing";
    current.step = `Getting ${pack.name}`;
    try {
      await startResolvedPackInstall(pack);
      const result = await packInstallFinished(pack.key);
      row.status = result?.status === "done" ? "done" : "failed";
      row.error = result?.status === "done" ? "" : result?.error || "Didn’t install.";
      if (row.status === "done") installed += 1;
    } catch (error) {
      row.status = "failed";
      row.error = error.message;
    }
  }
  recordAddedFolders(snapshot);
  saveInstallSnapshot(snapshot);
  if (!installed) {
    Object.assign(current, { status: "error", step: "", message: current.packs.map((row) => `${row.name}: ${row.error}`).join(" "), finishedAt: Date.now() });
    snapshot.status = "failed";
    saveInstallSnapshot(snapshot);
    return;
  }
  current.step = "Restarting ComfyUI";
  const restart = await deps.restartComfy();
  if (!restart.ok) {
    // Installed but not loaded: the person restarts ComfyUI; nothing is broken yet.
    Object.assign(current, { status: "needs-restart", step: "", message: restart.error || "Restart ComfyUI to load the new nodes.", finishedAt: Date.now() });
    snapshot.status = "installed";
    saveInstallSnapshot(snapshot);
    return;
  }
  const back = await deps.waitForRestart();
  const after = back.ok ? await deps.comfyState().catch(() => ({ loaded: null, nodeTypes: null })) : { loaded: null, nodeTypes: null };
  const health = installHealth(snapshot, { loaded: after.loaded, nodeTypes: after.nodeTypes, failed: back.failedPacks || [], comfyBack: back.ok });
  current.health = health;
  if (health.comfyDown) {
    current.step = "Undoing the install";
    const undone = await undoInstall(snapshot).catch((error) => ({ problems: [error.message] }));
    Object.assign(current, {
      status: "rolled-back",
      step: "",
      message: undone.problems?.length
        ? `ComfyUI didn’t start after the install. HEISS tried to undo it, but: ${undone.problems.join(" ")}`
        : "That add-on stopped ComfyUI from starting, so HEISS undid it. Start ComfyUI again.",
      finishedAt: Date.now()
    });
    return;
  }
  snapshot.status = health.ok ? "healthy" : "regressed";
  snapshot.health = health;
  saveInstallSnapshot(snapshot);
  Object.assign(current, { status: health.ok ? "done" : "regressed", step: "", finishedAt: Date.now() });
}

/** Undo for a regressed (or any recorded) install, then a restart so ComfyUI loads the old state. */
export async function undoWorkflowSetup(snapshotId, deps) {
  const snapshot = installSnapshot(snapshotId);
  if (!snapshot) throw new Error("That install isn’t on record anymore.");
  if (snapshot.status === "undone") return { ok: true, already: true };
  const done = await undoInstall(snapshot);
  const restart = await deps.restartComfy().catch((error) => ({ ok: false, error: error.message }));
  if (job?.snapshotId === snapshotId) Object.assign(job, { status: "undone", message: "" });
  return { ok: true, ...done, restarted: restart.ok };
}
