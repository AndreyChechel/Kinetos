#!/usr/bin/env python3
"""Generate the animated exercise illustrations.

Reads js/data/exercises.json and writes assets/exercises/<id>.svg: a
side-view figure performing the movement in a loop (SMIL <animate>, so no
JS/CSS is needed), equipment drawn in, worked muscles highlighted on the
body (class="muscle-stroke" -> themed accent; secondary muscles fainter),
plus a small front/back muscle map inset (class="ex-map", hidden by the app
in thumbnails). Colours are currentColor, so the art follows the theme.

Poses live in tools/poses.py, the rig in tools/figure.py, equipment in
tools/props.py. Re-run after adding an exercise. An exercise without a pose
entry falls back to a standing figure. Stdlib only.

  python tools/generate_svgs.py                 # write all SVGs
  python tools/generate_svgs.py --frames DIR    # also dump still frames (preview)
  python tools/generate_svgs.py --only id1,id2  # subset
"""
import json
import os
import sys
sys.dont_write_bytecode = True  # keep tools/ free of __pycache__

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import figure  # noqa: E402
from figure import joints, interp, pingpong, figure_prims, assemble  # noqa: E402
from poses import EX, stand  # noqa: E402
from props import floor  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "js", "data", "exercises.json")
OUT = os.path.join(ROOT, "assets", "exercises")
SIZE = 240
FRAMES = 18


# ---- small front/back muscle map (inset) ------------------------------------
MAP_BODY = (
    '<g fill="currentColor" opacity="0.22">'
    '<circle cx="100" cy="42" r="20"/><rect x="92" y="60" width="16" height="12" rx="4"/>'
    '<path d="M66,76 Q64,72 74,72 L126,72 Q136,72 134,76 L128,120 Q124,150 120,152 L122,172 '
    'L78,172 L80,152 Q76,150 72,120 Z"/></g>'
    '<g fill="none" stroke="currentColor" opacity="0.22" stroke-linecap="round" stroke-linejoin="round">'
    '<path stroke-width="17" d="M72,80 L54,120 L48,162 M128,80 L146,120 L152,162"/>'
    '<path stroke-width="21" d="M90,168 L88,228 L90,286 M110,168 L112,228 L110,286"/></g>')

FRONT = [
    ('delts', '<ellipse cx="72" cy="80" rx="12" ry="10"/><ellipse cx="128" cy="80" rx="12" ry="10"/>'),
    ('chest', '<path d="M86,86 Q100,82 100,86 L100,104 Q90,108 82,102 Q80,90 86,86 Z"/>'
              '<path d="M114,86 Q100,82 100,86 L100,104 Q110,108 118,102 Q120,90 114,86 Z"/>'),
    ('biceps', '<ellipse cx="61" cy="99" rx="8" ry="15" transform="rotate(20 61 99)"/>'
               '<ellipse cx="139" cy="99" rx="8" ry="15" transform="rotate(-20 139 99)"/>'),
    ('forearms', '<ellipse cx="51" cy="143" rx="7" ry="15" transform="rotate(12 51 143)"/>'
                 '<ellipse cx="149" cy="143" rx="7" ry="15" transform="rotate(-12 149 143)"/>'),
    ('abs', '<rect x="90" y="108" width="20" height="40" rx="6"/>'),
    ('obliques', '<ellipse cx="82" cy="126" rx="6" ry="16"/><ellipse cx="118" cy="126" rx="6" ry="16"/>'),
    ('quads', '<ellipse cx="89" cy="206" rx="11" ry="30"/><ellipse cx="111" cy="206" rx="11" ry="30"/>'),
    ('calves', '<ellipse cx="89" cy="262" rx="8" ry="20"/><ellipse cx="111" cy="262" rx="8" ry="20"/>'),
]
BACK = [
    ('reardelt', '<ellipse cx="72" cy="80" rx="12" ry="10"/><ellipse cx="128" cy="80" rx="12" ry="10"/>'),
    ('traps', '<path d="M86,74 L114,74 L104,100 L96,100 Z"/>'),
    ('lats', '<path d="M82,96 L96,100 L98,142 L84,132 Z"/><path d="M118,96 L104,100 L102,142 L116,132 Z"/>'),
    ('triceps', '<ellipse cx="61" cy="99" rx="8" ry="15" transform="rotate(20 61 99)"/>'
                '<ellipse cx="139" cy="99" rx="8" ry="15" transform="rotate(-20 139 99)"/>'),
    ('lowerback', '<rect x="90" y="134" width="20" height="22" rx="5"/>'),
    ('glutes', '<ellipse cx="91" cy="172" rx="12" ry="12"/><ellipse cx="109" cy="172" rx="12" ry="12"/>'),
    ('hamstrings', '<ellipse cx="89" cy="212" rx="11" ry="26"/><ellipse cx="111" cy="212" rx="11" ry="26"/>'),
    ('calves', '<ellipse cx="89" cy="264" rx="8" ry="20"/><ellipse cx="111" cy="264" rx="8" ry="20"/>'),
]


