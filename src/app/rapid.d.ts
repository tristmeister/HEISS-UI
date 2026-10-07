export type RapidStatus = 'on' | 'off' | 'seed' | 'image' | 'idle' | 'install' | 'model';
export function rapidState(
  profile: { capabilities?: Record<string, boolean> } | null | undefined,
  prefs: { rapid?: boolean; rapidGuidance?: boolean },
  seed: string,
  rapidSeed: string,
  run?: { kind?: string; startImage?: boolean; inpaint?: boolean; cfg?: number }
): { use: boolean; guidance: boolean; status: RapidStatus };
export function rapidLabel(status: RapidStatus): string;
export function rapidSeedFrom(settings: Record<string, unknown> | null | undefined, options?: { vary?: boolean }): string;
