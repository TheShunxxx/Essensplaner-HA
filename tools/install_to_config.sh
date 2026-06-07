#!/usr/bin/env sh
set -eu

CONFIG_DIR="${1:-/config}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

mkdir -p "$CONFIG_DIR/custom_components/essen"
mkdir -p "$CONFIG_DIR/www"
mkdir -p "$CONFIG_DIR/essen"

cp "$REPO_DIR/custom_components/essen/"*.py "$CONFIG_DIR/custom_components/essen/"
cp "$REPO_DIR/custom_components/essen/"*.yaml "$CONFIG_DIR/custom_components/essen/"
cp "$REPO_DIR/custom_components/essen/"*.json "$CONFIG_DIR/custom_components/essen/"
cp "$REPO_DIR/www/essen-planer-card.js" "$CONFIG_DIR/www/essen-planer-card.js"
cp "$REPO_DIR/config/essen/essen_cli.py" "$CONFIG_DIR/essen/essen_cli.py"
chmod +x "$CONFIG_DIR/essen/essen_cli.py"

if [ ! -f "$CONFIG_DIR/essen/gerichte.json" ]; then
  cp "$REPO_DIR/examples/gerichte.example.json" "$CONFIG_DIR/essen/gerichte.json"
fi

if [ ! -f "$CONFIG_DIR/essen/wochenplaene.json" ]; then
  cp "$REPO_DIR/examples/wochenplaene.empty.json" "$CONFIG_DIR/essen/wochenplaene.json"
fi

python3 "$CONFIG_DIR/essen/essen_cli.py" publish || true

cat <<'INFO'
Dateien wurden kopiert.

Naechste Schritte:
1. examples/configuration-snippet.yaml in configuration.yaml uebernehmen.
2. /local/essen-planer-card.js?v=20260607-1 als Lovelace-Ressource eintragen.
3. Die drei Lovelace-Views aus examples/lovelace-views.json anlegen.
4. Home Assistant Konfiguration pruefen und Core neu starten.
INFO
