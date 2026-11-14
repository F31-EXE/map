"""
Tactical picture as KMZ: a satellite image of the playing area with the snail grid
(«улитка») drawn on it, as a KML GroundOverlay that GrimMap («Карты полигона» → import),
Alpine Quest, Locus, OsmAnd and Google Earth open.

Runs on a GitHub runner (.github/workflows/tactical-map.yml): the tile servers and Yandex
aren't reachable from everywhere.

  python make_kmz.py --link "https://yandex.ru/maps/-/XXXX" --out out/
  python make_kmz.py --link "56.8380, 60.6030" --size-km 2 --zoom 17 --source esri

The grid matches the app's snail without a squad origin: 500 m UTM squares counted from
the north-west corner of the 5 km UTM block the area's center is in (map.js `snailCell`).
"""

import argparse
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import zipfile
from concurrent.futures import ThreadPoolExecutor

import requests
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
SOURCES = {
    # Yandex satellite is EPSG:3395 (ellipsoidal Mercator), the rest EPSG:3857.
    'yandex': ('https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1&lang=ru_RU', True, '© Яндекс'),
    'esri': ('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', False, '© Esri, Maxar, Earthstar Geographics'),
}
LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ'
SNAIL_SIZE = 500.0
SNAIL_BLOCK = 5000.0
E = 0.0818191908426  # WGS84 eccentricity
MAX_SIDE = 9000  # px


# ---------------------------------------------------------------- where


def find_center(text):
    """(lat, lng, zoom|None, url) from «lat, lng» or a (short / VK-wrapped) Yandex Maps link."""
    m = re.fullmatch(r'\s*(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)\s*', text)
    if m:
        return float(m.group(1)), float(m.group(2)), None, None
    url = text.strip()
    # vk.com/away.php?to=…
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    if 'to' in q:
        url = q['to'][0]
    final = url
    try:
        r = requests.get(url, headers={'User-Agent': UA}, timeout=30, allow_redirects=True)
        final = r.url
        body = r.text
    except Exception as e:  # noqa: BLE001
        print(f'Ссылка не открылась: {e}', file=sys.stderr)
        body = ''
    print(f'Ссылка ведёт на: {final}')
    # The coordinates may be in the final URL, inside a captcha's retpath (encoded once or
    # twice), or in the page itself.
    hay = final
    for _ in range(3):
        hay = hay + ' ' + urllib.parse.unquote(hay)
    for key in ('whatshere%5Bpoint%5D=', 'whatshere[point]=', 'pt=', 'll='):
        for cand in (hay,):
            m = re.search(re.escape(key) + r'(-?\d{1,3}\.\d+)(?:%2C|,)(-?\d{1,2}\.\d+)', cand)
            if m:
                lng, lat = float(m.group(1)), float(m.group(2))
                z = re.search(r'[?&]z=(\d+(?:\.\d+)?)', hay)
                return lat, lng, float(z.group(1)) if z else None, final
    m = re.search(r'"(?:ll|center)"\s*:\s*\[\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,2}\.\d+)\s*\]', body)
    if m:
        return float(m.group(2)), float(m.group(1)), None, final
    raise SystemExit(
        'Не нашёл координат в ссылке. Откройте место в Яндекс Картах, нажмите на точку и '
        'вставьте координаты в поле link, например «56.8380, 60.6030».'
    )


def auto_size_km(zoom):
    if zoom is None:
        return 2.0
    # Roughly what the shared view showed on a phone.
    return max(0.8, min(6.0, 2.0 * 2 ** (16 - zoom)))


# ---------------------------------------------------------------- projections


def world_px(lat, lng, z, ellipsoid):
    n = 256 * 2 ** z
    x = (lng + 180) / 360 * n
    phi = math.radians(lat)
    if ellipsoid:
        con = E * math.sin(phi)
        ts = math.tan(math.pi / 4 + phi / 2) * ((1 - con) / (1 + con)) ** (E / 2)
        y = (1 - math.log(ts) / math.pi) / 2 * n
    else:
        y = (1 - math.log(math.tan(math.pi / 4 + phi / 2)) / math.pi) / 2 * n
    return x, y


def lat_of_world_y(y, z, ellipsoid):
    n = 256 * 2 ** z
    t = math.exp(-(y / n * 2 - 1) * math.pi)
    lat = math.pi / 2 - 2 * math.atan(1 / t)  # spherical
    if ellipsoid:
        for _ in range(8):
            con = E * math.sin(lat)
            lat = math.pi / 2 - 2 * math.atan((1 / t) * ((1 - con) / (1 + con)) ** (E / 2))
    return math.degrees(lat)


