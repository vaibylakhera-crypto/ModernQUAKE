# Procedural, seamlessly tiling textures for the "alien fortress" arena look (all original, generated from noise).
# Output: public/tex-alien/*.webp (512x512).  Re-run:  python3 scripts/make-alien-textures.py
import os
import numpy as np
from PIL import Image

N = 512
OUT = 'public/tex-alien'
rng = np.random.default_rng(7)


def value_noise(cells, seed):
    """tileable value noise: random lattice of `cells`x`cells`, smooth-interpolated with wrap-around"""
    r = np.random.default_rng(seed).random((cells, cells))
    t = np.arange(N) * cells / N
    i0 = np.floor(t).astype(int); f = t - i0; f = f * f * (3 - 2 * f); i1 = (i0 + 1) % cells
    a = r[i0][:, i0]; b = r[i0][:, i1]; c = r[i1][:, i0]; d = r[i1][:, i1]
    fx = f[None, :]; fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(base, octaves, seed, gain=0.5):
    s = np.zeros((N, N)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        s += amp * value_noise(base * 2 ** o, seed + o * 31); tot += amp; amp *= gain
    return s / tot


def ridged(base, octaves, seed):
    s = np.zeros((N, N)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        n = 1 - np.abs(value_noise(base * 2 ** o, seed + o * 17) * 2 - 1); s += amp * n * n; tot += amp; amp *= 0.5
    return s / tot


def shade(height, strength=2.0):
    """cheap directional lighting from a height field (light from top-left), wraps so it stays tileable"""
    dx = np.roll(height, -1, 1) - np.roll(height, 1, 1); dy = np.roll(height, -1, 0) - np.roll(height, 1, 0)
    return np.clip(1 + (-dx - dy) * strength * N / 64, 0.55, 1.45)


def colorize(lum, lo, hi):
    lo = np.array(lo, float); hi = np.array(hi, float)
    return lo[None, None, :] * (1 - lum[..., None]) + hi[None, None, :] * lum[..., None]


def save(name, rgb):
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB').save(f'{OUT}/{name}.webp', 'WEBP', quality=86, method=6)


def glyph_lines(mask, count, seed, length=(10, 28)):
    """carves short angular alien glyph strokes into a mask (1 = carved)"""
    r = np.random.default_rng(seed)
    for _ in range(count):
        x, y = r.integers(0, N, 2); steps = r.integers(2, 5)
        for _ in range(steps):
            ang = r.choice([0, 45, 90, 135, 180, 225, 270, 315]) * np.pi / 180; L = r.integers(*length)
            for k in range(L):
                xx = int(x + np.cos(ang) * k) % N; yy = int(y + np.sin(ang) * k) % N
                mask[yy, xx] = 1; mask[yy, (xx + 1) % N] = 1
            x = int(x + np.cos(ang) * L); y = int(y + np.sin(ang) * L)
    return mask


yy, xx = np.mgrid[0:N, 0:N]

# ---------- floor: heavy worn slabs, dark seams, grime, rivets, faint carved glyphs ----------
def floor():
    S = 128; gx = xx % S; gy = yy % S; cell = (yy // S) * 7 + (xx // S) * 3
    seam = np.minimum(np.minimum(gx, S - 1 - gx), np.minimum(gy, S - 1 - gy))
    bevel = np.clip(seam / 6.0, 0, 1)
    tone = (np.sin(cell * 12.9898) * 43758.5453) % 1 * 0.18
    grime = fbm(4, 6, 11); fine = fbm(32, 3, 12)
    h = bevel * 0.6 + grime * 0.25 + fine * 0.15
    lum = 0.30 + tone + grime * 0.35 + fine * 0.18
    lum *= 0.35 + 0.65 * bevel
    # rivets near slab corners
    for cx in (10, S - 11):
        for cy in (10, S - 11):
            d = np.hypot(gx - cx, gy - cy); rv = np.clip(1 - d / 4.0, 0, 1)
            lum += rv * 0.25; h += rv * 0.3
    # carved glyphs (recessed, darker)
    g = glyph_lines(np.zeros((N, N)), 18, 5); lum -= g * 0.3 * bevel; h -= g * 0.35
    # scratches
    sc = np.abs(np.sin((xx * 0.9 + yy * 0.25) * 0.35 + fbm(8, 2, 13) * 12)) > 0.995
    lum += sc * 0.08
    rgb = colorize(np.clip(lum, 0, 1), (9, 10, 11), (104, 108, 102)) * shade(h, 1.6)[..., None]
    stain = np.clip(fbm(3, 4, 14) - 0.45, 0, 1); rgb[..., 0] += stain * 30; rgb[..., 1] += stain * 12     # patchy rust staining
    save('floor', rgb)

# ---------- wall: rough stone blocks in running bond with alien vein ridges ----------
def wall():
    RH = 64; row = yy // RH; off = (row % 2) * 48; W = 96
    bx = (xx + off) % W; by = yy % RH; bid = row * 13 + (xx + off) // W
    mortar = np.minimum(np.minimum(bx, W - 1 - bx), np.minimum(by, RH - 1 - by))
    block = np.clip(mortar / 4.0, 0, 1)
    rough = fbm(8, 6, 21); crack = ridged(6, 4, 22)
    tone = (np.sin(bid * 78.233) * 43758.5453) % 1 * 0.14
    lum = (0.26 + tone + rough * 0.32) * (0.25 + 0.75 * block) - np.clip(crack - 0.78, 0, 1) * 1.6
    h = block * 0.5 + rough * 0.4 - np.clip(crack - 0.78, 0, 1)
    vein = np.clip(ridged(3, 3, 23) - 0.80, 0, 1) * 5                               # organic ridges growing over stone
    streak = fbm(2, 3, 24)[:, :] * (value_noise(64, 25)[0][None, :] * 0.6)           # vertical drip grime
    lum -= streak * 0.12
    rgb = colorize(np.clip(lum, 0, 1), (10, 10, 13), (128, 122, 118)) * shade(h + vein * 0.3, 1.4)[..., None]
    rgb[..., 0] += vein * 18; rgb[..., 1] += vein * 34; rgb[..., 2] += vein * 22       # dim sickly-green alien veins
    save('wall', rgb)

# ---------- trim: corroded iron band with ribs and rivets ----------
def trim():
    rib = (np.sin(yy / N * np.pi * 2 * 8) * 0.5 + 0.5) ** 3
    rust = np.clip(fbm(6, 5, 31) - 0.45, 0, 1) * 2.2
    lum = 0.32 + rib * 0.3 + fbm(24, 3, 32) * 0.2
    rv = np.zeros((N, N))
    for cx in range(16, N, 64):
        for cy in (32, N - 32):
            rv += np.clip(1 - np.hypot(xx - cx, ((yy - cy + N // 2) % N) - N // 2) / 6.0, 0, 1)
    lum += rv * 0.3
    rgb = colorize(np.clip(lum, 0, 1), (16, 16, 18), (150, 150, 155)) * shade(rib * 0.3 + rv * 0.4, 1.5)[..., None]
    rgb = rgb * (1 - rust[..., None] * 0.6) + np.array([96, 46, 22])[None, None, :] * rust[..., None] * 0.6
    save('trim', rgb)

# ---------- rock: craggy floating-island underside ----------
def rock():
    r = ridged(4, 6, 41); f = fbm(8, 5, 42)
    h = r * 0.7 + f * 0.3
    lum = 0.12 + h * 0.42
    rgb = colorize(np.clip(lum, 0, 1), (8, 7, 10), (120, 104, 96)) * shade(h, 2.2)[..., None]
    glow = np.clip(ridged(5, 2, 43) - 0.9, 0, 1) * 10                                # faint ember fissures
    rgb[..., 0] += glow * 60; rgb[..., 1] += glow * 18
    save('rock', rgb)

# ---------- pillar: ribbed bone-like stone ----------
def pillar():
    ribs = (np.cos(xx / N * np.pi * 2 * 6) * 0.5 + 0.5) ** 1.5
    bands = np.clip(1 - np.abs(((yy % 128) - 64) / 6.0), 0, 1) ** 2
    rough = fbm(8, 5, 51)
    h = ribs * 0.6 + rough * 0.3 - bands * 0.3
    lum = 0.22 + ribs * 0.28 + rough * 0.22 - bands * 0.12
    rgb = colorize(np.clip(lum, 0, 1), (12, 11, 12), (160, 148, 130)) * shade(h, 1.6)[..., None]
    save('pillar', rgb)

for f in (floor, wall, trim, rock, pillar):
    f(); print('made', f.__name__)
