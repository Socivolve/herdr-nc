#!/usr/bin/env python3
"""Readability gate for our Herdr themes: WCAG contrast of the colour pairs that matter.

Usage: scripts/contrast.py themes/nc-x.json [...]   (exit 1 if a rule fails)
"""
import json
import sys


def lum(hex_colour):
    c = hex_colour.lstrip("#")
    ch = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ch = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


# (foreground token, background tokens, minimum, maximum or None)
RULES = [
    ("foreground", ["background", "chrome", "surface"], 12, None),
    ("muted", ["background", "chrome", "surface"], 5, None),
    ("dim", ["chrome"], 3, None),
    ("accent", ["canvas", "chrome"], 4.5, None),
    ("accent_foreground", ["accent"], 4.5, None),
    ("solid_foreground", ["solid"], 7, None),
    ("working", ["chrome", "surface"], 4.5, None),
    ("blocked", ["chrome", "surface"], 4.5, None),
    ("done", ["chrome", "surface"], 4.5, None),
    ("unknown", ["chrome", "surface"], 4.5, None),
    ("idle", ["chrome"], 3.5, None),
    ("foreground", ["selection"], 7, None),
    ("cursor", ["background"], 4.5, None),
    ("border", ["canvas", "chrome"], 1.25, 1.9),
] + [(f"ansi{i}", ["background"], 4.5, None) for i in (1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14)] + [
    ("ansi8", ["background"], 3.2, None),
]
# Black and white swap roles: on a dark terminal "white" is text and "black" a subtle
# fill; on a light terminal "black" is text and "white" a subtle fill.
DARK_ONLY = [("ansi7", ["background"], 4.5, None), ("ansi15", ["background"], 4.5, None),
             ("ansi0", ["background"], 1.3, 2.5)]
LIGHT_ONLY = [("ansi0", ["background"], 4.5, None), ("ansi7", ["background"], 1.1, 2.5)]


def check(path):
    t = json.load(open(path))
    c = dict(t.get("colors", {}))
    for k in ("background", "foreground", "selection", "cursor"):
        c.setdefault(k, t.get(k))
    for i, v in enumerate(t["ansi"]):
        c[f"ansi{i}"] = v
    fails = []
    light = lum(c["background"]) > 0.5
    for fg, bgs, lo, hi in RULES + (LIGHT_ONLY if light else DARK_ONLY):
        for bg in bgs:
            if not c.get(fg) or not c.get(bg):
                fails.append(f"{fg} on {bg}: colour missing")
                continue
            r = ratio(c[fg], c[bg])
            if r < lo or (hi is not None and r > hi):
                want = f">= {lo}" if hi is None else f"{lo}-{hi}"
                fails.append(f"{fg} on {bg}: {r:.2f} (wants {want})")
    return fails


if __name__ == "__main__":
    bad = False
    for p in sys.argv[1:]:
        for f in check(p):
            print(f"FAIL {p}: {f}")
            bad = True
    sys.exit(1 if bad else 0)
