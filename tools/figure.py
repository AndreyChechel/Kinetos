"""Tiny 2-D figure animator used by generate_svgs.py.

A side-view figure (facing right, +x) is posed by absolute segment angles
(degrees, SVG convention: 0 = right, 90 = down, -90 = up) or by IK targets
for a limb's end point. A pose is sampled over one loop, every primitive
(segment stroke, head circle, equipment) is evaluated per frame, and any
attribute that changes becomes a SMIL <animate> with one value per frame.
Frame 0 is also written as the static attribute, so the art still reads
when animation is paused (thumbnails, reduced motion) or unsupported.

Stdlib only.
"""
import math

# ---- body dimensions (viewBox units; standing height ~176) ----------------
L = dict(torso=60, neck=7, head=12, ua=35, fa=31, thigh=49, shin=47, foot=16)
W = dict(ua=13, fa=10, thigh=20, shin=14, foot=7.5, hand=5)
FLOOR = 224


def rad(a):
    return math.radians(a)


def vec(a, l):
    return (math.cos(rad(a)) * l, math.sin(rad(a)) * l)


def add(p, q):
    return (p[0] + q[0], p[1] + q[1])


def sub(p, q):
    return (p[0] - q[0], p[1] - q[1])


def mul(p, k):
    return (p[0] * k, p[1] * k)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_pt(p, q, t):
    return (lerp(p[0], q[0], t), lerp(p[1], q[1], t))


def ang(p, q):
    return math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))


DIRS = {'fwd': (1, 0), 'back': (-1, 0), 'up': (0, -1), 'down': (0, 1)}


def ik(root, target, a, b, hint):
    """Two-link IK: returns (mid, end). `hint` picks the bend side."""
    d = math.dist(root, target)
    d = max(abs(a - b) + 0.01, min(a + b - 0.01, d))
    base = math.atan2(target[1] - root[1], target[0] - root[0])
    cos_al = (a * a + d * d - b * b) / (2 * a * d)
    al = math.acos(max(-1, min(1, cos_al)))
    hv = DIRS[hint] if isinstance(hint, str) else hint
    best = None
    for s in (1, -1):
        mid = (root[0] + math.cos(base + s * al) * a, root[1] + math.sin(base + s * al) * a)
        score = mid[0] * hv[0] + mid[1] * hv[1]
        if best is None or score > best[0]:
            best = (score, mid)
    mid = best[1]
    end = add(mid, mul(sub(target, mid), b / max(1e-6, math.dist(mid, target))))
    return mid, end


# ---- pose -> joints ----------------------------------------------------------
# A pose is a dict:
#   torso: angle hip->shoulder          head: tilt relative to torso (default 0)
#   arm / arm2: (upper, fore) angles  or  {'to': (x,y), 'bend': hint}
#   leg / leg2: (thigh, shin[, foot]) or  {'to': (x,y), 'bend': hint, 'foot': a}
#   at: (joint, (x,y))  which joint is pinned where (joint must be FK-placed)
#   arm2/leg2 default to arm/leg (both limbs move together).
#   view: 'side' (default) | 'front' | 'back'. In front/back view the limbs
#     hang off two shoulders/hips (arm/leg = image-right side) and nothing
#     is faded; author arm2/leg2 explicitly (mirrored).
#   sa, sa2, sl, sl2: length scale of a limb (foreshortening, default 1);
#   st: torso length scale (e.g. bent over, seen from behind); hd: neck+head
#   offset scale (hd<1 sinks the head into the shoulders).
#   IK 'to' may be ('t', u, v) = relative to the shoulder in the torso frame
#   (u toward the head, v toward the front) or ('h', u, v) relative to the hip.

SHOULDER_W, HIP_W = 17, 8.5


def _limb_fk(root, spec, la, lb):
    mid = add(root, vec(spec[0], la))
    return mid, add(mid, vec(spec[1], lb))


