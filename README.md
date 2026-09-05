<p align="center">
  <img src="./docs/screenshots/hero.jpg" alt="J AI Studio gallery view" width="1100" />
</p>

<h1 align="center">J AI Studio</h1>

<p align="center">A simple local image and video UI for ComfyUI, without the graph editor.</p>

<p align="center">
  <a href="#quick-start">Quick start</a>
  ·
  <a href="#ai-install-prompt">AI install prompt</a>
  ·
  <a href="#update">Update</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="https://jasperdevs.github.io/J-AI-Studio/">Website</a>
  ·
  <a href="#comfyui">ComfyUI</a>
  ·
  <a href="#license">License</a>
</p>

## Preview

### Zen mode

Fullscreen prompt-first generation.

<img src="./docs/screenshots/zen.jpg" alt="Zen mode screenshot" width="100%" />

### Fullscreen details

Inspect an output and copy its settings.

<img src="./docs/screenshots/fullscreen.jpg" alt="Fullscreen details screenshot" width="100%" />

### Realtime generation

Live ComfyUI previews while an image is running.

<a href="./docs/screenshots/realtime-generation.mp4"><img src="./docs/screenshots/realtime-generation.gif" alt="Realtime generation preview" width="100%" /></a>

## Features

- Prompt-first image and video generation
- Model-aware controls from ComfyUI node metadata
- Image and video galleries kept separate by mode
- Zen mode for a cleaner fullscreen workflow
- Live queue/progress cards with cancel controls
- Persistent local gallery metadata
- Optional Private Vault for encrypted, password-gated generations
- LAN Bridge: save images on a paired device and delete the host originals after verified delivery
- Start-image reuse when the selected ComfyUI workflow supports it
- Importable ComfyUI API workflow templates

## Quick Start

J AI Studio expects ComfyUI to already be installed and running.

```bash
npm install
npm run build
npm start
```

Open:

```text
http://127.0.0.1:8787
```

By default, the app connects to ComfyUI at:

```text
http://127.0.0.1:8188
```

## AI Install Prompt

Paste this into Codex, Claude Code, or another local coding agent:

```text
Install and run J AI Studio from GitHub: https://github.com/jasperdevs/J-AI-Studio

Please do the full local setup for me:

1. Check whether Node.js 20+ is installed.
2. Check whether ComfyUI is installed and running at http://127.0.0.1:8188.
3. If ComfyUI is not running, help me start my existing ComfyUI install. Do not download models unless I explicitly ask.
4. Clone https://github.com/jasperdevs/J-AI-Studio into a normal projects folder.
5. Run npm install.
6. Copy .env.example to .env only if configuration changes are needed.
7. Set COMFY_URL to my ComfyUI URL, usually http://127.0.0.1:8188.
8. Run npm run build.
9. Start the app with npm start.
10. Open http://127.0.0.1:8787 and verify the app can reach ComfyUI, detect models, and load the gallery.
11. For future updates, use Settings -> Update, or run git pull, npm install, and npm run build.

Keep everything local. Do not expose HOST=0.0.0.0 unless I ask for phone or LAN access. If something fails, read the error, check ComfyUI /object_info and /system_stats, and fix the setup instead of guessing.
```

## Requirements

- Node.js 20 or newer
- A running ComfyUI server
- Local ComfyUI model files

## Update

From the app, open Settings -> Update to check GitHub and install the latest commit for a Git checkout. Restart the local server after an update.

CLI fallback:

```bash
git pull
npm install
npm run build
npm start
```

To check dependency updates:

```bash
npm run check:updates
```

## ComfyUI

J AI Studio runs on top of ComfyUI. It reads available models, samplers, schedulers, size limits, prompt limits, text encoders, and VAEs from your local ComfyUI server where ComfyUI exposes them.

It does not replace ComfyUI, download models, train models, patch your ComfyUI install, or maintain a separate model runtime. ComfyUI remains the source of truth for installed nodes, model files, queue execution, previews, and output files.

