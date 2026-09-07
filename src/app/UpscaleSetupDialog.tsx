import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, RefreshCw, X } from 'lucide-react';
import { copyText } from './api';

const repositoryUrl = "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git";

export function UpscaleSetupDialog({
  open,
  missingNodes = [],
  onOpenChange,
  onRecheck,
  showToast
}: {
  open: boolean;
  missingNodes?: string[];
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="confirmation-overlay" />
        <Dialog.Content className="upscale-setup-dialog">
          <img className="upscale-setup-hero" src="/upscale-hero.webp" alt="" aria-hidden="true" draggable={false} />
          <Dialog.Close className="upscale-setup-close" aria-label="Close"><X size={15} /></Dialog.Close>
          <div className="upscale-setup-body">
            <Dialog.Title>Smart upscale needs the SeedVR2 nodes</Dialog.Title>
            <Dialog.Description>
              ComfyUI does not have {missingNodes.length ? "some of " : ""}the SeedVR2 nodes installed yet, so there is nothing to upscale with.
            </Dialog.Description>
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
            {missingNodes.length ? (
              <p className="upscale-setup-missing">Missing: {missingNodes.join(", ")}</p>
            ) : null}
            <div className="confirmation-actions">
              <button onClick={onRecheck}><RefreshCw size={13} /> Re-check</button>
              <button className="is-primary" onClick={() => onOpenChange(false)}>Done</button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
