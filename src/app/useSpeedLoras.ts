import React from 'react';
import type { ShowToast } from './toast';
import type { LoraSelection, Profile, SpeedVariant } from './types';

type Settings = { steps: number; cfg: number; sampler: string; scheduler: string };

type Input = Settings & {
  profile: Profile | null;
  loras: LoraSelection[];
  setSteps: (value: number) => void;
  setCfg: (value: number) => void;
  setSampler: (value: string) => void;
  setScheduler: (value: string) => void;
  showToast: ShowToast;
};

const same = (a: Settings, b: Partial<Settings> | undefined) => Boolean(b) && a.steps === Number(b!.steps) && a.cfg === Number(b!.cfg);

/**
 * A speed LoRA (Lightning, Hyper, lightx2v, …) stacked on a full-step model
 * wants that model's few-step settings: 4 to 8 steps at CFG 1, not 30 at 5.
 * Adding one switches steps, CFG, sampler and scheduler to them (with Undo),
 * as long as they were still the model's own; taking the last one off puts
 * the model's own back, as long as nobody changed them in between. The server
 * picks the matching variant for the graph (shift, guidance) by itself.
 */
export function useSpeedLoras({ profile, loras, steps, cfg, sampler, scheduler, setSteps, setCfg, setSampler, setScheduler, showToast }: Input) {
  const speedId = profile?.speedLoras
    ? loras.filter((item) => item.enabled).map((item) => profile.speedLoras![item.name]).find(Boolean) || ''
    : '';
  const current = React.useRef<Settings>({ steps, cfg, sampler, scheduler });
  current.current = { steps, cfg, sampler, scheduler };
  const previous = React.useRef<{ profileId: string; speedId: string } | null>(null);

  React.useEffect(() => {
    const before = previous.current;
    previous.current = { profileId: profile?.id || '', speedId };
    // The first render keeps whatever the saved draft held.
    if (!profile || !before) return;
    const apply = (next: Settings) => {
      setSteps(next.steps);
      setCfg(next.cfg);
      if (next.sampler) setSampler(next.sampler);
      if (next.scheduler) setScheduler(next.scheduler);
    };
    const own: Settings = { steps: Number(profile.defaults.steps), cfg: Number(profile.defaults.cfg), sampler: String(profile.defaults.sampler || ''), scheduler: String(profile.defaults.scheduler || '') };
    const fast: SpeedVariant | undefined = speedId ? profile.speedVariants?.[speedId] : undefined;

    if (before.profileId !== profile.id) {
      // A new model sets its own defaults first; a speed LoRA already in its stack then gets its say.
      if (!fast) return;
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => apply(fast)));
      return () => cancelAnimationFrame(frame);
    }
    if (before.speedId === speedId) return;
    const was = current.current;
    const previousFast = before.speedId ? profile.speedVariants?.[before.speedId] : undefined;
    if (fast) {
      const untouched = same(was, own) || same(was, previousFast);
      const summary = `${fast.steps} steps, CFG ${fast.cfg}`;
      if (untouched) {
        apply(fast);
        showToast(`Speed LoRA: ${summary}`, 'default', {
          id: 'speed-lora',
          description: `Set to ${profile.displayName || profile.label}’s ${fast.label} settings.`,
          action: { label: 'Undo', onClick: () => apply(was) }
        });
      } else {
        showToast('This LoRA runs in a few steps', 'default', {
          id: 'speed-lora',
          description: `${fast.label} settings: ${summary}.`,
          action: { label: 'Apply', onClick: () => apply(fast) }
        });
      }
      return;
    }
    // The last speed LoRA left: back to the model's own settings, if they are still the fast ones.
    if (previousFast && same(was, previousFast)) {
      apply(own);
      showToast(`Back to ${own.steps} steps, CFG ${own.cfg}`, 'default', { id: 'speed-lora', action: { label: 'Undo', onClick: () => apply(was) } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, speedId]);
}
