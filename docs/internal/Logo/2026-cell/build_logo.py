"""HEISS logo, 2026 "cell" identity.

Everything is built from one unit: a square cell on a 10-unit pitch with a small gap,
the same tile the app's generation preview and the landing page use. Steam is the only
thing that breaks the grid: its cells shrink, cool and fade as they rise.

Run:  python3 build_logo.py      (writes SVGs + logo-data.js next to this file)
"""

import json
from pathlib import Path

OUT = Path(__file__).parent

P = 10            # cell pitch
CELL = 8.4        # drawn cell (gap = 1.6)
RX = 1.4          # cell corner radius

INK = "#F4F4F4"
COAL = "#0A0A0A"
EMBER = "#FF9A52"
# Heat ramp for steam, hottest at the bottom.
STEAM = ["#FF6526", "#FF7B38", "#FF914A", "#FFA766", "#FFBC86", "#FFD2AB"]

# PP Neue Bit, sampled one cell per font pixel (28-unit em, 2-cell strokes).
HEISS = [
    "##.......##..##########..##....#######......#######..",
    "##.......##..##########..##...#########....#########.",
    "##.......##..##..........##..###.....###..###.....###",
    "##.......##..##..........##..##.......##..##.......##",
    "##.......##..##..........##..##...........##.........",
    "###########..#########...##..###..........###........",
    "###########..#########...##...#######......#######...",
    "##.......##..##..........##.....#######......#######.",
    "##.......##..##..........##..........###..........###",
    "##.......##..##..........##...........##...........##",
    "##.......##..##..........##..##.......##..##.......##",
    "##.......##..##..........##..###.....###..###.....###",
    "##.......##..##########..##...#########....#########.",
    "##.......##..##########..##....#######......#######..",
]
UI = [
    "##......##..##",
    "##......##..##",
    "##......##..##",
    "##......##..##",
    "##......##..##",
    "##......##..##",
    "##......##..##",
    "##......##..##",
    "##......##..##",
    "##......##..##",
    "##......##..##",
    "###....###..##",
    ".########...##",
    "..######....##",
]

# The cup, redrawn on the grid: solid body, 2-cell handle, tapered foot.
CUP = [
    "##########....",
    "############..",
    "##########..##",
    "##########..##",
    "##########..##",
    "############..",
    "##########....",
    ".########.....",
    "..######......",
]

# Steam as (col, row-above-top, level). Level 0 sits lowest and hottest.
# Large master for the lockup: drawn, not scaled, so its cells match the letters.
# Rim sits two rows under the cap height, foot on the baseline.
CUP_L = [
    "#############.....",
    "################..",
    "#################.",
    "#############...##",
    "#############...##",
    "#############...##",
    "#################.",
    "################..",
    "#############.....",
    ".###########......",
    "..#########.......",
    "...#######........",
]
WISPS_L = [
    [((3, 4), 2), ((2, 3), 3), ((2,), 4), ((3,), 5), ((4,), 6), ((4,), 7)],
    [((8, 9), 2), ((7, 8), 3), ((7,), 4), ((8,), 5), ((9,), 6), ((9,), 7)],
]
CUP_L_STEAM = [(col, up, level) for wisp in WISPS_L for level, (cols, up) in enumerate(wisp) for col in cols]

# Steam: two wisps, each a list of (columns, rows above the rim), bottom to top.
# They leave the cup with the same 2-cell stroke as the letters and thin out as they rise.
WISPS = [
    [((2, 3), 2), ((1, 2), 3), ((1,), 4), ((2,), 5), ((3,), 6), ((3,), 7)],
    [((6, 7), 2), ((5, 6), 3), ((5,), 4), ((6,), 5), ((7,), 6), ((7,), 7)],
]
CUP_STEAM = [(col, up, level) for wisp in WISPS for level, (cols, up) in enumerate(wisp) for col in cols]
# A single wisp lifting off the I (cols 25-26) of the wordmark.
I_STEAM = [(25, 2, 0), (26, 2, 0), (26, 3, 2), (25, 4, 4)]

STEAM_SCALE = [1.0, 0.86, 0.74, 0.62, 0.5, 0.38]
STEAM_ALPHA = [1.0, 0.92, 0.8, 0.66, 0.52, 0.38]


def cells(bitmap):
    return [(x, y) for y, row in enumerate(bitmap) for x, ch in enumerate(row) if ch == "#"]


