#!/bin/bash
set -e

EXTENSION_UUID="arcane-cursor@jphein.github.io"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SOURCE_DIR="$(dirname "$0")/../extension"

echo "✦ Installing Arcane Cursor (realm.watch)..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -r "$SOURCE_DIR"/* "$INSTALL_DIR/"

# compile schemas
if command -v glib-compile-schemas >/dev/null; then
    echo "⚙️ Compiling schemas..."
    glib-compile-schemas "$INSTALL_DIR/schemas/"
else
    echo "⚠️ glib-compile-schemas not found. You may need to install libglib2.0-bin or similar."
fi

echo "✅ Arcane Cursor installed."
echo "🔄 Please restart GNOME Shell: log out/in (Wayland)."
echo "👉 Then enable with: gnome-extensions enable $EXTENSION_UUID"
