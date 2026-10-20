#!/usr/bin/env python3
"""Bake the real Earth used by the game (its Earth is 1/20 scale) into assets/.

Sources, all public domain or open, downloaded into one folder given as the first argument:
  tiles4/X_Y.png                         AWS Terrain Tiles (terrarium), zoom 4, x and y 0..15:
                                         https://s3.amazonaws.com/elevation-tiles-prod/terrarium/4/X/Y.png
                                         (SRTM, GMTED, ETOPO1 and others: land elevation and sea depth)
  ne_10m_land.geojson, ne_10m_lakes.geojson, ne_10m_rivers_lake_centerlines.geojson, ne_10m_roads.geojson,
  ne_10m_urban_areas.geojson, ne_10m_populated_places_simple.geojson, ne_10m_admin_0_countries.geojson,
  ne_10m_geography_marine_polys.geojson  Natural Earth 1:10m (github.com/nvkelso/natural-earth-vector, v5.1.2)
  earth-blue-marble.jpg, earth-night.jpg NASA Blue Marble and Black Marble (npm three-globe@2.31.0 example/img)

Outputs (equirectangular: x runs east from longitude -180, y south from latitude +90):
  earth-height.png  4096x2048 height in game metres, one byte a pixel:
                      v >= 128 land: h = 0.5u + 0.09u^2, u = v - 128              (0 .. ~1515 m)
                      v <= 127 sea:  h = -(0.5 + 0.5u + 0.052u^2), u = 127 - v    (-0.5 .. ~-900 m)
                    Near coasts the code is linear in the distance to the shore, so interpolating between
                    pixels puts the shoreline in the right place. Lake beds are carved below their surface.
  earth-color.jpg   2048x1024 Blue Marble colour
  earth-night.jpg   2048x1024 city lights (grey)
  earth-lakes.png   2048x1024 RGB: R lake coverage, G*256+B the lake surface, (h + 1000) * 20
  earth-urban.png   2048x1024 built-up coverage
  earth-regions.png 1024x512 RGB: R*256+G country (1-based index into regions), B sea (1-based, after the countries)
  earth-places.json {regions: [names], nCountries, cities: [[name, region, population, lon, lat, capital], ...]}
  earth-lines.bin   rivers and roads as polylines (see write_lines)

Usage: python3 tools/bake-earth.py <source-dir>
"""
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
os.makedirs(OUT, exist_ok=True)
W, H = 4096, 2048      # heights
CW, CH = 2048, 1024    # colour, lights, lakes, urban
RW, RH = 1024, 512     # regions
src = lambda f: os.path.join(SRC, f)
out = lambda f: os.path.join(OUT, f)
lat_of = lambda n: 90 - (np.arange(n) + 0.5) * 180 / n


def load(f):
    return json.load(open(src(f)))['features']


def rings(geom):
    """Polygons as lists of rings (exterior first)."""
    if not geom:
        return []
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def area(f):
    return sum(abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly[0], poly[0][1:]))) for poly in rings(f['geometry'])) / 2


def raster(features, w, h, ss, mode='L', value=lambda i, f: 255):
    img = Image.new(mode, (w * ss, h * ss), 0)
    d = ImageDraw.Draw(img)
    px = lambda p: ((p[0] + 180) / 360 * w * ss, (90 - p[1]) / 180 * h * ss)
    for i, f in enumerate(features):
        v = value(i, f)
        for poly in rings(f['geometry']):
            for k, r in enumerate(poly):
                if len(r) > 2:
                    d.polygon([px(p) for p in r], fill=0 if k else v)
    return img


def coverage(img, w, h):
    return np.asarray(img.resize((w, h), Image.BOX), dtype=np.float32) / 255.0


