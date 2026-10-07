# Ways the studio could break in unexpected ways

User stories in the spirit of the `removeChild` crash (something outside the app changes what the app thinks it owns). Written, not yet tried. Each has the story, what could go wrong, and a rough way to check it.

## The page is edited by someone else

1. **Translator.** As a user who reads the browser's translated pages, I open the studio and Chrome translates it. Labels that change (Generate → Generating…, counters, queue badges) crash the studio. Check: force translation on, run a generation, open the gallery, switch tabs.
2. **Grammarly in the prompt box.** As a writer with Grammarly or LanguageTool, I type a prompt and the extension wraps the textarea. The textarea is replaced or moved while React updates it. Check: install the extension, type, send, clear.
3. **Password manager overlay.** As a user with Bitwarden or 1Password, the extension injects an icon next to the Hidden-space password field. The field re-renders as the unlock stage changes. Check: unlock and lock Hidden repeatedly.
4. **Dark-mode extension.** As a user with Dark Reader, my extension rewrites inline styles and adds style tags. Colors, canvases and the gallery thumbnails flicker or mismatch. Check: enable it, scroll the gallery, open the viewer.
5. **Ad blocker cosmetic filters.** As a user with a strict blocker, elements whose class names look like ads (`banner`, `promo`, `sponsor`) are removed. A removed element is later unmounted by React. Check: audit class names for blocker keywords.
6. **Reader mode or "Distill page".** As a user who tries reader mode, the DOM is cloned and mutated. Check: toggle it in Safari and Edge on the studio.

## The browser does something odd

7. **Back-forward cache.** As a user, I leave the studio and press Back. The page restores from the cache with timers, sockets and polling half-dead. Check: navigate away to the board and back during a run.
8. **Background tab throttling.** As a user who switches away during a long run, timers drop to once a second or less and the progress UI jumps or drifts. Check: leave a 4K run in a background tab for ten minutes.
9. **Two tabs, one studio.** As a user, I open the studio twice. Both tabs write settings and the gallery. Last write wins, or one tab reads a half-written file. Check: change a setting in tab A while tab B generates.
10. **Page zoom and tiny windows.** As a user at 200% zoom or a 480px-wide window on desktop, the sidebar and composer overlap or the virtual gallery computes zero columns. Check: zoom to 300%, resize narrow.
11. **Forced colors and high contrast.** As a user on Windows high contrast, backgrounds are dropped and icon-only buttons vanish. Check: turn it on and walk the main flows.
12. **Browser autofill.** As a user, autofill fills a settings field (name, address) with unrelated text, and it is saved as a real setting. Check: fields with ambiguous names.
13. **Private window with storage blocked.** As a privacy-minded user, localStorage throws on read. Check: open in a private window with site data blocked.
14. **Full-page screenshot or print.** As a user pressing Ctrl+P on a huge gallery, the browser lays out thousands of tiles at once. Check: print preview with 5,000 items.

## The machine is different

15. **Low VRAM, long queue.** As a user on a 6 GB card, I queue 20 runs, one runs out of memory, and the queue stalls instead of moving on. Check: force an OOM mid-queue.
16. **Disk full.** As a user whose output drive fills mid-run, the gallery file, thumbnails and crash log writes fail halfway. Check: a small RAM disk as the output folder.
17. **Antivirus locks a file.** As a Windows user, Defender briefly locks a fresh output file. Thumbnail building, export or delete fails with EBUSY. Check: simulate an open handle on a new image.
18. **Sleep and wake.** As a laptop user, I close the lid during a run and open it an hour later. The socket is dead, the clock jumped, and ETAs go negative. Check: suspend for 30 minutes.
19. **ComfyUI dies mid-run.** As a user, ComfyUI crashes or is killed while the studio is open. The studio shows "running" forever or loses the queue. Check: kill the ComfyUI process during a render.
20. **Port already taken.** As a user with something else on the studio's port, the app starts on a different port and old bookmarks or phone links point at the wrong thing. Check: occupy the port first.
21. **Network drive for models.** As a user with models on a NAS, scans take minutes and the model list flickers while they finish. Check: a slow mounted share as a model folder.
22. **Clock and timezone changes.** As a traveler, the system clock jumps back. "10h ago" labels, sort order and run settling use wall-clock time and misbehave. Check: shift the clock an hour back during a run.

## The data is not what the app expects

23. **Gigantic gallery.** As a power user with 100,000 images, the gallery index, search and virtual masonry run out of memory or take seconds per scroll. Check: generate a synthetic gallery of that size.
24. **Odd filenames.** As a user whose files have emoji, RTL text, very long names or trailing dots, export, URLs and thumbnails break. Check: files named `🔥 ‮gnp.png`, 250-character names.
25. **Hand-edited or truncated JSON.** As a user who opens `settings.json` or the gallery file in an editor, or whose machine lost power mid-write, the app fails to start. Check: truncate each store file at random bytes.
26. **Old data from a newer or older build.** As a user who downgrades, newer fields or formats crash the old reader. Check: open a data folder written by the next version.
27. **Pasted prompts from the web.** As a user pasting from a document, the prompt carries zero-width characters, non-breaking spaces or 500,000 characters. Counters, limits and sends misbehave. Check: paste a megabyte of text.
28. **Dropped files that are not images.** As a user dragging a folder, a `.heic`, a 600 MB video or a renamed `.txt` onto the reference area, decoding hangs the page. Check: drop each.
29. **Metadata that lies.** As a user opening a shared image, embedded workflow metadata is malformed or enormous and the "use settings" action throws. Check: craft PNGs with broken or giant text chunks.
30. **A model that is half downloaded.** As a user whose download was interrupted, a partial `.safetensors` is listed as a ready model and generation fails with a cryptic error. Check: truncate a model file and select it.

