# Model support search: scope and implementation plan

## Goal

Give a visitor one search field for a model, checkpoint, alias, or filename fragment and a clear answer about whether its **model family** is supported by HEISS UI. Keep family support separate from claims that one named Civitai checkpoint has been tested.

## Search catalog

`model-support-search.json` is the website-sized catalog derived from the supplied Civitai export and the app's canonical family registry in `server/family-catalog.js`. Regenerate it with `node scripts/build-model-support-search.mjs <civitai-export.json>`.

- It carries all 28 runnable app family IDs and labels, family-level aliases, and compact checkpoint records with Civitai model ID and version ID, polished display name, original title for search, creator, Civitai model-version URL, source base model, optional family tags, and an explicit `nsfw: true/false` value.
- The build script applies editorial title rules plus a small set of hand-written overrides for names that cannot be cleaned well from punctuation alone. It removes launch copy, CJK text, emoji, repeated NSFW/SFW labels, and file-format clutter. The untouched source title remains searchable as `searchName`; technical/version metadata remains in its own fields.
- The 37 source buckets are folded into canonical runtime families. Variant buckets such as SDXL Lightning and SDXL Pony become tags within SDXL. Identical model/version pairs within a family are merged; distinct versions of one Civitai model and associations across families are retained. Mixed “general” buckets are assigned only when the record's base model maps to a known runnable family. Sixteen Qwen-Image-Edit versions were excluded because HEISS recognizes that as an unsupported family.
- The current catalog contains 967 family/version entries (906 distinct Civitai model IDs) across 20 families with checkpoint data. Eight runnable families have no confidently assigned checkpoint from this export; they still appear in the catalog and remain searchable by family name.
- Every checkpoint result should visibly show NSFW Yes or No. Keep NSFW Yes results out of suggestions by default; require an explicit opt-in before showing or opening them. Use the version-specific Civitai URL so a multi-family model opens the version that matched the selected family.
- The export documents that query-based Civitai buckets may include false positives. The catalog preserves those source associations, so popularity is discovery guidance, not proof that an individual version works. A checkpoint result must not imply that the exact merge was tested.
- The source list is popularity discovery, not a compatibility certification. A matching checkpoint result must say “Popular checkpoint for a supported family” (or equivalent), not imply the exact merge is verified. Family-level results can say the family is supported.

## Search behavior

1. Normalize with Unicode NFKD, lowercase/case-fold, diacritic removal, and tokenization that treats spaces, `_`, `-`, `.`, and punctuation as equivalent separators. Thus `NoobAI XL`, `noobai_xl`, and `NoobAI-XL` converge.
2. Search across family labels, aliases, checkpoint names, creators, and tags. Keep a small, curated synonym map for common shorthand and spelling variants (for example `sdxl` / `stable diffusion xl`, `flux 2` / `flux.2`, `z image` / `z-image`). Do not infer support from an arbitrary substring or filename extension.
3. Rank exact normalized family/checkpoint matches first, then exact token sequences, token-prefix matches, all-token matches, and finally typo-tolerant fuzzy matches. Preserve a relevance score and explain which family matched. A fuzzy match must be presented as a suggestion, never an exact identification.
4. Show family results separately from checkpoint suggestions when both match. For a checkpoint match, display the parent supported family, the checkpoint name, creator, and a link to Civitai. If no checkpoint matches but the family does, state family support and explain that the exact checkpoint is not in this curated popularity list.
5. For no match, invite the user to try a family name or a shorter spelling. Avoid saying “unsupported” based only on absence from this finite list; the app accepts renamed files and detects weights at runtime.

## Website implementation sequence (not started)

1. Add a self-contained section to the existing docs/site page with one labelled search input, a concise support explanation, an accessible result list, and an adult-results opt-in. Reuse the site's current visual tokens and layout.
2. Load the JSON only when the section is needed (or as a small static asset); build normalized search fields and the index once. At 957 family/checkpoint associations, keep ranking on the main thread and avoid a search service or worker until profiling shows a need.
3. Debounce input by roughly 80–120 ms, cap visible results, and use stable result keys. Keep filtering synchronous for immediate feedback after debounce; don't animate the entire result list on every keystroke.
4. Animate only meaningful state changes: subtle opacity/height transitions for result panels and family expansion, with a short duration, transform/opacity where possible, and `prefers-reduced-motion` support. Do not delay typing or result availability for an animation.
5. Support keyboard use (label, clear button, arrow/enter/escape behavior if using a combobox), screen-reader result counts, visible focus, and touch-sized controls. Preserve ordinary text input and browser find behavior.
6. Keep family IDs aligned with the runtime registry. When adding or removing a model family, update this static catalog from the canonical family registry and review aliases and source provenance.

## Acceptance checks for the later build

- Queries differing only by capitalization, accents, spaces, hyphens, dots, or underscores return the same intended family/checkpoint.
- Common aliases and a one-character typo surface the intended result below exact matches.
- A family match never becomes an exact-checkpoint verification claim.
- Mixed/unknown architecture entries never appear as confirmed matches.
- Adult entries are absent until opt-in; the choice is keyboard and screen-reader accessible.
- Search remains responsive with the complete catalog, results are keyboard reachable, and reduced-motion preference removes nonessential movement.