def chamfer(inside, steps, kx):
    """Distance (pixels of north-south size) from each inside pixel to the nearest outside one."""
    d = np.where(inside, np.inf, 0.0)
    for _ in range(steps):
        best = d.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nb = np.roll(np.roll(d, dy, axis=0), dx, axis=1)
            if dy == 1: nb[0, :] = np.inf
            if dy == -1: nb[-1, :] = np.inf
            best = np.minimum(best, nb + np.hypot(dx * kx, dy))
        d = np.where(inside, best, 0.0)
    return np.where(np.isinf(d), float(steps), d)


def blur(a, sigma):
    r = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    a = sum(np.roll(a, i, axis=1) * k[i + r] for i in range(-r, r + 1))
    p = np.pad(a, ((r, r), (0, 0)), mode='edge')
    return sum(p[r + i:r + i + a.shape[0]] * k[i + r] for i in range(-r, r + 1))


# game metres from real metres: mountains flattened (Everest ~1500 m), lowlands keep some relief
fL = lambda e: 1500 * np.power(np.clip(e, 0, 8800) / 8800, 0.85)
fS = lambda e: -900 * np.power(np.clip(-e, 0, 7000) / 7000, 0.8)


def encode_h(h):
    land = h >= 0
    u_land = np.clip(np.round((-0.5 + np.sqrt(0.25 + 4 * 0.09 * np.maximum(h, 0))) / (2 * 0.09)), 0, 127)
    u_sea = np.clip(np.round((-0.5 + np.sqrt(np.maximum(0.25 - 4 * 0.052 * (0.5 + np.minimum(h, 0)), 0))) / (2 * 0.052)), 0, 127)
    return np.where(land, 128 + u_land, 127 - u_sea).astype(np.uint8)


print('elevation tiles')
mosaic = np.zeros((4096, 4096), np.float32)
for x in range(16):
    for y in range(16):
        t = np.asarray(Image.open(src(f'tiles4/{x}_{y}.png')).convert('RGB'), dtype=np.float32)
        mosaic[y * 256:(y + 1) * 256, x * 256:(x + 1) * 256] = t[..., 0] * 256 + t[..., 1] + t[..., 2] / 256 - 32768
# Web Mercator rows to latitude rows (poles beyond 85° take the last row)
lat = np.radians(lat_of(H))
my = (1 - np.log(np.tan(np.pi / 4 + np.clip(lat, -1.4844, 1.4844) / 2)) / np.pi) / 2 * 4096 - 0.5
y0 = np.clip(np.floor(my).astype(int), 0, 4094); fy = np.clip(my - y0, 0, 1)[:, None]
xs = (np.arange(W) + 0.5) * 4096 / W - 0.5
x0 = np.floor(xs).astype(int) % 4096; x1 = (x0 + 1) % 4096; fx = (xs - np.floor(xs))[None, :]
E = (mosaic[y0][:, x0] * (1 - fx) + mosaic[y0][:, x1] * fx) * (1 - fy) + (mosaic[y0 + 1][:, x0] * (1 - fx) + mosaic[y0 + 1][:, x1] * fx) * fy
del mosaic

print('coastlines')
landf = coverage(raster(load('ne_10m_land.geojson'), W, H, 2), W, H)
landf[lat_of(H) < -84.2, :] = 1.0  # the source stops short of the South Pole, which is all ice
land = landf >= 0.5
kx = (np.maximum(np.cos(np.radians(lat_of(H))), 0.05)[:, None] * np.ones((1, W))).astype(np.float32)
din = chamfer(land, 4, kx); dout = chamfer(~land, 4, kx)
sd = np.where(land, din - 0.5 + (landf - 0.5), -(dout - 0.5 + (0.5 - landf)))
sd = blur(sd, 0.9)
land = sd >= 0
# the real relief, but never closer to the sea than a steady slope off the shore allows (10 m a pixel)
ramp = 10 * np.clip(np.abs(sd), 0, 1.5) + 1
h = np.where(land, np.maximum(fL(E), ramp), np.minimum(fS(E), -ramp))
# the deep sea floor is only ever seen as colour: smooth it (it also packs much smaller)
deep = blur(h, 1.6)
h = np.where(~land & (sd < -3), np.minimum(deep, -ramp), h)

