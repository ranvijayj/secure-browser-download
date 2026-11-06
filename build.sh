#!/usr/bin/env bash
# Builds the Chrome Web Store upload: a zip of ext/ *contents* (manifest at the zip root).
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(node -p "require('./ext/manifest.json').version")
mkdir -p dist
OUT="dist/securedl-$VERSION.zip"
rm -f "$OUT"
(cd ext && zip -qr -X "../$OUT" . -x '.*')
echo "Built $OUT"
