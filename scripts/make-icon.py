"""
Genera build/icon.png (512x512) sin dependencias externas.
Renderiza a 4x y reduce por promedio para tener bordes suaves.
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "build" / "icon.png"
SIZE = 512
SS = 4                      # supermuestreo
N = SIZE * SS

CYAN = (0x22, 0xd3, 0xee)
VIOLET = (0xa7, 0x8b, 0xfa)
BG_TOP = (0x1a, 0x20, 0x33)
BG_BOT = (0x08, 0x09, 0x0d)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def rounded_rect(x, y, x0, y0, x1, y1, r):
    """Distancia con signo: <=0 dentro de la forma."""
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    if x0 + r <= x <= x1 - r or y0 + r <= y <= y1 - r:
        outside = max(x0 - x, x - x1, y0 - y, y - y1)
        if outside <= 0:
            return outside
    return d - r


def build():
    # Marco exterior
    pad = N * 0.055
    radius = N * 0.235

    # Barras: analítica. Alturas crecientes, la última con nodo encima.
    bar_w = N * 0.115
    gap = N * 0.075
    total_w = bar_w * 3 + gap * 2
    bx0 = (N - total_w) / 2
    base_y = N * 0.735
    heights = [N * 0.20, N * 0.31, N * 0.42]
    bar_r = bar_w * 0.42

    dot_r = N * 0.072
    dot_cx = bx0 + bar_w * 2 + gap * 2 + bar_w / 2
    dot_cy = base_y - heights[2] - N * 0.115

    rows = []
    for py in range(N):
        row = bytearray()
        y = py + 0.5
        for px in range(N):
            x = px + 0.5

            d_bg = rounded_rect(x, y, pad, pad, N - pad, N - pad, radius)
            if d_bg > 1.5:
                row += b"\x00\x00\x00\x00"
                continue

            # Fondo con degradado diagonal
            t = (x + y) / (2 * N)
            r, g, b = mix(BG_TOP, BG_BOT, min(1.0, t * 1.25))
            a = 255.0

            # Borde luminoso muy tenue
            edge = 1.0 - min(1.0, abs(d_bg) / (N * 0.012))
            if d_bg < 0 and edge > 0:
                r, g, b = mix((r, g, b), (0x2e, 0x3a, 0x55), edge * 0.55)

            # Antialias del contorno exterior
            if d_bg > -1.5:
                a = 255.0 * max(0.0, min(1.0, (1.5 - d_bg) / 3.0))

            # Barras
            for i, h in enumerate(heights):
                x0 = bx0 + i * (bar_w + gap)
                d = rounded_rect(x, y, x0, base_y - h, x0 + bar_w, base_y, bar_r)
                if d < 1.0:
                    cov = max(0.0, min(1.0, (1.0 - d) / 2.0))
                    tx = (x - bx0) / total_w
                    bar_col = mix(CYAN, VIOLET, max(0.0, min(1.0, tx)))
                    # Un punto más claro arriba da sensación de volumen
                    shade = 1.0 - 0.25 * ((y - (base_y - h)) / max(h, 1))
                    bar_col = tuple(min(255, c * shade) for c in bar_col)
                    r, g, b = mix((r, g, b), bar_col, cov)

            # Nodo violeta sobre la barra más alta
            dd = math.hypot(x - dot_cx, y - dot_cy) - dot_r
            if dd < 1.0:
                cov = max(0.0, min(1.0, (1.0 - dd) / 2.0))
                r, g, b = mix((r, g, b), VIOLET, cov)

            row += bytes((int(r), int(g), int(b), int(a)))
        rows.append(bytes(row))
    return rows


def downsample(rows):
    out = []
    for oy in range(SIZE):
        line = bytearray()
        for ox in range(SIZE):
            rt = gt = bt = at = 0
            for sy in range(SS):
                src = rows[oy * SS + sy]
                base = (ox * SS) * 4
                for sx in range(SS):
                    o = base + sx * 4
                    al = src[o + 3]
                    rt += src[o] * al
                    gt += src[o + 1] * al
                    bt += src[o + 2] * al
                    at += al
            n = SS * SS
            if at == 0:
                line += b"\x00\x00\x00\x00"
            else:
                line += bytes((rt // at, gt // at, bt // at, at // n))
        out.append(bytes(line))
    return out


def write_png(path, rows):
    raw = b"".join(b"\x00" + r for r in rows)
    comp = zlib.compress(raw, 9)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", comp)
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


if __name__ == "__main__":
    write_png(OUT, downsample(build()))
    print(f"icono escrito en {OUT} ({OUT.stat().st_size} bytes)")
