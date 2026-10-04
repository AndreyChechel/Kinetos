"""Per-exercise animation definitions for generate_svgs.py.

Each entry: {a: start pose, b: end pose (ping-pong a->b->a), props: [...],
dur: seconds} or {cycle: fn(t)->pose, ...} for cyclic motions, or only
{a: pose} for a still (isometric holds). Frame 0 = pose `a` is what the
paused thumbnail shows. See figure.joints for the pose format: angles in
degrees, 0 = right, 90 = down, -90 = up; the figure faces right.
Ankle on the floor = y G; standing hip height = G - 96.
"""
import math
from figure import FLOOR, joints, vec, add, sub, mul, f1, seg_d, interp, ease
from props import (line, poly, floor, bench, plate, dumbbell, cable, handle,
                   stack, pad, dot, custom)

G = FLOOR - 4          # ankle height when the foot is flat on the floor
TWO_PI = 2 * math.pi


def stand(**kw):
    p = dict(torso=-90, arm=(93, 91), leg=(90, 90, 0), at=('ankle', (120, G)))
    p.update(kw)
    return p


def down(torso, l=62):
    """('t', u, v) for a hand hanging straight down from the shoulder."""
    tu = vec(torso, 1)
    tf = (-tu[1], tu[0])
    return ('t', round(tu[1] * l, 1), round(tf[1] * l, 1))


def world_to_t(pose, p):
    """World point -> ('t', u, v) for a given pose's torso frame."""
    P = joints(pose)
    d = sub(p, P['shoulder'])
    tu, tf = P['_tu'], P['_tf']
    return ('t', round(d[0] * tu[0] + d[1] * tu[1], 1), round(d[0] * tf[0] + d[1] * tf[1], 1))


def J(pose, name):
    return joints(pose)[name]


def mirror(spec, axis=-90):
    """Mirror a limb spec across the body axis (front/back views)."""
    if isinstance(spec, dict):
        to = spec['to']
        out = dict(spec)
        if isinstance(to[0], str):
            out['to'] = (to[0], to[1], -to[2])
        out['bend'] = {'fwd': 'back', 'back': 'fwd'}.get(spec.get('bend'), spec.get('bend', 'down'))
        return out
    m = [2 * axis - a for a in spec]
    return tuple(m)


def sym(pose):
    """Front/back view: fill arm2/leg2 as mirror images of arm/leg."""
    p = dict(pose)
    ax = p['torso']
    if 'arm2' not in p:
        p['arm2'] = mirror(p['arm'], ax)
    if 'leg2' not in p:
        p['leg2'] = mirror(p['leg'], ax)
    return p


def tp(P, u, v, base='shoulder'):
    """Point in the torso frame of joint dict P."""
    s, tu, tf = P[base], P['_tu'], P['_tf']
    return (s[0] + tu[0] * u + tf[0] * v, s[1] + tu[1] * u + tf[1] * v)


def bar_on_back(P):
    return tp(P, 1, -11)


def rails(x, w=4):
    return line((x, 14), (x, FLOOR), w, 0, 'eqs')


def box(x0, y0, x1, y1=FLOOR):
    return poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], 0, 'eqfs')


def bar_between(width=4, ext=10, layer=5.3):
    """A bar drawn between both hands (front/back views)."""
    def f(P):
        a, b = P['hand'], P['hand2']
        d = sub(a, b)
        n = math.hypot(*d) or 1
        e = mul(d, ext / n)
        return [(layer, 'eq', 'path', {'stroke-width': width}, {'d': seg_d(add(a, e), sub(b, e))})]
    return f


def mid_hands(P):
    return mul(add(P['hand'], P['hand2']), .5)


def piecewise(keys):
    """keys: [(t, pose)...] with t ascending from 0, last pose == first.
    Returns fn(t) with eased interpolation between keys."""
    def f(t):
        for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
            if t0 <= t <= t1:
                return interp(p0, p1, ease((t - t0) / ((t1 - t0) or 1)))
        return keys[-1][1]
    return f


EX = {}

# ====================================================================== CHEST
LIE_HIP = (142, 158)


def lying(arm, **kw):
    p = dict(torso=180, head=-6, arm=arm, leg={'to': (184, G), 'bend': 'up'}, at=('hip', LIE_HIP))
    p.update(kw)
    return p


FLAT_BENCH = bench(34, 176, 162, 176, legs=[54, 146])

EX['bench-press'] = dict(
    a=lying({'to': (84, 93), 'bend': 'down'}),
    b=lying({'to': (90, 140), 'bend': 'down'}),
    props=[floor(), FLAT_BENCH, plate('hand', r=16)], dur=2.6)

EX['db-bench-press'] = dict(
    a=lying({'to': (88, 96), 'bend': 'down'}),
    b=lying({'to': (94, 142), 'bend': 'down'}),
    props=[floor(), FLAT_BENCH, dumbbell('hand', r=8)], dur=2.6)

EX['close-grip-bench'] = dict(
    a=lying({'to': (92, 95), 'bend': 'down'}),
    b=lying({'to': (104, 139), 'bend': 'down'}),
    props=[floor(), FLAT_BENCH, plate('hand', r=16)], dur=2.6)

EX['skull-crusher'] = dict(
    a=lying((-96, -92)),
    b=lying((-104, -168)),
    props=[floor(), FLAT_BENCH, plate('hand', r=13)], dur=2.6)

