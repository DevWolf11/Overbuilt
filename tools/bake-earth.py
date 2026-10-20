#!/usr/bin/env python3
"""Bake the real Earth map used by the game: assets/earth-height.png and assets/earth-color.jpg.

Sources (both public domain), downloaded into a scratch folder given as the first argument:
  land-50m.json          Natural Earth 1:50m land, as TopoJSON (npm world-atlas@2.0.2)
  earth-topology.png     NASA land elevation, 2048x1024 greyscale (npm three-globe@2.31.0 example/img)
  earth-blue-marble.jpg  NASA Blue Marble colour, 4096x2048 (npm three-globe@2.31.0 example/img)

Both outputs are equirectangular: x runs east from longitude -180, y south from latitude +90.
earth-height.png holds the height in game metres (the game's Earth is 1/20 scale), one byte per pixel:
  v >= 128: land,  h = 0.5u + 0.09u^2 with u = v - 128         (0 .. ~1515 m)
  v <= 127: sea,   h = -(0.5 + 0.5u + 0.04u^2) with u = 127 - v  (-0.5 .. ~-710 m)
Near the coast the code is linear, so interpolating between pixels puts the shoreline in the right place.
The sea floor is made up: shallow shelves near the coast falling to deep ocean further out.

Usage: python3 tools/bake-earth.py <source-dir>
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
W, H = 2048, 1024          # height map
CW, CH = 1024, 512         # colour map
SS = 4                     # supersampling of the land mask

# ---------------------------------------------------------------- land mask from Natural Earth
topo = json.load(open(os.path.join(SRC, 'land-50m.json')))
sx, sy = topo['transform']['scale']
tx, ty = topo['transform']['translate']
arcs = []
for arc in topo['arcs']:
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx; y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)


def ring(idx):
    pts = []
    for i in idx:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts


MW, MH = W * SS, H * SS
mask = Image.new('L', (MW, MH), 0)
draw = ImageDraw.Draw(mask)
to_px = lambda p: ((p[0] + 180) / 360 * MW, (90 - p[1]) / 180 * MH)
for geom in topo['objects']['land']['geometries']:
    polys = geom['arcs'] if geom['type'] == 'MultiPolygon' else [geom['arcs']]
    for poly in polys:
        for k, r in enumerate(poly):
            draw.polygon([to_px(p) for p in ring(r)], fill=0 if k else 255)
land_frac = np.asarray(mask.resize((W, H), Image.BOX), dtype=np.float32) / 255.0
# the source stops short of the South Pole, which is all Antarctic ice
land_frac[(90 - (np.arange(H) + 0.5) * 180 / H) < -84.2, :] = 1.0
land = land_frac >= 0.5

# ---------------------------------------------------------------- distance to the coast, in pixels
lat = (90 - (np.arange(H) + 0.5) * 180 / H) * np.pi / 180
kx = np.maximum(np.cos(lat), 0.05)[:, None] * np.ones((1, W))  # a pixel's east-west size, relative


def coast_distance(inside, steps):
    """Chamfer distance (in pixels of north-south size) from each inside pixel to the nearest outside one."""
    d = np.where(inside, np.inf, 0.0)
    for _ in range(steps):
        best = d.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nb = np.roll(np.roll(d, dy, axis=0), dx, axis=1)
            if dy == 1: nb[0, :] = np.inf
            if dy == -1: nb[-1, :] = np.inf
            best = np.minimum(best, nb + np.hypot(dx * kx, dy))
        d = np.where(inside, best, 0.0)
    return np.where(np.isinf(d), steps * 1.0, d)


din = coast_distance(land, 24)
dout = coast_distance(~land, 40)
# sub-pixel coast: half a pixel either side of the boundary, adjusted by the mask's coverage
din = np.where(land, din - 0.5 + (land_frac - 0.5), 0)
dout = np.where(~land, dout - 0.5 + (0.5 - land_frac), 0)

# ---------------------------------------------------------------- heights in game metres
# a signed distance to the coast (pixels, land positive), softened so shorelines come out smooth
sd = np.where(land, din, -dout)
def blur(a, sigma):
    r = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    a = sum(np.roll(a, i, axis=1) * k[i + r] for i in range(-r, r + 1))
    p = np.pad(a, ((r, r), (0, 0)), mode='edge')
    return sum(p[r + i:r + i + a.shape[0]] * k[i + r] for i in range(-r, r + 1))
sd = blur(sd, 0.9)
land = sd >= 0
topo_px = np.asarray(Image.open(os.path.join(SRC, 'earth-topology.png')).convert('L').resize((W, H), Image.BILINEAR), dtype=np.float32)
relief = 1250 * np.power(topo_px / 255.0, 1.4)
# the same slope (10 m a pixel) either side of the shore, then the land's own relief, or the sea floor:
# a continental shelf ~30 m deep, falling away to the abyss
near = 10 * np.clip(sd, -1.5, 1.5)
h_land = near + relief * np.clip(sd / 2, 0, 1) + 4 * np.clip(sd - 1.5, 0, 4)
x = np.clip(-sd - 1.5, 0, None)
h_sea = near - 24 * np.clip(x / 2, 0, 1) - 640 * np.clip((x - 2) / 14, 0, 1) ** 1.5
h = np.where(land, h_land, h_sea)

# land: h = 0.5u + 0.09u^2 (v = 128 + u); sea: h = -(0.5 + 0.5u + 0.04u^2) (v = 127 - u)
u_land = np.clip(np.round((-0.5 + np.sqrt(0.25 + 4 * 0.09 * np.maximum(h, 0))) / (2 * 0.09)), 0, 127)
u_sea = np.clip(np.round((-0.5 + np.sqrt(np.maximum(0.25 - 4 * 0.04 * (0.5 + h), 0))) / (2 * 0.04)), 0, 127)
v = np.where(land, 128 + u_land, 127 - u_sea).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(v, 'L').save(os.path.join(OUT, 'earth-height.png'), optimize=True)

# ---------------------------------------------------------------- colour
col = Image.open(os.path.join(SRC, 'earth-blue-marble.jpg')).convert('RGB').resize((CW, CH), Image.LANCZOS)
col.save(os.path.join(OUT, 'earth-color.jpg'), quality=86, optimize=True, progressive=True)

for f in ('earth-height.png', 'earth-color.jpg'):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
print('land fraction', land.mean().round(3))
