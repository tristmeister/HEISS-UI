import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiJson } from './api';
import { passkeyCancelled, passkeySupport, registerPasskey, unlockWithPasskey, type PasskeySupport } from './passkeys';
import type { GalleryItem, PrivacyStatus } from './types';
import type { GallerySpace } from './useGalleryStore';

type Toast = (message: string, tone?: "default" | "success" | "error") => void;

/** How long Hidden stays open without anyone touching the page. 0: until the browser forgets. */
export const autoLockChoices = [
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 60, label: "1 hour" },
  { value: 0, label: "Never" }
] as const;

/** What was asked for before Hidden could do it: done the moment it can. */
export type HiddenIntent = { kind: "enter" } | { kind: "hide"; items: GalleryItem[] } | { kind: "generate" };

export type HiddenUnlockStage = "idle" | "asking" | "checking" | "opening" | "failed";

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function useHidden({ autoLockMinutes, showToast }: { autoLockMinutes: number; showToast: Toast }) {
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [space, setSpaceState] = useState<GallerySpace>("gallery");
  const [support, setSupport] = useState<PasskeySupport | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockStage, setUnlockStage] = useState<HiddenUnlockStage>("idle");
  const [unlockError, setUnlockError] = useState("");
  const [intent, setIntent] = useState<HiddenIntent | null>(null);
  const [busy, setBusy] = useState(false);

  const enabled = Boolean(status?.enabled);
  const unlocked = Boolean(status?.unlocked);
  const hasPasskey = (status?.passkeys?.length || 0) > 0;
  // Never ask the server for more than the idle window, so a forgotten tab locks itself even if this page is gone.
  const sessionSeconds = autoLockMinutes > 0 ? Math.max(60 * 60, autoLockMinutes * 60 * 4) : 60 * 60 * 24 * 30;

  const refresh = useCallback(async () => {
    try {
      const next = await apiJson<PrivacyStatus>("/api/privacy/status");
      setStatus(next);
      return next;
    } catch {
      setStatus(null);
      return null;
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { passkeySupport().then(setSupport).catch(() => null); }, []);

  const setSpace = useCallback((next: GallerySpace) => setSpaceState(next), []);

  /** The lock screen shows in Hidden itself; elsewhere a sheet asks. */
  const requestUnlock = useCallback((next: HiddenIntent | null) => {
    setIntent(next);
    setUnlockError("");
    setUnlockStage("idle");
    if (next?.kind !== "enter") setUnlockOpen(true);
  }, []);

  const opened = useCallback((next: PrivacyStatus) => {
    setUnlockStage("opening");
    setStatus(next);
    // The lock gets its moment before the pictures come in.
    window.setTimeout(() => {
      // Another device had nothing loaded behind the lock; start it properly.
      if (next.remote) { window.location.reload(); return; }
      setUnlockOpen(false);
      setUnlockStage("idle");
    }, 900);
  }, []);

  // On another device everything waits behind the password.
  const remoteLocked = Boolean(status?.remote && status.enabled && !status.unlocked);
  useEffect(() => { if (remoteLocked) setUnlockOpen(true); }, [remoteLocked]);

  const failed = useCallback((message: string) => {
    setUnlockStage("failed");
    setUnlockError(message);
  }, []);

  const unlockPassword = useCallback(async (password: string) => {
    if (!password) return false;
    setUnlockStage("checking");
    setUnlockError("");
    try {
      opened(await apiJson<PrivacyStatus>("/api/privacy/unlock", json({ password, sessionSeconds })));
      return true;
    } catch (error) {
      failed(error instanceof Error ? error.message : "That password did not open Hidden.");
      return false;
    }
  }, [failed, opened, sessionSeconds]);

  // Fetched ahead of time: Safari only shows its Touch ID sheet straight from a
  // click, and a network round trip first would spend that click.
  const passkeyOptions = useRef<Array<{ id: string; salt: string }>>([]);
  const passkeyCount = status?.passkeys?.length || 0;
  useEffect(() => {
    if (!enabled || !passkeyCount) { passkeyOptions.current = []; return; }
    apiJson<{ passkeys: Array<{ id: string; salt: string }> }>("/api/privacy/passkeys/options")
      .then((data) => { passkeyOptions.current = data.passkeys || []; })
      .catch(() => null);
  }, [enabled, passkeyCount]);

  const unlockBiometric = useCallback(async () => {
    setUnlockStage("asking");
    setUnlockError("");
    try {
      const passkeys = passkeyOptions.current.length
        ? passkeyOptions.current
        : (await apiJson<{ passkeys: Array<{ id: string; salt: string }> }>("/api/privacy/passkeys/options")).passkeys;
      const answer = await unlockWithPasskey(passkeys);
      setUnlockStage("checking");
      opened(await apiJson<PrivacyStatus>("/api/privacy/passkeys/unlock", json({ ...answer, sessionSeconds })));
      return true;
    } catch (error) {
      if (passkeyCancelled(error)) {
        setUnlockStage("idle");
        return false;
      }
      failed(error instanceof Error ? error.message : "That did not open Hidden.");
      return false;
    }
  }, [failed, opened, sessionSeconds]);

  const lock = useCallback(async (quiet = false) => {
    try {
      const next = await apiJson<PrivacyStatus>("/api/privacy/lock", { method: "POST" });
      setStatus((current) => ({ ...(current || next), ...next, unlocked: false }));
      if (!quiet) showToast("Hidden locked", "success");
    } catch (error) {
      if (!quiet) showToast(error instanceof Error ? error.message : "Could not lock Hidden", "error");
    }
  }, [showToast]);

  // Idle auto-lock: any touch of the page resets the clock.
  const lastActive = useRef(Date.now());
  useEffect(() => {
    if (!unlocked || autoLockMinutes <= 0) return;
    const touch = () => { lastActive.current = Date.now(); };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }));
    lastActive.current = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - lastActive.current > autoLockMinutes * 60 * 1000) lock(true);
    }, 15_000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, touch));
      window.clearInterval(timer);
    };
  }, [autoLockMinutes, lock, unlocked]);

  /* ---------------------------------------------------------- Setup */

  const createHidden = useCallback(async (password: string) => {
    const next = await apiJson<PrivacyStatus>("/api/privacy/setup", json({ password, sessionSeconds }));
    setStatus(next);
    return next;
  }, [sessionSeconds]);

  /** Adds this device's Touch ID or Windows Hello as a way into Hidden. */
  const addBiometric = useCallback(async (name?: string) => {
    const made = await registerPasskey();
    const next = await apiJson<PrivacyStatus>("/api/privacy/passkeys", json({ ...made, name: name || support?.label || "Passkey" }));
    setStatus(next);
    return next;
  }, [support?.label]);

  const removeBiometric = useCallback(async (id: string) => {
    const next = await apiJson<PrivacyStatus>(`/api/privacy/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
    setStatus(next);
  }, []);

  const changePassword = useCallback(async (password: string) => {
    setStatus(await apiJson<PrivacyStatus>("/api/privacy/password", json({ password })));
  }, []);

  const erase = useCallback(async () => {
    const next = await apiJson<PrivacyStatus>("/api/privacy/erase", json({ confirm: "erase" }));
    setStatus(next);
    setSpaceState("gallery");
  }, []);

  /* ---------------------------------------------------------- Moving items */

  const hide = useCallback(async (items: GalleryItem[]) => {
    const ids = items.map((item) => item.id);
    setBusy(true);
    try {
      const result = await apiJson<{ moved: number; ids: string[]; failed: Array<{ id: string; error: string }>; leftBehind: number }>("/api/hidden/hide", json({ ids }));
      if (result.failed?.length && !result.moved) showToast(result.failed[0].error || "Could not hide that", "error");
      else if (result.leftBehind) showToast(`Hidden. ComfyUI kept ${result.leftBehind === 1 ? "a copy" : `${result.leftBehind} copies`} it would not let go of.`, "default");
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await refresh();
        requestUnlock({ kind: "hide", items });
        return null;
      }
      showToast(error instanceof Error ? error.message : "Could not hide that", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh, requestUnlock, showToast]);

  const unhide = useCallback(async (items: GalleryItem[]) => {
    setBusy(true);
    try {
      return await apiJson<{ restored: number }>("/api/hidden/unhide", json({ ids: items.map((item) => item.id) }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not put that back", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  /**
   * The one way into anything Hidden: set it up first, unlock it first, or
   * just do it. Returns true when it can happen right now.
   */
  const ensureReady = useCallback((next: HiddenIntent) => {
    if (!enabled) {
      setIntent(next);
      setSetupOpen(true);
      return false;
    }
    if (!unlocked) {
      requestUnlock(next);
      return false;
    }
    return true;
  }, [enabled, requestUnlock, unlocked]);

  const takeIntent = useCallback(() => {
    const current = intent;
    setIntent(null);
    return current;
  }, [intent]);

  return useMemo(() => ({
    status, enabled, unlocked, hasPasskey, support, busy,
    space, setSpace,
    setupOpen, setSetupOpen,
    unlockOpen, setUnlockOpen, unlockStage, unlockError, setUnlockError, setUnlockStage,
    intent, takeIntent, ensureReady, requestUnlock,
    refresh, unlockPassword, unlockBiometric, lock,
    createHidden, addBiometric, removeBiometric, changePassword, erase,
    hide, unhide
  }), [status, enabled, unlocked, hasPasskey, support, busy, space, setSpace, setupOpen, unlockOpen, unlockStage, unlockError, intent, takeIntent, ensureReady, requestUnlock, refresh, unlockPassword, unlockBiometric, lock, createHidden, addBiometric, removeBiometric, changePassword, erase, hide, unhide]);
}

export type HiddenState = ReturnType<typeof useHidden>;
