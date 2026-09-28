<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/heiss-lockup-white.svg" />
    <img src="./public/heiss-lockup-black.svg" alt="HEISS UI" width="260" />
  </picture>
</p>

<h3 align="center">ComfyUI, without the graph.</h3>

<p align="center">
  A local front end for ComfyUI.<br />
  28 model families work out of the box, and your own ComfyUI workflows come along. Write a prompt and watch it render.
</p>

<p align="center">
  <a href="https://tristmeister.github.io/HEISS-UI/"><b>Website</b></a>
  &nbsp;·&nbsp;
  <a href="#quick-start">Quick start</a>
  &nbsp;·&nbsp;
  <a href="#supported-models">Models</a>
  &nbsp;·&nbsp;
  <a href="#bring-your-own-workflow">Your own workflows</a>
  &nbsp;·&nbsp;
  <a href="#on-your-phone">Phone</a>
  &nbsp;·&nbsp;
  <a href="#troubleshooting">Help</a>
  &nbsp;·&nbsp;
  <a href="#faq">FAQ</a>
</p>

<p align="center">
  <img src="./docs/screenshots/hero.jpg" alt="HEISS UI: a masonry gallery of generated photographs, two still resolving as pixel mosaics, with the prompt composer floating at the bottom" width="1100" />
</p>

<p align="center">
  <sub>Free and open source under MIT. Built on the great work of <a href="https://github.com/jasperdevs/J-AI-Studio">J-AI Studio</a> by Jasper. <a href="#credits">More on that below.</a></sub>
</p>

---

HEISS UI sits on top of the ComfyUI you already run. You get a prompt box, a gallery and the settings that matter for the model you picked. ComfyUI still runs every job and keeps your nodes, models and outputs.

The node graph is great for building workflows and less great for the everyday loop of prompt, wait, look, tweak. HEISS UI is for that loop, and your workflows come along.

## Features

