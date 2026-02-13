#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Voice Input — Chrome Web Store Build Script
# ============================================================
# This script:
#   1. Validates the manifest.json
#   2. Generates Chrome Web Store assets (icon, promo image)
#   3. Packages the extension into a .zip ready for upload
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
STORE_DIR="$SCRIPT_DIR/store-assets"
ZIP_NAME="voice-input-extension.zip"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}  Voice Input — Build for Chrome Web Store${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""

# --------------------------------------------------
# Step 1: Validate manifest.json
# --------------------------------------------------
echo -e "${YELLOW}[1/4]${NC} Validating manifest.json..."

MANIFEST="$SCRIPT_DIR/manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo -e "${RED}ERROR: manifest.json not found!${NC}"
  exit 1
fi

# Check it's valid JSON
if ! python3 -c "import json; json.load(open('$MANIFEST'))" 2>/dev/null; then
  echo -e "${RED}ERROR: manifest.json is not valid JSON!${NC}"
  exit 1
fi

# Extract and validate required fields
python3 << 'PYEOF'
import json, sys, os

base = os.environ.get("SCRIPT_DIR", ".")
m = json.load(open(os.path.join(base, "manifest.json")))

errors = []

# Required fields
for field in ["manifest_version", "name", "version", "description"]:
    if field not in m:
        errors.append(f"Missing required field: {field}")

# Manifest version
if m.get("manifest_version") != 3:
    errors.append("manifest_version must be 3")

# Description length
desc = m.get("description", "")
if len(desc) > 132:
    errors.append(f"Description is {len(desc)} chars (max 132)")

# Check all referenced files exist
files = []
bg = m.get("background", {})
if "service_worker" in bg:
    files.append(bg["service_worker"])
action = m.get("action", {})
if "default_popup" in action:
    files.append(action["default_popup"])
for v in action.get("default_icon", {}).values():
    files.append(v)
for v in m.get("icons", {}).values():
    files.append(v)
opts = m.get("options_ui", {})
if "page" in opts:
    files.append(opts["page"])

missing = [f for f in files if not os.path.exists(os.path.join(base, f))]
for f in missing:
    errors.append(f"Referenced file not found: {f}")

if errors:
    for e in errors:
        print(f"  ERROR: {e}", file=sys.stderr)
    sys.exit(1)
else:
    v = m["version"]
    n = m["name"]
    print(f"  Name: {n}")
    print(f"  Version: {v}")
    print(f"  Description: {desc}")
    print(f"  All referenced files present")
PYEOF

MANIFEST_OK=$?
if [ $MANIFEST_OK -ne 0 ]; then
  echo -e "${RED}Manifest validation failed!${NC}"
  exit 1
fi
echo -e "${GREEN}  Manifest OK${NC}"
echo ""

# --------------------------------------------------
# Step 2: Generate store assets
# --------------------------------------------------
echo -e "${YELLOW}[2/4]${NC} Generating store assets..."

mkdir -p "$STORE_DIR"

python3 << 'PYEOF'
import struct, zlib, os, math

store_dir = os.path.join(os.environ.get("SCRIPT_DIR", "."), "store-assets")

def create_png(width, height, pixels):
    def chunk(ct, data):
        c = ct + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            raw += bytes(pixels[y][x])
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))

def dist(x1, y1, x2, y2):
    return math.sqrt((x1-x2)**2 + (y1-y2)**2)

