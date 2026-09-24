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
  if (validation && !validation.ok && packs.length) {
    return { state: 'missing-nodes', label: 'Needs ComfyUI nodes', detail: `Needs ${packs.join(' and ')}, which ComfyUI doesn’t include.` };
  }
  if (validation && !validation.ok && files) {
    return { state: 'needs-setup', label: `Needs ${files} file${files === 1 ? '' : 's'}`, detail: 'A file this model needs isn’t installed yet.' };
  }
  if (validation && !validation.ok && missing) {
    return { state: 'missing-nodes', label: `Missing ${missing} node${missing === 1 ? '' : 's'}`, detail: 'Install the missing custom nodes in ComfyUI, then check again.' };
  }
  if (validation && !validation.ok) {
    const missingFiles = (validation.issues || []).filter((issue) => /^Missing (diffusion model|checkpoint|text encoder|VAE|upscale model|file):/.test(issue)).length;
    if (missingFiles && missingFiles === validation.issues.length) {
      return { state: 'needs-setup', label: `Needs ${missingFiles} file${missingFiles === 1 ? '' : 's'}`, detail: 'These files aren’t in ComfyUI’s models folders yet. Add each one where it says, then check again.' };
    }
    return { state: 'needs-setup', label: 'Needs setup', detail: 'Something in the graph or its mapping needs fixing before it can run.' };
  }
  if (validation?.unverified) {
    return comfyRestarting
      ? { state: 'unchecked', label: 'Checking soon', detail: 'ComfyUI is restarting; this is checked again as soon as it’s back.' }
      : { state: 'unchecked', label: 'Not checked', detail: "ComfyUI is offline, so its nodes can't be checked yet." };
  }
  return { state: 'ready', label: 'Ready', detail: 'Everything this workflow needs is installed.' };
}