# ---------------------------------------------------------------- image


def fetch_tiles(src, z, x0, y0, x1, y1):
    url, _, _ = SOURCES[src]
    sess = requests.Session()
    sess.headers['User-Agent'] = UA
    sess.headers['Referer'] = 'https://yandex.ru/maps/' if src == 'yandex' else 'https://www.arcgis.com/'

    def one(xy):
        x, y = xy
        for attempt in range(4):
            try:
                r = sess.get(url.format(x=x, y=y, z=z), timeout=30)
                if r.status_code == 200 and r.content[:2] in (b'\xff\xd8', b'\x89P'):
                    return xy, Image.open(io.BytesIO(r.content)).convert('RGB')
            except Exception:  # noqa: BLE001
                pass
            time.sleep(1 + attempt)
        return xy, None

    jobs = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    with ThreadPoolExecutor(8) as ex:
        return dict(ex.map(one, jobs))


def font(size, bold=True):
    for p in (
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def draw_snail(img, to_px, lat, lng, bbox, origin=None):
    """Bold 500 m squares, thin 3×3 cells, one name per square (letter white, number amber).

    `origin` (lat, lng): square А1's north-west corner, like a squad's grid origin in the
    app. Without it every square is named inside its own 5 km UTM block, as the app does.
    """
    zone = int((lng + 180) // 6) + 1
    utm = Transformer.from_crs('EPSG:4326', f'EPSG:{32600 + zone if lat >= 0 else 32700 + zone}', always_xy=True)
    geo = Transformer.from_crs(f'EPSG:{32600 + zone if lat >= 0 else 32700 + zone}', 'EPSG:4326', always_xy=True)
    if origin:
        oe, on = utm.transform(origin[1], origin[0])
    else:
        ce, cn = utm.transform(lng, lat)
        oe = math.floor(ce / SNAIL_BLOCK) * SNAIL_BLOCK
        on = math.ceil(cn / SNAIL_BLOCK) * SNAIL_BLOCK
    s, w, n, e = bbox
    corners = [utm.transform(x, y) for x, y in ((w, s), (w, n), (e, n), (e, s))]
    min_e, max_e = min(c[0] for c in corners), max(c[0] for c in corners)
    min_n, max_n = min(c[1] for c in corners), max(c[1] for c in corners)

    def px(ee, nn):
        lo, la = geo.transform(ee, nn)
        return to_px(la, lo)

    d = ImageDraw.Draw(img, 'RGBA')
    W = img.width
    thin = max(1, W // 1600)
    bold = max(3, W // 550)
    # A dark under-stroke keeps the lines readable over snow, sand and bright fields.
    for step, color, width in ((SNAIL_SIZE / 3, (255, 200, 61, 150), thin), (SNAIL_SIZE, (255, 200, 61, 240), bold)):
        e0 = oe + math.floor((min_e - oe) / step) * step
        n0 = on + math.floor((min_n - on) / step) * step
        ee = e0
        lines = []
        while ee <= max_e + step:
            lines.append([px(ee, min_n - step + k * (max_n - min_n + 2 * step) / 16) for k in range(17)])
            ee += step
        nn = n0
        while nn <= max_n + step:
            lines.append([px(min_e - step + k * (max_e - min_e + 2 * step) / 16, nn) for k in range(17)])
            nn += step
        for ln in lines:
            d.line(ln, fill=(0, 0, 0, 90), width=width + 2)
        for ln in lines:
            d.line(ln, fill=color, width=width)

    f = font(max(18, W // 45))
    e0 = oe + math.floor((min_e - oe) / SNAIL_SIZE) * SNAIL_SIZE
    n0 = on + math.floor((min_n - on) / SNAIL_SIZE) * SNAIL_SIZE
    ee = e0
    while ee < max_e:
        nn = n0
        while nn < max_n:
            x0, x1 = max(ee, min_e), min(ee + SNAIL_SIZE, max_e)
            y0, y1 = max(nn, min_n), min(nn + SNAIL_SIZE, max_n)
            if x1 - x0 > 120 and y1 - y0 > 120:
                if origin:
                    be, bn = oe, on
                else:
                    # The block this square lies in (map.js snailOriginFor).
                    mid_e, mid_n = ee + SNAIL_SIZE / 2, nn + SNAIL_SIZE / 2
                    be = math.floor(mid_e / SNAIL_BLOCK) * SNAIL_BLOCK
                    bn = math.ceil(mid_n / SNAIL_BLOCK) * SNAIL_BLOCK
                col = int(math.floor((ee + SNAIL_SIZE / 2 - be) / SNAIL_SIZE))
                row = int(math.floor((bn - (nn + SNAIL_SIZE / 2)) / SNAIL_SIZE))
                letter = LETTERS[col % len(LETTERS)]
                number = str(row + 1 if row >= 0 else row)
                cx, cy = px((x0 + x1) / 2, (y0 + y1) / 2)
                if 0 <= cx < img.width and 0 <= cy < img.height:
                    lw = d.textlength(letter, font=f)
                    nw = d.textlength(number, font=f)
                    gap = f.size * 0.15
                    tw = lw + gap + nw
                    pad = f.size * 0.35
                    d.rounded_rectangle(
                        [cx - tw / 2 - pad, cy - f.size * 0.75, cx + tw / 2 + pad, cy + f.size * 0.75],
                        radius=f.size * 0.3, fill=(5, 12, 8, 150), outline=(255, 200, 61, 220), width=max(1, f.size // 14),
                    )
                    d.text((cx - tw / 2, cy), letter, font=f, fill=(255, 255, 255, 255), anchor='lm')
                    d.text((cx - tw / 2 + lw + gap, cy), number, font=f, fill=(255, 200, 61, 255), anchor='lm')
            nn += SNAIL_SIZE
        ee += SNAIL_SIZE
    return zone, oe, on


def draw_frame(img, meters_per_px, title, attribution):
    d = ImageDraw.Draw(img, 'RGBA')
    W, H = img.size
    f = font(max(14, W // 70))
    small = font(max(11, W // 110), bold=False)
    # Scale bar: a round length about a fifth of the width.
    target = W / 5 * meters_per_px
    length = max(x for x in (50, 100, 200, 250, 500, 1000, 2000) if x <= max(50, target))
    bar = length / meters_per_px
    m = f.size
    x0, y0 = m, H - m * 2.6
    d.rounded_rectangle([x0 - m * 0.5, y0 - m * 1.6, x0 + max(bar, d.textlength(title, font=f)) + m * 0.5, H - m * 0.6], radius=m * 0.3, fill=(5, 12, 8, 170))
    d.text((x0, y0 - m * 1.4), title, font=f, fill=(255, 255, 255, 255))
    d.rectangle([x0, y0 + m * 0.2, x0 + bar, y0 + m * 0.55], fill=(255, 255, 255, 255))
    d.rectangle([x0, y0 + m * 0.2, x0 + bar / 2, y0 + m * 0.55], fill=(255, 200, 61, 255))
    d.text((x0, y0 + m * 0.7), f'{length} м · север вверху · {attribution}', font=small, fill=(230, 230, 230, 255))


# ---------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--link', required=True)
    ap.add_argument('--size-km', default='auto')
    ap.add_argument('--zoom', type=int, default=17)
    ap.add_argument('--source', choices=list(SOURCES), default='yandex')
    ap.add_argument('--grid', choices=['snail', 'none'], default='snail')
    # app: squares named like the app without a squad origin (5 km UTM blocks);
    # corner: А1 starts at the picture's north-west corner (set the same А1 in the app).
    ap.add_argument('--origin', choices=['app', 'corner'], default='app')
    ap.add_argument('--name', default='')
    ap.add_argument('--out', default='out')
    a = ap.parse_args()

    lat, lng, view_zoom, final = find_center(a.link)
    size_km = auto_size_km(view_zoom) if a.size_km in ('', 'auto') else float(a.size_km.replace(',', '.'))
    print(f'Центр: {lat:.6f}, {lng:.6f} · масштаб ссылки: {view_zoom} · сторона: {size_km:.2f} км')
    half = size_km * 500
    dlat = half / 111320
    dlng = half / (111320 * math.cos(math.radians(lat)))
    s, n, w, e = lat - dlat, lat + dlat, lng - dlng, lng + dlng

    source = a.source
    for attempt_source in ([source] + [x for x in SOURCES if x != source]):
        _, ellipsoid, attribution = SOURCES[attempt_source]
        z = a.zoom
        while True:
            x0, y0 = world_px(n, w, z, ellipsoid)
            x1, y1 = world_px(s, e, z, ellipsoid)
            if max(x1 - x0, y1 - y0) <= MAX_SIDE or z <= 12:
                break
            z -= 1
        tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
        tiles = fetch_tiles(attempt_source, z, tx0, ty0, tx1, ty1)
        missing = sum(1 for v in tiles.values() if v is None)
        print(f'{attempt_source}: zoom {z}, плиток {len(tiles)}, не скачалось {missing}')
        if missing <= len(tiles) * 0.05:
            source = attempt_source
            break
    else:
        raise SystemExit('Снимок не скачался ни из одного источника.')

    mosaic = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256), (20, 24, 20))
    for (x, y), im in tiles.items():
        if im is not None:
            mosaic.paste(im, ((x - tx0) * 256, (y - ty0) * 256))
    cx0, cy0 = int(round(x0 - tx0 * 256)), int(round(y0 - ty0 * 256))
    cx1, cy1 = int(round(x1 - tx0 * 256)), int(round(y1 - ty0 * 256))
    img = mosaic.crop((cx0, cy0, cx1, cy1))
    # Exact edges of the cropped picture.
    px_w, px_n = tx0 * 256 + cx0, ty0 * 256 + cy0
    px_e, px_s = tx0 * 256 + cx1, ty0 * 256 + cy1
    n_box = lat_of_world_y(px_n, z, ellipsoid)
    s_box = lat_of_world_y(px_s, z, ellipsoid)
    w_box = px_w / (256 * 2 ** z) * 360 - 180
    e_box = px_e / (256 * 2 ** z) * 360 - 180

    def to_px(la, lo):
        X, Y = world_px(la, lo, z, ellipsoid)
        return X - px_w, Y - px_n

    name = a.name.strip() or f'Полигон {lat:.4f} {lng:.4f}'
    note = ''
    origin_mark = None
    if a.grid == 'snail':
        corner = (n_box, w_box) if a.origin == 'corner' else None
        zone, oe, on = draw_snail(img, to_px, lat, lng, (s_box, w_box, n_box, e_box), corner)
        if corner:
            note = (f'Сетка «улитка» 500 м, А1 в левом верхнем углу снимка ({n_box:.6f}, {w_box:.6f}). '
                    'В GrimMap: Сетка → «А1 от перекрестия» на метке «А1».')
            origin_mark = (n_box, w_box)
        else:
            note = f'Сетка «улитка» 500 м по 5-км квадратам UTM {zone}N — как в GrimMap без своего начала.'
    meters_per_px = (size_km * 1000) / img.width
    draw_frame(img, meters_per_px, name, attribution)

    os.makedirs(a.out, exist_ok=True)
    jpg = io.BytesIO()
    img.save(jpg, 'JPEG', quality=84, optimize=True, progressive=True)
    safe = re.sub(r'[^\w\-]+', '_', name, flags=re.UNICODE).strip('_')[:60] or 'tactical'
    mark = ''
    if origin_mark:
        mark = f'''
  <Placemark>
    <name>А1 — начало сетки</name>
    <Point><coordinates>{origin_mark[1]:.7f},{origin_mark[0]:.7f},0</coordinates></Point>
  </Placemark>'''
    kml = f'''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>{name}</name>
  <description>{note} Снимок {attribution}, zoom {z}. Сделано в GrimMap.</description>
  <GroundOverlay>
    <name>{name}</name>
    <drawOrder>1</drawOrder>
    <Icon><href>files/map.jpg</href></Icon>
    <LatLonBox>
      <north>{n_box:.7f}</north>
      <south>{s_box:.7f}</south>
      <east>{e_box:.7f}</east>
      <west>{w_box:.7f}</west>
    </LatLonBox>
  </GroundOverlay>{mark}
</Document>
</kml>
'''
    kmz_path = os.path.join(a.out, f'{safe}.kmz')
    with zipfile.ZipFile(kmz_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('doc.kml', kml)
        zf.writestr('files/map.jpg', jpg.getvalue())
    preview = img.copy()
    preview.thumbnail((1400, 1400))
    preview.save(os.path.join(a.out, f'{safe}.preview.jpg'), 'JPEG', quality=80)
    info = {
        'file': os.path.basename(kmz_path), 'name': name, 'center': [lat, lng], 'sizeKm': size_km,
        'zoom': z, 'source': source, 'pixels': list(img.size), 'bytes': os.path.getsize(kmz_path),
        'box': {'n': n_box, 's': s_box, 'e': e_box, 'w': w_box}, 'link': final,
    }
    with open(os.path.join(a.out, 'info.json'), 'w', encoding='utf-8') as fh:
        json.dump(info, fh, ensure_ascii=False, indent=2)
    print(json.dumps(info, ensure_ascii=False))


if __name__ == '__main__':
    main()