def joints(pose):
    view = pose.get('view', 'side')
    tu = vec(pose['torso'], 1)
    tf = (-tu[1], tu[0])
    hip = (0.0, 0.0)
    sh = add(hip, mul(tu, L['torso'] * pose.get('st', 1)))
    rel = {'hip': hip, 'shoulder': sh}
    if view == 'side':
        roots = {'arm': sh, 'arm2': sh, 'leg': hip, 'leg2': hip}
    else:
        roots = {'arm': add(sh, mul(tf, SHOULDER_W)), 'arm2': add(sh, mul(tf, -SHOULDER_W)),
                 'leg': add(hip, mul(tf, HIP_W)), 'leg2': add(hip, mul(tf, -HIP_W))}
    for k, v in roots.items():
        rel['root_' + k] = v

    def spec_of(name):
        if name in pose:
            return pose[name]
        base = name.rstrip('2')
        return pose.get(base, (90, 90) if base == 'arm' else (90, 90, 0))

    def scale(name):
        key = {'arm': 'sa', 'arm2': 'sa2', 'leg': 'sl', 'leg2': 'sl2'}[name]
        return pose.get(key, pose.get(key[:2], 1)) if name.endswith('2') else pose.get(key, 1)

    def place(name, spec, root, Pd):
        sfx = '2' if name.endswith('2') else ''
        k = scale(name)
        if name.startswith('arm'):
            la, lb = L['ua'] * k, L['fa'] * k
            if isinstance(spec, dict):
                e, h = ik(root, resolve(spec['to'], Pd), la, lb, spec.get('bend', 'down'))
            else:
                e, h = _limb_fk(root, spec, la, lb)
            Pd['elbow' + sfx], Pd['hand' + sfx] = e, h
        else:
            la, lb = L['thigh'] * k, L['shin'] * k
            if isinstance(spec, dict):
                kn, an = ik(root, resolve(spec['to'], Pd), la, lb, spec.get('bend', 'fwd'))
                fa = spec.get('foot', 0)
            else:
                kn, an = _limb_fk(root, spec, la, lb)
                fa = spec[2] if len(spec) > 2 else 0
            Pd['knee' + sfx], Pd['ankle' + sfx] = kn, an
            Pd['toe' + sfx] = add(an, vec(fa, L['foot'] * (1 if view == 'side' else .5)))

    def resolve(to, Pd):
        if isinstance(to[0], str):
            base = Pd['shoulder'] if to[0] == 't' else Pd['hip']
            return (base[0] + tu[0] * to[1] + tf[0] * to[2], base[1] + tu[1] * to[1] + tf[1] * to[2])
        return to

    names = ('arm', 'arm2', 'leg', 'leg2')
    for n in names:                       # FK limbs, hip at the origin
        if not isinstance(spec_of(n), dict):
            place(n, spec_of(n), rel['root_' + n], rel)
    neck = add(sh, mul(tu, L['neck'] * pose.get('hd', 1)))
    rel['neck'] = neck
    rel['head'] = add(neck, vec(pose['torso'] + pose.get('head', 0), (L['head'] + 1) * pose.get('hd', 1)))
    jn, at = pose.get('at', ('hip', (120, 150)))
    off = sub(at, rel[jn])
    P = {k: add(v, off) for k, v in rel.items()}
    for n in names:                       # IK limbs in world space
        if isinstance(spec_of(n), dict):
            place(n, spec_of(n), P['root_' + n], P)
    P['_tu'], P['_tf'], P['_view'] = tu, tf, view
    return P


def interp(p0, p1, t):
    """Interpolate two poses (same structure)."""
    out = {}
    for k in set(p0) | set(p1):
        a, b = p0.get(k, p1.get(k)), p1.get(k, p0.get(k))
        out[k] = _interp(a, b, t)
    return out


def _interp(a, b, t):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return lerp(a, b, t)
    if isinstance(a, str):
        return a
    if isinstance(a, dict):
        return {k: _interp(a[k], b.get(k, a[k]), t) for k in a}
    if isinstance(a, (tuple, list)):
        return tuple(_interp(x, y, t) for x, y in zip(a, b))
    return a


def ease(u):
    return (1 - math.cos(math.pi * max(0.0, min(1.0, u)))) / 2


def pingpong(t, hold=0.08):
    u = t * 2 if t < 0.5 else 2 - 2 * t
    return ease((u - hold) / (1 - 2 * hold))


