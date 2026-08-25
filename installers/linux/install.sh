#!/usr/bin/env bash
set -euo pipefail

SOURCE="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${STUDIO_INVENTORY_INSTALL_DIR:-$HOME/.local/share/studio-inventory}"
NO_START=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      if [[ $# -lt 2 ]]; then
        echo "--target requires a directory" >&2
        exit 2
      fi
      TARGET="$2"
      shift 2
      ;;
    --no-start)
      NO_START=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

TARGET="$(realpath -m "$TARGET")"
if [[ -z "$TARGET" || "$TARGET" == "/" || "$TARGET" == "$HOME" ]]; then
  echo "Refusing unsafe install target: $TARGET" >&2
  exit 2
fi

BACKUP_ROOT="$(mktemp -d)"
DATA_BACKUP="$BACKUP_ROOT/data"
cleanup() {
  rm -rf -- "$BACKUP_ROOT"
}
trap cleanup EXIT

echo "Studio Inventory — Linux installer"
echo "Installing to: $TARGET"

if [[ "$SOURCE" != "$TARGET" && -d "$TARGET/data" ]]; then
  echo "Backing up your inventory data…"
  cp -a -- "$TARGET/data" "$DATA_BACKUP"
fi

if [[ "$SOURCE" != "$TARGET" ]]; then
  if [[ -d "$TARGET" ]]; then
    echo "Updating existing install…"
    rm -rf -- "$TARGET"
  fi

  mkdir -p -- "$TARGET"
  cp -a -- "$SOURCE/." "$TARGET/"

  if [[ -d "$DATA_BACKUP" ]]; then
    echo "Restoring your inventory data…"
    rm -rf -- "$TARGET/data"
    cp -a -- "$DATA_BACKUP" "$TARGET/data"
  fi
fi

chmod +x "$TARGET/.runtime/node" "$TARGET/Start Studio Inventory.sh" \
  "$TARGET/Install Studio Inventory.sh" "$TARGET/start-studio-inventory.sh"

mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
ln -sfn "$TARGET/Start Studio Inventory.sh" "$HOME/.local/bin/studio-inventory"

DESKTOP_FILE="$HOME/.local/share/applications/studio-inventory.desktop"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Studio Inventory
Comment=Local music gear inventory
Exec="$TARGET/Start Studio Inventory.sh"
Icon=$TARGET/public/icons/icon.svg
Terminal=true
Categories=AudioVideo;Utility;
EOF
chmod +x "$DESKTOP_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

echo
echo "Installed successfully."
echo "Run 'studio-inventory' or open Studio Inventory from your applications menu."
echo "Your data is stored in: $TARGET/data"

if [[ "$NO_START" -eq 0 ]]; then
  exec "$TARGET/Start Studio Inventory.sh"
fi
