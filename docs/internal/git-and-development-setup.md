# Git And Development Setup

> Historical snapshot from a J-AI Studio era work session. HEISS UI now lives at
> `https://github.com/tristmeister/HEISS-UI`; the original upstream project is
> `https://github.com/jasperdevs/J-AI-Studio`.

## Current Repository State

Repository:

```text
C:\Users\ichma\Documents\Projects\J-AI-Studio
```

Remote:

```text
origin https://github.com/jasperdevs/J-AI-Studio
```

Feature branch created for this work:

```text
feature/lora-support-docs
```

There was an existing modified file before this documentation work started:

```text
package-lock.json
```

Do not revert or overwrite it unless the owner confirms it is unwanted.

## Commit Identity

No local git identity was configured when this setup note was created. Configure it before committing:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

Use `--global` only if this identity should apply to all local repositories.

## Development Commands

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Build before review:

```bash
npm run build
```

Run production server:

```bash
npm start
```

## Git Workflow

Recommended flow for LoRA feature work:

```bash
git switch feature/lora-support-docs
git status --short --branch
npm run build
git status --short
```

Commit in small units:

1. Documentation baseline.
2. Server metadata and validation.
3. Frontend state and controls.
4. Built-in workflow graph mutation.
5. Gallery restore/details.
6. Custom workflow metadata.

## Files To Watch

Core LoRA implementation will likely touch:

- `src/app/types.ts`
- `src/main.tsx`
- `src/app/SidebarControls.tsx`
- `src/app/useGenerationActions.ts`
- `src/app/useViewerControls.ts`
- `src/app/format.ts`
- `server/models.js`
- `server/validation.js`
- `server/graphs.js`
- `server/gallery-store.js`
- `server/custom-workflows.js`
- `workflows/README.md`

Potential styling files:

- `src/styles/01-base.css`
- `src/styles/02-zen.css`
- `src/styles/03-controls.css`
- `src/styles/06-responsive.css`

## Local Data Rules

Do not commit:

- `node_modules`
- `dist`
- `.env`
- `data`
- ComfyUI outputs
- model files
- generated media
- logs
- `*.tsbuildinfo`

These are already covered by `.gitignore`.
