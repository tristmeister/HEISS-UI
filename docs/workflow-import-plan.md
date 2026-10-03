# Workflow import overhaul: master plan

Status: plan only, nothing built. Written 2026-10-03.

This plan comes out of a long design discussion. It draws on:
- a close read of a friend's app, ComfyPort
  (github.com/NicolasCampailla/ComfyPort, a native Android ComfyUI client);
- a review of how HEISS handles custom workflows today;
- research into ComfyUI-Manager's public data and Civitai / Hugging Face model
  availability.

Every fact is marked **verified** (we checked it) or **assumed** (still needs
checking). Model fetching is deliberately the last phase: workflow import has
to work well before we teach the app to find models.

---

## 0. The goal in one paragraph

You open "Import workflow". You pick one of your recent ComfyUI runs, or drop a
file or an image. A minute later it sits next to the built-in models as a normal
model card, with a prompt box and the few controls that matter. You never see
JSON, node IDs, "export as API" or a mapping table. The app asks at most one
question, and only about things it can't know, in plain words about content (not
graph structure). Everything else is decided for you. You can see what's
happening, but nothing is put in your face, and if something goes wrong you're
offered a calm way back.

### UX rules every phase must follow

1. **Silent when it works.** Progress shows in one neutral activity strip. No
   warning colours, no "safe!" badges, no checklists.
2. **The only interruptions:**
   - installing a node pack that isn't in the Comfy registry;
   - not enough disk space;
   - an install that broke something, offering undo;
   - one content question when we can't tell which text is the prompt.
3. **Ask about content, never structure.** Show the actual prompt text, the
   actual image, the author's node titles. Never show "Node 47 ·
   CLIPTextEncode.text".
4. **Never leave a dead end.** Every failure says what we couldn't do and offers
   the next step (skip, undo, open in ComfyUI). No walls of errors.
5. **Visible but quiet.** Anything we decided on the user's behalf (a substitute
   model, a skipped LoRA) is noted in one line where they'd look, never in a popup.

---

## 1. Where we are today (verified)

- **Import:** `POST /api/workflows/import/preview` →
  `previewWorkflowImport` (`server/workflow-catalog.js:241`) →
  `saveImportedWorkflow` (`server/custom-workflows.js:382`). Admin only. You
  upload a JSON file or drop it into `<dataDir>/workflows`.
- **Formats:** `detectWorkflowFormat` (`custom-workflows.js:136`) recognises
  visual (UI) JSON, API JSON, and API JSON wrapped in `{prompt}`.
- **Conversion:** our own `visualWorkflowToApi` (`custom-workflows.js:102`).
  It uses the live `/object_info` schema, which is good. It skips Primitive,
  Reroute and Note nodes. As far as we can tell it does not expand subgraphs or
  handle bypassed nodes (mode 4).
- **Mapping:** `detectWorkflowMetadata` (`custom-workflows.js:430`) guesses by
  class-name pattern and takes the first match (the first TextEncode node is the
  prompt, the second the negative, and so on). The user then reviews a
  `node.input` table in `src/app/WorkflowGallery.tsx`, or writes a
  `heissUi.controls` JSON block, or uses "Copy for an agent".
- **Outputs:** `outputsFrom` (`server/gallery-store.js:749`) collects every image
  and video from history. This is good; keep it.
- **Node packs:**
  - A hand-reviewed list of 7 in `server/node-packs.js`.
  - Installed via ComfyUI-Manager or a pinned git clone + pip.
  - torch, torchvision, torchaudio and numpy are protected by a constraints file.
  - A missing node class maps to a pack only within those 7.
  - No snapshot or rollback.
  - After a restart we detect "IMPORT FAILED" lines (`server/restart-insights.js`),
    but only show a toast.
- **Models:** 54 curated Hugging Face files with sha256 checksums
  (`server/family-catalog.js`). Missing files are detected by exact name for 5
  loader types only (`workflowMissingFiles`, `custom-workflows.js:246`).
  - No path- or name-tolerant matching.
  - Header-based family and format detection already exists (`model-families.js`,
    `gguf.js`, `family-catalog.js`), and so do GGUF loader swaps.

---

## 2. Lessons from ComfyPort (verified by reading its source)