print('lakes')
lakes = [f for f in load('ne_10m_lakes.geojson') if f['geometry']]
ids = np.asarray(raster(lakes, W, H, 1, 'I', lambda i, f: i + 1), dtype=np.int32)
lakef = coverage(raster(lakes, W, H, 2), W, H)
n = len(lakes) + 1
cnt = np.bincount(ids.ravel(), minlength=n)
lev_real = np.bincount(ids.ravel(), weights=np.where(ids > 0, E, 0).ravel(), minlength=n) / np.maximum(cnt, 1)
lev = fL(lev_real)                      # surface, game metres (a lake at or below sea level sits at 0)
lev[0] = 0
inlake = (lakef >= 0.5) & land & (ids > 0)
dl = chamfer(inlake, 3, kx)
L = lev[ids]
bed = L - (6 + 0.02 * L + 18 * np.clip(dl / 3, 0, 1))
h = np.where(inlake, np.minimum(h, bed), h)
Image.fromarray(encode_h(h), 'L').save(out('earth-height.png'), optimize=True)
# lake surface and coverage at half resolution, the surface spread a few pixels past the shore so
# interpolating near the shore still finds it
cov2 = coverage(raster(lakes, CW, CH, 4), CW, CH)
ids2 = np.asarray(raster(lakes, CW, CH, 1, 'I', lambda i, f: i + 1), dtype=np.int32)
for _ in range(3):
    grow = ids2.copy()
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb = np.roll(np.roll(ids2, dy, axis=0), dx, axis=1)
        grow = np.where(grow == 0, nb, grow)
    ids2 = grow
code = np.clip(np.round((lev[ids2] + 1000) * 20), 0, 65535).astype(np.uint16)
Image.fromarray(np.dstack([np.round(cov2 * 255).astype(np.uint8), (code >> 8).astype(np.uint8), (code & 255).astype(np.uint8)]), 'RGB').save(out('earth-lakes.png'), optimize=True)

print('urban areas, colour, lights')
urb = coverage(raster(load('ne_10m_urban_areas.geojson'), CW, CH, 2), CW, CH)
Image.fromarray(np.round(urb * 255).astype(np.uint8), 'L').save(out('earth-urban.png'), optimize=True)
Image.open(src('earth-blue-marble.jpg')).convert('RGB').resize((CW, CH), Image.LANCZOS).save(out('earth-color.jpg'), quality=86, optimize=True, progressive=True)
Image.open(src('earth-night.jpg')).convert('L').resize((CW, CH), Image.LANCZOS).save(out('earth-night.jpg'), quality=82, optimize=True)

print('regions and places')
countries = load('ne_10m_admin_0_countries.geojson')
marine = [f for f in sorted(load('ne_10m_geography_marine_polys.geojson'), key=lambda f: -area(f)) if f['properties'].get('name')][:255]
names = [f['properties']['NAME_LONG'] or f['properties']['NAME'] for f in countries] + [f['properties']['name'] for f in marine]
cid = np.asarray(raster(countries, RW, RH, 1, 'I', lambda i, f: i + 1), dtype=np.int32)
mid = np.asarray(raster(marine, RW, RH, 1, 'I', lambda i, f: i + 1), dtype=np.int32)  # big seas first, gulfs and bays over them
Image.fromarray(np.dstack([(cid >> 8).astype(np.uint8), (cid & 255).astype(np.uint8), mid.astype(np.uint8)]), 'RGB').save(out('earth-regions.png'), optimize=True)
by_name = {}
for i, f in enumerate(countries):
    for k in ('ADMIN', 'NAME', 'NAME_LONG', 'SOVEREIGNT'):
        by_name.setdefault(f['properties'].get(k), i)
