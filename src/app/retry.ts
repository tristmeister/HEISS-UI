import { normalizeLoras } from './loras';
import type { GalleryItem } from './types';

export type RetryOptions = { smaller?: boolean; tiledDecode?: boolean };

/** What a retry sends to /api/generate: the failed run's own settings, not the composer's. */
export type RetryRequest = { kind: 'image' | 'video'; body: Record<string, unknown>; label: string };

/** A side three quarters as long (about half the pixels), on the 16 px grid every family accepts. */
export function smallerSide(value: number) {
  return Math.max(256, Math.round((value * 0.75) / 16) * 16);
}

/**
 * The request that runs a failed item again, exactly as it was asked for, with
 * the seed it drew so the retry is the same picture. `smaller` shrinks both
 * sides; `tiledDecode` decodes in tiles (built-in models only).
 */
export function retryRequest(item: GalleryItem, options: RetryOptions = {}): RetryRequest {
  const settings = item.settings || {};
  const kind = item.type === 'video' ? 'video' : 'image';
  const width = Number(settings.width || item.width || 0);
  const height = Number(settings.height || item.height || 0);
  const references = Array.isArray(settings.referenceAssets) ? settings.referenceAssets as Array<{ slot?: string; assetId?: string }> : [];
  const seed = String(settings.seed ?? '');
  const body: Record<string, unknown> = {
    kind,
    prompt: item.prompt || '',
    negative: item.negative || '',
    profileId: String(settings.profileId || item.model || ''),
    model: item.model || '',
    workflow: String(settings.workflow || ''),
    ...(settings.modelName ? { modelName: String(settings.modelName) } : {}),
    textEncoder: String(settings.textEncoder || ''),
    ...(Array.isArray(settings.textEncoders) ? { textEncoders: settings.textEncoders.map(String) } : {}),
    vae: String(settings.vae || ''),
    clipType: String(settings.clipType || ''),
    weightDtype: String(settings.weightDtype || 'default'),
    width: options.smaller && width ? smallerSide(width) : width,
    height: options.smaller && height ? smallerSide(height) : height,
    steps: Number(settings.steps || 0) || undefined,
    cfg: Number(settings.cfg || 0) || undefined,
    ...(settings.denoise ? { denoise: Number(settings.denoise) } : {}),
    sampler: String(settings.sampler || ''),
    scheduler: String(settings.scheduler || ''),
    seed: /^\d+$/.test(seed) ? seed : '',
    count: Number(settings.count || 1),
    ...(kind === 'video' ? { frames: Number(settings.frames || 0) || undefined, fps: Number(settings.fps || 0) || undefined } : {}),
    loras: normalizeLoras(settings.loras),
    autoResizeInputs: settings.autoResizeInputs !== false,
    referenceAssets: references.filter((ref) => ref?.assetId).map((ref) => ({ slot: ref.slot || 'reference', assetId: ref.assetId })),
    startImageId: item.startImageId || item.referenceImage || '',
    startImageName: item.referenceImageName || String(settings.referenceImageName || ''),
    privateVault: Boolean(item.privateVault),
    // Made with HEISS Rapid: its seed frames that way, so the retry keeps it.
    ...(settings.rapid ? { rapid: true } : {}),
    ...(settings.rapidGuidance ? { rapidGuidance: true } : {}),
    ...(options.tiledDecode ? { tiledDecode: true } : {})
  };
  const label = options.smaller ? 'Trying again smaller' : options.tiledDecode ? 'Trying again, decoding in tiles' : 'Trying again';
  return { kind, body, label };
}
