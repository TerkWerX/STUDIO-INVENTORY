#!/usr/bin/env bash
# Installs or updates Studio Inventory in ~/Applications/Studio Inventory.
# Written for the bash 3.2 and BSD tools that ship with macOS.
set -euo pipefail

SOURCE="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${STUDIO_INVENTORY_INSTALL_DIR:-$HOME/Applications/Studio Inventory}"
TARGET="${TARGET%/}"
START_CMD="$TARGET/Start Studio Inventory.command"
DATA_DIR="$TARGET/data"

echo "Studio Inventory — macOS installer"
echo "Installing to: $TARGET"

if [[ -z "$TARGET" || "$TARGET" == "/" || "$TARGET" == "$HOME" ]]; then
  echo "Refusing unsafe install target: $TARGET" >&2
  exit 2
fi

# Rename a folder; never merge into (or move inside) one that already exists.
rename_dir() {
  if [[ -e "$2" ]]; then
    echo "$2 already exists." >&2
    return 1
  fi
  mv -- "$1" "$2"
}

# Updates never copy or delete data/: the new version is copied next to the
# install first, then the install is renamed aside and data/ is moved (renamed)
# into the new version. Any failure puts the previous install back.
if [[ "$SOURCE" != "$TARGET" ]]; then
  case "$SOURCE/" in
    "$TARGET/"*)
      echo "Run the installer from the downloaded DMG or ZIP, not from inside $TARGET." >&2
      exit 2
      ;;
  esac

  running_root="$(curl -fsS --max-time 2 http://127.0.0.1:3847/api/health 2>/dev/null \
    | sed -n 's/.*"appRoot":"\([^"]*\)".*/\1/p' || true)"
  if [[ -n "$running_root" && "${running_root%/}" == "$TARGET" ]]; then
    echo "Studio Inventory is running from $TARGET." >&2
    echo "Stop it first (close its Terminal window), then run the installer again." >&2
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
        rename_dir "$STAGING/data" "$PREVIOUS/data" || {
          echo "Your inventory data was not deleted. It is in: $STAGING/data" >&2
          return
        }
      fi
      rename_dir "$PREVIOUS" "$TARGET" || {
        echo "Your previous install, with your inventory data, is in: $PREVIOUS" >&2
        return
      }
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
  cp -R -- "$SOURCE/." "$STAGING/"
  # The download was quarantined by macOS; you approved it by running this
  # installer, so the installed copy should not ask again for every file.
  xattr -dr com.apple.quarantine "$STAGING" 2>/dev/null || true

  if [[ -d "$TARGET" ]]; then
    echo "Updating existing install…"
    rename_dir "$TARGET" "$PREVIOUS"
    SET_ASIDE=1
    if [[ -d "$PREVIOUS/data" ]]; then
      echo "Moving your inventory data into the new version…"
      rm -rf -- "$STAGING/data"
      rename_dir "$PREVIOUS/data" "$STAGING/data"
    fi
  fi

  rename_dir "$STAGING" "$TARGET"
  FINISHED=1
  trap - EXIT INT TERM
  if [[ "$SET_ASIDE" -eq 1 ]]; then
    rm -rf -- "$PREVIOUS" || true
  fi
fi

chmod +x "$TARGET/Start Studio Inventory.command" 2>/dev/null || true
chmod +x "$TARGET/start-studio-inventory.sh" 2>/dev/null || true

DESKTOP="$HOME/Desktop/Studio Inventory.command"
mkdir -p "$HOME/Desktop" 2>/dev/null || true
ln -sf "$START_CMD" "$DESKTOP" 2>/dev/null || cp "$TARGET/Start Studio Inventory.command" "$DESKTOP" 2>/dev/null || true
chmod +x "$DESKTOP" 2>/dev/null || true

echo ""
echo "Installed. Open 'Studio Inventory' from your Desktop or Applications folder."
echo "Your data is stored in: $DATA_DIR"
echo ""

read -r -p "Start Studio Inventory now? [Y/n] " ans || ans=n
if [[ ! "$ans" =~ ^[Nn]$ ]]; then
  open "$START_CMD" 2>/dev/null || bash "$START_CMD"
fi
