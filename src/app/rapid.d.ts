export type RapidStatus = 'on' | 'off' | 'seed' | 'image' | 'install' | 'model';
export function rapidState(
  profile: { capabilities?: Record<string, boolean> } | null | undefined,
  prefs: { rapid?: boolean },
  seed: string,
  rapidSeed: string,
  run?: { kind?: string; startImage?: boolean; inpaint?: boolean }
): { use: boolean; status: RapidStatus };
export function rapidLabel(status: RapidStatus): string;
export function rapidSeedFrom(settings: Record<string, unknown> | null | undefined, options?: { vary?: boolean }): string;