# ---- primitives -------------------------------------------------------------
# Each primitive: (layer, tag, static_attrs: dict, dyn_attrs: dict)
# Layers (back→front): 0 static back props, 1 far limbs, 2 back props,
# 3 torso/head, 4 mid props, 5 near limbs, 6 muscles, 7 front props.

def f1(x):
    s = f"{x:.1f}"
    return s[:-2] if s.endswith('.0') else ('0' if s == '-0' else s)


def pt(p):
    return f"{f1(p[0])},{f1(p[1])}"


def seg_d(*pts):
    return 'M' + ' L'.join(pt(p) for p in pts)


def offset_seg(a, b, t0, t1, off):
    """Sub-segment of a->b between t0..t1, shifted by `off` along the side
    normal (dy,-dx): for a limb pointing down/away that's its front."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1
    nx, ny = dy / n, -dx / n
    p = (a[0] + dx * t0 + nx * off, a[1] + dy * t0 + ny * off)
    q = (a[0] + dx * t1 + nx * off, a[1] + dy * t1 + ny * off)
    return p, q


def _frame(hip, sh):
    dx, dy = sh[0] - hip[0], sh[1] - hip[1]
    n = math.hypot(dx, dy) or 1
    ux, uy = dx / n, dy / n
    fx, fy = -uy, ux      # front normal: vertical torso facing right -> +x

    def P(u, v):
        return (hip[0] + ux * n * u + fx * v, hip[1] + uy * n * u + fy * v)
    return P


def torso_path(hip, sh, view='side'):
    P = _frame(hip, sh)
    if view == 'side':
        ring = [P(0.06, -17), P(0.42, -13), P(0.8, -16), P(1.07, -5),
                P(0.98, 11), P(0.72, 16), P(0.4, 13), P(-0.05, 9)]
    else:
        ring = [P(-0.08, -16), P(0.4, -13.5), P(0.82, -19), P(1.02, -19),
                P(1.02, 19), P(0.82, 19), P(0.4, 13.5), P(-0.08, 16)]
    return closed_smooth(ring)


def closed_smooth(pts):
    """Catmull-Rom closed spline -> cubic Béziers (fixed command layout)."""
    n = len(pts)
    d = 'M' + pt(pts[0])
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{pt(c1)} {pt(c2)} {pt(p2)}"
    return d + 'Z'


# Side view. muscle -> [(segment, t0, t1, offset, width)]. Segments:
# torso(hip->shoulder; offset + = BACK), ua(shoulder->elbow), fa(elbow->hand),
# thigh(hip->knee), shin(knee->ankle); on limbs offset + = the limb's front
# (normal (dy,-dx): forward for a limb hanging down).
MUSCLES = {
    'chest':      [('torso', .6, .86, -10, 9)],
    'abs':        [('torso', .16, .54, -9, 7)],
    'obliques':   [('torso', .2, .55, -2, 9)],
    'lats':       [('torso', .42, .8, 10, 9)],
    'lowerback':  [('torso', .12, .38, 9.5, 8)],
    'traps':      [('torso', .88, 1.04, 6, 9)],
    'glutes':     [('torso', -.04, .12, 11, 13)],
    'delts':      [('ua', .02, .2, 0, 14)],
    'reardelt':   [('ua', .02, .18, -2.5, 10)],
    'biceps':     [('ua', .25, .78, 2.4, 7)],
    'triceps':    [('ua', .22, .78, -2.4, 7)],
    'forearms':   [('fa', .12, .6, 0, 7.5)],
    'quads':      [('thigh', .15, .82, 3.2, 11)],
    'hamstrings': [('thigh', .18, .85, -3.2, 11)],
    'calves':     [('shin', .12, .5, -2.6, 8.5)],
}
# Front/back view: torso entries are (u0, u1, v, width) along the torso at
# lateral offset v (both sides when v != 0); limb entries as above, both limbs.
MUSCLES_FRONT = {
    'chest':    [('T', .7, .82, 8.5, 14)],
    'abs':      [('T', .14, .56, 0, 10)],
    'obliques': [('T', .2, .5, 11.5, 5)],
    'lats':     [('T', .46, .74, 14.5, 4)],
    'traps':    [('T', .96, 1.06, 9, 6)],
    'glutes':   [('T', -.06, .08, 13, 6)],
    'delts':    [('ua', .0, .24, 0, 15)],
    'biceps':   [('ua', .3, .8, 0, 8)],
    'triceps':  [('ua', .3, .8, -3, 4)],
    'forearms': [('fa', .1, .6, 0, 7.5)],
    'quads':    [('thigh', .14, .8, 0, 13)],
    'calves':   [('shin', .12, .5, 0, 7)],
}
MUSCLES_BACK = {
    'traps':      [('T', .78, 1.06, 0, 14)],
    'lats':       [('T', .42, .8, 10, 10)],
    'lowerback':  [('T', .1, .36, 5, 6)],
    'glutes':     [('T', -.1, .1, 8, 14)],
    'reardelt':   [('ua', .0, .22, 0, 14)],
    'delts':      [('ua', .0, .22, 0, 14)],
    'triceps':    [('ua', .3, .8, 0, 8)],
    'biceps':     [('ua', .3, .8, 3, 4)],
    'forearms':   [('fa', .1, .6, 0, 7.5)],
    'hamstrings': [('thigh', .18, .82, 0, 13)],
    'quads':      [('thigh', .18, .82, 4, 4)],
    'calves':     [('shin', .1, .5, 0, 9)],
}


def figure_prims(P, primary, secondary):
    """Primitives for the figure. Tuple: (layer, cls, tag, static, dynamic)."""
    view = P['_view']
    side = view == 'side'
    out = []

    def line(layer, cls, w, a, b):
        out.append((layer, cls, 'path', {'stroke-width': w}, {'d': seg_d(P[a], P[b])}))

    # far limbs (side view: one translucent group so overlaps don't darken)
    farcls, armlay = ('far', 1) if side else ('near', 2.9)
    line(armlay if not side else 1, farcls, W['thigh'], 'root_leg2', 'knee2')
    line(armlay if not side else 1, farcls, W['shin'], 'knee2', 'ankle2')
    line(armlay if not side else 1, farcls, W['foot'], 'ankle2', 'toe2')
    if side:
        line(1, 'far', W['ua'], 'root_arm2', 'elbow2')
        line(1, 'far', W['fa'], 'elbow2', 'hand2')
    # near leg, torso, head
    line(2.9 if not side else 3, 'near', W['thigh'], 'root_leg', 'knee')
    line(2.9 if not side else 3, 'near', W['shin'], 'knee', 'ankle')
    line(2.9 if not side else 3, 'near', W['foot'], 'ankle', 'toe')
    line(3, 'near', 9 if side else 11, 'shoulder', 'neck')
    out.append((3.1, 'body', 'path', {}, {'d': torso_path(P['hip'], P['shoulder'], view)}))
    out.append((3.1, 'body', 'circle', {'r': L['head']},
                {'cx': f1(P['head'][0]), 'cy': f1(P['head'][1])}))
    # arms, outlined against the torso
    arms = [('', 'root_arm')] if side else [('', 'root_arm'), ('2', 'root_arm2')]
    for cls, extra in (('halo', 3.5), ('near', 0)):
        lay = 5 if cls == 'halo' else 5.1
        for sfx, root in arms:
            line(lay, cls, W['ua'] + extra, root, 'elbow' + sfx)
            line(lay, cls, W['fa'] + extra, 'elbow' + sfx, 'hand' + sfx)
    for sfx, _ in arms:
        out.append((5.15, 'body', 'circle', {'r': W['hand']},
                    {'cx': f1(P['hand' + sfx][0]), 'cy': f1(P['hand' + sfx][1])}))
    # muscles
    seg = {'ua': ('root_arm', 'elbow'), 'fa': ('elbow', 'hand'),
           'thigh': ('root_leg', 'knee'), 'shin': ('knee', 'ankle')}
    seg2 = {'ua': ('root_arm2', 'elbow2'), 'fa': ('elbow2', 'hand2'),
            'thigh': ('root_leg2', 'knee2'), 'shin': ('knee2', 'ankle2')}
    table = MUSCLES if side else (MUSCLES_FRONT if view == 'front' else MUSCLES_BACK)
    TP = _frame(P['hip'], P['shoulder'])
    for group, cls in ((secondary, 'm2'), (primary, 'm1')):
        for m in group:
            for (s, t0, t1, off, w) in table.get(m, []):
                if s == 'T':
                    for v in ((off, -off) if off else (0,)):
                        out.append((3.2, cls, 'path', {'stroke-width': w},
                                    {'d': seg_d(TP(t0, v), TP(t1, v))}))
                    continue
                if s == 'torso':
                    p, q = offset_seg(P['hip'], P['shoulder'], t0, t1, off)
                    out.append((3.2, cls, 'path', {'stroke-width': w}, {'d': seg_d(p, q)}))
                    continue
                arm = s in ('ua', 'fa')
                a, b = seg[s]
                o = off if side else (off if a.endswith('arm') or not arm else off)
                p, q = offset_seg(P[a], P[b], t0, t1, o)
                out.append((5.2 if arm else 3.2, cls, 'path', {'stroke-width': w}, {'d': seg_d(p, q)}))
                a, b = seg2[s]
                # mirrored limb: flip the lateral offset in front/back view
                p, q = offset_seg(P[a], P[b], t0, t1, o if side else -o)
                lay, c2 = (1.5, 'mfar') if side else ((5.2 if arm else 3.2), cls)
                out.append((lay, c2, 'path', {'stroke-width': w}, {'d': seg_d(p, q)}))
    return out


# ---- assembly ---------------------------------------------------------------
# Presentation attributes per class (inline SVGs can't carry a scoped
# <style>). Muscles use class="muscle-stroke" so the app's themed accent
# wins over the fallback colour.
ROUND = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'
STYLE = {
    'far':   f'{ROUND} stroke="currentColor" opacity="0.38"',
    'mfar':  f'{ROUND} class="muscle-stroke" stroke="#ff7a3c" opacity="0.45"',
    'near':  f'{ROUND} stroke="currentColor"',
    'body':  'fill="currentColor"',
    'halo':  f'{ROUND} style="stroke:var(--surface-2,#eceef1)"',
    'm1':    f'{ROUND} class="muscle-stroke" stroke="#ff7a3c"',
    'm2':    f'{ROUND} class="muscle-stroke" stroke="#ff7a3c" opacity="0.55"',
    'eq':    f'{ROUND} stroke="currentColor" opacity="0.5"',
    'eqs':   f'{ROUND} stroke="currentColor" opacity="0.28"',
    'eqf':   'fill="currentColor" opacity="0.5"',
    'eqfs':  'fill="currentColor" opacity="0.2"',
    'plate': 'fill="currentColor" opacity="0.62"',
    'cable': f'{ROUND} stroke="currentColor" opacity="0.55" stroke-width="1.6"',
    'rope':  f'{ROUND} stroke="currentColor" opacity="0.75" stroke-width="2.4"',
}


def attrs(d):
    return ' '.join(f'{k}="{v}"' for k, v in d.items())


def assemble(frames, dur):
    """frames: per-frame primitive lists with identical layout. Returns the
    markup, sorted by layer and grouped by class, with SMIL animations for
    every attribute that changes."""
    base = frames[0]
    order = sorted(range(len(base)), key=lambda i: base[i][0])
    out, cur = [], None
    for i in order:
        layer, cls, tag, st, dyn = base[i]
        if (layer, cls) != cur:
            if cur is not None:
                out.append('</g>')
            out.append(f'<g {STYLE[cls]}>')
            cur = (layer, cls)
        static = dict(st)
        anims = []
        for k, v0 in dyn.items():
            vals = [fr[i][4][k] for fr in frames]
            static[k] = v0
            if any(v != v0 for v in vals):
                anims.append(f'<animate attributeName="{k}" dur="{dur}s" repeatCount="indefinite" '
                             f'values="{";".join(vals + [vals[0]])}"/>')
        if anims:
            out.append(f'<{tag} {attrs(static)}>' + ''.join(anims) + f'</{tag}>')
        else:
            out.append(f'<{tag} {attrs(static)}/>')
    if cur is not None:
        out.append('</g>')
    return '\n'.join(out)


def frame_markup(prims):
    """One static frame (used for previews)."""
    return assemble([prims], 1)
