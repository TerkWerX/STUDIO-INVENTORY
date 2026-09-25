#!/usr/bin/env bash
set -euo pipefail

SOURCE="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${STUDIO_INVENTORY_INSTALL_DIR:-$HOME/.local/share/studio-inventory}"
NO_START=0
NO_SHORTCUTS=0

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
    --no-shortcuts)
      NO_SHORTCUTS=1
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

echo "Studio Inventory — Linux installer"
echo "Installing to: $TARGET"

# Updates never copy or delete data/: the new version is copied next to the
# install first, then the install is renamed aside and data/ is moved (renamed)
# into the new version. Any failure puts the previous install back.
if [[ "$SOURCE" != "$TARGET" ]]; then
  case "$SOURCE/" in
    "$TARGET/"*)
      echo "Run the installer from the extracted download, not from inside $TARGET." >&2
      exit 2
      ;;
  esac

  running_root="$(curl -fsS --max-time 2 http://127.0.0.1:3847/api/health 2>/dev/null \
    | sed -n 's/.*"appRoot":"\([^"]*\)".*/\1/p' || true)"
  if [[ -n "$running_root" && "$(realpath -m "$running_root")" == "$TARGET" ]]; then
    echo "Studio Inventory is running from $TARGET." >&2
    echo "Stop it first (press Ctrl+C in its terminal window), then run the installer again." >&2
    exit 1
  fi

  STAMP="$(date +%Y%m%d-%H%M%S)"
  STAGING="$TARGET.installing-$STAMP"
  PREVIOUS="$TARGET.previous-$STAMP"
  STAGED=0
  SET_ASIDE=0
  FINISHED=0

  rollback() {
    [[ "$FINISHED" -eq 1 ]] && return
    echo "The install did not finish; putting the previous version back…" >&2
    if [[ "$SET_ASIDE" -eq 1 ]]; then
      if [[ ! -d "$PREVIOUS/data" && -d "$STAGING/data" ]]; then
        mv -T -- "$STAGING/data" "$PREVIOUS/data" || {
          echo "Your inventory data was not deleted. It is in: $STAGING/data" >&2
          return
        }
      fi
      if [[ ! -e "$TARGET" ]]; then
        mv -T -- "$PREVIOUS" "$TARGET" || {
          echo "Your previous install, with your inventory data, is in: $PREVIOUS" >&2
          return
        }
      else
        echo "Your previous install, with your inventory data, is in: $PREVIOUS" >&2
        return
      fi
    fi
    [[ "$STAGED" -eq 1 ]] && rm -rf -- "$STAGING"
    echo "Nothing was changed." >&2
  }
  trap rollback EXIT
  trap 'exit 130' INT TERM

  mkdir -p -- "$(dirname "$TARGET")"
  echo "Copying Studio Inventory files…"
  mkdir -- "$STAGING"
  STAGED=1
  cp -a -- "$SOURCE/." "$STAGING/"

  if [[ -d "$TARGET" ]]; then
    echo "Updating existing install…"
    mv -T -- "$TARGET" "$PREVIOUS"
    SET_ASIDE=1
    if [[ -d "$PREVIOUS/data" ]]; then
      echo "Moving your inventory data into the new version…"
      rm -rf -- "$STAGING/data"
      mv -T -- "$PREVIOUS/data" "$STAGING/data"
    fi
  fi

  mv -T -- "$STAGING" "$TARGET"
  FINISHED=1
  trap - EXIT INT TERM
  if [[ "$SET_ASIDE" -eq 1 ]]; then
    rm -rf -- "$PREVIOUS" || true
  fi
fi

chmod +x "$TARGET/.runtime/node" "$TARGET/Start Studio Inventory.sh" \
  "$TARGET/Install Studio Inventory.sh" "$TARGET/start-studio-inventory.sh"

if [[ "$NO_SHORTCUTS" -eq 0 ]]; then
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
fi

echo
echo "Installed successfully."
echo "Run 'studio-inventory' or open Studio Inventory from your applications menu."
echo "Your data is stored in: $TARGET/data"

if [[ "$NO_START" -eq 0 ]]; then
  exec "$TARGET/Start Studio Inventory.sh"
fi