# --- Store icon: 128x128 with 96x96 artwork centered (16px padding) ---
def make_store_icon():
    W, H = 128, 128
    pad = 16
    green = (76, 175, 80, 255)
    white = (255, 255, 255, 255)
    t = (0, 0, 0, 0)
    pixels = [[t]*W for _ in range(H)]
    cx, cy = W/2, H/2
    r = 48  # 96/2

    # Circle bg
    for y in range(H):
        for x in range(W):
            if dist(x, y, cx, cy) <= r:
                pixels[y][x] = green

    # Mic capsule
    mc_w, mc_h, mc_r = 10, 20, 10
    mc_top = cy - 18
    for y in range(H):
        for x in range(W):
            fx, fy = x - cx, y - mc_top
            # Rectangle body
            if abs(fx) <= mc_w and 0 <= fy <= mc_h:
                pixels[y][x] = white
            # Rounded top
            if fy < 0 and dist(fx, fy, 0, 0) <= mc_r:
                pixels[y][x] = white
            # Rounded bottom
            if fy > mc_h and dist(fx, fy - mc_h, 0, 0) <= mc_r:
                pixels[y][x] = white

    # Arc
    arc_r = 22
    arc_cy = cy + 2
    stroke = 3
    for y in range(H):
        for x in range(W):
            if y < arc_cy: continue
            d = dist(x, y, cx, arc_cy)
            if abs(d - arc_r) <= stroke and y <= arc_cy + arc_r:
                if dist(x, y, cx, cy) <= r:
                    pixels[y][x] = white

    # Stem
    stem_top = int(arc_cy + arc_r - 2)
    stem_bot = int(cy + 30)
    for y in range(stem_top, min(H, stem_bot)):
        for x in range(int(cx-2), int(cx+3)):
            if dist(x, y, cx, cy) <= r:
                pixels[y][x] = white

    # Base
    base_y = stem_bot - 2
    for y in range(base_y, min(H, base_y + 3)):
        for x in range(int(cx-10), int(cx+11)):
            if dist(x, y, cx, cy) <= r:
                pixels[y][x] = white

    return create_png(W, H, pixels)

# --- Small promo image: 440x280 ---
def make_promo():
    W, H = 440, 280
    dark = (26, 26, 46)
    green = (76, 175, 80)
    white = (255, 255, 255)
    red = (229, 62, 62)

    pixels = [[(0,0,0,0)]*W for _ in range(H)]

    # Gradient background
    for y in range(H):
        t = y / H
        c = lerp(dark + (255,), (22, 33, 62, 255), t)
        for x in range(W):
            pixels[y][x] = c

    # Green circle (logo area)
    logo_cx, logo_cy, logo_r = 150, 130, 70
    for y in range(H):
        for x in range(W):
            d = dist(x, y, logo_cx, logo_cy)
            if d <= logo_r:
                pixels[y][x] = green + (255,)

    # White mic in circle
    mc_cx, mc_cy = logo_cx, logo_cy
    mc_w, mc_h = 7, 14
    mc_top = mc_cy - 14
    for y in range(H):
        for x in range(W):
            fx, fy = x - mc_cx, y - mc_top
            if abs(fx) <= mc_w and 0 <= fy <= mc_h:
                pixels[y][x] = white + (255,)
            if fy < 0 and dist(fx, fy, 0, 0) <= mc_w:
                pixels[y][x] = white + (255,)
            if fy > mc_h and dist(fx, fy - mc_h, 0, 0) <= mc_w:
                pixels[y][x] = white + (255,)

    # Arc around mic
    arc_r = 16
    arc_cy2 = mc_cy + 2
    for y in range(H):
        for x in range(W):
            if y < arc_cy2: continue
            d = dist(x, y, mc_cx, arc_cy2)
            if abs(d - arc_r) <= 2 and y <= arc_cy2 + arc_r:
                if dist(x, y, logo_cx, logo_cy) <= logo_r:
                    pixels[y][x] = white + (255,)

    # Stem + base
    for y in range(int(arc_cy2 + arc_r - 1), int(mc_cy + 28)):
        for x in range(int(mc_cx-1), int(mc_cx+2)):
            if dist(x, y, logo_cx, logo_cy) <= logo_r:
                pixels[y][x] = white + (255,)
    for y in range(int(mc_cy + 26), int(mc_cy + 28)):
        for x in range(int(mc_cx-7), int(mc_cx+8)):
            if dist(x, y, logo_cx, logo_cy) <= logo_r:
                pixels[y][x] = white + (255,)

    # Text area: "Voice Input" - simple block letters representation
    # (actual text needs to be added via image editor for best results)
    # We'll add a subtle "recording" bar on the right side
    bar_x = 260
    bar_y_start = 100
    bar_h = 60
    bar_w = 140
    # Rounded rect hint area
    for y in range(bar_y_start, bar_y_start + bar_h):
        for x in range(bar_x, bar_x + bar_w):
            rx = min(x - bar_x, bar_x + bar_w - x)
            ry = min(y - bar_y_start, bar_y_start + bar_h - y)
            if rx >= 6 and ry >= 6:
                pixels[y][x] = (40, 40, 70, 255)

    # Red REC dot
    rec_cx, rec_cy = bar_x + 18, bar_y_start + bar_h // 2
    for y in range(H):
        for x in range(W):
            if dist(x, y, rec_cx, rec_cy) <= 6:
                pixels[y][x] = red + (255,)

    # Fake waveform lines
    for i in range(5):
        lx = bar_x + 38 + i * 16
        lh = [12, 22, 18, 26, 14][i]
        ly_start = bar_y_start + (bar_h - lh) // 2
        for y in range(ly_start, ly_start + lh):
            for x in range(lx, lx + 4):
                pixels[y][x] = green + (255,)

    return create_png(W, H, pixels)

