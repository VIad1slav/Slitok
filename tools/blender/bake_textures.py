"""Этап текстур: процедурные материалы (Shader Editor через Python) → запекание Cycles → PNG в assets/textures/.

Запуск из корня проекта:
    blender --background --python tools/blender/bake_textures.py [-- only=gold,skin,...] [-- nopreview]

Что получается:
    gold / skin / glove               — 2048 px: *_albedo.png, *_normal.png (OpenGL), *_orm.png (R=AO, G=roughness, B=metalness)
    wood_table / wall_concrete /
    floor_tiles / velvet_red          — 1024 px, бесшовные, тот же набор
    glass_smudges.png                 — шероховатость стекла (разводы, пыль, отпечатки)
    glass_cracks_1..3.png             — три стадии трещин с альфа-каналом
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402
import models as M  # noqa: E402

HERO = 2048
ENV = 1024
SAMPLES = 128


# ---------------------------------------------------------------------------
# Маркировка слитка: рендерим текст сверху в чёрно-белую маску
# ---------------------------------------------------------------------------
def render_stamp(bar_cfg):
    C.reset_scene()
    C.setup_cycles(32)
    scene = bpy.context.scene
    tl, tw = M.bar_top_size(bar_cfg)
    white = bpy.data.materials.new("white")
    nt = C.NT(white)
    nt.output({"color": (1, 1, 1, 1)}, "color")

    def text(body, size, x, y):
        cu = bpy.data.curves.new("txt", "FONT")
        cu.body = body
        cu.size = size
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        ob = bpy.data.objects.new("txt", cu)
        scene.collection.objects.link(ob)
        ob.location = (x, y, 0)
        ob.data.materials.append(white)

    text("FINE GOLD", 0.0105, 0.012, 0.0155)
    text("999.9", 0.0185, 0.012, -0.0015)
    text("No GG-004871   1000 g", 0.0062, 0.012, -0.0185)
    text("GG", 0.0105, -0.068, -0.0008)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.0125, minor_radius=0.0009, major_segments=64, minor_segments=8, location=(-0.068, 0, 0))
    bpy.context.active_object.data.materials.append(white)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.0148, minor_radius=0.0005, major_segments=64, minor_segments=8, location=(-0.068, 0, 0))
    bpy.context.active_object.data.materials.append(white)

    world = bpy.data.worlds.new("black")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    scene.world = world
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = tl
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, 0, 1)
    scene.camera = cam
    scene.render.resolution_x = 2048
    scene.render.resolution_y = int(round(2048 * tw / tl))
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = "PNG"
    path = os.path.join(C.CACHE, "stamp.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[stamp]", C.rel(path))
    return path


# ---------------------------------------------------------------------------
# Материалы героев (координаты объекта → швов на развёртке не видно)
# ---------------------------------------------------------------------------
def mat_gold(nt, stamp_path, bar_cfg):
    tl, tw = M.bar_top_size(bar_cfg)
    P = nt.coords("Object")
    px, py, pz = nt.sep(P)
    _, _, nz = nt.sep(nt.coords("Normal"))

    big = nt.noise(P, 16, 4, 0.55)
    # царапины: три слоя шума, сильно вытянутого вдоль своего направления
    scr = None
    for rot, sc, lo in (((0, 0, 0.35), (1100, 22, 1100), 0.66), ((0, 0.3, 1.5), (800, 16, 800), 0.69), ((0.4, 0, 2.6), (1400, 30, 1400), 0.68)):
        line = nt.smoothstep(nt.noise(nt.mapping(P, rot=rot, scale=sc), 1.0, 2, 0.6), lo, lo + 0.07)
        scr = line if scr is None else nt.maxf(scr, line)
    micro = nt.noise(nt.mapping(P, rot=(0, 0, 0.1), scale=(3200, 70, 3200)), 1.0, 1, 0.5)
    edge = nt.smoothstep(nt.geometry("Pointiness"), 0.515, 0.6)          # потёртости на рёбрах

    # выбитая маркировка на верхней грани
    stamp_img = bpy.data.images.load(stamp_path, check_existing=True)
    stamp_img.colorspace_settings.name = "Non-Color"
    uvw = nt.comb(nt.add(nt.math("DIVIDE", px, tl), 0.5), nt.add(nt.math("DIVIDE", py, tw), 0.5), 0.0)
    top = nt.smoothstep(nz, 0.9, 0.98)
    stamp = nt.mul(nt.sep(nt.image(stamp_img, uvw))[0], top)

    # отпечаток пальца: эллипс из дуг на верхней грани
    qx, qy = nt.math("DIVIDE", nt.sub(px, 0.058), 0.011), nt.math("DIVIDE", nt.add(py, 0.006), 0.015)
    d = nt.math("SQRT", nt.add(nt.mul(qx, qx), nt.mul(qy, qy)))
    d2 = nt.math("SQRT", nt.add(nt.mul(qx, qx), nt.mul(nt.add(qy, 0.45), nt.add(qy, 0.45))))
    rings = nt.smoothstep(nt.math("SINE", nt.add(nt.mul(d2, 34.0), nt.mul(nt.noise(P, 90, 2, 0.5), 14.0))), -0.1, 0.5)
    fprint = nt.mul(nt.mul(rings, nt.sub(1.0, nt.smoothstep(d, 0.75, 1.0))), top)

    col = nt.mix(big, (1.0, 0.70, 0.26, 1), (1.0, 0.79, 0.36, 1))
    col = nt.mix(nt.mul(scr, 0.35), col, (1.0, 0.88, 0.55, 1))
    col = nt.mix(nt.mul(stamp, 0.45), col, (0.62, 0.40, 0.12, 1))
    col = nt.mix(nt.mul(edge, 0.3), col, (1.0, 0.9, 0.6, 1))
    rough = nt.add(0.17, nt.mul(big, 0.07))
    rough = nt.add(rough, nt.mul(scr, 0.24))
    rough = nt.add(rough, nt.mul(micro, 0.06))
    rough = nt.add(rough, nt.mul(stamp, 0.22))
    rough = nt.sat(nt.add(rough, nt.mul(fprint, 0.09)))
    n1 = nt.bump(nt.mul(stamp, -1.0), strength=1.0, distance=0.0007)
    n2 = nt.bump(nt.sub(nt.mul(micro, 0.25), scr), strength=0.5, distance=0.00012, normal=n1)
    return dict(color=col, rough=rough, metal=1.0, normal=n2)


def _joint_masks(nt, P):
    """Маски суставов: (костяшки и фаланги по отдельности, все вместе). Радиус влияния ~ радиус сустава."""
    knuckles = mids = None
    for name, (pts, radii) in M.hand_chains().items():
        for i in (0, 1, 2):
            if name == "thumb" and i == 0:
                continue
            dist = nt.vmath("DISTANCE", P, tuple(pts[i]))
            m = nt.sub(1.0, nt.smoothstep(dist, radii[i] * 0.5, radii[i] * 1.55))
            if i == 0:
                knuckles = m if knuckles is None else nt.maxf(knuckles, m)
            else:
                mids = m if mids is None else nt.maxf(mids, m)
    return knuckles, mids


def _nails(nt, P):
    """Маска ногтей: эллипс на тыльной стороне последней фаланги каждого пальца."""
    total = None
    for name, (pts, radii) in M.hand_chains().items():
        d = (pts[3] - pts[2]).normalized()
        side = d.cross(Vector((0, 0, 1))).normalized()
        up = side.cross(d).normalized()
        if name == "thumb":   # ноготь большого пальца смотрит вверх-вбок
            up = (Vector((0, 0, 1)) - d * d.z).normalized()
            side = d.cross(up).normalized()
        length = (pts[3] - pts[2]).length
        c = pts[2] + d * length * 0.68
        q = nt.vmath("SUBTRACT", P, tuple(c))
        a = nt.math("DIVIDE", nt.vmath("DOT_PRODUCT", q, tuple(d)), length * 0.47)
        s = nt.math("DIVIDE", nt.vmath("DOT_PRODUCT", q, tuple(side)), radii[3] * 0.92)
        h = nt.vmath("DOT_PRODUCT", q, tuple(up))
        e = nt.add(nt.mul(a, a), nt.mul(s, s))
        m = nt.mul(nt.sub(1.0, nt.smoothstep(e, 0.72, 1.0)), nt.smoothstep(h, radii[3] * 0.25, radii[3] * 0.5))
        total = m if total is None else nt.maxf(total, m)
    return total


def mat_skin(nt):
    P = nt.coords("Object")
    px, py, pz = nt.sep(P)
    _, _, nz = nt.sep(nt.coords("Normal"))
    dorsal = nt.smoothstep(nz, -0.25, 0.3)                       # 1 — тыльная сторона, 0 — ладонь
    big = nt.noise(P, 11, 3, 0.55)
    mid = nt.noise(P, 70, 3, 0.55)
    knuckles, mids = _joint_masks(nt, P)
    nails = _nails(nt, P)
    on_hand = nt.smoothstep(py, -0.03, 0.02)

    col = nt.ramp(big, [(0.25, (0.47, 0.21, 0.125)), (0.75, (0.60, 0.29, 0.18))])
    col = nt.mix(nt.sub(1.0, dorsal), col, (0.66, 0.33, 0.24, 1))                 # ладонь светлее и розовее
    col = nt.mix(nt.mul(nt.sub(mid, 0.45), 0.7), col, (0.42, 0.15, 0.10, 1))       # пятнистость
    red = nt.mul(nt.maxf(knuckles, nt.mul(mids, 0.8)), dorsal)
    col = nt.mix(nt.mul(red, 0.6), col, (0.52, 0.12, 0.09, 1))                    # краснота на костяшках
    tips = nt.mul(nt.smoothstep(py, 0.15, 0.19), nt.sub(1.0, dorsal))
    col = nt.mix(nt.mul(tips, 0.4), col, (0.62, 0.18, 0.15, 1))
    vein_n = nt.noise(nt.mapping(P, scale=(26, 9, 26)), 1.0, 2, 0.5, distortion=1.2)
    veins = nt.mul(nt.mul(nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.sub(vein_n, 0.5)), 0.0, 0.035)), dorsal), nt.sub(1.0, nt.smoothstep(py, 0.06, 0.1)))
    col = nt.mix(nt.mul(veins, 0.14), col, (0.30, 0.24, 0.33, 1))
    nail_tip = nt.mul(nails, nt.smoothstep(nt.noise(P, 30, 0, 0.5), 0.3, 0.7))
    nail_col = nt.mix(nt.mul(nail_tip, 0.2), (0.70, 0.40, 0.34, 1), (0.85, 0.70, 0.64, 1))
    col = nt.mix(nails, col, nail_col)

    rough = nt.add(0.5, nt.mul(mid, 0.14))
    rough = nt.sub(rough, nt.mul(nt.sub(1.0, dorsal), 0.06))
    rough = nt.mixf(nails, rough, 0.22)

    pores = nt.voronoi(P, 1500, "F1")
    # складки кожи на суставах: волны поперёк пальца
    folds = nt.mul(nt.math("SINE", nt.mul(py, 2400.0)), nt.mul(nt.maxf(mids, nt.mul(knuckles, 0.6)), on_hand))
    lines = nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.sub(nt.noise(nt.mapping(P, scale=(160, 420, 160)), 1.0, 2, 0.5), 0.5)), 0.0, 0.03))
    height = nt.add(nt.mul(pores, 0.5), nt.mul(folds, 0.5))
    height = nt.sub(height, nt.mul(lines, 0.4))
    height = nt.add(nt.mul(height, nt.sub(1.0, nails)), nt.mul(nails, 1.2))
    normal = nt.bump(height, strength=0.55, distance=0.00035)
    return dict(color=col, rough=rough, metal=0.0, normal=normal)


def mat_glove(nt, light=False):
    """light=True — светлый вариант цвета под подкраску в игре (цветные перчатки): тот же рисунок, в 13 раз светлее."""
    P = nt.coords("Object")
    px, py, pz = nt.sep(P)
    _, _, nz = nt.sep(nt.coords("Normal"))
    dorsal = nt.smoothstep(nz, -0.2, 0.25)
    knuckles, mids = _joint_masks(nt, P)
    weave = nt.voronoi(P, 1100, "F1")
    cloth_n = nt.noise(P, 40, 3, 0.6)

    guard = nt.mul(nt.smoothstep(knuckles, 0.25, 0.4), dorsal)                       # резиновые накладки на костяшках
    ribs = nt.mul(nt.mul(nt.smoothstep(mids, 0.2, 0.5), dorsal), nt.smoothstep(nt.math("SINE", nt.mul(py, 1500.0)), -0.2, 0.2))
    palm = nt.mul(nt.sub(1.0, dorsal), nt.smoothstep(py, -0.005, 0.01))               # ладонь: кожа с пупырышками
    dots = nt.mul(nt.sub(1.0, nt.smoothstep(nt.voronoi(P, 320, "F1"), 0.25, 0.4)), palm)
    strap = nt.mul(nt.smoothstep(py, -0.052, -0.048), nt.sub(1.0, nt.smoothstep(py, -0.02, -0.016)))  # ремешок на запястье
    stitch = nt.maxf(nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.add(py, 0.045)), 0.0, 0.0012)), nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.add(py, 0.0235)), 0.0, 0.0012)))
    stitch = nt.mul(stitch, nt.smoothstep(nt.math("SINE", nt.mul(nt.math("ARCTAN2", pz, px), 46.0)), 0.0, 0.3))
    seam = nt.mul(nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nz), 0.0, 0.07)), nt.smoothstep(py, 0.085, 0.1))   # швы по бокам пальцев
    tag = nt.mul(nt.mul(nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", px), 0.011, 0.012)), nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.sub(py, 0.04)), 0.006, 0.007))), dorsal)
    cuff = nt.sub(1.0, nt.smoothstep(py, -0.29, -0.28))

    col = nt.mix(cloth_n, (0.016, 0.016, 0.019, 1), (0.034, 0.034, 0.04, 1))
    col = nt.mix(nt.mul(weave, 0.35), col, (0.05, 0.05, 0.056, 1))
    col = nt.mix(palm, col, (0.045, 0.043, 0.045, 1))
    col = nt.mix(dots, col, (0.018, 0.018, 0.02, 1))
    col = nt.mix(guard, col, (0.055, 0.055, 0.06, 1))
    col = nt.mix(strap, col, (0.06, 0.06, 0.066, 1))
    col = nt.mix(nt.maxf(stitch, nt.mul(seam, 0.6)), col, (0.22, 0.22, 0.23, 1))
    if light:
        col = nt.mix(1.0, col, (13.0, 13.0, 13.0, 1), "MULTIPLY")
    col = nt.mix(tag, col, (0.8, 0.8, 0.8, 1) if light else (0.85, 0.36, 0.04, 1))
    col = nt.mix(cuff, col, (0.6, 0.6, 0.6, 1) if light else (0.05, 0.05, 0.055, 1))

    rough = nt.add(0.82, nt.mul(cloth_n, 0.12))
    rough = nt.mixf(palm, rough, 0.62)
    rough = nt.mixf(dots, rough, 0.4)
    rough = nt.mixf(guard, rough, 0.36)
    rough = nt.mixf(strap, rough, 0.5)
    height = nt.mul(weave, 0.25)
    height = nt.add(height, nt.mul(guard, 1.6))
    height = nt.add(height, nt.mul(ribs, 0.8))
    height = nt.add(height, nt.mul(dots, 0.7))
    height = nt.add(height, nt.mul(strap, 1.2))
    height = nt.add(height, nt.mul(nt.maxf(stitch, seam), 0.6))
    normal = nt.bump(height, strength=0.7, distance=0.0006)
    return dict(color=col, rough=rough, metal=0.0, normal=normal)


def mat_vase(nt):
    """Фарфор: белая глазурь, кобальтовые пояски и волна, тонкая сетка кракелюра."""
    P = nt.coords("Object")
    px, py, pz = nt.sep(P)
    ang = nt.math("ARCTAN2", py, px)
    h = nt.add(pz, M.VASE_HEIGHT / 2)                                   # высота от дна, м
    band = lambda lo, hi: nt.mul(nt.smoothstep(h, lo, lo + 0.0015), nt.sub(1.0, nt.smoothstep(h, hi, hi + 0.0015)))  # noqa: E731
    lines = nt.maxf(nt.maxf(band(0.028, 0.032), band(0.072, 0.076)), band(0.128, 0.134))
    wave_h = nt.add(0.052, nt.mul(nt.math("SINE", nt.mul(ang, 8.0)), 0.012))
    wave = nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.sub(h, wave_h)), 0.0018, 0.0032))
    dots = nt.mul(nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.sub(h, 0.092)), 0.0, 0.004)), nt.smoothstep(nt.math("SINE", nt.mul(ang, 24.0)), 0.55, 0.8))
    paint = nt.sat(nt.maxf(nt.maxf(lines, wave), dots))
    crackle = nt.sub(1.0, nt.smoothstep(nt.voronoi(P, 260, "DISTANCE_TO_EDGE"), 0.0, 0.018))
    tone = nt.noise(P, 30, 3, 0.5)
    col = nt.mix(tone, (0.80, 0.80, 0.74, 1), (0.88, 0.88, 0.84, 1))
    col = nt.mix(nt.mul(crackle, 0.22), col, (0.45, 0.42, 0.36, 1))
    col = nt.mix(paint, col, (0.02, 0.06, 0.32, 1))
    rough = nt.sat(nt.add(nt.add(0.08, nt.mul(tone, 0.05)), nt.mul(crackle, 0.12)))
    height = nt.sub(nt.mul(paint, 0.3), crackle)
    return dict(color=col, rough=rough, metal=0.0, normal=nt.bump(height, strength=0.25, distance=0.0003))


def mat_crown(nt):
    """Золото с чеканкой; камни на ободе — рубины и сапфиры через один; жемчужины на зубцах."""
    c = M.CROWN
    P = nt.coords("Object")
    px, py, pz = nt.sep(P)
    spikes, gems = M.crown_points()
    ruby = sapphire = pearl = None
    r_gem = c["radius"] + c["band"] / 2
    for i, a in enumerate(gems):
        d = nt.vmath("DISTANCE", P, (r_gem * math.cos(a), r_gem * math.sin(a), (c["mid"] + c["low"]) / 2))
        m = nt.sub(1.0, nt.smoothstep(d, 0.0068, 0.0082))
        if i % 2 == 0:
            ruby = m if ruby is None else nt.maxf(ruby, m)
        else:
            sapphire = m if sapphire is None else nt.maxf(sapphire, m)
    for a in spikes:
        d = nt.vmath("DISTANCE", P, (c["radius"] * math.cos(a), c["radius"] * math.sin(a), c["high"] - 0.004))
        m = nt.sub(1.0, nt.smoothstep(d, 0.0055, 0.0068))
        pearl = m if pearl is None else nt.maxf(pearl, m)
    stone = nt.maxf(ruby, sapphire)
    nonmetal = nt.maxf(stone, pearl)
    big = nt.noise(P, 40, 3, 0.55)
    chase = nt.voronoi(P, 520, "F1")                                           # мелкая чеканка
    engr = nt.mul(nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.add(pz, 0.0155)), 0.0, 0.0012)), nt.smoothstep(pz, c["low"], c["low"] + 0.002))
    col = nt.mix(big, (1.0, 0.68, 0.24, 1), (1.0, 0.78, 0.34, 1))
    col = nt.mix(nt.mul(engr, 0.5), col, (0.5, 0.3, 0.08, 1))
    col = nt.mix(ruby, col, (0.55, 0.012, 0.03, 1))
    col = nt.mix(sapphire, col, (0.02, 0.07, 0.5, 1))
    col = nt.mix(pearl, col, (0.86, 0.84, 0.78, 1))
    rough = nt.add(0.2, nt.mul(big, 0.1))
    rough = nt.mixf(stone, rough, 0.06)
    rough = nt.mixf(pearl, rough, 0.28)
    metal = nt.sub(1.0, nonmetal)
    height = nt.sub(nt.mul(chase, 0.3), nt.mul(engr, 1.0))
    height = nt.mul(height, nt.sub(1.0, nonmetal))
    return dict(color=col, rough=rough, metal=metal, normal=nt.bump(height, strength=0.4, distance=0.0003))


def mat_chips(nt):
    """Фишки: цвет чередуется по высоте стопки, белые вставки по ободу, кольцо на верхней фишке."""
    P = nt.coords("Object")
    px, py, pz = nt.sep(P)
    _, _, nz = nt.sep(nt.coords("Normal"))
    n, h = M.CHIP["count"], M.CHIP["height"]
    level = nt.math("DIVIDE", nt.add(pz, h / 2), h / n)                 # 0..n — номер фишки снизу
    odd = nt.math("FLOOR", nt.math("MODULO", level, 2.0))               # чётные красные, нечётные тёмные
    gap = nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.sub(nt.math("FRACT", level), 0.5)), 0.42, 0.5))
    ang = nt.math("ARCTAN2", py, px)
    side = nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nz), 0.3, 0.6))
    inserts = nt.mul(nt.smoothstep(nt.math("SINE", nt.add(nt.mul(ang, 6.0), nt.mul(odd, 0.5))), 0.55, 0.7), side)
    top = nt.smoothstep(nz, 0.8, 0.95)
    r = nt.math("SQRT", nt.add(nt.mul(px, px), nt.mul(py, py)))
    ring = nt.mul(nt.mul(nt.smoothstep(r, 0.0125, 0.0135), nt.sub(1.0, nt.smoothstep(r, 0.0165, 0.0175))), top)
    dots = nt.mul(nt.mul(nt.smoothstep(nt.math("SINE", nt.mul(ang, 8.0)), 0.6, 0.8), nt.mul(nt.smoothstep(r, 0.018, 0.019), top)), 1.0)
    col = nt.mix(odd, (0.45, 0.012, 0.016, 1), (0.02, 0.02, 0.026, 1))
    col = nt.mix(nt.maxf(nt.maxf(inserts, ring), dots), col, (0.82, 0.8, 0.74, 1))
    col = nt.mix(nt.mul(gap, nt.mul(side, 0.8)), col, (0.006, 0.006, 0.006, 1))
    rough = nt.sat(nt.add(0.32, nt.mul(nt.noise(P, 300, 2, 0.5), 0.12)))
    height = nt.sub(nt.mul(ring, 0.5), nt.mul(gap, side))
    return dict(color=col, rough=rough, metal=0.0, normal=nt.bump(height, strength=0.4, distance=0.0003))


def mat_dice(nt):
    """Кубик: слоновая кость, чёрные вдавленные точки."""
    P = nt.coords("Object")
    pips = None
    for c in M.dice_pips():
        m = nt.sub(1.0, nt.smoothstep(nt.vmath("DISTANCE", P, c), 0.0031, 0.0038))
        pips = m if pips is None else nt.maxf(pips, m)
    tone = nt.noise(P, 60, 3, 0.5)
    col = nt.mix(tone, (0.78, 0.76, 0.68, 1), (0.86, 0.85, 0.79, 1))
    col = nt.mix(pips, col, (0.012, 0.012, 0.014, 1))
    rough = nt.mixf(pips, nt.add(0.22, nt.mul(tone, 0.08)), 0.45)
    return dict(color=col, rough=rough, metal=0.0, normal=nt.bump(nt.mul(pips, -1.0), strength=0.5, distance=0.0005))


# ---------------------------------------------------------------------------
# Бесшовные материалы окружения (UV-квадрат намотан на 4D-тор)
# ---------------------------------------------------------------------------
def _hash(nt, value, seed):
    return nt.math("FRACT", nt.mul(nt.math("SINE", nt.add(nt.mul(value, 12.9898), seed)), 43758.5453))


def mat_wood(nt):
    v, u, _ = nt.sep(nt.coords("UV"))            # доски идут вдоль U текстуры (длинная сторона стола)
    pu = nt.mul(u, 4.0)
    fr = nt.math("FRACT", pu)
    groove = nt.sub(1.0, nt.smoothstep(nt.minf(fr, nt.sub(1.0, fr)), 0.0, 0.014))
    rnd = _hash(nt, nt.math("FLOOR", pu), 4.1)
    vec, w = nt.torus(2.4, 30.0)
    w2 = nt.add(w, nt.mul(rnd, 6.0))
    grain = nt.noise(vec, 1.0, 5, 0.62, w=w2, distortion=0.7)
    rings = nt.add(0.5, nt.mul(nt.math("SINE", nt.mul(grain, 46.0)), 0.5))
    tone = nt.sat(nt.add(nt.mul(grain, 0.6), nt.mul(rings, 0.4)))
    vf, wf = nt.torus(14.0, 240.0)
    pores = nt.noise(vf, 1.0, 2, 0.5, w=wf)
    vs, ws = nt.torus(5.0, 5.0)
    smudge = nt.noise(vs, 1.0, 3, 0.5, w=ws)

    col = nt.ramp(tone, [(0.0, (0.022, 0.008, 0.004)), (0.5, (0.085, 0.030, 0.013)), (1.0, (0.19, 0.075, 0.032))])
    col = nt.mix(nt.mul(rnd, 0.35), col, (0.035, 0.012, 0.006, 1))
    col = nt.mix(nt.mul(groove, 0.85), col, (0.006, 0.003, 0.002, 1))
    rough = nt.add(0.15, nt.mul(pores, 0.09))
    rough = nt.add(rough, nt.mul(smudge, 0.09))
    rough = nt.sat(nt.add(rough, nt.mul(groove, 0.45)))
    height = nt.sub(nt.add(nt.mul(grain, 0.06), nt.mul(pores, 0.04)), groove)
    return dict(color=col, rough=rough, metal=0.0, normal=nt.bump(height, strength=0.5, distance=0.0012))


def mat_concrete(nt):
    u, v, _ = nt.sep(nt.coords("UV"))
    vec, w = nt.torus(4.0, 4.0)
    big = nt.noise(vec, 1.0, 6, 0.62, w=w)
    stains = nt.noise(vec, 0.6, 3, 0.5, w=nt.add(w, 3.7))
    vf, wf = nt.torus(70.0, 70.0)
    grain = nt.noise(vf, 1.0, 2, 0.5, w=wf)
    vp, wp = nt.torus(30.0, 30.0)
    pits = nt.mul(nt.sub(1.0, nt.smoothstep(nt.voronoi(vp, 1.0, "F1", w=wp), 0.05, 0.13)), nt.smoothstep(nt.noise(vec, 2.2, 2, 0.5, w=nt.add(w, 9.1)), 0.45, 0.6))
    # швы опалубки по краю плитки 2 × 2 м и отверстия от стяжек
    eu, ev = nt.minf(u, nt.sub(1.0, u)), nt.minf(v, nt.sub(1.0, v))
    seam = nt.sub(1.0, nt.smoothstep(nt.minf(eu, ev), 0.0, 0.004))
    holes = None
    for cx, cy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
        dx, dy = nt.sub(u, cx), nt.sub(v, cy)
        h = nt.sub(1.0, nt.smoothstep(nt.math("SQRT", nt.add(nt.mul(dx, dx), nt.mul(dy, dy))), 0.008, 0.011))
        holes = h if holes is None else nt.maxf(holes, h)
    dark = nt.maxf(seam, holes)

    col = nt.ramp(big, [(0.25, (0.115, 0.112, 0.106)), (0.75, (0.235, 0.228, 0.215))])
    col = nt.mix(nt.mul(nt.smoothstep(stains, 0.5, 0.75), 0.45), col, (0.07, 0.066, 0.06, 1))
    col = nt.mix(nt.mul(grain, 0.18), col, (0.3, 0.3, 0.29, 1))
    col = nt.mix(nt.mul(nt.maxf(pits, dark), 0.75), col, (0.03, 0.03, 0.03, 1))
    rough = nt.sat(nt.add(0.8, nt.mul(grain, 0.16)))
    height = nt.add(nt.mul(big, 0.35), nt.mul(grain, 0.1))
    height = nt.sub(height, nt.add(nt.mul(pits, 0.7), nt.mul(dark, 1.0)))
    return dict(color=col, rough=rough, metal=0.0, normal=nt.bump(height, strength=0.8, distance=0.004))


def mat_tiles(nt):
    u, v, _ = nt.sep(nt.coords("UV"))
    tu, tv = nt.mul(u, 4.0), nt.mul(v, 4.0)
    fu, fv = nt.math("FRACT", tu), nt.math("FRACT", tv)
    edge = nt.minf(nt.minf(fu, nt.sub(1.0, fu)), nt.minf(fv, nt.sub(1.0, fv)))
    grout = nt.sub(1.0, nt.smoothstep(edge, 0.008, 0.016))
    bevel = nt.sub(1.0, nt.smoothstep(edge, 0.016, 0.045))
    rnd = _hash(nt, nt.add(nt.math("FLOOR", tu), nt.mul(nt.math("FLOOR", tv), 4.0)), 1.3)
    vec, w = nt.torus(5.0, 5.0)
    w2 = nt.add(w, nt.mul(rnd, 4.0))
    marble = nt.noise(vec, 0.6, 5, 0.55, w=w2, distortion=1.0)
    veins = nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.sub(marble, 0.5)), 0.0, 0.008))
    vf, wf = nt.torus(90.0, 90.0)
    fine = nt.noise(vf, 1.0, 2, 0.5, w=wf)

    col = nt.mix(marble, (0.012, 0.014, 0.019, 1), (0.04, 0.043, 0.052, 1))
    col = nt.mix(nt.mul(veins, 0.22), col, (0.2, 0.2, 0.22, 1))
    col = nt.mix(nt.mul(rnd, 0.3), col, (0.008, 0.009, 0.012, 1))
    col = nt.mix(grout, col, (0.01, 0.01, 0.01, 1))
    rough = nt.add(0.07, nt.mul(marble, 0.07))
    rough = nt.add(rough, nt.mul(fine, 0.05))
    rough = nt.sat(nt.mixf(grout, rough, 0.88))
    height = nt.sub(nt.mul(fine, 0.02), nt.add(grout, nt.mul(bevel, 0.35)))
    return dict(color=col, rough=rough, metal=0.0, normal=nt.bump(height, strength=0.7, distance=0.0035))


def mat_velvet(nt, dark=(0.16, 0.008, 0.016, 1), light=(0.40, 0.024, 0.042, 1), fibre_col=(0.55, 0.05, 0.07, 1)):
    """Бархат; с зелёными цветами — сукно стола казино."""
    vec, w = nt.torus(5.0, 5.0)
    patch = nt.noise(vec, 1.0, 3, 0.55, w=w)
    vf, wf = nt.torus(420.0, 420.0)
    fibre = nt.noise(vf, 1.0, 2, 0.6, w=wf)
    col = nt.mix(patch, dark, light)
    col = nt.mix(nt.mul(fibre, 0.35), col, fibre_col)
    rough = nt.sat(nt.add(0.86, nt.mul(fibre, 0.12)))
    return dict(color=col, rough=rough, metal=0.0, normal=nt.bump(fibre, strength=0.5, distance=0.0008))


def value_smudges(nt):
    """Шероховатость стекла: полосы от тряпки, пыль, отпечатки пальцев."""
    uv = nt.coords("UV")
    u, v, _ = nt.sep(uv)
    vec, w = nt.torus(2.0, 13.0)
    smear = nt.mul(nt.smoothstep(nt.noise(vec, 1.0, 3, 0.55, w=w), 0.55, 0.78), 0.11)
    vd, wd = nt.torus(150.0, 150.0)
    vm, wm = nt.torus(5.0, 5.0)
    dust = nt.mul(nt.mul(nt.sub(1.0, nt.smoothstep(nt.voronoi(vd, 1.0, "F1", w=wd), 0.0, 0.09)), nt.smoothstep(nt.noise(vm, 1.0, 2, 0.5, w=wm), 0.48, 0.62)), 0.3)
    wobble = nt.noise(uv, 9.0, 2, 0.5)
    prints = None
    for cx, cy, rot, sc in ((0.28, 0.62, 0.5, 1.0), (0.36, 0.55, 0.9, 0.9), (0.7, 0.3, -0.4, 1.1), (0.62, 0.78, 2.0, 0.95), (0.2, 0.22, 1.3, 1.0), (0.82, 0.58, -1.1, 0.85)):
        dx, dy = nt.sub(u, cx), nt.sub(v, cy)
        c, s = math.cos(rot), math.sin(rot)
        qx = nt.math("DIVIDE", nt.add(nt.mul(dx, c), nt.mul(dy, s)), 0.034 * sc)
        qy = nt.math("DIVIDE", nt.sub(nt.mul(dy, c), nt.mul(dx, s)), 0.05 * sc)
        d = nt.math("SQRT", nt.add(nt.mul(qx, qx), nt.mul(qy, qy)))
        qy2 = nt.add(qy, 0.4)
        d2 = nt.math("SQRT", nt.add(nt.mul(qx, qx), nt.mul(qy2, qy2)))
        rings = nt.smoothstep(nt.math("SINE", nt.add(nt.mul(d2, 30.0), nt.mul(wobble, 6.0))), -0.1, 0.6)
        p = nt.mul(rings, nt.sub(1.0, nt.smoothstep(d, 0.7, 1.0)))
        prints = p if prints is None else nt.maxf(prints, p)
    return nt.sat(nt.add(nt.add(0.035, smear), nt.add(dust, nt.mul(prints, 0.36))))


def value_cracks(nt, stage):
    """Альфа трещин: лучи и кольца от точек удара + сетка мелких осколков. stage = 1..3."""
    uv = nt.coords("UV")
    u, v, _ = nt.sep(uv)
    total = None
    centers = [(0.42, 0.55), (0.68, 0.36), (0.3, 0.3)][:stage]
    for i, (cx, cy) in enumerate(centers):
        dx, dy = nt.sub(u, cx), nt.sub(v, cy)
        r = nt.math("SQRT", nt.add(nt.mul(dx, dx), nt.mul(dy, dy)))
        ang = nt.math("ARCTAN2", dy, dx)
        wob = nt.noise(nt.mapping(uv, loc=(i * 3.1, i * 1.7, 0)), 5.0, 3, 0.6)
        reach = 0.2 + 0.09 * stage
        fall = nt.sub(1.0, nt.smoothstep(nt.add(r, nt.mul(nt.sub(wob, 0.5), 0.16)), reach * 0.45, reach))
        width = nt.math("DIVIDE", 0.0032, nt.add(r, 0.01))                        # лучи одинаковой толщины на любом расстоянии
        k = 4.0 + stage
        spokes = nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.math("SINE", nt.add(nt.mul(ang, k), nt.mul(wob, 7.0)))), 0.0, nt.mul(width, k)))
        ring_gate = nt.smoothstep(nt.noise(nt.mapping(uv, loc=(i * 5.3, 2.2, 0)), 9.0, 2, 0.5), 0.5, 0.58)
        rings = nt.mul(nt.sub(1.0, nt.smoothstep(nt.math("ABSOLUTE", nt.math("SINE", nt.add(nt.mul(r, 46.0), nt.mul(wob, 9.0)))), 0.0, 0.11)), ring_gate)
        hub = nt.sub(1.0, nt.smoothstep(r, 0.004, 0.014))
        c = nt.maxf(nt.mul(nt.maxf(spokes, nt.mul(rings, 0.8)), fall), hub)
        if stage >= 2:   # мелкая сетка осколков рядом с ударом
            cells = nt.sub(1.0, nt.smoothstep(nt.voronoi(nt.mapping(uv, loc=(i * 2.0, 0, 0)), 16.0 + 6 * stage, "DISTANCE_TO_EDGE"), 0.0, 0.035))
            near = nt.sub(1.0, nt.smoothstep(r, 0.04 * stage, 0.075 * stage))
            c = nt.maxf(c, nt.mul(nt.mul(cells, near), 0.85))
        total = c if total is None else nt.maxf(total, c)
    return nt.sat(total)


# ---------------------------------------------------------------------------
# Запекание
# ---------------------------------------------------------------------------
def unit_plane(name):
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def assign(obj, name):
    mat = bpy.data.materials.new(name + "_bake")
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return C.NT(mat)


def bake_all(only=None):
    data = C.load_levels()
    want = lambda key: only is None or key in only  # noqa: E731

    stamp_path = os.path.join(C.CACHE, "stamp.png")
    if want("gold"):
        stamp_path = render_stamp(data["bar"])

    C.reset_scene()
    C.setup_cycles(SAMPLES)

    if want("gold"):
        bar = M.build_bar(data["bar"])
        nt = assign(bar, "gold")
        C.bake_pbr(bar, nt, mat_gold(nt, stamp_path, data["bar"]), "gold", HERO)
        bar.hide_render = True

    if want("skin") or want("glove") or want("glove_light"):
        hand, rig = M.build_hand()
        hand.modifiers.clear()            # запекаем в позе покоя
        hand.parent = None
        rig.hide_render = True
        if want("skin"):
            nt = assign(hand, "skin")
            C.bake_pbr(hand, nt, mat_skin(nt), "skin", HERO)
        if want("glove"):
            nt = assign(hand, "glove")
            C.bake_pbr(hand, nt, mat_glove(nt), "glove", HERO)
        if want("glove_light"):   # только цвет: нормали и ORM общие с чёрной перчаткой
            nt = assign(hand, "glove_light")
            C.save_png(os.path.join(C.TEXTURES, "glove_light_albedo.png"), C.bake(hand, nt, mat_glove(nt, light=True), "color", HERO)[:, :, :3])
        hand.hide_render = True

    if want("vase"):
        vase = M.build_vase()
        nt = assign(vase, "vase")
        C.bake_pbr(vase, nt, mat_vase(nt), "vase", ENV)
        vase.hide_render = True
    if want("crown"):
        crown = M.build_crown()
        nt = assign(crown, "crown")
        C.bake_pbr(crown, nt, mat_crown(nt), "crown", ENV)
        crown.hide_render = True

    for key, build, fn in (("chips", M.build_chips, mat_chips), ("dice", M.build_dice, mat_dice)):
        if want(key):
            obj = build()
            nt = assign(obj, key)
            C.bake_pbr(obj, nt, fn(nt), key, 512)
            obj.hide_render = True

    plane = unit_plane("swatch")
    if want("felt_green"):
        nt = assign(plane, "felt_green")
        C.bake_pbr(plane, nt, mat_velvet(nt, dark=(0.006, 0.07, 0.03, 1), light=(0.012, 0.16, 0.07, 1), fibre_col=(0.03, 0.24, 0.11, 1)), "felt_green", ENV, ao=False)
    for key, fn in (("wood_table", mat_wood), ("wall_concrete", mat_concrete), ("floor_tiles", mat_tiles), ("velvet_red", mat_velvet)):
        if want(key):
            nt = assign(plane, key)
            C.bake_pbr(plane, nt, fn(nt), key, ENV, ao=False)

    if want("glass"):
        nt = assign(plane, "glass_smudges")
        ch = {"rough": value_smudges(nt)}
        g = C.bake(plane, nt, ch, "rough", ENV)[:, :, 0]
        C.save_png(os.path.join(C.TEXTURES, "glass_smudges.png"), np.dstack([g, g, g]))
        for stage in (1, 2, 3):
            nt = assign(plane, f"glass_cracks_{stage}")
            ch = {"rough": value_cracks(nt, stage)}
            a = C.bake(plane, nt, ch, "rough", ENV, margin=0)[:, :, 0]
            rgb = np.empty((ENV, ENV, 4), dtype=np.uint8)
            rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2], rgb[:, :, 3] = 226, 240, 250, a
            C.save_png(os.path.join(C.TEXTURES, f"glass_cracks_{stage}.png"), rgb)


# ---------------------------------------------------------------------------
# Превью с запечёнными текстурами (проверка швов, чёрных пятен, нормалей)
# ---------------------------------------------------------------------------
def textured(name, tex, tiling=1.0, extra=None):
    mat = bpy.data.materials.new(name)
    nt = C.NT(mat)
    uv = nt.coords("UV")
    if tiling != 1.0:
        uv = nt.mapping(uv, scale=(tiling, tiling, 1))

    def img(suffix, srgb):
        im = bpy.data.images.load(os.path.join(C.TEXTURES, f"{tex}_{suffix}.png"), check_existing=True)
        im.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
        return nt.image(im, uv, extension="REPEAT")

    orm = nt.new("ShaderNodeSeparateColor")
    nt.set(orm.inputs[0], img("orm", False))
    nm = nt.new("ShaderNodeNormalMap")
    nt.set(nm.inputs["Color"], img("normal", False))
    ch = dict(color=img("albedo", True), rough=orm.outputs[1], metal=orm.outputs[2], normal=nm.outputs[0])
    if extra:
        ch.update(extra)
    nt.output(ch, "bsdf")
    return mat


def previews():
    data = C.load_levels()
    have = lambda n: os.path.exists(os.path.join(C.TEXTURES, n))  # noqa: E731

    if have("gold_albedo.png"):
        C.reset_scene()
        bar = M.build_bar(data["bar"])
        bar.data.materials.clear()
        bar.data.materials.append(textured("gold_tex", "gold"))
        C.render_preview("tex_gold_bar", (0.13, -0.21, 0.2), (0.0, 0, 0), lens=75, floor=-data["bar"]["size"][1] / 2, key=8)
        C.render_preview("tex_gold_bar_top", (0.0, -0.06, 0.26), (0.0, 0, 0), lens=70, floor=-data["bar"]["size"][1] / 2, key=6)

    for name, build, cam, floor in (("vase", M.build_vase, (0.15, -0.25, 0.1), -M.VASE_HEIGHT / 2), ("crown", M.build_crown, (0.16, -0.24, 0.16), -0.025),
                                    ("chips", M.build_chips, (0.05, -0.08, 0.06), -0.01), ("dice", M.build_dice, (0.06, -0.08, 0.06), -0.0175)):
        if not have(f"{name}_albedo.png"):
            continue
        C.reset_scene()
        obj = build()
        obj.data.materials.clear()
        obj.data.materials.append(textured(f"{name}_tex", name))
        C.render_preview(f"tex_{name}", cam, (0, 0, 0), lens=75, floor=floor, key=7)

    for tex in ("skin", "glove"):
        if not have(f"{tex}_albedo.png"):
            continue
        C.reset_scene()
        hand, rig = M.build_hand()
        hand.data.materials.clear()
        hand.data.materials.append(textured(f"{tex}_tex", tex))
        C.render_preview(f"tex_hand_{tex}_top", (-0.2, 0.3, 0.34), (0.0, 0.04, 0.0), lens=65, floor=-0.06, key=10)
        M.pose_hand(rig, 0.55)
        C.render_preview(f"tex_hand_{tex}_grip", (-0.24, 0.3, -0.12), (0.0, 0.06, -0.02), lens=70, key=10)

    if have("glass_smudges.png"):
        C.reset_scene()
        lvl = next(l for l in data["levels"] if l["id"] == 8)
        walls = [M.build_glass_wall(f"L8_{w}", M.wall_frame(w, lvl["box"]["size"]), next((h for h in lvl["box"]["holes"] if h["wall"] == w), None), data["glass"]["thickness"]) for w in M.WALLS]
        glass = bpy.data.materials["glass"]
        nt = C.NT(glass)
        sm = bpy.data.images.load(os.path.join(C.TEXTURES, "glass_smudges.png"), check_existing=True)
        sm.colorspace_settings.name = "Non-Color"
        cr = bpy.data.images.load(os.path.join(C.TEXTURES, "glass_cracks_3.png"), check_existing=True)
        crack = nt.new("ShaderNodeTexImage", image=cr, extension="CLIP")
        nt.set(crack.inputs[0], nt.coords("UV"))
        bsdf = nt.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Transmission Weight"].default_value = 1.0
        bsdf.inputs["IOR"].default_value = 1.5
        nt.set(bsdf.inputs["Base Color"], (0.93, 1.0, 0.97, 1))
        nt.set(bsdf.inputs["Roughness"], nt.maxf(nt.sep(nt.image(sm, nt.coords("UV"), extension="REPEAT"))[0], nt.mul(crack.outputs["Alpha"], 0.6)))
        nt.set(bsdf.inputs["Emission Color"], (1, 1, 1, 1))
        nt.set(bsdf.inputs["Emission Strength"], nt.mul(crack.outputs["Alpha"], 0.5))
        nt.t.links.new(bsdf.outputs[0], nt.out.inputs["Surface"])
        if have("gold_albedo.png"):
            bar = M.build_bar(data["bar"])
            bar.location = (0, 0, 0.03 + data["bar"]["size"][1] / 2)
            bar.rotation_euler = (0, 0, 0.5)
            bar.data.materials.clear()
            bar.data.materials.append(textured("gold_tex", "gold"))
        C.render_preview("tex_glass_box", (0.5, -0.82, 0.5), (0, 0, 0.13), lens=55, floor=0.0, engine="CYCLES", samples=128, key=40)
        del walls

    if all(have(f"{t}_albedo.png") for t in ("wood_table", "wall_concrete", "floor_tiles", "velvet_red")):
        C.reset_scene()
        for i, (tex, tiling) in enumerate((("wood_table", 2.0), ("wall_concrete", 2.0), ("floor_tiles", 2.0), ("velvet_red", 2.0))):
            bpy.ops.mesh.primitive_plane_add(size=1, location=((i % 2) * 1.04 - 0.52, 0.52 - (i // 2) * 1.04, 0))
            bpy.context.active_object.data.materials.append(textured(f"{tex}_tex", tex, tiling))
        C.render_preview("tex_environment", (0.0, -1.5, 2.3), (0, -0.05, 0), lens=50, key=45)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = next((set(a[5:].split(",")) for a in args if a.startswith("only=")), None)
    if "previewonly" not in args:
        bake_all(only)
    if "nopreview" not in args:
        previews()
    print("[textures] готово")
