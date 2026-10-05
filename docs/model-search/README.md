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

The component uses Shadow DOM to scope its styles. It inherits HEISS tokens `--sans`, `--mono`, `--pixel`, `--text`, `--text-2`, `--text-3`, `--surface*`, `--line*`, `--action*` and `--ember`, with fallback fonts/colors. The demo uses the website’s self-hosted fonts via `styles.css`. Give its parent a width and section spacing; the component caps itself at 720px. The landing page places it under the hero (`#models`).

## Behavior

- Index built once on load. No search API, tracking, AI requests, or dependencies.
- Unicode/accent normalization, punctuation/underscore tolerance, joined names, family aliases, creator/title/version terms, token prefixes, one-edit typos and adjacent transpositions. Exact names and aliases rank first.
- The empty state is just the field. Results appear as you type; a family name lists that family's checkpoints.
- Results are one grouped list that scrolls inline and loads 30 more as you near the end. Rows link straight to Civitai. NSFW checkpoints carry a small tag; clicking one opens a short heads-up under the row with the link.
- `/` focuses search, Enter opens the first result, arrows move through results, Escape clears.
- Motion: keyed rows (kept rows slide to their new place, new ones fade in with a short stagger), animated result height and a clear-button pop. All off under reduced motion.
- External URLs restricted to HTTPS Civitai model pages, opened with `noopener noreferrer`.

## Data boundaries

This is family support plus catalog discovery, not a claim that every checkpoint has been tested. The original Civitai search buckets include loose matches, and content flags are source metadata. No match means “not in this catalog.” Generic family entries do not invent external URLs.

## Motion and performance

Rows are reused between keystrokes, so typing animates differences instead of re-rendering the list. Searching runs once per animation frame; index normalization happens once. The first visible checkpoint batch is capped to avoid rendering hundreds of rows. Shared default catalog requests are cached across component instances; custom catalog fetches abort on disconnect. The catalog snapshot is around 257 KB before compression.
