# Original procedural deck-plate floor for the alien-fortress arena: colour, normal and specular maps from one height field.
# One 1024px tile = 4 m x 4 m of floor.  Output: public/tex-alien/floor.webp, floor_n.webp, floor_s.webp
#   python3 scripts/make-floor.py
import os
import numpy as np
from PIL import Image

N = 1024
U = N // 8                       # layout unit = 0.5 m
OUT = 'public/tex-alien'
yy, xx = np.mgrid[0:N, 0:N].astype(float)


def value_noise(cells, seed):
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


def blur(a, r):
    """wrap-around box blur (x then y), applied twice ~ gaussian"""
    for _ in range(2):
        k = 2 * r + 1
        c = np.cumsum(np.pad(a, ((0, 0), (r + 1, r)), mode='wrap'), axis=1); a = (c[:, k:] - c[:, :-k]) / k
        c = np.cumsum(np.pad(a, ((r + 1, r), (0, 0)), mode='wrap'), axis=0); a = (c[k:, :] - c[:-k, :]) / k
    return a


# plate layout in 0.5 m units: (x, y, w, h, kind)   kind: p = plate, g = grate, e = emblem plate
LAYOUT = [
    (0, 0, 4, 4, 'e'), (4, 0, 4, 2, 'p'), (4, 2, 2, 2, 'g'), (6, 2, 2, 2, 'p'),
    (0, 4, 2, 4, 'p'), (2, 4, 6, 2, 'p'), (2, 6, 3, 2, 'p'), (5, 6, 3, 2, 'g'),
]

height = np.zeros((N, N)); albedo_k = np.zeros((N, N)); wear_mask = np.zeros((N, N)); grate_hole = np.zeros((N, N))
plate_tone = np.zeros((N, N)); seam_mask = np.zeros((N, N))
rng = np.random.default_rng(3)
for i, (x, y, w, h, kind) in enumerate(LAYOUT):
    x0, y0, x1, y1 = x * U, y * U, (x + w) * U, (y + h) * U
    m = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
    d = np.minimum(np.minimum(xx - x0, x1 - 1 - xx), np.minimum(yy - y0, y1 - 1 - yy))   # px to the plate edge
    gap = 5; bev = 9
    prof = np.clip((d - gap) / bev, 0, 1)                    # 0 in the seam, ramps up over the bevel, 1 on the plate
    plate_tone[m] = rng.uniform(-0.07, 0.07)
    seam_mask[m] = (1 - prof[m])
    if kind == 'g':
        # grate: raised frame + diagonal bars over a dark pit
        inner = d > 22
        bars = (np.abs(((xx + yy) % 36) - 18) < 4) | (np.abs(((xx - yy) % 36) - 18) < 4)
        hg = np.where(inner, np.where(bars, 0.75, -0.6), prof * 0.9)
        height[m] = hg[m]; grate_hole[m] = (inner & ~bars)[m]
    else:
        height[m] = (prof * 0.8)[m]
        # rivet rows along the long edges
        sp = 48
        for cx in np.arange(x0 + 24, x1 - 12, sp):
            for cy in (y0 + 17, y1 - 18):
                r = np.hypot(xx[y0:y1, x0:x1] - cx, yy[y0:y1, x0:x1] - cy); dome = np.clip(1 - r / 6.5, 0, 1) ** 0.6
                height[y0:y1, x0:x1] += dome * 0.35; wear_mask[y0:y1, x0:x1] += dome * 0.8
        for cy in np.arange(y0 + 40, y1 - 30, sp):
            for cx in (x0 + 17, x1 - 18):
                r = np.hypot(xx[y0:y1, x0:x1] - cx, yy[y0:y1, x0:x1] - cy); dome = np.clip(1 - r / 6.5, 0, 1) ** 0.6
                height[y0:y1, x0:x1] += dome * 0.35; wear_mask[y0:y1, x0:x1] += dome * 0.8
        # inset panel line one third in on big plates
        if w * h >= 8:
            ins = 40
            dd = np.abs(d - ins)
            groove = np.clip(1 - dd / 2.5, 0, 1) * (d > ins - 3)
            height[m] -= (groove * 0.25)[m]
        if kind == 'e':
            # carved alien ring emblem: concentric grooves with angular tick glyphs
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            r = np.hypot(xx - cx, yy - cy); ang = np.arctan2(yy - cy, xx - cx)
            ring = (np.clip(1 - np.abs(r - 150) / 3.5, 0, 1) + np.clip(1 - np.abs(r - 118) / 2.5, 0, 1)
                    + np.clip(1 - np.abs(r - 40) / 3, 0, 1))
            ticks = (np.abs(((ang / (2 * np.pi) * 24) % 1) - 0.5) < 0.06) & (r > 122) & (r < 146)
            tri = (np.abs(((ang / (2 * np.pi) * 3) % 1) - 0.5) < 0.012) & (r > 44) & (r < 114)
            carve = np.clip(ring + ticks + tri, 0, 1)
            height[m] -= (carve * 0.35)[m]

