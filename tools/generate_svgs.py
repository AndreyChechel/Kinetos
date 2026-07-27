#!/usr/bin/env python3
"""Generate muscle-map style SVG illustrations for every exercise.

Reads js/data/exercises.json and writes assets/exercises/<id>.svg.
Style: a solid body silhouette (uses CSS `currentColor`) with the target
muscles highlighted (class="muscle-fill" -> themed accent) plus a small
equipment badge. SVGs are injected inline by the app, so they adapt to the
light/dark theme automatically.

Re-run this whenever you add exercises. Requires only the Python stdlib.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "js", "data", "exercises.json")
OUT = os.path.join(ROOT, "assets", "exercises")

W, H = 200, 300

# --- Solid body silhouette (front & back share the same outline) ---
BODY = """
  <g fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-opacity="0.16">
    <circle cx="100" cy="42" r="20"/>
    <rect x="92" y="60" width="16" height="12" rx="4"/>
    <path d="M66,76 Q64,72 74,72 L126,72 Q136,72 134,76 L128,120 Q124,150 120,152 L122,172 L78,172 L80,152 Q76,150 72,120 Z"/>
  </g>
  <g fill="none" stroke="currentColor" stroke-opacity="0.16" stroke-width="17" stroke-linecap="round" stroke-linejoin="round">
    <path d="M72,80 L54,120 L48,162"/>
    <path d="M128,80 L146,120 L152,162"/>
  </g>
  <g fill="none" stroke="currentColor" stroke-opacity="0.16" stroke-width="21" stroke-linecap="round" stroke-linejoin="round">
    <path d="M90,168 L88,228 L90,286"/>
    <path d="M110,168 L112,228 L110,286"/>
  </g>
