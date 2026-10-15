"""
FIRE FIGHT — the plaza's big billboard (public/arena/neon/billboard_fire_fight.jpg).

The wide screen hung 32-38 m up over the plaza (SCREEN_b in neon_plaza.glb)
used to read NEURO//LINK. Now it carries the game's own name in Japanese:
ファイア・ファイト in white-hot magenta neon over the screen's violet ad
loop, a hairline cyan rail with FIRE FIGHT beneath it, and a red hanko seal
stamped 炎 (fire) in the corner. arena/neon/index.ts swaps it onto the screen
at load, so the baked atlas text behind it never shows.

The canvas is the screen's own aspect (17.6 x 6.6 m -> 1536 x 576), so
nothing stretches.

    python tools/neon-billboard.py       # writes public/arena/neon/billboard_fire_fight.jpg
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as nd

W, H = 1536, 576
OUT = Path(__file__).resolve().parent.parent / 'public' / 'arena' / 'neon' / 'billboard_fire_fight.jpg'

# A heavy Japanese gothic: Yu Gothic Bold on Windows, IPA Gothic elsewhere
# (thickened below, since IPA ships one weight).
JP_FONTS = [
    Path('C:/Windows/Fonts/YuGothB.ttc'),
    Path('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'),
    Path('/usr/share/fonts/truetype/fonts-japanese-gothic.ttf'),
]
LATIN_FONTS = [
    Path('C:/Windows/Fonts/bahnschrift.ttf'),
    Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
]

CYAN = np.array([0.25, 0.95, 1.0])
MAGENTA = np.array([1.0, 0.24, 0.65])
WHITE = np.array([1.0, 1.0, 1.0])
SEAL_RED = np.array([0.95, 0.12, 0.16])


def first(paths):
    for p in paths:
        if p.exists():
            return str(p)
    sys.exit(f'no font found among {[str(p) for p in paths]}')


def mask_text(text, f, cx, cy, tracking=0):
    """Centred text mask (float 0..1) with optional letter tracking."""
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    widths = [d.textlength(ch, font=f) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    asc, desc = f.getmetrics()
    for ch, w in zip(text, widths):
        d.text((x, cy - (asc + desc) / 2), ch, font=f, fill=255)
        x += w + tracking
    return np.asarray(im, np.float32) / 255


def glow(t, colour, core=0.85, spread=(4, 14, 42), gains=(0.9, 0.55, 0.35)):
    """Emission for one lit shape: white-hot core, coloured skin, three-stage bloom."""
    e = np.zeros((H, W, 3), np.float32)
    hot = nd.gaussian_filter(t, 1.2) ** 2
    e += hot[..., None] * (WHITE * core + colour * (1 - core))
    e += t[..., None] * colour * 0.9
    for s, g in zip(spread, gains):
        e += nd.gaussian_filter(t, s)[..., None] * colour * g * 2.2
    return e


def background():
    """The screen's violet ad loop: slow smoky noise with one warm streak."""
    rng = np.random.default_rng(21)

    def smoke(scale):
        n = rng.standard_normal((H // scale + 3, W // scale + 3)).astype(np.float32)
        n = nd.zoom(nd.gaussian_filter(n, 1.0), scale, order=3)[:H, :W]
        return (n - n.min()) / (n.max() - n.min())

    a, b = smoke(48), smoke(96)
    base = np.array([0.20, 0.10, 0.42]) * (0.45 + 0.8 * a[..., None])
    base += np.array([0.42, 0.18, 0.62]) * (b[..., None] ** 2) * 0.7
    # A warm band wandering across the middle, like the old loop's.
    ys = np.arange(H)[:, None]
    path = H * 0.5 + 70 * np.sin(np.arange(W)[None, :] / W * 5.2 + 0.6) + 40 * (a - 0.5) * 2
    band = np.exp(-((ys - path) / 60.0) ** 2)
    base += band[..., None] * np.array([0.55, 0.32, 0.30]) * 0.55
    # Darker under the lettering so it reads at 40 m.
    vign = 1 - 0.55 * np.exp(-((ys - H * 0.42) / (H * 0.32)) ** 2)
    return base * vign[..., None]


def scanlines(img):
    rows = 0.9 + 0.1 * (np.arange(H) % 3 != 0)
    return img * rows[:, None, None]


def main():
    emit = np.zeros((H, W, 3), np.float32)

    # ファイア・ファイト, filled neon, thickened so a single-weight gothic reads bold.
    jp = ImageFont.truetype(first(JP_FONTS), 158)
    kat = mask_text('ファイア・ファイト', jp, W * 0.5, H * 0.40, tracking=2)
    kat = nd.grey_dilation(kat, size=(5, 5))
    kat = nd.gaussian_filter((kat > 0.5).astype(np.float32), 0.7)
    emit += glow(kat, MAGENTA, core=0.8, spread=(5, 16, 48), gains=(0.75, 0.45, 0.28))

    # Rails with FIRE FIGHT between them.
    lat = ImageFont.truetype(first(LATIN_FONTS), 52)
    try:
        lat.set_variation_by_name('Bold Condensed')
    except (OSError, AttributeError):
        pass
    en = mask_text('FIRE  FIGHT', lat, W * 0.5, H * 0.755, tracking=14)
    emit += glow(nd.gaussian_filter((en > 0.5).astype(np.float32), 0.6), CYAN, core=0.6, spread=(3, 9, 26), gains=(0.6, 0.32, 0.16))
    rail = np.zeros((H, W), np.float32)
    ry = int(H * 0.755)
    cols = np.nonzero(en.max(axis=0) > 0.5)[0]
    gap = 40  # clear air between the rails and the lettering
    for x0, x1 in ((230, cols[0] - gap), (cols[-1] + gap, 1306)):
        rail[ry - 1 : ry + 2, x0:x1] = 1
    emit += glow(nd.gaussian_filter(rail, 0.8), CYAN, core=0.5, spread=(3, 9, 24), gains=(0.6, 0.3, 0.15))

    # The hanko: a red seal square stamped 炎, set in the lower right.
    seal = np.zeros((H, W), np.float32)
    sx, sy, ss = 1352, 388, 118
    seal[sy : sy + ss, sx : sx + ss] = 1
    seal[sy + 9 : sy + ss - 9, sx + 9 : sx + ss - 9] = 0
    fire = mask_text('炎', ImageFont.truetype(first(JP_FONTS), 92), sx + ss / 2, sy + ss / 2 + 4)
    fire = nd.grey_dilation(fire, size=(3, 3))
    seal = np.clip(seal + (fire > 0.5), 0, 1)
    seal = nd.gaussian_filter(seal, 0.6)
    emit += glow(seal, SEAL_RED, core=0.35, spread=(3, 10, 28), gains=(0.5, 0.25, 0.12))

    # Soft-clip the light, then lay it over the ad loop.
    light = 1 - np.exp(-emit * 1.25)
    img = scanlines(background())
    img = 1 - (1 - np.clip(img, 0, 1)) * (1 - light)
    out = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out).save(sys.argv[1] if len(sys.argv) > 1 else OUT, quality=90, optimize=True)


if __name__ == '__main__':
    main()