# chest fly: seen from above (lying on a bench, head left)
TOP = dict(torso=180, view='front', leg=(4, 2, 90), leg2=(-4, -2, -90), sl=.8,
           at=('hip', (136, 120)))
EX['chest-fly'] = dict(
    a=dict(TOP, arm=(-88, -70), arm2=(88, 70), sa=.32),
    b=dict(TOP, arm=(-96, -80), arm2=(96, 80), sa=1),
    props=[poly([(22, 106), (160, 106), (160, 134), (22, 134)], 0, 'eqfs'),
           dumbbell('hand', r=8), dumbbell('hand2', r=8)], dur=2.8)

# cable crossover: front view, high pulleys both sides
CX = dict(torso=-90, view='front', leg=(84, 90, 0), leg2=(96, 90, 180), at=('hip', (120, 126)))
EX['cable-crossover'] = dict(
    a=dict(CX, arm={'to': (178, 98), 'bend': 'up'}, arm2={'to': (62, 98), 'bend': 'up'}),
    b=dict(CX, arm={'to': (128, 150), 'bend': 'fwd'}, arm2={'to': (112, 150), 'bend': 'back'}),
    props=[floor(), stack(18, 86), stack(222, 86),
           cable((26, 92), 'hand', layer=4), cable((214, 92), 'hand2', layer=4),
           handle('hand'), handle('hand2')], dur=2.8)

# incline bench (~30°)
INC_HIP = (148, 162)
INC = dict(torso=-150, head=-4, leg={'to': (192, G), 'bend': 'up'}, at=('hip', INC_HIP))


def incline_bench(P=None):
    hip = INC_HIP
    u = vec(-150, 1)
    back = (u[1], -u[0])
    p0 = add(hip, mul(back, 18))
    p1 = add(p0, mul(u, 82))
    return [bench(p0[0] + 8, p0[1], 178, p0[1], legs=[170], layer=0),
            line(add(p0, mul(u, -4)), p1, 8, 0, 'eq'),
            line(add(p0, mul(u, 40)), (add(p0, mul(u, 40))[0], FLOOR), 4, 0, 'eqs')]


EX['incline-db-press'] = dict(
    a=dict(INC, arm={'to': (104, 66), 'bend': 'down'}),
    b=dict(INC, arm={'to': (108, 120), 'bend': 'down'}),
    props=[floor(), *incline_bench(), dumbbell('hand', r=8)], dur=2.6)

EX['smith-incline-press'] = dict(
    a=dict(INC, arm={'to': (104, 68), 'bend': 'down'}),
    b=dict(INC, arm={'to': (104, 120), 'bend': 'down'}),
    props=[floor(), rails(104), *incline_bench(), plate('hand', r=16)], dur=2.6)


def plank_pose(theta, toe, hand_x=None, hand_y=FLOOR - 5, **kw):
    p = dict(torso=-theta, leg=(180 - theta, 180 - theta, 100), at=('toe', toe), head=8)
    if hand_x is None:
        p['arm'] = (90, 90)
    else:
        p['arm'] = {'to': (hand_x, hand_y), 'bend': 'back'}
    p.update(kw)
    return p


_pu_toe = (20, FLOOR - 4)
_pu_hx = J(plank_pose(15, _pu_toe), 'shoulder')[0]
EX['push-up'] = dict(
    a=plank_pose(15, _pu_toe, _pu_hx),
    b=plank_pose(4, _pu_toe, _pu_hx),
    props=[floor()], dur=2.4)

_ipu_toe = (30, FLOOR - 4)
_ipu_bar = 150
_ipu_hx = J(plank_pose(34, _ipu_toe), 'shoulder')[0] + 6
EX['incline-push-up'] = dict(
    a=plank_pose(34, _ipu_toe, _ipu_hx, _ipu_bar),
    b=plank_pose(25, _ipu_toe, _ipu_hx, _ipu_bar),
    props=[floor(), line((_ipu_hx, _ipu_bar), (_ipu_hx, FLOOR), 4, 0, 'eqs'),
           dot((_ipu_hx, _ipu_bar), 5, 4, 'eqf')], dur=2.4)

# ======================================================================= BACK
BAR_Y = 36
EX['pull-up'] = dict(
    a=dict(torso=-90, arm=(-92, -90), leg=(110, 160, 70), at=('hand', (124, BAR_Y))),
    b=dict(torso=-82, arm=(70, -100), leg=(115, 165, 70), at=('hand', (124, BAR_Y))),
    props=[line((56, BAR_Y), (200, BAR_Y), 5, 4, 'eq')], dur=2.8, zoom=.9)

EX['hanging-leg-raise'] = dict(
    a=dict(torso=-90, arm=(-92, -90), leg=(94, 104, 40), at=('hand', (110, BAR_Y - 6))),
    b=dict(torso=-100, arm=(-88, -90), leg=(-6, -4, -70), at=('hand', (110, BAR_Y - 6))),
    props=[line((40, BAR_Y - 6), (190, BAR_Y - 6), 5, 4, 'eq')], dur=3.0, zoom=.8)

# lat pulldown: from behind, seated
LPD = dict(torso=-90, view='back', leg=(96, 90, 0), leg2=(84, 90, 180), sl=.62,
           at=('hip', (120, 160)))