cities = []
for f in load('ne_10m_populated_places_simple.geojson'):
    p = f['properties']
    pop = int(p.get('pop_max') or 0)
    if pop < 5000:
        continue
    ci = by_name.get(p.get('adm0name'), by_name.get(p.get('sov0name'), -1)) + 1
    cities.append([p['name'], ci, pop, round(p['longitude'], 3), round(p['latitude'], 3), 1 if p.get('adm0cap') else 0])
cities.sort(key=lambda c: -c[2])
json.dump({'regions': names, 'nCountries': len(countries), 'cities': cities}, open(out('earth-places.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

print('rivers and roads')


def simplify(pts, tol):
    """Douglas-Peucker on lon/lat (degrees)."""
    if len(pts) < 3:
        return pts
    a = np.asarray(pts, dtype=np.float64)[:, :2]
    keep = np.zeros(len(a), bool); keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = a[i], a[j]
        d = q - p
        L2 = d @ d
        seg = a[i + 1:j]
        if L2 == 0:
            dist = np.hypot(*(seg - p).T)
        else:
            t = np.clip(((seg - p) @ d) / L2, 0, 1)
            dist = np.hypot(*(seg - (p + t[:, None] * d)).T)
        k = int(np.argmax(dist))
        if dist[k] > tol:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return a[keep].tolist()


def parts(geom):
    return geom['coordinates'] if geom['type'] == 'MultiLineString' else [geom['coordinates']]


lines = []  # (kind, class, points)
for f in load('ne_10m_rivers_lake_centerlines.geojson'):
    p = f['properties']
    if p['featurecla'] != 'River' or not f['geometry']:
        continue
    r = int(p['scalerank'] or 9)
    cls = 0 if r <= 1 else 1 if r <= 3 else 2 if r <= 5 else 3 if r <= 7 else 4  # widest first
    for part in parts(f['geometry']):
        lines.append((0, cls, simplify(part, 0.004)))
ROAD = {'Major Highway': 0, 'Beltway': 0, 'Bypass': 0, 'Secondary Highway': 1, 'Road': 2, 'Unknown': 2, 'Track': 3}
for f in load('ne_10m_roads.geojson'):
    p = f['properties']
    if p['type'] not in ROAD or not f['geometry']:
        continue
    for part in parts(f['geometry']):
        lines.append((1, ROAD[p['type']], simplify(part, 0.006)))


def write_lines(path):
    """'RL02', u32 count; per line: u8 kind (0 river, 1 road), u8 class, u16 n, i32 lon, i32 lat (1/1000°),
    then n-1 steps (1/1000°): two i8, or for a long step the escape -128 followed by two i16. Very long
    hops are split so each step fits."""
    buf = bytearray(b'RL02') + struct.pack('<I', 0)
    count = 0
    for kind, cls, pts in lines:
        q = [(round(x * 1000), round(y * 1000)) for x, y in pts]
        pts2 = [q[0]]
        for x, y in q[1:]:
            px, py = pts2[-1]
            if (x, y) == (px, py):
                continue
            steps = max(1, math.ceil(max(abs(x - px), abs(y - py)) / 30000))
            for s in range(1, steps + 1):
                pts2.append((px + round((x - px) * s / steps), py + round((y - py) * s / steps)))
        for i in range(0, len(pts2) - 1, 65000):
            chunk = pts2[i:i + 65001]
            if len(chunk) < 2:
                continue
            buf += struct.pack('<BBHii', kind, cls, len(chunk), chunk[0][0], chunk[0][1])
            for (ax, ay), (bx, by) in zip(chunk, chunk[1:]):
                dx, dy = bx - ax, by - ay
                buf += struct.pack('<bb', dx, dy) if -127 <= dx <= 127 and -127 <= dy <= 127 else struct.pack('<bhh', -128, dx, dy)
            count += 1
    buf[4:8] = struct.pack('<I', count)
    open(path, 'wb').write(buf)


write_lines(out('earth-lines.bin'))
for f in sorted(os.listdir(OUT)):
    if f.startswith('earth-'):
        print(f'{f:22s}{os.path.getsize(out(f)) // 1024:6d} KB')