<details>
<summary>Model support</summary>

The app is meant to be a simpler front end for common ComfyUI image and video generation, not a replacement for the graph editor.

Models appear when J AI Studio can detect enough ComfyUI metadata to build a generation workflow for them. If a model needs a custom graph, custom nodes, or special wiring, open it in ComfyUI first and confirm the required nodes are installed.

Workflow support is template-based. Built-in defaults cover common image/checkpoint/video paths. For anything else, export a ComfyUI API workflow and import it in Settings -> Workflows. Imported workflows appear only when their required ComfyUI nodes are installed.

For custom workflow files, see [`workflows/README.md`](./workflows/README.md).

Start-image controls only appear when the selected workflow exposes the required image input path through ComfyUI.

Generated files and model files stay local in your ComfyUI setup.

</details>

<details>
<summary>Configuration</summary>

Copy `.env.example` to `.env` if you need different ports or paths.

```bash
COMFY_URL=http://127.0.0.1:8188
HOST=127.0.0.1
PORT=8787
JAI_DATA_DIR=./data
COMFY_OUTPUT_DIR=
```

`COMFY_OUTPUT_DIR` is optional for the normal gallery. It is required for **Private Vault**: J AI uses it to ingest a finished Comfy output into encrypted vault storage, then removes the ordinary Comfy output file.

</details>

<details>
<summary>Private Vault</summary>

Private Vault is opt-in per generation. First set a privacy password in Settings, configure `COMFY_OUTPUT_DIR`, then use the **Private** switch beside the prompt.

J AI encrypts the original, gallery preview, prompt, settings, and asset key in a hidden data directory. Locked browsers receive anonymous private placeholders; after entering the password, J AI decrypts and streams the item with no-store cache headers. Download remains an explicit action.

ComfyUI necessarily writes a working output while it generates. J AI encrypts and removes that working file after completion; this is a privacy boundary for ordinary Finder/Explorer browsing, not a forensic guarantee against an administrator, disk recovery, swap, or backups made while generation was running.

</details>

<details>
<summary>Local network hosting</summary>

For another device on your network, set:

```bash
HOST=0.0.0.0
```

Then open the selected `PORT` in your firewall. Only do this on a trusted network.

</details>

<details>
<summary>LAN Bridge — save generated images on another device</summary>

Build with `npm run build`, set `COMFY_OUTPUT_DIR` in `.env`, and run `npm start`. You do not need your own certificate or `npm run start:lan`: J AI generates a local certificate authority on demand and opens its own LAN listeners, leaving your main `HOST`/`PORT` binding alone.

1. On the host, open the built app at `http://localhost:8787`, unlock Privacy, and open Settings → Privacy → LAN Bridge.
2. Click **Enable desktop bridge**. J AI creates a local CA plus a 90-day server certificate covering localhost, your hostname and your LAN addresses, then starts an HTTPS receiver on port **8788** and a plain-HTTP trust-setup page on port **8789** (both on `0.0.0.0`). On macOS and Windows it also installs the certificate into your own user trust store — approve the operating-system prompt. The bridge stays enabled across restarts until you disable it.
3. On the receiving computer, open the setup address shown in settings (`http://YOUR-LAN-HOST:8789/bridge/setup`). Compare the fingerprint on that page with the one under **Certificate fingerprint** on the host, then install the certificate. The page offers a macOS configuration profile, a Windows trust helper, and the raw public certificate; each embeds only the public CA, never a private key. Firefox needs the certificate imported in its own settings.
4. Back on the host, click **Create pairing code**. On the receiving computer follow **Continue to receiver** (`https://YOUR-LAN-HOST:8788/bridge/receive`), enter the six digits, and choose a device name. Codes are single-use and expire after five minutes; enter them on the receiver page, never on the setup page.
5. On the host, select the device under **Save new images to** and generate. Keep the receiver page open while receiving.
6. The receiver verifies the image, commits it to IndexedDB, reads it back and verifies it again, then acknowledges it. Only then does the host delete the original. Refreshes and lost acknowledgements are safe to retry.