EX['lat-pulldown'] = dict(
    a=dict(LPD, arm={'to': (174, 36), 'bend': 'fwd'}, arm2={'to': (66, 36), 'bend': 'back'}),
    b=dict(LPD, arm={'to': (166, 92), 'bend': 'down'}, arm2={'to': (74, 92), 'bend': 'down'}),
    props=[line((88, 174), (152, 174), 9, 0, 'eq'), line((120, 174), (120, FLOOR), 5, 0, 'eqs'),
           floor(), custom(lambda P: [(4, 'cable', 'path', {}, {'d': seg_d((120, 4), mid_hands(P))})]),
           bar_between(5, 14)], dur=2.8)

_bor_a = stand(torso=-25, leg=(78, 100, 0), at=('ankle', (104, G)))
EX['bent-over-row'] = dict(
    a=dict(_bor_a, arm={'to': down(-25, 63), 'bend': 'up'}),
    b=dict(_bor_a, arm={'to': ('t', -30, 15), 'bend': 'up'}),
    props=[floor(), plate('hand', r=16, layer=4)], dur=2.6)

_scr = dict(leg={'to': (156, 184), 'bend': 'up', 'foot': -80}, at=('hip', (70, 178)))
EX['seated-cable-row'] = dict(
    a=dict(_scr, torso=-72, arm={'to': (150, 160), 'bend': 'down'}),
    b=dict(_scr, torso=-96, arm={'to': ('t', -36, 18), 'bend': 'back'}),
    props=[floor(), line((36, 196), (110, 196), 8, 0, 'eq'), line((166, 160), (166, 206), 6, 0, 'eq'),
           stack(222, 70), cable((208, 182), 'hand'), handle('hand')], dur=2.8)

EX['deadlift'] = dict(
    a=stand(torso=-28, leg=(15, 120, 0), arm={'to': down(-28, 64), 'bend': 'back'}, at=('ankle', (112, G))),
    b=stand(torso=-89, leg=(89, 91, 0), arm={'to': down(-89, 64), 'bend': 'back'}, at=('ankle', (112, G))),
    props=[floor(), plate('hand', r=17, layer=4)], dur=3.0, hold=.12)

EX['romanian-deadlift'] = dict(
    a=stand(torso=-88, leg=(86, 94, 0), arm={'to': down(-88, 64), 'bend': 'back'}, at=('ankle', (112, G))),
    b=stand(torso=-14, leg=(68, 98, 0), arm={'to': down(-14, 64), 'bend': 'back'}, at=('ankle', (112, G))),
    props=[floor(), plate('hand', r=16, layer=4)], dur=3.0)

# one-arm dumbbell row: knee + hand on the bench
_dbr = dict(torso=-8, leg={'to': (72, G), 'bend': 'fwd'}, leg2=(92, 180, 180),
            arm2={'to': (162, 176), 'bend': 'back'}, at=('hip', (92, 128)))
EX['db-row'] = dict(
    a=dict(_dbr, arm={'to': down(-8, 60), 'bend': 'up'}),
    b=dict(_dbr, arm={'to': ('t', -40, 14), 'bend': 'up'}),
    props=[floor(), bench(30, 182, 176, 182, legs=[46, 160]), dumbbell('hand', r=8)], dur=2.6)

_ibr_hip = (98, 150)


def _ibr_bench():
    u = vec(-30, 1)
    fr = (-u[1], u[0])
    p0 = add(add(_ibr_hip, mul(fr, 19)), mul(u, -8))
    p1 = add(p0, mul(u, 72))
    mid = add(p0, mul(u, 30))
    return [line(p0, p1, 8, 0, 'eq'), line(mid, (mid[0], FLOOR), 4, 0, 'eqs')]


_ibr = dict(torso=-30, leg={'to': (62, G), 'bend': 'fwd'}, at=('hip', _ibr_hip))
EX['incline-bench-db-row'] = dict(
    a=dict(_ibr, arm={'to': down(-30, 60), 'bend': 'up'}),
    b=dict(_ibr, arm={'to': ('t', -40, 14), 'bend': 'up'}),
    props=[floor(), *_ibr_bench(), dumbbell('hand', r=8)], dur=2.6)

EX['cable-pullover'] = dict(
    a=stand(torso=-76, leg=(84, 96, 0), arm=(-40, -30), at=('ankle', (96, G))),
    b=stand(torso=-76, leg=(84, 96, 0), arm=(80, 76), at=('ankle', (96, G))),
    props=[floor(), stack(224, 14), cable((214, 22), 'hand'), handle('hand', angle=0)], dur=2.8)

# inverted row: supine under a bar, heels on the floor (head left)
def _ir(theta):
    return dict(torso=180 + theta, head=-6, leg=(theta, theta, -70), at=('ankle', (212, G)))


_ir_bar = (J(_ir(18), 'shoulder')[0], 104)
EX['inverted-row'] = dict(
    a=dict(_ir(18), arm={'to': _ir_bar, 'bend': 'down'}),
    b=dict(_ir(33), arm={'to': _ir_bar, 'bend': 'down'}),
    props=[floor(), line(_ir_bar, (_ir_bar[0], FLOOR), 4, 0, 'eqs'), dot(_ir_bar, 5, 4, 'eqf')], dur=2.6)

