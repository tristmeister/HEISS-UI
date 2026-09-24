/**
 * Touch ID, Windows Hello and phone passkeys for Hidden, through WebAuthn's
 * PRF extension: the authenticator turns a salt into a secret only it can
 * make, and that secret is what unwraps Hidden's key on the server. A passkey
 * that cannot do PRF is refused rather than used as a plain yes/no, because a
 * yes/no would need the key stored somewhere it could be read without one.
 */

export type PasskeySupport = {
  /** Platform biometrics can be offered here, right now. */
  available: boolean;
  /** What to call it: "Touch ID", "Windows Hello", "Face ID" or "a passkey". */
  label: string;
  /** Why it cannot be offered, in the person's terms. Empty when available. */
  reason: string;
  /** Passkeys need a name, not an address: this page would work at localhost instead. */
  localhostUrl: string;
};

export function platformLabel() {
  const ua = navigator.userAgent;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  if (/iPhone|iPad|iPod/.test(ua)) return "Face ID";
  if (/Mac/i.test(platform) || /Macintosh/.test(ua)) return "Touch ID";
  if (/Win/i.test(platform) || /Windows/.test(ua)) return "Windows Hello";
  if (/Android/.test(ua)) return "your fingerprint";
  return "a passkey";
}

const isIpAddress = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host === "[::1]";

export async function passkeySupport(): Promise<PasskeySupport> {
  const label = platformLabel();
  const host = window.location.hostname;
  const loopback = host === "127.0.0.1" || host === "[::1]" || host === "::1";
  const localhostUrl = loopback ? `${window.location.protocol}//localhost${window.location.port ? `:${window.location.port}` : ""}${window.location.pathname}` : "";
  if (!window.isSecureContext || !("PublicKeyCredential" in window)) {
    return { available: false, label, localhostUrl, reason: `${label} needs this page on this computer or over HTTPS. Use the password here.` };
  }
  if (isIpAddress(host)) {
    return { available: false, label, localhostUrl, reason: loopback ? `${label} works when HEISS UI is opened at localhost rather than ${host}.` : `${label} is not available at a network address. Use the password here.` };
  }
  try {
    const platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    const capabilities = await (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.().catch(() => null);
    if (capabilities && capabilities["extension:prf"] === false) {
      return { available: false, label, localhostUrl: "", reason: `This browser cannot unlock with ${label} yet. Chrome, Edge and Safari can.` };
    }
    if (!platform) return { available: false, label, localhostUrl: "", reason: `${label} is not set up on this device.` };
  } catch {
    return { available: false, label, localhostUrl: "", reason: `${label} is not available in this browser.` };
  }
  return { available: true, label, localhostUrl: "", reason: "" };
}

export function toBase64url(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer } };
const prfOf = (credential: PublicKeyCredential) => (credential.getClientExtensionResults() as { prf?: PrfResults }).prf;

/** Thrown when the passkey was made but cannot produce a secret, so it cannot unlock Hidden. */
export class PasskeyWithoutSecretError extends Error {}

/** A cancelled or timed-out system prompt, told apart from real failures. */
export function passkeyCancelled(error: unknown) {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
}

async function evaluate(id: string, salt: string) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: [{ type: "public-key", id: fromBase64url(id) }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { evalByCredential: { [id]: { first: fromBase64url(salt) } } } } as AuthenticationExtensionsClientInputs
    }
  }) as PublicKeyCredential | null;
  const first = assertion ? prfOf(assertion)?.results?.first : undefined;
  if (!assertion || !first) throw new PasskeyWithoutSecretError("This passkey did not return a secret.");
  return { id: toBase64url(assertion.rawId), prf: toBase64url(first) };
}

/** Makes a passkey on this device and gets its secret, asking for the finger or face at most twice. */
export async function registerPasskey(): Promise<{ id: string; salt: string; prf: string }> {
  const salt = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: window.location.hostname, name: "HEISS UI Hidden" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "Hidden", displayName: "HEISS UI · Hidden" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
      timeout: 60_000,
      extensions: { prf: { eval: { first: fromBase64url(salt) } } } as AuthenticationExtensionsClientInputs
    }
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was made.");
  const id = toBase64url(credential.rawId);
  const prf = prfOf(credential);
  // Chrome answers with the secret straight away; Safari and Windows only say it is possible.
  if (prf?.results?.first) return { id, salt, prf: toBase64url(prf.results.first) };
  if (prf && prf.enabled === false) throw new PasskeyWithoutSecretError("This passkey cannot return a secret.");
  const evaluated = await evaluate(id, salt);
  return { id, salt, prf: evaluated.prf };
}

/** Asks for any of Hidden's passkeys and returns the secret of the one that answered. */
export async function unlockWithPasskey(passkeys: Array<{ id: string; salt: string }>): Promise<{ id: string; prf: string }> {
  if (!passkeys.length) throw new Error("No passkey is set up for Hidden.");
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: passkeys.map((passkey) => ({ type: "public-key" as const, id: fromBase64url(passkey.id) })),
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { evalByCredential: Object.fromEntries(passkeys.map((passkey) => [passkey.id, { first: fromBase64url(passkey.salt) }])) } } as AuthenticationExtensionsClientInputs
    }
  }) as PublicKeyCredential | null;
  const first = assertion ? prfOf(assertion)?.results?.first : undefined;
  if (!assertion || !first) throw new PasskeyWithoutSecretError("This passkey did not return a secret.");
  return { id: toBase64url(assertion.rawId), prf: toBase64url(first) };
}
