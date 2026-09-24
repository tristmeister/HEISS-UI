# Adding a model

How a new model family gets into HEISS UI so it works out of the box: dropped
into ComfyUI, recognised, set up with the settings its makers ship, and, when
something is missing, explained with a way to get it right in the app.

Everything below is data plus one graph. The sidebar, the workflow library,
the "Use as …" picker, downloads and node-pack installs all read the same
catalog, so a family that is described correctly needs no UI work.

## The pieces

| What | Where | Holds |
| --- | --- | --- |
| Families | `server/family-catalog.js` → `families` | Label, kind, sources, encoder slots, VAE kinds, latent node, size step, negative mode, sampling style, variants with default settings |
| Detection | `family-catalog.js` → `familyFromHeader`, `familyFromName`; `model-families.js` → `familyFromMetadata` | Tensor-key signatures (mirroring ComfyUI's `comfy/model_detection.py`), filename patterns, safetensors metadata |
| Text encoders and VAEs | `server/model-components.js` → `encoderKinds`, `vaeKinds`, `encoderKindFromHeader`, `vaeLayoutFromHeader` | What each encoder or VAE file is, by shape first and name second |
| Downloads | `family-catalog.js` → `encoderDownloads`, `vaeDownloads` | Hugging Face files the Download buttons fetch. Abliterated builds first wherever a ComfyUI-ready one exists |
| Node packs | `server/node-packs.js` → `nodePacks` | Every custom node pack HEISS may ask for: name, Git URL, folder, the node classes that prove it loaded |
| Graph | `server/family-graph.js` → `familyGraph` | One builder for every family; special sampling styles branch off it |
| Profiles | `server/family-profiles.js` | Turns every model file into a runnable profile and lists exactly what is missing |

## Recipe

1. **Find the reference workflow.** Prefer Comfy-Org's
   [workflow_templates](https://github.com/Comfy-Org/workflow_templates) (their
   `properties.models` list loaders, settings and download URLs), then the
   model card, then the maker's own ComfyUI workflow. Note loaders, encoders,
   VAE, latent node, sampler, scheduler, steps, CFG, shift and resolution for
   every variant (base, turbo, distilled, 2K, …).

2. **Native or custom nodes?** Search ComfyUI for the model's loader and
   detection (`comfy/model_detection.py`, `comfy/text_encoders/`). If it is
   native, skip to step 4.

3. **Custom nodes: register the pack.** Add it to `nodePacks` in
   `server/node-packs.js`: `name`, `repository` (a `.git` URL), `folder` (its
   `custom_nodes` folder), `nodes` (classes it must load), and optionally
   `search` (what finds it in Manager's list) and `note` (one line for the
   panel). Then point the family at it with `pack: "<id>"`. When a model runs
   on more than one pack (for example one CUDA-only, one that also runs on
   Apple Silicon), describe each as a runner the way `sanaRunners` does, one
   model source per runner. HEISS then shows the pack's install steps
   wherever the model appears. With ComfyUI-Manager on, the Manager route
   (Install via Git URL) opens first; otherwise one terminal command clones
   the pack and installs its requirements with ComfyUI's own Python.

4. **Describe the family** in `families`. Settings live on variants; the last
   variant is the fallback. `match(name, header, detail)` picks a variant, so
   let the weights decide where they can (see Flux Schnell and Sana Sprint)
   and the filename only where they cannot.

5. **Teach detection.** Add the tensor-key signature to `familyFromHeader` at
   the same position ComfyUI checks it, so no file is read two ways. Watch for
   keys another family also has (diffusers-format Sana carries LTX-Video's
   `adaln_single` keys). Add a filename pattern to `familyFromName` for remote
   ComfyUIs where headers are out of reach.

6. **Encoders and VAE.** Reuse an existing kind where the file is the same.
   Otherwise add the kind (header signature plus name fallback) and at least
   one download. Parts that cannot be downloaded as single files (diffusers
   folders, gated repos) get a `command` on their missing entry: a
   copyable shell command, see `diffusersDownloadPlan` in
   `server/node-install.js`.

7. **Graph.** If the family fits the common path (load, LoRAs, encode,
   KSampler or SamplerCustomAdvanced, decode, save), there is nothing to
   write. Otherwise add a `sampling` style and a branch in `familyGraph`, and
   name every node it uses in `requiredNodes` (or the pack's `nodes`) so an
   older ComfyUI is told to update instead of failing mid-run.

8. **Capabilities.** Turn off what the model cannot do: `ownLoaders` (encoder
   and VAE come with the pack, so no pickers and no LoRAs), `negative: "none"`,
   no `img2img`. Profiles hide the matching controls.

9. **Tests** in `server/model-families.test.js`. Cover detection from a
   header, each variant's defaults, what a missing part or pack reports, and
   the graph's nodes and inputs. The fixtures write tiny fake safetensors
   headers, so no weights are needed.

10. **Check it against a real ComfyUI.** Save `/object_info` and
    `/system_stats`, feed them to `inferModels`, build the graph through
    `sanitizeGenerateBody` and `familyGraph`, and queue it once on `/prompt`.
    Then add a line under **Unreleased** in `CHANGELOG.md`.

## Rules of thumb

- The weights are the first witness. Names lie; fine-tunes get renamed.
- Take settings from the makers, never from memory.
- Never prefer "official" files over community ones; abliterated encoders
  lead wherever they fit.
- Everything a model needs is named in its `missing` list with a way to get
  it: a Download button, node install steps, or a copyable command. A model
  that is not ready never runs.
