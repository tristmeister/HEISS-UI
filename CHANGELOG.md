# Changelog

Every release of HEISS UI, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/) as described in
[CONTRIBUTING.md](CONTRIBUTING.md#versions-and-releases).

Add notes under **Unreleased** as changes land; `npm run release` turns that
section into the next version and uses it as the GitHub release notes.

## [Unreleased]

## [0.7.1] - 2026-09-24

### Added
- **Select several on the phone.** Long press › "Select several", then tap
  more images and Save, Hide or Delete them together (one question, one
  Undo). All/None and Back work as expected.
- **Progress while you browse.** A ring around the phone's Generate button
  fills as images render, the pill says which step they are on, and a small
  "Ready" card slides up when a result lands, tap to open.
- **Haptic feedback on Android phones:** a tick on Generate and selecting, a
  firmer one on long press, a double pulse when an image is ready, and a
  warning buzz on delete. (iPhones do not let web pages vibrate.)

### Changed
- The phone's Advanced sheet is its own layout: Image/Video, sampler and
  scheduler as native pickers, prompt strength and denoise as sliders with
  plain-language ends, a numeric seed field, size and video sliders, model
  parts, and LoRAs with bigger controls.
- Shared dialogs come up as bottom sheets on the phone (confirmations, the
  Hidden unlock, failure details), the viewer gets Compare for upscaled images
  and shows upscale notices above its bar, and Info moved to the top corner.

### Fixed
- **No way back to the phone studio.** After "Use the full studio" the only
  return was a Settings switch that showed only when the screen was narrow
  enough, so a phone held sideways (or a large one) had none. The full studio
  on a phone now shows a "Simple view" chip above the dock, the Settings
  switch stays once you have left, and phones are recognised in landscape too.
- **The phone's steps slider ran from 1 to 10,000.** It took the workflow's
  technical limit (ComfyUI's maximum). The range is now built around the
  workflow's default (a 4-step turbo model gets 1–24, a 20-step one 1–60),
  and a "Workflow default" chip puts it back in one tap.

## [0.7.0] - 2026-09-24

### Added
- **A phone studio.** On a phone, HEISS UI is now its own simplified app
  for making, browsing and sharing, laid out for your thumb: a slim top bar,
  the gallery edge to edge, and one "Describe…" pill that opens a full-height
  create sheet (prompt, reference image, workflow, shape, number of images,
  steps, and Advanced one link away). Pickers are bottom sheets you swipe
  away; tiles open on tap and show Share, Upscale, Make another, Hide and
  Delete on a long press; the viewer has a labelled action bar. Share hands
  the file to the phone's share sheet where the page allows it (HTTPS),
  otherwise it saves the file. Added to the home screen it opens full-screen.
  "Use the full studio" in More (and a switch in Settings) goes back to the
  complete layout; `?phone=1` shows the phone studio on any screen.

### Changed
- **Looking after the computer happens at the computer.** Model folders and
  downloads, node installs, ComfyUI's address and restarts, the output
  folder, updates, workflow import and delete, deleting every image, clearing
  the cache and changing the Hidden password are refused from other devices
  on the network, and the app hides them there instead of offering them.

### Changed
- **Restarting ComfyUI looks like restarting, not like a crash.** While a
  restart HEISS asked for is under way, the Generate button says
  "Restarting…", the status dot turns amber and pulses, the empty stage,
  Settings, restart buttons, workflow checks, Hidden setup and folder setup
  all say ComfyUI is restarting, and the studio checks every 1.5 seconds so it
  picks ComfyUI up the moment it is back. The server keeps the state, so
  every tab and device agrees. If ComfyUI has not returned after two and a
  half minutes, everything goes back to normal reconnecting with one message
  saying so.

### Fixed
- **GGUF models in `models/unet_gguf` kept being offered as "not read".**
  HEISS added that folder under ComfyUI-GGUF's `unet_gguf` name, which the
  pack replaces with the diffusion model folders when it loads, so ComfyUI
  never saw it and the prompt came back after every restart. Such folders
  are now added as diffusion models (which the GGUF loader inherits), and an
  entry written the old way is corrected the next time you press Add. When
  the folder is ComfyUI's own, the dialog says only its subfolder is new.

## [0.6.0] - 2026-09-24

### Added
- **Works on a phone.** The viewer closes with a corner button, a swipe down,
  a tap beside the picture or Back, and swipes sideways between images. The
  workflow menu, composer settings and tile actions all fit and stay on
  screen; the composer rides above the keyboard; controls clear notches and
  are big enough for a finger; landscape phones get a layout of their own.
- **The ComfyUI address is a setting.** Settings › Connection tests and saves
  it (ComfyUI Desktop on port 8000 no longer needs `.env` edits), and the
  offline screen shows where it is looking.
- **Other devices, explained.** Settings shows whether the studio listens on
  the network, every address to open, and how to turn it on. A phone that
  connects before Hidden is set up is told to finish setup on the computer.
- **Seeds are recorded,** so "Apply these settings" makes the same image
  again. A fixed seed shows as a chip in the composer, one tap from random.
- **Undo** for deletes (six seconds before the file goes), for moving to
  Hidden and for "Apply these settings".
- A **Models** section in Settings, a **keyboard shortcuts** list, arrow keys
  through the gallery, a "(n)" in the tab title when runs finish in the
  background, and a one-click install for the face detail pass's nodes.

### Changed
- **Deleting says what it does.** Deletes and "Delete all finished images"
  (was "Clear gallery") state that files leave the disk; anything permanent
  asks even with confirmations off; Backspace no longer deletes.
- Setup explains itself: missing workflow files are named with the folder
  they go in, downloads check free space and name full disks and gated files,
  Manager 4 gets its own install steps, Restart ComfyUI asks when work would
  stop, and Hidden can be set up while ComfyUI is offline.
- Keyboard and screen readers: the viewer is a proper dialog, the closed
  sidebar leaves the tab order, pickers, steppers and tabs follow the arrow
  keys, and generation progress is announced.

### Fixed
- Clicking just beside a tile's Delete button opened the viewer instead.
- Tiles no longer reshuffle between columns when a new result lands.
- One dropped request no longer marks every running generation as failed.
- A failed delete no longer vanishes from the screen; Stop only removes a
  tile once ComfyUI confirmed it.
- Model setup now notices a ComfyUI on another computer before a download
  is tried.

## [0.5.3] - 2026-09-24

### Changed
- **Downloads come with everything they need.** Each release has a zip per
  system (`-windows-x64`, `-macos-arm64`, `-linux-x64`) with its packages
  already inside, so the first start no longer runs an npm install; only
  Node.js has to be installed. Unpacked on the wrong system, it fetches the
  one piece that differs. In-app updates keep using the small zip.
- **The Windows download brings its own Node.js** (the current LTS, from
  nodejs.org, checked against its published checksums), so a Windows PC
  needs nothing installed besides ComfyUI. The launcher uses it and falls
  back to a Node.js on PATH. When a release wants a newer Node.js, the
  in-app update fetches it next to the old one and switches over once the
  new version has started.
- Updates no longer reinstall packages when only the version number in the
  lockfile changed.

## [0.5.2] - 2026-09-24

### Changed
- **The model menu stays manageable with many models.** It scrolls inside a
  capped height with "Find more models" pinned below, gets a search field
  once there are more than eight models, and splits into Favorites (star any
  model), Recent and the rest grouped by family. Arrow keys and Enter pick,
  and typing searches. Picking a model in the composer now counts as recent
  too.

### Fixed
- Leaving Hidden no longer flashes the loading mosaic over the gallery; the
  gallery comes straight back and syncs behind it.

## [0.5.1] - 2026-09-24

### Added
- Four more model families run out of the box, with the settings from
  Comfy-Org's own workflows: **Ideogram 4** (main and unconditional model
  paired automatically; its Turbo, Default and Quality schedules follow the
  step count), **MageFlow** and **ERNIE-Image** (each with its Turbo
  variant), and **Lumina Image 2.0** including the Neta Lumina and NetaYume
  anime fine-tunes, which get the system prompt they were trained with.
  Missing text encoders, VAEs and Ideogram's unconditional model can be
  downloaded from the setup panel.

### Fixed
- Sana no longer shows up when you have no Sana weights: the "install a
  node pack" placeholder is gone, and ExtraModels presets only list once
  they are downloaded to `models/sana`. Sana runs through ExtraModels no
  longer fail with "'EmptySanaLatentImage' object has no attribute
  'device'" on current ComfyUI.
- Restart ComfyUI said ComfyUI-Manager was missing with the Manager custom
  node 3.4x, which only restarts on a POST.
- Install buttons for custom nodes now work through the ComfyUI-Manager
  custom node (3.x) too, not only the Manager built into newer ComfyUI.
- Adding model folders could report "models ready" before ComfyUI read
  them, when the added folder sat inside one ComfyUI already reads (its own
  `models` folder). It now waits until every added folder is read, so the
  models no longer stay listed as found afterwards.
- A model's setup card in the sidebar was cut off with a node install
  open; it now scrolls.

## [0.5.0] - 2026-09-24

### Added
- Hidden replaces Private Vault. It is a place, not a switch: open it from
  the lock in the dock, generate straight into it, or hide any finished
  image with the eye on its tile and bring it back the same way. Upscale,
  compare, remix and reuse all work inside it. It unlocks with Touch ID or
  Windows Hello as well as the password, shows nothing at all while locked,
  and locks itself after a while untouched. Setup waits for ComfyUI, then
  walks through password and biometrics with its own animated hero; Settings
  manages passkeys, the password, auto-lock, export, an encrypted backup and
  a full erase.

### Changed
- The Hidden password no longer touches the normal gallery: prompts are
  stored as before, generating never waits for an unlock, and prompts sealed
  by the old scheme open back up on the first unlock. Existing Private Vault
  items and passwords carry over as they are.
- HEISS UI now points you at `localhost` instead of `127.0.0.1`: the same
  server, but browsers only allow Touch ID and Windows Hello on a name.
- Hidden's setup, lock screen and settings use shorter, plainer copy, and
  the website describes Hidden instead of Private Vault.
- Moving into or out of Hidden is a short fade instead of the pixel curtain,
  which showed the gallery through it as a grid. The lock screen and empty
  Hidden use a quieter lock mark, and unlocking is quicker.
- **A faster gallery, especially a large one.** Thumbnails of images on this
  computer come straight from their cache instead of downloading the full
  image from ComfyUI each time, and loading a page no longer checks every
  image's file one by one. The app no longer reloads or redraws the gallery
  while nothing changes, pauses its checks while the tab is in the
  background, and typing in the prompt no longer redraws the gallery,
  sidebar and composer. Generating keeps the server responsive and no
  longer piles up preview frames in memory.
- Stop can now stop a running upscale: the upscale button shows a stop
  square while it runs, and the dock's Stop includes upscales.

### Fixed
- Clearing the gallery while the vault was locked deleted the files and then
  failed without a word.
- Finished private jobs handed out their per-file keys to any caller for
  five minutes.
- ComfyUI kept the full prompt of private runs in its history, and plaintext
  copies of private images used as references in its input folder.
- Private prompts leaked through tile titles and the workflow card's
  thumbnail; a locked session could not delete anything.
- Run grouping only applied once a vault existed.
- With any run grouped, the gallery reloaded itself every few seconds.
- Restarting ComfyUI reported that ComfyUI-Manager was missing with the
  Manager built into current ComfyUI.
- Upscales left running by a server restart spun forever.
- The ComfyUI connected card replayed every time you moved between the
  gallery and Hidden.
- A model folder picked on Windows could not be added when its path came
  back with other casing or as an 8.3 short name.

## [0.4.1] - 2026-09-24

### Changed
- **Shorter, plainer copy throughout the app.** Dropped reassurances nobody
  asked for, lines about the app doing things by itself, and explanations of
  how things work under the hood. Terms are now consistent: HEISS UI (not
  HEISS or "the server"), Private Vault and vault password, Stop for running
  generations, and images instead of "gens". The website and README now match
  the current workflow import, smart upscale and the Settings layout.

### Fixed
- **Windows: the first start of a download works.** It crashed while
  installing its packages (current Node refuses to run `npm.cmd` directly),
  and the launcher window closed before the error could be read. The `.bat`
  now checks for Node and an unpacked folder, and stays open on any error.
  Updating a Git copy from Settings failed the same way.
- Starting HEISS UI a second time said it was ready. It now says the port is
  taken and HEISS UI is probably already running.
- **Windows: sharper pixel art at 125% and 150% display scaling.** The
  generation mosaic, the About wordmark, the update button and the other cell
  canvases draw on whole screen pixels, so cells and gaps stay even. Without
  WebGL the About page shows the logo instead of an empty space.
- Blur was missing on tile buttons, bundle badges and dock chips in Chrome,
  Edge and Firefox.
- Scrolling a panel with a mouse wheel changed any number field under the
  pointer. Fields now only react to the wheel while focused.
- Thin scrollbars everywhere; the gallery's no longer hides under the bottom
  fade or pushes the gallery off centre. Sideways strips (zen thumbnails,
  workflow filters) scroll with a normal wheel, and viewer zoom follows how
  far the wheel or touchpad moves.
- Monospace text uses Geist Mono on every system. Long paths are cut at the
  start so the folder name stays visible. Windows High Contrast shows
  switches, buttons and focus.
- AltGr characters start typing into the prompt; confirming an IME word no
  longer generates; an image dropped outside a drop zone no longer opens in
  the tab.
- **Windows: model folders.** Paths are compared regardless of letter case,
  a disconnected network drive no longer freezes HEISS UI during the scan,
  `extra_model_paths.yaml` saved with Windows line endings is still
  recognised, and `C:\ComfyUI_windows_portable` is found.
- Installing node packs into the portable ComfyUI's Python no longer skips
  packages that are only installed in your user Python.
- Downloads, thumbnails, the vault and updates retry when antivirus or
  indexing briefly holds a file. A download stuck at 100% finishes, and an
  update that cannot put a folder back says where it left it and retries on
  the next start.
- With ComfyUI stopped, images load from disk straight away instead of
  after a two-second wait each. An output folder at a drive root works.
- A missing or blocked image library no longer stops HEISS UI from starting;
  thumbnails fall back to the full image.

## [0.4.0] - 2026-09-24

### Added
- **Models ComfyUI can't see are found and added in one step.** HEISS looks
  through shared folders, other ComfyUI installs, the ComfyUI Desktop app,
  Stability Matrix, A1111 and external drives for models in folders ComfyUI
  does not read. It says what it found in the sidebar, the model menu and
  Settings. One click adds the folders to ComfyUI's `extra_model_paths.yaml`
  (backed up, in a marked section Settings can remove again), restarts
  ComfyUI and confirms the models arrived.
- **Custom nodes install with one click.** Models that need a custom node
  pack say so in the sidebar and the workflow library, with an Install
  button. Packs in ComfyUI-Manager's list are installed through Manager; the
  rest are cloned and set up with ComfyUI's own Python when ComfyUI runs on
  this computer. Smart upscale's SeedVR2 setup uses the same button, and the
  manual steps stay available for a ComfyUI on another machine.
- Sana also runs through ComfyUI-SANA (diffusers, works on Apple Silicon):
  Sana folders in `models/diffusers` show up as ready models, next to the
  ComfyUI_ExtraModels route for CUDA.
- ComfyUI coming back is picked up without a reload. With an empty gallery
  the offline plug snaps into its socket and the scene dissolves into the
  empty state; with images on screen a small "ComfyUI connected" card slides
  in and out. Models, workflows and smart upscale refresh by themselves.
- A new empty state for a gallery with nothing in it yet: a blank pixel
  canvas where a picture keeps developing and fading.
- MODELS.md documents how a new model family, and the custom nodes, text
  encoders or VAEs it needs, gets added.

### Fixed
- With ComfyUI stopped or restarting, every image in the gallery broke,
  because images were only ever fetched through ComfyUI. They now open from
  the output folder, and thumbnails from HEISS's own cache.
- A finished image whose file would not load (moved, deleted, ComfyUI
  unreachable) showed the browser's broken-image icon with "Untitled prompt"
  over the tile. It now shows the tile's unavailable state, and every image
  with a source that can go missing falls back the same way.
- The offline screen restarted its animation every five seconds while HEISS
  checked ComfyUI again, and a first start flashed the empty state before it
  knew ComfyUI was offline. Both now hold steady until the answer changes.
- Retry connection (and the composer's ComfyUI offline button) say
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

[Unreleased]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/tristmeister/HEISS-UI/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/tristmeister/HEISS-UI/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/tristmeister/HEISS-UI/releases/tag/v0.2.0
