"""Equipment-setup diagrams (assets/setup/<id>.svg), built by generate_svgs.py.

A setup diagram is a STILL: the configured equipment drawn solid, a faint
"ghost" figure in the start position for scale, and accent annotations:
numbered badges (1, 2, 3 ... matching the numbered `setup` steps in
exercises.json), angle arcs ("30°"), adjust arrows and a round close-up inset
of the cable attachment. Nothing in the picture is language-specific (only
digits and degrees), so the wording lives entirely in the localized steps.

SETUP[id] = dict(
    pose=...,      # figure pose (default: EX[id]['a'], the animation's start)
    props=[...],   # equipment (default: EX[id]['props'])
    extra=[...],   # extra equipment drawn on top of `props`
    ann=[...],     # annotation fns P -> svg string
    zoom=...,      # optional, like the animations
)
The number of distinct badges must equal the number of setup steps in every
language (generate_svgs.py checks it).
"""
import math
from figure import FLOOR, joints, vec, add, sub, mul, f1, seg_d
from props import line, poly, floor, bench, plate, dumbbell, cable, handle, stack, pad, dot, custom
from poses import EX, G, stand, lying, plank_pose, tp, J, rails, box, incline_bench, _unit_perp, LIE_HIP

ACC = '#ff7a3c'
FONT = 'font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"'


# ---- annotation primitives ---------------------------------------------------
def _xy(P, p):
    return p(P) if callable(p) else (P[p] if isinstance(p, str) else p)


def badge(n, at, to=None):
    """Numbered accent disc at `at`, with an optional leader line to `to`."""
    def f(P):
        a = _xy(P, at)
        out = ''
        if to is not None:
            b = _xy(P, to)
            out += (f'<path class="muscle-stroke" stroke="{ACC}" stroke-width="1.6" fill="none" '
                    f'stroke-dasharray="3 2.5" d="{seg_d(a, b)}"/>'
                    f'<circle class="muscle-fill" fill="{ACC}" cx="{f1(b[0])}" cy="{f1(b[1])}" r="2.6"/>')
        out += (f'<circle class="muscle-fill" fill="{ACC}" cx="{f1(a[0])}" cy="{f1(a[1])}" r="8.5"/>'
                f'<text x="{f1(a[0])}" y="{f1(a[1])}" dy=".36em" text-anchor="middle" font-size="11" '
                f'font-weight="700" fill="#fff" {FONT}>{n}</text>')
        return out
    f.badge = n
    return f


def angle(vertex, a0, a1, r=26, label=None, lr=None, n=None, bdx=20):
    """Arc between absolute angles a0 -> a1 (degrees, SVG convention) at
    `vertex`, plus a label (default: the angle in degrees) and optionally a
    numbered badge right next to the label."""
    def f(P):
        v = _xy(P, vertex)
        p0, p1 = add(v, vec(a0, r)), add(v, vec(a1, r))
        sweep = 1 if (a1 - a0) % 360 < 180 else 0
        txt = label if label is not None else f'{round(abs(a1 - a0))}°'
        lp = add(v, vec((a0 + a1) / 2, lr or r + 12))
        return (f'<path class="muscle-stroke" stroke="{ACC}" stroke-width="1.8" fill="none" '
                f'd="M{f1(p0[0])},{f1(p0[1])} A{r},{r} 0 0 {sweep} {f1(p1[0])},{f1(p1[1])}"/>'
                f'<path class="muscle-stroke" stroke="{ACC}" stroke-width="1.2" fill="none" stroke-dasharray="2 2" '
                f'd="{seg_d(v, add(v, vec(a0, r + 6)))}"/>'
                f'<text class="muscle-fill" fill="{ACC}" x="{f1(lp[0])}" y="{f1(lp[1])}" dy=".36em" '
                f'text-anchor="middle" font-size="11" font-weight="700" {FONT}>{txt}</text>'
                + (badge(n, add(lp, (bdx, 0)))(P) if n is not None else ''))
    if n is not None:
        f.badge = n
    return f


def label(at, text, size=12):
    """Plain accent text (digits / degrees only — no words)."""
    def f(P):
        c = _xy(P, at)
        return (f'<text class="muscle-fill" fill="{ACC}" x="{f1(c[0])}" y="{f1(c[1])}" dy=".36em" '
                f'text-anchor="middle" font-size="{size}" font-weight="700" {FONT}>{text}</text>')
    return f


