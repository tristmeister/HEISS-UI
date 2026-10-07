# Rapid

Rapid makes a picture in roughly half the time on the models that support it, with the same VRAM. It works out the noisy first part of a run on a half-size latent, then switches to full size before any fine detail is drawn. It's based on SPEED ("Spectral Progressive Diffusion for Efficient Image and Video Generation", Xiao, Chao, Yariv and Wetzstein, 2026). Branch: `feature/rapid`.

## What it does

In a run, the noise level falls from 1 (pure noise) to 0 (the finished picture).

- **Early steps:** while the picture is mostly noise, they only settle layout, pose, light and colour. Full resolution adds nothing yet, so Rapid samples those steps on a latent half as wide and half as tall. That's about a quarter of the work per step, and attention cost falls even more.
- **The switch:** at the switch point, the small latent is padded back to full size in its frequency (cosine) spectrum. The missing high frequencies are filled with fresh noise at the current noise level. The state and noise level are then rescaled so the full-size sampler continues on the same schedule (Eq. 5/6 of the paper).
- **Late steps:** the rest of the run, and always its last steps, happen at full size. So every bit of fine detail is drawn by the model at full resolution.

Same step count, same peak VRAM, cheaper early steps. The trade-off is that a seed frames a little differently with Rapid on than off.

## Prior work we build on (all MIT)

| | LC Speed Boost (LC123 nodes) | ComfyUI-SPEED, SwarmNeo fork (aoleg) | ComfyUI-SPEED (ruwwww) / the paper authors' node |
|---|---|---|---|
| Maths | torch, on the GPU (DCT as matmuls) | numpy + scipy on the CPU | same |
| Flow models (Krea 2, Z-Image, Flux, Qwen, Wan) | yes | yes | yes |
| SDXL family (eps / v-pred) | yes: compares on the flow scale t = σ/(1+σ), rescales by r | soft (their doc explains why; not fixed) | no |
| Skips inpaint / img2img | yes | only in its Forge/Swarm glue | no |
| Always finishes at full size | yes | caps the coarse share at 80% | no |
| Switch point | one noise level (0.7 flow, 0.6 SDXL) | per-model presets from the VAE spectrum, measured for Flux | from the paper |

**What we take:**
- LC's sampler wrapper, since it's the most complete.
- SwarmNeo's findings:
  - The quality limit is a noise level, not a step count.
  - Small text breaks first. Flux.1 renders text correctly only when it switches at about 0.96, while skin and hands are fine at 0.7.
  - A coarse share capped as a backstop.

So the switch point is set **per family, from our own measurements**, rather than one number for everything.

## Parts

### 1. `ComfyUI-HEISS-UI-Nodes`: our node pack (new repo)

Our own ComfyUI node pack, so that later HEISS features have a home. Its first node is **HEISS Rapid** (`HeissRapid`). It takes a `SAMPLER` and returns a `SAMPLER`, and goes between `KSamplerSelect` and `SamplerCustomAdvanced`.

**Inputs:**
- `sampler`
- `switch_at`: a noise level on the 0..1 flow scale; HEISS sets it per family
- `scale`: start size, default 0.5
- `min_full_steps`: default 2

**Behaviour:**
- Works out the model kind itself:
  - **flow** (`CONST`): state = (1−t)·x0 + t·ε
  - **sigma** (`EPS` / `V_PREDICTION`, not EDM): state = x0 + σ·ε, compared on t = σ/(1+σ), rescaled by r
- Image (4D) and video (5D) latents. The DCT runs over the last two axes, and so does the padding.
- The coarse size is rounded to the model's grid: multiples of 8 latent pixels for UNets (SDXL), 2 for DiTs.
- It turns itself off, and says so, when there's:
  - an inpaint mask
  - a run starting below noise 0.9 (img2img / upscale)
  - an unknown model kind
  - too few steps
- The last `min_full_steps` always run at full size. At most 80% of the steps run small.
- It reports what it did to the HEISS socket (`heiss.rapid`: steps small and full, switch noise, or why it was skipped), so the app can show and record the real outcome.
- Fresh noise is seeded from the run's seed, so a seed with Rapid on gives the same picture every time.
- Has Python tests. The main one is an exact Gaussian-data denoiser: for x0 ~ N(0, P) in the DCT basis, E[x0 | x_t] is known in closed form. Sampling with Rapid on must reproduce the data's per-frequency variance just as sampling with it off does, for both flow and sigma models. A wrong rescale shows up as wrong variance, which is a sharper check than "looks fine".

The pack is pinned in `server/node-packs.js` like every other pack. The existing install panel, the ComfyUI Manager Git-URL route and the terminal command all work unchanged. Updates are reviewed changes to the pinned commit.

### 2. Which families support it (`family-catalog.js`)

Each family can carry `rapid: { at }`, and a variant can override or disable it with `rapid: false`. That's the only place that decides support; the rest is generic.