# ======================================================================= LEGS
EX['back-squat'] = dict(
    a=stand(torso=-87, arm={'to': ('t', 1, -11), 'bend': 'down'}, at=('ankle', (128, G))),
    b=stand(torso=-52, arm={'to': ('t', 1, -11), 'bend': 'down'}, leg=(14, 116, 0), at=('ankle', (128, G))),
    props=[floor(), plate(bar_on_back, r=17, layer=2)], dur=2.8)

EX['smith-squat'] = dict(
    a=stand(torso=-89, arm={'to': ('t', 1, -11), 'bend': 'down'}, at=('ankle', (138, G))),
    b=stand(torso=-64, arm={'to': ('t', 1, -11), 'bend': 'down'}, leg=(10, 112, 0), at=('ankle', (138, G))),
    props=[floor(), rails(122), plate(bar_on_back, r=17, layer=2)], dur=2.8)


def lunge(hip_a, hip_b, front, back_ankle, back_foot=65, **kw):
    base = dict(torso=-90, arm=(93, 90),
                leg={'to': front, 'bend': 'fwd'},
                leg2={'to': back_ankle, 'bend': 'down', 'foot': back_foot})
    base.update(kw)
    return dict(base, at=('hip', hip_a)), dict(base, at=('hip', hip_b))


_la, _lb = lunge((118, 130), (114, 168), (150, G), (84, 206))
EX['lunge'] = dict(a=_la, b=_lb, props=[floor(), dumbbell('hand', r=8)], dur=2.6)

_sla, _slb = lunge((118, 130), (114, 168), (150, G), (84, 206), arm={'to': ('t', 1, -11), 'bend': 'down'})
EX['smith-lunge'] = dict(a=_sla, b=_slb,
                         props=[floor(), rails(108), plate(bar_on_back, r=17, layer=2)], dur=2.6)

_bsa, _bsb = lunge((114, 128), (106, 166), (130, G), (64, 170), back_foot=180)
EX['bulgarian-split-squat'] = dict(
    a=_bsa, b=_bsb,
    props=[floor(), bench(20, 180, 76, 180, legs=[30, 66]), dumbbell('hand', r=8)], dur=2.6)

_su = dict(torso=-86, arm=(94, 90))
EX['step-up'] = dict(
    a=dict(_su, leg={'to': (156, 192), 'bend': 'fwd'}, leg2={'to': (98, G), 'bend': 'fwd'}, at=('hip', (118, 150))),
    b=dict(_su, leg={'to': (156, 192), 'bend': 'fwd'}, leg2={'to': (140, 184), 'bend': 'fwd', 'foot': 30},
           at=('hip', (152, 100))),
    props=[floor(), box(128, 196, 192), dumbbell('hand', r=8)], dur=3.0)

# leg press (45° sled)
_lp = dict(torso=-135, head=8, arm=(70, 10), at=('hip', (92, 172)))


def _sled(P):
    t = P['toe'] if P.get('_sled_toe') else P['ankle']
    u = (0.707, -0.707)
    perp = (0.707, 0.707)
    c = add(t, mul(u, 6))
    return [(4.5, 'eq', 'path', {'stroke-width': 6}, {'d': seg_d(add(c, mul(perp, -22)), add(c, mul(perp, 14)))})]


def _lp_seat():
    hip = (92, 172)
    u = vec(-135, 1)
    back = (u[1], -u[0])
    p0 = add(hip, mul(back, 18))
    return [line(add(p0, mul(u, -10)), add(p0, mul(u, 70)), 8, 0, 'eq'),
            line((58, 196), (130, 196), 6, 0, 'eqs'), line((112, 196), (226, 82), 4, 0, 'eqs')]


EX['leg-press'] = dict(
    a=dict(_lp, leg={'to': (124, 140), 'bend': 'up', 'foot': -135}),
    b=dict(_lp, leg={'to': (156, 108), 'bend': 'up', 'foot': -135}),
    props=[floor(), *_lp_seat(), custom(_sled)], dur=2.8)

EX['leg-press-calf-raise'] = dict(
    a=dict(_lp, leg={'to': (156, 110), 'bend': 'up', 'foot': -150}),
    b=dict(_lp, leg={'to': (150, 116), 'bend': 'up', 'foot': -98}),
    props=[floor(), *_lp_seat(),
           custom(lambda P: [(4.5, 'eq', 'path', {'stroke-width': 6},
                              {'d': seg_d(add(P['toe'], (-6 - 16, -6 + 16)), add(P['toe'], (-6 + 14, -6 - 14)))})])],
    dur=2.2)

# leg extension / leg curl
def _unit_perp(a, b):
    d = sub(b, a)
    n = math.hypot(*d) or 1
    return (d[1] / n, -d[0] / n)


_le = dict(torso=-98, arm=(86, 50), at=('hip', (100, 150)))
EX['leg-extension'] = dict(
    a=dict(_le, leg=(2, 100, 10)),
    b=dict(_le, leg=(-4, -6, -80)),
    props=[floor(), line((58, 166), (124, 166), 8, 0, 'eq'), line((76, 160), (66, 92), 8, 0, 'eq'),
           line((100, 170), (100, FLOOR), 5, 0, 'eqs'),
           custom(lambda P: [(6, 'eq', 'path', {'stroke-width': 3.5}, {'d': seg_d(P['knee'], add(P['ankle'], mul(sub(P['ankle'], P['knee']), .04)))})]),
           pad(lambda P: add(P['ankle'], mul(_unit_perp(P['knee'], P['ankle']), 10)), r=7)],
    dur=2.4)