def stop(at, axis, half=6):
    """Short solid tick across a rail/post at `at` (a stop / safety pin);
    `axis` is the rail direction in degrees."""
    def f(P):
        c = _xy(P, at)
        a, b = add(c, vec(axis + 90, half)), add(c, vec(axis + 90, -half))
        return (f'<path class="muscle-stroke" stroke="{ACC}" stroke-width="3.5" stroke-linecap="round" '
                f'fill="none" d="{seg_d(a, b)}"/>')
    return f


def adjust(at, axis=90, size=11):
    """Double-headed arrow: 'this slides / adjusts' along `axis` degrees."""
    def f(P):
        c = _xy(P, at)
        a, b = add(c, vec(axis, -size)), add(c, vec(axis, size))
        heads = ''
        for tip, d in ((a, axis + 180), (b, axis)):
            l, r = add(tip, vec(d + 150, 5)), add(tip, vec(d - 150, 5))
            heads += f' M{f1(l[0])},{f1(l[1])} L{f1(tip[0])},{f1(tip[1])} L{f1(r[0])},{f1(r[1])}'
        return (f'<path class="muscle-stroke" stroke="{ACC}" stroke-width="2" fill="none" '
                f'stroke-linecap="round" stroke-linejoin="round" d="{seg_d(a, b)}{heads}"/>')
    return f


def ring(at, r=7):
    """Accent ring highlighting a point (pulley, pivot, hook)."""
    def f(P):
        c = _xy(P, at)
        return (f'<circle class="muscle-stroke" stroke="{ACC}" stroke-width="2" fill="none" '
                f'cx="{f1(c[0])}" cy="{f1(c[1])}" r="{r}"/>')
    return f


def level(at, x0, x1):
    """Dashed horizontal line through the y of point `at`."""
    def f(P):
        y = _xy(P, at)[1]
        return (f'<path class="muscle-stroke" stroke="{ACC}" stroke-width="1.4" fill="none" '
                f'stroke-dasharray="4 3" d="{seg_d((x0, y), (x1, y))}"/>')
    return f


# ---- attachment close-ups (round inset, top-left) ----------------------------
_ATT = {
    # D-handle (stirrup)
    'd': '<path d="M-8,-12 L8,-12 M0,-12 L0,-18 M-10,-10 L-4,10 L4,10 L10,-10" stroke-width="3"/>'
         '<path d="M-5,10 L5,10" stroke-width="6"/><circle cx="0" cy="-20" r="3" stroke-width="2"/>',
    # rope with stopper knobs
    'rope': '<circle cx="0" cy="-18" r="3" stroke-width="2"/>'
            '<path d="M0,-15 Q-3,-2 -9,12 M0,-15 Q3,-2 9,12" stroke-width="3.5"/>'
            '<circle cx="-9" cy="14" r="3.6" fill="currentColor"/><circle cx="9" cy="14" r="3.6" fill="currentColor"/>',
    # V-handle (close grip row)
    'v': '<circle cx="0" cy="-18" r="3" stroke-width="2"/><path d="M0,-15 L0,-6 M0,-6 L-12,8 M0,-6 L12,8" stroke-width="3"/>'
         '<path d="M-15,6 L-9,12 M15,6 L9,12" stroke-width="5"/>',
    # straight bar
    'bar': '<circle cx="0" cy="-12" r="3" stroke-width="2"/><path d="M0,-9 L0,-2" stroke-width="2"/>'
           '<path d="M-19,0 L19,0" stroke-width="4.5"/>',
    # long lat bar with bent ends
    'lat': '<circle cx="0" cy="-12" r="3" stroke-width="2"/><path d="M0,-9 L0,-3" stroke-width="2"/>'
           '<path d="M-20,6 L-15,-2 L15,-2 L20,6" stroke-width="4"/>',
    # EZ bar
    'ez': '<path d="M-21,0 L-12,0 L-8,-4 L-4,4 L4,4 L8,-4 L12,0 L21,0" stroke-width="3.5"/>'
          '<rect x="-24" y="-7" width="4" height="14" fill="currentColor" stroke="none"/>'
          '<rect x="20" y="-7" width="4" height="14" fill="currentColor" stroke="none"/>',
}


