import React from 'react';
import { Download, Fingerprint, KeyRound, LockKeyhole, Trash2 } from 'lucide-react';
import { cn } from './format';
import { passkeyCancelled, PasskeyWithoutSecretError } from './passkeys';
import { autoLockChoices, type HiddenState } from './useHidden';
import { passwordStrength } from './HiddenSetup';

type Toast = (message: string, tone?: "default" | "success" | "error") => void;
type ConfirmAction = (options: { title: string; description: string; action: string; destructive?: boolean }) => Promise<boolean>;

function when(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/**
 * Settings › Hidden. Built from the same Group / Row pieces as every other
 * section; passed in so this file does not re-implement them.
 */
export function HiddenSettings({ hidden, prefs, setPrefs, showToast, confirmAction, Group, Row, Status }: {
  hidden: HiddenState;
  prefs: { hiddenAutoLockMinutes?: number };
  setPrefs: (next: { hiddenAutoLockMinutes: number }) => void;
  showToast: Toast;
  confirmAction: ConfirmAction;
  Group: React.ComponentType<React.PropsWithChildren<{ title?: string; note?: React.ReactNode; tone?: 'danger' }>>;
  Row: React.ComponentType<React.PropsWithChildren<{ label: React.ReactNode; description?: React.ReactNode; stacked?: boolean; disabled?: boolean }>>;
  Status: React.ComponentType<React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>>;
}) {
  const { status, support, enabled, unlocked } = hidden;
  const label = support?.label || "Touch ID";
  const [changing, setChanging] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const autoLock = prefs.hiddenAutoLockMinutes ?? 15;

  if (!enabled) {
    return (
      <Group>
        <Row label={<Status>Not set up</Status>} description="Hidden keeps images to yourself: encrypted on this computer, opened with a password or Touch ID and Windows Hello. The gallery stays exactly as it is.">
          <button className="btn is-primary" onClick={() => { hidden.takeIntent(); hidden.setSetupOpen(true); }}><LockKeyhole size={14} /> Set up Hidden</button>
        </Row>
      </Group>
    );
  }

  const addBiometric = async () => {
    setBusy("passkey");
    try {
      await hidden.addBiometric();
      showToast(`${label} added`, "success");
    } catch (error) {
      if (!passkeyCancelled(error)) showToast(error instanceof PasskeyWithoutSecretError ? `This browser cannot unlock Hidden with ${label} yet.` : error instanceof Error ? error.message : `${label} could not be added`, "error");
    } finally {
      setBusy("");
    }
  };

  const removeBiometric = async (id: string, name: string) => {
    if (!await confirmAction({ title: `Remove ${name}?`, description: "It stops opening Hidden. The passkey itself stays in your system's password manager until you delete it there.", action: "Remove", destructive: true })) return;
    await hidden.removeBiometric(id).catch((error) => showToast(error instanceof Error ? error.message : "Could not remove it", "error"));
  };

  const savePassword = async () => {
    setBusy("password");
    try {
      await hidden.changePassword(password);
      setPassword("");
      setChanging(false);
      showToast("Password changed", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not change the password", "error");
    } finally {
      setBusy("");
    }
  };

  const erase = async () => {
    if (!await confirmAction({ title: "Erase Hidden?", description: "Every image in Hidden, with its prompt, settings and upscale, is erased from this computer, and the password and passkeys stop existing. This cannot be undone.", action: "Erase everything in Hidden", destructive: true })) return;
    try {
      await hidden.erase();
      showToast("Hidden erased", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not erase Hidden", "error");
    }
  };

  const passkeys = status?.passkeys || [];

  return (
    <>
      <Group>
        <Row
          label={<Status tone={unlocked ? 'ok' : 'warn'}>{unlocked ? 'Unlocked' : 'Locked'}</Status>}
          description={unlocked ? "Open in this browser. It locks itself when left alone, or right away with Lock." : "Unlock to manage passwords and passkeys, or to export what is inside."}
        >
          {unlocked
            ? <button className="btn" onClick={() => hidden.lock()}><LockKeyhole size={14} /> Lock</button>
            : <button className="btn is-primary" onClick={() => hidden.requestUnlock(null)}>Unlock</button>}
        </Row>
      </Group>

      <Group title="Ways in" note={support && !support.available ? <>{support.reason}{support.localhostUrl ? <> Open <a href={support.localhostUrl}>{support.localhostUrl.replace(/^https?:\/\//, "")}</a> to add it.</> : null}</> : "Passkeys unlock through a secret only your device can produce. Neither your fingerprint nor your face ever reaches HEISS UI."}>
        <Row label={<span className="hidden-way"><KeyRound size={14} /> Password</span>} description="Works on every device, including your phone over the network." stacked={changing}>
          {changing ? (
            <form className="set-inline-form" onSubmit={(event) => { event.preventDefault(); savePassword(); }}>
              <input className="modal-input" type="password" autoComplete="new-password" aria-label="New password" placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
              <button type="button" className="btn is-ghost" onClick={() => { setChanging(false); setPassword(""); }}>Cancel</button>
              <button type="submit" className="btn is-primary" disabled={password.length < 8 || busy === "password"}>{busy === "password" ? "Saving…" : passwordStrength(password) > 0.6 ? "Save" : "Save anyway"}</button>
            </form>
          ) : <button className="btn" disabled={!unlocked} onClick={() => setChanging(true)}>Change</button>}
        </Row>
        {passkeys.map((passkey) => (
          <Row key={passkey.id} label={<span className="hidden-way"><Fingerprint size={14} /> {passkey.name || "Passkey"}</span>} description={unlocked ? [passkey.createdAt ? `Added ${when(passkey.createdAt)}` : "", passkey.lastUsedAt ? `last used ${when(passkey.lastUsedAt)}` : ""].filter(Boolean).join(", ") : undefined}>
            <button className="btn is-ghost" aria-label={`Remove ${passkey.name || "passkey"}`} disabled={!unlocked} onClick={() => removeBiometric(passkey.id, passkey.name || "this passkey")}><Trash2 size={14} /></button>
          </Row>
        ))}
        {support?.available ? (
          <Row label={<span className="hidden-way"><Fingerprint size={14} /> {passkeys.length ? `Add another` : label}</span>} description={passkeys.length ? "Another device, or your phone." : `Open Hidden with ${label} instead of typing.`}>
            <button className="btn" disabled={!unlocked || busy === "passkey"} onClick={addBiometric}>{busy === "passkey" ? "Waiting…" : `Add ${passkeys.length ? "passkey" : label}`}</button>
          </Row>
        ) : null}
      </Group>

      <Group title="Auto-lock" note="Counts from the last time you touched the page. Other devices lock on their own clock.">
        <div className="segmented hidden-autolock" role="radiogroup" aria-label="Lock Hidden after">
          {autoLockChoices.map((choice) => (
            <button key={choice.value} type="button" role="radio" aria-checked={autoLock === choice.value} className={cn(autoLock === choice.value && 'active')} onClick={() => setPrefs({ hiddenAutoLockMinutes: choice.value })}>{choice.label}</button>
          ))}
        </div>
      </Group>

      <Group title="Take it with you">
        <Row label="Export Hidden" description="Every image in Hidden, decrypted, in one ZIP file. Treat the file like the pictures in it." disabled={!unlocked}>
          <a className={cn("btn", !unlocked && "is-disabled")} href={unlocked ? "/api/hidden/export" : undefined} aria-disabled={!unlocked} download><Download size={14} /> Export</a>
        </Row>
        <Row label="Encrypted backup" description="The same, still encrypted. It opens with your Hidden password and nothing else." disabled={!unlocked}>
          <a className={cn("btn", !unlocked && "is-disabled")} href={unlocked ? "/api/vault/export" : undefined} aria-disabled={!unlocked} download><Download size={14} /> Back up</a>
        </Row>
      </Group>

      <Group title="Start over" tone="danger" note="Forgot the password and lost every passkey? This is the only way back in, and it takes everything in Hidden with it.">
        <Row label="Erase Hidden" description="Erases every Hidden image, the password and all passkeys from this computer.">
          <button className="btn is-danger-soft" onClick={erase}><Trash2 size={14} /> Erase</button>
        </Row>
      </Group>
    </>
  );
}
