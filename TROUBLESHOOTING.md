# Troubleshooting

What the common problems mean and how to get past them. When a generation fails, its card links straight to the matching section below.

Still stuck? **Settings › About › Copy diagnostics** copies your HEISS UI, Node.js and ComfyUI versions, your system and GPU (no prompts, images or file names). Paste it into [an issue](https://github.com/tristmeister/HEISS-UI/issues) with what you did and what happened. A failed card's **Copy report** adds the error itself.

- [Starting HEISS UI](#starting-heiss-ui)
- [When a generation fails](#when-a-generation-fails)
- [Downloads and node packs](#downloads-and-node-packs)
- [Updates](#updates)
- [Phones and other devices](#phones-and-other-devices)

## Starting HEISS UI

### HEISS UI can't reach ComfyUI

HEISS UI draws nothing itself; ComfyUI renders every image. Start ComfyUI first, and the studio connects by itself when it answers.

HEISS UI looks for ComfyUI at `127.0.0.1:8188`. **ComfyUI Desktop usually uses port 8000**, a manual or portable install 8188. Set the address under **Settings › Connection** (a bare port such as `8000` works), or set `COMFY_URL` in `.env`. ComfyUI on another computer needs to be started with `--listen` so it answers there.

### The browser didn't open, or opened the wrong address

The launchers (and `npm start`) open the studio once, when it is ready. They don't in a terminal over SSH, on a Linux machine without a desktop, in CI, or with `HEISS_NO_BROWSER=1`. Open the address the terminal window prints under **Open**, usually `http://localhost:8787`.

Use `localhost` rather than `127.0.0.1`: passkeys for Hidden only work on a name.

### It says the port is taken, or that HEISS UI is already running

When another program uses port 8787, HEISS UI moves to the next free one (8788, 8789, …) and says so in the terminal; the browser opens that one. To keep one fixed port, set `PORT` in `.env`.

"HEISS UI is already running" means another copy has the port: the browser opens that one. Close its terminal window to stop it.

### Node.js is missing or too old

The downloads for Windows, macOS (Apple Silicon) and Linux bring their own Node.js, in the `runtime` folder. A copy from GitHub source, or an older macOS or Linux download, needs **Node.js 20.9 or newer** (22 LTS recommended) from [nodejs.org](https://nodejs.org). The launcher says which version it found.

### macOS won't open the launcher

The first time, macOS may say it can't check `Start HEISS UI.command`. Right-click it › **Open**, then **Open** again, or allow it under **System Settings › Privacy & Security**. The launcher then clears the same download mark from the Node.js and packages that came in the zip.

### Windows won't start it, or the window closes at once

Unpack the zip with **Extract All** first; the launcher doesn't run from inside the zip. If Windows asks whether to run a downloaded file, right-click the zip › Properties › **Unblock** before unpacking. A plain folder such as `C:\HEISS-UI` works better than a Desktop or Documents folder synced by OneDrive, which can lock files during installs and updates.

### Linux opens the launcher in a text editor

Most file managers open a `.sh` file for editing. Use **Start HEISS UI.desktop** instead: right-click it › **Allow Launching** (GNOME) or make it executable, then double-click it; it runs the launcher in a terminal. Or run `./"Start HEISS UI.sh"` in a terminal in that folder.

### No models show up

HEISS UI lists what ComfyUI lists: files in ComfyUI's `models/checkpoints` and `models/diffusion_models` folders (and anything `extra_model_paths.yaml` adds). After adding a file, use **Settings › Models › Rescan**. **Find models** looks for model files elsewhere on this computer and links them in. GGUF files aren't supported yet.

## When a generation fails

A failed run stays in the gallery as a card that says what went wrong. Open it for the hint, **Use these settings** to try again, and **Copy report** for the full error.

### A model file is damaged or incomplete

The file couldn't be read: a download stopped early, or a web page was saved under a model's name. The card names the file and whether it is the model, the VAE, a text encoder or a LoRA. Delete it and download it again; downloads HEISS UI offers resume and check themselves.

### The GPU ran out of memory

The model, the image size and the number of images at once didn't fit in your GPU's memory. Try a smaller size, fewer images per run, or a lighter model (an fp8 or smaller variant). **Settings › General › Clear cache** frees what ComfyUI still holds from earlier runs. On a Mac, closing other large apps helps too.

### ComfyUI does not have a file this run asked for

ComfyUI answered "Value not in list": a model, LoRA, text encoder or VAE picked here isn't in ComfyUI's folders (anymore), or ComfyUI hasn't noticed a new one yet. **Rescan** in Settings › Models, or pick another file.

### Parts that do not fit together

The text encoder, VAE or a LoRA was made for a different model family (for example a Flux LoRA on SDXL), so their sizes don't match. Check the picks under **Advanced** and turn off LoRAs that don't match the model.

### A file went missing

Something the run needs was moved or deleted after ComfyUI listed it. **Rescan** in Settings › Models and try again.

### A node is missing in ComfyUI

The workflow uses a custom node ComfyUI doesn't have. Install the node pack (HEISS UI offers it when it knows which one), restart ComfyUI, and try again. For a built-in model, HEISS UI says **Newer ComfyUI** instead when ComfyUI itself is too old: update ComfyUI.

### Lost the connection to ComfyUI

ComfyUI stopped answering mid-run: it crashed (often from running out of memory), was closed, or restarted. Check its window or log, start it again if needed, then try again.

### No image was saved

The run finished without an image HEISS UI can show. An imported workflow may end in a preview node instead of **Save Image**, or ComfyUI skipped a step. Run the workflow once in ComfyUI itself to see what it does.

### Needs a separate part

A checkpoint that looked all-in-one turned out to lack its text encoder or VAE. HEISS UI remembers that for the file: rescan models, pick (or download) the missing part under **Advanced**, and generate again.

### Generation failed

Anything else. **Show details** on the card has ComfyUI's own message and traceback. Check that the model runs in ComfyUI itself, and that any custom nodes it needs are installed. If it works there but not here, please [open an issue](https://github.com/tristmeister/HEISS-UI/issues) with the copied report.

## Downloads and node packs

### A download says the file is no longer at its address

The link in this version of HEISS UI is out of date (HTTP 404). Update HEISS UI under **Settings › About**; newer versions carry newer addresses. You can also download the file yourself from its Hugging Face page and put it in the ComfyUI folder the setup panel names, then **Rescan** in Settings › Models.

### A download needs a Hugging Face login

Some models need you to sign in and accept a licence first (HTTP 401 or 403). Download the file in your browser from the page HEISS UI opens, put it in the named ComfyUI folder, and **Rescan** in Settings › Models.

### ComfyUI-Manager refuses to install a node pack

Installing a node pack from its Git address is something ComfyUI-Manager only allows at a security level of `normal-` or `weak` (its default is `normal`). Either use the terminal command the panel shows, or lower the level:

1. Stop ComfyUI.
2. Open Manager's `config.ini`: `ComfyUI/user/__manager/config.ini` in current versions, `ComfyUI/user/default/ComfyUI-Manager/config.ini` in older ones.
3. Set `security_level = normal-` and save.
4. Start ComfyUI again and retry the install.

`normal-` only applies while ComfyUI listens on this computer alone. Set it back to `normal` afterwards if you prefer.

### A download stops because the disk is full

HEISS UI checks the free space before a large download. Free some space on the disk that holds ComfyUI's models, then start it again; it resumes where it stopped.

## Updates

### A downloaded release went back to the previous version

A release copy installs an update on restart and keeps the old version. If the new one doesn't start, HEISS UI goes back by itself and **Settings › About** says why. Try again later, or download the new zip by hand and unpack it over the old folder (your `data` folder and `.env` stay).

### A Git checkout wasn't updated

**Install update** in a copy cloned with Git only runs when the copy has no changed files of its own; commit or stash them first, or update by hand with `git pull`, `npm install`, `npm run build`. If the new version doesn't install or build, HEISS UI goes back to the commit it had and says what failed. "Couldn't reach GitHub" means the connection is down; "Git isn't installed" means Git isn't on this computer.

## Phones and other devices

### A phone can't open the studio

1. Turn on **Settings › Connection › Other devices** and restart HEISS UI when it asks.
2. Use one of the addresses Settings shows (the phone must be on the same network).
3. Other devices sign in with a password set up on this computer first.
4. If the page still doesn't load, the computer's firewall may block the port: allow Node.js (or port 8787) for private networks.