def inset(kind, n=None, cx=30, cy=30, r=24):
    """Round close-up of a cable attachment / bar, optionally badged."""
    def f(P):
        s = (f'<g transform="translate({cx},{cy})">'
             f'<circle r="{r}" fill="currentColor" opacity=".07"/>'
             f'<circle class="muscle-stroke" r="{r}" fill="none" stroke="{ACC}" stroke-width="1.6"/>'
             f'<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">{_ATT[kind]}</g></g>')
        if n is not None:
            s += badge(n, (cx + r * .72, cy + r * .72))(P)
        return s
    if n is not None:
        f.badge = n
    return f


# ---- extra equipment -------------------------------------------------------
def rack(x, hook_y, safety_y=None, top=40):
    """Squat-rack upright seen from the side: post, J-hook, safety arm."""
    def f(P):
        out = [(0, 'eq', 'path', {'stroke-width': 6}, {'d': seg_d((x, top), (x, FLOOR))}),
               (0, 'eq', 'path', {'stroke-width': 4}, {'d': f'M{x},{hook_y + 6} h9 v-9'})]
        if safety_y is not None:
            out.append((0, 'eq', 'path', {'stroke-width': 5}, {'d': seg_d((x - 34, safety_y), (x + 34, safety_y))}))
        return out
    return f


def barbell_side(c, r=16):
    """Barbell end-on (plate + collar) at a fixed point."""
    return plate(lambda P: c, r=r, layer=0.5)


# ---- the diagrams --------------------------------------------------------------
SETUP = {}

# ---------------------------------------------------------------- cable
_cx = EX['cable-crossover']['a']
SETUP['cable-crossover'] = dict(
    ann=[ring((214, 50)), ring((26, 50)), adjust((214, 74)), adjust((26, 74)),
         badge(1, (196, 30), (214, 50)),
         inset('d', 2, cx=30, cy=124 - 4),
         badge(3, (120, 236 - 8))],
)
# stance hint: centred between the columns (badge 3 sits on the floor)

SETUP['face-pull'] = dict(
    ann=[ring((214, 66)), adjust((224, 66 - 26)),
         badge(1, (200, 40), (214, 66)),
         level((214, 66), 60, 210),
         inset('rope', 2),
         badge(3, (60, 200), lambda P: P['toe'])],
)

SETUP['tricep-pushdown'] = dict(
    ann=[ring((174, 22)), badge(1, (154, 18), (174, 22)),
         inset('bar', 2, cx=30, cy=34),
         badge(3, (70, 210), lambda P: P['toe'])],
)

SETUP['cable-pullover'] = dict(
    ann=[ring((214, 22)), badge(1, (194, 16), (214, 22)),
         inset('bar', 2, cx=30, cy=96),
         badge(3, (40, 216), lambda P: P['toe'])],
)

SETUP['cable-woodchop'] = dict(
    ann=[ring((214, 30)), badge(1, (196, 16), (214, 30)), adjust((226, 56)),
         inset('d', 2, cx=30, cy=40),
         badge(3, (60, 214), lambda P: P['ankle2'])],
)

SETUP['seated-cable-row'] = dict(
    ann=[ring((208, 182)), badge(1, (200, 150), (208, 182)),
         inset('v', 2, cx=30, cy=40),
         badge(3, (150, 214), (164, 196))],
)

# lat pulldown: side view (the animation is from behind)
_lpd = dict(torso=-88, head=-4, leg=(-4, 94, 0), arm={'to': (128, 30), 'bend': 'down'}, at=('hip', (100, 160)))
_lpk = J(_lpd, 'knee')
_lpp = (_lpk[0] - 6, _lpk[1] - 17)                 # thigh pad centre
SETUP['lat-pulldown'] = dict(
    pose=_lpd,
    props=[floor(), stack(214, 14),
           line((70, 178), (128, 178), 9, 0, 'eq'), line((100, 182), (100, FLOOR), 5, 0, 'eqs'),
           line((_lpp[0] + 16, _lpp[1]), (_lpp[0] + 16, FLOOR), 5, 0, 'eqs'),
           line(_lpp, (_lpp[0] + 16, _lpp[1]), 4, 0, 'eq'),
           pad(_lpp, r=7, layer=6),
           line((128, 30), (128, 8), 1.6, 0, 'cable'), line((128, 8), (206, 8), 1.6, 0, 'cable'),
           line((96, 30), (160, 30), 5, 0, 'eq')],
    ann=[ring(_lpp, 11), adjust((_lpp[0] + 30, _lpp[1] - 4)), badge(1, (_lpp[0] + 48, _lpp[1] - 26), (_lpp[0] + 8, _lpp[1] - 8)),
         adjust((90, 194)), badge(2, (52, 196), (88, 182)),
         inset('lat', 3, cx=196, cy=60)],
)

