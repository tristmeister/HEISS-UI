# Contributing

Thanks for wanting to help with HEISS UI. It's a local front end for ComfyUI, so most changes are best tested against a real local ComfyUI server, especially anything that touches generation.

## Setup

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm test
npm run build
```

## Pull requests

- Keep changes focused. One idea per PR is easier to review.
- Keep the UI consistent with what's there: dark canvas, floating pill surfaces, one white primary action, and the square pixel accent used sparingly.
- Keep server changes local-only by default.
- Document any new environment variable in `.env.example` and the README.
- Don't commit model files, generated media, logs or `.env` files.
- New workflow templates belong in `workflows/` with a `heissUi` mapping block. See [the workflow guide](./workflows/README.md).

## Found a bug?

[Open an issue](https://github.com/tristmeister/HEISS-UI/issues) with what you did, what you expected and what happened. Your ComfyUI version and the model or workflow you used help a lot.