_lc = dict(torso=0, head=-14, arm=(96, -2), at=('hip', (118, 150)))
EX['leg-curl'] = dict(
    a=dict(_lc, leg=(180, 180, 90)),
    b=dict(_lc, leg=(180, 292, 200)),
    props=[floor(), line((24, 172), (214, 172), 8, 0, 'eq'), line((120, 176), (120, FLOOR), 5, 0, 'eqs'),
           pad(lambda P: add(P['ankle'], mul(_unit_perp(P['knee'], P['ankle']), 10)), r=7)],
    dur=2.4)

# calf raises: balls of the feet on a block
_cr = dict(torso=-90, leg=(90, 90, -18))
EX['calf-raise'] = dict(
    a=dict(_cr, arm={'to': ('t', 6, 10), 'bend': 'down'}, at=('toe', (140, 202))),
    b=dict(_cr, arm={'to': ('t', 6, 10), 'bend': 'down'}, leg=(90, 90, 52), at=('toe', (140, 202))),
    props=[floor(), box(126, 206, 172), line((86, 14), (86, FLOOR), 6, 0, 'eqs'),
           pad(lambda P: tp(P, 2, -2), r=8, layer=6),
           custom(lambda P: [(0, 'eq', 'path', {'stroke-width': 5}, {'d': seg_d((86, tp(P, 2, -2)[1]), tp(P, 2, -2))})])],
    dur=2.0)

EX['smith-calf-raise'] = dict(
    a=dict(_cr, arm={'to': ('t', 1, -11), 'bend': 'down'}, at=('toe', (140, 202))),
    b=dict(_cr, arm={'to': ('t', 1, -11), 'bend': 'down'}, leg=(90, 90, 52), at=('toe', (140, 202))),
    props=[floor(), box(126, 206, 172), rails(112), plate(bar_on_back, r=17, layer=2)], dur=2.0)

# glute bridge: shoulders on the floor, head left
_gb = dict(head=-4, leg={'to': (160, G), 'bend': 'up'}, at=('shoulder', (60, FLOOR - 13)))
EX['barbell-glute-bridge'] = dict(
    a=dict(_gb, torso=180, arm={'to': ('h', 0, 22), 'bend': 'down'}),
    b=dict(_gb, torso=153, arm={'to': ('h', 0, 22), 'bend': 'down'}),
    props=[floor(), plate(lambda P: tp(P, 0, 22, 'hip'), r=16, layer=5.25)], dur=2.6)

_slr = dict(leg2={'to': (64, 196), 'bend': 'down', 'foot': 60}, at=('ankle', (122, G)))
EX['single-leg-rdl'] = dict(
    a=stand(**_slr, torso=-88, leg=(88, 92, 0), arm={'to': down(-88, 62), 'bend': 'back'}),
    b=stand(**_slr, torso=-12, leg=(76, 96, 0), arm={'to': down(-12, 62), 'bend': 'back'}),
    props=[floor(), box(44, 204, 86), dumbbell('hand', r=8)], dur=3.0)

# hip abduction / adduction: seated, front view
_hab = dict(torso=-90, view='front', sl=.7, arm=(100, 84), arm2=(80, 96), at=('hip', (120, 154)))
_hab_props = [floor(), line((92, 170), (148, 170), 10, 0, 'eq'), line((120, 170), (120, FLOOR), 5, 0, 'eqs')]
EX['hip-abduction'] = dict(
    a=dict(_hab, leg=(70, 92, 0), leg2=(110, 88, 180)),
    b=dict(_hab, leg=(26, 104, 0), leg2=(154, 76, 180)),
    props=_hab_props + [pad(lambda P: add(P['knee'], (9, 0)), r=6), pad(lambda P: add(P['knee2'], (-9, 0)), r=6)],
    dur=2.4)
EX['hip-adduction'] = dict(
    a=dict(_hab, leg=(26, 104, 0), leg2=(154, 76, 180)),
    b=dict(_hab, leg=(70, 92, 0), leg2=(110, 88, 180)),
    props=_hab_props + [pad(lambda P: add(P['knee'], (-9, 0)), r=6), pad(lambda P: add(P['knee2'], (9, 0)), r=6)],
    dur=2.4)

# ================================================================== SHOULDERS
EX['overhead-press'] = dict(
    a=stand(torso=-90, arm={'to': ('t', 3, 16), 'bend': 'down'}),
    b=stand(torso=-92, head=-4, arm={'to': ('t', 65, 3), 'bend': 'down'}),
    props=[floor(), plate('hand', r=15, layer=5.3)], dur=2.6, zoom=.86)

_sdp = dict(torso=-88, leg=(0, 94, 0), at=('ankle', (156, G)))
_seat = [floor(), line((84, 196), (146, 196), 8, 0, 'eq'), line((112, 200), (112, FLOOR), 5, 0, 'eqs'),
         line((88, 192), (88, 100), 8, 0, 'eq')]
EX['seated-db-press'] = dict(
    a=dict(_sdp, arm={'to': ('t', 12, 8), 'bend': 'down'}),
    b=dict(_sdp, arm={'to': ('t', 64, 3), 'bend': 'down'}),
    props=_seat + [dumbbell('hand', r=8)], dur=2.6)

