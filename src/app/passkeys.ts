/**
 * Touch ID, Windows Hello and phone passkeys for Hidden, through WebAuthn's
 * PRF extension: the authenticator turns a salt into a secret only it can
 * make, and that secret is what unwraps Hidden's key on the server. Where the
 * authenticator cannot do PRF (Chrome's and Arc's on-device store, many Windows
 * setups), a device passkey stands in: see below.
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

/* Device passkeys: for authenticators without PRF. The secret the server
   hands out is kept in IndexedDB, encrypted under an AES key the browser
   can use but never export. Unlocking needs that secret and a fresh
   Touch ID signature, which the server checks. */

const secretDb = "heiss-hidden";
const secretStore = "passkey-secrets";

function openSecrets(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(secretDb, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(secretStore);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function secretsTx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openSecrets();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(secretStore, mode).objectStore(secretStore));
    request.onsuccess = () => { resolve(request.result); db.close(); };
    request.onerror = () => { reject(request.error); db.close(); };
  });
}

type StoredSecret = { key: CryptoKey; iv: Uint8Array; data: ArrayBuffer };

export async function keepDeviceSecret(id: string, secret: string) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, fromBase64url(secret));
  await secretsTx("readwrite", (store) => store.put({ key, iv, data } satisfies StoredSecret, id));
}

async function deviceSecret(id: string) {
  const stored = await secretsTx<StoredSecret | undefined>("readonly", (store) => store.get(id)).catch(() => undefined);
  if (!stored) return "";
  return toBase64url(await crypto.subtle.decrypt({ name: "AES-GCM", iv: stored.iv as BufferSource }, stored.key, stored.data));
}

export async function hasDeviceSecret(id: string) {
  return Boolean(await secretsTx("readonly", (store) => store.getKey(id)).catch(() => undefined));
}

export async function forgetDeviceSecret(id: string) {
  await secretsTx("readwrite", (store) => store.delete(id)).catch(() => undefined);
}

export type RegisteredPasskey =
  | { mode: "prf"; id: string; salt: string; prf: string }
  | { mode: "device"; id: string; publicKey: string };

/**
 * Makes a passkey on this device. With PRF its secret becomes the key; without
 * it, the passkey signs challenges instead and the browser keeps a secret.
 */
export async function registerPasskey(): Promise<RegisteredPasskey> {
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
  if (prf?.results?.first) return { mode: "prf", id, salt, prf: toBase64url(prf.results.first) };
  if (prf?.enabled) {
    const evaluated = await evaluate(id, salt).catch(() => null);
    if (evaluated) return { mode: "prf", id, salt, prf: evaluated.prf };
  }
  const publicKey = (credential.response as AuthenticatorAttestationResponse).getPublicKey?.();
  if (!publicKey) throw new PasskeyWithoutSecretError("This passkey shares neither a secret nor its public key.");
  return { mode: "device", id, publicKey: toBase64url(publicKey) };
}

export type PasskeyOption = { id: string; kind: "prf" | "device"; salt?: string };
export type PasskeyAnswer = { id: string; prf: string } | { id: string; secret: string; clientDataJSON: string; authenticatorData: string; signature: string };

/** Asks for any of Hidden's passkeys that this browser can use, and returns what unlocks with it. */
export async function unlockWithPasskey(passkeys: PasskeyOption[], challenge: string): Promise<PasskeyAnswer> {
  // A device passkey only works where its secret was kept, so only those are offered here.
  const usable: PasskeyOption[] = [];
  for (const passkey of passkeys) {
    if (passkey.kind !== "device" || await hasDeviceSecret(passkey.id)) usable.push(passkey);
  }
  if (!usable.length) throw new Error("No passkey for Hidden is set up in this browser. Use your password.");
  const prfKeys = usable.filter((passkey) => passkey.kind === "prf" && passkey.salt);
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: challenge ? fromBase64url(challenge) : crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: usable.map((passkey) => ({ type: "public-key" as const, id: fromBase64url(passkey.id) })),
      userVerification: "required",
      timeout: 60_000,
      ...(prfKeys.length ? { extensions: { prf: { evalByCredential: Object.fromEntries(prfKeys.map((passkey) => [passkey.id, { first: fromBase64url(passkey.salt!) }])) } } as AuthenticationExtensionsClientInputs } : {})
    }
  }) as PublicKeyCredential | null;
  if (!assertion) throw new Error("No passkey answered.");
  const id = toBase64url(assertion.rawId);
  const used = usable.find((passkey) => passkey.id === id);
  if (used?.kind === "device") {
    const response = assertion.response as AuthenticatorAssertionResponse;
    return {
      id,
      secret: await deviceSecret(id),
      clientDataJSON: toBase64url(response.clientDataJSON),
      authenticatorData: toBase64url(response.authenticatorData),
      signature: toBase64url(response.signature)
    };
  }
  const first = prfOf(assertion)?.results?.first;
  if (!first) throw new PasskeyWithoutSecretError("This passkey did not return a secret.");
  return { id, prf: toBase64url(first) };
}
