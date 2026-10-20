import { t } from '../i18n/core.js';
import type { WorkflowValidation } from './types';

/**
 * The one vocabulary for workflow health, used by the gallery, the detail
 * panel and the import review so the same state always reads the same way.
 */
export type WorkflowState = 'ready' | 'unchecked' | 'missing-nodes' | 'needs-setup';

export function workflowState(validation?: WorkflowValidation, comfyRestarting = false): { state: WorkflowState; label: string; detail: string } {
  const missing = validation?.missingNodes?.length || 0;
  const files = validation?.missingFiles?.length || 0;
  const packs = validation?.missingPacks || [];
  if (validation && !validation.ok && validation.outdatedComfy) {
    return { state: 'missing-nodes', label: t("Needs newer ComfyUI"), detail: t("This model needs a newer ComfyUI. Update it, then check again.") };
  }
  if (validation && !validation.ok && packs.length) {
    return { state: 'missing-nodes', label: t("Needs ComfyUI nodes"), detail: t("Needs {0}, which ComfyUI doesn’t include.", { "0": (packs.join(' and ')) }) };
  }
  if (validation && !validation.ok && files) {
    return { state: 'needs-setup', label: t("Needs {0} file{1}", { "0": (files), "1": (files === 1 ? t("") : t("s")) }), detail: files === 1 ? 'A file this model needs isn’t installed yet.' : `${files} files this model needs aren’t installed yet.` };
  }
  if (validation && !validation.ok && missing) {
    return { state: 'missing-nodes', label: t("Missing {0} node{1}", { "0": (missing), "1": (missing === 1 ? t("") : t("s")) }), detail: t("Install the missing custom nodes in ComfyUI, then check again.") };
  }
  if (validation && !validation.ok) {
    const missingFiles = (validation.issues || []).filter((issue) => /^Missing (diffusion model|checkpoint|text encoder|VAE|upscale model|file):/.test(issue)).length;
    if (missingFiles && missingFiles === validation.issues.length) {
      return { state: 'needs-setup', label: t("Needs {0} file{1}", { "0": (missingFiles), "1": (missingFiles === 1 ? t("") : t("s")) }), detail: t("These files aren’t in ComfyUI’s models folders yet. Add each one where it says, then check again.") };
    }
    return { state: 'needs-setup', label: t("Needs setup"), detail: t("Something in the workflow needs fixing before it can run.") };
  }
  if (validation?.unverified) {
    return comfyRestarting
      ? { state: 'unchecked', label: t("Checking soon"), detail: t("ComfyUI is restarting. Checked again when it’s back.") }
      : { state: 'unchecked', label: t("Not checked"), detail: t("ComfyUI is offline, so its nodes can’t be checked yet.") };
  }
  return { state: 'ready', label: t("Ready"), detail: t("Everything this workflow needs is installed.") };
}
