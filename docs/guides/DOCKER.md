# Docker

Run HEISS UI in a container while ComfyUI stays where the GPU is. The image
holds the studio alone, talks to a running ComfyUI over the network, and reads
the images ComfyUI writes through a mount of ComfyUI's output folder. Data
that has to survive a rebuild lives in a volume, not in the image.

Three things a container does differently from a plain install: the server
listens on `0.0.0.0` so the published port reaches it, it doesn't open the
studio in a browser (`HEISS_NO_BROWSER=1`), and its data is under `/data`
(`HEISS_DATA_DIR`), which is a volume. The image ships without `.git`, so the
in-app updater stays inactive — for a new release, pull the source and
rebuild.

## Build and start

With compose, from the project directory (this file sits next to the
Dockerfile and does the settings and mounts for you):

```bash
export COMFY_OUTPUT_HOST=/path/to/ComfyUI/output   # where ComfyUI writes its images
docker compose up --build
```

The studio answers at http://localhost:8787, same as on a plain install.
Regenerating in the gallery works right away through the output folder mount.

Without compose, same result by hand:

```bash
docker build -t heiss .
docker run --name heiss-ui -d -p 8787:8787 \
  --add-host=host.docker.internal:host-gateway \
  -v heiss-data:/data \
  -v /path/to/ComfyUI/output:/comfy-output \
  -e COMFY_URL=http://host.docker.internal:8188 \
  -e COMFY_OUTPUT_DIR=/comfy-output \
  heiss
```

## Reaching ComfyUI

The server looks for ComfyUI at `COMFY_URL`, `http://host.docker.internal:8188`
by default. `host.docker.internal` is the Docker name for the computer Docker
runs on; compose adds it on plain Linux too (`extra_hosts`), and Docker
Desktop knows it anyway. `--add-host` in the `docker run` version does the
same.

Whatever the way, ComfyUI has to be listening beyond 127.0.0.1 for the
container to reach it: start it with `--listen`. On another machine or port,
override `COMFY_URL` (compose) or change `-e COMFY_URL` (docker run) —
this is the same setting **Settings › Connection** writes.

## The output folder

HEISS reads the images ComfyUI produces straight from the folder ComfyUI
writes to. In a container, the path ComfyUI reports is one inside the machine
it runs on, which the container only reaches if you mount it — so the
compose file and the `docker run` above mount the output folder at
`/comfy-output` and set `COMFY_OUTPUT_DIR` to it. Without the mount the
studio still runs, but the gallery stays empty.

`COMFY_OUTPUT_HOST` (the left side of the mount in compose) is a Docker
compose setting, not one of the app's — the application variables are the
familiar ones from [.env.example](../../.env.example).

## Notes

- **Settings that persist**: the app writes settings to its own `.env` file.
  Inside a container that file is on the container's own disk, so a removed
  (and re-created) container forgets it. Set what you rely on in compose or
  the `docker run` line instead. The data volume, on the other hand, keeps
  the gallery, the vault and everything under `HEISS_DATA_DIR` across
  rebuilds.
- **Updates**: the image has no `.git` and no downloaded release
  infrastructure, so Settings › About won't offer to update it. New version:
  pull the source and `docker compose up --build`.
- **Other devices**: publish the port on the network you want, and follow
  [CONFIGURATION.md](./CONFIGURATION.md) for legal host names, HTTPS (the
  certificate pair needs a mount) and the rest.
- **Video previews**: the image brings `ffmpeg-static`, the same optional
  encoder the app installs otherwise.
- **Node version**: the image uses Node 22, the version the launcher
  recommends. Everything else about the runtime is the repository's own:
  the build stage runs `npm run build`, the runtime stage installs only the
  server's dependencies.
