# Changelog

Every release of HEISS UI, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/) as described in
[CONTRIBUTING.md](CONTRIBUTING.md#versions-and-releases).

Add notes under **Unreleased** as changes land; `npm run release` turns that
section into the next version and uses it as the GitHub release notes.

## [Unreleased]

## [0.2.0] - 2026-09-23

The first tagged release: a redesigned studio, smart upscaling, drop-in model
support and prebuilt downloads.

### Added
- Smart upscale with SeedVR2: one click on a finished image, with Fast,
  Balanced and High efforts and an optional face detail pass. The original is
  always kept; a split view compares the two.
- A guided setup for smart upscale that installs the nodes through ComfyUI
  Manager or one terminal command (macOS, Linux, PowerShell and Command
  Prompt), downloads the model with resume and checksum checks, and upscales
  the image you clicked once it is ready. A download widget shows progress
  while setup runs in the background.
- Drop-in models: model families are recognised by their weights, missing
  parts (text encoders, VAEs) are found or downloaded, and Krea 2 and
  Z-Image are built in with their own defaults.
- An About page with version, local stats, update checks and credits.
- Prebuilt release downloads with double-click launchers; release copies
  check GitHub Releases for updates.
- Reference images with a frosted picker and pointer-aware drops.

### Changed
- The whole studio is rebuilt around the generation composer: one Modal
  surface for every dialog, settings in seven sections, a new sidebar,
  a thumbnail workflow gallery and frosted glass throughout.
- LoRA stacks are saved per model family, with Clear, All off, favorites and
  recents.
- Rebranded to HEISS UI, with a new website and pixel wordmark.
- The install is much smaller: the server needs three runtime packages.

### Fixed
- Saving over plain-HTTP LAN: LoRA stacks failed silently. LoRA changes now
  sync edit by edit, queue while offline or locked, and never overwrite
  another device's stacks.
- Settings files are written atomically with a backup, so a crash can no
  longer wipe them.
- Smart upscale no longer mistakes listed-but-missing SeedVR2 models for
  installed ones, works on Apple silicon, and says why an image cannot be
  upscaled.
- The upscale comparison showed the two sides the wrong way round.

## [0.1.0]

The baseline HEISS UI grew from, forked from
[J-AI Studio](https://github.com/jasperdevs/J-AI-Studio). Never tagged.

[Unreleased]: https://github.com/tristmeister/HEISS-UI/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/tristmeister/HEISS-UI/releases/tag/v0.2.0