# ---------------------------------------------------------------- benches
FLAT = [floor(), bench(34, 176, 162, 176, legs=[54, 146])]


def _flat_rack(extra_ann=(), hook=88, safety=150):
    return dict(
        pose=lying({'to': (84, hook + 8), 'bend': 'down'}),
        props=FLAT + [rack(70, hook, safety)],
        extra=[barbell_side((84, hook), 16)],
        ann=[label((190, 140), '0°'), badge(1, (190, 160), (160, 176)),
             ring((79, hook), 9), adjust((58, hook)), badge(2, (40, hook - 18), (70, hook)),
             adjust((104, safety + 1), 90, 8), badge(3, (124, safety + 22), (104, safety))] + list(extra_ann),
    )


SETUP['bench-press'] = _flat_rack()
SETUP['close-grip-bench'] = _flat_rack()

SETUP['db-bench-press'] = dict(
    ann=[label((190, 140), '0°'), badge(1, (190, 160), (160, 176)), badge(2, lambda P: add(P['hand'], (24, -6)), 'hand')],
)

SETUP['skull-crusher'] = dict(
    ann=[label((190, 140), '0°'), badge(1, (190, 160), (160, 176)), inset('ez', 2, cx=34, cy=40)],
)

# incline bench: backrest angle off the floor
_ib = incline_bench()
_ib_v = add(add((148, 162), mul((vec(-150, 1)[1], -vec(-150, 1)[0]), 18)), mul(vec(-150, 1), -4))
SETUP['incline-db-press'] = dict(
    ann=[angle(_ib_v, 180, 210, r=44, lr=60, n=1, bdx=-22),
         adjust((176, 176), 90, 7), badge(2, (196, 196), (176, 182)),
         badge(3, lambda P: add(P['hand'], (20, -4)), 'hand')],
)
# badge 1 sits beside the angle label

SETUP['smith-incline-press'] = dict(
    ann=[angle(_ib_v, 180, 210, r=44, lr=60, n=1, bdx=-22),
         level((104, 116), 86, 124),
         stop((104, 116), 90, 7), badge(2, (128, 96), (106, 116)),
         ring((104, 68), 9), badge(3, (70, 56), (96, 64))],
)

SETUP['seated-db-press'] = dict(
    ann=[angle((88, 192), 0, -90, r=30, label='90°', lr=44), badge(1, (60, 120), (88, 140)),
         badge(2, lambda P: add(P['hand'], (22, -10)), 'hand')],
)

# one-arm row on a flat bench: knee + hand on the pad
SETUP['db-row'] = dict(
    ann=[badge(1, (60, 160), (72, 180)), badge(2, (180, 150), (162, 178)),
         badge(3, (40, 214), (72, G))],
)

# chest-supported row: incline ~30-45°, chest on the pad
def _ibr_lo():
    from poses import _ibr_hip
    u = vec(-30, 1)
    fr = (-u[1], u[0])
    return add(add(_ibr_hip, mul(fr, 19)), mul(u, -8))


SETUP['incline-bench-db-row'] = dict(
    ann=[angle(_ibr_lo(), 0, -30, r=40, lr=56, n=1),
         badge(2, lambda P: add(P['head'], (20, -14)), lambda P: add(P['shoulder'], (6, 4))),
         badge(3, (36, 206), (60, G))],
)

SETUP['decline-crunch'] = dict(
    ann=[badge(1, (60, 150)), badge(2, lambda P: add(P['ankle'], (18, 26)),
                                      lambda P: add(P['ankle'], mul(_unit_perp(P['knee'], P['ankle']), -9)))],
)