def muscle_map(view, primary, secondary):
    parts = []
    for m, shapes in (FRONT if view == 'front' else BACK):
        if m in primary:
            parts.append(f'<g class="muscle-fill" fill="#ff7a3c">{shapes}</g>')
        elif m in secondary:
            parts.append(f'<g class="muscle-fill" fill="#ff7a3c" opacity="0.5">{shapes}</g>')
        else:
            parts.append(f'<g fill="currentColor" opacity="0.3">{shapes}</g>')
    return ('<g class="ex-map" transform="translate(6,6) scale(0.2)">'
            + MAP_BODY + ''.join(parts) + '</g>')


# ---- animation ---------------------------------------------------------------

def pose_at(spec, t):
    if 'cycle' in spec:
        return spec['cycle'](t)
    if 'b' not in spec:
        return spec['a']
    return interp(spec['a'], spec['b'], pingpong(t, spec.get('hold', 0.08)))


def frame_prims(spec, t, primary, secondary):
    P = joints(pose_at(spec, t))
    P['_t'] = t
    prims = figure_prims(P, primary, secondary)
    for prop in spec.get('props', []):
        prims += prop(P)
    return prims


def build(ex, frames_dir=None):
    spec = EX.get(ex['id']) or dict(a=stand(), props=[floor()])
    primary = list(ex.get('primary', []))
    secondary = [m for m in ex.get('secondary', []) if m not in primary]
    still = 'b' not in spec and 'cycle' not in spec
    n = 1 if still else spec.get('frames', FRAMES)
    frames = [frame_prims(spec, k / n, primary, secondary) for k in range(n)]
    name = ex['names'].get('en', ex['id'])
    head = (f'<svg viewBox="0 0 {SIZE} {SIZE}" xmlns="http://www.w3.org/2000/svg" '
            f'role="img" aria-label="{name}"><title>{name}</title>')
    inset = muscle_map(ex.get('view', 'front'), primary, secondary)
    body = assemble(frames, spec.get('dur', 2.6))
    z = spec.get('zoom')
    if z:  # shrink toward the bottom centre so tall moves fit
        tr = f'<g transform="translate({120 * (1 - z):.1f},{226 * (1 - z):.1f}) scale({z})">'
        body = tr + body + '</g>'
    svg = head + '\n' + body + '\n' + inset + '\n</svg>\n'
    if frames_dir:
        os.makedirs(frames_dir, exist_ok=True)
        picks = sorted(set([0, n // 4, n // 2, (3 * n) // 4])) if n > 1 else [0]
        for k in picks:
            fb = assemble([frames[k]], 1)
            if z:
                fb = tr + fb + '</g>'
            with open(os.path.join(frames_dir, f"{ex['id']}__{k:02d}.svg"), 'w', encoding='utf-8') as f:
                f.write(head + fb + inset + '</svg>')
    return svg


def main():
    args = sys.argv[1:]
    frames_dir = args[args.index('--frames') + 1] if '--frames' in args else None
    only = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
    os.makedirs(OUT, exist_ok=True)
    with open(DATA, encoding="utf-8") as f:
        exercises = json.load(f)
    missing = [e['id'] for e in exercises if e['id'] not in EX]
    count = 0
    for ex in exercises:
        if only and ex['id'] not in only:
            continue
        svg = build(ex, frames_dir)
        with open(os.path.join(OUT, ex["id"] + ".svg"), "w", encoding="utf-8") as f:
            f.write(svg)
        count += 1
    print(f"Generated {count} SVGs into {OUT}")
    if missing:
        print(f"No pose for {len(missing)} (standing fallback): {', '.join(missing)}")


if __name__ == "__main__":
    main()