- **Use ComfyUI's own converter.** It loads the user's ComfyUI web page in a
  hidden WebView and calls `app.loadGraphData()` + `app.graphToPrompt()`. That
  is the exact code ComfyUI runs when you press Queue, so subgraphs, Primitives,
  bypass and custom-node front-end quirks are handled by ComfyUI itself.
  - Weakness: slow (10 s + 15 s timeouts) and fragile.
  - Weakness: its fallback converter uses a hardcoded table of widget names.
- **Import from history.** It reads `/history` → `extra_data.extra_pnginfo.workflow`
  and the `/queue`. No export step.
- **Follow the wires for the prompt.** It traces the sampler's `positive` /
  `negative` inputs upstream through Reroutes, and treats `ConditioningZeroOut`
  as "no negative".
- **Things we already do better:** a schema-based converter, collecting every
  output, a declared mapping, and safety checks.

---

## 3. Phase plan

The phases are ordered so each one makes import better on its own. Phases A–E
are "workflow import works". Phase F is "the app finds models for you".

| Phase | What it delivers |
|---|---|
| A | Test corpus + harness (the yardstick for everything) |
| B | Getting the workflow in: picker, history, saved, drop file / image |
| C | Getting a runnable graph: stored prompt, ComfyUI-side conversion, fallback |
| D | Understanding it: auto-detected controls, the content question, model card |
| E | Node packs: resolution, install policy, install safety net |
| F | Models: local matching, name lists, Civitai index, substitution, LoRA skip |

---

### Phase A: test corpus and harness

**Why first:** every guess in this plan ("most workflows will…") needs
measuring. Without a corpus we tune by anecdote.

- Collect 30–50 real workflows. They must include:
  - official ComfyUI templates;
  - popular Civitai workflows (SDXL / Pony / Illustrious, Flux, Wan, LTX,
    Qwen-Image, Chroma);
  - messy ones: subgraphs, Primitives, Reroutes, bypassed groups, prompt
    enhancers (LLM nodes), refiner chains, regional prompts, several samplers;
  - workflows saved with old ComfyUI versions (no `cnr_id` stamps);
  - each in UI JSON, API JSON and PNG-embedded form where possible.
- Store them under `server/test/fixtures/workflows/`, with an expected-result
  file per workflow:
  - which literal is the prompt (and the negative);
  - which input is the seed, the size, the image input;
  - which packs it needs.
- Build a harness that runs phases C–D (and later E–F as dry runs) over the
  corpus and prints a scorecard: converted ✓/✗, prompt found ✓/✗/asked,
  packs resolved, and so on.
- **Done when:** the harness runs in CI or `npm test`, and the corpus covers
  every case in the list above.

---

### Phase B: getting the workflow in

