import React, { useEffect, useRef, useState } from 'react';
import { Check, EyeOff, Fingerprint, FolderOpen, LockKeyhole, Sparkles } from 'lucide-react';
import { Modal } from './Modal';
import { Watcher } from './UpscaleDialogs';
import { VaultHero, type VaultHeroStage } from './VaultHero';
import { cn } from './format';
import { passkeyCancelled, PasskeyWithoutSecretError } from './passkeys';
import type { HiddenState } from './useHidden';
import { useComfyRestarting } from './ComfyRestart';

type Step = "offline" | "intro" | "password" | "biometric" | "scanning" | "ready";

const STEPS: Array<{ label: string; steps: Step[] }> = [
  { label: "Password", steps: ["offline", "intro", "password"] },
  { label: "Unlock", steps: ["biometric", "scanning"] },
  { label: "Ready", steps: ["ready"] }
];

function Stepper({ step, biometricLabel }: { step: Step; biometricLabel: string }) {
  const current = STEPS.findIndex((item) => item.steps.includes(step));
  return (
    <ol className="upscale-stepper" aria-label="Setup steps">
      {STEPS.map((item, index) => {
        const state = index < current || step === "ready" ? "done" : index === current ? "active" : "todo";
        return (
          <li key={item.label} className={`is-${state}`} aria-current={state === "active" ? "step" : undefined}>
            <i aria-hidden="true">{state === "done" ? <Check size={10} strokeWidth={3} /> : null}</i>
            <span>{index === 1 ? biometricLabel : item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A rough, honest strength: length first, then variety. Feeds the lock's heat. */
export function passwordStrength(value: string) {
  if (!value) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter((pattern) => pattern.test(value)).length;
  return Math.min(1, (value.length / 16) * 0.75 + (classes / 5) * 0.35);
}

function strengthLabel(value: string) {
  if (value.length < 8) return value ? `${8 - value.length} more character${8 - value.length === 1 ? "" : "s"}` : "At least 8 characters";
  const score = passwordStrength(value);
  return score > 0.85 ? "Strong" : score > 0.6 ? "Good" : "Fair";
}

export function HiddenSetupDialog({ hidden, comfyOnline, comfyUrl, onRecheck, onDone, onChooseFolder }: {
  hidden: HiddenState;
  /** Setup waits for ComfyUI: it has to find where ComfyUI saves before Hidden can clear its copies. */
  comfyOnline: boolean;
  comfyUrl?: string;
  onRecheck: () => void;
  onDone: () => void;
  onChooseFolder: () => void;
}) {
  const { setupOpen, setSetupOpen, support, status, intent } = hidden;
  const [step, setStep] = useState<Step>("intro");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // "Set up anyway" while ComfyUI is offline: stay on the steps instead of bouncing back.
  const [offlineOk, setOfflineOk] = useState(false);
  const comfyRestarting = useComfyRestarting();
  const passwordRef = useRef<HTMLInputElement>(null);
  const label = support?.label || "Touch ID";

  // Every opening starts over, unless Hidden already exists and only an unlock method was missing.
  useEffect(() => {
    if (!setupOpen) return;
    setStep(status?.enabled ? "biometric" : comfyOnline ? "intro" : "offline");
    setOfflineOk(false);
    setPassword("");
    setConfirm("");
    setError("");
  }, [setupOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step === "password") window.setTimeout(() => passwordRef.current?.focus(), 60);
  }, [step]);

  // ComfyUI coming back moves setup on by itself, with the output folder found fresh.
  const [lastChecked, setLastChecked] = useState(0);
  const recheck = useRef(onRecheck);
  recheck.current = onRecheck;
  useEffect(() => {
    if (!setupOpen || status?.enabled) return;
    if (comfyOnline && step === "offline") { hidden.refresh(); setStep("intro"); }
    if (!comfyOnline && !offlineOk && (step === "intro" || step === "password")) setStep("offline");
  }, [comfyOnline, setupOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!setupOpen || step !== "offline") return;
    setLastChecked(Date.now());
    const timer = window.setInterval(() => { recheck.current(); setLastChecked(Date.now()); }, 3000);
    return () => window.clearInterval(timer);
  }, [setupOpen, step]);

  const close = () => {
    if (busy) return;
    setSetupOpen(false);
    if (step === "ready") onDone();
    // Walked away from: whatever it was opened for must not happen later by surprise.
    else hidden.takeIntent();
  };

  const create = async () => {
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("The passwords don’t match."); return; }
    setBusy(true);
    setError("");
    try {
      await hidden.createHidden(password);
      setPassword("");
      setConfirm("");
      setStep(support?.available ? "biometric" : "ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not set up Hidden.");
    } finally {
      setBusy(false);
    }
  };

  const enroll = async () => {
    setStep("scanning");
    setError("");
    try {
      await hidden.addBiometric();
      setStep("ready");
    } catch (reason) {
      setStep("biometric");
      if (passkeyCancelled(reason)) return;
      setError(reason instanceof PasskeyWithoutSecretError
        ? `This browser can’t unlock Hidden with ${label}. Use your password.`
        : reason instanceof Error ? reason.message : `Could not add ${label}.`);
    }
  };

  const heroStage: VaultHeroStage = error && step !== "biometric" ? "error"
    : step === "password" ? "password"
    : step === "biometric" ? "biometric"
    : step === "scanning" ? "scanning"
    : step === "ready" ? "sealed"
    : "intro";

  const intentLine = intent?.kind === "hide" ? `${intent.items.length === 1 ? "Your image moves" : `Your ${intent.items.length} images move`} in when you close this.`
    : intent?.kind === "generate" ? "Your generation starts when you close this."
    : "Open it from the lock in the dock. Anything you generate there stays hidden.";

  const copy: Record<Step, { title: string; description: string }> = {
    offline: comfyRestarting ? { title: "ComfyUI is restarting", description: "Setup carries on as soon as it’s back, usually in a few seconds. You can also set up now." } : { title: "Waiting for ComfyUI", description: "Hidden removes ComfyUI’s copies of what you hide, so it works best with ComfyUI running. You can create the password now and start ComfyUI later." },
    intro: { title: "Hidden", description: "Images you keep to yourself, encrypted on this computer." },
    password: { title: "Choose a password", description: "Works on any device, and whenever Touch ID or Windows Hello doesn’t." },
    biometric: { title: `Unlock with ${label}`, description: support?.available ? `Unlock without typing. Your password still works.` : support?.reason || "Checking this device…" },
    scanning: { title: `Waiting for ${label}`, description: "Follow the prompt from your system." },
    ready: { title: "Hidden is ready", description: intentLine }
  };

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (step === "offline") {
    body = <Watcher lastChecked={lastChecked}>Waiting for ComfyUI{comfyUrl ? <> at <code>{comfyUrl.replace(/^https?:\/\//, "")}</code></> : null}</Watcher>;
    footer = (
      <>
        <button className="btn is-ghost" onClick={close}>Not now</button>
        <button className="btn" onClick={() => { onRecheck(); setLastChecked(Date.now()); }}>Check again</button>
        <button className="btn is-primary" onClick={() => { setOfflineOk(true); setStep("intro"); }}>Set up anyway</button>
      </>
    );
  } else if (step === "intro") {
    body = (
      <>
        <ul className="hidden-promises">
          <li><LockKeyhole size={15} /><div><strong>Encrypted on this computer</strong><span>Images, prompts and settings. When it’s locked, not even a count shows.</span></div></li>
          <li><Sparkles size={15} /><div><strong>Everything still works</strong><span>Upscale, compare, remix and video. What you make from a Hidden image stays hidden.</span></div></li>
          <li><EyeOff size={15} /><div><strong>Hide from the gallery</strong><span>Move images in, or back out. ComfyUI’s copies are removed.</span></div></li>
          <li><Fingerprint size={15} /><div><strong>Opens with {label}</strong><span>{support?.available ? "Or your password, on any device." : "Or your password. " + (support?.reason || "")}</span></div></li>
        </ul>
        {status?.readiness && !status.readiness.outputDir ? (
          <div className="upscale-callout is-warn hidden-callout">
            <strong>ComfyUI’s output folder isn’t set.</strong>
            <span>Without it, ComfyUI’s unencrypted copy of each image stays behind.</span>
            <button type="button" className="btn" onClick={onChooseFolder}><FolderOpen size={13} /> Choose folder…</button>
          </div>
        ) : null}
      </>
    );
    footer = (
      <>
        <button className="btn is-ghost" onClick={close}>Not now</button>
        <button className="btn is-primary" onClick={() => setStep("password")}>Set up Hidden</button>
      </>
    );
  } else if (step === "password") {
    const strength = passwordStrength(password);
    body = (
      <form className="hidden-form" onSubmit={(event) => { event.preventDefault(); create(); }}>
        <input ref={passwordRef} className="modal-input" type="password" autoComplete="new-password" aria-label="Password" placeholder="Password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} />
        <div className="hidden-strength" aria-live="polite">
          <div className="cell-bar" role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(strength * 100)}>
            <div style={{ width: `${strength * 100}%` }} />
          </div>
          <span>{strengthLabel(password)}</span>
        </div>
        <input className="modal-input" type="password" autoComplete="new-password" aria-label="Confirm password" placeholder="Confirm password" value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(""); }} />
        <p className={cn("upscale-fine", error && "is-warn")}>{error || "There’s no password reset. If you lose it and every passkey, Hidden can only be erased."}</p>
        <button type="submit" hidden />
      </form>
    );
    footer = (
      <>
        <button className="btn is-ghost" onClick={() => setStep("intro")} disabled={busy}>Back</button>
        <button className="btn is-primary" onClick={create} disabled={busy || password.length < 8 || !confirm}>{busy ? "Creating…" : "Create Hidden"}</button>
      </>
    );
  } else if (step === "biometric" || step === "scanning") {
    body = support?.available ? (
      <>
        <div className="hidden-device">
          <Fingerprint size={18} />
          <div><strong>{label} on this device</strong><span>Your fingerprint or face stays on this device.</span></div>
        </div>
        {error ? <p className="upscale-fine is-warn">{error}</p> : null}
      </>
    ) : (
      <div className="upscale-callout">
        <strong>{support?.reason || `${label} is not available here.`}</strong>
        {support?.localhostUrl ? <span>Open <a href={support.localhostUrl}>{support.localhostUrl.replace(/^https?:\/\//, "")}</a> to add it in Settings › Hidden. Until then, use your password.</span> : <span>Use your password for now. You can add {label} later in Settings › Hidden.</span>}
      </div>
    );
    footer = (
      <>
        <button className="btn is-ghost" onClick={() => setStep("ready")} disabled={step === "scanning"}>{support?.available ? "Not now" : "Continue"}</button>
        {support?.available ? <button className="btn is-primary" onClick={enroll} disabled={step === "scanning"}><Fingerprint size={14} /> {step === "scanning" ? "Waiting…" : `Use ${label}`}</button> : null}
      </>
    );
  } else if (step === "ready") {
    body = (
      <ul className="hidden-summary">
        <li><Check size={13} strokeWidth={3} /> Password set</li>
        <li className={cn(!hidden.hasPasskey && "is-off")}>{hidden.hasPasskey ? <Check size={13} strokeWidth={3} /> : <span className="hidden-dash" />} {hidden.hasPasskey ? `${label} unlocks it` : `${label} not added`}</li>
        <li><Check size={13} strokeWidth={3} /> Locks when idle</li>
      </ul>
    );
    footer = <button className="btn is-primary" onClick={close}>{intent?.kind === "hide" ? "Hide it" : intent?.kind === "generate" ? "Done" : "Open Hidden"}</button>;
  }

  return (
    <Modal
      open={setupOpen}
      onOpenChange={(next) => { if (!next) close(); }}
      size="form"
      busy={busy || step === "scanning"}
      className="upscale-modal hidden-modal"
      hero={
        <div className="upscale-hero-wrap hidden-hero-wrap">
          <VaultHero className="upscale-hero hidden-hero" stage={heroStage} progress={step === "password" ? passwordStrength(password) : 0} />
          {step !== "intro" && step !== "offline" ? <Stepper step={step} biometricLabel={label} /> : null}
        </div>
      }
      title={copy[step].title}
      description={copy[step].description}
      footer={footer}
    >
      <div className="upscale-body" key={step}>{body}</div>
    </Modal>
  );
}