# surface detail: dents, fine grain, scratches
grain = fbm(48, 3, 11); dents = np.clip(fbm(10, 4, 12) - 0.55, 0, 1)
# sparse short straight scratches (clustered where foot traffic would be: biased by a noise mask)
scr = np.zeros((N, N)); traffic = fbm(3, 3, 13); sr = np.random.default_rng(14)
for _ in range(260):
    x, y = sr.integers(0, N, 2)
    if traffic[y, x] < 0.5 and sr.random() < 0.7: continue
    ang = sr.normal(0.4, 0.5); L = sr.integers(14, 70); a = sr.uniform(0.35, 1.0)
    for k in range(L):
        px = int(x + np.cos(ang) * k) % N; py = int(y + np.sin(ang) * k) % N
        scr[py, px] = max(scr[py, px], a * (1 - abs(k / L - 0.5) * 1.2))
scr2 = np.zeros((N, N))
height += grain * 0.05 - dents * 0.25 - (scr + scr2) * 0.04

# cavity / AO: how much lower a pixel is than its surroundings -> grime collects there
cav = np.clip(blur(height, 10) - height, 0, 1)
edge_ramp = np.clip(np.hypot(np.roll(height, -1, 1) - np.roll(height, 1, 1), np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 8, 0, 1)

# ---------- colour ----------
base = np.array([76, 80, 82], float)                                  # dark gunmetal, slightly cool
grime_n = fbm(4, 5, 21)
lum = 1.0 + plate_tone + (grain - 0.5) * 0.25
lum *= 1 - np.clip(cav * 6, 0, 0.75)                                  # grime in seams and recesses
lum *= 1 - np.clip(grime_n - 0.5, 0, 1) * 0.9                         # broad dirt patches
lum *= np.where(grate_hole > 0, 0.12, 1.0)                            # dark pits under grates
lum *= 1 - seam_mask * 0.55
wear = np.clip(edge_ramp * (1 - seam_mask) + wear_mask * 0.5 + (scr + scr2) * 0.8, 0, 1) * (1 - grate_hole)
rgb = base[None, None, :] * lum[..., None]
rgb = rgb * (1 - wear[..., None] * 0.6) + np.array([150, 152, 150])[None, None, :] * wear[..., None] * 0.6   # bright worn metal
rust = np.clip(fbm(5, 5, 31) - 0.58, 0, 1) * 3 * np.clip(cav * 8 + 0.3, 0, 1)
rgb = rgb * (1 - rust[..., None] * 0.7) + np.array([92, 44, 20])[None, None, :] * rust[..., None] * 0.7
stain = np.clip(fbm(3, 4, 41) - 0.55, 0, 1) * 2                     # faint alien-green residue in dirty areas
rgb[..., 1] += stain * 10 * (1 - wear); rgb[..., 2] += stain * 4 * (1 - wear)

# ---------- normal map (tangent space, +Y up in the texture) ----------
hs = blur(height, 1) * 9.0
dx = (np.roll(hs, -1, 1) - np.roll(hs, 1, 1)) * 0.5; dy = (np.roll(hs, -1, 0) - np.roll(hs, 1, 0)) * 0.5
nz = np.ones_like(dx); l = np.sqrt(dx * dx + dy * dy + nz * nz)
nmap = np.stack([(-dx / l) * 0.5 + 0.5, (dy / l) * 0.5 + 0.5, (nz / l) * 0.5 + 0.5], -1) * 255

# ---------- specular (worn metal shines, grime / rust / pits are dull) ----------
spec = np.clip(0.35 + wear * 0.65 - cav * 4 - rust * 0.6 - np.clip(grime_n - 0.5, 0, 1) * 0.8, 0.03, 1) * (1 - grate_hole * 0.9)

os.makedirs(OUT, exist_ok=True)
Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(f'{OUT}/floor.webp', 'WEBP', quality=88, method=6)
Image.fromarray(np.clip(nmap, 0, 255).astype(np.uint8)).save(f'{OUT}/floor_n.webp', 'WEBP', quality=92, method=6)
Image.fromarray((spec * 255).astype(np.uint8), 'L').convert('RGB').save(f'{OUT}/floor_s.webp', 'WEBP', quality=85, method=6)
rough = (np.clip(1 - spec * 0.75, 0.2, 1) * 255).astype(np.uint8)    # PBR tiers: roughness (G channel is read)
Image.fromarray(rough, 'L').convert('RGB').save(f'{OUT}/floor_r.webp', 'WEBP', quality=85, method=6)
print('floor maps written')
