# Automatic input sizing review

Reviewed 3 October 2026 against the supplied FOKUS PDF, HEISS UI's generation pipeline and upstream ComfyUI source.

## What the brief means

The Reddit screenshot explicitly describes a **starter image** above 2K making ComfyUI hang. The user's accompanying annotation asks for automatic sizing and sensible defaults. The subsequent request extends this to references and asks for one switch, enabled by default. The screenshot reports a symptom; it does not establish a universal safe resolution or prove the hang's cause.

## Findings in the earlier implementation

- It inserted `ImageScale` into selected built-in image graphs, with a fixed width and zero height. That preserves aspect ratio but does not cap the long edge. A portrait can remain taller than the chosen limit.
- The same operation enlarges images below that width. More pixels can mean more VAE and sampling work.
- Edit models that consume references through conditioning and imported workflows did not consistently take that path.
- `LoadImage` still read the full original before the resize node. Moving resizing before upload avoids that full input tensor in ComfyUI.
- Missing settings could become NaN; selecting Original fell back to the default limit through the UI's truthiness check. Retry did not restore the preference.
- A graph assertion confirmed node insertion, not the dimensions or pixels actually uploaded.

This was a partial workaround. It needed a shared input preparation path and a smaller UI.

## Research and model differences

| Path | What upstream does | HEISS UI decision |
| --- | --- | --- |
| General ComfyUI resizing | `ImageScale` accepts explicit dimensions; a zero dimension derives the other from aspect. `ImageScaleToTotalPixels` computes a square-root scale from pixel area and supports a dimension grid. | Use a pixel budget derived from requested generation width × height. Shrink only; preserve framing. |
| Direct starter → VAE → sampler | The starter's latent dimensions determine sampling size. An unrelated empty latent's width/height do not limit that image. | Resize the starter before upload and align large resized starters to the existing family grid. Record actual staged dimensions and retain the original request dimensions for retry. |
| Flux Kontext | The dedicated resize node chooses among preferred aspect buckets around one megapixel and can center-crop. | Retain the model's own node. Generic input preparation does not replace its bucket policy. |
| Qwen edit | Older encoders use separate vision-language and VAE reference sizes (roughly 384² and 1024² pixels). Qwen 2.1 accepts a resolution parameter and uses resolution² pixels with a 32-pixel grid. | Retain the encoder's own sizing. Bound uploaded references using the requested output budget; do not invent separate user controls. |
| Wan image-to-video | Native nodes resize the start frame to the requested video width and height before encoding; some paths center-crop. | Bound the uploaded input first, then let the native video node choose its required shape. |
| Imported workflows | Their graphs may contain custom reference encoders, resize nodes and intentional crops. | Resize each selected image before upload, preserving existing graph semantics. Reference-driven output framing uses the workflow's default pixel budget instead of blindly adopting a huge original. |
| Inpaint | HEISS UI already builds a bounded working crop and stitches it into the original using the mask's coordinates. | Keep the first source full-size for crop/stitch alignment. Additional references still resize. An empty-mask fallback receives ordinary input sizing. |
| Smart upscale | Upscaling deliberately needs the source resolution. Existing gallery reuse selects the displayed upscale at the original's dimensions. | Leave the dedicated upscale operation unchanged. Automatic generation sizing runs after existing gallery reuse handling. |

Primary sources:

- [ComfyUI LoadImage, ImageScale and VAE nodes](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py)
- [ComfyUI area-based sizing and resize options](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_post_processing.py)
- [Flux Kontext reference sizing](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_flux.py)
- [Qwen reference encoders](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_qwen.py)
- [Wan start-frame implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_wan.py)
- [Official Wan 2.2 workflow guidance](https://docs.comfy.org/tutorials/video/wan/wan2_2)
- [Sharp resize API and Lanczos filtering](https://sharp.pixelplumbing.com/api-resize/)

The policy is an engineering inference from those implementations, not a universal upstream rule. Model differences belong in existing workflow defaults and native nodes. A single 2048-edge limit is neither a model target nor a VRAM guarantee.

## Implementation

Settings → Generation → Input images contains one switch: **Automatically resize input images**, on by default. An explicit Original choice from the earlier preference migrates to off.

`prepareInputImage` reads oriented dimensions and calculates:

```
scale = min(1, sqrt(requestedWidth * requestedHeight / sourcePixels))
```

Large inputs use Lanczos3 downsampling and lossless PNG output to retain alpha. No new crop or sharpening is applied. Required dimension rounding can change the ratio by a few pixels. Inputs already within budget retain their exact bytes. The uploaded generation copy changes; stored originals do not.

Every reference slot and legacy starter upload uses the shared preparation helper. Missing Sharp produces an actionable error when resizing is enabled. Multi-frame files are rejected in this path rather than silently selecting a frame.

Where the ComfyUI input directory is accessible, resized uploads have unique names and use existing run cleanup on success/failure. Remote ComfyUI has no native input-delete endpoint, so public resized copies use content names to avoid adding a duplicate on each identical run. Hidden runs retain their existing stricter cleanup. Local temporary derivatives can be cleaned without deleting another run's input. Remote input-file cleanup remains subject to the existing backend limitation.

The original requested size is saved for direct img2img retries, avoiding progressive size loss from rounding again on every retry. The resizing switch is saved with generation settings and restored on retry.

## Evidence and limitations

Real-pixel tests cover portrait/landscape files, different budgets, small inputs, switch-off behavior, EXIF rotation, alpha, dimension grids and original preservation. Upload tests inspect the multipart image bytes for both reference slots and legacy starters, verify unique temporary names, and cover inpaint and upscale exclusions. Existing graph and privacy tests remain in the full suite. The production build and full suite pass; the settings panel was inspected in an isolated demo.

No live GPU generation or memory stress measurement was performed. Input sizing reduces excess source pixels; it cannot guarantee a particular model, output size, frame count, batch or custom workflow fits available VRAM. Custom nodes may deliberately enlarge their inputs again. Resizing a source before a specialized encoder may also slightly alter edit conditioning, which is why the off switch is available.