def rect(x, y, scale=1.0, solid=False, fill=None, opacity=None, cls=None):
    """One cell at grid position (x, y). Solid cells fill the pitch so they merge at small sizes."""
    size = (P if solid else CELL) * scale
    off = (P - size) / 2
    r = 0 if solid and scale == 1.0 else RX * scale
    attrs = [f'x="{x * P + off:.2f}"', f'y="{y * P + off:.2f}"', f'width="{size:.2f}"', f'height="{size:.2f}"']
    if r:
        attrs.append(f'rx="{r:.2f}"')
    if fill:
        attrs.append(f'fill="{fill}"')
    if opacity is not None and opacity < 1:
        attrs.append(f'fill-opacity="{opacity:.2f}"')
    if cls:
        attrs.append(f'class="{cls}"')
    return "<rect " + " ".join(attrs) + "/>"


def steam_rects(items, top_row, solid=False, dx=0, mono=None):
    """Steam cells. `mono` paints them in one colour (single-colour logos), keeping the fade."""
    out = []
    for col, up, level in items:
        out.append(rect(col + dx, top_row - up, STEAM_SCALE[level], solid, mono or STEAM[level], STEAM_ALPHA[level]))
    return out


def svg(w_cells, h_cells, body, pad=0, bg=None, title="HEISS"):
    w, h = (w_cells + pad * 2) * P, (h_cells + pad * 2) * P
    bg_rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">'
        f"<title>{title}</title>{bg_rect}"
        f'<g transform="translate({pad * P} {pad * P})">{body}</g></svg>\n'
    )


def mark(ink, solid=False, dx=0, mono=False):
    """Cup + steam on a 14 x 16 grid: steam rows 0-5, one clear row, cup rows 7-15."""
    top = 9
    body = [rect(x + dx, y + top, 1.0, solid) for x, y in cells(CUP)]
    return f'<g fill="{ink}">{"".join(body)}</g>' + "".join(steam_rects(CUP_STEAM, top, solid, dx, mono=ink if mono else None))


def mark_large(ink, rim_row, mono=False):
    body = [rect(x, y + rim_row, 1.0) for x, y in cells(CUP_L)]
    return f'<g fill="{ink}">{"".join(body)}</g>' + "".join(steam_rects(CUP_L_STEAM, rim_row, mono=ink if mono else None))


def wordmark(ink, solid=False, dy=0, steam=True, ui=None):
    top = dy
    body = [rect(x, y + top, 1.0, solid) for x, y in cells(HEISS)]
    parts = [f'<g fill="{ink}">{"".join(body)}</g>']
    if steam:
        parts += steam_rects(I_STEAM, top, solid)
    if ui:
        ox = len(HEISS[0]) + 5
        ui_body = [rect(x + ox, y + top, 1.0, solid) for x, y in cells(UI)]
        parts.append(f'<g fill="{ui}">{"".join(ui_body)}</g>')
    return "".join(parts)


def write(name, content):
    (OUT / name).write_text(content)


W_WORD = len(HEISS[0])            # 53
W_UI = len(UI[0])                 # 14
W_MARK = len(CUP[0])              # 14

for tone, ink, suffix in [("light", INK, "white"), ("dark", COAL, "black")]:
    # Mark: 14 x 16 cells, centred on the cup body inside an 18 x 18 square.
    write(f"heiss-mark-{suffix}.svg", svg(18, 18, mark(ink, dx=3), title="HEISS mark"))
    write(f"heiss-mark-solid-{suffix}.svg", svg(18, 18, mark(ink, solid=True, dx=3), title="HEISS mark"))
    # Wordmark with the I wisp: steam needs 4 rows above the cap height.
    write(f"heiss-wordmark-{suffix}.svg", svg(W_WORD, 18, wordmark(ink, dy=4), title="HEISS"))
    write(
        f"heiss-wordmark-ui-{suffix}.svg",
        svg(W_WORD + 5 + W_UI, 18, wordmark(ink, dy=4, ui=ink if tone == "dark" else "#8A8A8A"), title="HEISS UI"),
    )
    # Lockup: mark + plain wordmark, cup foot on the baseline.
    # Large cup: rim 2 rows under cap height, foot on the baseline, steam rising above.
    W_L = len(CUP_L[0])
    lock = mark_large(ink, rim_row=7) + f'<g transform="translate({(W_L + 5) * P} {5 * P})">{wordmark(ink, steam=False)}</g>'
    write(f"heiss-lockup-{suffix}.svg", svg(W_L + 5 + W_WORD, 19, lock, title="HEISS"))
    # One-colour versions for print, embroidery and coloured grounds.
    lock_mono = mark_large(ink, rim_row=7, mono=True) + f'<g transform="translate({(W_L + 5) * P} {5 * P})">{wordmark(ink, steam=False)}</g>'
    write(f"heiss-lockup-mono-{suffix}.svg", svg(W_L + 5 + W_WORD, 19, lock_mono, title="HEISS"))
    write(f"heiss-mark-mono-{suffix}.svg", svg(18, 18, mark(ink, dx=3, mono=True), title="HEISS mark"))