def _decline_angle():
    from poses import _dc
    a = dict(_dc, torso=158)
    P = joints(a)
    u = vec(158, 1)
    back = (u[1], -u[0])
    lo = add(add(P['hip'], mul(back, 19)), mul(u, 92))
    return lo


SETUP['decline-crunch']['ann'].insert(0, angle(_decline_angle(), -22, 0, r=38, label='20°', lr=50))

SETUP['bulgarian-split-squat'] = dict(
    ann=[level((48, 180), 40, 150), badge(1, (24, 156), (40, 180)),
         badge(2, (78, 150), lambda P: P['toe2']),
         adjust((97, G + 2), 0, 22), badge(3, (98, 236 - 26))],
)

SETUP['step-up'] = dict(
    ann=[level((160, 196), 100, 206), badge(1, (214, 196), (192, 196)),
         badge(2, (200, 150), lambda P: P['ankle'])],
)

SETUP['bench-dip'] = dict(
    ann=[badge(1, (40, 130), lambda P: P['hand']),
         badge(2, (210, 190), lambda P: P['ankle'])],
)

SETUP['incline-push-up'] = dict(
    ann=[adjust((J(EX['incline-push-up']['a'], 'hand')[0] + 16, 170)),
         badge(1, (J(EX['incline-push-up']['a'], 'hand')[0] + 34, 170)),
         badge(2, (40, 196), lambda P: P['toe'])],
)

_irx = J(EX['inverted-row']['a'], 'shoulder')[0]
SETUP['inverted-row'] = dict(
    ann=[ring((_irx, 104), 8), adjust((_irx + 16, 126)),
         badge(1, (_irx + 36, 126)),
         badge(2, (196, 196), lambda P: P['ankle'])],
)

# ---------------------------------------------------------------- machines
def _lp_geo():
    from poses import _LP_U, _LP_PERP
    u = vec(-135, 1)
    back = (u[1], -u[0])
    lo = add(add((92, 172), mul(back, 18)), mul(u, -10))      # backrest lower end
    rail0 = add(add((124, 140), mul(_LP_U, 6)), mul(_LP_PERP, 16))
    return lo, add(rail0, mul(_LP_U, -6))


_lp_lo, _lp_stop = _lp_geo()
SETUP['leg-press'] = dict(
    ann=[angle(_lp_lo, 180, 225, r=34, lr=50, n=1, bdx=-24),
         badge(2, lambda P: add(P['toe'], (24, -18)), lambda P: add(P['ankle'], (6, -6))),
         stop(_lp_stop, -45, 8), badge(3, add(_lp_stop, (34, 24)), _lp_stop)],
)

SETUP['leg-press-calf-raise'] = dict(
    ann=[badge(1, lambda P: add(P['toe'], (20, -22)), 'toe'),
         badge(2, lambda P: add(P['knee'], (-2, -26)), 'knee')],
)

SETUP['leg-extension'] = dict(
    ann=[ring(lambda P: P['knee'], 10), badge(1, lambda P: add(P['knee'], (24, -26)), lambda P: add(P['knee'], (7, -7))),
         adjust((66, 126), -100, 10), badge(2, (44, 100), (66, 126)),
         badge(3, lambda P: add(P['ankle'], (26, 10)), lambda P: add(P['ankle'], mul(_unit_perp(P['knee'], P['ankle']), 10)))],
)

SETUP['leg-curl'] = dict(
    ann=[ring(lambda P: P['knee'], 10), badge(1, lambda P: add(P['knee'], (10, 32)), lambda P: add(P['knee'], (0, 10))),
         badge(2, lambda P: add(P['ankle'], (0, -30)), lambda P: add(P['ankle'], mul(_unit_perp(P['knee'], P['ankle']), 10)))],
)

SETUP['calf-raise'] = dict(
    ann=[adjust((76, 70)), badge(1, (56, 54), (86, 70)),
         badge(2, (196, 186), (150, 204))],
)

SETUP['hip-abduction'] = dict(
    ann=[badge(1, (190, 120), lambda P: add(P['knee'], (9, 0))),
         badge(2, (196, 210), (148, 170))],
)
SETUP['hip-adduction'] = dict(
    ann=[badge(1, (190, 120), lambda P: add(P['knee'], (-9, 0))),
         badge(2, (196, 210), (148, 170))],
)