- **28 model families out of the box.** 21 for images and 7 for video (beta), from SD 1.5 and SDXL to Flux.2, Qwen-Image, Krea 2, Wan 2.2 and MiniMax H3, each with the settings from its makers' own templates. [The full list ↓](#supported-models)
- **Missing parts are a click away.** Pick a model to see what it still needs. Each part gets a Download or Install button, and **Get all** fetches the lot. With no model yet, the studio offers [a first one](#your-first-model). [What's covered ↓](#auto-downloads)
- **A phone studio.** On a phone the studio switches to a layout made for one thumb. Prompt, browse, share and upscale from the couch while the computer renders. [Set it up ↓](#on-your-phone)
- **Bring your own workflow.** Import a ComfyUI workflow (API or visual JSON) and it becomes a set of controls, with your graph running underneath. [How it works ↓](#bring-your-own-workflow)
- **Hidden.** A locked place for images you keep to yourself. Generate into it or hide anything later, and unlock with Touch ID, Windows Hello or a password. [More ↓](#hidden)

<details>
<summary><b>More features</b></summary>

- **Reference and start images.** Edit models like Flux.2 and Qwen-Image 2.1 take reference images. Every other image model takes a start image, with a slider for how much it may change. [More ↓](#reference-and-start-images)
- **LoRA stacks.** LoRAs grouped by folder, stacked per run and saved per model family, right below Basics in the sidebar. LoRAs made for the selected model sort first and show their trigger words.
- **Upscale and compare.** Upscale any image with SeedVR2, with an optional face detail pass, then drag a slider across it to see what changed.
  <!-- MEDIA: GIF · upscale compare: open an image → Upscale → drag the compare slider across it · ~6 s loop · 1100 px wide · save as docs/screenshots/upscale-compare.gif -->
- **Live previews.** Each image resolves from a pixel mosaic into the final result while ComfyUI works, with a countdown to done. Queue the next one or cancel any time.
- **Controls that fit the model.** Models, samplers, schedulers, size and prompt limits, text encoders and VAEs come from ComfyUI. Only what the selected model uses shows up.
- **Zen mode.** A fullscreen prompt and output view without the panels.
- **Find it again.** Press ↑ in an empty prompt for recent prompts (star the ones to keep), `/` to search the gallery by prompt, model or LoRA, and star images to keep them close. Earlier images from other folders (old ComfyUI outputs, AUTOMATIC1111, Forge) join the gallery where they are, from Settings › Library. Recent prompts can be turned off in Settings › Generation, and prompts from Hidden aren't saved.
  <!-- MEDIA: GIF · find it again: ↑ in an empty prompt opens recent prompts → star one → / searches the gallery by a LoRA name · ~8 s loop · 1100 px wide · save as docs/screenshots/find-it-again.gif -->
- **Civitai-ready images (beta).** With this on in Settings › Library, new PNGs also carry the prompt, LoRAs and settings the way AUTOMATIC1111 writes them, so Civitai fills in an upload.

</details>

<p align="center">
  <a href="./docs/screenshots/realtime-generation.mp4"><img src="./docs/screenshots/realtime-generation.gif" alt="Two new images resolving live in the gallery, from pixel-mosaic step previews to the finished photograph" width="100%" /></a>
</p>

## Quick start

**1. Download** the zip for your system from the [latest release](https://github.com/tristmeister/HEISS-UI/releases/latest):

| Windows | macOS (Apple Silicon) | Linux |
| --- | --- | --- |
| [`heiss-ui-*-windows-x64.zip`](https://github.com/tristmeister/HEISS-UI/releases/latest) | [`heiss-ui-*-macos-arm64.zip`](https://github.com/tristmeister/HEISS-UI/releases/latest) | [`heiss-ui-*-linux-x64.zip`](https://github.com/tristmeister/HEISS-UI/releases/latest) |

The plain `heiss-ui-*.zip` (no system in its name) is for in-app updates; you can skip it.

**2. Unpack it and double-click Start HEISS UI** (`.bat` on Windows, `.command` on macOS, `.desktop` on Linux), or run `npm start` in the folder. Node.js and the packages are inside, so there's nothing else to install, and the studio opens in the browser.

**3. Have ComfyUI running.** ComfyUI on this computer connects on its own, at `http://127.0.0.1:8188` or ComfyUI Desktop's port 8000. On another machine or port, set its address in **Settings › Connection**. [No ComfyUI yet?](#no-comfyui-yet)

<details>
<summary><b>Windows: first launch</b></summary>

Unpack with **Extract All** first; the launcher doesn't run from inside the zip. If Windows asks whether to run a downloaded file, right-click the zip › Properties › **Unblock** before unpacking. A plain folder such as `C:\HEISS-UI` works better than a Desktop or Documents folder synced by OneDrive, which can lock files during installs and updates.

</details>

<details>
<summary><b>macOS: first launch</b></summary>

The first time you open `Start HEISS UI.command`, macOS may say it can’t check the file. Right-click it › **Open**, then **Open** again (or allow it under System Settings › Privacy & Security).

</details>

<details>
<summary><b>Linux: first launch</b></summary>

File managers open a `.sh` in a text editor. Right-click `Start HEISS UI.desktop` › **Allow Launching**, then double-click it (it runs in a terminal), or run `./"Start HEISS UI.sh"`.

</details>

<details>
<summary><b>Install from source</b></summary>

To follow `main` or change the code. This needs **Node.js 20.9+** (22 LTS or newer recommended); the downloads bring their own.

```bash
git clone https://github.com/tristmeister/HEISS-UI.git heiss-ui
cd heiss-ui
npm install
npm start
```

`npm start` builds the app the first time, then opens **http://localhost:8787** in the browser (or the next free port if that one is taken). Models, samplers and VAEs show up once ComfyUI is connected.

ComfyUI on another machine or port? Set its address in **Settings › Connection**, or copy `.env.example` to `.env` and set `COMFY_URL`.

</details>

<details>
<summary><b>Paste into an agent</b>: let Claude Code, Codex or another coding agent do the setup</summary>

Paste this in. It checks your setup, installs everything and confirms the app can reach ComfyUI. Models only download if you ask for them.

```text
Install and run HEISS UI from GitHub: https://github.com/tristmeister/HEISS-UI

Do the full local setup:

1. Check whether Node.js 20.9+ is installed (22 LTS recommended).
2. Check whether ComfyUI is installed and running at http://127.0.0.1:8188 (ComfyUI Desktop: http://127.0.0.1:8000).
3. If ComfyUI is not running, help me start my existing ComfyUI install. Do not download models unless I ask.
4. Clone https://github.com/tristmeister/HEISS-UI into a normal projects folder.
5. Run npm install.
6. Copy .env.example to .env only if configuration changes are needed.
7. Set COMFY_URL to my ComfyUI URL, usually http://127.0.0.1:8188.
8. Run npm run build.
9. Start the app with npm start.
10. Open http://localhost:8787 and check that the app reaches ComfyUI, detects models and loads the gallery.
11. For future updates, use Settings > About > Install update, or run git pull, npm install and npm run build.

Keep everything local. Do not open it to other devices (npm start -- --lan, or Settings > Connection > Open on other devices) unless I ask for phone or LAN access. If something fails, read the error, check ComfyUI /object_info and /system_stats, and fix the setup instead of guessing.
```

</details>

### No ComfyUI yet?

ComfyUI does the generating; HEISS UI is the studio on top. Install it once and leave it running while you work.

| Your computer | Install |
| --- | --- |
| **Windows** | [ComfyUI Desktop](https://www.comfy.org/download) for NVIDIA graphics cards. With an AMD card, or to keep everything in one folder, the [portable version](https://docs.comfy.org/installation/comfyui_portable_windows). |
| **Mac** | [ComfyUI Desktop](https://www.comfy.org/download), for Apple Silicon (M1 or later) on macOS 13 or newer. |
| **Linux** | The [install guide](https://docs.comfy.org/installation/manual_install) (NVIDIA or AMD with ROCm), or [ComfyUI on GitHub](https://github.com/comfyanonymous/ComfyUI). |

<details>
<summary><b>Ports and how much memory you need</b></summary>

A manual or portable install uses port 8188 and ComfyUI Desktop 8000, and both connect without any setup. A graphics card with 8 GB runs SDXL and the compact Flux.2 Klein; 12 to 16 GB is comfortable, and 24 GB or more runs nearly everything. On a Mac, 16 GB of memory runs SDXL, 18 GB or more Flux.2 Klein, and 48 GB or more Krea 2. **No ComfyUI yet?** on the offline screen says the same for your system.

</details>

### Your first model

With no model installed, the studio offers three to start with: **Krea 2**, **Flux.2** and **SDXL**, each in three sizes. The one that suits your computer is marked, and the others are a tap away. One tap downloads the model with its text encoder and VAE, then selects it with a prompt ready to try. The model menu shows the same offer until the first model is installed. [Sizes ↓](#what-runs-where)

<!-- MEDIA: GIF · first run: Pick a first model with the suggested size marked → one tap → download progress → model selected with a prompt ready · ~8 s loop · 1100 px wide · save as docs/screenshots/first-model.gif -->

## Supported models

Model files are recognised from their weights, so a renamed file still works. Each family runs with the sampler, scheduler, steps, CFG, shift and resolution from its official ComfyUI templates and model cards, so a fresh install makes good images without touching a setting.

**Image:** 21 families, from SD 1.5 and SDXL to Flux.2, Qwen-Image, Krea 2 and Ideogram 4. **Video (beta):** 7, including Wan 2.2, HunyuanVideo 1.5 and MiniMax H3.

<details>
<summary><b>All supported models</b></summary>

| | Families |
| --- | --- |
| **Image** | Ideogram 4, Krea 2 (Turbo, Raw), MageFlow, ERNIE-Image, Anima, Z-Image (Turbo, Base), Lumina Image 2.0 (including Neta Lumina and NetaYume), Sana (1.5, Sprint, 2K/4K), Flux.2 Dev, Flux.2 Klein 4B and 9B, Pony V7, Chroma, Qwen-Image (including 2512) and Qwen-Image 2.1, HiDream I1, SD 3.5, Flux.1 (Dev, Schnell, de-distilled), SDXL (NoobAI, Illustrious, Pony, v-prediction, DMD2, Hyper, Lightning, Turbo), SD 2.x and SD 1.5 |
| **Video** (beta) | MiniMax H3, HunyuanVideo 1.5 (text and image to video), Wan 2.2 5B, Wan 2.2 14B (high and low-noise pair, text and image to video) and Wan 2.1 |

Both all-in-one checkpoints and model-only files work. Parts a file doesn't carry come from compatible files already installed, or get a Download button. A file that isn't recognised can be given a type under **Settings › Models › Model types**.

Adding a family is mostly data. [MODELS.md](./MODELS.md) walks through it.

</details>

<details>
<summary><b>GGUF, Nunchaku and other formats</b></summary>

**GGUF** files run through the [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) node pack, which installs in one click. The current ComfyUI-GGUF doesn't load Krea 2, Ideogram 4, MiniMax H3 or Qwen-Image 2.1 GGUFs yet, so use their safetensors versions for now ([details](./docs/gguf-research.md)). Nunchaku, NF4 and other formats that need their own loader nodes aren't supported. For those, get them running in ComfyUI first and bring them over as [your own workflow](#bring-your-own-workflow).

</details>

### What runs where

The first models the studio offers, with their download size and the memory they run in comfortably. The graphics card is read from ComfyUI, and the largest version that fits is marked. Everything stays selectable. A larger model on a smaller card still runs, only slower, as ComfyUI moves parts of it in and out of memory.

<details>
<summary><b>Download sizes and memory, by model</b></summary>

| Model | Version | Download | Graphics card | Mac |
| --- | --- | --- | --- | --- |
| Krea 2 | Turbo, compact (fp8) | 18.2 GB | 16 GB | 48 GB |
| Krea 2 | Turbo | 31.4 GB | 32 GB, with 48 GB RAM | 48 GB |
| Krea 2 | Raw | 31.4 GB | 32 GB, with 48 GB RAM | 48 GB |
| Flux.2 | Klein 4B, compact (fp8) | 8.8 GB | 8 GB | 18 GB |
| Flux.2 | Klein 4B | 12.5 GB | 12 GB | 18 GB |
| Flux.2 | Dev | 53.8 GB | 32 GB, with 64 GB RAM | 128 GB |
| SDXL | RealVisXL V5.0 Lightning | 6.9 GB | 6 GB | 16 GB |
| SDXL | RealVisXL V5.0 | 6.9 GB | 8 GB | 16 GB |
| SDXL | SDXL 1.0 | 6.9 GB | 8 GB | 16 GB |

A Mac shares one memory between CPU and GPU, and macOS lets the GPU use part of it. The estimate counts on 70%, or the GPU limit if you raised it (`iogpu.wired_limit_mb`). fp8 files save download and disk space on a Mac but not memory, since they load at full precision there. [Hardware notes](./docs/hardware-notes.md) has the details and sources.

</details>

## Bring your own workflow

The built-in models cover the everyday loop. For anything custom, bring your graph.

1. **Export.** Build and test the graph in ComfyUI, then export it (**API format** works best; the regular workflow file works too).
2. **Drop.** Open the **Workflow Gallery** from the dock and drop the file on it, or paste the JSON.
3. **Check the connections.** The usual inputs are connected for you. Change any of them under **Change connections**, then import.

The workflow shows up in the model menu under **Your workflows** once the nodes it needs are installed.

<!-- MEDIA: PNG · workflow import review: a dropped workflow with its connected controls, one guessed connection marked, and Change connections open · still · 1100 px wide · save as docs/screenshots/workflow-review.png -->

<details>
<summary><b>What gets connected, and what the review shows</b></summary>

The prompt, negative prompt, size, seed, steps, CFG, sampler, scheduler, denoise, frames and start image are connected for you. The review shows what follows the studio's controls and what stays as saved, marks connections that were guessed, and lets you change any of them under **Change connections**. It also points out nodes that run code, touch files elsewhere or go online.

Only the connected inputs change; everything else runs as exported. If it uses a known model file you don't have, there's a Download button; otherwise the review says which folder the file belongs in.

</details>

<details>
<summary><b>Advanced: a <code>heissUi</code> block</b></summary>

To ship a workflow with its connections fixed, add a mapping to the exported JSON and drop the file into the `workflows/` folder:

```json
{
  "heissUi": {
    "id": "my-workflow",
    "name": "My Workflow",
    "kind": "image",
    "controls": {
      "prompt": { "node": "4", "input": "text" },
      "steps": { "node": "7", "input": "steps" },
      "seed": { "node": "7", "input": "seed" }
    }
  }
}
```

The [workflow guide](./workflows/README.md) covers the full control list, image-to-image inputs and LoRA loaders.

</details>

## Auto-downloads

Getting a new model running in ComfyUI usually means hunting for the right text encoder, the right VAE and a custom node pack or two. Here each part gets a button, and **Get all** fetches the lot. Nothing downloads until you press the button.

<!-- MEDIA: GIF · missing parts: pick a model → setup lists the missing text encoder and VAE → Get all → parts tick off → “Krea 2 is ready” · ~10 s loop · 1100 px wide · save as docs/screenshots/missing-parts.gif -->

<details>
<summary><b>What's covered</b></summary>

- **What each model needs.** Pick a model to see what's missing, whether that's a text encoder, a VAE, a companion file (like Wan 2.2's low-noise half), a custom node pack or a newer ComfyUI. The model menu shows what each model lacks, and a blocked Generate opens that model's setup.
- **One click per part, or Get all.** Files come from Hugging Face into the folders ComfyUI reads from, including shared folders set up in `extra_model_paths.yaml`. **Get all** adds up the sizes and checks free space first. Where an abliterated text encoder exists, it comes first; other builds (smaller precisions, Comfy-Org's own) are under **Other versions**. A build that has moved or is gated falls back to the next one.
- **Custom node packs (beta).** Packs listed in ComfyUI-Manager install through it. Otherwise, with ComfyUI on this computer, the pack is cloned and its requirements installed with ComfyUI's own Python. The manual steps stay one tap away.
- **Downloads that hold up.** Progress, speed and time left show as they run. Downloads resume after a restart, retry a dropped connection and check free space first, and gated files link to their Hugging Face page.
- **Ready at the end.** Each part is ticked off as it lands, and the last one turns the panel into “Krea 2 is ready”. Progress survives a ComfyUI restart halfway through.

</details>

## Reference and start images

- **Reference images for edit models.** Flux.2 (Klein 4B, Klein 9B and Dev) and Qwen-Image 2.1 edit from reference images the way ComfyUI's own edit templates do.
- **Start images for everything else.** Every other built-in image model (Krea 2, SDXL, Flux, Z-Image and the rest) offers **Add start image**, with a Change slider for how far the result may move from it.

<!-- MEDIA: PNG · reference images: the composer with two reference slots filled and the reference library open · still · 1100 px wide · save as docs/screenshots/reference-images.png -->

<details>
<summary><b>Reference slots, the library and your workflows</b></summary>

- **One slot after another.** The composer offers one reference slot after another as you fill them, and the first reference frames the result.
- **A reference library in the composer.** Pick from uploads or your own generations, drop files in, or send any image from the viewer. An upscaled image is used upscaled.
- **Your workflows too.** Imported workflows can take reference images and let one set the output size and aspect.

</details>

## On your phone

On a phone the studio switches to its own layout, made for one thumb. To set it up, turn on **Settings › Connection › Open on other devices** and set a **studio password** under Signing in. Settings then lists each address to open from the phone, each with a QR code. Only do this on a network you trust.

<!-- MEDIA: GIF · phone studio: prompt → tile resolves → long press → Share → share sheet · ~6 s loop · 390 px wide (phone screen) · save as docs/screenshots/phone-studio.gif -->

<details>
<summary><b>The phone layout</b></summary>

The gallery runs edge to edge, and one **Describe…** pill opens the prompt, reference image, workflow, shape and number of images, with Advanced one link away. Long press a tile to Share, Upscale, Star, Use these settings, Hide or Delete. Share hands the file to the phone's share sheet. Added to the home screen, it opens full screen, with haptics where the phone supports them. A ring around Generate shows progress while you browse.

**Use the full studio** under More switches a phone to the complete layout, and `?phone=1` shows the phone studio on any screen.

</details>

<details>
<summary><b>More on setup</b></summary>

Switching on **Open on other devices** restarts HEISS UI on your network. For a single session, start with `npm start -- --lan` (or `npm run dev:lan` in a checkout) instead. The first time, your system may ask whether Node.js can accept connections; allow it for private networks.

</details>

<details>
<summary><b>Security details</b>: signing in, admin, HTTPS, proxies</summary>

- **Signing in.** Phones and other computers sign in once with the studio password and stay signed in for a week. The studio password only lets devices in; Hidden keeps its own password and unlocks on the phone the same way as on the computer. (Until a studio password is set, the Hidden password signs devices in.) Each wrong password locks that device out a little longer, and this computer isn't slowed down by them. **Settings › Connection** lists the signed-in devices, and **Sign out all devices** ends every session.
- **Admin stays at the computer.** Updates, node packs and model downloads, the ComfyUI address, the output folder, the Hugging Face token, importing and deleting workflows, restarts and clearing the gallery are for the computer running HEISS UI, and other devices don't show those controls. Turn on **Trust other devices with admin** (at the computer) to allow them from signed-in devices too. The passwords, that switch, HTTPS and signing devices out only change at the computer.
- **HTTPS.** Over plain http, what devices send (the studio password too) crosses the network unencrypted, and the phone's share sheet isn't available (Share saves the file instead). Under **Settings › Connection › Advanced › HTTPS for other devices**, add a certificate that browsers already trust, for example the two files `tailscale cert <machine>.<tailnet>.ts.net` writes (or set `HEISS_TLS_CERT` and `HEISS_TLS_KEY` in `.env`). After a restart, other devices open `https://<that name>:8788` (`HEISS_HTTPS_PORT`), and this computer keeps `http://localhost:8787`. There's no self-signed option, since a warning people learn to click through doesn't protect anything.
- **Behind your own proxy or tunnel** (Caddy, nginx, `tailscale serve`, cloudflared), every visitor counts as another device and signs in like a phone, even though the proxy connects from this computer. Add the name they use to `HEISS_ALLOWED_HOSTS`; requests for any other name are turned away.

</details>

## Hidden

Hidden is a place for the images you'd rather keep to yourself. Open it from the lock in the dock. The first time, it walks you through a password and, where the browser supports it, Touch ID or Windows Hello.

<!-- MEDIA: GIF · Hidden unlock: lock in the dock → Touch ID prompt → Hidden opens on its own grid → Lock hides it again · ~6 s loop · 1100 px wide · save as docs/screenshots/hidden-unlock.gif -->

<details>
<summary><b>What works in Hidden</b></summary>

- **Generate straight into it.** Anything made while Hidden is open renders there, with the same live previews, and stays out of the gallery.
- **Hide anything, any time.** The eye on a tile (or in the viewer) moves an image into Hidden, or back out.
- **The usual tools work inside.** Upscale, compare, remix, reuse as a reference and video all work in Hidden, and anything made from a Hidden image stays hidden.
- **Locked means out of sight.** A locked Hidden shows no thumbnails and no count. It locks after a while without activity (Settings › Hidden › Auto-lock), or right away with **Lock**.

</details>

<details>
<summary><b>How Hidden keeps things private</b></summary>

Images, prompts, settings and upscales in Hidden are encrypted on disk with a key that only your password or a passkey can open. Touch ID and Windows Hello (beta) unlock that key directly. The normal gallery isn't affected, locked or not.

Passkeys need the page at `localhost` (not `127.0.0.1`) or over HTTPS, and a browser with passkey PRF support (current Chrome, Edge and Safari). Everywhere else, the password works.

ComfyUI writes a working file while it renders. That file is encrypted and removed when the run finishes, along with the run's entry in ComfyUI's history and any image ComfyUI was handed. Hiding an image later also removes its cached thumbnail and any copy ComfyUI kept from using it as a reference. Downloads and shares from Hidden leave out the prompt and workflow (Settings › Hidden › Share without settings). All of this needs ComfyUI's output folder, which is usually found without help and can be set in Settings › Library. Hidden keeps things out of casual view. It isn't a forensic guarantee against an administrator, disk recovery, swap, or backups taken while a job was running. [SECURITY.md](./SECURITY.md) has the technical details.

There's no password reset. If the password and every passkey are lost, **Erase Hidden** in Settings › Hidden starts over and takes everything in Hidden with it.

</details>

## Updating

**Settings › About › Install update** updates a downloaded release in place, and a Git checkout too as long as it has no local changes. A downloaded release also offers new versions in a small pill at the top.

<details>
<summary><b>How a downloaded release updates</b></summary>

**Settings › About › Install update** downloads the new release, checks that it's signed with the HEISS UI release key, and swaps it in when you press **Restart now**. A release without a valid signature isn't installed. The `data` folder, `.env` and installed packages stay where they are. The previous version is kept in `.update/backup` and comes back if the new one doesn't start, and a copy of the data waits in `data/.backups/` for 14 days in case you want to [go back a version](./TROUBLESHOOTING.md#going-back-to-an-earlier-version). This needs the copy to run through its launcher (or `npm start`) and a release from 0.3.1 on; older copies need one manual download first.

A downloaded release also checks for a new version every few hours and offers it once, in a small pill at the top with **Update** and then **Restart**. The check only asks GitHub for the latest version and stays quiet when you're offline. **Settings › About › Check automatically** turns it off. That choice and any **Later** are saved in `data/updates.json`.

</details>

<details>
<summary><b>Updating a Git checkout</b></summary>

**Settings › About › Install update** works as long as the checkout has no local changes; restart the server afterwards. From the terminal:

```bash
git pull
npm install
npm run build
npm start
```

`npm run check:updates` lists outdated dependencies.

</details>

## Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

```bash
COMFY_URL=http://127.0.0.1:8188
HOST=127.0.0.1
PORT=8787
HEISS_DATA_DIR=./data
COMFY_OUTPUT_DIR=
```

<details>
<summary><b>Configuration reference</b></summary>

`COMFY_OUTPUT_DIR` is optional; the folder is usually found without it. The folder is needed to delete files along with their cards and to remove ComfyUI's copies of what goes into Hidden. Settings only accepts a folder ComfyUI writes to (one with ComfyUI's images, or next to its `models` or `custom_nodes`). **Delete all finished images** moves them to `.heiss-trash` in that folder, where they wait 30 days (`HEISS_TRASH_DAYS`) in case you want them back.

For other devices: `HEISS_ALLOWED_HOSTS` (extra names to answer to, comma-separated), `HEISS_DEVICE_SESSION_DAYS` (how long a device stays signed in, 1 to 30 days, 7 by default), and `HEISS_TLS_CERT`, `HEISS_TLS_KEY` and `HEISS_HTTPS_PORT` for HTTPS. See [On your phone](#on-your-phone) and [SECURITY.md](./SECURITY.md).

Also optional: `HEISS_NO_BROWSER=1` keeps the launcher from opening the browser, and `HEISS_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` (or a token saved in **Settings › Models**) opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy.

</details>

<details>
<summary><b>Windows shortcut</b></summary>

A shortcut that starts ComfyUI and HEISS UI if they aren't running, then opens the browser. It starts HEISS UI through `scripts/start.mjs` like the launcher does, so in-app updates keep working:

```powershell
$appRoot = "C:\path\to\heiss-ui"
$comfyRoot = "C:\path\to\ComfyUI"
$python = "C:\path\to\python.exe"

if (-not (Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process $python "main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch" -WorkingDirectory $comfyRoot -WindowStyle Hidden
}

if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process node "scripts/start.mjs" -WorkingDirectory $appRoot -WindowStyle Hidden
}

Start-Process "http://localhost:8787/"
```

</details>

## Troubleshooting

[TROUBLESHOOTING.md](./TROUBLESHOOTING.md) covers the common problems in plain words, from ComfyUI not being found, the port and Node.js to each kind of failed generation, downloads and node packs, updates and phones. A failed card links to its section.

<details>
<summary><b>Quick fixes</b></summary>

- **No models showing up?** Make sure ComfyUI is running. On this computer it connects on port 8188 or 8000; anywhere else, set its address in Settings › Connection. After adding files, use **Settings › Models › Rescan**. With no model at all, the studio offers [a first one](#your-first-model).
- **A generation fails?** Open the card. It says what went wrong and offers a fix. **Copy report** includes versions and GPU for an issue.
- **A GGUF won't load?** See [ComfyUI-GGUF can't load this model yet](./TROUBLESHOOTING.md#comfyui-gguf-cant-load-this-model-yet).
- **Looking for video?** Switch the sidebar from Image to **Video** (beta). Wan 2.1, Wan 2.2 5B and 14B, HunyuanVideo 1.5 and MiniMax H3 run built in, and the model's setup lists anything missing.
- **Asking for help?** **Settings › About › Copy diagnostics** copies versions, system and GPU, without prompts or images.

</details>

## FAQ

<details>
<summary><b>Do I still need ComfyUI?</b></summary>

Yes. ComfyUI runs every job, and the controls come from what it has installed. Your ComfyUI install isn't changed, apart from the model files and node packs you choose to download, which go into its own folders.

</details>

<details>
<summary><b>Which models work?</b></summary>

28 families out of the box, 21 for images and 7 for video (beta). See [Supported models](#supported-models). Anything else runs as [your own workflow](#bring-your-own-workflow).

</details>

<details>
<summary><b>Where do my images go?</b></summary>

Into the normal ComfyUI output folder. Gallery data lives in a local data folder. There's no account and no cloud in between.

</details>

<details>
<summary><b>Why "HEISS"?</b></summary>

*Heiß* is German for hot. Hence the steaming cup.

</details>

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and the local API server together, and `npm test` runs the server and script tests. Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md), and leave generated media, model files, logs and `.env` files out of commits.

<details>
<summary><b>Missing packages and demo mode</b></summary>

Both `npm run dev` and `npm start` reinstall missing runtime packages, so an incomplete `node_modules` folder doesn't stop a normal start.

`npm run dev:demo` (or `HEISS_DEMO=1`) is for agent and UI testing without a GPU. When ComfyUI is unreachable it offers fake models and returns placeholder images. It's off otherwise, so a normal install shows ComfyUI as offline instead.

</details>

## Credits

HEISS UI started as a fork of **[J-AI Studio](https://github.com/jasperdevs/J-AI-Studio)** by **[Jasper](https://github.com/jasperdevs)**. The core idea of a prompt-first front end for ComfyUI, and a big part of the foundation this is built on, are his work. HEISS UI takes it in its own direction from there, with its own name, design and features.

If HEISS UI is useful to you, go give the original a star too.

Also standing on the shoulders of [ComfyUI](https://github.com/comfyanonymous/ComfyUI), which does the heavy lifting.

The app is set in [Geist](https://vercel.com/font). The pixel wordmark on the website uses PP Neue Bit by [Pangram Pangram](https://pangrampangram.com), a commercial font that ships with the site only and not with the app.

## License

[MIT](./LICENSE). The original J-AI Studio copyright notice is kept alongside HEISS UI's, as the license asks.
