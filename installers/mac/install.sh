#!/usr/bin/env bash
set -euo pipefail

SOURCE="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$HOME/Applications/Studio Inventory"
START_CMD="$TARGET/Start Studio Inventory.command"

echo "Studio Inventory — macOS installer"
echo "Installing to: $TARGET"

mkdir -p "$HOME/Applications"
rm -rf "$TARGET"
mkdir -p "$TARGET"

# Copy app files (exclude installers source tree duplication at root if re-run from target)
rsync -a --exclude 'dist' --exclude '.git' "$SOURCE/" "$TARGET/" 2>/dev/null || {
  cp -R "$SOURCE/." "$TARGET/"
}

chmod +x "$TARGET/Start Studio Inventory.command" 2>/dev/null || true
chmod +x "$TARGET/start-studio-inventory.sh" 2>/dev/null || true

DESKTOP="$HOME/Desktop/Studio Inventory.command"
ln -sf "$START_CMD" "$DESKTOP" 2>/dev/null || cp "$TARGET/Start Studio Inventory.command" "$DESKTOP"
chmod +x "$DESKTOP" 2>/dev/null || true

echo ""
echo "Installed. Open 'Studio Inventory' from your Desktop or Applications folder."
echo "Data folder: $TARGET/data"
echo ""

read -r -p "Start Studio Inventory now? [Y/n] " ans
if [[ ! "$ans" =~ ^[Nn]$ ]]; then
  open "$START_CMD" 2>/dev/null || bash "$START_CMD"
fi