SETUP['back-extension'] = dict(
    ann=[angle((66, 196), -45, 0, r=34, label='45°', lr=48), badge(1, (186, 120), lambda P: add(P['hip'], (4, 19))),
         badge(2, (30, 150), lambda P: add(P['ankle'], (8, 8)))],
)
SETUP['horizontal-back-extension'] = dict(
    ann=[badge(1, (150, 186), lambda P: add(P['hip'], (4, 20))),
         badge(2, (30, 186), lambda P: add(P['ankle'], (0, 10)))],
)

# ---------------------------------------------------------------- racks / smith
_bar = tp(joints(EX['back-squat']['a']), 1, -11)
_bar_lo = tp(joints(EX['back-squat']['b']), 1, -11)[1] + 10   # safeties just below the bottom
_rx = _bar[0] - 8
SETUP['back-squat'] = dict(
    props=[floor(), rack(_rx, _bar[1] + 3, _bar_lo, top=30)],
    extra=[plate(lambda P: tp(P, 1, -11), r=17, layer=2)],
    ann=[adjust((_rx - 14, _bar[1] + 3)), badge(1, (_rx - 34, _bar[1] - 10), (_rx - 2, _bar[1] + 3)),
         adjust((_rx + 44, _bar_lo), 90, 8), badge(2, (_rx + 64, _bar_lo))],
)

_ohp_bar = J(EX['overhead-press']['a'], 'hand')
_ox = _ohp_bar[0] - 8
SETUP['overhead-press'] = dict(
    props=[floor(), rack(_ox, _ohp_bar[1] + 3, top=40)],
    extra=[plate('hand', r=15, layer=5.3)],
    ann=[adjust((_ox + 34, _ohp_bar[1] + 3)), badge(1, (_ox + 54, _ohp_bar[1] - 12), (_ox + 22, _ohp_bar[1] + 3)),
         adjust((96, G + 6), 0, 12), badge(2, (96, G - 14))],
    zoom=.86,
)

_ss_lo = tp(joints(EX['smith-squat']['b']), 1, -11)[1] + 12
_sl_lo = tp(joints(EX['smith-lunge']['b']), 1, -11)[1] + 12
SETUP['smith-squat'] = dict(
    ann=[ring(lambda P: tp(P, 1, -11), 19), badge(1, (60, 40), lambda P: tp(P, 1, -24)),
         stop((122, _ss_lo), 90, 8), badge(2, (92, _ss_lo), (116, _ss_lo)),
         adjust((150, G + 6), 0, 12), badge(3, (190, 214), lambda P: P['toe'])],
)

SETUP['smith-lunge'] = dict(
    ann=[ring(lambda P: tp(P, 1, -11), 19), badge(1, (60, 40), lambda P: tp(P, 1, -24)),
         stop((108, _sl_lo), 90, 8), badge(2, (78, _sl_lo), (102, _sl_lo)),
         adjust((118, G + 6), 0, 34), badge(3, (118, 236 - 10))],
)

SETUP['smith-calf-raise'] = dict(
    ann=[ring(lambda P: tp(P, 1, -11), 19), badge(1, (60, 40), lambda P: tp(P, 1, -24)),
         badge(2, (196, 186), (150, 204))],
)

SETUP['dips'] = dict(
    ann=[badge(1, (170, 96), (160, 116)),
         badge(2, lambda P: add(P['shoulder'], (30, -8)), lambda P: add(P['shoulder'], (4, 0)))],
)

# ---------------------------------------------------------------- cardio
SETUP['cycling'] = dict(
    ann=[adjust((84, 146), 90, 9), badge(1, (60, 150), (84, 134)),
         adjust((97, 120), 0, 9), badge(2, (66, 112)),
         badge(3, (206, 92), (183, 104))],
)

SETUP['rowing-machine'] = dict(
    ann=[ring((206, 176), 20), badge(1, (206, 136), (206, 158)),
         badge(2, lambda P: add(P['toe'], (14, 22)), lambda P: add(P['ankle'], (4, 2)))],
)


def badge_numbers(spec):
    return sorted({getattr(a, 'badge') for a in spec.get('ann', []) if hasattr(a, 'badge')})
