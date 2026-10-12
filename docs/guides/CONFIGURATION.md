# Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

```bash
COMFY_URL=http://127.0.0.1:8188
HOST=127.0.0.1
PORT=8787
HEISS_DATA_DIR=./data
COMFY_OUTPUT_DIR=
```

`COMFY_OUTPUT_DIR` is optional; the folder is usually found without it. The folder is needed to delete files along with their cards and to remove ComfyUI's copies of what goes into Hidden. Settings only accepts a folder ComfyUI writes to (one with ComfyUI's images, or next to its `models` or `custom_nodes`). **Delete all finished images** moves them to `.heiss-trash` in that folder, where they wait 30 days (`HEISS_TRASH_DAYS`) in case you want them back.

For other devices: `HEISS_ALLOWED_HOSTS` (extra names to answer to, comma-separated), `HEISS_DEVICE_SESSION_DAYS` (how long a device stays signed in, 1 to 30 days, 7 by default), and `HEISS_TLS_CERT`, `HEISS_TLS_KEY` and `HEISS_HTTPS_PORT` for HTTPS. See [Connect over LAN](#connect-over-lan), [On your phone](#on-your-phone) and [SECURITY.md](./SECURITY.md).

Also optional: `HEISS_COMFY_SEARCH=0` keeps HEISS on `COMFY_URL` (by default, when that doesn't answer, HEISS looks on 8188 and 8000 and switches to whatever ComfyUI answers there), `HEISS_NO_BROWSER=1` keeps the launcher from opening the browser, and `HEISS_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` (or a token saved in **Settings › Models**) opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy.
