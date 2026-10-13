#!/usr/bin/env python3
"""Board's welcome media (web/board/assets/welcome/), made here so nothing is borrowed:

  nebula.mp4   an 8-second seamless loop: a slow magenta/violet nebula, a glowing planet with a
               ring, and stars that twinkle (the loop's last frame flows into its first)
  nebula.webp  a still of the same sky, for the picture card
  chime.mp3    a calm D-major chime with a soft echo (made with ffmpeg's aevalsrc)

Run:  python3 scripts/make-board-welcome.py   (needs numpy, Pillow and ffmpeg)
"""
import math
import os
import subprocess
import tempfile

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "board", "assets", "welcome")
W, H, FPS, SECONDS = 640, 360, 24, 8
rng = np.random.default_rng(7)

# The sky's fixed parts
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
STARS = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(0.4, 1.4), rng.uniform(0, 2 * math.pi), rng.integers(1, 3)) for _ in range(140)]


def sky(phase, w=W, h=H, x=None, y=None):
    """One picture of the sky at `phase` (0..1 round the loop)."""
    x = xx if x is None else x
    y = yy if y is None else y
    p = 2 * math.pi * phase
    sx, sy = w / 640, h / 360
    # Nebula: soft overlapping waves in the Nova colours, drifting round the loop
    a = 0.5 + 0.5 * np.sin(x / (110 * sx) + np.sin(y / (90 * sy) + p))
    b = 0.5 + 0.5 * np.cos(x / (160 * sx) - y / (130 * sy) + p)
    c = 0.5 + 0.5 * np.sin(y / (70 * sy) - p + x / (300 * sx))
    r = 18 + 150 * a**2 + 40 * c**3
    g = 6 + 22 * c**3 + 12 * a
    bl = 40 + 120 * b**2 + 40 * a
    # A glow that circles slowly
    gx, gy = w * (0.55 + 0.18 * math.cos(p)), h * (0.48 + 0.12 * math.sin(p))
    glow = np.exp(-((x - gx) ** 2 + (y - gy) ** 2) / (9000 * sx * sy))
    r += 110 * glow
    g += 50 * glow
    bl += 60 * glow
    # The planet, with a ring, gently bobbing
    px, py, pr = w * 0.30, h * (0.55 + 0.02 * math.sin(p)), 52 * sx
    d = np.sqrt((x - px) ** 2 + (y - py) ** 2)
    disc = np.clip((pr - d) / 2.0, 0, 1)
    shade = np.clip(0.35 + 0.65 * ((px - x) * 0.6 + (py - y) * 0.8) / pr, 0, 1)
    band = 0.5 + 0.5 * np.sin((y - py) / (6 * sy) + p)
    r = r * (1 - disc) + disc * (120 + 110 * shade + 20 * band)
    g = g * (1 - disc) + disc * (30 + 60 * shade)
    bl = bl * (1 - disc) + disc * (110 + 90 * shade - 30 * band)
    ring = np.exp(-(((x - px) / (2.3 * pr)) ** 2 + ((y - py) / (0.42 * pr)) ** 2 - 1) ** 2 * 18)
    front = (y > py) | (d > pr)
    k = ring * front * 0.8
    r = r * (1 - k) + k * 255
    g = g * (1 - k) + k * 170
    bl = bl * (1 - k) + k * 220
    img = np.stack([r, g, bl], axis=-1)
    # Stars that twinkle (each on its own beat, whole cycles round the loop)
    for (sx0, sy0, size, ph, beats) in STARS:
        tw = 0.55 + 0.45 * math.sin(p * beats + ph)
        cx, cy = sx0 * w / W, sy0 * h / H
        x0, x1 = int(max(cx - 4, 0)), int(min(cx + 5, w))
        y0, y1 = int(max(cy - 4, 0)), int(min(cy + 5, h))
        if x0 >= x1 or y0 >= y1:
            continue
        pxs, pys = x[y0:y1, x0:x1], y[y0:y1, x0:x1]
        spot = np.exp(-((pxs - cx) ** 2 + (pys - cy) ** 2) / (size * size)) * tw * 255
        img[y0:y1, x0:x1] += spot[..., None] * np.array([1.0, 0.92, 1.0])
    return np.clip(img, 0, 255).astype(np.uint8)


def main():
    os.makedirs(OUT, exist_ok=True)
    frames = FPS * SECONDS
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(frames):
            Image.fromarray(sky(i / frames)).save(os.path.join(tmp, f"f{i:04d}.png"))
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(FPS), "-i", os.path.join(tmp, "f%04d.png"),
                        "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
                        os.path.join(OUT, "nebula.mp4")], check=True)
    # The still: the same sky, bigger
    bw, bh = 1200, 675
    by, bx = np.mgrid[0:bh, 0:bw].astype(np.float32)
    Image.fromarray(sky(0.2, bw, bh, bx, by)).save(os.path.join(OUT, "nebula.webp"), quality=82)
    chord = "+".join(f"{amp}*sin(2*PI*{f}*t+{ph})" for f, amp, ph in [(293.66, 0.16, 0), (369.99, 0.12, 0.2), (440.0, 0.10, 0.4), (587.33, 0.05, 0.1)])
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", f"aevalsrc=({chord})*min(1\\,t/1.2)*exp(-t/2.6):s=44100:d=7",
                    "-af", "aecho=0.8:0.7:420|780:0.35|0.22,afade=t=out:st=5.5:d=1.5,volume=0.8,pan=stereo|c0=c0|c1=c0",
                    "-c:a", "libmp3lame", "-b:a", "96k", os.path.join(OUT, "chime.mp3")], check=True)


if __name__ == "__main__":
    main()
