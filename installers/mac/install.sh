#!/usr/bin/env bash
set -euo pipefail

SOURCE="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$HOME/Applications/Studio Inventory"
START_CMD="$TARGET/Start Studio Inventory.command"
DATA_DIR="$TARGET/data"
DATA_BACKUP="$(mktemp -d)/studio-inventory-data-backup"

echo "Studio Inventory — macOS installer"
echo "Installing to: $TARGET"

if [[ -d "$DATA_DIR" ]]; then
  echo "Backing up your inventory data…"
  cp -R "$DATA_DIR" "$DATA_BACKUP"
fi

if [[ -d "$TARGET" ]]; then
  echo "Updating existing install…"
  rm -rf "$TARGET"
fi

mkdir -p "$TARGET"

rsync -a --exclude 'dist' --exclude '.git' "$SOURCE/" "$TARGET/" 2>/dev/null || cp -R "$SOURCE/." "$TARGET/"

if [[ -d "$DATA_BACKUP" ]]; then
  echo "Restoring your inventory data…"
  rm -rf "$DATA_DIR"
  cp -R "$DATA_BACKUP" "$DATA_DIR"
fi

chmod +x "$TARGET/Start Studio Inventory.command" 2>/dev/null || true
chmod +x "$TARGET/start-studio-inventory.sh" 2>/dev/null || true

DESKTOP="$HOME/Desktop/Studio Inventory.command"
ln -sf "$START_CMD" "$DESKTOP" 2>/dev/null || cp "$TARGET/Start Studio Inventory.command" "$DESKTOP"
chmod +x "$DESKTOP" 2>/dev/null || true

echo ""
echo "Installed. Open 'Studio Inventory' from your Desktop or Applications folder."
echo "Your data is stored in: $DATA_DIR"
echo ""

read -r -p "Start Studio Inventory now? [Y/n] " ans
if [[ ! "$ans" =~ ^[Nn]$ ]]; then
  open "$START_CMD" 2>/dev/null || bash "$START_CMD"
fi