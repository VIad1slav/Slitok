"""Построение моделей: рука со скелетом, слиток, стеклянные коробки, стол, подставка, комната.

Координаты Blender: +X вправо, +Y вперёд (от игрока), +Z вверх. Рука: запястье в начале координат,
пальцы смотрят в +Y, тыльная сторона ладони — +Z, большой палец — в -X (правая рука ладонью вниз).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

import common as C

# ---------------------------------------------------------------------------
# Рука
# ---------------------------------------------------------------------------
FINGERS = {
    #          основание (MCP)        разворот°  длины фаланг          радиусы суставов
    "index":  dict(mcp=(-0.030, 0.095, 0.000), yaw=5.0, lens=(0.040, 0.024, 0.021), r=(0.0094, 0.0084, 0.0075, 0.0066)),
    "middle": dict(mcp=(-0.009, 0.100, 0.001), yaw=1.0, lens=(0.045, 0.027, 0.022), r=(0.0097, 0.0087, 0.0077, 0.0068)),
    "ring":   dict(mcp=(0.012, 0.096, 0.000), yaw=-3.5, lens=(0.041, 0.025, 0.022), r=(0.0092, 0.0082, 0.0073, 0.0064)),
    "pinky":  dict(mcp=(0.032, 0.086, -0.002), yaw=-9.0, lens=(0.032, 0.018, 0.019), r=(0.0082, 0.0072, 0.0064, 0.0057)),
}
FINGER_DROOP = (7.0, 13.0, 19.0)   # расслабленная поза: фаланги слегка опущены, градусы от горизонтали
THUMB = dict(cmc=(-0.030, 0.022, -0.008), dir=(-0.62, 0.78, -0.12), bend=14.0, lens=(0.042, 0.032, 0.026), r=(0.0128, 0.0108, 0.0096, 0.0082))
FOREARM_LEN = 0.30
HAND_TRIS = 5900
FINGER_THICKNESS = 1.1     # общий множитель толщины пальцев (сглаживание их слегка «худит»)


def finger_joints(spec):
    """Положения суставов пальца: [MCP, PIP, DIP, кончик]."""
    pts = [Vector(spec["mcp"])]
    yaw = math.radians(spec["yaw"])
    for length, droop in zip(spec["lens"], FINGER_DROOP):
        p = math.radians(droop)
        d = Vector((-math.sin(yaw) * math.cos(p), math.cos(yaw) * math.cos(p), -math.sin(p)))
        pts.append(pts[-1] + d * length)
    return pts


def thumb_joints():
    pts = [Vector(THUMB["cmc"])]
    d = Vector(THUMB["dir"]).normalized()
    rot = Matrix.Rotation(-math.radians(THUMB["bend"]), 3, "Z")
    for length in THUMB["lens"]:
        pts.append(pts[-1] + d * length)
        d = rot @ d
    return pts


def hand_chains():
    """Имя пальца → (суставы, радиусы)."""
    chains = {name: (finger_joints(spec), tuple(r * FINGER_THICKNESS for r in spec["r"])) for name, spec in FINGERS.items()}
    chains["thumb"] = (thumb_joints(), tuple(r * FINGER_THICKNESS for r in THUMB["r"]))
    return chains


def _sphere(bm, center, r, scale=(1, 1, 1), seg=20):
    m = Matrix.Translation(center) @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1))
    return bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r, matrix=m)["verts"]


def _cone(bm, p0, p1, r0, r1, seg=20):
    d = p1 - p0
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=d.length, matrix=Matrix.Translation((p0 + p1) / 2) @ rot)


def _loft(bm, rings, seg=28):
    """Труба эллиптического сечения вдоль Y. rings: [(y, rx, rz, z_center)]."""
    loops = []
    for y, rx, rz, zc in rings:
        loops.append([bm.verts.new((rx * math.cos(a), y, zc + rz * math.sin(a))) for a in (2 * math.pi * i / seg for i in range(seg))])
    for a, b in zip(loops, loops[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(loops[0])
    bm.faces.new(list(reversed(loops[-1])))


def _superellipsoid(bm, center, half, power=0.55, seg=28):
    """«Подушка»: сфера, у которой координаты возведены в степень < 1 — получается скруглённый брусок."""
    for v in _sphere(bm, (0, 0, 0), 1.0, seg=seg):
        c = v.co
        v.co = Vector(tuple(center[i] + half[i] * math.copysign(abs(c[i]) ** power, c[i]) for i in range(3)))


def build_hand():
    """Меш руки (единая поверхность) + арматура + скиннинг. Возвращает (mesh_obj, armature_obj)."""
    chains = hand_chains()
    bm = bmesh.new()
    # предплечье (от середины) и запястье
    _loft(bm, [(-FOREARM_LEN, 0.044, 0.037, 0.0), (-0.23, 0.0425, 0.0355, 0.0), (-0.15, 0.038, 0.031, 0.0), (-0.08, 0.032, 0.025, 0.0),
               (-0.035, 0.0285, 0.0205, 0.0), (0.004, 0.029, 0.019, 0.0)])
    # ладонь: основа, подушечки у большого пальца и мизинца, костяшки
    _superellipsoid(bm, (0.002, 0.05, -0.0005), (0.044, 0.053, 0.0145))
    _sphere(bm, (-0.024, 0.034, -0.011), 0.018, scale=(1.0, 1.7, 0.72))
    _sphere(bm, (0.029, 0.036, -0.009), 0.014, scale=(1.0, 2.2, 0.75))
    _sphere(bm, (0.0, 0.085, -0.008), 0.012, scale=(3.0, 1.0, 0.7))             # валик под пальцами
    for name, (pts, radii) in chains.items():
        seg = 18
        for i in range(3):
            _cone(bm, pts[i], pts[i + 1], radii[i], radii[i + 1], seg)
            _sphere(bm, pts[i], radii[i] * (1.12 if (i > 0 or name != "thumb") else 1.0), seg=seg)   # сустав чуть толще фаланги
        _sphere(bm, pts[3], radii[3], seg=seg)
        # подушечка пальца снизу и переход к ладони
        tip_dir = (pts[3] - pts[2]).normalized()
        _sphere(bm, pts[3] - tip_dir * radii[3] * 0.9 + Vector((0, 0, -radii[3] * 0.28)), radii[3] * 0.95, scale=(1.0, 1.25, 0.9), seg=seg)
        if name != "thumb":
            _sphere(bm, pts[0] + Vector((0, -0.004, 0.0045)), radii[0] * 1.08, seg=seg)       # костяшка на тыльной стороне
            _cone(bm, pts[0] + Vector((0, -0.03, -0.002)), pts[0], radii[0] * 1.05, radii[0] * 1.02, seg)  # пястная кость
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("hand")
    bm.to_mesh(me)
    bm.free()
    obj = C.new_object("hand", me)

    # объединяем части в одну поверхность, сглаживаем и упрощаем до игрового бюджета
    rm = obj.modifiers.new("remesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = 0.0019
    rm.adaptivity = 0.0
    C.apply_modifiers(obj)
    sm = obj.modifiers.new("smooth", "SMOOTH")
    sm.factor = 0.55
    sm.iterations = 4
    C.apply_modifiers(obj)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    dec = obj.modifiers.new("decimate", "DECIMATE")
    dec.ratio = min(1.0, HAND_TRIS / tris)
    dec.use_collapse_triangulate = True
    C.apply_modifiers(obj)
    sm = obj.modifiers.new("relax", "SMOOTH")
    sm.factor = 0.3
    sm.iterations = 1
    C.apply_modifiers(obj)
    C.shade_smooth(obj)
    print(f"[hand] {tris} → {len(obj.data.polygons)} треугольников, {len(obj.data.vertices)} вершин")

    _unwrap_hand(obj)
    obj.data.materials.append(C.get_material("skin", (0.80, 0.56, 0.44, 1), 0.0, 0.5))
    obj.data.materials.append(C.get_material("glove", (0.03, 0.03, 0.035, 1), 0.0, 0.8))

    arm_obj = _build_armature(chains)
    _skin(obj, arm_obj, chains)
    return obj, arm_obj


def _unwrap_hand(obj):
    """Швы по границе «тыльная сторона / ладонь» и вокруг среза предплечья → 3 острова без наложений."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    def kind(f):
        if f.normal.y < -0.75 and f.calc_center_median().y < -FOREARM_LEN + 0.01:
            return 2
        return 0 if f.normal.z >= 0 else 1
    for e in bm.edges:
        e.seam = len(e.link_faces) == 2 and kind(e.link_faces[0]) != kind(e.link_faces[1])
    bm.to_mesh(me)
    bm.free()
    C.select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.01)
    bpy.ops.uv.select_all(action="SELECT")
    try:
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(margin=0.012, rotate=True)
    except Exception as exc:
        print("[hand] упаковка UV:", exc)
    bpy.ops.object.mode_set(mode="OBJECT")


