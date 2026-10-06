import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { NodeInstall } from './NodeInstall';
import { UpscaleHero } from './UpscaleHero';
import { useThisComputer } from './device';
import { cn } from './format';
import { formatBytes, upscaleEfforts, upscaleQualityLabel } from './useUpscale';
import type { UpscaleSetup, UpscaleSetupStage } from './useUpscale';
import type { UpscaleInstall, UpscaleInstallFile, UpscaleQuality, UpscaleStatus } from './types';
import { SafeImg } from './SafeImg';
import type { ShowToast } from './toast';

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
export function Watcher({ children, lastChecked }: React.PropsWithChildren<{ lastChecked?: number }>) {
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
    case "resuming": return "Checking the partial download";
    case "retrying": return "Connection dropped, retrying";
    case "verifying": return "Checking the file";
    case "verified": return "Verified";
    default: return `${formatBytes(file.bytes)} of ${formatBytes(file.totalBytes)}`;
  }
}

/** Setup opened from a Smart upscale tab speaks about new images at that size, not about one image. */
const autoCopyFor = (stage: UpscaleSetupStage, size: string, fallback: string): { title: string; description: string } | null => {
  switch (stage) {
    case "checking": return { title: `Smart upscale to ${size}`, description: "Checking ComfyUI…" };
    case "nodes": return { title: `Smart upscale to ${size}`, description: `New images upscale to ${size} as they finish, on the SeedVR2 nodes. Add them to ComfyUI first.` };
    case "models": return { title: `Smart upscale to ${size}`, description: `New images upscale to ${size} as they finish. That needs the SeedVR2 weights, a one-time download from Hugging Face.${fallback ? ` Until then it uses ${fallback}.` : ""}` };
    case "downloading": return { title: `Getting ${size} ready`, description: "Smart upscale turns on when this finishes. The download continues if you close this." };
    case "ready": return fallback
      ? { title: `Smart upscale to ${size} is on`, description: "It uses a SeedVR2 weight you already have. Its own model is one download away." }
      : { title: `Smart upscale to ${size} is on`, description: `New images upscale to ${size} as they finish. The original is kept, one click away.` };
    default: return null;
  }
};