# Write files
icon_data = make_store_icon()
with open(os.path.join(store_dir, "icon-128.png"), "wb") as f:
    f.write(icon_data)
print("  Created store-assets/icon-128.png (128x128)")

promo_data = make_promo()
with open(os.path.join(store_dir, "promo-small-440x280.png"), "wb") as f:
    f.write(promo_data)
print("  Created store-assets/promo-small-440x280.png (440x280)")
PYEOF

echo -e "${GREEN}  Store assets generated${NC}"
echo ""

# --------------------------------------------------
# Step 3: Build the zip
# --------------------------------------------------
echo -e "${YELLOW}[3/4]${NC} Packaging extension..."

mkdir -p "$BUILD_DIR"
rm -f "$BUILD_DIR/$ZIP_NAME"

# Zip only the extension files (exclude build artifacts, store assets, scripts)
cd "$SCRIPT_DIR"
zip -r "$BUILD_DIR/$ZIP_NAME" \
  manifest.json \
  background.js \
  content.js \
  content.css \
  icons/ \
  -x "*.DS_Store" \
  -x "__MACOSX/*"

ZIP_SIZE=$(du -h "$BUILD_DIR/$ZIP_NAME" | cut -f1)
echo -e "${GREEN}  Created: build/$ZIP_NAME ($ZIP_SIZE)${NC}"
echo ""

# --------------------------------------------------
# Step 4: Summary
# --------------------------------------------------
echo -e "${YELLOW}[4/4]${NC} Build complete!"
echo ""
echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}  Output files:${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""
echo "  Extension package (upload this):"
echo "    build/$ZIP_NAME"
echo ""
echo "  Store listing assets:"
echo "    store-assets/icon-128.png        (128x128 store icon)"
echo "    store-assets/promo-small-440x280.png (440x280 promo image)"
echo ""
echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}  Publishing checklist:${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""
echo "  1. Register a developer account (\$5 one-time fee):"
echo "     https://chrome.google.com/webstore/devconsole"
echo ""
echo "  2. Click 'Add new item' and upload:"
echo "     build/$ZIP_NAME"
echo ""
echo "  3. Fill out the Store Listing tab:"
echo "     - Description (already in manifest, but expand it)"
echo "     - Upload store-assets/icon-128.png"
echo "     - Upload store-assets/promo-small-440x280.png"
echo "     - Take a screenshot (1280x800) and upload it"
echo ""
echo "  4. Fill out the Privacy tab:"
echo "     - Single purpose: 'Speech-to-text for input fields'"
echo "     - Data usage: 'Audio is processed by browser speech API,"
echo "       not sent to any external server by this extension'"
echo "     - Permissions justification:"
echo "       activeTab: 'Inject speech recognition into the active tab'"
echo "       scripting: 'Inject content script on user click'"
echo "       storage:   'Save language preference locally'"
echo "       contextMenus: 'Language picker on right-click'"
echo ""
echo "  5. Fill out the Distribution tab:"
echo "     - Visibility: Public"
echo "     - Regions: All regions (or pick specific ones)"
echo ""
echo "  6. Click 'Submit for Review'"
echo "     Review typically takes 1-3 business days."
echo ""
echo -e "${GREEN}Done!${NC}"
