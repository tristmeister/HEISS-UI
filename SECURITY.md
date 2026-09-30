# Security

HEISS UI is built to run on your own machine, for you. By default it answers only this computer: it listens on `127.0.0.1`, and nothing about it is reachable from your network or the internet.

## Who may do what

| Who | Can use the studio | Can look after the computer* | Can change passwords, the admin switch, sign-ins |
| --- | --- | --- | --- |
| This computer (`http://localhost:8787`) | Yes | Yes | Yes |
| A device signed in with the studio password (LAN mode) | Yes | Only with **Trust other devices with admin** on | No |
| A device that hasn't signed in, or LAN mode off | No | No | No |
| Anything reached through a proxy or tunnel on this computer | Like any other device: it signs in | Same as a device | No |
| Another website open in your browser | No | No | No |

\* Updates, node and model installs, the output folder, ComfyUI's address and restarts, clearing the gallery.

- **Other websites.** A page you visit shares your browser with HEISS UI and could send it requests. Every `/api` and `/comfy` request has to name HEISS UI's own address (so a hostname rebound to `127.0.0.1` gets nothing), and anything that changes state has to come from the studio's own page: same origin, and JSON or the studio's `X-HEISS` header, which no other site can send without a permission HEISS UI never grants.
- **Other devices** are only answered in LAN mode (**Settings › Connection › Open on other devices**, or `npm start -- --lan`), only from private network addresses, and only after signing in with the studio password. A sign-in lasts a week (`HEISS_DEVICE_SESSION_DAYS`); **Sign out all devices** ends every one of them. Wrong passwords lock the device's address out for longer each time, one try at a time; the computer itself is never slowed down by them.
- **Proxies.** A request that carries `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `Via` or a similar header is never treated as this computer, even though the proxy connects from it. Only use HEISS UI behind a proxy or tunnel with LAN mode on and a studio password set, and list the name it is reached by in `HEISS_ALLOWED_HOSTS`.
- **The network itself.** Plain http on your network is unencrypted: someone on the same Wi-Fi can read the studio password and a sign-in cookie. Use it only on a network you trust, or add a certificate under **Settings › Connection › HTTPS** (for example from `tailscale cert`); then other devices use HTTPS, cookies are marked `Secure`, and plain http answers only this computer. Never expose HEISS UI to the public internet.

## What HEISS UI protects

- **Hidden** encrypts images, prompts and settings at rest (AES-256-GCM under a random key, wrapped by your password with scrypt and by each passkey through WebAuthn PRF). It removes ComfyUI's working copies, history entries, reference copies and cached thumbnails of what goes into it, and shares from it leave out the prompt by default. It keeps things out of casual view; it is not a guarantee against someone with administrator access to the machine, disk recovery, swap, or backups taken while a job ran. See the Hidden section of the README.
- **Deleting.** **Delete all finished images** moves files to `.heiss-trash` in ComfyUI's output folder for 30 days (`HEISS_TRASH_DAYS`), so it can be undone. The output folder has to be one ComfyUI writes to, and HEISS UI only ever serves images, videos and sound from it (never through a link out of it).
- **Updates.** A release copy installs an update only after checking its SHA-256 and, once the maintainers' release key is set in the app, its Ed25519 signature; an unsigned or wrongly signed release is refused. A Git checkout updates with `git pull`.
- **Node packs** installed with one click come from a reviewed commit of each pack, and their Python requirements can't replace the PyTorch or NumPy ComfyUI runs on. When ComfyUI-Manager refuses an install because of its security level, HEISS UI stops and asks.
- **Model downloads** only come from HEISS UI's own catalog on Hugging Face, resume only while the remote file is unchanged, and are checked against their published SHA-256.
- **Workflows** you import can contain custom nodes that run code, read or write any file, or go online; the import review names them. A workflow runs every node in it with ComfyUI's access to your computer, so only import workflows from people you trust.
- **No telemetry.** HEISS UI talks to your ComfyUI, to GitHub to check for updates (release copies, switchable in Settings › About), to Hugging Face, GitHub or nodejs.org when you ask it to download or install something, and to the [feedback board](https://heiss-ui.vercel.app/board/) when you press Send in its dialog (only what the dialog shows). Nothing else.

## Reporting a vulnerability

Please report security issues privately through a [GitHub security advisory](https://github.com/tristmeister/HEISS-UI/security/advisories/new) rather than a public issue.
