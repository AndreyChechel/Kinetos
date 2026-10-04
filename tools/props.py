"""Equipment primitives for the exercise animations.

Every prop is a function P -> [primitive] evaluated once per frame (P is
the joint dict from figure.joints). Static props just ignore P. Primitive
tuple: (layer, cls, tag, static_attrs, dynamic_attrs) — see figure.py.
Layers: 0 back scenery, 1 far limbs, 2 behind torso, 3 torso/near leg,
4 between torso and near arm, 5 near arm, 6 in front of everything.
"""
from figure import FLOOR, f1, seg_d, pt, add, vec, sub, mul


def _p(P, j):
    if isinstance(j, str):
        return P[j]
    if callable(j):
        return j(P)
    return j


def line(a, b, w=6, layer=0, cls='eq'):
    return lambda P: [(layer, cls, 'path', {'stroke-width': w}, {'d': seg_d(_p(P, a), _p(P, b))})]


def poly(pts, layer=0, cls='eqfs'):
    d = 'M' + ' L'.join(pt(p) for p in pts) + 'Z'
    return lambda P: [(layer, cls, 'path', {}, {'d': d})]


def floor(x0=12, x1=228):
    return line((x0, FLOOR + 1), (x1, FLOOR + 1), 2.5, 0, 'eqs')


def bench(x0, y0, x1, y1, legs=None, w=8, layer=0):
    """Pad from (x0,y0) to (x1,y1) with optional leg x positions to the floor."""
    def f(P):
        out = [(layer, 'eq', 'path', {'stroke-width': w}, {'d': seg_d((x0, y0), (x1, y1))})]
        for lx in (legs or []):
            t = (lx - x0) / ((x1 - x0) or 1)
            ly = y0 + (y1 - y0) * t
            out.append((layer, 'eqs', 'path', {'stroke-width': 4}, {'d': seg_d((lx, ly + w / 2), (lx, FLOOR))}))
        return out
    return f


def plate(j='hand', r=15, layer=4, dx=0, dy=0):
    """Barbell seen end-on: plate + collar at joint j (usually the hand)."""
    def f(P):
        c = add(_p(P, j), (dx, dy))
        return [(layer, 'plate', 'circle', {'r': r}, {'cx': f1(c[0]), 'cy': f1(c[1])}),
                (layer + .01, 'halo', 'circle', {'r': 2.5, 'stroke-width': 3}, {'cx': f1(c[0]), 'cy': f1(c[1])})]
    return f


def dumbbell(j='hand', layer=5.3, r=7, along=None):
    """Dumbbell head(s) at joint j; `along` = angle to show the handle."""
    def f(P):
        c = _p(P, j)
        out = []
        if along is not None:
            a = add(c, vec(along, 9))
            b = add(c, vec(along, -9))
            out.append((layer, 'eq', 'path', {'stroke-width': 3.5}, {'d': seg_d(a, b)}))
            for q in (a, b):
                out.append((layer + .01, 'plate', 'circle', {'r': r * .75}, {'cx': f1(q[0]), 'cy': f1(q[1])}))
        else:
            out.append((layer + .01, 'plate', 'circle', {'r': r}, {'cx': f1(c[0]), 'cy': f1(c[1])}))
        return out
    return f


def cable(anchor, j='hand', layer=4, pulley=True):
    def f(P):
        a = _p(P, anchor)
        h = _p(P, j)
        out = [(layer, 'cable', 'path', {}, {'d': seg_d(a, h)})]
        if pulley:
            out.append((0, 'eq', 'circle', {'r': 4, 'stroke-width': 2.5}, {'cx': f1(a[0]), 'cy': f1(a[1])}))
        return out
    return f


def handle(j='hand', w=10, layer=5.3, angle=90):
    def f(P):
        c = _p(P, j)
        return [(layer, 'eq', 'path', {'stroke-width': 3}, {'d': seg_d(add(c, vec(angle, -w / 2)), add(c, vec(angle, w / 2)))})]
    return f


def stack(x, y0=20, y1=FLOOR, w=16):
    """Cable/machine column (weight stack)."""
    return lambda P: [(0, 'eqfs', 'path', {}, {'d': f'M{f1(x - w / 2)},{f1(y0)} h{f1(w)} V{f1(y1)} h{f1(-w)}Z'})]


def pad(j, r=6, layer=6, dx=0, dy=0):
    """Machine roller pad following joint j."""
    def f(P):
        c = add(_p(P, j), (dx, dy))
        return [(layer, 'eqf', 'circle', {'r': r}, {'cx': f1(c[0]), 'cy': f1(c[1])})]
    return f


def dot(c, r=4, layer=0, cls='eqf'):
    return lambda P: [(layer, cls, 'circle', {'r': r}, {'cx': f1(c[0]), 'cy': f1(c[1])})]


def custom(fn):
    """fn(P) -> list of primitives (escape hatch)."""
    return fn