_fv = dict(torso=-90, view='front', leg=(86, 90, 0), leg2=(94, 90, 180), at=('hip', (120, 126)))
EX['lateral-raise'] = dict(
    a=dict(_fv, arm=(84, 86), arm2=(96, 94)),
    b=dict(_fv, arm=(-4, 4), arm2=(184, 176)),
    props=[floor(), dumbbell('hand', r=8), dumbbell('hand2', r=8)], dur=2.6)

EX['front-raise'] = dict(
    a=stand(arm=(80, 82)),
    b=stand(arm=(-2, -4)),
    props=[floor(), dumbbell('hand', r=8)], dur=2.6)

# rear-delt fly: bent over, seen from behind (torso foreshortened)
_rdf = dict(torso=-90, view='back', st=.55, hd=.35, head=0, leg=(88, 90, 0), leg2=(92, 90, 180), at=('hip', (120, 130)))
EX['rear-delt-fly'] = dict(
    a=dict(_rdf, arm=(94, 88), arm2=(86, 92)),
    b=dict(_rdf, arm=(-2, 8), arm2=(182, 172)),
    props=[floor(), dumbbell('hand', r=8), dumbbell('hand2', r=8)], dur=2.6)

EX['face-pull'] = dict(
    a=stand(torso=-93, arm={'to': ('t', 6, 62), 'bend': 'down'}, at=('ankle', (96, G))),
    b=stand(torso=-93, arm={'to': ('t', 14, 14), 'bend': 'up'}, at=('ankle', (96, G))),
    props=[floor(), stack(224, 14), cable((214, 66), 'hand'), handle('hand')], dur=2.6)

EX['upright-row'] = dict(
    a=stand(arm={'to': ('t', -60, 8), 'bend': 'back'}),
    b=stand(arm={'to': ('t', -6, 12), 'bend': 'up'}),
    props=[floor(), plate('hand', r=15, layer=5.3)], dur=2.4)

# ======================================================================= ARMS
EX['barbell-curl'] = dict(
    a=stand(arm=(96, 90)), b=stand(torso=-92, arm=(102, -62)),
    props=[floor(), plate('hand', r=14, layer=5.3)], dur=2.4)

EX['dumbbell-curl'] = dict(
    a=stand(arm=(94, 90)), b=stand(torso=-91, arm=(100, -60)),
    props=[floor(), dumbbell('hand', r=8)], dur=2.4)


def hammer_db(P):
    d = sub(P['hand'], P['elbow'])
    n = math.hypot(*d) or 1
    perp = (-d[1] / n, d[0] / n)
    a, b = add(P['hand'], mul(perp, 10)), add(P['hand'], mul(perp, -10))
    return [(5.3, 'eq', 'path', {'stroke-width': 4}, {'d': seg_d(a, b)}),
            (5.31, 'plate', 'circle', {'r': 6}, {'cx': f1(a[0]), 'cy': f1(a[1])}),
            (5.31, 'plate', 'circle', {'r': 6}, {'cx': f1(b[0]), 'cy': f1(b[1])})]


EX['hammer-curl'] = dict(
    a=stand(arm=(94, 90)), b=stand(torso=-91, arm=(100, -60)),
    props=[floor(), custom(hammer_db)], dur=2.4)

EX['tricep-pushdown'] = dict(
    a=stand(torso=-84, arm=(96, -24), at=('ankle', (104, G))),
    b=stand(torso=-84, arm=(96, 88), at=('ankle', (104, G))),
    props=[floor(), stack(182, 14), cable((174, 22), 'hand'), handle('hand', angle=0)], dur=2.2)

EX['overhead-tricep-ext'] = dict(
    a=stand(torso=-92, arm=(-82, -86)),
    b=stand(torso=-92, arm=(-80, -232)),
    props=[floor(), dumbbell('hand', r=9)], dur=2.6, zoom=.86)

EX['dips'] = dict(
    a=dict(torso=-86, arm=(92, 88), leg=(100, 150, 60), at=('hand', (124, 116))),
    b=dict(torso=-74, arm=(128, 40), leg=(104, 155, 60), at=('hand', (124, 116))),
    props=[floor(), line((88, 116), (200, 116), 6, 2, 'eq'), line((96, 116), (96, FLOOR), 4, 0, 'eqs'),
           line((192, 116), (192, FLOOR), 4, 0, 'eqs')], dur=2.6)

EX['bench-dip'] = dict(
    a=dict(torso=-90, arm=(100, 96), leg={'to': (200, G), 'bend': 'up', 'foot': -70}, at=('hand', (80, 162))),
    b=dict(torso=-88, arm=(176, 82), leg={'to': (200, G), 'bend': 'up', 'foot': -70}, at=('hand', (80, 162))),
    props=[floor(), bench(24, 168, 84, 168, legs=[32, 76])], dur=2.4)

# ======================================================================= CORE
def _plank_theta():
    best = None
    for k in range(0, 300):
        th = k / 20
        p = dict(torso=-th, leg=(180 - th, 180 - th, 100), arm=(94, -2), head=6, at=('elbow', (176, FLOOR - 6)))
        y = J(p, 'toe')[1]
        err = abs(y - (FLOOR - 4))
        if best is None or err < best[0]:
            best = (err, p)
    return best[1]


EX['plank'] = dict(a=_plank_theta(), props=[floor()])

