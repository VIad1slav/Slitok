"""Общие помощники для скриптов Blender: пути, сцена, ноды материалов, запекание, PNG, экспорт GLB, превью.

Все пути считаются от корня проекта (два уровня вверх от этого файла).
Система координат: игра — +Y вверх, -Z вперёд; Blender — +Z вверх, +Y вперёд.
Точка игры (x, y, z) в Blender — это (x, -z, y); экспортёр glTF (+Y up) переводит обратно.
"""
import json
import math
import os
import struct
import sys
import zlib

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(ROOT, "assets", "models")
TEXTURES = os.path.join(ROOT, "assets", "textures")
PREVIEWS = os.path.join(HERE, "previews")
CACHE = os.path.join(HERE, "_cache")
for _d in (MODELS, TEXTURES, PREVIEWS, CACHE):
    os.makedirs(_d, exist_ok=True)


def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")


def load_levels():
    """Параметры уровней и мира, выгруженные из src/levels.js (tools/export_levels.mjs)."""
    with open(os.path.join(HERE, "levels.json"), encoding="utf-8") as f:
        return json.load(f)


def g2b(p):
    """Точка/вектор из координат игры в координаты Blender."""
    return (p[0], -p[2], p[1])


# ---------------------------------------------------------------------------
# Сцена
# ---------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def setup_cycles(samples=128):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = False
    device = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                device = "GPU"
                break
    except Exception as exc:  # нет GPU — считаем на процессоре
        print("[cycles] GPU недоступен:", exc)
    scene.cycles.device = device
    print(f"[cycles] устройство: {device}, сэмплов: {samples}")
    return device


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def new_object(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def apply_modifiers(obj):
    select_only(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def shade_smooth(obj, angle_deg=None):
    for p in obj.data.polygons:
        p.use_smooth = True
    if angle_deg is not None:
        select_only(obj)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
        except Exception:
            try:
                bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
            except Exception as exc:
                print("[shade] сглаживание по углу недоступно:", exc)


def box_uv(obj, scale=1.0):
    """UV-развёртка «коробкой» в метрах: по доминирующей оси нормали. Для тайловых текстур окружения."""
    me = obj.data
    uv = me.uv_layers.active or me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = co.y, co.z
            elif ax == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            uv.data[li].uv = (u * scale, v * scale)


def get_material(name, color=(0.8, 0.8, 0.8, 1), metallic=0.0, roughness=0.5):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
    return m


def export_glb(path, objects, skins=False):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    kwargs = dict(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=not skins,
        export_texcoords=True, export_normals=True, export_materials="EXPORT", export_animations=False,
        export_skins=skins, export_cameras=False, export_lights=False,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_image_format="NONE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)
    print(f"[glb] {rel(path)}  {os.path.getsize(path) / 1024:.0f} КБ")


# ---------------------------------------------------------------------------
# Конструктор нодовых материалов
# ---------------------------------------------------------------------------
def _sock(coll, ident):
    for s in coll:
        if s.identifier == ident:
            return s
    raise KeyError(ident)


class NT:
    """Тонкая обёртка над node_tree: короткие методы вместо ручной расстановки нод."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.mat = mat
        self.t = mat.node_tree
        self.t.nodes.clear()
        self.out = self.t.nodes.new("ShaderNodeOutputMaterial")
        self._tc = None

    def new(self, kind, **props):
        n = self.t.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def set(self, sock, value):
        if value is None:
            return
        if isinstance(value, bpy.types.NodeSocket):
            self.t.links.new(value, sock)
        elif isinstance(value, (int, float)):
            if sock.type in ("RGBA",):
                sock.default_value = (value, value, value, 1)
            elif sock.type == "VECTOR":
                sock.default_value = (value, value, value)
            else:
                sock.default_value = value
        else:
            v = tuple(value)
            if sock.type == "RGBA" and len(v) == 3:
                v = v + (1,)
            sock.default_value = v

    # --- координаты
    def coords(self, which="Object"):
        if self._tc is None:
            self._tc = self.new("ShaderNodeTexCoord")
        return self._tc.outputs[which]

    def sep(self, vec):
        n = self.new("ShaderNodeSeparateXYZ")
        self.set(n.inputs[0], vec)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def comb(self, x=0.0, y=0.0, z=0.0):
        n = self.new("ShaderNodeCombineXYZ")
        self.set(n.inputs[0], x); self.set(n.inputs[1], y); self.set(n.inputs[2], z)
        return n.outputs[0]

    def mapping(self, vec, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        n = self.new("ShaderNodeMapping")
        self.set(n.inputs["Vector"], vec)
        n.inputs["Location"].default_value = loc
        n.inputs["Rotation"].default_value = rot
        n.inputs["Scale"].default_value = scale
        return n.outputs[0]

    # --- математика
    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(n.inputs[0], a)
        if b is not None:
            self.set(n.inputs[1], b)
        if c is not None:
            self.set(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b): return self.math("ADD", a, b)
    def sub(self, a, b): return self.math("SUBTRACT", a, b)
    def mul(self, a, b): return self.math("MULTIPLY", a, b)
    def sat(self, a): return self.math("ADD", a, 0.0, clamp=True)
    def maxf(self, a, b): return self.math("MAXIMUM", a, b)
    def minf(self, a, b): return self.math("MINIMUM", a, b)

    def smoothstep(self, value, lo, hi):
        n = self.new("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        self.set(n.inputs["Value"], value)
        self.set(n.inputs["From Min"], lo)
        self.set(n.inputs["From Max"], hi)
        return n.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        n = self.new("ShaderNodeVectorMath", operation=op)
        self.set(n.inputs[0], a)
        if b is not None:
            self.set(n.inputs[1], b)
        if scale is not None:
            self.set(n.inputs["Scale"], scale)
        return n.outputs[1] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs[0]

    def mix(self, fac, a, b, blend="MIX"):
        n = self.new("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        self.set(_sock(n.inputs, "Factor_Float"), fac)
        self.set(_sock(n.inputs, "A_Color"), a)
        self.set(_sock(n.inputs, "B_Color"), b)
        return _sock(n.outputs, "Result_Color")

    def mixf(self, fac, a, b):
        n = self.new("ShaderNodeMix", data_type="FLOAT")
        self.set(_sock(n.inputs, "Factor_Float"), fac)
        self.set(_sock(n.inputs, "A_Float"), a)
        self.set(_sock(n.inputs, "B_Float"), b)
        return _sock(n.outputs, "Result_Float")

    def ramp(self, fac, stops, interpolation="LINEAR"):
        n = self.new("ShaderNodeValToRGB")
        cr = n.color_ramp
        cr.interpolation = interpolation
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            el.color = col if len(col) == 4 else (*col, 1)
        self.set(n.inputs[0], fac)
        return n.outputs[0]

    # --- текстуры
    def noise(self, vec, scale=5.0, detail=2.0, rough=0.5, w=None, distortion=0.0, lacunarity=2.0):
        n = self.new("ShaderNodeTexNoise", noise_dimensions="4D" if w is not None else "3D")
        self.set(n.inputs["Vector"], vec)
        if w is not None:
            self.set(n.inputs["W"], w)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Lacunarity"].default_value = lacunarity
        n.inputs["Distortion"].default_value = distortion
        return n.outputs[0]

    def voronoi(self, vec, scale=5.0, feature="F1", w=None, randomness=1.0, output="Distance"):
        n = self.new("ShaderNodeTexVoronoi", voronoi_dimensions="4D" if w is not None else "3D", feature=feature)
        self.set(n.inputs["Vector"], vec)
        if w is not None:
            self.set(n.inputs["W"], w)
        n.inputs["Scale"].default_value = scale
        n.inputs["Randomness"].default_value = randomness
        return n.outputs[output]

    def image(self, img, vec, extension="CLIP", interpolation="Linear"):
        n = self.new("ShaderNodeTexImage", image=img, extension=extension, interpolation=interpolation)
        self.set(n.inputs[0], vec)
        return n.outputs[0]

    def bump(self, height, strength=1.0, distance=0.001, normal=None):
        n = self.new("ShaderNodeBump")
        n.inputs["Strength"].default_value = strength
        n.inputs["Distance"].default_value = distance
        self.set(n.inputs["Height"], height)
        if normal is not None:
            self.set(n.inputs["Normal"], normal)
        return n.outputs[0]

    def geometry(self, which):
        return self.new("ShaderNodeNewGeometry").outputs[which]

    def torus(self, su, sv):
        """Бесшовные координаты для шума: UV-квадрат наматывается на тор в 4D.
        su, sv — сколько «единиц шума» укладывается по u и по v. Возвращает (vector, w)."""
        u, v, _ = self.sep(self.coords("UV"))
        au, av = self.mul(u, 2 * math.pi), self.mul(v, 2 * math.pi)
        ru, rv = su / (2 * math.pi), sv / (2 * math.pi)
        vec = self.comb(self.mul(self.math("COSINE", au), ru), self.mul(self.math("SINE", au), ru), self.mul(self.math("COSINE", av), rv))
        return vec, self.mul(self.math("SINE", av), rv)

    # --- выход
    def output(self, ch, mode="bsdf"):
        """ch: dict(color, rough, metal, normal[, alpha]). mode: 'bsdf' или имя канала для запекания через Emission."""
        for l in list(self.out.inputs["Surface"].links):
            self.t.links.remove(l)
        if mode == "bsdf":
            if not hasattr(self, "_bsdf"):
                self._bsdf = self.new("ShaderNodeBsdfPrincipled")
                self.set(self._bsdf.inputs["Base Color"], ch.get("color", 0.8))
                self.set(self._bsdf.inputs["Roughness"], ch.get("rough", 0.5))
                self.set(self._bsdf.inputs["Metallic"], ch.get("metal", 0.0))
                if ch.get("normal") is not None:
                    self.set(self._bsdf.inputs["Normal"], ch["normal"])
                for key, sock in (("coat", "Coat Weight"), ("sheen", "Sheen Weight")):
                    if key in ch:
                        self.set(self._bsdf.inputs[sock], ch[key])
            self.t.links.new(self._bsdf.outputs[0], self.out.inputs["Surface"])
        else:
            em = self.new("ShaderNodeEmission")
            self.set(em.inputs["Color"], ch[mode])
            self.t.links.new(em.outputs[0], self.out.inputs["Surface"])


# ---------------------------------------------------------------------------
# PNG и запекание
# ---------------------------------------------------------------------------
def save_png(path, arr):
    """arr: uint8, форма (H, W, C), C = 1 | 3 | 4, первая строка — верх картинки. Максимальное сжатие."""
    arr = np.ascontiguousarray(arr)
    h, w, c = arr.shape
    color_type = {1: 0, 3: 2, 4: 6}[c]
    best = None
    for ftype in (0, 1, 2):  # без фильтра, Sub, Up — берём то, что сжалось лучше
        if ftype == 0:
            data = arr
        elif ftype == 1:
            data = arr.copy(); data[:, 1:, :] = arr[:, 1:, :] - arr[:, :-1, :]
        else:
            data = arr.copy(); data[1:, :, :] = arr[1:, :, :] - arr[:-1, :, :]
        raw = np.empty((h, w * c + 1), dtype=np.uint8)
        raw[:, 0] = ftype
        raw[:, 1:] = data.reshape(h, w * c)
        comp = zlib.compress(raw.tobytes(), 9)
        if best is None or len(comp) < len(best):
            best = comp

    def chunk(tag, payload):
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0)) + chunk(b"IDAT", best) + chunk(b"IEND", b""))
    print(f"[png] {rel(path)}  {os.path.getsize(path) / 1024:.0f} КБ")


def image_array(img):
    """Пиксели изображения Blender → uint8 (H, W, 4), верхняя строка первой."""
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    return (np.clip(buf.reshape(h, w, 4)[::-1], 0, 1) * 255 + 0.5).astype(np.uint8)


def bake(obj, nt, ch, what, size, margin=16):
    """Запечь один канал материала в новое изображение и вернуть его как массив uint8 (H, W, 4)."""
    scene = bpy.context.scene
    srgb = what == "color"
    img = bpy.data.images.new(f"bake_{obj.name}_{what}", size, size, alpha=False, is_data=not srgb)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    node = nt.new("ShaderNodeTexImage", image=img)
    for n in nt.t.nodes:
        n.select = False
    node.select = True
    nt.t.nodes.active = node
    select_only(obj)
    scene.render.bake.margin = margin
    scene.render.bake.use_clear = True
    scene.render.bake.use_selected_to_active = False
    if what == "normal":
        nt.output(ch, "bsdf")
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", normal_r="POS_X", normal_g="POS_Y", normal_b="POS_Z", margin=margin)
    elif what == "ao":
        nt.output(ch, "bsdf")
        bpy.ops.object.bake(type="AO", margin=margin)
    else:
        nt.output(ch, what)
        bpy.ops.object.bake(type="EMIT", margin=margin)
    arr = image_array(img)
    nt.t.nodes.remove(node)
    bpy.data.images.remove(img)
    nt.output(ch, "bsdf")
    return arr


def bake_pbr(obj, nt, ch, name, size, ao=True):
    """Запечь набор: <name>_albedo.png, <name>_normal.png, <name>_orm.png (R = AO, G = roughness, B = metalness)."""
    print(f"[bake] {name} {size}px")
    albedo = bake(obj, nt, ch, "color", size)
    save_png(os.path.join(TEXTURES, f"{name}_albedo.png"), albedo[:, :, :3])
    normal = bake(obj, nt, ch, "normal", size)
    save_png(os.path.join(TEXTURES, f"{name}_normal.png"), normal[:, :, :3])
    rough = bake(obj, nt, ch, "rough", size)[:, :, 0]
    if isinstance(ch.get("metal", 0.0), bpy.types.NodeSocket):
        metal = bake(obj, nt, ch, "metal", size)[:, :, 0]
    else:
        metal = np.full_like(rough, int(round(float(ch.get("metal", 0.0)) * 255)))
    occ = bake(obj, nt, ch, "ao", size)[:, :, 0] if ao else np.full_like(rough, 255)
    save_png(os.path.join(TEXTURES, f"{name}_orm.png"), np.dstack([occ, rough, metal]))


# ---------------------------------------------------------------------------
# Превью
# ---------------------------------------------------------------------------
def studio_world(strength=1.0, hdri="studio.exr"):
    world = bpy.data.worlds.new("preview_world")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    path = os.path.join(bpy.utils.resource_path("LOCAL"), "datafiles", "studiolights", "world", hdri)
    if os.path.exists(path):
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(path, check_existing=True)
        nt.links.new(env.outputs[0], bg.inputs["Color"])
    else:
        bg.inputs["Color"].default_value = (0.6, 0.6, 0.65, 1)
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    bpy.context.scene.world = world
    return world


def look_at(obj, target):
    from mathutils import Vector
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_preview(name, cam_pos, target, lens=60, size=1024, engine="BLENDER_EEVEE", key=True, samples=64, floor=None):
    """Рендер превью 1024×1024 со студийным HDRI. При сбое Eevee в фоновом режиме — Cycles."""
    scene = bpy.context.scene
    if scene.world is None or scene.world.name != "preview_world":
        studio_world(0.55)
    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.lens = lens
    cam_data.clip_start = 0.01
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = cam_pos
    look_at(cam, target)
    scene.camera = cam
    extra = [cam]
    if key:
        ld = bpy.data.lights.new("preview_key", "AREA")
        ld.energy = 25.0 if key is True else float(key)
        ld.size = 0.6
        light = bpy.data.objects.new("preview_key", ld)
        scene.collection.objects.link(light)
        light.location = (cam_pos[0] * 0.3 - 0.4, cam_pos[1] * 0.5, abs(cam_pos[2]) + 0.6)
        look_at(light, target)
        extra.append(light)
    if floor is not None:
        bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, floor))
        fl = bpy.context.active_object
        fl.data.materials.append(get_material("preview_floor", (0.035, 0.035, 0.04, 1), 0.0, 0.55))
        extra.append(fl)
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    try:
        scene.view_settings.look = "None"
    except Exception:
        pass
    path = os.path.join(PREVIEWS, name + ".png")
    scene.render.filepath = path
    ok = False
    for eng in (engine, "CYCLES"):
        try:
            scene.render.engine = eng
            if eng == "CYCLES":
                scene.cycles.samples = samples
                scene.cycles.use_denoising = True
            else:
                try:
                    scene.eevee.taa_render_samples = samples
                    scene.eevee.use_raytracing = True
                except Exception:
                    pass
            if os.path.exists(path):
                os.remove(path)
            bpy.ops.render.render(write_still=True)
            if os.path.exists(path) and os.path.getsize(path) > 2000:
                ok = True
                print(f"[preview] {rel(path)} ({eng})")
                break
        except Exception as exc:
            print(f"[preview] {eng} не сработал: {exc}")
    for o in extra:
        bpy.data.objects.remove(o, do_unlink=True)
    return ok
