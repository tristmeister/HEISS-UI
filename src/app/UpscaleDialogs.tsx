import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, RefreshCw, X } from 'lucide-react';
import { copyText } from './api';
import { formatBytes, upscaleQualityLabel } from './useUpscale';
import type { UpscaleDownloadPreview } from './types';

const repositoryUrl = "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git";

/** One shell so every upscale dialog shares the hero, spacing and hierarchy. */
function UpscaleDialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions
}: React.PropsWithChildren<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  actions: React.ReactNode;
}>) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="confirmation-overlay" />
        <Dialog.Content className="upscale-setup-dialog">
          <img className="upscale-setup-hero" src="/upscale-hero.webp" alt="" aria-hidden="true" draggable={false} />
          <Dialog.Close className="upscale-setup-close" aria-label="Close"><X size={15} /></Dialog.Close>
          <div className="upscale-setup-body">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
            {children}
            <div className="confirmation-actions">{actions}</div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function UpscaleSetupDialog({
  open,
  missingNodes = [],
  detectedNodes = [],
  onOpenChange,
  onRecheck,
  showToast
}: {
  open: boolean;
  missingNodes?: string[];
  detectedNodes?: string[];
  onOpenChange: (open: boolean) => void;
  onRecheck: () => void;
  showToast: (message: string, tone?: "default" | "success" | "error") => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyUrl = async () => {
    const ok = await copyText(repositoryUrl);
    if (!ok) {
      showToast("Copy failed", "error");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <UpscaleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Smart upscale needs the SeedVR2 nodes"
      description={`ComfyUI does not have ${missingNodes.length ? "some of " : ""}the SeedVR2 nodes installed yet, so there is nothing to upscale with.`}
      actions={
        <>
          <button onClick={onRecheck}><RefreshCw size={13} /> Re-check</button>
          <button className="is-primary" onClick={() => onOpenChange(false)}>Done</button>
        </>
      }
    >
      <ol className="upscale-setup-steps">
        <li>Open <strong>ComfyUI Manager</strong> in ComfyUI.</li>
        <li>Click <strong>Install via Git URL</strong>.</li>
        <li>Paste this repository URL:</li>
      </ol>
      <div className="upscale-setup-url">
        <code>{repositoryUrl}</code>
        <button type="button" className={copied ? "is-copied" : ""} onClick={copyUrl} aria-label="Copy the repository URL">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <p className="upscale-setup-note">
        Restart ComfyUI once it finishes installing. If smart upscale still reports the nodes as missing, reload J AI Studio too.
      </p>
      {detectedNodes.length ? (
        <p className="upscale-setup-missing">
          ComfyUI does load other SeedVR2 nodes ({detectedNodes.join(", ")}), so a different or older SeedVR2 pack is installed. Smart upscale needs the one above.
        </p>
      ) : missingNodes.length ? (
        <p className="upscale-setup-missing">Missing: {missingNodes.join(", ")}</p>
      ) : null}
    </UpscaleDialogShell>
  );
}

export function UpscaleInstallDialog({
  preview,
  quality,
  onOpenChange,
  onConfirm
}: {
  preview: UpscaleDownloadPreview | null;
  quality: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <UpscaleDialogShell
      open={Boolean(preview)}
      onOpenChange={onOpenChange}
      title="Install the smart upscale models"
      description={`${upscaleQualityLabel(quality)} upscaling needs weights that are not on this machine yet. They download once and stay installed.`}
      actions={
        <>
          <button onClick={() => onOpenChange(false)}>Cancel</button>
          <button className="is-primary" onClick={onConfirm}>Download {preview ? formatBytes(preview.totalBytes) : ""}</button>
        </>
      }
    >
      <ul className="upscale-model-list">
        {(preview?.files || []).map((file) => (
          <li key={file.key}>
            <span>{file.label}</span>
            <em>{formatBytes(file.bytes)}</em>
          </li>
        ))}
      </ul>
      <div className="upscale-setup-url is-path">
        <code>{preview?.modelDir || ""}</code>
      </div>
      <p className="upscale-setup-note">
        ComfyUI may need a restart afterwards before the models appear.
      </p>
    </UpscaleDialogShell>
  );
}
