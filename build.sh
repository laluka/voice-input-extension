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
# Step 2: Generate icons & store assets from icon.png
# --------------------------------------------------
echo -e "${YELLOW}[2/4]${NC} Generating icons & store assets..."

ICON_SRC="$SCRIPT_DIR/icon.png"
if [ ! -f "$ICON_SRC" ]; then
  echo -e "${RED}  ERROR: icon.png not found in project root!${NC}"
  exit 1
fi

mkdir -p "$STORE_DIR" "$SCRIPT_DIR/icons"

# Extension icons (resized from source)
magick "$ICON_SRC" -resize 16x16   "$SCRIPT_DIR/icons/icon16.png"
echo "  Created icons/icon16.png (16x16)"
magick "$ICON_SRC" -resize 48x48   "$SCRIPT_DIR/icons/icon48.png"
echo "  Created icons/icon48.png (48x48)"
magick "$ICON_SRC" -resize 128x128 "$SCRIPT_DIR/icons/icon128.png"
echo "  Created icons/icon128.png (128x128)"

# Store icon (copy of 128x128)
cp "$SCRIPT_DIR/icons/icon128.png" "$STORE_DIR/icon-128.png"
echo "  Created store-assets/icon-128.png (128x128)"

# Promo image: icon centered on dark background
magick -size 440x280 xc:"#1a1a2e" \
  \( "$ICON_SRC" -resize 160x160 \) -gravity center -composite \
  "$STORE_DIR/promo-small-440x280.png"
echo "  Created store-assets/promo-small-440x280.png (440x280)"

echo -e "${GREEN}  Assets generated${NC}"
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
