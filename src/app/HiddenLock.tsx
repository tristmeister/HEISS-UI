import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Fingerprint, KeyRound } from 'lucide-react';
import { Modal } from './Modal';
import { VaultHero, type VaultHeroStage } from './VaultHero';
import { cn } from './format';
import type { HiddenState } from './useHidden';

function heroStageFor(hidden: HiddenState): VaultHeroStage {
  if (hidden.unlockStage === "opening" || hidden.unlocked) return "unlocking";
  if (hidden.unlockStage === "failed") return "error";
  if (hidden.unlockStage === "asking") return "scanning";
  return "locked";
}

/**
 * The ways in, in order of ease: the device's own biometrics when a passkey is
 * set up here, the password always. Enter on the password, or one click.
 */
function UnlockControls({ hidden, autoFocus = false, compact = false }: { hidden: HiddenState; autoFocus?: boolean; compact?: boolean }) {
  const { support, hasPasskey, unlockStage, unlockError } = hidden;
  const biometric = Boolean(hasPasskey && support?.available);
  const [usePassword, setUsePassword] = useState(!biometric);
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const working = unlockStage === "asking" || unlockStage === "checking" || unlockStage === "opening";

  useEffect(() => { if (!biometric) setUsePassword(true); }, [biometric]);
  useEffect(() => {
    if (usePassword && autoFocus) window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [autoFocus, usePassword]);
  // A wrong password is cleared and selected, ready for the next try.
  useEffect(() => {
    if (unlockStage !== "failed") return;
    setPassword("");
    inputRef.current?.focus();
  }, [unlockStage]);

  const submit = async () => {
    if (!password || working) return;
    await hidden.unlockPassword(password);
  };

  return (
    <div className={cn("hidden-unlock", compact && "is-compact")}>
      {biometric && !usePassword ? (
        <button type="button" className="hidden-unlock-primary" onClick={() => hidden.unlockBiometric()} disabled={working}>
          <Fingerprint size={17} />
          <span>{unlockStage === "asking" ? `Waiting for ${support?.label}…` : unlockStage === "checking" ? "Opening…" : `Unlock with ${support?.label}`}</span>
        </button>
      ) : (
        <form className={cn("hidden-unlock-field", unlockStage === "failed" && "is-wrong")} onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <KeyRound size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            aria-label="Hidden password"
            placeholder="Password"
            value={password}
            disabled={working}
            onChange={(event) => { setPassword(event.target.value); if (unlockStage === "failed") hidden.setUnlockStage("idle"); }}
          />
          <button type="submit" disabled={!password || working} aria-label="Unlock">{unlockStage === "checking" ? "…" : "Unlock"}</button>
        </form>
      )}
      <div className="hidden-unlock-meta" aria-live="polite">
        {unlockStage === "failed" && unlockError ? <span className="is-error">{unlockError}</span> : null}
        {biometric ? (
          <button type="button" className="hidden-unlock-switch" onClick={() => { setUsePassword((value) => !value); hidden.setUnlockStage("idle"); }}>
            {usePassword ? `Use ${support?.label}` : "Use password"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Hidden, locked: the gallery gives way to the lock. Nothing about what is
 * inside shows, not a count, not a blurred thumbnail. Unlocking springs the
 * shackle and the pictures burn in behind it.
 */
export function HiddenLockScreen({ hidden, onLeave, onSetup }: { hidden: HiddenState; onLeave: () => void; onSetup: () => void }) {
  const reduce = useReducedMotion();
  const stage = heroStageFor(hidden);
  const notSetUp = !hidden.enabled;
  return (
    <motion.section
      className={cn("hidden-lockscreen", `is-${stage}`)}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.985, filter: "blur(6px)" }}
      transition={{ type: "spring", duration: 0.5, bounce: 0 }}
    >
      <VaultHero className="hidden-lockscreen-hero" stage={notSetUp ? "intro" : stage} />
      <div className="hidden-lockscreen-copy">
        <h2>{notSetUp ? "Hidden" : stage === "unlocking" ? "Unlocked" : "Hidden is locked"}</h2>
        <p>{notSetUp
          ? "Images you keep to yourself, encrypted on this computer."
          : hidden.hasPasskey && hidden.support?.available ? `Unlock with ${hidden.support.label} or your password.` : "Enter your password to unlock."}</p>
        {notSetUp ? (
          <div className="hidden-unlock">
            <button type="button" className="hidden-unlock-primary" onClick={onSetup}><span>Set up Hidden</span></button>
          </div>
        ) : stage !== "unlocking" ? <UnlockControls hidden={hidden} autoFocus /> : null}
      </div>
      <button type="button" className="hidden-lockscreen-back" onClick={onLeave}><ArrowLeft size={14} /> Gallery</button>
    </motion.section>
  );
}

/** Unlocking from anywhere else, such as hiding an image while Hidden is locked. */
export function HiddenUnlockSheet({ hidden }: { hidden: HiddenState }) {
  const stage = heroStageFor(hidden);
  const busy = hidden.unlockStage === "asking" || hidden.unlockStage === "checking" || hidden.unlockStage === "opening";
  const what = hidden.intent?.kind === "hide" ? `to hide ${hidden.intent.items.length === 1 ? "this image" : `these ${hidden.intent.items.length} images`}` : hidden.intent?.kind === "generate" ? "to generate into it" : "";
  // Another device on the network: the whole studio waits behind the password.
  const remote = Boolean(hidden.status?.remote && !hidden.unlocked);
  return (
    <Modal
      open={hidden.unlockOpen}
      onOpenChange={(open) => { if (!open && !remote) { hidden.setUnlockOpen(false); hidden.takeIntent(); } }}
      size="form"
      busy={busy}
      hideClose={remote}
      dismissOnOutside={!remote}
      className="upscale-modal hidden-modal hidden-unlock-modal"
      hero={<div className="upscale-hero-wrap hidden-hero-wrap is-short"><VaultHero className="upscale-hero hidden-hero" stage={stage} /></div>}
      title={stage === "unlocking" ? "Unlocked" : remote ? "Unlock HEISS UI" : "Unlock Hidden"}
      description={stage === "unlocking" ? "One moment." : remote ? "Enter the Hidden password to use HEISS UI from this device." : what ? `Unlock ${what}.` : "Hidden is locked."}
    >
      {stage !== "unlocking" ? <UnlockControls hidden={hidden} autoFocus compact /> : <div className="hidden-unlock-spacer" />}
    </Modal>
  );
}