# App icon: 1024 squircle-ish tile, faint cell grid, warm glow behind the steam.
icon_body = f"""
<defs>
  <radialGradient id="glow" cx="0.47" cy="0.38" r="0.46">
    <stop offset="0" stop-color="#FF7A35" stop-opacity=".28"/>
    <stop offset="1" stop-color="#FF7A35" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#171717"/>
    <stop offset="1" stop-color="#0B0B0B"/>
  </linearGradient>
  <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse">
    <rect x="14" y="14" width="4" height="4" rx=".8" fill="#fff" fill-opacity=".045"/>
  </pattern>
  <clipPath id="clip"><rect width="1024" height="1024" rx="228"/></clipPath>
</defs>
<g clip-path="url(#clip)">
  <rect width="1024" height="1024" fill="url(#tile)"/>
  <rect width="1024" height="1024" fill="url(#dots)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>
  <rect x="1" y="1" width="1022" height="1022" rx="227" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>
</g>
<g transform="translate({512 - 9 * P * 3.2} {512 - 9 * P * 3.2 + 8}) scale(3.2)">{mark(INK, dx=3)}</g>
"""
write("heiss-app-icon.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="HEISS app icon"><title>HEISS</title>{icon_body}</svg>\n')

# Favicon: solid cells so it survives 16-32 px, adapts to the browser theme.
fav_body = mark("var(--ink)", solid=True, dx=3)
write(
    "heiss-favicon.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">'
    "<style>:root{--ink:#0A0A0A}@media (prefers-color-scheme:dark){:root{--ink:#F4F4F4}}</style>"
    f"{fav_body}</svg>\n",
)

# Animated mark: steam climbs one cell at a time, cooling and shrinking as it goes.
DUR = 2.4
N = len(STEAM_SCALE)
anim_css = []
anim_rects = []
for w, path in enumerate(WISPS):
    # Each wisp is two lanes of cells stepping through its slots; the second lane only shows
    # where the wisp is two cells wide. One cell per slot, staggered one slot apart.
    for lane in range(2):
        kf = []
        for level, (cols, up) in enumerate(path):
            sc = STEAM_SCALE[level]
            size = CELL * sc
            col = cols[lane] if lane < len(cols) else cols[0]
            alpha = STEAM_ALPHA[level] if lane < len(cols) else 0
            tx, ty = (col + 3) * P + (P - size) / 2, (9 - up) * P + (P - size) / 2
            kf.append(
                f"{level * 100 / N:.3f}%{{transform:translate({tx:.2f}px,{ty:.2f}px) scale({sc});fill:{STEAM[level]};fill-opacity:{alpha}}}"
            )
        kf.append(f"100%{{transform:translate({tx:.2f}px,{ty:.2f}px) scale({sc});fill:{STEAM[-1]};fill-opacity:0}}")
        name = f"w{w}l{lane}"
        anim_css.append(f"@keyframes {name}{{{''.join(kf)}}}")
        for k in range(N):
            delay = -k * DUR / N - w * DUR / (2 * N)
            anim_rects.append(
                f'<rect class="s" width="{CELL}" height="{CELL}" rx="{RX}" style="animation-name:{name};animation-delay:{delay:.3f}s"/>'
            )
anim_css.append(
    f".s{{transform-origin:0 0;animation-duration:{DUR}s;animation-iteration-count:infinite;animation-timing-function:steps(1,end)}}"
    "@media (prefers-reduced-motion:reduce){.s{animation-play-state:paused}}"
)
cup_only = "".join(rect(x + 3, y + 9, 1.0) for x, y in cells(CUP))
write(
    "heiss-mark-animated.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="HEISS mark">'
    f"<title>HEISS</title><style>{''.join(anim_css)}</style>"
    f'<g fill="{INK}">{cup_only}</g>{"".join(anim_rects)}</svg>\n',
)

# Raw geometry for the brand sheet's interactive pieces.
data = {
    "pitch": P,
    "cell": CELL,
    "rx": RX,
    "heiss": HEISS,
    "ui": UI,
    "cup": CUP,
    "cupSteam": CUP_STEAM,
    "wisps": WISPS,
    "iSteam": I_STEAM,
    "steamScale": STEAM_SCALE,
    "steamAlpha": STEAM_ALPHA,
    "steamColors": STEAM,
    "colors": {"ink": INK, "coal": COAL, "ember": EMBER},
}
write("logo-data.js", "window.HEISS_LOGO = " + json.dumps(data, indent=2) + ";\n")
print("wrote", sorted(p.name for p in OUT.iterdir() if p.suffix in {".svg", ".js"}))
