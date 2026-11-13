#!/usr/bin/env python3
"""產生 iOS 的 App 圖示（1024×1024、不透明、填滿，圓角由 iOS 自己裁）。

圖案和桌面版 scripts/make-icon.mjs 相同：深色底、四個彩色格子、左上格有播放符號。
需要 Pillow。執行：python3 ios/scripts/make-icon.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # 超取樣倍數（反鋸齒）
BG = (24, 24, 28)
TILES = [(61, 139, 253), (38, 186, 160), (245, 176, 65), (232, 93, 117)]

# 桌面版圖示是 256×256、四周留 16px；iOS 版把中間 224px 的部分放大到填滿。
K = SIZE * SS / 224
INNER, GAP, RADIUS = 28, 12, 12
tile = (224 - 2 * INNER - GAP) / 2

img = Image.new('RGB', (SIZE * SS, SIZE * SS), BG)
draw = ImageDraw.Draw(img)
boxes = []
for i, color in enumerate(TILES):
    x0 = INNER + (i % 2) * (tile + GAP)
    y0 = INNER + (i // 2) * (tile + GAP)
    boxes.append((x0, y0))
    draw.rounded_rectangle([x0 * K, y0 * K, (x0 + tile) * K, (y0 + tile) * K], radius=RADIUS * K, fill=color)

cx = boxes[0][0] + tile / 2 + 3
cy = boxes[0][1] + tile / 2
draw.polygon([((cx - 13) * K, (cy - 17) * K), ((cx - 13) * K, (cy + 17) * K), ((cx + 17) * K, cy * K)], fill=(255, 255, 255))

out = Path(__file__).resolve().parents[1] / 'MultiView' / 'Assets.xcassets' / 'AppIcon.appiconset' / 'icon-1024.png'
img.resize((SIZE, SIZE), Image.LANCZOS).save(out, optimize=True)
print(out)