**The picker** (replaces today's upload box):

- **Left: "Recent in ComfyUI".** The last ~10 runs from `/history`, each showing
  its actual output thumbnail (we already build `/comfy/view` URLs), when it ran,
  and the node-title-based name if there is one. Tap to import.
- **"Saved in ComfyUI".** Workflows from `GET /userdata?dir=workflows`, loaded
  with `GET /userdata/workflows/<name>` (verified in ComfyPort).
- **A drop zone for anything:**
  - `.json` (UI or API format, including the `{workflow}` / `{prompt}` wrappers);
  - **a PNG or WebP that ComfyUI generated.** ComfyUI's SaveImage writes `prompt`
    and `workflow` text chunks into it (assumed standard behaviour; confirm
    WebP);
  - optionally, video files from VideoHelperSuite, which can embed metadata
    (assumed; check).
- Paste a JSON string or URL (nice to have).

**What we capture per import:**
- the UI workflow (if available);
- the **API prompt ComfyUI actually ran** (if available);
- the source (history / saved / file / image);
- a thumbnail.

**Notes:**
- History holds both the UI workflow (`extra_pnginfo.workflow`) and the executed
  API prompt (`prompt[2]`) (verified in ComfyPort's code). History import should
  be the default path.
- Admin-only rules stay as they are today. Phone and LAN users see the same
  picker if they're admin.
- **Done when:** all sources work against the corpus, and the picker opens on
  history by default.

---

### Phase C: getting a runnable graph

Try these in order and stop at the first success:

1. **Use the stored API prompt** (from history or PNG). It needs no conversion,
   and ComfyUI already ran it on this machine. Clean it:
   - strip `_meta`-only keys;
   - **keep the UI workflow alongside it**, because Phase D needs node titles,
     groups and widget layout.
2. **ComfyUI's own converter, run on our server.** Open the user's ComfyUI in a
   headless Chromium (Playwright is already present in many installs; decide
   whether to bundle or lazy-install it). Call `app.loadGraphData(wf)` and then
   `await app.graphToPrompt()`, and take `.output`.
   - Keep one warm page per ComfyUI URL. Reload it after a restart or a pack
     install.
   - Timeouts: about 20 s for first load, 10 s per conversion.
   - Never touch the user's open ComfyUI tab: this is our own headless page.
   - Open question: is a headless browser acceptable on all our platforms
     (Windows portable, macOS, Linux, phone-hosted setups)? If not, step 3
     carries more weight.
3. **Our converter, improved:**
   - expand subgraphs (`definitions.subgraphs`), with ID remapping as in
     ComfyPort's `flattenGraph`;
   - drop bypassed nodes (mode 4) by wiring each input to the matching output
     type, and drop muted nodes (mode 2);
   - resolve Primitive and Reroute nodes to their source values;
   - keep using the `/object_info` widget schema and keep throwing on count
     mismatches. Account for `control_after_generate` widgets on seed inputs.
4. **Fail gently.** "We couldn't read this workflow. Open it in ComfyUI once and
   run it, then pick it from Recent." That route always works, because of step 1.

**Validation:**
- Before saving, check the graph with ComfyUI's validator. Queue it with a
  validation-only approach, or POST it and read `node_errors`. Which method is
  best still needs checking (assumed: `/prompt` returns 400 with `node_errors` on
  invalid graphs before running anything).
- Missing node classes and missing model files are not errors here: they feed
  Phases E and F.

**Done when:** the corpus converts (or uses the stored prompt) with no manual
steps for at least 90% of entries, and every failure shows the gentle message.

---

### Phase D: understanding the workflow

Phase D only answers "what would a human change between runs?". It does not
try to understand the graph.

**D1. Find the prompt by tracing to what the human typed**
- Start at each sampler (any node with a `positive` CONDITIONING input, or the
  guider nodes Flux and Wan use). Walk upstream along the conditioning edges,
  then along STRING edges.
- **Stop at a literal**: a string widget value with no incoming link, i.e. text
  a human typed. That's the prompt box.
- Pass straight through:
  - Reroutes and Primitives;
  - string concatenation (map the literal that changes, and keep fixed
    prefixes);
  - **prompt enhancers / LLM nodes**: keep walking to their *user* text input,
    and skip inputs named like `system`, `instruction` or `template`.
- Disambiguate several literals by:
  - input name (`system*`, `instruction*` → not the prompt);
  - content shape (reads like instructions → not the prompt);
  - **variation across history** (the text that differs between runs is the
    prompt; text that's identical every time is fixed);
  - node titles ("Positive", "Prompt").
- Negative: trace the sampler's `negative` input the same way. `ConditioningZeroOut`,
  `EmptyConditioning` or no link means "no negative field".
- Several samplers (base + refiner) leading to the same literal → one prompt
  field. If they lead to different literals → see D3.

**D2. Other controls, by the same "what a human sets" rule**
- **Seed:** numeric `seed` / `noise_seed` inputs on samplers and noise nodes,
  following Primitive seed nodes. If several are connected to one Primitive, map
  the Primitive.
- **Size:** width/height on the latent node feeding the sampler (traced, not the
  first match), unless the latent comes from an input image.
- **Image inputs:** `LoadImage`-like nodes whose outputs reach the sampler, with
  roles inferred from where they go (start image, reference, mask, ControlNet).
- **Count / frames / fps:** batch size on the latent; video length and fps on
  video nodes.
- **LoRAs:** detect `LoraLoader*` and rgthree Power Lora Loader and plug them
  into our existing LoRA panel (`loraStack`).

**D3. Confidence and the one question**
- Each control gets a confidence score. High → used silently.
- Low on the prompt only → **the content question**:
  > Which of these is your prompt?
  > 🅐 "a cinematic shot of a fox in the snow, golden hour…"
  > 🅑 "You are an expert prompt writer. Rewrite the user's…"
- Several real prompts (regional, multi-character) → show several prompt fields,
  labelled with the author's node titles. No question needed.
- Never ask about seed, size and the like: if unsure, put them under "More
  settings".

**D4. The result is a model card**
- Name: from the workflow filename or title, the main checkpoint's family, or a
  user rename.
- Thumbnail: the output from the history run it came from.
- Main controls: prompt (+ negative if found), size or aspect, seed, count,
  image inputs, LoRAs.
- **"More settings":** every other literal widget that changes the result (CFG,
  steps, denoise, sampler, strengths), grouped by the author's node or group
  titles and generated automatically.
- Capabilities (text-to-image, image-to-image, video) come from which inputs
  exist.

**D5. What happens to today's mapping system**
- The `heissUi` block stays as an **override**: bundled workflows and power users
  can still declare controls, and declared values win over detection.
- The mapping table moves into an "Advanced" drawer on the card. It is never
  part of the import flow.
- "Copy for an agent" moves into the same drawer.
- Existing imported workflows keep working unchanged. Optionally re-run detection
  on them and show the result for one-click acceptance.

**Done when:** across the corpus, the prompt is found with no question in ≥80%
of cases, there are 0 wrong silent prompt picks, and the rest get the content
question. (These targets are guesses; tune them once Phase A is running.)

---

### Phase E: node packs and install safety

**E1. Finding the pack for a missing node**, in order of certainty:
1. **The node's own stamp.** Recent ComfyUI writes `properties.cnr_id` + `ver`
   (registry packs) or `aux_id` (GitHub repo + commit) on every node (verified on
   an official template). Install exactly that pack and version.
2. **ComfyUI-Manager's `extension-node-map.json`**: 5,683 packs mapping 44,564
   node names (verified 2026-10-03).
   - 1,697 node names are claimed by more than one pack. Pick the pack covering
     the most missing nodes in the workflow, then prefer registry packs, then
     the most popular (Manager's `github-stats.json`).
   - 41 packs use name patterns; support them.
   - Cache the file and refresh it daily, with a bundled copy as fallback.
3. **The Comfy registry API (api.comfy.org).** It may offer node → pack lookup.
   Not verified (blocked from our research sandbox); check it.

**E2. Install policy** (decided):

| Case | Behaviour |
|---|---|
| In the Comfy registry | **Install automatically.** No button, no question. |
| GitHub-only (not in the registry) | One question: "This workflow needs an add-on that isn't in the ComfyUI registry (github.com/…). Install it?" |
| No pack provides the node | Calm message naming what's missing, plus "Open in ComfyUI". |

- Installs go through ComfyUI-Manager (v4 queue API, v3 fallback) when it is
  present, otherwise our git + pip route. Use the stamped version when we have
  one. Admin only.
- Multi-user note: a non-admin importing a workflow that needs packs gets "Ask
  your admin" instead.

**E3. The reviewed tier** (packs we pin, guard and test ourselves). Since
registry packs install automatically anyway, this tier is about **quality**: a
known-good version and extra install guards. Add packs gradually, picked using
the corpus. Candidates (research 2026-10-03; verify ids and requirements before
adding):
- **Core glue:** rgthree, KJNodes, VideoHelperSuite, GGUF (already ours),
  Essentials, Custom-Scripts.
- **Newer models:** WanVideoWrapper, LTXVideo.
- **Classics:** controlnet_aux, UltimateSDUpscale, IPAdapter_plus,
  AnimateDiff-Evolved + Advanced-ControlNet, Frame-Interpolation,
  Inpaint-CropAndStitch, inpaint-nodes, RES4LYF, Detail-Daemon.
- **Deliberately not reviewed:** WAS (unmaintained); Easy-Use, LayerStyle and
  RMBG (conflicting dependencies); Comfyroll and Efficiency (stale); ReActor
  (policy concerns and flaky installs). These can still install from the
  registry under the normal policy, with the safety net.
- Watch-outs:
  - controlnet_aux and LayerStyle list `torch` itself as a requirement.
  - The packs mix opencv-python, -headless and -contrib.
  - rgthree and Custom-Scripts are mostly front-end JavaScript: check they don't
    clash with HEISS.

**E4. Install safety net: quiet until something breaks**
1. **Snapshot before every install.** A few KB, invisible to the user. It records:
   - `pip freeze`;
   - every `custom_nodes/*` folder with its git HEAD;
   - what this install is about to add.

   Keep the last N snapshots.
2. **Guards:**
   - Constrain torch, torchvision, torchaudio and numpy (as today), **plus the
     installed OpenCV variant**.
   - Run `pip install --dry-run --report` first. If a pack can only install by
     replacing a protected library, don't install it: it would break things.
     Tell the user plainly before anything is touched.
3. **Health check after the restart.** Compare before and after:
   - packs that loaded before but fail now (`IMPORT FAILED`; already parsed);
   - node classes that disappeared from `/object_info` (new);
   - whether our built-in families' required nodes are all still present (new,
     and the most important);
   - whether ComfyUI came back at all.
4. **Way back:**
   - **Healthy:** nothing beyond normal progress.
   - **Regression:** one calm card. "Installing **X** stopped **Y** from loading,
     so video workflows won't work right now. [Undo the install] [Keep it
     anyway]". Undo deletes the added folders, restores changed packages to
     their snapshot versions, and restarts.
   - **ComfyUI won't start after an install:** roll back automatically, then
     explain ("That add-on stopped ComfyUI from starting, so we undid it").
     *Open decision: confirm automatic rollback (recommended: yes).*
5. **Install history** in Settings: what each workflow added, when, and an undo
   button.
6. **Honest limits:** restoring packages fixes most breakage. It can't undo a
   pack's own install script or compiled extensions, and copying the whole venv
   is out of scope because it's gigabytes.

**E5. Validation loop:** after installs and the restart, re-run Phase C's
validation. Install whatever is still missing (one more round at most). Then
show the card, or a calm list of what's left.

**Done when:** corpus workflows needing registry packs set up with no
interaction; a deliberately breaking pack triggers the undo card; a pack that
crashes startup is rolled back automatically.

---

### Phase F: models (last)

Phase F starts only once A–E are solid. Order: cheapest and safest first.

**F1. Smart local matching** (no downloads):
- **Path-insensitive:** match on the bare filename. Normalise `\` vs `/` and
  ignore subfolders and case.
- **Near names** (`flux1-dev-fp8` vs `flux1-dev-fp8-e4m3fn`) only when the file
  header confirms the same family and format. Tell the user in one line.
- **Hash proof:** we already compute sha256 for local models (`server/civitai.js`
  `knownHash`). Match a renamed local file to the workflow's file through the
  name index (F2/F3) by checksum.
- Rewrite the stored graph to point at the local file. The user's file is never
  renamed or moved.
- Extend missing-file detection beyond the 5 loader types: any input whose
  options come from a model folder (GGUF loaders, LoRA loaders, ControlNet,
  upscale, CLIP vision, IPAdapter, SAM…).

**F2. Exact-name lists:**
- ComfyUI-Manager's `model-list.json`: 564 entries with filename, URL and folder
  (verified). Refresh it daily.
- Our catalog (54 entries, with checksums).
- Embedded `properties.models` links when a workflow happens to carry them (free
  and exact; never relied on). No parsing of notes or text nodes.

**F3. Our Civitai name index** (the big one). Measured 2026-10-03, 70 top
models:
- Civitai lookup by hash returned 200 with no token.
- Downloads returned 307 redirects with no token, including 3 NSFW checks.
  **Still to check:** whether the redirect target actually serves the file
  anonymously.
- Civitai search by filename is unreliable.
- Civitai filenames are deterministic (`modelName_versionName.safetensors`).

The plan:
- Build **filename → version id + sha256 + size + base model** by paging the
  Civitai API (top N models, all versions).
- Host it and refresh it, or have each install build its own copy if hosting
  conflicts with Civitai's API terms. **Check the ToS and rate limits.**
- On import: look up the filename, download from Civitai, **verify the sha256**.
- If Civitai asks for login (early access, gated): offer an optional "Connect
  Civitai" key, a one-time paste like our HF token.

**F4. Hugging Face as a mirror only:**
- 15 of 70 files (21%) had exact-name hits, all checksum-matched (measured).
- Use it only when the file's LFS sha256 equals the known checksum, e.g. when
  Civitai is down.
- **No HF search-based guessing** (decided).

**F5. When nothing is found:**
- **LoRAs:** run without them, silently, by rewiring around the LoRA node (its
  file must exist, so strength 0 isn't enough) or removing the entry from rgthree
  Power Lora. Note it on the result: "Made without *film_grain_v3* (not found)".
- **Main model:** substitute with one the user has, using these rules:
  1. same family only, checked by header (Chroma → Chroma, never → Flux);
  2. same format by default (GGUF → GGUF). Cross-format only within the family
     and only when nothing same-format exists, using our existing GGUF loader
     swap;
  3. always say it: "Using your *chroma-Q5* instead of *chroma-Q8* (not found)";
  4. no same-family model → calm "needs X" message, no substitution.
- Header detection must know the newer bases in the measured sample: Krea 2,
  Qwen 2.1, Z-Image, LTX 2.3, Anima, MiniMax H3.

**F6. Download hygiene:**
- Check disk space before starting (an interruption only if it's insufficient).
- Verify the checksum when known. Read the safetensors header after download and
  confirm the family the loader expects.
- Widen the allowed hosts (Civitai, HF mirrors) and folders (upscale_models,
  controlnet, sams, ipadapter, clip_vision, …).
- `.pt` / `.pth` / `.ckpt` can contain code: allow them only from trusted
  sources (catalog / Manager list), or with a warning.
- Resume support already exists (`.part` + sidecar). Keep it.

**Done when:** in a corpus dry run, every missing model resolves to local /
download / substitute / skip, there are no silent wrong-family substitutions,
and every download is checksum-verified.

---

## 4. The import experience, end to end (target)

1. **Import workflow** → the picker opens on *Recent in ComfyUI*. Tap a
   thumbnail, or drop a file or image.
2. The strip reads "Reading workflow…" (Phase C, about 1–5 s).
3. If needed, one content question appears ("Which of these is your prompt?").
4. The strip reads "Getting 2 add-ons…" and then "Restarting ComfyUI…". This is
   automatic for registry packs; GitHub-only packs get one question.
5. (Phase F) "Getting 3 models · 18 GB · 1 found on your machine".
6. The card appears: thumbnail, prompt box, a few controls, *More settings*. A
   small footnote lists anything substituted or skipped.
7. If something broke: the undo card. If ComfyUI wouldn't start: auto-rolled
   back, with an explanation.

---

## 5. Open questions and things to verify

| # | Question | How to settle it |
|---|---|---|
| 1 | Headless Chromium on every platform we support (Windows portable, macOS, Linux, low-RAM)? | Spike in Phase C |
| 2 | Best way to validate without running: does `/prompt` reject with `node_errors` before execution in current ComfyUI? | Test against current ComfyUI |
| 3 | Comfy registry API: node → pack lookup? A trust signal (verified publisher)? | Read the api.comfy.org docs from an unblocked network |
| 4 | Do WebP / video outputs embed the workflow like PNG does? | Test with SaveImage WebP and VHS |
| 5 | Automatic rollback when ComfyUI won't start | Product decision (recommended: yes) |
| 6 | Do Civitai 307 redirects serve the file without a token? | One live test |
| 7 | Civitai ToS / rate limits for a hosted filename index | Read the terms; fall back to per-install indexing |
| 8 | Chroma and Qwen-Image availability (not in the measured sample) | Extend the measurement |
| 9 | Accuracy targets for Phase D (80% no-question, 0 wrong silent picks) | Tune once Phase A is running |

## 6. Explicitly out of scope

- Parsing notes or text nodes for download links.
- Hugging Face search-based model guessing.
- Copying the whole Python environment for rollback.
- Editing workflows' graph structure in HEISS (that's ComfyUI's job; we offer
  "Open in ComfyUI").
- Workflows that need a human mid-run (hand-painted masks, interactive picker
  nodes): mark them "best used in ComfyUI".