_cr_base = dict(head=-10, leg={'to': (180, G), 'bend': 'up'}, at=('hip', (132, FLOOR - 14)))
EX['crunch'] = dict(
    a=dict(_cr_base, torso=180, arm={'to': ('t', 16, -4), 'bend': 'up'}),
    b=dict(_cr_base, torso=212, head=-24, arm={'to': ('t', 16, -4), 'bend': 'up'}),
    props=[floor()], dur=2.4)

_dc = dict(leg=(-34, 40, -30), at=('hip', (128, 136)))
EX['decline-crunch'] = dict(
    a=dict(_dc, torso=158, head=-6, arm={'to': ('t', -10, 14), 'bend': 'down'}),
    b=dict(_dc, torso=222, head=-20, arm={'to': ('t', -10, 14), 'bend': 'down'}),
    props=[floor(), line((136, 154), (34, 194), 8, 0, 'eq'), line((128, 158), (128, FLOOR), 4, 0, 'eqs'),
           line((48, 190), (48, FLOOR), 4, 0, 'eqs'),
           pad(lambda P: add(P['ankle'], mul(_unit_perp(P['knee'], P['ankle']), -9)), r=6)], dur=2.4)


def russian(t):
    s = math.sin(TWO_PI * t)
    wx, wy = 120 + 28 * s, 176
    return dict(torso=-90 + 7 * s, view='front', st=.8, hd=.9, head=-7 * s,
                leg=(-40, 70, 0), leg2=(-140, 110, 180), sl=.55,
                arm={'to': (wx + 6, wy), 'bend': 'down'}, arm2={'to': (wx - 6, wy), 'bend': 'down'},
                at=('hip', (120, 204)))


def _rt_weight(P):
    c = mid_hands(P)
    return [(5.3, 'plate', 'circle', {'r': 9}, {'cx': f1(c[0]), 'cy': f1(c[1])})]


EX['russian-twist'] = dict(cycle=russian, props=[floor(), custom(_rt_weight)], dur=2.4, frames=20)

_wc = dict(view='front', leg=(78, 90, 0), leg2=(102, 90, 180), at=('hip', (120, 126)))
EX['cable-woodchop'] = dict(
    a=dict(_wc, torso=-82, arm={'to': (190, 52), 'bend': 'up'}, arm2={'to': (180, 56), 'bend': 'up'}),
    b=dict(_wc, torso=-98, arm={'to': (76, 166), 'bend': 'down'}, arm2={'to': (66, 162), 'bend': 'down'}),
    props=[floor(), stack(222, 14), cable((214, 30), lambda P: mid_hands(P)), handle('hand', angle=0)], dur=2.6)

# ===================================================================== CARDIO
def run(t):
    ph = TWO_PI * t

    def legp(p):
        th = 90 - 32 * math.sin(p)
        knee = 18 + 62 * (0.5 + 0.5 * math.cos(p + 0.9))
        return (th, th + knee, 10 + 25 * max(0, math.sin(p + 2.2)))

    def armp(p):
        ua = 90 + 38 * math.sin(p)
        return (ua, ua - 88)
    bob = 3 * math.cos(2 * ph)
    return dict(torso=-80, head=-6, leg=legp(ph), leg2=legp(ph + math.pi),
                arm=armp(ph), arm2=armp(ph + math.pi), at=('hip', (112, 124 + bob)))


EX['treadmill-run'] = dict(
    cycle=run, dur=0.8, frames=16,
    props=[poly([(26, FLOOR - 4), (196, FLOOR - 4), (200, FLOOR + 2), (22, FLOOR + 2)], 0, 'eqf'),
           line((196, FLOOR - 4), (210, 112), 5, 0, 'eq'), line((210, 112), (182, 110), 5, 0, 'eq'),
           floor()])


def bike(t):
    cx, cy, r = 142, 192, 17
    a = TWO_PI * t
    p1 = (cx + r * math.cos(a), cy + r * math.sin(a))
    p2 = (cx - r * math.cos(a), cy - r * math.sin(a))
    return dict(torso=-48, head=-12, leg={'to': p1, 'bend': 'fwd', 'foot': 8}, leg2={'to': p2, 'bend': 'fwd', 'foot': 8},
                arm={'to': (178, 104), 'bend': 'down'}, at=('hip', (98, 122)))


EX['cycling'] = dict(
    cycle=bike, dur=1.2, frames=18,
    props=[floor(), dot((152, 196), 24, 0, 'eqfs'), line((98, 134), (124, 196), 6, 0, 'eq'), line((84, 132), (110, 132), 7, 0, 'eq'),
           line((124, 196), (178, 106), 6, 0, 'eq'), line((176, 104), (190, 104), 6, 0, 'eq'),
           line((70, FLOOR), (200, FLOOR), 6, 0, 'eq'), line((124, 196), (100, FLOOR), 5, 0, 'eqs'),
           custom(lambda P: [(2, 'eq', 'path', {'stroke-width': 3.5}, {'d': seg_d(P['ankle2'], P['ankle'])})])])


