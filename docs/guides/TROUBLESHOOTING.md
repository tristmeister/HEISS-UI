# Troubleshooting

Common problems and how to get past them. A failed generation's card links to its section below.

Still stuck? **Settings › About › Copy diagnostics** copies the HEISS UI, Node.js and ComfyUI versions, the system and the GPU, without prompts, images or file names. Paste it into [an issue](https://github.com/tristmeister/HEISS-UI/issues) with what you did and what happened. **Copy report** on a failed card adds the error itself. Or skip the pasting: **Report bug** on a failed card and **Settings › About** send it to the [feedback board](https://heiss-ui.vercel.app/board/), with the setup lines if you want them. For a quick hand, ask in the [Discord](https://discord.gg/Hf7ysvDeGa).

- [Starting HEISS UI](#starting-heiss-ui)
- [When a generation fails](#when-a-generation-fails)
- [Downloads and node packs](#downloads-and-node-packs)
- [Updates](#updates)
- [Phones and other devices](#phones-and-other-devices)

## Starting HEISS UI

### The studio can't reach ComfyUI

ComfyUI makes every image, so it has to be running. Start it and the studio connects.

ComfyUI Desktop usually uses port 8000, a manual or portable install 8188. Both are checked on this computer. For another address, set it in **Settings › Connection** (a port such as `8000` is enough) or set `COMFY_URL` in `.env`. ComfyUI on another computer needs to be started with `--listen`.

### The browser didn't open, or opened the wrong address

The launchers and `npm start` open the studio once it's ready. They don't over SSH, on Linux without a desktop, in CI, or with `HEISS_NO_BROWSER=1`. Open the address the terminal shows under **Open**, usually `http://localhost:8787`.

Use `localhost` rather than `127.0.0.1`. Passkeys for Hidden only work on a name.

### The port is taken, or HEISS UI is already running

When port 8787 is in use, the next free one (8788, 8789, …) is used instead. The terminal says which, and the browser opens it. To keep one fixed port, set `PORT` in `.env`.

"""HEISS UI is already running""" means another copy has the port. The browser opens that copy. Close its terminal window to stop it.

### Node.js is missing or too old

The Windows, macOS (Apple Silicon) and Linux downloads include Node.js in the `runtime` folder. A copy from GitHub, or an older macOS or Linux download, needs **Node.js 20.9 or newer** (22 LTS recommended) from [nodejs.org](https://nodejs.org). The launcher says which version it found.

### macOS won't open the launcher

The first time, macOS may say it can't check `Start HEISS UI.command`. Right-click it › **Open**, then **Open** again, or allow it in **System Settings › Privacy & Security**. The launcher then clears the same mark from the Node.js and packages in the zip.

### Windows won't start it, or the window closes at once

Unpack the zip with **Extract All** first. The launcher doesn't run from inside the zip. If Windows asks whether to run a downloaded file, right-click the zip › Properties › **Unblock** before unpacking. A plain folder such as `C:\HEISS-UI` works better than a Desktop or Documents folder synced by OneDrive, which can lock files during installs and updates.

### Linux opens the launcher in a text editor

Most file managers open a `.sh` file for editing. Use **Start HEISS UI.desktop** instead: right-click it › **Allow Launching** (GNOME) or make it executable, then double-click it. It runs the launcher in a terminal. Or run `./"Start HEISS UI.sh"` in a terminal in that folder.

### No models show up

The studio lists the models ComfyUI lists: files in its `models/checkpoints` and `models/diffusion_models` folders, plus anything `extra_model_paths.yaml` adds. After adding a file, use **Settings › Models › Rescan**. **Find models** looks for model files elsewhere on this computer and links them in.

## When a generation fails

A failed run stays in the gallery as a card that says what went wrong. Open it for the fix, **Use these settings** to try again, or **Copy report** for the full error.

### A model file is damaged or incomplete

The file can't be read. A download may have stopped early, or saved a web page instead of the model. The card names the file and whether it's the model, the VAE, a text encoder or a LoRA. Delete it and download it again. Downloads offered in the studio resume and check themselves.

### The GPU ran out of memory

The model, the image size and the number of images didn't fit in the GPU's memory. Try a smaller size, fewer images per run, or a lighter model (an fp8 or smaller variant). **Settings › General › Clear cache** frees what ComfyUI still holds from earlier runs. On a Mac, closing other large apps helps too.

<a name="comfyui-does-not-have-a-file-this-run-asked-for"></a>

### ComfyUI can't find a file this run uses

ComfyUI answered """Value not in list""". A model, LoRA, text encoder or VAE picked here isn't in ComfyUI's folders, or ComfyUI hasn't picked up a new one yet. Use **Rescan** in Settings › Models, or pick another file.

<a name="parts-that-do-not-fit-together"></a>

### A part doesn't match the model

The text encoder, VAE or a LoRA is made for a different model family, for example a Flux LoRA on SDXL. Check the picks in **Advanced** and turn off LoRAs that don't match the model.

### A file went missing

A file the run needs was moved or deleted after ComfyUI listed it. Use **Rescan** in Settings › Models and try again.

### ComfyUI-GGUF can't load this model yet

ComfyUI-GGUF only loads the model types its maintainers have added. As of September 2026 it doesn't load Krea 2, Ideogram 4, MiniMax H3 or Qwen-Image 2.1 GGUFs. Update ComfyUI-GGUF through ComfyUI-Manager, or download the model's safetensors version.

### A node is missing in ComfyUI

The workflow uses a custom node ComfyUI doesn't have. Install the node pack (the card offers it when the pack is known), restart ComfyUI, and try again. For a built-in model, the card says **Newer ComfyUI** instead when ComfyUI itself is too old. Update ComfyUI.

### ComfyUI dropped this run

The run is no longer in ComfyUI's queue or history, usually because ComfyUI restarted or its queue was cleared somewhere else. Generate again once ComfyUI is running.

### Lost the connection to ComfyUI

ComfyUI stopped answering for about a minute mid-run. It may have crashed (often from running out of memory), been closed, or restarted. Check its window or log, start it again if needed, then try again.

### No image was saved

The run finished without an image to show. An imported workflow may end in a preview node instead of **Save Image**, or ComfyUI skipped a step. Run the workflow once in ComfyUI to see what it does.

### Needs a separate part

A checkpoint that looked all-in-one has no text encoder or VAE built in. From then on it uses a separate one. Rescan models, pick or download the missing part in **Advanced**, and generate again.

### Generation failed

Anything else. **Show details** on the card has ComfyUI's own message and traceback. Check that the model runs in ComfyUI itself and that the custom nodes it needs are installed. If it works there but not here, [open an issue](https://github.com/tristmeister/HEISS-UI/issues) with the copied report.

## Downloads and node packs

### A download says the file is no longer at its address

The link in this version is out of date (HTTP 404). Update HEISS UI in **Settings › About**. Newer versions have newer links. Or download the file from its Hugging Face page, put it in the ComfyUI folder the setup panel names, and use **Rescan** in Settings › Models.

### A download needs a Hugging Face sign-in

Some models need a sign-in and an accepted licence first (HTTP 401 or 403). Accept it on the page that opens. Then either save a Hugging Face token in **Settings › Models** and download again, or download the file in the browser, put it in the named ComfyUI folder, and use **Rescan** in Settings › Models.

### ComfyUI-Manager blocks a node pack install

ComfyUI-Manager only installs what its security level allows. At the default, `normal`, it installs packs from its registry while ComfyUI only listens on this computer. `strong` blocks them, and a ComfyUI started with `--listen` blocks more. Installing from a Git address needs `normal-` or `weak`.

Use the terminal command the panel shows, or change the level:

1. Stop ComfyUI.
2. Open Manager's `config.ini`: `ComfyUI/user/__manager/config.ini` in current versions, `ComfyUI/user/default/ComfyUI-Manager/config.ini` in older ones.
3. Set `security_level = normal` (or `normal-` for a Git address) and save.
4. Start ComfyUI again and retry the install.

### A download stops because the disk is full

Free space is checked before a large download. Free some space on the disk that holds ComfyUI's models, then start the download again. It resumes where it stopped.

## Updates

### A downloaded release went back to the previous version

A release copy installs an update on restart and keeps the old version. If the new one doesn't start, the old one comes back and **Settings › About** says why. Try again later, or download the new zip and unpack it over the old folder. The `data` folder and `.env` stay.

### Going back to an earlier version

The first time a new version starts, it saves a copy of the settings, the gallery list, Hidden's records and sign-ins in `data/.backups/`, in a folder named after the two versions (for example `0.11.0-to-0.12.0-…`). Thumbnails, reference images and Hidden's images aren't copied, because updates don't change them. To go back, stop HEISS UI, put the earlier version in place, copy everything from that folder back into `data/`, and start it. Copies are removed after 14 days, at most three are kept, and erasing Hidden removes them all.

### A Git checkout wasn't updated

**Install update** in a Git clone only runs when the copy has no changed files. Commit or stash them first, or update by hand with `git pull`, `npm install` and `npm run build`. If the new version doesn't install or build, the copy goes back to the commit it had and the error says what failed. """Couldn't reach GitHub""" means the connection is down. """Git isn't installed""" means Git isn't on this computer.

## Phones and other devices

### A phone can't open the studio

1. Turn on **Settings › Connection › Other devices** and restart HEISS UI when asked.
2. Use one of the addresses Settings shows. The phone must be on the same network.
3. Set a studio password on this computer first. Other devices sign in with it.
4. If the page still doesn't load, the computer's firewall may block the port. Allow Node.js (or port 8787) on private networks.
