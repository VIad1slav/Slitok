"""Пересобрать все ассеты одной командой (из корня проекта):

    blender --background --python tools/blender/build_all.py

Шаги: 1) levels.json из src/levels.js (нужен Node.js; если его нет — берётся уже лежащий файл),
      2) модели → assets/models/*.glb + превью моделей,
      3) текстуры → assets/textures/*.png + превью с текстурами.
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

node = shutil.which("node")
if node:
    subprocess.run([node, os.path.join("tools", "export_levels.mjs")], cwd=ROOT, check=True)
elif not os.path.exists(os.path.join(HERE, "levels.json")):
    raise SystemExit("Нет Node.js и нет tools/blender/levels.json — сначала выполните: node tools/export_levels.mjs")

import build_models  # noqa: E402
import bake_textures  # noqa: E402

build_models.main()
bake_textures.bake_all()
bake_textures.previews()

total = 0
for folder in ("models", "textures"):
    for name in os.listdir(os.path.join(ROOT, "assets", folder)):
        total += os.path.getsize(os.path.join(ROOT, "assets", folder, name))
print(f"[build_all] готово, вес assets: {total / 1e6:.1f} МБ")