def _row_keys():
    def p(torso, hip_x, hand, bend='down'):
        return dict(torso=torso, head=-4, leg={'to': (178, 186), 'bend': 'up', 'foot': -72},
                    arm={'to': hand, 'bend': bend}, at=('hip', (hip_x, 180)))
    catch = p(-58, 112, (178, 160))
    drive = p(-80, 64, (150, 150))
    fin0 = p(-108, 58, (0, 0))
    fin_hand = add(J(fin0, 'shoulder'), (22, 34))
    finish = p(-108, 58, fin_hand, 'back')
    recov = p(-80, 66, (140, 154))
    return [(0, catch), (.32, drive), (.5, finish), (.66, recov), (1, catch)]


EX['rowing-machine'] = dict(
    cycle=piecewise(_row_keys()), dur=2.6, frames=24,
    props=[line((26, 202), (196, 202), 5, 0, 'eq'), dot((206, 176), 18, 0, 'eqfs'),
           line((180, 162), (180, 206), 6, 0, 'eq'), floor(),
           custom(lambda P: [(2, 'eq', 'path', {'stroke-width': 7}, {'d': seg_d(add(P['hip'], (-14, 17)), add(P['hip'], (14, 17)))})]),
           cable((196, 172), 'hand', layer=4, pulley=False), handle('hand')])


def jump(t):
    a = TWO_PI * t
    hop = 8 * max(0.0, math.cos(a)) ** 1.5      # airborne while the rope passes under
    kb = 10 * (1 - max(0.0, math.cos(a)))
    return dict(torso=-88, head=-2, leg=(88 - kb * .4, 92 + kb, 48), arm=(100, 30),
                at=('toe', (126, FLOOR - 4 - hop)))


def _rope(P):
    """Rope seen from the side: one arc from the hands to the tip, which
    circles the body (over the head, under the feet); P['_t'] = phase."""
    a = TWO_PI * P['_t'] + math.pi / 2          # tip starts under the feet
    c = add(P['hip'], (-2, -8))
    rx, ry = 42, 118

    def e(k, s=1.0):
        return (c[0] + rx * s * math.cos(a + k), c[1] + ry * s * math.sin(a + k))
    tip, ctl = e(0), e(-0.7, 1.15)
    h = P['hand']
    d = f"M{f1(h[0])},{f1(h[1])} Q{f1(ctl[0])},{f1(ctl[1])} {f1(tip[0])},{f1(tip[1])}"
    return [(5.3, 'rope', 'path', {}, {'d': d})]


EX['jump-rope'] = dict(cycle=jump, dur=0.6, frames=14, props=[floor(), custom(_rope)])


def stepper(t):
    a = TWO_PI * t
    y1 = 186 + 18 * math.sin(a)
    y2 = 186 - 18 * math.sin(a)
    return dict(torso=-84, head=-4, leg={'to': (138, y1), 'bend': 'fwd'}, leg2={'to': (138, y2), 'bend': 'fwd'},
                arm={'to': (172, 118), 'bend': 'down'}, at=('hip', (112, 112)))


EX['stair-stepper'] = dict(
    cycle=stepper, dur=1.4, frames=18,
    props=[floor(), line((186, FLOOR), (186, 112), 6, 0, 'eq'), line((186, 114), (166, 116), 6, 0, 'eq'),
           line((96, FLOOR), (186, FLOOR), 8, 0, 'eq'),
           custom(lambda P: [(4.5, 'eq', 'path', {'stroke-width': 5}, {'d': seg_d(add(P['ankle'], (-8, 5)), add(P['ankle'], (24, 5)))}),
                             (0.5, 'eqs', 'path', {'stroke-width': 5}, {'d': seg_d(add(P['ankle2'], (-8, 5)), add(P['ankle2'], (24, 5)))})])])

# ===================================================================== WARMUP
_be = dict(leg=(135, 135, 225), arm={'to': ('t', -12, 14), 'bend': 'down'}, at=('hip', (124, 112)))
EX['back-extension'] = dict(
    a=dict(_be, torso=72, head=10),
    b=dict(_be, torso=-45, head=-6),
    props=[floor(), pad(lambda P: add(P['hip'], (4, 19)), r=9, layer=6),
           pad(lambda P: add(P['ankle'], (8, 8)), r=6, layer=6),
           line((128, 134), (66, 196), 6, 0, 'eq'), line((66, 196), (66, FLOOR), 5, 0, 'eqs'),
           line((128, 134), (150, FLOOR), 5, 0, 'eqs')], dur=2.8)

_hbe = dict(leg=(180, 180, -90), arm={'to': ('t', -12, 14), 'bend': 'down'}, at=('hip', (116, 120)))
EX['horizontal-back-extension'] = dict(
    a=dict(_hbe, torso=94, head=8),
    b=dict(_hbe, torso=-2, head=-8),
    props=[floor(), pad(lambda P: add(P['hip'], (4, 20)), r=9, layer=6),
           pad(lambda P: add(P['ankle'], (0, 10)), r=6, layer=6),
           line((20, 142), (120, 142), 7, 0, 'eq'), line((40, 142), (40, FLOOR), 5, 0, 'eqs'),
           line((112, 142), (112, FLOOR), 5, 0, 'eqs')], dur=2.8)

EX['band-arm-warmup'] = dict(
    a=dict(_fv, arm=(2, -2), arm2=(178, 182), sa=.14),
    b=dict(_fv, arm=(4, 0), arm2=(176, 180), sa=1),
    props=[floor(), custom(lambda P: [(5.3, 'm1', 'path', {'stroke-width': 3.5}, {'d': seg_d(P['hand'], P['hand2'])})])],
    dur=2.4)