def _build_armature(chains):
    arm = bpy.data.armatures.new("HandRig")
    arm_obj = bpy.data.objects.new("HandRig", arm)
    bpy.context.scene.collection.objects.link(arm_obj)
    C.select_only(arm_obj)
    bpy.ops.object.mode_set(mode="EDIT")

    def bone(name, head, tail, parent=None, connect=False):
        b = arm.edit_bones.new(name)
        b.head, b.tail = head, tail
        b.roll = 0.0
        if parent is not None:
            b.parent = parent
            b.use_connect = connect
        return b

    forearm = bone("forearm", (0, -FOREARM_LEN, 0), (0, 0, 0))
    wrist = bone("wrist", (0, 0, 0), (0, 0.085, 0), forearm, True)
    for name, (pts, _) in chains.items():
        parent = wrist
        for i in range(3):
            parent = bone(f"{name}_0{i + 1}", pts[i], pts[i + 1], parent, i > 0)
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def _skin(obj, arm_obj, chains):
    """Автоматические веса + чистка: вершина пальца не должна зависеть от костей соседних пальцев."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    auto_ok = True
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except Exception as exc:
        auto_ok = False
        print("[hand] автоматические веса не сработали:", exc)
        bpy.ops.object.parent_set(type="ARMATURE_NAME")

    segs = {"forearm": (Vector((0, -FOREARM_LEN, 0)), Vector((0, 0, 0))), "wrist": (Vector((0, 0, 0)), Vector((0, 0.085, 0)))}
    owner = {"forearm": "palm", "wrist": "palm"}
    for name, (pts, _) in chains.items():
        for i in range(3):
            segs[f"{name}_0{i + 1}"] = (pts[i], pts[i + 1])
            owner[f"{name}_0{i + 1}"] = name
    groups = {g.name: g for g in obj.vertex_groups}
    for n in segs:
        if n not in groups:
            groups[n] = obj.vertex_groups.new(name=n)
    index_to_name = {g.index: g.name for g in obj.vertex_groups}

    fixed = unweighted = 0
    for v in obj.data.vertices:
        dist = {n: _seg_dist(v.co, a, b) for n, (a, b) in segs.items()}
        nearest = min(dist, key=dist.get)
        region = owner[nearest]
        weights = {index_to_name[g.group]: g.weight for g in v.groups if g.weight > 1e-4}
        if region != "palm":   # палец: чужие пальцы убираем
            for n in list(weights):
                if owner[n] not in (region, "palm"):
                    del weights[n]
                    fixed += 1
        else:                  # ладонь/предплечье: дальние фаланги не влияют
            for n in list(weights):
                if owner[n] != "palm" and not n.endswith("_01"):
                    del weights[n]
        total = sum(weights.values())
        if total < 1e-3:       # запасной вариант — веса по расстоянию до двух ближайших костей
            unweighted += 1
            near = sorted((n for n in dist if owner[n] in (region, "palm")), key=dist.get)[:2]
            weights = {n: 1.0 / (dist[n] ** 2 + 1e-8) for n in near}
            total = sum(weights.values())
        for g in list(v.groups):
            obj.vertex_groups[g.group].remove([v.index])
        for n, w in sorted(weights.items(), key=lambda kv: -kv[1])[:4]:
            groups[n].add([v.index], w / total, "REPLACE")
    C.select_only(obj)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bad = sum(1 for v in obj.data.vertices if abs(sum(g.weight for g in v.groups) - 1.0) > 0.02)
    print(f"[hand] скиннинг: авто={'да' if auto_ok else 'нет'}, чужих весов убрано {fixed}, без весов было {unweighted}, ненормированных {bad}")
    return bad == 0


def pose_hand(arm_obj, curl):
    """Согнуть пальцы (0..1) — для проверки скиннинга на превью."""
    chains = hand_chains()
    angles = {"finger": (1.2, 1.5, 1.0), "thumb": (0.4, 0.55, 0.7)}
    for name, (pts, _) in chains.items():
        d = (pts[1] - pts[0]).normalized()
        toward = Vector((0, 0, -1)) if name != "thumb" else Vector((0.75, 0.2, -0.6)).normalized()
        axis = d.cross(toward).normalized()
        for i in range(3):
            pb = arm_obj.pose.bones[f"{name}_0{i + 1}"]
            local = pb.bone.matrix_local.to_3x3().inverted() @ axis
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = Quaternion(local, angles["thumb" if name == "thumb" else "finger"][i] * curl)
    bpy.context.view_layer.update()


# ---------------------------------------------------------------------------
# Слиток
# ---------------------------------------------------------------------------
def bar_top_size(cfg):
    length, _, width = cfg["size"]
    return length * (cfg["topScale"] + 0.1), width * cfg["topScale"]


def build_bar(cfg):
    """Слиток-трапеция с фасками. Длина — X, ширина — Y (Blender), высота — Z. Центр в начале координат."""
    length, height, width = cfg["size"]
    tl, tw = bar_top_size(cfg)
    bm = bmesh.new()
    lo = [bm.verts.new((sx * length / 2, sy * width / 2, -height / 2)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    hi = [bm.verts.new((sx * tl / 2, sy * tw / 2, height / 2)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(reversed(lo))
    bm.faces.new(hi)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("gold_bar")
    bm.to_mesh(me)
    bm.free()
    obj = C.new_object("gold_bar", me)
    bev = obj.modifiers.new("bevel", "BEVEL")
    bev.width = 0.0038
    bev.segments = 4
    bev.limit_method = "ANGLE"
    C.apply_modifiers(obj)
    tri = obj.modifiers.new("tri", "TRIANGULATE")
    wn = obj.modifiers.new("wn", "WEIGHTED_NORMAL")
    wn.keep_sharp = False
    C.shade_smooth(obj)
    C.apply_modifiers(obj)
    C.select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.append(C.get_material("gold", (1.0, 0.72, 0.25, 1), 1.0, 0.22))
    print(f"[bar] {len(obj.data.polygons)} треугольников")
    return obj


# ---------------------------------------------------------------------------
# Стеклянные коробки (по параметрам уровней)
# ---------------------------------------------------------------------------
WALLS = ("top", "front", "back", "left", "right")


def wall_frame(wall, size):
    """То же, что wallFrame() в src/box.js: начало и оси стенки в координатах игры."""
    w, h, d = size
    return {
        "top": dict(o=(0, h, 0), u=(1, 0, 0), v=(0, 0, 1), U=w, V=d),
        "front": dict(o=(0, h / 2, d / 2), u=(1, 0, 0), v=(0, 1, 0), U=w, V=h),
        "back": dict(o=(0, h / 2, -d / 2), u=(1, 0, 0), v=(0, 1, 0), U=w, V=h),
        "right": dict(o=(w / 2, h / 2, 0), u=(0, 0, 1), v=(0, 1, 0), U=d, V=h),
        "left": dict(o=(-w / 2, h / 2, 0), u=(0, 0, 1), v=(0, 1, 0), U=d, V=h),
    }[wall]


def inner_frame(p):
    """То же, что innerFrame() в src/box.js: панель внутри коробки вдоль оси X или Z, от дна до height."""
    mid, length = (p["from"] + p["to"]) / 2, p["to"] - p["from"]
    if p["axis"] == "x":
        return dict(o=(mid, p["height"] / 2, p["at"]), u=(1, 0, 0), v=(0, 1, 0), U=length, V=p["height"])
    return dict(o=(p["at"], p["height"] / 2, mid), u=(0, 0, 1), v=(0, 1, 0), U=length, V=p["height"])


def build_glass_wall(name, frame, hole, thickness):
    U2, V2 = frame["U"] / 2, frame["V"] / 2
    bm = bmesh.new()

    def loop(points):
        verts = [bm.verts.new((x, y, 0)) for x, y in points]
        return [bm.edges.new((verts[i], verts[(i + 1) % len(verts)])) for i in range(len(verts))]

    edges = loop([(-U2, -V2), (U2, -V2), (U2, V2), (-U2, V2)])
    if hole:
        ou, ov = hole["offset"]
        if hole["shape"] == "circle":
            r, n = hole["radius"], 64
            edges += loop([(ou + r * math.cos(2 * math.pi * i / n), ov + r * math.sin(2 * math.pi * i / n)) for i in range(n)])
        else:
            a, b = hole["size"][0] / 2, hole["size"][1] / 2
            edges += loop([(ou - a, ov - b), (ou + a, ov - b), (ou + a, ov + b), (ou - a, ov + b)])
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:           # все грани смотрят в +Z перед экструзией
        if f.normal.z < 0:
            f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    bmesh.ops.translate(bm, vec=(0, 0, thickness), verts=[g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)])
    bmesh.ops.translate(bm, vec=(0, 0, -thickness / 2), verts=bm.verts[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # из плоскости (u, v) в координаты игры, затем в координаты Blender
    u, v = Vector(frame["u"]), Vector(frame["v"])
    n = u.cross(v)
    game = Matrix(((u.x, v.x, n.x, frame["o"][0]), (u.y, v.y, n.y, frame["o"][1]), (u.z, v.z, n.z, frame["o"][2]), (0, 0, 0, 1)))
    to_blender = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    m = to_blender @ game
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts[:])
    if m.to_3x3().determinant() < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = C.new_object(name, me)
    bev = obj.modifiers.new("bevel", "BEVEL")
    bev.width = 0.0012
    bev.segments = 2
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(40)
    C.apply_modifiers(obj)

    me = obj.data
    me.materials.append(C.get_material("glass", (0.9, 1.0, 0.96, 1), 0.0, 0.03))
    me.materials.append(C.get_material("glass_edge", (0.1, 0.5, 0.35, 1), 0.0, 0.1))
    nb = (m.to_3x3() @ Vector((0, 0, 1))).normalized()
    ub, vb, ob = (m.to_3x3() @ Vector((1, 0, 0))), (m.to_3x3() @ Vector((0, 1, 0))), m.translation
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        poly.material_index = 0 if abs(poly.normal.dot(nb)) > 0.92 else 1
        poly.use_smooth = False
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co - ob
            uv.data[li].uv = (p.dot(ub) / frame["U"] + 0.5, p.dot(vb) / frame["V"] + 0.5)
    return obj


def build_glass_boxes(data):
    objs = []
    for lvl in data["levels"]:
        for wall in WALLS:
            hole = next((h for h in lvl["box"]["holes"] if h["wall"] == wall), None)
            objs.append(build_glass_wall(f"L{lvl['id']}_{wall}", wall_frame(wall, lvl["box"]["size"]), hole, data["glass"]["thickness"]))
        for i, panel in enumerate(lvl["box"].get("inner", [])):   # внутренние перегородки (см. innerFrame в src/box.js)
            objs.append(build_glass_wall(f"L{lvl['id']}_inner{i}", inner_frame(panel), panel.get("hole"), data["glass"]["thickness"]))
    print(f"[glass] {len(objs)} стенок для {len(data['levels'])} уровней")
    return objs


# ---------------------------------------------------------------------------
# Окружение
# ---------------------------------------------------------------------------
def _box(name, center, size, material, bevel=0.0, taper=1.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if taper != 1.0:   # сужение книзу (ножки стола)
        for v in obj.data.vertices:
            if v.co.z < 0:
                v.co.x *= taper
                v.co.y *= taper
    if bevel > 0:
        b = obj.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 3
        C.apply_modifiers(obj)
        C.shade_smooth(obj, 40)
    obj.data.materials.append(C.get_material(material))
    return obj


def _cyl(name, center, radius, depth, material, axis="Z", verts=48, radius2=None, bevel=0.0):
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=center)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=radius2, depth=depth, location=center)
    obj = bpy.context.active_object
    obj.name = name
    if axis == "Y":
        obj.rotation_euler = (math.radians(90), 0, 0)
    elif axis == "X":
        obj.rotation_euler = (0, math.radians(90), 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if bevel > 0:
        b = obj.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
        b.limit_method = "ANGLE"
        C.apply_modifiers(obj)
    C.shade_smooth(obj, 40)
    obj.data.materials.append(C.get_material(material))
    return obj


def _join(name, parts, uv_scale=1.0):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    C.box_uv(obj, uv_scale)
    return obj


def build_table(data):
    tw, tt, td = data["world"]["tableSize"]
    ty = data["world"]["tableY"]
    parts = [_box("top", (0, 0, ty - tt / 2), (tw, td, tt), "wood", bevel=0.006)]
    leg_h = ty - tt
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(_box("leg", (sx * (tw / 2 - 0.09), sy * (td / 2 - 0.09), leg_h / 2), (0.075, 0.075, leg_h), "wood", bevel=0.004, taper=0.7))
    for sy in (-1, 1):
        parts.append(_box("apron", (0, sy * (td / 2 - 0.09), leg_h - 0.05), (tw - 0.25, 0.026, 0.1), "wood"))
    for sx in (-1, 1):
        parts.append(_box("apron", (sx * (tw / 2 - 0.09), 0, leg_h - 0.05), (0.026, td - 0.25, 0.1), "wood"))
    return _join("table", parts)


def build_pedestal():
    """Подставка 0.3 × 0.05 × 0.16 (ширина × высота × глубина), начало координат — центр дна. В игре масштабируется."""
    base = _box("base", (0, 0, 0.007), (0.3, 0.16, 0.014), "metal", bevel=0.002)
    cushion = _box("cushion", (0, 0, 0.014 + 0.018), (0.288, 0.148, 0.036), "velvet", bevel=0.007)
    return _join("pedestal", [base, cushion])


def build_room(data):
    rw, rh, rd = data["world"]["room"]
    parts = []   # коробка комнаты и лампа — общие для всех ограблений
    bank = []    # дверь хранилища и ячейки — обстановка банка (set_bank.glb)
    t = 0.2
    parts.append(_box("floor", (0, 0, -t / 2), (rw, rd, t), "tiles"))
    parts.append(_box("ceiling", (0, 0, rh + t / 2), (rw, rd, t), "concrete"))
    for sx in (-1, 1):
        parts.append(_box("wall_x", (sx * (rw / 2 + t / 2), 0, rh / 2), (t, rd + 2 * t, rh), "concrete"))
    for sy in (-1, 1):
        parts.append(_box("wall_y", (0, sy * (rd / 2 + t / 2), rh / 2), (rw, t, rh), "concrete"))
    # пилястры и потолочные балки
    for sx in (-1, 1):
        for y in (-1.3, 1.3):
            parts.append(_box("pilaster", (sx * (rw / 2 - 0.09), y, rh / 2), (0.18, 0.34, rh), "concrete", bevel=0.012))
    for x in (-1.5, 1.5):
        parts.append(_box("pilaster_back", (x, rd / 2 - 0.09, rh / 2), (0.34, 0.18, rh), "concrete", bevel=0.012))
    for y in (-1.3, 1.3):
        parts.append(_box("beam", (0, y, rh - 0.12), (rw, 0.3, 0.24), "concrete", bevel=0.012))
    # плинтус
    for sx in (-1, 1):
        parts.append(_box("skirt", (sx * (rw / 2 - 0.012), 0, 0.06), (0.024, rd, 0.12), "metal"))
    parts.append(_box("skirt", (0, rd / 2 - 0.012, 0.06), (rw, 0.024, 0.12), "metal"))

    # дверь хранилища на дальней стене (Blender +Y)
    yb, cz = rd / 2, 1.32
    bank.append(_cyl("door_frame", (0, yb - 0.05, cz), 1.08, 0.1, "metal", axis="Y", verts=64, bevel=0.012))
    bank.append(_cyl("door", (0, yb - 0.15, cz), 0.94, 0.16, "steel", axis="Y", verts=64, bevel=0.015))
    bank.append(_cyl("door_inner", (0, yb - 0.25, cz), 0.62, 0.05, "metal", axis="Y", verts=64, bevel=0.008))
    bank.append(_cyl("hub", (0, yb - 0.31, cz), 0.085, 0.09, "steel", axis="Y", verts=32, bevel=0.006))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.3, minor_radius=0.022, major_segments=64, minor_segments=12, location=(0, yb - 0.34, cz), rotation=(math.radians(90), 0, 0))
    wheel = bpy.context.active_object
    C.shade_smooth(wheel)
    wheel.data.materials.append(C.get_material("steel"))
    bank.append(wheel)
    for i in range(5):
        a = 2 * math.pi * i / 5
        spoke = _box("spoke", (math.cos(a) * 0.15, yb - 0.34, cz + math.sin(a) * 0.15), (0.3, 0.026, 0.026), "steel", bevel=0.004)
        spoke.rotation_euler = (0, -a, 0)
        bank.append(spoke)
    for i in range(12):
        a = 2 * math.pi * i / 12
        bank.append(_cyl("bolt", (math.cos(a) * 0.8, yb - 0.24, cz + math.sin(a) * 0.8), 0.04, 0.04, "metal", axis="Y", verts=16, bevel=0.004))
    for z in (cz - 0.5, cz + 0.5):
        bank.append(_box("hinge", (-1.06, yb - 0.16, z), (0.16, 0.2, 0.26), "metal", bevel=0.01))

    # ячейки хранилища на боковых стенах
    for sx in (-1, 1):
        for col in range(7):
            for row in range(5):
                y = -1.02 + col * 0.34
                z = 0.42 + row * 0.27
                bank.append(_box("cell", (sx * (rw / 2 - 0.025), y, z), (0.05, 0.31, 0.24), "metal", bevel=0.006))
                bank.append(_box("cell_handle", (sx * (rw / 2 - 0.058), y, z - 0.05), (0.014, 0.07, 0.018), "steel"))
                bank.append(_cyl("cell_lock", (sx * (rw / 2 - 0.053), y + 0.09, z + 0.06), 0.012, 0.008, "steel", axis="X", verts=12))

    # лампа-прожектор над столом
    spot = Vector(C.g2b(data["world"]["spot"]))
    target = Vector(C.g2b(data["world"]["spotTarget"]))
    d = (target - spot).normalized()
    rot = d.to_track_quat("-Z", "Y").to_euler()
    bpy.ops.mesh.primitive_cone_add(vertices=40, radius1=0.2, radius2=0.085, depth=0.28, end_fill_type="NOTHING", location=spot - d * 0.16, rotation=rot)
    shade = bpy.context.active_object
    sol = shade.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.008
    C.apply_modifiers(shade)
    C.shade_smooth(shade, 40)
    shade.data.materials.append(C.get_material("metal"))
    parts.append(shade)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.1, depth=0.1, location=spot - d * 0.33, rotation=rot)
    cap = bpy.context.active_object
    C.shade_smooth(cap, 40)
    cap.data.materials.append(C.get_material("metal"))
    parts.append(cap)
    bpy.ops.mesh.primitive_circle_add(vertices=32, radius=0.1, fill_type="NGON", location=spot - d * 0.2, rotation=rot)
    glow = bpy.context.active_object
    glow.data.materials.append(C.get_material("lamp_glow", (1, 0.9, 0.7, 1)))
    parts.append(glow)
    top = spot - d * 0.36
    parts.append(_cyl("lamp_rod", (top.x, top.y, (top.z + rh) / 2), 0.018, rh - top.z, "metal", verts=12))
    parts.append(_cyl("lamp_mount", (top.x, top.y, rh - 0.02), 0.08, 0.04, "metal", verts=24))

    room = _join("room", parts, uv_scale=1.0)
    bank_set = _join("set_bank", bank, uv_scale=1.0)
    for o in (room, bank_set):
        print(f"[{o.name}] {sum(len(p.vertices) - 2 for p in o.data.polygons)} треугольников")
    return room, bank_set


def build_set_museum(data):
    """Обстановка музея: картины в рамах, колонны, столбики с канатом, постаменты со скульптурой."""
    rw, rh, rd = data["world"]["room"]
    yb = rd / 2
    parts = []
    # картины на дальней стене, над каждой — светильник
    for x, w, h in ((-1.55, 0.85, 1.1), (0.0, 1.5, 1.0), (1.55, 0.85, 1.1)):
        z = 1.75
        parts.append(_box("frame", (x, yb - 0.035, z), (w + 0.14, 0.07, h + 0.14), "brass", bevel=0.012))
        parts.append(_box("canvas", (x, yb - 0.075, z), (w, 0.012, h), "canvas"))
        parts.append(_box("picture_light", (x, yb - 0.16, z + h / 2 + 0.16), (w * 0.6, 0.05, 0.03), "metal", bevel=0.006))
        parts.append(_box("picture_glow", (x, yb - 0.16, z + h / 2 + 0.142), (w * 0.55, 0.035, 0.006), "lamp_glow"))
    # колонны вдоль боковых стен
    for sx in (-1, 1):
        for y in (-0.2, 1.9):
            x = sx * (rw / 2 - 0.42)
            parts.append(_cyl("column", (x, y, rh / 2), 0.15, rh - 0.5, "concrete", verts=24))
            parts.append(_box("column_base", (x, y, 0.12), (0.42, 0.42, 0.24), "concrete", bevel=0.02))
            parts.append(_box("column_cap", (x, y, rh - 0.12), (0.46, 0.46, 0.24), "concrete", bevel=0.02))
    # столбики с бархатным канатом перед картинами
    posts = [(-1.9, yb - 0.95), (-0.65, yb - 0.95), (0.65, yb - 0.95), (1.9, yb - 0.95)]
    for x, y in posts:
        parts.append(_cyl("post_base", (x, y, 0.015), 0.13, 0.03, "brass", verts=32, bevel=0.006))
        parts.append(_cyl("post", (x, y, 0.47), 0.022, 0.9, "brass", verts=16))
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.045, location=(x, y, 0.95))
        ball = bpy.context.active_object
        C.shade_smooth(ball)
        ball.data.materials.append(C.get_material("brass"))
        parts.append(ball)
    for (x0, y0), (x1, _) in zip(posts, posts[1:]):
        mid = (x0 + x1) / 2
        for xa, xb in ((x0, mid), (mid, x1)):   # канат провисает к середине
            za, zb = (0.86, 0.72) if xa == x0 else (0.72, 0.86)
            length = math.hypot(xb - xa, zb - za)
            rope = _cyl("rope", ((xa + xb) / 2, y0, (za + zb) / 2), 0.014, length, "velvet", axis="X", verts=10)
            rope.rotation_euler = (0, -math.atan2(zb - za, xb - xa), 0)
            parts.append(rope)
    # постаменты со скульптурами
    for sx in (-1, 1):
        x, y = sx * 1.95, 1.2      # в глубине зала, по бокам от картин: у стола они загораживали бы кадр
        parts.append(_box("plinth", (x, y, 0.45), (0.36, 0.36, 0.9), "concrete", bevel=0.015))
        if sx < 0:
            bpy.ops.mesh.primitive_torus_add(major_radius=0.12, minor_radius=0.032, major_segments=40, minor_segments=14, location=(x, y, 1.08), rotation=(math.radians(90), 0, math.radians(25)))
        else:
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.14, location=(x, y, 1.05))
        sculpt = bpy.context.active_object
        if sx < 0:
            C.shade_smooth(sculpt)
        sculpt.data.materials.append(C.get_material("brass"))
        parts.append(sculpt)
    obj = _join("set_museum", parts, uv_scale=1.0)
    print(f"[set_museum] {sum(len(p.vertices) - 2 for p in obj.data.polygons)} треугольников")
    return obj


# ---------------------------------------------------------------------------
# Добыча музея и камера
# ---------------------------------------------------------------------------
VASE_PROFILE = (   # (радиус, высота от дна), м — снаружи снизу вверх, затем внутрь горлышка
    (0.0, 0.0), (0.026, 0.0), (0.031, 0.004), (0.037, 0.02), (0.04, 0.045), (0.039, 0.065), (0.034, 0.085), (0.025, 0.1),
    (0.02, 0.112), (0.0205, 0.126), (0.024, 0.137), (0.0235, 0.14), (0.018, 0.139), (0.016, 0.125), (0.0, 0.118),
)
VASE_HEIGHT = 0.14


def build_vase():
    """Ваза — тело вращения. Высота 14 см, начало координат — середина высоты. UV: вокруг оси и по высоте."""
    seg = 48
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    rings = []
    for r, z in VASE_PROFILE:
        if r == 0.0:
            rings.append([bm.verts.new((0, 0, z - VASE_HEIGHT / 2))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z - VASE_HEIGHT / 2)) for i in range(seg)])
    # длина профиля → координата V
    dist = [0.0]
    for (r0, z0), (r1, z1) in zip(VASE_PROFILE, VASE_PROFILE[1:]):
        dist.append(dist[-1] + math.hypot(r1 - r0, z1 - z0))
    total = dist[-1]
    for k, (a, b) in enumerate(zip(rings, rings[1:])):
        va, vb = dist[k] / total, dist[k + 1] / total
        for i in range(seg):
            j = (i + 1) % seg
            u0, u1 = i / seg, (i + 1) / seg
            if len(a) == 1:
                f = bm.faces.new((a[0], b[j], b[i])); uvs = ((u0 + u1) / 2, va), (u1, vb), (u0, vb)
            elif len(b) == 1:
                f = bm.faces.new((a[i], a[j], b[0])); uvs = (u0, va), (u1, va), ((u0 + u1) / 2, vb)
            else:
                f = bm.faces.new((a[i], a[j], b[j], b[i])); uvs = (u0, va), (u1, va), (u1, vb), (u0, vb)
            for loop, uv in zip(f.loops, uvs):
                loop[uv_layer].uv = uv
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("vase")
    bm.to_mesh(me)
    bm.free()
    obj = C.new_object("vase", me)
    C.shade_smooth(obj, 50)
    obj.data.materials.append(C.get_material("vase", (0.9, 0.9, 0.86, 1), 0.0, 0.12))
    print(f"[vase] {sum(len(p.vertices) - 2 for p in obj.data.polygons)} треугольников")
    return obj


CROWN = dict(radius=0.0675, band=0.012, low=-0.025, mid=-0.006, high=0.025, points=8)


def crown_points():
    """Положения зубцов (по центрам брусков физической формы) и камней между ними: (угол, x, y)."""
    n = CROWN["points"]
    spikes = [(2 * math.pi * i / n) for i in range(n)]
    gems = [(2 * math.pi * (i + 0.5) / n) for i in range(n)]
    return spikes, gems


def build_crown():
    """Корона: обод ⌀15 см, восемь зубцов с жемчужинами, камни на ободе. Высота 5 см, центр — в начале координат."""
    c = CROWN
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=c["radius"], depth=c["mid"] - c["low"], end_fill_type="NOTHING", location=(0, 0, (c["mid"] + c["low"]) / 2))
    band = bpy.context.active_object
    sol = band.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = c["band"]
    sol.offset = 0.0
    bev = band.modifiers.new("bevel", "BEVEL")
    bev.width = 0.0015
    bev.segments = 2
    C.apply_modifiers(band)
    C.shade_smooth(band, 45)
    parts.append(band)
    spikes, gems = crown_points()
    for a in spikes:
        x, y = c["radius"] * math.cos(a), c["radius"] * math.sin(a)
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.026, radius2=0.004, depth=c["high"] - c["mid"] + 0.004, location=(x, y, (c["high"] + c["mid"]) / 2 - 0.004))
        sp = bpy.context.active_object
        sp.scale = (1.0, 0.24, 1.0)                      # плоский зубец
        sp.rotation_euler = (0, 0, a + math.radians(90) + math.radians(45) * 0)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        sp.rotation_euler = (0, 0, a + math.radians(90))
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        C.shade_smooth(sp, 30)
        parts.append(sp)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8, radius=0.0062, location=(x, y, c["high"] - 0.004))
        pearl = bpy.context.active_object
        C.shade_smooth(pearl)
        parts.append(pearl)
    for a in gems:
        r = c["radius"] + c["band"] / 2
        bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8, radius=0.0075, location=(r * math.cos(a), r * math.sin(a), (c["mid"] + c["low"]) / 2))
        gem = bpy.context.active_object
        gem.scale = (1.0, 1.0, 0.8)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        C.shade_smooth(gem)
        parts.append(gem)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = "crown"
    obj.data.name = "crown"
    # после объединения начало координат осталось у обода — возвращаем его в центр короны,
    # иначе модель и материал (маски камней по координатам объекта) съезжают по высоте
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # у объединённых примитивов остаются свои UV-слои; оставляем один, иначе запекание и игра
    # могут взять разные слои и текстура ляжет вперемешку
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    obj.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.clear()
    obj.data.materials.append(C.get_material("crown", (1.0, 0.72, 0.25, 1), 1.0, 0.25))
    print(f"[crown] {sum(len(p.vertices) - 2 for p in obj.data.polygons)} треугольников")
    return obj


def build_camera():
    """Камера наблюдения из двух частей: cam_base — стойка (начало координат у подошвы),
    cam_head — поворотная голова (начало координат в шарнире, объектив смотрит в -Y Blender = +Z игры)."""
    base = _join("cam_base", [
        _cyl("foot", (0, 0, 0.007), 0.05, 0.014, "metal", verts=32, bevel=0.003),
        _cyl("pole", (0, 0, 0.26), 0.013, 0.5, "metal", verts=16),
        _cyl("joint", (0, 0, 0.505), 0.02, 0.03, "steel", verts=16, bevel=0.003),
    ])
    head = _join("cam_head", [
        _box("body", (0, 0.0, 0.0), (0.062, 0.12, 0.052), "metal", bevel=0.006),
        _box("visor", (0, -0.03, 0.03), (0.07, 0.13, 0.006), "metal", bevel=0.002),
        _cyl("lens_ring", (0, -0.066, 0.0), 0.024, 0.016, "steel", axis="Y", verts=24, bevel=0.002),
        _cyl("lens", (0, -0.075, 0.0), 0.017, 0.006, "metal", axis="Y", verts=24),
    ])
    return [base, head]


# ---------------------------------------------------------------------------
# Банк: монеты, груз, заслонка
# ---------------------------------------------------------------------------
def build_coins():
    """Стопка из восьми монет ⌀4 см, высота 4 см; монеты лежат чуть неровно. Центр — в начале координат."""
    parts = []
    n, h = 8, 0.04
    for i in range(n):
        dx, dy = 0.0012 * math.sin(i * 2.4), 0.0012 * math.cos(i * 1.7)
        coin = _cyl("coin", (dx, dy, -h / 2 + (i + 0.5) * h / n), 0.0188, h / n - 0.0006, "brass", verts=32, bevel=0.0007)
        parts.append(coin)
    obj = _join("coins", parts)
    print(f"[coins] {sum(len(p.vertices) - 2 for p in obj.data.polygons)} треугольников")
    return obj


def build_weight():
    """Груз для весов: стальной брусок 7 × 7 × 6 см (высота) с фасками и ручкой-скобой, утопленной в габарит."""
    parts = [
        _box("block", (0, 0, -0.006), (0.07, 0.07, 0.048), "steel", bevel=0.006),
        _box("handle_l", (-0.018, 0, 0.022), (0.008, 0.012, 0.012), "metal"),
        _box("handle_r", (0.018, 0, 0.022), (0.008, 0.012, 0.012), "metal"),
        _box("handle_top", (0, 0, 0.0265), (0.046, 0.012, 0.007), "metal", bevel=0.002),
    ]
    return _join("weight", parts)


def build_shutter():
    """Пластина заслонки — единичная (1 × 1 × 1 в осях игры: X — вдоль хода, Y — высота, Z — толщина);
    игра растягивает её под размер отверстия. В Blender это X, Z и Y соответственно."""
    parts = [_box("plate", (0, 0, 0), (1.0, 0.6, 1.0), "steel", bevel=0.02)]
    for z in (-0.32, 0.32):
        parts.append(_box("rib", (0, -0.4, z), (0.92, 0.2, 0.06), "metal"))
    for x in (-0.4, 0.4):
        for z in (-0.4, 0.4):
            parts.append(_cyl("rivet", (x, -0.36, z), 0.035, 0.3, "metal", axis="Y", verts=12))
    return _join("shutter", parts)
