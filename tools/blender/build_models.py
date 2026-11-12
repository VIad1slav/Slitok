"""Этап моделей: строит все GLB в assets/models/ и превью в tools/blender/previews/.

Запуск из корня проекта:
    blender --background --python tools/blender/build_models.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import common as C  # noqa: E402
import models as M  # noqa: E402


def main():
    data = C.load_levels()

    # --- рука
    C.reset_scene()
    hand, rig = M.build_hand()
    C.export_glb(os.path.join(C.MODELS, "hand.glb"), [hand, rig], skins=True)
    C.render_preview("model_hand_rest", (-0.30, 0.34, 0.36), (0.0, -0.02, 0.0), lens=55, floor=-0.06, key=10)
    M.pose_hand(rig, 0.85)
    C.render_preview("model_hand_fist", (-0.26, 0.36, -0.02), (0.0, 0.03, -0.02), lens=60, key=10)
    C.render_preview("model_hand_fist_top", (0.12, 0.36, 0.3), (0.0, 0.04, -0.01), lens=70, key=10)

    # --- слиток
    C.reset_scene()
    bar = M.build_bar(data["bar"])
    C.export_glb(os.path.join(C.MODELS, "gold_bar.glb"), [bar])
    C.render_preview("model_gold_bar", (0.2, -0.26, 0.19), (0, 0, 0), lens=70, floor=-data["bar"]["size"][1] / 2)

    # --- стеклянные коробки
    C.reset_scene()
    walls = M.build_glass_boxes(data)
    C.export_glb(os.path.join(C.MODELS, "glass_box.glb"), walls)
    glass = bpy.data.materials["glass"]
    bsdf = next(n for n in glass.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["IOR"].default_value = 1.5
    for lvl, dx in ((3, -0.32), (8, 0.32)):   # для превью показываем две коробки рядом
        for o in walls:
            if o.name.startswith(f"L{lvl}_"):
                o.location.x += dx
            elif not o.name.startswith(("L3_", "L8_")):
                o.hide_render = True
    C.render_preview("model_glass_box", (0.75, -1.15, 0.62), (0, 0, 0.13), lens=60, floor=0.0, engine="CYCLES", samples=96)

    # --- стол, подставка, комната
    C.reset_scene()
    C.export_glb(os.path.join(C.MODELS, "table.glb"), [M.build_table(data)])
    C.reset_scene()
    C.export_glb(os.path.join(C.MODELS, "pedestal.glb"), [M.build_pedestal()])
    C.reset_scene()
    room, bank_set = M.build_room(data)
    C.export_glb(os.path.join(C.MODELS, "room.glb"), [room])
    C.export_glb(os.path.join(C.MODELS, "set_bank.glb"), [bank_set])
    C.reset_scene()
    C.export_glb(os.path.join(C.MODELS, "set_museum.glb"), [M.build_set_museum(data)])

    # --- добыча музея и камера
    C.reset_scene()
    vase = M.build_vase()
    C.export_glb(os.path.join(C.MODELS, "vase.glb"), [vase])
    C.render_preview("model_vase", (0.16, -0.26, 0.12), (0, 0, 0), lens=70, floor=-M.VASE_HEIGHT / 2, key=8)
    C.reset_scene()
    crown = M.build_crown()
    C.export_glb(os.path.join(C.MODELS, "crown.glb"), [crown])
    C.render_preview("model_crown", (0.17, -0.25, 0.17), (0, 0, 0), lens=70, floor=-0.025, key=8)
    C.reset_scene()
    C.export_glb(os.path.join(C.MODELS, "camera.glb"), M.build_camera())

    # --- банк: монеты, груз, заслонка
    for name, build in (("coins", M.build_coins), ("weight", M.build_weight), ("shutter", M.build_shutter)):
        C.reset_scene()
        C.export_glb(os.path.join(C.MODELS, f"{name}.glb"), [build()])

    # --- казино: фишки, кубик, бриллиант, обстановка; украшения руки
    for name, build in (("chips", M.build_chips), ("dice", M.build_dice), ("diamond", M.build_diamond), ("ring", M.build_ring), ("watch", M.build_watch)):
        C.reset_scene()
        C.export_glb(os.path.join(C.MODELS, f"{name}.glb"), [build()])
    C.reset_scene()
    C.export_glb(os.path.join(C.MODELS, "set_casino.glb"), [M.build_set_casino(data)])
    for name, build in (("set_pawnshop", M.build_set_pawnshop), ("set_boss", M.build_set_boss)):
        C.reset_scene()
        C.export_glb(os.path.join(C.MODELS, f"{name}.glb"), [build(data)])
    print("[models] готово")


if __name__ == "__main__":
    main()