const copyFor = (stage: UpscaleSetupStage, quality: string, pending: boolean, fallback: string): { title: string; description: string } => {
  switch (stage) {
    case "checking": return { title: "Setting up smart upscale", description: "Checking ComfyUI…" };
    case "offline": return { title: "Waiting for ComfyUI", description: "Start ComfyUI to continue." };
    case "nodes": return { title: "Add SeedVR2 to ComfyUI", description: "Smart upscale runs on the SeedVR2 nodes. Install them through ComfyUI-Manager or a terminal." };
    case "models": return { title: "Download the upscale model", description: `${upscaleQualityLabel(quality)} upscaling needs its SeedVR2 weights, a one-time download from Hugging Face.${fallback ? ` Until then it uses ${fallback}.` : ""}` };
    case "downloading": return { title: "Downloading SeedVR2", description: pending ? "The image upscales when this finishes. The download continues if you close this." : "The download continues if you close this." };
    case "verifying": return { title: "Checking the download", description: "Making sure the files are complete." };
    case "ready": return fallback && !pending
      ? { title: "Ready with a fallback model", description: `${upscaleQualityLabel(quality)} works, but not with its own model.` }
      : { title: "Smart upscale is ready", description: pending ? "Starting the upscale." : "Every finished image has an upscale arrow in its corner." };
    case "error": return { title: "The download stopped", description: "Try again to resume." };
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
  showToast: ShowToast;
}) {
  const { stage, pending } = setup;
  // Downloads land on the computer HEISS UI runs on, so only it (or a device trusted with admin) starts them.
  const admin = useThisComputer();
  const progress = install?.totalBytes ? (install.receivedBytes || 0) / install.totalBytes : 0;
  const fallback = status?.substituting ? status.fallbackFile || "another installed SeedVR2 weight" : "";
  const autoSize = setup.auto ? setup.auto.toUpperCase() : "";
  const { title, description } = (autoSize && autoCopyFor(stage, autoSize, fallback)) || copyFor(stage, quality, Boolean(pending), fallback);
  const close = setup.closeSetup;
  const later = <button className="btn is-ghost" onClick={close}>{stage === "downloading" ? "Continue in background" : "Not now"}</button>;
  const recheck = <button className="btn" onClick={() => setup.recheck()}><RefreshCw size={13} /> Check again</button>;

  const missingModels = (status?.models || []).filter((model) => !model.present);
  const remaining = missingModels.reduce((sum, model) => sum + model.bytes - (model.partialBytes || 0), 0);
  const resumable = missingModels.some((model) => model.partialBytes > 0);
  const freeBytes = status?.freeBytes ?? null;
  const tooBig = freeBytes !== null && freeBytes < remaining + 512 * 1024 ** 2;

  let body: React.ReactNode = null;
  let footer: React.ReactNode = later;

  if (stage === "checking") {
    body = <Watcher>Checking ComfyUI…</Watcher>;
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
        />
        <Watcher lastChecked={setup.lastChecked}>Waiting for the SeedVR2 nodes…</Watcher>
        {status?.detectedNodes?.length ? (
          <p className="upscale-fine">
            A different or older SeedVR2 pack is installed ({status.detectedNodes.join(", ")}). Smart upscale needs the one above.
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
    body = !admin ? (
      <div className="upscale-callout">
        <strong>The upscale model downloads on the computer running HEISS UI.</strong>
        <span>Set up smart upscale there, and it works here too.</span>
      </div>
    ) : !status?.canDownload ? (
      <div className="upscale-callout">
        <strong>The models folder isn’t set yet.</strong>
        <span>Set ComfyUI’s output folder in Settings › Library, and the models folder next to it is found automatically.</span>
      </div>
    ) : (
      <>
        {autoSize ? null : <div className="upscale-efforts" role="radiogroup" aria-label="Upscale effort">
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
        </div>}
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
        {tooBig ? <p className="upscale-fine is-warn">Free up {formatBytes(remaining + 512 * 1024 ** 2 - freeBytes!)} on that drive{autoSize === "4K" ? ", or use 2K" : autoSize ? "" : ", or pick a lighter effort"}.</p> : null}
        {setup.startError ? <p className="upscale-fine is-warn">{setup.startError}</p> : null}
      </>
    );
    footer = !admin ? later : status?.canDownload ? (
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
          <Watcher>Checking that ComfyUI can load the new weights</Watcher>
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
        {admin ? <button className="btn is-ghost" onClick={setup.cancelInstall}>Cancel</button> : null}
        <button className="btn is-primary" onClick={close}>Continue in background</button>
      </>
    ) : null;
  } else if (stage === "ready") {
    body = pending ? (
      <div className="upscale-pending">
        <SafeImg src={pending.thumbnailUrl || pending.url} draggable={false} />
        <div>
          <strong>Upscaling with {upscaleQualityLabel(quality)}</strong>
          <span>It appears on the tile when it’s done.</span>
        </div>
      </div>
    ) : fallback ? (
      <div className="upscale-callout is-warn">
        <strong>{upscaleQualityLabel(quality)} is using {fallback}</strong>
        <span>Its own weights aren’t downloaded, so it uses one you already have. Results can look different.</span>
      </div>
    ) : null;
    footer = pending ? null : fallback && admin ? (
      <>
        <button className="btn is-ghost" onClick={close}>{autoSize ? "Use it for now" : "Keep the fallback"}</button>
        <button className="btn is-primary" onClick={setup.downloadOwnModel}>Download {upscaleQualityLabel(quality)} · {formatBytes(status?.downloadBytes)}</button>
      </>
    ) : <button className="btn is-primary" onClick={close}>Done</button>;
  } else if (stage === "error") {
    body = <div className="upscale-callout is-danger"><strong>{install?.error || "The download failed."}</strong></div>;
    footer = admin ? <>{later}<button className="btn is-primary" onClick={setup.startDownload}>Try again</button></> : later;
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