**First values, to be checked and adjusted against the Windows benchmark:**

| Family | `at` | Basis |
|---|---|---|
| Krea 2 (Turbo, Raw) | 0.7 | LC's tests: 2×, detail holds |
| Z-Image | 0.7 | LC |
| Flux.2 Klein / Dev | 0.7 | LC (1.3× at 4 steps) |
| Qwen-Image | 0.7 | LC lists it; measure it |
| Flux.1, Chroma | 0.85 to start | SwarmNeo: text breaks below about 0.94 at 40 steps. We measure with the text probe and choose. |
| SDXL / Pony / Illustrious | 0.6 | LC's sweep (5 checkpoints, 4 samplers, 4 schedulers) |

- **Off:**
  - SD 1.5 / 2.x: a 512 native size halves to 256, below what the model handles.
  - The few-step SDXL variants: Turbo, DMD2, LCM, Lightning, Hyper.
  - MiniMax H3 and LTX: they don't work with it.
- **Not yet, until measured:** Sana, Ideogram 4, MageFlow, AuraFlow, SD3, HiDream, Lumina.
- **Video (Wan pair, Hunyuan): phase 2.** The node handles 5D latents, but the high/low pair graph needs its own wiring, and video needs its own measurements.

### 3. Server

- **`family-profiles.js`:** adds `capabilities.rapid`:
  - `"ready"` when the node is loaded and the family or variant supports it
  - `"install"` when only the pack is missing
  - `false` otherwise
- **`validation.js` (`sanitizeFamilyBody`):** `rapid` is kept only when:
  - it was asked for
  - the profile is ready
  - the run is text-to-image: no inpaint, no start image or img2img below full denoise, no reference images (edit mode is unmeasured)

  `rapidAt` comes from the catalog.
- **`family-graph.js`:**
  - `customSampler` wraps `KSamplerSelect` in `HeissRapid` when `body.rapid` is set.
  - Families on a plain `KSampler` switch, only while Rapid is on, to the equivalent `RandomNoise + CFGGuider + BasicScheduler + KSamplerSelect → SamplerCustomAdvanced`.
  - Own graphs (H3, Ideogram, Mage, Sana) never get it.
- **`gallery-store.js` (`generationSettings`):**
  - Records `rapid: true` on pictures made with it.
  - If the node reports a skip, records `rapid: false` and the reason, so the details panel tells the truth.
- **`generation-timing.js`:** Rapid runs get their own timing key, so time estimates for runs with and without it don't get averaged together.
- **`civitai.js`:** the A1111 parameters text gets `Rapid: on`.

### 4. Client

- **Preference:** `prefs.rapid`, default on. Settings → Features gets a **Rapid** card with the switch. When the pack is missing, the card shows the shared `NodeInstall` panel.
- **Seed rule** (client side, since only the client knows how a seed got there). The run uses Rapid when all three hold:
  - `prefs.rapid` is on
  - the model's capability is `"ready"`
  - either no seed is pinned, or the pinned seed is the one restored from a picture made with Rapid (`rapidSeed`)
- **How that plays out:**
  - "Use settings" on a Rapid picture restores its seed and sets `rapidSeed`, so the same picture comes back.
  - Typing your own seed, or reusing a picture made without Rapid, turns it off for those runs.
  - "Vary" clears the seed, so Rapid is back on.
  - Undo (`restoreDraft`) carries `rapidSeed` too.
- **Composer:**
  - The sidebar's advanced tab shows a small **Rapid** row with its state: "On", "Off: seed is fixed", "Not for this model", "Install".
  - Phone: the same row in the phone's advanced settings.
- **Retry:** reruns with the original run's `rapid`.
- **Details panel:** a "Rapid" row on pictures made with it.

### 5. Benchmark (`scripts/bench-rapid.mjs`)

- Drives HEISS's own `inferModels → sanitizeGenerateBody → imageGraph` against a real ComfyUI.
- Times sampler and decode from the progress socket, and polls peak VRAM with nvidia-smi.
- Probes: skin, hands, small text and a wide street scene, on fixed seeds, at 1024² and 1536².
- **Baseline (off) first; then on vs off once the pack is in.** The images go side by side for an A/B on the same seeds, to pick each family's `at` value.

## Order of work

1. ✅ Branch, benchmark script, Windows baseline prompt.
2. The node pack: the node, the Python tests (Gaussian oracle, plan, guards, 4D/5D, MPS), README with credits.
3. HEISS server: pack entry, catalog values, capability, validation, graph, settings record, timing key, tests (`model-families`, `contract`).
4. HEISS client: preference, settings card with install, seed rule, sidebar and phone row, retry, details panel.
5. Publish the pack repo, then pin its commit in `node-packs.js`.
6. Windows: install the pack, run on vs off, compare pictures, set each family's `at`, update MODELS.md and CHANGELOG.
7. Video (Wan 2.2 pair), Anima and the other flow families, each after measuring.
