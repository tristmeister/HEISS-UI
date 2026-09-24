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
- Add a line for anything people will notice under **Unreleased** in [CHANGELOG.md](./CHANGELOG.md).

## Versions and releases

HEISS UI uses [Semantic Versioning](https://semver.org/). `package.json` holds the version, and every release is a `vX.Y.Z` tag with the same number.

Until the public 1.0 release, versions stay at `0.x.y`:

- **Minor** (`0.2.0` → `0.3.0`): new features. Before 1.0 this is also where breaking changes go (settings that reset, a workflow format change), called out in the changelog.
- **Patch** (`0.2.0` → `0.2.1`): fixes only, safe to take without reading the notes.
- **1.0.0** is reserved for the public announcement. The release script refuses a plain `major` bump before then, so it can only happen on purpose.

### When to release

- **Patch:** the same day a fix matters to people running a release, like a generation that fails, settings that get lost or a download that breaks.
- **Minor:** when a feature people will notice is finished and tested on real models. Batch them instead of releasing every commit; while the app changes quickly that is roughly every one to two weeks.
- **Not yet:** anything still waiting on a test with real models, or with an empty **Unreleased** section.

Before every release, on a real ComfyUI with GPU:

1. Generate with three or four model families, including one all-in-one checkpoint and one model-only file.
2. Run one smart upscale.
3. Unpack the release zip (`npm run package` builds it) in a fresh folder and start it with its launcher.
4. Check that **Settings › About** shows the version and the update check answers.

### Cutting a release

To cut a release, from an up-to-date `main` with the notes written under **Unreleased**:

```bash
npm run release -- minor --dry-run   # checks everything, changes nothing
npm run release -- minor             # bump, date the changelog, commit "Release vX.Y.Z", tag
git push --atomic origin main vX.Y.Z # publishes the GitHub release
```

`patch`, `minor` or an exact version like `1.0.0` all work; `--push` pushes for you. The script checks the tree is clean and in sync, runs the tests and the build, and moves the **Unreleased** notes into the new version. Pushing the tag runs the Release workflow, which checks the tag matches `package.json`, builds the download and publishes it with that changelog section as the notes. Release copies find it through their update check and install it in one click: `server/updater.js` downloads it and checks it against the SHA-256 digest GitHub publishes for the asset, and `scripts/start.mjs` (a release's `npm start`) swaps it in on restart and rolls back if it does not start.

Between releases a source checkout shows how far it is past its tag in **Settings › About**, for example `v0.2.0 + 3`.

## Found a bug?

[Open an issue](https://github.com/tristmeister/HEISS-UI/issues) with what you did, what you expected and what happened. Your ComfyUI version and the model or workflow you used help a lot.