Set `JAI_BRIDGE_PORT` and `JAI_BRIDGE_SETUP_PORT` to move those listeners. Keep them stable once devices are paired, because a receiver's library belongs to its web origin. If you would rather serve the whole app over a certificate you already manage, set `JAI_TLS_CERT` and `JAI_TLS_KEY` and run `npm run start:lan`; receivers can then use `https://YOUR-LAN-HOST:8787/bridge/receive` directly. That certificate must cover your LAN address and be trusted on the receiver, and only its public CA certificate belongs there. Either way, plain HTTP LAN connections are rejected by the bridge; localhost HTTP is available for development.

Bridge mode currently supports PNG image generation, including batches, up to 128 MB per image. Video, reference-image uploads and Private Vault are rejected in this mode because their additional writes are not covered by this output lifecycle. Custom workflows are allowed after a one-time per-session warning: J AI redirects and cleans up standard `SaveImage` nodes, and anything else your graph writes to disk stays your responsibility. Receiver credentials allow only that receiver's transfers, not host administration or gallery access. Pairing and device management require an unlocked session on the host computer. Pending transfers can be reassigned to a different paired receiver or explicitly discarded from Privacy settings; discarding confirms deletion even if no receiver has saved the image.

Images waiting for delivery remain under `COMFY_OUTPUT_DIR/.jai-bridge` and are excluded from gallery recovery and the J AI media proxy. A disconnected device does not cause deletion. The encrypted `.bridge` journal supports restart recovery; its local key is stored alongside it with restricted permissions, so it does not protect against an administrator with full host access. The generated authority lives in `JAI_DATA_DIR/.bridge/certificates` with the same restricted permissions — it is a real certificate authority for the machines that trust it, so treat that folder like a private key and delete it (then untrust the certificate on each receiver) if the host is ever compromised. ComfyUI must remain bound to localhost. Acknowledged transfer receipts contain no original image and let receivers safely retry after a lost response. Failed host cleanup is visible in Privacy settings and can be retried.

The receiver library lives in browser storage, not automatically in Photos or Files. Use **Export image** to save externally. Clearing site data removes the library; browser storage can be evicted unless persistence is granted. Export valuable images. The app never claims forensic erasure of SSD remnants, snapshots, backups, swap, or ComfyUI memory. This mode removes the host file after confirmed delivery; it cannot promise both immediate deletion before delivery and loss-free transfer.

Verification: `npm run test:bridge` tests isolation and deletion safety. `npm run preview:bridge` starts an isolated localhost fixture at port 8794 and prints a pairing code; each paired test device receives a sample PNG. It uses temporary storage and never connects to your ComfyUI. Stop it when finished.

</details>

<details>
<summary>Windows shortcut example</summary>

You can make a shortcut that starts ComfyUI, starts J AI Studio, and opens the browser.

```powershell
$appRoot = "C:\path\to\J-AI-Studio"
$comfyRoot = "C:\path\to\ComfyUI"
$python = "C:\path\to\python.exe"

if (-not (Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process $python "main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch" -WorkingDirectory $comfyRoot -WindowStyle Hidden
}

if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process node "server/index.js" -WorkingDirectory $appRoot -WindowStyle Hidden
}

Start-Process "http://127.0.0.1:8787/"
```

</details>

## Development

```bash
npm install
npm run dev
```

The dev command starts Vite and the local API server together.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Do not commit generated media, local model files, logs, or `.env` files.

## Troubleshooting

If no models appear, make sure ComfyUI is running and that `COMFY_URL` points to the right server.

If generation fails, confirm the selected model works in ComfyUI and that any required custom nodes are installed.

If video is missing, confirm your ComfyUI install has video generation nodes available.

## License

MIT
