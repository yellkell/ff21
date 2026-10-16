"""
Pack the fireball fire frames (tools/blender/fireball_fire.py) into the
flipbook atlas src/fx/fire.ts draws.

    py -3.11 tools/blender/fireball_pack.py

Reads bake_work/fireball/frames/{front,full}/NNN.png (16-bit grey, LOOP +
BLEND frames) and writes public/arena/fire/flames.webp:

    8 x 8 cells of 256 px, frame 0 top-left, row-major
    R = 'front' (the fire in front of the iron + everything off its disc)
    G = 'full'  (the whole fire — trail puffs and bursts)
    B = 0

Each channel is normalised to its own 99.8th percentile and stored as
sqrt(v) (8 bits go much further on the dim licks that way); the shader
squares it back. The tail's last BLEND frames crossfade into the head, so
frame 63 runs straight on into frame 0.
"""

import os

import numpy as np
from PIL import Image

WORK = "C:/Users/alexv/Desktop/blendercyber/bake_work/fireball/frames"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "public", "arena", "fire", "flames.webp")
LOOP, BLEND, GRID, CELL = 64, 16, 8, 256


def load(pass_name):
    frames = []
    for i in range(LOOP + BLEND):
        im = Image.open(os.path.join(WORK, pass_name, f"{i:03d}.png"))
        a = np.asarray(im).astype(np.float32)
        a /= 65535.0 if a.max() > 255 else 255.0
        if a.ndim == 3:
            a = a[..., 0]
        frames.append(a)
    return np.stack(frames)


def loop(fr):
    out = fr[:LOOP].copy()
    for i in range(BLEND):
        w = (i + 0.5) / BLEND  # weight of the head frame
        out[i] = fr[i] * w + fr[LOOP + i] * (1 - w)
    return out


def pack(fr):
    hi = np.percentile(fr[fr > 0.002], 99.8) if (fr > 0.002).any() else 1.0
    fr = np.clip(fr / hi, 0, 1)
    atlas = np.zeros((GRID * CELL, GRID * CELL), np.float32)
    for i, f in enumerate(fr):
        cell = np.asarray(Image.fromarray(f).resize((CELL, CELL), Image.LANCZOS))
        r, c = divmod(i, GRID)
        atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = np.clip(cell, 0, 1)
    print("normalised by", round(float(hi), 4))
    return np.sqrt(atlas)


front = pack(loop(load("front")))
full = pack(loop(load("full")))
rgb = np.stack([front, full, np.zeros_like(front)], -1)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(OUT, "WEBP", quality=90, method=6)
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
