# HEISS model search

A standalone demo is at `/model-search-demo/`. The site’s existing `npm run site` preview serves it. No build step or dependencies are required.

## Drop into a website page

Keep `model-search/` (all three JS/CSS assets) and the catalog at `models/model-support-search.json`. Include this once:

```html
<script type="module" src="/model-search/section.js"></script>
<heiss-model-search></heiss-model-search>
```

For a catalog at another URL:

```html
<heiss-model-search catalog-url="/your-model-catalog.json"></heiss-model-search>
```

The component uses Shadow DOM to scope its styles. It inherits HEISS tokens `--sans`, `--mono`, `--pixel`, `--text`, and `--ember`, with fallback fonts/colors. The demo uses the website’s self-hosted fonts via `styles.css`. Give its parent a width and section spacing; the component caps itself at 860px. Existing landing page is not modified.

## Behavior

- Index built once on load. No search API, tracking, AI requests, or dependencies.
- Unicode/accent normalization, punctuation/underscore tolerance, joined names, case-insensitive search, family aliases, creator/original title/version/file terms, token prefixes, one-edit typos and adjacent transpositions. Numeric tokens are not fuzzed. All query tokens must match unless the full query is contained in a field.
- Results rank exact names and aliases first. Approximate matches are labeled. Eight checkpoints initially render, with incremental expansion; native details expose context and Civitai links.
- Family, image/video filters and browse all; `/` focuses search, arrows navigate result controls, Escape returns to search or clears it. Normal Tab navigation remains available.
- NSFW defaults off each visit. Every checkpoint shows Yes/No from the catalog. Adult links require a modal confirmation. No remote images or previews are loaded.
- External URLs restricted to HTTPS Civitai model pages. Links preserve version IDs and open with `noopener noreferrer`.
- Visible loading, retry, no-match and family-only states; polite announcements and keyboard-visible focus. Touch layouts, mobile input sizing, and reduced motion supported.

## Data boundaries

This is family support plus catalog discovery, not a claim that every checkpoint has been tested. The original Civitai search buckets include loose matches, and content flags are source metadata. No match means “not in this catalog.” Generic family entries do not invent external URLs.

## Motion and performance

Only the section entrance, native detail disclosure, focus/hover/press states and confirmation dialog animate. Results do not replay entrance animations on each keystroke. Search input is debounced 65ms; index normalization happens once. The first visible checkpoint batch is capped to avoid rendering hundreds of rows. Shared default catalog requests are cached across component instances; custom catalog fetches abort on disconnect. The catalog snapshot is around 257 KB before compression.
