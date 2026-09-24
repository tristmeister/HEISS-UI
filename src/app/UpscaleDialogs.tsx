import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { NodeInstall } from './NodeInstall';
import { UpscaleHero } from './UpscaleHero';
import { cn } from './format';
import { formatBytes, upscaleEfforts, upscaleQualityLabel } from './useUpscale';
import type { UpscaleSetup, UpscaleSetupStage } from './useUpscale';
import type { UpscaleInstall, UpscaleInstallFile, UpscaleQuality, UpscaleStatus } from './types';

// Until the server reports the pack, the same entry as server/node-packs.js.
const seedvr2Pack = { id: "seedvr2", name: "SeedVR2", repository: "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git", search: "SeedVR2" };

const STEPS = [
  { label: "Nodes", stages: ["checking", "offline", "nodes"] },
  { label: "Model", stages: ["models", "downloading", "error"] },
  { label: "Check", stages: ["verifying"] }
] as const;

/** Three steps joined by a dotted run of cells; the active one smoulders. */
function SetupSteps({ stage }: { stage: UpscaleSetupStage }) {
  const current = stage === "ready" ? STEPS.length : STEPS.findIndex((step) => (step.stages as readonly string[]).includes(stage));
  return (
    <ol className="upscale-stepper" aria-label="Setup steps">
      {STEPS.map((step, index) => {
        const state = index < current ? "done" : index === current ? "active" : "todo";
        return (
          <li key={step.label} className={`is-${state}`} aria-current={state === "active" ? "step" : undefined}>
            <i aria-hidden="true">{state === "done" ? <Check size={10} strokeWidth={3} /> : null}</i>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A progress bar cut into cells, so it reads as the same material as the hero. */
export function CellBar({ value, tone = "ember" }: { value: number; tone?: "ember" | "done" }) {
  return (
    <div className={cn("cell-bar", tone === "done" && "is-done")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

/** "Checked 3s ago" that keeps counting while setup waits on ComfyUI. */
function Watcher({ children, lastChecked }: React.PropsWithChildren<{ lastChecked?: number }>) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const ago = lastChecked ? Math.max(0, Math.round((Date.now() - lastChecked) / 1000)) : null;
  return (
    <div className="upscale-watcher" role="status">
      <i aria-hidden="true" />
      <span>{children}</span>
      {ago !== null ? <em>{ago < 2 ? "just now" : `${ago}s ago`}</em> : null}
    </div>
  );
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `about ${hours} h ${minutes % 60} min`;
}

function fileLine(file: UpscaleInstallFile) {
  switch (file.phase) {
    case "queued": return "Waiting";
    case "resuming": return "Checking what already arrived";
    case "retrying": return "Connection dropped, retrying";
    case "verifying": return "Verifying checksum";
    case "verified": return "Verified";
    default: return `${formatBytes(file.bytes)} of ${formatBytes(file.totalBytes)}`;
  }
}

const copyFor = (stage: UpscaleSetupStage, quality: string, pending: boolean, fallback: string): { title: string; description: string } => {
  switch (stage) {
    case "checking": return { title: "Setting up smart upscale", description: "Checking what ComfyUI already has." };
    case "offline": return { title: "Waiting for ComfyUI", description: "Smart upscale runs inside ComfyUI, and it is not answering right now. Setup carries on by itself as soon as it is back." };
    case "nodes": return { title: "Add SeedVR2 to ComfyUI", description: "Smart upscale restores real detail with SeedVR2. Its nodes install once, through ComfyUI Manager or a terminal, and HEISS UI notices by itself when they arrive." };
    case "models": return { title: "Download the upscale model", description: `${upscaleQualityLabel(quality)} upscaling needs its SeedVR2 weights. They download once from Hugging Face and are checked before first use.${fallback ? ` Until then it runs on ${fallback}.` : ""}` };
    case "downloading": return { title: "Downloading SeedVR2", description: pending ? "Your image upscales the moment this finishes. You can close this; the download keeps going." : "You can close this; the download keeps going in the background." };
    case "verifying": return { title: "Checking the download", description: "Matching every file against its published checksum and making sure ComfyUI can load it." };
    case "ready": return fallback && !pending
      ? { title: "Ready, on a fallback model", description: `${upscaleQualityLabel(quality)} works, but not with the model it is made for.` }
      : { title: "Smart upscale is ready", description: pending ? "Starting your upscale now." : "Every finished image has an upscale arrow in its corner. The original is always kept." };
    case "error": return { title: "The download stopped", description: "What already arrived stays on disk, so trying again picks up where it left off." };
  }
};

export function UpscaleSetupDialog({
  setup,
  status,
  install,
  reason,
  quality,
  comfyUrl,
  onQualityChange,
  onOpenLibrary,
  showToast
}: {
  setup: UpscaleSetup;
  status: UpscaleStatus | null;
  install: UpscaleInstall;
  reason: string;
  quality: UpscaleQuality;
  comfyUrl?: string;
  onQualityChange: (quality: UpscaleQuality) => void;
  onOpenLibrary: () => void;
  showToast: (message: string, tone?: "default" | "success" | "error") => void;
}) {
  const { stage, pending } = setup;
  const progress = install?.totalBytes ? (install.receivedBytes || 0) / install.totalBytes : 0;
  const fallback = status?.substituting ? status.fallbackFile || "another installed SeedVR2 weight" : "";
  const { title, description } = copyFor(stage, quality, Boolean(pending), fallback);
  const close = setup.closeSetup;
  const later = <button className="btn is-ghost" onClick={close}>{stage === "downloading" ? "Hide" : "Later"}</button>;
  const recheck = <button className="btn" onClick={() => setup.recheck()}><RefreshCw size={13} /> Check now</button>;

  const missingModels = (status?.models || []).filter((model) => !model.present);
  const remaining = missingModels.reduce((sum, model) => sum + model.bytes - (model.partialBytes || 0), 0);
  const resumable = missingModels.some((model) => model.partialBytes > 0);
  const freeBytes = status?.freeBytes ?? null;
  const tooBig = freeBytes !== null && freeBytes < remaining + 512 * 1024 ** 2;

  let body: React.ReactNode = null;
  let footer: React.ReactNode = later;

  if (stage === "checking") {
    body = <Watcher>Asking ComfyUI what it has</Watcher>;
  } else if (stage === "offline") {
    body = (
      <>
        <Watcher lastChecked={setup.lastChecked}>Waiting for ComfyUI{comfyUrl ? <> at <code>{comfyUrl.replace(/^https?:\/\//, "")}</code></> : null}</Watcher>
        {reason && !/offline/i.test(reason) ? <p className="upscale-fine">{reason}</p> : null}
      </>
    );
    footer = <>{later}{recheck}</>;
  } else if (stage === "nodes") {
    body = (
      <>
        <NodeInstall
          pack={status?.nodeSetup?.pack || seedvr2Pack}
          plan={status?.nodeSetup}
          managerHint={status?.nodeSetup?.manager}
          autoInstall={status?.nodeSetup?.autoInstall}
          showToast={showToast}
          onRestarted={() => setup.recheck()}
          afterRestart="That is it: this dialog moves on by itself."
        />
        <Watcher lastChecked={setup.lastChecked}>Watching ComfyUI for the SeedVR2 nodes</Watcher>
        {status?.detectedNodes?.length ? (
          <p className="upscale-fine">
            ComfyUI loads other SeedVR2 nodes ({status.detectedNodes.join(", ")}), so a different or older SeedVR2 pack is installed. Smart upscale needs the one above.
          </p>
        ) : null}
      </>
    );
    footer = (
      <>
        {later}
        {recheck}
        {comfyUrl ? <a className="btn is-primary" href={comfyUrl} target="_blank" rel="noreferrer">Open ComfyUI <ExternalLink size={13} /></a> : null}
      </>
    );
  } else if (stage === "models") {
    body = !status?.canDownload ? (
      <div className="upscale-callout">
        <strong>HEISS UI does not know where ComfyUI keeps its models yet.</strong>
        <span>Set the ComfyUI output folder under Library and the models folder next to it is found automatically.</span>
      </div>
    ) : (
      <>
        <div className="upscale-efforts" role="radiogroup" aria-label="Upscale effort">
          {upscaleEfforts.map((effort) => (
            <button
              key={effort.value}
              type="button"
              role="radio"
              aria-checked={quality === effort.value}
              className={cn(quality === effort.value && "is-active")}
              onClick={() => onQualityChange(effort.value)}
            >
              <strong>{effort.label}<em>{effort.scale}</em></strong>
              <span>{effort.model}</span>
              <small>{formatBytes(effort.downloadBytes)}</small>
            </button>
          ))}
        </div>
        <ul className="upscale-files">
          {missingModels.map((model) => (
            <li key={model.file}>
              <div>
                <strong>{model.label}{model.detail ? <em>{model.detail}</em> : null}</strong>
                <code>{model.file}</code>
              </div>
              <span>{model.partialBytes ? `${formatBytes(model.bytes - model.partialBytes)} left` : formatBytes(model.bytes)}</span>
            </li>
          ))}
        </ul>
        <div className={cn("upscale-dest", tooBig && "is-short")}>
          <FolderOpen size={14} aria-hidden="true" />
          <code title={status.modelDir}>{status.modelDir}</code>
          {freeBytes !== null ? <span>{formatBytes(freeBytes)} free</span> : null}
        </div>
        {tooBig ? <p className="upscale-fine is-warn">That drive needs {formatBytes(remaining + 512 * 1024 ** 2 - freeBytes!)} more free space, or pick a lighter effort.</p> : null}
        {setup.startError ? <p className="upscale-fine is-warn">{setup.startError}</p> : null}
      </>
    );
    footer = status?.canDownload ? (
      <>
        {later}
        <button className="btn is-primary" onClick={setup.startDownload} disabled={tooBig || !missingModels.length}>
          {resumable ? `Resume · ${formatBytes(remaining)} left` : `Download ${formatBytes(remaining)}`}
        </button>
      </>
    ) : (
      <>{later}<button className="btn is-primary" onClick={onOpenLibrary}>Open Library settings</button></>
    );
  } else if (stage === "downloading" || stage === "verifying") {
    const files = install?.files || [];
    const speed = install?.bytesPerSecond || 0;
    const eta = speed > 0 ? ((install?.totalBytes || 0) - (install?.receivedBytes || 0)) / speed : 0;
    body = (
      <>
        {stage === "downloading" ? (
          <div className="upscale-meter">
            <strong>{Math.floor(progress * 100)}<small>%</small></strong>
            <div>
              <span>{formatBytes(install?.receivedBytes)} of {formatBytes(install?.totalBytes)}</span>
              <span>{speed > 0 ? `${formatBytes(speed)}/s · ${formatDuration(eta)} left` : "Connecting to Hugging Face"}</span>
            </div>
          </div>
        ) : (
          <Watcher>Making sure ComfyUI can load the new weights</Watcher>
        )}
        <ul className="upscale-files is-live">
          {files.map((file) => {
            const done = stage === "verifying" || file.phase === "verified";
            return (
              <li key={file.file} className={cn(done && "is-done")}>
                <div>
                  <strong>{file.label}{file.detail ? <em>{file.detail}</em> : null}</strong>
                  <CellBar value={done ? 1 : file.totalBytes ? file.bytes / file.totalBytes : 0} tone={done ? "done" : "ember"} />
                </div>
                <span>{done ? <><Check size={12} strokeWidth={3} /> Verified</> : fileLine(file)}</span>
              </li>
            );
          })}
        </ul>
      </>
    );
    footer = stage === "downloading" ? (
      <>
        <button className="btn is-ghost" onClick={setup.cancelInstall}>Cancel</button>
        <button className="btn is-primary" onClick={close}>Continue in background</button>
      </>
    ) : null;
  } else if (stage === "ready") {
    body = pending ? (
      <div className="upscale-pending">
        {pending.thumbnailUrl || pending.url ? <img src={pending.thumbnailUrl || pending.url} alt="" draggable={false} /> : null}
        <div>
          <strong>Upscaling with {upscaleQualityLabel(quality)}</strong>
          <span>It shows up on the tile when it is done. The original stays as it is.</span>
        </div>
      </div>
    ) : fallback ? (
      <div className="upscale-callout is-warn">
        <strong>{upscaleQualityLabel(quality)} is using {fallback}</strong>
        <span>Its own weights are not downloaded, so it borrows the SeedVR2 weight you already have. Upscales still work, but can look different from what {upscaleQualityLabel(quality)} is tuned for.</span>
      </div>
    ) : null;
    footer = pending ? null : fallback ? (
      <>
        <button className="btn is-ghost" onClick={close}>Keep the fallback</button>
        <button className="btn is-primary" onClick={setup.downloadOwnModel}>Download {upscaleQualityLabel(quality)} · {formatBytes(status?.downloadBytes)}</button>
      </>
    ) : <button className="btn is-primary" onClick={close}>Done</button>;
  } else if (stage === "error") {
    body = <div className="upscale-callout is-danger"><strong>{install?.error || "The download failed."}</strong></div>;
    footer = <>{later}<button className="btn is-primary" onClick={setup.startDownload}>Try again</button></>;
  }

  return (
    <Modal
      open={setup.open}
      onOpenChange={(next) => { if (!next) close(); }}
      size="form"
      className="upscale-modal"
      hero={
        <div className="upscale-hero-wrap">
          <UpscaleHero className="upscale-hero" stage={stage} progress={progress} />
          <SetupSteps stage={stage} />
        </div>
      }
      title={title}
      description={description}
      footer={footer}
    >
      <div className="upscale-body" key={stage}>{body}</div>
    </Modal>
  );
}