## The user does things in an odd order

31. **Click storm.** As an impatient user, I press Generate, Cancel, Generate and switch model within a second. State is half-updated and two runs share an id. Check: scripted rapid-fire clicks.
32. **Delete while viewing.** As a user with the viewer open, another tab, a sync or a cleanup removes the item I'm looking at. The viewer points at a missing item. Check: delete the active item from another tab.
33. **Stack and unstack during a run.** As a user, I stack runs while one is still arriving, and the run settles while I drag. Check: stack, unstack and delete while a 20-image run lands.
34. **Hide a run that is rendering.** As a user, I move images into Hidden while their thumbnails are being built. The thumbnail lands in the wrong store. Check: hide during a run.
35. **Switch mode mid-upload.** As a user, I flip between image and video while a reference upload finishes. The reference gets attached to the wrong mode. Check: slow upload, switch modes.
36. **Restart during update.** As a user, I quit while an update downloads or installs, and the next start has two half-installed versions. Check: kill the process at several points of an update.
37. **Settings changed under a running job.** As a user, I change steps, size or model while a job is already queued. The queued job reads the new values, or the display shows the new ones. Check: change everything right after sending.
38. **Keyboard-only and screen reader flow.** As a keyboard user, focus is lost when the focused element unmounts (a toast, a closed drawer, a deleted tile), and focus returns to the page top. Check: tab through the main flows and delete the focused item.
39. **Touch and pen on desktop.** As a user on a touch laptop, mouse-only hover menus and drag handlers never open or fire twice. Check: touch emulation in the browser.
40. **Phone studio on a flaky network.** As a user on the phone UI over Wi-Fi at the edge of range, requests half-finish and the UI shows a finished run that has no image. Check: throttle and drop the connection during a run.

## Hardest to notice

41. **Memory creep over days.** As a user who leaves the studio open for a week, the gallery's blobs, video previews and listeners add up until the tab is killed. Check: leave it running with a script that generates and scrolls.
42. **Crash reports that hide the cause.** As a maintainer, the minified stack names no component. Reports like the `removeChild` one cannot be traced. Check: ship source maps for the crash path, or name the nearest `data-*` anchor in the report.

## Test results (7 Oct 2026)

Run against the built app (`dist`) with a stock data folder, ComfyUI offline, plus the server test suite (495 pass).

| # | Story | Result |
|---|-------|--------|
| 1 | Translator | Pass. Simulated translation (every text node wrapped in `<font><font>`, re-applied after each click) across the sidebar, settings, search, stacks and tabs: no crash, with and without `translate="no"`. |
| 10 | Zoom / narrow | Pass at 467 px (phone UI) and 820 px (sidebar open). No horizontal overflow. |
| 12 | Autofill | Pass. Only the seed field is a text input, with no name. |
| 13 | Storage blocked | Pass by code audit. Every storage access is guarded except the "Reset all settings" button, which is user-triggered. |
| 15, 19 | OOM, ComfyUI dies | Covered by `run-job`, `comfy-queue` and `comfy-restart` tests (failed runs are kept with a reason, the tracker recovers, dropped prompts fail cleanly). Not re-run against a real ComfyUI. |
| 20 | Port taken | Pass. A second start prints "HEISS UI is already running" and exits. |
| 25 | Corrupt JSON | Pass by `json-store.test.js` (backup fallback, corrupt copy set aside). |
| 27 | Huge paste | Pass. A 1.5 M character prompt with zero-width and non-breaking spaces is accepted in 0.7 s with no crash. No upper limit applies when no model is selected. |
| 28, 29 | Bad uploads | Partial. A non-image upload is refused with 400. A malformed JSON body returns Express's HTML error page with a stack trace and local file paths (see below). |
| 30 | Half-downloaded model | Pass for our own downloads (`model-downloads-integrity.test.js`: hash checked, bad files discarded, resume only when still the same file). A truncated file dropped in by hand was not tested. |
| 31 | Click storm | Partial. 90 rapid clicks on count, steps and the offline button: no crash. A real generation was not possible without ComfyUI. |
| 32 | Delete while viewing | Pass with a note. Deleting the open item from outside leaves the viewer showing it until the next refresh; navigation and the page keep working. |
| 38 | Focus on close | Pass. Closing the viewer returns focus to the tile that opened it. |

Not tested: 2–9, 11, 14, 16–18, 21–24, 26, 33–37, 39–42 (need a real browser extension, another OS, a real ComfyUI, or long runs).

Found along the way:
- A malformed JSON body to any `/api` route returns an HTML error page with the server's stack trace and absolute paths. Local-only, and no client sends it, but a JSON error handler would be tidier.
- With "Video" selected and no videos, the stage shows the ComfyUI-offline screen instead of an empty-videos state.
