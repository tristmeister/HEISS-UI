# Changelog

Every release of HEISS UI, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/) as described in
[CONTRIBUTING.md](CONTRIBUTING.md#versions-and-releases).

Add notes under **Unreleased** as changes land; `npm run release` turns that
section into the next version and uses it as the GitHub release notes.

## [Unreleased]

### Added
- ComfyUI coming back feels like pairing AirPods. With an empty gallery the
  offline plug snaps into its socket, the contact flashes, the socket warms
  up and the scene dissolves into the empty state; with images on screen a
  small "ComfyUI connected" card slides in and out. Models, workflows and
  smart upscale pick themselves up again without a reload.
- A new empty state for a gallery with nothing in it yet: a blank pixel
  canvas where a picture keeps developing and fading, like your first
  generation will.
- Sana also runs through ComfyUI-SANA (diffusers, runs on Apple Silicon): its
  model folders in `models/diffusers` show up as ready models, next to the
  ComfyUI_ExtraModels route for CUDA.
- Models that run on custom nodes say so where you pick them, in the sidebar
  and the workflow library, with an Install button. HEISS asks
  ComfyUI-Manager to install packs from its list, and installs the rest itself
  (git clone plus pip with ComfyUI's own Python) when ComfyUI runs on this
  computer. Smart upscale's SeedVR2 setup uses the same button. The manual
  steps are still there for a ComfyUI on another machine.
- MODELS.md documents how a new model family gets added.

### Fixed
- With ComfyUI stopped or restarting, every image in the gallery broke,
  because images were only ever fetched through ComfyUI. They now open from
  the output folder, and thumbnails from HEISS's own cache.
- A first start no longer flashes the empty state before it knows ComfyUI
  is offline.
- A finished image whose file would not load (moved, deleted, ComfyUI
  unreachable) showed the browser's broken-image icon with "Untitled prompt"
  over the tile. It now shows the tile's unavailable state, and every image
  with a source that can go missing falls back the same way.
- The offline screen vanished and restarted its animation every five
  seconds while HEISS checked ComfyUI again. Later checks now keep the
  screen, and the status dot, steady until the answer changes.
- Retry connection (and the composer's ComfyUI offline button) now say
  "Checking…" with a spinning icon while they ask ComfyUI again.

## [0.3.1] - 2026-09-24

### Added
- One-click updates for downloaded releases. **Install update** in
  Settings › About downloads the new release, checks it against its
  published SHA-256 and swaps it in on **Restart now**, then reloads the page.
  The data folder, `.env` and installed packages are never touched. The
  previous version is kept, and a new version that does not start is rolled
  back by itself, with a note in Settings saying so. Copies from 0.3.0 and
  earlier need one manual download to get this.

## [0.3.0] - 2026-09-24

### Added
- NVIDIA Sana runs built in. With the ComfyUI_ExtraModels custom nodes
  installed, SANA 1.5 (1.6B, 4.8B), SANA Sprint, the 2K/4K models and the
  multilingual model show up as ready models; ComfyUI fetches the weights,
  the Gemma 2 2B text encoder and the DC-AE VAE on first use. Sana files in
  `checkpoints/` are recognised from their weights, and without the nodes
  HEISS says which pack to install.

### Changed
- The ComfyUI offline screen shows an animated pixel plug that keeps trying
  to reach its socket, in the same cell style as the wordmark. It pauses when
  hidden, holds still for reduced motion and falls back to the logo without
  WebGL.
- Starting HEISS UI in a terminal shows the wordmark as a dot mosaic with an
  ember glow, plus the version and where to open it. It adapts to the
  terminal: Braille dots or half blocks, true colour, 256 colours or none.

### Fixed
- With ComfyUI offline, HEISS pretended to work: it listed fake "(Demo)"
  models and "generated" placeholder images. It now shows ComfyUI as offline
  and refuses to generate. Demo mode is a developer opt-in
  (`npm run dev:demo` or `HEISS_DEMO=1`) for testing without a GPU.
- A generate request ComfyUI would reject (a missing model, a bad slot)
  quietly became a placeholder image instead of an error.
- When an upscale effort ran on a different SeedVR2 weight because its own
  was not downloaded, Settings still just said Ready. It now says it is
  running on a fallback, names the weight, and offers the download again.
- With no models, the model picker opened an empty popover. It now says why
  there is nothing to choose.

## [0.2.1] - 2026-09-24

### Added
- **Restart ComfyUI** from Settings, and wherever a setup step ends in a
  restart, when ComfyUI-Manager is installed. If the control is off, it says
  why (no Manager, or a HEISS server too old for it).
- Failed generations explain themselves: the tile shows a plain title and a
  hint, and the viewer shows the full error with a report you can copy.

### Changed
- Model file setup lands files in the folders ComfyUI actually reads from,
  resumes a stopped download (even after a restart), shows progress in a pill
  at the top, and uses the same panel in the workflow gallery.
- Models that can only redraw a picture (Krea 2, SDXL, Flux, Z-Image and the
  other built-in image models) now offer **Add start image** instead of Add
  reference, and a Change slider next to the image sets how much it may change.

### Fixed
- Models, text encoders and VAEs in folders added through ComfyUI's
  `extra_model_paths.yaml` (a shared model drive, an A1111 install) were
  never read, so HEISS could not tell what they were. It now reads every
  folder ComfyUI loads from.
- A reference image added to a built-in model was ignored, even at 0%
  change. The composer could show a reference restored from a draft or a
  model switch that it then never sent; it now sends what it shows, and the
  server accepts a bare image id too.
- The workflow menu showed the gallery through its top half instead of frosted
  glass, and the Add reference chip clashed with prompt text running under it.
- Generation time stuck at 0s when the browser's and the server's clocks
  disagreed. It now counts on the server's clock.
- A run that saved nothing deleted its tile; it now stays as a failure.
- Deleting from the gallery no longer shows a toast; only a failed delete does.
- Installing an update no longer shows "Could not reach HEISS UI" while the
  server restarts, unless LoRA edits are really waiting to sync, and the app
  now confirms when the update landed.

## [0.2.0] - 2026-09-23

The first tagged release of HEISS UI, a local studio for ComfyUI, built on
[J-AI Studio](https://github.com/jasperdevs/J-AI-Studio) by jasperdevs. These
notes cover everything that changed since the fork.

### Highlights

- **Drop in a model and go.** HEISS reads each model file's weights to tell what
  it is: 16 image and 5 video families, from SD 1.5 to Krea 2, Wan 2.2 and
  MiniMax H3. It uses the settings the model's makers recommend and pairs it with
  a matching text encoder and VAE, or downloads one for you.
- **Smart upscale.** One click on a finished image runs SeedVR2 at Fast,
  Balanced or High effort, with an optional face pass and a before/after slider.
  A guided setup installs everything it needs.
- **LoRAs.** A searchable library grouped by folder, stacks saved per
  model family, favorites, recents, drag to reorder and undo.
- **Private Vault.** Encrypt chosen generations, their prompts and settings
  behind a password.
- **Prebuilt downloads.** Unzip, double-click Start HEISS UI, done: about 30 MB
  of runtime packages, no build step.

### Added

#### Models
- 21 model families recognised from the weights: SD 1.5, SD 2.x, SDXL (Pony,
  Illustrious/NoobAI, v-pred, Lightning, DMD2, Hyper, Turbo), Pony V7, SD 3.5,
  Flux.1 (dev, schnell, de-distilled), Flux.2 Dev and Klein 4B/9B, Chroma,
  HiDream, Qwen-Image (incl. 2512 and 2.1), Z-Image, Krea 2, Anima, Wan 2.1,
  Wan 2.2 5B, the Wan 2.2 14B high/low-noise pair, HunyuanVideo 1.5 and
  MiniMax H3.
- Each family runs with the settings from its official templates and model
  cards, including Turbo/Base and Raw variants, clip skip for Pony and
  Illustrious, and v-prediction for NoobAI merges.
- All-in-one checkpoints and model-only files both work. HEISS sees which parts
  a checkpoint carries and fills the rest from compatible installed files,
  preferring abliterated text encoders.
- Missing text encoders or VAEs are named with a one-click download into
  ComfyUI's folders.
- One text encoder picker per slot, and a "Built into the checkpoint" VAE option.
- A "Use as" picker in Settings for files HEISS can't identify, including the
  variant.

#### Smart upscale
- SeedVR2 upscaling from any finished image at Fast, Balanced or High effort,
  with an optional face detail pass. The original is always kept.
- A compare slider in the viewer: drag, double-click to centre, or use the arrow
  keys. Zoom and pan keep working while comparing.
- A guided setup: install the nodes through ComfyUI Manager or one terminal
  command (macOS, Linux, PowerShell, Command Prompt), download the model with
  resume and checksum checks, then upscale the image you clicked.
- A download widget with percent, speed and time left while setup runs.
- A popover that says why an image can't be upscaled.

#### LoRAs
- A LoRA library grouped by nested folders, with search, favorites, recents and
  suggestions for the current model family.
- Stacks saved per model family, shown as chips; one click loads a stack.
- Cards with an on/off switch, a strength slider, drag-to-reorder (keyboard too)
  and remove with undo, plus All off and Clear.
- Warnings for LoRAs missing from ComfyUI or past a workflow's limit.

#### Reference and start images
- A reference library in the composer with an Uploads tab and pointer-aware
  drops; the chosen image survives a reload.
- Workflows can let a reference image set the output size and aspect.
- A bundled Flux 2 image-edit workflow.

#### Workflows
- A thumbnail workflow gallery with search, an image/video switch, favorites,
  filters and a detail panel listing missing nodes.
- Two-step import that previews name, type, family, status and control mapping
  before saving. Drop JSON files anywhere on the gallery.

#### Studio
- Private Vault: password-protected, encrypted storage for chosen generations
  and their prompts and settings, with backup export.
- An About page with version, update check, credits and local stats: outputs,
  render time, megapixels, streaks and most-used workflow.
- Output folder tools: Browse, automatic detection and live checking.
- Gallery bundles that group runs.
- A clear offline state with Retry, and deep links from errors to the right
  settings.
- Better layout on phones and in Safari.

### Changed

- Rebranded to HEISS UI, with a new website, mark and wordmark. Settings saved
  under the old J-AI names are still read.
- The studio is rebuilt around the generation composer: no top bar, a compact
  dock, and one frosted glass, control size and radius throughout.
- Every dialog uses one modal; settings live in seven sections (General,
  Generation, Upscale, Library, Privacy, Connection, About).
- Generation previews resolve from a pixel mosaic and show step and elapsed time.
- Gallery thumbnails are small WebP images, about 20 times lighter.
- Geist replaces Inter; the ember accent now only marks status and heat.
- Toasts appear top centre and above dialogs.
- Picking a workflow of the other type switches between image and video.
- Escape leaves zen mode once nothing else is open.

### Fixed

- Generating and saving LoRA stacks over plain-HTTP LAN failed.
- LoRA edits could overwrite each other across devices or be lost offline.
- A crash could wipe settings; files are now written atomically with a backup.
- A wrong output folder silently hid generations.
- FLUX.1 Krea was mistaken for Krea 2, and renamed fine-tunes went unrecognised.
- Toasts, dropdowns and tooltips sat under dialogs.
- The gallery flashed as every tile replayed its new-image animation.
- Offline workflow checks reported every node as missing.
- Built-in workflows could be deleted.
- Many smaller LoRA, upscale and layout issues.

### Removed

- The top bar and logo.
- The Workflows tab in Settings (moved into Library).
- The DarkBeast example workflow.
- Unused icon libraries and packages: the install is less than half the size.

### Under the hood

- Runtime needs only express, busboy and sharp: 32 MB for a release install,
  down from 563 MB of `node_modules`.
- `npm start` builds and repairs itself on first run.
- One graph builder for every model family.
- Semantic versioning, a changelog and `npm run release`; tagging publishes the
  download.
- 56 automated tests, run in CI.

## [0.1.0]

The baseline HEISS UI grew from, forked from
[J-AI Studio](https://github.com/jasperdevs/J-AI-Studio). Never tagged.

[Unreleased]: https://github.com/tristmeister/HEISS-UI/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/tristmeister/HEISS-UI/releases/tag/v0.2.0
