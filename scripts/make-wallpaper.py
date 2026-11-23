# Original menu wallpaper: floating alien-fortress islands over a ringed gas giant, generated procedurally.
#   python3 scripts/make-wallpaper.py   ->  public/menu-bg.webp (1920x1080) + public/menu-bg-m.webp (1280x720)
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
rng = np.random.default_rng(42)
yy, xx = np.mgrid[0:H, 0:W].astype(float)


def noise(cells_x, cells_y, seed):
    r = np.random.default_rng(seed).random((cells_y + 2, cells_x + 2))
    tx = xx / W * cells_x; ty = yy / H * cells_y
    ix = tx.astype(int); iy = ty.astype(int); fx = tx - ix; fy = ty - iy
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    a = r[iy, ix]; b = r[iy, ix + 1]; c = r[iy + 1, ix]; d = r[iy + 1, ix + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(cx, cy, oct, seed):
    s = 0; amp = 1; tot = 0
    for o in range(oct):
        s = s + amp * noise(cx * 2 ** o, cy * 2 ** o, seed + o * 13); tot += amp; amp *= 0.5
    return s / tot


# ---- sky: near-black, faint warm haze toward the horizon, a dim nebula band ----
img = np.zeros((H, W, 3))
t = yy / H
img += np.stack([4 + 26 * t ** 2.2, 3 + 12 * t ** 2.4, 8 + 6 * t], -1)
neb = np.clip(fbm(5, 3, 5, 7) - 0.48, 0, 1) * 2.2 * np.exp(-((yy - 330 - (xx - 900) * 0.25) / 260) ** 2)
img += np.stack([neb * 70, neb * 26, neb * 34], -1)

# stars
for _ in range(2600):
    x, y = rng.integers(0, W), rng.integers(0, int(H * 0.85)); b = rng.random() ** 3
    c = np.array([200 + 55 * rng.random(), 200 + 40 * rng.random(), 220 + 35 * rng.random()]) * (0.25 + b)
    img[y, x] += c
    if b > 0.6:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if 0 <= x + dx < W and 0 <= y + dy < H: img[y + dy, x + dx] += c * 0.35

# ---- ringed gas giant (upper right), lit from the left with a hot rim ----
pcx, pcy, pr = 1460, 300, 330
d = np.hypot(xx - pcx, yy - pcy)
inside = d < pr
nx = (xx - pcx) / pr; ny = (yy - pcy) / pr; nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
light = np.clip(-0.75 * nx - 0.35 * ny + 0.45 * nz, 0, 1)
lat = ny * 0.92 + nx * 0.2
bands = 0.5 + 0.5 * np.sin(lat * 26 + fbm(3, 6, 4, 11) * 6)
pcol = np.stack([70 + 110 * bands, 38 + 60 * bands, 30 + 30 * bands], -1) * (0.05 + 0.95 * light[..., None] ** 1.3)
rim = np.clip(1 - (pr - d) / 26, 0, 1) * inside * np.clip(-nx * 0.8 - ny * 0.3 + 0.35, 0, 1)
pcol += np.stack([rim * 230, rim * 130, rim * 60], -1)
img = np.where(inside[..., None], pcol, img)
glow = np.exp(-np.clip(d - pr, 0, None) / 36) * (~inside) * np.clip(-nx * 0.7 + 0.3, 0, 1)
img += np.stack([glow * 120, glow * 56, glow * 26], -1)
# rings (an ellipse band), hidden behind the planet's upper half
ang = -0.32; cs, sn = np.cos(ang), np.sin(ang)
rx = (xx - pcx) * cs - (yy - pcy) * sn; ry = ((xx - pcx) * sn + (yy - pcy) * cs) / 0.2
rr = np.hypot(rx, ry) / pr
ringm = ((rr > 1.35) & (rr < 2.2)) * (0.55 + 0.45 * np.sin(rr * 60)) * np.clip((rr - 1.35) * 8, 0, 1) * np.clip((2.2 - rr) * 6, 0, 1)
front = ~(inside & (ry < 0))
ringc = np.stack([ringm * 150, ringm * 104, ringm * 72], -1) * (0.35 + 0.65 * np.clip(-rx / (pr * 2.2) + 0.5, 0, 1))[..., None]
img = np.where((ringm > 0.02)[..., None] & front[..., None], img * (1 - ringm[..., None] * 0.7) + ringc, img)

# ---- floating fortress islands (silhouettes with warm lamps), far -> near ----
canvas = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
layer_specs = [
    # (count, y range, width range, darkness 0..1 (0=fog colour), lamp size)
    (5, (560, 640), (90, 170), 0.35, 1),
    (3, (620, 720), (180, 300), 0.6, 2),
    (2, (700, 860), (380, 560), 1.0, 3),
]
fog = np.array([30, 16, 14])
for li, (count, yr, wr, dark, lamp) in enumerate(layer_specs):
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dr = ImageDraw.Draw(lay)
    col = tuple(int(c) for c in (fog * (1 - dark) + np.array([6, 5, 7]) * dark)) + (255,)
    xs = np.linspace(-80, W + 80, count + 2)[1:-1] + rng.normal(0, 90, count)
    if li == 2: xs = np.array([430, 1330.0])
    for x in xs:
        y = rng.uniform(*yr); w = rng.uniform(*wr); th = w * 0.07
        # slab with an iron lip
        dr.rectangle([x - w / 2, y - th, x + w / 2, y], fill=col)
        dr.rectangle([x - w / 2 - 3, y - th - 3, x + w / 2 + 3, y - th + 2], fill=col)
        # jagged rock cone underneath
        pts = [(x - w / 2, y)]; n = 14; depth = w * rng.uniform(0.55, 0.8)
        for k in range(1, n):
            f = k / n; px = x - w / 2 + w * f
            py = y + depth * (1 - abs(f - 0.5) * 2) ** 0.8 * rng.uniform(0.7, 1.05)
            pts.append((px, py))
        pts.append((x + w / 2, y)); dr.polygon(pts, fill=col)
        # pillars / a tower on the near islands
        if li >= 1:
            for k in range(rng.integers(2, 4)):
                px = x + rng.uniform(-0.4, 0.4) * w; ph = rng.uniform(0.12, 0.35) * w; pw = w * 0.035
                dr.rectangle([px - pw, y - th - ph, px + pw, y - th], fill=col)
            if li == 2:
                tw = w * 0.07; tx = x + w * 0.12; tht = w * 0.75
                dr.polygon([(tx - tw, y - th), (tx - tw * 0.6, y - th - tht), (tx, y - th - tht - w * 0.06), (tx + tw * 0.6, y - th - tht), (tx + tw, y - th)], fill=col)
                dr.rectangle([tx - tw * 1.6, y - th - tht * 0.55, tx + tw * 1.6, y - th - tht * 0.55 + 8], fill=col)
        # warm lamps along the lip
        for k in range(int(w // 38) + 1):
            lx = x - w / 2 + 12 + k * 38
            if lx < x + w / 2 - 6 and rng.random() < 0.8:
                ly = y - th * 0.45
                dr.ellipse([lx - lamp, ly - lamp, lx + lamp, ly + lamp], fill=(255, 170, 90, 255))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), lay)
    # lamp bloom for this layer
    glow_l = lay.filter(ImageFilter.GaussianBlur(4 + li * 3))
    g = np.array(glow_l).astype(float); m = (g[..., 0] > 200) * 0 + np.clip(g[..., 0] - g[..., 2] - 40, 0, 255) / 255
    base = np.array(canvas).astype(float)
    base[..., :3] += np.stack([m * 160, m * 80, m * 30], -1)
    canvas = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))

# ---- haze at the bottom, vignette ----
out = np.array(canvas.convert('RGB')).astype(float)
haze = np.clip((yy - H * 0.62) / (H * 0.38), 0, 1) ** 1.6 * (0.6 + 0.4 * fbm(4, 2, 3, 21))
out = out * (1 - haze[..., None] * 0.55) + np.array([40, 20, 14])[None, None, :] * haze[..., None] * 0.55
vig = np.clip(1 - (((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H / 2) / (H * 0.8)) ** 2), 0, 1) ** 0.7
out *= (0.35 + 0.65 * vig)[..., None]
grain = (np.random.default_rng(5).random((H, W)) - 0.5) * 6
out += grain[..., None]
img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
img.save('public/menu-bg.webp', 'WEBP', quality=82, method=6)
img.resize((1280, 720), Image.LANCZOS).save('public/menu-bg-m.webp', 'WEBP', quality=80, method=6)
print('wallpaper written')
