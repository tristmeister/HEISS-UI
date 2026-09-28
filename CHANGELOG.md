# Changelog

Every release of HEISS UI, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/) as described in
[CONTRIBUTING.md](CONTRIBUTING.md#versions-and-releases).

Add notes under **Unreleased** as changes land; `npm run release` turns that
section into the next version and uses it as the GitHub release notes. Each
version opens with a `> ` summary line, which the update pill shows.

## [Unreleased]

### Fixed
- **The sidebar and other glass stay readable over the video gallery on
  Windows**, where Chrome can hand playing videos to a layer the blur can't
  reach.
- **Pixel glyphs no longer show a faint grid on Windows screens.** The toast
  marks, the update and upscale arrows and the plug draw their cells edge to
  edge where a screen is too coarse for the fine gaps between them.

## [0.12.0] - 2026-09-28

> An easy first run, prompt history, search and safer sharing

### What changes when you update
- **Phones and other computers sign in once more.** Set a studio password in
  Settings › Connection; until you do, the Hidden password still works.
- **Admin from other devices is off** until you turn on Trust other devices
  with admin at the computer running HEISS UI.
- **HEISS UI keeps a copy of its data first**, in `data/.backups/`, so going
  back to 0.11 works (see TROUBLESHOOTING.md).

### Security
- **Other websites can't drive HEISS UI any more.** Every request must name
  a known host, and anything that changes something must come from the
  studio's own page. Before, a page open in the same browser could clear the
  gallery or shut the server down.
- **Requests through a proxy or tunnel count as another device**, so Caddy,
  `tailscale serve` or `cloudflared` no longer hand out this computer's rights.
- **Trust other devices with admin** is a new switch in Settings › Connection,
  off by default. Updates, installs, the output folder, clearing the gallery
  and model downloads are then done at this computer only. The switch itself,
  the Hidden and studio passwords, HTTPS and sign-out-all never leave it.
- **Other devices sign in with a studio password** of their own, shown with a
  QR code per address. Sessions last 7 days, **Sign out all devices** ends
  them, and wrong guesses slow down per address without ever slowing this
  computer. Until you set one, the Hidden password still signs devices in.
- **HTTPS for other devices** with a certificate you already have (for example
  from `tailscale cert`); plain HTTP then answers this computer only.
- **Hiding an image leaves nothing of it in the open**: its thumbnails, the
  copies ComfyUI kept of a reference, and its prompt in the gallery file and
  prompt history go.
- **Updates can be signed.** Releases carry an Ed25519 signature, and once the
  public key is set, unsigned or badly signed updates are refused.
- **Node packs install a reviewed commit** with ComfyUI's PyTorch and numpy
  held in place, and HEISS asks before going around ComfyUI-Manager's
  security level. Model downloads are checked against their published SHA-256
  and resume only while the file is unchanged.
- **Share without settings** removes the prompt and workflow from a shared or
  downloaded image; on for Hidden. Imported workflows say when they contain
  nodes that run code, touch files elsewhere or go online.

### Added
- **Pick a first model.** An empty studio offers Krea 2, Flux.2 and SDXL, each
  in three versions, with the one that suits this computer marked. One tap
  gets the model, its text encoder and VAE, then selects it with a prompt
  ready. "Get more models" in the model menu brings the cards back.
- **HEISS UI finds ComfyUI by itself** on port 8188 or ComfyUI Desktop's 8000,
  and **No ComfyUI yet?** says which one to install.
- **Recent prompts.** Press ↑ in an empty prompt, or the clock beside Negative,
  to search, star and reuse earlier prompts.
- **Search the gallery** with `/` or ⌘F, and **star images** (F in the
  viewer) to find them under Favourites.
- **Earlier images**: add a folder of older ComfyUI, A1111 or Forge images to
  the gallery without copying them.
- **Starter prompts, Surprise me and Vary this** for a quick first run, and a
  `?` overlay with every shortcut.
- **GGUF models** load through ComfyUI-GGUF, which HEISS offers to install.
- **Image-to-video for Wan 2.2 14B and HunyuanVideo 1.5**, and a calm "usually
  about N min here" before a video starts.
- **Every build of a part** with its size and source under "Other versions";
  a gone or gated build falls back to the next. A Hugging Face token, mirror
  and proxy work for downloads.
- **LoRAs say what they were made for**, sort matching ones first and show
  their trigger words.
- **Civitai-ready images (beta)** write A1111-style parameters into new PNGs.
- **Copy image** and **Copy settings** in the viewer.
- **A copy of HEISS UI's data before each update**, kept for 14 days, for
  going back to the version before.
- **Troubleshooting guide**, linked from every failed card, and **Copy
  diagnostics** in Settings › About.

### Changed
- **The model picker is called Model**, with imported graphs under Your
  workflows. Desktop controls use the phone's plain labels, sampling moved to
  Advanced, and **Back to recommended** undoes changes.
- **Failed runs offer the fix**: free memory and retry, retry smaller,
  download again, rescan or install.
- **A ComfyUI that drops for a moment no longer fails the run**; the tile says
  Reconnecting and picks the result up. Cancel only stops HEISS's own runs.
- **Delete all moves images to a trash** you can restore for 30 days.
- **Downloads bring Node.js on every system**, the launcher opens the browser,
  and a taken port moves HEISS UI to the next free one.
- **Large galleries page and save faster**, the app is compressed for phones,
  and the thumbnail cache has a size limit.
- **Speed LoRAs switch to few-step settings**, and img2img strength follows
  each family.

### Fixed
- Nunchaku, NF4 and unrecognised checkpoints no longer look ready and then
  fail; unrecognised ones ask for their type instead of running as SDXL.
- Error toasts stay until dismissed.
- A Git checkout only updates without local changes, and goes back if the
  update doesn't build.

## [0.11.0] - 2026-09-27

> Notes as islands, a floating live run, gentler face detail

### Changed
- **Toasts are islands now.** Notes float in under the download and update
  pills in the same frosted capsule, with a small cell glyph for each kind:
  done, heads-up, failed, removed and plain info. Hover fans the stack out and
  holds every timer; flick one up to dismiss it.
- **Deleting a run of images counts up in one toast** ("4 images deleted")
  instead of stacking a toast per click, and its Undo brings all of them
  back. A ring around the glyph shows how long Undo stays, and the files are
  only removed once the toast is gone. Moving images into or out of Hidden,
  and repeats of the same message, count up the same way.
- **Downloads and updates are activities.** They share one column at the
  top and slide up when one above them leaves. When the work finishes, the
  same island turns into the note ("Smart upscale is ready") and leaves by
  itself, but not while the pointer rests on it.
- **Fewer toasts.** Copy buttons show a check where you clicked instead of a
  toast. Things you can already see no longer get one: a new cover, an
  ungrouped run, a reference image, a saved folder or ComfyUI address, a
  locked Hidden, a new passkey, or a workflow switch loading its defaults.
- **Errors offer the next step** when HEISS UI can take it: Check again,
  Workflows, Try again, See why, Reload. An error stays in front of lighter
  toasts that arrive after it.

### Added
- **A generation you can't see floats at the top.** With the viewer on
  another image, zen on an older one, or the gallery scrolled away, the run
  shows as an island with its live preview, progress and time left; click it
  to go to it. When it finishes it becomes "Image ready" with the result and
  View.

### Fixed
- **The face detail pass no longer ages faces.** It ran on the upscaled image,
  where the model redrew each face at several thousand pixels and baked in
  heavy freckles, pores and wrinkles. It now redraws small faces before the
  upscale, at the model's own size, and leaves close-ups alone.
- **A failed model download is reported once**, in its own island, instead
  of there and in a toast.
- **Images taken out of Hidden go back into the heiss-ui folder** with
  everything else HEISS UI saves, instead of loose in ComfyUI's output
  folder. Their upscales too.
- **Images taken out of Hidden are real outputs again.** They are handed to
  ComfyUI itself, so they land in the output folder ComfyUI actually uses,
  even on another computer, and work as reference images. Before, they were
  written to the folder HEISS UI had on record, which ComfyUI might never see.
- **A Hidden upscale says when ComfyUI's copy stays behind.** Its plaintext
  copy is removed once it is sealed; when HEISS UI can't reach ComfyUI's
  output folder to do that, it now tells you instead of leaving it silently.

## [0.10.0] - 2026-09-27

> Countdowns for runs and restarts, and Flux 2 edits

### Added
- **Flux 2 (Klein 4B, Klein 9B and Dev) edits from reference images**, the
  way ComfyUI's own Flux 2 edit templates do; the first reference frames
  the result. The reference slots show once your ComfyUI has the nodes.
- **Restarting ComfyUI tells you how long it usually takes.** After a few
  restarts that agree, the restart line fills toward your machine's usual
  time and counts down ("Back in about 12 s"). A restart well past it says
  ComfyUI may be installing something rather than counting on.
- **A restart says what it brought.** Once ComfyUI is back, a node pack
  that is new says so ("ComfyUI is back with Impact Pack"), and one that
  failed to load says that instead of turning up later as a missing node.
  Restart timings stay in your data folder and are only used for this.
- **Generations say how long is left.** A running image counts down ("12 s
  left", "About 2 min left") and its bar follows the whole run, loading and
  decoding included, instead of stalling once the steps are done. Queued
  images say when their turn ends. The Generate button's tip says what a run
  takes with your settings ("about 40 s"), and on the phone a run of 45 s or
  more says so before you start. It learns per model from your own runs:
  nothing shows until a model has run three times, and estimates that keep
  missing go quiet.
- **A hint when steps crawl.** If a run's steps are far slower than that
  model's usual, HEISS UI says once that ComfyUI may be short on video memory.

### Changed
- **LoRAs stay when you switch workflows on the same model**, and a
  different model starts from its own last stack (or none) instead of
  carrying LoRAs that don't fit it.
- **Upscale starts from the click.** The ring shows at once; if the upscale
  can't start, the button steps back and says why.
- **The upscale ring is crisp** instead of jagged at its edges.
- **Finished images appear the moment ComfyUI is done**, instead of up to
  1.6 s later.
- **An image's time is how long it took to make**, not counting its wait in
  the queue, on its tile and in the About page's totals.

## [0.9.0] - 2026-09-27

> Qwen-Image 2.1 edits from references, and restarts up front

### Added
- **Qwen-Image 2.1 edits from reference images.** The composer offers its
  reference slots one after another as you fill them; the first reference
  frames the result.
- **Restart ComfyUI or HEISS UI from the top of Settings › General.** Each
  tile shows whether it's running, spins while restarting and lands on a
  check when it's back.

### Fixed
- **Qwen-Image 2.1 files are recognized** from their weights instead of
  showing as an unknown model. Any file whose weights match no known model
  now falls back to its name before being called unknown.
- **Face-detail upscales of images from imported workflows work.** They were
  rejected every time. When an upscale fails after it started, the upscale
  button now says why instead of failing silently.

### Changed
- **An upscaled image is used upscaled.** Using it as a reference or start
  image (from the viewer, the reference picker or a drop) now hands the
  workflow its upscaled pixels, scaled back to the original's size so a run
  takes no longer than before. Switch the upscale off in the viewer and the
  next run uses the original again.
- **Each download has only its own launcher:** **Start HEISS UI.bat** on
  Windows, **.command** on macOS and a new **Start HEISS UI.sh** on Linux.
  Updating removes the ones for other systems. The release notes now say
  which zip is which.
- **Downloads in the workflow picker** keep their buttons beside the name,
  like the sidebar's, instead of always on a line of their own.

## [0.8.2] - 2026-09-27

> Finished images stay put, and the grid reads newest first

### Fixed
- **Finished images no longer vanish.** Deleting your newest image while
  another was generating let ComfyUI give the new one the deleted file's
  name, and the new image disappeared the moment it finished. A new image
  also went missing from any list built in the second after it was saved.
- **New images show up in the reference picker right away**, not only
  after a reload.
- **The grid reads newest first, top left**, the same before and after a
  reload, instead of new runs landing in scattered columns. While your
  pointer is over the grid, new results wait to reflow so nothing slides
  out from under it.
- **Deleting reflows the grid**: the tiles after a deleted one move up to
  fill the space, so columns stay even.

## [0.8.1] - 2026-09-27

> Updates show up right away, and Hidden keeps clear of tiles

### Fixed
- **The update pill no longer waits for ComfyUI.** While ComfyUI wasn't
  answering (HEISS UI started first, or ComfyUI was restarting), a new
  version stayed unannounced until ComfyUI connected or Settings was opened.
  HEISS UI now asks for the latest version as it starts, so the pill is
  there within a couple of seconds, and Settings › About no longer changes
  shape a moment after it opens.
- **The update pill sums up the release** in a line written for it, instead
  of quoting whichever change happened to come first.
- **The Hidden bar no longer covers the first row.** In Hidden, the gallery
  starts below the bar, so a tile's quick actions are never under it, and
  the zen strip keeps clear of it.

## [0.8.0] - 2026-09-27

### Added
- **A model's setup ends with a ready moment.** Parts that land stay in the
  list, ticked "In place", and the last one turns the panel into "<model> is
  ready". A ComfyUI restart halfway through keeps your progress.
- **Imported workflows offer their missing files.** A file HEISS UI knows
  gets a Download button; the rest say which folder they belong in.
- **Setup demo for contributors:** `npm run dev:setup-demo` runs against a
  pretend ComfyUI that lacks encoders, VAEs, a partner model and a node pack,
  with simulated downloads, so every missing-parts flow can be tried on any
  machine.

### Changed
- **Progress says what's happening.** Only sampler steps count as steps
  ("Step 1/2"); everything else is named: "Loading model", "Encoding image
  68%", "Upscaling". A tiled encode no longer shows as "Step 241/357".
- **Failed generations read calmly.** The tile shows a centred mark, a title
  and one line, with a **How to fix** pill that opens the full explanation.
  A damaged model file says which part and file it is ("The VAE file is
  damaged"); node, exception and raw error sit behind **Show details**.
- **An unready model leads to its setup.** A blocked Generate opens that
  model's setup, and the model menu and phone list say what each one lacks.

### Fixed
- **Downloads tell the truth.** A dropped connection retries by itself three
  times, then says so plainly. A gated file links to its Hugging Face page
  instead of offering a Retry that can't work. "Get all" adds up real sizes,
  and an outdated ComfyUI is listed first and blocks it. Wan 2.2's low-noise
  half can be downloaded.
- **Workflow cards keep up with finished downloads** instead of lagging a
  scan behind.
- **Hidden images stay out of the reference picker's Generations.** They have
  a **Hidden** shelf of their own next to Generations and Uploads, behind the
  same lock as Hidden: locked, it offers **Unlock** (Touch ID where set up)
  without leaving what you're doing. Anything made from a hidden image still
  goes to Hidden.

## [0.7.5] - 2026-09-27

### Added
- **A new version offers itself, once.** A small pill slides in at the top
  with what's new and an **Update** button. It downloads while you keep
  working, then **Restart** switches over in a few seconds; while something
  is generating it can wait and restart when that's done. "Later" puts that
  version away on every device. It only asks GitHub every few hours, stays
  quiet when you're offline, never interrupts a generation or Hidden, and
  **Settings › About › Check automatically** turns it off completely.

## [0.7.4] - 2026-09-27

### Fixed
- **iPhone haptics now actually tick.** iOS 26.5 stopped web pages from
  ticking from script, so the tap itself now lands on a hidden system switch:
  Generate, All/None, Select several, Compare, Delete and picking images
  while selecting. Long press and "image ready" stay silent on iPhone.
- **Update and restart from another PC again.** With LAN mode on, a trusted
  computer on your local network can once more install updates, restart
  ComfyUI and HEISS UI, and manage models, nodes, folders and workflows, as
  before 0.7.1. Creating or erasing the Hidden password still happens on
  the computer HEISS UI runs on.
- **Windows: finishing an image no longer crashes the browser.** With the
  mosaic preview on, the WebGL effect that resolved a finished image took
  the whole browser down. Windows now sharpens the image out of the mosaic
  without WebGL. On other systems, if the browser ever goes down while the
  WebGL mosaic runs, HEISS UI notices on the next load and switches that
  browser to the same safe reveal.

## [0.7.3] - 2026-09-25

### Added
- **Haptics on iPhone too.** Safari on iOS 18 and later now gives a light
  tick on the same taps that vibrate on Android (one kind of tick only; iOS
  has no patterns for web pages).

## [0.7.2] - 2026-09-24

### Fixed
- **Images vanished after switching layout.** Going from the phone studio to
  the full studio (or back, or into Hidden) left the gallery drawing no tiles
  until something else redrew it, so fresh images looked missing. The gallery
  now finds its scroll area from where it sits instead of a reference that
  still pointed at the previous layout.
- Demo mode reports ComfyUI as connected, so it can generate its placeholder
  images again.

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

[Unreleased]: https://github.com/tristmeister/HEISS-UI/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/tristmeister/HEISS-UI/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.5...v0.8.0
[0.7.5]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.1...v0.7.2
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