"""

def m(active):
    """Return fill attributes for a muscle overlay shape."""
    if active:
        return 'class="muscle-fill"'
    return 'fill="currentColor" fill-opacity="0.30"'

def front_overlays(targets):
    t = set(targets)
    s = []
    # shoulders / delts
    s.append(f'<ellipse cx="72" cy="80" rx="12" ry="10" {m("delts" in t)}/>')
    s.append(f'<ellipse cx="128" cy="80" rx="12" ry="10" {m("delts" in t)}/>')
    # chest
    s.append(f'<path d="M86,86 Q100,82 100,86 L100,104 Q90,108 82,102 Q80,90 86,86 Z" {m("chest" in t)}/>')
    s.append(f'<path d="M114,86 Q100,82 100,86 L100,104 Q110,108 118,102 Q120,90 114,86 Z" {m("chest" in t)}/>')
    # biceps
    s.append(f'<ellipse cx="61" cy="99" rx="8" ry="15" transform="rotate(20 61 99)" {m("biceps" in t)}/>')
    s.append(f'<ellipse cx="139" cy="99" rx="8" ry="15" transform="rotate(-20 139 99)" {m("biceps" in t)}/>')
    # forearms
    s.append(f'<ellipse cx="51" cy="143" rx="7" ry="15" transform="rotate(12 51 143)" {m("forearms" in t)}/>')
    s.append(f'<ellipse cx="149" cy="143" rx="7" ry="15" transform="rotate(-12 149 143)" {m("forearms" in t)}/>')
    # abs
    s.append(f'<rect x="90" y="108" width="20" height="40" rx="6" {m("abs" in t)}/>')
    # obliques
    s.append(f'<ellipse cx="82" cy="126" rx="6" ry="16" {m("obliques" in t)}/>')
    s.append(f'<ellipse cx="118" cy="126" rx="6" ry="16" {m("obliques" in t)}/>')
    # quads
    s.append(f'<ellipse cx="89" cy="206" rx="11" ry="30" {m("quads" in t)}/>')
    s.append(f'<ellipse cx="111" cy="206" rx="11" ry="30" {m("quads" in t)}/>')
    # calves (front-view, used for jump rope etc.)
    s.append(f'<ellipse cx="89" cy="262" rx="8" ry="20" {m("calves" in t)}/>')
    s.append(f'<ellipse cx="111" cy="262" rx="8" ry="20" {m("calves" in t)}/>')
    return "\n    ".join(s)

def back_overlays(targets):
    t = set(targets)
    s = []
    # rear delts
    s.append(f'<ellipse cx="72" cy="80" rx="12" ry="10" {m("reardelt" in t)}/>')
    s.append(f'<ellipse cx="128" cy="80" rx="12" ry="10" {m("reardelt" in t)}/>')
    # traps
    s.append(f'<path d="M86,74 L114,74 L104,100 L96,100 Z" {m("traps" in t)}/>')
    # lats
    s.append(f'<path d="M82,96 L96,100 L98,142 L84,132 Z" {m("lats" in t)}/>')
    s.append(f'<path d="M118,96 L104,100 L102,142 L116,132 Z" {m("lats" in t)}/>')
    # triceps
    s.append(f'<ellipse cx="61" cy="99" rx="8" ry="15" transform="rotate(20 61 99)" {m("triceps" in t)}/>')
    s.append(f'<ellipse cx="139" cy="99" rx="8" ry="15" transform="rotate(-20 139 99)" {m("triceps" in t)}/>')
    # lower back
    s.append(f'<rect x="90" y="134" width="20" height="22" rx="5" {m("lowerback" in t)}/>')
    # glutes
    s.append(f'<ellipse cx="91" cy="172" rx="12" ry="12" {m("glutes" in t)}/>')
    s.append(f'<ellipse cx="109" cy="172" rx="12" ry="12" {m("glutes" in t)}/>')
    # hamstrings
    s.append(f'<ellipse cx="89" cy="212" rx="11" ry="26" {m("hamstrings" in t)}/>')
    s.append(f'<ellipse cx="111" cy="212" rx="11" ry="26" {m("hamstrings" in t)}/>')
    # calves
    s.append(f'<ellipse cx="89" cy="264" rx="8" ry="20" {m("calves" in t)}/>')
    s.append(f'<ellipse cx="111" cy="264" rx="8" ry="20" {m("calves" in t)}/>')
    return "\n    ".join(s)

def equipment_badge(equip):
    glyphs = {
        "barbell": '<line x1="6" y1="20" x2="34" y2="20"/><rect x="4" y="13" width="6" height="14" rx="2"/><rect x="30" y="13" width="6" height="14" rx="2"/><rect x="10" y="16" width="4" height="8" rx="1"/><rect x="26" y="16" width="4" height="8" rx="1"/>',
        "dumbbell": '<line x1="12" y1="20" x2="28" y2="20"/><rect x="6" y="12" width="8" height="16" rx="2"/><rect x="26" y="12" width="8" height="16" rx="2"/>',
        "cable": '<circle cx="20" cy="10" r="5"/><line x1="20" y1="15" x2="20" y2="28"/><path d="M14,28 h12" /><path d="M17,28 v4 M23,28 v4"/>',
        "machine": '<rect x="7" y="7" width="26" height="26" rx="3"/><line x1="14" y1="7" x2="14" y2="33"/><circle cx="24" cy="16" r="3"/>',
        "bodyweight": '<circle cx="20" cy="11" r="4"/><path d="M20,15 v10 M20,18 l-7,-3 M20,18 l7,-3 M20,25 l-6,8 M20,25 l6,8"/>',
        "cardio": '<path d="M20,31 C6,22 8,10 15,10 C19,10 20,13 20,13 C20,13 21,10 25,10 C32,10 34,22 20,31 Z"/>',
    }
    g = glyphs.get(equip, glyphs["machine"])
    return f"""
  <g transform="translate(150,8)">
    <rect x="0" y="0" width="40" height="40" rx="11" fill="currentColor" fill-opacity="0.10"/>
    <g transform="translate(0,0)" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {g}
    </g>
  </g>"""

def build(ex):
    view = ex.get("view", "front")
    targets = list(ex.get("primary", [])) + list(ex.get("secondary", []))
    overlays = front_overlays(targets) if view == "front" else back_overlays(targets)
    badge = equipment_badge(ex.get("equipment", "machine"))
    name = ex["names"].get("en", ex["id"])
    return f"""<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{name}">
  <title>{name}</title>
{BODY}
  <g>
    {overlays}
  </g>{badge}
</svg>
"""

def main():
    os.makedirs(OUT, exist_ok=True)
    with open(DATA, encoding="utf-8") as f:
        exercises = json.load(f)
    for ex in exercises:
        svg = build(ex)
        with open(os.path.join(OUT, ex["id"] + ".svg"), "w", encoding="utf-8") as f:
            f.write(svg)
    print(f"Generated {len(exercises)} SVGs into {OUT}")

if __name__ == "__main__":
    main()
